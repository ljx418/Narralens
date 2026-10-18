import { describe, expect, it } from "vitest";
import {
  contractIds, validateAdoptRequest, validateControlledWriteResponse, validateImpactSpec,
  validateMaterialization, validateMaterializeRequest, validateRestoreRequest, validatorFor,
} from "../../src/contracts/validator.js";

/**
 * W2-G01: Wave 2 runtime contracts.
 *
 * These are the shapes M3 and M4 are validated against. A contract that drifts from its
 * TypeScript type is exactly the defect M2.1's round-1 review raised, so each case here
 * asserts both the schema's acceptance and its refusals.
 */

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const FPS = { num: 30, den: 1 };

const SEGMENT_BINDINGS = [
  { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 0, source_end_frame_exclusive: 300 },
  { segment_id: "seg-2", asset_id: "asset_b", source_start_frame: 0, source_end_frame_exclusive: 300 },
  { segment_id: "seg-3", asset_id: "asset_c", source_start_frame: 0, source_end_frame_exclusive: 300 },
];

const materializeRequest = {
  format: "narralens.materialize-request@1.0",
  comparison_id: "cmp_1",
  base_revision: 4,
  expected_source_digest: SHA,
  control_revision: 2,
  profile: { profile_id: "wave2-proxy-720p30-v1" },
  segment_bindings: SEGMENT_BINDINGS,
  idempotency_key: "materialize-0001",
};

const nativePlan = {
  format: "narralens.native-plan@1.0",
  engine: "openfilm",
  fps: FPS,
  clips: [
    { clip_id: "shot-001", segment_id: "seg-1", asset_id: "asset_a", asset_sha256: SHA,
      timeline: { start_frame: 0, end_frame_exclusive: 300 }, source: { start_frame: 0, end_frame_exclusive: 300 },
      track_id: "track_visual" },
    { clip_id: "shot-002", segment_id: "seg-2", asset_id: "asset_b", asset_sha256: OTHER_SHA,
      timeline: { start_frame: 300, end_frame_exclusive: 600 }, source: { start_frame: 0, end_frame_exclusive: 300 },
      track_id: "track_visual" },
    { clip_id: "shot-003", segment_id: "seg-3", asset_id: "asset_c", asset_sha256: SHA,
      timeline: { start_frame: 600, end_frame_exclusive: 900 }, source: { start_frame: 0, end_frame_exclusive: 300 },
      track_id: "track_visual" },
  ],
  narration_policy: "preserve",
  duration_policy: "preserve",
  total_frames: 900,
  plan_sha256: SHA,
};

const materialization = {
  format: "narralens.materialization@1.0",
  materialization_id: "mat_1",
  job_id: "job_mat_1",
  project_id: "of_d1-30s_abcdef12",
  comparison_id: "cmp_1",
  proposal_id: "proposal_x",
  state: "ready_for_adoption",
  base_revision: 4,
  source_digest: SHA,
  control_revision: 2,
  proposal_sha256: SHA,
  asset_inventory_sha256: OTHER_SHA,
  rights_digest: SHA,
  request_digest: OTHER_SHA,
  native_plan: nativePlan,
  proxy: { token: "proxies/" + SHA, sha256: SHA, frame_count: 900, profile_id: "wave2-proxy-720p30-v1" },
  lineage: [
    { output_sha256: SHA, input_asset_id: "asset_a", input_sha256: SHA,
      source: { start_frame: 0, end_frame_exclusive: 300 },
      output: { start_frame: 0, end_frame_exclusive: 300 } },
  ],
  blocking_reasons: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:01.000Z",
};

