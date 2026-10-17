import { afterEach, describe, expect, it } from "vitest";
import { computeAffectedLocks, impactForEdit, LockService } from "../../src/host/projects/lock-service.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import type { EngineProjection } from "../../src/contracts/engine-types.js";

/**
 * LOCK (M2.2 plan §5, §5.1, AC-008).
 *
 * M2.2 has no typed edit that changes duration or narration, so the integration half of
 * this gate asserts the visual lock over a real service, while the duration and narration
 * classifiers are unit-tested with synthetic payloads. Those two are recorded as
 * NOT_APPLICABLE_APPROVED for the integration layer rather than claimed as passing.
 */

const stores: RevisionStore[] = [];
function fixture(): { store: RevisionStore; locks: LockService } {
  const store = new RevisionStore(); stores.push(store);
  return { store, locks: new LockService(store) };
}
afterEach(() => { while (stores.length > 0) stores.pop()!.close(); });

const PROJECT = "d1-30s";
const SHOT_RANGE = { start_frame: 300, end_frame_exclusive: 600 } as const;
const OTHER_RANGE = { start_frame: 600, end_frame_exclusive: 900 } as const;

/** A minimal committed projection; the classifier reads nothing from it today. */
const PROJECTION = { clips: [] } as unknown as EngineProjection;

