import {createHash,randomUUID} from 'node:crypto';
import {constants,type BigIntStats} from 'node:fs';
import {mkdir,open,readFile,rm,lstat,realpath,type FileHandle} from 'node:fs/promises';
import {basename,dirname,resolve,sep} from 'node:path';
import {asHostResourceError} from '../api-error.js';
import {canonicalDigest} from '../creative/digest.js';
import {ProductError} from '../creative/trusted-context.js';
import {runLocalMediaTool} from '../agent-driven/local-media-probe.js';
import {NativeRenderCancelled,NativeRenderError,NativeRenderer} from './native-renderer.js';
import {SnapshotCopyError,assertSafeRelativePath} from './snapshot-copy.js';
import type {
 CompletedPreparedSourceV1,PreparedPreviewMediaFactsV1,PreparedPreviewPartKind,PreparedPreviewPartV1,
 PreparedPreviewPort,PreparedPreviewReceiptV1,PreparedPreviewRequestV1,PreparedPreviewTimelineV1,
 PreparedReviewMediaHandleV1,PreparedReviewMediaReader,PreparedSourceProofPort,
} from './assembly-ports.js';
import {PREPARED_REVIEW_MAX_READ_BYTES} from './assembly-ports.js';

/**
 * CR-R1-001 §6/§8: the isolated preview of a completed prepared source.
 *
 * The prepared source is a private, uncommitted tree. A preview renders a *copy* of it
 * in a private workspace of its own; the prepared tree, the author tree and every other
 * source domain are never written, and nothing here commits or delivers. The result is
 * an immutable receipt of five real products with their measured media facts.
 *
 * The reader is separate from the service on purpose: the service produces the bytes,
 * the reader hands out verified descriptors over the fixed object domain. A receipt
 * never names a path.
 */

