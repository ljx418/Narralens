import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError } from "../api-error.js";
import type { EngineKind } from "../../contracts/engine-types.js";
import {
  canonicalJson, computeSourceDigest, SOURCE_DIGEST_DOMAIN, type DeclaredAsset,
} from "../engine/source-digest-v1.js";
import type { ProjectDescriptor } from "./project-catalog.js";

/**
 * SnapshotStore (`03_M2_M4_MODULE_DESIGN.md` §2.2, AC-005, AC-D04).
 *
 * A snapshot is the immutable closure of a project's source. It is published by writing a
 * staging tree, proving durability bottom up, and only then renaming it into place. The
 * caller publishes the database pointer in a separate transaction afterwards, so a reader
 * can never resolve a `snapshot_id` whose bytes are not yet durable.
 *
 * Durability is injected so a fault can be tested at each individual step; if any step
 * cannot be proven the snapshot is not published at all and the coordinator raises
 * attention rather than guessing.
 */

export const SNAPSHOT_DOMAIN = "narralens-snapshot-v1\n";

/**
 * The declared digest roots for a project. This mirrors the Hypit adapter's own closure so
 * a snapshot and a read describe the same files; the adapter remains the owner of what a
 * Hypit project's source is.
 */
export function projectDigestRoots(descriptor: ProjectDescriptor, engine: EngineKind): string[] {
  if (engine !== "hypit") return [descriptor.run_file];
  if (typeof descriptor.asset_manifest !== "string" || descriptor.asset_manifest === "") {
    throw new HttpError(500, "INTERNAL_ERROR", "Project descriptor has no asset manifest");
  }
  return [descriptor.run_file, descriptor.narration_asset, descriptor.asset_manifest];
}

/** Proves a path's contents and directory entry are durable. Replaceable in tests. */
export type FsyncPath = (path: string) => Promise<void>;

export const fsyncPath: FsyncPath = async (path) => {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
};

export interface SnapshotSource {
  readonly projectId: string;
  readonly engine: EngineKind;
  readonly engineUpstreamSha: string;
  readonly descriptor: ProjectDescriptor;
  readonly sourceRoot: string;
  readonly declaredAssets?: readonly DeclaredAsset[];
}

export interface PublishedSnapshot {
  readonly snapshot_id: string;
  readonly project_id: string;
  readonly source_digest: string;
  readonly engine: EngineKind;
  readonly file_count: number;
  readonly asset_count: number;
}

/** Copies one closure file. Replaceable in tests so a bad copy can be exercised. */
export type CopyFileFn = (from: string, to: string) => Promise<void>;

export interface SnapshotStoreOptions {
  readonly fsync?: FsyncPath;
  readonly copy?: CopyFileFn;
  /** Root under which every project keeps its snapshots. Only place snapshots may live. */
  readonly snapshotsRoot: string;
}

/** Content-addressed identity: identical source produces an identical snapshot id. */
export function snapshotIdFor(projectId: string, sourceDigest: string): string {
  return createHash("sha256")
    .update(SNAPSHOT_DOMAIN)
    .update(canonicalJson({ project_id: projectId, source_digest: sourceDigest }))
    .digest("hex");
}

export class SnapshotStore {
  readonly #fsync: FsyncPath;
  readonly #copy: CopyFileFn;
  readonly #snapshotsRoot: string;

  constructor(options: SnapshotStoreOptions) {
    this.#fsync = options.fsync ?? fsyncPath;
    this.#copy = options.copy ?? copyFile;
    this.#snapshotsRoot = resolve(options.snapshotsRoot);
  }

