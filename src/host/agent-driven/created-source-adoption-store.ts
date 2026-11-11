import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import type { ExecutionBinding } from '../../contracts/agent-driven-types.js';
import type { CreatedSourceFactV1, PreparedSourceFileFact } from './created-source-ports.js';

/**
 * The immutable facts of a created adoption.
 *
 * Two tables, and neither of them has a state column.
 *
 * - `created_adoption_fact` records what the adoption was *prepared* against: the
 *   original closure, the target closure, the native plan, the impact and approval it
 *   is bound to, the private stage and the backup token, and the snapshot it expects.
 *   It is written before the commit and never changes.
 * - `created_source_fact` records what the adoption *produced*: the committed source
 *   of one snapshot. It is inserted, or verified field by field when the same content
 *   is adopted again, because content addressing means the same bytes produce the same
 *   snapshot id and a second adoption of it must not fail.
 *
 * The state of an adoption is not here. It is the state of the transaction, the impact
 * and the approval, and those have their own authorities.
 */
export const CREATED_ADOPTION_FACT_DDL = `
CREATE TABLE created_adoption_fact (
  transaction_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  prepared_source_id TEXT NOT NULL,
  impact_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL,
  facts_digest TEXT NOT NULL,
  original_source_digest TEXT NOT NULL,
  target_source_digest TEXT NOT NULL,
  expected_snapshot_id TEXT NOT NULL,
  native_plan_json TEXT NOT NULL,
  original_closure_json TEXT NOT NULL,
  target_closure_json TEXT NOT NULL,
  stage_root TEXT NOT NULL,
  backup_token TEXT NOT NULL,
  execution_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER created_adoption_fact_no_update BEFORE UPDATE ON created_adoption_fact BEGIN SELECT RAISE(ABORT,'immutable created adoption fact'); END;
CREATE TRIGGER created_adoption_fact_no_delete BEFORE DELETE ON created_adoption_fact BEGIN SELECT RAISE(ABORT,'immutable created adoption fact'); END;
`;

export const CREATED_SOURCE_FACT_DDL = `
CREATE TABLE created_source_fact (
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  prepared_source_id TEXT NOT NULL,
  impact_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL,
  facts_digest TEXT NOT NULL,
  revision INTEGER NOT NULL,
  execution_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, snapshot_id)
);
CREATE TRIGGER created_source_fact_no_update BEFORE UPDATE ON created_source_fact BEGIN SELECT RAISE(ABORT,'immutable created source fact'); END;
CREATE TRIGGER created_source_fact_no_delete BEFORE DELETE ON created_source_fact BEGIN SELECT RAISE(ABORT,'immutable created source fact'); END;
`;

/** Both fragments, in the order they are created. */
export const CREATED_ADOPTION_DDL = `${CREATED_ADOPTION_FACT_DDL}${CREATED_SOURCE_FACT_DDL}`;

/** The failure of the created adoption store. */
export class CreatedAdoptionError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND',
    message: string) {
    super(message);
    this.name = 'CreatedAdoptionError';
  }
}

function fail(code: CreatedAdoptionError['code'], message: string): never {
  throw new CreatedAdoptionError(code, message);
}

const HASH = /^[a-f0-9]{64}$/;

/** The immutable fact of one created adoption. */
export interface CreatedAdoptionFact {
  readonly transaction_id: string;
  readonly project_id: string;
  readonly prepared_source_id: string;
  readonly impact_id: string;
  readonly approval_id: string;
  readonly plan_sha256: string;
  readonly facts_digest: string;
  readonly original_source_digest: string;
  readonly target_source_digest: string;
  readonly expected_snapshot_id: string;
  readonly native_plan: unknown;
  readonly original_closure: readonly PreparedSourceFileFact[];
  readonly target_closure: readonly PreparedSourceFileFact[];
  readonly stage_root: string;
  readonly backup_token: string;
  readonly execution: ExecutionBinding;
  readonly created_at: string;
}

/** The input of one adoption fact. */
export interface RecordCreatedAdoptionInput {
  readonly transaction_id: string;
  readonly project_id: string;
  readonly prepared_source_id: string;
  readonly impact_id: string;
  readonly approval_id: string;
  readonly plan_sha256: string;
  readonly facts_digest: string;
  readonly original_source_digest: string;
  readonly target_source_digest: string;
  readonly expected_snapshot_id: string;
  readonly native_plan: unknown;
  readonly original_closure: readonly PreparedSourceFileFact[];
  readonly target_closure: readonly PreparedSourceFileFact[];
  readonly stage_root: string;
  readonly backup_token: string;
  readonly execution: ExecutionBinding;
  readonly now: Date;
}

/**
 * The store of the created adoption facts.
 *
 * It lives on the original database, so the fact that describes a commit and the
 * commit itself are in the same place, and a second database could never hold half of
 * an adoption.
 */
export class CreatedSourceAdoptionStore {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;
  #schemaVersion = -1;

  constructor(revisions: RevisionStore, options: { readonly now?: () => Date } = {}) {
    this.#db = revisions.compose((db) => db);
    this.#now = options.now ?? (() => new Date());
    this.#schema();
  }

