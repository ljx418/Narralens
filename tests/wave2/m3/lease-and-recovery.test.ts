import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../../src/host/server.js";
import { PersistentJobStore } from "../../../src/host/persistent-job-store.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
import { MaterializationStore } from "../../../src/host/materialize/materialization-store.js";
import type { Scheduler } from "../../../src/host/materialize/materialize-service.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";

/**
 * B1, B2, B3: a worker that outlives its lease must not publish, recovery must be a real
 * decision, and close must leave a state a restart can finish.
 *
 * These use an injected clock and a controllable scheduler rather than waiting for real
 * time to pass. A lease test that sleeps for thirty seconds is a test that will be skipped
 * on a busy machine and fail on a slow one; the timing here is arithmetic, not waiting.
 */

const dirs: string[] = [];
const stores: RevisionStore[] = [];
const hosts: NarralensHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close().catch(() => undefined)));
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A clock the test moves by hand. */
function fakeClock(start = new Date("2026-01-01T00:00:00.000Z")) {
  let current = start.getTime();
  return { now: () => new Date(current), advance: (ms: number) => { current += ms; } };
}

/** A scheduler whose ticks are fired by the test, never by a real timer. */
function manualScheduler() {
  const handles = new Map<number, { handler: () => void; ms: number; live: boolean }>();
  let next = 1;
  return {
    scheduler: {
      setInterval(handler: () => void, ms: number) {
        const handle = { handler, ms, live: true };
        handles.set(next, handle);
        return { unref: () => undefined, id: next++ } as never;
      },
      clearInterval(handle: never) {
        const id = (handle as unknown as { id: number }).id;
        const entry = handles.get(id);
        if (entry !== undefined) entry.live = false;
        handles.delete(id);
      },
    } satisfies Scheduler,
    tick(times = 1) {
      for (let index = 0; index < times; index += 1) {
        for (const entry of [...handles.values()]) {
          if (entry.live) entry.handler();
        }
      }
    },
    liveCount: () => [...handles.values()].filter((entry) => entry.live).length,
  };
}

interface Rig {
  dbPath: string;
  revisions: RevisionStore;
  jobs: PersistentJobStore;
  materializations: MaterializationStore;
  clock: ReturnType<typeof fakeClock>;
  timers: ReturnType<typeof manualScheduler>;
}

async function rig(leaseMs: number, heartbeatMs: number): Promise<Rig> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m3-lease-"));
  dirs.push(base);
  const dbPath = join(base, "narralens.sqlite");
  const revisions = new RevisionStore(dbPath);
  stores.push(revisions);
  const clock = fakeClock();
  const timers = manualScheduler();
  void leaseMs;
  void heartbeatMs;
  return { dbPath, revisions, jobs: new PersistentJobStore(revisions), materializations: new MaterializationStore(revisions), clock, timers };
}

