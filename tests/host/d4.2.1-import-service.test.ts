import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AssetImportMetadata, AssetImportResponse, AssetManifest, AssetManifestEntry } from "../../src/contracts/types.js";
import { NarralensHost } from "../../src/host/server.js";
import { AssetRegistry, assetIdentity } from "../../src/host/projects/asset-registry.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore, type AssetImportJournalRecord } from "../../src/host/projects/revision-store.js";

const hosts: NarralensHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(async (host) => await host.close())); });

const metadata: AssetImportMetadata = {
  idempotency_key: "import:real:001",
  source: { kind: "owned", label: "browser-selected local source" },
  license: { status: "cleared", label: "owned for project", commercial_use: true },
};

describe("D4.2.1 AssetImportService HTTP transaction", () => {
  it("streams a real MP4, migrates @1 to @2, replays exactly and changes no authored project facts", async () => {
    const initial = JSON.parse(await readFile(resolve("fixtures/d1-30s/narralens.assets.json"), "utf8")) as AssetManifest;
    const fixture = await projectFixture(initial);
    const media = await readFile(resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4"));
    const before = await authoredHashes(fixture.root);
    const started = await startFixture(fixture);

    const first = await postImport(started.origin, started.token, media, metadata);
    expect(first.status, await first.clone().text()).toBe(201);
    const firstBody = await first.json() as AssetImportResponse;
    expect(firstBody).toMatchObject({ manifest_format: "narralens.asset-manifest@2", created: true, migrated_from_v1: true });
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as AssetManifest;
    expect(manifest.format).toBe("narralens.asset-manifest@2");
    const imported = manifest.assets.find((asset) => asset.asset_id === firstBody.asset_id)!;
    expect(imported).toBeDefined();
    expect(await readFile(join(fixture.root, imported.project_path))).toEqual(media);

    const committedManifest = await readFile(fixture.manifestPath);
    await writeFile(fixture.manifestPath, "{broken manifest\n");
    const replay = await postImport(started.origin, started.token, media, metadata);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstBody);
    await writeFile(fixture.manifestPath, committedManifest);
    const duplicate = await postImport(started.origin, started.token, media, { ...metadata, idempotency_key: "import:real:002" });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ asset_id: firstBody.asset_id, manifest_format: "narralens.asset-manifest@2",
      created: false, migrated_from_v1: false });
    const manifestBeforeConflict = await readFile(fixture.manifestPath);
    const conflict = await postImport(started.origin, started.token, media, { ...metadata, source: { ...metadata.source,
      label: "different request under same key" } });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(await readFile(fixture.manifestPath)).toEqual(manifestBeforeConflict);

    const inventory = await fetch(`${started.origin}/api/projects/d1-30s/assets`, { headers: auth(started.origin, started.token) });
    expect(inventory.status).toBe(200);
    expect((await inventory.json() as { assets: unknown[] }).assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ asset_id: firstBody.asset_id, availability: "available", eligible: true }),
    ]));
    expect(await authoredHashes(fixture.root)).toEqual(before);
    expect(started.host.revisions.state("d1-30s", 2).revision).toBe(2);
    expect(started.host.diagnostics.write_actor_execute_count).toBe(0);
  }, 60_000);

  it("returns a truthful @1 no-op for an exact duplicate without changing manifest bytes", async () => {
    const media = await readFile(resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4"));
    const bytesSha = createHash("sha256").update(media).digest("hex");
    const entry: AssetManifestEntry = {
      asset_id: assetIdentity(bytesSha, metadata.source, metadata.license),
      project_path: `media/${bytesSha}/source.mp4`, sha256: bytesSha, media_type: "video/mp4", kind: "video",
      duration_frames: 300, source: metadata.source, license: metadata.license,
    };
    const fixture = await projectFixture({ format: "narralens.asset-manifest@1", assets: [entry] });
    await mkdir(join(fixture.root, "media", bytesSha), { recursive: true });
    await writeFile(join(fixture.root, entry.project_path), media);
    const manifestBefore = await readFile(fixture.manifestPath);
    const started = await startFixture(fixture);
    const response = await postImport(started.origin, started.token, media, metadata);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ asset_id: entry.asset_id, manifest_format: "narralens.asset-manifest@1",
      created: false, migrated_from_v1: false });
    expect(await readFile(fixture.manifestPath)).toEqual(manifestBefore);
    expect(started.host.revisions.state("d1-30s", 2).revision).toBe(2);
  }, 60_000);

  it("rejects invalid media before journal or manifest mutation and removes private staging", async () => {
    const initial = JSON.parse(await readFile(resolve("fixtures/d1-30s/narralens.assets.json"), "utf8")) as AssetManifest;
    const fixture = await projectFixture(initial);
    const before = await readFile(fixture.manifestPath);
    const started = await startFixture(fixture);
    const response = await postImport(started.origin, started.token, Buffer.from("not-an-mp4"),
      { ...metadata, idempotency_key: "import:invalid:001" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "INVALID_MEDIA" });
    expect(await readFile(fixture.manifestPath)).toEqual(before);
    expect(started.host.revisions.incompleteAssetImports()).toEqual([]);
    expect(started.host.revisions.state("d1-30s", 2).revision).toBe(2);
  }, 30_000);

  it("commits a manifest-published journal deterministically before opening the HTTP port after restart", async () => {
    const initial = JSON.parse(await readFile(resolve("fixtures/d1-30s/narralens.assets.json"), "utf8")) as AssetManifest;
    const fixture = await projectFixture(initial);
    const catalog = new ProjectCatalog(new Map([["d1-30s", fixture.descriptorPath]]));
    const registry = new AssetRegistry(catalog);
    const media = await readFile(resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4"));
    const bytesSha = createHash("sha256").update(media).digest("hex");
    const entry: AssetManifestEntry = { asset_id: assetIdentity(bytesSha, metadata.source, metadata.license),
      project_path: `media/${bytesSha}/source.mp4`, sha256: bytesSha, media_type: "video/mp4", kind: "video",
      duration_frames: 300, source: metadata.source, license: metadata.license };
    const plan = await registry.planAppend("d1-30s", entry);
    await mkdir(join(fixture.root, "media", bytesSha), { recursive: true });
    await writeFile(join(fixture.root, entry.project_path), media);
    await mkdir(join(fixture.root, ".narralens"), { recursive: true });
    const databasePath = join(fixture.root, ".narralens", "state.sqlite");
    const firstStore = new RevisionStore(databasePath);
    const record: AssetImportJournalRecord = {
      transaction_id: "asset_import_restart_test", project_id: "d1-30s", correlation_id: "correlation-restart",
      idempotency_key: metadata.idempotency_key, request_hash: "8".repeat(64), state: "prepared",
      asset_id: entry.asset_id, bytes_sha: bytesSha, manifest_before_sha: plan.before.sha256,
      manifest_after_sha: plan.after_sha256, manifest_before_json: Buffer.from(plan.before.bytes).toString("utf8"),
      manifest_after_json: Buffer.from(plan.after_bytes).toString("utf8"), bytes_created: false,
    };
    firstStore.prepareAssetImport(record, 2);
    firstStore.markAssetImportBytesInstalled(record.transaction_id, false);
    await registry.publish("d1-30s", plan.before.sha256, plan.after_bytes);
    firstStore.markAssetImportManifestPublished(record.transaction_id);
    firstStore.close();

    const restartedStore = new RevisionStore(databasePath);
    const host = new NarralensHost({ catalog, revisionStore: restartedStore });
    hosts.push(host);
    await host.listen(0);
    expect(restartedStore.assetImportJournal(record.transaction_id)).toMatchObject({ state: "committed",
      response_status: 201 });
    expect(restartedStore.state("d1-30s", 2)).toMatchObject({ revision: 2, attention: false });
  }, 30_000);

  it("restores the exact manifest preimage and removes unreferenced new bytes after a publish-before-journal crash", async () => {
    const initial = JSON.parse(await readFile(resolve("fixtures/d1-30s/narralens.assets.json"), "utf8")) as AssetManifest;
    const fixture = await projectFixture(initial);
    const catalog = new ProjectCatalog(new Map([["d1-30s", fixture.descriptorPath]]));
    const registry = new AssetRegistry(catalog);
    const media = Buffer.from("unique-content-addressed-recovery-fixture");
    const bytesSha = createHash("sha256").update(media).digest("hex");
    const entry: AssetManifestEntry = { asset_id: assetIdentity(bytesSha, metadata.source, metadata.license),
      project_path: `media/${bytesSha}/source.mp4`, sha256: bytesSha, media_type: "video/mp4", kind: "video",
      duration_frames: 1, source: metadata.source, license: metadata.license };
    const plan = await registry.planAppend("d1-30s", entry);
    await mkdir(join(fixture.root, "media", bytesSha), { recursive: true });
    const contentPath = join(fixture.root, entry.project_path);
    await writeFile(contentPath, media);
    await mkdir(join(fixture.root, ".narralens"), { recursive: true });
    const databasePath = join(fixture.root, ".narralens", "crash-state.sqlite");
    const firstStore = new RevisionStore(databasePath);
    const record: AssetImportJournalRecord = {
      transaction_id: "asset_import_publish_crash", project_id: "d1-30s", correlation_id: "correlation-crash",
      idempotency_key: "import:crash:001", request_hash: "9".repeat(64), state: "prepared",
      asset_id: entry.asset_id, bytes_sha: bytesSha, manifest_before_sha: plan.before.sha256,
      manifest_after_sha: plan.after_sha256, manifest_before_json: Buffer.from(plan.before.bytes).toString("utf8"),
      manifest_after_json: Buffer.from(plan.after_bytes).toString("utf8"), bytes_created: false,
    };
    firstStore.prepareAssetImport(record, 2);
    firstStore.markAssetImportBytesInstalled(record.transaction_id, true);
    await registry.publish("d1-30s", plan.before.sha256, plan.after_bytes);
    firstStore.close();

    const restartedStore = new RevisionStore(databasePath);
    const host = new NarralensHost({ catalog, revisionStore: restartedStore });
    hosts.push(host);
    await host.listen(0);
    expect(restartedStore.assetImportJournal(record.transaction_id)?.state).toBe("compensated");
    expect(await readFile(fixture.manifestPath)).toEqual(plan.before.bytes);
    await expect(readFile(contentPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(restartedStore.state("d1-30s", 2)).toMatchObject({ revision: 2, attention: false });
  }, 30_000);
});

async function projectFixture(manifest: AssetManifest): Promise<{ root: string; descriptorPath: string; manifestPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "narralens-import-service-"));
  await cp(resolve("fixtures/d1-30s"), root, { recursive: true });
  const descriptorPath = join(root, "narralens.project.json");
  const manifestPath = join(root, "narralens.assets.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return { root, descriptorPath, manifestPath };
}

