/** MAIN local I/O. Not a PID-file lock: the Host inherits the real flock descriptor. */
import {constants,closeSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,realpathSync,fsyncSync} from 'node:fs';
import {writeFile,rename,rm,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fsyncPath} from '../projects/snapshot-store.js';
export interface RuntimeState {
 readonly format:'narralens.agent-runtime@1';
 readonly instance_id:string;
 readonly generation:number;
 readonly pid:number;
 readonly process_start:string;
 readonly started_at:string;
 readonly state:'starting'|'listening'|'stopped';
 readonly origin:string|null;
}
export interface RuntimeConnection {readonly format:'narralens.agent-connection@1';readonly instance_id:string;readonly generation:number;readonly origin:string;readonly token:string;readonly expires_at:number;}
export const RUNTIME_LOCK_FD=9;
function privateStat(path:string){
 const st=lstatSync(path);
 if(st.isSymbolicLink()||(!st.isDirectory()&&!st.isFile())||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)throw new Error('RUNTIME_OWNERSHIP_UNVERIFIED');
 return st;
}
export function runtimeRoot(path:string):string {
 if(process.platform!=='linux')throw new Error('LOCAL_RUNTIME_REQUIRES_LINUX_OR_WSL');
 const absolute=resolve(path);
 // Validate the existing ancestor before creating anything through a symlink alias.
 let ancestor=absolute;
 while(true){try{lstatSync(ancestor);break;}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw error;ancestor=dirname(ancestor);}}
 if(realpathSync(ancestor)!==ancestor)throw new Error('RUNTIME_ROOT_ALIAS_REJECTED');
 const first=mkdirSync(absolute,{recursive:true,mode:0o700});
 privateStat(absolute);if(realpathSync(absolute)!==absolute)throw new Error('RUNTIME_ROOT_ALIAS_REJECTED');
 if(first){const stop=dirname(first);let directory=absolute;while(true){const fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}if(directory===stop)break;directory=dirname(directory);}}
 return absolute;
}
export function openRuntimeLock(root:string):number {
 const path=join(root,'instance.lock');
 const fd=openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
 try{const held=fstatSync(fd),pathStat=privateStat(path);if(!held.isFile()||held.dev!==pathStat.dev||held.ino!==pathStat.ino)throw new Error('RUNTIME_LOCK_CHANGED');return fd;}
 catch(error){closeSync(fd);throw error;}
}
/** Passing the same open file description to flock retains the kernel lock in this process. */
export function acquireRuntimeLock(fd:number):boolean {
 const stdio:(number|'ignore')[]=Array.from({length:10},()=> 'ignore');stdio[RUNTIME_LOCK_FD]=fd;
 const result=spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73',String(RUNTIME_LOCK_FD)],{stdio});
 if(result.error)throw new Error('RUNTIME_LOCK_TOOL_UNAVAILABLE');if(result.status===73)return false;if(result.status!==0)throw new Error('RUNTIME_LOCK_UNVERIFIED');return true;
}
export function assertInheritedRuntimeLock(root:string):void {
 const inherited=fstatSync(RUNTIME_LOCK_FD),expected=privateStat(join(root,'instance.lock'));
 if(!inherited.isFile()||inherited.dev!==expected.dev||inherited.ino!==expected.ino||!acquireRuntimeLock(RUNTIME_LOCK_FD))throw new Error('RUNTIME_LOCK_NOT_OWNED');
}
export function processStart(pid:number):string {
 if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('INVALID_LOCAL_PID');
 const raw=readFileSync('/proc/'+pid+'/stat','utf8'),end=raw.lastIndexOf(')');
 const fields=raw.slice(end+2).trim().split(/\s+/);const start=fields[19];
 if(!start||!/^\d+$/.test(start)||fields[0]==='Z')throw new Error('PROCESS_IDENTITY_UNAVAILABLE');return start;
}
function jsonName(name:string):void {if(!/^[a-z][a-z0-9-]*\.json$/.test(name))throw new Error('RUNTIME_FILE_NAME_INVALID');}
export function readPrivateJson(root:string,name:string):unknown|null {
 jsonName(name);let fd:number|undefined;
 try{
  fd=openSync(join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const st=fstatSync(fd);if(!st.isFile()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>65536)throw new Error('RUNTIME_FILE_INVALID');
  const bytes=Buffer.alloc(65537);let count=0;
  while(count<bytes.length){const n=readSync(fd,bytes,count,bytes.length-count,null);if(n===0)break;count+=n;}
  if(count>65536)throw new Error('RUNTIME_FILE_INVALID');
  return JSON.parse(bytes.subarray(0,count).toString('utf8'));
 }catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT')return null;throw error;}
 finally{if(fd!==undefined)closeSync(fd);}
}
export async function writePrivateJson(root:string,name:string,value:unknown):Promise<void>{
 jsonName(name);
 const target=join(root,name),temporary=join(root,'.'+name+'.'+randomUUID()+'.tmp');
 const old=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(old)privateStat(target);
 try{await writeFile(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await fsyncPath(temporary);await rename(temporary,target);await fsyncPath(root);}
 finally{await rm(temporary,{force:true});}
}
function state(value:unknown):RuntimeState {
 if(!value||typeof value!=='object')throw new Error('RUNTIME_STATE_INVALID');
 const v=value as RuntimeState;
 if(Object.keys(v).sort().join(',')!=='format,generation,instance_id,origin,pid,process_start,started_at,state'||v.format!=='narralens.agent-runtime@1'||!/^instance_[a-f0-9]{32}$/.test(v.instance_id)||!Number.isSafeInteger(v.generation)||v.generation<1||!Number.isSafeInteger(v.pid)||v.pid<=0||!/^\d+$/.test(v.process_start)||typeof v.started_at!=='string'||!Number.isFinite(Date.parse(v.started_at))||!['starting','listening','stopped'].includes(v.state)||(v.origin!==null&&!validOrigin(v.origin)))throw new Error('RUNTIME_STATE_INVALID');
 return v;
}
export function validOrigin(value:string):boolean {try{const url=new URL(value);return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.origin===value;}catch{return false;}}
export function readRuntimeState(root:string):RuntimeState|null {const value=readPrivateJson(root,'instance.json');return value===null?null:state(value);}
export function initialInstanceId(root:string):string{return 'instance_'+createHash('sha256').update('narralens-owned-runtime-v1\n'+root).digest('hex').slice(0,32);}
export async function beginRuntime(root:string):Promise<RuntimeState>{
 assertInheritedRuntimeLock(root);const old=readRuntimeState(root);
 // A replaced/unlinked lock inode is not proof that the recorded Host disappeared.
 // Refuse takeover while the exact predecessor is still alive, even under a new flock.
 if(old&&old.state!=='stopped'){
  let alive=false;
  try{alive=processStart(old.pid)===old.process_start;}
  catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT')&&!(error instanceof Error&&error.message==='PROCESS_IDENTITY_UNAVAILABLE'))throw new Error('PREVIOUS_INSTANCE_LIVENESS_UNKNOWN');}
  if(alive)throw new Error('PREVIOUS_INSTANCE_STILL_ALIVE');
 }
 const generation=(old?.generation??0)+1;if(!Number.isSafeInteger(generation))throw new Error('INSTANCE_GENERATION_EXHAUSTED');
 const next:RuntimeState={format:'narralens.agent-runtime@1',instance_id:old?.instance_id??initialInstanceId(root),generation,pid:process.pid,process_start:processStart(process.pid),started_at:new Date().toISOString(),state:'starting',origin:null};
 // A generation skipped by a crash stays skipped; never roll the number back.
 await writePrivateJson(root,'instance.json',next);
 if(readPrivateJson(root,'cursor-key.json')===null)await writePrivateJson(root,'cursor-key.json',{format:'narralens.cursor-key@1',key:randomBytes(32).toString('base64url')});
 return next;
}
export function readRuntimeConnection(root:string):RuntimeConnection|null {
 const value=readPrivateJson(root,'connection.json');if(value===null)return null;
 const c=value as RuntimeConnection;
 if(Object.keys(c).sort().join(',')!=='expires_at,format,generation,instance_id,origin,token'||c.format!=='narralens.agent-connection@1'||typeof c.origin!=='string'||!validOrigin(c.origin)||typeof c.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(c.token)||!Number.isSafeInteger(c.expires_at)||c.expires_at<=Date.now())throw new Error('RUNTIME_CONNECTION_INVALID');
 const current=readRuntimeState(root);if(!current||current.instance_id!==c.instance_id||current.generation!==c.generation||current.origin!==c.origin||current.state!=='listening'||processStart(current.pid)!==current.process_start)throw new Error('RUNTIME_CONNECTION_STALE');return c;
}
