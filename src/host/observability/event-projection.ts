/**
 * Workflow event projection (BRIDGE / E13, case A-EVENTS).
 *
 * The projection is the read-only half of the observation surface: it turns the
 * Host's ordered event log into the ordered, de-duplicated event list a client may
 * consume, and it keeps the client's position honest.
 *
 * Two rules carry the weight here.
 *
 * **The position is a position, not a count.** A client's watermark says how far it
 * has read in the *global* log, not how many rows it was shown. A scan that read
 * three rows belonging to other projects has still advanced the client by three
 * rows. If the position were derived from the visible rows, a heavily filtered
 * client would re-scan the whole log on every reconnect, and a client that
 * reconnected after a gap would silently lose the window between the rows it did
 * see.
 *
 * **The position may never run ahead of what was read.** The port reports where the
 * scan stopped (`scanned_watermark`) separately from where the log ends
 * (`high_watermark`). A scan truncated by its limit stops at the last row it read;
 * the rows beyond it have not been looked at, so the client may not be told they
 * were delivered. A batch that claims a position the rows do not cover is refused
 * rather than accepted, because accepting it would lose a window silently.
 *
 * The project filter is not optional. Even a caller that supplies its own
 * `matches` predicate gets only the rows of the project it asked for: a filter is
 * an addition to the project scope, never a replacement for it.
 */

import type { Event } from "../../contracts/agent-driven-types.js";
import type { EventBatch, EventReadPort } from "./ports.js";

/** Decides whether an event is visible to a client, on top of the project scope. */
export type EventFilter = (event: Event) => boolean;

/**
 * A batch that cannot be trusted.
 *
 * Refusing the batch is the point: an inconsistent batch means the client cannot
 * tell whether rows were lost, and continuing would turn a lost window into a
 * silent one.
 */
export class EventBatchError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "EventBatchError";
  }
}

export interface ProjectionInput {
  readonly events: readonly Event[];
  /** The position the client already holds. Rows at or below it are not new. */
  readonly fromWatermark: number;
  /** The position the scan reached. */
  readonly scannedWatermark: number;
  /** The global tail. Informational only. */
  readonly highWatermark: number;
  /** The project the client asked for. Always enforced. */
  readonly project_id: string;
  /** An additional filter, applied on top of the project scope. */
  readonly matches?: EventFilter;
}

export interface ProjectionResult {
  /** New, visible events in ascending event id order. */
  readonly events: readonly Event[];
  /**
   * The position the client must resume from.
   *
   * The position the scan reached, even when every event in the batch was filtered
   * out — the scan read them, so the client does not have to read them again.
   */
  readonly nextWatermark: number;
}

function assertWatermark(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EventBatchError(`invalid_${label}`, `The ${label} is not a safe non-negative integer.`);
  }
}

/**
 * Check that a batch is internally consistent.
 *
 * The checks are the ones a client can make without trusting the port's word:
 *
 * - the positions are safe, non-negative integers,
 * - the scan did not go backwards and did not pass the tail,
 * - the rows are ascending, unique and strictly after the client's position,
 * - the rows cover the range the scan claims: the last row is the position the
 *   scan reached, and an empty batch means the scan read nothing.
 */
export function assertConsistentBatch(input: {
  readonly events: readonly Event[];
  readonly fromWatermark: number;
  readonly scannedWatermark: number;
  readonly highWatermark: number;
}): void {
  assertWatermark(input.fromWatermark, "from_watermark");
  assertWatermark(input.scannedWatermark, "scanned_watermark");
  assertWatermark(input.highWatermark, "high_watermark");
  if (input.scannedWatermark < input.fromWatermark) {
    throw new EventBatchError("scanned_watermark_regressed", "The scanned position is behind the client's position.");
  }
  if (input.highWatermark < input.scannedWatermark) {
    throw new EventBatchError("scanned_watermark_ahead_of_tail", "The scanned position is ahead of the log tail.");
  }
  let previous = input.fromWatermark;
  for (const event of input.events) {
    if (!Number.isSafeInteger(event.event_id) || event.event_id < 1) {
      throw new EventBatchError("invalid_event_id", "An event carries an invalid event id.");
    }
    if (event.event_id <= previous) {
      throw new EventBatchError("unordered_event", "The events are not strictly ascending.");
    }
    previous = event.event_id;
  }
  const last = input.events[input.events.length - 1];
  if (input.events.length === 0) {
    if (input.scannedWatermark !== input.fromWatermark) {
      throw new EventBatchError("missing_rows", "The batch claims a position but carries no rows.");
    }
    return;
  }
  if (last === undefined || last.event_id !== input.scannedWatermark) {
    throw new EventBatchError("missing_rows", "The batch does not cover the position it claims to have reached.");
  }
}

/**
 * Project a batch of events.
 *
 * The scan position is what the client resumes from. The rows it is shown are the
 * rows of its project that it has not seen, in order.
 */
export function projectEvents(input: ProjectionInput): ProjectionResult {
  assertConsistentBatch({
    events: input.events,
    fromWatermark: input.fromWatermark,
    scannedWatermark: input.scannedWatermark,
    highWatermark: input.highWatermark,
  });
  const selected = input.events.filter((event) => {
    if (event.project_id !== input.project_id) return false;
    return input.matches === undefined ? true : input.matches(event);
  });
  return {
    events: selected,
    nextWatermark: input.scannedWatermark,
  };
}

/**
 * Read a batch of events after a position and project it.
 *
 * The project scope is applied here and cannot be switched off: a caller that
 * supplies its own `matches` predicate narrows the rows further, it never widens
 * them to another project.
 */
export async function readProjectedEvents(input: {
  readonly read: EventReadPort;
  readonly project_id: string;
  readonly fromWatermark: number;
  readonly limit?: number;
  readonly matches?: EventFilter;
}): Promise<ProjectionResult> {
  const batch: EventBatch = await input.read.readEvents({
    project_id: input.project_id,
    after_event_id: input.fromWatermark,
    limit: input.limit ?? 200,
  });
  return projectEvents({
    events: batch.events,
    fromWatermark: input.fromWatermark,
    scannedWatermark: batch.scanned_watermark,
    highWatermark: batch.high_watermark,
    project_id: input.project_id,
    ...(input.matches === undefined ? {} : { matches: input.matches }),
  });
}
