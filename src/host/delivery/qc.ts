import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { QCItem, Ref, RenderSpec } from "../../contracts/agent-driven-types.js";
import { PACKAGE_ROLES, packageRefId } from "./package-layout.js";

/**
 * The quality control of a rendered film.
 *
 * Four things have to be true before a delivery may exist, and all four are checked
 * against the bytes themselves rather than against what the renderer reported:
 *
 * 1. The container really is the container the spec named, with the codecs, the size and
 *    the frame rate the spec named, and with exactly the streams the spec named. A
 *    renderer that wrote something else — or a file that was truncated after it was
 *    written — is caught here.
 * 2. The whole file decodes. Not the first ten seconds: every frame, every stream. A
 *    file whose header is intact and whose tail is garbage passes a probe and fails a
 *    decode, and a delivery that only passes the probe is a delivery nobody watched.
 * 3. The film is as long as the immutable native document says it is. A file that
 *    decodes and holds fewer frames than the film has is a shortened film, and a
 *    shortened film that nobody asked for is not a delivery.
 * 4. Every supplement is the file it claims to be, and every supplement that was
 *    promised is there. A package whose licence file was swapped for another project's
 *    is not the package that was cleared, and a package without the promised
 *    subtitles is not the delivery that was promised.
 *
 * A failing check is a `block`, never a silent pass. `warn` exists for facts a person
 * has to act on, and `not_applicable` for checks that genuinely do not apply — with a
 * reason, because "not applicable" without a reason is how a skipped check becomes an
 * invisible one.
 */

