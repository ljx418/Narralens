import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHistoryRestorePlan, computeHistoryRestorePlanHash, historyRestorePlanPreimage,
  HISTORY_RESTORE_PLAN_DOMAIN, projectionDigest, restoreTargetIsEligible,
  verifyHistoryRestorePlanHash, type HistoryRestorePlanPreimage,
} from "../../../src/host/history/history-restore-plan.js";
import type { EngineClip, EngineProjection, EngineSubtitle } from "../../../src/contracts/engine-types.js";
import { LockService } from "../../../src/host/projects/lock-service.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";

/**
 * M4C-05 and M4C-02: the restore plan's canonical rules and ADR D-04's lock model.
 *
 * The frozen vectors are the evidence for the canonical form; the lock cases are the
 * evidence for the *classification*. Both are checked here, and the lock cases use the
 * **real** `LockService`, so "the plan asks for the project scope" and "a project-scope
 * lock actually blocks the write" are the same statement rather than two hopes.
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
    subtitles, asset_references: [], editable_capabilities: { entries: {}, fps: { num: 30, den: 1 }, fps_verified: true },
    preview: { kind: "openfilm-studio", url: "/api/migration/v1/projects/of/preview" },
    problems: [],
  };
}

const baseInput = {
  project_id: "of_d1-30s_0123456789abcdef",
  current_snapshot_id: sha("a"), target_snapshot_id: sha("c"),
  target_roots: ["film.html", "scenes/shot-001.html"], target_subtitles: [],
  narration_target_path: null as string | null, rights_digest: sha("f"),
};

function plan(current: EngineProjection, target: EngineProjection,
  overrides: Partial<typeof baseInput> = {}) {
  return buildHistoryRestorePlan({ ...baseInput, ...overrides, current, target },
    baseInput.project_id);
}

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

  it("binds the affected ranges inside the hashed plan", () => {
    // The ranges used to be computed beside the plan, so the plan hash never covered them.
    // The frozen vectors now carry a mutation for the ranges alone: moving one range moves
    // the hash, so "the plan authorized these ranges" is inside the authorization.
    const mutation = document.vectors.find((vector) => vector.name === "mutated-affected-ranges");
    expect(mutation).toBeDefined();
    const base = document.vectors.find((vector) => vector.name === "base")!;
    expect(mutation!.plan_sha256).not.toBe(base.plan_sha256);
    expect(mutation!.plan.affected_ranges).not.toEqual(base.plan.affected_ranges);
  });

  it("ties the frozen bytes to what the builder produces", () => {
    const builder = document.vectors.find((vector) => vector.name === "builder")!;
    const built = plan(
      projection([clip({ clip_id: "shot-001", kind: "video",
        source_ref: "assets/1111111111111111111111111111111111111111111111111111111111111111/source.mp4" })], [], 300),
      projection([clip({ clip_id: "shot-001", kind: "page" })], [], 300));
    expect(computeHistoryRestorePlanHash(built)).toBe(builder.plan_sha256);
    expect(historyRestorePlanPreimage(built)).toBe(builder.preimage);
    expect(verifyHistoryRestorePlanHash(built)).toBe(true);
  });
});

describe("M4C-02: ADR D-04's lock model, and the real LockService", () => {
  it("asks for a visual shot lock when only a clip's content changed", () => {
    const built = plan(
      projection([clip({ clip_id: "shot-001", source_ref: "assets/aa/source.mp4" })]),
      projection([clip({ clip_id: "shot-001", source_ref: "assets/bb/source.mp4" })]));
    expect(built.required_locks).toContainEqual({ lock_type: "visual", scope: "shot",
      target_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 });
    expect(built.required_locks.some((lock) => lock.scope === "project")).toBe(false);
  });

  it("asks for a visual project and a duration project lock when a clip's boundary moved", () => {
    const built = plan(
      projection([clip({ clip_id: "shot-001", frame_range: { start_frame: 0, end_frame_exclusive: 300 } })], [], 300),
      projection([clip({ clip_id: "shot-001", frame_range: { start_frame: 0, end_frame_exclusive: 312 } })], [], 312));
    expect(built.required_locks).toContainEqual({ lock_type: "visual", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 312 });
    expect(built.required_locks).toContainEqual({ lock_type: "duration", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 312 });
  });

  it("asks for the project scope when the clips were reordered", () => {
    const built = plan(
      projection([
        clip({ clip_id: "shot-001", frame_range: { start_frame: 0, end_frame_exclusive: 300 } }),
        clip({ clip_id: "shot-002", frame_range: { start_frame: 300, end_frame_exclusive: 600 } }),
      ], [], 600),
      projection([
        clip({ clip_id: "shot-002", frame_range: { start_frame: 0, end_frame_exclusive: 300 } }),
        clip({ clip_id: "shot-001", frame_range: { start_frame: 300, end_frame_exclusive: 600 } }),
      ], [], 600));
    expect(built.required_locks).toContainEqual({ lock_type: "visual", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 600 });
    expect(built.required_locks).toContainEqual({ lock_type: "duration", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 600 });
  });

  it("asks for the project scope when a clip was added or removed", () => {
    const added = plan(
      projection([clip({ clip_id: "shot-001" })], [], 600),
      projection([clip({ clip_id: "shot-001" }), clip({ clip_id: "shot-002",
        frame_range: { start_frame: 300, end_frame_exclusive: 600 } })], [], 600));
    expect(added.required_locks).toContainEqual({ lock_type: "visual", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 600 });
    expect(added.required_locks).toContainEqual({ lock_type: "duration", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 600 });

    const removed = plan(
      projection([clip({ clip_id: "shot-001" }), clip({ clip_id: "shot-002",
        frame_range: { start_frame: 300, end_frame_exclusive: 600 } })], [], 600),
      projection([clip({ clip_id: "shot-001" })], [], 600));
    expect(removed.required_locks).toContainEqual({ lock_type: "visual", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 600 });
  });

  it("asks for the project scope when the total frame count changed", () => {
    const built = plan(
      projection([clip({ clip_id: "shot-001", frame_range: { start_frame: 0, end_frame_exclusive: 300 } })], [], 300),
      projection([clip({ clip_id: "shot-001", frame_range: { start_frame: 0, end_frame_exclusive: 300 } })], [], 600));
    // The frame count is the projection's own statement of the project's length, so a change
    // in it is a change of the whole project.
    expect(built.required_locks).toContainEqual({ lock_type: "duration", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 600 });
  });

  it("asks for a narration project lock when the narration changed, and not for a shot one", () => {
    const built = plan(
      projection([clip({ clip_id: "narration", kind: "sound", track_id: "track_1",
        source_ref: "narration.wav" })]),
      projection([clip({ clip_id: "narration", kind: "sound", track_id: "track_1",
        source_ref: "other-narration.wav" })]),
      { narration_target_path: "narration.wav" });
    expect(built.required_locks).toContainEqual({ lock_type: "narration", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 900 });
    expect(built.required_locks.some((lock) => lock.lock_type === "narration" && lock.scope === "shot"))
      .toBe(false);
    expect(built.affected_consumers).toContainEqual({ kind: "narration", id: "narration", action: "replace" });
  });

  it("asks for a narration project lock and a subtitle consumer when a subtitle changed", () => {
    const built = plan(
      projection([clip({ clip_id: "shot-001" })], [subtitle({ subtitle_id: "subs", content_sha256: sha("1") })]),
      projection([clip({ clip_id: "shot-001" })], [subtitle({ subtitle_id: "subs", content_sha256: sha("2") })]));
    expect(built.required_locks).toContainEqual({ lock_type: "narration", scope: "project",
      target_id: "", start_frame: 0, end_frame_exclusive: 900 });
    expect(built.affected_consumers).toContainEqual({ kind: "subtitle", id: "subs", action: "replace" });
  });

  it("records every consumer of a shared asset", () => {
    const built = plan(
      projection([
        clip({ clip_id: "shot-001", source_ref: "assets/shared.mp4" }),
        clip({ clip_id: "shot-002", frame_range: { start_frame: 300, end_frame_exclusive: 600 },
          source_ref: "assets/shared.mp4" }),
      ]),
      projection([
        clip({ clip_id: "shot-001", source_ref: "scenes/shot-001.html" }),
        clip({ clip_id: "shot-002", frame_range: { start_frame: 300, end_frame_exclusive: 600 },
          source_ref: "assets/shared.mp4" }),
      ]));
    expect(built.affected_consumers).toContainEqual({ kind: "shared_asset", id: "assets/shared.mp4",
      action: "relink" });
    // The shared asset's other user is affected too, so it carries its own visual lock.
    expect(built.required_locks).toContainEqual({ lock_type: "visual", scope: "shot",
      target_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 });
  });

  it("blocks the write with the real LockService when the plan asks for the project scope", () => {
    const revisions = new RevisionStore();
    try {
      const locks = new LockService(revisions);
      const built = plan(
        projection([clip({ clip_id: "shot-001", frame_range: { start_frame: 0, end_frame_exclusive: 300 } })]),
        projection([clip({ clip_id: "shot-001", frame_range: { start_frame: 0, end_frame_exclusive: 312 } })], [], 312));
      // A project-scope visual lock over the whole project.
      locks.acquire({ projectId: "of_test", lockType: "visual", scope: "project", targetId: "",
        startFrame: 0, endFrameExclusive: 900, owner: "test", reason: "m4c-02" }, 1);
      expect(() => locks.assertUnlocked("of_test", built.required_locks)).toThrow(/locked/u);
    } finally { revisions.close(); }
  });

  it("blocks the write with the real LockService when the plan asks for a shot scope", () => {
    const revisions = new RevisionStore();
    try {
      const locks = new LockService(revisions);
      const built = plan(
        projection([clip({ clip_id: "shot-001", source_ref: "assets/aa/source.mp4" })]),
        projection([clip({ clip_id: "shot-001", source_ref: "assets/bb/source.mp4" })]));
      locks.acquire({ projectId: "of_test", lockType: "visual", scope: "shot", targetId: "shot-001",
        startFrame: 0, endFrameExclusive: 300, owner: "test", reason: "m4c-02" }, 1);
      expect(() => locks.assertUnlocked("of_test", built.required_locks)).toThrow(/locked/u);
    } finally { revisions.close(); }
  });
});

describe("M4C-03: what the plan may describe and what this stage may restore", () => {
  it("describes a different clip identity rather than refusing to describe it", () => {
    // ADR D-04 can classify a clip added or removed, so the plan says so. The eligibility
    // rule below is a separate question, and this stage answers it with a 422.
    const built = plan(
      projection([clip({ clip_id: "shot-001" })]),
      projection([clip({ clip_id: "shot-001" }), clip({ clip_id: "shot-002",
        frame_range: { start_frame: 300, end_frame_exclusive: 600 } })], [], 600));
    expect(built.required_locks.some((lock) => lock.lock_type === "visual" && lock.scope === "project"))
      .toBe(true);
    expect(restoreTargetIsEligible(projection([clip({ clip_id: "shot-001" })]),
      projection([clip({ clip_id: "shot-001" }), clip({ clip_id: "shot-002" })]))).toBe(false);
  });

  it("accepts the same clip identity and track topology", () => {
    expect(restoreTargetIsEligible(projection([clip({ clip_id: "shot-001" })]),
      projection([clip({ clip_id: "shot-001", source_ref: "scenes/other.html" })]))).toBe(true);
    // A clip that moved to another track is a different topology.
    expect(restoreTargetIsEligible(projection([clip({ clip_id: "shot-001", track_id: "track_0" })]),
      projection([clip({ clip_id: "shot-001", track_id: "track_1" })]))).toBe(false);
  });

  it("refuses what it cannot classify", () => {
    const broken = { ...projection([clip({ clip_id: "shot-001" })]),
      problems: ["OPENFILM_PROJECTION:CLIP_NO_ID:track_0"] };
    expect(() => plan(broken, projection([clip({ clip_id: "shot-001" })]))).toThrow(/incomplete/u);
    expect(() => plan(projection([clip({ clip_id: "shot-001" })]),
      projection([clip({ clip_id: "shot-001" })]))).toThrow(/nothing to restore/u);
  });

  it("digests a projection by its content and not by the revision it was read at", () => {
    const base = projection([clip({ clip_id: "shot-001" })]);
    const moved = { ...base, project_revision: 99, control_revision: 7, snapshot_id: sha("8") };
    expect(projectionDigest(moved)).toBe(projectionDigest(base));
    const other = projection([clip({ clip_id: "shot-002" })]);
    expect(projectionDigest(other)).not.toBe(projectionDigest(base));
  });
});
