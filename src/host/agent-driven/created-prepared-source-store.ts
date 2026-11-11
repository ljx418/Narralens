import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalDigest, canonicalJson } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import type { ExecutionBinding } from '../../contracts/agent-driven-types.js';
import type { PreparedSourceFileFact, PreparedSourceMapping } from './created-source-ports.js';

/**
 * The D02 immutable mapping of a prepared source.
 *
 * The mapping says which prepared closure a `ps_` identifier stands for. It is written
 * once, it is never updated and it is never deleted: a mapping that could change would
 * make the identifier a name for two different facts.
 *
 * There is no state column here. The mapping does not know whether the package behind
 * it has been published; that is the review package's business, and the binding between
 * the two lives in its own table so a half-finished preparation never has a dangling
 * result reference.
 */
export const CREATED_PREPARED_SOURCE_DDL = `
CREATE TABLE created_prepared_source (
  prepared_source_id TEXT PRIMARY KEY,
  full_hash TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  fact_digest TEXT NOT NULL,
  execution_json TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  source_digest TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL,
  rights_digest TEXT NOT NULL,
  frame_count INTEGER NOT NULL,
  fps_numerator INTEGER NOT NULL,
  fps_denominator INTEGER NOT NULL,
  descriptor TEXT NOT NULL,
  stage_root TEXT NOT NULL,
  roots_json TEXT NOT NULL,
  files_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE created_prepared_source_package (
  prepared_source_id TEXT PRIMARY KEY REFERENCES created_prepared_source(prepared_source_id),
  package_id TEXT NOT NULL,
  package_version INTEGER NOT NULL,
  receipt_digest TEXT NOT NULL,
  bound_at TEXT NOT NULL
);
CREATE TRIGGER created_prepared_source_no_update BEFORE UPDATE ON created_prepared_source BEGIN SELECT RAISE(ABORT,'immutable prepared source mapping'); END;
CREATE TRIGGER created_prepared_source_no_delete BEFORE DELETE ON created_prepared_source BEGIN SELECT RAISE(ABORT,'immutable prepared source mapping'); END;
CREATE TRIGGER created_prepared_source_package_no_update BEFORE UPDATE ON created_prepared_source_package BEGIN SELECT RAISE(ABORT,'immutable prepared source package binding'); END;
CREATE TRIGGER created_prepared_source_package_no_delete BEFORE DELETE ON created_prepared_source_package BEGIN SELECT RAISE(ABORT,'immutable prepared source package binding'); END;
`;

/** The failure of the prepared source store. */
export class CreatedPreparedSourceError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND',
    message: string) {
    super(message);
    this.name = 'CreatedPreparedSourceError';
  }
}

function fail(code: CreatedPreparedSourceError['code'], message: string): never {
  throw new CreatedPreparedSourceError(code, message);
}

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The descriptor of a prepared source of this kind. */
export const CREATED_PREPARED_SOURCE_DESCRIPTOR = 'created-prepared-source@1';

/** The prefix of the identifier of a prepared source mapping. */
export const PREPARED_SOURCE_ID_PREFIX = 'ps_';

/** The number of hex characters of the full hash the identifier carries. */
export const PREPARED_SOURCE_ID_LENGTH = 60;

/** The input of one prepared source registration. */
export interface RegisterPreparedSourceInput {
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
  /** The Host-private stage the preparation produced. Never a client-visible path. */
  readonly stage_root: string;
  readonly roots: readonly string[];
  readonly files: readonly PreparedSourceFileFact[];
}

/** The binding of a prepared source to the review package that was published for it. */
export interface PreparedSourcePackageBinding {
  readonly prepared_source_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly receipt_digest: string;
  readonly bound_at: string;
}

/**
 * The identity of a prepared source mapping.
 *
 * It is derived from the canonical parts of the fact, so the same preparation always
 * names the same mapping and a different preparation never does. The full hash is kept
 * beside it: the identifier is the first sixty characters of that hash, and the rest is
 * what makes a prefix collision detectable instead of silent.
 */
