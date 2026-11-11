/**
 * The single gate every actual side effect has to pass.
 *
 * MAIN calls `guardExecution` (or `guardExecutionInTransaction`, which reads the durable
 * facts itself) before it dispatches a job, prepares a change, applies a change, loads a
 * runtime or publishes a delivery. The reason it exists separately from the run service
 * is that the run service is not the only thing that produces side effects: MAIN's own
 * change and delivery paths do too, and the contract is explicit that
 * "所有副作用入口共同执行的门" — the same gate, not one gate per call site.
 *
 * The guard is **fail closed**. The durable facts are a required argument: a call without
 * them is refused, because a guard that succeeds when it knows nothing is worse than no
 * guard at all — it looks like a check while authorizing whatever the caller asked for.
 *
 * Every fact comes from the server's own records. Nothing the caller sends can become
 * authority: the scope is the one the run row holds, its digest is recomputed here, the
 * grant is the one the run's authorization table holds, and the attempt is the durable
 * attempt row. A scope flag or a digest in a request body is a claim, not a fact.
 *
 * What the guard deliberately does **not** do: it never marks a gate accepted, never
 * advances a step and never creates an artifact. A guard that also progresses the
 * workflow is a workflow engine wearing a validator's coat — the acceptance of a gate is
 * a decision, and a decision has to be recorded by the decision path.
 */

import type {
  ExecutionBinding,
  RunGate,
  RunScope,
} from "../../contracts/agent-driven-types.js";
import { validateAgentDefinition } from "../../contracts/agent-driven-validator.js";
import { canonicalDigest } from "./digest.js";
import type {
  ProductRepository,
  ProductTransaction,
  RunRecord,
  RunState,
  StepAttemptRecord,
} from "./product-repository.js";
import {trustedGrantConfirmation} from './trusted-grant.js';
import { ProductError } from "./trusted-context.js";

/** The actions an A run may perform. Nothing outside this set is dispatchable. */
export const A_ALLOWED_ACTIONS = [
  "clip.prepare",
  "snapshot.render",
  "qc.inspect",
  "delivery.package",
  "change.prepare",
  "change.apply",
] as const;

/** One of the fixed A actions. */
export type GuardedAction = (typeof A_ALLOWED_ACTIONS)[number];

/** The four capabilities the fixed template publishes. */
export const A_CAPABILITY_IDS = [
  "clip.prepare",
  "snapshot.render",
  "qc.inspect",
  "delivery.package",
] as const;

/** The stages of the fixed plan. */
export type FixedStageId =
  | "definition"
  | "sample"
  | "first_chapter"
  | "chapters"
  | "cover"
  | "delivery";

/** The actions each fixed stage may perform. */
export const A_STAGE_ACTIONS: Readonly<Record<string, ReadonlyArray<GuardedAction>>> = {
  definition: ["clip.prepare"],
  sample: ["clip.prepare", "change.prepare", "change.apply"],
  first_chapter: ["clip.prepare", "change.prepare", "change.apply"],
  chapters: ["snapshot.render", "change.prepare", "change.apply"],
  cover: ["snapshot.render", "change.prepare", "change.apply"],
  delivery: ["qc.inspect", "delivery.package"],
};

/**
 * The gates each fixed stage depends on.
 *
 * These are the review gates of the *predecessor* stages. The gate a stage produces is
 * not its own prerequisite — that would be circular — and the QC and adoption gates are
 * produced inside the delivery stage and are therefore prerequisites of the actions that
 * come after them, not of the stage that produces them.
 */
export const A_STAGE_GATE_REQUIREMENTS: Readonly<Record<string, ReadonlyArray<RunGate["kind"]>>> = {
  definition: [],
  sample: ["definition"],
  first_chapter: ["sample"],
  chapters: ["first_chapter"],
  cover: ["chapter_pack"],
  delivery: ["cover"],
};

/**
 * The gates each action depends on, on top of the stage's own requirements.
 *
 * `delivery.package` needs the QC gate: a delivery cannot be packaged before the QC
 * recorded its evidence, and the QC gate is accepted by the delivery stage's own review.
 */
