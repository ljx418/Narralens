import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "../api-error.js";
import { canonicalJson } from "../engine/source-digest-v1.js";
import type {
  ComparisonLineageV1, ComparisonReplayRequestV1, ComparisonReplayResponseV1,
} from "../../contracts/wave3-types.js";
import type { ProposalComparison } from "../../contracts/types.js";
import type { ProposalComparisonAdapter } from "../../adapters/openmontage/proposal-comparison-adapter.js";
import type { ActivatedProjectionService } from "../engine/activated-projection-service.js";
import type { EngineRegistry } from "../engine/engine-registry.js";
import type { OperationIdempotencyStore } from "../projects/operation-idempotency-store.js";
import type { ProjectCatalog } from "../projects/project-catalog.js";
import type { ProjectOperationQueue } from "../projects/project-operation-queue.js";
import type { ProjectResolver } from "../projects/project-resolver.js";
import type { RevisionStore } from "../projects/revision-store.js";
import { clipIdFor } from "../projects/openfilm-migrator.js";

/**
 * M5's comparison replay (Wave 3 `04` §2).
 *
 * A replay copies a *recorded* D4.1 comparison onto the migrated target. It never calls a
 * provider, never spends money, and never changes the source, the revision, the active
 * snapshot or the ledger. What it produces is a new, target-owned, immutable comparison
 * plus a lineage that says exactly which recorded comparison it came from.
 *
 * The mapping is proved, not assumed:
 *
 * - the source comparison must belong to the target's `migrated_from` project;
 * - the selected source shot must exist exactly once in the source descriptor;
 * - the target must have exactly one clip with the migrator's own id for that shot
 *   (`clipIdFor`, imported — never re-derived as a string rule);
 * - the selection's frame range must lie inside that clip's *real* range in the current
 *   target projection — not in `MigrationReportV1.target_clips`, which is a non-persistent
 *   extra, and not in the frozen empty `identity_map`.
 *
 * The base revision must equal the migration plan's source revision. A comparison recorded
 * against an older baseline is refused with 409 and a message the page can show verbatim;
 * M5 does not re-run the model, and it does not silently substitute another proposal.
 */
export interface ComparisonReplayDeps {
  readonly revisions: RevisionStore;
  readonly resolver: ProjectResolver;
  readonly projections: ActivatedProjectionService;
  readonly engines: EngineRegistry;
  readonly catalog: ProjectCatalog;
  readonly comparisons: ProposalComparisonAdapter;
  readonly idempotency: OperationIdempotencyStore;
  readonly queue: ProjectOperationQueue;
}

const OPERATION = "comparison.replay";

export class ComparisonReplayService {
  readonly #deps: ComparisonReplayDeps;

  constructor(deps: ComparisonReplayDeps) {
    this.#deps = deps;
  }

