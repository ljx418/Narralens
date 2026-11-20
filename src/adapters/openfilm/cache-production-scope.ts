import { statSync, realpathSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";

/**
 * The Host's ONE scheduler for the native cache production scopes.
 *
 * A production scope is the whole window of ONE cache production: from before the
 * PRE capture of the working copy, through the real worker draw, the drain of the
 * parent's own resources, the POST capture, the release of the two retained trees and
 * the last identity gate, until the witness is activated or refused.
 *
 * The scope is NOT the draw. The draw is one step inside it. Two different frames of
 * the SAME root share the film's duration and the poster, so a second production of
 * the same root may not write anything while the first one is still in its POST or in
 * its final activation - and that is why the lock is held over the whole window and
 * not over the worker alone.
 *
 * The lock is on the PHYSICAL root, not on its name: the index is the device and the
 * inode of the directory, so two aliases of one directory - a symlink and the path it
 * points at, or the same directory reached through two different mount points - share
 * ONE lock and can never produce into it at the same time. The canonical path is
 * verified at the same time, because the index alone says which directory it is and
 * not that it is still the one the caller named.
 *
 * The scheduler is ONE per Host process. A production that arrives without an
 * ambient scope - a direct call of the factory, with no workspace around it - gets a
 * scope of its own from this same scheduler, so there is never a second queue and
 * never a way around the capacity.
 */

/** The bounds of the scheduler. They are a resource boundary, not a budget of calls. */
export const CACHE_PRODUCTION_LIMITS = Object.freeze({
  /** The complete production scopes that may be alive at the same time. */
  maxActiveScopes: 2,
  /** The reservations that may WAIT for a scope, over every root together. */
  maxQueuedReservations: 32,
  /** The reservations that may WAIT for ONE physical root. */
  maxQueuedPerRoot: 8,
  /** How long a reservation may wait before it is refused. */
  queueWaitMs: 30_000,
});

/** The physical identity of one production root. */
export interface CacheProductionRootFacts {
  /** The one real path of the root. */
  readonly canonical_root: string;
  /** The device the root lives on, as the platform reports it. */
  readonly dev: string;
  /** The inode of the root, as the platform reports it. */
  readonly ino: string;
}

/**
 * The scope of one production.
 *
 * It is an OPAQUE handle: the facts behind it live in this module's private table,
 * and a copy of it, a JSON object and a scope of another Host are not in that table.
 */
export interface CacheProductionScope {
  /** The physical root this scope holds. */
  readonly root: CacheProductionRootFacts;
  /** This scheduler's own number of the scope. It means nothing outside this module. */
  readonly generation: number;
}

/** Why a reservation was refused. Every refusal happens BEFORE any production work. */
export type CacheProductionRefusal =
  | "CACHE_PRODUCTION_QUEUE_FULL"
  | "CACHE_PRODUCTION_ROOT_QUEUE_FULL"
  | "CACHE_PRODUCTION_QUEUE_TIMEOUT"
  | "CACHE_PRODUCTION_CANCELLED";

/** The failure of an admission that was refused. */
export class CacheProductionAdmissionError extends Error {
  readonly code: CacheProductionRefusal;
  constructor(code: CacheProductionRefusal, message: string) {
    super(message);
    this.name = "CacheProductionAdmissionError";
    this.code = code;
  }
}

/** What this module knows about one scope. Only this module writes here. */
interface ScopeFacts {
  readonly scope: CacheProductionScope;
  readonly key: string;
  /** The scope is still held: it may not be used and it may not be released twice. */
  active: boolean;
  /** The production ended in a state that could not be proven: the scope is NOT released. */
  cleanup_required: boolean;
  /** Which phases this scope's owner is responsible for. */
  readonly mode: CacheProductionMode;
  /**
   * The owner of this scope: the ONE object that may open a phase lease of it.
   *
   * It is an identity and not a name: a copy of it, a JSON object and the owner
   * of another scope are all refused.
   */
  readonly owner: object;
  /** The phases of this scope that were leased, and what really happened to them. */
  readonly phases: Map<CacheProductionPhaseKind, PhaseFacts>;
}

/**
 * Which phases the owner of a scope is responsible for.
 *
 * `workspace` owns the whole production: the execution of the draw, the drain of
 * the parent's own resources and the release of the two retained trees.
 * `direct` owns the execution AND the drain of the parent's own resources: the
 * bridge drains the parent AFTER the draw returned, and a scope that was given
 * back before that drain let the next production of the same root walk over
 * resources that were still there.
 */
export type CacheProductionMode = "workspace" | "direct";

/** The phases a completion has to carry, by the mode of the scope. */
const REQUIRED_PHASES: Readonly<Record<CacheProductionMode, readonly CacheProductionPhaseKind[]>> = {
  workspace: ["execution", "parent_drain", "tree_release"],
  direct: ["execution", "parent_drain"],
};

/** The phase of a production a receipt may speak about. */
export type CacheProductionPhaseKind = "execution" | "parent_drain" | "tree_release";

/**
 * The receipt of ONE phase of a production.
 *
 * It is a COPY of what really happened, and it is minted by THIS module: a
 * caller may not hand one over. A phase the owner does NOT have is declared as
 * `not_owned`: it may not be skipped by a caller that says `true`, and it may
 * not be pretended to have happened.
 */
export interface CacheProductionPhaseReceipt {
  readonly kind: CacheProductionPhaseKind | "not_owned";
  /** Whether the phase really ended. */
  readonly settled: boolean;
  /**
   * Whether the phase was ever OWNED.
   *
   * A phase that was never started - because the production refused before it
   * took a single resource of it - really ended as well: it did NOT start. The
   * two are separate facts, and a receipt that says "settled" without saying
   * whether the phase was owned cannot tell a refused production from a
   * finished one.
   */
  readonly owned: boolean;
  /** A digest of what really happened, when there was something. */
  readonly digest: string | null;
}

/**
 * The LEASE of ONE phase of one production.
 *
 * It is the private capability of a phase: the owner of the scope opens it, and
 * the code that really ends the phase settles it. It is minted here and it
 * cannot be forged - a copy of it, a JSON object and a number are not leases.
 */
export interface CacheProductionPhaseLease {
  /** The phase this lease is about. */
  readonly kind: CacheProductionPhaseKind;
  /** Whether the phase really ended. */
  readonly settled: boolean;
  /**
   * End the phase.
   *
   * It settles ONCE: a second call does nothing and says so. The phase that
   * was not really ended may not be settled by anybody.
   */
  settle(digest?: string | null): boolean;
  /**
   * Record that the phase was NEVER STARTED.
   *
   * A production that refused before it took a single resource of this phase
   * did not start it: the phase is over, and the root may be given back. It is
   * NOT the same as a phase that was taken and whose end is unknown - that one
   * is not settled at all, and the root stays held.
   */
  notOwned(reason?: string | null): boolean;
}

/** What this module knows about one leased phase. */
interface PhaseFacts {
  readonly scope: CacheProductionScope;
  readonly kind: CacheProductionPhaseKind;
  readonly owner: object;
  settled: boolean;
  /** Whether the phase was ever owned by the production that holds the lease. */
  owned: boolean;
  digest: string | null;
  /** Why the phase was never started, when that is what happened. */
  reason: string | null;
}

/**
 * The COMPLETION of one production.
 *
 * It is minted by the owner of the scope - inside that owner's own closure - and
 * it is the only thing that may clear the held marker of a scope whose cleanup
 * could not be proven. It binds the scope it belongs to, the generation and the
 * root of that scope, the receipts of the phases and the original outcome.
 *
 * It is NOT a diagnostic and it is NOT a bare `clear`: it cannot be minted by the
 * supervisor, it cannot be minted by a caller that hands over a boolean, and it
 * may not be minted while a phase that the owner owns is unsettled.
 */
export interface CacheProductionCompletion {
  readonly scope: CacheProductionScope;
  readonly generation: number;
  readonly root: CacheProductionRootFacts;
  readonly outcome: "settled" | "failed";
  readonly receipts: readonly CacheProductionPhaseReceipt[];
  /** The owner of the scope this completion belongs to. */
  readonly owner: object;
}

/** The completions this module minted. Only they may clear a held scope. */
const completions = new WeakMap<object, CacheProductionCompletion>();
/** The completions that were already consumed. A completion settles ONCE. */
const spentCompletions = new WeakSet<object>();
/** The leases this module issued. A copy of a lease is not a lease. */
const phaseLeases = new WeakMap<object, PhaseFacts>();

/** The private facts of every scope this module issued. */
const scopeFacts = new WeakMap<object, ScopeFacts>();

/** One waiting reservation. */
interface Reservation {
  readonly key: string;
  readonly root: CacheProductionRootFacts;
  /** Which phases the owner of this reservation is responsible for. */
  readonly mode: CacheProductionMode;
  /** The owner of the scope this reservation will hold. */
  readonly owner: object;
  readonly enqueued_at: number;
  readonly resolve: (scope: CacheProductionScope) => void;
  readonly reject: (error: unknown) => void;
  /** The timer that refuses the reservation when its own deadline passes. */
  timer: NodeJS.Timeout | undefined;
  /** The reservation was settled: it may not be granted or refused again. */
  settled: boolean;
  /** The caller cancelled the reservation before it was granted. */
  cancelled: boolean;
}

/**
 * The owner of a scope that nobody claimed.
 *
 * It is a private object: a caller that did not name an owner of its own may
 * never open a phase lease of that scope, and a scope of this kind that was
 * ever held stays held. That is the conservative answer: a scope whose end may
 * not be proven keeps its root.
 */
const ANONYMOUS_SCOPE_OWNER = Object.freeze({ kind: "narralens.cache-production.anonymous-owner" });

/** The scope that is alive on each physical root. One root, one production at a time. */
const activeByRoot = new Map<string, CacheProductionScope>();
/** The waiting reservations, in the order they arrived. */
const waiting: Reservation[] = [];
/** How many scopes are alive, over every root together. */
let activeCount = 0;
/** This scheduler's own counter. It means nothing outside this module. */
let scopeGeneration = 0;

/**
 * The scope of the production that is running RIGHT NOW, if there is one.
 *
 * It travels in an async context, so an inner step - the bridge, the supervisor -
 * finds the scope of the production it belongs to without asking for it and without
 * taking a second one. It is a CONVENIENCE and never an authority: every use of the
 * scope re-checks that it is alive and that it is the scope of that root.
 */
const scopeContext = new AsyncLocalStorage<CacheProductionScope>();

/**
 * The physical identity of a root, verified.
 *
 * The device and the inode are the INDEX: two names of one directory share them. The
 * canonical path is verified at the same time, because the index alone cannot say
 * that the directory is still the one the caller named.
 */
export function cacheProductionRootFacts(root: string): CacheProductionRootFacts {
  const canonical = realpathSync(resolve(root));
  const info = statSync(canonical, { bigint: true });
  if (!info.isDirectory()) throw new Error("The cache production root is not a directory");
  return Object.freeze({
    canonical_root: canonical,
    dev: info.dev.toString(),
    ino: info.ino.toString(),
  });
}

/** The index of one physical root: its device and its inode. */
const rootKey = (facts: CacheProductionRootFacts): string => `${facts.dev}:${facts.ino}`;

/**
 * Whether this scope is still the live scope of its root.
 *
 * It is the check every use of a scope makes: a scope that was released, or a scope
 * of a root that was replaced, is not the scope any more.
 */
export function isLiveCacheProductionScope(scope: unknown): scope is CacheProductionScope {
  if (scope === null || typeof scope !== "object") return false;
  const facts = scopeFacts.get(scope as object);
  if (facts === undefined) return false;
  if (!facts.active) return false;
  return activeByRoot.get(facts.key) === scope;
}

/**
 * Whether this scope is the live scope of ONE root.
 *
 * The comparison is on the PHYSICAL root - the device and the inode - and not on
 * the name: two names of one directory are one root, and a scope that covers one
 * of them covers the other. A scope of another root is not a scope of this one.
 */
export function cacheProductionScopeCovers(scope: unknown, root: string): boolean {
  if (!isLiveCacheProductionScope(scope)) return false;
  let facts: CacheProductionRootFacts;
  try { facts = cacheProductionRootFacts(root); }
  catch { return false; }
  return rootKey(facts) === rootKey(scope.root);
}

/**
 * The scope of the production that is running right now, or null.
 *
 * It is what an inner step reads to find the scope of the production it belongs to.
 */
export function currentCacheProductionScope(): CacheProductionScope | null {
  return scopeContext.getStore() ?? null;
}

/**
 * Run a piece of work inside a scope.
 *
 * The scope is passed IN, not created: a production that already holds one must not
 * take a second one, and the same physical root may not be locked twice.
 */
export function runWithCacheProductionScope<T>(scope: CacheProductionScope, work: () => T): T {
  if (!isLiveCacheProductionScope(scope)) {
    throw new CacheProductionAdmissionError("CACHE_PRODUCTION_CANCELLED",
      "The cache production scope is not the live scope of its root");
  }
  return scopeContext.run(scope, work);
}

/**
 * Refuse a reservation that waited too long, or that was cancelled.
 *
 * The reservation is removed from the queue FIRST, so a refused reservation never
 * occupies a place and never starts a production.
 */
function refuseReservation(reservation: Reservation, code: CacheProductionRefusal, message: string): void {
  if (reservation.settled) return;
  reservation.settled = true;
  if (reservation.timer !== undefined) clearTimeout(reservation.timer);
  const index = waiting.indexOf(reservation);
  if (index >= 0) waiting.splice(index, 1);
  reservation.reject(new CacheProductionAdmissionError(code, message));
}

/**
 * Grant the waiting reservations that may run now.
 *
 * A reservation may run when a scope is free AND its own root is free. The queue is
 * scanned in order, so a reservation that waits for a busy root does not hold back a
 * reservation of another root that could run right now - two different roots really
 * do run at the same time.
 */
function grantWaiting(): void {
  for (let index = 0; index < waiting.length && activeCount < CACHE_PRODUCTION_LIMITS.maxActiveScopes;) {
    const reservation = waiting[index]!;
    if (reservation.settled || reservation.cancelled) { waiting.splice(index, 1); continue; }
    if (activeByRoot.has(reservation.key)) { index += 1; continue; }
    waiting.splice(index, 1);
    if (reservation.timer !== undefined) clearTimeout(reservation.timer);
    reservation.settled = true;
    activeCount += 1;
    const scope = Object.freeze({
      root: reservation.root,
      generation: (scopeGeneration += 1),
    }) as CacheProductionScope;
    scopeFacts.set(scope, {
      scope, key: reservation.key, active: true, cleanup_required: false, mode: reservation.mode,
      owner: reservation.owner, phases: new Map(),
    });
    activeByRoot.set(reservation.key, scope);
    reservation.resolve(scope);
  }
}

/**
 * Acquire the production scope of one root.
 *
 * The refusal is decided BEFORE any production work: a reservation that cannot be
 * admitted is refused here, so no source byte is read, no pipe is allocated and no
 * child is born.
 */
export async function acquireCacheProductionScope(
  root: string,
  options?: {
    readonly signal?: AbortSignal;
    readonly mode?: CacheProductionMode;
    /**
     * The owner of the scope.
     *
     * It is the ONE object that may open a phase lease of the scope, and the one
     * that may mint the completion of its production. It is an identity and not
     * a name.
     */
    readonly owner?: object;
  },
): Promise<CacheProductionScope> {
  const facts = cacheProductionRootFacts(root);
  const key = rootKey(facts);
  const mode: CacheProductionMode = options?.mode === "direct" ? "direct" : "workspace";
  const owner = options?.owner !== undefined && options.owner !== null
    ? options.owner
    : ANONYMOUS_SCOPE_OWNER;
  // A cancelled caller is refused before it takes a place in the queue.
  if (options?.signal?.aborted === true) {
    throw new CacheProductionAdmissionError("CACHE_PRODUCTION_CANCELLED",
      "The cache production was cancelled before it was admitted");
  }
  // This root already has a full queue of its own. The narrower refusal is decided
  // first: a reservation that waits behind ONE root is told that this root is full,
  // and not that the whole queue is.
  const waitingForRoot = waiting.filter(reservation => reservation.key === key).length;
  if (waitingForRoot >= CACHE_PRODUCTION_LIMITS.maxQueuedPerRoot) {
    throw new CacheProductionAdmissionError("CACHE_PRODUCTION_ROOT_QUEUE_FULL",
      "The cache production queue of this root is full");
  }
  // The whole queue is full: there is no place to wait.
  if (waiting.length >= CACHE_PRODUCTION_LIMITS.maxQueuedReservations) {
    throw new CacheProductionAdmissionError("CACHE_PRODUCTION_QUEUE_FULL",
      "The cache production queue is full");
  }
  // The root is free and there is a free scope: the reservation is granted at once.
  if (!activeByRoot.has(key) && activeCount < CACHE_PRODUCTION_LIMITS.maxActiveScopes) {
    activeCount += 1;
    const scope = Object.freeze({ root: facts, generation: (scopeGeneration += 1) }) as CacheProductionScope;
    scopeFacts.set(scope, {
      scope, key, active: true, cleanup_required: false, mode, owner, phases: new Map(),
    });
    activeByRoot.set(key, scope);
    return scope;
  }
  // Otherwise the reservation waits, with its own deadline.
  return await new Promise<CacheProductionScope>((resolveReservation, rejectReservation) => {
    const reservation: Reservation = {
      key, root: facts, mode, owner, enqueued_at: Date.now(),
      resolve: resolveReservation, reject: rejectReservation,
      timer: undefined, settled: false, cancelled: false,
    };
    const onAbort = (): void => {
      reservation.cancelled = true;
      refuseReservation(reservation, "CACHE_PRODUCTION_CANCELLED",
        "The cache production was cancelled while it was waiting");
    };
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      refuseReservation(reservation, "CACHE_PRODUCTION_QUEUE_TIMEOUT",
        "The cache production waited longer than its queue deadline");
    }, CACHE_PRODUCTION_LIMITS.queueWaitMs);
    timer.unref?.();
    reservation.timer = timer;
    waiting.push(reservation);
    // A cancellation that arrived between the check above and the listener: the
    // reservation must not sit in the queue for a caller that is already gone.
    if (options?.signal?.aborted === true) onAbort();
  });
}

