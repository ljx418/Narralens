import { describe, expect, it } from "vitest";
import { contractIds, validateAdoptRequest, validatorFor } from "../../src/contracts/validator.js";
import { ERROR_ALIAS_TABLE } from "../../src/host/engine/error-alias.js";
import type { TypedEdit } from "../../src/contracts/engine-types.js";

/**
 * W2-G03: `TypedEdit` grows; the legacy `EditRequest` contract does not.
 *
 * The risk this file guards is asymmetric. If a Wave 2 controlled operation leaked into
 * `EditOperation`, the frozen legacy `POST /api/projects/:id/edits` would start accepting an
 * adoption with no impact id — the precise bypass M4 exists to close. So the negative cases
 * below matter more than the positive one.
 */

const IMPACT_HASH = "c".repeat(64);

describe("W2-G03 the typed-edit union", () => {
  it("carries both controlled operations with their authorization ids", () => {
    const adopt: TypedEdit = {
      op: "adopt_materialization", materialization_id: "mat_1",
      impact_id: "imp_1", impact_hash: IMPACT_HASH, approval: { confirmed: true },
    };
    const restore: TypedEdit = {
      op: "restore_snapshot", target_snapshot_id: "snap_1",
      impact_id: "imp_2", impact_hash: IMPACT_HASH, approval: { confirmed: true },
    };
    expect(adopt.op).toBe("adopt_materialization");
    expect(restore.op).toBe("restore_snapshot");
  });

  it("cannot be constructed without an impact id or hash", () => {
    // @ts-expect-error approval alone is not a controlled operation
    const noImpact: TypedEdit = { op: "adopt_materialization", materialization_id: "mat_1", approval: { confirmed: true } };
    // @ts-expect-error a restore must name the snapshot whose content is being restored
    const noSnapshot: TypedEdit = { op: "restore_snapshot", impact_id: "imp_1", impact_hash: IMPACT_HASH, approval: { confirmed: true } };
    expect([noImpact, noSnapshot]).toHaveLength(2);
  });

  it("does not let the legacy edit-request contract express either operation", () => {
    const legacy = validatorFor(contractIds.editRequest);
    const legacyRequest = {
      base_revision: 4,
      idempotency_key: "legacy-1",
      selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
      preserve: ["narration"],
      operations: [{
        op: "adopt_materialization", materialization_id: "mat_1",
        impact_id: "imp_1", impact_hash: IMPACT_HASH, approval: { confirmed: true },
      }],
    };
    expect(legacy(legacyRequest)).toBe(false);
    expect(validateAdoptRequest({
      format: "narralens.adopt-request@1.0", base_revision: 4, expected_source_digest: "a".repeat(64),
      control_revision: 2, materialization_id: "mat_1", impact_id: "imp_1", impact_hash: IMPACT_HASH,
      approval: { confirmed: true }, idempotency_key: "adopt-1",
    })).toMatchObject({ ok: true });
  });
});

describe("W2-G03 the two new error codes are fully wired", () => {
  it("appears in the runtime API error schema, not only in the TypeScript union", () => {
    const apiError = validatorFor(contractIds.apiError);
    const response = (code: string) => ({ code, message: "x", correlation_id: "corr_00001" });
    expect(apiError(response("IMPACT_REQUIRED"))).toBe(true);
    expect(apiError(response("IMPACT_STALE"))).toBe(true);
    expect(apiError(response("IMPACT_UNVERIFIED"))).toBe(false);
  });

  it("keeps the legacy 428 and the two new 428s distinguishable in the alias table", () => {
    const rows = ERROR_ALIAS_TABLE.filter((row) => row.http_status === 428);
    expect(rows.map((row) => row.code).sort()).toEqual(["APPROVAL_REQUIRED", "IMPACT_REQUIRED", "IMPACT_STALE"]);
    // The two new codes each name a different neighbour, and neither points at itself, so a
    // client cannot read "my impact is stale" as "I never had an impact".
    const targets = rows.filter((row) => !row.legacy).map((row) => row.distinguishes_from);
    expect(targets).toEqual(["APPROVAL_REQUIRED", "IMPACT_REQUIRED"]);
    expect(new Set(targets).size).toBe(2);
    for (const row of ERROR_ALIAS_TABLE) expect(row.http_status, row.code).toBeGreaterThanOrEqual(400);
  });
});
