import { ProductSqliteRepository } from '../agent-driven/product-sqlite-repository.js';
import type { NativeAckRecord } from '../creative/product-repository.js';
import type { RevisionStore } from '../projects/revision-store.js';

/**
 * The durable native acknowledgement store (A-R2, L05).
 *
 * It is the **existing** `cp_a0_native_ack` table, on the **existing** Host connection.
 * There is no second table, no second queue and no relaxed fingerprint: the row is
 * appended through the same `ProductSqliteRepository` that every other product fact
 * uses, so the acknowledgement is part of the one command ledger and not a side store
 * that could drift from it.
 *
 * The row is the durable half of the acknowledgement. The frozen `NativeAck` DTO stays
 * unchanged, and the view, document and hydration epochs stay *internal* producer
 * context: they are never smuggled into a contract that does not carry one, and they are
 * never written into the row.
 */

/** The Host's own current commit facts, read from the same connection. */
export interface NativeCurrentState {
  readonly revision: number;
  readonly control_revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  /** The single attention predicate: while it is set, no acknowledgement may be written. */
  readonly recovery_gate: boolean;
}

export interface NativeAckStoreDeps {
  /** The one Host connection. There is no second database. */
  readonly revisions: RevisionStore;
  readonly now?: () => Date;
}

export interface NativeAckWrite {
  readonly project_id: string;
  readonly bridge_session_id: string;
  readonly loaded_revision: number;
  readonly loaded_snapshot_id: string;
  readonly source_digest: string;
}

export class NativeAckStore {
  readonly #revisions: RevisionStore;
  readonly #repo: ProductSqliteRepository;
  readonly #now: () => Date;

  constructor(deps: NativeAckStoreDeps) {
    this.#revisions = deps.revisions;
    this.#repo = new ProductSqliteRepository(deps.revisions);
    this.#now = deps.now ?? (() => new Date());
  }

  /**
   * The current commit facts of a project, or `null` when it has never committed.
   *
   * This is the final boundary's own authority: the acknowledgement is written only when
   * the commit, the control revision and the recovery gate are exactly what the session
   * was opened against.
   */
  currentState(project_id: string): NativeCurrentState | null {
    const commit = this.#revisions.activeCommit(project_id);
    if (commit === undefined) return null;
    return {
      revision: commit.revision,
      control_revision: this.#revisions.controlRevision(project_id, 0),
      snapshot_id: commit.snapshot_id,
      source_digest: commit.source_digest,
      recovery_gate: this.#revisions.recoveryGate(project_id, 0),
    };
  }

  /**
   * Append one acknowledgement.
   *
   * The sequence is allocated inside the same transaction as the insert, so two
   * concurrent rounds cannot claim the same number. The row is immutable: the table's own
   * triggers refuse an update or a delete, and the repository refuses a second,
   * different row under the same key. A repeated write of the *same* acknowledgement is a
   * replay and changes nothing.
   */
  async record(input: NativeAckWrite & { readonly observed_at?: string }): Promise<NativeAckRecord> {
    const observed_at = input.observed_at ?? this.#now().toISOString();
    return this.#repo.transaction(tx => {
      // The sequence is allocated inside the very transaction that inserts the row, on
      // the same connection, so two concurrent rounds cannot claim the same number.
      const highest = this.#revisions.compose(db => {
        const row = db.prepare('SELECT MAX(ack_seq) AS highest FROM cp_a0_native_ack WHERE project_id=? AND editor_session_id=?')
          .get(input.project_id, input.bridge_session_id) as { highest?: number | null } | undefined;
        return Number(row?.highest ?? 0);
      });
      const ack_seq = highest + 1;
      const outcome = tx.put('native_ack',
        { project_id: input.project_id, editor_session_id: input.bridge_session_id, ack_seq },
        {
          project_id: input.project_id,
          editor_session_id: input.bridge_session_id,
          ack_seq,
          loaded_revision: input.loaded_revision,
          loaded_snapshot_id: input.loaded_snapshot_id,
          source_digest: input.source_digest,
          observed_at,
        });
      return outcome.record;
    });
  }

  /**
   * The newest acknowledgement of a project, whatever session wrote it.
   *
   * This is a read of the durable fact, not a claim that the editor is loaded. The caller
   * still has to match it against the active session, the current revision, the current
   * snapshot, the current source digest and the current selection: a row from a previous
   * session never matches a new one.
   */
  async latest(project_id: string): Promise<NativeAckRecord | null> {
    const row = this.#revisions.compose(db => db.prepare(
      'SELECT project_id, editor_session_id, ack_seq, loaded_revision, loaded_snapshot_id, source_digest, observed_at'
      + ' FROM cp_a0_native_ack WHERE project_id=? ORDER BY ack_seq DESC LIMIT 1').get(project_id));
    if (row === undefined) return null;
    const record = row as Record<string, unknown>;
    return {
      project_id: String(record.project_id),
      editor_session_id: String(record.editor_session_id),
      ack_seq: Number(record.ack_seq),
      loaded_revision: Number(record.loaded_revision),
      loaded_snapshot_id: String(record.loaded_snapshot_id),
      source_digest: String(record.source_digest),
      observed_at: String(record.observed_at),
    };
  }
}
