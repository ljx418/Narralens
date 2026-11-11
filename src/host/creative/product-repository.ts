/**
 * PRODUCT lane persistence seam (A round).
 *
 * Contract: `src/contracts/agent-driven-types.ts` (frozen DTOs).
 * Storage: the frozen `cp_a0_*` tables in `docs/agent-driven-v1/cp-a0/migration.sql`.
 * Column-level mapping: `docs/parallel/lane-product/requests/002-exact-record-mapping.md`.
 *
 * Three rules shape this file, all of them MAIN's:
 *
 * 1. No generic key/value store. `ProductCollection` is closed and every collection has a
 *    complete record DTO and a documented table. `get`/`list`/`put` are typed down to
 *    `ProductRecords[K]`, so an adapter that does not know the table cannot satisfy them.
 * 2. One command authority. Project-scoped idempotency stays in MAIN's existing
 *    `operation_idempotency`; the lane recalls and records through the transaction, never
 *    through a table of its own.
 * 3. No workflow commit. Nothing here moves a film pointer. `project_state`, `snapshot`,
 *    `active_commit`, `project_transaction` and `job` stay MAIN's.
 *
 * The transaction callback is synchronous so MAIN can hold one `BEGIN IMMEDIATE` across
 * the records, the idempotency receipt and the outbox event.
 */

import type {
  Approval,
  ArtifactContent,
  Brief,
  Change,
  ContentDecision,
  FixedWorkflowVersion,
  Question,
  QuestionAnswer,
  Ref,
  ReviewPackage,
  ReviewDecisionInput,
  RunAuthorization,
  RunGate,
  RunScope,
  Script,
  Storyboard,
} from "../../contracts/agent-driven-types.js";
import { epochSecondsToIso } from "./time.js";

/* -------------------------------------------------------------------------------------- */
/* Collections and record DTOs                                                            */
/* -------------------------------------------------------------------------------------- */

export type ProductCollection =
  | "intake_version"
  | "intake_head"
  | "intake_content_decision"
  | "intake_confirmation"
  | "question_version"
  | "question_head"
  | "answer_version"
  | "answer_head"
  | "template_version"
  | "template_head"
  | "artifact_version"
  | "artifact_head"
  | "run"
  | "plan_version"
  | "review_request"
  | "content_decision"
  | "trusted_confirmation"
  | "execution_grant"
  | "step_attempt"
  | "approval"
  | "prepared_authorization"
  | "bootstrap_command"
  | "project_origin"
  | "native_ack"
  | "event";

export type ArtifactDocument = Brief | Script | Storyboard | ReviewPackage;
export type ArtifactKind = "brief" | "script" | "storyboard" | "chapter" | "cover";
export type ReviewGateKind = "brief" | "sample" | "first_chapter" | "chapter" | "cover" | "risk";

export interface IntakeVersionRecord {
  readonly intake_id: string;
  readonly version: number;
  readonly principal_id: string;
  readonly input_digest: string;
  readonly content_json: Brief;
  readonly created_at: string;
}

export interface IntakeHeadRecord {
  readonly intake_id: string;
  readonly current_version: number;
}

export interface IntakeContentDecisionRecord {
  readonly decision_id: string;
  readonly intake_id: string;
  readonly intake_version: number;
  readonly request_id: string;
  readonly input_digest: string;
  readonly choice: "accept_content" | "revise_content" | "reject_content";
  readonly source: "agent_conversation" | "driver_relay";
  readonly source_message_ref: string;
  readonly authority: "content_only";
  readonly recorded_at: string;
}

export interface IntakeConfirmationRecord {
  readonly confirmation_id: string;
  readonly intake_id: string;
  readonly intake_version: number;
  readonly input_digest: string;
  readonly principal_id: string;
  readonly channel: "trusted_ui";
  readonly session_ref: string;
  readonly action: "project.create";
  readonly issued_at: number;
  readonly expires_at: number;
}

export interface QuestionVersionRecord {
  readonly intake_id: string;
  readonly intake_version: number;
  readonly input_digest: string;
  readonly question_id: string;
  readonly question_version: number;
  readonly kind: "text" | "choice";
  readonly skip_allowed: 0 | 1;
  readonly question_json: Question;
  readonly created_at: string;
}

export interface QuestionHeadRecord {
  readonly intake_id: string;
  readonly intake_version: number;
  readonly question_id: string;
  readonly current_question_version: number;
}

export interface AnswerVersionRecord {
  readonly intake_id: string;
  readonly intake_version: number;
  readonly question_id: string;
  readonly question_version: number;
  readonly answer_id: string;
  readonly answer_version: number;
  readonly input_digest: string;
  readonly principal_id: string;
  readonly channel: "agent_conversation" | "driver_relay" | "trusted_ui";
  readonly authority: "content_only";
  readonly skipped: 0 | 1;
  readonly answer_json: QuestionAnswer;
  readonly recorded_at: string;
}

