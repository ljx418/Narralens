/** Real I/O for the existing LauncherSupervisor; this class is not a second planner. */
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import type {InstanceDiscoveryPort,InstanceLaunchPort,InstanceProbePort,DiscoveredRuntime} from './launcher-types.js';
import {acquireRuntimeLock,readRuntimeState,processStart,RUNTIME_LOCK_FD,type RuntimeState} from '../host/agent-driven/owned-runtime.js';
import {probeRuntime,stopProbedRuntime,type RuntimeProbe} from '../host/agent-driven/runtime-probe.js';
export interface LocalRuntimeConfig {readonly root:string;readonly vendor:string;readonly port:string;readonly lockFd:number|null;readonly allowLaunch:boolean;}
export class LocalRuntimePorts implements InstanceDiscoveryPort,InstanceLaunchPort,InstanceProbePort {
 #locked=false;
 #interrupted=false;
 #child:ChildProcess|undefined;
 #exit:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined;
 #spawnFailed=false;
 #lastProbe:RuntimeProbe|undefined;
 constructor(private readonly config:LocalRuntimeConfig){}
 get authenticatedInstance(){return this.#lastProbe?.instance;}
 private live(state:RuntimeState):boolean{
  try{return processStart(state.pid)===state.process_start;}
  catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'||error instanceof Error&&error.message==='PROCESS_IDENTITY_UNAVAILABLE')return false;throw new Error('PREVIOUS_INSTANCE_LIVENESS_UNKNOWN');}
 }
 private asDiscovered(snapshot:RuntimeProbe):DiscoveredRuntime {
  if(this.#interrupted)throw new Error('RUNTIME_START_CANCELLED');
  this.#lastProbe=snapshot;
  return {last_generation:snapshot.state.generation,running:{instance_id:snapshot.state.instance_id,generation:snapshot.state.generation,ownership:'owned',endpoint:snapshot.connection.origin,pid:snapshot.state.pid,started_at:snapshot.state.started_at,state:'ready'}};
 }
 async discover(input:{runtime_root:string}):Promise<DiscoveredRuntime>{
  if(this.#interrupted)throw new Error('RUNTIME_START_CANCELLED');
  if(input.runtime_root!==this.config.root)throw new Error('RUNTIME_ROOT_MISMATCH');
  if(!this.config.allowLaunch)return this.asDiscovered(await probeRuntime(this.config.root));
  if(this.config.lockFd===null)throw new Error('MISSING_RUNTIME_LOCK');
  const deadline=Date.now()+15000;
  while(true){
   if(this.#interrupted)throw new Error('RUNTIME_START_CANCELLED');
   this.#locked=this.#locked||acquireRuntimeLock(this.config.lockFd);
   if(this.#locked){
    const previous=readRuntimeState(this.config.root);
    if(previous&&previous.state!=='stopped'&&this.live(previous))throw new Error('PREVIOUS_INSTANCE_STILL_ALIVE');
    return {running:null,last_generation:previous?.generation??0};
   }
   try{return this.asDiscovered(await probeRuntime(this.config.root));}catch{}
   if(Date.now()>=deadline)throw new Error('INSTANCE_STARTING_OR_UNVERIFIED');
   await new Promise(r=>setTimeout(r,100));
  }
 }
 async launch(input:{runtime_root:string;instance_id:string;generation:number}):Promise<{pid:number;endpoint:string}>{
  if(this.#interrupted||!this.config.allowLaunch||!this.#locked||this.config.lockFd===null||input.runtime_root!==this.config.root)throw new Error('LAUNCH_NOT_OWNED');
  const support=spawnSync('python3',['-I','-c',"import os,signal; assert hasattr(os,'pidfd_open') and hasattr(signal,'pidfd_send_signal')"],{stdio:'ignore'});
  if(support.error||support.status!==0)throw new Error('SAFE_LOCAL_STOP_UNAVAILABLE');
  const stdio:('inherit'|'ignore'|number)[]=Array.from({length:10},()=> 'ignore');stdio[2]='inherit';stdio[RUNTIME_LOCK_FD]=this.config.lockFd;
  const loader=createRequire(import.meta.url).resolve('tsx/esm');
  const child=spawn(process.execPath,['--import',loader,resolve('src/host/agent-driven/start-runtime.ts'),this.config.root,this.config.vendor,this.config.port],{stdio,env:process.env});
  this.#child=child;
  this.#exit=new Promise(r=>{child.once('error',()=>{this.#spawnFailed=true;r({code:1,signal:null});});child.once('exit',(code,signal)=>r({code,signal}));});
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){
   if(this.#interrupted)throw new Error('RUNTIME_START_CANCELLED');
   if(this.#spawnFailed||child.exitCode!==null||child.signalCode!==null)throw new Error('RUNTIME_PROCESS_TERMINATED');
   let snapshot:RuntimeProbe|undefined;
   try{snapshot=await probeRuntime(this.config.root);}catch{}
   if(snapshot){
    if(snapshot.instance.instance_id!==input.instance_id||snapshot.instance.generation!==input.generation||snapshot.state.pid!==child.pid)throw new Error('LAUNCHED_IDENTITY_MISMATCH');
    this.#lastProbe=snapshot;return {pid:snapshot.state.pid,endpoint:snapshot.connection.origin};
   }
   await new Promise(r=>setTimeout(r,100));
  }
  // Observation timeout is not proof the Host stopped. Retain its inherited lock/root.
  child.unref();throw new Error('INSTANCE_STARTING_OR_UNVERIFIED');
 }
 async probe(instance:{instance_id:string;endpoint:string}){
  if(this.#interrupted)throw new Error('RUNTIME_START_CANCELLED');
  const expected=this.#lastProbe;
  if(!expected||expected.instance.instance_id!==instance.instance_id||expected.connection.origin!==instance.endpoint)throw new Error('UNMAPPED_PROBE_IDENTITY');
  const snapshot=await probeRuntime(this.config.root);
  if(snapshot.instance.instance_id!==instance.instance_id||snapshot.instance.generation!==expected.instance.generation||snapshot.state.pid!==expected.state.pid||snapshot.state.process_start!==expected.state.process_start||snapshot.connection.origin!==instance.endpoint)throw new Error('PROBED_IDENTITY_MISMATCH');
  this.#lastProbe=snapshot;
  // This is API transport readiness. Overall business health stays the real Host's DTO.
  return {ready:true,reason:'authenticated_api_transport_ready',metrics:[]};
 }
 async stop(input:{instance_id:string;generation:number;pid:number|null}):Promise<void>{
  const snapshot=await probeRuntime(this.config.root);
  if(snapshot.instance.instance_id!==input.instance_id||snapshot.instance.generation!==input.generation||snapshot.state.pid!==input.pid)throw new Error('STOP_IDENTITY_CHANGED');
  stopProbedRuntime(this.config.root,snapshot);
  const deadline=Date.now()+10000;
  while(this.live(snapshot.state)){
   if(Date.now()>=deadline)throw new Error('STOP_OUTCOME_UNCONFIRMED');
   await new Promise(r=>setTimeout(r,50));
  }
 }
 forwardSignal(signal:NodeJS.Signals):void {this.#interrupted=true;const child=this.#child;if(child&&child.exitCode===null&&child.signalCode===null)child.kill(signal);}
 async waitForChild(){return this.#exit===undefined?null:await this.#exit;}
}
