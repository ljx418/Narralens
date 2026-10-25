import { createHash } from "node:crypto";
import { HttpError } from "../api-error.js";
import { canonicalJson, compareUtf8 } from "../engine/source-digest-v1.js";
import type { EngineClip, EngineProjection } from "../../contracts/engine-types.js";
import type { AffectedConsumer } from "../../contracts/wave2-types.js";
import type { AffectedLock } from "../projects/lock-service.js";

/**
 * `HistoryRestorePlanV1` (M4C gate §3.3, ADR-W2.0-006).
 *
 * The plan is the *canonical difference* between the project's current source and the
 * historical snapshot it is about to restore. It is the one thing the impact authorizes and
 * the one thing the restore re-derives, and the two must agree on the *same bytes* — so the
 * plan carries a hash over its own canonical form, and the restore refuses to proceed unless
 * the hash it rebuilds is the hash the impact was computed from.
 *
 * Three properties this module has to have, and each of them was a defect somewhere else:
 *
 * 1. **It is a function of content, not of order.** Every array is sorted by an explicit,
 *    total order before it is serialized, and `canonicalJson` sorts object keys. A plan
 *    whose hash moved because the Host enumerated two clips in a different order would be
 *    indistinguishable from a plan that genuinely changed, and the restore's "the facts
 *    moved" check would fire at random.
 * 2. **It classifies, it does not count.** The plan names *which* consumers change, *which*
 *    lock classes the change touches and *which* clips carry it. A blanket "everything is
 *    affected" answer would pass every lock check that matters and fail the one that does
 *    not: a restore that touches only the narration must not be blocked by a visual lock,
 *    and a restore that touches a shot must be blocked by one.
 * 3. **It refuses what it cannot describe.** A target with a different clip identity, a
 *    different track topology, an unmodelled field or a subtitle set that does not match is
 *    a 422, not a smaller plan. Under-counting a consumer is the one error no later check
 *    can catch, because the check that would have caught it is the one being computed.
 */

/** The domain separator. A plan hash can never collide with another domain's hash. */
export const HISTORY_RESTORE_PLAN_DOMAIN = "narralens-history-restore-plan-v1\n";

export interface HistoryRestoreClipV1 {
  readonly clip_id: string;
  readonly track_id: string;
  readonly kind: "visual" | "sound";
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  readonly current_source_ref: string;
  readonly target_source_ref: string;
  readonly current_source_start_frame: number | null;
  readonly current_source_end_frame_exclusive: number | null;
  readonly target_source_start_frame: number | null;
  readonly target_source_end_frame_exclusive: number | null;
  readonly current_overrides_sha256: string | null;
  readonly target_overrides_sha256: string | null;
  /** Whether this clip's bytes or its place on the timeline differ. */
  readonly changed: boolean;
}

export interface HistoryRestoreSubtitleV1 {
  readonly subtitle_id: string;
  readonly path: string;
  readonly changed: boolean;
}