export interface AnswerHeadRecord {
  readonly intake_id: string;
  readonly intake_version: number;
  readonly question_id: string;
  readonly question_version: number;
  readonly current_answer_version: number;
}

export interface TemplateVersionRecord {
  readonly template_id: "local-short-film";
  readonly version: 1;
  readonly parent_version: number | null;
  readonly execution_digest: string;
  readonly capability_id: "clip.prepare" | "snapshot.render" | "qc.inspect" | "delivery.package";
  readonly capability_version: "1";
  readonly definition_json: FixedWorkflowVersion;
  readonly created_at: string;
}

export interface TemplateHeadRecord {
  readonly template_id: "local-short-film";
  readonly draft_version: number;
  readonly published_version: number | null;
}

export interface ArtifactVersionRecord {
  readonly project_id: string;
  readonly artifact_id: string;
  readonly version: number;
  readonly kind: ArtifactKind;
  readonly schema_version: 1;
  readonly input_digest: string;
  readonly content_digest: string;
  readonly content_json: ArtifactDocument;
  readonly input_refs_json: Ref[];
  readonly created_at: string;
}

export interface ArtifactHeadRecord {
  readonly project_id: string;
  readonly artifact_id: string;
  readonly draft_version: number;
}

export type RunState =
  | "ready"
  | "running"
  | "waiting_user"
  | "waiting_agent"
  | "waiting_resource"
  | "blocked"
  | "paused"
  | "reconciling"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunRecord {
  readonly project_id: string;
  readonly run_id: string;
  readonly run_scope_digest: string;
  readonly template_id: "local-short-film";
  readonly template_version: 1;
  readonly current_plan_version: 1;
  readonly state: RunState;
  readonly scope_json: RunScope;
  readonly checkpoint_json: RunCheckpoint;
  readonly created_at: string;
}

export interface RunCheckpoint {
  /** The observation revision of the workflow; it advances with every checkpoint change. */
  readonly workflow_revision: number;
  /**
   * When the checkpoint was last written, in ISO-8601.
   *
   * The workflow's `observed_at` comes from here, not from the clock at read time: a read
   * must not pretend that something was observed now when the durable facts were last
   * written earlier.
   */
  readonly observed_at: string;
  readonly gates: RunGate[];
  readonly attempts: RunCheckpointAttempt[];
  readonly review_packages: RunCheckpointPackage[];
}

export interface RunCheckpointAttempt {
  readonly step_id: string;
  readonly attempt: number;
  readonly state: "pending" | "running" | "waiting_user" | "succeeded" | "failed" | "cancelled" | "stale" | "unknown";
  readonly input_digest: string;
  readonly job_id: string | null;
  readonly output_artifact_id: string | null;
  readonly output_version: number | null;
  readonly input_refs: Ref[];
  readonly output_refs: Ref[];
}

export interface RunCheckpointPackage {
  readonly package_id: string;
  readonly version: number;
  readonly kind: ReviewPackage["kind"];
  readonly chapter_id: string | null;
  readonly input_digest: string;
  readonly output_digest: string;
  readonly quality_digest: string;
  readonly state: "pending" | "accepted" | "changes_requested" | "rejected" | "stale";
  readonly reuse_of_package_id: string | null;
  /** The gate this package satisfied, or `null` when it satisfied none. */
  readonly reuse_of_gate_id: string | null;
  /**
   * The durable step attempt that produced the package.
   *
   * The adoption has to name a real attempt, and the frozen `ReviewPackage` DTO has no
   * field for it, so the lineage lives in the checkpoint instead of the wire document.
   */
  readonly step_id: string;
  readonly attempt: number;
}

export interface PlanVersionRecord {
  readonly project_id: string;
  readonly run_id: string;
  readonly plan_version: 1;
  readonly run_scope_digest: string;
  readonly input_digest: string;
  readonly plan_json: FixedPlan;
  readonly created_at: string;
}

/**
 * The fixed A plan.
 *
 * The shape is the golden `referenceVectors.fixedPlan.value` of
 * `docs/agent-driven-v1/cp-a0/canonical-vectors.json`, byte for byte: the canonical JSON
 * of this document has to hash to the published `execution_digest`
 * `b70615d5…07ca32`. `assertFixedPlanDigest` checks that at runtime.
 */
export interface FixedPlan {
  readonly template_id: "local-short-film";
  readonly template_version: 1;
  readonly stages: ReadonlyArray<FixedPlanStage>;
  readonly capabilities: ReadonlyArray<FixedPlanCapability>;
  readonly stability_skip: false;
  readonly dynamic_patch: false;
  readonly paid: false;
  readonly external_write: false;
  readonly runtime_mutation: false;
}

export interface FixedPlanStage {
  readonly id: "definition" | "sample" | "first_chapter" | "chapters" | "cover" | "delivery";
  readonly after: ReadonlyArray<string>;
  readonly review?: "sample" | "first_chapter" | "chapter_pack" | "cover" | "qc";
}

