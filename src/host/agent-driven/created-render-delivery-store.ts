import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import { phaseReceiptDigest } from '../render/ports.js';
import type { EncodedFactV1, QcReceiptV1, PublishedPhaseReceiptV1 } from '../render/ports.js';
import type { ExecutionBinding } from '../../contracts/agent-driven-types.js';

/**
 * The immutable evidence of a delivery, and the phases it has reached.
 *
 * Two tables, and neither of them has a state column.
 *
 * - `created_render_evidence` is the raw evidence of one stage: the encoded fact or
 *   the quality-control receipt, with the files, their bytes and their hashes, and
 *   the QC items exactly as the inspection recorded them.
 * - `created_delivery_phase_fact` says which phases of one delivery job have happened.
 *   It is what a recovery reads: the presence of the immutable evidence decides what
 *   to do next, and the job and the step attempt remain the only progress state.
 *
 * Both are attached to the real job by a foreign key, so an evidence row cannot
 * outlive or invent the job it belongs to. Neither of them is a second "ready": the
 * formal readiness authority stays where it was.
 */
export const CREATED_RENDER_EVIDENCE_DDL = `
CREATE TABLE created_render_evidence (
  evidence_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  producer_execution_json TEXT NOT NULL,
  producer_lease_attempt INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('encoded','qc')),
  receipt_json TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  media_object_id TEXT NOT NULL,
  files_json TEXT NOT NULL,
  qc_items_json TEXT NOT NULL,
  technical_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id, job_id) REFERENCES job(project_id, job_id)
);
CREATE TRIGGER created_render_evidence_no_update BEFORE UPDATE ON created_render_evidence BEGIN SELECT RAISE(ABORT,'immutable render evidence'); END;
CREATE TRIGGER created_render_evidence_no_delete BEFORE DELETE ON created_render_evidence BEGIN SELECT RAISE(ABORT,'immutable render evidence'); END;
`;

export const CREATED_DELIVERY_PHASE_FACT_DDL = `
CREATE TABLE created_delivery_phase_fact (
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('qc_inspected','package_published')),
  receipt_json TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  PRIMARY KEY(project_id, job_id, phase),
  FOREIGN KEY(project_id, job_id) REFERENCES job(project_id, job_id)
);
CREATE TRIGGER created_delivery_phase_fact_no_update BEFORE UPDATE ON created_delivery_phase_fact BEGIN SELECT RAISE(ABORT,'immutable delivery phase fact'); END;
CREATE TRIGGER created_delivery_phase_fact_no_delete BEFORE DELETE ON created_delivery_phase_fact BEGIN SELECT RAISE(ABORT,'immutable delivery phase fact'); END;
`;

/** Both fragments, in the order they are created. */
export const CREATED_RENDER_DELIVERY_DDL = `${CREATED_RENDER_EVIDENCE_DDL}${CREATED_DELIVERY_PHASE_FACT_DDL}`;

/** The failure of the render delivery store. */
export class CreatedRenderDeliveryError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND',
    message: string) {
    super(message);
    this.name = 'CreatedRenderDeliveryError';
  }
}

function fail(code: CreatedRenderDeliveryError['code'], message: string): never {
  throw new CreatedRenderDeliveryError(code, message);
}

const HASH = /^[a-f0-9]{64}$/;

/** The phase a delivery has reached. */
export type CreatedDeliveryPhase = 'qc_inspected' | 'package_published';

/** One recorded evidence row. */
export interface CreatedRenderEvidenceRow {
  readonly evidence_id: string;
  readonly project_id: string;
  readonly job_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly config_digest: string;
  readonly producer_execution: ExecutionBinding;
  readonly producer_lease_attempt: number;
  readonly kind: 'encoded' | 'qc';
  readonly receipt_digest: string;
  readonly media_object_id: string;
  readonly technical_status: string;
  readonly created_at: string;
}

/** The input of one recorded evidence row. */
export interface RecordRenderEvidenceInput {
  readonly project_id: string;
  readonly job_id: string;
  readonly kind: 'encoded' | 'qc';
  readonly encoded?: EncodedFactV1;
  readonly qc?: QcReceiptV1;
  readonly now: Date;
}

/**
 * The store of the delivery evidence.
 *
 * It lives on the original database, so the evidence of a delivery and the job it
 * belongs to are in one place, and a second database could never hold half of a
 * delivery.
 */
export class CreatedRenderDeliveryStore {
  readonly #db: DatabaseSync;
  #schemaVersion = -1;

  constructor(revisions: RevisionStore) {
    this.#db = revisions.compose((db) => db);
    this.#schema();
  }

