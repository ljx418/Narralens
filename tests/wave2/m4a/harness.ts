import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalAdapter } from "../../../src/adapters/openmontage/proposal-adapter.js";
import { ProposalComparisonAdapter } from "../../../src/adapters/openmontage/proposal-comparison-adapter.js";
import { NarralensHost } from "../../../src/host/server.js";
import type { AdoptionFaultBoundary } from "../../../src/host/adoption/adoption-coordinator.js";
import { planDigest, VISUAL_TRACK_ID } from "../../../src/host/materialize/native-plan-builder.js";
import type { MaterializationV1, NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import type { ActivatedProjectView } from "../../../src/host/projects/project-resolver.js";
import type { PublishBoundary } from "../../../src/host/adoption/author-source-publisher.js";

/**
 * The M4A test harness.
 *
 * Everything here is real except the encoding. A host runs on a real temporary directory,
 * migrates a real project through the Host's own route against the pinned OpenFilm checkout,
 * and the impact route is reached over HTTP with a real session token. What is *not* real
 * is the proxy encode: the M4A tests are about authorization arithmetic and the projection
 * seam, and a 900-frame transcode per test would add minutes without changing a single
 * assertion, so `readyMaterialization` writes the row the worker would have written, using
 * the store's own guarded setters and a plan built by the store's own plan digest.
 *
 * `M4A-R01` is the exception and says so: it runs the real materialize route and a real
 * encode, because that test's claim is about the route as clients walk it.
 *
 * Everything is headless and offline: no browser, no window, no network beyond loopback, no
 * provider call and no payment. The one external input is the pinned OpenFilm checkout, read
 * from the same path production reads.
 */

export const REAL_UPSTREAM_PARENT = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b";

export interface Started {
  readonly host: NarralensHost;
  readonly origin: string;
  readonly token: string;
  readonly base: string;
}

export interface Migrated {
  readonly projectId: string;
  readonly view: ActivatedProjectView;
}

export function headers(origin: string, token: string): Record<string, string> {
  return { origin, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** A host over a fresh temporary directory. */
export async function start(options: {
  readonly impactClock?: () => Date;
  readonly impactFault?: (point: string) => Promise<void> | void;
  readonly adoptionFault?: (boundary: AdoptionFaultBoundary) => Promise<void> | void;
  readonly adoptionPublishFault?: (boundary: PublishBoundary) => Promise<void> | void;
} = {}): Promise<Started> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m4a-"));
  process.env.NARRALENS_OPENFILM_VENDOR = REAL_UPSTREAM_PARENT;
  const host = new NarralensHost({
    migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite"),
    derivedRoot: join(base, "derived"), snapshotsRoot: join(base, "snapshots"),
    adoptionStagingRoot: join(base, "adoption-stage"),
    // Comparisons live in the test's own tree; the default `var/` belongs to the repository
    // and this suite must not write to it.
    proposals: new ProposalAdapter(join(base, "proposals")),
    comparisons: new ProposalComparisonAdapter(join(base, "proposal-comparisons")),
    ...options,
  });
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as
    { token: string }).token;
  return { host, origin, token, base };
}

/** A host over an *existing* working directory: how a restart is modelled. */
export async function startOn(base: string, options: {
  readonly impactClock?: () => Date;
  readonly impactFault?: (point: string) => Promise<void> | void;
  readonly adoptionFault?: (boundary: AdoptionFaultBoundary) => Promise<void> | void;
  readonly adoptionPublishFault?: (boundary: PublishBoundary) => Promise<void> | void;
} = {}): Promise<Started> {
  process.env.NARRALENS_OPENFILM_VENDOR = REAL_UPSTREAM_PARENT;
  const host = new NarralensHost({
    migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite"),
    derivedRoot: join(base, "derived"), snapshotsRoot: join(base, "snapshots"),
    adoptionStagingRoot: join(base, "adoption-stage"),
    proposals: new ProposalAdapter(join(base, "proposals")),
    comparisons: new ProposalComparisonAdapter(join(base, "proposal-comparisons")),
    ...options,
  });
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as
    { token: string }).token;
  return { host, origin, token, base };
}