export const A_ACTION_GATE_REQUIREMENTS: Readonly<Record<string, ReadonlyArray<RunGate["kind"]>>> = {
  "clip.prepare": [],
  "snapshot.render": [],
  "qc.inspect": [],
  "delivery.package": ["qc"],
  "change.prepare": [],
  "change.apply": [],
};

/** The run states in which a new side effect may be dispatched. */
export const A_DISPATCHABLE_RUN_STATES: ReadonlyArray<RunState> = ["ready", "running"];

/** The attempt states in which a new side effect may be dispatched. */
export const A_DISPATCHABLE_ATTEMPT_STATES: ReadonlyArray<StepAttemptRecord["state"]> = [
  "pending",
  "running",
];

/** The durable facts the guard reads. Every one of them comes from the server's records. */
export interface ExecutionGuardFacts {
  /** The project the run belongs to. */
  readonly project_id: string;
  /** The durable run row. */
  readonly run: {
    readonly run_id: string;
    readonly current_plan_version: 1;
    readonly state: RunState;
    readonly scope: RunScope;
    readonly run_scope_digest: string;
  };
  /**
   * The durable grant row the binding names, or `null` when there is none.
   *
   * The grant is read from the run's own authorization table, never from the request.
   */
  readonly grant: {
    readonly grant_id: string;
    readonly run_scope_digest: string;
    readonly principal_id: string;
    readonly state: "active" | "revoked" | "expired";
    /** Epoch seconds from the exact trusted confirmation, never guessed from expiry. */
    readonly issued_at: number;
    readonly expires_at: number;
  } | null;
  /** The durable attempt row of the step the binding names, or `null`. */
  readonly attempt: {
    readonly step_id: string;
    readonly attempt: number;
    readonly state: StepAttemptRecord["state"];
    readonly input_digest: string;
    readonly grant_id: string;
  } | null;
  /** The run's gates, from the durable checkpoint. */
  readonly gates: ReadonlyArray<RunGate>;
  /**
   * The durable facts of the narrow Host-only effects.
   *
   * They are read by `readNarrowEffectFacts` from the real records: the review and
   * the approval out of the product tables, the gate out of the run's checkpoint and
   * the impact out of the impact authority. A narrow effect without them is refused:
   * the guard does not look them up itself, because it has no authority to.
   */
  readonly narrow?: NarrowEffectFacts | null | undefined;
  readonly preparedImpact?: PreparedImpactFacts | null | undefined;
  /** The authenticated principal that is about to cause the side effect. */
  readonly principal_id: string;
  /** The current time, in epoch seconds. */
  readonly now_epoch_seconds: number;
}

/* -------------------------------------------------------------------------------------- */
/* The narrow Host-only effects                                                            */
/* -------------------------------------------------------------------------------------- */

/** The state of a review package, as the review table holds it. */
export type NarrowReviewState = "pending" | "accepted" | "changes_requested" | "rejected" | "stale";

/** The state of an approval, as the approval table holds it. */
export type NarrowApprovalState = "active" | "consumed" | "rejected" | "revoked";

/** The state of an impact, as the impact table holds it. */
export type NarrowImpactState = "active" | "consumed" | "expired" | "stale";

/** Projection from MAIN's verified prepared-source reader, not a proof capability.
 * The caller must assert the reader's opaque token in the same synchronous transaction
 * as this guard. HTTP/JSON input cannot establish these facts. */
export interface PreparedImpactFacts {
  readonly project_id: string;
  readonly completed_job: {
    readonly job_id: string;
    readonly state: "succeeded";
    readonly terminal_reason: "SOURCE_ONLY";
  };
  readonly prepared_source_id: string;
  readonly fact_digest: string;
  readonly execution: ExecutionBinding;
}

