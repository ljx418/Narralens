import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import {constants, realpathSync, statSync} from "node:fs";
import type {IncomingMessage, ServerResponse} from "node:http";
import type {Readable} from "node:stream";
import {tmpdir} from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import lock from "../../../contracts/openfilm-upstream-lock.json" with { type: "json" };
import { HttpError } from "../../host/api-error.js";
import { CacheProcessSupervisor } from "./cache-process-supervisor.js";
import type { CacheDrawHandle } from "./cache-process-supervisor.js";
import {
  acquireCacheProductionScope,
  cacheProductionScopeCovers,
  completeCacheProductionScope,
  currentCacheProductionScope,
  mintCacheProductionCompletion,
  markCacheProductionCleanupRequired,
  openCacheProductionPhaseLease,
  releaseCacheProductionScope,
} from "./cache-production-scope.js";
import type { CacheProductionPhaseLease, CacheProductionScope } from "./cache-production-scope.js";

const run = promisify(execFile);

/**
 * The OpenFilm upstream seam.
 *
 * `readProjectFilm`, `editProjectFilm` and `revOf` are the only functions M2.1 uses, and
 * they are exactly the ones M1B already exercised against the pinned upstream
 * `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`. Nothing here forwards an arbitrary command,
 * path or URL to the upstream.
 *
 * The module is loaded with a guarded dynamic `import()` after the checkout's HEAD is
 * verified to equal the pinned full SHA, so a drifted or absent checkout fails closed
 * instead of silently binding a different engine. No production file statically imports
 * `vendor/` or `spikes/`.
 */

export const OPENFILM_PIN = Object.freeze({
  repository: lock.repository,
  full_sha: lock.full_sha,
  package: lock.package,
  license: lock.license,
  module_path: "packages/openfilm/studio/server/film.mjs",
  /** Every file whose bytes are about to be executed, pinned before any dynamic import. */
  loaded_module_sha256: lock.loaded_module_sha256,
  package_json_sha256: lock.package_json_sha256,
  lockfile_sha256: lock.lockfile_sha256,
  license_sha256: lock.license_sha256,
  package_file: lock.package_file,
  lockfile_file: lock.lockfile_file,
  license_file: lock.license_file,
  seam_exports: lock.seam_exports,
});

export interface OpenFilmFilmRead {
  readonly text: string;
  readonly rev: string;
  readonly value: unknown;
  readonly doc: unknown;
  readonly problems: string[];
}

export interface OpenFilmFilmEdit {
  readonly text: string;
  readonly rev: string;
  readonly value: unknown;
  readonly doc: unknown;
  readonly rebased: boolean;
}

export type OpenFilmPropValue = number | string | boolean | readonly number[] | Record<string, unknown> | null;

export type OpenFilmOp =
  | { op: "set"; clip: string; field: string; value?: unknown }
  | { op: "move"; clip: string; at: number; track?: number; newTrack?: number }
  | { op: "remove"; clip: string }
  | { op: "split"; clip: string; at: number; time: [number, number]; restTime: [number, number]; restId?: string }
  | { op: "split"; clip: string; left: Record<string, OpenFilmPropValue>; right: Record<string, OpenFilmPropValue>; rightId?: string }
  | { op: "props"; edits: ReadonlyArray<{ clip: string; prop: string; value: OpenFilmPropValue }> }
  | { op: "stage"; w: number; h: number }
  | { op: "fields"; clip: string; fields: Record<string, unknown> }
  | { op: "track"; track: number; field: "locked" | "hidden" | "muted"; value: boolean }
  | { op: "reorder"; from: number; to: number }
  | { op: "insert"; clip?: Partial<{ src: string; id: string; [field: string]: unknown }> & { src: string };
      from?: string; at?: number; after?: string; track?: number | { insert: number };
      newTrack?: number; link?: string | null };

export interface OpenFilmUpstream {
  revOf(text: string): string;
  readProjectFilm(root: string): Promise<OpenFilmFilmRead>;
  editProjectFilm(root: string, base: string | null, ops: readonly OpenFilmOp[]): Promise<OpenFilmFilmEdit>;
}

export interface OpenFilmAvailability {
  readonly available: boolean;
  readonly vendor_root: string;
  readonly observed_sha: string | null;
  readonly expected_sha: string;
  readonly reason: string;
  readonly checked: readonly string[];
}

// A reusable verdict is a capability, not merely a structurally compatible object.  The
// WeakSet makes that property enforceable at runtime: only this module can mint a verdict
// after performing the real HEAD/clean-tree/digest checks.  A caller may pass that exact
// object once to avoid a second, racy `git status`, but cannot manufacture an `available:
// true` object and use it to load unverified bytes.
const reusableAvailabilityVerdicts = new WeakSet<OpenFilmAvailability>();

const sha256File = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

const SHA_PATTERN = /^[a-f0-9]{40}$/u;

