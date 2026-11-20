import {it,expect} from 'vitest';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TaskPrepare} from '../../../src/contracts/agent-driven-types.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import type {ProductTransaction} from '../../../src/host/creative/product-repository.js';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {PersistentJobStore} from '../../../src/host/persistent-job-store.js';
import {CreatedTaskStore,type CreatedTaskPorts,type PreparedTaskFact,type TaskTransactionDb} from '../../../src/host/agent-driven/created-task-store.js';

/** Real SQLite/storage boundary tests only. Fixture callbacks are NOT owner/Run/rights/FS proof. */
const NOW=Date.parse('2026-11-10T00:00:00Z');
const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
const request=()=>structuredClone(vectors.vectors.find(v=>v.id==='definition:TaskPrepare:valid')!.value) as TaskPrepare;
const policy={job_kind:'snapshot_publish',max_attempts:7} as const;
function fixture(path?:string){
 const revisions=new RevisionStore(path);let clock=NOW;const proof={fixture_only:true};
 revisions.compose(db=>{
  db.exec('CREATE TABLE IF NOT EXISTS fixture_task_link(job_id TEXT PRIMARY KEY REFERENCES job(job_id),tag TEXT NOT NULL); CREATE TABLE IF NOT EXISTS fixture_task_gate(project_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,source_digest TEXT NOT NULL,active INTEGER NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO fixture_task_gate(project_id,principal_id,source_digest,active) VALUES(?,?,?,1)').run(request().project_id,'owner',request().source_digest);
 });
 const ports:CreatedTaskPorts={
  assertAllowed:(db,context)=>{
   const gate=db.prepare('SELECT principal_id,source_digest,active FROM fixture_task_gate WHERE project_id=?').get(context.request.project_id);
   if(!gate||gate.principal_id!==context.principal_id||gate.source_digest!==context.request.source_digest||gate.active!==1)throw Error('fixture SQL gate denied');
  },
  bindStep:(db,{task})=>{db.prepare('INSERT INTO fixture_task_link(job_id,tag) VALUES(?,?)').run(task.job_id,'fixture SQL hook only');},
  assertPrepared:(_db,context)=>{if(context.proof!==proof)throw Error('fixture proof mismatch');},
 };
 const store=new CreatedTaskStore(revisions,ports,()=>new Date(clock));const jobs=new PersistentJobStore(revisions);
 const count=(table:string)=>revisions.compose(db=>Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n));
 return {revisions,ports,store,jobs,proof,count,setClock:(value:number)=>{clock=value;},close:()=>revisions.close()};
}
function fact(stage_token:string):PreparedTaskFact{return {format:'narralens.created-task-prepared@1',stage_token,source_digest:'b'.repeat(64),plan_digest:'c'.repeat(64),rights_digest:'d'.repeat(64),files:[{relative_path:'film.html',bytes:1,sha256:'e'.repeat(64)}],roots:['film.html']};}
function running(f:ReturnType<typeof fixture>){const result=f.store.reserve(request(),'owner',policy);expect(f.jobs.acquireLease(result.task.job_id,{owner:'worker',leaseMs:1000,now:new Date(NOW)})).toBe(true);return result.task;}
function empty(f:ReturnType<typeof fixture>){for(const name of ['job','job_event','outbox','operation_idempotency','created_task_input','created_task_prepared','fixture_task_link'])expect(f.count(name),name).toBe(0);}

