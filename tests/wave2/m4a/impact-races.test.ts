import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LockService } from "../../../src/host/projects/lock-service.js";
import { NarralensHost } from "../../../src/host/server.js";
import { IMPACT_TTL_MS } from "../../../src/host/impact/impact-canonical.js";
import { impactRequestDigest } from "../../../src/host/impact/impact-service.js";
import {
  adoptBody, migrate, postImpact, readyMaterialization, start, stopAll,
} from "./harness.js";
import type { Started } from "./harness.js";
import type { ImpactRequestV1 } from "../../../src/contracts/wave2-types.js";

/**
 * TX-02A, TX-05A and the race/fault matrix.
 *
 * The single most important property in this file is negative: **a premise that changes
 * between the first check and the insert must leave no active impact behind.** Everything
 * else — a 201, a 423, a 428 — is a lesser claim.
 *
 * The races are injected through `ImpactService`'s named fault points rather than by racing
 * two promises at each other. A timing race only fails on the machine's schedule, which is
 * how a test ends up asserting that nothing happened; a named point puts the change at a
 * *chosen* boundary every run, so the assertion is about the ordering and not about luck.
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

/** A mutable clock the test owns, so TTL and its boundary are decided, not waited for. */
function clockAt(start: Date): { now: () => Date; set: (value: Date) => void; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, set: (value: Date) => { current = value; },
    advance: (ms: number) => { current = new Date(current.getTime() + ms); } };
}

const T0 = new Date(Date.UTC(2026, 9, 20, 12, 0, 0));

/** A fixed instant for the fault-injection cases, so their timing is not the wall clock's. */
const clockNow = (): Date => new Date(Date.UTC(2026, 9, 20, 12, 0, 0));

async function started(options: { impactClock?: () => Date; impactFault?: (point: string) => Promise<void> | void } = {}): Promise<Started> {
  const running = await start(options);
  hosts.push(running.host); dirs.push(running.base);
  return running;
}

describe("TX-02A / M4A-TTL01: an impact outlives nothing it was computed from", () => {
  it("expires at exactly fifteen minutes and is not revived by a replay with the same key", async () => {
    const clock = clockAt(T0);
    const running = await started({ impactClock: clock.now });
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);
    const body = adoptBody(view, materialization.materialization_id, "ttl-1");

    const first = await postImpact(running, projectId, body);
    expect(first.status).toBe(201);
    expect(first.body.expires_at).toBe(new Date(T0.getTime() + IMPACT_TTL_MS).toISOString());

    // One millisecond early: still live, and the replay returns the *same* spec.
    clock.advance(IMPACT_TTL_MS - 1);
    const early = await postImpact(running, projectId, body);
    expect(early.status).toBe(201);
    expect(early.body.impact_id).toBe(first.body.impact_id);
    expect(early.body.expires_at).toBe(first.body.expires_at);

    // At the deadline: dead. The same key does not extend it.
    clock.set(new Date(T0.getTime() + IMPACT_TTL_MS));
    const atBoundary = await postImpact(running, projectId, body);
    expect(atBoundary.status).toBe(428);
    expect(atBoundary.body.code).toBe("IMPACT_STALE");
    // And the row's own state was corrected rather than left active with a past deadline.
    expect(running.host.impacts.get(String(first.body.impact_id))?.state).toBe("expired");

    // A new key is a fresh evaluation; the old one stays dead.
    clock.set(new Date(T0.getTime() + IMPACT_TTL_MS + 1));
    const fresh = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "ttl-2"));
    expect(fresh.status).toBe(201);
    expect(fresh.body.impact_id).not.toBe(first.body.impact_id);
    expect(running.host.impacts.get(String(first.body.impact_id))?.state).toBe("expired");
  }, 600_000);

  it("rejects a stale base, source or control before it computes anything", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);
    const good = adoptBody(view, materialization.materialization_id, "tx02a-stale");

    for (const [what, mutate] of [
      ["base", (b: Record<string, unknown>) => { b.base_revision = Number(b.base_revision) + 1; }],
      ["source", (b: Record<string, unknown>) => { b.expected_source_digest = "d".repeat(64); }],
      ["control", (b: Record<string, unknown>) => { b.control_revision = Number(b.control_revision) + 1; }],
    ] as const) {
      const body = structuredClone(good) as Record<string, unknown>;
      mutate(body);
      body.idempotency_key = `tx02a-${what}`;
      const response = await postImpact(running, projectId, body);
      expect(response.status, what).toBe(409);
      expect(["REVISION_CONFLICT", "SOURCE_CHANGED"], what).toContain(response.body.code);
    }
    expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
  }, 600_000);

  it("returns 428 from requireCurrent once the source has moved, and marks the row stale", async () => {
    const clock = clockAt(T0);
    const running = await started({ impactClock: clock.now });
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);
    const created = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "tx02a-require"));
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);

    // Still current: a consume would be allowed.
    await expect(running.host.impact.requireCurrent(impactId, clock.now())).resolves
      .toMatchObject({ impact_id: impactId });

    // Now the materialization stops being ready. That happened *after* the insert, so no
    // transaction could have rolled it back; `requireCurrent` is where it is caught.
    running.host.materializations.markStale(materialization.materialization_id,
      ["SOURCE_DIGEST_CHANGED"], clock.now());
    await expect(running.host.impact.requireCurrent(impactId, clock.now()))
      .rejects.toMatchObject({ code: "IMPACT_STALE", status: 428 });
    expect(running.host.impacts.get(impactId)?.state).toBe("stale");
    // And a stale impact is never handed out again, even by its own replay path.
    const replay = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "tx02a-require"));
    expect(replay.status).toBe(428);
  }, 600_000);
});

