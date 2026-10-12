import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cliProposalEnvelopeSchema, ControlledAgentRunner, type RunnerInput } from "../../src/adapters/openmontage/controlled-agent-runner.js";
import { HttpError } from "../../src/host/api-error.js";

const fake = resolve("tests/fixtures/fake-runner.mjs");
const input = (intent: string): RunnerInput => ({
  project: { project_id: "d1-30s", revision: 2, frame_rate: 30, frame_count: 900 },
  request: { base_revision: 2, selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }, intent, preserve: ["旁白"] },
  fixed_context: { product: "Narralens", output_contract: "narralens.proposal_bundle@1.0", upstream: "OpenMontage", pipeline: "proposal-only" },
});

function runner(options: { timeoutMs?: number; maxOutputBytes?: number } = {}): ControlledAgentRunner {
  return new ControlledAgentRunner({ executable: process.execPath, prefixArgs: [fake], ...options });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try { await promise; throw new Error("expected rejection"); }
  catch (error) { expect(error).toBeInstanceOf(HttpError); expect((error as HttpError).code).toBe(code); }
}

describe("D2 controlled runner", () => {
  it("derives the CLI structural envelope from every canonical top-level field", () => {
    const schema = cliProposalEnvelopeSchema as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).not.toContain("source_packet");
    expect(Object.keys(schema.properties)).toContain("source_packet");
    expect(Object.keys(schema.properties)).toContain("segments");
    expect(Object.keys(schema.properties)).toContain("renderable");
  });
  it("accepts one bounded structured JSON result", async () => {
    const output = await runner().run(input("强化因果关系"));
    expect(output.raw_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((output.value as { proposal_id: string }).proposal_id).toBe("proposal_test");
  });

  it("maps malformed and oversized output", async () => {
    await expectCode(runner().run(input("bad-json")), "INVALID_PROPOSAL");
    await expectCode(runner({ maxOutputBytes: 1024 }).run(input("too-large")), "INVALID_PROPOSAL");
  });

  it("rejects a stringified result instead of silently reparsing it", async () => {
    await expectCode(runner().run(input("string-result")), "INVALID_PROPOSAL");
  });

  it("maps authoritative 422 and 529 without retrying", async () => {
    await expectCode(runner().run(input("provider-422")), "PROVIDER_REJECTED");
    await expectCode(runner().run(input("provider-529")), "PROVIDER_OVERLOADED");
  });

  it("maps missing executable and timeout", async () => {
    await expectCode(new ControlledAgentRunner({ executable: "narralens-missing-executable" }).run(input("ok")), "RUNNER_UNAVAILABLE");
    await expectCode(runner({ timeoutMs: 50 }).run(input("timeout")), "RUNNER_TIMEOUT");
  });
});
