import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProposalComparisonAdapter, proposalStructureSignature } from "../../src/adapters/openmontage/proposal-comparison-adapter.js";
import type { ProposalComparisonDraft, ProposalComparisonRequest, RunnerGenerationAudit } from "../../src/contracts/types.js";
import { HttpError } from "../../src/host/api-error.js";

const roots: string[] = [];
afterEach(async () => { const { rm } = await import("node:fs/promises"); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const request: ProposalComparisonRequest = { base_revision: 2, selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 30 }, intent: "比较路径", preserve: ["narration", "duration"], proposal_count: 3 };
const audit: RunnerGenerationAudit = { stdout_sha256: "b".repeat(64), model_names: ["test"], total_cost_usd: 0.1, duration_ms: 5, num_turns: 1, service_tier: "test" };

function option(index: number, durations: number[], roles?: Array<"anchor" | "context" | "evidence">): ProposalComparisonDraft["proposals"][number] {
  return { option_key: `option_${index}`, title: `方案 ${index}`, strategy: { kind: (["chronology", "contrast", "evidence-led"] as const)[index - 1]!, rationale: "理由" }, summary: "摘要",
    segments: durations.map((duration_frames, part) => ({ segment_id: `s_${index}_${part}`, duration_frames, role: roles?.[part] ?? (["anchor", "context", "evidence"] as const)[part % 3]!, intent: "视觉意图", asset_requirement_ids: [] })),
    assets_needed: [], source_refs: [], requires_materialization: true, renderable: false };
}
function draft(): ProposalComparisonDraft { return { schema_version: "1.0", kind: "narralens.proposal_comparison_draft", proposals: [option(1, [30]), option(2, [10, 20]), option(3, [5, 10, 15])] }; }
async function adapter(): Promise<{ root: string; value: ProposalComparisonAdapter }> { const root = await mkdtemp(resolve(tmpdir(), "narralens-d41-")); roots.push(root); return { root, value: new ProposalComparisonAdapter(root) }; }
async function invalid(action: () => unknown | Promise<unknown>): Promise<void> {
  try { await action(); throw new Error("expected INVALID_PROPOSAL_SET"); }
  catch (error) { expect(error).toMatchObject({ status: 422, code: "INVALID_PROPOSAL_SET" }); }
}

describe("D4.1 ProposalComparisonAdapter", () => {
  it("normalizes integer duration vectors by GCD", () => expect(proposalStructureSignature(option(1, [100, 200])).normalized_durations).toEqual([1, 2]));
  it("builds Host-owned bindings, IDs, audit and unknown materialization cost", async () => {
    const { value } = await adapter(); const result = value.build(draft(), "d1-30s", request, audit, new Date("2026-01-01T00:00:00Z"));
    expect(result).toMatchObject({ project_id: "d1-30s", base_revision: 2, proposal_count: 3, generation_audit: audit, created_at: "2026-01-01T00:00:00.000Z" });
    expect(result.intent_sha256).toMatch(/^[a-f0-9]{64}$/); expect(new Set(result.proposals.map((item) => item.proposal_id)).size).toBe(3);
    expect(result.proposals.every((item) => item.materialization_cost.status === "unknown")).toBe(true);
  });
  it("rejects a candidate count mismatch", async () => { const { value } = await adapter(); const bad = draft(); bad.proposals.pop(); await invalid(() => value.build(bad, "d1-30s", request, audit)); });
  it("rejects duplicate option keys", async () => { const { value } = await adapter(); const bad = draft(); bad.proposals[1]!.option_key = bad.proposals[0]!.option_key; await invalid(() => value.build(bad, "d1-30s", request, audit)); });
  it("rejects duplicate strategies", async () => { const { value } = await adapter(); const bad = draft(); bad.proposals[1]!.strategy.kind = bad.proposals[0]!.strategy.kind; await invalid(() => value.build(bad, "d1-30s", request, audit)); });
  it("rejects duration coverage drift", async () => { const { value } = await adapter(); const bad = draft(); bad.proposals[2]!.segments[0]!.duration_frames += 1; await invalid(() => value.build(bad, "d1-30s", request, audit)); });
  it("rejects non-empty untrusted source references", async () => { const { value } = await adapter(); const bad = draft(); bad.proposals[0]!.source_refs.push({ ref_id: "ref_1", kind: "research", label: "模型来源" }); await invalid(() => value.build(bad, "d1-30s", request, audit)); });
  it("rejects dangling asset requirements", async () => { const { value } = await adapter(); const bad = draft(); bad.proposals[0]!.segments[0]!.asset_requirement_ids.push("missing_asset"); await invalid(() => value.build(bad, "d1-30s", request, audit)); });
  it("rejects pairwise structurally identical candidates despite different strategies", async () => { const { value } = await adapter(); const bad = draft(); bad.proposals[1]!.segments = structuredClone(bad.proposals[0]!.segments); bad.proposals[1]!.segments[0]!.segment_id = "unique_segment"; await invalid(() => value.build(bad, "d1-30s", request, audit)); });
  it("atomically saves and validates a complete comparison on read", async () => { const { root, value } = await adapter(); const built = value.build(draft(), "d1-30s", request, audit); await value.save(built); expect(await value.read(built.comparison_id)).toEqual(built); expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]); });
  it("fails closed when a final comparison file is corrupt", async () => { const { root, value } = await adapter(); await writeFile(resolve(root, "comparison_corrupt.json"), "{broken", "utf8"); await expect(value.read("comparison_corrupt")).rejects.toMatchObject({ status: 422, code: "INVALID_PROPOSAL_SET" }); });
  it("cleans only private temporary files", async () => { const { root, value } = await adapter(); await writeFile(resolve(root, ".narralens-comparison-stale.tmp"), "x"); await writeFile(resolve(root, "user.tmp"), "keep"); expect(await value.cleanupStaleTemporaryFiles()).toBe(1); expect(await readdir(root)).toEqual(["user.tmp"]); });
});
