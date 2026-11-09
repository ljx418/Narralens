/**
 * A-EVENTS: the signed cursor, the scope and expiry rules, the retention window and
 * the scan position.
 *
 * The cursor is the part of the observation surface where a small mistake silently
 * loses events. A cursor that is accepted under the wrong scope, that survives its
 * expiry, or that is refused after its position has left the retained window each
 * fail in a different way, and the tests below pin the difference:
 *
 * - a *forged* or *foreign* cursor is refused (403),
 * - an *expired* cursor or one whose position has been trimmed is refused as
 *   expired (410), and the client has to resynchronise,
 * - a *malformed* cursor is a client error (400).
 *
 * The scan position is the other half. It is a position in the global log, so it
 * advances past rows the client's filter skipped — but it may never run ahead of
 * what was actually read. A batch that claims a position its rows do not cover is
 * refused rather than accepted, because accepting it would turn a lost window into
 * a silent one.
 */

import { describe, expect, it } from "vitest";
import type { Context, CursorClaims, Event } from "../../../src/contracts/agent-driven-types.js";
import {
  CursorRejection,
  EventBatchError,
  ObservationFault,
  projectEventSnapshot,
  projectEvents,
  readProjectedEvents,
  rejectionToCode,
  resolveResumePoint,
  type AtomicObservationReadPort,
  type AtomicSnapshotState,
  type EventBatch,
  type EventReadPort,
  type ObservationClock,
} from "../../../src/host/observability/index.js";
import { TestCursorCodec } from "./helpers/cursor-codec.js";

const CONTEXT = {
  project_id: "p1",
  origin: "created",
  project_revision: 1,
  control_revision: 1,
  snapshot_id: "snap1",
  source_digest: "a".repeat(64),
  workflow_revision: 1,
  selection_version: 0,
  current_selection: null,
  active_jobs: [],
  artifacts: [],
  capabilities: [],
  next_actions: [],
  active_run: null,
  native_ack: null,
  native_sync: "unknown",
} satisfies Context;

const SCOPE = {
  principal_id: "agent-1",
  project_id: "p1",
  filter_digest: "b".repeat(64),
  instance_generation: 3,
};

class TestClock implements ObservationClock {
  constructor(private value: number) {}
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

class FakeReadPort implements AtomicObservationReadPort {
  globalWatermark = 40;
  oldestRetained = 10;
  contextProjectId: string | null = null;
  readonly contexts: string[] = [];

  async readSnapshotState(input: { project_id: string }): Promise<AtomicSnapshotState> {
    this.contexts.push(input.project_id);
    return {
      context: { ...CONTEXT, project_id: this.contextProjectId ?? input.project_id },
      global_watermark: this.globalWatermark,
      oldest_retained_event_id: this.oldestRetained,
    };
  }
}

class FakeEventRead implements EventReadPort {
  readonly requests: { after_event_id: number; limit: number }[] = [];

  constructor(private readonly batches: readonly EventBatch[]) {}

  async readEvents(input: { after_event_id: number; limit: number }): Promise<EventBatch> {
    this.requests.push({ after_event_id: input.after_event_id, limit: input.limit });
    const batch = this.batches[0];
    if (batch === undefined) {
      return { events: [], scanned_watermark: input.after_event_id, high_watermark: input.after_event_id };
    }
    return batch;
  }
}

function codec(): TestCursorCodec {
  return new TestCursorCodec({
    key: new Uint8Array(32).fill(7),
    keyId: "test-key-1",
  });
}

function options(read: FakeReadPort, clock: TestClock, signer = codec()) {
  return {
    read,
    sign: signer,
    verify: signer,
    clock,
    cursorTtlMs: 60_000,
  };
}

function request(overrides: Partial<{
  principal_id: string;
  project_id: string;
  filter_digest: string;
  instance_generation: number;
  cursor: string | null;
  last_event_id: string | null;
}> = {}) {
  return {
    principal_id: SCOPE.principal_id,
    project_id: SCOPE.project_id,
    filter_digest: SCOPE.filter_digest,
    instance_generation: SCOPE.instance_generation,
    cursor: null,
    last_event_id: null,
    ...overrides,
  };
}

function event(id: number, projectId = "p1"): Event {
  return {
    event_id: id,
    project_id: projectId,
    workflow_revision: 1,
    entity_type: "job",
    entity_id: "job-1",
    entity_version: 1,
    attempt: 1,
    state: "running",
    observed_at: "2026-11-09T00:00:00.000Z",
    run_id: null,
    plan_version: null,
    input_digest: null,
  };
}

describe("A-EVENTS snapshot and cursor issuance", () => {
  it("reads the context and the watermark at one boundary and issues a matching cursor", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const result = await projectEventSnapshot(options(read, clock, signer), request());

    expect(result.snapshot.snapshot_event_id).toBe(40);
    expect(result.snapshot.oldest_retained_event_id).toBe(10);
    expect(result.snapshot.filter_digest).toBe(SCOPE.filter_digest);
    expect(result.snapshot.instance_generation).toBe(SCOPE.instance_generation);
    expect(result.snapshot.context.project_id).toBe("p1");
    expect(result.resume.source).toBe("initial");
    expect(result.resume.watermark).toBeNull();

    // The cursor travels in `EventSnapshot.cursor`, whose shape the contract pins.
    expect(result.snapshot.cursor).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
    // And it has to fit `CursorRead.cursor`, which needs at least 32 characters.
    expect(result.snapshot.cursor.length).toBeGreaterThanOrEqual(32);

    const claims = await signer.verify(result.snapshot.cursor);
    expect(claims.outbox_watermark).toBe(40);
    expect(claims.project_id).toBe("p1");
    expect(claims.principal_id).toBe("agent-1");
    expect(claims.instance_generation).toBe(3);
    expect(claims.key_id).toBe("test-key-1");
  });

  it("resumes from the cursor it was given", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const first = await projectEventSnapshot(options(read, clock, signer), request());

    const second = await projectEventSnapshot(
      options(read, clock, signer),
      request({ cursor: first.snapshot.cursor }),
    );
    expect(second.resume.source).toBe("cursor");
    expect(second.resume.watermark).toBe(40);
  });

