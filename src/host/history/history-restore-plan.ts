import { createHash } from "node:crypto";
import { HttpError } from "../api-error.js";
import { canonicalJson, compareUtf8 } from "../engine/source-digest-v1.js";
import type { EngineClip, EngineProjection } from "../../contracts/engine-types.js";
import type { AffectedConsumer, HalfOpenRange } from "../../contracts/wave2-types.js";
import type { AffectedLock } from "../projects/lock-service.js";

/**
 * `HistoryRestorePlanV1` — the one authoritative contract (ADR-W2.0-006 §D-03).
 *
 * The shape below is the frozen ADR's, field for field. An earlier implementation of M4C
 * carried a different, richer shape; the independent external review of the frozen candidate
 * recorded that as MAJOR M-03, and the ADR is the contract. So the implementation regressed
 * to it rather than the other way round.
 *
 * What the ADR's shape gives up, and why that is not a loss:
 *
 * - The per-clip diff is no longer a field. It was never needed by a consumer: the affected
 *   ranges name the clips, the consumers name the kinds, and the two projection digests bind
 *   the inputs the diff was computed from. The per-clip diff is still *computed* — it is how
 *   the ranges, the consumers and the locks are derived — but it is no longer part of the
 *   hashed document, so there is nothing to keep in step with a second copy of it.
 * - The entry root is no longer a field. `SourceDigestV1` fixes the entry to the first
 *   *declared* root, so a sorted root set cannot say which root was first — but the target
 *   snapshot id is in the plan, and the target's roots come from that snapshot's immutable
 *   projection fact, so the entry is bound transitively and unambiguously.
 * - The target's asset list is no longer a field: it is derived from the target's roots,
 *   which are.
 *
 * What it gains is the thing the review said was missing: **`affected_ranges` is inside the
 * hashed plan**. The ranges a restore touches are now part of the bytes the plan hash is
 * taken over, so "the impact authorized this plan" and "this plan touches these ranges" are
 * the same statement. The impact no longer computes ranges beside the plan and compares
 * hashes that never covered them.
 */

/** The domain separator. A plan hash can never collide with another domain's hash. */
export const HISTORY_RESTORE_PLAN_DOMAIN = "narralens-history-restore-plan-v1\n";

export interface HistoryRestorePlanV1 {
  readonly format: "narralens.history-restore-plan@1.0";
  readonly project_id: string;
  readonly target_snapshot_id: string;
  readonly current_snapshot_id: string;
  readonly current_projection_sha256: string;
  readonly target_projection_sha256: string;
  readonly affected_ranges: readonly (HalfOpenRange & { clip_id: string })[];
  readonly affected_consumers: readonly AffectedConsumer[];
  readonly required_locks: readonly AffectedLock[];
  readonly target_roots: readonly string[];
  readonly target_subtitles: readonly { subtitle_id: string; path: string }[];
  readonly target_frame_count: number;
  readonly rights_digest: string;
  readonly plan_sha256: string;
}

/** The plan without its own hash: the bytes the hash is taken over. */
export type HistoryRestorePlanPreimage = Omit<HistoryRestorePlanV1, "plan_sha256">;

export interface HistoryRestorePlanInput {
  readonly project_id: string;
  readonly current: EngineProjection;
  readonly target: EngineProjection;
  readonly current_snapshot_id: string;
  readonly target_snapshot_id: string;
  /** The target's declared roots, in the order its digest was taken over them. */
  readonly target_roots: readonly string[];
  readonly target_subtitles: readonly { readonly subtitle_id: string; readonly path: string }[];
  /** The migration's recorded narration target path, or null. */
  readonly narration_target_path: string | null;
  readonly rights_digest: string;
}

/** Media extensions. A reference to one of these is an asset reference, not a scene. */
const MEDIA_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|mp4|m4v|mov|webm|mkv|avi|ogv|mp3|m4a|wav|aac|ogg|oga|opus|flac|aif|aiff|weba)$/iu;

function fail(projectId: string, message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(422, "INVALID_REQUEST", message, details, projectId);
}

/**
 * The canonical digest of a projection.
 *
 * It covers the *content* of a projection — its clips, their places and their references,
 * its subtitles and its length — and deliberately not the volatile fields around them
 * (`snapshot_id`, `project_revision`, `control_revision`, the preview descriptor and the
 * capability map). A projection's identity is what it contains, not which revision of it
 * was read.
 *
 * The form is a plain canonical JSON document, so the independent Python implementation can
 * reproduce it byte for byte from the same rules.
 */
