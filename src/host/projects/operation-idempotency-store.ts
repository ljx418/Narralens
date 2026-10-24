import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "../api-error.js";
import type { RevisionStore } from "./revision-store.js";

/**
 * OperationIdempotencyStore (ADR-W2.0-004 §4).
 *
 * `operation_idempotency(project_id, operation_kind, idempotency_key)` is the single
 * Wave 2 idempotency authority. M3 introduced it inside `MaterializationStore`; M4A needs
 * exactly the same authority and is explicitly forbidden from creating a second one, so the
 * table moves here and both callers use it. The DDL is byte-for-byte the same, so a database
 * written by M3 opens unchanged.
 *
 * The important addition is the split between `recall`/`record` and `rememberOperation`:
 *
 * - `rememberOperation` is M3's original behaviour — replay-or-insert inside its own
 *   transaction. MaterializationStore still calls exactly this, so M3 is unchanged.
 * - `recall` + `record` are the raw pair, for a caller that must commit *other* rows in the
 *   same transaction as the idempotency response. `RevisionStore.atomic` opens
 *   `BEGIN IMMEDIATE` and is not reentrant, so an impact row and its response cannot both
 *   be written by two nested `atomic` calls; the caller wraps both in one.
 *
 * Both halves are the same table and the same key, so there is exactly one place where an
 * idempotency key is decided.
 */
export interface OperationResponse {
  readonly request_digest: string;
  readonly response_json: string;
  readonly transaction_id: string;
}

export class OperationIdempotencyStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS operation_idempotency (
        project_id TEXT NOT NULL, operation_kind TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        request_digest TEXT NOT NULL, response_json TEXT NOT NULL,
        transaction_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, operation_kind, idempotency_key)
      );
    `);
  }

  /** The stored response for this key, or `undefined`. Never throws on a digest mismatch. */
  recall(projectId: string, operationKind: string, idempotencyKey: string): OperationResponse | undefined {
    const row = this.#db.prepare(
      "SELECT request_digest, response_json, transaction_id FROM operation_idempotency WHERE project_id=? AND operation_kind=? AND idempotency_key=?",
    ).get(projectId, operationKind, idempotencyKey) as
      { request_digest?: unknown; response_json?: unknown; transaction_id?: unknown } | undefined;
    if (row === undefined) return undefined;
    return {
      request_digest: String(row.request_digest),
      response_json: String(row.response_json),
      transaction_id: row.transaction_id === null || row.transaction_id === undefined ? "" : String(row.transaction_id),
    };
  }

  /**
   * The single definition of "this key was used with a different request".
   *
   * A replay must present the same request, so a same-key/different-digest call is a
   * conflict the client has to resolve with a new key — never a replacement that quietly
   * discards the original authorization.
   */
  assertSameRequest(found: OperationResponse, requestDigest: string, operationKind: string,
    projectId: string, correlationId?: string): void {
    if (found.request_digest !== requestDigest) {
      // The correlation id is the request's, not the project's. The project id was being put
      // in the correlation-id slot, so the same conflict could be answered with two different
      // bodies depending on which path noticed it.
      throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT",
        "This idempotency key was used with a different request",
        { operation_kind: operationKind }, correlationId ?? projectId);
    }
  }

  /** Raw insert. Must be called inside a transaction the caller controls. */
  record(input: {
    projectId: string; operationKind: string; idempotencyKey: string;
    requestDigest: string; response: unknown; transactionId?: string; now?: Date;
  }): void {
    this.#db.prepare(
      `INSERT INTO operation_idempotency(project_id, operation_kind, idempotency_key, request_digest, response_json, transaction_id, created_at)
       VALUES(?,?,?,?,?,?,?)`,
    ).run(input.projectId, input.operationKind, input.idempotencyKey, input.requestDigest,
      JSON.stringify(input.response), input.transactionId ?? "", (input.now ?? new Date()).toISOString());
  }

  /**
   * M3's exact behaviour, on a seam of its own so an outer transaction is never nested
   * inside this one.
   */
  rememberOperation(revisions: RevisionStore, input: {
    projectId: string; operationKind: string; idempotencyKey: string;
    requestDigest: string; response: unknown; transactionId?: string; now?: Date;
  }): { replayed: boolean; response: unknown } {
    return revisions.atomic(() => {
      const found = this.recall(input.projectId, input.operationKind, input.idempotencyKey);
      if (found !== undefined) {
        this.assertSameRequest(found, input.requestDigest, input.operationKind, input.projectId);
        return { replayed: true, response: JSON.parse(found.response_json) as unknown };
      }
      this.record(input);
      return { replayed: false, response: input.response };
    });
  }

  forgetOperation(projectId: string, operationKind: string, idempotencyKey: string): void {
    this.#db.prepare(
      "DELETE FROM operation_idempotency WHERE project_id=? AND operation_kind=? AND idempotency_key=?",
    ).run(projectId, operationKind, idempotencyKey);
  }
}
