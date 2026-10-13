import { describe, expect, it } from "vitest";
import { contractIds, validateProposalComparison, validateProposalComparisonDraft, validateProposalComparisonRequest, validatorFor } from "../../src/contracts/validator.js";

const request = { base_revision: 2, selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 30 }, intent: "比较三种讲述路径", preserve: ["narration", "duration"], proposal_count: 3 } as const;
const draft = { schema_version: "1.0", kind: "narralens.proposal_comparison_draft", proposals: [1, 2, 3].map((index) => ({
  option_key: `option_${index}`, title: `方案 ${index}`, strategy: { kind: (["chronology", "contrast", "evidence-led"] as const)[index - 1], rationale: "结构理由" }, summary: "结构摘要",
  segments: [{ segment_id: `s${index}`, duration_frames: 30, role: "anchor", intent: "视觉意图", asset_requirement_ids: [] }], assets_needed: [], source_refs: [], requires_materialization: true, renderable: false,
})) };

describe("D4.1 comparison contracts", () => {
  it("registers all three D4.1 schemas", () => {
    expect(validatorFor(contractIds.proposalComparisonRequest)).toBeTypeOf("function");
    expect(validatorFor(contractIds.proposalComparisonDraft)).toBeTypeOf("function");
    expect(validatorFor(contractIds.proposalComparison)).toBeTypeOf("function");
  });

  it("accepts the bounded canonical request", () => expect(validateProposalComparisonRequest(request)).toEqual({ ok: true, value: request }));

  it.each([2, 7, 3.5])("rejects proposal_count %s", (proposal_count) => {
    expect(validateProposalComparisonRequest({ ...request, proposal_count })).toMatchObject({ ok: false });
  });

  it("rejects reverse ranges and request extras", () => {
    expect(validateProposalComparisonRequest({ ...request, selection: { ...request.selection, end_frame_exclusive: 0 } })).toMatchObject({ ok: false });
    expect(validateProposalComparisonRequest({ ...request, browser_source_refs: [] })).toMatchObject({ ok: false });
  });

  it("accepts a schema-conforming comparison draft and rejects injected trusted fields", () => {
    expect(validateProposalComparisonDraft(draft)).toMatchObject({ ok: true });
    expect(validateProposalComparisonDraft({ ...draft, project_id: "model-injected" })).toMatchObject({ ok: false });
    expect(validateProposalComparisonDraft({ ...draft, proposals: draft.proposals.map((item) => ({ ...item, materialization_cost: { amount: 1 } })) })).toMatchObject({ ok: false });
  });

  it("requires final proposal_count to equal the proposal array length", () => {
    const final = { schema_version: "1.0", kind: "narralens.proposal_comparison", comparison_id: "comparison_test", project_id: "d1-30s", base_revision: 2,
      selection: request.selection, intent_sha256: "a".repeat(64), preserve: request.preserve, proposal_count: 3, created_at: new Date().toISOString(),
      generation_audit: { stdout_sha256: "b".repeat(64), model_names: [], total_cost_usd: null, duration_ms: null, num_turns: null, service_tier: null },
      proposals: draft.proposals.map(({ option_key: _key, ...item }, index) => ({ ...item, proposal_id: `proposal_test_${index}`, materialization_cost: { status: "unknown", currency: null, amount: null } })) };
    expect(validateProposalComparison(final)).toMatchObject({ ok: true });
    expect(validateProposalComparison({ ...final, proposal_count: 4 })).toMatchObject({ ok: false });
  });
});
