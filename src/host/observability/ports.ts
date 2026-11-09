/**
 * Ports consumed by the read-only observation projection (BRIDGE / E13, case A-EVENTS).
 *
 * Everything this module knows about the outside world arrives through the four ports
 * declared here. None of them is implemented in this lane:
 *
 * - `AtomicObservationReadPort` reads the project context, the global outbox
 *   watermark and the retention floor **at one consistent boundary**. MAIN implements
 *   it against the shared repository.
 * - `EventReadPort` reads events after a watermark, together with the *global*
 *   watermark the read observed.
 * - `CursorSigningPort` and `CursorVerificationPort` own the wire cursor. MAIN owns
 *   the key material, the key rotation and the durable cursor state.
 *
 * The split matters for correctness, not for tidiness. A cursor that is signed
 * somewhere else and verified here is only safe if the claims it carries are checked
 * against the *same* scope the request was made in; that check lives in this module,
 * and it needs the read port's watermark to do it.
 */

import type { Context, CursorClaims, Event } from "../../contracts/agent-driven-types.js";

/** Injectable clock. Expiry and TTL are never read from the ambient clock. */
export interface ObservationClock {
  now(): number;
}

/**
 * The state read at one consistent boundary.
 *
 * `global_watermark` is the *global* outbox position, not the number of events this
 * project has. A client that filters its event list by project still has to advance
 * its position by the global watermark, otherwise every reconnect re-reads the whole
 * log and a filter that skips events silently loses the window between them.
 */
export interface AtomicSnapshotState {
  readonly context: Context;
  readonly global_watermark: number;
  /** The lowest event id still retained. Anything below it can no longer be served. */
  readonly oldest_retained_event_id: number;
}

/** Reads the context, the global watermark and the retention floor atomically. */
export interface AtomicObservationReadPort {
  readSnapshotState(input: {
    readonly project_id: string;
  }): Promise<AtomicSnapshotState>;
}

export interface EventReadRequest {
  readonly project_id: string;
  /** Only events strictly after this id are scanned. */
  readonly after_event_id: number;
  /**
   * The maximum number of rows the scan may read.
   *
   * When the limit truncates the scan, the port reports the position it actually
   * reached in `scanned_watermark` — never the global tail.
   */
  readonly limit: number;
}

export interface EventBatch {
  /**
   * Every row the scan read, in ascending event id order.
   *
   * The port does **not** filter: it returns the rows it scanned, and the projection
   * decides which of them the caller sees. That is what makes the batch verifiable —
   * a client can check that the rows it was given cover the range the scan claims to
   * have reached. A port that filtered server-side would make a truncated scan
   * indistinguishable from a scan that lost rows.
   */
  readonly events: readonly Event[];
  /**
   * The position the scan reached: the id of the last row it read.
   *
   * This is **not** the global tail. If the scan was truncated by the limit, it
   * stops at the last row that was actually read; the rows beyond it have not been
   * looked at and must not be treated as delivered. It is also not a count of the
   * rows the caller will be shown: it advances past rows that the caller's filter
   * skips, because the scan did read them.
   */
  readonly scanned_watermark: number;
  /**
   * The global tail, for information only.
   *
   * It says how much is left in the log; it says nothing about what was delivered.
   * No position may be advanced to it.
   */
  readonly high_watermark: number;
}

/** Reads events after a watermark. */
export interface EventReadPort {
  readEvents(input: EventReadRequest): Promise<EventBatch>;
}

/**
 * Signs a cursor.
 *
 * The returned token is opaque to clients and must match the contract's cursor shape
 * (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`) so it can travel in `EventSnapshot.cursor` and
 * be sent back in `CursorRead.cursor`.
 */
export interface CursorSigningPort {
  /** The key id that will be embedded in the claims and used to verify the token. */
  readonly key_id: string;
  sign(claims: CursorClaims): Promise<string>;
}

/**
 * Verifies a cursor.
 *
 * Implementations must throw a `CursorRejection` (see `cursor.ts`) describing *why*
 * the cursor was rejected. A verifier that cannot tell a forged token from an expired
 * one forces the caller to guess, and guessing in the wrong direction means either
 * serving a foreign cursor or rejecting a resumable one.
 */
export interface CursorVerificationPort {
  verify(cursor: string): Promise<CursorClaims>;
}
