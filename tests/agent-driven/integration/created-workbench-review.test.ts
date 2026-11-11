import { describe, expect, it } from "vitest";
import {
  AgentWorkbenchClient,
  isUnavailable,
  readAssetInventory,
  readSourceFileListing,
  unavailableReason,
  type WorkbenchUiTransport,
} from "../../../src/app/agent-workbench-client.js";
import { GatewayApiError } from "../../../src/app/m5/GatewayApiClient.js";
import type { Context, ReviewPackage, Workflow } from "../../../src/contracts/agent-driven-types.js";

/**
 * The review consumer of the workbench.
 *
 * These cases are about the *client* half of the seam: which closed call each read and
 * each decision makes, what the client refuses to claim, and what it refuses to accept.
 * They mount no Host, bind no port and touch no media, so they are component evidence —
 * not a producer-consumer proof. The Host's own dispatcher and the real prepared media
 * are BRIDGE's and MEDIA's producers, and they are not here.
 *
 * The fixtures are the *reviewed* shapes: the frozen agent contract's own DTOs, and the
 * adjunct `asset-inventory@1` protocol with `items` in both listings. A fixture that
 * only satisfies an older guess — `candidates`, `files`, `assets`, a free-text
 * recording origin — is refused, and that refusal is the point.
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
    { kind: "preview", artifact_ref: { id: "art-video", version: 1, sha256: "d".repeat(64) }, download_ref: "object-video" },
    { kind: "narration", artifact_ref: { id: "art-audio", version: 1, sha256: "e".repeat(64) }, download_ref: "object-audio" },
    { kind: "subtitles", artifact_ref: { id: "art-subs", version: 1, sha256: "f".repeat(64) }, download_ref: "object-subs" },
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

const CONTEXT: Context = {
  project_id: "project-1",
  origin: "created",
  project_revision: 3,
  control_revision: 1,
  snapshot_id: "snapshot-3",
  source_digest: "9".repeat(64),
  workflow_revision: 4,
  selection_version: 2,
  current_selection: null,
  active_jobs: [],
  artifacts: [],
  capabilities: ["clip_prepare"],
  next_actions: ["review_package"],
  active_run: null,
  native_ack: null,
  native_sync: "unknown",
};

const WORKFLOW: Workflow = {
  project_id: "project-1",
  workflow_revision: 4,
  nodes: [
    {
      node_id: "sample",
      state: "waiting_user",
      reason: "waiting_for_decision",
      input_refs: [],
      output_refs: [],
      job_id: "job-7",
      attempt: 2,
      dependencies: [],
      allowed_actions: ["clip_prepare"],
    },
  ],
  next_actions: ["review_package"],
};

/**
 * A recorded decision.
 *
 * The frozen contract keeps the two apart: a pure `accept` carries no approval at all,
 * and only `accept_and_adopt` carries the Host's own approval fact.
 */
const DECISION_ACCEPT = {
  decision_id: "decision-1",
  project_id: "project-1",
  run_id: "run-1",
  package_id: "package-1",
  package_version: 2,
  input_digest: "a".repeat(64),
  output_digest: "b".repeat(64),
  quality_digest: "c".repeat(64),
  choice: "accept" as const,
  principal_id: "operator",
  channel: "trusted_ui" as const,
  recorded_at: "2026-11-11T00:00:00.000Z",
  approval: null,
};

const DECISION_ADOPT = {
  ...DECISION_ACCEPT,
  decision_id: "decision-2",
  choice: "accept_and_adopt" as const,
  approval: {
    approval_id: "approval-1",
    project_id: "project-1",
    impact_id: "impact-1",
    plan_sha256: "4".repeat(64),
    expires_at: "2026-11-12T00:00:00.000Z",
    state: "active" as const,
  },
};

/** The reviewed `SourceFileListing`: `items`, and a candidate named by `display_name`. */
const LISTING = {
  format: "narralens.local-source-files@1",
  project_id: "project-1",
  items: [
    {
      candidate_id: "cand-1",
      display_name: "麦克风录音 A",
      kind: "audio",
      bytes: 2048,
      expires_at: "2026-11-11T12:15:00.000Z",
    },
  ],
  cursor_next: null,
};

