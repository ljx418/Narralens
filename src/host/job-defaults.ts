import type { JobState } from "../contracts/types.js";

/**
 * Per-kind job policy (M2.2 plan §2).
 *
 * A provider-driven job must never be retried automatically, so its ceiling is one. Local
 * work can be re-run, so its ceiling is higher. The value is written into the row at
 * creation, so the boundary survives a restart and can be asserted.
 */

export type JobKind = "proposal_comparison" | "render" | "snapshot_publish" | "materialize";

export const DEFAULT_MAX_ATTEMPTS: Readonly<Record<JobKind, number>> = Object.freeze({
  proposal_comparison: 1,
  render: 3,
  snapshot_publish: 3,
  // M3's materialize job is local, restartable work: it can be re-acquired after a lost
  // lease, and reaching the ceiling means a human decides rather than an infinite retry.
  materialize: 3,
});

export function maxAttemptsFor(kind: JobKind, override?: number): number {
  if (override !== undefined) return override;
  return DEFAULT_MAX_ATTEMPTS[kind] ?? 1;
}

/** States a job may never leave. */
export const TERMINAL_JOB_STATES: ReadonlySet<JobState> = new Set<JobState>(
  ["cancelled", "succeeded", "failed", "attention", "completed_after_cancel"],
);

/**
 * The only legal job transitions. `completed_after_cancel` is absent on purpose: a late
 * result is quarantined, never presented as an adoptable success.
 */
export const JOB_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  queued: ["running", "cancelled", "failed", "attention"],
  running: ["succeeded", "failed", "cancelled", "cancel_requested", "attention"],
  cancel_requested: ["cancelled", "attention"],
  succeeded: [],
  failed: [],
  cancelled: [],
  attention: [],
  completed_after_cancel: [],
});

export const LEGACY_LATE_RESULT_STATE = "completed_after_cancel";
export const QUARANTINE_MESSAGE_PREFIX = "quarantined:";
