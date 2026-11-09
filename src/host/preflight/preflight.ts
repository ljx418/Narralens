import { statfs } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { OPENFILM_PIN } from "../../adapters/openfilm/openfilm-upstream.js";
import { computeRenderConfigDigest } from "../render/render-profile.js";
import { RENDER_PIN, verifyRenderPin, type RenderPinVerdict } from "../render/upstream-pin.js";
import { assertSafeRelativePath } from "../render/snapshot-copy.js";
import type { SnapshotClosure, SnapshotRightsFact } from "../render/ports.js";
import type { RenderSpec } from "../../contracts/agent-driven-types.js";

/**
 * The preflight.
 *
 * Everything that can be checked before a single frame is drawn is checked before a
 * single frame is drawn. The reasons are practical rather than philosophical: an encode
 * that fails after twenty minutes because the licence of one clip was not cleared has
 * wasted twenty minutes, and a delivery that is published with a licence that was never
 * checked is worse than one that was never published.
 *
 * A finding is a fact with a status, not a verdict on the film:
 *
 * - `pass` — checked and true.
 * - `warn` — true, but something about it needs a person's attention later.
 * - `block` — false, or unknowable in a way that must not be guessed at.
 *
 * The preflight never throws for a media fact. It returns the findings, and the caller
 * decides what to do with a block.
 */

/** One checked fact. */
export interface PreflightFinding {
  /** A stable, dotless identifier. It appears in the delivery's QC items. */
  readonly id: string;
  readonly status: "pass" | "warn" | "block";
  readonly reason: string;
}

/** The result of the preflight. */
export interface PreflightReport {
  /** True when nothing blocked. A warn does not block. */
  readonly ok: boolean;
  readonly findings: readonly PreflightFinding[];
  /** The findings that blocked, for a failure reason that says what stopped it. */
  readonly blocking: readonly PreflightFinding[];
}

/** What the preflight is given. */
export interface PreflightInput {
  readonly closure: SnapshotClosure;
  readonly render_spec: RenderSpec;
  /** The project the render was asked for. */
  readonly project_id: string;
  /** The snapshot the render was asked for. */
  readonly snapshot_id: string;
  /** The digest the caller believes the snapshot has. */
  readonly expected_source_digest: string;
  /** The pinned OpenFilm checkout the render would use. */
  readonly upstream_root: string;
  /** The directory staging directories are created in. */
  readonly staging_parent: string;
  /**
   * How the pinned upstream is checked.
   *
   * The seam exists so that the *rest* of the preflight can be exercised without the
   * pinned checkout being present on the machine. The default is the real check, and
   * the real check is what production uses.
   */
  readonly pin_verifier?: (upstream_root: string) => Promise<RenderPinVerdict>;
}

/** The free space below which a render is flagged. */
export const LOW_FREE_BYTES = 2 * 1024 * 1024 * 1024;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * The engine version has to name something this Host can pin.
 *
 * Two forms are accepted: the pinned package version, and the pinned commit. A version
 * that names neither cannot be checked against anything, and a delivery that says it
 * was rendered by an engine nobody can name is not a delivery that can be reproduced.
 */
export function isAcceptableEngineVersion(engineVersion: string): boolean {
  if (engineVersion === OPENFILM_PIN.package) return true;
  if (engineVersion === RENDER_PIN.upstream_sha) return true;
  return false;
}

/**
 * Run every check that does not need a frame.
 *
 * The checks run in a fixed order, from the cheapest and most fundamental (is this the
 * snapshot that was asked for?) to the most expensive (is the pinned upstream intact?),
 * so that the report names the first real problem rather than the last one found.
 */