/** The result of running one media tool. */
export interface ToolResult {
  /** The exit code, or null when the process was killed by a signal. */
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * How a media tool is run.
 *
 * The interface exists so the checks can be exercised without a real encoder: the
 * failure modes that matter (a nonzero exit, a truncated file, an error line) are
 * produced by the tool, and a stub that returns "fine" would prove nothing. The default
 * implementation runs the real tools.
 */
export interface MediaToolRunner {
  run(
    tool: "ffprobe" | "ffmpeg",
    args: readonly string[],
    options: { readonly timeout_ms: number; readonly signal: AbortSignal | undefined },
  ): Promise<ToolResult>;
}

/** The real tools, run without a shell. */
export const realMediaToolRunner: MediaToolRunner = {
  async run(tool, args, options) {
    return await new Promise<ToolResult>((resolvePromise, rejectPromise) => {
      execFile(tool, [...args], {
        timeout: options.timeout_ms,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", TMPDIR: process.env.TMPDIR ?? "/tmp" },
        // The signal travels into the child, so a cancelled render stops the decoder as
        // well as the encoder, and the promise settles when the child is gone.
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }, (error, stdout, stderr) => {
        if (error === null) {
          resolvePromise({ code: 0, signal: null, stdout: String(stdout), stderr: String(stderr) });
          return;
        }
        const facts = error as { code?: unknown; killed?: boolean; signal?: string; name?: string };
        const exitCode = typeof facts.code === "number" ? facts.code : null;
        if (exitCode !== null || facts.killed === true || typeof facts.signal === "string" || facts.name === "AbortError") {
          // The tool ran and failed, or it was stopped. That is a result, not an
          // exception: the QC has to be able to report "the decoder refused the file" as
          // a blocked check, and "the decoder was stopped" as another one.
          resolvePromise({
            code: exitCode,
            signal: facts.signal ?? null,
            stdout: String(stdout),
            stderr: String(stderr),
          });
          return;
        }
        // The tool could not be started at all. That is not a media fact, so it stays an
        // exception and the caller reports it as an unavailable tool.
        rejectPromise(error);
      });
    });
  },
};

/** What the probe found in the media. */
export interface ProbeFacts {
  readonly container: string;
  readonly video_codec: string | null;
  readonly audio_codec: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps_numerator: number | null;
  readonly fps_denominator: number | null;
  readonly frames: number | null;
  readonly duration_seconds: number | null;
  readonly video_streams: number;
  readonly audio_streams: number;
  readonly other_streams: number;
}

/** One supplement that has to travel with the package. */
export interface SupplementCheck {
  readonly id: string;
  /** The role the supplement fills, when it has one. */
  readonly role: string;
  readonly sha256: string;
  readonly bytes: number;
  /** The digest the bytes actually have. `null` when they could not be read. */
  readonly actual_sha256: string | null;
  readonly actual_bytes: number | null;
}

/** What the QC is given. */
export interface QcInput {
  readonly media_path: string;
  /**
   * The delivery the checks belong to.
   *
   * The evidence references carry the delivery's own id, so that two deliveries never
   * name the same artefact.
   */
  readonly delivery_id: string;
  readonly render_spec: RenderSpec;
  readonly supplements: readonly SupplementCheck[];
  /** The roles that have to be in the package. One that is missing blocks the delivery. */
  readonly required_supplements: readonly string[];
  /** How many frames the immutable native document says the film has. */
  readonly expected_frames: number | undefined;
  /** How long the immutable native document says the film is. */
  readonly expected_duration_seconds: number | undefined;
  readonly runner: MediaToolRunner;
  readonly timeout_ms: number;
  readonly signal: AbortSignal | undefined;
}

/** The result of the quality control. */
export interface QcResult {
  readonly items: readonly QCItem[];
  /** True when at least one check blocked. */
  readonly blocked: boolean;
  /** The probe's own output, kept as the evidence of the container checks. */
  readonly probe_bytes: Buffer;
  /** The decoder's own output, kept as the evidence of the full decode. */
  readonly decode_bytes: Buffer;
  readonly probe: ProbeFacts | null;
}

/** The digest of a buffer, as a `Ref` carries it. */
function refFor(id: string, bytes: Buffer): Ref {
  return { id, version: 1, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function parseProbe(stdout: string): ProbeFacts | null {
  let parsed: {
    format?: { format_name?: unknown; duration?: unknown };
    streams?: Array<{
      codec_type?: unknown; codec_name?: unknown; width?: unknown; height?: unknown;
      r_frame_rate?: unknown; avg_frame_rate?: unknown; nb_read_frames?: unknown;
    }>;
  };
  try { parsed = JSON.parse(stdout) as typeof parsed; }
  catch { return null; }
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const rate = String(video?.avg_frame_rate ?? video?.r_frame_rate ?? "0/1");
  const [numerator, denominator] = rate.split("/").map((part) => Number(part));
  const frames = Number(video?.nb_read_frames);
  const duration = Number(parsed.format?.duration);
  return {
    container: String(parsed.format?.format_name ?? ""),
    video_codec: typeof video?.codec_name === "string" ? video.codec_name : null,
    audio_codec: typeof audio?.codec_name === "string" ? audio.codec_name : null,
    width: typeof video?.width === "number" ? video.width : null,
    height: typeof video?.height === "number" ? video.height : null,
    fps_numerator: numerator !== undefined && Number.isFinite(numerator) && numerator > 0 ? numerator : null,
    fps_denominator: denominator !== undefined && Number.isFinite(denominator) && denominator > 0 ? denominator : null,
    frames: Number.isSafeInteger(frames) && frames > 0 ? frames : null,
    duration_seconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    video_streams: streams.filter((stream) => stream.codec_type === "video").length,
    audio_streams: streams.filter((stream) => stream.codec_type === "audio").length,
    other_streams: streams.filter((stream) => stream.codec_type !== "video" && stream.codec_type !== "audio").length,
  };
}

/** Whether two rational numbers are the same number. */
export function sameRational(aNumerator: number, aDenominator: number, bNumerator: number, bDenominator: number): boolean {
  if (aDenominator === 0 || bDenominator === 0) return false;
  return aNumerator * bDenominator === bNumerator * aDenominator;
}

/**
 * Run the quality control.
 *
 * The probe and the decode are separate runs on purpose: the probe is cheap and says
 * what the file claims to be, the decode is expensive and says whether it is true.
 * A failure in either is a block; the other checks still run, so that a report names
 * every problem rather than only the first one.
 */
export async function runQualityControl(input: QcInput): Promise<QcResult> {
  const items: QCItem[] = [];

  // 1. What the file says it is.
  const probeResult = await input.runner.run("ffprobe", [
    "-v", "error",
    // Only local files may be read: the media is a file in this Host's own staging
    // area, and a probe that could reach a URL would be a probe that could be told
    // what to say.
    "-protocol_whitelist", "file,pipe",
    "-count_frames",
    "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames",
    "-of", "json",
    input.media_path,
  ], { timeout_ms: input.timeout_ms, signal: input.signal });

  const probeBytes = Buffer.from(probeResult.stdout, "utf8");
  const probe = probeResult.code === 0 ? parseProbe(probeResult.stdout) : null;
  const probeRef = refFor(packageRefId(input.delivery_id, PACKAGE_ROLES.ffprobe), probeBytes);

  if (probeResult.code !== 0 || probe === null) {
    items.push({
      id: "media_container",
      status: "block",
      reason: "the media could not be probed; it is not a file that can be described",
      evidence_ref: probeRef,
    });
  } else {
    const spec = input.render_spec;
    const containerOk = probe.container.split(",").includes("mp4");
    items.push({
      id: "media_container",
      status: containerOk ? "pass" : "block",
      reason: containerOk ? `the container is ${probe.container}` : `the container is ${probe.container}, not mp4`,
      evidence_ref: probeRef,
    });
    items.push({
      id: "media_video_codec",
      status: probe.video_codec === spec.video_codec ? "pass" : "block",
      reason: probe.video_codec === spec.video_codec
        ? `the video codec is ${spec.video_codec}`
        : `the video codec is ${String(probe.video_codec)}, not ${spec.video_codec}`,
      evidence_ref: probeRef,
    });
    items.push({
      id: "media_audio_codec",
      status: probe.audio_codec === spec.audio_codec ? "pass" : "block",
      reason: probe.audio_codec === spec.audio_codec
        ? `the audio codec is ${spec.audio_codec}`
        : `the audio codec is ${String(probe.audio_codec)}, not ${spec.audio_codec}`,
      evidence_ref: probeRef,
    });
    items.push({
      id: "media_dimensions",
      status: probe.width === spec.width && probe.height === spec.height ? "pass" : "block",
      reason: probe.width === spec.width && probe.height === spec.height
        ? `the picture is ${probe.width}x${probe.height}`
        : `the picture is ${String(probe.width)}x${String(probe.height)}, not ${spec.width}x${spec.height}`,
      evidence_ref: probeRef,
    });
    const sameRate = probe.fps_numerator !== null && probe.fps_denominator !== null
      && sameRational(probe.fps_numerator, probe.fps_denominator, spec.fps_numerator, spec.fps_denominator);
    items.push({
      id: "media_frame_rate",
      status: sameRate ? "pass" : "block",
      reason: sameRate
        ? `the frame rate is ${spec.fps_numerator}/${spec.fps_denominator}`
        : `the frame rate is ${String(probe.fps_numerator)}/${String(probe.fps_denominator)}, not ${spec.fps_numerator}/${spec.fps_denominator}`,
      evidence_ref: probeRef,
    });
    // The file has to hold the streams the spec names and nothing else: a file with an
    // extra stream is a file nobody described, and a file with two video streams is a
    // file whose picture depends on which one a player picks.
    const streamsOk = probe.video_streams === 1 && probe.audio_streams === 1 && probe.other_streams === 0;
    items.push({
      id: "media_streams",
      status: streamsOk ? "pass" : "block",
      reason: streamsOk
        ? "the file holds one video stream and one audio stream"
        : `the file holds ${probe.video_streams} video stream(s), ${probe.audio_streams} audio stream(s) and ${probe.other_streams} other stream(s)`,
      evidence_ref: probeRef,
    });
  }

  // 2. Whether the file is as long as the film is. A file that decodes and is shorter
  //    than the native document is a shortened film.
  const frameTolerance = 1;
  if (probe !== null) {
    const expectedFrames = input.expected_frames;
    if (expectedFrames === undefined) {
      items.push({
        id: "media_frames",
        status: probe.frames !== null && probe.frames > 0 ? "pass" : "block",
        reason: probe.frames !== null && probe.frames > 0
          ? `the file holds ${probe.frames} frame(s); the snapshot did not say how many it should hold`
          : "the file holds no readable frame",
        evidence_ref: probeRef,
      });
    } else {
      const framesOk = probe.frames !== null && Math.abs(probe.frames - expectedFrames) <= frameTolerance;
      items.push({
        id: "media_frames",
        status: framesOk ? "pass" : "block",
        reason: framesOk
          ? `the file holds ${String(probe.frames)} frame(s), as the snapshot's native document says`
          : `the file holds ${String(probe.frames)} frame(s) and the snapshot's native document says ${expectedFrames}`,
        evidence_ref: probeRef,
      });
    }
    const expectedDuration = input.expected_duration_seconds;
    if (expectedDuration !== undefined) {
      // One frame of slack: a duration and a frame count are two views of the same
      // thing, and they round differently.
      const slack = 1 / (input.render_spec.fps_numerator / input.render_spec.fps_denominator);
      const durationOk = probe.duration_seconds !== null && Math.abs(probe.duration_seconds - expectedDuration) <= slack;
      items.push({
        id: "media_duration",
        status: durationOk ? "pass" : "block",
        reason: durationOk
          ? `the film is ${probe.duration_seconds}s long, as the snapshot's native document says`
          : `the film is ${String(probe.duration_seconds)}s long and the snapshot's native document says ${expectedDuration}s`,
        evidence_ref: probeRef,
      });
    }
  }

  // 3. Whether the file is really what it says. `-xerror` makes the decoder fail on the
  //    first error, so a file that decodes with errors is a failure and not a warning.
  //    Every stream is mapped, because a decode that only looked at the video would
  //    pass a file whose audio is broken.
  const decodeResult = await input.runner.run("ffmpeg", [
    "-v", "error",
    "-nostdin",
    "-xerror",
    // One thread each: a decode that uses every core is not a bounded decode, and the
    // numbers a decode reports depend on how many threads it used.
    "-threads", "1",
    "-filter_threads", "1",
    "-filter_complex_threads", "1",
    // Only local files may be read.
    "-protocol_whitelist", "file,pipe",
    "-i", input.media_path,
    "-map", "0",
    "-f", "null",
    "-",
  ], { timeout_ms: input.timeout_ms, signal: input.signal });

  const decodeBytes = Buffer.from(`${decodeResult.stdout}${decodeResult.stderr}`, "utf8");
  const decodeRef = refFor(packageRefId(input.delivery_id, PACKAGE_ROLES.fullDecode), decodeBytes);
  const decodeErrorText = `${decodeResult.stderr}${decodeResult.stdout}`.trim();
  const decodeOk = decodeResult.code === 0 && decodeErrorText.length === 0;
  items.push({
    id: "media_full_decode",
    status: decodeOk ? "pass" : "block",
    reason: decodeOk
      ? "the whole file decodes"
      : `the full decode failed${decodeErrorText.length > 0 ? `: ${decodeErrorText.slice(0, 300)}` : ""}`,
    evidence_ref: decodeRef,
  });

  // 4. Whether the files that travel with the film are the files that were cleared,
  //    and whether the ones that were promised are there at all.
  const supplementProblems = input.supplements.filter((supplement) =>
    supplement.actual_sha256 === null
    || supplement.actual_sha256 !== supplement.sha256
    || supplement.actual_bytes !== supplement.bytes);
  const rolesPresent = new Set(input.supplements.map((supplement) => supplement.role));
  const missingRoles = input.required_supplements.filter((role) => !rolesPresent.has(role));
  const supplementReasons: string[] = [];
  if (supplementProblems.length > 0) {
    supplementReasons.push(`${supplementProblems.length} supplement(s) do not match the bytes they were cleared as: ${supplementProblems.map((supplement) => supplement.id).join(", ")}`);
  }
  if (missingRoles.length > 0) {
    supplementReasons.push(`the package is missing what was promised: ${missingRoles.join(", ")}`);
  }
  items.push({
    id: "supplements",
    status: supplementReasons.length === 0 ? "pass" : "block",
    reason: supplementReasons.length === 0
      ? `${input.supplements.length} supplement(s) match their digests and every promised one is there`
      : supplementReasons.join("; "),
    evidence_ref: null,
  });

  return {
    items,
    blocked: items.some((item) => item.status === "block"),
    probe_bytes: probeBytes,
    decode_bytes: decodeBytes,
    probe,
  };
}
