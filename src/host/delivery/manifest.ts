import { validateAgentDefinition } from "../../contracts/agent-driven-validator.js";
import type { Delivery, DeliveryManifest, QCItem, Ref, RenderSpec } from "../../contracts/agent-driven-types.js";

/**
 * The delivery manifest.
 *
 * The manifest is the contract's own DTO, not a description of one. It is built here
 * and then validated against the frozen runtime schema before it goes anywhere: a
 * manifest that does not satisfy `DeliveryManifest` is not a manifest, and a delivery
 * that carries one is not a delivery.
 *
 * The validation is not ceremony. Every field of the DTO is required, `additionalProperties`
 * is refused, and the `Delivery` schema adds one more rule of its own: a delivery in the
 * `ready` state must carry a manifest, an artifact reference and a download reference,
 * and its quality control must have passed. A manifest that is built by hand and not
 * checked is exactly where that rule would be lost.
 */

/** Everything the manifest is built from. */
export interface BuildManifestInput {
  readonly delivery_id: string;
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly render_spec: RenderSpec;
  readonly render_config_digest: string;
  readonly attempt: number;
  readonly media_ref: Ref;
  readonly ffprobe_ref: Ref;
  readonly full_decode_ref: Ref;
  readonly supplement_refs: readonly Ref[];
  readonly qc: readonly QCItem[];
  readonly published_at: string;
  readonly download_ref: string;
}

/** A failure of the manifest itself, as opposed to a failure of the film. */
export class DeliveryContractError extends Error {
  constructor(readonly definition: string, message: string) {
    super(message);
    this.name = "DeliveryContractError";
  }
}

/**
 * Build the manifest and check it against the frozen schema.
 *
 * A manifest is never published unvalidated: the check happens here, once, where the
 * values are still the ones the render produced.
 */
export function buildDeliveryManifest(input: BuildManifestInput): DeliveryManifest {
  const manifest: DeliveryManifest = {
    delivery_id: input.delivery_id,
    project_id: input.project_id,
    snapshot_id: input.snapshot_id,
    source_digest: input.source_digest,
    render_spec: input.render_spec,
    render_config_digest: input.render_config_digest,
    attempt: input.attempt,
    media_ref: input.media_ref,
    ffprobe_ref: input.ffprobe_ref,
    full_decode_ref: input.full_decode_ref,
    supplement_refs: [...input.supplement_refs],
    qc: [...input.qc],
    published_at: input.published_at,
    download_ref: input.download_ref,
  };
  return validateDeliveryManifest(manifest);
}

/** Check a manifest against the frozen schema and return it, typed. */
export function validateDeliveryManifest(value: unknown): DeliveryManifest {
  try {
    return validateAgentDefinition<DeliveryManifest>("DeliveryManifest", value);
  } catch (error) {
    throw new DeliveryContractError("DeliveryManifest", `the delivery manifest does not satisfy the contract: ${String((error as Error).message)}`);
  }
}

/** What a delivery record has to carry for the `Delivery` DTO. */
export interface DeliveryProjection {
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly job_id: string;
  readonly state: "preparing" | "blocked" | "ready" | "failed";
  readonly artifact_ref: Ref | null;
  readonly qc: "pending" | "passed" | "blocked";
  readonly download_ref: string | null;
  readonly manifest: DeliveryManifest | null;
}

/**
 * Project a stored delivery onto the contract's `Delivery` DTO.
 *
 * The `Delivery` schema carries the rule that a ready delivery has a manifest, an
 * artifact and a download reference, and that its quality control passed. Building the
 * DTO through the schema is what makes that rule hold on the wire rather than only in
 * the code that set the state.
 */
export function buildDelivery(projection: DeliveryProjection): Delivery {
  const delivery: Delivery = {
    project_id: projection.project_id,
    snapshot_id: projection.snapshot_id,
    job_id: projection.job_id,
    state: projection.state,
    artifact_ref: projection.artifact_ref,
    qc: projection.qc,
    download_ref: projection.download_ref,
    manifest: projection.manifest,
  };
  try {
    return validateAgentDefinition<Delivery>("Delivery", delivery);
  } catch (error) {
    throw new DeliveryContractError("Delivery", `the delivery does not satisfy the contract: ${String((error as Error).message)}`);
  }
}

/**
 * Check that a manifest describes the render it is published for.
 *
 * The manifest is built from these facts, so a mismatch means something upstream mixed
 * two renders up. It is checked rather than assumed: a package that describes another
 * project's film is worse than no package at all.
 */
export function assertManifestMatches(manifest: DeliveryManifest, expected: {
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly render_config_digest: string;
  readonly attempt: number;
}): void {
  const problems: string[] = [];
  if (manifest.project_id !== expected.project_id) problems.push("the manifest names another project");
  if (manifest.snapshot_id !== expected.snapshot_id) problems.push("the manifest names another snapshot");
  if (manifest.source_digest !== expected.source_digest) problems.push("the manifest names another source digest");
  if (manifest.render_config_digest !== expected.render_config_digest) problems.push("the manifest names another configuration");
  if (manifest.attempt !== expected.attempt) problems.push("the manifest names another attempt");
  if (manifest.qc.some((item) => item.status === "block")) problems.push("the manifest carries a blocked check");
  if (problems.length > 0) {
    throw new DeliveryContractError("DeliveryManifest", problems.join("; "));
  }
}
