import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHistoryRestorePlan, computeHistoryRestorePlanHash, historyRestorePlanPreimage,
  HISTORY_RESTORE_PLAN_DOMAIN, restoreDigestRoots, verifyHistoryRestorePlanHash,
  type HistoryRestorePlanPreimage,
} from "../../../src/host/history/history-restore-plan.js";
import type { EngineClip, EngineProjection, EngineSubtitle } from "../../../src/contracts/engine-types.js";

/**
 * M4C-05: the restore plan's canonical rules.
 *
 * The frozen vectors are the evidence; this file is what keeps the TypeScript honest
 * against them. A change to the canonical rules has to change the committed vector file
 * deliberately, and the Python implementation has to agree with it.
 */

interface Vector {
  readonly name: string;
  readonly plan: HistoryRestorePlanPreimage;
  readonly plan_sha256: string;
  readonly preimage: string;
}

interface VectorDocument {
  readonly format: string;
  readonly domain: string;
  readonly vectors: readonly Vector[];
}

const document = JSON.parse(readFileSync(
  resolve("tests/wave2/m4c/restore-plan.vectors.json"), "utf8")) as VectorDocument;

const sha = (character: string): string => character.repeat(64);

function clip(overrides: Partial<EngineClip> & { clip_id: string }): EngineClip {
  return {
    clip_id: overrides.clip_id, track_id: overrides.track_id ?? "track_0",
    kind: overrides.kind ?? "video",
    frame_range: overrides.frame_range ?? { start_frame: 0, end_frame_exclusive: 300 },
    source_frame_range: overrides.source_frame_range ?? { start_frame: 0, end_frame_exclusive: 300 },
    source_ref: overrides.source_ref ?? "scenes/shot-001.html",
    overrides_digest: overrides.overrides_digest ?? null,
  };
}

function subtitle(overrides: Partial<EngineSubtitle> & { subtitle_id: string }): EngineSubtitle {
  return {
    subtitle_id: overrides.subtitle_id, source_ref: overrides.source_ref ?? "assets/subs.vtt",
    content_sha256: overrides.content_sha256 ?? sha("7"),
  };
}

function projection(clips: readonly EngineClip[], subtitles: readonly EngineSubtitle[] = [],
  frameCount = 900): EngineProjection {
  return {
    engine: "openfilm", engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    snapshot_id: sha("9"), project_revision: 2, control_revision: 0, source_digest: sha("9"),
    fps: { num: 30, den: 1 }, frame_count: frameCount, clips, tracks: [],
    subtitles, asset_references: [],
    editable_capabilities: { entries: {}, fps: { num: 30, den: 1 }, fps_verified: true },
    preview: { kind: "openfilm-studio", url: "/api/migration/v1/projects/of/preview" },
    problems: [],
  };
}

const baseInput = {
  project_id: "of_d1-30s_0123456789abcdef",
  current_snapshot_id: sha("a"), current_revision: 2, current_source_digest: sha("b"),
  target_snapshot_id: sha("c"), target_source_digest: sha("d"), target_film_sha256: sha("e"),
  target_roots: ["film.html", "scenes/shot-001.html"], target_subtitles: [],
  narration_target_path: null, rights_digest: sha("f"),
};

describe("M4C-05: the frozen restore-plan vectors", () => {
  it("carries the domain prefix it claims", () => {
    expect(document.format).toBe("narralens.restore-plan-vectors@1");
    expect(document.domain).toBe("narralens-history-restore-plan-v1\\n");
    expect(HISTORY_RESTORE_PLAN_DOMAIN).toBe("narralens-history-restore-plan-v1\n");
  });

  it("reproduces every vector's hash and preimage byte for byte", () => {
    expect(document.vectors.length).toBeGreaterThanOrEqual(10);
    for (const vector of document.vectors) {
      expect(historyRestorePlanPreimage(vector.plan), `${vector.name} preimage`).toBe(vector.preimage);
      expect(computeHistoryRestorePlanHash(vector.plan), `${vector.name} hash`).toBe(vector.plan_sha256);
      expect(vector.preimage.startsWith(HISTORY_RESTORE_PLAN_DOMAIN), vector.name).toBe(true);
    }
  });

  it("moves the hash for every single-field mutation, and for nothing else", () => {
    const base = document.vectors.find((vector) => vector.name === "base")!;
    const reordered = document.vectors.find((vector) => vector.name === "reordered-arrays")!;
    // The same content in a different order is the same plan.
    expect(reordered.plan_sha256).toBe(base.plan_sha256);
    const mutations = document.vectors.filter((vector) => vector.name.startsWith("mutated-"));
    expect(mutations.length).toBeGreaterThanOrEqual(10);
    for (const mutation of mutations) {
      expect(mutation.plan_sha256, mutation.name).not.toBe(base.plan_sha256);
    }
  });

  it("ties the frozen bytes to what the builder produces", () => {
    const builder = document.vectors.find((vector) => vector.name === "builder")!;
    const plan = buildHistoryRestorePlan({
      ...baseInput,
      current: projection([clip({ clip_id: "shot-001", kind: "video",
        source_ref: "assets/1111111111111111111111111111111111111111111111111111111111111111/source.mp4" })], [], 300),
      target: projection([clip({ clip_id: "shot-001", kind: "page" })], [], 300),
    }, "of_d1-30s_0123456789abcdef");
    expect(computeHistoryRestorePlanHash(plan)).toBe(builder.plan_sha256);
    expect(historyRestorePlanPreimage(plan)).toBe(builder.preimage);
    expect(verifyHistoryRestorePlanHash(plan)).toBe(true);
  });
});