  it("prefers Last-Event-ID over the initial cursor for the resume position", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const claims = (watermark: number): CursorClaims => ({
      principal_id: SCOPE.principal_id,
      project_id: SCOPE.project_id,
      filter_digest: SCOPE.filter_digest,
      instance_generation: SCOPE.instance_generation,
      outbox_watermark: watermark,
      issued_at: new Date(clock.now()).toISOString(),
      expires_at: new Date(clock.now() + 60_000).toISOString(),
      key_id: "test-key-1",
    });
    const cursor = await signer.sign(claims(20));
    const lastEventId = await signer.sign(claims(30));

    const result = await projectEventSnapshot(
      options(read, clock, signer),
      request({ cursor, last_event_id: lastEventId }),
    );
    expect(result.resume.source).toBe("last_event_id");
    expect(result.resume.watermark).toBe(30);
  });

  it("verifies both cursors separately: a foreign cursor is refused even beside a valid Last-Event-ID", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const foreign = await signer.sign({
      principal_id: "agent-2",
      project_id: SCOPE.project_id,
      filter_digest: SCOPE.filter_digest,
      instance_generation: SCOPE.instance_generation,
      outbox_watermark: 30,
      issued_at: new Date(clock.now()).toISOString(),
      expires_at: new Date(clock.now() + 60_000).toISOString(),
      key_id: "test-key-1",
    });
    const lastEventId = await signer.sign({
      principal_id: SCOPE.principal_id,
      project_id: SCOPE.project_id,
      filter_digest: SCOPE.filter_digest,
      instance_generation: SCOPE.instance_generation,
      outbox_watermark: 30,
      issued_at: new Date(clock.now()).toISOString(),
      expires_at: new Date(clock.now() + 60_000).toISOString(),
      key_id: "test-key-1",
    });

    await expect(projectEventSnapshot(
      options(read, clock, signer),
      request({ cursor: foreign, last_event_id: lastEventId }),
    )).rejects.toMatchObject({ kind: "scope_mismatch" });
  });
});