const OBJECT_ID=/^obj_[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/;
const JSON_TYPE='application/json; charset=utf-8';
const VTT_TYPE='text/vtt; charset=utf-8';
/** The only content type each slot may carry. A part may not choose its own. */
const SLOT_CONTENT_TYPES:Record<PreparedPreviewPartKind,readonly string[]>={
 preview:['video/mp4'],
 narration:['audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/flac','audio/ogg','audio/webm'],
 subtitles:[VTT_TYPE],
 shot_summary:[JSON_TYPE],
 rights_quality:[JSON_TYPE],
};
/** The media facts each slot may carry. */
const SLOT_FACTS:Record<PreparedPreviewPartKind,'video'|'audio'|'text'|'json'>={
 preview:'video',narration:'audio',subtitles:'text',shot_summary:'json',rights_quality:'json',
};
const unavailable=(message='The prepared preview is unavailable')=>new ProductError('CAPABILITY_UNAVAILABLE',message);
const changed=(message='The prepared source changed while the preview was made')=>new ProductError('REVISION_CONFLICT',message);
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function failure(error:unknown):never {
 if(error&&typeof error==='object'){
  const resource=asHostResourceError(error);if(resource)throw resource;
  if(error instanceof ProductError)throw error;
  if(error instanceof SnapshotCopyError)throw new ProductError('REVISION_CONFLICT','The prepared source names a file outside its own tree');
  if(error instanceof NativeRenderCancelled)throw new ProductError('CAPABILITY_UNAVAILABLE','The prepared preview was cancelled');
  if(error instanceof NativeRenderError)throw new ProductError('CAPABILITY_UNAVAILABLE',`The prepared preview could not be rendered (${error.code})`);
 }
 throw unavailable();
}
/** Rational equality. The measured rate has to be the planned rate, not a near miss. */
const sameRate=(a:{num:number;den:number},b:{num:number;den:number})=>a.num*b.den===b.num*a.den;
function reduceRate(num:number,den:number):{num:number;den:number}|null {
 if(!Number.isSafeInteger(num)||!Number.isSafeInteger(den)||num<=0||den<=0)return null;
 const gcd=(a:number,b:number):number=>b===0?a:gcd(b,a%b);
 const divisor=gcd(num,den);
 return {num:num/divisor,den:den/divisor};
}
function parseRate(value:unknown):{num:number;den:number}|null {
 if(typeof value!=='string')return null;
 const match=/^(\d+)\/(\d+)$/u.exec(value.trim());if(!match)return null;
 return reduceRate(Number(match[1]),Number(match[2]));
}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const inside=(root:string,child:string)=>child===root||child.startsWith(root+sep);
const overlaps=(a:string,b:string)=>inside(a,b)||inside(b,a);
const fingerprint=(s:BigIntStats)=>`${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
function deepFreeze<T>(value:T):T {
 if(value&&typeof value==='object'){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}
 return value;
}
const uid=()=>BigInt(process.getuid!());

/**
 * An anchored private directory.
 *
 * Every ancestor has to be a real directory and not a link, so a link cannot redirect a
 * write, and the directory itself has to be private when it already exists.
 */
async function assertAnchoredPrivate(path:string,label:string):Promise<void> {
 const target=resolve(path);
 if(target==='/'||target.length<2)throw unavailable(`${label} is not a usable domain`);
 const parts=target.split(sep).filter(Boolean);
 let current:string=sep;
 for(const part of parts){
  const next=current.endsWith(sep)?current+part:current+'/'+part;
  const info=await lstat(next).catch(()=>null);
  if(info===null){
   const parent=await lstat(current).catch(()=>null);
   if(!parent||!parent.isDirectory()||parent.isSymbolicLink())throw unavailable(`${label} has no anchored parent`);
   return;
  }
  if(info.isSymbolicLink()||!info.isDirectory())throw unavailable(`${label} is not an anchored directory`);
  current=next;
 }
 const info=await lstat(current,{bigint:true});
 if((info.mode&0o077n)!==0n||info.uid!==uid())throw unavailable(`${label} is not a private directory`);
}
interface OwnedDirectory {readonly path:string;readonly identity:string;}
/** A directory this service created. It is only removed when it is still this one. */
async function createOwnedDirectory(path:string,label:string):Promise<OwnedDirectory> {
 await mkdir(path,{mode:0o700});
 const info=await lstat(path,{bigint:true});
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077n)!==0n||info.uid!==uid())throw unavailable(`${label} is not a private directory`);
 return {path,identity:`${info.dev}:${info.ino}`};
}
/** A private directory that may already exist; it is created when it does not. */
async function ensurePrivateDirectory(path:string,label:string):Promise<void> {
 const info=await lstat(path,{bigint:true}).catch(()=>null);
 if(info===null){await mkdir(path,{mode:0o700});const created=await lstat(path,{bigint:true});
  if(!created.isDirectory()||created.isSymbolicLink()||(created.mode&0o077n)!==0n||created.uid!==uid())throw unavailable(`${label} is not a private directory`);
  return;}
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077n)!==0n||info.uid!==uid())throw unavailable(`${label} is not a private directory`);
}
async function removeOwnedDirectory(directory:OwnedDirectory):Promise<void> {
 const info=await lstat(directory.path,{bigint:true}).catch(()=>null);
 if(!info)return;
 if(info.isDirectory()&&!info.isSymbolicLink()&&`${info.dev}:${info.ino}`===directory.identity)await rm(directory.path,{recursive:true,force:true}).catch(()=>undefined);
}

/** The measured facts of the rendered film. */
interface VideoFacts {
 readonly fps:{readonly num:number;readonly den:number};
 readonly frame_count:number;
 /** The raw probe values the measurement was made from. They are kept as facts. */
 readonly raw:{readonly avg_frame_rate:string;readonly r_frame_rate:string;readonly nb_read_frames:number;readonly duration:string;readonly constant_frame_step:number};
}
interface AudioFacts {
 readonly sample_rate:number;
 readonly sample_count:number;
 readonly channels:number;
 /** The probed values the measurement was made from. They are kept as facts. */
 readonly raw:{readonly duration_ts:number;readonly time_base:string};
}

async function probeVideo(path:string,expected:{num:number;den:number},expectedFrames:number,signal?:AbortSignal):Promise<VideoFacts> {
 let probe:{stdout:string};
 try{probe=await runLocalMediaTool('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames:format=format_name,duration','-of','json',path],signal?{signal}:{});}
 catch(error){return failure(error);}
 let parsed:unknown;try{parsed=JSON.parse(probe.stdout);}catch{throw changed('The rendered preview could not be probed');}
 if(!isObject(parsed)||!Array.isArray(parsed.streams))throw changed('The rendered preview could not be probed');
 const streams=parsed.streams.filter((stream):stream is Record<string,unknown>=>isObject(stream));
 const video=streams.find(stream=>stream.codec_type==='video');
 if(!video)throw changed('The rendered preview has no video stream');
 const fps=parseRate(video.avg_frame_rate);
 if(!fps)throw changed('The rendered preview has no provable frame rate');
 if(!sameRate(fps,expected))throw changed('The rendered preview does not match the planned frame rate');
 const frames=Number(video.nb_read_frames);
 if(!Number.isSafeInteger(frames)||frames<1)throw changed('The rendered preview has no counted frames');
 // A strict full decode: a file that only partly decodes has no timeline either.
 let decoded:{stderr:string};
 try{decoded=await runLocalMediaTool('ffmpeg',['-nostdin','-hide_banner','-nostats','-v','error','-xerror','-err_detect','explode','-i',path,'-map','0:v','-f','null','-'],signal?{signal}:{});}
 catch(error){return failure(error);}
 if(decoded.stderr.trim())throw changed('The rendered preview did not decode cleanly');
 if(frames!==expectedFrames)throw changed('The rendered preview does not hold the planned number of frames');
 // Constant frame rate is proved by the decoded frame timestamps, not by the two rates
 // a container happens to report. Every step has to be the planned step.
 let times:{stdout:string};
 try{times=await runLocalMediaTool('ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=pts_time','-of','default=nw=1:nk=1',path],signal?{signal}:{});}
 catch(error){return failure(error);}
 const stamps=times.stdout.split('\n').map(line=>line.trim()).filter(line=>line.length>0).map(line=>Number(line));
 if(stamps.length===0||stamps.some(value=>!Number.isFinite(value)))throw changed('The rendered preview has no decodable frame timestamps');
 if(stamps.length!==frames)throw changed('The rendered preview does not decode into the frames it counted');
 // Frame timestamps are seconds, so their step is the reciprocal of frames/second.
 const step=expected.den/expected.num;
 for(let index=1;index<stamps.length;index++){
  const delta=stamps[index]!-stamps[index-1]!;
  if(Math.abs(delta-step)>step*0.01)throw changed('The rendered preview is not a constant frame rate');
 }
 const duration=typeof parsed.format==='object'&&parsed.format!==null&&typeof (parsed.format as Record<string,unknown>).duration==='string'?String((parsed.format as Record<string,unknown>).duration):'';
 return {fps,frame_count:frames,raw:{avg_frame_rate:String(video.avg_frame_rate),r_frame_rate:String(video.r_frame_rate),nb_read_frames:frames,duration,constant_frame_step:step}};
}

async function probeAudio(path:string,expectedFrames:number,fps:{num:number;den:number},decodedPath:string,signal?:AbortSignal):Promise<AudioFacts> {
 let probe:{stdout:string};
 try{probe=await runLocalMediaTool('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,sample_rate,channels,duration_ts,time_base','-of','json',path],signal?{signal}:{});}
 catch(error){return failure(error);}
 let parsed:unknown;try{parsed=JSON.parse(probe.stdout);}catch{throw changed('The narration could not be probed');}
 if(!isObject(parsed)||!Array.isArray(parsed.streams))throw changed('The narration could not be probed');
 const streams=parsed.streams.filter((stream):stream is Record<string,unknown>=>isObject(stream));
 if(streams.length!==1||streams[0]?.codec_type!=='audio')throw changed('The narration is not a single audio stream');
 const stream=streams[0]!,sampleRate=Number(stream.sample_rate),channels=Number(stream.channels),durationTs=Number(stream.duration_ts);
 if(!Number.isSafeInteger(sampleRate)||sampleRate<=0||!Number.isSafeInteger(channels)||channels<=0)throw changed('The narration has no usable sample facts');
 // The sample count is the number of samples the decoder really produced, not a
 // duration that was turned into a number.
 let decoded:{stderr:string};
 try{decoded=await runLocalMediaTool('ffmpeg',['-nostdin','-hide_banner','-nostats','-v','error','-xerror','-err_detect','explode','-i',path,'-map','0:a:0','-f','s16le','-acodec','pcm_s16le','-ar',String(sampleRate),'-ac',String(channels),decodedPath],signal?{signal}:{});}
 catch(error){return failure(error);}
 if(decoded.stderr.trim())throw changed('The narration did not decode cleanly');
 const info=await lstat(decodedPath,{bigint:true});
 if(!info.isFile()||info.size<=0n||info.size%(2n*BigInt(channels))!==0n)throw changed('The narration did not decode into whole samples');
 const sampleCount=Number(info.size/(2n*BigInt(channels)));
 if(!Number.isSafeInteger(sampleCount)||sampleCount<1)throw changed('The narration has no usable sample count');
 const frames=Math.round(sampleCount*fps.num/(sampleRate*fps.den));
 if(frames!==expectedFrames)throw changed('The narration does not cover the planned draft');
 return {sample_rate:sampleRate,sample_count:sampleCount,channels,raw:{duration_ts:durationTs,time_base:typeof stream.time_base==='string'?stream.time_base:''}};
}

/** The isolated copy of the prepared tree. Every byte is checked against the fact. */
class IsolatedCopy {
 readonly #source=new Map<string,FileHandle>();
 readonly #target=new Map<string,FileHandle>();
 #closed=false;
 private constructor(readonly root:string,readonly projectRoot:string){}
 static async create(sourceRoot:string,targetRoot:string,files:readonly {readonly relative_path:string;readonly bytes:number;readonly sha256:string}[]):Promise<IsolatedCopy> {
  const copy=new IsolatedCopy(targetRoot,resolve(targetRoot,'project'));
  try{
   await mkdir(copy.projectRoot,{mode:0o700});
   const sourceHandle=await open(sourceRoot,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   copy.#source.set('',sourceHandle);
   const targetHandle=await open(copy.projectRoot,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   copy.#target.set('',targetHandle);
   // Every ancestor of every file has to exist on both sides: a file under assets/vo
   // needs assets as well, even when no file sits directly in it.
   const directories=new Set<string>();
   for(const file of files){
    let directory=dirname(assertSafeRelativePath(file.relative_path));
    while(directory&&directory!=='.'){directories.add(directory);directory=dirname(directory)==='.'?'':dirname(directory);}
   }
   for(const directory of [...directories].sort((left,right)=>left.split('/').length-right.split('/').length||(left<right?-1:1))){
    const parent=dirname(directory)==='.'?'':dirname(directory);
    const sourceParent=copy.#source.get(parent);if(!sourceParent)throw changed();
    const sourceChild=await open('/proc/self/fd/'+sourceParent.fd+'/'+basename(directory),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    copy.#source.set(directory,sourceChild);
    const targetParent=copy.#target.get(parent);if(!targetParent)throw changed();
    await mkdir('/proc/self/fd/'+targetParent.fd+'/'+basename(directory),{mode:0o700});
    const targetChild=await open('/proc/self/fd/'+targetParent.fd+'/'+basename(directory),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    copy.#target.set(directory,targetChild);
   }
   for(const file of files){
    const relative=assertSafeRelativePath(file.relative_path);
    const directory=dirname(relative)==='.'?'':dirname(relative);
    const sourceParent=copy.#source.get(directory);if(!sourceParent)throw changed();
    const targetParent=copy.#target.get(directory);if(!targetParent)throw changed();
    const source=await open('/proc/self/fd/'+sourceParent.fd+'/'+basename(relative),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
     const stat=await source.stat();if(!stat.isFile()||stat.size!==file.bytes)throw changed();
     const hash=createHash('sha256');let total=0;
     const target=await open('/proc/self/fd/'+targetParent.fd+'/'+basename(relative),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
     try{
      const buffer=Buffer.allocUnsafe(1024*1024);
      for(;;){const {bytesRead}=await source.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;if(total>file.bytes)throw changed();hash.update(buffer.subarray(0,bytesRead));await target.write(buffer,0,bytesRead);}
      await target.sync();
     }finally{await target.close();}
     if(total!==file.bytes||hash.digest('hex')!==file.sha256)throw changed();
    }finally{await source.close();}
   }
   return copy;
  }catch(error){await copy.dispose();return failure(error);}
 }
 async dispose():Promise<void> {
  if(this.#closed)return;this.#closed=true;
  await Promise.allSettled([...this.#source.values()].reverse().map(handle=>handle.close()));
  await Promise.allSettled([...this.#target.values()].reverse().map(handle=>handle.close()));
 }
}

/**
 * The controlled reader of the prepared preview objects.
 *
 * `open` takes the receipt and an object id. It never takes a path or a URL, it never
 * re-encodes and it never renders. The bytes it hands out are the bytes the receipt
 * recorded, read from the very descriptor it verified.
 */
export class PreparedReviewMediaReaderImpl implements PreparedReviewMediaReader {
 readonly #objectRoot:string;
 constructor(objectRoot:string){this.#objectRoot=resolve(objectRoot);}
 async open(receipt:PreparedPreviewReceiptV1,object_id:string,options?:{readonly signal?:AbortSignal}):Promise<PreparedReviewMediaHandleV1> {
  let handle:FileHandle|undefined;
  try{
   const signal=options?.signal;
   if(!receipt||receipt.format!=='narralens.prepared-preview-receipt@1')throw changed();
   // The receipt is self-describing: its digest has to cover the content it carries,
   // so a receipt that was altered after it was made is not a receipt any more.
   const {receipt_digest,...content}=receipt;
   if(typeof receipt_digest!=='string'||!HASH.test(receipt_digest)||canonicalDigest(content)!==receipt_digest)throw changed();
   if(typeof object_id!=='string'||!OBJECT_ID.test(object_id))throw changed();
   const part=receipt.parts.find(value=>value.object_id===object_id);
   if(!part||!HASH.test(part.sha256)||!Number.isSafeInteger(part.bytes)||part.bytes<0)throw changed();
   // A part may not carry a content type or a media fact its slot does not allow.
   if(!SLOT_CONTENT_TYPES[part.slot]?.includes(part.content_type))throw changed();
   if(part.media_facts.kind!==SLOT_FACTS[part.slot])throw changed();
   // A video part has to carry the timeline of its receipt.
   if(part.media_facts.kind==='video'&&(!sameRate(part.media_facts.fps,receipt.fps)||part.media_facts.frame_count!==receipt.frame_count))throw changed();
   if(signal?.aborted)throw unavailable('The prepared preview read was cancelled');
   await assertAnchoredPrivate(this.#objectRoot,'The prepared preview object domain');
   const path=resolve(this.#objectRoot,object_id);
   if(!path.startsWith(this.#objectRoot+sep))throw changed();
   const info=await lstat(path).catch(()=>null);
   if(!info||!info.isFile()||info.isSymbolicLink()||info.size!==part.bytes)throw changed();
   handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   const stat=await handle.stat({bigint:true});
   if(!stat.isFile()||stat.size!==BigInt(part.bytes))throw changed();
   if(await realpath(path)!==path)throw changed();
   const opened=fingerprint(stat);
   if(fingerprint(await lstat(path,{bigint:true}))!==opened)throw changed();
   const hash=createHash('sha256');const buffer=Buffer.allocUnsafe(1024*1024);
   for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}
   if(hash.digest('hex')!==part.sha256)throw changed();
   const owned=handle;handle=undefined;
   let closed=false;
   const timeline:PreparedPreviewTimelineV1=deepFreeze({fps:{...receipt.fps},frame_count:receipt.frame_count});
   const mediaFacts:PreparedPreviewMediaFactsV1=deepFreeze(structuredClone(part.media_facts));
   return {
    content_type:part.content_type,bytes:part.bytes,sha256:part.sha256,media_facts:mediaFacts,timeline,
    read:async(range:{readonly offset:number;readonly length:number})=>{
     if(closed)throw unavailable('The prepared preview handle is closed');
     if(signal?.aborted)throw unavailable('The prepared preview read was cancelled');
     if(!range||!Number.isSafeInteger(range.offset)||range.offset<0)throw changed();
     if(!Number.isSafeInteger(range.length)||range.length<0||range.length>PREPARED_REVIEW_MAX_READ_BYTES)throw changed();
     if(range.offset+range.length>part.bytes)throw changed();
     // The bytes are checked again before every read: a file that was replaced or
     // rewritten under the open descriptor is not the object the receipt names.
     if(fingerprint(await owned.stat({bigint:true}))!==opened)throw changed('The prepared preview object changed while it was read');
     if(fingerprint(await lstat(path,{bigint:true}))!==opened)throw changed('The prepared preview object was replaced while it was read');
     const output=Buffer.allocUnsafe(range.length);
     let total=0;
     while(total<range.length){const {bytesRead}=await owned.read(output,total,range.length-total,range.offset+total);if(!bytesRead)break;total+=bytesRead;}
     if(total!==range.length)throw changed();
     return new Uint8Array(output);
    },
    close:async()=>{if(closed)return;closed=true;await owned.close();},
   };
  }catch(error){await handle?.close();return failure(error);}
 }
}

export interface PreparedPreviewOptions {
 /** The Host-chosen pinned upstream checkout. Never a request field. */
 readonly upstreamRoot:string;
 /** The private root that holds the isolated preview copies. */
 readonly workspaceRoot:string;
 /** The fixed object domain the five products are written into. */
 readonly objectRoot:string;
 /** Roots the isolated copy and the object domain must never overlap. */
 readonly protectedRoots:readonly string[];
 readonly width:number;
 readonly height:number;
 readonly timeoutMs:number;
 /** Re-verifies the current author and rights of the project. Host supplied. */
 readonly assertCurrentAuthorAndRights:(project_id:string)=>void;
}

/** The isolated prepared preview. */
export class PreparedPreviewService implements PreparedPreviewPort {
 readonly #verifier:PreparedSourceProofPort;
 readonly #options:PreparedPreviewOptions;
 readonly #renderer:NativeRenderer;
 readonly #retained:string[]=[];
 #closed=false;
 #active:Promise<unknown>|undefined;
 constructor(verifier:PreparedSourceProofPort,options:PreparedPreviewOptions){
  if(!verifier||!options||typeof options.assertCurrentAuthorAndRights!=='function')throw unavailable();
  const workspace=resolve(options.workspaceRoot),objects=resolve(options.objectRoot);
  if(workspace===objects)throw unavailable('The prepared preview workspace and object domain must be different domains');
  for(const root of [...options.protectedRoots.map(value=>resolve(value)),resolve(options.upstreamRoot)]){
   if(overlaps(workspace,root)||overlaps(objects,root))throw unavailable('The prepared preview domains overlap a protected source domain');
  }
  this.#verifier=verifier;this.#options=options;this.#renderer=new NativeRenderer({upstream_root:resolve(options.upstreamRoot)});
 }
 /** The staging directories that were kept because a render tree could not be shown to be gone. */
 retainedStaging():readonly string[]{return [...this.#retained];}
 /** Writes one product into the fixed object domain and returns its descriptor. */
 async #publish(slot:PreparedPreviewPartKind,content_type:string,bytes:Buffer,media_facts:PreparedPreviewMediaFactsV1):Promise<PreparedPreviewPartV1> {
  if(!SLOT_CONTENT_TYPES[slot].includes(content_type))throw changed('A prepared preview part has a content type its slot does not allow');
  const object_id='obj_'+randomUUID().replace(/-/gu,'');
  const path=resolve(this.#options.objectRoot,object_id);
  const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  return {slot,object_id,content_type,bytes:bytes.length,sha256:sha(bytes),media_facts};
 }
 async preview(request:PreparedPreviewRequestV1):Promise<PreparedPreviewReceiptV1> {
  if(this.#active)throw unavailable('A prepared preview is already running');
  const work=this.#run(request);
  this.#active=work;
  try{return await work;}finally{if(this.#active===work)this.#active=undefined;}
 }
 async #run(request:PreparedPreviewRequestV1):Promise<PreparedPreviewReceiptV1> {
  let workspace:OwnedDirectory|undefined;
  let retain=false;
  try{
   if(this.#closed)throw unavailable();
   if(!request||request.format!=='narralens.prepared-preview-request@1')throw changed();
   const completed=request.completed,binding=request.binding,proof=request.proof;
   if(!completed||completed.format!=='narralens.completed-prepared-source@1')throw changed();
   if(!binding||binding.purpose!=='preview')throw changed();
   if(!proof||typeof proof!=='object')throw changed();
   // The prepared closure is proved again, synchronously, right before it is copied.
   this.#verifier.assertCurrentForRead(completed,binding,proof,()=>this.#options.assertCurrentAuthorAndRights(completed.project_id));
   const fact=completed.fact;
   if(!fact||!Array.isArray(fact.files)||fact.files.length===0)throw changed();
   // The domains are anchored, private and apart from every protected source domain
   // before anything is created.
   const protectedRoots=[...this.#options.protectedRoots.map(value=>resolve(value)),resolve(completed.root),resolve(this.#options.upstreamRoot)];
   const workspaceRoot=resolve(this.#options.workspaceRoot),objectRoot=resolve(this.#options.objectRoot);
   for(const root of protectedRoots){
    if(overlaps(workspaceRoot,root)||overlaps(objectRoot,root))throw changed('The prepared preview domains overlap a protected source domain');
   }
   await assertAnchoredPrivate(workspaceRoot,'The prepared preview workspace');
   await assertAnchoredPrivate(objectRoot,'The prepared preview object domain');
   await ensurePrivateDirectory(workspaceRoot,'The prepared preview workspace');
   await ensurePrivateDirectory(objectRoot,'The prepared preview object domain');
   workspace=await createOwnedDirectory(resolve(workspaceRoot,'preview-'+randomUUID()),'The prepared preview workspace');
   let copy:IsolatedCopy|undefined;
   try{
    copy=await IsolatedCopy.create(completed.root,workspace.path,fact.files);
    const metadataRaw=await readFile(resolve(copy.projectRoot,'prepared-native.json'),'utf8');
    const metadata=JSON.parse(metadataRaw) as Record<string,unknown>;
    if(!isObject(metadata)||!Array.isArray(metadata.assets)||!isObject(metadata.fps))throw changed();
    const fpsValue=metadata.fps as Record<string,unknown>;
    const plannedFps={num:Number(fpsValue.num),den:Number(fpsValue.den)};
    const plannedFrames=Number(metadata.frame_count);
    if(!Number.isSafeInteger(plannedFrames)||plannedFrames<1||!Number.isSafeInteger(plannedFps.num)||!Number.isSafeInteger(plannedFps.den))throw changed();
    const assets=metadata.assets.filter((value):value is Record<string,unknown>=>isObject(value));
    const planDigest=typeof metadata.plan_digest==='string'&&metadata.plan_digest.length>0?metadata.plan_digest:fact.plan_digest;
    if(typeof planDigest!=='string'||planDigest.length===0||planDigest!==fact.plan_digest)throw changed('The prepared plan digest does not match the prepared fact');
    const narration=assets.find(value=>typeof value.media_type==='string'&&(value.media_type as string).startsWith('audio/'));
    const subtitles=Array.isArray(metadata.subtitles)?metadata.subtitles.filter((value):value is Record<string,unknown>=>isObject(value))[0]:undefined;
    if(!narration||typeof narration.path!=='string')throw unavailable('The prepared source has no narration to review');
    if(!subtitles||typeof subtitles.path!=='string')throw unavailable('The prepared source has no subtitles to review');
    const renderRoot=resolve(workspace.path,'render');
    await mkdir(renderRoot,{mode:0o700});
    const outPath=resolve(renderRoot,'preview.mp4');
    try{
     await this.#renderer.render({
      project_root:copy.projectRoot,native_entry:'film.html',frame_count:plannedFrames,
      out_path:outPath,staging_root:workspace.path,upstream_root:resolve(this.#options.upstreamRoot),
      width:this.#options.width,height:this.#options.height,fps:plannedFps.num/plannedFps.den,
      timeout_ms:this.#options.timeoutMs,signal:request.signal,
     });
    }catch(error){
     // A render tree that could not be shown to be gone may still write. Its staging
     // is kept for reconciliation instead of being removed under a running child.
     if(error instanceof NativeRenderError&&error.group_settled===false){retain=true;this.#retained.push(workspace.path);}
     throw error;
    }
    const measured=await probeVideo(outPath,plannedFps,plannedFrames,request.signal);
    const narrationPath=resolve(copy.projectRoot,assertSafeRelativePath(narration.path));
    const subtitlePath=resolve(copy.projectRoot,assertSafeRelativePath(subtitles.path));
    if(!narrationPath.startsWith(copy.projectRoot+sep)||!subtitlePath.startsWith(copy.projectRoot+sep))throw changed('The prepared source names a file outside its own tree');
    const narrationBytes=await readFile(narrationPath);
    const audio=await probeAudio(narrationPath,plannedFrames,plannedFps,resolve(workspace.path,'narration.pcm'),request.signal);
    const subtitleBytes=await readFile(subtitlePath);
    const planRaw=await readFile(resolve(copy.projectRoot,'draft-plan.json'),'utf8');
    const plan=JSON.parse(planRaw) as Record<string,unknown>;
    if(!isObject(plan)||!isObject(plan.storyboard)||!Array.isArray(plan.storyboard.shots))throw changed();
    const shots=plan.storyboard.shots.filter((value):value is Record<string,unknown>=>isObject(value));
    const summaryBytes=Buffer.from(JSON.stringify({
     format:'narralens.prepared-preview-shot-summary@1',project_id:completed.project_id,
     frame_count:plannedFrames,fps:plannedFps,
     shots:shots.map(shot=>({shot_id:shot.shot_id,duration_frames:shot.duration_frames,caption:shot.caption??''})),
    })+'\n','utf8');
    const rightsBytes=Buffer.from(JSON.stringify({
     format:'narralens.prepared-preview-rights-quality@1',project_id:completed.project_id,
     source_digest:fact.source_digest,plan_digest:fact.plan_digest,rights_digest:fact.rights_digest,
     assets:assets.map(value=>({asset_id:value.asset_id,rights_ref:value.rights_ref,license:value.license,source:value.source,recording_origin:value.recording_origin,sha256:value.sha256,bytes:value.bytes})),
     quality:{width:this.#options.width,height:this.#options.height,fps:measured.fps,frame_count:measured.frame_count,
      planned_fps:plannedFps,planned_frame_count:plannedFrames,narration:{sample_rate:audio.sample_rate,sample_count:audio.sample_count,channels:audio.channels,measured_audio:audio.raw},
      measured_video:measured.raw},
    })+'\n','utf8');
    // Nothing is published after a cancellation, after the service was closed, or after
    // the prepared source stopped being current.
    if(request.signal?.aborted)throw unavailable('The prepared preview was cancelled');
    if(this.#closed)throw unavailable('The prepared preview is stopping');
    this.#verifier.assertCurrentForRead(completed,binding,proof,()=>this.#options.assertCurrentAuthorAndRights(completed.project_id));
    const parts:PreparedPreviewPartV1[]=[];
    const publish=async(slot:PreparedPreviewPartKind,content_type:string,bytes:Buffer,media_facts:PreparedPreviewMediaFactsV1)=>{
     if(request.signal?.aborted)throw unavailable('The prepared preview was cancelled');
     if(this.#closed)throw unavailable('The prepared preview is stopping');
     parts.push(await this.#publish(slot,content_type,bytes,media_facts));
    };
    await publish('preview','video/mp4',await readFile(outPath),{kind:'video',fps:measured.fps,frame_count:measured.frame_count});
    await publish('narration',String(narration.media_type),narrationBytes,{kind:'audio',sample_rate:audio.sample_rate,sample_count:audio.sample_count,channels:audio.channels});
    await publish('subtitles',VTT_TYPE,subtitleBytes,{kind:'text'});
    await publish('shot_summary',JSON_TYPE,summaryBytes,{kind:'json'});
    await publish('rights_quality',JSON_TYPE,rightsBytes,{kind:'json'});
    const content={
     format:'narralens.prepared-preview-receipt@1' as const,project_id:completed.project_id,
     run_id:binding.run_id,plan_version:binding.execution.plan_version,step_id:binding.execution.step_id,
     execution_attempt:binding.execution.attempt,prepared_job_id:binding.prepared_job_id,
     prepared_source_id:binding.prepared_source_id,source_digest:fact.source_digest,
     plan_digest:planDigest,rights_digest:fact.rights_digest,producer_attempt:completed.producer_attempt,
     fps:measured.fps,frame_count:measured.frame_count,parts,
    };
    const receipt_digest=canonicalDigest(content);
    return {...content,receipt_digest};
   }finally{await copy?.dispose();}
  }catch(error){return failure(error);}
  finally{
   if(workspace&&!retain)await removeOwnedDirectory(workspace);
  }
 }
 async close():Promise<void>{this.#closed=true;if(this.#active)await this.#active.catch(()=>undefined);}
}
