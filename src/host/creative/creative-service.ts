/**
 * The PRODUCT lane's creative service: intake, questions, answers, relay decisions and
 * artifacts.
 *
 * Every write follows the same four rules:
 *
 * 1. **The request is validated before anything is read or written**, and the response is
 *    validated before it leaves. The validator is the frozen production one.
 * 2. **The input is bound to the durable facts.** A question binds the brief digest of the
 *    intake version it belongs to; an answer binds the exact question version. A stale
 *    binding is a conflict, not a silent overwrite.
 * 3. **The authority is content-only.** An answer or a relay decision may never grant an
 *    execution, an adoption or a project write. The `authority` field is written by this
 *    module, never taken from the request.
 * 4. **The replay returns the original answer.** Idempotency is recalled and recorded
 *    inside the same transaction as the write, and the stored response is what a replay
 *    returns, so a replayed answer keeps its original timestamp.
 */

import { randomUUID } from "node:crypto";
import type {
  Artifact,
  ArtifactPut,
  Brief,
  ContentDecision,
  ContentDecisionRelay,
  Decision,
  DecisionInput,
  Intake,
  IntakePut,
  IntakeRead,
  Question,
  QuestionAnswer,
  QuestionAnswerPut,
  QuestionPut,
} from "../../contracts/agent-driven-types.js";
import { validateAgentRouteInput, validateAgentRouteOutput } from "../../contracts/agent-driven-validator.js";
import { assertIntakeOwner, creativeInputClosure } from "./creative-closure.js";
import {
  briefDigest,
  canonicalDigest,
  canonicalJson,
  contentDigest,
  deterministicId,
  styleDigest,
} from "./digest.js";
import type {
  AnswerVersionRecord,
  ArtifactVersionRecord,
  IntakeVersionRecord,
  ProductIdempotencyReceipt,
  ProductRepository,
  ProductTransaction,
  QuestionVersionRecord,
  TrustedCallerContext,
} from "./product-repository.js";
import { nowEpochSeconds } from "./time.js";
import { isTrustedCallerContext, isTrustedUi, ProductError } from "./trusted-context.js";

/** The operations the lane records idempotency receipts for. */
export const CREATIVE_OPERATIONS = {
  intakePut: "creative.intake.put",
  questionPut: "creative.question.put",
  questionAnswer: "creative.question.answer",
  contentRelay: "creative.content.relay",
  artifactPut: "creative.artifact.put",
  intakeConfirm: "creative.intake.confirm",
} as const;

export interface CreativeServiceOptions {
  readonly repository: ProductRepository;
  /** The clock, in epoch seconds. Overridable so tests are deterministic. */
  readonly now?: () => number;
  /** MAIN supplies same-transaction ownership/lineage authority before production registration. */
  readonly contentAuthority?: (tx: ProductTransaction, input: ContentDecisionRelay, caller: TrustedCallerContext) => void;
  readonly artifactAuthority?: (tx: ProductTransaction, input: ArtifactPut, caller: TrustedCallerContext, phase: "access" | "write") => void;
}

export class CreativeService {
  readonly #repository: ProductRepository;
  readonly #now: () => number;
  readonly #contentAuthority: CreativeServiceOptions["contentAuthority"];
  readonly #artifactAuthority: CreativeServiceOptions["artifactAuthority"];

  constructor(options: CreativeServiceOptions) {
    this.#repository = options.repository;
    this.#now = options.now ?? nowEpochSeconds;
    this.#artifactAuthority = options.artifactAuthority;
    this.#contentAuthority = options.contentAuthority;
  }

  /* ------------------------------------------------------------------------------------ */
  /* Intake                                                                                */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Writes a brief version.
   *
   * `base_version` is a compare-and-set against the intake head: `0` creates the intake,
   * any other value has to match the current version exactly.
   */
  async putIntake(input: IntakePut, caller: TrustedCallerContext): Promise<Intake> {
    const request = validateAgentRouteInput("intake.put", input);
    this.#requireAuthenticated(caller);
    const receipt = this.#receipt(CREATIVE_OPERATIONS.intakePut, caller, request.meta, contentDigest(request));
    const digest = contentDigest(request);

    return this.#repository.transaction((tx) => {
      const stored = tx.recallIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.intakePut,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput("intake.put", stored.response) as Intake;
      }

      assertBriefConsistency(request.brief);
      const briefSha = briefDigest(request.brief);
      const now = this.#now();
      const createdAt = new Date(now * 1000).toISOString();

      let intakeId: string;
      let version: number;
      let expectedHeadVersion: number;

