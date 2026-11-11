import type { DatabaseSync } from 'node:sqlite';
import { canonicalDigest } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { OperationIdempotencyStore } from '../projects/operation-idempotency-store.js';
import { CreatedRenderDeliveryStore } from './created-render-delivery-store.js';
import { CreatedReviewGateStore } from './created-review-gate-store.js';
import { phaseReceiptDigest } from '../render/ports.js';
import type {
  AttemptFencePort,
  CommittedRenderPhasesPort,
  EncodedFactV1,
  PublishedPhaseReceiptV1,
  QcReceiptV1,
  RenderRequest,
} from '../render/ports.js';
import type { ExecutionBinding } from '../../contracts/agent-driven-types.js';

/**
 * The failure of the phase executor.
 *
 * The codes are the executor's own: a refused effect is not a media failure and not a
 * crash, and the caller has to be able to tell the three apart.
 */
export class FixedPhaseError extends Error {
  constructor(readonly code:
    | 'RUN_SCOPE_REQUIRED'
    | 'RUN_PLAN_STALE'
    | 'REVISION_CONFLICT'
    | 'CAPABILITY_UNAVAILABLE'
    | 'IDEMPOTENCY_CONFLICT',
    message: string) {
    super(message);
    this.name = 'FixedPhaseError';
  }
}

function fail(code: FixedPhaseError['code'], message: string): never {
  throw new FixedPhaseError(code, message);
}

/**
 * The lease of the delivery job the executor is working under.
 *
 * The lease attempt and the execution attempt are two different numbers and they are
 * never mixed: the lease is the job's current claim, the execution attempt is the
 * step attempt the work belongs to. A new lease for the same execution is a retry of
 * the same work; a new execution attempt is different work.
 */
export interface PhaseLease {
  /** The worker that holds the job's lease. */
  readonly owner: string;
  /** The live lease attempt of the job. */
  readonly lease_attempt: number;
  /** The execution attempt the delivery belongs to. */
  readonly execution_attempt: number;
  readonly run_id: string;
  readonly step_id: string;
  /** The quality-control gate of the run. The inspection binds it. */
  readonly qc_gate_id: string;
}

/** What a resumed delivery has already done. */
export interface PhaseProgress {
  readonly encoded: EncodedFactV1 | null;
  readonly inspected: QcReceiptV1 | null;
  readonly published: PublishedPhaseReceiptV1 | null;
}

/** The options of the executor. */
export interface FixedPhaseExecutorOptions {
  readonly revisions: RevisionStore;
  /** The real media phases. */
  readonly phases: CommittedRenderPhasesPort;
  /** The real attempt fence. */
  readonly fence: AttemptFencePort;
  readonly renderDelivery: CreatedRenderDeliveryStore;
  readonly reviewGates: CreatedReviewGateStore;
  readonly now?: () => Date;
}

/**
 * The executor of the committed render phases.
 *
 * It holds the real job and its lease; the media phases never claim either. It records
 * every stage as an immutable fact in its own transaction, and it recovers by reading
 * those facts: a resumed delivery does not encode again, does not inspect again and
 * does not publish again.
 *
 * Two things it deliberately does not do:
 *
 * - It does not decide that a delivery is ready. Readiness is the formal authority's
 *   business, and the executor hands it the published receipt.
 * - It does not accept a quality-control warning. A warning needs a recorded
 *   disposition, and the disposition is the review's fact, not the executor's.
 */
export class FixedPhaseExecutor {
  readonly #revisions: RevisionStore;
  readonly #phases: CommittedRenderPhasesPort;
  readonly #fence: AttemptFencePort;
  readonly #renderDelivery: CreatedRenderDeliveryStore;
  readonly #reviewGates: CreatedReviewGateStore;
  readonly #commands: OperationIdempotencyStore;
  readonly #now: () => Date;

  constructor(options: FixedPhaseExecutorOptions) {
    this.#revisions = options.revisions;
    this.#phases = options.phases;
    this.#fence = options.fence;
    this.#renderDelivery = options.renderDelivery;
    this.#reviewGates = options.reviewGates;
    this.#now = options.now ?? (() => new Date());
    this.#commands = new OperationIdempotencyStore(options.revisions.compose((db: DatabaseSync) => db));
  }