export type FixedPlanCapability = "clip.prepare" | "snapshot.render" | "qc.inspect" | "delivery.package";

export interface ReviewRequestRecord {
  readonly project_id: string;
  readonly run_id: string;
  readonly review_id: string;
  readonly plan_version: 1;
  readonly run_scope_digest: string;
  readonly gate: ReviewGateKind;
  readonly artifact_id: string;
  readonly artifact_version: number;
  readonly input_digest: string;
  readonly package_digest: string;
  readonly state: "pending" | "accepted" | "changes_requested" | "rejected" | "stale";
  readonly reuse_review_id: string | null;
  readonly created_at: string;
}

export interface ContentDecisionRecord {
  readonly project_id: string;
  readonly run_id: string;
  readonly decision_id: string;
  readonly review_id: string;
  readonly input_digest: string;
  readonly channel: "agent_conversation" | "driver_relay" | "trusted_ui";
  readonly actor_id: string;
  readonly choice: "accepted" | "changes_requested" | "rejected";
  readonly source_ref: string;
  readonly created_at: string;
}

export interface TrustedConfirmationRecord {
  readonly project_id: string;
  readonly run_id: string;
  readonly confirmation_id: string;
  readonly review_id: string | null;
  readonly input_digest: string;
  readonly purpose: "run.authorize" | "review" | "change.approve";
  readonly channel: "trusted_ui";
  readonly authenticated_actor: string;
  readonly session_ref: string;
  readonly action_digest: string;
  readonly issued_at: number;
  readonly expires_at: number;
}

export interface ExecutionGrantRecord {
  readonly project_id: string;
  readonly run_id: string;
  readonly grant_id: string;
  readonly run_scope_digest: string;
  readonly confirmation_id: string;
  readonly principal_id: string;
  readonly action: "clip.prepare" | "snapshot.render" | "qc.inspect" | "delivery.package" | "change.prepare" | "change.apply";
  readonly capability_id: FixedPlanCapability;
  readonly capability_version: "1";
  readonly allow_paid: 0;
  readonly allow_external: 0;
  readonly state: "active" | "revoked" | "expired";
  readonly expires_at: number;
}

/**
 * `cp_a0_step_attempt` row.
 *
 * `dependencies_json` holds the planned dependency **stage identities** of the fixed plan
 * (`after` in the golden plan), not output references: a step depends on stages, and the
 * outputs it consumes are already bound by `input_digest`.
 */
export interface StepAttemptRecord {
  readonly project_id: string;
  readonly run_id: string;
  readonly plan_version: 1;
  readonly step_id: string;
  readonly attempt: number;
  readonly run_scope_digest: string;
  readonly grant_id: string;
  readonly input_digest: string;
  readonly dependencies_json: string[];
  readonly state: "pending" | "running" | "waiting_user" | "succeeded" | "failed" | "cancelled" | "stale" | "unknown";
  readonly job_id: string | null;
  readonly output_artifact_id: string | null;
  readonly output_version: number | null;
  readonly updated_at: string;
}

export interface ApprovalRecord {
  readonly project_id: string;
  readonly run_id: string;
  readonly approval_id: string;
  readonly run_scope_digest: string;
  readonly confirmation_id: string;
  readonly plan_version: 1;
  readonly step_id: string;
  readonly attempt: number;
  readonly input_digest: string;
  readonly change_id: string;
  readonly impact_id: string;
  readonly base_revision: number;
  readonly control_revision: number;
  readonly action_digest: string;
  readonly facts_digest: string;
  readonly state: "active" | "consumed" | "rejected" | "revoked";
  readonly expires_at: number;
  readonly consumed_transaction_id: string | null;
}

export interface PreparedAuthorizationRecord {
  readonly transaction_id: string;
  readonly project_id: string;
  readonly run_id: string;
  readonly approval_id: string;
  readonly facts_digest: string;
}

/**
 * `cp_a0_bootstrap_command` row: the pre-project receipt for `project.create`.
 *
 * The seam addresses this table by `UNIQUE(principal_id, operation, idempotency_key)`
 * rather than by `command_id`, because the receipt is scoped by principal.
 */
export interface BootstrapCommandRecord {
  readonly command_id: string;
  readonly principal_id: string;
  readonly operation: "project.create";
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly reserved_project_id: string;
  readonly state: "reserved" | "staging" | "committed" | "compensating" | "failed";
  readonly response_json: unknown | null;
}

export interface ProjectOriginRecord {
  readonly project_id: string;
  readonly origin: "created";
  readonly command_id: string;
  readonly intake_confirmation_id: string;
  readonly intake_digest: string;
  readonly initial_snapshot_id: string;
  readonly creation_transaction_id: string;
  readonly root_ref: string;
}

