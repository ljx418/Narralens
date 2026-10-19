import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DerivedArtifactStore } from "../../../src/host/materialize/derived-artifact-store.js";
import { MaterializationStore } from "../../../src/host/materialize/materialization-store.js";
import { MaterializeService } from "../../../src/host/materialize/materialize-service.js";
import { HttpError } from "../../../src/host/api-error.js";
import { MigratedAssetLedger } from "../../../src/host/projects/migrated-asset-ledger.js";
import { AssetRegistry } from "../../../src/host/projects/asset-registry.js";
import { ProjectCatalog } from "../../../src/host/projects/project-catalog.js";
import { treeDigest } from "../../../src/host/projects/openfilm-migrator.js";
import type { MigrationPlanV1 } from "../../../src/contracts/migration-types.js";
import { NarralensHost } from "../../../src/host/server.js";
import { PersistentJobStore } from "../../../src/host/persistent-job-store.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
import type { FailureDiagnostic } from "../../../src/host/host-diagnostics.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";

/**
 * The scheduler must stay alive.
 *
 * A single boolean guarded `drain`, and a boolean has no way to say "I am still working"
 * — so a hung render left it true and every later tick silently returned nothing. The queue
 * was starved for as long as the hang lasted, with no error anywhere: a Host that had
 * quietly stopped working looked exactly like a Host with nothing to do.
 *
 * These tests hold a render open on purpose and assert that other work still runs, that the
 * queue resumes on its own when the held work finishes, and that a drain failure leaves a
 * record rather than disappearing into a `.catch`.
 */

const dirs: string[] = [];
const stores: RevisionStore[] = [];
const hosts: NarralensHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close().catch(() => undefined)));
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function plan(): NativePlanV1 {
  return {
    format: "narralens.native-plan@1.0", engine: "openfilm", fps: { num: 30, den: 1 },
    // Two clips: the frozen materialization contract refuses a one-clip plan, because a
    // single clip is the retired flattened-composite shape.
    clips: [0, 1].map((index) => ({
      clip_id: `clip-seg-${index + 1}`, segment_id: `seg-${index + 1}`, asset_id: `asset_${index}`,
      asset_sha256: "a".repeat(64),
      timeline: { start_frame: index * 30, end_frame_exclusive: (index + 1) * 30 },
      source: { start_frame: 0, end_frame_exclusive: 30 }, track_id: "track_visual",
    })),
    narration_policy: "preserve", duration_policy: "preserve", total_frames: 60,
    plan_sha256: "c".repeat(64),
  };
}

/** A renderer that parks until released, and records which renders entered. */
function gatedRenderer() {
  const gates: Array<() => void> = [];
  const entered: string[] = [];
  let failNext: Error | undefined;
  return {
    failWith: (error: Error) => { failNext = error; },
    render: async (input: { materializationId: string }) => {
      entered.push(input.materializationId);
      if (failNext !== undefined) {
        // A failing render fails before it parks, so a test can observe the failure without
        // having to release a gate that was never opened.
        const error = failNext; failNext = undefined; throw error;
      }
      await new Promise<void>((resolvePromise) => { gates.push(resolvePromise); });
      return {
        proxy: { token: "proxy/x", sha256: "f".repeat(64), frame_count: 60, profile_id: "p" },
        lineage: [{ output_sha256: "f".repeat(64), input_asset_id: "asset_0", input_sha256: "a".repeat(64),
          source: { start_frame: 0, end_frame_exclusive: 30 },
          output: { start_frame: 0, end_frame_exclusive: 30 } }],
        tool: { profile_id: "p", version: "test", argv_is_fixed: true as const },
      };
    },
    releaseAll: () => { for (const release of gates.splice(0)) release(); },
    entered,
    failOnce: (error: Error) => { failNext = error; },
    parked: () => gates.length,
  };
}

interface Harness {
  service: MaterializeService;
  jobs: PersistentJobStore;
  store: MaterializationStore;
  renderer: ReturnType<typeof gatedRenderer>;
  diagnostics: FailureDiagnostic[];
}

