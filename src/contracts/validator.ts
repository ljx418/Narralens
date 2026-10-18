import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import apiErrorSchema from "../../contracts/api-error.schema.json" with { type: "json" };
import cancelResponseSchema from "../../contracts/cancel-response.schema.json" with { type: "json" };
import jobEventSchema from "../../contracts/job-event.schema.json" with { type: "json" };
import jobResponseSchema from "../../contracts/job-response.schema.json" with { type: "json" };
import projectResponseSchema from "../../contracts/project-response.schema.json" with { type: "json" };
import proposalBundleSchema from "../../contracts/proposal-bundle.schema.json" with { type: "json" };
import proposalRequestSchema from "../../contracts/proposal-request.schema.json" with { type: "json" };
import proposalComparisonRequestSchema from "../../contracts/proposal-comparison-request.schema.json" with { type: "json" };
import proposalComparisonDraftSchema from "../../contracts/proposal-comparison-draft.schema.json" with { type: "json" };
import proposalComparisonSchema from "../../contracts/proposal-comparison.schema.json" with { type: "json" };
import sessionResponseSchema from "../../contracts/session-response.schema.json" with { type: "json" };
import editOperationSchema from "../../contracts/edit-operation.schema.json" with { type: "json" };
import editRequestSchema from "../../contracts/edit-request.schema.json" with { type: "json" };
import editResponseSchema from "../../contracts/edit-response.schema.json" with { type: "json" };
import assetManifestSchema from "../../contracts/asset-manifest.schema.json" with { type: "json" };
import assetImportMetadataSchema from "../../contracts/asset-import-metadata.schema.json" with { type: "json" };
import assetImportResponseSchema from "../../contracts/asset-import-response.schema.json" with { type: "json" };
import assetInventoryResponseSchema from "../../contracts/asset-inventory-response.schema.json" with { type: "json" };
import engineResponseSchema from "../../contracts/engine-response.schema.json" with { type: "json" };
import sourceDigestManifestSchema from "../../contracts/source-digest-manifest.schema.json" with { type: "json" };
import migrationPlanSchema from "../../contracts/migration-plan.schema.json" with { type: "json" };
import rollbackRecordSchema from "../../contracts/rollback-record.schema.json" with { type: "json" };
import migrationReportSchema from "../../contracts/migration-report.schema.json" with { type: "json" };
import materializeRequestSchema from "../../contracts/materialize-request.schema.json" with { type: "json" };
import materializationSchema from "../../contracts/materialization.schema.json" with { type: "json" };
import impactSpecSchema from "../../contracts/impact.schema.json" with { type: "json" };
import adoptRequestSchema from "../../contracts/adopt-request.schema.json" with { type: "json" };
import restoreRequestSchema from "../../contracts/restore-request.schema.json" with { type: "json" };
import controlledWriteResponseSchema from "../../contracts/controlled-write-response.schema.json" with { type: "json" };
import type { EditRequest, ProposalBundle, ProposalComparison, ProposalComparisonDraft, ProposalComparisonRequest, ProposalRequest } from "./types.js";
import type { EngineResponse, SourceDigestManifest } from "./engine-types.js";
import type { MigrationPlanV1, MigrationReportV1, RollbackRecord } from "./migration-types.js";
import type { AdoptRequestV1, ControlledWriteResponseV1, ImpactSpecV1, MaterializationV1,
  MaterializeRequestV1, NativePlanV1, RestoreRequestV1 } from "./wave2-types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of [apiErrorSchema, cancelResponseSchema, jobEventSchema, jobResponseSchema,
  projectResponseSchema, proposalBundleSchema, proposalRequestSchema, sessionResponseSchema,
  editOperationSchema, editRequestSchema, editResponseSchema, assetManifestSchema,
  assetImportMetadataSchema, assetImportResponseSchema, assetInventoryResponseSchema,
  proposalComparisonRequestSchema, proposalComparisonDraftSchema, proposalComparisonSchema,
  engineResponseSchema, sourceDigestManifestSchema,
  migrationPlanSchema, rollbackRecordSchema, migrationReportSchema,
  materializeRequestSchema, materializationSchema, impactSpecSchema, adoptRequestSchema,
  restoreRequestSchema, controlledWriteResponseSchema]) {
  ajv.addSchema(schema);
}

