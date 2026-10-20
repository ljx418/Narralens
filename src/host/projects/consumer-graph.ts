import { HttpError } from "../api-error.js";
import { compareUtf8 } from "../engine/source-digest-v1.js";
import { OPENFILM_PROJECTION_PROBLEM_PREFIX } from "../../adapters/openfilm/openfilm-engine-adapter.js";
import { computeAffectedLocks, type AffectedLock } from "./lock-service.js";
import type { MigratedAssetRecord } from "./migrated-asset-ledger.js";
import type { EngineClip, EngineProjection } from "../../contracts/engine-types.js";
import type { AffectedConsumer, NativePlanV1 } from "../../contracts/wave2-types.js";
import { compareConsumers, compareRanges, type AffectedRange } from "../impact/impact-canonical.js";

/**
 * ConsumerGraph (ADR-W2.0-004 §3).
 *
 * A pure function from committed facts to "what would this write affect". It stores no
 * timeline of its own, keeps no clip order and is never written to: it is derived on every
 * request from the projection the Host has just re-read, so it cannot become a second
 * authority that disagrees with the film.
 *
 * The three decisions that actually matter:
 *
 * 1. **Ranges name current clips.** A plan clip is `clip-<segment>`: an id that does not
 *    exist yet, attached to nothing. Emitting it in `affected_ranges` would let a write
 *    clear a lock that is keyed to the real `shot-002`, because the lock matcher compares
 *    target ids and would simply not match. So every range is intersected against the
 *    *current* visual clip it lands on and carries that clip's id.
 * 2. **Unknown means unknown.** A projection that could not be mapped completely, a clip
 *    kind this graph cannot classify, an asset reference that resolves to nothing or to two
 *    things, a transition the projection cannot express — all of these throw rather than
 *    produce a smaller graph. Under-counting a consumer is the one error a lock cannot
 *    catch later, because the lock that would have caught it is the one being computed.
 * 3. **Locks follow real change.** Only a visual replace is a change to a visual lock.
 *    Narration and audio are preserved, so they are recorded as preserved consumers and do
 *    not block; a client asking to "preserve" something never unlocks anything, and the
 *    Host never blocks on a lock it has shown does not apply.
 */

export interface ConsumerGraphInput {
  readonly projection: EngineProjection;
  readonly plan: NativePlanV1;
  /** Ledger rows for this project; the only place an asset path becomes an asset id. */
  readonly ledgerAssets: readonly MigratedAssetRecord[];
  /** The plan's narration target path, or null. Decides narration from audio durably. */
  readonly narrationTargetPath: string | null;
  /** Host authority for the project's length; never the plan's or the projection's number. */
  readonly frameCount: number;
}

export interface ConsumerGraphResult {
  readonly affected_ranges: readonly AffectedRange[];
  readonly affected_consumers: readonly AffectedConsumer[];
  readonly affected_locks: readonly AffectedLock[];
}

/** Clips that occupy the picture. A `sound` clip does not, and is classified separately. */
const VISUAL_KINDS: ReadonlySet<string> = new Set(["page", "video", "still"]);
const MEDIA_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|mp4|m4v|mov|webm|mkv|avi|ogv|mp3|m4a|wav|aac|ogg|oga|opus|flac|aif|aiff|weba)$/iu;

function fail(projectId: string, message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(422, "INVALID_REQUEST", message, details, projectId);
}

function overlaps(left: { start_frame: number; end_frame_exclusive: number },
  right: { start_frame: number; end_frame_exclusive: number }): boolean {
  return left.start_frame < right.end_frame_exclusive && right.start_frame < left.end_frame_exclusive;
}

