/**
 * BRIDGE R2 — the Host-only types of the created-source chain.
 *
 * This module is the single place where the created-source types live. It exists because
 * the chain spans several stores and two lanes, and a type that is copied into each of
 * them is a type that can drift. Nothing here is a public wire DTO: every type is
 * `Host-only` — it is produced and consumed inside the Host, never accepted from a
 * request body and never serialized into a client-facing envelope.
 *
 * The rules this file holds to:
 *
 * - **No `any`, no empty runtime.** Every declaration is a real type over the real
 *   records that already exist. A placeholder type that unblocks a compile is how a
 *   chain ends up with two incompatible shapes of the same fact.
 * - **The plan digest is one digest.** The D09 adoption plan has a single canonical
 *   preimage, and its SHA-256 is used both as the change's `plan_sha256` and as the
 *   prepared approval's `facts_digest`. The five-field summary that used to stand in for
 *   it is not a second digest; it is the same one, read from the immutable plan.
 * - **Opaque capabilities stay opaque.** The publication proof and the commit scope are
 *   interfaces with no exported constructor, so a caller cannot forge them from JSON and
 *   cannot smuggle a callback in through a request.
 *
 * The peer lanes own their own ports. MEDIA's `CommittedRenderPhasesPort` and PRODUCT's
 * native observation ports are consumed through MAIN once their real candidate commits
 * exist; this file declares only what BRIDGE itself owns.
 */

import { canonicalDigest, canonicalJson } from '../creative/digest.js';
import type { ExecutionBinding } from '../../contracts/agent-driven-types.js';
import type { Applied } from '../../contracts/agent-driven-types.js';

/* -------------------------------------------------------------------------------------- */
/* D09: the prepared adoption plan                                                        */
/* -------------------------------------------------------------------------------------- */

/**
 * The canonical domain of the adoption plan.
 *
 * The domain is part of the preimage, not a comment beside it. Two facts that differ
 * only in their domain are different facts, and a digest that cannot tell them apart
 * would let a plan from one domain be replayed as a plan from another.
 */
export const PREPARED_ADOPTION_PLAN_DOMAIN = 'narralens.prepared-adoption-plan@1';

/** The fixed lifetime of an adoption impact, in seconds. It never extends on replay. */
export const PREPARED_ADOPTION_IMPACT_TTL_SECONDS = 15 * 60;

