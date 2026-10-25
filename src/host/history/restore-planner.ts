import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { HttpError } from "../api-error.js";
import { OpenFilmEngineAdapter } from "../../adapters/openfilm/openfilm-engine-adapter.js";
import type { EngineProjection } from "../../contracts/engine-types.js";
import type { ActivatedProjectionService } from "../engine/activated-projection-service.js";
import type { EngineRegistry } from "../engine/engine-registry.js";
import type { AssetInventoryPort } from "../projects/asset-inventory-port.js";
import type { MigratedAssetLedger } from "../projects/migrated-asset-ledger.js";
import type { MigrationStore } from "../projects/migration-store.js";
import type { ActivatedProjectView, ProjectResolver } from "../projects/project-resolver.js";
import { buildHistoryRestorePlan, restoreTargetIsEligible,
  type HistoryRestorePlanV1 } from "./history-restore-plan.js";
import type { HistoricalSnapshotResolver, ResolvedHistoricalSnapshot } from "./historical-snapshot-resolver.js";
import { targetRights, type RestoreRights } from "./restore-rights.js";

/**
 * `RestorePlanner` (M4C gate §2).
 *
 * One place that answers "what would restoring this snapshot change?", used by **both** the
 * impact service and the restore service. That sharing is the point: the impact authorizes
 * a plan, and the restore re-derives the same plan and compares the two hashes. If the two
 * places could compute the plan differently, the comparison would prove nothing — it would
 * be a comparison of two implementations rather than of two moments in time.
 *
 * It reads four things and joins them:
 *
 * - the **current** projection, from the pinned upstream over the active source;
 * - the **target** projection, from the pinned upstream over the snapshot's own bytes;
 * - the **roots** each of them declares, because the digest is taken over the roots and the
 *   entry is part of the identity;
 * - the **rights** the target's referenced assets carry today.
 */

export interface RestorePlannerDeps {
  readonly resolver: ProjectResolver;
  readonly historical: HistoricalSnapshotResolver;
  readonly engines: EngineRegistry;
  readonly projections: ActivatedProjectionService;
  readonly inventory: AssetInventoryPort;
  readonly ledger: MigratedAssetLedger;
  readonly migrations: MigrationStore;
}

export interface RestorePlanContext {
  readonly view: ActivatedProjectView;
  readonly target: ResolvedHistoricalSnapshot;
  readonly current_projection: EngineProjection;
  readonly target_projection: EngineProjection;
  readonly plan: HistoryRestorePlanV1;
  readonly rights: RestoreRights;
  /** The migration's recorded narration target path, or null. */
  readonly narration_target_path: string | null;
  /** The current source's declared roots. */
  readonly current_roots: readonly string[];
  /** The content-addressed assets the restore has to install into the active source. */
  readonly missing_assets: readonly MissingAsset[];
}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/**
 * A content-addressed asset: `assets/<sha256>/source.mp4`.
 *
 * The shape is the one M4B's publisher installs, and it is the only kind of root the
 * restore may *add* to the active source (ADR D-05).
 */
const CONTENT_ADDRESSED_ASSET = /^assets\/[a-f0-9]{64}\/source\.mp4$/u;

/** An asset the restore has to install into the active source. */
export interface MissingAsset {
  readonly token: string;
  readonly sha256: string;
}

export class RestorePlanner {
  readonly #deps: RestorePlannerDeps;

