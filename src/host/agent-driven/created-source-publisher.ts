import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import { assertSafeRelativePath } from '../render/snapshot-copy.js';
import type { CreatedSourcePublicationFacts, CreatedSourcePublicationProof, PreparedSourceFileFact } from './created-source-ports.js';

/**
 * The publication journal of the created source.
 *
 * It is append-only: one row per phase of one publication, and never a state column
 * that a second writer could move. The recovery reads the last phase and decides
 * whether the publication has to be completed or the original closure restored.
 */
export const CREATED_PUBLICATION_JOURNAL_DDL = `
CREATE TABLE created_publication_journal (
  journal_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  prepared_source_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('prepared','published')),
  original_source_digest TEXT NOT NULL,
  published_source_digest TEXT NOT NULL,
  target_snapshot_id TEXT NOT NULL,
  author_root TEXT NOT NULL,
  backup_root TEXT NOT NULL,
  staging_root TEXT NOT NULL,
  files_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER created_publication_journal_no_update BEFORE UPDATE ON created_publication_journal BEGIN SELECT RAISE(ABORT,'immutable publication journal'); END;
CREATE TRIGGER created_publication_journal_no_delete BEFORE DELETE ON created_publication_journal BEGIN SELECT RAISE(ABORT,'immutable publication journal'); END;
`;

/** The phase a publication reached. */
export type PublicationPhase = 'prepared' | 'published';

/** One row of the publication journal. */
export interface PublicationJournalRow {
  readonly journal_id: string;
  readonly project_id: string;
  readonly transaction_id: string;
  readonly prepared_source_id: string;
  readonly phase: PublicationPhase;
  readonly original_source_digest: string;
  readonly published_source_digest: string;
  readonly target_snapshot_id: string;
  readonly author_root: string;
  readonly backup_root: string;
  readonly staging_root: string;
  readonly files: readonly PreparedSourceFileFact[];
  readonly created_at: string;
}

/** The failure of the created source publisher. */
export class CreatedSourcePublishError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'NOT_FOUND',
    message: string) {
    super(message);
    this.name = 'CreatedSourcePublishError';
  }
}

function fail(code: CreatedSourcePublishError['code'], message: string): never {
  throw new CreatedSourcePublishError(code, message);
}

/**
 * The digest of a source tree.
 *
 * It is the digest of the canonical list of the tree's files: the relative path, the
 * byte count and the SHA-256 of each, sorted by path. The digest of a tree is a
 * function of its membership and its bytes, so a file that was added, removed or
 * changed moves it.
 */
export function createdSourceTreeDigest(files: readonly PreparedSourceFileFact[]): string {
  const canonical = [...files]
    .map((file) => ({ relative_path: file.relative_path, bytes: file.bytes, sha256: file.sha256 }))
    .sort((left, right) => (left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0));
  return createHash('sha256').update(canonicalJson(canonical), 'utf8').digest('hex');
}

/* -------------------------------------------------------------------------------------- */
/* The opaque proof                                                                        */
/* -------------------------------------------------------------------------------------- */

class PublicationProof {
  constructor(readonly facts: CreatedSourcePublicationFacts, readonly issuer: CreatedSourcePublisher) {}
}

/**
 * The proofs this process issued.
 *
 * A module-private map, keyed by the proof object itself. A plain object with the
 * same fields is not in here, and neither is a JSON clone of a real proof: the check
 * is identity, never shape.
 */
const liveProofs = new WeakMap<object, PublicationProof>();

/**
 * The runtime check for a publication proof.
 *
 * It also refuses a proof whose publisher failed: a publication that did not finish
 * leaves no proof behind.
 */
export function isCreatedSourcePublicationProof(value: unknown): value is CreatedSourcePublicationProof {
  if (typeof value !== 'object' || value === null) return false;
  const proof = liveProofs.get(value);
  if (proof === undefined) return false;
  return proof.issuer.isUsable();
}

/** The facts a proof carries, for a caller that holds a real proof. */
export function createdSourcePublicationFacts(value: unknown): CreatedSourcePublicationFacts | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const proof = liveProofs.get(value);
  return proof === undefined ? undefined : proof.facts;
}

/* -------------------------------------------------------------------------------------- */
/* The publisher                                                                           */
/* -------------------------------------------------------------------------------------- */

/** The options of the publisher. */
export interface CreatedSourcePublisherOptions {
  readonly revisions: RevisionStore;
  /** The fixed author root of the created source of this project. */
  readonly authorRoot: string;
  /** The private root the publisher stages and backs up in. */
  readonly privateRoot: string;
  readonly now?: () => Date;
  /** The durability seam, so a test can observe the order without the real cost. */
  readonly fsync?: (path: string) => Promise<void>;
}