async function startFixture(fixture: { descriptorPath: string }): Promise<{ host: NarralensHost; origin: string; token: string }> {
  const catalog = new ProjectCatalog(new Map([["d1-30s", fixture.descriptorPath]]));
  const host = new NarralensHost({ catalog, revisionStore: new RevisionStore() });
  hosts.push(host);
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const session = await fetch(`${origin}/api/session`, { headers: { origin } });
  return { host, origin, token: (await session.json() as { token: string }).token };
}

async function postImport(origin: string, token: string, media: Buffer, value: AssetImportMetadata): Promise<Response> {
  const boundary = `narralens-test-${createHash("sha256").update(value.idempotency_key).digest("hex").slice(0, 16)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ignored-user-name.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
    media,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return await fetch(`${origin}/api/projects/d1-30s/assets/import`, { method: "POST",
    headers: { ...auth(origin, token), "content-type": `multipart/form-data; boundary=${boundary}` },
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer });
}

function auth(origin: string, token: string): HeadersInit { return { origin, authorization: `Bearer ${token}` }; }

async function authoredHashes(root: string): Promise<Record<string, string>> {
  const files = ["authors/main.svml", "runs/build.svrun", "assets/generated/narration-30s.wav"];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file,
    createHash("sha256").update(await readFile(join(root, file))).digest("hex")] as const)));
}