/** The durable facts of one narrow Host-only effect. */
export interface NarrowEffectFacts {
  /** The review package the effect is about. */
  readonly review: {
    readonly package_id: string;
    readonly package_digest: string;
    readonly state: NarrowReviewState;
  } | null;
  /** The approval the adoption effect would consume. */
  readonly approval: {
    readonly approval_id: string;
    readonly impact_id: string;
    readonly state: NarrowApprovalState;
  } | null;
  /** The impact the effect would authorise or consume. */
  readonly impact: {
    readonly impact_id: string;
    readonly state: NarrowImpactState;
  } | null;
}

/**
 * The reader of the impact's state.
 *
 * The impact table is not one of the product collections, so its state is read through
 * the impact authority and handed in. It is optional because a caller that has no
 * impact authority cannot produce an adoption effect anyway: the adoption is refused
 * without it.
 */
export type NarrowImpactStateReader = (impact_id: string) => NarrowImpactState | undefined;

/**
 * The real repository reader of the narrow facts.
 *
 * The review and the approval come out of the product tables, the gate out of the run
 * checkpoint the caller holds, and the impact out of the impact authority. Nothing
 * here is a default: a row that is not there is `null`, and the guard refuses a
 * narrow effect without the facts it needs.
 */
export function readNarrowEffectFacts(
  tx: ProductTransaction,
  input: {
    readonly project_id: string;
    readonly run_id: string;
    readonly package_id: string;
    readonly approval_id?: string | undefined;
    readonly impact_id?: string | undefined;
  },
  impactState?: NarrowImpactStateReader,
): NarrowEffectFacts {
  const review = tx.get("review_request", {
    project_id: input.project_id,
    run_id: input.run_id,
    review_id: input.package_id,
  });
  const approval = input.approval_id === undefined
    ? null
    : tx.get("approval", {
        project_id: input.project_id,
        run_id: input.run_id,
        approval_id: input.approval_id,
      });
  const impactId = input.impact_id ?? (approval === null ? undefined : approval.impact_id);
  const impactStateValue = impactId === undefined || impactState === undefined
    ? undefined
    : impactState(impactId);
  return {
    review: review === null
      ? null
      : {
          package_id: review.review_id,
          package_digest: review.package_digest,
          state: review.state as NarrowReviewState,
        },
    approval: approval === null
      ? null
      : {
          approval_id: approval.approval_id,
          impact_id: approval.impact_id,
          state: approval.state as NarrowApprovalState,
        },
    impact: impactId === undefined || impactStateValue === undefined
      ? null
      : { impact_id: impactId, state: impactStateValue },
  };
}

/**
 * The effect the caller is about to cause.
 *
 * The two narrow Host-only effects are not reachable from a request: a body cannot
 * name an effect kind, and the ordinary dispatch set does not grow because they
 * exist. They are the two things that happen while a run is waiting for a decision —
 * preparing the impact of a reviewed product, and consuming an approval to adopt it.
 */
export type GuardedEffect =
  | { readonly kind: "action"; readonly action: GuardedAction; readonly stage_id: string }
  | { readonly kind: "safe_control"; readonly control: "pause" | "cancel" }
  | {
      readonly kind: "review_impact_prepare";
      readonly prepared_source_id: string;
      readonly prepared_job_id: string;
      readonly fact_digest: string;
    }
  | {
      readonly kind: "approved_prepared_adoption";
      readonly package_id: string;
      readonly impact_id: string;
      readonly approval_id: string;
    };

/**
 * The run states in which a narrow Host-only effect may happen.
 *
 * A run that is waiting for a decision is exactly the state the narrow effects are
 * for. A run that is paused, cancelled or stale is not, and a successful job is never
 * put back to running.
 */
export const A_NARROW_DISPATCHABLE_RUN_STATES: ReadonlyArray<RunState> = [
  "ready",
  "running",
  "waiting_user",
];

/**
 * Guards one actual side effect.
 *
 * Throws a `ProductError` when the effect is not allowed. The caller must not catch it
 * and continue: the whole point is that an unauthorized effect never happens.
 */
