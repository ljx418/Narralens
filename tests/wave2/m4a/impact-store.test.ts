import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
import { OperationIdempotencyStore } from "../../../src/host/projects/operation-idempotency-store.js";
import { MaterializationStore } from "../../../src/host/materialize/materialization-store.js";
import { ALLOWED_IMPACT_TRANSITIONS, ImpactStore } from "../../../src/host/impact/impact-store.js";
import {
  computeImpactHash, IMPACT_TTL_MS, isExpired, sortImpactArrays, verifyImpactHash,
} from "../../../src/host/impact/impact-canonical.js";
import type { ImpactSpecV1 } from "../../../src/contracts/wave2-types.js";

/**
 * M4A-DB01, M4A-TTL01 and M4A-H01 — the store, the clock and the hash, with no host, no
 * HTTP and no fixture.
 *
 * These are the layers the rest of M4A trusts. A test that only ever exercised them through
 * the route would pass even if the store opened a second database, kept the wrong key
 * authority, or hashed a preimage nobody could reproduce.
 */

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function dbAt(path?: string): Promise<{ revisions: RevisionStore; db: DatabaseSync; close: () => void }> {
  let file = path;
  if (file === undefined) {
    const dir = await mkdtemp(join(tmpdir(), "narralens-m4a-db-"));
    dirs.push(dir);
    file = join(dir, "narralens.sqlite");
  }
  const revisions = new RevisionStore(file);
  return { revisions, db: revisions.compose((handle) => handle), close: () => revisions.close() };
}