describe("TX-05A: a change between the first check and the insert leaves no active impact", () => {
  /**
   * The fault point fires *inside* the request, while the service holds its own read barrier,
   * and acquires the lock through the same `LockService` a client would. Taking it from a
   * timer instead would be a scheduling race: it would pass on a quiet machine and fail on a
   * busy one, and either way it would be asserting that nothing happened rather than that
   * the ordering is right.
   */
  const points = ["after_inspect", "after_graph", "after_locks", "before_insert"] as const;

  for (const point of points) {
    it(`refuses and writes no row when a visual lock appears at ${point}`, async () => {
      let acquired = false;
      let fired = false;
      const running = await started({
        impactFault: (name: string): void => {
          if (name !== point || acquired) return;
          acquired = true;
          const locks = new LockService(running.host.revisions);
          const revision = Number((running.host.revisions.compose((handle) => handle)
            .prepare("SELECT revision FROM project_state WHERE project_id=?")
            .get(projectId) as { revision: number }).revision);
          locks.acquire({ projectId, lockType: "visual", scope: "shot", targetId: "shot-002",
            startFrame: 300, endFrameExclusive: 600, owner: "racer", reason: `racing lock at ${point}` },
          revision);
          fired = true;
        },
      });
      const { projectId, view } = await migrate(running);
      const materialization = await readyMaterialization(running.host, projectId);

      const response = await postImpact(running, projectId,
        adoptBody(view, materialization.materialization_id, `tx05a-${point}`));
      expect(fired, `the fault at ${point} must have fired`).toBe(true);
      // Either the lock check catches it, or the second currentness check does. Both are
      // refusals; neither may leave an authorization behind.
      // Acquiring a lock also moves the control revision, which the materialization's own
      // re-verification may notice first and answer 428 with. The claim under test is "no
      // authorization is issued", not "this particular code is the one that fires".
      expect([409, 423, 428], `${point}: ${JSON.stringify(response.body)}`).toContain(response.status);
      expect(running.host.impacts.byProject(projectId), point).toHaveLength(0);
      // Acquiring a lock legitimately moves the control revision, and M3's own re-verification
      // marks a prepared materialization stale when it does. So the row *may* be stale here —
      // what must never happen is an authorization surviving the refusal.
    }, 600_000);
  }

  it("refuses and writes no row when the control revision moves at before_insert", async () => {
    let moved = false;
    let fired = false;
    let target: { host: NarralensHost; projectId: string } | undefined;
    const running = await started({
      impactFault: (name: string): void => {
        if (name !== "before_insert" || moved) return;
        moved = true;
        const locks = new LockService(running.host.revisions);
        const revision = Number((running.host.revisions.compose((handle) => handle)
          .prepare("SELECT revision FROM project_state WHERE project_id=?")
          .get(target!.projectId) as { revision: number }).revision);
        // Any lock moves the control revision, which is a real premise change rather than a
        // simulation of one.
        locks.acquire({ projectId: target!.projectId, lockType: "duration", scope: "project",
          owner: "control-racer", reason: "move the control revision" }, revision);
        fired = true;
      },
    });
    const { projectId, view } = await migrate(running);
    target = { host: running.host, projectId };
    const materialization = await readyMaterialization(running.host, projectId);

    const response = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "tx05a-control"));
    expect(fired).toBe(true);
    expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(400);
    expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
  }, 600_000);

  it("refuses and writes no row when the materialization goes stale mid-computation", async () => {
    let moved = false;
    const running = await started({
      impactFault: (name: string): void => {
        if (name !== "after_inspect" || moved) return;
        moved = true;
        running.host.materializations.markStale(materialization.materialization_id,
          ["SOURCE_DIGEST_CHANGED"], clockNow());
      },
    });
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);

    const response = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "tx05a-stale"));
    expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(400);
    expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
  }, 600_000);
});

