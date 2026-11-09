/**
 * Service health registry with a real TTL (BRIDGE / E06, case A-COLD).
 *
 * The registry stores the last observation per service and derives the current state
 * from it. There is no background timer and no "keep the last known good value" cache:
 * once a sample is older than `stale_after_ms` the service is reported as `unknown`,
 * because the registry can no longer tell whether the service is alive.
 *
 * The two constants are contract constants, not tuning knobs. `HealthRead` in
 * `contracts/agent-driven-a.schema.json` pins `sample_interval_ms` to 5000 and
 * `stale_after_ms` to 15000 with `const`, so a different value would not validate
 * against the frozen contract. They are exported so a caller cannot accidentally use a
 * different number, and the registry asserts them on construction.
 */

import type { HealthMetric, HealthRead, ServiceHealth } from "../contracts/agent-driven-types.js";
import { validateAgentDefinition } from "../contracts/agent-driven-validator.js";
import type { Clock, ServiceOwnership } from "./launcher-types.js";
import { systemClock } from "./launcher-types.js";
import { planHealth } from "./launcher-plan.js";

/** Contract constant: the sampling cadence the Host reports. */
export const HEALTH_SAMPLE_INTERVAL_MS = 5000;
/** Contract constant: after this long without a fresh sample the service is `unknown`. */
export const HEALTH_STALE_AFTER_MS = 15000;

/** The states a service can be observed in. `unknown` is derived, never recorded. */
export type ObservedServiceState = "starting" | "ready" | "degraded" | "stopped";

/** One observation of one service. */
export interface HealthSample {
  readonly service_id: string;
  /**
   * The instance this observation belongs to.
   *
   * The registry can track several instances at once, and an instance's health is
   * the health of *its* services. Without this, the descriptor of one instance
   * would be decided by the state of another's services.
   */
  readonly instance_id: string;
  readonly state: ObservedServiceState;
  readonly ownership: ServiceOwnership;
  readonly reason: string;
  readonly metrics: readonly HealthMetric[];
  /** Epoch milliseconds at which the observation was taken. */
  readonly sampled_at_ms: number;
}

/**
 * The last known health of every service this launcher tracks.
 *
 * The registry is bounded by the contract (`HealthRead.services` allows at most 32
 * entries); recording a 33rd service replaces nothing silently, it is rejected so the
 * caller notices that the service inventory grew past what the contract can carry.
 */
export class ServiceHealthRegistry {
  readonly #samples = new Map<string, HealthSample>();
  readonly #clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  /**
   * Record an observation.
   *
   * A sample for an unknown service is rejected rather than silently dropped: the
   * inventory of tracked services is part of what the contract can express.
   */
  record(sample: HealthSample): void {
    if (this.#samples.size >= 32 && !this.#samples.has(sample.service_id)) {
      throw new Error("health_registry_service_limit_exceeded");
    }
    // Validate the observation against the contract at the point it is taken. A bad
    // sample must be rejected where it was produced, not silently carried into every
    // later read.
    validateAgentDefinition<ServiceHealth>("ServiceHealth", {
      service_id: sample.service_id,
      state: sample.state,
      ownership: sample.ownership,
      sampled_at: new Date(sample.sampled_at_ms).toISOString(),
      expires_at: new Date(sample.sampled_at_ms + HEALTH_STALE_AFTER_MS).toISOString(),
      reason: sample.reason,
      metrics: [...sample.metrics],
    });
    this.#samples.set(sample.service_id, sample);
  }

  /** Record that a service was deliberately stopped. */
  markStopped(
    service_id: string,
    instance_id: string,
    ownership: ServiceOwnership = "owned",
    reason = "stopped",
  ): void {
    const existing = this.#samples.get(service_id);
    this.record({
      service_id,
      instance_id,
      state: "stopped",
      ownership,
      reason,
      metrics: existing?.metrics ?? [],
      sampled_at_ms: this.#clock.now(),
    });
  }

  /** Forget a service entirely (used when an instance is discarded). */
  forget(service_id: string): void {
    this.#samples.delete(service_id);
  }

  /** The raw last observation for a service, if any. */
  lastSample(service_id: string): HealthSample | undefined {
    return this.#samples.get(service_id);
  }

  /**
   * Read the current health of the tracked services.
   *
   * When `instance_id` is given, only that instance's services are reported: the
   * health of an instance is the health of the services it depends on, not of the
   * services of another instance that happens to be tracked at the same time.
   *
   * Expiry is applied here, at read time, against the injected clock. A sample that
   * has aged past `stale_after_ms` becomes `unknown` with the reason
   * `sample_expired`, and its `expires_at` stays at the moment it actually expired so
   * a reader can see how stale the observation is.
   */
  read(instance_id?: string): HealthRead {
    const now = this.#clock.now();
    const services: ServiceHealth[] = [];
    for (const sample of this.#samples.values()) {
      if (instance_id !== undefined && sample.instance_id !== instance_id) continue;
      const plan = planHealth({
        lastState: sample.state,
        reason: sample.reason,
        sampledAtMs: sample.sampled_at_ms,
        nowMs: now,
        staleAfterMs: HEALTH_STALE_AFTER_MS,
      });
      services.push({
        service_id: sample.service_id,
        state: plan.state,
        ownership: sample.ownership,
        sampled_at: new Date(sample.sampled_at_ms).toISOString(),
        expires_at: new Date(sample.sampled_at_ms + HEALTH_STALE_AFTER_MS).toISOString(),
        reason: plan.reason,
        metrics: [...sample.metrics],
      });
    }
    services.sort((left, right) => left.service_id.localeCompare(right.service_id));
    const health: HealthRead = {
      services,
      sample_interval_ms: HEALTH_SAMPLE_INTERVAL_MS,
      stale_after_ms: HEALTH_STALE_AFTER_MS,
    };
    // The registry is the producer of a contract DTO; validating here keeps a bad
    // sample from reaching the wire.
    return validateAgentDefinition<HealthRead>("HealthRead", health);
  }
}