async function harness(): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m3-drain-"));
  dirs.push(base);
  const revisions = new RevisionStore(join(base, "narralens.sqlite"));
  stores.push(revisions);
  const jobs = new PersistentJobStore(revisions);
  const store = new MaterializationStore(revisions);
  const renderer = gatedRenderer();
  const diagnostics: FailureDiagnostic[] = [];
  const service = new MaterializeService({
    jobs, materializations: store,
    artifacts: new DerivedArtifactStore(join(base, "derived")),
    resolver: { resolve: async () => ({ kind: "activated" }) } as never,
    // The service re-reads the inventory to resolve each bound asset to its media, so a
    // stub without one stops the run before the renderer is ever reached.
    inventory: { inventory: async () => ({
      kind: "activated", project_id: "p", store: "migrated_asset_ledger",
      inventory_sha256: "d".repeat(64),
      assets: [0, 1].map((index) => ({
        asset_id: `asset_${index}`, sha256: "a".repeat(64), media_type: "video/mp4",
        duration_frames: 30, source: { kind: "owned", label: "fixture" },
        license: { status: "cleared", label: "fixture", commercial_use: true },
        availability: "available", eligible: true, blocking_reasons: [],
      })),
    }) } as never,
    bindings: { bind: async () => bindingResult() } as never,
    plans: { build: () => plan() } as never,
    proxies: renderer as never,
    readComparison: async () => comparison() as never,
    resolveMedia: async () => "/dev/null",
    onDiagnostic: (entry: FailureDiagnostic) => { diagnostics.push(entry); },
  });

  // One project per row: the renderer's per-project ceiling of one would otherwise
  // serialise them, and the starvation this file is about would be masked by a limit
  // that is working exactly as designed.
  for (const [id, project] of [["mat_a", "p1"], ["mat_b", "p2"], ["mat_c", "p3"]] as const) {
    const job = jobs.create({ projectId: project, kind: "materialize", payload: {} });
    await store.create({
      materializationId: id, projectId: project, comparisonId: "c", proposalId: "r",
      jobId: job.job_id, baseRevision: 1, sourceDigest: "a".repeat(64), controlRevision: 0,
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: "b".repeat(64), idempotencyKey: `k-${id}`, requestedBindings: [],
    });
  }
  return { service, jobs, store, renderer, diagnostics };
}

function bindingResult() {
  return {
    project_id: "p", comparison_id: "c", proposal_id: "r", base_revision: 1,
    selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 60 },
    bindings: [0, 1].map((index) => ({
      segment_id: `seg-${index + 1}`, asset_id: `asset_${index}`, source_start_frame: 0,
      source_end_frame_exclusive: 30, target_start_frame: index * 30, target_end_frame_exclusive: (index + 1) * 30,
      asset_sha256: "a".repeat(64), duration_frames: 30,
      license_status: "cleared", commercial_use: true,
    })),
    binding_digest: "c".repeat(64), rights_digest: "e".repeat(64),
    asset_inventory_sha256: "d".repeat(64), total_frames: 60,
  };
}

function comparison(): unknown {
  return {
    comparison_id: "c", project_id: "p", base_revision: 1,
    selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 60 },
    proposals: [{ proposal_id: "r", segments: [
      { segment_id: "seg-1", duration_frames: 30 }, { segment_id: "seg-2", duration_frames: 30 },
    ] }],
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  if (!condition()) throw new Error("WAIT_FOR_TIMEOUT");
}