export function guardExecution(
  binding: ExecutionBinding,
  effect: GuardedEffect,
  facts: ExecutionGuardFacts | undefined,
): void {
  if (facts === undefined || facts === null) {
    throw new ProductError(
      "RUN_SCOPE_REQUIRED",
      "The guard needs the durable run, grant and attempt facts; without them it cannot authorize anything",
    );
  }

  assertBinding(binding);
  validateAgentDefinition("ExecutionBinding", binding);
  assertRunIdentity(binding, facts);

  if (effect.kind === "safe_control") {
    // A safe control only tightens: it checks who is asking and which run they mean.
    // It must stay available when the grant is gone or a gate is open.
    if (facts.run.state === "cancelled" && effect.control === "pause") {
      throw new ProductError("RUN_PLAN_STALE", "The run was already cancelled", {
        details: { state: facts.run.state },
      });
    }
    return;
  }

  if (effect.kind === "review_impact_prepare" || effect.kind === "approved_prepared_adoption") {
    assertNarrowEffect(effect, facts, binding);
    return;
  }

  assertAction(effect.action);
  assertRunDispatchable(facts);
  assertScope(facts, binding);
  assertGrant(facts, binding);
  assertAttempt(facts, binding);
  assertStageAndGates(effect, facts);
}

function assertBinding(binding: ExecutionBinding): void {
  if (binding.plan_version !== 1) {
    throw new ProductError("RUN_PLAN_STALE", "Only plan version 1 is dispatchable in this round", {
      details: { plan_version: binding.plan_version },
    });
  }
  if (binding.run_id.length === 0) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The execution binding has no run");
  }
  if (binding.attempt < 1) {
    throw new ProductError("INVALID_REQUEST", "The execution binding has no attempt number", {
      details: { attempt: binding.attempt },
    });
  }
  if (binding.authorization_id.length === 0) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The execution binding has no authorization");
  }
  assertDigest(binding.input_digest, "input_digest");
  assertDigest(binding.run_scope_digest, "run_scope_digest");
}

function assertRunIdentity(binding: ExecutionBinding, facts: ExecutionGuardFacts): void {
  if (facts.run.run_id !== binding.run_id) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The binding does not belong to this run", {
      details: { expected: facts.run.run_id, received: binding.run_id },
    });
  }
  if (facts.run.current_plan_version !== binding.plan_version) {
    throw new ProductError("RUN_PLAN_STALE", "The run moved on since this binding was made", {
      details: { expected: facts.run.current_plan_version, received: binding.plan_version },
    });
  }
}

function assertAction(action: GuardedAction): void {
  if (!A_ALLOWED_ACTIONS.includes(action)) {
    throw new ProductError("CAPABILITY_UNAVAILABLE", "This action is not part of the fixed workflow", {
      details: { action },
    });
  }
}

function assertRunDispatchable(facts: ExecutionGuardFacts): void {
  if (!A_DISPATCHABLE_RUN_STATES.includes(facts.run.state)) {
    throw new ProductError("RUN_PLAN_STALE", "The run is not in a state that allows a new effect", {
      details: { state: facts.run.state },
    });
  }
}

/**
 * Validates the run's own scope and recomputes its digest.
 *
 * The digest is recomputed here rather than compared against a value the caller
 * supplied: the run row holds the scope, and if the two disagree then something wrote a
 * scope that does not belong to this run.
 */
function assertScope(facts: ExecutionGuardFacts, binding: ExecutionBinding): void {
  const scope = facts.run.scope;
  validateAgentDefinition("RunScope", scope);
  assertAbleScope(scope);
  const recomputed = canonicalDigest(scope);
  if (recomputed !== facts.run.run_scope_digest) {
    throw new ProductError("RUN_PLAN_STALE", "The stored scope does not match its own digest", {
      details: { expected: facts.run.run_scope_digest, received: recomputed },
    });
  }
  if (facts.run.run_scope_digest !== binding.run_scope_digest) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The binding does not belong to this run scope", {
      details: { expected: facts.run.run_scope_digest, received: binding.run_scope_digest },
    });
  }
  if (scope.run_id !== facts.run.run_id) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The stored scope belongs to another run", {
      details: { expected: facts.run.run_id, received: scope.run_id },
    });
  }
  if (scope.project_id !== facts.project_id) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The stored scope belongs to another project", {
      details: { expected: facts.project_id, received: scope.project_id },
    });
  }
  if (scope.input_digest !== binding.input_digest) {
    throw new ProductError("RUN_PLAN_STALE", "The binding input does not match the run input", {
      details: { expected: scope.input_digest, received: binding.input_digest },
    });
  }
}

