import { DatabaseSync } from "node:sqlite";
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
        attention INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
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
  }

  ensureProject(projectId: string, initialRevision: number): void {
    this.#db.prepare("INSERT OR IGNORE INTO project_state(project_id, revision, updated_at) VALUES(?,?,?)")
      .run(projectId, initialRevision, new Date().toISOString());
  }

  state(projectId: string, initialRevision: number): { revision: number; visual_locked: boolean; attention: boolean } {
    this.ensureProject(projectId, initialRevision);
    const row = this.#db.prepare("SELECT revision, visual_locked, attention FROM project_state WHERE project_id=?").get(projectId) as Record<string, unknown>;
    return { revision: Number(row.revision), visual_locked: Boolean(row.visual_locked),
      attention: Boolean(row.attention) || this.#projectHasPending(projectId) };
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

  markSourceValidated(transactionId: string, sourceExpected?: string): void {
    if (sourceExpected !== undefined) {
      this.#db.prepare("UPDATE edit_journal SET state='source_validated', source_expected=?, updated_at=? WHERE transaction_id=?")
        .run(sourceExpected, new Date().toISOString(), transactionId);
      return;
    }
    this.#state(transactionId, "source_validated");
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

  markAttention(projectId: string, transactionId: string, errorCode: string): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("UPDATE edit_journal SET state='attention', error_code=?, updated_at=? WHERE transaction_id=?")
        .run(errorCode, new Date().toISOString(), transactionId);
      this.#db.prepare("UPDATE project_state SET attention=1, updated_at=? WHERE project_id=?")
        .run(new Date().toISOString(), projectId);
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

  markAssetImportBytesInstalled(transactionId: string, created: boolean): void {
    const current = this.assetImportJournal(transactionId);
    if (current?.state !== "prepared") throw new Error("INVALID_ASSET_IMPORT_TRANSITION");
    this.#db.prepare("UPDATE asset_import_journal SET state='bytes_installed',bytes_created=?,updated_at=? WHERE transaction_id=?")
      .run(created ? 1 : 0, new Date().toISOString(), transactionId);
  }

  markAssetImportManifestPublished(transactionId: string): void {
    this.#assetImportState(transactionId, "manifest_published", ["bytes_installed", "attention"]);
  }

  commitAssetImport(transactionId: string, status: number, response: AssetImportResponse): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.assetImportJournal(transactionId);
      if (current?.state !== "manifest_published") {
        throw new Error("INVALID_ASSET_IMPORT_TRANSITION");
      }
      this.#db.prepare("UPDATE asset_import_journal SET state='committed',response_status=?,response_json=?,updated_at=? WHERE transaction_id=?")
        .run(status, JSON.stringify(response), new Date().toISOString(), transactionId);
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

  markAssetImportAttention(projectId: string, transactionId: string, errorCode: string): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.assetImportJournal(transactionId);
      if (current === undefined || current.project_id !== projectId
        || !["prepared", "bytes_installed", "manifest_published", "attention"].includes(current.state)) {
        throw new Error("INVALID_ASSET_IMPORT_TRANSITION");
      }
      this.#db.prepare("UPDATE asset_import_journal SET state='attention',error_code=?,updated_at=? WHERE transaction_id=?")
        .run(errorCode, new Date().toISOString(), transactionId);
      this.#db.prepare("UPDATE project_state SET attention=1,updated_at=? WHERE project_id=?")
        .run(new Date().toISOString(), projectId);
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

  commit(record: JournalRecord, idempotencyKey: string, response: EditResponse): void {
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
      this.#db.prepare("UPDATE edit_journal SET state='metadata_committed', updated_at=? WHERE transaction_id=?")
        .run(new Date().toISOString(), record.transaction_id);
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

  #state(transactionId: string, state: JournalState): void {
    this.#db.prepare("UPDATE edit_journal SET state=?, updated_at=? WHERE transaction_id=?")
      .run(state, new Date().toISOString(), transactionId);
    if (["metadata_committed", "aborted", "compensated"].includes(state)) {
      const row = this.#db.prepare("SELECT project_id FROM edit_journal WHERE transaction_id=?").get(transactionId) as { project_id?: string } | undefined;
      if (row?.project_id !== undefined) {
        if (!this.#projectHasPending(row.project_id)) this.#db.prepare("UPDATE project_state SET attention=0, updated_at=? WHERE project_id=?")
          .run(new Date().toISOString(), row.project_id);
      }
    }
  }

  #assetImportState(transactionId: string, state: AssetImportJournalState, allowed: AssetImportJournalState[]): void {
    const current = this.assetImportJournal(transactionId);
    if (current === undefined || !allowed.includes(current.state)) throw new Error("INVALID_ASSET_IMPORT_TRANSITION");
    this.#db.prepare("UPDATE asset_import_journal SET state=?,updated_at=? WHERE transaction_id=?")
      .run(state, new Date().toISOString(), transactionId);
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
