import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import type { ReviewMediaBinding, ReviewMediaBindingPort } from './review-media-http.js';
import type { PreparedPreviewPartKind, PreparedPreviewReceiptV1 } from '../../contracts/prepared-preview.js';
import type { ReviewPackage, ReviewPart } from '../../contracts/agent-driven-types.js';

/**
 * The immutable binding of a review package's parts to their preview objects.
 *
 * The transport never invents a binding: it asks this table, and this table only
 * holds what the real publication wrote. A part that has no row here is not served,
 * and a package that was never published has no rows at all.
 *
 * The table is append-only. A binding that could change would let the same package
 * serve two different objects.
 */
export const CREATED_REVIEW_MEDIA_BINDING_DDL = `
CREATE TABLE created_review_media_binding (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_version INTEGER NOT NULL,
  package_digest TEXT NOT NULL,
  part_kind TEXT NOT NULL,
  artifact_ref_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  object_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  prepared_source_id TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  PRIMARY KEY(project_id, package_id, package_version, part_kind)
);
CREATE TRIGGER created_review_media_binding_no_update BEFORE UPDATE ON created_review_media_binding BEGIN SELECT RAISE(ABORT,'immutable review media binding'); END;
CREATE TRIGGER created_review_media_binding_no_delete BEFORE DELETE ON created_review_media_binding BEGIN SELECT RAISE(ABORT,'immutable review media binding'); END;
`;

/** The failure of the review media bindings. */
export class CreatedReviewMediaBindingError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND',
    message: string) {
    super(message);
    this.name = 'CreatedReviewMediaBindingError';
  }
}

function fail(code: CreatedReviewMediaBindingError['code'], message: string): never {
  throw new CreatedReviewMediaBindingError(code, message);
}

const HASH = /^[a-f0-9]{64}$/;

/** The input of one binding of a published package. */
export interface BindReviewPackageInput {
  readonly project_id: string;
  readonly run_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly package_digest: string;
  /** The immutable preview receipt the package binds. */
  readonly receipt: PreparedPreviewReceiptV1;
  /** The parts of the published package, in the package's own order. */
  readonly parts: readonly ReviewPart[];
  readonly now: Date;
}

/**
 * The producer of the review media bindings.
 *
 * It resolves the CURRENT package of a run and the immutable receipt linkage of one of
 * its parts. The current package is the one the review table itself names; it is not a
 * guess and not the newest row anybody wrote.
 */
export class CreatedReviewMediaBindings implements ReviewMediaBindingPort {
  readonly #db: DatabaseSync;
  #schemaVersion = -1;

  constructor(revisions: RevisionStore) {
    this.#db = revisions.compose((db) => db);
    this.#schema();
  }

  #schema(): void {
    const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    if (version === this.#schemaVersion) return;
    const found = this.#db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'created_review_media_binding' LIMIT 1").get();
    if (found === undefined) {
      this.#db.exec(CREATED_REVIEW_MEDIA_BINDING_DDL);
    } else if (!matchesFrozenSchemaNamespace(this.#db, CREATED_REVIEW_MEDIA_BINDING_DDL, 'created_review_media_binding')) {
      fail('REVISION_CONFLICT', 'The review media binding schema differs from the one this build expects');
    }
    this.#schemaVersion = version;
  }

  /**
   * Bind the parts of a published package to the objects of its receipt.
   *
   * The binding is written once. A second binding of the same package is a replay
   * when it says the same thing and a conflict when it does not.
   */
  bind(input: BindReviewPackageInput): void {
    this.#schema();
    const receipt = input.receipt;
    if (receipt.format !== 'narralens.prepared-preview-receipt@1' ||
      receipt.project_id !== input.project_id || receipt.run_id !== input.run_id) {
      fail('INVALID_REQUEST', 'The receipt belongs to another project or run');
    }
    if (!HASH.test(receipt.receipt_digest) || !HASH.test(input.package_digest)) {
      fail('INVALID_REQUEST', 'The binding digests are invalid');
    }
    if (!Number.isSafeInteger(input.package_version) || input.package_version < 1) {
      fail('INVALID_REQUEST', 'The binding package version is invalid');
    }
    for (const part of input.parts) {
      const slot = receipt.parts.find((candidate) => candidate.slot === part.kind);
      if (slot === undefined) {
        fail('INVALID_REQUEST', `The receipt carries no part for ${part.kind}`);
      }
      const existing = this.#row(input.project_id, input.package_id, input.package_version, part.kind);
      if (existing !== undefined) {
        if (existing.run_id !== input.run_id ||
          existing.package_digest !== input.package_digest ||
          canonicalJson(existing.receipt) !== canonicalJson(receipt) ||
          existing.slot !== slot.slot ||
          existing.receipt_digest !== receipt.receipt_digest ||
          existing.object_id !== slot.object_id ||
          existing.artifact_ref_json !== canonicalJson(part.artifact_ref)) {
          fail('IDEMPOTENCY_CONFLICT', 'Another binding is already recorded for this package part');
        }
        continue;
      }
      this.#db.prepare(`INSERT INTO created_review_media_binding(
        project_id, run_id, package_id, package_version, package_digest, part_kind,
        artifact_ref_json, receipt_json, receipt_digest, object_id, slot,
        prepared_source_id, bound_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.project_id, input.run_id, input.package_id, input.package_version, input.package_digest,
        part.kind, canonicalJson(part.artifact_ref), canonicalJson(receipt), receipt.receipt_digest,
        slot.object_id, slot.slot, receipt.prepared_source_id, input.now.toISOString());
    }
  }

