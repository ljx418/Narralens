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
import type { EditRequest, ProposalBundle, ProposalComparison, ProposalComparisonDraft, ProposalComparisonRequest, ProposalRequest } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of [apiErrorSchema, cancelResponseSchema, jobEventSchema, jobResponseSchema,
  projectResponseSchema, proposalBundleSchema, proposalRequestSchema, sessionResponseSchema,
  editOperationSchema, editRequestSchema, editResponseSchema, assetManifestSchema,
  assetImportMetadataSchema, assetImportResponseSchema, assetInventoryResponseSchema,
  proposalComparisonRequestSchema, proposalComparisonDraftSchema, proposalComparisonSchema]) {
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