export interface NativeAckRecord {
  readonly project_id: string;
  readonly editor_session_id: string;
  readonly ack_seq: number;
  readonly loaded_revision: number;
  readonly loaded_snapshot_id: string;
  readonly source_digest: string;
  readonly observed_at: string;
}

export interface EventRecord {
  readonly project_id: string;
  readonly event_id: number;
  readonly run_id: string;
  readonly run_scope_digest: string;
  readonly source: "host" | "worker" | "native";
  readonly input_digest: string;
  readonly observed_at: string;
}

export interface ProductRecords {
  readonly intake_version: IntakeVersionRecord;
  readonly intake_head: IntakeHeadRecord;
  readonly intake_content_decision: IntakeContentDecisionRecord;
  readonly intake_confirmation: IntakeConfirmationRecord;
  readonly question_version: QuestionVersionRecord;
  readonly question_head: QuestionHeadRecord;
  readonly answer_version: AnswerVersionRecord;
  readonly answer_head: AnswerHeadRecord;
  readonly template_version: TemplateVersionRecord;
  readonly template_head: TemplateHeadRecord;
  readonly artifact_version: ArtifactVersionRecord;
  readonly artifact_head: ArtifactHeadRecord;
  readonly run: RunRecord;
  readonly plan_version: PlanVersionRecord;
  readonly review_request: ReviewRequestRecord;
  readonly content_decision: ContentDecisionRecord;
  readonly trusted_confirmation: TrustedConfirmationRecord;
  readonly execution_grant: ExecutionGrantRecord;
  readonly step_attempt: StepAttemptRecord;
  readonly approval: ApprovalRecord;
  readonly prepared_authorization: PreparedAuthorizationRecord;
  readonly bootstrap_command: BootstrapCommandRecord;
  readonly project_origin: ProjectOriginRecord;
  readonly native_ack: NativeAckRecord;
  readonly event: EventRecord;
}

/* -------------------------------------------------------------------------------------- */
/* Keys and scopes                                                                         */
/* -------------------------------------------------------------------------------------- */

export interface ProductRecordKeys {
  readonly intake_version: { readonly intake_id: string; readonly version: number };
  readonly intake_head: { readonly intake_id: string };
  readonly intake_content_decision: { readonly decision_id: string };
  readonly intake_confirmation: { readonly confirmation_id: string };
  readonly question_version: {
    readonly intake_id: string;
    readonly intake_version: number;
    readonly question_id: string;
    readonly question_version: number;
  };
  readonly question_head: {
    readonly intake_id: string;
    readonly intake_version: number;
    readonly question_id: string;
  };
  readonly answer_version: {
    readonly intake_id: string;
    readonly intake_version: number;
    readonly question_id: string;
    readonly question_version: number;
    readonly answer_version: number;
  };
  readonly answer_head: {
    readonly intake_id: string;
    readonly intake_version: number;
    readonly question_id: string;
    readonly question_version: number;
  };
  readonly template_version: { readonly template_id: "local-short-film"; readonly version: 1 };
  readonly template_head: { readonly template_id: "local-short-film" };
  readonly artifact_version: {
    readonly project_id: string;
    readonly artifact_id: string;
    readonly version: number;
  };
  readonly artifact_head: { readonly project_id: string; readonly artifact_id: string };
  readonly run: { readonly project_id: string; readonly run_id: string };
  readonly plan_version: { readonly project_id: string; readonly run_id: string; readonly plan_version: 1 };
  readonly review_request: { readonly project_id: string; readonly run_id: string; readonly review_id: string };
  readonly content_decision: { readonly project_id: string; readonly run_id: string; readonly decision_id: string };
  readonly trusted_confirmation: {
    readonly project_id: string;
    readonly run_id: string;
    readonly confirmation_id: string;
  };
  readonly execution_grant: { readonly project_id: string; readonly run_id: string; readonly grant_id: string };
  readonly step_attempt: {
    readonly project_id: string;
    readonly run_id: string;
    readonly plan_version: 1;
    readonly step_id: string;
    readonly attempt: number;
  };
  readonly approval: { readonly project_id: string; readonly run_id: string; readonly approval_id: string };
  readonly prepared_authorization: { readonly transaction_id: string };
  readonly bootstrap_command: {
    readonly principal_id: string;
    readonly operation: "project.create";
    readonly idempotency_key: string;
  };
  readonly project_origin: { readonly project_id: string };
  readonly native_ack: { readonly project_id: string; readonly editor_session_id: string; readonly ack_seq: number };
  readonly event: { readonly project_id: string; readonly event_id: number };
}