/**
 * Open the LEASE of one phase of one production.
 *
 * The lease is the private capability of a phase. It is issued HERE, to the ONE
 * owner of the scope, and it is the only thing that may say that a phase ended.
 *
 * A scope of another owner, a scope that is not alive, a phase that this scope's
 * mode does not have, and a phase that was already leased are all refused: there
 * is exactly one lease per phase, and the phase that was not really ended may
 * not be settled by anybody.
 */
export function openCacheProductionPhaseLease(
  scope: CacheProductionScope,
  kind: CacheProductionPhaseKind,
  owner: unknown,
): CacheProductionPhaseLease | null {
  if (scope === null || typeof scope !== "object") return null;
  if (owner === null || typeof owner !== "object") return null;
  const facts = scopeFacts.get(scope as object);
  if (facts === undefined) return null;
  if (!facts.active) return null;
  if (facts.owner !== owner) return null;
  if (!REQUIRED_PHASES[facts.mode].includes(kind)) return null;
  if (facts.phases.has(kind)) return null;
  const phase: PhaseFacts = {
    scope, kind, owner: owner as object, settled: false, owned: false, digest: null, reason: null,
  };
  facts.phases.set(kind, phase);
  const lease: CacheProductionPhaseLease = {
    kind,
    get settled(): boolean { return phase.settled; },
    settle: (digest?: string | null): boolean => {
      if (phase.settled) return false;
      phase.settled = true;
      phase.owned = true;
      phase.digest = typeof digest === "string" ? digest.slice(0, 256) : null;
      return true;
    },
    notOwned: (reason?: string | null): boolean => {
      if (phase.settled) return false;
      phase.settled = true;
      phase.owned = false;
      phase.reason = typeof reason === "string" ? reason.slice(0, 256) : null;
      return true;
    },
  };
  phaseLeases.set(lease as unknown as object, phase);
  return lease;
}

