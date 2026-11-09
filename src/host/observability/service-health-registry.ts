/**
 * The service health registry lives with the launcher (BRIDGE / E06).
 *
 * The implementation-design names `src/host/observability/service-health-registry.ts`
 * as the expected path for the health read model. The registry is kept in
 * `src/launcher/health-registry.ts` because the launcher owns the service inventory
 * it samples, and it is re-exported here so both documented paths resolve to the same
 * code — one implementation, not two that can drift.
 */

export {
  HEALTH_SAMPLE_INTERVAL_MS,
  HEALTH_STALE_AFTER_MS,
  ServiceHealthRegistry,
  type HealthSample,
  type ObservedServiceState,
} from "../../launcher/health-registry.js";
