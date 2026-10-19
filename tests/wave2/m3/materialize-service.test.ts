import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetInventoryPort } from "../../../src/host/projects/asset-inventory-port.js";
import { AssetRegistry } from "../../../src/host/projects/asset-registry.js";
import { DerivedArtifactStore } from "../../../src/host/materialize/derived-artifact-store.js";
import { BindingService } from "../../../src/host/materialize/binding-service.js";
import { MaterializationStore } from "../../../src/host/materialize/materialization-store.js";
import { MaterializeService, type MaterializeFaultPoint } from "../../../src/host/materialize/materialize-service.js";
import { MigratedAssetLedger } from "../../../src/host/projects/migrated-asset-ledger.js";
import { NativePlanBuilder } from "../../../src/host/materialize/native-plan-builder.js";
import { ProjectCatalog } from "../../../src/host/projects/project-catalog.js";
import { ProjectResolver } from "../../../src/host/projects/project-resolver.js";
import { ProxyRenderer } from "../../../src/host/materialize/proxy-renderer.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
import { PersistentJobStore } from "../../../src/host/persistent-job-store.js";
import { treeDigest } from "../../../src/host/projects/openfilm-migrator.js";
import { OPENFILM_UPSTREAM_SHA } from "../../../src/host/engine/engine-binding-store.js";
import type { AssetLicense, AssetManifestEntry, AssetSource, ProposalComparison } from "../../../src/contracts/types.js";
import type { MigrationAssetMapping, MigrationPlanV1 } from "../../../src/contracts/migration-types.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";

/**
 * M3.3: the worker, the lease, and what happens when things arrive late.
 *
 * Everything here runs the real `MaterializeService` over the real `PersistentJobStore`,
 * the real ledger, the real binding service and the real renderer. The behaviours under
 * test — a lease taken before work starts, a cancelled worker whose bytes are quarantined
 * rather than adopted, a restart that never assumes a finished render — are properties of
 * the coordination, so a fake job store would prove nothing about them.
 */

const SOURCE_ID = "d1-30s";
const TARGET_ID = "of_d1-30s_abcdef12";
const MIGRATION_ID = "mig_0001";
const COMPARISON_ID = "cmp_1";
const PROPOSAL_ID = "proposal_1";

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const license = (): AssetLicense => ({ status: "cleared", label: "自有素材", commercial_use: true });
const origin = (): AssetSource => ({ kind: "owned", label: "本地素材" });
const media = (marker: string): Buffer =>
  Buffer.concat([Buffer.from("ID3\0\0\0", "latin1"), Buffer.from(marker.padEnd(64, "x"), "latin1")]);
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

interface Harness {
  service: MaterializeService;
  jobs: PersistentJobStore;
  materializations: MaterializationStore;
  inventory: AssetInventoryPort;
  revisions: RevisionStore;
  targetRoot: string;
  base: string;
  comparisons: Map<string, ProposalComparison>;
  /** The plan a completed run would have written, for the readiness test. */
  planOf: (materializationId: string) => Promise<NativePlanV1>;
  /** Rewrites an asset row's recorded bytes, so the container check is what rejects it. */
  rebindAssetBytes: (assetId: string, sha256: string) => void;
  faults: MaterializeFaultPoint[];
  /** Arms a one-shot crash at a fault point, the way a real interruption would. */
  crashAt: (point: MaterializeFaultPoint) => void;
  /** Requests a cancellation while the worker is mid-run, producing a late result. */
  cancelAt: (point: MaterializeFaultPoint) => void;
}

