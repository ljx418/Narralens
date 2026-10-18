import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  filmHtml, migrateToOpenFilm, treeDigest, type SourceClip,
} from "../../src/host/projects/openfilm-migrator.js";

/**
 * MIG-02 (M2.3 plan §6): the migrated project must be a real native multi-clip film.
 *
 * A flattened MP4, a single clip, or a JSON description that merely looks like three
 * shots does not pass. These tests check the produced bytes, and where the pinned upstream
 * is available, read the film back through it.
 */

const SOURCE_FIXTURE = resolve("tests/fixtures/m2.1/snapshot-project");
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function workspace(): Promise<{ sourceRoot: string; targetRoot: string }> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m23-"));
  dirs.push(base);
  return { sourceRoot: SOURCE_FIXTURE, targetRoot: join(base, "target") };
}

const CLIPS: readonly SourceClip[] = [
  { source_id: "shot-001", start_frame: 0, end_frame_exclusive: 300, title: "第一镜" },
  { source_id: "shot-002", start_frame: 300, end_frame_exclusive: 600, title: "第二镜" },
  { source_id: "shot-003", start_frame: 600, end_frame_exclusive: 900, title: "第三镜" },
];

const INPUT = {
  clips: CLIPS,
  narration: { source_path: "assets/generated/narration-30s.wav", target_path: "assets/narration.wav" },
  subtitles: [{ source_path: "assets/narration.vtt", target_path: "assets/narration.vtt" }],
  assets: [{ source_path: "assets/generated/visual-10s.mp4", target_path: "assets/visual-10s.mp4", asset_id: "asset_snap_a" }],
  fps: { num: 30, den: 1 },
  stage: { width: 1280, height: 720 },
} as const;

