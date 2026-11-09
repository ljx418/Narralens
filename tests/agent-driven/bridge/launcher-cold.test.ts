/**
 * A-COLD: launcher cold start, duplicate start, shared instance and health TTL.
 *
 * The launcher is a pure module, so the process manager, the discovery store and the
 * readiness probe are injected as fakes. What is exercised here is the launcher's
 * own decisions: which instance a request resolves to, whether a second process is
 * created, who is allowed to stop a process, and when a health sample stops being
 * true.
 *
 * These are module cases. They prove the launcher's rules, not that a real Host
 * process starts, binds a port or serves traffic; that is MAIN's integration case.
 */

import { describe, expect, it } from "vitest";
import {
  HEALTH_SAMPLE_INTERVAL_MS,
  HEALTH_STALE_AFTER_MS,
  LauncherSupervisor,
  ServiceHealthRegistry,
  planLaunch,
  planStop,
  type Clock,
  type DiscoveredRuntime,
  type InstanceDiscoveryPort,
  type InstanceLaunchPort,
  type InstanceProbePort,
  type LauncherInstance,
} from "../../../src/launcher/index.js";
import { validateAgentDefinition } from "../../../src/contracts/agent-driven-validator.js";

class TestClock implements Clock {
  constructor(private value: number) {}
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

class FakeDiscovery implements InstanceDiscoveryPort {
  readonly runtimes = new Map<string, DiscoveredRuntime>();

  async discover(input: { runtime_root: string }): Promise<DiscoveredRuntime> {
    return this.runtimes.get(input.runtime_root) ?? { running: null, last_generation: 0 };
  }
}

class FakeLaunch implements InstanceLaunchPort {
  launchCount = 0;
  stopCount = 0;
  stoppedInstances: string[] = [];

  async launch(input: { runtime_root: string; instance_id: string; generation: number }): Promise<{ pid: number; endpoint: string }> {
    this.launchCount += 1;
    return { pid: 4200 + this.launchCount, endpoint: `http://127.0.0.1:${4173 + this.launchCount}` };
  }

  async stop(input: { instance_id: string }): Promise<void> {
    this.stopCount += 1;
    this.stoppedInstances.push(input.instance_id);
  }
}

class FakeProbe implements InstanceProbePort {
  ready = false;
  reason = "not_ready_yet";

  async probe(): Promise<{ ready: boolean; reason: string; metrics: [] }> {
    return { ready: this.ready, reason: this.reason, metrics: [] };
  }
}

interface Harness {
  readonly supervisor: LauncherSupervisor;
  readonly discovery: FakeDiscovery;
  readonly launch: FakeLaunch;
  readonly probe: FakeProbe;
  readonly clock: TestClock;
  readonly health: ServiceHealthRegistry;
}

function harness(): Harness {
  const clock = new TestClock(1_700_000_000_000);
  const discovery = new FakeDiscovery();
  const launch = new FakeLaunch();
  const probe = new FakeProbe();
  const health = new ServiceHealthRegistry(clock);
  const supervisor = new LauncherSupervisor({ discovery, launch, probe, health, clock });
  // The discovery store is the authority on what is running, so the fake launch port
  // publishes into it exactly as a real pid-file store would: a launch makes the
  // instance discoverable, and a stop makes it disappear while the generation
  // counter survives.
  const originalLaunch = launch.launch.bind(launch);
  launch.launch = async (input) => {
    const result = await originalLaunch(input);
    const instance: LauncherInstance = {
      instance_id: input.instance_id,
      generation: input.generation,
      ownership: "owned",
      endpoint: result.endpoint,
      pid: result.pid,
      started_at: new Date(clock.now()).toISOString(),
      state: "starting",
    };
    discovery.runtimes.set(input.runtime_root, { running: instance, last_generation: input.generation });
    return result;
  };
  const originalStop = launch.stop.bind(launch);
  launch.stop = async (input) => {
    await originalStop(input);
    for (const [root, runtime] of discovery.runtimes) {
      const running = runtime.running;
      if (running !== null && running.instance_id === input.instance_id) {
        discovery.runtimes.set(root, { running: null, last_generation: running.generation });
      }
    }
  };
  return { supervisor, discovery, launch, probe, clock, health };
}

const ROOT = "/var/lib/narralens/instance-a";

describe("A-COLD launcher instance lifecycle", () => {
  it("starts one instance on a cold root and reports it as starting, not ready", async () => {
    const { supervisor, launch } = harness();
    const outcome = await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });

    expect(outcome.action).toBe("start");
    expect(outcome.launched).toBe(true);
    expect(outcome.instance.generation).toBe(1);
    expect(outcome.instance.ownership).toBe("owned");
    expect(outcome.instance.state).toBe("starting");
    expect(launch.launchCount).toBe(1);

    const health = supervisor.health();
    expect(health.services).toHaveLength(1);
    expect(health.services[0]?.state).toBe("starting");
    expect(health.sample_interval_ms).toBe(HEALTH_SAMPLE_INTERVAL_MS);
    expect(health.stale_after_ms).toBe(HEALTH_STALE_AFTER_MS);
  });

