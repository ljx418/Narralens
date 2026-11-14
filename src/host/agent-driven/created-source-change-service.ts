import {randomUUID} from 'node:crypto';
import type {Change,PrepareChange} from '../../contracts/agent-driven-types.js';
import {validateAgentDefinition} from '../../contracts/agent-driven-validator.js';
import {ProductError} from '../creative/trusted-context.js';
import {canonicalDigest,contentDigest,FIXED_PLAN} from '../creative/digest.js';
import {creativeInputClosure} from '../creative/creative-closure.js';
import {guardExecution,readGuardFacts} from '../creative/execution-guard.js';
import type {ProductTransaction} from '../creative/product-repository.js';
import type {NarralensHost} from '../server.js';
import {OperationIdempotencyStore} from '../projects/operation-idempotency-store.js';
import {ProductSqliteRepository} from './product-sqlite-repository.js';
import {CreatedPreparedSourceStore} from './created-prepared-source-store.js';
import {CreatedSourceImpactStore} from './created-source-impact-store.js';
import {CreatedSourceFactsReader,type CreatedPreparedReadInput,type CreatedPreparedFactsProof} from './created-source-facts-reader.js';
import {CreativeProjectAuthority} from './creative-project-authority.js';
import {PREPARED_ADOPTION_PLAN_DOMAIN,PREPARED_ADOPTION_PLAN_VERSION,PREPARED_ADOPTION_SOURCE_KIND,
 PREPARED_ADOPTION_IMPACT_TTL_SECONDS,assertPreparedAdoptionPlan,preparedAdoptionPlanDigest,type PreparedAdoptionPlanV1} from './created-source-ports.js';

export const CREATED_CHANGE_OPERATION='agent.v1:change.prepare';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function stale(message:string):never{throw new ProductError('REVISION_CONFLICT',message);}

/** Preparation only: no source write, snapshot insertion, Job settlement, Approval or
 * synthetic review. The real narrow guard permits completed prepared work to acquire
 * its impact BEFORE the one immutable ReviewPackage is published. */
