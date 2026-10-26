import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "../api-error.js";
import { canonicalJson } from "../engine/source-digest-v1.js";
import type { LockCreateRequestV1, LockMutationResponseV1, PublicLockV1 } from "../../contracts/wave3-types.js";
import type { OperationIdempotencyStore } from "../projects/operation-idempotency-store.js";
import type { ProjectOperationQueue } from "../projects/project-operation-queue.js";
import type { RevisionStore } from "../projects/revision-store.js";
import { PUBLIC_LOCK_OWNER_LABEL } from "./workbench-service.js";

/**
 * M5's lock mutation service (Wave 3 `01` §4.2, `04` §4).
 *
 * Three rules make this different from the Wave 2 `LockService.acquire`, and each of them
 * is a rule a *client* can break, so each is enforced here rather than assumed:
 *
 * 1. **Strict CAS.** The client names the `base_control_revision` it read. If the project's
 *    control revision has moved, the request is refused with 409 and *nothing* changes —
 *    no lock row, no counter, no outbox row. The comparison, the lock row, the `+1` and
 *    the `lock.changed` outbox row are one `BEGIN IMMEDIATE`.
 * 2. **A stable owner.** The owner is the installation's persistent actor, not a
 *    per-process token. The API publishes a fixed label; the actor's UUID never leaves
 *    the database.
 * 3. **A closed request shape.** The client cannot name the owner, cannot widen the type
 *    or scope, and cannot choose a reason outside the fixed set. A shot lock must name a
 *    clip that exists in the *current* projection and its range must lie inside that clip;
 *    a project lock must cover the whole film.
 *
 * Replays are answered from the one idempotency authority: the same key with the same
 * body replays the same response, and the same key with a different body is a 409.
 */
export interface LockMutationDeps {
  readonly revisions: RevisionStore;
  readonly idempotency: OperationIdempotencyStore;
  readonly queue: ProjectOperationQueue;
  /** The current projection's clips, for the shot-lock range proof. */
  readonly clipsOf: (projectId: string) => Promise<ReadonlyArray<{
    clip_id: string; start_frame: number; end_frame_exclusive: number;
  }>>;
  /** The current film's length, for the project-lock range proof. */
  readonly frameCountOf: (projectId: string) => Promise<number>;
}

const OPERATION_CREATE = "lock.create";
const OPERATION_RELEASE = "lock.release";

export class LockMutationService {
  readonly #deps: LockMutationDeps;

  constructor(deps: LockMutationDeps) {
    this.#deps = deps;
  }

