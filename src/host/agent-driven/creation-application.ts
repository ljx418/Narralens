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
import {ScopedAgentAuth} from './scoped-auth.js';
import {ApplicationDispatcher,creativeHandlers} from './application-dispatcher.js';
import {FixedWorkflowService} from '../creative/fixed-workflow-service.js';
import {createTrustedCallerContext} from '../creative/trusted-context.js';
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
 #closing:Promise<void>|undefined;
 readonly worker:ProjectCreationService;
 constructor(host:NarralensHost,options:{createdRoot:string;vendorRoot:string;worker?:Pick<CreationServiceDeps,'leaseMs'|'pollMs'|'boundary'>;instance?:()=>Instance;health?:()=>HealthRead;workbench?:{principalId:string;operatorSecret:string};localAssets?:Omit<LocalAssetRegistryOptions,'projectsRoot'|'snapshotsRoot'>}){
  const cookieName=options.instance?'narralens_a_'+createHash('sha256').update(options.instance().instance_id).digest('hex').slice(0,24):'narralens_a_session';
  this.auth=new ScopedAgentAuth(()=>host.origin,Date.now,cookieName,{requireUiReadProof:!!options.workbench});
  this.workbenchSessions=options.workbench?new WorkbenchSessionService(this.auth,()=>host.origin,options.workbench.principalId,options.workbench.operatorSecret):null;
  const verifier=new CreationSourceVerifier(host.snapshots,options.vendorRoot,options.createdRoot);
  this.creation=new ProjectCreationStore(host.revisions,()=>new Date(),verifier);
  host.projectResolver.attachCreatedProjects(this.creation,options.createdRoot);
  this.committedSnapshots=new CommittedSnapshotAuthority(host.revisions,host.snapshots,this.creation,options.vendorRoot);
  this.localAssets=options.localAssets?new LocalAssetRegistry(host.revisions,this.creation,{...options.localAssets,projectsRoot:options.createdRoot,snapshotsRoot:host.snapshots.projectRoot('')}):null;
  this.worker=new ProjectCreationService({store:this.creation,coordinator:host.coordinator,snapshots:host.snapshots,verifier,createdRoot:options.createdRoot,...options.worker});
  const authority=new CreativeProjectAuthority(this.creation);
  const repository=new ProductSqliteRepository(host.revisions);
  const workflow=new FixedWorkflowService({repository});
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
    if(this.creation.forProject(input.project_id)?.job_id!==input.job_id)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    const receipt=this.creation.receiptForJob(input.job_id,principal.principal_id);
    if(!receipt||receipt.project_id!==input.project_id)throw new AgentRouteError('NOT_FOUND');
    return receipt;
   },
  });
 }
 handleWorkbenchSession(request:IncomingMessage,response:ServerResponse){return this.workbenchSessions?.handle(request,response)??Promise.resolve(false);}
 leaseReaperExclusions(){return this.creation.pending().map(row=>row.job_id);}
 recoverBeforeGeneric(){return this.worker.recoverBeforeGeneric();}
 start(){this.worker.start();}
 close(){this.workbenchSessions?.close();return this.#closing??=Promise.all([this.worker.close(),this.localAssets?.close()]).then(()=>undefined);}
}