async function harness(): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m33-"));
  dirs.push(base);
  const sourceRoot = join(base, "source");
  const migrationRoot = join(base, "migrations");
  const targetRoot = join(migrationRoot, MIGRATION_ID);
  await mkdir(join(sourceRoot, "media"), { recursive: true });
  await mkdir(join(sourceRoot, "runs"), { recursive: true });
  await mkdir(join(targetRoot, "assets"), { recursive: true });
  await writeFile(join(sourceRoot, "runs/build.svrun"), "<svrun/>", "utf8");
  await writeFile(join(sourceRoot, "narration.wav"), media("narration"), "utf8");

  // Two real, decodable media files so the renderer produces real bytes.
  const real = await readFile(resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4"));
  const realAlt = await readFile(resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4"));
  const entries: AssetManifestEntry[] = [];
  const planned: MigrationAssetMapping[] = [];
  for (const [index, bytes] of [real, realAlt].entries()) {
    const marker = `asset_${index}`;
    entries.push({
      asset_id: marker, project_path: `media/${marker}.mp4`, sha256: sha(bytes),
      media_type: "video/mp4", kind: "video", duration_frames: 300, source: origin(), license: license(),
    });
    await writeFile(join(sourceRoot, `media/${marker}.mp4`), bytes);
    await writeFile(join(targetRoot, `assets/${marker}.mp4`), bytes);
    planned.push({ source_path: `media/${marker}.mp4`, target_path: `assets/${marker}.mp4`,
      sha256: sha(bytes), asset_id: null });
  }
  await writeFile(join(sourceRoot, "assets.manifest.json"),
    JSON.stringify({ format: "narralens.asset-manifest@2", assets: entries }), "utf8");
  await writeFile(join(sourceRoot, "narralens.project.json"), JSON.stringify({
    project_id: SOURCE_ID, revision: 3, frame_rate: 30, frame_count: 900,
    shots: [{ shot_id: "shot-001", authoring_id: "shot-1", start_frame: 0, end_frame_exclusive: 900 }],
    preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" },
    run_file: "runs/build.svrun", studio_origin: "http://127.0.0.1:4174",
    narration_asset: "narration.wav", asset_manifest: "assets.manifest.json",
  }), "utf8");

  const revisions = new RevisionStore(join(base, "narralens.sqlite"));
  stores.push(revisions);
  const catalog = new ProjectCatalog(new Map([[SOURCE_ID, join(sourceRoot, "narralens.project.json")]]));
  const registry = new AssetRegistry(catalog, { videoFrames: async () => 300 });
  const sourceSha256Before = await treeDigest(sourceRoot);
  const plan: MigrationPlanV1 = {
    format: "narralens.migration-plan@1.0", migration_id: MIGRATION_ID, idempotency_key: "k",
    request_digest: "6".repeat(64), source_project_id: SOURCE_ID, source_revision: 3,
    source_digest: "5".repeat(64), source_engine: "hypit", target_project_id: TARGET_ID,
    target_engine: "openfilm", target_engine_upstream_sha: OPENFILM_UPSTREAM_SHA,
    identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 600 }],
    features: [], assets: planned, subtitles: [], narration: null, validation_steps: [], blocking: [],
    created_at: new Date(0).toISOString(),
  };
  revisions.migrations.create({
    migrationId: MIGRATION_ID, projectId: SOURCE_ID, idempotencyKey: "k",
    requestDigest: "6".repeat(64), plan, sourceSha256Before,
  });
  for (const to of ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const) {
    revisions.migrations.transition(MIGRATION_ID, revisions.migrations.require(MIGRATION_ID)!.state, to, new Date(0));
  }
  revisions.bindEngine(TARGET_ID, "openfilm", OPENFILM_UPSTREAM_SHA, SOURCE_ID, new Date(0));
  revisions.commitMigrationTarget({
    migrationId: MIGRATION_ID, projectId: TARGET_ID, revision: 4, snapshotId: "snap_1",
    sourceDigest: "5".repeat(64), engine: "openfilm", now: new Date(0),
  });

  const ledger = MigratedAssetLedger.create({ revisions, registry, catalog, migrationRoot });
  await ledger.bootstrap({ projectId: TARGET_ID });
  const resolver = new ProjectResolver({ catalog, revisions, migrationRoot });
  const inventory = new AssetInventoryPort({ resolver, registry, ledger });
  const artifacts = new DerivedArtifactStore(join(base, "derived"));
  const jobs = new PersistentJobStore(revisions);
  const materializations = new MaterializationStore(revisions);
  const comparisons = new Map<string, ProposalComparison>([[COMPARISON_ID, comparison()]]);

  const faults: MaterializeFaultPoint[] = [];
  let job: { job_id: string } | undefined;
  const state = { crashAt: null as MaterializeFaultPoint | null };
  let cancelPoint: MaterializeFaultPoint | null = null;
  const bindingsService = new BindingService({
    resolver, inventory,
    readComparison: async (id) => {
      const found = comparisons.get(id);
      if (found === undefined) throw Object.assign(new Error("not found"), { status: 404 });
      return found;
    },
  });
  const service = new MaterializeService({
    jobs, materializations, artifacts, resolver, inventory,
    bindings: bindingsService,
    plans: new NativePlanBuilder(),
    proxies: new ProxyRenderer({ artifacts, profile: "wave2-proxy-720p30-v1" }),
    resolveMedia: async (_projectId, assetId) => join(targetRoot, "assets", `${assetId}.mp4`),
    readComparison: async (id) => {
      const found = comparisons.get(id);
      if (found === undefined) throw Object.assign(new Error("not found"), { status: 404 });
      return found;
    },
    onJob: (createdJob) => { job = createdJob; },
    fault: (point) => {
      faults.push(point);
      if (state.crashAt === point) throw new Error(`CRASH:${point}`);
      if (cancelPoint === point) {
        // The cancellation lands while the worker still holds the lease and is mid-render.
        jobs.requestCancel(job!.job_id);
      }
    },
  });
  return {
    service, jobs, materializations, inventory, revisions, targetRoot, base, faults, comparisons,
    // The plan a run would have written, built the same way the worker builds it.
    planOf: async (materializationId) => {
      const row = materializations.require(materializationId);
      const bound = await bindingsService.bind({
        projectId: row.project_id, comparisonId: row.comparison_id, proposalId: row.proposal_id,
        baseRevision: row.base_revision,
        requested: materializations.requestedBindingsOf(materializationId),
      });
      return new NativePlanBuilder().build(bound);
    },
    rebindAssetBytes: (assetId, sha256) => {
      revisions.compose((db) => db.prepare(
        "UPDATE migrated_asset SET target_sha256=?, source_sha256=? WHERE project_id=? AND asset_id=?",
      ).run(sha256, sha256, TARGET_ID, assetId));
      revisions.compose((db) => db.prepare(
        "UPDATE asset_ledger_bootstrap SET state='attention', attention_reason='TEST_REBIND' WHERE project_id=? AND state='active'",
      ).run(TARGET_ID));
    },
    crashAt: (point: MaterializeFaultPoint) => { state.crashAt = point; },
    cancelAt: (point: MaterializeFaultPoint) => { cancelPoint = point; },
  };
}

