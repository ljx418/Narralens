import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

/**
 * M5C's media and structure fixtures (Wave 3 `04` §7, `02` §5).
 *
 * The fixtures are built by the *local* ffmpeg from the media the repository has already
 * verified — the same `visual-10s.mp4` the D4.x evidence used — and they are
 * deterministic: the same commands on the same bytes produce the same files, and their
 * SHA256s are recorded.
 *
 * What they prove and what they do not:
 *
 * - they prove that the system's *interaction* is real — that a browser plays real
 *   media, that the proxy streams decode, that the frame rate and the timeline agree;
 * - they do **not** prove the quality of a long film, and the 120-clip fixture is a
 *   structural stress case, not a claim about content.
 *
 * Every command, every digest, the ffprobe facts and the full decode are recorded, so a
 * reader can re-run them.
 */
const run = promisify(execFile);

export const FFMPEG = "ffmpeg";
export const FFPROBE = "ffprobe";

export interface FixtureFile {
  readonly kind: "proxy" | "system-film" | "stress-film";
  readonly name: string;
  readonly path: string;
  readonly command: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly ffprobe: Record<string, unknown>;
  readonly decoded_frames: number;
  readonly decode_command: string;
}

export interface FixtureSet {
  readonly root: string;
  readonly files: readonly FixtureFile[];
  /** The chapter structure of the stress fixture: six or more chapters over 120 clips. */
  readonly chapters: readonly Chapter[];
  readonly claim_limits: readonly string[];
}

export interface Chapter {
  readonly chapter_id: string;
  readonly title: string;
  readonly start_clip: number;
  readonly clip_count: number;
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

async function ffprobeFacts(path: string): Promise<Record<string, unknown>> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-show_entries",
    "format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels",
    "-of", "json", path,
  ]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

/**
 * A full decode.
 *
 * `-f null -` decodes every frame and writes nothing, so a file that cannot be decoded
 * cannot be counted as playable. The frame count comes from the decoder's own report.
 */
async function fullDecode(path: string): Promise<{ frames: number; command: string }> {
  const args = ["-v", "error", "-i", path, "-map", "0:v:0", "-f", "null", "-",
    "-progress", "pipe:2", "-nostats"];
  const command = `${FFMPEG} ${args.join(" ")}`;
  const { stderr } = await run(FFMPEG, args);
  const frames = [...stderr.matchAll(/^frame=(\d+)$/gmu)].map((match) => Number(match[1]));
  const last = frames.at(-1) ?? 0;
  if (last <= 0) throw new Error(`FULL_DECODE_REPORTED_NO_FRAMES:${path}`);
  return { frames: last, command };
}

