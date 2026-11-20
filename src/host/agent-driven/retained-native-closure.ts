import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readdirSync,readSync,realpathSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';

/** A private, bounded budget. It is a protection with a failure meaning, never a
 *  silent downgrade: an overflow is a refusal, not a truncated success. */
export interface RetainedNativeBudget {
  /** How many paths one closure may hold. */
  readonly maxPaths:number;
  /** How many bytes one text file may have. */
  readonly maxTextBytes:number;
  /** How many text bytes one closure may read in total. */
  readonly maxTotalTextBytes:number;
  /** How deep the retained tree may be. */
  readonly maxDepth:number;
  /** How many descriptors one closure may hold at once. */
  readonly maxDescriptors:number;
}

export const RETAINED_NATIVE_BUDGET:RetainedNativeBudget=Object.freeze({
 maxPaths:4096,maxTextBytes:8*1024*1024,maxTotalTextBytes:64*1024*1024,maxDepth:12,maxDescriptors:8192,
});

/** The extensions of the files that are MEDIA: a picture, a sound, a video.
 *
 * A media file is hashed in a bounded stream and is never read as text; every other
 * file is TEXT for the budget. An extension nobody knows is therefore never let
 * through as a large text: it is refused by the text budget like any other text.
 *
 * The set is the one the committed digest uses (the `source-digest-v1` set: a
 * divergence would make the recomputed digest differ from the committed one), and
 * the authority reads the set from HERE, so that the Host has ONE definition of
 * "media" and the digest and the budget cannot drift apart. */
export const RETAINED_NATIVE_ASSET_EXTENSIONS:ReadonlySet<string>=Object.freeze(new Set<string>([
 'wav','mp3','m4a','aac','ogg','oga','opus','flac','aif','aiff','weba',
 'mp4','m4v','mov','webm','mkv','avi','ogv',
 'png','jpg','jpeg','webp','gif',
]));
/** The extension of a path, as the digest's own rule names it. */
const extensionOf=(path:string):string=>{
 const base=path.slice(path.lastIndexOf('/')+1);
 const dot=base.lastIndexOf('.');
 return dot<=0?'':base.slice(dot+1).toLowerCase();
};
/** Whether this file is media: hashed in a bounded stream, never read as text. */
export const isRetainedNativeAsset=(relativePath:string):boolean=>
 RETAINED_NATIVE_ASSET_EXTENSIONS.has(extensionOf(relativePath));

/** The descriptor budget of ONE Host instance.
 *
 * It counts every allocation that instance owns: the roots, the ancestries, the
 * temporary directories of the walks and every retained directory and file — of the
 * source tree, of the working copy and of the parallel proofs of that instance. A
 * reservation is taken BEFORE the open and given back only when the release really
 * closed the descriptor: an UNCERTAIN release does NOT return the capacity, because
 * the descriptor may still be open, and a quota reported as reclaimed while a
 * descriptor is open is a false report.
 *
 * It is an EXPLICIT instance and never a module-global singleton: the Host that
 * owns the two trees of one acquisition owns the pool they share. It carries a
 * brand, so a lookalike object is refused rather than counted. */
export interface RetainedDescriptorPool{
 /** How many descriptors the instance may hold at once. */
 readonly limit:number;
 /** How many descriptors the instance holds right now. */
 readonly used:number;
 /** How many of the releases were not certain. */
 readonly uncertain:number;
 /** Take one descriptor. It happens BEFORE the open. It is false when the pool is
  *  full, and then no descriptor exists. */
 reserve():boolean;
 /** Give one descriptor back. An uncertain release keeps its capacity. */
 release(certain:boolean):void;
}
const poolBrands=new WeakSet<object>();
/** The instance-wide descriptor budget.
 *
 * A reservation is taken before the open and given back on a certain release; an
 * uncertain release keeps its capacity, because the descriptor may still be open. */
