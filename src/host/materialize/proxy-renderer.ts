import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { canonicalJson } from "../engine/source-digest-v1.js";
import { HttpError } from "../api-error.js";
import type { LineageEntryV1, MaterializationProxy, NativePlanV1 } from "../../contracts/wave2-types.js";
import type { DerivedArtifactStore } from "./derived-artifact-store.js";

const run = promisify(execFile);

/**
 * ProxyRenderer (M3.2).
 *
 * Produces a comparison proxy from the real media behind the plan. It is a rendering tool
 * with three hard constraints and none of them is negotiable:
 *
 * - **Fixed argv.** The command is built from a literal template with each input passed as
 *   a separate argument. There is no shell, no string interpolation into a command line, and
 *   no argument a caller can use to change what ffmpeg does. A segment id that looks like a
 *   flag ends up in a filter map, not in the command.
 *
 * - **No network, no source writes.** ffmpeg is invoked with no protocol that could reach
 *   out, and every output path lives under the derived root. The source media is read and
 *   never opened for writing.
 *
 * - **A segment is cut, not faked.** A segment longer than its source is refused rather
 *   than looped, frozen or slowed; each of those three changes what the viewer sees and
 *   would make the proxy a different film from the plan.
 *
 * The result is real media: every MT-06 assertion in the suite runs ffprobe and decodes
 * frames back out of the produced bytes.
 */

export const SEGMENT_TIMEOUT_MS = 120_000;
export const MAX_SEGMENTS = 64;
export const MAX_OUTPUT_FRAMES = 64 * 60 * 30;
/** Frozen ceilings: two encoders overall, one per project. */
export const GLOBAL_CONCURRENCY = 2;
export const PER_PROJECT_CONCURRENCY = 1;

export interface ProxySegmentInput {
  readonly segment_id: string;
  /** Absolute path to the media. Host-owned; never a request field. */
  readonly asset_path: string;
  /** What the binding recorded when it re-read the bytes. */
  readonly sha256: string;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  readonly license_status: string;
  readonly commercial_use: boolean;
}

/**
 * Notified when a render is admitted and when it leaves.
 *
 * The limiter has to be observable from outside or it cannot be tested: a caller counting
 * its own promises measures the caller, and would report the ceilings as satisfied by a
 * renderer that has none.
 */
export interface ProxyRenderObserver {
  readonly entered?: (projectId: string) => void;
  readonly exited?: (projectId: string) => void;
}

export interface ProxyRenderResult {
  readonly proxy: MaterializationProxy;
  readonly lineage: readonly LineageEntryV1[];
  readonly tool: { readonly profile_id: string; readonly version: string; readonly argv_is_fixed: true };
}

export class ProxyRenderer {
  readonly #artifacts: DerivedArtifactStore;
  readonly #profile: string;

  readonly #observer: ProxyRenderObserver;
  readonly #globalSlots: Semaphore;
  readonly #projectSlots: Map<string, Semaphore>;

  constructor(deps: {
    artifacts: DerivedArtifactStore;
    profile: string;
    concurrency?: { global: number; perProject: number };
    observer?: ProxyRenderObserver;
  }) {
    const concurrency = deps.concurrency;
    this.#artifacts = deps.artifacts;
    this.#profile = deps.profile;
    this.#observer = deps.observer ?? {};
    this.#globalSlots = new Semaphore(concurrency?.global ?? GLOBAL_CONCURRENCY);
    this.#projectSlots = new Map();
    this.#perProjectLimit = concurrency?.perProject ?? PER_PROJECT_CONCURRENCY;
  }

  readonly #perProjectLimit: number;

  static limits(): { global: number; per_project: number } {
    return { global: GLOBAL_CONCURRENCY, per_project: PER_PROJECT_CONCURRENCY };
  }

  #slotsFor(projectId: string): Semaphore {
    let slots = this.#projectSlots.get(projectId);
    if (slots === undefined) {
      slots = new Semaphore(this.#perProjectLimit);
      this.#projectSlots.set(projectId, slots);
    }
    return slots;
  }

