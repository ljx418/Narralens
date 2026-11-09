import { describe, expect, it } from "vitest";
import type { Change, ReviewPart } from "../../../src/contracts/agent-driven-types.js";
import { creativeInputClosure } from "../../../src/host/creative/creative-closure.js";
import { canonicalDigest } from "../../../src/host/creative/digest.js";
import { CreativeService } from "../../../src/host/creative/creative-service.js";
import { FixedWorkflowService } from "../../../src/host/creative/fixed-workflow-service.js";
import { MemoryProductRepository } from "./support/memory-repository.js";
import {
  BRIEF,
  fixedClock,
  meta,
  REF,
  RELAY_CALLER,
  STYLE_REF,
  TestAdoptionAuthority,
  TRUSTED_CALLER,
} from "./support/fixtures.js";

const CHAPTER_PARTS: ReviewPart[] = [
  { kind: "preview", artifact_ref: REF, download_ref: null },
  { kind: "narration", artifact_ref: { ...REF, id: "narration" }, download_ref: null },
  { kind: "subtitles", artifact_ref: { ...REF, id: "subtitles" }, download_ref: null },
  { kind: "shot_summary", artifact_ref: { ...REF, id: "shots" }, download_ref: null },
  { kind: "rights_quality", artifact_ref: { ...REF, id: "rights" }, download_ref: null },
];

const IMPACT: Change = {
  impact_id: "impact-1",
  project_id: "project-1",
  materialization_id: "materialization-1",
  base_revision: 3,
  control_revision: 1,
  source_digest: "f".repeat(64),
  selection_version: 2,
  plan_sha256: "1".repeat(64),
  target_snapshot_id: "snapshot-2",
  expires_at: new Date((1794000000 + 3600) * 1000).toISOString(),
  state: "active",
  summary: "替换镜头2画面",
};

async function prepared(): Promise<{
  service: FixedWorkflowService;
  creative: CreativeService;
  repository: MemoryProductRepository;
  adoption: TestAdoptionAuthority;
  runId: string;
  scopeDigest: string;
  inputDigest: string;
}> {
  const repository = new MemoryProductRepository();
  const adoption = new TestAdoptionAuthority();
  const creative = new CreativeService({ repository, now: fixedClock });
  const service = new FixedWorkflowService({ repository, adoption, now: fixedClock });

  const intake = await creative.putIntake(
    { meta: meta("k-intake"), intake_id: null, base_version: 0, brief: BRIEF },
    RELAY_CALLER,
  );
  const closureDigest = await repository.transaction((tx) =>
    canonicalDigest(creativeInputClosure(tx, intake.intake_id, intake.version)),
  );
  const decision = await creative.relayContentDecision(
    {
      meta: meta("k-relay"),
      project_id: null,
      intake_id: intake.intake_id,
      intake_version: intake.version,
      input_digest: closureDigest,
      request_id: "request-1",
      choice: "accept_content",
      source: "driver_relay",
      source_message_ref: "message-1",
    },
    RELAY_CALLER,
  );
  const run = await service.prepareRun(
    {
      meta: meta("k-run"),
      project_id: "project-1",
      intake_decision_id: decision.decision_id,
      template_id: "local-short-film",
      template_version: 1,
      input_refs: [REF],
      input_digest: closureDigest,
      style_ref: STYLE_REF,
      content_type: "short_film",
    },
    RELAY_CALLER,
  );
  return {
    service,
    creative,
    repository,
    adoption,
    runId: run.run_id,
    scopeDigest: run.scope_digest,
    inputDigest: closureDigest,
  };
}

