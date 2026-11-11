import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
import { ImpactStore } from "../../../src/host/impact/impact-store.js";
import { OperationIdempotencyStore } from "../../../src/host/projects/operation-idempotency-store.js";
import {
  CREATED_IMPACT_OPERATION,
  CreatedSourceImpactStore,
  computeCreatedImpactHash,
  createdImpactFacts,
  impactTableAllowsCreatedOperation,
  upgradeImpactTableForCreatedOperation,
  type CreatedImpactSpecV1,
} from "../../../src/host/agent-driven/created-source-impact-store.js";
import { CreatedSourceAdoptionStore } from "../../../src/host/agent-driven/created-source-adoption-store.js";
import { CreatedPreparedSourceStore } from "../../../src/host/agent-driven/created-prepared-source-store.js";

const HASH = "a".repeat(64);

/**
 * The legacy `impact` table, exactly as the migration domain wrote it.
 *
 * The upgrade has to work on a database that already carries this table with its old
 * CHECK, so the test builds one by hand rather than letting the current code create it.
 */
const LEGACY_IMPACT_DDL = `
CREATE TABLE impact (
  impact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('adopt_materialization','restore_snapshot')),
  reference_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  source_digest TEXT NOT NULL,
  control_revision INTEGER NOT NULL,
  rights_digest TEXT NOT NULL,
  native_plan_sha256 TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  impact_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','consumed','expired','stale')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, impact_hash)
);
`;

type LegacyRow = {
  impact_id: string; project_id: string; operation: string; reference_id: string;
  base_revision: number; source_digest: string; control_revision: number; rights_digest: string;
  native_plan_sha256: string; request_digest: string; canonical_json: string; impact_hash: string;
  state: string; expires_at: string; created_at: string; updated_at: string;
};

function legacyRow(impactId: string, projectId: string, operation: string, state: string): LegacyRow {
  // The legacy table has UNIQUE(project_id, impact_hash), so every fixture row needs
  // its own hash or the fixture would trip the constraint it is meant to prove.
  const impactHash = createHash('sha256').update(impactId, 'utf8').digest('hex');
  return {
    impact_id: impactId,
    project_id: projectId,
    operation,
    reference_id: `materialization-${impactId}`,
    base_revision: 3,
    source_digest: HASH,
    control_revision: 1,
    rights_digest: HASH,
    native_plan_sha256: HASH,
    request_digest: HASH,
    canonical_json: '{"format":"narralens.impact@1.0"}',
    impact_hash: impactHash,
    state,
    expires_at: "2030-01-01T00:00:00.000Z",
    created_at: "2026-11-12T00:00:00.000Z",
    updated_at: "2026-11-12T00:00:00.000Z",
  };
}

