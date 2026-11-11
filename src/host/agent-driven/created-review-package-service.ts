import type { ReviewPackage, ReviewPart } from '../../contracts/agent-driven-types.js';
import type { PreparedPreviewReceiptV1 } from '../../contracts/prepared-preview.js';
import type {
  CompletedPreparedSourceV1,
  PreparedPreviewBindingV1,
  PreparedPreviewPort,
  PreparedSourceProofPort,
} from '../render/assembly-ports.js';
import type { LocalAsset } from './local-asset-registry.js';
import type { TrustedCallerContext } from '../creative/product-repository.js';
import type { PublishReviewPackageInput } from '../creative/fixed-workflow-service.js';
import { ProductError } from '../creative/trusted-context.js';
import { canonicalDigest } from '../creative/digest.js';
import { CreatedReviewMediaBindings } from './created-review-media-bindings.js';

/**
 * The seam that publishes a package and the facts of that package together.
 *
 * The package, the immutable receipt linkage of its parts and the visible result
 * reference have to become visible together or not at all. The seam is therefore
 * given the caller's own transaction scope: the publication happens inside it and the
 * bindings are written inside it, and nothing is committed until both are done.
 */
export interface ReviewPackagePublisher {
  publish(
    input: PublishReviewPackageInput,
    caller: TrustedCallerContext,
    work: (published: ReviewPackage) => void,
  ): Promise<ReviewPackage>;
}

/** The ports of the review package service. */
export interface CreatedReviewPackagePorts {
  /** The real MEDIA proof surface. */
  readonly proofPort: PreparedSourceProofPort;
  /** The real MEDIA preview surface. */
  readonly previewPort: PreparedPreviewPort;
  /** The publisher seam. */
  readonly publisher: ReviewPackagePublisher;
  /** The real local assets of the project, for the rights check of the proof. */
  readonly registryFacts: (project_id: string) => readonly LocalAsset[];
}

/** The input of one published review package. */
export interface PublishCreatedReviewPackageInput {
  readonly package: PublishReviewPackageInput;
  readonly completed: CompletedPreparedSourceV1;
  readonly binding: PreparedPreviewBindingV1;
}

/**
 * The publisher of a review package.
 *
 * It asks MEDIA for a real proof of the completed prepared source, renders the
 * isolated preview with that proof, and binds the immutable receipt of the preview to
 * the package it publishes. The proof is released as soon as the preview is done, and
 * the package is never bound to a proof that has already been released.
 *
 * A read never comes here. The transport only reads what this service published.
 */
export class CreatedReviewPackageService {
  readonly #bindings: CreatedReviewMediaBindings;
  readonly #ports: CreatedReviewPackagePorts;

  constructor(bindings: CreatedReviewMediaBindings, ports: CreatedReviewPackagePorts) {
    this.#bindings = bindings;
    this.#ports = ports;
  }

  /**
   * Publish the package of a prepared source.
   *
   * The order is fixed: prove, preview, release, verify, then publish and bind in one
   * scope. A failure anywhere leaves nothing published.
   */
  async publish(input: PublishCreatedReviewPackageInput, caller: TrustedCallerContext): Promise<ReviewPackage> {
    const { proofPort, previewPort, publisher } = this.#ports;
    const proof = await proofPort.proveForRead(
      input.completed,
      input.binding,
      this.#ports.registryFacts(input.package.project_id),
    );
    let receipt: PreparedPreviewReceiptV1;
    try {
      receipt = await previewPort.preview({
        format: 'narralens.prepared-preview-request@1',
        completed: input.completed,
        binding: input.binding,
        proof,
      });
    } finally {
      // The proof is released here and only here. Borrowing it afterwards would make
      // the preview rest on a proof nobody holds any more.
      await proofPort.release(proof);
    }
    this.#assertReceipt(receipt, input);

    return publisher.publish(input.package, caller, (published) => {
      this.#bindings.bind({
        project_id: published.project_id,
        run_id: published.run_id,
        package_id: published.package_id,
        package_version: published.version,
        // The digest of the published package document itself. It is the same digest
        // the workflow service stored against the review request, because it is the
        // same document.
        package_digest: canonicalDigest(published),
        receipt,
        parts: published.parts,
        now: new Date(),
      });
    });
  }

  /**
   * The receipt has to be the receipt of this project and this run, and every part of
   * the package has to be one of the receipt's own objects.
   */
  #assertReceipt(receipt: PreparedPreviewReceiptV1, input: PublishCreatedReviewPackageInput): void {
    const project = input.package.project_id;
    const run = input.package.run_id;
    if (receipt.format !== 'narralens.prepared-preview-receipt@1' ||
      receipt.project_id !== project || receipt.run_id !== run) {
      throw new ProductError('REVIEW_STALE', 'The preview receipt belongs to another project or run');
    }
    if (receipt.prepared_source_id !== input.binding.prepared_source_id) {
      throw new ProductError('REVIEW_STALE', 'The preview receipt is of another prepared source');
    }
    if (receipt.receipt_digest.length === 0) {
      throw new ProductError('REVIEW_STALE', 'The preview receipt carries no digest');
    }
    for (const part of input.package.parts) {
      const slot = receipt.parts.find((candidate) => candidate.slot === part.kind);
      if (slot === undefined) {
        throw new ProductError('REVIEW_STALE', `The preview receipt carries no part for ${part.kind}`);
      }
      if (slot.bytes < 0 || slot.sha256.length === 0) {
        throw new ProductError('REVIEW_STALE', 'The preview receipt carries an unproved object');
      }
    }
  }
}

/** The parts of a package, as the transport sees them. */
export type CreatedReviewPackagePart = ReviewPart;
