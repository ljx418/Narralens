import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { HttpError } from "../api-error.js";
import { absoluteServerPath } from "../engine/isolated-root.js";
import { OPENFILM_UPSTREAM_SHA } from "../engine/engine-binding-store.js";
import { FPS_30 } from "../engine/time-model.js";
import type { AbsoluteServerPath } from "../engine/engine-port.js";
import type { ProjectResponse } from "../../contracts/types.js";
import { ProjectCatalog, type ProjectDescriptor } from "./project-catalog.js";
import type { MigrationRow } from "./migration-store.js";
import type { RevisionStore } from "./revision-store.js";

/**
 * ProjectResolver (W2-G11, C-05).
 *
 * One seam answers "which project is this, and where does its source live" for every
 * Wave 2 route. Before it there were two answers: `ProjectCatalog` for the static Hypit
 * fixture, and `migratedRoots`, an in-process map that only the process which performed the
 * migration could see. C-05 rules the second one out as an authority, because a migrated
 * target is not a `ProjectCatalog` project — it has no descriptor on disk and no
 * `Manifest@2` — and pretending otherwise needs a type assertion or an in-memory map, both
 * of which the gap analysis forbids by name.
 *
 * So an activated OpenFilm project is resolved from durable facts only:
 *
 *   a terminal, non-aborted migration -> its target id, migration id and root
 *   exactly one engine binding        -> the engine and its pinned upstream
 *   exactly one active commit         -> the revision, snapshot and source digest
 *   a realpath that stays under root  -> the source tree itself
 *
 * Anything missing, ambiguous or contradictory fails closed. The resolver never guesses which
 * of two migrations won, never falls back to the catalog, and never reads a path from a
 * request.
 *
 * It resolves a *location and a set of facts*. It deliberately does not read the OpenFilm
 * film: parsing the target's source belongs to the adapter, behind the pinned upstream, and
 * duplicating a parser here would create a second answer to "what does this project contain".
 */

export interface ActivatedProjectView {
  readonly project_id: string;
  readonly kind: "activated";
  /** Host-only. Never serialized into a response body; see `publicView`. */
  readonly source_root: AbsoluteServerPath;
  readonly engine: "openfilm";
  readonly engine_upstream_sha: string;
  readonly migrated_from: string | null;
  readonly migration_id: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly control_revision: number;
  readonly frame_count: number;
  readonly fps: { readonly num: number; readonly den: number };
  /**
   * The read-only projection a client may receive. It is a *projection*, not a descriptor:
   * there is no `narralens.project.json` behind it, and nothing should try to write one.
   */
  publicView(): ActivatedProjectProjection;
}

export interface ActivatedProjectProjection {
  readonly project_id: string;
  readonly kind: "activated";
  readonly engine: "openfilm";
  readonly engine_upstream_sha: string;
  readonly migrated_from: string | null;
  readonly migration_id: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly control_revision: number;
  readonly frame_count: number;
  readonly fps: { readonly num: number; readonly den: number };
}

export interface LegacyProjectView {
  readonly kind: "legacy";
  readonly project: ProjectResponse;
  readonly descriptor: ProjectDescriptor;
  readonly source_root: AbsoluteServerPath;
}

export type ResolvedProjectView = LegacyProjectView | ActivatedProjectView;

export interface ProjectResolverDeps {
  readonly catalog: ProjectCatalog;
  readonly revisions: RevisionStore;
  /** Root under which every migrated copy lives; a target root must realpath inside it. */
  readonly migrationRoot: string;
}

const TERMINAL_RESOLVABLE: ReadonlySet<string> = new Set(["reported"]);
const NEEDS_ATTENTION: ReadonlySet<string> = new Set(["attention", "recovering"]);

export class ProjectResolver {
  readonly #catalog: ProjectCatalog;
  readonly #revisions: RevisionStore;
  readonly #migrationRoot: string;

  constructor(deps: ProjectResolverDeps) {
    this.#catalog = deps.catalog;
    this.#revisions = deps.revisions;
    this.#migrationRoot = deps.migrationRoot;
  }

  /**
   * Resolve either kind of project. A migrated target wins over a catalog entry only when
   * every fact is present; a target that is known but not yet activatable is an error, never
   * a silent fall through to the legacy catalog.
   */
  async resolve(projectId: string): Promise<ResolvedProjectView> {
    const migrations = this.#migrationsFor(projectId);
    if (migrations.length > 0) return await this.resolveActivated(projectId);
    return await this.resolveLegacy(projectId);
  }

