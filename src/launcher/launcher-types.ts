/**
 * Launcher domain types (BRIDGE / E06).
 *
 * The launcher is the only part of Narralens that is allowed to *start* and *stop* the
 * Host process. Everything in this module is pure: it decides what should happen and
 * delegates every effect to an injected port that MAIN implements against the real
 * process manager.
 *
 * Two rules are structural here and are not negotiable by a caller:
 *
 * 1. **Ownership is a fact, not an option.** An instance this launcher started is
 *    `owned` and may be stopped. An instance someone else started is `shared` and may
 *    never be stopped, killed or unloaded by this launcher. A shared instance is also
 *    never "taken over": attaching to it does not change its ownership, because the
 *    instance identity, generation and process belong to whoever created them.
 * 2. **Process liveness is not readiness.** `pid` says a process exists. Only a probe
 *    against the instance endpoint says the API is ready. The launcher keeps the two
 *    apart so a running-but-not-listening process is reported as `starting`, not
 *    `ready`.
 */

import type { HealthMetric } from "../contracts/agent-driven-types.js";

/**
 * Who owns the lifetime of an instance.
 *
 * `owned` — this launcher created the process and may stop it.
 * `shared` — another launcher (or the user) created the process; this launcher may
 * attach and read, but never stops it.
 */
export type ServiceOwnership = "owned" | "shared";

/**
 * The launcher's view of an instance's state.
 *
 * This is deliberately narrower than the contract's `ServiceHealth.state`: the launcher
 * only ever claims `ready` after a successful probe, and never claims `unknown` for an
 * instance it is tracking (an expired *health sample* is unknown, but the instance
 * itself is still either running or stopped).
 */
export type LauncherInstanceState = "starting" | "ready" | "degraded" | "stopped";

/** A single Narralens Host instance as the launcher sees it. */
export interface LauncherInstance {
  /** Stable identity of the logical instance (not of the process). */
  readonly instance_id: string;
  /** Increments on every fresh launch of the same logical instance. */
  readonly generation: number;
  readonly ownership: ServiceOwnership;
  /** Base URL of the Host API for this instance. */
  readonly endpoint: string;
  /** Operating system process id, or `null` when the instance is not a local process. */
  readonly pid: number | null;
  /** ISO timestamp of the launch that produced this generation. */
  readonly started_at: string;
  readonly state: LauncherInstanceState;
}

/**
 * What discovery found for a runtime root.
 *
 * `last_generation` survives the process: after a controlled stop, discovery still
 * reports which generation was last used so a restart continues the sequence instead of
 * reusing a generation number that a client may already have cached in a cursor.
 */
export interface DiscoveredRuntime {
  readonly running: LauncherInstance | null;
  readonly last_generation: number;
}

/** Injectable clock. Health TTL and expiry are never read from the ambient clock. */
export interface Clock {
  now(): number;
}

/** The real wall clock. */
export const systemClock: Clock = { now: () => Date.now() };

/**
 * Finds the instance bound to a runtime root.
 *
 * MAIN implements this against the real process/pid-file store. The launcher only ever
 * *reads* through it.
 */
export interface InstanceDiscoveryPort {
  discover(input: { readonly runtime_root: string }): Promise<DiscoveredRuntime>;
}

/**
 * Starts and stops instances.
 *
 * MAIN implements this against the real process manager. The launcher never spawns a
 * process itself, which is what keeps this module testable and keeps process ownership
 * in one place.
 */
export interface InstanceLaunchPort {
  launch(input: {
    readonly runtime_root: string;
    readonly instance_id: string;
    readonly generation: number;
  }): Promise<{ readonly pid: number; readonly endpoint: string }>;
  stop(input: {
    readonly instance_id: string;
    readonly generation: number;
    readonly pid: number | null;
  }): Promise<void>;
}

/** The result of a readiness probe against one instance. */
export interface InstanceProbeResult {
  readonly ready: boolean;
  readonly reason: string;
  readonly metrics: readonly HealthMetric[];
}

/**
 * Probes readiness.
 *
 * A probe is the only thing that can promote an instance to `ready`. The launcher never
 * infers readiness from a pid, a port being open, or the passage of time.
 */
export interface InstanceProbePort {
  probe(input: {
    readonly instance_id: string;
    readonly endpoint: string;
  }): Promise<InstanceProbeResult>;
}