const impactSpec = {
  format: "narralens.impact@1.0",
  impact_id: "imp_1",
  project_id: "of_d1-30s_abcdef12",
  operation: "adopt_materialization",
  materialization_id: "mat_1",
  target_snapshot_id: null,
  base_revision: 4,
  source_digest: SHA,
  control_revision: 2,
  engine: "openfilm",
  engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
  affected_ranges: [
    { clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
    { clip_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
    { clip_id: "shot-003", start_frame: 600, end_frame_exclusive: 900 },
  ],
  affected_consumers: [
    { kind: "visual", id: "shot-002", action: "replace" },
    { kind: "narration", id: "narration", action: "preserve" },
  ],
  locks_checked: [{ lock_id: "lock_1", control_revision: 2 }],
  rights_digest: SHA,
  native_plan_sha256: OTHER_SHA,
  approvals_required: [],
  expires_at: "2026-01-01T00:15:00.000Z",
  impact_hash: SHA,
};

const adoptRequest = {
  format: "narralens.adopt-request@1.0",
  base_revision: 4,
  expected_source_digest: SHA,
  control_revision: 2,
  materialization_id: "mat_1",
  impact_id: "imp_1",
  impact_hash: SHA,
  approval: { confirmed: true },
  idempotency_key: "adopt-0001",
};

const restoreRequest = {
  format: "narralens.restore-request@1.0",
  base_revision: 4,
  expected_source_digest: SHA,
  control_revision: 2,
  target_snapshot_id: "snap_old",
  impact_id: "imp_2",
  impact_hash: OTHER_SHA,
  approval: { confirmed: true },
  idempotency_key: "restore-0001",
};

const controlledWriteResponse = {
  format: "narralens.controlled-write-response@1.0",
  transaction_id: "txn_1",
  project_id: "of_d1-30s_abcdef12",
  operation: "adopt_materialization",
  previous_revision: 4,
  new_revision: 5,
  snapshot_id: "snap_new",
  source_digest: SHA,
  outbox_event_id: 12,
  status: "committed",
};

describe("W2-G01 Wave 2 contracts are registered", () => {
  it("registers every Wave 2 schema alongside the frozen legacy set", () => {
    for (const key of ["materializeRequest", "materialization", "impactSpec", "adoptRequest",
      "restoreRequest", "controlledWriteResponse"] as const) {
      expect(contractIds[key], key).toBeTypeOf("string");
      expect(validatorFor(contractIds[key]), key).toBeTypeOf("function");
    }
  });

  it("keeps the D2-D4.2.1 schema set intact", () => {
    for (const key of ["apiError", "assetManifest", "editRequest", "jobResponse", "migrationPlan"] as const) {
      expect(contractIds[key], key).toBeTypeOf("string");
    }
  });
});

describe("W2-G01 MaterializeRequestV1", () => {
  it("accepts one binding per proposal segment", () => {
    expect(validateMaterializeRequest(materializeRequest)).toMatchObject({ ok: true });
  });

  it("refuses an empty, duplicated or over-complete binding set", () => {
    expect(validateMaterializeRequest({ ...materializeRequest, segment_bindings: [] })).toMatchObject({ ok: false });
    expect(validateMaterializeRequest({
      ...materializeRequest, segment_bindings: [SEGMENT_BINDINGS[0], SEGMENT_BINDINGS[0], SEGMENT_BINDINGS[0]],
    })).toMatchObject({ ok: false });
    expect(validateMaterializeRequest({
      ...materializeRequest, segment_bindings: [...SEGMENT_BINDINGS, SEGMENT_BINDINGS[0]],
    })).toMatchObject({ ok: false });
  });

  it("refuses a source span that is not an integer half-open range", () => {
    for (const span of [
      { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 0, source_end_frame_exclusive: 0 },
      { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: -1, source_end_frame_exclusive: 300 },
      { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 1.5, source_end_frame_exclusive: 300 },
      { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 300, source_end_frame_exclusive: 300 },
    ]) {
      expect(validateMaterializeRequest({
        ...materializeRequest, segment_bindings: [span, SEGMENT_BINDINGS[1], SEGMENT_BINDINGS[2]],
      }), JSON.stringify(span)).toMatchObject({ ok: false });
    }
  });

  it("refuses anything that looks like a server path, URL or shell argument", () => {
    for (const injected of [
      { ...materializeRequest, source_path: "/var/projects/x" },
      { ...materializeRequest, vendor_path: "/opt/openfilm" },
      { ...materializeRequest, segment_bindings: [{ ...SEGMENT_BINDINGS[0], url: "file:///etc/passwd" }] },
      { ...materializeRequest, command: "ffmpeg -y" },
    ]) {
      expect(validateMaterializeRequest(injected), JSON.stringify(injected)).toMatchObject({ ok: false });
    }
  });

  it("refuses a profile other than the frozen one", () => {
    expect(validateMaterializeRequest({ ...materializeRequest, profile: { profile_id: "anything" } }))
      .toMatchObject({ ok: false });
  });
});

describe("W2-G01 NativePlanV1 and MaterializationV1", () => {
  it("accepts a three-clip plan and a ready materialization", () => {
    expect(validateMaterialization(materialization)).toMatchObject({ ok: true });
  });

  it("refuses a plan with a flattened single clip", () => {
    expect(validateMaterialization({
      ...materialization, native_plan: { ...nativePlan, clips: [nativePlan.clips[0]] },
    })).toMatchObject({ ok: false });
  });

  it("refuses duplicate clip ids in one plan", () => {
    expect(validateMaterialization({
      ...materialization,
      native_plan: { ...nativePlan, clips: [nativePlan.clips[0], { ...nativePlan.clips[1], clip_id: "shot-001" }, nativePlan.clips[2]] },
    })).toMatchObject({ ok: false });
  });

  it("refuses a plan whose total_frames disagrees with its clips", () => {
    expect(validateMaterialization({
      ...materialization, native_plan: { ...nativePlan, total_frames: 450 },
    })).toMatchObject({ ok: false });
  });

  it("refuses a plan whose clips leave a leading gap or overlap each other", () => {
    const shifted = { ...nativePlan.clips[0], timeline: { start_frame: 30, end_frame_exclusive: 330 } };
    expect(validateMaterialization({
      ...materialization, native_plan: { ...nativePlan, clips: [shifted, nativePlan.clips[1], nativePlan.clips[2]] },
    })).toMatchObject({ ok: false });
    const overlapping = { ...nativePlan.clips[1], timeline: { start_frame: 150, end_frame_exclusive: 450 } };
    expect(validateMaterialization({
      ...materialization, native_plan: { ...nativePlan, clips: [nativePlan.clips[0], overlapping, nativePlan.clips[2]] },
    })).toMatchObject({ ok: false });
  });

  it("refuses a plan that would need an implicit speed change", () => {
    expect(validateMaterialization({
      ...materialization,
      native_plan: {
        ...nativePlan,
        clips: [nativePlan.clips[0], { ...nativePlan.clips[1], source: { start_frame: 0, end_frame_exclusive: 150 } }, nativePlan.clips[2]],
      },
    })).toMatchObject({ ok: false });
  });

  it("refuses two clips claiming the same proposal segment", () => {
    expect(validateMaterialization({
      ...materialization,
      native_plan: { ...nativePlan, clips: [nativePlan.clips[0], { ...nativePlan.clips[1], segment_id: "seg-1" }, nativePlan.clips[2]] },
    })).toMatchObject({ ok: false });
  });

  it("refuses a proxy no lineage entry accounts for", () => {
    expect(validateMaterialization({
      ...materialization, proxy: { ...materialization.proxy, sha256: OTHER_SHA },
    })).toMatchObject({ ok: false });
  });

  it("refuses fps other than the verified 30/1", () => {
    expect(validateMaterialization({
      ...materialization, native_plan: { ...nativePlan, fps: { num: 25, den: 1 } },
    })).toMatchObject({ ok: false });
  });

  it("refuses a proxy token that is a server path", () => {
    expect(validateMaterialization({
      ...materialization, proxy: { ...materialization.proxy, token: "/var/artifacts/x.mp4" },
    })).toMatchObject({ ok: false });
  });

  it("requires lineage for every output", () => {
    expect(validateMaterialization({ ...materialization, lineage: [] })).toMatchObject({ ok: false });
  });

  it("refuses a materialization carrying an unknown state", () => {
    expect(validateMaterialization({ ...materialization, state: "adopted" })).toMatchObject({ ok: false });
  });
});

describe("W2-G01 ImpactSpecV1", () => {
  it("accepts a well-formed impact", () => {
    expect(validateImpactSpec(impactSpec)).toMatchObject({ ok: true });
  });

  it("refuses an operation other than the two controlled writes", () => {
    expect(validateImpactSpec({ ...impactSpec, operation: "materialize" })).toMatchObject({ ok: false });
  });

  it("refuses an unknown consumer kind", () => {
    expect(validateImpactSpec({
      ...impactSpec, affected_consumers: [{ kind: "plugin", id: "x", action: "preserve" }],
    })).toMatchObject({ ok: false });
  });

  it("refuses an adopt impact with no materialization, and a restore impact with no snapshot", () => {
    expect(validateImpactSpec({ ...impactSpec, materialization_id: null })).toMatchObject({ ok: false });
    expect(validateImpactSpec({ ...impactSpec, operation: "restore_snapshot", materialization_id: "mat_1", target_snapshot_id: null }))
      .toMatchObject({ ok: false });
  });
});

describe("W2-G01 adopt, restore and the controlled-write response", () => {
  it("accepts both request shapes and the response", () => {
    expect(validateAdoptRequest(adoptRequest)).toMatchObject({ ok: true });
    expect(validateRestoreRequest(restoreRequest)).toMatchObject({ ok: true });
    expect(validateControlledWriteResponse(controlledWriteResponse)).toMatchObject({ ok: true });
  });

  it("refuses approval that is not an explicit confirmation", () => {
    expect(validateAdoptRequest({ ...adoptRequest, approval: { confirmed: false } })).toMatchObject({ ok: false });
    expect(validateAdoptRequest({ ...adoptRequest, approval: {} })).toMatchObject({ ok: false });
  });

  it("refuses a response that does not advance the revision by exactly one", () => {
    for (const previous of [4, 6]) {
      expect(validateControlledWriteResponse({
        ...controlledWriteResponse, previous_revision: previous, new_revision: previous + 1,
      })).toMatchObject({ ok: true });
    }
    expect(validateControlledWriteResponse({ ...controlledWriteResponse, new_revision: 6 })).toMatchObject({ ok: false });
    expect(validateControlledWriteResponse({ ...controlledWriteResponse, new_revision: 4 })).toMatchObject({ ok: false });
  });

  it("refuses any request field that names a server path", () => {
    expect(validateAdoptRequest({ ...adoptRequest, snapshot_root: "/var/snapshots" })).toMatchObject({ ok: false });
    expect(validateRestoreRequest({ ...restoreRequest, root: "/var" })).toMatchObject({ ok: false });
  });
});

describe("W2-G01 the new error codes exist and are aliased", () => {
  it("carries IMPACT_REQUIRED and IMPACT_STALE at 428, distinct from APPROVAL_REQUIRED", async () => {
    const { ERROR_ALIAS_TABLE } = await import("../../src/host/engine/error-alias.js");
    const byCode = new Map(ERROR_ALIAS_TABLE.map((entry) => [entry.code, entry]));
    expect(byCode.get("IMPACT_REQUIRED")).toMatchObject({ http_status: 428, legacy: false });
    expect(byCode.get("IMPACT_STALE")).toMatchObject({ http_status: 428, legacy: false });
    expect(byCode.get("IMPACT_STALE")!.distinguishes_from).toBe("IMPACT_REQUIRED");
    expect(byCode.get("APPROVAL_REQUIRED")!.legacy).toBe(true);
  });
});
