import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CACHE_PRODUCTION_LIMITS,
  CacheProductionAdmissionError,
  acquireCacheProductionScope,
  cacheProductionRootFacts,
  cacheProductionRootState,
  cacheProductionScopeCovers,
  cacheProductionSchedulerState,
  completeCacheProductionScope,
  currentCacheProductionScope,
  isLiveCacheProductionScope,
  markCacheProductionCleanupRequired,
  mintCacheProductionCompletion,
  openCacheProductionPhaseLease,
  releaseCacheProductionScope,
  resetCacheProductionSchedulerForTest,
  runWithCacheProductionScope,
} from "../../../src/adapters/openfilm/cache-production-scope.js";
import type { CacheProductionScope } from "../../../src/adapters/openfilm/cache-production-scope.js";
import {
  createPinnedOpenFilmCacheProducer,
  openFilmProductionResponsibilityCount,
} from "../../../src/adapters/openfilm/openfilm-upstream.js";
import { vendorRoot } from "./helpers/created-project-fixture.js";

/**
 * The scheduler of the native cache production scopes.
 *
 * These cases are about the scheduler ALONE: no child is born, no browser is
 * started and no file of a project is touched. They use real directories under the
 * temporary directory, because the identity of a root is a real device and a real
 * inode - a synthetic root would not prove that two names of one directory share
 * one lock.
 *
 * What they prove:
 *
 *  - the whole production window holds ONE scope, and the scope is not taken
 *    again by an inner step;
 *  - the lock is on the PHYSICAL root, so two names of one directory share it;
 *  - two different roots really do run at the same time;
 *  - the capacity is two scopes, the queue is thirty-two, the queue of one root is
 *    eight, and a reservation that waits too long is refused;
 *  - a refusal happens BEFORE any work, and it gives nothing back that was not
 *    taken;
 *  - a production whose cleanup could not be proven keeps its scope and its root.
 */

const temporaries: string[] = [];
const held: CacheProductionScope[] = [];
/** The owner of the scopes of these cases. It is an identity and not a name. */
const OWNER = { name: "the owner of these cases" };
/** An owner of another scope: it may not touch the scopes of OWNER. */
const OTHER_OWNER = { name: "another owner" };

afterEach(() => {
  for (const scope of held.splice(0)) releaseCacheProductionScope(scope);
  resetCacheProductionSchedulerForTest();
  for (const path of temporaries.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A real directory. */
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "narralens-cache-scope-"));
  temporaries.push(root);
  return root;
}

/** A real directory reached through a second name. */
function aliasOf(root: string): string {
  const alias = join(temporaryRoot(), "alias");
  symlinkSync(root, alias);
  return alias;
}

/** Take a scope and remember it, so the case can end it. */
async function hold(root: string, owner: object = OWNER): Promise<CacheProductionScope> {
  const scope = await acquireCacheProductionScope(root, { owner });
  held.push(scope);
  return scope;
}

/**
 * Settle every phase of a scope, as the owner of it would.
 *
 * The phases are LEASES: the owner opens them and the code that really ends a
 * phase settles it. A receipt that a caller hands over is not a receipt.
 */
function settleEveryPhase(scope: CacheProductionScope, owner: object = OWNER): void {
  for (const kind of ["execution", "parent_drain", "tree_release"] as const) {
    openCacheProductionPhaseLease(scope, kind, owner)?.settle();
  }
}

