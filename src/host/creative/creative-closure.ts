/**
 * The creative input closure.
 *
 * The closure is what a content decision and a run actually bind to: the brief version,
 * plus every current question of that intake version with the version of its current
 * answer. Its digest is deliberately *not* the brief digest — a new answer changes the
 * closure while the brief is untouched, and a decision made against the old closure must
 * not be able to start a run.
 *
 * The questions are the current heads of the intake version, sorted by ascending question
 * id, and every one of them is listed even when it has no answer. A question without an
 * answer is registered with `answer: null`; dropping it would let an unanswered question
 * change the closure without changing the digest.
 */

import type { CreativeInputClosure, Brief, Question, QuestionAnswer } from "../../contracts/agent-driven-types.js";
import { validateAgentDefinition } from "../../contracts/agent-driven-validator.js";
import { canonicalDigest } from "./digest.js";
import type { ProductTransaction } from "./product-repository.js";
import { ProductError } from "./trusted-context.js";

/** The closure of an intake version. */
export function creativeInputClosure(
  tx: ProductTransaction,
  intakeId: string,
  intakeVersion: number,
): CreativeInputClosure {
  const version = tx.get("intake_version", { intake_id: intakeId, version: intakeVersion });
  if (version === null) {
    throw new ProductError("NOT_FOUND", "No such brief version", {
      details: { intake_id: intakeId, intake_version: intakeVersion },
    });
  }
  const brief = validateAgentDefinition<Brief>("Brief", version.content_json);
  if (canonicalDigest(brief) !== version.input_digest) throw new ProductError("REVIEW_STALE", "The stored brief digest is inconsistent");
  const heads = tx.list("question_head", { intake_id: intakeId, intake_version: intakeVersion });
  const questions = [...heads]
    .sort((left, right) =>
      left.question_id < right.question_id ? -1 : left.question_id > right.question_id ? 1 : 0,
    )
    .map((head) => {
      const questionRow = tx.get("question_version", {
        intake_id: intakeId, intake_version: intakeVersion,
        question_id: head.question_id, question_version: head.current_question_version,
      });
      if (questionRow === null) throw new ProductError("REVIEW_STALE", "The question head has no immutable question");
      const question = validateAgentDefinition<Question>("Question", questionRow.question_json);
      if (question.intake_id !== intakeId || question.intake_version !== intakeVersion ||
          question.question_id !== head.question_id || question.version !== head.current_question_version ||
          question.input_digest !== version.input_digest || questionRow.input_digest !== version.input_digest) {
        throw new ProductError("REVIEW_STALE", "The question is bound to different creative input");
      }
      const answerHead = tx.get("answer_head", {
        intake_id: intakeId,
        intake_version: intakeVersion,
        question_id: head.question_id,
        question_version: head.current_question_version,
      });
      if (answerHead === null) {
        return {
          question_id: head.question_id,
          question_version: head.current_question_version,
          answer: null,
        };
      }
      const answer = tx.get("answer_version", {
        intake_id: intakeId,
        intake_version: intakeVersion,
        question_id: head.question_id,
        question_version: head.current_question_version,
        answer_version: answerHead.current_answer_version,
      });
      if (answer === null) {
        throw new ProductError("NOT_FOUND", "The answer head points at a missing answer version");
      }
      const payload = validateAgentDefinition<QuestionAnswer>("QuestionAnswer", answer.answer_json);
      if (payload.intake_id !== intakeId || payload.intake_version !== intakeVersion ||
          payload.question_id !== head.question_id || payload.question_version !== question.version ||
          payload.answer_id !== answer.answer_id || payload.version !== answer.answer_version ||
          payload.input_digest !== version.input_digest || answer.input_digest !== version.input_digest) {
        throw new ProductError("REVIEW_STALE", "The answer is bound to different creative input");
      }
      return {
        question_id: head.question_id,
        question_version: head.current_question_version,
        answer: { answer_id: answer.answer_id, answer_version: answer.answer_version },
      };
    });
  return {
    intake_id: intakeId,
    intake_version: intakeVersion,
    brief_sha256: version.input_digest,
    questions,
  };
}

/** The digest of the closure of an intake version. */
export function creativeInputClosureDigest(
  tx: ProductTransaction,
  intakeId: string,
  intakeVersion: number,
): string {
  return canonicalDigest(creativeInputClosure(tx, intakeId, intakeVersion));
}

/** Pre-project drafts belong to the authenticated user, regardless of transport. */
export function assertIntakeOwner(tx: ProductTransaction, intakeId: string, principalId: string): void {
  const head = tx.get("intake_head", { intake_id: intakeId });
  const record = head === null ? null : tx.get("intake_version", { intake_id: intakeId, version: head.current_version });
  if (record === null || record.principal_id !== principalId) {
    throw new ProductError("NOT_FOUND", "No accessible intake");
  }
}
