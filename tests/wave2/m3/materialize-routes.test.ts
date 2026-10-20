import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProposalAdapter } from "../../../src/adapters/openmontage/proposal-adapter.js";
import { ProposalComparisonAdapter } from "../../../src/adapters/openmontage/proposal-comparison-adapter.js";
import { NarralensHost } from "../../../src/host/server.js";
import { LockService } from "../../../src/host/projects/lock-service.js";
import type { FailureDiagnostic } from "../../../src/host/host-diagnostics.js";
import type { JobResponse, ProposalComparison, ProposalComparisonRequest } from "../../../src/contracts/types.js";
import type { MaterializationV1 } from "../../../src/contracts/wave2-types.js";
import { treeDigest } from "../../../src/host/projects/openfilm-migrator.js";

/**
 * M3.3 over HTTP: the two routes, against a Host that really migrated a project.
 *
 * The route tests elsewhere prove the paths exist and refuse bad input. This one proves the
 * whole chain a client walks: prepare against the real target's current facts, get 202 with
 * a job and a materialization id, let the worker run, then read the materialization back
 * over HTTP and watch the same re-verification that would mark it stale.
 *
 * Nothing is stubbed on the way through: the target comes from the Host's own `migrate-copy`
 * route, the media are the repository's real MP4s, and the proxy is really encoded.
 */

/**
 * Drives the Host's own drain until a materialization settles.
 *
 * Exactly one test in this file asserts that the Host renders on its own; every other test
 * is about what a settled row does, and waiting on a wall clock to find that out made the
 * whole file depend on machine load. The work is still the Host's — this calls the same
 * drain the timer calls, it just does not wait for the timer.
 */
