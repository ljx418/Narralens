import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "../api-error.js";
import type { RevisionStore } from "../projects/revision-store.js";
import type { OperationIdempotencyStore } from "../projects/operation-idempotency-store.js";
import { canonicalJson } from "../engine/source-digest-v1.js";
import { computeImpactHash, isExpired, sortImpactArrays, verifyImpactHash } from "./impact-canonical.js";
import type { ControlledOperation, ImpactSpecV1 } from "../../contracts/wave2-types.js";

/**
 * ImpactStore (ADR-W2.0-004 §4).
 *
 * Additive, in the same SQLite connection as everything else. There is no second database,
 * no second revision scale and no `schema_migration` bookkeeping: an old database that has
 * never seen an impact simply gains this table on open and keeps every row it had.
 *
 * Two things are deliberately *not* here:
 *
 * - No `idempotency_key` column. The key's authority is `operation_idempotency`, and a
 *   second unique constraint on the same key would be a second answer to "has this request
 *   been made", which is the failure ADR-W2.0-004 §2 and §4 both name. `request_digest` is
 *   kept because it is what binds a stored spec to the request that produced it, which is a
 *   different question from replay lookup.
 * - No `writeImpactAndResponse`. Creating the row and recording the idempotent response must
 *   be one transaction, and `RevisionStore.atomic` is not reentrant, so the caller owns the
 *   transaction and uses `insert` plus `OperationIdempotencyStore.record` inside it. The
 *   fault-injection tests hold that seam directly.
 *
 * The state machine is `active -> consumed | expired | stale` and nothing else, enforced
 * both by a `CHECK` (so an unknown state cannot be written by SQL) and by the predecessor
 * in the `WHERE` clause of every update (so two writers cannot both move one row).
 */

export type ImpactState = "active" | "consumed" | "expired" | "stale";

/** The only transitions. M4A creates `active` and never leaves it by itself. */
export const ALLOWED_IMPACT_TRANSITIONS: Readonly<Record<string, true>> = Object.freeze({
  "active->consumed": true, "active->expired": true, "active->stale": true,
});

export interface ImpactRow {
  readonly impact_id: string;
  readonly project_id: string;
  readonly operation: ControlledOperation;
  readonly reference_id: string;
  readonly base_revision: number;
  readonly source_digest: string;
  readonly control_revision: number;
  readonly rights_digest: string;
  readonly native_plan_sha256: string;
  readonly request_digest: string;
  readonly canonical_json: string;
  readonly impact_hash: string;
  readonly state: ImpactState;
  readonly expires_at: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface NewImpact {
  readonly impactId: string;
  readonly projectId: string;
  readonly operation: ControlledOperation;
  /** `materialization_id` for adopt, `target_snapshot_id` for restore. */
  readonly referenceId: string;
  readonly requestDigest: string;
  readonly spec: ImpactSpecV1;
  readonly now: Date;
}

export interface CreatedImpact {
  readonly impact_id: string;
  readonly response: ImpactSpecV1;
}

export class ImpactStore {
  readonly #db: DatabaseSync;
  readonly #revisions: RevisionStore;

  constructor(revisions: RevisionStore, operations: OperationIdempotencyStore) {
    // `operations` is taken so the store can be composed only alongside the shared authority
    // and so its table is created exactly once per connection, but the writes go through the
    // caller's `commit` callback: the row and the response belong to the caller's transaction,
    // not to this one.
    void operations;
    this.#revisions = revisions;
    this.#db = revisions.compose((db) => db);
    this.#migrate();
  }

