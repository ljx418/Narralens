import {randomUUID} from 'node:crypto';
import type {RevisionStore} from '../projects/revision-store.js';
import type {PersistentJobStore,LeaseIdentity} from '../persistent-job-store.js';
import type {CreatedTaskStore,TaskReservation} from './created-task-store.js';

/** Actual processors MUST validate Run/rights/live bytes and settle using the existing
 * job + workflow/Coordinator authorities. Scheduler never fabricates a success. */
export interface CreatedTaskProcessor {
 execute(task:TaskReservation,lease:LeaseIdentity,signal:AbortSignal):Promise<void>;
 failed(task:TaskReservation,lease:LeaseIdentity,error:unknown):Promise<void>;
}
export interface CreatedTaskWorkerOptions {
 readonly capacity?:number;readonly pollMs?:number;readonly leaseMs?:number;
 readonly diagnostic?:(event:{code:string;job_id:string|null})=>void;
}
/** One scheduler over original durable jobs. The pump never awaits a render: a free
 * slot can start the next job even while another slot is busy. No second queue/DB. */
export class CreatedTaskWorker {
 readonly #owner='created_worker_'+randomUUID().replaceAll('-','');
 readonly #active=new Map<string,{controller:AbortController;done:Promise<void>}>();
 readonly #capacity:number;readonly #leaseMs:number;readonly #pollMs:number;
 #timer:ReturnType<typeof setInterval>|undefined;#closed=false;#pumping=false;#close:Promise<void>|undefined;
 constructor(private readonly revisions:RevisionStore,private readonly tasks:CreatedTaskStore,private readonly jobs:PersistentJobStore,private readonly processor:CreatedTaskProcessor,private readonly options:CreatedTaskWorkerOptions={}){
  this.#capacity=options.capacity??2;this.#leaseMs=options.leaseMs??30000;this.#pollMs=options.pollMs??250;
  if(!Number.isSafeInteger(this.#capacity)||this.#capacity<1||this.#capacity>2||!Number.isSafeInteger(this.#leaseMs)||this.#leaseMs<30||!Number.isSafeInteger(this.#pollMs)||this.#pollMs<1)throw Error('Invalid created task worker configuration');
 }
 start(){if(this.#closed)throw Error('Created task worker is closed');if(this.#timer)return;this.#timer=setInterval(()=>this.drain(),this.#pollMs);this.#timer.unref();this.drain();}
 #diagnostic(code:string,job_id:string|null){
  try{if(this.options.diagnostic){this.options.diagnostic({code,job_id});return;}}catch{/* a broken observer cannot consume a slot */}
  console.error(JSON.stringify({source:'created-task-worker',code,job_id}));
 }
 drain():void {
  if(this.#closed||this.#pumping)return;
  this.#pumping=true;
  try{
   const free=this.#capacity-this.#active.size;if(free<=0)return;
   const queued=this.revisions.compose(db=>db.prepare(`SELECT t.job_id,t.principal_id FROM created_task_input t JOIN job j ON j.job_id=t.job_id WHERE j.state='queued' ORDER BY j.created_at,j.job_id LIMIT ?`).all(this.#capacity));
   for(const row of queued){
    if(this.#active.size>=this.#capacity)break;
    const id=String(row.job_id);if(this.#active.has(id))continue;
    try{
     const task=this.tasks.read(id,String(row.principal_id));
     if(!this.jobs.acquireLease(id,{owner:this.#owner,leaseMs:this.#leaseMs}))continue;
     const job=this.revisions.readJob(id);if(!job||job.lease_owner!==this.#owner||job.state!=='running')throw Error('Acquired task lease disappeared');
     const lease={owner:this.#owner,attempt:job.attempt},controller=new AbortController();
     // Register before entering any processor or observer. Synchronous throws and
     // immediate resolve must still release exactly this registered slot.
     const done=Promise.resolve().then(()=>this.#execute(task,lease,controller)).finally(()=>{this.#active.delete(id);if(!this.#closed)queueMicrotask(()=>this.drain());});
     this.#active.set(id,{controller,done});
    }catch{this.#diagnostic('TASK_CLAIM_FAILED',id);}
   }
  }catch{this.#diagnostic('TASK_QUEUE_READ_FAILED',null);}
  finally{this.#pumping=false;}
 }
 async #execute(task:TaskReservation,lease:LeaseIdentity,controller:AbortController):Promise<void>{
  const heartbeat=setInterval(()=>{
   try{if(!this.jobs.renewLease(task.job_id,lease,this.#leaseMs))controller.abort(Error('Task lease lost'));}
   catch{controller.abort(Error('Task lease renewal unavailable'));this.#diagnostic('TASK_LEASE_RENEWAL_FAILED',task.job_id);}
  },Math.max(1,Math.floor(this.#leaseMs/3)));heartbeat.unref();
  try{
   if(controller.signal.aborted)throw controller.signal.reason;
   if(!this.jobs.holdsLease(task.job_id,lease))throw Error('Task lease is no longer current');
   await this.processor.execute(task,lease,controller.signal);
   const current=this.revisions.readJob(task.job_id);
   if(current?.lease_owner===lease.owner&&current.attempt===lease.attempt&&(current.state==='cancel_requested'||!this.#closed&&current.state==='running'))throw Error('Task processor returned without durable settlement');
  }catch(error){
   try{
    const before=this.revisions.readJob(task.job_id);
    const ownedCancellation=before?.state==='cancel_requested'&&before.lease_owner===lease.owner&&before.attempt===lease.attempt;
    // Shutdown alone requeues unfinished local work; an actual user cancellation
    // must still converge through its original callback authority before DB close.
    if(!this.#closed||ownedCancellation){
     await this.processor.failed(task,lease,error);
     const after=this.revisions.readJob(task.job_id);
     if(after?.lease_owner===lease.owner&&after.attempt===lease.attempt&&['running','cancel_requested'].includes(after.state))this.#diagnostic('TASK_PROCESSOR_NOT_SETTLED',task.job_id);
    }
   }catch{this.#diagnostic('TASK_FAILURE_SETTLEMENT_FAILED',task.job_id);}
  }finally{
   clearInterval(heartbeat);
   // Closing retains restartable work rather than converting it to success. Release
   // only this live identity; a reclaimed lease or user cancellation stays untouched.
   if(this.#closed){try{if(this.jobs.holdsLease(task.job_id,lease))this.jobs.releaseLease(task.job_id,lease.owner);}catch{this.#diagnostic('TASK_SHUTDOWN_RELEASE_FAILED',task.job_id);}}
  }
 }
 close():Promise<void>{
  if(this.#close)return this.#close;
  this.#closed=true;if(this.#timer)clearInterval(this.#timer);this.#timer=undefined;
  for(const running of this.#active.values())running.controller.abort(Error('Created task worker stopping'));
  // The Host must await this before closing SQLite. No five-second detach: media
  // processes/processor cleanup must acknowledge cancellation before DB disposal.
  return this.#close=Promise.allSettled([...this.#active.values()].map(entry=>entry.done)).then(()=>undefined);
 }
 get activeCount(){return this.#active.size;}
}