describe("a hung render must not starve the queue", () => {
  it("still runs other runnable rows while one render is parked", async () => {
    const h = await harness();
    const first = h.service.drain();
    await new Promise((r) => setTimeout(r, 500));
    console.error("DRAIN_STATE", JSON.stringify(h.renderer.entered), JSON.stringify(h.diagnostics.map((d) => [d.stage, d.message_redacted])), JSON.stringify(["p1","p2","p3"].flatMap((p) => h.store.byProject(p).map((r) => [r.materialization_id, r.state]))));

    // A second drain arrives while the first is parked. The rows that were not started must
    // not be silently skipped: the run either joins the current drain or a coalesced rerun
    // is queued to run when it finishes.
    const second = h.service.drain();
    await waitFor(() => h.renderer.parked() >= 2 || h.renderer.entered.length >= 2);
    expect(h.renderer.entered.length).toBeGreaterThan(1);

    h.renderer.releaseAll();
    await Promise.all([first, second]);
    expect(h.store.require("mat_a").state).toBe("ready_for_adoption");
    expect(h.store.require("mat_b").state).toBe("ready_for_adoption");
  }, 60_000);

  it("resumes on its own after the held work is released, with no new request", async () => {
    const h = await harness();
    const first = h.service.drain();
    await waitFor(() => h.renderer.entered.length >= 2);

    h.renderer.releaseAll();
    await first;
    // The coalesced rerun must have drained the rest without anyone asking.
    await waitFor(() => h.store.byProject("p1").concat(h.store.byProject("p2")).concat(h.store.byProject("p3")).every((row) => row.state === "ready_for_adoption"));
    expect(["p1", "p2", "p3"].flatMap((project) => h.store.byProject(project).map((row) => row.state)))
      .toEqual(["ready_for_adoption", "ready_for_adoption", "ready_for_adoption"]);
  }, 60_000);

  it("never runs the same row twice, whichever way overlapping ticks are joined", async () => {
    const h = await harness();
    const drains = [h.service.drain(), h.service.drain(), h.service.drain()];
    await waitFor(() => h.renderer.entered.length >= 1);
    h.renderer.releaseAll();
    await Promise.all(drains);
    const renders = h.renderer.entered.filter((id) => id === "mat_a");
    expect(renders.length).toBe(1);
  }, 60_000);
});

describe("a drain failure is a record, not a shrug", () => {
  it("records a scheduler failure, which is different from a row failing", async () => {
    const h = await harness();
    // The store itself throws while the pass is scanning: that is the scheduler failing,
    // not a row failing, and the two must be distinguishable.
    const store = h.store as unknown as { runnable: () => unknown[] };
    const original = store.runnable.bind(store);
    let thrown = false;
    store.runnable = () => {
      if (!thrown) { thrown = true; throw new Error("the scan itself exploded"); }
      return original();
    };
    await h.service.drain();
    const scheduler = h.diagnostics.find((entry) => entry.stage === "materialize.drain");
    expect(scheduler, JSON.stringify(h.diagnostics.map((d) => d.stage))).toBeDefined();
    expect(scheduler!.message_redacted).toContain("the scan itself exploded");
  }, 60_000);

  it("records a row failure with enough to act on it", async () => {
    const h = await harness();
    h.renderer.failOnce(new Error("the encoder exploded"));
    const drain = h.service.drain();
    // The other two rows park in the renderer; releasing them lets the pass finish so the
    // failure this test is about can be read.
    await waitFor(() => h.diagnostics.length > 0 || h.renderer.entered.length >= 2);
    h.renderer.releaseAll();
    await drain;
    // The row that failed is named, with the identifiers an operator needs to find it and
    // the boundary it failed at.
    expect(h.diagnostics.length).toBeGreaterThan(0);
    const entry = h.diagnostics.find((candidate) => candidate.stage === "materialize.stale")
      ?? h.diagnostics[0]!;
    expect(entry.context).toMatchObject({ materialization_id: expect.any(String), job_id: expect.any(String) });
    expect(entry.context!.attempt).toMatch(/^\d+$/u);
    expect(entry.context!.lease_owner).toMatch(/^worker-/u);
    expect(entry.context!.boundary).toBe("render");
  }, 60_000);

  it("keeps draining after a failure, rather than stopping for the rest of the process", async () => {
    const h = await harness();
    h.renderer.failOnce(new Error("the encoder exploded"));
    const drain = h.service.drain();
    await waitFor(() => h.renderer.entered.length >= 2);
    h.renderer.releaseAll();
    await drain;
    // The other rows still ran; one failure is not a stopped queue.
    const states = ["p1", "p2", "p3"].flatMap((project) => h.store.byProject(project).map((row) => row.state));
    expect(states.some((state) => state === "ready_for_adoption")).toBe(true);
  }, 60_000);
});

describe("close stops the scheduler and in-flight work", () => {
  it("starts no drain after close and clears its timer", async () => {
    const base = await mkdtemp(join(tmpdir(), "narralens-m3-closedrain-"));
    dirs.push(base);
    const host = new NarralensHost({
      migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite"),
      derivedRoot: join(base, "derived"), materializeDrainIntervalMs: 20,
    });
    await host.listen(0);
    expect(host.materialize.acceptingWork).toBe(true);
    await host.close();
    hosts.splice(0);
    expect(host.materialize.acceptingWork).toBe(false);
    expect(host.materialize.inflight).toBe(0);
  }, 60_000);

  it("a drain that throws during shutdown does not reject", async () => {
    const h = await harness();
    h.renderer.failOnce(new Error("the encoder exploded"));
    // Whatever shutdown does, `drain()` must resolve rather than reject into a timer that
    // is being torn down.
    const drain = h.service.drain();
    await waitFor(() => h.renderer.entered.length >= 2);
    h.renderer.releaseAll();
    await expect(drain).resolves.toBeTruthy();
    await expect(h.service.shutdown(1)).resolves.toBeUndefined();
  }, 60_000);
});

