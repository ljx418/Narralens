import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contractIds, validateEditRequest, validateProposalBundle, validateProposalRequest, validatorFor } from "../../src/contracts/validator.js";

const proposal = JSON.parse(readFileSync(new URL("../../docs/contracts/proposal-bundle.example.json", import.meta.url), "utf8"));

describe("API contracts", () => {
  it("registers the D2-D4.0 frozen schemas", () => {
    expect(Object.keys(contractIds)).toHaveLength(12);
    for (const id of Object.values(contractIds)) expect(validatorFor(id)).toBeTypeOf("function");
  });

  it("accepts only the bounded D3 single-shot fit operation", () => {
    const request = { base_revision: 2, idempotency_key: "test-edit-001",
      selection: { shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
      preserve: ["narration", "duration"], operations: [{ op: "set_visual_fit", shot_id: "shot-002", value: "contain" }] };
    expect(validateEditRequest(request)).toEqual({ ok: true, value: request });
    expect(validateEditRequest({ ...request, operations: [{ ...request.operations[0], shot_id: "shot-003" }] })).toMatchObject({ ok: false });
    expect(validateEditRequest({ ...request, preserve: ["narration"] })).toMatchObject({ ok: false });
    expect(validateEditRequest({ ...request, operations: [{ ...request.operations[0], value: "stretch" }] })).toMatchObject({ ok: false });
  });

  it("accepts only opaque asset identities for the D4.0 media operation", () => {
    const request = { base_revision: 4, idempotency_key: "test-media-001",
      selection: { shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
      preserve: ["narration", "duration"], operations: [{ op: "replace_visual_asset", shot_id: "shot-002", asset_id: "asset_visual_d4_alt" }] };
    expect(validateEditRequest(request)).toEqual({ ok: true, value: request });
    expect(validateEditRequest({ ...request, operations: [{ ...request.operations[0], project_path: "../secret.mp4" }] })).toMatchObject({ ok: false });
    expect(validateEditRequest({ ...request, operations: [{ ...request.operations[0], asset_id: "https://example.test/a.mp4" }] })).toMatchObject({ ok: false });
  });

  it("accepts the canonical ProposalBundle example", () => {
    expect(validateProposalBundle(proposal)).toEqual({ ok: true, value: proposal });
  });

  it("rejects empty selections and segment coverage drift", () => {
    const empty = structuredClone(proposal);
    empty.selection.end_frame_exclusive = empty.selection.start_frame;
    expect(validateProposalBundle(empty)).toMatchObject({ ok: false });
    const drift = structuredClone(proposal);
    drift.segments[0].duration_frames += 1;
    expect(validateProposalBundle(drift)).toMatchObject({ ok: false });
  });

  it("rejects a renderable proposal with unresolved assets", () => {
    expect(validateProposalBundle({ ...proposal, renderable: true })).toMatchObject({ ok: false });
  });

  it("validates a bounded proposal request", () => {
    const request = { base_revision: 12, selection: proposal.selection, intent: "改成三镜组接，保留原旁白", preserve: ["narration:N03"] };
    expect(validateProposalRequest(request)).toEqual({ ok: true, value: request });
    expect(validateProposalRequest({ ...request, intent: "" })).toMatchObject({ ok: false });
  });
});
