import { describe, expect, it } from "vitest";
import type { ExecutionBinding, RunGate, RunScope } from "../../../src/contracts/agent-driven-types.js";
import { canonicalDigest } from "../../../src/host/creative/digest.js";
import {
  guardExecution,
  readNarrowEffectFacts,
  type ExecutionGuardFacts,
  type GuardedEffect,
  type NarrowApprovalState,
  type NarrowImpactState,
  type NarrowEffectFacts,
  type NarrowReviewState,
} from "../../../src/host/creative/execution-guard.js";
import { MemoryProductRepository } from "./support/memory-repository.js";

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

const SCOPE_DIGEST = canonicalDigest(SCOPE);

const BINDING: ExecutionBinding = {
  run_id: "run-1",
  plan_version: 1,
  step_id: "first_chapter",
  attempt: 1,
  input_digest: "a".repeat(64),
  run_scope_digest: SCOPE_DIGEST,
  authorization_id: "grant-1",
};

const NOW = 1794000000;

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

function facts(overrides: Partial<ExecutionGuardFacts> = {}): ExecutionGuardFacts {
  return {
    project_id: "project-1",
    run: {
      run_id: "run-1",
      current_plan_version: 1,
      state: "running",
      scope: SCOPE,
      run_scope_digest: SCOPE_DIGEST,
    },
    grant: {
      grant_id: "grant-1",
      run_scope_digest: SCOPE_DIGEST,
      principal_id: "human-1",
      state: "active",
      issued_at: NOW - 60,
      expires_at: NOW + 3600,
    },
    attempt: {
      step_id: "first_chapter",
      attempt: 1,
      state: "running",
      input_digest: "a".repeat(64),
      grant_id: "grant-1",
    },
    gates: [gate("definition", "accepted"), gate("sample", "accepted")],
    principal_id: "human-1",
    now_epoch_seconds: NOW,
    ...overrides,
  };
}

const EFFECT = { kind: "action", action: "clip.prepare", stage_id: "first_chapter" } as const;

