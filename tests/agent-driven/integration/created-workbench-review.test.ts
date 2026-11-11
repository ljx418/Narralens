import { describe, expect, it } from "vitest";
import {
  AgentWorkbenchClient,
  isUnavailable,
  unavailableReason,
  type WorkbenchUiTransport,
} from "../../../src/app/agent-workbench-client.js";
import { GatewayApiError } from "../../../src/app/m5/GatewayApiClient.js";
import type { ReviewPackage } from "../../../src/contracts/agent-driven-types.js";

/**
 * The review consumer of the workbench.
 *
 * These cases are about the *client* half of the seam: which closed call each read and
 * each decision makes, and what the client refuses to claim. They mount no Host, bind no
 * port and touch no media, so they are component evidence — not a producer-consumer
 * proof. The Host's own dispatcher and the real prepared media are BRIDGE's and MEDIA's
 * producers, and they are not here.
 */

interface Call {
  readonly surface: string;
  readonly operation: string;
  readonly input: unknown;
}

const PACKAGE: ReviewPackage = {
  project_id: "project-1",
  run_id: "run-1",
  plan_version: 1,
  package_id: "package-1",
  version: 2,
  kind: "chapter_pack",
  chapter_id: "chapter-1",
  input_digest: "a".repeat(64),
  output_digest: "b".repeat(64),
  quality_digest: "c".repeat(64),
  parts: [
    { kind: "preview", artifact_ref: { id: "art-video", version: 1, sha256: "d".repeat(64) }, download_ref: null },
    { kind: "narration", artifact_ref: { id: "art-audio", version: 1, sha256: "e".repeat(64) }, download_ref: null },
    { kind: "subtitles", artifact_ref: { id: "art-subs", version: 1, sha256: "f".repeat(64) }, download_ref: null },
    { kind: "shot_summary", artifact_ref: { id: "art-shots", version: 1, sha256: "1".repeat(64) }, download_ref: null },
    { kind: "rights_quality", artifact_ref: { id: "art-rights", version: 1, sha256: "2".repeat(64) }, download_ref: null },
  ],
  source_shot_ids: ["shot-1"],
  selection_reason: "章节候选",
  allowed_choices: ["accept", "changes_requested", "reject", "accept_and_adopt"],
  impact: {
    impact_id: "impact-1",
    project_id: "project-1",
    materialization_id: "mat-1",
    base_revision: 3,
    control_revision: 1,
    source_digest: "3".repeat(64),
    selection_version: 2,
    plan_sha256: "4".repeat(64),
    target_snapshot_id: "5".repeat(64),
    expires_at: "2026-11-12T00:00:00.000Z",
    state: "active",
    summary: "本次采用的影响",
  },
  reuse_of_package_id: null,
  review_url: "/workbench/projects/project-1/reviews/package-1",
  state: "pending",
};

function transport(answers: Record<string, unknown> = {}): WorkbenchUiTransport & { readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    call: async (surface: string, operation: string, input: unknown) => {
      calls.push({ surface, operation, input });
      const key = `${surface}/${operation}`;
      const answer = answers[key];
      if (answer === undefined) throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
      return answer;
    },
  };
}

