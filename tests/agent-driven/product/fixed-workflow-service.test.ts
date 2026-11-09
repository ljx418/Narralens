import { describe, expect, it } from "vitest";
import type { Change, ReviewPart } from "../../../src/contracts/agent-driven-types.js";
import { creativeInputClosure } from "../../../src/host/creative/creative-closure.js";
import { canonicalDigest } from "../../../src/host/creative/digest.js";
import { CreativeService } from "../../../src/host/creative/creative-service.js";
import { FixedWorkflowService } from "../../../src/host/creative/fixed-workflow-service.js";
import { guardExecutionInTransaction } from "../../../src/host/creative/execution-guard.js";
import { MemoryProductRepository } from "./support/memory-repository.js";
import {
  BRIEF,
  fixedClock,
  meta,
  NOW_ISO,
  RELAY_CALLER,
  TestAdoptionAuthority,
  TestFactPort,
  TRUSTED_CALLER,
} from "./support/fixtures.js";

const CHAPTER_PARTS: ReviewPart[] = [
  { kind: "preview", artifact_ref: { id: "video", version: 1, sha256: "a".repeat(64) }, download_ref: null },
  { kind: "narration", artifact_ref: { id: "audio", version: 1, sha256: "b".repeat(64) }, download_ref: null },
  { kind: "subtitles", artifact_ref: { id: "subs", version: 1, sha256: "c".repeat(64) }, download_ref: null },
  { kind: "shot_summary", artifact_ref: { id: "shots", version: 1, sha256: "d".repeat(64) }, download_ref: null },
  { kind: "rights_quality", artifact_ref: { id: "rights", version: 1, sha256: "e".repeat(64) }, download_ref: null },
];

const SCRIPT = {
  kind: "script" as const,
  paragraphs: [{ paragraph_id: "p-1", text: "风格稿。" }],
};

const STORYBOARD = {
  kind: "storyboard" as const,
  fps: 30 as const,
  shots: [
    {
      shot_id: "shot-1",
      paragraph_id: "p-1",
      asset_id: null,
      duration_frames: 300,
      caption: "城市远景",
      concept_text: "傍晚的城市",
    },
  ],
};

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

interface Prepared {
  readonly repository: MemoryProductRepository;
  readonly adoption: TestAdoptionAuthority;
  readonly facts: TestFactPort;
  readonly creative: CreativeService;
  readonly service: FixedWorkflowService;
  readonly runId: string;
  readonly scopeDigest: string;
  readonly inputDigest: string;
  readonly decisionId: string;
  readonly intakeId: string;
  readonly intakeVersion: number;
}

async function prepared(options: { adoption?: TestAdoptionAuthority; facts?: TestFactPort } = {}): Promise<Prepared> {
  const repository = new MemoryProductRepository();
  const adoption = options.adoption ?? new TestAdoptionAuthority();
  const facts = options.facts ?? new TestFactPort();
  const creative = new CreativeService({ repository, now: fixedClock });
  const service = new FixedWorkflowService({ repository, adoption, facts, now: fixedClock });

  const intake = await creative.putIntake(
    { meta: meta("k-intake"), intake_id: null, base_version: 0, brief: BRIEF },
    RELAY_CALLER,
  );
  // The run's refs have to resolve to real immutable artifacts, so the test writes them.
  const styleArtifact = await creative.putArtifact(
    {
      meta: meta("k-style"),
      project_id: "project-1",
      artifact_id: null,
      base_version: 0,
      input_digest: "e".repeat(64),
      content: SCRIPT,
      input_refs: [],
    },
    RELAY_CALLER,
  );
  const inputArtifact = await creative.putArtifact(
    {
      meta: meta("k-input"),
      project_id: "project-1",
      artifact_id: null,
      base_version: 0,
      input_digest: "e".repeat(64),
      content: STORYBOARD,
      input_refs: [],
    },
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
      input_refs: [inputArtifact.ref],
      input_digest: closureDigest,
      style_ref: styleArtifact.ref,
      content_type: "short_film",
    },
    RELAY_CALLER,
  );
  return {
    repository,
    adoption,
    facts,
    creative,
    service,
    runId: run.run_id,
    scopeDigest: run.scope_digest,
    inputDigest: closureDigest,
    decisionId: decision.decision_id,
    intakeId: intake.intake_id,
    intakeVersion: intake.version,
  };
}