/** Read the checkout's HEAD without executing anything from it. */
async function readCheckoutSha(vendorRoot: string): Promise<string | null> {
  const { readFile } = await import("node:fs/promises");
  const head = resolve(vendorRoot, ".git/HEAD");
  try {
    const text = (await readFile(head, "utf8")).trim();
    const direct = /^([a-f0-9]{40})$/u.exec(text);
    if (direct) return direct[1]!;
    const ref = /^ref:\s*(.+)$/u.exec(text);
    if (!ref) return null;
    const refFile = resolve(vendorRoot, ".git", ref[1]!.trim());
    const sha = (await readFile(refFile, "utf8")).trim();
    return SHA_PATTERN.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * M-04: a pinned commit is a claim about a tree, not about the bytes that will run.
 *
 * A checkout can sit at the right HEAD with locally modified files, and a dynamic import
 * would then execute bytes that no commit ever contained. So availability requires three
 * independent facts: the HEAD is the pinned SHA, the checkout has no tracked modifications,
 * and every file this loader is about to execute hashes to its pinned digest.
 */
export async function openFilmAvailability(vendorRoot: string, gitStatusTimeoutMs = 30_000): Promise<OpenFilmAvailability> {
  const checked: string[] = [];
  let root: string;
  try { root = await realpath(vendorRoot); }
  catch {
    return { available: false, vendor_root: vendorRoot, observed_sha: null, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout is absent", checked };
  }
  const observed = await readCheckoutSha(root);
  if (observed === null) {
    return { available: false, vendor_root: root, observed_sha: null, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout has no readable git HEAD", checked };
  }
  checked.push("git_head");
  if (observed !== OPENFILM_PIN.full_sha) {
    return { available: false, vendor_root: root, observed_sha: observed, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout is not at the pinned full SHA", checked };
  }

  const dirty = await trackedModifications(root, gitStatusTimeoutMs);
  if (dirty === null) {
    return { available: false, vendor_root: root, observed_sha: observed, expected_sha: OPENFILM_PIN.full_sha,
      reason: "cannot verify that the pinned OpenFilm checkout is clean", checked };
  }
  checked.push("git_clean");
  if (dirty.length > 0) {
    return { available: false, vendor_root: root, observed_sha: observed, expected_sha: OPENFILM_PIN.full_sha,
      reason: `pinned OpenFilm checkout has local modifications: ${dirty.slice(0, 5).join(", ")}`, checked };
  }

  const verdict = await verifyPinnedFiles(root);
  checked.push(...verdict.checked);

  const availability: OpenFilmAvailability = {
    available: verdict.ok,
    vendor_root: root,
    observed_sha: observed,
    expected_sha: OPENFILM_PIN.full_sha,
    reason: verdict.reason,
    checked,
  };
  if (availability.available) reusableAvailabilityVerdicts.add(availability);
  return availability;
}

export interface PinnedFileVerdict {
  readonly ok: boolean;
  readonly reason: string;
  readonly checked: readonly string[];
  readonly missing: readonly string[];
  readonly mismatched: readonly string[];
}

/**
 * Hash every file this loader will execute or read, plus package, lock and licence.
 *
 * Split out from the git checks so the digest gate itself is directly testable: a synthetic
 * tree can never satisfy the real pins, which is exactly what proves the gate refuses.
 */
export async function verifyPinnedFiles(root: string): Promise<PinnedFileVerdict> {
  const digests: Array<[string, string]> = [
    [OPENFILM_PIN.package_file, OPENFILM_PIN.package_json_sha256],
    [OPENFILM_PIN.lockfile_file, OPENFILM_PIN.lockfile_sha256],
    [OPENFILM_PIN.license_file, OPENFILM_PIN.license_sha256],
    ...Object.entries(OPENFILM_PIN.loaded_module_sha256),
  ];
  const checked: string[] = [];
  const missing: string[] = [];
  const mismatched: string[] = [];
  // Every pinned file is checked, not just the first failure, so an operator sees the whole
  // picture of what a tampered checkout contains.
  for (const [relative, expected] of digests) {
    checked.push(relative);
    const actual = await sha256File(resolve(root, relative)).catch(() => null);
    if (actual === null) missing.push(relative);
    else if (actual !== expected) mismatched.push(relative);
  }
  if (missing.length > 0 || mismatched.length > 0) {
    const parts = [
      ...missing.map((relative) => `missing ${relative}`),
      ...mismatched.map((relative) => `digest mismatch ${relative}`),
    ];
    return { ok: false, reason: `pinned OpenFilm checkout is not intact: ${parts.join("; ")}`,
      checked, missing, mismatched };
  }
  return { ok: true, reason: "all pinned files match their digests", checked, missing, mismatched };
}

/**
 * Tracked modifications, or `null` when git cannot answer. Fixed argv, never a shell: the
 * caller supplies no command, no flags and no paths of its own.
 */
async function trackedModifications(root: string, timeout: number): Promise<string[] | null> {
  try {
    const { stdout } = await run("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { timeout });
    return stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  } catch { return null; }
}

/**
 * Load the pinned upstream seam. Throws `ENGINE_UNAVAILABLE` when the checkout is absent
 * or not at the pinned SHA; never falls back to another revision or to a bundled copy.
 */
export async function createPinnedOpenFilmUpstream(vendorRoot: string,
  verified?: OpenFilmAvailability): Promise<OpenFilmUpstream> {
  const availability = verified ?? await openFilmAvailability(vendorRoot);
  if (!availability.available) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", `OpenFilm upstream unavailable: ${availability.reason}`,
      { expected_sha: OPENFILM_PIN.full_sha, observed_sha: availability.observed_sha });
  }
  // Composition may pass the verdict it obtained immediately before this call. Re-running
  // `git status` here created a second, independent transient failure window: verification
  // could succeed, then the loader could fail to repeat the same check and leave a migrated
  // project bound to an uninstalled engine. The verdict must be the exact, single-use
  // capability minted by `openFilmAvailability`, for the exact canonical root and pin.
  // Structural lookalikes fail closed even when all of their public fields appear valid.
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(vendorRoot); }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream disappeared after verification"); }
  if (!reusableAvailabilityVerdicts.delete(availability)
    || canonicalRoot !== availability.vendor_root
    || availability.observed_sha !== OPENFILM_PIN.full_sha
    || availability.expected_sha !== OPENFILM_PIN.full_sha
    || !availability.checked.includes("git_clean")) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream verification verdict is not reusable");
  }
  const moduleUrl = pathToFileURL(resolve(availability.vendor_root, OPENFILM_PIN.module_path)).href;
  let loaded: Record<string, unknown>;
  try { loaded = await import(/* @vite-ignore */ moduleUrl) as Record<string, unknown>; }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream seam could not be loaded"); }
  for (const name of OPENFILM_PIN.seam_exports) {
    if (typeof loaded[name] !== "function") {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", `OpenFilm upstream seam is missing export ${name}`);
    }
  }
  return {
    revOf: (text: string) => String((loaded.revOf as (value: string) => string)(text)),
    readProjectFilm: async (root: string) => {
      // Preserve the pinned parser, but never give its blocking readFile an externally
      // replaceable path. Only the validated film bytes enter this private parse folder.
      let bytes:Buffer=Buffer.alloc(0);
      const handle=await open(resolve(root,"film.html"),constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW)
        .catch(error=>{if(error?.code==='ENOENT')return null;throw error;});
      if(handle){
        try{
          if(!(await handle.stat()).isFile())throw new HttpError(503,"ENGINE_UNAVAILABLE","OpenFilm film is not a regular file");
          bytes=await handle.readFile();
        }finally{await handle.close();}
      }
      const isolated=await mkdtemp(join(tmpdir(),"narralens-film-read-"));
      try{
        await writeFile(join(isolated,"film.html"),bytes,{flag:"wx",mode:0o600});
        return await (loaded.readProjectFilm as (value: string) => Promise<OpenFilmFilmRead>)(isolated);
      }finally{await rm(isolated,{recursive:true,force:true});}
    },
    editProjectFilm: async (root: string, base: string | null, ops: readonly OpenFilmOp[]) =>
      await (loaded.editProjectFilm as (value: string, base: string | null, ops: readonly OpenFilmOp[]) => Promise<OpenFilmFilmEdit>)(root, base, ops),
  };
}

/**
 * The revision the upstream derives from a film.html text: the first 16 hex of its SHA-256.
 * Reimplemented here (one line, documented) so a strict base check does not require loading
 * the upstream at all.
 */
export function upstreamRevOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * The pinned cache producer: the module of the same pinned tree that draws a page's
 * picture.
 *
 * The tree's own SHA and cleanliness are verified before it is loaded, and the
 * digest of the file that was actually loaded is recorded. The pin's fields, the
 * seam's exports and the artifact are not changed: the tree's SHA already commits
 * to this file, and this loader adds no new pin.
 */
export const OPENFILM_CACHE_PRODUCER_FILE = "packages/openfilm/studio/server/pageframes.mjs";

/** The digest of that file in the pinned tree `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`. */
export const OPENFILM_CACHE_PRODUCER_SHA256 =
  "87d82f73add17d699aab963a99e45b4406cf68ecf547389b61a24083658f2828";

/**
 * The worker of one native cache draw.
 *
 * It is a fixed path beside this module: the draw is started with this file and
 * nothing else, so nothing a caller says can reach the argument vector of a
 * process. The ticket of the draw travels over the private pipe the worker
 * inherits.
 */
const CACHE_WORKER_URL = new URL("./openfilm-cache-worker.mjs", import.meta.url);

/**
 * The custodian of one native cache draw.
 *
 * It is the only wait owner of the draw's process tree, and it lives OUTSIDE the
 * group it reaps: a worker that is killed cannot reap the orphans it leaves.
 */
const CACHE_CUSTODIAN_URL = new URL("./cache-process-custodian.py", import.meta.url);

/**
 * The interpreter the custodian runs under.
 *
 * It is an absolute path that was verified on this machine, and it is never
 * looked up in the PATH of the user: another interpreter would be another
 * runtime, and the custodian is a part of the settlement.
 */
const CACHE_PYTHON_EXECUTABLE = "/usr/bin/python3.12";

/**
 * The owner of the pinned cache producer of one Host instance.
 *
 * The pinned producer keeps ONE browser for the whole process, and it is closed by
 * the upstream's own `closePageFrames`. Two Host instances may use it at the same
 * time, so one owner's close may never kill the other's render in flight: an owner
 * stops admitting new calls, drains the calls it really started, and the shared
 * browser is closed only when the LAST owner has drained and nothing is in flight.
 */
export interface OpenFilmCacheProducerOwner {
  /** Draw one page frame with the fixed producer, under this owner's admission.
   *
   * The film's own poster is drawn through THIS method as well - the upstream writes
   * it while it draws the film's own page - so the poster is a paired output of one
   * awaited call and never a background promise of its own. */
  pageFrame(request: { readonly root: string; readonly base: string; readonly rel: string; readonly ms: number; readonly width: number; readonly overrides?: unknown[] | null }): Promise<Buffer>;
  /** Stop admitting new calls and drain the calls this owner really started. */
  close(): Promise<void>;
}

/** The producers this factory issued.
 *
 * The brand is what makes a producer the FIXED one: a hand-written object that
 * merely has the right shape is not a producer, and the witness wrapper refuses it
 * instead of witnessing a picture nobody drew. */
const issuedCacheProducers = new WeakSet<object>();
/** Whether this object is a producer this factory issued. */
export function isIssuedOpenFilmCacheProducer(value: unknown): boolean {
  return typeof value === "object" && value !== null && issuedCacheProducers.has(value);
}

/** The owners of the shared browser, and the calls that are in flight. */
const cacheProducerOwners = new Set<OpenFilmCacheProducerOwner>();
let cacheProducerCalls = 0;

/**
 * The responsibility of ONE production of the fixed producer.
 *
 * It is registered BEFORE the first await of the draw, and it covers the whole
 * path: the reservation of the scope, the supervisor, the handle of the draw and
 * the controller that cancels the reservation when the owner closes.
 *
 * It is the thing a reconcile acts on. It is NOT a picture, not a promise and not
 * a number: it is the private record of a responsibility that is still open.
 */
interface ProductionResponsibility {
  readonly owner: OpenFilmCacheProducerOwner;
  /** The working copy the draw is about. */
  readonly root: string;
  /** The scope of the production, once it was taken. */
  scope: CacheProductionScope | null;
  /** Whether this draw took the scope for itself and has to give it back. */
  ownScope: boolean;
  /** The controller that cancels the reservation of the scope. */
  readonly controller: AbortController;
  /** The supervisor of the draw. It is set before the scope is taken. */
  supervisor: CacheProcessSupervisor | null;
  /** The handle of the draw. It is signed by that supervisor. */
  handle: CacheDrawHandle | null;
  /**
   * Where the responsibility is.
   *
   * `refused` is TERMINAL: the draw was refused before it took a single
   * resource, and there is nothing left of it. A responsibility that stays
   * `queued` after its promise was resolved would keep its controller and its
   * root for ever.
   */
  phase: "queued" | "executing" | "settled" | "refused";
  /** Whether the execution of the draw really ended. */
  executionSettled: boolean;
  /** Whether the parent's own resources were really drained. */
  parentDrained: boolean;
  /** The outcome of the draw: a BOUNDED summary, never the picture itself. */
  outcome: unknown;
  /** The promise that ends when the responsibility really ended. */
  readonly settled: Promise<void>;
  readonly settleOnce: () => void;
  /** The lease of the execution phase, when this draw took the scope itself. */
  executionLease: CacheProductionPhaseLease | null;
  /** The lease of the parent drain phase, when this draw took the scope itself. */
  parentLease: CacheProductionPhaseLease | null;
  /**
   * The BRIDGE that owns the parent phase of this draw.
   *
   * It is set by the bridge itself, right after it started the draw: the bridge
   * is the one that drains the parent afterwards, and the scope of a direct draw
   * covers that drain as well.
   */
  bridgeOwnsParent: boolean;
  /** The scope was given back: the draw really ended with it. */
  scopeReleased: boolean;
}

/**
 * The responsibilities of every issued producer.
 *
 * It is private to this module: the real owner of a responsibility is found here
 * and nowhere else, so a copy of a producer, a JSON object and a foreign handle
 * are all unrecognised.
 */
const productionResponsibilities = new WeakMap<object, ProductionResponsibility[]>();

/**
 * How many SETTLED responsibilities of one owner are kept.
 *
 * A settled responsibility keeps a bounded summary and nothing else: the
 * picture of a draw is eight megabytes, and a producer that lives for ever would
 * otherwise carry every picture it ever drew.
 */
const MAX_SETTLED_RESPONSIBILITIES = 8;

/** Register the responsibility of one draw, BEFORE the first await. */
function registerProductionResponsibility(
  owner: OpenFilmCacheProducerOwner,
  root: string,
): ProductionResponsibility {
  let settleOnce!: () => void;
  const settled = new Promise<void>((resolveOnce) => { settleOnce = resolveOnce; });
  const responsibility: ProductionResponsibility = {
    owner, root,
    scope: null,
    ownScope: false,
    controller: new AbortController(),
    supervisor: null,
    handle: null,
    phase: "queued",
    executionSettled: false,
    parentDrained: false,
    outcome: null,
    settled,
    settleOnce: () => { settleOnce(); },
    executionLease: null,
    parentLease: null,
    bridgeOwnsParent: false,
    scopeReleased: false,
  };
  const list = productionResponsibilities.get(owner as unknown as object);
  if (list === undefined) productionResponsibilities.set(owner as unknown as object, [responsibility]);
  else list.push(responsibility);
  return responsibility;
}

/** The responsibilities of one owner, as they are right now. */
function productionResponsibilitiesOf(owner: OpenFilmCacheProducerOwner): readonly ProductionResponsibility[] {
  return productionResponsibilities.get(owner as unknown as object) ?? [];
}

/**
 * How many responsibilities this module still holds for ONE producer.
 *
 * It is a READ-ONLY count and it grants nothing: it exists so that a case may
 * show that the history of a long living producer stays BOUNDED, and that the
 * refusals of a producer that is under pressure do not accumulate for ever.
 *
 * A responsibility that is NOT settled is never pruned: a held draw keeps its
 * real owner, and that owner is what a reconcile acts on.
 */
export function openFilmProductionResponsibilityCount(producer: unknown): number {
  if (producer === null || typeof producer !== "object") return 0;
  return productionResponsibilities.get(producer as object)?.length ?? 0;
}

/**
 * The responsibility that was registered LAST by this owner.
 *
 * The registration happens BEFORE the first await of the draw, and the draw is
 * called synchronously: the responsibility of THIS draw is therefore the one
 * that was registered last, and it is the one the caller is holding. A lookup
 * by the root would find a DIFFERENT draw - the one that is queued behind this
 * one, or the one that is still held.
 */
function lastProductionResponsibility(owner: OpenFilmCacheProducerOwner): ProductionResponsibility | undefined {
  const list = productionResponsibilitiesOf(owner);
  return list.length === 0 ? undefined : list[list.length - 1];
}

/**
 * Forget the settled responsibilities that are not needed any more.
 *
 * The ones that are NOT settled are never forgotten: a held draw keeps its real
 * owner, and that owner is what a reconcile acts on.
 */
function pruneProductionResponsibilities(owner: OpenFilmCacheProducerOwner): void {
  const list = productionResponsibilities.get(owner as unknown as object);
  if (list === undefined) return;
  let settledSeen = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index]!;
    if (entry.phase !== "settled" && entry.phase !== "refused") continue;
    settledSeen += 1;
    if (settledSeen > MAX_SETTLED_RESPONSIBILITIES) list.splice(index, 1);
  }
}

