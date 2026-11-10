import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {TaskPrepare} from '../../../src/contracts/agent-driven-types.js';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {PersistentJobStore} from '../../../src/host/persistent-job-store.js';
import {CreatedTaskStore} from '../../../src/host/agent-driven/created-task-store.js';
import {CreatedTaskWorker,type CreatedTaskProcessor} from '../../../src/host/agent-driven/created-task-worker.js';
const vector=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')).vectors.find((v:{id:string})=>v.id==='definition:TaskPrepare:valid').value as TaskPrepare;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>boolean){const end=Date.now()+5000;while(!check()&&Date.now()<end)await sleep(10);expect(check()).toBe(true);}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
/** Scheduler tests on actual original SQLite/lease CAS, with explicitly fixture-only
 * reservation authority/processors; no production media, Run grant or film claim. */
function fixture(){
 const revisions=new RevisionStore(),jobs=new PersistentJobStore(revisions),tasks=new CreatedTaskStore(revisions,{assertAllowed:()=>{},bindStep:()=>{},assertPrepared:()=>{throw Error('no prepared producer');}});
 const reserve=(name:string)=>{const input=structuredClone(vector);input.meta.idempotency_key=name;input.execution.run_id=name;return tasks.reserve(input,'owner',{job_kind:'snapshot_publish',max_attempts:3}).task;};
 return {revisions,jobs,tasks,reserve};
}
it('starts another queued job when one slot frees while a different processor remains busy',async()=>{
 const f=fixture(),one=f.reserve('one'),two=f.reserve('two'),three=f.reserve('three'),gates=new Map([one,two,three].map(t=>[t.job_id,deferred()])),started:string[]=[];
 const processor:CreatedTaskProcessor={execute:async(task,lease)=>{started.push(task.job_id);await gates.get(task.job_id)!.promise;f.jobs.recordCallback(task.job_id,lease,{state:'succeeded'});},failed:async()=>{throw Error('unexpected');}};
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,processor,{pollMs:10});
 try{
  worker.start();await until(()=>started.length===2);const finished=started[0]!,blocked=started[1]!;gates.get(finished)!.resolve();await until(()=>started.length===3);
  expect(f.revisions.readJob(blocked)?.state).toBe('running');expect(f.revisions.readJob(finished)?.state).toBe('succeeded');
  for(const gate of gates.values())gate.resolve();await until(()=>worker.activeCount===0);
 }finally{for(const gate of gates.values())gate.resolve();await worker.close();f.revisions.close();}
});
it('renews the real lease during a long processor and only the current lease can settle',async()=>{
 const f=fixture(),task=f.reserve('long'),finish=deferred();let started=false;
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async(t,l)=>{started=true;await finish.promise;expect(f.jobs.holdsLease(t.job_id,l)).toBe(true);f.jobs.recordCallback(t.job_id,l,{state:'succeeded'});},failed:async(t,l)=>{f.jobs.recordCallback(t.job_id,l,{state:'failed'});}},{pollMs:10,leaseMs:600});
 try{worker.start();await until(()=>started);const first=f.revisions.readJob(task.job_id)!;await sleep(900);expect(f.revisions.readJob(task.job_id)?.lease_expires_at).toBeGreaterThan(first.lease_expires_at!);finish.resolve();await until(()=>worker.activeCount===0);expect(f.revisions.readJob(task.job_id)?.state).toBe('succeeded');}
 finally{finish.resolve();await worker.close();f.revisions.close();}
});
it('awaits aborted processor cleanup before close and returns its live unfinished lease to queued',async()=>{
 const f=fixture(),task=f.reserve('shutdown'),cleanup=deferred();let signalled=false,started=false,failed=false;
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async(_t,_l,signal)=>{started=true;await new Promise<void>(r=>signal.addEventListener('abort',()=>{signalled=true;r();},{once:true}));await cleanup.promise;},failed:async()=>{failed=true;}},{pollMs:10});
 try{worker.start();await until(()=>started);let closed=false;const closing=worker.close().then(()=>{closed=true;});await until(()=>signalled);await sleep(20);expect(closed).toBe(false);expect(f.revisions.readJob(task.job_id)?.state).toBe('running');cleanup.resolve();await closing;expect(failed).toBe(false);expect(f.revisions.readJob(task.job_id)).toMatchObject({state:'queued',lease_owner:null});expect(worker.activeCount).toBe(0);expect(()=>worker.start()).toThrow();}
 finally{cleanup.resolve();await worker.close();f.revisions.close();}
});
it('never executes a processor after close immediately follows synchronous claiming',async()=>{
 const f=fixture(),task=f.reserve('immediate');let calls=0;
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async()=>{calls++;},failed:async()=>{calls++;}});
 try{worker.start();await worker.close();expect(calls).toBe(0);expect(f.revisions.readJob(task.job_id)?.state).toBe('queued');}
 finally{await worker.close();f.revisions.close();}
});
it('settles a synchronous/async processor fault through its explicit original-job authority and frees its slot even if diagnostics throw',async()=>{
 const f=fixture(),one=f.reserve('fault1'),two=f.reserve('fault2');let failed=0;
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:()=>{throw Error('processor fault');},failed:async(task,lease)=>{failed++;f.jobs.recordCallback(task.job_id,lease,{state:'failed',terminalReason:'fixture failure'});}},{capacity:1,pollMs:10,diagnostic:()=>{throw Error('observer');}});
 try{worker.start();await until(()=>failed===2&&worker.activeCount===0);expect(f.revisions.readJob(one.job_id)?.state).toBe('failed');expect(f.revisions.readJob(two.job_id)?.state).toBe('failed');}
 finally{await worker.close();f.revisions.close();}
});
it('refuses an un-settled processor return instead of inventing success',async()=>{
 const f=fixture(),task=f.reserve('no-settlement');let error='';
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async()=>{},failed:async(t,l,e)=>{error=String(e);f.jobs.recordCallback(t.job_id,l,{state:'failed'});}});
 try{worker.start();await until(()=>worker.activeCount===0&&f.revisions.readJob(task.job_id)?.state==='failed');expect(error).toContain('without durable settlement');}
 finally{await worker.close();f.revisions.close();}
});
it('aborts a reclaimed lease and quarantines its late result before the queued task is taken with a new attempt',async()=>{
 const f=fixture(),task=f.reserve('reclaimed');let calls=0,aborted=false,oldQuarantined=false;
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async(t,l,signal)=>{
  calls++;
  if(l.attempt===1){await new Promise<void>(r=>signal.addEventListener('abort',()=>{aborted=true;r();},{once:true}));oldQuarantined=f.jobs.recordCallback(t.job_id,l,{state:'succeeded',artifact:{late:'fixture'}}).quarantined;}
  else f.jobs.recordCallback(t.job_id,l,{state:'succeeded'});
 },failed:async()=>{throw Error('unexpected failure');}},{pollMs:10,leaseMs:600});
 try{
  worker.start();await until(()=>calls===1);expect(f.jobs.reapExpiredLeases(new Date(Date.now()+1000)).find(row=>row.job_id===task.job_id)?.requeued).toBe(true);
  await until(()=>calls===2&&worker.activeCount===0);expect(aborted).toBe(true);expect(oldQuarantined).toBe(true);expect(f.revisions.readJob(task.job_id)).toMatchObject({state:'succeeded',attempt:2});
 }finally{await worker.close();f.revisions.close();}
});
it('signals actual job cancellation and never adopts the processor result that arrives afterwards',async()=>{
 const f=fixture(),task=f.reserve('cancelled');let started=false,aborted=false,quarantined=false;
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async(t,l,signal)=>{started=true;await new Promise<void>(r=>signal.addEventListener('abort',()=>{aborted=true;r();},{once:true}));quarantined=f.jobs.recordCallback(t.job_id,l,{state:'succeeded',artifact:{late:'fixture'}}).quarantined;},failed:async()=>{throw Error('unexpected failure');}},{pollMs:10,leaseMs:600});
 try{worker.start();await until(()=>started);f.jobs.requestCancel(task.job_id);await until(()=>worker.activeCount===0);expect(aborted).toBe(true);expect(quarantined).toBe(true);expect(f.revisions.readJob(task.job_id)?.state).toBe('cancelled');}
 finally{await worker.close();f.revisions.close();}
});
it('settles cancellation when the processor returns after abort without a result',async()=>{
 const f=fixture(),task=f.reserve('cancel-no-result');let started=false,failures=0;
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async(_t,_l,signal)=>{started=true;await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));},failed:async(t,l)=>{failures++;f.jobs.recordCallback(t.job_id,l,{state:'cancelled'});}},{pollMs:10,leaseMs:600});
 try{worker.start();await until(()=>started);f.jobs.requestCancel(task.job_id);await until(()=>worker.activeCount===0);expect(failures).toBe(1);expect(f.revisions.readJob(task.job_id)?.state).toBe('cancelled');}
 finally{await worker.close();f.revisions.close();}
});
it('finishes user cancellation through its authority even when shutdown begins next to it',async()=>{
 const f=fixture(),task=f.reserve('cancel-then-close'),cleanup=deferred();let started=false,settling=false;
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async(_t,_l,signal)=>{started=true;await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));},failed:async(t,l)=>{settling=true;await cleanup.promise;f.jobs.recordCallback(t.job_id,l,{state:'cancelled'});}},{pollMs:10});
 try{worker.start();await until(()=>started);f.jobs.requestCancel(task.job_id);let closed=false;const closing=worker.close().then(()=>{closed=true;});await sleep(20);expect(settling).toBe(true);expect(closed).toBe(false);cleanup.resolve();await closing;expect(f.revisions.readJob(task.job_id)?.state).toBe('cancelled');}
 finally{cleanup.resolve();await worker.close();f.revisions.close();}
});
it('reports an explicit processor contract violation when its failure handler also returns without settlement',async()=>{
 const f=fixture(),task=f.reserve('no-failure-settlement'),diagnostics:string[]=[];
 const worker=new CreatedTaskWorker(f.revisions,f.tasks,f.jobs,{execute:async()=>{throw Error('fixture failure');},failed:async()=>{}},{diagnostic:event=>{diagnostics.push(event.code);}});
 try{worker.start();await until(()=>worker.activeCount===0);expect(diagnostics).toContain('TASK_PROCESSOR_NOT_SETTLED');expect(f.revisions.readJob(task.job_id)?.state).toBe('running');}
 finally{await worker.close();f.revisions.close();}
});