/**
 * Mint the completion of one production.
 *
 * It is minted by the OWNER of the scope, inside that owner's own closure, and
 * only when every phase that this owner is responsible for really ended. The
 * receipts are NOT taken from the caller: they are read from this module's own
 * record of the phases, and a phase that was not really ended makes the
 * completion impossible.
 *
 * The completion is the ONLY thing that may clear a scope that was held because
 * its cleanup could not be proven. It is not a diagnostic and it is not a bare
 * `clear`: a caller that hands over a boolean may not mint one.
 */
export function mintCacheProductionCompletion(
  scope: CacheProductionScope,
  outcome: "settled" | "failed",
): CacheProductionCompletion | null {
  if (scope === null || typeof scope !== "object") return null;
  const facts = scopeFacts.get(scope as object);
  if (facts === undefined) return null;
  if (!facts.active) return null;
  const required = REQUIRED_PHASES[facts.mode];
  const receipts: CacheProductionPhaseReceipt[] = [];
  for (const kind of required) {
    const phase = facts.phases.get(kind);
    if (phase === undefined || !phase.settled) return null;
    receipts.push({ kind, settled: true, owned: phase.owned, digest: phase.digest });
  }
  const completion: CacheProductionCompletion = Object.freeze({
    scope,
    generation: scope.generation,
    root: scope.root,
    outcome,
    receipts: Object.freeze(receipts),
    owner: facts.owner,
  });
  completions.set(completion as unknown as object, completion);
  return completion;
}

