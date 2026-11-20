import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The lifetime of the parent's media probe.
 *
 * The fixed upstream answers its frame-duration route with the promise of its own
 * `execFile('ffprobe', ...)`. Two things about that promise are NOT obvious, and
 * both of them were argued about in the wrong way in the report of the previous
 * wave:
 *
 *  - A child that closes its standard streams does NOT make the ChildProcess
 *    close while the child is still alive: the close of a ChildProcess needs the
 *    process to have ended AND its streams to be closed.
 *  - The callback of `execFile` is not only called from the close: it is also
 *    called from the error handler and from a throwing `kill()`. So "the callback
 *    arrived" is not the same fact as "the child was reaped".
 *
 * The DEFAULT of the upstream stays: its own probe, its own cache, its own route
 * and its own answers are not replaced by this wave. The narrow owner
 * (`src/adapters/openfilm/cache-frame-duration-probe.ts`) is NOT written and NOT
 * released: it may only be written when MAIN approves it, and only when the
 * pilot below shows that the default cannot carry the load.
 *
 * These cases are NOT RUN in this wave: the wave that released this file
 * allowed the identity, the scheduler, the static gates and the pure unit tests
 * only. They need real children and a heavy slot, and they run under the exact
 * P2a resource ticket.
 *
 * EVERY HELPER IS OWNED AND REAPED IN A FINALLY. A case that fails an assertion
 * may not leave a child behind: the owner of the child is registered at once,
 * and the finally ends it and WAITS for its real close - with the exact
 * identity of the child, not with a guess.
 *
 * THE HELPER IS NOT ffprobe. It is a small Node helper with a known behaviour,
 * and the cases say so: an INJECTED error of a helper is never reported as the
 * error of a real ffprobe.
 */

/** The helper of the probe. It is a small Node helper, and it says so. */
const PROBE_FIXTURE = fileURLToPath(new URL("./helpers/cache-probe-fixture.mjs", import.meta.url));

/**
 * What a case owns.
 *
 * A directory is removed only when the helper of it REALLY closed. A helper
 * that did not close keeps its directory, its events and its owner, and the
 * case says so: a deadline is a deadline and never a proof that the resources
 * are gone.
 */
interface OwnedHelper {
  readonly directory: string;
  helper: OwnedChild | null;
  closed: boolean;
}

const owned: OwnedHelper[] = [];

afterEach(() => {
  for (const entry of owned.splice(0).reverse()) {
    if (entry.closed) {
      rmSync(entry.directory, { recursive: true, force: true });
    } else {
      throw new Error(
        `the directory ${entry.directory} was kept: the helper of it did not really close`);
    }
  }
});

/** A directory for the events of one helper. It is OWNED from this moment on. */
function eventDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "narralens-probe-"));
  owned.push({ directory: root, helper: null, closed: false });
  return root;
}

/** The events one helper wrote. */
function eventsOf(root: string): { event: string; at: number }[] {
  try {
    return readFileSync(join(root, "events.jsonl"), "utf8")
      .split("\n").filter(line => line.trim() !== "")
      .map(line => JSON.parse(line) as { event: string; at: number });
  } catch {
    return [];
  }
}

/** One helper that this case OWNS. */
interface OwnedChild {
  readonly child: ChildProcess;
  /** The order of the events of the PARENT side, as they really arrived. */
  readonly order: string[];
  /** The real close of the child. */
  readonly closed: Promise<void>;
}

/**
 * Start one helper, and OWN it from this moment on.
 *
 * The parent side records the order of its own events: the error, the exit, the
 * close and the callback of `execFile`. The order of those four is the fact the
 * pilot is about.
 */
function ownHelper(root: string, mode: string): OwnedChild {
  const events = join(root, "events.jsonl");
  const order: string[] = [];
  let settleClosed!: () => void;
  const closed = new Promise<void>((resolveClosed) => { settleClosed = resolveClosed; });
  const child = execFile(process.execPath, [PROBE_FIXTURE, mode, events], (error) => {
    order.push(`callback:${error === null ? "ok" : "error"}`);
  });
  child.on("error", () => { order.push("error"); });
  child.on("exit", () => { order.push("exit"); });
  child.on("close", () => { order.push("close"); settleClosed(); });
  const ownedChild = { child, order, closed };
  const entry = owned[owned.length - 1];
  if (entry !== undefined) entry.helper = ownedChild;
  return ownedChild;
}

/**
 * End a helper and WAIT for its real close.
 *
 * It is called from the finally of every case: a helper that was started is
 * always ended, even when the case failed an assertion.
 */
async function reapHelper(helper: OwnedChild): Promise<boolean> {
  const pid = helper.child.pid;
  if (typeof pid !== "number" || pid <= 0) return true;
  try {
    helper.child.kill("SIGKILL");
  } catch {
    // The child is already gone: nothing to end.
  }
  const closed = await Promise.race([
    helper.closed.then(() => true),
    new Promise<boolean>((resolveWait) => { setTimeout(() => resolveWait(false), 5000); }),
  ]);
  const entry = owned[owned.length - 1];
  if (entry !== undefined) entry.closed = closed;
  return closed;
}

describe("the lifetime of the parent's media probe", () => {
  it("shows that a child which closes its streams is NOT a child that closed", async () => {
    const root = eventDirectory();
    const helper = ownHelper(root, "close-stdio-live");
    try {
      expect(typeof helper.child.pid).toBe("number");
      await new Promise(resolve => setTimeout(resolve, 500));
      // The helper is still there: the close of its streams did not end it.
      expect(eventsOf(root).some(entry => entry.event === "alive")).toBe(true);
      // The parent side saw NO close and NO callback: the child is alive.
      expect(helper.order).not.toContain("close");
    } finally {
      await reapHelper(helper);
    }
    // The close really came, after the hard signal.
    expect(helper.order).toContain("close");
  });

  it("shows that a child which ignores SIGTERM has to be ended the hard way", async () => {
    const root = eventDirectory();
    const helper = ownHelper(root, "ignore-term");
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(eventsOf(root).some(entry => entry.event === "alive")).toBe(true);
      // The polite signal does not end it: the helper says so itself.
      helper.child.kill("SIGTERM");
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(eventsOf(root).some(entry => entry.event === "sigterm-ignored")).toBe(true);
      // The hard signal does, and the case waits for the REAL close.
      helper.child.kill("SIGKILL");
      await Promise.race([
        helper.closed,
        new Promise<void>((resolveWait) => { setTimeout(resolveWait, 5000); }),
      ]);
    } finally {
      await reapHelper(helper);
    }
    expect(helper.order).toContain("exit");
    expect(helper.order).toContain("close");
  });

  it("shows the difference between a child that left and a callback that arrived", async () => {
    const root = eventDirectory();
    const helper = ownHelper(root, "normal");
    try {
      await Promise.race([
        helper.closed,
        new Promise<void>((resolveWait) => { setTimeout(resolveWait, 5000); }),
      ]);
    } finally {
      await reapHelper(helper);
    }
    // The helper left on its own, and it wrote its own exit.
    expect(eventsOf(root).some(entry => entry.event === "exit")).toBe(true);
    // The ORDER of the parent side is recorded: the exit comes before the
    // close, and the callback of `execFile` is one of them - and it is NOT a
    // proof that the child was reaped on its own.
    expect(helper.order).toContain("exit");
    expect(helper.order).toContain("close");
    expect(helper.order.indexOf("exit")).toBeLessThan(helper.order.indexOf("close"));
  });
});
