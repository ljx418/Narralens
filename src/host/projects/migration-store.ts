import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  MigrationPlanV1, MigrationReportV1, MigrationState, MigrationStepId,
  MigrationStepRecord, RollbackRecord,
} from "../../contracts/migration-types.js";

/**
 * Migration store (M2.3 plan §2, §5).
 *
 * A migration is a durable fact with one authoritative state machine, exactly like the
 * coordinator's. Transitions carry their predecessor, so a crash or a racing writer can
 * never leave two steps believing they both happened.
 *
 * The tables live in the project's existing database: no second store, no second
 * revision scale, no second timeline.
 */

const FORWARD: readonly MigrationState[] = [
  "staged", "validated", "snapshot_published", "committed", "activated", "reported",
];
const ABORTABLE: readonly MigrationState[] = [
  "plan_written", "staged", "validated", "snapshot_published", "committed", "activated",
];
const TERMINAL: readonly MigrationState[] = ["aborted", "attention", "reported"];

const RECOVERABLE_FROM: readonly MigrationState[] = [
  "plan_written", "staged", "validated", "snapshot_published", "committed", "activated",
];

const TRANSITION_KEYS: readonly string[] = [
  ...FORWARD.map((to, index): string => `${index === 0 ? "plan_written" : FORWARD[index - 1]}->${to}`),
  ...ABORTABLE.flatMap((from): string[] => [`${from}->aborted`, `${from}->attention`]),
  ...RECOVERABLE_FROM.map((from): string => `${from}->recovering`),
];

export const ALLOWED_MIGRATION_TRANSITIONS: Readonly<Record<string, true>> = Object.freeze(
  Object.fromEntries(TRANSITION_KEYS.map((key): [string, true] => [key, true])));

