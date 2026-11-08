"""Pure temporary SQL contract checks. Extract legacy table DDL from source, not a migrated DB."""
import sqlite3,re,json,hashlib,tempfile
from pathlib import Path
R=Path(__file__).resolve().parents[1];P=R/'docs/agent-driven-v1/s0';text=(R/'src/host/projects/revision-store.ts').read_text();src=(P/'migration.sql').read_text();checks=[]
def check(name,predicate):
 assert predicate,name;checks.append({'id':name,'status':'PASS'})
def refuse(db,name,sql,args=()):
 try:db.execute(sql,args)
 except sqlite3.DatabaseError:checks.append({'id':name,'status':'PASS'});return
 raise AssertionError(name+' accepted invalid write')
with tempfile.TemporaryDirectory(prefix='narralens-s0-sql-') as tmp:
 path=Path(tmp)/'isolated.sqlite';db=sqlite3.connect(path);db.execute('PRAGMA foreign_keys=ON')
 for name in ['project_state','project_transaction','snapshot','outbox']:
  m=re.search(r'CREATE TABLE IF NOT EXISTS '+name+r' \([\s\S]*?\n      \);',text);assert m,name
  db.executescript(m.group(0))
 job=(R/'src/host/projects/job-kind-migration.ts').read_text();db.executescript(re.search(r'export const JOB_TABLE_DDL = `([\s\S]+?)`;',job).group(1))
 before={row[0]:row[1] for row in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table'")};db.executescript(src);db.executescript(src)
 check('legacy-ddl-byte-unchanged',all(db.execute('SELECT sql FROM sqlite_master WHERE name=?',(n,)).fetchone()[0]==v for n,v in before.items()))
 check('twelve-additive-tables',db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'ad_%'").fetchone()[0]==12)
 h='a'*64;db.execute("INSERT INTO ad_intake VALUES('intake','owner',1,'now')");db.execute('INSERT INTO ad_intake_version VALUES(?,?,?,?,?)',('intake',1,'{}',h,'now'))
 refuse(db,'trusted-channel-only',"INSERT INTO ad_decision VALUES('d','intake',1,'user','mcp',?,'confirm_brief','now','later')",(h,))
 db.execute("INSERT INTO ad_command(command_id,principal_id,operation,idempotency_key,request_digest,reserved_project_id,created_at) VALUES('c1','u','create','key',?,'p1','now')",(h,))
 refuse(db,'global-command-key-unique',"INSERT INTO ad_command(command_id,principal_id,operation,idempotency_key,request_digest,reserved_project_id,created_at) VALUES('c2','u','create','key',?,'p2','now')",(h,))
 refuse(db,'origin-must-reference-real-project',"INSERT INTO ad_project_origin VALUES('absent','created','intake',1,'d','s','tx','{}')")
 refuse(db,'intake-version-immutable',"UPDATE ad_intake_version SET brief_json='[]'")
 # Minimal row uses the EXACT legacy columns extracted above; no Host or fake migration constructor.
 cols=[r[1] for r in db.execute('PRAGMA table_info(project_state)')];vals={k:'' for k in cols};vals.update(project_id='p',revision=0,updated_at='now');db.execute('INSERT INTO project_state('+','.join(cols)+') VALUES('+','.join('?' for _ in cols)+')',[vals[k] for k in cols])
 db.execute('INSERT INTO ad_approval VALUES(?,?,?,?,?,?,?,?,?,?)',('a','p','impact',h,'{}','ui','trusted_ui','later','active',None))
 refuse(db,'approval-facts-cannot-change',"UPDATE ad_approval SET plan_sha256=? WHERE approval_id='a'",('b'*64,))
 refuse(db,'consumed-requires-transaction',"UPDATE ad_approval SET state='consumed' WHERE approval_id='a'")
 refuse(db,'approval-no-delete',"DELETE FROM ad_approval WHERE approval_id='a'")
 db.execute("UPDATE ad_approval SET state='revoked' WHERE approval_id='a'")
 refuse(db,'terminal-approval-no-reopen',"UPDATE ad_approval SET state='active' WHERE approval_id='a'")
 db.execute('INSERT INTO ad_artifact_revision VALUES(?,?,?,?,?,?,?,?,?)',('p','art',1,'script',h,h,'[]','{}','now'))
 refuse(db,'artifact-no-rewrite',"UPDATE ad_artifact_revision SET content_json='[]'")
 refuse(db,'artifact-no-delete',"DELETE FROM ad_artifact_revision")
 db.commit();db.execute('BEGIN IMMEDIATE');db.execute("INSERT INTO ad_intake VALUES('rolled-back','owner',1,'now')");db.rollback();check('transaction-rollback',db.execute("SELECT count(*) FROM ad_intake WHERE intake_id='rolled-back'").fetchone()[0]==0)
 db.close();db=sqlite3.connect(path);check('temp-old-schema-reopen',db.execute('SELECT count(*) FROM ad_command').fetchone()[0]==1);db.close()
for v in json.loads((P/'vectors.json').read_text()):
 c=json.dumps(v['input'],ensure_ascii=False,sort_keys=True,separators=(',',':'));check(v['id']+'-python',c==v['canonical'] and hashlib.sha256(c.encode()).hexdigest()==v['sha256'])
r={'kind':'S0_ISOLATED_SQL_AND_PYTHON_CHECK','status':'PASS','productionAcceptance':'NOT_RUN','scope':'temporary database with exact legacy DDL extracts; not real RevisionStore migration or business recovery','checks':checks,'migration_sha256':hashlib.sha256((P/'migration.sql').read_bytes()).hexdigest()};(P/'sql-check.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':'PASS','checks':len(checks),'productionAcceptance':'NOT_RUN'}))