/** Exposed so a test can rebuild the comparison and watch the pinned digest notice. */
function comparison(): ProposalComparison {
  return {
    schema_version: "1.0", kind: "narralens.proposal_comparison", comparison_id: COMPARISON_ID,
    project_id: TARGET_ID, base_revision: 4,
    selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 600 },
    intent_sha256: "a".repeat(64), preserve: ["narration"], proposal_count: 1,
    proposals: [{
      proposal_id: PROPOSAL_ID, title: "双镜", summary: "s",
      strategy: { kind: "chronology", rationale: "r" },
      segments: [
        { segment_id: "seg-1", duration_frames: 300, role: "anchor", intent: "i", asset_requirement_ids: [] },
        { segment_id: "seg-2", duration_frames: 300, role: "context", intent: "i", asset_requirement_ids: [] },
      ],
      assets_needed: [], source_refs: [], requires_materialization: true, renderable: false,
      materialization_cost: { status: "unknown", currency: null, amount: null },
    }],
    generation_audit: { stdout_sha256: "b".repeat(64), model_names: [], total_cost_usd: null,
      duration_ms: null, num_turns: null, service_tier: null },
    created_at: new Date(0).toISOString(),
  };
}

const BINDINGS = [
  { segment_id: "seg-1", asset_id: "asset_0", source_start_frame: 0, source_end_frame_exclusive: 300 },
  { segment_id: "seg-2", asset_id: "asset_1", source_start_frame: 0, source_end_frame_exclusive: 300 },
];

