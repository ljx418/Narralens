import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { JobKind, maxAttemptsFor } from "../../src/host/job-defaults.js";
import { JobKindMigrationUnverifiable, migrateJobKind } from "../../src/host/projects/job-kind-migration.js";
import { PersistentJobStore } from "../../src/host/persistent-job-store.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

/**
 * W2-G02 (R2-06, R2-01).
 *
 * `job.kind` has a SQLite `CHECK`, and SQLite cannot widen one in place. So adding
 * `materialize` is the one table migration the frozen plan allows, and the plan is
 * explicit about how it must be done: a verifiable `VACUUM INTO` backup, an explicit
 * column copy into `job_v2`, a row/key/state/lease/receipt comparison, an atomic swap,
 * and a `schema_migration` record.
 *
 * The reason it is spelled out is that the alternative — dropping and recreating the
 * table — is the kind of change that looks fine in a test with three rows and destroys a
 * production job queue. So the tests here are about *losslessness*, using jobs that are
 * mid-flight: leased, exhausted, quarantined, carrying receipts and costs.
 */

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface SeededJob {
  job_id: string;
  kind: string;
  state: string;
  lease_owner: string | null;
  lease_expires_at: number | null;
  attempt: number;
  max_attempts: number;
  cost_status: string;
  provider_receipt_json: string | null;
  quarantined_artifact_json: string | null;
}

/**
 * Builds a database shaped like a real Wave 1 one: several jobs in different states, one
 * leased, one exhausted, one quarantined with a receipt, and events and an outbox row
 * that must survive untouched.
 */
/**
 * Builds a genuinely pre-W2.0 database.
 *
 * This is the part that matters: if the fixture were created through `RevisionStore`, it
 * would already carry the widened `CHECK` and the migration would be proving nothing. So
 * the `job` table is written here with the exact M2.2 DDL, including the old three-value
 * `CHECK`, and only then opened by a `RevisionStore`.
 */
const WAVE1_JOB_DDL = `CREATE TABLE job (
  job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('proposal_comparison','render','snapshot_publish')),
  payload_digest TEXT NOT NULL, state TEXT NOT NULL,
  lease_owner TEXT, lease_expires_at INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1,
  provider_receipt_json TEXT, cost_status TEXT NOT NULL DEFAULT 'unknown',
  quarantined_artifact_json TEXT, quarantined_receipt_json TEXT,
  proposal_id TEXT, comparison_id TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_reason TEXT NOT NULL DEFAULT '',
  CHECK (cost_status IN ('unknown','known'))
)`;

