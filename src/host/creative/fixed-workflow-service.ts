/**
 * The PRODUCT lane's fixed-workflow service: the `local-short-film@1` run, its gates and
 * its review packages.
 *
 * The rules this module implements, all of them from the frozen contract:
 *
 * - **The plan is fixed.** There is no graph editing, no stability exemption and no model
 *   write. The plan is the golden `fixedPlan`, and its canonical digest has to be the
 *   published `execution_digest` before anything is prepared.
 * - **The scope is computed, never taken.** The client states the inputs; the server
 *   assembles the scope, the capabilities and the digests. A client cannot widen its own
 *   scope.
 * - **A gate is a decision.** The service records gates and their outcomes; it never
 *   accepts one on the user's behalf and never marks progress that did not happen.
 * - **The sample gate comes before the first chapter, and the first chapter before the
 *   chapters.** A chapter package published before the first chapter is accepted is
 *   refused, and an audio-only package never satisfies the chapter gate.
 * - **A pure review grants nothing.** `accept` produces a decision and no approval.
 *   `accept_and_adopt` needs MAIN's transaction-aware approval authority; when MAIN
 *   cannot join the transaction the adoption fails closed.
 */

import { randomUUID } from "node:crypto";
import type {
  Change,
  Brief,
  FixedWorkflowVersion,
  Ref,
  ReviewDecision,
  ReviewDecisionInput,
  ReviewPackage,
  ReviewPart,
  ReviewRead,
  RunAuthorization,
  RunAuthorize,
  RunCommand,
  RunGate,
  RunPrepare,
  RunRead,
  RunScope,
  Workflow,
  WorkflowNode,
  WorkflowRun,
} from "../../contracts/agent-driven-types.js";
import { validateAgentDefinition, validateAgentRouteInput, validateAgentRouteOutput } from "../../contracts/agent-driven-validator.js";
import { nowEpochSeconds } from "./time.js";
import { assertIntakeOwner, creativeInputClosure } from "./creative-closure.js";
import { assertBriefConsistency } from "./creative-service.js";
import {
  canonicalDigest,
  contentDigest,
  FIXED_PLAN,
  FIXED_PLAN_EXECUTION_DIGEST,
} from "./digest.js";
import {trustedGrantConfirmation} from './trusted-grant.js';
import { assertAbleScope } from "./execution-guard.js";
import { assertProjectFacts, requireFactPort, type ProductFactPort } from "./product-facts.js";
import type {
  ArtifactVersionRecord,
  ExecutionGrantRecord,
  ProductIdempotencyReceipt,
  ProductRepository,
  ProductTransaction,
  ReviewRequestRecord,
  RunCheckpoint,
  RunRecord,
  StepAttemptRecord,
  TrustedAdoptionAuthority,
  TrustedCallerContext,
  TrustedConfirmationRecord,
} from "./product-repository.js";
import { isTrustedCallerContext, isTrustedUi, ProductError } from "./trusted-context.js";

/** The operations the lane records idempotency receipts for. */
export const WORKFLOW_OPERATIONS = {
  runPrepare: "workflow.run.prepare",
  runAuthorize: "workflow.run.authorize",
  runStart: "workflow.run.start",
  runPause: "workflow.run.pause",
  runResume: "workflow.run.resume",
  runCancel: "workflow.run.cancel",
  reviewDecide: "review.decide",
  stepAttempt: "workflow.step.attempt",
} as const;

/** The fixed A template, as the frozen wire object. */
export const FIXED_WORKFLOW_VERSION: FixedWorkflowVersion = {
  template_id: "local-short-film",
  template_version: 1,
  execution_digest: FIXED_PLAN_EXECUTION_DIGEST,
  stage_ids: ["definition", "sample", "first_chapter", "chapters", "cover", "delivery"],
  capability_ids: ["clip.prepare", "snapshot.render", "qc.inspect", "delivery.package"],
  status: "published",
  composition: "fixed_a",
};

/** The gates a run starts with, in the order the fixed plan reaches them. */
export const RUN_GATE_KINDS: ReadonlyArray<RunGate["kind"]> = [
  "definition",
  "sample",
  "first_chapter",
  "chapter_pack",
  "cover",
  "qc",
  "adoption",
];

/** The stage that produces each gate. */
export const GATE_STAGE: Readonly<Record<RunGate["kind"], string>> = {
  definition: "definition",
  sample: "sample",
  first_chapter: "first_chapter",
  chapter_pack: "chapters",
  cover: "cover",
  qc: "delivery",
  adoption: "delivery",
  risk: "sample",
};

const STAGE_GATE = {
  definition: "definition", sample: "sample", first_chapter: "first_chapter",
  chapters: "chapter_pack", cover: "cover", delivery: "qc",
} as const;

/**
 * The gate a package kind may satisfy.
 *
 * An `audio` package satisfies **no** gate: it is a supplementary review of one part of a
 * chapter, and letting it stand in for the chapter would let a chapter pass its gate
 * without a picture.
 */
export const PACKAGE_GATE: Readonly<Record<ReviewPackage["kind"], RunGate["kind"] | null>> = {
  sample: "sample",
  first_chapter: "first_chapter",
  chapter_pack: "chapter_pack",
  audio: null,
  cover: "cover",
};

/** The wire package kind to the `cp_a0_review_request.gate` value. */
export const PACKAGE_REVIEW_GATE: Readonly<Record<ReviewPackage["kind"], ReviewRequestRecord["gate"]>> = {
  sample: "sample",
  first_chapter: "first_chapter",
  chapter_pack: "chapter",
  audio: "chapter",
  cover: "cover",
};

/** The wire package kind to the artifact kind that stores its body. */
export const PACKAGE_ARTIFACT_KIND: Readonly<Record<ReviewPackage["kind"], "chapter" | "cover">> = {
  sample: "chapter",
  first_chapter: "chapter",
  chapter_pack: "chapter",
  audio: "chapter",
  cover: "cover",
};

/** The part kinds a chapter-level package has to carry. */
export const CHAPTER_PART_KINDS: ReadonlyArray<ReviewPart["kind"]> = [
  "preview",
  "narration",
  "subtitles",
  "shot_summary",
  "rights_quality",
];

/** The slug of the capability a stage uses. The wire vocabulary has no dots. */
export const CAPABILITY_SLUG = {
  definition: "clip_prepare",
  sample: "clip_prepare",
  first_chapter: "clip_prepare",
  chapters: "snapshot_render",
  cover: "snapshot_render",
  delivery: "delivery_package",
} as const;

/** Shared unchanged input shape for async entry and same-transaction composition. */
export type RecordStepAttemptInput = {
  project_id: string;
  run_id: string;
  plan_version: 1;
  step_id: string;
  attempt: number;
  grant_id: string;
  input_digest: string;
  state: StepAttemptRecord["state"];
  job_id?: string | null;
  output_artifact_id?: string | null;
  output_version?: number | null;
  input_refs?: ReadonlyArray<Ref>;
  output_refs?: ReadonlyArray<Ref>;
  observed_at: string;
};

/** The publication input of a review package. */
export interface PublishReviewPackageInput {
  readonly project_id: string;
  readonly run_id: string;
  readonly package_id: string;
  readonly kind: ReviewPackage["kind"];
  readonly chapter_id: string | null;
  readonly input_digest: string;
  readonly output_digest: string;
  readonly quality_digest: string;
  readonly parts: ReviewPart[];
  readonly source_shot_ids: string[];
  readonly selection_reason: string;
  readonly allowed_choices: ReviewPackage["allowed_choices"];
  readonly impact?: Change | null;
  readonly reuse_of_package_id?: string | null;
  /**
   * The durable step attempt that produced the package.
   *
   * The publication has to name a real attempt, and the attempt has to be the current one
   * of its step: a package that comes from a cancelled, stale or superseded attempt
   * cannot advance a gate.
   */
  readonly step_id: string;
  readonly attempt: number;
}

export interface FixedWorkflowServiceOptions {
  readonly repository: ProductRepository;
  /**
   * MAIN's trusted adoption authority.
   *
   * `workflow.run.authorize` and `review.decide` need it: the trusted confirmation and
   * the limited approval are written by MAIN inside the lane's transaction. Without the
   * authority those operations fail closed rather than record an approval nobody made.
   */
  readonly adoption?: TrustedAdoptionAuthority;
  /**
   * MAIN's read-only project facts.
   *
   * The lane cannot verify the project, the material rights or the registered capability
   * on its own, and it does not guess: without the port a run cannot be prepared.
   */
  readonly facts?: ProductFactPort;
  /** The clock, in epoch seconds. */
  readonly now?: () => number;
  /** How long a run authorization stays valid, in seconds. */
  readonly authorizationTtlSeconds?: number;
}

