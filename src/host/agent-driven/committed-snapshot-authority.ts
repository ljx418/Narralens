import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdtemp,open,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import type {RevisionStore} from '../projects/revision-store.js';
import type {SnapshotStore} from '../projects/snapshot-store.js';
import type {ProjectCreationStore,CreatedSourceFact} from '../projects/project-creation-store.js';
import type {SnapshotReadPort,SnapshotReadRequest,SnapshotClosure,SnapshotEntry} from '../render/ports.js';
import {snapshotIdFor} from '../projects/snapshot-store.js';
import {canonicalDigest} from '../creative/digest.js';
import {ProductError} from '../creative/trusted-context.js';
import {asHostResourceError} from '../api-error.js';
import {computeSourceDigest,SOURCE_DIGEST_DOMAIN,canonicalJson,compareUtf8,extractReferences} from '../engine/source-digest-v1.js';
import type {SourceDigestManifest,SourceFileRole} from '../engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../engine/engine-binding-store.js';
import {OpenFilmEngineAdapter} from '../../adapters/openfilm/openfilm-engine-adapter.js';
import {createPinnedOpenFilmUpstream} from '../../adapters/openfilm/openfilm-upstream.js';
import type {OpenFilmFilmRead} from '../../adapters/openfilm/openfilm-upstream.js';
import {CreativeProjectAuthority} from './creative-project-authority.js';
import {CreatedSourceAdoptionStore} from './created-source-adoption-store.js';
import {assertPreparedAdoptionPlan,preparedAdoptionPlanDigest,type PreparedAdoptionPlanV1} from './created-source-ports.js';
import {preparedSourceConsumerGraph} from './created-source-publisher.js';
import {validateCreatedSourceFact} from '../projects/project-creation-store.js';
import {RetainedNativeClosure,RetainedNativeError,mergeRetainedCleanupCauses,retainedCleanupFailures,markRetainedCleanupFailures,RETAINED_NATIVE_ASSET_EXTENSIONS} from './retained-native-closure.js';
import type {RetainedNativeDescriptorOps,RetainedDescriptorPool} from './retained-native-closure.js';

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
/** The revision fence of the committed source.
 *
 * A failure of the retained tree is the fence, with the named cause attached - EXCEPT
 * the two refusals whose visibility IS the Host's: the budget's own refusal and a
 * release that did not finish. The alias refusal keeps its own code as well, because
 * the READER owns that boundary and translates it into its own reason. */
const revisionFence=(error:unknown):never=>{
 const code=String((error as {code?:unknown}).code??'');
 if(code==='NATIVE_CLOSURE_BUDGET'||code==='NATIVE_CLOSURE_CLEANUP_FAILED')throw error;
 // The GENUINE release failures of the failure it wraps are kept and stay marked:
 // they are the reader's reason to become uncertain.
 const genuine=retainedCleanupFailures(error);
 const refusal=changed(error);
 if(genuine.length>0)markRetainedCleanupFailures(refusal,genuine);
 throw refusal;
};
const changed=(cause?:unknown)=>{
 const error=new ProductError('REVISION_CONFLICT','The committed snapshot facts or bytes changed');
 // The syscall that stopped the work is kept as the cause of the refusal: a refusal
 // that names its reason says nothing about why it stopped.
 if(cause!==undefined){try{Object.defineProperty(error,'cause',{value:cause,enumerable:false,configurable:true});}catch{/* the error carries what it can */}}
 return error;
};

/** The proved facts of one committed native source.
 *
 * These are read-only values: the geometry, the rights, the producer's consumer graph
 * and the committed entries of the very transaction the lease was issued for. */
export interface VerifiedNativeFacts {
 readonly project_id:string;
 readonly transaction_id:string;
 readonly snapshot_id:string;
 readonly source_digest:string;
 readonly project_revision:number;
 readonly native_root:string;
 readonly entries:readonly SnapshotEntry[];
 readonly geometry:CreatedSourceFact;
 readonly consumer_graph:unknown;
 readonly rights:readonly {readonly asset_id:string;readonly status:string;readonly commercial_use:boolean;readonly ref:string}[];
 readonly film:{readonly relative_path:'film.html';readonly sha256:string;readonly bytes:number;readonly native_rev:string};
 readonly film_doc:unknown;
 /** The producer's own plan digest and the digest of the committed plan record. They
  *  are the provenance of every artifact the producer controlled. */
 readonly plan_digest:string;
 readonly plan_sha256:string;
 readonly source_entries:readonly {readonly relative_path:string;readonly sha256:string}[];
 readonly assets:readonly {readonly asset_id:string;readonly path:string;readonly sha256:string;readonly bytes:number;
  readonly status:string;readonly commercial_use:boolean;readonly rights_ref:string}[];
}