describe("A-EVENTS cursor refusal rules", () => {
  it("refuses a cursor from another project, principal, filter or generation", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const claims = (overrides: Partial<CursorClaims>): CursorClaims => ({
      principal_id: SCOPE.principal_id,
      project_id: SCOPE.project_id,
      filter_digest: SCOPE.filter_digest,
      instance_generation: SCOPE.instance_generation,
      outbox_watermark: 30,
      issued_at: new Date(clock.now()).toISOString(),
      expires_at: new Date(clock.now() + 60_000).toISOString(),
      key_id: "test-key-1",
      ...overrides,
    });

    for (const overrides of [
      { principal_id: "agent-2" },
      { project_id: "p2" },
      { filter_digest: "c".repeat(64) },
      { instance_generation: 4 },
    ]) {
      const cursor = await signer.sign(claims(overrides));
      await expect(projectEventSnapshot(options(read, clock, signer), request({ cursor })))
        .rejects.toMatchObject({ kind: "scope_mismatch" });
    }
  });

  it("refuses an expired cursor as expired, not as foreign", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const cursor = await signer.sign({
      principal_id: SCOPE.principal_id,
      project_id: SCOPE.project_id,
      filter_digest: SCOPE.filter_digest,
      instance_generation: SCOPE.instance_generation,
      outbox_watermark: 30,
      issued_at: new Date(clock.now() - 120_000).toISOString(),
      expires_at: new Date(clock.now() - 60_000).toISOString(),
      key_id: "test-key-1",
    });

    await expect(projectEventSnapshot(options(read, clock, signer), request({ cursor })))
      .rejects.toMatchObject({ kind: "expired" });
  });

  it("refuses a tampered cursor as foreign", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const first = await projectEventSnapshot(options(read, clock, signer), request());
    const tampered = `${first.snapshot.cursor.slice(0, -4)}AAAA`;

    await expect(projectEventSnapshot(options(read, clock, signer), request({ cursor: tampered })))
      .rejects.toBeInstanceOf(CursorRejection);
  });

  it("refuses a malformed cursor as a client error", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const error = await projectEventSnapshot(options(read, clock), request({ cursor: "not-a-cursor" }))
      .then(() => null)
      .catch((failure: unknown) => failure as CursorRejection);
    expect(error?.kind).toBe("malformed");
    expect(rejectionToCode(error?.kind ?? "malformed")).toBe("INVALID_REQUEST");
  });

  it("refuses a cursor whose position has fallen out of the retained window", async () => {
    const read = new FakeReadPort();
    read.oldestRetained = 50;
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const first = await projectEventSnapshot(options(read, clock, signer), request());
    read.oldestRetained = 100;

    await expect(projectEventSnapshot(options(read, clock, signer), request({ cursor: first.snapshot.cursor })))
      .rejects.toMatchObject({ kind: "outside_retention" });
  });

  it("refuses claims the contract does not describe", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    // A verifier that returns claims outside the contract must not be trusted.
    const broken = {
      verify: async () => ({ principal_id: "agent-1" }) as unknown as CursorClaims,
      sign: signer.sign.bind(signer),
      key_id: signer.key_id,
    };
    await expect(projectEventSnapshot(
      { ...options(read, clock, signer), verify: broken },
      request({ cursor: "c".repeat(61) }),
    )).rejects.toMatchObject({ kind: "malformed" });
  });

  it("refuses a cursor whose claims describe no usable interval", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const cursor = await signer.sign({
      principal_id: SCOPE.principal_id,
      project_id: SCOPE.project_id,
      filter_digest: SCOPE.filter_digest,
      instance_generation: SCOPE.instance_generation,
      outbox_watermark: 30,
      issued_at: new Date(clock.now() + 60_000).toISOString(),
      expires_at: new Date(clock.now()).toISOString(),
      key_id: "test-key-1",
    });
    await expect(projectEventSnapshot(options(read, clock, signer), request({ cursor })))
      .rejects.toMatchObject({ kind: "malformed" });
  });

  it("maps each refusal onto the contract's error code", () => {
    expect(rejectionToCode("malformed")).toBe("INVALID_REQUEST");
    expect(rejectionToCode("tampered")).toBe("ORIGIN_REJECTED");
    expect(rejectionToCode("unknown")).toBe("ORIGIN_REJECTED");
    expect(rejectionToCode("scope_mismatch")).toBe("ORIGIN_REJECTED");
    expect(rejectionToCode("expired")).toBe("CURSOR_EXPIRED");
    expect(rejectionToCode("outside_retention")).toBe("CURSOR_EXPIRED");
  });
});

describe("A-EVENTS snapshot policy", () => {
  it("refuses a cursor lifetime that is not a positive finite number", async () => {
    const read = new FakeReadPort();
    const clock = new TestClock(1_700_000_000_000);
    for (const ttl of [0, -1, Number.POSITIVE_INFINITY]) {
      await expect(projectEventSnapshot(
        { ...options(read, clock), cursorTtlMs: ttl },
        request(),
      )).rejects.toBeInstanceOf(ObservationFault);
    }
  });

  it("refuses a context that belongs to another project", async () => {
    const read = new FakeReadPort();
    read.contextProjectId = "p2";
    const clock = new TestClock(1_700_000_000_000);
    await expect(projectEventSnapshot(options(read, clock), request()))
      .rejects.toBeInstanceOf(ObservationFault);
  });
});