  /**
   * Encode the committed closure.
   *
   * A delivery whose encoded fact is already recorded is not encoded again: the
   * recorded fact is the answer, and the bytes it names are the ones that exist.
   */
  async encode(request: RenderRequest, lease: PhaseLease): Promise<EncodedFactV1> {
    this.#assertLease(request, lease);
    const recorded = this.#renderDelivery.encodedFact(request.job_id);
    if (recorded !== undefined) {
      this.#assertEncoded(request, recorded);
      return recorded;
    }
    await this.#checkAttempt(request, lease);
    const encoded = await this.#phases.prepareEncoded(request);
    // After the await: the attempt may have been cancelled or superseded while the
    // bytes were being produced.
    await this.#checkAttempt(request, lease);
    this.#assertEncoded(request, encoded);
    this.#renderDelivery.recordEvidence({
      project_id: request.project_id,
      job_id: request.job_id,
      kind: 'encoded',
      encoded,
      now: this.#now(),
    });
    this.#recordWork(request, lease, 'encoded', encoded.receipt_digest, encoded);
    return encoded;
  }

  /**
   * Inspect the encoded object.
   *
   * The encoded fact is resolved from the recorded evidence, never from the caller's
   * memory. The inspection is bound to the run's quality-control gate as a pending
   * binding: the gate's state is the workflow's business, and it moves only with the
   * trusted decision.
   */
  async inspect(request: RenderRequest, lease: PhaseLease): Promise<QcReceiptV1> {
    this.#assertLease(request, lease);
    const encoded = this.#renderDelivery.encodedFact(request.job_id);
    if (encoded === undefined) fail('REVISION_CONFLICT', 'The delivery has no recorded encoded fact');
    this.#assertEncoded(request, encoded);
    const recorded = this.#renderDelivery.qcReceipt(request.job_id);
    if (recorded !== undefined) {
      this.#assertQc(request, encoded, recorded);
      return recorded;
    }
    await this.#checkAttempt(request, lease);
    const qc = await this.#phases.inspectEncoded({ request, encoded });
    await this.#checkAttempt(request, lease);
    this.#assertQc(request, encoded, qc);
    this.#renderDelivery.recordEvidence({
      project_id: request.project_id,
      job_id: request.job_id,
      kind: 'qc',
      qc,
      now: this.#now(),
    });
    this.#renderDelivery.recordPhase({
      project_id: request.project_id,
      job_id: request.job_id,
      phase: 'qc_inspected',
      receipt: qc,
      now: this.#now(),
    });
    this.#reviewGates.bindQcGate({
      project_id: request.project_id,
      run_id: request.execution.run_id,
      gate_id: lease.qc_gate_id,
      gate_kind: 'qc',
      receipt: qc,
      now: this.#now(),
    });
    this.#recordWork(request, lease, 'qc', qc.receipt_digest, qc);
    return qc;
  }

  /**
   * Publish the package from the encoded and inspected bytes.
   *
   * Nothing is rendered again. A blocked inspection is not published, and a warning is
   * published only when every warning has a recorded disposition.
   */
  async publish(request: RenderRequest, lease: PhaseLease): Promise<PublishedPhaseReceiptV1> {
    this.#assertLease(request, lease);
    const encoded = this.#renderDelivery.encodedFact(request.job_id);
    const qc = this.#renderDelivery.qcReceipt(request.job_id);
    if (encoded === undefined || qc === undefined) {
      fail('REVISION_CONFLICT', 'The delivery has no recorded inspection to publish');
    }
    this.#assertEncoded(request, encoded);
    this.#assertQc(request, encoded, qc);
    if (qc.technical_status === 'block') {
      fail('REVISION_CONFLICT', 'The inspection blocked the delivery');
    }
    if (qc.technical_status === 'warn') {
      const dispositions = request.qc_dispositions ?? [];
      const warned = qc.qc_items.filter((item) => item.status === 'warn').map((item) => item.id);
      const missing = warned.filter((id) => !dispositions.includes(id));
      if (missing.length > 0) {
        fail('REVISION_CONFLICT', 'A warned check has no recorded disposition', );
      }
    }
    const publishedPhase = this.#renderDelivery.phase(request.project_id, request.job_id, 'package_published');
    if (publishedPhase !== undefined) {
      return publishedPhase.receipt as PublishedPhaseReceiptV1;
    }
    await this.#checkAttempt(request, lease);
    const published = await this.#phases.publishValidated({ request, encoded, qc });
    await this.#checkAttempt(request, lease);
    this.#assertPublished(encoded, qc, published);
    this.#renderDelivery.recordPhase({
      project_id: request.project_id,
      job_id: request.job_id,
      phase: 'package_published',
      receipt: published,
      now: this.#now(),
    });
    this.#recordWork(request, lease, 'published', published.receipt_digest, published);
    return published;
  }

  /**
   * What a resumed delivery has already done.
   *
   * It reads the recorded evidence, so the recovery decides what to do next from what
   * is durable rather than from what a previous process remembers.
   */
  progress(request: RenderRequest): PhaseProgress {
    const encoded = this.#renderDelivery.encodedFact(request.job_id) ?? null;
    const inspected = this.#renderDelivery.qcReceipt(request.job_id) ?? null;
    const published = this.#renderDelivery.phase(request.project_id, request.job_id, 'package_published');
    return {
      encoded,
      inspected,
      published: published === undefined ? null : published.receipt as PublishedPhaseReceiptV1,
    };
  }

  /** The lease has to be the live lease of the delivery job. */
  #assertLease(request: RenderRequest, lease: PhaseLease): void {
    if (!this.#revisions.holdsLease(request.job_id, lease.owner, lease.lease_attempt, this.#now().getTime())) {
      fail('RUN_SCOPE_REQUIRED', 'The delivery job does not hold a live lease');
    }
    if (request.execution.run_id !== lease.run_id) {
      fail('RUN_SCOPE_REQUIRED', 'The lease belongs to another run');
    }
    if (request.execution.step_id !== lease.step_id) {
      fail('RUN_SCOPE_REQUIRED', 'The lease belongs to another step');
    }
    if (request.execution.attempt !== lease.execution_attempt) {
      fail('RUN_PLAN_STALE', 'The lease belongs to another execution attempt');
    }
    if (request.attempt !== lease.execution_attempt) {
      fail('RUN_PLAN_STALE', 'The request belongs to another attempt');
    }
  }

  /** The fence answers whether this attempt may still act. */
  async #checkAttempt(request: RenderRequest, lease: PhaseLease): Promise<void> {
    const verdict = await this.#fence.checkAttempt({
      project_id: request.project_id,
      job_id: request.job_id,
      attempt: lease.execution_attempt,
      execution: request.execution,
    });
    if (verdict !== 'proceed') {
      fail('RUN_PLAN_STALE', `The attempt may no longer act: ${verdict}`);
    }
  }

  #assertEncoded(request: RenderRequest, encoded: EncodedFactV1): void {
    if (encoded.format !== 'narralens.encoded-fact@1') {
      fail('REVISION_CONFLICT', 'The encoded fact has another format');
    }
    if (encoded.project_id !== request.project_id) {
      fail('REVISION_CONFLICT', 'The encoded fact belongs to another project');
    }
    if (encoded.snapshot_id !== request.snapshot_id) {
      fail('REVISION_CONFLICT', 'The encoded fact is of another snapshot');
    }
    if (encoded.source_digest !== request.source_digest) {
      fail('REVISION_CONFLICT', 'The encoded fact is of another source');
    }
    if (phaseReceiptDigest(encoded) !== encoded.receipt_digest) {
      fail('REVISION_CONFLICT', 'The encoded fact does not match its own digest');
    }
    if (!sameExecution(encoded.producer_execution, request.execution)) {
      fail('RUN_PLAN_STALE', 'The encoded fact was produced by another execution');
    }
  }

  #assertQc(request: RenderRequest, encoded: EncodedFactV1, qc: QcReceiptV1): void {
    if (qc.format !== 'narralens.qc-receipt@1') {
      fail('REVISION_CONFLICT', 'The quality-control receipt has another format');
    }
    if (qc.project_id !== request.project_id) {
      fail('REVISION_CONFLICT', 'The quality-control receipt belongs to another project');
    }
    if (qc.parent_encoded_digest !== encoded.receipt_digest) {
      fail('REVISION_CONFLICT', 'The inspection is of another encoded fact');
    }
    if (phaseReceiptDigest(qc) !== qc.receipt_digest) {
      fail('REVISION_CONFLICT', 'The quality-control receipt does not match its own digest');
    }
  }

  #assertPublished(encoded: EncodedFactV1, qc: QcReceiptV1, published: PublishedPhaseReceiptV1): void {
    if (published.format !== 'narralens.published-phase-receipt@1') {
      fail('REVISION_CONFLICT', 'The published receipt has another format');
    }
    if (published.parent_encoded_digest !== encoded.receipt_digest) {
      fail('REVISION_CONFLICT', 'The publication is of another encoded fact');
    }
    if (published.parent_qc_digest !== qc.receipt_digest) {
      fail('REVISION_CONFLICT', 'The publication is of another inspection');
    }
    if (phaseReceiptDigest(published) !== published.receipt_digest) {
      fail('REVISION_CONFLICT', 'The published receipt does not match its own digest');
    }
  }

  /**
   * The deduplication of the work.
   *
   * The key is the delivery's identity: the project, the run, the plan version, the
   * step, the execution attempt and the digest of the receipt the stage produced. The
   * lease attempt is deliberately not part of it: a new lease for the same execution is
   * the same work.
   */
  #recordWork(
    request: RenderRequest,
    lease: PhaseLease,
    phase: string,
    receiptDigest: string,
    receipt: unknown,
  ): void {
    const key = [
      request.project_id,
      request.execution.run_id,
      String(request.execution.plan_version),
      request.execution.step_id,
      String(request.execution.attempt),
      receiptDigest,
    ].join('|');
    const operationKind = `agent.v1:delivery.phase.${phase}`;
    const found = this.#commands.recall(request.project_id, operationKind, key);
    if (found !== undefined) {
      if (found.request_digest !== canonicalDigest(receipt)) {
        fail('IDEMPOTENCY_CONFLICT', 'The same delivery work already produced a different receipt');
      }
      return;
    }
    this.#commands.record({
      projectId: request.project_id,
      operationKind,
      idempotencyKey: key,
      requestDigest: canonicalDigest(receipt),
      response: { phase, receipt_digest: receiptDigest, lease_attempt: lease.lease_attempt },
      now: this.#now(),
    });
  }
}

/** Whether two executions are the same one. */
export function sameExecution(left: ExecutionBinding, right: ExecutionBinding): boolean {
  return left.run_id === right.run_id
    && left.plan_version === right.plan_version
    && left.step_id === right.step_id
    && left.attempt === right.attempt
    && left.input_digest === right.input_digest
    && left.run_scope_digest === right.run_scope_digest
    && left.authorization_id === right.authorization_id;
}
