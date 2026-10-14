import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupStagedAsset, receiveAssetUpload } from "../../src/host/assets/asset-import-upload.js";
import { validateImportedMedia } from "../../src/host/assets/media-validator.js";
import { HttpError, normalizeError } from "../../src/host/api-error.js";
import { buildAssetImportRequest } from "../../src/app/director/api/HostApiClient.js";

const servers: Array<ReturnType<typeof createServer>> = [];
const execute = promisify(execFile);
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await new Promise<void>((done) => server.close(() => done()))));
});

describe("D4.2.1 streaming asset upload", () => {
  it("accepts one bounded JSON metadata field and one MP4 part while hashing streamed bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-upload-"));
    const file = Buffer.from("fake-mp4-for-transport-only");
    const response = await postMultipart(root, multipartBody("valid-boundary", file), "valid-boundary", 1024);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      byteLength: file.length,
      bytesSha256: createHash("sha256").update(file).digest("hex"),
      idempotencyKey: "upload:test:1",
    });
    expect(await readdir(join(root, ".narralens/staging"))).toEqual([]);
    const exactRoot = await mkdtemp(join(tmpdir(), "narralens-upload-exact-limit-"));
    const exact = await postMultipart(exactRoot, multipartBody("exact-limit-boundary", Buffer.from("mp4")),
      "exact-limit-boundary", 3);
    expect(exact.status).toBe(200);
  });

  it("accepts the browser client's exact multipart wire format", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-upload-browser-wire-"));
    const file = Buffer.from("browser-mp4-wire-bytes");
    const request = buildAssetImportRequest(new Blob([file]), {
      idempotency_key: "upload:browser:1", source: { kind: "owned", label: "browser file" },
      license: { status: "cleared", label: "owned", commercial_use: true },
    });
    const response = await postMultipart(root, Buffer.from(await request.body.arrayBuffer()), request.boundary, 1024);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ byteLength: file.length, idempotencyKey: "upload:browser:1" });
  });

  it("rejects unknown or duplicate parts, incorrect part MIME and file overflow without leaving staging", async () => {
    const cases = [
      { body: multipartBody("unknown-boundary", Buffer.from("mp4"), [fieldPart("extra", "x", "text/plain")]), boundary: "unknown-boundary", limit: 1024, status: 400 },
      { body: multipartBody("mime-boundary", Buffer.from("mp4"), [], "application/octet-stream"), boundary: "mime-boundary", limit: 1024, status: 400 },
      { body: Buffer.from(multipartBody("metadata-mime-boundary", Buffer.from("mp4")).toString("utf8")
        .replace("Content-Type: application/json", "Content-Type: text/plain")), boundary: "metadata-mime-boundary", limit: 1024, status: 400 },
      { body: multipartBody("limit-boundary", Buffer.from("four")), boundary: "limit-boundary", limit: 3, status: 413 },
      { body: multipartBody("malformed-boundary", Buffer.from("mp4")).subarray(0, -8), boundary: "malformed-boundary", limit: 1024, status: 400 },
    ];
    for (const [index, value] of cases.entries()) {
      const root = await mkdtemp(join(tmpdir(), `narralens-upload-reject-${index}-`));
      const response = await postMultipart(root, value.body, value.boundary, value.limit);
      expect(response.status).toBe(value.status);
      expect(await readdir(join(root, ".narralens/staging"))).toEqual([]);
    }
  });

  it("rejects a transport envelope larger than the configured total before parsing", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-upload-envelope-"));
    const body = multipartBody("envelope-boundary", Buffer.from("mp4"));
    const response = await postMultipart(root, body, "envelope-boundary", 3, body.length - 1);
    expect(response.status).toBe(413);
    expect(await readdir(join(root, ".narralens/staging")).catch(() => [])).toEqual([]);
  });

  it("terminates a chunked raw-body overflow and cleans staging without a hanging pipeline", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-upload-chunked-"));
    const body = multipartBody("chunked-boundary", Buffer.from("mp4"));
    const response = await postChunkedMultipart(root, body, "chunked-boundary", 20, 40);
    expect(response.status).toBe(413);
    expect(await readdir(join(root, ".narralens/staging"))).toEqual([]);
  });

  it("rejects a symlinked staging root before creating or writing the upload file", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-upload-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "narralens-upload-outside-"));
    await mkdir(join(root, ".narralens"));
    await symlink(outside, join(root, ".narralens/staging"), "dir");
    const response = await postMultipart(root, multipartBody("symlink-boundary", Buffer.from("mp4")), "symlink-boundary", 1024);
    expect(response.status).toBe(500);
    expect(await readdir(outside)).toEqual([]);
  });
});

