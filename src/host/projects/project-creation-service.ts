import {randomUUID} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,rename,realpath,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import type {CreateProject,JobReceipt} from '../../contracts/agent-driven-types.js';
import {ProductError} from '../creative/trusted-context.js';
import {canonicalJson} from '../creative/digest.js';
import {OPENFILM_UPSTREAM_SHA} from '../engine/engine-binding-store.js';
import {FPS_30} from '../engine/time-model.js';
import {PersistentJobStore} from '../persistent-job-store.js';
import {ProjectCreationStore,type CreationReservation,type CreatedSourceFact} from './project-creation-store.js';
import {CreationSourceVerifier} from './creation-source-verifier.js';
import type {ProjectCoordinator} from './project-coordinator.js';
import {SnapshotStore,fsyncPath} from './snapshot-store.js';
import {filmHtml} from './openfilm-migrator.js';

export const CREATION_WORK_BOUNDARIES=['after_lease','after_project_directory','after_owner_claim','after_source','after_snapshot','before_commit','after_commit'] as const;
export type CreationWorkBoundary=(typeof CREATION_WORK_BOUNDARIES)[number];
class CreationInterrupted extends Error{}
class CreationLeaseLost extends Error{}
class CreationCancelled extends Error{}
export interface CreationServiceDeps {
 readonly store:ProjectCreationStore;
 readonly coordinator:ProjectCoordinator;
 readonly snapshots:SnapshotStore;
 readonly verifier:CreationSourceVerifier;
 readonly createdRoot:string;
 readonly leaseMs?:number;
 readonly pollMs?:number;
 /** Observer/crash hook. Production omits it; real crash tests terminate the process here. */
 readonly boundary?:(point:CreationWorkBoundary,reservation:CreationReservation)=>Promise<void>|void;
}
/** A durable Job worker; it creates a fixed empty native draft, never invokes generation. */
export class ProjectCreationService {
 readonly #jobs:PersistentJobStore;
 readonly #owner='creator_'+randomUUID().replaceAll('-','');
 readonly #running=new Map<string,Promise<void>>();
 readonly #retryAfter=new Map<string,number>(); // Scheduling only; SQL remains the state authority.
 readonly #failures:{job_id:string;code:string}[]=[];
 #timer:ReturnType<typeof setInterval>|undefined;
 #closing=false;
 constructor(readonly deps:CreationServiceDeps){
  this.#jobs=new PersistentJobStore(deps.store.revisions);
  if(!Number.isSafeInteger(deps.leaseMs??60000)||(deps.leaseMs??60000)<1000||!Number.isSafeInteger(deps.pollMs??250)||(deps.pollMs??250)<10)throw new Error('Invalid creation worker timing');
 }
 get failures(){return this.#failures.map(row=>({...row}));}
 async create(input:CreateProject,principal:string):Promise<JobReceipt>{
  if(this.#closing)throw new ProductError('CAPABILITY_UNAVAILABLE','The creation worker is stopping');
  const reservation=await this.deps.store.reserve(input,principal);
  return reservation.accepted;
 }
 start():void{
  if(this.#closing||this.#timer)return;
  this.#timer=setInterval(()=>{this.drain();},this.deps.pollMs??250);this.#timer.unref();this.drain();
 }
 drain():void{
  if(this.#closing)return;
  for(const reservation of this.deps.store.pending()){
   if(this.#running.has(reservation.command_id)||(this.#retryAfter.get(reservation.command_id)??0)>Date.now())continue;
   const job=this.deps.store.revisions.readJob(reservation.job_id);
   if(job?.state==='queued'||job?.state==='cancel_requested'||(job?.state==='running'&&job.lease_expires_at!==null&&job.lease_expires_at<=Date.now()))void this.run(reservation.command_id);
  }
 }
 run(commandId:string):Promise<void>{
  const existing=this.#running.get(commandId);if(existing)return existing;
  if(this.#closing)return Promise.resolve();
  const operation=this.execute(commandId).catch(error=>{
   const reservation=this.deps.store.read(commandId);
   if(reservation)this.recordFailure(reservation.job_id,error);
  }).finally(()=>{this.#running.delete(commandId);});
  this.#running.set(commandId,operation);return operation;
 }
 async recoverBeforeGeneric():Promise<void>{
  // Reclaim only OUR expired jobs. Do not use the global reaper before old journal recovery.
  for(const reservation of this.deps.store.pending()){
   await this.deps.store.reclaimExpired(reservation.command_id);
   await this.run(reservation.command_id);
   const current=this.deps.store.read(reservation.command_id);
   if(current&&['reserved','staging','compensating'].includes(current.state)){
    throw new ProductError('CAPABILITY_UNAVAILABLE','Project creation recovery is not settled; another live worker or a retryable dependency still owns it');
   }
  }
 }
 async close():Promise<void>{
  this.#closing=true;if(this.#timer)clearInterval(this.#timer);this.#timer=undefined;
  await Promise.allSettled([...this.#running.values()]);
 }
 private recordFailure(jobId:string,error:unknown):void{
  const raw=error&&typeof error==='object'&&'code' in error?String(error.code):'INTERNAL_ERROR';
  this.#failures.push({job_id:jobId,code:/^[A-Z][A-Z0-9_]{0,63}$/.test(raw)?raw:'INTERNAL_ERROR'});
  if(this.#failures.length>64)this.#failures.shift();
 }
 private async execute(commandId:string):Promise<void>{
  const reservation=this.deps.store.read(commandId);if(!reservation||!['reserved','staging'].includes(reservation.state))return;
  await this.deps.store.reclaimExpired(commandId);
  const prior=this.deps.store.revisions.readJob(reservation.job_id);
  if(prior?.state==='cancel_requested'){
   if(prior.lease_expires_at===null||prior.lease_expires_at<=Date.now())await this.deps.store.fail(commandId,prior.lease_owner,prior.attempt,'INVALID_REQUEST');
   return;
  }
  if(!this.#jobs.acquireLease(reservation.job_id,{owner:this.#owner,leaseMs:this.deps.leaseMs??60000}))return;
  const job=this.#jobs.record(reservation.job_id)!;const identity={owner:this.#owner,attempt:job.attempt};
  let lost=false;
  const heartbeat=setInterval(()=>{try{if(!this.#jobs.renewLease(reservation.job_id,identity,this.deps.leaseMs??60000))lost=true;}catch{lost=true;}},Math.max(250,Math.floor((this.deps.leaseMs??60000)/3)));heartbeat.unref();
  const check=()=>{const current=this.#jobs.record(reservation.job_id);if(current?.state==='cancel_requested'&&current.lease_owner===this.#owner&&current.attempt===identity.attempt)throw new CreationCancelled();if(this.#closing)throw new CreationInterrupted();if(lost||!this.#jobs.holdsLease(reservation.job_id,identity))throw new CreationLeaseLost();};
  const boundary=async(point:CreationWorkBoundary)=>{await this.deps.boundary?.(point,reservation);if(point!=='after_commit')check();};
  try{
   await this.deps.coordinator.controlledWrite(reservation.project_id,reservation.request.meta.correlation_id,async()=>{
    check();await this.deps.store.assertContinuation(commandId);await boundary('after_lease');
    this.deps.store.markStaging(commandId);
    const transaction=this.deps.store.revisions.projectTransaction(reservation.transaction_id)!;
    if(transaction.state==='received')this.deps.store.revisions.transition(reservation.transaction_id,'received','preconditions_checked');
    const source=await this.publishEmptySource(reservation,boundary);check();await boundary('after_source');
    const current=this.deps.store.revisions.projectTransaction(reservation.transaction_id)!;
    if(current.state==='preconditions_checked')this.deps.store.revisions.transition(reservation.transaction_id,'preconditions_checked','staged');
    const snapshot=await this.deps.snapshots.publish({projectId:reservation.project_id,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA,sourceRoot:source,roots:['film.html']});
    check();await boundary('after_snapshot');
    const fact:CreatedSourceFact={schema_version:1,roots:['film.html'],subtitles:[],frame_count:0,fps:{num:30,den:1},assets:[]};
    const proof=await this.deps.verifier.prove(reservation,snapshot,fact);check();
    const state=this.deps.store.revisions.projectTransaction(reservation.transaction_id)!;
    if(state.state==='staged')this.deps.store.revisions.transition(reservation.transaction_id,'staged','validated');
    const validated=this.deps.store.revisions.projectTransaction(reservation.transaction_id)!;
    if(validated.state==='validated')this.deps.store.revisions.transition(reservation.transaction_id,'validated','prepared',{snapshot_id:snapshot.snapshot_id,source_digest_after:snapshot.source_digest});
    await boundary('before_commit');
    await this.deps.store.commit({command_id:commandId,owner:this.#owner,attempt:identity.attempt,snapshot,fact,proof});
    this.#retryAfter.delete(commandId);await boundary('after_commit');
   },reservation.transaction_id);
  }catch(error){
   if(error instanceof CreationCancelled){await this.deps.store.fail(commandId,this.#owner,identity.attempt,'INVALID_REQUEST');return;}
   if(error instanceof CreationLeaseLost)return;
   if(error instanceof CreationInterrupted){this.#jobs.releaseLease(reservation.job_id,this.#owner);return;}
   this.recordFailure(reservation.job_id,error);
   if(error&&typeof error==='object'&&'code' in error&&['HOST_RESOURCE_EXHAUSTED','CAPABILITY_UNAVAILABLE','ENGINE_UNAVAILABLE'].includes(String(error.code))){
    if(this.#jobs.holdsLease(reservation.job_id,identity))this.#jobs.releaseLease(reservation.job_id,this.#owner);
    this.#retryAfter.set(commandId,Date.now()+Math.min(30000,1000*2**Math.min(identity.attempt,5)));return;
   }
   await this.deps.store.fail(commandId,this.#owner,identity.attempt,error&&typeof error==='object'&&'code' in error?String(error.code):'INTERNAL_ERROR');
  }finally{clearInterval(heartbeat);}
 }
 private async publishEmptySource(reservation:CreationReservation,boundary:(point:CreationWorkBoundary)=>Promise<void>):Promise<string>{
  await mkdir(this.deps.createdRoot,{recursive:true});const base=await realpath(this.deps.createdRoot);
  const project=resolve(base,reservation.project_id),source=join(project,'source');
  const owner=canonicalJson({kind:'narralens.created-root@1',project_id:reservation.project_id,command_id:reservation.command_id,transaction_id:reservation.transaction_id});
  try{await mkdir(project);await boundary('after_project_directory');await writeFile(join(project,'owner.json'),owner,{flag:'wx',mode:0o600});await fsyncPath(join(project,'owner.json'));await fsyncPath(project);await fsyncPath(base);await boundary('after_owner_claim');}
  catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='EEXIST'))throw error;}
  if((await lstat(project)).isSymbolicLink()||await realpath(project)!==project||(await readFile(join(project,'owner.json'),'utf8'))!==owner)throw new ProductError('REVISION_CONFLICT','The project directory is not owned by this creation');
  const film=filmHtml([],null,FPS_30,0,{width:1280,height:720});
  try{
   const stat=await lstat(source);if(stat.isSymbolicLink()||!stat.isDirectory()||await realpath(source)!==source||(await readFile(join(source,'film.html'),'utf8'))!==film)throw new ProductError('REVISION_CONFLICT','The recovered author source differs from its fixed creation template');
   return source;
  }catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw error;}
  const staging=join(project,'stage-'+randomUUID());await mkdir(staging);
  try{
   await writeFile(join(staging,'film.html'),film,{flag:'wx',mode:0o600});await fsyncPath(join(staging,'film.html'));await fsyncPath(staging);
   // One durable lease and one project queue own this destination. Existing source is never replaced.
   if(await lstat(source).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw new ProductError('REVISION_CONFLICT','An author source already exists');
   await rename(staging,source);await fsyncPath(project);return source;
  }catch(error){await rm(staging,{recursive:true,force:true}).catch(()=>undefined);throw error;}
 }
}
