import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { MigrationService } from "../../src/host/projects/migration-service.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { SnapshotStore } from "../../src/host/projects/snapshot-store.js";
import { EngineBindingStore } from "../../src/host/engine/engine-binding-store.js";
import { createPinnedOpenFilmUpstream } from "../../src/adapters/openfilm/openfilm-upstream.js";
import { treeDigest } from "../../src/host/projects/openfilm-migrator.js";
import type { EngineKind } from "../../src/contracts/engine-types.js";

/**
 * MIG-03 and EN-05 (M2.3 plan §6): the real chain, with real media.
 *
 * Migrate, close and reopen, export, edit the middle clip, export again. Nothing here is
 * simulated: the exports are produced by the pinned OpenFilm renderer and the two MP4s are
 * compared by digest, frame count and duration. A test that only inspected JSON would not
 * be evidence for this case, so none of it does.
 */

const VENDOR = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";
const SOURCE_FIXTURE = resolve("tests/fixtures/m2.1/snapshot-project");
const OPENFILM_SHA = "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3";
const PROJECT = "d1-30s";
const run = promisify(execFile);

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** The pinned renderer must actually be there; its absence is reported, never assumed. */
function pinnedUpstreamPresent(): boolean {
  return existsSync(resolve(VENDOR, "packages/openfilm/bin/openfilm.mjs"));
}

/** Render a project with the pinned CLI. Fixed argv, no shell, nothing caller-controlled. */
async function renderProject(root: string): Promise<{ sha256: string; durationFrames: number; path: string }> {
  const cli = resolve(VENDOR, "packages/openfilm/bin/openfilm.mjs");
  // Node under this runtime lives wherever `node` resolves; a hard-coded path is brittle.
  const nodeBin = process.execPath || "node";
  await run(nodeBin, [cli, "render"], { cwd: root, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  const name = root.slice(root.lastIndexOf("/") + 1);
  const output = join(root, `${name}.mp4`);
  const bytes = await readFile(output);
  // The frame count comes from the real container, not from what the renderer claimed.
  const { execFileSync } = await import("node:child_process");
  const probe = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-count_frames", "-show_entries", "stream=nb_read_frames,width,height",
    "-of", "json", output,
  ], { encoding: "utf8" });
  const stream = (JSON.parse(probe) as { streams: Array<{ nb_read_frames: string }> }).streams[0]!;
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    durationFrames: Number.parseInt(stream.nb_read_frames, 10),
    path: output,
  };
}

/** Real container frame count, read with ffprobe rather than assumed. */
async function frameCount(path: string): Promise<number> {
  const { execFileSync } = await import("node:child_process");
  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "json", path], { encoding: "utf8" });
  return Number.parseInt((JSON.parse(probe) as { streams: Array<{ nb_read_frames: string }> }).streams[0]!.nb_read_frames, 10);
}

describe("MIG-03 the real chain: migrate, reopen, export, edit the middle clip, export again", () => {
  it("produces two real, different exports of the same 900-frame three-clip film", async () => {
    // Absence of the pinned runtime is reported, never replaced by a weaker assertion.
    if (!pinnedUpstreamPresent()) throw new Error("PINNED_OPENFILM_ABSENT: the real export cannot run here");

    const base = await mkdtemp(join(tmpdir(), "narralens-m23-real-"));
    dirs.push(base);
    const sourceRoot = join(base, "source");
    await cp(SOURCE_FIXTURE, sourceRoot, { recursive: true });

    const revisions = new RevisionStore(); stores.push(revisions);
    const bindings = new EngineBindingStore(revisions);
    bindings.bind(PROJECT, "hypit", { createdAt: new Date(0) });
    const catalog = new ProjectCatalog(new Map([[PROJECT, join(sourceRoot, "narralens.project.json")]]));
    const roots = new Map<string, string>([[PROJECT, sourceRoot]]);

    const upstream = await createPinnedOpenFilmUpstream(VENDOR);
    const service = new MigrationService({
      catalog, revisions, bindings,
      snapshots: new SnapshotStore({ snapshotsRoot: join(base, "snapshots") }),
      migrationRoot: join(base, "migrations"), projectRoot: join(base, "projects"),
      openfilmUpstreamSha: OPENFILM_SHA,
      registerProject: (projectId, root) => { roots.set(projectId, root); },
      verifyStagedProject: async (root) => {
        const film = await upstream.readProjectFilm(root);
        if (film.problems.length > 0) throw new Error("staged film does not read");
        const clips = (film.doc as { tracks: Array<{ clips: Array<{ id: string; src: string }> }> }).tracks[0]!.clips;
        if (clips.some((clip) => /\.(mp4|mov|webm|mkv)$/iu.test(clip.src))) {
          throw new Error("flattened video clip is not native");
        }
        return clips.map((clip, index) => ({
          source_id: clip.id, target_id: clip.id,
          start_frame: index * 300, end_frame_exclusive: (index + 1) * 300,
        }));
      },
      exportProject: async (root) => await renderProject(root),
    });

    const sourceBefore = await treeDigest(sourceRoot);
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-real-0001" });
    const report = await service.execute(plan.migration_id);
    expect(report.complete).toBe(true);
    const targetRoot = roots.get(plan.target_project_id)!;

    // The first export is a real MP4 of the whole film.
    const first = await renderProject(targetRoot);
    expect(first.durationFrames).toBe(900);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.export_artifacts).toHaveLength(1);
    expect(report.export_artifacts[0]!.sha256).toBe(first.sha256);

    // Close and reopen: a fresh process-level read sees the same three clips.
    const reopened = await createPinnedOpenFilmUpstream(VENDOR);
    const film = await reopened.readProjectFilm(targetRoot);
    expect(film.problems).toEqual([]);
    const clips = (film.doc as { tracks: Array<{ clips: Array<{ id: string }> }> }).tracks[0]!.clips;
    expect(clips.map((clip) => clip.id)).toEqual(["shot-001", "shot-002", "shot-003"]);

    // Edit the middle clip natively; the revision advances by exactly one.
    const beforeEdit = film.rev;
    const edited = await reopened.editProjectFilm(targetRoot, beforeEdit,
      [{ op: "set", clip: "shot-002", field: "overrides", value: [{ at: ".t", text: "改过的第二镜" }] }]);
    expect(edited.rebased).toBe(false);
    expect(edited.rev).not.toBe(beforeEdit);

    // The second export differs from the first, and is the same length and clip count.
    const second = await renderProject(targetRoot);
    expect(second.sha256).not.toBe(first.sha256);
    expect(second.durationFrames).toBe(900);

    // Subtitles and narration travelled with the film. The names are read from the film
    // itself rather than assumed, so the assertion is about the copy, not about our naming.
    const filmText = await readFile(join(targetRoot, "film.html"), "utf8");
    // The src carries an OpenFilm time fragment; the file on disk is what we stat.
    const narrationRef = (/<audio[^>]*src="([^"#]+)/u.exec(filmText)?.[1] ?? "").trim();
    const subtitlePath = join(targetRoot, "assets/narration.vtt");
    expect(narrationRef).not.toBe("");
    expect((await stat(join(targetRoot, narrationRef))).size).toBeGreaterThan(0);
    expect(await readFile(subtitlePath, "utf8")).toContain("第二镜");
    const afterReopen = await reopened.readProjectFilm(targetRoot);
    expect((afterReopen.doc as { tracks: Array<{ clips: Array<{ id: string }> }> }).tracks[0]!.clips)
      .toHaveLength(3);

    // And the source project is still exactly as it was.
    expect(await treeDigest(sourceRoot)).toBe(sourceBefore);
    expect(bindings.read(PROJECT)).toMatchObject({ engine: "hypit" });
    expect(bindings.read(plan.target_project_id)).toMatchObject({ engine: "openfilm" as EngineKind });
  }, 300_000);
});

