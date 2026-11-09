import { describe, expect, it } from "vitest";
import { CreativeService } from "../../../src/host/creative/creative-service.js";
import { creativeInputClosure } from "../../../src/host/creative/creative-closure.js";
import { canonicalDigest } from "../../../src/host/creative/digest.js";
import { ProductError } from "../../../src/host/creative/trusted-context.js";
import { MemoryProductRepository } from "./support/memory-repository.js";
import {
  BRIEF,
  fixedClock,
  FORGED_CALLER,
  meta,
  OTHER_RELAY_CALLER,
  RELAY_CALLER,
  TRUSTED_CALLER,
} from "./support/fixtures.js";

function newService(): { service: CreativeService; repository: MemoryProductRepository } {
  const repository = new MemoryProductRepository();
  const service = new CreativeService({ repository, now: fixedClock });
  return { service, repository };
}

async function intakeWithQuestion(): Promise<{
  service: CreativeService;
  repository: MemoryProductRepository;
  intakeId: string;
  briefSha: string;
}> {
  const { service, repository } = newService();
  const intake = await service.putIntake(
    { meta: meta("k-intake"), intake_id: null, base_version: 0, brief: BRIEF },
    RELAY_CALLER,
  );
  await service.putQuestion(
    {
      meta: meta("k-question"),
      intake_id: intake.intake_id,
      expected_intake_version: intake.version,
      question_id: null,
      expected_question_version: 0,
      input_digest: intake.brief_sha256,
      prompt: "主要面向哪些观众？",
      kind: "text",
      choices: [],
      skip_allowed: false,
    },
    RELAY_CALLER,
  );
  return { service, repository, intakeId: intake.intake_id, briefSha: intake.brief_sha256 };
}

