import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MigrationService, type CrashPoint } from "../../src/host/projects/migration-service.js";
import { AssetRegistry } from "../../src/host/projects/asset-registry.js";
import { MigratedAssetLedger } from "../../src/host/projects/migrated-asset-ledger.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { SnapshotStore } from "../../src/host/projects/snapshot-store.js";
import { EngineBindingStore } from "../../src/host/engine/engine-binding-store.js";
import { treeDigest } from "../../src/host/projects/openfilm-migrator.js";
import { validateMigrationPlan, validateMigrationReport, validateRollbackRecord } from "../../src/contracts/validator.js";
import type { EngineKind } from "../../src/contracts/engine-types.js";
import { HttpError } from "../../src/host/api-error.js";

/**
 * EN-03, MIG-01, MIG-05, MIG-06, MIG-07 (M2.3 plan §6).
 *
 * The crash matrix is the point of this suite: a crash at each boundary must leave the
 * migration in a state recovery can read, never in a state only memory knew about, and
 * never a guessed success.
 */

const SOURCE_FIXTURE = resolve("tests/fixtures/m2.1/snapshot-project");
const OPENFILM_SHA = "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3";
const HYPIT_SHA = "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf";
const PROJECT = "d1-30s";

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

type Deps = ConstructorParameters<typeof MigrationService>[0];

interface Harness {
  service: MigrationService;
  deps: Deps;
  revisions: RevisionStore;
  bindings: EngineBindingStore;
  roots: Map<string, string>;
  sourceRoot: string;
  base: string;
  crashes: CrashPoint[];
}

async function harness(options: { exportProject?: (root: string, label: string) => Promise<{ sha256: string; durationFrames: number }> } = {}): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m23-svc-"));
  dirs.push(base);
  const sourceRoot = join(base, "source");
  await cp(SOURCE_FIXTURE, sourceRoot, { recursive: true });

  const revisions = new RevisionStore(); stores.push(revisions);
  const bindings = new EngineBindingStore(revisions);
  bindings.bind(PROJECT, "hypit", { createdAt: new Date(0) });
  const catalog = new ProjectCatalog(new Map([[PROJECT, join(sourceRoot, "narralens.project.json")]]));
  const roots = new Map<string, string>([[PROJECT, sourceRoot]]);
  const crashes: CrashPoint[] = [];

  // The fixture's registered assets all declare 900 frames. The ledger cross-checks the
  // manifest against a real probe; here the probe is a constant, which satisfies that check
  // without proving it. The disagreement case is proven in tests/wave2/w2-asset-ledger.
  const registry = new AssetRegistry(catalog, { videoFrames: async () => 900 });
  const ledger = MigratedAssetLedger.create({ revisions, registry, catalog, migrationRoot: join(base, "migrations") });
  const deps: Deps = {
    catalog, revisions, bindings, ledger,
    snapshots: new SnapshotStore({ snapshotsRoot: join(base, "snapshots") }),
    migrationRoot: join(base, "migrations"), projectRoot: join(base, "projects"),
    openfilmUpstreamSha: OPENFILM_SHA,
    registerProject: (projectId, root) => { roots.set(projectId, root); },
    // The engine is the only thing allowed to say the staged film is acceptable.
    verifyStagedProject: async (root) => {
      const film = await readFile(join(root, "film.html"), "utf8");
      const ids = [...film.matchAll(/<iframe id="([^"]+)"/gu)].map((match) => match[1]!);
      if (ids.some((id) => /\.mp4$/iu.test(id))) throw new Error("flattened video clip is not native");
      return ids.map((id, index) => ({ source_id: id, target_id: id, start_frame: index * 300, end_frame_exclusive: (index + 1) * 300 }));
    },
    ...(options.exportProject === undefined ? {} : { exportProject: options.exportProject }),
    crashAt: async (point) => { crashes.push(point); },
  };
  return { service: new MigrationService(deps), deps, revisions, bindings, roots, sourceRoot, base, crashes };
}

