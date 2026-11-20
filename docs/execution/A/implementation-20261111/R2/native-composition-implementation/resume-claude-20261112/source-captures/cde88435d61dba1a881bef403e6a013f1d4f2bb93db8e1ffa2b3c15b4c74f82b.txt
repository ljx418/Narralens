import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {posix} from 'node:path';
import type {CommittedSnapshotAuthority,VerifiedNativeFacts,VerifiedNativeFactsLease} from './committed-snapshot-authority.js';
import type {CreatedNativeWorkspaceService,NativeWorkspaceLease} from './created-native-workspace.js';
import {RetainedNativeClosure,RetainedDescriptorBudget,RETAINED_NATIVE_BUDGET,mergeRetainedCleanupCauses,retainedCleanupFailures,markRetainedCleanupFailures} from './retained-native-closure.js';
import type {RetainedNativeDescriptorOps,RetainedDescriptorPool,RetainedNativeFile} from './retained-native-closure.js';
import {computeNativeEffectiveSidecars,NATIVE_SIDECARS_UPSTREAM} from '../m5/native-effective-sidecars.js';
import type {NativeSidecarInputs,NativeSidecarResult} from '../m5/native-effective-sidecars.js';
import type {
 NativeExpectedBinding,
 NativeExpectedLibrary,
 NativeExpectedRetainedFile,
 NativeExpectedSourceFacts,
 NativeExpectedSourcePort,
} from '../m5/openfilm-native-expected.js';
import type {ExpectedProjectionInput,Marker,ProjectSettings} from '../../../tools/agent-driven/product/native-inputs/expected-projection.js';

/** The upstream the pinned native code was cut from. */
const UPSTREAM_SHA='e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3';

/** The probe profile of the upstream `derived.probe`. It is the whole argv: no other
 *  option is added here, and the Host's own media-tool policy is left in force. */
const PROBE_PROFILE:readonly string[]=['-v','error','-print_format','json','-show_format','-show_streams'];
/** One probe may take this long. It is a failure with a meaning, never a silent cut. */
const PROBE_TIMEOUT_MS=30000;
/** The output a probe may produce. */
const PROBE_STDOUT_LIMIT=4*1024*1024;
const PROBE_STDERR_LIMIT=256*1024;

/** The upstream's own extension rules (`clipKind`). */
const VIDEO_EXTENSIONS=new Set(['mp4','m4v','mov','webm','mkv','avi','ogv']);
const STILL_EXTENSIONS=new Set(['png','jpg','jpeg','webp','avif','gif','bmp','svg']);
const SOUND_EXTENSIONS=new Set(['mp3','m4a','wav','aac','ogg','oga','opus','flac','aif','aiff','weba']);

/** The failure of the reader. The code is the message; no path is ever disclosed. */
export class NativeSourceReaderError extends Error {
 constructor(readonly code:string,message:string){super(message);this.name='NativeSourceReaderError';}
}
const refuse:(code:string,message:string)=>never=(code,message)=>{throw new NativeSourceReaderError(code,message);};

/** The normalised fact of one probed media file.
 *
 * Every field the upstream's own probe produces is kept, including the shown width and
 * height: a reduced fact set would lose the rotation the upstream applied. */
export interface NormalizedNativeProbe {
 readonly duration:number|null;
 readonly width:number|null;
 readonly height:number|null;
 readonly fps:number|null;
 readonly audio:boolean;
 readonly codec:string|null;
 readonly pixfmt:string|null;
}

/** One probed file and the evidence of the probe. */
interface ProbeRecord {
 readonly source_ref:string;
 readonly sha256:string;
 readonly bytes:number;
 readonly normalized:NormalizedNativeProbe;
 readonly proof_digest:string;
}

/** A live child of the reader. The reader owns every one of them. */
interface OwnedChild {
 kill():void;
 readonly done:Promise<void>;
}

/** The upstream's `clipKind`, reproduced exactly. */
const clipKindOf=(src:string):'page'|'still'|'sound'|'video'|null=>{
 if(/\.html?$/i.test(src))return 'page';
 const dot=src.lastIndexOf('.');
 const extension=dot>0?src.slice(dot+1).toLowerCase():'';
 if(STILL_EXTENSIONS.has(extension))return 'still';
 if(SOUND_EXTENSIONS.has(extension))return 'sound';
 if(VIDEO_EXTENSIONS.has(extension))return 'video';
 return null;
};

const sha256Of=(text:string):string=>createHash('sha256').update(text,'utf8').digest('hex');
/** Whether a retained file is the very file a witness saw.
 *
 * The whole identity is compared: the digest, the size, the device, the inode, the
 * nanosecond change times and the number of names. The millisecond change time is
 * the upstream's stamp and is never an identity: a file that was replaced by an
 * equal copy has the same bytes and another inode, and a file that was changed and
 * restored has the same bytes and another change time of its inode. */
const sameFileIdentity=(file:RetainedNativeFile,identity:{readonly sha256:string;readonly bytes:number;
 readonly dev:string;readonly ino:string;readonly mtime_ns:string;readonly ctime_ns:string;readonly nlink:string}):boolean=>
 file.sha256===identity.sha256&&file.bytes===identity.bytes&&file.dev===identity.dev&&file.ino===identity.ino
 &&file.mtime_ns===identity.mtime_ns&&file.ctime_ns===identity.ctime_ns&&file.nlink===identity.nlink;
const canonical=(value:unknown):string=>{
 if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const record=value as Record<string,unknown>;
 return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
};
const deepFreeze=<T>(value:T):T=>{
 if(value===null||typeof value!=='object')return value;
 if(Array.isArray(value)){for(const item of value)deepFreeze(item);return Object.freeze(value) as T;}
 for(const item of Object.values(value as Record<string,unknown>))deepFreeze(item);
 return Object.freeze(value) as T;
};

/** The upstream's normalisation of one ffprobe answer.
 *
 * It is the upstream `derived.probe` rule for rule: the first video stream, the format
 * duration when the format is not a picture, the frame rate rounded to two decimals,
 * and the sides swapped when the video is turned a quarter. */
export function normalizeNativeProbe(answer:unknown):NormalizedNativeProbe{
 if(answer===null||typeof answer!=='object')refuse('NATIVE_PROBE_MALFORMED','The media tool returned an answer that is not an object');
 const raw=answer as {format?:{duration?:unknown;format_name?:unknown};streams?:unknown};
 const streams=Array.isArray(raw.streams)?raw.streams:[];
 const video=streams.find(stream=>!!stream&&typeof stream==='object'&&(stream as {codec_type?:unknown}).codec_type==='video') as
  {width?:unknown;height?:unknown;avg_frame_rate?:unknown;codec_name?:unknown;pix_fmt?:unknown;side_data_list?:unknown;tags?:unknown}|undefined;
 const audio=streams.some(stream=>!!stream&&typeof stream==='object'&&(stream as {codec_type?:unknown}).codec_type==='audio');
 const formatName=String(raw.format?.format_name??'');
 const duration=Number(raw.format?.duration);
 const keptDuration=Number.isFinite(duration)&&duration>0&&!/image|png|mjpeg/.test(formatName)?duration:null;
 const rate=String(video?.avg_frame_rate??'0/1').split('/').map(Number);
 const numerator=rate[0];const denominator=rate[1];
 const rounded=numerator&&denominator?Math.round((numerator/denominator)*100)/100:null;
 const sideData=Array.isArray(video?.side_data_list)?video?.side_data_list:[];
 const rotationEntry=sideData.find(entry=>!!entry&&typeof entry==='object'&&(entry as {rotation?:unknown}).rotation!=null) as {rotation?:unknown}|undefined;
 const tags=(video?.tags&&typeof video.tags==='object')?video.tags as {rotate?:unknown}:undefined;
 const turn=Number(rotationEntry?.rotation??tags?.rotate??0);
 const quarter=Math.abs(Math.round(turn/90))%2===1;
 const width=typeof video?.width==='number'?video.width:null;
 const height=typeof video?.height==='number'?video.height:null;
 const shown=quarter&&width!==null&&height!==null?{width:height,height:width}:{width,height};
 return {
  duration:keptDuration,width:shown.width,height:shown.height,
  fps:rounded!==null&&Number.isFinite(rounded)&&rounded>0?rounded:null,
  audio,codec:typeof video?.codec_name==='string'?video.codec_name:null,pixfmt:typeof video?.pix_fmt==='string'?video.pix_fmt:null,
 };
}

/** The upstream's own key of a media file: the path, its size and its change time. */
const upstreamMediaKey=(relativePath:string,bytes:number,mtimeMs:number):string=>
 createHash('sha1').update(`${relativePath}\0${bytes}\0${Math.round(mtimeMs)}`).digest('hex').slice(0,20);

/** The upstream's stamp of the files a picture was drawn from. */
const upstreamStamp=(entries:readonly {path:string;mtime_ms:number;bytes:number}[]):string=>
 createHash('sha256').update(entries.map(entry=>`${entry.path}:${entry.mtime_ms}:${entry.bytes}`).join('\n')).digest('hex').slice(0,24);

/** The native listing of the media: the videos under `assets/`, in the order the
 *  native returns them — a numeric collation of the whole path, not a raw directory
 *  order and not a plain lexicographic one.
 *
 *  It is the upstream `listFiles` rule for rule: the media live under `assets/`,
 *  hidden names are skipped, the walk descends while the depth allows it, and a file
 *  is a video when its own name says so. The order is the host's own numeric
 *  collation, so the reader and the native agree on the same host. */