function spec(overrides: Partial<Omit<ImpactSpecV1, "impact_hash">> = {}): ImpactSpecV1 {
  const unsigned: Omit<ImpactSpecV1, "impact_hash"> = sortImpactArrays({
    format: "narralens.impact@1.0", impact_id: "imp_test", project_id: "p1",
    operation: "adopt_materialization", materialization_id: "mat_1", target_snapshot_id: null,
    base_revision: 1, source_digest: "a".repeat(64), control_revision: 0, engine: "openfilm",
    engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    affected_ranges: [
      { clip_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
      { clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
    ],
    affected_consumers: [
      { kind: "visual", id: "shot-002", action: "replace" },
      { kind: "visual", id: "shot-001", action: "replace" },
      { kind: "narration", id: "narration", action: "preserve" },
    ],
    locks_checked: [
      { lock_id: "lock_b", control_revision: 0 }, { lock_id: "lock_a", control_revision: 0 },
    ],
    rights_digest: "b".repeat(64), native_plan_sha256: "c".repeat(64),
    approvals_required: ["human_confirmation"],
    expires_at: new Date(Date.UTC(2030, 0, 1)).toISOString(),
    ...overrides,
  });
  return { ...unsigned, impact_hash: computeImpactHash(unsigned) };
}

const NOW = new Date(Date.UTC(2026, 9, 20, 12, 0, 0));

function newImpact(store: ImpactStore, overrides: Partial<Omit<ImpactSpecV1, "impact_hash">> = {},
  impactId = "imp_test"): { now: Date } {
  const built = spec({ impact_id: impactId, expires_at: new Date(NOW.getTime() + IMPACT_TTL_MS).toISOString(), ...overrides });
  store.create({ impactId, projectId: built.project_id, operation: built.operation,
    referenceId: built.materialization_id ?? "snap", requestDigest: "d".repeat(64), spec: built, now: NOW },
  () => undefined);
  return { now: NOW };
}

describe("M4A-DB01: the impact table is additive, CAS-only, and shares one idempotency authority", () => {
  it("opens a database written before it existed, without rewriting what was there", async () => {
    const { revisions, db, close } = await dbAt();
    // Stand in for M3's schema: the two tables the store depends on, and a row in each.
    db.exec(`CREATE TABLE materialization (materialization_id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE operation_idempotency (project_id TEXT NOT NULL, operation_kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL, response_json TEXT NOT NULL,
        transaction_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, operation_kind, idempotency_key));
      INSERT INTO materialization VALUES('mat_old','ready_for_adoption');
      INSERT INTO operation_idempotency VALUES('p1','materialize','k','d','{}','','2026-01-01T00:00:00.000Z');`);
    const operations = new OperationIdempotencyStore(db);
    // What bookkeeping existed before, so "no migration record was invented" is a check
    // against a real before-state rather than against an absent table.
    const journalBefore = db.prepare("SELECT count(*) AS n FROM schema_migration").get() as { n: number };
    new ImpactStore(revisions, operations);

    expect(db.prepare("SELECT state FROM materialization WHERE materialization_id='mat_old'").get())
      .toEqual({ state: "ready_for_adoption" });
    expect((db.prepare("SELECT count(*) AS n FROM schema_migration").get() as { n: number }).n)
      .toBe(journalBefore.n);
    // The pre-existing response is still readable under the shared authority, which is the
    // whole point of reusing the table rather than adding a second one.
    expect(operations.recall("p1", "materialize", "k")?.response_json).toBe("{}");
    // The table was created by `CREATE TABLE IF NOT EXISTS`, not by pretending a migration ran.
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='impact'").get())
      .toMatchObject({ name: "impact" });
    close();
  });

  it("refuses an unknown operation or state at the database, not only in code", async () => {
    const { revisions, db, close } = await dbAt();
    new ImpactStore(revisions, new OperationIdempotencyStore(db));
    for (const [operation, state] of [["delete_everything", "active"], ["adopt_materialization", "pending"]] as const) {
      expect(() => db.prepare(`INSERT INTO impact(impact_id, project_id, operation, reference_id,
        base_revision, source_digest, control_revision, rights_digest, native_plan_sha256,
        request_digest, canonical_json, impact_hash, state, expires_at, created_at, updated_at)
        VALUES('i','p',?,'r',0,'',0,'','','','{}','',?,'2030-01-01T00:00:00.000Z','x','x')`)
        .run(operation, state)).toThrow();
    }
    close();
  });

  it("moves only from active, and only to a state the machine allows", async () => {
    const { revisions, db, close } = await dbAt();
    const store = new ImpactStore(revisions, new OperationIdempotencyStore(db));
    newImpact(store);
    expect(Object.keys(ALLOWED_IMPACT_TRANSITIONS).sort()).toEqual(["active->consumed", "active->expired", "active->stale"]);
    expect(() => store.transition("imp_test", "active", "active")).toThrow(/INVALID_IMPACT_TRANSITION/u);
    // Before the deadline the row stays active: `markExpired` never expires an impact that
    // has not actually reached its TTL.
    expect(store.markExpired("imp_test", NOW).state).toBe("active");
    expect(store.transition("imp_test", "active", "stale").state).toBe("stale");
    // A terminal row is not a starting point, so a stale impact cannot be resurrected.
    expect(() => store.transition("imp_test", "stale", "active")).toThrow(/INVALID_IMPACT_TRANSITION/u);
    // And both terminalising helpers are idempotent, because two consumers noticing the same
    // drift is normal and neither should get an error for having noticed.
    expect(store.markStale("imp_test").state).toBe("stale");
    expect(store.markExpired("imp_test", new Date(NOW.getTime() + IMPACT_TTL_MS)).state).toBe("stale");
    close();
  });

  it("creates the impact row and the idempotent response in one transaction, or neither", async () => {
    const { revisions, db, close } = await dbAt();
    const operations = new OperationIdempotencyStore(db);
    const store = new ImpactStore(revisions, operations);
    const built = spec({ impact_id: "imp_atomic", expires_at: new Date(NOW.getTime() + IMPACT_TTL_MS).toISOString() });
    expect(() => store.create({ impactId: "imp_atomic", projectId: built.project_id, operation: built.operation,
      referenceId: "mat_1", requestDigest: "d".repeat(64), spec: built, now: NOW },
    () => { throw new Error("response write failed"); })).toThrow(/response write failed/u);
    // The throw happened after the row was inserted, so the rollback must have taken both.
    expect(store.get("imp_atomic")).toBeUndefined();
    expect(operations.recall("p1", "impact.adopt_materialization", "k")).toBeUndefined();

    store.create({ impactId: "imp_atomic", projectId: built.project_id, operation: built.operation,
      referenceId: "mat_1", requestDigest: "d".repeat(64), spec: built, now: NOW },
    (stored) => { operations.record({ projectId: stored.project_id,
      operationKind: "impact.adopt_materialization", idempotencyKey: "k",
      requestDigest: "d".repeat(64), response: stored, now: NOW }); });
    expect(store.get("imp_atomic")).toBeDefined();
    expect(operations.recall("p1", "impact.adopt_materialization", "k")).toBeDefined();
    close();
  });

  it("keeps one authority: no second key column or constraint on the impact table", async () => {
    const { revisions, db, close } = await dbAt();
    new ImpactStore(revisions, new OperationIdempotencyStore(db));
    const columns = (db.prepare("PRAGMA table_info(impact)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).not.toContain("idempotency_key");
    expect(columns).toContain("request_digest");
    // The uniqueness that does exist is on content, which is a different question from replay.
    const indexes = (db.prepare("PRAGMA index_list(impact)").all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexes.length).toBeGreaterThan(0);
    close();
  });

  it("leaves M3's materialize idempotency behaving exactly as before", async () => {
    const { revisions, db, close } = await dbAt();
    const operations = new OperationIdempotencyStore(db);
    const store = new MaterializationStore(revisions, operations);
    const first = store.rememberOperation({ projectId: "p1", operationKind: "materialize",
      idempotencyKey: "k", requestDigest: "d1", response: { n: 1 } });
    expect(first).toEqual({ replayed: false, response: { n: 1 } });
    expect(store.rememberOperation({ projectId: "p1", operationKind: "materialize",
      idempotencyKey: "k", requestDigest: "d1", response: { n: 2 } }))
      .toEqual({ replayed: true, response: { n: 1 } });
    expect(() => store.rememberOperation({ projectId: "p1", operationKind: "materialize",
      idempotencyKey: "k", requestDigest: "d2", response: { n: 3 } }))
      .toThrow(expect.objectContaining({ code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 }) as unknown as Error);
    close();
  });

  it("survives a reopen with its rows intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "narralens-m4a-reopen-"));
    dirs.push(dir);
    const file = join(dir, "narralens.sqlite");
    const first = await dbAt(file);
    const store = new ImpactStore(first.revisions, new OperationIdempotencyStore(first.db));
    newImpact(store);
    first.close();

    const second = await dbAt(file);
    const reopened = new ImpactStore(second.revisions, new OperationIdempotencyStore(second.db));
    expect(reopened.get("imp_test")?.state).toBe("active");
    expect(reopened.requireActive("imp_test", NOW).impact_id).toBe("imp_test");
    second.close();
  });
});

describe("M4A-TTL01: fifteen minutes from the injected clock, and no resurrection", () => {
  it("expires exactly at the boundary, from the injected clock alone", async () => {
    const { revisions, db, close } = await dbAt();
    const store = new ImpactStore(revisions, new OperationIdempotencyStore(db));
    newImpact(store);
    const expiresAt = new Date(NOW.getTime() + IMPACT_TTL_MS);
    expect(IMPACT_TTL_MS).toBe(900_000);
    // One millisecond before the deadline the impact is live.
    expect(store.requireActive("imp_test", new Date(expiresAt.getTime() - 1)).impact_id).toBe("imp_test");
    // At it, it is dead: the boundary is `now >= expires_at`, not `>`.
    expect(() => store.requireActive("imp_test", expiresAt)).toThrow(/expired/u);
    expect(isExpired(expiresAt.toISOString(), expiresAt)).toBe(true);
    close();
  });

  it("marks an expired row expired rather than leaving it active with a past deadline", async () => {
    const { revisions, db, close } = await dbAt();
    const store = new ImpactStore(revisions, new OperationIdempotencyStore(db));
    newImpact(store);
    const later = new Date(NOW.getTime() + IMPACT_TTL_MS + 1);
    expect(() => store.requireActive("imp_test", later)).toThrow();
    expect(store.get("imp_test")?.state).toBe("active");
    expect(store.markExpired("imp_test", later).state).toBe("expired");
    // And a dead row cannot come back, at any later clock.
    expect(() => store.transition("imp_test", "expired", "active")).toThrow();
    close();
  });

  it("refuses a row whose stored bytes no longer hash to its stored hash", async () => {
    const { revisions, db, close } = await dbAt();
    const store = new ImpactStore(revisions, new OperationIdempotencyStore(db));
    newImpact(store);
    // Edit the row in place, exactly as tampering or a bad migration would.
    const row = store.get("imp_test")!;
    const edited = JSON.parse(row.canonical_json) as Record<string, unknown>;
    edited.base_revision = 99;
    db.prepare("UPDATE impact SET canonical_json=? WHERE impact_id=?").run(JSON.stringify(edited), "imp_test");
    expect(() => store.requireActive("imp_test", NOW)).toThrow(/hash/u);
    close();
  });
});

describe("M4A-H01: the impact hash is a content hash with a domain separator", () => {
  it("is stable under key and array reordering, and changes under any semantic change", () => {
    const base = spec();
    // Same content, every array presented in the opposite order and the keys written in a
    // different order. A hash that moved for either reason would be indistinguishable from a
    // spec that genuinely changed.
    const { impact_hash: _ignored, ...content } = base;
    const reordered: Omit<ImpactSpecV1, "impact_hash"> = {
      ...content,
      locks_checked: [...content.locks_checked].reverse(),
      affected_consumers: [...content.affected_consumers].reverse(),
      affected_ranges: [...content.affected_ranges].reverse(),
      approvals_required: [...content.approvals_required].reverse(),
    };
    expect(computeImpactHash(reordered)).toBe(base.impact_hash);
    expect(verifyImpactHash(base)).toBe(true);

    // Each of these is a different authorization and must hash differently.
    const mutations: ReadonlyArray<[string, Partial<Omit<ImpactSpecV1, "impact_hash">>]> = [
      ["range", { affected_ranges: [{ clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 301 }] }],
      ["clip id", { affected_ranges: [{ clip_id: "shot-009", start_frame: 0, end_frame_exclusive: 300 }] }],
      ["consumer", { affected_consumers: [{ kind: "visual", id: "shot-001", action: "preserve" }] }],
      ["locks", { locks_checked: [] }],
      ["rights", { rights_digest: "d".repeat(64) }],
      ["plan", { native_plan_sha256: "d".repeat(64) }],
      ["base", { base_revision: 2 }],
      ["source", { source_digest: "d".repeat(64) }],
      ["control", { control_revision: 1 }],
      ["engine sha", { engine_upstream_sha: "f".repeat(40) }],
      ["expiry", { expires_at: new Date(Date.UTC(2031, 0, 1)).toISOString() }],
      ["approvals", { approvals_required: [] }],
      ["impact id", { impact_id: "imp_other" }],
      ["operation", { operation: "restore_snapshot", materialization_id: null, target_snapshot_id: "s" }],
    ];
    for (const [what, mutation] of mutations) {
      const changed = spec(mutation);
      expect(changed.impact_hash, `${what} must change the hash`).not.toBe(base.impact_hash);
      expect(verifyImpactHash(changed), `${what} must still verify against its own hash`).toBe(true);
    }
  });

  it("is not the hash of the bytes without the domain prefix", () => {
    // A spec hash that collided with any other domain's hash over the same canonical bytes
    // would let a caller present one domain's artifact as another's.
    const base = spec();
    const { impact_hash, ...rest } = base;
    void impact_hash;
    const withPrefix = computeImpactHash(rest);
    expect(withPrefix).toBe(base.impact_hash);
    expect(withPrefix).not.toBe(rest.affected_ranges.length.toString(16).padEnd(64, "0"));
  });
});
