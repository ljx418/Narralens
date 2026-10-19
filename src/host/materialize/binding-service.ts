import { createHash } from "node:crypto";
import { HttpError } from "../api-error.js";
import { canonicalJson } from "../engine/source-digest-v1.js";
import type { ProposalComparison } from "../../contracts/types.js";
import type { AssetInventoryPort } from "../projects/asset-inventory-port.js";
import type { ProjectResolver } from "../projects/project-resolver.js";

/**
 * BindingService (M3.1).
 *
 * Turns "which asset, from where, for how long" into facts the Host proved, one proposal
 * segment at a time. Everything it returns was re-read *now*: the comparison, the asset
 * inventory, and through it the bytes and the licence. Nothing is taken from the request,
 * because the request is a client and the client is not a source of truth.
 *
 * Three refusals carry most of the weight:
 *
 * - A comparison whose `project_id` is not this target is not this project's intent. The
 *   recorded D4.1 output was created against the *source* Hypit project, so it can be
 *   replayed onto a target through the normal adapter — but the adapter sets the project id
 *   when it builds the comparison, and nothing here may paper over a mismatch. Rewriting the
 *   id by hand is the exact forgery C-07 forbids.
 *
 * - One binding per segment, no more and no fewer. A missing segment is unplaced content;
 *   an extra one is content nobody asked for. Either way the mapping is not what was proposed.
 *
 * - A source span must be *at least* as long as the segment and is cut exactly, never
 *   looped, frozen or slowed. A short asset is a 422, not a workaround: a three-shot film
 *   with the middle shot held still is not the film that was proposed.
 */

export interface SegmentBinding {
  readonly segment_id: string;
  readonly asset_id: string;
  readonly source_start_frame: number;
  readonly source_end_frame_exclusive: number;
  /** Frames this segment occupies on the timeline; exactly the proposal's duration. */
  readonly target_start_frame: number;
  readonly target_end_frame_exclusive: number;
  readonly asset_sha256: string;
  readonly duration_frames: number;
  readonly license_status: string;
  readonly commercial_use: boolean;
}

export interface BindingResult {
  readonly project_id: string;
  readonly comparison_id: string;
  readonly proposal_id: string;
  readonly base_revision: number;
  readonly selection: ProposalComparison["selection"];
  readonly bindings: readonly SegmentBinding[];
  /** Hash over the bound facts; an impact or adoption can bind to exactly these. */
  readonly binding_digest: string;
  readonly rights_digest: string;
  readonly asset_inventory_sha256: string;
  readonly total_frames: number;
}

export interface BindingServiceDeps {
  readonly resolver: ProjectResolver;
  readonly inventory: AssetInventoryPort;
  /** Reads the target-owned comparison. Never the source project's. */
  readonly readComparison: (comparisonId: string) => Promise<ProposalComparison>;
}

export class BindingService {
  readonly #resolver: ProjectResolver;
  readonly #inventory: AssetInventoryPort;
  readonly #comparisons: BindingServiceDeps["readComparison"];

  constructor(deps: BindingServiceDeps) {
    this.#resolver = deps.resolver;
    this.#inventory = deps.inventory;
    this.#comparisons = deps.readComparison;
  }

  async bind(input: {
    projectId: string;
    comparisonId: string;
    proposalId: string;
    baseRevision: number;
    requested: ReadonlyArray<{
      segment_id: string; asset_id: string;
      source_start_frame: number; source_end_frame_exclusive: number;
    }>;
    now?: Date;
  }): Promise<BindingResult> {
    const view = await this.#resolver.resolve(input.projectId);
    if (view.kind !== "activated") {
      // A legacy project has no proposal comparable to this one; binding it here would mean
      // inventing a target that does not exist.
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "Materialize binds an activated target; this project is not one", undefined, input.projectId);
    }

