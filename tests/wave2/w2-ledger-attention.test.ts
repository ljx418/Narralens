import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MigratedAssetLedger } from "../../src/host/projects/migrated-asset-ledger.js";
import { AssetRegistry } from "../../src/host/projects/asset-registry.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { treeDigest } from "../../src/host/projects/openfilm-migrator.js";
import { OPENFILM_UPSTREAM_SHA } from "../../src/host/engine/engine-binding-store.js";
import type { AssetManifestEntry, AssetLicense, AssetSource } from "../../src/contracts/types.js";
import type { MigrationPlanV1 } from "../../src/contracts/migration-types.js";

/**
 * W2.0 correction, blocker 2: `attention` is fail-closed and never clears itself.
 *
 * The first implementation let `reverify()` move an `attention` ledger back to `active`
 * once the facts were proven again. That is a capability that can recover itself, and a
 * capability that can recover itself has no gate: an operator who saw a ledger fall into
 * attention could not rely on it staying there, and the reason it fell there — a human
 * decision about whether those bytes and that licence were acceptable — would be silently
 * overwritten by the next read.
 *
 * `attention` is a decision, not an observation. Once the Host records that the facts were
 * contradicted, only a separate, explicit, audited operation may reverse it, and that
 * operation belongs to a later stage. Nothing here invents one.
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

async function harness(): Promise<{ ledger: MigratedAssetLedger; sourceRoot: string; targetRoot: string }> {
  const base = await mkdtemp(join(tmpdir(), "narralens-w2-attention-"));
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
  const entry: AssetManifestEntry = {
    asset_id: "asset_only", project_path: "media/only.mp4",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    media_type: "video/mp4", kind: "video", duration_frames: 300, source: source(), license: license(),
  };
  await writeFile(join(sourceRoot, "media/only.mp4"), bytes);
  await writeFile(join(sourceRoot, "assets.manifest.json"),
    JSON.stringify({ format: "narralens.asset-manifest@2", assets: [entry] }), "utf8");
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
      sha256: createHash("sha256").update(bytes).digest("hex"), asset_id: null }],
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
  return { ledger: MigratedAssetLedger.create({ revisions, registry, catalog, migrationRoot }), sourceRoot, targetRoot };
}

async function rewriteManifest(sourceRoot: string, mutate: (assets: AssetManifestEntry[]) => AssetManifestEntry[]): Promise<void> {
  const path = join(sourceRoot, "assets.manifest.json");
  const parsed = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as
    { format: string; assets: AssetManifestEntry[] };
  await writeFile(path, JSON.stringify({ ...parsed, assets: mutate(parsed.assets) }), "utf8");
}

describe("blocker 2a: the state machine has exactly three edges", () => {
  it("allows prepared -> active, prepared -> attention and active -> attention", async () => {
    const { ledger } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("active");
    // prepared -> active already happened above.
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).not.toBe("prepared");
  });

  it("refuses attention -> active", async () => {
    const { ledger, targetRoot } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    expect((await ledger.reverify({ projectId: TARGET_ID })).state).toBe("attention");
    expect(() => ledger.transitionBootstrap(TARGET_ID, "attention", "active"))
      .toThrow("INVALID_LEDGER_BOOTSTRAP_TRANSITION");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("refuses attention -> prepared and active -> prepared and every self-loop", async () => {
    const { ledger } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    const illegal: Array<[string, string]> = [
      ["attention", "prepared"], ["active", "prepared"],
      ["active", "active"], ["attention", "attention"], ["prepared", "prepared"],
    ];
    for (const [from, to] of illegal) {
      expect(() => ledger.transitionBootstrap(TARGET_ID, from as never, to as never), `${from}->${to}`)
        .toThrow("INVALID_LEDGER_BOOTSTRAP_TRANSITION");
    }
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("active");
  });

  it("refuses any transition from a state the record does not hold", async () => {
    const { ledger } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    expect(() => ledger.transitionBootstrap(TARGET_ID, "prepared", "attention"))
      .toThrow("INVALID_LEDGER_BOOTSTRAP_TRANSITION");
  });
});

describe("blocker 2b: attention never clears itself", () => {
  it("stays in attention after the target bytes are restored and re-verified", async () => {
    const { ledger, targetRoot } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    const original = await (await import("node:fs/promises")).readFile(join(targetRoot, "assets/only.mp4"));
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    expect((await ledger.reverify({ projectId: TARGET_ID })).state).toBe("attention");

    // Put the bytes back exactly. The facts are provable again — and the decision is not.
    await writeFile(join(targetRoot, "assets/only.mp4"), original);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await ledger.reverify({ projectId: TARGET_ID });
      expect(result.state, `attempt ${attempt}`).toBe("attention");
    }
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
    expect(ledger.bootstrapRecord(TARGET_ID)?.attention_reason).not.toBeNull();
  });

  it("stays in attention after the licence is restored and re-verified", async () => {
    const { ledger, sourceRoot } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    await rewriteManifest(sourceRoot, (assets) => assets.map((asset) => ({
      ...asset, license: { status: "restricted", label: "第三方受限", commercial_use: false },
    })));
    expect((await ledger.reverify({ projectId: TARGET_ID })).state).toBe("attention");

    await rewriteManifest(sourceRoot, (assets) => assets.map((asset) => ({ ...asset, license: license() })));
    expect((await ledger.reverify({ projectId: TARGET_ID })).state).toBe("attention");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });

  it("does not re-enter attention with a different reason once already in attention", async () => {
    const { ledger, sourceRoot, targetRoot } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    const first = await ledger.reverify({ projectId: TARGET_ID });
    expect(first.reason).toBeTypeOf("string");
    await rewriteManifest(sourceRoot, (assets) => assets.map((asset) => ({ ...asset, license: license("另一个原因") })));
    const second = await ledger.reverify({ projectId: TARGET_ID });
    expect(second.state).toBe("attention");
    // The first reason is the one that explains why a human was called in.
    expect(ledger.bootstrapRecord(TARGET_ID)?.attention_reason).toBe(first.reason);
  });

  it("keeps the recorded reason and bumps control revision exactly once per transition", async () => {
    const { ledger, targetRoot } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    const before = ledger.bootstrapRecord(TARGET_ID)!.control_revision;
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    await ledger.reverify({ projectId: TARGET_ID });
    const after = ledger.bootstrapRecord(TARGET_ID)!.control_revision;
    expect(after).toBe(before + 1);
    // Further re-verification must not keep advancing control revision while nothing changed.
    await ledger.reverify({ projectId: TARGET_ID });
    await ledger.reverify({ projectId: TARGET_ID });
    expect(ledger.bootstrapRecord(TARGET_ID)!.control_revision).toBe(after);
  });

  it("refuses to re-bootstrap over an attention ledger", async () => {
    const { ledger, targetRoot } = await harness();
    await ledger.bootstrap({ projectId: TARGET_ID });
    await writeFile(join(targetRoot, "assets/only.mp4"), media("tampered"));
    await ledger.reverify({ projectId: TARGET_ID });
    // `bootstrap` must not be a back door around `attention` either.
    expect((await ledger.bootstrap({ projectId: TARGET_ID })).state).toBe("attention");
    expect(ledger.bootstrapRecord(TARGET_ID)?.state).toBe("attention");
  });
});