export interface HistoryRestorePlanV1 {
  readonly format: "narralens.history-restore-plan@1.0";
  readonly project_id: string;
  readonly current_snapshot_id: string;
  readonly current_revision: number;
  readonly current_source_digest: string;
  readonly target_snapshot_id: string;
  readonly target_source_digest: string;
  readonly target_film_sha256: string;
  /**
   * The root the digest treats as the entry.
   *
   * `SourceDigestV1` fixes the entry to the *first declared root*, and the declared order is
   * part of the identity: a closure whose entry is `film.html` and one whose entry is an
   * asset are different closures with different digests. The plan therefore records the
   * entry separately from the sorted root set, because the sorted set alone cannot say which
   * root was first.
   */
  readonly entry_root: string;
  /** Every declared root of the target, in lexicographic order. */
  readonly roots: readonly string[];
  /** The target's media roots, in lexicographic order. */
  readonly assets: readonly string[];
  readonly subtitles: readonly HistoryRestoreSubtitleV1[];
  readonly clips: readonly HistoryRestoreClipV1[];
  readonly consumers: readonly AffectedConsumer[];
  readonly required_locks: readonly AffectedLock[];
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
  readonly current_revision: number;
  readonly current_source_digest: string;
  readonly target_snapshot_id: string;
  readonly target_source_digest: string;
  readonly target_film_sha256: string;
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

/** start, then clip id — total, so the result is a permutation-invariant list. */
export function compareRestoreClips(left: HistoryRestoreClipV1, right: HistoryRestoreClipV1): number {
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

/** subtitle id, then path. */
export function compareRestoreSubtitles(left: HistoryRestoreSubtitleV1, right: HistoryRestoreSubtitleV1): number {
  return compareUtf8(left.subtitle_id, right.subtitle_id) || compareUtf8(left.path, right.path);
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
    roots: [...plan.roots].sort(compareUtf8),
    assets: [...plan.assets].sort(compareUtf8),
    subtitles: [...plan.subtitles].sort(compareRestoreSubtitles),
    clips: [...plan.clips].sort(compareRestoreClips),
    consumers: [...plan.consumers].sort(compareRestoreConsumers),
    required_locks: [...plan.required_locks].sort(compareRestoreLocks),
  };
}

/**
 * The exact bytes the hash is taken over. Exposed so a second implementation can check it.
 *
 * The plan's own hash is removed from the preimage **here**, not only at the call sites.
 * A hash taken over bytes that contain the hash is a hash that cannot be computed, and a
 * caller who passed a finished plan would get a different answer from a caller who passed
 * the preimage — which is exactly the kind of "two functions, two answers" this module
 * exists to prevent.
 */
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

/** The roots a digest must be taken over, reconstructed from the plan. */
export function restoreDigestRoots(plan: HistoryRestorePlanPreimage): string[] {
  return [plan.entry_root, ...plan.roots.filter((root) => root !== plan.entry_root)];
}

function rangeChanged(left: EngineClip, right: EngineClip): boolean {
  return left.frame_range.start_frame !== right.frame_range.start_frame
    || left.frame_range.end_frame_exclusive !== right.frame_range.end_frame_exclusive;
}

function sourceRangeChanged(left: EngineClip, right: EngineClip): boolean {
  const leftStart = left.source_frame_range?.start_frame ?? null;
  const leftEnd = left.source_frame_range?.end_frame_exclusive ?? null;
  const rightStart = right.source_frame_range?.start_frame ?? null;
  const rightEnd = right.source_frame_range?.end_frame_exclusive ?? null;
  return leftStart !== rightStart || leftEnd !== rightEnd;
}

function visualExtent(clips: readonly EngineClip[]): number {
  return clips.filter((clip) => clip.kind !== "sound")
    .reduce((max, clip) => Math.max(max, clip.frame_range.end_frame_exclusive), 0);
}

/**
 * Build the plan.
 *
 * The order of the checks is the order of the evidence: an incomplete projection cannot be
 * classified at all, a different clip identity is a different film, and only then is the
 * difference itself described.
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
  const entryRoot = input.target_roots[0]!;
  if (!input.target_roots.includes(entryRoot)) {
    throw fail(projectId, "the target's entry root is not among its declared roots");
  }

  const currentById = new Map(input.current.clips.map((clip) => [clip.clip_id, clip] as const));
  const targetById = new Map(input.target.clips.map((clip) => [clip.clip_id, clip] as const));
  const missing = [...currentById.keys()].filter((id) => !targetById.has(id));
  const added = [...targetById.keys()].filter((id) => !currentById.has(id));
  if (missing.length > 0 || added.length > 0) {
    throw fail(projectId,
      "the target does not have the same clip identity as the current source, which M4C does not restore",
      { missing, added });
  }
  for (const [clipId, current] of currentById) {
    const target = targetById.get(clipId)!;
    if (current.track_id !== target.track_id) {
      throw fail(projectId, "the target moves a clip to another track, which M4C does not restore",
        { clip_id: clipId, current_track: current.track_id, target_track: target.track_id });
    }
  }

  // ── the clips, and whether each one changes ────────────────────────────────────────
  const clips: HistoryRestoreClipV1[] = [];
  for (const [clipId, current] of currentById) {
    const target = targetById.get(clipId)!;
    const changed = current.source_ref !== target.source_ref
      || sourceRangeChanged(current, target)
      || rangeChanged(current, target)
      || current.overrides_digest !== target.overrides_digest;
    clips.push({
      clip_id: clipId,
      track_id: current.track_id,
      kind: current.kind === "sound" ? "sound" : "visual",
      start_frame: target.frame_range.start_frame,
      end_frame_exclusive: target.frame_range.end_frame_exclusive,
      current_source_ref: current.source_ref,
      target_source_ref: target.source_ref,
      current_source_start_frame: current.source_frame_range?.start_frame ?? null,
      current_source_end_frame_exclusive: current.source_frame_range?.end_frame_exclusive ?? null,
      target_source_start_frame: target.source_frame_range?.start_frame ?? null,
      target_source_end_frame_exclusive: target.source_frame_range?.end_frame_exclusive ?? null,
      current_overrides_sha256: current.overrides_digest,
      target_overrides_sha256: target.overrides_digest,
      changed,
    });
  }
  clips.sort(compareRestoreClips);

  // ── subtitles ───────────────────────────────────────────────────────────────────────
  const currentSubtitles = new Map(input.current.subtitles.map((subtitle) => [subtitle.subtitle_id, subtitle] as const));
  const targetSubtitles = new Map(input.target.subtitles.map((subtitle) => [subtitle.subtitle_id, subtitle] as const));
  const subtitleMissing = [...currentSubtitles.keys()].filter((id) => !targetSubtitles.has(id));
  const subtitleAdded = [...targetSubtitles.keys()].filter((id) => !currentSubtitles.has(id));
  if (subtitleMissing.length > 0 || subtitleAdded.length > 0) {
    throw fail(projectId, "the target does not carry the same subtitle set as the current source",
      { missing: subtitleMissing, added: subtitleAdded });
  }
  const subtitles: HistoryRestoreSubtitleV1[] = [];
  for (const [subtitleId, target] of targetSubtitles) {
    const current = currentSubtitles.get(subtitleId)!;
    const changed = current.content_sha256 !== target.content_sha256
      || current.source_ref !== target.source_ref;
    subtitles.push({ subtitle_id: subtitleId, path: target.source_ref, changed });
  }
  subtitles.sort(compareRestoreSubtitles);

  // ── consumers and locks ─────────────────────────────────────────────────────────────
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
  const durationChanged = currentVisualEnd !== targetVisualEnd;
  const projectEnd = Math.max(currentVisualEnd, targetVisualEnd);

  const narrationClipIds = new Set<string>();
  const changedVisualClipIds: string[] = [];
  const usersByAsset = new Map<string, string[]>();

  for (const clip of clips) {
    const current = currentById.get(clip.clip_id)!;
    const target = targetById.get(clip.clip_id)!;
    if (clip.kind === "visual") {
      addConsumer("visual", clip.clip_id, clip.changed ? "replace" : "preserve");
      if (clip.changed) {
        changedVisualClipIds.push(clip.clip_id);
        // A shot-scoped visual lock on the *current* clip: the lock a client would hold is
        // held against the clip that exists now, not against the one being restored.
        addLock({ lock_type: "visual", scope: "shot", target_id: clip.clip_id,
          start_frame: current.frame_range.start_frame,
          end_frame_exclusive: current.frame_range.end_frame_exclusive });
        if (rangeChanged(current, target)) {
          addLock({ lock_type: "duration", scope: "shot", target_id: clip.clip_id,
            start_frame: current.frame_range.start_frame,
            end_frame_exclusive: current.frame_range.end_frame_exclusive });
        }
      }
      for (const ref of [current.source_ref, target.source_ref]) {
        if (!MEDIA_EXTENSIONS.test(ref)) continue;
        usersByAsset.set(ref, [...(usersByAsset.get(ref) ?? []), clip.clip_id]);
      }
      continue;
    }
    // A sound clip is the narration when the migration's recorded narration path names it.
    // The narration is deliberately *not* in the asset ledger — it is a fact of the film's
    // own audio — so the migration's plan is the only authority for what it is.
    const isNarration = input.narration_target_path !== null
      && (current.source_ref === input.narration_target_path
        || target.source_ref === input.narration_target_path);
    if (isNarration) {
      narrationClipIds.add(clip.clip_id);
      addConsumer("narration", clip.clip_id, clip.changed ? "replace" : "preserve");
      if (clip.changed) {
        // Both scopes. A project-scoped narration lock has to be matched by a project-scoped
        // candidate, and a shot-scoped one by a shot-scoped candidate; emitting only one
        // form would let the other through.
        addLock({ lock_type: "narration", scope: "project", target_id: "",
          start_frame: 0, end_frame_exclusive: projectEnd });
        addLock({ lock_type: "narration", scope: "shot", target_id: clip.clip_id,
          start_frame: current.frame_range.start_frame,
          end_frame_exclusive: current.frame_range.end_frame_exclusive });
      }
      continue;
    }
    addConsumer("audio", clip.clip_id, clip.changed ? "replace" : "preserve");
    if (clip.changed) {
      // An audio track that is not the narration is still an audio change, and M4A's own
      // classifier puts the audio operations in the *narration* lock class: they share the
      // narration consumers. A restore that changed one and required no lock would be a
      // restore the lock model cannot see.
      addLock({ lock_type: "narration", scope: "project", target_id: "",
        start_frame: 0, end_frame_exclusive: projectEnd });
      addLock({ lock_type: "narration", scope: "shot", target_id: clip.clip_id,
        start_frame: current.frame_range.start_frame,
        end_frame_exclusive: current.frame_range.end_frame_exclusive });
    }
    for (const ref of [current.source_ref, target.source_ref]) {
      if (!MEDIA_EXTENSIONS.test(ref)) continue;
      usersByAsset.set(ref, [...(usersByAsset.get(ref) ?? []), clip.clip_id]);
    }
  }

  let subtitleChanged = false;
  for (const subtitle of subtitles) {
    addConsumer("subtitle", subtitle.subtitle_id, subtitle.changed ? "replace" : "preserve");
    if (!subtitle.changed) continue;
    subtitleChanged = true;
    addLock({ lock_type: "narration", scope: "project", target_id: "",
      start_frame: 0, end_frame_exclusive: projectEnd });
  }

  for (const [ref, users] of usersByAsset) {
    if (users.length < 2) continue;
    const changedUsers = users.filter((clipId) => clips.find((clip) => clip.clip_id === clipId)?.changed === true);
    // Shared means at least one user survives the restore, so the asset is *relinked* to the
    // surviving clips rather than replaced. With every user changing there is nothing left
    // to relink — and the asset is not preserved either, because nobody references it any
    // more. Calling that "preserve" would be a false statement about the asset, so it is
    // called "replace": the restore drops it.
    const action = changedUsers.length === 0 ? "preserve"
      : changedUsers.length < users.length ? "relink" : "replace";
    addConsumer("shared_asset", ref, action);
  }

  if (durationChanged) {
    addLock({ lock_type: "duration", scope: "project", target_id: "",
      start_frame: 0, end_frame_exclusive: projectEnd });
  }

  const requiredLocks = locks.sort(compareRestoreLocks);
  const affectedConsumers = [...consumers.values()].sort(compareRestoreConsumers);

  if (requiredLocks.length === 0) {
    // A restore that changes nothing is not a restore. Saying so here rather than letting
    // the write proceed keeps the revision scale free of no-op revisions and keeps the
    // "the impact authorized *something*" claim honest.
    const changed = clips.some((entry) => entry.changed) || subtitles.some((entry) => entry.changed);
    throw fail(projectId, changed
      ? "the difference requires no lock, which M4C's three lock classes cannot express"
      : "the target is identical to the current source, so there is nothing to restore",
    { target_snapshot_id: input.target_snapshot_id });
  }
  if (affectedConsumers.length === 0) {
    throw fail(projectId, "the difference produced no consumer at all, which means it could not be classified");
  }
  if (requiredLocks.length > 64 || affectedConsumers.length > 256) {
    throw fail(projectId, "the restore difference exceeds the contract's ceiling",
      { required_lock_count: requiredLocks.length, affected_consumer_count: affectedConsumers.length });
  }

  const assets = input.target_roots.filter((root) => MEDIA_EXTENSIONS.test(root)).sort(compareUtf8);
  const preimage: HistoryRestorePlanPreimage = {
    format: "narralens.history-restore-plan@1.0",
    project_id: input.project_id,
    current_snapshot_id: input.current_snapshot_id,
    current_revision: input.current_revision,
    current_source_digest: input.current_source_digest,
    target_snapshot_id: input.target_snapshot_id,
    target_source_digest: input.target_source_digest,
    target_film_sha256: input.target_film_sha256,
    entry_root: entryRoot,
    roots: [...input.target_roots].sort(compareUtf8),
    assets,
    subtitles,
    clips,
    consumers: affectedConsumers,
    required_locks: requiredLocks,
    rights_digest: input.rights_digest,
  };
  return { ...preimage, plan_sha256: computeHistoryRestorePlanHash(preimage) };
}
