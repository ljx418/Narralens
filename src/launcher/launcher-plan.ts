/**
 * Pure launcher planning (BRIDGE / E06, case A-COLD).
 *
 * Every decision the launcher makes is expressed here as a total function over plain
 * data, with no I/O and no clock of its own. The supervisor in `service-supervisor.ts`
 * only supplies facts and executes the resulting plan. That split is what makes the
 * cold/hot/duplicate/shared rules auditable: they can be read, and tested, without
 * starting a process.
 *
 * The three rules this module encodes:
 *
 * - **Cold start** — nothing is running for the runtime root, so a new generation is
 *   launched. The generation continues the sequence reported by discovery; it never
 *   restarts at 1 for a root that has been used before, because clients persist
 *   `instance_generation` inside signed cursors.
 * - **Hot start / duplicate start** — an owned instance is already running, so the
 *   request attaches to it. No second process is created, and the generation does not
 *   move. Two concurrent start requests for the same root must therefore converge on
 *   one instance; the supervisor enforces that with an in-flight map, and the plan
 *   itself is what both callers end up agreeing on.
 * - **Shared instance** — an instance owned by somebody else is attached, never
 *   adopted and never stopped. Attaching does not change ownership, so a later stop
 *   request against it is refused rather than killing somebody else's process.
 */

import type { DiscoveredRuntime, LauncherInstance, ServiceOwnership } from "./launcher-types.js";

/**
 * What a start request resolved to.
 *
 * `start` — a new process was launched by this launcher (cold start).
 * `reuse` — an owned instance was already running and was reused (hot/duplicate start).
 * `attach` — a shared instance was adopted for reading only; it was not started here
 * and must never be stopped here.
 */
export type LaunchAction = "start" | "reuse" | "attach";

export interface LaunchPlan {
  readonly action: LaunchAction;
  readonly generation: number;
  readonly ownership: ServiceOwnership;
  /** A stable, machine-readable explanation. Never contains a path or a credential. */
  readonly reason: string;
}

/**
 * Decide what a start request should do.
 *
 * @param discovered what discovery found for the runtime root.
 */
export function planLaunch(discovered: DiscoveredRuntime): LaunchPlan {
  const running = discovered.running;
  if (running === null) {
    return {
      action: "start",
      generation: discovered.last_generation + 1,
      ownership: "owned",
      reason: "no_running_instance",
    };
  }
  if (running.ownership === "shared") {
    return {
      action: "attach",
      generation: running.generation,
      ownership: "shared",
      reason: "shared_instance_attached",
    };
  }
  return {
    action: "reuse",
    generation: running.generation,
    ownership: "owned",
    reason: "owned_instance_reused",
  };
}

export interface StopDecision {
  readonly allowed: boolean;
  /** Stable, machine-readable explanation. */
  readonly reason: string;
}

/**
 * Decide whether a stop request may proceed.
 *
 * The only instance this launcher may stop is one it owns. A shared instance is
 * refused with `shared_instance_not_owned`, and an instance the launcher has never seen
 * is refused with `unknown_instance` — refusing is always the safe direction, because
 * the alternative is killing a process whose owner and active jobs are unknown.
 */
export function planStop(instance: LauncherInstance | null): StopDecision {
  if (instance === null) {
    return { allowed: false, reason: "unknown_instance" };
  }
  if (instance.ownership === "shared") {
    return { allowed: false, reason: "shared_instance_not_owned" };
  }
  if (instance.state === "stopped") {
    return { allowed: false, reason: "already_stopped" };
  }
  return { allowed: true, reason: "owned_instance_stop_allowed" };
}

export type HealthPlanState = "starting" | "ready" | "degraded" | "stopped" | "unknown";

export interface HealthPlan {
  readonly state: HealthPlanState;
  readonly reason: string;
}

/**
 * Decide the state of a service from its last observation and the current time.
 *
 * The launcher does not keep a background timer. Health is a function of the last
 * recorded sample and the TTL, so a service that stopped answering simply becomes
 * `unknown` — it is never left reporting `ready` forever, and it is never reported as
 * `ready` because it was ready once.
 */
export function planHealth(input: {
  readonly lastState: Exclude<HealthPlanState, "unknown">;
  readonly reason: string;
  readonly sampledAtMs: number;
  readonly nowMs: number;
  readonly staleAfterMs: number;
}): HealthPlan {
  if (input.nowMs - input.sampledAtMs >= input.staleAfterMs) {
    return { state: "unknown", reason: "sample_expired" };
  }
  return { state: input.lastState, reason: input.reason };
}

/**
 * Roll the per-service health up into the instance-level health the contract exposes.
 *
 * The roll-up fails closed. A state that is not positive evidence of readiness is
 * never reported as readiness:
 *
 * - a stopped instance is `degraded`, not `ready` — it is not serving, and saying
 *   "ready" would invite a client to send work to a process that is gone;
 * - a stopped, degraded or unknown service degrades the whole instance, and an
 *   unknown service in particular is *not* neutral: it means the registry can no
 *   longer tell whether the service is alive;
 * - only then does `starting` apply, for an instance or a required service that is
 *   still coming up;
 * - `ready` is the answer only when everything is observed ready.
 *
 * The service states passed in must be the states of *this* instance's services.
 * The caller is responsible for scoping them; the registry can hold several
 * instances at once.
 */
export function planInstanceHealth(input: {
  readonly instanceState: LauncherInstance["state"];
  readonly serviceStates: readonly HealthPlanState[];
}): "ready" | "degraded" | "starting" {
  if (input.instanceState === "stopped") return "degraded";
  if (input.instanceState === "degraded") return "degraded";
  if (input.serviceStates.some((state) => state === "stopped" || state === "degraded" || state === "unknown")) {
    return "degraded";
  }
  if (input.instanceState === "starting") return "starting";
  if (input.serviceStates.some((state) => state === "starting")) return "starting";
  return "ready";
}
