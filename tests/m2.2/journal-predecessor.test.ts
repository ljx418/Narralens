import type { SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { HypitWriteAdapter } from "../../src/adapters/hypit/hypit-write-adapter.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";

/**
 * JRNL (legacy journal half) — the journals keep existing for D3/D4.2.1 recovery, so their
 * state writes must carry an explicit predecessor too (M2.2 plan §3.1).
 *
 * The no-change edit path matters: it commits straight from `prepared` without ever passing
 * `source_validated`, which is why `advanceJournal` accepts a list of predecessors.
 */

const stores: RevisionStore[] = [];
function store(): RevisionStore { const created = new RevisionStore(); stores.push(created); return created; }
afterEach(() => { while (stores.length > 0) stores.pop()!.close(); });

const EDIT_VALUES = (target: { transaction_id: string; project_id: string; correlation_id: string;
  state: string; request_json: string; request_hash: string; base_revision: number; authoring_id: string;
  before_fit: string; target_fit: string; source_before: string; run_before: string; narration_before: string;
  semantic_before: string; source_path: string; source_expected: string; studio_revision_before: number;
  compensation_attempt: number; manifest_sha: string; error_code: string; created_at: string; updated_at: string }): SQLInputValue[] =>
  [target.transaction_id, target.project_id, target.correlation_id, target.state, target.request_json,
    target.request_hash, target.base_revision, target.authoring_id, target.before_fit, target.target_fit,
    target.source_before, target.run_before, target.narration_before, target.semantic_before,
    target.source_path, target.source_expected, target.studio_revision_before, target.compensation_attempt,
    target.manifest_sha, target.error_code, target.created_at, target.updated_at];

const EDIT_ROW = {
  transaction_id: "txn_j1", project_id: "p1", correlation_id: "c", state: "prepared",
  request_json: "{}", request_hash: "h", base_revision: 2, authoring_id: "shot-1",
  before_fit: "contain", target_fit: "cover", source_before: "a", run_before: "b", narration_before: "c",
  semantic_before: "[]", source_path: "runs/build.svrun", source_expected: "d",
  studio_revision_before: 3, compensation_attempt: 0, manifest_sha: "", error_code: "",
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};

describe("JRNL journal transitions carry an explicit predecessor", () => {
  it("opens a journal row through the insert helper", () => {
    const target = store();
    target.openJournal("edit_journal", EDIT_VALUES(EDIT_ROW));
    expect(target.journal("txn_j1")).toMatchObject({ state: "prepared" });
    expect(() => target.openJournal("edit_journal", EDIT_VALUES(EDIT_ROW))).not.toThrow();
  });

  it("refuses an unknown table", () => {
    expect(() => store().openJournal("nope" as never, [])).toThrow(/JOURNAL_TABLE_UNKNOWN/);
  });

  it("accepts both predecessors for metadata_committed, including the no-change edit path", () => {
    const target = store();
    target.openJournal("edit_journal", EDIT_VALUES(EDIT_ROW));
    // prepared -> metadata_committed is the no-change path; it never passes source_validated.
    target.advanceJournal("edit_journal", "txn_j1", ["prepared", "source_validated"], "metadata_committed");
    expect(target.journal("txn_j1")!.state).toBe("metadata_committed");
  });

  it("rejects a transition whose predecessor does not hold", () => {
    const target = store();
    target.openJournal("edit_journal", EDIT_VALUES(EDIT_ROW));
    expect(() => target.advanceJournal("edit_journal", "txn_j1", ["source_validated"], "metadata_committed"))
      .toThrow(/INVALID_JOURNAL_TRANSITION/);
    expect(() => target.advanceJournal("edit_journal", "txn_missing", ["prepared"], "metadata_committed"))
      .toThrow(/INVALID_JOURNAL_TRANSITION/);
    expect(target.journal("txn_j1")!.state).toBe("prepared");
  });

  it("carries patch columns through the predecessor-checked update", () => {
    const target = store();
    target.openJournal("edit_journal", EDIT_VALUES(EDIT_ROW));
    target.advanceJournal("edit_journal", "txn_j1", ["prepared"], "attention", { error_code: "SOURCE_CHANGED" });
    expect(target.journal("txn_j1")).toMatchObject({ state: "attention", error_code: "SOURCE_CHANGED" });
  });
});

describe("JRNL recovery gate is a single shared predicate", () => {
  it("reports the same attention answer as state() before and after a pending journal exists", () => {
    const target = store();
    target.ensureProject("p1", 2);
    expect(target.recoveryGate("p1", 2)).toBe(false);
    target.openJournal("edit_journal", EDIT_VALUES(EDIT_ROW));
    // A pending journal is attention for both readers; they cannot drift apart.
    expect(target.recoveryGate("p1", 2)).toBe(true);
    expect(target.state("p1", 2).attention).toBe(true);
    target.advanceJournal("edit_journal", "txn_j1", ["prepared"], "metadata_committed");
    expect(target.recoveryGate("p1", 2)).toBe(false);
    expect(target.state("p1", 2).attention).toBe(false);
  });

  it("never reports an empty attention reason", () => {
    const target = store();
    target.ensureProject("p1", 2);
    expect(target.attentionReason("p1")).toBe("UNKNOWN");
  });

  it("increments the control revision monotonically", () => {
    const target = store();
    expect(target.controlRevision("p1", 2)).toBe(0);
    expect(target.bumpControlRevision("p1", 2)).toBe(1);
    expect(target.bumpControlRevision("p1", 2)).toBe(2);
  });

  it("leaves the legacy catalog untouched", () => {
    const catalog = new ProjectCatalog();
    const adapter = new HypitWriteAdapter(catalog);
    expect(adapter).toBeInstanceOf(HypitWriteAdapter);
  });
});
