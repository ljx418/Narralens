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
 * - **The sample gate comes before the first chapter.** Publishing or dispatching a
 *   first-chapter package without an accepted sample gate is refused.
 * - **A pure review grants nothing.** `accept` produces a decision and no approval.
 *   `accept_and_adopt` needs MAIN's transaction-aware approval authority; when MAIN
 *   cannot join the transaction the adoption fails closed.
 */

import { randomUUID } from "node:crypto";
import type {
  Change,
  FixedWorkflowVersion,
  ReviewDecision,
  ReviewDecisionInput,
  ReviewPackage,
  ReviewPart,
  ReviewRead,
  RunAuthorization,
  RunCommand,
  RunGate,
  RunPrepare,
  RunRead,
  RunScope,
  Workflow,
  WorkflowNode,
  WorkflowRun,
} from "../../contracts/agent-driven-types.js";
import { validateAgentRouteInput, validateAgentRouteOutput } from "../../contracts/agent-driven-validator.js";
import { creativeInputClosure } from "./creative-closure.js";
import {
  canonicalDigest,
  contentDigest,
  FIXED_PLAN,
  FIXED_PLAN_EXECUTION_DIGEST,
} from "./digest.js";
import { assertAbleScope } from "./execution-guard.js";
import type {
  ArtifactVersionRecord,
  ExecutionGrantRecord,
  ProductIdempotencyReceipt,
  ProductRepository,
  ProductTransaction,
  ReviewRequestRecord,
  RunCheckpoint,
  RunRecord,
  TrustedAdoptionAuthority,
  TrustedCallerContext,
} from "./product-repository.js";
import { nowEpochSeconds } from "./time.js";
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
const GATE_STAGE: Readonly<Record<RunGate["kind"], string>> = {
  definition: "definition",
  sample: "sample",
  first_chapter: "first_chapter",
  chapter_pack: "chapters",
  cover: "cover",
  qc: "delivery",
  adoption: "delivery",
  risk: "sample",
};

/** The wire package kind to the gate it satisfies. */
export const PACKAGE_GATE: Readonly<Record<ReviewPackage["kind"], RunGate["kind"]>> = {
  sample: "sample",
  first_chapter: "first_chapter",
  chapter_pack: "chapter_pack",
  audio: "chapter_pack",
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

/** The slug of the capability a stage uses. The wire vocabulary has no dots. */
export const CAPABILITY_SLUG = {
  definition: "clip_prepare",
  sample: "clip_prepare",
  first_chapter: "clip_prepare",
  chapters: "snapshot_render",
  cover: "snapshot_render",
  delivery: "delivery_package",
} as const;

/** The part kinds a chapter-level package has to carry. */
export const CHAPTER_PART_KINDS: ReadonlyArray<ReviewPart["kind"]> = [
  "preview",
  "narration",
  "subtitles",
  "shot_summary",
  "rights_quality",
];

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
  /** The clock, in epoch seconds. */
  readonly now?: () => number;
  /** How long a run authorization stays valid, in seconds. */
  readonly authorizationTtlSeconds?: number;
}

export class FixedWorkflowService {
  readonly #repository: ProductRepository;
  readonly #adoption: TrustedAdoptionAuthority | undefined;
  readonly #now: () => number;
  readonly #authorizationTtl: number;

  constructor(options: FixedWorkflowServiceOptions) {
    this.#repository = options.repository;
    this.#adoption = options.adoption;
    this.#now = options.now ?? nowEpochSeconds;
    this.#authorizationTtl = options.authorizationTtlSeconds ?? 3600;
  }