async function settle(running: Started, materializationId: string, timeoutMs = 120_000):
Promise<MaterializationV1> {
  const deadline = Date.now() + timeoutMs;
  let row: MaterializationV1 | undefined;
  while (Date.now() < deadline) {
    const drained = await running.host.materialize.drain();
    void drained;
    row = await running.host.materialize.read(materializationId).catch((error: unknown) => {
      if (["MEDIA_TOOL_UNAVAILABLE", "HOST_RESOURCE_EXHAUSTED"]
        .includes(String((error as { code?: string }).code))) return undefined;
      throw error;
    });
    if (row !== undefined && row.state !== "running" && row.state !== "validating" && row.state !== "queued") {
      return row;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error(`SETTLE_TIMEOUT ${JSON.stringify(recent(running, materializationId))}`);
}

/**
 * How long a client waits for a real encode before giving up.
 *
 * The Host does the work on its own timer, and that work is a real 600-frame transcode. On
 * a loaded machine thirty seconds is not always enough, and a client that stopped polling
 * early would see `validating` and call it a failure. Waiting longer costs nothing when the
 * answer is already there; it changes no assertion.
 */
/**
 * Segment length for the seam tests.
 *
 * These tests assert that the Host renders on its own, that drift and a lock move a ready
 * row to stale, and that nothing authored changes. None of that depends on the film being
 * long, and three tests each encoding six hundred real frames made this file the most
 * expensive in the suite for no additional evidence — real-media fidelity is MT-06's job and
 * is proven there against the same renderer and the same fixture.
 */
const SEAM_SEGMENT_FRAMES = [30, 30];

/** Splits a duration vector so the parts still sum to the whole. */
function split(durations: number[], firstShare: number): number[] {
  const [first, ...rest] = durations;
  const head = Math.max(1, Math.round((first ?? 1) * firstShare));
  const tail = Math.max(1, (first ?? 1) - head);
  return [head, ...rest.map((frames) => tail === frames ? frames + 1 : frames), tail];
}
const POLL_ATTEMPTS = 400;
const POLL_INTERVAL_MS = 250;

const SOURCE_FIXTURE = resolve("fixtures/d1-30s");
const REAL_UPSTREAM_PARENT = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b";

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface Started {
  host: NarralensHost;
  origin: string;
  token: string;
  base: string;
}

/** The Host's own account of what happened to one materialization, for a failure message. */
function recent(running: Started, materializationId: string): unknown {
  return running.host.failures.recent(8)
    .filter((entry) => entry.context?.materialization_id === materializationId
      || entry.correlation_id === materializationId)
    .map((entry) => ({ stage: entry.stage, reason: entry.context?.reason, boundary: entry.context?.boundary,
      attempt: entry.context?.attempt, lease_owner: entry.context?.lease_owner,
      cause: entry.context?.cause, message: entry.message_redacted }));
}

function headers(origin: string, token: string): Record<string, string> {
  return { origin, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function started(): Promise<Started> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m33-http-"));
  dirs.push(base);
  return await startOn(base);
}

/** A Host over an existing working directory, which is how a restart is modelled. */
async function startOn(base: string): Promise<Started> {
  const previousVendor = process.env.NARRALENS_OPENFILM_VENDOR;
  // The Host treats this as the *parent* of `vendor/openfilm`, not the checkout itself.
  process.env.NARRALENS_OPENFILM_VENDOR = REAL_UPSTREAM_PARENT;
  const host = new NarralensHost({
    migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite"),
    derivedRoot: join(base, "derived"),
    // Comparisons live in the test's own tree. The default root is the repository's
    // `var/`, which this test must not write to — and whose directory metadata this box
    // does not always report back immediately, which turned a correct save into a 404.
    proposals: new ProposalAdapter(join(base, "proposals")),
    comparisons: new ProposalComparisonAdapter(join(base, "proposal-comparisons")),
  });
  hosts.push(host);
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const session = await fetch(`${origin}/api/session`, { headers: { origin } });
  const token = (await session.json() as { token: string }).token;
  void previousVendor;
  return { host, origin, token, base };
}

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Writes the target-owned comparison through the Host's own adapter.
 *
 * This is the C-07 replay path with no provider call: the draft is a recorded one and the
 * comparison is built against the *target's* facts, so the adapter — not this file — is
 * what sets the project id.
 */
async function seedComparison(running: Started, projectId: string, baseRevision: number, durations = SEAM_SEGMENT_FRAMES): Promise<{ comparisonId: string; proposalId: string; built: ProposalComparison }> {
  const role = (index: number): "anchor" | "context" | "evidence" | "conclusion" =>
    (["anchor", "context", "evidence", "conclusion"] as const)[index % 4]!;
  const option = (index: number, durations: number[]) => ({
    option_key: `option_${index}`,
    title: `recorded option ${index}`,
    strategy: { kind: (["chronology", "contrast", "evidence-led"] as const)[index - 1]!, rationale: "recorded" },
    summary: "recorded draft replayed onto the target",
    segments: durations.map((duration_frames, part) => ({
      segment_id: `s_${index}_${part}`, duration_frames, role: role(part),
      intent: "视觉意图", asset_requirement_ids: [],
    })),
    assets_needed: [], source_refs: [], requires_materialization: true, renderable: false,
  });
  const draft = {
    schema_version: "1.0", kind: "narralens.proposal_comparison_draft",
    // D4.1 requires three to six candidates and refuses a structurally identical set, so
    // the recorded draft has three that differ in segmentation as well as in strategy.
    proposals: [
      // D4.1 requires every candidate to cover the selection exactly and to differ
      // structurally, so all three sum to `total` and no two share a duration vector.
      option(1, durations),
      option(2, split(durations, 0.6)),
      option(3, split(durations, 0.4)),
    ],
  };
  const total = durations.reduce((sum, frames) => sum + frames, 0);
  const request: ProposalComparisonRequest = {
    base_revision: baseRevision,
    selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: total },
    intent: "recorded", preserve: ["narration"], proposal_count: 3,
  };
  const built = running.host.comparisons.build(draft, projectId, request, {
    stdout_sha256: sha(Buffer.from("recorded-runner-stdout")), model_names: ["<recorded>"],
    total_cost_usd: 0, duration_ms: 1, num_turns: 1, service_tier: null,
  });
  // The adapter issues the ids and validates them on read, so the request names exactly
  // what a client would have been handed rather than an id this file invented.
  await running.host.comparisons.save(built);
  // The adapter validates on read, so the worker's read is the real proof this is
  // target-owned; re-reading here would only duplicate it and race the save.
  return { comparisonId: built.comparison_id, proposalId: built.proposals[0]!.proposal_id, built };
}

/** Migrates `d1-30s` through the Host's own route and returns the new target. */
async function migrateTarget(startedHost: Started, attempt = 0): Promise<{
  projectId: string; baseRevision: number; proposalId: string; comparisonId: string;
  comparison: ProposalComparison;
}> {
  const response = await fetch(`${startedHost.origin}/api/migration/v1/projects/d1-30s/migrate-copy`, {
    method: "POST", headers: headers(startedHost.origin, startedHost.token),
    body: JSON.stringify({ idempotency_key: "m33-http-migrate-1" }),
  });
  if (response.status !== 200) {
    // The Host's own account travels with the failure, so an intermittent migration error is
    // answerable from the message instead of needing a reproduction.
    throw new Error(`MIGRATE_${response.status}: ${(await response.text()).slice(0, 200)} `
      + `diagnostics=${JSON.stringify(startedHost.host.failures.recent(4).map((entry: FailureDiagnostic) => ({
        stage: entry.stage, reason: entry.context?.reason, cause: entry.context?.cause,
        message: entry.message_redacted })))}`);
  }
  const report = await response.json() as { plan: { target_project_id: string } };
  const projectId = report.plan.target_project_id;
  const { comparisonId, proposalId, built } = await seedComparison(startedHost, projectId, 1);
  return { projectId, baseRevision: 1, proposalId, comparisonId, comparison: built };
}

async function targetAssetIds(host: NarralensHost, projectId: string): Promise<string[]> {
  return host.assetLedger.assets(projectId).map((asset) => asset.asset_id).sort();
}

/**
 * Builds the bindings a client would send, from the *stored* proposal.
 *
 * Segment ids belong to the comparison, not to this test: the recorded draft was built by
 * the adapter, which names segments itself. Inventing `seg-1` here produced a request the
 * Host correctly refused as not corresponding one to one.
 */
function bindingsFor(
  stored: { proposals: Array<{ proposal_id: string; segments: Array<{ segment_id: string; duration_frames: number }> }> },
  proposalId: string, assetIds: string[],
): Array<{ segment_id: string; asset_id: string; source_start_frame: number; source_end_frame_exclusive: number }> {
  const proposal = stored.proposals.find((candidate) => candidate.proposal_id === proposalId);
  if (proposal === undefined) throw new Error(`PROPOSAL_NOT_IN_COMPARISON:${proposalId}`);
  return proposal.segments.map((segment, index) => ({
    segment_id: segment.segment_id,
    asset_id: assetIds[index % assetIds.length]!,
    source_start_frame: 0,
    source_end_frame_exclusive: segment.duration_frames,
  }));
}

describe("M3.3 the two routes, over HTTP, against a real migrated target", () => {
  it("POST returns 202 with a job and a materialization id, and GET reads it back", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const assets = await targetAssetIds(running.host, projectId);
    expect(assets.length).toBeGreaterThan(1);

    const view = await running.host.projectResolver.resolveActivated(projectId);
    const body = {
      comparison_id: comparisonId, base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      format: "narralens.materialize-request@1.0",
      profile: { profile_id: "wave2-proxy-720p30-v1" },
      segment_bindings: bindingsFor(comparison, proposalId, assets),
      idempotency_key: "m33-http-materialize-1",
    };

    if (!comparisonId || !proposalId) throw new Error(`IDS_MISSING comparison=${comparisonId} proposal=${proposalId}`);
    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(body) },
    );
    expect(posted.status, await posted.clone().text()).toBe(202);
    const job = await posted.json() as JobResponse & { materialization_id: string };
    expect(job.job_id).toMatch(/^job_/u);
    expect(job.materialization_id).toMatch(/^mat_/u);

    // The comparison the request names exists on disk, written through the Host's own
    // adapter, so the worker reads the same bytes a client would have posted.
    try {
    expect((await running.host.comparisons.read(comparisonId)).project_id).toBe(projectId);
  } catch (error) {
    const { readdir: rd } = await import("node:fs/promises");
    const short = comparisonId.slice(11, 19);
    for (const dir of ["/tmp"]) {
      const names = await import("node:fs/promises").then((fs) => fs.readdir("/tmp"));
      const hit = names.filter((n) => n.startsWith("narralens-m33-http-"));
      console.error("READBACK_FAIL", comparisonId, String(error), "short", short, "tmpdirs", hit.length);
      for (const d of hit.slice(0, 3)) {
        console.error("  contents", d, await rd(`/tmp/${d}`).catch(() => []));
      }
    }
    throw error;
  }


    const ready = await settle(running, job.materialization_id);
    // The Host's diagnostics are attached to the assertion so a failure names the row, the
    // attempt and the boundary rather than leaving a reader to guess from a state.
    const terminal = running.host.revisions.compose((db) => db.prepare(
      "SELECT terminal_reason FROM job WHERE job_id=?").get(job.job_id) as { terminal_reason?: string } | undefined);
    expect(ready?.state, `comparison=${comparisonId} terminal=${terminal?.terminal_reason ?? ""} job=${JSON.stringify(running.host.jobs.get(job.job_id))} ${JSON.stringify(recent(running, job.materialization_id))}`)
      .toBe("ready_for_adoption");

    const read = await fetch(`${running.origin}/api/migration/v1/materializations/${job.materialization_id}`,
      { headers: headers(running.origin, running.token) });
    expect(read.status).toBe(200);
    const row = await read.json() as MaterializationV1;
    expect(row).toMatchObject({ format: "narralens.materialization@1.0", state: "ready_for_adoption" });
    expect(row.native_plan?.clips).toHaveLength(2);
    // The proxy matches the plan that was bound, whatever length that plan is.
    expect(row.proxy?.frame_count).toBe(SEAM_SEGMENT_FRAMES.reduce((sum, frames) => sum + frames, 0));
    expect(row.lineage).toHaveLength(2);
    // No locator ever crosses the wire. `video/mp4` legitimately contains a slash, so the
    // assertion is about locator shapes rather than the character.
    expect(JSON.stringify(row)).not.toContain("target_path");
    expect(JSON.stringify(row)).not.toContain("asset_path");
    expect(JSON.stringify(row)).not.toContain("project_path");
    expect(JSON.stringify(row)).not.toMatch(/"[^"]*\/(?:tmp|var|home|Users|mnt)\/"/u);
  }, 600_000);

  it("GET answers 404 for a materialization that does not exist", async () => {
    const running = await started();
    const response = await fetch(`${running.origin}/api/migration/v1/materializations/mat_nope`,
      { headers: headers(running.origin, running.token) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  }, 300_000);

  it("POST refuses a malformed body on merit, with no materialization created", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const before = running.host.materializations.byProject(projectId).length;
    for (const body of [
      {},
      { idempotency_key: "short" },
      { idempotency_key: "m33-http-materialize-2", segment_bindings: [] },
      { idempotency_key: "m33-http-materialize-2", segment_bindings: [{ segment_id: "s" }] },
      // A number where a string belongs must not be coerced into a binding.
      { idempotency_key: "m33-http-materialize-2",
        segment_bindings: [{ segment_id: 1, asset_id: "a", source_start_frame: 0, source_end_frame_exclusive: 1 }] },
    ]) {
      const response = await fetch(
        `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
        { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(body) },
      );
      expect([400, 422], JSON.stringify(body)).toContain(response.status);
    }
    expect(running.host.materializations.byProject(projectId)).toHaveLength(before);
  }, 600_000);

  it("POST refuses a stale base revision rather than preparing against a moved project", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    const response = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token),
        body: JSON.stringify({
          format: "narralens.materialize-request@1.0",
          profile: { profile_id: "wave2-proxy-720p30-v1" },
          comparison_id: comparisonId, base_revision: view.revision + 5,
          expected_source_digest: view.source_digest, control_revision: view.control_revision,
          // Valid bindings, so the refusal is about the revision and not about the body.
          segment_bindings: bindingsFor(comparison, proposalId, await targetAssetIds(running.host, projectId)),
          idempotency_key: "m33-http-materialize-3",
        }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "REVISION_CONFLICT" });
  }, 600_000);

  it("GET moves a drifted materialization to stale over HTTP", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const assets = await targetAssetIds(running.host, projectId);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    if (!comparisonId || !proposalId) throw new Error(`IDS_MISSING comparison=${comparisonId} proposal=${proposalId}`);
    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify({
        comparison_id: comparisonId, base_revision: view.revision,
        expected_source_digest: view.source_digest, control_revision: view.control_revision,
        format: "narralens.materialize-request@1.0",
        profile: { profile_id: "wave2-proxy-720p30-v1" },
        segment_bindings: bindingsFor(comparison, proposalId, assets),
        idempotency_key: "m33-http-materialize-4",
      }) },
    );
    expect(posted.status, await posted.clone().text()).toBe(202);
    const job = await posted.json() as { materialization_id: string };
    // Settled first: a row that never reached ready would still be `running` here, and the
    // assertion below would be about the wrong state.
    await settle(running, job.materialization_id);

    // Drift the target's own bytes, as an operator or a sync would.
    const asset = running.host.assetLedger.assets(projectId)[0]!;
    await writeFile(resolve(view.source_root.value, asset.target_path),
      Buffer.from("not the bytes the ledger recorded"));

    const read = await fetch(`${running.origin}/api/migration/v1/materializations/${job.materialization_id}`,
      { headers: headers(running.origin, running.token) });
    expect(read.status).toBe(200);
    const row = await read.json() as MaterializationV1;
    expect(row.state).toBe("stale");
    expect(row.blocking_reasons.length).toBeGreaterThan(0);

    // And every later read agrees.
    const again = await fetch(`${running.origin}/api/migration/v1/materializations/${job.materialization_id}`,
      { headers: headers(running.origin, running.token) });
    expect((await again.json() as MaterializationV1).state).toBe("stale");
  }, 600_000);
});

void readFile;
void mkdir;
void SOURCE_FIXTURE;

describe("M3.3 a client never has to call the worker itself", () => {
  /**
   * The review found the feature was unreachable: POST returned 202 and the row stayed
   * `queued` forever, because nothing scheduled a worker. Every other test in this file
   * called `host.materialize.run()` by hand, so they proved the renderer worked and proved
   * nothing about whether a user could use it.
   *
   * This one does not call `run()`. It POSTs, then polls the GET like a client would.
   */
  it("renders on its own after a POST, with no manual worker call", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    const assets = await targetAssetIds(running.host, projectId);

    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify({
        format: "narralens.materialize-request@1.0",
        profile: { profile_id: "wave2-proxy-720p30-v1" },
        comparison_id: comparisonId, base_revision: view.revision,
        expected_source_digest: view.source_digest, control_revision: view.control_revision,
        segment_bindings: bindingsFor(comparison, proposalId, assets),
        idempotency_key: "m33-http-autonomous-1",
      }) },
    );
    expect(posted.status, await posted.clone().text()).toBe(202);
    const job = await posted.json() as { materialization_id: string };

    // Poll the way a client would, and let the Host's own worker do the work.
    let row: MaterializationV1 | undefined;
    for (let attempt = 0; attempt < POLL_ATTEMPTS && row?.state !== "ready_for_adoption"; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
      const read = await fetch(`${running.origin}/api/migration/v1/materializations/${job.materialization_id}`,
        { headers: headers(running.origin, running.token) });
      expect(read.status).toBe(200);
      row = await read.json() as MaterializationV1;
    }

    expect(row?.state, "the Host must render without anyone calling run()").toBe("ready_for_adoption");
    // The proxy matches the plan that was bound, whatever length that plan is.
    const planned = SEAM_SEGMENT_FRAMES.reduce((sum, frames) => sum + frames, 0);
    expect(row?.proxy?.frame_count).toBe(planned);
    expect(row?.native_plan?.clips).toHaveLength(2);
  }, 300_000);

  it("classifies rows left behind when the Host restarts", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    const assets = await targetAssetIds(running.host, projectId);
    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify({
        format: "narralens.materialize-request@1.0",
        profile: { profile_id: "wave2-proxy-720p30-v1" },
        comparison_id: comparisonId, base_revision: view.revision,
        expected_source_digest: view.source_digest, control_revision: view.control_revision,
        segment_bindings: bindingsFor(comparison, proposalId, assets),
        idempotency_key: "m33-http-recover-1",
      }) },
    );
    const created = await posted.json() as { materialization_id: string; job_id: string };
    await running.host.close();
    hosts.splice(0);

    // A second Host over the same database must classify the row rather than forget it.
    const second = await startOn(running.base);
    const outcome = await second.host.materialize.recover();
    const classified = outcome.retried.concat(outcome.quarantined, outcome.ownedElsewhere);
    // Either recovery classified it, or the first Host had already finished it before it
    // closed. What must not happen is the row being *forgotten*: `recover()` returning
    // nothing for a row that is still runnable would be a silent stall.
    const afterRecovery = await second.host.materialize.read(created.materialization_id);
    expect(classified.includes(created.materialization_id)
      || ["ready_for_adoption", "cancelled", "attention"].includes(afterRecovery.state)).toBe(true);

    // MT-05 asks that a row not stay mid-flight *permanently*, so convergence is asserted
    // by driving the second Host's drain rather than by demanding it happen on its own
    // within the test's first read.
    const settled = await settle(second, created.materialization_id);
    expect(["ready_for_adoption", "cancelled", "attention"]).toContain(settled.state);
    const read = await fetch(`${second.origin}/api/migration/v1/materializations/${created.materialization_id}`,
      { headers: headers(second.origin, second.token) });
    expect(read.status).toBe(200);
    void created.job_id;
  }, 300_000);
});

describe("PR-01 a replayed comparison is labelled and both digests are kept", () => {
  /**
   * C-07 requires the lineage to distinguish a replay from a fresh provider call, and to
   * carry both the recorded runner's stdout digest and the digest of the draft that was
   * replayed. The marker is now produced by the route rather than written straight into a
   * row by a unit test.
   */
  it("stamps RECORDED_PROVIDER_OUTPUT_REPLAY with both digests", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    const assets = await targetAssetIds(running.host, projectId);
    const payloadSha = createHash("sha256").update(JSON.stringify(comparison.proposals)).digest("hex");

    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify({
        format: "narralens.materialize-request@1.0",
        profile: { profile_id: "wave2-proxy-720p30-v1" },
        comparison_id: comparisonId, base_revision: view.revision,
        expected_source_digest: view.source_digest, control_revision: view.control_revision,
        segment_bindings: bindingsFor(comparison, proposalId, assets),
        idempotency_key: "m33-http-replay-1",
        replay: { mode: "RECORDED_PROVIDER_OUTPUT_REPLAY", recorded_payload_sha256: payloadSha },
      }) },
    );
    expect(posted.status, await posted.clone().text()).toBe(202);
    const job = await posted.json() as { materialization_id: string };

    const replay = running.host.materializations.replayOf(job.materialization_id);
    expect(replay).toEqual({
      mode: "RECORDED_PROVIDER_OUTPUT_REPLAY",
      recorded_stdout_sha256: comparison.generation_audit.stdout_sha256,
      recorded_payload_sha256: payloadSha,
    });
  }, 300_000);

  it("refuses a replay that cannot be substantiated", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    const assets = await targetAssetIds(running.host, projectId);
    const base = {
      format: "narralens.materialize-request@1.0",
      profile: { profile_id: "wave2-proxy-720p30-v1" },
      comparison_id: comparisonId, base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      segment_bindings: bindingsFor(comparison, proposalId, assets),
    };
    // A claimed replay with no digest, and one with an undeclared mode, are both refused:
    // the marker must be earned, not asserted.
    for (const replay of [
      { mode: "RECORDED_PROVIDER_OUTPUT_REPLAY" },
      { recorded_payload_sha256: createHash("sha256").update("draft").digest("hex") },
    ]) {
      const response = await fetch(
        `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
        { method: "POST", headers: headers(running.origin, running.token),
          body: JSON.stringify({ ...base, idempotency_key: "m33-http-replay-2", replay }) },
      );
      expect([400, 422], JSON.stringify(replay)).toContain(response.status);
    }
  }, 300_000);
});