export interface ProductRecordScopes {
  readonly intake_version: { readonly intake_id: string };
  readonly intake_head: { readonly intake_id: string };
  readonly intake_content_decision: { readonly intake_id: string; readonly intake_version?: number };
  readonly intake_confirmation: { readonly intake_id: string };
  readonly question_version: {
    readonly intake_id: string;
    readonly intake_version: number;
    readonly question_id?: string;
  };
  readonly question_head: { readonly intake_id: string; readonly intake_version: number };
  readonly answer_version: {
    readonly intake_id: string;
    readonly intake_version: number;
    readonly question_id: string;
    readonly question_version?: number;
  };
  readonly answer_head: {
    readonly intake_id: string;
    readonly intake_version: number;
    readonly question_id: string;
  };
  readonly template_version: { readonly template_id: "local-short-film" };
  readonly template_head: { readonly template_id: "local-short-film" };
  readonly artifact_version: { readonly project_id: string; readonly artifact_id?: string };
  readonly artifact_head: { readonly project_id: string };
  readonly run: { readonly project_id: string; readonly run_id?: string };
  readonly plan_version: { readonly project_id: string; readonly run_id: string };
  readonly review_request: { readonly project_id: string; readonly run_id: string };
  readonly content_decision: { readonly project_id: string; readonly run_id: string };
  readonly trusted_confirmation: { readonly project_id: string; readonly run_id: string };
  readonly execution_grant: { readonly project_id: string; readonly run_id: string };
  readonly step_attempt: {
    readonly project_id: string;
    readonly run_id: string;
    readonly plan_version?: number;
    readonly step_id?: string;
  };
  readonly approval: { readonly project_id: string; readonly run_id: string };
  readonly prepared_authorization: { readonly project_id: string; readonly run_id?: string };
  readonly bootstrap_command: { readonly principal_id: string; readonly operation: "project.create" };
  readonly project_origin: { readonly project_id: string };
  readonly native_ack: { readonly project_id: string; readonly editor_session_id: string };
  readonly event: { readonly project_id: string };
}

/* -------------------------------------------------------------------------------------- */
/* Collection specifications                                                               */
/* -------------------------------------------------------------------------------------- */

export type ProductCollectionKind = "immutable_version" | "append_only" | "head" | "mutable_state";

export interface ProductCollectionSpec<K extends ProductCollection> {
  readonly table: string;
  readonly kind: ProductCollectionKind;
  readonly primaryKey: ReadonlyArray<keyof ProductRecordKeys[K]>;
  readonly versionColumn?: keyof ProductRecords[K];
  readonly writable: boolean;
}

/**
 * The closed specification of every collection.
 *
 * `as const satisfies` keeps each entry's `kind` a literal type, which is what makes
 * `ProductHeadCollection` and `ProductAppendOnlyCollection` resolve to real unions
 * instead of `never`.
 */
export const PRODUCT_COLLECTIONS = {
  intake_version: {
    table: "cp_a0_intake_version",
    kind: "immutable_version",
    primaryKey: ["intake_id", "version"],
    writable: true,
  },
  intake_head: {
    table: "cp_a0_intake_head",
    kind: "head",
    primaryKey: ["intake_id"],
    versionColumn: "current_version",
    writable: true,
  },
  intake_content_decision: {
    table: "cp_a0_intake_content_decision",
    kind: "append_only",
    primaryKey: ["decision_id"],
    writable: true,
  },
  intake_confirmation: {
    table: "cp_a0_intake_confirmation",
    kind: "append_only",
    primaryKey: ["confirmation_id"],
    writable: true,
  },
  question_version: {
    table: "cp_a0_question_version",
    kind: "immutable_version",
    primaryKey: ["intake_id", "intake_version", "question_id", "question_version"],
    writable: true,
  },
  question_head: {
    table: "cp_a0_question_head",
    kind: "head",
    primaryKey: ["intake_id", "intake_version", "question_id"],
    versionColumn: "current_question_version",
    writable: true,
  },
  answer_version: {
    table: "cp_a0_answer_version",
    kind: "immutable_version",
    primaryKey: ["intake_id", "intake_version", "question_id", "question_version", "answer_version"],
    writable: true,
  },
  answer_head: {
    table: "cp_a0_answer_head",
    kind: "head",
    primaryKey: ["intake_id", "intake_version", "question_id", "question_version"],
    versionColumn: "current_answer_version",
    writable: true,
  },
  template_version: {
    table: "cp_a0_template_version",
    kind: "immutable_version",
    primaryKey: ["template_id", "version"],
    writable: true,
  },
  template_head: {
    table: "cp_a0_template_head",
    kind: "head",
    primaryKey: ["template_id"],
    versionColumn: "draft_version",
    writable: true,
  },
  artifact_version: {
    table: "cp_a0_artifact_version",
    kind: "immutable_version",
    primaryKey: ["project_id", "artifact_id", "version"],
    writable: true,
  },
  artifact_head: {
    table: "cp_a0_artifact_head",
    kind: "head",
    primaryKey: ["project_id", "artifact_id"],
    versionColumn: "draft_version",
    writable: true,
  },
  run: {
    table: "cp_a0_run",
    kind: "mutable_state",
    primaryKey: ["project_id", "run_id"],
    writable: true,
  },
  plan_version: {
    table: "cp_a0_plan_version",
    kind: "immutable_version",
    primaryKey: ["project_id", "run_id", "plan_version"],
    writable: true,
  },
  review_request: {
    table: "cp_a0_review_request",
    kind: "mutable_state",
    primaryKey: ["project_id", "run_id", "review_id"],
    writable: true,
  },
  content_decision: {
    table: "cp_a0_content_decision",
    kind: "append_only",
    primaryKey: ["project_id", "run_id", "decision_id"],
    writable: true,
  },
  trusted_confirmation: {
    table: "cp_a0_trusted_confirmation",
    kind: "append_only",
    primaryKey: ["project_id", "run_id", "confirmation_id"],
    writable: true,
  },
  execution_grant: {
    table: "cp_a0_execution_grant",
    kind: "mutable_state",
    primaryKey: ["project_id", "run_id", "grant_id"],
    writable: true,
  },
  step_attempt: {
    table: "cp_a0_step_attempt",
    kind: "mutable_state",
    primaryKey: ["project_id", "run_id", "plan_version", "step_id", "attempt"],
    writable: true,
  },
  approval: {
    table: "cp_a0_approval",
    kind: "mutable_state",
    primaryKey: ["project_id", "run_id", "approval_id"],
    writable: true,
  },
  prepared_authorization: {
    table: "cp_a0_prepared_authorization",
    kind: "append_only",
    primaryKey: ["transaction_id"],
    writable: true,
  },
  bootstrap_command: {
    table: "cp_a0_bootstrap_command",
    kind: "append_only",
    primaryKey: ["principal_id", "operation", "idempotency_key"],
    writable: true,
  },
  project_origin: {
    table: "cp_a0_project_origin",
    kind: "append_only",
    primaryKey: ["project_id"],
    writable: true,
  },
  native_ack: {
    table: "cp_a0_native_ack",
    kind: "append_only",
    primaryKey: ["project_id", "editor_session_id", "ack_seq"],
    writable: true,
  },
  event: {
    table: "cp_a0_event",
    kind: "append_only",
    primaryKey: ["project_id", "event_id"],
    writable: false,
  },
} as const satisfies { readonly [K in ProductCollection]: ProductCollectionSpec<K> };