export async function stopAll(hosts: readonly NarralensHost[], dirs: readonly string[]): Promise<void> {
  await Promise.all(hosts.map((host) => host.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

/** Migrate the real fixture through the Host's own route. */
export async function migrate(running: Started, idempotencyKey = "m4a-migrate-1"): Promise<Migrated> {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/d1-30s/migrate-copy`, {
    method: "POST", headers: headers(running.origin, running.token),
    body: JSON.stringify({ idempotency_key: idempotencyKey }),
  });
  if (response.status !== 200) {
    throw new Error(`MIGRATE_${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const report = await response.json() as { plan: { target_project_id: string } };
  const projectId = report.plan.target_project_id;
  return { projectId, view: await running.host.projectResolver.resolveActivated(projectId) };
}

/**
 * A plan that covers the whole migrated target, so adopting it does not change duration.
 *
 * The three-shot fixture is 900 frames; two 450-frame segments give a contiguous cover whose
 * total equals the projection's visual extent, which is the only shape M4A can express.
 */
export function coveringPlan(host: NarralensHost, projectId: string,
  frameCount = 900, segments = 2): NativePlanV1 {
  const assets = host.assetLedger.assets(projectId)
    .filter((asset) => !/\.(vtt|srt)$/iu.test(asset.target_path));
  if (assets.length === 0) throw new Error(`NO_ASSETS:${projectId}`);
  const per = Math.floor(frameCount / segments);
  const clips = Array.from({ length: segments }, (_unused, index) => {
    const asset = assets[index % assets.length]!;
    const start = index * per;
    const end = index === segments - 1 ? frameCount : start + per;
    return {
      clip_id: `clip-${index}`, segment_id: `s_${index}`, asset_id: asset.asset_id,
      asset_sha256: asset.target_sha256, track_id: VISUAL_TRACK_ID,
      timeline: { start_frame: start, end_frame_exclusive: end },
      source: { start_frame: 0, end_frame_exclusive: end - start },
    };
  });
  const spec = {
    format: "narralens.native-plan@1.0" as const, engine: "openfilm" as const,
    fps: { num: 30 as const, den: 1 as const }, clips,
    narration_policy: "preserve" as const, duration_policy: "preserve" as const,
    total_frames: frameCount,
  };
  return { ...spec, plan_sha256: planDigest(spec) };
}

/**
 * The materialization a worker would have left behind: proven facts, a real plan digest, and
 * the three digests an impact re-verifies against.
 *
 * Every write goes through the store's own guarded setters and its own predecessor-checked
 * transitions, so a row that could not exist in production cannot be produced here either.
 */
export async function readyMaterialization(host: NarralensHost, projectId: string,
  key = "m4a-materialize-1", planOverride?: NativePlanV1): Promise<MaterializationV1> {
  const view = await host.projectResolver.resolveActivated(projectId);
  const inventory = await host.assetInventory.inventory(projectId);
  const plan = planOverride ?? coveringPlan(host, projectId, view.frame_count);
  const materializationId = `mat_${key.replace(/[^A-Za-z0-9]/gu, "")}`;
  await host.materializations.create({
    materializationId, projectId, comparisonId: `cmp_${key}`, proposalId: `pro_${key}`,
    jobId: `job_${key}`, baseRevision: view.revision, sourceDigest: view.source_digest,
    controlRevision: view.control_revision,
    // Bound to the *current* inventory so the impact's rights check has something real to
    // agree with. The digest below is a shape-correct *stand-in*, not the binding service's
    // real digest: the impact only ever compares it for equality with the row, and the real
    // `BindingService` path — which does produce a production `rights_digest` — is exercised
    // end to end in `impact-real-chain.test.ts`. Saying it "uses the same shape" would have
    // been true of the 64 hex characters and false of the value.
    proposalSha256: "0".repeat(64), assetInventorySha256: inventory.inventory_sha256,
    rightsDigest: testRightsDigest(inventory.inventory_sha256, plan),
    requestDigest: "1".repeat(64), idempotencyKey: key,
    requestedBindings: plan.clips.map((clip) => ({
      segment_id: clip.segment_id, asset_id: clip.asset_id,
      source_start_frame: clip.source.start_frame, source_end_frame_exclusive: clip.source.end_frame_exclusive,
    })),
  });
  host.materializations.transition(materializationId, "queued", "running");
  host.materializations.transition(materializationId, "running", "validating");
  await host.materializations.setPlan(materializationId, plan);
  const proxySha256 = "2".repeat(64);
  await host.materializations.setProxy(materializationId, {
    token: `proxies/${materializationId}.mp4`, sha256: proxySha256,
    frame_count: plan.total_frames, profile_id: "wave2-proxy-720p30-v1",
  });
  // The store refuses to promote a row whose proxy is not covered by its lineage, so the
  // last segment is given the proxy's own digest. That is not a shortcut around the check:
  // the check is that every produced output is attributed, and this attributes it.
  await host.materializations.setLineage(materializationId, plan.clips.map((clip, index) => ({
    output_sha256: index === plan.clips.length - 1 ? proxySha256 : `3${index}`.padEnd(64, "0"),
    input_asset_id: clip.asset_id, input_sha256: clip.asset_sha256,
    source: clip.source, output: clip.timeline,
  })));
  host.materializations.transition(materializationId, "validating", "ready_for_adoption");
  return host.materializations.require(materializationId);
}

/**
 * A real digest, not a readable placeholder.
 *
 * `ImpactSpecV1.rights_digest` is pattern-constrained to 64 lowercase hex, and the route
 * validates every spec it is about to return. A placeholder like `rights_abc123` is caught
 * there — which is the contract working, but it makes a test about something else fail for
 * an unrelated reason, so the harness produces a value of the right shape.
 */
function testRightsDigest(inventorySha256: string, plan: NativePlanV1): string {
  return createHash("sha256").update("narralens-rights-v1\n")
    .update(`${inventorySha256}:${plan.plan_sha256}`).digest("hex");
}

/** POST the impact route and return the raw response plus its parsed body. */
export async function postImpact(running: Started, projectId: string, body: unknown): Promise<{
  status: number; body: Record<string, unknown>;
}> {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/impact`, {
    method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) as Record<string, unknown> };
}

/** The body a client builds from the project's own facts — never anything it computed. */
export function adoptBody(view: ActivatedProjectView, materializationId: string, key: string): Record<string, unknown> {
  return {
    format: "narralens.impact-request@1.0",
    base_revision: view.revision,
    expected_source_digest: view.source_digest,
    control_revision: view.control_revision,
    intent: { op: "adopt_materialization", materialization_id: materializationId },
    idempotency_key: key,
  };
}