export class RetainedDescriptorBudget implements RetainedDescriptorPool{
 #used=0;
 #uncertain=0;
 constructor(readonly limit:number){poolBrands.add(this);}
 get used():number{return this.#used;}
 get uncertain():number{return this.#uncertain;}
 /** Take one descriptor. It happens BEFORE the open, so the refusal is before the
  *  descriptor exists. */
 reserve():boolean{
  if(this.#used+1>this.limit)return false;
  this.#used+=1;return true;
 }
 /** Give one descriptor back. An uncertain release keeps its capacity. */
 release(certain:boolean):void{
  if(certain){this.#used=Math.max(0,this.#used-1);return;}
  this.#uncertain+=1;
 }
}
/** Whether this object is a pool this module issued. A lookalike is not. */
export function isRetainedDescriptorPool(value:unknown):value is RetainedDescriptorPool{
 return typeof value==='object'&&value!==null&&poolBrands.has(value);
}

/** The failure of a retained closure. The code is the message; no absolute path
 *  and no credential is ever disclosed. */
export class RetainedNativeError extends Error {
 constructor(readonly code:string,message:string){super(message);this.name='RetainedNativeError';}
}

/** Attach cleanup causes to a failure without making them public. */
function attachCauses(error:unknown,causes:readonly unknown[]):boolean{
 if(typeof error!=='object'||error===null)return false;
 try{
  // The causes are MERGED: a later cleanup does not erase the ones before it.
  const existing=(error as {cleanup_errors?:unknown[]}).cleanup_errors;
  const merged=Array.isArray(existing)?[...existing,...causes.filter(cause=>!existing.includes(cause))]:[...causes];
  Object.defineProperty(error,'cleanup_errors',{value:merged,enumerable:false,writable:false,configurable:true});return true;
 }catch{return false;}
}

function fail(code:string,message:string,causes?:readonly unknown[]):never{
 const error=new RetainedNativeError(code,message);
 if(causes&&causes.length>0)attachCauses(error,causes);
 throw error;
}
/** The GENUINE release failures of one failure.
 *
 * A failure that merely CARRIES an ordinary cause is not uncertain: `failOpen` puts
 * the original syscall error into the very same `cleanup_errors` list, so the
 * presence of a cause says nothing about a release. Only a release that really
 * failed is uncertainty.
 *
 * The ledger is private and keyed by the failure's own identity, so no JSON, no
 * file and no lookalike can register a cleanup failure. */
const cleanupLedger=new WeakMap<object,readonly unknown[]>();
/** The genuine release failures of a failure, or an empty list. */
export function retainedCleanupFailures(error:unknown):readonly unknown[]{
 if(typeof error!=='object'||error===null)return [];
 return cleanupLedger.get(error)??[];
}
/** Record that these failures are genuine release failures of this failure. */
export function markRetainedCleanupFailures(error:unknown,causes:readonly unknown[]):void{
 if(typeof error!=='object'||error===null)return;
 cleanupLedger.set(error,[...(cleanupLedger.get(error)??[]),...causes]);
}
/** Merge the cleanup causes into a failure and keep the failure in place.
 *
 * The primary failure is never replaced by the cleanup that followed it: the causes
 * are attached to it and the causes that were already there are kept. Only a failure
 * that cannot carry them at all changes - and then nothing is lost either: the
 * primary becomes the first of the causes and the refusal states that the release
 * did not finish. */
export function mergeRetainedCleanupCauses(error:unknown,causes:readonly unknown[]):unknown{
 if(causes.length===0)return error;
 if(attachCauses(error,causes)){markRetainedCleanupFailures(error,causes);return error;}
 // The failure cannot carry the causes: nothing is lost - the primary becomes the
 // first of the causes, and the refusal that is thrown carries them as genuine.
 const refusal=new RetainedNativeError('NATIVE_CLOSURE_CLEANUP_FAILED','The retained tree could not release everything');
 attachCauses(refusal,[error,...causes]);
 markRetainedCleanupFailures(refusal,causes);
 throw refusal;
}
/** A refusal of an open that keeps the budget's own code.
 *
 * The budget is this closure's own protection: its refusal is not a symptom of an
 * unsupported type, of a moved membership or of an ancestor that is not a directory,
 * so it must never be relabelled as one. Every other failure keeps the syscall that
 * stopped the open as its cause. */
function failOpen(code:string,message:string,error:unknown):never{
 if((error as {code?:string}|null)?.code==='NATIVE_CLOSURE_BUDGET')throw error;
 fail(code,message,[error]);
}
/**
 * The milliseconds the platform's `stat` reports.
 *
 * The platform computes them as `seconds * 1000 + nanoseconds / 1e6` - NOT as the
 * nanoseconds divided by a million. The two differ in the last bit of the double
 * for about a third of all files, and the upstream's own stamp is a digest of that
 * very text: a stamp reproduced with the other formula would never match, and a
 * production that was real would be refused as a race.
 *
 * The remainder is normalised the way a timespec is: a moment before the epoch
 * keeps its sign in the seconds and a remainder that is not negative. */
function platformMilliseconds(ns:bigint):number{
 let seconds=ns/1000000000n;
 let remainder=ns%1000000000n;
 if(remainder<0n){remainder+=1000000000n;seconds-=1n;}
 return Number(seconds)*1000+Number(remainder)/1e6;
}
const directoryFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
const fileFlags=constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW;
const HASH_BUFFER=64*1024;
/** How many ancestors above the root are retained. */
const MAX_ANCESTORS=8;

/** One retained file, as the facts of it. The object itself carries no authority:
 *  the closure holds the descriptor and recognises the exact object it issued. */
export interface RetainedNativeFile {
 readonly relative_path:string;
 readonly bytes:number;
 /** The change time of the CONTENT, in milliseconds.
  *
  * It exists ONLY to reproduce the pinned upstream's own stamp, which is computed
  * from `stat.mtimeMs`. It is NOT the Host's identity: a millisecond double cannot
  * tell two changes of the same file apart. The identity is the nanosecond pair
  * below. */
 readonly mtime_ms:number;
 readonly sha256:string;
 /** The device the file was on, as decimal text. It is part of the ledger identity. */
 readonly dev:string;
 /** The inode the file had, as decimal text. It is part of the ledger identity. */
 readonly ino:string;
 /** How many names the file has. A regular file with more than one is an alias to
  *  another file and is not a file of this tree. */
 readonly nlink:string;
 /** When the INODE itself changed, as decimal text.
  *
  * It moves when the file's content changed, even when the content was restored
  * afterwards: a file that was written and written back has the same bytes and the
  * same change time of its content, but a new change time of its inode. */
 readonly ctime_ms:number;
 /** When the content changed, in NANOSECONDS, as decimal text.
  *
  * The Host's own identity of the file: the millisecond value above is the
  * upstream's stamp, this one is the truth. */
 readonly mtime_ns:string;
 /** When the inode itself changed, in NANOSECONDS, as decimal text. */
 readonly ctime_ns:string;
}

/** One retained directory, in the order the platform really returned its names. */
export interface RetainedNativeDirectory {
 readonly relative_path:string;
 readonly names:readonly string[];
 /** The device the directory was on, as decimal text. It is part of the identity. */
 readonly dev:string;
 /** The inode the directory had, as decimal text. It is part of the identity. */
 readonly ino:string;
}

/** One proved absence: the nearest directory that does exist and the tail that does not. */
export interface RetainedNativeAbsent {
 readonly relative_path:string;
 readonly nearest_existing_parent:string|null;
}

interface Membership {
 readonly path:string;
 readonly isDirectory:boolean;
 readonly dev:bigint;
 readonly ino:bigint;
 readonly size:bigint;
 readonly mtimeNs:bigint;
 readonly ctimeNs:bigint;
 /** How many names the path had. For a regular file more than one is an alias. */
 readonly nlink:bigint;
}

/** One owned descriptor.
 *
 * The ownership is the *allocation*, not the number: a number the operating system
 * hands out again after a descriptor is closed belongs to a new allocation and must
 * never be confused with the old one. */
interface OwnedDescriptor {
 readonly fd:number;
 /** The NAME of this allocation. The number above is recycled by the platform; this
  *  is not. */
 readonly allocation:RetainedNativeAllocation;
 released:boolean;
}
interface FileRecord {
 readonly descriptor:OwnedDescriptor;
 readonly membership:Membership;
 sha256:string;
 bytes:number;
}
interface DirectoryRecord {
 readonly descriptor:OwnedDescriptor;
 readonly membership:Membership;
 readonly names:readonly string[];
}
interface AbsentRecord {
 readonly relative_path:string;
 readonly parent:string|null;
 readonly tail:readonly string[];
 readonly parentDev:bigint|null;
 readonly parentIno:bigint|null;
 readonly parentDescriptor:OwnedDescriptor|undefined;
}
interface AncestorRecord {
 readonly descriptor:OwnedDescriptor;
 readonly path:string;
 readonly dev:bigint;
 readonly ino:bigint;
}

/** The Host-private descriptor operations of one closure.
 *
 * Only the close and the read observation can be replaced, and only to make a release
 * fail or to observe a reentrant release in a test: neither can make a fact true that
 * is not. The production path uses the platform close. */
/** The identity of ONE allocation of a retained tree.
 *
 * It is a NAME, not the number of a descriptor: the platform hands a descriptor
 * number out again after it is closed, and a recycled number says nothing about which
 * allocation it was. The name is the namespace of the tree, the monotonic id inside
 * that tree, the phase the production gave the tree, and the path the descriptor was
 * opened for.
 *
 * The phase is set by the PRODUCTION that opens the tree, not by the caller of the
 * production: a caller may not say which phase it is in. */
export interface RetainedNativeAllocation{
 /** The namespace of the tree this allocation belongs to. */
 readonly namespace:string;
 /** The monotonic id of this allocation inside its tree. */
 readonly id:number;
 /** The phase the production gave this tree. */
 readonly phase:string;
 /** The path the descriptor was opened for. */
 readonly path:string;
}

export interface RetainedNativeDescriptorOps {
 /**
  * The release of ONE allocation.
  *
  * The allocation is handed over as well, so that a case can tell the allocations
  * apart by their NAME and not by their descriptor number. It is optional: a caller
  * that does not care about it keeps the old shape and the old behaviour.
  */
 readonly close?:(fd:number,allocation?:RetainedNativeAllocation)=>void;
 /**
  * A Host-private observation at the start of a read of a retained file.
  *
  * It runs *synchronously inside* the accepted operation, so a release asked for from
  * it finds the operation outstanding. It can never state a fact about the file.
  */
 readonly onRead?:(relativePath:string)=>void;
 /**
  * The number of bytes a read actually moved.
  *
  * It observes EVERY read the closure makes: the text read, the digests (the first
  * hash of a retained file, a re-hash, the hashes of the synchronous guards) and
  * the extra byte that proves a file did not grow. It is how a case proves that a
  * text above the budget was refused *before* its bytes were read, rather than read
  * and then refused - and how it attributes those bytes to the very file they came
  * from.
  */
 readonly onReadChunk?:(relativePath:string,bytes:number)=>void;
 /**
  * Replace the opening of a descriptor.
  *
  * The replacement must open a real descriptor or fail like the platform does. It
  * exists so that the N-th open can be made to fail deterministically; it can never
  * make the closure hold something it did not open.
  */
 readonly open?:(path:string,flags:number,allocation?:RetainedNativeAllocation)=>number;
 /**
  * The phase the production gives this tree.
  *
  * The production sets it when it opens the tree; a caller of the production never
  * states it, and a tree opened without one is simply an unnamed phase.
  */
 readonly phase?:string;
}

const isSafeRelative=(value:string):boolean=>
 typeof value==='string'&&value.length>0&&value.length<=4096&&!value.includes('\\')&&!value.includes('\0')
 &&!value.startsWith('/')&&!value.includes(':')&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
const fdPath=(fd:number)=>'/proc/self/fd/'+fd;
const codeOf=(error:unknown):string=>String((error as {code?:unknown}).code);
/** The counter of the allocation namespaces this module has handed out. */
let allocationNamespace=0;

/** The retained closure of one tree.
 *
 * It holds the real descriptors of the files and directories it was asked to keep, the
 * parent chain that anchors them to the root, the ancestry above the root, and the
 * *whole* membership of the tree as it was when the closure was opened. Nothing here is
 * a structural capability: the closure recognises the objects it issued and refuses a
 * copy of one.
 *
 * One owner per allocation: every descriptor the closure opens is owned by exactly one
 * record, is closed at most once, and is never retried.
 */
export class RetainedNativeClosure {
 readonly #root:string;
 readonly #rootDescriptor:OwnedDescriptor;
 readonly #rootMembership:Membership;
 readonly #budget:RetainedNativeBudget;
 readonly #close:(fd:number,allocation?:RetainedNativeAllocation)=>void;
 /** The Host-private observation of a read, inside the accepted operation. */
 readonly #onRead:((relativePath:string)=>void)|undefined;
 /** The Host-private count of the bytes a read moved. */
 readonly #onReadChunk:((relativePath:string,bytes:number)=>void)|undefined;
 /** The Host-private replacement of the opening of a descriptor. */
 readonly #open:((path:string,flags:number,allocation?:RetainedNativeAllocation)=>number)|undefined;
 /** The namespace of this tree: every allocation of this tree is named inside it. */
 readonly #namespace:string;
 /** The phase the production gave this tree. */
 readonly #phase:string;
 /** The monotonic id of the next allocation of this tree. The root took id 1. */
 #allocationId=1;
 readonly #files=new Map<string,FileRecord>();
 readonly #issuedFiles=new WeakMap<object,FileRecord>();
 readonly #directories=new Map<string,DirectoryRecord>();
 readonly #issuedDirectories=new WeakMap<object,DirectoryRecord>();
 readonly #absents=new Map<string,AbsentRecord>();
 readonly #issuedAbsents=new WeakMap<object,AbsentRecord>();
 readonly #membership=new Map<string,Membership>();
 readonly #ancestors:AncestorRecord[]=[];
 readonly #pending=new Set<Promise<unknown>>();
 /** The bytes each retained file took from the text budget, counted once each.
  *
  * The charge is taken when the file's first data is read - before that read - and
  * it is taken ONCE: a file that is retained again, or read again, is never charged
  * twice. A retain that did not keep the file gives its charge back; a closure that
  * is closed keeps its record (an uncertain close latches the uncertainty, it does
  * not pretend the closure holds nothing). */
 readonly #textBytesByFile=new Map<string,number>();
 #closed=false;
 #uncertain=false;
 /** Every close failure this closure saw, temporary allocations included. */
 readonly #cleanupFailures:unknown[]=[];
 /** The descriptors this closure holds. It is bounded by the budget, not by the file
  *  count: a tree of many files shares one descriptor per directory. */
 #descriptors=0;
 /** The instance-wide pool this closure draws from, when it has one. */
 readonly #pool:RetainedDescriptorPool|undefined;
 /** How many reservations this closure holds from the pool. */
 #poolHeld=0;

 private constructor(root:string,rootDescriptor:OwnedDescriptor,rootMembership:Membership,budget:RetainedNativeBudget,close:(fd:number,allocation?:RetainedNativeAllocation)=>void,onRead:((relativePath:string)=>void)|undefined,onReadChunk:((relativePath:string,bytes:number)=>void)|undefined,open:((path:string,flags:number,allocation?:RetainedNativeAllocation)=>number)|undefined,pool:RetainedDescriptorPool|undefined,namespace:string,phase:string){
  this.#root=root;this.#rootDescriptor=rootDescriptor;this.#rootMembership=rootMembership;this.#budget=budget;this.#close=close;this.#onRead=onRead;this.#onReadChunk=onReadChunk;this.#open=open;this.#pool=pool;this.#namespace=namespace;this.#phase=phase;
 }

 /** Open a tree and take its whole membership.
  *
  * The root must be a real directory, not a symlink and not an alias of another path.
  * Every entry below it must be a regular file or a directory: a symlink, a FIFO, a
  * socket or a device is a refusal, never a skipped row.
  *
  * The pool is the instance-wide descriptor budget the closure draws from: it is
  * optional, and a lookalike is refused rather than counted. */
 static async open(root:string,budget:Partial<RetainedNativeBudget>={},ops:RetainedNativeDescriptorOps={},pool?:RetainedDescriptorPool):Promise<RetainedNativeClosure>{
  const limits:RetainedNativeBudget=Object.freeze({...RETAINED_NATIVE_BUDGET,...budget});
  if(pool!==undefined&&!isRetainedDescriptorPool(pool))fail('NATIVE_CLOSURE_CAPABILITY_INVALID','The descriptor pool is not one this Host issued');
  const close=ops.close??((fd:number)=>{closeSync(fd);});
  // The namespace of this tree and the phase the production gave it. The phase is
  // the production's own word: a caller of the production never states it.
  const namespace='retained-'+(allocationNamespace+=1);
  const phase=ops.phase??'';
  const path=resolve(root);
  // The identity of the root is taken before it is opened, so a failure between the
  // two cannot leak the descriptor that was opened for it.
  let info;
  try{info=lstatSync(path,{bigint:true});}
  catch(error){fail('NATIVE_CLOSURE_ROOT_INVALID','The retained root is not there',[error]);}
  if(!info.isDirectory()||info.isSymbolicLink()||realpathSync(path)!==path)fail('NATIVE_CLOSURE_ROOT_INVALID','The retained root is not a real directory');
  let rootFd:number;
  if(limits.maxDescriptors<1)fail('NATIVE_CLOSURE_BUDGET','The retained tree needs more descriptors than the budget allows');
  // The instance pool is reserved BEFORE the root is opened: the refusal happens
  // before the descriptor exists.
  if(pool!==undefined&&!pool.reserve())fail('NATIVE_CLOSURE_BUDGET','The retained tree needs more descriptors than the budget allows');
  const rootAllocation:RetainedNativeAllocation={namespace,id:1,phase,path};
  try{rootFd=ops.open?ops.open(path,directoryFlags,rootAllocation):openSync(path,directoryFlags);}
  catch(error){if(pool!==undefined)pool.release(true);fail('NATIVE_CLOSURE_ROOT_INVALID','The retained root could not be opened',[error]);}
  const rootDescriptor:OwnedDescriptor={fd:rootFd,allocation:rootAllocation,released:false};
  const closure=new RetainedNativeClosure(path,rootDescriptor,
   {path:'',isDirectory:true,dev:info.dev,ino:info.ino,size:info.size,mtimeNs:info.mtimeNs,ctimeNs:info.ctimeNs,nlink:info.nlink},limits,close,ops.onRead,ops.onReadChunk,ops.open,pool,namespace,phase);
  // The root is an allocation of this closure like every other one.
  closure.#descriptors+=1;
  if(pool!==undefined)closure.#poolHeld+=1;
  try{
   // The descriptor must be the directory the path names, not another one.
   const held=fstatSync(rootFd,{bigint:true});
   if(!held.isDirectory()||held.dev!==info.dev||held.ino!==info.ino)fail('NATIVE_CLOSURE_ROOT_INVALID','The retained root is not the directory it was opened as');
   closure.#retainAncestry(path);
   closure.#enumerate(rootDescriptor,path,'',0,limits);
  }catch(error){
   const failures=closure.#closeAll();
   if(failures.length>0){
    closure.#uncertain=true;
    // The primary keeps its place and carries the GENUINE release failures: the
    // owner of the acquisition can tell them apart from an ordinary cause.
    markRetainedCleanupFailures(error,failures);
    if(attachCauses(error,failures))throw error;
    const refusal=new RetainedNativeError('NATIVE_CLOSURE_CLEANUP_FAILED','The retained closure could not release everything');
    attachCauses(refusal,[error,...failures]);
    markRetainedCleanupFailures(refusal,failures);
    throw refusal;
   }
   throw error;
  }
  return closure;
 }

 /** Retain the ancestry above the root.
  *
  * The root's own inode is not enough: a root can be moved under a replaced parent and
  * keep its inode. Each ancestor is therefore opened and held, so the guard can see
  * that the chain above the root is still the one it was. An ancestor that cannot be
  * opened or held is a refusal: a partial ancestry proves nothing. */
 #retainAncestry(root:string):void{
  let current=dirname(root);
  for(let depth=0;depth<MAX_ANCESTORS&&current!==''&&current!==sep;depth+=1){
   const parent=dirname(current);
   if(parent===current)break;
   let opened:{readonly fd:number;readonly allocation:RetainedNativeAllocation};
   try{opened=this.#openDescriptor(current,directoryFlags);}
   catch(error){failOpen('NATIVE_CLOSURE_ANCESTOR_INVALID','An ancestor of the retained root could not be opened',error);}
   const fd=opened.fd;
   const descriptor:OwnedDescriptor={fd,allocation:opened.allocation,released:false};
   try{
    const held=fstatSync(fd,{bigint:true});
    if(!held.isDirectory())fail('NATIVE_CLOSURE_ANCESTOR_INVALID','An ancestor of the retained root is not a directory');
    this.#ancestors.push({descriptor,path:current,dev:held.dev,ino:held.ino});
   }catch(error){
    const failures:unknown[]=[];
    try{this.#closeOwned(descriptor);}catch(closeError){failures.push(closeError);}
    fail('NATIVE_CLOSURE_ANCESTOR_INVALID','An ancestor of the retained root could not be held',[error,...failures]);
   }
   current=parent;
  }
 }

 get root():string{return this.#root;}
 get closed():boolean{return this.#closed;}
 /** Sticky: while it holds, this closure cannot say that everything it took is released. */
 get uncertain():boolean{return this.#uncertain;}
 /** Every close failure this closure saw, temporary allocations included. */
 get cleanupFailures():readonly unknown[]{return [...this.#cleanupFailures];}

 /** Every path of the tree, files and directories alike, as it was when the closure was opened. */
 membership():readonly string[]{return [...this.#membership.keys()];}
 /** Only the files of the tree. A directory is evidence of its own, never a file. */
 fileMembership():readonly string[]{return [...this.#membership.values()].filter(entry=>!entry.isDirectory).map(entry=>entry.path);}
 /** Every directory of the tree, as it was when the closure was opened. */
 directories():readonly string[]{return [...this.#membership.values()].filter(entry=>entry.isDirectory).map(entry=>entry.path);}
 files():readonly RetainedNativeFile[]{return [...this.#files.values()].map(record=>this.#issuedFile(record));}
 retainedDirectories():readonly RetainedNativeDirectory[]{return [...this.#directories.values()].map(record=>this.#issuedDirectory(record));}
 negatives():readonly RetainedNativeAbsent[]{return [...this.#absents.values()].map(record=>this.#issuedAbsent(record));}

 #issuedFile(record:FileRecord):RetainedNativeFile{
  const issued=Object.freeze({relative_path:record.membership.path,bytes:record.bytes,
   // The very value the platform's `stat.mtimeMs` reports, computed the way the
   // platform computes it. A key derived from it must match the upstream's own key,
   // which is computed from `stat.mtimeMs`. It is the upstream's stamp, NOT the
   // Host's identity: the identity is the nanosecond pair below.
   mtime_ms:platformMilliseconds(record.membership.mtimeNs),sha256:record.sha256,
   dev:record.membership.dev.toString(),ino:record.membership.ino.toString(),
   nlink:record.membership.nlink.toString(),
   ctime_ms:platformMilliseconds(record.membership.ctimeNs),
   mtime_ns:record.membership.mtimeNs.toString(),ctime_ns:record.membership.ctimeNs.toString()});
  this.#issuedFiles.set(issued,record);return issued;
 }
 #issuedDirectory(record:DirectoryRecord):RetainedNativeDirectory{
  const issued=Object.freeze({relative_path:record.membership.path,names:Object.freeze([...record.names]),
   dev:record.membership.dev.toString(),ino:record.membership.ino.toString()});
  this.#issuedDirectories.set(issued,record);return issued;
 }
 #issuedAbsent(record:AbsentRecord):RetainedNativeAbsent{
  const issued=Object.freeze({relative_path:record.relative_path,nearest_existing_parent:record.parent});
  this.#issuedAbsents.set(issued,record);return issued;
 }

 /** Admit one asynchronous operation. A closure is never closed while an accepted
  *  operation can still use a descriptor it holds. */
 #admit<T>(operation:()=>Promise<T>):Promise<T>{
  if(this.#closed)return Promise.reject(new RetainedNativeError('NATIVE_CLOSURE_CLOSED','The retained closure is closed'));
  if(this.#uncertain)return Promise.reject(new RetainedNativeError('NATIVE_CLOSURE_UNCERTAIN','The retained closure cannot say what it holds'));
  // The accepted operation is registered BEFORE it is invoked.
  //
  // The body of an operation runs synchronously up to its first await, so a release
  // asked for from inside it must already find the operation outstanding. If the
  // registration came after the invocation, that release would find nothing pending
  // and would destroy the very descriptor the operation is about to use.
  let settle!:()=>void;
  const registration=new Promise<void>(resolve=>{settle=resolve;});
  this.#pending.add(registration);
  void registration.then(()=>this.#pending.delete(registration),()=>this.#pending.delete(registration));
  let result:Promise<T>;
  try{result=operation();}
  catch(error){settle();return Promise.reject(error);}
  void result.then(()=>settle(),()=>settle());
  return result;
 }
 /** Wait for every accepted operation to finish. */
 async drain():Promise<void>{while(this.#pending.size>0)await Promise.allSettled([...this.#pending]);}
 /** Whether an accepted operation is still outstanding. */
 get busy():boolean{return this.#pending.size>0;}

 /** Walk the tree and take its membership.
  *
  * A failure of the walk's own descriptor release is kept with the failure that
  * caused the walk to stop: the primary error stays the primary error, and the
  * cleanup failure is not swallowed. */
 #enumerate(rootDescriptor:OwnedDescriptor,absolute:string,relative:string,depth:number,limits:RetainedNativeBudget):void{
  if(depth>limits.maxDepth)fail('NATIVE_CLOSURE_BUDGET','The retained tree is deeper than the budget allows');
  let entries;
  try{entries=readdirSync(fdPath(rootDescriptor.fd),{withFileTypes:true});}
  catch(error){fail('NATIVE_CLOSURE_ROOT_INVALID','The retained tree could not be listed',[error]);}
  for(const entry of entries){
   const childAbsolute=absolute+sep+entry.name;
   const childRelative=relative===''?entry.name:relative+'/'+entry.name;
   if(this.#membership.size>=limits.maxPaths)fail('NATIVE_CLOSURE_BUDGET','The retained tree has more paths than the budget allows');
   let info;
   try{info=lstatSync(childAbsolute,{bigint:true});}
   catch(error){fail('NATIVE_CLOSURE_ROOT_INVALID','A retained path could not be examined',[error]);}
   if(info.isSymbolicLink())fail('NATIVE_CLOSURE_UNSUPPORTED_TYPE','A retained path is a symbolic link');
   if(info.isDirectory()){
    this.#membership.set(childRelative,MembershipOf(childAbsolute,childRelative,true));
    let opened:{readonly fd:number;readonly allocation:RetainedNativeAllocation};
    try{opened=this.#openDescriptor(childAbsolute,directoryFlags);}
    catch(error){failOpen('NATIVE_CLOSURE_UNSUPPORTED_TYPE','A retained directory could not be opened',error);}
    const child:OwnedDescriptor={fd:opened.fd,allocation:opened.allocation,released:false};
    try{this.#enumerate(child,childAbsolute,childRelative,depth+1,limits);}
    catch(error){
     // The primary error keeps its place: the failure of this child's own release
     // is MERGED into it, never a replacement of it, and the causes that were
     // already there are kept.
     const failures:unknown[]=[];
     try{this.#closeOwned(child);}catch(closeError){failures.push(closeError);}
     mergeRetainedCleanupCauses(error,failures);
     throw error;
    }
    try{this.#closeOwned(child);}
    catch(error){
     const refusal=new RetainedNativeError('NATIVE_CLOSURE_CLEANUP_FAILED','The retained tree could not be released');
     attachCauses(refusal,[error]);
     markRetainedCleanupFailures(refusal,[error]);
     throw refusal;
    }
    continue;
   }
   if(!info.isFile())fail('NATIVE_CLOSURE_UNSUPPORTED_TYPE','A retained path is not a regular file');
   this.#membership.set(childRelative,MembershipOf(childAbsolute,childRelative,false));
  }
 }

 /** The retained directory of a relative path.
  *
  * A directory is retained once and then reused: the descriptors a tree holds are
  * bounded by its paths, not by the number of files that live in it. */
 #directoryRecord(relativePath:string):DirectoryRecord{
  const existing=this.#directories.get(relativePath);
  if(existing!==undefined)return existing;
  if(relativePath===''){
   const names=readdirSync(fdPath(this.#rootDescriptor.fd),{withFileTypes:true}).map(entry=>entry.name);
   const record:DirectoryRecord={descriptor:this.#rootDescriptor,membership:this.#rootMembership,names:Object.freeze(names)};
   this.#directories.set('',record);
   return record;
  }
  const membership=this.#membership.get(relativePath);
  if(membership===undefined)fail('NATIVE_CLOSURE_NOT_FOUND','The retained directory is not a member of the tree');
  if(!membership.isDirectory)fail('NATIVE_CLOSURE_NOT_REGULAR','The retained path is not a directory');
  const parts=relativePath.split('/');
  const name=parts.pop()!;
  const parent=this.#directoryRecord(parts.join('/'));
  let opened:{readonly fd:number;readonly allocation:RetainedNativeAllocation};
  try{opened=this.#openDescriptor(fdPath(parent.descriptor.fd)+'/'+name,directoryFlags);}
  catch(error){
   // The budget refusal is this closure's own refusal and keeps its own code: it is
   // not a symptom of an unsupported type. Any other failure keeps the syscall that
   // stopped the open, so the cause is never swallowed.
   failOpen('NATIVE_CLOSURE_UNSUPPORTED_TYPE','A retained directory could not be opened',error);
  }
  const fd=opened.fd;
  const descriptor:OwnedDescriptor={fd,allocation:opened.allocation,released:false};
  try{
   const info=fstatSync(fd,{bigint:true});
   if(!info.isDirectory()||info.dev!==membership.dev||info.ino!==membership.ino)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained directory is not the directory the closure took');
   const names=readdirSync(fdPath(fd),{withFileTypes:true}).map(entry=>entry.name);
   const record:DirectoryRecord={descriptor,membership,names:Object.freeze(names)};
   this.#directories.set(relativePath,record);
   return record;
  }catch(error){
   // The primary error keeps its place and the cleanup failures are attached to it:
   // the causes are MERGED into it, so the ones that were already there are not
   // overwritten by a later cleanup.
   const failures:unknown[]=[];
   try{this.#closeOwned(descriptor);}catch(cleanupError){failures.push(cleanupError);}
   mergeRetainedCleanupCauses(error,failures);
   throw error;
  }
 }

 /** Retain one file of the tree: its descriptor, its identity and its digest.
  *  The digest is a bounded stream, never a whole read of a media file.
  *
  *  Retaining the same path twice returns the same retained object: a file is one
  *  resource, and a second descriptor would be a second owner of the same bytes. */
 async retainFile(relativePath:string):Promise<RetainedNativeFile>{
  const existing=this.#files.get(relativePath);
  if(existing!==undefined)return this.#issuedFile(existing);
  return this.#admit(async()=>{
   const current=this.#files.get(relativePath);
   if(current!==undefined)return this.#issuedFile(current);
   const membership=this.#membership.get(relativePath);
   if(membership===undefined)fail('NATIVE_CLOSURE_NOT_FOUND','The retained path is not a member of the tree');
   if(membership.isDirectory)fail('NATIVE_CLOSURE_NOT_REGULAR','The retained path is a directory');
   const parts=relativePath.split('/');
   const leaf=parts.pop()!;
   // The parent is the retained directory of the tree: no chain is opened per file.
   const parent=this.#directoryRecord(parts.join('/'));
   let opened:{readonly fd:number;readonly allocation:RetainedNativeAllocation};
   try{opened=this.#openDescriptor(fdPath(parent.descriptor.fd)+'/'+leaf,fileFlags);}
   catch(error){
    if(codeOf(error)==='ENOENT'||codeOf(error)==='ENOTDIR')fail('NATIVE_CLOSURE_NOT_FOUND','The retained file is not there',[error]);
    throw error;
   }
   const fd=opened.fd;
   const descriptor:OwnedDescriptor={fd,allocation:opened.allocation,released:false};
   // The text budget this file takes, when it is text. It is decided AND CHARGED
   // before the first byte of this file is read: a text above the budget is never
   // read at all, not read and then refused.
   //
   // The charge is taken ONCE for this file - a file that is retained again finds
   // its record and never charges twice - and the whole operation is SYNCHRONOUS
   // (there is no await between the charge and the record), so two retains of the
   // same path can neither double-charge it nor over-commit the total.
   let charged=0;
   let previousCharge=0;
   try{
    const info=fstatSync(fd,{bigint:true});
    if(!info.isFile())fail('NATIVE_CLOSURE_NOT_REGULAR','The retained path is not a regular file');
    // A regular file with more than one name is an alias to another file: it is not
    // a file of this tree, so it is refused here and never read.
    if(info.nlink>1n)fail('NATIVE_CLOSURE_ALIASED','The retained file is linked to another name');
    if(info.dev!==membership.dev||info.ino!==membership.ino||info.size!==membership.size)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file is not the file the closure took');
    const bytes=Number(info.size);
    if(!isRetainedNativeAsset(relativePath)){
     // The TEXT budget, decided before the first byte of this file is read.
     if(bytes>this.#budget.maxTextBytes)fail('NATIVE_CLOSURE_BUDGET','The retained text is larger than the budget allows');
     previousCharge=this.#textBytesByFile.get(membership.path)??0;
     const total=[...this.#textBytesByFile.values()].reduce((sum,value)=>sum+value,0);
     if(total-previousCharge+bytes>this.#budget.maxTotalTextBytes)fail('NATIVE_CLOSURE_BUDGET','The retained text is larger than the total budget allows');
     this.#textBytesByFile.set(membership.path,Math.max(previousCharge,bytes));
     charged=bytes;
    }
    // The digest is bounded by the CAPTURED size: the file may not be shorter than
    // the closure took, and one byte more is a refusal, never a summary of a file
    // that grew.
    const digest=this.#hashBounded(fd,bytes,membership.path);
    // The identity fence AFTER the read: the file that was read is the file that
    // was taken, and the path still names it.
    if(!this.#identityHolds(fd,membership.path,membership))fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file changed while it was read');
    const record:FileRecord={descriptor,membership,sha256:digest.sha256,bytes:digest.bytes};
    this.#files.set(relativePath,record);
    return this.#issuedFile(record);
   }catch(error){
    // A retain that did not keep the file does not keep its text budget either:
    // the capacity goes back to the closure that really holds it.
    if(charged>0)this.#textBytesByFile.set(membership.path,previousCharge);
    // The primary error keeps its place and the cleanup failures are attached to it:
    // the causes are MERGED into it, so the ones that were already there are not
    // overwritten by a later cleanup.
    const failures:unknown[]=[];
    try{this.#closeOwned(descriptor);}catch(cleanupError){failures.push(cleanupError);}
    mergeRetainedCleanupCauses(error,failures);
    throw error;
   }
  });
 }

 /** Retain one directory of the tree, with the names in the order the platform
  *  really returned them. The native listing order is not a sorted order.
  *
  *  The empty path is the root itself: it is not a relative path, and it is the one
  *  listing that has no name of its own. */
 async retainDirectory(relativePath:string):Promise<RetainedNativeDirectory>{
  const existing=this.#directories.get(relativePath);
  if(existing!==undefined)return this.#issuedDirectory(existing);
  return this.#admit(async()=>{
   const current=this.#directories.get(relativePath);
   if(current!==undefined)return this.#issuedDirectory(current);
   if(relativePath!==''){
    const membership=this.#membership.get(relativePath);
    if(membership===undefined)fail('NATIVE_CLOSURE_NOT_FOUND','The retained directory is not a member of the tree');
    if(!membership.isDirectory)fail('NATIVE_CLOSURE_NOT_REGULAR','The retained path is not a directory');
   }
   const record=this.#directoryRecord(relativePath);
   return this.#issuedDirectory(record);
  });
 }

 /** Retain one proved absence: the nearest directory that does exist and the tail
  *  of the path that does not. A permission or an I/O failure is not an absence. */
 async retainAbsent(relativePath:string):Promise<RetainedNativeAbsent>{
  const existing=this.#absents.get(relativePath);
  if(existing!==undefined)return this.#issuedAbsent(existing);
  return this.#admit(async()=>{
   const current=this.#absents.get(relativePath);
   if(current!==undefined)return this.#issuedAbsent(current);
   if(!isSafeRelative(relativePath))fail('NATIVE_CLOSURE_PATH_INVALID','The retained path is not a safe relative path');
   if(this.#membership.has(relativePath))fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained path is present and cannot be an absence');
   // The nearest existing parent: the deepest directory of the path that is a member.
   const parts=relativePath.split('/');
   let parentPath='';
   for(let index=parts.length-1;index>0;index-=1){
    const candidate=parts.slice(0,index).join('/');
    const membership=this.#membership.get(candidate);
    if(membership!==undefined&&membership.isDirectory){parentPath=candidate;break;}
   }
   const parent=this.#directoryRecord(parentPath);
   const tail=parts.slice(parentPath===''?0:parentPath.split('/').length);
   const record:AbsentRecord={relative_path:relativePath,parent:parentPath===''?null:parentPath,tail,
    parentDev:parent.membership.dev,parentIno:parent.membership.ino,parentDescriptor:parent.descriptor};
   this.#absents.set(relativePath,record);
   return this.#issuedAbsent(record);
  });
 }

 /** Read a retained file as text. The bytes must be exactly valid UTF-8: a lossy
  *  decode would change the film's own revision.
  *
  *  The budget is enforced *before* the read and *during* it: a file that is larger
  *  than the budget is never read into memory, and a file that grows while it is read
  *  is not the file the closure took. The UTF-8 BOM is preserved, because the film's
  *  revision is the revision of its own bytes. */
 async readText(file:RetainedNativeFile):Promise<string>{
  return this.#admit(async()=>{
   const record=this.#issuedFiles.get(file);
   if(record===undefined)fail('NATIVE_CLOSURE_CAPABILITY_INVALID','The retained file is not one this closure issued');
   if(record.descriptor.released)fail('NATIVE_CLOSURE_CAPABILITY_INVALID','The retained file was already released');
   // The observation runs inside the accepted operation: the operation is registered.
   this.#onRead?.(record.membership.path);
   const info=fstatSync(record.descriptor.fd,{bigint:true});
   // The identity fence BEFORE the read: the file must be the very file that was
   // retained - the same device and inode, the same size, and the same change times.
   if(!info.isFile()||info.dev!==record.membership.dev||info.ino!==record.membership.ino)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file is not the file the closure took');
   // A name added to the file after it was retained makes it an alias: the read is
   // refused, and the identity fence says why.
   if(info.nlink>1n)fail('NATIVE_CLOSURE_ALIASED','The retained file is linked to another name');
   if(info.size!==record.membership.size)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file changed under the read');
   if(info.mtimeNs!==record.membership.mtimeNs||info.ctimeNs!==record.membership.ctimeNs)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file changed under the read');
   if(info.size>BigInt(this.#budget.maxTextBytes))fail('NATIVE_CLOSURE_BUDGET','The retained text is larger than the budget allows');
   // The budget counts what the closure HOLDS: a file that was read already is not
   // counted twice, and a file that was not read yet is what crosses the sum.
   const held=this.#textBytesByFile.get(record.membership.path)??0;
   const total=[...this.#textBytesByFile.values()].reduce((sum,value)=>sum+value,0);
   // The file's own contribution is replaced, not added a second time.
   if(total-held+Number(info.size)>this.#budget.maxTotalTextBytes)fail('NATIVE_CLOSURE_BUDGET','The retained text is larger than the total budget allows');
   const bytes=this.#readAll(record.descriptor.fd,Number(info.size),record.membership.path);
   if(bytes.length>this.#budget.maxTextBytes)fail('NATIVE_CLOSURE_BUDGET','The retained text is larger than the budget allows');
   let text:string;
   // `ignoreBOM` keeps the byte-order mark as a character, so the film's own bytes and
   // the film's own revision are the same. A decoder that strips it would change them.
   try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
   catch(error){fail('NATIVE_CLOSURE_TEXT_INVALID','The retained text is not valid UTF-8',[error]);}
   if(!Buffer.from(text,'utf8').equals(bytes))fail('NATIVE_CLOSURE_TEXT_INVALID','The retained text does not re-encode to its own bytes');
   // The identity fence AFTER the read: the file must not have moved, and the bytes
   // must be the bytes that were retained.
   const after=fstatSync(record.descriptor.fd,{bigint:true});
   if(after.dev!==record.membership.dev||after.ino!==record.membership.ino
    ||after.size!==record.membership.size||after.mtimeNs!==record.membership.mtimeNs
    ||after.ctimeNs!==record.membership.ctimeNs)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file changed under the read');
   if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained text is not the text the closure took');
   this.#textBytesByFile.set(record.membership.path,Math.max(held,bytes.length));
   return text;
  });
 }

 /** Hash a retained file again, from the descriptor that still holds it. */
 async hashFile(file:RetainedNativeFile):Promise<{sha256:string;bytes:number}>{
  return this.#admit(async()=>{
   const record=this.#issuedFiles.get(file);
   if(record===undefined)fail('NATIVE_CLOSURE_CAPABILITY_INVALID','The retained file is not one this closure issued');
   if(record.descriptor.released)fail('NATIVE_CLOSURE_CAPABILITY_INVALID','The retained file was already released');
   // The digest is bounded by the size the closure TOOK: a file that grew or was
   // truncated is refused, never summarised as it is now.
   const digest=this.#hashBounded(record.descriptor.fd,Number(record.membership.size),record.membership.path);
   // And the identity fence after the read: the file that was read is the file
   // that was taken.
   if(!this.#identityHolds(record.descriptor.fd,record.membership.path,record.membership))
    fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file changed while it was read');
   return digest;
  });
 }

 /** The synchronous guard of one retained file.
  *
  * It answers whether the file that was taken is STILL the file the tree names:
  * the descriptor holds the same device, the same inode, the same size and the same
  * bytes - AND the path that names it is the very file the descriptor holds. A file
  * that was replaced at its path by an equal copy is therefore refused, although
  * the descriptor still holds the original bytes.
  *
  * It never throws. */
 verifyFile(file:RetainedNativeFile):boolean{
  try{
   const record=this.#issuedFiles.get(file);
   if(record===undefined||record.descriptor.released)return false;
   if(this.#closed||this.#uncertain)return false;
   const info=fstatSync(record.descriptor.fd,{bigint:true});
   if(!info.isFile())return false;
   // A name added to the file after it was retained makes it an alias: the guard
   // stops verifying it, so the old proof does not survive an external hardlink.
   if(info.nlink>1n)return false;
   if(info.dev!==record.membership.dev||info.ino!==record.membership.ino||info.size!==record.membership.size)return false;
   // The guard hashes at most the size the closure TOOK: a file that grew is not
   // read to its new end, and a file that was truncated is not read as it is now.
   const digest=this.#hashBoundedSync(record.descriptor.fd,Number(record.membership.size),record.membership.path);
   if(digest===null||digest!==record.sha256)return false;
   // The identity fence after the read: a file that was changed and written back
   // keeps its length, and the digest of its bytes may even be the same - its
   // change time of its inode is not.
   return this.#identityHolds(record.descriptor.fd,record.membership.path,record.membership);
  }catch{return false;}
 }

 /** The EXACT synchronous guard of one retained file.
  *
  * It is the identity the Host itself keeps: the nanosecond change times, the
  * device, the inode, the size, the number of names and the bytes - never the
  * millisecond value, which exists only to reproduce the upstream's own stamp.
  *
  * The held descriptor AND the path that names it are compared, BEFORE the bytes
  * are hashed and AFTER they were hashed: a file that was replaced by an equal copy
  * between the two comparisons is caught, and so is one whose path now names
  * another file altogether.
  *
  * The bytes are hashed with the bounded streaming buffer - a large media file is
  * never read into memory as a whole, and never treated as text. It never throws. */
 verifyFileExact(file:RetainedNativeFile):boolean{
  try{
   const record=this.#issuedFiles.get(file);
   if(record===undefined||record.descriptor.released)return false;
   if(this.#closed||this.#uncertain)return false;
   const path=this.#root+sep+record.membership.path;
   const held=fstatSync(record.descriptor.fd,{bigint:true});
   if(!held.isFile())return false;
   if(held.nlink>1n)return false;
   if(held.dev!==record.membership.dev||held.ino!==record.membership.ino)return false;
   if(held.size!==record.membership.size)return false;
   if(held.mtimeNs!==record.membership.mtimeNs||held.ctimeNs!==record.membership.ctimeNs)return false;
   if(held.nlink!==record.membership.nlink)return false;
   // The PATH must still name the very file the descriptor holds.
   const before=lstatSync(path,{bigint:true});
   if(!before.isFile()||before.isSymbolicLink())return false;
   if(before.dev!==held.dev||before.ino!==held.ino||before.size!==held.size)return false;
   if(before.mtimeNs!==held.mtimeNs||before.ctimeNs!==held.ctimeNs)return false;
   if(before.nlink!==held.nlink)return false;
   // The bytes are read with the bounded streaming buffer, never as a whole file.
   // The work is bounded by the size the closure took, and a file that grew is
   // refused: an unbounded read would let a growing file hold the final fence.
   const digest=this.#hashBoundedSync(record.descriptor.fd,Number(record.membership.size),record.membership.path);
   if(digest===null||digest!==record.sha256)return false;
   // ... and the identity is compared once more AFTER the read.
   const after=fstatSync(record.descriptor.fd,{bigint:true});
   if(after.dev!==held.dev||after.ino!==held.ino||after.size!==held.size)return false;
   if(after.mtimeNs!==held.mtimeNs||after.ctimeNs!==held.ctimeNs)return false;
   if(after.nlink!==held.nlink)return false;
   const named=lstatSync(path,{bigint:true});
   if(!named.isFile()||named.isSymbolicLink())return false;
   if(named.dev!==after.dev||named.ino!==after.ino||named.size!==after.size)return false;
   if(named.mtimeNs!==after.mtimeNs||named.ctimeNs!==after.ctimeNs)return false;
   if(named.nlink!==after.nlink)return false;
   return true;
  }catch{return false;}
 }

 /** The bounded digest of exactly the bytes the closure took.
  *
  * The work is bounded by the size the closure retained, and a file that grew is
  * refused: the extra byte is looked for and its absence is proved. The buffer is
  * the same 64KiB the other hashes use, but here the LIMIT is the retained size,
  * so a file that keeps growing cannot hold the guard open. It returns null when
  * the file is shorter than it was or longer than it is now.
  *
  * Every read is reported to the observation, so the bytes a guard really moved are
  * attributed to the very file they came from. */
 #hashBoundedSync(fd:number,expectedBytes:number,relativePath:string):string|null{
  const hash=createHash('sha256');
  const buffer=Buffer.allocUnsafe(HASH_BUFFER);
  let position=0;
  while(position<expectedBytes){
   const want=Math.min(buffer.length,expectedBytes-position);
   const bytesRead=readSync(fd,buffer,0,want,position);
   if(bytesRead===0)return null;
   this.#onReadChunk?.(relativePath,bytesRead);
   hash.update(buffer.subarray(0,bytesRead));
   position+=bytesRead;
  }
  // One more byte must not be there: the file may not have grown.
  const extra=readSync(fd,buffer,0,1,expectedBytes);
  this.#onReadChunk?.(relativePath,extra);
  if(extra!==0)return null;
  return hash.digest('hex');
 }

 /** The synchronous guard of the INTERNAL parent chain of the retained files.
  *
  * The root and the chain above it are not enough: a file may keep its inode and
  * be moved into a NEW parent directory, and only the identity of the directories
  * inside the root tells that apart.
  *
  * It compares the identity of every retained directory - the device, the inode
  * and the type - and NOTHING else: the names and the change times of a directory
  * are not compared, so a legitimate cache entry that appears beside a file does
  * not make this guard fail. It never throws. */
 verifyDirectoryChain():boolean{
  if(this.#closed||this.#uncertain)return false;
  try{
   for(const record of this.#directories.values()){
    const relative=record.membership.path;
    const path=relative===''?this.#root:this.#root+sep+relative;
    const info=lstatSync(path,{bigint:true});
    if(!info.isDirectory()||info.isSymbolicLink())return false;
    if(info.dev!==record.membership.dev||info.ino!==record.membership.ino)return false;
    const held=fstatSync(record.descriptor.fd,{bigint:true});
    if(!held.isDirectory()||held.dev!==record.membership.dev||held.ino!==record.membership.ino)return false;
   }
   return true;
  }catch{return false;}
 }

 /** The identity of the root, of the chain above it and of every retained
  *  directory inside it.
  *
  * It is what the owner of a closure checks AFTER the closure was released: the
  * paths are looked up again and compared with the identities the closure held,
  * so the parent chain is still the one the retained files were read under. */
 chainIdentities():readonly {readonly path:string;readonly dev:string;readonly ino:string}[]{
  const entries:{path:string;dev:string;ino:string}[]=[];
  for(const ancestor of this.#ancestors)entries.push({path:ancestor.path,dev:ancestor.dev.toString(),ino:ancestor.ino.toString()});
  for(const record of this.#directories.values()){
   const relative=record.membership.path;
   entries.push({path:relative===''?this.#root:this.#root+sep+relative,
    dev:record.membership.dev.toString(),ino:record.membership.ino.toString()});
  }
  entries.push({path:this.#root,dev:this.#rootMembership.dev.toString(),ino:this.#rootMembership.ino.toString()});
  return Object.freeze(entries);
 }

 /** The synchronous guard of the root and of the chain above it.
  *
  * It is the parent fence of the tree: the root the closure took and every
  * ancestor it holds. It says NOTHING about the membership of the tree, so a
  * legitimate creation of a derived cache entry is not refused by it - the whole
  * tree check is `verify`, and this one is the fence around the paths. */
 verifyRootChain():boolean{
  if(this.#closed||this.#uncertain)return false;
  try{
   const rootInfo=lstatSync(this.#root,{bigint:true});
   if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||realpathSync(this.#root)!==this.#root)return false;
   if(rootInfo.dev!==this.#rootMembership.dev||rootInfo.ino!==this.#rootMembership.ino)return false;
   const heldRoot=fstatSync(this.#rootDescriptor.fd,{bigint:true});
   if(!heldRoot.isDirectory()||heldRoot.dev!==this.#rootMembership.dev||heldRoot.ino!==this.#rootMembership.ino)return false;
   for(const ancestor of this.#ancestors){
    const info=lstatSync(ancestor.path,{bigint:true});
    if(!info.isDirectory()||info.isSymbolicLink())return false;
    if(info.dev!==ancestor.dev||info.ino!==ancestor.ino)return false;
    const held=fstatSync(ancestor.descriptor.fd,{bigint:true});
    if(held.dev!==ancestor.dev||held.ino!==ancestor.ino)return false;
   }
   return true;
  }catch{return false;}
 }

 /** Release one retained file's descriptor.
  *
  * The allocation is closed exactly once; a number is never closed twice and never
  * retried. A failure latches the closure as uncertain: it can then say nothing about
  * what it holds. */
 releaseFile(file:RetainedNativeFile):void{
  const record=this.#issuedFiles.get(file);
  if(record===undefined)fail('NATIVE_CLOSURE_CAPABILITY_INVALID','The retained file is not one this closure issued');
  if(record.descriptor.released)return;
  try{this.#closeOwned(record.descriptor);}
  catch(error){this.#uncertain=true;fail('NATIVE_CLOSURE_CLEANUP_FAILED','The retained descriptor could not be released',[error]);}
 }

 /** The only path a probe may be given: the descriptor this closure holds, reached
  *  through the parent process. It is never a path that could be swapped. */
 probePath(file:RetainedNativeFile):string{
  const record=this.#issuedFiles.get(file);
  if(record===undefined)fail('NATIVE_CLOSURE_CAPABILITY_INVALID','The retained file is not one this closure issued');
  if(record.descriptor.released)fail('NATIVE_CLOSURE_CAPABILITY_INVALID','The retained file was already released');
  if(this.#closed)fail('NATIVE_CLOSURE_CLOSED','The retained closure is closed');
  return '/proc/'+process.pid+'/fd/'+record.descriptor.fd;
 }

 /** The identity fence AFTER a read.
  *
  * The extra byte of the bounded digests proves the LENGTH of the file; it does
  * not prove the file itself. A writer that changes the bytes of the file and
  * writes them back - the same length, the same bytes count, another change time
  * of the inode - is caught here and nowhere else.
  *
  * The whole identity is compared: the device, the inode, the size, the nanosecond
  * change times and the number of names - of the descriptor AND of the path that
  * names it. A file that was replaced at its path by another file, and a file that
  * was changed in place, are both refused. */
 #identityHolds(fd:number,relativePath:string,membership:Membership):boolean{
  try{
   const held=fstatSync(fd,{bigint:true});
   if(!held.isFile())return false;
   if(held.dev!==membership.dev||held.ino!==membership.ino||held.size!==membership.size)return false;
   if(held.mtimeNs!==membership.mtimeNs||held.ctimeNs!==membership.ctimeNs)return false;
   if(held.nlink!==membership.nlink)return false;
   // The PATH must still name the very file the descriptor holds.
   const named=lstatSync(this.#root+sep+relativePath,{bigint:true});
   if(!named.isFile()||named.isSymbolicLink())return false;
   if(named.dev!==held.dev||named.ino!==held.ino||named.size!==held.size)return false;
   if(named.mtimeNs!==held.mtimeNs||named.ctimeNs!==held.ctimeNs)return false;
   if(named.nlink!==held.nlink)return false;
   return true;
  }catch{return false;}
 }

 /** The bounded digest of exactly the bytes the closure TOOK.
  *
  * The work is bounded by the CAPTURED size: a file that grew is refused (the extra
  * byte is looked for and its absence is proved) and a file that was truncated is
  * refused (the read ends before the size the closure took). Neither is summarised
  * as it is now: a refusal is a refusal.
  *
  * Every read is reported to the observation, so the bytes the closure really moved
  * - the digest included - are attributed to the very file they came from. The
  * memory stays bounded: the buffer is the same 64 KiB the other hashes use.
  *
  * HONESTLY STATED: this bounds the BYTES, not the time. A read that never ends
  * still ends the operation never; the budget and the timeouts of the Host are
  * unchanged by this. */
 #hashBounded(fd:number,expectedBytes:number,relativePath:string):{sha256:string;bytes:number}{
  const hash=createHash('sha256');
  const buffer=Buffer.allocUnsafe(HASH_BUFFER);
  let position=0;
  let bytes=0;
  while(position<expectedBytes){
   const want=Math.min(buffer.length,expectedBytes-position);
   const bytesRead=readSync(fd,buffer,0,want,position);
   if(bytesRead===0)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file was truncated while it was read');
   this.#onReadChunk?.(relativePath,bytesRead);
   hash.update(buffer.subarray(0,bytesRead));
   position+=bytesRead;bytes+=bytesRead;
  }
  // One more byte must not be there: the file may not have grown.
  const extra=readSync(fd,buffer,0,1,expectedBytes);
  this.#onReadChunk?.(relativePath,extra);
  if(extra!==0)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file grew while it was read');
  return {sha256:hash.digest('hex'),bytes};
 }

 /** Read a file whole, but only after the budget has cleared it, and only as many
  *  bytes as the descriptor said it had. A file that grew is refused, not truncated,
  *  and a file that was truncated is refused too: the read stops at the size the
  *  closure took and one more byte is looked for. */
 #readAll(fd:number,expected:number,relativePath:string):Buffer{
  const buffer=Buffer.allocUnsafe(HASH_BUFFER);
  const parts:Buffer[]=[];
  let position=0;
  let bytes=0;
  while(position<expected){
   const want=Math.min(buffer.length,expected-position);
   const bytesRead=readSync(fd,buffer,0,want,position);
   if(bytesRead===0)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file was truncated while it was read');
   this.#onReadChunk?.(relativePath,bytesRead);
   parts.push(Buffer.from(buffer.subarray(0,bytesRead)));
   position+=bytesRead;bytes+=bytesRead;
  }
  // One more byte must not be there: the file may not have grown.
  const extra=readSync(fd,buffer,0,1,expected);
  this.#onReadChunk?.(relativePath,extra);
  if(extra!==0)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file grew while it was read');
  if(bytes!==expected)fail('NATIVE_CLOSURE_MEMBERSHIP_MOVED','The retained file changed while it was read');
  return Buffer.concat(parts);
 }

 /** The synchronous closure guard.
  *
  * It answers whether the *whole* tree is still the one that was taken: the root, the
  * ancestry above it, every parent chain, every file's identity and bytes, every
  * directory's listing in its real order, and every proved absence. It never throws
  * and it is never true by default. */
 verify():boolean{
  if(this.#closed||this.#uncertain)return false;
  try{
   const rootInfo=lstatSync(this.#root,{bigint:true});
   if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||realpathSync(this.#root)!==this.#root)return false;
   if(rootInfo.dev!==this.#rootMembership.dev||rootInfo.ino!==this.#rootMembership.ino)return false;
   // The descriptor must still be the directory the path names.
   const heldRoot=fstatSync(this.#rootDescriptor.fd,{bigint:true});
   if(!heldRoot.isDirectory()||heldRoot.dev!==this.#rootMembership.dev||heldRoot.ino!==this.#rootMembership.ino)return false;
   for(const ancestor of this.#ancestors){
    const info=lstatSync(ancestor.path,{bigint:true});
    if(!info.isDirectory()||info.isSymbolicLink())return false;
    if(info.dev!==ancestor.dev||info.ino!==ancestor.ino)return false;
    const held=fstatSync(ancestor.descriptor.fd,{bigint:true});
    if(held.dev!==ancestor.dev||held.ino!==ancestor.ino)return false;
   }
   if(!this.#verifyMembership())return false;
   // A temporary close failure during the walk latched the uncertainty: the closure
   // can no longer say what it holds.
   if(this.#uncertain)return false;
   for(const record of this.#files.values()){
    if(record.descriptor.released)continue;
    const path=this.#root+sep+record.membership.path;
    const info=lstatSync(path,{bigint:true});
    if(!info.isFile()||info.isSymbolicLink())return false;
    // The path must still be a file of THIS tree: a name added to it after it was
    // retained makes it an alias, and the proof does not survive that.
    if(info.nlink>1n)return false;
    if(info.dev!==record.membership.dev||info.ino!==record.membership.ino)return false;
    const held=fstatSync(record.descriptor.fd,{bigint:true});
    if(held.nlink>1n)return false;
    if(held.dev!==info.dev||held.ino!==info.ino||held.size!==record.membership.size)return false;
    // The whole-tree guard hashes at most the size the closure TOOK, for every file.
    const digest=this.#hashBoundedSync(record.descriptor.fd,Number(record.membership.size),record.membership.path);
    if(digest===null||digest!==record.sha256)return false;
    if(!this.#identityHolds(record.descriptor.fd,record.membership.path,record.membership))return false;
   }
   for(const record of this.#directories.values()){
    const path=this.#root+sep+record.membership.path;
    const info=lstatSync(path,{bigint:true});
    if(!info.isDirectory()||info.isSymbolicLink())return false;
    if(info.dev!==record.membership.dev||info.ino!==record.membership.ino)return false;
    const names=readdirSync(fdPath(record.descriptor.fd),{withFileTypes:true}).map(entry=>entry.name);
    if(names.length!==record.names.length)return false;
    for(let index=0;index<names.length;index+=1)if(names[index]!==record.names[index])return false;
   }
   for(const record of this.#absents.values()){
    if(record.parent!==null&&record.parentDev!==null&&record.parentIno!==null){
     const info=lstatSync(this.#root+sep+record.parent,{bigint:true});
     if(!info.isDirectory()||info.isSymbolicLink())return false;
     if(info.dev!==record.parentDev||info.ino!==record.parentIno)return false;
    }
    let current=record.parent??'';
    for(const name of record.tail){
     const child=current===''?name:current+'/'+name;
     try{lstatSync(this.#root+sep+child);return false;}
     catch(error){if(codeOf(error)!=='ENOENT')return false;}
     current=child;
    }
   }
   return true;
  }catch{return false;}
 }

 /** Re-walk the whole tree and compare it with the membership the closure took. */
 #verifyMembership():boolean{
  const seen=new Set<string>();
  const walk=(descriptor:OwnedDescriptor,absolute:string,relative:string,depth:number):boolean=>{
   if(depth>this.#budget.maxDepth)return false;
   let entries;
   try{entries=readdirSync(fdPath(descriptor.fd),{withFileTypes:true});}catch{return false;}
   for(const entry of entries){
    // Once the closure is uncertain it allocates nothing more: a release that failed
    // means it can no longer say what it holds.
    if(this.#uncertain)return false;
    const childAbsolute=absolute+sep+entry.name;
    const childRelative=relative===''?entry.name:relative+'/'+entry.name;
    const recorded=this.#membership.get(childRelative);
    if(recorded===undefined)return false;
    seen.add(childRelative);
    let info;
    try{info=lstatSync(childAbsolute,{bigint:true});}catch{return false;}
    if(info.isSymbolicLink())return false;
    if(recorded.isDirectory){
     if(!info.isDirectory())return false;
     if(info.dev!==recorded.dev||info.ino!==recorded.ino)return false;
     let opened:{readonly fd:number;readonly allocation:RetainedNativeAllocation};
     try{opened=this.#openDescriptor(childAbsolute,directoryFlags);}
     catch{return false;}
     const child:OwnedDescriptor={fd:opened.fd,allocation:opened.allocation,released:false};
     try{if(!walk(child,childAbsolute,childRelative,depth+1))return false;}
     finally{
      // The walk's own descriptor is released here, and a failure of that release is
      // kept and latches the uncertainty: it must not be swallowed.
      try{this.#closeOwned(child);}catch(error){/* the failure is recorded by closeOwned */ void error;}
     }
     continue;
    }
    if(!info.isFile())return false;
    // A file that gained a name is an alias to another file: the tree it took is not
    // the tree it is, so the verification fails.
    if(info.nlink>1n)return false;
    if(info.dev!==recorded.dev||info.ino!==recorded.ino)return false;
    if(info.size!==recorded.size)return false;
    if(info.mtimeNs!==recorded.mtimeNs||info.ctimeNs!==recorded.ctimeNs)return false;
   }
   return true;
  };
  if(!walk(this.#rootDescriptor,this.#root,'',0))return false;
  return seen.size===this.#membership.size;
 }

 /** Reserve one descriptor before it is opened.
  *
  * The budget covers every allocation this closure owns: the root, the ancestry, the
  * walk's own temporary directories, the retained directories and the retained files.
  * The refusal happens BEFORE the open, so the closure never reaches EMFILE.
  *
  * The instance pool is reserved at the same moment: the two trees of one
  * acquisition and the parallel proofs of one reader share one count, and a
  * reservation that is not followed by an open is given back. */
 #reserveDescriptor():void{
  if(this.#descriptors+1>this.#budget.maxDescriptors)fail('NATIVE_CLOSURE_BUDGET','The retained tree needs more descriptors than the budget allows');
  if(this.#pool!==undefined){
   if(!this.#pool.reserve())fail('NATIVE_CLOSURE_BUDGET','The retained tree needs more descriptors than the budget allows');
   this.#poolHeld+=1;
  }
  this.#descriptors+=1;
 }

 /** Open a descriptor through the closure's own opener. */
 #openDescriptor(path:string,flags:number):{readonly fd:number;readonly allocation:RetainedNativeAllocation}{
  this.#reserveDescriptor();
  const allocation:RetainedNativeAllocation={namespace:this.#namespace,id:(this.#allocationId+=1),phase:this.#phase,path};
  try{const fd=this.#open?this.#open(path,flags,allocation):openSync(path,flags);return {fd,allocation};}
  catch(error){
   this.#descriptors-=1;
   // The open did not happen: the reservation is given back, because no descriptor
   // exists that could still be open.
   if(this.#pool!==undefined&&this.#poolHeld>0){this.#poolHeld-=1;this.#pool.release(true);}
   throw error;
  }
 }

 #closeOwned(descriptor:OwnedDescriptor):void{
  if(descriptor.released)return;
  descriptor.released=true;
  this.#descriptors-=1;
  try{this.#close(descriptor.fd,descriptor.allocation);}
  catch(error){
   // Every close failure is kept and latches the uncertainty: a descriptor whose
   // release failed is an allocation whose state this closure can no longer state.
   this.#uncertain=true;
   this.#cleanupFailures.push(error);
   // The release was not certain: the instance pool does NOT get its capacity
   // back, because the descriptor may still be open.
   if(this.#pool!==undefined&&this.#poolHeld>0){this.#poolHeld-=1;this.#pool.release(false);}
   throw error;
  }
  if(this.#pool!==undefined&&this.#poolHeld>0){this.#poolHeld-=1;this.#pool.release(true);}
 }

 /** Release every descriptor this closure still holds.
  *
  * Every one is attempted even when an earlier one failed, and a failure latches the
  * closure as uncertain: it can then say nothing about what it holds. An allocation is
  * closed at most once and never retried. */
 close():void{
  if(this.#closed&&this.#rootDescriptor.released)return;
  if(this.#pending.size>0){
   // A descriptor an accepted operation can still use is not released here, and
   // nothing was lost: the closure still holds everything it took and can still say
   // so. The refusal is not a cleanup failure, so it does not latch the uncertainty.
   fail('NATIVE_CLOSURE_BUSY','The retained closure still has accepted work in flight');
  }
  this.#closed=true;
  const failures=this.#closeAll();
  if(failures.length>0){this.#uncertain=true;throw this.#cleanupRefusal(failures);}
 }

 /** Drain the accepted work and then release everything. */
 async release():Promise<void>{
  await this.drain();
  if(this.#closed&&this.#rootDescriptor.released)return;
  this.#closed=true;
  const failures=this.#closeAll();
  if(failures.length>0){this.#uncertain=true;throw this.#cleanupRefusal(failures);}
 }

 /** The refusal of a release that did not finish.
  *
  * It carries the failures it really had, and it is marked as a GENUINE cleanup
  * failure: the owner of the acquisition can tell it apart from a failure that
  * merely carries an ordinary cause. */
 #cleanupRefusal(failures:readonly unknown[]):RetainedNativeError{
  const refusal=new RetainedNativeError('NATIVE_CLOSURE_CLEANUP_FAILED','The retained closure could not release everything');
  attachCauses(refusal,failures);
  markRetainedCleanupFailures(refusal,failures);
  return refusal;
 }

 /** Release everything and report what could not be released. */
 #closeAll():unknown[]{
  const failures:unknown[]=[];
  for(const record of this.#files.values()){
   try{this.#closeOwned(record.descriptor);}catch(error){failures.push(error);}
  }
  for(const record of this.#directories.values()){
   try{this.#closeOwned(record.descriptor);}catch(error){failures.push(error);}
  }
  for(const record of this.#absents.values()){
   if(record.parentDescriptor===undefined)continue;
   try{this.#closeOwned(record.parentDescriptor);}catch(error){failures.push(error);}
  }
  for(const ancestor of this.#ancestors){try{this.#closeOwned(ancestor.descriptor);}catch(error){failures.push(error);}}
  try{this.#closeOwned(this.#rootDescriptor);}catch(error){failures.push(error);}
  // The complete ledger, once: the failures this pass just saw and the ones a
  // temporary allocation saw earlier. A repeated release never erases the first
  // failure, and a cause is not counted twice.
  const ledger=this.#cleanupFailures.filter(error=>!failures.includes(error));
  return [...ledger,...failures];
 }
}

/** The identity of one path, as the platform reports it. */
function MembershipOf(path:string,relative:string,isDirectory:boolean):Membership{
 const info=lstatSync(path,{bigint:true});
 return {path:relative,isDirectory,dev:info.dev,ino:info.ino,size:info.size,mtimeNs:info.mtimeNs,ctimeNs:info.ctimeNs,nlink:info.nlink};
}