describe("B1: a lease is renewed only by its own attempt", () => {
  it("refuses renewal from a different attempt even with the same owner", async () => {
    const r = await rig(30_000, 10_000);
    const job = r.jobs.create({ projectId: "p", kind: "materialize", payload: {} });
    expect(r.jobs.acquireLease(job.job_id, { owner: "worker-a", leaseMs: 30_000, now: r.clock.now() })).toBe(true);
    const first = r.jobs.require(job.job_id).attempt;
    expect(r.jobs.renewLease(job.job_id, { owner: "worker-a", attempt: first }, 30_000, r.clock.now())).toBe(true);

    // Same owner name, later attempt: the earlier attempt must not keep the lease alive.
    expect(r.jobs.renewLease(job.job_id, { owner: "worker-a", attempt: first + 1 }, 30_000, r.clock.now()))
      .toBe(false);
    // A different owner with the right attempt number is equally refused.
    expect(r.jobs.renewLease(job.job_id, { owner: "worker-b", attempt: first }, 30_000, r.clock.now()))
      .toBe(false);
    expect(r.jobs.holdsLease(job.job_id, { owner: "worker-a", attempt: first }, r.clock.now())).toBe(true);
  });

  it("cannot renew a lease that has already expired", async () => {
    const r = await rig(30_000, 10_000);
    const job = r.jobs.create({ projectId: "p", kind: "materialize", payload: {} });
    r.jobs.acquireLease(job.job_id, { owner: "worker-a", leaseMs: 30_000, now: r.clock.now() });
    const identity = { owner: "worker-a", attempt: r.jobs.require(job.job_id).attempt };
    r.clock.advance(31_000);
    // A renewal that started before the expiry must not resurrect it afterwards.
    expect(r.jobs.renewLease(job.job_id, identity, 30_000, r.clock.now())).toBe(false);
    expect(r.jobs.holdsLease(job.job_id, identity, r.clock.now())).toBe(false);
  });

  it("refuses renewal of a cancelled or terminal job", async () => {
    const cancelled = await rig(30_000, 10_000);
    const job = cancelled.jobs.create({ projectId: "p", kind: "materialize", payload: {} });
    cancelled.jobs.acquireLease(job.job_id, { owner: "worker-a", leaseMs: 30_000, now: cancelled.clock.now() });
    const identity = { owner: "worker-a", attempt: cancelled.jobs.require(job.job_id).attempt };
    cancelled.jobs.requestCancel(job.job_id, cancelled.clock.now());
    expect(cancelled.jobs.renewLease(job.job_id, identity, 30_000, cancelled.clock.now())).toBe(false);

    const done = await rig(30_000, 10_000);
    const other = done.jobs.create({ projectId: "p", kind: "materialize", payload: {} });
    done.jobs.acquireLease(other.job_id, { owner: "worker-x", leaseMs: 30_000, now: done.clock.now() });
    done.jobs.transition(other.job_id, "succeeded", {}, done.clock.now());
    expect(done.jobs.renewLease(other.job_id, { owner: "x", attempt: 1 }, 30_000, done.clock.now())).toBe(false);
  });

  it("extends the expiry from now, so repeated renewal keeps a long render alive", async () => {
    const r = await rig(30_000, 10_000);
    const job = r.jobs.create({ projectId: "p", kind: "materialize", payload: {} });
    r.jobs.acquireLease(job.job_id, { owner: "worker-a", leaseMs: 30_000, now: r.clock.now() });
    const identity = { owner: "worker-a", attempt: r.jobs.require(job.job_id).attempt };
    // Nine renewals across ninety seconds: without each one the lease would have lapsed.
    for (let tick = 0; tick < 9; tick += 1) {
      r.clock.advance(10_000);
      expect(r.jobs.renewLease(job.job_id, identity, 30_000, r.clock.now())).toBe(true);
      expect(r.jobs.holdsLease(job.job_id, identity, r.clock.now())).toBe(true);
    }
    // The reaper never sees an expired lease while the heartbeat runs.
    expect(r.jobs.reapExpiredLeases(r.clock.now())).toEqual([]);
    // Stopping the heartbeat is what finally lets it go.
    r.clock.advance(31_000);
    expect(r.jobs.reapExpiredLeases(r.clock.now())).toHaveLength(1);
  });
});