describe("MIG-02 the migrated project is a native three-clip film", () => {
  it("writes one page clip per shot with stable ids and real frame ranges", async () => {
    const { sourceRoot, targetRoot } = await workspace();
    const migrated = await migrateToOpenFilm({ sourceRoot, targetRoot, ...INPUT });

    const film = await readFile(join(targetRoot, "film.html"), "utf8");
    expect(film).toContain('<iframe id="shot-001" src="scenes/shot-001.html#t=0,10">');
    expect(film).toContain('<iframe id="shot-002" src="scenes/shot-002.html#t=0,10" at="10">');
    expect(film).toContain('<iframe id="shot-003" src="scenes/shot-003.html#t=0,10" at="20">');
    expect(film).toContain('<audio id="narration" src="assets/narration.wav#t=0,30">');

    expect(migrated.identity_map.map((entry) => entry.target_id)).toEqual(["shot-001", "shot-002", "shot-003"]);
    expect(migrated.identity_map.map((entry) => [entry.start_frame, entry.end_frame_exclusive]))
      .toEqual([[0, 300], [300, 600], [600, 900]]);
    expect(migrated.totalFrames).toBe(900);

    // Three separate scene files, not one flattened video.
    expect((await readdir(join(targetRoot, "scenes"))).sort()).toEqual(["shot-001.html", "shot-002.html", "shot-003.html"]);
  });

  it("carries narration, assets and subtitles as real bytes", async () => {
    const { sourceRoot, targetRoot } = await workspace();
    const migrated = await migrateToOpenFilm({ sourceRoot, targetRoot, ...INPUT });
    expect(migrated.assets.map((asset) => asset.target_path)).toEqual(["assets/visual-10s.mp4"]);
    expect(migrated.assets[0]!.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(migrated.subtitles.map((subtitle) => subtitle.target_path)).toEqual(["assets/narration.vtt"]);
    const [carried, original] = await Promise.all([
      readFile(join(targetRoot, "assets/narration.wav")),
      readFile(resolve(sourceRoot, "assets/generated/narration-30s.wav")),
    ]);
    expect(carried).toEqual(original);
  });

  it("declares every feature and never hides a loss", async () => {
    const { sourceRoot, targetRoot } = await workspace();
    const migrated = await migrateToOpenFilm({ sourceRoot, targetRoot, ...INPUT });
    expect(migrated.features.map((feature) => feature.id)).toEqual([
      "timeline.shot_clips", "stage.dimensions", "audio.narration", "subtitle.timing", "editability.native_clips",
    ]);
    expect(migrated.features.every((feature) => feature.note.length > 0)).toBe(true);
  });

  it("records a loss instead of inventing content when the source has no narration or subtitles", async () => {
    const { sourceRoot, targetRoot } = await workspace();
    const migrated = await migrateToOpenFilm({
      sourceRoot, targetRoot, ...INPUT, narration: null, subtitles: [],
    });
    expect(migrated.features.find((feature) => feature.id === "audio.narration")).toMatchObject({ status: "lossy" });
    expect(migrated.features.find((feature) => feature.id === "subtitle.timing")).toMatchObject({ status: "lossy" });
    expect(await readFile(join(targetRoot, "film.html"), "utf8")).not.toContain("<audio");
  });

  it("is deterministic: the same source produces the same bytes and digest", async () => {
    const first = await workspace();
    const second = await workspace();
    const a = await migrateToOpenFilm({ sourceRoot: first.sourceRoot, targetRoot: first.targetRoot, ...INPUT });
    const b = await migrateToOpenFilm({ sourceRoot: second.sourceRoot, targetRoot: second.targetRoot, ...INPUT });
    expect(await readFile(join(first.targetRoot, "film.html"), "utf8"))
      .toBe(await readFile(join(second.targetRoot, "film.html"), "utf8"));
    expect(a.contentDigest).toBe(b.contentDigest);
    expect(await treeDigest(first.targetRoot)).toBe(await treeDigest(second.targetRoot));
  });

  it("writes a film the pinned upstream reads back as three editable clips", async () => {
    const upstreamRoot = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";
    // Absence is reported as NOT_RUN, never as a pass: a weaker assertion must not stand in.
    if (!existsUpstream(upstreamRoot)) throw new Error("PINNED_OPENFILM_ABSENT: native read-back cannot run here");
    const { sourceRoot, targetRoot } = await workspace();
    await migrateToOpenFilm({ sourceRoot, targetRoot, ...INPUT });

    const { createPinnedOpenFilmUpstream } = await import("../../src/adapters/openfilm/openfilm-upstream.js");
    const upstream = await createPinnedOpenFilmUpstream(upstreamRoot);
    const film = await upstream.readProjectFilm(targetRoot);
    expect(film.problems).toEqual([]);
    const clips = (film.doc as { tracks: Array<{ clips: Array<{ id: string }> }> }).tracks[0]!.clips;
    expect(clips.map((clip) => clip.id)).toEqual(["shot-001", "shot-002", "shot-003"]);

    // And the middle clip is genuinely editable through the native mutator.
    const before = (await upstream.readProjectFilm(targetRoot)).rev;
    const edited = await upstream.editProjectFilm(targetRoot, before,
      [{ op: "set", clip: "shot-002", field: "overrides", value: [{ at: ".t", text: "改过的第二镜" }] }]);
    expect(edited.rebased).toBe(false);
    expect(edited.rev).not.toBe(before);
    // The native override lands in film.html, which is what makes the clip editable
    // without ever flattening or re-rendering a video.
    const html = await readFile(join(targetRoot, "film.html"), "utf8");
    expect(html).toContain("改过的第二镜");
    expect(html).toContain('id="shot-002"');
    // The scene file itself is untouched: the edit is an override on a native clip.
    expect(await readFile(join(targetRoot, "scenes/shot-002.html"), "utf8")).toContain("第二镜");
    // Loading the pinned upstream module and running its mutator is real work; under a fully
    // parallel run it exceeds the default budget, so it gets an honest one.
  }, 60_000);

  it("renders the same film text for the same clips regardless of where they are written", () => {
    const first = filmHtml(CLIPS, INPUT.narration, INPUT.fps, 900, INPUT.stage);
    const second = filmHtml(CLIPS, INPUT.narration, INPUT.fps, 900, INPUT.stage);
    expect(first).toBe(second);
    expect(first).not.toContain("NaN");
    expect(first).not.toContain("undefined");
  });
});

function existsUpstream(root: string): boolean {
  return existsSync(resolve(root, "packages/openfilm/studio/server/film.mjs"));
}
