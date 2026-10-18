import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetRegistry } from "../../src/host/projects/asset-registry.js";
import { MigratedAssetLedger, type LedgerBootstrapFaultPoint } from "../../src/host/projects/migrated-asset-ledger.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { treeDigest } from "../../src/host/projects/openfilm-migrator.js";
import { OPENFILM_UPSTREAM_SHA } from "../../src/host/engine/engine-binding-store.js";
import type { AssetManifestEntry, AssetLicense, AssetSource } from "../../src/contracts/types.js";
import type { MigrationAssetMapping, MigrationPlanV1 } from "../../src/contracts/migration-types.js";

/**
 * W2.0 correction, blocker 5: ASSET-03 has to be atomic, and it was not.
 *
 * The first implementation committed the `prepared` bootstrap record and every asset row
 * in one transaction, then transitioned to `active` in a second. A crash between the two
 * left a durable `prepared` record: a project that looks bootstrapped, holds no usable
 * facts, and can never leave `prepared` because nothing moves it forward.
 *
 * The requirement is "either fully visible or nothing", and a half-state nobody can
 * classify is exactly what it forbids. These cases inject a fault at each point inside the
 * seeding transaction and assert the database afterwards holds either a complete `active`
 * ledger or nothing at all — never `prepared`, never rows without a record.
 */

const SOURCE_ID = "d1-30s";
const TARGET_ID = "of_d1-30s_abcdef12";
const MIGRATION_ID = "mig_0001";

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const license = (): AssetLicense => ({ status: "cleared", label: "自有素材", commercial_use: true });
const source = (): AssetSource => ({ kind: "owned", label: "本地素材" });
const media = (marker: string): Buffer =>
  Buffer.concat([Buffer.from("ID3\0\0\0", "latin1"), Buffer.from(marker.padEnd(64, "x"), "latin1")]);
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

interface Harness {
  ledger: MigratedAssetLedger;
  revisions: RevisionStore;
  sourceRoot: string;
}

async function harness(fault?: (point: LedgerBootstrapFaultPoint) => void,
  options: { seed?: boolean; migrationState?: "in_flight" } = {}): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-w2-asset03-"));
  dirs.push(base);
  const sourceRoot = join(base, "source");
  const migrationRoot = join(base, "migrations");
  const targetRoot = join(migrationRoot, MIGRATION_ID);
  await mkdir(join(sourceRoot, "media"), { recursive: true });
  await mkdir(join(sourceRoot, "runs"), { recursive: true });
  await mkdir(join(targetRoot, "assets"), { recursive: true });
  await writeFile(join(sourceRoot, "runs/build.svrun"), "<svrun/>", "utf8");
  await writeFile(join(sourceRoot, "narration.wav"), media("narration"), "utf8");

  const entries: AssetManifestEntry[] = [];
  const planned: MigrationAssetMapping[] = [];
  for (const marker of ["a", "b"]) {
    const bytes = media(marker);
    entries.push({
      asset_id: `asset_${marker}`, project_path: `media/${marker}.mp4`, sha256: sha(bytes),
      media_type: "video/mp4", kind: "video", duration_frames: 300, source: source(), license: license(),
    });
    await writeFile(join(sourceRoot, `media/${marker}.mp4`), bytes);
    await writeFile(join(targetRoot, `assets/${marker}.mp4`), bytes);
    planned.push({ source_path: `media/${marker}.mp4`, target_path: `assets/${marker}.mp4`, sha256: sha(bytes), asset_id: null });
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

  const revisions = new RevisionStore();
  stores.push(revisions);
  const catalog = new ProjectCatalog(new Map([[SOURCE_ID, join(sourceRoot, "narralens.project.json")]]));
  const registry = new AssetRegistry(catalog, { videoFrames: async () => 300 });
  const sourceSha256Before = await treeDigest(sourceRoot);
  const plan: MigrationPlanV1 = {
    format: "narralens.migration-plan@1.0", migration_id: MIGRATION_ID, idempotency_key: "k",
    request_digest: "6".repeat(64), source_project_id: SOURCE_ID, source_revision: 3,
    source_digest: "5".repeat(64), source_engine: "hypit", target_project_id: TARGET_ID,
    target_engine: "openfilm", target_engine_upstream_sha: OPENFILM_UPSTREAM_SHA,
    identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
    features: [], assets: planned, subtitles: [], narration: null, validation_steps: [], blocking: [],
    created_at: new Date(0).toISOString(),
  };
  revisions.migrations.create({
    migrationId: MIGRATION_ID, projectId: SOURCE_ID, idempotencyKey: "k",
    requestDigest: "6".repeat(64), plan, sourceSha256Before,
  });
  const forward = options.migrationState === "in_flight"
    ? ["staged", "validated"] as const
    : ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const;
  for (const to of forward) {
    revisions.migrations.transition(MIGRATION_ID, revisions.migrations.require(MIGRATION_ID)!.state, to, new Date(0));
  }
  revisions.bindEngine(TARGET_ID, "openfilm", OPENFILM_UPSTREAM_SHA, SOURCE_ID, new Date(0));
  revisions.commitMigrationTarget({
    migrationId: MIGRATION_ID, projectId: TARGET_ID, revision: 1, snapshotId: "snap_1",
    sourceDigest: "4".repeat(64), engine: "openfilm", now: new Date(0),
  });

  const ledger = MigratedAssetLedger.create({
    revisions, registry, catalog, migrationRoot, ...(fault === undefined ? {} : { fault }),
  });
  if (options.seed !== false && options.migrationState !== "in_flight") {
    await ledger.bootstrap({ projectId: TARGET_ID });
  }
  return { ledger, revisions, sourceRoot };
}

