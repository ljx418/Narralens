import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LockService } from "../../../src/host/projects/lock-service.js";
import { NarralensHost } from "../../../src/host/server.js";
import { HttpError } from "../../../src/host/api-error.js";
import { IMPACT_TTL_MS } from "../../../src/host/impact/impact-canonical.js";
import { impactRequestDigest } from "../../../src/host/impact/impact-service.js";
import {
  adoptBody, migrate, postImpact, readyMaterialization, start, stopAll,
} from "./harness.js";
import type { Started } from "./harness.js";
import type { ImpactRequestV1 } from "../../../src/contracts/wave2-types.js";
import type { ActivatedProjectView } from "../../../src/host/projects/project-resolver.js";

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

/** The codes ADR-W2.0-004 §7 defines for a refusal. An internal error is not one of them. */
const REFUSAL_CODES: readonly string[] = [
  "REVISION_CONFLICT", "SOURCE_CHANGED", "IDEMPOTENCY_KEY_CONFLICT", "INVALID_REQUEST",
  "PROJECT_ATTENTION_REQUIRED", "TARGET_LOCKED", "IMPACT_STALE", "MISSING_ASSET",
  "CAPABILITY_NOT_ENABLED", "ORIGIN_REJECTED", "ENGINE_UNAVAILABLE",
];

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

  it("marks a direct consumer at the TTL boundary expired rather than stale", async () => {
    const clock = clockAt(T0);
    const running = await started({ impactClock: clock.now });
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId, "ttl-direct");
    const created = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "ttl-direct"));
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);

    clock.set(new Date(T0.getTime() + IMPACT_TTL_MS));
    await expect(running.host.impact.requireCurrent(impactId))
      .rejects.toMatchObject({ code: "IMPACT_STALE", status: 428 });
    expect(running.host.impacts.get(impactId)?.state).toBe("expired");
  }, 600_000);

  /**
   * The materialization's own premises, each falsifiable.
   *
   * `readyMaterialization` builds its row from the *same live view* the request will use, so
   * the service's "materialization vs project" and "inventory vs row" comparisons could not
   * be false in any harness-backed test. Each case below rewrites one stored fact directly,
   * which is the only way to make those comparisons reachable.
   */
  const materializationArms: ReadonlyArray<readonly [string, string, string]> = [
    ["base_revision", "base_revision", "9"],
    ["source_digest", "source_digest", "'b".concat("b".repeat(63), "'")],
    ["control_revision", "control_revision", "7"],
    ["asset_inventory_sha256", "asset_inventory_sha256", "'c".concat("c".repeat(63), "'")],
  ];
  for (const [what, column, value] of materializationArms) {
    it(`refuses a materialization whose ${what} no longer matches the project`, async () => {
      const running = await started();
      const { projectId, view } = await migrate(running);
      const key = `tx02a-mat-${what}`;
      const materialization = await readyMaterialization(running.host, projectId, key);
      running.host.revisions.compose((handle) => handle)
        .prepare(`UPDATE materialization SET ${column}=? WHERE materialization_id=?`)
        .run(column === "base_revision" || column === "control_revision"
          ? Number(value) : value, materialization.materialization_id);

      const response = await postImpact(running, projectId,
        adoptBody(view, materialization.materialization_id, key));
      // Two codes are correct here. `MaterializeService.read` re-verifies before the service's
      // own comparison runs, and a row whose base/source/control no longer match goes stale on
      // that re-verification — 428. The inventory arm never reaches it and answers 409. Both
      // refuse, neither writes, and the difference is which existing check noticed first.
      expect([409, 428], `${what}: ${JSON.stringify(response.body)}`).toContain(response.status);
      expect(["REVISION_CONFLICT", "SOURCE_CHANGED", "IMPACT_STALE"], what).toContain(response.body.code);
      expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
    }, 600_000);
  }

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

  /**
   * One arm per premise, driven through the function the gate names.
   *
   * The earlier version of this test moved the *materialization*, so it exercised one of the
   * eight arms while claiming another; `base`/`source`/`control` were proven through `create`
   * (which answers 409, not the 428 this case is about) and `rights`/`plan` were not driven
   * at all. Each row below mutates exactly one durable fact and asserts the same outcome.
   */
  const requireCurrentArms: ReadonlyArray<
    readonly [string, (host: NarralensHost, projectId: string, view: ActivatedProjectView, materializationId: string) => void]
  > = [
    ["base revision", (host, projectId) => {
      // `resolveActivated` reads the revision from the active commit, not from
      // `project_state`, so this has to move the row the resolver actually reads.
      host.revisions.compose((handle) => handle)
        .prepare("UPDATE active_commit SET revision=revision+1 WHERE project_id=?").run(projectId);
    }],
    ["source digest", (host, projectId) => {
      host.revisions.compose((handle) => handle)
        .prepare("UPDATE active_commit SET source_digest=? WHERE project_id=?")
        .run("7".repeat(64), projectId);
    }],
    ["control revision", (host, projectId) => {
      new LockService(host.revisions).acquire({
        projectId, lockType: "duration", scope: "project", owner: "racer", reason: "move control",
      }, 1);
    }],
    ["rights digest", (host, _projectId, _view, materializationId) => {
      host.revisions.compose((handle) => handle)
        .prepare("UPDATE materialization SET rights_digest=? WHERE materialization_id=?")
        .run("6".repeat(64), materializationId);
    }],
    ["native plan", (host, _projectId, _view, materializationId) => {
      host.revisions.compose((handle) => handle)
        .prepare("UPDATE materialization SET plan_json=? WHERE materialization_id=?")
        .run(JSON.stringify({ format: "narralens.native-plan@1.0", engine: "openfilm",
          fps: { num: 30, den: 1 }, clips: [], narration_policy: "preserve",
          duration_policy: "preserve", total_frames: 1, plan_sha256: "5".repeat(64) }),
        materializationId);
    }],
    ["materialization state", (host, _projectId, _view, materializationId) => {
      host.materializations.markStale(materializationId, ["SOURCE_DIGEST_CHANGED"], new Date());
    }],
    ["materialization removed", (host, _projectId, _view, materializationId) => {
      host.revisions.compose((handle) => handle)
        .prepare("DELETE FROM materialization WHERE materialization_id=?").run(materializationId);
    }],
    ["the stored bytes", (host, _projectId, _view, materializationId) => {
      host.revisions.compose((handle) => handle)
        .prepare("UPDATE impact SET canonical_json=? WHERE impact_id=?")
        .run("{}", impactIdFor(host, materializationId));
    }],
  ];

  for (const [arm, mutate] of requireCurrentArms) {
    it(`returns 428 and marks the row stale when ${arm} has moved`, async () => {
      const key = `tx02a-${arm.replace(/ /gu, "-")}`;
      const running = await started();
      const { projectId, view } = await migrate(running);
      const materialization = await readyMaterialization(running.host, projectId, key);
      const created = await postImpact(running, projectId,
        adoptBody(view, materialization.materialization_id, key));
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const impactId = String(created.body.impact_id);

      mutate(running.host, projectId, view, materialization.materialization_id);

      await expect(running.host.impact.requireCurrent(impactId))
        .rejects.toMatchObject({ code: "IMPACT_STALE", status: 428 });
      expect(running.host.impacts.get(impactId)?.state, arm).toBe("stale");
    }, 600_000);
  }

  it("still answers an unchanged impact, so the arms above are not vacuously failing", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId, "tx02a-clean");
    const created = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "tx02a-clean"));
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);
    await expect(running.host.impact.requireCurrent(impactId)).resolves.toMatchObject({ impact_id: impactId });
    expect(running.host.impacts.get(impactId)?.state).toBe("active");
  }, 600_000);

  it("rejects real source bytes changed after insertion", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId, "post-source-drift");
    const created = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "post-source-drift"));
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);

    await writeFile(join(view.source_root.value, "film.html"), "<!doctype html><html></html>\n", "utf8");
    await expect(running.host.impact.requireCurrent(impactId))
      .rejects.toMatchObject({ code: "IMPACT_STALE", status: 428 });
    expect(running.host.impacts.get(impactId)?.state).toBe("stale");
  }, 600_000);

  it("rejects replay after real source bytes changed after insertion", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId, "post-source-replay");
    const body = adoptBody(view, materialization.materialization_id, "post-source-replay");
    const created = await postImpact(running, projectId, body);
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);

    await writeFile(join(view.source_root.value, "film.html"), "<!doctype html><html></html>\n", "utf8");
    const replay = await postImpact(running, projectId, body);
    expect(replay.status).toBe(428);
    expect(replay.body.code).toBe("IMPACT_STALE");
    expect(running.host.impacts.get(impactId)?.state).toBe("stale");
  }, 600_000);

  it("rejects real asset bytes changed after insertion", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId, "post-asset-drift");
    const created = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "post-asset-drift"));
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);
    const asset = running.host.assetLedger.assets(projectId)
      .find((candidate) => !/\.(vtt|srt)$/iu.test(candidate.target_path));
    expect(asset).toBeDefined();

    await writeFile(join(view.source_root.value, asset!.target_path), "changed after impact\n", "utf8");
    await expect(running.host.impact.requireCurrent(impactId))
      .rejects.toMatchObject({ code: "IMPACT_STALE", status: 428 });
    expect(running.host.impacts.get(impactId)?.state).toBe("stale");
  }, 600_000);

  it("rejects rights changed after insertion through materialization re-verification", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId, "post-rights-drift");
    const created = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "post-rights-drift"));
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);
    running.host.revisions.compose((db) => db.prepare(
      "UPDATE migrated_asset SET license_json=? WHERE project_id=?",
    ).run(JSON.stringify({ status: "restricted", label: "changed", commercial_use: false }), projectId));

    await expect(running.host.impact.requireCurrent(impactId))
      .rejects.toMatchObject({ code: "IMPACT_STALE", status: 428 });
    expect(running.host.materializations.require(materialization.materialization_id).state).toBe("stale");
    expect(running.host.impacts.get(impactId)?.state).toBe("stale");
  }, 600_000);

  it("keeps the impact active when currentness cannot be checked transiently", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId, "post-transient");
    const created = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "post-transient"));
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);
    const inventory = running.host.assetInventory as unknown as {
      inventory(projectId: string): Promise<never>;
    };
    inventory.inventory = async () => {
      throw new HttpError(503, "HOST_RESOURCE_EXHAUSTED", "transient test failure",
        { recoverable: true }, projectId);
    };

    await expect(running.host.impact.requireCurrent(impactId))
      .rejects.toMatchObject({ code: "HOST_RESOURCE_EXHAUSTED", status: 503 });
    expect(running.host.impacts.get(impactId)?.state).toBe("active");
  }, 600_000);
});