/** Encode one proxy stream from the verified source media. */
async function buildProxy(source: string, target: string, scale: string, extra: readonly string[]): Promise<string> {
  const args = ["-y", "-v", "error", "-i", source, "-t", "10", "-vf", `scale=${scale},fps=30`,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", ...extra, target];
  await run(FFMPEG, args);
  return `${FFMPEG} ${args.join(" ")}`;
}

/**
 * Build a film of N equal segments from one source, with the concat filter.
 *
 * The segments are cut from the same verified bytes, so the result is deterministic and
 * every frame in it is a frame the decoder really produced.
 */
async function buildSegmentedFilm(source: string, target: string, segments: number,
  secondsEach: number): Promise<string> {
  const filters: string[] = [];
  const labels: string[] = [];
  for (let index = 0; index < segments; index += 1) {
    const start = (index % 3) * 0.25;
    filters.push(`[0:v]trim=start=${start.toFixed(2)}:duration=${secondsEach.toFixed(2)},`
      + `setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=decrease[v${index}]`);
    labels.push(`[v${index}]`);
  }
  const graph = `${filters.join(";")};${labels.join("")}concat=n=${segments}:v=1:a=0[out]`;
  const args = ["-y", "-v", "error", "-i", source, "-filter_complex", graph, "-map", "[out]",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", "30", "-an", target];
  await run(FFMPEG, args);
  return `${FFMPEG} ${args.join(" ")}`;
}

/**
 * Build the whole fixture set.
 *
 * `sourceVisual` and `sourceAlternative` are the repository's already-verified media; the
 * fixtures are built from them and from nothing else.
 */
export async function buildFixtures(root: string, sourceVisual: string,
  sourceAlternative: string): Promise<FixtureSet> {
  await mkdir(root, { recursive: true });
  // A fixture set that is already there is reused: the commands are deterministic, so a
  // rebuild would produce the same bytes and the same digests, and the manifest below
  // records exactly what was built and with which command.
  const cached = await loadFixtureManifest(root);
  if (cached !== undefined) return cached;

  const files: FixtureFile[] = [];

  const record = async (kind: FixtureFile["kind"], name: string, path: string,
    command: string): Promise<void> => {
    const decode = await fullDecode(path);
    files.push({
      kind, name, path, command,
      sha256: await sha256File(path),
      bytes: (await readFile(path)).length,
      ffprobe: await ffprobeFacts(path),
      decoded_frames: decode.frames,
      decode_command: decode.command,
    });
  };

  // Three proxy streams: the same verified picture at three sizes, each decodable on its
  // own. They are what the page plays at the same time.
  const proxySpecs = [
    { name: "proxy-a.mp4", scale: "1280:720" },
    { name: "proxy-b.mp4", scale: "854:480" },
    { name: "proxy-c.mp4", scale: "640:360" },
  ];
  for (const [index, spec] of proxySpecs.entries()) {
    const target = resolve(root, spec.name);
    const source = index === 2 ? sourceAlternative : sourceVisual;
    const command = await buildProxy(source, target, spec.scale, ["-metadata", `title=narralens-m5-proxy-${index + 1}`]);
    await record("proxy", spec.name, target, command);
  }

  // The system fixture: three minutes, twenty-four clips.
  const systemPath = resolve(root, "system-3min.mp4");
  const systemCommand = await buildSegmentedFilm(resolve(root, "proxy-a.mp4"), systemPath, 24, 7.5);
  await record("system-film", "system-3min.mp4", systemPath, systemCommand);

  // The structural stress fixture: 120 clips, six chapters.
  const stressPath = resolve(root, "stress-120clips.mp4");
  const stressCommand = await buildSegmentedFilm(resolve(root, "proxy-b.mp4"), stressPath, 120, 0.5);
  await record("stress-film", "stress-120clips.mp4", stressPath, stressCommand);

  const chapters: Chapter[] = [];
  for (let index = 0; index < 6; index += 1) {
    chapters.push({
      chapter_id: `chapter_${index + 1}`,
      title: `第 ${index + 1} 章`,
      start_clip: index * 20,
      clip_count: 20,
    });
  }
  const structurePath = resolve(root, "chapters.json");
  await writeFile(structurePath, `${JSON.stringify({ chapters, clip_count: 120 }, null, 2)}\n`, "utf8");

  const set: FixtureSet = {
    root,
    files,
    chapters,
    claim_limits: [
      "这些 fixture 只证明系统交互（真实媒体、真实解码、真实帧率），不证明长片内容质量。",
      "120 clip / 6 章是结构压力用例，不是长片质量证据。",
      "素材来自仓库内已验证的 fixtures/d1-30s 媒体，由本地 ffmpeg 确定性合成。",
    ],
  };
  await writeFile(resolve(root, "fixtures.json"), `${JSON.stringify(set, null, 2)}\n`, "utf8");
  return set;
}

/**
 * The manifest of an already-built fixture set.
 *
 * It is only used when every file it names is still there: a manifest without its media
 * is a claim without its evidence, and the set is rebuilt instead.
 */
async function loadFixtureManifest(root: string): Promise<FixtureSet | undefined> {
  const raw = await readFile(resolve(root, "fixtures.json"), "utf8").catch(() => undefined);
  if (raw === undefined) return undefined;
  let parsed: FixtureSet;
  try { parsed = JSON.parse(raw) as FixtureSet; }
  catch { return undefined; }
  for (const file of parsed.files) {
    const present = await readFile(file.path).catch(() => undefined);
    if (present === undefined || sha256(present) !== file.sha256 || file.decoded_frames <= 0) return undefined;
  }
  return parsed;
}
