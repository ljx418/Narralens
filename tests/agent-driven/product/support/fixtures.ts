/**
 * Shared fixtures for the PRODUCT lane's tests.
 *
 * The values here satisfy the frozen schema and the lane's own consistency rules, so a
 * test that fails on a fixture is failing on the behaviour and not on the shape.
 */

import type { Brief, Meta, Ref } from "../../../../src/contracts/agent-driven-types.js";
import { styleDigest } from "../../../../src/host/creative/digest.js";
import type {
  ApprovalRecord,
  TrustedAdoptionAuthority,
  TrustedApprovalInput,
  TrustedCallerContext,
  TrustedConfirmationInput,
  TrustedConfirmationRecord,
} from "../../../../src/host/creative/product-repository.js";
import type {
  ProductFactPort,
  ProductProjectFacts,
} from "../../../../src/host/creative/product-facts.js";
import { createTrustedCallerContext } from "../../../../src/host/creative/trusted-context.js";

/** A fixed instant, so every timestamp in a test is deterministic. */
export const NOW_EPOCH_SECONDS = 1794000000;

/** The instant as an ISO-8601 string. */
export const NOW_ISO = new Date(NOW_EPOCH_SECONDS * 1000).toISOString();

/** The clock the tests use. */
export const fixedClock = (): number => NOW_EPOCH_SECONDS;

export function meta(idempotencyKey: string, correlationId = "corr-1"): Meta {
  return { idempotency_key: idempotencyKey, correlation_id: correlationId };
}

export const REF: Ref = {
  id: "ref-1",
  version: 1,
  sha256: "a".repeat(64),
};

/** The style direction, without its digest. */
export const STYLE = {
  style_id: "style-1",
  version: 1,
  visual_direction: "自然光，暖色调。",
  voice_direction: "平稳解说。",
  subtitle_direction: "底部单行。",
} as const;

/**
 * A brief that satisfies the frozen `Brief` schema **and** the lane's own consistency
 * rules: the material strategy names the brief's assets, the narration matches, and the
 * style digest is the recomputed one.
 */
export const BRIEF: Brief = {
  topic: "城市的一天",
  audience: "普通观众",
  duration_seconds: 90,
  tone: "explanatory",
  local_asset_ids: [],
  narration_asset_id: null,
  concept_summary: "用一天里几个场景串起城市的变化。",
  content_brief: {
    script_ref: null,
    material_strategy: {
      mode: "authorized_local_only",
      asset_ids: [],
      rights_refs: [],
      narration_asset_id: null,
      selection_notes: "只使用已授权的本地素材。",
    },
    style: { ...STYLE, style_digest: styleDigest(STYLE) },
  },
};

/** An authenticated relay caller. */
export const RELAY_CALLER: TrustedCallerContext = createTrustedCallerContext({
  principal_id: "agent-1",
  channel: "authenticated",
  source: "driver_relay",
  session_ref: "session-relay-1",
});

/** A second authenticated relay caller, for the cross-principal cases. */
export const OTHER_RELAY_CALLER: TrustedCallerContext = createTrustedCallerContext({
  principal_id: "agent-2",
  channel: "authenticated",
  source: "agent_conversation",
  session_ref: "session-relay-2",
});

/** A trusted workbench caller. */
export const TRUSTED_CALLER: TrustedCallerContext = createTrustedCallerContext({
  principal_id: "human-1",
  channel: "trusted_ui",
  source: "trusted_ui",
  session_ref: "session-trusted-1",
});

/** Another trusted workbench caller, for the cross-principal cases. */
export const OTHER_TRUSTED_CALLER: TrustedCallerContext = createTrustedCallerContext({
  principal_id: "human-2",
  channel: "trusted_ui",
  source: "trusted_ui",
  session_ref: "session-trusted-2",
});

/** A forged context: the right shape, but not minted by the dispatcher. */
export const FORGED_CALLER = {
  principal_id: "human-1",
  channel: "trusted_ui",
  source: "trusted_ui",
  session_ref: "forged",
} as unknown as TrustedCallerContext;

/**
 * A test fact port.
 *
 * It answers the questions the lane cannot answer itself: whether the project exists,
 * whether the material is licensed and whether the capability is available. A test can
 * make any of them fail.
 */
export class TestFactPort implements ProductFactPort {
  /** The facts the port answers with. A test changes them to make a check fail. */
  facts: ProductProjectFacts = {
    project_id: "project-1",
    exists: true,
    project_revision: 3,
    control_revision: 1,
    source_digest: "f".repeat(64),
    snapshot_id: "snapshot-3",
    rights_authorized: true,
    rights_reason: "授权材料已登记。",
    capability_available: true,
    capability_reason: "能力已登记。",
  };

  async readProjectFacts(projectId: string): Promise<ProductProjectFacts> {
    return { ...this.facts, project_id: projectId };
  }
}

/**
 * A test adoption authority.
 *
 * It writes the confirmation and the approval through the lane's transaction, exactly
 * like MAIN's adapter has to.
 */
export class TestAdoptionAuthority implements TrustedAdoptionAuthority {
  /** When set, `registerApproval` refuses, the way MAIN does when it cannot join. */
  approvalUnavailable = false;
  /** When set, `registerConfirmation` returns a confirmation for another purpose. */
  wrongPurpose = false;
  readonly confirmations: TrustedConfirmationRecord[] = [];
  readonly approvals: ApprovalRecord[] = [];

  registerConfirmation(
    tx: Parameters<TrustedAdoptionAuthority["registerConfirmation"]>[0],
    input: TrustedConfirmationInput,
  ): TrustedConfirmationRecord {
    const record: TrustedConfirmationRecord = {
      project_id: input.project_id,
      run_id: input.run_id,
      confirmation_id: `conf-${this.confirmations.length + 1}`,
      review_id: input.review_id,
      input_digest: input.input_digest,
      // The wrong-purpose switch never touches a run authorization: the grant path has to
      // keep working so a test can reach the decision path at all.
      purpose: this.wrongPurpose && input.purpose !== "run.authorize" ? "review" : input.purpose,
      channel: "trusted_ui",
      authenticated_actor: input.authenticated_actor,
      session_ref: input.session_ref,
      action_digest: input.action_digest,
      issued_at: input.issued_at,
      expires_at: input.expires_at,
    };
    this.confirmations.push(record);
    tx.put("trusted_confirmation", {
      project_id: record.project_id,
      run_id: record.run_id,
      confirmation_id: record.confirmation_id,
    }, record);
    return record;
  }

  registerApproval(
    tx: Parameters<TrustedAdoptionAuthority["registerApproval"]>[0],
    input: TrustedApprovalInput,
  ): ApprovalRecord | null {
    if (this.approvalUnavailable) return null;
    const record: ApprovalRecord = {
      project_id: input.project_id,
      run_id: input.run_id,
      approval_id: `approval-${this.approvals.length + 1}`,
      run_scope_digest: input.run_scope_digest,
      confirmation_id: input.confirmation_id,
      plan_version: input.plan_version,
      step_id: input.step_id,
      attempt: input.attempt,
      input_digest: input.input_digest,
      change_id: input.change_id,
      impact_id: input.impact_id,
      base_revision: input.base_revision,
      control_revision: input.control_revision,
      action_digest: input.action_digest,
      facts_digest: input.facts_digest,
      state: "active",
      expires_at: input.expires_at,
      consumed_transaction_id: null,
    };
    this.approvals.push(record);
    tx.put("approval", {
      project_id: record.project_id,
      run_id: record.run_id,
      approval_id: record.approval_id,
    }, record);
    return record;
  }
}
