import { describe, expect, it } from "vitest";
import {
  contractIds, validateComparisonReplayRequest, validateComparisonReplayResponse,
  validateLockCreateRequest, validateLockMutationResponse, validatePublicLock,
  validateWorkbenchProjection, validatorFor,
} from "../../src/contracts/validator.js";
import type { WorkbenchProjectionV1 } from "../../src/contracts/wave3-types.js";

/**
 * M5's contracts.
 *
 * The shape is the JSON Schema's; these tests pin the three things a schema cannot say:
 * that the contracts are *registered* (a contract nobody validates is a contract nobody
 * enforces), that an unknown field is refused rather than ignored, and that the two rules
 * the schema cannot express — a shot lock names a clip, a project lock does not, and a
 * frame range is never empty — actually hold.
 */

const workbench = (): WorkbenchProjectionV1 => ({
  format: "narralens.workbench@1.0",
  project_id: "of_target",
  source_project_id: "d1-30s",
  migration_id: "mig_1",
  revision: 2,
  control_revision: 1,
  source_digest: "a".repeat(64),
  active_snapshot_id: "b".repeat(64),
  fps: { num: 30, den: 1 },
  frame_count: 900,
  engine: "openfilm",
  engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
  tracks: [{ track_id: "track_0", index: 0, clip_ids: ["shot-001"] }],
  clips: [{
    clip_id: "shot-001", track_id: "track_0", kind: "page",
    start_frame: 0, end_frame_exclusive: 300,
    source_shot_id: "shot-001", source_label: "镜头 1",
  }],
  history: [{ revision: 1, snapshot_id: "c".repeat(64), kind: "migration", transaction_id: "txn_1" }],
  active_locks: [],
  capabilities: [{ entry_id: "timeline.adopt_materialization", state: "supported", reason: "受控采用" }],
  preview: { kind: "openfilm-studio", url: "http://127.0.0.1:1234/", bridge_version: 1 },
  narration: "present",
});

describe("M5 contracts: registration and shape", () => {
  it("registers every M5 contract", () => {
    for (const key of ["workbench", "publicLock", "lockMutationResponse", "lockRequest",
      "comparisonReplayRequest", "comparisonReplayResponse"]) {
      expect(contractIds, key).toHaveProperty(key);
      expect(validatorFor((contractIds as Record<string, string>)[key]!)).toBeTypeOf("function");
    }
  });

  it("accepts a well-formed workbench projection", () => {
    const result = validateWorkbenchProjection(workbench());
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
  });

  it("refuses a workbench projection with an unknown field", () => {
    const result = validateWorkbenchProjection({ ...workbench(), source_path: "/home/operator/film" });
    expect(result.ok).toBe(false);
  });

  it("refuses a workbench projection that claims the source and the target are the same project", () => {
    const result = validateWorkbenchProjection({ ...workbench(), source_project_id: "of_target" });
    expect(result.ok).toBe(false);
  });

  it("refuses a workbench projection whose track names a clip that does not exist", () => {
    const result = validateWorkbenchProjection({
      ...workbench(), tracks: [{ track_id: "track_0", index: 0, clip_ids: ["shot-404"] }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed public lock and refuses a shot lock with no clip", () => {
    const lock = {
      format: "narralens.public-lock@1.0", lock_id: "lock_1", project_id: "of_target",
      lock_type: "visual", scope: "shot", target_id: "shot-001",
      start_frame: 0, end_frame_exclusive: 300, owner_label: "本机操作者",
      reason_code: "preserve_visual", control_revision: 1, created_at: "2026-10-26T00:00:00.000Z",
    };
    expect(validatePublicLock(lock).ok).toBe(true);
    expect(validatePublicLock({ ...lock, target_id: null }).ok).toBe(false);
    expect(validatePublicLock({ ...lock, scope: "project", target_id: "shot-001" }).ok).toBe(false);
    expect(validatePublicLock({ ...lock, end_frame_exclusive: 0 }).ok).toBe(false);
    expect(validatePublicLock({ ...lock, owner_label: "someone else" }).ok).toBe(false);
  });

  it("accepts a lock mutation response and refuses an unknown field", () => {
    const lock = {
      format: "narralens.public-lock@1.0", lock_id: "lock_1", project_id: "of_target",
      lock_type: "visual", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: 900, owner_label: "本机操作者",
      reason_code: "user_review", control_revision: 2, created_at: "2026-10-26T00:00:00.000Z",
    };
    const response = {
      format: "narralens.lock-mutation-response@1.0", project_id: "of_target",
      lock, active: true, control_revision: 2,
    };
    expect(validateLockMutationResponse(response).ok).toBe(true);
    expect(validateLockMutationResponse({ ...response, extra: 1 }).ok).toBe(false);
  });

  it("accepts a lock creation request and refuses a client-named owner", () => {
    const request = {
      format: "narralens.lock-request@1.0", base_control_revision: 1,
      lock_type: "narration", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: 900, reason_code: "preserve_narration",
      idempotency_key: "lock-1",
    };
    expect(validateLockCreateRequest(request).ok).toBe(true);
    expect(validateLockCreateRequest({ ...request, owner: "me" }).ok).toBe(false);
    expect(validateLockCreateRequest({ ...request, lock_type: "audio" }).ok).toBe(false);
    expect(validateLockCreateRequest({ ...request, scope: "shot" }).ok).toBe(false);
  });

  it("accepts a comparison replay request and response, and refuses a provider field", () => {
    const request = {
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: "comparison_abc", base_revision: 1, idempotency_key: "replay-1",
    };
    expect(validateComparisonReplayRequest(request).ok).toBe(true);
    expect(validateComparisonReplayRequest({ ...request, prompt: "write me a new one" }).ok).toBe(false);
    const response = {
      format: "narralens.comparison-replay-response@1.0", project_id: "of_target",
      comparison_id: "comparison_def",
      lineage: {
        source_comparison_id: "comparison_abc", source_project_id: "d1-30s",
        migration_id: "mig_1", source_sha256: "d".repeat(64),
      },
      comparison: {
        schema_version: "1.0", kind: "narralens.proposal_comparison",
        comparison_id: "comparison_def", project_id: "of_target", base_revision: 1,
        selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
        intent_sha256: "e".repeat(64), preserve: ["narration"], proposal_count: 3,
        proposals: [1, 2, 3].map((index) => ({
          proposal_id: `proposal_def_${index}`,
          title: `方案 ${index}`, strategy: { kind: "chronology", rationale: "r" },
          summary: "s", segments: [{
            segment_id: `segment_${index}`, duration_frames: 300, role: "anchor",
            intent: "i", asset_requirement_ids: [],
          }],
          assets_needed: [], source_refs: [], requires_materialization: true, renderable: false,
          materialization_cost: { status: "unknown", currency: null, amount: null },
        })),
        generation_audit: {
          stdout_sha256: "f".repeat(64), model_names: ["recorded"], total_cost_usd: 0,
          duration_ms: 1, num_turns: 1, service_tier: null,
        },
        created_at: "2026-10-26T00:00:00.000Z",
      },
      replayed: false,
    };
    const result = validateComparisonReplayResponse(response);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
    expect(validateComparisonReplayResponse({ ...response, provider: "claude" }).ok).toBe(false);
  });
});
