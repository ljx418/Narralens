import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { planDigest } from "../../../src/host/materialize/native-plan-builder.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import { validateControlledWriteResponse } from "../../../src/contracts/validator.js";
import { defaultAdoptionStagingRoot, NarralensHost } from "../../../src/host/server.js";
import { SimulatedAdoptionCrash } from "../../../src/host/adoption/adoption-coordinator.js";
import type { PublishBoundary } from "../../../src/host/adoption/author-source-publisher.js";
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
  }, 900_000);


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

  it("latches terminal attention when recovery can prove neither publication boundary", async () => {
    const running = await start({ adoptionPublishFault: (point) => {
      if (point === "film_renamed") throw new SimulatedAdoptionCrash("PUBLISH_CRASH:film_renamed");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, "publish-unprovable");
    const sourceRoot = (await running.host.projectResolver.resolveActivated(prepared.projectId)).source_root.value;
    expect((await postAdoption(running, prepared.projectId, prepared.request)).status).toBe(500);
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    // Model external damage after atomic publication but before the database commit. Recovery
    // must not guess whether before or after won.
    await writeFile(join(sourceRoot, "film.html"), "<!doctype html><title>unprovable</title>\n");
    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    expect(restarted.host.revisions.projectsInAttention()).toContain(prepared.projectId);
    const transaction = restarted.host.revisions.projectTransactions(prepared.projectId).at(-1);
    expect(transaction).toMatchObject({ state: "attention", error_code: "ADOPTION_RECOVERY_UNPROVABLE" });
    expect(transaction?.terminal_reason).toContain("neither adoption boundary");
    const blocked = await postAdoption(restarted, prepared.projectId,
      { ...prepared.request, idempotency_key: "m4b-after-attention" });
    expect(blocked.status).toBe(423);
    expect(blocked.body.code).toBe("PROJECT_ATTENTION_REQUIRED");
  }, 900_000);

  it("starts again after latching terminal attention, because one blocked project must not stop the Host", async () => {
    // The attention latch is a *project* condition. It used to be a *Host* condition as well:
    // the M4B recovery re-entered transactions that were already terminal, the recovery gate
    // then refused them, and that refusal was thrown outside the recovery's own error
    // handling — so it propagated out of `listen()` and the Host did not start. Every other
    // project in the deployment went down with it.
    const running = await start({ adoptionPublishFault: (point) => {
      if (point === "film_renamed") throw new SimulatedAdoptionCrash("PUBLISH_CRASH:film_renamed");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, "attention-restart");
    const sourceRoot = (await running.host.projectResolver.resolveActivated(prepared.projectId)).source_root.value;
    expect((await postAdoption(running, prepared.projectId, prepared.request)).status).toBe(500);
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    await writeFile(join(sourceRoot, "film.html"), "<!doctype html><title>unprovable</title>\n");

    // First restart: the recovery cannot prove either publication boundary, so it latches
    // terminal attention on this project.
    const first = await startOn(running.base);
    hosts.push(first.host);
    expect(first.host.revisions.projectsInAttention()).toContain(prepared.projectId);
    await first.host.close();
    hosts.splice(hosts.indexOf(first.host), 1);

    // Second restart: the Host must come up. The project is still closed for writes — that
    // is the point of the attention — but a latched condition on one project is not a reason
    // to refuse to serve every other project.
    const second = await startOn(running.base);
    hosts.push(second.host);
    expect(second.host.revisions.projectsInAttention()).toContain(prepared.projectId);
    // And the blocked project is still blocked, rather than silently reopened.
    const blocked = await postAdoption(second, prepared.projectId,
      { ...prepared.request, idempotency_key: "m4b-attention-restart-blocked" });
    expect(blocked.status).toBe(423);
    expect(blocked.body.code).toBe("PROJECT_ATTENTION_REQUIRED");
  }, 900_000);

  it.each([
    ["asset_temp_fsynced", "aborted", 1, 500],
    ["asset_installed", "aborted", 1, 500],
    ["film_temp_fsynced", "aborted", 1, 500],
    ["film_renamed", "committed", 2, 200],
    ["parent_fsynced", "committed", 2, 200],
  ] as const)("recovers the author-source publication boundary %s", async (boundary, state, revision, status) => {
    const running = await start({ adoptionPublishFault: (point: PublishBoundary) => {
      if (point === boundary) throw new SimulatedAdoptionCrash(`PUBLISH_CRASH:${point}`);
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, `publish-${boundary}`);
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
    // `TARGET_LOCKED`, not a stale impact. Acquiring a lock moves the control revision, and
    // the control revision is one of the facts a currentness check re-reads — so a currentness
    // check first would answer this as `IMPACT_STALE`, and the lock check would be a line
    // nothing could ever reach. The lock is now checked first, so it is the lock that is
    // reported, and removing the lock check changes this answer.
    expect(rejected.status).toBe(423);
    expect((rejected.body.error as { code?: string } | undefined)?.code).toBe("TARGET_LOCKED");
    expect(rejected.body).toMatchObject({ status: "aborted", previous_revision: 1, new_revision: 1 });
    expect((await running.host.projectResolver.resolveActivated(projectId)).revision).toBe(1);
    expect(running.host.revisions.projectTransactions(projectId).at(-1)?.state).toBe("aborted");
  }, 900_000);

  it("does not over-block an adoption that preserves narration while a narration lock is held", async () => {
    // The other half of TX-03. A narration lock is not a lock this adoption touches — the
    // plan preserves narration — so it must not block it. The lock is taken *before* the
    // impact, so the control revision has already moved when the impact is computed and the
    // adoption is prepared against current facts; a lock taken afterwards would move the
    // control revision under the request, which is drift of a different kind.
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await migrate(running, "m4b-narration-lock");
    running.host.locks.acquire({ projectId, lockType: "narration", scope: "project",
      targetId: "", owner: "narrator", reason: "narration pass" }, view.revision);
    const materialization = await readyMaterialization(running.host, projectId, "m4b-narration-lock",
      stableThreeClipPlan(running, projectId));
    const current = await running.host.projectResolver.resolveActivated(projectId);
    const impact = await postImpact(running, projectId,
      adoptBody(current, materialization.materialization_id, "m4b-narration-impact"));
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    // The lock is recorded — `locks_checked` is a snapshot, not a filter — and it did not
    // block the authorization.
    expect((impact.body.locks_checked as unknown[]).length).toBe(1);

    const committed = await postAdoption(running, projectId, {
      format: "narralens.adopt-request@1.0", base_revision: current.revision,
      expected_source_digest: current.source_digest, control_revision: current.control_revision,
      materialization_id: materialization.materialization_id,
      impact_id: impact.body.impact_id, impact_hash: impact.body.impact_hash,
      approval: { confirmed: true }, idempotency_key: "m4b-narration-adopt",
    });
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect((await running.host.projectResolver.resolveActivated(projectId)).revision).toBe(2);
  }, 900_000);

  it.each([
    ["after_received", "received"],
    ["after_preconditions", "preconditions_checked"],
    ["after_plan", "preconditions_checked"],
    ["after_stage", "staged"],
    ["after_validate", "validated"],
    ["after_snapshot_publish", "validated"],
  ] as const)("converges the pre-publish crash boundary %s to aborted with revision +0", async (boundary, state) => {
    // Gate §7's first row: before `prepared` the publisher has not been called at all, so the
    // only legal conclusion is a CAS from the current legal predecessor to `aborted`, with
    // revision +0, the stage and temp cleaned up, and one idempotency failure response that
    // replays verbatim. These boundaries were unreachable before: the abort rule could only
    // be entered from `after_prepared`, where the row was already `prepared`.
    const running = await start({ adoptionFault: (point) => {
      if (point === boundary) throw new SimulatedAdoptionCrash(`PUBLISH_CRASH:${boundary}`);
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, `pre-${boundary}`);
    // A crash is a crash: the process dies where it died, so the row is still in its
    // pre-publish state and nothing has been cleaned up. The convergence is the *recovery's*
    // job, and it happens on the next boot.
    const crashed = await postAdoption(running, prepared.projectId, prepared.request);
    expect(crashed.status).toBeGreaterThanOrEqual(400);
    expect(running.host.revisions.projectTransactions(prepared.projectId).at(-1)?.state).toBe(state);
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    const transaction = restarted.host.revisions.projectTransactions(prepared.projectId).at(-1);
    expect(transaction?.state).toBe("aborted");
    expect((await restarted.host.projectResolver.resolveActivated(prepared.projectId)).revision).toBe(1);
    // No staging tree and no temp file survive the recovery.
    expect(await readdir(join(running.base, "adoption-stage")).catch(() => [])).toEqual([]);
    const sourceRoot = (await restarted.host.projectResolver.resolveActivated(prepared.projectId)).source_root.value;
    expect((await readdir(sourceRoot)).filter((name) => name.includes(".film.tmp"))).toEqual([]);
  }, 900_000);

  it("converges the crash boundary after_active_inspect to a decided state with revision +0", async () => {
    // The publication boundary's own last check. A crash here leaves the source published
    // and the database uncommitted — the same transition state as `after_published`, but
    // after the active source has been re-read and re-proved.
    const running = await start({ adoptionFault: (point) => {
      if (point === "after_active_inspect") throw new SimulatedAdoptionCrash("PUBLISH_CRASH:after_active_inspect");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, "after-active-inspect");
    const crashed = await postAdoption(running, prepared.projectId, prepared.request);
    expect(crashed.status).toBeGreaterThanOrEqual(400);
    expect((await running.host.projectResolver.resolveActivated(prepared.projectId)).revision).toBe(1);
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    // The recovery completes it: the source is provably the after state, so the commit is
    // the only conclusion left, and it is the same one the original request would have had.
    expect((await restarted.host.projectResolver.resolveActivated(prepared.projectId)).revision).toBe(2);
    expect(restarted.host.revisions.projectTransactions(prepared.projectId).at(-1)?.state).toBe("committed");
  }, 900_000);

  it("answers the same key with the same body whether the recovery just ran or was replayed", async () => {
    // Gate §7: "route 首次及重放均用 error.http_status 返回完全相同的公开 JSON body". The
    // takeover used to answer a generic `{code,message,correlation_id}` while the durable
    // replay of the same key answered the canonical controlled-failure body — two different
    // public bodies for one key.
    const running = await start({ adoptionFault: (point) => {
      if (point === "after_prepared") throw new SimulatedAdoptionCrash("PUBLISH_CRASH:after_prepared");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, "same-key-body");
    expect((await postAdoption(running, prepared.projectId, prepared.request)).status).toBeGreaterThanOrEqual(400);

    // The next request with the same key takes the recovery over. It must answer the
    // canonical failure body...
    const takeover = await postAdoption(running, prepared.projectId, prepared.request);
    const failure = takeover.body.error as { http_status: number } | undefined;
    expect(failure).toBeDefined();
    expect(takeover.status).toBe(failure!.http_status);
    expect(takeover.body.format).toBe("narralens.controlled-write-failure@1.0");
    expect(takeover.body.status).toBe("aborted");
    expect(takeover.body.new_revision).toBe(takeover.body.previous_revision);

    // ...and the durable replay must be byte-identical to it.
    const replay = await postAdoption(running, prepared.projectId, prepared.request);
    expect(replay.status).toBe(takeover.status);
    expect(replay.body).toEqual(takeover.body);
  }, 900_000);

  it("records the source=after / DB-not-committed transition state field by field", async () => {
    // M4B-NW names this transition state specifically: the author source has been replaced,
    // the database commit has not happened, and every other business fact must still be
    // exactly where it was. It is the state a reader of the evidence has to be able to
    // reconstruct, and the state a client sees as a controlled failure rather than a success.
    const running = await start({ adoptionFault: (point) => {
      if (point === "after_published") throw new SimulatedAdoptionCrash("PUBLISH_CRASH:after_published");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, "nw-transition");
    const sourceRoot = (await running.host.projectResolver.resolveActivated(prepared.projectId)).source_root.value;
    const filmBefore = await readFile(join(sourceRoot, "film.html"), "utf8");

    const crashed = await postAdoption(running, prepared.projectId, prepared.request);
    expect(crashed.status).toBeGreaterThanOrEqual(400);
    // The source *was* replaced: the author source is already the adopted one.
    const filmAfter = await readFile(join(sourceRoot, "film.html"), "utf8");
    expect(filmAfter).not.toBe(filmBefore);

    // And nothing else moved. Every one of these is a separate table, read directly.
    const db = running.host.revisions.compose((handle) => handle);
    expect((db.prepare("SELECT revision FROM project_state WHERE project_id=?").get(prepared.projectId) as { revision: number }).revision).toBe(1);
    expect((db.prepare("SELECT snapshot_id, revision FROM active_commit WHERE project_id=?").get(prepared.projectId) as { snapshot_id: string }).snapshot_id)
      .not.toBe("snap_after");
    expect((db.prepare("SELECT count(*) AS n FROM outbox WHERE project_id=?").get(prepared.projectId) as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT count(*) AS n FROM operation_idempotency WHERE project_id=? AND operation_kind=?")
      .get(prepared.projectId, "controlled_write.adopt_materialization") as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT state FROM impact WHERE project_id=?").get(prepared.projectId) as { state: string }).state).toBe("active");
    expect(running.host.revisions.projectTransactions(prepared.projectId).at(-1)?.state).toBe("prepared");
    // The ledger is untouched: adoption adds rows only inside the commit transaction.
    expect((db.prepare("SELECT count(*) AS n FROM migrated_asset WHERE project_id=? AND provenance='adoption'")
      .get(prepared.projectId) as { n: number }).n).toBe(0);

    // The same key takes the recovery over and finishes it. The gate is explicit that the
    // request must not be answered by the generic "project requires recovery" gate, and that a
    // temporary 423 must not be frozen into a permanent replay.
    const retried = await postAdoption(running, prepared.projectId, prepared.request);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({ status: "committed", previous_revision: 1, new_revision: 2 });
    expect((await running.host.projectResolver.resolveActivated(prepared.projectId)).revision).toBe(2);
  }, 900_000);

  it("answers a visual lock held during recovery with a controlled 423 and nothing committed", async () => {
    // The other half of TX-03 in the recovery path. A held visual lock is a *live* conflict:
    // the client can release it and retry, so the answer is a controlled 423 and the
    // transaction stays `prepared` — not terminal attention, and never a guess that the write
    // succeeded. The source stays as it was published, because nothing may roll it back
    // without proof.
    const running = await start({ adoptionFault: (point) => {
      if (point === "after_published") throw new SimulatedAdoptionCrash("PUBLISH_CRASH:after_published");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, "nw-lock-recovery");
    expect((await postAdoption(running, prepared.projectId, prepared.request)).status).toBeGreaterThanOrEqual(400);

    // The lock is taken before the retry, so the recovery is the thing that has to refuse it.
    running.host.locks.acquire({ projectId: prepared.projectId, lockType: "visual", scope: "shot",
      targetId: "shot-002", startFrame: 300, endFrameExclusive: 600, owner: "editor", reason: "editing" },
    prepared.view.revision);

    const retried = await postAdoption(running, prepared.projectId, prepared.request);
    expect(retried.status, JSON.stringify(retried.body)).toBe(423);
    // Nothing was committed: the revision, the pointer and the impact are where they were.
    expect((await running.host.projectResolver.resolveActivated(prepared.projectId)).revision).toBe(1);
    const db = running.host.revisions.compose((handle) => handle);
    // Only the *commit* event counts here. A lock acquisition writes its own `lock.changed`
    // event, which is not the adoption and must not be mistaken for one.
    expect((db.prepare("SELECT count(*) AS n FROM outbox WHERE project_id=? AND topic='project.committed'")
      .get(prepared.projectId) as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT state FROM impact WHERE project_id=?").get(prepared.projectId) as { state: string }).state).toBe("active");
  }, 900_000);

  it("gives two Hosts with different databases different staging roots, so one sweep cannot touch the other", async () => {
    // The sweep removes orphaned staging trees, so it must not be able to reach a tree
    // another Host is using. A checkout-level staging root would be shared by every Host
    // on the machine — including the in-memory ones the suite starts — and one Host's
    // startup would delete another's in-flight adoption.
    const durableA = defaultAdoptionStagingRoot("/var/lib/narralens/one.sqlite");
    const durableB = defaultAdoptionStagingRoot("/var/lib/narralens/two.sqlite");
    const durableAAgain = defaultAdoptionStagingRoot("/var/lib/narralens/one.sqlite");
    expect(durableA).not.toBe(durableB);
    // A durable database keeps the same root across a restart, which is what lets the sweep
    // reclaim what a crash left behind.
    expect(durableAAgain).toBe(durableA);
    // An in-memory database has no history to reclaim, so it gets a private root.
    const memoryA = defaultAdoptionStagingRoot(":memory:");
    const memoryB = defaultAdoptionStagingRoot(":memory:");
    expect(memoryA).not.toBe(memoryB);
    expect(memoryA).not.toBe(durableA);
  }, 300_000);

  it("sweeps an adoption staging tree left behind by a hard crash", async () => {
    // A crash cannot run the `finally` that removes the isolated tree, so every hard kill
    // left a full copy of the source plus its input media on disk with nothing that would
    // ever reclaim it. The sweep runs at startup, where no adoption of this process is in
    // flight, so every `adopt-*` directory under the staging root is an orphan.
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const staging = join(running.base, "adoption-stage");
    const orphan = join(staging, "adopt-orphaned");
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, "film.html"), "<!doctype html><title>orphan</title>\n");
    // Something that is not an adoption staging tree is left alone.
    const other = join(staging, "keep-me");
    await mkdir(other, { recursive: true });
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    expect(await readdir(staging).catch(() => [])).not.toContain("adopt-orphaned");
    expect(await readdir(staging).catch(() => [])).toContain("keep-me");
  }, 300_000);
});
