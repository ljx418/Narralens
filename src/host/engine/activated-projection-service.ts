import { HttpError } from "../api-error.js";
import { OPENFILM_UPSTREAM_SHA } from "./engine-binding-store.js";
import type { OpenFilmProjectLayout } from "../../adapters/openfilm/openfilm-engine-adapter.js";
import type { MigratedAssetLedger } from "../projects/migrated-asset-ledger.js";
import type { ActivatedProjectView } from "../projects/project-resolver.js";
import type { RevisionStore } from "../projects/revision-store.js";
import {
  assertLedgerStaysInsideTheProject, assertLedgerWithinRoots, assertRelativeInsideRoot,
  openFilmLayoutFacts,
} from "../projects/openfilm-layout-facts.js";
import type { OpenFilmLayoutRegistrar } from "./openfilm-composition.js";
import type { AdoptionStore } from "../adoption/adoption-store.js";

/**
 * ActivatedProjectionService (ADR-W2.0-004 §6, M4A-P01).
 *
 * The seam this closes is real and it is the reason M4A could not simply call
 * `EnginePort.inspect()`: production composition registers the OpenFilm *port* but nothing
 * ever gave it a *layout*, because `registerLayout()` is a test/probe hook. A Host that
 * restarted after a migration held no way to inspect its own activated target. Every M3 test
 * that needed a projection hand-registered one, which is why the gap was invisible.
 *
 * This rebuilds that layout from durable facts — the terminal migration, its immutable plan,
 * the target snapshot it published, the frame count it recorded and the asset ledger — and
 * nothing else. Specifically it does not:
 *
 * - accept a path, a root or a layout from a request or from a client;
 * - scan a directory to "discover" authority, which would make the file set depend on what
 *   happened to be on disk rather than on what the migration recorded;
 * - consult `MigrationPlanV1.identity_map` to recover target clips. That field is frozen
 *   empty (the plan is written before the copy exists), and the resolver already documents
 *   that depending on it makes every target unreadable. Clip identity comes from the pinned
 *   upstream parsing `film.html`; frame count comes from `target_total_frames`.
 * - cache anything as authority. The map below is a pure memo of a function of durable
 *   facts, keyed so that a moved snapshot or a moved source can never read a stale entry,
 *   and it is rebuilt from nothing after a restart.
 *
 * What it returns is Host-only: `OpenFilmProjectLayout` carries a server path and never
 * crosses into an API response. No EnginePort method is added; `inspect()` remains the only
 * way OpenFilm source is parsed.
 */

/** Terminal, non-aborted, and the only state `ProjectResolver` will resolve from. */
const ACTIVATABLE = new Set(["reported"]);

/**
 * How many layouts one Host keeps memoised.
 *
 * Only the newest key per project can be hit again, so this is a ceiling on memory, never on
 * correctness: an evicted entry is rebuilt from the database on the next call, and that is
 * exactly what happens after a restart anyway.
 */
const LAYOUT_CACHE_CEILING = 256;

export interface ActivatedProjectionDeps {
  readonly revisions: RevisionStore;
  readonly ledger: MigratedAssetLedger;
  readonly adoption?: AdoptionStore | undefined;
  /**
   * Host composition's handle on the concrete OpenFilm adapter, when one is installed.
   *
   * `layoutFor` registers what it rebuilt, because "the committed target is inspectable"
   * and "the Host knows where it lives" are the same statement here. The registration is a
   * rebuildable cache and never authority: it is keyed by commit and source digest, and
   * after a restart this map is empty and the rebuild runs again from the database.
   */
  readonly registrar?: OpenFilmLayoutRegistrar | undefined;
}

export interface ActivatedLayout {
  readonly layout: OpenFilmProjectLayout;
  /** The digest the layout is expected to reproduce; the committed one, not an observed one. */
  readonly expected_source_digest: string;
  /** Cache identity: a moved commit or source invalidates it by construction. */
  readonly cache_key: string;
}

export class ActivatedProjectionService {
  readonly #revisions: RevisionStore;
  readonly #ledger: MigratedAssetLedger;
  readonly #adoption: AdoptionStore | undefined;
  readonly #cache = new Map<string, OpenFilmProjectLayout>();
  #registrar: OpenFilmLayoutRegistrar | undefined;

