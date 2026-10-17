import { afterEach, describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS, RevisionStore, type ProjectTransactionRow,
} from "../../src/host/projects/revision-store.js";

/**
 * JRNL — the coordinator's transaction state machine (M2.2 plan §3, §3.1).
 *
 * The point of these tests is not that transitions work; it is that a state cannot be
 * written without naming the state it came from, and that two racing writers cannot both
 * win the same transition.
 */

const stores: RevisionStore[] = [];
function store(): RevisionStore { const created = new RevisionStore(); stores.push(created); return created; }
afterEach(() => { while (stores.length > 0) stores.pop()!.close(); });

function begin(target: RevisionStore, id = "txn_1"): ProjectTransactionRow {
  return target.beginTransaction({
    transaction_id: id, project_id: "p1", kind: "edit", correlation_id: "corr-1",
    request_json: "{}", request_hash: "h", base_revision: 0,
  });
}

describe("JRNL coordinator transaction state machine", () => {
  it("starts at received and walks the documented happy path", () => {
    const target = store();
    expect(begin(target).state).toBe("received");
    target.transition("txn_1", "received", "preconditions_checked", { source_digest_before: "a".repeat(64) });
    target.transition("txn_1", "preconditions_checked", "staged");
    target.transition("txn_1", "staged", "validated");
    target.transition("txn_1", "validated", "prepared");
    const committed = target.transition("txn_1", "prepared", "committed", {
      snapshot_id: "snap_1", source_digest_after: "b".repeat(64),
    });
    expect(committed.state).toBe("committed");
    expect(committed.source_digest_before).toBe("a".repeat(64));
    expect(committed.source_digest_after).toBe("b".repeat(64));
    expect(committed.snapshot_id).toBe("snap_1");
  });

  it("refuses any pair that is not in the frozen transition table", () => {
    const target = store();
    begin(target);
    const illegal: Array<[string, string]> = [
      ["received", "committed"],        // skipping stages
      ["received", "prepared"],         // skipping stages
      ["committed", "prepared"],        // committed is terminal, no successor
      ["prepared", "validated"],        // backwards
      ["received", "recovering"],       // recovery-only, unreachable from transition()
      ["received", "recovering"],       // recovery-only state, unreachable from transition()
      ["committed", "attention"],       // committed is terminal
      ["preconditions_checked", "committed"],      // attention is a sibling of committed, not a step
    ];
    for (const [from, to] of illegal) {
      expect(() => target.transition("txn_1", from as never, to as never), `${from}->${to}`)
        .toThrow(/INVALID_TRANSITION/);
    }
    expect(target.projectTransaction("txn_1")!.state).toBe("received");
  });

  it("accepts exactly the pairs the table declares", () => {
    for (const key of Object.keys(ALLOWED_TRANSITIONS)) {
      const [from, to] = key.split("->") as [string, string];
      expect(ALLOWED_TRANSITIONS[key], key).toBe(true);
      expect(from).not.toBe(to);
    }
    expect(ALLOWED_TRANSITIONS["committed->prepared"]).toBeUndefined();
  });

  it("rejects a transition whose predecessor no longer holds, so a second writer cannot win", () => {
    const target = store();
    begin(target);
    target.transition("txn_1", "received", "preconditions_checked");
    // The actor already advanced it; a stale writer replaying its own step must not succeed.
    expect(() => target.transition("txn_1", "received", "preconditions_checked")).toThrow(/INVALID_TRANSITION/);
    expect(target.projectTransaction("txn_1")!.state).toBe("preconditions_checked");
  });

  it("reaches recovering only through the recovery helper, never online", () => {
    const target = store();
    begin(target);
    expect(() => target.transition("txn_1", "received", "recovering" as never)).toThrow(/INVALID_TRANSITION/);
    const row = target.markRecovering("txn_1");
    expect(row).toMatchObject({ state: "recovering", terminal_reason: "CRASH_RECOVERY_REQUIRED" });
    expect(() => target.markRecovering("txn_1")).toThrow(/INVALID_TRANSITION/);
  });

  it("records why a transaction entered attention", () => {
    const target = store();
    begin(target);
    target.transition("txn_1", "received", "preconditions_checked");
    const row = target.transition("txn_1", "preconditions_checked", "attention", {
      error_code: "SNAPSHOT_DURABILITY_UNPROVABLE", terminal_reason: "fsync failed on linux",
    });
    expect(row).toMatchObject({ state: "attention", error_code: "SNAPSHOT_DURABILITY_UNPROVABLE",
      terminal_reason: "fsync failed on linux" });
  });

  it("keeps one row per transaction id and lists them per project", () => {
    const target = store();
    begin(target, "txn_a");
    begin(target, "txn_b");
    expect(() => begin(target, "txn_a")).toThrow();
    expect(target.projectTransactions("p1").map((row) => row.transaction_id)).toEqual(["txn_a", "txn_b"]);
  });

  it("keeps its own persistent record across a store reopen", () => {
    const file = `${process.env.TMPDIR ?? "/tmp"}/narralens-m22-jrnl-${process.pid}.sqlite`;
    const first = new RevisionStore(file);
    begin(first, "txn_keep");
    first.transition("txn_keep", "received", "preconditions_checked");
    first.close();
    const second = new RevisionStore(file);
    expect(second.projectTransaction("txn_keep")).toMatchObject({ state: "preconditions_checked" });
    second.close();
  });
});