async function authorized(context: Prepared): Promise<string> {
  const authorization = await context.service.authorizeRun(
    {
      meta: meta("k-authorize"),
      project_id: "project-1",
      run_id: context.runId,
      scope_digest: context.scopeDigest,
      choice: "authorize",
    },
    TRUSTED_CALLER,
  );
  return authorization.authorization_id;
}

async function recordAttempt(
  context: Prepared,
  grantId: string,
  stepId: string,
  attempt = 1,
  state: "pending" | "running" | "succeeded" = "succeeded",
): Promise<void> {
  await context.service.recordStepAttempt(
    {
      project_id: "project-1",
      run_id: context.runId,
      plan_version: 1,
      step_id: stepId,
      attempt,
      grant_id: grantId,
      input_digest: context.inputDigest,
      state,
      job_id: `job-${stepId}`,
      observed_at: NOW_ISO,
    },
    TRUSTED_CALLER,
  );
}

async function publish(
  context: Prepared,
  options: {
    package_id: string;
    kind: "sample" | "first_chapter" | "chapter_pack" | "audio" | "cover";
    step_id: string;
    attempt?: number;
    chapter_id?: string | null;
    parts?: ReviewPart[];
    allowed_choices?: ("accept" | "changes_requested" | "reject" | "accept_and_adopt")[];
    impact?: Change | null;
    reuse_of_package_id?: string | null;
    output_digest?: string;
    quality_digest?: string;
  },
) {
  return context.service.publishReviewPackage(
    {
      project_id: "project-1",
      run_id: context.runId,
      package_id: options.package_id,
      kind: options.kind,
      chapter_id: options.chapter_id ?? null,
      input_digest: context.inputDigest,
      output_digest: options.output_digest ?? "2".repeat(64),
      quality_digest: options.quality_digest ?? "3".repeat(64),
      parts: options.parts ?? CHAPTER_PARTS,
      source_shot_ids: ["shot-1"],
      selection_reason: "候选",
      allowed_choices: options.allowed_choices ?? ["accept", "changes_requested", "reject"],
      impact: options.impact ?? null,
      reuse_of_package_id: options.reuse_of_package_id ?? null,
      step_id: options.step_id,
      attempt: options.attempt ?? 1,
    },
    RELAY_CALLER,
  );
}

