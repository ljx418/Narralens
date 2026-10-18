import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistentJobStore } from "../../src/host/persistent-job-store.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { DEFAULT_MAX_ATTEMPTS, JOB_TRANSITIONS, TERMINAL_JOB_STATES } from "../../src/host/job-defaults.js";

/**
 * JB-01..JB-07 (M2.2 plan §6, §9).
 *
 * Every one of these is about a job surviving something it should not survive: a restart, a
 * second worker, a lost lease, a reconnect, a cancellation, an unknown cost, a crash.
 */

const stores: RevisionStore[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function harness(): { store: RevisionStore; jobs: PersistentJobStore } {
  const store = new RevisionStore(); stores.push(store);
  return { store, jobs: new PersistentJobStore(store) };
}

const AT = new Date("2026-01-01T00:00:00.000Z");
const later = (ms: number) => new Date(AT.getTime() + ms);

describe("JB-01 a lost lease never becomes a success", () => {
  it("keeps a running job and its events across a restart", async () => {
    // A real restart needs a real database file; an in-memory handle would prove nothing.
    const dir = await mkdtemp(resolve(tmpdir(), "narralens-m22-job-"));
    dirs.push(dir);
    const path = join(dir, "jobs.sqlite");
    const first = new RevisionStore(path);
    const job = new PersistentJobStore(first)
      .create({ projectId: "p1", kind: "render", payload: { clip: "a" } });
    new PersistentJobStore(first).acquireLease(job.job_id, { owner: "worker-a", now: AT });
    first.close();

    const reopened = new RevisionStore(path);
    const revived = new PersistentJobStore(reopened).get(job.job_id);
    expect(revived).toMatchObject({ state: "running" });
    expect(new PersistentJobStore(reopened).eventsAfter(job.job_id, 0).map((event) => event.type))
      .toEqual(["queued", "running"]);
    reopened.close();
  });

  it("returns an expired lease to the queue while attempts remain, and to attention once they do not", () => {
    const { store, jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    // render's ceiling is 3: take it twice, lose both leases, and the third loss is final.
    for (const round of [1, 2]) {
      expect(jobs.acquireLease(job.job_id, { owner: `worker-${round}`, now: AT })).toBe(true);
      const reaped = jobs.reapExpiredLeases(later(60_000));
      expect(reaped.some((entry) => entry.job_id === job.job_id && entry.requeued)).toBe(true);
    }
    expect(jobs.acquireLease(job.job_id, { owner: "worker-3", now: AT })).toBe(true);
    const final = jobs.reapExpiredLeases(later(60_000));
    expect(final.find((entry) => entry.job_id === job.job_id)).toMatchObject({ requeued: false, attention: true });

    expect(jobs.get(job.job_id)!.state).toBe("attention");
    // A reclaimed job is never reported as succeeded, under any attempt count.
    expect(jobs.get(job.job_id)!.state).not.toBe("succeeded");
    expect(store.projectsInAttention()).toContain("p1");
  });

  it("records why the job ran out of attempts", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "proposal_comparison", payload: {} });
    expect(jobs.acquireLease(job.job_id, { owner: "w1", now: AT })).toBe(true);
    jobs.reapExpiredLeases(later(60_000));
    // proposal_comparison has a ceiling of one, so the first loss is already final.
    expect(jobs.get(job.job_id)!.state).toBe("attention");
    expect(jobs.eventsAfter(job.job_id, 0).at(-1)!.message).toMatch(/attempts are exhausted/u);
  });
});