export function nativeVideoListingOrder(paths:readonly string[]):string[]{
 const found:string[]=[];
 const present=new Set(paths);
 const visit=(prefix:string,depth:number):void=>{
  if(depth>8)return;
  const children=new Set<string>();
  for(const path of paths){
   if(!path.startsWith(prefix))continue;
   const rest=path.slice(prefix.length);
   if(rest==='')continue;
   const slash=rest.indexOf('/');
   children.add(slash<0?rest:rest.slice(0,slash));
  }
  for(const name of [...children].sort()){
   if(name.startsWith('.'))continue;
   const path=prefix+name;
   if(clipKindOf(name)==='video'){found.push(path);continue;}
   // A regular file of another kind is not descended into.
   if(present.has(path))continue;
   visit(path+'/',depth+1);
  }
 };
 visit('assets/',0);
 return [...new Set(found)].sort((left,right)=>left.localeCompare(right,undefined,{numeric:true}));
}

/** A Host-private transport injection for the media tool.
 *
 * `spawn` replaces the process the runner starts, and `deadlineMs` shortens the
 * deadline the runner enforces. Neither can state a fact about the media. */
export interface NativeToolTransport {
 readonly spawn?:(command:string,args:readonly string[],options:{readonly stdio:readonly ['ignore','pipe','pipe'];readonly windowsHide:boolean})=>ChildProcess;
 readonly deadlineMs?:number;
}

/**
 * The place of one clip, as the pinned native resolves it.
 *
 * The native reads a clip that states no place as **zero** (`timeline.mjs`: `c.at = row.at ?? 0`),
 * and so does the Studio's own layout (`timeline-layout.ts`). A place that is stated but
 * is not a number is not an omission: it is refused.
 *
 * The producer plan never replaces the document. It is only **compared** with it, and a
 * difference is a refusal: the facts must describe the same playback the native would
 * do, not the plan's idea of it.
 */
export function nativeClipPlacement(at:unknown,planStart:number|null|undefined):number{
 let placed:number;
 if(at===undefined)placed=0;
 else if(typeof at==='number'&&Number.isFinite(at)&&at>=0)placed=at;
 else refuse('NATIVE_SOURCE_PLACEMENT_INVALID','A clip states a place that is not a number');
 if(planStart!==null&&planStart!==undefined&&Math.abs(planStart-placed)>0.001)
  refuse('NATIVE_SOURCE_PLACEMENT_MISMATCH','A clip and the producer plan disagree on its place');
 return placed;
}

/** What the reader needs from the Host. */
export interface CreatedNativeSourceReaderDeps {
 /** The committed producer, rights and consumer-graph authority. */
 readonly authority:CommittedSnapshotAuthority;
 /** The registry of the issued workspace views. */
 readonly workspaces:CreatedNativeWorkspaceService;
 /** The approved 015 module. It parses and computes; it never proves. */
 readonly library:NativeExpectedLibrary;
 /**
  * The Host-private descriptor operations of the working copy's closure.
  *
  * Only the close and the read observation can be replaced, and only to observe a
  * release that fails. Neither can make a fact true that is not.
  */
 readonly closureOps?:RetainedNativeDescriptorOps;
 /**
  * A Host-private observation of the reader's own children.
  *
  * It reports the real process and the real exit of every child the reader starts and
  * reaps. It can never state a fact about the media: only the tool's own output can.
  */
 readonly childEvents?:(event:{readonly kind:'started'|'exited';readonly pid:number;readonly argument:string})=>void;
 /**
  * A Host-private injection at the **transport** level of the media tool.
  *
  * It replaces the transport, never the runner: the same runner, the same parser and
  * the same child bookkeeping take their real failure branches. It can only make the
  * tool fail - it never produces an answer and never a fact - and every case that
  * uses it is labelled as an injection, never as a tool result.
  */
 readonly toolTransport?:NativeToolTransport;
 /**
  * The descriptor budget of this reader instance.
  *
  * It is optional: the reader owns one when it is not given one. The two trees of
  * one acquisition and the parallel proofs of this reader draw from the SAME
  * count, so the instance budget is the instance's and not each tree's. */
 readonly pool?:RetainedDescriptorPool;
}

/** One acquisition's resources and their single owner.
 *
 * The two closures, the two leases and every retained handle travel together: the
 * owner releases the closures only after the last leaf has been released. */
interface Transfer {
 readonly handles:NativeExpectedRetainedFile[];
 /** The leaves that are still held. The owner is released when the last one goes. */
 remaining:number;
 released:boolean;
 /** Whether the facts were delivered. The owner travels with the handles only then. */
 delivered:boolean;
 /** Release the owner: the closures and the leases. Attempted once. */
 readonly releaseOwner:()=>void;
 /** The same release, draining the work in flight first. Attempted once. */
 readonly releaseOwnerAsync:()=>Promise<void>;
 /** Make one retained handle of a closure. */
 readonly handle:(closure:RetainedNativeClosure,file:RetainedNativeFile)=>NativeExpectedRetainedFile;
}

export class CreatedNativeSourceReader implements NativeExpectedSourcePort {
 readonly #authority:CommittedSnapshotAuthority;
 readonly #workspaces:CreatedNativeWorkspaceService;
 readonly #library:NativeExpectedLibrary;
 /** The Host-private observation of the reader's own children. */
 readonly #childEvents:CreatedNativeSourceReaderDeps['childEvents'];
 /** The Host-private descriptor operations of the working copy's closure. */
 readonly #closureOps:RetainedNativeDescriptorOps|undefined;
 /** The Host-private transport injection of the media tool. */
 readonly #toolTransport:CreatedNativeSourceReaderDeps['toolTransport'];
 /** The descriptor budget of this reader instance: both of its trees and every
  *  parallel proof of it draw from this one count. */
 readonly #pool:RetainedDescriptorPool;
 /** Every live child of the reader. The reader owns them and reaps them itself. */
 readonly #children=new Map<number,OwnedChild>();
 #nextChild=0;
 /** The admitted reads. A close waits for them: none of them may outlive it. */
 readonly #reads=new Set<Promise<unknown>>();
 /** The underlying operations of the admitted reads.
  *
  * A cancelled caller is not a settled dependency: the acquisition the reader started
  * is still in flight, and the close waits for it to really settle. */
 readonly #acquisitions=new Set<Promise<unknown>>();
 /** The failures of the releases this reader could not finish. They are kept. */
 readonly #cleanupFailures:unknown[]=[];
 /** The directories this reader retained, of both trees.
  *
  * It is a Host-private fact: it shows that the two trees' same relative path is
  * two independent allocations - two live descriptors - and not two wrapper
  * objects. */
 readonly #retainedDirectories:{readonly tree:'source'|'workspace';readonly relative_path:string;readonly dev:string;readonly ino:string}[]=[];
 /** Resolved when the reader closes. Every accepted wait is bound to it. */
 readonly #closing:Promise<void>;
 #close!:()=>void;
 #toolVersion:Promise<string>|null=null;
 #closed=false;
 #cleanupUncertain=false;