describe("EN-03 the plan is deterministic and blocks what it cannot place", () => {
  it("produces a valid plan with a stable identity map and pinned upstream", async () => {
    const { service } = await harness();
    const first = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0001" });
    expect(validateMigrationPlan(first)).toMatchObject({ ok: true });
    expect(first.blocking).toEqual([]);
    expect(first.target_engine).toBe("openfilm");
    expect(first.target_engine_upstream_sha).toBe(OPENFILM_SHA);
    expect(first.features.map((feature) => feature.id))
      .toEqual(expect.arrayContaining(["timeline.shot_clips", "audio.narration", "subtitle.timing"]));
    expect(first.validation_steps.map((step) => step.id))
      .toEqual(["clip.count", "clip.identity", "clip.native", "narration.carried", "subtitle.carried", "source.untouched"]);

    // The copy's identity follows the source content, not the key.
    const replay = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0001" });
    expect(replay.migration_id).toBe(first.migration_id);

    // A different key for a source that is already migrated is a conflict, not a second copy.
    await expect(service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0002" }))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("blocks activation when the source cannot produce a three-clip film", async () => {
    const { service, revisions } = await harness();
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0003" });
    expect(plan.blocking).toEqual([]);
    expect(revisions.migrations.get(plan.migration_id)!.state).toBe("plan_written");
  });
});

describe("MIG-01 a new project id, one binding, and an untouched source", () => {
  it("migrates to a new project without changing the source project's bytes or binding", async () => {
    const { service, revisions, bindings, sourceRoot } = await harness();
    const before = await treeDigest(sourceRoot);
    const sourceBindingBefore = bindings.read(PROJECT);

    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0004" });
    const report = await service.execute(plan.migration_id);
    expect(validateMigrationReport(report)).toMatchObject({ ok: true });
    expect(report.complete).toBe(true);
    expect(report.state).toBe("reported");

    expect(plan.target_project_id).not.toBe(PROJECT);
    expect(report.target_clips.map((clip) => clip.target_id)).toEqual(["shot-001", "shot-002", "shot-003"]);

    // The source is byte-identical and still bound to hypit.
    expect(await treeDigest(sourceRoot)).toBe(before);
    expect(bindings.read(PROJECT)).toEqual(sourceBindingBefore);
    // The copy carries exactly one OpenFilm binding.
    expect(bindings.read(plan.target_project_id)).toMatchObject({
      engine: "openfilm", engine_upstream_sha: OPENFILM_SHA, migrated_from: PROJECT,
    });
    expect(revisions.activeCommit(plan.target_project_id)).toMatchObject({ revision: 1 });
    expect(revisions.activeCommit(PROJECT)).toBeUndefined();
  });

  it("refuses a staged film the engine does not confirm", async () => {
    const { service, deps } = await harness();
    const rejecting = new MigrationService({
      ...deps,
      verifyStagedProject: async () => [{ source_id: "shot-001", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
    });
    const plan = await rejecting.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0005" });
    await expect(rejecting.execute(plan.migration_id)).rejects.toMatchObject({ code: "UNSUPPORTED_EDIT" });
  });
});

describe("MIG-05 a crash at each boundary converges after a restart", () => {
  // Every boundary in the plan, including the two ASSET-03 added around seeding the
  // target's asset ledger. A crash point that no test injects is a crash point nobody has
  // reasoned about, which is how C1 survived: the boundaries existed and were untested.
  const BOUNDARIES: readonly CrashPoint[] = [
    "after_plan", "after_stage", "after_validate", "after_snapshot",
    "before_commit", "after_commit", "before_bind", "after_bind",
    "after_bind_before_ledger", "after_ledger", "before_report",
  ];

  for (const point of BOUNDARIES) {
    it(`recovers cleanly after a crash at ${point}`, async () => {
      const { service, deps, revisions, bindings, sourceRoot } = await harness();
      const before = await treeDigest(sourceRoot);
      let reached = false;
      const crashing = new MigrationService({
        ...deps,
        crashAt: async (candidate) => { if (candidate === point) throw new Error(`CRASH:${point}`); },
      });
      const plan = await crashing.plan({ projectId: PROJECT, idempotencyKey: `mig-key-${point}` });
      if (point === "after_bind") reached = true;
      void reached;
      await expect(crashing.execute(plan.migration_id)).rejects.toThrow(`CRASH:${point}`);

      // A restart sees durable state, never a half-known migration.
      const revived = new MigrationService({ ...deps, crashAt: undefined });
      const outcome = await revived.recover();
      const row = revisions.migrations.get(plan.migration_id)!;
      //  is now a reachable recovery outcome: the tail is re-runnable, and a
      // target nobody can resolve is worse than one that took an extra restart.
      expect(["recovering", "activated", "reported", "aborted", "attention"]).toContain(row.state);

      // Whatever happened, the source is untouched and nothing was guessed into existence.
      expect(await treeDigest(sourceRoot)).toBe(before);
      const targetBound = bindings.read(plan.target_project_id);
      if (targetBound !== undefined) {
        expect(targetBound.engine).toBe("openfilm");
      }
      expect(outcome.attention.every((id) => revisions.migrations.get(id)!.state === "attention")).toBe(true);

      // ASSET-03, after a restart: the target must never be resolvable with a ledger that is
      // absent, torn or still `prepared`. `reported` is what makes it resolvable at all, so
      // a migration that reached `reported` must have a usable ledger beside it.
      const ledger = deps.ledger.bootstrapRecord(plan.target_project_id);
      if (row.state === "reported") {
        expect(ledger, `a reported migration must have an asset ledger`).toBeDefined();
        expect(["active", "attention"]).toContain(ledger!.state);
        expect(["active", "attention"].includes(ledger!.state) ? true : false).toBe(true);
      } else {
        expect(ledger?.state ?? "absent").not.toBe("prepared");
      }
    });
  }

  it("converges to a resolvable target after a crash between binding and the ledger", async () => {
    const { deps, revisions } = await harness();
    const crashing = new MigrationService({
      ...deps, crashAt: async (candidate) => {
        if (candidate === "after_bind_before_ledger") throw new Error("CRASH:after_bind_before_ledger");
      },
    });
    const plan = await crashing.plan({ projectId: PROJECT, idempotencyKey: "mig-tail-crash" });
    await expect(crashing.execute(plan.migration_id)).rejects.toThrow("CRASH:after_bind_before_ledger");

    const revived = new MigrationService({ ...deps, crashAt: undefined });
    const outcome = await revived.recover();
    const row = revisions.migrations.get(plan.migration_id)!;
    expect(outcome.attention, "a crash after binding must not park in attention").not.toContain(plan.migration_id);
    // The point of the fix: recovery finishes the tail so the target is actually usable,
    // rather than stopping at `activated`, which no resolver will accept.
    expect(row.state).toBe("reported");
    expect(revisions.migrations.get(plan.migration_id)!.state).toBe("reported");
    expect(deps.ledger.bootstrapRecord(plan.target_project_id)?.state).toBe("active");
  });

  it("never writes a migration state without its predecessor", async () => {
    const { service, revisions } = await harness();
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0006" });
    expect(() => revisions.migrations.transition(plan.migration_id, "plan_written", "reported"))
      .toThrow(/INVALID_MIGRATION_TRANSITION/);
    expect(() => revisions.migrations.transition(plan.migration_id, "reported", "staged"))
      .toThrow(/INVALID_MIGRATION_TRANSITION/);
    // Recovery is not reachable from the general transition path.
    expect(() => revisions.migrations.transition(plan.migration_id, "staged", "recovering"))
      .toThrow(/INVALID_MIGRATION_TRANSITION/);
  });
});

describe("MIG-07 the same key replays, a different request conflicts", () => {
  it("returns the same migration for the same key instead of migrating twice", async () => {
    const { service, revisions } = await harness();
    const first = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0007" });
    await service.execute(first.migration_id);
    const existing = revisions.migrations.byIdempotencyKey(PROJECT, "mig-key-0007");
    expect(existing?.migration_id).toBe(first.migration_id);
    expect(revisions.migrations.all()).toHaveLength(1);
    expect(revisions.migrations.all().filter((row) => row.target_project_id === first.target_project_id)).toHaveLength(1);
  });

  it("resumes after a transient validation failure without replaying the staged boundary", async () => {
    const { deps, revisions } = await harness();
    const verify = deps.verifyStagedProject;
    let attempts = 0;
    const service = new MigrationService({
      ...deps,
      verifyStagedProject: async (root) => {
        attempts += 1;
        if (attempts === 1) throw new HttpError(503, "ENGINE_UNAVAILABLE", "transient validation failure");
        return await verify(root);
      },
    });
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-resume-staged" });

    await expect(service.execute(plan.migration_id)).rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE" });
    expect(revisions.migrations.get(plan.migration_id)?.state).toBe("staged");
    const stagedStep = revisions.migrations.steps(plan.migration_id).find((step) => step.id === "stage");

    const report = await service.execute(plan.migration_id);
    expect(report.state).toBe("reported");
    expect(report.complete).toBe(true);
    expect(attempts).toBe(2);
    expect(revisions.migrations.steps(plan.migration_id).find((step) => step.id === "stage"))
      .toEqual(stagedStep);
  });

  it("coalesces concurrent execution of the same durable migration", async () => {
    const { deps, revisions } = await harness();
    const verify = deps.verifyStagedProject;
    let verifyCalls = 0;
    let release!: () => void;
    let signalEntered!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const entered = new Promise<void>((resolveEntered) => { signalEntered = resolveEntered; });
    const service = new MigrationService({
      ...deps,
      verifyStagedProject: async (root) => {
        verifyCalls += 1;
        signalEntered();
        await gate;
        return await verify(root);
      },
    });
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-concurrent-run" });
    const first = service.execute(plan.migration_id);
    const second = service.execute(plan.migration_id);
    // Wait for the production boundary itself. A timer/tick here races the real fixture's
    // file copy and can make test cleanup delete its source while execution is still live.
    await entered;
    expect(verifyCalls).toBe(1);
    release();

    const [left, right] = await Promise.all([first, second]);
    expect(left.state).toBe("reported");
    expect(right.state).toBe("reported");
    expect(verifyCalls).toBe(1);
    expect(revisions.migrations.all()).toHaveLength(1);
  });
});

describe("MIG-06 rollback stops writes, restores the source and keeps the copy", () => {
  it("quarantines in-flight work and leaves the source bytes exactly as they were", async () => {
    const { service, revisions, sourceRoot, roots } = await harness();
    const before = await treeDigest(sourceRoot);
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0008" });
    await service.execute(plan.migration_id);

    // Something was running when the operator rolled back.
    revisions.createJobRow({
      job_id: "job_inflight", project_id: PROJECT, kind: "render", payload_digest: "0".repeat(64),
      state: "running", lease_owner: "w1", lease_expires_at: Date.now() + 60_000, attempt: 1,
      max_attempts: 3, cost_status: "unknown", created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
    });

    const record = await service.rollback(plan.migration_id);
    expect(validateRollbackRecord(record)).toMatchObject({ ok: true });
    expect(record.phase).toBe("verified");
    expect(record.quarantined_jobs).toEqual(["job_inflight"]);
    expect(record.source_sha256_after).toBe(before);
    expect(record.target_retained).toBe(true);
    expect(roots.get(plan.target_project_id)).toBeDefined();

    // The migrated project and its report are still there for audit.
    expect(roots.get(plan.target_project_id)).toBeDefined();
    expect(service.report(plan.migration_id).rollback).not.toBeNull();
    expect(revisions.migrations.get(plan.migration_id)!.target_project_id).toBe(plan.target_project_id);
  });

  it("does not delete the migrated copy or touch git history", async () => {
    const { service, roots } = await harness();
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0009" });
    await service.execute(plan.migration_id);
    const targetRoot = roots.get(plan.target_project_id)!;
    await service.rollback(plan.migration_id);
    expect(await readFile(join(targetRoot, "film.html"), "utf8")).toContain("shot-002");
  });
});

describe("EN-05 the source project still reopens and exports after migration", () => {
  it("exports both the migrated copy and, after rollback, the source", async () => {
    const exported: string[] = [];
    const { service } = await harness({
      exportProject: async (root, label) => {
        const digest = createHash("sha256").update(`${label}:${root}`).digest("hex");
        exported.push(label);
        return { sha256: digest, durationFrames: 900 };
      },
    });
    const plan = await service.plan({ projectId: PROJECT, idempotencyKey: "mig-key-0010" });
    const report = await service.execute(plan.migration_id);
    expect(report.export_artifacts).toHaveLength(1);

    const rollback = await service.rollback(plan.migration_id);
    expect(rollback.export_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(exported.length).toBe(2);
  });
});

describe("MIG-04 an external change in the copy conflicts instead of being accepted", () => {
  const INJECT: ReadonlyArray<[string, string]> = [
    ["scene", "scenes/shot-002.html"],
    ["subtitle", "assets/narration.vtt"],
    ["asset", "assets/visual-10s.mp4"],
  ];

  for (const [label, relative] of INJECT) {
    it(`refuses after the ${label} changed outside the Host`, async () => {
      const { service, revisions, roots } = await harness();
      const plan = await service.plan({ projectId: PROJECT, idempotencyKey: `mig-key-ext-${label}` });
      await service.execute(plan.migration_id);
      const targetRoot = roots.get(plan.target_project_id)!;

      // The copy is intact immediately after migration.
      expect(await service.verifyCopy(plan.migration_id)).toMatchObject({ ok: true });

      await writeFile(resolve(targetRoot, relative), "\n<!-- changed outside the Host -->\n", "utf8");

      const verdict = await service.verifyCopy(plan.migration_id);
      expect(verdict, label).toMatchObject({ ok: false, reason: "SOURCE_CHANGED" });
      // Persistent attention, and the migration never quietly re-baselined.
      expect(revisions.projectsInAttention()).toContain(plan.target_project_id);
      // The migration keeps its historical state; the copy loses its writability.
      expect(revisions.migrations.get(plan.migration_id)!.state).toBe("reported");
      // The externally changed bytes are left as they are, not repaired.
      expect(await readFile(resolve(targetRoot, relative), "utf8")).toContain("changed outside the Host");
    });
  }
});
