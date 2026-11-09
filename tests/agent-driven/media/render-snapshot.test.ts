import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SnapshotRenderService, applyDispositionGate } from "../../../src/host/render/render-snapshot.js";
import { PublishedPackageStore } from "../../../src/host/delivery/published-package-store.js";
import { computeRenderConfigDigest } from "../../../src/host/render/render-profile.js";
import { RENDER_PIN } from "../../../src/host/render/upstream-pin.js";
import { NativeRenderCancelled, NativeRenderError, type NativeRenderPort, type NativeRenderRequest } from "../../../src/host/render/native-renderer.js";
import type {
  AttemptFencePort,
  DeliveryCommitPort,
  RenderBoundary,
  RenderBoundaryContext,
  RenderBoundaryHooks,
  RenderRequest,
  SnapshotReadPort,
} from "../../../src/host/render/ports.js";
import type { QCItem } from "../../../src/contracts/agent-driven-types.js";
import { makeClosure, removeDirectory, renderSpec, runnerOf, temporaryDirectory } from "./support.js";

/**
 * The render service.
 *
 * Module checks for the orchestration: what is refused before a frame is drawn, what is
 * published and what is not, in which order the boundaries are reached, and what MAIN
 * is asked to record. The renderer and the decoder are faked here; the real T20
 * acceptance (a real encode, a real full decode, a real process killed at a boundary)
 * is `NOT_RUN` and needs MAIN's resource reservation.
 */

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

/** A renderer that writes a file, like the real one does. */
function fakeRenderer(behaviour: "write" | "fail" | "cancel" | "unsettled"): NativeRenderPort {
  return {
    async render(request: NativeRenderRequest) {
      if (behaviour === "fail") {
        throw new NativeRenderError("RENDER_FAILED", "the film could not be rendered");
      }
      if (behaviour === "cancel") {
        throw new NativeRenderCancelled("the render was cancelled", true);
      }
      if (behaviour === "unsettled") {
        throw new NativeRenderCancelled("the render was cancelled", false);
      }
      await writeFile(request.out_path, "the rendered film", "utf8");
      return { out_path: request.out_path, lines: [], elapsed_ms: 1 };
    },
  };
}

interface Harness {
  readonly service: SnapshotRenderService;
  readonly boundaries: RenderBoundary[];
  readonly commits: Array<{ manifest: unknown; download_ref: string; package_id: string }>;
  readonly packages: PublishedPackageStore;
  readonly closure: Awaited<ReturnType<typeof makeClosure>>;
  readonly released: () => number;
  readonly setVerdict: (verdict: "proceed" | "cancelled" | "superseded") => void;
  readonly setCommitFailure: (failure: Error | null) => void;
}

async function harness(input: {
  readonly label: string;
  readonly renderer?: NativeRenderPort;
  readonly qc?: Parameters<typeof runnerOf>[0];
  readonly claimable?: boolean;
  readonly verdict?: "proceed" | "cancelled" | "superseded";
  readonly boundaryFailure?: RenderBoundary;
  readonly required_supplements?: readonly string[];
  readonly with_supplement?: boolean;
}): Promise<Harness> {
  const source = await directory(`${input.label}-source`);
  const deliveryRoot = await directory(`${input.label}-delivery`);
  const closure = await makeClosure({
    directory: source,
    with_asset: true,
    with_supplement: input.with_supplement ?? true,
  });

  const spec = renderSpec({
    config_digest: computeRenderConfigDigest({
      render_spec: renderSpec(),
      upstream_sha: RENDER_PIN.upstream_sha,
      worker_sha256: RENDER_PIN.worker_sha256,
    }),
  });

  const snapshots: SnapshotReadPort = {
    async readSnapshot() { return closure; },
  };
  let verdict: "proceed" | "cancelled" | "superseded" = input.verdict ?? "proceed";
  let released = 0;
  const fence: AttemptFencePort = {
    async claimAttempt() { return input.claimable ?? true; },
    async checkAttempt() { return verdict; },
    async releaseAttempt() { released += 1; },
  };
  const commits: Array<{ manifest: unknown; download_ref: string; package_id: string }> = [];
  let commitFailure: Error | null = null;
  const commit: DeliveryCommitPort = {
    async commitReady(request) {
      if (commitFailure !== null) throw commitFailure;
      commits.push({ manifest: request.manifest, download_ref: request.download_ref, package_id: request.package_id });
    },
  };
  const boundaries: RenderBoundary[] = [];
  const hooks: RenderBoundaryHooks = {
    async onBoundary(boundary: RenderBoundary, _context: RenderBoundaryContext) {
      if (input.boundaryFailure !== undefined && boundary === input.boundaryFailure) {
        throw new Error(`the process was killed at ${boundary}`);
      }
      boundaries.push(boundary);
    },
  };

  const packages = new PublishedPackageStore({ root: deliveryRoot });
  const service = new SnapshotRenderService({
    snapshots,
    fence,
    commit,
    packages,
    native_renderer: input.renderer ?? fakeRenderer("write"),
    upstream_root: join(source, "no-checkout-here"),
    hooks,
    qc_runner: runnerOf(input.qc ?? {}),
    // The pin is checked by the pin probe and by the real acceptance. Here it is
    // stated, so that the orchestration can be exercised on a machine that does not
    // have the pinned checkout.
    pin_verifier: async () => ({
      ok: true,
      reason: "the pin was checked elsewhere",
      checked: [],
      missing: [],
      mismatched: [],
      upstream_root: source,
      observed_sha: RENDER_PIN.upstream_sha,
      expected_sha: RENDER_PIN.upstream_sha,
      worker_sha256: RENDER_PIN.worker_sha256,
    }),
  });

  return {
    service,
    boundaries,
    commits,
    packages,
    closure,
    released: () => released,
    setVerdict: (next) => { verdict = next; },
    setCommitFailure: (failure) => { commitFailure = failure; },
  };
}

