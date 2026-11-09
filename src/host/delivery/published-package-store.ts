import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { DeliveryManifest } from "../../contracts/agent-driven-types.js";
import { validateDeliveryManifest } from "./manifest.js";

/**
 * The store of published delivery packages.
 *
 * A published package is immutable and is never overwritten. The publication has two
 * parts and the order between them is the whole design:
 *
 * - **The object.** The complete package — the media, the probe, the decode, the
 *   supplements, the native source — is linked into `objects/<uuid>`, a directory this
 *   attempt creates exclusively and whose name it generates itself. Nothing is added to
 *   it afterwards and nothing is ever taken out of it.
 * - **The receipt.** A small file at `published/<package_id>` that names the object and
 *   carries the manifest and the digest of every file. It is published by a hard link,
 *   and a hard link fails when the name is taken.
 *
 * Why two parts: the receipt is the publication, and the object it names is complete
 * before the receipt exists. A reader that finds a receipt finds a whole package. A
 * reader that finds an object without a receipt finds an object nobody claimed — the
 * attempt was killed between the two steps — and that is not a delivery.
 *
 * Why a link and not a rename: a rename onto an existing name replaces it, which is
 * exactly the clobber this store must never do. A link fails with `EEXIST` instead,
 * and the loser learns that the name is taken and reads the winner's receipt.
 *
 * Nothing of anybody else's is touched: the canonical path is never removed, never
 * replaced and never quarantined, and a loser removes only the object it built itself.
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
  readonly objects_dir?: string;
  readonly staging_dir?: string;
  readonly quarantine_dir?: string;
  /**
   * Called just before the receipt is linked into place.
   *
   * The seam exists so that the race can be tested at the exact point where it
   * matters: a loser that arrives while the winner is publishing must find the
   * canonical path taken and must not touch it. A test that only starts two
   * publications at the same time does not know which of them got there first.
   */
  readonly before_publish_link?: (package_id: string) => Promise<void>;
  /**
   * How the identity of a published object is chosen.
   *
   * The identity is the store's own: a caller cannot name the directory its package
   * will live in, so two attempts cannot be pointed at the same one. The seam exists
   * so that a test can make the identity predictable; the default is a fresh UUID.
   */
  readonly object_identity?: () => string;
  /**
   * How a directory is made durable.
   *
   * The seam exists so that a failing sync can be exercised: a publication whose
   * directory cannot be made durable is not a durable publication, and the failure has
   * to reach the caller rather than be swallowed.
   */
  readonly sync_directory?: (path: string) => Promise<void>;
}

/** One file of a package. */
export interface PublishFile {
  /** The reference id the file is known by. It is unique inside the package. */
  readonly id: string;
  /** The name inside the package. It must be a plain file name. */
  readonly name: string;
  /** Where the bytes are now. It must be inside the staging directory. */
  readonly source_path: string;
}

/**
 * The receipt: what a published package is and what it contains.
 *
 * It carries the manifest, so a reader needs one file to know everything, and the
 * digest of every file, so a reader can check the package without trusting the
 * manifest alone.
 */
export interface PackageReceipt {
  readonly kind: "narralens.delivery_package_receipt@1.0";
  readonly package_id: string;
  readonly object_id: string;
  readonly delivery_id: string;
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly render_config_digest: string;
  readonly attempt: number;
  readonly download_ref: string;
  readonly published_at: string;
  readonly manifest: DeliveryManifest;
  readonly files: readonly ReceiptFile[];
}