  it("reuses the running instance on a duplicate start instead of launching a second process", async () => {
    const { supervisor, launch, probe } = harness();
    await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });
    probe.ready = true;
    probe.reason = "api_ready";

    const second = await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });

    expect(second.action).toBe("reuse");
    expect(second.launched).toBe(false);
    expect(second.instance.instance_id).toBe("narralens-a");
    expect(second.instance.generation).toBe(1);
    expect(second.instance.state).toBe("ready");
    expect(launch.launchCount).toBe(1);
  });

  it("converges concurrent duplicate starts onto a single instance", async () => {
    const { supervisor, launch } = harness();
    const [first, second] = await Promise.all([
      supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" }),
      supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" }),
    ]);

    expect(launch.launchCount).toBe(1);
    expect(second.instance.instance_id).toBe(first.instance.instance_id);
    expect(second.instance.generation).toBe(first.instance.generation);
  });

  it("attaches to a shared instance without owning it and never stops it", async () => {
    const { supervisor, discovery, launch } = harness();
    discovery.runtimes.set(ROOT, {
      running: {
        instance_id: "narralens-a",
        generation: 7,
        ownership: "shared",
        endpoint: "http://127.0.0.1:4173",
        pid: 999,
        started_at: new Date(1_700_000_000_000).toISOString(),
        state: "ready",
      },
      last_generation: 7,
    });

    const outcome = await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });
    expect(outcome.action).toBe("attach");
    expect(outcome.launched).toBe(false);
    expect(outcome.instance.ownership).toBe("shared");
    expect(outcome.instance.generation).toBe(7);
    expect(launch.launchCount).toBe(0);

    const stop = await supervisor.stop("narralens-a");
    expect(stop.stopped).toBe(false);
    expect(stop.reason).toBe("shared_instance_not_owned");
    expect(launch.stopCount).toBe(0);
  });

  it("stops an owned instance on request and continues the generation on reopen", async () => {
    const { supervisor, discovery, launch } = harness();
    await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });

    const stop = await supervisor.stop("narralens-a");
    expect(stop.stopped).toBe(true);
    expect(launch.stopCount).toBe(1);

    const reopened = await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });
    expect(reopened.action).toBe("start");
    expect(reopened.instance.generation).toBe(2);
    expect(launch.launchCount).toBe(2);
  });

  it("does not stop the service when a client detaches", async () => {
    const { supervisor, launch } = harness();
    await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });

    const detached = supervisor.detach("narralens-a");
    expect(detached.detached).toBe(true);
    expect(detached.instance?.state).toBe("starting");
    expect(launch.stopCount).toBe(0);
    expect(supervisor.instance("narralens-a")?.state).toBe("starting");
  });

  it("publishes an instance descriptor that matches the contract", async () => {
    const { supervisor } = harness();
    await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });

    const descriptor = supervisor.instanceDescriptor("narralens-a");
    expect(descriptor.api_version).toBe("agent.v1");
    expect(descriptor.contract_version).toBe("cp-a0-r4");
    expect(descriptor.generation).toBe(1);
    expect(descriptor.health).toBe("starting");
    expect(() => validateAgentDefinition("Instance", descriptor)).not.toThrow();
  });

  it("degrades the instance health when a tracked service is unknown", async () => {
    const { supervisor, health, clock, probe } = harness();
    probe.ready = true;
    probe.reason = "api_ready";
    await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });
    health.record({
      service_id: "studio",
      instance_id: "narralens-a",
      state: "ready",
      ownership: "shared",
      reason: "ready",
      metrics: [],
      sampled_at_ms: clock.now(),
    });

    const before = supervisor.instanceDescriptor("narralens-a");
    expect(before.health).toBe("ready");

    clock.advance(HEALTH_STALE_AFTER_MS);
    const after = supervisor.instanceDescriptor("narralens-a");
    expect(after.health).toBe("degraded");
    expect(supervisor.health().services.find((service) => service.service_id === "narralens-a")?.state)
      .toBe("unknown");
  });

  it("reports a stopped instance as degraded, not ready", async () => {
    const { supervisor } = harness();
    await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });
    await supervisor.stop("narralens-a");

    const descriptor = supervisor.instanceDescriptor("narralens-a");
    expect(descriptor.health).toBe("degraded");
  });

  it("reports a stopped service as degraded", async () => {
    const { supervisor, health, clock, probe } = harness();
    probe.ready = true;
    await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });
    health.record({
      service_id: "renderer",
      instance_id: "narralens-a",
      state: "stopped",
      ownership: "owned",
      reason: "stopped_by_operator",
      metrics: [],
      sampled_at_ms: clock.now(),
    });

    expect(supervisor.instanceDescriptor("narralens-a").health).toBe("degraded");
  });

  it("does not let another instance's services decide this instance's health", async () => {
    const { supervisor, health, probe } = harness();
    probe.ready = true;
    await supervisor.start({ runtime_root: ROOT, instance_id: "narralens-a" });
    await supervisor.start({ runtime_root: "/var/lib/narralens/instance-b", instance_id: "narralens-b" });

    // A service that belongs to the other instance, and is in a bad state.
    health.record({
      service_id: "studio-b",
      instance_id: "narralens-b",
      state: "degraded",
      ownership: "owned",
      reason: "worker_failed",
      metrics: [],
      sampled_at_ms: 1_700_000_000_000,
    });

    expect(supervisor.instanceDescriptor("narralens-a").health).toBe("ready");
    expect(supervisor.instanceDescriptor("narralens-b").health).toBe("degraded");
    expect(supervisor.instanceHealth("narralens-a").services.map((service) => service.service_id))
      .not.toContain("studio-b");
  });
});

