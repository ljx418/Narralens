/**
 * The PRODUCT lane's public entry point.
 *
 * MAIN imports the seam, the record types and the two services from here. The collection
 * union and the record DTOs are exported so MAIN's adapter can be typed against them
 * without reaching into the individual modules.
 */

export {
  PRODUCT_COLLECTIONS,
  PRODUCT_HEAD_COLLECTIONS,
  PRODUCT_APPEND_ONLY_COLLECTIONS,
  TrustedContextBrand,
  isTrustedCallerContext,
  reviewImpactOf,
  toWireApproval,
  toWireArtifactContent,
  toWireContentDecision,
  toWireRunAuthorization,
} from "./product-repository.js";
export type {
  AnswerHeadRecord,
  AnswerVersionRecord,
  ApprovalRecord,
  ArtifactDocument,
  ArtifactKind,
  ArtifactVersionRecord,
  BootstrapCommandRecord,
  ContentDecisionRecord,
  EventRecord,
  ExecutionGrantRecord,
  FixedPlan,
  FixedPlanCapability,
  FixedPlanStage,
  IntakeConfirmationRecord,
  IntakeContentDecisionRecord,
  IntakeHeadRecord,
  IntakeVersionRecord,
  NativeAckRecord,
  PlanVersionRecord,
  PreparedAuthorizationRecord,
  ProductAppendOnlyCollection,
  ProductCollection,
  ProductCollectionKind,
  ProductCollectionKindOf,
  ProductCollectionSpec,
  ProductEvent,
  ProductEventEntity,
  ProductEventEntityType,
  ProductEventReceipt,
  ProductEventScope,
  ProductEventTopic,
  ProductHeadCollection,
  ProductIdempotencyEntry,
  ProductIdempotencyReceipt,
  ProductIdempotencyScope,
  ProductRecordKeys,
  ProductRecordScopes,
  ProductRecords,
  ProductRepository,
  ProductTransaction,
  ProductWriteOutcome,
  ProjectOriginRecord,
  QuestionHeadRecord,
  QuestionVersionRecord,
  ReviewGateKind,
  ReviewRequestRecord,
  RunCheckpoint,
  RunCheckpointAttempt,
  RunCheckpointPackage,
  RunRecord,
  RunState,
  StepAttemptRecord,
  TemplateHeadRecord,
  TemplateVersionRecord,
  TrustedAdoptionAuthority,
  TrustedApprovalInput,
  TrustedCallerContext,
  TrustedConfirmationInput,
  TrustedConfirmationRecord,
} from "./product-repository.js";

export {
  CreativeService,
  CREATIVE_OPERATIONS,
} from "./creative-service.js";
export type { CreativeServiceOptions } from "./creative-service.js";

export {
  FixedWorkflowService,
  WORKFLOW_OPERATIONS,
  FIXED_WORKFLOW_VERSION,
  RUN_GATE_KINDS,
  PACKAGE_GATE,
  PACKAGE_REVIEW_GATE,
  PACKAGE_ARTIFACT_KIND,
  CHAPTER_PART_KINDS,
  CAPABILITY_SLUG,
} from "./fixed-workflow-service.js";
export type {
  FixedWorkflowServiceOptions,
  PublishReviewPackageInput,
} from "./fixed-workflow-service.js";

export {
  canonicalDigest,
  canonicalJson,
  contentDigest,
  briefDigest,
  creativeInputClosureDigest,
  requestDigest,
  runScopeDigest,
  sha256Hex,
  deterministicId,
  CanonicalizationError,
  FIXED_PLAN,
  FIXED_PLAN_EXECUTION_DIGEST,
  assertFixedPlanDigest,
} from "./digest.js";

export { creativeInputClosure } from "./creative-closure.js";

export {
  guardExecution,
  assertAbleScope,
  A_ALLOWED_ACTIONS,
  A_CAPABILITY_IDS,
  A_STAGE_GATE_REQUIREMENTS,
} from "./execution-guard.js";
export type { GuardedAction, ExecutionGuardContext } from "./execution-guard.js";

export {
  createTrustedCallerContext,
  isTrustedUi,
  isPlainAuthenticated,
  isProductError,
  ProductError,
  PRODUCT_ERROR_HTTP_STATUS,
} from "./trusted-context.js";
export type { ProductErrorCode } from "./trusted-context.js";

export {
  nowEpochSeconds,
  epochSecondsToIso,
  isoToEpochSeconds,
  isExpired,
} from "./time.js";