/** Merge half-open ranges that touch, then re-split so no result is empty. */
function mergeTouching(ranges: Array<{ start_frame: number; end_frame_exclusive: number }>):
  Array<{ start_frame: number; end_frame_exclusive: number }> {
  const sorted = [...ranges].sort((left, right) => left.start_frame - right.start_frame || left.end_frame_exclusive - right.end_frame_exclusive);
  const merged: Array<{ start_frame: number; end_frame_exclusive: number }> = [];
  for (const range of sorted) {
    if (range.end_frame_exclusive <= range.start_frame) continue;
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start_frame <= last.end_frame_exclusive) {
      merged[merged.length - 1] = {
        start_frame: last.start_frame,
        end_frame_exclusive: Math.max(last.end_frame_exclusive, range.end_frame_exclusive),
      };
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/**
 * Validate the plan is the contiguous, unique coverage its `duration_policy` promises.
 *
 * A plan with a gap, an overlap or a range past the project's own length cannot be
 * intersected against anything meaningful, so it is refused before it is used rather than
 * after a partial answer has been built from it.
 */
function validatePlanCoverage(plan: NativePlanV1, frameCount: number, projectId: string): void {
  if (plan.engine !== "openfilm") throw fail(projectId, "the native plan targets a different engine");
  if (plan.clips.length === 0) throw fail(projectId, "the native plan contains no clips");
  if (!Number.isSafeInteger(plan.total_frames) || plan.total_frames <= 0) {
    throw fail(projectId, "the native plan records no total frame count");
  }
  if (plan.total_frames > frameCount) {
    throw fail(projectId, "the native plan is longer than the project",
      { plan_total_frames: plan.total_frames, project_frame_count: frameCount });
  }
  const ordered = [...plan.clips].sort((left, right) => left.timeline.start_frame - right.timeline.start_frame);
  let cursor = 0;
  for (const clip of ordered) {
    const { start_frame, end_frame_exclusive } = clip.timeline;
    if (end_frame_exclusive <= start_frame) throw fail(projectId, `plan clip ${clip.clip_id} has an empty range`);
    if (start_frame !== cursor) {
      throw fail(projectId, "the native plan is not a contiguous cover of its own timeline",
        { expected_start: cursor, found_start: start_frame, clip_id: clip.clip_id });
    }
    cursor = end_frame_exclusive;
  }
  if (cursor !== plan.total_frames) {
    throw fail(projectId, "the native plan's coverage does not reach its own total",
      { covered: cursor, total: plan.total_frames });
  }
}

/**
 * Resolve every current clip's `source_ref` to a ledger asset, or prove it is not one.
 *
 * A media reference that matches no ledger row is a dangling reference and a media
 * reference that matches two is ambiguous. Both are refusals: guessing which asset a write
 * would relink is exactly the kind of silent under-count this graph exists to prevent.
 * Non-media references (the scene pages) are covered by the source-digest closure and are
 * not asset references at all.
 */
function resolveLedgerByPath(assets: readonly MigratedAssetRecord[], projectId: string): Map<string, MigratedAssetRecord> {
  const byPath = new Map<string, MigratedAssetRecord>();
  for (const asset of assets) {
    if (byPath.has(asset.target_path)) {
      throw fail(projectId, "the asset ledger names the same target path twice",
        { target_path: asset.target_path });
    }
    byPath.set(asset.target_path, asset);
  }
  return byPath;
}

export function buildConsumerGraph(input: ConsumerGraphInput, projectId: string): ConsumerGraphResult {
  const { projection, plan, frameCount } = input;

  // ── completeness: nothing may have been dropped before this point ─────────────────────
  if (projection.problems.length > 0) {
    // Two different failures share this list, and both are refusals. Reporting which one
    // it is matters for the operator: a completeness problem means the adapter could not
    // map the film, while any other problem means the engine read something wrong.
    const completeness = projection.problems.filter((problem) =>
      problem.startsWith(OPENFILM_PROJECTION_PROBLEM_PREFIX));
    throw fail(projectId, "the OpenFilm projection is not complete, so its consumers cannot be classified",
      completeness.length > 0
        ? { problem_count: projection.problems.length, projection_problems: completeness.slice(0, 8) }
        : { problem_count: projection.problems.length, problems: projection.problems.slice(0, 8) });
  }

  validatePlanCoverage(plan, frameCount, projectId);

  const ledgerByPath = resolveLedgerByPath(input.ledgerAssets, projectId);
  const ledgerAssetIds = new Set(input.ledgerAssets.map((asset) => asset.asset_id));

  // Every plan clip must name an asset this project actually owns.
  for (const clip of plan.clips) {
    if (!ledgerAssetIds.has(clip.asset_id)) {
      throw fail(projectId, "the native plan binds an asset this project does not own",
        { clip_id: clip.clip_id, asset_id: clip.asset_id });
    }
  }

  const visual = projection.clips.filter((clip) => VISUAL_KINDS.has(clip.kind));
  if (visual.length === 0) throw fail(projectId, "the projection has no visual clips to intersect");
  for (const clip of projection.clips) {
    if (!VISUAL_KINDS.has(clip.kind) && clip.kind !== "sound") {
      throw fail(projectId, "the projection contains a clip kind this graph cannot classify",
        { clip_id: clip.clip_id, kind: clip.kind });
    }
  }

  // ── ranges: plan coverage ∩ current visual clips, named by the CURRENT clip ──────────
  const perClip = new Map<string, Array<{ start_frame: number; end_frame_exclusive: number }>>();
  for (const current of visual) {
    const hits: Array<{ start_frame: number; end_frame_exclusive: number }> = [];
    for (const planned of plan.clips) {
      if (!overlaps(current.frame_range, planned.timeline)) continue;
      const start_frame = Math.max(current.frame_range.start_frame, planned.timeline.start_frame);
      const end_frame_exclusive = Math.min(current.frame_range.end_frame_exclusive, planned.timeline.end_frame_exclusive);
      if (end_frame_exclusive > start_frame) hits.push({ start_frame, end_frame_exclusive });
    }
    // Adjacent plan segments landing on one current clip become one range, so the count is
    // the number of visual clips touched rather than the number of segments.
    const merged = mergeTouching(hits);
    if (merged.length > 0) perClip.set(current.clip_id, merged);
  }

  const affectedRanges: AffectedRange[] = [...perClip.entries()].flatMap(([clip_id, ranges]) =>
    ranges.map((range) => ({ clip_id, ...range })));
  if (affectedRanges.length === 0) {
    throw fail(projectId, "the native plan does not reach any visual clip in the current projection");
  }
  if (affectedRanges.length > 64) {
    throw fail(projectId, "the affected range count exceeds the contract's ceiling of 64",
      { affected_range_count: affectedRanges.length });
  }
  affectedRanges.sort(compareRanges);

  const affectedClipIds = new Set(perClip.keys());

  // ── consumers ────────────────────────────────────────────────────────────────────────
  const consumers = new Map<string, AffectedConsumer>();
  const add = (kind: AffectedConsumer["kind"], id: string, action: AffectedConsumer["action"]): void => {
    consumers.set(`${kind} ${id} ${action}`, { kind, id, action });
  };

  // A visual clip that is being replaced is the one change M4A can express as a lock.
  for (const clip_id of affectedClipIds) add("visual", clip_id, "replace");

  // Narration and audio are preserved by policy, so they are recorded as preserved. They
  // are listed because they exist and sit under the affected range, not because they change.
  //
  // Narration is matched on the *migration's* recorded target path, before any ledger
  // lookup. The migration deliberately keeps the narration track out of the asset ledger —
  // it is a fact of the film's own audio, not one of the source project's reusable media —
  // so demanding a ledger row for it would refuse every migrated target that has narration.
  const isNarrationClip = (clip: EngineClip): boolean =>
    input.narrationTargetPath !== null && clip.source_ref === input.narrationTargetPath;
  for (const clip of projection.clips) {
    if (clip.kind !== "sound" || !MEDIA_EXTENSIONS.test(clip.source_ref)) continue;
    if (isNarrationClip(clip)) { add("narration", clip.clip_id, "preserve"); continue; }
    if (ledgerByPath.get(clip.source_ref) === undefined) {
      throw fail(projectId, "a sound clip references media the asset ledger does not know",
        { clip_id: clip.clip_id, source_ref: clip.source_ref });
    }
    add("audio", clip.clip_id, "preserve");
  }

  for (const subtitle of projection.subtitles) {
    add("subtitle", subtitle.subtitle_id, "preserve");
  }

  // ── shared assets: one asset, more than one current clip ─────────────────────────────
  const usersByAsset = new Map<string, string[]>();
  for (const clip of projection.clips) {
    if (!MEDIA_EXTENSIONS.test(clip.source_ref) || isNarrationClip(clip)) continue;
    const asset = ledgerByPath.get(clip.source_ref);
    if (asset === undefined) {
      throw fail(projectId, "a clip references media the asset ledger does not know",
        { clip_id: clip.clip_id, source_ref: clip.source_ref });
    }
    usersByAsset.set(asset.asset_id, [...(usersByAsset.get(asset.asset_id) ?? []), clip.clip_id]);
  }
  for (const [assetId, users] of usersByAsset) {
    if (users.length < 2) continue;
    // Shared means at least one user survives the write, so the asset must be relinked
    // rather than replaced. With every user replaced there is nothing left to relink, and
    // claiming one would be inventing a consumer.
    if (users.some((clipId) => affectedClipIds.has(clipId)) && users.some((clipId) => !affectedClipIds.has(clipId))) {
      add("shared_asset", assetId, "relink");
    } else {
      add("shared_asset", assetId, "preserve");
    }
  }

  // ── duration: only a real change, and M4A cannot express one ─────────────────────────
  const currentVisualEnd = visual.reduce((max, clip) => Math.max(max, clip.frame_range.end_frame_exclusive), 0);
  if (plan.duration_policy !== "preserve") {
    throw fail(projectId, "the native plan does not preserve duration, which M4A cannot express");
  }
  if (plan.total_frames !== currentVisualEnd) {
    throw fail(projectId,
      "adopting this plan would change the project's duration, which M4A does not compute",
      { plan_total_frames: plan.total_frames, current_visual_end: currentVisualEnd });
  }
  if (plan.narration_policy !== "preserve") {
    throw fail(projectId, "the native plan does not preserve narration, which M4A cannot express");
  }

  const affectedConsumers = [...consumers.values()].sort(compareConsumers);
  if (affectedConsumers.length === 0) {
    throw fail(projectId, "the graph found no consumer at all, which means it could not classify the projection");
  }
  if (affectedConsumers.length > 256) {
    throw fail(projectId, "the affected consumer count exceeds the contract's ceiling of 256",
      { affected_consumer_count: affectedConsumers.length });
  }

  // ── locks: the real change, and nothing else ─────────────────────────────────────────
  const affectedLocks: AffectedLock[] = affectedRanges.map((range) => ({
    lock_type: "visual" as const, scope: "shot" as const, target_id: range.clip_id,
    start_frame: range.start_frame, end_frame_exclusive: range.end_frame_exclusive,
  }));
  // Reuse LockService's own computation rather than restating it, so what impact checks is
  // what an eventual write will check.
  const viaService = affectedRanges.flatMap((range) => computeAffectedLocks(
    { op: "timeline.replace_visual_asset", clip_id: range.clip_id,
      range: { start_frame: range.start_frame, end_frame_exclusive: range.end_frame_exclusive } },
    projection));
  const lockedKeys = new Set(affectedLocks.map((lock) =>
    `${lock.lock_type} ${lock.scope} ${lock.target_id} ${lock.start_frame} ${lock.end_frame_exclusive}`));
  for (const lock of viaService) {
    const key = `${lock.lock_type} ${lock.scope} ${lock.target_id} ${lock.start_frame} ${lock.end_frame_exclusive}`;
    if (!lockedKeys.has(key)) { lockedKeys.add(key); affectedLocks.push(lock); }
  }
  affectedLocks.sort((left, right) => compareUtf8(left.target_id, right.target_id)
    || left.start_frame - right.start_frame || left.end_frame_exclusive - right.end_frame_exclusive);

  return { affected_ranges: affectedRanges, affected_consumers: affectedConsumers, affected_locks: affectedLocks };
}

export type { EngineClip };