  /** The current binding of one part of the current package of a run. */
  async currentPart(input: {
    readonly project_id: string;
    readonly run_id: string;
    readonly part_kind: string;
    readonly artifact_ref: { readonly id: string; readonly version: number; readonly sha256: string };
  }): Promise<ReviewMediaBinding | null> {
    this.#schema();
    const review = this.#currentReview(input.project_id, input.run_id);
    if (review === undefined) return null;
    const document = this.#packageDocument(input.project_id, review);
    if (document === undefined) return null;
    const part = document.parts.find((candidate) => candidate.kind === input.part_kind);
    if (part === undefined) return null;
    if (part.artifact_ref.id !== input.artifact_ref.id ||
      part.artifact_ref.version !== input.artifact_ref.version ||
      part.artifact_ref.sha256 !== input.artifact_ref.sha256) {
      return null;
    }
    const row = this.#row(input.project_id, review.review_id, review.artifact_version, input.part_kind);
    if (row === undefined || row.run_id !== document.run_id ||
      row.package_digest !== review.package_digest ||
      row.artifact_ref_json !== canonicalJson(part.artifact_ref)) return null;
    return {
      project_id: row.project_id,
      run_id: row.run_id,
      package_id: row.package_id,
      package_version: row.package_version,
      package_digest: row.package_digest,
      part,
      receipt: row.receipt,
      object_id: row.object_id,
      slot: row.slot,
    };
  }

  /** The current binding behind one opaque reference. */
  async currentByReference(project_id: string, reference: string): Promise<ReviewMediaBinding | null> {
    this.#schema();
    if (typeof reference !== 'string' || reference.length === 0) return null;
    const review = this.#currentReviewOfProject(project_id);
    if (review === undefined) return null;
    const document = this.#packageDocument(project_id, review);
    if (document === undefined) return null;
    const part = document.parts.find((candidate) => candidate.artifact_ref.id === reference);
    if (part === undefined) return null;
    const row = this.#row(project_id, review.review_id, review.artifact_version, part.kind);
    if (row === undefined || row.run_id !== document.run_id ||
      row.package_digest !== review.package_digest ||
      row.artifact_ref_json !== canonicalJson(part.artifact_ref)) return null;
    return {
      project_id: row.project_id,
      run_id: row.run_id,
      package_id: row.package_id,
      package_version: row.package_version,
      package_digest: row.package_digest,
      part,
      receipt: row.receipt,
      object_id: row.object_id,
      slot: row.slot,
    };
  }

  /** The binding row of one package part, or `undefined`. */
  #row(projectId: string, packageId: string, packageVersion: number, partKind: string): {
    readonly project_id: string;
    readonly run_id: string;
    readonly package_id: string;
    readonly package_version: number;
    readonly package_digest: string;
    readonly artifact_ref_json: string;
    readonly receipt: PreparedPreviewReceiptV1;
    readonly receipt_digest: string;
    readonly object_id: string;
    readonly slot: PreparedPreviewPartKind;
  } | undefined {
    const row = this.#db.prepare(`SELECT * FROM created_review_media_binding
      WHERE project_id=? AND package_id=? AND package_version=? AND part_kind=?`)
      .get(projectId, packageId, packageVersion, partKind) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      project_id: String(row.project_id),
      run_id: String(row.run_id),
      package_id: String(row.package_id),
      package_version: Number(row.package_version),
      package_digest: String(row.package_digest),
      artifact_ref_json: String(row.artifact_ref_json),
      receipt: JSON.parse(String(row.receipt_json)) as PreparedPreviewReceiptV1,
      receipt_digest: String(row.receipt_digest),
      object_id: String(row.object_id),
      slot: String(row.slot) as PreparedPreviewPartKind,
    };
  }

  /** The current review of a run: the one the review table itself names. */
  #currentReview(projectId: string, runId: string): {
    readonly review_id: string;
    readonly artifact_id: string;
    readonly artifact_version: number;
    readonly package_digest: string;
  } | undefined {
    const row = this.#db.prepare(`SELECT review_id, artifact_id, artifact_version, package_digest
      FROM cp_a0_review_request WHERE project_id=? AND run_id=? ORDER BY created_at DESC, review_id DESC LIMIT 1`)
      .get(projectId, runId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      review_id: String(row.review_id),
      artifact_id: String(row.artifact_id),
      artifact_version: Number(row.artifact_version),
      package_digest: String(row.package_digest),
    };
  }

  /** The current review of a project, across its runs. */
  #currentReviewOfProject(projectId: string): {
    readonly review_id: string;
    readonly artifact_id: string;
    readonly artifact_version: number;
    readonly package_digest: string;
  } | undefined {
    const row = this.#db.prepare(`SELECT review_id, artifact_id, artifact_version, package_digest
      FROM cp_a0_review_request WHERE project_id=? ORDER BY created_at DESC, review_id DESC LIMIT 1`)
      .get(projectId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      review_id: String(row.review_id),
      artifact_id: String(row.artifact_id),
      artifact_version: Number(row.artifact_version),
      package_digest: String(row.package_digest),
    };
  }

  /** The published package document of a review. */
  #packageDocument(projectId: string, review: {
    readonly review_id: string;
    readonly artifact_id: string;
    readonly artifact_version: number;
  }): ReviewPackage | undefined {
    const row = this.#db.prepare(`SELECT content_json FROM cp_a0_artifact_version
      WHERE project_id=? AND artifact_id=? AND version=?`)
      .get(projectId, review.artifact_id, review.artifact_version) as { content_json?: string } | undefined;
    if (row === undefined || typeof row.content_json !== 'string') return undefined;
    try {
      const parsed = JSON.parse(row.content_json) as ReviewPackage;
      return parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.parts) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

}
