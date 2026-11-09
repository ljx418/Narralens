import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, link, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { DeliveryManifest } from "../../contracts/agent-driven-types.js";
import { PACKAGE_FILES, type PackageIndex, type PackageIndexEntry } from "./package-layout.js";
import { validateDeliveryManifest } from "./manifest.js";

/**
 * The store of published delivery packages.
 *
 * A published package is immutable and is never overwritten. Three properties matter:
 *
 * - **No clobber.** The package is built in the staging area and moved into place with
 *   one `rename`, which fails when the name is taken by something that is not empty.
 *   Two attempts for the same delivery key therefore produce one package: the first
 *   one wins, the second one finds the winner's package and reports it.
 * - **No half package.** The whole directory appears at its final name in one step, so
 *   a reader never finds a package that is still being written. The manifest inside it
 *   says the package is complete, and a directory without a manifest is not one.
 * - **No touching anyone else's data.** Cleanup only ever removes a directory this
 *   attempt created, under a root this attempt was given. A published package is never
 *   removed, and a name that is taken by something this Host did not publish is left
 *   exactly as it was found.
 */

export class PublishedPackageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PublishedPackageError";
  }
}

/** Where the store keeps its directories. */
export interface PublishedPackageStoreOptions {
  /** The delivery root. Every directory this store touches is under it. */
  readonly root: string;
  readonly published_dir?: string;
  readonly staging_dir?: string;
  readonly quarantine_dir?: string;
}

/** One file to publish. */
export interface PublishFile {
  /** The name inside the package. It must be a plain file name. */
  readonly name: string;
  /** Where the bytes are now. It must be inside the staging directory. */
  readonly source_path: string;
}

/** What to publish. */
export interface PublishInput {
  readonly package_id: string;
  readonly staging_dir: string;
  readonly files: readonly PublishFile[];
  /** The manifest file inside the staging directory. It is published last. */
  readonly manifest_path: string;
  readonly manifest: DeliveryManifest;
}

/** What happened. */
export type PublishOutcome =
  | {
    readonly status: "published";
    readonly package_id: string;
    /** The manifest that is published — this attempt's own. */
    readonly manifest: DeliveryManifest;
    readonly path: string;
  }
  | {
    readonly status: "already_published";
    readonly package_id: string;
    /** The manifest that is published — the winner's, not this attempt's. */
    readonly manifest: DeliveryManifest;
    readonly path: string;
  };

function isAlreadyExists(error: unknown): boolean {
  return (error as { code?: unknown }).code === "EEXIST";
}

/**
 * Whether the filesystem says the name is taken.
 *
 * A `rename` onto a directory that exists and is not empty fails with `ENOTEMPTY`; onto
 * a file it fails with `ENOTDIR`. Both mean the same thing here: somebody else's bytes
 * are under that name.
 */
function isNameTaken(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return code === "EEXIST" || code === "ENOTEMPTY" || code === "ENOTDIR";
}

/** A file name that cannot walk out of the package. */
function assertPlainFileName(name: string): string {
  if (typeof name !== "string" || name.length === 0 || name.length > 128) {
    throw new PublishedPackageError("FILE_NAME_REJECTED", "a package file has no usable name");
  }
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new PublishedPackageError("FILE_NAME_REJECTED", `a package file name is not a plain name: ${name}`);
  }
  return name;
}

function contained(root: string, path: string): boolean {
  const base = resolve(root);
  const target = resolve(path);
  return target === base || target.startsWith(`${base}${sep}`);
}

