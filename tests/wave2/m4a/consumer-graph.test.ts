import { afterEach, describe, expect, it } from "vitest";
import { buildConsumerGraph } from "../../../src/host/projects/consumer-graph.js";
import { OPENFILM_PROJECTION_PROBLEM_PREFIX } from "../../../src/adapters/openfilm/openfilm-engine-adapter.js";
import type { EngineProjection } from "../../../src/contracts/engine-types.js";
import type { MigratedAssetRecord } from "../../../src/host/projects/migrated-asset-ledger.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import { NarralensHost } from "../../../src/host/server.js";
import { stopAll } from "./harness.js";

/**
 * TX-04A and the graph half of TX-03A — classification, and the decision to fail closed.
 *
 * These are pure-function tests over hand-built projections. A synthetic projection is the
 * right instrument here precisely because the production one is *good*: the migrated
 * three-shot target has no transitions, no overrides and no dangling references, so the
 * cases that must be refused cannot be produced from it at all. Every refusal below is a
 * case the real fixture cannot reach, which is why it is constructed rather than migrated.
 */

const hosts: NarralensHost[] = [];
afterEach(async () => { await stopAll(hosts.splice(0), []); });

const PROJECT = "of_test";

function asset(id: string, targetPath: string): MigratedAssetRecord {
  return {
    project_id: PROJECT, asset_id: id, migration_id: "mig_1", source_project_id: "d1-30s",
    source_manifest_sha256: "0".repeat(64), source_path: targetPath, target_path: targetPath,
    source_sha256: "0".repeat(64), target_sha256: "0".repeat(64), duration_frames: 900,
    media_type: "video/mp4",
    source: { kind: "derived", label: "d1-30s", lineage: [] },
    license: { status: "cleared", commercial_use: true, label: "fixture" },
  };
}

function projection(overrides: Partial<EngineProjection> = {}): EngineProjection {
  const clips: EngineProjection["clips"] = [
    { clip_id: "shot-001", track_id: "track_0", kind: "page",
      frame_range: { start_frame: 0, end_frame_exclusive: 300 },
      source_frame_range: { start_frame: 0, end_frame_exclusive: 300 }, source_ref: "scenes/shot-001.html",
      overrides_digest: null },
    { clip_id: "shot-002", track_id: "track_0", kind: "page",
      frame_range: { start_frame: 300, end_frame_exclusive: 600 },
      source_frame_range: { start_frame: 0, end_frame_exclusive: 300 }, source_ref: "scenes/shot-002.html",
      overrides_digest: null },
    { clip_id: "shot-003", track_id: "track_0", kind: "page",
      frame_range: { start_frame: 600, end_frame_exclusive: 900 },
      source_frame_range: { start_frame: 0, end_frame_exclusive: 300 }, source_ref: "scenes/shot-003.html",
      overrides_digest: null },
    { clip_id: "narration", track_id: "track_1", kind: "sound",
      frame_range: { start_frame: 0, end_frame_exclusive: 900 },
      source_frame_range: { start_frame: 0, end_frame_exclusive: 900 }, source_ref: "assets/narration.wav",
      overrides_digest: null },
  ];
  return {
    engine: "openfilm", engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    snapshot_id: "deadbeef", project_revision: 0, control_revision: 0,
    source_digest: "a".repeat(64), fps: { num: 30, den: 1 }, frame_count: 900,
    clips, tracks: [
      { track_id: "track_0", index: 0, clip_ids: ["shot-001", "shot-002", "shot-003"] },
      { track_id: "track_1", index: 1, clip_ids: ["narration"] },
    ],
    subtitles: [], asset_references: [], editable_capabilities: [] as never,
    preview: { kind: "openfilm-studio", url: "/preview" }, problems: [],
    ...overrides,
  };
}

