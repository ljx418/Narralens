import type { Sha256 } from "./engine-types.js";
import type { HistoryEntryV1 } from "./wave2-types.js";

/**
 * The M5 contracts (Wave 3 `01_M5_ARCHITECTURE_AND_CONTRACTS.md` §4, and
 * `04_M5_REVIEW_CLOSURE_AND_SUPERSESSIONS.md` §§2–4).
 *
 * They are the *read* and *control* surface of the same-page Studio experience. Three rules
 * hold across all of them:
 *
 * - **No path, ever.** A workbench projection is a document the browser holds; an absolute
 *   path in it is a directory listing of the operator's machine, and a session token in it
 *   is a credential.
 * - **One identity.** `project_id` is always the *target* — the migrated OpenFilm project
 *   every write route acts on. `source_project_id` is the legacy project it came from, and
 *   it is read-only input.
 * - **A read model is not a second timeline.** The workbench projection describes the
 *   target's clips; it never becomes a source of truth the native Studio does not share.
 */

export type WorkbenchLockType = "visual" | "narration" | "duration";
export type WorkbenchLockScope = "project" | "shot";
export type LockReasonCode =
  | "preserve_visual"
  | "preserve_narration"
  | "preserve_duration"
  | "user_review"
  | "approved_content";

export interface PublicLockV1 {
  readonly format: "narralens.public-lock@1.0";
  readonly lock_id: string;
  readonly project_id: string;
  readonly lock_type: WorkbenchLockType;
  readonly scope: WorkbenchLockScope;
  /** The clip a shot lock names; null for a project lock. */
  readonly target_id: string | null;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  /** The fixed label every local operator sees. The actor's UUID is never published. */
  readonly owner_label: "本机操作者";
  readonly reason_code: LockReasonCode;
  readonly control_revision: number;
  readonly created_at: string;
}

export interface LockMutationResponseV1 {
  readonly format: "narralens.lock-mutation-response@1.0";
  readonly project_id: string;
  readonly lock: PublicLockV1;
  /** True while the lock is held, false once it has been released. */
  readonly active: boolean;
  readonly control_revision: number;
}

export interface LockCreateRequestV1 {
  readonly format: "narralens.lock-request@1.0";
  readonly base_control_revision: number;
  readonly lock_type: WorkbenchLockType;
  readonly scope: WorkbenchLockScope;
  readonly target_id: string | null;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  readonly reason_code: LockReasonCode;
  readonly idempotency_key: string;
}

export interface WorkbenchTrackV1 {
  readonly track_id: string;
  readonly index: number;
  readonly clip_ids: readonly string[];
}

export interface WorkbenchClipV1 {
  readonly clip_id: string;
  readonly track_id: string;
  readonly kind: string;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  /**
   * The legacy shot this clip came from, when there is exactly one.
   *
   * It is proved on both sides — the source descriptor's shot and the target projection's
   * clip must carry the same id — and it is `null` when that proof does not hold. It is an
   * anchor for a comparison's lineage, never a target for a write route.
   */
  readonly source_shot_id: string | null;
  readonly source_label: string | null;
}

export interface WorkbenchCapabilityV1 {
  readonly entry_id: string;
  readonly state: "supported" | "blocked";
  readonly reason: string;
}

export interface WorkbenchProjectionV1 {
  readonly format: "narralens.workbench@1.0";
  readonly project_id: string;
  readonly source_project_id: string;
  readonly migration_id: string;
  readonly revision: number;
  readonly control_revision: number;
  readonly source_digest: Sha256;
  readonly active_snapshot_id: Sha256;
  readonly fps: { readonly num: number; readonly den: number };
  readonly frame_count: number;
  readonly engine: "openfilm";
  readonly engine_upstream_sha: string;
  readonly tracks: readonly WorkbenchTrackV1[];
  readonly clips: readonly WorkbenchClipV1[];
  readonly history: readonly HistoryEntryV1[];
  readonly active_locks: readonly PublicLockV1[];
  readonly capabilities: readonly WorkbenchCapabilityV1[];
  readonly preview: { readonly kind: "openfilm-studio"; readonly url: string; readonly bridge_version: 1 };
  /** Whether the migration's narration could be proved. "unknown" is not "false". */
  readonly narration: "present" | "absent" | "unknown";
}

export interface ComparisonReplayRequestV1 {
  readonly format: "narralens.comparison-replay-request@1.0";
  readonly source_comparison_id: string;
  readonly base_revision: number;
  readonly idempotency_key: string;
}

export interface ComparisonLineageV1 {
  readonly source_comparison_id: string;
  readonly source_project_id: string;
  readonly migration_id: string;
  readonly source_sha256: Sha256;
}

export interface ComparisonReplayResponseV1 {
  readonly format: "narralens.comparison-replay-response@1.0";
  readonly project_id: string;
  readonly comparison_id: string;
  readonly lineage: ComparisonLineageV1;
  /** The replayed comparison, so the page can show it without a second round trip. */
  readonly comparison: unknown;
  /** True when this response is a replay of an earlier one with the same key. */
  readonly replayed: boolean;
}
