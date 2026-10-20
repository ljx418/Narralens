import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MigrationStore } from "./migration-store.js";
import { JOB_TABLE_DDL, migrateJobKind } from "./job-kind-migration.js";
import type { ApiError, AssetImportResponse, EditResponse, JobEvent, JobState } from "../../contracts/types.js";
import type { ControlledWriteFailureResponseV1, ControlledWriteResponseV1 } from "../../contracts/wave2-types.js";
import { HttpError } from "../api-error.js";

export type JournalState = "prepared" | "source_validated" | "metadata_committed" | "aborted" | "compensated" | "attention";

export interface JournalRecord {
  transaction_id: string;
  project_id: string;
  correlation_id: string;
  state: JournalState;
  request_json: string;
  request_hash: string;
  base_revision: number;
  authoring_id: string;
  before_fit: string;
  target_fit: string;
  source_before: string;
  run_before: string;
  narration_before: string;
  semantic_before: string;
  source_path: string;
  source_expected: string;
  studio_revision_before: number;
  compensation_attempt: number;
  manifest_sha?: string;
}

export type ProjectTransactionState =
  "received" | "preconditions_checked" | "staged" | "validated" | "prepared" | "committed"
  | "aborted" | "recovering" | "attention";

export type ProjectTransactionKind = "edit" | "asset_import" | "lock" | "history" | "snapshot_publish";

export interface ProjectTransactionRow {
  transaction_id: string; project_id: string; state: ProjectTransactionState; kind: ProjectTransactionKind;
  correlation_id: string; request_json: string; request_hash: string; base_revision: number;
  source_digest_before: string; source_digest_after: string; snapshot_id: string;
  error_code: string; terminal_reason: string; created_at: string; updated_at: string;
}

export type BeginTransactionInput = Pick<ProjectTransactionRow,
  "transaction_id" | "project_id" | "kind" | "correlation_id" | "request_json" | "request_hash" | "base_revision">
  & { createdAt?: Date | undefined };

export interface JobRow {
  job_id: string; project_id: string; kind: string; payload_digest: string; state: JobState;
  lease_owner: string | null; lease_expires_at: number | null; attempt: number; max_attempts: number;
  cost_status: "unknown" | "known";
  proposal_id: string | null; comparison_id: string | null; error_json: string | null;
  quarantined_artifact_json: string | null; quarantined_receipt_json: string | null;
  created_at: string; updated_at: string; terminal_reason: string;
}

export interface JobEventRecord {
  event_id: number; job_id: string; seq: number; type: JobState; at: string;
  message?: string; proposal_id?: string; comparison_id?: string; error?: { code: string; message: string };
}

function jobRow(row: Record<string, unknown>): JobRow {
  return {
    job_id: String(row.job_id), project_id: String(row.project_id), kind: String(row.kind),
    payload_digest: String(row.payload_digest), state: String(row.state) as JobState,
    lease_owner: row.lease_owner === null || row.lease_owner === undefined ? null : String(row.lease_owner),
    lease_expires_at: row.lease_expires_at === null || row.lease_expires_at === undefined ? null : Number(row.lease_expires_at),
    attempt: Number(row.attempt), max_attempts: Number(row.max_attempts),
    cost_status: String(row.cost_status) as "unknown" | "known",
    proposal_id: row.proposal_id === null || row.proposal_id === undefined ? null : String(row.proposal_id),
    comparison_id: row.comparison_id === null || row.comparison_id === undefined ? null : String(row.comparison_id),
    error_json: row.error_json === null || row.error_json === undefined ? null : String(row.error_json),
    quarantined_artifact_json: row.quarantined_artifact_json === null || row.quarantined_artifact_json === undefined
      ? null : String(row.quarantined_artifact_json),
    quarantined_receipt_json: row.quarantined_receipt_json === null || row.quarantined_receipt_json === undefined
      ? null : String(row.quarantined_receipt_json),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
    terminal_reason: String(row.terminal_reason ?? ""),
  };
}

export interface EngineLockRecord {
  lock_id: string; project_id: string; lock_type: string; scope: string; target_id: string;
  start_frame: number; end_frame_exclusive: number; owner: string; reason: string;
  control_revision: number; active: boolean;
}

function engineLock(row: Record<string, unknown>): EngineLockRecord {
  return {
    lock_id: String(row.lock_id), project_id: String(row.project_id), lock_type: String(row.lock_type),
    scope: String(row.scope), target_id: String(row.target_id ?? ""),
    start_frame: Number(row.start_frame), end_frame_exclusive: Number(row.end_frame_exclusive),
    owner: String(row.owner ?? ""), reason: String(row.reason ?? ""),
    control_revision: Number(row.control_revision), active: Boolean(row.active),
  };
}

export interface EngineBindingRecord {
  project_id: string; engine: string; engine_upstream_sha: string;
  binding_version: number; created_at: string; migrated_from: string | null;
}

export interface AdoptionLedgerRow {
  asset_id: string; migration_id: string; source_project_id: string;
  source_manifest_sha256: string; source_path: string; target_path: string;
  source_sha256: string; target_sha256: string; duration_frames: number;
  media_type: string; source_json: string; license_json: string;
}

export interface AdoptionProjectionFactInput {
  migration_id: string; engine_upstream_sha: string; roots_json: string;
  subtitles_json: string; frame_count: number;
}

const FORWARD = ["preconditions_checked", "staged", "validated", "prepared", "committed"] as const;
const ABORTABLE = ["received", "preconditions_checked", "staged", "validated", "prepared"] as const;
const RECOVERABLE_FROM = ["received", "preconditions_checked", "staged"] as const;

const TRANSITION_KEYS: readonly string[] = [
  ...FORWARD.map((to, index): string => `${index === 0 ? "received" : FORWARD[index - 1]}->${to}`),
  ...ABORTABLE.flatMap((from): string[] => [`${from}->aborted`, `${from}->attention`]),
];

/** Every legal predecessor/successor pair. Nothing outside this map may be written. */
export const ALLOWED_TRANSITIONS: Readonly<Record<string, true>> = Object.freeze(
  Object.fromEntries(TRANSITION_KEYS.map((key): [string, true] => [key, true])));

const JOURNAL_COLUMNS = {
  edit_journal: ["transaction_id", "project_id", "correlation_id", "state", "request_json", "request_hash",
    "base_revision", "authoring_id", "before_fit", "target_fit", "source_before", "run_before",
    "narration_before", "semantic_before", "source_path", "source_expected", "studio_revision_before",
    "compensation_attempt", "manifest_sha", "error_code", "created_at", "updated_at"],
  asset_import_journal: ["transaction_id", "project_id", "correlation_id", "idempotency_key", "request_hash",
    "state", "asset_id", "bytes_sha", "manifest_before_sha", "manifest_after_sha", "manifest_before_json",
    "manifest_after_json", "bytes_created", "response_status", "response_json", "error_code", "created_at", "updated_at"],
} as const;