export class CreatedSourceChangeService {
 readonly #repository:ProductSqliteRepository;readonly #commands:OperationIdempotencyStore;readonly #now:()=>Date;
 constructor(private readonly options:{readonly host:NarralensHost;readonly prepared:CreatedPreparedSourceStore;
  readonly impacts:CreatedSourceImpactStore;readonly facts:CreatedSourceFactsReader;readonly authority:CreativeProjectAuthority;
  readonly legacyPrepare?:(input:PrepareChange,principal:string)=>Promise<Change>;readonly now?:()=>Date}){
  this.#repository=new ProductSqliteRepository(options.host.revisions);
  this.#commands=new OperationIdempotencyStore(options.host.revisions.compose(db=>db));this.#now=options.now??(()=>new Date());
 }
 #clock():Date{const now=this.#now();if(!(now instanceof Date)||!Number.isFinite(now.getTime()))stale('Invalid Host clock');return now;}
 #replay(input:PrepareChange,principal:string,digest:string):Change|undefined {
  const remembered=this.#commands.recall(input.project_id,CREATED_CHANGE_OPERATION,input.meta.idempotency_key);
  if(!remembered)return;
  this.#commands.assertSameRequest(remembered,digest,CREATED_CHANGE_OPERATION,input.project_id,input.meta.correlation_id);
  let decoded:unknown;try{decoded=JSON.parse(remembered.response_json);}catch{stale('Stored impact response is invalid');}
  if(!object(decoded)||decoded.format!=='agent.idempotency@1'||!object(decoded.receipt)
   ||decoded.receipt.principal_id!==principal||decoded.receipt.project_id!==input.project_id
   ||decoded.receipt.operation!=='change.prepare'||decoded.receipt.request_digest!==digest
   ||decoded.receipt.idempotency_key!==input.meta.idempotency_key)stale('Stored impact response binding differs');
  const response=validateAgentDefinition<Change>('Change',decoded.response),impact=this.options.impacts.read(response.impact_id);
  if(response.project_id!==input.project_id||response.materialization_id!==input.materialization_id
   ||response.base_revision!==input.base_revision||response.source_digest!==input.source_digest
   ||response.selection_version!==input.selection_version||!impact||impact.project_id!==input.project_id||impact.materialization_id!==input.materialization_id
   ||impact.native_plan_sha256!==response.plan_sha256||impact.target_snapshot_id!==response.target_snapshot_id
   ||impact.source_digest!==response.source_digest||impact.base_revision!==response.base_revision
   ||impact.control_revision!==response.control_revision||impact.expires_at!==response.expires_at
   ||remembered.transaction_id!==impact.impact_id)stale('Stored impact response has no matching authority');
  let state=this.options.impacts.state(impact.impact_id);
  if(state==='active'&&this.#clock().getTime()>=Date.parse(impact.expires_at)){
   // The impact table's own authority decides whether the row really expires: it
   // checks the deadline, the predecessor state and the number of rows it changed.
   // This service writes NO state of its own - it asks, and then it READS BACK what
   // the table really holds. A row another writer moved in the meantime (to
   // `consumed`, say) is reported as it really is, never as the expiry this call
   // wanted to make.
   this.options.impacts.expire(impact.impact_id,this.#clock());
   state=this.options.impacts.state(impact.impact_id);
  }
  if(!state)stale('Impact state is missing');
  return {...response,state:state==='stale'?'revoked':state};
 }
 #guard(tx:ProductTransaction,input:PrepareChange,principal:string,proof:CreatedPreparedFactsProof):void{
  this.options.authority.assertOwner(input.project_id,principal);
  const creation=this.options.authority.creation.forProject(input.project_id);
  if(!creation)throw new ProductError('NOT_FOUND','No owned created project');
  const head=tx.get('intake_head',{intake_id:creation.request.intake_id});
  if(!head||canonicalDigest(creativeInputClosure(tx,creation.request.intake_id,head.current_version))!==input.execution.input_digest)
   throw new ProductError('RUN_PLAN_STALE','The creative input closure changed');
  const fixed=tx.get('plan_version',{project_id:input.project_id,run_id:input.execution.run_id,plan_version:1});
  if(!fixed||canonicalDigest(fixed.plan_json)!==canonicalDigest(FIXED_PLAN)
   ||fixed.input_digest!==input.execution.input_digest||fixed.run_scope_digest!==input.execution.run_scope_digest)
   throw new ProductError('RUN_PLAN_STALE','The fixed workflow facts changed');
  const readInput:CreatedPreparedReadInput={project_id:input.project_id,prepared_source_id:input.materialization_id,execution:input.execution};
  const preparedImpact=this.options.facts.preparedImpactFacts(readInput,principal,proof);
  const facts=readGuardFacts(tx,input.project_id,input.execution,principal,Math.floor(this.#clock().getTime()/1000));
  guardExecution(input.execution,{kind:'review_impact_prepare',prepared_source_id:preparedImpact.prepared_source_id,
   prepared_job_id:preparedImpact.completed_job.job_id,fact_digest:preparedImpact.fact_digest},{...facts,preparedImpact});
 }
 async prepare(raw:PrepareChange,principal:string):Promise<Change>{
  const input=structuredClone(validateAgentDefinition<PrepareChange>('PrepareChange',raw));
  if(!this.options.authority.creation.forProject(input.project_id)&&this.options.legacyPrepare)
   return this.options.legacyPrepare(input,principal); // Existing branch retains its own owner checks.
  this.options.authority.assertOwner(input.project_id,principal);
  // Select the actual registered source authority, rather than guessing content from
  // the spelling of an identifier. Unknown legacy IDs remain that branch's decision.
  const mapping=this.options.prepared.read(input.materialization_id);
  if(!mapping){if(this.options.legacyPrepare)return this.options.legacyPrepare(input,principal);
   throw new ProductError('NOT_FOUND','No such prepared source');}
  if(mapping.project_id!==input.project_id)throw new ProductError('NOT_FOUND','No such prepared source');
  const digest=contentDigest(input),remembered=await this.#repository.transaction(()=>this.#replay(input,principal,digest));
  if(remembered&&remembered.state!=='active')return remembered;
  const readInput:CreatedPreparedReadInput={project_id:input.project_id,prepared_source_id:input.materialization_id,execution:input.execution};
  const proof=await this.options.facts.acquire(readInput,principal);
  try{return await this.#repository.transaction(tx=>{
   const raced=this.#replay(input,principal,digest);if(raced&&raced.state!=='active')return raced;
   const {rights_digest,...observed}=this.options.facts.assertCurrent(readInput,principal,proof);
   if(input.base_revision!==observed.base_revision||input.source_digest!==observed.base_source_digest
    ||input.selection_version!==observed.selection_version)stale('The requested project base or selection changed');
   this.#guard(tx,input,principal,proof);
   if(raced){
    const stored=this.options.impacts.planFact(raced.impact_id),impact=this.options.impacts.read(raced.impact_id);
    if(!stored||!impact)stale('The replayed impact has no immutable plan');
    const plan=assertPreparedAdoptionPlan(stored.plan as PreparedAdoptionPlanV1);
    const {format:_format,version:_version,source_kind:_kind,expires_at:_expiry,...prior}=plan;
    if(canonicalDigest(prior)!==canonicalDigest(observed)||impact.rights_digest!==rights_digest)
      throw new ProductError('IMPACT_STALE','The replayed impact no longer describes current facts');
    this.#guard(tx,input,principal,proof);
    return this.#replay(input,principal,digest)!;
   }
   const now=this.#clock();
   const plan:PreparedAdoptionPlanV1={format:PREPARED_ADOPTION_PLAN_DOMAIN,version:PREPARED_ADOPTION_PLAN_VERSION,
    source_kind:PREPARED_ADOPTION_SOURCE_KIND,...observed,expires_at:new Date(now.getTime()+PREPARED_ADOPTION_IMPACT_TTL_SECONDS*1000).toISOString()};
   assertPreparedAdoptionPlan(plan);const planDigest=preparedAdoptionPlanDigest(plan);
   // Re-read actual bytes, Job, rights, selection and current run/grant/gates after
   // plan construction, synchronously inside this same BEGIN IMMEDIATE boundary.
   this.#guard(tx,input,principal,proof);
   if(this.#clock().getTime()>=Date.parse(plan.expires_at))throw new ProductError('IMPACT_STALE','Impact preparation expired before registration');
   const impact=this.options.impacts.insertInTransaction({impact_id:'imp_'+randomUUID().replaceAll('-',''),project_id:input.project_id,
    materialization_id:input.materialization_id,target_snapshot_id:plan.target_snapshot_id,base_revision:plan.base_revision,source_digest:plan.base_source_digest,
    control_revision:plan.control_revision,engine_upstream_sha:plan.engine_upstream_sha,affected_ranges:plan.affected_ranges,
    affected_consumers:[{kind:'native',id:plan.consumer.consumer_id,action:'replace'}],locks_checked:plan.locks_checked,rights_digest,
    native_plan_sha256:planDigest,approvals_required:['change.approve'],request_digest:digest,plan,now});
   const response:Change={impact_id:impact.impact_id,project_id:input.project_id,materialization_id:input.materialization_id,base_revision:plan.base_revision,
    control_revision:plan.control_revision,source_digest:plan.base_source_digest,selection_version:plan.selection_version,plan_sha256:planDigest,
    target_snapshot_id:plan.target_snapshot_id,expires_at:impact.expires_at,state:'active',summary:'Adopt the verified native draft into this project'};
   validateAgentDefinition('Change',response);
   this.#commands.record({projectId:input.project_id,operationKind:CREATED_CHANGE_OPERATION,idempotencyKey:input.meta.idempotency_key,
    requestDigest:digest,transactionId:impact.impact_id,now,response:{format:'agent.idempotency@1',receipt:{operation:'change.prepare',
     idempotency_key:input.meta.idempotency_key,request_digest:digest,principal_id:principal,project_id:input.project_id,
     correlation_id:input.meta.correlation_id},response}});
   return response;
  });}finally{this.options.facts.release(proof);}
 }
 static requestDigestOf(input:PrepareChange):string{return contentDigest(input);}
}