export interface MigrationRow {
  readonly migration_id: string;
  readonly project_id: string;
  readonly state: MigrationState;
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly plan_json: string;
  readonly target_project_id: string;
  readonly source_sha256_before: string;
  readonly target_snapshot_id: string | null;
  readonly target_source_digest: string | null;
  readonly rollback_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface NewMigration {
  readonly migrationId: string;
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly plan: MigrationPlanV1;
  readonly sourceSha256Before: string;
  readonly now?: Date;
}

export class MigrationStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS migration (
        migration_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL, plan_json TEXT NOT NULL,
        target_project_id TEXT NOT NULL, source_sha256_before TEXT NOT NULL,
        target_snapshot_id TEXT, target_source_digest TEXT,
        rollback_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (project_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS migration_step (
        migration_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL,
        artifact_sha256 TEXT, at TEXT NOT NULL, PRIMARY KEY (migration_id, id)
      );
      CREATE INDEX IF NOT EXISTS migration_step_by_migration ON migration_step (migration_id);
    `);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────

  create(input: NewMigration): MigrationRow {
    const at = (input.now ?? new Date()).toISOString();
    this.#db.prepare(`INSERT INTO migration(
      migration_id, project_id, state, idempotency_key, request_digest, plan_json,
      target_project_id, source_sha256_before, rollback_json, created_at, updated_at)
      VALUES(?,?,'plan_written',?,?,?,?,?,NULL,?,?)`)
      .run(input.migrationId, input.projectId, input.idempotencyKey, input.requestDigest,
        JSON.stringify(input.plan), input.plan.target_project_id, input.sourceSha256Before, at, at);
    this.recordStep(input.migrationId, { id: "plan", status: "done",
      detail: `plan written for ${input.projectId} -> ${input.plan.target_project_id}`,
      artifact_sha256: input.requestDigest, at });
    return this.require(input.migrationId)!;
  }

  /** The only writer of `migration.state`. */
  transition(migrationId: string, from: MigrationState, to: MigrationState, now = new Date()): MigrationRow {
    if (ALLOWED_MIGRATION_TRANSITIONS[`${from}->${to}`] !== true) {
      throw new Error(`INVALID_MIGRATION_TRANSITION:${from}->${to}`);
    }
    const result = this.#db.prepare("UPDATE migration SET state=?, updated_at=? WHERE migration_id=? AND state=?")
      .run(to, now.toISOString(), migrationId, from);
    if (Number(result.changes) !== 1) throw new Error(`INVALID_MIGRATION_TRANSITION:${from}->${to}`);
    return this.require(migrationId)!;
  }

  /** Recovery is written by recovery code only; `transition` cannot reach it. */
  markRecovering(migrationId: string, reason: string, now = new Date()): MigrationRow {
    const from = ["plan_written", "staged", "validated", "snapshot_published", "committed", "activated"];
    const placeholders = from.map(() => "?").join(",");
    const result = this.#db.prepare(`UPDATE migration SET state='recovering', updated_at=?
      WHERE migration_id=? AND state IN (${placeholders})`).run(now.toISOString(), migrationId, ...from);
    if (Number(result.changes) !== 1) throw new Error("INVALID_MIGRATION_TRANSITION:->recovering");
    this.recordStep(migrationId, { id: "report", status: "failed", detail: `recovery required: ${reason}`,
      artifact_sha256: null, at: now.toISOString() });
    return this.require(migrationId)!;
  }

  recordStep(migrationId: string, step: MigrationStepRecord): void {
    this.#db.prepare(`INSERT INTO migration_step(migration_id, id, status, detail, artifact_sha256, at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(migration_id, id) DO UPDATE SET
        status=excluded.status, detail=excluded.detail,
        artifact_sha256=excluded.artifact_sha256, at=excluded.at`)
      .run(migrationId, step.id, step.status, step.detail, step.artifact_sha256, step.at);
  }

  steps(migrationId: string): MigrationStepRecord[] {
    return (this.#db.prepare("SELECT * FROM migration_step WHERE migration_id=? ORDER BY at, id").all(migrationId) as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id) as MigrationStepId, status: String(row.status) as MigrationStepRecord["status"],
        detail: String(row.detail), artifact_sha256: row.artifact_sha256 === null ? null : String(row.artifact_sha256),
        at: String(row.at),
      }));
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────

  get(migrationId: string): MigrationRow | undefined { return this.#select("migration_id", migrationId); }

  require(migrationId: string): MigrationRow | undefined { return this.get(migrationId); }

  byIdempotencyKey(projectId: string, key: string): MigrationRow | undefined {
    return this.#select("project_id = ? AND idempotency_key = ?", projectId, key);
  }

  all(): MigrationRow[] {
    return (this.#db.prepare("SELECT * FROM migration ORDER BY created_at").all() as Array<Record<string, unknown>>)
      .map(migrationRow);
  }

  /** Migrations a crash left unfinished, so recovery can decide them one at a time. */
  incomplete(): MigrationRow[] {
    return (this.#db.prepare(`SELECT * FROM migration
      WHERE state IN ('plan_written','staged','validated','snapshot_published','committed','activated','recovering','attention')
      ORDER BY created_at`).all() as Array<Record<string, unknown>>).map(migrationRow);
  }

  isTerminal(state: MigrationState): boolean { return TERMINAL.includes(state); }

  // ── report and rollback ─────────────────────────────────────────────────────────────

  /**
   * A plan is immutable once written, so the published snapshot is recorded on the
   * migration instead of being written back into the plan.
   */
  setTargetSnapshot(migrationId: string, snapshotId: string, sourceDigest: string, now = new Date()): void {
    this.#db.prepare("UPDATE migration SET target_snapshot_id=?, target_source_digest=?, updated_at=? WHERE migration_id=?")
      .run(snapshotId, sourceDigest, now.toISOString(), migrationId);
  }

  targetSnapshot(migrationId: string): { snapshotId: string | null; sourceDigest: string | null } {
    const row = this.require(migrationId);
    if (row === undefined) return { snapshotId: null, sourceDigest: null };
    return { snapshotId: row.target_snapshot_id, sourceDigest: row.target_source_digest };
  }

  setRollback(migrationId: string, record: RollbackRecord, now = new Date()): void {
    this.#db.prepare("UPDATE migration SET rollback_json=?, updated_at=? WHERE migration_id=?")
      .run(JSON.stringify(record), now.toISOString(), migrationId);
  }

  rollback(migrationId: string): RollbackRecord | undefined {
    const row = this.require(migrationId);
    if (row === undefined || row.rollback_json === null) return undefined;
    return JSON.parse(row.rollback_json) as RollbackRecord;
  }

  plan(migrationId: string): MigrationPlanV1 | undefined {
    const row = this.require(migrationId);
    return row === undefined ? undefined : JSON.parse(row.plan_json) as MigrationPlanV1;
  }

  /** Build the report from durable facts only; nothing here is remembered in memory. */
  report(migrationId: string, extras: {
    sourceAfterSha256: string; targetSnapshotId: string | null; targetSourceDigest: string | null;
    targetClips: MigrationReportV1["target_clips"]; exportArtifacts: MigrationReportV1["export_artifacts"];
    blocking: readonly string[]; now?: Date;
  }): MigrationReportV1 {
    const row = this.require(migrationId);
    if (row === undefined) throw new Error(`MIGRATION_NOT_FOUND:${migrationId}`);
    const plan = JSON.parse(row.plan_json) as MigrationPlanV1;
    const rollback = row.rollback_json === null ? null : JSON.parse(row.rollback_json) as RollbackRecord;
    const steps = this.steps(migrationId);
    const complete = row.state === "reported" && steps.every((step) => step.status === "done");
    const blocking = [...plan.blocking, ...extras.blocking];
    return {
      format: "narralens.migration-report@1.0", migration_id: migrationId, state: row.state,
      plan, steps, complete,
      source_before_sha256: row.source_sha256_before, source_after_sha256: extras.sourceAfterSha256,
      target_snapshot_id: extras.targetSnapshotId, target_source_digest: extras.targetSourceDigest,
      target_clips: extras.targetClips, export_artifacts: extras.exportArtifacts,
      rollback, blocking, updated_at: (extras.now ?? new Date()).toISOString(),
    };
  }

  #select(where: string, ...values: SQLInputValue[]): MigrationRow | undefined {
    const row = this.#db.prepare(`SELECT * FROM migration WHERE ${where}`).get(...values) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : migrationRow(row);
  }
}

function migrationRow(row: Record<string, unknown>): MigrationRow {
  return {
    migration_id: String(row.migration_id), project_id: String(row.project_id),
    state: String(row.state) as MigrationState, idempotency_key: String(row.idempotency_key),
    request_digest: String(row.request_digest), plan_json: String(row.plan_json),
    target_project_id: String(row.target_project_id),
    source_sha256_before: String(row.source_sha256_before),
    target_snapshot_id: row.target_snapshot_id === null || row.target_snapshot_id === undefined ? null : String(row.target_snapshot_id),
    target_source_digest: row.target_source_digest === null || row.target_source_digest === undefined ? null : String(row.target_source_digest),
    rollback_json: row.rollback_json === null || row.rollback_json === undefined ? null : String(row.rollback_json),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}
