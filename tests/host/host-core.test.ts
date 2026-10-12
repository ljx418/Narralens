import { describe, expect, it } from "vitest";
import { JobStore } from "../../src/host/job-store.js";
import { assertProjectId, isAllowedLoopbackOrigin, tokenMatches } from "../../src/host/security.js";

describe("D2 Host security", () => {
  it("accepts same-origin loopback and rejects cross-origin or public hosts", () => {
    expect(isAllowedLoopbackOrigin("http://127.0.0.1:4173", "127.0.0.1:4173")).toBe(true);
    expect(isAllowedLoopbackOrigin("http://localhost:4173", "127.0.0.1:4173")).toBe(false);
    expect(isAllowedLoopbackOrigin("https://example.com", "example.com")).toBe(false);
  });

  it("compares tokens without accepting length drift and bounds project IDs", () => {
    expect(tokenMatches("a".repeat(32), "a".repeat(32))).toBe(true);
    expect(tokenMatches("a".repeat(31), "a".repeat(32))).toBe(false);
    expect(assertProjectId("d1-30s")).toBe("d1-30s");
    expect(() => assertProjectId("../secret")).toThrow("INVALID_PROJECT_ID");
  });
});

describe("D2 JobStore", () => {
  it("emits monotonic replayable events", () => {
    const store = new JobStore();
    const job = store.create("d1-30s", new Date("2026-10-12T00:00:00Z"));
    store.transition(job.job_id, "running", undefined, new Date("2026-10-12T00:00:01Z"));
    store.transition(job.job_id, "succeeded", { proposal_id: "proposal-B" }, new Date("2026-10-12T00:00:02Z"));
    expect(store.eventsAfter(job.job_id, 0).map((event) => event.event_id)).toEqual([1, 2, 3]);
    expect(store.eventsAfter(job.job_id, 1).map((event) => event.type)).toEqual(["running", "succeeded"]);
    expect(() => store.transition(job.job_id, "running")).toThrow("JOB_TERMINAL");
  });

  it("keeps cancellation honest when work may finish late", () => {
    const store = new JobStore();
    const job = store.create("d1-30s");
    store.transition(job.job_id, "running");
    expect(store.requestCancel(job.job_id).state).toBe("cancel_requested");
    expect(store.transition(job.job_id, "completed_after_cancel", { proposal_id: "late" }).state).toBe("completed_after_cancel");
  });

  it("delivers live events and allows deterministic unsubscribe", () => {
    const store = new JobStore();
    const job = store.create("d1-30s");
    const received: number[] = [];
    const unsubscribe = store.subscribe(job.job_id, (event) => received.push(event.event_id));
    store.transition(job.job_id, "running");
    unsubscribe();
    store.transition(job.job_id, "succeeded", { proposal_id: "proposal-live" });
    expect(received).toEqual([2]);
  });
});