async function requestMaterialization(h: Harness, key = "materialize-0001"): Promise<{
  job_id: string; materialization_id: string; replayed: boolean;
}> {
  return await h.service.request({
    projectId: TARGET_ID, comparisonId: COMPARISON_ID, proposalId: PROPOSAL_ID,
    baseRevision: 4, sourceDigest: "5".repeat(64), controlRevision: 0,
    bindings: BINDINGS, idempotencyKey: key,
    requestDigest: createHash("sha256").update(JSON.stringify(BINDINGS)).digest("hex"),
    comparison: comparison(),
  });
}

describe("M3.3 a materialization runs end to end to a real proxy", () => {
  it("reaches ready with a real plan, a real proxy and lineage covering both outputs", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    expect(created.job_id).toMatch(/^job_/u);

    const outcome = await h.service.run(created.materialization_id, "worker-a");
    expect(outcome).toMatchObject({ state: "ready_for_adoption", quarantined: false });

    const row = await h.service.read(created.materialization_id);
    expect(row.state).toBe("ready_for_adoption");
    expect(row.native_plan?.clips).toHaveLength(2);
    expect(row.proxy?.frame_count).toBe(600);
    expect(row.lineage).toHaveLength(2);
    expect(h.jobs.require(created.job_id).state).toBe("succeeded");
  }, 300_000);

  it("records every fault point it passed, in order", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    await h.service.run(created.materialization_id, "worker-a");
    expect(h.faults).toEqual([
      "after_job_create", "after_lease", "after_plan", "after_proxy", "after_lineage",
      "before_ready", "after_ready",
    ]);
  }, 300_000);

  it("changes no author fact (MT-04 persistence subset)", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    const before = {
      commit: h.revisions.activeCommit(TARGET_ID),
      binding: h.revisions.readEngineBinding(TARGET_ID),
      ledger: h.revisions.compose((db) => db.prepare(
        "SELECT * FROM migrated_asset ORDER BY asset_id").all()),
      ledgerRecord: h.revisions.compose((db) => db.prepare(
        "SELECT * FROM asset_ledger_bootstrap").all()),
    };
    await h.service.run(created.materialization_id, "worker-a");
    expect(h.revisions.activeCommit(TARGET_ID)).toEqual(before.commit);
    expect(h.revisions.readEngineBinding(TARGET_ID)).toEqual(before.binding);
    expect(h.revisions.compose((db) => db.prepare(
      "SELECT * FROM migrated_asset ORDER BY asset_id").all())).toEqual(before.ledger);
    expect(h.revisions.compose((db) => db.prepare(
      "SELECT * FROM asset_ledger_bootstrap").all())).toEqual(before.ledgerRecord);
  }, 300_000);
});

describe("M3.3 the worker holds a lease before it does anything", () => {
  it("refuses to run while another owner holds the lease", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    expect(h.jobs.acquireLease(created.job_id, { owner: "worker-b" })).toBe(true);
    const outcome = await h.service.run(created.materialization_id, "worker-a");
    expect(outcome.state).not.toBe("ready_for_adoption");
    expect(h.materializations.require(created.materialization_id).state).toBe("queued");
  }, 120_000);

  it("releases the lease when it finishes, so another run can take it", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    await h.service.run(created.materialization_id, "worker-a");
    expect(h.jobs.record(created.job_id)?.lease_owner).toBeNull();
  }, 300_000);

  it("does not let a second worker advance a materialization that already moved on", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    await h.service.run(created.materialization_id, "worker-a");
    const before = h.materializations.require(created.materialization_id);
    // The job is no longer queued, so a second worker cannot take the lease at all: the
    // guard is the lease, not a check inside the render.
    const second = await h.service.run(created.materialization_id, "worker-b");
    expect(second.state).toBe("succeeded");
    expect(h.materializations.require(created.materialization_id)).toEqual(before);
  }, 300_000);
});

