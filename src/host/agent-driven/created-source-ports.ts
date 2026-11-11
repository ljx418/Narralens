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
 * - **Opacity is a runtime property.** The publication proof and the commit scope are
 *   instances of a class this module does not export, so a structurally identical
 *   object literal is refused. Identity is what is checked, not shape.
 * - **The peer lanes own their own ports.** MEDIA's `CommittedRenderPhasesPort` and
 *   PRODUCT's native observation ports are consumed through MAIN once their real
 *   candidate commits exist. The review-media types are re-exported from the module
 *   that already owns them, never redeclared here.
 */

import { canonicalDigest, canonicalJson } from '../creative/digest.js';
import type { Applied, ExecutionBinding } from '../../contracts/agent-driven-types.js';
import type { ReviewPart } from '../../contracts/agent-driven-types.js';
import type {
  PreparedPreviewPartKind,
  PreparedPreviewReceiptV1,
  PreviewMediaDescriptorV1,
} from '../../contracts/prepared-preview.js';

/**
 * The review-media shapes are owned by the transport that already uses them.
 *
 * They are re-exported, not redeclared: a second, compatible-looking definition of
 * `ReviewMediaBinding` is how the producer and the consumer end up disagreeing about
 * which receipt a part belongs to.
 */
export type { PreparedPreviewPartKind, PreparedPreviewReceiptV1, PreviewMediaDescriptorV1 };
export type { ReviewMediaBinding, ReviewMediaBindingPort } from './review-media-http.js';

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

/** The version of the plan shape this module hashes. */
export const PREPARED_ADOPTION_PLAN_VERSION = 1;

/** The fixed lifetime of an adoption impact, in seconds. It never extends on replay. */
export const PREPARED_ADOPTION_IMPACT_TTL_SECONDS = 15 * 60;

/** The kind of source an adoption applies to. Only one kind is created-source. */
export const PREPARED_ADOPTION_SOURCE_KIND = 'created_prepared_source';

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

/** One affected frame range. The frames are integers; no native float enters this domain. */
export interface PreparedSourceRangeFact {
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
  readonly clip_id: string;
}