 constructor(deps:CreatedNativeSourceReaderDeps){
  this.#authority=deps.authority;
  this.#workspaces=deps.workspaces;
  this.#library=deps.library;
  this.#childEvents=deps.childEvents;
  this.#closureOps=deps.closureOps;
  this.#toolTransport=deps.toolTransport;
  // The instance budget: one count for the source tree, the working copy and the
  // parallel proofs of this reader.
  this.#pool=deps.pool??new RetainedDescriptorBudget(RETAINED_NATIVE_BUDGET.maxDescriptors);
  this.#closing=new Promise<void>(resolve=>{this.#close=resolve;});
 }
 /** The reader's own reason for an aliased leaf.
  *
  * The ORIGINAL failure is kept as its cause and the genuine release failures of it
  * stay marked: a fresh reason never drops them. */
 #aliasRefusal(error:unknown):never{
  const refusal=new NativeSourceReaderError('NATIVE_SOURCE_COPY_ALIASED','The working copy holds the committed file itself, not a copy of it');
  try{Object.defineProperty(refusal,'cause',{value:error,enumerable:false,configurable:true});}catch{/* the error carries what it can */}
  const genuine=retainedCleanupFailures(error);
  if(genuine.length>0)markRetainedCleanupFailures(refusal,genuine);
  throw refusal;
 }
 /** The descriptor budget of this reader instance.
  *
  * It is a Host-private fact: the tests of this Host read it to see that the two
  * trees and the parallel proofs share ONE count. */
 get descriptorPool():RetainedDescriptorPool{return this.#pool;}
 /** The directories this reader retained, of both trees.
  *
  * It is a Host-private fact, and it is what shows that an empty directory is
  * evidence of its own and that the two trees hold their own allocations. */
 get retainedDirectories():readonly {readonly tree:'source'|'workspace';readonly relative_path:string;readonly dev:string;readonly ino:string}[]{return [...this.#retainedDirectories];}

 /** Stop admission, abort the accepted work and drain it.
  *
  * It does not close a delivered resource: the resources of a delivered proof belong
  * to their owner until it releases them. */
 async close():Promise<void>{
  this.#closed=true;
  // The accepted waits are told at once: a read that is still waiting for the
  // authority must stop, and it must not start a child of its own afterwards.
  this.#close();
  // Every child is killed and reaped: nothing of the reader outlives its close.
  for(const child of [...this.#children.values()])child.kill();
  while(this.#children.size>0){
   const waiting=[...this.#children.values()].map(child=>child.done);
   await Promise.allSettled(waiting);
  }
  // The admitted reads are awaited: a read that is still running must see the close
  // and stop, and it must not start a child of its own afterwards.
  while(this.#reads.size>0)await Promise.allSettled([...this.#reads]);
  // The underlying operations are awaited: a cancelled caller is not a settled
  // dependency, and a late result must be released before the close returns.
  while(this.#acquisitions.size>0)await Promise.allSettled([...this.#acquisitions]);
  // The close reports the real cleanup state: a release that failed is kept.
  if(this.#cleanupFailures.length>0){
   const failure=new NativeSourceReaderError('NATIVE_SOURCE_CLEANUP_FAILED','The native source resources could not be released');
   Object.defineProperty(failure,'cleanup_errors',{value:[...this.#cleanupFailures],enumerable:false,configurable:true});
   throw failure;
  }
 }

 /** Wait for a promise the reader cannot cancel.
  *
  * There are two different things here, and they are not the same:
  *
  * - the **caller's** wait ends at once when the reader closes: the caller is told the
  *   read was cancelled, promptly;
  * - the **underlying operation** is tracked until it really settles. The reader asked
  *   for it, and the close does not return before the dependency has ended.
  *
  * A result that arrives after the caller was cancelled is released here, by this one
  * owner, exactly once; a failure of that release is kept and makes the close report
  * the real cleanup state. */
 #adopt<T>(work:Promise<T>,release:(value:T)=>void):Promise<T>{
  // The raw promise is already running: it is owned here whatever the state of the
  // reader is. Abandoning it would leave its rejection unhandled and its result
  // unreleased.
  let cancelled=false;
  // The owner of the underlying operation settles the dependency exactly once, and the
  // close waits for it: a cancelled caller is not a settled dependency.
  const owned=work.then(value=>{
   if(!cancelled)return;
   try{release(value);}catch(error){this.#cleanupUncertain=true;this.#cleanupFailures.push(error);}
  },(error:unknown)=>{
   // This observer is the OWNERSHIP ledger, not the caller's classification: it only
   // ever adopts the genuine release failures of the acquisition the reader started.
   // It never throws and never replaces the failure the caller will see.
   const genuine=retainedCleanupFailures(error);
   if(genuine.length>0){this.#cleanupUncertain=true;this.#cleanupFailures.push(...genuine);}
  });
  this.#acquisitions.add(owned);
  void owned.then(()=>this.#acquisitions.delete(owned),()=>this.#acquisitions.delete(owned));
  return new Promise<T>((resolve,reject)=>{
   let settled=false;
   const onClose=():void=>{
    if(settled)return;
    settled=true;cancelled=true;
    reject(new NativeSourceReaderError('NATIVE_SOURCE_ABORTED','The native source reader was closed while it was reading'));
   };
   void this.#closing.then(onClose,onClose);
   work.then(value=>{
    if(settled)return;
    settled=true;resolve(value);
   },error=>{
    if(settled)return;
    settled=true;reject(error);
   });
  });
 }

 /** Run the fixed local tool and wait for its real exit.
  *
  * The child's `close` is awaited, never its `exit`: a child that is still running has
  * not released anything. The output is bounded, and a bound that is reached is a
  * refusal, not a truncated answer. The child is owned by the reader: a close of the
  * reader kills it and waits for it. */
 #runTool(command:string,args:readonly string[],stdoutLimit:number,stderrLimit:number,timeoutMs:number):Promise<{stdout:string;stderr:string;code:number}>{
  if(this.#closed)return Promise.reject(new NativeSourceReaderError('NATIVE_SOURCE_READER_CLOSED','The native source reader is closed'));
  return new Promise((resolve,reject)=>{
   const start=this.#toolTransport?.spawn
    ??((name:string,argv:readonly string[],options:{readonly stdio:readonly ['ignore','pipe','pipe'];readonly windowsHide:boolean})=>spawn(name,[...argv],{stdio:['ignore','pipe','pipe'],windowsHide:options.windowsHide}));
   const child=start(command,[...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
   const stdout:Buffer[]=[];const stderr:Buffer[]=[];
   let stdoutBytes=0;let stderrBytes=0;
   let reason:'timeout'|'output'|'cancelled'|null=null;
   let closed=false;let spawnError:unknown;
   const id=++this.#nextChild;
   let settle=():void=>{};
   const done=new Promise<void>(resolveDone=>{settle=resolveDone;});
   const owned:OwnedChild={kill:()=>{if(!closed&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},done};
   this.#children.set(id,owned);
   const argument=args[args.length-1]??'';
   child.once('spawn',()=>{
    try{this.#childEvents?.({kind:'started',pid:child.pid??-1,argument});}
    catch{/* the observer can never state a fact about the media */}
   });
   const finish=():void=>{if(this.#children.get(id)===owned)this.#children.delete(id);settle();};
   const kill=()=>{if(!closed&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};
   const timer=setTimeout(()=>{reason??='timeout';kill();},this.#toolTransport?.deadlineMs??timeoutMs);
   timer.unref();
   child.stdout?.on('data',(chunk:Buffer)=>{
    if(reason)return;
    stdoutBytes+=chunk.length;
    if(stdoutBytes>stdoutLimit){reason='output';kill();return;}
    stdout.push(chunk);
   });
   child.stderr?.on('data',(chunk:Buffer)=>{
    if(reason)return;
    stderrBytes+=chunk.length;
    if(stderrBytes>stderrLimit){reason='output';kill();return;}
    stderr.push(chunk);
   });
   child.on('error',error=>{spawnError=error;kill();});
   child.once('close',(code,signal)=>{
    closed=true;clearTimeout(timer);finish();
    try{this.#childEvents?.({kind:'exited',pid:child.pid??-1,argument});}
    catch{/* the observer can never state a fact about the media */}
    if(spawnError){reject(new NativeSourceReaderError('NATIVE_PROBE_UNAVAILABLE','The fixed media tool could not be started'));return;}
    if(reason){reject(new NativeSourceReaderError('NATIVE_PROBE_'+reason.toUpperCase(),'The fixed media tool did not finish within its limits'));return;}
    if(signal){reject(new NativeSourceReaderError('NATIVE_PROBE_INTERRUPTED','The fixed media tool was interrupted'));return;}
    resolve({stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8'),code:code??-1});
   });
  });
 }

 /** The version of the fixed tool, read once.
  *
  * It is part of the provenance of every probe, so a tool that cannot be read is a
  * refusal with its own reason — never an empty version that would make two
  * different probes look the same. */
 #version():Promise<string>{
  if(this.#toolVersion===null){
   this.#toolVersion=this.#runTool('ffprobe',['-version'],PROBE_STDOUT_LIMIT,PROBE_STDERR_LIMIT,PROBE_TIMEOUT_MS)
    .then(result=>{
     const version=result.stdout.split('\n')[0]?.trim()??'';
     if(result.code!==0||version==='')refuse('NATIVE_PROBE_UNAVAILABLE','The fixed media tool did not report its version');
     return version;
    })
    .catch((error:unknown)=>{this.#toolVersion=null;throw error;});
  }
  return this.#toolVersion;
 }

 /** Probe one retained file through the descriptor the closure holds.
  *
  * The path is the parent's own descriptor path, so the tool reads the bytes that were
  * retained and not whatever the name may point at now. */
 async #probe(closure:RetainedNativeClosure,file:RetainedNativeFile,relativePath:string,version:string):Promise<ProbeRecord>{
  if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader is closed');
  const path=closure.probePath(file);
  // The tool runs through the one runner; an injected transport makes that runner take
  // its real failure branch. The runner never produces an answer of its own.
  const result=await this.#runTool('ffprobe',[...PROBE_PROFILE,path],PROBE_STDOUT_LIMIT,PROBE_STDERR_LIMIT,PROBE_TIMEOUT_MS);
  if(result.code!==0)refuse('NATIVE_PROBE_FAILED','The fixed media tool did not accept the retained media');
  let answer:unknown;
  try{answer=JSON.parse(result.stdout);}catch{refuse('NATIVE_PROBE_MALFORMED','The fixed media tool returned an answer that is not JSON');}
  const normalized=normalizeNativeProbe(answer);
  const digest=createHash('sha256').update(canonical({
   tool_version:version,
   argv_profile:[...PROBE_PROFILE,'<parent-pid-fd-path>'],
   input_sha256:file.sha256,input_bytes:file.bytes,
   ledger:{relative_path:relativePath,dev:file.dev,ino:file.ino},
   normalized,
  })).digest('hex');
  return {source_ref:relativePath,sha256:file.sha256,bytes:file.bytes,normalized,proof_digest:digest};
 }

 /** The dependencies of one read. */
 async readSource(input:{readonly binding:NativeExpectedBinding}):Promise<NativeExpectedSourceFacts>{
  if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader is closed');
  if(this.#cleanupUncertain)refuse('NATIVE_SOURCE_READER_UNCERTAIN','The native source reader cannot say what it holds');
  // The admission is registered BEFORE the read is invoked.
  //
  // The read calls the binding's own callbacks, and one of them may close this
  // reader: the close must find the read admitted, or it would return while the
  // read was still running.
  let settle!:()=>void;
  const registration=new Promise<void>(resolve=>{settle=resolve;});
  this.#reads.add(registration);
  const read=this.#read(input.binding);
  void read.then(()=>{this.#reads.delete(registration);settle();},()=>{this.#reads.delete(registration);settle();});
  return read;
 }

 /** The read itself. */
 async #read(binding:NativeExpectedBinding):Promise<NativeExpectedSourceFacts>{
  // One immutable baseline owns the whole read: every field is taken once and never
  // resampled, so a callback cannot move the ground under the read.
  const baseline={
   project_id:binding.project_id,native_project_id:binding.native_project_id,revision:binding.revision,
   snapshot_id:binding.snapshot_id,source_digest:binding.source_digest,
   instance_generation:binding.instance_generation,selection_version:binding.selection_version,
   workspace_ref:binding.workspace.workspace_ref,workspace_snapshot_id:binding.workspace.snapshot_id,
   workspace_source_digest:binding.workspace.source_digest,workspace_revision:binding.workspace.revision,
  };
  if(binding.isCurrent()!==true)refuse('NATIVE_SOURCE_BINDING_STALE','The native binding is no longer current');
  // The liveness callback is an external callback: it may have closed this reader.
  // No new dependency may start after that.
  if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader was closed while it was reading');

  let workspaceLease:NativeWorkspaceLease|undefined;
  let sourceLease:VerifiedNativeFactsLease|undefined;
  let workspaceClosure:RetainedNativeClosure|undefined;
  let transfer:Transfer|undefined;
  const retained:NativeExpectedRetainedFile[]=[];
  const failures:unknown[]=[];
  try{
   // The issued view: its ref, its owner, its transaction and its generation.
   workspaceLease=this.#workspaces.acquireExpectedLease(baseline.workspace_ref,{
    project_id:baseline.project_id,snapshot_id:baseline.workspace_snapshot_id,
    source_digest:baseline.workspace_source_digest,revision:baseline.workspace_revision,
    native_project_id:baseline.native_project_id,
   });
   if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader was closed while it was reading');
   if(workspaceLease.generation!==baseline.instance_generation)refuse('NATIVE_SOURCE_GENERATION_STALE','The native workspace generation moved');
   if(workspaceLease.assertCurrent()!==true)refuse('NATIVE_SOURCE_WORKSPACE_STALE','The native workspace view is no longer current');

   // The committed facts of that very transaction, and the retained source tree.
   // The wait cannot be cancelled, so a close ends it: a result that arrives after
   // the close is released here, because the reader asked for it.
   const acquired=this.#authority.acquireNativeFacts(baseline.project_id,workspaceLease.transaction_id,workspaceLease.principal_id,this.#pool);
   sourceLease=await this.#adopt(acquired,late=>{late.release();});
   if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader was closed while it was reading');
   if(!this.#authority.isNativeFactsLease(sourceLease))refuse('NATIVE_SOURCE_LEASE_FOREIGN','The native facts lease is not one this authority issued');
   const facts:VerifiedNativeFacts=sourceLease.facts;
   if(facts.snapshot_id!==baseline.snapshot_id||facts.source_digest!==baseline.source_digest
    ||facts.project_revision!==baseline.revision)refuse('NATIVE_SOURCE_BINDING_MOVED','The committed facts are not the ones the binding names');

   // The working copy: a second, independent set of descriptors.
   workspaceClosure=await RetainedNativeClosure.open(workspaceLease.root,{},this.#closureOps,this.#pool);
   if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader was closed while it was reading');

   const owned:Transfer={
    handles:retained,remaining:0,released:false,delivered:false,
    releaseOwner:()=>{
     if(owned.released)return;
     owned.released=true;
     const ownerFailures:unknown[]=[];
     // The uncertainty is latched before any release is attempted: a failure means
     // this reader can no longer say what it holds.
     try{workspaceClosure?.close();}catch(error){this.#cleanupUncertain=true;ownerFailures.push(error);}
     try{sourceLease?.release();}catch(error){this.#cleanupUncertain=true;ownerFailures.push(error);}
     try{workspaceLease?.release();}catch(error){this.#cleanupUncertain=true;ownerFailures.push(error);}
     if(ownerFailures.length>0){
      const error=new NativeSourceReaderError('NATIVE_SOURCE_CLEANUP_FAILED','The native source resources could not be released');
      Object.defineProperty(error,'cleanup_errors',{value:ownerFailures,enumerable:false,configurable:true});
      throw error;
     }
    },
    releaseOwnerAsync:async()=>{
     if(owned.released)return;
     owned.released=true;
     const ownerFailures:unknown[]=[];
     // The work in flight is drained before the descriptors are released.
     if(workspaceClosure){try{await workspaceClosure.release();}catch(error){this.#cleanupUncertain=true;ownerFailures.push(error);}}
     if(sourceLease){try{sourceLease.release();}catch(error){this.#cleanupUncertain=true;ownerFailures.push(error);}}
     if(workspaceLease){try{workspaceLease.release();}catch(error){this.#cleanupUncertain=true;ownerFailures.push(error);}}
     if(ownerFailures.length>0){
      const error=new NativeSourceReaderError('NATIVE_SOURCE_CLEANUP_FAILED','The native source resources could not be released');
      Object.defineProperty(error,'cleanup_errors',{value:ownerFailures,enumerable:false,configurable:true});
      throw error;
     }
    },
    handle:(closure:RetainedNativeClosure,file:RetainedNativeFile):NativeExpectedRetainedFile=>{
     let released=false;
     const handle:NativeExpectedRetainedFile={
      relative_path:file.relative_path,sha256:file.sha256,bytes:file.bytes,
      verify:()=>closure.verifyFile(file),
      close:()=>{
       if(released)return;
       released=true;
       const ownFailures:unknown[]=[];
       // The uncertainty is latched before the release is attempted, and the failure
       // reaches the reader's ledger so that its close reports the real state.
       try{closure.releaseFile(file);}catch(error){this.#cleanupUncertain=true;this.#cleanupFailures.push(error);ownFailures.push(error);}
       owned.remaining-=1;
       // Before the delivery the owner belongs to this reader; after it, the owner
       // travels with the handles and goes with the last of them.
       if(owned.remaining<=0&&owned.delivered)try{owned.releaseOwner();}catch(error){this.#cleanupUncertain=true;this.#cleanupFailures.push(error);ownFailures.push(error);}
       if(ownFailures.length>0){
        const error=new NativeSourceReaderError('NATIVE_SOURCE_CLEANUP_FAILED','A native source resource could not be released');
        Object.defineProperty(error,'cleanup_errors',{value:ownFailures,enumerable:false,configurable:true});
        throw error;
       }
      },
     };
     owned.remaining+=1;
     retained.push(handle);
     return handle;
    },
   };

   transfer=owned;
   const read=await this.#readFacts(baseline,facts,sourceLease,workspaceLease,workspaceClosure,owned);
   // The linearization point of the delivery.
   //
   // Every callback and every await has returned by now, and NOTHING may run
   // between this check and the delivery: a reader that was closed, or that became
   // uncertain, cannot hand out facts it cannot vouch for. The refusal takes the
   // existing all-attempt pre-delivery cleanup, because it happens before the
   // resources become the owner's.
   if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader was closed while it was reading');
   if(this.#cleanupUncertain)refuse('NATIVE_SOURCE_READER_UNCERTAIN','The native source reader cannot say what it holds');
   // The liveness of the binding and of the two leases is checked at the LAST
   // moment: the owner, the base, the control and the generation must still be the
   // ones this round was made against.
   //
   // These callbacks may re-enter the reader: the last of them may close it or make
   // it uncertain and still answer true. So the closed/uncertain check comes AFTER
   // them, with nothing between it and the delivery.
   if(binding.isCurrent()!==true)refuse('NATIVE_SOURCE_BINDING_STALE','The native binding is no longer current');
   if(sourceLease.assertCurrent()!==true)refuse('NATIVE_SOURCE_CLOSURE_MOVED','The committed source changed while it was read');
   if(workspaceLease.assertCurrent()!==true)refuse('NATIVE_SOURCE_WORKSPACE_STALE','The native workspace view is no longer current');
   if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader was closed while it was reading');
   if(this.#cleanupUncertain)refuse('NATIVE_SOURCE_READER_UNCERTAIN','The native source reader cannot say what it holds');
   // From now on the resources are the owner's: the reader does not close them.
   owned.delivered=true;
   return read;
  }catch(error){
   // Nothing may leak: a failure before the delivery releases everything here, and
   // the primary error keeps its place with the cleanup errors attached to it. Every
   // owner is attempted once, by one owner.
   for(const handle of retained){try{handle.close();}catch(cleanupError){failures.push(cleanupError);}}
   if(transfer!==undefined){try{await transfer.releaseOwnerAsync();}catch(cleanupError){failures.push(cleanupError);}}
   else{
    if(workspaceClosure){try{await workspaceClosure.release();}catch(cleanupError){failures.push(cleanupError);}}
    if(sourceLease){try{sourceLease.release();}catch(cleanupError){failures.push(cleanupError);}}
    if(workspaceLease){try{workspaceLease.release();}catch(cleanupError){failures.push(cleanupError);}}
   }
   this.#cleanupUncertain=this.#cleanupUncertain||failures.length>0;
   // The cleanup failures are MERGED into the primary: the causes it already had
   // are kept, and they are marked as GENUINE, because they really were release
   // failures.
   if(failures.length>0)mergeRetainedCleanupCauses(error,failures);
   // The reader owns the copy boundary: a leaf that is linked to another name is
   // refused with the READER's reason, and the original failure stays its cause.
   if(String((error as {code?:unknown}).code??'')==='NATIVE_CLOSURE_ALIASED')this.#aliasRefusal(error);
   throw error;
  }
 }

 /** The read itself, with the two closures open. */
 async #readFacts(
  baseline:{readonly project_id:string;readonly native_project_id:string;readonly revision:number;
   readonly snapshot_id:string;readonly source_digest:string;readonly instance_generation:number;
   readonly selection_version:number;readonly workspace_ref:string;readonly workspace_snapshot_id:string;
   readonly workspace_source_digest:string;readonly workspace_revision:number},
  facts:VerifiedNativeFacts,
  sourceLease:VerifiedNativeFactsLease,
  workspaceLease:NativeWorkspaceLease,
  workspaceClosure:RetainedNativeClosure,
  transfer:Transfer,
 ):Promise<NativeExpectedSourceFacts>{
  const sourceClosure=sourceLease.closure;
  const sourceEntries=new Map(facts.source_entries.map(entry=>[entry.relative_path,entry.sha256]));

  // Every file of the working copy is retained, one resource per leaf, and classified.
  const workspaceFiles=workspaceClosure.fileMembership();
  const workspaceRetained=new Map<string,RetainedNativeFile>();
  for(const path of workspaceFiles){
   let file:RetainedNativeFile;
   try{file=await workspaceClosure.retainFile(path);}
   catch(error){
    // A leaf that is linked to another name is not a file of this tree: the reader
    // refuses it with ITS OWN reason, and the refusal keeps the alias visible.
    // The reader owns the copy boundary: a leaf that is linked to another name is
    // refused with the READER's reason, and the original failure stays its cause.
    if(String((error as {code?:unknown}).code??'')==='NATIVE_CLOSURE_ALIASED')this.#aliasRefusal(error);
    throw error;
   }
   workspaceRetained.set(path,file);
   transfer.handle(workspaceClosure,file);
  }
  // Every file of the committed source is a separate resource of its own: the same
  // relative path in the two trees is two objects with two descriptors.
  const sourceRetained=new Map<string,RetainedNativeFile>();
  for(const entry of facts.source_entries){
   const file=await sourceClosure.retainFile(entry.relative_path);
   sourceRetained.set(entry.relative_path,file);
   transfer.handle(sourceClosure,file);
  }

  // The committed entries must be present in the working copy, byte for byte.
  for(const entry of facts.source_entries){
   const copy=workspaceRetained.get(entry.relative_path);
   if(copy===undefined)refuse('NATIVE_SOURCE_COPY_INCOMPLETE','The working copy does not hold a committed source file');
   if(copy.sha256!==entry.sha256)refuse('NATIVE_SOURCE_COPY_DRIFTED','The working copy holds different bytes than the committed source');
  }
  // Two descriptor objects are not two trees: a leaf that is the SAME file as any
  // leaf of the committed source is an alias, not a copy. The identity is compared
  // over EVERY path of both trees, not only over the same relative path.
  const sourceIdentities=new Map<string,string>();
  for(const [path,file] of sourceRetained)sourceIdentities.set(`${file.dev}:${file.ino}`,path);
  for(const [path,file] of workspaceRetained){
   const original=sourceIdentities.get(`${file.dev}:${file.ino}`);
   if(original!==undefined)refuse('NATIVE_SOURCE_COPY_ALIASED','The working copy holds the committed file itself, not a copy of it');
  }
  // Every directory of BOTH trees is retained: an empty one is evidence of its own,
  // and the two trees' same relative path is then two independent allocations -
  // two live descriptors - and not two wrapper objects.
  for(const directory of workspaceClosure.directories()){
   const retained=await workspaceClosure.retainDirectory(directory);
   this.#retainedDirectories.push({tree:'workspace',relative_path:retained.relative_path,dev:retained.dev,ino:retained.ino});
  }
  for(const directory of sourceClosure.directories()){
   const retained=await sourceClosure.retainDirectory(directory);
   this.#retainedDirectories.push({tree:'source',relative_path:retained.relative_path,dev:retained.dev,ino:retained.ino});
  }
  // The directories of the working copy are classified too: an unknown directory is
  // an item the native does not produce, whether or not it holds a file.
  const sourceDirectories=new Set(sourceClosure.directories());
  const allowedDirectories=new Set([
   '.film','.film/cache','.film/cache/probe','.film/cache/posters','.film/cache/frames',
   '.film/cache/waves','.film/cache/pageframes',
  ]);
  for(const directory of workspaceClosure.directories()){
   if(sourceDirectories.has(directory)||allowedDirectories.has(directory))continue;
   refuse('NATIVE_SOURCE_UNKNOWN_DIRECTORY','The working copy holds a directory the native does not produce');
  }
  // Anything the working copy holds beyond the committed source is a derived item, and
  // every derived item is classified by the upstream rule that produced it.
  const derived=workspaceFiles.filter(path=>!sourceEntries.has(path));
  await this.#classifyDerived(derived,workspaceRetained,workspaceClosure,facts,baseline);

  // The native facts of the working copy: the film, the sidecars and the listing.
  const filmFile=workspaceRetained.get('film.html');
  if(filmFile===undefined)refuse('NATIVE_SOURCE_FILM_ABSENT','The working copy has no film');
  const filmText=await workspaceClosure.readText(filmFile);
  const nativeRev=createHash('sha256').update(filmText,'utf8').digest('hex').slice(0,16);
  if(nativeRev!==facts.film.native_rev)refuse('NATIVE_SOURCE_FILM_DRIFTED','The working copy film is not the committed film');

  const settings=await this.#sidecar(workspaceClosure,workspaceRetained,'.film/settings.json');
  const markers=await this.#sidecar(workspaceClosure,workspaceRetained,'.film/markers.json');
  const subtitles=await this.#sidecar(workspaceClosure,workspaceRetained,'.film/subtitles.json');
  const rights=await this.#sidecar(workspaceClosure,workspaceRetained,'rights.json');

  const settingsValue:ProjectSettings=settings===null?{}:this.#library.parseProjectSettings(JSON.parse(settings));
  const markersValue:Marker[]=markers===null?[]:this.#library.parseMarkers(JSON.parse(markers));
  const rightsRecord=rights===null?null:JSON.parse(rights) as {assets?:readonly {asset_id?:unknown}[]};
  const rightsDigests=new Map<string,string>();
  for(const asset of rightsRecord?.assets??[]){
   const id=typeof asset?.asset_id==='string'?asset.asset_id:null;
   if(id!==null)rightsDigests.set(id,sha256Of(canonical(asset)));
  }

  // The listing of the media, in the order the native itself returns it.
  const listing=nativeVideoListingOrder([...workspaceRetained.keys()]);
  // Every clip of the film, with its own source and its own provenance.
  const doc=(facts.film_doc??null) as {tracks?:readonly {clips?:readonly Record<string,unknown>[]}[]}|null;
  const clips=(doc?.tracks??[]).flatMap(track=>track.clips??[]);
  const graph=this.#consumerGraph(facts);

  // The media facts: every real probe of the retained bytes.
  const version=await this.#version();
  if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader was closed while it was reading');
  const probePaths=new Set<string>(listing);
  for(const clip of clips){
   const src=clip.src as string;
   if(clipKindOf(src)!=='page')probePaths.add(src);
  }
  const probeRecords=new Map<string,ProbeRecord>();
  for(const path of [...probePaths].sort()){
   const file=workspaceRetained.get(path);
   if(file===undefined)refuse('NATIVE_SOURCE_MEDIA_ABSENT','The working copy does not hold a media file the film names');
   probeRecords.set(path,await this.#probe(workspaceClosure,file,path,version));
  }

  // The numeric film: every clip placed with a number, or left as it is when the
  // native could not prove a number for it.
  const numericDoc=this.#numericDoc(doc,probeRecords,graph);

  const mediaFacts:ExpectedProjectionInput['media_facts']=[];
  const mediaFactBySource=new Map<string,ExpectedProjectionInput['media_facts'][number]>();
  // One fact per *source*, never per clip: two shots of the same media are one file,
  // and the projection accepts a source only once.
  const addMediaFact=(fact:ExpectedProjectionInput['media_facts'][number]):void=>{
   if(mediaFactBySource.has(fact.source_ref))return;
   mediaFactBySource.set(fact.source_ref,fact);
   mediaFacts.push(fact);
  };
  for(const clip of clips){
   const src=clip.src as string;
   const kind=clipKindOf(src);
   if(kind===null)refuse('NATIVE_SOURCE_CLIP_UNSUPPORTED','A clip names a file of a kind the native does not play');
   const digest=sourceEntries.get(src);
   if(digest===undefined)refuse('NATIVE_SOURCE_CLIP_UNPROVEN','A clip names a file the committed source does not hold');
   if(kind==='page'){
    addMediaFact({source_ref:src,source_sha256:digest,origin:'host_deterministic_source',
     proof_digest:sha256Of(canonical({kind:'page',source_sha256:digest,plan_digest:facts.plan_digest})),
     duration_ms:null,has_audio:false,fps:null});
    continue;
   }
   const record=probeRecords.get(src);
   if(record===undefined)refuse('NATIVE_SOURCE_CLIP_UNPROVEN','A clip names a media file that was not probed');
   addMediaFact({source_ref:src,source_sha256:digest,origin:'host_actual_probe',proof_digest:record.proof_digest,
    duration_ms:record.normalized.duration===null?null:Math.round(record.normalized.duration*1000),
    has_audio:record.normalized.audio,fps:record.normalized.fps});
  }
  // Every video of the listing is a media fact too, whether or not a clip names it.
  for(const path of listing){
   if(mediaFactBySource.has(path))continue;
   const digest=sourceEntries.get(path);
   const record=probeRecords.get(path);
   if(digest===undefined||record===undefined)refuse('NATIVE_SOURCE_LISTING_UNPROVEN','The native listing names a file that is not proved');
   addMediaFact({source_ref:path,source_sha256:digest,origin:'host_actual_probe',proof_digest:record.proof_digest,
    duration_ms:record.normalized.duration===null?null:Math.round(record.normalized.duration*1000),
    has_audio:record.normalized.audio,fps:record.normalized.fps});
  }

  const clipRefsFull:ExpectedProjectionInput['clip_refs']=clips.map(clip=>{
   const id=clip.id as string;
   const src=clip.src as string;
   const digest=sourceEntries.get(src);
   if(digest===undefined)refuse('NATIVE_SOURCE_CLIP_UNPROVEN','A clip names a file the committed source does not hold');
   if(clipKindOf(src)==='page'){
    return {clip_id:id,source_ref:src,source_sha256:digest,provenance:{kind:'controlled_source_artifact',
     artifact_ref:{id:`native-draft-plan:${baseline.project_id}`,version:baseline.revision,sha256:facts.plan_digest},
     producer_digest:facts.plan_digest,producer_receipt_digest:facts.plan_sha256}};
   }
   const assetId=graph.get(id)?.asset_id??null;
   if(assetId===null)refuse('NATIVE_SOURCE_CLIP_UNPROVEN','A media clip has no registered asset behind it');
   const rightsDigest=rightsDigests.get(assetId);
   if(rightsDigest===undefined)refuse('NATIVE_SOURCE_RIGHTS_UNPROVEN','A registered asset has no committed rights record');
   return {clip_id:id,source_ref:src,source_sha256:digest,provenance:{kind:'registered_asset',asset_id:assetId,rights_digest:rightsDigest}};
  });

  const mediaCatalogDigest=sha256Of(canonical(mediaFacts.map(fact=>({
   source_ref:fact.source_ref,source_sha256:fact.source_sha256,origin:fact.origin,proof_digest:fact.proof_digest,
   duration_ms:fact.duration_ms,has_audio:fact.has_audio,fps:fact.fps,
  }))));
  const listingDigest=sha256Of(canonical(listing));
  const rightsDigest=rights===null?null:sha256Of(rights);

  const expectedInput:ExpectedProjectionInput={
   format:'narralens.native-expected-input@1',
   upstream_sha:UPSTREAM_SHA,
   profile:'narralens.native-expected-numeric@1',
   binding:{project_id:baseline.project_id,project_revision:baseline.revision,snapshot_id:baseline.snapshot_id,
    source_digest:baseline.source_digest,film_sha256:facts.film.sha256},
   provenance:{origin:'host_independent',source_manifest_digest:baseline.source_digest,rights_digest:rightsDigest,
    media_catalog_digest:mediaCatalogDigest,listing_digest:listingDigest},
   ui_profile:{pending_drops:'excluded',preview_error:'excluded',live_height:'excluded',browser_preferences:'excluded'},
   source_entries:facts.source_entries.map(entry=>({relative_path:entry.relative_path,sha256:entry.sha256})),
   film:{file:{relative_path:'film.html',sha256:facts.film.sha256,state:'present'},value:numericDoc},
   settings:{file:{relative_path:'.film/settings.json',sha256:settings===null?null:this.#digestOf(workspaceRetained,'.film/settings.json'),
     state:settings===null?'absent':'present'},value:settingsValue},
   markers:{file:{relative_path:'.film/markers.json',sha256:markers===null?null:this.#digestOf(workspaceRetained,'.film/markers.json'),
     state:markers===null?'absent':'present'},value:markersValue},
   clip_refs:clipRefsFull,
   media_facts:mediaFacts,
   video_files_in_native_order:listing,
   span_facts:{profile:'numeric_source_only',origin:'not_used',proof_digest:null,values:[]},
  };

  // The fixed native consumers: the style and the captions of the working copy.
  //
  // What a consumer could not find is supplied from the retained tree and the
  // consumer runs again. The discovery is bounded: a fixed number of rounds and a
  // fixed number of dependencies per round, and every supplied dependency comes from
  // the retained tree.
  const supplied=new Map<string,string|null>();
  let sidecarInput=await this.#sidecarInputs(workspaceClosure,workspaceRetained,filmText,subtitles,probeRecords,supplied);
  let sidecars:NativeSidecarResult=await computeNativeEffectiveSidecars(sidecarInput);
  for(let round=0;round<3&&sidecars.status!=='computed'&&sidecars.missing.length>0;round+=1){
   const added=await this.#supplyMissing(sidecars.missing,workspaceClosure,workspaceRetained,probeRecords,supplied);
   if(added===0)break;
   sidecarInput=await this.#sidecarInputs(workspaceClosure,workspaceRetained,filmText,subtitles,probeRecords,supplied);
   sidecars=await computeNativeEffectiveSidecars(sidecarInput);
  }
  if(sidecars.status!=='computed')refuse('NATIVE_SOURCE_SIDECAR_UNSUPPORTED','The native consumers could not close the working copy');
  // Every dependency is checked against the ledger it belongs to: a file the consumer
  // read, an absence it proved, a directory it listed, a media file it probed.
  const negatives=new Set(workspaceClosure.negatives().map(entry=>entry.relative_path));
  const directories=new Set(workspaceClosure.directories());
  for(const dependency of sidecars.consumed_paths){
   if(!workspaceRetained.has(dependency))refuse('NATIVE_SOURCE_DEPENDENCY_UNPROVEN','A native consumer read a file the reader did not retain');
  }
  for(const dependency of sidecars.negative_lookups){
   if(!negatives.has(dependency))refuse('NATIVE_SOURCE_DEPENDENCY_UNPROVEN','A native consumer proved an absence the reader did not prove');
  }
  for(const dependency of sidecars.directory_lookups){
   if(dependency!=='.'&&!directories.has(dependency))refuse('NATIVE_SOURCE_DEPENDENCY_UNPROVEN','A native consumer listed a directory the reader did not retain');
  }
  for(const dependency of sidecars.media_lookups){
   if(!probeRecords.has(dependency))refuse('NATIVE_SOURCE_DEPENDENCY_UNPROVEN','A native consumer probed a media file the reader did not probe');
  }

  // The trees must still be the ones that were read.
  //
  // A change while the read was in flight means the round would mix two epochs: the
  // membership that was taken and the bytes that were read no longer belong together.
  // The round is refused and a new one starts from the tree as it is now.
  if(sourceLease.assertCurrent()!==true)refuse('NATIVE_SOURCE_CLOSURE_MOVED','The committed source changed while it was read');
  if(workspaceLease.assertCurrent()!==true)refuse('NATIVE_SOURCE_CLOSURE_MOVED','The working copy changed while it was read');
  if(workspaceClosure.verify()!==true)refuse('NATIVE_SOURCE_CLOSURE_MOVED','The working copy changed while it was read');

  const verifyClosure=()=> sourceLease.assertCurrent()===true&&workspaceLease.assertCurrent()===true&&workspaceClosure.verify()===true;

  return deepFreeze({
   entries:facts.source_entries.map(entry=>({relative_path:entry.relative_path,sha256:entry.sha256})),
   film:{relative_path:'film.html' as const,sha256:facts.film.sha256,bytes:facts.film.bytes,native_rev:facts.film.native_rev},
   expected_input:expectedInput,
   style:sidecars.style,
   captions:sidecars.captions,
   retained:transfer.handles,
   verifyClosure,
  });
 }

 /** The digest of a retained working copy file. */
 #digestOf(files:Map<string,RetainedNativeFile>,path:string):string{
  const file=files.get(path);
  if(file===undefined)refuse('NATIVE_SOURCE_FILE_ABSENT','A retained file is not there');
  return file.sha256;
 }

 /** The consumer graph of the committed producer, by clip id.
 *
 * It carries the asset behind each clip and the frame range the *plan* gave it: the
 * placement of a clip is the producer's own fact, not a guess. */
 #consumerGraph(facts:VerifiedNativeFacts):Map<string,{asset_id:string|null;start:number|null;end:number|null}>{
  const graph=facts.consumer_graph as {clips?:readonly {clip_id?:unknown;asset_id?:unknown;start_frame?:unknown;end_frame_exclusive?:unknown}[]}|null;
  const fps=facts.geometry.fps;
  const map=new Map<string,{asset_id:string|null;start:number|null;end:number|null}>();
  for(const clip of graph?.clips??[]){
   if(typeof clip?.clip_id!=='string')continue;
   const start=typeof clip.start_frame==='number'&&Number.isFinite(clip.start_frame)?clip.start_frame*fps.den/fps.num:null;
   const end=typeof clip.end_frame_exclusive==='number'&&Number.isFinite(clip.end_frame_exclusive)?clip.end_frame_exclusive*fps.den/fps.num:null;
   map.set(clip.clip_id,{asset_id:typeof clip.asset_id==='string'?clip.asset_id:null,start,end});
  }
  return map;
 }

 /** One sidecar file of the working copy: its text, or a proved absence. */
 async #sidecar(closure:RetainedNativeClosure,files:Map<string,RetainedNativeFile>,path:string):Promise<string|null>{
  const file=files.get(path);
  if(file!==undefined)return closure.readText(file);
  // The file is not there: the absence is proved, not assumed.
  await closure.retainAbsent(path);
  return null;
 }

 /** The numeric film: every clip with a number for its place and its length.
  *
  * The place of a clip is the *producer's* fact: the committed plan's frame range.
  * When the film itself states a place, the two must agree; when it does not, the
  * plan's range is used. Nothing is placed at zero by default, because two clips at
  * zero would silently overlap.
  *
  * A length is used only when it is proved: an explicit trim, or the length the
  * media really has. A clip the native could not measure keeps its own shape, and the
  * projection refuses it rather than the reader inventing a length. */
 #numericDoc(doc:unknown,media:Map<string,ProbeRecord>,placement:Map<string,{asset_id:string|null;start:number|null;end:number|null}>):ExpectedProjectionInput['film']['value']{
  const source=doc as {stage?:unknown;tracks?:readonly {clips?:readonly Record<string,unknown>[]}[]}|null;
  const tracks=(source?.tracks??[]).map(track=>({
   ...track,
   clips:(track.clips??[]).map(clip=>{
    const out:{[key:string]:unknown}={...clip};
    const id=typeof clip.id==='string'?clip.id:'';
    const plan=placement.get(id);
    const planStart=plan===undefined?null:plan.start;
    // The place is the document's own, resolved as the native resolves it; the plan
    // only compares with it.
    out.at=nativeClipPlacement(clip.at,planStart);
    const time=Array.isArray(clip.time)?clip.time as unknown[]:[];
    const from=typeof time[0]==='number'&&Number.isFinite(time[0])?time[0] as number:0;
    const record=typeof clip.src==='string'?media.get(clip.src):undefined;
    const native=record?.normalized.duration??null;
    if(time.length===2&&typeof time[1]==='number'&&time[1]>from){out.time=[from,time[1]];return out;}
    if(time.length<2&&native!==null&&native>from){out.time=[from,native];return out;}
    if(time.length>0)out.time=[from,...time.slice(1)];
    return out;
   }),
  }));
  return {stage:source?.stage??{w:1920,h:1080},tracks} as unknown as ExpectedProjectionInput['film']['value'];
 }

 /** The inputs of the fixed native consumers.
  *
  * Every file they may read is supplied with its real text or with a proved absence,
  * every directory they may list is supplied with its real order, and every media they
  * may ask about is supplied with the facts of the same bytes the probe read. */
 /** Supply the dependencies the native consumers could not find.
  *
  * The discovery is bounded and comes only from the retained tree: a file is read
  * through its retained descriptor, an absence is proved, and a media file is probed.
  * Nothing is invented and nothing is read outside the closure. */
 async #supplyMissing(missing:readonly string[],closure:RetainedNativeClosure,files:Map<string,RetainedNativeFile>,
  probes:Map<string,ProbeRecord>,supplied:Map<string,string|null>):Promise<number>{
  let added=0;
  for(const item of missing.slice(0,64)){
   const kind=item.startsWith('directory:')?'directory':item.startsWith('media:')?'media':'file';
   const path=kind==='file'?item:item.slice(item.indexOf(':')+1);
   if(kind==='directory'){
    if(files.has(path)||supplied.has(path))continue;
    try{await closure.retainDirectory(path);}catch{continue;}
    added+=1;continue;
   }
   if(kind==='media'){
    if(probes.has(path))continue;
    const file=files.get(path);
    if(file===undefined)continue;
    probes.set(path,await this.#probe(closure,file,path,await this.#version()));
    added+=1;continue;
   }
   if(supplied.has(path))continue;
   const file=files.get(path);
   if(file===undefined){await closure.retainAbsent(path);supplied.set(path,null);added+=1;continue;}
   supplied.set(path,await closure.readText(file));
   added+=1;
  }
  return added;
 }

 async #sidecarInputs(closure:RetainedNativeClosure,files:Map<string,RetainedNativeFile>,filmText:string,
  subtitles:string|null,probes:Map<string,ProbeRecord>,supplied:Map<string,string|null>=new Map()):Promise<NativeSidecarInputs>{
  const textFiles:Record<string,string|null>={'film.html':filmText,'.film/subtitles.json':subtitles,...Object.fromEntries(supplied)};
  const directories:Record<string,readonly string[]>={};
  const media:Record<string,{readonly duration:number|null;readonly audio:boolean}>={};
  const mediaPaths=[...probes.keys()].filter(path=>clipKindOf(path)!=='page').sort();
  for(const path of mediaPaths){
   const record=probes.get(path);
   if(record===undefined)refuse('NATIVE_SOURCE_MEDIA_ABSENT','A media file of the working copy was not probed');
   media[path]={duration:record.normalized.duration,audio:record.normalized.audio};
   const directory=posix.dirname(path);
   const name=posix.basename(path);
   const stem=name.slice(0,name.lastIndexOf('.'));
   const transcript=directory==='.'?`${stem}.vtt`:`${directory}/${stem}.vtt`;
   textFiles[transcript]=await this.#textOrProvedAbsence(closure,files,transcript);
   // The directory of the media: its real order, and the translations beside it.
   const listing=await this.#directoryListing(closure,directory);
   directories[directory]=listing;
   for(const entry of listing){
    if(!entry.startsWith(stem+'.'))continue;
    const match=/^\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.vtt$/.exec(entry.slice(stem.length));
    if(!match)continue;
    const translation=directory==='.'?`${stem}.${match[1]}.vtt`:`${directory}/${stem}.${match[1]}.vtt`;
    textFiles[translation]=await this.#textOrProvedAbsence(closure,files,translation);
   }
  }
  return {upstream_sha:NATIVE_SIDECARS_UPSTREAM,files:textFiles,directories,media};
 }

 /** The text of a file, or a proved absence of it. */
 async #textOrProvedAbsence(closure:RetainedNativeClosure,files:Map<string,RetainedNativeFile>,path:string):Promise<string|null>{
  const file=files.get(path);
  if(file!==undefined)return closure.readText(file);
  await closure.retainAbsent(path);
  return null;
 }

 /** The real order of a directory of the working copy.
  *
  * The listing is the retained one: the order the platform returned, the empty
  * directory as an empty list, and a failure of the listing is a failure of the read.
  * The root of the working copy is listed as the empty relative path. */
 async #directoryListing(closure:RetainedNativeClosure,directory:string):Promise<readonly string[]>{
  const relative=directory==='.'?'':directory;
  try{
   const retained=await closure.retainDirectory(relative);
   return retained.names;
  }catch(error){
   const code=String((error as {code?:unknown}).code);
   if(code!=='NATIVE_CLOSURE_NOT_FOUND')throw error;
   // The directory of a media file that the reader holds cannot be missing: the
   // media file is in it.
   refuse('NATIVE_SOURCE_DIRECTORY_ABSENT','A directory of the working copy is not there');
  }
 }

 /** Classify every derived item of the working copy.
  *
  * An item is accepted only when the upstream rule that produced it is proved for it:
  * the native project id, the native gitignore, a native sidecar that the committed
  * source also holds, or a cache entry whose producer, key and pairing are the
  * upstream's own. Everything else is refused with its own reason — never ignored,
  * never deleted, and never replaced by a rebuild. */
 async #classifyDerived(derived:readonly string[],files:Map<string,RetainedNativeFile>,closure:RetainedNativeClosure,
  facts:VerifiedNativeFacts,baseline:{readonly native_project_id:string;readonly workspace_ref:string;readonly instance_generation:number}):Promise<void>{
  const sourceEntries=new Set(facts.source_entries.map(entry=>entry.relative_path));
  const mediaKeys=new Map<string,string>();
  for(const [path,file] of files){
   if(clipKindOf(path)===null)continue;
   mediaKeys.set(upstreamMediaKey(path,file.bytes,file.mtime_ms),path);
  }
  for(const path of derived){
   const file=files.get(path);
   if(file===undefined)refuse('NATIVE_SOURCE_UNKNOWN_ITEM','The working copy holds an item the reader did not retain');
   if(/\.[0-9a-f]{12}\.tmp$/.test(path))refuse('NATIVE_SOURCE_CHANGING','A file of the working copy is still being written');
   if(path==='.film/id'){
    const text=await closure.readText(file);
    const id=text.trim();
    if(!/^[\w-]{6,40}$/.test(id))refuse('NATIVE_SOURCE_NATIVE_ID_INVALID','The native project id is not in the native format');
    if(baseline.native_project_id!==null&&id!==baseline.native_project_id)
     refuse('NATIVE_SOURCE_NATIVE_ID_MISMATCH','The native project id is not the one the Host issued');
    continue;
   }
   if(path==='.film/.gitignore'){
    const text=await closure.readText(file);
    if(text!=='*\n')refuse('NATIVE_SOURCE_GITIGNORE_INVALID','The native gitignore is not the one the native writes');
    continue;
   }
   if(path==='.film/settings.json'||path==='.film/markers.json'||path==='.film/subtitles.json'||/\.vtt$/.test(path)){
    // A sidecar the committed source does not hold is a native edit, not a cache: it
    // is not proved, so it is refused rather than read.
    if(!sourceEntries.has(path))refuse('NATIVE_SOURCE_SIDECAR_UNPROVEN','The working copy holds a sidecar the committed source does not');
    continue;
   }
   if(path.startsWith('.film/cache/')){
    await this.#classifyCache(path,files,closure,mediaKeys,baseline);
    continue;
   }
   refuse('NATIVE_SOURCE_UNKNOWN_ITEM','The working copy holds an item the native does not produce');
  }
 }

 /** Classify one cache entry of the working copy.
  *
  * The probe cache is never authority: it is compared with the reader's own probe of
  * the same bytes, field by field. Every other cache entry is accepted only when the
  * upstream's own key and pairing prove which producer made it. */
 async #classifyCache(path:string,files:Map<string,RetainedNativeFile>,closure:RetainedNativeClosure,
  mediaKeys:Map<string,string>,baseline:{readonly workspace_ref:string;readonly instance_generation:number}):Promise<void>{
  const relative=path.slice('.film/cache/'.length);
  const file=files.get(path);
  if(file===undefined)refuse('NATIVE_SOURCE_CACHE_UNKNOWN','The working copy holds a cache entry the reader did not retain');
  const probe=relative.match(/^probe\/([0-9a-f]{20})\.3\.json$/);
  if(probe){
   const media=mediaKeys.get(probe[1]!);
   if(media===undefined)refuse('NATIVE_SOURCE_CACHE_UNBOUND','A probe cache entry is not bound to a media file of this project');
   const text=await closure.readText(file);
   let cached:unknown;
   try{cached=JSON.parse(text);}catch{refuse('NATIVE_SOURCE_CACHE_MALFORMED','A probe cache entry is not JSON');}
   const record=cached&&typeof cached==='object'?cached as Record<string,unknown>:null;
   if(record===null)refuse('NATIVE_SOURCE_CACHE_MALFORMED','A probe cache entry is not an object');
   // The cached answer must be the same as an independent probe of the same bytes.
   const duration=typeof record.duration==='number'?record.duration:null;
   const width=typeof record.width==='number'?record.width:null;
   const height=typeof record.height==='number'?record.height:null;
   const fps=typeof record.fps==='number'?record.fps:null;
   const audio=record.audio===true;
   const codec=typeof record.codec==='string'?record.codec:null;
   const pixfmt=typeof record.pixfmt==='string'?record.pixfmt:null;
   const probeFile=files.get(media);
   if(probeFile===undefined)refuse('NATIVE_SOURCE_CACHE_UNBOUND','A probe cache entry is not bound to a retained media file');
   const version=await this.#version();
   const independent=await this.#probe(closure,probeFile,media,version);
   const expected=independent.normalized;
   if(duration!==expected.duration||width!==expected.width||height!==expected.height
    ||fps!==expected.fps||audio!==expected.audio||codec!==expected.codec||pixfmt!==expected.pixfmt)
    refuse('NATIVE_SOURCE_CACHE_FORGED','A probe cache entry does not match an independent probe of the same bytes');
   return;
  }
  const poster=relative.match(/^posters\/([0-9a-f]{20})\.jpg$/);
  if(poster){
   if(!mediaKeys.has(poster[1]!))refuse('NATIVE_SOURCE_CACHE_UNBOUND','A poster cache entry is not bound to a media file of this project');
   return;
  }
  const frame=relative.match(/^frames\/([0-9a-f]{20})-(\d+)-(\d+)\.jpg$/);
  if(frame){
   if(!mediaKeys.has(frame[1]!))refuse('NATIVE_SOURCE_CACHE_UNBOUND','A frame cache entry is not bound to a media file of this project');
   const width=Number(frame[3]);
   if(!Number.isInteger(width)||width<32||width>640||width%2!==0)refuse('NATIVE_SOURCE_CACHE_MALFORMED','A frame cache entry has a width the native does not draw');
   return;
  }
  const wave=relative.match(/^waves\/([0-9a-f]{20})\.json$/);
  if(wave){
   if(!mediaKeys.has(wave[1]!))refuse('NATIVE_SOURCE_CACHE_UNBOUND','A wave cache entry is not bound to a media file of this project');
   const text=await closure.readText(file);
   let cached:unknown;
   try{cached=JSON.parse(text);}catch{refuse('NATIVE_SOURCE_CACHE_MALFORMED','A wave cache entry is not JSON');}
   if(!cached||typeof cached!=='object')refuse('NATIVE_SOURCE_CACHE_MALFORMED','A wave cache entry is not an object');
   return;
  }
  if(relative==='film-duration.json'){
   const text=await closure.readText(file);
   let cached:unknown;
   try{cached=JSON.parse(text);}catch{refuse('NATIVE_SOURCE_CACHE_MALFORMED','The film duration cache entry is not JSON');}
   const record=cached&&typeof cached==='object'?cached as {film?:unknown;duration?:unknown}:null;
   const film=files.get('film.html');
   if(record===null||film===undefined)refuse('NATIVE_SOURCE_CACHE_MALFORMED','The film duration cache entry is not an object');
   // The duration is a duration only when a WITNESSED draw really produced it. The
   // ledger's current authorisation of this very output is asked for, and the WHOLE
   // identity of the file the witness saw is compared with the file that is there:
   // the same digest, the same size, the same device, the same inode, the same
   // nanosecond change times and the same number of names. A file that was replaced
   // by an equal copy, and a file that was changed and written back, are refused.
   const witness=this.#workspaces.cacheWitnessByOutput(baseline.workspace_ref,baseline.instance_generation,
    '.film/cache/film-duration.json');
   if(witness===null)refuse('NATIVE_SOURCE_CACHE_UNWITNESSED','The film duration cache entry was not produced by the fixed producer');
   const output=witness.outputs.find(entry=>entry.path==='.film/cache/film-duration.json');
   if(output===undefined||!sameFileIdentity(file,output))
    refuse('NATIVE_SOURCE_CACHE_FORGED','The film duration cache entry is not the output the witness is about');
   if(record.film!==`${film.mtime_ms}:${film.bytes}`)refuse('NATIVE_SOURCE_CACHE_STALE','The film duration cache entry is not about this film');
   if(typeof record.duration!=='number'||!Number.isFinite(record.duration))refuse('NATIVE_SOURCE_CACHE_MALFORMED','The film duration cache entry has no usable duration');
   return;
  }
  if(relative==='film-poster.jpg'){
   // The poster keeps the native's LAST semantics: it is a retained, non-authority
   // cache. It is allowed only as the exactly paired witnessed derived image, and
   // it never says that the current film was rendered.
   await this.#proveWitnessedCache('film-poster',files,baseline,'film-poster');
   return;
  }
  const pageFrame=relative.match(/^pageframes\/([0-9a-f]{24})\.(jpg|json|stamp)$/);
  if(pageFrame){
   // The entry is accepted ONLY when the FIXED producer really drew it and its
   // witness says so. A triple that is merely self-consistent - a fabricated key
   // and a computed stamp - proves nothing about its origin and is refused.
   await this.#proveWitnessedCache(pageFrame[1]!,files,baseline,'pageframe');
   return;
  }
  refuse('NATIVE_SOURCE_CACHE_UNKNOWN','The working copy holds a cache entry of an unknown kind');
 }
 /** The witness of one native cache entry.
  *
  * The witness must exist for THIS workspace instance and generation, it must name
  * the very picture that is there, and every file it lists as a dependency must be
  * a retained file of this working copy with the VERY IDENTITY the witness saw.
  *
  * The identity is the whole one: the digest, the size, the device, the inode, the
  * nanosecond change times and the number of names. A digest alone is not enough:
  * a file that was replaced by an equal copy has the same bytes and a different
  * inode, and a file that was changed and restored has the same bytes and a
  * different change time of its inode. A cache file that is merely self-consistent
  * - a fabricated key with a computed stamp - proves nothing about its origin, and
  * it is refused.
  *
  * The FILM POSTER is the paired output of one draw of the film's own page, and
  * that draw wrote the page frame's triple as well. So the poster's witness may
  * stand for that triple - but only for the very frame the poster was drawn of,
  * and only when no direct witness of that frame exists. */
 async #proveWitnessedCache(key:string,files:Map<string,RetainedNativeFile>,
  baseline:{readonly workspace_ref:string;readonly instance_generation:number},kind:'pageframe'|'film-poster'):Promise<void>{
  // The witness of THIS frame. A direct one is always the answer, and it is never
  // replaced by another one.
  let witness=this.#workspaces.cacheWitness(baseline.workspace_ref,baseline.instance_generation,key);
  let pairedWithPoster=false;
  if(witness===null&&kind==='pageframe'){
   // The FILM POSTER is the paired output of the very draw of the film's own page,
   // and that draw wrote THIS triple as well - the upstream writes the triple of
   // every draw. So the poster's witness may be the witness of this frame - but
   // only when it is about this very frame.
   const poster=this.#workspaces.cacheWitness(baseline.workspace_ref,baseline.instance_generation,'film-poster');
   if(poster!==null&&poster.kind==='film-poster'&&poster.frame_key===key){witness=poster;pairedWithPoster=true;}
  }
  if(witness===null)refuse('NATIVE_SOURCE_CACHE_UNWITNESSED','The native cache entry was not produced by the fixed producer');
  if(witness.kind!==kind&&!pairedWithPoster)refuse('NATIVE_SOURCE_CACHE_UNWITNESSED','The native cache entry is not the one the witness is about');
  const picturePath=kind==='film-poster'?'.film/cache/film-poster.jpg':`.film/cache/pageframes/${witness.frame_key}.jpg`;
  const picture=files.get(picturePath);
  if(picture===undefined)refuse('NATIVE_SOURCE_CACHE_UNWITNESSED','The native cache entry has no picture that was retained');
  // The picture must be the very file the producer wrote: the whole identity.
  const pictureOutput=witness.outputs.find(entry=>entry.path===picturePath);
  if(pictureOutput===undefined||!sameFileIdentity(picture,pictureOutput))
   refuse('NATIVE_SOURCE_CACHE_FORGED','The native cache entry is not the picture the witness is about');
  if(kind==='film-poster'){
   // The poster is the LAST poster the native kept: it is the paired output of the
   // very draw the witness speaks about, and it never says that the film was
   // rendered now.
   if(witness.poster_sha256===null||picture.sha256!==witness.poster_sha256)refuse('NATIVE_SOURCE_CACHE_FORGED','The native cache entry is not the picture the witness is about');
  }else if(picture.sha256!==witness.jpeg_sha256)
   refuse('NATIVE_SOURCE_CACHE_FORGED','The native cache entry is not the picture the witness is about');
  const depsPath=`.film/cache/pageframes/${witness.frame_key}.json`;
  const stampPath=`.film/cache/pageframes/${witness.frame_key}.stamp`;
  const deps=files.get(depsPath);
  const stamp=files.get(stampPath);
  if(deps===undefined||stamp===undefined)refuse('NATIVE_SOURCE_CACHE_UNWITNESSED','The native cache entry has no dependency list or stamp');
  if(deps.sha256!==witness.deps_sha256||stamp.sha256!==witness.stamp_sha256)refuse('NATIVE_SOURCE_CACHE_FORGED','The native cache entry is not the one the witness is about');
  // The dependency list and the stamp must be the very files the producer wrote.
  for(const [path,file] of [[depsPath,deps],[stampPath,stamp]] as const){
   const output=witness.outputs.find(entry=>entry.path===path);
   if(output===undefined||!sameFileIdentity(file,output))refuse('NATIVE_SOURCE_CACHE_FORGED','The native cache entry is not the one the witness is about');
  }
  // Every dependency the producer read must be a retained file of this copy, with
  // the very identity the witness saw.
  for(const dependency of witness.dependencies){
   const retained=files.get(dependency.path);
   if(retained===undefined)refuse('NATIVE_SOURCE_CACHE_UNPROVEN','A file the native cache entry depends on is not retained');
   if(!sameFileIdentity(retained,dependency))
    refuse('NATIVE_SOURCE_CACHE_STALE','A file the native cache entry depends on changed since it was produced');
  }
 }
}