/** The opaque lease of one committed native source.
 *
 * It is registered per issuing instance: a copy of it, a lease of another instance, a
 * lease of another owner, project or transaction, and a lease of a transaction that has
 * moved on are all refusals. Its `release` is the only owner of the retained closure. */
export interface VerifiedNativeFactsLease {
 readonly facts:VerifiedNativeFacts;
 /** The retained source tree: the real descriptors of the committed files. */
 readonly closure:RetainedNativeClosure;
 /** The synchronous guard of the authority behind the lease. */
 assertCurrent():boolean;
 /** Release the retained closure. It is attempted once and never retried. */
 release():void;
 readonly released:boolean;
}

interface NativeFactsFacts {
 readonly instance:object;
 readonly binding:CommitBinding;
 readonly principal_id:string;
 readonly closure:RetainedNativeClosure;
 readonly facts:VerifiedNativeFacts;
 /** The producer's lineage at the time of the issue. */
 readonly lineage_digest:string|null;
 released:boolean;
}

/** Whether the authority issued the lease.
 *
 * The brand is not global: only the issuing instance holds the lease's facts, so a copy
 * of a lease and a lease of another authority are both unrecognised here. */
export function isVerifiedNativeFactsLease(authority:CommittedSnapshotAuthority,value:unknown):value is VerifiedNativeFactsLease{
 return authority.isNativeFactsLease(value);
}

/** The extensions the digest treats as media: they are hashed, never parsed.
 *  The set is the pinned `source-digest-v1.ts` set, exactly: a divergence here would
 *  make the recomputed digest differ from the committed one. It is the SAME set the
 *  retained closure uses for its text budget - one definition of "media" in the
 *  Host, so the digest and the budget cannot drift apart. */
const ASSET_EXTENSIONS=RETAINED_NATIVE_ASSET_EXTENSIONS;
const ROLE_BY_EXTENSION=new Map<string,SourceFileRole>([
 ['html','html'],['htm','html'],['js','js'],['mjs','js'],['cjs','js'],
 ['css','css'],['vtt','subtitle'],['srt','subtitle'],['json','settings'],
 ['woff','font'],['woff2','font'],['ttf','font'],['otf','font'],['eot','font'],
]);
const EXTERNAL_SCHEME=/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;
const HASH_BUFFER=64*1024;
const MAX_TEXT_BYTES=8*1024*1024;

const extensionOf=(path:string):string=>{
 const base=path.slice(path.lastIndexOf('/')+1);
 const dot=base.lastIndexOf('.');
 return dot<=0?'':base.slice(dot+1).toLowerCase();
};
const normalizeRelative=(input:string):string=>{
 const value=input.trim();
 if(value===''||value.includes('\\')||value.startsWith('/')||/^[a-z]:/iu.test(value))throw changed();
 const segments=value.split('/').filter(segment=>segment!==''&&segment!=='.');
 if(segments.length===0||segments.includes('..'))throw changed();
 return segments.join('/');
};
const dirnameSlash=(path:string):string=>{
 const index=path.lastIndexOf('/');
 return index<=0?'':path.slice(0,index);
};
const joinRelative=(from:string,target:string):string=>{
 const base=dirnameSlash(from);
 const segments=(base===''?[]:base.split('/')).concat(target.split('/'));
 const stack:string[]=[];
 for(const segment of segments){
  if(segment===''||segment==='.')continue;
  if(segment==='..'){
   if(stack.length===0)return '..';
   stack.pop();
   continue;
  }
  stack.push(segment);
 }
 return stack.join('/');
};
const roleFor=(extension:string,referencedByEntry:boolean):SourceFileRole=>{
 const role=ROLE_BY_EXTENSION.get(extension);
 if(role===undefined)throw changed();
 return role==='html'&&referencedByEntry?'scene':role;
};
const deepFreeze=<T>(value:T):T=>{
 if(value===null||typeof value!=='object')return value;
 if(Array.isArray(value)){for(const item of value)deepFreeze(item);return Object.freeze(value);}
 for(const item of Object.values(value as Record<string,unknown>))deepFreeze(item);
 return Object.freeze(value);
};
/** Host-only factory. The render attempt gets a reader for ONE durable commit, not live source.
 * This is read authority, not authorization to dispatch, charge, publish or mark a Job ready.
 */