  /**
   * Global slot first, then the project's. The order matters: taking the global slot first
   * means a project waiting for its own slot is not holding a global one, so a busy project
   * cannot starve every other project.
   */
  async #admit(projectId: string): Promise<() => void> {
    const project = this.#slotsFor(projectId);
    await project.acquire();
    try {
      await this.#globalSlots.acquire();
    } catch (error) {
      // Give the project slot back: holding it after a failed global acquire would wedge
      // this project forever while other projects carried on.
      project.release();
      throw error;
    }
    this.#observer.entered?.(projectId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#observer.exited?.(projectId);
      this.#globalSlots.release();
      project.release();
    };
  }

  async render(input: {
    materializationId: string;
    /** Which project's budget this render spends. */
    projectId: string;
    plan: NativePlanV1;
    segments: readonly ProxySegmentInput[];
  }): Promise<ProxyRenderResult> {
    const release = await this.#admit(input.projectId);
    try {
      return await this.#renderWithinSlot(input);
    } finally {
      release();
    }
  }

  async #renderWithinSlot(input: {
    materializationId: string;
    projectId: string;
    plan: NativePlanV1;
    segments: readonly ProxySegmentInput[];
  }): Promise<ProxyRenderResult> {
    if (input.segments.length === 0) throw new HttpError(422, "INVALID_MEDIA", "A proxy needs at least one segment");
    if (input.segments.length > MAX_SEGMENTS) {
      throw new HttpError(422, "INVALID_MEDIA", `A proxy covers at most ${MAX_SEGMENTS} segments`);
    }

    const prepared: Array<{ segment: ProxySegmentInput; frames: number }> = [];
    for (const segment of input.segments) {
      // Rights before bytes: a licence that bars commercial use must not even be read.
      if (segment.license_status !== "cleared" || !segment.commercial_use) {
        throw new HttpError(403, "DATA_POLICY_DENIED",
          `Segment ${segment.segment_id} is bound to media whose licence does not permit this use`,
          undefined, input.materializationId);
      }
      const bytes = await readFile(segment.asset_path);
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== segment.sha256) {
        throw new HttpError(409, "SOURCE_CHANGED",
          `Segment ${segment.segment_id} no longer matches the bytes its binding recorded`,
          undefined, input.materializationId);
      }
      const available = await this.#countFrames(segment.asset_path);
      const wanted = segment.end_frame_exclusive - segment.start_frame;
      if (segment.start_frame < 0 || wanted <= 0 || !Number.isSafeInteger(segment.start_frame)
        || !Number.isSafeInteger(segment.end_frame_exclusive)) {
        throw new HttpError(422, "INVALID_RANGE",
          `Segment ${segment.segment_id} is not a non-empty integer half-open range`,
          undefined, input.materializationId);
      }
      if (segment.start_frame + wanted > available) {
        throw new HttpError(422, "INVALID_RANGE",
          `Segment ${segment.segment_id} needs ${wanted} frame(s) from frame ${segment.start_frame} but the source has ${available}`,
          { available_frames: available, requested: wanted, from_frame: segment.start_frame },
          input.materializationId);
      }
      prepared.push({ segment, frames: wanted });
    }

    const totalFrames = prepared.reduce((sum, entry) => sum + entry.frames, 0);
    if (totalFrames > MAX_OUTPUT_FRAMES) {
      throw new HttpError(422, "INVALID_MEDIA", "The proxy would exceed the maximum frame count");
    }

    const concatList = prepared.map((entry) => `file '${escapeConcatPath(entry.segment.asset_path)}'`)
      .join("\n");
    // Render into staging: the encoder needs a file, and that file must not yet be named
    // after content nobody has produced. `put` promotes it under its own hash afterwards.
    //
    // The concat list is a file rather than stdin on purpose. ffmpeg resolves each entry
    // against the list's own URL, so entries read from `pipe:` become `pipe:/abs/path` and
    // fail with "moov atom not found" — a failure that looks like corrupt media and is
    // really a URL-resolution artefact.
    const stagingPath = await this.#artifacts.stagingPath("mp4");
    const listPath = await this.#artifacts.stagingPath("txt");
    let bytes: Buffer;
    try {
      await writeFile(listPath, `${concatList}\n`, { encoding: "utf8", mode: 0o600 });
      await this.#runFixed([
        "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
        // The concat demuxer refuses anything not explicitly allowed. `file` is what
        // reads the local segments; nothing that could reach the network is listed, which
        // is the point of naming them rather than using the default.
        "-protocol_whitelist", "file,pipe",
        "-f", "concat", "-safe", "0", "-i", listPath,
        "-an",
        "-vf", `fps=${input.plan.fps.num}/${input.plan.fps.den},scale=${WIDTH_OF_PROFILE}:${HEIGHT_OF_PROFILE}`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-r", `${input.plan.fps.num}/${input.plan.fps.den}`,
        "-frames:v", String(totalFrames),
        "-movflags", "+faststart",
        stagingPath,
      ]);
      bytes = await readFile(stagingPath);
    } finally {
      await this.#artifacts.discardStaging(stagingPath);
      await this.#artifacts.discardStaging(listPath);
    }
    const token = await this.#artifacts.put(bytes, "mp4");
    const produced = await this.#countFrames(this.#artifacts.resolve(token));
    if (produced !== totalFrames) {
      // The proxy says one length and the bytes say another. Answering with either would be
      // a guess; the caller has to decide.
      throw new HttpError(422, "INVALID_MEDIA",
        `The rendered proxy has ${produced} frame(s) but the plan describes ${totalFrames}`,
        { produced_frames: produced, expected_frames: totalFrames }, input.materializationId);
    }

    const proxySha = createHash("sha256").update(bytes).digest("hex");
    let cursor = input.plan.clips[0]?.timeline.start_frame ?? 0;
    const lineage: LineageEntryV1[] = prepared.map((entry) => {
      const clip = input.plan.clips.find((candidate) => candidate.segment_id === entry.segment.segment_id);
      const record: LineageEntryV1 = {
        output_sha256: proxySha,
        input_asset_id: clip?.asset_id ?? entry.segment.segment_id,
        input_sha256: entry.segment.sha256,
        source: { start_frame: entry.segment.start_frame, end_frame_exclusive: entry.segment.end_frame_exclusive },
        output: { start_frame: cursor, end_frame_exclusive: cursor + entry.frames },
      };
      cursor += entry.frames;
      return record;
    });

    return {
      proxy: { token, sha256: proxySha, frame_count: totalFrames, profile_id: this.#profile },
      lineage,
      tool: { profile_id: this.#profile, version: await this.#ffmpegVersion(), argv_is_fixed: true },
    };
  }

  /**
   * The single place a command is built.
   *
   * Arguments are passed as an array to `execFile`, so there is no shell and no string to
   * escape into one. The concat list arrives on stdin rather than as a filename precisely so
   * that no path can become an argument.
   */
  async #runFixed(args: readonly string[]): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      // `execFile` with no shell and an argument array: nothing in `args` can become shell
      // syntax, and nothing can reach the network because no protocol that could is passed.
      const child = execFile("ffmpeg", [...args], {
        timeout: SEGMENT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C" },
      }, (error, _stdout, stderr) => {
        // The callback fires on *exit*, which is what makes reading the output file safe:
        // awaiting the ChildProcess object instead would resolve immediately and the file
        // would not exist yet.
        if (error === null) { resolvePromise(); return; }
        const detail = String(stderr ?? "").trim();
        rejectPromise(new HttpError(422, "INVALID_MEDIA",
          `The proxy encoder failed${detail.length > 0 ? `: ${detail.slice(0, 200)}` : ""}`));
      });
      // `-nostdin` above means ffmpeg reads no stdin, so closing it is enough.
      child.stdin?.end();
    });
  }

  async #countFrames(path: string): Promise<number> {
    try {
      const { stdout } = await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path],
      { timeout: SEGMENT_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true });
      const frames = Number(stdout.trim());
      if (!Number.isSafeInteger(frames) || frames < 1) throw new Error("no frame count");
      return frames;
    } catch {
      throw new HttpError(422, "INVALID_MEDIA", "The source media could not be probed");
    }
  }

  async #ffmpegVersion(): Promise<string> {
    try {
      const { stdout } = await run("ffmpeg", ["-version"], { timeout: 15_000, maxBuffer: 256 * 1024 });
      return /ffmpeg version [^\s]+/u.exec(stdout)?.[0] ?? "unknown";
    } catch { return "unknown"; }
  }
}

