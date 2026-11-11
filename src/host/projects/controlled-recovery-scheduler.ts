import type { ProjectTransactionRow, ProjectTransactionState, RevisionStore } from './revision-store.js';
import { claimsAdoption, claimsHistoryRestore } from './controlled-write-formats.js';

export type ControlledRecoveryFamily = 'created' | 'history' | 'adoption';
const FAMILIES: readonly ControlledRecoveryFamily[] = ['created', 'history', 'adoption'];
const DECIDED = new Set<ProjectTransactionState>(['committed', 'aborted', 'attention']);
const RANK: Partial<Record<ProjectTransactionState, number>> = {
  received: 0, preconditions_checked: 1, staged: 2, validated: 3, prepared: 4,
};
type RecoveryRow = OrderingRow & Pick<ProjectTransactionRow, 'request_hash' | 'base_revision'>;
type OrderingRow = Pick<ProjectTransactionRow, 'transaction_id' | 'project_id' | 'created_at' | 'kind' | 'request_json' | 'state'>;

/** Ownership classification only. Neither this marker nor scheduler eligibility authorizes a write. */
export function controlledRecoveryFamily(row: Pick<OrderingRow, 'kind' | 'request_json'>): ControlledRecoveryFamily | undefined {
  if (row.kind === 'history' && claimsHistoryRestore(row.request_json)) return 'history';
  if (row.kind !== 'edit') return undefined;
  if (claimsAdoption(row.request_json)) return 'adoption';
  try {
    const value: unknown = JSON.parse(row.request_json);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)
      && 'operation' in value && value.operation === 'agent.created_source.apply@1') return 'created';
  } catch { /* Unknown requests remain owned by generic recovery. */ }
  return undefined;
}

/** ASCII total order; equal timestamps must not make sibling rows mutually defer. */
export function compareControlledRecoveryRows(a: Pick<OrderingRow, 'created_at' | 'transaction_id'>,
  b: Pick<OrderingRow, 'created_at' | 'transaction_id'>): number {
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  return compare(a.created_at, b.created_at) || compare(a.transaction_id, b.transaction_id);
}

export function hasOlderControlledPending(row: OrderingRow, rows: readonly OrderingRow[]): boolean {
  return rows.some(other => other.project_id === row.project_id && other.transaction_id !== row.transaction_id
    && other.state !== 'committed' && other.state !== 'aborted' && controlledRecoveryFamily(other) !== undefined
    && compareControlledRecoveryRows(other, row) < 0);
}

export interface ControlledRecoveryReport {
  passes: number;
  decided: number;
  /** Includes attention/recovering: both still block their project's ordinary write gate. */
  unresolved_transaction_ids: readonly string[];
  stopped: 'decided' | 'no_progress';
}
export type ControlledRecoveryHandlers = Record<ControlledRecoveryFamily,
  (options: Readonly<{ sweep: boolean }>) => Promise<unknown>>;

/**
 * Startup-only, under the existing runtime's exclusive ownership and closed write ingress.
 * This component does not acquire that ownership, execute generic recovery, or grant proof.
 * Family callbacks must enforce hasOlderControlledPending and their original authority checks.
 * A callback's reported counts are deliberately ignored. Only original DB state decides progress.
 */
export class ControlledRecoveryScheduler {
  #running = false;
  constructor(private readonly revisions: RevisionStore, private readonly handlers: ControlledRecoveryHandlers) {}

  #rows(): RecoveryRow[] {
    // Include recovering AND terminal rows: incompleteTransactions deliberately omits the former.
    // A single same-connection read avoids inconsistent or quadratic per-row lookups.
    return this.revisions.compose(db => db.prepare(`SELECT transaction_id,project_id,created_at,kind,
      request_json,request_hash,base_revision,state FROM project_transaction`).all().map(row => ({
        transaction_id: String(row.transaction_id), project_id: String(row.project_id), created_at: String(row.created_at),
        kind: String(row.kind) as ProjectTransactionRow['kind'], request_json: String(row.request_json),
        request_hash: String(row.request_hash), base_revision: Number(row.base_revision),
        state: String(row.state) as ProjectTransactionState,
      }))).filter(row => controlledRecoveryFamily(row) !== undefined).sort(compareControlledRecoveryRows);
  }

  async recover(): Promise<ControlledRecoveryReport> {
    if (this.#running) throw new Error('CONTROLLED_RECOVERY_ALREADY_RUNNING');
    this.#running = true;
    try {
      let previous = this.#rows();
      const original = new Map(previous.map(row => [row.transaction_id, row]));
      const immutable = (row: RecoveryRow) => JSON.stringify([
        row.project_id, row.kind, row.request_json, row.request_hash, row.created_at, row.base_revision,
      ]);
      const observe = (): RecoveryRow[] => {
        const current = this.#rows();
        if (current.length !== original.size || current.some(row => !original.has(row.transaction_id))) {
          throw new Error('CONTROLLED_RECOVERY_LIFECYCLE_SET_CHANGED');
        }
        const before = new Map(previous.map(row => [row.transaction_id, row]));
        for (const row of current) {
          const prior = before.get(row.transaction_id)!;
          if (immutable(row) !== immutable(original.get(row.transaction_id)!)) {
            throw new Error('CONTROLLED_RECOVERY_LIFECYCLE_IDENTITY_CHANGED');
          }
          if (row.state !== prior.state) {
            const from = RANK[prior.state], to = RANK[row.state];
            if (DECIDED.has(prior.state) || prior.state === 'recovering'
              || (!DECIDED.has(row.state) && (from === undefined || to === undefined || to < from))) {
              throw new Error('CONTROLLED_RECOVERY_LIFECYCLE_STATE_REGRESSED');
            }
          }
        }
        previous = current;
        return current;
      };
      let passes = 0, decided = 0;
      for (;;) {
        const pending = new Set(previous.filter(row => !DECIDED.has(row.state)).map(row => row.transaction_id));
        passes += 1;
        for (const family of FAMILIES) {
          await this.handlers[family](Object.freeze({ sweep: passes === 1 }));
          observe();
        }
        const progress = previous.filter(row => pending.has(row.transaction_id) && DECIDED.has(row.state)).length;
        decided += progress;
        const unresolved = previous.filter(row => row.state !== 'committed' && row.state !== 'aborted');
        if (previous.every(row => DECIDED.has(row.state)) || progress === 0) {
          return Object.freeze({ passes, decided,
            unresolved_transaction_ids: Object.freeze(unresolved.map(row => row.transaction_id)),
            stopped: previous.every(row => DECIDED.has(row.state)) ? 'decided' : 'no_progress' });
        }
        // Every continued pass decides >=1 of the finite initial set. No fixed pass budget.
      }
    } finally { this.#running = false; }
  }
}
