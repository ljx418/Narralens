import { createHash } from "node:crypto";

/**
 * The layout of a delivery package.
 *
 * A package is a set of files plus a receipt that names them. The names are fixed here
 * because three different things have to agree on them: the renderer that writes the
 * files, the receipt that describes them, and the download route that serves them.
 *
 * The reference ids are dotless and carry the delivery's own identity. The contract's
 * `Ref.id` and `download_ref` patterns allow letters, digits, `_` and `-` and nothing
 * else, so an id can never be a file name that a caller could confuse with a path —
 * and an id that names only its role (`media`, `ffprobe`) would collide with every
 * other delivery's in whatever registry the ids end up in. An id that carries the
 * delivery id cannot collide with another delivery's.
 */

/** The names of the files inside a package. */
export const PACKAGE_FILES = Object.freeze({
  media: "media.mp4",
  ffprobe: "ffprobe.json",
  fullDecode: "full_decode.log",
  nativeDocument: "native_film.html",
  nativeSource: "native_source.json",
});

/** The roles the package's files have. */
export const PACKAGE_ROLES = Object.freeze({
  media: "media",
  ffprobe: "ffprobe",
  fullDecode: "full_decode",
  nativeDocument: "native_document",
  nativeSource: "native_source",
});

/** The prefix of a supplement's file name. */
export const PACKAGE_SUPPLEMENT_PREFIX = "supplement_";

/** The file name of the n-th supplement. */
export function supplementFileName(index: number, extension: string): string {
  const cleaned = extension.replace(/[^A-Za-z0-9]/gu, "").toLowerCase().slice(0, 8);
  return `${PACKAGE_SUPPLEMENT_PREFIX}${index}${cleaned.length > 0 ? `.${cleaned}` : ""}`;
}

/**
 * The reference id of a file of a delivery.
 *
 * The id is the delivery's id and the role, so it is unique per delivery and stable
 * for the same delivery.
 */
export function packageRefId(deliveryId: string, role: string): string {
  const id = `${deliveryId}_${role}`;
  if (id.length > 64 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(id)) {
    throw new Error(`PACKAGE_REF_ID_REJECTED:${id}`);
  }
  return id;
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
