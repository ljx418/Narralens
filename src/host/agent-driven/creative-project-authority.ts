import type {ArtifactPut,Ref,Script,Brief,ContentDecisionRelay} from '../../contracts/agent-driven-types.js';
import {validateAgentDefinition} from '../../contracts/agent-driven-validator.js';
import type {ProductTransaction,TrustedCallerContext,ArtifactVersionRecord} from '../creative/product-repository.js';
import {canonicalDigest} from '../creative/digest.js';
import {creativeInputClosure} from '../creative/creative-closure.js';
import {ProductError} from '../creative/trusted-context.js';
import type {ProjectCreationStore} from '../projects/project-creation-store.js';
/** Authorization and content lineage only. Never approves a Run or writes native source. */
export class CreativeProjectAuthority {
 constructor(readonly creation:ProjectCreationStore){}
 assertOwner(projectId:string,principal:string):void {
  if(!this.creation.ownsProject(projectId,principal)||!this.creation.origin(projectId))throw new ProductError('NOT_FOUND','No owned committed project');
 }
 ref(tx:ProductTransaction,projectId:string,ref:Ref):{namespace:'intake';content:Brief}|{namespace:'artifact';record:ArtifactVersionRecord} {
  const creation=this.creation.forProject(projectId);
  if(creation&&ref.id===creation.request.intake_id){
   if(tx.get('artifact_version',{project_id:projectId,artifact_id:ref.id,version:ref.version}))throw new ProductError('REVIEW_STALE','Ambiguous reference namespace');
   const intake=tx.get('intake_version',{intake_id:ref.id,version:ref.version});
   if(!intake)throw new ProductError('NOT_FOUND','The intake reference is missing');
   if(intake.input_digest!==ref.sha256||canonicalDigest(intake.content_json)!==ref.sha256)throw new ProductError('REVIEW_STALE','The intake reference changed');
   return {namespace:'intake',content:validateAgentDefinition<Brief>('Brief',intake.content_json)};
  }
  const row=tx.get('artifact_version',{project_id:projectId,artifact_id:ref.id,version:ref.version});
  if(!row)throw new ProductError('NOT_FOUND','The input reference is not in this project');
  if(row.content_digest!==ref.sha256||canonicalDigest(row.content_json)!==ref.sha256)throw new ProductError('REVIEW_STALE','The input reference changed');
  return {namespace:'artifact',record:row};
 }
 assertContent=(_tx:ProductTransaction,input:ContentDecisionRelay,caller:TrustedCallerContext):void=>{
  // A pre-project content decision is legitimate and grants no execution authority.
  if(input.project_id===null)return;
  this.assertOwner(input.project_id,caller.principal_id);
  if(this.creation.forProject(input.project_id)?.request.intake_id!==input.intake_id)throw new ProductError('REVIEW_STALE','The content decision intake does not belong to this project');
 };
 assertArtifact=(tx:ProductTransaction,input:ArtifactPut,caller:TrustedCallerContext,phase:'access'|'write'):void=>{
  this.assertOwner(input.project_id,caller.principal_id);
  if(phase==='access')return;
  const created=this.creation.forProject(input.project_id)!;
  if(input.artifact_id===created.request.intake_id)throw new ProductError('INVALID_REQUEST','Artifact identity collides with its intake namespace');
  const head=tx.get('intake_head',{intake_id:created.request.intake_id});
  if(!head||canonicalDigest(creativeInputClosure(tx,created.request.intake_id,head.current_version))!==input.input_digest)throw new ProductError('REVIEW_STALE','The creative input closure changed');
  const refs=new Set<string>();const paragraphs=new Set<string>();
  for(const ref of input.input_refs){
   const key=ref.id+':'+ref.version;if(refs.has(key))throw new ProductError('INVALID_REQUEST','Duplicate input reference');refs.add(key);
   const resolved=this.ref(tx,input.project_id,ref);
   if(resolved.namespace==='artifact'&&resolved.record.kind==='script')for(const paragraph of validateAgentDefinition<Script>('Script',resolved.record.content_json).paragraphs)paragraphs.add(paragraph.paragraph_id);
  }
  const identifiers=input.content.kind==='script'?input.content.paragraphs.map(p=>p.paragraph_id):input.content.shots.map(p=>p.shot_id);
  if(new Set(identifiers).size!==identifiers.length)throw new ProductError('INVALID_REQUEST','Duplicate content identity');
  if(input.content.kind==='storyboard'){
   const brief=tx.get('intake_version',{intake_id:created.request.intake_id,version:head.current_version});
   if(!brief)throw new ProductError('REVIEW_STALE','The current brief is missing');
   for(const shot of input.content.shots){
    if(!paragraphs.has(shot.paragraph_id))throw new ProductError('REVIEW_STALE','The shot paragraph is not in the declared Script');
    if(shot.asset_id!==null&&!brief.content_json.local_asset_ids.includes(shot.asset_id))throw new ProductError('REVIEW_STALE','The shot asset is not in the current material strategy');
   }
  }
 };
}