/** One file of the package, as the receipt records it. */
export interface ReceiptFile {
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** What to publish. */
export interface PublishInput {
  readonly package_id: string;
  readonly staging_dir: string;
  readonly files: readonly PublishFile[];
  readonly manifest: DeliveryManifest;
  readonly published_at: string;
}

/** What happened. */
export type PublishOutcome =
  | {
    readonly status: "published";
    readonly package_id: string;
    readonly object_id: string;
    /** The manifest that is published — this attempt's own. */
    readonly manifest: DeliveryManifest;
    readonly receipt: PackageReceipt;
  }
  | {
    readonly status: "already_published";
    readonly package_id: string;
    readonly object_id: string;
    /** The manifest that is published — the winner's, not this attempt's. */
    readonly manifest: DeliveryManifest;
    readonly receipt: PackageReceipt;
  };

/**
 * Make a directory durable.
 *
 * The failure is not swallowed. A publication whose directory cannot be made durable is
 * not a durable publication, and saying so is better than a package that a crash can
 * empty.
 */
async function syncDirectoryOf(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (error as { code?: unknown }).code === "EEXIST";
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
  readonly objectsDir: string;
  readonly stagingDir: string;
  readonly quarantineDir: string;
  readonly #beforePublishLink: ((package_id: string) => Promise<void>) | undefined;
  readonly #syncDirectory: (path: string) => Promise<void>;
  readonly #objectIdentity: () => string;

  constructor(options: PublishedPackageStoreOptions) {
    this.root = resolve(options.root);
    this.publishedDir = resolve(options.published_dir ?? resolve(this.root, "published"));
    this.objectsDir = resolve(options.objects_dir ?? resolve(this.root, "objects"));
    this.stagingDir = resolve(options.staging_dir ?? resolve(this.root, "staging"));
    this.quarantineDir = resolve(options.quarantine_dir ?? resolve(this.root, "quarantine"));
    this.#beforePublishLink = options.before_publish_link;
    this.#syncDirectory = options.sync_directory ?? (async (path: string) => { await syncDirectoryOf(path); });
    this.#objectIdentity = options.object_identity ?? (() => `obj_${randomUUID().replace(/-/gu, "")}`);
  }

  /** Create the directories the store needs. */
  async prepare(): Promise<void> {
    await mkdir(this.publishedDir, { recursive: true, mode: 0o700 });
    await mkdir(this.objectsDir, { recursive: true, mode: 0o700 });
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
  async createStaging(label: string, identity?: string): Promise<string> {
    await mkdir(this.stagingDir, { recursive: true, mode: 0o700 });
    const cleaned = label.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 48);
    const unique = (identity ?? randomUUID()).replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 64);
    const path = resolve(this.stagingDir, `${cleaned.length === 0 ? "attempt" : cleaned}-${unique}`);
    // The directory is created exclusively: a name that is already there is somebody
    // else's, and reusing it would put this attempt's files next to theirs.
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new PublishedPackageError("STAGING_NAME_TAKEN", "the staging directory of this attempt already exists");
      }
      throw error;
    }
    return path;
  }

  /** The path of a published package's receipt. */
  receiptPath(packageId: string): string {
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

  /** The path of an object. */
  objectPath(objectId: string): string {
    const safe = objectId.replace(/[^A-Za-z0-9_-]/gu, "");
    if (safe.length === 0 || safe !== objectId) {
      throw new PublishedPackageError("OBJECT_ID_REJECTED", "the object id is not a plain name");
    }
    const path = resolve(this.objectsDir, safe);
    if (!contained(this.objectsDir, path)) {
      throw new PublishedPackageError("OBJECT_ID_REJECTED", "the object id names something outside the objects");
    }
    return path;
  }

  /**
   * Publish a package.
   *
   * The object's directory is created exclusively under a name this store generates,
   * and the complete files are linked into it. The receipt is published afterwards by a
   * hard link. The receipt is the publication: a package exists when and only when a
   * receipt names a complete object, and readers only ever go through the receipt.
   *
   * A loser — an attempt whose receipt link finds the name taken — reads the winner's
   * receipt, checks that it is the same delivery key, and reports it. It removes only
   * the object it created itself, and it never touches the canonical path.
   *
   * Once the receipt is linked, the object it names is the package: it is kept even if
   * something after the link fails, because a package that its own receipt points at
   * must still be there when the recovery looks for it.
   */
  async publish(input: PublishInput): Promise<PublishOutcome> {
    await this.prepare();

    const receiptSource = resolve(input.staging_dir, "receipt.json");
    const receiptTarget = this.receiptPath(input.package_id);
    // The object is this attempt's own. The name is generated here and never taken from
    // the caller, and the directory is created exclusively: two attempts cannot be
    // pointed at the same directory, and a directory that is already there is
    // somebody else's.
    const objectId = this.#objectIdentity();
    const objectTarget = this.objectPath(objectId);

    const receipt: PackageReceipt = {
      kind: "narralens.delivery_package_receipt@1.0",
      package_id: input.package_id,
      object_id: objectId,
      delivery_id: input.manifest.delivery_id,
      project_id: input.manifest.project_id,
      snapshot_id: input.manifest.snapshot_id,
      source_digest: input.manifest.source_digest,
      render_config_digest: input.manifest.render_config_digest,
      attempt: input.manifest.attempt,
      download_ref: input.manifest.download_ref,
      published_at: input.published_at,
      manifest: input.manifest,
      files: [],
    };

    // Whether the canonical receipt names this attempt's object. Once it does, the
    // object is the package: it is never removed, not even when something after the
    // link fails, because a published package that its receipt points at must stay
    // there for the recovery to find.
    let receiptVisible = false;
    // Whether this attempt is the one that created the object directory. Only such a
    // directory may ever be removed: a directory that was already there belongs to
    // somebody else, and this attempt has no business deleting it.
    let objectCreated = false;

    try {
      // 1. The object's own directory, created exclusively.
      try {
        await mkdir(objectTarget, { mode: 0o700 });
        objectCreated = true;
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new PublishedPackageError("OBJECT_NAME_TAKEN", "the directory of this attempt's object already exists");
        }
        throw error;
      }
      const files: ReceiptFile[] = [];
      for (const file of input.files) {
        const name = assertPlainFileName(file.name);
        if (!contained(input.staging_dir, file.source_path)) {
          throw new PublishedPackageError("STAGING_ESCAPE", `a file to publish is not inside the staging directory: ${name}`);
        }
        const destination = resolve(objectTarget, name);
        if (!contained(objectTarget, destination)) {
          throw new PublishedPackageError("STAGING_ESCAPE", `a file to publish would land outside the package: ${name}`);
        }
        await link(file.source_path, destination);
        // The bytes have to be durable before the name that points at them is durable.
        // A hard link shares the inode, so syncing the link syncs the data.
        await this.#syncFile(destination);
        const digest = await sha256File(destination);
        const info = await stat(destination);
        if (digest === null) {
          throw new PublishedPackageError("PUBLISHED_BYTES_UNREADABLE", `a file to publish could not be read: ${name}`);
        }
        files.push({ id: file.id, file: name, sha256: digest, bytes: info.size });
      }
      const complete: PackageReceipt = { ...receipt, files };
      // Staging bytes are compared against the approved manifest before a public
      // receipt exists; recomputing a new hash must never redefine approved bytes.
      validateReceipt(complete);
      await this.#verifyReceipt(complete);
      await this.#syncDir(objectTarget);
      await this.#syncDir(this.objectsDir);

      // 2. The receipt, written beside the attempt's own staging and made durable.
      await this.#writeAndSync(receiptSource, `${JSON.stringify(complete, null, 2)}\n`);

      // 3. The receipt is published. The link fails when the name is taken.
      if (this.#beforePublishLink !== undefined) await this.#beforePublishLink(input.package_id);
      try {
        await link(receiptSource, receiptTarget);
        receiptVisible = true;
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        // The name is taken. The canonical path is not ours to touch.
        const existing = await this.readReceipt(input.package_id);
        if (existing === null) {
          throw new PublishedPackageError(
            "PACKAGE_OCCUPIED",
            "the package's name is taken by something that is not a published package; it was left alone",
          );
        }
        this.#assertSameKey(existing, complete);
        await this.#verifyReceipt(existing);
        // A predecessor may have linked the receipt then failed the directory sync.
        // A retry must establish durability before it can report a usable winner.
        await this.#syncDir(this.publishedDir);
        await this.#removeOwnObject(objectTarget, objectCreated);
        return {
          status: "already_published",
          package_id: input.package_id,
          object_id: existing.object_id,
          manifest: existing.manifest,
          receipt: existing,
        };
      }
      await this.#syncDir(this.publishedDir);

      return {
        status: "published",
        package_id: input.package_id,
        object_id: objectId,
        manifest: input.manifest,
        receipt: complete,
      };
    } catch (error) {
      // An object the canonical receipt names is the package and stays. Anything else
      // this attempt built is removed — and only what this attempt built.
      if (!receiptVisible) await this.#removeOwnObject(objectTarget, objectCreated);
      throw error;
    }
  }

  /**
   * Two receipts of the same name have to describe the same delivery.
   *
   * A receipt of another project, another snapshot, another source or another
   * configuration under this name is a conflict, not a duplicate: the canonical path
   * stays as it is, and this attempt fails rather than claiming a delivery that is not
   * its own.
   */
  #assertSameKey(existing: PackageReceipt, attempted: PackageReceipt): void {
    const problems: string[] = [];
    if (existing.project_id !== attempted.project_id) problems.push("another project");
    if (existing.snapshot_id !== attempted.snapshot_id) problems.push("another snapshot");
    if (existing.source_digest !== attempted.source_digest) problems.push("another source digest");
    if (existing.render_config_digest !== attempted.render_config_digest) problems.push("another configuration");
    if (existing.delivery_id !== attempted.delivery_id) problems.push("another delivery");
    if (problems.length > 0) {
      throw new PublishedPackageError("PACKAGE_CONFLICT", `the package's name is taken by ${problems.join(", ")}`);
    }
  }

  /**
   * Remove an object this attempt built.
   *
   * Nobody else's object is ever removed: the directory has to be one this attempt
   * created, and it has to be inside the objects root.
   */
  async #removeOwnObject(path: string, createdByThisAttempt: boolean): Promise<void> {
    if (!createdByThisAttempt) return;
    if (!contained(this.objectsDir, path)) return;
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }

  /** The receipt of a published package, or null when there is none there. */
  async readReceipt(packageId: string): Promise<PackageReceipt | null> {
    let raw: string;
    try {
      raw = await readFile(this.receiptPath(packageId), "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as PackageReceipt;
      const receipt = validateReceipt(parsed);
      return receipt.package_id === packageId ? receipt : null;
    } catch {
      return null;
    }
  }

  /**
   * Check a published package against its receipt.
   *
   * Every file is hashed and compared, and the receipt's file list is checked against
   * the manifest's references: the ids have to be unique, the names have to be plain,
   * and every reference in the manifest has to name a file that is there. A package
   * that does not satisfy this is not a package this Host may serve.
   */
  async verifyPackage(packageId: string, options: { readonly except_ref_id?: string } = {}): Promise<PackageReceipt | null> {
    const receipt = await this.readReceipt(packageId);
    if (receipt === null) return null;
    return await this.#verifyReceipt(receipt, options);
  }

  async #verifyReceipt(receipt: PackageReceipt, options: { readonly except_ref_id?: string } = {}): Promise<PackageReceipt> {
    const directory = this.objectPath(receipt.object_id);

    const ids = new Set<string>();
    for (const file of receipt.files) {
      if (ids.has(file.id)) {
        throw new PublishedPackageError("RECEIPT_DUPLICATE_ID", `the receipt names ${file.id} twice`);
      }
      ids.add(file.id);
      assertPlainFileName(file.file);
      const path = resolve(directory, file.file);
      if (!contained(directory, path)) {
        throw new PublishedPackageError("RECEIPT_PATH_ESCAPE", `the receipt names a file outside the package: ${file.file}`);
      }
      // `lstat`, not `stat`: a link is not the file the receipt names, and following it
      // would read bytes from outside the package.
      const info = await lstat(path).catch(() => null);
      if (info === null || !info.isFile()) {
        throw new PublishedPackageError("RECEIPT_FILE_MISSING", `the package is missing ${file.file}`);
      }
      if (info.size !== file.bytes) {
        throw new PublishedPackageError("RECEIPT_SIZE_MISMATCH", `the package's ${file.file} is not the size its receipt records`);
      }
      // The file that is about to be served is hashed through the descriptor it is
      // served from, so that the bytes and the digest are the same bytes. Hashing it
      // here as well would only cost a second read.
      if (file.id === options.except_ref_id) continue;
      const digest = await sha256File(path);
      if (digest !== file.sha256) {
        throw new PublishedPackageError("RECEIPT_DIGEST_MISMATCH", `the package's ${file.file} does not hash to its digest`);
      }
    }

    // Every reference in the manifest has to name a file of the package.
    const referenced = [
      receipt.manifest.media_ref,
      receipt.manifest.ffprobe_ref,
      receipt.manifest.full_decode_ref,
      ...receipt.manifest.supplement_refs,
    ];
    for (const reference of referenced) {
      if (!ids.has(reference.id)) {
        throw new PublishedPackageError("RECEIPT_REF_MISSING", `the package has no file for the reference ${reference.id}`);
      }
      const entry = receipt.files.find((file) => file.id === reference.id);
      if (entry !== undefined && entry.sha256 !== reference.sha256) {
        throw new PublishedPackageError("RECEIPT_REF_DIGEST_MISMATCH", `the package's ${reference.id} does not match the manifest`);
      }
    }

    return receipt;
  }

  /** The file of a published package, by its reference id. */
  async resolvePackageFile(packageId: string, refId: string): Promise<{ path: string; entry: ReceiptFile; directory: string } | null> {
    const receipt = await this.readReceipt(packageId);
    if (receipt === null) return null;
    const entry = receipt.files.find((file) => file.id === refId);
    if (entry === undefined) return null;
    const directory = this.objectPath(receipt.object_id);
    const path = resolve(directory, entry.file);
    if (!contained(directory, path)) return null;
    return { path, entry, directory };
  }

  /** The package a download token names, if it is published and belongs to the project. */
  async resolveDownloadRef(downloadRef: string, projectId: string): Promise<{ package_id: string; receipt: PackageReceipt } | null> {
    if (typeof downloadRef !== "string" || !/^dl_[A-Za-z0-9_-]{1,60}$/u.test(downloadRef)) return null;
    const packageId = `pkg_${downloadRef.slice(3)}`;
    const receipt = await this.readReceipt(packageId);
    if (receipt === null) return null;
    if (receipt.project_id !== projectId) return null;
    if (receipt.download_ref !== downloadRef) return null;
    return { package_id: packageId, receipt };
  }

  /** Whether a package is published. */
  async isPublished(packageId: string): Promise<boolean> {
    return (await this.readReceipt(packageId)) !== null;
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

  /** Write a file and make it durable. */
  async #writeAndSync(path: string, contents: string): Promise<void> {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /** Make a file's bytes durable. */
  async #syncFile(path: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /**
   * Make a directory durable.
   *
   * The failure is not swallowed. A publication whose directory cannot be made durable
   * is not a durable publication, and saying so is better than a package that a crash
   * can empty.
   */
  async #syncDir(path: string): Promise<void> {
    await this.#syncDirectory(path);
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

  /** The directory staging areas are created in. */
  get stagingRoot(): string {
    return this.stagingDir;
  }
}

