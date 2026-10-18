import { randomUUID } from "node:crypto";
import { HttpError } from "../api-error.js";
import type { EditOperation } from "../../contracts/types.js";
import type { EngineProjection, HalfOpenFrameRange } from "../../contracts/engine-types.js";
import { RevisionStore } from "./revision-store.js";

/**
 * LockService (`03_M2_M4_MODULE_DESIGN.md` §2.3, AC-008).
 *
 * Three lock classes exist — visual, narration and duration. Which ones an edit affects is
 * computed on the server from the typed edit and the committed projection; the client's
 * `preserve` field is recorded as intent and can never authorise a write.
 */

export type LockType = "visual" | "narration" | "duration";
export type LockScope = "project" | "shot";

/** The native operation vocabulary the classifier understands, taken from the registry ids. */
export type LockImpactOperation =
  | "timeline.set_visual_fit" | "timeline.replace_visual_asset"
  | "timeline.trim" | "timeline.move" | "timeline.split" | "timeline.speed"
  | "subtitle.line.set" | "subtitle.style.set" | "audio.track.replace" | "audio.mix.set";

export interface LockImpactRequest {
  readonly op: LockImpactOperation;
  readonly clip_id: string;
  readonly range: HalfOpenFrameRange;
}

export interface AffectedLock {
  readonly lock_type: LockType;
  readonly scope: LockScope;
  readonly target_id: string;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
}

export interface EngineLock {
  readonly lock_id: string;
  readonly project_id: string;
  readonly lock_type: LockType;
  readonly scope: LockScope;
  readonly target_id: string;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  readonly owner: string;
  readonly reason: string;
  readonly control_revision: number;
  readonly active: boolean;
}

export interface AcquireLockInput {
  readonly projectId: string;
  readonly lockType: LockType;
  readonly scope: LockScope;
  readonly targetId?: string;
  readonly startFrame?: number;
  readonly endFrameExclusive?: number;
  readonly owner: string;
  /** Free text. This is where the client's `preserve` intent is recorded — never authority. */
  readonly reason: string;
}

/** Operations that change what occupies a frame range, and so are duration-sensitive. */
const DURATION_OPERATIONS = new Set<LockImpactOperation>([
  "timeline.trim", "timeline.move", "timeline.split", "timeline.speed",
]);

/** Operations that touch narration or audio, and so hit shared narration consumers. */
const NARRATION_OPERATIONS = new Set<LockImpactOperation>([
  "subtitle.line.set", "subtitle.style.set", "audio.track.replace", "audio.mix.set",
]);

/**
 * Pure: which locks does this operation affect?
 *
 * Takes the committed projection, never a staged one, so a lock can never be evaluated
 * against content that has not taken effect (M2.2 plan §10.1 R-4).
 */
export function computeAffectedLocks(request: LockImpactRequest, _projection: EngineProjection): AffectedLock[] {
  const affected: AffectedLock[] = [
    { lock_type: "visual", scope: "shot", target_id: request.clip_id,
      start_frame: request.range.start_frame, end_frame_exclusive: request.range.end_frame_exclusive },
  ];
  if (DURATION_OPERATIONS.has(request.op)) {
    affected.push({ lock_type: "duration", scope: "shot", target_id: request.clip_id,
      start_frame: request.range.start_frame, end_frame_exclusive: request.range.end_frame_exclusive });
  }
  if (NARRATION_OPERATIONS.has(request.op)) {
    affected.push({ lock_type: "narration", scope: "project", target_id: request.clip_id,
      start_frame: request.range.start_frame, end_frame_exclusive: request.range.end_frame_exclusive });
  }
  return affected;
}

/** Map a legacy typed edit onto the vocabulary the classifier understands. */
export function impactForEdit(operation: EditOperation, range: HalfOpenFrameRange): LockImpactRequest {
  const op: LockImpactOperation = operation.op === "set_visual_fit"
    ? "timeline.set_visual_fit"
    : "timeline.replace_visual_asset";
  return { op, clip_id: operation.shot_id, range };
}

function overlaps(left: HalfOpenFrameRange, right: HalfOpenFrameRange): boolean {
  return left.start_frame < right.end_frame_exclusive && right.start_frame < left.end_frame_exclusive;
}

export class LockService {
  constructor(private readonly store: RevisionStore) {}

  /**
   * Acquire a lock. Lock changes go through the caller's project queue and bump the control
   * revision, which commit re-checks (M2.2 plan §5).
   */
  acquire(input: AcquireLockInput, initialRevision: number, now = new Date()): EngineLock {
    const lockId = `lock_${randomUUID().replaceAll("-", "")}`;
    const at = now.toISOString();
    const row = {
      lock_id: lockId, project_id: input.projectId, lock_type: input.lockType, scope: input.scope,
      target_id: input.targetId ?? "", start_frame: input.startFrame ?? 0,
      end_frame_exclusive: input.endFrameExclusive ?? 0, owner: input.owner, reason: input.reason,
      created_at: at, updated_at: at,
    };
    this.store.createLockWithControlRevision(row, initialRevision);
    return this.lock(lockId)!;
  }

  /** Releasing a lock is also a policy change, so it moves the control revision too. */
  release(lockId: string, initialRevision: number, now = new Date()): number {
    const lock = this.lock(lockId);
    if (lock === undefined) throw new HttpError(404, "NOT_FOUND", "Lock not found");
    return this.store.deactivateLockWithControlRevision(lockId, initialRevision, now);
  }

  lock(lockId: string): EngineLock | undefined {
    const row = this.store.readLock(lockId);
    return row === undefined ? undefined : { ...row, lock_type: row.lock_type as LockType, scope: row.scope as LockScope };
  }

  activeLocks(projectId: string): EngineLock[] {
    return this.store.activeLocks(projectId)
      .map((row) => ({ ...row, lock_type: row.lock_type as LockType, scope: row.scope as LockScope }));
  }

  controlRevision(projectId: string, initialRevision: number): number {
    return this.store.controlRevision(projectId, initialRevision);
  }

  /**
   * Refuse a write that touches a locked range. `preserve` is not consulted: it is an
   * intent the client stated, and the server's own computation decides (AC-008).
   */
  assertUnlocked(projectId: string, affected: readonly AffectedLock[]): void {
    const locks = this.activeLocks(projectId);
    for (const lock of locks) {
      const match = affected.find((candidate) =>
        candidate.lock_type === lock.lock_type
        && (lock.scope === "project" || lock.target_id === candidate.target_id)
        && overlaps(candidate, { start_frame: lock.start_frame, end_frame_exclusive: lock.end_frame_exclusive }));
      if (match !== undefined) {
        throw new HttpError(423, "TARGET_LOCKED",
          `${lock.lock_type} target is locked by ${lock.owner || lock.lock_id}`,
          { lock_id: lock.lock_id, lock_type: lock.lock_type, target_id: match.target_id });
      }
    }
  }
}