/**
 * Consume the completion of one production.
 *
 * It clears the HELD marker of the very scope the completion was minted for - and
 * nothing else. It is SYNCHRONOUS on purpose: the caller releases the scope in
 * the very same breath, with no await and no callback between the two.
 *
 * A completion settles ONCE: a second consumption is refused. A completion of
 * another scope, of another owner, of another generation or of another root is
 * refused, and a completion of a scope whose phase did not really end is
 * refused.
 */
export function completeCacheProductionScope(
  scope: CacheProductionScope,
  completion: CacheProductionCompletion | null,
): boolean {
  if (scope === null || typeof scope !== "object") return false;
  if (completion === null || completion === undefined) return false;
  const known = completions.get(completion as unknown as object);
  if (known === undefined) return false;
  if (spentCompletions.has(completion as unknown as object)) return false;
  if (known.scope !== scope) return false;
  const facts = scopeFacts.get(scope as object);
  if (facts === undefined) return false;
  if (known.generation !== scope.generation) return false;
  if (rootKey(known.root) !== rootKey(scope.root)) return false;
  if (known.owner !== facts.owner) return false;
  for (const kind of REQUIRED_PHASES[facts.mode]) {
    const phase = facts.phases.get(kind);
    if (phase === undefined || !phase.settled) return false;
  }
  spentCompletions.add(completion as unknown as object);
  facts.cleanup_required = false;
  return true;
}

