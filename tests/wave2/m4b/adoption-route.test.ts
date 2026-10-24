import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { planDigest } from "../../../src/host/materialize/native-plan-builder.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import { validateControlledWriteResponse } from "../../../src/contracts/validator.js";
import { defaultAdoptionStagingRoot, NarralensHost } from "../../../src/host/server.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
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

/**
 * Post an adoption.
 *
 * A *recoverable* resource failure is retried rather than reported: this box runs several
 * sessions at once and has run out of memory during a capture, and the Host answers that
 * with `HOST_RESOURCE_EXHAUSTED` and `recoverable: true` precisely so it is not mistaken for
 * a behavioural failure. The retry reuses the same idempotency key, so a retry is a replay
 * rather than a second adoption — which is the behaviour the same key is supposed to have.
 */
/** A request that satisfies the adopt contract, for seeding a transaction row by hand. */
function validAdoptRequest(idempotencyKey: string): Record<string, unknown> {
  return {
    format: "narralens.adopt-request@1.0", base_revision: 1,
    expected_source_digest: "a".repeat(64), control_revision: 0,
    materialization_id: "mat_1", impact_id: "imp_1", impact_hash: "b".repeat(64),
    approval: { confirmed: true }, idempotency_key: idempotencyKey,
  };
}

/**
 * A Host built the way production builds one: a `revisionStore` and nothing else.
 *
 * The production entry point passes a store, not a `dbPath`, so anything derived from a
 * constructor parameter alone is undefined in production. This helper is what makes that
 * class of mistake observable.
 */
async function startWithStore(database: string): Promise<Started> {
  process.env.NARRALENS_OPENFILM_VENDOR = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b";
  const host = new NarralensHost({ revisionStore: new RevisionStore(database) });
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as
    { token: string }).token;
  return { host, origin, token, base: database };
}