describe("D4.2.1 imported media validation", () => {
  it("proves a real MP4 has one CFR stream at the project rate and survives a second hash", async () => {
    const path = resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4");
    const bytes = await readFile(path);
    const facts = await validateImportedMedia(path, 30, createHash("sha256").update(bytes).digest("hex"));
    expect(facts).toMatchObject({ durationFrames: 300, width: 1280, height: 720 });
  }, 30_000);

  it("maps wrong frame rate and corrupt bytes to INVALID_MEDIA", async () => {
    const path = resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4");
    const bytes = await readFile(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    await expect(validateImportedMedia(path, 24, digest)).rejects.toMatchObject({ status: 422, code: "INVALID_MEDIA" });
    const root = await mkdtemp(join(tmpdir(), "narralens-invalid-media-"));
    const corrupt = join(root, "corrupt.mp4");
    await writeFile(corrupt, "not an mp4");
    await expect(validateImportedMedia(corrupt, 30,
      createHash("sha256").update("not an mp4").digest("hex"))).rejects.toMatchObject({ status: 422, code: "INVALID_MEDIA" });
  });

  it("rejects a real MP4 with variable frame durations after complete decode", async () => {
    const root = await mkdtemp(join(tmpdir(), "narralens-vfr-media-"));
    const path = join(root, "vfr.mp4");
    await execute("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=30:duration=2",
      "-vf", "setpts='if(gte(N,30),PTS+0.1/TB,PTS)'", "-fps_mode", "vfr", path], { timeout: 30_000 });
    const bytes = await readFile(path);
    await expect(validateImportedMedia(path, 30,
      createHash("sha256").update(bytes).digest("hex"))).rejects.toMatchObject({ status: 422, code: "INVALID_MEDIA" });
  }, 30_000);

  it("maps missing media tooling to MEDIA_TOOL_UNAVAILABLE", async () => {
    const path = resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4");
    const bytes = await readFile(path);
    await expect(validateImportedMedia(path, 30, createHash("sha256").update(bytes).digest("hex"),
      { ffprobe: "narralens-definitely-missing-ffprobe" })).rejects.toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE" });
  });
});

async function postMultipart(root: string, body: Buffer, boundary: string, fileBytes: number,
  totalBytes?: number): Promise<Response> {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const upload = await receiveAssetUpload(request, root, { fileBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
        const value = { byteLength: upload.byteLength, bytesSha256: upload.bytesSha256,
          idempotencyKey: upload.metadata.idempotency_key };
        await cleanupStagedAsset(upload);
        response.writeHead(200, { "content-type": "application/json", connection: "close" });
        response.end(JSON.stringify(value));
      } catch (error) {
        const normalized = error instanceof HttpError ? error : normalizeError(error);
        response.writeHead(normalized.status, { "content-type": "application/json", connection: "close" });
        response.end(JSON.stringify(normalized.body()));
      }
    })();
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_UNAVAILABLE");
  return await fetch(`http://127.0.0.1:${address.port}/`, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  });
}

async function postChunkedMultipart(root: string, body: Buffer, boundary: string, fileBytes: number,
  totalBytes: number): Promise<{ status: number; body: string }> {
  const server = createUploadServer(root, fileBytes, totalBytes);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_UNAVAILABLE");
  return await new Promise((resolvePromise, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: address.port, method: "POST", path: "/",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "transfer-encoding": "chunked" } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolvePromise({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    for (let offset = 0; offset < body.length; offset += 13) request.write(body.subarray(offset, offset + 13));
    request.end();
  });
}

function createUploadServer(root: string, fileBytes: number, totalBytes?: number): ReturnType<typeof createServer> {
  return createServer((request, response) => {
    void (async () => {
      try {
        const upload = await receiveAssetUpload(request, root, { fileBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
        await cleanupStagedAsset(upload);
        response.writeHead(200, { connection: "close" });
        response.end();
      } catch (error) {
        const normalized = error instanceof HttpError ? error : normalizeError(error);
        response.writeHead(normalized.status, { "content-type": "application/json", connection: "close" });
        response.end(JSON.stringify(normalized.body()));
      }
    })();
  });
}

function multipartBody(boundary: string, file: Buffer, extra: Buffer[] = [], fileType = "video/mp4"): Buffer {
  return Buffer.concat([
    fieldPart("metadata", JSON.stringify({
      idempotency_key: "upload:test:1",
      source: { kind: "owned", label: "local browser file" },
      license: { status: "cleared", label: "owned", commercial_use: true },
    }), "application/json", boundary),
    filePart("file", "ignored.mp4", fileType, file, boundary),
    ...extra.map((part) => Buffer.concat([Buffer.from(`--${boundary}\r\n`), part])),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
}

function fieldPart(name: string, value: string, type: string, boundary?: string): Buffer {
  const headers = `Content-Disposition: form-data; name="${name}"\r\nContent-Type: ${type}\r\n\r\n${value}\r\n`;
  return Buffer.from(boundary === undefined ? headers : `--${boundary}\r\n${headers}`);
}

function filePart(name: string, filename: string, type: string, bytes: Buffer, boundary: string): Buffer {
  return Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes, Buffer.from("\r\n")]);
}
