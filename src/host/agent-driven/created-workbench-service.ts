import {validateOwnedProjects,type OwnedProjectsPage} from '../../contracts/owned-projects.js';
import type {NarralensHost} from '../server.js';
import type {ProjectCreationStore} from '../projects/project-creation-store.js';
import type {TrustedCallerContext} from '../creative/product-repository.js';
import {ProductError,isTrustedCallerContext} from '../creative/trusted-context.js';
import {CreativeProjectAuthority} from './creative-project-authority.js';
import {validateCreatedWorkbench,type CreatedWorkbenchProjection} from '../../contracts/created-workbench.js';
import type {PublicLockV1} from '../../contracts/wave3-types.js';
/** Reads durable facts and actual engine projection only. GET cannot start native,
 * create a workspace, sign a review, write a revision or manufacture a loaded ack. */
export class CreatedWorkbenchService {
 readonly #authority:CreativeProjectAuthority;
 #closed=false;
 constructor(private readonly host:NarralensHost,creation:ProjectCreationStore){this.#authority=new CreativeProjectAuthority(creation);}
 close(){this.#closed=true;}
 list(caller:TrustedCallerContext,after:string|null=null):OwnedProjectsPage {
  if(this.#closed)throw new ProductError('CAPABILITY_UNAVAILABLE','The workbench is closing');
  if(!isTrustedCallerContext(caller)||caller.channel!=='trusted_ui')throw new ProductError('ORIGIN_REJECTED','A trusted workbench session is required');
  if(after!==null&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(after))throw new ProductError('INVALID_REQUEST','Invalid project page');
  const rows=this.host.revisions.compose(db=>db.prepare(`SELECT c.reserved_project_id AS project_id FROM cp_a0_bootstrap_command c
    JOIN cp_a0_project_origin o ON o.project_id=c.reserved_project_id
    WHERE c.principal_id=? AND c.state='committed' AND o.origin='created' AND c.reserved_project_id>?
    ORDER BY c.reserved_project_id LIMIT 25`).all(caller.principal_id,after??''));
  const projects=rows.slice(0,24).map(row=>{
   const id=String(row.project_id);this.#authority.assertOwner(id,caller.principal_id);
   const reservation=this.#authority.creation.forProject(id);if(!reservation)throw new ProductError('CAPABILITY_UNAVAILABLE','A saved project has no creation facts');
   const commit=this.host.revisions.activeCommit(id),fact=commit?this.#authority.creation.sourceFact(id,commit.snapshot_id):null;
   return {project_id:id,title:reservation.brief.topic,project_revision:commit?.revision??null,snapshot_id:commit?.snapshot_id??null,saved_at:commit?.created_at??null,frame_count:fact?.frame_count??null,state:!commit||!fact||this.host.revisions.recoveryGate(id,0)?'attention':'saved'};
  });
  return validateOwnedProjects({format:'narralens.owned-projects@1.0',projects,next_after:rows.length>24?projects[projects.length-1]!.project_id:null});
 }
 async read(projectId:string,caller:TrustedCallerContext):Promise<CreatedWorkbenchProjection>{
  if(this.#closed)throw new ProductError('CAPABILITY_UNAVAILABLE','The workbench is closing');
  if(!isTrustedCallerContext(caller)||caller.channel!=='trusted_ui')throw new ProductError('ORIGIN_REJECTED','A trusted workbench session is required');
  this.#authority.assertOwner(projectId,caller.principal_id);
  const view=await this.host.projectResolver.resolveCreated(projectId);
  await this.host.projections.layoutFor(view);
  const {port}=this.host.engines.resolveVerified(projectId,view.engine_upstream_sha,'created-workbench-read');
  const projection=await port.inspect({project_id:projectId,engine:'openfilm',source_digest:view.source_digest},{projectId,correlationId:'created-workbench-read',signal:AbortSignal.timeout(20000)});
  if(this.#closed)throw new ProductError('CAPABILITY_UNAVAILABLE','The workbench is closing');
  this.#authority.assertOwner(projectId,caller.principal_id);
  const current=this.host.revisions.activeCommit(projectId);
  if(!current||current.snapshot_id!==view.snapshot_id||current.revision!==view.revision||current.source_digest!==view.source_digest||this.host.revisions.controlRevision(projectId,0)!==view.control_revision||this.host.revisions.recoveryGate(projectId,0))throw new ProductError('REVISION_CONFLICT','The committed project changed while reading');
  if(projection.engine!=='openfilm'||projection.engine_upstream_sha!==view.engine_upstream_sha||projection.source_digest!==view.source_digest||projection.frame_count!==view.frame_count||projection.fps.num!==view.fps.num||projection.fps.den!==view.fps.den)throw new ProductError('REVISION_CONFLICT','The native source differs from committed facts');
  if(projection.problems.length)throw new ProductError('CAPABILITY_UNAVAILABLE','The native projection is incomplete');
  return validateCreatedWorkbench({format:'narralens.created-workbench@1.0',origin:'created',project_id:projectId,source_project_id:null,migration_id:null,
   revision:view.revision,control_revision:view.control_revision,source_digest:view.source_digest,active_snapshot_id:view.snapshot_id,fps:view.fps,frame_count:view.frame_count,engine:'openfilm',engine_upstream_sha:view.engine_upstream_sha,
   tracks:projection.tracks.map(t=>({track_id:t.track_id,index:t.index,clip_ids:[...t.clip_ids]})),
   clips:projection.clips.map(c=>({clip_id:c.clip_id,track_id:c.track_id,kind:c.kind,start_frame:c.frame_range.start_frame,end_frame_exclusive:c.frame_range.end_frame_exclusive,source_shot_id:null,source_label:null})),
   history:this.host.revisions.projectTransactions(projectId).filter(t=>t.state==='committed').map(t=>({revision:t.base_revision+1,snapshot_id:t.snapshot_id,kind:t.kind,transaction_id:t.transaction_id})),
   active_locks:this.host.locks.activeLocks(projectId).map(lock=>({format:'narralens.public-lock@1.0',lock_id:lock.lock_id,project_id:projectId,lock_type:lock.lock_type,scope:lock.scope,target_id:lock.scope==='project'?null:lock.target_id,start_frame:lock.start_frame,end_frame_exclusive:lock.end_frame_exclusive,owner_label:'本机操作者',reason_code:lock.reason as PublicLockV1['reason_code'],control_revision:lock.control_revision,created_at:lock.created_at})),
   capabilities:Object.keys(projection.editable_capabilities.entries).sort().map(entry_id=>({entry_id,state:'blocked',reason:'当前新建工程尚未注册此写入能力'})),
   preview:null,native_sync:'unknown',narration:projection.clips.some(c=>c.kind==='sound')?'unknown':'absent'});
 }
}