export function preparedSourceIdentity(input: {
  readonly project_id: string;
  readonly job_id: string;
  readonly request_digest: string;
  readonly fact_digest: string;
}): { readonly prepared_source_id: string; readonly full_hash: string } {
  const fullHash = canonicalDigest({
    project_id: input.project_id,
    job_id: input.job_id,
    request_digest: input.request_digest,
    fact_digest: input.fact_digest,
  });
  return {
    prepared_source_id: `${PREPARED_SOURCE_ID_PREFIX}${fullHash.slice(0, PREPARED_SOURCE_ID_LENGTH)}`,
    full_hash: fullHash,
  };
}

/**
 * The store of the D02 immutable mapping.
 *
 * It lives on the original database: the mapping names the very job that produced the
 * closure, and a mapping in a second database would name a job the project cannot see.
 */
export class CreatedPreparedSourceStore {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;
  #schemaVersion = -1;

  constructor(revisions: RevisionStore, options: { readonly now?: () => Date } = {}) {
    this.#db = revisions.compose((db) => db);
    this.#now = options.now ?? (() => new Date());
    this.#schema();
  }

  #schema(): void {
    const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    if (version === this.#schemaVersion) return;
    const found = this.#db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'created_prepared_source*' LIMIT 1").get();
    if (found === undefined) {
      this.#db.exec(CREATED_PREPARED_SOURCE_DDL);
    } else if (!matchesFrozenSchemaNamespace(this.#db, CREATED_PREPARED_SOURCE_DDL, 'created_prepared_source')) {
      fail('REVISION_CONFLICT', 'The prepared source schema differs from the one this build expects');
    }
    this.#schemaVersion = version;
  }

  /**
   * Register a prepared source.
   *
   * The registration is idempotent: the same preparation registers the same mapping
   * and changes nothing. A different preparation under the same identifier is a
   * conflict, not an update.
   */
  register(input: RegisterPreparedSourceInput): PreparedSourceMapping {
    this.#assertInput(input);
    const identity = preparedSourceIdentity(input);
    const at = this.#now().toISOString();
    this.#schema();
    const existing = this.read(identity.prepared_source_id);
    if (existing !== undefined) {
      if (existing.full_hash !== identity.full_hash) {
        // The identifier is a prefix of the full hash, so this is a prefix collision.
        // It is refused rather than resolved, because there is no honest way to know
        // which of the two preparations the identifier was meant for.
        fail('IDEMPOTENCY_CONFLICT', 'Another preparation already holds this prepared source identifier');
      }
      if (canonicalJson(this.#facts(existing)) !== canonicalJson(this.#factsOf(input))) {
        fail('IDEMPOTENCY_CONFLICT', 'The registered prepared source differs from the same preparation');
      }
      return existing;
    }
    this.#db.prepare(`INSERT INTO created_prepared_source(
      prepared_source_id, full_hash, project_id, job_id, request_digest, fact_digest,
      execution_json, base_revision, source_digest, plan_sha256, rights_digest,
      frame_count, fps_numerator, fps_denominator, descriptor, stage_root,
      roots_json, files_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      identity.prepared_source_id, identity.full_hash, input.project_id, input.job_id,
      input.request_digest, input.fact_digest, canonicalJson(input.execution),
      input.base_revision, input.source_digest, input.plan_sha256, input.rights_digest,
      input.frame_count, input.fps_numerator, input.fps_denominator,
      CREATED_PREPARED_SOURCE_DESCRIPTOR, input.stage_root,
      canonicalJson([...input.roots].sort()), canonicalJson(this.#files(input)), at);
    const stored = this.read(identity.prepared_source_id);
    if (stored === undefined) fail('REVISION_CONFLICT', 'The prepared source registration did not land');
    return stored;
  }

  /** The mapping of one prepared source, or `undefined`. */
  read(preparedSourceId: string): PreparedSourceMapping | undefined {
    this.#schema();
    const row = this.#db.prepare('SELECT * FROM created_prepared_source WHERE prepared_source_id=?')
      .get(preparedSourceId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : this.#decode(row);
  }

  /** The mapping of the preparation of one job, or `undefined`. */
  byJob(jobId: string): PreparedSourceMapping | undefined {
    this.#schema();
    const row = this.#db.prepare('SELECT * FROM created_prepared_source WHERE job_id=?').get(jobId) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : this.#decode(row);
  }

  /**
   * Bind a published review package to a prepared source.
   *
   * The binding is written once. A second binding of the same prepared source is
   * refused, and a binding to a prepared source that does not exist is refused, so a
   * result reference can never point at nothing.
   */
  bindPackage(binding: Omit<PreparedSourcePackageBinding, 'bound_at'>): PreparedSourcePackageBinding {
    this.#schema();
    if (!ID.test(binding.package_id) || !Number.isSafeInteger(binding.package_version) ||
      binding.package_version < 1 || !HASH.test(binding.receipt_digest)) {
      fail('INVALID_REQUEST', 'The package binding is malformed');
    }
    const mapping = this.read(binding.prepared_source_id);
    if (mapping === undefined) fail('NOT_FOUND', 'The prepared source does not exist');
    const existing = this.packageBinding(binding.prepared_source_id);
    if (existing !== undefined) {
      if (existing.package_id !== binding.package_id ||
        existing.package_version !== binding.package_version ||
        existing.receipt_digest !== binding.receipt_digest) {
        fail('IDEMPOTENCY_CONFLICT', 'Another package is already bound to this prepared source');
      }
      return existing;
    }
    const at = this.#now().toISOString();
    this.#db.prepare(`INSERT INTO created_prepared_source_package(
      prepared_source_id, package_id, package_version, receipt_digest, bound_at) VALUES(?,?,?,?,?)`)
      .run(binding.prepared_source_id, binding.package_id, binding.package_version, binding.receipt_digest, at);
    return { ...binding, bound_at: at };
  }

  /**
   * The package bound to a prepared source.
   *
   * It is `undefined` until the package has really been published, which is how a
   * completed preparation without a package reports "no result reference" instead of a
   * dangling one.
   */
  packageBinding(preparedSourceId: string): PreparedSourcePackageBinding | undefined {
    this.#schema();
    const row = this.#db.prepare('SELECT * FROM created_prepared_source_package WHERE prepared_source_id=?')
      .get(preparedSourceId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      prepared_source_id: String(row.prepared_source_id),
      package_id: String(row.package_id),
      package_version: Number(row.package_version),
      receipt_digest: String(row.receipt_digest),
      bound_at: String(row.bound_at),
    };
  }

  #assertInput(input: RegisterPreparedSourceInput): void {
    if (!ID.test(input.project_id) || !ID.test(input.job_id)) fail('INVALID_REQUEST', 'The prepared source identity is invalid');
    if (!HASH.test(input.request_digest) || !HASH.test(input.fact_digest) ||
      !HASH.test(input.source_digest) || !HASH.test(input.plan_sha256) || !HASH.test(input.rights_digest)) {
      fail('INVALID_REQUEST', 'The prepared source digests are invalid');
    }
    if (!Number.isSafeInteger(input.base_revision) || input.base_revision < 0 ||
      !Number.isSafeInteger(input.frame_count) || input.frame_count < 1 ||
      !Number.isSafeInteger(input.fps_numerator) || input.fps_numerator < 1 ||
      !Number.isSafeInteger(input.fps_denominator) || input.fps_denominator < 1) {
      fail('INVALID_REQUEST', 'The prepared source counters are invalid');
    }
    if (typeof input.stage_root !== 'string' || input.stage_root.length === 0) {
      fail('INVALID_REQUEST', 'The prepared source has no private stage');
    }
    if (!Array.isArray(input.files) || input.files.length === 0 || !Array.isArray(input.roots) ||
      input.roots.length === 0) {
      fail('INVALID_REQUEST', 'The prepared source has no closure');
    }
    const paths = new Set<string>();
    for (const file of input.files) {
      if (typeof file.relative_path !== 'string' || file.relative_path.length === 0 ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !HASH.test(file.sha256)) {
        fail('INVALID_REQUEST', 'The prepared source file is malformed');
      }
      if (paths.has(file.relative_path)) fail('INVALID_REQUEST', 'The prepared source names a file twice');
      paths.add(file.relative_path);
    }
    for (const root of input.roots) {
      if (!paths.has(root)) fail('INVALID_REQUEST', 'A root of the prepared source is not one of its files');
    }
    if (input.execution === null || typeof input.execution !== 'object' ||
      !ID.test(input.execution.run_id) || !ID.test(input.execution.step_id) ||
      !Number.isSafeInteger(input.execution.attempt) || input.execution.attempt < 1) {
      fail('INVALID_REQUEST', 'The prepared source execution is invalid');
    }
  }

  #files(input: RegisterPreparedSourceInput): PreparedSourceFileFact[] {
    return [...input.files]
      .map((file) => ({ relative_path: file.relative_path, bytes: file.bytes, sha256: file.sha256 }))
      .sort((left, right) => (left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0));
  }

  #factsOf(input: RegisterPreparedSourceInput): Record<string, unknown> {
    return {
      project_id: input.project_id,
      job_id: input.job_id,
      request_digest: input.request_digest,
      fact_digest: input.fact_digest,
      execution: input.execution,
      base_revision: input.base_revision,
      source_digest: input.source_digest,
      plan_sha256: input.plan_sha256,
      rights_digest: input.rights_digest,
      frame_count: input.frame_count,
      fps_numerator: input.fps_numerator,
      fps_denominator: input.fps_denominator,
      stage_root: input.stage_root,
      roots: [...input.roots].sort(),
      files: this.#files(input),
    };
  }

  #facts(mapping: PreparedSourceMapping): Record<string, unknown> {
    return {
      project_id: mapping.project_id,
      job_id: mapping.job_id,
      request_digest: mapping.request_digest,
      fact_digest: mapping.fact_digest,
      execution: mapping.execution,
      base_revision: mapping.base_revision,
      source_digest: mapping.source_digest,
      plan_sha256: mapping.plan_sha256,
      rights_digest: mapping.rights_digest,
      frame_count: mapping.frame_count,
      fps_numerator: mapping.fps_numerator,
      fps_denominator: mapping.fps_denominator,
      stage_root: mapping.stage_root,
      roots: [...mapping.roots].sort(),
      files: mapping.files,
    };
  }

  #decode(row: Record<string, unknown>): PreparedSourceMapping {
    const execution = JSON.parse(String(row.execution_json)) as ExecutionBinding;
    const files = JSON.parse(String(row.files_json)) as PreparedSourceFileFact[];
    const roots = JSON.parse(String(row.roots_json)) as string[];
    return {
      prepared_source_id: String(row.prepared_source_id),
      full_hash: String(row.full_hash),
      project_id: String(row.project_id),
      job_id: String(row.job_id),
      request_digest: String(row.request_digest),
      fact_digest: String(row.fact_digest),
      execution,
      base_revision: Number(row.base_revision),
      source_digest: String(row.source_digest),
      plan_sha256: String(row.plan_sha256),
      rights_digest: String(row.rights_digest),
      frame_count: Number(row.frame_count),
      fps_numerator: Number(row.fps_numerator),
      fps_denominator: Number(row.fps_denominator),
      descriptor: String(row.descriptor),
      stage_root: String(row.stage_root),
      roots,
      files,
      created_at: String(row.created_at),
    };
  }
}

/** The digest of the identity of a prepared source, for the callers that key on it. */
export function preparedSourceDigest(input: {
  readonly project_id: string;
  readonly job_id: string;
  readonly request_digest: string;
  readonly fact_digest: string;
}): string {
  return createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex');
}
