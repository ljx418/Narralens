/**
 * Public surface of the launcher module (BRIDGE / E06).
 *
 * MAIN imports from here to compose the launcher with the real process manager and to
 * register the resulting instance descriptor with the Host.
 */

export type {
  Clock,
  DiscoveredRuntime,
  InstanceDiscoveryPort,
  InstanceLaunchPort,
  InstanceProbePort,
  InstanceProbeResult,
  LauncherInstance,
  LauncherInstanceState,
  ServiceOwnership,
} from "./launcher-types.js";
export { systemClock } from "./launcher-types.js";
export type { HealthPlan, HealthPlanState, LaunchAction, LaunchPlan, StopDecision } from "./launcher-plan.js";
export { planHealth, planInstanceHealth, planLaunch, planStop } from "./launcher-plan.js";
export {
  HEALTH_SAMPLE_INTERVAL_MS,
  HEALTH_STALE_AFTER_MS,
  ServiceHealthRegistry,
  type HealthSample,
  type ObservedServiceState,
} from "./health-registry.js";
export {
  LauncherSupervisor,
  type LaunchOutcome,
  type LauncherSupervisorOptions,
  type StartRequest,
  type StopOutcome,
} from "./service-supervisor.js";
