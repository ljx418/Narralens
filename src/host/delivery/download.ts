import { createReadStream, type ReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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
 *   about to be served, not a counter and not a timestamp.
 * - **One range.** A single range is answered with 206 and the exact bytes; an
 *   unsatisfiable one with 416 and the size of the file. Several ranges at once are
 *   refused rather than answered with a multipart body, because a multipart body is a
 *   different document and would need a different ETag.
 */

/** The request half. */
export interface DownloadRequest {
  readonly project_id: string;
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
    const start = Math.max(0, totalBytes - suffix);
    if (totalBytes === 0) return undefined;
    return { start, end: totalBytes - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" || rawEnd === undefined ? totalBytes - 1 : Number(rawEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return undefined;
  if (start < 0 || start >= totalBytes) return undefined;
  if (end < start) return undefined;
  return { start, end: Math.min(end, totalBytes - 1) };
}

/**
 * Open the download of a published delivery.
 *
 * `null` means there is nothing to serve: either the token names nothing, or it names
 * something that belongs to another project. The caller turns that into a 404 — the
 * distinction between "does not exist" and "belongs to somebody else" is not something
 * a download route should publish.
 */
export async function openDeliveryDownload(
  store: PublishedPackageStore,
  request: DownloadRequest,
): Promise<DownloadResponse | null> {
  const resolved = await store.resolveDownloadRef(request.download_ref, request.project_id);
  if (resolved === null) return null;

  const media = await store.resolvePackageFile(resolved.package_id, resolved.manifest.media_ref.id);
  if (media === null) return null;

  let size: number;
  try {
    size = (await stat(media.path)).size;
  } catch {
    return null;
  }
  if (size !== media.entry.bytes) {
    // The published file is not the file the index describes. Serving it would mean
    // answering with an ETag that is not the digest of the bytes.
    return null;
  }

  const sha256 = media.entry.sha256;
  const range = parseByteRange(request.range_header, size);
  const baseHeaders: Record<string, string> = {
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    "etag": `"${sha256}"`,
    "cache-control": "private, max-age=3600, immutable",
    "x-content-type-options": "nosniff",
  };

  if (range === undefined) {
    return {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${size}`, "content-length": "0" },
      body: null,
      bytes: 0,
      total_bytes: size,
      sha256,
    };
  }

  if (range === null) {
    return {
      status: 200,
      headers: { ...baseHeaders, "content-length": String(size) },
      body: createReadStream(media.path),
      bytes: size,
      total_bytes: size,
      sha256,
    };
  }

  const length = range.end - range.start + 1;
  return {
    status: 206,
    headers: {
      ...baseHeaders,
      "content-length": String(length),
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
    },
    body: createReadStream(media.path, { start: range.start, end: range.end }),
    bytes: length,
    total_bytes: size,
    sha256,
  };
}