/** One file of the prepared closure. */
export interface PreparedSourceFileFact {
  readonly relative_path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** One rights reference the adoption depends on. */
export interface PreparedSourceRightsFact {
  readonly ref_id: string;
  readonly artifact_version: number;
  readonly sha256: string;
}

/** One lock the adoption was checked against. */
export interface PreparedSourceLockFact {
  readonly lock_id: string;
  readonly lock_type: string;
  readonly scope: string;
  readonly target_id: string;
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
}

/** The consumer that will observe the adopted source. */
export interface PreparedSourceConsumerFact {
  readonly consumer_id: string;
  readonly project_id: string;
  readonly run_id: string;
}

/** The native plan the adopted source must satisfy. */
export interface PreparedSourceNativePlanFact {
  readonly native_plan_sha256: string;
  readonly film_sha256: string;
  readonly film_bytes: number;
  readonly settings_digest: string;
  readonly subtitle_style_digest: string;
  readonly captions_digest: string;
  readonly markers_digest: string;
}

/**
 * The complete D09 adoption plan.
 *
 * Every field D09 names is present, and none of them is optional. A plan that can omit
 * its rights, its locks or its frame count is a plan whose digest does not cover the
 * premises the adoption rests on, which is precisely the gap this type closes.
 *
 * The frame rate is a rational: an integer numerator over an integer denominator. A
 * float would make the canonical preimage ambiguous, and the canonical form rejects
 * non-integers outright.
 */
export interface PreparedAdoptionPlanV1 {
  readonly format: typeof PREPARED_ADOPTION_PLAN_DOMAIN;
  readonly project_id: string;
  readonly transaction_id: string;
  readonly prepared_source_id: string;
  readonly impact_id: string;
  readonly base_revision: number;
  readonly control_revision: number;
  readonly selection_version: number;
  readonly source_digest: string;
  readonly execution: ExecutionBinding;
  readonly roots: readonly string[];
  readonly files: readonly PreparedSourceFileFact[];
  readonly rights: readonly PreparedSourceRightsFact[];
  readonly locks: readonly PreparedSourceLockFact[];
  readonly consumer: PreparedSourceConsumerFact;
  readonly native_plan: PreparedSourceNativePlanFact;
  readonly frame_count: number;
  readonly fps_numerator: number;
  readonly fps_denominator: number;
  readonly expires_at: string;
}

/**
 * The facts of a plan, in the one order they are hashed in.
 *
 * The arrays are sorted explicitly rather than in the order the caller happened to
 * build them. Two callers who assembled the same closure in a different order must
 * produce the same preimage, or the digest stops being an identity for the plan.
 */
export function preparedAdoptionPlanFacts(plan: PreparedAdoptionPlanV1): Record<string, unknown> {
  return {
    project_id: plan.project_id,
    transaction_id: plan.transaction_id,
    prepared_source_id: plan.prepared_source_id,
    impact_id: plan.impact_id,
    base_revision: plan.base_revision,
    control_revision: plan.control_revision,
    selection_version: plan.selection_version,
    source_digest: plan.source_digest,
    execution: {
      run_id: plan.execution.run_id,
      plan_version: plan.execution.plan_version,
      step_id: plan.execution.step_id,
      attempt: plan.execution.attempt,
      input_digest: plan.execution.input_digest,
      run_scope_digest: plan.execution.run_scope_digest,
      authorization_id: plan.execution.authorization_id,
    },
    roots: [...plan.roots].sort(),
    files: [...plan.files]
      .map((file) => ({ relative_path: file.relative_path, bytes: file.bytes, sha256: file.sha256 }))
      .sort((left, right) => (left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0)),
    rights: [...plan.rights]
      .map((right) => ({ ref_id: right.ref_id, artifact_version: right.artifact_version, sha256: right.sha256 }))
      .sort((left, right) => (left.ref_id < right.ref_id ? -1 : left.ref_id > right.ref_id ? 1 : 0)),
    locks: [...plan.locks]
      .map((lock) => ({
        lock_id: lock.lock_id,
        lock_type: lock.lock_type,
        scope: lock.scope,
        target_id: lock.target_id,
        start_frame: lock.start_frame,
        end_frame_exclusive: lock.end_frame_exclusive,
      }))
      .sort((left, right) => (left.lock_id < right.lock_id ? -1 : left.lock_id > right.lock_id ? 1 : 0)),
    consumer: {
      consumer_id: plan.consumer.consumer_id,
      project_id: plan.consumer.project_id,
      run_id: plan.consumer.run_id,
    },
    native_plan: {
      native_plan_sha256: plan.native_plan.native_plan_sha256,
      film_sha256: plan.native_plan.film_sha256,
      film_bytes: plan.native_plan.film_bytes,
      settings_digest: plan.native_plan.settings_digest,
      subtitle_style_digest: plan.native_plan.subtitle_style_digest,
      captions_digest: plan.native_plan.captions_digest,
      markers_digest: plan.native_plan.markers_digest,
    },
    frame_count: plan.frame_count,
    fps_numerator: plan.fps_numerator,
    fps_denominator: plan.fps_denominator,
    expires_at: plan.expires_at,
  };
}

/**
 * The canonical preimage of a plan.
 *
 * The domain is inside the hashed text. A caller that hashes the facts alone has not
 * hashed the plan, and the two must never be confused.
 */
export function preparedAdoptionPlanPreimage(plan: PreparedAdoptionPlanV1): string {
  return canonicalJson({
    domain: PREPARED_ADOPTION_PLAN_DOMAIN,
    facts: preparedAdoptionPlanFacts(plan),
  });
}

/**
 * The one digest of the plan.
 *
 * It is the change's `plan_sha256` AND the prepared approval's `facts_digest`. There is
 * no second, shorter summary of the same plan.
 */
export function preparedAdoptionPlanDigest(plan: PreparedAdoptionPlanV1): string {
  return canonicalDigest({
    domain: PREPARED_ADOPTION_PLAN_DOMAIN,
    facts: preparedAdoptionPlanFacts(plan),
  });
}

/* -------------------------------------------------------------------------------------- */
/* D02: the immutable prepared-source mapping                                              */
/* -------------------------------------------------------------------------------------- */

/**
 * The immutable mapping of a prepared source.
 *
 * The identifier is derived from the canonical parts of the fact — project, job,
 * request and fact — so the same preparation always names the same mapping, and a
 * different preparation never does. The full hash is kept as well: the short form is
 * the name, the long form is the collision check.
 */
export interface PreparedSourceMapping {
  readonly prepared_source_id: string;
  readonly full_hash: string;
  readonly project_id: string;
  readonly job_id: string;
  readonly request_digest: string;
  readonly fact_digest: string;
  readonly execution: ExecutionBinding;
  readonly base_revision: number;
  readonly source_digest: string;
  readonly plan_sha256: string;
  readonly rights_digest: string;
  readonly frame_count: number;
  readonly fps_numerator: number;
  readonly fps_denominator: number;
  readonly descriptor: string;
  /** The Host-private stage the preparation produced. Never a client-visible path. */
  readonly stage_root: string;
  readonly roots: readonly string[];
  readonly files: readonly PreparedSourceFileFact[];
  readonly result_ref: { readonly id: string; readonly version: number; readonly sha256: string } | null;
  readonly created_at: string;
}

/* -------------------------------------------------------------------------------------- */
/* The created source fact                                                                 */
/* -------------------------------------------------------------------------------------- */

/**
 * The immutable fact of an adopted source.
 *
 * This is what a later reader proves against. It is written in the same transaction
 * that consumed the approval and moved the revision, so it cannot exist without the
 * commit it describes.
 */
export interface CreatedSourceFactV1 {
  readonly format: 'narralens.created-source-fact@1';
  readonly project_id: string;
  readonly transaction_id: string;
  readonly prepared_source_id: string;
  readonly impact_id: string;
  readonly approval_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly plan_sha256: string;
  readonly facts_digest: string;
  readonly revision: number;
  readonly execution: ExecutionBinding;
  readonly created_at: string;
}

/* -------------------------------------------------------------------------------------- */
/* L02: the same-database commit capability                                                */
/* -------------------------------------------------------------------------------------- */

/**
 * The opaque proof that a publication really happened.
 *
 * The publisher holds it; only the publisher's own instance can produce one, and a
 * plain object with the same fields is not one. The proof keeps the identity of the
 * original files it verified, so the commit can re-check the journal and the backup
 * rather than take the publisher's word for it.
 */
export interface CreatedSourcePublicationProof {
  /** The publisher instance that produced this proof. */
  readonly publisher_instance: string;
  /** The project this publication belongs to. */
  readonly project_id: string;
  /** The transaction this publication belongs to. */
  readonly transaction_id: string;
  /** The source digest of the ORIGINAL closure, before the publication. */
  readonly original_source_digest: string;
  /** The source digest of the published closure. */
  readonly published_source_digest: string;
  /** The target snapshot the publication is expected to produce. */
  readonly target_snapshot_id: string;
  /** The full tree the publication wrote. */
  readonly published_files: readonly PreparedSourceFileFact[];
  /** The journal that records the publication. */
  readonly journal_id: string;
  /** The backup of the original root. */
  readonly backup_root: string;
  /** The proof's own issue time. */
  readonly issued_at: string;
}

/** The only issuer of a publication proof. The publisher holds the private brand. */
export interface CreatedSourcePublicationIssuer {
  issue(input: {
    readonly publisher_instance: string;
    readonly project_id: string;
    readonly transaction_id: string;
    readonly original_source_digest: string;
    readonly published_source_digest: string;
    readonly target_snapshot_id: string;
    readonly published_files: readonly PreparedSourceFileFact[];
    readonly journal_id: string;
    readonly backup_root: string;
    readonly issued_at: string;
  }): CreatedSourcePublicationProof;
}

/**
 * The closed input of the one created-source commit.
 *
 * There is no callback, no raw database handle, no client-supplied snapshot or revision
 * and no "already approved" boolean. Everything the commit needs to verify is either
 * read from the immutable records of this transaction or proved by the publication.
 */
export interface CommitPreparedCreatedSourceInput {
  readonly project_id: string;
  readonly transaction_id: string;
  readonly impact_id: string;
  readonly approval_id: string;
  readonly prepared_source_id: string;
  readonly execution: ExecutionBinding;
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly publication_proof: CreatedSourcePublicationProof;
}

/**
 * The scope of a live created-source commit.
 *
 * A scope can only be created by the running commit, and it is invalid the moment that
 * commit leaves. There is no exported constructor, so a caller cannot manufacture one.
 */
export interface CreatedSourceCommitScope {
  /** The project this scope is bound to. */
  readonly project_id: string;
  /** The transaction this scope is bound to. */
  readonly transaction_id: string;
  /** The identity of the connection this scope belongs to. Never the connection itself. */
  readonly connection_identity: symbol;
}

/* -------------------------------------------------------------------------------------- */
/* L04: the review media bindings                                                          */
/* -------------------------------------------------------------------------------------- */

/** One immutable part of a review package. */
export interface ReviewMediaPartBinding {
  readonly part_kind: string;
  readonly relative_path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly media_object_id: string;
}

/**
 * The receipt of a prepared preview.
 *
 * It binds the five parts of a review package to the immutable objects that back them.
 * The receipt digest covers the parts themselves, so a part that was replaced cannot be
 * served under the old receipt.
 */
export interface ReviewMediaReceipt {
  readonly format: 'narralens.review-media-receipt@1';
  readonly project_id: string;
  readonly run_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly parts: readonly ReviewMediaPartBinding[];
  readonly receipt_digest: string;
  readonly created_at: string;
}

/** The current binding of a review package, as the read transport sees it. */
export interface ReviewMediaBinding {
  readonly package_id: string;
  readonly package_version: number;
  readonly package_digest: string;
  readonly receipt: ReviewMediaReceipt;
  readonly part_kind: string;
  readonly part: ReviewMediaPartBinding;
}

/** The producer of the current binding. A missing producer is not a binding. */
export interface ReviewMediaBindingPort {
  currentPart(projectId: string, packageId: string, partKind: string): ReviewMediaBinding | null;
  currentByReference(projectId: string, reference: { readonly id: string; readonly version: number; readonly sha256: string }): ReviewMediaBinding | null;
}

/* -------------------------------------------------------------------------------------- */
/* The two narrow effects of the guard                                                     */
/* -------------------------------------------------------------------------------------- */

/**
 * The two Host-only effects the guard admits in addition to the ordinary actions.
 *
 * They are not client-supplied effects: an HTTP request cannot name one, and the
 * ordinary `waiting_user` dispatch set does not grow because they exist.
 */
export const NARROW_HOST_EFFECTS = ['review_impact_prepare', 'approved_prepared_adoption'] as const;

/** One of the two narrow Host-only effects. */
export type NarrowHostEffect = (typeof NARROW_HOST_EFFECTS)[number];

/* -------------------------------------------------------------------------------------- */
/* The early R3 foundations                                                                */
/* -------------------------------------------------------------------------------------- */

/** The four real capabilities a created run must have before it may start. */
export const CREATED_RUN_CAPABILITY_IDS = [
  'clip.prepare',
  'snapshot.render',
  'qc.inspect',
  'delivery.package',
] as const;

/** One of the four real capabilities. */
export type CreatedRunCapabilityId = (typeof CREATED_RUN_CAPABILITY_IDS)[number];

/**
 * The real producer admission of a capability.
 *
 * A capability is admitted only when a real producer AND a real guarded consumer are
 * both registered. A manifest of names is not a producer, and a producer with no
 * consumer is not a capability.
 */
export interface CreatedCapabilityAdmission {
  readonly capability_id: CreatedRunCapabilityId;
  readonly producer_registered: boolean;
  readonly consumer_registered: boolean;
  readonly reason: string;
}

/** The admission of all four capabilities. */
export type CreatedCapabilityAdmissions = readonly CreatedCapabilityAdmission[];

/**
 * Whether the four real capabilities are all admitted.
 *
 * There is no `available` flag to set: the answer is computed from the registrations.
 */
export function createdCapabilitiesAdmitted(admissions: CreatedCapabilityAdmissions): boolean {
  if (admissions.length !== CREATED_RUN_CAPABILITY_IDS.length) return false;
  for (const id of CREATED_RUN_CAPABILITY_IDS) {
    const found = admissions.find((entry) => entry.capability_id === id);
    if (found === undefined || !found.producer_registered || !found.consumer_registered) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------------------- */
/* The applied receipt                                                                     */
/* -------------------------------------------------------------------------------------- */

/** The receipt of a created-source commit. The same frozen shape as any other commit. */
export type CreatedSourceApplied = Applied;