  async create(projectId: string, request: LockCreateRequestV1, correlationId: string): Promise<LockMutationResponseV1> {
    return await this.#deps.queue.run(projectId, async () => {
      const digest = digestOf({ op: "create", project_id: projectId, request });
      const replay = this.#deps.idempotency.recall(projectId, OPERATION_CREATE, request.idempotency_key);
      if (replay !== undefined) {
        this.#deps.idempotency.assertSameRequest(replay, digest, OPERATION_CREATE, projectId, correlationId);
        return JSON.parse(replay.response_json) as LockMutationResponseV1;
      }

      const [clips, frameCount] = await Promise.all([
        this.#deps.clipsOf(projectId),
        this.#deps.frameCountOf(projectId),
      ]);

      this.#assertRange(projectId, request, clips, frameCount, correlationId);

      const now = new Date().toISOString();
      const lockId = `lock_${randomUUID().replaceAll("-", "")}`;
      // The owner is the installation, and the row records it; the API only ever publishes
      // the fixed label.
      const owner = this.#deps.revisions.hostIdentity();

      const response = this.#deps.revisions.atomic(() => {
        const newControlRevision = this.#deps.revisions.createLockWithControlRevisionCas({
          lock_id: lockId, project_id: projectId, lock_type: request.lock_type, scope: request.scope,
          target_id: request.scope === "project" ? "" : request.target_id ?? "",
          start_frame: request.start_frame, end_frame_exclusive: request.end_frame_exclusive,
          owner, reason: request.reason_code, created_at: now, updated_at: now,
        }, request.base_control_revision);
        const lock = this.#publicLock({
          lock_id: lockId, project_id: projectId, lock_type: request.lock_type, scope: request.scope,
          target_id: request.scope === "project" ? null : request.target_id ?? null,
          start_frame: request.start_frame, end_frame_exclusive: request.end_frame_exclusive,
          reason_code: request.reason_code, control_revision: newControlRevision, created_at: now,
        });
        const body: LockMutationResponseV1 = {
          format: "narralens.lock-mutation-response@1.0",
          project_id: projectId,
          lock,
          active: true,
          control_revision: newControlRevision,
        };
        this.#deps.idempotency.record({
          projectId, operationKind: OPERATION_CREATE, idempotencyKey: request.idempotency_key,
          requestDigest: digest, response: body, now: new Date(),
        });
        return body;
      });

      return response;
    });
  }

  async release(projectId: string, lockId: string, baseControlRevision: number,
    idempotencyKey: string, correlationId: string): Promise<LockMutationResponseV1> {
    return await this.#deps.queue.run(projectId, async () => {
      const digest = digestOf({ op: "release", project_id: projectId, lock_id: lockId,
        base_control_revision: baseControlRevision });
      const replay = this.#deps.idempotency.recall(projectId, OPERATION_RELEASE, idempotencyKey);
      if (replay !== undefined) {
        this.#deps.idempotency.assertSameRequest(replay, digest, OPERATION_RELEASE, projectId, correlationId);
        return JSON.parse(replay.response_json) as LockMutationResponseV1;
      }

      const lock = this.#deps.revisions.readLock(lockId);
      // A lock that belongs to another project is *not found* here, not forbidden: telling
      // a caller that an id exists in a project it may not see is an information leak.
      if (lock === undefined || lock.project_id !== projectId) {
        throw new HttpError(404, "NOT_FOUND", "Lock not found", undefined, correlationId);
      }
      if (!lock.active) {
        throw new HttpError(409, "REVISION_CONFLICT", "The lock has already been released",
          { lock_id: lockId }, correlationId);
      }
      return this.#deps.revisions.atomic(() => {
        const newControlRevision = this.#deps.revisions.deactivateLockWithControlRevisionCas(
          lockId, baseControlRevision, new Date(),
        );
        const body: LockMutationResponseV1 = {
          format: "narralens.lock-mutation-response@1.0",
          project_id: projectId,
          lock: this.#publicLock({
            lock_id: lock.lock_id, project_id: lock.project_id, lock_type: lock.lock_type as PublicLockV1["lock_type"],
            scope: lock.scope as PublicLockV1["scope"],
            target_id: lock.scope === "project" ? null : lock.target_id,
            start_frame: lock.start_frame, end_frame_exclusive: lock.end_frame_exclusive,
            reason_code: lock.reason as PublicLockV1["reason_code"],
            control_revision: newControlRevision, created_at: lock.created_at,
          }),
          active: false,
          control_revision: newControlRevision,
        };
        this.#deps.idempotency.record({
          projectId, operationKind: OPERATION_RELEASE, idempotencyKey,
          requestDigest: digest, response: body, now: new Date(),
        });
        return body;
      });
    });
  }

  /**
   * The range proof.
   *
   * A shot lock names a clip of the *current* projection and stays inside it; a project
   * lock covers the whole film. A range outside either is refused here rather than stored,
   * because a lock that can never intersect anything is a lock the operator believes is
   * protecting something and is not.
   */
  #assertRange(projectId: string, request: LockCreateRequestV1,
    clips: ReadonlyArray<{ clip_id: string; start_frame: number; end_frame_exclusive: number }>,
    frameCount: number, correlationId: string): void {
    if (request.start_frame < 0 || request.end_frame_exclusive <= request.start_frame) {
      throw new HttpError(422, "INVALID_RANGE", "The lock range is empty or negative", undefined, correlationId);
    }
    if (request.scope === "project") {
      if (request.target_id !== null && request.target_id !== "") {
        throw new HttpError(422, "INVALID_REQUEST", "A project lock must not name a target", undefined, correlationId);
      }
      if (request.start_frame !== 0 || request.end_frame_exclusive !== frameCount) {
        throw new HttpError(422, "INVALID_RANGE",
          "A project lock must cover the whole film", { frame_count: frameCount }, correlationId);
      }
      return;
    }
    if (request.target_id === null || request.target_id === "") {
      throw new HttpError(422, "INVALID_REQUEST", "A shot lock must name a clip", undefined, correlationId);
    }
    const matches = clips.filter((clip) => clip.clip_id === request.target_id);
    if (matches.length !== 1) {
      throw new HttpError(422, "INVALID_REQUEST",
        "A shot lock must name exactly one clip of the current projection", undefined, correlationId);
    }
    const clip = matches[0]!;
    if (request.start_frame < clip.start_frame || request.end_frame_exclusive > clip.end_frame_exclusive) {
      throw new HttpError(422, "INVALID_RANGE",
        "A shot lock's range must lie inside the clip it names",
        { clip_id: clip.clip_id, start_frame: clip.start_frame, end_frame_exclusive: clip.end_frame_exclusive },
        correlationId);
    }
    void projectId;
  }

  #publicLock(input: {
    lock_id: string; project_id: string; lock_type: PublicLockV1["lock_type"]; scope: PublicLockV1["scope"];
    target_id: string | null; start_frame: number; end_frame_exclusive: number;
    reason_code: PublicLockV1["reason_code"]; control_revision: number; created_at: string;
  }): PublicLockV1 {
    return {
      format: "narralens.public-lock@1.0",
      lock_id: input.lock_id,
      project_id: input.project_id,
      lock_type: input.lock_type,
      scope: input.scope,
      target_id: input.scope === "project" ? null : input.target_id,
      start_frame: input.start_frame,
      end_frame_exclusive: input.end_frame_exclusive,
      owner_label: PUBLIC_LOCK_OWNER_LABEL,
      reason_code: input.reason_code,
      control_revision: input.control_revision,
      created_at: input.created_at,
    };
  }
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
