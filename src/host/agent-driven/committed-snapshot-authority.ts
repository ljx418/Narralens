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
import {CreatedSourceAdoptionStore} from './created-source-adoption-store.js';
import {assertPreparedAdoptionPlan,preparedAdoptionPlanDigest,type PreparedAdoptionPlanV1} from './created-source-ports.js';
import {preparedSourceConsumerGraph} from './created-source-publisher.js';
import {validateCreatedSourceFact} from '../projects/project-creation-store.js';

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
 /** Created SOURCE_ONLY publications have a richer native vocabulary than the
  * legacy M4 impact projection. Accept ONLY a committed immutable producer lineage,
  * not arbitrary problem filtering or a caller-supplied "complete" flag. */
 async #verifyAdoptedNative(binding:CommitBinding,root:string,digest:Awaited<ReturnType<typeof computeSourceDigest>>):Promise<boolean>{
  const exists=this.revisions.compose(db=>db.prepare("SELECT name FROM sqlite_master WHERE name='created_adopted_source_fact'").get());
  if(!exists)return false;
  const store=new CreatedSourceAdoptionStore(this.revisions),source=store.sourceFact(binding.project_id,binding.snapshot_id);
  if(!source)return false;
  const fact=store.adoptionFact(source.transaction_id);
  const row=this.revisions.compose(db=>db.prepare('SELECT plan_json,plan_sha256 FROM created_impact_fact WHERE impact_id=?').get(source.impact_id));
  if(!fact||!row)throw changed();
  const plan=assertPreparedAdoptionPlan(JSON.parse(String(row.plan_json)) as PreparedAdoptionPlanV1),planDigest=preparedAdoptionPlanDigest(plan);
  const committed=this.revisions.projectTransaction(source.transaction_id);
  if(!committed||committed.state!=='committed'||committed.snapshot_id!==binding.snapshot_id||committed.source_digest_after!==binding.source_digest
   ||source.source_digest!==binding.source_digest||source.plan_sha256!==planDigest||source.facts_digest!==planDigest
   ||row.plan_sha256!==planDigest||fact.project_id!==binding.project_id||fact.expected_snapshot_id!==binding.snapshot_id
   ||fact.target_source_digest!==binding.source_digest||fact.plan_sha256!==planDigest||fact.facts_digest!==planDigest
   ||plan.project_id!==binding.project_id||plan.target_snapshot_id!==binding.snapshot_id||plan.target_source_digest!==binding.source_digest
   ||plan.materialization_id!==source.prepared_source_id||canonicalDigest(plan.native_plan)!==canonicalDigest(fact.native_plan))throw changed();
  const readJson=async(path:string):Promise<unknown>=>{
   const entry=digest.manifest.files.find(file=>file.path===path);if(!entry)throw changed();
   const handle=await open(resolve(root,path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{const stat=await handle.stat();if(!stat.isFile()||stat.size>64*1024*1024||stat.size!==entry.size)throw changed();
    const bytes=await handle.readFile();if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw changed();return JSON.parse(bytes.toString('utf8')) as unknown;
   }finally{await handle.close();}
  };
  const metadata=await readJson('prepared-native.json') as Parameters<typeof preparedSourceConsumerGraph>[0]&{format:string;plan_digest:string};
  const draft=await readJson('draft-plan.json') as Parameters<typeof preparedSourceConsumerGraph>[1];
  if(metadata.format!=='narralens.prepared-native-output@1'||metadata.project_id!==binding.project_id||metadata.plan_digest!==plan.native_plan.native_plan_sha256)throw changed();
  const geometry=validateCreatedSourceFact({schema_version:1,roots:['film.html',...plan.roots.filter(path=>path!=='film.html')],subtitles:metadata.subtitles,frame_count:metadata.frame_count,fps:metadata.fps,
   assets:metadata.assets.map(asset=>({asset_id:asset.asset_id,path:asset.path,sha256:asset.sha256,bytes:asset.bytes,duration_frames:asset.duration_frames,
    media_type:asset.media_type,source:asset.source,license:asset.license}))});
  if(canonicalDigest(geometry)!==canonicalDigest(binding.fact)||geometry.frame_count!==plan.frame_count||geometry.fps.num!==plan.fps_numerator
   ||geometry.fps.den!==plan.fps_denominator||canonicalDigest(preparedSourceConsumerGraph(metadata,draft))!==plan.consumer.graph_digest)throw changed();
  const parsed=await(await createPinnedOpenFilmUpstream(this.vendorRoot)).readProjectFilm(root);
  const film=digest.manifest.files.find(file=>file.path==='film.html');
  if(parsed.problems.length||!film||createHash('sha256').update(parsed.text).digest('hex')!==film.sha256)throw changed();
  const doc=parsed.doc as {tracks?:{clips?:{id?:unknown}[]}[]}|null;
  const ids=doc?.tracks?.flatMap(track=>track.clips?.map(clip=>clip.id)??[])??[];
  if(canonicalDigest(ids)!==canonicalDigest(metadata.clip_ids))throw changed();
  return true;
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
  if(!await this.#verifyAdoptedNative(binding,root,digest)){
   const projection=await (await this.#loadAdapter()).inspectSnapshot({root,roots:binding.fact.roots,subtitles:binding.fact.subtitles},binding.source_digest,{projectId:binding.project_id,correlationId:binding.transaction_id,signal:AbortSignal.timeout(20000)});
   if(projection.problems.length||projection.frame_count!==binding.fact.frame_count||projection.fps.num!==binding.fact.fps.num||projection.fps.den!==binding.fact.fps.den||projection.source_digest!==binding.source_digest)throw changed();
  }
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