/**
 * Give the scope of a direct draw back, when the WHOLE production really ended.
 *
 * The COMPLETION is minted inside the closure of the owner of that scope, and
 * it is the only thing that may clear the held marker. A completion that could
 * not be minted means that a phase of the production did not really end: the
 * scope is then NOT released, and the root it holds stays held.
 */
function releaseProductionScope(responsibility: ProductionResponsibility): void {
  const scope = responsibility.scope;
  if (scope === null || !responsibility.ownScope || responsibility.scopeReleased) return;
  responsibility.scopeReleased = true;
  const completion = mintCacheProductionCompletion(scope, responsibility.outcome === null ? "failed" : "settled");
  const consumed = completeCacheProductionScope(scope, completion);
  if (consumed) releaseCacheProductionScope(scope);
  else markCacheProductionCleanupRequired(scope);
}

/**
 * Load the pinned cache producer of the pinned tree.
 *
 * It is the SAME tree the seam comes from, and it is loaded only after that tree's
 * own SHA and cleanliness have been verified. The digest of the file that was
 * really loaded is recorded in the owner, so the Host can say which bytes drew the
 * picture.
 */
export async function createPinnedOpenFilmCacheProducer(vendorRoot: string,
  verified?: OpenFilmAvailability): Promise<OpenFilmCacheProducerOwner & { readonly file: string; readonly sha256: string }> {
  const availability = verified ?? await openFilmAvailability(vendorRoot);
  if (!availability.available) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", `OpenFilm upstream unavailable: ${availability.reason}`,
      { expected_sha: OPENFILM_PIN.full_sha, observed_sha: availability.observed_sha });
  }
  // The verdict is the exact, single-use capability minted by `openFilmAvailability`,
  // for the exact canonical root and pin: a structural lookalike fails closed.
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(vendorRoot); }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream disappeared after verification"); }
  if (!reusableAvailabilityVerdicts.delete(availability)
    || canonicalRoot !== availability.vendor_root
    || availability.observed_sha !== OPENFILM_PIN.full_sha
    || availability.expected_sha !== OPENFILM_PIN.full_sha
    || !availability.checked.includes("git_clean")) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream verification verdict is not reusable");
  }
  const file = resolve(availability.vendor_root, OPENFILM_CACHE_PRODUCER_FILE);
  // The digest of the file that is REALLY there is recorded, not a pin field: the
  // tree's own SHA is what the pin commits to.
  const sha256 = await sha256File(file);
  if (sha256 === null || sha256 !== OPENFILM_CACHE_PRODUCER_SHA256) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm cache producer is not the pinned runtime");
  }
  // The producer is NOT loaded into this process any more.
  //
  // The pinned producer keeps ONE browser for the whole process, and it is closed by
  // the upstream's own `closePageFrames`. That browser is shared: one slow draw, one
  // abandoned page or one browser that never came back keeps the next draw waiting,
  // and a picture that was returned says nothing about whether the work behind it
  // really ended. So every draw now happens in a worker of its own, in its own
  // session and its own group, watched by a custodian that lives OUTSIDE that
  // group and is the only wait owner of it. The worker loads the very bytes this
  // factory checked above. The picture comes back; the settlement does not.
  let draining = false;
  let closePromise: Promise<void> | undefined;
  const owner: OpenFilmCacheProducerOwner = {
    pageFrame: async (request: { readonly root: string; readonly base: string; readonly rel: string; readonly ms: number; readonly width: number; readonly overrides?: unknown[] | null }) => {
      if (draining) throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm cache producer is closing");
      // The RESPONSIBILITY of this draw is registered BEFORE the first await.
      //
      // It covers the queue and the settlement: the reservation of the scope, the
      // supervisor, the handle, and the controller that cancels the reservation
      // when the owner closes. A close that arrives while the draw is still
      // waiting for a scope must be able to find it - and must be able to CANCEL
      // it, so that no worker is born after the owner closed.
      const responsibility = registerProductionResponsibility(owner, request.root);
      // Whether this call was really counted. The counter is only decremented
      // when it was incremented: a refusal before the draw was counted must not
      // take the count of the calls that ARE running below it.
      let counted = false;
      try {
        // A closed producer admits NO new production. The responsibility of this
        // draw is registered BEFORE this check, so that the caller that started
        // it always finds THIS draw and not another one.
        if (draining) throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm cache producer is closing");
        // The scope of the production this draw belongs to.
        //
        // A production that came through the workspace already holds one: the scope
        // is held over the WHOLE production - from before the PRE capture until
        // the witness is activated - and the draw is one step inside it. A draw
        // that arrives without one - a direct call of this factory - takes a scope
        // of its own from the SAME scheduler, so there is never a second queue and
        // never a way around the capacity.
        const ambient = currentCacheProductionScope();
        const scope = ambient !== null && cacheProductionScopeCovers(ambient, request.root)
          ? ambient
          : await acquireCacheProductionScope(request.root, {
            signal: responsibility.controller.signal,
            // A scope this draw takes for itself is a DIRECT scope: it owns the
            // execution of the draw AND the drain of the parent's own resources.
            // The scope of a workspace owns the whole production, and it is never
            // taken again here.
            mode: "direct",
            owner,
          });
        responsibility.scope = scope;
        responsibility.ownScope = scope !== ambient;
        // The supervisor is created WITH the scope: a draw whose cleanup could not
        // be proven has to mark the root it holds, and it can only do that when it
        // knows which scope that is. The scope is the ambient one when the draw
        // is inside a workspace, and the draw's own one otherwise.
        const supervisor = new CacheProcessSupervisor({
          vendorRoot: availability.vendor_root,
          producerFile: OPENFILM_CACHE_PRODUCER_FILE,
          producerSha256: sha256,
          workerPath: fileURLToPath(CACHE_WORKER_URL),
          custodianPath: fileURLToPath(CACHE_CUSTODIAN_URL),
          pythonExecutable: CACHE_PYTHON_EXECUTABLE,
          scope,
        });
        responsibility.supervisor = supervisor;
        responsibility.handle = supervisor.reserve({
          root: request.root, base: request.base, rel: request.rel,
          ms: request.ms, width: request.width, overrides: request.overrides ?? null,
        });
        // The leases of the phases this draw took the scope for. They are opened
        // HERE, by the owner of the scope, and they are settled by the code that
        // really ends the phase.
        if (responsibility.ownScope) {
          responsibility.executionLease = openCacheProductionPhaseLease(scope, "execution", owner);
          responsibility.parentLease = openCacheProductionPhaseLease(scope, "parent_drain", owner);
        }
        // The owner may have closed while the draw was waiting for its scope. A
        // draw that is admitted after the close is a draw that may not be born.
        if (draining) {
          throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm cache producer is closing");
        }
        responsibility.phase = "executing";
        cacheProducerCalls += 1;
        counted = true;
        const settlement = await supervisor.start(responsibility.handle);
        responsibility.executionSettled = true;
        // The outcome is a BOUNDED summary: the picture of a draw is eight
        // megabytes, and a producer that lives for ever may not carry every
        // picture it ever drew.
        responsibility.outcome = settlement.error !== null
          ? settlement.error
          : settlement.picture === null
            ? null
            : { digest: createHash("sha256").update(settlement.picture).digest("hex"), bytes: settlement.picture.length };
        responsibility.phase = "settled";
        if (settlement.error !== null) throw settlement.error;
        if (settlement.picture === null) throw new Error("The cache draw ended with no picture");
        return settlement.picture;
      } finally {
        if (counted) cacheProducerCalls -= 1;
        const scope = responsibility.scope;
        // The EXECUTION phase really ended - with a picture or with a failure.
        // Its lease is settled HERE; the lease of the PARENT DRAIN is settled by
        // the bridge that drains the parent, and only there.
        if (responsibility.ownScope) responsibility.executionLease?.settle();
        // A scope this draw took for itself is given back when the WHOLE
        // production really ended. A draw whose cleanup could not be proven keeps
        // it: the root stays held, and the next production of that root does not
        // start.
        //
        // When the BRIDGE owns the parent phase, the scope is given back THERE:
        // the bridge drains the parent after this call returned, and a scope that
        // was given back before that drain let the next production of the same
        // root walk over resources that were still there.
        if (scope !== null && responsibility.ownScope && !responsibility.bridgeOwnsParent) {
          // There was no bridge: there was no parent to drain, and the phase is
          // over.
          responsibility.parentLease?.settle();
          releaseProductionScope(responsibility);
        }
        if (!responsibility.bridgeOwnsParent) {
          // A draw that never took a single resource is TERMINAL: there is
          // nothing left of it, and it may be pruned. A draw that DID take a
          // resource and whose cleanup could not be proven keeps its phase, and
          // it is not pruned.
          if (responsibility.phase === "queued") responsibility.phase = "refused";
          responsibility.settleOnce();
          pruneProductionResponsibilities(owner);
        }
      }
    },
    close: async () => {
      // The close is SHARED: a second close waits for the very same settlement and
      // never returns before the first one did.
      if (closePromise !== undefined) return closePromise;
      draining = true;
      closePromise = (async (): Promise<void> => {
        // The reservations that are still waiting for a scope are CANCELLED: no
        // worker may be born after this owner closed.
        for (const responsibility of productionResponsibilitiesOf(owner)) {
          responsibility.controller.abort();
        }
        // The calls this owner really started are waited for. A call that is still
        // running is waited for, never killed.
        await Promise.allSettled(
          productionResponsibilitiesOf(owner).map(responsibility => responsibility.settled));
        cacheProducerOwners.delete(owner);
        // There is no shared browser left to close: the browser of a draw belongs to
        // the worker of that draw, and that worker closed it. A browser that did
        // not close is a cleanup this owner cannot prove, and it is the supervisor
        // of that draw that holds the evidence.
      })();
      return closePromise;
    },
  };
  cacheProducerOwners.add(owner);
  // The brand: only this factory's own producer may draw, and only it may be
  // witnessed. The branded object and the returned object are THE SAME ONE: a copy
  // would not be the producer, and the owner ledger counts the very object that is
  // returned.
  issuedCacheProducers.add(owner);
  // The vendor tree of this producer, in this module's private table. A serving owner
  // is created FROM a producer, so the vendor path is a property of the producer and
  // never a string a caller hands over.
  issuedProducerRoots.set(owner, canonicalRoot);
  const issued=Object.assign(owner,{file:OPENFILM_CACHE_PRODUCER_FILE,sha256});
  return Object.freeze(issued);
}