export function projectionDigest(projection: EngineProjection): string {
  const document = {
    format: "narralens.history-restore-projection@1.0",
    frame_count: projection.frame_count,
    fps: { num: projection.fps.num, den: projection.fps.den },
    clips: [...projection.clips]
      .map((clip) => ({
        clip_id: clip.clip_id,
        track_id: clip.track_id,
        kind: clip.kind,
        start_frame: clip.frame_range.start_frame,
        end_frame_exclusive: clip.frame_range.end_frame_exclusive,
        source_ref: clip.source_ref,
        source_start_frame: clip.source_frame_range?.start_frame ?? null,
        source_end_frame_exclusive: clip.source_frame_range?.end_frame_exclusive ?? null,
        overrides_sha256: clip.overrides_digest,
      }))
      .sort((left, right) => compareUtf8(left.clip_id, right.clip_id)),
    subtitles: [...projection.subtitles]
      .map((subtitle) => ({
        subtitle_id: subtitle.subtitle_id,
        path: subtitle.source_ref,
        content_sha256: subtitle.content_sha256,
      }))
      .sort((left, right) => compareUtf8(left.subtitle_id, right.subtitle_id)),
  };
  return createHash("sha256").update("narralens-history-restore-projection-v1\n")
    .update(canonicalJson(document)).digest("hex");
}

/** start, then clip id — total, so the result is a permutation-invariant list. */
export function compareRestoreRanges(left: HalfOpenRange & { clip_id: string },
  right: HalfOpenRange & { clip_id: string }): number {
  return left.start_frame - right.start_frame || compareUtf8(left.clip_id, right.clip_id);
}

/** kind, then id, then action. The same order the impact uses, so the two agree. */
export function compareRestoreConsumers(left: AffectedConsumer, right: AffectedConsumer): number {
  return compareUtf8(left.kind, right.kind) || compareUtf8(left.id, right.id) || compareUtf8(left.action, right.action);
}

/** lock type, then scope, then target, then range. */
export function compareRestoreLocks(left: AffectedLock, right: AffectedLock): number {
  return compareUtf8(left.lock_type, right.lock_type)
    || compareUtf8(left.scope, right.scope)
    || compareUtf8(left.target_id, right.target_id)
    || left.start_frame - right.start_frame
    || left.end_frame_exclusive - right.end_frame_exclusive;
}

/**
 * The canonical order of every array that enters the hash.
 *
 * Applied here rather than trusted from the caller, so a plan that reached the store from
 * anywhere is still described by one order.
 */
export function sortHistoryRestorePlan(plan: HistoryRestorePlanPreimage): HistoryRestorePlanPreimage {
  return {
    ...plan,
    affected_ranges: [...plan.affected_ranges].sort(compareRestoreRanges),
    affected_consumers: [...plan.affected_consumers].sort(compareRestoreConsumers),
    required_locks: [...plan.required_locks].sort(compareRestoreLocks),
    target_roots: [...plan.target_roots].sort(compareUtf8),
    target_subtitles: [...plan.target_subtitles]
      .sort((left, right) => compareUtf8(left.subtitle_id, right.subtitle_id)
        || compareUtf8(left.path, right.path)),
  };
}

/** The exact bytes the hash is taken over. Exposed so a second implementation can check it. */
export function historyRestorePlanPreimage(plan: HistoryRestorePlanPreimage | HistoryRestorePlanV1): string {
  const { plan_sha256: _ignored, ...rest } = plan as HistoryRestorePlanV1;
  return `${HISTORY_RESTORE_PLAN_DOMAIN}${canonicalJson(sortHistoryRestorePlan(rest))}`;
}

export function computeHistoryRestorePlanHash(plan: HistoryRestorePlanPreimage | HistoryRestorePlanV1): string {
  return createHash("sha256").update(historyRestorePlanPreimage(plan), "utf8").digest("hex");
}

/** Recompute and compare. A plan whose bytes were edited after the fact fails here. */
export function verifyHistoryRestorePlanHash(plan: HistoryRestorePlanV1): boolean {
  const { plan_sha256, ...rest } = plan;
  return computeHistoryRestorePlanHash(rest) === plan_sha256;
}

function visualShotLock(clip: EngineClip): AffectedLock {
  return { lock_type: "visual", scope: "shot", target_id: clip.clip_id,
    start_frame: clip.frame_range.start_frame, end_frame_exclusive: clip.frame_range.end_frame_exclusive };
}

