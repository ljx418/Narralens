import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import type {RevisionStore} from '../projects/revision-store.js';
import type {SnapshotStore} from '../projects/snapshot-store.js';
import type {ProjectCreationStore,CreatedSourceFact} from '../projects/project-creation-store.js';
import type {SnapshotReadPort,SnapshotReadRequest,SnapshotClosure,SnapshotEntry} from '../render/ports.js';
import {snapshotIdFor} from '../projects/snapshot-store.js';
import {canonicalDigest} from '../creative/digest.js';
import {ProductError} from '../creative/trusted-context.js';
import {asHostResourceError} from '../api-error.js';
import {computeSourceDigest} from '../engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../engine/engine-binding-store.js';
import {OpenFilmEngineAdapter} from '../../adapters/openfilm/openfilm-engine-adapter.js';
import {createPinnedOpenFilmUpstream} from '../../adapters/openfilm/openfilm-upstream.js';
import {CreativeProjectAuthority} from './creative-project-authority.js';

interface CommitBinding {
 readonly project_id:string;
 readonly transaction_id:string;
 readonly snapshot_id:string;
 readonly source_digest:string;
 readonly project_revision:number;
 readonly fact:CreatedSourceFact;
}
const id=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const missing=()=>new ProductError('NOT_FOUND','No owned committed snapshot');
const changed=()=>new ProductError('REVISION_CONFLICT','The committed snapshot facts or bytes changed');
/** Host-only factory. The render attempt gets a reader for ONE durable commit, not live source.
 * This is read authority, not authorization to dispatch, charge, publish or mark a Job ready.
 */
