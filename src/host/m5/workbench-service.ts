import { HttpError } from "../api-error.js";
import type {
  PublicLockV1, WorkbenchCapabilityV1, WorkbenchClipV1, WorkbenchProjectionV1, WorkbenchTrackV1,
} from "../../contracts/wave3-types.js";
import type { EngineProjection } from "../../contracts/engine-types.js";
import { clipIdFor } from "../projects/openfilm-migrator.js";
import type { ActivatedProjectionService } from "../engine/activated-projection-service.js";
import type { EngineRegistry } from "../engine/engine-registry.js";
import type { HistoryStore } from "../history/history-store.js";
import type { LockService } from "../projects/lock-service.js";
import type { ProjectCatalog } from "../projects/project-catalog.js";
import type { ProjectResolver } from "../projects/project-resolver.js";
import type { RevisionStore } from "../projects/revision-store.js";
import type { OpenFilmStudioSupervisor } from "./openfilm-studio-supervisor.js";

/**
 * The M5 workbench read model (Wave 3 `01` §4.1, `04` §3 and §6).
 *
 * The seam is fixed and narrow: `ProjectResolver.resolveActivated(target)` →
 * `ActivatedProjectionService.layoutFor(view)` → `EnginePort.inspect()`. Three things it
 * must never do, each of which the negative matrix in `02` §3 names:
 *
 * - it must not resolve the *target* through the legacy `ProjectCatalog`. The catalog is a
 *   source-side fact only; a migrated target has no descriptor on disk.
 * - it must not read `MigrationReportV1.target_clips` (a non-persistent extra that is
 *   empty on a GET) or `MigrationPlanV1.identity_map` (a frozen empty shell).
 * - it must not let the adapter's `preview` placeholder through. The preview is replaced
 *   wholesale by the Supervisor's Gateway descriptor (`04` §6).
 *
 * Every field the browser receives is derived from a durable fact, and no path, token,
 * adapter class name or SQLite string may appear in it. A workbench projection is a
 * document the browser holds, so an absolute path in it is a directory listing of the
 * operator's machine.
 */
export interface WorkbenchServiceDeps {
  readonly resolver: ProjectResolver;
  readonly projections: ActivatedProjectionService;
  readonly engines: EngineRegistry;
  readonly revisions: RevisionStore;
  readonly locks: LockService;
  readonly history: HistoryStore;
  readonly catalog: ProjectCatalog;
  readonly supervisor: OpenFilmStudioSupervisor;
}

/** The label every local operator sees. The actor's UUID is never published (`04` §4). */
export const PUBLIC_LOCK_OWNER_LABEL = "本机操作者" as const;

export class WorkbenchService {
  readonly #deps: WorkbenchServiceDeps;

  constructor(deps: WorkbenchServiceDeps) {
    this.#deps = deps;
  }

