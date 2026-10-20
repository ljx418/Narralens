import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import type { HypitMediaCapture, MutationResult } from "../../src/adapters/hypit/hypit-write-adapter.js";
import type { AssetImportMetadata, AssetManifest } from "../../src/contracts/types.js";
import { cleanupStagedAsset, receiveAssetUpload } from "../../src/host/assets/asset-import-upload.js";
import { AssetImportService } from "../../src/host/assets/asset-import-service.js";
import { validateImportedMedia, type ToolExecutor } from "../../src/host/assets/media-validator.js";
import { HttpError, normalizeError } from "../../src/host/api-error.js";
import { AssetRegistry, assetIdentity } from "../../src/host/projects/asset-registry.js";
import { ProjectCatalog, type ProjectDescriptor } from "../../src/host/projects/project-catalog.js";
import { InMemoryProjectOperationQueue, type ProjectOperationQueue } from "../../src/host/projects/project-operation-queue.js";
import { ProjectWriteActor } from "../../src/host/projects/project-write-actor.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { NarralensHost } from "../../src/host/server.js";

const execute = promisify(execFile);
const hosts: NarralensHost[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(async (host) => await host.close()));
  await Promise.all(servers.splice(0).map(async (server) => await new Promise<void>((done) => server.close(() => done()))));
});

