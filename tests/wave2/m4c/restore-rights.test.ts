import { describe, expect, it } from "vitest";
import { targetRights } from "../../../src/host/history/restore-rights.js";
import type { EngineProjection } from "../../../src/contracts/engine-types.js";

const projection = (sourceRef: string): EngineProjection => ({
  engine: "openfilm", engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
  snapshot_id: "a".repeat(64), project_revision: 2, control_revision: 0,
  source_digest: "b".repeat(64), fps: { num: 30, den: 1 }, frame_count: 900,
  clips: [{ clip_id: "narration", track_id: "audio", kind: "sound",
    frame_range: { start_frame: 0, end_frame_exclusive: 900 },
    source_frame_range: { start_frame: 0, end_frame_exclusive: 900 },
    source_ref: sourceRef, overrides_digest: null }],
  tracks: [{ track_id: "audio", index: 0, clip_ids: ["narration"] }],
  subtitles: [], asset_references: [],
  editable_capabilities: { entries: {}, fps: { num: 30, den: 1 }, fps_verified: true },
  preview: { kind: "openfilm-studio", url: "/preview" }, problems: [],
});

const inventory = {
  kind: "activated" as const, project_id: "of_test", store: "migrated_asset_ledger" as const,
  inventory_sha256: "c".repeat(64), assets: [],
};

describe("M4C narration rights exception", () => {
  it("exempts only the exact migration-proven narration path", () => {
    const exact = targetRights({ project_id: "of_test", target_snapshot_id: "d".repeat(64),
      inventory, ledger: [], target_projection: projection("assets/narration.wav"),
      narration_target_path: "assets/narration.wav" });
    expect(exact.narration_path).toBe("assets/narration.wav");
    expect(exact.checked_assets).toEqual([]);

    expect(() => targetRights({ project_id: "of_test", target_snapshot_id: "d".repeat(64),
      inventory, ledger: [], target_projection: projection("assets/narration-copy.wav"),
      narration_target_path: "assets/narration.wav" })).toThrow(/does not own/u);
  });
});