/** 65 non-overlapping shot locks, each on a target the projection does not use. */
function locks65(host: NarralensHost, projectId: string, index: number): void {
  new LockService(host.revisions).acquire({
    projectId, lockType: "visual", scope: "shot", targetId: `unused_shot_${index}`,
    startFrame: index * 10, endFrameExclusive: index * 10 + 5, owner: "crowd", reason: "ceiling",
  }, 1);
}

/** The impact id recorded against a materialization, read through the store. */
function impactIdFor(host: NarralensHost, materializationId: string): string {
  const row = host.revisions.compose((handle) => handle)
    .prepare("SELECT impact_id FROM impact WHERE reference_id=? ORDER BY created_at LIMIT 1")
    .get(materializationId) as { impact_id?: unknown } | undefined;
  return String(row?.impact_id ?? "");
}


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
      expect(running.host.impacts.byProject(projectId), point).toHaveLength(0);
      // Refusal, and a refusal that is one of the answers the ADR §7 table defines — not a
      // 500. `toBeGreaterThanOrEqual(400)` was too wide: a TypeError surfacing as an
      // internal error would have satisfied it.
      expect(REFUSAL_CODES, `${point}: ${JSON.stringify(response.body)}`).toContain(response.body.code);
      expect(response.status, point).toBeLessThan(500);
      // Acquiring a lock legitimately moves the control revision, and M3's own re-verification
      // marks a prepared materialization stale when it does. So the row *may* be stale here —
      // what must never happen is an authorization surviving the refusal.
    }, 600_000);
  }

  for (const point of ["after_graph", "after_locks", "before_insert"] as const) {
    it(`refuses, stales the materialization, and writes no impact when ledger rights move at ${point}`, async () => {
      let changed = false;
      let projectId = "";
      const running = await started({
        impactFault: (name: string): void => {
          if (name !== point || changed) return;
          changed = true;
          running.host.revisions.compose((handle) => handle)
            .prepare("UPDATE migrated_asset SET license_json=? WHERE project_id=?")
            .run(JSON.stringify({ status: "restricted", label: "changed", commercial_use: false }), projectId);
        },
      });
      const migrated = await migrate(running);
      projectId = migrated.projectId;
      const materialization = await readyMaterialization(running.host, projectId, `tx05a-ledger-${point}`);

      const response = await postImpact(running, projectId,
        adoptBody(migrated.view, materialization.materialization_id, `tx05a-ledger-${point}`));

      expect(changed, `the rights fault at ${point} must have fired`).toBe(true);
      expect(response.status, JSON.stringify(response.body)).toBe(428);
      expect(response.body.code).toBe("IMPACT_STALE");
      expect(running.host.materializations.require(materialization.materialization_id).state).toBe("stale");
      expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
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

  it("answers 423 TARGET_LOCKED for a lock that is already held, and creates nothing", async () => {
    // The fault-point tests below inject a lock *inside* a request, and the refusal they
    // observe may come from the lock check, the control revision or the materialization's
    // own re-verification. That is correct behaviour but it cannot say which check fired, and
    // it meant deleting both `assertUnlocked` calls left the whole suite green. So the
    // production shape gets its own test: the lock is held *before* the request, the client
    // re-reads the project's facts and prepares against them, and only the lock can refuse.
    const running = await started();
    const { projectId } = await migrate(running);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    new LockService(running.host.revisions).acquire({
      projectId, lockType: "visual", scope: "shot", targetId: "shot-002",
      startFrame: 300, endFrameExclusive: 600, owner: "editor", reason: "shot under edit",
    }, view.revision);

    // A materialization prepared *after* the lock, so every other premise genuinely holds.
    const materialization = await readyMaterialization(running.host, projectId, "tx03a-locked");
    const current = await running.host.projectResolver.resolveActivated(projectId);
    const response = await postImpact(running, projectId,
      adoptBody(current, materialization.materialization_id, "tx03a-locked"));

    expect(response.status, JSON.stringify(response.body)).toBe(423);
    expect(response.body.code).toBe("TARGET_LOCKED");
    expect(response.body.details).toMatchObject({ lock_type: "visual", target_id: "shot-002" });
    expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
  }, 600_000);

  it("records every active lock it checked, and refuses a project with more than 64", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const locks = new LockService(running.host.revisions);
    // A lock on a range nothing touches: it must be *recorded* without blocking, which is
    // the other half of the claim — `locks_checked` is a snapshot, not a filter.
    locks.acquire({ projectId, lockType: "narration", scope: "project", targetId: "",
      owner: "narrator", reason: "narration pass" }, view.revision);
    const materialization = await readyMaterialization(running.host, projectId, "tx03a-recorded");
    // Re-read: acquiring a lock moves the control revision, and a client prepares against
    // what is current rather than against what it read before its own lock.
    const current = await running.host.projectResolver.resolveActivated(projectId);
    const response = await postImpact(running, projectId,
      adoptBody(current, materialization.materialization_id, "tx03a-recorded"));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const active = locks.activeLocks(projectId);
    expect(response.body.locks_checked).toHaveLength(active.length);
    expect(response.body.locks_checked).toEqual(active!
      .map((lock) => ({ lock_id: lock.lock_id, control_revision: lock.control_revision }))
      .sort((left, right) => (left.lock_id < right.lock_id ? -1 : 1)));
    expect(running.host.impacts.byProject(projectId)).toHaveLength(1);

    // And past the contract's ceiling it refuses rather than recording a truncated snapshot.
    const crowded = await start();
    hosts.push(crowded.host); dirs.push(crowded.base);
    const second = await migrate(crowded, "tx03a-crowded");
    for (let index = 0; index < 65; index += 1) {
      locks65(crowded.host, second.projectId, index);
    }
    const ready = await readyMaterialization(crowded.host, second.projectId, "tx03a-crowded");
    // Re-read: 65 acquisitions moved the control revision, and the request has to be
    // prepared against the current facts or it is refused for the wrong reason.
    const crowdedView = await crowded.host.projectResolver.resolveActivated(second.projectId);
    const refused = await postImpact(crowded, second.projectId,
      adoptBody(crowdedView, ready.materialization_id, "tx03a-crowded"));
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe("INVALID_REQUEST");
    expect(crowded.host.impacts.byProject(second.projectId)).toHaveLength(0);
  }, 900_000);

  it("refuses and writes no row when the source bytes move mid-computation", async () => {
    let moved = false;
    const running = await started({
      impactFault: (name: string): void => {
        if (name !== "after_graph" || moved) return;
        moved = true;
        // Real bytes, on disk, under a declared root. Everything the request has read so far
        // is now out of date, and the final re-read is what has to notice.
        void writeFile(join(view.source_root.value, "film.html"), "<!doctype html><html></html>\n", "utf8");
      },
    });
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);

    const response = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "tx05a-source"));
    expect(moved).toBe(true);
    expect(REFUSAL_CODES, JSON.stringify(response.body)).toContain(response.body.code);
    expect(response.status).toBeLessThan(500);
    expect(running.host.impacts.byProject(projectId)).toHaveLength(0);
  }, 600_000);

  it("refuses and writes no row when the materialization's proven facts move mid-computation", async () => {
    let moved = false;
    const running = await started({
      impactFault: (name: string): void => {
        if (name !== "after_locks" || moved) return;
        moved = true;
        // The rights digest is one of the facts an impact binds to. `setProvenFacts` is
        // deliberately guarded to non-terminal rows — a `ready_for_adoption` row's facts are
        // not rewritable through the public API — so the honest injection is the one a bad
        // migration or a tampered row would be: a direct UPDATE behind the guard.
        running.host.revisions.compose((handle) => handle)
          .prepare("UPDATE materialization SET rights_digest=? WHERE materialization_id=?")
          .run("8".repeat(64), materialization.materialization_id);
      },
    });
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);

    const response = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "tx05a-rights"));
    expect(moved).toBe(true);
    expect(REFUSAL_CODES, JSON.stringify(response.body)).toContain(response.body.code);
    expect(response.status).toBeLessThan(500);
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
    expect(response.body.code, JSON.stringify(response.body)).toBe("IMPACT_STALE");
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

  it("refuses to replay an impact the row says is no longer active", async () => {
    const running = await started();
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);
    const body = adoptBody(view, materialization.materialization_id, "r01-state");
    const created = await postImpact(running, projectId, body);
    expect(created.status).toBe(201);
    const impactId = String(created.body.impact_id);

    // The spec a replay reads lives in the idempotency response, which is a *different*
    // column from the impact row's own bytes. Moving the row to stale moves no revision and
    // no source, so without a state check the replay would hand back a dead authorization.
    running.host.impacts.markStale(impactId, new Date());
    const replay = await postImpact(running, projectId, body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(428);
    expect(replay.body.code).toBe("IMPACT_STALE");
    expect(replay.body.details).toMatchObject({ state: "stale" });
    // The same is true of an expired row, reached through its own terminal state.
    running.host.impacts.require(impactId);
    expect(running.host.impacts.byProject(projectId)).toHaveLength(1);
  }, 600_000);

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
      "/api/migration/v1/projects/d1-30s/edits",
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
    expect(created.status, JSON.stringify(created.body)).toBe(201);
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