/**
 * The fixed upstream's own serving of ONE project folder.
 *
 * It is the upstream's `folderFiles` - the very function the upstream's own Studio
 * serves its projects with (`studio/server/pages.mjs`) - loaded from the SAME
 * verified tree as the cache producer. The Host answers no page of its own: the
 * upstream decides what a project serves, what the film's own page carries (its
 * timeline runtime, served at `__film/timeline.mjs`) and what is refused.
 *
 * The tree's own SHA and cleanliness are verified before it is loaded, and every
 * file the serving loads or inlines is checked against the pinned tree's own
 * digest. The catalog of those files is this module's own: a caller cannot replace
 * it. The pin's fields are not changed and no new pin is added. Nothing of the
 * user's preferences, of the Studio or of a whole server is read.
 */
export const OPENFILM_FOLDER_SERVER_FILE = "packages/openfilm/src/host.mjs";

/** The digest of that file in the pinned tree `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`. */
export const OPENFILM_FOLDER_SERVER_SHA256 =
  "dfed0fd5b068823d06b5091fbc01821791f0f470bbf061741bf21a25dc0bb170";

/**
 * The fixed runtime the folder serving loads or inlines.
 *
 * `host.mjs` is loaded; `timeline.mjs`, `film-doc.mjs` and `overrides.mjs` are
 * inlined by it and served at the virtual routes; `media-links.mjs` is imported by
 * it. Every one of them is checked against the pinned tree before the serving is
 * used, and the catalog is this module's own.
 */
const OPENFILM_FOLDER_RUNTIME: readonly { readonly file: string; readonly sha256: string }[] = Object.freeze([
  { file: "packages/openfilm/src/host.mjs", sha256: OPENFILM_FOLDER_SERVER_SHA256 },
  { file: "packages/openfilm/src/timeline.mjs", sha256: "75b4cca45fd22937e1fa6dbc5f67af001ab591d4a2f85efee49fb025e154e0a4" },
  { file: "packages/openfilm/src/film-doc.mjs", sha256: "feef7be8181e7ec63cf2b8760f3a32b7b7e22cd851d4e5a233c04f1768cf719d" },
  { file: "packages/openfilm/src/overrides.mjs", sha256: "919fe02956cafaa6f81e63898bae98302a24677d4fd8e7e3537ab0a4c733f6dd" },
  { file: "packages/openfilm/src/media-links.mjs", sha256: "ff65c045f37edfdc1e3f39454dd6d93f2fb5a112991dd595a46a5e049ab9438f" },
]);

/**
 * The virtual runtime the upstream serves beside a project.
 *
 * These are the upstream's OWN runtime files - the film's page loads them to play
 * the film - and NOT project assets: they are exact routes, never a prefix, and
 * they are kept apart from the files of the project itself. The upstream's own
 * dependency collector leaves them out of what a picture is witnessed to have
 * read, so they never become a dependency of a witness.
 */
const OPENFILM_VIRTUAL_RUNTIME_ROUTES = new Set([
  "__film/timeline.mjs",
  "__film/film-doc.mjs",
  "__film/overrides.mjs",
  "__film/frame-duration",
]);

/** What the owner of a folder server learns when it waits for its own work. */
export interface OpenFilmFolderSettlement {
  /** The requests that were answered completely. */
  readonly finished:number;
  /** The requests that were aborted before their answer was complete. */
  readonly aborted:number;
  /** The work that was still open when the settlement was taken. */
  readonly open:number;
}

/** One project folder, served by the fixed upstream. */
export interface OpenFilmFolderServer {
  /**
   * Answer one request.
   *
   * The Host's own constraints are in front of the upstream's handler: only a read
   * is answered, the root must still be the very directory this server was bound
   * to, an address that names a dot file, a folder out of the root, a backslash, a
   * NUL or a colon is refused, a link out of the root is refused (the upstream's
   * own readable-link exception may not open the Host's boundary), the address a
   * media probe is about is checked with the same rules, and the virtual runtime is
   * an exact set of routes. The headers - the policy among them - are on every
   * answer, the refusal ones included.
   */
  readonly handle: (req: IncomingMessage, res: ServerResponse) => void;
  /** The upstream file that was really loaded, relative to the pinned tree. */
  readonly file: string;
  /** The digest of the bytes that were really loaded. */
  readonly sha256: string;
  /** The root this server is bound to. It serves nothing else. */
  readonly root: string;
  /** The requests and the real media probes this server really started. */
  readonly pending: () => number;
  /**
   * Stop admitting new work.
   *
   * A frozen serving opens no file of the project and starts no probe: a request
   * that arrives after the freeze is refused with a bounded answer, and nothing
   * new is created. The freeze is SYNCHRONOUS: between the freeze and the drain
   * that follows it, no new work can slip in.
   */
  readonly freezeAdmission: () => void;
  /**
   * The failures of the sources and of their closing.
   *
   * An error of a source is not a close, and a failure of the destroy is not a
   * silence: both are kept here, so that the party that drains this serving can
   * keep its own responsibility instead of reading an empty ledger.
   */
  readonly failures: () => readonly unknown[];
  /**
   * Admit work again.
   *
   * The next draw opens the admission of its own serving again, explicitly. A
   * serving that is closed never opens again.
   */
  readonly openAdmission: () => void;
  /** Whether the admission of this serving is frozen right now. */
  readonly admissionFrozen: () => boolean;
  /**
   * Wait until the work this server really started has settled.
   *
   * A request that never ends is not given a deadline to hide behind: the wait is
   * the real settlement, and what did not settle is named. The real SOURCE of an
   * answer - the readable the upstream streamed into the response - is part of
   * that work: a response that ended is not a source that closed.
   */
  readonly drain: () => Promise<OpenFilmFolderSettlement>;
}