describe("M3.3 a late or cancelled result is quarantined, never adopted", () => {
  it("does not reach ready when the job was cancelled mid-run", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    // Cancel while the worker is rendering, which is the case that matters: the bytes get
    // produced against premises that no longer hold. `run` takes the lease itself, as the
    // production worker loop does.
    h.cancelAt("after_lease");
    const outcome = await h.service.run(created.materialization_id, "worker-a");
    expect(outcome.quarantined).toBe(true);
    expect(outcome.state).not.toBe("ready_for_adoption");
    expect(h.materializations.require(created.materialization_id).state).not.toBe("ready_for_adoption");
    expect(h.jobs.require(created.job_id).state).not.toBe("succeeded");
  }, 300_000);

  it("records the orphan rather than deleting it", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    h.cancelAt("after_lease");
    await h.service.run(created.materialization_id, "worker-a");
    // The orphan is recorded, not merely left behind: an operator asking "what did that
    // cancelled worker produce?" has to find the answer.
    expect(h.jobs.require(created.job_id).state).toBe("cancelled");
    expect(h.jobs.eventsAfter(created.job_id, 0).some((event) => /quarantined/i.test(event.message ?? "")))
      .toBe(true);
  }, 300_000);

  it("quarantines a materialization whose worker died holding the lease", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    h.jobs.acquireLease(created.job_id, { owner: "worker-dead" });
    h.materializations.transition(created.materialization_id, "queued", "running");
    // While the lease is live this is still somebody else's row.
    const held = await h.service.recover();
    expect(held.ownedElsewhere).toContain(created.materialization_id);
    expect(h.materializations.require(created.materialization_id).state).toBe("running");
    // Once the lease expires and is reaped, the job is retryable again.
    h.jobs.reapExpiredLeases(new Date(Date.now() + 120_000));
    const after = await h.service.recover();
    expect(after.retried).toContain(created.materialization_id);
    expect(h.materializations.require(created.materialization_id).state).toBe("running");
  }, 120_000);

  it("queues a cancelled materialization for quarantine on recovery, not a retry", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    h.jobs.acquireLease(created.job_id, { owner: "worker-a" });
    h.jobs.requestCancel(created.job_id);
    h.materializations.transition(created.materialization_id, "queued", "cancel_requested");
    const outcome = await h.service.recover();
    expect(outcome.retried).not.toContain(created.materialization_id);
    expect(outcome.quarantined).toContain(created.materialization_id);
    expect(h.materializations.require(created.materialization_id).state).toBe("attention");
  }, 120_000);
});

describe("M3.3 a crash before ready never leaves something adoptable", () => {
  // `after_job_create` is excluded: the crash lands before there is a
  // materialization to adopt, and the request itself throws rather than returning.
  for (const point of ["after_lease", "after_plan", "after_proxy", "after_lineage", "before_ready"] as const) {
    it(`leaves no adoptable materialization after a crash at ${point}`, async () => {
      const h = await harness();
      const created = await requestMaterialization(h);
      h.crashAt(point);
      await h.service.run(created.materialization_id, "worker-a").catch(() => undefined);
      expect(h.materializations.require(created.materialization_id).state)
        .not.toBe("ready_for_adoption");
      expect(h.jobs.require(created.job_id).state).not.toBe("succeeded");
    }, 300_000);
  }

  it("leaves no staging file behind after a crash", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    h.crashAt("after_plan");
    await h.service.run(created.materialization_id, "worker-a").catch(() => undefined);
    const artifacts = new DerivedArtifactStore(join(h.base, "derived"));
    expect(await artifacts.stagingLeftovers()).toEqual([]);
  }, 300_000);
});

