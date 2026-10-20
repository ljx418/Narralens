import { describe, expect, it } from "vitest";
import { NativePlanBuilder } from "../../../src/host/materialize/native-plan-builder.js";
import { validateMaterialization } from "../../../src/contracts/validator.js";
import type { BindingResult, SegmentBinding } from "../../../src/host/materialize/binding-service.js";

/**
 * M3.2: three shots become three independently editable native clips.
 *
 * The single most important thing this file asserts is what the plan is *not*. C-01 retired
 * the D4.2 shape, where one `composite_asset_id` stood in for a whole film and the plan was
 * really "render three shots into one file". A plan that passed by being internally
 * consistent but described a flattened composite would look identical to a real one in every
 * structural check, so each clip here has to be traceable to exactly one bound segment and
 * one asset, and the plan as a whole has to be reconstructible from the bindings alone.
 */

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function binding(index: number): SegmentBinding {
  const sha = [SHA_A, SHA_B, SHA_C][index]!;
  return {
    segment_id: `seg-${index + 1}`, asset_id: `asset_${index + 1}`, asset_sha256: sha,
    source_start_frame: index * 30, source_end_frame_exclusive: index * 30 + 300,
    target_start_frame: index * 300, target_end_frame_exclusive: (index + 1) * 300,
    duration_frames: 300, license_status: "cleared", commercial_use: true,
  };
}

function bound(over: Partial<BindingResult> = {}): BindingResult {
  const bindings = [binding(0), binding(1), binding(2)];
  return {
    project_id: "of_target", comparison_id: "cmp_1", proposal_id: "proposal_1", base_revision: 4,
    selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 },
    bindings, binding_digest: "d".repeat(64), rights_digest: "e".repeat(64),
    asset_inventory_sha256: "f".repeat(64), total_frames: 900, ...over,
  };
}

describe("M3.2 a three-shot binding becomes three independent clips", () => {
  it("uses Host-proven target clip identities when supplied for controlled adoption", () => {
    const plan = new NativePlanBuilder().build(bound(), ["shot-001", "shot-002", "shot-003"]);
    expect(plan.clips.map((clip) => clip.clip_id)).toEqual(["shot-001", "shot-002", "shot-003"]);
    expect(() => new NativePlanBuilder().build(bound(), ["shot-001", "shot-001", "shot-003"]))
      .toThrow("target clip identity");
  });
  it("produces one clip per segment, with unique stable ids", () => {
    const plan = new NativePlanBuilder().build(bound());
    expect(plan.clips).toHaveLength(3);
    expect(plan.clips.map((clip) => clip.clip_id)).toEqual(["clip-seg-1", "clip-seg-2", "clip-seg-3"]);
    expect(new Set(plan.clips.map((clip) => clip.clip_id)).size).toBe(3);
    expect(new Set(plan.clips.map((clip) => clip.segment_id)).size).toBe(3);
  });

  it("places each clip exactly where its segment was bound", () => {
    const plan = new NativePlanBuilder().build(bound());
    expect(plan.clips.map((clip) => [clip.timeline.start_frame, clip.timeline.end_frame_exclusive]))
      .toEqual([[0, 300], [300, 600], [600, 900]]);
    expect(plan.total_frames).toBe(900);
  });

  it("carries each clip's own asset and source span, so a clip is editable on its own", () => {
    const plan = new NativePlanBuilder().build(bound());
    expect(plan.clips.map((clip) => [clip.asset_id, clip.asset_sha256, clip.source.start_frame]))
      .toEqual([
        ["asset_1", SHA_A, 0],
        ["asset_2", SHA_B, 30],
        ["asset_3", SHA_C, 60],
      ]);
    // Each clip points at one asset. No clip is a composite of several, and none stands for
    // the whole film.
    for (const clip of plan.clips) expect(typeof clip.asset_id).toBe("string");
  });

  it("is deterministic: the same bindings produce a byte-identical plan", () => {
    const first = new NativePlanBuilder().build(bound());
    const second = new NativePlanBuilder().build(bound());
    expect(second).toEqual(first);
    expect(first.plan_sha256).toBe(second.plan_sha256);
  });

  it("changes its identity when any placement changes", () => {
    const base = new NativePlanBuilder().build(bound());
    // Move the source window within the same asset, keeping its length: the timeline is
    // untouched and the plan's identity must still change.
    const moved = new NativePlanBuilder().build(bound({
      bindings: [binding(0), { ...binding(1), source_start_frame: 31, source_end_frame_exclusive: 331 }, binding(2)],
    }));
    expect(moved.plan_sha256).not.toBe(base.plan_sha256);
  });

  it("satisfies the frozen runtime contract", () => {
    const plan = new NativePlanBuilder().build(bound());
    const result = validateMaterialization({
      format: "narralens.materialization@1.0", materialization_id: "m", job_id: "j", project_id: "p",
      comparison_id: "c", proposal_id: "r", state: "validating", base_revision: 0,
      source_digest: "0".repeat(64), control_revision: 0, proposal_sha256: "0".repeat(64),
      asset_inventory_sha256: "0".repeat(64), rights_digest: "0".repeat(64),
      request_digest: "0".repeat(64),
      native_plan: plan,
      proxy: { token: "proxies/x", sha256: "0".repeat(64), frame_count: 900, profile_id: "p" },
      lineage: [{ output_sha256: "0".repeat(64), input_asset_id: "a", input_sha256: "0".repeat(64),
        source: { start_frame: 0, end_frame_exclusive: 1 }, output: { start_frame: 0, end_frame_exclusive: 1 } }],
      blocking_reasons: [], created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true });
  });
});