describe("M4A-R01: the route answers a client consistently and idempotently", () => {
  it("replays the whole spec for the same key and digest, and 409s a different digest", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);
    const body = adoptBody(view, materialization.materialization_id, "r01-key");

    const first = await postImpact(running, projectId, body);
    expect(first.status).toBe(201);
    const replay = await postImpact(running, projectId, body);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    // One row, and one response under the shared authority.
    expect(running.host.impacts.byProject(projectId)).toHaveLength(1);
    const operations = new OperationIdempotencyStoreProbe(running.host, projectId);
    expect(operations.count("impact.adopt_materialization", "r01-key")).toBe(1);

    // A different digest under the same key is a conflict, and creates nothing.
    const different = adoptBody(view, materialization.materialization_id, "r01-key");
    (different as Record<string, unknown>).base_revision = Number((different as Record<string, unknown>).base_revision);
    (different as Record<string, unknown>).expected_source_digest = "e".repeat(64);
    const conflict = await postImpact(running, projectId, different);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(running.host.impacts.byProject(projectId)).toHaveLength(1);
  }, 600_000);

  it("binds the digest to the request with the idempotency key removed", () => {
    const request: ImpactRequestV1 = {
      format: "narralens.impact-request@1.0", base_revision: 1,
      expected_source_digest: "a".repeat(64), control_revision: 0,
      intent: { op: "adopt_materialization", materialization_id: "mat_1" }, idempotency_key: "k1",
    };
    const other = { ...request, idempotency_key: "k2" };
    // If the key were inside the digest, these would differ and a replay could never match.
    expect(impactRequestDigest(request)).toBe(impactRequestDigest(other));
    expect(impactRequestDigest(request)).not.toBe(
      impactRequestDigest({ ...request, base_revision: 2 }));
  });

  it("blocks a restore intent rather than passing the active source off as an old snapshot", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    await readyMaterialization(running.host, projectId);
    const response = await postImpact(running, projectId, {
      format: "narralens.impact-request@1.0", base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      intent: { op: "restore_snapshot", target_snapshot_id: "snap_old" },
      idempotency_key: "r01-restore",
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("CAPABILITY_NOT_ENABLED");
    expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
  }, 600_000);

  it("refuses a materialization that does not exist, and one that belongs elsewhere, the same way", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);

    const missing = await postImpact(running, projectId,
      adoptBody(view, "mat_does_not_exist", "r01-missing"));
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("NOT_FOUND");

    // There is only one migratable catalog project, so the cross-project case is produced by
    // moving the row's own `project_id`. That is the branch under test — a row that resolves
    // but belongs to something else — without needing a second migration to exist.
    running.host.revisions.compose((handle) => handle)
      .prepare("UPDATE materialization SET project_id=? WHERE materialization_id=?")
      .run("of_some_other_project", materialization.materialization_id);
    const cross = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "r01-cross"));
    expect(cross.status, JSON.stringify(cross.body)).toBe(404);
    // Identical answer, so the response cannot be used to discover that the id exists.
    expect(cross.body.code).toBe(missing.body.code);
    expect(JSON.stringify({ ...cross.body, correlation_id: "", details: undefined }))
      .toBe(JSON.stringify({ ...missing.body, correlation_id: "", details: undefined }));
    expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
  }, 600_000);

  it("keeps versioned edits and history restore unmounted, and the legacy routes working", async () => {
    const running = await started();
    for (const path of [
      `/api/migration/v1/projects/${running.host.projectResolver ? "d1-30s" : "d1-30s"}/edits`,
      "/api/migration/v1/projects/d1-30s/history/restore",
    ]) {
      const response = await fetch(`${running.origin}${path}`, {
        method: "POST", headers: { origin: running.origin, authorization: `Bearer ${running.token}`,
          "content-type": "application/json" }, body: "{}",
      });
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toMatch(/narralens\.\w+@/u);
    }
    // The Wave 1 and M3 routes still answer, so 404 above means "unmounted", not "broken".
    expect((await fetch(`${running.origin}/api/projects/d1-30s`, {
      headers: { origin: running.origin, authorization: `Bearer ${running.token}` } })).status).toBe(200);
    expect((await fetch(`${running.origin}/api/migration/v1/projects/d1-30s/engine`, {
      headers: { origin: running.origin, authorization: `Bearer ${running.token}` } })).status).toBe(200);
  }, 600_000);
});

