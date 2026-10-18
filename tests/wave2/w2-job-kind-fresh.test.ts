import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JobKind, maxAttemptsFor } from "../../src/host/job-defaults.js";
import { PersistentJobStore } from "../../src/host/persistent-job-store.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

/**
 * W2.0 correction, blocker 1: a brand-new database must accept `materialize` on its *first*
 * open.
 *
 * `migrateJobKind` runs before the `job` table exists in `RevisionStore`'s constructor, so
 * on a fresh database there is nothing to migrate, and the `CREATE TABLE IF NOT EXISTS job`
 * that follows still carries the old three-value `CHECK`. The result is a production path
 * that is green in tests and broken in use: the first materialize job on a new Host is
 * rejected by SQLite, and nothing reports why.
 *
 * `tests/wave2/w2-job-kind-migration.test.ts` missed this because its "fresh" fixtures were
 * built through a `RevisionStore` that had already been widened. Every fixture here builds
 * the database by hand.
 */

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function freshDatabasePath(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "narralens-w2-fresh-"));
  dirs.push(base);
  return join(base, "narralens.sqlite");
}

/** Reads the actual `CHECK` text SQLite compiled for the `job` table. */
function jobCheckSql(handle: DatabaseSync): string {
  const row = handle.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='job'",
  ).get() as { sql: string } | undefined;
  if (row === undefined) throw new Error("JOB_TABLE_ABSENT");
  return row.sql;
}

describe("blocker 1a: a fresh database accepts materialize on its first open", () => {
  it("creates the job table with all four kinds on the very first construction", async () => {
    const dbPath = await freshDatabasePath();
    const revisions = new RevisionStore(dbPath);
    stores.push(revisions);
    const handle = new DatabaseSync(dbPath);
    try {
      expect(jobCheckSql(handle)).toContain("'materialize'");
    } finally { handle.close(); }
  });

  it("creates a materialize job immediately, with no close-and-reopen", async () => {
    const dbPath = await freshDatabasePath();
    const revisions = new RevisionStore(dbPath);
    stores.push(revisions);
    const jobs = new PersistentJobStore(revisions);
    // One call, one open. The old behaviour required a second construction.
    const created = jobs.create({ projectId: "of_target", kind: "materialize", payload: { comparison_id: "cmp_1" } });
    expect(created.job_id).toMatch(/^job_/u);
    const row = revisions.compose((db) => db.prepare(
      "SELECT kind, max_attempts FROM job WHERE job_id=?",
    ).get(created.job_id)) as { kind: string; max_attempts: number };

    expect(row).toEqual({ kind: "materialize", max_attempts: 3 });
  });

  it("still refuses an unknown kind through the SQLite CHECK, not through application code", async () => {
    const dbPath = await freshDatabasePath();
    const revisions = new RevisionStore(dbPath);
    stores.push(revisions);
    // Straight at the table: if this only passed because some layer validated the string,
    // the constraint would not actually exist.
    expect(() => revisions.compose((db) => db.prepare(
      "INSERT INTO job(job_id, project_id, kind, payload_digest, state, attempt, max_attempts, cost_status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run("job_x", "of_target", "not_a_kind", "a".repeat(64), "queued", 0, 1, "unknown",
      new Date(0).toISOString(), new Date(0).toISOString()))).toThrow();
  });

  it("names exactly the four allowed kinds and nothing else", async () => {
    const dbPath = await freshDatabasePath();
    stores.push(new RevisionStore(dbPath));
    const handle = new DatabaseSync(dbPath);
    try {
      const sql = jobCheckSql(handle);
      const kinds = [...sql.matchAll(/'(proposal_comparison|render|snapshot_publish|materialize)'/gu)].map((m) => m[1]!);
      expect([...new Set(kinds)].sort()).toEqual(["materialize", "proposal_comparison", "render", "snapshot_publish"]);
      // The `cost_status` CHECK shares the statement; it must be unchanged.
      expect(sql).toContain("cost_status IN ('unknown','known')");
    } finally { handle.close(); }
  });

  it("records no schema migration for a database that never needed one", async () => {
    const dbPath = await freshDatabasePath();
    stores.push(new RevisionStore(dbPath));
    const handle = new DatabaseSync(dbPath);
    try {
      // A fresh database is already at v2 by construction, so claiming a migration ran
      // would be a false audit record.
      expect(handle.prepare("SELECT COUNT(*) AS n FROM schema_migration").get()).toMatchObject({ n: 0 });
    } finally { handle.close(); }
  });

  it("keeps the fresh and migrated schemas semantically identical", async () => {
    const fresh = await freshDatabasePath();
    stores.push(new RevisionStore(fresh));
    const first = new DatabaseSync(fresh);
    const freshSql = jobCheckSql(first);
    first.close();

    const old = await freshDatabasePath();
    const legacy = new DatabaseSync(old);
    legacy.exec(`CREATE TABLE job (
      job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('proposal_comparison','render','snapshot_publish')),
      payload_digest TEXT NOT NULL, state TEXT NOT NULL,
      lease_owner TEXT, lease_expires_at INTEGER,
      attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1,
      provider_receipt_json TEXT, cost_status TEXT NOT NULL DEFAULT 'unknown',
      quarantined_artifact_json TEXT, quarantined_receipt_json TEXT,
      proposal_id TEXT, comparison_id TEXT, error_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_reason TEXT NOT NULL DEFAULT '',
      CHECK (cost_status IN ('unknown','known')) )`);
    legacy.close();
    stores.push(new RevisionStore(old));
    const migrated = new DatabaseSync(old);
    try {
      const migratedSql = jobCheckSql(migrated);
      // `ALTER TABLE ... RENAME TO` records the table as `"job"`, so the two strings differ
      // textually while describing the same schema. Compare the parts that decide behaviour:
      // the allowed kinds, and every column.
      const constraints = (sql: string) =>
        [...sql.matchAll(/CHECK \(([^)]*)\)/gu)].map((match) => match[1]!.replaceAll("'", "").replaceAll(" ", "").split(",").sort().join("|"));
      expect(constraints(migratedSql)).toEqual(constraints(freshSql));
      const columns = (sql: string) => sql.slice(0, sql.indexOf(")")).split(",")
        .map((part) => part.trim().split(/\s+/u)[0] ?? "")
        .filter((name) => !name.toUpperCase().startsWith("CHECK")).sort();
      expect(columns(migratedSql)).toEqual(columns(freshSql));
    } finally { migrated.close(); }
  });
});

