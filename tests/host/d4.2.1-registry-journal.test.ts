import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { AssetImportResponse, AssetManifestEntry } from "../../src/contracts/types.js";
import { AssetRegistry, assetIdentity } from "../../src/host/projects/asset-registry.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore, type AssetImportJournalRecord } from "../../src/host/projects/revision-store.js";

const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

async function registryFixture() {
  const root = await mkdtemp(join(tmpdir(), "narralens-registry-"));
  const sourceDescriptor = JSON.parse(await readFile(resolve("fixtures/d1-30s/narralens.project.json"), "utf8"));
  const descriptorPath = join(root, "narralens.project.json");
  await writeFile(descriptorPath, `${JSON.stringify(sourceDescriptor)}\n`);
  const old: AssetManifestEntry = {
    asset_id: "asset_legacy", project_path: "media/legacy/source.mp4", sha256: "1".repeat(64),
    media_type: "video/mp4", kind: "video", duration_frames: 30,
    source: { kind: "owned", label: "legacy", uri: "file:///legacy/source.mp4" },
    license: { status: "restricted", label: "legacy review", commercial_use: false },
  };
  const oldSecond: AssetManifestEntry = { ...old, asset_id: "asset_legacy_second",
    project_path: "media/legacy-second/source.mp4", sha256: "4".repeat(64), source: { kind: "licensed", label: "legacy second" } };
  const before = `${JSON.stringify({ format: "narralens.asset-manifest@1", assets: [old, oldSecond] })}\n`;
  await writeFile(join(root, "narralens.assets.json"), before);
  const catalog = new ProjectCatalog(new Map([["d1-30s", descriptorPath]]));
  return { root, before, old, oldSecond, registry: new AssetRegistry(catalog) };
}