/**
 * Load the fixed upstream's own folder serving, bound to ONE root.
 *
 * The root is the canonical real path of the folder that is served: a symlink is
 * resolved once, and every answer is checked against that one root - and against
 * the identity that root had when the serving was bound.
 */
export async function createPinnedOpenFilmFolderServer(
  vendorRoot: string,
  root: string,
  verified?: OpenFilmAvailability,
  options?: { headers?: Record<string, string> },
): Promise<OpenFilmFolderServer> {
  const availability = verified ?? await openFilmAvailability(vendorRoot);
  if (!availability.available) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", `OpenFilm upstream unavailable: ${availability.reason}`,
      { expected_sha: OPENFILM_PIN.full_sha, observed_sha: availability.observed_sha });
  }
  // The verdict is the exact, single-use capability minted by `openFilmAvailability`.
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(vendorRoot); }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream disappeared after verification"); }
  if (!reusableAvailabilityVerdicts.delete(availability)
    || canonicalRoot !== availability.vendor_root
    || availability.observed_sha !== OPENFILM_PIN.full_sha
    || availability.expected_sha !== OPENFILM_PIN.full_sha
    || !availability.checked.includes("git_clean")) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream verification verdict is not reusable");
  }
  // Every file the serving loads or inlines is the pinned one. The catalog is this
  // module's own: a caller cannot say which runtime is served.
  for (const entry of OPENFILM_FOLDER_RUNTIME) {
    const digest = await sha256File(resolve(availability.vendor_root, entry.file));
    if (digest === null || digest !== entry.sha256) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", "The OpenFilm folder server runtime is not the pinned one");
    }
  }
  // The root this server is bound to: a real directory, and the one real path.
  const bound = resolve(root);
  let info;
  try { info = statSync(bound); }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "The OpenFilm folder server has no root"); }
  if (!info.isDirectory()) throw new HttpError(503, "ENGINE_UNAVAILABLE", "The OpenFilm folder server root is not a directory");
  const realRoot = realpathSync(bound);
  const rootIdentity = { dev: info.dev, ino: info.ino };
  const moduleUrl = pathToFileURL(resolve(availability.vendor_root, OPENFILM_FOLDER_SERVER_FILE)).href;
  let loaded: Record<string, unknown>;
  try { loaded = await import(/* @vite-ignore */ moduleUrl) as Record<string, unknown>; }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "The OpenFilm folder server could not be loaded"); }
  if (typeof loaded.folderFiles !== "function" || typeof loaded.frameDuration !== "function") {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", "The OpenFilm folder server is missing its exports");
  }
  const folderFiles = loaded.folderFiles as (
    root: string,
    opts?: { inject?: string; timelineInject?: string; headers?: Record<string, string> },
  ) => (req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams) => boolean;
  // The upstream's own probe of a media file. It keeps ONE promise per file version,
  // so the promise of the route and the promise of a caller are the SAME one.
  const frameDuration = loaded.frameDuration as (file: string) => Promise<number | null>;
  // The DEFAULT runtime of the upstream: its own host flag, and the film's own page
  // carries the upstream's timeline runtime. Nothing of the Studio is injected.
  const serve = folderFiles(realRoot, options?.headers ? { headers: options.headers } : {});
  const headers = options?.headers ?? {};
  const refuse = (res: ServerResponse, status: number, message: string): void => {
    res.writeHead(status, { ...headers, "content-type": "text/plain; charset=utf-8" }).end(message);
  };
  // The work this server really started: the requests it answers, the media
  // probes the upstream really runs, and the real SOURCES the upstream streamed
  // into the responses.
  //
  // A source is its own resource with its own file descriptor. A response that
  // ended - even one that was aborted - does not close the source: the source is
  // closed when the source says so, and that is what the drain waits for.
  const requests = new Set<Promise<void>>();
  const probes = new Set<Promise<unknown>>();
  const streams = new Set<Promise<void>>();
  /** The failures of the sources and of their closing. They are KEPT. */
  const sourceFailures: unknown[] = [];
  let finished = 0;
  let aborted = 0;
  /** A frozen serving opens no file and starts no probe. */
  let admissionFrozen = false;
  const track = <T,>(set: Set<T>, work: T): void => {
    set.add(work);
    void Promise.resolve(work).then(() => set.delete(work), () => set.delete(work));
  };
  /** The one real path inside the root, or null. A link out of it is refused. */
  const inside = (relative: string): string | null => {
    const parts = relative.split("/").filter(part => part !== "");
    if (parts.some(part => part.startsWith(".") || part === "..")) return null;
    const asked = resolve(realRoot, parts.join("/"));
    if (asked !== realRoot && !asked.startsWith(realRoot + sep)) return null;
    let real: string;
    try { real = realpathSync(asked); }
    catch { return null; }
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
    return asked;
  };
  /**
   * Answer one request.
   *
   * Every failure of the serving is a BOUNDED answer: a bad address is a 400, a
   * resource that is not there is a 404, and an unexpected failure of the serving
   * itself is a 500 - never an exception that escapes into the HTTP listener and
   * ends the process, and never an answer that calls a failure a success.
   */
  const answer = (req: IncomingMessage, res: ServerResponse): void => {
    // A frozen serving admits NOTHING new.
    //
    // The check is FIRST: no file of the project is opened, no probe is started and
    // no stream is created. The answer is a bounded refusal, and the listener stays
    // up: the resources that were already accepted are still there to be drained.
    if (admissionFrozen) { refuse(res, 503, "unavailable"); return; }
    // A page is read, never written.
    if (req.method !== "GET" && req.method !== "HEAD") { refuse(res, 405, "method not allowed"); return; }
    // The root must still be the very directory this server was bound to.
    let rootInfo;
    try { rootInfo = statSync(realRoot); }
    catch { refuse(res, 503, "unavailable"); return; }
    if (!rootInfo.isDirectory() || rootInfo.dev !== rootIdentity.dev || rootInfo.ino !== rootIdentity.ino) {
      refuse(res, 503, "unavailable"); return;
    }
    const url = req.url ?? "/";
    // The request target must be an ORIGIN-FORM path: it starts with "/" and it is
    // not an authority reference. A target that starts with "//" is not a path here
    // - the URL parser reads it as ANOTHER origin, and an unterminated one is not a
    // URL at all - so it is refused before anything is parsed. Every other target
    // keeps the answer it always had.
    if (!url.startsWith("/") || url.startsWith("//")) { refuse(res, 400, "bad address"); return; }
    const rawPath = url.split("?")[0] ?? "/";
    let decoded: string;
    try { decoded = decodeURIComponent(rawPath); }
    catch { refuse(res, 400, "bad address"); return; }
    // An address speaks in `/`: a backslash in it, a NUL or a colon is never a name.
    if (decoded.includes("\\") || decoded.includes("\0") || decoded.includes(":")) { refuse(res, 400, "bad address"); return; }
    const relative = decoded.replace(/^\/+/, "");
    const segments = relative.split("/").filter(part => part !== "");
    // A dot file or a dot folder is never served: the native's own metadata and
    // the person's own files stay out of the page origin.
    if (segments.some(part => part.startsWith("."))) { refuse(res, 403, "forbidden"); return; }
    if (segments.some(part => part === "..")) { refuse(res, 403, "forbidden"); return; }
    // The query is the upstream's own query: the same parser, the same semantics.
    // It is only BOUNDED: a target the parser refuses is a bad address, not a
    // failure of the serving.
    let query: URLSearchParams;
    try { query = new URL(url, "http://127.0.0.1").searchParams; }
    catch { refuse(res, 400, "bad address"); return; }
    if (segments[0] === "__film") {
      // The virtual runtime is an exact set of routes, never a prefix.
      if (!OPENFILM_VIRTUAL_RUNTIME_ROUTES.has(relative)) { refuse(res, 403, "forbidden"); return; }
      if (relative === "__film/frame-duration") {
        // The address the probe is about is a file of the project: it is checked
        // here, with the same rules, so the virtual route is no way out of the
        // root - and the upstream's own file lookup, which allows a readable
        // link, never gets the chance to answer for it.
        const of = query.get("of");
        if (of === null) { refuse(res, 400, "bad address"); return; }
        let target: string;
        try { target = decodeURIComponent(of); }
        catch { refuse(res, 400, "bad address"); return; }
        if (target.includes("\\") || target.includes("\0") || target.includes(":")) { refuse(res, 400, "bad address"); return; }
        const asked = inside(target);
        if (asked === null) { refuse(res, 403, "forbidden"); return; }
        // The upstream's own probe of that file: the SAME promise its own route
        // uses (the upstream keeps one promise per file version), so what is
        // tracked here is the real probe and not a report about it.
        track(probes, frameDuration(asked));
      }
    } else {
      // A file of the project: it must be inside the ONE root this server is
      // bound to.
      if (inside(relative) === null) { refuse(res, 404, "not found"); return; }
    }
    // The REAL SOURCE of the answer, when the upstream streams a file into the
    // response.
    //
    // It is observed, never patched: the upstream's bytes are not touched and `fs`
    // is not touched globally. The source is registered BEFORE it is waited for,
    // and it leaves the ledger only when it REALLY closed.
    //
    // An error of the source is NOT a close: the error object is kept, the source
    // is destroyed if it is the one this response owns, and the REAL close is
    // still waited for. A file descriptor that was closed by an error path is not
    // the same fact as a file descriptor that was closed.
    let ownedSource: Readable | undefined;
    res.on("pipe", (source: Readable) => {
      ownedSource = source;
      const closed = new Promise<void>(resolveClose => {
        let done = false;
        const settle = (): void => { if (done) return; done = true; resolveClose(); };
        source.once("close", settle);
        source.once("error", (error: unknown) => {
          // The error is KEPT. It is not a close, and it does not settle the
          // ledger: the real close of the source is still waited for.
          sourceFailures.push(error);
        });
      });
      track(streams, closed);
    });
    // The request itself: the HTTP side is tracked, and a request that was
    // aborted is told apart from one that was answered.
    const settled = new Promise<void>(resolve => {
      let done = false;
      res.on("finish", () => { done = true; finished += 1; resolve(); });
      res.on("close", () => {
        if (!done) {
          aborted += 1;
          // The response was aborted. The source this response really owns is
          // destroyed, and its real close is what the stream ledger waits for: the
          // end of the response is NOT the end of the source. A failure of the
          // destroy is KEPT as well: it is a reason, not a silence.
          try { ownedSource?.destroy(); }
          catch (error) { sourceFailures.push(error); }
        }
        resolve();
      });
    });
    track(requests, settled);
    if (!serve(req, res, rawPath, query)) refuse(res, 403, "forbidden");
  };
  return Object.freeze({
    file: OPENFILM_FOLDER_SERVER_FILE,
    sha256: OPENFILM_FOLDER_SERVER_SHA256,
    root: realRoot,
    pending: () => requests.size + probes.size + streams.size,
    freezeAdmission: (): void => { admissionFrozen = true; },
    openAdmission: (): void => { admissionFrozen = false; },
    admissionFrozen: (): boolean => admissionFrozen,
    failures: (): readonly unknown[] => Object.freeze([...sourceFailures]),
    drain: async (): Promise<OpenFilmFolderSettlement> => {
      // The real settlement, not a deadline: a work that never ends is named.
      while (requests.size > 0) await Promise.allSettled([...requests]);
      while (streams.size > 0) await Promise.allSettled([...streams]);
      while (probes.size > 0) await Promise.allSettled([...probes]);
      return { finished, aborted, open: requests.size + probes.size + streams.size };
    },
    handle: (req: IncomingMessage, res: ServerResponse): void => {
      try { answer(req, res); }
      catch {
        // An unexpected failure of the serving is a failure of the SERVING: it is
        // answered with a bounded 500 - never with a success, and never with an
        // exception that escapes into the HTTP listener and ends the process. A
        // resource or a media that is not there is NOT this: it keeps its own
        // refusal, and the answer that was already begun is only ended.
        try {
          if (res.headersSent) res.end();
          else res.writeHead(500, { ...headers, "content-type": "text/plain; charset=utf-8" }).end("unavailable");
        } catch { /* the response is already gone: there is nothing left to answer */ }
      }
    },
  });
}

