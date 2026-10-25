import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../engine/source-digest-v1.js";
import type { RevisionStore } from "../projects/revision-store.js";
import type { AffectedLock } from "../projects/lock-service.js";

/**
 * `HistoryStore` (M4C gate §2, §3.4, ADR-W2.0-006 D-06).
 *
 * Two things live here, and neither of them is a state machine:
 *
 * - `history_restore_fact`: the **immutable** facts of a restore that reached its
 *   publication intent. It has no state column on purpose. `project_transaction.state` is
 *   the only state machine in this architecture, and a second one beside it would be a
 *   second answer to "did this restore finish". The fact rows are evidence, selected by the
 *   transaction's pointers; they are never moved.
 * - the **read model**: which snapshots this project has committed, at which revision, and
 *   which of them an undo or a redo would name.
 *
 * The read model never moves the active pointer. Reading history is not a write, and a
 * read model that could move the pointer would be a second way to change what the project
 * *is*.
 */

export interface HistoryRestoreFact {
  readonly transaction_id: string;
  readonly project_id: string;
  /** The snapshot that was asked for. */
  readonly target_snapshot_id: string;
  /**
   * The snapshot the restore produced.
   *
   * For a content-addressed restore this is *the same id* as the target: identical bytes
   * produce an identical snapshot id, and fabricating a second id for identical content
   * would break the property the whole store is built on.
   */
  readonly result_snapshot_id: string;
  /** The snapshot that was active before the restore — the redo target. */
  readonly source_before_snapshot_id: string;
  readonly source_before_sha256: string;
  readonly source_after_sha256: string;
  readonly staged_source_digest: string;
  readonly restore_plan_sha256: string;
  readonly impact_id: string;
  readonly impact_hash: string;
  readonly rights_digest: string;
  /**
   * The locks this write was authorized against.
   *
   * They are recorded because the recovery cannot rebuild the plan: once the restored
   * source has been published, the current source *is* the target, so the difference the
   * plan described is empty by construction. The locks are part of the authorization, and
   * the recovery has to check exactly the ones the authorization named.
   */
  readonly required_locks: readonly AffectedLock[];
  /**
   * The assets the publication installed into the active source.
   *
   * A restore installs none: the target's files are expected to be *already* in the active
   * tree with identical bytes, which is the snapshot-eligibility rule. The list is recorded
   * anyway, because the fact is the record of what the publication did, and a reader must
   * not have to infer it.
   */
  readonly installed_assets: readonly { readonly token: string; readonly sha256: string }[];
  readonly film_temp_token: string;
  readonly publish_intent_created_at: string;
}