describe("D4.2.1 AssetRegistry v2 transaction foundation", () => {
  it("plans a canonical @1 to @2 append, publishes conditionally and restores exact preimage", async () => {
    const value = await registryFixture();
    const source = { kind: "generated", label: "generated locally" } as const;
    const license = { status: "cleared", label: "owned", commercial_use: true } as const;
    const bytesSha = "2".repeat(64);
    const added: AssetManifestEntry = { asset_id: assetIdentity(bytesSha, source, license),
      project_path: `media/${bytesSha}/source.mp4`, sha256: bytesSha, media_type: "video/mp4", kind: "video",
      duration_frames: 60, source, license };
    const plan = await value.registry.planAppend("d1-30s", added);
    expect(plan).toMatchObject({ created: true, migrated_from_v1: true, after: { format: "narralens.asset-manifest@2" } });
    expect(plan.after.assets.slice(0, 2)).toEqual([value.old, value.oldSecond]);
    expect(Buffer.from(plan.after_bytes).toString("utf8").endsWith("\n")).toBe(true);

    const published = await value.registry.publish("d1-30s", plan.before.sha256, plan.after_bytes);
    expect(published.sha256).toBe(plan.after_sha256);
    expect(published.manifest.assets.map((asset) => asset.asset_id)).toEqual(["asset_legacy", "asset_legacy_second", added.asset_id]);
    await expect(value.registry.publish("d1-30s", plan.before.sha256, plan.after_bytes)).rejects.toMatchObject({ status: 409, code: "MANIFEST_CHANGED" });

    const restored = await value.registry.restore("d1-30s", plan.after_sha256, plan.before.bytes);
    expect(restored.manifest.format).toBe("narralens.asset-manifest@1");
    expect(await readFile(join(value.root, "narralens.assets.json"), "utf8")).toBe(value.before);
  });

  it("does not migrate an exact duplicate and rejects contradictory or duplicate identities", async () => {
    const value = await registryFixture();
    expect(await value.registry.planAppend("d1-30s", value.old)).toMatchObject({ created: false, migrated_from_v1: false });
    const source = { kind: "owned", label: "new" } as const;
    const license = { status: "cleared", label: "owned", commercial_use: true } as const;
    const bytesSha = "3".repeat(64);
    const assetId = assetIdentity(bytesSha, source, license);
    const entry: AssetManifestEntry = { asset_id: assetId, project_path: `media/${bytesSha}/source.mp4`, sha256: bytesSha,
      media_type: "video/mp4", kind: "video", duration_frames: 30, source, license };
    await expect(value.registry.planAppend("d1-30s", { ...entry, asset_id: "asset_arbitrary" })).rejects.toMatchObject({
      status: 409, code: "MANIFEST_CHANGED",
    });
    const first = await value.registry.planAppend("d1-30s", entry);
    await value.registry.publish("d1-30s", first.before.sha256, first.after_bytes);
    const duplicate = await value.registry.planAppend("d1-30s", entry);
    expect(duplicate).toMatchObject({ created: false, migrated_from_v1: false });
    await expect(value.registry.planAppend("d1-30s", { ...entry, duration_frames: 31 })).rejects.toMatchObject({
      status: 409, code: "MANIFEST_CHANGED",
    });
    await writeFile(join(value.root, "narralens.assets.json"), JSON.stringify({
      format: "narralens.asset-manifest@1", assets: [value.old, value.old],
    }));
    await expect(value.registry.readManifest("d1-30s")).rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
  });

  it("derives distinct identities for the same bytes under different license facts while sharing the content path", async () => {
    const value = await registryFixture();
    const bytesSha = "5".repeat(64);
    const source = { kind: "owned", label: "camera original" } as const;
    const cleared = { status: "cleared", label: "owned", commercial_use: true } as const;
    const restricted = { status: "restricted", label: "editorial only", commercial_use: false } as const;
    expect(assetIdentity(bytesSha,
      { uri: "https://example.test/素材", label: "中文来源", kind: "owned" },
      { commercial_use: true, label: "中文许可", status: "cleared" }))
      .toBe(assetIdentity(bytesSha,
        { kind: "owned", label: "中文来源", uri: "https://example.test/素材" },
        { status: "cleared", label: "中文许可", commercial_use: true }));
    const path = `media/${bytesSha}/source.mp4`;
    const firstEntry: AssetManifestEntry = { asset_id: assetIdentity(bytesSha, source, cleared), project_path: path,
      sha256: bytesSha, media_type: "video/mp4", kind: "video", duration_frames: 30, source, license: cleared };
    const secondEntry: AssetManifestEntry = { ...firstEntry, asset_id: assetIdentity(bytesSha, source, restricted), license: restricted };
    expect(firstEntry.asset_id).not.toBe(secondEntry.asset_id);
    const first = await value.registry.planAppend("d1-30s", firstEntry);
    await value.registry.publish("d1-30s", first.before.sha256, first.after_bytes);
    const second = await value.registry.planAppend("d1-30s", secondEntry);
    expect(second.after.assets.slice(-2).map((asset) => [asset.asset_id, asset.project_path]))
      .toEqual([[firstEntry.asset_id, path], [secondEntry.asset_id, path]]);
  });

  it("re-reads media facts when bytes change without size or mtime signals", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-registry-fresh-"));
    const descriptor = JSON.parse(await readFile(resolve("fixtures/d1-30s/narralens.project.json"), "utf8"));
    const descriptorPath = join(root, "narralens.project.json");
    await writeFile(descriptorPath, `${JSON.stringify(descriptor)}\n`);
    await mkdir(join(root, "assets/generated"), { recursive: true });
    await cp(resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4"), join(root, "assets/generated/visual-10s.mp4"));
    await cp(resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4"), join(root, "assets/generated/visual-alt-10s.mp4"));
    const original = await readFile(resolve("fixtures/d1-30s/narralens.assets.json"), "utf8");
    const manifestPath = join(root, "narralens.assets.json");
    await writeFile(manifestPath, original);
    const registry = new AssetRegistry(new ProjectCatalog(new Map([["d1-30s", descriptorPath]])));
    expect((await registry.list("d1-30s"))[0]?.source_label).toBe("Narralens D1 本地生成测试素材");
    const mediaPath = join(root, "assets/generated/visual-10s.mp4");
    const beforeStat = await stat(mediaPath);
    const media = await readFile(mediaPath);
    media[media.length - 1] = media[media.length - 1]! ^ 1;
    await writeFile(mediaPath, media);
    await utimes(mediaPath, beforeStat.atime, beforeStat.mtime);
    await expect(registry.list("d1-30s")).rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
  }, 30_000);

  it("uses stable semantic error codes when duplicate identities enter through read or publish", async () => {
    const value = await registryFixture();
    const invalid = Buffer.from(JSON.stringify({ format: "narralens.asset-manifest@1", assets: [value.old, value.old] }));
    await expect(value.registry.publish("d1-30s", sha(value.before), invalid)).rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
    await writeFile(join(value.root, "narralens.assets.json"), invalid);
    await expect(value.registry.readManifest("d1-30s")).rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
  });
});

describe("D4.2.1 persistent asset import journal", () => {
  it("survives restart, replays the exact response and never advances project revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-import-journal-"));
    const path = join(root, "state.sqlite");
    const record = importRecord();
    const first = new RevisionStore(path);
    expect(first.prepareAssetImport(record, 7)).toBeUndefined();
    first.markAssetImportBytesInstalled(record.transaction_id, true);
    first.markAssetImportManifestPublished(record.transaction_id);
    expect(first.state(record.project_id, 7)).toMatchObject({ revision: 7, attention: true });
    first.close();

    const restarted = new RevisionStore(path);
    expect(restarted.incompleteAssetImports()).toHaveLength(1);
    expect(restarted.incompleteAssetImports()[0]).toMatchObject({ state: "manifest_published", bytes_created: true });
    const response: AssetImportResponse = { format: "narralens.asset-import-response@1.0", asset_id: record.asset_id,
      manifest_format: "narralens.asset-manifest@2", manifest_sha256: record.manifest_after_sha,
      created: true, migrated_from_v1: true };
    restarted.commitAssetImport(record.transaction_id, 201, response);
    expect(restarted.state(record.project_id, 7)).toMatchObject({ revision: 7, attention: false });
    expect(restarted.prepareAssetImport(record, 7)).toEqual({ status: 201, response });
    restarted.close();
  });

  it("rejects idempotency conflicts and persists attention independently of edit revision", () => {
    const store = new RevisionStore();
    const record = importRecord();
    store.prepareAssetImport(record, 2);
    expect(() => store.prepareAssetImport({ ...record, transaction_id: "txn_other", request_hash: "9".repeat(64) }, 2))
      .toThrowError(expect.objectContaining({ status: 409, code: "IDEMPOTENCY_KEY_CONFLICT" }));
    store.markAssetImportAttention(record.project_id, record.transaction_id, "IMPORT_MANIFEST_RECOVERY_UNPROVED");
    expect(store.assetImportJournal(record.transaction_id)).toMatchObject({ state: "attention", error_code: "IMPORT_MANIFEST_RECOVERY_UNPROVED" });
    expect(store.state(record.project_id, 2)).toMatchObject({ revision: 2, attention: true });
    store.close();
  });

  it("enforces prepared to bytes-installed to manifest-published before commit", () => {
    const store = new RevisionStore();
    const record = importRecord();
    const response: AssetImportResponse = { format: "narralens.asset-import-response@1.0", asset_id: record.asset_id,
      manifest_format: "narralens.asset-manifest@2", manifest_sha256: record.manifest_after_sha,
      created: true, migrated_from_v1: true };
    store.prepareAssetImport(record, 2);
    expect(() => store.markAssetImportManifestPublished(record.transaction_id)).toThrowError("INVALID_ASSET_IMPORT_TRANSITION");
    expect(() => store.commitAssetImport(record.transaction_id, 201, response)).toThrowError("INVALID_ASSET_IMPORT_TRANSITION");
    store.markAssetImportBytesInstalled(record.transaction_id, false);
    expect(() => store.commitAssetImport(record.transaction_id, 201, response)).toThrowError("INVALID_ASSET_IMPORT_TRANSITION");
    store.markAssetImportManifestPublished(record.transaction_id);
    store.commitAssetImport(record.transaction_id, 201, response);
    expect(store.assetImportJournal(record.transaction_id)?.state).toBe("committed");
    store.close();
  });

  it("retains attention across restart and enumerates it for recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-import-attention-"));
    const path = join(root, "state.sqlite");
    const record = importRecord();
    const first = new RevisionStore(path);
    first.prepareAssetImport(record, 2);
    first.markAssetImportAttention(record.project_id, record.transaction_id, "IMPORT_MANIFEST_RECOVERY_UNPROVED");
    first.close();
    const restarted = new RevisionStore(path);
    expect(restarted.incompleteAssetImports()).toEqual([
      expect.objectContaining({ transaction_id: record.transaction_id, state: "attention",
        error_code: "IMPORT_MANIFEST_RECOVERY_UNPROVED" }),
    ]);
    expect(restarted.state(record.project_id, 2)).toMatchObject({ revision: 2, attention: true });
    restarted.close();
  });
});

function importRecord(): AssetImportJournalRecord {
  const before = '{"format":"narralens.asset-manifest@1","assets":[]}\n';
  const after = '{"format":"narralens.asset-manifest@2","assets":[]}\n';
  return {
    transaction_id: "txn_import_1", project_id: "d1-30s", correlation_id: "corr-import-1",
    idempotency_key: "import-key-1", request_hash: "8".repeat(64), state: "prepared",
    asset_id: "asset_added", bytes_sha: "2".repeat(64), manifest_before_sha: sha(before), manifest_after_sha: sha(after),
    manifest_before_json: before, manifest_after_json: after, bytes_created: false,
  };
}
