import { randomUUID } from 'node:crypto';
import { isTrustedCallerContext } from '../creative/product-repository.js';
import type { ReviewDecisionInput, ReviewPackage } from '../../contracts/agent-driven-types.js';
import { canonicalDigest, contentDigest, FIXED_PLAN } from '../creative/digest.js';
import { guardExecution, readGuardFacts } from '../creative/execution-guard.js';
import { creativeInputClosure } from '../creative/creative-closure.js';
import { ProductSqliteRepository } from './product-sqlite-repository.js';
import { CreatedSourceFactsReader, type CreatedPreparedReadInput, type CreatedPreparedFactsProof } from './created-source-facts-reader.js';
import { CreatedPreparedSourceStore } from './created-prepared-source-store.js';
import { CreatedSourceImpactStore } from './created-source-impact-store.js';
import { ImpactStore } from '../impact/impact-store.js';
import { OperationIdempotencyStore } from '../projects/operation-idempotency-store.js';
import { assertPreparedAdoptionPlan, preparedAdoptionPlanDigest, preparedAdoptionPlanFacts, type PreparedAdoptionPlanV1 } from './created-source-ports.js';
import { ProductError } from '../creative/trusted-context.js';
import type {
  ApprovalRecord,
  TrustedCallerContext,
  ProductTransaction,
  TrustedAdoptionAuthority,
  TrustedApprovalInput,
  TrustedConfirmationInput,
  TrustedConfirmationRecord,
} from '../creative/product-repository.js';

export interface CreatedRunAuthorityOptions {
  /** Actual Host dependencies; there is no caller-supplied plan verifier. */
  readonly prepared?: Omit<ConstructorParameters<typeof CreatedSourceFactsReader>[0], 'prepared'>;

  /** The live session guard. A confirmation is only as good as the session that made
   * it, so the authority re-checks the session instead of trusting the record. */
  readonly sessionGuard?: (input: { readonly principal_id: string; readonly session_ref: string }) => boolean;
  /** The clock, in epoch seconds. */
  readonly now?: () => number;
  /** The longest lifetime a confirmation may be given. */
  readonly confirmationTtlSeconds?: number;
}

interface PreparedReviewScope {
  readonly request: ReviewDecisionInput;
  readonly caller: TrustedCallerContext;
  readonly read: CreatedPreparedReadInput;
  readonly proof: CreatedPreparedFactsProof;
  readonly digest: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const DEFAULT_CONFIRMATION_TTL_SECONDS = 3600;

/**
 * The production trusted confirmation and approval authority.
 *
 * A confirmation is written inside the caller's own transaction and is bound to the
 * real trusted UI session, the real actor, the real action digest and a real expiry.
 * The authority never mints a confirmation for a session it cannot re-check, and it
 * never writes a confirmation for a purpose it was not asked for.
 *
 * An approval is different on purpose: it is only written when the current run, the
 * current confirmation, the current attempt and the current digests are all present
 * in the same transaction. When any of them is missing the authority returns `null`
 * and the lane fails closed instead of inventing an approval.
 */
export class CreatedRunAuthority implements TrustedAdoptionAuthority {
  readonly #sessionGuard: ((input: { readonly principal_id: string; readonly session_ref: string }) => boolean) | undefined;
  readonly #now: () => number;
  readonly #ttl: number;

  readonly reviewTransaction?: NonNullable<TrustedAdoptionAuthority['reviewTransaction']>;
  readonly #prepared: CreatedPreparedSourceStore | undefined;
  readonly #impacts: CreatedSourceImpactStore | undefined;
  readonly #reader: CreatedSourceFactsReader | undefined;
  readonly #repository: ProductSqliteRepository | undefined;
  readonly #options: CreatedRunAuthorityOptions;
  readonly #reviews = new WeakMap<ProductTransaction, PreparedReviewScope>();