export const contractIds = {
  apiError: apiErrorSchema.$id,
  cancelResponse: cancelResponseSchema.$id,
  jobEvent: jobEventSchema.$id,
  jobResponse: jobResponseSchema.$id,
  projectResponse: projectResponseSchema.$id,
  proposalBundle: proposalBundleSchema.$id,
  proposalRequest: proposalRequestSchema.$id,
  proposalComparisonRequest: proposalComparisonRequestSchema.$id,
  proposalComparisonDraft: proposalComparisonDraftSchema.$id,
  proposalComparison: proposalComparisonSchema.$id,
  sessionResponse: sessionResponseSchema.$id,
  editOperation: editOperationSchema.$id,
  editRequest: editRequestSchema.$id,
  editResponse: editResponseSchema.$id,
  assetManifest: assetManifestSchema.$id,
  assetImportMetadata: assetImportMetadataSchema.$id,
  assetImportResponse: assetImportResponseSchema.$id,
  assetInventoryResponse: assetInventoryResponseSchema.$id,
  engineResponse: engineResponseSchema.$id,
  sourceDigestManifest: sourceDigestManifestSchema.$id,
  migrationPlan: migrationPlanSchema.$id,
  migrationReport: migrationReportSchema.$id,
  rollbackRecord: rollbackRecordSchema.$id,
  materializeRequest: materializeRequestSchema.$id,
  materialization: materializationSchema.$id,
  impactSpec: impactSpecSchema.$id,
  adoptRequest: adoptRequestSchema.$id,
  restoreRequest: restoreRequestSchema.$id,
  controlledWriteResponse: controlledWriteResponseSchema.$id,
} as const;

export function validatorFor(id: string): ValidateFunction {
  const validator = ajv.getSchema(id);
  if (!validator) throw new Error(`Unknown contract schema: ${id}`);
  return validator;
}

function rangeErrors(selection: { start_frame: number; end_frame_exclusive: number }): string[] {
  return selection.end_frame_exclusive > selection.start_frame ? []
    : ["selection must be a non-empty [start_frame, end_frame_exclusive) range"];
}

export function validateProposalRequest(value: unknown): { ok: true; value: ProposalRequest } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.proposalRequest);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const request = value as ProposalRequest;
  const errors = rangeErrors(request.selection);
  return errors.length ? { ok: false, errors } : { ok: true, value: request };
}

export function validateProposalComparisonRequest(value: unknown): { ok: true; value: ProposalComparisonRequest } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.proposalComparisonRequest);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const request = value as ProposalComparisonRequest;
  const errors = rangeErrors(request.selection);
  return errors.length ? { ok: false, errors } : { ok: true, value: request };
}

export function validateProposalComparisonDraft(value: unknown): { ok: true; value: ProposalComparisonDraft } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.proposalComparisonDraft);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  return { ok: true, value: value as ProposalComparisonDraft };
}

export function validateProposalComparison(value: unknown): { ok: true; value: ProposalComparison } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.proposalComparison);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const comparison = value as ProposalComparison;
  const errors = rangeErrors(comparison.selection);
  if (comparison.proposal_count !== comparison.proposals.length) errors.push("proposal_count must equal proposals length");
  return errors.length ? { ok: false, errors } : { ok: true, value: comparison };
}

export function validateEditRequest(value: unknown): { ok: true; value: EditRequest } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.editRequest);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const request = value as EditRequest;
  const errors = rangeErrors(request.selection);
  if (request.operations[0].shot_id !== request.selection.shot_id) errors.push("operation shot must equal selection shot");
  return errors.length ? { ok: false, errors } : { ok: true, value: request };
}

export function validateProposalBundle(value: unknown): { ok: true; value: ProposalBundle } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.proposalBundle);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const proposal = value as ProposalBundle;
  const selected = proposal.selection.end_frame_exclusive - proposal.selection.start_frame;
  const proposed = proposal.segments.reduce((sum, segment) => sum + segment.duration_frames, 0);
  const errors = [...rangeErrors(proposal.selection)];
  if (selected !== proposed) errors.push("segment durations must exactly cover the selected frame range");
  if (proposal.renderable && proposal.segments.some((segment) => segment.asset_id === null)) {
    errors.push("renderable proposals cannot contain unresolved segment assets");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: proposal };
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}

export function validateEngineResponse(value: unknown): { ok: true; value: EngineResponse } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.engineResponse);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  return { ok: true, value: value as EngineResponse };
}

export function validateSourceDigestManifest(value: unknown): { ok: true; value: SourceDigestManifest } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.sourceDigestManifest);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  return { ok: true, value: value as SourceDigestManifest };
}

export function validateMigrationPlan(value: unknown): { ok: true; value: MigrationPlanV1 } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.migrationPlan);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  return { ok: true, value: value as MigrationPlanV1 };
}

export function validateMigrationReport(value: unknown): { ok: true; value: MigrationReportV1 } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.migrationReport);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  return { ok: true, value: value as MigrationReportV1 };
}

export function validateRollbackRecord(value: unknown): { ok: true; value: RollbackRecord } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.rollbackRecord);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  return { ok: true, value: value as RollbackRecord };
}

