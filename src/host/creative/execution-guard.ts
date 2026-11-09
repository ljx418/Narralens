/**
 * The single gate every actual side effect has to pass.
 *
 * MAIN calls `guardExecution` before it dispatches a job, prepares a change, applies a
 * change, loads a runtime or publishes a delivery. The reason it exists separately from
 * the run service is that the run service is not the only thing that produces side
 * effects: MAIN's own change and delivery paths do too, and the contract is explicit that
 * "所有副作用入口共同执行的门" — the same gate, not one gate per call site.
 *
 * The guard checks the things that can be checked without guessing:
 *
 * - the binding is a well-formed `ExecutionBinding` for plan version 1;
 * - the action is one of the fixed A actions, and it is inside the run's own scope;
 * - the scope itself is a valid A scope (paid, external write and runtime mutation are
 *   all false, and the actions are a subset of the frozen set);
 * - the gates the action depends on are accepted.
 *
 * What the guard deliberately does **not** do: it never marks a gate accepted, never
 * advances a step and never creates an artifact. A guard that also progresses the
 * workflow is a workflow engine wearing a validator's coat — the acceptance of a gate is
 * a decision, and a decision has to be recorded by the decision path.
 */

import type { ExecutionBinding, RunGate, RunScope } from "../../contracts/agent-driven-types.js";
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

/**
 * The gates each fixed stage depends on.
 *
 * This is the "样片之后，稳定前另审首章" rule in its executable form: `first_chapter` may
 * not be dispatched until the `sample` gate is accepted, and `chapters` may not be
 * dispatched until `first_chapter` is accepted. A stability authorization would relax the
 * first-chapter gate in B; A has no such authorization, so the gate stays.
 */
export const A_STAGE_GATE_REQUIREMENTS: Readonly<Record<string, ReadonlyArray<RunGate["kind"]>>> = {
  definition: [],
  sample: ["definition"],
  first_chapter: ["sample"],
  chapters: ["first_chapter"],
  cover: ["chapters"],
  delivery: ["cover", "qc", "adoption"],
};

/** The context the guard reads the durable facts from. */
export interface ExecutionGuardContext {
  /**
   * The run's scope, read from the durable `cp_a0_run.scope_json` — never from the client.
   */
  readonly scope: RunScope;
  /**
   * The run's scope digest, as the durable `cp_a0_run.run_scope_digest` records it. The
   * digest is not part of the scope itself, so it is passed separately.
   */
  readonly run_scope_digest: string;
  /** The run's gates, read from the durable checkpoint in the same transaction. */
  readonly gates: ReadonlyArray<RunGate>;
  /**
   * The stage the action belongs to. The guard needs it to resolve the gate
   * requirements; a side effect that is not part of a fixed stage (a change preparation,
   * for example) states the stage it serves.
   */
  readonly stage_id?: string;
}

/**
 * Guards one actual side effect.
 *
 * Throws a `ProductError` when the effect is not allowed. The caller must not catch it
 * and continue: the whole point is that an unauthorized effect never happens.
 */
export function guardExecution(
  binding: ExecutionBinding,
  action: GuardedAction,
  context?: ExecutionGuardContext,
): void {
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

  if (!A_ALLOWED_ACTIONS.includes(action)) {
    throw new ProductError("CAPABILITY_UNAVAILABLE", "This action is not part of the fixed workflow", {
      details: { action },
    });
  }

  if (context === undefined) return;

  const { scope, gates } = context;
  assertAbleScope(scope);
  if (context.run_scope_digest !== binding.run_scope_digest) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The binding does not belong to this run scope", {
      details: { expected: context.run_scope_digest, received: binding.run_scope_digest },
    });
  }
  if (scope.run_id !== binding.run_id) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The binding does not belong to this run", {
      details: { expected: scope.run_id, received: binding.run_id },
    });
  }
  if (!scope.allowed_actions.includes(action)) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The action is outside the authorized scope", {
      details: { action, allowed_actions: scope.allowed_actions },
    });
  }
  if (scope.input_digest !== binding.input_digest) {
    throw new ProductError("RUN_PLAN_STALE", "The binding input does not match the run input", {
      details: { expected: scope.input_digest, received: binding.input_digest },
    });
  }

  if (context.stage_id === undefined) return;
  const required = A_STAGE_GATE_REQUIREMENTS[context.stage_id];
  if (required === undefined) {
    throw new ProductError("CAPABILITY_UNAVAILABLE", "Unknown stage for this workflow", {
      details: { stage_id: context.stage_id },
    });
  }
  for (const kind of required) {
    const gate = gates.find((candidate) => candidate.kind === kind);
    if (gate === undefined) {
      throw new ProductError("RUN_GATE_BLOCKED", "The run has no gate for this stage yet", {
        details: { stage_id: context.stage_id, gate_kind: kind },
      });
    }
    if (gate.state !== "accepted") {
      throw new ProductError("RUN_GATE_BLOCKED", "The stage is still waiting for a review decision", {
        details: {
          stage_id: context.stage_id,
          gate_kind: kind,
          gate_id: gate.gate_id,
          gate_state: gate.state,
        },
      });
    }
  }
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