/** The literal `kind` of a collection. */
export type ProductCollectionKindOf<K extends ProductCollection> =
  (typeof PRODUCT_COLLECTIONS)[K]["kind"];

/**
 * The collections advanced by a compare-and-set on their version column.
 *
 * The list is written out rather than derived from the collection kinds. A derived
 * conditional type over the descriptor literal resolves to `never` for exactly the
 * reason it looks like it should work — the kind of bug that silently turns
 * `compareAndSet` into a function that accepts nothing.
 */
export const PRODUCT_HEAD_COLLECTIONS = [
  "intake_head",
  "question_head",
  "answer_head",
  "template_head",
  "artifact_head",
] as const;

export type ProductHeadCollection = (typeof PRODUCT_HEAD_COLLECTIONS)[number];

/**
 * The collections that may only be appended, never updated.
 *
 * These are the immutable version families and the append-only fact rows.
 */
export const PRODUCT_APPEND_ONLY_COLLECTIONS = [
  "intake_version",
  "question_version",
  "answer_version",
  "template_version",
  "artifact_version",
  "plan_version",
  "intake_content_decision",
  "intake_confirmation",
  "content_decision",
  "trusted_confirmation",
  "prepared_authorization",
  "bootstrap_command",
  "project_origin",
  "native_ack",
] as const;

export type ProductAppendOnlyCollection = (typeof PRODUCT_APPEND_ONLY_COLLECTIONS)[number];

/* -------------------------------------------------------------------------------------- */
/* Events                                                                                 */
/* -------------------------------------------------------------------------------------- */

export type ProductEventTopic =
  | "creative.intake.versioned"
  | "creative.question.versioned"
  | "creative.answer.recorded"
  | "creative.input.invalidated"
  | "creative.content.decision.recorded"
  | "creative.artifact.versioned"
  | "workflow.run.prepared"
  | "workflow.run.authorized"
  | "workflow.run.state_changed"
  | "workflow.gate.changed"
  | "review.package.published"
  | "review.decision.recorded";

export type ProductEventEntityType = "task" | "artifact" | "decision" | "job" | "project" | "health";

export interface ProductEventEntity {
  readonly type: ProductEventEntityType;
  readonly id: string;
  readonly version: number;
  readonly state: string;
}

/**
 * The scope an event belongs to.
 *
 * `run` scope has a project, a run, a plan version and a run scope digest; MAIN mirrors
 * the event into `cp_a0_event`. `project` scope is for project-scoped facts that are not
 * part of a run (an artifact version, for example). `intake` scope is the pre-project case
 * (intake, questions, answers, relay decisions). Both non-run scopes reach the
 * authoritative `outbox` only: `cp_a0_event.run_id` is a mandatory foreign key onto
 * `cp_a0_run`, so there is nothing to mirror them into.
 */