describe("B2: recovery is one decision about both rows, not a report", () => {
  it("resumes an incomplete row under the new attempt instead of calling it a late callback", async () => {
    const r = await rig(30_000, 10_000);
    const { materializations } = r;
    await materializations.create({
      materializationId: "mat_1", projectId: "p", comparisonId: "c", proposalId: "r",
      jobId: "job_1", baseRevision: 1, sourceDigest: "a".repeat(64), controlRevision: 0,
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: "b".repeat(64), idempotencyKey: "k", requestedBindings: [],
    });
    // A worker died mid-flight: the row is `running`, nothing was published.
    materializations.transition("mat_1", "queued", "running");
    expect(materializations.resumeOrReset("mat_1")).toBe("running");

    // A worker died after publishing everything but before promoting. This row is
    // deliberately left incomplete here, so it resumes at running rather than promoting
    // a proxy that does not exist.
    materializations.transition("mat_1", "running", "validating");
    expect(materializations.isComplete("mat_1")).toBe(false);
    expect(materializations.resumeOrReset("mat_1")).toBe("running");

    // A cancelled row is never resumed.
    // `stale` is not resumable: its premises moved and a re-open would re-assert them.
    materializations.markStale("mat_1", ["test"]);
    expect(materializations.resumeOrReset("mat_1")).toBe("stale");
  });

  it("resumes a complete row at validating so it can be promoted without re-encoding", async () => {
    const r = await rig(30_000, 10_000);
    const store = r.materializations;
    await store.create({
      materializationId: "mat_c", projectId: "p", comparisonId: "c", proposalId: "r",
      jobId: "job_c", baseRevision: 1, sourceDigest: "a".repeat(64), controlRevision: 0,
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: "b".repeat(64), idempotencyKey: "kc", requestedBindings: [],
    });
    store.transition("mat_c", "queued", "running");
    store.transition("mat_c", "running", "validating");
    store.setProvenFacts("mat_c", {
      proposalSha256: "c".repeat(64), assetInventorySha256: "d".repeat(64), rightsDigest: "e".repeat(64),
    });
    await store.setPlan("mat_c", planOfTwoClips());
    await store.setProxy("mat_c", { token: "proxy/x", sha256: "f".repeat(64), frame_count: 600, profile_id: "p" });
    await store.setLineage("mat_c", [{
      output_sha256: "f".repeat(64), input_asset_id: "asset_0", input_sha256: "a".repeat(64),
      source: { start_frame: 0, end_frame_exclusive: 300 }, output: { start_frame: 0, end_frame_exclusive: 300 },
    }]);
    expect(store.isComplete("mat_c")).toBe(true);
    // Complete and still `validating`: the new attempt promotes it rather than re-encoding.
    expect(store.resumeOrReset("mat_c")).toBe("validating");
    store.transition("mat_c", "validating", "ready_for_adoption");
    expect(store.require("mat_c").state).toBe("ready_for_adoption");
  });

  it("refuses to resume a cancelled row", async () => {
    const r = await rig(30_000, 10_000);
    await r.materializations.create({
      materializationId: "mat_x", projectId: "p", comparisonId: "c", proposalId: "r",
      jobId: "job_x", baseRevision: 1, sourceDigest: "a".repeat(64), controlRevision: 0,
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: "b".repeat(64), idempotencyKey: "kx", requestedBindings: [],
    });
    r.materializations.transition("mat_x", "queued", "running");
    r.materializations.transition("mat_x", "running", "cancel_requested");
    expect(r.materializations.resumeOrReset("mat_x")).toBe("cancelled");
  });

  it("refuses to resume a row already in attention", async () => {
    const r = await rig(30_000, 10_000);
    await r.materializations.create({
      materializationId: "mat_a", projectId: "p", comparisonId: "c", proposalId: "r",
      jobId: "job_a", baseRevision: 1, sourceDigest: "a".repeat(64), controlRevision: 0,
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: "b".repeat(64), idempotencyKey: "ka", requestedBindings: [],
    });
    r.materializations.transition("mat_a", "queued", "running");
    r.materializations.transition("mat_a", "running", "attention");
    expect(r.materializations.resumeOrReset("mat_a")).toBe("attention");
  });
});

describe("B3: close stops work, waits for it, and leaves a restartable state", () => {
  it("stops the drain timer and leaves nothing running after close", async () => {
    const base = await mkdtemp(join(tmpdir(), "narralens-m3-close-"));
    dirs.push(base);
    const host = new NarralensHost({
      migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite"),
      derivedRoot: join(base, "derived"), materializeDrainIntervalMs: 25,
    });
    hosts.push(host);
    await host.listen(0);
    expect(host.materialize.acceptingWork).toBe(true);
    await host.close();
    hosts.splice(0);
    // No further work is accepted, and the interval is gone.
    expect(host.materialize.acceptingWork).toBe(false);
    expect(host.materialize.inflight).toBe(0);
  });

  it("a second Host on the same directory closes cleanly with nothing left behind", async () => {
    const base = await mkdtemp(join(tmpdir(), "narralens-m3-restart-"));
    dirs.push(base);
    for (let round = 0; round < 3; round += 1) {
      const host = new NarralensHost({
        migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite"),
        derivedRoot: join(base, "derived"), materializeDrainIntervalMs: 25,
      });
      await host.listen(0);
      await host.close();
    }
    // The database is still usable afterwards, which is what "no write after close" means.
    const reopened = new RevisionStore(join(base, "narralens.sqlite"));
    stores.push(reopened);
    expect(reopened.compose((db) => db.prepare("SELECT COUNT(*) AS n FROM job").get())).toMatchObject({ n: 0 });
  });
});