/**
 * A serving owner that OWNS its listener.
 *
 * The folder server above is a handler: it answers requests, and whoever mounts it
 * decides where it answers from. That is a good tool and a BAD authority: a caller
 * that mounts the handler on its own server may then claim any origin it likes, and
 * the origin it claims has nothing to do with the root the Host issued.
 *
 * This owner is the other thing: it creates and holds its own loopback listener, its
 * own handler and the identity of the ONE root it serves. The facts about it live in
 * this module's private table, and the only way to read them is
 * `openFilmServingBinding`, which hands out a READ-ONLY COPY. A copy of an owner, an
 * object that merely has the same shape, and the handler-only tool above are all
 * unrecognised here: they are not in the table, so they can never be the origin of a
 * witnessed draw.
 *
 * The owner it is created for is an ISSUED producer, so the serving always comes from
 * the same pinned tree the producer came from - the vendor path is a property of the
 * producer, not of a string somebody hands over.
 */
export interface OpenFilmServingOwner {
  /** The origin of this owner's own listener. A copy of a fact, not the fact. */
  readonly origin: string;
  /** The root this owner serves, canonically. A copy of a fact, not the fact. */
  readonly root: string;
  /** This owner's own generation. It means something only inside this module. */
  readonly generation: number;
  /**
   * Accept ONE draw.
   *
   * The accepted draws are what this serving OWNS: a close waits for all of them to
   * finish, including the page, the iframe and the media requests they still have to
   * make. A close that is already under way refuses a new draw.
   */
  beginDraw(): void;
  /** This draw has finished - whether it drew a picture or not. */
  endDraw(): void;
  /**
   * Stop admitting new draws and settle everything this owner really started.
   *
   * The settlement is SHARED: a second close waits for the very same settlement and
   * never returns before the first one did.
   */
  close(): Promise<void>;
}

/**
 * The Host-private observation of a serving's own lifecycle.
 *
 * It exists for the DETERMINISTIC ORDER of a case (a close during the construction, a
 * close during a draw). It returns nothing and it grants nothing: the facts it fires
 * at are re-read after the callback returns, so a case can never make a serving
 * real by observing it.
 */
export type OpenFilmServingLifecyclePoint =
  /** The listener is up; the root is not verified yet. */
  | "serving_listening"
  /** The root is verified; the owner is about to be returned. */
  | "serving_root_verified"
  /** A request really reached this serving. */
  | "serving_request"
  /** The factory settled what it started: it never returned an owner. */
  | "serving_aborted"
  /** The service closed a serving it had created. */
  | "serving_closed"
  /** The same facts, with their read-only payload in the name: the origin the serving
   *  really listened on, and the path of the request that really reached it. */
  | `serving_listening:${string}`
  | `serving_request:${string}`
  /** The factory really closed one of its resources; a case may throw here, after
   *  the close, to inject a genuine settlement failure. */
  | `serving_cleanup:${string}`
  /** A request that really reached this serving was ANSWERED. */
  | "serving_request_completed"
  | `serving_request_completed:${string}`;

/** A private bridge that may draw with the FIXED REGISTERED producer. */
export interface OpenFilmServingBridge {
  /**
   * Draw one page frame with the fixed producer, under this serving's admission.
   *
   * The root and the origin come from the SERVING's own facts; the producer is the
   * one this module issued. A caller can neither hand over a base nor a producer of
   * its own.
   */
  draw(request: { readonly rel: string; readonly ms: number; readonly width: number; readonly overrides: unknown[] | null }): Promise<OpenFilmDrawResult>;
  /**
   * The Host-private state of EVERY production of this bridge that is not
   * settled yet.
   *
   * It is a READ-ONLY LIST OF COPIES and it grants nothing. Every entry names
   * the opaque handle of ITS OWN responsibility, and that handle is meaningful
   * only to a reconcile of THIS bridge.
   *
   * It is a LIST and not one view: a bridge that holds a production which is
   * stuck and starts another one must not let the second one hide the first.
   */
  inspectCleanup(): readonly OpenFilmCleanupView[];
  /**
   * Advance the EXECUTION of the production this bridge is drawing for.
   *
   * It settles the execution of the draw - and nothing else. The parent drain of
   * the serving and the whole production of the workspace go on afterwards, in
   * their own order: a reconcile that waited for them would wait for itself.
   */
  reconcileCleanup(handle: unknown): Promise<OpenFilmCleanupView>;
}

/**
 * What ONE draw of a bridge ended with.
 *
 * The parent drain of the serving belongs to the draw that asked for it, and it
 * is reported HERE: the continuation of that draw is the only thing that may
 * read it.
 */
export interface OpenFilmDrawResult {
  /** The picture the draw really produced. */
  readonly picture: Buffer;
  /** Whether the parent's own resources were really drained. */
  readonly parent_drained: boolean;
  /** The opaque handle of THIS draw: it is the one a reconcile acts on. */
  readonly handle: unknown;
}

/**
 * The Host-private view of the cleanup of one production.
 *
 * It is a copy of facts and not a capability: the handle it names is the opaque
 * handle of a responsibility, and only the issuer of that responsibility may act
 * on it.
 */
export interface OpenFilmCleanupView {
  /** Whether this bridge has a production at all. */
  readonly known: boolean;
  /** The opaque handle of the responsibility, or null. */
  readonly handle: unknown;
  /** The phase of the execution of the draw. */
  readonly phase: string;
  /** Whether the execution is held because its cleanup could not be proven. */
  readonly cleanup_required: boolean;
  /** Whether the execution really ended. */
  readonly settled: boolean;
  /** The outcome that was latched for the draw. */
  readonly latched: { readonly kind: string; readonly code: string | null; readonly message: string | null; readonly native_phase: string | null } | null;
  /** Where the responsibility is: queued, executing or settled. */
  readonly parent_phase: string;
  /** Whether the parent's own resources were really drained. */
  readonly parent_drained: boolean;
}

/**
 * The responsibility of one draw, by the root it is about.
 *
 * It is NOT how a bridge finds its own draw any more: a bridge holds the
 * responsibility of the draw it started, because a lookup by the root finds the
 * LAST registration of that root, and the last registration may be a draw that
 * is still QUEUED behind the one that is held.
 */
function responsibilityOfRoot(
  owner: OpenFilmCacheProducerOwner,
  root: string,
): ProductionResponsibility | undefined {
  const list = productionResponsibilitiesOf(owner);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const responsibility = list[index]!;
    if (responsibility.root === root) return responsibility;
  }
  return undefined;
}

/**
 * The GENUINE settlement failures of a failed construction, by the failure itself.
 *
 * A property on the error is NOT authority: it can be lost, it can be forged, and it
 * does not survive a frozen error. This module's own private ledger is the authority:
 * only the factory writes here, and the only way to read it is the read-only getter
 * below. A caller that holds the failure can ask what really went wrong while the
 * factory was settling its own resources.
 */