describe("M1A direct multipart and closed-route evidence", () => {
  it("IM-02 accepts file before metadata through the real import route", async () => {
    const fixture = await copiedProject("reverse");
    const started = await startHost(fixture.descriptorPath);
    const media = await readFile(resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4"));
    const boundary = "m1a-reverse-parts";
    const response = await fetch(`${started.origin}/api/projects/d1-30s/assets/import`, {
      method: "POST", headers: { ...auth(started.origin, started.token), "content-type": `multipart/form-data; boundary=${boundary}` },
      body: bodyInit(multipart(boundary, [filePart(boundary, media), metadataPart(boundary, metadata("m1a:reverse:1"))])),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: true, migrated_from_v1: true });
  }, 30_000);

  it("IM-03..IM-09 rejects duplicate/missing/oversize/malformed multipart variants and cleans staging", async () => {
    const valid = metadata("m1a:multipart:1");
    const cases: Array<{ name: string; contentType: string; body: Buffer; expected: number }> = [];
    const add = (name: string, parts: Buffer[], expected = 400, boundary = `m1a-${name}`): void => {
      cases.push({ name, contentType: `multipart/form-data; boundary=${boundary}`, body: multipart(boundary, parts), expected });
    };
    add("duplicate-metadata-same", [metadataPart("m1a-duplicate-metadata-same", valid), metadataPart("m1a-duplicate-metadata-same", valid), filePart("m1a-duplicate-metadata-same", Buffer.from("x"))]);
    add("duplicate-metadata-different", [metadataPart("m1a-duplicate-metadata-different", valid), metadataPart("m1a-duplicate-metadata-different", metadata("m1a:other")), filePart("m1a-duplicate-metadata-different", Buffer.from("x"))]);
    add("duplicate-file-same-name", [metadataPart("m1a-duplicate-file-same-name", valid), filePart("m1a-duplicate-file-same-name", Buffer.from("x")), filePart("m1a-duplicate-file-same-name", Buffer.from("x"))]);
    add("duplicate-file-different-name", [metadataPart("m1a-duplicate-file-different-name", valid), filePart("m1a-duplicate-file-different-name", Buffer.from("x"), "first.mp4"), filePart("m1a-duplicate-file-different-name", Buffer.from("x"), "second.mp4")]);
    add("multiple-files", [metadataPart("m1a-multiple-files", valid), filePart("m1a-multiple-files", Buffer.from("x"), "first.mp4"), filePart("m1a-multiple-files", Buffer.from("y"), "second.mp4")]);
    add("missing-metadata", [filePart("m1a-missing-metadata", Buffer.from("x"))]);
    add("missing-file", [metadataPart("m1a-missing-file", valid)]);
    add("unknown-part", [metadataPart("m1a-unknown-part", valid), fieldPart("m1a-unknown-part", "unknown", "x"), filePart("m1a-unknown-part", Buffer.from("x"))]);
    add("bad-json", [fieldPart("m1a-bad-json", "metadata", "{bad", "application/json"), filePart("m1a-bad-json", Buffer.from("x"))]);
    add("duplicate-json-key", [fieldPart("m1a-duplicate-json-key", "metadata", "{\"idempotency_key\":\"a\",\"idempotency_key\":\"b\"}", "application/json"), filePart("m1a-duplicate-json-key", Buffer.from("x"))]);
    for (const size of [16_383, 16_384, 16_385]) {
      const boundary = `m1a-metadata-${size}`;
      add(`metadata-${size}`, [fieldPart(boundary, "metadata", "x".repeat(size), "application/json"), filePart(boundary, Buffer.from("x"))], size > 16_384 ? 413 : 400, boundary);
    }
    cases.push({ name: "non-multipart", contentType: "application/json", body: Buffer.from("{}"), expected: 400 });
    cases.push({ name: "missing-boundary", contentType: "multipart/form-data", body: Buffer.from("x"), expected: 400 });
    cases.push({ name: "bad-boundary", contentType: "multipart/form-data; boundary=not-the-body", body: multipart("actual", [metadataPart("actual", valid), filePart("actual", Buffer.from("x"))]).subarray(0, -5), expected: 400 });

    for (const value of cases) {
      const root = await mkdtemp(join(tmpdir(), `narralens-${value.name}-`));
      const response = await uploadTransport(root, value.contentType, value.body);
      expect(response.status, value.name).toBe(value.expected);
      expect(await readdir(join(root, ".narralens/staging")).catch(() => [])).toEqual([]);
    }
  });

  it("IM-24/IM-25 keeps materialize/adopt unavailable and rejects a fabricated edit operation without state change", async () => {
    const fixture = await copiedProject("closed-routes");
    const started = await startHost(fixture.descriptorPath);
    const before = await projectFacts(started.origin, started.token);
    for (const path of ["/api/proposals/proposal_x/materialize", "/api/proposals/proposal_x/adopt",
      "/api/projects/d1-30s/proposals/proposal_x/adopt"]) {
      const response = await fetch(`${started.origin}${path}`, { method: "POST", headers: auth(started.origin, started.token) });
      expect(response.status, path).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    const invented = await fetch(`${started.origin}/api/projects/d1-30s/edits`, { method: "POST",
      headers: { ...auth(started.origin, started.token), "content-type": "application/json" },
      body: JSON.stringify({ base_revision: 2, idempotency_key: "m1a:invented-adopt", selection: {
        shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600,
      }, preserve: ["narration", "duration"], operations: [{ op: "adopt_materialized_proposal", proposal_id: "proposal_x" }] }),
    });
    expect(invented.status).toBe(422);
    expect(await invented.json()).toMatchObject({ code: "UNSUPPORTED_EDIT" });
    expect(await projectFacts(started.origin, started.token)).toEqual(before);
    expect(started.host.diagnostics.write_actor_execute_count).toBe(0);
  }, 30_000);
});

describe("M1A direct media-tool evidence", () => {
  it("IM-11/IM-12 rejects real audio-only and multi-video MP4 files", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-stream-count-"));
    const audioOnly = join(root, "audio-only.mp4");
    const multiVideo = join(root, "multi-video.mp4");
    await execute("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", audioOnly]);
    await execute("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=red:size=32x32:rate=30:duration=1",
      "-f", "lavfi", "-i", "color=blue:size=32x32:rate=30:duration=1", "-map", "0:v", "-map", "1:v", "-c:v", "libx264", multiVideo]);
    for (const path of [audioOnly, multiVideo]) {
      const digest = sha(await readFile(path));
      await expect(validateImportedMedia(path, 30, digest)).rejects.toMatchObject({ status: 422, code: "INVALID_MEDIA" });
    }
  }, 30_000);

  it("IM-13 rejects a zero-frame probe and a real corrupt container", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-zero-frame-"));
    const path = join(root, "empty.mp4");
    await writeFile(path, "not-an-mp4");
    const zeroFrame: ToolExecutor = async () => ({ stdout: JSON.stringify({ format: { format_name: "mp4" }, streams: [{
      codec_type: "video", avg_frame_rate: "30/1", r_frame_rate: "30/1", nb_read_frames: "0", width: 32, height: 32,
    }] }), stderr: "" });
    await expect(validateImportedMedia(path, 30, sha(await readFile(path)), { execute: zeroFrame })).rejects.toMatchObject({ status: 422, code: "INVALID_MEDIA" });
    await expect(validateImportedMedia(path, 30, sha(await readFile(path)))).rejects.toMatchObject({ status: 422, code: "INVALID_MEDIA" });
  });

  it("IM-14..IM-17 distinguishes missing ffmpeg/ffprobe, timeout, stderr overflow and ordinary tool failure", async () => {
    const path = resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4");
    const digest = sha(await readFile(path));
    await expect(validateImportedMedia(path, 30, digest, { ffprobe: "missing-m1a-ffprobe" })).rejects.toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE" });
    await expect(validateImportedMedia(path, 30, digest, { ffmpeg: "missing-m1a-ffmpeg" })).rejects.toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE" });
    for (const code of ["ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"] as const) {
      const failing: ToolExecutor = async () => { throw Object.assign(new Error(code), { code, stderr: "bounded" }); };
      await expect(validateImportedMedia(path, 30, digest, { execute: failing, timeoutMs: 1, stderrBytes: 16 }))
        .rejects.toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE" });
    }
    const nonzero: ToolExecutor = async () => { throw Object.assign(new Error("exit 1"), { code: 1, stderr: "decode failed" }); };
    await expect(validateImportedMedia(path, 30, digest, { execute: nonzero })).rejects.toMatchObject({ status: 422, code: "INVALID_MEDIA" });

    for (const code of ["ENOMEM", "EMFILE", "EAGAIN"] as const) {
      const exhausted: ToolExecutor = async () => { throw Object.assign(new Error(code), { code }); };
      await expect(validateImportedMedia(path, 30, digest, { execute: exhausted }))
        .rejects.toMatchObject({ status: 503, code: "HOST_RESOURCE_EXHAUSTED",
          details: { reason: `TRANSIENT:${code}`, recoverable: true } });
    }

    const root = await mkdtemp(join(tmpdir(), "narralens-real-tool-failure-"));
    const pidPath = join(root, "tool.pid");
    const timeoutTool = join(root, "timeout-tool.sh");
    await writeFile(timeoutTool, `#!/bin/sh\necho $$ > "${pidPath}"\nwhile :; do sleep 1; done\n`);
    await chmod(timeoutTool, 0o700);
    await expect(validateImportedMedia(path, 30, digest, { ffprobe: timeoutTool, timeoutMs: 100 }))
      .rejects.toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE" });
    const toolPid = Number(await readFile(pidPath, "utf8"));
    await expectProcessGone(toolPid);

    const stderrTool = join(root, "stderr-tool.sh");
    await writeFile(stderrTool, "#!/bin/sh\nyes x | head -c 65536 >&2\nexit 1\n");
    await chmod(stderrTool, 0o700);
    await expect(validateImportedMedia(path, 30, digest, { ffprobe: stderrTool, stderrBytes: 128 }))
      .rejects.toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE" });
  }, 30_000);
});