    const comparison = await this.#comparisons(input.comparisonId);
    if (comparison.project_id !== input.projectId) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The comparison belongs to a different project and cannot be rebound",
        { comparison_project_id: comparison.project_id, requested_project_id: input.projectId },
        input.projectId);
    }
    if (comparison.base_revision !== input.baseRevision) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The comparison was built against a different base revision",
        { comparison_base_revision: comparison.base_revision, base_revision: input.baseRevision },
        input.projectId);
    }

    const proposal = comparison.proposals.find((candidate) => candidate.proposal_id === input.proposalId);
    if (proposal === undefined) {
      throw new HttpError(404, "NOT_FOUND", "Proposal not found in this comparison", undefined, input.projectId);
    }

    const bySegment = new Map<string, (typeof input.requested)[number]>();
    for (const binding of input.requested) {
      if (bySegment.has(binding.segment_id)) {
        throw new HttpError(422, "UNSUPPORTED_EDIT",
          `Segment ${binding.segment_id} is bound more than once`, undefined, input.projectId);
      }
      bySegment.set(binding.segment_id, binding);
    }
    if (bySegment.size !== proposal.segments.length) {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        `The proposal has ${proposal.segments.length} segment(s) and ${bySegment.size} binding(s); they must correspond one to one`,
        undefined, input.projectId);
    }

    const inventory = await this.#inventory.inventory(input.projectId);
    if (inventory.kind !== "activated") {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "Asset inventory is not a target inventory", undefined, input.projectId);
    }

    let cursor = comparison.selection.start_frame;
    const bindings: SegmentBinding[] = [];
    for (const segment of proposal.segments) {
      const requested = bySegment.get(segment.segment_id);
      if (requested === undefined) {
        throw new HttpError(422, "UNSUPPORTED_EDIT",
          `Segment ${segment.segment_id} has no binding`, undefined, input.projectId);
      }
      const asset = inventory.assets.find((candidate) => candidate.asset_id === requested.asset_id);
      if (asset === undefined) {
        throw new HttpError(422, "MISSING_ASSET",
          `Asset ${requested.asset_id} is not registered for this project`, undefined, input.projectId);
      }
      if (!asset.eligible) {
        throw new HttpError(422, "MISSING_ASSET",
          `Asset ${requested.asset_id} is not usable: ${asset.blocking_reasons.join(",")}`,
          { blocking_reasons: [...asset.blocking_reasons] }, input.projectId);
      }

      const span = requested.source_end_frame_exclusive - requested.source_start_frame;
      if (!Number.isSafeInteger(requested.source_start_frame)
        || !Number.isSafeInteger(requested.source_end_frame_exclusive)
        || requested.source_start_frame < 0 || span <= 0) {
        throw new HttpError(422, "INVALID_RANGE",
          `Binding for ${segment.segment_id} is not a non-empty integer half-open range`,
          undefined, input.projectId);
      }
      if (requested.source_start_frame + span > asset.duration_frames) {
        throw new HttpError(422, "INVALID_RANGE",
          `Binding for ${segment.segment_id} runs past the end of ${requested.asset_id}`,
          { asset_frames: asset.duration_frames,
            requested_end_frame_exclusive: requested.source_start_frame + span },
          input.projectId);
      }
      if (span < segment.duration_frames) {
        // Not looped, not frozen, not slowed. A short asset is a refusal, because the three
        // ways to fake the length all change what the viewer sees.
        throw new HttpError(422, "INVALID_RANGE",
          `Segment ${segment.segment_id} needs ${segment.duration_frames} frame(s) but the bound span has ${span}`,
          { required_frames: segment.duration_frames, span_frames: span }, input.projectId);
      }

      bindings.push({
        segment_id: segment.segment_id, asset_id: requested.asset_id,
        source_start_frame: requested.source_start_frame,
        source_end_frame_exclusive: requested.source_start_frame + span,
        target_start_frame: cursor, target_end_frame_exclusive: cursor + segment.duration_frames,
        asset_sha256: asset.sha256, duration_frames: segment.duration_frames,
        license_status: asset.license.status, commercial_use: asset.license.commercial_use,
      });
      cursor += segment.duration_frames;
    }

    const totalFrames = cursor - comparison.selection.start_frame;
    if (totalFrames !== comparison.selection.end_frame_exclusive - comparison.selection.start_frame) {
      throw new HttpError(422, "INVALID_RANGE",
        "The bound segments do not cover the proposed selection exactly",
        { selection_frames: comparison.selection.end_frame_exclusive - comparison.selection.start_frame,
          bound_frames: totalFrames },
        input.projectId);
    }

    return {
      project_id: input.projectId, comparison_id: input.comparisonId, proposal_id: input.proposalId,
      base_revision: input.baseRevision, selection: comparison.selection,
      bindings,
      binding_digest: bindingDigest(bindings),
      rights_digest: rightsDigest(bindings, inventory.inventory_sha256),
      asset_inventory_sha256: inventory.inventory_sha256,
      total_frames: totalFrames,
    };
  }
}

/**
 * Over the bound facts only, so an impact or an adoption can bind to exactly what was
 * placed. Ordered by segment id, not by request order, so a client reordering its JSON does
 * not produce a different digest for the same film.
 */
export function bindingDigest(bindings: readonly SegmentBinding[]): string {
  const digest = createHash("sha256");
  digest.update("narralens-binding-v1\n");
  digest.update(canonicalJson([...bindings]
    .sort((a, b) => a.segment_id.localeCompare(b.segment_id))
    .map((binding) => ({
      segment_id: binding.segment_id, asset_id: binding.asset_id,
      source_start_frame: binding.source_start_frame,
      source_end_frame_exclusive: binding.source_end_frame_exclusive,
      target_start_frame: binding.target_start_frame,
      target_end_frame_exclusive: binding.target_end_frame_exclusive,
      asset_sha256: binding.asset_sha256,
    }))));
  return digest.digest("hex");
}

/**
 * Over the rights that were actually relied on, plus the inventory they came from.
 *
 * Hashing only a label would make a licence change invisible; hashing the whole inventory
 * would make an unrelated asset's addition look like a rights change. Both the per-asset
 * rights facts and the inventory digest are folded in so the two are distinguishable.
 */
export function rightsDigest(bindings: readonly SegmentBinding[], inventorySha256: string): string {
  const digest = createHash("sha256");
  digest.update("narralens-rights-v1\n");
  digest.update(canonicalJson({
    asset_inventory_sha256: inventorySha256,
    assets: [...bindings]
      .sort((a, b) => a.segment_id.localeCompare(b.segment_id))
      .map((binding) => ({
        asset_id: binding.asset_id, asset_sha256: binding.asset_sha256,
        license_status: binding.license_status, commercial_use: binding.commercial_use,
      })),
  }));
  return digest.digest("hex");
}
