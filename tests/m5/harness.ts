import { start as startWave2, startOn as startWave2On, stopAll, type Started } from "../wave2/m4a/harness.js";

/**
 * The M5 test harness.
 *
 * M5's tests run against a *real* Host over a *real* temporary directory, with the real
 * pinned OpenFilm checkout behind it and the real migration route in front of it. Nothing
 * here fakes the engine, the resolver or the projection seam: the workbench read model
 * only proves something if the clips in it came out of the upstream's own parser.
 *
 * The Wave 2 harness already starts a Host and migrates the fixture through the Host's
 * own route, so it is reused rather than copied — two harnesses would be two answers to
 * "what does a migrated target looks like".
 */
export { REAL_UPSTREAM_PARENT, headers, migrate, postImpact, adoptBody, coveringPlan,
  readyMaterialization, stopAll } from "../wave2/m4a/harness.js";
export type { Started } from "../wave2/m4a/harness.js";

/** A started Host with a session token, over a fresh temporary directory. */
export async function start(options: Parameters<typeof startWave2>[0] = {}): Promise<Started> {
  return await startWave2(options);
}

/** A Host over an existing working directory: how a restart is modelled. */
export async function startOn(base: string,
  options: Parameters<typeof startWave2>[0] = {}): Promise<Started> {
  return await startWave2On(base, options);
}

/** The Host's own session headers. */
export function authHeaders(origin: string, token: string): Record<string, string> {
  return { origin, authorization: `Bearer ${token}`, "content-type": "application/json" };
}