/** The input of one publication. */
export interface PublishCreatedSourceInput {
  readonly project_id: string;
  readonly transaction_id: string;
  readonly prepared_source_id: string;
  /** The Host-private stage that holds the prepared closure. */
  readonly stage_root: string;
  /** The complete expected tree of the published source. */
  readonly files: readonly PreparedSourceFileFact[];
  /** The digest of the author root before the publication. */
  readonly original_source_digest: string;
  /** The digest of the published tree. */
  readonly published_source_digest: string;
  /** The predicted snapshot id of the published source. */
  readonly target_snapshot_id: string;
}

/**
 * The publisher of a created source.
 *
 * It owns the author root of the created source, and with it the proof that the
 * publication really happened. The proof is issued here and nowhere else, so a proof
 * that exists is a proof that this publisher did the work.
 *
 * The order is the one D10 names: prove the live old author, stage a complete
 * isolated copy, fsync every file and every directory from the leaves up, record the
 * journal, move the old root into this transaction's private backup, rename the new
 * tree into the author root, fsync the parent, and record the published phase. A
 * failure at any point restores the original closure, and the publisher is marked
 * unusable so that no proof of a half-finished publication can be issued.
 */
export class CreatedSourcePublisher {
  readonly #db: DatabaseSync;
  readonly #authorRoot: string;
  readonly #privateRoot: string;
  readonly #now: () => Date;
  readonly #fsync: (path: string) => Promise<void>;
  readonly #instance: string;
  #failed = false;
  #closed = false;
  #schemaVersion = -1;