function plan(clips: ReadonlyArray<{ clip_id: string; asset_id: string; start: number; end: number }>,
  totalFrames = 900, policies: Partial<Pick<NativePlanV1, "duration_policy" | "narration_policy">> = {}): NativePlanV1 {
  return {
    format: "narralens.native-plan@1.0", engine: "openfilm", fps: { num: 30, den: 1 },
    clips: clips.map((clip) => ({
      clip_id: clip.clip_id, segment_id: clip.clip_id, asset_id: clip.asset_id,
      asset_sha256: "0".repeat(64), track_id: "track_visual",
      timeline: { start_frame: clip.start, end_frame_exclusive: clip.end },
      source: { start_frame: 0, end_frame_exclusive: clip.end - clip.start },
    })),
    narration_policy: "preserve", duration_policy: "preserve", total_frames: totalFrames,
    plan_sha256: "c".repeat(64), ...policies,
  };
}

const ASSETS = [asset("asset_a", "assets/a.mp4"), asset("asset_b", "assets/b.mp4")];
const NARRATION = "assets/narration.wav";

type GraphInput = Parameters<typeof buildConsumerGraph>[0];

function graph(overrides: Partial<GraphInput> = {}): ReturnType<typeof buildConsumerGraph> {
  // The defaults are the shared parts; `projection` and `plan` are always supplied by the
  // caller, which is what keeps each case's subject visible in its own test.
  return buildConsumerGraph({
    ledgerAssets: ASSETS, narrationTargetPath: NARRATION, frameCount: 900,
    ...overrides,
  } as GraphInput, PROJECT);
}

describe("TX-04A: ranges are named by the current clip, never by a plan clip", () => {
  it("intersects the plan with the committed projection and reports current clip ids", () => {
    const result = graph({ projection: projection(), plan: plan([
      { clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 450 },
      { clip_id: "clip-1", asset_id: "asset_b", start: 450, end: 900 },
    ]) });
    // Three current clips, two plan clips, and every range names the current clip.
    expect(result.affected_ranges).toEqual([
      { clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
      { clip_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
      { clip_id: "shot-003", start_frame: 600, end_frame_exclusive: 900 },
    ]);
    // Not one of them is a `clip-<segment>` id, which is what would let a write slip past
    // a lock keyed to `shot-002`.
    for (const range of result.affected_ranges) expect(range.clip_id).toMatch(/^shot-/u);
  });

  it("merges two plan segments that land on one current clip into one range", () => {
    const result = graph({ projection: projection(), plan: plan([
      { clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 150 },
      { clip_id: "clip-1", asset_id: "asset_b", start: 150, end: 300 },
      { clip_id: "clip-2", asset_id: "asset_a", start: 300, end: 900 },
    ]) });
    expect(result.affected_ranges.filter((range) => range.clip_id === "shot-001")).toHaveLength(1);
    expect(result.affected_ranges[0]).toEqual({ clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 });
  });

  it("reaches every visual clip of a full-length plan, and refuses any plan that would not", () => {
    // With `duration_policy: "preserve"` and a plan timeline rooted at zero, a plan shorter
    // than the picture truncates it and a longer one overruns it. So the only plan M4A can
    // express covers the picture exactly, and every current visual clip is necessarily
    // affected. A "clip the plan never reaches" case is therefore not reachable through this
    // shape at all — saying so is more honest than constructing an input that cannot occur.
    const full = graph({ projection: projection(),
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]) });
    expect(full.affected_ranges.map((range) => range.clip_id))
      .toEqual(["shot-001", "shot-002", "shot-003"]);
    expect(() => graph({ projection: projection(),
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 300 }], 300) }))
      .toThrow(/change the project's duration/u);
  });

  it("refuses a plan that is not a contiguous cover of its own timeline", () => {
    for (const bad of [
      plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 300 }], 900),
      plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 100, end: 900 }], 900),
      plan([
        { clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 300 },
        { clip_id: "clip-1", asset_id: "asset_b", start: 250, end: 900 },
      ]),
    ]) {
      expect(() => graph({ projection: projection(), plan: bad })).toThrow(/contiguous|does not reach/u);
    }
  });
});