describe("the fixed workflow service", () => {
  it("prepares a run with the fixed scope and an accepted definition gate", async () => {
    const context = await prepared();
    const run = await context.service.readRun(
      { project_id: "project-1", run_id: context.runId },
      RELAY_CALLER,
    );
    expect(run.state).toBe("ready");
    expect(run.plan_version).toBe(1);
    expect(run.workflow.execution_digest).toBe(
      "b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32",
    );
    expect(run.scope.allow_paid).toBe(false);
    expect(run.scope.allow_external_write).toBe(false);
    expect(run.scope.allow_runtime_mutation).toBe(false);
    expect(run.scope_digest).toBe(context.scopeDigest);
    const definition = run.gates.find((gate) => gate.kind === "definition");
    expect(definition?.state).toBe("accepted");
    expect(definition?.decision_id).toBe(context.decisionId);
    expect(run.gates.filter((gate) => gate.state === "pending")).toHaveLength(6);
  });

  it("refuses to prepare a run without the project facts", async () => {
    const repository = new MemoryProductRepository();
    const creative = new CreativeService({ repository, now: fixedClock });
    const service = new FixedWorkflowService({ repository, adoption: new TestAdoptionAuthority(), now: fixedClock });
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
    await expect(
      service.prepareRun(
        {
          meta: meta("k-run"),
          project_id: "project-1",
          intake_decision_id: decision.decision_id,
          template_id: "local-short-film",
          template_version: 1,
          input_refs: [],
          input_digest: closureDigest,
          style_ref: { id: "style-1", version: 1, sha256: "b".repeat(64) },
          content_type: "short_film",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });

  it("refuses a content decision that did not accept the content", async () => {
    const context = await prepared();
    const revised = await context.creative.relayContentDecision(
      {
        meta: meta("k-relay-revise"),
        project_id: null,
        intake_id: context.intakeId,
        intake_version: context.intakeVersion,
        input_digest: context.inputDigest,
        request_id: "request-revise",
        choice: "revise_content",
        source: "driver_relay",
        source_message_ref: "message-2",
      },
      RELAY_CALLER,
    );
    expect(revised.choice).toBe("revise_content");
    await expect(
      context.service.prepareRun(
        {
          meta: meta("k-run-revise"),
          project_id: "project-1",
          intake_decision_id: revised.decision_id,
          template_id: "local-short-film",
          template_version: 1,
          input_refs: [],
          input_digest: context.inputDigest,
          style_ref: { id: "style-1", version: 1, sha256: "b".repeat(64) },
          content_type: "short_film",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "REVIEW_STALE" });
  });

  it("refuses to start without an active authorization", async () => {
    const context = await prepared();
    await expect(
      context.service.startRun(
        {
          meta: meta("k-start"),
          project_id: "project-1",
          run_id: context.runId,
          expected_plan_version: 1,
          run_scope_digest: context.scopeDigest,
          authorization_id: "grant-missing",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "RUN_SCOPE_REQUIRED" });
  });

  it("authorizes a run in a trusted session and then starts it", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    const started = await context.service.startRun(
      {
        meta: meta("k-start"),
        project_id: "project-1",
        run_id: context.runId,
        expected_plan_version: 1,
        run_scope_digest: context.scopeDigest,
        authorization_id: grantId,
      },
      RELAY_CALLER,
    );
    expect(started.state).toBe("running");
  });

  it("refuses to start under another principal's authorization", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await expect(
      context.service.startRun(
        {
          meta: meta("k-start-foreign"),
          project_id: "project-1",
          run_id: context.runId,
          expected_plan_version: 1,
          run_scope_digest: context.scopeDigest,
          authorization_id: grantId,
        },
        {
          ...RELAY_CALLER,
          principal_id: "agent-2",
        },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps pause and cancel available without a grant, because they are safe controls", async () => {
    const context = await prepared();
    const paused = await context.service.pauseRun(
      {
        meta: meta("k-pause"),
        project_id: "project-1",
        run_id: context.runId,
        expected_plan_version: 1,
        run_scope_digest: context.scopeDigest,
        authorization_id: "grant-missing",
      },
      RELAY_CALLER,
    );
    expect(paused.state).toBe("paused");
    const cancelled = await context.service.cancelRun(
      {
        meta: meta("k-cancel"),
        project_id: "project-1",
        run_id: context.runId,
        expected_plan_version: 1,
        run_scope_digest: context.scopeDigest,
        authorization_id: "grant-missing",
      },
      RELAY_CALLER,
    );
    expect(cancelled.state).toBe("cancelled");
  });

  it("refuses a first chapter before the sample gate is accepted", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await expect(
      publish(context, { package_id: "package-first", kind: "first_chapter", step_id: "sample" }),
    ).rejects.toMatchObject({ code: "RUN_GATE_BLOCKED" });
  });

  it("refuses a chapter package before the first chapter is accepted", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await publish(context, { package_id: "package-sample", kind: "sample", step_id: "sample" });
    await context.service.decideReview(
      {
        meta: meta("k-decide-sample"),
        project_id: "project-1",
        run_id: context.runId,
        package_id: "package-sample",
        package_version: 1,
        plan_version: 1,
        input_digest: context.inputDigest,
        output_digest: "2".repeat(64),
        quality_digest: "3".repeat(64),
        choice: "accept",
        impact_id: null,
        plan_sha256: null,
      },
      TRUSTED_CALLER,
    );
    await expect(
      publish(context, { package_id: "package-chapter", kind: "chapter_pack", step_id: "first_chapter" }),
    ).rejects.toMatchObject({ code: "RUN_GATE_BLOCKED" });
  });

  it("does not let an audio package stand in for the chapter gate", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    const audio = await publish(context, {
      package_id: "package-audio",
      kind: "audio",
      step_id: "sample",
      parts: [{ kind: "narration", artifact_ref: CHAPTER_PARTS[1]!.artifact_ref, download_ref: null }],
    });
    expect(audio.kind).toBe("audio");
    const run = await context.service.readRun(
      { project_id: "project-1", run_id: context.runId },
      RELAY_CALLER,
    );
    const chapterGate = run.gates.find((gate) => gate.kind === "chapter_pack");
    expect(chapterGate?.review_package_id).toBeNull();
  });

  it("refuses a chapter package that does not carry every chapter part", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await expect(
      publish(context, {
        package_id: "package-chapter",
        kind: "chapter_pack",
        step_id: "sample",
        parts: [CHAPTER_PARTS[0]!],
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("refuses a package that comes from an attempt that is not the current one", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample", 1);
    await recordAttempt(context, grantId, "sample", 2);
    await expect(
      publish(context, { package_id: "package-old", kind: "sample", step_id: "sample", attempt: 1 }),
    ).rejects.toMatchObject({ code: "RUN_PLAN_STALE" });
  });

  it("refuses a package that comes from a cancelled attempt", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample", 1, "running");
    await context.service.recordStepAttempt(
      {
        project_id: "project-1",
        run_id: context.runId,
        plan_version: 1,
        step_id: "sample",
        attempt: 1,
        grant_id: grantId,
        input_digest: context.inputDigest,
        state: "cancelled",
        observed_at: NOW_ISO,
      },
      TRUSTED_CALLER,
    ).catch(() => undefined);
    await expect(
      publish(context, { package_id: "package-cancelled", kind: "sample", step_id: "sample" }),
    ).rejects.toMatchObject({ code: "RUN_PLAN_STALE" });
  });

  it("publishes the same package twice without resetting anything", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    const first = await publish(context, { package_id: "package-sample", kind: "sample", step_id: "sample" });
    const replay = await publish(context, { package_id: "package-sample", kind: "sample", step_id: "sample" });
    expect(replay.package_id).toBe(first.package_id);
    const run = await context.service.readRun(
      { project_id: "project-1", run_id: context.runId },
      RELAY_CALLER,
    );
    expect(run.gates.find((gate) => gate.kind === "sample")?.review_package_id).toBe("package-sample");
  });

  it("refuses a reuse whose quality is different", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await publish(context, { package_id: "package-sample", kind: "sample", step_id: "sample" });
    await expect(
      publish(context, {
        package_id: "package-sample-2",
        kind: "sample",
        step_id: "sample",
        reuse_of_package_id: "package-sample",
        quality_digest: "9".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "REVIEW_STALE" });
  });

  it("keeps the cover an independent package", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "cover");
    const cover = await publish(context, {
      package_id: "package-cover",
      kind: "cover",
      step_id: "cover",
      parts: [{ kind: "preview", artifact_ref: CHAPTER_PARTS[0]!.artifact_ref, download_ref: null }],
    });
    expect(cover.kind).toBe("cover");
    expect(cover.review_url).toBe("/workbench/projects/project-1/reviews/package-cover");
    expect(cover.parts).toHaveLength(1);
  });

  it("refuses a decision that is bound to another package version", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await publish(context, { package_id: "package-sample", kind: "sample", step_id: "sample" });
    await expect(
      context.service.decideReview(
        {
          meta: meta("k-decide-stale"),
          project_id: "project-1",
          run_id: context.runId,
          package_id: "package-sample",
          package_version: 1,
          plan_version: 1,
          input_digest: context.inputDigest,
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

  it("refuses a choice the package does not allow", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await publish(context, {
      package_id: "package-sample",
      kind: "sample",
      step_id: "sample",
      allowed_choices: ["accept"],
    });
    await expect(
      context.service.decideReview(
        {
          meta: meta("k-decide-forbidden"),
          project_id: "project-1",
          run_id: context.runId,
          package_id: "package-sample",
          package_version: 1,
          plan_version: 1,
          input_digest: context.inputDigest,
          output_digest: "2".repeat(64),
          quality_digest: "3".repeat(64),
          choice: "reject",
          impact_id: null,
          plan_sha256: null,
        },
        TRUSTED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("records a plain review without granting any approval", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await publish(context, { package_id: "package-sample", kind: "sample", step_id: "sample" });
    const decision = await context.service.decideReview(
      {
        meta: meta("k-decide"),
        project_id: "project-1",
        run_id: context.runId,
        package_id: "package-sample",
        package_version: 1,
        plan_version: 1,
        input_digest: context.inputDigest,
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
    expect(context.adoption.approvals).toHaveLength(0);
  });

  it("fails the adoption closed when MAIN cannot register the approval", async () => {
    const adoption = new TestAdoptionAuthority();
    adoption.approvalUnavailable = true;
    const context = await prepared({ adoption });
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await publish(context, {
      package_id: "package-sample",
      kind: "sample",
      step_id: "sample",
      allowed_choices: ["accept", "accept_and_adopt"],
      impact: IMPACT,
    });
    await expect(
      context.service.decideReview(
        {
          meta: meta("k-adopt-fail"),
          project_id: "project-1",
          run_id: context.runId,
          package_id: "package-sample",
          package_version: 1,
          plan_version: 1,
          input_digest: context.inputDigest,
          output_digest: "2".repeat(64),
          quality_digest: "3".repeat(64),
          choice: "accept_and_adopt",
          impact_id: IMPACT.impact_id,
          plan_sha256: IMPACT.plan_sha256,
        },
        TRUSTED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(adoption.approvals).toHaveLength(0);
  });

  it("refuses an adoption whose impact has expired", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    const expired = { ...IMPACT, expires_at: new Date((1794000000 - 60) * 1000).toISOString() };
    await publish(context, {
      package_id: "package-sample",
      kind: "sample",
      step_id: "sample",
      allowed_choices: ["accept", "accept_and_adopt"],
      impact: expired,
    });
    await expect(
      context.service.decideReview(
        {
          meta: meta("k-adopt-expired"),
          project_id: "project-1",
          run_id: context.runId,
          package_id: "package-sample",
          package_version: 1,
          plan_version: 1,
          input_digest: context.inputDigest,
          output_digest: "2".repeat(64),
          quality_digest: "3".repeat(64),
          choice: "accept_and_adopt",
          impact_id: expired.impact_id,
          plan_sha256: expired.plan_sha256,
        },
        TRUSTED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "IMPACT_STALE" });
  });

  it("refuses an adoption whose impact belongs to another project", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    const foreign = { ...IMPACT, project_id: "project-2" };
    await publish(context, {
      package_id: "package-sample",
      kind: "sample",
      step_id: "sample",
      allowed_choices: ["accept", "accept_and_adopt"],
      impact: foreign,
    });
    await expect(
      context.service.decideReview(
        {
          meta: meta("k-adopt-foreign"),
          project_id: "project-1",
          run_id: context.runId,
          package_id: "package-sample",
          package_version: 1,
          plan_version: 1,
          input_digest: context.inputDigest,
          output_digest: "2".repeat(64),
          quality_digest: "3".repeat(64),
          choice: "accept_and_adopt",
          impact_id: foreign.impact_id,
          plan_sha256: foreign.plan_sha256,
        },
        TRUSTED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "IMPACT_STALE" });
  });

  it("records the limited approval against the real attempt and the frozen change id", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample", 2);
    await publish(context, {
      package_id: "package-sample",
      kind: "sample",
      step_id: "sample",
      attempt: 2,
      allowed_choices: ["accept", "accept_and_adopt"],
      impact: IMPACT,
    });
    const decision = await context.service.decideReview(
      {
        meta: meta("k-adopt"),
        project_id: "project-1",
        run_id: context.runId,
        package_id: "package-sample",
        package_version: 1,
        plan_version: 1,
        input_digest: context.inputDigest,
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
    const approval = context.adoption.approvals[0];
    expect(approval?.step_id).toBe("sample");
    expect(approval?.attempt).toBe(2);
    expect(approval?.change_id).toBe(IMPACT.materialization_id);
    expect(approval?.state).toBe("active");
    expect(context.adoption.confirmations.some((row) => row.purpose === "change.approve")).toBe(true);
  });

  it("refuses a trusted confirmation that does not match the action", async () => {
    const adoption = new TestAdoptionAuthority();
    adoption.wrongPurpose = true;
    const context = await prepared({ adoption });
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample");
    await publish(context, {
      package_id: "package-sample",
      kind: "sample",
      step_id: "sample",
      allowed_choices: ["accept", "accept_and_adopt"],
      impact: IMPACT,
    });
    await expect(
      context.service.decideReview(
        {
          meta: meta("k-decide-wrong"),
          project_id: "project-1",
          run_id: context.runId,
          package_id: "package-sample",
          package_version: 1,
          plan_version: 1,
          input_digest: context.inputDigest,
          output_digest: "2".repeat(64),
          quality_digest: "3".repeat(64),
          choice: "accept_and_adopt",
          impact_id: IMPACT.impact_id,
          plan_sha256: IMPACT.plan_sha256,
        },
        TRUSTED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(adoption.approvals).toHaveLength(0);
  });

  it("guards a dispatch against the durable facts of the run", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    // A dispatch needs a live attempt, so both attempts are still running.
    await recordAttempt(context, grantId, "sample", 1, "running");
    await recordAttempt(context, grantId, "first_chapter", 1, "running");
    const binding = {
      run_id: context.runId,
      plan_version: 1 as const,
      step_id: "sample",
      attempt: 1,
      input_digest: context.inputDigest,
      run_scope_digest: context.scopeDigest,
      authorization_id: grantId,
    };
    const options = { project_id: "project-1", now: fixedClock };

    await expect(
      guardExecutionInTransaction(
        context.repository,
        binding,
        { kind: "action", action: "clip.prepare", stage_id: "sample" },
        "human-1",
        options,
      ),
    ).resolves.toBeUndefined();

    await expect(
      guardExecutionInTransaction(
        context.repository,
        binding,
        { kind: "action", action: "clip.prepare", stage_id: "sample" },
        "human-2",
        options,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await expect(
      guardExecutionInTransaction(
        context.repository,
        { ...binding, step_id: "first_chapter" },
        { kind: "action", action: "clip.prepare", stage_id: "first_chapter" },
        "human-1",
        options,
      ),
    ).rejects.toMatchObject({ code: "RUN_GATE_BLOCKED" });
  });

  it("shows the real attempts of the workflow nodes", async () => {
    const context = await prepared();
    const grantId = await authorized(context);
    await recordAttempt(context, grantId, "sample", 2);
    const workflow = await context.service.readWorkflow("project-1", RELAY_CALLER);
    expect(workflow.nodes.map((node) => node.node_id)).toEqual([
      "definition",
      "sample",
      "first_chapter",
      "chapters",
      "cover",
      "delivery",
    ]);
    const sample = workflow.nodes.find((node) => node.node_id === "sample");
    expect(sample?.attempt).toBe(2);
    expect(sample?.job_id).toBe("job-sample");
    expect(sample?.state).toBe("succeeded");
    const untouched = workflow.nodes.find((node) => node.node_id === "first_chapter");
    expect(untouched?.attempt).toBe(0);
    expect(untouched?.state).toBe("pending");
  });
});
