import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NarralensHost } from '../server.js';
import { ProductError } from '../creative/trusted-context.js';
import { canonicalDigest, canonicalJson, contentDigest } from '../creative/digest.js';
import { creativeInputClosure } from '../creative/creative-closure.js';
import { validateAgentDefinition } from '../../contracts/agent-driven-validator.js';
import type { Applied, ApplyChange } from '../../contracts/agent-driven-types.js';
import { computeSourceDigest } from '../engine/source-digest-v1.js';
import { OPENFILM_UPSTREAM_SHA } from '../engine/engine-binding-store.js';
import { validateCreatedSourceFact, type CreatedSourceFact } from '../projects/project-creation-store.js';
import type { ProjectCreationStore } from '../projects/project-creation-store.js';
import { OperationIdempotencyStore } from '../projects/operation-idempotency-store.js';
import { ProductSqliteRepository } from './product-sqlite-repository.js';
import { controlledRecoveryFamily, compareControlledRecoveryRows, hasOlderControlledPending } from '../projects/controlled-recovery-scheduler.js';
import type { ProjectTransactionRow } from '../projects/revision-store.js';
import { CreatedSourceAdoptionStore, type CreatedAdoptionFact } from './created-source-adoption-store.js';
import { CreatedPublicationIdentityStore } from './created-publication-identity-store.js';
import { CreatedSourcePublisher, type CreatedSourceSelectionPort } from './created-source-publisher.js';
import {
  CreatedPublicationRecoveryFiles,
  type CreatedRecoveryFilesLease,
  type RecoveryFileLayout,
} from './created-publication-recovery-files.js';
import { RetainedSourceTree } from './retained-source-tree.js';
import { PublicationCleanupError } from './publication-cleanup.js';
import { assertPreparedAdoptionPlan, preparedAdoptionPlanDigest, type PreparedAdoptionPlanV1 } from './created-source-ports.js';
import type { CreatedTaskStore } from './created-task-store.js';
import type { LocalAssetRegistry } from './local-asset-registry.js';
import type { PreparedDraftVerifier } from './prepared-draft-verifier.js';

/**
 * Host-only business recovery for the created-source adoption family.
 *
 * This service owns no state machine of its own. It reads the original rows, proves what
 * actually happened, and then drives the original Coordinator queue, the original
 * Publisher, the original recovery-file resource lease and the original closed commit to
 * a decision. A new business state, a new Approval, a new proof or a new wire DTO would
 * each be a second authority, so none of them exist here.
 *
 * The service is not mounted by the Host yet. Nothing in this file may be reported as
 * RCV-D10-10 or as a business recovery pass until the Host actually calls it.
 */

const CREATED_APPLY_OPERATION = 'agent.created_source.apply@1';
const IDEMPOTENCY_OPERATION = 'agent.v1:change.apply';
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DECIDED = new Set(['committed', 'aborted', 'attention']);
const ABORTABLE = new Set(['received', 'preconditions_checked', 'staged', 'validated', 'prepared']);

/**
 * Machine reasons. Every outcome carries exactly one of these; no free text is matched
 * anywhere in this module. The reason is the classification, not a human message.
 */
export type CreatedSourceRecoveryReason =
  | 'NOT_A_CREATED_TRANSACTION'
  | 'ALREADY_COMMITTED'
  | 'RECEIPT_NOT_REPLAYABLE'
  | 'TERMINAL_STATE_NOT_REVIVED'
  | 'ORDERED_AFTER_OLDER_PENDING'
  | 'ORIGIN_MISSING'
  | 'REQUEST_NOT_LEGITIMATE'
  | 'BASE_MOVED'
  | 'AUTHOR_NOT_PROVABLE'
  | 'IDENTITY_NOT_PROVABLE'
  | 'PUBLISHED_NOT_PROVABLE'
  | 'AUTHORITY_CURRENT'
  | 'AUTHORITY_EXPIRED'
  | 'AUTHORITY_WITHDRAWN'
  | 'RUN_CANCELLED'
  | 'RUN_PAUSED'
  | 'RUN_NOT_ACTIVE'
  | 'LOCK_ACTIVE'
  | 'SELECTION_CHANGED'
  | 'RIGHTS_CHANGED'
  | 'CREATIVE_INPUT_CHANGED'
  | 'IMPACT_EXPIRED'
  | 'OTHER_PREPARED_PENDING'
  | 'PROVEN_ABORTED'
  | 'COMPENSATED_ABORTED'
  | 'RECOVERED_COMMIT'
  | 'RECOVERED_PUBLISHED_JOURNAL'
  | 'GATE_BLOCKED'
  | 'TRANSIENT_RESOURCE_ERROR'
  | 'UNEXPECTED_FAILURE';

export type CreatedSourceRecoveryOutcome =
  | 'committed'
  | 'already_committed'
  | 'aborted'
  | 'attention'
  | 'deferred'
  | 'not_owned';

/** Internal receipt. No wire DTO, no persisted state, no new contract. */
export interface CreatedSourceRecoveryResult {
  readonly transaction_id: string;
  readonly project_id: string;
  readonly outcome: CreatedSourceRecoveryOutcome;
  readonly reason: CreatedSourceRecoveryReason;
  readonly revision: number | null;
}

export interface CreatedSourceRecoveryReport {
  readonly passes: number;
  readonly decided: number;
  readonly unresolved_transaction_ids: readonly string[];
  readonly stopped: 'decided' | 'no_progress';
  readonly results: readonly CreatedSourceRecoveryResult[];
}

export interface CreatedSourceRecoveryOptions {
  /** The one real Host. Its RevisionStore, Coordinator and SnapshotStore are the authority. */
  readonly host: NarralensHost;
  /** MAIN's bootstrap store. The only source of the project owner and its origin. */
  readonly creation: ProjectCreationStore;
  readonly tasks: CreatedTaskStore;
  readonly assets: LocalAssetRegistry;
  readonly verifier: PreparedDraftVerifier;
  readonly selection: CreatedSourceSelectionPort;
  /** Host-fixed roots. No request, journal or client value may contribute to a path. */
  readonly createdRoot: string;
  readonly privateRoot: string;
  readonly stageDomainRoot: string;
  readonly now?: () => Date;
}

interface AuthorityVerdict {
  readonly valid: boolean;
  readonly reason: CreatedSourceRecoveryReason;
}
interface BaseProof {
  readonly ok: true;
  readonly active: { readonly revision: number; readonly source_digest: string; readonly snapshot_id: string };
}
interface OriginalProof extends BaseProof {
  readonly guard: RetainedSourceTree;
}
interface BaseRefusal {
  readonly ok: false;
  readonly reason: CreatedSourceRecoveryReason;
}
type RequestVerdict = { readonly ok: true; readonly input: ApplyChange } | { readonly ok: false };

/**
 * A request that survived the legitimacy gate. The adoption fact and the plan are absent
 * only when the original database has not produced them yet; that absence is a fact of
 * this transaction, never a permission.
 */
interface Legitimacy {
  readonly ok: true;
  readonly input: ApplyChange;
  readonly adoption: CreatedAdoptionFact | undefined;
  readonly plan: PreparedAdoptionPlanV1 | undefined;
}

/**
 * The original closed commit's exact machine failure markers. These are its own tokens,
 * not human copy, and each one names exactly one business decision.
 */