async function postAdoption(running: Started, projectId: string, request: object) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/edits`, {
      method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(request),
    });
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    // Two shapes carry a recoverable resource failure: the canonical controlled-failure
    // body, whose code is nested under `error`, and the generic error body, whose code is
    // at the top level. Only the generic one is worth retrying — the canonical one is a
    // *recorded* failure, so retrying it replays the same bytes and changes nothing.
    const nested = body.error as { code?: string; details?: { recoverable?: boolean } } | undefined;
    const top = body as { code?: string; details?: { recoverable?: boolean } };
    const recoverable = top.code === "HOST_RESOURCE_EXHAUSTED" && top.details?.recoverable !== false
      || nested?.code === "HOST_RESOURCE_EXHAUSTED" && nested.details?.recoverable !== false;
    if (!recoverable || attempt === 2) return { status: response.status, body };
    await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
  }
  throw new Error("UNREACHABLE");
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

  it("converges the crash boundary after_active_inspect to a decided state with revision +1", async () => {
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

  it("reclaims a crashed staging tree through the production composition, where the database path is the store's", async () => {
    // The root cause of the second review round's MAJOR: the staging root was derived from a
    // constructor parameter the production entry point never passes, so production got a fresh
    // random directory on every boot and the sweep could reclaim nothing. This test builds
    // the Host the way production does — a `revisionStore`, no `dbPath`, no explicit staging
    // root — and asserts that a crashed tree is gone after the next start.
    const base = await mkdtemp(join(tmpdir(), "narralens-m4b-prod-"));
    dirs.push(base);
    const database = join(base, "narralens.sqlite");
    const running = await startWithStore(database);
    hosts.push(running.host);

    // The root the Host **actually used**, observed rather than recomputed: what has to be
    // true is that the next boot sweeps the directory this one wrote to, and recomputing the
    // derivation would prove only that the derivation is pure.
    const expected = running.host.adoption.stagingRoot;
    expect(expected).toBe(defaultAdoptionStagingRoot(database));
    const orphan = join(expected, "adopt-orphaned");
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, "film.html"), "<!doctype html><title>orphan</title>\n");
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    const restarted = await startWithStore(database);
    hosts.push(restarted.host);
    // The second Host must be using the same root, or the sweep is looking elsewhere.
    expect(restarted.host.adoption.stagingRoot).toBe(expected);
    expect(await readdir(expected).catch(() => [])).not.toContain("adopt-orphaned");
  }, 300_000);

  it("latches a row whose request cannot be read, rather than leaving it to a recovery with no way out", async () => {
    // The generic recovery moves a pre-publish row to `recovering`, which has no legal
    // outgoing edge — TX-08B forbids leaving one. So a row M4B cannot read is latched as a
    // decided state. The behaviour existed; nothing produced the condition.
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const projectId = "of_corrupt_request";
    const db = running.host.revisions.compose((handle) => handle);
    running.host.revisions.beginTransaction({
      transaction_id: "txn_corrupt", project_id: projectId, kind: "edit",
      request_json: "{not json at all", request_hash: "0".repeat(64),
      correlation_id: "corr-corrupt", base_revision: 0,
    });
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    const row = restarted.host.revisions.compose((handle) => handle)
      .prepare("SELECT state, error_code FROM project_transaction WHERE transaction_id='txn_corrupt'")
      .get() as { state: string; error_code: string };
    // A decided state with a reason, never `recovering`.
    expect(row.state).toBe("attention");
    expect(row.error_code).toBe("ADOPTION_REQUEST_UNREADABLE");
  }, 300_000);

  it("records why a recovery was blocked, and closes the project visibly", async () => {
    // The reason has to be on the row: a transaction that was skipped with nothing recorded
    // is a row nobody can act on. And the project *is* closed — by the generic recovery,
    // which owns the foreign row that did the blocking. What matters is that the closure is
    // visible rather than a row stranded in `recovering`.
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const projectId = "of_blocked_recovery";
    const db = running.host.revisions.compose((handle) => handle);
    running.host.revisions.beginTransaction({
      transaction_id: "txn_blocked", project_id: projectId, kind: "edit",
      // A *valid* adopt request: a request that fails the contract is latched as
      // unreadable, which is a different path from the one this test is about.
      request_json: JSON.stringify(validAdoptRequest("k")),
      request_hash: "0".repeat(64), correlation_id: "corr-blocked", base_revision: 0,
    });
    // A pending row of **another module** closes the recovery gate. M4B's own rows do not:
    // a recovery blocked by its own siblings could never resolve them, so the gate ignores
    // the ones this recovery is about to resolve.
    running.host.revisions.beginTransaction({
      transaction_id: "txn_other", project_id: projectId, kind: "edit",
      request_json: JSON.stringify({ format: "narralens.edit-request@1.0", shot_id: "shot-001" }),
      request_hash: "1".repeat(64), correlation_id: "corr-other", base_revision: 0,
    });
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    const row = restarted.host.revisions.compose((handle) => handle)
      .prepare("SELECT state, error_code FROM project_transaction WHERE transaction_id='txn_blocked'")
      .get() as { state: string; error_code: string };
    // Latched, with its reason, rather than left to a recovery that would move it into
    // `recovering` — a state with no legal outgoing edge.
    expect(row.state).toBe("attention");
    expect(row.error_code).toBe("ADOPTION_RECOVERY_BLOCKED");
    // M4B's reason is on the **row**, where the next operator will look for it. The
    // project's own attention reason comes from the generic recovery, which runs afterwards
    // and owns the foreign row that did the blocking.
    const row2 = restarted.host.revisions.compose((handle) => handle)
      .prepare("SELECT terminal_reason FROM project_transaction WHERE transaction_id='txn_blocked'")
      .get() as { terminal_reason: string };
    expect(row2.terminal_reason).toMatch(/adoption recovery/iu);
    expect(restarted.host.revisions.projectsInAttention()).toContain(projectId);
  }, 300_000);

  it("does not let one of its own pending rows block the recovery of another", async () => {
    // The recovery gate refuses while the project has pending work. If M4B's own rows
    // counted, a project with two of them could never recover either — the gate would see
    // a pending transaction and refuse, and the row it was supposed to recover would stay
    // exactly as it was. The gate therefore excludes the rows this recovery is about to
    // resolve.
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const projectId = "of_two_own_rows";
    const db = running.host.revisions.compose((handle) => handle);
    for (const [id, key] of [["txn_first", "k1"], ["txn_second", "k2"]] as const) {
      running.host.revisions.beginTransaction({
        transaction_id: id, project_id: projectId, kind: "edit",
        request_json: JSON.stringify(validAdoptRequest(key)),
        request_hash: "0".repeat(64), correlation_id: `corr-${id}`, base_revision: 0,
      });
    }
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    // Neither row may be left waiting for the other: both are decided.
    for (const id of ["txn_first", "txn_second"]) {
      const row = restarted.host.revisions.compose((handle) => handle)
        .prepare("SELECT state, error_code FROM project_transaction WHERE transaction_id=?")
        .get(id) as { state: string; error_code: string };
      expect(["aborted", "attention"], `${id}: ${row.state}/${row.error_code}`).toContain(row.state);
      // In particular, not the refusal that says one blocked the other.
      expect(row.error_code).not.toBe("ADOPTION_RECOVERY_BLOCKED");
      // And never the state with no legal outgoing edge.
      expect(row.state).not.toBe("recovering");
    }
  }, 300_000);

  it("leaves another module's transaction alone: a legacy edit row is not M4B's to decide", async () => {
    // The legacy edit route writes `project_transaction` rows with a non-adoption
    // `request_json`, and the generic recovery — which runs *after* M4B's — owns them.
    // M4B deciding them would be one module answering for another's transaction, with a
    // reason that is false about a perfectly readable request.
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const projectId = "of_legacy_project";
    const db = running.host.revisions.compose((handle) => handle);
    running.host.revisions.beginTransaction({
      transaction_id: "txn_legacy", project_id: projectId, kind: "edit",
      request_json: JSON.stringify({ format: "narralens.edit-request@1.0", shot_id: "shot-001" }),
      request_hash: "0".repeat(64), correlation_id: "corr-legacy", base_revision: 0,
    });
    // The row is left in `received`, which is where an interrupted legacy write lands.
    expect((db.prepare("SELECT state FROM project_transaction WHERE transaction_id='txn_legacy'")
      .get() as { state: string }).state).toBe("received");

    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    const restarted = await startOn(running.base);
    hosts.push(restarted.host);

    const after = restarted.host.revisions.compose((handle) => handle)
      .prepare("SELECT state, error_code FROM project_transaction WHERE transaction_id='txn_legacy'")
      .get() as { state: string; error_code: string };
    // Not latched by M4B, and not carrying M4B's reason.
    expect(after.error_code).not.toBe("ADOPTION_REQUEST_UNREADABLE");
    // The generic recovery owns it now, so the row is either recovered or decided by the
    // generic path — never by the adoption's recovery.
    expect(["received", "recovering", "attention", "aborted"]).toContain(after.state);
  }, 300_000);

  it("answers a conflicting idempotency key with the request's correlation id", async () => {
    // The project id used to be put in the correlation-id slot, so the same conflict could be
    // answered with two different bodies depending on which path noticed it — one of them
    // carrying something that is not a correlation id at all.
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    // A real, committed adoption records a response under its key. The conflict is then the
    // same key with a different body, which is exactly the case the replay path answers.
    const prepared = await authorizedAdoption(running, "corr-adopt");
    const committed = await postAdoption(running, prepared.projectId, prepared.request);
    expect(committed.status).toBe(200);

    // The same key with a different body is a conflict, and it must carry the request's
    // correlation id rather than the project's.
    const conflict = await postAdoption(running, prepared.projectId,
      { ...prepared.request, impact_hash: "b".repeat(64) });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    // The Host's own correlation id for this request — not the project id.
    expect(conflict.body.correlation_id).not.toBe(prepared.projectId);
    expect(String(conflict.body.correlation_id ?? "")).toMatch(/^[0-9a-f-]{8,}$/iu);
  }, 600_000);

  it("answers one idempotency key with one body, whatever the request body is", async () => {
    // The root cause of the third review round's MAJOR: the recovery takeover ran *before*
    // the request's own identity was settled, so a request with the same key and a different
    // body was answered with the old transaction's failure, and a later attempt with that
    // body got a 409. One key, two public bodies.
    const running = await start({ adoptionFault: (point) => {
      if (point === "after_prepared") throw new SimulatedAdoptionCrash("PUBLISH_CRASH:after_prepared");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedAdoption(running, "one-key-one-body");
    const crashed = await postAdoption(running, prepared.projectId, prepared.request);
    expect(crashed.status).toBeGreaterThanOrEqual(400);

    // The same key with a *different* body is a conflict, and the conflict is the same
    // answer the replay path gives — not the old transaction's failure.
    const conflicting = await postAdoption(running, prepared.projectId,
      { ...prepared.request, impact_hash: "0".repeat(64) });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");

    // And the original request still gets exactly one answer, every time.
    const first = await postAdoption(running, prepared.projectId, prepared.request);
    const second = await postAdoption(running, prepared.projectId, prepared.request);
    expect(first.status).toBe(second.status);
    expect(first.body).toEqual(second.body);
    expect(first.body.format).toBe("narralens.controlled-write-failure@1.0");
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
