import {randomUUID,createHash} from 'node:crypto';
import {constants,lstatSync,realpathSync,fstatSync} from 'node:fs';
import {open,mkdir,rm,realpath,lstat} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {dirname,resolve,relative,sep} from 'node:path';
import type {RevisionStore} from '../projects/revision-store.js';
import type {ProjectCreationStore} from '../projects/project-creation-store.js';
import type {TrustedCallerContext} from '../creative/product-repository.js';
import {isTrustedCallerContext,ProductError} from '../creative/trusted-context.js';
import type {SnapshotEntry} from '../render/ports.js';
import {assertSafeRelativePath} from '../render/snapshot-copy.js';
import {absoluteServerPath} from '../engine/isolated-root.js';
import type {AbsoluteServerPath} from '../engine/engine-port.js';
import {asHostResourceError} from '../api-error.js';
import {runtimeRoot} from './owned-runtime.js';
import type {CommittedSnapshotAuthority} from './committed-snapshot-authority.js';
interface Binding {project_id:string;principal_id:string;transaction_id:string;snapshot_id:string;source_digest:string;revision:number}
export interface PreparedNativeWorkspace {
 readonly project_id:string;readonly snapshot_id:string;readonly source_digest:string;readonly revision:number;
 readonly source_root:AbsoluteServerPath;readonly film_sha256:string;
}
interface HeldWorkspace {binding:Binding;name:string;directory:FileHandle;files:readonly SnapshotEntry[];view:PreparedNativeWorkspace}
const conflict=()=>new ProductError('REVISION_CONFLICT','The committed native workspace facts changed');
const unavailable=()=>new ProductError('CAPABILITY_UNAVAILABLE','The owned native workspace is unavailable');
const fdPath=(handle:FileHandle)=>'/proc/'+process.pid+'/fd/'+handle.fd;
const directoryFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
const same=(a:Binding,b:Binding)=>Object.keys(a).every(key=>a[key as keyof Binding]===b[key as keyof Binding]);
function canonicalProspective(path:string):string{
 const full=resolve(path);let ancestor=full;
 while(true){try{lstatSync(ancestor);break;}catch(error){if((error as {code?:unknown}).code!=='ENOENT')throw error;ancestor=dirname(ancestor);}}
 return resolve(realpathSync(ancestor),relative(ancestor,full));
}
const overlaps=(a:string,b:string)=>a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
/** Derived, disposable native working copy, never an author source or a second timeline.
 * Upstream may write .film metadata only here. All content still comes from one committed
 * SnapshotReadPort; edits/adoption remain Coordinator operations, not cache mutations.
 */