      if (request.intake_id === null) {
        intakeId = `intake-${randomUUID()}`;
        version = 1;
        expectedHeadVersion = 0;
        if (request.base_version !== 0) {
          throw new ProductError("REVISION_CONFLICT", "A new intake has to start at version 0", {
            details: { base_version: request.base_version },
          });
        }
      } else {
        intakeId = request.intake_id;
        const head = tx.get("intake_head", { intake_id: intakeId });
        const current = head?.current_version ?? 0;
        if (current !== request.base_version) {
          throw new ProductError("REVISION_CONFLICT", "The brief was changed by someone else", {
            details: { expected: request.base_version, actual: current },
          });
        }
        const owner = tx.get("intake_version", { intake_id: intakeId, version: current });
        if (owner === null) {
          throw new ProductError("NOT_FOUND", "The intake head points at a missing brief version");
        }
        if (owner.principal_id !== caller.principal_id) {
          throw new ProductError("UNAUTHORIZED", "The brief belongs to another principal", {
            details: { intake_id: intakeId },
          });
        }
        if (owner.input_digest === briefSha) {
          // The brief did not change. Writing it again would advance the version and make
          // every question, answer and decision that binds the old digest stale for no
          // reason, so the head stays where it is.
          const unchanged = this.#projectIntake(tx, intakeId, current);
          tx.recordIdempotency(
            { kind: "principal", principal_id: caller.principal_id },
            CREATIVE_OPERATIONS.intakePut,
            request.meta.idempotency_key,
            receipt,
            unchanged,
          );
          return unchanged;
        }
        expectedHeadVersion = request.base_version;
        version = request.base_version + 1;
      }

      const record: IntakeVersionRecord = {
        intake_id: intakeId,
        version,
        principal_id: caller.principal_id,
        input_digest: briefSha,
        content_json: request.brief,
        created_at: createdAt,
      };
      tx.put("intake_version", { intake_id: intakeId, version }, record);
      tx.compareAndSet("intake_head", { intake_id: intakeId }, expectedHeadVersion, {
        intake_id: intakeId,
        current_version: version,
      });

      tx.emit({
        topic: "creative.intake.versioned",
        source: "host",
        scope: {
          kind: "intake",
          intake_id: intakeId,
          intake_version: version,
          brief_sha256: briefSha,
        },
        entity: { type: "project", id: intakeId, version, state: "intake_versioned" },
        attempt: 0,
        input_digest: briefSha,
        observed_at: createdAt,
        payload: { intake_id: intakeId, intake_version: version, brief_sha256: briefSha },
      });

