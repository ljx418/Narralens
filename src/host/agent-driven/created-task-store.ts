import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync, SQLInputValue } from 'node:sqlite';
import type { TaskPrepare, JobReceipt } from '../../contracts/agent-driven-types.js';
import { validateAgentDefinition } from '../../contracts/agent-driven-validator.js';
import { canonicalJson, canonicalDigest } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { OperationIdempotencyStore } from '../projects/operation-idempotency-store.js';
import { JOB_KINDS_V2 } from '../projects/job-kind-migration.js';
import type { JobKind } from '../job-defaults.js';
import { assertSafeRelativePath } from '../render/snapshot-copy.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';

/** PRIVATE CANDIDATE. Registration, Run authorization and filesystem proof stay with MAIN. */
export class CreatedTaskError extends Error {
  constructor(readonly code:'INVALID_REQUEST'|'REVISION_CONFLICT'|'IDEMPOTENCY_CONFLICT'|'NOT_FOUND'|'CAPABILITY_UNAVAILABLE', message:string){super(message);}
}
function fail(code:CreatedTaskError['code'],message:string):never {throw new CreatedTaskError(code,message);}
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HASH=/^[a-f0-9]{64}$/;
const TOKEN=/^stage_[A-Za-z0-9_-]{32}$/;
const OPERATION='agent.v1:task.prepare';
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
function frozen<T>(value:T):T {
  if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}
  return value;
}
function isObject(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function exact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
  if(!isObject(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail('INVALID_REQUEST','Unexpected prepared fact fields');
}
function digest(request:TaskPrepare,principal:string){const {meta:_meta,...facts}=request;return canonicalDigest({principal_id:principal,request:facts});}
function date(now:()=>Date):Date {const value=now();if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail('INVALID_REQUEST','Invalid Host clock');return value;}
export interface TaskPolicy {readonly job_kind:JobKind;readonly max_attempts:number;}
export interface TaskReservation {
  readonly job_id:string;readonly principal_id:string;readonly request:TaskPrepare;
  readonly request_digest:string;readonly stage_token:string;readonly accepted:JobReceipt;
  readonly job_kind:JobKind;readonly max_attempts:number;
}
export interface PreparedTaskFact {
  readonly format:'narralens.created-task-prepared@1';readonly stage_token:string;
  readonly source_digest:string;readonly plan_digest:string|null;readonly rights_digest:string;
  readonly files:readonly {readonly relative_path:string;readonly bytes:number;readonly sha256:string}[];
  readonly roots:readonly string[];
}
export interface TaskLease {readonly owner:string;readonly attempt:number;}
/** Revocable synchronous SQL capability over the SAME compose connection, never another DB.
 * Statements cannot escape this callback lifetime or asynchronously write after rollback. */
const liveTaskConnections=new WeakMap<object,DatabaseSync>();
/** Host-only provenance check; not mintable from a request or another connection. */
export function isCurrentTaskTransaction(rows:TaskTransactionDb,connection:DatabaseSync):boolean{return liveTaskConnections.get(rows)===connection;}
export interface TaskTransactionDb {within<T>(work:()=>T):T;prepare(sql:string):{get(...bindings:SQLInputValue[]):ReturnType<StatementSync['get']>;all(...bindings:SQLInputValue[]):ReturnType<StatementSync['all']>;run(...bindings:SQLInputValue[]):ReturnType<StatementSync['run']>};}
export interface TaskGuardContext {
  readonly request:TaskPrepare;readonly principal_id:string;readonly now:Date;
  readonly phase:'access'|'new_reserve'|'replay'|'final_reserve';readonly job_id:string|null;
}
export interface CreatedTaskPorts {
  assertAllowed(db:TaskTransactionDb,context:TaskGuardContext):void;
  bindStep(db:TaskTransactionDb,context:{readonly task:TaskReservation;readonly now:Date}):void;
  /** Must idempotently validate MAIN's nonforgeable verified-stage proof and current rights/scope.
   * Neither JSON facts nor the opaque token alone constitute filesystem proof. */
  assertPrepared(db:TaskTransactionDb,context:{readonly task:TaskReservation;readonly fact:PreparedTaskFact;readonly proof:unknown;readonly lease:TaskLease;readonly now:Date}):void;
}

export const CREATED_TASK_DDL=`
CREATE TABLE created_task_input (
 job_id TEXT PRIMARY KEY REFERENCES job(job_id),project_id TEXT NOT NULL,principal_id TEXT NOT NULL,
 run_id TEXT NOT NULL,plan_version INTEGER NOT NULL CHECK(plan_version=1),step_id TEXT NOT NULL,
 execution_attempt INTEGER NOT NULL CHECK(execution_attempt>=1),request_digest TEXT NOT NULL,
 request_json TEXT NOT NULL,stage_token TEXT NOT NULL UNIQUE,accepted_json TEXT NOT NULL,
 job_kind TEXT NOT NULL,max_attempts INTEGER NOT NULL CHECK(max_attempts>=1),created_at TEXT NOT NULL,
 UNIQUE(project_id,run_id,plan_version,step_id,execution_attempt)
);
CREATE TABLE created_task_prepared (
 job_id TEXT PRIMARY KEY REFERENCES created_task_input(job_id),stage_token TEXT NOT NULL,
 fact_json TEXT NOT NULL,fact_digest TEXT NOT NULL,lease_owner TEXT NOT NULL,
 lease_attempt INTEGER NOT NULL CHECK(lease_attempt>=1),prepared_at TEXT NOT NULL
);
CREATE TRIGGER created_task_input_no_update BEFORE UPDATE ON created_task_input BEGIN SELECT RAISE(ABORT,'immutable created task input'); END;
CREATE TRIGGER created_task_input_no_delete BEFORE DELETE ON created_task_input BEGIN SELECT RAISE(ABORT,'immutable created task input'); END;
CREATE TRIGGER created_task_prepared_no_update BEFORE UPDATE ON created_task_prepared BEGIN SELECT RAISE(ABORT,'immutable prepared task fact'); END;
CREATE TRIGGER created_task_prepared_no_delete BEFORE DELETE ON created_task_prepared BEGIN SELECT RAISE(ABORT,'immutable prepared task fact'); END;
`;

function prepared(raw:PreparedTaskFact):PreparedTaskFact {
  const value:unknown=structuredClone(raw);
  exact(value,['format','stage_token','source_digest','plan_digest','rights_digest','files','roots']);
  if(value.format!=='narralens.created-task-prepared@1'||typeof value.stage_token!=='string'||!TOKEN.test(value.stage_token)||typeof value.source_digest!=='string'||!HASH.test(value.source_digest)||typeof value.rights_digest!=='string'||!HASH.test(value.rights_digest)||value.plan_digest!==null&&(typeof value.plan_digest!=='string'||!HASH.test(value.plan_digest)))fail('INVALID_REQUEST','Invalid prepared digests');
  if(!Array.isArray(value.files)||!value.files.length||!Array.isArray(value.roots)||!value.roots.length)fail('INVALID_REQUEST','Prepared closure must contain files and roots');
  const paths=new Set<string>(),folded=new Set<string>();
  const safe=(path:unknown):path is string=>{
    if(typeof path!=='string'||/[\u0000-\u001f\u007f:]/u.test(path))return false;
    try{return assertSafeRelativePath(path)===path;}catch{return false;}
  };
  for(const file of value.files){
    exact(file,['relative_path','bytes','sha256']);
    if(!safe(file.relative_path)||folded.has(file.relative_path.toLowerCase())||!Number.isSafeInteger(file.bytes)||Number(file.bytes)<0||typeof file.sha256!=='string'||!HASH.test(file.sha256))fail('INVALID_REQUEST','Invalid prepared file');
    paths.add(file.relative_path);folded.add(file.relative_path.toLowerCase());
  }
  if(value.roots.some(root=>!safe(root)||!paths.has(root))||new Set(value.roots).size!==value.roots.length)fail('INVALID_REQUEST','Invalid prepared roots');
  return frozen(value as unknown as PreparedTaskFact);
}

export class CreatedTaskStore {
  readonly #db:DatabaseSync;
  readonly #commands:OperationIdempotencyStore;
  #schemaVersion=-1;
  #inside=false;
  constructor(private readonly revisions:RevisionStore,private readonly ports:CreatedTaskPorts,private readonly now:()=>Date=()=>new Date()) {
    if(!ports||['assertAllowed','bindStep','assertPrepared'].some(key=>typeof ports[key as keyof CreatedTaskPorts]!=='function'))fail('INVALID_REQUEST','Explicit MAIN ports are required');
    this.#db=revisions.compose(db=>db);this.#commands=new OperationIdempotencyStore(this.#db);
    const found=this.#db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'created_task_*' LIMIT 1").get();
    if(!found)this.revisions.atomic(()=>this.#db.exec(CREATED_TASK_DDL));
    this.#schema();
  }
  #schema(){
    const version=Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    if(version!==this.#schemaVersion){
      if(!matchesFrozenSchemaNamespace(this.#db,CREATED_TASK_DDL,'created_task_'))fail('CAPABILITY_UNAVAILABLE','Created task schema differs');
      this.#schemaVersion=version;
    }
  }
  #atomic<T>(work:()=>T):T {
    if(this.#inside)fail('INVALID_REQUEST','Nested created task transaction');
    this.#inside=true;
    try{return this.revisions.atomic(()=>{this.#schema();return work();});}finally{this.#inside=false;}
  }
  #hook(work:(db:TaskTransactionDb)=>unknown):void {
    let live=true,poisoned=false,fault:unknown;
    const guard=<T>(operation:()=>T):T=>{
      if(!live)fail('INVALID_REQUEST','SQL hook lifetime ended');
      if(poisoned)throw fault;
      try{return operation();}catch(error){poisoned=true;fault=error;throw error;}
    };
    const db:TaskTransactionDb={within:work=>guard(()=>{const value=work();if(value&&typeof(value as {then?:unknown}).then==='function'){void Promise.resolve(value).catch(()=>{});fail('INVALID_REQUEST','Async SQL hooks are forbidden');}return value;}),prepare:sql=>guard(()=>{
      // Composition hooks may query/write rows, never acquire their own transaction/schema.
      if(!/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql))fail('INVALID_REQUEST','Hook requires ordinary row SQL');
      const statement=this.#db.prepare(sql);
      return {get:(...args:SQLInputValue[])=>guard(()=>statement.get(...args)),all:(...args:SQLInputValue[])=>guard(()=>statement.all(...args)),run:(...args:SQLInputValue[])=>guard(()=>statement.run(...args))};
    })};
    liveTaskConnections.set(db,this.#db);
    try{
      const value=work(db);
      if(value&&typeof(value as {then?:unknown}).then==='function'){void Promise.resolve(value).catch(()=>{});fail('INVALID_REQUEST','Async SQL hooks are forbidden');}
      if(poisoned)throw fault;
    }finally{live=false;liveTaskConnections.delete(db);}
  }
  #decode(row:Record<string,unknown>):TaskReservation {
    const request=frozen(structuredClone(validateAgentDefinition<TaskPrepare>('TaskPrepare',JSON.parse(String(row.request_json)))));
    const accepted=frozen(structuredClone(validateAgentDefinition<JobReceipt>('JobReceipt',JSON.parse(String(row.accepted_json)))));
    if(row.project_id!==request.project_id||row.run_id!==request.execution.run_id||Number(row.plan_version)!==request.execution.plan_version||row.step_id!==request.execution.step_id||Number(row.execution_attempt)!==request.execution.attempt||typeof row.principal_id!=='string'||!ID.test(row.principal_id)||row.request_digest!==digest(request,row.principal_id)||typeof row.stage_token!=='string'||!TOKEN.test(row.stage_token)||accepted.job_id!==row.job_id||accepted.project_id!==request.project_id||accepted.state!=='queued'||accepted.attempt!==0||accepted.result_ref!==null||accepted.bootstrap!==null||!same(accepted.execution,request.execution)||accepted.snapshot_id!==request.snapshot_id||!JOB_KINDS_V2.includes(row.job_kind as JobKind)||!Number.isSafeInteger(row.max_attempts)||Number(row.max_attempts)<1)fail('CAPABILITY_UNAVAILABLE','Stored task binding differs');
    return frozen({job_id:String(row.job_id),principal_id:row.principal_id,request,request_digest:String(row.request_digest),stage_token:row.stage_token,accepted,job_kind:row.job_kind as JobKind,max_attempts:Number(row.max_attempts)});
  }
  #task(jobId:string):TaskReservation {
    const row=this.#db.prepare('SELECT * FROM created_task_input WHERE job_id=?').get(jobId);
    if(!row)fail('NOT_FOUND','Task is unavailable');return this.#decode(row);
  }
  read(jobId:string,principalId:string):TaskReservation {
    this.#schema();const task=this.#task(jobId);if(task.principal_id!==principalId)fail('NOT_FOUND','Task is unavailable');return task;
  }
  #job(task:TaskReservation){
    const job=this.revisions.readJob(task.job_id);
    if(!job||job.project_id!==task.request.project_id||job.payload_digest!==task.request_digest||job.kind!==task.job_kind||job.max_attempts!==task.max_attempts)fail('REVISION_CONFLICT','Current job binding differs');return job;
  }
  reserve(raw:TaskPrepare,principalId:string,policy:TaskPolicy):{readonly task:TaskReservation;readonly replayed:boolean} {
    const request=frozen(structuredClone(validateAgentDefinition<TaskPrepare>('TaskPrepare',raw)));
    if(typeof principalId!=='string'||!ID.test(principalId)||!policy||!JOB_KINDS_V2.includes(policy.job_kind)||!Number.isSafeInteger(policy.max_attempts)||policy.max_attempts<1)fail('INVALID_REQUEST','Explicit job policy is required');
    const chosen=frozen({...policy});
    const requestDigest=digest(request,principalId);
    return this.#atomic(()=>{
      const allowed=(phase:TaskGuardContext['phase'],job_id:string|null=null)=>this.#hook(db=>this.ports.assertAllowed(db,{request,principal_id:principalId,phase,job_id,now:date(this.now)}));
      allowed('access');
      const old=this.#commands.recall(request.project_id,OPERATION,request.meta.idempotency_key);
      if(old){
        if(old.request_digest!==requestDigest)fail('IDEMPOTENCY_CONFLICT','The key belongs to another task input');
        const receipt=validateAgentDefinition<JobReceipt>('JobReceipt',JSON.parse(old.response_json));
        const task=this.#task(receipt.job_id);
        if(task.request_digest!==requestDigest||task.principal_id!==principalId||!same(receipt,task.accepted))fail('CAPABILITY_UNAVAILABLE','Original accepted task receipt differs');
        this.#job(task);allowed('replay',task.job_id);return {task,replayed:true};
      }
      allowed('new_reserve');
      const e=request.execution;
      if(this.#db.prepare('SELECT job_id FROM created_task_input WHERE project_id=? AND run_id=? AND plan_version=? AND step_id=? AND execution_attempt=?').get(request.project_id,e.run_id,e.plan_version,e.step_id,e.attempt))fail('IDEMPOTENCY_CONFLICT','This execution attempt already has a job');
      const at=date(this.now),jobId='job_'+randomUUID().replaceAll('-',''),token='stage_'+randomBytes(24).toString('base64url');
      const accepted=validateAgentDefinition<JobReceipt>('JobReceipt',{job_id:jobId,project_id:request.project_id,state:'queued',attempt:0,snapshot_id:request.snapshot_id,result_ref:null,next_actions:['poll_job'],execution:e,bootstrap:null});
      this.revisions.createJobRow({job_id:jobId,project_id:request.project_id,kind:chosen.job_kind,payload_digest:requestDigest,state:'queued',lease_owner:null,lease_expires_at:null,attempt:0,max_attempts:chosen.max_attempts,cost_status:'unknown',created_at:at.toISOString(),updated_at:at.toISOString()});
      this.#db.prepare('INSERT INTO created_task_input(job_id,project_id,principal_id,run_id,plan_version,step_id,execution_attempt,request_digest,request_json,stage_token,accepted_json,job_kind,max_attempts,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(jobId,request.project_id,principalId,e.run_id,e.plan_version,e.step_id,e.attempt,requestDigest,canonicalJson(request),token,canonicalJson(accepted),chosen.job_kind,chosen.max_attempts,at.toISOString());
      const task=this.#task(jobId);
      this.#hook(db=>this.ports.bindStep(db,{task,now:date(this.now)}));
      this.revisions.appendJobEvent(jobId,'queued',at.toISOString(),{message:'Created task reserved'},true);
      this.revisions.enqueueOutbox('created.task.accepted',request.project_id,canonicalJson({job_id:jobId,execution:e,input_digest:requestDigest}),at);
      this.#commands.record({projectId:request.project_id,operationKind:OPERATION,idempotencyKey:request.meta.idempotency_key,requestDigest,response:accepted,now:at});
      allowed('final_reserve',task.job_id);
      const current=this.#job(task);
      if(current.state!=='queued'||current.attempt!==0||current.lease_owner!==null||current.lease_expires_at!==null)fail('REVISION_CONFLICT','A new task must still be queued');
      return {task,replayed:false};
    });
  }
  #lease(task:TaskReservation,lease:TaskLease,at:Date):void {
    const job=this.#job(task);
    if(!lease||typeof lease.owner!=='string'||!lease.owner||!Number.isSafeInteger(lease.attempt)||lease.attempt<1||job.state!=='running'||job.lease_owner!==lease.owner||job.attempt!==lease.attempt||job.lease_expires_at===null||job.lease_expires_at<=at.getTime())fail('REVISION_CONFLICT','Current running lease is required');
  }
  recordPrepared(jobId:string,lease:TaskLease,raw:PreparedTaskFact,proof:unknown):PreparedTaskFact {
    const fact=prepared(raw),identity=frozen({...lease});
    return this.#atomic(()=>{
      const task=this.#task(jobId);
      if(task.stage_token!==fact.stage_token)fail('REVISION_CONFLICT','Prepared stage token differs');
      const check=()=>{const at=date(this.now);this.#lease(task,identity,at);this.#hook(db=>this.ports.assertPrepared(db,{task,fact,proof,lease:identity,now:at}));this.#lease(task,identity,date(this.now));};
      check();
      const old=this.#db.prepare('SELECT fact_json,fact_digest,stage_token FROM created_task_prepared WHERE job_id=?').get(jobId),factDigest=canonicalDigest(fact);
      if(old){
        if(old.fact_digest!==factDigest||old.stage_token!==task.stage_token||!same(JSON.parse(String(old.fact_json)),fact))fail('IDEMPOTENCY_CONFLICT','Immutable prepared fact differs');
      }else{
        this.#db.prepare('INSERT INTO created_task_prepared(job_id,stage_token,fact_json,fact_digest,lease_owner,lease_attempt,prepared_at) VALUES(?,?,?,?,?,?,?)').run(jobId,task.stage_token,canonicalJson(fact),factDigest,identity.owner,identity.attempt,date(this.now).toISOString());
        this.revisions.enqueueOutbox('created.task.prepared',task.request.project_id,canonicalJson({job_id:jobId,stage_token:task.stage_token,fact_digest:factDigest,execution:task.request.execution}),date(this.now));
      }
      check();return fact;
    });
  }
  /** Same live lease + scoped composition, without another BEGIN or worker state machine. */
  withRunningTask<T>(jobId:string,lease:TaskLease,work:(db:TaskTransactionDb,task:TaskReservation,now:Date)=>T):T {
    return this.#atomic(()=>{const task=this.#task(jobId);this.#lease(task,lease,date(this.now));let result!:T;
      this.#hook(db=>{result=work(db,task,date(this.now));return result;});
      this.#lease(task,lease,date(this.now));return result;
    });
  }
  /** Immutable PREPARED fact is not commit/approval. Job + step/checkpoint/events settle
   * in one original-DB transaction after current Run/rights/FS proof verification. */
  finishPrepared(jobId:string,lease:TaskLease,proof:unknown,settle:(db:TaskTransactionDb,task:TaskReservation,fact:PreparedTaskFact,now:Date)=>void):void {
    this.#atomic(()=>{
      const task=this.#task(jobId),fact=this.readPrepared(jobId,task.principal_id);if(!fact)fail('NOT_FOUND','Prepared source is missing');
      const at=date(this.now);this.#lease(task,lease,at);
      this.#hook(db=>this.ports.assertPrepared(db,{task,fact,proof,lease,now:at}));this.#lease(task,lease,date(this.now));
      this.#hook(db=>settle(db,task,fact,date(this.now)));this.#lease(task,lease,date(this.now));
      if(!this.revisions.completeCallback(jobId,lease.owner,lease.attempt,'succeeded','known',canonicalJson({kind:'local.native-draft@1',source_digest:fact.source_digest,stage:'SOURCE_ONLY'}),'SOURCE_ONLY',undefined,undefined,date(this.now)))fail('REVISION_CONFLICT','Task completion lost its lease');
      this.revisions.appendJobEvent(jobId,'succeeded',date(this.now).toISOString(),{message:'Native source prepared; project remains unchanged'},true);
    });
  }
  finishFailed(jobId:string,lease:TaskLease,code:string,settle:(db:TaskTransactionDb,task:TaskReservation,state:'failed'|'cancelled',now:Date)=>void):boolean {
    return this.#atomic(()=>{
      const task=this.#task(jobId),job=this.#job(task),at=date(this.now);
      if(job.lease_owner!==lease.owner||job.attempt!==lease.attempt||!['running','cancel_requested'].includes(job.state))return false;
      if(job.state==='running'&&(job.lease_expires_at===null||job.lease_expires_at<=at.getTime()))return false;
      const state=job.state==='cancel_requested'?'cancelled':'failed';
      const safeCode=/^[A-Z][A-Z0-9_]{0,63}$/.test(code)?code:'INTERNAL_ERROR';
      this.#hook(db=>settle(db,task,state,at));if(state==='failed')this.#lease(task,lease,date(this.now));
      const applied=state==='cancelled'?this.revisions.completeCancelledCallback(jobId,lease.owner,lease.attempt,at):this.revisions.completeCallback(jobId,lease.owner,lease.attempt,'failed','known',canonicalJson({kind:'local.native-draft-failure@1',code:safeCode}),safeCode,undefined,undefined,at);
      if(!applied)fail('REVISION_CONFLICT','Failure settlement lost its lease');
      this.revisions.appendJobEvent(jobId,state,at.toISOString(),{message:state==='cancelled'?'Native preparation cancelled':'Native preparation failed'},true);return true;
    });
  }
  retryRecoverable(jobId:string,lease:TaskLease,settle:(db:TaskTransactionDb,task:TaskReservation,now:Date)=>void):boolean {
    return this.#atomic(()=>{
      const task=this.#task(jobId),job=this.#job(task),at=date(this.now);
      if(job.state!=='running'||job.lease_owner!==lease.owner||job.attempt!==lease.attempt||job.lease_expires_at===null||job.lease_expires_at<=at.getTime()||job.attempt>=job.max_attempts)return false;
      this.#hook(db=>settle(db,task,at));this.#lease(task,lease,date(this.now));
      const current=this.#job(task);if(current.attempt>=current.max_attempts)fail('REVISION_CONFLICT','Retry policy changed');
      if(!this.revisions.releaseLease(jobId,lease.owner,at.getTime()))fail('REVISION_CONFLICT','Recoverable retry lost its lease');
      this.revisions.appendJobEvent(jobId,'queued',at.toISOString(),{message:'Local preparation resource unavailable; safely requeued'},true);return true;
    });
  }
  /** Dedicated recovery owns these jobs so generic reaping cannot split CP/job state. */
  leaseReaperExclusions():string[]{return this.#db.prepare("SELECT t.job_id FROM created_task_input t JOIN job j ON j.job_id=t.job_id WHERE j.state IN('queued','running','cancel_requested')").all().map(row=>String(row.job_id));}
  reapExpired(settle:(db:TaskTransactionDb,task:TaskReservation,state:'pending'|'failed'|'cancelled',now:Date)=>void):number {
    const ids=this.#db.prepare("SELECT t.job_id FROM created_task_input t JOIN job j ON j.job_id=t.job_id WHERE (j.state='running' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at<=?) OR (j.state='cancel_requested' AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=?))").all(date(this.now).getTime(),date(this.now).getTime());let count=0;
    for(const id of ids)this.#atomic(()=>{
      const task=this.#task(String(id.job_id)),job=this.#job(task),at=date(this.now);
      if(!['running','cancel_requested'].includes(job.state)||job.state==='running'&&job.lease_expires_at===null||job.lease_expires_at!==null&&job.lease_expires_at>at.getTime())return;
      const cancel=job.state==='cancel_requested',requeue=!cancel&&job.attempt<job.max_attempts;
      const applied=cancel?(job.lease_owner!==null?this.revisions.completeCancelledCallback(job.job_id,job.lease_owner,job.attempt,at):Number(this.#db.prepare("UPDATE job SET state='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND state='cancel_requested' AND lease_owner IS NULL AND attempt=? AND lease_expires_at IS ?").run(at.toISOString(),job.job_id,job.attempt,job.lease_expires_at).changes)===1):this.revisions.reclaimLease(job.job_id,requeue,at);
      if(!applied)return;
      this.#hook(db=>settle(db,task,cancel?'cancelled':requeue?'pending':'failed',at));
      const settled=this.#job(task);if(settled.attempt!==job.attempt||settled.state!==(cancel?'cancelled':requeue?'queued':'attention')||settled.lease_owner!==null||settled.lease_expires_at!==null)fail('REVISION_CONFLICT','Recovery settlement changed');
      const state=cancel?'cancelled':requeue?'queued':'attention';
      this.revisions.appendJobEvent(job.job_id,state,at.toISOString(),{message:cancel?'Expired cancelled preparation settled':requeue?'Expired preparation lease requeued':'Preparation attempts exhausted; inspect task result'},true);
      // Preparation has never published author state. Job attention is sufficient;
      // do not invent a project transaction or latch a healthy project into attention.
      count++;
    });return count;
  }
  preparedLeaseAttempt(jobId:string,principalId:string):number|null {
    const fact=this.readPrepared(jobId,principalId);if(!fact)return null;
    const row=this.#db.prepare('SELECT lease_attempt FROM created_task_prepared WHERE job_id=?').get(jobId);
    if(!row||!Number.isSafeInteger(row.lease_attempt)||Number(row.lease_attempt)<1)fail('CAPABILITY_UNAVAILABLE','Prepared lease binding differs');return Number(row.lease_attempt);
  }
  receipt(jobId:string,principalId:string):JobReceipt {
    const task=this.read(jobId,principalId),job=this.#job(task);
    return validateAgentDefinition<JobReceipt>('JobReceipt',{...task.accepted,state:job.state,attempt:job.attempt,next_actions:job.state==='succeeded'?['review_prepared_source']:['queued','running','cancel_requested'].includes(job.state)?['poll_job']:['inspect_task_result']});
  }
  readPrepared(jobId:string,principalId:string):PreparedTaskFact|null {
    const task=this.read(jobId,principalId),row=this.#db.prepare('SELECT fact_json,fact_digest,stage_token FROM created_task_prepared WHERE job_id=?').get(jobId);
    if(!row)return null;
    const fact=prepared(JSON.parse(String(row.fact_json)) as PreparedTaskFact);
    if(row.stage_token!==task.stage_token||row.fact_digest!==canonicalDigest(fact))fail('CAPABILITY_UNAVAILABLE','Stored prepared fact differs');return fact;
  }
}
