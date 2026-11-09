import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HttpError} from '../api-error.js';
import {runtimeRoot as privateRuntimeRoot,processStart} from '../agent-driven/owned-runtime.js';
import {signalProcessGroup,groupExistsOfProcess} from '../render/native-renderer.js';
import type {StartedStudio} from './openfilm-studio-supervisor.js';
const unavailable=(stage='owned_studio',reason='UNAVAILABLE')=>new HttpError(503,'ENGINE_UNAVAILABLE',`The owned native Studio is unavailable (${stage}: ${reason})`);
const loopback=(value:unknown,film=false):value is string=>{try{const url=new URL(String(value));return typeof value==='string'&&url.protocol==='http:'&&(url.hostname==='127.0.0.1'||film&&url.hostname==='localhost')&&url.origin===value;}catch{return false;}};
/** Called only AFTER Supervisor's fixed upstream closure probe. Per-Host state never
 * shares the operator's ~/.openfilm or another worktree. No global env mutation.
 */
export interface IsolatedStudio extends StartedStudio { readonly childPid:number; isAlive():boolean; }
export async function startIsolatedStudio(input:{vendorRoot:string;runtimeRoot:string}):Promise<IsolatedStudio>{
 let root:string;
 try{root=privateRuntimeRoot(input.runtimeRoot);privateRuntimeRoot(join(root,'home'));privateRuntimeRoot(join(root,'library'));}
 catch{throw unavailable('private_root','OWNERSHIP_UNVERIFIED');}
 const temporaryRoot=privateRuntimeRoot(join(root,'tmp-'+randomUUID()));
 const child=spawn(process.execPath,[fileURLToPath(new URL('./openfilm-studio-child.mjs',import.meta.url)),resolve(input.vendorRoot)],{
  stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,detached:true,
  env:{...process.env,OPENFILM_HOME:join(root,'home'),OPENFILM_LIBRARY:join(root,'library'),OPENFILM_NO_UPDATE_CHECK:'1',TMPDIR:temporaryRoot,NARRALENS_STUDIO_TEMP_ROOT:temporaryRoot},
 });
 // Drain private child output without forwarding upstream provider/path details.
 child.stdout?.resume();child.stderr?.resume();
 let spawnError=false;
 let startIdentity:string|undefined;
 try{if(child.pid)startIdentity=processStart(child.pid);}catch{}
 const leaderAlive=()=>{try{return !!child.pid&&child.exitCode===null&&child.signalCode===null&&startIdentity!==undefined&&processStart(child.pid)===startIdentity;}catch{return false;}};
 const signalLeaderGroup=(signal:NodeJS.Signals)=>{if(leaderAlive())signalProcessGroup(child,signal);};
 const exited=new Promise<void>(resolve=>{child.once('error',()=>{spawnError=true;resolve();});child.once('exit',()=>resolve());});
 let closing:Promise<void>|undefined;
 const close=()=>closing??=(async()=>{
  if(spawnError){await exited;await rm(temporaryRoot,{recursive:true,force:true});return;}
  const force=setTimeout(()=>{if(leaderAlive())signalLeaderGroup('SIGKILL');},5000);force.unref();
  try{
   try{if(child.connected)child.send({kind:'close'},error=>{if(error)signalLeaderGroup('SIGTERM');});else signalLeaderGroup('SIGTERM');}
   catch{signalLeaderGroup('SIGTERM');}
   await exited;
   if(child.pid&&groupExistsOfProcess(child.pid)){
    // After the leader exits, only observe: a numeric PGID is not enduring authority.
    const until=Date.now()+15000;
    while(groupExistsOfProcess(child.pid)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
    if(groupExistsOfProcess(child.pid))throw unavailable('shutdown','GROUP_NOT_QUIESCENT');
   }
  }finally{clearTimeout(force);if(!child.pid||!groupExistsOfProcess(child.pid))await rm(temporaryRoot,{recursive:true,force:true});}
 })();
 try{
  const ready=await new Promise<{origin:string;filmOrigin:string;port:number;key:string}>((resolve,reject)=>{
   const timer=setTimeout(()=>{cleanup();reject(unavailable());},25000);timer.unref();
   const failed=()=>{cleanup();reject(unavailable());};
   const message=(value:unknown)=>{
    if(!value||typeof value!=='object')return failed();const row=value as Record<string,unknown>;
    if(row.kind==='failed') {
     const stage=['configuration','offline_guard','module_load','start_studio','ipc_ready'].includes(String(row.stage))?String(row.stage):'owned_studio';
     const reason=['ENOMEM','EMFILE','ENFILE','EACCES','EPERM','ENOENT','EADDRINUSE','ERR_MODULE_NOT_FOUND','ERR_UNKNOWN_FILE_EXTENSION','UPSTREAM_START_FAILED'].includes(String(row.reason))?String(row.reason):'UNAVAILABLE';
     cleanup();reject(unavailable(stage,reason));return;
    }
    if(row.kind!=='ready'||row.offline_guard!==true||!loopback(row.origin)||!loopback(row.filmOrigin,true)||!Number.isSafeInteger(row.port)||Number(row.port)<=0||Number(row.port)>65535||row.port!==Number(new URL(row.origin).port)||typeof row.key!=='string'||!/^[a-f0-9]{48}$/.test(row.key))return failed();
    cleanup();resolve({origin:row.origin,filmOrigin:row.filmOrigin,port:row.port as number,key:row.key});
   };
   const cleanup=()=>{clearTimeout(timer);child.off('message',message);child.off('error',failed);child.off('close',failed);};
   child.on('message',message);child.once('error',failed);child.once('close',failed);
  });
  if(!Number.isSafeInteger(child.pid)||child.pid!<=0){await close();throw unavailable();}
  return {...ready,close,childPid:child.pid!,isAlive:()=>!closing&&leaderAlive()};
 }catch(error){await close();throw error instanceof HttpError?error:unavailable();}
}
