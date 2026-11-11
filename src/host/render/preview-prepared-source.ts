import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,readFile,rm,lstat,realpath,type FileHandle} from 'node:fs/promises';
import {basename,dirname,resolve,sep} from 'node:path';
import {asHostResourceError} from '../api-error.js';
import {canonicalDigest} from '../creative/digest.js';
import {ProductError} from '../creative/trusted-context.js';
import {runLocalMediaTool} from '../agent-driven/local-media-probe.js';
import {NativeRenderCancelled,NativeRenderError,NativeRenderer} from './native-renderer.js';
import {assertSafeRelativePath} from './snapshot-copy.js';
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
 * in a private workspace of its own; the prepared tree and the author tree are never
 * written, and nothing here produces a committed snapshot or a delivery. The result is
 * an immutable receipt of five real products with their measured media facts.
 *
 * The reader is separate from the service on purpose: the service produces the bytes,
 * the reader hands out verified descriptors over the fixed object domain. A receipt
 * never names a path.
 */

const OBJECT_ID=/^obj_[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/;
const CONTENT_TYPES:Record<PreparedPreviewPartKind,string>={
 preview:'video/mp4',narration:'audio/wav',subtitles:'text/vtt',shot_summary:'text/plain',rights_quality:'application/json',
};
const unavailable=(message='The prepared preview is unavailable')=>new ProductError('CAPABILITY_UNAVAILABLE',message);
const changed=(message='The prepared source changed while the preview was made')=>new ProductError('REVISION_CONFLICT',message);
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function failure(error:unknown):never {
 if(error&&typeof error==='object'){
  const resource=asHostResourceError(error);if(resource)throw resource;
  if(error instanceof ProductError)throw error;
  if(error instanceof NativeRenderCancelled)throw new ProductError('CAPABILITY_UNAVAILABLE','The prepared preview was cancelled');
  if(error instanceof NativeRenderError)throw new ProductError('CAPABILITY_UNAVAILABLE','The prepared preview could not be rendered');
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

export interface PreparedPreviewOptions {
 /** The Host-chosen pinned upstream checkout. Never a request field. */
 readonly upstreamRoot:string;
 /** The private root that holds the isolated preview copies. */
 readonly workspaceRoot:string;
 /** The fixed object domain the five products are written into. */
 readonly objectRoot:string;
 /** Roots the isolated copy must never overlap. */
 readonly protectedRoots:readonly string[];
 readonly width:number;
 readonly height:number;
 readonly timeoutMs:number;
 /** Re-verifies the current author and rights of the project. Host supplied. */
 readonly assertCurrentAuthorAndRights:(project_id:string)=>void;
}

/** The measured facts of the rendered film. */
interface VideoFacts {readonly fps:{readonly num:number;readonly den:number};readonly frame_count:number;}
interface AudioFacts {readonly sample_rate:number;readonly sample_count:number;readonly channels:number;}

async function probeVideo(path:string,expected:{num:number;den:number},expectedFrames:number,signal?:AbortSignal):Promise<VideoFacts> {
 let probe:{stdout:string};
 try{probe=await runLocalMediaTool('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames:format=format_name,duration','-of','json',path],signal?{signal}:{});}
 catch(error){return failure(error);}
 let parsed:unknown;try{parsed=JSON.parse(probe.stdout);}catch{throw changed('The rendered preview could not be probed');}
 if(!isObject(parsed)||!Array.isArray(parsed.streams))throw changed('The rendered preview could not be probed');
 const streams=parsed.streams.filter((stream):stream is Record<string,unknown>=>isObject(stream));
 const video=streams.find(stream=>stream.codec_type==='video');
 if(!video)throw changed('The rendered preview has no video stream');
 const fps=parseRate(video.avg_frame_rate),rawRate=parseRate(video.r_frame_rate);
 if(!fps||!rawRate)throw changed('The rendered preview has no provable frame rate');
 // A variable frame rate file reports a different nominal and average rate. It has no
 // single timeline, so it cannot carry a preview clock.
 if(!sameRate(fps,rawRate))throw changed('The rendered preview has a variable frame rate');
 if(!sameRate(fps,expected))throw changed('The rendered preview does not match the planned frame rate');
 const frames=Number(video.nb_read_frames);
 if(!Number.isSafeInteger(frames)||frames<1)throw changed('The rendered preview has no counted frames');
 // A strict full decode: a file that only partly decodes has no timeline either.
 let decoded:{stderr:string};
 try{decoded=await runLocalMediaTool('ffmpeg',['-nostdin','-hide_banner','-nostats','-v','error','-xerror','-err_detect','explode','-i',path,'-map','0:v','-f','null','-'],signal?{signal}:{});}
 catch(error){return failure(error);}
 if(decoded.stderr.trim())throw changed('The rendered preview did not decode cleanly');
 if(frames!==expectedFrames)throw changed('The rendered preview does not hold the planned number of frames');
 return {fps,frame_count:frames};
}

async function probeAudio(path:string,expectedFrames:number,fps:{num:number;den:number},signal?:AbortSignal):Promise<AudioFacts> {
 let probe:{stdout:string};
 try{probe=await runLocalMediaTool('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,sample_rate,channels,duration_ts,time_base','-of','json',path],signal?{signal}:{});}
 catch(error){return failure(error);}
 let parsed:unknown;try{parsed=JSON.parse(probe.stdout);}catch{throw changed('The narration could not be probed');}
 if(!isObject(parsed)||!Array.isArray(parsed.streams))throw changed('The narration could not be probed');
 const streams=parsed.streams.filter((stream):stream is Record<string,unknown>=>isObject(stream));
 if(streams.length!==1||streams[0]?.codec_type!=='audio')throw changed('The narration is not a single audio stream');
 const stream=streams[0]!,sampleRate=Number(stream.sample_rate),channels=Number(stream.channels),durationTs=Number(stream.duration_ts);
 const timeBase=typeof stream.time_base==='string'?/^(\d+)\/(\d+)$/u.exec(stream.time_base):null;
 if(![sampleRate,channels,durationTs].every(value=>Number.isSafeInteger(value)&&value>0)||!timeBase)throw changed('The narration has no usable sample facts');
 let decoded:{stderr:string};
 try{decoded=await runLocalMediaTool('ffmpeg',['-nostdin','-hide_banner','-nostats','-v','error','-xerror','-err_detect','explode','-i',path,'-map','0:a:0','-f','null','-'],signal?{signal}:{});}
 catch(error){return failure(error);}
 if(decoded.stderr.trim())throw changed('The narration did not decode cleanly');
 const numerator=BigInt(durationTs)*BigInt(timeBase[1]!),denominator=BigInt(timeBase[2]!);
 const sampleCount=Number((numerator*BigInt(sampleRate))/denominator);
 if(!Number.isSafeInteger(sampleCount)||sampleCount<1)throw changed('The narration has no usable sample count');
 const frames=Math.round(sampleCount*fps.num/(sampleRate*fps.den));
 if(frames!==expectedFrames)throw changed('The narration does not cover the planned draft');
 return {sample_rate:sampleRate,sample_count:sampleCount,channels};
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
   await mkdir(copy.root,{mode:0o700,recursive:true});
   await mkdir(copy.projectRoot,{mode:0o700});
   const sourceHandle=await open(sourceRoot,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   copy.#source.set('',sourceHandle);
   const targetHandle=await open(copy.projectRoot,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   copy.#target.set('',targetHandle);
   const directories=new Set<string>();
   for(const file of files){const directory=dirname(file.relative_path);if(directory!=='.')directories.add(directory);}
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
  await rm(this.root,{recursive:true,force:true}).catch(()=>undefined);
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
  try{
   if(!receipt||receipt.format!=='narralens.prepared-preview-receipt@1')throw changed();
   if(typeof object_id!=='string'||!OBJECT_ID.test(object_id))throw changed();
   const part=receipt.parts.find(value=>value.object_id===object_id);
   if(!part||!HASH.test(part.sha256)||!Number.isSafeInteger(part.bytes)||part.bytes<0)throw changed();
   if(options?.signal?.aborted)throw unavailable('The prepared preview read was cancelled');
   const path=resolve(this.#objectRoot,object_id);
   if(!path.startsWith(this.#objectRoot+sep))throw changed();
   const info=await lstat(path).catch(()=>null);
   if(!info||!info.isFile()||info.isSymbolicLink()||info.size!==part.bytes)throw changed();
   const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size!==part.bytes)throw changed();
    if(await realpath(path)!==path)throw changed();
    const hash=createHash('sha256');const buffer=Buffer.allocUnsafe(1024*1024);
    for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}
    if(hash.digest('hex')!==part.sha256)throw changed();
   }catch(error){await handle.close();throw failure(error);}
   let closed=false;
   const timeline:PreparedPreviewTimelineV1={fps:receipt.fps,frame_count:receipt.frame_count};
   const mediaFacts=part.media_facts;
   return {
    content_type:part.content_type,bytes:part.bytes,sha256:part.sha256,media_facts:mediaFacts,timeline,
    read:async(range:{readonly offset:number;readonly length:number})=>{
     if(closed)throw unavailable('The prepared preview handle is closed');
     if(!range||!Number.isSafeInteger(range.offset)||range.offset<0)throw changed();
     if(!Number.isSafeInteger(range.length)||range.length<0||range.length>PREPARED_REVIEW_MAX_READ_BYTES)throw changed();
     if(range.offset+range.length>part.bytes)throw changed();
     const buffer=Buffer.allocUnsafe(range.length);
     let total=0;
     while(total<range.length){const {bytesRead}=await handle.read(buffer,total,range.length-total,range.offset+total);if(!bytesRead)break;total+=bytesRead;}
     if(total!==range.length)throw changed();
     return new Uint8Array(buffer);
    },
    close:async()=>{if(closed)return;closed=true;await handle.close();},
   };
  }catch(error){return failure(error);}
 }
}

/** The isolated prepared preview. */
export class PreparedPreviewService implements PreparedPreviewPort {
 readonly #verifier:PreparedSourceProofPort;
 readonly #options:PreparedPreviewOptions;
 readonly #renderer:NativeRenderer;
 #closed=false;
 constructor(verifier:PreparedSourceProofPort,options:PreparedPreviewOptions){
  if(!verifier||!options||typeof options.assertCurrentAuthorAndRights!=='function')throw unavailable();
  this.#verifier=verifier;this.#options=options;this.#renderer=new NativeRenderer({upstream_root:resolve(options.upstreamRoot)});
 }
 /** Writes one product into the fixed object domain and returns its descriptor. */
 async #publish(slot:PreparedPreviewPartKind,content_type:string,bytes:Buffer,media_facts:PreparedPreviewMediaFactsV1):Promise<PreparedPreviewPartV1> {
  const object_id='obj_'+randomUUID().replace(/-/gu,'');
  const path=resolve(this.#options.objectRoot,object_id);
  await mkdir(this.#options.objectRoot,{mode:0o700,recursive:true});
  const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  return {slot,object_id,content_type,bytes:bytes.length,sha256:sha(bytes),media_facts};
 }
 async preview(request:PreparedPreviewRequestV1):Promise<PreparedPreviewReceiptV1> {
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
   const workspace=resolve(this.#options.workspaceRoot,'preview-'+randomUUID());
   await mkdir(workspace,{mode:0o700,recursive:true});
   let copy:IsolatedCopy|undefined;
   try{
    copy=await IsolatedCopy.create(completed.root,workspace,fact.files);
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
    const renderRoot=resolve(workspace,'render');
    await mkdir(renderRoot,{mode:0o700});
    const outPath=resolve(renderRoot,'preview.mp4');
    await this.#renderer.render({
     project_root:copy.projectRoot,native_entry:'film.html',frame_count:plannedFrames,
     out_path:outPath,staging_root:renderRoot,upstream_root:resolve(this.#options.upstreamRoot),
     width:this.#options.width,height:this.#options.height,fps:plannedFps.num/plannedFps.den,
     timeout_ms:this.#options.timeoutMs,signal:request.signal,
    });
    const measured=await probeVideo(outPath,plannedFps,plannedFrames,request.signal);
    const narrationPath=resolve(copy.projectRoot,assertSafeRelativePath(narration.path));
    const subtitlePath=resolve(copy.projectRoot,assertSafeRelativePath(subtitles.path));
    if(!narrationPath.startsWith(copy.projectRoot+sep)||!subtitlePath.startsWith(copy.projectRoot+sep))throw changed('The prepared source names a file outside its own tree');
    const narrationBytes=await readFile(narrationPath);
    const audio=await probeAudio(narrationPath,plannedFrames,plannedFps,request.signal);
    const subtitleBytes=await readFile(subtitlePath);
    const planRaw=await readFile(resolve(copy.projectRoot,'draft-plan.json'),'utf8');
    const plan=JSON.parse(planRaw) as Record<string,unknown>;
    if(!isObject(plan)||!isObject(plan.storyboard)||!Array.isArray(plan.storyboard.shots))throw changed();
    const shots=plan.storyboard.shots.filter((value):value is Record<string,unknown>=>isObject(value));
    const summaryLines=['Narralens prepared preview shot summary',`project: ${completed.project_id}`,`shots: ${shots.length}`];
    for(const shot of shots)summaryLines.push(`${String(shot.shot_id)}\t${String(shot.duration_frames)}\t${String(shot.caption??'')}`);
    const summaryBytes=Buffer.from(summaryLines.join('\n')+'\n','utf8');
    const rightsBytes=Buffer.from(JSON.stringify({
     format:'narralens.prepared-preview-rights-quality@1',project_id:completed.project_id,
     source_digest:fact.source_digest,plan_digest:fact.plan_digest,rights_digest:fact.rights_digest,
     assets:assets.map(value=>({asset_id:value.asset_id,rights_ref:value.rights_ref,license:value.license,source:value.source,recording_origin:value.recording_origin,sha256:value.sha256,bytes:value.bytes})),
     quality:{width:this.#options.width,height:this.#options.height,fps:measured.fps,frame_count:measured.frame_count,
      planned_fps:plannedFps,planned_frame_count:plannedFrames,narration:{sample_rate:audio.sample_rate,sample_count:audio.sample_count,channels:audio.channels}},
    })+'\n','utf8');
    const parts:PreparedPreviewPartV1[]=[];
    parts.push(await this.#publish('preview',CONTENT_TYPES.preview,await readFile(outPath),{kind:'video',fps:measured.fps,frame_count:measured.frame_count}));
    parts.push(await this.#publish('narration',String(narration.media_type),narrationBytes,{kind:'audio',sample_rate:audio.sample_rate,sample_count:audio.sample_count,channels:audio.channels}));
    parts.push(await this.#publish('subtitles',CONTENT_TYPES.subtitles,subtitleBytes,{kind:'text'}));
    parts.push(await this.#publish('shot_summary',CONTENT_TYPES.shot_summary,summaryBytes,{kind:'text'}));
    parts.push(await this.#publish('rights_quality',CONTENT_TYPES.rights_quality,rightsBytes,{kind:'json'}));
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
   }finally{
    await copy?.dispose();
    await rm(workspace,{recursive:true,force:true}).catch(()=>undefined);
   }
  }catch(error){return failure(error);}
 }
 async close():Promise<void>{this.#closed=true;}
}