/**
 * Release one production scope.
 *
 * The release happens ONCE, and only when the production really settled. A scope
 * whose production ended in CLEANUP_REQUIRED is NOT released: the root stays held,
 * so the next production of that root does not start while the first one may still
 * have something alive in it. The held marker is cleared by the COMPLETION of the
 * production - not by this function, and not by a caller.
 */
export function releaseCacheProductionScope(scope: CacheProductionScope): void {
  if (scope === null || typeof scope !== "object") return;
  const facts = scopeFacts.get(scope as object);
  if (facts === undefined) return;
  if (!facts.active) return;
  if (facts.cleanup_required) return;
  facts.active = false;
  if (activeByRoot.get(facts.key) === scope) activeByRoot.delete(facts.key);
  activeCount -= 1;
  grantWaiting();
}

/**
 * Keep the scope of a production that could not be proven to have ended.
 *
 * The scope is NOT released, and the root it holds is not given to the next
 * production: an unknown production may still have a browser, a child or a file
 * descriptor alive in that root.
 */
export function markCacheProductionCleanupRequired(scope: CacheProductionScope): void {
  if (scope === null || typeof scope !== "object") return;
  const facts = scopeFacts.get(scope as object);
  if (facts === undefined) return;
  facts.cleanup_required = true;
}

