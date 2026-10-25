import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { HttpError } from "../api-error.js";
import { OPENFILM_UPSTREAM_SHA } from "../engine/engine-binding-store.js";
import { computeSourceDigest } from "../engine/source-digest-v1.js";
import type { AdoptionStore } from "../adoption/adoption-store.js";
import type { MigratedAssetLedger } from "../projects/migrated-asset-ledger.js";
import type { RevisionStore } from "../projects/revision-store.js";
import type { SnapshotStore } from "../projects/snapshot-store.js";
import { openFilmLayoutFacts, openFilmRoots } from "../projects/openfilm-layout-facts.js";

/**
 * `HistoricalSnapshotResolver` (M4C gate §2, §3.2).
 *
 * It answers one question — *is this snapshot something this project may restore, and where
 * are its bytes* — and it answers it from durable facts only.
 *
 * What it deliberately does **not** do:
 *
 * - It never guesses the target's content from the active source. The whole point of the
 *   module is that a historical snapshot is read from *its own* immutable bytes; a resolver
 *   that read the current source and called it the old one would make every restore a
 *   no-op that merely looks like a restore.
 * - It never returns a path to a client. Everything it returns is Host-only.
 * - It never restores an orphan. A snapshot that exists on disk but that no committed
 *   transaction and no terminal migration references is refused: it is a leftover, not a
 *   history entry, and treating it as one would let an unreferenced directory become
 *   author content.
 *
 * The proof it builds has four independent parts, and each of them can fail on its own:
 * ownership, commitment, the closure's digest, and the presence of the bytes.
 */

export interface HistoricalSnapshotResolverDeps {
  readonly revisions: RevisionStore;
  readonly snapshots: SnapshotStore;
  readonly adoption: AdoptionStore;
  readonly ledger: MigratedAssetLedger;
}

export interface ResolvedHistoricalSnapshot {
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  /** The declared roots, in the order the snapshot's digest was taken over them. */
  readonly roots: readonly string[];
  /** The root the digest treats as the entry. */
  readonly entry_root: string;
  readonly subtitles: readonly { readonly subtitle_id: string; readonly path: string }[];
  /** The target's media roots, relative to the snapshot's source directory. */
  readonly assets: readonly string[];
  /** Host-only: the snapshot's immutable source directory. */
  readonly source_root: string;
  readonly film_text: string;
  readonly film_sha256: string;
}

/** Media extensions; a root with one of these is an asset root rather than a document. */
const MEDIA_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|mp4|m4v|mov|webm|mkv|avi|ogv|mp3|m4a|wav|aac|ogg|oga|opus|flac|aif|aiff|weba)$/iu;

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

export class HistoricalSnapshotResolver {
  readonly #deps: HistoricalSnapshotResolverDeps;

  constructor(deps: HistoricalSnapshotResolverDeps) { this.#deps = deps; }

  /**
   * Resolve a target snapshot for a project.
   *
   * The order is the order of the evidence: a snapshot that does not exist and one that
   * belongs to another project are the *same* answer (404), so an id cannot be probed for
   * existence across projects; everything after that is a property of the snapshot itself
   * and is reported as 422.
   */
  async resolve(projectId: string, snapshotId: string, correlationId?: string): Promise<ResolvedHistoricalSnapshot> {
    const row = this.#deps.revisions.snapshotRow(snapshotId);
    if (row === undefined || row.project_id !== projectId) {
      // Deliberately the same answer for "no such snapshot" and "not yours": the second
      // would otherwise disclose that the id exists.
      throw new HttpError(404, "NOT_FOUND", "Snapshot not found", undefined, correlationId ?? projectId);
    }
    if (row.engine !== "openfilm") {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "Only an OpenFilm snapshot can be restored by this engine", { engine: row.engine },
        correlationId ?? projectId);
    }

    const facts = this.#rootsOf(projectId, snapshotId, correlationId);

    if (!this.#deps.revisions.snapshotIsCommitted(projectId, snapshotId)) {
      // An orphan: the bytes are on disk but nothing committed ever named them.
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "The snapshot is not referenced by any committed write, so it is not a history entry",
        { snapshot_id: snapshotId }, correlationId ?? projectId);
    }

    const sourceRoot = await this.#sourceDirectory(projectId, snapshotId, correlationId);