describe("TX-04A: consumers are classified, and unknown means unknown", () => {
  it("records a replaced visual clip, a preserved narration clip and no phantom audio", () => {
    const result = graph({ projection: projection(), plan: plan([
      { clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 },
    ]) });
    // Canonical order is kind, then id, then action — so `narration` sorts before `visual`,
    // and the order is part of what the hash is computed over.
    expect(result.affected_consumers).toEqual([
      { kind: "narration", id: "narration", action: "preserve" },
      { kind: "visual", id: "shot-001", action: "replace" },
      { kind: "visual", id: "shot-002", action: "replace" },
      { kind: "visual", id: "shot-003", action: "replace" },
    ]);
    // No audio consumer was invented for the narration clip, and no transition consumer
    // for a projection that has no transitions.
    expect(result.affected_consumers.some((c) => c.kind === "audio")).toBe(false);
    expect(result.affected_consumers.some((c) => c.kind === "transition")).toBe(false);
  });

  it("refuses a plan that would change duration, which M4A cannot express", () => {
    expect(() => graph({ projection: projection(),
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 600 }], 600) }))
      .toThrow(/duration/u);
    expect(() => graph({ projection: projection(),
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }], 900,
        { duration_policy: "extend" as never }) }))
      .toThrow(/preserve duration/u);
  });

  it("classifies a non-narration sound clip as audio, and a narration clip as narration", () => {
    const withBgm = projection({
      clips: [...(projection().clips), { clip_id: "bgm", track_id: "track_1", kind: "sound" as const,
        frame_range: { start_frame: 0, end_frame_exclusive: 900 },
        source_frame_range: { start_frame: 0, end_frame_exclusive: 900 },
        source_ref: "assets/b.mp4", overrides_digest: null }],
    });
    const result = graph({ projection: withBgm, plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]) });
    expect(result.affected_consumers).toContainEqual({ kind: "audio", id: "bgm", action: "preserve" });
    expect(result.affected_consumers).toContainEqual({ kind: "narration", id: "narration", action: "preserve" });
  });

  it("reports a shared asset as relinked when one of its users is replaced and another is not", () => {
    // `poster` is a still on `assets/a.mp4` and so is the background sound `bgm`. The plan
    // replaces the picture, so `poster` goes and `bgm` stays: the asset is shared and has to
    // be relinked rather than replaced. Narration is deliberately not one of the users —
    // it is matched on the migration's recorded path before any ledger lookup.
    const shared = projection({
      clips: [
        { clip_id: "poster", track_id: "track_0", kind: "still",
          frame_range: { start_frame: 0, end_frame_exclusive: 900 },
          source_frame_range: null, source_ref: "assets/a.mp4", overrides_digest: null },
        ...projection().clips,
        { clip_id: "bgm", track_id: "track_1", kind: "sound",
          frame_range: { start_frame: 0, end_frame_exclusive: 900 },
          source_frame_range: null, source_ref: "assets/a.mp4", overrides_digest: null },
      ],
      tracks: [
        { track_id: "track_0", index: 0, clip_ids: ["poster", "shot-001", "shot-002", "shot-003"] },
        { track_id: "track_1", index: 1, clip_ids: ["narration", "bgm"] },
      ],
    });
    const result = graph({
      projection: shared,
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]),
    });
    expect(result.affected_consumers).toContainEqual({ kind: "shared_asset", id: "asset_a", action: "relink" });
    // And when every user is replaced there is nothing left to relink, so nothing is claimed.
    const allReplaced = projection({
      clips: shared.clips.filter((clip) => clip.clip_id !== "bgm"),
      tracks: shared.tracks.map((track) => ({ ...track, clip_ids: track.clip_ids.filter((id) => id !== "bgm") })),
    });
    expect(graph({ projection: allReplaced,
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]) })
      .affected_consumers.some((consumer) => consumer.kind === "shared_asset")).toBe(false);
  });

  it("refuses a dangling media reference rather than treating it as no consumer", () => {
    const dangling = projection({
      clips: projection().clips.map((clip) => clip.clip_id === "narration"
        ? { ...clip, source_ref: "assets/missing.wav" } : clip),
    });
    // `narrationTargetPath` still points at the old path, so this clip is now unresolvable
    // media that the ledger has never heard of.
    expect(() => graph({ projection: dangling,
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]) }))
      .toThrow(/does not know/u);
  });

  it("refuses an ambiguous ledger: two rows naming one target path", () => {
    expect(() => graph({
      projection: projection(),
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]),
      ledgerAssets: [asset("asset_a", "assets/a.mp4"), asset("asset_dup", "assets/a.mp4")],
    })).toThrow(/same target path twice/u);
  });

  it("refuses a plan that binds an asset the project does not own", () => {
    expect(() => graph({ projection: projection(),
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_from_another_project", start: 0, end: 900 }]) }))
      .toThrow(/does not own/u);
  });

  it("refuses the whole capability when the projection is not complete", () => {
    // The adapter used to skip these silently. A consumer that trusted a projection with a
    // missing clip would compute an impact that omits it.
    for (const problem of [
      `${OPENFILM_PROJECTION_PROBLEM_PREFIX}CLIP_NO_ID:track_0`,
      `${OPENFILM_PROJECTION_PROBLEM_PREFIX}CLIP_UNKNOWN_SOURCE:shot-002`,
      `${OPENFILM_PROJECTION_PROBLEM_PREFIX}CLIP_OVERRIDES:shot-003`,
      `${OPENFILM_PROJECTION_PROBLEM_PREFIX}TRACK_UNKNOWN_KIND:track_1:effects`,
      `${OPENFILM_PROJECTION_PROBLEM_PREFIX}DUPLICATE_CLIP_ID:shot-002`,
    ]) {
      expect(() => graph({ projection: projection({ problems: [problem] }),
        plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]) }),
        problem).toThrow(/not complete/u);
    }
  });

  it("refuses a clip kind it cannot classify", () => {
    const exotic = projection({
      clips: [...projection().clips, { clip_id: "weird", track_id: "track_0", kind: "canvas" as never,
        frame_range: { start_frame: 0, end_frame_exclusive: 10 },
        source_frame_range: null, source_ref: "scenes/weird.html", overrides_digest: null }],
    });
    expect(() => graph({ projection: exotic,
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]) }))
      .toThrow(/cannot classify/u);
  });

  it("refuses when the plan reaches no visual clip at all", () => {
    const empty = projection({ clips: projection().clips.filter((clip) => clip.kind === "sound") });
    expect(() => graph({ projection: empty,
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]) }))
      .toThrow(/no visual clips/u);
  });
});