export class CreatedNativeWorkspaceService {
 readonly #prepared=new Map<string,HeldWorkspace>();
 readonly #held=new Set<HeldWorkspace>();
 readonly #operations=new Set<Promise<unknown>>();
 readonly #flights=new Map<string,Promise<PreparedNativeWorkspace>>();
 readonly #abort=new AbortController();
 #root:FileHandle|undefined;
 #rootPromise:Promise<FileHandle>|undefined;
 #closing=false;
 #stop:Promise<void>|undefined;
 #dispose:Promise<void>|undefined;
 readonly #path:string;
 readonly #boundary:((phase:'after_cache_verify',state:{project_id:string;snapshot_id:string;revision:number})=>Promise<void>)|undefined;
 constructor(private readonly revisions:RevisionStore,private readonly creation:ProjectCreationStore,
  private readonly snapshots:CommittedSnapshotAuthority,options:{root:string;protectedRoots:readonly string[];boundary?:(phase:'after_cache_verify',state:{project_id:string;snapshot_id:string;revision:number})=>Promise<void>}){
  this.#path=resolve(options.root);this.#boundary=options.boundary;
  // Before any mkdir, include aliases of not-yet-existing paths in overlap checks.
  const destination=canonicalProspective(this.#path);
  for(const protectedRoot of options.protectedRoots)if(overlaps(destination,canonicalProspective(protectedRoot)))throw unavailable();
 }
 #bind(projectId:string,principalId:string):Binding{
  if(typeof projectId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(projectId)||typeof principalId!=='string'||!this.creation.ownsProject(projectId,principalId))throw new ProductError('NOT_FOUND','No owned created project');
  if(this.creation.origin(projectId)?.origin!=='created')throw conflict();
  const commit=this.revisions.activeCommit(projectId);
  if(!commit||this.revisions.recoveryGate(projectId,0))throw conflict();
  const state=this.revisions.compose(db=>db.prepare('SELECT revision,source_digest FROM project_state WHERE project_id=?').get(projectId));
  if(Number(state?.revision)!==commit.revision||state?.source_digest!==commit.source_digest)throw conflict();
  return {project_id:projectId,principal_id:principalId,transaction_id:commit.transaction_id,snapshot_id:commit.snapshot_id,source_digest:commit.source_digest,revision:commit.revision};
 }
 #check(binding:Binding){if(this.#closing||this.#abort.signal.aborted)throw unavailable();if(!same(binding,this.#bind(binding.project_id,binding.principal_id)))throw conflict();}
 async #rootHandle():Promise<FileHandle>{
  return this.#rootPromise??=(async()=>{
   const path=runtimeRoot(this.#path),handle=await open(path,directoryFlags);
   this.#root=handle;return handle;
  })().catch(error=>{this.#rootPromise=undefined;throw error;});
 }
 async #assertRoot(){
  const handle=await this.#rootHandle(),[held,current]=await Promise.all([handle.stat(),lstat(this.#path)]);
  if(!current.isDirectory()||current.isSymbolicLink()||await realpath(this.#path)!==this.#path||held.dev!==current.dev||held.ino!==current.ino)throw conflict();
  return handle;
 }
 #admit<T>(operation:()=>Promise<T>):Promise<T>{
  if(this.#closing)return Promise.reject(unavailable());
  const promise=operation().catch(error=>{
   if(error instanceof ProductError)throw error;
   if(asHostResourceError(error))throw new ProductError('HOST_RESOURCE_EXHAUSTED','Native workspace I/O could not complete');
   throw unavailable();
  });this.#operations.add(promise);
  void promise.then(()=>this.#operations.delete(promise),()=>this.#operations.delete(promise));return promise;
 }
 prepare(projectId:string,caller:TrustedCallerContext):Promise<PreparedNativeWorkspace>{
  if(this.#closing)return Promise.reject(unavailable());
  if(!isTrustedCallerContext(caller)||caller.channel==='native_bridge')return Promise.reject(new ProductError('UNAUTHORIZED','A verified owner is required'));
  let binding:Binding;try{binding=this.#bind(projectId,caller.principal_id);}catch(error){return Promise.reject(error);}
  const key=binding.project_id+':'+binding.transaction_id+':'+binding.principal_id;
  const existing=this.#flights.get(key);if(existing)return existing;
  const work=this.#admit(async()=>{
   this.#check(binding);
   const cached=this.#prepared.get(projectId);
   if(cached&&same(cached.binding,binding)){
    try{await this.#verify(cached);await this.#boundary?.('after_cache_verify',{project_id:projectId,snapshot_id:binding.snapshot_id,revision:binding.revision});this.#check(binding);return cached.view;}
    catch(error){
     const code=(error as {code?:unknown}).code;
     if(code!=='REVISION_CONFLICT'&&!['ENOENT','ENOTDIR','ELOOP'].includes(String(code)))throw error;
     // A corrupt disposable copy can be rebuilt; the immutable snapshot must still
     // prove itself. Keep old copies held until native consumers have stopped.
     await this.#assertRoot();this.#check(binding);this.#prepared.delete(projectId);
    }
   }
   const closure=await this.snapshots.readerForTransaction(projectId,binding.transaction_id,caller.principal_id).readSnapshot({project_id:projectId,snapshot_id:binding.snapshot_id,source_digest:binding.source_digest});
   this.#check(binding);
   const root=await this.#assertRoot(),name='workspace-'+randomUUID();
   await mkdir(fdPath(root)+'/'+name,{mode:0o700});
   let directory:FileHandle|undefined,source:FileHandle|undefined,retained=false;
   try{
    directory=await open(fdPath(root)+'/'+name,directoryFlags);
    source=await open(closure.native_root,directoryFlags);
    for(const entry of closure.entries){this.#check(binding);await this.#copy(entry,source,directory);}
    this.#check(binding);await this.#assertRoot();
    const film=closure.entries.find(entry=>entry.relative_path===closure.native_entry);if(!film)throw conflict();
    const view=Object.freeze({project_id:projectId,snapshot_id:binding.snapshot_id,source_digest:binding.source_digest,revision:binding.revision,source_root:Object.freeze(absoluteServerPath(this.#path+'/'+name)),film_sha256:film.sha256});
    const record:HeldWorkspace={binding,name,directory,files:closure.entries,view};
    await this.#verify(record);this.#check(binding);
    this.#prepared.set(projectId,record);this.#held.add(record);retained=true;return view;
   }finally{
    await source?.close();if(!retained){await directory?.close();await rm(fdPath(root)+'/'+name,{recursive:true,force:true});}
   }
  });
  this.#flights.set(key,work);void work.then(()=>this.#flights.delete(key),()=>this.#flights.delete(key));return work;
 }
 /** Host-only delegate lease check: the exact issued object and directory identities,
  * not a client-supplied root or a fresh per-request copy of every large media asset. */
 isPrepared(view:PreparedNativeWorkspace):boolean {
  try{
   const record=this.#prepared.get(view.project_id);if(!record||record.view!==view||!this.#root)return false;
   this.#check(record.binding);
   const root=fstatSync(this.#root.fd),named=lstatSync(this.#path);
   if(!named.isDirectory()||named.isSymbolicLink()||named.dev!==root.dev||named.ino!==root.ino||realpathSync(this.#path)!==this.#path)return false;
   const held=fstatSync(record.directory.fd),path=fdPath(this.#root)+'/'+record.name,current=lstatSync(path);
   return current.isDirectory()&&!current.isSymbolicLink()&&held.dev===current.dev&&held.ino===current.ino&&realpathSync(path)===view.source_root.value;
  }catch{return false;}
 }
 /** Host-only lookup; an arbitrary URL/query cannot open an unprepared or stale project. */
 rootFor(projectId:string):Promise<AbsoluteServerPath>{
  return this.#admit(async()=>{const record=this.#prepared.get(projectId);if(!record)throw unavailable();this.#check(record.binding);await this.#verify(record);this.#check(record.binding);return record.view.source_root;});
 }
 async #leaf(root:FileHandle,path:string,create:boolean):Promise<{file:FileHandle;parents:FileHandle[]}>{
  const parts=assertSafeRelativePath(path).split('/'),parents:FileHandle[]=[];let parent=root;
  try{
   for(const name of parts.slice(0,-1)){
    if(create)await mkdir(fdPath(parent)+'/'+name,{mode:0o700}).catch(error=>{if((error as {code?:unknown}).code!=='EEXIST')throw error;});
    parent=await open(fdPath(parent)+'/'+name,directoryFlags);parents.push(parent);
   }
   const flags=create?constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW:constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW;
   const file=await open(fdPath(parent)+'/'+parts[parts.length-1],flags,0o600);return {file,parents};
  }catch(error){await Promise.all(parents.map(handle=>handle.close()));throw error;}
 }
 async #read(entry:SnapshotEntry,root:FileHandle,write?:FileHandle){
  const {file,parents}=await this.#leaf(root,entry.relative_path,false);
  try{
   const before=await file.stat({bigint:true});if(!before.isFile()||before.size!==BigInt(entry.bytes))throw conflict();
   const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let offset=0;
   while(offset<entry.bytes){
    if(this.#abort.signal.aborted)throw unavailable();
    const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,entry.bytes-offset),offset);if(!bytesRead)throw conflict();
    hash.update(buffer.subarray(0,bytesRead));
    if(write){let done=0;while(done<bytesRead){const result=await write.write(buffer,done,bytesRead-done,offset+done);if(!result.bytesWritten)throw unavailable();done+=result.bytesWritten;}}
    offset+=bytesRead;
   }
   const after=await file.stat({bigint:true});
   if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||hash.digest('hex')!==entry.sha256)throw conflict();
  }finally{await file.close();await Promise.all(parents.map(handle=>handle.close()));}
 }
 async #copy(entry:SnapshotEntry,source:FileHandle,destination:FileHandle){
  const {file,parents}=await this.#leaf(destination,entry.relative_path,true);
  try{await this.#read(entry,source,file);await file.sync();}
  finally{await file.close();await Promise.all(parents.map(handle=>handle.close()));}
 }
 async #verify(record:HeldWorkspace){
  const root=await this.#assertRoot(),path=fdPath(root)+'/'+record.name,stats=await lstat(path),held=await record.directory.stat();
  if(!stats.isDirectory()||stats.isSymbolicLink()||held.dev!==stats.dev||held.ino!==stats.ino||await realpath(path)!==this.#path+'/'+record.name)throw conflict();
  for(const entry of record.files)await this.#read(entry,record.directory);
 }
 /** Phase one stops cache I/O; native may still be using a previous view until shutdown. */
 close(){this.#closing=true;this.#abort.abort();return this.#stop??=Promise.allSettled([...this.#operations]).then(()=>undefined);}
 /** Called only AFTER native Studio/Gateway have stopped. Never delete a live native root. */
 disposeAfterNative(){return this.#dispose??=(async()=>{await this.close();const root=this.#root;if(!root)return;
  for(const record of this.#held){await record.directory.close();await rm(fdPath(root)+'/'+record.name,{recursive:true,force:true});}
  this.#held.clear();this.#prepared.clear();await root.close();this.#root=undefined;
 })();}
}
