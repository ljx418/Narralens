import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { installMediaProcessPolicy } from "../../host/render/media-process-policy.mjs";

/**
 * The worker-local process policy of the native cache worker.
 *
 * It is installed INSIDE the worker, before the pinned upstream is loaded and before
 * any browser is started. It never touches the shared Host: the Host's own
 * `child_process` is not patched by this module, and the formal render's policy is
 * not modified either - it is REUSED, with its own bytes, exactly as the render
 * worker reuses it.
 *
 * Three things happen here, and each of them has a reason:
 *
 *  1. The formal render's media process policy is installed first. It is the policy
 *     that already forces every child of a render into the group of the worker that
 *     owns it, and that keeps the media tools off the network. The bytes are the
 *     ones the formal render uses; nothing here changes them.
 *
 *  2. The entry points of a child process are FIXED, and the ones the policy does
 *     not cover are refused. `spawn`, `spawnSync` and `execFile` are the covered
 *     ones. `fork`, `exec` and `execSync` are NOT covered by that policy: a shell
 *     and a forked child are exactly the ways out of a group, so the worker refuses
 *     them by name instead of assuming they are not used.
 *
 *  3. The BIRTH GATE. The worker draws ONE picture and then stops: after the draw
 *     every attempt to start a child is refused. The gate is what makes the
 *     worker's own promise - that the group it owns has nothing more in it -
 *     something the worker keeps, instead of something the parent has to hope for.
 *
 * Everything the gate sees is RECORDED, so the parent is told what really ran
 * inside the worker instead of being told a number that could have been anything.
 */

/** The child-process entry points this worker allows. The list is fixed. */
const ALLOWED_ENTRY_POINTS = Object.freeze(["spawn", "spawnSync", "execFile"]);

/**
 * The entry points this worker refuses.
 *
 * They are refused because they are the ways OUT of the group the parent owns:
 * `exec` and `execSync` start a shell, `fork` starts a child in its own right,
 * and `execFileSync` starts a child the media policy does not cover. The formal
 * render's policy does not cover them, and "it is not used" is not a proof - so
 * the refusal is here, in the worker, and it is reported.
 */
const REFUSED_ENTRY_POINTS = Object.freeze(["fork", "exec", "execSync", "execFileSync"]);

/** What really ran inside the worker. The parent is told this, not a guess. */
const observed = {
  /** The entry points that were called, with how often. */
  entry_points: Object.create(null),
  /** The commands that were started, by their base name. */
  commands: Object.create(null),
  /** The entry points that were refused, with how often. */
  refused: Object.create(null),
};

/** Whether the birth gate is sealed: no child may be born any more. */
let sealed = false;

/** The failure of a refused birth. It names the gate, and nothing else. */
export class CacheWorkerBirthRefused extends Error {
  constructor(entryPoint) {
    super(`The cache worker refuses to start another child process (${entryPoint})`);
    this.name = "CacheWorkerBirthRefused";
    this.entry_point = entryPoint;
  }
}

/** Whether the birth gate is sealed. */
export function isCacheWorkerBirthSealed() {
  return sealed;
}

/**
 * Seal the birth gate.
 *
 * After this, no child process may be born in this worker: the draw is over and
 * the group the parent owns may not grow any more.
 */
export function sealCacheWorkerBirth() {
  sealed = true;
}

/** What really ran inside the worker: a read-only copy of the record. */
export function cacheWorkerObservedProcesses() {
  return {
    entry_points: { ...observed.entry_points },
    commands: { ...observed.commands },
    refused: { ...observed.refused },
    sealed,
  };
}

/** Count one observation. */
const count = (table, name) => {
  table[name] = (table[name] ?? 0) + 1;
};

/**
 * Install the worker-local policy.
 *
 * It is called once, at the very start of the worker, before the pinned upstream is
 * loaded. The order matters: the formal render's policy is installed FIRST, so the
 * gate is the OUTER wrapper and every child that is allowed to start has already
 * been through the media policy.
 */
export function installCacheWorkerPolicy() {
  if (sealed) throw new CacheWorkerBirthRefused("install");
  // The formal render's own policy, with its own bytes. It is REUSED and never
  // modified: it is what forces a browser into the group of its worker.
  installMediaProcessPolicy();

  for (const entryPoint of REFUSED_ENTRY_POINTS) {
    const original = childProcess[entryPoint];
    if (typeof original !== "function") continue;
    childProcess[entryPoint] = function refusedEntryPoint() {
      count(observed.refused, entryPoint);
      throw new CacheWorkerBirthRefused(entryPoint);
    };
  }

  for (const entryPoint of ALLOWED_ENTRY_POINTS) {
    const original = childProcess[entryPoint];
    if (typeof original !== "function") continue;
    childProcess[entryPoint] = function gatedEntryPoint(command, ...rest) {
      count(observed.entry_points, entryPoint);
      if (sealed) {
        count(observed.refused, `${entryPoint}:sealed`);
        throw new CacheWorkerBirthRefused(entryPoint);
      }
      count(observed.commands, basename(String(command)));
      return Reflect.apply(original, this, [command, ...rest]);
    };
  }

  // The pinned modules use named ESM imports from node:child_process, so the
  // built-in exports have to be refreshed after the methods were replaced.
  syncBuiltinESMExports();
}