/**
 * Check a receipt's shape.
 *
 * A receipt that came from somewhere else, or that was written by an older version, is
 * not a receipt this Host may act on: the fields it must have are checked here rather
 * than trusted.
 */
export function validateReceipt(value: unknown): PackageReceipt {
  if (typeof value !== "object" || value === null) {
    throw new PublishedPackageError("RECEIPT_MALFORMED", "the receipt is not an object");
  }
  const receipt = value as Partial<PackageReceipt>;
  if (receipt.kind !== "narralens.delivery_package_receipt@1.0") {
    throw new PublishedPackageError("RECEIPT_MALFORMED", "the receipt is not a delivery receipt");
  }
  for (const field of ["package_id", "object_id", "delivery_id", "project_id", "snapshot_id", "source_digest", "render_config_digest", "download_ref", "published_at"] as const) {
    if (typeof receipt[field] !== "string" || receipt[field].length === 0) {
      throw new PublishedPackageError("RECEIPT_MALFORMED", `the receipt has no ${field}`);
    }
  }
  if (!Number.isSafeInteger(receipt.attempt) || (receipt.attempt ?? 0) < 1) {
    throw new PublishedPackageError("RECEIPT_MALFORMED", "the receipt has no attempt");
  }
  if (!Array.isArray(receipt.files)) {
    throw new PublishedPackageError("RECEIPT_MALFORMED", "the receipt has no file list");
  }
  const manifest = validateDeliveryManifest(receipt.manifest);
  for (const field of ["delivery_id", "project_id", "snapshot_id", "source_digest", "render_config_digest", "attempt", "download_ref", "published_at"] as const) {
    if (receipt[field] !== manifest[field]) {
      throw new PublishedPackageError("RECEIPT_MANIFEST_MISMATCH", `the receipt's ${field} does not match its manifest`);
    }
  }
  return { ...(receipt as PackageReceipt), manifest };
}