  /** The operation kinds that may appear in `operation_idempotency` for an impact. */
  static operationKindFor(operation: ControlledOperation): string {
    return `impact.${operation}`;
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS impact (
        impact_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('adopt_materialization','restore_snapshot')),
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
    `);
  }

  /**
   * Create the impact row and its idempotent response in one transaction.
   *
   * The single permitted side effect of an impact request: exactly two rows, on the same
   * connection, committed together or not at all. The transaction is opened here and passed
   * `commit` a callback that writes the response through the shared authority, so a caller
   * cannot accidentally nest a second `BEGIN` and orphan one of the two rows.
   */
  create(input: NewImpact, commit: (spec: ImpactSpecV1) => void): CreatedImpact {
    return this.#revisions.atomic(() => {
      const at = input.now.toISOString();
      const { impact_hash, ...rest } = input.spec;
      // The stored canonical bytes are the hash's own preimage, so "the stored JSON" and
      // "what was hashed" cannot be two different things. `sortImpactArrays` is applied here
      // rather than trusted from the caller, so the row is self-describing even if a future
      // caller forgets to sort.
      const canonical = canonicalJson(sortImpactArrays(rest));
      this.#db.prepare(`INSERT INTO impact(
        impact_id, project_id, operation, reference_id, base_revision, source_digest,
        control_revision, rights_digest, native_plan_sha256, request_digest, canonical_json,
        impact_hash, state, expires_at, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`)
        .run(input.impactId, input.projectId, input.operation, input.referenceId,
          input.spec.base_revision, input.spec.source_digest, input.spec.control_revision,
          input.spec.rights_digest, input.spec.native_plan_sha256, input.requestDigest,
          canonical, impact_hash, input.spec.expires_at, at, at);
      commit(input.spec);
      return { impact_id: input.impactId, response: input.spec };
    });
  }

  get(impactId: string): ImpactRow | undefined {
    const row = this.#db.prepare("SELECT * FROM impact WHERE impact_id=?").get(impactId) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : toRow(row);
  }

  /** Look up by hash within a project; the `UNIQUE(project_id, impact_hash)` makes it unique. */
  byHash(projectId: string, impactHash: string): ImpactRow | undefined {
    const row = this.#db.prepare("SELECT * FROM impact WHERE project_id=? AND impact_hash=?")
      .get(projectId, impactHash) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : toRow(row);
  }

  byProject(projectId: string): ImpactRow[] {
    return (this.#db.prepare("SELECT * FROM impact WHERE project_id=? ORDER BY created_at, impact_id")
      .all(projectId) as Array<Record<string, unknown>>).map(toRow);
  }

  /**
   * The predecessor-checked transition. There is no `recover`-style back door: a row moves
   * only from `active` and only to a state the machine allows, so a row can be neither
   * resurrected nor skipped past.
   */
  transition(impactId: string, from: ImpactState, to: ImpactState, now = new Date()): ImpactRow {
    if (ALLOWED_IMPACT_TRANSITIONS[`${from}->${to}`] !== true) {
      throw new Error(`INVALID_IMPACT_TRANSITION:${from}->${to}`);
    }
    const result = this.#db.prepare("UPDATE impact SET state=?, updated_at=? WHERE impact_id=? AND state=?")
      .run(to, now.toISOString(), impactId, from);
    if (Number(result.changes) !== 1) throw new Error(`INVALID_IMPACT_TRANSITION:${from}->${to}`);
    // `require`, not `get(…)!`: the CAS above already proved the row exists, so this is free,
    // and it turns a hypothetical break of that invariant into a 404 rather than an undefined
    // deref inside the caller.
    return this.require(impactId);
  }

  /**
   * Move to `expired` only if it is genuinely past its deadline; never before.
   *
   * `now` is required rather than defaulted. A default of `new Date()` would make the TTL
   * quietly machine-time-dependent for any caller that forgets the argument, which is the
   * opposite of what an injected clock is for.
   */
  markExpired(impactId: string, now: Date): ImpactRow {
    const row = this.require(impactId);
    // Two guards, both needed. Past the deadline but already terminal is not a second
    // transition to make — `stale -> expired` is not in the machine — and before the
    // deadline nothing is expired at all. Idempotent for the same reason `markStale` is:
    // two readers noticing the same drift is normal.
    if (!isExpired(row.expires_at, now) || row.state !== "active") return row;
    return this.transition(impactId, "active", "expired", now);
  }

  /**
   * Move to `stale`, or return the row unchanged if it is already terminal.
   *
   * This is what makes an inserted-then-invalidated impact honest: a consumer that finds
   * the premises moved gets its state corrected rather than an `active` flag it might
   * otherwise trust. Idempotent on purpose, because two consumers noticing the same drift
   * is normal and neither should get an error for having noticed.
   */
  markStale(impactId: string, now = new Date()): ImpactRow {
    const row = this.require(impactId);
    if (row.state !== "active") return row;
    return this.transition(impactId, "active", "stale", now);
  }

  require(impactId: string): ImpactRow {
    const row = this.get(impactId);
    if (row === undefined) throw new HttpError(404, "NOT_FOUND", "Impact not found");
    return row;
  }

  /**
   * Read a stored impact back as the spec it promised, or refuse.
   *
   * Three independent ways this can be dead, and all three are checked: the row's state, the
   * recomputed hash against the stored bytes (so a row edited in place is caught), and the
   * TTL against the injected clock. None of them consults a caller's opinion.
   */
  requireActive(impactId: string, now: Date): ImpactSpecV1 {
    const row = this.require(impactId);
    if (row.state !== "active") {
      throw new HttpError(428, "IMPACT_STALE",
        `The impact is ${row.state} and can no longer authorise a write`,
        { impact_id: impactId, state: row.state });
    }
    // Parsing and verification are one fail-closed step. Bytes that are not a spec — a row
    // edited into `{}`, truncated by a bad migration — make `canonicalJson` throw a
    // TypeError, and a TypeError out of this function would be a 500 for a row that is
    // exactly as unusable as an expired one. Anything that goes wrong here is a hash
    // mismatch, which is what it is.
    const spec = parseAndVerify(row);
    if (spec === undefined) {
      throw new HttpError(428, "IMPACT_STALE",
        "The stored impact does not match its own hash", { impact_id: impactId });
    }
    if (isExpired(row.expires_at, now)) {
      throw new HttpError(428, "IMPACT_STALE",
        "The impact has expired", { impact_id: impactId });
    }
    return spec;
  }
}

/** The stored bytes as a spec, or `undefined` when they are not one that hashes to `impact_hash`. */
function parseAndVerify(row: ImpactRow): ImpactSpecV1 | undefined {
  let parsed: Omit<ImpactSpecV1, "impact_hash">;
  try {
    parsed = JSON.parse(row.canonical_json) as Omit<ImpactSpecV1, "impact_hash">;
  } catch { return undefined; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const spec = { ...parsed, impact_hash: row.impact_hash } as ImpactSpecV1;
  try { return verifyImpactHash(spec) ? spec : undefined; } catch { return undefined; }
}

function toRow(row: Record<string, unknown>): ImpactRow {
  return {
    impact_id: String(row.impact_id), project_id: String(row.project_id),
    operation: String(row.operation) as ControlledOperation, reference_id: String(row.reference_id),
    base_revision: Number(row.base_revision), source_digest: String(row.source_digest),
    control_revision: Number(row.control_revision), rights_digest: String(row.rights_digest),
    native_plan_sha256: String(row.native_plan_sha256), request_digest: String(row.request_digest),
    canonical_json: String(row.canonical_json), impact_hash: String(row.impact_hash),
    state: String(row.state) as ImpactState, expires_at: String(row.expires_at),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

export { computeImpactHash };
