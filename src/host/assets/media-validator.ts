import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { promisify } from "node:util";

import { HttpError } from "../api-error.js";

const execute = promisify(execFile);

export interface MediaValidationOptions {
  ffprobe?: string;
  ffmpeg?: string;
  timeoutMs?: number;
  stderrBytes?: number;
}

export interface ValidatedMedia {
  bytesSha256: string;
  durationFrames: number;
  width: number;
  height: number;
}

export async function validateImportedMedia(path: string, expectedFrameRate: number,
  expectedSha256: string, options: MediaValidationOptions = {}): Promise<ValidatedMedia> {
  const timeout = options.timeoutMs ?? 120_000;
  const maxBuffer = options.stderrBytes ?? 1024 * 1024;
  const probe = await runTool(options.ffprobe ?? "ffprobe", ["-v", "error", "-count_frames", "-show_entries",
    "format=format_name:stream=codec_type,avg_frame_rate,r_frame_rate,nb_read_frames,nb_frames,width,height", "-of", "json", path],
  timeout, maxBuffer, "probe");
  let value: ProbeOutput;
  try { value = JSON.parse(probe.stdout) as ProbeOutput; }
  catch { throw new HttpError(422, "INVALID_MEDIA", "ffprobe returned invalid media facts"); }
  const formats = typeof value.format?.format_name === "string" ? value.format.format_name.split(",") : [];
  const videos = value.streams?.filter((stream) => stream.codec_type === "video") ?? [];
  if (!formats.includes("mp4") || videos.length !== 1) {
    throw new HttpError(422, "INVALID_MEDIA", "Asset must be an MP4 with exactly one video stream");
  }
  const video = videos[0]!;
  if (!sameRate(video.avg_frame_rate, expectedFrameRate) || !sameRate(video.r_frame_rate, expectedFrameRate)
    || video.avg_frame_rate !== video.r_frame_rate) {
    throw new HttpError(422, "INVALID_MEDIA", "Asset must use the exact constant project frame rate");
  }
  const durationFrames = Number(video.nb_read_frames ?? video.nb_frames);
  const width = Number(video.width);
  const height = Number(video.height);
  if (!Number.isSafeInteger(durationFrames) || durationFrames < 1 || !Number.isSafeInteger(width) || width < 1
    || !Number.isSafeInteger(height) || height < 1) {
    throw new HttpError(422, "INVALID_MEDIA", "Asset has invalid frame or dimension facts");
  }
  const decode = await runTool(options.ffmpeg ?? "ffmpeg", ["-hide_banner", "-nostats", "-loglevel", "info", "-i", path,
    "-map", "0:v:0", "-vf", "vfrdet", "-f", "null", "-"], timeout, maxBuffer, "decode");
  const vfr = /\bVFR:[^\s]+\s+\((\d+)\/(\d+)\)/u.exec(decode.stderr);
  if (vfr === null || Number(vfr[1]) !== 0) {
    throw new HttpError(422, "INVALID_MEDIA", "Asset must use a constant project frame rate");
  }
  const bytesSha256 = await hashFile(path);
  if (bytesSha256 !== expectedSha256) throw new HttpError(422, "INVALID_MEDIA", "Asset bytes changed during media validation");
  return { bytesSha256, durationFrames, width, height };
}

async function runTool(command: string, args: string[], timeout: number, maxBuffer: number,
  action: "probe" | "decode"): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execute(command, args, { timeout, maxBuffer, windowsHide: true, encoding: "utf8" });
  } catch (error) {
    const facts = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string };
    if (facts.code === "ENOENT" || facts.code === "EACCES" || facts.code === "ENOEXEC" || facts.code === "ETIMEDOUT"
      || facts.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
      || facts.killed || typeof facts.signal === "string") {
      throw new HttpError(503, "MEDIA_TOOL_UNAVAILABLE", `Media ${action} tool is unavailable`);
    }
    throw new HttpError(422, "INVALID_MEDIA", `Asset failed complete media ${action} validation`);
  }
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function sameRate(value: unknown, expected: number): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (match === null) return false;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && denominator > 0
    && numerator === expected * denominator;
}

interface ProbeOutput {
  format?: { format_name?: unknown };
  streams?: Array<{ codec_type?: unknown; avg_frame_rate?: unknown; r_frame_rate?: unknown;
    nb_read_frames?: unknown; nb_frames?: unknown; width?: unknown; height?: unknown }>;
}
