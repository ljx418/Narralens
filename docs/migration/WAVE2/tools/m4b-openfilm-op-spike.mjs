import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [vendorArg, projectArg, mediaArg] = process.argv.slice(2);
if (!vendorArg || !projectArg || !mediaArg) {
  console.error("usage: node m4b-openfilm-op-spike.mjs <vendor-root> <project-root> <media.mp4>");
  process.exit(2);
}

const vendor = resolve(vendorArg);
const project = resolve(projectArg);
const media = resolve(mediaArg);
const scratch = await mkdtemp(join(tmpdir(), "narralens-m4b-op-"));

try {
  await cp(project, scratch, { recursive: true });
  const bytes = await readFile(media);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const target = join(scratch, "assets", sha256);
  await mkdir(target, { recursive: true });
  await cp(media, join(target, "source.mp4"));

  const filmModule = join(vendor, "packages", "openfilm", "studio", "server", "film.mjs");
  const { readProjectFilm, editProjectFilm } = await import(pathToFileURL(filmModule).href);
  const before = await readProjectFilm(scratch);
  assert.deepEqual(before.problems, []);
  const visualIds = ["shot-01", "shot-02", "shot-03"];
  const src = `assets/${sha256}/source.mp4`;
  const ops = visualIds.flatMap((clip) => [
    { op: "set", clip, field: "src", value: src },
    { op: "set", clip, field: "time", value: [0, 10] },
    { op: "set", clip, field: "overrides", value: null },
  ]);
  const edited = await editProjectFilm(scratch, before.rev, ops);
  const after = await readProjectFilm(scratch);
  assert.equal(edited.rebased, false);
  assert.deepEqual(after.problems, []);
  const clips = after.value.tracks.flatMap((track) => track.clips);
  const visual = clips.filter((clip) => visualIds.includes(clip.id));
  assert.equal(visual.length, 3);
  assert.deepEqual(visual.map((clip) => clip.id), visualIds);
  assert.deepEqual(visual.map((clip) => clip.at ?? 0), [0, 10, 20]);
  assert.ok(clips.some((clip) => clip.id === "narration"));

  console.log(JSON.stringify({
    format: "narralens.m4b-openfilm-op-spike@1.0",
    vendor_root_basename: basename(vendor),
    media_sha256: sha256,
    operation_count: ops.length,
    rebased: edited.rebased,
    read_problems: after.problems,
    stage: after.value.stage,
    visual: visual.map(({ id, src: clipSrc, time, at }) => ({ id, src: clipSrc, time, at: at ?? 0 })),
    narration_preserved: clips.some((clip) => clip.id === "narration"),
    status: "PASS",
  }, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