/** The Host-private test hooks of one acquisition.
 *
 * They observe; they never state a fact about the source: only the bytes and the
 * digests can. They exist so that a fault may be injected *inside* an acquisition, at
 * the moment the source is being read, and so that a read can be measured.
 */
export interface NativeFactsTestHooks {
 /** Called when a file of the committed source is read. */
 readonly onSourceRead?:(relativePath:string)=>void;
 /** The descriptor operations of the source's closure. */
 readonly closureOps?:RetainedNativeDescriptorOps;
 /**
  * The lifecycle of the PRIVATE parse copy of the film.
  *
  * It reports the real path of the copy this Host allocated and the moment it was
  * released again - on the success path and on the failure path alike. It is an
  * observation: it can never state a fact about the parse.
  */
 readonly onParseCopy?:(event:{readonly kind:'allocated'|'released'|'cleanup_failed';readonly folder:string})=>void;
 /**
  * The Host-private faults at the boundaries of the private parse copy.
  *
  * They reach the REAL boundaries: `beforeParse` runs inside the ownership of the
  * copy, right before the pinned parser reads it, and `remove` replaces the removal
  * of the copy and is expected to do the REAL removal. Neither of them may
  * fabricate a fact about the parse: they can only make the real work fail.
  */
 readonly parseCopy?:{
  readonly beforeParse?:(folder:string)=>Promise<void>;
  readonly remove?:(folder:string)=>Promise<void>;
 };
}

/** The private parse copies this Host has open right now.
 *
 * It is a Host-private fact, and it is what shows that a successful parse settles
 * its copy as well: a copy that is still open is a copy that was forgotten. */
let liveParseCopies=0;
/** The allocations of the private parse copies that were NOT confirmed removed.
 *
 * A removal that did not finish leaves its directory behind, and that directory is
 * still locatable: it is never reported as released, and it is never hidden by a
 * counter that says zero. */
const unsettledParseCopies=new Map<string,number>();
/** How many private parse copies are open right now. Host-private.
 *
 * It counts the allocations that are not confirmed removed - a copy whose removal
 * failed is still an allocation of this Host. */
export function nativeFactsLiveParseCopies():number{return liveParseCopies;}
/** The private parse copies that were not confirmed removed. Host-private. */
export function nativeFactsUnsettledParseCopies():readonly string[]{return [...unsettledParseCopies.keys()];}
/** Forget a parse copy its owner removed after a failed removal.
 *
 * The owner of an allocation is the only one that may say that it is gone: this is
 * how a case that had to clean up after a failed removal puts the ledger right
 * again. It never turns an allocation that is still there into a released one. */
export function forgetUnsettledParseCopy(folder:string):void{
 if(!unsettledParseCopies.has(folder))return;
 unsettledParseCopies.delete(folder);
 liveParseCopies=Math.max(0,liveParseCopies-1);
}
/** Report the lifecycle of a private parse copy. The observer may never break the
 *  accounting, so a failure of the observer is swallowed. */
function reportParseCopy(kind:'allocated'|'released'|'cleanup_failed',folder:string):void{
 try{nativeFactsTestHooks?.onParseCopy?.({kind,folder});}catch{/* the observer can never state a fact */}
}

let nativeFactsTestHooks:NativeFactsTestHooks|undefined;

/** Set the test hooks of the next acquisition. Host-private and test-only. */
export function observeNativeFacts(hooks?:NativeFactsTestHooks):void{
 nativeFactsTestHooks=hooks;
}