function projectTransaction(row: Record<string, unknown>): ProjectTransactionRow {
  return {
    transaction_id: String(row.transaction_id), project_id: String(row.project_id),
    state: String(row.state) as ProjectTransactionState, kind: String(row.kind) as ProjectTransactionKind,
    correlation_id: String(row.correlation_id ?? ""), request_json: String(row.request_json ?? ""),
    request_hash: String(row.request_hash ?? ""), base_revision: Number(row.base_revision ?? 0),
    source_digest_before: String(row.source_digest_before ?? ""),
    source_digest_after: String(row.source_digest_after ?? ""),
    snapshot_id: String(row.snapshot_id ?? ""), error_code: String(row.error_code ?? ""),
    terminal_reason: String(row.terminal_reason ?? ""),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

export type AssetImportJournalState = "prepared" | "bytes_installed" | "manifest_published"
  | "committed" | "aborted" | "compensated" | "attention";

export interface AssetImportJournalRecord {
  transaction_id: string;
  project_id: string;
  correlation_id: string;
  idempotency_key: string;
  request_hash: string;
  state: AssetImportJournalState;
  asset_id: string;
  bytes_sha: string;
  manifest_before_sha: string;
  manifest_after_sha: string;
  manifest_before_json: string;
  manifest_after_json: string;
  bytes_created: boolean;
  response_status?: number;
  response_json?: string;
  error_code?: string;
}

export class RevisionStore {
  readonly #db: DatabaseSync;
  /** M2.3 migration facts live in this same database, never a second one. */
  readonly migrations: MigrationStore;

  constructor(path = ":memory:") {
    this.#db = new DatabaseSync(path);
    this.migrations = new MigrationStore(this.#db);
    this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS project_state (
        project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, visual_locked INTEGER NOT NULL DEFAULT 0,
        attention INTEGER NOT NULL DEFAULT 0,
        source_digest TEXT NOT NULL DEFAULT '',
        source_digest_observed TEXT NOT NULL DEFAULT '',
        source_digest_detected_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS edit_journal (
        transaction_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, correlation_id TEXT NOT NULL,
        state TEXT NOT NULL, request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
        base_revision INTEGER NOT NULL, authoring_id TEXT NOT NULL, before_fit TEXT NOT NULL,
        target_fit TEXT NOT NULL, source_before TEXT NOT NULL, run_before TEXT NOT NULL,
        narration_before TEXT NOT NULL, semantic_before TEXT NOT NULL, source_path TEXT NOT NULL,
        source_expected TEXT NOT NULL, studio_revision_before INTEGER NOT NULL,
        compensation_attempt INTEGER NOT NULL DEFAULT 0, manifest_sha TEXT NOT NULL DEFAULT '', error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS edit_idempotency (
        project_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL, PRIMARY KEY(project_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS revision_event (
        project_id TEXT NOT NULL, revision INTEGER NOT NULL, transaction_id TEXT NOT NULL,
        changed INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, revision, transaction_id)
      );
      CREATE TABLE IF NOT EXISTS asset_import_journal (
        transaction_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, correlation_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, state TEXT NOT NULL,
        asset_id TEXT NOT NULL, bytes_sha TEXT NOT NULL, manifest_before_sha TEXT NOT NULL,
        manifest_after_sha TEXT NOT NULL, manifest_before_json TEXT NOT NULL, manifest_after_json TEXT NOT NULL,
        bytes_created INTEGER NOT NULL DEFAULT 0, response_status INTEGER, response_json TEXT,
        error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, idempotency_key)
      );
    `);
    const columns = this.#db.prepare("PRAGMA table_info(edit_journal)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "manifest_sha")) {
      this.#db.exec("ALTER TABLE edit_journal ADD COLUMN manifest_sha TEXT NOT NULL DEFAULT ''");
    }
    const stateColumns = this.#db.prepare("PRAGMA table_info(project_state)").all() as Array<{ name: string }>;
    // Text columns and the counter are added separately: control_revision takes part in
    // comparisons, so it must be INTEGER and must never be stored as TEXT (M2.2 plan §2).
    for (const column of ["source_digest", "source_digest_observed", "source_digest_detected_at",
      "attention_reason"]) {
      if (!stateColumns.some((existing) => existing.name === column)) {
        this.#db.exec(`ALTER TABLE project_state ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
      }
    }
    if (!stateColumns.some((existing) => existing.name === "control_revision")) {
      this.#db.exec("ALTER TABLE project_state ADD COLUMN control_revision INTEGER NOT NULL DEFAULT 0");
    }
    // M2.2 durable layer. One database, no second revision scale, no second timeline.
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS project_transaction (
        transaction_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('edit','asset_import','lock','history','snapshot_publish')),
        correlation_id TEXT NOT NULL DEFAULT '', request_json TEXT NOT NULL DEFAULT '{}',
        request_hash TEXT NOT NULL DEFAULT '', base_revision INTEGER NOT NULL DEFAULT 0,
        source_digest_before TEXT NOT NULL DEFAULT '', source_digest_after TEXT NOT NULL DEFAULT '',
        snapshot_id TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '',
        terminal_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_transaction_by_project
        ON project_transaction (project_id, created_at);
      CREATE TABLE IF NOT EXISTS snapshot (
        snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_digest TEXT NOT NULL,
        engine TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS active_commit (
        project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, snapshot_id TEXT NOT NULL,
        source_digest TEXT NOT NULL, engine TEXT NOT NULL, transaction_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_lock (
        lock_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        lock_type TEXT NOT NULL CHECK (lock_type IN ('visual','narration','duration')),
        scope TEXT NOT NULL CHECK (scope IN ('project','shot')),
        target_id TEXT NOT NULL DEFAULT '', start_frame INTEGER NOT NULL DEFAULT 0,
        end_frame_exclusive INTEGER NOT NULL DEFAULT 0, owner TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '', control_revision INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_lock_by_project ON project_lock (project_id, active);
      -- The job definition is shared with the forward migration, so a fresh database and a
      -- migrated one cannot drift apart: error_json is carried here so GET /api/jobs/:id
      -- keeps the error the legacy in-memory store returned.
      ${JOB_TABLE_DDL.replace("CREATE TABLE job (", "CREATE TABLE IF NOT EXISTS job (")};
      CREATE TABLE IF NOT EXISTS job_event (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, seq INTEGER NOT NULL,
        type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        UNIQUE (job_id, seq)
      );
      CREATE TABLE IF NOT EXISTS outbox (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0, terminal_reason TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS outbox_delivery (
        event_id INTEGER NOT NULL, consumer TEXT NOT NULL, delivered_at TEXT NOT NULL,
        PRIMARY KEY (event_id, consumer)
      );
      -- M2.1 put this in its own file; M2.2 folds it into the one database.
      CREATE TABLE IF NOT EXISTS engine_binding (
        project_id TEXT PRIMARY KEY, engine TEXT NOT NULL CHECK (engine IN ('hypit','openfilm')),
        engine_upstream_sha TEXT NOT NULL, binding_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, migrated_from TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS engine_binding_single_active
        ON engine_binding (project_id) WHERE project_id IS NOT NULL;
    `);
    // W2.0's one permitted table migration runs *after* the tables exist, so a brand-new
    // database is already at version 2 by construction and a legacy one is migrated in
    // place. Running it before creation is what left fresh databases on the old CHECK.
    // It throws rather than repairing itself if a recorded migration cannot be verified.
    migrateJobKind(this.#db, path);
  }

  /**
   * Composes a store over *this* connection.
   *
   * Wave 2 adds stores that must live in the same database. Handing out the handle rather
   * than letting each store open its own is what keeps "one SQLite, one revision scale"
   * true by construction instead of by review; `tests/wave2` asserts that no other
   * production module constructs a `DatabaseSync`.
   */
  compose<T>(factory: (db: DatabaseSync) => T): T { return factory(this.#db); }

  atomic<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  // ── M2.2: one authoritative transaction machine, predecessor-checked everywhere ───────

  /**
   * The only place `project_transaction.state` is written. The predecessor is part of the
   * WHERE clause, so a racing or stale writer cannot both succeed and no caller can write a
   * state without naming where it came from (M2.2 plan §3).
   */
  transition(transactionId: string, from: ProjectTransactionState, to: ProjectTransactionState,
    patch: Partial<Pick<ProjectTransactionRow, "error_code" | "terminal_reason" | "snapshot_id"
      | "source_digest_before" | "source_digest_after">> = {}, now = new Date()): ProjectTransactionRow {
    if (ALLOWED_TRANSITIONS[`${from}->${to}`] !== true) throw new Error(`INVALID_TRANSITION:${from}->${to}`);
    const at = now.toISOString();
    // Only named columns are written: a stage that does not mention one must not blank a
    // value an earlier stage recorded.
    const named = Object.entries(patch).filter(([, value]) => value !== undefined);
    const assignments = ["state=?", ...named.map(([column]) => `${column}=?`), "updated_at=?"];
    this.#db.prepare(`UPDATE project_transaction SET ${assignments.join(",")}
      WHERE transaction_id=? AND state=?`)
      .run(to, ...named.map(([, value]) => value as SQLInputValue), at, transactionId, from);
    const changed = Number((this.#db.prepare("SELECT changes() AS n").get() as { n: number }).n);
    if (changed !== 1) throw new Error(`INVALID_TRANSITION:${from}->${to}`);
    return this.projectTransaction(transactionId)!;
  }

  /** The only writer of `recovering`; online `transition()` cannot reach it. */
  markRecovering(transactionId: string, terminalReason = "CRASH_RECOVERY_REQUIRED", now = new Date()): ProjectTransactionRow {
    this.#db.prepare(`UPDATE project_transaction SET state='recovering', terminal_reason=?, updated_at=?
      WHERE transaction_id=? AND state IN (${RECOVERABLE_FROM.map((state) => `'${state}'`).join(",")})`)
      .run(terminalReason, now.toISOString(), transactionId);
    const changed = Number((this.#db.prepare("SELECT changes() AS n").get() as { n: number }).n);
    if (changed !== 1) throw new Error("INVALID_TRANSITION:->recovering");
    return this.projectTransaction(transactionId)!;
  }

  beginTransaction(row: BeginTransactionInput): ProjectTransactionRow {
    const at = (row.createdAt ?? new Date()).toISOString();
    this.#db.prepare(`INSERT INTO project_transaction(
      transaction_id, project_id, state, kind, correlation_id, request_json, request_hash, base_revision,
      source_digest_before, source_digest_after, snapshot_id, error_code, terminal_reason, created_at, updated_at)
      VALUES(?,?,'received',?,?,?,?,?,'','','','','',?,?)`)
      .run(row.transaction_id, row.project_id, row.kind, row.correlation_id, row.request_json,
        row.request_hash, row.base_revision, at, at);
    return this.projectTransaction(row.transaction_id)!;
  }

  projectTransaction(transactionId: string): ProjectTransactionRow | undefined {
    const row = this.#db.prepare("SELECT * FROM project_transaction WHERE transaction_id=?").get(transactionId);
    return row === undefined ? undefined : projectTransaction(row as Record<string, unknown>);
  }

  projectTransactions(projectId: string): ProjectTransactionRow[] {
    return (this.#db.prepare("SELECT * FROM project_transaction WHERE project_id=? ORDER BY created_at")
      .all(projectId) as Array<Record<string, unknown>>).map(projectTransaction);
  }

  /** Called only by the `preconditions_checked` phase, inside its transaction. */
  openJournal(table: "edit_journal" | "asset_import_journal", values: readonly SQLInputValue[]): void {
    if (table !== "edit_journal" && table !== "asset_import_journal") throw new Error(`JOURNAL_TABLE_UNKNOWN:${table}`);
    const placeholders = values.map(() => "?").join(",");
    this.#db.prepare(`INSERT OR IGNORE INTO ${table} (${JOURNAL_COLUMNS[table].join(",")}) VALUES(${placeholders})`).run(...values);
  }

  /**
   * Advance a journal state with an explicit predecessor predicate. `from` may be a list
   * because existing code legitimately reaches some states from more than one predecessor —
   * notably the no-change edit, which commits straight from `prepared`.
   */
  advanceJournal(table: "edit_journal" | "asset_import_journal", id: string, from: readonly string[], to: string,
    patch: Readonly<Record<string, string | number | null | undefined>> = {}, now = new Date()): void {
    if (table !== "edit_journal" && table !== "asset_import_journal") throw new Error(`JOURNAL_TABLE_UNKNOWN:${table}`);
    const columns = Object.keys(patch);
    const assignments = ["state=?", ...columns.map((column) => `${column}=?`), "updated_at=?"];
    const placeholders = from.map(() => "?").join(",");
    this.#db.prepare(`UPDATE ${table} SET ${assignments.join(",")} WHERE transaction_id=? AND state IN (${placeholders})`)
      .run(to, ...columns.map((column) => patch[column] ?? ""), now.toISOString(), id, ...from);
    const changed = Number((this.#db.prepare("SELECT changes() AS n").get() as { n: number }).n);
    if (changed !== 1) throw new Error(`INVALID_JOURNAL_TRANSITION:${table}:${from.join("|")}->${to}`);
  }

  /**
   * The single attention predicate, shared by `state()` and the request gate so the two can
   * never disagree about whether a project is writable (M2.2 plan §8).
   */
  recoveryGate(projectId: string, initialRevision: number, ignoredTransactionId?: string): boolean {
    void initialRevision;
    const row = this.#db.prepare("SELECT attention FROM project_state WHERE project_id=?").get(projectId) as { attention?: number } | undefined;
    return Boolean(row?.attention) || this.#projectHasPending(projectId, ignoredTransactionId);
  }

  attentionReason(projectId: string): string {
    const row = this.#db.prepare("SELECT attention_reason FROM project_state WHERE project_id=?").get(projectId) as { attention_reason?: string } | undefined;
    const reason = row?.attention_reason ?? "";
    return reason === "" ? "UNKNOWN" : reason;
  }

  controlRevision(projectId: string, initialRevision: number): number {
    this.ensureProject(projectId, initialRevision);
    const row = this.#db.prepare("SELECT control_revision FROM project_state WHERE project_id=?").get(projectId) as { control_revision?: string };
    return Number(row.control_revision ?? 0);
  }

  bumpControlRevision(projectId: string, initialRevision: number, now = new Date()): number {
    this.ensureProject(projectId, initialRevision);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("UPDATE project_state SET control_revision=CAST(control_revision AS INTEGER)+1, updated_at=? WHERE project_id=?")
        .run(now.toISOString(), projectId);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
    return this.controlRevision(projectId, initialRevision);
  }

  // ── commit pointer, outbox, leases and recovery queries (M2.2 §4/§6/§7/§8) ───────────

  /**
   * The one commit. Revision, the active commit record, the idempotency entry and the
   * outbox row move together; anything that fails rolls the whole thing back, so a reader
   * can never see a revision whose pointer was not published.
   */
  commitWithPointer(input: {
    transactionId: string; projectId: string; revision: number; snapshotId: string;
    sourceDigestAfter: string; engine: string; idempotencyKey: string; requestHash: string; response: EditResponse;
    outboxTopic: string; outboxPayload: string; now?: Date;
  }): void {
    const now = input.now ?? new Date();
    const at = now.toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare(`UPDATE project_state SET revision=?, source_digest=?,
        source_digest_observed='', source_digest_detected_at='', updated_at=? WHERE project_id=?`)
        .run(input.revision, input.sourceDigestAfter, at, input.projectId);
      this.#db.prepare(`INSERT INTO snapshot(snapshot_id, project_id, source_digest, engine, created_at)
        VALUES(?,?,?,?,?) ON CONFLICT(snapshot_id) DO NOTHING`)
        .run(input.snapshotId, input.projectId, input.sourceDigestAfter, input.engine, at);
      this.#db.prepare(`INSERT INTO active_commit(project_id, revision, snapshot_id, source_digest, engine, transaction_id, created_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
          revision=excluded.revision, snapshot_id=excluded.snapshot_id,
          source_digest=excluded.source_digest, engine=excluded.engine,
          transaction_id=excluded.transaction_id, created_at=excluded.created_at`)
        .run(input.projectId, input.revision, input.snapshotId, input.sourceDigestAfter,
          input.engine, input.transactionId, at);
      this.#db.prepare("INSERT OR IGNORE INTO edit_idempotency(project_id, idempotency_key, request_hash, response_json) VALUES(?,?,?,?)")
        .run(input.projectId, input.idempotencyKey, input.requestHash, JSON.stringify(input.response));
      this.#db.prepare("INSERT INTO outbox(topic, project_id, payload_json, created_at) VALUES(?,?,?,?)")
        .run(input.outboxTopic, input.projectId, input.outboxPayload, at);
      this.transition(input.transactionId, "prepared", "committed", {
        snapshot_id: input.snapshotId, source_digest_after: input.sourceDigestAfter,
      }, now);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  /**
   * M4B's one authoritative database commit. Every business fact, the real outbox id and
   * the replay response become visible together, or none do.
   */
  commitAdoption(input: {
    transactionId: string; projectId: string; previousRevision: number;
    expectedSourceDigest: string; expectedControlRevision: number;
    snapshotId: string; sourceDigestAfter: string; impactId: string; impactHash: string;
    idempotencyKey: string; requestDigest: string; projection: AdoptionProjectionFactInput;
    ledgerRows: readonly AdoptionLedgerRow[]; now?: Date;
  }): ControlledWriteResponseV1 {
    const at = (input.now ?? new Date()).toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const fact = this.#db.prepare(`SELECT 1 AS present FROM adoption_transaction_fact
        WHERE transaction_id=? AND snapshot_id=? AND staged_source_digest=?`).get(
        input.transactionId, input.snapshotId, input.sourceDigestAfter) as { present?: number } | undefined;
      if (fact?.present !== 1) throw new Error("ADOPTION_PREPARED_FACT_MISMATCH");
      const state = this.#db.prepare(`UPDATE project_state SET revision=revision+1, source_digest=?,
        source_digest_observed='', source_digest_detected_at='', updated_at=?
        WHERE project_id=? AND revision=? AND source_digest=? AND control_revision=? AND attention=0`)
        .run(input.sourceDigestAfter, at, input.projectId, input.previousRevision,
          input.expectedSourceDigest, input.expectedControlRevision);
      if (Number(state.changes) !== 1) throw new Error("ADOPTION_PROJECT_CAS_FAILED");

      const impact = this.#db.prepare(`UPDATE impact SET state='consumed', updated_at=?
        WHERE impact_id=? AND project_id=? AND impact_hash=? AND state='active'`)
        .run(at, input.impactId, input.projectId, input.impactHash);
      if (Number(impact.changes) !== 1) throw new Error("ADOPTION_IMPACT_CAS_FAILED");

      this.#db.prepare(`INSERT INTO snapshot(snapshot_id, project_id, source_digest, engine, created_at)
        VALUES(?,?,?,'openfilm',?) ON CONFLICT(snapshot_id) DO NOTHING`)
        .run(input.snapshotId, input.projectId, input.sourceDigestAfter, at);
      this.#db.prepare(`INSERT INTO openfilm_projection_fact(project_id, snapshot_id, migration_id,
        source_digest, engine_upstream_sha, roots_json, subtitles_json, frame_count, transaction_id)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(input.projectId, input.snapshotId, input.projection.migration_id,
        input.sourceDigestAfter, input.projection.engine_upstream_sha, input.projection.roots_json,
        input.projection.subtitles_json, input.projection.frame_count, input.transactionId);
      for (const row of input.ledgerRows) {
        this.#db.prepare(`INSERT INTO migrated_asset(project_id, asset_id, migration_id, source_project_id,
          source_manifest_sha256, source_path, target_path, source_sha256, target_sha256,
          duration_frames, media_type, source_json, license_json, created_at, provenance)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'adoption')`).run(input.projectId, row.asset_id, row.migration_id,
          row.source_project_id, row.source_manifest_sha256, row.source_path, row.target_path,
          row.source_sha256, row.target_sha256, row.duration_frames, row.media_type,
          row.source_json, row.license_json, at);
      }
      this.#db.prepare(`INSERT INTO active_commit(project_id, revision, snapshot_id, source_digest,
        engine, transaction_id, created_at) VALUES(?,?,?,?,'openfilm',?,?)
        ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision, snapshot_id=excluded.snapshot_id,
        source_digest=excluded.source_digest, engine=excluded.engine,
        transaction_id=excluded.transaction_id, created_at=excluded.created_at`)
        .run(input.projectId, input.previousRevision + 1, input.snapshotId,
          input.sourceDigestAfter, input.transactionId, at);
      const outbox = this.#db.prepare(`INSERT INTO outbox(topic, project_id, payload_json, created_at)
        VALUES('project.committed',?,?,?)`).run(input.projectId, JSON.stringify({
        project_id: input.projectId, transaction_id: input.transactionId,
        revision: input.previousRevision + 1, snapshot_id: input.snapshotId,
        operation: "adopt_materialization",
      }), at);
      const response: ControlledWriteResponseV1 = {
        format: "narralens.controlled-write-response@1.0", transaction_id: input.transactionId,
        project_id: input.projectId, operation: "adopt_materialization",
        previous_revision: input.previousRevision, new_revision: input.previousRevision + 1,
        snapshot_id: input.snapshotId, source_digest: input.sourceDigestAfter,
        outbox_event_id: Number(outbox.lastInsertRowid), status: "committed",
      };
      this.#db.prepare(`INSERT INTO operation_idempotency(project_id, operation_kind, idempotency_key,
        request_digest, response_json, transaction_id, created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(input.projectId, "controlled_write.adopt_materialization", input.idempotencyKey,
          input.requestDigest, JSON.stringify(response), input.transactionId, at);
      const transaction = this.#db.prepare(`UPDATE project_transaction SET state='committed',
        source_digest_after=?, snapshot_id=?, updated_at=? WHERE transaction_id=? AND project_id=? AND state='prepared'`)
        .run(input.sourceDigestAfter, input.snapshotId, at, input.transactionId, input.projectId);
      if (Number(transaction.changes) !== 1) throw new Error("ADOPTION_TRANSACTION_CAS_FAILED");
      this.#db.exec("COMMIT");
      return response;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  /** Abort an unpublished M4B write and bind its public failure to the sole replay key. */
  abortAdoption(input: { transactionId: string; projectId: string; idempotencyKey: string;
    requestDigest: string; httpStatus: 409 | 422 | 423 | 428 | 500; code: ApiError["code"];
    message: string; details?: unknown; now?: Date }): ControlledWriteFailureResponseV1 {
    const row = this.projectTransaction(input.transactionId);
    if (row === undefined || row.project_id !== input.projectId
      || !["received", "preconditions_checked", "staged", "validated", "prepared"].includes(row.state)) {
      throw new Error("ADOPTION_ABORT_PREDECESSOR_MISMATCH");
    }
    const at = (input.now ?? new Date()).toISOString();
    const response: ControlledWriteFailureResponseV1 = {
      format: "narralens.controlled-write-failure@1.0", transaction_id: input.transactionId,
      project_id: input.projectId, operation: "adopt_materialization",
      previous_revision: row.base_revision, new_revision: row.base_revision,
      source_digest: row.source_digest_before, status: "aborted",
      error: { http_status: input.httpStatus, code: input.code, message: input.message,
        ...(input.details === undefined ? {} : { details: input.details }) },
    };
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const moved = this.#db.prepare(`UPDATE project_transaction SET state='aborted', error_code=?,
        terminal_reason=?, updated_at=? WHERE transaction_id=? AND state=?`).run(
        input.code, input.message, at, input.transactionId, row.state);
      if (Number(moved.changes) !== 1) throw new Error("ADOPTION_ABORT_CAS_FAILED");
      this.#db.prepare(`INSERT INTO operation_idempotency(project_id, operation_kind, idempotency_key,
        request_digest, response_json, transaction_id, created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(input.projectId, "controlled_write.adopt_materialization", input.idempotencyKey,
          input.requestDigest, JSON.stringify(response), input.transactionId, at);
      this.#db.exec("COMMIT");
      return response;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  /** The single pointer a reader resolves. Undefined means the project has never committed. */
  activeCommit(projectId: string): { project_id: string; revision: number; snapshot_id: string;
    source_digest: string; engine: string; transaction_id: string; created_at: string } | undefined {
    const row = this.#db.prepare("SELECT * FROM active_commit WHERE project_id=?").get(projectId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      project_id: String(row.project_id), revision: Number(row.revision), snapshot_id: String(row.snapshot_id),
      source_digest: String(row.source_digest), engine: String(row.engine),
      transaction_id: String(row.transaction_id), created_at: String(row.created_at),
    };
  }

  enqueueOutbox(topic: string, projectId: string, payload: string, now = new Date()): number {
    const result = this.#db.prepare("INSERT INTO outbox(topic, project_id, payload_json, created_at) VALUES(?,?,?,?)")
      .run(topic, projectId, payload, now.toISOString());
    return Number(result.lastInsertRowid);
  }

  pendingOutboxCount(): number {
    return Number((this.#db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE delivered_at IS NULL").get() as { n: number }).n);
  }

  undeliveredOutbox(limit = 100): Array<{ event_id: number; topic: string; project_id: string;
    payload_json: string; attempts: number }> {
    return (this.#db.prepare(`SELECT event_id, topic, project_id, payload_json, attempts FROM outbox
      WHERE delivered_at IS NULL ORDER BY event_id LIMIT ?`).all(limit) as Array<Record<string, unknown>>)
      .map((row) => ({
        event_id: Number(row.event_id), topic: String(row.topic), project_id: String(row.project_id),
        payload_json: String(row.payload_json), attempts: Number(row.attempts),
      }));
  }

  consumerAlreadySaw(eventId: number, consumer: string): boolean {
    return this.#db.prepare("SELECT 1 AS seen FROM outbox_delivery WHERE event_id=? AND consumer=?")
      .get(eventId, consumer) !== undefined;
  }

  /**
   * Returns true when this was the first delivery for that consumer. The event is closed
   * only once `expectedConsumers` distinct consumers have acknowledged it — counting rows
   * alone would never close a one-consumer event.
   */
  recordDelivery(eventId: number, consumer: string, expectedConsumers: number, now = new Date()): boolean {
    if (this.consumerAlreadySaw(eventId, consumer)) return false;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("INSERT OR IGNORE INTO outbox_delivery(event_id, consumer, delivered_at) VALUES(?,?,?)")
        .run(eventId, consumer, now.toISOString());
      this.#db.prepare("UPDATE outbox SET attempts=attempts+1 WHERE event_id=?").run(eventId);
      const acknowledged = Number((this.#db.prepare(
        "SELECT COUNT(*) AS n FROM outbox_delivery WHERE event_id=?").get(eventId) as { n: number }).n);
      if (expectedConsumers <= 0) {
        this.#db.prepare("UPDATE outbox SET delivered_at=? WHERE event_id=?").run(now.toISOString(), eventId);
      } else if (acknowledged >= expectedConsumers) {
        this.#db.prepare("UPDATE outbox SET delivered_at=? WHERE event_id=?").run(now.toISOString(), eventId);
      }
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
    return true;
  }

  countOutboxAttempt(eventId: number): void {
    this.#db.prepare("UPDATE outbox SET attempts=attempts+1 WHERE event_id=?").run(eventId);
  }

  outboxAttempts(eventId: number): number {
    return Number((this.#db.prepare("SELECT attempts FROM outbox WHERE event_id=?").get(eventId) as { attempts: number }).attempts);
  }

  /**
   * Give up on an event after the attempt ceiling. The row is closed with the reason so
   * the condition is auditable; it is never deleted, and the commit it came from stands.
   */
  abandonOutbox(eventId: number, reason: string, now = new Date()): void {
    this.#db.prepare("UPDATE outbox SET delivered_at=?, terminal_reason=? WHERE event_id=?")
      .run(now.toISOString(), reason, eventId);
  }

  /** Why an event was closed without every consumer seeing it; empty when normal. */
  outboxClosedReason(eventId: number): string {
    const row = this.#db.prepare("SELECT terminal_reason FROM outbox WHERE event_id=?").get(eventId) as { terminal_reason?: string };
    return row?.terminal_reason ?? "";
  }

  /** Leases whose owner stopped reporting. Running jobs never become succeeded here. */
  expireStaleLeases(now = new Date()): number {
    const result = this.#db.prepare(`UPDATE job SET lease_owner=NULL, lease_expires_at=NULL
      WHERE state='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`).run(now.getTime());
    return Number(result.changes);
  }

  incompleteTransactions(): ProjectTransactionRow[] {
    return (this.#db.prepare(`SELECT * FROM project_transaction
      WHERE state IN ('received','preconditions_checked','staged','validated','prepared','attention') ORDER BY created_at`)
      .all() as Array<Record<string, unknown>>).map(projectTransaction);
  }

  projectsInAttention(): string[] {
    return (this.#db.prepare("SELECT project_id FROM project_state WHERE attention=1 ORDER BY project_id")
      .all() as Array<{ project_id: string }>).map((row) => row.project_id);
  }

  // ── jobs, leases and events (M2.2 §6) ───────────────────────────────────────────────

  createJobRow(row: {
    job_id: string; project_id: string; kind: string; payload_digest: string; state: string;
    lease_owner: string | null; lease_expires_at: number | null; attempt: number;
    max_attempts: number; cost_status: "unknown" | "known"; created_at: string; updated_at: string;
  }): void {
    this.#db.prepare(`INSERT INTO job(
      job_id, project_id, kind, payload_digest, state, lease_owner, lease_expires_at,
      attempt, max_attempts, cost_status, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.job_id, row.project_id, row.kind, row.payload_digest, row.state, row.lease_owner,
        row.lease_expires_at, row.attempt, row.max_attempts, row.cost_status, row.created_at, row.updated_at);
  }

  /**
   * Safe during shutdown: a job may still be in flight when the Host closes, and a read
   * against a closed handle must report "gone" rather than crash the process.
   */
  readJob(jobId: string): JobRow | undefined {
    try {
      const row = this.#db.prepare("SELECT * FROM job WHERE job_id=?").get(jobId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : jobRow(row);
    } catch (error) {
      if (String(error).includes("database is not open")) return undefined;
      throw error;
    }
  }

  /** Compare-and-set: only a queued job with no live lease can be taken. */
  tryAcquireLease(jobId: string, owner: string, now: number, expiresAt: number): boolean {
    const result = this.#db.prepare(`UPDATE job SET state='running', lease_owner=?, lease_expires_at=?,
      attempt=attempt+1, updated_at=? WHERE job_id=? AND state='queued'
      AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=?)`)
      .run(owner, expiresAt, new Date(now).toISOString(), jobId, now);
    return Number(result.changes) === 1;
  }

  /**
   * Compare-and-set lease renewal.
   *
   * Every predicate matters and each one has bitten: `state='running'` so a terminal or
   * cancelled job cannot be resurrected, `lease_owner=?` so a different worker cannot keep
   * a lease alive, and `attempt=?` so an owner whose attempt was superseded cannot renew —
   * a worker that lost its lease and was requeued comes back with the *same* owner name and
   * would otherwise hold the lease forever. The expiry is extended from now, not from the
   * old value, so a renewal cannot resurrect an already-expired lease.
   */
  renewLease(jobId: string, owner: string, attempt: number, now: number, expiresAt: number): boolean {
    const result = this.#db.prepare(`UPDATE job SET lease_expires_at=?, updated_at=?
      WHERE job_id=? AND state='running' AND lease_owner=? AND attempt=? AND lease_expires_at>?`)
      // Epoch milliseconds, matching every other lease timestamp in this table. Writing an
      // ISO string here puts TEXT into an INTEGER-affinity column, and every later numeric
      // comparison against it then succeeds vacuously.
      .run(expiresAt, new Date(now).toISOString(), jobId, owner, attempt, now);
    return Number(result.changes) === 1;
  }

  /**
   * Whether this worker still holds an unexpired lease. Called at every boundary where a
   * late worker could otherwise publish something nobody can attribute.
   */
  holdsLease(jobId: string, owner: string, attempt: number, now: number): boolean {
    const row = this.#db.prepare(`SELECT 1 FROM job
      WHERE job_id=? AND state='running' AND lease_owner=? AND attempt=? AND lease_expires_at>?`)
      .get(jobId, owner, attempt, now);
    return row !== undefined;
  }

  releaseLease(jobId: string, owner: string, now: number): boolean {
    const result = this.#db.prepare(`UPDATE job SET state='queued', lease_owner=NULL, lease_expires_at=NULL, updated_at=?
      WHERE job_id=? AND lease_owner=? AND state='running'`)
      .run(new Date(now).toISOString(), jobId, owner);
    return Number(result.changes) === 1;
  }

  expiredLeases(now: number): Array<{ job_id: string; project_id: string; state: JobState;
    attempt: number; max_attempts: number }> {
    return (this.#db.prepare(`SELECT job_id, project_id, state, attempt, max_attempts FROM job
      WHERE state IN ('running','cancel_requested') AND lease_expires_at IS NOT NULL
      AND lease_expires_at<=? ORDER BY job_id`)
      .all(now) as Array<{ job_id: string; project_id: string; state: JobState;
        attempt: number; max_attempts: number }>);
  }

  /**
   * Take a lease nobody is holding any more. Returns it to `queued` while attempts remain so
   * another worker can pick it up; the caller turns exhaustion into attention. A reclaimed
   * job is never `succeeded` and never silently retried past its ceiling.
   */
  reclaimLease(jobId: string, requeue: boolean, now = new Date()): boolean {
    const result = this.#db.prepare(`UPDATE job SET lease_owner=NULL, lease_expires_at=NULL,
      state=?, updated_at=? WHERE job_id=? AND state IN ('running','cancel_requested')`)
      .run(requeue ? "queued" : "attention", now.toISOString(), jobId);
    return Number(result.changes) === 1;
  }

  setJobState(jobId: string, state: JobState, at: string, terminalReason = "",
    links: { proposal_id?: string; comparison_id?: string; error_json?: string } = {}): void {
    // The result identifiers and the error live on the job so GET /api/jobs/:id keeps
    // returning exactly what the legacy in-memory store returned (AC-019).
    this.#db.prepare(`UPDATE job SET state=?, terminal_reason=?, updated_at=?,
      proposal_id=COALESCE(?, proposal_id), comparison_id=COALESCE(?, comparison_id),
      error_json=COALESCE(?, error_json) WHERE job_id=?`)
      .run(state, terminalReason, at, links.proposal_id ?? null, links.comparison_id ?? null,
        links.error_json ?? null, jobId);
  }

  /** Only a running job may be finalised; returns false when it moved on underneath us. */
  completeCallback(jobId: string, owner: string, attempt: number, state: JobState, costStatus: "unknown" | "known",
    providerReceipt: string, terminalReason: string, comparisonId?: string, error?: ApiError,
    now = new Date()): boolean {
    const result = this.#db.prepare(`UPDATE job SET state=?, cost_status=?, provider_receipt_json=?,
      terminal_reason=?, comparison_id=COALESCE(?, comparison_id), error_json=COALESCE(?, error_json),
      lease_owner=NULL, lease_expires_at=NULL, updated_at=?
      WHERE job_id=? AND state='running' AND lease_owner=? AND attempt=?`)
      .run(state, costStatus, providerReceipt, terminalReason, comparisonId ?? null,
        error === undefined ? null : JSON.stringify(error), now.toISOString(), jobId, owner, attempt);
    return Number(result.changes) === 1;
  }

  completeCancelledCallback(jobId: string, owner: string, attempt: number, now = new Date()): boolean {
    const result = this.#db.prepare(`UPDATE job SET state='cancelled', lease_owner=NULL,
      lease_expires_at=NULL, updated_at=? WHERE job_id=? AND state='cancel_requested'
      AND lease_owner=? AND attempt=?`).run(now.toISOString(), jobId, owner, attempt);
    return Number(result.changes) === 1;
  }

  quarantine(jobId: string, artifact: string, receipt: string, now = new Date()): void {
    this.#db.prepare(`UPDATE job SET quarantined_artifact_json=?, quarantined_receipt_json=?, updated_at=?
      WHERE job_id=?`).run(artifact, receipt, now.toISOString(), jobId);
  }

  appendJobEvent(jobId: string, type: JobState, at: string,
    extra: { message?: string; proposal_id?: string; comparison_id?: string; error?: unknown } = {},
    withinTransaction = false): JobEventRecord {
    if (!withinTransaction) this.#db.exec("BEGIN IMMEDIATE");
    try {
      const next = Number((this.#db.prepare(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM job_event WHERE job_id=?").get(jobId) as { next: number }).next);
      const payload = { message: extra.message, proposal_id: extra.proposal_id,
        comparison_id: extra.comparison_id, error: extra.error };
      const result = this.#db.prepare(
        "INSERT INTO job_event(job_id, seq, type, payload_json, created_at) VALUES(?,?,?,?,?)")
        .run(jobId, next, type, JSON.stringify(payload), at);
      if (!withinTransaction) this.#db.exec("COMMIT");
      // Assign rather than spread, so an absent optional is absent rather than undefined.
      const record: JobEventRecord = {
        event_id: Number(result.lastInsertRowid), job_id: jobId, seq: next, type, at,
      };
      if (extra.message !== undefined) record.message = extra.message;
      if (extra.proposal_id !== undefined) record.proposal_id = extra.proposal_id;
      if (extra.comparison_id !== undefined) record.comparison_id = extra.comparison_id;
      if (extra.error !== undefined) record.error = extra.error as ApiError;
      return record;
    } catch (error) {
      if (!withinTransaction) this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  jobEventsAfter(jobId: string, after: number, limit: number): JobEventRecord[] {
    return (this.#db.prepare(
      "SELECT * FROM job_event WHERE job_id=? AND seq > ? ORDER BY seq LIMIT ?").all(jobId, after, limit) as Array<Record<string, unknown>>)
      .map((row) => {
        const payload = JSON.parse(String(row.payload_json)) as {
          message?: string; proposal_id?: string; comparison_id?: string; error?: JobEventRecord["error"];
        };
        return {
          event_id: Number(row.event_id), job_id: String(row.job_id), seq: Number(row.seq),
          type: String(row.type) as JobState, at: String(row.created_at),
          ...(payload.message === undefined ? {} : { message: payload.message }),
          ...(payload.proposal_id === undefined ? {} : { proposal_id: payload.proposal_id }),
          ...(payload.comparison_id === undefined ? {} : { comparison_id: payload.comparison_id }),
          ...(payload.error === undefined ? {} : { error: payload.error }),
        };
      });
  }

  // ── locks (M2.2 §5) ────────────────────────────────────────────────────────────────

  upsertLock(row: {
    lock_id: string; project_id: string; lock_type: string; scope: string; target_id: string;
    start_frame: number; end_frame_exclusive: number; owner: string; reason: string;
    control_revision: number; active: boolean; created_at: string; updated_at: string;
  }): void {
    this.#db.prepare(`INSERT INTO project_lock(
      lock_id, project_id, lock_type, scope, target_id, start_frame, end_frame_exclusive,
      owner, reason, control_revision, active, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.lock_id, row.project_id, row.lock_type, row.scope, row.target_id, row.start_frame,
        row.end_frame_exclusive, row.owner, row.reason, row.control_revision, row.active ? 1 : 0,
        row.created_at, row.updated_at);
  }

  createLockWithControlRevision(row: {
    lock_id: string; project_id: string; lock_type: string; scope: string; target_id: string;
    start_frame: number; end_frame_exclusive: number; owner: string; reason: string;
    created_at: string; updated_at: string;
  }, initialRevision: number): number {
    this.ensureProject(row.project_id, initialRevision);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("UPDATE project_state SET control_revision=control_revision+1, updated_at=? WHERE project_id=?")
        .run(row.updated_at, row.project_id);
      const controlRevision = this.controlRevision(row.project_id, initialRevision);
      this.upsertLock({ ...row, control_revision: controlRevision, active: true });
      this.#db.prepare("INSERT INTO outbox(topic, project_id, payload_json, created_at) VALUES('lock.changed',?,?,?)")
        .run(row.project_id, JSON.stringify({ project_id: row.project_id, lock_id: row.lock_id,
          active: true, control_revision: controlRevision }), row.updated_at);
      this.#db.exec("COMMIT");
      return controlRevision;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  deactivateLockWithControlRevision(lockId: string, initialRevision: number, now = new Date()): number {
    const lock = this.readLock(lockId);
    if (lock === undefined) throw new HttpError(404, "NOT_FOUND", "Lock not found");
    this.ensureProject(lock.project_id, initialRevision);
    const at = now.toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("UPDATE project_state SET control_revision=control_revision+1, updated_at=? WHERE project_id=?")
        .run(at, lock.project_id);
      this.deactivateLock(lockId, now);
      const controlRevision = this.controlRevision(lock.project_id, initialRevision);
      this.#db.prepare("INSERT INTO outbox(topic, project_id, payload_json, created_at) VALUES('lock.changed',?,?,?)")
        .run(lock.project_id, JSON.stringify({ project_id: lock.project_id, lock_id: lockId,
          active: false, control_revision: controlRevision }), at);
      this.#db.exec("COMMIT");
      return controlRevision;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  deactivateLock(lockId: string, now = new Date()): void {
    this.#db.prepare("UPDATE project_lock SET active=0, updated_at=? WHERE lock_id=? AND active=1")
      .run(now.toISOString(), lockId);
  }

  readLock(lockId: string): EngineLockRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM project_lock WHERE lock_id=?").get(lockId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : engineLock(row);
  }

  activeLocks(projectId: string): EngineLockRecord[] {
    return (this.#db.prepare("SELECT * FROM project_lock WHERE project_id=? AND active=1 ORDER BY created_at")
      .all(projectId) as Array<Record<string, unknown>>).map(engineLock);
  }

  // ── engine bindings (folded in from the M2.1 store so there is one database) ──────────

  bindEngine(projectId: string, engine: string, engineUpstreamSha: string, migratedFrom: string | null,
    createdAt: string | Date = new Date()): void {
    const at = typeof createdAt === "string" ? createdAt : createdAt.toISOString();
    this.#db.prepare(`INSERT INTO engine_binding(
      project_id, engine, engine_upstream_sha, binding_version, created_at, migrated_from)
      VALUES(?,?,?,1,?,?)`).run(projectId, engine, engineUpstreamSha, at, migratedFrom);
  }

  readEngineBinding(projectId: string): EngineBindingRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM engine_binding WHERE project_id=?").get(projectId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      project_id: String(row.project_id), engine: String(row.engine),
      engine_upstream_sha: String(row.engine_upstream_sha), binding_version: Number(row.binding_version),
      created_at: String(row.created_at),
      migrated_from: row.migrated_from === null || row.migrated_from === undefined ? null : String(row.migrated_from),
    };
  }

  allEngineBindings(): EngineBindingRecord[] {
    return (this.#db.prepare("SELECT project_id FROM engine_binding ORDER BY project_id").all() as Array<{ project_id: string }>)
      .map((row) => this.readEngineBinding(row.project_id))
      .filter((binding): binding is EngineBindingRecord => binding !== undefined);
  }

  /**
   * The committed source digest for a project, recorded once and never re-sampled.
   *
   * A read must compare the current source against THIS value. Recording the current value
   * as its own comparison baseline would make an external change undetectable, which is the
   * failure mode the external review raised as B-01. The baseline is what M2.2's commit
   * record will own; here it is established when the project is first registered.
   */
  ensureSourceBaseline(projectId: string, initialRevision: number, digest: string): string {
    this.ensureProject(projectId, initialRevision);
    const row = this.#db.prepare("SELECT source_digest FROM project_state WHERE project_id=?").get(projectId) as { source_digest?: string };
    const existing = row.source_digest ?? "";
    if (existing !== "") return existing;
    this.#db.prepare("UPDATE project_state SET source_digest=?, updated_at=? WHERE project_id=? AND source_digest=''")
      .run(digest, new Date().toISOString(), projectId);
    const committed = this.#db.prepare("SELECT source_digest FROM project_state WHERE project_id=?").get(projectId) as { source_digest: string };
    return committed.source_digest;
  }

  /**
   * Record an out-of-band source change and raise attention in one transaction. The
   * committed baseline is left untouched so the condition stays visible until recovery.
   */
  recordExternalSourceChange(projectId: string, observedDigest: string, initialRevision: number): void {
    this.ensureProject(projectId, initialRevision);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare(`UPDATE project_state
        SET attention=1, source_digest_observed=?, source_digest_detected_at=?, updated_at=?
        WHERE project_id=?`).run(observedDigest, new Date().toISOString(), new Date().toISOString(), projectId);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  sourceBaseline(projectId: string): { committed: string; observed: string; detected_at: string } {
    const row = this.#db.prepare("SELECT source_digest, source_digest_observed, source_digest_detected_at FROM project_state WHERE project_id=?")
      .get(projectId) as Record<string, unknown> | undefined;
    if (!row) return { committed: "", observed: "", detected_at: "" };
    return { committed: String(row.source_digest ?? ""), observed: String(row.source_digest_observed ?? ""),
      detected_at: String(row.source_digest_detected_at ?? "") };
  }

  ensureProject(projectId: string, initialRevision: number): void {
    this.#db.prepare("INSERT OR IGNORE INTO project_state(project_id, revision, updated_at) VALUES(?,?,?)")
      .run(projectId, initialRevision, new Date().toISOString());
  }

  state(projectId: string, initialRevision: number,
    ignoredTransactionId?: string): { revision: number; visual_locked: boolean; attention: boolean } {
    this.ensureProject(projectId, initialRevision);
    const row = this.#db.prepare("SELECT revision, visual_locked FROM project_state WHERE project_id=?").get(projectId) as Record<string, unknown>;
    // The attention predicate lives in one place; the request gate and this read cannot drift.
    return { revision: Number(row.revision), visual_locked: Boolean(row.visual_locked),
      attention: this.recoveryGate(projectId, initialRevision, ignoredTransactionId) };
  }

  setVisualLock(projectId: string, initialRevision: number, locked: boolean): void {
    this.ensureProject(projectId, initialRevision);
    this.#db.prepare("UPDATE project_state SET visual_locked=?, updated_at=? WHERE project_id=?")
      .run(locked ? 1 : 0, new Date().toISOString(), projectId);
  }

  idempotent(projectId: string, key: string, requestHash: string): EditResponse | undefined {
    const row = this.idempotencyEntry(projectId, key);
    if (!row) return undefined;
    if (row.request_hash !== requestHash) throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT", "The idempotency key was used for a different edit");
    return row.response;
  }

  idempotencyEntry(projectId: string, key: string): { request_hash: string; response: EditResponse } | undefined {
    const row = this.#db.prepare("SELECT request_hash, response_json FROM edit_idempotency WHERE project_id=? AND idempotency_key=?").get(projectId, key) as Record<string, unknown> | undefined;
    return row ? { request_hash: String(row.request_hash), response: JSON.parse(String(row.response_json)) as EditResponse } : undefined;
  }

  prepare(record: JournalRecord, idempotencyKey: string, initialRevision: number): EditResponse | undefined {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.ensureProject(record.project_id, initialRevision);
      const cached = this.idempotent(record.project_id, idempotencyKey, record.request_hash);
      if (cached) { this.#db.exec("COMMIT"); return cached; }
      const state = this.state(record.project_id, initialRevision, record.transaction_id);
      if (state.attention) throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The project requires transaction recovery");
      if (state.visual_locked) throw new HttpError(423, "TARGET_LOCKED", "The visual target is locked");
      if (state.revision !== record.base_revision) throw new HttpError(409, "REVISION_CONFLICT", "Project revision has changed");
      const now = new Date().toISOString();
      this.#db.prepare(`INSERT INTO edit_journal(
        transaction_id,project_id,correlation_id,state,request_json,request_hash,base_revision,authoring_id,
        before_fit,target_fit,source_before,run_before,narration_before,semantic_before,source_path,source_expected,studio_revision_before,
        compensation_attempt,manifest_sha,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(record.transaction_id, record.project_id, record.correlation_id, "prepared", record.request_json,
          record.request_hash, record.base_revision, record.authoring_id, record.before_fit, record.target_fit,
          record.source_before, record.run_before, record.narration_before, record.semantic_before, record.source_path, record.source_expected,
          record.studio_revision_before, 0, record.manifest_sha ?? "", now, now);
      this.#db.exec("COMMIT");
      return undefined;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  markSourceValidated(transactionId: string, sourceExpected?: string, now = new Date()): void {
    this.#state(transactionId, "source_validated", now);
    if (sourceExpected !== undefined) {
      this.#db.prepare("UPDATE edit_journal SET source_expected=?, updated_at=? WHERE transaction_id=?")
        .run(sourceExpected, now.toISOString(), transactionId);
    }
  }
  markMetadataCommitted(transactionId: string): void { this.#state(transactionId, "metadata_committed"); }
  markAborted(transactionId: string): void { this.#state(transactionId, "aborted"); }
  markCompensated(transactionId: string): void { this.#state(transactionId, "compensated"); }

  nextCompensationAttempt(transactionId: string): number {
    this.#db.prepare("UPDATE edit_journal SET compensation_attempt=compensation_attempt+1, updated_at=? WHERE transaction_id=?")
      .run(new Date().toISOString(), transactionId);
    const row = this.#db.prepare("SELECT compensation_attempt FROM edit_journal WHERE transaction_id=?").get(transactionId) as Record<string, unknown>;
    return Number(row.compensation_attempt);
  }

  markAttention(projectId: string, transactionId: string, errorCode: string, reason?: string, now = new Date()): void {
    const at = now.toISOString();
    // Attention can be raised before anything else has registered the project; without
    // this the UPDATE below would silently match nothing and the condition would be lost.
    this.ensureProject(projectId, 0);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      // The journal row is the actor's; an external change may be detected before any
      // transaction exists. The project flag must be set either way, so a missing or
      // already-terminal row is tolerated rather than rejected.
      const current = this.journal(transactionId);
      if (current !== undefined && current.state !== "attention"
        && ["prepared", "source_validated", "metadata_committed", "aborted", "compensated"].includes(current.state)) {
        this.advanceJournal("edit_journal", transactionId,
          ["prepared", "source_validated", "metadata_committed", "aborted", "compensated"],
          "attention", { error_code: errorCode }, now);
      }
      const detail = reason === undefined || reason === "" ? errorCode : reason;
      this.#db.prepare("UPDATE project_state SET attention=1, attention_reason=?, updated_at=? WHERE project_id=?")
        .run(detail === "" ? "UNKNOWN" : detail, at, projectId);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  prepareAssetImport(record: AssetImportJournalRecord, initialRevision: number): { status: number; response: AssetImportResponse } | undefined {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.ensureProject(record.project_id, initialRevision);
      const existing = this.assetImportIdempotent(record.project_id, record.idempotency_key, record.request_hash);
      if (existing !== undefined) { this.#db.exec("COMMIT"); return existing; }
      const state = this.state(record.project_id, initialRevision);
      if (state.attention) throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The project requires transaction recovery");
      const now = new Date().toISOString();
      this.#db.prepare(`INSERT INTO asset_import_journal(
        transaction_id,project_id,correlation_id,idempotency_key,request_hash,state,asset_id,bytes_sha,
        manifest_before_sha,manifest_after_sha,manifest_before_json,manifest_after_json,bytes_created,
        created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(record.transaction_id, record.project_id, record.correlation_id, record.idempotency_key,
          record.request_hash, "prepared", record.asset_id, record.bytes_sha, record.manifest_before_sha,
          record.manifest_after_sha, record.manifest_before_json, record.manifest_after_json,
          record.bytes_created ? 1 : 0, now, now);
      this.#db.exec("COMMIT");
      return undefined;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  assetImportIdempotent(projectId: string, key: string, requestHash: string): { status: number; response: AssetImportResponse } | undefined {
    const existing = this.#db.prepare("SELECT request_hash,state,response_status,response_json FROM asset_import_journal WHERE project_id=? AND idempotency_key=?")
      .get(projectId, key) as Record<string, unknown> | undefined;
    if (existing === undefined) return undefined;
    if (String(existing.request_hash) !== requestHash) {
      throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT", "The idempotency key was used for a different asset import");
    }
    if (existing.state === "committed" && typeof existing.response_status === "number" && typeof existing.response_json === "string") {
      return { status: existing.response_status, response: JSON.parse(existing.response_json) as AssetImportResponse };
    }
    throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT", "The asset import is incomplete and requires recovery");
  }

  markAssetImportBytesInstalled(transactionId: string, created: boolean, now = new Date()): void {
    this.#assetImportStep(transactionId, ["prepared"], "bytes_installed", { bytes_created: created ? 1 : 0 }, now);
  }

  /**
   * Route an asset-import step through the predecessor-checked helper while preserving the
   * error this subsystem has always raised, so the D4.2.1 contract tests keep asserting the
   * same thing they always did.
   */
  #assetImportStep(transactionId: string, from: readonly string[], to: string,
    patch: Readonly<Record<string, string | number | null | undefined>>, now: Date): void {
    try { this.advanceJournal("asset_import_journal", transactionId, from, to, patch, now); }
    catch (error) {
      if (String(error).includes("INVALID_JOURNAL_TRANSITION")) throw new Error("INVALID_ASSET_IMPORT_TRANSITION");
      throw error;
    }
  }

  markAssetImportManifestPublished(transactionId: string, now = new Date()): void {
    this.#assetImportStep(transactionId, ["bytes_installed"], "manifest_published", {}, now);
  }

  commitAssetImport(transactionId: string, status: number, response: AssetImportResponse, now = new Date()): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.assetImportJournal(transactionId);
      if (current?.state !== "manifest_published") {
        throw new Error("INVALID_ASSET_IMPORT_TRANSITION");
      }
      this.advanceJournal("asset_import_journal", transactionId, ["manifest_published"], "committed",
        { response_status: status, response_json: JSON.stringify(response) }, now);
      const row = this.#db.prepare("SELECT project_id FROM asset_import_journal WHERE transaction_id=?").get(transactionId) as { project_id?: string } | undefined;
      if (row?.project_id !== undefined && !this.#projectHasPending(row.project_id)) {
        this.#db.prepare("UPDATE project_state SET attention=0,updated_at=? WHERE project_id=?")
          .run(new Date().toISOString(), row.project_id);
      }
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  markAssetImportAborted(transactionId: string): void { this.#assetImportState(transactionId, "aborted", ["prepared", "bytes_installed"]); }
  markAssetImportCompensated(transactionId: string): void {
    this.#assetImportState(transactionId, "compensated", ["bytes_installed", "manifest_published", "attention"]);
  }

  markAssetImportAttention(projectId: string, transactionId: string, errorCode: string,
    reason?: string, now = new Date()): void {
    const at = now.toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.assetImportJournal(transactionId);
      if (current === undefined || current.project_id !== projectId
        || !["prepared", "bytes_installed", "manifest_published", "attention"].includes(current.state)) {
        throw new Error("INVALID_ASSET_IMPORT_TRANSITION");
      }
      if (current.state !== "attention") {
        this.advanceJournal("asset_import_journal", transactionId,
          ["prepared", "bytes_installed", "manifest_published"], "attention", { error_code: errorCode }, now);
      }
      const detail = reason === undefined || reason === "" ? errorCode : reason;
      this.#db.prepare("UPDATE project_state SET attention=1,attention_reason=?,updated_at=? WHERE project_id=?")
        .run(detail === "" ? "UNKNOWN" : detail, at, projectId);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  incompleteAssetImports(): AssetImportJournalRecord[] {
    return (this.#db.prepare("SELECT * FROM asset_import_journal WHERE state IN ('prepared','bytes_installed','manifest_published','attention') ORDER BY created_at")
      .all() as Array<Record<string, unknown>>).map(assetImportRecord);
  }

  assetImportJournal(transactionId: string): AssetImportJournalRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM asset_import_journal WHERE transaction_id=?").get(transactionId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : assetImportRecord(row);
  }

  commit(record: JournalRecord, idempotencyKey: string, response: EditResponse, now = new Date()): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#db.prepare("SELECT revision FROM project_state WHERE project_id=?").get(record.project_id) as Record<string, unknown>;
      if (Number(current.revision) !== response.previous_revision) throw new HttpError(409, "REVISION_CONFLICT", "Project revision changed during commit");
      this.#db.prepare("UPDATE project_state SET revision=?, updated_at=? WHERE project_id=?")
        .run(response.new_revision, new Date().toISOString(), record.project_id);
      const responseJson = JSON.stringify(response);
      this.#db.prepare("INSERT INTO edit_idempotency(project_id,idempotency_key,request_hash,response_json) VALUES(?,?,?,?)")
        .run(record.project_id, idempotencyKey, record.request_hash, responseJson);
      this.#db.prepare("INSERT INTO revision_event(project_id,revision,transaction_id,changed,response_json,created_at) VALUES(?,?,?,?,?,?)")
        .run(record.project_id, response.new_revision, record.transaction_id, response.changed ? 1 : 0, responseJson, new Date().toISOString());
      this.advanceJournal("edit_journal", record.transaction_id, ["prepared", "source_validated"],
        "metadata_committed", {}, now);
      if (!this.#projectHasPending(record.project_id)) this.#db.prepare("UPDATE project_state SET attention=0, updated_at=? WHERE project_id=?")
        .run(new Date().toISOString(), record.project_id);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  incomplete(): JournalRecord[] {
    return this.#db.prepare("SELECT * FROM edit_journal WHERE state IN ('prepared','source_validated','attention') ORDER BY created_at")
      .all().map((row) => row as unknown as JournalRecord);
  }

  journal(transactionId: string): (JournalRecord & { error_code?: string }) | undefined {
    return this.#db.prepare("SELECT * FROM edit_journal WHERE transaction_id=?").get(transactionId) as unknown as (JournalRecord & { error_code?: string }) | undefined;
  }

  /**
   * M2.3 rollback: stop new writes for a project and quarantine what is in flight.
   * Returns the ids of the jobs that were moved to attention, so the rollback record can
   * name them instead of quietly dropping them.
   */
  stopWritesFor(projectId: string, at: string): string[] {
    const pending = (this.#db.prepare(
      "SELECT job_id FROM job WHERE project_id=? AND state IN ('queued','running','cancel_requested')")
      .all(projectId) as Array<{ job_id: string }>);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const job of pending) {
        this.#db.prepare(`UPDATE job SET state='attention', lease_owner=NULL, lease_expires_at=NULL,
          terminal_reason='QUARANTINED_FOR_ROLLBACK', updated_at=? WHERE job_id=?`).run(at, job.job_id);
      }
      this.#db.prepare("UPDATE project_state SET attention=1, attention_reason=?, updated_at=? WHERE project_id=?")
        .run("ROLLED_BACK_WRITES_STOPPED", at, projectId);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
    return pending.map((job) => job.job_id);
  }

  /**
   * M2.3 activation: the new project's single active commit, its engine binding and its
   * committed source baseline, all in one transaction. The source project's rows are not
   * touched by this statement.
   */
  commitMigrationTarget(input: {
    migrationId: string; projectId: string; revision: number; snapshotId: string;
    sourceDigest: string; engine: string; now?: Date;
  }): void {
    const at = (input.now ?? new Date()).toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("INSERT INTO project_state(project_id, revision, updated_at) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at")
        .run(input.projectId, input.revision, at);
      this.#db.prepare("INSERT INTO snapshot(snapshot_id, project_id, source_digest, engine, created_at) VALUES(?,?,?,?,?) ON CONFLICT(snapshot_id) DO NOTHING")
        .run(input.snapshotId, input.projectId, input.sourceDigest, input.engine, at);
      this.#db.prepare(`INSERT INTO active_commit(project_id, revision, snapshot_id, source_digest, engine, transaction_id, created_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
          revision=excluded.revision, snapshot_id=excluded.snapshot_id,
          source_digest=excluded.source_digest, engine=excluded.engine,
          transaction_id=excluded.transaction_id, created_at=excluded.created_at`)
        .run(input.projectId, input.revision, input.snapshotId, input.sourceDigest, input.engine,
          input.migrationId, at);
      this.#db.prepare("UPDATE project_state SET source_digest=?, updated_at=? WHERE project_id=?")
        .run(input.sourceDigest, at, input.projectId);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  close(): void { this.#db.close(); }

  #state(transactionId: string, state: JournalState, now = new Date()): void {
    this.advanceJournal("edit_journal", transactionId, ["prepared", "source_validated"], state, {}, now);
    if (["metadata_committed", "aborted", "compensated"].includes(state)) {
      const row = this.#db.prepare("SELECT project_id FROM edit_journal WHERE transaction_id=?").get(transactionId) as { project_id?: string } | undefined;
      if (row?.project_id !== undefined) {
        if (!this.#projectHasPending(row.project_id)) this.#db.prepare("UPDATE project_state SET attention=0, updated_at=? WHERE project_id=?")
          .run(new Date().toISOString(), row.project_id);
      }
    }
  }

  #assetImportState(transactionId: string, state: AssetImportJournalState, allowed: AssetImportJournalState[],
    now = new Date()): void {
    const current = this.assetImportJournal(transactionId);
    if (current === undefined || !allowed.includes(current.state)) throw new Error("INVALID_ASSET_IMPORT_TRANSITION");
    this.#assetImportStep(transactionId, allowed, state, {}, now);
    if (["committed", "aborted", "compensated"].includes(state)) {
      const row = this.#db.prepare("SELECT project_id FROM asset_import_journal WHERE transaction_id=?").get(transactionId) as { project_id?: string } | undefined;
      if (row?.project_id !== undefined && !this.#projectHasPending(row.project_id)) {
        this.#db.prepare("UPDATE project_state SET attention=0,updated_at=? WHERE project_id=?")
          .run(new Date().toISOString(), row.project_id);
      }
    }
  }

  #projectHasPending(projectId: string, ignoredTransactionId?: string): boolean {
    const edit = this.#db.prepare("SELECT 1 AS present FROM edit_journal WHERE project_id=? AND state IN ('prepared','source_validated','attention') LIMIT 1").get(projectId);
    const asset = this.#db.prepare("SELECT 1 AS present FROM asset_import_journal WHERE project_id=? AND state IN ('prepared','bytes_installed','manifest_published','attention') LIMIT 1").get(projectId);
    const transaction = ignoredTransactionId === undefined
      ? this.#db.prepare(`SELECT 1 AS present FROM project_transaction WHERE project_id=?
          AND state NOT IN ('committed','aborted') LIMIT 1`).get(projectId)
      : this.#db.prepare(`SELECT 1 AS present FROM project_transaction WHERE project_id=? AND transaction_id<>?
          AND state NOT IN ('committed','aborted') LIMIT 1`).get(projectId, ignoredTransactionId);
    return Boolean(edit) || Boolean(asset) || Boolean(transaction);
  }
}

function assetImportRecord(row: Record<string, unknown>): AssetImportJournalRecord {
  return {
    transaction_id: String(row.transaction_id), project_id: String(row.project_id), correlation_id: String(row.correlation_id),
    idempotency_key: String(row.idempotency_key), request_hash: String(row.request_hash), state: String(row.state) as AssetImportJournalState,
    asset_id: String(row.asset_id), bytes_sha: String(row.bytes_sha), manifest_before_sha: String(row.manifest_before_sha),
    manifest_after_sha: String(row.manifest_after_sha), manifest_before_json: String(row.manifest_before_json),
    manifest_after_json: String(row.manifest_after_json), bytes_created: Boolean(row.bytes_created),
    ...(typeof row.response_status === "number" ? { response_status: row.response_status } : {}),
    ...(typeof row.response_json === "string" ? { response_json: row.response_json } : {}),
    ...(typeof row.error_code === "string" ? { error_code: row.error_code } : {}),
  };
}