describe("blocker 5a: the seeding transaction is all-or-nothing", () => {
  it("commits the record, the rows and the active state in one transaction", async () => {
    const { ledger, revisions } = await harness();
    const seen: LedgerBootstrapFaultPoint[] = [];
    // Re-run against a fresh ledger so the fault can observe the real sequence.
    const result = await ledger.bootstrap({ projectId: TARGET_ID });
    expect(result.state).toBe("active");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("active");
    expect(seen).toEqual([]);
    // And there is no `prepared` row anywhere.
    expect(revisions.compose((db) => db.prepare(
      "SELECT COUNT(*) AS n FROM asset_ledger_bootstrap WHERE state='prepared'").get()))
      .toMatchObject({ n: 0 });
  });

  it.each(["after_prepared", "after_rows", "before_active"] as LedgerBootstrapFaultPoint[])(
    "leaves nothing behind when it faults at %s", async (point) => {
      const reached: LedgerBootstrapFaultPoint[] = [];
      const { ledger, revisions } = await harness((candidate) => {
        reached.push(candidate);
        if (candidate === point) throw new Error(`FAULT:${point}`);
      }, { seed: false });
      await expect(ledger.bootstrap({ projectId: TARGET_ID })).rejects.toThrow(`FAULT:${point}`);
      expect(reached).toContain(point);

      const records = revisions.compose((db) => db.prepare(
        "SELECT * FROM asset_ledger_bootstrap WHERE project_id=?",
      ).all(TARGET_ID)) as unknown[];
      const rows = revisions.compose((db) => db.prepare(
        "SELECT * FROM migrated_asset WHERE project_id=?",
      ).all(TARGET_ID)) as unknown[];
      // Either fully absent or complete; never `prepared`, never rows alone.
      expect(records.length, "records").toBe(0);
      expect(rows.length, "rows").toBe(0);
      expect(ledger.bootstrapRecord(TARGET_ID)).toBeUndefined();
      expect(ledger.assets(TARGET_ID)).toEqual([]);
    });

  it("is retryable after a fault, because nothing was left to collide with", async () => {
    let armed = true;
    const { ledger, revisions } = await harness((point) => {
      if (armed && point === "after_rows") { armed = false; throw new Error("FAULT:once"); }
    }, { seed: false });
    await expect(ledger.bootstrap({ projectId: TARGET_ID })).rejects.toThrow("FAULT:once");
    expect(ledger.bootstrapRecord(TARGET_ID)).toBeUndefined();

    const retry = await ledger.bootstrap({ projectId: TARGET_ID });
    expect(retry).toMatchObject({ state: "active", seeded: 2 });
    expect(ledger.assets(TARGET_ID)).toHaveLength(2);
    // A single committed record, not two.
    expect(revisions.compose((db) => db.prepare(
      "SELECT COUNT(*) AS n FROM asset_ledger_bootstrap WHERE project_id=?",
    ).get(TARGET_ID))).toMatchObject({ n: 1 });
  });

  it("never reports active with a missing or partial row set", async () => {
    const { ledger, revisions } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    const record = ledger.bootstrapRecord(TARGET_ID)!;
    const rows = ledger.assets(TARGET_ID);
    expect(record.state).toBe("active");
    expect(rows.length).toBeGreaterThan(0);
    // Every row belongs to the same migration and target as the record.
    expect(new Set(rows.map((row) => row.migration_id))).toEqual(new Set([record.migration_id]));
    expect(new Set(rows.map((row) => row.project_id))).toEqual(new Set([TARGET_ID]));
    expect(revisions.compose((db) => db.prepare(
      "SELECT COUNT(*) AS n FROM migrated_asset WHERE project_id=?",
    ).get(TARGET_ID))).toMatchObject({ n: 2 });
  });

  it("keeps the source project byte-identical through a seeding failure", async () => {
    let armed = true;
    const { ledger, sourceRoot } = await harness((point) => {
      if (armed && point === "before_active") { armed = false; throw new Error("FAULT:before_active"); }
    }, { seed: false });
    const before = await treeDigest(sourceRoot);
    await expect(ledger.bootstrap({ projectId: TARGET_ID })).rejects.toThrow();
    expect(await treeDigest(sourceRoot)).toBe(before);
  });
});