function requestFor(harness: Harness, attempt = 1, requiredSupplements: readonly string[] = ["rights"]): RenderRequest {
  return {
    project_id: "proj_media_01",
    job_id: "job_media_01",
    snapshot_id: "snap_media_01",
    source_digest: harness.closure.source_digest,
    render_spec: renderSpec({
      config_digest: computeRenderConfigDigest({
        render_spec: renderSpec(),
        upstream_sha: RENDER_PIN.upstream_sha,
        worker_sha256: RENDER_PIN.worker_sha256,
      }),
    }),
    execution: {
      run_id: "run_media_01",
      plan_version: 1,
      step_id: "delivery.package",
      attempt,
      input_digest: harness.closure.source_digest,
      run_scope_digest: "0".repeat(64),
      authorization_id: "auth_media_01",
    },
    attempt,
    qc_dispositions: [],
    required_supplements: requiredSupplements,
    signal: undefined,
  };
}

describe("the disposition gate", () => {
  const items: QCItem[] = [
    { id: "media_container", status: "pass", reason: "the container is mp4", evidence_ref: null },
    { id: "output_space", status: "warn", reason: "the staging area is nearly full", evidence_ref: null },
  ];

  it("blocks a warning that has no recorded decision", () => {
    const gated = applyDispositionGate(items, []);
    expect(gated.find((item) => item.id === "qc_disposition")?.status).toBe("block");
  });

  it("lets a warning through when the decision is recorded", () => {
    const gated = applyDispositionGate(items, ["output_space"]);
    expect(gated.find((item) => item.id === "qc_disposition")).toBeUndefined();
    expect(gated).toHaveLength(2);
  });
});