  #schema(): void {
    const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    if (version === this.#schemaVersion) return;
    const found = this.#db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'created_render_evidence' LIMIT 1").get();
    if (found === undefined) {
      this.#db.exec(CREATED_RENDER_EVIDENCE_DDL);
      this.#db.exec(CREATED_DELIVERY_PHASE_FACT_DDL);
    } else if (!matchesFrozenSchemaNamespace(this.#db, CREATED_RENDER_EVIDENCE_DDL, 'created_render_evidence') ||
      !matchesFrozenSchemaNamespace(this.#db, CREATED_DELIVERY_PHASE_FACT_DDL, 'created_delivery_phase_fact')) {
      fail('REVISION_CONFLICT', 'The render delivery schema differs from the one this build expects');
    }
    this.#schemaVersion = version;
  }

  /**
   * Record the evidence of one stage.
   *
   * The receipt's own digest is recomputed before it is stored, so an edited receipt
   * is refused rather than kept. Recording the same evidence twice is a replay; a
   * different receipt under the same identity is a contradiction.
   */
  recordEvidence(input: RecordRenderEvidenceInput): CreatedRenderEvidenceRow {
    this.#schema();
    if (input.kind === 'encoded') {
      const encoded = input.encoded;
      if (encoded === undefined) fail('INVALID_REQUEST', 'The encoded evidence is missing');
      if (encoded.format !== 'narralens.encoded-fact@1') fail('INVALID_REQUEST', 'The encoded fact has another format');
      if (encoded.project_id !== input.project_id) fail('INVALID_REQUEST', 'The encoded fact belongs to another project');
      if (phaseReceiptDigest(encoded) !== encoded.receipt_digest) {
        fail('REVISION_CONFLICT', 'The encoded fact does not match its own digest');
      }
      const row: CreatedRenderEvidenceRow = {
        evidence_id: `${input.job_id}:encoded`,
        project_id: input.project_id,
        job_id: input.job_id,
        snapshot_id: encoded.snapshot_id,
        source_digest: encoded.source_digest,
        config_digest: encoded.config_digest,
        producer_execution: encoded.producer_execution,
        producer_lease_attempt: encoded.producer_lease_attempt,
        kind: 'encoded',
        receipt_digest: encoded.receipt_digest,
        media_object_id: encoded.media_object_id,
        technical_status: 'encoded',
        created_at: input.now.toISOString(),
      };
      this.#writeEvidence(row, encoded, [], 'encoded', input.now);
      return row;
    }
    const qc = input.qc;
    if (qc === undefined) fail('INVALID_REQUEST', 'The quality-control evidence is missing');
    if (qc.format !== 'narralens.qc-receipt@1') fail('INVALID_REQUEST', 'The quality-control receipt has another format');
    if (qc.project_id !== input.project_id) fail('INVALID_REQUEST', 'The quality-control receipt belongs to another project');
    if (phaseReceiptDigest(qc) !== qc.receipt_digest) {
      fail('REVISION_CONFLICT', 'The quality-control receipt does not match its own digest');
    }
    const row: CreatedRenderEvidenceRow = {
      evidence_id: `${input.job_id}:qc`,
      project_id: input.project_id,
      job_id: input.job_id,
      snapshot_id: qc.snapshot_id,
      source_digest: qc.source_digest,
      config_digest: qc.config_digest,
      producer_execution: { run_id: '', plan_version: 1, step_id: '', attempt: 1, input_digest: '', run_scope_digest: '', authorization_id: '' },
      producer_lease_attempt: 0,
      kind: 'qc',
      receipt_digest: qc.receipt_digest,
      media_object_id: qc.qc_object_id,
      technical_status: qc.technical_status,
      created_at: input.now.toISOString(),
    };
    this.#writeEvidence(row, qc, qc.qc_items, qc.technical_status, input.now);
    return row;
  }

  #writeEvidence(
    row: CreatedRenderEvidenceRow,
    receipt: EncodedFactV1 | QcReceiptV1,
    qcItems: readonly unknown[],
    technicalStatus: string,
    now: Date,
  ): void {
    const existing = this.evidence(row.evidence_id);
    if (existing !== undefined) {
      if (existing.receipt_digest !== row.receipt_digest) {
        fail('IDEMPOTENCY_CONFLICT', 'Another receipt is already recorded for this evidence');
      }
      return;
    }
    this.#db.prepare(`INSERT INTO created_render_evidence(
      evidence_id, project_id, job_id, snapshot_id, source_digest, config_digest,
      producer_execution_json, producer_lease_attempt, kind, receipt_json, receipt_digest,
      media_object_id, files_json, qc_items_json, technical_status, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.evidence_id, row.project_id, row.job_id, row.snapshot_id, row.source_digest,
      row.config_digest, canonicalJson(row.producer_execution), row.producer_lease_attempt,
      row.kind, canonicalJson(receipt), row.receipt_digest, row.media_object_id,
      canonicalJson('files' in receipt ? receipt.files : []), canonicalJson(qcItems),
      technicalStatus, now.toISOString());
  }

