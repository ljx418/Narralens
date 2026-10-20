import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { planDigest } from "../../../src/host/materialize/native-plan-builder.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import { validateControlledWriteResponse } from "../../../src/contracts/validator.js";
import { NarralensHost } from "../../../src/host/server.js";
import { SimulatedAdoptionCrash } from "../../../src/host/adoption/adoption-coordinator.js";
import { createPinnedOpenFilmUpstream } from "../../../src/adapters/openfilm/openfilm-upstream.js";
import {
  adoptBody, coveringPlan, headers, migrate, postImpact, readyMaterialization,
  start, startOn, stopAll, type Started,
} from "../m4a/harness.js";

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
const VENDOR = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";
const run = promisify(execFile);
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

function stableThreeClipPlan(running: Started, projectId: string): NativePlanV1 {
  const base = coveringPlan(running.host, projectId, 900, 3);
  const spec = { ...base, clips: base.clips.map((clip, index) => ({ ...clip, clip_id: `shot-00${index + 1}` })) };
  const { plan_sha256: _old, ...preimage } = spec;
  return { ...preimage, plan_sha256: planDigest(preimage) };
}

async function authorizedAdoption(running: Started, suffix: string) {
  const { projectId, view } = await migrate(running, `m4b-migrate-${suffix}`);
  const materialization = await readyMaterialization(running.host, projectId, `m4b-materialize-${suffix}`,
    stableThreeClipPlan(running, projectId));
  const impact = await postImpact(running, projectId,
    adoptBody(view, materialization.materialization_id, `m4b-impact-${suffix}`));
  expect(impact.status, JSON.stringify(impact.body)).toBe(201);
  return { projectId, view, materialization, request: {
    format: "narralens.adopt-request@1.0", base_revision: view.revision,
    expected_source_digest: view.source_digest, control_revision: view.control_revision,
    materialization_id: materialization.materialization_id,
    impact_id: impact.body.impact_id, impact_hash: impact.body.impact_hash,
    approval: { confirmed: true }, idempotency_key: `m4b-write-${suffix}`,
  } };
}