export type ProductEventScope =
  | {
      readonly kind: "run";
      readonly project_id: string;
      readonly run_id: string;
      readonly run_scope_digest: string;
      readonly plan_version: 1;
    }
  | {
      readonly kind: "project";
      readonly project_id: string;
    }
  | {
      readonly kind: "intake";
      readonly intake_id: string;
      readonly intake_version: number;
      readonly brief_sha256: string;
    };

export interface ProductEvent {
  readonly topic: ProductEventTopic;
  readonly source: "host" | "worker" | "native";
  readonly scope: ProductEventScope;
  readonly entity: ProductEventEntity;
  readonly attempt: number;
  readonly input_digest: string;
  readonly observed_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ProductEventReceipt {
  readonly event_id: number;
  readonly topic: ProductEventTopic;
  readonly observed_at: string;
}

/* -------------------------------------------------------------------------------------- */
/* Idempotency                                                                            */
/* -------------------------------------------------------------------------------------- */

/**
 * The scope of an idempotency key.
 *
 * `project` scope is MAIN's existing `operation_idempotency(project_id, operation_kind,
 * idempotency_key)`. `principal` scope is the pre-project case: the same table with a
 * principal namespace, because a project does not exist yet. `cp_a0_bootstrap_command` is
 * only for `project.create`, so it cannot carry intake or question commands; see request
 * 003 for the namespace MAIN has to apply.
 */
export type ProductIdempotencyScope =
  | { readonly kind: "project"; readonly project_id: string }
  | { readonly kind: "principal"; readonly principal_id: string };

export interface ProductIdempotencyReceipt {
  readonly operation: string;
  readonly principal_id: string;
  readonly project_id: string | null;
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly correlation_id: string;
}

/** A stored idempotency entry: the receipt plus the response that was returned. */
export interface ProductIdempotencyEntry {
  readonly receipt: ProductIdempotencyReceipt;
  readonly response: unknown;
}

/* -------------------------------------------------------------------------------------- */
/* Transaction                                                                            */
/* -------------------------------------------------------------------------------------- */

export interface ProductWriteOutcome<K extends ProductCollection> {
  readonly record: ProductRecords[K];
  readonly replayed: boolean;
}

export interface ProductTransaction {
  get<K extends ProductCollection>(collection: K, key: ProductRecordKeys[K]): ProductRecords[K] | null;

  list<K extends ProductCollection>(collection: K, scope: ProductRecordScopes[K]): ProductRecords[K][];

  /**
   * Writes one row.
   *
   * Append-only collections insert; an existing identical row is a replay
   * (`replayed: true`), an existing different row is `IDEMPOTENCY_CONFLICT`. Mutable-state
   * collections replace the mutable columns and must refuse a change to the immutable
   * binding columns. Head collections must be written through `compareAndSet`.
   */
  put<K extends ProductCollection>(
    collection: K,
    key: ProductRecordKeys[K],
    value: ProductRecords[K],
  ): ProductWriteOutcome<K>;

  /** Advances a head. `expectedVersion = 0` means the head row does not exist yet. */
  compareAndSet<K extends ProductHeadCollection>(
    collection: K,
    key: ProductRecordKeys[K],
    expectedVersion: number,
    value: ProductRecords[K],
  ): ProductWriteOutcome<K>;

  /**
   * Recalls the stored receipt and response for an idempotency key.
   *
   * The recall has to happen inside the caller's transaction so that a concurrent replay
   * cannot slip between the recall and the write.
   */
  recallIdempotency(
    scope: ProductIdempotencyScope,
    operation: string,
    idempotencyKey: string,
  ): ProductIdempotencyEntry | null;

  /**
   * Records the receipt and the response inside the caller's transaction.
   *
   * The stored response is what a replay returns, so a replayed answer keeps its original
   * timestamp instead of minting a new one.
   */
  recordIdempotency(
    scope: ProductIdempotencyScope,
    operation: string,
    idempotencyKey: string,
    receipt: ProductIdempotencyReceipt,
    response: unknown,
  ): void;

