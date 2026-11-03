import { OpenFilmEngineAdapter, type OpenFilmProjectLayout } from "../../adapters/openfilm/openfilm-engine-adapter.js";
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
  /**
   * Host-only handle on the concrete adapter, so Host composition can hand it a layout.
   *
   * M4A-0: before this existed, the only way to make an activated target inspectable was
   * for a test to call `registerLayout()` itself, so a restarted Host could not read its own
   * migrated project. The registrar is deliberately *not* on `EnginePort` — the port stays at
   * seven methods, and this is a Host-composition seam that no client and no adapter can
   * reach. It is absent when the port is not installed, so calling it is a capability check
   * rather than a silent no-op.
   */
  readonly registrar?: OpenFilmLayoutRegistrar;
}

export interface OpenFilmLayoutRegistrar {
  registerLayout(projectId: string, layout: OpenFilmProjectLayout): void;
}

export interface OpenFilmAvailabilityRetryOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly check?: (vendorRoot: string, gitStatusTimeoutMs: number) => Promise<OpenFilmAvailability>;
}

/**
 * Verify the pinned checkout with a bounded retry for an *inconclusive* clean-tree check.
 *
 * Missing bytes, a different SHA, tracked modifications and digest drift are conclusive
 * failures and return immediately. Only a `git status` check that could not complete may
 * be repeated. Without this distinction a transiently saturated machine can start a Host
 * without its OpenFilm port, then successfully migrate and persist an OpenFilm binding;
 * every later operation would fail with "bound but not installed" until restart.
 */
export async function verifyOpenFilmForComposition(vendorRoot: string, gitStatusTimeoutMs: number,
  options: OpenFilmAvailabilityRetryOptions = {}): Promise<OpenFilmAvailability> {
  const attempts = options.attempts ?? 3;
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error("INVALID_OPENFILM_VERIFICATION_ATTEMPTS");
  const delayMs = options.delayMs ?? 500;
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("INVALID_OPENFILM_VERIFICATION_DELAY");
  const check = options.check ?? openFilmAvailability;
  let last: OpenFilmAvailability | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await check(vendorRoot, gitStatusTimeoutMs);
    if (last.available || last.reason !== "cannot verify that the pinned OpenFilm checkout is clean") return last;
    if (attempt < attempts - 1 && delayMs > 0) {
      await new Promise((done) => setTimeout(done, delayMs * (attempt + 1)));
    }
  }
  return last!;
}

export async function composeOpenFilmPort(input: {
  readonly registry: EngineRegistry;
  readonly vendorRoot: string;
  /** Bounded so a hung `git status` cannot hold startup open. */
  readonly gitStatusTimeoutMs?: number;
  /** Bounded retries apply only when the clean-tree check could not complete. */
  readonly verificationAttempts?: number;
  readonly verificationRetryDelayMs?: number;
  /** Test-only seam for M4C's fault matrix; production composition omits it. */
  readonly fault?: (point: string) => void | Promise<void>;
}): Promise<OpenFilmComposition> {
  const availability = await verifyOpenFilmForComposition(input.vendorRoot,
    input.gitStatusTimeoutMs ?? 30_000, {
      ...(input.verificationAttempts === undefined ? {} : { attempts: input.verificationAttempts }),
      ...(input.verificationRetryDelayMs === undefined ? {} : { delayMs: input.verificationRetryDelayMs }),
    });
  if (!availability.available) {
    return { installed: false, availability, vendor_root: availability.vendor_root,
      reason: availability.reason };
  }
  // Loading is the last step and the only one that can execute anything, so it happens
  // only once the checkout has already been proven.
  const upstream = await createPinnedOpenFilmUpstream(input.vendorRoot, availability);
  const adapter = new OpenFilmEngineAdapter(upstream,
    input.fault === undefined ? {} : { fault: input.fault });
  input.registry.register("openfilm", adapter);
  return { installed: true, availability, vendor_root: availability.vendor_root,
    reason: availability.reason, registrar: adapter };
}