  /** One recorded evidence row, or `undefined`. */
  evidence(evidenceId: string): CreatedRenderEvidenceRow | undefined {
    this.#schema();
    const row = this.#db.prepare('SELECT * FROM created_render_evidence WHERE evidence_id=?').get(evidenceId) as
      Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      evidence_id: String(row.evidence_id),
      project_id: String(row.project_id),
      job_id: String(row.job_id),
      snapshot_id: String(row.snapshot_id),
      source_digest: String(row.source_digest),
      config_digest: String(row.config_digest),
      producer_execution: JSON.parse(String(row.producer_execution_json)) as ExecutionBinding,
      producer_lease_attempt: Number(row.producer_lease_attempt),
      kind: String(row.kind) as 'encoded' | 'qc',
      receipt_digest: String(row.receipt_digest),
      media_object_id: String(row.media_object_id),
      technical_status: String(row.technical_status),
      created_at: String(row.created_at),
    };
  }

  /** The recorded encoded fact of a job, or `undefined`. */
  encodedFact(jobId: string): EncodedFactV1 | undefined {
    const row = this.#db.prepare("SELECT receipt_json FROM created_render_evidence WHERE evidence_id=?")
      .get(`${jobId}:encoded`) as { receipt_json?: string } | undefined;
    if (row === undefined || typeof row.receipt_json !== 'string') return undefined;
    return JSON.parse(row.receipt_json) as EncodedFactV1;
  }

  /** The recorded quality-control receipt of a job, or `undefined`. */
  qcReceipt(jobId: string): QcReceiptV1 | undefined {
    const row = this.#db.prepare("SELECT receipt_json FROM created_render_evidence WHERE evidence_id=?")
      .get(`${jobId}:qc`) as { receipt_json?: string } | undefined;
    if (row === undefined || typeof row.receipt_json !== 'string') return undefined;
    return JSON.parse(row.receipt_json) as QcReceiptV1;
  }

  /**
   * Record that a phase of the delivery has happened.
   *
   * The record is a fact about the receipt, not a state of the job. Recording the same
   * phase twice with the same receipt is a replay; a different receipt under the same
   * phase is a contradiction and is refused.
   */
  recordPhase(input: {
    readonly project_id: string;
    readonly job_id: string;
    readonly phase: CreatedDeliveryPhase;
    readonly receipt: QcReceiptV1 | PublishedPhaseReceiptV1;
    readonly now: Date;
  }): void {
    this.#schema();
    if (phaseReceiptDigest(input.receipt) !== input.receipt.receipt_digest) {
      fail('REVISION_CONFLICT', 'The phase receipt does not match its own digest');
    }
    const existing = this.phase(input.project_id, input.job_id, input.phase);
    if (existing !== undefined) {
      if (existing.receipt_digest !== input.receipt.receipt_digest) {
        fail('IDEMPOTENCY_CONFLICT', 'Another receipt is already recorded for this phase');
      }
      return;
    }
    // The sequence is the order the phases were recorded in. The clock alone cannot
    // order them: two phases of the same delivery can share a timestamp, and a
    // delivery whose inspection and publication happened in the same second still has
    // an order.
    const sequence = Number((this.#db.prepare(`SELECT COUNT(*) AS n FROM created_delivery_phase_fact
      WHERE project_id=? AND job_id=?`).get(input.project_id, input.job_id) as { n: number }).n);
    this.#db.prepare(`INSERT INTO created_delivery_phase_fact(
      project_id, job_id, phase, receipt_json, receipt_digest, created_at, sequence)
      VALUES(?,?,?,?,?,?,?)`).run(
      input.project_id, input.job_id, input.phase, canonicalJson(input.receipt),
      input.receipt.receipt_digest, input.now.toISOString(), sequence);
  }

  /** The recorded phase of a delivery, or `undefined`. */
  phase(projectId: string, jobId: string, phase: CreatedDeliveryPhase): {
    readonly receipt_digest: string;
    readonly receipt: unknown;
    readonly created_at: string;
  } | undefined {
    this.#schema();
    const row = this.#db.prepare(`SELECT receipt_json, receipt_digest, created_at FROM created_delivery_phase_fact
      WHERE project_id=? AND job_id=? AND phase=?`).get(projectId, jobId, phase) as
      Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      receipt_digest: String(row.receipt_digest),
      receipt: JSON.parse(String(row.receipt_json)) as unknown,
      created_at: String(row.created_at),
    };
  }

  /** The phases of a delivery that have happened, in order. */
  phases(projectId: string, jobId: string): CreatedDeliveryPhase[] {
    this.#schema();
    return (this.#db.prepare(`SELECT phase FROM created_delivery_phase_fact
      WHERE project_id=? AND job_id=? ORDER BY sequence, phase`).all(projectId, jobId) as Array<Record<string, unknown>>)
      .map((row) => String(row.phase) as CreatedDeliveryPhase);
  }

  /** The digest of the recorded encoded fact of a job, when there is one. */
  encodedDigest(jobId: string): string | undefined {
    return this.encodedFact(jobId)?.receipt_digest;
  }
}

/** The hash of a QC item list, so two inspections of the same bytes can be compared. */
export function qcItemsDigest(items: readonly unknown[]): string {
  return canonicalJson(items);
}

/** Whether a digest is a real lowercase SHA-256. */
export function isRenderDigest(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value);
}