describe("MT-04 and MT-05 through the Host, not around it", () => {
  /**
   * The acceptance review was right that MT-04 was proven only against a hand-built
   * harness. This runs the real route, through the real Host, and diffs the author facts
   * around it — the only version of that claim that means anything.
   */
  it("changes no author fact while a real materialize runs end to end", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    const assets = await targetAssetIds(running.host, projectId);

    const authorFacts = async () => ({
      commit: running.host.revisions.activeCommit(projectId),
      binding: running.host.revisions.readEngineBinding(projectId),
      ledger: running.host.revisions.compose((db) => db.prepare(
        "SELECT * FROM migrated_asset WHERE project_id=? ORDER BY asset_id").all(projectId)),
      ledgerRecord: running.host.revisions.compose((db) => db.prepare(
        "SELECT * FROM asset_ledger_bootstrap WHERE project_id=?").all(projectId)),
      targetTree: await treeDigest(view.source_root.value),
      sourceTree: await treeDigest(resolve("fixtures/d1-30s")),
    });
    const before = await authorFacts();

    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify({
        format: "narralens.materialize-request@1.0",
        profile: { profile_id: "wave2-proxy-720p30-v1" },
        comparison_id: comparisonId, base_revision: view.revision,
        expected_source_digest: view.source_digest, control_revision: view.control_revision,
        segment_bindings: bindingsFor(comparison, proposalId, assets),
        idempotency_key: "m33-http-nowrite-1",
      }) },
    );
    expect(posted.status, await posted.clone().text()).toBe(202);
    const job = await posted.json() as { materialization_id: string };
    const row = await settle(running, job.materialization_id);
    expect(row.state).toBe("ready_for_adoption");

    const after = await authorFacts();
    expect(after.commit).toEqual(before.commit);
    expect(after.binding).toEqual(before.binding);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.ledgerRecord).toEqual(before.ledgerRecord);
    // The target tree itself is untouched: the proxy lives in the derived root, not here.
    expect(after.targetTree).toBe(before.targetTree);
    expect(after.sourceTree).toBe(before.sourceTree);
  }, 600_000);

  it("goes stale when the control revision moves under a ready materialization", async () => {
    const running = await started();
    const { projectId, proposalId, comparisonId, comparison } = await migrateTarget(running);
    const view = await running.host.projectResolver.resolveActivated(projectId);
    const assets = await targetAssetIds(running.host, projectId);
    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify({
        format: "narralens.materialize-request@1.0",
        profile: { profile_id: "wave2-proxy-720p30-v1" },
        comparison_id: comparisonId, base_revision: view.revision,
        expected_source_digest: view.source_digest, control_revision: view.control_revision,
        segment_bindings: bindingsFor(comparison, proposalId, assets),
        idempotency_key: "m33-http-control-1",
      }) },
    );
    const job = await posted.json() as { materialization_id: string };
    const row = await settle(running, job.materialization_id);
    expect(row.state).toBe("ready_for_adoption");

    // A lock or any other control-plane change moves the control revision.
    running.host.revisions.bumpControlRevision(projectId, view.revision);
    const read = await running.host.materialize.read(job.materialization_id);
    expect(read.state).toBe("stale");
    expect(read.blocking_reasons).toContain("CONTROL_REVISION_CHANGED");
  }, 600_000);
});