/**
 * Wave 2 validators.
 *
 * The schemas carry everything expressible in JSON Schema. What is left is the arithmetic
 * and set discipline that the acceptance matrix actually turns on: one binding per proposal
 * segment, one non-overlapping clip per segment, a plan whose frame arithmetic is internally
 * consistent, and exactly one revision of progress per committed write.
 *
 * These checks are duplicated deliberately rather than left to the caller: a validator that
 * is only reachable from one code path is not a gate.
 */

/**
 * A native plan is three independently editable clips or it is a flattened composite. C-01
 * retired the single `composite_asset_id` shape, so one clip is refused by name here.
 */
function nativePlanErrors(plan: NativePlanV1): string[] {
  const errors: string[] = [];
  if (plan.clips.length < 2) {
    errors.push("a native plan needs at least two independent clips; a single clip is a flattened composite");
  }
  const clipIds = new Set<string>();
  const segmentIds = new Set<string>();
  let covered = 0;
  let previousEnd: number | null = null;
  if (plan.clips[0]?.timeline.start_frame !== 0) errors.push("a native plan must cover the timeline from frame 0");
  for (const clip of plan.clips) {
    if (clipIds.has(clip.clip_id)) errors.push(`duplicate clip_id: ${clip.clip_id}`);
    clipIds.add(clip.clip_id);
    if (segmentIds.has(clip.segment_id)) errors.push(`segment ${clip.segment_id} maps to more than one clip`);
    segmentIds.add(clip.segment_id);
    const length = clip.timeline.end_frame_exclusive - clip.timeline.start_frame;
    if (length <= 0) errors.push(`clip ${clip.clip_id} has an empty timeline range`);
    if (clip.timeline.start_frame !== (previousEnd ?? 0)) {
      errors.push(`clip ${clip.clip_id} does not start where the previous clip ended (expected ${previousEnd ?? 0})`);
    }
    previousEnd = clip.timeline.end_frame_exclusive;
    covered += length;
    const sourceLength = clip.source.end_frame_exclusive - clip.source.start_frame;
    if (sourceLength !== length) {
      errors.push(`clip ${clip.clip_id} would need an implicit speed change; source and timeline spans must be equal length`);
    }
  }
  if (covered !== plan.total_frames) errors.push("total_frames must equal the sum of the clip timeline lengths");
  return errors;
}

export function validateMaterializeRequest(value: unknown): { ok: true; value: MaterializeRequestV1 } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.materializeRequest);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const request = value as MaterializeRequestV1;
  const errors: string[] = [];
  const segmentIds = new Set<string>();
  for (const binding of request.segment_bindings) {
    if (segmentIds.has(binding.segment_id)) errors.push(`duplicate binding for segment ${binding.segment_id}`);
    segmentIds.add(binding.segment_id);
    const length = binding.source_end_frame_exclusive - binding.source_start_frame;
    if (length <= 0) errors.push(`binding for segment ${binding.segment_id} is an empty source span`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: request };
}

export function validateMaterialization(value: unknown): { ok: true; value: MaterializationV1 } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.materialization);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const materialization = value as MaterializationV1;
  const errors = materialization.native_plan ? nativePlanErrors(materialization.native_plan) : [];
  const outputs = new Set<string>();
  for (const entry of materialization.lineage) {
    if (outputs.has(entry.output_sha256)) errors.push(`duplicate lineage for output ${entry.output_sha256}`);
    outputs.add(entry.output_sha256);
  }
  if (materialization.proxy && !outputs.has(materialization.proxy.sha256)) {
    errors.push("every lineage entry must account for a produced output");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: materialization };
}

export function validateImpactSpec(value: unknown): { ok: true; value: ImpactSpecV1 } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.impactSpec);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const impact = value as ImpactSpecV1;
  const errors: string[] = [];
  for (const range of impact.affected_ranges) {
    if (range.end_frame_exclusive <= range.start_frame) {
      errors.push(`affected range ${range.clip_id} is empty`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: impact };
}

export function validateAdoptRequest(value: unknown): { ok: true; value: AdoptRequestV1 } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.adoptRequest);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  return { ok: true, value: value as AdoptRequestV1 };
}

export function validateRestoreRequest(value: unknown): { ok: true; value: RestoreRequestV1 } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.restoreRequest);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  return { ok: true, value: value as RestoreRequestV1 };
}

export function validateControlledWriteResponse(value: unknown): { ok: true; value: ControlledWriteResponseV1 } | { ok: false; errors: string[] } {
  const validate = validatorFor(contractIds.controlledWriteResponse);
  if (!validate(value)) return { ok: false, errors: formatErrors(validate.errors) };
  const response = value as ControlledWriteResponseV1;
  if (response.new_revision !== response.previous_revision + 1) {
    return { ok: false, errors: ["a committed controlled write advances the revision by exactly one"] };
  }
  return { ok: true, value: response };
}