/** The consumer graph the adoption has to satisfy. */
export interface PreparedSourceConsumerFact {
  readonly consumer_id: string;
  readonly project_id: string;
  readonly run_id: string;
  /** The digest of the whole consumer graph, computed by the Host from real edges. */
  readonly graph_digest: string;
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
 * Every field D09 names is present, and none of them is optional. The base and the
 * target are separate fields: a plan that conflated them could not tell a change of
 * target snapshot or of the fixed upstream from a change of nothing at all.
 *
 * The frame rate is a rational: an integer numerator over an integer denominator. A
 * float would make the canonical preimage ambiguous, and the canonical form rejects
 * non-integers outright.
 */
export interface PreparedAdoptionPlanV1 {
  readonly format: typeof PREPARED_ADOPTION_PLAN_DOMAIN;
  readonly version: typeof PREPARED_ADOPTION_PLAN_VERSION;
  readonly source_kind: typeof PREPARED_ADOPTION_SOURCE_KIND;
  readonly project_id: string;
  readonly base_revision: number;
  /** The committed source digest the adoption was prepared against. */
  readonly base_source_digest: string;
  readonly control_revision: number;
  readonly selection_version: number;
  /** The D02 `ps_` mapping this adoption applies. */
  readonly materialization_id: string;
  readonly prepared_fact_digest: string;
  readonly request_digest: string;
  readonly producer_execution: ExecutionBinding;
  /** The source digest the publication will produce. */
  readonly target_source_digest: string;
  /** The predicted snapshot id. It is an expectation, not a committed row. */
  readonly target_snapshot_id: string;
  readonly roots: readonly string[];
  readonly files: readonly PreparedSourceFileFact[];
  readonly rights: readonly PreparedSourceRightsFact[];
  readonly consumer: PreparedSourceConsumerFact;
  readonly native_plan: PreparedSourceNativePlanFact;
  readonly frame_count: number;
  readonly fps_numerator: number;
  readonly fps_denominator: number;
  readonly affected_ranges: readonly PreparedSourceRangeFact[];
  readonly locks_checked: readonly PreparedSourceLockFact[];
  /** The fixed upstream the adoption is bound to. */
  readonly engine_upstream_sha: string;
  readonly expires_at: string;
}

/* -------------------------------------------------------------------------------------- */
/* The canonical facts of a plan                                                           */
/* -------------------------------------------------------------------------------------- */

const HASH = /^[a-f0-9]{64}$/;
const ASCII = /^[\x20-\x7e]+$/;

/** The stable order of the files, by path. */
function byPath(left: PreparedSourceFileFact, right: PreparedSourceFileFact): number {
  return left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0;
}

/** The stable order of the rights references, by id. */
function byRef(left: PreparedSourceRightsFact, right: PreparedSourceRightsFact): number {
  return left.ref_id < right.ref_id ? -1 : left.ref_id > right.ref_id ? 1 : 0;
}

/** The stable order of the locks, by id. */
function byLock(left: PreparedSourceLockFact, right: PreparedSourceLockFact): number {
  return left.lock_id < right.lock_id ? -1 : left.lock_id > right.lock_id ? 1 : 0;
}

/** The stable order of the ranges: start, then end, then clip. */
function byRange(left: PreparedSourceRangeFact, right: PreparedSourceRangeFact): number {
  return left.start_frame - right.start_frame
    || left.end_frame_exclusive - right.end_frame_exclusive
    || (left.clip_id < right.clip_id ? -1 : left.clip_id > right.clip_id ? 1 : 0);
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
    source_kind: plan.source_kind,
    project_id: plan.project_id,
    base_revision: plan.base_revision,
    base_source_digest: plan.base_source_digest,
    control_revision: plan.control_revision,
    selection_version: plan.selection_version,
    materialization_id: plan.materialization_id,
    prepared_fact_digest: plan.prepared_fact_digest,
    request_digest: plan.request_digest,
    producer_execution: {
      run_id: plan.producer_execution.run_id,
      plan_version: plan.producer_execution.plan_version,
      step_id: plan.producer_execution.step_id,
      attempt: plan.producer_execution.attempt,
      input_digest: plan.producer_execution.input_digest,
      run_scope_digest: plan.producer_execution.run_scope_digest,
      authorization_id: plan.producer_execution.authorization_id,
    },
    target_source_digest: plan.target_source_digest,
    target_snapshot_id: plan.target_snapshot_id,
    roots: [...plan.roots].sort(),
    files: [...plan.files]
      .map((file) => ({ relative_path: file.relative_path, bytes: file.bytes, sha256: file.sha256 }))
      .sort(byPath),
    rights: [...plan.rights]
      .map((right) => ({ ref_id: right.ref_id, artifact_version: right.artifact_version, sha256: right.sha256 }))
      .sort(byRef),
    consumer: {
      consumer_id: plan.consumer.consumer_id,
      project_id: plan.consumer.project_id,
      run_id: plan.consumer.run_id,
      graph_digest: plan.consumer.graph_digest,
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
    affected_ranges: [...plan.affected_ranges]
      .map((range) => ({
        start_frame: range.start_frame,
        end_frame_exclusive: range.end_frame_exclusive,
        clip_id: range.clip_id,
      }))
      .sort(byRange),
    locks_checked: [...plan.locks_checked]
      .map((lock) => ({
        lock_id: lock.lock_id,
        lock_type: lock.lock_type,
        scope: lock.scope,
        target_id: lock.target_id,
        start_frame: lock.start_frame,
        end_frame_exclusive: lock.end_frame_exclusive,
      }))
      .sort(byLock),
    engine_upstream_sha: plan.engine_upstream_sha,
    expires_at: plan.expires_at,
  };
}

/**
 * The canonical preimage of a plan.
 *
 * The domain and the version are inside the hashed text, and they are the ones the
 * *plan* claims — not the constants of this module. A plan that claims another version
 * must hash differently, or "the version is part of the plan" would be a claim the
 * digest does not keep.
 */
export function preparedAdoptionPlanPreimage(plan: PreparedAdoptionPlanV1): string {
  return canonicalJson({
    domain: plan.format,
    version: plan.version,
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
    domain: plan.format,
    version: plan.version,
    facts: preparedAdoptionPlanFacts(plan),
  });
}

/* -------------------------------------------------------------------------------------- */
/* The validation of a plan                                                                */
/* -------------------------------------------------------------------------------------- */

/** The failure of a malformed plan. */
export class PreparedAdoptionPlanError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT', message: string) {
    super(message);
    this.name = 'PreparedAdoptionPlanError';
  }
}