function projectLock(lockType: AffectedLock["lock_type"], endFrameExclusive: number): AffectedLock {
  return { lock_type: lockType, scope: "project", target_id: "", start_frame: 0,
    end_frame_exclusive: endFrameExclusive };
}

function visualExtent(clips: readonly EngineClip[]): number {
  return clips.filter((clip) => clip.kind !== "sound")
    .reduce((max, clip) => Math.max(max, clip.frame_range.end_frame_exclusive), 0);
}

function sourceRangeChanged(left: EngineClip, right: EngineClip): boolean {
  const leftStart = left.source_frame_range?.start_frame ?? null;
  const leftEnd = left.source_frame_range?.end_frame_exclusive ?? null;
  const rightStart = right.source_frame_range?.start_frame ?? null;
  const rightEnd = right.source_frame_range?.end_frame_exclusive ?? null;
  return leftStart !== rightStart || leftEnd !== rightEnd;
}

function frameRangeChanged(left: EngineClip, right: EngineClip): boolean {
  return left.frame_range.start_frame !== right.frame_range.start_frame
    || left.frame_range.end_frame_exclusive !== right.frame_range.end_frame_exclusive;
}

/**
 * Build the plan.
 *
 * The classification is ADR D-04's, rule by rule:
 *
 * - a clip whose **content** changed — its source, its trim or its overrides — is a
 *   *visual shot* lock on that clip;
 * - a change to the clip **topology** — a clip added or removed, a clip's boundary moved,
 *   the clips reordered, or the project's total frame count changed — is a *visual project*
 *   and a *duration project* lock, because the change is no longer local to one shot;
 * - a changed **narration or audio** clip is a *narration project* lock;
 * - a changed **subtitle** is a *narration project* lock and a subtitle consumer;
 * - a **shared asset** records every consumer of it and is locked by the clips that use it;
 * - anything that cannot be classified, or that exceeds a ceiling, is a 422.
 */