      const intake = this.#projectIntake(tx, intakeId, version);
      tx.recordIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.intakePut,
        request.meta.idempotency_key,
        receipt,
        intake,
      );
      return intake;
    });
  }

  /** Reads an intake with its current questions and current answers. */
  async readIntake(input: IntakeRead, caller: TrustedCallerContext): Promise<Intake> {
    const request = validateAgentRouteInput("intake.read", input);
    this.#requireAuthenticated(caller);
    return this.#repository.transaction((tx) => {
      assertIntakeOwner(tx, request.intake_id, caller.principal_id);
      const head = tx.get("intake_head", { intake_id: request.intake_id });
      if (head === null) {
        throw new ProductError("NOT_FOUND", "No such intake", {
          details: { intake_id: request.intake_id },
        });
      }
      return this.#projectIntake(tx, request.intake_id, head.current_version);
    });
  }

  /**
   * Confirms a brief in the trusted UI.
   *
   * This is a content confirmation, not an adoption: it produces a `Decision` and the
   * `cp_a0_intake_confirmation` row that `project.create` has to reference. It grants no
   * execution authority and no external side effect.
   *
   * The row is written here rather than by MAIN's adoption authority because the
   * authority that matters is the caller context itself: only a trusted UI session, which
   * only MAIN's dispatcher can mint, reaches this method.
   */
  async confirmIntake(input: DecisionInput, caller: TrustedCallerContext): Promise<Decision> {
    const request = validateAgentRouteInput("intake.confirm", input);
    this.#requireTrustedUi(caller);
    const digest = contentDigest(request);

    return this.#repository.transaction((tx) => {
      assertIntakeOwner(tx, request.intake_id, caller.principal_id);
      const stored = tx.recallIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.intakeConfirm,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput("intake.confirm", stored.response) as Decision;
      }

      const version = tx.get("intake_version", {
        intake_id: request.intake_id,
        version: request.intake_version,
      });
      if (version === null) {
        throw new ProductError("NOT_FOUND", "No such brief version", {
          details: { intake_id: request.intake_id, intake_version: request.intake_version },
        });
      }
      if (version.input_digest !== request.brief_sha256) {
        throw new ProductError("REVISION_CONFLICT", "The confirmation is bound to a different brief", {
          details: { expected: version.input_digest, received: request.brief_sha256 },
        });
      }
      if (request.choice !== "confirm_brief") {
        throw new ProductError("INVALID_REQUEST", "Only a brief confirmation is accepted here");
      }

      const issuedAt = this.#now();
      const expiresAt = issuedAt + 900;
      const confirmationId = `intake-confirmation-${randomUUID()}`;
      tx.put("intake_confirmation", { confirmation_id: confirmationId }, {
        confirmation_id: confirmationId,
        intake_id: request.intake_id,
        intake_version: request.intake_version,
        input_digest: request.brief_sha256,
        principal_id: caller.principal_id,
        channel: "trusted_ui",
        session_ref: caller.session_ref,
        action: "project.create",
        issued_at: issuedAt,
        expires_at: expiresAt,
      });

      const decision: Decision = {
        decision_id: confirmationId,
        intake_id: request.intake_id,
        intake_version: request.intake_version,
        brief_sha256: request.brief_sha256,
        choice: request.choice,
        issued_at: new Date(issuedAt * 1000).toISOString(),
        expires_at: new Date(expiresAt * 1000).toISOString(),
      };
      const receipt = this.#receipt(CREATIVE_OPERATIONS.intakeConfirm, caller, request.meta, digest);
      tx.recordIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.intakeConfirm,
        request.meta.idempotency_key,
        receipt,
        decision,
      );
      return decision;
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* Questions and answers                                                                */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Writes a question version.
   *
   * A new question needs `question_id = null` and `expected_question_version = 0`; an
   * edit needs the exact current version. The question binds the brief digest of the
   * intake version it belongs to, so a brief change makes the question stale.
   */
  async putQuestion(input: QuestionPut, caller: TrustedCallerContext): Promise<Question> {
    const request = validateAgentRouteInput("question.put", input);
    this.#requireAuthenticated(caller);
    const digest = contentDigest(request);

    return this.#repository.transaction((tx) => {
      assertIntakeOwner(tx, request.intake_id, caller.principal_id);
      const stored = tx.recallIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.questionPut,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput("question.put", stored.response) as Question;
      }

      const head = tx.get("intake_head", { intake_id: request.intake_id });
      const intakeVersion = head?.current_version ?? 0;
      if (intakeVersion !== request.expected_intake_version) {
        throw new ProductError("REVISION_CONFLICT", "The brief changed after this question was prepared", {
          details: { expected: request.expected_intake_version, actual: intakeVersion },
        });
      }
      const version = tx.get("intake_version", {
        intake_id: request.intake_id,
        version: request.expected_intake_version,
      });
      if (version === null) {
        throw new ProductError("NOT_FOUND", "No such brief version");
      }
      if (version.input_digest !== request.input_digest) {
        throw new ProductError("REVISION_CONFLICT", "The question is bound to a different brief", {
          details: { expected: version.input_digest, received: request.input_digest },
        });
      }

      let questionId: string;
      let questionVersion: number;
      let expectedQuestionVersion: number;
      if (request.question_id === null) {
        if (request.expected_question_version !== 0) {
          throw new ProductError("REVISION_CONFLICT", "A new question has to start at version 0");
        }
        questionId = `q-${randomUUID()}`;
        questionVersion = 1;
        expectedQuestionVersion = 0;
      } else {
        questionId = request.question_id;
        const questionHead = tx.get("question_head", {
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          question_id: questionId,
        });
        const current = questionHead?.current_question_version ?? 0;
        if (current !== request.expected_question_version) {
          throw new ProductError("REVISION_CONFLICT", "The question was changed by someone else", {
            details: { expected: request.expected_question_version, actual: current },
          });
        }
        expectedQuestionVersion = request.expected_question_version;
        questionVersion = request.expected_question_version + 1;
      }

      const now = this.#now();
      const createdAt = new Date(now * 1000).toISOString();
      const record: QuestionVersionRecord = {
        intake_id: request.intake_id,
        intake_version: request.expected_intake_version,
        input_digest: request.input_digest,
        question_id: questionId,
        question_version: questionVersion,
        kind: request.kind,
        skip_allowed: request.skip_allowed ? 1 : 0,
        question_json: {
          question_id: questionId,
          version: questionVersion,
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          input_digest: request.input_digest,
          prompt: request.prompt,
          kind: request.kind,
          choices: request.choices,
          skip_allowed: request.skip_allowed,
          state: "open",
        },
        created_at: createdAt,
      };
      tx.put(
        "question_version",
        {
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          question_id: questionId,
          question_version: questionVersion,
        },
        record,
      );
      tx.compareAndSet(
        "question_head",
        {
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          question_id: questionId,
        },
        expectedQuestionVersion,
        {
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          question_id: questionId,
          current_question_version: questionVersion,
        },
      );

      tx.emit({
        topic: "creative.question.versioned",
        source: "host",
        scope: {
          kind: "intake",
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          brief_sha256: request.input_digest,
        },
        entity: { type: "project", id: questionId, version: questionVersion, state: "question_versioned" },
        attempt: 0,
        input_digest: request.input_digest,
        observed_at: createdAt,
        payload: {
          intake_id: request.intake_id,
          question_id: questionId,
          question_version: questionVersion,
        },
      });

      const question = validateAgentRouteOutput("question.put", {
        ...record.question_json,
        state: "open",
      }) as Question;
      const receipt = this.#receipt(CREATIVE_OPERATIONS.questionPut, caller, request.meta, digest);
      tx.recordIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.questionPut,
        request.meta.idempotency_key,
        receipt,
        question,
      );
      return question;
    });
  }

  /**
   * Records an answer from an ordinary authenticated session.
   *
   * The source comes from the caller context, never from the request body: a client
   * cannot claim to be the workbench UI.
   */
  async answerQuestion(input: QuestionAnswerPut, caller: TrustedCallerContext): Promise<QuestionAnswer> {
    if (caller.source === "trusted_ui") {
      throw new ProductError(
        "ORIGIN_REJECTED",
        "A trusted UI session has to use the workbench answer route",
      );
    }
    return this.#answer(input, caller, "question.answer");
  }

  /** Records an answer from the workbench. The source is `trusted_ui`. */
  async answerQuestionFromUi(
    input: QuestionAnswerPut,
    caller: TrustedCallerContext,
  ): Promise<QuestionAnswer> {
    this.#requireTrustedUi(caller);
    return this.#answer(input, caller, "question.answer.ui");
  }

  async #answer(
    input: QuestionAnswerPut,
    caller: TrustedCallerContext,
    route: "question.answer" | "question.answer.ui",
  ): Promise<QuestionAnswer> {
    const request = validateAgentRouteInput(route, input);
    this.#requireAuthenticated(caller);
    const digest = contentDigest(request);

    return this.#repository.transaction((tx) => {
      assertIntakeOwner(tx, request.intake_id, caller.principal_id);
      const stored = tx.recallIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.questionAnswer,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput(route, stored.response) as QuestionAnswer;
      }

      const intakeHead = tx.get("intake_head", { intake_id: request.intake_id });
      const intakeVersion = intakeHead?.current_version ?? 0;
      if (intakeVersion !== request.expected_intake_version) {
        throw new ProductError("REVISION_CONFLICT", "The brief changed after this question was asked", {
          details: { expected: request.expected_intake_version, actual: intakeVersion },
        });
      }

      const questionHead = tx.get("question_head", {
        intake_id: request.intake_id,
        intake_version: request.expected_intake_version,
        question_id: request.question_id,
      });
      const questionVersion = questionHead?.current_question_version ?? 0;
      if (questionVersion !== request.question_version) {
        throw new ProductError("REVISION_CONFLICT", "The question was changed after this question was asked", {
          details: { expected: request.question_version, actual: questionVersion },
        });
      }
      const question = tx.get("question_version", {
        intake_id: request.intake_id,
        intake_version: request.expected_intake_version,
        question_id: request.question_id,
        question_version: request.question_version,
      });
      if (question === null) {
        throw new ProductError("NOT_FOUND", "No such question version");
      }
      if (question.input_digest !== request.input_digest) {
        throw new ProductError("REVISION_CONFLICT", "The answer is bound to a different brief", {
          details: { expected: question.input_digest, received: request.input_digest },
        });
      }

      const answerHead = tx.get("answer_head", {
        intake_id: request.intake_id,
        intake_version: request.expected_intake_version,
        question_id: request.question_id,
        question_version: request.question_version,
      });
      const currentAnswerVersion = answerHead?.current_answer_version ?? 0;
      if (currentAnswerVersion !== request.expected_answer_version) {
        throw new ProductError("REVISION_CONFLICT", "The answer was changed by someone else", {
          details: { expected: request.expected_answer_version, actual: currentAnswerVersion },
        });
      }

      this.#assertAnswerShape(request, question);

      const now = this.#now();
      const recordedAt = new Date(now * 1000).toISOString();
      const previous = currentAnswerVersion === 0
        ? undefined
        : tx.get("answer_version", {
            intake_id: request.intake_id,
            intake_version: request.expected_intake_version,
            question_id: request.question_id,
            question_version: request.question_version,
            answer_version: currentAnswerVersion,
          });
      const answerId = previous?.answer_id ?? `answer-${randomUUID()}`;
      const answerVersion = currentAnswerVersion + 1;

      const answerDocument: QuestionAnswer = {
        answer_id: answerId,
        version: answerVersion,
        intake_id: request.intake_id,
        intake_version: request.expected_intake_version,
        question_id: request.question_id,
        question_version: request.question_version,
        input_digest: request.input_digest,
        action: request.action,
        text: request.text,
        choice_id: request.choice_id,
        source: caller.source,
        source_message_ref: request.source_message_ref,
        authority: "content_only",
        state: "current",
        supersedes_answer_id: previous?.answer_id ?? null,
        recorded_at: recordedAt,
      };

      const record: AnswerVersionRecord = {
        intake_id: request.intake_id,
        intake_version: request.expected_intake_version,
        question_id: request.question_id,
        question_version: request.question_version,
        answer_id: answerId,
        answer_version: answerVersion,
        input_digest: request.input_digest,
        principal_id: caller.principal_id,
        channel: caller.source,
        authority: "content_only",
        skipped: request.action === "skip" ? 1 : 0,
        answer_json: answerDocument,
        recorded_at: recordedAt,
      };
      tx.put(
        "answer_version",
        {
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          question_id: request.question_id,
          question_version: request.question_version,
          answer_version: answerVersion,
        },
        record,
      );
      tx.compareAndSet(
        "answer_head",
        {
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          question_id: request.question_id,
          question_version: request.question_version,
        },
        currentAnswerVersion,
        {
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          question_id: request.question_id,
          question_version: request.question_version,
          current_answer_version: answerVersion,
        },
      );

      const closure = creativeInputClosure(tx, request.intake_id, request.expected_intake_version);
      const closureDigest = canonicalDigest(closure);
      tx.emit({
        topic: "creative.answer.recorded",
        source: "host",
        scope: {
          kind: "intake",
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          brief_sha256: request.input_digest,
        },
        entity: {
          type: "project",
          id: request.question_id,
          version: answerVersion,
          state: "answer_recorded",
        },
        attempt: 0,
        input_digest: request.input_digest,
        observed_at: recordedAt,
        payload: {
          intake_id: request.intake_id,
          question_id: request.question_id,
          answer_id: answerId,
          answer_version: answerVersion,
          action: request.action,
        },
      });
      // The closure changed, so every decision and every prepared artifact that was made
      // against the old closure is now stale. The invalidation and the outbox row belong
      // to the same transaction as the answer.
      tx.emit({
        topic: "creative.input.invalidated",
        source: "host",
        scope: {
          kind: "intake",
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          brief_sha256: request.input_digest,
        },
        entity: {
          type: "decision",
          id: request.intake_id,
          version: request.expected_intake_version,
          state: "input_invalidated",
        },
        attempt: 0,
        input_digest: closureDigest,
        observed_at: recordedAt,
        payload: {
          intake_id: request.intake_id,
          intake_version: request.expected_intake_version,
          closure_digest: closureDigest,
          reason: "answer_changed",
        },
      });

      const receipt = this.#receipt(CREATIVE_OPERATIONS.questionAnswer, caller, request.meta, digest);
      tx.recordIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.questionAnswer,
        request.meta.idempotency_key,
        receipt,
        answerDocument,
      );
      return answerDocument;
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* Relay decision                                                                       */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Records a relay content decision.
   *
   * The decision is content-only. It may start a run later, but it grants no execution
   * authority, no adoption and no external side effect — a relay is not a trusted
   * confirmation and never becomes one.
   */
  async relayContentDecision(
    input: ContentDecisionRelay,
    caller: TrustedCallerContext,
  ): Promise<ContentDecision> {
    const request = validateAgentRouteInput("content.relay", input);
    this.#requireAuthenticated(caller);
    if (caller.source === "trusted_ui") {
      throw new ProductError(
        "ORIGIN_REJECTED",
        "A trusted UI decision is not a relay decision",
      );
    }
    if (caller.source !== request.source) {
      throw new ProductError("ORIGIN_REJECTED", "The relay source does not match the caller", {
        details: { expected: request.source, actual: caller.source },
      });
    }
    const digest = contentDigest(request);

    return this.#repository.transaction((tx) => {
      assertIntakeOwner(tx, request.intake_id, caller.principal_id);
      this.#contentAuthority?.(tx, request, caller);
      const stored = tx.recallIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.contentRelay,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput("content.relay", stored.response) as ContentDecision;
      }

      const closure = creativeInputClosure(tx, request.intake_id, request.intake_version);
      const closureDigest = canonicalDigest(closure);
      if (closureDigest !== request.input_digest) {
        throw new ProductError("REVIEW_STALE", "The decision was made against a different input", {
          details: { expected: closureDigest, received: request.input_digest },
        });
      }

      const now = this.#now();
      const recordedAt = new Date(now * 1000).toISOString();
      const decisionId = deterministicId("content-decision", [
        request.intake_id,
        String(request.intake_version),
        request.request_id,
      ]);

      const record = {
        decision_id: decisionId,
        intake_id: request.intake_id,
        intake_version: request.intake_version,
        request_id: request.request_id,
        input_digest: request.input_digest,
        choice: request.choice,
        source: request.source,
        source_message_ref: request.source_message_ref,
        authority: "content_only" as const,
        recorded_at: recordedAt,
      };
      tx.put("intake_content_decision", { decision_id: decisionId }, record);

      tx.emit({
        topic: "creative.content.decision.recorded",
        source: "host",
        scope: {
          kind: "intake",
          intake_id: request.intake_id,
          intake_version: request.intake_version,
          brief_sha256: closure.brief_sha256,
        },
        entity: { type: "decision", id: decisionId, version: request.intake_version, state: request.choice },
        attempt: 0,
        input_digest: request.input_digest,
        observed_at: recordedAt,
        payload: {
          decision_id: decisionId,
          intake_id: request.intake_id,
          intake_version: request.intake_version,
          choice: request.choice,
          request_id: request.request_id,
        },
      });

      const decision = validateAgentRouteOutput("content.relay", {
        decision_id: decisionId,
        project_id: request.project_id,
        intake_id: request.intake_id,
        intake_version: request.intake_version,
        input_digest: request.input_digest,
        request_id: request.request_id,
        choice: request.choice,
        source: request.source,
        source_message_ref: request.source_message_ref,
        recorded_at: recordedAt,
        authority: "content_only",
      }) as ContentDecision;

      const receipt = this.#receipt(CREATIVE_OPERATIONS.contentRelay, caller, request.meta, digest);
      tx.recordIdempotency(
        { kind: "principal", principal_id: caller.principal_id },
        CREATIVE_OPERATIONS.contentRelay,
        request.meta.idempotency_key,
        receipt,
        decision,
      );
      return decision;
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* Artifacts                                                                             */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Writes an artifact version.
   *
   * The version is `base_version + 1` and the head moves by compare-and-set, so two
   * concurrent writers produce one winner and one conflict. A replay of the same request
   * returns the original artifact.
   */
  async putArtifact(input: ArtifactPut, caller: TrustedCallerContext): Promise<Artifact> {
    const request = validateAgentRouteInput("artifact.put", input);
    this.#requireAuthenticated(caller);
    const digest = contentDigest(request);

    return this.#repository.transaction((tx) => {
      this.#artifactAuthority?.(tx, request, caller, "access");
      const stored = tx.recallIdempotency(
        { kind: "project", project_id: request.project_id },
        CREATIVE_OPERATIONS.artifactPut,
        request.meta.idempotency_key,
      );
      if (stored !== null) {
        this.#assertSameRequest(stored.receipt, digest);
        return validateAgentRouteOutput("artifact.put", stored.response) as Artifact;
      }

      this.#artifactAuthority?.(tx, request, caller, "write");

      let artifactId: string;
      let expectedVersion: number;
      if (request.artifact_id === null) {
        artifactId = `artifact-${randomUUID()}`;
        expectedVersion = 0;
        if (request.base_version !== 0) {
          throw new ProductError("REVISION_CONFLICT", "A new artifact has to start at version 0");
        }
      } else {
        artifactId = request.artifact_id;
        const head = tx.get("artifact_head", {
          project_id: request.project_id,
          artifact_id: artifactId,
        });
        const current = head?.draft_version ?? 0;
        if (current !== request.base_version) {
          throw new ProductError("REVISION_CONFLICT", "The artifact was changed by someone else", {
            details: { expected: request.base_version, actual: current },
          });
        }
        expectedVersion = request.base_version;
      }

      const version = expectedVersion + 1;
      const now = this.#now();
      const createdAt = new Date(now * 1000).toISOString();
      const contentDigestValue = canonicalDigest(request.content);

      const record: ArtifactVersionRecord = {
        project_id: request.project_id,
        artifact_id: artifactId,
        version,
        kind: request.content.kind,
        schema_version: 1,
        input_digest: request.input_digest,
        content_digest: contentDigestValue,
        content_json: request.content,
        input_refs_json: request.input_refs,
        created_at: createdAt,
      };
      tx.put("artifact_version", {
        project_id: request.project_id,
        artifact_id: artifactId,
        version,
      }, record);
      tx.compareAndSet(
        "artifact_head",
        { project_id: request.project_id, artifact_id: artifactId },
        expectedVersion,
        { project_id: request.project_id, artifact_id: artifactId, draft_version: version },
      );

      tx.emit({
        topic: "creative.artifact.versioned",
        source: "host",
        scope: { kind: "project", project_id: request.project_id },
        entity: { type: "artifact", id: artifactId, version, state: "versioned" },
        attempt: 0,
        input_digest: request.input_digest,
        observed_at: createdAt,
        payload: {
          project_id: request.project_id,
          artifact_id: artifactId,
          version,
          content_digest: contentDigestValue,
        },
      });

      const artifact = validateAgentRouteOutput("artifact.put", {
        project_id: request.project_id,
        ref: { id: artifactId, version, sha256: contentDigestValue },
        input_digest: request.input_digest,
        content: request.content,
        created_at: createdAt,
        input_refs: request.input_refs,
      }) as Artifact;

      const receipt = { ...this.#receipt(CREATIVE_OPERATIONS.artifactPut, caller, request.meta, digest), project_id: request.project_id };
      tx.recordIdempotency(
        { kind: "project", project_id: request.project_id },
        CREATIVE_OPERATIONS.artifactPut,
        request.meta.idempotency_key,
        receipt,
        artifact,
      );
      return artifact;
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* Internals                                                                            */
  /* ------------------------------------------------------------------------------------ */

  /** The `Intake` projection of an intake version. */
  #projectIntake(tx: ProductTransaction, intakeId: string, intakeVersion: number): Intake {
    const version = tx.get("intake_version", { intake_id: intakeId, version: intakeVersion });
    if (version === null) {
      throw new ProductError("NOT_FOUND", "No such brief version", {
        details: { intake_id: intakeId, intake_version: intakeVersion },
      });
    }
    const heads = tx.list("question_head", { intake_id: intakeId, intake_version: intakeVersion });
    const questions: Question[] = [];
    const currentAnswers: QuestionAnswer[] = [];
    const sorted = [...heads].sort((left, right) =>
      left.question_id < right.question_id ? -1 : left.question_id > right.question_id ? 1 : 0,
    );
    for (const head of sorted) {
      const question = tx.get("question_version", {
        intake_id: intakeId,
        intake_version: intakeVersion,
        question_id: head.question_id,
        question_version: head.current_question_version,
      });
      if (question === null) continue;
      const answerHead = tx.get("answer_head", {
        intake_id: intakeId,
        intake_version: intakeVersion,
        question_id: head.question_id,
        question_version: head.current_question_version,
      });
      let state: Question["state"] = "open";
      let answer: QuestionAnswer | null = null;
      if (answerHead !== null) {
        const record = tx.get("answer_version", {
          intake_id: intakeId,
          intake_version: intakeVersion,
          question_id: head.question_id,
          question_version: head.current_question_version,
          answer_version: answerHead.current_answer_version,
        });
        if (record !== null) {
          answer = { ...record.answer_json, state: "current" };
          state = record.skipped === 1 ? "skipped" : "answered";
          currentAnswers.push(answer);
        }
      }
      questions.push({ ...question.question_json, state });
    }

    const confirmation = tx.list("intake_confirmation", { intake_id: intakeId })
      .some((row) => row.intake_version === intakeVersion);
    const nextActions: string[] = [];
    if (!confirmation) nextActions.push("confirm_brief");
    if (questions.some((question) => question.state === "open")) nextActions.push("answer_questions");
    if (confirmation && !questions.some((question) => question.state === "open")) {
      nextActions.push("create_project");
    }

    const intake: Intake = {
      intake_id: intakeId,
      version: intakeVersion,
      brief: version.content_json,
      brief_sha256: version.input_digest,
      confirmed: confirmation,
      next_actions: nextActions.slice(0, 8),
      questions,
      current_answers: currentAnswers,
    };
    return validateAgentRouteOutput("intake.read", intake) as Intake;
  }

  #assertAnswerShape(request: QuestionAnswerPut, question: QuestionVersionRecord): void {
    if (request.action === "answer_text") {
      if (request.text === null || request.choice_id !== null) {
        throw new ProductError("INVALID_REQUEST", "A text answer needs text and no choice");
      }
      return;
    }
    if (request.action === "answer_choice") {
      if (request.choice_id === null || request.text !== null) {
        throw new ProductError("INVALID_REQUEST", "A choice answer needs a choice and no text");
      }
      const choices = question.question_json.choices;
      if (!choices.some((choice) => choice.choice_id === request.choice_id)) {
        throw new ProductError("INVALID_REQUEST", "That choice does not belong to this question", {
          details: { choice_id: request.choice_id },
        });
      }
      return;
    }
    if (request.text !== null || request.choice_id !== null) {
      throw new ProductError("INVALID_REQUEST", "A skipped question carries neither text nor choice");
    }
    if (question.skip_allowed !== 1) {
      throw new ProductError("INVALID_REQUEST", "This question cannot be skipped");
    }
  }

  #receipt(
    operation: string,
    caller: TrustedCallerContext,
    meta: { idempotency_key: string; correlation_id: string },
    digest: string,
  ): ProductIdempotencyReceipt {
    return {
      operation,
      principal_id: caller.principal_id,
      project_id: null,
      idempotency_key: meta.idempotency_key,
      request_digest: digest,
      correlation_id: meta.correlation_id,
    };
  }

  #assertSameRequest(stored: ProductIdempotencyReceipt, digest: string): void {
    if (stored.request_digest !== digest) {
      throw new ProductError("IDEMPOTENCY_CONFLICT", "This idempotency key was used with a different request", {
        details: { expected: stored.request_digest, received: digest },
      });
    }
  }

  #requireAuthenticated(caller: TrustedCallerContext): void {
    this.#requireContext(caller);
    if (caller.channel === "native_bridge") {
      throw new ProductError("ORIGIN_REJECTED", "The native bridge cannot call this route");
    }
  }

  #requireTrustedUi(caller: TrustedCallerContext): void {
    this.#requireContext(caller);
    if (!isTrustedUi(caller)) {
      throw new ProductError("UNAUTHORIZED", "This route needs a trusted user session");
    }
  }

  /**
   * The runtime brand check.
   *
   * The type already says the context was minted by the dispatcher, but a request body
   * that was cast to the type would still carry no brand, and a context that cannot be
   * traced to an authenticated session must not be trusted.
   */
  #requireContext(caller: TrustedCallerContext): void {
    if (!isTrustedCallerContext(caller)) {
      throw new ProductError("UNAUTHORIZED", "The caller context was not minted by the dispatcher");
    }
  }
}