  /* ------------------------------------------------------------------------------------ */
  /* Run                                                                                   */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Prepares a candidate run.
   *
   * Preparing binds the content decision, the input closure, the style and the fixed
   * template. It does not dispatch anything: the run starts in `ready`, and only an
   * authorized start may move it on.
   */
  async prepareRun(input: RunPrepare, caller: TrustedCallerContext): Promise<WorkflowRun> {
    const request = validateAgentRouteInput("workflow.run.prepare", input);
    this.#requireContext(caller);
    const digest = contentDigest(request);

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
        capability_fingerprint: canonicalDigest(FIXED_PLAN.capabilities),
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
        gates: RUN_GATE_KINDS.map((kind) => ({
          gate_id: `gate-${kind}`,
          kind,
          state: "pending" as const,
          chapter_id: null,
          review_package_id: null,
          decision_id: null,
          input_digest: closureDigest,
          output_digest: null,
          reuse_of_gate_id: null,
          reason: "waiting_for_step",
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
   * Starting needs an active, unexpired grant whose scope digest matches the run. It
   * moves the run to `running`; it does not dispatch a step and it does not accept a gate.
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
        this.#requireActiveGrant(tx, run, request.authorization_id);
      }
      if (run.state === "cancelled") {
        throw new ProductError("RUN_PLAN_STALE", "The run was cancelled", { details: { state: run.state } });
      }

      const now = this.#now();
      const updated = this.#withState(run, nextState);
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
        observed_at: new Date(now * 1000).toISOString(),
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
  /* Reviews                                                                              */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Publishes a review package.
   *
   * The package body is stored as an artifact version and the review request points at
   * it, so the review body and the content body share one immutable store. The run moves
   * to `waiting_user` while the package is pending — the package is a request for a
   * decision, never the decision itself.
   */
  async publishReviewPackage(
    input: PublishReviewPackageInput,
    caller: TrustedCallerContext,
  ): Promise<ReviewPackage> {
    this.#requireContext(caller);
    return this.#repository.transaction((tx) => {
      const run = this.#requireRun(tx, input.project_id, input.run_id);
      if (input.input_digest !== run.scope_json.input_digest) {
        throw new ProductError("REVIEW_STALE", "The package is bound to a different run input", {
          details: { expected: run.scope_json.input_digest, received: input.input_digest },
        });
      }
      this.#assertPackageParts(input);

      const gateKind = PACKAGE_GATE[input.kind];
      if (gateKind === "first_chapter" || gateKind === "chapter_pack") {
        const sample = run.checkpoint_json.gates.find((gate) => gate.kind === "sample");
        if (sample === undefined || sample.state !== "accepted") {
          throw new ProductError("RUN_GATE_BLOCKED", "The sample has to be accepted before a chapter", {
            details: { gate_kind: gateKind, sample_state: sample?.state ?? "missing" },
          });
        }
      }

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

      const checkpoint: RunCheckpoint = {
        ...run.checkpoint_json,
        workflow_revision: run.checkpoint_json.workflow_revision + 1,
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
          },
        ],
        gates: run.checkpoint_json.gates.map((gate) =>
          gate.kind === gateKind && gate.state === "pending"
            ? {
                ...gate,
                review_package_id: input.package_id,
                output_digest: input.output_digest,
                reason: "waiting_for_decision",
              }
            : gate,
        ),
      };
      const updated = this.#withCheckpoint(run, checkpoint, "waiting_user");
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
        attempt: 0,
        input_digest: input.input_digest,
        observed_at: createdAt,
        payload: {
          package_id: input.package_id,
          kind: input.kind,
          gate: gateKind,
          package_digest: packageDigest,
        },
      });

