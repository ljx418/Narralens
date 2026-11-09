import { constants } from "node:fs";
import { createReadStream, type ReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { PublishedPackageStore } from "./published-package-store.js";

/**
 * The download of a published delivery.
 *
 * The rules are the ones the contract states, and each of them exists because of
 * something that goes wrong without it:
 *
 * - **No redirect.** The bytes are served from the published package. There is no
 *   second location to be redirected to, so there is nothing to leak.
 * - **A controlled reference.** The download token names a package; it is not a path,
 *   and it is checked against the published packages and against the project that owns
 *   them before a byte is read.
 * - **The real digest as the ETag.** The ETag is the SHA-256 of the bytes that are
 *   about to be served, not a counter and not a timestamp — and the bytes that are
 *   served are the bytes that were hashed, through the same open file, so a file that
 *   was changed in place fails instead of being served under a digest that no longer
 *   describes it.
 * - **One range.** A single range is answered with 206 and the exact bytes; an
 *   unsatisfiable one with 416 and the size of the file. Several ranges at once are
 *   refused rather than answered with a multipart body, because a multipart body is a
 *   different document and would need a different ETag.
 */

/** The request half. */
export interface DownloadRequest {
  readonly project_id: string;
  /** The job the delivery belongs to. The record that authorises the bytes is MAIN's. */
  readonly job_id: string;
  readonly download_ref: string;
  /** The raw `Range` header, if the caller sent one. */
  readonly range_header: string | undefined;
}

/** The response half. */
export interface DownloadResponse {
  readonly status: 200 | 206 | 416;
  readonly headers: Readonly<Record<string, string>>;
  /** The stream of the bytes. Null for a 416, which has no body. */
  readonly body: ReadStream | null;
  /** How many bytes are about to be sent. */
  readonly bytes: number;
  /** How many bytes the file has. */
  readonly total_bytes: number;
  /** The digest of the whole file. */
  readonly sha256: string;
  /**
   * Close what the response holds open.
   *
   * The file is served from a descriptor that was opened here, so somebody has to close
   * it. The route calls this when it has finished writing the response.
   */
  readonly close: () => Promise<void>;
}

/** A parsed range. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Parse a single byte range.
 *
 * `null` means the header was not a range this Host answers; `undefined` means it was
 * a range that cannot be satisfied.
 */
export function parseByteRange(header: string | undefined, totalBytes: number): ByteRange | null | undefined {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return undefined;
  const [, rawStart, rawEnd] = match;
  if ((rawStart ?? "") === "" && (rawEnd ?? "") === "") return undefined;
  if ((rawStart ?? "") === "") {
    // The last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    if (totalBytes === 0) return undefined;
    const start = Math.max(0, totalBytes - suffix);
    return { start, end: totalBytes - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" || rawEnd === undefined ? totalBytes - 1 : Number(rawEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return undefined;
  if (start < 0 || start >= totalBytes) return undefined;
  if (end < start) return undefined;
  return { start, end: Math.min(end, totalBytes - 1) };
}

/** The digest of what an open file holds, read through that same file. */
async function digestOf(handle: FileHandle): Promise<string | null> {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } catch {
    return null;
  }
  return hash.digest("hex");
}

/**
 * Open the download of a published delivery.
 *
 * `null` means there is nothing to serve: either the token names nothing, or it names
 * something that belongs to another project, or the package does not match its receipt.
 * The caller turns that into a 404 — the distinction between "does not exist" and
 * "belongs to somebody else" is not something a download route should publish.
 */
export async function openDeliveryDownload(
  store: PublishedPackageStore,
  request: DownloadRequest,
): Promise<DownloadResponse | null> {
  const resolved = await store.resolveDownloadRef(request.download_ref, request.project_id);
  if (resolved === null) return null;

  const receipt = resolved.receipt;
  const mediaEntry = receipt.files.find((file) => file.id === receipt.manifest.media_ref.id);
  if (mediaEntry === undefined) return null;

  // Every other file of the package is checked against the receipt before the media is
  // opened; the media itself is checked through the descriptor it is served from.
  const verified = await store.verifyPackage(resolved.package_id, { except_ref_id: mediaEntry.id });
  if (verified === null) return null;

  const media = await store.resolvePackageFile(resolved.package_id, mediaEntry.id);
  if (media === null) return null;

  let handle: FileHandle;
  try {
    // `O_NOFOLLOW`: the file has to be the file the receipt names. A link is refused
    // rather than followed.
    handle = await open(media.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }

  const close = async (): Promise<void> => { await handle.close().catch(() => undefined); };

  try {
    const info = await handle.stat();
    if (!info.isFile()) { await close(); return null; }
    if (info.size !== mediaEntry.bytes) { await close(); return null; }

    const digest = await digestOf(handle);
    if (digest === null || digest !== mediaEntry.sha256) {
      // The bytes on disk are not the bytes the receipt names. A file that was changed
      // in place fails here, even when its size did not change.
      await close();
      return null;
    }

    const sha256 = mediaEntry.sha256;
    const range = parseByteRange(request.range_header, info.size);
    const baseHeaders: Record<string, string> = {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "etag": `"${sha256}"`,
      "cache-control": "private, max-age=3600, immutable",
      "x-content-type-options": "nosniff",
    };

    if (range === undefined) {
      await close();
      return {
        status: 416,
        headers: { ...baseHeaders, "content-range": `bytes */${info.size}`, "content-length": "0" },
        body: null,
        bytes: 0,
        total_bytes: info.size,
        sha256,
        close: async () => undefined,
      };
    }

    if (range === null) {
      return {
        status: 200,
        headers: { ...baseHeaders, "content-length": String(info.size) },
        // The path is ignored when a descriptor is given; the descriptor is the file
        // that was opened with O_NOFOLLOW and hashed.
        body: createReadStream(media.path, { fd: handle.fd, autoClose: false }),
        bytes: info.size,
        total_bytes: info.size,
        sha256,
        close,
      };
    }

    const length = range.end - range.start + 1;
    return {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-length": String(length),
        "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
      },
      body: createReadStream(media.path, { fd: handle.fd, start: range.start, end: range.end, autoClose: false }),
      bytes: length,
      total_bytes: info.size,
      sha256,
      close,
    };
  } catch {
    await close();
    return null;
  }
}
