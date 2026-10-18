import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetRegistry } from "../../src/host/projects/asset-registry.js";
import { MigratedAssetLedger } from "../../src/host/projects/migrated-asset-ledger.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { sha256File, treeDigest } from "../../src/host/projects/openfilm-migrator.js";
import { OPENFILM_UPSTREAM_SHA } from "../../src/host/engine/engine-binding-store.js";
import { assetIdentity } from "../../src/host/projects/asset-registry.js";
import type { AssetManifestEntry, AssetLicense, AssetSource } from "../../src/contracts/types.js";
import type { MigrationPlanV1 } from "../../src/contracts/migration-types.js";

/**
 * ASSET-01, ASSET-02 and ASSET-03 (W2-G12, C-06).
 *
 * M2.3 copied media into the target's `assets/` but copied no `Manifest@2`, so the target
 * has bytes with no licence, no identity and no way to prove they are the bytes the
 * migration wrote. `MigratedAssetLedger` supplies exactly that missing proof, once, and
 * refuses to guess it.
 *
 * The three cases being closed are deliberately different in kind:
 *
 * - ASSET-01 is a positive: a provable bootstrap writes a bijective ledger and changes no
 *   authored fact.
 * - ASSET-02 is negative: ambiguity, and any later change to the source manifest, the target
 *   bytes or the licence, must land in attention rather than be re-derived.
 * - ASSET-03 is atomic: activation and ledger seeding succeed or fail together.
 */

const SOURCE_ID = "d1-30s";
const TARGET_ID = "of_d1-30s_abcdef12";
const MIGRATION_ID = "mig_0001";
const SOURCE_SHA = "1".repeat(64);

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const license = (label = "自有素材"): AssetLicense => ({ status: "cleared", label, commercial_use: true });
const source = (label = "本地素材"): AssetSource => ({ kind: "owned", label });

/** Media bytes are opaque here; the ledger compares hashes and frame counts, not codecs. */
function mediaBytes(marker: string): Buffer {
  return Buffer.concat([Buffer.from("ID3\0\0\0", "latin1"), Buffer.from(marker.padEnd(64, "x"), "latin1")]);
}

interface Options {
  manifestVersion?: 1 | 2;
  basenameCollision?: boolean;
  duplicateSourcePath?: boolean;
  planShaWins?: boolean;
  manifestShaWins?: boolean;
  secondAssetFrames?: number;
  dropPlanAsset?: boolean;
  extraManifestAsset?: boolean;
  targetIsSymlink?: boolean;
  targetPathTraversal?: boolean;
  secondMigration?: boolean;
  assetsDirIsSymlink?: boolean;
  targetIsDirectory?: boolean;
  absoluteTargetPath?: boolean;
}

interface Harness {
  ledger: MigratedAssetLedger;
  revisions: RevisionStore;
  registry: AssetRegistry;
  sourceRoot: string;
  targetRoot: string;
  migrationRoot: string;
  sourceSha256Before: string;
  entries: AssetManifestEntry[];
  targetPaths: string[];
}