describe("M1A inventory and shared-write-boundary evidence", () => {
  it("IM-18..IM-21 serves 256 ordered items over HTTP, caps probes at 2, isolates one timeout, revalidates changed bytes and rejects the 257th", async () => {
    const fixture = await inventoryFixture();
    let active = 0; let maximum = 0; let probes = 0;
    const registry = new AssetRegistry(fixture.catalog, {
      hashFile: async (path) => sha(await readFile(path)),
      videoFrames: async (path) => {
        active += 1; maximum = Math.max(maximum, active); probes += 1;
        await new Promise((done) => setTimeout(done, 1));
        active -= 1;
        if (path.endsWith("/asset-042/source.mp4")) throw Object.assign(new Error("probe timeout"), { code: "ETIMEDOUT" });
        return 30;
      },
    });
    const revisions = new RevisionStore();
    const queue = new InMemoryProjectOperationQueue();
    const actor = new ProjectWriteActor(fixture.catalog, revisions,
      new FakeMediaHypit(await fixture.catalog.readDescriptor("inventory-256")) as never, queue, registry);
    const imports = new AssetImportService(fixture.catalog, registry, revisions, queue);
    const host = new NarralensHost({ catalog: fixture.catalog, revisionStore: revisions, operationQueue: queue, writes: actor, imports });
    hosts.push(host);
    const port = await host.listen(0); const origin = `http://127.0.0.1:${port}`;
    const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as { token: string }).token;
    const inventoryGet = async (): Promise<ReturnType<AssetRegistry["inventory"]> extends Promise<infer T> ? T : never> => {
      const response = await fetch(`${origin}/api/projects/inventory-256/assets`, { headers: auth(origin, token) });
      expect(response.status).toBe(200);
      return await response.json() as Awaited<ReturnType<AssetRegistry["inventory"]>>;
    };
    const first = await inventoryGet();
    expect(first.assets).toHaveLength(256);
    expect(first.assets.map((asset) => asset.asset_id)).toEqual(Array.from({ length: 256 }, (_, index) => `asset_${index.toString().padStart(3, "0")}`));
    expect(maximum).toBe(2);
    expect(first.assets[42]).toMatchObject({ availability: "unavailable", eligible: false, blocking_reasons: ["BYTES_UNAVAILABLE"] });
    expect(first.assets.filter((asset) => asset.availability === "available")).toHaveLength(255);
    await writeFile(join(fixture.root, "media/asset-007/source.mp4"), "y");
    const second = await inventoryGet();
    expect(second.assets[7]).toMatchObject({ availability: "unavailable", eligible: false, blocking_reasons: ["HASH_MISMATCH"] });
    expect(probes).toBeGreaterThanOrEqual(509);

    const newSha = "b".repeat(64);
    const source = { kind: "owned" as const, label: "257th asset" };
    const license = { status: "cleared" as const, label: "owned", commercial_use: true };
    await expect(registry.planAppend("inventory-256", { asset_id: assetIdentity(newSha, source, license),
      project_path: `media/${newSha}/source.mp4`, sha256: newSha, media_type: "video/mp4", kind: "video",
      duration_frames: 30, source, license })).rejects.toMatchObject({ status: 409, code: "MANIFEST_CHANGED" });
  }, 30_000);

  it("IM-22 serializes real HTTP import commit with a real D4.0 edit and only the edit advances revision", async () => {
    const fixture = await copiedProject("shared-queue");
    const catalog = new ProjectCatalog(new Map([["d1-30s", fixture.descriptorPath]]));
    const revisions = new RevisionStore();
    const queue = new ObservedQueue();
    const registry = new AssetRegistry(catalog);
    const actor = new ProjectWriteActor(catalog, revisions, new FakeMediaHypit(await catalog.readDescriptor("d1-30s")) as never, queue, registry);
    const imports = new AssetImportService(catalog, registry, revisions, queue);
    const host = new NarralensHost({ catalog, revisionStore: revisions, operationQueue: queue, writes: actor, imports });
    hosts.push(host);
    const port = await host.listen(0); const origin = `http://127.0.0.1:${port}`;
    const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as { token: string }).token;
    const media = await readFile(resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4"));
    const importPromise = postImport(origin, token, media, metadata("m1a:queue-import"));
    const editPromise = fetch(`${origin}/api/projects/d1-30s/edits`, { method: "POST",
      headers: { ...auth(origin, token), "content-type": "application/json" }, body: JSON.stringify({
        base_revision: 2, idempotency_key: "m1a:queue-edit", selection: { shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
        preserve: ["narration", "duration"], operations: [{ op: "replace_visual_asset", shot_id: "shot-002", asset_id: "asset_visual_d4_alt" }],
      }) });
    const [importResponse, editResponse] = await Promise.all([importPromise, editPromise]);
    expect(importResponse.status).toBe(201);
    expect(editResponse.status).toBe(200);
    expect(queue.maximum).toBe(1);
    expect((await projectFacts(origin, token)).revision).toBe(3);
  }, 60_000);
});

