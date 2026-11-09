/**
 * Launcher supervisor (BRIDGE / E06, case A-COLD).
 *
 * The supervisor is the only stateful object in the launcher. It owns three things:
 *
 * - which instances it has seen and who owns them,
 * - the in-flight map that makes a duplicate start converge on one process,
 * - the health registry it feeds from probe results.
 *
 * Every effect goes through an injected port. The supervisor never spawns a process,
 * never opens a socket and never touches the filesystem: MAIN implements
 * `InstanceDiscoveryPort`, `InstanceLaunchPort` and `InstanceProbePort` against the
 * real process manager and registers the result with the Host.
 *
 * The single-instance guarantee is only as good as the discovery port, because
 * discovery is the authority on "what is running for this runtime root". The
 * supervisor adds two things on top of it: concurrent duplicate starts join the same
 * launch instead of racing, and a shared instance is never stopped.
 */

import type { HealthMetric, HealthRead, Instance } from "../contracts/agent-driven-types.js";
import { validateAgentDefinition } from "../contracts/agent-driven-validator.js";
import type {
  Clock,
  DiscoveredRuntime,
  InstanceDiscoveryPort,
  InstanceLaunchPort,
  InstanceProbePort,
  LauncherInstance,
} from "./launcher-types.js";
import { systemClock } from "./launcher-types.js";
import { planInstanceHealth, planLaunch, planStop, type LaunchAction } from "./launcher-plan.js";
import { ServiceHealthRegistry } from "./health-registry.js";

export interface LaunchOutcome {
  readonly action: LaunchAction;
  readonly instance: LauncherInstance;
  /** True only when this call actually started a process. */
  readonly launched: boolean;
  readonly reason: string;
}

export interface StopOutcome {
  readonly stopped: boolean;
  readonly reason: string;
}

export interface LauncherSupervisorOptions {
  readonly discovery: InstanceDiscoveryPort;
  readonly launch: InstanceLaunchPort;
  readonly probe: InstanceProbePort;
  readonly health?: ServiceHealthRegistry;
  readonly clock?: Clock;
  /**
   * Capabilities reported by the instance descriptor.
   *
   * MAIN owns the real capability list; the launcher only carries it. An empty list
   * is contract-valid and means "not declared here", not "nothing exists".
   */
  readonly capabilities?: Instance["capabilities"];
}

export interface StartRequest {
  /** Persistent directory that identifies the runtime root. */
  readonly runtime_root: string;
  /** Stable logical identity of the instance MAIN wants to run in this root. */
  readonly instance_id: string;
}

export class LauncherSupervisor {
  readonly #discovery: InstanceDiscoveryPort;
  readonly #launch: InstanceLaunchPort;
  readonly #probe: InstanceProbePort;
  readonly #health: ServiceHealthRegistry;
  readonly #clock: Clock;
  readonly #capabilities: Instance["capabilities"];
  readonly #tracked = new Map<string, LauncherInstance>();
  readonly #inflight = new Map<string, Promise<LaunchOutcome>>();

  constructor(options: LauncherSupervisorOptions) {
    this.#discovery = options.discovery;
    this.#launch = options.launch;
    this.#probe = options.probe;
    this.#health = options.health ?? new ServiceHealthRegistry(options.clock ?? systemClock);
    this.#clock = options.clock ?? systemClock;
    this.#capabilities = options.capabilities ?? [];
  }