  #schema(): void {
    const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    if (version === this.#schemaVersion) return;
    const found = this.#db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'created_*_fact' LIMIT 1").get();
    if (found === undefined) {
      this.#db.exec(CREATED_ADOPTION_FACT_DDL);
      this.#db.exec(CREATED_SOURCE_FACT_DDL);
    } else if (!matchesFrozenSchemaNamespace(this.#db, CREATED_ADOPTION_FACT_DDL, 'created_adoption_fact') ||
      !matchesFrozenSchemaNamespace(this.#db, CREATED_SOURCE_FACT_DDL, 'created_source_fact')) {
      fail('REVISION_CONFLICT', 'The created adoption schema differs from the one this build expects');
    }
    this.#schemaVersion = version;
  }

  /**
   * Record the fact of an adoption.
   *
   * The same adoption recorded twice is a replay and changes nothing. A different
   * adoption under the same transaction is a conflict: two transactions cannot both
   * describe the same commit.
   */
  record(input: RecordCreatedAdoptionInput): CreatedAdoptionFact {
    this.#schema();
    this.#assertInput(input);
    const at = input.now.toISOString();
    const existing = this.adoptionFact(input.transaction_id);
    if (existing !== undefined) {
      if (canonicalJson(this.#facts(existing)) !== canonicalJson(this.#factsOf(input))) {
        fail('IDEMPOTENCY_CONFLICT', 'Another adoption is already recorded for this transaction');
      }
      return existing;
    }
    this.#db.prepare(`INSERT INTO created_adoption_fact(
      transaction_id, project_id, prepared_source_id, impact_id, approval_id, plan_sha256,
      facts_digest, original_source_digest, target_source_digest, expected_snapshot_id,
      native_plan_json, original_closure_json, target_closure_json, stage_root, backup_token,
      execution_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.transaction_id, input.project_id, input.prepared_source_id, input.impact_id,
      input.approval_id, input.plan_sha256, input.facts_digest, input.original_source_digest,
      input.target_source_digest, input.expected_snapshot_id, canonicalJson(input.native_plan),
      canonicalJson(this.#closure(input.original_closure)), canonicalJson(this.#closure(input.target_closure)),
      input.stage_root, input.backup_token, canonicalJson(input.execution), at);
    const stored = this.adoptionFact(input.transaction_id);
    if (stored === undefined) fail('REVISION_CONFLICT', 'The created adoption fact did not land');
    return stored;
  }

  /** The fact of one adoption, or `undefined`. */
  adoptionFact(transactionId: string): CreatedAdoptionFact | undefined {
    this.#schema();
    const row = this.#db.prepare('SELECT * FROM created_adoption_fact WHERE transaction_id=?').get(transactionId) as
      Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      transaction_id: String(row.transaction_id),
      project_id: String(row.project_id),
      prepared_source_id: String(row.prepared_source_id),
      impact_id: String(row.impact_id),
      approval_id: String(row.approval_id),
      plan_sha256: String(row.plan_sha256),
      facts_digest: String(row.facts_digest),
      original_source_digest: String(row.original_source_digest),
      target_source_digest: String(row.target_source_digest),
      expected_snapshot_id: String(row.expected_snapshot_id),
      native_plan: JSON.parse(String(row.native_plan_json)) as unknown,
      original_closure: JSON.parse(String(row.original_closure_json)) as PreparedSourceFileFact[],
      target_closure: JSON.parse(String(row.target_closure_json)) as PreparedSourceFileFact[],
      stage_root: String(row.stage_root),
      backup_token: String(row.backup_token),
      execution: JSON.parse(String(row.execution_json)) as ExecutionBinding,
      created_at: String(row.created_at),
    };
  }

  /**
   * Insert the fact of a committed source, or verify the one that is already there.
   *
   * Content addressing means the same bytes produce the same snapshot id, so a second
   * adoption of the same content lands on the same key. A plain insert would fail on
   * the primary key and take the whole commit with it, which is the one outcome a
   * restore-and-re-adopt must not have. A writer that proves *different* content for
   * the same snapshot is a contradiction and rolls the commit back.
   */
  insertOrVerifySourceFact(input: {
    readonly fact: CreatedSourceFactV1;
    readonly now: Date;
  }): { readonly record: CreatedSourceFactV1; readonly replayed: boolean } {
    this.#schema();
    const fact = input.fact;
    if (fact.format !== 'narralens.created-source-fact@1') fail('INVALID_REQUEST', 'The source fact has another format');
    const existing = this.sourceFact(fact.project_id, fact.snapshot_id);
    if (existing !== undefined) {
      if (canonicalJson(this.#sourceFacts(existing)) !== canonicalJson(this.#sourceFacts(fact))) {
        fail('REVISION_CONFLICT', 'Another source is already committed under this snapshot');
      }
      return { record: existing, replayed: true };
    }
    const at = input.now.toISOString();
    this.#db.prepare(`INSERT INTO created_source_fact(
      project_id, snapshot_id, source_digest, transaction_id, prepared_source_id, impact_id,
      approval_id, plan_sha256, facts_digest, revision, execution_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      fact.project_id, fact.snapshot_id, fact.source_digest, fact.transaction_id,
      fact.prepared_source_id, fact.impact_id, fact.approval_id, fact.plan_sha256,
      fact.facts_digest, fact.revision, canonicalJson(fact.execution), at);
    return { record: fact, replayed: false };
  }

  /** The fact of one committed source, or `undefined`. */
  sourceFact(projectId: string, snapshotId: string): CreatedSourceFactV1 | undefined {
    this.#schema();
    const row = this.#db.prepare('SELECT * FROM created_source_fact WHERE project_id=? AND snapshot_id=?')
      .get(projectId, snapshotId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      format: 'narralens.created-source-fact@1',
      project_id: String(row.project_id),
      snapshot_id: String(row.snapshot_id),
      source_digest: String(row.source_digest),
      transaction_id: String(row.transaction_id),
      prepared_source_id: String(row.prepared_source_id),
      impact_id: String(row.impact_id),
      approval_id: String(row.approval_id),
      plan_sha256: String(row.plan_sha256),
      facts_digest: String(row.facts_digest),
      revision: Number(row.revision),
      execution: JSON.parse(String(row.execution_json)) as ExecutionBinding,
      created_at: String(row.created_at),
    };
  }

  #assertInput(input: RecordCreatedAdoptionInput): void {
    if (typeof input.transaction_id !== 'string' || input.transaction_id.length === 0 ||
      typeof input.project_id !== 'string' || input.project_id.length === 0 ||
      typeof input.prepared_source_id !== 'string' || input.prepared_source_id.length === 0 ||
      typeof input.impact_id !== 'string' || input.impact_id.length === 0 ||
      typeof input.approval_id !== 'string' || input.approval_id.length === 0) {
      fail('INVALID_REQUEST', 'The adoption identity is invalid');
    }
    if (!HASH.test(input.plan_sha256) || !HASH.test(input.facts_digest) ||
      !HASH.test(input.original_source_digest) || !HASH.test(input.target_source_digest)) {
      fail('INVALID_REQUEST', 'The adoption digests are invalid');
    }
    if (input.plan_sha256 !== input.facts_digest) {
      // The plan digest and the facts digest are ONE digest. A plan whose approval
      // summarises it differently is not the same plan.
      fail('INVALID_REQUEST', 'The plan digest and the facts digest must be the same digest');
    }
    if (typeof input.stage_root !== 'string' || input.stage_root.length === 0 ||
      typeof input.backup_token !== 'string' || input.backup_token.length === 0) {
      fail('INVALID_REQUEST', 'The adoption has no private stage or backup token');
    }
    if (!Array.isArray(input.original_closure) || input.original_closure.length === 0 ||
      !Array.isArray(input.target_closure) || input.target_closure.length === 0) {
      fail('INVALID_REQUEST', 'The adoption must record both closures');
    }
  }

  #closure(files: readonly PreparedSourceFileFact[]): PreparedSourceFileFact[] {
    return [...files]
      .map((file) => ({ relative_path: file.relative_path, bytes: file.bytes, sha256: file.sha256 }))
      .sort((left, right) => (left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0));
  }