async function postAdoption(running: Started, projectId: string, request: object) {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/edits`, {
    method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(request),
  });
  return { status: response.status, body: JSON.parse(await response.text()) as Record<string, unknown> };
}

async function render(root: string): Promise<{ digest: string; frames: number }> {
  await run(process.execPath || "node", [resolve(VENDOR, "packages/openfilm/bin/openfilm.mjs"), "render"],
    { cwd: root, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  const output = join(root, `${basename(root)}.mp4`);
  const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=nb_read_frames", "-of", "json", output], { timeout: 60_000 });
  return { digest: createHash("sha256").update(await readFile(output)).digest("hex"),
    frames: Number.parseInt((JSON.parse(probe.stdout) as { streams: Array<{ nb_read_frames: string }> }).streams[0]!.nb_read_frames, 10) };
}

describe("M4B production adoption route", () => {
  it("returns 428 before resource lookup when impact or approval is missing", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    for (const body of [{}, { impact_id: "imp_missing", impact_hash: "0".repeat(64) }]) {
      const response = await postAdoption(running, "d1-30s", body);
      expect(response.status).toBe(428);
      expect(response.body.code).toBe("IMPACT_REQUIRED");
    }
    expect(running.host.revisions.projectTransactions("d1-30s")).toEqual([]);
  });

  it("adopts three native clips once, replays exactly, and rebuilds after restart", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view, materialization, request } = await authorizedAdoption(running, "happy");
    const [committed, concurrentReplay] = await Promise.all([
      postAdoption(running, projectId, request), postAdoption(running, projectId, request),
    ]);
    expect(committed.status, JSON.stringify({ body: committed.body,
      materialization: running.host.materializations.require(materialization.materialization_id) })).toBe(200);
    expect(validateControlledWriteResponse(committed.body).ok).toBe(true);
    expect(committed.body).toMatchObject({ previous_revision: 1, new_revision: 2, status: "committed" });
    expect(committed.body.source_digest).not.toBe(view.source_digest);
    expect(concurrentReplay).toEqual(committed);
    expect(await postAdoption(running, projectId, request)).toEqual(committed);

    const current = await running.host.projectResolver.resolveActivated(projectId);
    expect(current.revision).toBe(2);
    expect((await running.host.assetInventory.inventory(projectId)).assets.length).toBeGreaterThanOrEqual(2);
    expect(running.host.assetLedger.bootstrapRecord(projectId)?.state).toBe("active");
    const layout = await running.host.projections.layoutFor(current, "m4b-route-test");
    for (const clip of materialization.native_plan!.clips) {
      expect(layout.layout.roots).toContain(`assets/${clip.asset_sha256}/source.mp4`);
    }
    const engine = running.host.engines.resolve(projectId);
    const projection = await engine.port.inspect({ project_id: projectId, engine: "openfilm",
      source_digest: current.source_digest }, { projectId, correlationId: "m4b-route-test",
      signal: AbortSignal.timeout(20_000) });
    expect(projection.problems).toEqual([]);
    expect(projection.clips.filter((clip) => clip.kind !== "sound").map((clip) => clip.clip_id))
      .toEqual(["shot-001", "shot-002", "shot-003"]);

    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    const restartedView = await restarted.host.projectResolver.resolveActivated(projectId);
    const restartedLayout = await restarted.host.projections.layoutFor(restartedView, "m4b-restart-test");
    expect(restartedView).toMatchObject({ revision: 2, source_digest: committed.body.source_digest });
    expect(restartedLayout.layout.roots).toEqual(layout.layout.roots);

    // TX-11B/TX-14: the adopted author source really renders, and remains a native film
    // whose middle clip can be edited without replacing either neighbouring identity.
    const first = await render(restartedView.source_root.value);
    expect(first.frames).toBe(900);
    const upstream = await createPinnedOpenFilmUpstream(VENDOR);
    const beforeNativeEdit = await upstream.readProjectFilm(restartedView.source_root.value);
    const beforeIds = (beforeNativeEdit.doc as { tracks: Array<{ clips: Array<{ id: string }> }> })
      .tracks[0]!.clips.map((clip) => clip.id);
    const edited = await upstream.editProjectFilm(restartedView.source_root.value, beforeNativeEdit.rev,
      [{ op: "set", clip: "shot-002", field: "overrides", value: [{ fade: [0.2, 0.2] }] }]);
    expect(edited.rebased).toBe(false);
    const afterNativeEdit = await upstream.readProjectFilm(restartedView.source_root.value);
    const afterIds = (afterNativeEdit.doc as { tracks: Array<{ clips: Array<{ id: string }> }> })
      .tracks[0]!.clips.map((clip) => clip.id);
    expect(beforeIds).toEqual(["shot-001", "shot-002", "shot-003"]);
    expect(afterIds).toEqual(beforeIds);
    const second = await render(restartedView.source_root.value);
    expect(second.frames).toBe(900);
    expect(second.digest).not.toBe(first.digest);
  }, 900_000);

  it.each([
    ["after_prepared", "aborted", 1, 500],
    ["after_published", "committed", 2, 200],
    ["after_committed", "committed", 2, 200],
  ] as const)("recovers a simulated crash at %s to one durable outcome", async (boundary, state, revision, status) => {
    const running = await start({ adoptionFault: (point) => {
      if (point === boundary) throw new SimulatedAdoptionCrash(`CRASH:${point}`);
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, boundary);
    expect((await postAdoption(running, prepared.projectId, prepared.request)).status).toBe(500);
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    const replay = await postAdoption(restarted, prepared.projectId, prepared.request);
    expect(replay.status, JSON.stringify(replay.body)).toBe(status);
    expect(replay.body.status).toBe(state);
    expect((await restarted.host.projectResolver.resolveActivated(prepared.projectId)).revision).toBe(revision);
    expect(restarted.host.revisions.projectsInAttention()).not.toContain(prepared.projectId);
    expect(await postAdoption(restarted, prepared.projectId, prepared.request)).toEqual(replay);
    const conflict = await postAdoption(restarted, prepared.projectId,
      { ...prepared.request, base_revision: prepared.view.revision + 1 });
    expect(conflict.status).toBe(409);
  }, 900_000);

  it("rejects a visual lock acquired after staging with revision +0", async () => {
    let host: NarralensHost | undefined;
    let projectId = "";
    const running = await start({ adoptionFault: (point) => {
      if (point === "after_prepared") {
        host!.locks.acquire({ projectId, lockType: "visual", scope: "shot", targetId: "shot-002",
          startFrame: 300, endFrameExclusive: 600, owner: "race", reason: "TX-13" }, 1);
      }
    } });
    host = running.host;
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, "lock-race");
    projectId = prepared.projectId;
    const rejected = await postAdoption(running, projectId, prepared.request);
    expect(rejected.status).toBe(428);
    expect(rejected.body).toMatchObject({ status: "aborted", previous_revision: 1, new_revision: 1 });
    expect((await running.host.projectResolver.resolveActivated(projectId)).revision).toBe(1);
    expect(running.host.revisions.projectTransactions(projectId).at(-1)?.state).toBe("aborted");
  }, 900_000);
});