export interface HistoryEntry {
  readonly revision: number;
  readonly snapshot_id: string;
  readonly kind: "migration" | "adoption" | "restore";
  readonly transaction_id: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const TOKEN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;

function assertSha(value: string, name: string): void {
  if (!SHA256.test(value)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

function assertToken(value: string, name: string): void {
  if (!TOKEN.test(value) || value.includes("\\") || value.includes(":")) {
    throw new Error(`INVALID_${name.toUpperCase()}`);
  }
}

export class HistoryStore {
  readonly #db: DatabaseSync;
  readonly #revisions: RevisionStore;

  constructor(revisions: RevisionStore) {
    this.#revisions = revisions;
    this.#db = revisions.compose((db) => db);
    // The table ADR-W2.0-006 §D-06 specifies, with three **additive** fact columns.
    //
    // D-06 fixes the fact's shape and forbids three things in it: an absolute path, the
    // request body, and a state enumeration. Every column here is a fact about the write
    // — an id, a digest, a list of locks, a list of assets — and none of them is authority:
    // `project_transaction.state` remains the only state machine, and the fact is never
    // updated or deleted.
    //
    // The three additions are:
    //   - `project_id`, `impact_id`, `impact_hash`, `rights_digest`: which authorization
    //     the write was performed under, so a reader can tell a restore that was authorized
    //     by a *different* impact from one that was not;
    //   - `required_locks_json`: the lock scope the authorization named. The recovery
    //     cannot rebuild the plan — once the restored source is published the current
    //     source *is* the target, so the difference is empty by construction — and the
    //     locks the recovery has to check are exactly the ones that were authorized;
    //   - `installed_assets_json`: what the publication installed. A restore installs none,
    //     and the fact says so rather than leaving a reader to infer it.
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS history_restore_fact (
        transaction_id TEXT PRIMARY KEY REFERENCES project_transaction(transaction_id),
        project_id TEXT NOT NULL,
        target_snapshot_id TEXT NOT NULL,
        result_snapshot_id TEXT NOT NULL,
        source_before_snapshot_id TEXT NOT NULL,
        source_before_sha256 TEXT NOT NULL,
        source_after_sha256 TEXT NOT NULL,
        staged_source_digest TEXT NOT NULL,
        restore_plan_sha256 TEXT NOT NULL,
        impact_id TEXT NOT NULL,
        impact_hash TEXT NOT NULL,
        rights_digest TEXT NOT NULL,
        required_locks_json TEXT NOT NULL,
        installed_assets_json TEXT NOT NULL,
        film_temp_token TEXT NOT NULL,
        publish_intent_created_at TEXT NOT NULL,
        CHECK (source_before_sha256 <> source_after_sha256)
      );
      CREATE TRIGGER IF NOT EXISTS history_restore_fact_immutable_update
        BEFORE UPDATE ON history_restore_fact BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_HISTORY_FACT'); END;
      CREATE TRIGGER IF NOT EXISTS history_restore_fact_immutable_delete
        BEFORE DELETE ON history_restore_fact BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_HISTORY_FACT'); END;
    `);
  }

  /**
   * Record the immutable publish proof and advance `validated -> prepared`, together.
   *
   * One transaction, because the two facts are the same fact: a prepared transaction whose
   * evidence is missing cannot be recovered, and an evidence row whose transaction is not
   * prepared describes a write that never happened.
   */
  prepare(fact: HistoryRestoreFact, now = new Date()): void {
    assertSha(fact.source_before_sha256, "source_before_sha256");
    assertSha(fact.source_after_sha256, "source_after_sha256");
    assertSha(fact.staged_source_digest, "staged_source_digest");
    assertSha(fact.restore_plan_sha256, "restore_plan_sha256");
    assertSha(fact.rights_digest, "rights_digest");
    assertSha(fact.impact_hash, "impact_hash");
    if (fact.required_locks.length === 0) throw new Error("INVALID_REQUIRED_LOCKS");
    assertToken(fact.film_temp_token, "film_temp_token");
    assertToken(fact.target_snapshot_id, "target_snapshot_id");
    assertToken(fact.result_snapshot_id, "result_snapshot_id");
    assertToken(fact.source_before_snapshot_id, "source_before_snapshot_id");
    this.#revisions.atomic(() => {
      this.#db.prepare(`INSERT INTO history_restore_fact(
        transaction_id, project_id, target_snapshot_id, result_snapshot_id,
        source_before_snapshot_id, source_before_sha256, source_after_sha256,
        staged_source_digest, restore_plan_sha256, impact_id, impact_hash, rights_digest,
        required_locks_json, installed_assets_json, film_temp_token, publish_intent_created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        fact.transaction_id, fact.project_id, fact.target_snapshot_id, fact.result_snapshot_id,
        fact.source_before_snapshot_id, fact.source_before_sha256, fact.source_after_sha256,
        fact.staged_source_digest, fact.restore_plan_sha256, fact.impact_id, fact.impact_hash,
        fact.rights_digest, canonicalJson([...fact.required_locks]),
        canonicalJson([...fact.installed_assets]), fact.film_temp_token,
        fact.publish_intent_created_at,
      );
      this.#revisions.transition(fact.transaction_id, "validated", "prepared", {
        snapshot_id: fact.result_snapshot_id,
        source_digest_after: fact.staged_source_digest,
      }, now);
    });
  }

  restoreFact(transactionId: string): HistoryRestoreFact | undefined {
    const row = this.#db.prepare("SELECT * FROM history_restore_fact WHERE transaction_id=?")
      .get(transactionId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      transaction_id: String(row.transaction_id),
      project_id: String(row.project_id),
      target_snapshot_id: String(row.target_snapshot_id),
      result_snapshot_id: String(row.result_snapshot_id),
      source_before_snapshot_id: String(row.source_before_snapshot_id),
      source_before_sha256: String(row.source_before_sha256),
      source_after_sha256: String(row.source_after_sha256),
      staged_source_digest: String(row.staged_source_digest),
      restore_plan_sha256: String(row.restore_plan_sha256),
      impact_id: String(row.impact_id),
      impact_hash: String(row.impact_hash),
      rights_digest: String(row.rights_digest),
      required_locks: JSON.parse(String(row.required_locks_json)) as AffectedLock[],
      installed_assets: JSON.parse(String(row.installed_assets_json)) as Array<{ token: string; sha256: string }>,
      film_temp_token: String(row.film_temp_token),
      publish_intent_created_at: String(row.publish_intent_created_at),
    };
  }

  /**
   * The committed history of a project, oldest first.
   *
   * The migration's own commit is the first entry, because that is where the project's
   * content came from; every controlled write after it adds one. Nothing is ever removed:
   * an old snapshot stays in the history even after a restore has replaced its content,
   * because "the old revision is still traceable" is one of the things a restore promises.
   */
  history(projectId: string): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    for (const migration of this.#revisions.migrations.all()) {
      if (migration.target_project_id !== projectId) continue;
      if (migration.target_snapshot_id === null) continue;
      if (!["reported", "activated", "committed"].includes(migration.state)) continue;
      entries.push({ revision: 1, snapshot_id: migration.target_snapshot_id, kind: "migration",
        transaction_id: migration.migration_id });
    }
    for (const transaction of this.#revisions.projectTransactions(projectId)) {
      if (transaction.state !== "committed") continue;
      if (transaction.kind !== "edit" && transaction.kind !== "history") continue;
      if (transaction.snapshot_id === "") continue;
      entries.push({
        revision: transaction.base_revision + 1,
        snapshot_id: transaction.snapshot_id,
        kind: transaction.kind === "history" ? "restore" : "adoption",
        transaction_id: transaction.transaction_id,
      });
    }
    entries.sort((left, right) => left.revision - right.revision
      || (left.transaction_id < right.transaction_id ? -1 : left.transaction_id > right.transaction_id ? 1 : 0));
    return entries;
  }

  /**
   * The snapshot an undo would name: the nearest committed snapshot below the current
   * revision.
   *
   * "Strictly below" is the whole rule. An undo that could name the current snapshot would
   * be a no-op that still advanced the revision, and an undo that could name a *newer*
   * snapshot would be a forward move wearing undo's name.
   */
  undoTarget(projectId: string, currentRevision: number): HistoryEntry | undefined {
    let best: HistoryEntry | undefined;
    for (const entry of this.history(projectId)) {
      if (entry.revision >= currentRevision) continue;
      if (best === undefined || entry.revision > best.revision) best = entry;
    }
    return best;
  }

  /**
   * The snapshot a redo would name.
   *
   * Derived from the most recent committed *restore* and nothing else: the snapshot that
   * was active before that restore is exactly what a redo returns to. There is no redo
   * stack — a stack would be a second timeline, and this architecture has one.
   */
  redoTarget(projectId: string): HistoryEntry | undefined {
    let latest: { revision: number; transaction_id: string } | undefined;
    for (const transaction of this.#revisions.projectTransactions(projectId)) {
      if (transaction.state !== "committed" || transaction.kind !== "history") continue;
      if (latest !== undefined && transaction.base_revision <= latest.revision) continue;
      latest = { revision: transaction.base_revision, transaction_id: transaction.transaction_id };
    }
    if (latest === undefined) return undefined;
    const fact = this.restoreFact(latest.transaction_id);
    if (fact === undefined) return undefined;
    return { revision: latest.revision + 1, snapshot_id: fact.source_before_snapshot_id,
      kind: "restore", transaction_id: latest.transaction_id };
  }

  /** The canonical bytes of a fact, for evidence. */
  static canonicalFact(fact: HistoryRestoreFact): string {
    return canonicalJson({
      transaction_id: fact.transaction_id, project_id: fact.project_id,
      target_snapshot_id: fact.target_snapshot_id, result_snapshot_id: fact.result_snapshot_id,
      source_before_snapshot_id: fact.source_before_snapshot_id,
      source_before_sha256: fact.source_before_sha256, source_after_sha256: fact.source_after_sha256,
      staged_source_digest: fact.staged_source_digest, restore_plan_sha256: fact.restore_plan_sha256,
      impact_id: fact.impact_id, impact_hash: fact.impact_hash, rights_digest: fact.rights_digest,
      required_locks: fact.required_locks, installed_assets: fact.installed_assets,
      film_temp_token: fact.film_temp_token, publish_intent_created_at: fact.publish_intent_created_at,
    });
  }
}