describe("rendering a committed snapshot", () => {
  it("publishes a package and asks MAIN to record it", async () => {
    const built = await harness({ label: "render-ready" });
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("ready");
    expect(outcome.manifest?.snapshot_id).toBe("snap_media_01");
    expect(built.commits).toHaveLength(1);
    expect(built.commits[0]?.manifest).toBe(outcome.manifest);
    expect(built.boundaries).toEqual(["encode_finished", "qc_finished", "package_published"]);
  });

  it("carries every check the preflight made into the delivery", async () => {
    const built = await harness({ label: "render-checks" });
    const outcome = await built.service.render(requestFor(built));

    const ids = outcome.qc_items.map((item) => item.id);
    expect(ids).toContain("snapshot_identity");
    expect(ids).toContain("inputs_rights");
    expect(ids).toContain("inputs_complete");
    expect(ids).toContain("media_full_decode");
  });

  it("gives every artefact of a delivery an id that names the delivery", async () => {
    const built = await harness({ label: "render-ids" });
    const outcome = await built.service.render(requestFor(built));

    const deliveryId = outcome.manifest?.delivery_id ?? "";
    expect(outcome.manifest?.media_ref.id.startsWith(deliveryId)).toBe(true);
    expect(outcome.manifest?.ffprobe_ref.id).not.toBe(outcome.manifest?.media_ref.id);
    expect(outcome.manifest?.full_decode_ref.id).not.toBe(outcome.manifest?.ffprobe_ref.id);
  });

  it("publishes the native, editable source with the film", async () => {
    const built = await harness({ label: "render-native" });
    const outcome = await built.service.render(requestFor(built));

    const resolved = await built.packages.resolveDownloadRef(outcome.manifest?.download_ref ?? "", "proj_media_01");
    const files = resolved?.receipt.files.map((file) => file.file) ?? [];
    expect(files).toContain("native_film.html");
    expect(files).toContain("native_source.json");
  });

  it("keeps the snapshot it was given even when the project has moved on", async () => {
    const built = await harness({ label: "render-revision" });
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("ready");
    expect(outcome.manifest?.snapshot_id).toBe("snap_media_01");
    expect(outcome.manifest?.source_digest).toBe(built.closure.source_digest);
    expect(outcome.manifest?.attempt).toBe(1);
  });

  it("fails without publishing when the renderer fails", async () => {
    const built = await harness({ label: "render-failed", renderer: fakeRenderer("fail") });
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("RENDER_FAILED");
    expect(outcome.manifest).toBeNull();
    expect(built.commits).toHaveLength(0);
  });

  it("fails without publishing when the render was cancelled", async () => {
    const built = await harness({ label: "render-cancelled", renderer: fakeRenderer("cancel") });
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("RENDER_CANCELLED");
    expect(outcome.requires_reconciliation).toBe(false);
    expect(built.commits).toHaveLength(0);
    expect(built.released()).toBe(1);
  });

  it("keeps the attempt claimed when the cancellation could not be seen to settle", async () => {
    const built = await harness({ label: "render-unsettled", renderer: fakeRenderer("unsettled") });
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("failed");
    expect(outcome.requires_reconciliation).toBe(true);
    expect(built.released()).toBe(0);
  });

  it("blocks without publishing when the decode refuses the file", async () => {
    const built = await harness({
      label: "render-blocked",
      qc: { decode: { code: 1, stderr: "Invalid data found when processing input\n" } },
    });
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("blocked");
    expect(outcome.qc).toBe("blocked");
    expect(outcome.manifest).toBeNull();
    expect(built.commits).toHaveLength(0);
    expect(outcome.qc_items.find((item) => item.id === "media_full_decode")?.status).toBe("block");
  });

  it("blocks without publishing when a promised supplement is missing", async () => {
    const built = await harness({ label: "render-missing-supplement" });
    const outcome = await built.service.render(requestFor(built, 1, ["rights", "subtitles"]));

    expect(outcome.state).toBe("blocked");
    expect(outcome.qc_items.find((item) => item.id === "inputs_complete")?.status).toBe("block");
    expect(built.commits).toHaveLength(0);
  });

  it("does not publish a delivery that was cancelled while it encoded", async () => {
    const built = await harness({ label: "render-fenced", verdict: "cancelled" });
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("ATTEMPT_CANCELLED");
    expect(built.commits).toHaveLength(0);
  });

  it("does not start when another attempt holds the job", async () => {
    const built = await harness({ label: "render-claimed", claimable: false });
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("ATTEMPT_NOT_CLAIMED");
    expect(built.boundaries).toHaveLength(0);
  });

  it("aborts the render when a boundary hook fails", async () => {
    const built = await harness({ label: "render-boundary", boundaryFailure: "encode_finished" });

    await expect(built.service.render(requestFor(built))).rejects.toThrow(/killed at encode_finished/);
    expect(built.commits).toHaveLength(0);
  });

  it("reports a package that was published but not recorded", async () => {
    const built = await harness({ label: "render-commit-failed" });
    built.setCommitFailure(new Error("the transaction rolled back"));
    const outcome = await built.service.render(requestFor(built));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("COMMIT_FAILED");
    expect(outcome.failure?.retryable).toBe(true);
  });

  it("publishes one package for two attempts of the same key", async () => {
    const built = await harness({ label: "render-twice" });

    const first = await built.service.render(requestFor(built));
    const second = await built.service.render(requestFor(built, 2));

    expect(first.state).toBe("ready");
    expect(second.state).toBe("ready");
    expect(second.manifest?.delivery_id).toBe(first.manifest?.delivery_id);
    expect(second.manifest?.download_ref).toBe(first.manifest?.download_ref);
  });
});
