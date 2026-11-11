import type {Context,NativeAck,Selection,JobReceipt} from '../../contracts/agent-driven-types.js';
import {validateAgentDefinition} from '../../contracts/agent-driven-validator.js';
import type {NarralensHost} from '../server.js';
import type {ProjectCreationStore} from '../projects/project-creation-store.js';
import type {FixedWorkflowService} from '../creative/fixed-workflow-service.js';
import type {TrustedCallerContext} from '../creative/product-repository.js';
import {ProductError,isTrustedCallerContext} from '../creative/trusted-context.js';
import {canonicalDigest} from '../creative/digest.js';
import {ProductSqliteRepository} from './product-sqlite-repository.js';
import {CreativeProjectAuthority} from './creative-project-authority.js';
export interface NativeContextFacts {
 readonly selection:Selection|null;
 readonly selection_version:number;
 readonly ack:NativeAck|null;
 readonly sync:'unknown'|'pending'|'loaded';
 /** MAIN's current authenticated editor binding, never copied from the ack body. */
 readonly active_bridge_session_id:string|null;
}
export interface NativeContextPort {read(projectId:string):Promise<NativeContextFacts>;}
/** The ONE receipt resolver of the active jobs. The creation job and the created task
 * jobs are read through it, so the context and job.read never disagree. */
export interface ProjectJobReceiptPort {read(project_id:string,job_id:string,principal_id:string):JobReceipt|null;}
/** Reads committed Host facts; never dispatches, registers a fake capability or invents a native ack. */
export class ProjectContextService {
 readonly #repo:ProductSqliteRepository;
 constructor(private readonly host:NarralensHost,private readonly creation:ProjectCreationStore,private readonly authority:CreativeProjectAuthority,private readonly workflow:FixedWorkflowService,private readonly native?:NativeContextPort,private readonly instanceGeneration?:()=>number,private readonly jobReceipts?:ProjectJobReceiptPort){this.#repo=new ProductSqliteRepository(host.revisions);}
 async read(projectId:string,caller:TrustedCallerContext):Promise<Context>{
  if(!isTrustedCallerContext(caller)||caller.channel==='native_bridge')throw new ProductError('UNAUTHORIZED','A trusted authenticated caller is required');
  this.authority.assertOwner(projectId,caller.principal_id);
  const view=await this.host.projectResolver.resolveNative(projectId);
  await this.host.projections.layoutFor(view);
  const projection=await this.host.engines.resolve(projectId).port.inspect({project_id:projectId,engine:'openfilm',source_digest:view.source_digest},{projectId,correlationId:'context-read',signal:AbortSignal.timeout(20000)});
  if(projection.source_digest!==view.source_digest)throw new ProductError('REVISION_CONFLICT','The native source differs from its committed digest');
  if(projection.problems.length>0)throw new ProductError('CAPABILITY_UNAVAILABLE','The native projection is incomplete');
  const native=await this.native?.read(projectId)??{selection:null,selection_version:0,ack:null,sync:'unknown' as const,active_bridge_session_id:null};
  if(native.selection)validateAgentDefinition('Selection',native.selection);
  if(native.ack)validateAgentDefinition('NativeAck',native.ack);
  return this.#repo.transaction(tx=>{
   this.authority.assertOwner(projectId,caller.principal_id);
   const current=this.host.revisions.activeCommit(projectId);
   if(!current||current.revision!==view.revision||current.snapshot_id!==view.snapshot_id||current.source_digest!==view.source_digest||this.host.revisions.controlRevision(projectId,0)!==view.control_revision||this.host.revisions.recoveryGate(projectId,0))throw new ProductError('REVISION_CONFLICT','Project state moved while observing it');
   const runs=tx.list('run',{project_id:projectId});
   const activeRun=this.workflow.readCurrentRunInTransaction(tx,projectId,caller);
   const currentRun=activeRun===null?undefined:runs.find(row=>row.run_id===activeRun.run_id);
   if(activeRun!==null&&!currentRun)throw new ProductError('REVISION_CONFLICT','The observed run disappeared');
   const heads=tx.list('artifact_head',{project_id:projectId});
   if(heads.length>128)throw new ProductError('CAPABILITY_UNAVAILABLE','Current artifact heads exceed this protocol view');
   const artifacts=heads.map(head=>{
    const row=tx.get('artifact_version',{project_id:projectId,artifact_id:head.artifact_id,version:head.draft_version});
    if(!row||row.content_digest!==canonicalDigest(row.content_json))throw new ProductError('REVIEW_STALE','An artifact head has no matching immutable version');
    return {id:head.artifact_id,version:head.draft_version,sha256:row.content_digest};
   });
   const activeJobs=this.host.revisions.compose(db=>db.prepare("SELECT job_id FROM job WHERE project_id=? AND state NOT IN('succeeded','failed','cancelled','attention') ORDER BY created_at,job_id LIMIT 129").all(projectId));
   if(activeJobs.length>128)throw new ProductError('CAPABILITY_UNAVAILABLE','Active jobs exceed this protocol view');
   const creator=this.creation.forProject(projectId);
   const jobs:JobReceipt[]=activeJobs.map(row=>{
    // The shared resolver answers for the creation job and for the created task jobs.
    const id=String(row.job_id);
    const resolved=this.jobReceipts
     ?this.jobReceipts.read(projectId,id,caller.principal_id)
     :id===creator?.job_id?this.creation.receiptForJob(id,caller.principal_id):null;
    if(!resolved)throw new ProductError('CAPABILITY_UNAVAILABLE','The active job receipt producer is not registered');
    if(resolved.project_id!==projectId||resolved.job_id!==id)throw new ProductError('REVISION_CONFLICT','The active job receipt binding changed');
    return resolved;
   });
   if(!this.native&&this.host.revisions.compose(db=>db.prepare('SELECT 1 FROM cp_a0_native_ack WHERE project_id=? LIMIT 1').get(projectId)))throw new ProductError('CAPABILITY_UNAVAILABLE','Durable native state needs its trusted bridge producer');
   if(native.ack&&native.ack.project_id!==projectId)throw new ProductError('NATIVE_ACK_STALE','The native state belongs to another project');
   const matches=native.ack!==null&&native.ack.bridge_session_id===native.active_bridge_session_id&&native.ack.instance_generation===this.instanceGeneration?.()&&native.ack.loaded_project_revision===view.revision&&native.ack.loaded_snapshot_id===view.snapshot_id&&native.ack.source_digest===view.source_digest&&native.ack.selection_version===native.selection_version;
   const selection=matches&&native.selection&&native.selection.project_revision===view.revision&&native.selection.selection_version===native.selection_version?native.selection:null;
   return validateAgentDefinition<Context>('Context',{project_id:projectId,origin:'created',project_revision:view.revision,control_revision:view.control_revision,snapshot_id:view.snapshot_id,source_digest:view.source_digest,workflow_revision:currentRun?.checkpoint_json.workflow_revision??0,selection_version:native.selection_version,current_selection:selection,active_jobs:jobs,artifacts,capabilities:[],next_actions:activeRun===null?['define_content']:activeRun.next_actions,active_run:activeRun,native_ack:native.ack,native_sync:native.sync==='loaded'&&!matches?'unknown':native.sync});
  });
 }
}