const genuineServingFailures = new WeakMap<object, readonly unknown[]>();

/**
 * The genuine settlement failures of THIS failure.
 *
 * It is a read-only copy of the ledger's own record, and it is empty for anything this
 * module did not fail at.
 */
export function genuineServingCleanupFailures(failure: unknown): readonly unknown[] {
  if (failure === null || typeof failure !== "object") return [];
  return genuineServingFailures.get(failure) ?? [];
}

/**
 * Keep the primary failure and record the genuine settlement failures with it.
 *
 * The primary is never replaced: a failure that happened while the factory was
 * settling its own resources does not become the reason of the construction. The
 * failures are recorded in this module's own ledger, so they are not lost when the
 * primary is frozen, and they are not a property anybody could have forged.
 */
function withCleanupFailures(primary: unknown, failures: readonly unknown[]): unknown {
  if (primary === null || typeof primary !== "object") {
    // A primitive primary cannot carry anything: it is wrapped, and the WRAPPER is
    // what carries the genuine failures - the original is kept as its cause.
    const wrapped = new Error(String(primary));
    try { Object.defineProperty(wrapped, "cause", { value: primary, enumerable: false, configurable: true }); }
    catch { /* the wrapper keeps what it can */ }
    if (failures.length > 0) genuineServingFailures.set(wrapped, [...failures]);
    return wrapped;
  }
  if (failures.length > 0) {
    genuineServingFailures.set(primary as object, [...failures]);
    // The property is a convenience for a reader; the ledger is the authority.
    try {
      Object.defineProperty(primary, "cleanup_failures", { value: [...failures], enumerable: false, configurable: true });
    } catch { /* a frozen primary keeps the ledger's record */ }
  }
  return primary;
}

/** The private facts of one serving owner. Only the factory writes here. */
interface OpenFilmServingFacts {
  /** The owner object itself: it is filled in once the owner has been built. */
  owner: OpenFilmServingOwner;
  /** The issued producer this serving was created for. */
  producer: object;
  origin: string;
  canonical_root: string;
  dev: string;
  ino: string;
  generation: number;
  readonly folder: OpenFilmFolderServer;
  /** How many requests this owner's own listener really answered. */
  requests: number;
  /** The draws this serving has ACCEPTED and not yet settled. */
  accepted: number;
  /** Closing: no NEW draw is admitted any more. */
  closing: boolean;
  /** The settlement of the accepted draws; resolved when the last one finishes. */
  drawsSettled: Promise<void>;
  resolveDraws: () => void;
  /** The ONE settlement of the close. Repeated closes share it. */
  closePromise: Promise<void> | undefined;
  closed: boolean;
}

/** The serving owners this module issued. Only the factory writes here. */
const issuedServings = new WeakMap<object, OpenFilmServingFacts>();
/** The vendor tree of every issued producer: the serving comes from the same tree. */
const issuedProducerRoots = new WeakMap<object, string>();
/** This module's own counter of the owners it issued. Its domain is this module only. */
let servingGeneration = 0;

/**
 * The read-only facts of an issued serving owner.
 *
 * They are a COPY: the caller can read them and can hand them around, but it cannot
 * change what this module knows. A value that this module did not issue - a copy of an
 * owner, a lookalike, the handler-only tool - has no facts here at all.
 */
export interface OpenFilmServingBinding {
  readonly origin: string;
  readonly canonical_root: string;
  readonly dev: string;
  readonly ino: string;
  readonly generation: number;
  readonly closed: boolean;
  /** Closing: no NEW draw is admitted any more. */
  readonly closing: boolean;
  /** The draws this serving has accepted and not yet settled. */
  readonly accepted: number;
  /** How many requests this owner's own listener really answered. */
  readonly requests: number;
  /** The requests and the media probes that are in flight RIGHT NOW. */
  readonly pending: number;
  /** The issued producer this serving was created for. */
  readonly producer: object;
}

/** The read-only facts of an issued serving owner, or null when this module did not issue it. */
export function openFilmServingBinding(owner: unknown): OpenFilmServingBinding | null {
  if (owner === null || typeof owner !== "object") return null;
  const facts = issuedServings.get(owner);
  if (facts === undefined) return null;
  return Object.freeze({
    origin: facts.origin, canonical_root: facts.canonical_root, dev: facts.dev, ino: facts.ino,
    generation: facts.generation, closed: facts.closed, closing: facts.closing, accepted: facts.accepted,
    requests: facts.requests, pending: facts.folder.pending(), producer: facts.producer,
  });
}

/**
 * Create a serving owner that owns its listener, for ONE root, of the pinned tree the
 * given issued producer came from.
 *
 * The producer must be one this factory issued: the vendor path is taken from the
 * producer's own registration, never from a string of the caller's.
 */
export async function createPinnedOpenFilmServingOwner(
  producer: unknown,
  root: string,
  options?: { headers?: Record<string, string>; lifecycle?: (point: OpenFilmServingLifecyclePoint) => void },
): Promise<OpenFilmServingOwner> {
  if (producer === null || typeof producer !== "object") {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", "The cache producer is not one this factory issued");
  }
  const vendorRoot = issuedProducerRoots.get(producer);
  if (vendorRoot === undefined) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", "The cache producer is not one this factory issued");
  }
  // The fixed upstream's own serving of that ONE root. It is the same pinned tree,
  // verified the same way, and it serves nothing else.
  const folder = await createPinnedOpenFilmFolderServer(vendorRoot, root, undefined, options);
  const facts: OpenFilmServingFacts = {
    owner: undefined as unknown as OpenFilmServingOwner,
    producer: producer as object,
    origin: "",
    canonical_root: "",
    dev: "",
    ino: "",
    generation: (servingGeneration += 1),
    folder,
    requests: 0,
    accepted: 0,
    closing: false,
    drawsSettled: Promise.resolve(),
    resolveDraws: () => undefined,
    closePromise: undefined,
    closed: false,
  };
  let port = 0;
  const server = createServer((req, res) => {
    // Only this machine answers, and only under this origin's OWN port.
    const host = String(req.headers.host ?? "").toLowerCase();
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/u.test(host) || Number(host.slice(host.lastIndexOf(":") + 1)) !== port) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("forbidden");
      return;
    }
    facts.requests += 1;
    // The observation of a request that REACHED this serving, in BOTH forms: the old
    // named event and the payload event with the path it asked for. It grants
    // nothing: it is a name and a read-only fact.
    options?.lifecycle?.("serving_request");
    options?.lifecycle?.(`serving_request:${req.url ?? "/"}`);
    // The COMPLETION of that request: a case has to be able to see that a request it
    // waited for really was ANSWERED, not only that it arrived.
    res.on("finish", () => {
      options?.lifecycle?.("serving_request_completed");
      options?.lifecycle?.(`serving_request_completed:${req.url ?? "/"}`);
    });
    folder.handle(req, res);
  });
  // EVERYTHING this factory starts is settled by THIS factory: an owner that was
  // never returned cannot be the service's to close. The listen itself is inside the
  // boundary, so a failed listen has a determined owner too.
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", "The OpenFilm serving owner has no port");
    }
    port = address.port;
    facts.origin = `http://127.0.0.1:${port}`;
    // The observation comes in BOTH forms: the old named event, so a consumer that
    // knows the name still fires exactly as before, and the payload event, so a case
    // can PROVE that this very origin - the port the factory really listened on - is
    // closed afterwards.
    options?.lifecycle?.("serving_listening");
    options?.lifecycle?.(`serving_listening:${facts.origin}`);
    facts.canonical_root = realpathSync(resolve(root));
    const rootInfo = statSync(facts.canonical_root, { bigint: true });
    facts.dev = rootInfo.dev.toString();
    facts.ino = rootInfo.ino.toString();
    options?.lifecycle?.("serving_root_verified");
  } catch (error) {
    // The PRIMARY keeps its place, and EVERY genuine settlement failure is kept with
    // it: a failure of one step never skips the cleanup of the next.
    const failures: unknown[] = [];
    // The listener. A close of a server that never listened says ERR_SERVER_NOT_RUNNING:
    // that is the ACTUAL state, not a broken resource, and it is classified as such.
    const listened = facts.origin !== "";
    try {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((closeError) => { if (closeError) rejectClose(closeError); else resolveClose(); });
      });
      // The observation may be where a case injects a genuine failure: the resource
      // IS closed by now, and the failure is thrown after that.
      options?.lifecycle?.("serving_cleanup:listener");
    } catch (failure) {
      const code = (failure as { code?: unknown }).code;
      if (!(listened && code === "ERR_SERVER_NOT_RUNNING")) failures.push(failure);
    }
    // The folder serving: its real probes and its real requests.
    let settlement: OpenFilmFolderSettlement | undefined;
    try {
      settlement = await folder.drain();
      options?.lifecycle?.("serving_cleanup:folder");
    } catch (failure) { failures.push(failure); }
    // An unfinished settlement is NOT a clean close, and it is reported as such.
    if (settlement !== undefined && settlement.open > 0)
      failures.push(new Error(`the page origin still has ${settlement.open} unsettled items`));
    // The observation must never REPLACE the primary: it only says that the factory
    // gave up.
    try { options?.lifecycle?.("serving_aborted"); } catch { /* the primary is the primary */ }
    throw withCleanupFailures(error, failures);
  }
  const owner: OpenFilmServingOwner = Object.freeze({
    origin: facts.origin,
    root: facts.canonical_root,
    generation: facts.generation,
    beginDraw: (): void => {
      // A close that is already under way refuses a NEW draw: the accepted ones are
      // what this serving waits for.
      if (facts.closing) throw new Error("the OpenFilm serving owner is closing");
      // The admission of this serving is opened again for THIS draw. The previous
      // draw froze it when its execution domain died, and a frozen serving opens no
      // file and starts no probe: the page of this draw has to be served.
      facts.folder.openAdmission();
      if (facts.accepted === 0) {
        // The settlement of the accepted draws: it is resolved when the last one ends.
        facts.drawsSettled = new Promise<void>(resolve => { facts.resolveDraws = () => { resolve(); }; });
      }
      facts.accepted += 1;
    },
    endDraw: (): void => {
      facts.accepted -= 1;
      if (facts.accepted === 0) facts.resolveDraws();
    },
    close: async (): Promise<void> => {
      // The settlement is SHARED: a second close waits for the very same one.
      if (facts.closePromise !== undefined) return facts.closePromise;
      const settlement = (async (): Promise<void> => {
        // No NEW draw is admitted from here on.
        facts.closing = true;
        // The admission of this serving is sealed FOR EVER: no new request opens a
        // file, no new probe is started and no new stream is created. The listener
        // stays up until what was already accepted is really drained.
        facts.folder.freezeAdmission();
        // Every accepted draw really settles first - including the page, the iframe
        // and the media requests it still has to make. The listener is NOT stopped
        // before that: an accepted draw must never lose its origin.
        if (facts.accepted > 0) await facts.drawsSettled;
        // Then the HTTP requests and the real media probes this owner really started,
        // and the listener - EACH of them attempted on its own, so a failure of one
        // never skips the next.
        const failures: unknown[] = [];
        let drained: OpenFilmFolderSettlement | undefined;
        try { drained = await folder.drain(); }
        catch (failure) { failures.push(failure); }
        try {
          await new Promise<void>((resolveClose, rejectClose) => {
            server.close((closeError) => { if (closeError) rejectClose(closeError); else resolveClose(); });
          });
          server.closeIdleConnections();
          // The observation may be where a case injects a genuine failure: the
          // resource IS closed by now.
          options?.lifecycle?.("serving_cleanup:listener");
        } catch (failure) { failures.push(failure); }
        try { options?.lifecycle?.("serving_cleanup:folder"); }
        catch (failure) { failures.push(failure); }
        facts.closed = true;
        // An unfinished settlement is NOT a clean close.
        if (drained !== undefined && drained.open > 0)
          failures.push(new Error(`the page origin still has ${drained.open} unsettled items`));
        if (failures.length > 0)
          throw withCleanupFailures(new Error("the serving owner could not release everything"), failures);
      })();
      facts.closePromise = settlement;
      return settlement;
    },
  });
  facts.owner = owner;
  issuedServings.set(owner, facts);
  return owner;
}

