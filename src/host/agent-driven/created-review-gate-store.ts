import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import { phaseReceiptDigest } from '../render/ports.js';
import type { QcReceiptV1 } from '../render/ports.js';
import type { RunGate } from '../../contracts/agent-driven-types.js';

/**
 * The binding of a run's gate to the evidence that backs it.
 *
 * The quality-control gate is bound to the receipt of a real inspection, and to
 * nothing else: a chapter package is not a quality-control inspection, and a gate
 * that names one is not backed by it.
 *
 * The table has no state column. The gate's state lives in the run's checkpoint, where
 * the workflow service owns it, and it moves to `accepted` only with the trusted human
 * decision that the workflow service registers in the same transaction. A binding is a
 * fact about the evidence, not a decision.
 */
export const CREATED_REVIEW_GATE_BINDING_DDL = `
CREATE TABLE created_review_gate_binding (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  gate_kind TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  PRIMARY KEY(project_id, run_id, gate_id)
);
CREATE TRIGGER created_review_gate_binding_no_update BEFORE UPDATE ON created_review_gate_binding BEGIN SELECT RAISE(ABORT,'immutable review gate binding'); END;
CREATE TRIGGER created_review_gate_binding_no_delete BEFORE DELETE ON created_review_gate_binding BEGIN SELECT RAISE(ABORT,'immutable review gate binding'); END;
`;

/** The failure of the review gate store. */
export class CreatedReviewGateError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND',
    message: string) {
    super(message);
    this.name = 'CreatedReviewGateError';
  }
}

function fail(code: CreatedReviewGateError['code'], message: string): never {
  throw new CreatedReviewGateError(code, message);
}

/** One bound gate. */
export interface CreatedReviewGateBinding {
  readonly project_id: string;
  readonly run_id: string;
  readonly gate_id: string;
  readonly gate_kind: RunGate["kind"];
  readonly receipt_digest: string;
  readonly receipt: QcReceiptV1;
  readonly bound_at: string;
}

/**
 * The store of the gate bindings.
 *
 * It is the one place that says "this gate is backed by this receipt". The transport
 * and the workflow read it; nothing writes a gate's state through it.
 */
export class CreatedReviewGateStore {
  readonly #db: DatabaseSync;
  #schemaVersion = -1;

  constructor(revisions: RevisionStore) {
    this.#db = revisions.compose((db) => db);
    this.#schema();
  }

  #schema(): void {
    const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    if (version === this.#schemaVersion) return;
    const found = this.#db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'created_review_gate_binding' LIMIT 1").get();
    if (found === undefined) {
      this.#db.exec(CREATED_REVIEW_GATE_BINDING_DDL);
    } else if (!matchesFrozenSchemaNamespace(this.#db, CREATED_REVIEW_GATE_BINDING_DDL, 'created_review_gate_binding')) {
      fail('REVISION_CONFLICT', 'The review gate binding schema differs from the one this build expects');
    }
    this.#schemaVersion = version;
  }

  /**
   * Bind the quality-control gate of a run to the receipt of a real inspection.
   *
   * The receipt's own digest is recomputed before it is bound, so an edited receipt is
   * refused. Binding the same gate to the same receipt again is a replay; binding it
   * to a different receipt is a contradiction and is refused, because a gate that
   * changed its evidence is a gate whose decision means something else.
   */
  bindQcGate(input: {
    readonly project_id: string;
    readonly run_id: string;
    readonly gate_id: string;
    readonly gate_kind: RunGate["kind"];
    readonly receipt: QcReceiptV1;
    readonly now: Date;
  }): CreatedReviewGateBinding {
    this.#schema();
    const receipt = input.receipt;
    if (receipt.format !== 'narralens.qc-receipt@1') {
      fail('INVALID_REQUEST', 'The gate is bound to something that is not a quality-control receipt');
    }
    if (receipt.project_id !== input.project_id) {
      fail('INVALID_REQUEST', 'The receipt belongs to another project');
    }
    if (phaseReceiptDigest(receipt) !== receipt.receipt_digest) {
      fail('REVISION_CONFLICT', 'The quality-control receipt does not match its own digest');
    }
    const existing = this.binding(input.project_id, input.run_id, input.gate_id);
    if (existing !== undefined) {
      if (existing.receipt_digest !== receipt.receipt_digest) {
        fail('IDEMPOTENCY_CONFLICT', 'The gate is already bound to another receipt');
      }
      return existing;
    }
    const at = input.now.toISOString();
    this.#db.prepare(`INSERT INTO created_review_gate_binding(
      project_id, run_id, gate_id, gate_kind, receipt_digest, receipt_json, bound_at)
      VALUES(?,?,?,?,?,?,?)`).run(
      input.project_id, input.run_id, input.gate_id, input.gate_kind,
      receipt.receipt_digest, canonicalJson(receipt), at);
    return {
      project_id: input.project_id,
      run_id: input.run_id,
      gate_id: input.gate_id,
      gate_kind: input.gate_kind,
      receipt_digest: receipt.receipt_digest,
      receipt,
      bound_at: at,
    };
  }

  /** The binding of one gate, or `undefined`. */
  binding(projectId: string, runId: string, gateId: string): CreatedReviewGateBinding | undefined {
    this.#schema();
    const row = this.#db.prepare(`SELECT * FROM created_review_gate_binding
      WHERE project_id=? AND run_id=? AND gate_id=?`).get(projectId, runId, gateId) as
      Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      project_id: String(row.project_id),
      run_id: String(row.run_id),
      gate_id: String(row.gate_id),
      gate_kind: String(row.gate_kind) as RunGate["kind"],
      receipt_digest: String(row.receipt_digest),
      receipt: JSON.parse(String(row.receipt_json)) as QcReceiptV1,
      bound_at: String(row.bound_at),
    };
  }

  /** The quality-control gate binding of a run, or `undefined`. */
  qcGateBinding(projectId: string, runId: string): CreatedReviewGateBinding | undefined {
    this.#schema();
    const row = this.#db.prepare(`SELECT gate_id FROM created_review_gate_binding
      WHERE project_id=? AND run_id=? AND gate_kind='qc' ORDER BY bound_at, gate_id LIMIT 1`)
      .get(projectId, runId) as { gate_id?: string } | undefined;
    if (row === undefined) return undefined;
    return this.binding(projectId, runId, String(row.gate_id));
  }
}