class ObservedQueue implements ProjectOperationQueue {
  readonly delegate = new InMemoryProjectOperationQueue();
  active = 0; maximum = 0;
  run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    return this.delegate.run(projectId, async () => {
      this.active += 1; this.maximum = Math.max(this.maximum, this.active);
      try { await new Promise((done) => setTimeout(done, 10)); return await operation(); }
      finally { this.active -= 1; }
    });
  }
}

class FakeMediaHypit {
  asset = "asset_visual_baseline";
  constructor(readonly descriptor: ProjectDescriptor) {}
  capture(): HypitMediaCapture {
    const source = `shot-1=asset_visual_baseline;shot-2=${this.asset};shot-3=asset_visual_baseline`;
    return { descriptor: this.descriptor, snapshot: { revision: 1, source: { path: "authors/main.svml", text: source },
      timeline: { frameCount: 900 }, tracks: [{ binding: { facet: "visual" }, items: [{ id: "opaque-shot-2", authoredId: "shot-2",
        startFrame: 300, endFrameExclusive: 600, inspector: [], mediaAsset: { assetId: this.asset, sha256: this.asset === "asset_visual_baseline" ? "38cc9e8b7d251b70096f8a355b9823872cff8aedec440074c9d09a2f827db225" : "95b24adfd889fac7d63c5f7ead20d76595d63ef47aa5c17c55b5de7e621572aa" } }] }] },
      target: { id: "opaque-shot-2", authoredId: "shot-2", startFrame: 300, endFrameExclusive: 600, inspector: [], mediaAsset: {
        assetId: this.asset, sha256: this.asset === "asset_visual_baseline" ? "38cc9e8b7d251b70096f8a355b9823872cff8aedec440074c9d09a2f827db225" : "95b24adfd889fac7d63c5f7ead20d76595d63ef47aa5c17c55b5de7e621572aa" } },
      media_asset: { asset_id: this.asset, sha256: this.asset === "asset_visual_baseline" ? "38cc9e8b7d251b70096f8a355b9823872cff8aedec440074c9d09a2f827db225" : "95b24adfd889fac7d63c5f7ead20d76595d63ef47aa5c17c55b5de7e621572aa" },
      source_sha256: sha(source), run_sha256: sha("run"), narration_sha256: sha("voice"), semantic: [
        { authored_id: "shot-1", start_frame: 0, end_frame_exclusive: 300, media_asset_id: "asset_visual_baseline" },
        { authored_id: "shot-2", start_frame: 300, end_frame_exclusive: 600, media_asset_id: this.asset },
        { authored_id: "shot-3", start_frame: 600, end_frame_exclusive: 900, media_asset_id: "asset_visual_baseline" },
      ] };
  }
  async inspectMedia(): Promise<HypitMediaCapture> { return this.capture(); }
  async mutateMedia(_capture: HypitMediaCapture, assetId: string): Promise<MutationResult> { this.asset = assetId; return { status: 200, revision: 2 }; }
}