export class FixedWorkflowService {
  readonly #repository: ProductRepository;
  readonly #adoption: TrustedAdoptionAuthority | undefined;
  readonly #facts: ProductFactPort | undefined;
  readonly #now: () => number;
  readonly #authorizationTtl: number;

  constructor(options: FixedWorkflowServiceOptions) {
    this.#repository = options.repository;
    this.#adoption = options.adoption;
    this.#facts = options.facts;
    this.#now = options.now ?? nowEpochSeconds;
    this.#authorizationTtl = options.authorizationTtlSeconds ?? 3600;
  }

  /* ------------------------------------------------------------------------------------ */
  /* Run                                                                                   */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Prepares a candidate run.
   *
   * Preparing binds an **accepted** content decision, the current creative closure, the
   * resolved inputs and the fixed template. It does not dispatch anything: the run
   * starts in `ready`, and only an authorized start may move it on.
   *
   * The gates start with the definition already accepted — the content decision is the
   * definition's evidence — so no gate is left pending with no way to complete it.
   */
  async prepareRun(input: RunPrepare, caller: TrustedCallerContext): Promise<WorkflowRun> {
    const request = validateAgentRouteInput("workflow.run.prepare", input);
    this.#requireContext(caller);
    const facts = requireFactPort(this.#facts);
    const digest = contentDigest(request);

    const projectFacts = await facts.readProjectFacts(request.project_id);
    assertProjectFacts(projectFacts, request.project_id);

    return this.#repository.transaction((tx) => {
      const stored = tx.recallIdempotency(
        { kind: "project", project_id: request.project_id },
        WORKFLOW_OPERATIONS.runPrepare,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput("workflow.run.prepare", stored.response) as WorkflowRun;
      }

      const decision = tx.get("intake_content_decision", { decision_id: request.intake_decision_id });
      if (decision === null) {
        throw new ProductError("NOT_FOUND", "No such content decision", {
          details: { intake_decision_id: request.intake_decision_id },
        });
      }
      if (decision.choice !== "accept_content") {
        throw new ProductError(
          "REVIEW_STALE",
          "Only an accepted content decision can start a run",
          { details: { choice: decision.choice } },
        );
      }

      const head = tx.get("intake_head", { intake_id: decision.intake_id });
      const currentVersion = head?.current_version ?? 0;
      if (decision.intake_version !== currentVersion) {
        throw new ProductError(
          "REVIEW_STALE",
          "The content decision was made against an older brief version",
          { details: { expected: currentVersion, received: decision.intake_version } },
        );
      }

      assertIntakeOwner(tx, decision.intake_id, caller.principal_id);
      const closure = creativeInputClosure(tx, decision.intake_id, decision.intake_version);
      const closureDigest = canonicalDigest(closure);
      if (decision.input_digest !== closureDigest) {
        throw new ProductError("REVIEW_STALE", "The content decision was made against a different input", {
          details: { expected: closureDigest, received: decision.input_digest },
        });
      }
      if (request.input_digest !== closureDigest) {
        throw new ProductError("REVIEW_STALE", "The run input is not the current creative closure", {
          details: { expected: closureDigest, received: request.input_digest },
        });
      }
      this.#assertNoMandatoryQuestionOpen(tx, decision.intake_id, decision.intake_version);

      const brief = tx.get("intake_version", {
        intake_id: decision.intake_id,
        version: decision.intake_version,
      });
      if (brief === null) {
        throw new ProductError("NOT_FOUND", "The brief version of the decision is gone");
      }
      assertBriefConsistency(brief.content_json);

      this.#assertRefResolves(tx, request.project_id, request.style_ref, "style", brief.content_json);
      for (const ref of request.input_refs) {
        this.#assertRefResolves(tx, request.project_id, ref, "input");
      }
      const scriptRef = brief.content_json.content_brief.script_ref;
      if (scriptRef !== null) {
        this.#assertRefResolves(tx, request.project_id, scriptRef, "script");
        if (!request.input_refs.some((ref) => canonicalDigest(ref) === canonicalDigest(scriptRef))) {
          throw new ProductError("REVIEW_STALE", "The confirmed script is missing from the run inputs");
        }
      }

      const runId = `run-${randomUUID()}`;
      const scope: RunScope = {
        project_id: request.project_id,
        run_id: runId,
        plan_version: 1,
        template_id: request.template_id,
        template_version: request.template_version,
        execution_digest: FIXED_PLAN_EXECUTION_DIGEST,
        input_digest: closureDigest,
        content_type: request.content_type,
        style_ref: request.style_ref,
        capability_fingerprint: projectFacts.capability_fingerprint,
        allowed_actions: [
          "clip.prepare",
          "snapshot.render",
          "qc.inspect",
          "delivery.package",
          "change.prepare",
          "change.apply",
        ],
        allow_paid: false,
        allow_external_write: false,
        allow_runtime_mutation: false,
      };
      assertAbleScope(scope);
      const scopeDigest = canonicalDigest(scope);

      const now = this.#now();
      const createdAt = new Date(now * 1000).toISOString();

      this.#ensureTemplate(tx, createdAt);

      const checkpoint: RunCheckpoint = {
        workflow_revision: 1,
        observed_at: createdAt,
        gates: RUN_GATE_KINDS.map((kind) => ({
          gate_id: `gate-${kind}`,
          kind,
          // The definition is the content decision itself, so it starts accepted. Every
          // other gate is waiting for a review that has not happened yet.
          state: kind === "definition" ? ("accepted" as const) : ("pending" as const),
          chapter_id: null,
          review_package_id: null,
          decision_id: kind === "definition" ? decision.decision_id : null,
          input_digest: closureDigest,
          output_digest: null,
          reuse_of_gate_id: null,
          reason: kind === "definition" ? "bound_to_content_decision" : "waiting_for_step",
        })),
        attempts: [],
        review_packages: [],
      };

      const run: RunRecord = {
        project_id: request.project_id,
        run_id: runId,
        run_scope_digest: scopeDigest,
        template_id: request.template_id,
        template_version: request.template_version,
        current_plan_version: 1,
        state: "ready",
        scope_json: scope,
        checkpoint_json: checkpoint,
        created_at: createdAt,
      };
      tx.put("run", { project_id: request.project_id, run_id: runId }, run);
      tx.put("plan_version", {
        project_id: request.project_id,
        run_id: runId,
        plan_version: 1,
      }, {
        project_id: request.project_id,
        run_id: runId,
        plan_version: 1,
        run_scope_digest: scopeDigest,
        input_digest: closureDigest,
        plan_json: FIXED_PLAN,
        created_at: createdAt,
      });

      tx.emit({
        topic: "workflow.run.prepared",
        source: "host",
        scope: {
          kind: "run",
          project_id: request.project_id,
          run_id: runId,
          run_scope_digest: scopeDigest,
          plan_version: 1,
        },
        entity: { type: "project", id: runId, version: 1, state: "ready" },
        attempt: 0,
        input_digest: closureDigest,
        observed_at: createdAt,
        payload: {
          run_id: runId,
          scope_digest: scopeDigest,
          intake_decision_id: request.intake_decision_id,
          input_refs: request.input_refs,
        },
      });

      const workflowRun = this.#projectRun(tx, run);
      const receipt = this.#receipt(WORKFLOW_OPERATIONS.runPrepare, caller, request.meta, digest, request.project_id);
      tx.recordIdempotency(
        { kind: "project", project_id: request.project_id },
        WORKFLOW_OPERATIONS.runPrepare,
        request.meta.idempotency_key,
        receipt,
        workflowRun,
      );
      return workflowRun;
    });
  }

  /**
   * Authorizes a run.
   *
   * The authorization is a trusted-UI act: MAIN registers the trusted confirmation inside
   * this transaction and the lane writes the grant row bound to it. A rejection is
   * recorded as a revoked grant, so the run stays unauthorized and the reason survives.
   */
  async authorizeRun(input: RunAuthorize, caller: TrustedCallerContext): Promise<RunAuthorization> {
    const request = validateAgentRouteInput("workflow.run.authorize", input);
    this.#requireTrustedUi(caller);
    const adoption = this.#adoption;
    if (adoption === undefined) {
      throw new ProductError("APPROVAL_REQUIRED", "No trusted adoption authority is registered");
    }
    const digest = contentDigest(request);

    return this.#repository.transaction((tx) => {
      const stored = tx.recallIdempotency(
        { kind: "project", project_id: request.project_id },
        WORKFLOW_OPERATIONS.runAuthorize,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput("workflow.run.authorize", stored.response) as RunAuthorization;
      }

      const run = this.#requireRun(tx, request.project_id, request.run_id);
      if (run.run_scope_digest !== request.scope_digest) {
        throw new ProductError("RUN_PLAN_STALE", "The authorization is bound to a different scope", {
          details: { expected: run.run_scope_digest, received: request.scope_digest },
        });
      }
      if (run.state === "cancelled") {
        throw new ProductError("RUN_PLAN_STALE", "The run was cancelled", { details: { state: run.state } });
      }

      const issuedAt = this.#now();
      const expiresAt = issuedAt + this.#authorizationTtl;
      const confirmation = adoption.registerConfirmation(tx, {
        project_id: request.project_id,
        run_id: request.run_id,
        review_id: null,
        input_digest: run.scope_json.input_digest,
        purpose: "run.authorize",
        authenticated_actor: caller.principal_id,
        session_ref: caller.session_ref,
        action_digest: run.run_scope_digest,
        issued_at: issuedAt,
        expires_at: expiresAt,
      });
      this.#assertConfirmation(confirmation, {
        project_id: request.project_id,
        run_id: request.run_id,
        purpose: "run.authorize",
        actor: caller.principal_id,
        action_digest: run.run_scope_digest,
        issued_at: issuedAt,
        expires_at: expiresAt,
      });

      const grantId = `grant-${randomUUID()}`;
      const authorized = request.choice === "authorize";
      const grant: ExecutionGrantRecord = {
        project_id: request.project_id,
        run_id: request.run_id,
        grant_id: grantId,
        run_scope_digest: run.run_scope_digest,
        confirmation_id: confirmation.confirmation_id,
        principal_id: caller.principal_id,
        action: "clip.prepare",
        capability_id: "clip.prepare",
        capability_version: "1",
        allow_paid: 0,
        allow_external: 0,
        state: authorized ? "active" : "revoked",
        expires_at: expiresAt,
      };
      tx.put("execution_grant", {
        project_id: request.project_id,
        run_id: request.run_id,
        grant_id: grantId,
      }, grant);

      const authorization = validateAgentRouteOutput("workflow.run.authorize", {
        authorization_id: grantId,
        scope: run.scope_json,
        scope_digest: run.run_scope_digest,
        principal_id: caller.principal_id,
        decision_id: confirmation.confirmation_id,
        state: authorized ? "active" : "revoked",
        issued_at: new Date(issuedAt * 1000).toISOString(),
        expires_at: new Date(expiresAt * 1000).toISOString(),
        channel: "trusted_ui",
      }) as RunAuthorization;

      const receipt = this.#receipt(WORKFLOW_OPERATIONS.runAuthorize, caller, request.meta, digest, request.project_id);
      tx.recordIdempotency(
        { kind: "project", project_id: request.project_id },
        WORKFLOW_OPERATIONS.runAuthorize,
        request.meta.idempotency_key,
        receipt,
        authorization,
      );
      return authorization;
    });
  }

  /** Reads a run. */
  async readRun(input: RunRead, caller: TrustedCallerContext): Promise<WorkflowRun> {
    const request = validateAgentRouteInput("workflow.run.read", input);
    this.#requireContext(caller);
    return this.#repository.transaction((tx) => {
      const run = this.#requireRun(tx, request.project_id, request.run_id);
      return this.#projectRun(tx, run);
    });
  }

  /**
   * Starts the run.
   *
   * Starting needs an active, unexpired grant whose scope digest matches the run and
   * whose principal is the one asking. It moves the run to `running`; it does not dispatch
   * a step and it does not accept a gate — the dispatch itself goes through
   * `guardExecutionInTransaction`.
   */
  async startRun(input: RunCommand, caller: TrustedCallerContext): Promise<WorkflowRun> {
    return this.#command(input, caller, "workflow.run.start", WORKFLOW_OPERATIONS.runStart, "running");
  }

  /** Pauses the run. Pausing only stops further dispatch; it does not kill work. */
  async pauseRun(input: RunCommand, caller: TrustedCallerContext): Promise<WorkflowRun> {
    return this.#command(input, caller, "workflow.run.pause", WORKFLOW_OPERATIONS.runPause, "paused");
  }

  /** Resumes the run. Resuming re-checks the scope, the grant and the gates. */
  async resumeRun(input: RunCommand, caller: TrustedCallerContext): Promise<WorkflowRun> {
    return this.#command(input, caller, "workflow.run.resume", WORKFLOW_OPERATIONS.runResume, "running");
  }

  /** Cancels the run. Cancelling is a safe control: it is allowed even without a grant. */
  async cancelRun(input: RunCommand, caller: TrustedCallerContext): Promise<WorkflowRun> {
    return this.#command(input, caller, "workflow.run.cancel", WORKFLOW_OPERATIONS.runCancel, "cancelled");
  }

  async #command(
    input: RunCommand,
    caller: TrustedCallerContext,
    route: "workflow.run.start" | "workflow.run.pause" | "workflow.run.resume" | "workflow.run.cancel",
    operation: string,
    nextState: RunRecord["state"],
  ): Promise<WorkflowRun> {
    const request = validateAgentRouteInput(route, input);
    this.#requireContext(caller);
    const digest = contentDigest(request);
    const safeControl = route === "workflow.run.pause" || route === "workflow.run.cancel";

    return this.#repository.transaction((tx) => {
      const stored = tx.recallIdempotency(
        { kind: "project", project_id: request.project_id },
        operation,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput(route, stored.response) as WorkflowRun;
      }

      const run = this.#requireRun(tx, request.project_id, request.run_id);
      if (request.expected_plan_version !== run.current_plan_version) {
        throw new ProductError("RUN_PLAN_STALE", "The run moved on since this command was prepared", {
          details: { expected: run.current_plan_version, received: request.expected_plan_version },
        });
      }
      if (run.run_scope_digest !== request.run_scope_digest) {
        throw new ProductError("RUN_SCOPE_REQUIRED", "The command is bound to a different scope", {
          details: { expected: run.run_scope_digest, received: request.run_scope_digest },
        });
      }
      if (!safeControl) {
        this.#requireActiveGrant(tx, run, request.authorization_id, caller.principal_id);
      }
      if (run.state === "cancelled") {
        throw new ProductError("RUN_PLAN_STALE", "The run was cancelled", { details: { state: run.state } });
      }

      const now = this.#now();
      const updated = this.#withState(run, nextState, new Date(now * 1000).toISOString());
      tx.put("run", { project_id: run.project_id, run_id: run.run_id }, updated);

      tx.emit({
        topic: "workflow.run.state_changed",
        source: "host",
        scope: {
          kind: "run",
          project_id: run.project_id,
          run_id: run.run_id,
          run_scope_digest: run.run_scope_digest,
          plan_version: 1,
        },
        entity: { type: "project", id: run.run_id, version: run.current_plan_version, state: nextState },
        attempt: 0,
        input_digest: run.scope_json.input_digest,
        observed_at: updated.checkpoint_json.observed_at,
        payload: { run_id: run.run_id, from: run.state, to: nextState },
      });

      const workflowRun = this.#projectRun(tx, updated);
      const receipt = this.#receipt(operation, caller, request.meta, digest, request.project_id);
      tx.recordIdempotency(
        { kind: "project", project_id: request.project_id },
        operation,
        request.meta.idempotency_key,
        receipt,
        workflowRun,
      );
      return workflowRun;
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* Attempts                                                                              */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Records a step attempt from a genuine job event.
   *
   * MAIN calls this when a real attempt starts, progresses or finishes. The lane records
   * what MAIN observed; it never manufactures an attempt, a job or a progress step of its
   * own. The attempt row is the durable fact the execution guard later checks.
   */
  async recordStepAttempt(
    input: RecordStepAttemptInput,
    caller: TrustedCallerContext,
  ): Promise<WorkflowRun> {
    this.#requireContext(caller);
    return this.#repository.transaction(tx => this.recordStepAttemptInTransaction(tx, input, caller));
  }

  /** MAIN-only composition over an already-live ProductTransaction. Opens no transaction.
   * Caller must establish existing owner/Run/grant/job eligibility; this retains the
   * exact original attempt/checkpoint/event/projection rules, not a new state machine.
   */
  recordStepAttemptInTransaction(
    tx: ProductTransaction,
    input: RecordStepAttemptInput,
    caller: TrustedCallerContext,
  ): WorkflowRun {
    this.#requireContext(caller);
      const run = this.#requireRun(tx, input.project_id, input.run_id);
      const existing = tx.list("step_attempt", {
        project_id: input.project_id,
        run_id: input.run_id,
        step_id: input.step_id,
      }).find((candidate) => candidate.attempt === input.attempt);
      if (existing !== undefined) {
        const same = existing.input_digest === input.input_digest && existing.grant_id === input.grant_id;
        if (!same) {
          throw new ProductError("REVISION_CONFLICT", "The attempt was already recorded with other facts");
        }
        // The attempt exists; only its state advances. The binding columns are frozen,
        // exactly as the frozen trigger freezes them.
        const advanced: StepAttemptRecord = {
          ...existing,
          state: input.state,
          job_id: input.job_id ?? existing.job_id,
          output_artifact_id: input.output_artifact_id ?? existing.output_artifact_id,
          output_version: input.output_version ?? existing.output_version,
          updated_at: input.observed_at,
        };
        tx.put("step_attempt", {
          project_id: input.project_id,
          run_id: input.run_id,
          plan_version: input.plan_version,
          step_id: input.step_id,
          attempt: input.attempt,
        }, advanced);
        const advancedCheckpoint: RunCheckpoint = {
          ...run.checkpoint_json,
          workflow_revision: run.checkpoint_json.workflow_revision + 1,
          observed_at: input.observed_at,
          attempts: run.checkpoint_json.attempts.map((attempt) =>
            attempt.step_id === input.step_id && attempt.attempt === input.attempt
              ? {
                  ...attempt,
                  state: input.state,
                  job_id: advanced.job_id,
                  output_artifact_id: advanced.output_artifact_id,
                  output_version: advanced.output_version,
                  input_refs: [...(input.input_refs ?? attempt.input_refs)],
                  output_refs: [...(input.output_refs ?? attempt.output_refs)],
                }
              : attempt,
          ),
        };
        const advancedRun: RunRecord = { ...run, checkpoint_json: advancedCheckpoint };
        tx.put("run", { project_id: run.project_id, run_id: run.run_id }, advancedRun);
        tx.emit({
        topic: "workflow.run.state_changed",
        source: "worker",
        scope: {
          kind: "run",
          project_id: input.project_id,
          run_id: input.run_id,
          run_scope_digest: run.run_scope_digest,
          plan_version: input.plan_version,
        },
        entity: { type: "task", id: input.step_id, version: input.attempt, state: input.state },
        attempt: input.attempt,
        input_digest: input.input_digest,
        observed_at: input.observed_at,
        payload: { step_id: input.step_id, attempt: input.attempt, state: input.state, job_id: advanced.job_id },
      });

      return this.#projectRun(tx, advancedRun);
      }

      const record: StepAttemptRecord = {
        project_id: input.project_id,
        run_id: input.run_id,
        plan_version: input.plan_version,
        step_id: input.step_id,
        attempt: input.attempt,
        run_scope_digest: run.run_scope_digest,
        grant_id: input.grant_id,
        input_digest: input.input_digest,
        dependencies_json: [
          ...(FIXED_PLAN.stages.find((stage) => stage.id === input.step_id)?.after ?? []),
        ],
        state: input.state,
        job_id: input.job_id ?? null,
        output_artifact_id: input.output_artifact_id ?? null,
        output_version: input.output_version ?? null,
        updated_at: input.observed_at,
      };
      tx.put("step_attempt", {
        project_id: input.project_id,
        run_id: input.run_id,
        plan_version: input.plan_version,
        step_id: input.step_id,
        attempt: input.attempt,
      }, record);

      const checkpoint: RunCheckpoint = {
        ...run.checkpoint_json,
        workflow_revision: run.checkpoint_json.workflow_revision + 1,
        observed_at: input.observed_at,
        attempts: [
          ...run.checkpoint_json.attempts.filter(
            (attempt) => !(attempt.step_id === input.step_id && attempt.attempt === input.attempt),
          ),
          {
            step_id: input.step_id,
            attempt: input.attempt,
            state: input.state,
            input_digest: input.input_digest,
            job_id: record.job_id,
            output_artifact_id: record.output_artifact_id,
            output_version: record.output_version,
            input_refs: [...(input.input_refs ?? [])],
            output_refs: [...(input.output_refs ?? [])],
          },
        ],
      };
      const updated: RunRecord = { ...run, checkpoint_json: checkpoint };
      tx.put("run", { project_id: run.project_id, run_id: run.run_id }, updated);

      tx.emit({
        topic: "workflow.run.state_changed",
        source: "worker",
        scope: {
          kind: "run",
          project_id: input.project_id,
          run_id: input.run_id,
          run_scope_digest: run.run_scope_digest,
          plan_version: input.plan_version,
        },
        entity: { type: "task", id: input.step_id, version: input.attempt, state: input.state },
        attempt: input.attempt,
        input_digest: input.input_digest,
        observed_at: input.observed_at,
        payload: { step_id: input.step_id, attempt: input.attempt, state: input.state, job_id: record.job_id },
      });

      return this.#projectRun(tx, updated);
  }

  /* ------------------------------------------------------------------------------------ */
  /* Reviews                                                                              */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Publishes a review package.
   *
   * The package body is stored as an artifact version and the review request points at
   * it, so the review body and the content body share one immutable store. The run moves
   * to `waiting_user` while the package is pending — the package is a request for a
   * decision, never the decision itself.
   *
   * Publishing the same package again is a safe replay: the stored package is returned
   * and no state is reset. A package that names a different attempt, or that comes from a
   * cancelled or stale attempt, is refused.
   */
  async publishReviewPackage(
    input: PublishReviewPackageInput,
    caller: TrustedCallerContext,
  ): Promise<ReviewPackage> {
    this.#requireContext(caller);
    return this.#repository.transaction((tx) => this.publishReviewPackageInScope(tx, input, caller));
  }

  /**
   * The same publication inside a caller's own transaction scope.
   *
   * The published package, the immutable receipt linkage of its parts and the visible
   * result reference have to become visible together. A caller that has to write its
   * own facts in the same transaction as the publication needs the publication to run
   * in the scope it already owns, so the body of the publication is available here
   * without opening a second transaction.
   *
   * The caller owns the scope: this method neither opens nor closes one, and it never
   * catches an error that the scope has to roll back.
   */
  publishReviewPackageInScope(
    tx: ProductTransaction,
    input: PublishReviewPackageInput,
    caller: TrustedCallerContext,
  ): ReviewPackage {
    this.#requireContext(caller);
    return this.#publishReviewPackage(tx, input, caller);
  }

  #publishReviewPackage(
    tx: ProductTransaction,
    input: PublishReviewPackageInput,
    caller: TrustedCallerContext,
  ): ReviewPackage {
    {
      const run = this.#requireRun(tx, input.project_id, input.run_id);
      if (run.state === "cancelled") {
        throw new ProductError("RUN_PLAN_STALE", "The run was cancelled", { details: { state: run.state } });
      }
      if (input.input_digest !== run.scope_json.input_digest) {
        throw new ProductError("REVIEW_STALE", "The package is bound to a different run input", {
          details: { expected: run.scope_json.input_digest, received: input.input_digest },
        });
      }
      this.#assertPackageParts(input);
      this.#assertProducingAttempt(tx, run, input);
      this.#assertGatePrerequisites(run, input);
      const reuse = this.#assertReuse(tx, run, input);

      const now = this.#now();
      const createdAt = new Date(now * 1000).toISOString();
      const packageDocument: ReviewPackage = {
        project_id: input.project_id,
        run_id: input.run_id,
        plan_version: 1,
        package_id: input.package_id,
        version: 1,
        kind: input.kind,
        chapter_id: input.chapter_id,
        input_digest: input.input_digest,
        output_digest: input.output_digest,
        quality_digest: input.quality_digest,
        parts: input.parts,
        source_shot_ids: input.source_shot_ids,
        selection_reason: input.selection_reason,
        allowed_choices: input.allowed_choices,
        impact: input.impact ?? null,
        reuse_of_package_id: input.reuse_of_package_id ?? null,
        review_url: `/workbench/projects/${input.project_id}/reviews/${input.package_id}`,
        state: "pending",
      };
      const packageDigest = canonicalDigest(packageDocument);

      const existing = tx.get("review_request", {
        project_id: input.project_id,
        run_id: input.run_id,
        review_id: input.package_id,
      });
      if (existing !== null) {
        // A replay of the same publication returns what was stored and changes nothing.
        if (existing.package_digest === packageDigest) {
          return this.#readPackageDocument(tx, existing) as ReviewPackage;
        }
        throw new ProductError(
          "REVIEW_STALE",
          "The package was already published with different content",
          { details: { package_id: input.package_id } },
        );
      }

      const artifactId = input.package_id;
      const artifact: ArtifactVersionRecord = {
        project_id: input.project_id,
        artifact_id: artifactId,
        version: 1,
        kind: PACKAGE_ARTIFACT_KIND[input.kind],
        schema_version: 1,
        input_digest: input.input_digest,
        content_digest: packageDigest,
        content_json: packageDocument,
        input_refs_json: input.parts.map((part) => part.artifact_ref),
        created_at: createdAt,
      };
      tx.put("artifact_version", {
        project_id: input.project_id,
        artifact_id: artifactId,
        version: 1,
      }, artifact);
      tx.compareAndSet(
        "artifact_head",
        { project_id: input.project_id, artifact_id: artifactId },
        0,
        { project_id: input.project_id, artifact_id: artifactId, draft_version: 1 },
      );

      const review: ReviewRequestRecord = {
        project_id: input.project_id,
        run_id: input.run_id,
        review_id: input.package_id,
        plan_version: 1,
        run_scope_digest: run.run_scope_digest,
        gate: PACKAGE_REVIEW_GATE[input.kind],
        artifact_id: artifactId,
        artifact_version: 1,
        input_digest: input.input_digest,
        package_digest: packageDigest,
        state: "pending",
        reuse_review_id: input.reuse_of_package_id ?? null,
        created_at: createdAt,
      };
      tx.put("review_request", {
        project_id: input.project_id,
        run_id: input.run_id,
        review_id: input.package_id,
      }, review);

      const gateKind = PACKAGE_GATE[input.kind];
      const checkpoint: RunCheckpoint = {
        ...run.checkpoint_json,
        workflow_revision: run.checkpoint_json.workflow_revision + 1,
        observed_at: createdAt,
        review_packages: [
          ...run.checkpoint_json.review_packages.filter((entry) => entry.package_id !== input.package_id),
          {
            package_id: input.package_id,
            version: 1,
            kind: input.kind,
            chapter_id: input.chapter_id,
            input_digest: input.input_digest,
            output_digest: input.output_digest,
            quality_digest: input.quality_digest,
            state: "pending",
            reuse_of_package_id: input.reuse_of_package_id ?? null,
            reuse_of_gate_id: reuse?.gate_id ?? null,
            step_id: input.step_id,
            attempt: input.attempt,
          },
        ],
        gates: gateKind === null
          ? run.checkpoint_json.gates
          : run.checkpoint_json.gates.map((gate) =>
              gate.kind === gateKind && gate.state === "pending"
                ? {
                    ...gate,
                    review_package_id: input.package_id,
                    output_digest: input.output_digest,
                    reuse_of_gate_id: reuse?.gate_id ?? null,
                    reason: "waiting_for_decision",
                  }
                : gate,
            ),
      };
      const updated = this.#withCheckpoint(run, checkpoint, "waiting_user", createdAt);
      tx.put("run", { project_id: run.project_id, run_id: run.run_id }, updated);

      tx.emit({
        topic: "review.package.published",
        source: "host",
        scope: {
          kind: "run",
          project_id: input.project_id,
          run_id: input.run_id,
          run_scope_digest: run.run_scope_digest,
          plan_version: 1,
        },
        entity: { type: "artifact", id: input.package_id, version: 1, state: "pending" },
        attempt: input.attempt,
        input_digest: input.input_digest,
        observed_at: createdAt,
        payload: {
          package_id: input.package_id,
          kind: input.kind,
          gate: gateKind,
          package_digest: packageDigest,
          step_id: input.step_id,
          attempt: input.attempt,
        },
      });

      return validateAgentRouteOutput("review.read", packageDocument) as ReviewPackage;
    }
  }

  /** Reads a review package. */
  async readReview(input: ReviewRead, caller: TrustedCallerContext): Promise<ReviewPackage> {
    const request = validateAgentRouteInput("review.read", input);
    this.#requireContext(caller);
    return this.#repository.transaction((tx) => {
      const review = tx.get("review_request", {
        project_id: request.project_id,
        run_id: request.run_id,
        review_id: request.package_id,
      });
      if (review === null) {
        throw new ProductError("NOT_FOUND", "No such review package", {
          details: { package_id: request.package_id },
        });
      }
      return this.#readPackageDocument(tx, review) as ReviewPackage;
    });
  }

  /**
   * Records a review decision.
   *
   * `accept`, `changes_requested` and `reject` are pure reviews: they record a decision
   * and grant nothing. `accept_and_adopt` needs a current impact on the package, a real
   * durable attempt and MAIN's approval authority; when MAIN cannot join the
   * transaction the adoption fails closed with `APPROVAL_REQUIRED` and no decision is
   * written.
   */
  async decideReview(input: ReviewDecisionInput, caller: TrustedCallerContext): Promise<ReviewDecision> {
    const request = validateAgentRouteInput("review.decide", input);
    this.#requireTrustedUi(caller);
    const adoption = this.#adoption;
    if (adoption === undefined) {
      throw new ProductError("APPROVAL_REQUIRED", "No trusted adoption authority is registered");
    }
    const digest = contentDigest(request);

    return this.#repository.transaction((tx) => {
      const stored = tx.recallIdempotency(
        { kind: "project", project_id: request.project_id },
        WORKFLOW_OPERATIONS.reviewDecide,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput("review.decide", stored.response) as ReviewDecision;
      }

      const review = tx.get("review_request", {
        project_id: request.project_id,
        run_id: request.run_id,
        review_id: request.package_id,
      });
      if (review === null) {
        throw new ProductError("NOT_FOUND", "No such review package");
      }
      const run = this.#requireRun(tx, request.project_id, request.run_id);
      if (run.state === "cancelled") {
        throw new ProductError("RUN_PLAN_STALE", "The run was cancelled", { details: { state: run.state } });
      }
      if (review.run_scope_digest !== run.run_scope_digest) {
        throw new ProductError("REVIEW_STALE", "The review package belongs to another scope");
      }
      const artifact = tx.get("artifact_version", {
        project_id: review.project_id,
        artifact_id: review.artifact_id,
        version: review.artifact_version,
      });
      if (artifact === null || !("parts" in artifact.content_json)) {
        throw new ProductError("NOT_FOUND", "The review package body is missing");
      }
      const packageDocument = artifact.content_json as ReviewPackage;
      if (review.state !== "pending") {
        throw new ProductError("REVIEW_STALE", "The review package was already decided", {
          details: { state: review.state },
        });
      }
      if (
        request.input_digest !== packageDocument.input_digest ||
        request.output_digest !== packageDocument.output_digest ||
        request.quality_digest !== packageDocument.quality_digest ||
        request.package_version !== packageDocument.version
      ) {
        throw new ProductError("REVIEW_STALE", "The decision is bound to a different package version", {
          details: {
            expected: {
              input_digest: packageDocument.input_digest,
              output_digest: packageDocument.output_digest,
              quality_digest: packageDocument.quality_digest,
              package_version: packageDocument.version,
            },
            received: {
              input_digest: request.input_digest,
              output_digest: request.output_digest,
              quality_digest: request.quality_digest,
              package_version: request.package_version,
            },
          },
        });
      }
      if (!packageDocument.allowed_choices.includes(request.choice)) {
        throw new ProductError("INVALID_REQUEST", "This package does not allow that choice", {
          details: { choice: request.choice, allowed_choices: packageDocument.allowed_choices },
        });
      }

      const lineage = run.checkpoint_json.review_packages.find(
        (entry) => entry.package_id === request.package_id,
      );
      if (lineage === undefined) {
        throw new ProductError("REVIEW_STALE", "The package has no recorded lineage");
      }

      const adopting = request.choice === "accept_and_adopt";
      let impact: Change | null = null;
      if (adopting) {
        impact = this.#assertAdoptionImpact(packageDocument, request, run, this.#now());
      }

      const now = this.#now();
      const recordedAt = new Date(now * 1000).toISOString();
      const expiresAt = now + this.#authorizationTtl;
      const actionDigest = request.plan_sha256 ?? packageDocument.output_digest;

      const confirmation = adoption.registerConfirmation(tx, {
        project_id: request.project_id,
        run_id: request.run_id,
        review_id: request.package_id,
        input_digest: request.input_digest,
        purpose: adopting ? "change.approve" : "review",
        authenticated_actor: caller.principal_id,
        session_ref: caller.session_ref,
        action_digest: actionDigest,
        issued_at: now,
        expires_at: expiresAt,
      });
      this.#assertConfirmation(confirmation, {
        project_id: request.project_id,
        run_id: request.run_id,
        purpose: adopting ? "change.approve" : "review",
        actor: caller.principal_id,
        action_digest: actionDigest,
        issued_at: now,
        expires_at: expiresAt,
      });

      let approvalId: string | null = null;
      if (adopting && impact !== null) {
        const approval = adoption.registerApproval(tx, {
          project_id: request.project_id,
          run_id: request.run_id,
          run_scope_digest: run.run_scope_digest,
          confirmation_id: confirmation?.confirmation_id ?? "",
          plan_version: 1,
          // The adoption names the real attempt that produced the reviewed package.
          step_id: lineage.step_id,
          attempt: lineage.attempt,
          input_digest: request.input_digest,
          change_id: impact.materialization_id,
          impact_id: impact.impact_id,
          base_revision: impact.base_revision,
          control_revision: impact.control_revision,
          action_digest: actionDigest,
          facts_digest: canonicalDigest({
            impact_id: impact.impact_id,
            materialization_id: impact.materialization_id,
            base_revision: impact.base_revision,
            control_revision: impact.control_revision,
            input_digest: request.input_digest,
          }),
          expires_at: expiresAt,
        });
        if (approval === null || approval === undefined) {
          throw new ProductError(
            "APPROVAL_REQUIRED",
            "The adoption could not be registered in this transaction",
          );
        }
        if (approval.approval_id.length === 0 || approval.impact_id !== impact.impact_id) {
          throw new ProductError("APPROVAL_REQUIRED", "The registered approval does not match the impact");
        }
        approvalId = approval.approval_id;
      }

      const decisionId = `review-decision-${randomUUID()}`;
      tx.put("content_decision", {
        project_id: request.project_id,
        run_id: request.run_id,
        decision_id: decisionId,
      }, {
        project_id: request.project_id,
        run_id: request.run_id,
        decision_id: decisionId,
        review_id: request.package_id,
        input_digest: request.input_digest,
        channel: "trusted_ui",
        actor_id: caller.principal_id,
        choice: request.choice === "reject"
          ? "rejected"
          : request.choice === "changes_requested"
            ? "changes_requested"
            : "accepted",
        source_ref: caller.session_ref,
        created_at: recordedAt,
      });

      const reviewState = request.choice === "accept" || adopting
        ? "accepted"
        : request.choice === "changes_requested"
          ? "changes_requested"
          : "rejected";
      tx.put("review_request", {
        project_id: request.project_id,
        run_id: request.run_id,
        review_id: request.package_id,
      }, { ...review, state: reviewState });

      const gateKind = PACKAGE_GATE[packageDocument.kind];
      const gateState: RunGate["state"] = reviewState === "accepted"
        ? "accepted"
        : reviewState === "changes_requested"
          ? "changes_requested"
          : "rejected";
      const checkpoint: RunCheckpoint = {
        ...run.checkpoint_json,
        workflow_revision: run.checkpoint_json.workflow_revision + 1,
        observed_at: recordedAt,
        review_packages: run.checkpoint_json.review_packages.map((entry) =>
          entry.package_id === request.package_id ? { ...entry, state: reviewState } : entry,
        ),
        gates: gateKind === null
          ? run.checkpoint_json.gates
          : run.checkpoint_json.gates.map((gate) =>
              gate.kind === gateKind && gate.review_package_id === request.package_id
                ? { ...gate, state: gateState, decision_id: decisionId, reason: `decision_${reviewState}` }
                : gate,
            ),
      };
      const updated = this.#withCheckpoint(run, checkpoint, this.#nextRunState(checkpoint), recordedAt);
      tx.put("run", { project_id: run.project_id, run_id: run.run_id }, updated);

      tx.emit({
        topic: "review.decision.recorded",
        source: "host",
        scope: {
          kind: "run",
          project_id: request.project_id,
          run_id: request.run_id,
          run_scope_digest: run.run_scope_digest,
          plan_version: 1,
        },
        entity: { type: "decision", id: decisionId, version: packageDocument.version, state: request.choice },
        attempt: lineage.attempt,
        input_digest: request.input_digest,
        observed_at: recordedAt,
        payload: {
          decision_id: decisionId,
          package_id: request.package_id,
          choice: request.choice,
          approval_id: approvalId,
        },
      });

      const decision: ReviewDecision = {
        decision_id: decisionId,
        project_id: request.project_id,
        run_id: request.run_id,
        package_id: request.package_id,
        package_version: packageDocument.version,
        input_digest: request.input_digest,
        output_digest: request.output_digest,
        quality_digest: request.quality_digest,
        choice: request.choice,
        principal_id: caller.principal_id,
        channel: "trusted_ui",
        recorded_at: recordedAt,
        approval: null,
      };
      if (approvalId !== null) {
        const approvalRecord = tx.get("approval", {
          project_id: request.project_id,
          run_id: request.run_id,
          approval_id: approvalId,
        });
        if (approvalRecord !== null) {
          decision.approval = {
            approval_id: approvalRecord.approval_id,
            project_id: approvalRecord.project_id,
            impact_id: approvalRecord.impact_id,
            plan_sha256: approvalRecord.action_digest,
            expires_at: new Date(approvalRecord.expires_at * 1000).toISOString(),
            state: approvalRecord.state,
          };
        }
      }

      const validated = validateAgentRouteOutput("review.decide", decision) as ReviewDecision;
      const receipt = this.#receipt(WORKFLOW_OPERATIONS.reviewDecide, caller, request.meta, digest, request.project_id);
      tx.recordIdempotency(
        { kind: "project", project_id: request.project_id },
        WORKFLOW_OPERATIONS.reviewDecide,
        request.meta.idempotency_key,
        receipt,
        validated,
      );
      return validated;
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* Workflow observation                                                                  */
  /* ------------------------------------------------------------------------------------ */

  /**
   * The workflow of a project: one node per fixed stage, with the real attempt, the real
   * job and the real outputs of that stage.
   *
   * The nodes come from the durable checkpoint, not from a guess about what should have
   * happened. A stage that never ran is `pending` with attempt 0, and the node says so.
   */
  /** Same current-run selection as the workflow observer; no second run pointer. */
  async readCurrentRun(projectId: string, caller: TrustedCallerContext): Promise<WorkflowRun | null> {
    this.#requireContext(caller);
    return this.#repository.transaction(tx => this.readCurrentRunInTransaction(tx, projectId, caller));
  }

  /** Used by MAIN's context read in the SAME transaction as grants and native/commit facts. */
  readCurrentRunInTransaction(tx: ProductTransaction, projectId: string, caller: TrustedCallerContext): WorkflowRun | null {
    this.#requireContext(caller);
    if (tx.list("run", {project_id: projectId}).length === 0) return null;
    return this.#projectRun(tx, this.#selectActiveRun(tx, projectId));
  }

  async readWorkflow(projectId: string, caller: TrustedCallerContext): Promise<Workflow> {
    this.#requireContext(caller);
    return this.#repository.transaction((tx) => {
      // An owned, created project can be observed before any Run exists. Report
      // the actual empty history; never manufacture a Run, attempt or capability.
      if (tx.list("run", {project_id: projectId}).length === 0) {
        return validateAgentRouteOutput("workflow.read", {
          project_id: projectId,workflow_revision: 0,nodes: [],next_actions: ["define_content"],
        }) as Workflow;
      }
      const run = this.#selectActiveRun(tx, projectId);
      const nodes: WorkflowNode[] = FIXED_PLAN.stages.map((stage) => {
        const attempts = run.checkpoint_json.attempts.filter((attempt) => attempt.step_id === stage.id);
        const latest = attempts.length === 0 ? undefined : attempts[attempts.length - 1];
        const gate = run.checkpoint_json.gates.find((candidate) => candidate.kind === STAGE_GATE[stage.id]);
        const state = latest?.state ?? (gate?.state === "accepted" ? "succeeded" : "pending");
        return {
          node_id: stage.id,
          state,
          reason: latest === undefined ? (gate?.reason ?? "not_started") : `attempt_${latest.attempt}_${latest.state}`,
          input_refs: latest?.input_refs ?? [],
          output_refs: latest?.output_refs ?? [],
          job_id: latest?.job_id ?? null,
          attempt: latest?.attempt ?? 0,
          dependencies: [...stage.after],
          allowed_actions: [CAPABILITY_SLUG[stage.id] ?? "clip_prepare"],
        };
      });
      const workflow = validateAgentRouteOutput("workflow.read", {
        project_id: projectId,
        workflow_revision: run.checkpoint_json.workflow_revision,
        nodes,
        next_actions: this.#workflowNextActions(run),
      }) as Workflow;
      return workflow;
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* Internals                                                                            */
  /* ------------------------------------------------------------------------------------ */

  /** The run the workflow observation shows: the live one, chosen deterministically. */
  #selectActiveRun(tx: ProductTransaction, projectId: string): RunRecord {
    const runs = [...tx.list("run", { project_id: projectId })].sort((left, right) => {
      if (left.created_at !== right.created_at) return left.created_at < right.created_at ? -1 : 1;
      return left.run_id < right.run_id ? -1 : left.run_id > right.run_id ? 1 : 0;
    });
    const live = runs.filter((run) => !["completed", "failed", "cancelled"].includes(run.state));
    const run = live.length === 0 ? runs[runs.length - 1] : live[live.length - 1];
    if (run === undefined) {
      throw new ProductError("NOT_FOUND", "This project has no run", { details: { project_id: projectId } });
    }
    return run;
  }

  #ensureTemplate(tx: ProductTransaction, createdAt: string): void {
    const existing = tx.get("template_version", { template_id: "local-short-film", version: 1 });
    if (existing !== null) return;
    tx.put("template_version", { template_id: "local-short-film", version: 1 }, {
      template_id: "local-short-film",
      version: 1,
      parent_version: null,
      execution_digest: FIXED_PLAN_EXECUTION_DIGEST,
      capability_id: "clip.prepare",
      capability_version: "1",
      definition_json: FIXED_WORKFLOW_VERSION,
      created_at: createdAt,
    });
    tx.compareAndSet("template_head", { template_id: "local-short-film" }, 0, {
      template_id: "local-short-film",
      draft_version: 1,
      published_version: 1,
    });
  }

  #requireRun(tx: ProductTransaction, projectId: string, runId: string): RunRecord {
    const run = tx.get("run", { project_id: projectId, run_id: runId });
    if (run === null) {
      throw new ProductError("NOT_FOUND", "No such run", { details: { project_id: projectId, run_id: runId } });
    }
    return run;
  }

  #requireActiveGrant(
    tx: ProductTransaction,
    run: RunRecord,
    authorizationId: string,
    principalId: string,
  ): ExecutionGrantRecord {
    const grant = tx.get("execution_grant", {
      project_id: run.project_id,
      run_id: run.run_id,
      grant_id: authorizationId,
    });
    if (grant === null) {
      throw new ProductError("RUN_SCOPE_REQUIRED", "No such authorization for this run");
    }
    if (grant.run_scope_digest !== run.run_scope_digest) {
      throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization belongs to a different scope");
    }
    if (grant.state !== "active") {
      throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization is not active", {
        details: { state: grant.state },
      });
    }
    if (!trustedGrantConfirmation(tx, run, grant, this.#now())) {
      throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization has no current exact trusted confirmation");
    }
    if (this.#now() >= grant.expires_at) {
      throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization has expired");
    }
    if (grant.principal_id !== principalId) {
      throw new ProductError("UNAUTHORIZED", "The authorization belongs to another principal", {
        details: { expected: grant.principal_id, received: principalId },
      });
    }
    return grant;
  }

  /** The package parts a package of this kind has to carry. */
  #assertPackageParts(input: PublishReviewPackageInput): void {
    const present = new Set(input.parts.map((part) => part.kind));
    if (input.kind === "cover") {
      if (!present.has("preview")) {
        throw new ProductError("INVALID_REQUEST", "A cover package needs a preview part");
      }
      return;
    }
    if (input.kind === "audio") {
      if (!present.has("narration")) {
        throw new ProductError("INVALID_REQUEST", "An audio package needs a narration part");
      }
      return;
    }
    for (const kind of CHAPTER_PART_KINDS) {
      if (!present.has(kind)) {
        throw new ProductError("INVALID_REQUEST", "A chapter package needs every chapter part", {
          details: { missing: kind },
        });
      }
    }
  }

  /** The attempt that produced the package has to be the live attempt of its step. */
  #assertProducingAttempt(
    tx: ProductTransaction,
    run: RunRecord,
    input: PublishReviewPackageInput,
  ): void {
    const attempts = tx.list("step_attempt", {
      project_id: run.project_id,
      run_id: run.run_id,
      step_id: input.step_id,
    });
    const attempt = attempts.find((candidate) => candidate.attempt === input.attempt);
    if (attempt === undefined) {
      throw new ProductError("RUN_PLAN_STALE", "The package names an attempt that does not exist", {
        details: { step_id: input.step_id, attempt: input.attempt },
      });
    }
    const currentAttempt = attempts.reduce((highest, candidate) => Math.max(highest, candidate.attempt), 0);
    if (currentAttempt !== input.attempt) {
      throw new ProductError(
        "RUN_PLAN_STALE",
        "The package names an attempt that is not the current one of its step",
        { details: { expected: currentAttempt, received: input.attempt } },
      );
    }
    if (attempt.input_digest !== run.scope_json.input_digest) {
      throw new ProductError("REVIEW_STALE", "The producing attempt was made against another input");
    }
    if (attempt.state === "cancelled" || attempt.state === "stale") {
      throw new ProductError("RUN_PLAN_STALE", "The producing attempt was cancelled or is stale", {
        details: { state: attempt.state },
      });
    }
  }

  /** The gates a package of this kind depends on. */
  #assertGatePrerequisites(run: RunRecord, input: PublishReviewPackageInput): void {
    const gateKind = PACKAGE_GATE[input.kind];
    if (gateKind === null) return;
    const needed: RunGate["kind"][] = gateKind === "chapter_pack"
      ? ["sample", "first_chapter"]
      : gateKind === "first_chapter"
        ? ["sample"]
        : gateKind === "cover"
          ? ["chapter_pack"]
          : [];
    for (const kind of needed) {
      const gate = run.checkpoint_json.gates.find((candidate) => candidate.kind === kind);
      if (gate === undefined || gate.state !== "accepted") {
        throw new ProductError(
          "RUN_GATE_BLOCKED",
          "The chapter package cannot be published before its predecessors are accepted",
          { details: { gate_kind: kind, gate_state: gate?.state ?? "missing" } },
        );
      }
    }
  }

  /**
   * Checks a claimed review reuse.
   *
   * A reuse is only a reuse when it is the same chapter with the same input, output and
   * quality. A different quality is a different package and has to be reviewed again.
   */
  #assertReuse(
    tx: ProductTransaction,
    run: RunRecord,
    input: PublishReviewPackageInput,
  ): { package_id: string; gate_id: string } | null {
    if (input.reuse_of_package_id === null || input.reuse_of_package_id === undefined) return null;
    const source = run.checkpoint_json.review_packages.find(
      (entry) => entry.package_id === input.reuse_of_package_id,
    );
    if (source === undefined) {
      throw new ProductError("REVIEW_STALE", "The reused package is not part of this run", {
        details: { reuse_of_package_id: input.reuse_of_package_id },
      });
    }
    if (source.chapter_id !== input.chapter_id) {
      throw new ProductError("REVIEW_STALE", "The reused package is about another chapter", {
        details: { expected: source.chapter_id, received: input.chapter_id },
      });
    }
    if (
      source.input_digest !== input.input_digest ||
      source.output_digest !== input.output_digest ||
      source.quality_digest !== input.quality_digest
    ) {
      throw new ProductError(
        "REVIEW_STALE",
        "The reused package has other inputs, outputs or quality and cannot stand in",
        {
          details: {
            expected: {
              input_digest: source.input_digest,
              output_digest: source.output_digest,
              quality_digest: source.quality_digest,
            },
            received: {
              input_digest: input.input_digest,
              output_digest: input.output_digest,
              quality_digest: input.quality_digest,
            },
          },
        },
      );
    }
    const gate = run.checkpoint_json.gates.find(
      (candidate) => candidate.review_package_id === source.package_id,
    );
    return { package_id: source.package_id, gate_id: gate?.gate_id ?? "" };
  }

  /** The impact an adoption has to name. */
  #assertAdoptionImpact(
    packageDocument: ReviewPackage,
    request: ReviewDecisionInput,
    run: RunRecord,
    now: number,
  ): Change {
    const impact = packageDocument.impact;
    if (impact === null || impact === undefined) {
      throw new ProductError("IMPACT_REQUIRED", "The package carries no adoption impact");
    }
    if (request.impact_id !== impact.impact_id) {
      throw new ProductError("IMPACT_STALE", "The impact does not belong to this package", {
        details: { expected: impact.impact_id, received: request.impact_id },
      });
    }
    if (impact.project_id !== run.project_id) {
      throw new ProductError("IMPACT_STALE", "The impact belongs to another project", {
        details: { expected: run.project_id, received: impact.project_id },
      });
    }
    if (impact.state !== "active") {
      throw new ProductError("IMPACT_STALE", "The impact is not active", { details: { state: impact.state } });
    }
    if (Date.parse(impact.expires_at) <= now * 1000) {
      throw new ProductError("IMPACT_STALE", "The impact has expired", {
        details: { expires_at: impact.expires_at },
      });
    }
    if (request.plan_sha256 === null) {
      throw new ProductError("IMPACT_REQUIRED", "An adoption needs the plan digest it applies to");
    }
    if (request.plan_sha256 !== impact.plan_sha256) {
      throw new ProductError("IMPACT_STALE", "The plan digest does not match the impact", {
        details: { expected: impact.plan_sha256, received: request.plan_sha256 },
      });
    }
    return impact;
  }

  /** Resolve the actual immutable document and verify the role it serves. */
  #assertRefResolves(
    tx: ProductTransaction, projectId: string, ref: Ref,
    role: "input" | "script" | "style", selectedBrief?: Brief,
  ): ArtifactVersionRecord {
    const artifact = tx.get("artifact_version", {
      project_id: projectId, artifact_id: ref.id, version: ref.version,
    });
    if (artifact === null) throw new ProductError("NOT_FOUND", "The referenced artifact does not exist");
    if (artifact.project_id !== projectId || artifact.artifact_id !== ref.id || artifact.version !== ref.version ||
        artifact.content_digest !== ref.sha256 || canonicalDigest(artifact.content_json) !== ref.sha256) {
      throw new ProductError("REVIEW_STALE", "The reference does not match its immutable content");
    }
    if (role === "style") {
      if (artifact.kind !== "brief") throw new ProductError("INVALID_REQUEST", "The style reference must name a brief carrier");
      const carrier = validateAgentDefinition<Brief>("Brief", artifact.content_json);
      assertBriefConsistency(carrier);
      if (selectedBrief === undefined || canonicalDigest(carrier.content_brief.style) !== canonicalDigest(selectedBrief.content_brief.style)) {
        throw new ProductError("REVIEW_STALE", "The style carrier does not match the selected intake style");
      }
    } else if (artifact.kind === "script" || artifact.kind === "storyboard") {
      validateAgentDefinition(artifact.kind === "script" ? "Script" : "Storyboard", artifact.content_json);
      if (role === "script" && artifact.kind !== "script") throw new ProductError("INVALID_REQUEST", "The script reference must name a script");
    } else if (artifact.kind === "brief" && role === "input") {
      const brief = validateAgentDefinition<Brief>("Brief", artifact.content_json);
      assertBriefConsistency(brief);
    } else {
      throw new ProductError("INVALID_REQUEST", "The artifact cannot serve this input role");
    }
    return artifact;
  }

  /** A mandatory question has to be answered before a run can be prepared. */
  #assertNoMandatoryQuestionOpen(
    tx: ProductTransaction,
    intakeId: string,
    intakeVersion: number,
  ): void {
    const heads = tx.list("question_head", { intake_id: intakeId, intake_version: intakeVersion });
    for (const head of heads) {
      const question = tx.get("question_version", {
        intake_id: intakeId,
        intake_version: intakeVersion,
        question_id: head.question_id,
        question_version: head.current_question_version,
      });
      if (question === null) continue;
      if (question.skip_allowed === 1) continue;
      const answer = tx.get("answer_head", {
        intake_id: intakeId,
        intake_version: intakeVersion,
        question_id: head.question_id,
        question_version: head.current_question_version,
      });
      if (answer === null) {
        throw new ProductError(
          "RUN_GATE_BLOCKED",
          "A mandatory question has not been answered yet",
          { details: { question_id: head.question_id } },
        );
      }
      const answerRecord = tx.get("answer_version", {
        intake_id: intakeId,
        intake_version: intakeVersion,
        question_id: head.question_id,
        question_version: head.current_question_version,
        answer_version: answer.current_answer_version,
      });
      if (answerRecord === null || answerRecord.skipped === 1) {
        throw new ProductError(
          "RUN_GATE_BLOCKED",
          "A mandatory question was skipped and cannot be skipped",
          { details: { question_id: head.question_id } },
        );
      }
    }
  }

  #readPackageDocument(tx: ProductTransaction, review: ReviewRequestRecord): unknown {
    const artifact = tx.get("artifact_version", {
      project_id: review.project_id,
      artifact_id: review.artifact_id,
      version: review.artifact_version,
    });
    if (artifact === null || !("parts" in artifact.content_json)) {
      throw new ProductError("NOT_FOUND", "The review package body is missing");
    }
    return { ...artifact.content_json, state: review.state };
  }

  #withState(run: RunRecord, state: RunRecord["state"], observedAt: string): RunRecord {
    return {
      ...run,
      state,
      checkpoint_json: {
        ...run.checkpoint_json,
        workflow_revision: run.checkpoint_json.workflow_revision + 1,
        observed_at: observedAt,
      },
    };
  }

  #withCheckpoint(run: RunRecord, checkpoint: RunCheckpoint, state: RunRecord["state"], observedAt: string): RunRecord {
    return {
      ...run,
      state,
      checkpoint_json: checkpoint,
    };
  }

  /** The run state after a decision: waiting while a gate is open, running otherwise. */
  #nextRunState(checkpoint: RunCheckpoint): RunRecord["state"] {
    const open = checkpoint.gates.find(
      (gate) => gate.kind !== "adoption" && gate.state === "pending" && gate.review_package_id !== null,
    );
    if (open !== undefined) return "waiting_user";
    return "running";
  }

  #workflowNextActions(run: RunRecord): string[] {
    const actions: string[] = [];
    if (run.state === "ready") actions.push("authorize_run");
    if (run.state === "waiting_user") actions.push("review_package");
    if (run.state === "running") actions.push("await_step");
    if (run.state === "paused") actions.push("resume_run");
    return actions.slice(0, 8);
  }

  /** The wire projection of a run. */
  #projectRun(tx: ProductTransaction, run: RunRecord): WorkflowRun {
    const now = this.#now();
    const candidates = tx.list("execution_grant", {project_id: run.project_id, run_id: run.run_id})
      .filter(grant => grant.state === "active")
      .flatMap(grant => {
        const confirmation = trustedGrantConfirmation(tx, run, grant, now);
        // An unusable grant is not authority. Projection must remain readable so
        // a clock rollback or damaged confirmation cannot roll back pause/cancel.
        // Execution paths still require an exact current trusted confirmation.
        return confirmation ? [{grant, confirmation}] : [];
      })
      .sort((a,b) => Number(b.grant.expires_at > now) - Number(a.grant.expires_at > now) ||
        b.confirmation.issued_at - a.confirmation.issued_at || a.grant.grant_id.localeCompare(b.grant.grant_id));
    const grant = candidates[0]?.grant;
    const confirmation = candidates[0]?.confirmation;
    const authorization = grant === undefined
      ? null
      : {
          authorization_id: grant.grant_id,
          scope: run.scope_json,
          scope_digest: run.run_scope_digest,
          principal_id: grant.principal_id,
          decision_id: grant.confirmation_id,
          state: grant.expires_at <= now ? "expired" : grant.state,
          issued_at: new Date(confirmation!.issued_at * 1000).toISOString(),
          expires_at: new Date(grant.expires_at * 1000).toISOString(),
          channel: "trusted_ui" as const,
        };
    const workflowRun = validateAgentRouteOutput("workflow.run.read", {
      project_id: run.project_id,
      run_id: run.run_id,
      plan_version: run.current_plan_version,
      workflow: FIXED_WORKFLOW_VERSION,
      scope: run.scope_json,
      scope_digest: run.run_scope_digest,
      authorization,
      state: run.state,
      gates: run.checkpoint_json.gates,
      checkpoint_id: `checkpoint-${run.checkpoint_json.workflow_revision}`,
      observed_at: run.checkpoint_json.observed_at,
      next_actions: this.#workflowNextActions(run),
    }) as WorkflowRun;
    return workflowRun;
  }

  #receipt(
    operation: string,
    caller: TrustedCallerContext,
    meta: { idempotency_key: string; correlation_id: string },
    digest: string,
    projectId: string,
  ): ProductIdempotencyReceipt {
    return {
      operation,
      principal_id: caller.principal_id,
      project_id: projectId,
      idempotency_key: meta.idempotency_key,
      request_digest: digest,
      correlation_id: meta.correlation_id,
    };
  }

  #assertSameRequest(stored: ProductIdempotencyReceipt, digest: string): void {
    if (stored.request_digest !== digest) {
      throw new ProductError("IDEMPOTENCY_CONFLICT", "This idempotency key was used with a different request", {
        details: { expected: stored.request_digest, received: digest },
      });
    }
  }

  /**
   * Checks what MAIN's trusted authority returned.
   *
   * The authority is MAIN's, so the lane does not assume it did the right thing: the
   * confirmation has to name the same run, the same purpose, the same actor and the same
   * action, and it has to be inside the window the lane asked for. A confirmation that
   * says otherwise is refused rather than recorded.
   */
  #assertConfirmation(
    confirmation: TrustedConfirmationRecord,
    expected: {
      project_id: string;
      run_id: string;
      purpose: TrustedConfirmationRecord["purpose"];
      actor: string;
      action_digest: string;
      issued_at: number;
      expires_at: number;
    },
  ): void {
    const problems: string[] = [];
    if (confirmation.project_id !== expected.project_id) problems.push("project_id");
    if (confirmation.run_id !== expected.run_id) problems.push("run_id");
    if (confirmation.purpose !== expected.purpose) problems.push("purpose");
    if (confirmation.authenticated_actor !== expected.actor) problems.push("authenticated_actor");
    if (confirmation.action_digest !== expected.action_digest) problems.push("action_digest");
    if (confirmation.issued_at !== expected.issued_at) problems.push("issued_at");
    if (confirmation.expires_at !== expected.expires_at) problems.push("expires_at");
    if (confirmation.channel !== "trusted_ui") problems.push("channel");
    if (problems.length > 0) {
      throw new ProductError(
        "APPROVAL_REQUIRED",
        "The trusted confirmation does not match the action it was asked to confirm",
        { details: { mismatched: problems } },
      );
    }
  }

  #requireContext(caller: TrustedCallerContext): void {
    if (!isTrustedCallerContext(caller)) {
      throw new ProductError("UNAUTHORIZED", "The caller context was not minted by the dispatcher");
    }
  }

  #requireTrustedUi(caller: TrustedCallerContext): void {
    this.#requireContext(caller);
    if (!isTrustedUi(caller)) {
      throw new ProductError("UNAUTHORIZED", "This route needs a trusted user session");
    }
  }
}