  constructor(deps: ActivatedProjectionDeps) {
    this.#revisions = deps.revisions;
    this.#ledger = deps.ledger;
    this.#adoption = deps.adoption;
    this.#registrar = deps.registrar;
  }

  /**
   * Rebuild the current active layout for an already-resolved project.
   *
   * Takes the `ActivatedProjectView` rather than a project id on purpose: the view is the
   * single Host answer for "which target, at which commit, with which digest", and this
   * method cross-checks every durable fact against it instead of re-deriving one.
   */
  async layoutFor(view: ActivatedProjectView, correlationId?: string): Promise<ActivatedLayout> {
    const cacheKey = `${view.project_id}|${view.snapshot_id}|${view.source_digest}`;
    const cached = this.#cache.get(cacheKey);
    const layout = cached ?? this.#rebuild(view, correlationId);
    if (cached === undefined) {
      this.#cache.set(cacheKey, layout);
      // Bounded, because only the newest key per project can ever be hit again and a Host
      // that re-commits or re-migrates a project N times would otherwise retain N layouts
      // for the life of the process. Eviction is a cache eviction, not a correctness event:
      // the entry is rebuildable from the database, which is what makes dropping it safe.
      while (this.#cache.size > LAYOUT_CACHE_CEILING) {
        const oldest = this.#cache.keys().next();
        if (oldest.done === true) break;
        this.#cache.delete(oldest.value);
      }
    }
    // Registered on every call, not only on a rebuild: `forget()` exists, and a cache that
    // holds a layout the adapter does not is exactly the split-brain this seam removes.
    this.#registrar?.registerLayout(view.project_id, layout);
    return { layout, expected_source_digest: view.source_digest, cache_key: cacheKey };
  }

  /**
   * Called by `listen()` once OpenFilm composition has decided whether the port installed.
   *
   * The projection seam is composed in the constructor while the port is only verified
   * asynchronously at listen, so the registrar arrives later. Until it does, `layoutFor`
   * still rebuilds and still validates every durable fact — it simply has nowhere to hand
   * the result, and `inspect()` on a project with no layout fails closed as it always did.
   */
  attachRegistrar(registrar: OpenFilmLayoutRegistrar | undefined): void {
    this.#registrar = registrar;
  }

