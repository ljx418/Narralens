/**
 * Public surface of the read-only observation projection (BRIDGE / E13).
 *
 * MAIN imports from here to wire the projection to the real repository, the real
 * signing key and the real event log. Nothing in this module writes to the project,
 * the engine or the database: it reads facts and projects them.
 *
 * **There is no cursor implementation here.** The module exports the *ports* for
 * signing and verifying a cursor; MAIN owns the key material, the key rotation and
 * the durable nonce/claims store, and supplies its own implementation of the two
 * ports. A codec shipped in production code would be a second implementation of the
 * same scheme, and the two would drift. The lane's own cases use a test helper
 * (`tests/agent-driven/bridge/helpers/cursor-codec.ts`) that speaks MAIN's agreed
 * wire shape.
 */

export type {
  AtomicObservationReadPort,
  AtomicSnapshotState,
  CursorSigningPort,
  CursorVerificationPort,
  EventBatch,
  EventReadPort,
  EventReadRequest,
  ObservationClock,
} from "./ports.js";
export {
  assertCursorScope,
  buildCursorClaims,
  CursorRejection,
  isCursorExpired,
  isWellFormedInterval,
  rejectionToCode,
  resolveResumePoint,
  verifyCursor,
  type CursorErrorCode,
  type CursorRejectionKind,
  type CursorScope,
  type ResumePoint,
} from "./cursor.js";
export {
  assertConsistentBatch,
  EventBatchError,
  projectEvents,
  readProjectedEvents,
  type EventFilter,
  type ProjectionInput,
  type ProjectionResult,
} from "./event-projection.js";
export {
  ObservationFault,
  projectEventSnapshot,
  readEventSnapshot,
  type EventSnapshotOptions,
  type EventSnapshotRequest,
  type EventSnapshotResult,
} from "./event-snapshot.js";
export {
  HEALTH_SAMPLE_INTERVAL_MS,
  HEALTH_STALE_AFTER_MS,
  ServiceHealthRegistry,
  type HealthSample,
  type ObservedServiceState,
} from "./service-health-registry.js";