describe("M4C-05: the plan classifies the difference instead of counting it", () => {
  it("names the changed visual clips, the preserved narration, and the visual lock they need", () => {
    const plan = buildHistoryRestorePlan({
      ...baseInput,
      narration_target_path: "narration.wav",
      current: projection([
        clip({ clip_id: "shot-001", kind: "video", source_ref: "assets/aa/source.mp4" }),
        clip({ clip_id: "narration", kind: "sound", track_id: "track_1", source_ref: "narration.wav",
          frame_range: { start_frame: 0, end_frame_exclusive: 900 } }),
      ]),
      target: projection([
        clip({ clip_id: "shot-001", kind: "page", source_ref: "scenes/shot-001.html" }),
        clip({ clip_id: "narration", kind: "sound", track_id: "track_1", source_ref: "narration.wav",
          frame_range: { start_frame: 0, end_frame_exclusive: 900 } }),
      ]),
    }, "of_d1-30s_0123456789abcdef");
    expect(plan.consumers).toContainEqual({ kind: "visual", id: "shot-001", action: "replace" });
    expect(plan.consumers).toContainEqual({ kind: "narration", id: "narration", action: "preserve" });
    // The narration is preserved, so it must not require a narration lock: a blanket lock
    // would block a restore that does not touch the narration.
    expect(plan.required_locks.filter((lock) => lock.lock_type === "narration")).toEqual([]);
    expect(plan.required_locks).toContainEqual({ lock_type: "visual", scope: "shot",
      target_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 });
    expect(plan.required_locks.length).toBeGreaterThan(0);
  });

  it("requires a narration lock when the narration itself changes", () => {
    const plan = buildHistoryRestorePlan({
      ...baseInput,
      narration_target_path: "narration.wav",
      current: projection([
        clip({ clip_id: "shot-001", kind: "video", source_ref: "assets/aa/source.mp4" }),
        clip({ clip_id: "narration", kind: "sound", track_id: "track_1", source_ref: "narration.wav" }),
      ]),
      target: projection([
        clip({ clip_id: "shot-001", kind: "video", source_ref: "assets/aa/source.mp4" }),
        clip({ clip_id: "narration", kind: "sound", track_id: "track_1", source_ref: "other-narration.wav" }),
      ]),
    }, "of_d1-30s_0123456789abcdef");
    expect(plan.consumers).toContainEqual({ kind: "narration", id: "narration", action: "replace" });
    const narrationLocks = plan.required_locks.filter((lock) => lock.lock_type === "narration");
    expect(narrationLocks.length).toBeGreaterThan(0);
    // Both scopes: a project-scoped narration lock is only matched by a project-scoped
    // candidate, and a shot-scoped one by a shot-scoped candidate.
    expect(narrationLocks.some((lock) => lock.scope === "project")).toBe(true);
    expect(narrationLocks.some((lock) => lock.scope === "shot")).toBe(true);
  });

  it("requires a duration lock when the timeline changes", () => {
    const plan = buildHistoryRestorePlan({
      ...baseInput,
      current: projection([clip({ clip_id: "shot-001" })], [], 300),
      target: projection([clip({ clip_id: "shot-001",
        frame_range: { start_frame: 0, end_frame_exclusive: 400 } })], [], 400),
    }, "of_d1-30s_0123456789abcdef");
    expect(plan.required_locks.some((lock) => lock.lock_type === "duration")).toBe(true);
  });

  it("refuses a target with a different clip identity, a different track, or an incomplete projection", () => {
    const projectId = "of_d1-30s_0123456789abcdef";
    const changed = (overrides: Partial<EngineClip> & { clip_id: string }): EngineClip =>
      clip({ ...overrides, source_ref: overrides.source_ref ?? "assets/aa/source.mp4" });
    expect(() => buildHistoryRestorePlan({
      ...baseInput,
      current: projection([changed({ clip_id: "shot-001" })]),
      target: projection([changed({ clip_id: "shot-002" })]),
    }, projectId)).toThrow(/clip identity/u);
    expect(() => buildHistoryRestorePlan({
      ...baseInput,
      current: projection([changed({ clip_id: "shot-001", track_id: "track_0" })]),
      target: projection([changed({ clip_id: "shot-001", track_id: "track_1" })]),
    }, projectId)).toThrow(/another track/u);
    const incomplete = { ...projection([changed({ clip_id: "shot-001" })]),
      problems: ["OPENFILM_PROJECTION:CLIP_NO_ID:track_0"] };
    expect(() => buildHistoryRestorePlan({
      ...baseInput,
      current: incomplete,
      target: projection([changed({ clip_id: "shot-001" })]),
    }, projectId)).toThrow(/incomplete/u);
  });

  it("refuses a restore that would change nothing", () => {
    expect(() => buildHistoryRestorePlan({
      ...baseInput,
      current: projection([clip({ clip_id: "shot-001" })]),
      target: projection([clip({ clip_id: "shot-001" })]),
    }, "of_d1-30s_0123456789abcdef")).toThrow(/nothing to restore/u);
  });

  it("reconstructs the digest roots from the entry and the root set", () => {
    const plan = buildHistoryRestorePlan({
      ...baseInput,
      current: projection([clip({ clip_id: "shot-001", source_ref: "assets/aa/source.mp4" })]),
      target: projection([clip({ clip_id: "shot-001" })]),
    }, "of_d1-30s_0123456789abcdef");
    const roots = restoreDigestRoots(plan);
    expect(roots[0]).toBe(plan.entry_root);
    expect([...roots].sort()).toEqual([...plan.roots].sort());
    expect(new Set(roots).size).toBe(roots.length);
  });
});