describe("blocker 1b: the old Wave 1 path still migrates under controlled rules", () => {
  it("migrates a legacy DDL database and then accepts materialize", async () => {
    const dbPath = await freshDatabasePath();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`CREATE TABLE job (
      job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('proposal_comparison','render','snapshot_publish')),
      payload_digest TEXT NOT NULL, state TEXT NOT NULL,
      lease_owner TEXT, lease_expires_at INTEGER,
      attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1,
      provider_receipt_json TEXT, cost_status TEXT NOT NULL DEFAULT 'unknown',
      quarantined_artifact_json TEXT, quarantined_receipt_json TEXT,
      proposal_id TEXT, comparison_id TEXT, error_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_reason TEXT NOT NULL DEFAULT '',
      CHECK (cost_status IN ('unknown','known')) )`);
    const at = new Date(0).toISOString();
    legacy.prepare(`INSERT INTO job(job_id, project_id, kind, payload_digest, state, attempt, max_attempts,
      cost_status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run("job_old", "d1-30s", "render", "a".repeat(64), "succeeded", 1, 3, "known", at, at);
    legacy.close();

    const revisions = new RevisionStore(dbPath);
    stores.push(revisions);
    expect(revisions.compose((db) => db.prepare("SELECT state, kind FROM job WHERE job_id='job_old'").get()))
      .toMatchObject({ state: "succeeded", kind: "render" });
    expect(revisions.compose((db) => db.prepare(
      "SELECT id FROM schema_migration WHERE id='job_kind_materialize'").get()))
      .toMatchObject({ id: "job_kind_materialize" });
    new PersistentJobStore(revisions).create({ projectId: "of_target", kind: "materialize", payload: {} });
  });

  it("keeps every legacy kind usable after the migration", async () => {
    const dbPath = await freshDatabasePath();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`CREATE TABLE job (
      job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('proposal_comparison','render','snapshot_publish')),
      payload_digest TEXT NOT NULL, state TEXT NOT NULL,
      lease_owner TEXT, lease_expires_at INTEGER,
      attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1,
      provider_receipt_json TEXT, cost_status TEXT NOT NULL DEFAULT 'unknown',
      quarantined_artifact_json TEXT, quarantined_receipt_json TEXT,
      proposal_id TEXT, comparison_id TEXT, error_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_reason TEXT NOT NULL DEFAULT '',
      CHECK (cost_status IN ('unknown','known')) )`);
    legacy.close();
    const revisions = new RevisionStore(dbPath);
    stores.push(revisions);
    const jobs = new PersistentJobStore(revisions);
    for (const kind of ["proposal_comparison", "render", "snapshot_publish", "materialize"] as JobKind[]) {
      expect(() => jobs.create({ projectId: "of_target", kind, payload: {} }), kind).not.toThrow();
    }
    expect(maxAttemptsFor("materialize")).toBe(3);
  });
});