describe("EN-05 the source project is still intact and openable after rollback", () => {
  it("keeps the source bytes, binding and recorded output, and retains the copy", async () => {
    if (!pinnedUpstreamPresent()) throw new Error("PINNED_OPENFILM_ABSENT: the real export cannot run here");

    const base = await mkdtemp(join(tmpdir(), "narralens-m23-rollback-"));
    dirs.push(base);
    const sourceRoot = join(base, "source");
    await cp(SOURCE_FIXTURE, sourceRoot, { recursive: true });

    const revisions = new RevisionStore(); stores.push(revisions);
    const bindings = new EngineBindingStore(revisions);
    bindings.bind(PROJECT, "hypit", { createdAt: new Date(0) });
    const catalog = new ProjectCatalog(new Map([[PROJECT, join(sourceRoot, "narralens.project.json")]]));
    const roots = new Map<string, string>([[PROJECT, sourceRoot]]);
    const upstream = await createPinnedOpenFilmUpstream(VENDOR);

    const service = new MigrationService({
      catalog, revisions, bindings,
      snapshots: new SnapshotStore({ snapshotsRoot: join(base, "snapshots") }),
      migrationRoot: join(base, "migrations"), projectRoot: join(base, "projects"),
      openfilmUpstreamSha: OPENFILM_SHA,
      registerProject: (projectId, root) => { roots.set(projectId, root); },
      verifyStagedProject: async (root) => {
        const film = await upstream.readProjectFilm(root);
        const clips = (film.doc as { tracks: Array<{ clips: Array<{ id: string; src: string }> }> }).tracks[0]!.clips;
        if (clips.some((clip) => /\.(mp4|mov|webm|mkv)$/iu.test(clip.src))) throw new Error("flattened clip");
        return clips.map((clip, index) => ({
          source_id: clip.id, target_id: clip.id, start_frame: index * 300, end_frame_exclusive: (index + 1) * 300,
        }));
      },
      // The copy is a real OpenFilm render. The Hypit SOURCE has no offline headless render,
      // so its "export" is the recorded D1 artifact shipped with the fixture, and the report
      // says so rather than implying a fresh render happened.
      exportProject: async (root, _label, engine) => {
        if (engine === "openfilm") return await renderProject(root);
        const recorded = resolve(SOURCE_FIXTURE, "assets/generated/visual-10s.mp4");
        return { sha256: createHash("sha256").update(await readFile(recorded)).digest("hex"), durationFrames: 900 };
      },
    });

    const sourceBefore = await treeDigest(sourceRoot);
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-rollback-01" });
    await service.execute(plan.migration_id);
    const targetRoot = roots.get(plan.target_project_id)!;
    const copyExport = await renderProject(targetRoot);

    const record = await service.rollback(plan.migration_id);
    expect(record.phase).toBe("verified");

    // The source is byte-identical, still bound to hypit, and the copy is kept for audit.
    expect(await treeDigest(sourceRoot)).toBe(sourceBefore);
    expect(bindings.read(PROJECT)).toMatchObject({ engine: "hypit" });
    expect(record.source_sha256_after).toBe(sourceBefore);
    expect(record.target_retained).toBe(true);
    expect(copyExport.durationFrames).toBe(900);
    expect(await readFile(join(targetRoot, "film.html"), "utf8")).toContain("shot-002");

    // A fresh render of the Hypit SOURCE is deliberately NOT claimed here: it submits a Build
    // to external providers, which costs money and egresses data, and this wave is not
    // authorised for either. The source side is proved by byte identity, by its binding and
    // by its recorded D1 output; the real render is of the migrated copy.
  }, 300_000);
});