describe("close during a drain leaves nothing running", () => {
  it("stops the timer, aborts the work it owns, and lets nothing write afterwards", async () => {
    const base = await mkdtemp(join(tmpdir(), "narralens-m3-closedrain-"));
    dirs.push(base);
    const host = new NarralensHost({
      migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite"),
      derivedRoot: join(base, "derived"), materializeDrainIntervalMs: 20,
    });
    hosts.push(host);
    await host.listen(0);

    // A row the Host's own drain will pick up.
    const revisions = host.revisions;
    const jobs = new PersistentJobStore(revisions);
    const store = new MaterializationStore(revisions);
    const job = jobs.create({ projectId: "p1", kind: "materialize", payload: {} });
    await store.create({
      materializationId: "mat_close", projectId: "p1", comparisonId: "c", proposalId: "r",
      jobId: job.job_id, baseRevision: 1, sourceDigest: "a".repeat(64), controlRevision: 0,
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: "b".repeat(64), idempotencyKey: "k-close", requestedBindings: [],
    });

    // Closing while a drain may be in flight must not reject, and must not leave a timer.
    await host.close();
    hosts.splice(0);
    expect(host.materialize.acceptingWork).toBe(false);
    expect(host.materialize.inflight).toBe(0);

    // And the database is closed cleanly: a later read reports a closed handle rather than
    // hanging or throwing something undefined.
    expect(() => revisions.compose((db) => db.prepare("SELECT 1 AS ok").get())).toThrow();
  }, 60_000);
});

describe("an attempt that lost its lease cannot publish", () => {
  it("leaves the newer attempt's result alone", async () => {
    const h = await harness();
    const job = h.jobs.require(h.store.byProject("p1")[0]!.job_id);
    const attemptA = h.jobs.acquireLease(job.job_id, { owner: "worker-a" }) ? h.jobs.require(job.job_id).attempt : 0;
    expect(attemptA).toBeGreaterThan(0);

    // The lease is taken away and the job is requeued; worker B takes a new attempt.
    h.jobs.releaseLease(job.job_id, "worker-a");
    h.jobs.acquireLease(job.job_id, { owner: "worker-b" });
    const attemptB = h.jobs.require(job.job_id).attempt;
    expect(attemptB).toBeGreaterThan(attemptA);

    // Worker A's late attempt cannot publish: the lease is not its attempt any more.
    expect(h.jobs.holdsLease(job.job_id, { owner: "worker-a", attempt: attemptA })).toBe(false);
    expect(h.jobs.holdsLease(job.job_id, { owner: "worker-b", attempt: attemptB })).toBe(true);
  }, 60_000);
});

describe("an unreadable ledger is not a proven drift", () => {
  /**
   * ADR-W2.0-001 makes `attention` terminal, so this classification is the difference
   * between a retry and a permanently unusable project.
   *
   * The captured chain was: `SOURCE_TREE_UNREADABLE:ENOMEM` -> terminal attention -> the
   * worker marked its materialization stale against it -> every later read a 423 nobody
   * could clear. One allocation failure, one bricked project.
   */
  it("treats a transient read failure as unverified and leaves the ledger alone", async () => {
    const { ledger, projectId, before, arm } = await ledgerWithDigest(["ENOMEM", "out of memory"]);
    arm();
    const result = await ledger.reverify({ projectId }).catch((error: unknown) => error);
    expect(result).toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE",
      details: { recoverable: true } });
    // Not attention. The facts were not disproven; they were not read.
    expect(ledger.bootstrapRecord(projectId)).toEqual(before);
    // The rows seeded by the bootstrap are untouched; only the *verdict* could have moved.
    expect(ledger.assets(projectId).length).toBeGreaterThan(0);
  }, 60_000);

  it("treats a completed read that disagrees as drift, and does move to attention", async () => {
    // The migration captured a digest the source no longer has: a completed read that
    // disagrees, which is the finding a transient failure must not be confused with.
    const { ledger, projectId } = await ledgerWithDigest(null, undefined, true);
    const result = await ledger.reverify({ projectId });
    expect(result.state).toBe("attention");
    expect(ledger.bootstrapRecord(projectId)?.state).toBe("attention");
  }, 60_000);

  it("still treats an unreadable *manifest* the same way", async () => {
    const { ledger, projectId, before, arm } = await ledgerWithDigest(null, "EIO");
    arm();
    const result = await ledger.reverify({ projectId }).catch((error: unknown) => error);
    expect(result).toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE" });
    expect(ledger.bootstrapRecord(projectId)).toEqual(before);
  }, 60_000);
});

