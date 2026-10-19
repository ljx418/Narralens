import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProposalAdapter } from "../../../src/adapters/openmontage/proposal-adapter.js";
import { ProposalComparisonAdapter } from "../../../src/adapters/openmontage/proposal-comparison-adapter.js";
import { NarralensHost } from "../../../src/host/server.js";
import type { JobResponse, ProposalComparison, ProposalComparisonRequest } from "../../../src/contracts/types.js";
import type { MaterializationV1 } from "../../../src/contracts/wave2-types.js";

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
}

function headers(origin: string, token: string): Record<string, string> {
  return { origin, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function started(): Promise<Started> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m33-http-"));
  dirs.push(base);
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
  return { host, origin, token };
}

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Writes the target-owned comparison through the Host's own adapter.
 *
 * This is the C-07 replay path with no provider call: the draft is a recorded one and the
 * comparison is built against the *target's* facts, so the adapter — not this file — is
 * what sets the project id.
 */
async function seedComparison(running: Started, projectId: string, baseRevision: number): Promise<{ comparisonId: string; proposalId: string; built: ProposalComparison }> {
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
      option(1, [300, 300]),
      option(2, [150, 150, 150, 150]),
      option(3, [200, 200, 200]),
    ],
  };
  const request: ProposalComparisonRequest = {
    base_revision: baseRevision,
    selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 600 },
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
async function migrateTarget(startedHost: Started): Promise<{
  projectId: string; baseRevision: number; proposalId: string; comparisonId: string;
  comparison: ProposalComparison;
}> {
  const response = await fetch(`${startedHost.origin}/api/migration/v1/projects/d1-30s/migrate-copy`, {
    method: "POST", headers: headers(startedHost.origin, startedHost.token),
    body: JSON.stringify({ idempotency_key: "m33-http-migrate-1" }),
  });
  if (response.status !== 200) {
    throw new Error(`MIGRATE_${response.status}: ${(await response.text()).slice(0, 300)}`);
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


    const outcome = await running.host.materialize.run(job.materialization_id, "worker-http");
    if (outcome.state !== "ready_for_adoption") {
      const row = await running.host.materialize.read(job.materialization_id);
      throw new Error(`RUN_${outcome.state} row=${JSON.stringify({ state: row.state, blocking: row.blocking_reasons, comparison: comparisonId })}`);
    }

    const read = await fetch(`${running.origin}/api/migration/v1/materializations/${job.materialization_id}`,
      { headers: headers(running.origin, running.token) });
    expect(read.status).toBe(200);
    const row = await read.json() as MaterializationV1;
    expect(row).toMatchObject({ format: "narralens.materialization@1.0", state: "ready_for_adoption" });
    expect(row.native_plan?.clips).toHaveLength(2);
    expect(row.proxy?.frame_count).toBe(600);
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
        segment_bindings: bindingsFor(comparison, proposalId, assets),
        idempotency_key: "m33-http-materialize-4",
      }) },
    );
    expect(posted.status, await posted.clone().text()).toBe(202);
    const job = await posted.json() as { materialization_id: string };
    await running.host.materialize.run(job.materialization_id, "worker-http");

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