describe("the execution guard", () => {
  it("refuses future-issued or missing issuance facts, while cancellation stays available", () => {
    for (const issued of [NOW + 1, undefined]) {
      const current = facts({grant:{...facts().grant!,issued_at:issued as number}});
      expect(() => guardExecution(BINDING,EFFECT,current)).toThrowError(expect.objectContaining({code:"RUN_SCOPE_REQUIRED"}));
      expect(() => guardExecution(BINDING,{kind:"safe_control",control:"cancel"},current)).not.toThrow();
    }
  });

  it("refuses to authorize anything without the durable facts", () => {
    expect(() => guardExecution(BINDING, EFFECT, undefined)).toThrowError(
      expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }),
    );
  });

  it("allows an effect whose prerequisites are accepted", () => {
    expect(() => guardExecution(BINDING, EFFECT, facts())).not.toThrow();
  });

  it("blocks a first chapter while the sample gate is not accepted", () => {
    expect(() =>
      guardExecution(
        BINDING,
        EFFECT,
        facts({ gates: [gate("definition", "accepted"), gate("sample", "pending")] }),
      ),
    ).toThrowError(expect.objectContaining({ code: "RUN_GATE_BLOCKED" }));
  });

  it("refuses a binding that belongs to another scope", () => {
    expect(() =>
      guardExecution(
        { ...BINDING, run_scope_digest: "9".repeat(64) },
        EFFECT,
        facts(),
      ),
    ).toThrowError(expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }));
  });

  it("refuses a scope that does not hash to the run's own digest", () => {
    expect(() =>
      guardExecution(
        BINDING,
        EFFECT,
        facts({
          run: {
            ...facts().run,
            run_scope_digest: "8".repeat(64),
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "RUN_PLAN_STALE" }));
  });

  it("refuses an action the scope does not allow", () => {
    const narrow: RunScope = { ...SCOPE, allowed_actions: ["clip.prepare"] };
    const narrowFacts = facts({
      run: { ...facts().run, scope: narrow, run_scope_digest: canonicalDigest(narrow) },
    });
    expect(() =>
      guardExecution(
        { ...BINDING, step_id: "chapters" },
        { kind: "action", action: "snapshot.render", stage_id: "chapters" },
        narrowFacts,
      ),
    ).toThrowError(expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }));
  });

  it("refuses an action that is not one of the fixed actions", () => {
    expect(() =>
      guardExecution(
        BINDING,
        {
          kind: "action",
          action: "not.an.action",
          stage_id: "first_chapter",
        } as unknown as GuardedEffect,
        facts(),
      ),
    ).toThrowError(expect.objectContaining({ code: "CAPABILITY_UNAVAILABLE" }));
  });

  it("refuses an action that does not belong to the step", () => {
    expect(() =>
      guardExecution(
        { ...BINDING, step_id: "cover" },
        { kind: "action", action: "clip.prepare", stage_id: "cover" },
        facts({ attempt: { ...facts().attempt!, step_id: "cover" } }),
      ),
    ).toThrowError(expect.objectContaining({ code: "CAPABILITY_UNAVAILABLE" }));
  });

  it("refuses an unknown step", () => {
    expect(() =>
      guardExecution(
        BINDING,
        { kind: "action", action: "clip.prepare", stage_id: "not_a_stage" },
        facts(),
      ),
    ).toThrowError(expect.objectContaining({ code: "CAPABILITY_UNAVAILABLE" }));
  });

  it("refuses a caller-selected stage that differs from the durable step", () => {
    expect(() => guardExecution(BINDING, { ...EFFECT, stage_id: "sample" }, facts())).toThrowError(expect.objectContaining({ code: "RUN_PLAN_STALE" }));
  });

  it("permits scoped prepare/apply while leaving finite approval consumption to MAIN", () => {
    const scope: RunScope = { ...SCOPE, allowed_actions: [...SCOPE.allowed_actions, "change.prepare", "change.apply"] };
    const digest = canonicalDigest(scope);
    const context = facts({ run: { ...facts().run, scope, run_scope_digest: digest }, grant: { ...facts().grant!, run_scope_digest: digest } });
    for (const action of ["change.prepare", "change.apply"] as const) {
      expect(() => guardExecution({ ...BINDING, run_scope_digest: digest }, { kind: "action", action, stage_id: "first_chapter" }, context)).not.toThrow();
    }
  });

  it("refuses a scope that asks for a paid, external or runtime action", () => {
    const paid = { ...SCOPE, allow_paid: true } as unknown as RunScope;
    expect(() =>
      guardExecution(
        BINDING,
        EFFECT,
        facts({
          run: { ...facts().run, scope: paid, run_scope_digest: canonicalDigest(paid) },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("refuses a revoked or expired authorization", () => {
    expect(() =>
      guardExecution(BINDING, EFFECT, facts({ grant: { ...facts().grant!, state: "revoked" } })),
    ).toThrowError(expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }));
    expect(() =>
      guardExecution(
        BINDING,
        EFFECT,
        facts({ grant: { ...facts().grant!, expires_at: NOW - 1 } }),
      ),
    ).toThrowError(expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }));
  });

  it("refuses an effect under another principal", () => {
    expect(() =>
      guardExecution(BINDING, EFFECT, facts({ principal_id: "human-2" })),
    ).toThrowError(expect.objectContaining({ code: "UNAUTHORIZED" }));
  });

  it("refuses a stale attempt", () => {
    expect(() =>
      guardExecution(
        { ...BINDING, attempt: 2 },
        EFFECT,
        facts(),
      ),
    ).toThrowError(expect.objectContaining({ code: "RUN_PLAN_STALE" }));
  });

  it("refuses an attempt that is over", () => {
    expect(() =>
      guardExecution(
        BINDING,
        EFFECT,
        facts({ attempt: { ...facts().attempt!, state: "succeeded" } }),
      ),
    ).toThrowError(expect.objectContaining({ code: "RUN_PLAN_STALE" }));
  });

  it("refuses a run that is paused, cancelled or waiting for a decision", () => {
    for (const state of ["paused", "cancelled", "waiting_user", "blocked"] as const) {
      expect(() =>
        guardExecution(BINDING, EFFECT, facts({ run: { ...facts().run, state } })),
      ).toThrowError(expect.objectContaining({ code: "RUN_PLAN_STALE" }));
    }
  });

  it("keeps the safe controls available without a grant", () => {
    expect(() =>
      guardExecution(
        BINDING,
        { kind: "safe_control", control: "pause" },
        facts({ grant: null, attempt: null }),
      ),
    ).not.toThrow();
    expect(() =>
      guardExecution(
        BINDING,
        { kind: "safe_control", control: "cancel" },
        facts({ grant: null, attempt: null }),
      ),
    ).not.toThrow();
  });

  it("refuses to pause a run that was already cancelled", () => {
    expect(() =>
      guardExecution(
        BINDING,
        { kind: "safe_control", control: "pause" },
        facts({ run: { ...facts().run, state: "cancelled" } }),
      ),
    ).toThrowError(expect.objectContaining({ code: "RUN_PLAN_STALE" }));
  });

  it("refuses a binding without a plan version, an attempt or an authorization", () => {
    expect(() => guardExecution({ ...BINDING, plan_version: 2 as 1 }, EFFECT, facts())).toThrowError(
      expect.objectContaining({ code: "RUN_PLAN_STALE" }),
    );
    expect(() => guardExecution({ ...BINDING, attempt: 0 }, EFFECT, facts())).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(() => guardExecution({ ...BINDING, authorization_id: "" }, EFFECT, facts())).toThrowError(
      expect.objectContaining({ code: "RUN_SCOPE_REQUIRED" }),
    );
  });

  it("never accepts a gate on its own", () => {
    const gates = [gate("definition", "accepted"), gate("sample", "pending")];
    expect(() =>
      guardExecution(BINDING, EFFECT, facts({ gates })),
    ).toThrow();
    expect(gates[1]?.state).toBe("pending");
  });
});

