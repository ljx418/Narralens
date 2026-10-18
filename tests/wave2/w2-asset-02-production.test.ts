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
import type { AssetManifestEntry, AssetLicense, AssetSource } from "../../src/contracts/types.js";
import type { MigrationPlanV1 } from "../../src/contracts/migration-types.js";

/**
 * W2.0 correction, blocker 3: ASSET-02 has to be enforced on the production read path.
 *
 * The ledger proved its facts once, at bootstrap, and the port then read the stored rows.
 * Nothing re-checked them. A target file edited after bootstrap still produced a 200 with
 * `availability: "unavailable"` — an observation, not a gate. ASSET-02 requires that the
 * facts be re-proven on every activated-project read, that any drift be *persisted* as
 * `active -> attention`, and that the very request which detected the drift gets the 423.
 *
 * The other half matters just as much: an activated project with no ledger at all must not
 * come back as an empty inventory. Empty looks like "this project has no assets", which is
 * a different and wrong answer.
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
const source = (): AssetSource => ({ kind: "owned", label: "本地素材" });
const media = (marker: string): Buffer =>
  Buffer.concat([Buffer.from("ID3\0\0\0", "latin1"), Buffer.from(marker.padEnd(64, "x"), "latin1")]);
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

interface Harness {
  port: AssetInventoryPort;
  ledger: MigratedAssetLedger;
  revisions: RevisionStore;
  sourceRoot: string;
  targetRoot: string;
}

async function harness(options: { seed?: boolean } = {}): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-w2-asset02-"));
  dirs.push(base);
  const sourceRoot = join(base, "source");
  const migrationRoot = join(base, "migrations");
  const targetRoot = join(migrationRoot, MIGRATION_ID);
  await mkdir(join(sourceRoot, "media"), { recursive: true });
  await mkdir(join(sourceRoot, "runs"), { recursive: true });
  await mkdir(join(targetRoot, "assets"), { recursive: true });
  await writeFile(join(sourceRoot, "runs/build.svrun"), "<svrun/>", "utf8");
  await writeFile(join(sourceRoot, "narration.wav"), media("narration"), "utf8");

  const bytes = media("only");
  const entries: AssetManifestEntry[] = [{
    asset_id: "asset_only", project_path: "media/only.mp4", sha256: sha(bytes),
    media_type: "video/mp4", kind: "video", duration_frames: 300, source: source(), license: license(),
  }];
  await writeFile(join(sourceRoot, "media/only.mp4"), bytes);
  await writeFile(join(sourceRoot, "assets.manifest.json"),
    JSON.stringify({ format: "narralens.asset-manifest@2", assets: entries }), "utf8");
  await writeFile(join(sourceRoot, "narralens.project.json"), JSON.stringify({
    project_id: SOURCE_ID, revision: 3, frame_rate: 30, frame_count: 900,
    shots: [{ shot_id: "shot-001", authoring_id: "shot-1", start_frame: 0, end_frame_exclusive: 900 }],
    preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" },
    run_file: "runs/build.svrun", studio_origin: "http://127.0.0.1:4174",
    narration_asset: "narration.wav", asset_manifest: "assets.manifest.json",
  }), "utf8");
  await writeFile(join(targetRoot, "assets/only.mp4"), bytes);

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
    features: [], assets: [{ source_path: "media/only.mp4", target_path: "assets/only.mp4",
      sha256: sha(bytes), asset_id: null }],
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
  if (options.seed !== false) await ledger.bootstrap({ projectId: TARGET_ID });
  const resolver = new ProjectResolver({ catalog, revisions, migrationRoot });
  return {
    port: new AssetInventoryPort({ resolver, registry, ledger }),
    ledger, revisions, sourceRoot, targetRoot,
  };
}

async function rewriteManifest(sourceRoot: string, mutate: (entries: AssetManifestEntry[]) => AssetManifestEntry[]): Promise<void> {
  const path = join(sourceRoot, "assets.manifest.json");
  const parsed = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as
    { format: string; assets: AssetManifestEntry[] };
  await writeFile(path, JSON.stringify({ ...parsed, assets: mutate(parsed.assets) }), "utf8");
}

describe("blocker 3a: drift is a persisted transition and the detecting request gets 423", () => {
  it("target bytes changed -> attention and 423 on the very same call", async () => {
    const { port, ledger, targetRoot } = await harness();
    expect((await port.inventory(TARGET_ID)).assets).toHaveLength(1);

    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({
      status: 423, code: "PROJECT_ATTENTION_REQUIRED",
    });
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("source manifest changed -> attention and 423", async () => {
    const { port, ledger, sourceRoot } = await harness();
    await expect(port.inventory(TARGET_ID)).resolves.toBeTruthy();
    await rewriteManifest(sourceRoot, (entries) => entries.map((entry) => ({
      ...entry, license: { status: "restricted", label: "第三方受限", commercial_use: false },
    })));
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("licence changed on disk -> attention and 423", async () => {
    const { port, ledger, sourceRoot } = await harness();
    // A licence edit is a manifest edit too; the distinguishing factor is that the ledger
    // row's licence no longer matches what the manifest now says.
    await expect(port.inventory(TARGET_ID)).resolves.toBeTruthy();
    await rewriteManifest(sourceRoot, (entries) => entries.map((entry) => ({
      ...entry, license: license("另一个许可"),
    })));
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("does not merely report HASH_MISMATCH while staying usable", async () => {
    const { port, ledger, targetRoot } = await harness();
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    // The old behaviour returned a 200 with availability=unavailable. That is an
    // observation, not a gate, and it let a write proceed on contradicted facts.
    await expect(port.inventory(TARGET_ID)).rejects.toBeTruthy();
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).not.toBe("active");
  });

  it("keeps returning 423 on every later request", async () => {
    const { port, ledger, targetRoot } = await harness();
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({ status: 423 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({
        status: 423, code: "PROJECT_ATTENTION_REQUIRED",
      });
    }
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("restoring the bytes does not let the project back in", async () => {
    const { port, targetRoot } = await harness();
    const original = await (await import("node:fs/promises")).readFile(join(targetRoot, "assets/only.mp4"));
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({ status: 423 });
    await writeFile(join(targetRoot, "assets/only.mp4"), original);
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({ status: 423 });
  });

  it("resolveAsset is closed too, not only inventory", async () => {
    const { port, targetRoot } = await harness();
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    await expect(port.resolveAsset(TARGET_ID, "asset_only", sha(media("only"))))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });
});

describe("blocker 3b: an activated project with no ledger fails closed", () => {
  it("does not answer an empty inventory", async () => {
    const { port } = await harness({ seed: false });
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({
      status: 423, code: "PROJECT_ATTENTION_REQUIRED",
    });
  });

  it("does not fall back to the source project's assets", async () => {
    const { port } = await harness({ seed: false });
    await expect(port.inventory(TARGET_ID)).rejects.toBeTruthy();
    // And the failure is not a 200 carrying the source's asset ids.
    await expect(port.inventory(TARGET_ID)).rejects.not.toMatchObject({ status: 200 });
  });

  it("fails closed when the bootstrap record is deleted but rows remain", async () => {
    const { port, revisions } = await harness();
    revisions.compose((db) => db.prepare("DELETE FROM asset_ledger_bootstrap WHERE project_id=?").run(TARGET_ID));
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({ status: 423 });
  });

  it("fails closed when the asset rows are deleted but the record remains", async () => {
    const { port, revisions } = await harness();
    revisions.compose((db) => db.prepare("DELETE FROM migrated_asset WHERE project_id=?").run(TARGET_ID));
    await expect(port.inventory(TARGET_ID)).rejects.toMatchObject({ status: 423 });
  });
});

describe("blocker 3c: the legacy path is untouched", () => {
  it("still serves a legacy project from its manifest with no ledger involved", async () => {
    const { port, revisions } = await harness();
    const inventory = await port.inventory(SOURCE_ID);
    expect(inventory).toMatchObject({ kind: "legacy", store: "asset_manifest", project_id: SOURCE_ID });
    expect(inventory.assets.map((asset) => asset.asset_id)).toEqual(["asset_only"]);
    expect(inventory.assets[0]).toMatchObject({ availability: "available", eligible: true });
    // Nothing about the source project was pushed into the target's ledger.
    expect(revisions.compose((db) => db.prepare(
      "SELECT COUNT(*) AS n FROM migrated_asset WHERE project_id=?").get(SOURCE_ID))).toMatchObject({ n: 0 });
  });

  it("still reports a tampered legacy asset as unavailable without entering attention", async () => {
    const { port, sourceRoot, ledger } = await harness();
    await writeFile(join(sourceRoot, "media/only.mp4"), media("tampered"));
    const inventory = await port.inventory(SOURCE_ID);
    expect(inventory.assets[0]).toMatchObject({ availability: "unavailable", eligible: false });
    expect(inventory.assets[0]!.blocking_reasons).toContain("HASH_MISMATCH");
    // D4.2.1 behaviour: the legacy inventory has always reported rather than blocked.
    expect(ledger.bootstrapRecord(SOURCE_ID)).toBeUndefined();
  });
});