function assertGrant(facts: ExecutionGuardFacts, binding: ExecutionBinding): void {
  const grant = facts.grant;
  if (grant === null || grant === undefined) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The run has no authorization for this effect");
  }
  if (grant.grant_id !== binding.authorization_id) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The binding names another authorization", {
      details: { expected: grant.grant_id, received: binding.authorization_id },
    });
  }
  if (grant.run_scope_digest !== facts.run.run_scope_digest) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization belongs to a different scope");
  }
  if (grant.state !== "active") {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization is not active", {
      details: { state: grant.state },
    });
  }
  if (!Number.isSafeInteger(grant.issued_at) || grant.issued_at > facts.now_epoch_seconds || grant.issued_at >= grant.expires_at) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization is not yet valid or lacks its issuance facts");
  }
  if (facts.now_epoch_seconds >= grant.expires_at) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The authorization has expired", {
      details: { expires_at: grant.expires_at, now: facts.now_epoch_seconds },
    });
  }
  if (grant.principal_id !== facts.principal_id) {
    throw new ProductError("UNAUTHORIZED", "The authorization belongs to another principal", {
      details: { expected: grant.principal_id, received: facts.principal_id },
    });
  }
}

function assertAttempt(facts: ExecutionGuardFacts, binding: ExecutionBinding): void {
  const attempt = facts.attempt;
  if (attempt === null || attempt === undefined) {
    throw new ProductError("RUN_PLAN_STALE", "The step has no durable attempt to continue");
  }
  if (attempt.step_id !== binding.step_id) {
    throw new ProductError("RUN_PLAN_STALE", "The binding names another step", {
      details: { expected: attempt.step_id, received: binding.step_id },
    });
  }
  if (attempt.attempt !== binding.attempt) {
    throw new ProductError("RUN_PLAN_STALE", "The attempt is not the current attempt of this step", {
      details: { expected: attempt.attempt, received: binding.attempt },
    });
  }
  if (attempt.input_digest !== binding.input_digest) {
    throw new ProductError("RUN_PLAN_STALE", "The attempt was made against another input", {
      details: { expected: attempt.input_digest, received: binding.input_digest },
    });
  }
  if (attempt.grant_id !== binding.authorization_id) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The attempt was made under another authorization");
  }
  if (!A_DISPATCHABLE_ATTEMPT_STATES.includes(attempt.state)) {
    throw new ProductError("RUN_PLAN_STALE", "The attempt is over", {
      details: { state: attempt.state },
    });
  }
}

/**
 * The two narrow Host-only effects.
 *
 * They are the two things that happen while a run waits for a decision: preparing the
 * impact of the reviewed product, and consuming an approval to adopt it. They are
 * narrow on purpose. The run's identity, scope, grant and attempt still have to hold,
 * the run has to be in a state where a decision can be acted on, and the effect has to
 * be about the very package, approval and impact it names.
 *
 * What they do NOT do is widen the ordinary dispatch: an ordinary action is still
 * refused in `waiting_user`, a paused or cancelled or stale run is refused, and the
 * gate that is open is only the one of the reviewed product.
 */
