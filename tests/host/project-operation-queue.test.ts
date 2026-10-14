import { describe, expect, it } from "vitest";
import { InMemoryProjectOperationQueue } from "../../src/host/projects/project-operation-queue.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("D4.2.1 ProjectOperationQueue", () => {
  it("runs the same project in FIFO order and propagates return values", async () => {
    const queue = new InMemoryProjectOperationQueue();
    const gate = deferred();
    const started = deferred();
    const events: string[] = [];
    const first = queue.run("project-a", async () => { events.push("first:start"); started.resolve(); await gate.promise; events.push("first:end"); return 1; });
    const second = queue.run("project-a", async () => { events.push("second"); return 2; });
    await started.promise;
    expect(events).toEqual(["first:start"]);
    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("does not poison the tail after a rejection", async () => {
    const queue = new InMemoryProjectOperationQueue();
    await expect(queue.run("project-a", async () => { throw new Error("expected"); })).rejects.toThrow("expected");
    await expect(queue.run("project-a", async () => "recovered")).resolves.toBe("recovered");
  });

  it("allows different projects to make progress independently", async () => {
    const queue = new InMemoryProjectOperationQueue();
    const gate = deferred();
    const blocked = queue.run("project-a", async () => { await gate.promise; return "a"; });
    await expect(queue.run("project-b", async () => "b")).resolves.toBe("b");
    gate.resolve();
    await expect(blocked).resolves.toBe("a");
  });
});
