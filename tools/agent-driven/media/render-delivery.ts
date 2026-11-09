import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { SnapshotRenderService } from "../../../src/host/render/render-snapshot.js";
import { NativeRenderer } from "../../../src/host/render/native-renderer.js";
import { PublishedPackageStore } from "../../../src/host/delivery/published-package-store.js";
import { computeRenderConfigDigest } from "../../../src/host/render/render-profile.js";
import { RENDER_PIN, verifyRenderPin } from "../../../src/host/render/upstream-pin.js";
import { buildHarnessClosure } from "./harness-closure.js";
import type {
  AttemptFencePort,
  DeliveryCommitPort,
  RenderBoundary,
  RenderBoundaryHooks,
} from "../../../src/host/render/ports.js";
import type { RenderSpec } from "../../../src/contracts/agent-driven-types.js";

/**
 * The render harness of the MEDIA lane.
 *
 * It runs the real pipeline — the pinned renderer, the real probe, the real full
 * decode, the real atomic publish — over a native project on disk, and prints what it
 * produced.
 *
 * What it is not: a production delivery. A production render reads its bytes through
 * MAIN's snapshot port, which is where the rights of every asset are checked and
 * where the committed snapshot is named. This harness builds a closure out of a
 * directory, which means it clears no rights and commits nothing: the record it prints
 * is what MAIN would have to record, not a record that exists.
 *
 * Usage:
 *   pnpm exec tsx tools/agent-driven/media/render-delivery.ts \
 *     --project <dir with film.html> --upstream <pinned openfilm checkout> \
 *     --delivery-root <isolated delivery directory> [--width 1920] [--height 1080] [--fps 30]
 *
 * Exit codes: 0 the render produced a package, 1 the render failed or was blocked,
 * 2 the arguments or the environment were wrong.
 */

interface Options {
  readonly project: string;
  readonly upstream: string;
  readonly delivery_root: string;
  readonly width: number;
  readonly height: number;
  readonly fps_numerator: number;
  readonly fps_denominator: number;
  readonly expected_frames: number | undefined;
  readonly expected_duration_seconds: number | undefined;
  readonly rights_manifest: string | undefined;
}

function usage(): never {
  process.stderr.write(
    "usage: render-delivery --project <dir> --upstream <dir> --delivery-root <dir> "
    + "[--width 1920] [--height 1080] [--fps 30] [--fps-denominator 1] [--rights-manifest <operator fixture manifest>]\n",
  );
  process.exit(2);
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined || !argument.startsWith("--")) usage();
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) usage();
    values.set(argument.slice(2), value);
    index += 1;
  }
  const project = values.get("project");
  const upstream = values.get("upstream");
  const deliveryRoot = values.get("delivery-root");
  if (project === undefined || upstream === undefined || deliveryRoot === undefined) usage();
  const width = Number(values.get("width") ?? "1920");
  const height = Number(values.get("height") ?? "1080");
  const fps = Number(values.get("fps") ?? "30");
  const fpsDenominator = Number(values.get("fps-denominator") ?? "1");
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !Number.isFinite(fps) || fps <= 0) usage();
  if (!Number.isSafeInteger(fpsDenominator) || fpsDenominator < 1) usage();
  // The frame count and the length of the film are facts about the committed native
  // document. A harness that reads a project off the disk does not have them, so it
  // has to be told; without them the preflight refuses the render, which is the right
  // answer rather than a guess.
  const expectedFrames = values.has("expected-frames") ? Number(values.get("expected-frames")) : undefined;
  const expectedDuration = values.has("expected-duration") ? Number(values.get("expected-duration")) : undefined;
  if (expectedFrames !== undefined && (!Number.isSafeInteger(expectedFrames) || expectedFrames < 1)) usage();
  if (expectedDuration !== undefined && (!Number.isFinite(expectedDuration) || expectedDuration <= 0)) usage();
  return {
    project: resolve(project),
    upstream: resolve(upstream),
    delivery_root: resolve(deliveryRoot),
    width,
    height,
    fps_numerator: fps,
    fps_denominator: fpsDenominator,
    expected_frames: expectedFrames,
    expected_duration_seconds: expectedDuration,
    rights_manifest: values.has("rights-manifest") ? resolve(values.get("rights-manifest")!) : undefined,
  };
}