function assertNarrowEffect(
  effect: Extract<GuardedEffect, { kind: "review_impact_prepare" | "approved_prepared_adoption" }>,
  facts: ExecutionGuardFacts,
  binding: ExecutionBinding,
): void {
  assertRunIdentity(binding, facts);
  assertScope(facts, binding);
  assertGrant(facts, binding);
  assertAttemptIdentity(facts, binding);
  if (!A_NARROW_DISPATCHABLE_RUN_STATES.includes(facts.run.state)) {
    throw new ProductError("RUN_PLAN_STALE", "The run is not in a state that allows this effect", {
      details: { state: facts.run.state },
    });
  }
  // The effect stands for one of the two ordinary actions, and it is checked the same
  // way: the fixed stage has to allow the action, the action has to be inside the
  // authorized scope, and every predecessor gate has to be accepted. The current
  // stage's own review gate is not a prerequisite in the fixed stage table.
  const action: GuardedAction = effect.kind === "review_impact_prepare" ? "change.prepare" : "change.apply";
  assertStageAndAction(binding.step_id, action, facts);
  // Fixed-stage requirements contain predecessors, never the current stage's own
  // review gate. No package identity can exempt a predecessor.
  assertGates(binding.step_id, action, facts);
  if (effect.kind === "review_impact_prepare") {
    const prepared = facts.preparedImpact;
    if (!prepared || prepared.project_id !== facts.project_id ||
      prepared.completed_job.state !== "succeeded" ||
      prepared.completed_job.terminal_reason !== "SOURCE_ONLY" ||
      prepared.completed_job.job_id !== effect.prepared_job_id ||
      prepared.prepared_source_id !== effect.prepared_source_id ||
      prepared.fact_digest !== effect.fact_digest ||
      !effect.prepared_job_id || !/^ps_[a-f0-9]{60}$/.test(effect.prepared_source_id) ||
      !/^[a-f0-9]{64}$/.test(effect.fact_digest)) {
      throw new ProductError("REVIEW_STALE", "The completed prepared source was not proved");
    }
    validateAgentDefinition("ExecutionBinding", prepared.execution);
    if (canonicalDigest(prepared.execution) !== canonicalDigest(binding) ||
      facts.attempt?.state !== "waiting_user") {
      throw new ProductError("RUN_PLAN_STALE", "The prepared proof is not for the current waiting attempt");
    }
    return;
  }
  // The reviewed product is the only thing the effect may act on. A package of
  // another run, of another state, or with another digest is not this effect's.
  const narrow = facts.narrow;
  if (narrow === undefined || narrow === null) {
    throw new ProductError("REVIEW_STALE", "The reviewed package was not read");
  }
  const review = narrow.review;
  if (review === null) {
    throw new ProductError("REVIEW_STALE", "The reviewed package was not read");
  }
  if (review.package_id !== effect.package_id) {
    throw new ProductError("REVIEW_STALE", "The effect names another package", {
      details: { expected: review.package_id, received: effect.package_id },
    });
  }
  {
    // The adoption happens AFTER the trusted decision accepted the product. An
    // adoption of a package that is still pending would be an adoption nobody decided.
    if (review.state !== "accepted") {
      throw new ProductError("REVIEW_STALE", "The reviewed package was not accepted", {
        details: { state: review.state },
      });
    }
    const approval = narrow.approval;
    const impact = narrow.impact;
    if (approval === null) {
      throw new ProductError("APPROVAL_REQUIRED", "The approval was not read");
    }
    if (impact === null) {
      throw new ProductError("IMPACT_REQUIRED", "The impact was not read");
    }
    if (approval.approval_id !== effect.approval_id) {
      throw new ProductError("APPROVAL_REQUIRED", "The effect names another approval", {
        details: { expected: approval.approval_id, received: effect.approval_id },
      });
    }
    if (approval.impact_id !== effect.impact_id || impact.impact_id !== effect.impact_id) {
      throw new ProductError("APPROVAL_REQUIRED", "The approval does not belong to the named impact");
    }
    if (approval.state !== "active") {
      throw new ProductError("APPROVAL_REQUIRED", "The approval is not active", {
        details: { state: approval.state },
      });
    }
    if (impact.state !== "active") {
      throw new ProductError("IMPACT_STALE", "The impact is not active", {
        details: { state: impact.state },
      });
    }
  }
  // Only the gate of the reviewed product is exempt, and it has to exist.
  const gate = facts.gates.find((candidate) => candidate.review_package_id === effect.package_id);
  if (gate === undefined) {
    throw new ProductError("RUN_GATE_BLOCKED", "The run has no gate for the reviewed package", {
      details: { package_id: effect.package_id },
    });
  }
}