describe("the workbench observation client", () => {
  it("reads the workflow, the context and the health over their own closed calls", async () => {
    const bus = transport({
      "agent.v1/workflow.read": { project_id: "project-1", workflow_revision: 3, nodes: [], next_actions: [] },
      "agent.v1/context.read": { project_id: "project-1", native_sync: "unknown" },
      "agent.v1/health.read": { services: [], sample_interval_ms: 5000, stale_after_ms: 15000 },
    });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await client.readWorkflow();
    await client.readContext();
    await client.readHealth();
    expect(bus.calls.map((call) => `${call.surface}/${call.operation}`)).toEqual([
      "agent.v1/workflow.read",
      "agent.v1/context.read",
      "agent.v1/health.read",
    ]);
    expect(bus.calls[0]!.input).toEqual({ project_id: "project-1" });
    expect(bus.calls[2]!.input).toBeNull();
  });

  it("refuses an answer that belongs to another project", async () => {
    const bus = transport({ "agent.v1/context.read": { project_id: "project-2" } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readContext()).rejects.toThrow("INVALID_CONTEXT");
  });

  it("reads the review package of the named run", async () => {
    const bus = transport({ "agent.v1/review.read": PACKAGE });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const document_ = await client.readReview("run-1", "package-1");
    expect(document_.package_id).toBe("package-1");
    expect(bus.calls[0]!.input).toEqual({ project_id: "project-1", run_id: "run-1", package_id: "package-1" });
  });

  it("records a decision with exactly the frozen input fields", async () => {
    const decision = {
      decision_id: "decision-1",
      project_id: "project-1",
      run_id: "run-1",
      package_id: "package-1",
      package_version: 2,
      input_digest: "a".repeat(64),
      output_digest: "b".repeat(64),
      quality_digest: "c".repeat(64),
      choice: "accept_and_adopt",
      principal_id: "operator",
      channel: "trusted_ui",
      recorded_at: "2026-11-11T00:00:00.000Z",
      approval: null,
    };
    const bus = transport({ "agent.v1/review.decide": decision });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const recorded = await client.decideReview({
      meta: { idempotency_key: "key-1", correlation_id: "corr-1" },
      package: PACKAGE,
      choice: "accept_and_adopt",
    });
    expect(recorded.decision_id).toBe("decision-1");
    const input = bus.calls[0]!.input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual([
      "choice", "impact_id", "input_digest", "meta", "output_digest", "package_id",
      "package_version", "plan_sha256", "plan_version", "project_id", "quality_digest", "run_id",
    ]);
    expect(input.choice).toBe("accept_and_adopt");
    expect(input.impact_id).toBe("impact-1");
    expect(input.plan_sha256).toBe("4".repeat(64));
    expect(input.meta).toEqual({ idempotency_key: "key-1", correlation_id: "corr-1" });
  });

  it("does not turn a recorded decision into a commit or an acknowledgement", async () => {
    const bus = transport({
      "agent.v1/review.decide": {
        decision_id: "decision-1",
        project_id: "project-1",
        run_id: "run-1",
        package_id: "package-1",
        package_version: 2,
        input_digest: "a".repeat(64),
        output_digest: "b".repeat(64),
        quality_digest: "c".repeat(64),
        choice: "accept_and_adopt",
        principal_id: "operator",
        channel: "trusted_ui",
        recorded_at: "2026-11-11T00:00:00.000Z",
        approval: null,
      },
    });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const recorded = await client.decideReview({
      meta: { idempotency_key: "key-1", correlation_id: "corr-1" },
      package: PACKAGE,
      choice: "accept_and_adopt",
    });
    // The answer is a decision and nothing else: no commit, no native acknowledgement.
    expect(Object.keys(recorded).sort()).toEqual([
      "approval", "channel", "choice", "decision_id", "input_digest", "output_digest",
      "package_id", "package_version", "principal_id", "project_id", "quality_digest",
      "recorded_at", "run_id",
    ]);
    expect(recorded.approval).toBeNull();
    expect(bus.calls).toHaveLength(1);
  });

  it("describes a part with exactly the five declared fields", async () => {
    const bus = transport({
      "workbench.v1/review.part.describe": {
        format: "narralens.review-media-descriptor@1",
        project_id: "project-1",
        run_id: "run-1",
        package_id: "package-1",
        package_version: 2,
        package_digest: "6".repeat(64),
        part: PACKAGE.parts[0],
        receipt_digest: "7".repeat(64),
        object_id: "object-1",
        content_type: "video/mp4",
        bytes: 1024,
        sha256: "8".repeat(64),
        timeline: { fps: { num: 30, den: 1 }, frame_count: 900 },
        media_facts: { kind: "video", fps: { num: 30, den: 1 }, frame_count: 900 },
      },
    });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const descriptor = await client.describePart({
      run_id: "run-1",
      package_id: "package-1",
      package_version: 2,
      part_kind: "preview",
      artifact_ref: { id: "art-video", version: 1, sha256: "d".repeat(64) },
    });
    expect(descriptor.timeline.fps).toEqual({ num: 30, den: 1 });
    expect(Object.keys(bus.calls[0]!.input as Record<string, unknown>).sort()).toEqual([
      "artifact_ref", "package_id", "package_version", "part_kind", "run_id",
    ]);
    // The project is not part of the input: it comes from the delegate.
    expect(bus.calls[0]!.input).not.toHaveProperty("project_id");
  });

  it("reopens the native view with an exactly empty input", async () => {
    const bus = transport({ "workbench.v1/native.reopen": { format: "narralens.native-entry@1.0" } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await client.reopenNative();
    expect(bus.calls[0]!.surface).toBe("workbench.v1");
    expect(bus.calls[0]!.operation).toBe("native.reopen");
    expect(bus.calls[0]!.input).toEqual({});
  });

  it("registers a local asset with exactly the declaration", async () => {
    const bus = transport({ "local-assets.v1/local-assets.import": { asset_id: "asset_abc" } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await client.importLocalAsset({
      project_id: "project-1",
      candidate_id: "cand-1",
      source: { kind: "owned", label: "本机录音" },
      license: { status: "cleared", label: "仅限本项目", commercial_use: false },
      recording_origin: "麦克风",
    });
    const input = bus.calls[0]!.input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual([
      "candidate_id", "license", "project_id", "recording_origin", "source",
    ]);
    expect(input).not.toHaveProperty("relative_path");
    expect(input).not.toHaveProperty("expected_sha256");
    expect(input).not.toHaveProperty("attestation_ref");
  });

  it("refuses to register for another project", async () => {
    const bus = transport({});
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.importLocalAsset({
      project_id: "project-2",
      candidate_id: "cand-1",
      source: { kind: "owned", label: "本机录音" },
      license: { status: "cleared", label: "仅限本项目", commercial_use: false },
      recording_origin: "麦克风",
    })).rejects.toThrow("PROJECT_MISMATCH");
    expect(bus.calls).toHaveLength(0);
  });

  it("treats a missing producer as unknown, not as a failure and not as available", async () => {
    const bus = transport({});
    const client = new AgentWorkbenchClient(bus, "project-1");
    const failure = await client.readHealth().catch((reason: unknown) => reason);
    expect(isUnavailable(failure)).toBe(true);
    expect(isUnavailable(new Error("other"))).toBe(false);
    expect(unavailableReason(failure)).toContain("不可用");
  });
});