describe("the two narrow Host-only effects", () => {
  const reviewGate: RunGate = { ...gate("first_chapter", "pending"), review_package_id: "package-1" };
  const narrowFacts = (overrides: {
    readonly review?: NarrowReviewState;
    readonly approval?: NarrowApprovalState;
    readonly impact?: NarrowImpactState;
  } = {}) => ({
    review: {
      package_id: "package-1",
      package_digest: "b".repeat(64),
      state: overrides.review ?? ("pending" as NarrowReviewState),
    },
    approval: {
      approval_id: "approval-1",
      impact_id: "impact-1",
      state: overrides.approval ?? ("active" as NarrowApprovalState),
    },
    impact: {
      impact_id: "impact-1",
      state: overrides.impact ?? ("active" as NarrowImpactState),
    },
  });
  const waiting = facts({
    run: { ...facts().run, state: "waiting_user" },
    gates: [gate("definition", "accepted"), reviewGate],
    attempt: { ...facts().attempt!, state: "succeeded" },
  });
  const withNarrow = (narrow: NarrowEffectFacts | null | undefined, overrides: Partial<ExecutionGuardFacts> = {}) =>
    facts({ run: { ...facts().run, state: "waiting_user" }, gates: [gate("definition", "accepted"), reviewGate],
      attempt: { ...facts().attempt!, state: "succeeded" }, narrow, ...overrides });
  const PREPARE = { kind: "review_impact_prepare", package_id: "package-1", package_digest: "b".repeat(64) } as const;
  const ADOPT = { kind: "approved_prepared_adoption", package_id: "package-1", impact_id: "impact-1", approval_id: "approval-1" } as const;

  it("prepares the impact of a product that is still waiting for a decision", () => {
    expect(() => guardExecution(BINDING, PREPARE, withNarrow(narrowFacts()))).not.toThrow();
  });

  it("refuses an impact preparation for a package that was already decided", () => {
    // The impact is prepared BEFORE the decision. A package that was accepted or
    // rejected is not this effect's.
    for (const state of ["accepted", "changes_requested", "rejected", "stale"] as const) {
      expect(() => guardExecution(BINDING, PREPARE, withNarrow(narrowFacts({ review: state }))))
        .toThrowError(expect.objectContaining({ code: "REVIEW_STALE" }));
    }
  });

  it("refuses an impact preparation for another package or another version", () => {
    expect(() => guardExecution(BINDING, { ...PREPARE, package_id: "package-2" }, withNarrow(narrowFacts())))
      .toThrowError(expect.objectContaining({ code: "REVIEW_STALE" }));
    expect(() => guardExecution(BINDING, { ...PREPARE, package_digest: "c".repeat(64) }, withNarrow(narrowFacts())))
      .toThrowError(expect.objectContaining({ code: "REVIEW_STALE" }));
  });

  it("refuses a narrow effect whose facts were not read", () => {
    expect(() => guardExecution(BINDING, PREPARE, withNarrow(undefined)))
      .toThrowError(expect.objectContaining({ code: "REVIEW_STALE" }));
    expect(() => guardExecution(BINDING, PREPARE, withNarrow(null)))
      .toThrowError(expect.objectContaining({ code: "REVIEW_STALE" }));
    expect(() => guardExecution(BINDING, PREPARE, withNarrow({ review: null, approval: null, impact: null })))
      .toThrowError(expect.objectContaining({ code: "REVIEW_STALE" }));
  });

  it("refuses a narrow effect in a run that is paused, cancelled or stale", () => {
    for (const state of ["paused", "cancelled", "failed", "blocked"] as const) {
      expect(() => guardExecution(BINDING, PREPARE, withNarrow(narrowFacts(), { run: { ...facts().run, state } })))
        .toThrowError(expect.objectContaining({ code: "RUN_PLAN_STALE" }));
    }
  });

  it("does not widen the ordinary dispatch: an action is still refused while the run waits", () => {
    // A run that waits for a decision refuses an ordinary action outright, and the
    // narrow effects do not change that.
    expect(() => guardExecution(BINDING, EFFECT, { ...waiting, gates: [gate("definition", "accepted"), gate("sample", "pending")] }))
      .toThrowError(expect.objectContaining({ code: "RUN_PLAN_STALE" }));
    // And the ordinary gate check is untouched: a running run with an open gate is
    // still blocked at that gate.
    expect(() => guardExecution(BINDING, EFFECT, facts({ gates: [gate("definition", "accepted"), gate("sample", "pending")] })))
      .toThrowError(expect.objectContaining({ code: "RUN_GATE_BLOCKED" }));
  });

  it("consumes an approval of an accepted product", () => {
    expect(() => guardExecution(BINDING, ADOPT, withNarrow(narrowFacts({ review: "accepted" })))).not.toThrow();
  });

  it("refuses an adoption whose product was not accepted", () => {
    // The adoption happens AFTER the trusted decision. Adopting a package that is
    // still pending would be an adoption nobody decided.
    for (const state of ["pending", "changes_requested", "rejected", "stale"] as const) {
      expect(() => guardExecution(BINDING, ADOPT, withNarrow(narrowFacts({ review: state }))))
        .toThrowError(expect.objectContaining({ code: "REVIEW_STALE" }));
    }
  });

  it("refuses an adoption whose approval or impact is not active", () => {
    for (const approval of ["consumed", "rejected", "revoked"] as const) {
      expect(() => guardExecution(BINDING, ADOPT, withNarrow(narrowFacts({ review: "accepted", approval }))))
        .toThrowError(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
    }
    for (const impact of ["consumed", "expired", "stale"] as const) {
      expect(() => guardExecution(BINDING, ADOPT, withNarrow(narrowFacts({ review: "accepted", impact }))))
        .toThrowError(expect.objectContaining({ code: "IMPACT_STALE" }));
    }
  });

  it("refuses an adoption whose approval names another impact", () => {
    const narrow = narrowFacts({ review: "accepted" });
    expect(() => guardExecution(BINDING, ADOPT, withNarrow({ ...narrow, approval: { ...narrow.approval!, impact_id: "impact-2" } })))
      .toThrowError(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
  });

  it("refuses an adoption without an approval or without an impact", () => {
    const narrow = narrowFacts({ review: "accepted" });
    expect(() => guardExecution(BINDING, ADOPT, withNarrow({ ...narrow, approval: null })))
      .toThrowError(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
    expect(() => guardExecution(BINDING, ADOPT, withNarrow({ ...narrow, impact: null })))
      .toThrowError(expect.objectContaining({ code: "IMPACT_REQUIRED" }));
  });

  it("refuses a narrow effect when the run has no gate for the reviewed package", () => {
    expect(() => guardExecution(BINDING, PREPARE, withNarrow(narrowFacts(), { gates: [gate("definition", "accepted")] })))
      .toThrowError(expect.objectContaining({ code: "RUN_GATE_BLOCKED" }));
  });
});

describe("the narrow effect facts reader", () => {
  /** The real chain of records an approval hangs off. */
  async function chainWithApproval(repository: MemoryProductRepository): Promise<void> {
    await repository.transaction((tx) => {
      tx.put("template_version", { template_id: "local-short-film", version: 1 }, {
        template_id: "local-short-film", version: 1, parent_version: null,
        execution_digest: "b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32",
        capability_id: "clip.prepare", capability_version: "1", definition_json: {} as never,
        created_at: "2026-11-12T00:00:00.000Z",
      });
      tx.put("run", { project_id: "project-1", run_id: "run-1" }, {
        project_id: "project-1", run_id: "run-1", run_scope_digest: "a".repeat(64),
        template_id: "local-short-film", template_version: 1, current_plan_version: 1, state: "running",
        scope_json: {} as never, checkpoint_json: { gates: [] } as never, created_at: "2026-11-12T00:00:00.000Z",
      });
      tx.put("plan_version", { project_id: "project-1", run_id: "run-1", plan_version: 1 }, {
        project_id: "project-1", run_id: "run-1", plan_version: 1, run_scope_digest: "a".repeat(64),
        input_digest: "b".repeat(64), plan_json: {} as never, created_at: "2026-11-12T00:00:00.000Z",
      });
      tx.put("artifact_version", { project_id: "project-1", artifact_id: "package-1", version: 1 }, {
        project_id: "project-1", artifact_id: "package-1", version: 1, kind: "chapter", schema_version: 1,
        input_digest: "b".repeat(64), content_digest: "c".repeat(64), content_json: {} as never,
        input_refs_json: [], created_at: "2026-11-12T00:00:00.000Z",
      });
      tx.put("review_request", { project_id: "project-1", run_id: "run-1", review_id: "package-1" }, {
        project_id: "project-1", run_id: "run-1", review_id: "package-1", plan_version: 1,
        run_scope_digest: "a".repeat(64), gate: "sample", artifact_id: "package-1", artifact_version: 1,
        input_digest: "b".repeat(64), package_digest: "c".repeat(64), state: "accepted",
        reuse_review_id: null, created_at: "2026-11-12T00:00:00.000Z",
      });
      tx.put("trusted_confirmation", { project_id: "project-1", run_id: "run-1", confirmation_id: "conf-1" }, {
        project_id: "project-1", run_id: "run-1", confirmation_id: "conf-1", review_id: null,
        input_digest: "b".repeat(64), purpose: "run.authorize", channel: "trusted_ui",
        authenticated_actor: "human-1", session_ref: "session-1", action_digest: "a".repeat(64),
        issued_at: NOW - 60, expires_at: NOW + 3600,
      });
      tx.put("execution_grant", { project_id: "project-1", run_id: "run-1", grant_id: "grant-1" }, {
        project_id: "project-1", run_id: "run-1", grant_id: "grant-1", run_scope_digest: "a".repeat(64),
        confirmation_id: "conf-1", principal_id: "human-1", action: "clip.prepare",
        capability_id: "clip.prepare", capability_version: "1", allow_paid: 0, allow_external: 0,
        state: "active", expires_at: NOW + 3600,
      });
      tx.put("step_attempt", { project_id: "project-1", run_id: "run-1", plan_version: 1, step_id: "sample", attempt: 1 }, {
        project_id: "project-1", run_id: "run-1", plan_version: 1, step_id: "sample", attempt: 1,
        run_scope_digest: "a".repeat(64), grant_id: "grant-1", input_digest: "b".repeat(64),
        dependencies_json: [], state: "succeeded", job_id: null, output_artifact_id: null,
        output_version: null, updated_at: "2026-11-12T00:00:00.000Z",
      });
      tx.put("trusted_confirmation", { project_id: "project-1", run_id: "run-1", confirmation_id: "conf-2" }, {
        project_id: "project-1", run_id: "run-1", confirmation_id: "conf-2", review_id: "package-1",
        input_digest: "b".repeat(64), purpose: "change.approve", channel: "trusted_ui",
        authenticated_actor: "human-1", session_ref: "session-1", action_digest: "d".repeat(64),
        issued_at: NOW - 60, expires_at: NOW + 3600,
      });
      tx.put("approval", { project_id: "project-1", run_id: "run-1", approval_id: "approval-1" }, {
        project_id: "project-1", run_id: "run-1", approval_id: "approval-1", run_scope_digest: "a".repeat(64),
        confirmation_id: "conf-2", plan_version: 1, step_id: "sample", attempt: 1, input_digest: "b".repeat(64),
        change_id: "change-1", impact_id: "impact-1", base_revision: 3, control_revision: 1,
        action_digest: "d".repeat(64), facts_digest: "e".repeat(64), state: "active",
        expires_at: NOW + 3600, consumed_transaction_id: null,
      });
    });
  }

  it("reads the review and the approval out of the real records", async () => {
    const repository = new MemoryProductRepository();
    await chainWithApproval(repository);
    const narrow = await repository.transaction((tx) => readNarrowEffectFacts(tx, {
      project_id: "project-1", run_id: "run-1", package_id: "package-1",
      approval_id: "approval-1",
    }, (impactId) => (impactId === "impact-1" ? "active" : undefined)));
    expect(narrow.review?.state).toBe("accepted");
    expect(narrow.review?.package_digest).toBe("c".repeat(64));
    expect(narrow.approval?.impact_id).toBe("impact-1");
    expect(narrow.approval?.state).toBe("active");
    expect(narrow.impact?.state).toBe("active");
  });

  it("reports a record that is not there as nothing, not as a default", async () => {
    const repository = new MemoryProductRepository();
    const narrow = await repository.transaction((tx) => readNarrowEffectFacts(tx, {
      project_id: "project-1", run_id: "run-1", package_id: "package-missing",
    }));
    expect(narrow.review).toBeNull();
    expect(narrow.approval).toBeNull();
    expect(narrow.impact).toBeNull();
  });
});
