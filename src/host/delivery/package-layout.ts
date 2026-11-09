import { createHash } from "node:crypto";
import type { DeliveryManifest, Ref } from "../../contracts/agent-driven-types.js";

/**
 * The layout of a delivery package.
 *
 * A package is a directory of files plus an index and a manifest. The names are fixed
 * here because three different things have to agree on them: the renderer that writes
 * the files, the index that describes them, and the download route that serves them.
 *
 * The reference ids are dotless on purpose. The contract's `Ref.id` and `download_ref`
 * patterns allow letters, digits, `_` and `-` and nothing else, so an id can never be a
 * file name that a caller could confuse with a path. The file names carry their
 * extensions; the ids do not.
 */

/** The names of the files inside a package. */
export const PACKAGE_FILES = Object.freeze({
  media: "media.mp4",
  ffprobe: "ffprobe.json",
  fullDecode: "full_decode.log",
  index: "index.json",
  manifest: "manifest.json",
});

/** The reference ids of the files inside a package. */
export const PACKAGE_REF_IDS = Object.freeze({
  media: "media",
  ffprobe: "ffprobe",
  fullDecode: "full_decode",
});

/** The prefix of a supplement's file name and reference id. */
export const PACKAGE_SUPPLEMENT_PREFIX = "supplement_";

/** The file name of the n-th supplement. */
export function supplementFileName(index: number, extension: string): string {
  const cleaned = extension.replace(/[^A-Za-z0-9]/gu, "").toLowerCase().slice(0, 8);
  return `${PACKAGE_SUPPLEMENT_PREFIX}${index}${cleaned.length > 0 ? `.${cleaned}` : ""}`;
}

/** The reference id of the n-th supplement. */
export function supplementRefId(index: number): string {
  return `${PACKAGE_SUPPLEMENT_PREFIX}${index}`;
}

/** One file of the package, as the index records it. */
export interface PackageIndexEntry {
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * The index of a package.
 *
 * The index says what the package contains and what every file hashes to, so that a
 * reader can check a package without trusting the manifest alone — and so that a
 * download can answer with the real digest of the bytes it is about to serve.
 */
export interface PackageIndex {
  readonly kind: "narralens.delivery_package_index@1.0";
  readonly delivery_id: string;
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly render_config_digest: string;
  readonly attempt: number;
  readonly download_ref: string;
  readonly files: readonly PackageIndexEntry[];
}

/** The reference of a package file, as the manifest carries it. */
export function packageRef(id: string, sha256: string): Ref {
  return { id, version: 1, sha256 };
}

/** The key a delivery is identified by: one film, one configuration. */
export interface DeliveryKey {
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly render_config_digest: string;
}

/**
 * The delivery id of a key.
 *
 * The id is derived from the key so that two attempts for the same film and the same
 * configuration produce the same id, and an attempt for a different film or a different
 * configuration produces a different one. That is what makes "one package per key"
 * possible without a database.
 */
export function deriveDeliveryId(key: DeliveryKey): string {
  // A delivery id may hold letters, digits, `_` and `-` and be at most 64 characters
  // long. A digest of the key fits in that with room to spare.
  return `d_${digestOfKey(key).slice(0, 32)}`;
}

/**
 * The package id of a key.
 *
 * A package holds the media of one delivery key, so that a second attempt for the same
 * film and configuration publishes into the same place and finds the winner's package
 * instead of a second copy.
 */
export function derivePackageId(key: DeliveryKey): string {
  return `pkg_${digestOfKey(key).slice(0, 32)}`;
}

/**
 * The download token of a package.
 *
 * The token names the package, so a caller cannot turn it into a path: it is checked
 * against the published packages and the package's own project before a byte is served.
 */
export function deriveDownloadRef(packageId: string): string {
  return `dl_${packageId.replace(/^pkg_/u, "")}`;
}

function digestOfKey(key: DeliveryKey): string {
  return createHash("sha256")
    .update(`${key.project_id}|${key.snapshot_id}|${key.render_config_digest}`, "utf8")
    .digest("hex");
}

/** The manifest of a published package, read back from disk. */
export type PublishedManifest = DeliveryManifest;