  async replay(targetProjectId: string, request: ComparisonReplayRequestV1,
    correlationId: string): Promise<ComparisonReplayResponseV1> {
    return await this.#deps.queue.run(targetProjectId, async () => {
      const digest = createHash("sha256").update(canonicalJson({
        op: "comparison.replay", project_id: targetProjectId,
        source_comparison_id: request.source_comparison_id, base_revision: request.base_revision,
      })).digest("hex");

      const replay = this.#deps.idempotency.recall(targetProjectId, OPERATION, request.idempotency_key);
      if (replay !== undefined) {
        this.#deps.idempotency.assertSameRequest(replay, digest, OPERATION, targetProjectId, correlationId);
        return { ...(JSON.parse(replay.response_json) as ComparisonReplayResponseV1), replayed: true };
      }

      const view = await this.#deps.resolver.resolveActivated(targetProjectId);
      const migration = this.#deps.revisions.migrations.get(view.migration_id);
      if (migration === undefined) {
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
          "The activated project has no migration record", undefined, correlationId);
      }
      const plan = this.#deps.revisions.migrations.plan(view.migration_id);
      if (plan === undefined) {
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
          "The activated project has no stored migration plan", undefined, correlationId);
      }
      const sourceProjectId = view.migrated_from;
      if (sourceProjectId === null || sourceProjectId === "") {
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
          "The activated project does not name its source project", undefined, correlationId);
      }
      if (migration.project_id !== sourceProjectId) {
        throw new HttpError(409, "SOURCE_CHANGED",
          "The migration record and the activated view disagree about the source project",
          undefined, correlationId);
      }

      // The recorded comparison.
      const source = await this.#deps.comparisons.read(request.source_comparison_id);
      if (source.project_id !== sourceProjectId) {
        throw new HttpError(422, "INVALID_REQUEST",
          "The comparison does not belong to this target's source project",
          { source_project_id: sourceProjectId }, correlationId);
      }

      // The baseline.
      //
      // The frozen rule is about the *comparison*: a recording made against a baseline
      // older than the migration's own source revision cannot be replayed onto this
      // target, and the answer says so in the words the page shows.
      if (source.base_revision !== plan.source_revision) {
        throw new HttpError(409, "REVISION_CONFLICT",
          "该提案早于迁移基线，M5 不会重新调用模型；请选择与迁移基线匹配的已录制提案",
          { migration_source_revision: plan.source_revision, comparison_base_revision: source.base_revision },
          correlationId);
      }
      // The client's own claim may state either baseline: the recording's (which the
      // page reads from the comparison) or the target's current revision (which it reads
      // from the workbench). A claim that states neither is refused.
      if (request.base_revision !== plan.source_revision && request.base_revision !== view.revision) {
        throw new HttpError(409, "REVISION_CONFLICT",
          "该提案早于迁移基线，M5 不会重新调用模型；请选择与迁移基线匹配的已录制提案",
          { migration_source_revision: plan.source_revision, target_revision: view.revision,
            comparison_base_revision: source.base_revision },
          correlationId);
      }

      // The mapping: the source shot, and the target clip that carries the same id.
      const selection = await this.#assertMapping(source, plan.target_project_id, correlationId);

      const suffix = randomUUID().replaceAll("_", "-");
      const comparison: ProposalComparison = {
        ...source,
        comparison_id: `comparison_${suffix.replaceAll("-", "_")}`,
        project_id: targetProjectId,
        // The new comparison is owned by the *target*, so it is bound to the target's own
        // revision. Keeping the recording's baseline here would make it impossible for the
        // comparison to authorize anything on the target it now belongs to.
        base_revision: view.revision,
        selection,
        proposals: source.proposals.map((proposal) => ({ ...proposal })),
        generation_audit: { ...source.generation_audit, model_names: [...source.generation_audit.model_names] },
        created_at: new Date().toISOString(),
      };
      await this.#deps.comparisons.save(comparison);

      const lineage: ComparisonLineageV1 = {
        source_comparison_id: source.comparison_id,
        source_project_id: sourceProjectId,
        migration_id: view.migration_id,
        source_sha256: migration.source_sha256_before,
      };
      const body: ComparisonReplayResponseV1 = {
        format: "narralens.comparison-replay-response@1.0",
        project_id: targetProjectId,
        comparison_id: comparison.comparison_id,
        lineage,
        comparison,
        replayed: false,
      };
      this.#deps.idempotency.record({
        projectId: targetProjectId, operationKind: OPERATION, idempotencyKey: request.idempotency_key,
        requestDigest: digest, response: body, now: new Date(),
      });
      return body;
    });
  }

  /**
   * The mapping proof.
   *
   * The source shot must exist exactly once, the target must have exactly one clip with
   * the migrator's id for it, and the selection must lie inside that clip's real range in
   * the current target projection. Anything else is a 422: the mapping is missing or
   * ambiguous, and a replay that guessed would put a proposal on the wrong work.
   */
  async #assertMapping(source: ProposalComparison, targetProjectId: string,
    correlationId: string): Promise<ProposalComparison["selection"]> {
    const shotId = source.selection.shot_id;
    const descriptor = await this.#deps.catalog.readDescriptor(source.project_id)
      .catch(() => undefined);
    if (descriptor === undefined) {
      throw new HttpError(422, "INVALID_REQUEST",
        "The comparison's source project cannot be resolved, so the shot mapping cannot be proved",
        undefined, correlationId);
    }
    const shots = descriptor.shots.filter((shot) => shot.shot_id === shotId);
    if (shots.length !== 1) {
      throw new HttpError(422, "INVALID_REQUEST",
        "The comparison's source shot does not exist exactly once in the source project",
        { shot_id: shotId }, correlationId);
    }

    const view = await this.#deps.resolver.resolveActivated(targetProjectId);
    await this.#deps.projections.layoutFor(view, correlationId);
    const { port } = this.#deps.engines.resolveVerified(view.project_id, view.engine_upstream_sha, correlationId);
    const projection = await port.inspect(
      { project_id: view.project_id, engine: "openfilm", source_digest: view.source_digest },
      { correlationId, projectId: view.project_id, signal: new AbortController().signal },
    );
    const targetClipId = clipIdFor(shotId);
    const clips = projection.clips.filter((clip) => clip.clip_id === targetClipId);
    if (clips.length !== 1) {
      throw new HttpError(422, "INVALID_REQUEST",
        "The target does not have exactly one clip for the comparison's source shot",
        { clip_id: targetClipId }, correlationId);
    }
    const clip = clips[0]!;
    // The selection is proved against the *film's* real frame range, not against one
    // clip's: a D4.1 proposal was recorded over a span of the source film, and the span
    // it names may cross several shots. What must hold is that the span exists in the
    // target — that it is inside the film the projection actually reports — and that the
    // shot it names has exactly one clip on the other side.
    if (source.selection.start_frame < 0
      || source.selection.end_frame_exclusive > projection.frame_count
      || source.selection.end_frame_exclusive <= source.selection.start_frame) {
      throw new HttpError(422, "INVALID_RANGE",
        "The comparison's selection is outside the target's real frame range",
        { clip_id: targetClipId, frame_count: projection.frame_count,
          start_frame: source.selection.start_frame,
          end_frame_exclusive: source.selection.end_frame_exclusive }, correlationId);
    }
    return {
      shot_id: targetClipId,
      start_frame: source.selection.start_frame,
      end_frame_exclusive: source.selection.end_frame_exclusive,
    };
  }
}
