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

const HASH = /^[a-f0-9]{64}$/;
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
  /**
   * The Host's own current author and rights.
   *
   * It is consulted at the publication boundary, AFTER the proof was released, so the
   * boundary check never leans on a proof nobody holds any more. It is the Host's own
   * reading of the committed source and of the registered rights.
   *
   * Absent means the boundary cannot be proved, and the publication does not happen:
   * a package that cannot be tied to the current author is not a package.
   */
  readonly currentAuthorAndRights?: (input: {
    readonly project_id: string;
    readonly prepared_source_id: string;
  }) => {
    /** The CURRENT committed source digest of the project. */
    readonly source_digest: string;
    /** The rights digest the project's current facts carry. */
    readonly rights_digest: string;
    readonly authorized: boolean;
    readonly reason: string;
  };
}

/** The input of one published review package. */
export interface PublishCreatedReviewPackageInput {
  readonly package: PublishReviewPackageInput;
  readonly completed: CompletedPreparedSourceV1;
  readonly binding: PreparedPreviewBindingV1;
  /**
   * The committed source the preparation was made against.
   *
   * It is the base the publication will replace, and it is what the CURRENT committed
   * source is compared against at the publication boundary. A project that moved after
   * the preparation does not get a package published over it.
   */
  readonly base_source_digest: string;
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
   * The order is fixed and every step of it is a check:
   *
   * 1. MEDIA proves the completed prepared source and holds the real descriptors.
   * 2. The isolated preview is rendered with that proof.
   * 3. The proof's own final check runs, while the descriptors are still held.
   * 4. The proof is released. It is released here and only here, and nothing after
   *    this point may borrow it.
   * 5. The receipt's own digest is recomputed, so a receipt that was altered after it
   *    was made is not a receipt.
   * 6. The Host re-reads its CURRENT author and rights, after the release, and they
   *    have to be the ones the receipt was made against.
   * 7. The package is published and the bindings are written in ONE scope.
   *
   * A failure anywhere leaves nothing published.
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
      // The final synchronous check of the proof, with the real descriptors still
      // held. MEDIA calls the Host back here, and the Host checks the current author
      // and rights itself.
      proofPort.assertCurrentForRead(
        input.completed,
        input.binding,
        proof,
        () => { this.#assertCurrentAuthorAndRights(input, receipt); },
      );
    } finally {
      // The proof is released here and only here. Borrowing it afterwards would make
      // the preview rest on a proof nobody holds any more.
      await proofPort.release(proof);
    }
    this.#assertReceipt(receipt, input);
    // The publication boundary: the author and rights are re-read AFTER the proof was
    // released, so this check is the Host's own and not the proof's.
    this.#assertCurrentAuthorAndRights(input, receipt);

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
    if (receipt.source_digest !== input.binding.source_digest) {
      throw new ProductError('REVIEW_STALE', 'The preview receipt is of another source');
    }
    if (!HASH.test(receipt.receipt_digest)) {
      throw new ProductError('REVIEW_STALE', 'The preview receipt carries no digest');
    }
    // The receipt's digest has to cover the receipt's own content. A receipt that was
    // altered after it was made does not hash to its own digest any more, and the
    // objects it names are not the ones that were verified.
    const { receipt_digest: _self, ...content } = receipt;
    if (canonicalDigest(content) !== receipt.receipt_digest) {
      throw new ProductError('REVIEW_STALE', 'The preview receipt does not match its own digest');
    }
    for (const part of input.package.parts) {
      const slot = receipt.parts.find((candidate) => candidate.slot === part.kind);
      if (slot === undefined) {
        throw new ProductError('REVIEW_STALE', `The preview receipt carries no part for ${part.kind}`);
      }
      if (!Number.isSafeInteger(slot.bytes) || slot.bytes < 1 || !HASH.test(slot.sha256)) {
        throw new ProductError('REVIEW_STALE', 'The preview receipt carries an unproved object');
      }
      if (slot.object_id.length === 0) {
        throw new ProductError('REVIEW_STALE', 'The preview receipt names no object');
      }
    }
  }

  /**
   * The Host's own current author and rights.
   *
   * Two things have to hold: the rights are authorized right now, and the committed
   * source is the one the receipt was made against. A source that moved after the
   * preview was rendered means the preview describes a closure that is no longer the
   * project's, and the package is not published.
   */
  #assertCurrentAuthorAndRights(
    input: PublishCreatedReviewPackageInput,
    receipt: PreparedPreviewReceiptV1,
  ): void {
    const probe = this.#ports.currentAuthorAndRights;
    if (probe === undefined) {
      throw new ProductError('CAPABILITY_UNAVAILABLE', 'The current author and rights cannot be read');
    }
    const current = probe({
      project_id: input.package.project_id,
      prepared_source_id: input.binding.prepared_source_id,
    });
    if (current.authorized !== true) {
      throw new ProductError('APPROVAL_REQUIRED', 'The declared rights are not authorized right now');
    }
    if (current.source_digest !== input.base_source_digest) {
      throw new ProductError('REVISION_CONFLICT', 'The committed source moved after the preview was rendered', {
        details: { expected: input.base_source_digest, received: current.source_digest },
      });
    }
    if (current.rights_digest !== receipt.rights_digest) {
      throw new ProductError('REVISION_CONFLICT', 'The rights moved after the preview was rendered', {
        details: { expected: receipt.rights_digest, received: current.rights_digest },
      });
    }
  }
}

/** The parts of a package, as the transport sees them. */
export type CreatedReviewPackagePart = ReviewPart;
