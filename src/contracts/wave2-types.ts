import type { Sha256 } from "./engine-types.js";

/**
 * Wave 2 runtime contracts (`docs/migration/WAVE2/02_ARCHITECTURE_AND_CONTRACTS.md` §3).
 *
 * Every type here has a runtime schema in `contracts/` and a validator in
 * `src/contracts/validator.ts`. The three are added in one commit on purpose: a schema
 * that drifts from its type is the defect M2.1's first review round raised, and the frozen
 * plan makes "schema/type/validator drift" a MAJOR regression.
 *
 * Two rules hold across all of them:
 *
 * - No request carries an absolute server path, a URL or a shell argument. Inputs are ids
 *   the Host re-reads from its own controlled store; `absoluteServerPath()` stays Host-only.
 * - Nothing here is content authority. Materialization and impact are discardable
 *   preparation and short-lived authorization facts; only a snapshot plus the active commit
 *   written by `ProjectCoordinator` is.
 */

export interface HalfOpenRange {
  start_frame: number;
  end_frame_exclusive: number;
}

export const FROZEN_PROXY_PROFILE_ID = "wave2-proxy-720p30-v1";

export interface MaterializeSegmentBinding {
  segment_id: string;
  asset_id: string;
  source_start_frame: number;
  source_end_frame_exclusive: number;
}

export interface MaterializeRequestV1 {
  format: "narralens.materialize-request@1.0";
  comparison_id: string;
  base_revision: number;
  expected_source_digest: Sha256;
  control_revision: number;
  profile: { profile_id: typeof FROZEN_PROXY_PROFILE_ID };
  segment_bindings: readonly MaterializeSegmentBinding[];
  idempotency_key: string;
}

export interface NativePlanClipV1 {
  clip_id: string;
  segment_id: string;
  asset_id: string;
  asset_sha256: Sha256;
  timeline: HalfOpenRange;
  source: HalfOpenRange;
  track_id: string;
}

export interface NativePlanV1 {
  format: "narralens.native-plan@1.0";
  engine: "openfilm";
  fps: { num: 30; den: 1 };
  clips: readonly NativePlanClipV1[];
  narration_policy: "preserve";
  duration_policy: "preserve";
  total_frames: number;
  plan_sha256: Sha256;
}

export type MaterializationState =
  | "queued" | "running" | "validating" | "ready_for_adoption"
  | "stale" | "cancel_requested" | "cancelled" | "failed" | "attention";

/**
 * `token` is a content-addressed relative path. It is resolved inside the Host's dedicated
 * derived-artifact root and is deliberately unresolvable by any adapter or client.
 */
export interface MaterializationProxy {
  token: string;
  sha256: Sha256;
  frame_count: number;
  profile_id: string;
}

export interface LineageEntryV1 {
  output_sha256: Sha256;
  input_asset_id: string;
  input_sha256: Sha256;
  source: HalfOpenRange;
  output: HalfOpenRange;
}

export interface MaterializationV1 {
  format: "narralens.materialization@1.0";
  materialization_id: string;
  job_id: string;
  project_id: string;
  comparison_id: string;
  proposal_id: string;
  state: MaterializationState;
  base_revision: number;
  source_digest: Sha256;
  control_revision: number;
  proposal_sha256: Sha256;
  asset_inventory_sha256: Sha256;
  rights_digest: Sha256;
  request_digest: Sha256;
  native_plan: NativePlanV1 | null;
  proxy: MaterializationProxy | null;
  lineage: readonly LineageEntryV1[];
  blocking_reasons: readonly string[];
  created_at: string;
  updated_at: string;
}

export type ControlledOperation = "adopt_materialization" | "restore_snapshot";

export type ConsumerKind =
  | "visual" | "narration" | "subtitle" | "audio" | "transition" | "shared_asset";

export interface AffectedConsumer {
  kind: ConsumerKind;
  id: string;
  action: "preserve" | "replace" | "relink";
}

export interface LockChecked {
  lock_id: string;
  control_revision: number;
}

export interface ImpactSpecV1 {
  format: "narralens.impact@1.0";
  impact_id: string;
  project_id: string;
  operation: ControlledOperation;
  materialization_id: string | null;
  target_snapshot_id: string | null;
  base_revision: number;
  source_digest: Sha256;
  control_revision: number;
  engine: "openfilm";
  engine_upstream_sha: string;
  affected_ranges: readonly (HalfOpenRange & { clip_id: string })[];
  affected_consumers: readonly AffectedConsumer[];
  locks_checked: readonly LockChecked[];
  rights_digest: Sha256;
  native_plan_sha256: Sha256;
  approvals_required: readonly string[];
  expires_at: string;
  impact_hash: Sha256;
}

/**
 * What a client is allowed to say when it asks for an impact (ADR-W2.0-004 §2).
 *
 * The union is discriminated on `op` and closed on both arms, so an intent cannot carry a
 * second reference id, and a client cannot smuggle one in through an extra property. The
 * snapshot arm exists so M4B and M4C share one request; whether it can be *served* is a
 * capability question the service answers, not a field the client sets.
 */
export type ImpactIntentV1 =
  | { readonly op: "adopt_materialization"; readonly materialization_id: string }
  | { readonly op: "restore_snapshot"; readonly target_snapshot_id: string };

export interface ImpactRequestV1 {
  format: "narralens.impact-request@1.0";
  base_revision: number;
  expected_source_digest: Sha256;
  control_revision: number;
  intent: ImpactIntentV1;
  idempotency_key: string;
}

export interface AdoptRequestV1 {
  format: "narralens.adopt-request@1.0";
  base_revision: number;
  expected_source_digest: Sha256;
  control_revision: number;
  materialization_id: string;
  impact_id: string;
  impact_hash: Sha256;
  approval: { confirmed: true };
  idempotency_key: string;
}

export interface RestoreRequestV1 {
  format: "narralens.restore-request@1.0";
  base_revision: number;
  expected_source_digest: Sha256;
  control_revision: number;
  target_snapshot_id: string;
  impact_id: string;
  impact_hash: Sha256;
  approval: { confirmed: true };
  idempotency_key: string;
}

export interface ControlledWriteResponseV1 {
  format: "narralens.controlled-write-response@1.0";
  transaction_id: string;
  project_id: string;
  operation: ControlledOperation;
  previous_revision: number;
  new_revision: number;
  snapshot_id: string;
  source_digest: Sha256;
  outbox_event_id: number;
  status: "committed";
}

export type ControlledWriteRequestV1 = AdoptRequestV1 | RestoreRequestV1;
