/**
 * The M4C fault registry (development gate §6).
 *
 * The gate names the boundaries a controlled restore has to survive, and it says that every
 * one of them must be *injected* and *asserted* — a representative subset is not a matrix.
 * So the boundaries are an enumerable list here, in production code, rather than a set of
 * seams scattered through the service that nobody can name.
 *
 * Two kinds of boundary live here:
 *
 * - the **service** boundaries, where the restore decides something;
 * - the **database** boundaries, one before and one after every statement of the single
 *   commit transaction. A fault in the middle of that transaction must roll the whole thing
 *   back, and the only way to know that is to interrupt it between two statements.
 *
 * The list is the contract the test walks. If a boundary is added to the service and not to
 * this list, the registry check fails; if a boundary is in this list and the service cannot
 * reach it, the fault matrix fails.
 */

export type HistoryFaultPoint =
  // ── the service's own boundaries ───────────────────────────────────────────────────
  | "after_received"
  | "after_preconditions"
  | "after_target_resolved"
  | "after_plan"
  | "after_stage_copy"
  | "during_stage_copy"
  | "after_stage"
  | "after_validate"
  | "before_snapshot_publish"
  | "after_snapshot_publish"
  | "before_prepared"
  | "after_prepared"
  | "before_asset_install"
  | "after_asset_install"
  | "after_film_temp_fsync"
  | "before_film_rename"
  | "after_film_rename"
  | "after_parent_fsync"
  | "after_published"
  | "after_active_inspect"
  | "before_response"
  | "after_committed";

/**
 * The statements of the one commit transaction.
 *
 * The order is the transaction's own order, and the names are the ones the commit uses, so
 * a failure report says which statement was interrupted.
 */
export const HISTORY_COMMIT_STATEMENTS = [
  "verify_fact",
  "project_state",
  "impact",
  "snapshot",
  "projection_fact",
  "active_commit",
  "outbox",
  "idempotency",
  "transaction",
] as const;

export type HistoryCommitStatement = typeof HISTORY_COMMIT_STATEMENTS[number];

/** The fault point of a database statement: the same name, before or after. */
export function historyDbFaultPoint(statement: HistoryCommitStatement, phase: "before" | "after"): string {
  return `${phase}_db_statement:${statement}`;
}

export interface HistoryFaultDescriptor {
  readonly point: HistoryFaultPoint;
  /** Which part of the write the boundary sits in. */
  readonly stage: "service" | "adapter" | "publisher" | "commit";
  readonly description: string;
}

const FAULT_DESCRIPTORS: readonly HistoryFaultDescriptor[] = Object.freeze([
  { point: "after_received", stage: "service",
    description: "The transaction exists and the request has been recorded." },
  { point: "after_preconditions", stage: "service",
    description: "The baseline source digest has been recorded as the precondition." },
  { point: "after_target_resolved", stage: "service",
    description: "The target snapshot has been resolved and proved." },
  { point: "after_plan", stage: "service",
    description: "The engine has planned the restore." },
  { point: "after_stage_copy", stage: "adapter",
    description: "The current source has been copied into the isolated root, before the target's content is staged." },
  { point: "during_stage_copy", stage: "adapter",
    description: "The target's assets are staged and its film is not written yet: the stage is in the middle of copying the target's content." },
  { point: "after_stage", stage: "service",
    description: "The isolated tree carries the target's film and the target's closure." },
  { point: "after_validate", stage: "service",
    description: "The pinned upstream has read the staged tree and reproduced the target's digest." },
  { point: "before_snapshot_publish", stage: "service",
    description: "The content-addressed snapshot has not been published yet." },
  { point: "after_snapshot_publish", stage: "service",
    description: "The content-addressed snapshot has been published." },
  { point: "before_prepared", stage: "service",
    description: "The immutable restore fact has not been written yet." },
  { point: "after_prepared", stage: "service",
    description: "The immutable restore fact is written and the transaction is prepared." },
  { point: "before_asset_install", stage: "publisher",
    description: "The content-addressed assets have not been installed into the active root." },
  { point: "after_asset_install", stage: "publisher",
    description: "The content-addressed assets are installed into the active root." },
  { point: "after_film_temp_fsync", stage: "publisher",
    description: "The replacement film has been written to its temporary name and made durable." },
  { point: "before_film_rename", stage: "publisher",
    description: "The replacement film has not been renamed over the active one." },
  { point: "after_film_rename", stage: "publisher",
    description: "The replacement film has been renamed over the active one." },
  { point: "after_parent_fsync", stage: "publisher",
    description: "The active root's directory entry has been made durable." },
  { point: "after_published", stage: "service",
    description: "The author source has been published into the active root." },
  { point: "after_active_inspect", stage: "service",
    description: "The pinned upstream has read the published active source." },
  { point: "before_response", stage: "service",
    description: "The commit has happened and the response has not been written." },
  { point: "after_committed", stage: "service",
    description: "The database commit returned; the HTTP response has not yet been sent." },
] satisfies readonly HistoryFaultDescriptor[]);

export const HISTORY_FAULT_POINTS: readonly HistoryFaultDescriptor[] = FAULT_DESCRIPTORS;

/** Every boundary the matrix has to walk, service and publisher alike. */
export const HISTORY_SERVICE_FAULT_POINTS: readonly HistoryFaultPoint[] = Object.freeze(
  HISTORY_FAULT_POINTS.map((entry) => entry.point));

/**
 * The database boundaries: one before and one after every statement of the commit.
 */
export const HISTORY_DB_FAULT_POINTS: readonly string[] = Object.freeze(
  HISTORY_COMMIT_STATEMENTS.flatMap((statement) => [
    historyDbFaultPoint(statement, "before"),
    historyDbFaultPoint(statement, "after"),
  ]));

/**
 * The publisher's own boundary names, in the registry's vocabulary.
 *
 * The publisher is M4B's module and its vocabulary is its own. The mapping lives here so
 * that the fault matrix and the service read **one** table: a boundary the table does not
 * know about would be unreachable for the matrix, and the matrix would then record a
 * boundary as covered that no test ever reached.
 */
export const PUBLISHER_FAULT_POINTS: Readonly<Record<string, string>> = Object.freeze({
  asset_temp_fsynced: "before_asset_install",
  asset_installed: "after_asset_install",
  film_temp_fsynced: "after_film_temp_fsync",
  before_film_rename: "before_film_rename",
  film_renamed: "after_film_rename",
  parent_fsynced: "after_parent_fsync",
});

/** Every boundary, service and database together. */
export const HISTORY_ALL_FAULT_POINTS: readonly string[] = Object.freeze([
  ...HISTORY_SERVICE_FAULT_POINTS,
  ...HISTORY_DB_FAULT_POINTS,
]);