describe("A-EVENTS scan position", () => {
  it("advances the position past rows the filter skipped", () => {
    const result = projectEvents({
      events: [event(11, "other-project"), event(12, "other-project"), event(13)],
      fromWatermark: 10,
      scannedWatermark: 13,
      highWatermark: 40,
      project_id: "p1",
    });

    expect(result.events.map((entry) => entry.event_id)).toEqual([13]);
    // The position is where the scan read to, not a count of the rows shown.
    expect(result.nextWatermark).toBe(13);
  });

  it("never advances past rows that were not read", () => {
    // A truncated scan: the port read two rows and stopped.
    const result = projectEvents({
      events: [event(11), event(12)],
      fromWatermark: 10,
      scannedWatermark: 12,
      highWatermark: 40,
      project_id: "p1",
    });
    expect(result.nextWatermark).toBe(12);
    expect(result.nextWatermark).toBeLessThan(40);
  });

  it("refuses a batch that claims a position its rows do not cover", () => {
    expect(() => projectEvents({
      events: [event(11)],
      fromWatermark: 10,
      scannedWatermark: 25,
      highWatermark: 40,
      project_id: "p1",
    })).toThrow(EventBatchError);
  });

  it("refuses an empty batch that claims to have advanced", () => {
    expect(() => projectEvents({
      events: [],
      fromWatermark: 10,
      scannedWatermark: 25,
      highWatermark: 40,
      project_id: "p1",
    })).toThrow(EventBatchError);
  });

  it("normalises duplicate, reordered and late rows instead of refusing them", () => {
    // A reconnect re-delivers a row, a partitioned log delivers rows out of order,
    // and a late row arrives after the client has moved on. All three are normal.
    const result = projectEvents({
      events: [event(12), event(11), event(12), event(10)],
      fromWatermark: 10,
      scannedWatermark: 12,
      highWatermark: 40,
      project_id: "p1",
    });
    // Ordered, de-duplicated, and the rows the client already has are gone.
    expect(result.events.map((entry) => entry.event_id)).toEqual([11, 12]);
    expect(result.nextWatermark).toBe(12);
  });

  it("refuses the same event id carrying two different rows", () => {
    const conflicting = { ...event(11), state: "failed" };
    expect(() => projectEvents({
      events: [event(11), conflicting],
      fromWatermark: 10,
      scannedWatermark: 11,
      highWatermark: 40,
      project_id: "p1",
    })).toThrow(EventBatchError);
  });

  it("refuses a row that lies beyond the position the batch claims", () => {
    expect(() => projectEvents({
      events: [event(11), event(30)],
      fromWatermark: 10,
      scannedWatermark: 11,
      highWatermark: 40,
      project_id: "p1",
    })).toThrow(EventBatchError);
  });

  it("refuses a row with an impossible id", () => {
    expect(() => projectEvents({
      events: [{ ...event(11), event_id: 0 }],
      fromWatermark: 10,
      scannedWatermark: 11,
      highWatermark: 40,
      project_id: "p1",
    })).toThrow(EventBatchError);
  });

  it("refuses a position that is not a safe integer or runs ahead of the tail", () => {
    expect(() => projectEvents({
      events: [],
      fromWatermark: 10,
      scannedWatermark: 10,
      highWatermark: 40,
      project_id: "p1",
    })).not.toThrow();
    expect(() => projectEvents({
      events: [],
      fromWatermark: 10,
      scannedWatermark: 50,
      highWatermark: 40,
      project_id: "p1",
    })).toThrow(EventBatchError);
    expect(() => projectEvents({
      events: [],
      fromWatermark: 10,
      scannedWatermark: Number.NaN,
      highWatermark: 40,
      project_id: "p1",
    })).toThrow(EventBatchError);
  });

  it("keeps the project scope even when a custom filter is supplied", async () => {
    const read = new FakeEventRead([{
      events: [event(11, "other-project"), event(12)],
      scanned_watermark: 12,
      high_watermark: 40,
    }]);
    const result = await readProjectedEvents({
      read,
      project_id: "p1",
      fromWatermark: 10,
      // A filter that would happily accept another project's rows.
      matches: () => true,
    });
    expect(result.events.map((entry) => entry.event_id)).toEqual([12]);
    expect(result.nextWatermark).toBe(12);
  });

  it("passes the client's position and limit to the port", async () => {
    const read = new FakeEventRead([{
      events: [event(11)],
      scanned_watermark: 11,
      high_watermark: 40,
    }]);
    await readProjectedEvents({ read, project_id: "p1", fromWatermark: 10, limit: 25 });
    expect(read.requests[0]).toEqual({ after_event_id: 10, limit: 25 });
  });
});

describe("A-EVENTS resume point", () => {
  it("reports no position for a first connect", async () => {
    const clock = new TestClock(1_700_000_000_000);
    const signer = codec();
    const resume = await resolveResumePoint({
      verify: signer,
      scope: SCOPE,
      nowMs: clock.now(),
      cursor: null,
      lastEventId: null,
    });
    expect(resume.source).toBe("initial");
    expect(resume.watermark).toBeNull();
  });
});
