import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { ImpactStore, type ImpactRow, type ImpactState } from '../impact/impact-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import {assertPreparedAdoptionPlan,preparedAdoptionPlanDigest,type PreparedAdoptionPlanV1} from './created-source-ports.js';

/**
 * The operation of a created-source adoption.
 *
 * It is a new value in the existing `impact` table, and it needs a controlled forward
 * schema upgrade: SQLite cannot widen a CHECK constraint in place, so the table is
 * rebuilt and every old row is copied across unchanged.
 */
export const CREATED_IMPACT_OPERATION = 'adopt_prepared_source';

/** The two operations the legacy migration domain owns. */
export const LEGACY_IMPACT_OPERATIONS = ['adopt_materialization', 'restore_snapshot'] as const;

/**
 * The hash domain of a created impact.
 *
 * It is not the legacy domain. The legacy parser recognises only the legacy
 * operations, and the created parser recognises only the created one, so a spec of one
 * domain is never accepted by the other.
 */
export const CREATED_IMPACT_HASH_DOMAIN = 'narralens-created-impact-v1\n';

/** The fixed lifetime of a created impact, in milliseconds. A replay never extends it. */
export const CREATED_IMPACT_TTL_MS = 15 * 60 * 1000;

/** The shape of the `impact` table after the forward upgrade. */
const IMPACT_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS impact (
  impact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('adopt_materialization','restore_snapshot','adopt_prepared_source')),
  reference_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  source_digest TEXT NOT NULL,
  control_revision INTEGER NOT NULL,
  rights_digest TEXT NOT NULL,
  native_plan_sha256 TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  impact_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','consumed','expired','stale')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, impact_hash)
);
`;

/**
 * The immutable fact of a created impact.
 *
 * There is no state column: the state of an impact lives in the one `impact` table,
 * and this table only remembers the plan the impact was created from. A second source
 * of truth for "is this impact still usable" is exactly the thing that must not exist.
 */
export const CREATED_IMPACT_FACT_DDL = `
CREATE TABLE created_impact_fact (
  impact_id TEXT PRIMARY KEY REFERENCES impact(impact_id),
  format TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL,
  prepared_source_id TEXT NOT NULL,
  source_kind TEXT NOT NULL
);
CREATE TRIGGER created_impact_fact_no_update BEFORE UPDATE ON created_impact_fact BEGIN SELECT RAISE(ABORT,'immutable created impact fact'); END;
CREATE TRIGGER created_impact_fact_no_delete BEFORE DELETE ON created_impact_fact BEGIN SELECT RAISE(ABORT,'immutable created impact fact'); END;
`;

/** One affected range of a created impact. */
export interface CreatedImpactRange {
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  readonly clip_id: string;
}

/** One consumer of a created impact. */
export interface CreatedImpactConsumer {
  readonly kind: string;
  readonly id: string;
  readonly action: string;
}

/** One lock a created impact was checked against. */
export interface CreatedImpactLock {
  readonly lock_id: string;
  readonly lock_type: string;
  readonly scope: string;
  readonly target_id: string;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
}

/** The spec of a created impact. */
export interface CreatedImpactSpecV1 {
  readonly format: 'narralens.created-impact@1';
  readonly impact_id: string;
  readonly project_id: string;
  readonly operation: typeof CREATED_IMPACT_OPERATION;
  /** The D02 prepared source this impact authorises. */
  readonly materialization_id: string;
  /** The predicted snapshot. It is an expectation, not a committed row. */
  readonly target_snapshot_id: string;
  readonly base_revision: number;
  readonly source_digest: string;
  readonly control_revision: number;
  readonly engine: 'openfilm';
  readonly engine_upstream_sha: string;
  readonly affected_ranges: readonly CreatedImpactRange[];
  readonly affected_consumers: readonly CreatedImpactConsumer[];
  readonly locks_checked: readonly CreatedImpactLock[];
  readonly rights_digest: string;
  /** The D09 plan digest. It is the plan this impact authorises. */
  readonly native_plan_sha256: string;
  readonly approvals_required: readonly string[];
  readonly expires_at: string;
  readonly impact_hash: string;
}

/** The failure of the created impact store. */
export class CreatedImpactError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND' | 'IMPACT_STALE',
    message: string) {
    super(message);
    this.name = 'CreatedImpactError';
  }
}

function fail(code: CreatedImpactError['code'], message: string): never {
  throw new CreatedImpactError(code, message);
}

const HASH = /^[a-f0-9]{64}$/;

/* -------------------------------------------------------------------------------------- */
/* The canonical form                                                                      */
/* -------------------------------------------------------------------------------------- */

function byRange(left: CreatedImpactRange, right: CreatedImpactRange): number {
  return left.start_frame - right.start_frame
    || left.end_frame_exclusive - right.end_frame_exclusive
    || (left.clip_id < right.clip_id ? -1 : left.clip_id > right.clip_id ? 1 : 0);
}

function byConsumer(left: CreatedImpactConsumer, right: CreatedImpactConsumer): number {
  return (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    || (left.action < right.action ? -1 : left.action > right.action ? 1 : 0);
}

function byLock(left: CreatedImpactLock, right: CreatedImpactLock): number {
  return left.lock_id < right.lock_id ? -1 : left.lock_id > right.lock_id ? 1 : 0;
}

/** The spec with its arrays in their canonical order and without its own hash. */
export function createdImpactFacts(spec: CreatedImpactSpecV1): Omit<CreatedImpactSpecV1, 'impact_hash'> {
  return {
    format: spec.format,
    impact_id: spec.impact_id,
    project_id: spec.project_id,
    operation: spec.operation,
    materialization_id: spec.materialization_id,
    target_snapshot_id: spec.target_snapshot_id,
    base_revision: spec.base_revision,
    source_digest: spec.source_digest,
    control_revision: spec.control_revision,
    engine: spec.engine,
    engine_upstream_sha: spec.engine_upstream_sha,
    affected_ranges: [...spec.affected_ranges]
      .map((range) => ({ start_frame: range.start_frame, end_frame_exclusive: range.end_frame_exclusive, clip_id: range.clip_id }))
      .sort(byRange),
    affected_consumers: [...spec.affected_consumers]
      .map((consumer) => ({ kind: consumer.kind, id: consumer.id, action: consumer.action }))
      .sort(byConsumer),
    locks_checked: [...spec.locks_checked]
      .map((lock) => ({
        lock_id: lock.lock_id, lock_type: lock.lock_type, scope: lock.scope,
        target_id: lock.target_id, start_frame: lock.start_frame, end_frame_exclusive: lock.end_frame_exclusive,
      }))
      .sort(byLock),
    rights_digest: spec.rights_digest,
    native_plan_sha256: spec.native_plan_sha256,
    approvals_required: [...spec.approvals_required].sort(),
    expires_at: spec.expires_at,
  };
}

/** The exact bytes the created impact hash is taken over. */
export function createdImpactHashPreimage(spec: CreatedImpactSpecV1): string {
  return `${CREATED_IMPACT_HASH_DOMAIN}${canonicalJson(createdImpactFacts(spec))}`;
}

/** The hash of a created impact. */
export function computeCreatedImpactHash(spec: CreatedImpactSpecV1): string {
  return createHash('sha256').update(createdImpactHashPreimage(spec), 'utf8').digest('hex');
}

/* -------------------------------------------------------------------------------------- */
/* The forward schema upgrade                                                              */
/* -------------------------------------------------------------------------------------- */

/**
 * Whether the stored `impact` table already accepts the created operation.
 *
 * The answer comes from the table's own stored DDL, not from the fact that a
 * `CREATE TABLE IF NOT EXISTS` ran without an error: that statement is a no-op on an
 * existing table, so it would hide a CHECK constraint that was never upgraded.
 */
export function impactTableAllowsCreatedOperation(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='impact'").get() as
    { sql?: string } | undefined;
  if (row === undefined || typeof row.sql !== 'string') return false;
  return row.sql.includes(`'${CREATED_IMPACT_OPERATION}'`);
}

/**
 * The controlled forward upgrade of the `impact` table.
 *
 * SQLite cannot widen a CHECK constraint, so the table is rebuilt: the new table is
 * created with the created operation in its CHECK, every old row is copied into it
 * unchanged, and only then does the old table go away. The `UNIQUE(project_id,
 * impact_hash)` constraint travels with the definition.
 *
 * The whole rebuild is one transaction, and the legacy rows are compared before and
 * after, so an upgrade that lost or altered a row fails instead of passing quietly.
 */
export function upgradeImpactTableForCreatedOperation(db: DatabaseSync): { readonly upgraded: boolean; readonly rows: number } {
  const before = db.prepare('SELECT * FROM impact ORDER BY impact_id').all() as Array<Record<string, unknown>>;
  if (impactTableAllowsCreatedOperation(db)) {
    return { upgraded: false, rows: before.length };
  }
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='impact'").get();
  if (existing === undefined) {
    // A fresh database: the table is created with the widened CHECK in the first place,
    // and there is nothing to preserve.
    db.exec(IMPACT_TABLE_DDL);
    return { upgraded: true, rows: 0 };
  }
  // The foreign keys are turned off for the rebuild, and `legacy_alter_table` keeps the
  // rename from rewriting the foreign keys of other tables that reference `impact`.
  db.exec('PRAGMA legacy_alter_table=ON');
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(IMPACT_TABLE_DDL.replace('CREATE TABLE IF NOT EXISTS impact (', 'CREATE TABLE impact_v2 ('));
    db.exec(`INSERT INTO impact_v2(
      impact_id, project_id, operation, reference_id, base_revision, source_digest,
      control_revision, rights_digest, native_plan_sha256, request_digest, canonical_json,
      impact_hash, state, expires_at, created_at, updated_at)
      SELECT impact_id, project_id, operation, reference_id, base_revision, source_digest,
      control_revision, rights_digest, native_plan_sha256, request_digest, canonical_json,
      impact_hash, state, expires_at, created_at, updated_at FROM impact`);
    db.exec('DROP TABLE impact');
    db.exec('ALTER TABLE impact_v2 RENAME TO impact');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('PRAGMA legacy_alter_table=OFF');
  }
  const after = db.prepare('SELECT * FROM impact ORDER BY impact_id').all() as Array<Record<string, unknown>>;
  if (after.length !== before.length) {
    throw new Error(`IMPACT_UPGRADE_ROW_COUNT_CHANGED:${before.length}->${after.length}`);
  }
  for (let index = 0; index < before.length; index += 1) {
    const old = before[index]!;
    const next = after[index]!;
    for (const key of Object.keys(old)) {
      if (String(old[key]) !== String(next[key])) {
        throw new Error(`IMPACT_UPGRADE_ROW_CHANGED:${String(old.impact_id)}:${key}`);
      }
    }
  }
  return { upgraded: true, rows: after.length };
}

/* -------------------------------------------------------------------------------------- */
/* The store                                                                               */
/* -------------------------------------------------------------------------------------- */

/** The input of one created impact. */
export interface CreateCreatedImpactInput {
  readonly impact_id: string;
  readonly project_id: string;
  readonly materialization_id: string;
  readonly target_snapshot_id: string;
  readonly base_revision: number;
  readonly source_digest: string;
  readonly control_revision: number;
  readonly engine_upstream_sha: string;
  readonly affected_ranges: readonly CreatedImpactRange[];
  readonly affected_consumers: readonly CreatedImpactConsumer[];
  readonly locks_checked: readonly CreatedImpactLock[];
  readonly rights_digest: string;
  readonly native_plan_sha256: string;
  readonly approvals_required: readonly string[];
  readonly request_digest: string;
  /** The complete D09 plan. Its digest is the plan this impact authorises. */
  readonly plan: unknown;
  readonly now: Date;
}

/**
 * The store of the created-source impact.
 *
 * The impact row itself lives in the one `impact` table, whose state machine is the
 * only authority for "is this impact still usable". This store owns the created
 * domain: the forward upgrade of the table, the created hash domain, and the immutable
 * fact that remembers the plan.
 */
export class CreatedSourceImpactStore {
  readonly #db: DatabaseSync;
  readonly #impacts: ImpactStore;
  readonly #revisions: RevisionStore;
  #schemaVersion = -1;

  constructor(revisions: RevisionStore, impacts: ImpactStore) {
    this.#revisions = revisions;
    this.#db = revisions.compose((db) => db);
    this.#impacts = impacts;
    this.#schema();
  }

  #schema(): void {
    const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    if (version === this.#schemaVersion) return;
    // The upgrade runs on the real table, in one transaction, and preserves the old
    // rows. It is not hidden behind an IF NOT EXISTS that would succeed on an
    // un-upgraded table.
    upgradeImpactTableForCreatedOperation(this.#db);
    const found = this.#db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'created_impact_fact' LIMIT 1").get();
    if (found === undefined) {
      this.#db.exec(CREATED_IMPACT_FACT_DDL);
    } else if (!matchesFrozenSchemaNamespace(this.#db, CREATED_IMPACT_FACT_DDL, 'created_impact_fact')) {
      fail('REVISION_CONFLICT', 'The created impact fact schema differs from the one this build expects');
    }
    this.#schemaVersion = version;
  }

  /**
   * Create the impact and its immutable fact in one transaction.
   *
   * The expiry is the one this call computed. A replay of the same request returns the
   * stored row with its original expiry: the window never extends because somebody
   * asked again.
   */
  create(input: CreateCreatedImpactInput): CreatedImpactSpecV1 {
    return this.#revisions.atomic(() => this.insertInTransaction(input));
  }

  /** Insert alongside the request's remembered response in the caller's one Host
   * transaction. This method cannot silently commit the caller's other writes. */
  insertInTransaction(input: CreateCreatedImpactInput): CreatedImpactSpecV1 {
    if (!this.#db.isTransaction) fail('REVISION_CONFLICT', 'Created impact insertion requires the Host transaction');
    this.#schema();
    const existing = this.#impacts.get(input.impact_id);
    const plan=assertPreparedAdoptionPlan(input.plan as PreparedAdoptionPlanV1);
    if(preparedAdoptionPlanDigest(plan)!==input.native_plan_sha256||plan.project_id!==input.project_id
      ||plan.materialization_id!==input.materialization_id||plan.target_snapshot_id!==input.target_snapshot_id
      ||plan.base_revision!==input.base_revision||plan.base_source_digest!==input.source_digest
      ||plan.control_revision!==input.control_revision||plan.engine_upstream_sha!==input.engine_upstream_sha)
      fail(existing?'IDEMPOTENCY_CONFLICT':'INVALID_REQUEST','Created impact and its immutable plan disagree');
    if (!HASH.test(input.request_digest) || !HASH.test(input.source_digest) ||
      !HASH.test(input.rights_digest) || !HASH.test(input.native_plan_sha256) ||
      !/^[a-f0-9]{40}$/.test(input.engine_upstream_sha)) {
      fail('INVALID_REQUEST', 'The created impact digests are invalid');
    }
    if (!Number.isSafeInteger(input.base_revision) || input.base_revision < 0 ||
      !Number.isSafeInteger(input.control_revision) || input.control_revision < 0) {
      fail('INVALID_REQUEST', 'The created impact revisions are invalid');
    }
    const expiresAt = new Date(input.now.getTime() + CREATED_IMPACT_TTL_MS).toISOString();
    const spec: CreatedImpactSpecV1 = {
      format: 'narralens.created-impact@1',
      impact_id: input.impact_id,
      project_id: input.project_id,
      operation: CREATED_IMPACT_OPERATION,
      materialization_id: input.materialization_id,
      target_snapshot_id: input.target_snapshot_id,
      base_revision: input.base_revision,
      source_digest: input.source_digest,
      control_revision: input.control_revision,
      engine: 'openfilm',
      engine_upstream_sha: input.engine_upstream_sha,
      affected_ranges: input.affected_ranges,
      affected_consumers: input.affected_consumers,
      locks_checked: input.locks_checked,
      rights_digest: input.rights_digest,
      native_plan_sha256: input.native_plan_sha256,
      approvals_required: input.approvals_required,
      expires_at: expiresAt,
      impact_hash: '',
    };
    const hash = computeCreatedImpactHash(spec);
    const stored: CreatedImpactSpecV1 = { ...createdImpactFacts(spec), impact_hash: hash };
    const at = input.now.toISOString();
    if (existing !== undefined) {
      if (existing.project_id !== input.project_id) fail('IDEMPOTENCY_CONFLICT', 'The impact belongs to another project');
      const found = this.read(input.impact_id);
      if (found === undefined) fail('REVISION_CONFLICT', 'The stored created impact does not parse');
      const previousPlan=this.planFact(input.impact_id);
      if(existing.request_digest!==input.request_digest||!previousPlan
        ||canonicalJson(previousPlan.plan)!==canonicalJson(input.plan)
        ||computeCreatedImpactHash({...stored,expires_at:found.expires_at})!==found.impact_hash)
        fail('IDEMPOTENCY_CONFLICT','The impact identifier was used for different immutable facts');
      return found;
    }
      this.#db.prepare(`INSERT INTO impact(
        impact_id, project_id, operation, reference_id, base_revision, source_digest,
        control_revision, rights_digest, native_plan_sha256, request_digest, canonical_json,
        impact_hash, state, expires_at, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`).run(
        stored.impact_id, stored.project_id, stored.operation, stored.materialization_id,
        stored.base_revision, stored.source_digest, stored.control_revision, stored.rights_digest,
        stored.native_plan_sha256, input.request_digest,
        canonicalJson(createdImpactFacts(stored)), hash, stored.expires_at, at, at);
      this.#db.prepare(`INSERT INTO created_impact_fact(
        impact_id, format, plan_json, plan_sha256, prepared_source_id, source_kind)
        VALUES(?,?,?,?,?,?)`).run(
        stored.impact_id, stored.format, canonicalJson(input.plan), stored.native_plan_sha256,
        stored.materialization_id, 'created_prepared_source');
    return stored;
  }

  /**
   * The created impact of one identifier.
   *
   * The row has to carry the created operation, and its bytes have to hash to their
   * own hash in the created domain. A row of the legacy domain is refused here, and a
   * row of the created domain is refused by the legacy reader.
   */
  read(impactId: string): CreatedImpactSpecV1 | undefined {
    this.#schema();
    const row = this.#impacts.get(impactId);
    if (row === undefined) return undefined;
    // The frozen contract type names only the two legacy operations, so the stored
    // value is compared as text: the column is wider than the old type says.
    if (String(row.operation) !== CREATED_IMPACT_OPERATION) return undefined;
    const parsed = this.#parse(row);
    if (parsed === undefined) fail('REVISION_CONFLICT', 'The stored created impact does not match its own hash');
    return parsed;
  }

  /** The created impact, and only if it is still usable right now. */
  requireActive(impactId: string, now: Date): CreatedImpactSpecV1 {
    const row = this.#impacts.require(impactId);
    if (String(row.operation) !== CREATED_IMPACT_OPERATION) {
      fail('NOT_FOUND', 'The impact is not a created-source impact');
    }
    if (row.state !== 'active') {
      fail('IMPACT_STALE', `The impact is ${row.state} and can no longer authorise a write`);
    }
    const parsed = this.#parse(row);
    if (parsed === undefined) fail('REVISION_CONFLICT', 'The stored created impact does not match its own hash');
    if (Date.parse(parsed.expires_at) <= now.getTime()) {
      fail('IMPACT_STALE', 'The impact has expired');
    }
    return parsed;
  }

  /** The immutable plan fact of one created impact. */
  planFact(impactId: string): { readonly plan_sha256: string; readonly prepared_source_id: string; readonly plan: unknown } | undefined {
    this.#schema();
    const row = this.#db.prepare('SELECT plan_json, plan_sha256, prepared_source_id FROM created_impact_fact WHERE impact_id=?')
      .get(impactId) as { plan_json?: string; plan_sha256?: string; prepared_source_id?: string } | undefined;
    if (row === undefined) return undefined;
    return {
      plan_sha256: String(row.plan_sha256),
      prepared_source_id: String(row.prepared_source_id),
      plan: JSON.parse(String(row.plan_json)) as unknown,
    };
  }

  /** The state of one impact, as the one impact table holds it. */
  state(impactId: string): ImpactState | undefined {
    return this.#impacts.get(impactId)?.state;
  }

  /**
   * Move an impact out of `active`.
   *
   * The transition is the one the legacy table owns; this store adds no state of its
   * own and no back door around the predecessor check.
   */
  consume(impactId: string, now: Date): ImpactRow {
    return this.#impacts.transition(impactId, 'active', 'consumed', now);
  }

  #parse(row: ImpactRow): CreatedImpactSpecV1 | undefined {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.canonical_json) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    if (parsed === undefined || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const spec = parsed as unknown as CreatedImpactSpecV1;
    if (spec.format !== 'narralens.created-impact@1' || spec.operation !== CREATED_IMPACT_OPERATION) return undefined;
    if (computeCreatedImpactHash(spec) !== row.impact_hash) return undefined;
    return { ...spec, impact_hash: row.impact_hash };
  }
}