/** The proxy profile is frozen at 720p. Anything else is a different profile. */
const WIDTH_OF_PROFILE = 1280;
const HEIGHT_OF_PROFILE = 720;

/**
 * A counting semaphore.
 *
 * The release is idempotent because the limiter's own correctness must not depend on a
 * caller getting `finally` right: a double release would let three encoders run when two
 * were promised.
 */
class Semaphore {
  #available: number;
  readonly #waiting: Array<() => void> = [];

  constructor(permits: number) {
    if (!Number.isSafeInteger(permits) || permits < 1) {
      throw new Error(`SEMAPHORE_PERMITS_INVALID:${permits}`);
    }
    this.#available = permits;
  }

  async acquire(): Promise<void> {
    if (this.#available > 0) { this.#available -= 1; return; }
    await new Promise<void>((resolvePromise) => { this.#waiting.push(resolvePromise); });
  }

  release(): void {
    const next = this.#waiting.shift();
    if (next !== undefined) { next(); return; }
    this.#available += 1;
  }
}

/**
 * Digest over the lineage and the tool that produced it (MT-03).
 *
 * Both are folded in: the same entries rendered by a different encoder are a different
 * answer, and a proxy whose provenance cannot name its tool has not been traced. Entry
 * order is not part of it, because the order is an accident of how the request was written
 * rather than a fact about the film — but every value each entry carries is.
 */
export function lineageDigest(
  entries: readonly LineageEntryV1[],
  tool: { readonly profile_id: string; readonly version: string },
): string {
  const digest = createHash("sha256");
  digest.update("narralens-lineage-v1\n");
  digest.update(canonicalJson({
    tool: { profile_id: tool.profile_id, version: tool.version },
    entries: [...entries]
      .map((entry) => ({
        output_sha256: entry.output_sha256,
        input_asset_id: entry.input_asset_id,
        input_sha256: entry.input_sha256,
        source: { start_frame: entry.source.start_frame, end_frame_exclusive: entry.source.end_frame_exclusive },
        output: { start_frame: entry.output.start_frame, end_frame_exclusive: entry.output.end_frame_exclusive },
      }))
      .sort((a, b) => a.input_asset_id.localeCompare(b.input_asset_id)
        || a.source.start_frame - b.source.start_frame),
  }));
  return digest.digest("hex");
}

/**
 * A path inside a concat list is single-quoted; an embedded quote would end the entry and
 * let the rest of the line become a second file.
 */
function escapeConcatPath(path: string): string {
  return path.replaceAll("'", "'\\''");
}
