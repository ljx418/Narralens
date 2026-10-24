import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../engine/source-digest-v1.js";
import type { RevisionStore } from "../projects/revision-store.js";

export interface InstalledAdoptionAsset {
  readonly token: string;
  readonly sha256: string;
}

export interface AdoptionTransactionFact {
  readonly transaction_id: string;
  readonly source_before_sha256: string;
  readonly source_after_sha256: string;
  readonly staged_source_digest: string;
  readonly snapshot_id: string;
  readonly installed_assets: readonly InstalledAdoptionAsset[];
  readonly film_temp_token: string;
  readonly publish_intent_created_at: string;
}

export interface OpenFilmProjectionFact {
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly migration_id: string;
  readonly source_digest: string;
  readonly engine_upstream_sha: string;
  readonly roots: readonly string[];
  readonly subtitles: readonly { subtitle_id: string; path: string }[];
  readonly frame_count: number;
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

/**
 * Durable facts needed to prove or recover a controlled adoption.
 *
 * Neither table has a state column. `project_transaction` is the sole state machine; these
 * rows are immutable evidence selected by its transaction/snapshot pointers.
 */
/**
 * Validate a projection fact before it is written.
 *
 * Exported so the *production* writer validates too. The insert inside
 * `RevisionStore.commitAdoption` used to be an inline copy of this statement, which made
 * the validated path dead code: the checks existed, and nothing ran them.
 */
export function assertProjectionFact(fact: OpenFilmProjectionFact): void {
  assertSha(fact.source_digest, "source_digest");
  if (!Number.isSafeInteger(fact.frame_count) || fact.frame_count <= 0) throw new Error("INVALID_FRAME_COUNT");
  const roots = [...fact.roots];
  for (const root of roots) assertToken(root, "projection_root");
  if (new Set(roots).size !== roots.length) throw new Error("DUPLICATE_PROJECTION_ROOT");
  const subtitles = [...fact.subtitles];
  for (const subtitle of subtitles) assertToken(subtitle.path, "subtitle_path");
}

/**
 * The one insert for `openfilm_projection_fact`.
 *
 * It lives here so there is a single writer: the production path calls it from inside
 * `RevisionStore.commitAdoption`'s open transaction, and the validation runs first, so the
 * checks cannot be bypassed by a second copy of the statement.
 */
export function insertProjectionFact(db: DatabaseSync, fact: OpenFilmProjectionFact): void {
  assertProjectionFact(fact);
  db.prepare(`INSERT INTO openfilm_projection_fact(
    project_id, snapshot_id, migration_id, source_digest, engine_upstream_sha,
    roots_json, subtitles_json, frame_count, transaction_id) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(fact.project_id, fact.snapshot_id, fact.migration_id, fact.source_digest,
      fact.engine_upstream_sha, canonicalJson([...fact.roots]), canonicalJson([...fact.subtitles]),
      fact.frame_count, fact.transaction_id);
}

export class AdoptionStore {
  readonly #db: DatabaseSync;
  readonly #revisions: RevisionStore;

  constructor(revisions: RevisionStore) {
    this.#revisions = revisions;
    this.#db = revisions.compose((db) => db);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS adoption_transaction_fact (
        transaction_id TEXT PRIMARY KEY REFERENCES project_transaction(transaction_id),
        source_before_sha256 TEXT NOT NULL,
        source_after_sha256 TEXT NOT NULL,
        staged_source_digest TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        installed_assets_json TEXT NOT NULL,
        film_temp_token TEXT NOT NULL,
        publish_intent_created_at TEXT NOT NULL,
        CHECK (source_before_sha256 <> source_after_sha256)
      );
      CREATE TABLE IF NOT EXISTS openfilm_projection_fact (
        project_id TEXT NOT NULL,
        snapshot_id TEXT PRIMARY KEY,
        migration_id TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        engine_upstream_sha TEXT NOT NULL,
        roots_json TEXT NOT NULL,
        subtitles_json TEXT NOT NULL,
        frame_count INTEGER NOT NULL CHECK(frame_count > 0),
        transaction_id TEXT NOT NULL REFERENCES project_transaction(transaction_id)
      );
      CREATE TRIGGER IF NOT EXISTS adoption_transaction_fact_immutable_update
        BEFORE UPDATE ON adoption_transaction_fact BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_ADOPTION_FACT'); END;
      CREATE TRIGGER IF NOT EXISTS adoption_transaction_fact_immutable_delete
        BEFORE DELETE ON adoption_transaction_fact BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_ADOPTION_FACT'); END;
      CREATE TRIGGER IF NOT EXISTS openfilm_projection_fact_immutable_update
        BEFORE UPDATE ON openfilm_projection_fact BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_PROJECTION_FACT'); END;
      CREATE TRIGGER IF NOT EXISTS openfilm_projection_fact_immutable_delete
        BEFORE DELETE ON openfilm_projection_fact BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_PROJECTION_FACT'); END;
    `);
  }