/**
 * M2: PR-03, "锁定范围变化拒绝".
 *
 * The acceptance matrix asks for proof that a locked range refuses the operation, and it
 * explicitly forbids standing in for it by bumping the control revision by hand. These go
 * through the real `LockService`, which is what a lock actually is here: a row plus a
 * control revision that every write re-checks.
 */
describe("PR-03 a real lock, not a hand-written control revision", () => {
  async function withTarget(): Promise<{
    running: Started; projectId: string; proposalId: string; comparisonId: string;
    comparison: ProposalComparison; assets: string[]; view: { revision: number; control_revision: number; source_digest: string };
  }> {
    const running = await started();
    const migrated = await migrateTarget(running);
    const assets = await targetAssetIds(running.host, migrated.projectId);
    const view = await running.host.projectResolver.resolveActivated(migrated.projectId);
    return { running, ...migrated, assets, view };
  }

  function body(fields: Record<string, unknown>): Record<string, unknown> {
    return {
      format: "narralens.materialize-request@1.0",
      profile: { profile_id: "wave2-proxy-720p30-v1" }, ...fields,
    };
  }

  it("refuses a POST prepared before the range was locked", async () => {
    const { running, projectId, proposalId, comparisonId, comparison, assets, view } = await withTarget();
    const request = body({
      comparison_id: comparisonId, base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      segment_bindings: bindingsFor(comparison, proposalId, assets),
      idempotency_key: "m33-lock-before-1",
    });
    // The client composed its request against this control revision…
    expect(running.host.revisions.controlRevision(projectId, view.revision)).toBe(view.control_revision);

    // …and a lock on the very range it wants to change now exists.
    const locks = new LockService(running.host.revisions);
    locks.acquire({
      projectId, lockType: "visual", scope: "shot", targetId: "shot-001",
      startFrame: 0, endFrameExclusive: 600, owner: "editor-1", reason: "user is editing shot 1",
    }, view.revision);
    expect(running.host.revisions.controlRevision(projectId, view.revision))
      .toBeGreaterThan(view.control_revision);

    const response = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(request) },
    );
    // The stale control revision is refused, and nothing is created.
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "REVISION_CONFLICT" });
    expect(running.host.materializations.byProject(projectId)).toEqual([]);
  }, 300_000);

  it("moves a ready materialization stale when the range is locked afterwards", async () => {
    const { running, projectId, proposalId, comparisonId, comparison, assets, view } = await withTarget();
    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposalId}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(body({
        comparison_id: comparisonId, base_revision: view.revision,
        expected_source_digest: view.source_digest, control_revision: view.control_revision,
        segment_bindings: bindingsFor(comparison, proposalId, assets),
        idempotency_key: "m33-lock-after-1",
      })) },
    );
    expect(posted.status, await posted.clone().text()).toBe(202);
    const job = await posted.json() as { materialization_id: string };
    const row = await settle(running, job.materialization_id);
    expect(row.state).toBe("ready_for_adoption");

    // A real lock on the range the materialization proposes to replace.
    new LockService(running.host.revisions).acquire({
      projectId, lockType: "visual", scope: "shot", targetId: "shot-001",
      startFrame: 0, endFrameExclusive: 600, owner: "editor-2", reason: "user is editing shot 1",
    }, view.revision);

    const read = await fetch(`${running.origin}/api/migration/v1/materializations/${job.materialization_id}`,
      { headers: headers(running.origin, running.token) });
    expect(read.status).toBe(200);
    const after = await read.json() as MaterializationV1;
    expect(after.state).toBe("stale");
    expect(after.blocking_reasons).toContain("CONTROL_REVISION_CHANGED");
  }, 600_000);
});