const COMMIT_MARKERS: Readonly<Record<string, { readonly outcome: 'abort' | 'attention' | 'defer'; readonly reason: CreatedSourceRecoveryReason }>> = Object.freeze({
  CREATED_COMMIT_AUTHORITY_EXPIRED_AT_COMMIT: { outcome: 'abort', reason: 'AUTHORITY_EXPIRED' },
  CREATED_COMMIT_APPROVAL_STALE: { outcome: 'abort', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_CONFIRMATION_STALE: { outcome: 'abort', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_EXECUTION_STALE: { outcome: 'abort', reason: 'RUN_NOT_ACTIVE' },
  CREATED_COMMIT_REVIEW_STALE: { outcome: 'abort', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_REVIEW_MISSING: { outcome: 'abort', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_PACKAGE_MISMATCH: { outcome: 'abort', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_PACKAGE_STALE: { outcome: 'abort', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_PACKAGE_IMPACT_MISMATCH: { outcome: 'abort', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_FIXED_PLAN_CHANGED: { outcome: 'abort', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_CREATIVE_INPUT_CHANGED: { outcome: 'abort', reason: 'CREATIVE_INPUT_CHANGED' },
  CREATED_COMMIT_TARGET_LOCKED: { outcome: 'abort', reason: 'LOCK_ACTIVE' },
  CREATED_COMMIT_IMPACT_CAS: { outcome: 'defer', reason: 'AUTHORITY_WITHDRAWN' },
  CREATED_COMMIT_OTHER_TRANSACTION_PENDING: { outcome: 'defer', reason: 'OTHER_PREPARED_PENDING' },
  CREATED_COMMIT_BASE_MOVED: { outcome: 'attention', reason: 'BASE_MOVED' },
  CREATED_COMMIT_PROJECT_CAS: { outcome: 'attention', reason: 'BASE_MOVED' },
  CREATED_COMMIT_TRANSACTION_MISMATCH: { outcome: 'attention', reason: 'IDENTITY_NOT_PROVABLE' },
  CREATED_COMMIT_ADOPTION_MISMATCH: { outcome: 'attention', reason: 'IDENTITY_NOT_PROVABLE' },
  CREATED_COMMIT_PLAN_MISMATCH: { outcome: 'attention', reason: 'IDENTITY_NOT_PROVABLE' },
  CREATED_COMMIT_PREPARED_MAPPING_MISMATCH: { outcome: 'attention', reason: 'IDENTITY_NOT_PROVABLE' },
  CREATED_COMMIT_FACT_MISSING: { outcome: 'attention', reason: 'IDENTITY_NOT_PROVABLE' },
  CREATED_COMMIT_SNAPSHOT_CONFLICT: { outcome: 'attention', reason: 'IDENTITY_NOT_PROVABLE' },
  CREATED_COMMIT_GEOMETRY_CONFLICT: { outcome: 'attention', reason: 'IDENTITY_NOT_PROVABLE' },
});

/**
 * A resource failure that proves nothing about the business.
 *
 * The prepared row, its files and its approvals are left exactly as they are, and the
 * decision is deferred for a later reconciliation. This is never a terminal verdict.
 */
class TransientRecoveryError extends Error {
  constructor(readonly original: unknown) {
    super('TRANSIENT_RECOVERY_RESOURCE_ERROR');
    this.name = 'TransientRecoveryError';
  }
}

/** Filesystem conditions a later attempt may still succeed in. Never a terminal decision. */
const TRANSIENT_IO = new Set([
  'EIO', 'ENOMEM', 'EMFILE', 'ENFILE', 'EBUSY', 'EAGAIN', 'EWOULDBLOCK', 'EINTR',
  'ENOSPC', 'ETXTBSY', 'EDEADLK', 'ECONNRESET', 'EPIPE', 'EACCES', 'EPERM', 'EBADF',
  'EINVAL', 'ESTALE',
]);

/**
 * A confirmed absence. The operation looked and the thing was not there. What that
 * means is decided by the operation, never globally: an absent optional journal is no
 * publication evidence, an absent required resource is a lost resource.
 */
const ABSENT_CODES = new Set(['ENOENT', 'ENOTDIR']);

function errnoOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * How a failure is read. Only a resource failure is classified at all; a programming
 * error stays fatal so it can never hide behind a business verdict.
 *
 * - `conflict`: the actual module proved that two facts disagree.
 * - `absent`: the actual module proved that a resource is not there.
 * - `unknown`: the machine could not finish; the business fact is unknown.
 * - `fatal`: not a resource failure at all.
 */
function classifyResource(error: unknown): 'conflict' | 'absent' | 'unknown' | 'fatal' {
  if (error instanceof PublicationCleanupError) return 'unknown';
  if (error instanceof ProductError) {
    if (error.code === 'REVISION_CONFLICT') return 'conflict';
    if (error.code === 'HOST_RESOURCE_EXHAUSTED' || error.code === 'CAPABILITY_UNAVAILABLE') return 'unknown';
    return 'unknown';
  }
  const code = errnoOf(error);
  if (code === undefined) {
    // A database that is busy or locked is a machine condition, not a business fact.
    const message = error instanceof Error ? error.message : '';
    if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(message)) return 'unknown';
    return 'fatal';
  }
  if (ABSENT_CODES.has(code)) return 'absent';
  if (TRANSIENT_IO.has(code)) return 'unknown';
  return 'unknown';
}

function isTransientResourceError(error: unknown): boolean {
  if (error instanceof PublicationCleanupError) return true;
  if (error instanceof ProductError) {
    return error.code === 'HOST_RESOURCE_EXHAUSTED' || error.code === 'CAPABILITY_UNAVAILABLE';
  }
  const code = errnoOf(error);
  return typeof code === 'string' && TRANSIENT_IO.has(code);
}

export class CreatedSourceRecovery {
  readonly #adoptions: CreatedSourceAdoptionStore;
  readonly #identities: CreatedPublicationIdentityStore;
  readonly #files: CreatedPublicationRecoveryFiles;
  readonly #publishers = new Set<CreatedSourcePublisher>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #uncertain = new Map<string, unknown>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(private readonly options: CreatedSourceRecoveryOptions) {
    this.#adoptions = new CreatedSourceAdoptionStore(options.host.revisions);
    this.#identities = new CreatedPublicationIdentityStore(options.host.revisions);
    this.#files = new CreatedPublicationRecoveryFiles({
      revisions: options.host.revisions,
      snapshots: options.host.snapshots,
      createdRoot: options.createdRoot,
      privateRoot: options.privateRoot,
      // MAIN's real reservation identity, never a request or journal value.
      creationIdentity: (project) => {
        const reservation = options.creation.forProject(project);
        return reservation
          ? { command_id: reservation.command_id, transaction_id: reservation.transaction_id }
          : null;
      },
    });
  }

  #now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  #open(): void {
    if (this.#closed) throw new ProductError('CAPABILITY_UNAVAILABLE', 'Created source recovery is closed');
  }

  // ── the rows this service owns ────────────────────────────────────────────────────

  /** Only kind=edit rows whose request carries the exact created apply operation. */
  #rows(): ProjectTransactionRow[] {
    return this.options.host.revisions.compose((db) => db.prepare(
      'SELECT transaction_id,project_id,state,kind,correlation_id,request_json,request_hash,base_revision,source_digest_before,source_digest_after,snapshot_id,error_code,terminal_reason,created_at,updated_at FROM project_transaction',
    ).all().map((row) => ({
      transaction_id: String(row.transaction_id),
      project_id: String(row.project_id),
      state: String(row.state) as ProjectTransactionRow['state'],
      kind: String(row.kind) as ProjectTransactionRow['kind'],
      correlation_id: String(row.correlation_id ?? ''),
      request_json: String(row.request_json ?? ''),
      request_hash: String(row.request_hash ?? ''),
      base_revision: Number(row.base_revision ?? 0),
      source_digest_before: String(row.source_digest_before ?? ''),
      source_digest_after: String(row.source_digest_after ?? ''),
      snapshot_id: String(row.snapshot_id ?? ''),
      error_code: String(row.error_code ?? ''),
      terminal_reason: String(row.terminal_reason ?? ''),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    })))
      .filter((row) => controlledRecoveryFamily(row) === 'created')
      .sort(compareControlledRecoveryRows);
  }

  /**
   * The pending controlled rows of this project, whichever of the three families owns
   * them. Built from the actual rows; never from a client list, never a blanket skip.
   */
  #ignorablePending(projectId: string): string[] {
    return this.options.host.revisions.projectTransactions(projectId)
      .filter((row) => row.state !== 'committed' && row.state !== 'aborted')
      .filter((row) => controlledRecoveryFamily(row) !== undefined)
      .map((row) => row.transaction_id);
  }

  // ── public entry points ──────────────────────────────────────────────────────────

  /**
   * Startup recovery for this family only. The three-family scheduler and the generic
   * recovery are MAIN's; this service decides the rows it owns and nothing else.
   *
   * Progress is counted from what the original database actually did. A returned label
   * is not a decision, so it is never counted, and a row that stayed `prepared` is never
   * revisited on a second pass.
   */
  async recoverOnStart(): Promise<CreatedSourceRecoveryReport> {
    return this.#admit(() => this.#sweep());
  }

  async #sweep(): Promise<CreatedSourceRecoveryReport> {
    const results = new Map<string, CreatedSourceRecoveryResult>();
    let passes = 0;
    let decided = 0;
    for (;;) {
      const before = this.#rows();
      // attention and recovering rows are never reset and never revived here.
      const pending = before.filter((row) => !DECIDED.has(row.state) && row.state !== 'recovering');
      if (pending.length === 0) {
        return this.#report(results, passes, decided);
      }
      passes += 1;
      for (const row of pending) {
        const current = this.#rows();
        // An older unresolved controlled row of any family owns the preceding decision.
        if (hasOlderControlledPending(row, current)) {
          results.set(row.transaction_id, this.#result(row, 'deferred', 'ORDERED_AFTER_OLDER_PENDING'));
          continue;
        }
        // The complete sweep was admitted before close. Its internal work does not
        // request a new public admission while shutdown waits for that sweep.
        const outcome = await this.#recover(row.transaction_id);
        results.set(row.transaction_id, outcome);
      }
      // Only an observed terminal state in the original database is progress.
      const after = this.#rows();
      const beforeStates = new Map(before.map((row) => [row.transaction_id, row.state]));
      const progress = after.filter((row) => {
        const prior = beforeStates.get(row.transaction_id);
        return prior !== undefined && !DECIDED.has(prior) && DECIDED.has(row.state);
      }).length;
      decided += progress;
      if (progress === 0) {
        // No real decision this pass. Stop; never busy loop and never fake progress.
        return this.#report(results, passes, decided);
      }
    }
  }

  /**
   * Recover one transaction. Re-entrant for the same request: a second call for a row
   * that is already decided returns that real result instead of repeating the work.
   */
  async recoverTransaction(transactionId: string): Promise<CreatedSourceRecoveryResult> {
    return this.#admit(() => this.#recover(transactionId));
  }

  #admit<T>(operation: () => Promise<T>): Promise<T> {
    this.#open();
    // Register before any user callback, queue callback or synchronous failure can
    // re-enter close. close then owns the entire accepted operation's lifetime.
    const work = Promise.resolve().then(operation);
    this.#pending.add(work);
    void work.then(() => this.#pending.delete(work), () => this.#pending.delete(work));
    return work;
  }

  /** The report only ever describes this family's rows. */
  #report(
    results: Map<string, CreatedSourceRecoveryResult>,
    passes: number,
    decided: number,
  ): CreatedSourceRecoveryReport {
    const rows = this.#rows();
    // attention and recovering are unresolved: they still block their project's gate.
    const unresolved = rows.filter((row) => row.state !== 'committed' && row.state !== 'aborted');
    // The stop reason follows the original database, exactly like the three-family
    // scheduler: every row decided means the sweep is decided.
    const stopped = rows.every((row) => DECIDED.has(row.state)) ? 'decided' as const : 'no_progress' as const;
    return Object.freeze({
      passes,
      decided,
      results: Object.freeze([...results.values()]),
      unresolved_transaction_ids: Object.freeze(unresolved.map((row) => row.transaction_id)),
      stopped,
    });
  }

  async #recover(transactionId: string): Promise<CreatedSourceRecoveryResult> {
    const revisions = this.options.host.revisions;
    const row = revisions.projectTransaction(transactionId);
    if (!row) throw new ProductError('NOT_FOUND', 'No such transaction');
    if (controlledRecoveryFamily(row) !== 'created') {
      return this.#result(row, 'not_owned', 'NOT_A_CREATED_TRANSACTION');
    }
    // A project whose resource cleanup failed is not decided again. The retained
    // resources may still be held, so any further decision would act on an unknown
    // state. The failure itself stays visible at close.
    if (this.#uncertain.has(row.project_id)) {
      return this.#result(row, 'deferred', 'TRANSIENT_RESOURCE_ERROR');
    }
    if (hasOlderControlledPending(row, revisions.projectTransactions(row.project_id))) {
      return this.#result(row, 'deferred', 'ORDERED_AFTER_OLDER_PENDING');
    }
    if (row.state === 'committed') return this.#verifyCommitted(row);
    if (row.state === 'aborted' || row.state === 'attention' || row.state === 'recovering') {
      // A decided or operator-held row is never revived by this service.
      return this.#result(row, 'deferred', 'TERMINAL_STATE_NOT_REVIVED');
    }
    if (!ABORTABLE.has(row.state)) {
      return this.#result(row, 'deferred', 'TERMINAL_STATE_NOT_REVIVED');
    }
    const ignore = this.#ignorablePending(row.project_id);
    try {
      return await this.options.host.coordinator.controlledRecovery(
        row.project_id, row.transaction_id, row.correlation_id,
        async () => {
          // Re-read after the queue was entered: an older row may have appeared and
          // the row itself may have been decided by somebody else.
          const current = revisions.projectTransactions(row.project_id);
          if (hasOlderControlledPending(row, current)) {
            return this.#result(row, 'deferred', 'ORDERED_AFTER_OLDER_PENDING');
          }
          const live = revisions.projectTransaction(row.transaction_id);
          if (!live) return this.#result(row, 'deferred', 'TERMINAL_STATE_NOT_REVIVED');
          if (live.state === 'committed') return this.#verifyCommitted(live);
          if (!ABORTABLE.has(live.state)) return this.#result(live, 'deferred', 'TERMINAL_STATE_NOT_REVIVED');
          // The same refusal inside the queue: a cleanup failure of this project
          // stops every further decision for it, whoever asked.
          if (this.#uncertain.has(live.project_id)) {
            return this.#result(live, 'deferred', 'TRANSIENT_RESOURCE_ERROR');
          }
          try {
            return await this.#decision(live);
          } catch (error) {
            // A machine that could not finish is not a decision. The prepared row and
            // every file stay exactly as they are.
            if (error instanceof TransientRecoveryError) {
              return this.#result(live, 'deferred', 'TRANSIENT_RESOURCE_ERROR');
            }
            throw error;
          }
        },
        ignore,
      );
    } catch (error) {
      const code = (error as { code?: unknown } | null | undefined)?.code;
      if (code === 'PROJECT_ATTENTION_REQUIRED') {
        // The original gate refused this project for a reason this service did not create.
        // An unrelated pending row of an unknown family still blocks, as it must.
        return this.#result(row, 'deferred', 'GATE_BLOCKED');
      }
      if (error instanceof TransientRecoveryError || isTransientResourceError(error)) {
        return this.#result(row, 'deferred', 'TRANSIENT_RESOURCE_ERROR');
      }
      if (error instanceof ProductError && error.code === 'REVISION_CONFLICT') {
        // A conflict that escaped every local proof is not assumed to be the original
        // gate and not assumed to be an authority failure. It stays unresolved.
        return this.#result(row, 'deferred', 'PUBLISHED_NOT_PROVABLE');
      }
      throw error;
    }
  }

  // ── the decision, behind the legitimacy gate ─────────────────────────────────────

  /**
   * The gate. A request that is not a complete, legitimate `ApplyChange` wrapper is
   * never compensated and never aborted; it is preserved and handed to an operator.
   */
  async #decision(row: ProjectTransactionRow): Promise<CreatedSourceRecoveryResult> {
    const legitimacy = this.#legitimacy(row);
    if (!legitimacy.ok) {
      // Nothing is read from a controlled path, nothing is moved and no publisher is
      // called. The original coordinator records a real attention, and only the
      // attention fact is added: no approval is consumed, no revision, pointer,
      // impact, outbox, idempotency or publication journal row is touched.
      return this.#attention(row, 'REQUEST_NOT_LEGITIMATE');
    }
    if (row.state === 'prepared') return await this.#recoverPrepared(row, legitimacy);
    return await this.#abortUnpublished(row, legitimacy);
  }

  /**
   * A legitimate request carries exactly the operation and the input, the input satisfies
   * the original ApplyChange contract, and its content digest is the original hash.
   * When the original database already holds an adoption fact or a prepared
   * authorization, every one of their items is matched as well.
   */
  #legitimacy(row: ProjectTransactionRow): Legitimacy | { readonly ok: false } {
    let parsed: unknown;
    try { parsed = JSON.parse(row.request_json); } catch { return { ok: false }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'input,operation') return { ok: false };
    if (record.operation !== CREATED_APPLY_OPERATION) return { ok: false };
    let input: ApplyChange;
    try { input = validateAgentDefinition<ApplyChange>('ApplyChange', record.input); } catch { return { ok: false }; }
    if (contentDigest(input) !== row.request_hash) return { ok: false };
    if (input.project_id !== row.project_id || input.base_revision !== row.base_revision) return { ok: false };
    const adoption = this.#adoptions.adoptionFact(row.transaction_id);
    if (!this.#authorizationMatches(row, input, adoption)) return { ok: false };
    if (!adoption) {
      // The original database has not produced an adoption fact yet. The request is
      // still complete and self-consistent; what it must additionally name is checked
      // by the branch that owns the committed base.
      return { ok: true, input, adoption: undefined, plan: undefined };
    }
    if (input.impact_id !== adoption.impact_id || input.approval_id !== adoption.approval_id) return { ok: false };
    if (canonicalDigest(input.execution) !== canonicalDigest(adoption.execution)) return { ok: false };
    const plan = this.#plan(adoption);
    if (!plan) return { ok: false };
    if (input.source_digest !== plan.base_source_digest) return { ok: false };
    if (plan.project_id !== row.project_id || plan.base_revision !== row.base_revision) return { ok: false };
    return { ok: true, input, adoption, plan };
  }

  /**
   * The prepared authorization of this transaction, when the original database already
   * holds one. Missing adoption never means missing authorization. When adoption
   * is absent, the original immutable impact plan proves the authorization digest.
   */
  #authorizationMatches(row: ProjectTransactionRow, input: ApplyChange, adoption?: CreatedAdoptionFact): boolean {
    let record: unknown;
    try {
      record = this.options.host.revisions.compose((db) => db.prepare(
        'SELECT project_id,run_id,approval_id,facts_digest FROM cp_a0_prepared_authorization WHERE transaction_id=?',
      ).get(row.transaction_id));
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
    if (!record) return true;
    const found = record as { project_id?: unknown; run_id?: unknown; approval_id?: unknown; facts_digest?: unknown };
    if (found.project_id !== row.project_id || found.run_id !== input.execution.run_id
      || found.approval_id !== input.approval_id) return false;
    if (adoption) return found.facts_digest === adoption.facts_digest;
    const plan = this.#plan(input);
    if (!plan || plan.project_id !== row.project_id || plan.base_revision !== row.base_revision
      || plan.base_source_digest !== input.source_digest
      || found.facts_digest !== preparedAdoptionPlanDigest(plan)) return false;
    // The surviving authorization must refer to the request's original approval,
    // not merely a self-consistent replacement execution on the same run.
    let approval: Record<string, unknown> | undefined;
    try {
      approval = this.options.host.revisions.compose((db) => db.prepare(
        'SELECT * FROM cp_a0_approval WHERE project_id=? AND run_id=? AND approval_id=?',
      ).get(row.project_id, input.execution.run_id, input.approval_id));
    } catch (error) { throw new TransientRecoveryError(error); }
    return approval !== undefined && approval.impact_id === input.impact_id
      && approval.facts_digest === found.facts_digest && approval.action_digest === found.facts_digest
      && approval.base_revision === row.base_revision && approval.control_revision === plan.control_revision
      && approval.plan_version === input.execution.plan_version && approval.step_id === input.execution.step_id
      && approval.attempt === input.execution.attempt && approval.input_digest === input.execution.input_digest
      && approval.run_scope_digest === input.execution.run_scope_digest;
  }

  // ── the prepared (published-or-not) transaction ───────────────────────────────────

  async #recoverPrepared(row: ProjectTransactionRow, legitimacy: Legitimacy): Promise<CreatedSourceRecoveryResult> {
    const adoption = legitimacy.adoption;
    if (!adoption) {
      // The publisher cannot start without its immutable adoption fact. Publication
      // evidence without a matching fact is a different branch: everything is preserved
      // and an operator is told, because the original author may already have been
      // changed by that publication.
      const evidence = this.#publicationEvidence(row.transaction_id);
      if (evidence.published || evidence.identity) {
        return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
      }
      return await this.#abortUnpublished(row, legitimacy);
    }
    const plan = legitimacy.plan;
    if (!plan) return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
    const owner = this.#proveOwner(row.project_id);
    if (owner === 'unknown') throw new TransientRecoveryError(new Error('The owner marker could not be read'));
    if (owner === 'refused') return this.#attention(row, 'ORIGIN_MISSING');

    const base = await this.#proveCommittedBase(row.project_id, row.base_revision, adoption.original_source_digest);
    if (!base.ok) {
      // The committed base moved. Nothing may be moved or aborted on a stale base.
      return this.#attention(row, base.reason);
    }

    const identity = this.#identities.read(row.transaction_id);
    const journal = this.#journalPhases(row.transaction_id);
    if (!identity || !journal.includes('prepared')) {
      // No cross-process identity for this publication. The design allows a safe abort
      // only while the author still holds the complete original closure.
      const proof = await this.#proveOriginalHeld(row.project_id, row.base_revision, adoption.original_source_digest);
      if (!proof.ok) return this.#refusal(row, proof.reason);
      try {
        this.#abort(row, 'PROVEN_ABORTED');
        return this.#result(row, 'aborted', 'PROVEN_ABORTED');
      } finally { this.#releaseGuard(row.project_id, proof.guard); }
    }

    let lease: CreatedRecoveryFilesLease;
    try {
      lease = await this.#files.inspect(row.transaction_id);
    } catch (error) {
      const kind = classifyResource(error);
      if (kind === 'conflict' || kind === 'absent') return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
      if (kind === 'fatal') throw error;
      throw new TransientRecoveryError(error);
    }
    try {
      let layout: RecoveryFileLayout;
      try {
        layout = await this.#files.layout(lease);
      } catch (error) {
        const kind = classifyResource(error);
        if (kind === 'conflict' || kind === 'absent') return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
        if (kind === 'fatal') throw error;
        throw new TransientRecoveryError(error);
      }
      if (layout === 'published') return await this.#convergePublished(row, adoption, plan, legitimacy, lease);
      // Every other layout means the target never reached the author. Compensation first
      // (the author may be missing), then the original abort.
      const compensation = await this.#compensate(lease);
      if (compensation.state === 'conflict') return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
      if (compensation.state === 'unknown') throw new TransientRecoveryError(compensation.original);
      this.#abort(row, 'COMPENSATED_ABORTED');
      return this.#result(row, 'aborted', 'COMPENSATED_ABORTED');
    } finally {
      try { this.#files.release(lease); } catch (error) { this.#recordCleanupFailure(row.project_id, error); }
    }
  }

  /**
   * The publication is at the author. Either the current authority still allows the
   * original commit, or the original files are restored and the transaction is aborted.
   */
  async #convergePublished(
    row: ProjectTransactionRow,
    adoption: CreatedAdoptionFact,
    plan: PreparedAdoptionPlanV1,
    legitimacy: Legitimacy,
    lease: CreatedRecoveryFilesLease,
  ): Promise<CreatedSourceRecoveryResult> {
    const verdict = await this.#authority(row.project_id, adoption, plan);
    if (!verdict.valid) {
      const compensation = await this.#compensate(lease);
      if (compensation.state === 'conflict') return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
      if (compensation.state === 'unknown') throw new TransientRecoveryError(compensation.original);
      this.#abort(row, verdict.reason);
      return this.#result(row, 'aborted', verdict.reason);
    }
    const publisher = new CreatedSourcePublisher({
      revisions: this.options.host.revisions,
      authorRoot: this.#authorRoot(row.project_id),
      privateRoot: resolve(this.options.privateRoot, row.project_id),
      snapshots: this.options.host.snapshots,
      selection: this.options.selection,
      assets: this.options.assets,
      tasks: this.options.tasks,
      verifier: this.options.verifier,
      stageDomainRoot: this.options.stageDomainRoot,
    });
    this.#publishers.add(publisher);
    const hadPublished = this.#journalPhases(row.transaction_id).includes('published');
    try {
      const proof = await publisher.recoverPublished({
        project_id: row.project_id,
        transaction_id: row.transaction_id,
        prepared_source_id: adoption.prepared_source_id,
        stage_root: adoption.stage_root,
        files: plan.files,
        original_source_digest: adoption.original_source_digest,
        published_source_digest: adoption.target_source_digest,
        target_snapshot_id: adoption.expected_snapshot_id,
      }, this.#files, lease);
      const applied = this.options.host.revisions.commitPreparedCreatedSource({
        project_id: row.project_id,
        transaction_id: row.transaction_id,
        impact_id: adoption.impact_id,
        approval_id: adoption.approval_id,
        prepared_source_id: adoption.prepared_source_id,
        execution: adoption.execution,
        idempotency_key: legitimacy.input.meta.idempotency_key,
        request_digest: row.request_hash,
        publication_proof: proof,
      });
      const reason: CreatedSourceRecoveryReason = hadPublished ? 'RECOVERED_COMMIT' : 'RECOVERED_PUBLISHED_JOURNAL';
      return this.#result(row, 'committed', reason, applied.project_revision);
    } catch (error) {
      const marker = error instanceof Error ? error.message : '';
      const classified = Object.hasOwn(COMMIT_MARKERS, marker) ? COMMIT_MARKERS[marker]! : undefined;
      if (classified) {
        if (classified.outcome === 'abort') {
          const compensation = await this.#compensate(lease);
          if (compensation.state === 'conflict') return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
          if (compensation.state === 'unknown') throw new TransientRecoveryError(compensation.original);
          this.#abort(row, classified.reason);
          return this.#result(row, 'aborted', classified.reason);
        }
        if (classified.outcome === 'attention') return this.#attention(row, classified.reason);
        return this.#result(row, 'deferred', classified.reason);
      }
      const kind = classifyResource(error);
      if (kind === 'unknown') return this.#result(row, 'deferred', 'TRANSIENT_RESOURCE_ERROR');
      if (kind === 'fatal') throw error;
      // The identity is checked again by the actual resource module. A failure there is a
      // definitive "cannot prove"; anything else stays unresolved and preserves prepared.
      try {
        await this.#files.layout(lease);
      } catch (proofError) {
        const proofKind = classifyResource(proofError);
        if (proofKind === 'conflict' || proofKind === 'absent') return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
        if (proofKind === 'fatal') throw proofError;
        throw new TransientRecoveryError(proofError);
      }
      const again = await this.#authority(row.project_id, adoption, plan);
      if (!again.valid) {
        const compensation = await this.#compensate(lease);
        if (compensation.state === 'conflict') return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
        if (compensation.state === 'unknown') throw new TransientRecoveryError(compensation.original);
        this.#abort(row, again.reason);
        return this.#result(row, 'aborted', again.reason);
      }
      return this.#result(row, 'deferred', 'PUBLISHED_NOT_PROVABLE');
    } finally {
      try { await publisher.close(); this.#publishers.delete(publisher); } catch (error) { this.#recordCleanupFailure(row.project_id, error); }
    }
  }

  /** Restore the complete original closure and prove the durability barrier. */
  async #compensate(lease: CreatedRecoveryFilesLease): Promise<
    { readonly state: 'compensated' } | { readonly state: 'conflict' } | { readonly state: 'unknown'; readonly original: unknown }> {
    try {
      await this.#files.restoreOriginal(lease);
      this.#files.assertOriginalRestored(lease);
      return { state: 'compensated' };
    } catch (error) {
      const kind = classifyResource(error);
      if (kind === 'conflict' || kind === 'absent') return { state: 'conflict' };
      if (kind === 'fatal') throw error;
      return { state: 'unknown', original: error };
    }
  }

  #abort(row: ProjectTransactionRow, reason: CreatedSourceRecoveryReason): void {
    this.options.host.coordinator.abort(row.transaction_id, 'CREATED_SOURCE_RECOVERY_ABORTED', reason);
  }

  /**
   * A real, persistent attention. The original coordinator writes the transaction state
   * and the project attention flag; a returned label alone would be a decision nobody
   * else can see, and the project would keep looking writable.
   */
  #attention(row: ProjectTransactionRow, reason: CreatedSourceRecoveryReason): CreatedSourceRecoveryResult {
    const live = this.options.host.revisions.projectTransaction(row.transaction_id);
    if (live && live.state !== 'committed' && live.state !== 'attention') {
      this.options.host.coordinator.attention(row.transaction_id, 'CREATED_SOURCE_RECOVERY_ATTENTION', reason, this.#now());
    }
    return this.#result(row, 'attention', reason);
  }

  /**
   * A proven identity or content conflict is an attention. A machine that could not
   * finish is never one: it stays deferred with its files intact.
   */
  #refusal(row: ProjectTransactionRow, reason: CreatedSourceRecoveryReason): CreatedSourceRecoveryResult {
    if (reason === 'BASE_MOVED') return this.#result(row, 'deferred', reason);
    return this.#attention(row, reason);
  }

  // ── the never-published transaction ───────────────────────────────────────────────

  /**
   * A row that never reached a publication. The abort is only legal after the complete
   * committed base, the complete original source closure and the real owner are proved.
   */
  async #abortUnpublished(row: ProjectTransactionRow, legitimacy: Legitimacy): Promise<CreatedSourceRecoveryResult> {
    const adoption = legitimacy.adoption;
    const active = this.options.host.revisions.activeCommit(row.project_id);
    if (!active) return this.#result(row, 'deferred', 'BASE_MOVED');
    const expected = adoption?.original_source_digest ?? active.source_digest;
    // The request must name the source this transaction was based on.
    if (legitimacy.input.source_digest !== expected) {
      return this.#attention(row, 'REQUEST_NOT_LEGITIMATE');
    }
    // Publication evidence without a matching fact is not an early abort. It is the
    // other branch, and it preserves everything.
    const evidence = this.#publicationEvidence(row.transaction_id);
    if (evidence.published || evidence.identity) {
      return this.#attention(row, 'IDENTITY_NOT_PROVABLE');
    }
    const owner = this.#proveOwner(row.project_id);
    if (owner === 'unknown') throw new TransientRecoveryError(new Error('The owner marker could not be read'));
    if (owner === 'refused') return this.#attention(row, 'ORIGIN_MISSING');
    const proof = await this.#proveOriginalHeld(row.project_id, row.base_revision, expected);
    if (!proof.ok) return this.#refusal(row, proof.reason);
    try {
      this.#abort(row, 'PROVEN_ABORTED');
      return this.#result(row, 'aborted', 'PROVEN_ABORTED');
    } finally { this.#releaseGuard(row.project_id, proof.guard); }
  }

  // ── proofs ───────────────────────────────────────────────────────────────────────

  #authorRoot(projectId: string): string {
    return resolve(this.options.createdRoot, projectId, 'source');
  }

  /**
   * The real owner marker of the real creation. No request value participates.
   *
   * A confirmed absent or differing marker is a fact about this creation and refuses the
   * proof. Any other failure is the machine and leaves the decision open.
   */
  #proveOwner(projectId: string): 'proved' | 'refused' | 'unknown' {
    if (!PROJECT_ID.test(projectId)) return 'refused';
    const reservation = this.options.creation.forProject(projectId);
    const origin = this.options.creation.origin(projectId);
    const owner = this.options.creation.ownerOf(projectId);
    if (!reservation || !origin || !owner || origin.origin !== 'created') return 'refused';
    const expected = canonicalJson({
      kind: 'narralens.created-root@1',
      project_id: projectId,
      command_id: reservation.command_id,
      transaction_id: reservation.transaction_id,
    });
    try {
      return readFileSync(resolve(this.options.createdRoot, projectId, 'owner.json'), 'utf8') === expected ? 'proved' : 'refused';
    } catch (error) {
      // Only a confirmed absence is a fact about the creation. Anything else is the
      // machine, and the machine is not a verdict.
      return errnoOf(error) === 'ENOENT' ? 'refused' : 'unknown';
    }
  }

  /** The R1 geometry of a snapshot, read from the original database. */
  #sourceFact(projectId: string, snapshotId: string):
    { readonly state: 'proved'; readonly fact: CreatedSourceFact } | { readonly state: 'refused' } {
    let row: unknown;
    try {
      row = this.options.host.revisions.compose((db) => db.prepare(
        'SELECT fact_json,fact_sha256 FROM created_source_fact WHERE project_id=? AND snapshot_id=?',
      ).get(projectId, snapshotId));
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
    if (!row) return { state: 'refused' };
    const found = row as { fact_json?: unknown; fact_sha256?: unknown };
    try {
      const fact = validateCreatedSourceFact(JSON.parse(String(found.fact_json)) as CreatedSourceFact);
      if (canonicalDigest(fact) !== String(found.fact_sha256)) return { state: 'refused' };
      return { state: 'proved', fact };
    } catch {
      // A stored fact that does not validate is a proven corruption, not a machine error.
      return { state: 'refused' };
    }
  }

  /** The immutable adoption plan of the original impact. */
  #plan(adoption: Pick<CreatedAdoptionFact, 'impact_id'>): PreparedAdoptionPlanV1 | undefined {
    let row: unknown;
    try {
      row = this.options.host.revisions.compose((db) => db.prepare(
        'SELECT plan_json FROM created_impact_fact WHERE impact_id=?',
      ).get(adoption.impact_id));
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
    if (!row) return undefined;
    try {
      return assertPreparedAdoptionPlan(JSON.parse(String((row as { plan_json?: unknown }).plan_json)));
    } catch {
      return undefined;
    }
  }

  /**
   * The publication journal phases of this transaction.
   *
   * A confirmed absent table is a confirmed absent optional journal: this transaction
   * never published anything. It is not an identity conflict and not a failure. Every
   * other read failure leaves the decision open.
   */
  #journalPhases(transactionId: string): string[] {
    const db = this.options.host.revisions.compose((value) => value);
    let present: unknown;
    try {
      present = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='created_publication_journal'").get();
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
    if (!present) return [];
    try {
      return db.prepare('SELECT phase FROM created_publication_journal WHERE transaction_id=?')
        .all(transactionId)
        .map((row) => String(row.phase));
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
  }

  /** What the original database knows about a publication of this transaction. */
  #publicationEvidence(transactionId: string): { readonly published: boolean; readonly identity: boolean } {
    let identity = false;
    try {
      identity = this.#identities.read(transactionId) !== undefined;
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
    const phases = this.#journalPhases(transactionId);
    return { published: phases.includes('published'), identity };
  }

  /** The committed base, the project state and the R1 geometry of the active snapshot. */
  async #proveCommittedBase(projectId: string, baseRevision: number, baseDigest: string): Promise<BaseProof | BaseRefusal> {
    const revisions = this.options.host.revisions;
    const active = revisions.activeCommit(projectId);
    if (!active || active.revision !== baseRevision || active.source_digest !== baseDigest) {
      return { ok: false, reason: 'BASE_MOVED' };
    }
    let state: { revision?: unknown; source_digest?: unknown; control_revision?: unknown; attention?: unknown } | undefined;
    try {
      state = revisions.compose((db) => db.prepare(
        'SELECT revision,source_digest,control_revision,attention FROM project_state WHERE project_id=?',
      ).get(projectId)) as { revision?: unknown; source_digest?: unknown; control_revision?: unknown; attention?: unknown } | undefined;
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
    if (!state || Number(state.revision) !== baseRevision || String(state.source_digest) !== baseDigest
      || Number(state.attention) !== 0) {
      return { ok: false, reason: 'BASE_MOVED' };
    }
    // The active snapshot may already be a later adoption for this project. The R1
    // geometry of the actual active snapshot is read, never assumed.
    const fact = this.#sourceFact(projectId, active.snapshot_id);
    if (fact.state !== 'proved') return { ok: false, reason: 'IDENTITY_NOT_PROVABLE' };
    return { ok: true, active };
  }

  /**
   * The complete original closure still at the author root, held by a retained guard
   * until the abort. This is the proof an unpublished transaction needs; the absence of
   * a publication journal is not a proof of anything.
   */
  async #proveOriginalHeld(projectId: string, baseRevision: number, baseDigest: string): Promise<OriginalProof | BaseRefusal> {
    const base = await this.#proveCommittedBase(projectId, baseRevision, baseDigest);
    if (!base.ok) return base;
    const fact = this.#sourceFact(projectId, base.active.snapshot_id);
    if (fact.state !== 'proved') return { ok: false, reason: 'IDENTITY_NOT_PROVABLE' };
    const root = this.#authorRoot(projectId);
    let digest: Awaited<ReturnType<typeof computeSourceDigest>>;
    try {
      digest = await computeSourceDigest({
        root, roots: fact.fact.roots, engine: 'openfilm', engineUpstreamSha: OPENFILM_UPSTREAM_SHA,
      });
    } catch (error) {
      const kind = classifyResource(error);
      // A proven conflict or a confirmed absent closure is a fact about the author.
      // Every other failure is the machine.
      if (kind === 'conflict' || kind === 'absent') return { ok: false, reason: 'AUTHOR_NOT_PROVABLE' };
      if (kind === 'fatal') throw error;
      throw new TransientRecoveryError(error);
    }
    if (digest.external_reference_count || digest.source_digest !== baseDigest) {
      return { ok: false, reason: 'AUTHOR_NOT_PROVABLE' };
    }
    const guard = this.#guard(projectId, root, digest);
    if (guard.state === 'refused') return { ok: false, reason: 'AUTHOR_NOT_PROVABLE' };
    if (guard.state === 'unknown') throw new TransientRecoveryError(guard.original);
    return { ok: true, guard: guard.guard, active: base.active };
  }

  #guard(projectId: string, root: string, digest: Awaited<ReturnType<typeof computeSourceDigest>>):
    { readonly state: 'proved'; readonly guard: RetainedSourceTree }
    | { readonly state: 'refused' }
    | { readonly state: 'unknown'; readonly original: unknown } {
    const files = [...digest.manifest.files, ...digest.manifest.assets]
      .map((file) => ({ relative_path: file.path, bytes: file.size, sha256: file.sha256 }));
    try {
      // The constructor already verifies the whole tree and closes itself if that
      // verification fails. A second verification here would leave the retained
      // descriptors of a successful guard unowned when it throws.
      const guard = new RetainedSourceTree(root, files);
      return { state: 'proved', guard };
    } catch (error) {
      if (error instanceof PublicationCleanupError) this.#recordCleanupFailure(projectId, error);
      const kind = classifyResource(error);
      if (kind === 'conflict' || kind === 'absent') return { state: 'refused' };
      if (kind === 'fatal') throw error;
      return { state: 'unknown', original: error };
    }
  }

  // ── the current authority ────────────────────────────────────────────────────────

  /**
   * The current authority, read from the actual rows. Every check is a fact about the
   * database, never an interpretation of an error message.
   */
  async #authority(projectId: string, adoption: CreatedAdoptionFact, plan: PreparedAdoptionPlanV1): Promise<AuthorityVerdict> {
    const revisions = this.options.host.revisions;
    const execution = adoption.execution;
    const seconds = Math.floor(this.#now().getTime() / 1000);
    const repository = new ProductSqliteRepository(revisions);
    let verdict: AuthorityVerdict;
    try {
      verdict = await repository.transaction((tx) => {
        const approval = tx.get('approval', {
          project_id: projectId, run_id: execution.run_id, approval_id: adoption.approval_id,
        });
        if (!approval) return { valid: false, reason: 'AUTHORITY_WITHDRAWN' } as AuthorityVerdict;
        if (approval.state !== 'active' || approval.consumed_transaction_id !== null) {
          return { valid: false, reason: 'AUTHORITY_WITHDRAWN' } as AuthorityVerdict;
        }
        if (Number(approval.expires_at) <= seconds) return { valid: false, reason: 'AUTHORITY_EXPIRED' } as AuthorityVerdict;
        if (approval.impact_id !== adoption.impact_id || approval.facts_digest !== adoption.facts_digest
          || approval.action_digest !== adoption.facts_digest || approval.base_revision !== plan.base_revision
          || approval.control_revision !== plan.control_revision || approval.step_id !== execution.step_id
          || approval.attempt !== execution.attempt || approval.input_digest !== execution.input_digest
          || approval.run_scope_digest !== execution.run_scope_digest) {
          return { valid: false, reason: 'AUTHORITY_WITHDRAWN' } as AuthorityVerdict;
        }
        const confirmation = tx.get('trusted_confirmation', {
          project_id: projectId, run_id: execution.run_id, confirmation_id: approval.confirmation_id,
        });
        if (!confirmation || confirmation.purpose !== 'change.approve' || confirmation.channel !== 'trusted_ui'
          || !confirmation.review_id || confirmation.action_digest !== approval.action_digest
          || confirmation.input_digest !== execution.input_digest) {
          return { valid: false, reason: 'AUTHORITY_WITHDRAWN' } as AuthorityVerdict;
        }
        if (Number(confirmation.expires_at) <= seconds) return { valid: false, reason: 'AUTHORITY_EXPIRED' } as AuthorityVerdict;
        const run = tx.get('run', { project_id: projectId, run_id: execution.run_id });
        if (!run) return { valid: false, reason: 'RUN_NOT_ACTIVE' } as AuthorityVerdict;
        if (run.state === 'cancelled') return { valid: false, reason: 'RUN_CANCELLED' } as AuthorityVerdict;
        if (run.state === 'paused') return { valid: false, reason: 'RUN_PAUSED' } as AuthorityVerdict;
        if (!['ready', 'running', 'waiting_user'].includes(run.state)) {
          return { valid: false, reason: 'RUN_NOT_ACTIVE' } as AuthorityVerdict;
        }
        const grant = tx.get('execution_grant', {
          project_id: projectId, run_id: execution.run_id, grant_id: execution.authorization_id,
        });
        if (!grant || grant.state !== 'active') return { valid: false, reason: 'AUTHORITY_WITHDRAWN' } as AuthorityVerdict;
        if (Number(grant.expires_at) <= seconds) return { valid: false, reason: 'AUTHORITY_EXPIRED' } as AuthorityVerdict;
        const step = tx.get('step_attempt', {
          project_id: projectId, run_id: execution.run_id, plan_version: 1, step_id: execution.step_id, attempt: execution.attempt,
        });
        if (!step || !['running', 'waiting_user'].includes(step.state)) {
          return { valid: false, reason: 'RUN_NOT_ACTIVE' } as AuthorityVerdict;
        }
        const fixed = tx.get('plan_version', { project_id: projectId, run_id: execution.run_id, plan_version: 1 });
        if (!fixed || fixed.input_digest !== execution.input_digest) {
          return { valid: false, reason: 'AUTHORITY_WITHDRAWN' } as AuthorityVerdict;
        }
        const creation = this.options.creation.forProject(projectId);
        if (!creation) return { valid: false, reason: 'AUTHORITY_WITHDRAWN' } as AuthorityVerdict;
        const head = tx.get('intake_head', { intake_id: creation.request.intake_id });
        if (!head || canonicalDigest(creativeInputClosure(tx, creation.request.intake_id, head.current_version)) !== execution.input_digest) {
          return { valid: false, reason: 'CREATIVE_INPUT_CHANGED' } as AuthorityVerdict;
        }
        return { valid: true, reason: 'AUTHORITY_CURRENT' } as AuthorityVerdict;
      });
    } catch (error) {
      const kind = classifyResource(error);
      if (kind === 'fatal') throw error;
      throw new TransientRecoveryError(error);
    }
    if (!verdict.valid) return verdict;
    if (revisions.activeLocks(projectId).some((lock) => lock.active)) {
      return { valid: false, reason: 'LOCK_ACTIVE' };
    }
    if (this.options.selection.currentSelectionVersion(projectId) !== plan.selection_version) {
      return { valid: false, reason: 'SELECTION_CHANGED' };
    }
    const rights = this.#rights(adoption, plan);
    if (!rights.valid) return { valid: false, reason: rights.reason };
    return { valid: true, reason: 'AUTHORITY_CURRENT' };
  }

  /** The recorded rights facts against the actual current asset facts. */
  #rights(adoption: CreatedAdoptionFact, plan: PreparedAdoptionPlanV1): AuthorityVerdict {
    let rows: unknown;
    try {
      rows = this.options.host.revisions.compose((db) => db.prepare(
        'SELECT fact_json,fact_sha256 FROM created_local_asset WHERE project_id=?',
      ).all(adoption.project_id));
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
    const facts = (rows as { fact_json?: unknown; fact_sha256?: unknown }[]).map((row) => {
      try {
        const fact = JSON.parse(String(row.fact_json)) as {
          readonly asset_id: string; readonly rights_ref: string; readonly registration_digest: string;
          readonly license: { readonly status: string; readonly commercial_use: boolean };
        };
        return { fact, intact: canonicalDigest(fact) === String(row.fact_sha256) };
      } catch { return undefined; }
    }).filter((value): value is NonNullable<typeof value> => value !== undefined);
    for (const right of plan.rights) {
      const matches = facts.filter((entry) => entry.fact.rights_ref === right.ref_id);
      if (matches.length === 0) return { valid: false, reason: 'RIGHTS_CHANGED' };
      for (const match of matches) {
        if (!match.intact || match.fact.registration_digest !== right.sha256
          || match.fact.license.status !== 'cleared' || match.fact.license.commercial_use !== true) {
          return { valid: false, reason: 'RIGHTS_CHANGED' };
        }
      }
    }
    return { valid: true, reason: 'AUTHORITY_CURRENT' };
  }

  // ── an already committed transaction ─────────────────────────────────────────────

  /**
   * Read the original receipt. Never sign a new proof, never consume again, never +1.
   *
   * When the receipt cannot be matched, the transaction stays committed and this
   * service says so honestly: it reports no revision and no success, because a
   * fallthrough would invent an `Applied` and a revision that were never proved.
   */
  #verifyCommitted(row: ProjectTransactionRow): CreatedSourceRecoveryResult {
    const revisions = this.options.host.revisions;
    const transaction = revisions.projectTransaction(row.transaction_id)!;
    const legitimacy = this.#legitimacy(row);
    if (!legitimacy.ok || !legitimacy.adoption) {
      // The request or the fact does not match this row, so no receipt can be trusted
      // to belong to it. Nothing is written and no revision is claimed.
      return this.#result(row, 'deferred', 'RECEIPT_NOT_REPLAYABLE');
    }
    // The principal that authorized this transaction, read from the grant its own
    // immutable execution names. A later grant for the same project is not a
    // substitute for the historical one.
    const principal = this.#originalPrincipal(row, legitimacy.adoption);
    if (principal === undefined) {
      return this.#result(row, 'deferred', 'RECEIPT_NOT_REPLAYABLE');
    }
    const commands = new OperationIdempotencyStore(revisions.compose((db) => db));
    const remembered = commands.recall(row.project_id, IDEMPOTENCY_OPERATION, legitimacy.input.meta.idempotency_key);
    if (!remembered || remembered.transaction_id !== row.transaction_id
      || remembered.request_digest !== row.request_hash) {
      return this.#result(row, 'deferred', 'RECEIPT_NOT_REPLAYABLE');
    }
    let envelope: { readonly format?: unknown; readonly receipt?: Record<string, unknown>; readonly response?: unknown };
    try {
      envelope = JSON.parse(remembered.response_json) as typeof envelope;
    } catch {
      return this.#result(row, 'deferred', 'RECEIPT_NOT_REPLAYABLE');
    }
    if (envelope.format !== 'agent.idempotency@1' || !envelope.receipt
      || envelope.receipt.operation !== 'change.apply'
      || envelope.receipt.request_digest !== row.request_hash
      || envelope.receipt.project_id !== row.project_id
      || envelope.receipt.principal_id !== principal
      || envelope.receipt.idempotency_key !== legitimacy.input.meta.idempotency_key
      || envelope.receipt.correlation_id !== row.correlation_id) {
      return this.#result(row, 'deferred', 'RECEIPT_NOT_REPLAYABLE');
    }
    let applied: Applied;
    try { applied = validateAgentDefinition<Applied>('Applied', envelope.response); }
    catch { return this.#result(row, 'deferred', 'RECEIPT_NOT_REPLAYABLE'); }
    if (applied.transaction_id !== row.transaction_id || applied.project_id !== row.project_id
      || applied.project_revision !== row.base_revision + 1
      || applied.snapshot_id !== transaction.snapshot_id
      || applied.source_digest !== transaction.source_digest_after) {
      return this.#result(row, 'deferred', 'RECEIPT_NOT_REPLAYABLE');
    }
    return this.#result(row, 'already_committed', 'ALREADY_COMMITTED', applied.project_revision);
  }

  /**
   * The principal of the original authorization of this transaction. The grant is the
   * one named by the transaction's own immutable execution, never whatever grant the
   * project happens to hold now.
   */
  #originalPrincipal(row: ProjectTransactionRow, adoption: CreatedAdoptionFact): string | undefined {
    let grant: unknown;
    try {
      grant = this.options.host.revisions.compose((db) => db.prepare(
        'SELECT principal_id FROM cp_a0_execution_grant WHERE project_id=? AND run_id=? AND grant_id=?',
      ).get(row.project_id, adoption.execution.run_id, adoption.execution.authorization_id));
    } catch (error) {
      throw new TransientRecoveryError(error);
    }
    const principal = grant === undefined
      ? this.options.creation.ownerOf(row.project_id) ?? undefined
      : String((grant as { principal_id?: unknown }).principal_id);
    return principal === undefined || principal === '' ? undefined : principal;
  }

  // ── shutdown ─────────────────────────────────────────────────────────────────────

  #recordCleanupFailure(projectId: string, error: unknown): void {
    const previous = this.#uncertain.get(projectId);
    this.#uncertain.set(projectId, this.#uncertain.has(projectId)
      ? new PublicationCleanupError([previous, error]) : error);
  }

  #releaseGuard(projectId: string, guard: RetainedSourceTree): void {
    try { guard.close(); }
    catch (error) {
      // Cleanup uncertainty must not overwrite the primary operation's error or
      // turn an already completed abort into a misleading deferred result.
      this.#recordCleanupFailure(projectId, error);
    }
  }

  /**
   * Stop accepting, wait for everything this service already accepted, then release the
   * publisher and the resource leases. The database is closed by the Host, last.
   */
  close(): Promise<void> {
    this.#closed = true;
    return this.#closing ??= (async () => {
      await Promise.allSettled([...this.#pending]);
      const failures: unknown[] = [...this.#uncertain.values()];
      for (const publisher of [...this.#publishers]) {
        try { await publisher.close(); this.#publishers.delete(publisher); } catch (error) { failures.push(error); }
      }
      try { await this.#files.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new PublicationCleanupError(failures);
    })();
  }

  #result(
    row: Pick<ProjectTransactionRow, 'transaction_id' | 'project_id'>,
    outcome: CreatedSourceRecoveryOutcome,
    reason: CreatedSourceRecoveryReason,
    revision: number | null = null,
  ): CreatedSourceRecoveryResult {
    return Object.freeze({
      transaction_id: row.transaction_id,
      project_id: row.project_id,
      outcome,
      reason,
      revision,
    });
  }
}