describe("M4A-NW01: an impact changes nothing but its own two rows", () => {
  it("leaves source, revision, commit, pointer, binding, ledger, materialization, job and outbox identical", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);
    const before = snapshotAuthority(running.host, projectId);

    const created = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "nw01-1"));
    expect(created.status).toBe(201);
    // And a replay changes nothing either.
    expect((await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "nw01-1"))).status).toBe(201);

    const after = snapshotAuthority(running.host, projectId);
    for (const key of Object.keys(before) as Array<keyof typeof before>) {
      expect(after[key], key).toEqual(before[key]);
    }
    // The only rows that appeared are the two M4A is allowed to write.
    expect(running.host.impacts.byProject(projectId)).toHaveLength(1);
  }, 600_000);

  it("leaves the migrated copy's bytes byte-for-byte identical", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);
    const root = view.source_root.value;
    const before = await treeOf(root);
    await postImpact(running, projectId, adoptBody(view, materialization.materialization_id, "nw01-2"));
    expect(await treeOf(root)).toEqual(before);
  }, 600_000);
});

/** Everything an impact must not move, read as one comparable object. */
function snapshotAuthority(host: NarralensHost, projectId: string): Record<string, unknown> {
  const db = host.revisions.compose((handle) => handle);
  return {
    revision: db.prepare("SELECT revision FROM project_state WHERE project_id=?").get(projectId),
    active_commit: db.prepare("SELECT * FROM active_commit WHERE project_id=?").get(projectId),
    binding: host.revisions.readEngineBinding(projectId),
    ledger: host.assetLedger.assets(projectId),
    migration: db.prepare("SELECT state, target_snapshot_id, target_source_digest, updated_at FROM migration WHERE target_project_id=?")
      .all(projectId),
    materialization: db.prepare("SELECT materialization_id, state, updated_at, plan_json, proxy_json, lineage_json, rights_digest FROM materialization WHERE project_id=?")
      .all(projectId),
    job: db.prepare("SELECT job_id, state, updated_at FROM job WHERE project_id=?").all(projectId),
    outbox: db.prepare("SELECT count(*) AS n FROM outbox").get(),
    outbox_delivery: db.prepare("SELECT count(*) AS n FROM outbox_delivery").get(),
    snapshot: db.prepare("SELECT * FROM snapshot").all(),
  };
}

/** Every byte under a directory, by relative path and content hash. */
async function treeOf(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      files[relative(root, full)] = createHash("sha256").update(await readFile(full)).digest("hex");
    }
  };
  await walk(root);
  return files;
}

/** Counts response rows for one key, read through the shared authority. */
class OperationIdempotencyStoreProbe {
  constructor(private readonly host: NarralensHost, private readonly projectId: string) {}
  count(kind: string, key: string): number {
    const db = this.host.revisions.compose((handle) => handle);
    const row = db.prepare("SELECT count(*) AS n FROM operation_idempotency WHERE project_id=? AND operation_kind=? AND idempotency_key=?")
      .get(this.projectId, kind, key) as { n: number };
    return Number(row.n);
  }
}
