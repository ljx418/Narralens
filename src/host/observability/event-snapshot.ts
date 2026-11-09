/**
 * Atomic snapshot read and signed cursor issuance (BRIDGE / E13, case A-EVENTS).
 *
 * A client that wants to observe a project does two things: it takes a snapshot, and
 * it subscribes to the events after the snapshot. The two have to meet exactly once.
 *
 * The snapshot is taken at **one consistent boundary**: the project context, the
 * global outbox watermark and the retention floor are read together, from the same
 * instant. Reading them separately is the classic way to lose a window — a commit
 * that lands between the context read and the watermark read produces a snapshot
 * that claims to be at watermark N while showing the state as of N-1, and the client
 * never sees the event that explains the difference.
 *
 * The cursor that comes back is signed *after* the read, and it carries the watermark
 * that was observed. It is therefore a promise: "everything up to this position is
 * already in the snapshot you are holding".
 *
 * Retention is enforced here rather than at the event read. A cursor whose position
 * has fallen out of the retained window cannot be served, and the client has to
 * resynchronise from a fresh snapshot. Reporting that as an expired cursor (410)
 * rather than silently returning a partial window is what keeps a reconnect from
 * looking like a quiet system.
 */

import type { EventSnapshot } from "../../contracts/agent-driven-types.js";
import { validateAgentDefinition } from "../../contracts/agent-driven-validator.js";
import {
  buildCursorClaims,
  CursorRejection,
  resolveResumePoint,
  type CursorScope,
  type ResumePoint,
} from "./cursor.js";
import type {
  AtomicObservationReadPort,
  CursorSigningPort,
  CursorVerificationPort,
  ObservationClock,
} from "./ports.js";

/**
 * A fault in the observation chain itself.
 *
 * It is not a client error and not a cursor rejection: the Host answered with
 * something that cannot be true (a context for a different project, a context that
 * is not the frozen shape). The caller reports it as an internal error, because it
 * is the server's problem and not the client's.
 */
export class ObservationFault extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "ObservationFault";
  }
}

/** The shape the contract requires of a wire cursor. */
const CURSOR_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
/** The minimum length `CursorRead` accepts for a cursor or a `Last-Event-ID`. */
const CURSOR_MIN_LENGTH = 32;

export interface EventSnapshotRequest {
  readonly principal_id: string;
  readonly project_id: string;
  readonly filter_digest: string;
  readonly instance_generation: number;
  /** The cursor the client already holds, if any. */
  readonly cursor: string | null;
  /** The transport's `Last-Event-ID`, if any. */
  readonly last_event_id: string | null;
}

export interface EventSnapshotOptions {
  readonly read: AtomicObservationReadPort;
  readonly sign: CursorSigningPort;
  readonly verify: CursorVerificationPort;
  readonly clock: ObservationClock;
  /**
   * How long a freshly issued cursor stays usable, in milliseconds.
   *
   * Required, and it is MAIN's policy, not this module's: a cursor lifetime is a
   * decision about how long a client may be disconnected, and inventing a default
   * here would quietly become that decision. It must be a positive, finite number
   * of milliseconds; a zero, a negative or an infinite lifetime would produce a
   * cursor that is either dead on arrival or eternal.
   */
  readonly cursorTtlMs: number;
}

export interface EventSnapshotResult {
  readonly snapshot: EventSnapshot;
  /** The position the client was resuming from, before the new cursor was issued. */
  readonly resume: ResumePoint;
}

function assertPositiveFiniteMs(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new ObservationFault("invalid_cursor_ttl", `The ${label} must be a positive, finite number of milliseconds.`);
  }
}

/**
 * Take a snapshot and issue the cursor that follows it.
 *
 * Both the request's cursor and its `Last-Event-ID` are verified, separately, before
 * anything is read. A refusal at this point is a refusal of the *request*, not a
 * partial answer: the client is told to resynchronise, and it is told which reason
 * applies, so it can decide between "start over" and "this is not my cursor".
 */
export async function projectEventSnapshot(
  options: EventSnapshotOptions,
  request: EventSnapshotRequest,
): Promise<EventSnapshotResult> {
  assertPositiveFiniteMs(options.cursorTtlMs, "cursor TTL");
  const nowMs = options.clock.now();
  const scope: CursorScope = {
    principal_id: request.principal_id,
    project_id: request.project_id,
    filter_digest: request.filter_digest,
    instance_generation: request.instance_generation,
  };

  const resume = await resolveResumePoint({
    verify: options.verify,
    scope,
    nowMs,
    cursor: request.cursor,
    lastEventId: request.last_event_id,
  });

  const state = await options.read.readSnapshotState({ project_id: request.project_id });

  if (state.context.project_id !== request.project_id) {
    // The context belongs to another project. Serving it would show one project's
    // state under another project's identity.
    throw new ObservationFault(
      "snapshot_context_project_mismatch",
      "The snapshot context does not belong to the requested project.",
    );
  }

  if (resume.watermark !== null && resume.watermark < state.oldest_retained_event_id) {
    // The position the client holds has been trimmed out of the retained window. It
    // cannot be served, and pretending otherwise would open a silent gap.
    throw new CursorRejection("outside_retention", "cursor_outside_retention_window");
  }

  const claims = buildCursorClaims({
    scope,
    outbox_watermark: state.global_watermark,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + options.cursorTtlMs,
    keyId: options.sign.key_id,
  });
  const cursor = await options.sign.sign(claims);
  if (typeof cursor !== "string" || cursor.length < CURSOR_MIN_LENGTH || !CURSOR_PATTERN.test(cursor)) {
    // The signing port produced something the contract cannot carry. That is an
    // internal fault, not a client error: it must not be reported as a bad request.
    throw new ObservationFault("signed_cursor_invalid", "The signed cursor does not match the contract's shape.");
  }

  const snapshot: EventSnapshot = {
    context: state.context,
    cursor,
    oldest_retained_event_id: state.oldest_retained_event_id,
    snapshot_event_id: state.global_watermark,
    filter_digest: request.filter_digest,
    instance_generation: request.instance_generation,
  };
  return {
    snapshot: validateAgentDefinition<EventSnapshot>("EventSnapshot", snapshot),
    resume,
  };
}

/** The snapshot only, for callers that do not need the resume point. */
export async function readEventSnapshot(
  options: EventSnapshotOptions,
  request: EventSnapshotRequest,
): Promise<EventSnapshot> {
  const result = await projectEventSnapshot(options, request);
  return result.snapshot;
}
