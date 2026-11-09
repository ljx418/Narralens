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