/** Whether the scope of a production is held because it could not be proven to have ended. */
export function isCacheProductionCleanupRequired(scope: CacheProductionScope): boolean {
  if (scope === null || typeof scope !== "object") return false;
  return scopeFacts.get(scope as object)?.cleanup_required ?? false;
}

/**
 * The state of ONE physical root, as the reader's admission and delivery gates see it.
 *
 * `idle` is the only state in which a reader may deliver facts about that root: a
 * root that is being produced into, or whose production could not be proven to have
 * ended, may still be changing under the reader's feet.
 */
export type CacheProductionRootState = "idle" | "producing" | "cleanup_required";

/**
 * The state of one root, by its PHYSICAL identity.
 *
 * A root that is not known at all is idle: the scheduler knows about the roots that
 * are being produced into, not about every directory of the machine.
 */
export function cacheProductionRootState(root: string): CacheProductionRootState {
  let facts: CacheProductionRootFacts;
  try { facts = cacheProductionRootFacts(root); }
  catch { return "idle"; }
  const key = rootKey(facts);
  const scope = activeByRoot.get(key);
  if (scope === undefined) return "idle";
  const known = scopeFacts.get(scope as object);
  if (known === undefined) return "idle";
  return known.cleanup_required ? "cleanup_required" : "producing";
}