  /** Drop the memo. Never needed for correctness — that is the point — but bounded. */
  forget(projectId: string): void {
    for (const key of [...this.#cache.keys()]) {
      if (key.startsWith(`${projectId}|`)) this.#cache.delete(key);
    }
  }

  /**
   * The registrar this service hands layouts to.
   *
   * Exposed so a caller that has just *published* a source can put the matching layout in
   * front of the adapter without reaching for the concrete adapter itself. The registrar is
   * absent when the OpenFilm port is not installed, so a caller can tell "no capability"
   * from "registered".
   */
  get layoutRegistrar(): OpenFilmLayoutRegistrar | undefined { return this.#registrar; }

  /**
   * Register a layout the Host has just proven, for a project whose committed facts still
   * name the *previous* snapshot.
   *
   * M4C publishes the restored source before it commits, so for a moment the active tree
   * holds the restored closure while the committed facts still name the old one. The
   * projection seam rebuilds from the committed facts, so without this the adapter would go
   * on reading the previous closure after the publication.
   *
   * It registers and nothing else: the memo is *not* updated, because the memo is keyed by
   * the committed snapshot and this layout is not yet the committed one. When the commit
   * lands, `forget()` drops the memo and the next rebuild reads the committed facts.
   */
  useLayout(projectId: string, layout: OpenFilmProjectLayout): void {
    this.#registrar?.registerLayout(projectId, layout);
  }

  #rebuild(view: ActivatedProjectView, correlationId?: string): OpenFilmProjectLayout {
    const projectId = view.project_id;
    const adopted = this.#adoption?.projectionFact(view.snapshot_id);
    if (adopted !== undefined) {
      if (adopted.project_id !== projectId || adopted.migration_id !== view.migration_id
        || adopted.source_digest !== view.source_digest
        || adopted.engine_upstream_sha !== view.engine_upstream_sha
        || adopted.frame_count !== view.frame_count) {
        throw new HttpError(409, "SOURCE_CHANGED",
          "The active adoption projection contradicts the committed project view", undefined,
          correlationId ?? projectId);
      }
      for (const root of adopted.roots) assertRelativeInsideRoot(root, projectId, "adoption root");
      for (const subtitle of adopted.subtitles) {
        assertRelativeInsideRoot(subtitle.path, projectId, "adoption subtitle path");
      }
      const facts = { roots: adopted.roots, subtitles: adopted.subtitles };
      const bootstrap = this.#ledger.bootstrapRecord(projectId);
      if (bootstrap === undefined || bootstrap.state !== "active") {
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
          "The asset ledger for this adopted project is not active", undefined, correlationId ?? projectId);
      }
      // **Which ledger rule applies depends on how the projection fact was written.**
      //
      // An *adoption* adds every asset it installs to the closure, so the ledger's targets
      // are a subset of the roots and the strict rule holds. A *restore* puts an older
      // closure back, so the assets an earlier adoption installed are no longer referenced
      // — they are leftovers, and the gate permits them to be leftovers. The strict rule
      // would refuse every restored project, so the weaker containment rule applies there.
      const origin = this.#revisions.projectTransaction(adopted.transaction_id);
      const ledgerTargets = this.#ledger.assets(projectId).map((asset) => asset.target_path);
      if (origin?.kind === "history") {
        assertLedgerStaysInsideTheProject(facts, ledgerTargets, projectId);
      } else {
        assertLedgerWithinRoots(facts, ledgerTargets, projectId);
      }
      return { root: view.source_root.value, roots: adopted.roots, subtitles: adopted.subtitles };
    }
    const store = this.#revisions.migrations;
    const migration = store.get(view.migration_id);
    if (migration === undefined) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The activated project has no migration record to rebuild its layout from", undefined, correlationId ?? projectId);
    }
    if (!ACTIVATABLE.has(migration.state)) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The migration backing this project is not in a terminal reported state", undefined, correlationId ?? projectId);
    }
    if (migration.target_project_id !== projectId) {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "The migration record does not claim this project", undefined, correlationId ?? projectId);
    }

    const plan = store.plan(view.migration_id);
    if (plan === undefined) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The migration backing this project has no stored plan", undefined, correlationId ?? projectId);
    }
    if (plan.target_engine !== "openfilm" || plan.target_engine_upstream_sha !== OPENFILM_UPSTREAM_SHA) {
      throw new HttpError(404, "CAPABILITY_NOT_ENABLED",
        "The stored plan does not target OpenFilm at the pinned upstream", undefined, correlationId ?? projectId);
    }
    // A plan with a blocking item was never fully placed; ProjectResolver should have refused
    // it, and if it somehow did not, the layout must not be built from it either.
    if (plan.blocking.length > 0) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The migration plan records content it could not place", undefined, correlationId ?? projectId);
    }

    // The active commit must be the snapshot this migration published. Without this the
    // layout would describe an older copy while the commit claims a newer one, and the
    // digest comparison in `inspect()` would be comparing against the wrong baseline.
    if (migration.target_snapshot_id === null || migration.target_snapshot_id !== view.snapshot_id) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The active commit is not the snapshot this migration published", undefined, correlationId ?? projectId);
    }
    const target = store.targetSnapshot(view.migration_id);
    if (target.sourceDigest !== null && target.sourceDigest !== view.source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED",
        "The active commit's source digest is not the digest the migration recorded", undefined, correlationId ?? projectId);
    }
    const totalFrames = store.targetTotalFrames(view.migration_id);
    if (totalFrames === null || totalFrames !== view.frame_count) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The migration recorded no total frame count for this target", undefined, correlationId ?? projectId);
    }

    const facts = openFilmLayoutFacts(plan);
    for (const root of facts.roots) assertRelativeInsideRoot(root, projectId, "migration target_path");

    // The ledger is a durable fact about the same target, so a disagreement is a real
    // contradiction between two records rather than something to resolve by preference.
    const bootstrap = this.#ledger.bootstrapRecord(projectId);
    if (bootstrap === undefined || bootstrap.state !== "active") {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The asset ledger for this project is not active", undefined, correlationId ?? projectId);
    }
    const ledgerTargets = this.#ledger.assets(projectId).map((asset) => asset.target_path);
    assertLedgerWithinRoots(facts, ledgerTargets, projectId);

    return {
      root: view.source_root.value,
      roots: facts.roots,
      // Deliberately no `declaredAssets`: see the module note in `openfilm-layout-facts.ts`.
      // `subtitles` are the plan's declared subtitle files, which are also roots.
      subtitles: facts.subtitles,
    };
  }
}
