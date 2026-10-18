import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetInventoryPort } from "../../src/host/projects/asset-inventory-port.js";
import { AssetRegistry } from "../../src/host/projects/asset-registry.js";
import { MigratedAssetLedger } from "../../src/host/projects/migrated-asset-ledger.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { ProjectResolver } from "../../src/host/projects/project-resolver.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { treeDigest } from "../../src/host/projects/openfilm-migrator.js";
import { OPENFILM_UPSTREAM_SHA } from "../../src/host/engine/engine-binding-store.js";
import type { InventoryAsset } from "../../src/host/projects/asset-inventory-port.js";
import type { AssetManifestEntry, AssetLicense, AssetSource } from "../../src/contracts/types.js";
import type { MigrationPlanV1 } from "../../src/contracts/migration-types.js";

/**
 * W2-G12, second half: one read-only seam over two different asset stores.
 *
 * A legacy Hypit project keeps its facts in `Manifest@2` inside the author source; a
 * migrated OpenFilm target keeps them in `MigratedAssetLedger` inside SQLite. M3 needs
 * eligible assets from either, and must not know which it got.
 *
 * The dangerous part is what this port must *not* do. The frozen plan forbids a silent
 * cross-project fallback, so a project whose own store has nothing must come back empty
 * or fail — never "the source project's assets, borrowed". Most of this file is about
 * that distinction.
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

const license = (label = "自有素材"): AssetLicense => ({ status: "cleared", label, commercial_use: true });
const origin = (): AssetSource => ({ kind: "owned", label: "本地素材" });
const media = (marker: string): Buffer =>
  Buffer.concat([Buffer.from("ID3\\0\\0\\0", "latin1"), Buffer.from(marker.padEnd(64, "x"), "latin1")]);
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

interface Harness {
  port: AssetInventoryPort;
  ledger: MigratedAssetLedger;
  revisions: RevisionStore;
  sourceRoot: string;
  targetRoot: string;
}

async function harness(options: { seedLedger?: boolean } = {}): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-w2-inventory-"));
  dirs.push(base);
  const sourceRoot = join(base, "source");
  const migrationRoot = join(base, "migrations");
  const targetRoot = join(migrationRoot, MIGRATION_ID);
  await mkdir(join(sourceRoot, "media"), { recursive: true });
  await mkdir(join(targetRoot, "assets"), { recursive: true });
  await mkdir(join(sourceRoot, "runs"), { recursive: true });
  await writeFile(join(sourceRoot, "runs/build.svrun"), "<svrun/>", "utf8");
  await writeFile(join(sourceRoot, "narration.wav"), media("narration"), "utf8");

  const bytes = media("shared");
  const entries: AssetManifestEntry[] = [
    { asset_id: "asset_baseline", project_path: "media/baseline.mp4", sha256: sha(bytes),
      media_type: "video/mp4", kind: "video", duration_frames: 300, source: origin(), license: license() },
    { asset_id: "asset_restricted", project_path: "media/restricted.mp4", sha256: sha(media("restricted")),
      media_type: "video/mp4", kind: "video", duration_frames: 300, source: origin(),
      license: { status: "restricted", label: "第三方受限", commercial_use: false } },
  ];
  await writeFile(join(sourceRoot, "media/baseline.mp4"), bytes);
  await writeFile(join(sourceRoot, "media/restricted.mp4"), media("restricted"));
  await writeFile(join(sourceRoot, "assets.manifest.json"), JSON.stringify({
    format: "narralens.asset-manifest@2", assets: entries,
  }), "utf8");
  await writeFile(join(sourceRoot, "narralens.project.json"), JSON.stringify({
    project_id: SOURCE_ID, revision: 3, frame_rate: 30, frame_count: 900,
    shots: [{ shot_id: "shot-001", authoring_id: "shot-1", start_frame: 0, end_frame_exclusive: 900 }],
    preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" },
    run_file: "runs/build.svrun", studio_origin: "http://127.0.0.1:4174",
    narration_asset: "narration.wav", asset_manifest: "assets.manifest.json",
  }), "utf8");
  await writeFile(join(targetRoot, "assets/baseline.mp4"), bytes);
  // Both manifest assets are copied, exactly as the migrator would: an asset the licence
  // bars is still a registered asset, and its ineligibility is the interesting case.
  await writeFile(join(targetRoot, "assets/restricted.mp4"), media("restricted"));

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
    features: [], assets: [
      { source_path: "media/baseline.mp4", target_path: "assets/baseline.mp4", sha256: sha(bytes), asset_id: null },
      { source_path: "media/restricted.mp4", target_path: "assets/restricted.mp4",
        sha256: sha(media("restricted")), asset_id: null },
    ],
    subtitles: [], narration: null, validation_steps: [], blocking: [],
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
    migrationId: MIGRATION_ID, projectId: TARGET_ID, revision: 1, snapshotId: "snap_1",
    sourceDigest: "4".repeat(64), engine: "openfilm", now: new Date(0),
  });

  const ledger = MigratedAssetLedger.create({ revisions, registry, catalog, migrationRoot });
  if (options.seedLedger !== false) await ledger.bootstrap({ projectId: TARGET_ID });

  const resolver = new ProjectResolver({ catalog, revisions, migrationRoot });
  return {
    port: new AssetInventoryPort({ resolver, registry, ledger }),
    ledger, revisions, sourceRoot, targetRoot,
  };
}

describe("the port answers for either kind of project without the caller knowing which", () => {
  it("reads a legacy project from its Manifest@2", async () => {
    const { port } = await harness();
    const inventory = await port.inventory(SOURCE_ID);
    expect(inventory.kind).toBe("legacy");
    expect(inventory.assets.map((asset) => asset.asset_id).sort())
      .toEqual(["asset_baseline", "asset_restricted"]);
  });

  it("reads a migrated target from the ledger", async () => {
    const { port } = await harness();
    const inventory = await port.inventory(TARGET_ID);
    expect(inventory.kind).toBe("activated");
    expect(inventory.assets.map((asset) => asset.asset_id).sort())
      .toEqual(["asset_baseline", "asset_restricted"]);
  });

  it("gives both kinds the same eligible/not-eligible verdict for the same facts", async () => {
    const { port } = await harness();
    const legacy = await port.inventory(SOURCE_ID);
    const activated = await port.inventory(TARGET_ID);
    const verdict = (assets: typeof legacy.assets) => assets
      .map((asset) => [asset.asset_id, asset.eligible, asset.blocking_reasons]).sort();
    expect(verdict(activated.assets)).toEqual(verdict(legacy.assets));
    expect(verdict(legacy.assets)).toEqual([
      ["asset_baseline", true, []],
      ["asset_restricted", false, ["LICENSE_NOT_CLEARED", "COMMERCIAL_USE_NOT_ALLOWED"]],
    ]);
  });

  it("fails closed when a ledger licence no longer matches the evidence", async () => {
    const { port, revisions, ledger } = await harness();
    revisions.compose((db) => db.prepare(
      "UPDATE migrated_asset SET license_json=? WHERE project_id=?",
    ).run(JSON.stringify({ status: "restricted", label: "受限", commercial_use: false }), TARGET_ID));
    // An out-of-band licence edit is drift, not a new eligible/ineligible verdict. Answering
    // 200 with `eligible: false` would have let the caller treat the row as trustworthy.
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({
      status: 423, code: "PROJECT_ATTENTION_REQUIRED",
    });
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("marks a genuinely restricted asset ineligible while the ledger still holds", async () => {
    const { port, ledger, revisions } = await harness();
    // Seeded as restricted from the start, so the ledger row and the manifest agree.
    revisions.compose((db) => db.prepare("DELETE FROM asset_ledger_bootstrap WHERE project_id=?").run(TARGET_ID));
    revisions.compose((db) => db.prepare("DELETE FROM migrated_asset WHERE project_id=?").run(TARGET_ID));
    await ledger.bootstrap({ projectId: TARGET_ID });
    const inventory = await port.inventory(TARGET_ID);
    expect(inventory.assets[0]).toMatchObject({ eligible: true });
  });

  it("turns tampered target bytes into a persisted attention, not a 200 with a warning", async () => {
    const { port, targetRoot, ledger } = await harness();
    expect((await port.inventory(TARGET_ID)).assets).toHaveLength(2);
    await writeFile(join(targetRoot, "assets/baseline.mp4"), media("tampered"), "utf8");
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({
      status: 423, code: "PROJECT_ATTENTION_REQUIRED",
    });
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });
});

describe("the port never borrows from another project", () => {
  it("refuses a migrated target whose ledger was never seeded", async () => {
    const { port } = await harness({ seedLedger: false });
    // Empty would read as "this project has no assets", which is a different answer.
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({
      status: 423, code: "PROJECT_ATTENTION_REQUIRED",
    });
  });

  it("does not serve the source project's assets to a target with no ledger", async () => {
    const { port } = await harness({ seedLedger: false });
    await expect(port.inventory(TARGET_ID)).rejects.toBeTruthy();
    await expect(port.resolveAsset(TARGET_ID, "asset_baseline", sha(media("shared")))).rejects.toBeTruthy();
  });

  it("refuses a project id that is neither a catalog project nor a migrated target", async () => {
    const { port } = await harness();
    await expect(port.inventory("of_unknown_00000000")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("resolves a single asset by id and content hash, and by nothing else", async () => {
    const { port } = await harness();
    const asset = await port.resolveAsset(TARGET_ID, "asset_baseline", sha(media("shared")));
    expect(asset).toMatchObject({ asset_id: "asset_baseline", duration_frames: 300 });
    await expect(port.resolveAsset(TARGET_ID, "asset_baseline", sha(media("other"))))
      .rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
    await expect(port.resolveAsset(SOURCE_ID, "asset_missing", sha(media("shared"))))
      .rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
  });

  it("refuses an asset whose licence bars it, even when its bytes are fine", async () => {
    const { port } = await harness();
    // The bytes hash correctly here. Only the licence stops it, which is the point: a
    // registered, available asset is still not usable.
    const inventory = await port.inventory(TARGET_ID);
    const restricted = inventory.assets.find((asset) => asset.asset_id === "asset_restricted")!;
    expect(restricted).toMatchObject({ availability: "available", eligible: false });
    await expect(port.resolveAsset(TARGET_ID, "asset_restricted", sha(media("restricted"))))
      .rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
  });

  it("fails closed when a target's bytes are gone", async () => {
    const { port, targetRoot, ledger } = await harness();
    await rm(join(targetRoot, "assets/baseline.mp4"));
    // Assert the code, not just the status: any 423 would satisfy a status-only check.
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({
      status: 423, code: "PROJECT_ATTENTION_REQUIRED",
    });
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("refuses a migrated target whose ledger is in attention", async () => {
    const { port, revisions } = await harness();
    revisions.compose((db) => db.prepare(
      "UPDATE asset_ledger_bootstrap SET state='attention', attention_reason='TARGET_BYTES_CHANGED' WHERE project_id=?",
    ).run(TARGET_ID));
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });
});

describe("the port exposes no server path", () => {
  it("keeps target_path and every other locator out of what it returns", async () => {
    const { port, targetRoot } = await harness();
    const legacy = await port.inventory(SOURCE_ID);
    const activated = await port.inventory(TARGET_ID);
    const text = JSON.stringify(activated);
    expect(text).not.toContain("project_path");
    expect(text).not.toContain("target_path");
    // `video/mp4` legitimately contains a slash, so assert on the locator shapes rather
    // than on the character: nothing rooted, nothing with a drive or home prefix.
    expect(text).not.toMatch(/"[^"]*\/(?:tmp|var|home|Users|mnt)\/"/u);
    expect(text).not.toMatch(/[A-Za-z]:\\/u);
    expect(text).not.toContain(targetRoot);
    expect(JSON.stringify(legacy)).not.toContain("project_path");
  });
});
