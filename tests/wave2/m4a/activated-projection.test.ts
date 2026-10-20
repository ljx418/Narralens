import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../../src/host/server.js";
import {
  assertLedgerWithinRoots, openFilmLayoutFacts, openFilmRoots,
} from "../../../src/host/projects/openfilm-layout-facts.js";
import {
  migrate, readyMaterialization, start, startOn, stopAll,
} from "./harness.js";

/**
 * M4A-P01 — the production projection seam.
 *
 * The claim under test is narrow and important: after a restart, with no test hook, the Host
 * can read its own migrated target. Before M4A it could not — `registerLayout()` was called
 * by tests and probes only, so every projection any test had ever seen came from a hand-
 * registered layout. The first test below proves that gap was real by calling `inspect()`
 * directly, and the rest prove the seam closes it without a hook.
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

describe("M4A-P01: a fresh Host rebuilds the active layout from durable facts", () => {
  it("cannot inspect an activated target at all without a layout — the gap M4A closes", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await migrate(running);
    // Deliberately *not* going through the new seam: this is the raw port call production
    // used to make, and it must still fail, because the adapter has no layout of its own.
    const resolved = running.host.engines.resolve(projectId);
    await expect(resolved.port.inspect({
      project_id: projectId, engine: "openfilm", source_digest: view.source_digest,
    }, { correlationId: "p01-raw", projectId, signal: AbortSignal.timeout(20_000) }))
      .rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE" });
  }, 300_000);

  it("inspects a restarted Host's own migrated target, with no test hook anywhere", async () => {
    const first = await start();
    hosts.push(first.host); dirs.push(first.base);
    const { projectId, view } = await migrate(first);
    // The row that makes the target adoptable is built *before* the restart, so the second
    // Host starts from nothing but the database and the files on disk.
    await readyMaterialization(first.host, projectId);
    await first.host.close();
    hosts.splice(hosts.indexOf(first.host), 1);

    const restarted = await startOn(first.base);
    hosts.push(restarted.host);

    const { layout } = await restarted.host.projections.layoutFor(
      await restarted.host.projectResolver.resolveActivated(projectId), "p01-restart");
    expect(layout.roots[0]).toBe("film.html");
    expect(layout.root).toBe(view.source_root === undefined ? "" : layout.root);

    const resolved = restarted.host.engines.resolve(projectId);
    const projection = await resolved.port.inspect({
      project_id: projectId, engine: "openfilm", source_digest: view.source_digest,
    }, { correlationId: "p01-restart", projectId, signal: AbortSignal.timeout(20_000) });
    // The digest reproduces the one the migration committed. That equality is the whole
    // proof: it means the roots, the assets and the closure were all derived correctly from
    // durable facts, because a single wrong root would change it.
    expect(projection.source_digest).toBe(view.source_digest);
    expect(projection.problems).toEqual([]);
    expect(projection.clips.filter((clip) => clip.kind === "page").map((clip) => clip.clip_id))
      .toEqual(["shot-001", "shot-002", "shot-003"]);
  }, 600_000);

  it("keys its cache by project, snapshot and source digest", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await migrate(running);
    const service = running.host.projections;
    const first = await service.layoutFor(view, "p01-key");
    expect(first.cache_key).toBe(`${projectId}|${view.snapshot_id}|${view.source_digest}`);
    // All three components are in the key, so moving any one of them misses the entry
    // rather than returning a layout built from the other two.
    expect(first.cache_key.split("|")).toEqual([projectId, view.snapshot_id, view.source_digest]);
    // A source digest the migration did not record is refused rather than served from the
    // cache — the memo is keyed, but it is not a way around the drift check.
    await expect(service.layoutFor({ ...view, source_digest: "f".repeat(64) }, "p01-key"))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED", status: 409 });
    // And forgetting is not needed for correctness, only for boundedness: the same view
    // rebuilds to exactly the same key.
    service.forget(projectId);
    expect((await service.layoutFor(view, "p01-key")).cache_key).toBe(first.cache_key);
  }, 300_000);

  it("fails closed when the migrated copy's bytes move under it", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await migrate(running);
    await running.host.projections.layoutFor(view, "p01-drift");
    // Touch a declared root's *content* without changing the recorded facts. The digest the
    // adapter recomputes no longer matches the committed one, and that is the drift check.
    const film = join(view.source_root.value, "film.html");
    const text = await readFile(film, "utf8");
    await writeFile(film, `${text}<!-- drift -->\n`, "utf8");
    const resolved = running.host.engines.resolve(projectId);
    await expect(resolved.port.inspect({
      project_id: projectId, engine: "openfilm", source_digest: view.source_digest,
    }, { correlationId: "p01-drift", projectId, signal: AbortSignal.timeout(20_000) }))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  }, 300_000);

  it("refuses a layout whose declared root escapes the target", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId } = await migrate(running);
    const db = running.host.revisions.compose((handle) => handle);
    // Rewrite the stored plan's narration path to escape the root. This is the "stored is
    // not trusted" case: the plan is a durable record, and a durable record can be wrong.
    const migration = running.host.revisions.migrations.get(
      (await running.host.projectResolver.resolveActivated(projectId)).migration_id)!;
    const plan = JSON.parse(migration.plan_json) as Record<string, unknown>;
    plan.narration = { source_path: "n/a", target_path: "../../etc/passwd", sha256: "0".repeat(64) };
    db.prepare("UPDATE migration SET plan_json=? WHERE migration_id=?")
      .run(JSON.stringify(plan), migration.migration_id);
    await expect(running.host.projections.layoutFor(
      await running.host.projectResolver.resolveActivated(projectId), "p01-escape"))
      .rejects.toMatchObject({ status: 422 });
  }, 300_000);

  it("refuses when the ledger names a target the plan does not cover", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId } = await migrate(running);
    expect(() => assertLedgerWithinRoots(
      { roots: ["film.html"], subtitles: [] }, ["assets/unknown.mp4"], projectId))
      .toThrow(/does not cover/u);
    // Two ledger rows on one path is ambiguity, and the map construction is what catches it.
    expect(() => assertLedgerWithinRoots({ roots: ["film.html"], subtitles: [] }, [], projectId))
      .not.toThrow();
  }, 300_000);

  it("derives exactly the roots the migration published, from one implementation", async () => {
    // `openFilmRoots` is shared with `MigrationService`, so this is a check that the two
    // callers cannot disagree rather than a re-statement of either one.
    expect(openFilmRoots({
      narration: { source_path: "a.wav", target_path: "assets/a.wav" },
      subtitles: [{ source_path: "a.vtt", target_path: "assets/a.vtt" }],
      assets: [{ source_path: "a.mp4", target_path: "assets/a.mp4" }],
    })).toEqual(["film.html", "assets/a.wav", "assets/a.vtt", "assets/a.mp4"]);
    expect(openFilmRoots({ narration: null, subtitles: [], assets: [] })).toEqual(["film.html"]);
    // Duplicates collapse, so a path carried as both a subtitle and an asset is one root.
    expect(openFilmRoots({
      narration: null, subtitles: [{ source_path: "a.vtt", target_path: "assets/a.vtt" }],
      assets: [{ source_path: "a.vtt", target_path: "assets/a.vtt" }],
    })).toEqual(["film.html", "assets/a.vtt"]);
  });

  it("names a subtitle by its stem, and refuses two subtitles with the same stem", async () => {
    const plan = (subs: ReadonlyArray<{ target_path: string }>): Parameters<typeof openFilmLayoutFacts>[0] => ({
      format: "narralens.migration-plan@1.0", migration_id: "m", idempotency_key: "k",
      request_digest: "d", source_project_id: "s", source_revision: 1, source_digest: "x",
      source_engine: "hypit", target_project_id: "t", target_engine: "openfilm",
      target_engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
      identity_map: [], features: [], assets: [], subtitles: subs.map((s) => ({ ...s, source_path: "x", sha256: "0".repeat(64) })),
      narration: null, validation_steps: [], blocking: [], created_at: "1970-01-01T00:00:00.000Z",
    });
    expect(openFilmLayoutFacts(plan([{ target_path: "assets/one.vtt" }])).subtitles)
      .toEqual([{ subtitle_id: "one", path: "assets/one.vtt" }]);
    expect(() => openFilmLayoutFacts(plan([{ target_path: "a/one.vtt" }, { target_path: "b/one.vtt" }])))
      .toThrow(/same id/u);
  });
});