async function wave1Database(): Promise<{ dbPath: string; jobs: SeededJob[] }> {
  const base = await mkdtemp(join(tmpdir(), "narralens-w2-jobs-"));
  dirs.push(base);
  const dbPath = join(base, "narralens.sqlite");
  const handle = new DatabaseSync(dbPath);
  handle.exec(WAVE1_JOB_DDL);
  handle.exec(`CREATE TABLE job_event (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, seq INTEGER NOT NULL,
    type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    UNIQUE (job_id, seq))`);
  handle.exec(`CREATE TABLE outbox (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0, terminal_reason TEXT NOT NULL DEFAULT '')`);
  const at = new Date(0).toISOString();
  const insert = handle.prepare(
    `INSERT INTO job(job_id, project_id, kind, payload_digest, state, lease_owner, lease_expires_at,
      attempt, max_attempts, provider_receipt_json, cost_status, quarantined_artifact_json,
      quarantined_receipt_json, proposal_id, comparison_id, error_json, created_at, updated_at, terminal_reason)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  type Row = [jobId: string, projectId: string, kind: string, state: string,
    owner: string | null, expires: number | null, attempt: number, maxAttempts: number,
    receipt: string | null, cost: string, quarantined: string | null];
  const rows: Row[] = [
    ["job_succeeded", "d1-30s", "proposal_comparison", "succeeded", null, null, 1, 1,
      JSON.stringify({ receipt_id: "r1" }), "known", null],
    ["job_leased", "d1-30s", "render", "running", "worker-7", 4102444800000, 1, 3, null, "unknown", null],
    ["job_exhausted", "d1-30s", "snapshot_publish", "failed", null, null, 3, 3, null, "unknown", null],
    ["job_quarantined", "d1-30s", "render", "cancelled", null, null, 2, 3,
      null, "unknown", JSON.stringify({ artifact: "derived/x.mp4" })],
  ];
  for (const [jobId, projectId, kind, state, owner, expires, attempt, maxAttempts,
    receipt, cost, quarantined] of rows) {
    insert.run(jobId, projectId, kind, createHash("sha256").update(jobId).digest("hex"), state,
      owner, expires, attempt, maxAttempts, receipt, cost, quarantined,
      quarantined === null ? null : JSON.stringify({ receipt_id: "late-r" }), null, null, null, at, at,
      state === "failed" ? "lease lost twice" : "");
  }
  handle.prepare("INSERT INTO job_event(job_id, seq, type, payload_json, created_at) VALUES(?,?,?,?,?)")
    .run("job_leased", 1, "running", "{}", at);
  handle.prepare("INSERT INTO outbox(topic, project_id, payload_json, created_at) VALUES(?,?,?,?)")
    .run("job.succeeded", "d1-30s", "{}", at);
  handle.close();
  return {
    dbPath,
    jobs: rows.map(([jobId, projectId, kind, state, owner, expires, attempt, maxAttempts,
      receipt, cost, quarantined]) => ({
      job_id: jobId, kind, state, lease_owner: owner, lease_expires_at: expires,
      attempt, max_attempts: maxAttempts, cost_status: cost,
      provider_receipt_json: receipt, quarantined_artifact_json: quarantined,
    })),
  };
}

function open(dbPath: string): RevisionStore {
  const store = new RevisionStore(dbPath);
  stores.push(store);
  return store;
}

function jobRows(store: RevisionStore): SeededJob[] {
  return store.compose((db) => db.prepare("SELECT * FROM job ORDER BY job_id").all()) as unknown as SeededJob[];
}

describe("W2-G02 the job table gains `materialize` without losing a row", () => {
  it("reopens a Wave 1 database and keeps every job field value exactly", async () => {
    const { dbPath, jobs } = await wave1Database();
    const store = open(dbPath);
    const after = jobRows(store);
    expect(after).toHaveLength(jobs.length);
    for (const expected of jobs) {
      const actual = after.find((row) => row.job_id === expected.job_id)!;
      for (const field of ["kind", "state", "lease_owner", "lease_expires_at", "attempt",
        "max_attempts", "cost_status", "provider_receipt_json", "quarantined_artifact_json"] as const) {
        expect(actual[field], `${expected.job_id}.${field}`).toEqual(expected[field]);
      }
    }
  });

  it("leaves events and the outbox untouched", async () => {
    const { dbPath } = await wave1Database();
    const store = open(dbPath);
    expect(store.compose((db) => db.prepare("SELECT COUNT(*) AS n FROM job_event").get()))
      .toMatchObject({ n: 1 });
    expect(store.compose((db) => db.prepare("SELECT COUNT(*) AS n FROM outbox").get()))
      .toMatchObject({ n: 1 });
  });

  it("accepts a materialize job after the migration and still rejects an unknown kind", async () => {
    const { dbPath } = await wave1Database();
    open(dbPath);
    const store2 = open(dbPath);
    const jobs = new PersistentJobStore(store2);
    const created = jobs.create({ projectId: "of_target", kind: "materialize", payload: { comparison_id: "cmp_1" } });
    const row = jobRows(store2).find((candidate) => candidate.job_id === created.job_id)!;
    expect(row.kind).toBe("materialize");
    expect(row.max_attempts).toBe(3);
    expect(() => jobs.create({ projectId: "of_target", kind: "not_a_kind" as JobKind, payload: {} })).toThrow();
  });

  it("is idempotent: reopening again performs no further migration and keeps the data", async () => {
    const { dbPath, jobs } = await wave1Database();
    open(dbPath);
    const store = open(dbPath);
    const again = jobRows(store);
    expect(again).toHaveLength(jobs.length);
    expect(store.compose((db) => db.prepare(
      "SELECT COUNT(*) AS n FROM schema_migration WHERE id='job_kind_materialize'",
    ).get())).toMatchObject({ n: 1 });
  });

  it("leaves the old table in place until the swap is proven, and records why", async () => {
    const { dbPath } = await wave1Database();
    open(dbPath);
    const store = open(dbPath);
    const record = store.compose((db) => db.prepare(
      "SELECT * FROM schema_migration WHERE id='job_kind_materialize'",
    ).get()) as Record<string, unknown>;
    expect(record).toMatchObject({ from_version: 1, to_version: 2 });
    expect(String(record.detail)).toContain("materialize");
    // The pre-migration shape is preserved in the same file, not just in a temp directory
    // that a cleanup step might remove.
    expect(String(record.backup_path)).not.toBe("");
    expect(existsSync(String(record.backup_path))).toBe(true);
  });

  it("writes the backup beside the database it migrated", async () => {
    const { dbPath } = await wave1Database();
    open(dbPath);
    const store = open(dbPath);
    const record = store.compose((db) => db.prepare(
      "SELECT backup_path FROM schema_migration WHERE id='job_kind_materialize'",
    ).get()) as { backup_path: string };
    expect(record.backup_path.startsWith(join(dbPath, ".."))).toBe(true);
  });

  it("does not rebuild or recreate the job table on a second open", async () => {
    const { dbPath } = await wave1Database();
    open(dbPath);
    const store = open(dbPath);
    const columns = store.compose((db) => db.prepare("PRAGMA table_info(job)").all()) as Array<{ name: string }>;
    // If the migration had recreated the table, the column set would come from the new
    // DDL rather than carrying every legacy column forward.
    expect(columns.map((column) => column.name).sort()).toEqual([
      "attempt", "cost_status", "created_at", "error_json", "job_id", "kind", "lease_expires_at",
      "lease_owner", "max_attempts", "payload_digest", "project_id", "provider_receipt_json",
      "proposal_id", "comparison_id", "quarantined_artifact_json", "quarantined_receipt_json",
      "state", "terminal_reason", "updated_at",
    ].sort());
  });

  it("fails startup loudly rather than silently skipping a half-migrated table", async () => {
    const { dbPath } = await wave1Database();
    open(dbPath);
    // Corrupt the record so the next open sees a migration it cannot verify. A Host that
    // "fixed" this by re-running would risk the very data loss the backup exists for.
    const store = open(dbPath);
    store.compose((db) => db.prepare("UPDATE schema_migration SET to_version=99 WHERE id='job_kind_materialize'").run());
    store.close();
    stores.length = 0;
    expect(() => new RevisionStore(dbPath)).toThrow(/job_kind_materialize:UNVERIFIABLE/u);
  });
});

describe("the copy is by explicit column list, not by position", () => {
  it("drops an unknown column rather than shifting every value after it", async () => {
    const { dbPath } = await wave1Database();
    const handle = new DatabaseSync(dbPath);
    // A column this module has never heard of, sitting in the middle of the row. Copying
    // by `SELECT *` order would shift `state`, `lease_owner` and everything after it.
    handle.exec("ALTER TABLE job ADD COLUMN unknown_future_column TEXT");
    handle.prepare("UPDATE job SET unknown_future_column='surprise' WHERE job_id='job_leased'").run();
    handle.close();

    const store = open(dbPath);
    const leased = jobRows(store).find((row) => row.job_id === "job_leased")!;
    expect(leased).toMatchObject({ state: "running", lease_owner: "worker-7", attempt: 1, max_attempts: 3 });
    const columns = (store.compose((db) => db.prepare("PRAGMA table_info(job)").all()) as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columns).not.toContain("unknown_future_column");
    // And the value did not land in a neighbouring column either.
    expect(Object.values(leased)).not.toContain("surprise");
  });
});

describe("the verification actually fires", () => {
  it("refuses the swap when a copied value does not match, keeping the old table and the backup", async () => {
    const { dbPath } = await wave1Database();
    const handle = new DatabaseSync(dbPath);
    try {
      // Corrupt one migrated row the way a bad copy would: a lease owner silently lost.
      expect(() => migrateJobKind(handle, dbPath, {
        fault: (point) => {
          expect(point).toBe("after_copy_before_verify");
          handle.prepare("UPDATE job_v2 SET lease_owner=NULL WHERE job_id='job_leased'").run();
        },
      })).toThrow(JobKindMigrationUnverifiable);
      // The original table is untouched, still holding every row it had.
      expect(handle.prepare("SELECT COUNT(*) AS n FROM job").get()).toMatchObject({ n: 4 });
      expect(handle.prepare("SELECT lease_owner FROM job WHERE job_id='job_leased'").get())
        .toMatchObject({ lease_owner: "worker-7" });
      expect(handle.prepare("SELECT COUNT(*) AS n FROM schema_migration WHERE id='job_kind_materialize'").get())
        .toMatchObject({ n: 0 });
    } finally { handle.close(); }
  });

  it("refuses the swap when the row count differs", async () => {
    const { dbPath } = await wave1Database();
    const handle = new DatabaseSync(dbPath);
    try {
      expect(() => migrateJobKind(handle, dbPath, {
        fault: () => { handle.prepare("DELETE FROM job_v2 WHERE job_id='job_exhausted'").run(); },
      })).toThrow(/row count changed/u);
      expect(handle.prepare("SELECT COUNT(*) AS n FROM job").get()).toMatchObject({ n: 4 });
    } finally { handle.close(); }
  });

  it("refuses the swap when a payload digest is altered", async () => {
    const { dbPath } = await wave1Database();
    const handle = new DatabaseSync(dbPath);
    try {
      expect(() => migrateJobKind(handle, dbPath, {
        fault: () => { handle.prepare("UPDATE job_v2 SET payload_digest=? WHERE job_id='job_succeeded'").run("f".repeat(64)); },
      })).toThrow(/payload digest changed/u);
      expect(handle.prepare("SELECT COUNT(*) AS n FROM job").get()).toMatchObject({ n: 4 });
    } finally { handle.close(); }
  });

  it("leaves a verifiable backup behind after refusing", async () => {
    const { dbPath } = await wave1Database();
    const handle = new DatabaseSync(dbPath);
    try {
      expect(() => migrateJobKind(handle, dbPath, {
        fault: () => { handle.prepare("UPDATE job_v2 SET attempt=0").run(); },
      })).toThrow(JobKindMigrationUnverifiable);
      const files = await readdir(join(dbPath, ".."));
      expect(files.some((name) => name.includes("pre-job-kind-v2"))).toBe(true);
    } finally { handle.close(); }
  });

  it("refuses to overwrite an existing backup", async () => {
    const { dbPath } = await wave1Database();
    const handle = new DatabaseSync(dbPath);
    try {
      await writeFile(`${dbPath}.pre-job-kind-v2.bak`, "stale", "utf8");
      expect(() => migrateJobKind(handle, dbPath)).toThrow(/already exists/u);
      expect(handle.prepare("SELECT COUNT(*) AS n FROM job").get()).toMatchObject({ n: 4 });
    } finally { handle.close(); }
  });
});

describe("W2-G02 job defaults for the new kind", () => {
  it("defaults materialize to three attempts, as the frozen plan states", () => {
    expect(maxAttemptsFor("materialize")).toBe(3);
    expect(maxAttemptsFor("materialize", 5)).toBe(5);
  });

  it("leaves the three legacy defaults exactly as M2.2 set them", () => {
    // These are pre-existing facts, not something this module may quietly retune: a
    // provider job that starts retrying would spend money without being asked.
    expect(maxAttemptsFor("proposal_comparison")).toBe(1);
    expect(maxAttemptsFor("render")).toBe(3);
    expect(maxAttemptsFor("snapshot_publish")).toBe(3);
  });
});