async function harness(options: Options = {}): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-w2-ledger-"));
  dirs.push(base);
  const sourceRoot = join(base, "source");
  const targetRoot = join(base, "migrations", MIGRATION_ID);
  const migrationRoot = join(base, "migrations");
  await mkdir(join(sourceRoot, "media"), { recursive: true });
  await mkdir(targetRoot, { recursive: true });

  const entries: AssetManifestEntry[] = [];
  const sourcePaths: string[] = [];
  const targetPaths: string[] = [];

  // Two assets with identical content but distinct ids, plus an optional collision pair.
  const specs: Array<{ marker: string; id: string }> = [
    { marker: "first", id: "asset_first" },
    { marker: "second", id: "asset_second" },
  ];
  if (options.basenameCollision) specs.push({ marker: "first", id: "asset_third" });

  for (const spec of specs) {
    const bytes = mediaBytes(spec.marker);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const sourcePath = `media/${spec.id}.mp4`;
    const targetPath = options.basenameCollision ? "assets/first.mp4" : `assets/${spec.id}.mp4`;
    await writeFile(join(sourceRoot, sourcePath), bytes);
    sourcePaths.push(sourcePath);
    targetPaths.push(targetPath);
    entries.push({
      asset_id: spec.id,
      project_path: sourcePath,
      sha256: options.manifestShaWins === true && spec.id === "asset_second" ? "f".repeat(64) : sha,
      media_type: "video/mp4", kind: "video",
      duration_frames: 300,
      source: source(), license: license(),
    });
  }
  if (options.duplicateSourcePath) {
    // Two manifest identities claiming one source path. The registry tolerates this when
    // the bytes agree, so the ledger is the only thing that can refuse the ambiguity.
    entries.push({
      ...entries[0]!, asset_id: "asset_first_alias",
    });
  }
  if (options.extraManifestAsset) {
    entries.push({
      asset_id: "asset_unmapped", project_path: "media/unmapped.mp4", sha256: "e".repeat(64),
      media_type: "video/mp4", kind: "video", duration_frames: 300,
      source: source(), license: license(),
    });
  }

  const manifest = {
    format: options.manifestVersion === 1 ? "narralens.asset-manifest@1" : "narralens.asset-manifest@2",
    assets: entries,
  } as const;
  await writeFile(join(sourceRoot, "assets.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await mkdir(join(sourceRoot, "runs"), { recursive: true });
  await writeFile(join(sourceRoot, "runs/build.svrun"), "<svrun/>", "utf8");
  await writeFile(join(sourceRoot, "narration.wav"), mediaBytes("narration"), "utf8");
  // The descriptor has to satisfy the same contract a real project does, otherwise this
  // suite would be proving the ledger against a shape the Host never accepts.
  await writeFile(join(sourceRoot, "narralens.project.json"), JSON.stringify({
    project_id: SOURCE_ID, revision: 3, frame_rate: 30, frame_count: 900,
    shots: [{ shot_id: "shot-001", authoring_id: "shot-1", start_frame: 0, end_frame_exclusive: 900 }],
    preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" },
    run_file: "runs/build.svrun", studio_origin: "http://127.0.0.1:4174",
    narration_asset: "narration.wav", asset_manifest: "assets.manifest.json",
  }), "utf8");

  // Write each target with its own bytes, except in collision mode where the second write
  // silently overwrites the first — which is precisely the M2.3 hazard the ledger must catch.
  for (const [index, targetPath] of targetPaths.entries()) {
    const to = join(targetRoot, options.targetPathTraversal === true && index === 0 ? "../escaped.mp4" : targetPath);
    await mkdir(join(to, ".."), { recursive: true });
    await writeFile(to, mediaBytes(options.basenameCollision ? "first" : specs[index]!.marker));
  }
  if (options.assetsDirIsSymlink) {
    const outsideDir = join(base, "outside-dir");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "asset_first.mp4"), mediaBytes("first"));
    await rm(join(targetRoot, "assets"), { recursive: true, force: true });
    await symlink(outsideDir, join(targetRoot, "assets"));
  }
  if (options.absoluteTargetPath) await writeFile(join(base, "outside-anywhere.mp4"), mediaBytes("first"));
  if (options.targetIsDirectory) {
    await rm(join(targetRoot, targetPaths[1]!), { force: true });
    await mkdir(join(targetRoot, targetPaths[1]!), { recursive: true });
  }
  if (options.targetIsSymlink) {
    // The target carries bytes of the right hash, reached through a link that leaves it.
    const outside = join(base, "outside.mp4");
    await writeFile(outside, mediaBytes("first"));
    await rm(join(targetRoot, targetPaths[0]!));
    await symlink(outside, join(targetRoot, targetPaths[0]!));
  }
  // The plan records the hash of what the migration actually wrote, which for the second
  // asset is the real bytes unless a test makes the two disagree.
  const planAssets = targetPaths.map((targetPath, index) => ({
    source_path: sourcePaths[index]!,
    target_path: options.absoluteTargetPath === true && index === 0
      ? join(base, "outside-anywhere.mp4")
      : options.targetPathTraversal === true && index === 0 ? "../escaped.mp4" : targetPath,
    sha256: options.planShaWins === true && index === 1 ? "0".repeat(64) : createHash("sha256")
      .update(mediaBytes(index === 0 || options.basenameCollision ? "first" : "second")).digest("hex"),
    asset_id: null,
  })).filter((asset) => !(options.dropPlanAsset === true && asset.source_path === sourcePaths[1]));

  const sourceSha256Before = await treeDigest(sourceRoot);

  const revisions = new RevisionStore();
  stores.push(revisions);
  const catalog = new ProjectCatalog(new Map([[SOURCE_ID, join(sourceRoot, "narralens.project.json")]]));
  const plan: MigrationPlanV1 = {
    format: "narralens.migration-plan@1.0", migration_id: MIGRATION_ID,
    idempotency_key: "mig-key", request_digest: "9".repeat(64),
    source_project_id: SOURCE_ID, source_revision: 3, source_digest: SOURCE_SHA,
    source_engine: "hypit", target_project_id: TARGET_ID, target_engine: "openfilm",
    target_engine_upstream_sha: OPENFILM_UPSTREAM_SHA,
    identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
    features: [], assets: planAssets, subtitles: [], narration: null, validation_steps: [], blocking: [],
    created_at: new Date(0).toISOString(),
  };
  revisions.migrations.create({
    migrationId: MIGRATION_ID, projectId: SOURCE_ID, idempotencyKey: "mig-key",
    requestDigest: "9".repeat(64), plan, sourceSha256Before,
  });
  for (const to of ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const) {
    revisions.migrations.transition(MIGRATION_ID, revisions.migrations.require(MIGRATION_ID)!.state, to, new Date(0));
  }
  if (options.secondMigration) {
    const second = "mig_0002";
    await mkdir(join(migrationRoot, second), { recursive: true });
    revisions.migrations.create({
      migrationId: second, projectId: SOURCE_ID, idempotencyKey: "mig-key-2",
      requestDigest: "8".repeat(64), plan: { ...plan, migration_id: second, idempotency_key: "mig-key-2" },
      sourceSha256Before,
    });
    for (const to of ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const) {
      revisions.migrations.transition(second, revisions.migrations.require(second)!.state, to, new Date(0));
    }
  }
  revisions.bindEngine(TARGET_ID, "openfilm", OPENFILM_UPSTREAM_SHA, SOURCE_ID, new Date(0));
  revisions.commitMigrationTarget({
    migrationId: MIGRATION_ID, projectId: TARGET_ID, revision: 1, snapshotId: "snap_1",
    sourceDigest: "2".repeat(64), engine: "openfilm", now: new Date(0),
  });

  const registry = new AssetRegistry(catalog, {
    videoFrames: async (path: string) => (path.endsWith("asset_second.mp4")
      ? options.secondAssetFrames ?? 300 : 300),
  });
  return {
    ledger: MigratedAssetLedger.create({ revisions, registry, catalog, migrationRoot }),
    revisions, registry, sourceRoot, targetRoot, migrationRoot, sourceSha256Before, entries, targetPaths,
  };
}