describe("TX-03A: locks follow the real change and nothing else", () => {
  it("affects a visual lock on exactly the clips it replaces", () => {
    const result = graph({ projection: projection(), plan: plan([
      { clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 300 },
      { clip_id: "clip-1", asset_id: "asset_b", start: 300, end: 600 },
      { clip_id: "clip-2", asset_id: "asset_b", start: 600, end: 900 },
    ]) });
    expect(result.affected_locks).toEqual([
      { lock_type: "visual", scope: "shot", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
      { lock_type: "visual", scope: "shot", target_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
      { lock_type: "visual", scope: "shot", target_id: "shot-003", start_frame: 600, end_frame_exclusive: 900 },
    ]);
    // No narration lock and no duration lock: narration is preserved and the duration does
    // not change. Claiming otherwise would be blocking every adopt on three lock types when
    // only one applies.
    expect(result.affected_locks.some((lock) => lock.lock_type === "narration")).toBe(false);
    expect(result.affected_locks.some((lock) => lock.lock_type === "duration")).toBe(false);
  });

  it("never names a plan clip id as a lock target", () => {
    const result = graph({ projection: projection(),
      plan: plan([{ clip_id: "clip-0", asset_id: "asset_a", start: 0, end: 900 }]) });
    for (const lock of result.affected_locks) expect(lock.target_id).toMatch(/^shot-/u);
  });
});