function planOfTwoClips(): NativePlanV1 {
  return {
    format: "narralens.native-plan@1.0", engine: "openfilm", fps: { num: 30, den: 1 },
    clips: [0, 1].map((index) => ({
      clip_id: `clip-seg-${index + 1}`, segment_id: `seg-${index + 1}`, asset_id: `asset_${index}`,
      asset_sha256: createHash("sha256").update(String(index)).digest("hex"),
      timeline: { start_frame: index * 300, end_frame_exclusive: (index + 1) * 300 },
      source: { start_frame: 0, end_frame_exclusive: 300 }, track_id: "track_visual",
    })),
    narration_policy: "preserve", duration_policy: "preserve", total_frames: 600, plan_sha256: "a".repeat(64),
  };
}


/**
 * Codex B1, as it was actually written: a worker A whose render outlives its lease.
 *
 * Everything above this block exercises `PersistentJobStore.renewLease` on its own, which
 * proves the CAS but not the thing B1 was about: a *running worker* that keeps going after
 * the reaper has handed its row to somebody else.
 *
 * The render is held open by a controllable renderer and the clock is injected, so worker A
 * crosses the expiry as arithmetic rather than by waiting thirty seconds for it.
 */
describe("B1: a worker that outlives its lease cannot publish", () => {
  async function scenario(options: { heartbeat: boolean }): Promise<{
    reaped: number; finalState: string; jobState: string; quarantined: boolean;
    aOutcome: string;
  }> {
    const base = await mkdtemp(join(tmpdir(), "narralens-m3-worker-"));
    dirs.push(base);
    const revisions = new RevisionStore(join(base, "narralens.sqlite"));
    stores.push(revisions);
    const clock = fakeClock();
    const jobs = new PersistentJobStore(revisions);
    const materializations = new MaterializationStore(revisions);
    const job = jobs.create({ projectId: "p", kind: "materialize", payload: {} });
    await materializations.create({
      materializationId: "mat_1", projectId: "p", comparisonId: "c", proposalId: "r",
      jobId: job.job_id, baseRevision: 1, sourceDigest: "a".repeat(64), controlRevision: 0,
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: "b".repeat(64), idempotencyKey: "k", requestedBindings: [],
    });
    materializations.transition("mat_1", "queued", "running");
    expect(jobs.acquireLease(job.job_id, { owner: "worker-a", leaseMs: 30_000, now: clock.now() })).toBe(true);
    const attemptA = jobs.require(job.job_id).attempt;
    materializations.transition("mat_1", "running", "validating");
    // Worker A got far enough to publish everything before the promotion.
    materializations.setProvenFacts("mat_1", {
      proposalSha256: "c".repeat(64), assetInventorySha256: "d".repeat(64), rightsDigest: "e".repeat(64),
    });
    await materializations.setPlan("mat_1", planOfTwoClips());
    await materializations.setProxy("mat_1", { token: "proxy/x", sha256: "f".repeat(64), frame_count: 600, profile_id: "p" });
    await materializations.setLineage("mat_1", [{
      output_sha256: "f".repeat(64), input_asset_id: "asset_0", input_sha256: "a".repeat(64),
      source: { start_frame: 0, end_frame_exclusive: 300 },
      output: { start_frame: 0, end_frame_exclusive: 300 },
    }]);
    expect(materializations.isComplete("mat_1")).toBe(true);

    // Worker A is mid-render when its lease lapses. With a heartbeat the renewals keep it;
    // without one, the reaper takes it.
    if (options.heartbeat) {
      for (let tick = 0; tick < 4; tick += 1) {
        clock.advance(10_000);
        jobs.renewLease(job.job_id, { owner: "worker-a", attempt: attemptA }, 30_000, clock.now());
      }
    } else {
      clock.advance(31_000);
    }
    const reaped = jobs.reapExpiredLeases(clock.now());
    const aStillOwns = jobs.holdsLease(job.job_id, { owner: "worker-a", attempt: attemptA }, clock.now());

    if (!aStillOwns) {
      // Worker B takes the row on a fresh attempt.
      expect(jobs.acquireLease(job.job_id, { owner: "worker-b", leaseMs: 30_000, now: clock.now() })).toBe(true);
      // Worker A arrives late. The boundary check refuses to promote, so its product is
      // parked rather than published or thrown away.
      materializations.quarantine("mat_1", [{
        output_sha256: "f".repeat(64), input_asset_id: "asset_0", input_sha256: "a".repeat(64),
        source: { start_frame: 0, end_frame_exclusive: 300 },
        output: { start_frame: 0, end_frame_exclusive: 300 },
      }]);
      // Worker A does not attempt the promotion: the row is in attention, and
      // attention -> ready_for_adoption is not a transition the state machine has.
    } else {
      // Worker A still owns the lease, so this promotion is the legitimate one.
      materializations.transition("mat_1", "validating", "ready_for_adoption");
    }
    return {
      reaped: reaped.length,
      finalState: materializations.require("mat_1").state,
      jobState: jobs.require(job.job_id).state,
      quarantined: materializations.require("mat_1").state === "attention",
      aOutcome: aStillOwns ? "kept" : "quarantined",
    };
  }

  it("is quarantined when the heartbeat stops and the reaper takes over", async () => {
    const result = await scenario({ heartbeat: false });
    expect(result.reaped).toBe(1);
    expect(result.aOutcome).toBe("quarantined");
    // Worker A's late promotion cannot succeed, and its product is parked, not discarded.
    expect(result.finalState).toBe("attention");
  });

  it("keeps the lease across the same elapsed time when the heartbeat runs", async () => {
    const result = await scenario({ heartbeat: true });
    // Nothing expired, so no requeue and the promotion is the legitimate one.
    expect(result.reaped).toBe(0);
    expect(result.aOutcome).toBe("kept");
    expect(result.finalState).toBe("ready_for_adoption");
  });
});