export async function runPreflight(input: PreflightInput): Promise<PreflightReport> {
  const findings: PreflightFinding[] = [];
  const closure = input.closure;

  // 1. The snapshot is the one that was asked for.
  const identityProblems: string[] = [];
  if (closure.project_id !== input.project_id) {
    identityProblems.push("the closure belongs to another project");
  }
  if (closure.snapshot_id !== input.snapshot_id) {
    identityProblems.push("the closure is another snapshot");
  }
  if (closure.source_digest !== input.expected_source_digest) {
    identityProblems.push("the snapshot's source digest is not the one that was asked for");
  }
  if (!SHA256_PATTERN.test(closure.source_digest)) {
    identityProblems.push("the snapshot's source digest is not a sha256");
  }
  findings.push({
    id: "snapshot_identity",
    status: identityProblems.length === 0 ? "pass" : "block",
    reason: identityProblems.length === 0
      ? `the closure is snapshot ${closure.snapshot_id} at revision ${closure.project_revision}`
      : identityProblems.join("; "),
  });

  // 2. The closure is usable: real paths, safe relative paths, digests that look like digests.
  const closureProblems: string[] = [];
  if (closure.entries.length === 0) closureProblems.push("the closure has no files");
  for (const entry of closure.entries) {
    try {
      assertSafeRelativePath(entry.relative_path);
    } catch (error) {
      closureProblems.push(String((error as Error).message));
      continue;
    }
    if (!SHA256_PATTERN.test(entry.sha256)) {
      closureProblems.push(`an entry's digest is not a sha256: ${entry.relative_path}`);
    }
    if (!isAbsolute(entry.absolute_path)) {
      closureProblems.push(`an entry's path is not absolute: ${entry.relative_path}`);
    }
  }
  findings.push({
    id: "inputs_local",
    status: closureProblems.length === 0 ? "pass" : "block",
    reason: closureProblems.length === 0
      ? `${closure.entries.length} local file(s) with recorded digests`
      : closureProblems.join("; "),
  });

  // 3. Rights. A clip whose licence does not cover this use must not be rendered.
  const rightsProblems: string[] = [];
  // A fact is reachable by its asset id and by its reference, because an entry names
  // whichever of the two the snapshot recorded.
  const rightsByKey = new Map<string, SnapshotRightsFact>();
  for (const fact of closure.rights) {
    rightsByKey.set(fact.asset_id, fact);
    if (fact.ref !== null) rightsByKey.set(fact.ref, fact);
  }
  const assetEntries = closure.entries.filter((entry) => entry.kind === "asset");
  for (const entry of assetEntries) {
    const fact = entry.rights_ref === null ? undefined : rightsByKey.get(entry.rights_ref);
    if (fact === undefined) {
      rightsProblems.push(`no rights fact covers ${entry.relative_path}`);
      continue;
    }
    if (fact.status !== "cleared") {
      rightsProblems.push(`the rights of ${entry.relative_path} are ${fact.status}, not cleared`);
      continue;
    }
    if (!fact.commercial_use) {
      rightsProblems.push(`the rights of ${entry.relative_path} do not permit this use`);
    }
  }
  findings.push({
    id: "inputs_rights",
    status: rightsProblems.length === 0 ? "pass" : "block",
    reason: rightsProblems.length === 0
      ? `${assetEntries.length} asset(s) are cleared for this use`
      : rightsProblems.join("; "),
  });

  // 4. The render spec says something this Host can actually do.
  const specProblems: string[] = [];
  const spec = input.render_spec;
  if (spec.engine_id !== "openfilm") specProblems.push(`the engine ${spec.engine_id} is not the pinned one`);
  if (!isAcceptableEngineVersion(spec.engine_version)) {
    specProblems.push(`the engine version ${spec.engine_version} names nothing this Host can pin`);
  }
  if (spec.container !== "mp4") specProblems.push(`the container ${spec.container} is not mp4`);
  if (spec.video_codec !== "h264") specProblems.push(`the video codec ${spec.video_codec} is not h264`);
  if (spec.audio_codec !== "aac") specProblems.push(`the audio codec ${spec.audio_codec} is not aac`);
  if (!Number.isSafeInteger(spec.width) || spec.width < 1) specProblems.push("the width is not a whole number of pixels");
  if (!Number.isSafeInteger(spec.height) || spec.height < 1) specProblems.push("the height is not a whole number of pixels");
  if (!Number.isSafeInteger(spec.fps_numerator) || spec.fps_numerator < 1) specProblems.push("the frame rate's numerator is not a positive whole number");
  if (!Number.isSafeInteger(spec.fps_denominator) || spec.fps_denominator < 1) specProblems.push("the frame rate's denominator is not a positive whole number");
  findings.push({
    id: "render_spec",
    status: specProblems.length === 0 ? "pass" : "block",
    reason: specProblems.length === 0
      ? `${spec.width}x${spec.height} at ${spec.fps_numerator}/${spec.fps_denominator} fps, ${spec.container}/${spec.video_codec}/${spec.audio_codec}`
      : specProblems.join("; "),
  });

  // 5. The configuration digest names the configuration that will be used.
  const expectedDigest = computeRenderConfigDigest({
    render_spec: spec,
    upstream_sha: RENDER_PIN.upstream_sha,
    worker_sha256: RENDER_PIN.worker_sha256,
  });
  findings.push({
    id: "render_config",
    status: spec.config_digest === expectedDigest ? "pass" : "block",
    reason: spec.config_digest === expectedDigest
      ? "the configuration digest names this renderer, this upstream and these options"
      : "the configuration digest does not name the renderer, the upstream and the options this render would use",
  });

  // 6. The pinned upstream is intact.
  const verdict = await (input.pin_verifier ?? verifyRenderPin)(input.upstream_root);
  findings.push({
    id: "upstream_pin",
    status: verdict.ok ? "pass" : "block",
    reason: verdict.ok
      ? `the pinned upstream ${verdict.expected_sha} and the worker match their digests`
      : verdict.reason,
  });

  // 7. There is room to write. A full disk is found here rather than after the encode.
  let spaceStatus: "pass" | "warn" | "block" = "pass";
  let spaceReason = "the staging area has room";
  try {
    const stats = await statfs(input.staging_parent);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (free <= 0) {
      spaceStatus = "block";
      spaceReason = "the staging area has no free space";
    } else if (free < LOW_FREE_BYTES) {
      spaceStatus = "warn";
      spaceReason = `the staging area has ${Math.round(free / (1024 * 1024))} MiB free`;
    }
  } catch (error) {
    spaceStatus = "block";
    spaceReason = `the staging area could not be measured: ${String((error as Error).message)}`;
  }
  findings.push({ id: "output_space", status: spaceStatus, reason: spaceReason });

  const blocking = findings.filter((finding) => finding.status === "block");
  return { ok: blocking.length === 0, findings, blocking };
}