  #factsOf(input: RecordCreatedAdoptionInput): Record<string, unknown> {
    return {
      project_id: input.project_id,
      prepared_source_id: input.prepared_source_id,
      impact_id: input.impact_id,
      approval_id: input.approval_id,
      plan_sha256: input.plan_sha256,
      facts_digest: input.facts_digest,
      original_source_digest: input.original_source_digest,
      target_source_digest: input.target_source_digest,
      expected_snapshot_id: input.expected_snapshot_id,
      native_plan: input.native_plan,
      original_closure: this.#closure(input.original_closure),
      target_closure: this.#closure(input.target_closure),
      stage_root: input.stage_root,
      backup_token: input.backup_token,
      execution: input.execution,
    };
  }

  #facts(fact: CreatedAdoptionFact): Record<string, unknown> {
    return {
      project_id: fact.project_id,
      prepared_source_id: fact.prepared_source_id,
      impact_id: fact.impact_id,
      approval_id: fact.approval_id,
      plan_sha256: fact.plan_sha256,
      facts_digest: fact.facts_digest,
      original_source_digest: fact.original_source_digest,
      target_source_digest: fact.target_source_digest,
      expected_snapshot_id: fact.expected_snapshot_id,
      native_plan: fact.native_plan,
      original_closure: fact.original_closure,
      target_closure: fact.target_closure,
      stage_root: fact.stage_root,
      backup_token: fact.backup_token,
      execution: fact.execution,
    };
  }

  #sourceFacts(fact: CreatedSourceFactV1): Record<string, unknown> {
    return {
      project_id: fact.project_id,
      snapshot_id: fact.snapshot_id,
      source_digest: fact.source_digest,
      transaction_id: fact.transaction_id,
      prepared_source_id: fact.prepared_source_id,
      impact_id: fact.impact_id,
      approval_id: fact.approval_id,
      plan_sha256: fact.plan_sha256,
      facts_digest: fact.facts_digest,
      revision: fact.revision,
      execution: fact.execution,
    };
  }
}