describe("JB-02 only one worker can own a job", () => {
  it("gives the lease to exactly one of two contenders", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    const results = [jobs.acquireLease(job.job_id, { owner: "a", now: AT }),
      jobs.acquireLease(job.job_id, { owner: "b", now: AT })];
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(jobs.record(job.job_id)!.attempt).toBe(1);
  });

  it("will not let a second worker steal a running job whose lease merely expired", () => {
    // Before the reaper runs, the job is still `running` with a dead lease. Only the state
    // clause stops a newcomer from taking it, so this is the case that pins that clause.
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    expect(jobs.acquireLease(job.job_id, { owner: "a", now: AT, leaseMs: 1_000 })).toBe(true);
    expect(jobs.acquireLease(job.job_id, { owner: "b", now: later(2_000) })).toBe(false);
    expect(jobs.record(job.job_id)!.lease_owner).toBe("a");
  });

  it("keeps the owner until the lease is released or expires", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    expect(jobs.acquireLease(job.job_id, { owner: "a", now: AT })).toBe(true);
    expect(jobs.releaseLease(job.job_id, "a", AT)).toBe(true);
    expect(jobs.releaseLease(job.job_id, "b", AT)).toBe(false);
  });
});

describe("JB-03 SSE replays by cursor without repeating", () => {
  it("gives each event a monotonic per-job sequence and never repeats one after a reconnect", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    jobs.acquireLease(job.job_id, { owner: "a", now: AT });
    jobs.recordCallback(job.job_id, { owner: "a", attempt: 1 },
      { state: "succeeded", costStatus: "known" }, AT);

    const all = jobs.eventsAfter(job.job_id, 0);
    expect(all.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(new Set(all.map((event) => event.event_id)).size).toBe(all.length);

    // Reconnecting after seq 2 yields only what came later, exactly once.
    const resumed = jobs.eventsAfter(job.job_id, 2);
    expect(resumed.map((event) => event.seq)).toEqual([3]);
    expect(jobs.eventsAfter(job.job_id, 2)).toEqual(resumed);
  });

  it("numbers events globally so an id is never reused", () => {
    const { jobs } = harness();
    const first = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    const second = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    const ids = [...jobs.eventsAfter(first.job_id, 0), ...jobs.eventsAfter(second.job_id, 0)]
      .map((event) => event.event_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[1]).toBeGreaterThan(ids[0]!);
  });
});

describe("JB-04 a late result is quarantined, never adopted", () => {
  it("moves a cancelled job with a lost worker lease to attention instead of retrying it", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    jobs.acquireLease(job.job_id, { owner: "worker-a", now: AT, leaseMs: 1 });
    jobs.requestCancel(job.job_id, AT);
    expect(jobs.reapExpiredLeases(later(2))).toContainEqual({
      job_id: job.job_id, requeued: false, attention: true,
    });
    expect(jobs.record(job.job_id)?.state).toBe("attention");
  });

  it("rejects the previous owner's callback after a new lease attempt starts", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    expect(jobs.acquireLease(job.job_id, { owner: "worker-a", now: AT, leaseMs: 1 })).toBe(true);
    jobs.reapExpiredLeases(later(2));
    expect(jobs.acquireLease(job.job_id, { owner: "worker-b", now: later(3) })).toBe(true);

    expect(jobs.recordCallback(job.job_id, { owner: "worker-a", attempt: 1 },
      { state: "succeeded", artifact: { worker: "a" } }, later(4)))
      .toEqual({ applied: false, quarantined: true });
    expect(jobs.record(job.job_id)).toMatchObject({ state: "running", lease_owner: "worker-b", attempt: 2 });
  });

  it("records the result without changing the state of a job that moved on", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    jobs.acquireLease(job.job_id, { owner: "a", now: AT });
    jobs.requestCancel(job.job_id, AT);
    jobs.releaseLease(job.job_id, "a", AT);
    jobs.reapExpiredLeases(later(60_000));

    const outcome = jobs.recordCallback(job.job_id, { owner: "a", attempt: 1 },
      { state: "succeeded", artifact: { frame: 42 }, providerReceipt: { charged: true } }, later(60_001));
    expect(outcome).toEqual({ applied: false, quarantined: true });

    const record = jobs.record(job.job_id)!;
    expect(record.state).not.toBe("succeeded");
    expect(record.quarantined_artifact).toEqual({ frame: 42 });
    expect(record.quarantined_receipt).toEqual({ charged: true });
    expect(jobs.eventsAfter(job.job_id, 0).at(-1)!.message).toMatch(/^quarantined:/u);
  });

  it("applies a callback that arrives while the job is still running", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    jobs.acquireLease(job.job_id, { owner: "a", now: AT });
    expect(jobs.recordCallback(job.job_id, { owner: "a", attempt: 1 },
      { state: "succeeded", artifact: { frame: 1 } }, AT))
      .toEqual({ applied: true, quarantined: false });
    expect(jobs.get(job.job_id)!.state).toBe("succeeded");
  });

  it("never writes the legacy late-result state again", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    jobs.acquireLease(job.job_id, { owner: "a", now: AT });
    expect(() => jobs.transition(job.job_id, "completed_after_cancel", {}, AT)).toThrow(/INVALID_JOB_TRANSITION/u);
    for (const [from, targets] of Object.entries(JOB_TRANSITIONS)) {
      expect(targets, from).not.toContain("completed_after_cancel");
    }
  });
});

