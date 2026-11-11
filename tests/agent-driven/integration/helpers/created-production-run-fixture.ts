import { RevisionStore } from "../../../../src/host/projects/revision-store.js";
import { ProductSqliteRepository } from "../../../../src/host/agent-driven/product-sqlite-repository.js";
import { CreatedRenderDeliveryStore } from "../../../../src/host/agent-driven/created-render-delivery-store.js";
import { CreatedReviewGateStore } from "../../../../src/host/agent-driven/created-review-gate-store.js";
import { FixedPhaseExecutor, type PhaseLease } from "../../../../src/host/agent-driven/fixed-phase-executor.js";
import { phaseReceiptDigest } from "../../../../src/host/render/ports.js";
import type {
  AttemptFencePort,
  CommittedRenderPhasesPort,
  EncodedFactV1,
  PublishedPhaseReceiptV1,
  QcReceiptV1,
  RenderRequest,
} from "../../../../src/host/render/ports.js";
import type { DeliveryManifest, QCItem, RenderSpec } from "../../../../src/contracts/agent-driven-types.js";

/**
 * The delivery run fixture.
 *
 * It builds the REAL parts of a delivery run: the database, the job, its live lease,
 * the evidence stores and the phase executor. What it does NOT build is the MEDIA
 * producer: the phase port is a double, because the real producer is not in this
 * repository.
 *
 * So this fixture is evidence about BRIDGE's side of the chain and about nothing else.
 * It never asserts that a capability is available, and a production composition that
 * used it would be claiming something it cannot prove. The production run fixture of
 * the real four capabilities is a different thing and does not live here.
 */
export const DELIVERY_NOW = new Date('2026-11-12T00:00:00.000Z');
export const DELIVERY_OWNER = 'worker-1';

export const DELIVERY_EXECUTION = {
  run_id: 'run-1',
  plan_version: 1 as const,
  step_id: 'delivery',
  attempt: 1,
  input_digest: 'a'.repeat(64),
  run_scope_digest: 'b'.repeat(64),
  authorization_id: 'grant-1',
} as const;

export const DELIVERY_SPEC: RenderSpec = {
  engine_id: 'openfilm',
  engine_version: '1.0.0',
  config_digest: 'c'.repeat(64),
  width: 1280,
  height: 720,
  fps_numerator: 30,
  fps_denominator: 1,
  container: 'mp4',
  video_codec: 'h264',
  audio_codec: 'aac',
};

export const DELIVERY_MANIFEST: DeliveryManifest = {
  delivery_id: 'delivery-1',
  project_id: 'project-1',
  snapshot_id: 'snapshot-1',
  source_digest: 'd'.repeat(64),
  render_spec: DELIVERY_SPEC,
  render_config_digest: 'c'.repeat(64),
  attempt: 1,
  media_ref: { id: 'media-1', version: 1, sha256: 'e'.repeat(64) },
  ffprobe_ref: { id: 'probe-1', version: 1, sha256: 'f'.repeat(64) },
  full_decode_ref: { id: 'decode-1', version: 1, sha256: '0'.repeat(64) },
  supplement_refs: [],
  qc: [],
  published_at: '2026-11-12T00:00:00.000Z',
  download_ref: 'download-1',
};

/** The encoded fact of a request, with its own digest. */
export function encodedFactOf(request: RenderRequest): EncodedFactV1 {
  const content = {
    format: 'narralens.encoded-fact@1' as const,
    project_id: request.project_id,
    job_id: request.job_id,
    producer_execution: request.execution,
    producer_lease_attempt: request.attempt,
    snapshot_id: request.snapshot_id,
    source_digest: request.source_digest,
    render_spec: request.render_spec,
    config_digest: 'c'.repeat(64),
    media_object_id: 'object-encoded',
    media_ref: { id: 'media-1', version: 1, sha256: 'e'.repeat(64) },
    files: [{ id: 'f-1', relative_path: 'film.mp4', role: 'media', bytes: 1024, sha256: '1'.repeat(64) }],
    frame_count: 90,
    fps_numerator: 30,
    fps_denominator: 1,
    closure_digest: request.source_digest,
    rights_digest: '2'.repeat(64),
    created_at: '2026-11-12T00:00:00.000Z',
  };
  return { ...content, receipt_digest: phaseReceiptDigest(content as unknown as EncodedFactV1) };
}

/** The quality-control receipt of an encoded fact, with its own digest. */
export function qcReceiptOf(
  encoded: EncodedFactV1,
  status: QcReceiptV1['technical_status'],
  items: readonly QCItem[] = [],
): QcReceiptV1 {
  const content = {
    format: 'narralens.qc-receipt@1' as const,
    project_id: encoded.project_id,
    snapshot_id: encoded.snapshot_id,
    source_digest: encoded.source_digest,
    config_digest: encoded.config_digest,
    parent_encoded_digest: encoded.receipt_digest,
    qc_object_id: 'object-qc',
    qc_items: items,
    technical_status: status,
    files: [{ id: 'q-1', relative_path: 'probe.json', role: 'media', bytes: 12, sha256: '3'.repeat(64) }],
    created_at: '2026-11-12T00:00:00.000Z',
  };
  return { ...content, receipt_digest: phaseReceiptDigest(content as unknown as QcReceiptV1) };
}