  /**
   * Start (or attach to) the instance for a runtime root.
   *
   * Concurrent duplicate requests for the same root share one launch: the second
   * caller awaits the first caller's promise and receives the same instance, so two
   * windows opening at once cannot produce two processes.
   */
  async start(request: StartRequest): Promise<LaunchOutcome> {
    const key = request.runtime_root;
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const promise = this.#startOnce(request);
    this.#inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.#inflight.delete(key);
    }
  }

  async #startOnce(request: StartRequest): Promise<LaunchOutcome> {
    const discovered = await this.#discovery.discover({ runtime_root: request.runtime_root });
    const tracked = this.#tracked.get(request.instance_id);
    if (tracked !== undefined && discovered.running === null && tracked.state !== "stopped") {
      // The instance this supervisor started is no longer discoverable: it died.
      // It is reported as stopped rather than silently reused, and the next launch
      // continues with a new generation.
      this.#tracked.set(request.instance_id, { ...tracked, state: "stopped" });
      this.#health.markStopped(request.instance_id, request.instance_id, tracked.ownership, "instance_disappeared");
    }

    const effective: DiscoveredRuntime = discovered.running === null
      ? discovered
      : { running: discovered.running, last_generation: discovered.last_generation };
    const plan = planLaunch(effective);

    if (plan.action === "start") {
      const launched = await this.#launch.launch({
        runtime_root: request.runtime_root,
        instance_id: request.instance_id,
        generation: plan.generation,
      });
      const instance: LauncherInstance = {
        instance_id: request.instance_id,
        generation: plan.generation,
        ownership: "owned",
        endpoint: launched.endpoint,
        pid: launched.pid,
        started_at: new Date(this.#clock.now()).toISOString(),
        state: "starting",
      };
      this.#tracked.set(instance.instance_id, instance);
      // A freshly launched process is probed once. It usually is not listening yet,
      // and the honest answer then is "starting" — never "ready" because a pid
      // exists.
      const probe = await this.#probeSafely(instance);
      const state = probe.ready ? "ready" : "starting";
      const settled: LauncherInstance = { ...instance, state };
      this.#tracked.set(settled.instance_id, settled);
      this.#health.record({
        service_id: settled.instance_id,
        instance_id: settled.instance_id,
        state,
        ownership: "owned",
        reason: probe.ready ? probe.reason : plan.reason,
        metrics: probe.metrics,
        sampled_at_ms: this.#clock.now(),
      });
      return { action: plan.action, instance: settled, launched: true, reason: plan.reason };
    }

    // Reuse or attach: the process already exists. Probe it for readiness instead of
    // assuming that a running process is a serving one.
    const running = effective.running;
    if (running === null) {
      // Unreachable: planLaunch only returns reuse/attach when something is running.
      throw new Error("launch_plan_inconsistent");
    }
    const instance: LauncherInstance = { ...running, ownership: plan.ownership };
    this.#tracked.set(instance.instance_id, instance);
    const probe = await this.#probeSafely(instance);
    const state = probe.ready ? "ready" : "starting";
    this.#tracked.set(instance.instance_id, { ...instance, state });
    this.#health.record({
      service_id: instance.instance_id,
      instance_id: instance.instance_id,
      state,
      ownership: plan.ownership,
      reason: probe.reason,
      metrics: probe.metrics,
      sampled_at_ms: this.#clock.now(),
    });
    return {
      action: plan.action,
      instance: { ...instance, state },
      launched: false,
      reason: plan.reason,
    };
  }

  async #probeSafely(instance: LauncherInstance): Promise<{
    ready: boolean;
    reason: string;
    metrics: readonly HealthMetric[];
  }> {
    try {
      const result = await this.#probe.probe({
        instance_id: instance.instance_id,
        endpoint: instance.endpoint,
      });
      return { ready: result.ready, reason: result.reason, metrics: result.metrics };
    } catch {
      // A probe that throws is "not ready", never "ready because the error happened".
      return { ready: false, reason: "probe_failed", metrics: [] };
    }
  }

  /**
   * Stop an instance this launcher owns.
   *
   * A shared instance is refused: `shared_instance_not_owned`. The refusal is the
   * feature — the alternative is killing a process whose owner, active jobs and
   * artifacts are not ours to destroy.
   */
  async stop(instance_id: string): Promise<StopOutcome> {
    const instance = this.#tracked.get(instance_id) ?? null;
    const decision = planStop(instance);
    if (!decision.allowed || instance === null) {
      return { stopped: false, reason: decision.reason };
    }
    await this.#launch.stop({
      instance_id: instance.instance_id,
      generation: instance.generation,
      pid: instance.pid,
    });
    this.#tracked.set(instance.instance_id, { ...instance, state: "stopped" });
    this.#health.markStopped(instance.instance_id, instance.instance_id, instance.ownership, "stopped_by_launcher");
    return { stopped: true, reason: decision.reason };
  }

  /**
   * Detach from an instance without touching the process.
   *
   * Closing a window, a panel or an Agent session is not a stop request. The launcher
   * deliberately offers no "close means stop" path: the project on disk and any job in
   * flight belong to the instance, not to the client that happened to be looking at it.
   */
  detach(instance_id: string): { readonly detached: boolean; readonly instance: LauncherInstance | null } {
    const instance = this.#tracked.get(instance_id) ?? null;
    return { detached: instance !== null, instance };
  }

  /** The tracked instance for an id, if any. */
  instance(instance_id: string): LauncherInstance | null {
    return this.#tracked.get(instance_id) ?? null;
  }

  /** The health of every tracked service, with TTL expiry applied. */
  health(): HealthRead {
    return this.#health.read();
  }

  /** The health of one instance's services, with TTL expiry applied. */
  instanceHealth(instance_id: string): HealthRead {
    return this.#health.read(instance_id);
  }

  /**
   * The instance descriptor the contract exposes.
   *
   * The contract version is pinned to `cp-a0-r4`; a launcher that could report a
   * different contract version would be lying about the wire contract it speaks.
   *
   * The health roll-up only sees this instance's services. The registry can hold
   * several instances at once, and one instance's readiness is not decided by
   * another's.
   */
  instanceDescriptor(instance_id: string): Instance {
    const instance = this.#tracked.get(instance_id);
    if (instance === undefined) {
      throw new Error("unknown_instance");
    }
    const health = this.#health.read(instance.instance_id);
    const healthState = planInstanceHealth({
      instanceState: instance.state,
      serviceStates: health.services.map((service) => service.state),
    });
    const descriptor: Instance = {
      instance_id: instance.instance_id,
      generation: instance.generation,
      api_version: "agent.v1",
      contract_version: "cp-a0-r4",
      capabilities: [...this.#capabilities],
      health: healthState,
    };
    return validateAgentDefinition<Instance>("Instance", descriptor);
  }
}