describe("the fixed workflow service", () => {
  it("prepares a run with the fixed scope and no paid, external or runtime authority", async () => {
    const { service, runId, scopeDigest } = await prepared();
    const run = await service.readRun({ project_id: "project-1", run_id: runId }, RELAY_CALLER);
    expect(run.state).toBe("ready");
    expect(run.plan_version).toBe(1);
    expect(run.workflow.execution_digest).toBe(
      "b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32",
    );
    expect(run.scope.allow_paid).toBe(false);
    expect(run.scope.allow_external_write).toBe(false);
    expect(run.scope.allow_runtime_mutation).toBe(false);
    expect(run.scope_digest).toBe(scopeDigest);
    expect(run.gates.map((gate) => gate.kind)).toEqual([
      "definition",
      "sample",
      "first_chapter",
      "chapter_pack",
      "cover",
      "qc",
      "adoption",
    ]);
    expect(run.gates.every((gate) => gate.state === "pending")).toBe(true);
  });

  it("refuses to start without an active authorization", async () => {
    const { service, runId, scopeDigest } = await prepared();
    await expect(
      service.startRun(
        {
          meta: meta("k-start"),
          project_id: "project-1",
          run_id: runId,
          expected_plan_version: 1,
          run_scope_digest: scopeDigest,
          authorization_id: "grant-missing",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "RUN_SCOPE_REQUIRED" });
  });

  it("authorizes a run in a trusted session and then starts it", async () => {
    const { service, runId, scopeDigest } = await prepared();
    const authorization = await service.authorizeRun(
      {
        meta: meta("k-authorize"),
        project_id: "project-1",
        run_id: runId,
        scope_digest: scopeDigest,
        choice: "authorize",
      },
      TRUSTED_CALLER,
    );
    expect(authorization.state).toBe("active");
    expect(authorization.channel).toBe("trusted_ui");

    const started = await service.startRun(
      {
        meta: meta("k-start"),
        project_id: "project-1",
        run_id: runId,
        expected_plan_version: 1,
        run_scope_digest: scopeDigest,
        authorization_id: authorization.authorization_id,
      },
      RELAY_CALLER,
    );
    expect(started.state).toBe("running");
  });

  it("keeps pause and cancel available without a grant, because they are safe controls", async () => {
    const { service, runId, scopeDigest } = await prepared();
    const paused = await service.pauseRun(
      {
        meta: meta("k-pause"),
        project_id: "project-1",
        run_id: runId,
        expected_plan_version: 1,
        run_scope_digest: scopeDigest,
        authorization_id: "grant-missing",
      },
      RELAY_CALLER,
    );
    expect(paused.state).toBe("paused");
    const cancelled = await service.cancelRun(
      {
        meta: meta("k-cancel"),
        project_id: "project-1",
        run_id: runId,
        expected_plan_version: 1,
        run_scope_digest: scopeDigest,
        authorization_id: "grant-missing",
      },
      RELAY_CALLER,
    );
    expect(cancelled.state).toBe("cancelled");
  });

  it("refuses a first chapter before the sample gate is accepted", async () => {
    const { service, runId, inputDigest } = await prepared();
    await expect(
      service.publishReviewPackage(
        {
          project_id: "project-1",
          run_id: runId,
          package_id: "package-first",
          kind: "first_chapter",
          chapter_id: "chapter-1",
          input_digest: inputDigest,
          output_digest: "2".repeat(64),
          quality_digest: "3".repeat(64),
          parts: CHAPTER_PARTS,
          source_shot_ids: ["shot-1"],
          selection_reason: "首章候选",
          allowed_choices: ["accept", "changes_requested", "reject"],
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "RUN_GATE_BLOCKED" });
  });

  it("refuses a chapter package that does not carry every chapter part", async () => {
    const { service, runId, inputDigest } = await prepared();
    await expect(
      service.publishReviewPackage(
        {
          project_id: "project-1",
          run_id: runId,
          package_id: "package-chapter",
          kind: "chapter_pack",
          chapter_id: "chapter-1",
          input_digest: inputDigest,
          output_digest: "2".repeat(64),
          quality_digest: "3".repeat(64),
          parts: [CHAPTER_PARTS[0]!],
          source_shot_ids: ["shot-1"],
          selection_reason: "章节候选",
          allowed_choices: ["accept"],
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("keeps the cover an independent package", async () => {
    const { service, runId, inputDigest } = await prepared();
    const cover = await service.publishReviewPackage(
      {
        project_id: "project-1",
        run_id: runId,
        package_id: "package-cover",
        kind: "cover",
        chapter_id: null,
        input_digest: inputDigest,
        output_digest: "4".repeat(64),
        quality_digest: "5".repeat(64),
        parts: [{ kind: "preview", artifact_ref: REF, download_ref: null }],
        source_shot_ids: [],
        selection_reason: "封面候选",
        allowed_choices: ["accept", "reject"],
      },
      RELAY_CALLER,
    );
    expect(cover.kind).toBe("cover");
    expect(cover.review_url).toBe("/workbench/projects/project-1/reviews/package-cover");
    expect(cover.parts).toHaveLength(1);
  });

  it("refuses a decision that is bound to another package version", async () => {
    const { service, runId, inputDigest } = await prepared();
    await service.publishReviewPackage(
      {
        project_id: "project-1",
        run_id: runId,
        package_id: "package-sample",
        kind: "sample",
        chapter_id: null,
        input_digest: inputDigest,
        output_digest: "2".repeat(64),
        quality_digest: "3".repeat(64),
        parts: CHAPTER_PARTS,
        source_shot_ids: ["shot-1"],
        selection_reason: "样片候选",
        allowed_choices: ["accept", "changes_requested", "reject"],
      },
      RELAY_CALLER,
    );
    await expect(
      service.decideReview(
        {
          meta: meta("k-decide-stale"),
          project_id: "project-1",
          run_id: runId,
          package_id: "package-sample",
          package_version: 1,
          plan_version: 1,
          input_digest: inputDigest,
          output_digest: "9".repeat(64),
          quality_digest: "3".repeat(64),
          choice: "accept",
          impact_id: null,
          plan_sha256: null,
        },
        TRUSTED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "REVIEW_STALE" });
  });

  it("records a plain review without granting any approval", async () => {
    const { service, runId, inputDigest } = await prepared();
    await service.publishReviewPackage(
      {
        project_id: "project-1",
        run_id: runId,
        package_id: "package-sample",
        kind: "sample",
        chapter_id: null,
        input_digest: inputDigest,
        output_digest: "2".repeat(64),
        quality_digest: "3".repeat(64),
        parts: CHAPTER_PARTS,
        source_shot_ids: ["shot-1"],
        selection_reason: "样片候选",
        allowed_choices: ["accept", "changes_requested", "reject"],
      },
      RELAY_CALLER,
    );
    const decision = await service.decideReview(
      {
        meta: meta("k-decide"),
        project_id: "project-1",
        run_id: runId,
        package_id: "package-sample",
        package_version: 1,
        plan_version: 1,
        input_digest: inputDigest,
        output_digest: "2".repeat(64),
        quality_digest: "3".repeat(64),
        choice: "accept",
        impact_id: null,
        plan_sha256: null,
      },
      TRUSTED_CALLER,
    );
    expect(decision.choice).toBe("accept");
    expect(decision.approval).toBeNull();
    expect(decision.channel).toBe("trusted_ui");
  });

  it("fails the adoption closed when MAIN cannot register the approval", async () => {
    const { service, runId, inputDigest, adoption } = await prepared();
    adoption.approvalUnavailable = true;
    await service.publishReviewPackage(
      {
        project_id: "project-1",
        run_id: runId,
        package_id: "package-sample",
        kind: "sample",
        chapter_id: null,
        input_digest: inputDigest,
        output_digest: "2".repeat(64),
        quality_digest: "3".repeat(64),
        parts: CHAPTER_PARTS,
        source_shot_ids: ["shot-1"],
        selection_reason: "样片候选",
        allowed_choices: ["accept", "accept_and_adopt"],
        impact: IMPACT,
      },
      RELAY_CALLER,
    );
    await expect(
      service.decideReview(
        {
          meta: meta("k-adopt-fail"),
          project_id: "project-1",
          run_id: runId,
          package_id: "package-sample",
          package_version: 1,
          plan_version: 1,
          input_digest: inputDigest,
          output_digest: "2".repeat(64),
          quality_digest: "3".repeat(64),
          choice: "accept_and_adopt",
          impact_id: IMPACT.impact_id,
          plan_sha256: IMPACT.plan_sha256,
        },
        TRUSTED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });

  it("records the limited approval in the same transaction as the decision", async () => {
    const { service, runId, inputDigest, adoption } = await prepared();
    await service.publishReviewPackage(
      {
        project_id: "project-1",
        run_id: runId,
        package_id: "package-sample",
        kind: "sample",
        chapter_id: null,
        input_digest: inputDigest,
        output_digest: "2".repeat(64),
        quality_digest: "3".repeat(64),
        parts: CHAPTER_PARTS,
        source_shot_ids: ["shot-1"],
        selection_reason: "样片候选",
        allowed_choices: ["accept", "accept_and_adopt"],
        impact: IMPACT,
      },
      RELAY_CALLER,
    );
    const decision = await service.decideReview(
      {
        meta: meta("k-adopt"),
        project_id: "project-1",
        run_id: runId,
        package_id: "package-sample",
        package_version: 1,
        plan_version: 1,
        input_digest: inputDigest,
        output_digest: "2".repeat(64),
        quality_digest: "3".repeat(64),
        choice: "accept_and_adopt",
        impact_id: IMPACT.impact_id,
        plan_sha256: IMPACT.plan_sha256,
      },
      TRUSTED_CALLER,
    );
    expect(decision.approval).not.toBeNull();
    expect(decision.approval?.impact_id).toBe(IMPACT.impact_id);
    expect(adoption.approvals).toHaveLength(1);
    expect(adoption.approvals[0]?.state).toBe("active");
    expect(adoption.confirmations.some((row) => row.purpose === "change.approve")).toBe(true);
  });

  it("shows the real attempts of the workflow nodes", async () => {
    const { service, runId } = await prepared();
    const workflow = await service.readWorkflow("project-1", RELAY_CALLER);
    expect(workflow.nodes.map((node) => node.node_id)).toEqual([
      "definition",
      "sample",
      "first_chapter",
      "chapters",
      "cover",
      "delivery",
    ]);
    expect(workflow.nodes.every((node) => node.attempt === 0)).toBe(true);
    expect(workflow.nodes.every((node) => node.state === "pending")).toBe(true);
    expect(workflow.nodes[3]?.dependencies).toEqual(["first_chapter"]);
  });
});