async function inventoryFixture(): Promise<{ root: string; catalog: ProjectCatalog; manifest: AssetManifest; manifestPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "narralens-inventory-256-"));
  const descriptor = JSON.parse(await readFile(resolve("fixtures/d1-30s/narralens.project.json"), "utf8")) as ProjectDescriptor;
  descriptor.project_id = "inventory-256";
  const descriptorPath = join(root, "narralens.project.json");
  await writeFile(descriptorPath, `${JSON.stringify(descriptor)}\n`);
  const assets = [];
  for (let index = 0; index < 256; index += 1) {
    const directory = join(root, "media", `asset-${index.toString().padStart(3, "0")}`);
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, "source.mp4"), "x");
    assets.push({ asset_id: `asset_${index.toString().padStart(3, "0")}`, project_path: `media/asset-${index.toString().padStart(3, "0")}/source.mp4`,
      sha256: sha("x"), media_type: "video/mp4" as const, kind: "video" as const, duration_frames: 30,
      source: { kind: "owned" as const, label: `asset ${index}` }, license: { status: "cleared" as const, label: "owned", commercial_use: true } });
  }
  const manifest: AssetManifest = { format: "narralens.asset-manifest@2", assets };
  const manifestPath = join(root, "narralens.assets.json"); await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return { root, catalog: new ProjectCatalog(new Map([["inventory-256", descriptorPath]])), manifest, manifestPath };
}