/** The state of the scheduler, as the tests read it. It grants nothing. */
export interface CacheProductionSchedulerState {
  readonly active: number;
  readonly queued: number;
  readonly queuedPerRoot: readonly { readonly dev: string; readonly ino: string; readonly queued: number }[];
  readonly roots: readonly { readonly dev: string; readonly ino: string; readonly cleanup_required: boolean }[];
}

/** The state of the scheduler, as a read-only copy. */
export function cacheProductionSchedulerState(): CacheProductionSchedulerState {
  const perRoot = new Map<string, number>();
  for (const reservation of waiting) perRoot.set(reservation.key, (perRoot.get(reservation.key) ?? 0) + 1);
  return Object.freeze({
    active: activeCount,
    queued: waiting.length,
    queuedPerRoot: Object.freeze([...perRoot.entries()].map(([key, queued]) => Object.freeze({
      dev: key.slice(0, key.indexOf(":")),
      ino: key.slice(key.indexOf(":") + 1),
      queued,
    }))),
    roots: Object.freeze([...activeByRoot.entries()].map(([key, scope]) => Object.freeze({
      dev: key.slice(0, key.indexOf(":")),
      ino: key.slice(key.indexOf(":") + 1),
      cleanup_required: scopeFacts.get(scope as object)?.cleanup_required ?? false,
    }))),
  });
}

/**
 * Forget everything the scheduler knows.
 *
 * It exists for the tests of this module alone: a case that needs a scheduler of its
 * own starts from a clean one. It gives every scope back - even a scope that was
 * held because its cleanup could not be proven - so a test cannot leak a held root
 * into the next case.
 *
 * NO PRODUCTION CODE CALLS THIS. It is the only way to release a scope that a
 * CLEANUP_REQUIRED production holds, and it is a test affordance, never a way for
 * the Host to give a root back while something may still be alive in it.
 */
export function resetCacheProductionSchedulerForTest(): void {
  for (const reservation of [...waiting]) {
    refuseReservation(reservation, "CACHE_PRODUCTION_CANCELLED",
      "The cache production scheduler was reset");
  }
  for (const [key, scope] of [...activeByRoot.entries()]) {
    const facts = scopeFacts.get(scope as object);
    if (facts !== undefined) facts.active = false;
    activeByRoot.delete(key);
  }
  activeCount = 0;
}