  constructor(options: CreatedRunAuthorityOptions = {}) {
    this.#options = options;
    if (options.prepared) {
      const revisions = options.prepared.host.revisions;
      this.#prepared = new CreatedPreparedSourceStore(revisions);
      this.#impacts = new CreatedSourceImpactStore(revisions,
        new ImpactStore(revisions, new OperationIdempotencyStore(revisions.compose(db => db))));
      this.#repository = new ProductSqliteRepository(revisions);
      this.#reader = new CreatedSourceFactsReader({ ...options.prepared, prepared: this.#prepared });
      this.reviewTransaction = (input, caller, work) => this.#reviewTransaction(input, caller, work);
    }
    this.#sessionGuard = options.sessionGuard;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#ttl = options.confirmationTtlSeconds ?? DEFAULT_CONFIRMATION_TTL_SECONDS;
    if (!Number.isSafeInteger(this.#ttl) || this.#ttl < 1) throw Error('Invalid confirmation lifetime');
  }

  async #reviewTransaction<T>(raw: ReviewDecisionInput, caller: TrustedCallerContext,
    work: (tx: ProductTransaction, digest: string | null) => T): Promise<T> {
    if (!isTrustedCallerContext(caller) || caller.channel !== 'trusted_ui')
      throw new ProductError('UNAUTHORIZED', 'A trusted UI session is required');
    const request = structuredClone(raw);
    const read = await this.#repository!.transaction(tx => {
      // The existing command ledger remains the only request replay authority.
      if (tx.recallIdempotency({kind:'project',project_id:request.project_id},
        'review.decide',request.meta.idempotency_key) || request.choice !== 'accept_and_adopt') return null;
      const review = tx.get('review_request', {project_id:request.project_id,run_id:request.run_id,review_id:request.package_id});
      const artifact = review && tx.get('artifact_version', {project_id:request.project_id,
        artifact_id:review.artifact_id,version:review.artifact_version});
      const document = artifact?.content_json as ReviewPackage | undefined;
      const impact = document?.impact;
      if (!impact) throw new ProductError('IMPACT_REQUIRED', 'No durable review impact');
      const mapping = this.#prepared!.read(impact.materialization_id);
      const plan = this.#impacts!.planFact(impact.impact_id);
      if (!mapping && !plan && !impact.materialization_id.startsWith('ps_')) return null;
      if (!mapping || !plan || mapping.project_id !== request.project_id)
        throw new ProductError('IMPACT_STALE', 'Prepared review mapping is missing');
      return {project_id:request.project_id,prepared_source_id:mapping.prepared_source_id,execution:mapping.execution};
    });
    if (!read) return this.#repository!.transaction(tx => work(tx, null));
    const proof = await this.#reader!.acquire(read, caller.principal_id);
    try {
      return await this.#repository!.transaction(tx => {
        if (tx.recallIdempotency({kind:'project',project_id:request.project_id},
          'review.decide',request.meta.idempotency_key)) return work(tx, null);
        const fact = this.#impacts!.planFact(request.impact_id!);
        if (!fact) throw new ProductError('IMPACT_STALE', 'The immutable plan is missing');
        const scope: PreparedReviewScope = {request, caller, read, proof, digest:fact.plan_sha256};
        this.#assertPrepared(tx, scope);
        this.#reviews.set(tx, scope);
        try { return work(tx, scope.digest); } finally { this.#reviews.delete(tx); }
      });
    } finally { this.#reader!.release(proof); }
  }

  #assertPrepared(tx: ProductTransaction, scope: PreparedReviewScope): void {
    const {request, caller, read, proof, digest} = scope;
    const stale = (message: string): never => {throw new ProductError('IMPACT_STALE', message);};
    const impact = this.#impacts!.requireActive(request.impact_id!, new Date(this.#now()*1000));
    const fact = this.#impacts!.planFact(impact.impact_id);
    if (!fact) stale('The immutable adoption plan is missing');
    const plan = assertPreparedAdoptionPlan(fact!.plan as PreparedAdoptionPlanV1);
    const canonicalPlan = preparedAdoptionPlanFacts(plan);
    const mapping = this.#prepared!.read(read.prepared_source_id);
    const binding = this.#prepared!.packageBinding(read.prepared_source_id);
    if (preparedAdoptionPlanDigest(plan) !== digest || fact!.plan_sha256 !== digest
      || fact!.prepared_source_id !== read.prepared_source_id || request.plan_sha256 !== digest
      || impact.native_plan_sha256 !== digest || plan.project_id !== request.project_id
      || plan.materialization_id !== read.prepared_source_id || impact.materialization_id !== read.prepared_source_id
      || impact.project_id !== request.project_id || impact.expires_at !== plan.expires_at
      || impact.base_revision !== plan.base_revision || impact.control_revision !== plan.control_revision
      || impact.source_digest !== plan.base_source_digest || impact.target_snapshot_id !== plan.target_snapshot_id
      || impact.engine_upstream_sha !== plan.engine_upstream_sha
      || canonicalDigest(impact.affected_ranges) !== canonicalDigest(canonicalPlan.affected_ranges)
      || canonicalDigest(impact.locks_checked) !== canonicalDigest(canonicalPlan.locks_checked)
      || Date.parse(plan.expires_at) <= this.#now()*1000 || !mapping || !binding
      || binding.package_id !== request.package_id || binding.package_version !== request.package_version
      || canonicalDigest(mapping.execution) !== canonicalDigest(read.execution)
      || canonicalDigest(plan.producer_execution) !== canonicalDigest(read.execution)) stale('Prepared plan/package binding differs');
    const {rights_digest, ...observed} = this.#reader!.assertCurrent(read, caller.principal_id, proof);
    const {format:_format,version:_version,source_kind:_source,expires_at:_expiry,...expected} = plan;
    if (canonicalDigest(expected) !== canonicalDigest(observed) || rights_digest !== impact.rights_digest)
      stale('Actual source, selection, native plan or rights changed');
    const creation = this.#options.prepared!.authority.creation.forProject(request.project_id);
    const head = creation && tx.get('intake_head', {intake_id:creation.request.intake_id});
    if (!creation || !head || canonicalDigest(creativeInputClosure(tx,creation.request.intake_id,head.current_version)) !== request.input_digest)
      stale('Current creative input closure differs');
    const run = tx.get('run', {project_id:request.project_id,run_id:request.run_id});
    const fixed = tx.get('plan_version', {project_id:request.project_id,run_id:request.run_id,plan_version:1});
    const review = tx.get('review_request', {project_id:request.project_id,run_id:request.run_id,review_id:request.package_id});
    const artifact = review && tx.get('artifact_version', {project_id:request.project_id,artifact_id:review.artifact_id,version:review.artifact_version});
    const document = artifact?.content_json as ReviewPackage | undefined;
    const lineage = run?.checkpoint_json.review_packages.find(p => p.package_id === request.package_id);
    if (!run || run.state === 'cancelled' || run.run_scope_digest !== read.execution.run_scope_digest
      || !fixed || canonicalDigest(fixed.plan_json) !== canonicalDigest(FIXED_PLAN)
      || fixed.input_digest !== request.input_digest || fixed.run_scope_digest !== run.run_scope_digest
      || !review || review.state !== 'pending' || review.run_scope_digest !== run.run_scope_digest
      || !artifact || !document || contentDigest(document) !== review.package_digest
      || artifact.content_digest !== review.package_digest || document.version !== request.package_version
      || document.input_digest !== request.input_digest || document.output_digest !== request.output_digest
      || document.quality_digest !== request.quality_digest || document.project_id !== request.project_id
      || document.run_id !== request.run_id || document.package_id !== request.package_id || document.plan_version !== 1
      || review.input_digest !== request.input_digest || !lineage || lineage.state !== 'pending'
      || lineage.version !== request.package_version || lineage.input_digest !== request.input_digest
      || lineage.output_digest !== request.output_digest || lineage.quality_digest !== request.quality_digest
      || lineage.step_id !== read.execution.step_id || lineage.attempt !== read.execution.attempt
      || request.input_digest !== read.execution.input_digest || read.execution.run_id !== request.run_id
      || document.impact?.impact_id !== impact.impact_id || document.impact.plan_sha256 !== digest
      || document.impact.materialization_id !== read.prepared_source_id
      || document.impact.base_revision !== plan.base_revision || document.impact.control_revision !== plan.control_revision
      || document.impact.source_digest !== plan.base_source_digest || document.impact.selection_version !== plan.selection_version
      || document.impact.target_snapshot_id !== plan.target_snapshot_id || document.impact.expires_at !== plan.expires_at)
      stale('Current review, execution or immutable package differs');
    const preparedImpact = this.#reader!.preparedImpactFacts(read, caller.principal_id, proof);
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now * 1000 >= Date.parse(plan.expires_at)) stale('Prepared approval expired');
    guardExecution(read.execution, {kind:'review_impact_prepare',prepared_source_id:read.prepared_source_id,
      prepared_job_id:preparedImpact.completed_job.job_id,fact_digest:preparedImpact.fact_digest},
      {...readGuardFacts(tx,request.project_id,read.execution,caller.principal_id,now),preparedImpact});
  }

  registerConfirmation(tx: ProductTransaction, input: TrustedConfirmationInput): TrustedConfirmationRecord {
    if (!input || typeof input !== 'object') throw new ProductError('INVALID_REQUEST', 'The confirmation input is missing');
    if (!ID.test(input.project_id) || !ID.test(input.run_id) || !ID.test(input.authenticated_actor))
      throw new ProductError('INVALID_REQUEST', 'The confirmation identity is invalid');
    if (!HASH.test(input.input_digest) || !HASH.test(input.action_digest))
      throw new ProductError('INVALID_REQUEST', 'The confirmation digest is invalid');
    if (!['run.authorize', 'review', 'change.approve'].includes(input.purpose))
      throw new ProductError('INVALID_REQUEST', 'The confirmation purpose is not allowed');
    if (typeof input.session_ref !== 'string' || input.session_ref.length === 0)
      throw new ProductError('UNAUTHORIZED', 'The confirmation has no session');
    if (!Number.isSafeInteger(input.issued_at) || !Number.isSafeInteger(input.expires_at)
      || input.expires_at <= input.issued_at || input.expires_at - input.issued_at > this.#ttl)
      throw new ProductError('INVALID_REQUEST', 'The confirmation lifetime is invalid');
    if (input.issued_at > this.#now())
      throw new ProductError('INVALID_REQUEST', 'The confirmation was issued in the future');
    if (input.purpose === 'run.authorize' ? input.review_id !== null : typeof input.review_id !== 'string')
      throw new ProductError('INVALID_REQUEST', 'The confirmation review identity is invalid');
    if (this.#sessionGuard && !this.#sessionGuard({ principal_id: input.authenticated_actor, session_ref: input.session_ref }))
      throw new ProductError('UNAUTHORIZED', 'The confirming session is no longer active');
    const record: TrustedConfirmationRecord = {
      project_id: input.project_id,
      run_id: input.run_id,
      confirmation_id: `confirm_${randomUUID().replaceAll('-', '')}`,
      review_id: input.review_id,
      input_digest: input.input_digest,
      purpose: input.purpose,
      channel: 'trusted_ui',
      authenticated_actor: input.authenticated_actor,
      session_ref: input.session_ref,
      action_digest: input.action_digest,
      issued_at: input.issued_at,
      expires_at: input.expires_at,
    };
    tx.put('trusted_confirmation', {
      project_id: record.project_id,
      run_id: record.run_id,
      confirmation_id: record.confirmation_id,
    }, record);
    return record;
  }

  registerApproval(tx: ProductTransaction, input: TrustedApprovalInput): ApprovalRecord | null {
    if (!input || typeof input !== 'object') return null;
    if (!ID.test(input.project_id) || !ID.test(input.run_id) || !ID.test(input.confirmation_id)) return null;
    if (!HASH.test(input.input_digest) || !HASH.test(input.action_digest) || !HASH.test(input.facts_digest)) return null;
    if (!Number.isSafeInteger(input.expires_at) || input.expires_at <= this.#now()) return null;
    if (!Number.isSafeInteger(input.base_revision) || input.base_revision < 0) return null;
    if (!Number.isSafeInteger(input.control_revision) || input.control_revision < 0) return null;
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) return null;
    // The confirmation must be the real one, for the same run, for the same purpose and
    // it must not have expired.
    const confirmation = tx.get('trusted_confirmation', {
      project_id: input.project_id,
      run_id: input.run_id,
      confirmation_id: input.confirmation_id,
    });
    if (!confirmation || confirmation.purpose !== 'change.approve' || confirmation.channel !== 'trusted_ui')
      return null;
    if (confirmation.expires_at <= this.#now()) return null;
    // The run must be the run the approval names.
    const run = tx.get('run', { project_id: input.project_id, run_id: input.run_id });
    if (!run || run.run_scope_digest !== input.run_scope_digest) return null;
    // The approval may only name a real, durable attempt of this run.
    const attempt = tx.get('step_attempt', {
      project_id: input.project_id,
      run_id: input.run_id,
      plan_version: 1,
      step_id: input.step_id,
      attempt: input.attempt,
    });
    if (!attempt || attempt.input_digest !== input.input_digest) return null;
    if (confirmation.input_digest !== input.input_digest || confirmation.action_digest !== input.action_digest
      || input.expires_at > confirmation.expires_at
      || this.#sessionGuard && !this.#sessionGuard({principal_id:confirmation.authenticated_actor,session_ref:confirmation.session_ref})) return null;
    const scope = this.#reviews.get(tx);
    const prepared = scope !== undefined || input.change_id.startsWith('ps_')
      || this.#prepared?.read(input.change_id) !== undefined || this.#impacts?.planFact(input.impact_id) !== undefined;
    if (prepared) {
      if (!scope || input.action_digest !== scope.digest || input.facts_digest !== scope.digest
        || input.impact_id !== scope.request.impact_id || input.change_id !== scope.read.prepared_source_id
        || input.project_id !== scope.request.project_id || input.run_id !== scope.request.run_id
        || input.step_id !== scope.read.execution.step_id || input.attempt !== scope.read.execution.attempt
        || confirmation.review_id !== scope.request.package_id
        || confirmation.authenticated_actor !== scope.caller.principal_id || confirmation.session_ref !== scope.caller.session_ref)
        return null;
      this.#assertPrepared(tx, scope);
      const plan = scope.proof.facts;
      if (input.base_revision !== plan.base_revision || input.control_revision !== plan.control_revision
        || input.expires_at * 1000 > Date.parse(this.#impacts!.read(input.impact_id)!.expires_at)) return null;
    }
    // One confirmation can never mint a second approval. Return the exact existing
    // active record on replay; differing bindings or a consumed record are refused.
    const previous = tx.list('approval', {project_id:input.project_id,run_id:input.run_id})
      .find(row => row.confirmation_id === input.confirmation_id);
    if (previous) {
      const {approval_id:_id,state,consumed_transaction_id:_consumed,...binding} = previous;
      return state === 'active' && canonicalDigest(binding) === canonicalDigest(input) ? previous : null;
    }
    const record: ApprovalRecord = {
      project_id: input.project_id,
      run_id: input.run_id,
      approval_id: `approval_${randomUUID().replaceAll('-', '')}`,
      run_scope_digest: input.run_scope_digest,
      confirmation_id: input.confirmation_id,
      plan_version: 1,
      step_id: input.step_id,
      attempt: input.attempt,
      input_digest: input.input_digest,
      change_id: input.change_id,
      impact_id: input.impact_id,
      base_revision: input.base_revision,
      control_revision: input.control_revision,
      action_digest: input.action_digest,
      facts_digest: input.facts_digest,
      state: 'active',
      expires_at: input.expires_at,
      consumed_transaction_id: null,
    };
    tx.put('approval', {
      project_id: record.project_id,
      run_id: record.run_id,
      approval_id: record.approval_id,
    }, record);
    return record;
  }
}