/**
 * The private bridge of one serving owner and one issued producer.
 *
 * It is the ONLY thing that may draw: the root and the origin are the SERVING's own
 * facts and the producer is the one this module issued, so a caller can hand over
 * neither a base nor a producer of its own. The bridge owns the admission of the
 * draw: the serving counts it, and the close of the serving waits for it.
 */
export function openFilmServingBridge(owner: unknown, producer: unknown): OpenFilmServingBridge | null {
  if (owner === null || typeof owner !== "object") return null;
  if (producer === null || typeof producer !== "object") return null;
  const facts = issuedServings.get(owner);
  if (facts === undefined) return null;
  if (!issuedCacheProducers.has(producer)) return null;
  // The producer of this serving is the one the bridge may use.
  if (facts.producer !== producer) return null;
  const issued = producer as OpenFilmCacheProducerOwner;
  /**
   * The responsibility of the draw THIS bridge is drawing for.
   *
   * It is the responsibility itself and NOT a lookup by the root: two draws of
   * the same root may not overlap, but the one that is queued behind the other
   * is registered first, and a lookup by the root would find the wrong one.
   */
  /**
   * EVERY draw of this bridge that is not settled yet, by its issued handle.
   *
   * It is a MAP and not one pointer: a bridge that holds a production which is
   * stuck and starts another one must not let the second one hide the first.
   * The handle of a draw is the one its supervisor issued, and only that
   * handle may act on that draw.
   */
  const unsettled = new Map<unknown, ProductionResponsibility>();
  /** The state of ONE production of this bridge. */
  const viewOf = (current: ProductionResponsibility): OpenFilmCleanupView => {
    if (current.handle === null || current.supervisor === null) {
      return Object.freeze({
        known: false, handle: null, phase: "none", cleanup_required: false,
        settled: false, latched: null, parent_phase: "none", parent_drained: false,
      });
    }
    const inspection = current.supervisor.inspectCleanup(current.handle);
    return Object.freeze({
      known: true,
      handle: current.handle,
      phase: inspection.phase ?? "unknown",
      cleanup_required: inspection.cleanup_required,
      settled: inspection.settled,
      latched: inspection.latched_outcome,
      parent_phase: current.phase,
      parent_drained: current.parentDrained,
    });
  };
  /** The state of EVERY production of this bridge that is not settled yet. */
  const inspect = (): readonly OpenFilmCleanupView[] =>
    Object.freeze([...unsettled.values()].map(viewOf));
  return Object.freeze({
    inspectCleanup: inspect,
    reconcileCleanup: async (handle: unknown): Promise<OpenFilmCleanupView> => {
      const current = unsettled.get(handle);
      if (current === undefined || current.handle === null || current.supervisor === null) {
        // A handle of another bridge, a copy of one and a JSON object are all
        // refused here.
        throw new Error("The cleanup handle is not one this bridge issued");
      }
      await current.supervisor.reconcileCleanup(current.handle);
      const view = viewOf(current);
      if (current.phase === "settled") unsettled.delete(current.handle);
      return view;
    },
    draw: async (request: { readonly rel: string; readonly ms: number; readonly width: number; readonly overrides: unknown[] | null }): Promise<OpenFilmDrawResult> => {
      facts.owner.beginDraw();
      let picture: Buffer | undefined;
      let primary: unknown;
      // The upstream's own call, with the origin and the root of THIS serving.
      // It happens in a worker of its own, and it settles only when the whole
      // process domain of that worker really disappeared.
      //
      // The draw is called SYNCHRONOUSLY and the responsibility of it is
      // registered before its first await: the responsibility that is registered
      // last is therefore the one of THIS draw.
      const started = issued.pageFrame({
        root: facts.canonical_root, base: facts.origin, rel: request.rel,
        ms: request.ms, width: request.width, overrides: request.overrides,
      });
      const current = lastProductionResponsibility(issued) ?? null;
      // The responsibility of THIS draw is registered by its own issued handle:
      // a second draw of this bridge does not replace it, and a reconcile of the
      // first one still finds the first one.
      if (current !== null && current.handle !== null) unsettled.set(current.handle, current);
      // This bridge owns the parent phase of this draw: it is the one that drains
      // the parent afterwards, and the scope of a direct draw covers that drain.
      if (current !== null) current.bridgeOwnsParent = true;
      try {
        picture = await started;
      } catch (error) { primary = error; }
      // The execution domain of the draw is gone - or the draw failed. The
      // admission of this serving is frozen NOW, synchronously, and the resources
      // that were already accepted are really drained: the source streams that are
      // still open, the requests that are still open and the media probes that are
      // still running.
      //
      // The listener stays up while that happens: a request that was accepted
      // keeps its origin. And the drain is NOT a close of this serving: a close
      // that waited for the accepted draws would wait for itself.
      facts.folder.freezeAdmission();
      let drainFailure: unknown;
      try {
        await facts.folder.drain();
        if (current !== null) {
          current.parentDrained = true;
          // The PARENT DRAIN phase really ended: its lease is settled here, and
          // only here.
          current.parentLease?.settle();
        }
      }
      catch (error) { drainFailure = error; }
      // The scope of a direct draw is given back HERE: after the drain, and not
      // before it. The responsibility of the draw is only settled now too, so
      // that a close of the producer waits for the drain as well.
      if (current !== null) {
        releaseProductionScope(current);
        current.phase = "settled";
        current.settleOnce();
        if (current.handle !== null) unsettled.delete(current.handle);
        pruneProductionResponsibilities(issued);
      }
      // The failures of the sources are KEPT, and they are reported. A source
      // that errored is not a source that closed, and the reason may not be
      // swallowed: the party above has to see it, and the production it belongs
      // to has to fail with it.
      const sourceFailures = facts.folder.failures();
      // The draw is settled whether it drew a picture or not.
      facts.owner.endDraw();
      if (drainFailure === undefined && sourceFailures.length > 0) {
        drainFailure = new Error("A source of the page origin did not end cleanly");
        try {
          Object.defineProperty(drainFailure, "cleanup_failures",
            { value: [...sourceFailures], enumerable: false, configurable: true });
        } catch { /* a frozen failure keeps the reason in the ledger of the serving */ }
      }
      if (primary !== undefined) {
        if (drainFailure !== undefined) {
          // The primary keeps its place; the failure of the drain is carried with it.
          try {
            Object.defineProperty(primary, "cleanup_failures",
              { value: [drainFailure], enumerable: false, configurable: true });
          } catch { /* a frozen primary keeps the failure in the ledger of the drain */ }
        }
        throw primary;
      }
      if (drainFailure !== undefined) throw drainFailure;
      if (picture === undefined) throw new Error("The cache producer returned no picture");
      return Object.freeze({
        picture,
        parent_drained: current === null ? false : current.parentDrained,
        handle: current === null ? null : current.handle,
      });
    },
  });
}