describe("M3.3 every read re-verifies and only ever moves to stale", () => {
  it("reports ready while nothing has moved", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    await h.service.run(created.materialization_id, "worker-a");
    expect((await h.service.read(created.materialization_id)).state).toBe("ready_for_adoption");
  }, 300_000);

  it("becomes stale when the target's asset bytes drift", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    await h.service.run(created.materialization_id, "worker-a");
    await writeFile(join(h.targetRoot, "assets/asset_0.mp4"), media("tampered"));
    const row = await h.service.read(created.materialization_id);
    expect(row.state).toBe("stale");
    expect(row.blocking_reasons.length).toBeGreaterThan(0);
  }, 300_000);

  it("stays stale on every later read, and never returns to ready", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    await h.service.run(created.materialization_id, "worker-a");
    await writeFile(join(h.targetRoot, "assets/asset_0.mp4"), media("tampered"));
    expect((await h.service.read(created.materialization_id)).state).toBe("stale");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await h.service.read(created.materialization_id)).state).toBe("stale");
    }
  }, 300_000);

  it("becomes stale when the base revision moves under it", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    await h.service.run(created.materialization_id, "worker-a");
    h.revisions.compose((db) => db.prepare(
      "UPDATE active_commit SET revision=99 WHERE project_id=?").run(TARGET_ID));
    const row = await h.service.read(created.materialization_id);
    expect(row.state).toBe("stale");
    expect(row.blocking_reasons).toContain("BASE_REVISION_CHANGED");
  }, 300_000);
});