  projectRoot(projectId: string): string {
    return resolve(this.#snapshotsRoot, projectId);
  }

  snapshotRoot(projectId: string, snapshotId: string): string {
    return resolve(this.projectRoot(projectId), snapshotId);
  }

  /**
   * Write, prove and publish. Steps are §4.2 verbatim: staging tree, per-file fsync,
   * bottom-up directory fsync, staging fsync, rename, parent fsync. No database write
   * happens here — the caller publishes the pointer only after this returns.
   */
  async publish(source: SnapshotSource): Promise<PublishedSnapshot> {
    const digest = await computeSourceDigest({
      root: source.sourceRoot,
      roots: projectDigestRoots(source.descriptor, source.engine),
      engine: source.engine,
      engineUpstreamSha: source.engineUpstreamSha,
      declaredAssets: source.declaredAssets,
    });

    const snapshotId = snapshotIdFor(source.projectId, digest.source_digest);
    const projectRoot = this.projectRoot(source.projectId);
    const finalRoot = this.snapshotRoot(source.projectId, snapshotId);
    if (await access(finalRoot).then(() => true, () => false)) {
      // Already published: snapshots are immutable and content addressed, so republishing
      // identical content is a no-op rather than a second write over an existing tree.
      return {
        snapshot_id: snapshotId, project_id: source.projectId, source_digest: digest.source_digest,
        engine: source.engine, file_count: digest.manifest.files.length, asset_count: digest.manifest.assets.length,
      };
    }
    const stagingRoot = resolve(projectRoot, `.staging-${randomUUID()}`);

    let renamed = false;
    try {
      await mkdir(stagingRoot, { recursive: true });
      await this.#writeClosure(source.sourceRoot, stagingRoot, digest.manifest);

      // Prove every written file, then every directory from the leaves up.
      for (const file of [...digest.manifest.files, ...digest.manifest.assets]) {
        await this.#fsync(join(stagingRoot, "source", file.path));
      }
      for (const directory of directoriesUnder(digest.manifest)) {
        await this.#fsync(join(stagingRoot, "source", directory));
      }
      await this.#fsync(join(stagingRoot, "source"));
      await this.#fsync(stagingRoot);

      // Publication: a same-directory rename, then the parent entry made durable.
      await rename(stagingRoot, finalRoot);
      renamed = true;
      await this.#fsync(projectRoot);
    } catch (error) {
      // Nothing may survive an unproven publish: a tree with no database pointer would be
      // unreachable but would still occupy disk, so the rename is undone too.
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      if (renamed) await rm(finalRoot, { recursive: true, force: true }).catch(() => undefined);
      throw new HttpError(422, "SOURCE_CHANGED",
        `SNAPSHOT_DURABILITY_UNPROVABLE: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      snapshot_id: snapshotId, project_id: source.projectId, source_digest: digest.source_digest,
      engine: source.engine, file_count: digest.manifest.files.length, asset_count: digest.manifest.assets.length,
    };
  }

  /** Undo a published snapshot when the caller's database transaction failed. */
  async rollback(projectId: string, snapshotId: string): Promise<void> {
    await rm(this.snapshotRoot(projectId, snapshotId), { recursive: true, force: true });
  }

  async exists(projectId: string, snapshotId: string): Promise<boolean> {
    return await access(this.snapshotRoot(projectId, snapshotId)).then(() => true, () => false);
  }

  /** Read one file out of a published snapshot; used by tests and by snapshot-bound reads. */
  async read(projectId: string, snapshotId: string, relativePath: string): Promise<Buffer> {
    const base = resolve(this.snapshotRoot(projectId, snapshotId), "source");
    const target = resolve(base, relativePath);
    if (target !== base && !target.startsWith(`${base}/`)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "SOURCE_PATH_ESCAPE: snapshot read escaped the snapshot");
    }
    return await readFile(target);
  }

  async #writeClosure(sourceRoot: string, stagingRoot: string, manifest: {
    files: ReadonlyArray<{ path: string; sha256: string }>;
    assets: ReadonlyArray<{ path: string; sha256: string }>;
  }): Promise<void> {
    const base = resolve(stagingRoot, "source");
    for (const entry of [...manifest.files, ...manifest.assets]) {
      const from = resolve(sourceRoot, entry.path);
      const to = resolve(base, entry.path);
      if (to !== base && !to.startsWith(`${base}/`)) {
        throw new HttpError(422, "UNSUPPORTED_EDIT", `SOURCE_PATH_ESCAPE: ${entry.path}`);
      }
      await mkdir(dirname(to), { recursive: true });
      await this.#copy(from, to);
      // Re-hash what actually landed, so a truncated or swapped copy cannot be published.
      const landed = createHash("sha256").update(await readFile(to)).digest("hex");
      if (landed !== entry.sha256) {
        throw new HttpError(422, "SOURCE_CHANGED", `SNAPSHOT_CONTENT_MISMATCH: ${entry.path}`);
      }
    }
  }
}

/** Every directory implied by the closure, deepest first. */
function directoriesUnder(manifest: { files: ReadonlyArray<{ path: string }>; assets: ReadonlyArray<{ path: string }> }): string[] {
  const directories = new Set<string>();
  for (const entry of [...manifest.files, ...manifest.assets]) {
    let current = dirname(entry.path);
    while (current !== "." && current !== "/" && current !== "") {
      directories.add(current);
      current = dirname(current);
    }
  }
  return [...directories].sort((left, right) => right.split("/").length - left.split("/").length);
}
