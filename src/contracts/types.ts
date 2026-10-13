export interface Selection {
  shot_id: string;
  start_frame: number;
  end_frame_exclusive: number;
}

export interface FitEditOperation {
  op: "set_visual_fit";
  shot_id: string;
  value: "contain" | "cover";
}

export interface MediaEditOperation {
  op: "replace_visual_asset";
  shot_id: string;
  asset_id: string;
}

export type EditOperation = FitEditOperation | MediaEditOperation;

export interface EditRequest {
  base_revision: number;
  idempotency_key: string;
  selection: Selection;
  preserve: Array<"narration" | "duration">;
  operations: [EditOperation];
}

export interface EditResponse {
  transaction_id: string;
  project_id: string;
  previous_revision: number;
  new_revision: number;
  operation: EditOperation;
  status: "committed" | "unchanged";
  changed: boolean;
  source_sha256: string;
  run_sha256: string;
}

export interface ProposalRequest {
  base_revision: number;
  selection: Selection;
  intent: string;
  preserve: string[];
}

export interface ProposalComparisonRequest {
  base_revision: number;
  selection: Selection;
  intent: string;
  preserve: Array<"narration" | "duration">;
  proposal_count: number;
}

export type ProposalStrategyKind = "chronology" | "contrast" | "evidence-led" | "map-led" | "quote-led" | "metaphor-led";
export type ProposalSegmentRole = "anchor" | "context" | "evidence" | "contrast" | "transition" | "conclusion";

export interface ProposalComparisonDraft {
  schema_version: "1.0";
  kind: "narralens.proposal_comparison_draft";
  proposals: Array<{
    option_key: string;
    title: string;
    strategy: { kind: ProposalStrategyKind; rationale: string };
    summary: string;
    segments: Array<{ segment_id: string; duration_frames: number; role: ProposalSegmentRole; intent: string; asset_requirement_ids: string[] }>;
    assets_needed: Array<{ requirement_id: string; kind: "video" | "image" | "graphic" | "map" | "data-visualization"; description: string; duration_frames: number; rights_requirement: "cleared" }>;
    source_refs: Array<{ ref_id: string; kind: "project" | "user-provided" | "research"; label: string; claim?: string }>;
    requires_materialization: true;
    renderable: false;
  }>;
}

export interface ProposalComparison {
  schema_version: "1.0";
  kind: "narralens.proposal_comparison";
  comparison_id: string;
  project_id: string;
  base_revision: number;
  selection: Selection;
  intent_sha256: string;
  preserve: Array<"narration" | "duration">;
  proposal_count: number;
  proposals: Array<Omit<ProposalComparisonDraft["proposals"][number], "option_key"> & {
    proposal_id: string;
    materialization_cost: { status: "unknown"; currency: null; amount: null };
  }>;
  generation_audit: RunnerGenerationAudit;
  created_at: string;
}

export interface RunnerGenerationAudit {
  stdout_sha256: string;
  model_names: string[];
  total_cost_usd: number | null;
  duration_ms: number | null;
  num_turns: number | null;
  service_tier: string | null;
}

export type JobState = "queued" | "running" | "cancel_requested" | "cancelled"
  | "succeeded" | "failed" | "completed_after_cancel";

export type ApiErrorCode = "INVALID_REQUEST" | "INVALID_SESSION" | "ORIGIN_REJECTED"
  | "NOT_FOUND" | "REVISION_CONFLICT" | "INVALID_PROPOSAL" | "INVALID_PROPOSAL_SET" | "PROVIDER_REJECTED"
  | "PROVIDER_OVERLOADED" | "RUNNER_UNAVAILABLE"
  | "RUNNER_TIMEOUT" | "IDEMPOTENCY_KEY_CONFLICT" | "UNSUPPORTED_EDIT"
  | "MISSING_ASSET" | "MANIFEST_CHANGED" | "AMBIGUOUS_TIME" | "APPROVAL_REQUIRED"
  | "TARGET_LOCKED" | "PROJECT_ATTENTION_REQUIRED" | "HYPIT_UNAVAILABLE"
  | "TRANSACTION_FAILED" | "INTERNAL_ERROR";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  correlation_id: string;
  details?: Record<string, unknown>;
}

export interface JobResponse {
  job_id: string;
  project_id: string;
  state: JobState;
  created_at: string;
  updated_at: string;
  proposal_id?: string;
  comparison_id?: string;
  error?: ApiError;
}

export interface JobEvent {
  event_id: number;
  job_id: string;
  type: JobState;
  at: string;
  message?: string;
  proposal_id?: string;
  comparison_id?: string;
  error?: ApiError;
}

export interface ProjectResponse {
  project_id: string;
  revision: number;
  frame_rate: number;
  frame_count: number;
  shots: Selection[];
  preview: { kind: "hypit-studio"; url: string };
  locks?: { visual: boolean };
  visual_fits?: Record<string, "contain" | "cover">;
  visual_assets?: Record<string, string>;
  available_visual_assets?: Array<{
    asset_id: string;
    duration_frames: number;
    source_label: string;
    license_label: string;
  }>;
}

export interface ProposalBundle {
  schema_version: "1.0";
  kind: "narralens.proposal_bundle";
  project_id: string;
  proposal_id: string;
  base_revision: number;
  selection: Selection;
  preserve: string[];
  summary: string;
  segments: Array<{ id: string; duration_frames: number; intent: string; asset_id: string | null }>;
  assets_needed: Array<Record<string, unknown>>;
  source_refs: Array<Record<string, unknown>>;
  cost: { status: "unknown" | "estimated" | "approved" | "spent"; currency: string | null; amount: number | null; approved_ceiling?: number | null };
  source_packet?: { kind: "openmontage.proposal_packet"; id: string; sha256: string };
  requires_materialization: boolean;
  renderable: boolean;
}