  /** Atomically records the immutable publish proof and advances validated -> prepared. */
  prepare(fact: AdoptionTransactionFact, now = new Date()): void {
    assertSha(fact.source_before_sha256, "source_before_sha256");
    assertSha(fact.source_after_sha256, "source_after_sha256");
    assertSha(fact.staged_source_digest, "staged_source_digest");
    assertToken(fact.film_temp_token, "film_temp_token");
    const assets = [...fact.installed_assets]
      .map((asset) => {
        assertToken(asset.token, "asset_token");
        assertSha(asset.sha256, "asset_sha256");
        return { token: asset.token, sha256: asset.sha256 };
      })
      .sort((left, right) => left.token.localeCompare(right.token));
    if (new Set(assets.map((asset) => asset.token)).size !== assets.length) {
      throw new Error("DUPLICATE_INSTALLED_ASSET_TOKEN");
    }
    this.#revisions.atomic(() => {
      this.#db.prepare(`INSERT INTO adoption_transaction_fact(
        transaction_id, source_before_sha256, source_after_sha256, staged_source_digest,
        snapshot_id, installed_assets_json, film_temp_token, publish_intent_created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        fact.transaction_id, fact.source_before_sha256, fact.source_after_sha256,
        fact.staged_source_digest, fact.snapshot_id, canonicalJson(assets),
        fact.film_temp_token, fact.publish_intent_created_at,
      );
      this.#revisions.transition(fact.transaction_id, "validated", "prepared", {
        snapshot_id: fact.snapshot_id,
        source_digest_after: fact.staged_source_digest,
      }, now);
    });
  }

  adoptionFact(transactionId: string): AdoptionTransactionFact | undefined {
    const row = this.#db.prepare("SELECT * FROM adoption_transaction_fact WHERE transaction_id=?")
      .get(transactionId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      transaction_id: String(row.transaction_id),
      source_before_sha256: String(row.source_before_sha256),
      source_after_sha256: String(row.source_after_sha256),
      staged_source_digest: String(row.staged_source_digest),
      snapshot_id: String(row.snapshot_id),
      installed_assets: JSON.parse(String(row.installed_assets_json)) as InstalledAdoptionAsset[],
      film_temp_token: String(row.film_temp_token),
      publish_intent_created_at: String(row.publish_intent_created_at),
    };
  }

  projectionFact(snapshotId: string): OpenFilmProjectionFact | undefined {
    const row = this.#db.prepare("SELECT * FROM openfilm_projection_fact WHERE snapshot_id=?")
      .get(snapshotId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      project_id: String(row.project_id), snapshot_id: String(row.snapshot_id),
      migration_id: String(row.migration_id), source_digest: String(row.source_digest),
      engine_upstream_sha: String(row.engine_upstream_sha),
      roots: JSON.parse(String(row.roots_json)) as string[],
      subtitles: JSON.parse(String(row.subtitles_json)) as Array<{ subtitle_id: string; path: string }>,
      frame_count: Number(row.frame_count), transaction_id: String(row.transaction_id),
    };
  }
}
