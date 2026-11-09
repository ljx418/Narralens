#!/usr/bin/env python3
"""Docs-only SQLite constraint fixtures. Never opens a supplied database or starts Host."""
import hashlib, json, re, sqlite3, tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
SQL=(HERE/'migration.sql').read_text()
SRC=(ROOT/'src/host/projects/revision-store.ts').read_text()
JOB=(ROOT/'src/host/projects/job-kind-migration.ts').read_text()
NAMES=['project_state','project_transaction','snapshot','active_commit','outbox']
DDL=[]
for name in NAMES:
 m=re.search(r'CREATE TABLE IF NOT EXISTS '+name+r' \([\s\S]*?\n      \);',SRC)
 assert m,name
 DDL.append(m.group(0))
DDL.append(re.search(r'export const JOB_TABLE_DDL = `([\s\S]*?)`;',JOB).group(1)+';')
BASE='\n'.join(DDL)
H='a'*64
results=[]
def record(name,fn):
 try: fn(); results.append({'case':name,'result':'PASS'})
 except Exception as e: results.append({'case':name,'result':'FAIL','error':str(e)}); raise

def fixture(path):
 c=sqlite3.connect(path);c.execute('PRAGMA foreign_keys=ON');c.executescript(BASE);return c

def rejected(c,sql,params=()):
 try: c.execute(sql,params)
 except sqlite3.IntegrityError: return
 raise AssertionError('invalid insert/update accepted: '+sql)

def fingerprint(c): return c.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
def seed(c):
 for p in ['p','q']:
  c.execute("INSERT INTO project_state(project_id,revision,updated_at) VALUES(?,0,'t')",(p,))
  c.execute("INSERT INTO snapshot VALUES(?,?,?,'openfilm','t')",('s'+p,p,H))
  c.execute("INSERT INTO project_transaction(transaction_id,project_id,state,kind,created_at,updated_at) VALUES(?,?,'prepared','edit','t','t')",('t'+p,p))
  c.execute("INSERT INTO job(job_id,project_id,kind,payload_digest,state,created_at,updated_at) VALUES(?,?,'render',?,'queued','t','t')",('j'+p,p,H))
 c.execute("INSERT INTO cp_a0_template_version VALUES('local-short-film',1,NULL,?,'clip.prepare','1','{}','t')",('b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32',))
 c.execute("INSERT INTO cp_a0_template_head VALUES('local-short-film',1,1)")
 for p in ['p','q']:
  c.execute("INSERT INTO cp_a0_artifact_version VALUES(?,'brief',1,'brief',1,?,?,'{}','[]','t')",(p,H,H))
  c.execute("INSERT INTO cp_a0_run VALUES(?,'run',?,'local-short-film',1,1,'ready','{}','{}','t')",(p,H))
  c.execute("INSERT INTO cp_a0_plan_version VALUES(?,'run',1,?,?,'{}','t')",(p,H,H))
  c.execute("INSERT INTO cp_a0_review_request VALUES(?,'run',1,?,'review','sample','brief',1,?,?,'pending',NULL,'t')",(p,H,H,H))
 c.execute("INSERT INTO cp_a0_content_decision VALUES('p','run','relay','review',?,'driver_relay','human','accepted','conversation:1','t')",(H,))
 c.execute("INSERT INTO cp_a0_trusted_confirmation VALUES('p','run','trusted','review',?,'review','trusted_ui','user','session',?,1,100)",(H,H))
 c.execute("INSERT INTO cp_a0_trusted_confirmation VALUES('p','run','run-trusted',NULL,?,'run.authorize','trusted_ui','user','session',?,1,100)",(H,H))
 c.execute("INSERT INTO cp_a0_trusted_confirmation VALUES('p','run','adopt-trusted','review',?,'change.approve','trusted_ui','user','session',?,1,100)",(H,H))
 c.execute("INSERT INTO cp_a0_execution_grant VALUES('p','run','grant',?,'run-trusted','user','clip.prepare','clip.prepare','1',0,0,'active',100)",(H,))
 c.execute("INSERT INTO cp_a0_step_attempt VALUES('p','run',1,?,'adopt',1,'grant',?,'[]','succeeded','jp',NULL,NULL,'t')",(H,H))
 c.execute("INSERT INTO cp_a0_approval VALUES('p','run','approval',?,'adopt-trusted',1,'adopt',1,?,'change','impact',0,0,?,?,'active',100,NULL)",(H,H,H,H))
 c.execute("INSERT INTO cp_a0_intake_version VALUES('intake',1,'user',?,'{}','t')",(H,))
 c.execute("INSERT INTO cp_a0_intake_confirmation VALUES('intake-trusted','intake',1,?,'user','trusted_ui','session','project.create',1,100)",(H,))
 c.commit()

