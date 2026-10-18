import { afterEach, describe, expect, it } from "vitest";
import { MAX_OUTBOX_ATTEMPTS, Outbox } from "../../src/host/outbox.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

/**
 * JB-06 and the outbox consumer contract (M2.2 plan §7, §7.1).
 *
 * The property under test throughout: replaying an outbox must never re-run a commit, and
 * a consumer that already acknowledged an event must not see it again.
 */

const stores: RevisionStore[] = [];
afterEach(() => { while (stores.length > 0) stores.pop()!.close(); });

function harness(): { store: RevisionStore; outbox: Outbox; seen: unknown[][] } {
  const store = new RevisionStore(); stores.push(store);
  const outbox = new Outbox(store);
  const seen: unknown[][] = [];
  return { store, outbox, seen };
}

const now = new Date("2026-01-01T00:00:00.000Z");

describe("JB-06 a crash after commit only replays the outbox", () => {
  it("delivers each event to each consumer exactly once, however often it replays", async () => {
    const { store, outbox } = harness();
    const audit: unknown[] = [];
    outbox.register("project.committed", "commit-audit", (_eventId, payload) => { audit.push(payload); });
    store.enqueueOutbox("project.committed", "p1", JSON.stringify({ revision: 3 }));

    expect((await outbox.replay(now)).delivered).toBe(1);
    // Fully delivered events are not reconsidered at all, so a replay costs nothing.
    expect((await outbox.replay(now)).considered).toBe(0);
    expect((await outbox.replay(now)).delivered).toBe(0);
    expect(audit).toEqual([{ revision: 3 }]);
  });

  it("a commit is never re-executed by a replay, only the consumers are told", async () => {
    const { store, outbox } = harness();
    let commits = 0;
    outbox.register("project.committed", "commit-audit", () => { commits += 1; });
    store.enqueueOutbox("project.committed", "p1", "{}");
    await outbox.replay(now);
    await outbox.replay(now);
    await outbox.replay(now);
    // The commit happened once, at write time; the outbox only repeats the notification.
    expect(commits).toBe(1);
    expect(store.pendingOutboxCount()).toBe(0);
  });

  it("keeps delivering to the consumers that succeeded when one fails", async () => {
    const { store, outbox } = harness();
    const healthy: unknown[] = [];
    let attempts = 0;
    outbox.register("project.committed", "commit-audit", () => { healthy.push("audited"); });
    outbox.register("project.committed", "flaky", () => {
      attempts += 1;
      if (attempts < 3) throw new Error("consumer not ready");
    });
    store.enqueueOutbox("project.committed", "p1", "{}");

    const first = await outbox.replay(now);
    expect(first).toMatchObject({ delivered: 1, failed: 1 });

    let passes = 1;
    while (store.pendingOutboxCount() > 0 && passes < 10) {
      await outbox.replay(now);
      passes += 1;
    }
    expect(passes).toBeGreaterThan(1);
    // The healthy consumer ran exactly once, however many retries the flaky one needed.
    expect(healthy).toEqual(["audited"]);
    expect(attempts).toBe(3);
    expect(store.pendingOutboxCount()).toBe(0);
  });

  it("waits for every registered consumer before calling the event delivered", async () => {
    const { store, outbox } = harness();
    outbox.register("project.committed", "a", () => undefined);
    outbox.register("project.committed", "b", () => undefined);
    store.enqueueOutbox("project.committed", "p1", "{}");
    expect((await outbox.replay(now)).delivered).toBe(2);
    expect(store.pendingOutboxCount()).toBe(0);
  });

  it("stops retrying at the ceiling and closes the event with a reason instead of dropping it", async () => {
    const { store, outbox } = harness();
    outbox.register("project.committed", "always-fails", () => { throw new Error("down"); });
    store.enqueueOutbox("project.committed", "p1", "{}");

    let report = await outbox.replay(now);
    for (let pass = 1; pass < MAX_OUTBOX_ATTEMPTS; pass += 1) report = await outbox.replay(now);

    expect(report.failed).toBe(1);
    expect(report.abandoned).toHaveLength(1);
    expect(store.pendingOutboxCount()).toBe(0);
    const row = store.undeliveredOutbox(0);
    expect(row).toEqual([]);
    // The event is still on record with why it was closed.
    expect(store.outboxClosedReason(report.abandoned[0]!.event_id))
      .toMatch(/exceeded \d+ attempts/u);
  });

  it("refuses to register the same consumer twice for one topic", () => {
    const { outbox } = harness();
    outbox.register("job.state_changed", "job-sse", () => undefined);
    expect(() => outbox.register("job.state_changed", "job-sse", () => undefined))
      .toThrow(/ALREADY_REGISTERED/u);
  });

  it("ignores a topic nobody registered rather than dropping it", async () => {
    const { store, outbox } = harness();
    store.enqueueOutbox("unknown.topic", "p1", "{}");
    const report = await outbox.replay(now);
    expect(report.considered).toBe(0);
    expect(store.pendingOutboxCount()).toBe(1);
  });

  it("delivers oldest first so a consumer sees history in order", async () => {
    const { store, outbox } = harness();
    const order: number[] = [];
    outbox.register("project.committed", "commit-audit", (_eventId, payload) => {
      order.push((payload as { revision: number }).revision);
    });
    for (const revision of [1, 2, 3]) {
      store.enqueueOutbox("project.committed", "p1", JSON.stringify({ revision }));
    }
    await outbox.replay(now);
    expect(order).toEqual([1, 2, 3]);
  });

  it("gives the consumer a stable event id so a retried side effect can deduplicate", async () => {
    const { store, outbox } = harness();
    const sideEffects = new Set<number>();
    let first = true;
    outbox.register("project.committed", "commit-audit", (eventId) => {
      sideEffects.add(eventId);
      if (first) { first = false; throw new Error("crash before acknowledgement"); }
    });
    store.enqueueOutbox("project.committed", "p1", "{}");
    await outbox.replay(now);
    await outbox.replay(now);
    expect([...sideEffects]).toHaveLength(1);
    expect(store.pendingOutboxCount()).toBe(0);
  });
});
