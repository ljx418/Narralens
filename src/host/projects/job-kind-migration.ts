import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

/**
 * Controlled forward migration of `job.kind` (W2-G02, R2-06).
 *
 * `job.kind` carries a SQLite `CHECK`, and SQLite cannot widen a `CHECK` in place. So this
 * is the only table migration the frozen plan permits, and it is permitted only in this
 * shape:
 *
 *   1. `VACUUM INTO` a verifiable backup, in the same directory as the database;
 *   2. inside one `BEGIN IMMEDIATE`, create `job_v2` with the widened `CHECK`;
 *   3. copy rows by *explicit column list*, never `SELECT *`;
 *   4. verify count, primary keys, state, lease and receipt digests against `job`;
 *   5. drop `job`, rename `job_v2`, record the migration.
 *
 * Anything that cannot be proven fails loudly and leaves both the original table and the
 * backup in place. A Host that "recovers" by re-running the migration is the failure mode
 * this file exists to prevent, so an unverifiable `schema_migration` row stops startup
 * rather than being repaired.
 *
 * The backup is kept rather than deleted. It is the only thing standing between an
 * operator and a queue they cannot reconstruct, and the plan asks for it to survive a
 * failed migration.
 */

export const JOB_KIND_MIGRATION_ID = "job_kind_materialize";
export const JOB_KIND_FROM_VERSION = 1;
export const JOB_KIND_TO_VERSION = 2;

/** Columns copied explicitly. Adding a column here without migrating it is deliberate. */
const JOB_COLUMNS = [
  "job_id", "project_id", "kind", "payload_digest", "state", "lease_owner", "lease_expires_at",
  "attempt", "max_attempts", "provider_receipt_json", "cost_status", "quarantined_artifact_json",
  "quarantined_receipt_json", "proposal_id", "comparison_id", "error_json",
  "created_at", "updated_at", "terminal_reason",
] as const;

/** Columns whose exact value must survive; a null here is data loss, not a formatting change. */
const VERIFIED_EXACTLY = [
  "job_id", "project_id", "kind", "state", "lease_owner", "lease_expires_at",
  "attempt", "max_attempts", "provider_receipt_json", "cost_status", "quarantined_artifact_json",
  "quarantined_receipt_json", "terminal_reason",
] as const;

export class JobKindMigrationUnverifiable extends Error {
  constructor(readonly reason: string, readonly backupPath: string | null, cause?: unknown) {
    super(`${JOB_KIND_MIGRATION_ID}:UNVERIFIABLE:${reason}`, { cause });
  }
}

/**
 * Injected so the verification can be proven, not just present.
 *
 * A comparison that is never observed catching anything is indistinguishable from a
 * comparison that does not work: if the copy is always correct, deleting the check changes
 * no observable behaviour. The fault lets a test corrupt the migrated table and watch the
 * migration refuse. It is the same seam `AssetRegistry` and `MigrationService` already use.
 */
export type JobKindMigrationFaultPoint = "after_copy_before_verify";

export interface JobKindMigrationDependencies {
  /** Synchronous, because the migration runs inside `RevisionStore`'s constructor. */
  readonly fault?: (point: JobKindMigrationFaultPoint) => void;
}

/**
 * Runs once per database. Safe to call on every open: a completed migration is detected
 * and skipped, and a *recorded but unverifiable* one throws.
 */
export function migrateJobKind(db: DatabaseSync, databasePath: string,
  dependencies: JobKindMigrationDependencies = {}): void {
  ensureSchemaMigrationTable(db);
  const existing = db.prepare("SELECT to_version FROM schema_migration WHERE id=?")
    .get(JOB_KIND_MIGRATION_ID) as { to_version?: number } | undefined;
  if (existing !== undefined) {
    if (Number(existing.to_version) !== JOB_KIND_TO_VERSION) {
      throw new JobKindMigrationUnverifiable(
        "recorded migration reports an unexpected target version", null);
    }
    return;
  }
  if (!tableExists(db, "job")) return;

  const backupPath = takeBackup(db, databasePath);
  runMigration(db, backupPath, dependencies);
}

function ensureSchemaMigrationTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL,
    applied_at TEXT NOT NULL, backup_path TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT ''
  )`);
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return row !== undefined;
}

/**
 * `VACUUM INTO` produces a whole-file copy that SQLite itself wrote, so it is verifiable
 * rather than a best-effort byte copy of a live database.
 */
function takeBackup(db: DatabaseSync, databasePath: string): string {
  const backupPath = `${databasePath}.pre-job-kind-v${JOB_KIND_TO_VERSION}.bak`;
  if (existsSync(backupPath)) {
    throw new JobKindMigrationUnverifiable("a backup for this migration already exists", backupPath);
  }
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  if (!existsSync(backupPath)) {
    throw new JobKindMigrationUnverifiable("the backup was not written", backupPath);
  }
  return backupPath;
}

function runMigration(db: DatabaseSync, backupPath: string,
  dependencies: JobKindMigrationDependencies): void {
  const columns = JOB_COLUMNS.join(", ");
  const before = db.prepare("SELECT * FROM job ORDER BY job_id").all() as Array<Record<string, unknown>>;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE job_v2 (
      job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('proposal_comparison','render','snapshot_publish','materialize')),
      payload_digest TEXT NOT NULL, state TEXT NOT NULL,
      lease_owner TEXT, lease_expires_at INTEGER,
      attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1,
      provider_receipt_json TEXT, cost_status TEXT NOT NULL DEFAULT 'unknown',
      quarantined_artifact_json TEXT, quarantined_receipt_json TEXT,
      proposal_id TEXT, comparison_id TEXT, error_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_reason TEXT NOT NULL DEFAULT '',
      CHECK (cost_status IN ('unknown','known'))
    )`);
    const insert = db.prepare(
      `INSERT INTO job_v2(${columns}) VALUES(${JOB_COLUMNS.map(() => "?").join(",")})`,
    );
    for (const row of before) {
      // Explicit list, never `SELECT *`: a column added later must not be copied by
      // accident, and one dropped must not shift every value after it.
      const values = JOB_COLUMNS.map((column) => (row[column] ?? null) as SQLInputValue);
      insert.run(...values);
    }

    dependencies.fault?.("after_copy_before_verify");

    const after = db.prepare("SELECT * FROM job_v2 ORDER BY job_id").all() as Array<Record<string, unknown>>;
    if (after.length !== before.length) {
      throw new JobKindMigrationUnverifiable(`row count changed: ${before.length} -> ${after.length}`, backupPath);
    }
    for (const [index, row] of before.entries()) {
      const migrated = after[index]!;
      for (const column of VERIFIED_EXACTLY) {
        if (!Object.is(row[column] ?? null, migrated[column] ?? null)) {
          throw new JobKindMigrationUnverifiable(
            `column ${column} changed for ${String(row.job_id)}`, backupPath);
        }
      }
      // The payload digest is the receipt-level identity of what the job was asked to do.
      if (row.payload_digest !== migrated.payload_digest) {
        throw new JobKindMigrationUnverifiable(
          `payload digest changed for ${String(row.job_id)}`, backupPath);
      }
    }

    db.exec("DROP TABLE job");
    db.exec("ALTER TABLE job_v2 RENAME TO job");
    db.prepare(`INSERT INTO schema_migration(id, from_version, to_version, applied_at, backup_path, detail)
      VALUES(?,?,?,?,?,?)`)
      .run(JOB_KIND_MIGRATION_ID, JOB_KIND_FROM_VERSION, JOB_KIND_TO_VERSION,
        new Date().toISOString(), backupPath,
        "job.kind CHECK widened to add 'materialize'; rows copied by explicit column list and compared field by field");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (error instanceof JobKindMigrationUnverifiable) throw error;
    throw new JobKindMigrationUnverifiable(
      error instanceof Error ? error.message : String(error), backupPath, error);
  }
}

/** Exposed for the fitness test that asserts the copy is explicit, not `SELECT *`. */
export const JOB_MIGRATION_COLUMNS: readonly string[] = JOB_COLUMNS;
