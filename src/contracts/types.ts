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

export type JobState = "queued" | "running" | "cancel_requested" | "cancelled"
  | "succeeded" | "failed" | "completed_after_cancel";

export type ApiErrorCode = "INVALID_REQUEST" | "INVALID_SESSION" | "ORIGIN_REJECTED"
  | "NOT_FOUND" | "REVISION_CONFLICT" | "INVALID_PROPOSAL" | "PROVIDER_REJECTED"
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
  error?: ApiError;
}

export interface JobEvent {
  event_id: number;
  job_id: string;
  type: JobState;
  at: string;
  message?: string;
  proposal_id?: string;
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
