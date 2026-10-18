import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Fps } from "../../contracts/engine-types.js";
import type {
  MigrationAssetMapping, MigrationFeature, MigrationIdentityEntry, MigrationSubtitleMapping,
} from "../../contracts/migration-types.js";

/**
 * Turns an inventoried Hypit project into a native OpenFilm project (M2.3 plan §3).
 *
 * The result is a real multi-clip film: one page clip per shot plus a narration track.
 * A flattened MP4, a single clip, or a JSON description that merely looks right is not an
 * acceptable migration and is not produced here.
 */

export interface SourceClip {
  readonly source_id: string;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  readonly title: string;
}

export interface SourceAsset {
  readonly source_path: string;
  readonly target_path: string;
  readonly asset_id: string | null;
}

export interface SourceSubtitle {
  readonly source_path: string;
  readonly target_path: string;
}

export interface MigrateInput {
  /** Absolute directory holding the source project's bytes. */
  readonly sourceRoot: string;
  /** Absolute directory to build the migrated project in. It must not exist yet. */
  readonly targetRoot: string;
  readonly clips: readonly SourceClip[];
  readonly narration: { readonly source_path: string; readonly target_path: string } | null;
  readonly subtitles: readonly SourceSubtitle[];
  readonly assets: readonly SourceAsset[];
  readonly fps: Fps;
  readonly stage: { readonly width: number; readonly height: number };
}

export interface MigratedProject {
  readonly identity_map: readonly MigrationIdentityEntry[];
  readonly features: readonly MigrationFeature[];
  readonly assets: readonly MigrationAssetMapping[];
  readonly subtitles: readonly MigrationSubtitleMapping[];
  readonly totalFrames: number;
  /** Digest over every byte written, so the report can prove what it produced. */
  readonly contentDigest: string;
}

const clipIdFor = (sourceId: string): string => sourceId;

function escapeAttribute(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

const clipHtml = (title: string, stage: { width: number; height: number }): string => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#071a2b;color:#fff;font-family:system-ui,sans-serif}
.wrap{display:grid;place-content:center;height:100%;text-align:center}
.k{color:#69d4ff;letter-spacing:.25em;font-size:20px}
.t{font-size:64px;font-weight:700;margin:24px}
</style>
</head>
<body>
<main class="wrap">
<div class="k">叙镜 · 迁移副本</div>
<div class="t" id="title">${escapeAttribute(title)}</div>
</main>
</body>
</html>
`;

/**
 * Deterministic: the same source always produces the same film text, so a report can be
 * compared byte for byte across runs.
 */
export function filmHtml(clips: readonly SourceClip[], narration: MigrateInput["narration"], fps: Fps,
  totalFrames: number, stage: { width: number; height: number }): string {
  const picture = clips.map((clip) => {
    const clipId = clipIdFor(clip.source_id);
    const startSeconds = clip.start_frame / fps.num * fps.den;
    const durationSeconds = (clip.end_frame_exclusive - clip.start_frame) / fps.num * fps.den;
    const at = clip.start_frame === 0 ? "" : ` at="${trim(startSeconds)}"`;
    return `  <iframe id="${escapeAttribute(clipId)}" src="scenes/${escapeAttribute(clipId)}.html#t=0,${trim(durationSeconds)}"${at}></iframe>`;
  });
  const track = narration === null ? [] : [
    `  <audio id="narration" src="${escapeAttribute(narration.target_path)}#t=0,${trim(totalFrames / fps.num * fps.den)}"></audio>`,
  ];
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${stage.width}, height=${stage.height}">
<style>
  iframe { width: ${stage.width}px; height: ${stage.height}px; left: 0; top: 0; }
</style>
</head>
<body>
<section data-track="picture">
${picture.join("\n")}
</section>
<section data-track="narration">
${track.join("\n")}
</section>
</body>
</html>
`;
}

/** Trim numbers are written without trailing zeros so the text is stable. */
function trim(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** Write the migrated project. Returns the identities the plan promised. */
export async function migrateToOpenFilm(input: MigrateInput): Promise<MigratedProject> {
  const target = resolve(input.targetRoot);
  await mkdir(join(target, "scenes"), { recursive: true });
  await mkdir(join(target, "assets"), { recursive: true });

  const identity: MigrationIdentityEntry[] = [];
  for (const clip of input.clips) {
    const clipId = clipIdFor(clip.source_id);
    const clipPath = join(target, "scenes", `${clipId}.html`);
    await mkdir(dirname(clipPath), { recursive: true });
    await writeFile(clipPath, clipHtml(clip.title, input.stage), "utf8");
    identity.push({
      source_id: clip.source_id, target_id: clipId,
      start_frame: clip.start_frame, end_frame_exclusive: clip.end_frame_exclusive,
    });
  }

  const assets: MigrationAssetMapping[] = [];
  for (const asset of input.assets) {
    const from = join(resolve(input.sourceRoot), asset.source_path);
    const to = join(target, asset.target_path);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    assets.push({ source_path: asset.source_path, target_path: asset.target_path,
      sha256: await sha256File(to), asset_id: asset.asset_id });
  }

  const subtitles: MigrationSubtitleMapping[] = [];
  for (const subtitle of input.subtitles) {
    const to = join(target, subtitle.target_path);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(resolve(input.sourceRoot), subtitle.source_path), to);
    subtitles.push({ source_path: subtitle.source_path, target_path: subtitle.target_path, sha256: await sha256File(to) });
  }

  if (input.narration !== null) {
    const to = join(target, input.narration.target_path);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(resolve(input.sourceRoot), input.narration.source_path), to);
  }

  const totalFrames = input.clips.reduce((max, clip) => Math.max(max, clip.end_frame_exclusive), 0);
  await writeFile(join(target, "film.html"),
    filmHtml(input.clips, input.narration, input.fps, totalFrames, input.stage), "utf8");

  return {
    identity_map: identity,
    features: featuresFor(input.clips, input.narration, input.subtitles),
    assets, subtitles, totalFrames,
    contentDigest: await treeDigest(target),
  };
}

function featuresFor(clips: readonly SourceClip[], narration: MigrateInput["narration"],
  subtitles: readonly SourceSubtitle[]): MigrationFeature[] {
  const features: MigrationFeature[] = [
    { id: "timeline.shot_clips", status: "mapped", note: `${clips.length} shots become ${clips.length} native page clips` },
    { id: "stage.dimensions", status: "mapped", note: "carried from the source descriptor" },
  ];
  features.push(narration === null
    ? { id: "audio.narration", status: "lossy", note: "the source has no narration track" }
    : { id: "audio.narration", status: "mapped", note: "narration is carried as a single native audio clip" });
  features.push(subtitles.length === 0
    ? { id: "subtitle.timing", status: "lossy", note: "the source has no subtitle file" }
    : { id: "subtitle.timing", status: "mapped", note: `${subtitles.length} subtitle file(s) carried unchanged` });
  features.push({ id: "editability.native_clips", status: "mapped",
    note: "each shot stays an individually addressable clip, not a flattened video" });
  return features;
}

/** A stable digest over everything written, independent of file order and mtimes. */
export async function treeDigest(root: string): Promise<string> {
  const base = resolve(root);
  const entries = await collectFiles(base);
  const hash = createHash("sha256");
  for (const relative of entries.sort()) {
    hash.update(relative);
    hash.update(await sha256File(join(base, relative)));
  }
  return hash.digest("hex");
}

async function collectFiles(root: string, prefix = ""): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const found: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await collectFiles(root, relative));
    else found.push(relative);
  }
  return found;
}

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