  async resolveLegacy(projectId: string): Promise<LegacyProjectView> {
    const descriptor = await this.#catalog.readDescriptor(projectId);
    return {
      kind: "legacy", project: await this.#catalog.read(projectId), descriptor,
      source_root: absoluteServerPath(this.#catalog.descriptorRoot(projectId)),
    };
  }

  /**
   * ACT-01 and ACT-02.
   *
   * The order of the checks below is the order of the evidence: a migration that never
   * finished is the most common reason and the least alarming, and a project nobody ever
   * migrated must not be distinguishable from one that did, so the unknown case is decided
   * first and reported as `NOT_FOUND`.
   */
  async resolveActivated(projectId: string): Promise<ActivatedProjectView> {
    const candidates = this.#migrationsFor(projectId);
    if (candidates.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "Project not found");
    }

    const usable = candidates.filter((row) => TERMINAL_RESOLVABLE.has(row.state));
    if (usable.length === 0) {
      const needsAttention = candidates.some((row) => NEEDS_ATTENTION.has(row.state));
      if (needsAttention) {
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
          "Migrated project is not resolvable while its migration needs attention", undefined, projectId);
      }
      // Every candidate is still moving (or aborted). The capability is not open yet, and
      // saying so with a stage-gate code keeps it distinguishable from "no such project".
      throw new HttpError(404, "CAPABILITY_NOT_ENABLED",
        "Migrated project has not reached an activatable state", undefined, projectId);
    }
    if (usable.length > 1) {
      // Two terminal migrations claiming one target id means the activation authority is
      // ambiguous. Choosing one would be a guess about which copy is the project's content.
      throw new HttpError(404, "CAPABILITY_NOT_ENABLED",
        "More than one terminal migration claims this target project", undefined, projectId);
    }

    const migration = usable[0]!;
    const binding = this.#revisions.readEngineBinding(projectId);
    if (binding === undefined || binding.engine !== "openfilm"
      || binding.engine_upstream_sha !== OPENFILM_UPSTREAM_SHA) {
      throw new HttpError(404, "CAPABILITY_NOT_ENABLED",
        "Migrated project has no OpenFilm binding at the pinned upstream", undefined, projectId);
    }

    const commit = this.#revisions.activeCommit(projectId);
    if (commit === undefined || commit.engine !== "openfilm") {
      throw new HttpError(404, "CAPABILITY_NOT_ENABLED",
        "Migrated project has no active commit", undefined, projectId);
    }

    const sourceRoot = await this.#resolveSourceRoot(migration, projectId);
    return this.#view(projectId, migration, binding, commit, sourceRoot);
  }

  #migrationsFor(projectId: string): MigrationRow[] {
    return this.#revisions.migrations.all().filter((row) => row.target_project_id === projectId);
  }

  /**
   * The root is derived from the migration id, never stored beside it, and then checked
   * against the migration root by realpath. Deriving is what makes a restart work; checking
   * is what makes a symlinked or substituted root impossible to activate silently.
   */
  async #resolveSourceRoot(migration: MigrationRow, projectId: string): Promise<AbsoluteServerPath> {
    const expected = resolve(this.#migrationRoot, migration.migration_id);
    let root: string;
    let migrationRoot: string;
    try {
      root = await realpath(expected);
      migrationRoot = await realpath(this.#migrationRoot);
    } catch {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "Migrated project root is missing from disk", undefined, projectId);
    }
    if (root !== migrationRoot && !root.startsWith(`${migrationRoot}${sep}`)) {
      throw new HttpError(403, "ORIGIN_REJECTED",
        "Migrated project root escapes the migration root", undefined, projectId);
    }
    return absoluteServerPath(root);
  }

  #view(
    projectId: string,
    migration: MigrationRow,
    binding: { engine: string; engine_upstream_sha: string; migrated_from: string | null },
    commit: { revision: number; snapshot_id: string; source_digest: string },
    sourceRoot: AbsoluteServerPath,
  ): ActivatedProjectView {
    const plan = this.#revisions.migrations.plan(migration.migration_id);
    // The migrated film's length is the end of the identity map the migration itself wrote.
    // It is read from the migration, not re-derived from the OpenFilm source, because this
    // resolver does not parse engine documents.
    const frameCount = (plan?.identity_map ?? []).reduce((max, entry) => Math.max(max, entry.end_frame_exclusive), 0);
    if (frameCount <= 0) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "Migration recorded no placed content", undefined, projectId);
    }
    const view = {
      project_id: projectId, kind: "activated" as const, source_root: sourceRoot,
      engine: "openfilm" as const, engine_upstream_sha: binding.engine_upstream_sha,
      migrated_from: binding.migrated_from, migration_id: migration.migration_id,
      revision: commit.revision, snapshot_id: commit.snapshot_id, source_digest: commit.source_digest,
      control_revision: this.#revisions.controlRevision(projectId, commit.revision),
      frame_count: frameCount, fps: { num: FPS_30.num, den: FPS_30.den },
    };
    return { ...view, publicView: () => projectionOf(view) };
  }
}

function projectionOf(view: Omit<ActivatedProjectView, "publicView" | "source_root">): ActivatedProjectProjection {
  const { project_id, kind, engine, engine_upstream_sha, migrated_from, migration_id,
    revision, snapshot_id, source_digest, control_revision, frame_count, fps } = view;
  return { project_id, kind, engine, engine_upstream_sha, migrated_from, migration_id,
    revision, snapshot_id, source_digest, control_revision, frame_count, fps };
}
