import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(new URL('../../../contracts/agent-driven-a.migration.sql', import.meta.url), 'utf8');
const migrationSHA = createHash('sha256').update(migration).digest('hex');
const expectedMigrationSHA = '5572530b5036728e414a0653fc36fd43958874a3a89cc8223e3984194c4a1fa4';
export interface AgentSchemaReceipt { schema_sha256: string; schema_fingerprint: string; }
export class AgentSchemaError extends Error {
  readonly code = 'AGENT_SCHEMA_DRIFT';
  constructor() { super('Agent persistence schema is unavailable or incompatible'); }
}
function fingerprint(db: DatabaseSync): string {
  const rows = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name GLOB 'cp_a0_*' OR name='agent_driven_schema_receipt' ORDER BY type,name").all();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
/** Called only through RevisionStore.compose. No database constructor or second connection. */
export function applyAgentSchema(db: DatabaseSync, hooks: { beforeReceipt?: () => void } = {}): AgentSchemaReceipt {
  if (migrationSHA !== expectedMigrationSHA) throw new AgentSchemaError();
  db.exec('PRAGMA foreign_keys=ON');
  if (Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys) !== 1) throw new AgentSchemaError();
  const receiptTable = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='agent_driven_schema_receipt'").get();
  if (receiptTable) {
    const columns = db.prepare('PRAGMA table_info(agent_driven_schema_receipt)').all().map(row => String(row.name));
    if (JSON.stringify(columns) !== JSON.stringify(['id', 'schema_sha256', 'schema_fingerprint'])) throw new AgentSchemaError();
    const receipt = db.prepare("SELECT schema_sha256,schema_fingerprint FROM agent_driven_schema_receipt WHERE id='cp-a0-r4'").get();
    if (receipt) {
      if (Number(db.prepare('SELECT count(*) AS n FROM agent_driven_schema_receipt').get()?.n) !== 1) throw new AgentSchemaError();
      if (receipt.schema_sha256 !== migrationSHA || receipt.schema_fingerprint !== fingerprint(db)) throw new AgentSchemaError();
      return { schema_sha256: String(receipt.schema_sha256), schema_fingerprint: String(receipt.schema_fingerprint) };
    }
    throw new AgentSchemaError();
  }
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name GLOB 'cp_a0_*' LIMIT 1").get()) throw new AgentSchemaError();
  // Preserve the frozen DDL, but join it and the migration receipt into ONE transaction.
  // Only the exact top-level wrapper lines are removed. Trigger BEGIN/END bodies are intact.
  if ((migration.match(/^BEGIN IMMEDIATE;$/gm) ?? []).length !== 1 || (migration.match(/^COMMIT;$/gm) ?? []).length !== 1) throw new AgentSchemaError();
  const body = migration.replace(/^PRAGMA foreign_keys=ON;\r?\n/m, '').replace(/^BEGIN IMMEDIATE;\r?\n/m, '').replace(/^COMMIT;\s*$/m, '');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec("CREATE TABLE IF NOT EXISTS agent_driven_schema_receipt(id TEXT PRIMARY KEY CHECK(id='cp-a0-r4'), schema_sha256 TEXT NOT NULL, schema_fingerprint TEXT NOT NULL)");
    db.exec(body);
    const schema_fingerprint = fingerprint(db);
    hooks.beforeReceipt?.();
    db.prepare('INSERT INTO agent_driven_schema_receipt VALUES(?,?,?)').run('cp-a0-r4', migrationSHA, schema_fingerprint);
    db.exec('COMMIT');
    return { schema_sha256: migrationSHA, schema_fingerprint };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
