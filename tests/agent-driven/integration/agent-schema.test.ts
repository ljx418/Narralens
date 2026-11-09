import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import { applyAgentSchema, AgentSchemaError } from '../../../src/host/agent-driven/agent-schema.js';

const apply = (store: RevisionStore, hooks: Parameters<typeof applyAgentSchema>[1] = {}) => store.compose(db => applyAgentSchema(db, hooks));
const names = (store: RevisionStore) => store.compose(db => db.prepare("SELECT name FROM sqlite_schema WHERE name GLOB 'cp_a0_*' ORDER BY name").all().map(r => r.name));
describe('A schema on the real shared RevisionStore', () => {
  it('applies to an actual legacy store and retains existing engine/project tables and contents', () => {
    const store = new RevisionStore();
    try {
      store.compose(db => db.prepare('INSERT INTO project_state(project_id,revision,updated_at) VALUES(?,?,?)').run('legacy', 7, 'before'));
      const legacy = store.compose(db => db.prepare('SELECT * FROM project_state').all());
      const before = store.compose(db => db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all());
      const receipt = apply(store);
      expect(receipt.schema_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(names(store)).toContain('cp_a0_answer_head');
      expect(names(store)).toContain('cp_a0_render_attempt');
      const after = store.compose(db => db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all());
      for (const row of before) expect(after).toContainEqual(row);
      expect(store.compose(db => db.prepare('SELECT * FROM project_state').all())).toEqual(legacy);
      expect(store.compose(db => db.prepare('PRAGMA foreign_keys').get()?.foreign_keys)).toBe(1);
      expect(apply(store)).toEqual(receipt);
    } finally { store.close(); }
  });
  it('persists receipt across a real database close and reopen without reapplying the schema', () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-a-schema-'));
    let store: RevisionStore | undefined;
    try {
      store = new RevisionStore(join(root, 'state.sqlite'));
      const first = apply(store);
      store.close(); store = undefined;
      store = new RevisionStore(join(root, 'state.sqlite'));
      expect(apply(store)).toEqual(first);
      expect(store.compose(db => db.prepare('SELECT count(*) AS n FROM agent_driven_schema_receipt').get()?.n)).toBe(1);
    } finally { store?.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('rolls back all new DDL and receipts on interruption before the receipt commit, then retries cleanly', () => {
    const store = new RevisionStore();
    try {
      expect(() => apply(store, { beforeReceipt: () => { throw new Error('injected interruption'); } })).toThrow('injected interruption');
      expect(names(store)).toEqual([]);
      expect(store.compose(db => db.prepare("SELECT name FROM sqlite_schema WHERE name='agent_driven_schema_receipt'").get())).toBeUndefined();
      expect(apply(store).schema_fingerprint).toHaveLength(64);
    } finally { store.close(); }
  });
  it('rejects an unreceipted preexisting A schema instead of blessing arbitrary existing tables', () => {
    const store = new RevisionStore();
    try {
      store.compose(db => db.exec('CREATE TABLE cp_a0_intake_version(unknown_column TEXT)'));
      expect(() => apply(store)).toThrow(AgentSchemaError);
      expect(store.compose(db => db.prepare('PRAGMA table_info(cp_a0_intake_version)').all().map(x => x.name))).toEqual(['unknown_column']);
    } finally { store.close(); }
  });
  it('detects schema and receipt drift on reopen, rather than silently making CREATE IF NOT EXISTS pass', () => {
    const store = new RevisionStore();
    try {
      apply(store);
      store.compose(db => db.exec('DROP TRIGGER cp_a0_question_version_update'));
      expect(() => apply(store)).toThrow(AgentSchemaError);
    } finally { store.close(); }
    const other = new RevisionStore();
    try {
      apply(other);
      other.compose(db => db.exec("UPDATE agent_driven_schema_receipt SET schema_sha256='bad'"));
      expect(() => apply(other)).toThrow(AgentSchemaError);
    } finally { other.close(); }
  });
  it('enforces the frozen FK/immutability constraints on Node, not only on the Python fixture', () => {
    const store = new RevisionStore();
    try {
      apply(store);
      store.compose(db => {
        db.prepare('INSERT INTO cp_a0_intake_version VALUES(?,?,?,?,?,?)').run('intake', 1, 'principal', 'a'.repeat(64), '{}', 'now');
        db.prepare('INSERT INTO cp_a0_intake_head VALUES(?,?)').run('intake', 1);
        expect(() => db.prepare('INSERT INTO cp_a0_intake_head VALUES(?,?)').run('missing', 1)).toThrow();
        expect(() => db.prepare('UPDATE cp_a0_intake_version SET content_json=?').run('{"changed":true}')).toThrow();
      });
    } finally { store.close(); }
  });
  it('keeps the frozen migration bytes unchanged in the runtime package', () => {
    expect(readFileSync('contracts/agent-driven-a.migration.sql')).toEqual(readFileSync('docs/agent-driven-v1/cp-a0/migration.sql'));
  });
});