/**
 * The identity of the attempt, without the dispatchable states.
 *
 * A narrow effect happens while the run waits for a decision, and the attempt that
 * produced the reviewed product has usually finished. What still has to hold is that
 * it is the current attempt of the step, made against the same input.
 */
function assertAttemptIdentity(facts: ExecutionGuardFacts, binding: ExecutionBinding): void {
  const attempt = facts.attempt;
  if (attempt === null || attempt === undefined) {
    throw new ProductError("RUN_PLAN_STALE", "The step has no durable attempt to continue");
  }
  if (attempt.step_id !== binding.step_id) {
    throw new ProductError("RUN_PLAN_STALE", "The binding names another step", {
      details: { expected: attempt.step_id, received: binding.step_id },
    });
  }
  if (attempt.attempt !== binding.attempt) {
    throw new ProductError("RUN_PLAN_STALE", "The attempt is not the current attempt of this step", {
      details: { expected: attempt.attempt, received: binding.attempt },
    });
  }
  if (attempt.input_digest !== binding.input_digest) {
    throw new ProductError("RUN_PLAN_STALE", "The attempt was made against another input", {
      details: { expected: attempt.input_digest, received: binding.input_digest },
    });
  }
  if (attempt.grant_id !== binding.authorization_id) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The attempt was made under another authorization");
  }
  if (attempt.state === "stale") {
    throw new ProductError("RUN_PLAN_STALE", "The attempt was superseded", {
      details: { state: attempt.state },
    });
  }
}

/**
 * The stage and the action of an effect.
 *
 * It is the same check for the ordinary actions and for the two narrow ones: the
 * effect has to belong to the durable step, the action has to be one the fixed stage
 * allows, and the action has to be inside the authorized scope. A narrow effect is
 * not a way around the fixed plan.
 */
function assertStageAndAction(stage: string, action: GuardedAction, facts: ExecutionGuardFacts): void {
  const allowed = A_STAGE_ACTIONS[stage];
  if (allowed === undefined) {
    throw new ProductError("CAPABILITY_UNAVAILABLE", "Unknown step for this workflow", {
      details: { stage_id: stage },
    });
  }
  if (facts.attempt?.step_id !== stage) {
    throw new ProductError("RUN_PLAN_STALE", "The effect stage does not match the durable step");
  }
  if (!allowed.includes(action)) {
    throw new ProductError("CAPABILITY_UNAVAILABLE", "This action does not belong to this step", {
      details: { stage_id: stage, action, allowed_actions: allowed },
    });
  }
  if (!facts.run.scope.allowed_actions.includes(action)) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The action is outside the authorized scope", {
      details: { action, allowed_actions: facts.run.scope.allowed_actions },
    });
  }
}

/** Checks every predecessor in the fixed stage/action tables. */
function assertGates(
  stage: string,
  action: GuardedAction,
  facts: ExecutionGuardFacts,
): void {
  const required = new Set<RunGate["kind"]>([
    ...(A_STAGE_GATE_REQUIREMENTS[stage] ?? []),
    ...(A_ACTION_GATE_REQUIREMENTS[action] ?? []),
  ]);
  for (const kind of required) {
    const gate = facts.gates.find((candidate) => candidate.kind === kind);
    if (gate === undefined) {
      throw new ProductError("RUN_GATE_BLOCKED", "The run has no gate for this step yet", {
        details: { stage_id: stage, gate_kind: kind },
      });
    }
    if (gate.state !== "accepted") {
      throw new ProductError("RUN_GATE_BLOCKED", "The step is still waiting for a review decision", {
        details: {
          stage_id: stage,
          gate_kind: kind,
          gate_id: gate.gate_id,
          gate_state: gate.state,
        },
      });
    }
  }
}

function assertStageAndGates(effect: Extract<GuardedEffect, { kind: "action" }>, facts: ExecutionGuardFacts): void {
  assertStageAndAction(effect.stage_id, effect.action, facts);
  assertGates(effect.stage_id, effect.action, facts);
}

