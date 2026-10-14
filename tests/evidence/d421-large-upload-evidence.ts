import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { once } from "node:events";
import { promisify } from "node:util";

import { cleanupStagedAsset, receiveAssetUpload } from "../../src/host/assets/asset-import-upload.js";
import { validateImportedMedia } from "../../src/host/assets/media-validator.js";
import { HttpError, normalizeError } from "../../src/host/api-error.js";

const execute = promisify(execFile);
const mib = 1024 * 1024;
const targetBytes = 64 * mib;
const boundary = "narralens-d421-large-evidence";
const metadata = JSON.stringify({
  idempotency_key: "evidence:d421:large:1",
  source: { kind: "owned", label: "D421-LARGE-01 local evidence" },
  license: { status: "cleared", label: "owned", commercial_use: true },
});

const temporaryRoot = await mkdtemp(join(tmpdir(), "narralens-d421-large-"));
const projectRoot = join(temporaryRoot, "project");
const mediaPath = join(temporaryRoot, "real-64m.mp4");
let server: Server | undefined;

try {
  await mkdir(projectRoot);
  await createPaddedMp4(resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4"), mediaPath, targetBytes);
  const probe = await execute("ffprobe", ["-v", "error", "-show_entries", "format=format_name,size",
    "-of", "json", mediaPath], { timeout: 30_000, maxBuffer: 64 * 1024 });
  const probeJson = JSON.parse(probe.stdout) as { format?: { format_name?: string; size?: string } };
  if (!probeJson.format?.format_name?.includes("mp4") || Number(probeJson.format.size) !== targetBytes) {
    throw new Error("D421_LARGE_FIXTURE_NOT_REAL_MP4");
  }

  const success = await runUpload(projectRoot, mediaPath, 96 * mib, true);
  if (success.status !== 200 || success.fileBytes !== targetBytes || success.drainEvents < 1) {
    throw new Error(`D421_LARGE_STREAMING_FAILED:${JSON.stringify(success)}`);
  }
  const rssLimit = 48 * mib;
  if (success.peakRssDeltaBytes >= rssLimit) {
    throw new Error(`D421_LARGE_RSS_UNBOUNDED:${success.peakRssDeltaBytes}`);
  }

  const rejection = await runUpload(projectRoot, mediaPath, 32 * mib, false);
  if (rejection.status !== 413) throw new Error(`D421_LARGE_CAP_NOT_ENFORCED:${JSON.stringify(rejection)}`);
  const stagingEntries = await readdir(join(projectRoot, ".narralens/staging")).catch(() => []);
  if (stagingEntries.length !== 0) throw new Error(`D421_LARGE_STAGING_NOT_CLEAN:${stagingEntries.join(",")}`);

  process.stdout.write(`${JSON.stringify({
    format: "narralens.d421-large-upload-evidence@1",
    generated_at: new Date().toISOString(),
    fixture: { filename: basename(mediaPath), byte_length: targetBytes, ffprobe_format: probeJson.format.format_name },
    success: {
      status: success.status,
      uploaded_bytes: success.fileBytes,
      socket_backpressure_events: success.backpressureEvents,
      socket_drain_events: success.drainEvents,
      peak_rss_delta_bytes: success.peakRssDeltaBytes,
      rss_limit_bytes: rssLimit,
      decoded_frames: success.decodedFrames,
    },
    lowered_cap: { file_limit_bytes: 32 * mib, status: rejection.status, staging_entries_after: stagingEntries.length },
  }, null, 2)}\n`);
} finally {
  if (server?.listening) await new Promise<void>((done) => server?.close(() => done()));
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function createPaddedMp4(source: string, destination: string, bytes: number): Promise<void> {
  await copyFile(source, destination);
  const handle = await open(destination, "r+");
  try {
    const facts = await handle.stat();
    const freeAtomBytes = bytes - facts.size;
    if (freeAtomBytes < 8 || freeAtomBytes > 0xffff_ffff) throw new Error("D421_LARGE_INVALID_FREE_ATOM");
    const header = Buffer.alloc(8);
    header.writeUInt32BE(freeAtomBytes, 0);
    header.write("free", 4, "ascii");
    await handle.write(header, 0, header.length, facts.size);
    await handle.truncate(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

interface UploadResult {
  status: number;
  fileBytes: number;
  decodedFrames?: number;
  backpressureEvents: number;
  drainEvents: number;
  peakRssDeltaBytes: number;
}

async function runUpload(root: string, filePath: string, fileLimit: number, sendBody: boolean): Promise<UploadResult> {
  let receivedBytes = 0;
  let decodedFrames: number | undefined;
  server = createServer((request, response) => {
    void (async () => {
      try {
        const upload = await receiveAssetUpload(request, root, { fileBytes: fileLimit });
        receivedBytes = upload.byteLength;
        const media = await validateImportedMedia(upload.filePath, 30, upload.bytesSha256);
        decodedFrames = media.durationFrames;
        await cleanupStagedAsset(upload);
        response.writeHead(200, { connection: "close" });
        response.end();
      } catch (error) {
        const normalized = error instanceof HttpError ? error : normalizeError(error);
        response.writeHead(normalized.status, { connection: "close", "content-type": "application/json" });
        response.end(JSON.stringify(normalized.body()));
      }
    })();
  });
  await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("D421_LARGE_SERVER_ADDRESS_UNAVAILABLE");

  const field = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`);
  const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${basename(filePath)}"\r\nContent-Type: video/mp4\r\n\r\n`);
  const trailer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const contentLength = field.length + fileHeader.length + targetBytes + trailer.length;
  const baselineRss = process.memoryUsage.rss();
  let peakRss = baselineRss;
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage.rss()); }, 5);
  let backpressureEvents = 0;
  let drainEvents = 0;
  try {
    const outcome = await new Promise<{ status: number }>((resolvePromise, reject) => {
      const outgoing = httpRequest({ hostname: "127.0.0.1", port: address.port, method: "POST", path: "/",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(contentLength) } },
      (response) => {
        response.resume();
        response.once("end", () => resolvePromise({ status: response.statusCode ?? 0 }));
      });
      outgoing.once("error", reject);
      void (async () => {
        if (!sendBody) { outgoing.end(); return; }
        for (const chunk of [field, fileHeader]) await writeChunk(outgoing, chunk);
        const source = createReadStream(filePath, { highWaterMark: 64 * 1024 });
        for await (const chunk of source) await writeChunk(outgoing, chunk as Buffer);
        await writeChunk(outgoing, trailer);
        outgoing.end();
      })().catch((error: unknown) => outgoing.destroy(error instanceof Error ? error : new Error(String(error))));

      async function writeChunk(target: ReturnType<typeof httpRequest>, chunk: Buffer): Promise<void> {
        if (target.write(chunk)) return;
        backpressureEvents += 1;
        await once(target, "drain");
        drainEvents += 1;
      }
    });
    return { ...outcome, fileBytes: receivedBytes, ...(decodedFrames === undefined ? {} : { decodedFrames }),
      backpressureEvents, drainEvents, peakRssDeltaBytes: Math.max(0, peakRss - baselineRss) };
  } finally {
    clearInterval(sample);
    await new Promise<void>((done) => server?.close(() => done()));
    server = undefined;
  }
}
