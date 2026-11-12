import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { lstatSync, realpathSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import type { RevisionStore } from '../projects/revision-store.js';
import type { SnapshotStore } from '../projects/snapshot-store.js';
import { canonicalDigest, canonicalJson } from '../creative/digest.js';
import { ProductError } from '../creative/trusted-context.js';
import { computeSourceDigest } from '../engine/source-digest-v1.js';
import { OPENFILM_UPSTREAM_SHA } from '../engine/engine-binding-store.js';
import { validateCreatedSourceFact, type CreatedSourceFact } from '../projects/project-creation-store.js';
import { CreatedSourceAdoptionStore } from './created-source-adoption-store.js';
import { CreatedPublicationIdentityStore, type PublicationIdentityFact } from './created-publication-identity-store.js';
import { CREATED_PUBLICATION_JOURNAL_DDL } from './created-source-publisher.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import { isCreatedSourceApplyTransaction, assertPreparedAdoptionPlan, preparedAdoptionPlanDigest } from './created-source-ports.js';
import { RetainedSourceTree } from './retained-source-tree.js';
import { PublicationCleanup, PublicationCleanupError } from './publication-cleanup.js';

export type RecoveryFileLayout = 'original' | 'rename_gap' | 'published' | 'rollback_gap' | 'restored';
/** Host-only resource lease; serializing this object does not preserve its authority. */
export interface CreatedRecoveryFilesLease { readonly transaction_id: string; }
interface Paths { author: string; backup: string; staging: string; quarantine: string; workspace: string; snapshot: string; container: string; }
interface Record {
  transaction: string; project: string; identity: PublicationIdentityFact; paths: Paths;
  original: RetainedSourceTree; target: RetainedSourceTree | undefined; snapshot: RetainedSourceTree;
  owner: RetainedSourceTree; workspace: RetainedSourceTree; durable: boolean;
}
interface Options {
  revisions: RevisionStore; snapshots: SnapshotStore; createdRoot: string; privateRoot: string;
  /** MAIN supplies the original ProjectCreationStore reservation identity, not request JSON. */
  creationIdentity: (project: string) => { readonly command_id: string; readonly transaction_id: string } | null;
  /** Internal fault seam; omitted in production. Exception tests are not SIGKILL evidence. */
  boundary?: (phase: 'after_target_quarantined' | 'after_original_restored' | 'after_fsync') => Promise<void>;
}
const conflict = (message: string): never => { throw new ProductError('REVISION_CONFLICT', message); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (left: unknown, right: unknown) => canonicalDigest(left) === canonicalDigest(right);
const overlaps = (a: string, b: string) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);

interface PublishedRecoveryLocations {
  readonly transaction_id: string; readonly project_id: string;
  readonly author_root: string; readonly backup_root: string; readonly staging_root: string;
  readonly snapshot_source: string;
}
// Constructor-only registration. Neither instanceof nor public method dispatch is authority.
const publishedRecoveryIssuers = new WeakMap<object, Readonly<{
  owner: RevisionStore;
  read: (lease: CreatedRecoveryFilesLease) => PublishedRecoveryLocations;
  sync: (lease: CreatedRecoveryFilesLease) => void;
}>>();
function publishedRecoveryIssuer(issuer: object, owner: RevisionStore) {
  const binding = publishedRecoveryIssuers.get(issuer);
  if (!binding || binding.owner !== owner) return conflict('Recovery file issuer differs');
  return binding;
}
/** Host-only bridge to the constructor's private lease/identity checks. */
export function readPublishedRecoveryLocations(issuer: object, lease: CreatedRecoveryFilesLease, owner: RevisionStore): PublishedRecoveryLocations {
  return publishedRecoveryIssuer(issuer, owner).read(lease);
}
export function syncPublishedRecoveryFiles(issuer: object, lease: CreatedRecoveryFilesLease, owner: RevisionStore): void {
  publishedRecoveryIssuer(issuer, owner).sync(lease);
}

/** Files only: never grants Approval/publication proof, commits, clears attention, or edits a pointer.
 * Actual startup ownership and the original project queue remain the caller's obligations. */
export class CreatedPublicationRecoveryFiles {
  readonly #identities: CreatedPublicationIdentityStore;
  readonly #adoptions: CreatedSourceAdoptionStore;
  readonly #records = new Map<object, Record>();
  readonly #known = new WeakSet<object>();
  readonly #busy = new Set<string>();
  readonly #moving = new WeakSet<object>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #cleanup = new PublicationCleanup();
  readonly #faults = new Set<unknown>();
  #closed = false;
  #closing: Promise<void> | undefined;
  readonly #options: Readonly<Options>;
  constructor(options: Options) {
    this.#options = Object.freeze({ ...options });
    this.#identities = new CreatedPublicationIdentityStore(options.revisions);
    this.#adoptions = new CreatedSourceAdoptionStore(options.revisions);
    publishedRecoveryIssuers.set(this, Object.freeze({
      owner: options.revisions,
      read: (lease: CreatedRecoveryFilesLease) => this.#publishedLocations(lease, this.#options.revisions),
      sync: (lease: CreatedRecoveryFilesLease) => this.#syncPublished(lease, this.#options.revisions),
    }));
  }
  #open(): void {
    if (this.#closed) conflict('Recovery file reader is closed');
    if (this.#faults.size) throw new PublicationCleanupError([...this.#faults]);
  }
  #admit<T>(work: () => Promise<T>): Promise<T> {
    this.#open(); const task = Promise.resolve().then(work); this.#pending.add(task);
    void task.then(() => this.#pending.delete(task), () => this.#pending.delete(task)); return task;
  }
  #scope(transactionId: string) {
    this.#open(); const { revisions } = this.#options;
    const row = revisions.projectTransaction(transactionId), identity = this.#identities.read(transactionId);
    const fact = this.#adoptions.adoptionFact(transactionId);
    if (!row || !isCreatedSourceApplyTransaction(row) || row.state !== 'prepared' || !identity || !fact
      || identity.project_id !== row.project_id || fact.project_id !== row.project_id
      || identity.original_source_digest !== fact.original_source_digest || identity.target_source_digest !== fact.target_source_digest
      || identity.target_snapshot_id !== fact.expected_snapshot_id || fact.plan_sha256 !== fact.facts_digest) {
      return conflict('The prepared recovery transaction has no matching immutable facts');
    }
    const active = revisions.activeCommit(row.project_id);
    if (!active || active.revision !== row.base_revision || active.source_digest !== identity.original_source_digest) {
      return conflict('Recovery cannot move files after its committed base changed');
    }
    const base = revisions.snapshotRow(active.snapshot_id);
    if (!base || base.project_id !== row.project_id || base.source_digest !== active.source_digest
      || base.engine !== 'openfilm' || !revisions.snapshotIsCommitted(row.project_id, active.snapshot_id)) {
      return conflict('The recovery base is not a committed snapshot');
    }
    const project = row.project_id;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(project)) return conflict('Invalid recovery project');
    const roots = [resolve(this.#options.createdRoot), resolve(this.#options.privateRoot), resolve(this.#options.snapshots.projectRoot(''))];
    if (roots.some((root, i) => roots.some((other, j) => i !== j && overlaps(root, other)))) {
      return conflict('Recovery roots overlap');
    }
    const db = revisions.compose(value => value);
    if (!matchesFrozenSchemaNamespace(db, CREATED_PUBLICATION_JOURNAL_DDL, 'created_publication_journal')) {
      return conflict('Publication journal schema differs');
    }
    const journals = db.prepare('SELECT * FROM created_publication_journal WHERE transaction_id=?').all(transactionId);
    const prepared = journals.find(j => j.phase === 'prepared');
    if (!prepared || journals.length > 2 || journals.some(j => !['prepared', 'published'].includes(String(j.phase)))) {
      return conflict('Publication recovery has no original prepared journal');
    }
    const workspace = dirname(String(prepared.staging_root)), publicationRoot = resolve(roots[1]!, project);
    const paths: Paths = { workspace, author: resolve(roots[0]!, project, 'source'), backup: resolve(workspace, 'backup'),
      staging: resolve(workspace, 'staging'), quarantine: resolve(workspace, 'rollback-target'),
      container: this.#options.snapshots.snapshotRoot(project, identity.target_snapshot_id),
      snapshot: resolve(this.#options.snapshots.snapshotRoot(project, identity.target_snapshot_id), 'source') };
    if (dirname(workspace) !== publicationRoot || !/^publication-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(basename(workspace))) {
      return conflict('Publication workspace is not Host-derived');
    }
    const files = (tree: PublicationIdentityFact['original_tree']) => tree.files.map(f => ({ relative_path: f.relative_path, bytes: f.bytes, sha256: f.sha256 }));
    if (!same(files(identity.original_tree), fact.original_closure) || !same(files(identity.target_tree), fact.target_closure)) {
      return conflict('Publication identity does not match its complete source closures');
    }
    for (const journal of journals) {
      if (journal.journal_id !== `${transactionId}:${String(journal.phase)}` || journal.project_id !== project
        || journal.prepared_source_id !== fact.prepared_source_id || journal.author_root !== paths.author
        || journal.backup_root !== paths.backup || journal.staging_root !== paths.staging
        || journal.target_snapshot_id !== identity.target_snapshot_id || journal.original_source_digest !== identity.original_source_digest
        || journal.published_source_digest !== identity.target_source_digest || !same(JSON.parse(String(journal.files_json)), fact.target_closure)) {
        return conflict('Journal paths or facts do not match this publication');
      }
    }
    const sourceRow = db.prepare('SELECT fact_json,fact_sha256 FROM created_source_fact WHERE project_id=? AND snapshot_id=?').get(project, active.snapshot_id);
    if (!sourceRow) return conflict('The original source geometry is missing');
    const geometry = validateCreatedSourceFact(JSON.parse(String(sourceRow.fact_json)) as CreatedSourceFact);
    if (canonicalDigest(geometry) !== sourceRow.fact_sha256) return conflict('The original source geometry changed');
    const planRow = db.prepare('SELECT plan_json,plan_sha256 FROM created_impact_fact WHERE impact_id=?').get(fact.impact_id);
    if (!planRow) return conflict('The original target plan is missing');
    const plan = assertPreparedAdoptionPlan(JSON.parse(String(planRow.plan_json)));
    if (preparedAdoptionPlanDigest(plan) !== fact.plan_sha256 || planRow.plan_sha256 !== fact.plan_sha256
      || plan.project_id !== project || plan.base_source_digest !== identity.original_source_digest
      || plan.target_source_digest !== identity.target_source_digest || plan.target_snapshot_id !== identity.target_snapshot_id
      || !plan.roots.includes('film.html') || !same(plan.files, fact.target_closure)) return conflict('The target plan changed');
    return { row, identity, fact, geometry, plan, paths };
  }
  #layout(record: Pick<Record, 'identity' | 'paths'>): RecoveryFileLayout {
    const { identity, paths } = record; const found = new Map<string, 'original' | 'target'>();
    for (const name of ['author', 'backup', 'staging', 'quarantine'] as const) {
      const path = paths[name]; let info;
      try { info = lstatSync(path, { bigint: true }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error;
      }
      if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path) conflict('A publication location is not canonical');
      const match = (tree: PublicationIdentityFact['original_tree']) => tree.directories[0]!.dev === String(info.dev) && tree.directories[0]!.ino === String(info.ino);
      if (match(identity.original_tree)) found.set(name, 'original');
      else if (match(identity.target_tree)) found.set(name, 'target');
      else conflict('A publication directory has an unknown identity');
    }
    const entries = readdirSync(paths.workspace);
    if (entries.some(name => !['backup', 'staging', 'rollback-target'].includes(name))) conflict('Unknown publication workspace entries');
    const shape = [...found].map(([name, role]) => `${name}:${role}`).join('|');
    if (shape === 'author:original|staging:target' || shape === 'author:original') return 'original';
    if (shape === 'backup:original|staging:target') return 'rename_gap';
    if (shape === 'author:target|backup:original') return 'published';
    if (shape === 'backup:original|quarantine:target') return 'rollback_gap';
    if (shape === 'author:original|quarantine:target') return 'restored';
    return conflict('Publication locations conflict or are incomplete');
  }
  inspect(transactionId: string): Promise<CreatedRecoveryFilesLease> {
    return this.#admit(async () => {
      if (this.#busy.has(transactionId)) conflict('This recovery transaction already has a resource lease');
      this.#busy.add(transactionId); const guards: RetainedSourceTree[] = [], owner = {}; let transferred = false, failed = false; let primary: unknown;
      try {
        const scope = this.#scope(transactionId), { identity, paths } = scope;
        const creation = this.#options.creationIdentity(scope.row.project_id);
        if (!creation) conflict('No original creation identity owns this project');
        const expectedOwner = canonicalJson({ kind: 'narralens.created-root@1', project_id: scope.row.project_id,
          command_id: creation!.command_id, transaction_id: creation!.transaction_id });
        const hold = (path: string, files: PublicationIdentityFact['original_tree']['files'] | { relative_path: string; bytes: number; sha256: string }[], whole = true) => {
          const guard = new RetainedSourceTree(path, files, whole); guards.push(guard); return guard;
        };
        const projectOwner = hold(dirname(paths.author), [{ relative_path: 'owner.json', bytes: Buffer.byteLength(expectedOwner), sha256: hash(expectedOwner) }], false);
        const workspace = hold(paths.workspace, [], false);
        const layout = await this.#layout({ identity, paths });
        const original = hold(layout === 'original' || layout === 'restored' ? paths.author : paths.backup, identity.original_tree.files);
        const target = layout === 'published' ? hold(paths.author, identity.target_tree.files)
          : layout === 'rollback_gap' || layout === 'restored' ? hold(paths.quarantine, identity.target_tree.files)
            : (await lstat(paths.staging).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }))
              ? hold(paths.staging, identity.target_tree.files) : undefined;
        const snapshot = hold(paths.snapshot, identity.snapshot_tree.files);
        const record: Record = { transaction: transactionId, project: scope.row.project_id, identity, paths, original,
          target, snapshot, owner: projectOwner, workspace, durable: false };
        this.#verify(record);
        for (const [root, roots, digest] of [[original.root, scope.geometry.roots, identity.original_source_digest],
          [snapshot.root, ['film.html', ...scope.plan.roots.filter(root => root !== 'film.html')], identity.target_source_digest]] as const) {
          const observed = await computeSourceDigest({ root, roots, engine: 'openfilm', engineUpstreamSha: OPENFILM_UPSTREAM_SHA });
          if (observed.external_reference_count || observed.source_digest !== digest) conflict('Recovery cannot prove the full committed source digest');
        }
        this.#verify(record); await this.#layout(record); this.#open();
        const lease = Object.freeze({ transaction_id: transactionId }); this.#records.set(lease, record); this.#known.add(lease);
        transferred = true; return lease;
      } catch (error) { failed = true; primary = error; if (error instanceof PublicationCleanupError) this.#faults.add(error); throw error; } finally {
        if (!transferred) { this.#busy.delete(transactionId); this.#cleanup.register(owner, guards.map(guard => ({ identity: guard, close: () => guard.close() })));
          try { this.#cleanup.run(owner); } catch (error) { this.#faults.add(error); throw new PublicationCleanupError([...(failed ? [primary] : []), error]); } }
      }
    });
  }
  #record(lease: CreatedRecoveryFilesLease): Record { this.#open(); const value = this.#records.get(lease); if (!value) return conflict('Recovery file lease is not live'); return value; }
  #verify(record: Record): void {
    const scope = this.#scope(record.transaction);
    if (!same(scope.identity, record.identity) || !same(scope.paths, record.paths)) conflict('Recovery facts moved');
    for (const guard of [record.original, record.target, record.snapshot, record.owner, record.workspace]) guard?.verify();
    if (!same(record.original.identity(), record.identity.original_tree) || record.target && !same(record.target.identity(), record.identity.target_tree)
      || !same(record.snapshot.identity(), record.identity.snapshot_tree)
      || !same(record.snapshot.directoryIdentity(record.paths.container), record.identity.snapshot_container)) conflict('Recovery retained identities differ');
    const device = record.original.identity().directories[0]!.dev;
    if ([record.owner, record.workspace, record.snapshot].some(guard => guard.directoryIdentity(guard.root).dev !== device)) conflict('Recovery requires one atomic-rename filesystem');
  }
  async layout(lease: CreatedRecoveryFilesLease): Promise<RecoveryFileLayout> {
    return this.#admit(async () => { const record = this.#record(lease); this.#verify(record); const value = await this.#layout(record); this.#verify(record); return value; });
  }
  /** Only the actual current published resources, on their original database.
   * These Host-only paths are data; they do not replace the Publisher's own checks.
   */
  #publishedLocations(lease: CreatedRecoveryFilesLease, owner: RevisionStore) {
    const record = this.#record(lease);
    if (owner !== this.#options.revisions || this.#moving.has(lease)) conflict('Published recovery lease owner differs or is moving');
    this.#verify(record);
    if (this.#layout(record) !== 'published') conflict('Recovery target is not currently published');
    return Object.freeze({ transaction_id: record.transaction, project_id: record.project,
      author_root: record.paths.author, backup_root: record.paths.backup, staging_root: record.paths.staging,
      snapshot_source: record.paths.snapshot });
  }
  /** Repeat both actual parent durability barriers before a recovered publication proof. */
  #syncPublished(lease: CreatedRecoveryFilesLease, owner: RevisionStore): void {
    this.#publishedLocations(lease, owner); const record = this.#record(lease);
    record.owner.syncDirectory(); record.workspace.syncDirectory(); this.#publishedLocations(lease, owner);
  }
  restoreOriginal(lease: CreatedRecoveryFilesLease): Promise<void> {
    return this.#admit(async () => {
      if (this.#moving.has(lease)) conflict('Compensation is already in flight for this lease');
      this.#moving.add(lease);
      try {
      const record = this.#record(lease); this.#verify(record); const layout = this.#layout(record); this.#verify(record);
      record.durable = false;
      if (layout === 'published') {
        record.target!.moveTo(record.paths.quarantine, record.workspace);
        await this.#options.boundary?.('after_target_quarantined'); this.#verify(record);
        record.owner.syncDirectory(); record.workspace.syncDirectory(); this.#verify(record);
      }
      if (layout === 'published' || layout === 'rename_gap' || layout === 'rollback_gap') {
        record.original.moveTo(record.paths.author, record.owner);
        await this.#options.boundary?.('after_original_restored'); this.#verify(record);
        record.owner.syncDirectory(); record.workspace.syncDirectory(); this.#verify(record);
      }
      record.owner.syncDirectory(); record.workspace.syncDirectory();
      await this.#options.boundary?.('after_fsync'); this.#verify(record);
      if (!['original', 'restored'].includes(await this.#layout(record))) conflict('Recovery did not restore the complete original source');
      this.#verify(record); record.durable = true;
      } finally { this.#moving.delete(lease); }
    });
  }
  /** Synchronous final resource check before the caller's original abort; no business write here. */
  assertOriginalRestored(lease: CreatedRecoveryFilesLease): void {
    const record = this.#record(lease); this.#verify(record);
    if (!record.durable || record.original.root !== record.paths.author || !['original', 'restored'].includes(this.#layout(record))) conflict('The original source has no completed durability barrier');
  }
  release(lease: CreatedRecoveryFilesLease): void {
    if (!this.#known.has(lease)) conflict('Recovery lease was not issued here');
    const record = this.#records.get(lease); if (!record) return;
    this.#records.delete(lease); this.#busy.delete(record.transaction);
    this.#cleanup.register(lease, [record.original, record.target, record.snapshot, record.owner, record.workspace].filter((g): g is RetainedSourceTree => !!g)
      .map(guard => ({ identity: guard, close: () => guard.close() })));
    try { this.#cleanup.run(lease); } catch (error) { this.#faults.add(error); throw error; }
  }
  close(): Promise<void> {
    this.#closed = true;
    return this.#closing ??= (async () => {
      await Promise.allSettled([...this.#pending]); const failures: unknown[] = [...this.#faults];
      for (const lease of [...this.#records.keys()]) try { this.release(lease as CreatedRecoveryFilesLease); } catch (error) { failures.push(error); }
      try { this.#cleanup.drain(); } catch (error) { failures.push(error); }
      if (failures.length) throw new PublicationCleanupError(failures);
    })();
  }
}
