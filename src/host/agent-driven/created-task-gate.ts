import type {TaskPrepare,Ref} from '../../contracts/agent-driven-types.js';
import {validateAgentDefinition} from '../../contracts/agent-driven-validator.js';
import {canonicalDigest,FIXED_PLAN} from '../creative/digest.js';
import {creativeInputClosure} from '../creative/creative-closure.js';
import {guardExecution,readGuardFacts} from '../creative/execution-guard.js';
import {ProductError} from '../creative/trusted-context.js';
import type {ProductTransaction} from '../creative/product-repository.js';
import type {RevisionStore} from '../projects/revision-store.js';
import {CreativeProjectAuthority} from './creative-project-authority.js';
import type {ProductSqliteRepository} from './product-sqlite-repository.js';
import type {TaskGuardContext,TaskTransactionDb} from './created-task-store.js';

/** MAIN's synchronous reservation gate over real committed/creative/workflow facts.
 * Access/replay are read-only historical receipts; new dispatch is guarded twice.
 * This gate does not prove live filesystem bytes or replace the worker's stage verifier. */
export class CreatedTaskGate {
 constructor(private readonly revisions:RevisionStore,private readonly repository:ProductSqliteRepository,private readonly authority:CreativeProjectAuthority){}
 assertAllowed=(rows:TaskTransactionDb,context:TaskGuardContext):void=>{
  const {request,principal_id,phase}=context;
  this.authority.assertOwner(request.project_id,principal_id);
  if(phase==='access'||phase==='replay')return;
  this.repository.joinTaskTransaction(rows,tx=>{
   this.assertCurrent(tx,rows,request,principal_id);
   const facts=readGuardFacts(tx,request.project_id,request.execution,principal_id,Math.floor(context.now.getTime()/1000));
   let actual=facts;
   if(phase==='new_reserve'){
    const prior=tx.list('step_attempt',{project_id:request.project_id,run_id:request.execution.run_id,step_id:request.execution.step_id});
    const current=prior.sort((a,b)=>b.attempt-a.attempt)[0];
    if(current&&['pending','running','waiting_user','unknown'].includes(current.state))throw new ProductError('RUN_PLAN_STALE','A current execution attempt still owns this step');
    if(request.execution.attempt!==(current?.attempt??0)+1)throw new ProductError('RUN_PLAN_STALE','The next execution attempt is not consecutive');
    // Prospective reservation, still inside BEGIN IMMEDIATE. The final_reserve phase
    // must read the actual bound durable attempt; this object never marks work done.
    actual={...facts,attempt:{step_id:request.execution.step_id,attempt:request.execution.attempt,state:'pending',input_digest:request.execution.input_digest,grant_id:request.execution.authorization_id}};
   }else{
    const step=tx.get('step_attempt',{project_id:request.project_id,run_id:request.execution.run_id,plan_version:1,step_id:request.execution.step_id,attempt:request.execution.attempt});
    if(!step||step.job_id!==context.job_id||step.state!=='pending')throw new ProductError('RUN_PLAN_STALE','The reserved job is not the durable pending step');
   }
   guardExecution(request.execution,{kind:'action',action:request.kind==='assemble_draft'?'clip.prepare':'snapshot.render',stage_id:request.execution.step_id},actual);
  });
 };
 private assertCurrent(tx:ProductTransaction,rows:TaskTransactionDb,request:TaskPrepare,principal:string):void {
  const project=request.project_id,current=this.revisions.activeCommit(project);
  if(!current||current.revision!==request.base_revision||current.source_digest!==request.source_digest||this.revisions.recoveryGate(project,0))throw new ProductError('REVISION_CONFLICT','The committed project base is unavailable or changed');
  if(request.snapshot_id!==null&&request.snapshot_id!==current.snapshot_id||request.kind==='render_snapshot'&&(request.snapshot_id===null||request.render_spec===null)||request.kind==='assemble_draft'&&request.render_spec!==null)throw new ProductError('INVALID_REQUEST','Task snapshot or render input differs');
  const source=this.authority.creation.sourceFact(project,current.snapshot_id);
  if(!source)throw new ProductError('CAPABILITY_UNAVAILABLE','The source producer is unavailable');
  const created=this.authority.creation.forProject(project),head=created?tx.get('intake_head',{intake_id:created.request.intake_id}):null;
  if(!created||!head||canonicalDigest(creativeInputClosure(tx,created.request.intake_id,head.current_version))!==request.execution.input_digest)throw new ProductError('REVIEW_STALE','The current creative closure differs');
  const run=tx.get('run',{project_id:project,run_id:request.execution.run_id});
  const plan=tx.get('plan_version',{project_id:project,run_id:request.execution.run_id,plan_version:1});
  if(!run||!plan||plan.input_digest!==request.execution.input_digest||plan.run_scope_digest!==run.run_scope_digest||canonicalDigest(plan.plan_json)!==canonicalDigest(FIXED_PLAN))throw new ProductError('RUN_PLAN_STALE','The durable fixed plan differs');
  const events=rows.prepare(`SELECT o.payload_json FROM outbox o JOIN cp_a0_event e ON e.event_id=o.event_id WHERE e.project_id=? AND e.run_id=? AND o.topic='workflow.run.prepared' ORDER BY e.event_id`).all(project,run.run_id);
  if(events.length!==1)throw new ProductError('RUN_PLAN_STALE','The immutable run inputs are unavailable');
  let allowed:Ref[];
  try{
   const event=JSON.parse(String(events[0]!.payload_json));
   if(event.scope?.project_id!==project||event.scope?.run_id!==run.run_id||event.scope?.run_scope_digest!==run.run_scope_digest||event.payload?.scope_digest!==run.run_scope_digest||event.input_digest!==request.execution.input_digest||!Array.isArray(event.payload?.input_refs))throw Error();
   allowed=event.payload.input_refs.map((ref:unknown)=>validateAgentDefinition<Ref>('Ref',ref));
  }catch{throw new ProductError('RUN_PLAN_STALE','The original run input event differs');}
  const seen=new Set<string>(),kinds=new Set<string>();
  for(const ref of request.input_refs){
   if(seen.has(ref.id)||!allowed.some(value=>canonicalDigest(value)===canonicalDigest(ref)))throw new ProductError('REVIEW_STALE','Task inputs exceed the approved run inputs');
   seen.add(ref.id);const resolved=this.authority.ref(tx,project,ref);
   if(resolved.namespace!=='artifact')throw new ProductError('INVALID_REQUEST','Task inputs must name immutable content artifacts');
   kinds.add(resolved.record.kind);
  }
  if(request.kind==='assemble_draft'&&(!kinds.has('script')||!kinds.has('storyboard')||request.input_refs.length!==2))throw new ProductError('INVALID_REQUEST','Assembly requires exactly the authorized Script and Storyboard');
  this.authority.assertOwner(project,principal);
 }
}
