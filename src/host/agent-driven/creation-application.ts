import {validateNativeEntry} from '../../contracts/owned-projects.js';
import {CreatedWorkbenchService} from './created-workbench-service.js';
import {CreatedWorkbenchHttp} from './created-workbench-http.js';
import {CreatedNativeWorkspaceService} from './created-native-workspace.js';
import {createHash,randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {WorkbenchSessionService} from './workbench-session.js';
import type {Instance,HealthRead} from '../../contracts/agent-driven-types.js';
import type {NarralensHost,AgentHostApplication} from '../server.js';
import {CreativeService} from '../creative/creative-service.js';
import {ProjectCreationStore} from '../projects/project-creation-store.js';
import {ProjectCreationService,type CreationServiceDeps} from '../projects/project-creation-service.js';
import {CreationSourceVerifier} from '../projects/creation-source-verifier.js';
import {ProductSqliteRepository} from './product-sqlite-repository.js';
import {ScopedAgentAuth,type AgentPrincipal} from './scoped-auth.js';
import {ApplicationDispatcher,creativeHandlers} from './application-dispatcher.js';
import {AssetInventory} from './asset-inventory.js';
import {LocalAssetHttp} from './local-asset-http.js';
import {ReviewMediaHttp} from './review-media-http.js';
import {PreparedReviewMediaReaderImpl} from '../render/preview-prepared-source.js';
import {CreatedRunFacts} from './created-run-facts.js';
import {CreatedRunAuthority} from './created-run-authority.js';
import {CreatedTaskApplication} from './created-task-application.js';
import {CreatedTaskGate} from './created-task-gate.js';
import {CreatedDraftTaskProcessor} from './created-draft-processor.js';
import {PreparedDraftVerifier} from './prepared-draft-verifier.js';
import {PersistentJobStore} from '../persistent-job-store.js';
import {FixedWorkflowService} from '../creative/fixed-workflow-service.js';
import {createTrustedCallerContext,ProductError} from '../creative/trusted-context.js';
import {CreativeProjectAuthority} from './creative-project-authority.js';
import {ProjectContextService} from './project-context-service.js';
import {LocalAssetRegistry,type LocalAssetRegistryOptions} from './local-asset-registry.js';
import {CommittedSnapshotAuthority} from './committed-snapshot-authority.js';
import {AgentRouteError} from './agent-http-router.js';
import {agentErrorCode} from './agent-error-alias.js';
import {
  agentRoutes,
  validateAgentRouteInput,
  validateAgentRouteOutput,
  validateAgentDefinition,
  type AgentRouteId,
} from '../../contracts/agent-driven-validator.js';
import type {
  NativeStudioUiGrantV1,
  NativeStudioUiInvokeInput,
  NativeStudioUiInvokeResult,
  NativeStudioUiSurface,
} from '../m5/controlled-studio-access.js';
import registry from '../../../contracts/agent-driven-a.registry.json' with { type: 'json' };
import workbenchUiRegistry from '../../../contracts/agent-workbench-ui-v1.registry.json' with { type: 'json' };

const STATUS=new Map(registry.errorMapping.map(row=>[row.code,row.http_status]));
/** The independent UI delegate never outlives its parent session, and never longer
 * than the eight hours the gateway's own UI cookie lives. */
const UI_MAX_LIFETIME_MS=8*60*60*1000;

export interface CreationApplicationOptions {
  readonly createdRoot: string;
  readonly vendorRoot: string;
  readonly nativeWorkspaceRoot?: string;
  readonly taskRoot?: string;
  readonly nativeStage?: { readonly width: number; readonly height: number };
  /** The private domain the prepared preview objects live in. The real MEDIA reader is
   * bound to it; the review package publication that would register a binding is not
   * produced in this ticket, so the surface stays fail closed. */
  readonly reviewMediaObjectRoot?: string;
  readonly worker?: Pick<CreationServiceDeps,'leaseMs'|'pollMs'|'boundary'>;
  readonly instance?: () => Instance;
  readonly health?: () => HealthRead;
  readonly workbench?: { readonly principalId: string; readonly operatorSecret: string };
  readonly localAssets?: Omit<LocalAssetRegistryOptions,'projectsRoot'|'snapshotsRoot'>;
}

/** Actual Host composition for the first creation chain, not an alternate server.
 * Remaining workflow/context/render producers stay explicitly unavailable until wired.
 * Credential provisioning remains Host-only; this class exposes no credential HTTP route. */
export class CreationApplication implements AgentHostApplication {
  readonly auth:ScopedAgentAuth;
  readonly workbenchSessions:WorkbenchSessionService|null;
  readonly dispatcher:ApplicationDispatcher;
  readonly creation:ProjectCreationStore;
  readonly committedSnapshots:CommittedSnapshotAuthority;
  readonly localAssets:LocalAssetRegistry|null;
  readonly nativeWorkspaces:CreatedNativeWorkspaceService;
  readonly createdWorkbench:CreatedWorkbenchService;
  readonly #workbenchRead:CreatedWorkbenchHttp;
  readonly #inventory:AssetInventory|null;
  readonly #localAssetsHttp:LocalAssetHttp|null;
  readonly #reviewMedia:ReviewMediaHttp;
  #tasks:CreatedTaskApplication|null=null;
  #closing:Promise<void>|undefined;
  readonly worker:ProjectCreationService;
  readonly #host:NarralensHost;
  readonly #options:CreationApplicationOptions;
  constructor(host:NarralensHost,options:CreationApplicationOptions){
  this.#host=host;this.#options=options;
  const cookieName=options.instance?'narralens_a_'+createHash('sha256').update(options.instance().instance_id).digest('hex').slice(0,24):'narralens_a_session';
  this.auth=new ScopedAgentAuth(()=>host.origin,Date.now,cookieName,{requireUiReadProof:!!options.workbench});
  this.workbenchSessions=options.workbench?new WorkbenchSessionService(this.auth,()=>host.origin,options.workbench.principalId,options.workbench.operatorSecret):null;
  const verifier=new CreationSourceVerifier(host.snapshots,options.vendorRoot,options.createdRoot);
  this.creation=new ProjectCreationStore(host.revisions,()=>new Date(),verifier);
  host.projectResolver.attachCreatedProjects(this.creation,options.createdRoot);
  this.committedSnapshots=new CommittedSnapshotAuthority(host.revisions,host.snapshots,this.creation,options.vendorRoot);
  this.nativeWorkspaces=new CreatedNativeWorkspaceService(host.revisions,this.creation,this.committedSnapshots,{root:options.nativeWorkspaceRoot??options.createdRoot+'-native-workspaces',protectedRoots:[options.createdRoot,host.snapshots.projectRoot(''),options.vendorRoot,...(host.nativeStudioRuntimeRoot?[host.nativeStudioRuntimeRoot]:[])]});
  this.createdWorkbench=new CreatedWorkbenchService(host,this.creation);
  this.#workbenchRead=new CreatedWorkbenchHttp(this.auth,()=>host.origin,this.createdWorkbench,async(projectId,principal)=>this.#openNative(projectId,principal));
  this.localAssets=options.localAssets?new LocalAssetRegistry(host.revisions,this.creation,{...options.localAssets,projectsRoot:options.createdRoot,snapshotsRoot:host.snapshots.projectRoot('')}):null;
  // The adjunct local-material transport. It exists only when the Host configured a
  // source root; without one there is nothing to list, to register or to read.
  this.#inventory=this.localAssets?new AssetInventory({registry:this.localAssets}):null;
  this.#localAssetsHttp=this.#inventory?new LocalAssetHttp(this.auth,()=>host.origin,this.#inventory):null;
  const authority=new CreativeProjectAuthority(this.creation);
  // The review media transport uses the REAL MEDIA reader over the private preview
  // object domain. It has NO binding producer, because the real current package and
  // the immutable receipt linkage are not published in this ticket: every request
  // answers 503 until that producer exists, and nothing is ever served from an
  // in-memory map.
  this.#reviewMedia=new ReviewMediaHttp({auth:this.auth,origin:()=>host.origin,assertOwner:(projectId,principalId)=>authority.assertOwner(projectId,principalId),reader:new PreparedReviewMediaReaderImpl(options.reviewMediaObjectRoot??options.createdRoot+'-preview-objects')});
  this.worker=new ProjectCreationService({store:this.creation,coordinator:host.coordinator,snapshots:host.snapshots,verifier,createdRoot:options.createdRoot,...options.worker});
  const repository=new ProductSqliteRepository(host.revisions);
  // The facts are the real ones: the active commit, the control revision, the CURRENT
  // creative closure and the registered capability manifest. A missing or malformed
  // capability manifest is not a capability, so a run stays unavailable.
  const facts=new CreatedRunFacts({revisions:host.revisions,creation:this.creation,repository,...(this.#inventory?{inventory:this.#inventory}:{})});
  // The trusted confirmation is bound to a real trusted UI session. The guard re-checks
  // the STORED session lifetime; the probe's own expiry field is not part of that check.
  const adoption=new CreatedRunAuthority({sessionGuard:({principal_id,session_ref})=>this.auth.isPrincipalActive({principal_id,channel:'trusted_ui',session_ref,expires_at:0})});
  const workflow=new FixedWorkflowService({repository,facts,adoption});
  // The created-task chain is assembled over the ORIGINAL database. It is activated
  // only with the local material registry, because the real preparation proof needs
  // the registered bytes; without them the chain stays unavailable.
  const taskRoot=options.taskRoot??options.createdRoot+'-tasks';
  const stage=options.nativeStage??{width:1280,height:720};
  if(this.localAssets){
   const gate=new CreatedTaskGate(host.revisions,repository,authority);
   const verifier=new PreparedDraftVerifier(options.vendorRoot,{stageDomainRoot:taskRoot,blobPath:asset=>this.localAssets!.blobPathForFact(asset)});
   const jobs=host.jobs instanceof PersistentJobStore?host.jobs:new PersistentJobStore(host.revisions);
   this.#tasks=new CreatedTaskApplication({revisions:host.revisions,repository,workflow,authority,jobs,worker:{pollMs:options.worker?.pollMs??250},createProcessor:(store)=>new CreatedDraftTaskProcessor(host,store,gate,repository,workflow,authority,this.localAssets!,verifier,{root:taskRoot,vendorRoot:options.vendorRoot,protectedRoots:[options.createdRoot,host.snapshots.projectRoot(''),options.vendorRoot],width:stage.width,height:stage.height})});
  }
  const context=new ProjectContextService(host,this.creation,authority,workflow,undefined,options.instance?()=>options.instance!().generation:undefined,{
   // ONE receipt resolver for the creation job and the created task jobs. The context
   // and job.read read the same facts.
   read:(projectId,jobId,principalId)=>{
    if(this.#tasks){
     const receipt=this.#tasks.tasks.taskReceipt(jobId,principalId);
     if(receipt&&receipt.project_id===projectId)return receipt;
    }
    // Only the creation job of THIS project has a receipt producer here. A foreign job
    // of an owned project has none, and it is reported as unavailable rather than as a
    // revision conflict.
    if(this.creation.forProject(projectId)?.job_id!==jobId)return null;
    return this.creation.receiptForJob(jobId,principalId);
   },
  });
  const creative=creativeHandlers(new CreativeService({repository,artifactAuthority:authority.assertArtifact,contentAuthority:authority.assertContent}));
  const caller=(principal:AgentPrincipal)=>{
   if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
   return createTrustedCallerContext({principal_id:principal.principal_id,channel:principal.channel,source:principal.channel==='trusted_ui'?'trusted_ui':'driver_relay',session_ref:principal.session_ref});
  };
  this.dispatcher=new ApplicationDispatcher({...creative,
   ...(options.instance?{instance:async()=>options.instance!()}:{}),
   ...(options.health?{'health.read':async()=>options.health!()}:{}),
   'context.read':(input,principal)=>context.read(input.project_id,caller(principal)),
   'workflow.run.read':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.readRun(input,caller(principal));},
   'workflow.read':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.readWorkflow(input.project_id,caller(principal));},
   // The reviewed workflow handlers. Every one of them keeps the owner check, and the
   // ones without a real producer stay unavailable instead of answering a fake success.
   'workflow.run.prepare':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.prepareRun(input,caller(principal));},
   'workflow.run.authorize':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.authorizeRun(input,caller(principal));},
   'workflow.run.start':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.startRun(input,caller(principal));},
   'workflow.run.pause':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.pauseRun(input,caller(principal));},
   'workflow.run.resume':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.resumeRun(input,caller(principal));},
   'workflow.run.cancel':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.cancelRun(input,caller(principal));},
   'review.read':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.readReview(input,caller(principal));},
   'review.decide':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.decideReview(input,caller(principal));},
   'project.create':async(input,principal)=>{
    if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
    if(!host.openFilmComposition)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    return this.worker.create(input,principal.principal_id);
   },
   'job.read':async(input,principal)=>{
    if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
    if(!this.creation.ownsProject(input.project_id,principal.principal_id))throw new AgentRouteError('NOT_FOUND');
    const job=host.revisions.readJob(input.job_id);
    if(!job||job.project_id!==input.project_id)throw new AgentRouteError('NOT_FOUND');
    // A created task and a created project share ONE receipt resolver, so a task job
    // and a creation job are read through the same facts.
    if(this.#tasks){
     const taskReceipt=this.#tasks.tasks.taskReceipt(input.job_id,principal.principal_id);
     if(taskReceipt&&taskReceipt.project_id===input.project_id)return taskReceipt;
    }
    if(this.creation.forProject(input.project_id)?.job_id!==input.job_id)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    const receipt=this.creation.receiptForJob(input.job_id,principal.principal_id);
    if(!receipt||receipt.project_id!==input.project_id)throw new AgentRouteError('NOT_FOUND');
    return receipt;
   },
   'task.prepare':async(input,principal)=>{
    if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
    if(!this.#tasks)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    // Only the kind that has a real executor is admitted. The other kind stays
    // unavailable rather than occupying a job with nothing behind it.
    if(input.kind!=='assemble_draft')throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    if(!this.creation.ownsProject(input.project_id,principal.principal_id))throw new AgentRouteError('NOT_FOUND');
    const reserved=this.#tasks.tasks.reserve(input,principal.principal_id,{job_kind:'snapshot_publish',max_attempts:3});
    return reserved.task.accepted;
   },
   'job.cancel':async(input,principal)=>{
    if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
    if(!this.#tasks)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    if(!this.creation.ownsProject(input.project_id,principal.principal_id))throw new AgentRouteError('NOT_FOUND');
    const task=this.#tasks.tasks.read(input.job_id,principal.principal_id);
    if(task.request.project_id!==input.project_id)throw new AgentRouteError('NOT_FOUND');
    // The cancellation must name the very execution binding of the reservation.
    const execution=input.execution,e=task.request.execution;
    if(execution.run_id!==e.run_id||execution.plan_version!==e.plan_version||execution.step_id!==e.step_id||execution.attempt!==e.attempt||execution.input_digest!==e.input_digest||execution.run_scope_digest!==e.run_scope_digest||execution.authorization_id!==e.authorization_id)throw new AgentRouteError('REVISION_CONFLICT');
    const jobs=host.jobs instanceof PersistentJobStore?host.jobs:new PersistentJobStore(host.revisions);
    jobs.requestCancel(input.job_id);
    return this.#tasks.tasks.receipt(input.job_id,principal.principal_id);
   },
  });
 }

 /** The one native-open service. The Host route and the workbench delegate both go
  * through it, so a reopened native view is the very same entry the Host issues. */
 async #openNative(projectId:string,principal:AgentPrincipal):Promise<unknown>{
  if(principal.channel!=='trusted_ui'||!this.auth.isPrincipalActive(principal))throw new ProductError('UNAUTHORIZED','A current trusted workbench is required');
  const caller=createTrustedCallerContext({principal_id:principal.principal_id,channel:'trusted_ui',source:'trusted_ui',session_ref:principal.session_ref});
  const prepared=await this.nativeWorkspaces.prepare(projectId,caller);
  const descriptor=await this.#host.m5Supervisor.ensure(projectId,'created-native-open');
  if(!this.auth.isPrincipalActive(principal))throw new ProductError('UNAUTHORIZED','The workbench session ended');
  if(!this.nativeWorkspaces.isPrepared(prepared))throw new ProductError('REVISION_CONFLICT','The prepared native version changed');
  const path=new URL(descriptor.url).pathname.match(/^\/projects\/([A-Za-z0-9_-]{1,200})$/);if(!path)throw new ProductError('CAPABILITY_UNAVAILABLE','The native project identity is unavailable');
  const generation=this.#options.instance?.().generation??1;
  const entry=this.#host.issueNativeEntry({project_id:projectId,native_project_id:path[1]!,owner_session_ref:principal.session_ref,instance_generation:generation,revision:prepared.revision,snapshot_id:prepared.snapshot_id,source_digest:prepared.source_digest,isCurrent:()=>(this.#options.instance?.().generation??1)===generation&&this.auth.isPrincipalActive(principal)&&this.nativeWorkspaces.isPrepared(prepared),readWorkbench:()=>this.createdWorkbench.read(projectId,caller),ui:this.#uiDelegate(projectId,principal,generation)});
  return validateNativeEntry({format:'narralens.native-entry@1.0',project_id:projectId,revision:prepared.revision,snapshot_id:prepared.snapshot_id,native_state:'unconfirmed',...entry});
 }

 /** The independent workbench UI delegate (CR-R1-001 §2).
  *
  * It is created here, in the authenticated trusted UI branch, and never from a request
  * body. It captures the real principal, the real project and the real owner session,
  * and it calls this application's own dispatcher and services - never an HTTP loopback
  * and never a second authority. */
 #uiDelegate(projectId:string,principal:AgentPrincipal,generation:number):NativeStudioUiGrantV1 {
  const parentExpiry=principal.expires_at;
  const expiry=Math.min(parentExpiry,Date.now()+UI_MAX_LIFETIME_MS);
  const isCurrent=()=>this.auth.isPrincipalActive(principal)&&(this.#options.instance?.().generation??1)===generation;
  const caller=createTrustedCallerContext({principal_id:principal.principal_id,channel:'trusted_ui',source:'trusted_ui',session_ref:principal.session_ref});
  return {
   project_id:projectId,
   owner_session_ref:principal.session_ref,
   instance_generation:generation,
   expires_at:expiry,
   isCurrent,
   invoke:(input:NativeStudioUiInvokeInput)=>this.#uiInvoke(input,projectId,principal,caller),
   openReviewMedia:async(input:{readonly ref:string;readonly range?:{readonly offset:number;readonly length:number};readonly signal?:AbortSignal})=>{
    // The supplied signal is forwarded into the real reader, and the owner and the
    // current package binding are checked before and after the open.
    const media=await this.#reviewMedia.openMedia(projectId,input.ref,{principal_id:principal.principal_id,channel:principal.channel,session_ref:principal.session_ref},{...(input.range===undefined?{}:{range:input.range}),...(input.signal===undefined?{}:{signal:input.signal})});
    return media;
   },
  };
 }

 /** One closed UI call. The envelope carries the original DTO untouched, and the
  * original validators see exactly what the caller sent. */
 async #uiInvoke(input:NativeStudioUiInvokeInput,projectId:string,principal:AgentPrincipal,caller:ReturnType<typeof createTrustedCallerContext>):Promise<NativeStudioUiInvokeResult>{
  try{
   // The closed set is enforced on both sides of the boundary: the gateway consults the
   // same registry, and the delegate refuses an operation the registry does not name.
   const allowed=workbenchUiRegistry.operation_allowlist[input.surface];
   if(!allowed||!allowed.includes(input.operation))throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
   if(input.surface==='agent.v1'){
    const route=agentRoutes.find(row=>row.id===input.operation);
    if(!route)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    const validated=route.input===null?undefined:validateAgentRouteInput(route.id as AgentRouteId,input.input);
    const result=await (this.dispatcher.invoke as unknown as (id:string,value:unknown,who:AgentPrincipal)=>Promise<unknown>)(route.id,validated,principal);
    return {status:200,body:validateAgentRouteOutput(route.id as AgentRouteId,result)};
   }
   if(input.surface==='local-assets.v1'){
    if(!this.#inventory)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    if(input.operation==='local-source-files.read')return {status:200,body:await this.#inventory.listSourceFiles(projectId,caller,this.#query(input.input))};
    if(input.operation==='local-assets.import')return {status:200,body:await this.#inventory.importAsset(projectId,input.input,caller)};
    if(input.operation==='local-assets.read.ui'||input.operation==='asset-inventory.read')return {status:200,body:await this.#inventory.readInventory(projectId,caller,this.#query(input.input))};
    throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
   }
   if(input.surface==='workbench.v1'){
    if(input.operation==='native.reopen'){
     // The input is exactly empty: the project comes from the delegate.
     if(input.input!==undefined&&input.input!==null&&(typeof input.input!=='object'||Array.isArray(input.input))&&Object.keys(input.input as object).length>0)throw new AgentRouteError('INVALID_REQUEST');
     return {status:200,body:await this.#openNative(projectId,principal)};
    }
    if(input.operation==='review.part.describe'){
     const value=input.input;
     if(!value||typeof value!=='object'||Array.isArray(value))throw new AgentRouteError('INVALID_REQUEST');
     const record=value as Record<string,unknown>;
     const keys=Object.keys(record).sort().join(',');
     if(keys!=='artifact_ref,package_id,package_version,part_kind,run_id')throw new AgentRouteError('INVALID_REQUEST');
     const ref=record['artifact_ref'];
     if(!ref||typeof ref!=='object'||Array.isArray(ref))throw new AgentRouteError('INVALID_REQUEST');
     const refRecord=ref as Record<string,unknown>;
     if(typeof record['run_id']!=='string'||typeof record['package_id']!=='string'||!Number.isSafeInteger(record['package_version'])||typeof record['part_kind']!=='string'||typeof refRecord['id']!=='string'||!Number.isSafeInteger(refRecord['version'])||typeof refRecord['sha256']!=='string')throw new AgentRouteError('INVALID_REQUEST');
     return {status:200,body:await this.#reviewMedia.describe({run_id:record['run_id'],package_id:record['package_id'],package_version:record['package_version'] as number,part_kind:record['part_kind'],artifact_ref:{id:refRecord['id'],version:refRecord['version'] as number,sha256:refRecord['sha256']}},projectId,caller)};
    }
    throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
   }
   throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
  }catch(error){
   const code=agentErrorCode(error);
   const status=STATUS.get(code)??500;
   return {status,body:validateAgentDefinition('Error',{schema_version:'agent.v1',correlation_id:randomUUID(),code,http_status:status,message:'该操作当前不可用或被拒绝。',retryable:code==='HOST_RESOURCE_EXHAUSTED',next_actions:['open_trusted_workbench']})};
  }
 }

 /** The closed query of the adjunct reads. */
 #query(value:unknown):{limit?:number;cursor?:string|null}{
  if(value===undefined||value===null)return {};
  if(typeof value!=='object'||Array.isArray(value))throw new AgentRouteError('INVALID_REQUEST');
  const record=value as Record<string,unknown>;
  const out:{limit?:number;cursor?:string|null}={};
  if(record['limit']!==undefined){
   if(!Number.isSafeInteger(record['limit']))throw new AgentRouteError('INVALID_REQUEST');
   out.limit=record['limit'] as number;
  }
  if(record['cursor']!==undefined&&record['cursor']!==null){
   if(typeof record['cursor']!=='string')throw new AgentRouteError('INVALID_REQUEST');
   out.cursor=record['cursor'];
  }
  return out;
 }

 async handleWorkbenchSession(request:IncomingMessage,response:ServerResponse){if(await this.workbenchSessions?.handle(request,response))return true;if(await this.#localAssetsHttp?.handle(request,response))return true;if(await this.#reviewMedia.handle(request,response))return true;return this.#workbenchRead.handle(request,response);}
 nativeSourceRootFor(projectId:string){return this.nativeWorkspaces.rootFor(projectId).then(root=>root.value);}
 closeAfterNative(){return this.nativeWorkspaces.disposeAfterNative();}
 leaseReaperExclusions(){return [...this.creation.pending().map(row=>row.job_id),...(this.#tasks?.leaseReaperExclusions()??[])];}
 async recoverBeforeGeneric(){await this.worker.recoverBeforeGeneric();this.#tasks?.recoverBeforeGeneric();}
 start(){this.worker.start();this.#tasks?.start();}
 close(){this.createdWorkbench.close();this.workbenchSessions?.close();return this.#closing??=this.#closeSequence();}
 /** The close order is a sequence, not a race: the worker, then the task chain and its
  * processor, then the registry it reads its bytes from, then the native lifecycle. */
 async #closeSequence():Promise<void>{
  await this.worker.close();
  await this.#tasks?.close();
  await this.localAssets?.close();
  await this.nativeWorkspaces.close();
 }
}