describe("LOCK the three classes are computed on the server", () => {
  it("visual: a fit or asset change touches the visual lock on that clip's range", () => {
    for (const op of ["timeline.set_visual_fit", "timeline.replace_visual_asset"] as const) {
      expect(computeAffectedLocks({ op, clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION))
        .toEqual([{ lock_type: "visual", scope: "shot", target_id: "shot-002",
          start_frame: 300, end_frame_exclusive: 600 }]);
    }
  });

  it("duration: a range or position change also touches duration", () => {
    for (const op of ["timeline.trim", "timeline.move", "timeline.split", "timeline.speed"] as const) {
      expect(computeAffectedLocks({ op, clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION).map((lock) => lock.lock_type))
        .toEqual(["visual", "duration"]);
    }
  });

  it("narration: a subtitle or audio change hits the narration consumer at project scope", () => {
    for (const op of ["subtitle.line.set", "subtitle.style.set", "audio.track.replace", "audio.mix.set"] as const) {
      expect(computeAffectedLocks({ op, clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION).map((lock) => lock.lock_type))
        .toEqual(["visual", "narration"]);
      expect(computeAffectedLocks({ op, clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION)[1]!.scope).toBe("project");
    }
  });

  it("maps the two real typed edits onto the classifier vocabulary", () => {
    expect(impactForEdit({ op: "set_visual_fit", shot_id: "shot-002", value: "cover" }, SHOT_RANGE))
      .toEqual({ op: "timeline.set_visual_fit", clip_id: "shot-002", range: SHOT_RANGE });
    expect(impactForEdit({ op: "replace_visual_asset", shot_id: "shot-002", asset_id: "asset_visual_d4_alt" }, SHOT_RANGE).op)
      .toBe("timeline.replace_visual_asset");
  });
});

describe("LOCK enforcement over a real service", () => {
  it("refuses a write that touches a locked range and allows one that does not", () => {
    const { locks } = fixture();
    const lock = locks.acquire({
      projectId: PROJECT, lockType: "visual", scope: "shot", targetId: "shot-002",
      startFrame: 300, endFrameExclusive: 600, owner: "user", reason: "locked by the operator",
    }, 2);

    const visual = computeAffectedLocks(
      { op: "timeline.set_visual_fit", clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION);
    expect(() => locks.assertUnlocked(PROJECT, visual)).toThrow(/visual target is locked/u);
    expect(() => locks.assertUnlocked(PROJECT, [{ ...visual[0]!, target_id: "shot-003", start_frame: 600, end_frame_exclusive: 900 }]))
      .not.toThrow();

    locks.release(lock.lock_id, 2);
    expect(() => locks.assertUnlocked(PROJECT, visual)).not.toThrow();
  });

  it("a lock of one class does not block a write that only affects another", () => {
    const { locks } = fixture();
    locks.acquire({ projectId: PROJECT, lockType: "duration", scope: "shot", targetId: "shot-002",
      startFrame: 300, endFrameExclusive: 600, owner: "user", reason: "duration held" }, 2);
    // A visual-only edit must pass: the duration lock is not in its affected set.
    const visualOnly = computeAffectedLocks({ op: "timeline.set_visual_fit", clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION);
    expect(() => locks.assertUnlocked(PROJECT, visualOnly)).not.toThrow();
    // A duration-changing edit on the same range is refused.
    const withDuration = computeAffectedLocks({ op: "timeline.trim", clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION);
    expect(() => locks.assertUnlocked(PROJECT, withDuration)).toThrow(/duration target is locked/u);
  });

  it("only overlapping ranges collide; adjacent half-open ranges do not", () => {
    const { locks } = fixture();
    locks.acquire({ projectId: PROJECT, lockType: "visual", scope: "shot", targetId: "shot-002",
      startFrame: 300, endFrameExclusive: 600, owner: "user", reason: "half-open boundary" }, 2);
    expect(() => locks.assertUnlocked(PROJECT, [{ lock_type: "visual", scope: "shot", target_id: "shot-003", start_frame: 600, end_frame_exclusive: 900 }]))
      .not.toThrow();
    expect(() => locks.assertUnlocked(PROJECT, [{ lock_type: "visual", scope: "shot", target_id: "shot-002", start_frame: 600, end_frame_exclusive: 900 }]))
      .not.toThrow();
    expect(() => locks.assertUnlocked(PROJECT, [{ lock_type: "visual", scope: "shot", target_id: "shot-002",
      start_frame: 0, end_frame_exclusive: 900 }])).toThrow();
  });

  it("a project-scoped lock covers every target", () => {
    const { locks } = fixture();
    locks.acquire({ projectId: PROJECT, lockType: "narration", scope: "project", targetId: "",
      startFrame: 0, endFrameExclusive: 900, owner: "user", reason: "narration held" }, 2);
    const narration = computeAffectedLocks({ op: "subtitle.line.set", clip_id: "shot-003", range: OTHER_RANGE }, PROJECTION);
    expect(() => locks.assertUnlocked(PROJECT, narration)).toThrow(/narration target is locked/u);
    // A visual-only edit is unaffected by a narration lock.
    expect(() => locks.assertUnlocked(PROJECT,
      computeAffectedLocks({ op: "timeline.set_visual_fit", clip_id: "shot-003", range: OTHER_RANGE }, PROJECTION)))
      .not.toThrow();
  });
});

describe("LOCK preserve is intent, never authority", () => {
  it("records preserve as a reason without letting it waive a lock", () => {
    const { locks } = fixture();
    const lock = locks.acquire({
      projectId: PROJECT, lockType: "visual", scope: "shot", targetId: "shot-002",
      startFrame: 300, endFrameExclusive: 600, owner: "user",
      reason: 'client preserve: ["narration","duration"]',
    }, 2);
    expect(lock.reason).toContain("preserve");
    // The same request still collides: the reason text granted nothing.
    const visual = computeAffectedLocks({ op: "timeline.set_visual_fit", clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION);
    expect(() => locks.assertUnlocked(PROJECT, visual)).toThrow(/visual target is locked/u);
  });

  it("a mutation that trusts the reason text instead of the lock list must fail the suite", () => {
    const { locks } = fixture();
    locks.acquire({ projectId: PROJECT, lockType: "visual", scope: "shot", targetId: "shot-002",
      startFrame: 300, endFrameExclusive: 600, owner: "user", reason: "narration,duration" }, 2);
    // Matching on the reason string rather than on lock_type would wrongly pass here.
    const visual = computeAffectedLocks({ op: "timeline.set_visual_fit", clip_id: "shot-002", range: SHOT_RANGE }, PROJECTION);
    expect(() => locks.assertUnlocked(PROJECT, visual)).toThrow(/visual target is locked/u);
  });
});

describe("LOCK control revision", () => {
  it("moves when a lock is taken or released and is what commit re-checks", () => {
    const { store, locks } = fixture();
    expect(locks.controlRevision(PROJECT, 2)).toBe(0);
    const lock = locks.acquire({ projectId: PROJECT, lockType: "visual", scope: "shot", targetId: "shot-002",
      startFrame: 300, endFrameExclusive: 600, owner: "user", reason: "policy" }, 2);
    expect(lock.control_revision).toBe(1);
    expect(locks.controlRevision(PROJECT, 2)).toBe(1);
    expect(locks.release(lock.lock_id, 2)).toBe(2);
    expect(locks.activeLocks(PROJECT)).toEqual([]);
  });

  it("does not move on a read", () => {
    const { locks } = fixture();
    locks.activeLocks(PROJECT);
    locks.controlRevision(PROJECT, 2);
    expect(locks.controlRevision(PROJECT, 2)).toBe(0);
  });
});