function invalid(message: string): never {
  throw new PreparedAdoptionPlanError('INVALID_REQUEST', message);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ASCII.test(value)) invalid(`${field} must be printable ASCII`);
  return value;
}

function hash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) invalid(`${field} must be a lowercase SHA-256 digest`);
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalid(`${field} must be a safe integer of at least ${minimum}`);
  }
  return value;
}

/**
 * Validate a plan and refuse the shapes that would make its digest ambiguous.
 *
 * Duplicate keys are rejected rather than broken by a tie-break rule. A tie-break would
 * make the digest depend on which duplicate came first, and "the first one" is not a
 * fact anybody can verify later. Rejecting the plan is the only honest answer.
 */
export function assertPreparedAdoptionPlan(plan: PreparedAdoptionPlanV1): PreparedAdoptionPlanV1 {
  if (plan === null || typeof plan !== 'object') invalid('The adoption plan is missing');
  if (plan.format !== PREPARED_ADOPTION_PLAN_DOMAIN) invalid('The adoption plan has another domain');
  if (plan.version !== PREPARED_ADOPTION_PLAN_VERSION) invalid('The adoption plan has another version');
  if (plan.source_kind !== PREPARED_ADOPTION_SOURCE_KIND) invalid('The adoption plan has another source kind');
  text(plan.project_id, 'project_id');
  integer(plan.base_revision, 'base_revision');
  hash(plan.base_source_digest, 'base_source_digest');
  integer(plan.control_revision, 'control_revision');
  integer(plan.selection_version, 'selection_version');
  text(plan.materialization_id, 'materialization_id');
  hash(plan.prepared_fact_digest, 'prepared_fact_digest');
  hash(plan.request_digest, 'request_digest');
  hash(plan.target_source_digest, 'target_source_digest');
  text(plan.target_snapshot_id, 'target_snapshot_id');
  hash(plan.engine_upstream_sha, 'engine_upstream_sha');
  text(plan.expires_at, 'expires_at');

  const execution = plan.producer_execution;
  if (execution === null || typeof execution !== 'object') invalid('The producer execution is missing');
  if (execution.plan_version !== 1) invalid('Only plan version 1 is dispatchable');
  text(execution.run_id, 'producer_execution.run_id');
  text(execution.step_id, 'producer_execution.step_id');
  integer(execution.attempt, 'producer_execution.attempt', 1);
  hash(execution.input_digest, 'producer_execution.input_digest');
  hash(execution.run_scope_digest, 'producer_execution.run_scope_digest');
  text(execution.authorization_id, 'producer_execution.authorization_id');

  if (!Array.isArray(plan.roots) || plan.roots.length === 0) invalid('The plan has no roots');
  const roots = new Set<string>();
  for (const root of plan.roots) {
    text(root, 'roots');
    if (roots.has(root)) invalid('The plan names the same root twice');
    roots.add(root);
  }

  if (!Array.isArray(plan.files) || plan.files.length === 0) invalid('The plan has no files');
  const files = new Set<string>();
  for (const file of plan.files) {
    text(file.relative_path, 'files.relative_path');
    integer(file.bytes, 'files.bytes');
    hash(file.sha256, 'files.sha256');
    if (files.has(file.relative_path)) invalid('The plan names the same file twice');
    files.add(file.relative_path);
  }
  for (const root of plan.roots) {
    if (!files.has(root)) invalid('A root of the plan is not one of its files');
  }

  if (!Array.isArray(plan.rights)) invalid('The plan has no rights list');
  const rights = new Set<string>();
  for (const right of plan.rights) {
    text(right.ref_id, 'rights.ref_id');
    integer(right.artifact_version, 'rights.artifact_version', 1);
    hash(right.sha256, 'rights.sha256');
    if (rights.has(right.ref_id)) invalid('The plan names the same rights reference twice');
    rights.add(right.ref_id);
  }

  const consumer = plan.consumer;
  if (consumer === null || typeof consumer !== 'object') invalid('The consumer graph is missing');
  text(consumer.consumer_id, 'consumer.consumer_id');
  text(consumer.project_id, 'consumer.project_id');
  text(consumer.run_id, 'consumer.run_id');
  hash(consumer.graph_digest, 'consumer.graph_digest');
  if (consumer.project_id !== plan.project_id) invalid('The consumer graph belongs to another project');

  const native = plan.native_plan;
  if (native === null || typeof native !== 'object') invalid('The native plan is missing');
  hash(native.native_plan_sha256, 'native_plan.native_plan_sha256');
  hash(native.film_sha256, 'native_plan.film_sha256');
  integer(native.film_bytes, 'native_plan.film_bytes');
  hash(native.settings_digest, 'native_plan.settings_digest');
  hash(native.subtitle_style_digest, 'native_plan.subtitle_style_digest');
  hash(native.captions_digest, 'native_plan.captions_digest');
  hash(native.markers_digest, 'native_plan.markers_digest');

  const frameCount = integer(plan.frame_count, 'frame_count', 1);
  integer(plan.fps_numerator, 'fps_numerator', 1);
  integer(plan.fps_denominator, 'fps_denominator', 1);

  if (!Array.isArray(plan.affected_ranges)) invalid('The plan has no affected ranges');
  const ranges = new Set<string>();
  for (const range of plan.affected_ranges) {
    const start = integer(range.start_frame, 'affected_ranges.start_frame');
    const end = integer(range.end_frame_exclusive, 'affected_ranges.end_frame_exclusive');
    text(range.clip_id, 'affected_ranges.clip_id');
    if (end <= start) invalid('An affected range is empty');
    if (end > frameCount) invalid('An affected range reaches past the frame count');
    const key = `${start}:${end}:${range.clip_id}`;
    if (ranges.has(key)) invalid('The plan names the same affected range twice');
    ranges.add(key);
  }

  if (!Array.isArray(plan.locks_checked)) invalid('The plan has no checked locks');
  const locks = new Set<string>();
  for (const lock of plan.locks_checked) {
    text(lock.lock_id, 'locks_checked.lock_id');
    text(lock.lock_type, 'locks_checked.lock_type');
    text(lock.scope, 'locks_checked.scope');
    text(lock.target_id, 'locks_checked.target_id');
    integer(lock.start_frame, 'locks_checked.start_frame');
    integer(lock.end_frame_exclusive, 'locks_checked.end_frame_exclusive');
    if (locks.has(lock.lock_id)) invalid('The plan names the same lock twice');
    locks.add(lock.lock_id);
  }
  return plan;
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
 * The facts a publication proof carries.
 *
 * They are data, not authority. The proof itself is minted and recognised by the
 * publisher that owns it, and the commit re-derives the truth from the journal, the
 * backup and the live author root before it believes any of it.
 */
export interface CreatedSourcePublicationFacts {
  readonly publisher_instance: string;
  readonly project_id: string;
  readonly transaction_id: string;
  readonly prepared_source_id: string;
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

/**
 * The opaque proof that a publication really happened.
 *
 * This module holds the type only. The runtime identity of a proof belongs to the
 * publisher that issued it: a shared module that could mint one would be a shared
 * module anybody could mint one in, and a proof that is accepted on the strength of
 * its own fields is a proof that a request body could forge.
 */
export interface CreatedSourcePublicationProof {
  readonly facts: CreatedSourcePublicationFacts;
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
 * The scope is created by the RevisionStore's own atomic transaction and is recognised
 * by the repository through the exact owning store and the exact connection. There is
 * no constructor here and no way to make one from outside that transaction.
 */
export interface CreatedSourceCommitScope {
  readonly project_id: string;
  readonly transaction_id: string;
  /**
   * Host-only: records that the joined work failed.
   *
   * The outer transaction rolls back even when a caller swallows the error, because
   * the failure is remembered here rather than only thrown.
   */
  poison(error: unknown): void;
  /** Host-only: whether a failure was recorded on this scope. */
  readonly poisoned: boolean;
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

/** The part of a review package, as the media transport already describes it. */
export type CreatedReviewPart = ReviewPart;
