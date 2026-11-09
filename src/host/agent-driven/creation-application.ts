import type {NarralensHost,AgentHostApplication} from '../server.js';
import {CreativeService} from '../creative/creative-service.js';
import {ProjectCreationStore} from '../projects/project-creation-store.js';
import {ProjectCreationService,type CreationServiceDeps} from '../projects/project-creation-service.js';
import {CreationSourceVerifier} from '../projects/creation-source-verifier.js';
import {ProductSqliteRepository} from './product-sqlite-repository.js';
import {ScopedAgentAuth} from './scoped-auth.js';
import {ApplicationDispatcher,creativeHandlers} from './application-dispatcher.js';
import {AgentRouteError} from './agent-http-router.js';

/** Actual Host composition for the first creation chain, not an alternate server.
 * Remaining workflow/context/render producers stay explicitly unavailable until wired.
 * Credential provisioning remains Host-only; this class exposes no credential HTTP route.
 */
export class CreationApplication implements AgentHostApplication {
 readonly auth:ScopedAgentAuth;
 readonly dispatcher:ApplicationDispatcher;
 readonly creation:ProjectCreationStore;
 readonly worker:ProjectCreationService;
 constructor(host:NarralensHost,options:{createdRoot:string;vendorRoot:string;worker?:Pick<CreationServiceDeps,'leaseMs'|'pollMs'|'boundary'>}){
  this.auth=new ScopedAgentAuth(()=>host.origin);
  const verifier=new CreationSourceVerifier(host.snapshots,options.vendorRoot,options.createdRoot);
  this.creation=new ProjectCreationStore(host.revisions,()=>new Date(),verifier);
  host.projectResolver.attachCreatedProjects(this.creation,options.createdRoot);
  this.worker=new ProjectCreationService({store:this.creation,coordinator:host.coordinator,snapshots:host.snapshots,verifier,createdRoot:options.createdRoot,...options.worker});
  const creative=creativeHandlers(new CreativeService({repository:new ProductSqliteRepository(host.revisions)}));
  // Artifact validation requires a real project-fact/capability port; never advertise a placeholder.
  delete creative['artifact.put'];
  this.dispatcher=new ApplicationDispatcher({...creative,
   'project.create':async(input,principal)=>{
    if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
    if(!host.openFilmComposition)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    return this.worker.create(input,principal.principal_id);
   },
   'job.read':async(input,principal)=>{
    if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
    const receipt=this.creation.receiptForJob(input.job_id,principal.principal_id);
    if(!receipt||receipt.project_id!==input.project_id)throw new AgentRouteError('NOT_FOUND');
    return receipt;
   },
  });
 }
 leaseReaperExclusions(){return this.creation.pending().map(row=>row.job_id);}
 recoverBeforeGeneric(){return this.worker.recoverBeforeGeneric();}
 start(){this.worker.start();}
 close(){return this.worker.close();}
}