/**
 * Checks that a scope is a valid A scope.
 *
 * The three `false` flags are part of the frozen `RunScope` type, so a scope that claims
 * otherwise cannot be constructed from the wire — but a scope read from storage could have
 * been written by something else, and the check is cheap.
 */
export function assertAbleScope(scope: RunScope): void {
  if (scope.allow_paid || scope.allow_external_write || scope.allow_runtime_mutation) {
    throw new ProductError("CAPABILITY_UNAVAILABLE", "This round does not authorize paid, external or runtime actions");
  }
  if (scope.template_id !== "local-short-film" || scope.template_version !== 1) {
    throw new ProductError("CAPABILITY_UNAVAILABLE", "Only the fixed local short film template is available");
  }
  for (const action of scope.allowed_actions) {
    if (!A_ALLOWED_ACTIONS.includes(action)) {
      throw new ProductError("CAPABILITY_UNAVAILABLE", "The scope asks for an action this round does not offer", {
        details: { action },
      });
    }
  }
}

function assertDigest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ProductError("INVALID_REQUEST", `The binding ${field} is not a SHA-256 digest`, {
      details: { field },
    });
  }
}

/**
 * Reads the durable facts and guards the effect, in one transaction.
 *
 * This is the call MAIN makes. It opens the transaction, reads the run, the grant, the
 * attempt and the gates from the lane's own records, and then guards the effect against
 * what it just read — so the facts and the check cannot come from different moments.
 *
 * The guard never dispatches anything: it authorizes or refuses. MAIN owns the dispatch.
 */
export async function guardExecutionInTransaction(
  repository: ProductRepository,
  binding: ExecutionBinding,
  effect: GuardedEffect,
  principalId: string,
  options: { readonly project_id: string; readonly now?: () => number },
): Promise<void> {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  await repository.transaction((tx) => {
    guardExecution(
      binding,
      effect,
      readGuardFacts(tx, options.project_id, binding, principalId, now()),
    );
  });
}

/** Reads the guard's facts from the durable records. */
export function readGuardFacts(
  tx: ProductTransaction,
  projectId: string,
  binding: ExecutionBinding,
  principalId: string,
  nowEpochSeconds: number,
): ExecutionGuardFacts {
  const run = findRun(tx, projectId, binding);
  const grant = tx.get("execution_grant", {
    project_id: run.project_id,
    run_id: run.run_id,
    grant_id: binding.authorization_id,
  });
  const confirmation = grant === null ? null : trustedGrantConfirmation(tx, run, grant, nowEpochSeconds);
  const attempts = tx.list("step_attempt", {
    project_id: run.project_id,
    run_id: run.run_id,
    step_id: binding.step_id,
  });
  const current = attempts
    .filter((candidate) => candidate.plan_version === run.current_plan_version)
    .sort((left, right) => right.attempt - left.attempt)[0] ?? null;
  return {
    project_id: run.project_id,
    run: {
      run_id: run.run_id,
      current_plan_version: run.current_plan_version,
      state: run.state,
      scope: run.scope_json,
      run_scope_digest: run.run_scope_digest,
    },
    grant: grant === null || confirmation === null
      ? null
      : {
          grant_id: grant.grant_id,
          run_scope_digest: grant.run_scope_digest,
          principal_id: grant.principal_id,
          state: grant.state,
          issued_at: confirmation.issued_at,
          expires_at: grant.expires_at,
        },
    attempt: current === null
      ? null
      : {
          step_id: current.step_id,
          attempt: current.attempt,
          state: current.state,
          input_digest: current.input_digest,
          grant_id: current.grant_id,
        },
    gates: run.checkpoint_json.gates,
    principal_id: principalId,
    now_epoch_seconds: nowEpochSeconds,
  };
}

function findRun(
  tx: ProductTransaction,
  projectId: string,
  binding: ExecutionBinding,
): RunRecord {
  const run = tx.get("run", { project_id: projectId, run_id: binding.run_id });
  if (run === null) {
    throw new ProductError("NOT_FOUND", "No such run", {
      details: { project_id: projectId, run_id: binding.run_id },
    });
  }
  return run;
}