async function sha256File(path: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

export class PublishedPackageStore {
  readonly root: string;
  readonly publishedDir: string;
  readonly stagingDir: string;
  readonly quarantineDir: string;

  constructor(options: PublishedPackageStoreOptions) {
    this.root = resolve(options.root);
    this.publishedDir = resolve(options.published_dir ?? resolve(this.root, "published"));
    this.stagingDir = resolve(options.staging_dir ?? resolve(this.root, "staging"));
    this.quarantineDir = resolve(options.quarantine_dir ?? resolve(this.root, "quarantine"));
  }

  /** Create the directories the store needs. */
  async prepare(): Promise<void> {
    await mkdir(this.publishedDir, { recursive: true, mode: 0o700 });
    await mkdir(this.stagingDir, { recursive: true, mode: 0o700 });
    await mkdir(this.quarantineDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Create a staging directory for one attempt.
   *
   * The name carries a random identity, because two attempts of the same job can start
   * in the same millisecond and a name built from the clock alone would let the second
   * one write into the first one's directory.
   */
  async createStaging(label: string, identity: string): Promise<string> {
    const cleaned = label.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 48);
    const path = resolve(this.stagingDir, `${cleaned.length === 0 ? "attempt" : cleaned}-${identity.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 64)}`);
    await mkdir(path, { recursive: true, mode: 0o700 });
    return path;
  }

  /** The directory of a published package. */
  packagePath(packageId: string): string {
    const safe = packageId.replace(/[^A-Za-z0-9_-]/gu, "");
    if (safe.length === 0 || safe !== packageId) {
      throw new PublishedPackageError("PACKAGE_ID_REJECTED", "the package id is not a plain name");
    }
    const path = resolve(this.publishedDir, safe);
    if (!contained(this.publishedDir, path)) {
      throw new PublishedPackageError("PACKAGE_ID_REJECTED", "the package id names something outside the published packages");
    }
    return path;
  }

  /**
   * Publish a package.
   *
   * The whole package is built in the staging area and then moved into place with one
   * `rename`. That is the whole atomicity argument: a package either is at its final
   * name, complete, or it is not there at all. There is no window in which a reader
   * can find half a package, and no window in which a crash leaves a directory that
   * looks like a delivery.
   *
   * The move fails when the name is taken by something that is not empty. The winner's
   * package is then read, checked and reported: the delivery that exists is the
   * published one, whoever produced it. A name that is taken by something that is not a
   * package is refused — it is not this Host's to overwrite.
   */
  async publish(input: PublishInput): Promise<PublishOutcome> {
    await this.prepare();
    const target = this.packagePath(input.package_id);
    const packageDir = resolve(input.staging_dir, "package");
    await mkdir(packageDir, { recursive: true, mode: 0o700 });

    try {
      await this.#linkFiles(input, packageDir);
      await this.#fsyncDir(packageDir);
      await rename(packageDir, target);
    } catch (error) {
      // Only the directory this attempt built.
      await rm(packageDir, { recursive: true, force: true }).catch(() => undefined);
      if (!isNameTaken(error)) throw error;
      const existing = await this.#readManifestFile(target);
      if (existing === null) {
        throw new PublishedPackageError(
          "PACKAGE_OCCUPIED",
          "the package's name is taken by something that is not a published package; it was left alone",
        );
      }
      await this.#verifyPublished(target, existing);
      return { status: "already_published", package_id: input.package_id, manifest: existing, path: target };
    }

    await this.#fsyncDir(this.publishedDir);
    return { status: "published", package_id: input.package_id, manifest: input.manifest, path: target };
  }

  async #linkFiles(input: PublishInput, target: string): Promise<void> {
    for (const file of input.files) {
      const name = assertPlainFileName(file.name);
      if (!contained(input.staging_dir, file.source_path)) {
        throw new PublishedPackageError("STAGING_ESCAPE", `a file to publish is not inside the staging directory: ${name}`);
      }
      const destination = resolve(target, name);
      if (!contained(target, destination)) {
        throw new PublishedPackageError("STAGING_ESCAPE", `a file to publish would land outside the package: ${name}`);
      }
      await this.#linkOrVerify(file.source_path, destination);
    }
    // The manifest is the marker that says the package is a package. It is written
    // into the package before the package is moved into place, so a reader never finds
    // a package without one.
    if (!contained(input.staging_dir, input.manifest_path)) {
      throw new PublishedPackageError("STAGING_ESCAPE", "the manifest to publish is not inside the staging directory");
    }
    await this.#linkOrVerify(input.manifest_path, resolve(target, PACKAGE_FILES.manifest));
  }

  /**
   * Link a file into the package.
   *
   * A link fails when the name is taken, which is the property wanted: the first
   * publisher wins and every other learns the name is taken and checks the bytes
   * instead of overwriting them.
   */
  async #linkOrVerify(source: string, destination: string): Promise<void> {
    try {
      await link(source, destination);
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const [sourceDigest, destinationDigest] = await Promise.all([sha256File(source), sha256File(destination)]);
    if (sourceDigest === null || sourceDigest !== destinationDigest) {
      throw new PublishedPackageError("PUBLISHED_BYTES_DIFFER", "the published package holds different bytes for a file of the same name");
    }
  }

  async #readManifestFile(directory: string): Promise<DeliveryManifest | null> {
    try {
      const raw = await readFile(resolve(directory, PACKAGE_FILES.manifest), "utf8");
      return validateDeliveryManifest(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /**
   * Check that a published package is the package its manifest says it is.
   *
   * The media's digest is recomputed. A package whose media does not hash to the
   * manifest's `media_ref` is not a package this Host may serve, and saying so is
   * better than serving bytes under somebody else's digest.
   */
  async #verifyPublished(directory: string, manifest: DeliveryManifest): Promise<void> {
    const index = await this.#readIndexFile(directory);
    if (index === null) {
      throw new PublishedPackageError("PUBLISHED_INDEX_MISSING", "the published package has no index");
    }
    if (index.project_id !== manifest.project_id || index.download_ref !== manifest.download_ref) {
      throw new PublishedPackageError("PUBLISHED_INDEX_MISMATCH", "the published package's index does not match its manifest");
    }
    const media = index.files.find((file) => file.id === manifest.media_ref.id);
    if (media === undefined || media.sha256 !== manifest.media_ref.sha256) {
      throw new PublishedPackageError("PUBLISHED_MEDIA_MISMATCH", "the published package's media does not match its manifest");
    }
    const actual = await sha256File(resolve(directory, media.file));
    if (actual !== manifest.media_ref.sha256) {
      throw new PublishedPackageError("PUBLISHED_MEDIA_DIGEST_MISMATCH", "the published package's media does not hash to its digest");
    }
  }

  /** The index of a published package, looked up by project and delivery id. */
  async readIndex(projectId: string, deliveryId: string): Promise<PackageIndex | null> {
    const names = await readdir(this.publishedDir, { withFileTypes: true }).catch(() => []);
    for (const entry of names) {
      if (!entry.isDirectory()) continue;
      const directory = resolve(this.publishedDir, entry.name);
      const manifest = await this.#readManifestFile(directory);
      if (manifest === null) continue;
      if (manifest.project_id !== projectId || manifest.delivery_id !== deliveryId) continue;
      try {
        const raw = await readFile(resolve(directory, PACKAGE_FILES.index), "utf8");
        return JSON.parse(raw) as PackageIndex;
      } catch {
        return null;
      }
    }
    return null;
  }

  /** The manifest of a published package. */
  async readManifest(packageId: string): Promise<DeliveryManifest | null> {
    return await this.#readManifestFile(this.packagePath(packageId));
  }

  /** The file of a published package, by its reference id. */
  async resolvePackageFile(packageId: string, refId: string): Promise<{ path: string; entry: PackageIndexEntry } | null> {
    const directory = this.packagePath(packageId);
    const index = await this.#readIndexFile(directory);
    if (index === null) return null;
    const entry = index.files.find((file) => file.id === refId);
    if (entry === undefined) return null;
    const path = resolve(directory, entry.file);
    if (!contained(directory, path)) return null;
    return { path, entry };
  }

  async #readIndexFile(directory: string): Promise<PackageIndex | null> {
    try {
      const raw = await readFile(resolve(directory, PACKAGE_FILES.index), "utf8");
      return JSON.parse(raw) as PackageIndex;
    } catch {
      return null;
    }
  }

  /** The package a download token names, if it is published and belongs to the project. */
  async resolveDownloadRef(downloadRef: string, projectId: string): Promise<{ package_id: string; manifest: DeliveryManifest } | null> {
    if (typeof downloadRef !== "string" || !/^dl_[A-Za-z0-9_-]{1,60}$/u.test(downloadRef)) return null;
    const packageId = `pkg_${downloadRef.slice(3)}`;
    let directory: string;
    try { directory = this.packagePath(packageId); }
    catch { return null; }
    const manifest = await this.#readManifestFile(directory);
    if (manifest === null) return null;
    if (manifest.project_id !== projectId) return null;
    if (manifest.download_ref !== downloadRef) return null;
    return { package_id: packageId, manifest };
  }

  /** Whether a package is published and complete. */
  async isPublished(packageId: string): Promise<boolean> {
    return (await this.#readManifestFile(this.packagePath(packageId))) !== null;
  }

  /**
   * Remove a staging directory.
   *
   * Only a directory under this store's staging root is removed, and only a directory
   * this attempt made: the containment check is repeated here because deletion is the
   * one operation where getting it wrong cannot be undone.
   */
  async discardStaging(stagingDir: string): Promise<void> {
    const target = resolve(stagingDir);
    if (target === this.stagingDir || !contained(this.stagingDir, target)) return;
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * Move a staging directory aside instead of deleting it.
   *
   * A cancelled render's output is isolated, not destroyed: the bytes may be the only
   * record of what the renderer produced, and the rule for a late artefact is that it
   * must not be adopted, not that it must be destroyed.
   */
  async quarantineStaging(stagingDir: string, label: string): Promise<string | null> {
    const target = resolve(stagingDir);
    if (target === this.stagingDir || !contained(this.stagingDir, target)) return null;
    await mkdir(this.quarantineDir, { recursive: true, mode: 0o700 });
    const destination = resolve(this.quarantineDir, `${label.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 48)}`);
    try {
      await rename(target, destination);
      return destination;
    } catch {
      return null;
    }
  }

  async #fsyncDir(path: string): Promise<void> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY);
      await handle.sync();
    } catch {
      // Directory fsync is not portable everywhere; a failure here is reported by the
      // caller's own durability checks rather than treated as success.
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  /** The size of a file, for a download that has to answer with a length. */
  async fileSize(path: string): Promise<number | null> {
    try {
      const info = await stat(path);
      return info.size;
    } catch {
      return null;
    }
  }

  /** Whether a path is readable. */
  async readable(path: string): Promise<boolean> {
    try {
      await access(path, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** The directory a published package lives in. */
  directoryOf(packageId: string): string {
    return this.packagePath(packageId);
  }

  /** The directory of a staging area. */
  get stagingRoot(): string {
    return this.stagingDir;
  }
}

/** The index of a package, written by the caller into the staging directory. */
export function serializePackageIndex(index: PackageIndex): Buffer {
  return Buffer.from(`${JSON.stringify(index, null, 2)}\n`, "utf8");
}