/**
 * Checks that a brief agrees with itself.
 *
 * Three things are checked, and all three are facts the lane owns:
 *
 * - the material strategy's asset list is the brief's local asset list, and its narration
 *   is the brief's narration. A brief that names one set of assets and authorizes
 *   another is not a brief anybody can act on;
 * - the style digest is the digest of the style's own fields. The client's digest is a
 *   claim; the recomputed one is the fact.
 *
 * Whether the material is actually licensed is not the lane's to decide — that is MAIN's
 * project fact, and the run preparation asks for it through the fact port.
 */
export function assertBriefConsistency(brief: Brief): void {
  const strategy = brief.content_brief.material_strategy;
  const assets = [...strategy.asset_ids].sort();
  const local = [...brief.local_asset_ids].sort();
  if (canonicalJson(assets) !== canonicalJson(local)) {
    throw new ProductError("INVALID_REQUEST", "The material strategy and the brief name different assets", {
      details: { material_assets: assets, brief_assets: local },
    });
  }
  if (strategy.narration_asset_id !== brief.narration_asset_id) {
    throw new ProductError("INVALID_REQUEST", "The material strategy and the brief name different narrations");
  }
  if (strategy.mode !== "authorized_local_only") {
    throw new ProductError("INVALID_REQUEST", "Only the authorized local material strategy is available", {
      details: { mode: strategy.mode },
    });
  }
  const style = brief.content_brief.style;
  const recomputed = styleDigest(style);
  if (style.style_digest !== recomputed) {
    throw new ProductError("INVALID_REQUEST", "The style digest does not match the style it names", {
      details: { expected: recomputed, received: style.style_digest },
    });
  }
}
