import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cliComparisonEnvelopeSchema, ControlledAgentRunner, inlineProviderSchema, type ComparisonRunnerInput } from "../../src/adapters/openmontage/controlled-agent-runner.js";

const input: ComparisonRunnerInput = { project: { project_id: "d1-30s", revision: 2, frame_rate: 30, frame_count: 900 },
  request: { base_revision: 2, selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }, intent: "比较三种结构", preserve: ["narration", "duration"], proposal_count: 3 },
  fixed_context: { product: "Narralens", output_contract: "narralens.proposal_comparison_draft@1.0", upstream: "OpenMontage", pipeline: "proposal-comparison-only", allowed_source_refs: [] } };
function runner(options: { maxOutputBytes?: number } = {}): ControlledAgentRunner { return new ControlledAgentRunner({ executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-runner.mjs")], timeoutMs: 500, ...options }); }

describe("D4.1 controlled comparison runner", () => {
  it("inlines all local definitions without weakening constraints", () => {
    const text = JSON.stringify(cliComparisonEnvelopeSchema);
    expect(text).not.toContain("$ref"); expect(text).not.toContain("$defs");
    expect(text).toContain('"additionalProperties":false'); expect(text).toContain('"minItems":3');
    expect(text).toContain('"maxItems":6'); expect(text).toContain('"const":"narralens.proposal_comparison_draft"');
    expect(text).toContain('"const":"narralens.proposal_comparison_draft","type":"string"');
  });
  it("fails closed on external references", () => expect(() => inlineProviderSchema({ type: "object", properties: { item: { $ref: "other.json" } } })).toThrow(/Unsupported/));
  it("fails closed on recursive definitions", () => expect(() => inlineProviderSchema({ type: "object", properties: { item: { $ref: "#/$defs/node" } }, $defs: { node: { type: "object", properties: { child: { $ref: "#/$defs/node" } } } } })).toThrow(/Recursive/));
  it("returns one requested comparison set with wrapper audit", async () => {
    const output = await runner().runComparison(input);
    expect(output.value).toMatchObject({ kind: "narralens.proposal_comparison_draft", proposals: expect.arrayContaining([expect.any(Object)]) });
    expect((output.value as { proposals: unknown[] }).proposals).toHaveLength(3);
    expect(output.audit).toMatchObject({ model_names: ["fake-model"], total_cost_usd: 0.0123, duration_ms: 42, num_turns: 1, service_tier: "test" });
    expect(output.raw_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("uses INVALID_PROPOSAL_SET for oversized comparison output", async () => {
    await expect(runner({ maxOutputBytes: 1024 }).runComparison({ ...input, request: { ...input.request, intent: "too-large" } })).rejects.toMatchObject({ status: 422, code: "INVALID_PROPOSAL_SET" });
  });
  it.each([["provider-422", "PROVIDER_REJECTED"], ["provider-529", "PROVIDER_OVERLOADED"]] as const)("maps %s once to %s", async (intent, code) => {
    await expect(runner().runComparison({ ...input, request: { ...input.request, intent } })).rejects.toMatchObject({ code });
  });
  it("maps comparison timeout without publishing a fallback", async () => {
    const slow = new ControlledAgentRunner({ executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-runner.mjs")], timeoutMs: 30 });
    await expect(slow.runComparison({ ...input, request: { ...input.request, intent: "timeout" } })).rejects.toMatchObject({ code: "RUNNER_TIMEOUT" });
  });
});