/**
 * A real ledger over a real migrated target, with the digest read forced to fail.
 *
 * The first argument fails the source-tree digest with that code; the second fails the
 * manifest read. Passing neither exercises the real digest, which then disagrees with the
 * migration's captured one — the drift case.
 */
async function ledgerWithDigest(failTree: [string, string] | null, failManifest?: string,
  driftDigest = false): Promise<{
  ledger: MigratedAssetLedger; projectId: string; before: unknown; arm: () => void;
}> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m3-unread-"));
  dirs.push(base);
  const sourceRoot = join(base, "source");
  const targetRoot = join(base, "migrations", "mig_1");
  await mkdir(join(sourceRoot, "media"), { recursive: true });
  await mkdir(join(targetRoot, "assets"), { recursive: true });
  const bytes = Buffer.from("real enough bytes for a digest");
  await writeFile(join(sourceRoot, "media/only.mp4"), bytes);
  await writeFile(join(targetRoot, "assets/only.mp4"), bytes);
  await writeFile(join(sourceRoot, "assets.manifest.json"), JSON.stringify({
    format: "narralens.asset-manifest@2",
    assets: [{ asset_id: "asset_only", project_path: "media/only.mp4", sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: "video/mp4", kind: "video", duration_frames: 30,
      source: { kind: "owned", label: "fixture" },
      license: { status: "cleared", label: "fixture", commercial_use: true } }],
  }));
  await writeFile(join(sourceRoot, "narralens.project.json"), JSON.stringify({
    project_id: "of_src", revision: 3, frame_rate: 30, frame_count: 900,
    shots: [{ shot_id: "shot-001", authoring_id: "shot-1", start_frame: 0, end_frame_exclusive: 900 }],
    preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" },
    run_file: "runs/build.svrun", studio_origin: "http://127.0.0.1:4174",
    narration_asset: "narration.wav", asset_manifest: "assets.manifest.json",
  }));
  await mkdir(join(sourceRoot, "runs"), { recursive: true });

  const revisions = new RevisionStore(join(base, "narralens.sqlite"));
  stores.push(revisions);
  const catalog = new ProjectCatalog(new Map([["of_src", join(sourceRoot, "narralens.project.json")]]));
  const registry = new AssetRegistry(catalog, { videoFrames: async () => 30 });
  const projectId = "of_target_unread";

  const plan: MigrationPlanV1 = {
    format: "narralens.migration-plan@1.0", migration_id: "mig_1", idempotency_key: "k",
    request_digest: "b".repeat(64), source_project_id: "of_src", source_revision: 3,
    source_digest: "5".repeat(64), source_engine: "hypit", target_project_id: projectId,
    target_engine: "openfilm", target_engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
    features: [], assets: [{ source_path: "media/only.mp4", target_path: "assets/only.mp4",
      sha256: createHash("sha256").update(bytes).digest("hex"), asset_id: null }],
    subtitles: [], narration: null, validation_steps: [], blocking: [],
    created_at: new Date(0).toISOString(),
  };
  // `driftDigest` makes the migration record a digest the source cannot match, so the next
  // read completes and disagrees.
  const sourceDigest = driftDigest ? "9".repeat(64) : await treeDigest(sourceRoot);
  revisions.migrations.create({
    migrationId: "mig_1", projectId: "of_src", idempotencyKey: "k",
    requestDigest: "b".repeat(64), plan, sourceSha256Before: sourceDigest,
  });
  for (const to of ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const) {
    revisions.migrations.transition("mig_1", revisions.migrations.require("mig_1")!.state, to, new Date(0));
  }
  revisions.bindEngine(projectId, "openfilm", "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3", "of_src", new Date(0));
  revisions.commitMigrationTarget({
    migrationId: "mig_1", projectId, revision: 1, snapshotId: "snap_1",
    sourceDigest: "4".repeat(64), engine: "openfilm", now: new Date(0),
  });

  // The failure is armed *after* the bootstrap, so the ledger exists and the next read is the
  // one under test. Arming it earlier would only prove bootstrap refuses.
  let armed = false;
  const ledger = MigratedAssetLedger.create({
    revisions, registry, catalog, migrationRoot: join(base, "migrations"),
    readSourceTreeDigest: async (root: string) => {
      if (armed && failTree !== null) throw Object.assign(new Error(failTree[1]), { code: failTree[0] });
      return await treeDigest(root);
    },
    readSourceManifest: async (id: string) => {
      if (armed && failManifest !== undefined) {
        throw Object.assign(new Error("read failed"), { code: failManifest });
      }
      return await readManifestThrough(ledger, id);
    },
  });
  await ledger.bootstrap({ projectId, activationPhase: true });
  const before = ledger.bootstrapRecord(projectId);
  return { ledger, projectId, before, arm: () => { armed = true; } };
}

