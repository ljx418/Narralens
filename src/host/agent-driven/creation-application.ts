import {validateNativeEntry} from '../../contracts/owned-projects.js';
import {CreatedWorkbenchService} from './created-workbench-service.js';
import {CreatedWorkbenchHttp} from './created-workbench-http.js';
import {CreatedNativeWorkspaceService} from './created-native-workspace.js';
import {createHash} from 'node:crypto';
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

/** Actual Host composition for the first creation chain, not an alternate server.
 * Remaining workflow/context/render producers stay explicitly unavailable until wired.
 * Credential provisioning remains Host-only; this class exposes no credential HTTP route.
 */
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
 #tasks:CreatedTaskApplication|null=null;
 #closing:Promise<void>|undefined;
 readonly worker:ProjectCreationService;
 constructor(host:NarralensHost,options:{createdRoot:string;vendorRoot:string;nativeWorkspaceRoot?:string;taskRoot?:string;nativeStage?:{width:number;height:number};worker?:Pick<CreationServiceDeps,'leaseMs'|'pollMs'|'boundary'>;instance?:()=>Instance;health?:()=>HealthRead;workbench?:{principalId:string;operatorSecret:string};localAssets?:Omit<LocalAssetRegistryOptions,'projectsRoot'|'snapshotsRoot'>}){
  const cookieName=options.instance?'narralens_a_'+createHash('sha256').update(options.instance().instance_id).digest('hex').slice(0,24):'narralens_a_session';
  this.auth=new ScopedAgentAuth(()=>host.origin,Date.now,cookieName,{requireUiReadProof:!!options.workbench});
  this.workbenchSessions=options.workbench?new WorkbenchSessionService(this.auth,()=>host.origin,options.workbench.principalId,options.workbench.operatorSecret):null;
  const verifier=new CreationSourceVerifier(host.snapshots,options.vendorRoot,options.createdRoot);
  this.creation=new ProjectCreationStore(host.revisions,()=>new Date(),verifier);
  host.projectResolver.attachCreatedProjects(this.creation,options.createdRoot);
  this.committedSnapshots=new CommittedSnapshotAuthority(host.revisions,host.snapshots,this.creation,options.vendorRoot);
  this.nativeWorkspaces=new CreatedNativeWorkspaceService(host.revisions,this.creation,this.committedSnapshots,{root:options.nativeWorkspaceRoot??options.createdRoot+'-native-workspaces',protectedRoots:[options.createdRoot,host.snapshots.projectRoot(''),options.vendorRoot,...(host.nativeStudioRuntimeRoot?[host.nativeStudioRuntimeRoot]:[])]});
  this.createdWorkbench=new CreatedWorkbenchService(host,this.creation);
  this.#workbenchRead=new CreatedWorkbenchHttp(this.auth,()=>host.origin,this.createdWorkbench,async(projectId,principal)=>{
   if(principal.channel!=='trusted_ui'||!this.auth.isPrincipalActive(principal))throw new ProductError('UNAUTHORIZED','A current trusted workbench is required');
   const caller=createTrustedCallerContext({principal_id:principal.principal_id,channel:'trusted_ui',source:'trusted_ui',session_ref:principal.session_ref});
   const prepared=await this.nativeWorkspaces.prepare(projectId,caller);
   const descriptor=await host.m5Supervisor.ensure(projectId,'created-native-open');
   if(!this.auth.isPrincipalActive(principal))throw new ProductError('UNAUTHORIZED','The workbench session ended');
   if(!this.nativeWorkspaces.isPrepared(prepared))throw new ProductError('REVISION_CONFLICT','The prepared native version changed');
   const path=new URL(descriptor.url).pathname.match(/^\/projects\/([A-Za-z0-9_-]{1,200})$/);if(!path)throw new ProductError('CAPABILITY_UNAVAILABLE','The native project identity is unavailable');
   const generation=options.instance?.().generation??1;
   const entry=host.issueNativeEntry({project_id:projectId,native_project_id:path[1]!,owner_session_ref:principal.session_ref,instance_generation:generation,revision:prepared.revision,snapshot_id:prepared.snapshot_id,source_digest:prepared.source_digest,isCurrent:()=>(options.instance?.().generation??1)===generation&&this.auth.isPrincipalActive(principal)&&this.nativeWorkspaces.isPrepared(prepared),readWorkbench:()=>this.createdWorkbench.read(projectId,caller)});
   return validateNativeEntry({format:'narralens.native-entry@1.0',project_id:projectId,revision:prepared.revision,snapshot_id:prepared.snapshot_id,native_state:'unconfirmed',...entry});
  });
  this.localAssets=options.localAssets?new LocalAssetRegistry(host.revisions,this.creation,{...options.localAssets,projectsRoot:options.createdRoot,snapshotsRoot:host.snapshots.projectRoot('')}):null;
  // The adjunct local-material transport. It exists only when the Host configured a
  // source root; without one there is nothing to list, to register or to read.
  this.#inventory=this.localAssets?new AssetInventory({registry:this.localAssets}):null;
  this.#localAssetsHttp=this.#inventory?new LocalAssetHttp(this.auth,()=>host.origin,this.#inventory):null;
  this.worker=new ProjectCreationService({store:this.creation,coordinator:host.coordinator,snapshots:host.snapshots,verifier,createdRoot:options.createdRoot,...options.worker});
  const authority=new CreativeProjectAuthority(this.creation);
  const repository=new ProductSqliteRepository(host.revisions);
  // The facts are the real ones: the active commit, the control revision, the local
  // material closure and the registered capability manifest. A missing capability is
  // not a capability, so a run stays unavailable until MAIN registers the producers.
  const facts=new CreatedRunFacts({revisions:host.revisions,creation:this.creation,...(this.#inventory?{inventory:this.#inventory}:{})});
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
  const context=new ProjectContextService(host,this.creation,authority,workflow,undefined,options.instance?()=>options.instance!().generation:undefined);
  const creative=creativeHandlers(new CreativeService({repository,artifactAuthority:authority.assertArtifact,contentAuthority:authority.assertContent}));
  const caller=(principal:import('./scoped-auth.js').AgentPrincipal)=>{
   if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
   return createTrustedCallerContext({principal_id:principal.principal_id,channel:principal.channel,source:principal.channel==='trusted_ui'?'trusted_ui':'driver_relay',session_ref:principal.session_ref});
  };
  this.dispatcher=new ApplicationDispatcher({...creative,
   ...(options.instance?{instance:async()=>options.instance!()}:{}),
   ...(options.health?{'health.read':async()=>options.health!()}:{}),
   'context.read':(input,principal)=>context.read(input.project_id,caller(principal)),
   'workflow.run.read':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.readRun(input,caller(principal));},
   'workflow.read':(input,principal)=>{authority.assertOwner(input.project_id,principal.principal_id);return workflow.readWorkflow(input.project_id,caller(principal));},
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
 async handleWorkbenchSession(request:IncomingMessage,response:ServerResponse){if(await this.workbenchSessions?.handle(request,response))return true;if(await this.#localAssetsHttp?.handle(request,response))return true;return this.#workbenchRead.handle(request,response);}
 nativeSourceRootFor(projectId:string){return this.nativeWorkspaces.rootFor(projectId).then(root=>root.value);}
 closeAfterNative(){return this.nativeWorkspaces.disposeAfterNative();}
 leaseReaperExclusions(){return [...this.creation.pending().map(row=>row.job_id),...(this.#tasks?.leaseReaperExclusions()??[])];}
 async recoverBeforeGeneric(){await this.worker.recoverBeforeGeneric();this.#tasks?.recoverBeforeGeneric();}
 start(){this.worker.start();this.#tasks?.start();}
 close(){this.createdWorkbench.close();this.workbenchSessions?.close();return this.#closing??=Promise.all([this.worker.close(),this.#tasks?.close(),this.localAssets?.close(),this.nativeWorkspaces.close()]).then(()=>undefined);}
}
