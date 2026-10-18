import { OpenFilmEngineAdapter } from "../../adapters/openfilm/openfilm-engine-adapter.js";
import { createPinnedOpenFilmUpstream, openFilmAvailability, type OpenFilmAvailability } from "../../adapters/openfilm/openfilm-upstream.js";
import type { EngineRegistry } from "./engine-registry.js";

/**
 * Host composition of the OpenFilm port (R2-07).
 *
 * `defaultEngineRegistry` registered Hypit only. That was correct while OpenFilm had no
 * production write path — an uninstalled engine fails closed at `resolve()` with a 503
 * rather than writing through the wrong one. It stops being correct the moment M2.3 has
 * produced a real migrated target: `ProjectResolver` can name that project, its binding
 * says `openfilm`, and the registry would have no port to resolve to. So the port is
 * composed here, explicitly, at the pinned upstream.
 *
 * "Composed" means verified, not merely constructed. A port is registered only when the
 * checkout is at the pinned full SHA, carries no tracked modifications, and every file
 * about to be executed hashes to its pinned digest — the module, `package.json`, the
 * lockfile and the licence. Any of those missing or different leaves the capability
 * closed and the reason recorded, because a silently-absent capability is far harder to
 * diagnose than a refusal that says which file failed.
 *
 * This runs at `listen()` rather than in a constructor, since verification is async and a
 * constructor cannot await.
 */

export interface OpenFilmComposition {
  readonly installed: boolean;
  readonly availability: OpenFilmAvailability;
  readonly vendor_root: string;
  readonly reason: string;
}

export async function composeOpenFilmPort(input: {
  readonly registry: EngineRegistry;
  readonly vendorRoot: string;
  /** Bounded so a hung `git status` cannot hold startup open. */
  readonly gitStatusTimeoutMs?: number;
}): Promise<OpenFilmComposition> {
  const availability = await openFilmAvailability(input.vendorRoot, input.gitStatusTimeoutMs ?? 10_000);
  if (!availability.available) {
    return { installed: false, availability, vendor_root: availability.vendor_root,
      reason: availability.reason };
  }
  // Loading is the last step and the only one that can execute anything, so it happens
  // only once the checkout has already been proven.
  const upstream = await createPinnedOpenFilmUpstream(input.vendorRoot);
  input.registry.register("openfilm", new OpenFilmEngineAdapter(upstream));
  return { installed: true, availability, vendor_root: availability.vendor_root, reason: availability.reason };
}