  /**
   * Appends the event to MAIN's authoritative outbox inside this transaction and returns
   * the assigned event id.
   */
  emit(event: ProductEvent): ProductEventReceipt;
}

export interface ProductRepository {
  /**
   * Runs `work` inside one serialized transaction.
   *
   * The callback is synchronous so MAIN can hold the write lock across every record, the
   * idempotency receipt and the outbox event. A failure anywhere rolls all of it back.
   */
  transaction<T>(work: (tx: ProductTransaction) => T): Promise<T>;
}

/* -------------------------------------------------------------------------------------- */
/* Trusted authority                                                                       */
/* -------------------------------------------------------------------------------------- */

/**
 * The runtime brand of an out-of-band caller context.
 *
 * It is a real symbol, not a type-only declaration: the services check it at runtime, so
 * a context assembled from a request body is refused even if it type-checks.
 */
export const TrustedContextBrand: unique symbol = Symbol("narralens.trustedCallerContext");

export interface TrustedCallerContext {
  readonly [TrustedContextBrand]: true;
  readonly principal_id: string;
  readonly channel: "authenticated" | "trusted_ui" | "native_bridge";
  readonly source: "agent_conversation" | "driver_relay" | "trusted_ui";
  readonly session_ref: string;
}

/**
 * The runtime check for a caller context.
 *
 * `value[TrustedContextBrand] === true` can only be produced by
 * `createTrustedCallerContext`, which lives in `trusted-context.ts` and is called by
 * MAIN's dispatcher after it authenticated the session.
 */
export function isTrustedCallerContext(value: unknown): value is TrustedCallerContext {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[TrustedContextBrand] === true
  );
}

export interface TrustedAdoptionAuthority {
  /** Host-only same-DB review scope. The concrete authority holds actual prepared
   * read capabilities until the synchronous review/approval transaction completes. */
  reviewTransaction?<T>(input: ReviewDecisionInput, caller: TrustedCallerContext,
    work: (tx: ProductTransaction, preparedPlanDigest: string | null) => T): Promise<T>;

  /**
   * Registers the trusted confirmation for this exact action inside the caller's
   * transaction.
   */
  registerConfirmation(
    tx: ProductTransaction,
    input: TrustedConfirmationInput,
  ): TrustedConfirmationRecord;

  /**
   * Registers the limited adoption approval inside the same transaction.
   *
   * Returns `null` when MAIN cannot join the review transaction; the lane then fails the
   * adoption closed instead of pretending it was approved.
   */
  registerApproval(
    tx: ProductTransaction,
    input: TrustedApprovalInput,
  ): ApprovalRecord | null;
}

export interface TrustedConfirmationInput {
  readonly project_id: string;
  readonly run_id: string;
  readonly review_id: string | null;
  readonly input_digest: string;
  readonly purpose: "run.authorize" | "review" | "change.approve";
  readonly authenticated_actor: string;
  readonly session_ref: string;
  readonly action_digest: string;
  readonly issued_at: number;
  readonly expires_at: number;
}

export interface TrustedApprovalInput {
  readonly project_id: string;
  readonly run_id: string;
  readonly run_scope_digest: string;
  readonly confirmation_id: string;
  readonly plan_version: 1;
  readonly step_id: string;
  readonly attempt: number;
  readonly input_digest: string;
  readonly change_id: string;
  readonly impact_id: string;
  readonly base_revision: number;
  readonly control_revision: number;
  readonly action_digest: string;
  readonly facts_digest: string;
  readonly expires_at: number;
}

/* -------------------------------------------------------------------------------------- */
/* Wire projections                                                                       */
/* -------------------------------------------------------------------------------------- */

/**
 * Projects the wire `Approval` DTO from the stored approval row.
 *
 * `expires_at` is stored in epoch seconds (the SQL column is INTEGER) and projected as
 * ISO-8601.
 */
export function toWireApproval(record: ApprovalRecord): Approval {
  return {
    approval_id: record.approval_id,
    project_id: record.project_id,
    impact_id: record.impact_id,
    plan_sha256: record.action_digest,
    expires_at: epochSecondsToIso(record.expires_at),
    state: record.state,
  };
}

export function toWireContentDecision(
  record: IntakeContentDecisionRecord,
  projectId: string | null,
): ContentDecision {
  return {
    decision_id: record.decision_id,
    project_id: projectId,
    intake_id: record.intake_id,
    intake_version: record.intake_version,
    input_digest: record.input_digest,
    request_id: record.request_id,
    choice: record.choice,
    source: record.source,
    source_message_ref: record.source_message_ref,
    recorded_at: record.recorded_at,
    authority: record.authority,
  };
}

export function toWireRunAuthorization(
  record: ExecutionGrantRecord,
  scope: RunScope,
  scopeDigest: string,
  decisionId: string,
  issuedAt: number,
): RunAuthorization {
  return {
    authorization_id: record.grant_id,
    scope,
    scope_digest: scopeDigest,
    principal_id: record.principal_id,
    decision_id: decisionId,
    state: record.state,
    issued_at: epochSecondsToIso(issuedAt),
    expires_at: epochSecondsToIso(record.expires_at),
    channel: "trusted_ui",
  };
}

export function toWireArtifactContent(record: ArtifactVersionRecord): ArtifactContent | null {
  const content = record.content_json;
  if (!("kind" in content)) return null;
  if (content.kind === "script" || content.kind === "storyboard") return content;
  return null;
}

export function reviewImpactOf(packageDocument: ReviewPackage): Change | null {
  return packageDocument.impact;
}
