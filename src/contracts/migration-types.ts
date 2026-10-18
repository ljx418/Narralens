/**
 * M2.3 migration contracts (`docs/migration/M2/M2.3-development-and-acceptance-plan.md` §2).
 *
 * These are wire shapes: no absolute path, no server layout, nothing that would disclose
 * where a project lives. The Host keeps paths internally; these records carry identities
 * and digests only.
 */

/** The engine a migration may target. Only the pinned one is accepted. */
export const MIGRATION_TARGET_ENGINE = "openfilm" as const;
export type MigrationTargetEngine = typeof MIGRATION_TARGET_ENGINE;

/**
 * The migration transaction. `plan_written` is the first durable fact; everything after it
 * is derived and re-derivable. `reported` is last because the report is only true once the
 * new project is actually active and verified.
 */
export type MigrationState =
  | "plan_written"
  | "staged"
  | "validated"
  | "snapshot_published"
  | "committed"
  | "activated"
  | "reported"
  | "aborted"
  | "recovering"
  | "attention";

export const MIGRATION_TERMINAL_STATES: readonly MigrationState[] = [
  "aborted", "attention", "reported",
];

/** Feature inventory of the source project, one row per capability the plan had to place. */
export type MigrationFeatureStatus = "mapped" | "lossy" | "unsupported";

export interface MigrationFeature {
  readonly id: string;
  readonly status: MigrationFeatureStatus;
  /** Why, in the plan's own words. Empty only when `status` is `mapped`. */
  readonly note: string;
}

export interface MigrationIdentityEntry {
  /** Stable identifier in the source project. */
  readonly source_id: string;
  /** Stable identifier in the migrated project; never an array index. */
  readonly target_id: string;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
}

export interface MigrationAssetMapping {
  readonly source_path: string;
  readonly target_path: string;
  readonly sha256: string;
  /** Asset id in the project's own manifest, when the manifest knows it. */
  readonly asset_id: string | null;
}

export interface MigrationSubtitleMapping {
  readonly source_path: string;
  readonly target_path: string;
  readonly sha256: string;
}

export interface MigrationValidationStep {
  readonly id: string;
  readonly description: string;
  /** What the step proves, stated so a report reader can check it without trusting us. */
  readonly asserts: string;
}

export interface MigrationPlanV1 {
  readonly format: "narralens.migration-plan@1.0";
  readonly migration_id: string;
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly source_project_id: string;
  readonly source_revision: number;
  readonly source_digest: string;
  readonly source_engine: string;
  readonly target_project_id: string;
  readonly target_engine: MigrationTargetEngine;
  readonly target_engine_upstream_sha: string;
  readonly identity_map: readonly MigrationIdentityEntry[];
  readonly features: readonly MigrationFeature[];
  readonly assets: readonly MigrationAssetMapping[];
  readonly subtitles: readonly MigrationSubtitleMapping[];
  /** The narration the copy carries, or null when the source had none. */
  readonly narration: MigrationSubtitleMapping | null;
  readonly validation_steps: readonly MigrationValidationStep[];
  /**
   * Anything the plan could not place. A non-empty list blocks activation: an unknown item
   * is a reason to stop, never a warning to click past.
   */
  readonly blocking: readonly string[];
  readonly created_at: string;
}

export type MigrationStepId =
  | "plan" | "stage" | "validate" | "snapshot" | "commit" | "asset_ledger" | "bind" | "report" | "rollback";

export interface MigrationStepRecord {
  readonly id: MigrationStepId;
  /** `done`, `failed`, or `blocked`; a step is never silently skipped. */
  readonly status: "done" | "failed" | "blocked";
  readonly detail: string;
  readonly artifact_sha256: string | null;
  readonly at: string;
}

export interface MigrationReportV1 {
  readonly format: "narralens.migration-report@1.0";
  readonly migration_id: string;
  readonly state: MigrationState;
  readonly plan: MigrationPlanV1;
  readonly steps: readonly MigrationStepRecord[];
  /** Every step completed, in order. */
  readonly complete: boolean;
  /** The source project's own bytes before and after; a difference is a defect, not progress. */
  readonly source_before_sha256: string;
  readonly source_after_sha256: string;
  readonly target_snapshot_id: string | null;
  readonly target_source_digest: string | null;
  /** Native clip identities in the migrated project, as the engine reports them. */
  readonly target_clips: readonly MigrationIdentityEntry[];
  readonly export_artifacts: readonly { readonly label: string; readonly sha256: string; readonly duration_frames: number }[];
  readonly rollback: RollbackRecord | null;
  readonly blocking: readonly string[];
  readonly updated_at: string;
}

export interface MigrationActivation {
  readonly format: "narralens.migration-activation@1.0";
  readonly migration_id: string;
  readonly target_project_id: string;
  readonly target_engine: MigrationTargetEngine;
  readonly target_engine_upstream_sha: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly activated_at: string;
}

export type RollbackPhase =
  | "requested" | "writes_stopped" | "in_flight_quarantined" | "source_restored" | "verified" | "failed";

export interface RollbackRecord {
  readonly format: "narralens.rollback-record@1.0";
  readonly migration_id: string;
  readonly phase: RollbackPhase;
  /** Writes were refused for the source project from this moment. */
  readonly writes_stopped_at: string | null;
  readonly quarantined_jobs: readonly string[];
  /** SHA of the source project's bytes after rollback; must equal the pre-migration value. */
  readonly source_sha256_before: string;
  readonly source_sha256_after: string | null;
  /** The migrated project and its report are kept for audit, never deleted. */
  readonly target_retained: true;
  readonly target_project_id: string;
  readonly export_sha256: string | null;
  readonly updated_at: string;
}