/** The published receipt of an encoded fact and its inspection, with its own digest. */
export function publishedReceiptOf(encoded: EncodedFactV1, qc: QcReceiptV1): PublishedPhaseReceiptV1 {
  const content = {
    format: 'narralens.published-phase-receipt@1' as const,
    package_receipt: {
      kind: 'narralens.delivery_package_receipt@1.0' as const,
      package_id: 'package-1',
      object_id: 'object-package',
      delivery_id: 'delivery-1',
      project_id: encoded.project_id,
      snapshot_id: encoded.snapshot_id,
      source_digest: encoded.source_digest,
      render_config_digest: encoded.config_digest,
      attempt: 1,
      download_ref: 'download-1',
      published_at: '2026-11-12T00:00:00.000Z',
      manifest: DELIVERY_MANIFEST,
      files: [{ id: 'f-1', file: 'film.mp4', sha256: '1'.repeat(64), bytes: 1024 }],
    },
    parent_encoded_digest: encoded.receipt_digest,
    parent_qc_digest: qc.receipt_digest,
    publication_execution: encoded.producer_execution,
    publication_lease_attempt: 1,
  };
  return { ...content, receipt_digest: phaseReceiptDigest(content as unknown as PublishedPhaseReceiptV1) };
}

/** The live delivery fixture. */
export interface DeliveryPhaseFixture {
  readonly revisions: RevisionStore;
  readonly request: RenderRequest;
  readonly lease: PhaseLease;
  readonly executor: FixedPhaseExecutor;
  readonly delivery: CreatedRenderDeliveryStore;
  readonly gates: CreatedReviewGateStore;
  readonly calls: { encode: number; inspect: number; publish: number };
  setStatus: (status: QcReceiptV1['technical_status']) => void;
  setItems: (items: readonly QCItem[]) => void;
  setVerdict: (verdict: 'proceed' | 'cancelled' | 'superseded') => void;
  /** Gives the lease up, so the next call has no live lease. */
  release: () => void;
}

/**
 * A delivery run with a real job, a real lease and the real stores.
 *
 * The phase port is a double whose receipts carry their own correct digests, and the
 * fence is a double whose verdict the test controls.
 */
export function createDeliveryPhaseFixture(): DeliveryPhaseFixture {
  const revisions = new RevisionStore(':memory:');
  // The agent schema is applied on the same connection in production, and it carries
  // the unique index the evidence's foreign key refers to.
  new ProductSqliteRepository(revisions);
  const jobId = 'job-delivery';
  revisions.createJobRow({
    job_id: jobId,
    project_id: 'project-1',
    kind: 'snapshot_publish',
    payload_digest: '4'.repeat(64),
    state: 'queued',
    lease_owner: null,
    lease_expires_at: null,
    attempt: 0,
    max_attempts: 3,
    cost_status: 'unknown',
    created_at: DELIVERY_NOW.toISOString(),
    updated_at: DELIVERY_NOW.toISOString(),
  });
  if (!revisions.tryAcquireLease(jobId, DELIVERY_OWNER, DELIVERY_NOW.getTime(), DELIVERY_NOW.getTime() + 60000)) {
    throw new Error('the fixture could not take the delivery lease');
  }
  const request: RenderRequest = {
    project_id: 'project-1',
    job_id: jobId,
    snapshot_id: 'snapshot-1',
    source_digest: 'd'.repeat(64),
    render_spec: DELIVERY_SPEC,
    execution: DELIVERY_EXECUTION,
    attempt: 1,
    qc_dispositions: undefined,
    required_supplements: [],
    signal: undefined,
  };
  const lease: PhaseLease = {
    owner: DELIVERY_OWNER,
    lease_attempt: 1,
    execution_attempt: 1,
    run_id: DELIVERY_EXECUTION.run_id,
    step_id: DELIVERY_EXECUTION.step_id,
    qc_gate_id: 'gate-qc',
  };
  const calls = { encode: 0, inspect: 0, publish: 0 };
  let status: QcReceiptV1['technical_status'] = 'pass';
  let items: readonly QCItem[] = [];
  const phases: CommittedRenderPhasesPort = {
    prepareEncoded: async (req) => { calls.encode += 1; return encodedFactOf(req); },
    inspectEncoded: async ({ encoded }) => { calls.inspect += 1; return qcReceiptOf(encoded, status, items); },
    publishValidated: async ({ encoded, qc }) => { calls.publish += 1; return publishedReceiptOf(encoded, qc); },
  };
  let verdict: 'proceed' | 'cancelled' | 'superseded' = 'proceed';
  const fence: AttemptFencePort = {
    claimAttempt: async () => true,
    checkAttempt: async () => verdict,
    releaseAttempt: async () => undefined,
  };
  const delivery = new CreatedRenderDeliveryStore(revisions);
  const gates = new CreatedReviewGateStore(revisions);
  const executor = new FixedPhaseExecutor({
    revisions,
    phases,
    fence,
    renderDelivery: delivery,
    reviewGates: gates,
    now: () => DELIVERY_NOW,
  });
  return {
    revisions,
    request,
    lease,
    executor,
    delivery,
    gates,
    calls,
    setStatus: (value) => { status = value; },
    setItems: (value) => { items = value; },
    setVerdict: (value) => { verdict = value; },
    release: () => { revisions.releaseLease(jobId, DELIVERY_OWNER, DELIVERY_NOW.getTime()); },
  };
}