/** A fence that lets the harness's single attempt through. */
const fence: AttemptFencePort = {
  async claimAttempt() { return true; },
  async checkAttempt() { return "proceed"; },
  async releaseAttempt() { /* nothing to release */ },
};

/** A diagnostic sink, never a database commit or an outbox publication. */
const commit: DeliveryCommitPort = {
  async commitReady() { /* Only the real Host may record ready_committed/events_published. */ },
};

const boundaries: RenderBoundary[] = [];
const hooks: RenderBoundaryHooks = {
  async onBoundary(boundary: RenderBoundary, _context: RenderBoundaryContext) {
    boundaries.push(boundary);
  },
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  const verdict = await verifyRenderPin(options.upstream);
  if (!verdict.ok) {
    // The exit code is set rather than the process being ended here: a pipe would lose
    // the last of the output if the process left while it was still being written.
    process.stdout.write(`${JSON.stringify({ status: "FAIL", stage: "pin", reason: verdict.reason }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const film = resolve(options.project, "film.html");
  if ((await stat(film).catch(() => null)) === null) {
    process.stdout.write(`${JSON.stringify({ status: "FAIL", stage: "project", reason: "the project has no film.html" }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const closure = await buildHarnessClosure(options.project, options);
  const spec: RenderSpec = {
    engine_id: "openfilm",
    engine_version: RENDER_PIN.upstream_sha,
    config_digest: computeRenderConfigDigest({
      render_spec: { engine_id: "openfilm", engine_version: RENDER_PIN.upstream_sha, config_digest: "0".repeat(64), width: options.width, height: options.height, fps_numerator: options.fps_numerator, fps_denominator: options.fps_denominator, container: "mp4", video_codec: "h264", audio_codec: "aac" },
      upstream_sha: RENDER_PIN.upstream_sha,
      worker_sha256: RENDER_PIN.worker_sha256,
    }),
    width: options.width,
    height: options.height,
    fps_numerator: options.fps_numerator,
    fps_denominator: options.fps_denominator,
    container: "mp4",
    video_codec: "h264",
    audio_codec: "aac",
  };

  const packages = new PublishedPackageStore({ root: options.delivery_root });
  const service = new SnapshotRenderService({
    snapshots: { async readSnapshot() { return closure; } },
    fence,
    commit,
    packages,
    native_renderer: new NativeRenderer({ upstream_root: options.upstream }),
    upstream_root: options.upstream,
    hooks,
  });

  const outcome = await service.render({
    project_id: closure.project_id,
    job_id: "harness",
    snapshot_id: closure.snapshot_id,
    source_digest: closure.source_digest,
    render_spec: spec,
    execution: {
      run_id: "harness",
      plan_version: 1,
      step_id: "delivery.package",
      attempt: 1,
      input_digest: closure.source_digest,
      run_scope_digest: "0".repeat(64),
      authorization_id: "harness",
    },
    attempt: 1,
    qc_dispositions: [],
    required_supplements: ["subtitles", "rights"],
    signal: undefined,
  });

  process.stdout.write(`${JSON.stringify({
    status: outcome.state === "ready" ? "MODULE_PACKAGE_CREATED" : outcome.state.toUpperCase(),
    production_ready: false,
    durable_commit: false,
    note: "module evidence only: this harness clears no rights and records nothing durably",
    boundaries,
    failure: outcome.failure,
    qc: outcome.qc_items.map((item) => ({ id: item.id, status: item.status, reason: item.reason })),
    manifest: outcome.manifest,
  }, null, 2)}\n`);

  process.exitCode = outcome.state === "ready" ? 0 : 1;
}

await main();