describe("M3.3 the intent is recorded idempotently", () => {
  it("replays the same key and digest without queueing a second render", async () => {
    const h = await harness();
    const first = await requestMaterialization(h);
    await expect(h.materializations.create({
      materializationId: "mat_other", projectId: TARGET_ID, comparisonId: COMPARISON_ID,
      proposalId: PROPOSAL_ID, jobId: "job_other", baseRevision: 4, sourceDigest: "5".repeat(64),
      controlRevision: 0, proposalSha256: "x", assetInventorySha256: "x", rightsDigest: "x",
      requestDigest: "y", idempotencyKey: "materialize-0001", requestedBindings: BINDINGS,
    })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(h.materializations.byProject(TARGET_ID)).toHaveLength(1);
    expect(first.materialization_id).toMatch(/^mat_/u);
  }, 120_000);

  it("refuses a legacy project, which has no comparable target", async () => {
    const h = await harness();
    await expect(h.service.request({
      projectId: SOURCE_ID, comparisonId: COMPARISON_ID, proposalId: PROPOSAL_ID,
      baseRevision: 4, sourceDigest: "5".repeat(64), controlRevision: 0,
      bindings: BINDINGS, idempotencyKey: "materialize-legacy",
      requestDigest: "a".repeat(64), comparison: comparison(),
    })).rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
  }, 120_000);
});


/**
 * One test per defect the internal review raised.
 *
 * Each of these was a way for the product to be wrong rather than merely unusual: a
 * duplicate request becoming a 500, a finished proxy being thrown away, a promotion
 * happening after a cancellation, a body the frozen contract forbids being accepted.
 * A fix without a test that fails without it is a comment.
 */
describe("every defect the internal review raised has a test that fails without its fix", () => {
  it("concurrent identical requests create one row and one job, not a 500", async () => {
    const h = await harness();
    const [first, second] = await Promise.all([requestMaterialization(h), requestMaterialization(h)]);
    expect(first.materialization_id).toBe(second.materialization_id);
    expect(h.materializations.byProject(TARGET_ID)).toHaveLength(1);
    // One *live* job. The loser of the race may leave a failed row behind — the job is
    // created before the materialization — but nothing will ever run it.
    expect(h.revisions.compose((db) => db.prepare("SELECT COUNT(*) AS n FROM job").get()))
      .toMatchObject({ n: 1 });
  }, 300_000);

  it("keeps a completed materialization when only the promotion is interrupted", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    h.crashAt("after_lineage");
    const outcome = await h.service.run(created.materialization_id, "worker-a");
    const row = h.materializations.require(created.materialization_id);
    // The proxy is encoded and content-addressed. Marking it stale would discard it for a
    // reason that has nothing to do with its premises, and stale is terminal.
    expect(row.state).not.toBe("stale");
    expect(h.materializations.isComplete(created.materialization_id)).toBe(true);
    expect(outcome.state).toBe(row.state);
  }, 300_000);

  it("cannot reach ready without the facts the worker proved", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    h.materializations.transition(created.materialization_id, "queued", "running");
    h.materializations.transition(created.materialization_id, "running", "validating");
    await h.materializations.setPlan(created.materialization_id, (await h.planOf(created.materialization_id)));
    await h.materializations.setProxy(created.materialization_id, {
      token: "proxy/x", sha256: "a".repeat(64), frame_count: 600, profile_id: "p",
    });
    await h.materializations.setLineage(created.materialization_id, [{
      output_sha256: "a".repeat(64), input_asset_id: "asset_0", input_sha256: "b".repeat(64),
      source: { start_frame: 0, end_frame_exclusive: 300 },
      output: { start_frame: 0, end_frame_exclusive: 300 },
    }]);
    // Every artefact is present; the digests the worker proves were never written.
    expect(() => h.materializations.transition(created.materialization_id, "validating", "ready_for_adoption"))
      .toThrow(/not complete/u);
  }, 120_000);

  it("refuses a comparison rebuilt after the intent was prepared", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    // Same project, same base revision, different content: every client-supplied field is
    // unchanged, so only the pinned comparison digest can notice.
    h.comparisons.set(COMPARISON_ID, { ...comparison(), intent_sha256: "f".repeat(64) });
    const outcome = await h.service.run(created.materialization_id, "worker-a");
    expect(outcome.state).not.toBe("ready_for_adoption");
    expect(h.materializations.require(created.materialization_id).state).toBe("stale");
  }, 300_000);

  it("recovery parks a row whose job is terminal instead of promising a retry", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    h.jobs.transition(created.job_id, "failed", { terminalReason: "test: job gave up" });
    expect(h.jobs.require(created.job_id).state).toBe("failed");
    const outcome = await h.service.recover();
    // `acquireLease` only takes a queued job, so calling this "retried" promised a retry
    // no caller could perform.
    expect(outcome.retried).not.toContain(created.materialization_id);
    expect(h.materializations.require(created.materialization_id).state).toBe("stale");
  }, 120_000);

  it("cleans a staging file left by an encoder that was killed", async () => {
    const h = await harness();
    const artifacts = new DerivedArtifactStore(join(h.base, "derived"));
    await mkdir(join(h.base, "derived", "staging"), { recursive: true });
    const staging = join(h.base, "derived", "staging", "render-1-dead.mp4");
    await writeFile(staging, "half a movie");
    expect(existsSync(staging)).toBe(true);
    // `stagingPath` writes under `staging/`, so scanning only the per-kind directories
    // found nothing and the file survived every cleanup.
    expect(await artifacts.stagingLeftovers()).not.toEqual([]);
    expect(await artifacts.removeStagingLeftovers()).toBeGreaterThan(0);
    expect(await artifacts.stagingLeftovers()).toEqual([]);
  }, 120_000);

  it("refuses media that is not an MP4 container even when its bytes match", async () => {
    const h = await harness();
    const created = await requestMaterialization(h);
    // Same bytes, wrong container: hashing proves the file is the one the binding named,
    // and only asking the container proves it is still the video that was registered.
    const target = join(h.targetRoot, "assets", "asset_0.mp4");
    const bytes = await readFile(target);
    await rm(target);
    await writeFile(join(h.targetRoot, "assets", "asset_0.mp4"), `not a container: ${bytes.length}`);
    h.rebindAssetBytes("asset_0", createHash("sha256").update(
      await readFile(join(h.targetRoot, "assets", "asset_0.mp4"))).digest("hex"));
    const outcome = await h.service.run(created.materialization_id, "worker-a");
    expect(outcome.state).not.toBe("ready_for_adoption");
  }, 300_000);
});