with tempfile.TemporaryDirectory(prefix='narralens-cpa0-sql-') as tmp:
 c=fixture(Path(tmp)/'fresh.sqlite')
 def fresh(): c.executescript(SQL);assert not c.execute('PRAGMA foreign_key_check').fetchall()
 record('fresh_base_plus_candidate',fresh)
 before=fingerprint(c)
 record('repeat_exact_migration',lambda:(c.executescript(SQL),(_ for _ in ()).throw(AssertionError('schema drift')) if before!=fingerprint(c) else None))
 def legacy():
  l=fixture(Path(tmp)/'legacy.sqlite')
  l.execute("INSERT INTO project_state(project_id,revision,updated_at) VALUES('legacy',7,'before')")
  l.execute("INSERT INTO snapshot VALUES('legacy-s','legacy','old','hypit','before')")
  l.commit(); old=l.execute('SELECT * FROM project_state').fetchall();l.executescript(SQL)
  assert old==l.execute('SELECT * FROM project_state').fetchall()
  assert l.execute('SELECT COUNT(*) FROM cp_a0_project_origin').fetchone()[0]==0
  l.close()
 record('minimal_real_legacy_ddl_preserves_rows_no_constructor',legacy)
 def rollback():
  r=fixture(Path(tmp)/'rollback.sqlite'); prior=fingerprint(r)
  broken=SQL.replace('CREATE TABLE IF NOT EXISTS cp_a0_review_request(',"SELECT * FROM deliberately_missing_table;\nCREATE TABLE IF NOT EXISTS cp_a0_review_request(",1)
  try:r.executescript(broken)
  except sqlite3.OperationalError:r.rollback()
  else:raise AssertionError('fault absent')
  assert fingerprint(r)==prior;r.executescript(SQL);r.close()
 record('halfway_migration_rollback_then_retry',rollback)
 seed(c)
 record('relay_not_trusted_confirmation',lambda:rejected(c,"INSERT INTO cp_a0_execution_grant VALUES('p','run','bad',?,'relay','user','clip.prepare','clip.prepare','1',0,0,'active',100)",(H,)))
 record('trusted_channel_check',lambda:rejected(c,"INSERT INTO cp_a0_trusted_confirmation VALUES('p','run','fake','review',?,'review','driver_relay','human','s',?,1,2)",(H,H)))
 record('review_confirmation_cannot_authorize_run',lambda:rejected(c,"INSERT INTO cp_a0_execution_grant VALUES('p','run','wrong-purpose',?,'trusted','user','clip.prepare','clip.prepare','1',0,0,'active',100)",(H,)))
 record('adoption_confirmation_cannot_authorize_run',lambda:rejected(c,"INSERT INTO cp_a0_execution_grant VALUES('p','run','adopt-purpose',?,'adopt-trusted','user','clip.prepare','clip.prepare','1',0,0,'active',100)",(H,)))
 record('run_confirmation_actor_mismatch',lambda:rejected(c,"INSERT INTO cp_a0_execution_grant VALUES('p','run','wrong-actor',?,'run-trusted','different-user','clip.prepare','clip.prepare','1',0,0,'active',100)",(H,)))
 c.execute("INSERT INTO cp_a0_trusted_confirmation VALUES('p','run','wrong-scope',NULL,?,'run.authorize','trusted_ui','user','session',?,1,100)",(H,'b'*64))
 record('run_confirmation_scope_mismatch',lambda:rejected(c,"INSERT INTO cp_a0_execution_grant VALUES('p','run','wrong-scope-grant',?,'wrong-scope','user','clip.prepare','clip.prepare','1',0,0,'active',100)",(H,)))
 record('run_confirmation_cannot_authorize_adoption',lambda:rejected(c,"INSERT INTO cp_a0_approval SELECT project_id,run_id,'wrong-purpose-approval',run_scope_digest,'run-trusted',plan_version,step_id,attempt,input_digest,change_id,impact_id,base_revision,control_revision,action_digest,facts_digest,'active',expires_at,NULL FROM cp_a0_approval"))
 record('review_confirmation_cannot_authorize_adoption',lambda:rejected(c,"INSERT INTO cp_a0_approval SELECT project_id,run_id,'review-approval',run_scope_digest,'trusted',plan_version,step_id,attempt,input_digest,change_id,impact_id,base_revision,control_revision,action_digest,facts_digest,'active',expires_at,NULL FROM cp_a0_approval"))
 record('approval_expired_state_not_canonical',lambda:rejected(c,"INSERT INTO cp_a0_approval SELECT project_id,run_id,'expired-approval',run_scope_digest,confirmation_id,plan_version,step_id,attempt,input_digest,change_id,impact_id,base_revision,control_revision,action_digest,facts_digest,'expired',expires_at,NULL FROM cp_a0_approval"))
 def rejected_state():
  c.execute("INSERT INTO cp_a0_approval SELECT project_id,run_id,'rejected-approval',run_scope_digest,confirmation_id,plan_version,step_id,attempt,input_digest,change_id,impact_id,base_revision,control_revision,action_digest,facts_digest,'active',expires_at,NULL FROM cp_a0_approval WHERE approval_id='approval'")
  c.execute("UPDATE cp_a0_approval SET state='rejected' WHERE approval_id='rejected-approval'")
  rejected(c,"UPDATE cp_a0_approval SET state='active' WHERE approval_id='rejected-approval'")
 record('approval_rejected_canonical_terminal',rejected_state)
 record('cross_scope_grant',lambda:rejected(c,"INSERT INTO cp_a0_step_attempt VALUES('q','run',1,?,'step',1,'grant',?,'[]','pending',NULL,NULL,NULL,'t')",(H,H)))
 record('scope_digest_mismatch',lambda:rejected(c,"INSERT INTO cp_a0_plan_version VALUES('p','run',1,?,?,'{}','t')",('b'*64,H)))
 record('rich_patch_deferred',lambda:rejected(c,"INSERT INTO cp_a0_plan_version VALUES('p','run',2,?,?,'{}','t')",(H,H)))
 record('immutable_artifact',lambda:rejected(c,"UPDATE cp_a0_artifact_version SET content_json='[]' WHERE project_id='p'"))
 record('immutable_published_template',lambda:rejected(c,"UPDATE cp_a0_template_version SET definition_json='[]'"))
 record('approval_no_unprepared_consume',lambda:rejected(c,"UPDATE cp_a0_approval SET state='consumed',consumed_transaction_id='tp' WHERE approval_id='approval'"))
 record('approval_cross_project_transaction',lambda:rejected(c,"INSERT INTO cp_a0_prepared_authorization VALUES('p','run','tq','approval',?)",(H,)))
 c.execute("INSERT INTO cp_a0_prepared_authorization VALUES('p','run','tp','approval',?)",(H,));c.commit()
 record('transaction_requires_consumption',lambda:rejected(c,"UPDATE project_transaction SET state='committed' WHERE transaction_id='tp'"))
 def boundary():
  c.rollback();c.execute('BEGIN IMMEDIATE');c.execute("UPDATE cp_a0_approval SET state='consumed',consumed_transaction_id='tp' WHERE approval_id='approval'");c.rollback()
  assert c.execute("SELECT state FROM cp_a0_approval WHERE approval_id='approval'").fetchone()[0]=='active'
  c.execute('BEGIN IMMEDIATE');c.execute("UPDATE cp_a0_approval SET state='consumed',consumed_transaction_id='tp' WHERE approval_id='approval'")
  c.execute("UPDATE project_state SET revision=revision+1 WHERE project_id='p' AND revision=0")
  c.execute("INSERT INTO active_commit VALUES('p',1,'sp',?,'openfilm','tp','t')",(H,))
  c.execute("INSERT INTO outbox(topic,project_id,payload_json,created_at) VALUES('project.committed','p','{}','t')")
  c.execute("UPDATE project_transaction SET state='committed' WHERE transaction_id='tp'");c.commit()
  assert c.execute("SELECT revision FROM active_commit WHERE project_id='p'").fetchone()[0]==1
 record('fixture_atomic_consumption_pointer_outbox_rollback_and_commit',boundary)
 record('approval_terminal_immutable',lambda:rejected(c,"UPDATE cp_a0_approval SET state='active',consumed_transaction_id=NULL"))
 c.execute("INSERT INTO cp_a0_bootstrap_command VALUES('cmd','u','project.create','key',?,'new','reserved',NULL)",(H,))
 record('bootstrap_unique_idempotency',lambda:rejected(c,"INSERT INTO cp_a0_bootstrap_command VALUES('cmd2','u','project.create','key',?,'new2','reserved',NULL)",('b'*64,)))
 record('origin_cross_snapshot',lambda:rejected(c,"INSERT INTO cp_a0_project_origin VALUES('p','created','cmd','intake-trusted',?,'sq','tp','project/p')",(H,)))
 record('native_cross_scope',lambda:rejected(c,"INSERT INTO cp_a0_native_ack VALUES('p','editor',1,0,'sq',?,'t')",(H,)))
 c.execute("INSERT INTO cp_a0_step_attempt VALUES('p','run',1,?,'step',1,'grant',?,'[]','running','jp',NULL,NULL,'t')",(H,H))
 record('one_current_attempt',lambda:rejected(c,"INSERT INTO cp_a0_step_attempt VALUES('p','run',1,?,'step',2,'grant',?,'[]','pending','jp',NULL,NULL,'t')",(H,H)))
 record('attempt_cross_job',lambda:rejected(c,"INSERT INTO cp_a0_step_attempt VALUES('p','run',1,?,'other',1,'grant',?,'[]','pending','jq',NULL,NULL,'t')",(H,H)))
 render="INSERT INTO cp_a0_render_attempt VALUES('p','run','render',1,?,'sp',?,'{}','jp','staging/uuid',?,1,1,1,?,1)"
 record('ready_requires_qc',lambda:rejected(c,render,(H,H,'ready','block')))
 c.execute(render,(H,H,'qc','pending'))
 c.execute("INSERT INTO cp_a0_event VALUES('p',1,'run',?,'host',?,'t')",(H,H))
 delivery="INSERT INTO cp_a0_delivery VALUES('delivery','p','run','render',1,'sp',?,?,'{}','delivery/uuid',1,'t')"
 record('delivery_before_ready_rejected',lambda:rejected(c,delivery,(H,H)))
 c.execute("UPDATE cp_a0_render_attempt SET state='ready',qc='pass' WHERE render_id='render'");c.execute(delivery,(H,H))
 record('delivery_duplicate_rejected',lambda:rejected(c,delivery,(H,H)))
 def wire_mapping():
  refs=json.loads((HERE/'contract-vectors.json').read_text())['referenceVectors']
  scope=refs['runScope']['value']; fixed=refs['fixedPlan']; sd=refs['runScope']['sha256']
  canonical=json.dumps(scope,sort_keys=True,separators=(',',':'),ensure_ascii=False)
  assert hashlib.sha256(canonical.encode()).hexdigest()==sd
  assert c.execute("SELECT execution_digest FROM cp_a0_template_version").fetchone()[0]==fixed['sha256']==scope['execution_digest']
  project=scope['project_id']; run=scope['run_id']; plan=scope['plan_version']
  c.execute("INSERT INTO project_state(project_id,revision,updated_at) VALUES(?,0,'wire')",(project,))
  c.execute("INSERT INTO cp_a0_run VALUES(?,?,?,?,?,?,'ready',?,'{}','wire')",(project,run,sd,scope['template_id'],scope['template_version'],plan,canonical))
  c.execute("INSERT INTO cp_a0_plan_version VALUES(?,?,?,?,? ,?,'wire')",(project,run,plan,sd,scope['input_digest'],fixed['canonical']))
  assert c.execute("SELECT run_scope_digest,input_digest FROM cp_a0_plan_version WHERE project_id=? AND run_id=?",(project,run)).fetchone()==(sd,scope['input_digest'])
  rejected(c,"INSERT INTO cp_a0_plan_version VALUES(?,?,?,?,? ,?,'wire')",(project,run,2,sd,scope['input_digest'],fixed['canonical']))
  rejected(c,"INSERT INTO cp_a0_plan_version VALUES(?,?,?,?,? ,?,'wire')",('q',run,1,sd,scope['input_digest'],fixed['canonical']))
  changed=dict(scope,project_id='different-project');changed_digest=hashlib.sha256(json.dumps(changed,sort_keys=True,separators=(',',':')).encode()).hexdigest();assert changed_digest!=sd
 record('actual_wire_RunScope_fixedPlan_to_SQL_and_scope_plan_rejections',wire_mapping)
 record('grant_binding_immutable',lambda:rejected(c,"UPDATE cp_a0_execution_grant SET principal_id='other'"))
 record('step_input_immutable',lambda:rejected(c,"UPDATE cp_a0_step_attempt SET input_digest=? WHERE step_id='step'",('b'*64,)))
 record('ready_render_terminal',lambda:rejected(c,"UPDATE cp_a0_render_attempt SET state='qc' WHERE render_id='render'"))
 record('run_scope_immutable',lambda:rejected(c,"UPDATE cp_a0_run SET scope_json='[]' WHERE project_id='p'"))
 def qa_versions():
  c.execute("INSERT INTO cp_a0_question_version VALUES('intake',1,?,'topic',1,'text',0,'{}','t')",(H,))
  c.execute("INSERT INTO cp_a0_answer_version VALUES('intake',1,'topic',1,'answer-1',1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','user','driver_relay','content_only',0,'{}','t')")
  c.execute("INSERT INTO cp_a0_question_head VALUES('intake',1,'topic',1)")
  c.execute("INSERT INTO cp_a0_answer_head VALUES('intake',1,'topic',1,1)")
  rejected(c,"INSERT INTO cp_a0_question_version VALUES('intake',1,?,'wrong-input',1,'text',0,'{}','t')",('b'*64,))
  rejected(c,"INSERT INTO cp_a0_answer_version VALUES('intake',1,'topic',1,'answer-2',2,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','user','driver_relay','trusted_approval',0,'{}','t')")
  rejected(c,"INSERT INTO cp_a0_answer_version VALUES('intake',1,'topic',1,'answer-2',2,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','user','driver_relay','content_only',1,'{}','t')")
  rejected(c,"INSERT INTO cp_a0_answer_version VALUES('intake',1,'topic',2,'answer-1',1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','user','driver_relay','content_only',0,'{}','t')")
  rejected(c,"UPDATE cp_a0_answer_version SET answer_json='[]'")
  c.execute("INSERT INTO cp_a0_answer_version VALUES('intake',1,'topic',1,'answer-2',2,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','user','trusted_ui','content_only',0,'{}','t')")
  assert c.execute("UPDATE cp_a0_answer_head SET current_answer_version=2 WHERE intake_id='intake' AND intake_version=1 AND question_id='topic' AND question_version=1 AND current_answer_version=1").rowcount==1
  assert c.execute("UPDATE cp_a0_answer_head SET current_answer_version=2 WHERE intake_id='intake' AND intake_version=1 AND question_id='topic' AND question_version=1 AND current_answer_version=1").rowcount==0
  c.execute("INSERT INTO cp_a0_intake_version VALUES('intake',2,'user',?,'{}','t')",('b'*64,))
  rejected(c,"INSERT INTO cp_a0_answer_version VALUES('intake',2,'topic',1,'answer-1',1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','user','driver_relay','content_only',0,'{}','t')")
 record('question_answer_exact_versions_skip_content_authority_CAS_stale_intake',qa_versions)
 def wire_qa_mapping():
  vectors=json.loads((HERE/'contract-vectors.json').read_text())['vectors']
  q=next(x['value'] for x in vectors if x['id']=='definition:Question:valid')
  a=dict(next(x['value'] for x in vectors if x['id']=='definition:QuestionAnswer:valid'),supersedes_answer_id=None)
  c.execute("INSERT INTO cp_a0_intake_version VALUES(?,?,'user',?,'{}','wire')",(q['intake_id'],q['intake_version'],q['input_digest']))
  c.execute("INSERT INTO cp_a0_question_version VALUES(?,?,?,?,?,?,?,?, 'wire')",(q['intake_id'],q['intake_version'],q['input_digest'],q['question_id'],q['version'],q['kind'],int(q['skip_allowed']),json.dumps(q)))
  values=(a['intake_id'],a['intake_version'],a['question_id'],a['question_version'],a['answer_id'],a['version'],a['input_digest'],'user',a['source'],a['authority'],int(a['action']=='skip'),json.dumps(a),a['recorded_at'])
  c.execute("INSERT INTO cp_a0_answer_version VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",values)
  row=c.execute("SELECT answer_json FROM cp_a0_answer_version WHERE answer_id=? AND answer_version=?",(a['answer_id'],a['version'])).fetchone()
  assert json.loads(row[0])==a
  bad=list(values);bad[6]='b'*64;bad[4]='wrong-input-answer';rejected(c,"INSERT INTO cp_a0_answer_version VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",bad)
 record('actual_wire_question_answer_to_SQL_roundtrip_wrong_input_rejected',wire_qa_mapping)
 def answer_closure_transaction():
  def closure():
   rows=c.execute("SELECT q.question_id,q.current_question_version,a.answer_id,a.answer_version FROM cp_a0_question_head q LEFT JOIN cp_a0_answer_head h ON h.intake_id=q.intake_id AND h.intake_version=q.intake_version AND h.question_id=q.question_id AND h.question_version=q.current_question_version LEFT JOIN cp_a0_answer_version a ON a.intake_id=h.intake_id AND a.intake_version=h.intake_version AND a.question_id=h.question_id AND a.question_version=h.question_version AND a.answer_version=h.current_answer_version WHERE q.intake_id='intake' AND q.intake_version=1 ORDER BY q.question_id").fetchall()
   value={'intake_id':'intake','intake_version':1,'brief_sha256':H,'questions':[{'question_id':x[0],'question_version':x[1],'answer':None if x[2] is None else {'answer_id':x[2],'answer_version':x[3]}} for x in rows]}
   return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  c.commit(); old_digest=closure(); intake_rows=c.execute("SELECT * FROM cp_a0_intake_version WHERE intake_id='intake'").fetchall(); event_count=c.execute('SELECT count(*) FROM outbox').fetchone()[0]
  def append():
   c.execute("INSERT INTO cp_a0_answer_version VALUES('intake',1,'topic',1,'answer-3',3,?,'user','driver_relay','content_only',0,'{}','t')",(H,))
   assert c.execute("UPDATE cp_a0_answer_head SET current_answer_version=3 WHERE intake_id='intake' AND intake_version=1 AND question_id='topic' AND question_version=1 AND current_answer_version=2").rowcount==1
   c.execute("INSERT INTO outbox(topic,project_id,payload_json,created_at) VALUES('creative.input.invalidated','',?,'t')",(json.dumps({'intake_id':'intake','intake_version':1,'old_input_digest':old_digest,'new_input_digest':closure(),'dependent_decisions':'stale_for_new_run'}),))
  c.execute('BEGIN IMMEDIATE');append();assert closure()!=old_digest;c.rollback()
  assert closure()==old_digest and c.execute('SELECT count(*) FROM outbox').fetchone()[0]==event_count
  c.execute('BEGIN IMMEDIATE');append();c.commit()
  assert closure()!=old_digest and c.execute('SELECT count(*) FROM outbox').fetchone()[0]==event_count+1
  assert c.execute("SELECT * FROM cp_a0_intake_version WHERE intake_id='intake'").fetchall()==intake_rows
  # Fixture-level run-prepare oracle: compare server-recomputed actual heads, never Brief hash alone.
  def can_prepare(decision_input_digest): return decision_input_digest==closure()
  assert not can_prepare(old_digest) and can_prepare(closure())
 record('answer_change_same_intake_closure_invalidation_outbox_atomic_fixture',answer_closure_transaction)
 def golden_content_closure():
  v=json.loads((HERE/'contract-vectors.json').read_text())['referenceVectors']['creativeInput']
  for key in ['brief','initialAnswer','changedAnswer']:
   ref=v[key];encoded=json.dumps(ref['value'],sort_keys=True,separators=(',',':'),ensure_ascii=False)
   assert encoded==ref['canonical'] and hashlib.sha256(encoded.encode()).hexdigest()==ref['sha256']
  q=v['question']; scope=v['initialAnswer']['value']; brief_hash=v['brief']['sha256']; intake=scope['intake_id']
  c.execute("INSERT INTO cp_a0_intake_version VALUES(?,1,'user',?,?,'golden')",(intake,brief_hash,v['brief']['canonical']))
  for binding in scope['questions']:
   typed=q if binding['question_id']==q['question_id'] else v['unansweredQuestion']
   assert typed['input_digest']==brief_hash and typed['question_id']==binding['question_id'] and typed['version']==binding['question_version']
   c.execute("INSERT INTO cp_a0_question_version VALUES(?,1,?,?,?,?,?,?,'golden')",(intake,brief_hash,typed['question_id'],typed['version'],typed['kind'],int(typed['skip_allowed']),json.dumps(typed,ensure_ascii=False)))
   c.execute("INSERT INTO cp_a0_question_head VALUES(?,1,?,?)",(intake,typed['question_id'],typed['version']))
  def digest_from_heads():
   rows=c.execute("SELECT q.question_id,q.current_question_version,a.answer_id,a.answer_version FROM cp_a0_question_head q LEFT JOIN cp_a0_answer_head h ON h.intake_id=q.intake_id AND h.intake_version=q.intake_version AND h.question_id=q.question_id AND h.question_version=q.current_question_version LEFT JOIN cp_a0_answer_version a ON a.intake_id=h.intake_id AND a.intake_version=h.intake_version AND a.question_id=h.question_id AND a.question_version=h.question_version AND a.answer_version=h.current_answer_version WHERE q.intake_id=? AND q.intake_version=1 ORDER BY q.question_id",(intake,)).fetchall()
   closure={'intake_id':intake,'intake_version':1,'brief_sha256':brief_hash,'questions':[{'question_id':x[0],'question_version':x[1],'answer':None if x[2] is None else {'answer_id':x[2],'answer_version':x[3]}} for x in rows]}
   return hashlib.sha256(json.dumps(closure,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
  for index,key in enumerate(['firstAnswer','secondAnswer'],1):
   a=v[key];c.execute("INSERT INTO cp_a0_answer_version VALUES(?,1,?,?,?,?,?,'user',?,'content_only',0,?,?)",(intake,a['question_id'],a['question_version'],a['answer_id'],a['version'],a['input_digest'],a['source'],json.dumps(a,ensure_ascii=False),a['recorded_at']))
   if index==1:c.execute("INSERT INTO cp_a0_answer_head VALUES(?,1,?,1,1)",(intake,a['question_id']))
   else:assert c.execute("UPDATE cp_a0_answer_head SET current_answer_version=2 WHERE intake_id=? AND intake_version=1 AND question_id=? AND question_version=1 AND current_answer_version=1",(intake,a['question_id'])).rowcount==1
   assert digest_from_heads()==v['initialAnswer' if index==1 else 'changedAnswer']['sha256']
  assert v['initialAnswer']['sha256']!=digest_from_heads()
  assert c.execute("SELECT count(*),max(version) FROM cp_a0_intake_version WHERE intake_id=?",(intake,)).fetchone()==(1,1)
 record('actual_golden_brief_question_answer_SQL_heads_exact_closure_hashes',golden_content_closure)
 record('foreign_key_check',lambda: (_ for _ in ()).throw(AssertionError('FK')) if c.execute('PRAGMA foreign_key_check').fetchall() else None)
 c.close()
report={'status':'PASS','scope':'isolated Python SQLite fixtures only; no Host/provider/services/production DB', 'sqlite_version':sqlite3.sqlite_version,'migration_sha256':hashlib.sha256(SQL.encode()).hexdigest(),'legacy_source_sha256':hashlib.sha256(SRC.encode()).hexdigest(),'cases':results,'production_integration':'NOT_RUN'}
(HERE/'sql-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':report['status'],'cases':len(results),'sqlite':sqlite3.sqlite_version}))