describe("the creative service", () => {
  it("creates a brief version and refuses a second create of the same intake", async () => {
    const { service } = newService();
    const intake = await service.putIntake(
      { meta: meta("k-1"), intake_id: null, base_version: 0, brief: BRIEF },
      RELAY_CALLER,
    );
    expect(intake.version).toBe(1);
    expect(intake.brief_sha256).toBe(canonicalDigest(BRIEF));
    expect(intake.confirmed).toBe(false);
    expect(intake.next_actions).toContain("confirm_brief");

    await expect(
      service.putIntake(
        { meta: meta("k-2"), intake_id: intake.intake_id, base_version: 0, brief: BRIEF },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("moves the brief forward only against the current version", async () => {
    const { service } = newService();
    const first = await service.putIntake(
      { meta: meta("k-1"), intake_id: null, base_version: 0, brief: BRIEF },
      RELAY_CALLER,
    );
    const second = await service.putIntake(
      { meta: meta("k-2"), intake_id: first.intake_id, base_version: 1, brief: BRIEF },
      RELAY_CALLER,
    );
    expect(second.version).toBe(2);
    await expect(
      service.putIntake(
        { meta: meta("k-3"), intake_id: first.intake_id, base_version: 1, brief: BRIEF },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("replays a repeated request and refuses the same key with other content", async () => {
    const { service } = newService();
    const first = await service.putIntake(
      { meta: meta("k-1"), intake_id: null, base_version: 0, brief: BRIEF },
      RELAY_CALLER,
    );
    const replay = await service.putIntake(
      { meta: meta("k-1"), intake_id: null, base_version: 0, brief: BRIEF },
      RELAY_CALLER,
    );
    expect(replay.intake_id).toBe(first.intake_id);

    await expect(
      service.putIntake(
        {
          meta: meta("k-1"),
          intake_id: null,
          base_version: 0,
          brief: { ...BRIEF, topic: "另一个主题" },
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("binds a question to the brief version it was asked against", async () => {
    const { service, intakeId, briefSha } = await intakeWithQuestion();
    await expect(
      service.putQuestion(
        {
          meta: meta("k-question-stale"),
          intake_id: intakeId,
          expected_intake_version: 1,
          question_id: null,
          expected_question_version: 0,
          input_digest: "d".repeat(64),
          prompt: "另一个问题",
          kind: "text",
          choices: [],
          skip_allowed: false,
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(briefSha).toHaveLength(64);
  });

  it("refuses an answer whose answer version moved, and one that skips a required question", async () => {
    const { service, intakeId, briefSha } = await intakeWithQuestion();
    const question = (await service.readIntake({ intake_id: intakeId }, RELAY_CALLER)).questions[0];
    expect(question).toBeDefined();

    await expect(
      service.answerQuestion(
        {
          meta: meta("k-answer-bad-version"),
          intake_id: intakeId,
          expected_intake_version: 1,
          question_id: question?.question_id ?? "",
          question_version: question?.version ?? 1,
          input_digest: briefSha,
          expected_answer_version: 3,
          action: "answer_text",
          text: "普通观众",
          choice_id: null,
          source_message_ref: "message-1",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    await expect(
      service.answerQuestion(
        {
          meta: meta("k-answer-skip"),
          intake_id: intakeId,
          expected_intake_version: 1,
          question_id: question?.question_id ?? "",
          question_version: question?.version ?? 1,
          input_digest: briefSha,
          expected_answer_version: 0,
          action: "skip",
          text: null,
          choice_id: null,
          source_message_ref: "message-2",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("records an answer as content-only and never as an approval", async () => {
    const { service, intakeId, briefSha } = await intakeWithQuestion();
    const question = (await service.readIntake({ intake_id: intakeId }, RELAY_CALLER)).questions[0];
    const answer = await service.answerQuestion(
      {
        meta: meta("k-answer"),
        intake_id: intakeId,
        expected_intake_version: 1,
        question_id: question?.question_id ?? "",
        question_version: question?.version ?? 1,
        input_digest: briefSha,
        expected_answer_version: 0,
        action: "answer_text",
        text: "普通观众",
        choice_id: null,
        source_message_ref: "message-1",
      },
      RELAY_CALLER,
    );
    expect(answer.authority).toBe("content_only");
    expect(answer.source).toBe("driver_relay");
    expect(answer.state).toBe("current");
    expect(answer.supersedes_answer_id).toBeNull();
  });

  it("makes a changed answer invalidate the decision that was made on the old closure", async () => {
    const { service, repository, intakeId, briefSha } = await intakeWithQuestion();
    const question = (await service.readIntake({ intake_id: intakeId }, RELAY_CALLER)).questions[0];
    await service.answerQuestion(
      {
        meta: meta("k-answer-1"),
        intake_id: intakeId,
        expected_intake_version: 1,
        question_id: question?.question_id ?? "",
        question_version: question?.version ?? 1,
        input_digest: briefSha,
        expected_answer_version: 0,
        action: "answer_text",
        text: "普通观众",
        choice_id: null,
        source_message_ref: "message-1",
      },
      RELAY_CALLER,
    );
    const closureDigest = await repository.transaction((tx) =>
      canonicalDigest(creativeInputClosure(tx, intakeId, 1)),
    );

    const decision = await service.relayContentDecision(
      {
        meta: meta("k-relay"),
        project_id: null,
        intake_id: intakeId,
        intake_version: 1,
        input_digest: closureDigest,
        request_id: "request-1",
        choice: "accept_content",
        source: "driver_relay",
        source_message_ref: "message-1",
      },
      RELAY_CALLER,
    );
    expect(decision.authority).toBe("content_only");

    // A second answer changes the closure, so the decision above is stale.
    await service.answerQuestion(
      {
        meta: meta("k-answer-2"),
        intake_id: intakeId,
        expected_intake_version: 1,
        question_id: question?.question_id ?? "",
        question_version: question?.version ?? 1,
        input_digest: briefSha,
        expected_answer_version: 1,
        action: "answer_text",
        text: "有基础知识的专业观众",
        choice_id: null,
        source_message_ref: "message-2",
      },
      RELAY_CALLER,
    );

    await expect(
      service.relayContentDecision(
        {
          meta: meta("k-relay-2"),
          project_id: null,
          intake_id: intakeId,
          intake_version: 1,
          input_digest: closureDigest,
          request_id: "request-2",
          choice: "accept_content",
          source: "driver_relay",
          source_message_ref: "message-3",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "REVIEW_STALE" });
  });

  it("refuses a relay from a trusted UI session and a relay whose source does not match", async () => {
    const { service, repository, intakeId } = await intakeWithQuestion();
    const closureDigest = await repository.transaction((tx) =>
      canonicalDigest(creativeInputClosure(tx, intakeId, 1)),
    );
    await expect(
      service.relayContentDecision(
        {
          meta: meta("k-relay-trusted"),
          project_id: null,
          intake_id: intakeId,
          intake_version: 1,
          input_digest: closureDigest,
          request_id: "request-1",
          choice: "accept_content",
          source: "driver_relay",
          source_message_ref: "message-1",
        },
        TRUSTED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "ORIGIN_REJECTED" });

    await expect(
      service.relayContentDecision(
        {
          meta: meta("k-relay-mismatch"),
          project_id: null,
          intake_id: intakeId,
          intake_version: 1,
          input_digest: closureDigest,
          request_id: "request-2",
          choice: "accept_content",
          source: "agent_conversation",
          source_message_ref: "message-2",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "ORIGIN_REJECTED" });
  });

  it("refuses a caller context that the dispatcher did not mint", async () => {
    const { service } = newService();
    await expect(
      service.putIntake(
        { meta: meta("k-forged"), intake_id: null, base_version: 0, brief: BRIEF },
        FORGED_CALLER,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps the workbench answer on the trusted channel and refuses a relay caller", async () => {
    const { service, intakeId, briefSha } = await intakeWithQuestion();
    const question = (await service.readIntake({ intake_id: intakeId }, RELAY_CALLER)).questions[0];
    const answer = await service.answerQuestionFromUi(
      {
        meta: meta("k-answer-ui"),
        intake_id: intakeId,
        expected_intake_version: 1,
        question_id: question?.question_id ?? "",
        question_version: question?.version ?? 1,
        input_digest: briefSha,
        expected_answer_version: 0,
        action: "answer_text",
        text: "普通观众",
        choice_id: null,
        source_message_ref: null,
      },
      TRUSTED_CALLER,
    );
    expect(answer.source).toBe("trusted_ui");
    expect(answer.authority).toBe("content_only");

    await expect(
      service.answerQuestionFromUi(
        {
          meta: meta("k-answer-ui-2"),
          intake_id: intakeId,
          expected_intake_version: 1,
          question_id: question?.question_id ?? "",
          question_version: question?.version ?? 1,
          input_digest: briefSha,
          expected_answer_version: 1,
          action: "answer_text",
          text: "换一个答案",
          choice_id: null,
          source_message_ref: null,
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("confirms a brief only in a trusted session", async () => {
    const { service } = newService();
    const intake = await service.putIntake(
      { meta: meta("k-1"), intake_id: null, base_version: 0, brief: BRIEF },
      RELAY_CALLER,
    );
    await expect(
      service.confirmIntake(
        {
          meta: meta("k-confirm-relay"),
          intake_id: intake.intake_id,
          intake_version: intake.version,
          brief_sha256: intake.brief_sha256,
          choice: "confirm_brief",
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const decision = await service.confirmIntake(
      {
        meta: meta("k-confirm"),
        intake_id: intake.intake_id,
        intake_version: intake.version,
        brief_sha256: intake.brief_sha256,
        choice: "confirm_brief",
      },
      TRUSTED_CALLER,
    );
    expect(decision.choice).toBe("confirm_brief");
    const confirmed = await service.readIntake({ intake_id: intake.intake_id }, RELAY_CALLER);
    expect(confirmed.confirmed).toBe(true);
  });

  it("writes artifacts with a compare-and-set and replays the same request", async () => {
    const { service } = newService();
    const content = {
      kind: "script" as const,
      paragraphs: [{ paragraph_id: "p-1", text: "第一段。" }],
    };
    const first = await service.putArtifact(
      {
        meta: meta("k-artifact"),
        project_id: "project-1",
        artifact_id: null,
        base_version: 0,
        input_digest: "e".repeat(64),
        content,
        input_refs: [],
      },
      RELAY_CALLER,
    );
    expect(first.ref.version).toBe(1);

    const replay = await service.putArtifact(
      {
        meta: meta("k-artifact"),
        project_id: "project-1",
        artifact_id: null,
        base_version: 0,
        input_digest: "e".repeat(64),
        content,
        input_refs: [],
      },
      RELAY_CALLER,
    );
    expect(replay.ref.id).toBe(first.ref.id);
    expect(replay.ref.version).toBe(1);

    await expect(
      service.putArtifact(
        {
          meta: meta("k-artifact-2"),
          project_id: "project-1",
          artifact_id: first.ref.id,
          base_version: 0,
          input_digest: "e".repeat(64),
          content,
          input_refs: [],
        },
        RELAY_CALLER,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("reports the frozen error code and status for a lane failure", async () => {
    const { service } = newService();
    const failure = await service
      .readIntake({ intake_id: "missing" }, RELAY_CALLER)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProductError);
    expect((failure as ProductError).code).toBe("NOT_FOUND");
    expect((failure as ProductError).http_status).toBe(404);
  });

  it("scopes the idempotency receipt by principal", async () => {
    const { service } = newService();
    const first = await service.putIntake(
      { meta: meta("k-shared"), intake_id: null, base_version: 0, brief: BRIEF },
      RELAY_CALLER,
    );
    const second = await service.putIntake(
      { meta: meta("k-shared"), intake_id: null, base_version: 0, brief: BRIEF },
      OTHER_RELAY_CALLER,
    );
    expect(second.intake_id).not.toBe(first.intake_id);
  });
});