    const observed = await computeSourceDigest({
      root: sourceRoot, roots: facts.roots, engine: "openfilm", engineUpstreamSha: OPENFILM_UPSTREAM_SHA,
    }, correlationId);
    if (observed.source_digest !== row.source_digest) {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "The snapshot's bytes do not reproduce the digest it was committed with",
        { snapshot_id: snapshotId, expected_source_digest: row.source_digest,
          observed_source_digest: observed.source_digest }, correlationId ?? projectId);
    }

    const filmPath = join(sourceRoot, "film.html");
    let film: Buffer;
    try { film = await readFile(filmPath); }
    catch {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The snapshot has no film document",
        { snapshot_id: snapshotId }, correlationId ?? projectId);
    }

    return {
      project_id: projectId,
      snapshot_id: snapshotId,
      source_digest: row.source_digest,
      roots: facts.roots,
      entry_root: facts.roots[0]!,
      subtitles: facts.subtitles,
      assets: facts.roots.filter((root) => MEDIA_EXTENSIONS.test(root)),
      source_root: sourceRoot,
      film_text: film.toString("utf8"),
      film_sha256: sha256(film),
    };
  }

  /**
   * The declared roots and subtitles of a snapshot.
   *
   * Two sources, and only two: the projection fact an adoption wrote, and the migration
   * plan a migration published from. There is no third — a snapshot whose roots cannot be
   * recovered from a durable record is refused rather than guessed at from its directory
   * listing, because a directory listing is not a closure.
   */
  #rootsOf(projectId: string, snapshotId: string, correlationId?: string): {
    roots: readonly string[]; subtitles: readonly { subtitle_id: string; path: string }[];
  } {
    const fact = this.#deps.adoption.projectionFact(snapshotId);
    if (fact !== undefined) {
      if (fact.project_id !== projectId) {
        throw new HttpError(404, "NOT_FOUND", "Snapshot not found", undefined, correlationId ?? projectId);
      }
      if (fact.roots.length === 0) {
        throw new HttpError(422, "UNSUPPORTED_EDIT", "The snapshot's projection fact declares no roots",
          { snapshot_id: snapshotId }, correlationId ?? projectId);
      }
      return { roots: [...fact.roots], subtitles: fact.subtitles.map((subtitle) => ({ ...subtitle })) };
    }
    for (const migration of this.#deps.revisions.migrations.all()) {
      if (migration.target_snapshot_id !== snapshotId) continue;
      if (migration.target_project_id !== projectId) {
        throw new HttpError(404, "NOT_FOUND", "Snapshot not found", undefined, correlationId ?? projectId);
      }
      const plan = this.#deps.revisions.migrations.plan(migration.migration_id);
      if (plan === undefined) {
        throw new HttpError(422, "UNSUPPORTED_EDIT", "The snapshot's migration has no stored plan",
          { snapshot_id: snapshotId }, correlationId ?? projectId);
      }
      const roots = openFilmRoots({
        narration: plan.narration === null ? null
          : { source_path: plan.narration.source_path, target_path: plan.narration.target_path },
        subtitles: plan.subtitles.map((subtitle) => ({ source_path: subtitle.target_path, target_path: subtitle.target_path })),
        assets: plan.assets.map((asset) => ({ source_path: asset.target_path, target_path: asset.target_path })),
      });
      return { roots, subtitles: openFilmLayoutFacts(plan).subtitles };
    }
    throw new HttpError(422, "UNSUPPORTED_EDIT",
      "The snapshot has no projection facts, so its closure cannot be reconstructed",
      { snapshot_id: snapshotId }, correlationId ?? projectId);
  }

  /**
   * The snapshot's own source directory, proven to be inside this project's snapshot root.
   *
   * The containment is proved by realpath, so a symlink planted in the snapshot root cannot
   * make the resolver read a directory somewhere else entirely.
   */
  async #sourceDirectory(projectId: string, snapshotId: string, correlationId?: string): Promise<string> {
    let projectRoot: string;
    try { projectRoot = await realpath(this.#deps.snapshots.projectRoot(projectId)); }
    catch { projectRoot = resolve(this.#deps.snapshots.projectRoot(projectId)); }
    const snapshotRoot = resolve(this.#deps.snapshots.snapshotRoot(projectId, snapshotId));
    let canonical: string;
    try { canonical = await realpath(snapshotRoot); }
    catch {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The snapshot's bytes are not on disk",
        { snapshot_id: snapshotId }, correlationId ?? projectId);
    }
    if (canonical !== projectRoot && !canonical.startsWith(`${projectRoot}${sep}`)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The snapshot's directory escapes the project's snapshot root",
        { snapshot_id: snapshotId }, correlationId ?? projectId);
    }
    const source = join(canonical, "source");
    try {
      const info = await stat(source);
      if (!info.isDirectory()) throw new Error("NOT_A_DIRECTORY");
    } catch {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The snapshot has no source directory",
        { snapshot_id: snapshotId }, correlationId ?? projectId);
    }
    return source;
  }
}