describe("the native cache production scheduler", () => {
  it("holds one scope per physical root and refuses a second one while it is alive", async () => {
    const root = temporaryRoot();
    const scope = await hold(root);
    expect(isLiveCacheProductionScope(scope)).toBe(true);
    expect(cacheProductionSchedulerState().active).toBe(1);
    // A second production of the SAME root waits: it is not refused, it waits.
    let granted = false;
    const waiting = acquireCacheProductionScope(root)
      .then((value) => { granted = true; return value; })
      .catch(() => undefined);
    await Promise.resolve();
    expect(granted).toBe(false);
    expect(cacheProductionSchedulerState().active).toBe(1);
    expect(cacheProductionSchedulerState().queued).toBe(1);
    // When the first production ends, the waiting one is granted.
    releaseCacheProductionScope(scope);
    const second = await waiting;
    expect(granted).toBe(true);
    expect(cacheProductionSchedulerState().active).toBe(1);
    if (second !== undefined) releaseCacheProductionScope(second);
  });

  it("shares one lock between two names of the same physical directory", async () => {
    const root = temporaryRoot();
    const alias = aliasOf(root);
    const facts = cacheProductionRootFacts(root);
    const aliasFacts = cacheProductionRootFacts(alias);
    expect(aliasFacts.dev).toBe(facts.dev);
    expect(aliasFacts.ino).toBe(facts.ino);
    const scope = await hold(alias);
    // The scope of the alias is the scope of the directory: the root that was named
    // is the root that is held.
    expect(cacheProductionScopeCovers(scope, root)).toBe(true);
    expect(cacheProductionScopeCovers(scope, alias)).toBe(true);
    let granted = false;
    const waiting = acquireCacheProductionScope(root)
      .then((value) => { granted = true; return value; })
      .catch(() => undefined);
    await Promise.resolve();
    expect(granted).toBe(false);
    expect(cacheProductionSchedulerState().queued).toBe(1);
    releaseCacheProductionScope(scope);
    await waiting;
  });

  it("runs two different roots at the same time and queues the third", async () => {
    const first = temporaryRoot();
    const second = temporaryRoot();
    const third = temporaryRoot();
    await hold(first);
    await hold(second);
    expect(cacheProductionSchedulerState().active).toBe(2);
    let granted = false;
    const waiting = acquireCacheProductionScope(third)
      .then((value) => { granted = true; return value; })
      .catch(() => undefined);
    await Promise.resolve();
    expect(granted).toBe(false);
    expect(cacheProductionSchedulerState().active).toBe(2);
    expect(cacheProductionSchedulerState().queued).toBe(1);
    // A root that is not being produced into is quiet, even while another root is.
    expect(cacheProductionRootState(third)).toBe("idle");
    expect(cacheProductionRootState(first)).toBe("producing");
  });

  it("refuses a reservation beyond the queue of thirty-two and beyond the queue of one root", async () => {
    await hold(temporaryRoot());
    await hold(temporaryRoot());
    const roots = [0, 1, 2, 3].map(() => temporaryRoot());
    const waiting: Promise<unknown>[] = [];
    for (const root of roots) {
      for (let index = 0; index < 8; index += 1) {
        waiting.push(acquireCacheProductionScope(root).catch(() => undefined));
      }
    }
    await Promise.resolve();
    // The queue of one root is eight: the ninth reservation of a root is refused.
    await expect(acquireCacheProductionScope(roots[0]!)).rejects.toMatchObject({
      code: "CACHE_PRODUCTION_ROOT_QUEUE_FULL",
    });
    // The whole queue is thirty-two: the next reservation is refused.
    await expect(acquireCacheProductionScope(temporaryRoot())).rejects.toMatchObject({
      code: "CACHE_PRODUCTION_QUEUE_FULL",
    });
    expect(cacheProductionSchedulerState().queued).toBe(32);
    // The refusals gave nothing back and took nothing: the queue and the capacity
    // are the ones they were.
    expect(cacheProductionSchedulerState().active).toBe(2);
    void waiting;
  });

  it("refuses a reservation that waited longer than the queue deadline", async () => {
    vi.useFakeTimers();
    try {
      await hold(temporaryRoot());
      await hold(temporaryRoot());
      const other = temporaryRoot();
      const waiting = acquireCacheProductionScope(other);
      const assertion = expect(waiting).rejects.toMatchObject({
        code: "CACHE_PRODUCTION_QUEUE_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(CACHE_PRODUCTION_LIMITS.queueWaitMs + 1);
      await assertion;
      expect(cacheProductionSchedulerState().queued).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a cancelled reservation out of the queue without starting anything", async () => {
    await hold(temporaryRoot());
    await hold(temporaryRoot());
    const other = temporaryRoot();
    const controller = new AbortController();
    const waiting = acquireCacheProductionScope(other, { signal: controller.signal });
    expect(cacheProductionSchedulerState().queued).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "CACHE_PRODUCTION_CANCELLED" });
    expect(cacheProductionSchedulerState().queued).toBe(0);
    // A cancellation that arrives before the reservation is even made is refused
    // the same way, and takes no place in the queue.
    const second = new AbortController();
    second.abort();
    await expect(acquireCacheProductionScope(other, { signal: second.signal })).rejects.toMatchObject({
      code: "CACHE_PRODUCTION_CANCELLED",
    });
    expect(cacheProductionSchedulerState().queued).toBe(0);
  });

  it("keeps the scope of a production whose cleanup could not be proven", async () => {
    const root = temporaryRoot();
    const scope = await hold(root);
    expect(cacheProductionRootState(root)).toBe("producing");
    markCacheProductionCleanupRequired(scope);
    expect(cacheProductionRootState(root)).toBe("cleanup_required");
    // The scope is NOT given back: the root it holds may still have something alive
    // in it, and the next production of that root does not start.
    releaseCacheProductionScope(scope);
    expect(cacheProductionRootState(root)).toBe("cleanup_required");
    let granted = false;
    const waiting = acquireCacheProductionScope(root)
      .then((value) => { granted = true; return value; })
      .catch(() => undefined);
    await Promise.resolve();
    expect(granted).toBe(false);
    expect(cacheProductionSchedulerState().queued).toBe(1);
  });

  it("gives the scope back through the COMPLETION of its production, and not through a bare clear", async () => {
    const root = temporaryRoot();
    const scope = await hold(root);
    markCacheProductionCleanupRequired(scope);
    expect(cacheProductionRootState(root)).toBe("cleanup_required");
    // A completion may NOT be minted while a phase of the owner has not really
    // ended: the receipts are read from this module's own record, and a caller
    // that hands over a boolean mints nothing.
    expect(mintCacheProductionCompletion(scope, "failed")).toBeNull();
    settleEveryPhase(scope);
    // A completion of ANOTHER scope may not clear this one.
    const other = await acquireCacheProductionScope(temporaryRoot(), { owner: OWNER });
    settleEveryPhase(other);
    const foreign = mintCacheProductionCompletion(other, "settled");
    expect(completeCacheProductionScope(scope, foreign)).toBe(false);
    expect(cacheProductionRootState(root)).toBe("cleanup_required");
    // The completion of THIS scope clears the held marker, and the scope is
    // released once - and only once.
    const completion = mintCacheProductionCompletion(scope, "settled");
    expect(completion).not.toBeNull();
    expect(completeCacheProductionScope(scope, completion)).toBe(true);
    // The scope is STILL held after the completion: the completion clears the
    // held marker, and the release that follows gives the root back. The two
    // happen in the same breath of the owner of the scope.
    expect(cacheProductionRootState(root)).toBe("producing");
    // A completion is spent by its consumption: a second one is refused.
    expect(completeCacheProductionScope(scope, completion)).toBe(false);
    releaseCacheProductionScope(scope);
    expect(cacheProductionRootState(root)).toBe("idle");
    // The OTHER scope of this case is still held: it was taken for the foreign
    // completion and it is released at the end of the case.
    expect(cacheProductionSchedulerState().active).toBe(1);
    // A second release gives nothing back twice.
    releaseCacheProductionScope(scope);
    expect(cacheProductionSchedulerState().active).toBe(1);
    releaseCacheProductionScope(other);
    expect(cacheProductionSchedulerState().active).toBe(0);
  });

  it("refuses a phase lease of another owner, and a phase that was already leased", async () => {
    const root = temporaryRoot();
    const scope = await hold(root);
    // Another owner may not touch the phases of this scope.
    expect(openCacheProductionPhaseLease(scope, "execution", OTHER_OWNER)).toBeNull();
    // A phase has exactly ONE lease: the second one is refused.
    const first = openCacheProductionPhaseLease(scope, "execution", OWNER);
    expect(first).not.toBeNull();
    expect(openCacheProductionPhaseLease(scope, "execution", OWNER)).toBeNull();
    // The lease settles ONCE.
    expect(first!.settle()).toBe(true);
    expect(first!.settle()).toBe(false);
    expect(first!.settled).toBe(true);
    // A phase this scope's mode does not have is refused: a direct scope owns
    // the execution and the parent drain, and not the trees.
    const direct = await acquireCacheProductionScope(temporaryRoot(), { owner: OWNER, mode: "direct" });
    held.push(direct);
    expect(openCacheProductionPhaseLease(direct, "tree_release", OWNER)).toBeNull();
    const directExecution = openCacheProductionPhaseLease(direct, "execution", OWNER);
    const directParent = openCacheProductionPhaseLease(direct, "parent_drain", OWNER);
    expect(directExecution).not.toBeNull();
    expect(directParent).not.toBeNull();
    // A direct scope needs the parent drain as well: without it there is no
    // completion, and the root stays held.
    markCacheProductionCleanupRequired(direct);
    directExecution!.settle();
    expect(mintCacheProductionCompletion(direct, "settled")).toBeNull();
    directParent!.settle();
    const completion = mintCacheProductionCompletion(direct, "settled");
    expect(completion).not.toBeNull();
    expect(completeCacheProductionScope(direct, completion)).toBe(true);
  });

  it("gives the root back when a phase was NEVER STARTED", async () => {
    const root = temporaryRoot();
    const scope = await hold(root);
    markCacheProductionCleanupRequired(scope);
    // The production refused before it opened a single tree: the phase is over,
    // and it was never OWNED. The two facts are separate, and the receipt says
    // so.
    const tree = openCacheProductionPhaseLease(scope, "tree_release", OWNER);
    expect(tree).not.toBeNull();
    expect(tree!.notOwned("the production refused before it opened a tree")).toBe(true);
    expect(tree!.settled).toBe(true);
    settleEveryPhase(scope);
    const completion = mintCacheProductionCompletion(scope, "failed");
    expect(completion).not.toBeNull();
    expect(completion!.receipts.find(entry => entry.kind === "tree_release")?.owned).toBe(false);
    expect(completion!.receipts.find(entry => entry.kind === "execution")?.owned).toBe(true);
    expect(completeCacheProductionScope(scope, completion)).toBe(true);
    releaseCacheProductionScope(scope);
    expect(cacheProductionRootState(root)).toBe("idle");
    // The next production of the SAME root may be admitted.
    const next = await acquireCacheProductionScope(root, { owner: OWNER });
    held.push(next);
    expect(isLiveCacheProductionScope(next)).toBe(true);
  });

  it("keeps the root held when a phase that WAS TAKEN did not end", async () => {
    const root = temporaryRoot();
    const scope = await hold(root);
    markCacheProductionCleanupRequired(scope);
    openCacheProductionPhaseLease(scope, "execution", OWNER)?.settle();
    openCacheProductionPhaseLease(scope, "parent_drain", OWNER)?.settle();
    // The tree was taken and its release is UNKNOWN: its lease is NOT settled,
    // and it may not be pretended to have ended.
    openCacheProductionPhaseLease(scope, "tree_release", OWNER);
    expect(mintCacheProductionCompletion(scope, "failed")).toBeNull();
    expect(cacheProductionRootState(root)).toBe("cleanup_required");
    // And the next production of the same root may not be admitted.
    let granted = false;
    const waiting = acquireCacheProductionScope(root, { owner: OWNER })
      .then((value) => { granted = true; return value; })
      .catch(() => undefined);
    await Promise.resolve();
    expect(granted).toBe(false);
  });

  it("ends a draw that was refused before it took a resource", async () => {
    // The REAL factory of the pinned producer, and the REAL refusal path of it:
    // a draw that is refused before it takes a single resource must become
    // TERMINAL, or the close of the producer would wait for it for ever.
    const producer = await createPinnedOpenFilmCacheProducer(vendorRoot);
    try {
      for (let index = 0; index < 40; index += 1) {
        // The root is not there: the draw never reaches a worker.
        await expect(producer.pageFrame({
          root: join(temporaryRoot(), "not-there"),
          base: "http://127.0.0.1:1", rel: "film.html", ms: -1, width: 480, overrides: null,
        })).rejects.toBeDefined();
      }
    } finally {
      // The close of the producer waits for EVERY responsibility it accepted.
      // A refusal that was not terminal would keep it waiting for ever, and
      // this call would never return.
      await producer.close();
    }
    // The history of the refusals is BOUNDED: a producer that is under
    // pressure does not accumulate a controller and a root for ever.
    expect(openFilmProductionResponsibilityCount(producer)).toBeLessThanOrEqual(8);
  });

  it("refuses a completion of a scope whose owner is another one", async () => {
    const root = temporaryRoot();
    const scope = await acquireCacheProductionScope(root, { owner: OWNER });
    held.push(scope);
    // The phases of this scope belong to OWNER: OTHER_OWNER may not settle them.
    expect(openCacheProductionPhaseLease(scope, "execution", OTHER_OWNER)).toBeNull();
    settleEveryPhase(scope);
    const completion = mintCacheProductionCompletion(scope, "settled");
    expect(completion).not.toBeNull();
    // The completion belongs to the scope it was minted for, and to its owner.
    expect(completion!.owner).toBe(OWNER);
    expect(completion!.generation).toBe(scope.generation);
    expect(completeCacheProductionScope(scope, completion)).toBe(true);
  });

  it("carries the scope of a production into the steps inside it, and refuses a dead one", async () => {
    const root = temporaryRoot();
    const scope = await hold(root);
    const inside = runWithCacheProductionScope(scope, () => currentCacheProductionScope());
    expect(inside).toBe(scope);
    // The scope of a production is not taken again by an inner step: the inner
    // step finds the scope of the production it belongs to.
    const inner = runWithCacheProductionScope(scope, () => currentCacheProductionScope());
    expect(inner).toBe(scope);
    // A scope that was released is not a scope any more, and it may not be used.
    releaseCacheProductionScope(scope);
    expect(() => runWithCacheProductionScope(scope, () => undefined)).toThrow(CacheProductionAdmissionError);
  });

  it("refuses a root that is not a directory, and does not take a place in the queue", async () => {
    const file = join(temporaryRoot(), "a-file");
    writeFileSync(file, "not a directory");
    expect(() => cacheProductionRootFacts(file)).toThrow();
    await expect(acquireCacheProductionScope(join(file, "missing"))).rejects.toThrow();
    expect(cacheProductionSchedulerState().queued).toBe(0);
    expect(cacheProductionSchedulerState().active).toBe(0);
  });

  it("does not let a lookalike be a scope", async () => {
    const root = temporaryRoot();
    const scope = await hold(root);
    expect(isLiveCacheProductionScope(scope)).toBe(true);
    expect(isLiveCacheProductionScope({ ...scope })).toBe(false);
    expect(isLiveCacheProductionScope(JSON.parse(JSON.stringify(scope)))).toBe(false);
    expect(isLiveCacheProductionScope(null)).toBe(false);
    expect(isLiveCacheProductionScope("scope")).toBe(false);
  });
});