  async workbench(projectId: string, correlationId: string, signal?: AbortSignal): Promise<WorkbenchProjectionV1> {
    const { resolver, projections, engines, revisions, locks, history, catalog, supervisor } = this.#deps;

    // 1. The target is resolved from durable facts only. A project that is not an activated
    //    migration fails here — 404 for "not there", 423 for "there but needs attention" —
    //    and the page shows a blocked state rather than falling back to the legacy editor.
    const view = await resolver.resolveActivated(projectId);

    // 2. The layout is rebuilt from the committed facts and registered with the adapter.
    const { layout } = await projections.layoutFor(view, correlationId);

    // 3. The engine is the one the binding names, at the pinned upstream.
    const { port } = engines.resolveVerified(view.project_id, view.engine_upstream_sha, correlationId);
    const projection = await port.inspect(
      { project_id: view.project_id, engine: "openfilm", source_digest: view.source_digest },
      { correlationId, projectId: view.project_id, signal: signal ?? new AbortController().signal },
    );

    // The projection is the current target's own truth. A digest that disagrees with the
    // committed one means the source moved under us, which is a conflict, not a projection
    // to publish.
    if (projection.source_digest !== view.source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED",
        "The target's current source does not match its committed digest", undefined, correlationId);
    }
    if (projection.problems.length > 0) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The target's projection is not complete", { problem_count: projection.problems.length }, correlationId);
    }

    // 4. The source side is proved against the migration row, never taken on trust.
    const sourceProjectId = view.migrated_from;
    if (sourceProjectId === null || sourceProjectId === "") {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The activated project does not name the source project it came from", undefined, correlationId);
    }
    const migration = revisions.migrations.get(view.migration_id);
    if (migration === undefined) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The activated project has no migration record", undefined, correlationId);
    }
    if (migration.project_id !== sourceProjectId) {
      throw new HttpError(409, "SOURCE_CHANGED",
        "The migration record and the activated view disagree about the source project",
        undefined, correlationId);
    }
    if (migration.target_project_id !== view.project_id) {
      throw new HttpError(409, "SOURCE_CHANGED",
        "The migration record does not claim this target project", undefined, correlationId);
    }

    // 5. The source shot ids come from the *source* descriptor, and a clip is linked to a
    //    shot only when the same id names exactly one shot and exactly one clip.
    const sourceShots = await this.#sourceShotIds(sourceProjectId, correlationId);
    const clips = this.#clips(projection, sourceShots);

    // 6. The preview is the Gateway's, not the adapter's placeholder (`04` §6).
    const preview = await supervisor.ensure(view.project_id, correlationId);

    const plan = revisions.migrations.plan(view.migration_id);
    const narration: WorkbenchProjectionV1["narration"] = plan === undefined
      ? "unknown"
      : plan.narration === null ? "absent" : "present";

    return {
      format: "narralens.workbench@1.0",
      project_id: view.project_id,
      source_project_id: sourceProjectId,
      migration_id: view.migration_id,
      revision: view.revision,
      control_revision: view.control_revision,
      source_digest: view.source_digest,
      active_snapshot_id: view.snapshot_id,
      fps: view.fps,
      frame_count: view.frame_count,
      engine: "openfilm",
      engine_upstream_sha: view.engine_upstream_sha,
      tracks: this.#tracks(projection),
      clips,
      history: history.history(view.project_id).map((entry) => ({
        revision: entry.revision,
        snapshot_id: entry.snapshot_id,
        kind: entry.kind,
        transaction_id: entry.transaction_id,
      })),
      active_locks: locks.activeLocks(view.project_id).map((lock) => this.#publicLock(lock)),
      capabilities: this.#capabilities(projection),
      preview,
      narration,
    };
  }

  /**
   * The source's shot ids, read from the source descriptor.
   *
   * The catalog is consulted for the *source* only. A source the catalog cannot resolve
   * yields no shot ids at all, and every clip then carries `source_shot_id: null` — which
   * is honest ("the link could not be proved") and not a silent guess.
   */
  async #sourceShotIds(sourceProjectId: string, correlationId: string): Promise<Map<string, string>> {
    let shots: ReadonlyArray<{ shot_id: string }>;
    try {
      const descriptor = await this.#deps.catalog.readDescriptor(sourceProjectId);
      shots = descriptor.shots;
    } catch {
      return new Map();
    }
    const byId = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const shot of shots) {
      // A duplicated shot id would make the link ambiguous, so it is dropped rather than
      // picked: the clip keeps `source_shot_id: null` and the page shows no lineage.
      if (ambiguous.has(shot.shot_id)) continue;
      if (byId.has(shot.shot_id)) { byId.delete(shot.shot_id); ambiguous.add(shot.shot_id); continue; }
      byId.set(shot.shot_id, shot.shot_id);
    }
    void correlationId;
    return byId;
  }

  #clips(projection: EngineProjection, sourceShots: Map<string, string>): WorkbenchClipV1[] {
    const counts = new Map<string, number>();
    for (const clip of projection.clips) counts.set(clip.clip_id, (counts.get(clip.clip_id) ?? 0) + 1);
    return projection.clips.map((clip) => {
      // The link is proved by the migrator's own invariant, applied to the clip's id.
      const sourceShotId = clipIdFor(clip.clip_id);
      const unique = counts.get(clip.clip_id) === 1 && sourceShots.has(sourceShotId);
      return {
        clip_id: clip.clip_id,
        track_id: clip.track_id,
        kind: clip.kind,
        start_frame: clip.frame_range.start_frame,
        end_frame_exclusive: clip.frame_range.end_frame_exclusive,
        source_shot_id: unique ? sourceShotId : null,
        source_label: unique ? sourceShots.get(sourceShotId)! : null,
      };
    });
  }

  #tracks(projection: EngineProjection): WorkbenchTrackV1[] {
    return projection.tracks.map((track) => ({
      track_id: track.track_id,
      index: track.index,
      clip_ids: [...track.clip_ids],
    }));
  }

  #capabilities(projection: EngineProjection): WorkbenchCapabilityV1[] {
    return Object.entries(projection.editable_capabilities.entries)
      .map(([entryId, entry]) => ({
        entry_id: entryId,
        // A `read_only` entry is not something the page may offer as an action, so it is
        // reported as blocked with the engine's own reason.
        state: entry.state === "supported" ? "supported" as const : "blocked" as const,
        reason: entry.reason,
      }))
      .sort((left, right) => (left.entry_id < right.entry_id ? -1 : left.entry_id > right.entry_id ? 1 : 0));
  }

  /**
   * A lock as the browser may see it.
   *
   * The owner is the fixed local label, never the actor UUID: the UUID is a credential-like
   * installation identity and the page has no use for it (`04` §4).
   */
  #publicLock(lock: {
    lock_id: string; project_id: string; lock_type: string; scope: string; target_id: string;
    start_frame: number; end_frame_exclusive: number; owner: string; reason: string;
    control_revision: number; created_at: string;
  }): PublicLockV1 {
    return {
      format: "narralens.public-lock@1.0",
      lock_id: lock.lock_id,
      project_id: lock.project_id,
      lock_type: lock.lock_type as PublicLockV1["lock_type"],
      scope: lock.scope as PublicLockV1["scope"],
      target_id: lock.scope === "project" ? null : lock.target_id,
      start_frame: lock.start_frame,
      end_frame_exclusive: lock.end_frame_exclusive,
      owner_label: PUBLIC_LOCK_OWNER_LABEL,
      reason_code: lock.reason as PublicLockV1["reason_code"],
      control_revision: lock.control_revision,
      created_at: lock.created_at,
    };
  }
}
