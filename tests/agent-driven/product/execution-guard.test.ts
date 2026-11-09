import { describe, expect, it } from "vitest";
import type { ExecutionBinding, RunGate, RunScope } from "../../../src/contracts/agent-driven-types.js";
import { guardExecution } from "../../../src/host/creative/execution-guard.js";

const SCOPE: RunScope = {
  project_id: "project-1",
  run_id: "run-1",
  plan_version: 1,
  template_id: "local-short-film",
  template_version: 1,
  execution_digest: "b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32",
  input_digest: "a".repeat(64),
  content_type: "short_film",
  style_ref: { id: "style-1", version: 1, sha256: "b".repeat(64) },
  capability_fingerprint: "c".repeat(64),
  allowed_actions: ["clip.prepare", "snapshot.render", "qc.inspect", "delivery.package"],
  allow_paid: false,
  allow_external_write: false,
  allow_runtime_mutation: false,
};

const BINDING: ExecutionBinding = {
  run_id: "run-1",
  plan_version: 1,
  step_id: "first_chapter",
  attempt: 1,
  input_digest: "a".repeat(64),
  run_scope_digest: "d".repeat(64),
  authorization_id: "grant-1",
};

function gate(kind: RunGate["kind"], state: RunGate["state"]): RunGate {
  return {
    gate_id: `gate-${kind}`,
    kind,
    state,
    chapter_id: null,
    review_package_id: null,
    decision_id: null,
    input_digest: "a".repeat(64),
    output_digest: null,
    reuse_of_gate_id: null,
    reason: "test",
  };
}

describe("the execution guard", () => {
  it("blocks a first chapter while the sample gate is not accepted", () => {
    expect(() =>
      guardExecution(BINDING, "clip.prepare", {
        scope: SCOPE,
        run_scope_digest: BINDING.run_scope_digest,
        gates: [gate("sample", "pending")],
        stage_id: "first_chapter",
      }),
    ).toThrowError(expect.objectContaining({ code: "RUN_GATE_BLOCKED" }));
  });

  it("allows a first chapter once the sample gate is accepted", () => {
    expect(() =>
      guardExecution(BINDING, "clip.prepare", {
        scope: SCOPE,
        run_scope_digest: BINDING.run_scope_digest,
        gates: [gate("sample", "accepted")],
        stage_id: "first_chapter",
      }),
    ).not.toThrow();
  });

  it("refuses a binding that belongs to another scope", () => {
    expect(() =>
      guardExecution(BINDING, "clip.prepare", {
        scope: SCOPE,
        run_scope_digest: "9".repeat(64),
        gates: [gate("sample", "accepted")],
        stage_id: "first_chapter",
      }),
    ).toThrowError(expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }));
  });

  it("refuses an action the scope does not allow", () => {
    expect(() =>
      guardExecution(BINDING, "delivery.package", {
        scope: SCOPE,
        run_scope_digest: BINDING.run_scope_digest,
        gates: [],
        stage_id: "delivery",
      }),
    ).toThrowError(expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }));
  });

  it("refuses a scope that asks for a paid, external or runtime action", () => {
    expect(() =>
      guardExecution(BINDING, "clip.prepare", {
        scope: { ...SCOPE, allow_paid: true },
        run_scope_digest: BINDING.run_scope_digest,
        gates: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "CAPABILITY_UNAVAILABLE" }));
  });

  it("refuses a binding without a plan version, an attempt or an authorization", () => {
    expect(() => guardExecution({ ...BINDING, plan_version: 2 as 1 }, "clip.prepare")).toThrowError(
      expect.objectContaining({ code: "RUN_PLAN_STALE" }),
    );
    expect(() => guardExecution({ ...BINDING, attempt: 0 }, "clip.prepare")).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(() => guardExecution({ ...BINDING, authorization_id: "" }, "clip.prepare")).toThrowError(
      expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }),
    );
  });

  it("never accepts a gate on its own", () => {
    const gates = [gate("sample", "pending")];
    expect(() =>
      guardExecution(BINDING, "clip.prepare", {
        scope: SCOPE,
        gates,
        stage_id: "first_chapter",
      }),
    ).toThrow();
    expect(gates[0]?.state).toBe("pending");
  });
});