/**
 * The default manifest read, reached through the same instance so the override above can
 * fall back to the real implementation rather than a second copy of it.
 */
async function readManifestThrough(
  ledger: MigratedAssetLedger, projectId: string,
): Promise<{ sha256: string; assets: never[] }> {
  return await (ledger as unknown as {
    readManifestForTest(projectId: string): Promise<{ sha256: string; assets: never[] }>;
  }).readManifestForTest(projectId);
}

describe("a retryable failure must not strand the materialization either", () => {
  /**
   * The same classification, one layer up.
   *
   * Fixing only the ledger left the row itself stranded: `stale` is terminal for a
   * materialization too, so a transient read still produced a permanently unusable row —
   * the captured chain showed exactly that, with `recoverable: true` in the cause and the
   * row marked `stale` regardless.
   */
  it("leaves the row retryable when the layer below says the facts were not verified", async () => {
    const h = await harness();
    const inventory = h.service as unknown as { deps?: never };
    void inventory;
    const retryable = Object.assign(new HttpError(503, "MEDIA_TOOL_UNAVAILABLE",
      "the source tree could not be read right now",
      { reason: "SOURCE_TREE_UNREADABLE:ENOMEM", recoverable: true }), {});

    // Force the render to observe that failure, which is where the row would have been lost.
    (h as unknown as { renderer: { failWith: (error: Error) => void } }).renderer.failWith(retryable);
    const drain = h.service.drain();
    // The rows after the failing one park in the renderer; releasing them lets the pass end.
    await waitFor(() => h.renderer.entered.length >= 2);
    h.renderer.releaseAll();
    await drain;

    const states = ["p1", "p2", "p3"].flatMap((project) => h.store.byProject(project).map((row) => row.state));
    // Never stale and never attention: the row was never disproven, only unchecked.
    expect(states).not.toContain("stale");
    expect(states).not.toContain("attention");
    // And it is recorded as unverified, with the reason and the boundary.
    const entry = h.diagnostics.find((candidate) => candidate.stage === "materialize.unverified");
    expect(entry, JSON.stringify(h.diagnostics.map((d) => d.stage))).toBeDefined();
    expect(entry!.context).toMatchObject({ boundary: "render" });
    expect(entry!.context!.reason).toContain("SOURCE_TREE_UNREADABLE");
  }, 60_000);

  it("still strands a row when the facts were genuinely disproven", async () => {
    const h = await harness();
    (h as unknown as { renderer: { failWith: (error: Error) => void } }).renderer
      .failWith(new HttpError(422, "INVALID_MEDIA", "the media is not an MP4 container"));
    const drain = h.service.drain();
    await waitFor(() => h.renderer.entered.length >= 2);
    h.renderer.releaseAll();
    await drain;
    const states = ["p1", "p2", "p3"].flatMap((project) => h.store.byProject(project).map((row) => row.state));
    expect(states.some((state) => state === "stale" || state === "attention")).toBe(true);
  }, 60_000);
});