export function buildHistoryRestorePlan(input: HistoryRestorePlanInput,
  projectId: string): HistoryRestorePlanV1 {
  if (input.current.problems.length > 0 || input.target.problems.length > 0) {
    throw fail(projectId,
      "the current or the target projection is incomplete, so the difference cannot be classified",
      { current_problems: input.current.problems.slice(0, 8),
        target_problems: input.target.problems.slice(0, 8) });
  }
  if (input.target_roots.length === 0) {
    throw fail(projectId, "the target declares no roots", { target_snapshot_id: input.target_snapshot_id });
  }

  const currentById = new Map(input.current.clips.map((clip) => [clip.clip_id, clip] as const));
  const targetById = new Map(input.target.clips.map((clip) => [clip.clip_id, clip] as const));
  const clipIds = [...new Set([...currentById.keys(), ...targetById.keys()])].sort(compareUtf8);

  const consumers = new Map<string, AffectedConsumer>();
  const addConsumer = (kind: AffectedConsumer["kind"], id: string, action: AffectedConsumer["action"]): void => {
    consumers.set(`${kind} ${id} ${action}`, { kind, id, action });
  };
  const locks: AffectedLock[] = [];
  const addLock = (lock: AffectedLock): void => {
    const same = locks.some((existing) => existing.lock_type === lock.lock_type
      && existing.scope === lock.scope
      && existing.target_id === lock.target_id
      && existing.start_frame === lock.start_frame
      && existing.end_frame_exclusive === lock.end_frame_exclusive);
    if (!same) locks.push(lock);
  };

  const currentVisualEnd = visualExtent(input.current.clips);
  const targetVisualEnd = visualExtent(input.target.clips);
  // The project's own length: the larger of the two projections' frame counts and the two
  // visual extents. A project-scope lock covers the whole project, so its range has to be
  // the whole project — and a projection's frame count is its own statement of the length.
  const projectEnd = Math.max(currentVisualEnd, targetVisualEnd,
    input.current.frame_count, input.target.frame_count, 1);

  const ranges: Array<HalfOpenRange & { clip_id: string }> = [];
  const addRange = (clipId: string, range: { start_frame: number; end_frame_exclusive: number }): void => {
    ranges.push({ clip_id: clipId, start_frame: range.start_frame, end_frame_exclusive: range.end_frame_exclusive });
  };

  // ── the topology bucket ────────────────────────────────────────────────────────────
  // A clip added or removed, a clip's boundary moved, or the project's total frame count
  // changed: none of these is local to one shot, so the plan asks for the project scope.
  const added = clipIds.filter((id) => !currentById.has(id));
  const removed = clipIds.filter((id) => !targetById.has(id));
  const boundaryChanged = clipIds.filter((id) => {
    const current = currentById.get(id);
    const target = targetById.get(id);
    if (current === undefined || target === undefined) return false;
    return frameRangeChanged(current, target);
  });
  // The total frame count is the projection's own statement of the project's length. A
  // change in it is not local to one shot, so it belongs to the project scope.
  const totalFramesChanged = input.current.frame_count !== input.target.frame_count;
  const topologyChanged = added.length > 0 || removed.length > 0
    || boundaryChanged.length > 0 || totalFramesChanged;

  if (topologyChanged) {
    addLock(projectLock("visual", projectEnd));
    addLock(projectLock("duration", projectEnd));
  }

  // ── the per-clip buckets ────────────────────────────────────────────────────────────
  const assetUsers = new Map<string, string[]>();
  const sharedAssetChanged = new Set<string>();

  for (const clipId of clipIds) {
    const current = currentById.get(clipId);
    const target = targetById.get(clipId);
    if (current === undefined || target === undefined) {
      // Added or removed. The whole project's shape moved, so the project locks above cover
      // it; the range names where the content appeared or disappeared.
      const clip = current ?? target!;
      addRange(clipId, clip.frame_range);
      addConsumer("visual", clipId, "replace");
      continue;
    }
    const mediaChanged = current.source_ref !== target.source_ref
      || sourceRangeChanged(current, target)
      || current.overrides_digest !== target.overrides_digest;
    const isNarration = input.narration_target_path !== null
      && (current.source_ref === input.narration_target_path
        || target.source_ref === input.narration_target_path);
    if (isNarration) {
      addConsumer("narration", clipId, mediaChanged ? "replace" : "preserve");
      if (mediaChanged) {
        addLock(projectLock("narration", projectEnd));
        addRange(clipId, current.frame_range);
      }
      continue;
    }
    if (current.kind === "sound") {
      addConsumer("audio", clipId, mediaChanged ? "replace" : "preserve");
      if (mediaChanged) {
        addLock(projectLock("narration", projectEnd));
        addRange(clipId, current.frame_range);
      }
      for (const ref of [current.source_ref, target.source_ref]) {
        if (!MEDIA_EXTENSIONS.test(ref)) continue;
        assetUsers.set(ref, [...(assetUsers.get(ref) ?? []), clipId]);
      }
      continue;
    }
    addConsumer("visual", clipId, mediaChanged ? "replace" : "preserve");
    // Every user of every referenced asset is recorded, whether or not that user changed:
    // an asset used by two clips is *shared* precisely because the other user also depends
    // on it, and the consumer list has to name it.
    for (const ref of [current.source_ref, target.source_ref]) {
      if (!MEDIA_EXTENSIONS.test(ref)) continue;
      assetUsers.set(ref, [...(assetUsers.get(ref) ?? []), clipId]);
    }
    if (!mediaChanged) continue;
    // A content change is local to the shot: a visual *shot* lock on the current clip's
    // range — unless the clip also moved, in which case the project locks above already
    // cover the wider change.
    if (!boundaryChanged.includes(clipId)) {
      addLock(visualShotLock(current));
      addRange(clipId, current.frame_range);
    }
    if (current.source_ref !== target.source_ref) {
      sharedAssetChanged.add(current.source_ref);
      sharedAssetChanged.add(target.source_ref);
    }
  }

  // ── subtitles ───────────────────────────────────────────────────────────────────────
  const currentSubtitles = new Map(input.current.subtitles.map((subtitle) => [subtitle.subtitle_id, subtitle] as const));
  const targetSubtitles = new Map(input.target.subtitles.map((subtitle) => [subtitle.subtitle_id, subtitle] as const));
  const subtitleMissing = [...currentSubtitles.keys()].filter((id) => !targetSubtitles.has(id));
  const subtitleAdded = [...targetSubtitles.keys()].filter((id) => !currentSubtitles.has(id));
  if (subtitleMissing.length > 0 || subtitleAdded.length > 0) {
    // A subtitle set that does not correspond one to one cannot be classified into ranges,
    // so it is refused rather than approximated.
    throw fail(projectId, "the target does not carry the same subtitle set as the current source",
      { missing: subtitleMissing, added: subtitleAdded });
  }
  for (const [subtitleId, target] of targetSubtitles) {
    const current = currentSubtitles.get(subtitleId)!;
    const changed = current.content_sha256 !== target.content_sha256
      || current.source_ref !== target.source_ref;
    addConsumer("subtitle", subtitleId, changed ? "replace" : "preserve");
    if (!changed) continue;
    addLock(projectLock("narration", projectEnd));
  }

  // ── shared assets ───────────────────────────────────────────────────────────────────
  for (const [ref, users] of assetUsers) {
    if (users.length < 2) continue;
    // Shared means at least one user survives the restore, so the asset is *relinked* to the
    // surviving clips rather than replaced. With every user changing there is nothing left
    // to relink, and the asset is dropped: calling that "preserve" would be a false
    // statement about it.
    const changedUsers = users.filter((clipId) => {
      const current = currentById.get(clipId);
      const target = targetById.get(clipId);
      if (current === undefined || target === undefined) return true;
      return current.source_ref !== target.source_ref
        || sourceRangeChanged(current, target)
        || current.overrides_digest !== target.overrides_digest;
    });
    const action = changedUsers.length === 0 ? "preserve"
      : changedUsers.length < users.length ? "relink" : "replace";
    addConsumer("shared_asset", ref, action);
    // The shared asset's own impact is the impact of the clips that use it: those clips
    // already carry their own visual shot locks, and when the asset is shared with a clip
    // that did not change, that clip is affected too.
    if (!sharedAssetChanged.has(ref)) continue;
    for (const clipId of users) {
      const current = currentById.get(clipId);
      if (current === undefined) continue;
      if (!locks.some((lock) => lock.lock_type === "visual" && lock.scope === "shot"
        && lock.target_id === clipId)) {
        addLock(visualShotLock(current));
        addRange(clipId, current.frame_range);
      }
    }
  }

  const affectedConsumers = [...consumers.values()].sort(compareRestoreConsumers);
  const requiredLocks = locks.sort(compareRestoreLocks);
  const affectedRanges = ranges.sort(compareRestoreRanges);

  if (requiredLocks.length === 0) {
    // A restore that changes nothing is not a restore. Saying so here rather than letting
    // the write proceed keeps the revision scale free of no-op revisions and keeps the
    // "the impact authorized *something*" claim honest.
    throw fail(projectId,
      "the target is identical to the current source, so there is nothing to restore",
      { target_snapshot_id: input.target_snapshot_id });
  }
  if (affectedConsumers.length === 0) {
    throw fail(projectId, "the difference produced no consumer at all, which means it could not be classified");
  }
  if (requiredLocks.length > 64 || affectedConsumers.length > 256 || affectedRanges.length > 64) {
    throw fail(projectId, "the restore difference exceeds the contract's ceiling",
      { required_lock_count: requiredLocks.length, affected_consumer_count: affectedConsumers.length,
        affected_range_count: affectedRanges.length });
  }

  const preimage: HistoryRestorePlanPreimage = {
    format: "narralens.history-restore-plan@1.0",
    project_id: input.project_id,
    target_snapshot_id: input.target_snapshot_id,
    current_snapshot_id: input.current_snapshot_id,
    current_projection_sha256: projectionDigest(input.current),
    target_projection_sha256: projectionDigest(input.target),
    affected_ranges: affectedRanges,
    affected_consumers: affectedConsumers,
    required_locks: requiredLocks,
    target_roots: [...input.target_roots].sort(compareUtf8),
    target_subtitles: [...input.target_subtitles]
      .map((subtitle) => ({ subtitle_id: subtitle.subtitle_id, path: subtitle.path })),
    target_frame_count: input.target.frame_count,
    rights_digest: input.rights_digest,
  };
  return { ...preimage, plan_sha256: computeHistoryRestorePlanHash(preimage) };
}

/**
 * Whether a target is one this stage may restore.
 *
 * ADR D-04 can classify a clip added or removed, and the plan says so — but the ADR and the
 * development gate both restrict M4C to a target with the *same* clip identity and track
 * topology. So the plan may describe such a difference, and the restore must still refuse
 * it. The two statements live in different places on purpose: the lock model is a property
 * of the difference, and the eligibility rule is a property of this stage.
 */
export function restoreTargetIsEligible(current: EngineProjection, target: EngineProjection): boolean {
  if (current.clips.length !== target.clips.length) return false;
  const targetById = new Map(target.clips.map((clip) => [clip.clip_id, clip] as const));
  for (const clip of current.clips) {
    const other = targetById.get(clip.clip_id);
    if (other === undefined) return false;
    // The same track: a clip that moved to another track is a different topology, and this
    // stage does not restore that.
    if (other.track_id !== clip.track_id) return false;
  }
  return true;
}