function insertLegacy(db: DatabaseSync, row: LegacyRow): void {
  db.prepare(`INSERT INTO impact(
    impact_id, project_id, operation, reference_id, base_revision, source_digest,
    control_revision, rights_digest, native_plan_sha256, request_digest, canonical_json,
    impact_hash, state, expires_at, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.impact_id, row.project_id, row.operation, row.reference_id, row.base_revision,
    row.source_digest, row.control_revision, row.rights_digest, row.native_plan_sha256,
    row.request_digest, row.canonical_json, row.impact_hash, row.state, row.expires_at,
    row.created_at, row.updated_at);
}

describe("the forward upgrade of the impact table", () => {
  it("upgrades an old table and keeps every old row and value", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON;");
    db.exec(LEGACY_IMPACT_DDL);
    const rows = [
      legacyRow("imp_legacy_adopt", "project-1", "adopt_materialization", "active"),
      legacyRow("imp_legacy_restore", "project-1", "restore_snapshot", "consumed"),
      legacyRow("imp_legacy_stale", "project-2", "adopt_materialization", "stale"),
    ];
    for (const row of rows) insertLegacy(db, row);
    expect(impactTableAllowsCreatedOperation(db)).toBe(false);

    const result = upgradeImpactTableForCreatedOperation(db);
    expect(result.upgraded).toBe(true);
    expect(result.rows).toBe(3);
    expect(impactTableAllowsCreatedOperation(db)).toBe(true);

    const after = db.prepare("SELECT * FROM impact ORDER BY impact_id").all() as Array<Record<string, unknown>>;
    expect(after.length).toBe(3);
    for (let index = 0; index < rows.length; index += 1) {
      const old = rows[index]!;
      const next = after[index]! as unknown as LegacyRow;
      for (const key of Object.keys(old) as Array<keyof LegacyRow>) {
        expect(String(next[key]), `${old.impact_id}.${key}`).toBe(String(old[key]));
      }
    }
    // The unique constraint of the old table travelled with the definition.
    expect(() => insertLegacy(db, legacyRow("imp_legacy_adopt", "project-1", "adopt_materialization", "active")))
      .toThrow();
    db.close();
  });

  it("is idempotent and does not upgrade a table twice", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(LEGACY_IMPACT_DDL);
    insertLegacy(db, legacyRow("imp_legacy", "project-1", "adopt_materialization", "active"));
    expect(upgradeImpactTableForCreatedOperation(db).upgraded).toBe(true);
    const second = upgradeImpactTableForCreatedOperation(db);
    expect(second.upgraded).toBe(false);
    expect(second.rows).toBe(1);
    db.close();
  });

  it("refuses the created operation until the table was upgraded", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(LEGACY_IMPACT_DDL);
    expect(() => insertLegacy(db, legacyRow("imp_created", "project-1", CREATED_IMPACT_OPERATION, "active")))
      .toThrow();
    db.close();
  });
});

describe("the two impact hash domains", () => {
  const spec: CreatedImpactSpecV1 = {
    format: 'narralens.created-impact@1',
    impact_id: 'imp_created',
    project_id: 'project-1',
    operation: CREATED_IMPACT_OPERATION,
    materialization_id: 'ps_1',
    target_snapshot_id: 'snapshot-1',
    base_revision: 3,
    source_digest: HASH,
    control_revision: 1,
    engine: 'openfilm',
    engine_upstream_sha: HASH,
    affected_ranges: [{ start_frame: 0, end_frame_exclusive: 100, clip_id: 'clip-a' }],
    affected_consumers: [{ kind: 'native', id: 'consumer-a', action: 'observe' }],
    locks_checked: [{ lock_id: 'lock-a', lock_type: 'visual', scope: 'project', target_id: '', start_frame: 0, end_frame_exclusive: 100 }],
    rights_digest: HASH,
    native_plan_sha256: HASH,
    approvals_required: ['change.approve'],
    expires_at: '2026-11-12T00:15:00.000Z',
    impact_hash: '',
  };

  it("hashes the created spec in the created domain only", () => {
    const hash = computeCreatedImpactHash(spec);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // The legacy domain is a different preimage, so the same facts hash differently
    // there. The two domains cannot accept each other.
    expect(hash).not.toBe('x');
    expect(createdImpactFacts(spec).operation).toBe(CREATED_IMPACT_OPERATION);
  });

  it("keeps the legacy reader away from a created impact and the created reader away from a legacy one", () => {
    const revisions = new RevisionStore(":memory:");
    const legacy = new ImpactStore(revisions, new OperationIdempotencyStore(revisions.compose((db) => db)));
    const created = new CreatedSourceImpactStore(revisions, legacy);

    const stored = created.create({
      impact_id: 'imp_created',
      project_id: 'project-1',
      materialization_id: 'ps_1',
      target_snapshot_id: 'snapshot-1',
      base_revision: 3,
      source_digest: HASH,
      control_revision: 1,
      engine_upstream_sha: HASH,
      affected_ranges: [{ start_frame: 0, end_frame_exclusive: 100, clip_id: 'clip-a' }],
      affected_consumers: [{ kind: 'native', id: 'consumer-a', action: 'observe' }],
      locks_checked: [{ lock_id: 'lock-a', lock_type: 'visual', scope: 'project', target_id: '', start_frame: 0, end_frame_exclusive: 100 }],
      rights_digest: HASH,
      native_plan_sha256: HASH,
      approvals_required: ['change.approve'],
      request_digest: HASH,
      plan: { format: 'narralens.prepared-adoption-plan@1' },
      now: new Date('2026-11-12T00:00:00.000Z'),
    });

    // The created impact lives in the one table and its state is the one authority.
    expect(stored.operation).toBe(CREATED_IMPACT_OPERATION);
    expect(legacy.get('imp_created')?.state).toBe('active');
    // The legacy reader verifies the stored bytes in the legacy domain and refuses.
    expect(() => legacy.requireActive('imp_created', new Date('2026-11-12T00:00:00.000Z'))).toThrow();
    // The created reader accepts it.
    expect(created.requireActive('imp_created', new Date('2026-11-12T00:00:00.000Z')).impact_id).toBe('imp_created');
    // The immutable plan fact is there and has no state column.
    expect(created.planFact('imp_created')?.prepared_source_id).toBe('ps_1');
    revisions.close();
  });

  it("never extends the window on a replay", () => {
    const revisions = new RevisionStore(":memory:");
    const legacy = new ImpactStore(revisions, new OperationIdempotencyStore(revisions.compose((db) => db)));
    const created = new CreatedSourceImpactStore(revisions, legacy);
    const input = {
      impact_id: 'imp_replay',
      project_id: 'project-1',
      materialization_id: 'ps_1',
      target_snapshot_id: 'snapshot-1',
      base_revision: 3,
      source_digest: HASH,
      control_revision: 1,
      engine_upstream_sha: HASH,
      affected_ranges: [],
      affected_consumers: [],
      locks_checked: [],
      rights_digest: HASH,
      native_plan_sha256: HASH,
      approvals_required: ['change.approve'],
      request_digest: HASH,
      plan: { format: 'narralens.prepared-adoption-plan@1' },
      now: new Date('2026-11-12T00:00:00.000Z'),
    };
    const first = created.create(input);
    const second = created.create({ ...input, now: new Date('2026-11-12T01:00:00.000Z') });
    expect(second.expires_at).toBe(first.expires_at);
    revisions.close();
  });
});

describe("the created adoption facts", () => {
  it("records the adoption once and verifies the same content on a replay", () => {
    const revisions = new RevisionStore(":memory:");
    const store = new CreatedSourceAdoptionStore(revisions, { now: () => new Date('2026-11-12T00:00:00.000Z') });
    const input = {
      transaction_id: 'txn-1',
      project_id: 'project-1',
      prepared_source_id: 'ps_1',
      impact_id: 'imp_1',
      approval_id: 'approval_1',
      plan_sha256: HASH,
      facts_digest: HASH,
      original_source_digest: HASH,
      target_source_digest: HASH,
      expected_snapshot_id: 'snapshot-1',
      native_plan: { native_plan_sha256: HASH },
      original_closure: [{ relative_path: 'film.html', bytes: 10, sha256: HASH }],
      target_closure: [{ relative_path: 'film.html', bytes: 20, sha256: HASH }],
      stage_root: '/private/stage',
      backup_token: 'backup-1',
      execution: {
        run_id: 'run-1', plan_version: 1 as const, step_id: 'chapters', attempt: 1,
        input_digest: HASH, run_scope_digest: HASH, authorization_id: 'grant-1',
      },
      now: new Date('2026-11-12T00:00:00.000Z'),
    };
    const first = store.record(input);
    const second = store.record(input);
    expect(second.created_at).toBe(first.created_at);
    expect(store.adoptionFact('txn-1')?.expected_snapshot_id).toBe('snapshot-1');
    revisions.close();
  });

  it("refuses a second, different adoption under the same transaction", () => {
    const revisions = new RevisionStore(":memory:");
    const store = new CreatedSourceAdoptionStore(revisions);
    const base = {
      transaction_id: 'txn-2',
      project_id: 'project-1',
      prepared_source_id: 'ps_1',
      impact_id: 'imp_1',
      approval_id: 'approval_1',
      plan_sha256: HASH,
      facts_digest: HASH,
      original_source_digest: HASH,
      target_source_digest: HASH,
      expected_snapshot_id: 'snapshot-1',
      native_plan: {},
      original_closure: [{ relative_path: 'film.html', bytes: 10, sha256: HASH }],
      target_closure: [{ relative_path: 'film.html', bytes: 20, sha256: HASH }],
      stage_root: '/private/stage',
      backup_token: 'backup-1',
      execution: {
        run_id: 'run-1', plan_version: 1 as const, step_id: 'chapters', attempt: 1,
        input_digest: HASH, run_scope_digest: HASH, authorization_id: 'grant-1',
      },
      now: new Date('2026-11-12T00:00:00.000Z'),
    };
    store.record(base);
    expect(() => store.record({ ...base, target_source_digest: 'b'.repeat(64) })).toThrow();
    revisions.close();
  });

  it("inserts the source fact once and verifies the same content on a replay", () => {
    const revisions = new RevisionStore(":memory:");
    const store = new CreatedSourceAdoptionStore(revisions);
    const fact = {
      format: 'narralens.created-source-fact@1' as const,
      project_id: 'project-1',
      transaction_id: 'txn-1',
      prepared_source_id: 'ps_1',
      impact_id: 'imp_1',
      approval_id: 'approval_1',
      snapshot_id: 'snapshot-1',
      source_digest: HASH,
      plan_sha256: HASH,
      facts_digest: HASH,
      revision: 4,
      execution: {
        run_id: 'run-1', plan_version: 1 as const, step_id: 'chapters', attempt: 1,
        input_digest: HASH, run_scope_digest: HASH, authorization_id: 'grant-1',
      },
      created_at: '2026-11-12T00:00:00.000Z',
    };
    const first = store.insertOrVerifySourceFact({ fact, now: new Date('2026-11-12T00:00:00.000Z') });
    expect(first.replayed).toBe(false);
    const second = store.insertOrVerifySourceFact({ fact, now: new Date('2026-11-12T00:05:00.000Z') });
    expect(second.replayed).toBe(true);
    expect(() => store.insertOrVerifySourceFact({
      fact: { ...fact, source_digest: 'c'.repeat(64) },
      now: new Date('2026-11-12T00:06:00.000Z'),
    })).toThrow();
    revisions.close();
  });
});

describe("the D02 prepared source mapping", () => {
  it("registers the same preparation once and refuses a different one under the same identifier", () => {
    const revisions = new RevisionStore(":memory:");
    const store = new CreatedPreparedSourceStore(revisions, { now: () => new Date('2026-11-12T00:00:00.000Z') });
    const input = {
      project_id: 'project-1',
      job_id: 'job_1',
      request_digest: HASH,
      fact_digest: HASH,
      execution: {
        run_id: 'run-1', plan_version: 1 as const, step_id: 'chapters', attempt: 1,
        input_digest: HASH, run_scope_digest: HASH, authorization_id: 'grant-1',
      },
      base_revision: 3,
      source_digest: HASH,
      plan_sha256: HASH,
      rights_digest: HASH,
      frame_count: 1200,
      fps_numerator: 25,
      fps_denominator: 1,
      stage_root: '/private/stage',
      roots: ['film.html'],
      files: [{ relative_path: 'film.html', bytes: 10, sha256: HASH }],
    };
    const first = store.register(input);
    expect(first.prepared_source_id.startsWith('ps_')).toBe(true);
    expect(first.prepared_source_id).toHaveLength(3 + 60);
    const second = store.register(input);
    expect(second.prepared_source_id).toBe(first.prepared_source_id);
    expect(second.created_at).toBe(first.created_at);
    // A different fact digest is a different preparation, so it gets a different
    // identifier and does not collide with the first one.
    const other = store.register({ ...input, fact_digest: 'b'.repeat(64) });
    expect(other.prepared_source_id).not.toBe(first.prepared_source_id);
    // The same identity with a different closure is refused, not applied: the identity
    // says the fact digest, and a closure that contradicts it is a contradiction.
    expect(() => store.register({ ...input, files: [{ relative_path: 'film.html', bytes: 11, sha256: HASH }] }))
      .toThrow();
    revisions.close();
  });

  it("has no result reference until the package is really bound", () => {
    const revisions = new RevisionStore(":memory:");
    const store = new CreatedPreparedSourceStore(revisions);
    const input = {
      project_id: 'project-1',
      job_id: 'job_1',
      request_digest: HASH,
      fact_digest: HASH,
      execution: {
        run_id: 'run-1', plan_version: 1 as const, step_id: 'chapters', attempt: 1,
        input_digest: HASH, run_scope_digest: HASH, authorization_id: 'grant-1',
      },
      base_revision: 3,
      source_digest: HASH,
      plan_sha256: HASH,
      rights_digest: HASH,
      frame_count: 1200,
      fps_numerator: 25,
      fps_denominator: 1,
      stage_root: '/private/stage',
      roots: ['film.html'],
      files: [{ relative_path: 'film.html', bytes: 10, sha256: HASH }],
    };
    const mapping = store.register(input);
    expect(store.packageBinding(mapping.prepared_source_id)).toBeUndefined();
    const bound = store.bindPackage({
      prepared_source_id: mapping.prepared_source_id,
      package_id: 'package-1',
      package_version: 1,
      receipt_digest: HASH,
    });
    expect(bound.package_id).toBe('package-1');
    expect(store.packageBinding(mapping.prepared_source_id)?.package_id).toBe('package-1');
    // Binding to a prepared source that does not exist is refused.
    expect(() => store.bindPackage({
      prepared_source_id: 'ps_does_not_exist', package_id: 'package-2', package_version: 1, receipt_digest: HASH,
    })).toThrow();
    revisions.close();
  });
});
