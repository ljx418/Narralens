import { afterEach, describe, expect, it } from "vitest";
import { authHeaders, migrate, start, stopAll, type Started } from "./harness.js";
import { NarralensHost } from "../../src/host/server.js";
import type { WorkbenchProjectionV1 } from "../../src/contracts/wave3-types.js";

/**
 * M5's workbench read model (Wave 3 `01` §4.1, `04` §3 and §6).
 *
 * The claim under test is narrow and load-bearing: the workbench projection is built
 * from the *activated* seam — `resolveActivated` → `layoutFor` → `inspect` — over a real
 * migrated OpenFilm target, and it publishes the target's clips, the unique source-shot
 * lineage and the Gateway's preview, and nothing else.
 *
 * Every negative assertion here is about what the projection must *not* contain: no path,
 * no token, no adapter class name, no second timeline.
 */
const hosts: NarralensHost[] = [];
const dirs: string[] = [];

afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

async function migrated(): Promise<{ running: Started; projectId: string }> {
  const running = await start();
  hosts.push(running.host);
  dirs.push(running.base);
  const target = await migrate(running, "m5-workbench-1");
  return { running, projectId: target.projectId };
}

async function workbench(running: Started, projectId: string): Promise<{
  status: number; body: WorkbenchProjectionV1;
}> {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/workbench`,
    { headers: authHeaders(running.origin, running.token) });
  const text = await response.text();
  return { status: response.status, body: (text === "" ? {} : JSON.parse(text)) as WorkbenchProjectionV1 };
}

describe("M5 workbench: the read model over a real migrated target", () => {
  it("publishes the target's own projection, its source lineage and the Gateway's preview", async () => {
    const { running, projectId } = await migrated();
    const response = await workbench(running, projectId);
    expect(response.status).toBe(200);

    const body = response.body;
    // The identity rule: `project_id` is the target, `source_project_id` is the legacy
    // project it came from, and the two are never the same.
    expect(body.project_id).toBe(projectId);
    expect(body.source_project_id).toBe("d1-30s");
    expect(body.migration_id).toMatch(/^mig_/u);
    expect(body.format).toBe("narralens.workbench@1.0");
    expect(body.engine).toBe("openfilm");
    expect(body.engine_upstream_sha).toBe("e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3");

    // The clips come from the upstream's own parse of the migrated film, and every one of
    // them keeps the source shot's id — the migrator's invariant, not a re-derived string.
    expect(body.clips.length).toBeGreaterThan(0);
    const clipIds = body.clips.map((clip) => clip.clip_id);
    expect(new Set(clipIds).size).toBe(clipIds.length);
    for (const clip of body.clips) {
      // A clip that came from a source shot keeps that shot's id; a clip that did not —
      // the narration track — carries `null` rather than a guess.
      if (clip.kind === "page") expect(clip.source_shot_id).toBe(clip.clip_id);
      else expect(clip.source_shot_id).toBeNull();
      expect(clip.start_frame).toBeGreaterThanOrEqual(0);
      expect(clip.end_frame_exclusive).toBeGreaterThan(clip.start_frame);
    }
    // The three fixture shots are the three migrated page clips, by the migrator's id.
    expect(body.clips.filter((clip) => clip.kind === "page").map((clip) => clip.source_shot_id))
      .toEqual(["shot-001", "shot-002", "shot-003"]);
    // The tracks only name clips that exist.
    const known = new Set(clipIds);
    for (const track of body.tracks) {
      for (const clipId of track.clip_ids) expect(known.has(clipId)).toBe(true);
    }

    // The preview is the Gateway's descriptor, not the adapter's 404 placeholder.
    expect(body.preview.kind).toBe("openfilm-studio");
    expect(body.preview.bridge_version).toBe(1);
    expect(body.preview.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/projects\//u);

    // The history is the Host's own read model, and the migration is its first entry.
    expect(body.history.length).toBeGreaterThan(0);
    expect(body.history[0]!.kind).toBe("migration");

    // The capability map is the OpenFilm one: exactly four supported entries.
    const supported = body.capabilities.filter((entry) => entry.state === "supported")
      .map((entry) => entry.entry_id).sort();
    expect(supported).toEqual([
      "history.redo", "history.restore", "history.undo", "timeline.adopt_materialization",
    ]);
    // `set_visual_fit` and `replace_visual_asset` stay blocked on OpenFilm.
    for (const blocked of ["timeline.set_visual_fit", "timeline.replace_visual_asset"]) {
      expect(body.capabilities.find((entry) => entry.entry_id === blocked)!.state).toBe("blocked");
    }
  }, 300_000);

  it("publishes no path, no token and no adapter class name", async () => {
    const { running, projectId } = await migrated();
    const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/workbench`,
      { headers: authHeaders(running.origin, running.token) });
    const text = await response.text();
    // The machine's layout: the migration root, the temporary tree, an absolute path.
    expect(text).not.toMatch(/"\/mnt\/|"\/tmp\/|narralens-m4a-/u);
    // The session token is a credential and must never travel in a read model.
    expect(text).not.toContain(running.token);
    // The adapter's class name is internal.
    expect(text).not.toMatch(/OpenFilmEngineAdapter|ProposalComparisonAdapter/u);
  }, 300_000);

  it("refuses a project that was never migrated, and one that does not exist", async () => {
    const running = await start();
    hosts.push(running.host);
    dirs.push(running.base);
    // The legacy catalog project is not an activated target: the workbench must not
    // resolve it through the catalog and pretend it is one.
    const legacy = await workbench(running, "d1-30s");
    expect(legacy.status).toBe(404);
    const missing = await workbench(running, "of_no_such_project");
    expect(missing.status).toBe(404);
  }, 300_000);
});
