import { afterEach, describe, expect, it } from "vitest";
import { planDigest } from "../../../src/host/materialize/native-plan-builder.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import { validateControlledWriteResponse } from "../../../src/contracts/validator.js";
import { NarralensHost } from "../../../src/host/server.js";
import { SimulatedAdoptionCrash } from "../../../src/host/adoption/adoption-coordinator.js";
import {
  adoptBody, coveringPlan, headers, migrate, postImpact, readyMaterialization,
  start, startOn, stopAll, type Started,
} from "../m4a/harness.js";

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
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

describe("M4B production adoption route", () => {
  it("adopts three native clips once, replays exactly, and rebuilds after restart", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view, materialization, request } = await authorizedAdoption(running, "happy");
    const committed = await postAdoption(running, projectId, request);
    expect(committed.status, JSON.stringify({ body: committed.body,
      materialization: running.host.materializations.require(materialization.materialization_id) })).toBe(200);
    expect(validateControlledWriteResponse(committed.body).ok).toBe(true);
    expect(committed.body).toMatchObject({ previous_revision: 1, new_revision: 2, status: "committed" });
    expect(committed.body.source_digest).not.toBe(view.source_digest);
    expect(await postAdoption(running, projectId, request)).toEqual(committed);

    const current = await running.host.projectResolver.resolveActivated(projectId);
    expect(current.revision).toBe(2);
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
  }, 900_000);
});
