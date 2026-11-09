import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { awaitChildExit } from "../../../src/host/render/native-renderer.js";

/**
 * The lifecycle of a renderer's process.
 *
 * The child is fake and the process group is a function the test supplies, so the
 * lifecycle is checked without an encoder, a browser or a real signal. What matters is
 * the decision the renderer makes: a group that cannot be seen to end has to be
 * reported, because a process that may still be running may still write.
 */

class FakeChild extends EventEmitter {
  pid = 4242;
}

function asChild(child: FakeChild): ChildProcess {
  return child as unknown as ChildProcess;
}

describe("waiting for a renderer's process", () => {
  it("reports a child that ended by itself", async () => {
    const child = new FakeChild();
    setTimeout(() => { child.emit("close", 0, null); }, 5);

    const exited = await awaitChildExit(asChild(child), {
      signal: undefined,
      timeout_ms: 1000,
      group_exists: () => false,
      signal_group: () => undefined,
    });

    expect(exited.code).toBe(0);
    expect(exited.timedOut).toBe(false);
    expect(exited.group_settled).toBe(true);
  });

  it("reports a child that was stopped and whose group is gone", async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    const signals: string[] = [];
    setTimeout(() => {
      controller.abort();
      setTimeout(() => { child.emit("close", null, "SIGTERM"); }, 5);
    }, 5);

    const exited = await awaitChildExit(asChild(child), {
      signal: controller.signal,
      timeout_ms: 1000,
      group_settle_timeout_ms: 200,
      group_exists: () => false,
      signal_group: (_child, signal) => { signals.push(signal); },
    });

    expect(exited.group_settled).toBe(true);
    // The group was signalled, and the escalation was cleared once it was gone.
    expect(signals).toContain("SIGTERM");
  });

  it("reports a group that is still there", async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
      setTimeout(() => { child.emit("close", null, "SIGTERM"); }, 5);
    }, 5);

    const exited = await awaitChildExit(asChild(child), {
      signal: controller.signal,
      timeout_ms: 1000,
      group_settle_timeout_ms: 150,
      // The group never goes away: something is still running.
      group_exists: () => true,
      signal_group: () => undefined,
    });

    expect(exited.group_settled).toBe(false);
  });

  it("reports a child that never ended", async () => {
    const child = new FakeChild();

    const exited = await awaitChildExit(asChild(child), {
      signal: undefined,
      timeout_ms: 50,
      group_settle_timeout_ms: 50,
      group_exists: () => false,
      signal_group: () => undefined,
    });

    expect(exited.timedOut).toBe(true);
  });
});