it('commits one existing job, original ledger/input, synchronous link, event and outbox on the real same connection',()=>{
 const f=fixture();try{
  const {task,replayed}=f.store.reserve(request(),'owner',policy);expect(replayed).toBe(false);
  for(const table of ['job','job_event','outbox','operation_idempotency','created_task_input','fixture_task_link'])expect(f.count(table),table).toBe(1);
  expect(f.revisions.readJob(task.job_id)?.max_attempts).toBe(7);expect(task.stage_token).toMatch(/^stage_[A-Za-z0-9_-]{32}$/);expect(task.accepted.execution).toEqual(request().execution);
  expect(f.store.read(task.job_id,'owner')).toEqual(task);expect(()=>f.store.read(task.job_id,'foreign')).toThrow();
 }finally{f.close();}
});
it('replays the original accepted receipt after real job success and correlation change, with no duplicate effects',()=>{
 const f=fixture();try{
  const task=running(f);f.jobs.recordCallback(task.job_id,{owner:'worker',attempt:1},{state:'succeeded'},new Date(NOW));
  const changed=request();changed.meta.correlation_id='another-correlation';const result=f.store.reserve(changed,'owner',policy);
  expect(result.replayed).toBe(true);expect(result.task.accepted).toEqual(task.accepted);expect(result.task.accepted.state).toBe('queued');expect(f.revisions.readJob(task.job_id)?.state).toBe('succeeded');expect(f.count('created_task_input')).toBe(1);
 }finally{f.close();}
});
it('checks access before replay and rejects different key payload/principal or duplicate execution job',()=>{
 const f=fixture();try{
  f.store.reserve(request(),'owner',policy);
  const other=request();other.base_revision=1;expect(()=>f.store.reserve(other,'owner',policy)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
  expect(()=>f.store.reserve(request(),'another-owner',policy)).toThrow();
  const newKey=request();newKey.meta.idempotency_key='another-key';expect(()=>f.store.reserve(newKey,'owner',policy)).toThrow();
  f.ports.assertAllowed=()=>{throw Error('fixture access revoked');};expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('fixture access revoked');
  expect(f.count('job')).toBe(1);expect(f.count('operation_idempotency')).toBe(1);
 }finally{f.close();}
});
it('permits a distinct execution-attempt storage identity under fixture authority without duplicate jobs',()=>{
 const f=fixture();try{
  const first=f.store.reserve(request(),'owner',policy).task;const next=request();next.meta.idempotency_key='attempt2';next.execution.attempt=2;
  const second=f.store.reserve(next,'owner',policy).task;expect(second.job_id).not.toBe(first.job_id);expect(f.count('job')).toBe(2);expect(f.count('created_task_input')).toBe(2);
 }finally{f.close();}
});
it('reads a real same-DB fixture gate before any write/replay and accepts again only after that row is restored',()=>{
 const f=fixture();try{
  f.revisions.compose(db=>db.prepare('UPDATE fixture_task_gate SET active=0').run());
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('fixture SQL gate denied');empty(f);
  f.revisions.compose(db=>db.prepare('UPDATE fixture_task_gate SET active=1').run());
  const accepted=f.store.reserve(request(),'owner',policy).task;
  f.revisions.compose(db=>db.prepare('UPDATE fixture_task_gate SET active=0').run());
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('fixture SQL gate denied');expect(f.count('job')).toBe(1);
  f.revisions.compose(db=>db.prepare('UPDATE fixture_task_gate SET active=1').run());
  expect(f.store.reserve(request(),'owner',policy).task.accepted).toEqual(accepted.accepted);
 }finally{f.close();}
});
it('rolls back job/input/fixture link and all effects on synchronous hook failure',()=>{
 const f=fixture();try{
  f.ports.bindStep=(db,{task})=>{db.prepare('INSERT INTO fixture_task_link(job_id,tag) VALUES(?,?)').run(task.job_id,'before error');throw Error('injected');};
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('injected');empty(f);
 }finally{f.close();}
});
it('rolls back all already-written effects when final same-transaction authorization fails',()=>{
 const f=fixture();try{
  f.ports.assertAllowed=(_db,context)=>{if(context.phase==='final_reserve')throw Error('final authorization revoked');};
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('final authorization revoked');empty(f);
 }finally{f.close();}
});
it('poisons a swallowed SQL hook failure so an outer transaction cannot partially commit',()=>{
 const f=fixture();try{
  const allowed=f.ports.assertAllowed;
  f.ports.assertAllowed=(db,context)=>{allowed(db,context);if(context.phase==='final_reserve'){try{db.prepare("INSERT INTO fixture_task_link(job_id,tag) VALUES('missing-job','must fail FK')").run();}catch{/* deliberately swallowed AFTER all reserve effects */}}};
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow();empty(f);
 }finally{f.close();}
});
it('rejects thenable hooks, rolls back, and revokes escaped SQL methods before delayed continuation',async()=>{
 const f=fixture();let escaped:TaskTransactionDb|undefined;
 try{
  f.ports.bindStep=async db=>{escaped=db;await Promise.resolve();db.prepare("INSERT INTO fixture_task_link(job_id,tag) VALUES('late','late')").run();};
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('Async SQL hooks');await Promise.resolve();await Promise.resolve();
  empty(f);expect(()=>escaped!.prepare('SELECT 1').get()).toThrow('lifetime ended');
 }finally{f.close();}
});
it('requires explicit policy instead of inventing attempts or a legacy task kind',()=>{
 const f=fixture();try{expect(()=>f.store.reserve(request(),'owner',{job_kind:'snapshot_publish',max_attempts:0})).toThrow();empty(f);}finally{f.close();}
});
it('persists immutable input and server-selected opaque token over a real close/reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'created-task-store-')),path=join(dir,'main.sqlite');let f=fixture(path);
 try{const first=f.store.reserve(request(),'owner',policy).task;f.close();f=fixture(path);const again=f.store.reserve(request(),'owner',policy);expect(again.replayed).toBe(true);expect(again.task.stage_token).toBe(first.stage_token);expect(again.task.accepted).toEqual(first.accepted);}finally{f.close();rmSync(dir,{recursive:true,force:true});}
});
it('records only a prepared fact under the real lease and never completes the existing job',()=>{
 const f=fixture();try{
  const task=running(f),value=fact(task.stage_token);expect(f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},value,f.proof)).toEqual(value);
  expect(f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},value,f.proof)).toEqual(value);expect(f.count('created_task_prepared')).toBe(1);expect(f.count('outbox')).toBe(2);
  expect(f.revisions.readJob(task.job_id)?.state).toBe('running');expect(f.store.readPrepared(task.job_id,'owner')).toEqual(value);
  expect(()=>f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},{...value,rights_digest:'f'.repeat(64)},f.proof)).toThrow('Immutable prepared');
 }finally{f.close();}
});
it.each(['owner','attempt','expiry','cancel','terminal'] as const)('rejects %s late worker facts without inserting a prepared result',mode=>{
 const f=fixture();try{
  const task=running(f);let owner='worker',attempt=1;
  if(mode==='owner')owner='foreign';if(mode==='attempt')attempt=2;if(mode==='expiry')f.setClock(NOW+1000);
  if(mode==='cancel')f.jobs.requestCancel(task.job_id,new Date(NOW));if(mode==='terminal')f.jobs.recordCallback(task.job_id,{owner:'worker',attempt:1},{state:'succeeded'},new Date(NOW));
  expect(()=>f.store.recordPrepared(task.job_id,{owner,attempt},fact(task.stage_token),f.proof)).toThrow();expect(f.count('created_task_prepared')).toBe(0);
 }finally{f.close();}
});
it('uses actual lease CAS and reclaim: old worker facts stay late while the newly leased worker can record',()=>{
 const f=fixture();try{
  const task=running(f);
  expect(f.jobs.acquireLease(task.job_id,{owner:'replacement',leaseMs:1000,now:new Date(NOW)})).toBe(false);
  f.jobs.reapExpiredLeases(new Date(NOW+1001));f.setClock(NOW+1001);
  expect(f.jobs.acquireLease(task.job_id,{owner:'replacement',leaseMs:1000,now:new Date(NOW+1001)})).toBe(true);
  expect(f.revisions.readJob(task.job_id)?.attempt).toBe(2);
  expect(()=>f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},fact(task.stage_token),f.proof)).toThrow();expect(f.count('created_task_prepared')).toBe(0);
  expect(f.store.recordPrepared(task.job_id,{owner:'replacement',attempt:2},fact(task.stage_token),f.proof)).toEqual(fact(task.stage_token));
 }finally{f.close();}
});
it('rejects a wrong Host proof/token and rolls back if the lease expires at the final proof boundary',()=>{
 const f=fixture();try{
  const task=running(f);expect(()=>f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},fact(task.stage_token),{})).toThrow();
  expect(()=>f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},fact('stage_'+'x'.repeat(32)),f.proof)).toThrow();
  let calls=0;f.ports.assertPrepared=()=>{if(++calls===2)f.setClock(NOW+1001);};
  expect(()=>f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},fact(task.stage_token),f.proof)).toThrow();expect(f.count('created_task_prepared')).toBe(0);expect(f.count('outbox')).toBe(1);
 }finally{f.close();}
});
it('rejects absolute/traversing/aliased closure facts and disallows mutation of recorded facts',()=>{
 const f=fixture();try{
  const task=running(f),value=fact(task.stage_token);
  for(const path of ['/tmp/private','../private','a/../private','http://host/file'])expect(()=>f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},{...value,files:[{...value.files[0]!,relative_path:path}],roots:[path]},f.proof)).toThrow();
  expect(()=>f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},{...value,files:[...value.files,{...value.files[0]!,relative_path:'FILM.html'}]},f.proof)).toThrow();
  f.store.recordPrepared(task.job_id,{owner:'worker',attempt:1},value,f.proof);
  expect(()=>f.revisions.compose(db=>db.prepare("UPDATE created_task_prepared SET fact_digest='bad'").run())).toThrow('immutable');
 }finally{f.close();}
});
it('rejects runtime namespace tampering rather than silently recreating an immutable trigger',()=>{
 const f=fixture();try{f.revisions.compose(db=>db.exec('DROP TRIGGER created_task_input_no_update'));expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('schema differs');expect(f.count('job')).toBe(0);}finally{f.close();}
});