export class CommittedSnapshotAuthority {
 readonly #owner:CreativeProjectAuthority;
 #adapter:Promise<OpenFilmEngineAdapter>|undefined;
 constructor(private readonly revisions:RevisionStore,private readonly snapshots:SnapshotStore,private readonly creation:ProjectCreationStore,private readonly vendorRoot:string){this.#owner=new CreativeProjectAuthority(creation);}
 readerForTransaction(projectId:string,transactionId:string,principalId:string):SnapshotReadPort {
  if(!id.test(projectId)||!id.test(transactionId))throw missing();
  const binding=this.#bind(projectId,transactionId,principalId);
  return Object.freeze({readSnapshot:async(request:SnapshotReadRequest)=>{
   try{return await this.#read(binding,principalId,request);}
   catch(error){
    if(error instanceof ProductError)throw error;
    if(asHostResourceError(error))throw new ProductError('HOST_RESOURCE_EXHAUSTED','Committed snapshot verification could not complete');
    // The media service carries this message into its outcome: never leak Host paths.
    throw new ProductError('CAPABILITY_UNAVAILABLE','Committed snapshot verification is unavailable');
   }
  }});
 }
 #bind(projectId:string,transactionId:string,principalId:string):CommitBinding {
  this.#owner.assertOwner(projectId,principalId);
  const transaction=this.revisions.projectTransaction(transactionId);
  if(!transaction||transaction.project_id!==projectId||transaction.state!=='committed')throw missing();
  const snapshot=this.revisions.snapshotRow(transaction.snapshot_id);
  if(!snapshot||snapshot.project_id!==projectId||snapshot.engine!=='openfilm'||snapshot.source_digest!==transaction.source_digest_after||snapshot.snapshot_id!==snapshotIdFor(projectId,snapshot.source_digest))throw changed();
  const revision=transaction.base_revision+1;
  if(!Number.isSafeInteger(revision)||revision<1)throw changed();
  const fact=this.creation.sourceFact(projectId,snapshot.snapshot_id);
  if(!fact)throw new ProductError('CAPABILITY_UNAVAILABLE','This snapshot has no registered created-source producer');
  return {project_id:projectId,transaction_id:transactionId,snapshot_id:snapshot.snapshot_id,source_digest:snapshot.source_digest,project_revision:revision,fact};
 }
 async #loadAdapter():Promise<OpenFilmEngineAdapter>{
  const pending=this.#adapter??=createPinnedOpenFilmUpstream(this.vendorRoot).then(upstream=>new OpenFilmEngineAdapter(upstream));
  try{return await pending;}
  catch(error){if(this.#adapter===pending)this.#adapter=undefined;throw error;}
 }
 async #read(binding:CommitBinding,principalId:string,request:SnapshotReadRequest):Promise<SnapshotClosure>{
  if(request.project_id!==binding.project_id||request.snapshot_id!==binding.snapshot_id)throw missing();
  if(request.source_digest!==undefined&&request.source_digest!==binding.source_digest)throw changed();
  const assertBinding=()=>{if(canonicalDigest(this.#bind(binding.project_id,binding.transaction_id,principalId))!==canonicalDigest(binding))throw changed();};
  assertBinding();
  const project=this.snapshots.projectRoot(binding.project_id),directory=this.snapshots.snapshotRoot(binding.project_id,binding.snapshot_id),root=resolve(directory,'source');
  for(const path of [project,directory,root]){
   const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path)throw changed();
  }
  if(!directory.startsWith(project+sep)||root!==resolve(directory,'source'))throw changed();
  const digest=await computeSourceDigest({root,roots:binding.fact.roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
  if(digest.source_digest!==binding.source_digest||digest.external_reference_count!==0)throw changed();
  const observedMedia=digest.manifest.assets.map(row=>({path:row.path,sha256:row.sha256,bytes:row.size})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const recordedMedia=binding.fact.assets.map(row=>({path:row.path,sha256:row.sha256,bytes:row.bytes})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(canonicalDigest(observedMedia)!==canonicalDigest(recordedMedia))throw changed();
  const projection=await (await this.#loadAdapter()).inspectSnapshot({root,roots:binding.fact.roots,subtitles:binding.fact.subtitles},binding.source_digest,{projectId:binding.project_id,correlationId:binding.transaction_id,signal:AbortSignal.timeout(20000)});
  if(projection.problems.length||projection.frame_count!==binding.fact.frame_count||projection.fps.num!==binding.fact.fps.num||projection.fps.den!==binding.fact.fps.den||projection.source_digest!==binding.source_digest)throw changed();
  const entries:SnapshotEntry[]=[];
  const assets=new Map(binding.fact.assets.map(asset=>[asset.path,asset]));
  const subtitles=new Set(binding.fact.subtitles.map(subtitle=>subtitle.path));
  for(const file of [...digest.manifest.files,...digest.manifest.assets]){
   const path=resolve(root,file.path);
   if(!path.startsWith(root+sep)||await realpath(path)!==path)throw changed();
   const handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
   try{
    if(!(await handle.stat()).isFile())throw changed();
    const bytes=await handle.readFile();
    if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256||await realpath(path)!==path)throw changed();
   }finally{await handle.close();}
   const asset=assets.get(file.path);
   // Third-party fonts and unknown files are assets, never implicitly first-party source.
   const role='role' in file?file.role:undefined;
   const kind=subtitles.has(file.path)?'supplement':asset||role==='font'||role===undefined?'asset':'native_source';
   entries.push({relative_path:file.path,absolute_path:path,sha256:file.sha256,bytes:file.size,kind,rights_ref:asset?.asset_id??null,role:kind==='supplement'?'subtitles':null});
  }
  assertBinding();
  return {project_id:binding.project_id,snapshot_id:binding.snapshot_id,source_digest:binding.source_digest,project_revision:binding.project_revision,expected_frames:binding.fact.frame_count,expected_duration_seconds:binding.fact.frame_count*binding.fact.fps.den/binding.fact.fps.num,native_root:root,native_entry:'film.html',entries,rights:binding.fact.assets.map(asset=>({asset_id:asset.asset_id,status:asset.license.status,commercial_use:asset.license.commercial_use,ref:asset.asset_id}))};
 }
}
