import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AssetImportResponse, EditResponse } from "../../contracts/types.js";
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
  & { createdAt?: Date };

export interface EngineBindingRecord {
  project_id: string; engine: string; engine_upstream_sha: string;
  binding_version: number; created_at: string; migrated_from: string | null;
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

  constructor(path = ":memory:") {
    this.#db = new DatabaseSync(path);
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
      CREATE TABLE IF NOT EXISTS job (
        job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('proposal_comparison','render','snapshot_publish')),
        payload_digest TEXT NOT NULL, state TEXT NOT NULL,
        lease_owner TEXT, lease_expires_at INTEGER,
        attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1,
        provider_receipt_json TEXT, cost_status TEXT NOT NULL DEFAULT 'unknown',
        quarantined_artifact_json TEXT, quarantined_receipt_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_reason TEXT NOT NULL DEFAULT '',
        CHECK (cost_status IN ('unknown','known'))
      );
      CREATE TABLE IF NOT EXISTS job_event (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, seq INTEGER NOT NULL,
        type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        UNIQUE (job_id, seq)
      );
      CREATE TABLE IF NOT EXISTS outbox (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT, attempts INTEGER NOT NULL DEFAULT 0
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
  recoveryGate(projectId: string, initialRevision: number): boolean {
    this.ensureProject(projectId, initialRevision);
    const row = this.#db.prepare("SELECT attention FROM project_state WHERE project_id=?").get(projectId) as { attention?: number };
    return Boolean(row.attention) || this.#projectHasPending(projectId);
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

  state(projectId: string, initialRevision: number): { revision: number; visual_locked: boolean; attention: boolean } {
    this.ensureProject(projectId, initialRevision);
    const row = this.#db.prepare("SELECT revision, visual_locked FROM project_state WHERE project_id=?").get(projectId) as Record<string, unknown>;
    // The attention predicate lives in one place; the request gate and this read cannot drift.
    return { revision: Number(row.revision), visual_locked: Boolean(row.visual_locked),
      attention: this.recoveryGate(projectId, initialRevision) };
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
      const state = this.state(record.project_id, initialRevision);
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
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.journal(transactionId);
      if (current === undefined || !["prepared", "source_validated", "metadata_committed",
        "aborted", "compensated", "attention"].includes(current.state)) {
        throw new Error("INVALID_JOURNAL_TRANSITION");
      }
      if (current.state !== "attention") {
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

  #projectHasPending(projectId: string): boolean {
    const edit = this.#db.prepare("SELECT 1 AS present FROM edit_journal WHERE project_id=? AND state IN ('prepared','source_validated','attention') LIMIT 1").get(projectId);
    const asset = this.#db.prepare("SELECT 1 AS present FROM asset_import_journal WHERE project_id=? AND state IN ('prepared','bytes_installed','manifest_published','attention') LIMIT 1").get(projectId);
    return Boolean(edit) || Boolean(asset);
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