/** The reviewed `InventoryItem`. */
const INVENTORY_ITEM = {
  asset_id: "asset_abc123",
  sha256: "a".repeat(64),
  bytes: 2048,
  registration_digest: "b".repeat(64),
  media: {
    kind: "audio",
    media_type: "audio/wav",
    extension: "wav",
    duration_frames: 0,
    duration_ms: 1000,
    width: null,
    height: null,
    sample_rate: 48000,
    channels: 1,
    codec: "pcm_s16le",
  },
  rights_ref: { id: "rights-1", version: 1, sha256: "c".repeat(64) },
  source_label: "本机录音",
  license: { status: "cleared", label: "仅限本项目使用", commercial_use: false },
  recording_origin: "human_recording",
};

const INVENTORY = {
  format: "narralens.asset-inventory@1",
  project_id: "project-1",
  items: [INVENTORY_ITEM],
  cursor_next: null,
};

/** The reviewed `PreviewMediaDescriptorV1` (CR-R1-001 §8). */
const DESCRIPTOR = {
  format: "narralens.review-media-descriptor@1",
  project_id: "project-1",
  run_id: "run-1",
  package_id: "package-1",
  package_version: 2,
  package_digest: "6".repeat(64),
  part: PACKAGE.parts[0],
  receipt_digest: "7".repeat(64),
  object_id: "object-video",
  content_type: "video/mp4",
  bytes: 1024,
  sha256: "8".repeat(64),
  timeline: { fps: { num: 30, den: 1 }, frame_count: 900 },
  media_facts: { kind: "video", fps: { num: 30, den: 1 }, frame_count: 900 },
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
      "agent.v1/workflow.read": WORKFLOW,
      "agent.v1/context.read": CONTEXT,
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
    const bus = transport({ "agent.v1/context.read": { ...CONTEXT, project_id: "project-2" } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readContext()).rejects.toThrow("INVALID_CONTEXT");
  });

  it("refuses an answer that does not satisfy the frozen contract", async () => {
    const { native_sync: _dropped, ...incomplete } = CONTEXT;
    const bus = transport({ "agent.v1/context.read": incomplete });
    const client = new AgentWorkbenchClient(bus, "project-1");
    // The contract's own validator refuses it: the client does not cast it into shape.
    await expect(client.readContext()).rejects.toThrow("INVALID_CONTEXT");
  });

  it("refuses an answer that carries a field the contract does not know", async () => {
    const bus = transport({ "agent.v1/context.read": { ...CONTEXT, invented: true } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readContext()).rejects.toThrow("INVALID_CONTEXT");
  });

  it("refuses a workflow that does not satisfy the frozen contract", async () => {
    const bus = transport({ "agent.v1/workflow.read": { project_id: "project-1", nodes: [] } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readWorkflow()).rejects.toThrow("INVALID_WORKFLOW");
  });

  it("refuses a health answer that does not satisfy the frozen contract", async () => {
    const bus = transport({ "agent.v1/health.read": { services: [], sample_interval_ms: 9000, stale_after_ms: 15000 } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readHealth()).rejects.toThrow("INVALID_HEALTH");
  });

  it("reads the review package of the named run", async () => {
    const bus = transport({ "agent.v1/review.read": PACKAGE });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const document_ = await client.readReview("run-1", "package-1");
    expect(document_.package_id).toBe("package-1");
    expect(bus.calls[0]!.input).toEqual({ project_id: "project-1", run_id: "run-1", package_id: "package-1" });
  });

  it("refuses a review answer that names another package", async () => {
    const bus = transport({ "agent.v1/review.read": { ...PACKAGE, package_id: "package-2" } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readReview("run-1", "package-1")).rejects.toThrow("INVALID_REVIEW_PACKAGE");
  });

  it("refuses a review answer that names another run", async () => {
    const bus = transport({ "agent.v1/review.read": { ...PACKAGE, run_id: "run-2" } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readReview("run-1", "package-1")).rejects.toThrow("INVALID_REVIEW_PACKAGE");
  });

  it("records a decision with exactly the frozen input fields", async () => {
    const bus = transport({ "agent.v1/review.decide": DECISION_ADOPT });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const recorded = await client.decideReview({
      meta: { idempotency_key: "key-1", correlation_id: "corr-1" },
      package: PACKAGE,
      choice: "accept_and_adopt",
    });
    expect(recorded.decision_id).toBe("decision-2");
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

  it("never records a decision against another project, even when the package says so", async () => {
    const bus = transport({});
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.decideReview({
      meta: { idempotency_key: "key-1", correlation_id: "corr-1" },
      package: { ...PACKAGE, project_id: "project-2" },
      choice: "accept",
    })).rejects.toThrow("PROJECT_MISMATCH");
    expect(bus.calls).toHaveLength(0);
  });

  it("refuses a decision answer that belongs to another package or version", async () => {
    const otherPackage = transport({ "agent.v1/review.decide": { ...DECISION_ACCEPT, package_id: "package-2" } });
    await expect(new AgentWorkbenchClient(otherPackage, "project-1").decideReview({
      meta: { idempotency_key: "key-1", correlation_id: "corr-1" },
      package: PACKAGE,
      choice: "accept",
    })).rejects.toThrow("INVALID_REVIEW_DECISION");

    const otherVersion = transport({ "agent.v1/review.decide": { ...DECISION_ACCEPT, package_version: 7 } });
    await expect(new AgentWorkbenchClient(otherVersion, "project-1").decideReview({
      meta: { idempotency_key: "key-1", correlation_id: "corr-1" },
      package: PACKAGE,
      choice: "accept",
    })).rejects.toThrow("INVALID_REVIEW_DECISION");
  });

  it("does not turn a recorded decision into a commit or an acknowledgement", async () => {
    const bus = transport({ "agent.v1/review.decide": DECISION_ACCEPT });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const recorded = await client.decideReview({
      meta: { idempotency_key: "key-1", correlation_id: "corr-1" },
      package: PACKAGE,
      choice: "accept",
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
    const bus = transport({ "workbench.v1/review.part.describe": DESCRIPTOR });
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

  it("refuses a descriptor whose format matches but whose body does not", async () => {
    const cases: Array<[string, unknown]> = [
      ["missing the receipt digest", { ...DESCRIPTOR, receipt_digest: undefined }],
      ["a receipt digest that is not a digest", { ...DESCRIPTOR, receipt_digest: "nope" }],
      ["a package digest that is not a digest", { ...DESCRIPTOR, package_digest: "nope" }],
      ["a video fact without a frame rate", { ...DESCRIPTOR, media_facts: { kind: "video", frame_count: 900 } }],
      ["a video fact with a frame rate of zero", { ...DESCRIPTOR, media_facts: { kind: "video", fps: { num: 0, den: 1 }, frame_count: 900 } }],
      ["an unknown field", { ...DESCRIPTOR, invented: true }],
    ];
    for (const [name, answer] of cases) {
      const bus = transport({ "workbench.v1/review.part.describe": answer });
      const client = new AgentWorkbenchClient(bus, "project-1");
      await expect(client.describePart({
        run_id: "run-1",
        package_id: "package-1",
        package_version: 2,
        part_kind: "preview",
        artifact_ref: { id: "art-video", version: 1, sha256: "d".repeat(64) },
      }), name).rejects.toThrow("INVALID_MEDIA_DESCRIPTOR");
    }
  });

  it("reopens the native view with an exactly empty input", async () => {
    const bus = transport({ "workbench.v1/native.reopen": { format: "narralens.native-entry@1.0" } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await client.reopenNative();
    expect(bus.calls[0]!.surface).toBe("workbench.v1");
    expect(bus.calls[0]!.operation).toBe("native.reopen");
    expect(bus.calls[0]!.input).toEqual({});
  });

  it("registers a local asset with the declaration, its request key and its source address", async () => {
    const bus = transport({ "local-assets.v1/local-assets.import": INVENTORY_ITEM });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const item = await client.importLocalAsset({
      project_id: "project-1",
      candidate_id: "cand-1",
      source: { kind: "owned", label: "本机录音", uri: "file:///recordings/a.wav" },
      license: { status: "cleared", label: "仅限本项目", commercial_use: false },
      recording_origin: "human_recording",
    });
    expect(item.asset_id).toBe("asset_abc123");
    const input = bus.calls[0]!.input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual([
      "candidate_id", "license", "meta", "project_id", "recording_origin", "source",
    ]);
    expect(input.source).toEqual({ kind: "owned", label: "本机录音", uri: "file:///recordings/a.wav" });
    expect(input.recording_origin).toBe("human_recording");
    // The request key is there, and it is the Host's business what it means.
    expect((input.meta as { idempotency_key: string }).idempotency_key).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
    expect(input).not.toHaveProperty("relative_path");
    expect(input).not.toHaveProperty("expected_sha256");
    expect(input).not.toHaveProperty("attestation_ref");
  });

  it("keeps the same request key for the same declaration and a new one for a changed source", async () => {
    const bus = transport({ "local-assets.v1/local-assets.import": INVENTORY_ITEM });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const declaration = {
      project_id: "project-1",
      candidate_id: "cand-1",
      source: { kind: "owned" as const, label: "本机录音", uri: null },
      license: { status: "cleared" as const, label: "仅限本项目", commercial_use: false },
      recording_origin: "human_recording" as const,
    };
    await client.importLocalAsset(declaration);
    await client.importLocalAsset(declaration);
    const first = (bus.calls[0]!.input as { meta: { idempotency_key: string } }).meta.idempotency_key;
    const second = (bus.calls[1]!.input as { meta: { idempotency_key: string } }).meta.idempotency_key;
    expect(second).toBe(first);

    await client.importLocalAsset({ ...declaration, source: { kind: "owned", label: "本机录音", uri: "file:///other.wav" } });
    const third = (bus.calls[2]!.input as { meta: { idempotency_key: string } }).meta.idempotency_key;
    expect(third).not.toBe(first);
  });

  it("refuses a registration whose recording origin is not one of the reviewed values", async () => {
    const bus = transport({});
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.importLocalAsset({
      project_id: "project-1",
      candidate_id: "cand-1",
      source: { kind: "owned", label: "本机录音", uri: null },
      license: { status: "cleared", label: "仅限本项目", commercial_use: false },
      recording_origin: "麦克风" as never,
    })).rejects.toThrow("INVALID_RECORDING_ORIGIN");
    expect(bus.calls).toHaveLength(0);
  });

  it("refuses to register for another project", async () => {
    const bus = transport({});
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.importLocalAsset({
      project_id: "project-2",
      candidate_id: "cand-1",
      source: { kind: "owned", label: "本机录音", uri: null },
      license: { status: "cleared", label: "仅限本项目", commercial_use: false },
      recording_origin: null,
    })).rejects.toThrow("PROJECT_MISMATCH");
    expect(bus.calls).toHaveLength(0);
  });

  it("reads the controlled candidates in the reviewed listing shape", async () => {
    const bus = transport({ "local-assets.v1/local-source-files.read": LISTING });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const listing = await client.readLocalSourceFiles();
    expect(listing.candidates).toHaveLength(1);
    expect(listing.candidates[0]!.display_name).toBe("麦克风录音 A");
    expect(listing.candidates[0]!.kind).toBe("audio");
    expect(listing.cursor_next).toBeNull();
  });

  it("refuses a candidate listing in the old guessed shapes", async () => {
    for (const answer of [
      { ...LISTING, items: undefined, candidates: LISTING.items },
      { ...LISTING, items: undefined, files: LISTING.items },
      { ...LISTING, format: "narralens.local-source-files@1.0" },
    ]) {
      const bus = transport({ "local-assets.v1/local-source-files.read": answer });
      const client = new AgentWorkbenchClient(bus, "project-1");
      await expect(client.readLocalSourceFiles()).rejects.toThrow("INVALID_SOURCE_FILE_LISTING");
    }
  });

  it("reads the registered assets in the reviewed inventory shape", async () => {
    const bus = transport({ "local-assets.v1/local-assets.read.ui": INVENTORY });
    const client = new AgentWorkbenchClient(bus, "project-1");
    const inventory = await client.readLocalAssets();
    expect(inventory.items[0]!.source_label).toBe("本机录音");
    expect(inventory.items[0]!.license.label).toBe("仅限本项目使用");
    expect(inventory.items[0]!.recording_origin).toBe("human_recording");
  });

  it("refuses an inventory in the old guessed shape", async () => {
    const bus = transport({ "local-assets.v1/local-assets.read.ui": { ...INVENTORY, items: undefined, assets: INVENTORY.items } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readLocalAssets()).rejects.toThrow("INVALID_ASSET_INVENTORY");
  });

  it("reads the next page with exactly the approved read input", async () => {
    const bus = transport({
      "local-assets.v1/local-source-files.read": { ...LISTING, cursor_next: "cursor-2" },
      "local-assets.v1/local-assets.read.ui": INVENTORY,
    });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await client.readLocalSourceFiles({ cursor: "cursor-2" });
    // The approved input has three optional keys and no others: the project, the page
    // size and the cursor.
    expect(Object.keys(bus.calls[0]!.input as Record<string, unknown>).sort()).toEqual([
      "cursor", "project_id",
    ]);
    expect((bus.calls[0]!.input as { cursor: string }).cursor).toBe("cursor-2");
    // The first page carries no cursor at all.
    await client.readLocalAssets();
    expect(Object.keys(bus.calls[1]!.input as Record<string, unknown>).sort()).toEqual(["project_id"]);
    // A page size is only sent when one was asked for.
    await client.readLocalSourceFiles({ limit: 8 });
    expect(Object.keys(bus.calls[2]!.input as Record<string, unknown>).sort()).toEqual([
      "limit", "project_id",
    ]);
  });

  it("refuses a page size or a cursor that the approved input does not allow", async () => {
    const bus = transport({});
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readLocalSourceFiles({ limit: 0 })).rejects.toThrow("INVALID_PAGE_LIMIT");
    await expect(client.readLocalSourceFiles({ limit: 65 })).rejects.toThrow("INVALID_PAGE_LIMIT");
    await expect(client.readLocalSourceFiles({ cursor: 7 as never })).rejects.toThrow("INVALID_CURSOR");
    expect(bus.calls).toHaveLength(0);
  });

  it("refuses a listing of another project", async () => {
    const bus = transport({ "local-assets.v1/local-source-files.read": { ...LISTING, project_id: "project-2" } });
    const client = new AgentWorkbenchClient(bus, "project-1");
    await expect(client.readLocalSourceFiles()).rejects.toThrow("PROJECT_MISMATCH");
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

describe("the adjunct protocol readers on their own", () => {
  it("reads the cursor of a listing without pretending there is a second page", () => {
    const listing = readSourceFileListing({ ...LISTING, cursor_next: "cursor-2" });
    expect(listing.cursor_next).toBe("cursor-2");
  });

  it("refuses a listing that carries an unknown field", () => {
    expect(() => readSourceFileListing({ ...LISTING, extra: 1 })).toThrow("INVALID_SOURCE_FILE_LISTING");
  });

  it("refuses an inventory item whose recording origin is free text", () => {
    expect(() => readAssetInventory({
      ...INVENTORY,
      items: [{ ...INVENTORY_ITEM, recording_origin: "麦克风" }],
    })).toThrow("INVALID_ASSET_INVENTORY");
  });

  it("accepts a null recording origin, which is one of the reviewed values", () => {
    const inventory = readAssetInventory({ ...INVENTORY, items: [{ ...INVENTORY_ITEM, recording_origin: null }] });
    expect(inventory.items[0]!.recording_origin).toBeNull();
  });
});