describe("blocker 5b: a target is never resolvable with the ledger missing", () => {
  it("a failed seed leaves the resolver still refusing, not half-open", async () => {
    let armed = true;
    const { ledger } = await harness((point) => {
      if (armed && point === "after_rows") { armed = false; throw new Error("FAULT:after_rows"); }
    }, { seed: false });
    await expect(ledger.bootstrap({ projectId: TARGET_ID })).rejects.toThrow();
    // The ledger offers nothing, and any consumer must fail closed rather than see an empty
    // but authoritative-looking list.
    await expect(ledger.reverify({ projectId: TARGET_ID }))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });
});

describe("blocker 5c: activation and the ledger share one outcome", () => {
  /**
   * The property under test is an ordering one: `ProjectResolver` needs a terminal
   * migration, so as long as the ledger is seeded before the migration reaches `activated`,
   * there is no instant at which the target resolves with no ledger.
   */
  it("seeds the ledger before the migration becomes resolvable", async () => {
    const { ledger, revisions } = await harness(undefined, { seed: false });
    // Before seeding: a terminal migration exists but no ledger, so the resolver must refuse.
    expect(revisions.migrations.require(MIGRATION_ID)!.state).toBe("reported");
    await expect(ledger.reverify({ projectId: TARGET_ID }))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });

    await ledger.bootstrap({ projectId: TARGET_ID, migrationId: MIGRATION_ID, activationPhase: true });
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("active");
    expect((await ledger.reverify({ projectId: TARGET_ID })).state).toBe("active");
  });

  it("refuses a normal bootstrap while the migration is still moving", async () => {
    const { ledger } = await harness(undefined, { migrationState: "in_flight" });
    // Mid-flight, so the capability is not open yet.
    expect((await ledger.bootstrap({ projectId: TARGET_ID })).state).toBe("attention");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("refuses an activation-time seed of an aborted migration", async () => {
    const { ledger, revisions } = await harness(undefined, { seed: false });
    const plan = revisions.migrations.plan(MIGRATION_ID)!;
    revisions.migrations.create({
      migrationId: "mig_aborted", projectId: SOURCE_ID, idempotencyKey: "ka",
      requestDigest: "8".repeat(64), plan: { ...plan, migration_id: "mig_aborted" },
      sourceSha256Before: plan.source_digest,
    });
    revisions.migrations.transition("mig_aborted", "plan_written", "aborted", new Date(0));
    const result = await ledger.bootstrap({
      projectId: TARGET_ID, migrationId: "mig_aborted", activationPhase: true,
    });
    expect(result.state).toBe("attention");
  });

  it("leaves the migration, binding and active commit agreeing on one target", async () => {
    const { ledger, revisions } = await harness(undefined, { seed: false });
    await ledger.bootstrap({ projectId: TARGET_ID, migrationId: MIGRATION_ID, activationPhase: true });
    const migration = revisions.migrations.require(MIGRATION_ID)!;
    const binding = revisions.readEngineBinding(TARGET_ID)!;
    const commit = revisions.activeCommit(TARGET_ID)!;
    const record = ledger.bootstrapRecord(TARGET_ID)!;
    const rows = ledger.assets(TARGET_ID);

    // One migration id across the record, the rows and the migration row itself. The
    // project id appears on the binding and the commit, so it is checked separately.
    expect(new Set([migration.migration_id, record.migration_id,
      ...rows.map((row) => row.migration_id)])).toEqual(new Set([MIGRATION_ID]));
    expect(new Set([binding.project_id, commit.project_id, record.project_id,
      ...rows.map((row) => row.project_id)])).toEqual(new Set([TARGET_ID]));
    expect(binding.engine).toBe("openfilm");
    expect(commit.engine).toBe("openfilm");
    expect(commit.revision).toBe(1);
    expect(rows).toHaveLength(2);
  });

  it("keeps every asset row pointing at the same migration as the record", async () => {
    const { ledger } = await harness(undefined, { seed: false });
    await ledger.bootstrap({ projectId: TARGET_ID, migrationId: MIGRATION_ID, activationPhase: true });
    const record = ledger.bootstrapRecord(TARGET_ID)!;
    for (const row of ledger.assets(TARGET_ID)) {
      expect(row.migration_id).toBe(record.migration_id);
      expect(row.project_id).toBe(record.project_id);
      expect(row.source_project_id).toBe(SOURCE_ID);
    }
  });
});