  constructor(options: CreatedSourcePublisherOptions) {
    this.#db = options.revisions.compose((db) => db);
    this.#authorRoot = resolve(options.authorRoot);
    this.#privateRoot = resolve(options.privateRoot);
    this.#now = options.now ?? (() => new Date());
    this.#fsync = options.fsync ?? (async (path: string): Promise<void> => {
      const handle = await open(path, constants.O_RDONLY);
      try { await handle.sync(); } finally { await handle.close(); }
    });
    this.#instance = `publisher_${randomUUID()}`;
    this.#schema();
  }

  /** The identity of this publisher instance. It is bound into every proof it issues. */
  get instance(): string { return this.#instance; }

  /** Whether this publisher may still issue and honour a proof. */
  isUsable(): boolean { return !this.#failed && !this.#closed; }

  #schema(): void {
    const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    if (version === this.#schemaVersion) return;
    const found = this.#db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'created_publication_journal' LIMIT 1").get();
    if (found === undefined) {
      this.#db.exec(CREATED_PUBLICATION_JOURNAL_DDL);
    } else if (!matchesFrozenSchemaNamespace(this.#db, CREATED_PUBLICATION_JOURNAL_DDL, 'created_publication_journal')) {
      fail('REVISION_CONFLICT', 'The publication journal schema differs from the one this build expects');
    }
    this.#schemaVersion = version;
  }

  /**
   * Publish the prepared closure into the author root.
   *
   * The returned proof is opaque and is recognised only by this publisher instance.
   */
  async publish(input: PublishCreatedSourceInput): Promise<CreatedSourcePublicationProof> {
    if (!this.isUsable()) fail('REVISION_CONFLICT', 'The publisher is not usable');
    const files = this.#ordered(input.files);
    if (files.length === 0) fail('INVALID_REQUEST', 'The publication has no files');
    const publishedDigest = createdSourceTreeDigest(files);
    if (publishedDigest !== input.published_source_digest) {
      fail('INVALID_REQUEST', 'The declared published digest is not the digest of the declared tree');
    }

    // The live old author has to be exactly what the plan was prepared against.
    const current = await this.#readTree(this.#authorRoot);
    const currentDigest = createdSourceTreeDigest(current);
    if (currentDigest !== input.original_source_digest) {
      fail('REVISION_CONFLICT', 'The live author root is not the source the plan was prepared against');
    }

    const workspace = resolve(this.#privateRoot, `${input.transaction_id}-${randomUUID()}`);
    const stagingRoot = resolve(workspace, 'staging');
    const backupRoot = resolve(workspace, 'backup');
    let moved = false;
    let published = false;
    try {
      await mkdir(stagingRoot, { recursive: true });
      await this.#copyClosure(input.stage_root, stagingRoot, files);

      // Prove every written file, then every directory from the leaves up.
      for (const file of files) await this.#fsync(join(stagingRoot, file.relative_path));
      for (const directory of this.#directoriesUnder(files)) await this.#fsync(join(stagingRoot, directory));
      await this.#fsync(stagingRoot);
      await this.#fsync(workspace);

      // The journal records the prepared phase before the old root is moved.
      this.#journal(input, 'prepared', stagingRoot, backupRoot, files);

      // The old root moves into this transaction's private backup, and the new tree
      // takes its place. The gap between the two renames is covered by the project's
      // pending recovery gate, and the journal says which phase was reached.
      await rename(this.#authorRoot, backupRoot);
      moved = true;
      await rename(stagingRoot, this.#authorRoot);
      published = true;
      await this.#fsync(dirname(this.#authorRoot));

      this.#journal(input, 'published', stagingRoot, backupRoot, files);
    } catch (error) {
      this.#failed = true;
      // The original closure goes back where it came from, so a failed publication
      // never leaves the project without its source.
      if (moved && !published) {
        await rm(this.#authorRoot, { recursive: true, force: true }).catch(() => undefined);
        await rename(backupRoot, this.#authorRoot).catch(() => undefined);
      }
      if (!published) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    const facts: CreatedSourcePublicationFacts = {
      publisher_instance: this.#instance,
      project_id: input.project_id,
      transaction_id: input.transaction_id,
      prepared_source_id: input.prepared_source_id,
      original_source_digest: input.original_source_digest,
      published_source_digest: input.published_source_digest,
      target_snapshot_id: input.target_snapshot_id,
      published_files: files,
      journal_id: `${input.transaction_id}:published`,
      backup_root: backupRoot,
      issued_at: this.#now().toISOString(),
    };
    const proof = new PublicationProof(facts, this);
    liveProofs.set(proof, proof);
    return proof;
  }

  /**
   * Verify a proof against the world.
   *
   * The proof is only half of the answer: the journal has to show the published
   * phase, the author root has to hold exactly the published tree, and the backup has
   * to still hold the original closure. A proof that is real but whose world moved is
   * refused.
   */
  async verify(proof: unknown, expectations: {
    readonly project_id: string;
    readonly transaction_id: string;
    readonly prepared_source_id: string;
    readonly target_snapshot_id: string;
    readonly original_source_digest: string;
    readonly published_source_digest: string;
  }): Promise<void> {
    if (!isCreatedSourcePublicationProof(proof)) fail('REVISION_CONFLICT', 'The publication proof is not a live proof');
    // The proof has to be one THIS publisher issued. A proof of another instance is a
    // proof of another publisher's world, and its author root is not this one.
    const issued = liveProofs.get(proof as object);
    if (issued === undefined || issued.issuer !== this) {
      fail('REVISION_CONFLICT', 'The publication proof was issued by another publisher');
    }
    const facts = (proof as CreatedSourcePublicationProof).facts;
    if (facts.project_id !== expectations.project_id ||
      facts.transaction_id !== expectations.transaction_id ||
      facts.prepared_source_id !== expectations.prepared_source_id ||
      facts.target_snapshot_id !== expectations.target_snapshot_id ||
      facts.original_source_digest !== expectations.original_source_digest ||
      facts.published_source_digest !== expectations.published_source_digest) {
      fail('REVISION_CONFLICT', 'The publication proof describes another publication');
    }
    const journal = this.journal(facts.journal_id);
    if (journal === undefined || journal.phase !== 'published') {
      fail('REVISION_CONFLICT', 'The publication was not recorded as published');
    }
    const author = await this.#readTree(this.#authorRoot);
    if (createdSourceTreeDigest(author) !== facts.published_source_digest) {
      fail('REVISION_CONFLICT', 'The author root is not the published tree');
    }
    const backup = await this.#readTree(facts.backup_root);
    if (createdSourceTreeDigest(backup) !== facts.original_source_digest) {
      fail('REVISION_CONFLICT', 'The backup is not the original closure');
    }
  }

  /** The journal row of one phase, or `undefined`. */
  journal(journalId: string): PublicationJournalRow | undefined {
    this.#schema();
    const row = this.#db.prepare('SELECT * FROM created_publication_journal WHERE journal_id=?').get(journalId) as
      Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      journal_id: String(row.journal_id),
      project_id: String(row.project_id),
      transaction_id: String(row.transaction_id),
      prepared_source_id: String(row.prepared_source_id),
      phase: String(row.phase) as PublicationPhase,
      original_source_digest: String(row.original_source_digest),
      published_source_digest: String(row.published_source_digest),
      target_snapshot_id: String(row.target_snapshot_id),
      author_root: String(row.author_root),
      backup_root: String(row.backup_root),
      staging_root: String(row.staging_root),
      files: JSON.parse(String(row.files_json)) as PreparedSourceFileFact[],
      created_at: String(row.created_at),
    };
  }

  /** The journal rows of one transaction, oldest first. */
  journalOf(transactionId: string): PublicationJournalRow[] {
    this.#schema();
    return (this.#db.prepare('SELECT * FROM created_publication_journal WHERE transaction_id=? ORDER BY created_at, journal_id')
      .all(transactionId) as Array<Record<string, unknown>>).map((row) => this.journal(String(row.journal_id))!);
  }

  /** Close the publisher. A closed publisher issues and honours nothing. */
  close(): void {
    this.#closed = true;
  }

  #journal(input: PublishCreatedSourceInput, phase: PublicationPhase, stagingRoot: string, backupRoot: string,
    files: readonly PreparedSourceFileFact[]): void {
    const journalId = `${input.transaction_id}:${phase}`;
    this.#db.prepare(`INSERT OR IGNORE INTO created_publication_journal(
      journal_id, project_id, transaction_id, prepared_source_id, phase, original_source_digest,
      published_source_digest, target_snapshot_id, author_root, backup_root, staging_root,
      files_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      journalId, input.project_id, input.transaction_id, input.prepared_source_id, phase,
      input.original_source_digest, input.published_source_digest, input.target_snapshot_id,
      this.#authorRoot, backupRoot, stagingRoot, canonicalJson(files), this.#now().toISOString());
  }

  #ordered(files: readonly PreparedSourceFileFact[]): PreparedSourceFileFact[] {
    const seen = new Set<string>();
    const out: PreparedSourceFileFact[] = [];
    for (const file of files) {
      if (typeof file.relative_path !== 'string' || file.relative_path.length === 0) {
        fail('INVALID_REQUEST', 'The publication has a malformed file');
      }
      try {
        if (assertSafeRelativePath(file.relative_path) !== file.relative_path) {
          fail('INVALID_REQUEST', 'The publication has an unsafe path');
        }
      } catch {
        fail('INVALID_REQUEST', 'The publication has an unsafe path');
      }
      if (seen.has(file.relative_path)) fail('INVALID_REQUEST', 'The publication names a file twice');
      seen.add(file.relative_path);
      out.push({ relative_path: file.relative_path, bytes: file.bytes, sha256: file.sha256 });
    }
    return out.sort((left, right) => (left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0));
  }

  /**
   * The real tree of a directory.
   *
   * Every entry is read and hashed. A symbolic link is refused: a link is a name that
   * points somewhere else, and the closure of a source is the bytes, not the names.
   */
  async #readTree(root: string): Promise<PreparedSourceFileFact[]> {
    const out: PreparedSourceFileFact[] = [];
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isSymbolicLink()) fail('INVALID_REQUEST', `SOURCE_SYMLINK:${full}`);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile()) fail('INVALID_REQUEST', `SOURCE_NOT_A_FILE:${full}`);
        const bytes = await readFile(full);
        out.push({
          relative_path: relative(root, full).split(sep).join('/'),
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    };
    await walk(root);
    return out.sort((left, right) => (left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0));
  }

  async #copyClosure(sourceRoot: string, stagingRoot: string, files: readonly PreparedSourceFileFact[]): Promise<void> {
    for (const file of files) {
      const from = resolve(sourceRoot, file.relative_path);
      const to = resolve(stagingRoot, file.relative_path);
      if (to !== stagingRoot && !to.startsWith(`${stagingRoot}${sep}`)) {
        fail('INVALID_REQUEST', `SOURCE_PATH_ESCAPE:${file.relative_path}`);
      }
      const info = await lstat(from).catch(() => undefined);
      if (info === undefined) fail('NOT_FOUND', `SOURCE_FILE_MISSING:${file.relative_path}`);
      if (info.isSymbolicLink()) fail('INVALID_REQUEST', `SOURCE_SYMLINK:${file.relative_path}`);
      if (!info.isFile()) fail('INVALID_REQUEST', `SOURCE_NOT_A_FILE:${file.relative_path}`);
      await mkdir(dirname(to), { recursive: true });
      const bytes = await readFile(from);
      const handle = await open(to, 'w');
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      const landed = createHash('sha256').update(bytes).digest('hex');
      if (landed !== file.sha256 || bytes.byteLength !== file.bytes) {
        fail('REVISION_CONFLICT', `SOURCE_CONTENT_MISMATCH:${file.relative_path}`);
      }
    }
  }

  #directoriesUnder(files: readonly PreparedSourceFileFact[]): string[] {
    const directories = new Set<string>();
    for (const file of files) {
      const parts = file.relative_path.split('/');
      parts.pop();
      let current = '';
      for (const part of parts) {
        current = current === '' ? part : `${current}/${part}`;
        directories.add(current);
      }
    }
    return [...directories].sort();
  }
}

/** Whether the author root of a project exists. */
export async function createdSourceAuthorRootExists(root: string): Promise<boolean> {
  return access(root).then(() => true, () => false);
}