async function expectProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`timed-out media child process ${pid} remained alive`);
}

async function copiedProject(name: string): Promise<{ root: string; descriptorPath: string }> {
  const root = await mkdtemp(join(tmpdir(), `narralens-m1a-${name}-`));
  await cp(resolve("fixtures/d1-30s"), root, { recursive: true });
  return { root, descriptorPath: join(root, "narralens.project.json") };
}

async function startHost(descriptorPath: string): Promise<{ host: NarralensHost; origin: string; token: string }> {
  const host = new NarralensHost({ catalog: new ProjectCatalog(new Map([["d1-30s", descriptorPath]])), revisionStore: new RevisionStore() });
  hosts.push(host); const port = await host.listen(0); const origin = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as { token: string }).token;
  return { host, origin, token };
}

async function uploadTransport(root: string, contentType: string, body: Buffer): Promise<Response> {
  const server = createServer((request, response) => { void (async () => {
    try { const upload = await receiveAssetUpload(request, root, { fileBytes: 1024, totalBytes: 96 * 1024 }); await cleanupStagedAsset(upload); response.writeHead(200); response.end(); }
    catch (error) { const normalized = error instanceof HttpError ? error : normalizeError(error); response.writeHead(normalized.status, { "content-type": "application/json" }); response.end(JSON.stringify(normalized.body())); }
  })(); });
  servers.push(server); await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("NO_TEST_PORT");
  return await fetch(`http://127.0.0.1:${address.port}/`, { method: "POST", headers: { "content-type": contentType }, body: bodyInit(body) });
}

async function postImport(origin: string, token: string, media: Buffer, value: AssetImportMetadata): Promise<Response> {
  const boundary = "m1a-concurrent-import";
  return await fetch(`${origin}/api/projects/d1-30s/assets/import`, { method: "POST",
    headers: { ...auth(origin, token), "content-type": `multipart/form-data; boundary=${boundary}` },
    body: bodyInit(multipart(boundary, [metadataPart(boundary, value), filePart(boundary, media)])) });
}

function metadata(key: string): AssetImportMetadata { return { idempotency_key: key, source: { kind: "owned", label: "M1A fixture" }, license: { status: "cleared", label: "owned", commercial_use: true } }; }
function metadataPart(boundary: string, value: AssetImportMetadata): Buffer { return fieldPart(boundary, "metadata", JSON.stringify(value), "application/json"); }
function fieldPart(boundary: string, name: string, value: string, type = "text/plain"): Buffer { return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: ${type}\r\n\r\n${value}\r\n`); }
function filePart(boundary: string, bytes: Buffer, filename = "fixture.mp4"): Buffer { return Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`), bytes, Buffer.from("\r\n")]); }
function multipart(boundary: string, parts: Buffer[]): Buffer { return Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]); }
function auth(origin: string, token: string): Record<string, string> { return { origin, authorization: `Bearer ${token}` }; }
async function projectFacts(origin: string, token: string): Promise<{ revision: number; jobs: number }> {
  const project = await (await fetch(`${origin}/api/projects/d1-30s`, { headers: auth(origin, token) })).json() as { revision: number };
  return { revision: project.revision, jobs: 0 };
}
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function bodyInit(value: Buffer): ArrayBuffer { return Uint8Array.from(value).buffer; }