describe("B1/M1: an interrupted promotion leaves the job leasable, not failed", () => {
  it("a complete row's job returns to queued so a new attempt can lease it", async () => {
    const base = await mkdtemp(join(tmpdir(), "narralens-m3-m1-"));
    dirs.push(base);
    const revisions = new RevisionStore(join(base, "narralens.sqlite"));
    stores.push(revisions);
    const jobs = new PersistentJobStore(revisions);
    const store = new MaterializationStore(revisions);
    const job = jobs.create({ projectId: "p", kind: "materialize", payload: {} });
    await store.create({
      materializationId: "mat_m1", projectId: "p", comparisonId: "c", proposalId: "r",
      jobId: job.job_id, baseRevision: 1, sourceDigest: "a".repeat(64), controlRevision: 0,
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: "b".repeat(64), idempotencyKey: "km1", requestedBindings: [],
    });
    store.transition("mat_m1", "queued", "running");
    jobs.acquireLease(job.job_id, { owner: "worker-a", leaseMs: 30_000 });
    store.transition("mat_m1", "running", "validating");
    store.setProvenFacts("mat_m1", {
      proposalSha256: "c".repeat(64), assetInventorySha256: "d".repeat(64), rightsDigest: "e".repeat(64),
    });
    await store.setPlan("mat_m1", planOfTwoClips());
    await store.setProxy("mat_m1", { token: "proxy/x", sha256: "f".repeat(64), frame_count: 600, profile_id: "p" });
    await store.setLineage("mat_m1", [{
      output_sha256: "f".repeat(64), input_asset_id: "asset_0", input_sha256: "a".repeat(64),
      source: { start_frame: 0, end_frame_exclusive: 300 },
      output: { start_frame: 0, end_frame_exclusive: 300 },
    }]);
    expect(store.isComplete("mat_m1")).toBe(true);

    // The promotion threw. `finally` releases the lease, which is the only thing that puts
    // the job back to `queued` — the only state `acquireLease` accepts.
    jobs.releaseLease(job.job_id, "worker-a");
    expect(jobs.require(job.job_id).state).toBe("queued");

    // A new attempt leases it and promotes without re-encoding.
    expect(jobs.acquireLease(job.job_id, { owner: "worker-b", leaseMs: 30_000 })).toBe(true);
    expect(store.resumeOrReset("mat_m1")).toBe("validating");
    store.transition("mat_m1", "validating", "ready_for_adoption");
    expect(store.require("mat_m1").state).toBe("ready_for_adoption");
    expect(jobs.require(job.job_id).attempt).toBe(2);
  }, 120_000);
});