      return validateAgentRouteOutput("review.read", packageDocument) as ReviewPackage;
    });
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
      const artifact = tx.get("artifact_version", {
        project_id: review.project_id,
        artifact_id: review.artifact_id,
        version: review.artifact_version,
      });
      if (artifact === null) {
        throw new ProductError("NOT_FOUND", "The review package body is missing");
      }
      const document = artifact.content_json;
      if (!("parts" in document)) {
        throw new ProductError("NOT_FOUND", "The review package body is missing");
      }
      const packageDocument = { ...document, state: review.state } as ReviewPackage;
      return validateAgentRouteOutput("review.read", packageDocument) as ReviewPackage;
    });
  }

  /**
   * Records a review decision.
   *
   * `accept`, `changes_requested` and `reject` are pure reviews: they record a decision
   * and grant nothing. `accept_and_adopt` needs a current impact on the package and
   * MAIN's approval authority; when MAIN cannot join the transaction the adoption fails
   * closed with `APPROVAL_REQUIRED` and no decision is written.
   */
  async decideReview(input: ReviewDecisionInput, caller: TrustedCallerContext): Promise<ReviewDecision> {
    const request = validateAgentRouteInput("review.decide", input);
    this.#requireTrustedUi(caller);
    const adoption = this.#adoption;
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

      const adopting = request.choice === "accept_and_adopt";
      if (adopting) {
        if (adoption === undefined) {
          throw new ProductError("APPROVAL_REQUIRED", "No trusted adoption authority is registered");
        }
        if (request.plan_sha256 === null) {
          throw new ProductError("IMPACT_REQUIRED", "An adoption needs the plan digest it applies to");
        }
        if (packageDocument.impact === null || packageDocument.impact === undefined) {
          throw new ProductError("IMPACT_REQUIRED", "The package carries no adoption impact");
        }
        if (request.impact_id !== packageDocument.impact.impact_id) {
          throw new ProductError("IMPACT_STALE", "The impact does not belong to this package", {
            details: { expected: packageDocument.impact.impact_id, received: request.impact_id },
          });
        }
      }

      const run = this.#requireRun(tx, request.project_id, request.run_id);
      const now = this.#now();
      const recordedAt = new Date(now * 1000).toISOString();
      const expiresAt = now + this.#authorizationTtl;
      const actionDigest = request.plan_sha256 ?? packageDocument.output_digest;

      const confirmation = adoption?.registerConfirmation(tx, {
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

      let approvalId: string | null = null;
      if (adopting) {
        const impact = packageDocument.impact as Change;
        const approval = adoption?.registerApproval(tx, {
          project_id: request.project_id,
          run_id: request.run_id,
          run_scope_digest: run.run_scope_digest,
          confirmation_id: confirmation?.confirmation_id ?? "",
          plan_version: 1,
          step_id: "adoption",
          attempt: 1,
          input_digest: request.input_digest,
          change_id: impact.change_id,
          impact_id: impact.impact_id,
          base_revision: impact.base_revision,
          control_revision: impact.control_revision,
          action_digest: actionDigest,
          facts_digest: canonicalDigest({
            impact_id: impact.impact_id,
            change_id: impact.change_id,
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
        choice: request.choice === "reject" ? "rejected" : request.choice === "changes_requested" ? "changes_requested" : "accepted",
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
        review_packages: run.checkpoint_json.review_packages.map((entry) =>
          entry.package_id === request.package_id ? { ...entry, state: reviewState } : entry,
        ),
        gates: run.checkpoint_json.gates.map((gate) =>
          gate.kind === gateKind && gate.review_package_id === request.package_id
            ? { ...gate, state: gateState, decision_id: decisionId, reason: `decision_${reviewState}` }
            : gate,
        ),
      };
      const updated = this.#withCheckpoint(run, checkpoint, this.#nextRunState(checkpoint));
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
        attempt: 0,
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
  async readWorkflow(projectId: string, caller: TrustedCallerContext): Promise<Workflow> {
    this.#requireContext(caller);
    return this.#repository.transaction((tx) => {
      const runs = tx.list("run", { project_id: projectId });
      const run = runs.find((candidate) => candidate.state !== "cancelled") ?? runs[runs.length - 1];
      if (run === undefined) {
        throw new ProductError("NOT_FOUND", "This project has no run", { details: { project_id: projectId } });
      }
      const nodes: WorkflowNode[] = FIXED_PLAN.stages.map((stage) => {
        const attempts = run.checkpoint_json.attempts.filter((attempt) => attempt.step_id === stage.id);
        const latest = attempts.length === 0 ? undefined : attempts[attempts.length - 1];
        const gate = run.checkpoint_json.gates.find((candidate) => candidate.kind === GATE_STAGE[stage.id]);
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
          allowed_actions: [CAPABILITY_SLUG[stage.id]],
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

  #requireActiveGrant(tx: ProductTransaction, run: RunRecord, authorizationId: string): ExecutionGrantRecord {
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
    if (this.#now() >= grant.expires_at) {
      throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization has expired");
    }
    return grant;
  }

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

  #withState(run: RunRecord, state: RunRecord["state"]): RunRecord {
    return {
      ...run,
      state,
      checkpoint_json: {
        ...run.checkpoint_json,
        workflow_revision: run.checkpoint_json.workflow_revision + 1,
      },
    };
  }

  #withCheckpoint(run: RunRecord, checkpoint: RunCheckpoint, state: RunRecord["state"]): RunRecord {
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
    const grant = tx.list("execution_grant", { project_id: run.project_id, run_id: run.run_id })
      .find((candidate) => candidate.state === "active");
    const confirmation = grant === undefined
      ? null
      : tx.get("trusted_confirmation", {
          project_id: run.project_id,
          run_id: run.run_id,
          confirmation_id: grant.confirmation_id,
        });
    const authorization = grant === undefined
      ? null
      : {
          authorization_id: grant.grant_id,
          scope: run.scope_json,
          scope_digest: run.run_scope_digest,
          principal_id: grant.principal_id,
          decision_id: grant.confirmation_id,
          state: grant.state,
          issued_at: new Date((confirmation?.issued_at ?? grant.expires_at) * 1000).toISOString(),
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
      observed_at: new Date(this.#now() * 1000).toISOString(),
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
