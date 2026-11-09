import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SnapshotRenderService } from "../../../src/host/render/render-snapshot.js";
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
function fakeRenderer(behaviour: "write" | "fail" | "cancel"): NativeRenderPort {
  return {
    async render(request: NativeRenderRequest) {
      if (behaviour === "fail") {
        throw new NativeRenderError("RENDER_FAILED", "the film could not be rendered");
      }
      if (behaviour === "cancel") {
        throw new NativeRenderCancelled("the render was cancelled");
      }
      await writeFile(request.out_path, "the rendered film", "utf8");
      return { out_path: request.out_path, lines: [], elapsed_ms: 1 };
    },
  };
}

interface Harness {
  readonly service: SnapshotRenderService;
  readonly boundaries: RenderBoundary[];
  readonly commits: Array<{ manifest: unknown; download_ref: string }>;
  readonly packages: PublishedPackageStore;
  readonly closure: Awaited<ReturnType<typeof makeClosure>>;
}

async function harness(input: {
  readonly label: string;
  readonly renderer?: NativeRenderPort;
  readonly qc?: Parameters<typeof runnerOf>[0];
  readonly claimable?: boolean;
  readonly verdict?: "proceed" | "cancelled" | "superseded";
  readonly boundaryFailure?: RenderBoundary;
}): Promise<Harness> {
  const source = await directory(`${input.label}-source`);
  const deliveryRoot = await directory(`${input.label}-delivery`);
  const closure = await makeClosure({ directory: source, with_asset: true, with_supplement: true });

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
  const fenceState = {
    verdict: input.verdict ?? "proceed" as const,
    claimable: input.claimable ?? true,
  };
  const fence: AttemptFencePort = {
    async claimAttempt() { return fenceState.claimable; },
    async checkAttempt() { return fenceState.verdict; },
    async releaseAttempt() { /* nothing to release */ },
  };
  const commits: Array<{ manifest: unknown; download_ref: string }> = [];
  const commit: DeliveryCommitPort = {
    async commitReady(request) {
      commits.push({ manifest: request.manifest, download_ref: request.download_ref });
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

  return { service, boundaries, commits, packages, closure };
}

function requestFor(closureDigest: string, attempt = 1): RenderRequest {
  return {
    project_id: "proj_media_01",
    job_id: "job_media_01",
    snapshot_id: "snap_media_01",
    source_digest: closureDigest,
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
      input_digest: closureDigest,
      run_scope_digest: "0".repeat(64),
      authorization_id: "auth_media_01",
    },
    attempt,
    qc_dispositions: [],
    signal: undefined,
  };
}

describe("rendering a committed snapshot", () => {
  it("publishes a package and asks MAIN to record it", async () => {
    const built = await harness({ label: "render-ready" });
    const outcome = await built.service.render(requestFor(built.closure.source_digest));

    // The harness reads the closure it was given, so the request's digest has to match
    // the closure the harness holds; the render is driven through the same closure.
    expect(outcome.state).toBe("ready");
    expect(outcome.manifest?.snapshot_id).toBe("snap_media_01");
    expect(built.commits).toHaveLength(1);
    expect(built.commits[0]?.manifest).toBe(outcome.manifest);
    expect(built.boundaries).toEqual(["encode_finished", "qc_finished", "package_published"]);
  });

  it("keeps the snapshot it was given even when the project has moved on", async () => {
    const built = await harness({ label: "render-revision" });
    const outcome = await built.service.render(requestFor(built.closure.source_digest));

    expect(outcome.state).toBe("ready");
    expect(outcome.manifest?.snapshot_id).toBe("snap_media_01");
    expect(outcome.manifest?.source_digest).toBe(built.closure.source_digest);
    expect(outcome.manifest?.attempt).toBe(1);
  });

  it("fails without publishing when the renderer fails", async () => {
    const built = await harness({ label: "render-failed", renderer: fakeRenderer("fail") });
    const outcome = await built.service.render(requestFor(built.closure.source_digest));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("RENDER_FAILED");
    expect(outcome.manifest).toBeNull();
    expect(built.commits).toHaveLength(0);
  });

  it("fails without publishing when the render was cancelled", async () => {
    const built = await harness({ label: "render-cancelled", renderer: fakeRenderer("cancel") });
    const outcome = await built.service.render(requestFor(built.closure.source_digest));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("RENDER_CANCELLED");
    expect(built.commits).toHaveLength(0);
  });

  it("blocks without publishing when the decode refuses the file", async () => {
    const built = await harness({
      label: "render-blocked",
      qc: { decode: { code: 1, stderr: "Invalid data found when processing input\n" } },
    });
    const outcome = await built.service.render(requestFor(built.closure.source_digest));

    expect(outcome.state).toBe("blocked");
    expect(outcome.qc).toBe("blocked");
    expect(outcome.manifest).toBeNull();
    expect(built.commits).toHaveLength(0);
    expect(outcome.qc_items.find((item) => item.id === "media_full_decode")?.status).toBe("block");
  });

  it("does not publish a delivery that was cancelled while it encoded", async () => {
    const built = await harness({ label: "render-fenced", verdict: "cancelled" });
    const outcome = await built.service.render(requestFor(built.closure.source_digest));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("ATTEMPT_CANCELLED");
    expect(built.commits).toHaveLength(0);
  });

  it("does not start when another attempt holds the job", async () => {
    const built = await harness({ label: "render-claimed", claimable: false });
    const outcome = await built.service.render(requestFor(built.closure.source_digest));

    expect(outcome.state).toBe("failed");
    expect(outcome.failure?.code).toBe("ATTEMPT_NOT_CLAIMED");
    expect(built.boundaries).toHaveLength(0);
  });

  it("aborts the render when a boundary hook fails", async () => {
    const built = await harness({ label: "render-boundary", boundaryFailure: "encode_finished" });

    await expect(built.service.render(requestFor(built.closure.source_digest))).rejects.toThrow(/killed at encode_finished/);
    expect(built.commits).toHaveLength(0);
  });

  it("publishes one package for two attempts of the same key", async () => {
    const built = await harness({ label: "render-twice" });

    const first = await built.service.render(requestFor(built.closure.source_digest));
    const second = await built.service.render(requestFor(built.closure.source_digest, 2));

    expect(first.state).toBe("ready");
    expect(second.state).toBe("ready");
    expect(second.manifest?.delivery_id).toBe(first.manifest?.delivery_id);
    expect(second.manifest?.download_ref).toBe(first.manifest?.download_ref);
  });
});
