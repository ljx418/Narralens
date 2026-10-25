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
import { buildHistoryRestorePlan, type HistoryRestorePlanV1 } from "./history-restore-plan.js";
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
  /** The ranges the change touches, named by the *current* clip. */
  readonly affected_ranges: readonly { clip_id: string; start_frame: number; end_frame_exclusive: number }[];
}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

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

    await this.#assertTargetFilesArePresent(view, target, correlationId);

    const plan = buildHistoryRestorePlan({
      project_id: projectId,
      current: currentProjection,
      target: targetProjection,
      current_snapshot_id: view.snapshot_id,
      current_revision: view.revision,
      current_source_digest: view.source_digest,
      target_snapshot_id: target.snapshot_id,
      target_source_digest: target.source_digest,
      target_film_sha256: target.film_sha256,
      target_roots: target.roots,
      target_subtitles: target.subtitles,
      narration_target_path: narrationTargetPath,
      rights_digest: rights.rights_digest,
    }, projectId);

    const affectedRanges = plan.clips
      .filter((clip) => clip.changed && clip.kind === "visual")
      .map((clip) => {
        const current = currentProjection.clips.find((candidate) => candidate.clip_id === clip.clip_id);
        return {
          clip_id: clip.clip_id,
          start_frame: current?.frame_range.start_frame ?? clip.start_frame,
          end_frame_exclusive: current?.frame_range.end_frame_exclusive ?? clip.end_frame_exclusive,
        };
      });

    return {
      view, target, current_projection: currentProjection, target_projection: targetProjection,
      plan, rights, narration_target_path: narrationTargetPath,
      current_roots: layout.layout.roots, affected_ranges: affectedRanges,
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
   * Every non-film root of the target must already be in the active source, byte for byte.
   *
   * This is M4C's snapshot-eligibility rule ("the non-film mutable roots have the same
   * bytes as the current ones"), and it is what makes the restore a *film* restore rather
   * than a wholesale directory replacement. The staged tree is the current tree with the
   * target's film written over it, so a target root that the current tree does not carry
   * would simply be missing from the restored closure.
   *
   * The digest comparison at the end of the stage is the backstop; this is the early,
   * specific refusal.
   */
  async #assertTargetFilesArePresent(view: ActivatedProjectView, target: ResolvedHistoricalSnapshot,
    correlationId: string): Promise<void> {
    const activeRoot = resolve(view.source_root.value);
    for (const root of target.roots) {
      if (root === "film.html") continue;
      const activePath = resolve(activeRoot, root);
      if (activePath !== activeRoot && !activePath.startsWith(`${activeRoot}${sep}`)) {
        throw new HttpError(422, "UNSUPPORTED_EDIT",
          "The restore target declares a root that is not inside the project", { root },
          correlationId);
      }
      let activeBytes: Buffer;
      try { activeBytes = await readFile(activePath); }
      catch {
        throw new HttpError(422, "UNSUPPORTED_EDIT",
          "The active source no longer carries a file the restore target needs", { root },
          correlationId);
      }
      const targetBytes = await readFile(join(target.source_root, root));
      if (sha256(activeBytes) !== sha256(targetBytes)) {
        throw new HttpError(422, "UNSUPPORTED_EDIT",
          "The active source's copy of a file the restore target needs has different bytes",
          { root }, correlationId);
      }
    }
  }
}