describe("M3.2 the plan refuses to describe something it cannot prove", () => {
  it("refuses a single-clip plan, which is the retired flattened shape", () => {
    expect(() => new NativePlanBuilder().build(bound({ bindings: [binding(0)] })))
      .toThrow(/at least two clips|one clip per segment/u);
  });

  it("refuses bindings that overlap on the timeline", () => {
    expect(() => new NativePlanBuilder().build(bound({
      bindings: [binding(0), { ...binding(1), target_start_frame: 150 }, binding(2)],
    }))).toThrow(/contiguous|overlap|covers/u);
  });

  it("refuses bindings that leave a gap in the timeline", () => {
    expect(() => new NativePlanBuilder().build(bound({
      bindings: [binding(0), { ...binding(1), target_start_frame: 400, target_end_frame_exclusive: 700 }, binding(2)],
    }))).toThrow(/contiguous|overlap|covers/u);
  });

  it("refuses a plan whose total disagrees with the selection", () => {
    expect(() => new NativePlanBuilder().build(bound({ total_frames: 600 })))
      .toThrow(/selection|total/u);
  });

  it("refuses two bindings that claim the same segment", () => {
    // Clip ids are derived from segment ids, so a repeated segment would silently produce
    // two clips with one identity — and an adopted film with a clip nobody can address.
    expect(() => new NativePlanBuilder().build(bound({
      bindings: [binding(0), { ...binding(1), segment_id: "seg-1" }, binding(2)],
    }))).toThrow(/same clip id|duplicate|segment/u);
  });

  it("refuses an empty binding set", () => {
    expect(() => new NativePlanBuilder().build(bound({ bindings: [] })))
      .toThrow(/clip|segment/u);
  });

  it("refuses more than 64 segments", () => {
    const many = Array.from({ length: 65 }, (_, index) => ({
      ...binding(0), segment_id: `seg-${index}`, asset_id: `asset_${index}`,
      target_start_frame: index * 300, target_end_frame_exclusive: (index + 1) * 300,
    }));
    expect(() => new NativePlanBuilder().build(bound({ bindings: many })))
      .toThrow(/64|at most/u);
  });

  it("refuses a clip whose source span is not the length of its timeline", () => {
    expect(() => new NativePlanBuilder().build(bound({
      bindings: [binding(0), { ...binding(1), source_end_frame_exclusive: 150 }, binding(2)],
    }))).toThrow(/speed|length|span/u);
  });
});

describe("M3.2 the plan holds no timeline of its own", () => {
  it("stores no field that could be read as an authoritative second sequence", () => {
    const plan = new NativePlanBuilder().build(bound());
    // The plan's frames are *derived from the bindings*, which are the record of what was
    // placed. A plan that also carried, say, a track ordering or a shot list would be a
    // second timeline that could disagree with the bindings after an edit.
    const keys = Object.keys(plan).sort();
    expect(keys).toEqual(["clips", "duration_policy", "engine", "format", "fps", "narration_policy", "plan_sha256", "total_frames"]);
    for (const clip of plan.clips) {
      expect(Object.keys(clip).sort()).toEqual(
        ["asset_id", "asset_sha256", "clip_id", "segment_id", "source", "timeline", "track_id"],
      );
    }
  });

  it("names its track and policy, and keeps narration and duration preserved", () => {
    const plan = new NativePlanBuilder().build(bound());
    expect(plan.narration_policy).toBe("preserve");
    expect(plan.duration_policy).toBe("preserve");
    expect(new Set(plan.clips.map((clip) => clip.track_id))).toEqual(new Set(["track_visual"]));
  });

  it("reconstructs from the bindings alone, with nothing left over", () => {
    const result = bound();
    const plan = new NativePlanBuilder().build(result);
    // Every clip corresponds to exactly one binding and vice versa: no clip invented, none
    // dropped.
    expect(plan.clips.map((clip) => clip.segment_id).sort())
      .toEqual(result.bindings.map((entry) => entry.segment_id).sort());
    expect(plan.total_frames)
      .toBe(result.bindings.reduce((sum, entry) => sum + entry.duration_frames, 0));
  });
});