function expectAttention(result: { state: string }, why: string): void {
  expect(result.state, why).toBe("attention");
}

describe("ASSET-01 a provable bootstrap writes a bijective ledger and touches nothing authored", () => {
  it("seeds every target asset with its source manifest, licence and byte lineage", async () => {
    const { ledger } = await harness();
    const result = await ledger.bootstrap({ projectId: TARGET_ID });
    expect(result).toMatchObject({ state: "active", project_id: TARGET_ID, migration_id: MIGRATION_ID });
    const assets = ledger.assets(TARGET_ID);
    expect(assets.map((asset) => asset.asset_id).sort()).toEqual(["asset_first", "asset_second"]);
    expect(assets[0]).toMatchObject({
      project_id: TARGET_ID, migration_id: MIGRATION_ID, source_project_id: SOURCE_ID,
      target_path: "assets/asset_first.mp4",
    });
    expect(assets[0]!.license).toMatchObject({ status: "cleared", commercial_use: true });
    expect(assets[0]!.source_sha256).toBe(assets[0]!.target_sha256);
    expect(assets[0]!.source_manifest_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("changes no author source, revision, active commit or source tree digest", async () => {
    const { ledger, revisions, sourceRoot, targetRoot, sourceSha256Before } = await harness();
    const authorBefore = await treeDigest(sourceRoot);
    const sourceAssetBefore = await sha256File(join(sourceRoot, "media/asset_first.mp4"));
    const revisionBefore = revisions.activeCommit(TARGET_ID)?.revision;

    await ledger.bootstrap({ projectId: TARGET_ID });

    expect(await treeDigest(sourceRoot)).toBe(authorBefore);
    expect(await sha256File(join(sourceRoot, "media/asset_first.mp4"))).toBe(sourceAssetBefore);
    expect(revisions.activeCommit(TARGET_ID)?.revision).toBe(revisionBefore);
    expect(await treeDigest(targetRoot)).not.toBe(sourceSha256Before);
    expect(await sha256File(join(sourceRoot, "assets.manifest.json"))).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("is idempotent: the same input digest re-seeds nothing and reports the same fact", async () => {
    const { ledger } = await harness();
    const first = await ledger.bootstrap({ projectId: TARGET_ID });
    const second = await ledger.bootstrap({ projectId: TARGET_ID });
    expect(second).toMatchObject({ state: "active", input_digest: first.input_digest });
    expect(ledger.assets(TARGET_ID)).toHaveLength(2);
    expect(ledger.assets(TARGET_ID)).toEqual(ledger.assets(TARGET_ID));
  });

  it("records a frame count only when the target bytes agree with the manifest", async () => {
    const { ledger } = await harness({ secondAssetFrames: 42 });
    const result = await ledger.bootstrap({ projectId: TARGET_ID });
    expectAttention(result, "a probed frame count that disagrees with the manifest is not a provable mapping");
  });
});

describe("ASSET-02 ambiguity and drift go to attention, never to a re-derived answer", () => {
  it("refuses a basename collision that would map two source assets onto one target path", async () => {
    const { ledger } = await harness({ basenameCollision: true });
    const result = await ledger.bootstrap({ projectId: TARGET_ID });
    expectAttention(result, "many-to-one target mapping");
    expect(ledger.assets(TARGET_ID)).toEqual([]);
  });

  it("refuses a source manifest with two entries claiming one project path", async () => {
    const { ledger } = await harness({ duplicateSourcePath: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "one-to-many source mapping");
    expect(ledger.assets(TARGET_ID)).toEqual([]);
  });

  it("refuses when the target bytes disagree with the plan's recorded hash", async () => {
    const { ledger } = await harness({ planShaWins: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "target bytes are not what the migration wrote");
  });

  it("refuses when the source manifest's hash disagrees with the target bytes", async () => {
    const { ledger } = await harness({ manifestShaWins: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "manifest and target bytes disagree");
  });

  it("refuses a manifest asset the migration never copied", async () => {
    const { ledger } = await harness({ extraManifestAsset: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "the mapping is not bijective");
  });

  it("refuses a plan asset with no manifest entry behind it", async () => {
    const { ledger } = await harness({ dropPlanAsset: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "a target asset with no provable licence");
  });

  it("refuses when the source tree has changed since the migration captured it", async () => {
    const { ledger, sourceRoot } = await harness();
    await writeFile(join(sourceRoot, "extra.txt"), "drift", "utf8");
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "source facts are no longer migration-time facts");
  });

  it("moves an active ledger to attention when the target bytes change afterwards", async () => {
    const { ledger, targetRoot } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    await writeFile(join(targetRoot, "assets/asset_first.mp4"), mediaBytes("tampered"), "utf8");
    const reverified = await ledger.reverify({ projectId: TARGET_ID });
    expectAttention(reverified, "target bytes changed after bootstrap");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("moves an active ledger to attention when the licence changes afterwards", async () => {
    const { ledger, sourceRoot } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    const manifestPath = join(sourceRoot, "assets.manifest.json");
    const manifest = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(manifestPath, "utf8"))) as
      { format: string; assets: AssetManifestEntry[] };
    manifest.assets[0]!.license = license("第三方受限");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    expectAttention(await ledger.reverify({ projectId: TARGET_ID }), "the licence behind a ledger row changed");
  });
});

describe("ASSET-03 activation and ledger seeding are one outcome", () => {
  it("refuses to bootstrap once the target already has a Wave 2 transaction", async () => {
    const { ledger, revisions } = await harness();
    revisions.beginTransaction({
      transaction_id: "txn_w2", project_id: TARGET_ID, correlation_id: "corr_1", kind: "edit",
      request_json: "{}", request_hash: "a".repeat(64), base_revision: 1,
    });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "bootstrap must precede any Wave 2 write");
  });

  it("seeds through activation in the same call, so a failure leaves no half-ledger", async () => {
    const { ledger, revisions, targetRoot } = await harness();
    const before = revisions.migrations.require(MIGRATION_ID)!.state;
    // Re-run the migration forward path from a fresh ledger: seeding is offered only while
    // the migration is the one that produced this target.
    expect(before).toBe("reported");
    await expect(ledger.bootstrap({ projectId: TARGET_ID, migrationId: MIGRATION_ID })).resolves
      .toMatchObject({ state: "active" });
    expect(ledger.assets(TARGET_ID)).toHaveLength(2);
    expect(await import("node:fs/promises").then((fs) => fs.readdir(targetRoot))).toContain("assets");
  });

  it("records no ledger row at all for a project that was never migrated", async () => {
    const { ledger } = await harness();
    expect(ledger.assets("of_never_existed")).toEqual([]);
    expect(ledger.bootstrapRecord("of_never_existed")).toBeUndefined();
    await expect(ledger.bootstrap({ projectId: "of_never_existed" }))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("the ledger is a read model, not a second timeline", () => {
  it("stores no frame positions, clip list or ordering", async () => {
    const { ledger } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    // Assert the schema itself, not just one row: a read model that could hold positions
    // would be a second timeline the moment anything wrote to it.
    const source = readFileSync(resolve(import.meta.dirname, "../../src/host/projects/migrated-asset-ledger.ts"), "utf8");
    const statement = source.slice(source.indexOf("CREATE TABLE IF NOT EXISTS migrated_asset"));
    const columns = (statement.slice(0, statement.indexOf(");"))).toLowerCase();
    for (const forbidden of ["start_frame", "end_frame", "timeline", "clip_id", "track_id", "position", "sort_order"]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
    for (const required of ["project_id", "asset_id", "target_path", "target_sha256", "license_json"]) {
      expect(columns, required).toContain(required);
    }
  });

  it("resolves an asset by id and content hash, and by nothing else", async () => {
    const { ledger } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    const asset = ledger.get(TARGET_ID, "asset_first");
    expect(asset).toBeDefined();
    expect(ledger.get(TARGET_ID, "asset_missing")).toBeUndefined();
    expect(ledger.get("other_project", "asset_first")).toBeUndefined();
  });
});

describe("the guards that needed their own case", () => {
  it("refuses target bytes reached through a symlink that leaves the target root", async () => {
    const { ledger } = await harness({ targetIsSymlink: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "a link out of the root proves nothing");
    expect(ledger.assets(TARGET_ID)).toEqual([]);
  });

  it("refuses a target reached through a symlinked directory inside the root", async () => {
    const { ledger } = await harness({ assetsDirIsSymlink: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }),
      "a symlinked directory component leaves the root without using `..`");
    expect(ledger.assets(TARGET_ID)).toEqual([]);
  });

  it("refuses a target that is a directory rather than a file", async () => {
    const { ledger } = await harness({ targetIsDirectory: true });
    // Assert the reason, not just that it failed: reading a directory also errors, so the
    // suite would otherwise pass even with the type check removed.
    expect(await ledger.bootstrap({ projectId: TARGET_ID })).toMatchObject({
      state: "attention", reason: "TARGET_NOT_A_FILE",
    });
    expect(ledger.assets(TARGET_ID)).toEqual([]);
  });

  it("refuses an absolute target path", async () => {
    const { ledger } = await harness({ absoluteTargetPath: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "an absolute server path is never accepted");
    expect(ledger.assets(TARGET_ID)).toEqual([]);
  });

  it("refuses a target path that traverses out of the target root", async () => {
    const { ledger } = await harness({ targetPathTraversal: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "the plan's target path escapes");
    expect(ledger.assets(TARGET_ID)).toEqual([]);
  });

  it("refuses when two terminal migrations claim the same target project", async () => {
    const { ledger } = await harness({ secondMigration: true });
    expectAttention(await ledger.bootstrap({ projectId: TARGET_ID }), "the activation authority is ambiguous");
    expect(ledger.assets(TARGET_ID)).toEqual([]);
  });

  it("detects a ledger row tampered with directly in the database", async () => {
    const { ledger, revisions } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    // Nothing in the Host writes these rows except the ledger, so this is exactly the
    // out-of-band edit the drift check exists to notice.
    revisions.compose((db) => db.prepare(
      "UPDATE migrated_asset SET target_sha256=? WHERE project_id=? AND asset_id=?",
    ).run("7".repeat(64), TARGET_ID, "asset_first"));
    expect(ledger.get(TARGET_ID, "asset_first")!.target_sha256).toBe("7".repeat(64));
    expectAttention(await ledger.reverify({ projectId: TARGET_ID }), "a row no longer matches the evidence");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("detects a licence edited directly in the database", async () => {
    const { ledger, revisions } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    revisions.compose((db) => db.prepare(
      "UPDATE migrated_asset SET license_json=? WHERE project_id=? AND asset_id=?",
    ).run(JSON.stringify({ status: "restricted", label: "第三方受限", commercial_use: false }),
      TARGET_ID, "asset_first"));
    expectAttention(await ledger.reverify({ projectId: TARGET_ID }), "the licence behind a row was edited");
  });

  it("detects a bootstrap record whose evidence hash no longer matches", async () => {
    const { ledger, revisions } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    revisions.compose((db) => db.prepare(
      "UPDATE asset_ledger_bootstrap SET input_digest=? WHERE project_id=?",
    ).run("3".repeat(64), TARGET_ID));
    expectAttention(await ledger.reverify({ projectId: TARGET_ID }),
      "the record claims evidence that was never verified");
  });

  it("detects a deleted ledger row", async () => {
    const { ledger, revisions } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    revisions.compose((db) => db.prepare(
      "DELETE FROM migrated_asset WHERE project_id=? AND asset_id=?",).run(TARGET_ID, "asset_second"));
    expectAttention(await ledger.reverify({ projectId: TARGET_ID }), "a row disappeared");
  });
});

describe("the bootstrap state machine is predecessor-checked like every other", () => {
  it("refuses a transition whose predecessor is not the recorded state, and changes nothing", async () => {
    const { ledger } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    expect(() => ledger.transitionBootstrap(TARGET_ID, "prepared", "attention"))
      .toThrow("INVALID_LEDGER_BOOTSTRAP_TRANSITION");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("active");
  });

  it("refuses a transition the plan does not allow at all", async () => {
    const { ledger } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    expect(() => ledger.transitionBootstrap(TARGET_ID, "active", "prepared"))
      .toThrow("INVALID_LEDGER_BOOTSTRAP_TRANSITION");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("active");
  });
});