export class CommittedSnapshotAuthority {
 readonly #owner:CreativeProjectAuthority;
 /** This instance's own token. A lease of another instance is a foreign lease. */
 readonly #instance={};
 /** The leases this authority issued. A lease of another authority is not in here. */
 readonly #factsLeases=new WeakMap<object,NativeFactsFacts>();
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
 /** Whether this authority issued the lease. A copy of a lease and a lease of another
  *  authority are both unrecognised: the brand is not global. */
 isNativeFactsLease(value:unknown):value is VerifiedNativeFactsLease{
  return !!value&&typeof value==='object'&&this.#factsLeases.has(value);
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
  return (await this.#nativeLineage(binding,root,digest.manifest))!==null;
 }
 /** The proved created-producer lineage of a committed snapshot.
  *
  * It is `null` when this project has no created producer at all — the legacy case,
  * which stays unsupported — and it throws when the lineage contradicts itself. */
 async #nativeLineage(binding:CommitBinding,root:string,manifest:SourceDigestManifest,closure?:RetainedNativeClosure):Promise<{
  metadata:Parameters<typeof preparedSourceConsumerGraph>[0]&{format:string;plan_digest:string};
  draft:Parameters<typeof preparedSourceConsumerGraph>[1];
  graph:ReturnType<typeof preparedSourceConsumerGraph>;
  geometry:CreatedSourceFact;
  doc:unknown;
  film_sha256:string;
  plan_sha256:string;
 }|null>{
  const exists=this.revisions.compose(db=>db.prepare("SELECT name FROM sqlite_master WHERE name='created_adopted_source_fact'").get());
  if(!exists)return null;
  const store=new CreatedSourceAdoptionStore(this.revisions),source=store.sourceFact(binding.project_id,binding.snapshot_id);
  if(!source)return null;
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
   const entry=manifest.files.find(file=>file.path===path);if(!entry)throw changed();
   if(closure!==undefined){
    // The bytes come from the retained descriptor: the identity is the closure's.
    let retained;
    try{retained=await closure.retainFile(path);}
    catch(error){throw error;}
    if(retained.sha256!==entry.sha256||retained.bytes!==entry.size)throw changed();
    let text;
    try{text=await closure.readText(retained);}
    catch(error){throw error;}
    return JSON.parse(text) as unknown;
   }
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
  // The controlled Native path parses a PRIVATE, IMMUTABLE copy of the bytes the
  // closure retained; the legacy render path keeps its own behaviour.
  const parsed=closure!==undefined
   ? await this.#parseRetainedFilm(closure)
   : await(await createPinnedOpenFilmUpstream(this.vendorRoot)).readProjectFilm(root);
  const film=manifest.files.find(file=>file.path==='film.html');
  if(parsed.problems.length||!film||createHash('sha256').update(parsed.text).digest('hex')!==film.sha256)throw changed();
  if(closure!==undefined){
   // The parse must have used the bytes the closure retained: the parse reads by
   // path, so its text is compared with the retained one.
   let retainedText;
   try{retainedText=await closure.readText(await closure.retainFile('film.html'));}
   catch(error){throw error;}
   if(retainedText!==parsed.text)throw changed();
  }
  const doc=parsed.doc as {tracks?:{clips?:{id?:unknown}[]}[]}|null;
  const ids=doc?.tracks?.flatMap(track=>track.clips?.map(clip=>clip.id)??[])??[];
  if(canonicalDigest(ids)!==canonicalDigest(metadata.clip_ids))throw changed();
  return {metadata,draft,graph:preparedSourceConsumerGraph(metadata,draft),geometry,doc,film_sha256:film.sha256,plan_sha256:planDigest};
 }
 /** The film as the pinned parser sees it.
  *
  * The pinned parser reads by path - `studio/server/film.mjs:33-44` reads
  * `film.html` and calls `readFilmFile(text)` - so it is given a copy this authority
  * owns: the BOUNDED, RETAINED text is written into a private folder of its own
  * (mode 0700, the exact bytes at 0600) and the SAME pinned parser reads that
  * immutable copy. The original root is never read whole again, and the copy is
  * removed when the parse is done; a failure of that removal is kept with the
  * failure that stopped the parse, and it is a GENUINE cleanup failure. */
 async #parseRetainedFilm(closure:RetainedNativeClosure):Promise<OpenFilmFilmRead>{
  const text=await closure.readText(await closure.retainFile('film.html'));
  const folder=await mkdtemp(join(tmpdir(),'narralens-n1n2-film-'));
  liveParseCopies+=1;
  reportParseCopy('allocated',folder);
  let primary:unknown;
  let parsed:OpenFilmFilmRead|undefined;
  try{
   await writeFile(join(folder,'film.html'),Buffer.from(text,'utf8'),{flag:'wx',mode:0o600});
   // The Host-private fault at the parser boundary: it runs INSIDE the ownership
   // of the copy, and the pinned parser that follows really settles.
   await nativeFactsTestHooks?.parseCopy?.beforeParse?.(folder);
   parsed=await(await createPinnedOpenFilmUpstream(this.vendorRoot)).readProjectFilm(folder);
  }catch(error){primary=error;}
  // The copy is settled on EVERY path: a SUCCESSFUL parse leaves nothing behind
  // either. The owner of the copy is this method, and it settles it once.
  let cleanupError:unknown;
  try{
   // The Host-private fault at the removal boundary: it replaces the removal and
   // is expected to do the REAL removal.
   if(nativeFactsTestHooks?.parseCopy?.remove)await nativeFactsTestHooks.parseCopy.remove(folder);
   else await rm(folder,{recursive:true,force:true});
  }catch(error){cleanupError=error;}
  if(cleanupError===undefined){
   // The removal is confirmed: the allocation is gone and it is reported so.
   liveParseCopies-=1;
   reportParseCopy('released',folder);
  }else{
   // The removal did NOT finish: the allocation is still there. It is NOT reported
   // as released, it stays locatable, and the uncertainty is genuine.
   unsettledParseCopies.set(folder,(unsettledParseCopies.get(folder)??0)+1);
   reportParseCopy('cleanup_failed',folder);
  }
  if(primary!==undefined){
   // The primary keeps its place; the failure of the removal is MERGED into it and
   // marked as GENUINE, because it really was a release failure.
   if(cleanupError!==undefined)mergeRetainedCleanupCauses(primary,[cleanupError]);
   throw primary;
  }
  if(cleanupError!==undefined){
   // The parse succeeded, but its copy did not settle: the facts are NOT
   // delivered. The uncertainty is genuine and the owner of the acquisition is
   // told about it.
   throw mergeRetainedCleanupCauses(new RetainedNativeError('NATIVE_CLOSURE_CLEANUP_FAILED','The private parse copy could not be released'),[cleanupError]);
  }
  return parsed as OpenFilmFilmRead;
 }
 /** The same manifest and the same digest as the render contract — and the same rules —
  *  but the media is hashed with a bounded stream instead of being read whole into
  *  memory, and every byte is read through the **retained** descriptor.
  *
  *  The retained closure is the identity: the digest is computed from the descriptors
  *  it holds, so a file that is replaced while the acquisition runs cannot become the
  *  accepted bytes. The result is only accepted when it equals the committed digest. */
 async #streamDigest(closure:RetainedNativeClosure,roots:readonly string[]):Promise<{manifest:SourceDigestManifest;source_digest:string;external_reference_count:number}>{
  const roles=new Map<string,SourceFileRole>();
  const visited=new Set<string>();
  const queue:Array<{relative:string;referrer:string}>=[];
  const files:Array<{path:string;role:SourceFileRole;sha256:string;size:number}>=[];
  const assets:Array<{path:string;asset_id:string|null;sha256:string;size:number}>=[];
  let externalReferenceCount=0;
  const cache=new Map<string,{relative:string;sha256:string;size:number;text:string|null}>();
  const read=async(relative:string):Promise<{relative:string;sha256:string;size:number;text:string|null}>=>{
   const cached=cache.get(relative);if(cached)return cached;
   // The file is retained first: its descriptor is the identity the bytes come from.
   let retained;
   try{retained=await closure.retainFile(relative);}
   catch(error){throw error;}
   const extension=extensionOf(retained.relative_path);
   if(ASSET_EXTENSIONS.has(extension)){
    // The media is hashed with a bounded stream from the retained descriptor.
    const digest=await closure.hashFile(retained);
    const record={relative:retained.relative_path,sha256:digest.sha256,size:digest.bytes,text:null};
    cache.set(relative,record);return record;
   }
   // The text is read through the retained descriptor, under the closure's own limits:
   // the size is refused before the bytes are read, and the total is bounded.
   let text:string;
   try{text=await closure.readText(retained);}
   catch(error){
    // A refusal of the closure's own limits is not a change of the content: it keeps
    // its own code, so the budget is visible where it was refused.
    if(error instanceof RetainedNativeError)throw error;
    throw changed();
   }
   nativeFactsTestHooks?.onSourceRead?.(retained.relative_path);
   const record={relative:retained.relative_path,sha256:retained.sha256,size:retained.bytes,text};
   cache.set(relative,record);return record;
  };
  const normalizedRoots=[...new Set(roots.map(root=>normalizeRelative(root)))];
  const entryRelative=normalizedRoots[0];
  if(entryRelative===undefined)throw changed();
  const canonicalRoots:string[]=[];
  for(const relative of [...normalizedRoots].sort(compareUtf8))canonicalRoots.push((await read(relative)).relative);
  const canonicalEntry=(await read(entryRelative)).relative;
  for(const relative of [...new Set(canonicalRoots)].sort(compareUtf8)){
   const extension=extensionOf(relative);
   if(ASSET_EXTENSIONS.has(extension)){queue.push({relative,referrer:''});continue;}
   roles.set(relative,relative===canonicalEntry?'entry':roleFor(extension,false));
   queue.push({relative,referrer:''});
  }
  while(queue.length>0){
   const item=queue.shift()!;
   if(visited.has(item.relative))continue;
   visited.add(item.relative);
   const loaded=await read(item.relative);
   const extension=extensionOf(loaded.relative);
   if(ASSET_EXTENSIONS.has(extension)){assets.push({path:loaded.relative,asset_id:null,sha256:loaded.sha256,size:loaded.size});continue;}
   const role=roles.get(loaded.relative)??roleFor(extension,item.referrer===canonicalEntry);
   roles.set(loaded.relative,role);
   files.push({path:loaded.relative,role,sha256:loaded.sha256,size:loaded.size});
   for(const reference of extractReferences(role,loaded.text??'')){
    const withoutFragment=reference.split('#')[0]??'';
    if(withoutFragment==='')continue;
    if(withoutFragment.includes('?'))throw changed();
    if(withoutFragment.includes('\\')||withoutFragment.startsWith('/')||/^[a-z]:/iu.test(withoutFragment))throw changed();
    if(EXTERNAL_SCHEME.test(withoutFragment)){externalReferenceCount+=1;continue;}
    const resolvedRelative=joinRelative(item.relative,withoutFragment);
    if(resolvedRelative===''||resolvedRelative==='..'||resolvedRelative.startsWith('../'))throw changed();
    const resolvedExtension=extensionOf(resolvedRelative);
    if(!ASSET_EXTENSIONS.has(resolvedExtension)&&!ROLE_BY_EXTENSION.has(resolvedExtension))throw changed();
    const target=await read(resolvedRelative);
    if(visited.has(target.relative))continue;
    const targetExtension=extensionOf(target.relative);
    if(!ASSET_EXTENSIONS.has(targetExtension)&&!ROLE_BY_EXTENSION.has(targetExtension))throw changed();
    queue.push({relative:target.relative,referrer:item.relative});
  }
  }
  files.sort((left,right)=>compareUtf8(left.path,right.path));
  const manifest:SourceDigestManifest={format:'narralens.source-digest-manifest@1.0',engine:'openfilm',
   engine_upstream_sha:OPENFILM_UPSTREAM_SHA,files,assets};
  const source_digest=createHash('sha256').update(SOURCE_DIGEST_DOMAIN).update(canonicalJson(manifest)).digest('hex');
  return {manifest,source_digest,external_reference_count:externalReferenceCount};
 }
 /** The synchronous fence over the producer's own lineage.
  *
  * It reads the adoption and the impact rows: the adopted source fact, the adoption
  * fact and the committed plan. The plan carries the consumer graph's digest and the
  * native plan, so a change of any of them moves the fence. */
 #lineageFence(binding:CommitBinding):string|null{
  try{
   const exists=this.revisions.compose(db=>db.prepare("SELECT name FROM sqlite_master WHERE name='created_adopted_source_fact'").get());
   if(!exists)return null;
   const store=new CreatedSourceAdoptionStore(this.revisions),source=store.sourceFact(binding.project_id,binding.snapshot_id);
   if(!source)return null;
   const fact=store.adoptionFact(source.transaction_id);
   const row=this.revisions.compose(db=>db.prepare('SELECT plan_json,plan_sha256 FROM created_impact_fact WHERE impact_id=?').get(source.impact_id)) as {plan_json?:unknown;plan_sha256?:unknown}|undefined;
   if(!fact||!row)return null;
   const control=this.revisions.compose(db=>db.prepare('SELECT control_revision FROM project_state WHERE project_id=?').get(binding.project_id)) as {control_revision?:unknown}|undefined;
   return canonicalDigest({
    source,fact,
    plan_sha256:String(row.plan_sha256??''),
    plan:canonicalDigest(JSON.parse(String(row.plan_json)) as unknown),
    control_revision:Number(control?.control_revision??0),
   });
  }catch{return null;}
 }

 /** Acquire the opaque lease of one committed native source.
  *
  * It proves the very transaction the caller named, the very bytes that transaction
  * committed and the very producer that made them, and it *retains* the source tree:
  * the descriptors stay open until the lease is released. The media is hashed with a
  * bounded stream; it is never read whole. */
 async acquireNativeFacts(projectId:string,transactionId:string,principalId:string,pool?:RetainedDescriptorPool):Promise<VerifiedNativeFactsLease>{
  const binding=this.#bind(projectId,transactionId,principalId);
  // The producer's lineage is sampled BEFORE the first authority await.
  //
  // A change of the adoption, the impact plan or the consumer graph during the
  // acquisition must not mint facts under a new fence: the fence is the one that
  // was sampled here, and it must still be the same when the facts are delivered.
  const lineageDigest=this.#lineageFence(binding);
  if(lineageDigest===null)throw new ProductError('CAPABILITY_UNAVAILABLE','This snapshot has no registered created-source producer');
  const project=this.snapshots.projectRoot(binding.project_id);
  const directory=this.snapshots.snapshotRoot(binding.project_id,binding.snapshot_id);
  const root=resolve(directory,'source');
  for(const path of [project,directory,root]){
   const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path)throw changed();
  }
  if(!directory.startsWith(project+sep)||root!==resolve(directory,'source'))throw changed();
  // The identity is established FIRST.
  //
  // The closure holds the tree before any asynchronous read of it, so a file that is
  // replaced while the acquisition runs cannot become the accepted bytes: the digest,
  // the plan and the film are read through the retained descriptors, and the tree is
  // verified again before the facts are delivered.
  // The OPEN of the retained tree is classified as well: it happens before the
  // outer try, and it owns its own partial cleanup, so it is classified and NOT
  // closed a second time.
  let closure;
  try{closure=await RetainedNativeClosure.open(root,{},nativeFactsTestHooks?.closureOps,pool);}
  catch(error){if(error instanceof RetainedNativeError)revisionFence(error);throw error;}
  try{
   const digest=await this.#streamDigest(closure,binding.fact.roots);
   if(digest.source_digest!==binding.source_digest||digest.external_reference_count!==0)throw changed();
   const observedMedia=digest.manifest.assets.map(row=>({path:row.path,sha256:row.sha256,bytes:row.size})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
   const recordedMedia=binding.fact.assets.map(row=>({path:row.path,sha256:row.sha256,bytes:row.bytes})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
   if(canonicalDigest(observedMedia)!==canonicalDigest(recordedMedia))throw changed();
   const lineage=await this.#nativeLineage(binding,root,digest.manifest,closure);
   if(lineage===null)throw new ProductError('CAPABILITY_UNAVAILABLE','This snapshot has no registered created-source producer');
   const manifestPaths=new Set([...digest.manifest.files,...digest.manifest.assets].map(file=>file.path));
   // Only the *files* of the tree are the manifest's paths. A directory is evidence of
   // its own — it is retained and listed, never counted as a file and never ignored.
   const membership=closure.fileMembership();
   if(membership.length!==manifestPaths.size||membership.some(path=>!manifestPaths.has(path)))throw changed();
   const assets=new Map(binding.fact.assets.map(asset=>[asset.path,asset]));
   const subtitles=new Set(binding.fact.subtitles.map(subtitle=>subtitle.path));
   const entries:SnapshotEntry[]=[];
   for(const file of [...digest.manifest.files,...digest.manifest.assets]){
    let retained;
    try{retained=await closure.retainFile(file.path);}
    catch(error){throw error;}
    if(retained.sha256!==file.sha256||retained.bytes!==file.size)throw changed();
    const path=resolve(root,file.path);
    const asset=assets.get(file.path);
    const role='role' in file?file.role:undefined;
    const kind=subtitles.has(file.path)?'supplement':asset||role==='font'||role===undefined?'asset':'native_source';
    entries.push({relative_path:file.path,absolute_path:path,sha256:file.sha256,bytes:file.size,kind,rights_ref:asset?.asset_id??null,role:kind==='supplement'?'subtitles':null});
   }
   const film=digest.manifest.files.find(file=>file.path==='film.html');
   if(!film)throw changed();
   let filmText;
   try{filmText=await closure.readText(await closure.retainFile('film.html'));}
   catch(error){throw error;}
   const native_rev=createHash('sha256').update(filmText).digest('hex').slice(0,16);
   if(native_rev!==film.sha256.slice(0,16))throw changed();
   // The fence of the acquisition: the tree must still be the one that was retained,
   // the producer's lineage must be the one that was sampled before the first await,
   // and the binding must not have moved.
   if(!closure.verify())throw changed();
   if(this.#lineageFence(binding)!==lineageDigest)throw changed();
   if(canonicalDigest(this.#bind(projectId,transactionId,principalId))!==canonicalDigest(binding))throw changed();
   const facts:VerifiedNativeFacts=deepFreeze({
    project_id:binding.project_id,transaction_id:binding.transaction_id,snapshot_id:binding.snapshot_id,
    source_digest:binding.source_digest,project_revision:binding.project_revision,native_root:root,entries,
    geometry:lineage.geometry,consumer_graph:lineage.graph,
    rights:binding.fact.assets.map(asset=>({asset_id:asset.asset_id,status:asset.license.status,
     commercial_use:asset.license.commercial_use,ref:asset.asset_id})),
    film:{relative_path:'film.html',sha256:film.sha256,bytes:film.size,native_rev},
    film_doc:lineage.doc,
    plan_digest:lineage.metadata.plan_digest,
    plan_sha256:lineage.plan_sha256,
    source_entries:[...digest.manifest.files,...digest.manifest.assets].map(file=>({relative_path:file.path,sha256:file.sha256})),
    assets:lineage.metadata.assets.map(asset=>({asset_id:asset.asset_id,path:asset.path,sha256:asset.sha256,bytes:asset.bytes,
     status:asset.license.status,commercial_use:asset.license.commercial_use,rights_ref:asset.rights_ref})),
   });
   const held:NativeFactsFacts={instance:this.#instance,binding,principal_id:principalId,closure,facts,
    lineage_digest:lineageDigest,released:false};
   const lease=Object.freeze({
    facts,
    closure,
    assertCurrent:()=>{
     if(held.released)return false;
     // The retained bytes are part of the guard: a closed closure or a drifted tree
     // makes the lease stale even when the database binding has not moved.
     if(!held.closure.verify())return false;
     try{
      const current=this.#bind(binding.project_id,binding.transaction_id,held.principal_id);
      if(canonicalDigest(current)!==canonicalDigest(binding))return false;
      // The producer's own lineage is re-derived: a change of the adoption, the
      // impact plan or the consumer graph after the issue makes the lease stale.
      const fence=this.#lineageFence(binding);
      return fence!==null&&fence===held.lineage_digest;
     }catch{return false;}
    },
    release:()=>{
     if(held.released)return;
     held.released=true;
     held.closure.close();
    },
    get released(){return held.released;},
   });
   this.#factsLeases.set(lease,held);
   return lease;
  }catch(error){
   // The primary error is kept; the cleanup failures are MERGED into it - never
   // replacing the causes it already carries - and they are marked as GENUINE, so
   // the owner of the acquisition can tell them apart from an ordinary cause. The
   // closure is released once, and a descriptor is never retried.
   const cleanupFailures:unknown[]=[];
   try{closure.close();}catch(cleanupError){cleanupFailures.push(cleanupError);}
   if(cleanupFailures.length>0)mergeRetainedCleanupCauses(error,cleanupFailures);
   // ONE classification point: a failure of the RETAINED TREE is the revision
   // fence of the committed source, with every cause kept and the genuine release
   // failures still marked. Every other failure is the authority's own and passes
   // through unchanged.
   if(error instanceof RetainedNativeError)revisionFence(error);
   throw error;
  }
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