  constructor(deps: RestorePlannerDeps) { this.#deps = deps; }

  /**
   * Resolve the target and everything about it that does not depend on the *current*
   * source: the target's own bytes, its projection, and the rights its assets carry today.
   *
   * It is a separate method because the recovery path needs exactly this and **not** the
   * difference: once the restored source has been published, the current source *is* the
   * target, so a plan rebuilt at that moment would be empty by construction. The recovery
   * proves the published closure and the rights; the difference was proved when the
   * authorization was computed and is recorded in the immutable fact.
   */
  async resolveTarget(projectId: string, targetSnapshotId: string, correlationId: string): Promise<{
    readonly target: ResolvedHistoricalSnapshot;
    readonly target_projection: EngineProjection;
    readonly rights: RestoreRights;
    readonly narration_target_path: string | null;
  }> {
    const view = await this.#deps.resolver.resolveActivated(projectId);
    const resolved = this.#deps.engines.resolve(projectId, correlationId);
    if (resolved.engine !== "openfilm" || !(resolved.port instanceof OpenFilmEngineAdapter)) {
      throw new HttpError(404, "CAPABILITY_NOT_ENABLED",
        "The pinned OpenFilm adapter is unavailable", undefined, correlationId);
    }
    const ctx = { correlationId, projectId, signal: AbortSignal.timeout(20_000) };
    const target = await this.#deps.historical.resolve(projectId, targetSnapshotId, correlationId);
    // The target is read by the *same* adapter and the *same* upstream as the current
    // source, over the snapshot's own bytes. A historical closure read by another parser
    // would be a second answer to "what does this film contain".
    const targetProjection = await resolved.port.inspectSnapshot({
      root: target.source_root, roots: target.roots, subtitles: target.subtitles,
    }, target.source_digest, ctx);
    const narrationTargetPath = this.#narrationTargetPath(view);
    const inventory = await this.#deps.inventory.inventory(projectId);
    const rights = targetRights({
      project_id: projectId, target_snapshot_id: target.snapshot_id, inventory,
      ledger: this.#deps.ledger.assets(projectId), target_projection: targetProjection,
      narration_target_path: narrationTargetPath,
    }, correlationId);
    return { target, target_projection: targetProjection, rights, narration_target_path: narrationTargetPath };
  }

  /**
   * Build the plan for restoring `targetSnapshotId` into `projectId`.
   *
   * The order is the order of the evidence: the project's own facts, then the target's
   * identity, then the two projections, then the eligibility rules, then the difference.
   */
  async plan(projectId: string, targetSnapshotId: string, correlationId: string): Promise<RestorePlanContext> {
    const view = await this.#deps.resolver.resolveActivated(projectId);
    const layout = await this.#deps.projections.layoutFor(view, correlationId);
    const resolved = this.#deps.engines.resolve(projectId, correlationId);
    if (resolved.engine !== "openfilm" || !(resolved.port instanceof OpenFilmEngineAdapter)) {
      throw new HttpError(404, "CAPABILITY_NOT_ENABLED",
        "The pinned OpenFilm adapter is unavailable", undefined, correlationId);
    }
    const ctx = { correlationId, projectId, signal: AbortSignal.timeout(20_000) };

    const currentProjection = await resolved.port.inspect({
      project_id: projectId, engine: "openfilm", source_digest: view.source_digest,
    }, ctx);

    const resolvedTarget = await this.resolveTarget(projectId, targetSnapshotId, correlationId);
    const { target, target_projection: targetProjection, rights } = resolvedTarget;
    const narrationTargetPath = resolvedTarget.narration_target_path;

    const missingAssets = await this.#assertTargetFilesArePresent(view, target, correlationId);

    const plan = buildHistoryRestorePlan({
      project_id: projectId,
      current: currentProjection,
      target: targetProjection,
      current_snapshot_id: view.snapshot_id,
      target_snapshot_id: target.snapshot_id,
      target_roots: target.roots,
      target_subtitles: target.subtitles,
      narration_target_path: narrationTargetPath,
      rights_digest: rights.rights_digest,
    }, projectId);

    // **The eligibility rule is separate from the lock model.**
    //
    // ADR D-04 can classify a clip added or removed, and the plan says so — it asks for the
    // project scope rather than pretending the change is local to one shot. But this stage
    // only restores a target with the same clip identity and track topology, so a target
    // that is not eligible is refused *after* the plan says what it would have taken. The
    // lock model is a property of the difference; the eligibility rule is a property of M4C.
    if (!restoreTargetIsEligible(currentProjection, targetProjection)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "the restore target does not have the same clip identity and track topology as the current source",
        { target_snapshot_id: target.snapshot_id }, correlationId);
    }

    return {
      view, target, current_projection: currentProjection, target_projection: targetProjection,
      plan, rights, narration_target_path: narrationTargetPath,
      current_roots: layout.layout.roots, missing_assets: missingAssets,
    };
  }

  /**
   * The migration's recorded narration target path.
   *
   * Decided by the stored plan rather than by a filename convention, for the same reason
   * the consumer graph decides it that way: "narration" is the word the migration recorded.
   */
  #narrationTargetPath(view: ActivatedProjectView): string | null {
    const plan = this.#deps.migrations.plan(view.migration_id);
    return plan?.narration?.target_path ?? null;
  }

  /**
   * Which of the target's roots the active source has to carry, and which it may install.
   *
   * ADR-W2.0-006 §D-05 splits the target's non-film roots in two:
   *
   * - the **external mutable roots** — the subtitles, the settings — must be byte for byte
   *   the same in the active source, because this stage does not replace them atomically
   *   with the film. A difference there is a 422, and the gate says so;
   * - the **content-addressed assets** the target references may be *missing* from the
   *   active root, and the restore installs them. That is the one asset change D-05 allows,
   *   and it is what makes the publisher's asset-install boundary reachable at all.
   *
   * The return value is the list of the assets that have to be installed, with the digest
   * each one must have.
   */
  async #assertTargetFilesArePresent(view: ActivatedProjectView, target: ResolvedHistoricalSnapshot,
    correlationId: string): Promise<MissingAsset[]> {
    const activeRoot = resolve(view.source_root.value);
    const missing: MissingAsset[] = [];
    for (const root of target.roots) {
      if (root === "film.html") continue;
      const activePath = resolve(activeRoot, root);
      if (activePath !== activeRoot && !activePath.startsWith(`${activeRoot}${sep}`)) {
        throw new HttpError(422, "UNSUPPORTED_EDIT",
          "The restore target declares a root that is not inside the project", { root },
          correlationId);
      }
      const targetBytes = await readFile(join(target.source_root, root));
      let activeBytes: Buffer | undefined;
      try { activeBytes = await readFile(activePath); } catch { activeBytes = undefined; }
      if (activeBytes === undefined) {
        // A content-addressed asset may be installed by the restore. Anything else — a
        // subtitle, a setting — is an external mutable root, and this stage refuses to
        // replace it.
        const digest = sha256(targetBytes);
        if (!CONTENT_ADDRESSED_ASSET.test(root) || !root.endsWith("/source.mp4")) {
          throw new HttpError(422, "UNSUPPORTED_EDIT",
            "The active source no longer carries a file the restore target needs", { root },
            correlationId);
        }
        missing.push({ token: root, sha256: digest });
        continue;
      }
      if (sha256(activeBytes) !== sha256(targetBytes)) {
        throw new HttpError(422, "UNSUPPORTED_EDIT",
          "The active source's copy of a file the restore target needs has different bytes",
          { root }, correlationId);
      }
    }
    return missing;
  }
}
