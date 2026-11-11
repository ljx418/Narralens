import { randomUUID } from 'node:crypto';
import { ProductError } from '../creative/trusted-context.js';
import type {
  ApprovalRecord,
  ProductTransaction,
  TrustedAdoptionAuthority,
  TrustedApprovalInput,
  TrustedConfirmationInput,
  TrustedConfirmationRecord,
} from '../creative/product-repository.js';

export interface CreatedRunAuthorityOptions {
  /** The live session guard. A confirmation is only as good as the session that made
   * it, so the authority re-checks the session instead of trusting the record. */
  readonly sessionGuard?: (input: { readonly principal_id: string; readonly session_ref: string }) => boolean;
  /** The clock, in epoch seconds. */
  readonly now?: () => number;
  /** The longest lifetime a confirmation may be given. */
  readonly confirmationTtlSeconds?: number;
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

  constructor(options: CreatedRunAuthorityOptions = {}) {
    this.#sessionGuard = options.sessionGuard;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#ttl = options.confirmationTtlSeconds ?? DEFAULT_CONFIRMATION_TTL_SECONDS;
    if (!Number.isSafeInteger(this.#ttl) || this.#ttl < 1) throw Error('Invalid confirmation lifetime');
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
