import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaToolRunner, ToolResult } from "../../../src/host/delivery/qc.js";
import type { RenderSpec } from "../../../src/contracts/agent-driven-types.js";
import type { SnapshotClosure, SnapshotEntry, SnapshotRightsFact } from "../../../src/host/render/ports.js";

/**
 * The shared helpers of the MEDIA lane's module tests.
 *
 * These tests are module checks: they exercise the production modules against fakes
 * for the things that are expensive or impossible to fake honestly — the renderer, the
 * decoder, MAIN's ports. They prove that the *boundaries* behave; they do not prove
 * that a real film encodes. The real T20-A..H acceptance (a real encoder, a real disk
 * that fills up, a real process that is killed at a boundary) is `NOT_RUN` and needs
 * MAIN's resource reservation.
 */

/** A temporary directory that the caller removes. */
export async function temporaryDirectory(label: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `narralens-${label}-`));
}

/** Remove a temporary directory. */
export async function removeDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

export function sha256Of(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The probe output of a film that is exactly what the spec asks for. */
export const GOOD_PROBE = JSON.stringify({
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000" },
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      avg_frame_rate: "30/1",
      r_frame_rate: "30/1",
      nb_read_frames: "60",
    },
    {
      codec_type: "audio",
      codec_name: "aac",
      avg_frame_rate: "0/0",
      r_frame_rate: "0/0",
      nb_read_frames: "",
    },
  ],
});

/** A tool runner that answers with what it was told to answer. */
export function runnerOf(results: {
  readonly probe?: Partial<ToolResult>;
  readonly decode?: Partial<ToolResult>;
}): MediaToolRunner {
  return {
    async run(tool) {
      const canned = tool === "ffprobe" ? results.probe : results.decode;
      return {
        code: canned?.code === undefined ? 0 : canned.code,
        signal: canned?.signal ?? null,
        stdout: canned?.stdout ?? (tool === "ffprobe" ? GOOD_PROBE : ""),
        stderr: canned?.stderr ?? "",
        group_settled: canned?.group_settled ?? true,
      };
    },
  };
}

/** A tool runner that fails the way a full disk fails. */
export function failingRunner(reason: string): MediaToolRunner {
  return {
    async run(tool) {
      if (tool === "ffprobe") {
        return { code: 0, signal: null, stdout: GOOD_PROBE, stderr: "" };
      }
      return { code: 1, signal: null, stdout: "", stderr: `${reason}\n` };
    },
  };
}

/** The render spec the tests use. */
export function renderSpec(overrides: Partial<RenderSpec> = {}): RenderSpec {
  return {
    engine_id: "openfilm",
    engine_version: "openfilm@0.1.7",
    config_digest: "0".repeat(64),
    width: 1920,
    height: 1080,
    fps_numerator: 30,
    fps_denominator: 1,
    container: "mp4",
    video_codec: "h264",
    audio_codec: "aac",
    ...overrides,
  };
}

/** The roles the tests promise in a package. */
export const RIGHTS_ROLE = "rights";
export const SUBTITLES_ROLE = "subtitles";

/** A closure with a film, an asset and a supplement, written to disk. */
export async function makeClosure(input: {
  readonly directory: string;
  readonly project_id?: string;
  readonly snapshot_id?: string;
  readonly with_asset?: boolean;
  readonly with_supplement?: boolean;
  readonly supplement_role?: string;
  readonly rights?: SnapshotRightsFact[];
  readonly source_digest?: string;
  readonly expected_frames?: number;
  readonly expected_duration_seconds?: number;
}): Promise<SnapshotClosure> {
  const projectId = input.project_id ?? "proj_media_01";
  const snapshotId = input.snapshot_id ?? "snap_media_01";
  const entries: SnapshotEntry[] = [];

  const filmText = "<!doctype html>\n<html><head><meta name=\"viewport\" content=\"width=1920, height=1080\"></head><body></body></html>\n";
  const filmPath = join(input.directory, "film.html");
  await writeFile(filmPath, filmText, "utf8");
  entries.push({
    relative_path: "film.html",
    absolute_path: filmPath,
    sha256: sha256Of(filmText),
    bytes: Buffer.byteLength(filmText),
    kind: "native_source",
    rights_ref: null,
    role: null,
  });

  if (input.with_asset === true) {
    const assetText = "asset bytes";
    const assetPath = join(input.directory, "clip.mp4");
    await writeFile(assetPath, assetText, "utf8");
    entries.push({
      relative_path: "clip.mp4",
      absolute_path: assetPath,
      sha256: sha256Of(assetText),
      bytes: Buffer.byteLength(assetText),
      kind: "asset",
      rights_ref: "rights_01",
      role: null,
    });
  }

  if (input.with_supplement === true) {
    // The roles A promises: the licence and the subtitles. A delivery that is missing
    // either of them is blocked, so the tests' good case carries both.
    const licenceText = "licence text";
    const licencePath = join(input.directory, "rights.txt");
    await writeFile(licencePath, licenceText, "utf8");
    entries.push({
      relative_path: "rights.txt",
      absolute_path: licencePath,
      sha256: sha256Of(licenceText),
      bytes: Buffer.byteLength(licenceText),
      kind: "supplement",
      rights_ref: "rights_01",
      role: input.supplement_role ?? RIGHTS_ROLE,
    });

    const subtitleText = "1\n00:00:00,000 --> 00:00:02,000\nhello\n";
    const subtitlePath = join(input.directory, "subtitles.vtt");
    await writeFile(subtitlePath, subtitleText, "utf8");
    entries.push({
      relative_path: "subtitles.vtt",
      absolute_path: subtitlePath,
      sha256: sha256Of(subtitleText),
      bytes: Buffer.byteLength(subtitleText),
      kind: "supplement",
      rights_ref: "rights_01",
      role: SUBTITLES_ROLE,
    });
  }

  return {
    project_id: projectId,
    snapshot_id: snapshotId,
    source_digest: input.source_digest ?? "a".repeat(64),
    project_revision: 7,
    expected_frames: input.expected_frames ?? 60,
    expected_duration_seconds: input.expected_duration_seconds ?? 2,
    native_root: input.directory,
    native_entry: "film.html",
    entries,
    rights: input.rights ?? [
      { asset_id: "clip.mp4", status: "cleared", commercial_use: true, ref: "rights_01" },
    ],
  };
}