describe("A-COLD health expiry", () => {
  it("keeps a sample fresh inside the stale window and expires it exactly at the limit", () => {
    const clock = new TestClock(1_700_000_000_000);
    const health = new ServiceHealthRegistry(clock);
    health.record({
      service_id: "host",
      instance_id: "narralens-a",
      state: "ready",
      ownership: "owned",
      reason: "api_ready",
      metrics: [],
      sampled_at_ms: clock.now(),
    });

    const fresh = health.read();
    expect(fresh.services[0]?.state).toBe("ready");
    expect(fresh.services[0]?.expires_at).toBe(new Date(clock.now() + HEALTH_STALE_AFTER_MS).toISOString());

    clock.advance(HEALTH_STALE_AFTER_MS - 1);
    expect(health.read().services[0]?.state).toBe("ready");

    clock.advance(1);
    const expired = health.read();
    expect(expired.services[0]?.state).toBe("unknown");
    expect(expired.services[0]?.reason).toBe("sample_expired");
    expect(expired.stale_after_ms).toBe(15000);
    expect(expired.sample_interval_ms).toBe(5000);
  });

  it("rejects a sample that the contract cannot carry", () => {
    const health = new ServiceHealthRegistry(new TestClock(0));
    expect(() => health.record({
      service_id: "not a valid id",
      instance_id: "narralens-a",
      state: "ready",
      ownership: "owned",
      reason: "ready",
      metrics: [],
      sampled_at_ms: 0,
    })).toThrow();
  });
});

describe("A-COLD launcher planning", () => {
  it("plans a cold start when nothing is running", () => {
    const plan = planLaunch({ running: null, last_generation: 3 });
    expect(plan.action).toBe("start");
    expect(plan.generation).toBe(4);
    expect(plan.ownership).toBe("owned");
  });

  it("plans an attach for a shared instance and a reuse for an owned one", () => {
    const shared = planLaunch({
      running: {
        instance_id: "narralens-a",
        generation: 2,
        ownership: "shared",
        endpoint: "http://127.0.0.1:4173",
        pid: 1,
        started_at: "2026-01-01T00:00:00.000Z",
        state: "ready",
      },
      last_generation: 2,
    });
    expect(shared.action).toBe("attach");
    expect(shared.ownership).toBe("shared");

    const owned = planLaunch({
      running: {
        instance_id: "narralens-a",
        generation: 2,
        ownership: "owned",
        endpoint: "http://127.0.0.1:4173",
        pid: 1,
        started_at: "2026-01-01T00:00:00.000Z",
        state: "ready",
      },
      last_generation: 2,
    });
    expect(owned.action).toBe("reuse");
    expect(owned.generation).toBe(2);
  });

  it("refuses to stop an instance it does not own or does not know", () => {
    expect(planStop(null)).toEqual({ allowed: false, reason: "unknown_instance" });
    expect(planStop({
      instance_id: "narralens-a",
      generation: 1,
      ownership: "shared",
      endpoint: "http://127.0.0.1:4173",
      pid: 1,
      started_at: "2026-01-01T00:00:00.000Z",
      state: "ready",
    })).toEqual({ allowed: false, reason: "shared_instance_not_owned" });
  });
});