// Actual composition seam: original product adapter participates without nested BEGIN.
it('joins the live same-connection product transaction and atomically mirrors a product event',()=>{
 const f=fixture(),repo=new ProductSqliteRepository(f.revisions);let escaped:TaskTransactionDb|undefined,txAfter:ProductTransaction|undefined;
 try{
  const bind=f.ports.bindStep;
  f.ports.bindStep=(db,ctx)=>{bind(db,ctx);escaped=db;repo.joinTaskTransaction(db,tx=>{txAfter=tx;tx.emit({topic:'creative.artifact.versioned',source:'worker',scope:{kind:'project',project_id:ctx.task.request.project_id},entity:{type:'task',id:ctx.task.job_id,version:1,state:'queued'},attempt:1,input_digest:ctx.task.request_digest,observed_at:ctx.now.toISOString(),payload:{}});});};
  f.store.reserve(request(),'owner',policy);expect(f.count('job')).toBe(1);expect(f.count('outbox')).toBe(2);
  expect(()=>repo.joinTaskTransaction(escaped!,()=>{})).toThrow();expect(()=>txAfter!.list('run',{project_id:request().project_id})).toThrow();
 }finally{f.close();}
});
it('poisons the task reservation if a joined product callback fails even when the hook swallows it',()=>{
 const f=fixture(),repo=new ProductSqliteRepository(f.revisions);
 try{
  const bind=f.ports.bindStep;
  f.ports.bindStep=(db,ctx)=>{bind(db,ctx);try{repo.joinTaskTransaction(db,tx=>{tx.emit({topic:'creative.artifact.versioned',source:'worker',scope:{kind:'project',project_id:ctx.task.request.project_id},entity:{type:'task',id:ctx.task.job_id,version:1,state:'queued'},attempt:1,input_digest:ctx.task.request_digest,observed_at:ctx.now.toISOString(),payload:{}});throw Error('joined work failed');});}catch{}};
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('joined work failed');empty(f);
 }finally{f.close();}
});
it('rejects a foreign connection and forged SQL capability without treating it as a joined transaction',()=>{
 const f=fixture(),other=new RevisionStore(),foreign=new ProductSqliteRepository(other),repo=new ProductSqliteRepository(f.revisions);
 try{
  f.ports.bindStep=(db)=>{expect(()=>foreign.joinTaskTransaction(db,()=>{})).toThrow();expect(()=>repo.joinTaskTransaction({within:work=>work(),prepare:sql=>db.prepare(sql)},()=>{})).toThrow();};
  f.store.reserve(request(),'owner',policy);expect(f.count('job')).toBe(1);
 }finally{other.close();f.close();}
});
it('rolls back joined async work and rejects product continuation after its synchronous scope ends',async()=>{
 const f=fixture(),repo=new ProductSqliteRepository(f.revisions);let leaked:ProductTransaction|undefined;
 try{
  f.ports.bindStep=(db)=>{repo.joinTaskTransaction(db,async tx=>{leaked=tx;await Promise.resolve();tx.list('run',{project_id:request().project_id});});};
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow();await Promise.resolve();await Promise.resolve();empty(f);expect(()=>leaked!.list('run',{project_id:request().project_id})).toThrow();
 }finally{f.close();}
});
it('rejects ignored async-within before partial task or SQL-prefix effects can commit',async()=>{
 const f=fixture();
 try{
  f.ports.bindStep=(db,{task})=>{void db.within(async()=>{db.prepare('INSERT INTO fixture_task_link(job_id,tag) VALUES(?,?)').run(task.job_id,'prefix before await');await Promise.resolve();db.prepare('SELECT 1').get();});};
  expect(()=>f.store.reserve(request(),'owner',policy)).toThrow('Async SQL hooks');empty(f);await Promise.resolve();await Promise.resolve();empty(f);
 }finally{f.close();}
});
it('settles an actually prepared fact and product-side row with the original job in one transaction',()=>{
 const f=fixture();try{
  const task=running(f),lease={owner:'worker',attempt:1},value=fact(task.stage_token);f.store.recordPrepared(task.job_id,lease,value,f.proof);
  f.store.finishPrepared(task.job_id,lease,f.proof,(rows,t,actual)=>{expect(t).toEqual(task);expect(actual).toEqual(value);rows.prepare("UPDATE fixture_task_link SET tag='prepared for review' WHERE job_id=?").run(t.job_id);});
  expect(f.revisions.readJob(task.job_id)).toMatchObject({state:'succeeded',lease_owner:null});expect(f.store.receipt(task.job_id,'owner')).toMatchObject({state:'succeeded',attempt:1,result_ref:null,next_actions:['review_prepared_source']});expect(f.store.preparedLeaseAttempt(task.job_id,'owner')).toBe(1);
 }finally{f.close();}
});
it('rolls back settlement/checkpoint-side writes and job state when completion fails after a prepared fact exists',()=>{
 const f=fixture();try{
  const task=running(f),lease={owner:'worker',attempt:1},value=fact(task.stage_token);f.store.recordPrepared(task.job_id,lease,value,f.proof);
  expect(()=>f.store.finishPrepared(task.job_id,lease,f.proof,rows=>{rows.prepare("UPDATE fixture_task_link SET tag='must rollback' WHERE job_id=?").run(task.job_id);throw Error('completion boundary');})).toThrow('completion boundary');
  expect(f.revisions.readJob(task.job_id)?.state).toBe('running');expect(f.revisions.compose(db=>db.prepare('SELECT tag FROM fixture_task_link WHERE job_id=?').get(task.job_id)?.tag)).toBe('fixture SQL hook only');expect(f.store.readPrepared(task.job_id,'owner')).toEqual(value);
 }finally{f.close();}
});
it('keeps cancelled work cancelled during failure settlement and refuses stale-lease failure writes',()=>{
 const f=fixture();try{
  const task=running(f),lease={owner:'worker',attempt:1};f.jobs.requestCancel(task.job_id,new Date(NOW));
  expect(f.store.finishFailed(task.job_id,{owner:'foreign',attempt:1},'INVALID_DRAFT',()=>{throw Error('not called');})).toBe(false);
  expect(f.store.finishFailed(task.job_id,lease,'INVALID_DRAFT',(rows,_t,state)=>{expect(state).toBe('cancelled');rows.prepare("UPDATE fixture_task_link SET tag='cancelled' WHERE job_id=?").run(task.job_id);})).toBe(true);
  expect(f.revisions.readJob(task.job_id)).toMatchObject({state:'cancelled',lease_owner:null});
 }finally{f.close();}
});
it('guards synchronous worker composition and rejects an ignored asynchronous continuation atomically',async()=>{
 const f=fixture();try{
  const task=running(f),lease={owner:'worker',attempt:1};
  expect(()=>f.store.withRunningTask(task.job_id,lease,async rows=>{rows.prepare("UPDATE fixture_task_link SET tag='must rollback' WHERE job_id=?").run(task.job_id);await Promise.resolve();rows.prepare('SELECT 1').get();})).toThrow('Async SQL hooks');
  await Promise.resolve();await Promise.resolve();expect(f.revisions.compose(db=>db.prepare('SELECT tag FROM fixture_task_link WHERE job_id=?').get(task.job_id)?.tag)).toBe('fixture SQL hook only');
 }finally{f.close();}
});
it.each(['requeue','exhausted','cancel-expired','cancel-queued'] as const)('recovers %s with synchronous workflow-side effects in the same original DB',mode=>{
 const f=fixture();try{
  const task=f.store.reserve(request(),'owner',{...policy,max_attempts:mode==='exhausted'?1:7}).task;
  if(mode!=='cancel-queued')f.jobs.acquireLease(task.job_id,{owner:'worker',leaseMs:1000,now:new Date(NOW)});
  if(mode.startsWith('cancel'))f.jobs.requestCancel(task.job_id,new Date(NOW));f.setClock(NOW+1000);
  let state='';const recover=()=>f.store.reapExpired((rows,t,next)=>{state=next;rows.prepare('UPDATE fixture_task_link SET tag=? WHERE job_id=?').run(next,t.job_id);});
  expect(recover()).toBe(1);expect(state).toBe(mode==='requeue'?'pending':mode==='exhausted'?'failed':'cancelled');
  expect(f.revisions.readJob(task.job_id)).toMatchObject({state:mode==='requeue'?'queued':mode==='exhausted'?'attention':'cancelled',lease_owner:null});
  const events=f.count('job_event');expect(recover()).toBe(0);expect(f.count('job_event')).toBe(events);
 }finally{f.close();}
});
it('rolls back expired-job recovery as well as workflow-side SQL when the recovery hook fails',()=>{
 const f=fixture();try{
  const task=running(f);f.setClock(NOW+1000);const before=f.revisions.readJob(task.job_id),events=f.count('job_event');
  expect(()=>f.store.reapExpired((rows,t)=>{rows.prepare("UPDATE fixture_task_link SET tag='must rollback' WHERE job_id=?").run(t.job_id);throw Error('recovery boundary');})).toThrow('recovery boundary');
  expect(f.revisions.readJob(task.job_id)).toEqual(before);expect(f.count('job_event')).toBe(events);expect(f.revisions.compose(db=>db.prepare('SELECT tag FROM fixture_task_link WHERE job_id=?').get(task.job_id)?.tag)).toBe('fixture SQL hook only');
 }finally{f.close();}
});
it.each(['expiry','attempt','policy'] as const)('rechecks %s after a synchronous recoverable-retry hook and rolls back its prefix',mode=>{
 const f=fixture();try{
  const task=running(f),lease={owner:'worker',attempt:1},before=f.revisions.readJob(task.job_id),events=f.count('job_event');
  expect(()=>f.store.retryRecoverable(task.job_id,lease,(rows,t)=>{
   rows.prepare("UPDATE fixture_task_link SET tag='must rollback' WHERE job_id=?").run(t.job_id);
   if(mode==='expiry')f.setClock(NOW+1001);else if(mode==='attempt')rows.prepare('UPDATE job SET attempt=attempt+1 WHERE job_id=?').run(t.job_id);else rows.prepare('UPDATE job SET max_attempts=1 WHERE job_id=?').run(t.job_id);
  })).toThrow();
  expect(f.revisions.readJob(task.job_id)).toEqual(before);expect(f.count('job_event')).toBe(events);expect(f.revisions.compose(db=>db.prepare('SELECT tag FROM fixture_task_link WHERE job_id=?').get(task.job_id)?.tag)).toBe('fixture SQL hook only');
 }finally{f.close();}
});
it('never permits a recovery hook to consume or forge an additional lease attempt',()=>{
 const f=fixture();try{
  const task=running(f),before=f.revisions.readJob(task.job_id),events=f.count('job_event');f.setClock(NOW+1001);
  expect(()=>f.store.reapExpired((rows,t)=>{rows.prepare("UPDATE fixture_task_link SET tag='must rollback' WHERE job_id=?").run(t.job_id);rows.prepare('UPDATE job SET attempt=attempt+1 WHERE job_id=?').run(t.job_id);})).toThrow();
  expect(f.revisions.readJob(task.job_id)).toEqual(before);expect(f.count('job_event')).toBe(events);expect(f.revisions.compose(db=>db.prepare('SELECT tag FROM fixture_task_link WHERE job_id=?').get(task.job_id)?.tag)).toBe('fixture SQL hook only');
 }finally{f.close();}
});