describe("JB-05 an unknown cost is never recorded as zero and never retried", () => {
  it("starts at unknown and only becomes known on an explicit amount", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "proposal_comparison", payload: {} });
    expect(jobs.record(job.job_id)!.cost_status).toBe("unknown");
    jobs.acquireLease(job.job_id, { owner: "a", now: AT });
    jobs.recordCallback(job.job_id, { owner: "a", attempt: 1 }, { state: "succeeded" }, AT);
    // The provider returned no amount, so the cost stays unknown rather than becoming 0.
    expect(jobs.record(job.job_id)!.cost_status).toBe("unknown");
  });

  it("gives a provider job a ceiling of one, so nothing is resent automatically", () => {
    expect(DEFAULT_MAX_ATTEMPTS.proposal_comparison).toBe(1);
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "proposal_comparison", payload: {} });
    expect(jobs.record(job.job_id)!.max_attempts).toBe(1);
    jobs.acquireLease(job.job_id, { owner: "a", now: AT });
    jobs.reapExpiredLeases(later(60_000));
    expect(jobs.get(job.job_id)!.state).toBe("attention");
    // Attention is terminal: no second attempt is offered.
    expect(() => jobs.transition(job.job_id, "queued", {}, AT)).toThrow(/JOB_TERMINAL/);
  });

  it("honours an explicit override of the ceiling", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "proposal_comparison", payload: {}, maxAttempts: 4 });
    expect(jobs.record(job.job_id)!.max_attempts).toBe(4);
  });
});

describe("JB-07 an orphan lease is reclaimable in the same process", () => {
  it("gives a reclaimed job to exactly one of two contenders", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    jobs.acquireLease(job.job_id, { owner: "gone", now: AT });
    jobs.reapExpiredLeases(later(60_000));
    const winners = [jobs.acquireLease(job.job_id, { owner: "a", now: later(60_001) }),
      jobs.acquireLease(job.job_id, { owner: "b", now: later(60_001) })];
    expect(winners.filter(Boolean)).toHaveLength(1);
  });
});

describe("the transition table is the only source of truth", () => {
  it("has no path out of a terminal state and no path into the legacy one", () => {
    for (const state of TERMINAL_JOB_STATES) expect(JOB_TRANSITIONS[state], state).toEqual([]);
    expect(JOB_TRANSITIONS.queued).not.toContain("completed_after_cancel");
    expect(JOB_TRANSITIONS.running).not.toContain("completed_after_cancel");
  });

  it("refuses a transition the table does not allow", () => {
    const { jobs } = harness();
    const job = jobs.create({ projectId: "p1", kind: "render", payload: {} });
    expect(() => jobs.transition(job.job_id, "succeeded", {}, AT)).toThrow(/INVALID_JOB_TRANSITION/u);
  });
});
