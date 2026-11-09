import type { ReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PublishedPackageStore } from "../../../src/host/delivery/published-package-store.js";
import { buildDeliveryManifest } from "../../../src/host/delivery/manifest.js";
import { openDeliveryDownload, parseByteRange } from "../../../src/host/delivery/download.js";
import { PACKAGE_FILES, PACKAGE_ROLES, packageRefId } from "../../../src/host/delivery/package-layout.js";
import { removeDirectory, renderSpec, sha256Of, temporaryDirectory } from "./support.js";

/**
 * The download of a published delivery.
 *
 * Module checks for the range rules, the real digest as the ETag, the refusal to
 * serve another project's package and the refusal to serve bytes that were changed
 * after they were published. Serving a download to a real client is part of the real
 * acceptance and is `NOT_RUN`.
 */

const dirs: string[] = [];
const MEDIA = "the film bytes";
const DELIVERY_ID = "d_0123456789abcdef0123456789abcdef";
const PACKAGE_ID = "pkg_0123456789abcdef0123456789abcdef";
const DOWNLOAD_REF = "dl_0123456789abcdef0123456789abcdef";

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

/** Read a stream to the end. */
async function readAll(stream: ReadStream | null | undefined): Promise<string> {
  if (stream === null || stream === undefined) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function publishedStore(label: string): Promise<{ store: PublishedPackageStore; objectDir: string }> {
  const root = await directory(label);
  const store = new PublishedPackageStore({ root });
  const staging = await store.createStaging("attempt1", "00000000-0000-4000-8000-000000000002");
  const mediaPath = join(staging, PACKAGE_FILES.media);
  await writeFile(mediaPath, MEDIA, "utf8");
  const probePath = join(staging, PACKAGE_FILES.ffprobe);
  await writeFile(probePath, "{}", "utf8");
  const decodePath = join(staging, PACKAGE_FILES.fullDecode);
  await writeFile(decodePath, "", "utf8");

  const manifest = buildDeliveryManifest({
    delivery_id: DELIVERY_ID,
    project_id: "proj_media_01",
    snapshot_id: "snap_media_01",
    source_digest: "a".repeat(64),
    render_spec: renderSpec(),
    render_config_digest: "c".repeat(64),
    attempt: 1,
    media_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.media), version: 1, sha256: sha256Of(MEDIA) },
    ffprobe_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.ffprobe), version: 1, sha256: sha256Of("{}") },
    full_decode_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.fullDecode), version: 1, sha256: sha256Of("") },
    supplement_refs: [],
    qc: [{ id: "media_full_decode", status: "pass", reason: "the whole file decodes", evidence_ref: null }],
    published_at: "2026-11-09T10:00:00.000Z",
    download_ref: DOWNLOAD_REF,
  });

  const outcome = await store.publish({
    package_id: PACKAGE_ID,
    staging_dir: staging,
    files: [
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.media), name: PACKAGE_FILES.media, source_path: mediaPath },
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.ffprobe), name: PACKAGE_FILES.ffprobe, source_path: probePath },
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.fullDecode), name: PACKAGE_FILES.fullDecode, source_path: decodePath },
    ],
    manifest,
    published_at: "2026-11-09T10:00:00.000Z",
  });
  return { store, objectDir: join(root, "objects", outcome.object_id) };
}

describe("a byte range", () => {
  it("reads a range from the start", () => {
    expect(parseByteRange("bytes=0-3", 100)).toEqual({ start: 0, end: 3 });
  });

  it("reads a range to the end", () => {
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
  });

  it("reads the last bytes", () => {
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("refuses a range that starts past the end", () => {
    expect(parseByteRange("bytes=100-", 100)).toBeUndefined();
  });

  it("refuses a range that ends before it starts", () => {
    expect(parseByteRange("bytes=50-10", 100)).toBeUndefined();
  });

  it("refuses several ranges at once", () => {
    expect(parseByteRange("bytes=0-1,3-4", 100)).toBeUndefined();
  });

  it("treats no header as the whole file", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
  });
});

describe("downloading a published delivery", () => {
  it("serves the whole file with the real digest as the ETag", async () => {
    const { store } = await publishedStore("download-whole");
    const response = await openDeliveryDownload(store, {
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers["etag"]).toBe(`"${sha256Of(MEDIA)}"`);
    expect(response?.headers["accept-ranges"]).toBe("bytes");
    expect(response?.headers["content-length"]).toBe(String(MEDIA.length));
    expect(response?.total_bytes).toBe(MEDIA.length);
    expect(await readAll(response?.body)).toBe(MEDIA);
    await response?.close();
  });

  it("serves one range and says which one", async () => {
    const { store } = await publishedStore("download-range");
    const response = await openDeliveryDownload(store, {
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: "bytes=0-3",
    });

    expect(response?.status).toBe(206);
    expect(response?.headers["content-range"]).toBe(`bytes 0-3/${MEDIA.length}`);
    expect(response?.bytes).toBe(4);
    expect(await readAll(response?.body)).toBe(MEDIA.slice(0, 4));
    await response?.close();
  });

  it("answers an unsatisfiable range with 416 and the size of the file", async () => {
    const { store } = await publishedStore("download-unsatisfiable");
    const response = await openDeliveryDownload(store, {
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: "bytes=9999-",
    });

    expect(response?.status).toBe(416);
    expect(response?.headers["content-range"]).toBe(`bytes */${MEDIA.length}`);
    expect(response?.body).toBeNull();
    await response?.close();
  });

  it("refuses to serve another project's package", async () => {
    const { store } = await publishedStore("download-other-project");
    const response = await openDeliveryDownload(store, {
      project_id: "proj_media_02",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    });
    expect(response).toBeNull();
  });

  it("refuses a reference that is not a reference", async () => {
    const { store } = await publishedStore("download-tampered");
    for (const reference of ["../../etc/passwd", "dl_../secret", "not-a-reference", ""]) {
      const response = await openDeliveryDownload(store, {
        project_id: "proj_media_01",
        job_id: "job_media_01",
        download_ref: reference,
        range_header: undefined,
      });
      expect(response).toBeNull();
    }
  });

  it("refuses bytes that were changed after the package was published", async () => {
    const { store, objectDir } = await publishedStore("download-tampered-bytes");
    // The same number of bytes, different bytes: a size check alone would pass it.
    await writeFile(join(objectDir, PACKAGE_FILES.media), "THE FILM BYTES", "utf8");

    const response = await openDeliveryDownload(store, {
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    });
    expect(response).toBeNull();
  });

  it("serves the same bytes when it is asked twice", async () => {
    const { store } = await publishedStore("download-twice");
    const first = await openDeliveryDownload(store, {
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    });
    const second = await openDeliveryDownload(store, {
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    });

    expect(first?.sha256).toBe(second?.sha256);
    expect(await readAll(first?.body)).toBe(await readAll(second?.body));
    await first?.close();
    await second?.close();
  });
});
