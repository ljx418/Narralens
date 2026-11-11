import { mkdtemp, mkdir, writeFile, readFile, rename, rm, cp, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import { SnapshotStore, snapshotIdFor } from '../../../src/host/projects/snapshot-store.js';
import { ProjectCreationStore } from '../../../src/host/projects/project-creation-store.js';
import { OperationIdempotencyStore } from '../../../src/host/projects/operation-idempotency-store.js';
import { ImpactStore } from '../../../src/host/impact/impact-store.js';
import { computeSourceDigest } from '../../../src/host/engine/source-digest-v1.js';
import { OPENFILM_UPSTREAM_SHA } from '../../../src/host/engine/engine-binding-store.js';
import { canonicalDigest, canonicalJson } from '../../../src/host/creative/digest.js';
import { CreatedSourceImpactStore } from '../../../src/host/agent-driven/created-source-impact-store.js';
import { CreatedSourceAdoptionStore } from '../../../src/host/agent-driven/created-source-adoption-store.js';
import { CREATED_PUBLICATION_JOURNAL_DDL } from '../../../src/host/agent-driven/created-source-publisher.js';
import { CreatedPublicationIdentityStore } from '../../../src/host/agent-driven/created-publication-identity-store.js';
import { RetainedSourceTree } from '../../../src/host/agent-driven/retained-source-tree.js';
import { preparedAdoptionPlanDigest, type PreparedAdoptionPlanV1 } from '../../../src/host/agent-driven/created-source-ports.js';
import { CreatedPublicationRecoveryFiles, type RecoveryFileLayout } from '../../../src/host/agent-driven/created-publication-recovery-files.js';

// Actual complete trees, original schema/store and OS rename/fsync. Committed-base,
// plan and creation-identity data are explicit component fixtures, NOT native video,
// human approval, actual Host bootstrap or independent business authorization proof.
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture(layout: RecoveryFileLayout | 'original_missing_stage' = 'published') {
 const root = await mkdtemp(join(tmpdir(), 'narralens-recovery-files-')); cleanup.push(() => rm(root,{recursive:true,force:true}));
 const project='project-1',transaction='txn_recovery',createdRoot=join(root,'created'),privateRoot=join(root,'publication');
 const author=join(createdRoot,project,'source'),workspace=join(privateRoot,project,'publication-00000000-0000-4000-8000-000000000001');
 const staging=join(workspace,'staging'),backup=join(workspace,'backup'),quarantine=join(workspace,'rollback-target');
 const ownership={command_id:'create_original',transaction_id:'txn_origin'};
 await mkdir(author,{recursive:true}); await mkdir(staging,{recursive:true});
 await writeFile(join(createdRoot,project,'owner.json'),canonicalJson({kind:'narralens.created-root@1',project_id:project,...ownership}));
 for(const [path,label] of [[author,'original'],[staging,'target']] as const){await mkdir(join(path,'scenes'));await writeFile(join(path,'film.html'),'<p>'+label+'</p>');await writeFile(join(path,'scenes/one.html'),'<p>'+label+' scene</p>');}
 const roots=['film.html','scenes/one.html'];
 const digest=async(path:string)=>(await computeSourceDigest({root:path,roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA})).source_digest;
 const originalDigest=await digest(author),targetDigest=await digest(staging),baseSnapshot=snapshotIdFor(project,originalDigest),targetSnapshot=snapshotIdFor(project,targetDigest);
 const snapshots=new SnapshotStore({snapshotsRoot:join(root,'snapshots')}),container=snapshots.snapshotRoot(project,targetSnapshot),snapshot=join(container,'source');
 await mkdir(container,{recursive:true});await cp(staging,snapshot,{recursive:true});
 const files=async(path:string)=>Promise.all(roots.map(async relative_path=>{const bytes=await readFile(join(path,relative_path));return {relative_path,bytes:bytes.length,sha256:sha(bytes)};}));
 const originalFiles=await files(author),targetFiles=await files(staging);
 const store=new RevisionStore(join(root,'host.sqlite'));cleanup.push(async()=>store.close());new ProjectCreationStore(store);
 store.beginTransaction({transaction_id:ownership.transaction_id,project_id:project,kind:'snapshot_publish',request_json:'{}',request_hash:'a'.repeat(64),base_revision:0,correlation_id:'fixture-base'});
 for(const [from,to]of [['received','preconditions_checked'],['preconditions_checked','staged'],['staged','validated'],['validated','prepared'],['prepared','committed']] as const)store.transition(ownership.transaction_id,from,to,{snapshot_id:baseSnapshot,source_digest_after:originalDigest});
 store.compose(db=>{db.prepare('INSERT INTO snapshot VALUES(?,?,?,?,?)').run(baseSnapshot,project,originalDigest,'openfilm',new Date().toISOString());
  db.prepare('INSERT INTO active_commit VALUES(?,?,?,?,?,?,?)').run(project,1,baseSnapshot,originalDigest,'openfilm',ownership.transaction_id,new Date().toISOString());
  const geometry={schema_version:1,roots,subtitles:[],frame_count:0,fps:{num:30,den:1},assets:[]};
  db.prepare('INSERT INTO created_source_fact VALUES(?,?,?,?)').run(project,baseSnapshot,canonicalJson(geometry),canonicalDigest(geometry));});
 const vector=JSON.parse(readFileSync(new URL('../../../docs/parallel/lane-bridge/A-R2-20261112/golden/d09-plan-vectors.json',import.meta.url),'utf8')).cases.find((x:{expect:string})=>x.expect==='accepted').plan as PreparedAdoptionPlanV1;
 const plan:PreparedAdoptionPlanV1={...vector,project_id:project,base_revision:1,control_revision:0,base_source_digest:originalDigest,target_source_digest:targetDigest,target_snapshot_id:targetSnapshot,roots,files:targetFiles,
  consumer:{...vector.consumer,project_id:project},engine_upstream_sha:OPENFILM_UPSTREAM_SHA};
 const operations=new OperationIdempotencyStore(store.compose(db=>db));const impacts=new CreatedSourceImpactStore(store,new ImpactStore(store,operations));
 const planDigest=preparedAdoptionPlanDigest(plan),impactId='impact_component',approval='approval_component';
 impacts.create({impact_id:impactId,project_id:project,materialization_id:plan.materialization_id,target_snapshot_id:targetSnapshot,base_revision:1,source_digest:originalDigest,control_revision:0,
  engine_upstream_sha:OPENFILM_UPSTREAM_SHA,affected_ranges:plan.affected_ranges,affected_consumers:[],locks_checked:[],rights_digest:'a'.repeat(64),native_plan_sha256:planDigest,approvals_required:[],request_digest:'a'.repeat(64),plan,now:new Date()});
 store.beginTransaction({transaction_id:transaction,project_id:project,kind:'edit',request_json:JSON.stringify({operation:'agent.created_source.apply@1'}),request_hash:'b'.repeat(64),base_revision:1,correlation_id:'fixture-recovery'});
 for(const [from,to]of [['received','preconditions_checked'],['preconditions_checked','staged'],['staged','validated'],['validated','prepared']] as const)store.transition(transaction,from,to);
 new CreatedSourceAdoptionStore(store).record({transaction_id:transaction,project_id:project,prepared_source_id:plan.materialization_id,impact_id:impactId,approval_id:approval,plan_sha256:planDigest,facts_digest:planDigest,
  original_source_digest:originalDigest,target_source_digest:targetDigest,expected_snapshot_id:targetSnapshot,native_plan:plan.native_plan,original_closure:originalFiles,target_closure:targetFiles,
  stage_root:join(root,'producer-source'),backup_token:'backup-component',execution:plan.producer_execution,now:new Date()});
 const identities=new CreatedPublicationIdentityStore(store),original=new RetainedSourceTree(author,originalFiles),target=new RetainedSourceTree(staging,targetFiles),saved=new RetainedSourceTree(snapshot,targetFiles);
 try{store.compose(db=>db.exec(CREATED_PUBLICATION_JOURNAL_DDL));store.atomic(()=>{identities.record({transaction_id:transaction,project_id:project,original_source_digest:originalDigest,target_source_digest:targetDigest,target_snapshot_id:targetSnapshot,
   original_tree:original.identity(),target_tree:target.identity(),snapshot_tree:saved.identity(),snapshot_container:saved.directoryIdentity(container)});
  store.compose(db=>db.prepare('INSERT INTO created_publication_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(transaction+':prepared',project,transaction,plan.materialization_id,'prepared',originalDigest,targetDigest,targetSnapshot,author,backup,staging,canonicalJson(targetFiles),new Date().toISOString()));});}
 finally{original.close();target.close();saved.close();}
 if(['rename_gap','published','rollback_gap','restored'].includes(layout))await rename(author,backup);
 if(['published','rollback_gap','restored'].includes(layout))await rename(staging,author);
 if(['rollback_gap','restored'].includes(layout))await rename(author,quarantine);
 if(layout==='restored')await rename(backup,author);
 if(layout==='original_missing_stage')await rm(staging,{recursive:true});
 const options={revisions:store,snapshots,createdRoot,privateRoot,creationIdentity:(id:string)=>id===project?ownership:null};
 const make=(boundary?:ConstructorParameters<typeof CreatedPublicationRecoveryFiles>[0]['boundary'])=>{const service=new CreatedPublicationRecoveryFiles({...options,...(boundary?{boundary}:{})});cleanup.push(()=>service.close());return service;};
 const authorities=()=>store.compose(db=>({transaction:db.prepare('SELECT state FROM project_transaction WHERE transaction_id=?').get(transaction),active:store.activeCommit(project),identity:db.prepare('SELECT * FROM created_publication_identity').all(),impact:db.prepare('SELECT state FROM impact').all(),outbox:db.prepare('SELECT * FROM outbox').all()}));
 return {root,project,transaction,createdRoot,privateRoot,author,workspace,staging,backup,quarantine,container,snapshot,store,options,make,digest,originalDigest,targetDigest,authorities};
}
it.each(['original','rename_gap','published','rollback_gap','restored','original_missing_stage'] as const)('inspects and durably restores the complete original from %s without business writes',async state=>{
 const f=await fixture(state),service=f.make(),before=f.authorities(),lease=await service.inspect(f.transaction);
 expect(await service.layout(lease)).toBe(state==='original_missing_stage'?'original':state);
 expect(()=>service.assertOriginalRestored(lease)).toThrow(/durability/);
 await service.restoreOriginal(lease);service.assertOriginalRestored(lease);
 expect(await f.digest(f.author)).toBe(f.originalDigest);expect(await service.layout(lease)).toBe(['published','rollback_gap','restored'].includes(state)?'restored':'original');
 expect(f.authorities()).toEqual(before);expect(f.store.projectTransaction(f.transaction)?.state).toBe('prepared');service.release(lease);
});
it.each(['after_target_quarantined','after_original_restored','after_fsync'] as const)('reopens actual renamed trees after compensation itself is interrupted at %s',async boundary=>{
 const f=await fixture(),first=f.make(async phase=>{if(phase===boundary)throw Error('interrupt-'+phase);}),lease=await first.inspect(f.transaction);
 await expect(first.restoreOriginal(lease)).rejects.toThrow('interrupt-'+boundary);expect(()=>first.assertOriginalRestored(lease)).toThrow();first.release(lease);await first.close();
 const fresh=f.make(),next=await fresh.inspect(f.transaction);await fresh.restoreOriginal(next);fresh.assertOriginalRestored(next);
 expect(await f.digest(f.author)).toBe(f.originalDigest);expect(await f.digest(f.quarantine)).toBe(f.targetDigest);fresh.release(next);
});
it.each(['original file','target file','snapshot file','snapshot tree','snapshot container'] as const)('rejects same-byte substituted %s without moving either source',async role=>{
 const f=await fixture(),before=f.authorities();
 const directory=role==='original file'?f.backup:role==='target file'?f.author:f.snapshot;
 if(role.endsWith('file')){const path=join(directory,'film.html');await writeFile(path+'.copy',await readFile(path));await rename(path+'.copy',path);}
 if(role==='snapshot tree'){await rename(f.snapshot,f.snapshot+'-old');await cp(f.snapshot+'-old',f.snapshot,{recursive:true});}
 if(role==='snapshot container'){await rename(f.container,f.container+'-old');await mkdir(f.container);await rename(join(f.container+'-old','source'),f.snapshot);}
 await expect(f.make().inspect(f.transaction)).rejects.toThrow();expect(f.authorities()).toEqual(before);
 expect(await f.digest(f.author)).toBe(f.targetDigest);expect(await f.digest(f.backup)).toBe(f.originalDigest);
});
it('rejects symlink escape, fabricated lease and released authority',async()=>{
 const f=await fixture(),service=f.make(),lease=await service.inspect(f.transaction);
 await expect(service.restoreOriginal(JSON.parse(JSON.stringify(lease)))).rejects.toThrow(/not live/);service.release(lease);
 await expect(service.layout(lease)).rejects.toThrow(/not live/);
 await rename(f.backup,f.backup+'-real');await symlink(f.backup+'-real',f.backup,'dir');await expect(service.inspect(f.transaction)).rejects.toThrow();
});
it('refuses restoration after the database committed, without changing either source',async()=>{
 const f=await fixture(),service=f.make(),lease=await service.inspect(f.transaction);
 f.store.transition(f.transaction,'prepared','committed');await expect(service.restoreOriginal(lease)).rejects.toThrow(/prepared/);
 expect(await f.digest(f.author)).toBe(f.targetDigest);expect(await f.digest(f.backup)).toBe(f.originalDigest);service.release(lease);
});
it('rejects an owner-marker mismatch before changing source',async()=>{
 const f=await fixture(),service=f.make();await writeFile(join(f.createdRoot,f.project,'owner.json'),'foreign-project');await expect(service.inspect(f.transaction)).rejects.toThrow();
 expect(await f.digest(f.author)).toBe(f.targetDigest);expect(await f.digest(f.backup)).toBe(f.originalDigest);
});
it('rejects an added workspace entry at the synchronous abort guard',async()=>{
 const f=await fixture('restored'),service=f.make(),lease=await service.inspect(f.transaction);await service.restoreOriginal(lease);
 await writeFile(join(f.workspace,'unknown'),'not a publication entry');expect(()=>service.assertOriginalRestored(lease)).toThrow(/Unknown/);service.release(lease);
});
it('waits for its own in-flight movement before close, leaving a restartable rollback gap',async()=>{
 const f=await fixture();let entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 const first=f.make(async phase=>{if(phase==='after_target_quarantined'){entered();await gate;}}),lease=await first.inspect(f.transaction);
 const moving=first.restoreOriginal(lease);await arrived;const observed=moving.catch(error=>error);let done=false;const closing=first.close().then(()=>{done=true;});
 await new Promise<void>(r=>setImmediate(r));expect(done).toBe(false);release();expect(await observed).toMatchObject({code:'REVISION_CONFLICT'});await closing;
 const fresh=f.make(),next=await fresh.inspect(f.transaction);expect(await fresh.layout(next)).toBe('rollback_gap');await fresh.restoreOriginal(next);fresh.assertOriginalRestored(next);fresh.release(next);
});

it('rejects a forged journal root with the original immutable schema restored',async()=>{
 const f=await fixture(),other=join(f.root,'foreign-source');await cp(f.author,other,{recursive:true});
 f.store.compose(db=>{const trigger=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_publication_journal_no_update'").get()?.sql);db.exec('DROP TRIGGER created_publication_journal_no_update');
  try{db.prepare('UPDATE created_publication_journal SET author_root=?').run(other);}finally{db.exec(trigger);}});
 const before=await f.digest(other);await expect(f.make().inspect(f.transaction)).rejects.toThrow(/Journal paths/);
 expect(await f.digest(other)).toBe(before);expect(await f.digest(f.author)).toBe(f.targetDigest);expect(await f.digest(f.backup)).toBe(f.originalDigest);
});
it('rejects a changed active base without resetting the pending transaction',async()=>{
 const f=await fixture(),service=f.make(),lease=await service.inspect(f.transaction);f.store.compose(db=>db.prepare('UPDATE active_commit SET revision=revision+1 WHERE project_id=?').run(f.project));
 await expect(service.restoreOriginal(lease)).rejects.toThrow(/base changed/);expect(f.store.projectTransaction(f.transaction)?.state).toBe('prepared');
 expect(await f.digest(f.author)).toBe(f.targetDigest);service.release(lease);
});
it('preserves the primary inspection failure and attempts every acquired resource on cleanup failure',async()=>{
 const f=await fixture(),service=new CreatedPublicationRecoveryFiles(f.options),primary=new Error('inspection fault'),cleanupFault=new Error('snapshot close fault');
 const verify=RetainedSourceTree.prototype.verify,close=RetainedSourceTree.prototype.close;let count=0,failed=false;const attempted=new Set<string>();
 const flatten=(value:unknown):unknown[]=>value&&typeof value==='object'&&'errors' in value&&Array.isArray(value.errors)?value.errors.flatMap(flatten):[value];
 const verifySpy=vi.spyOn(RetainedSourceTree.prototype,'verify').mockImplementation(function(this:RetainedSourceTree){if(this.root===f.backup&&++count===2)throw primary;return verify.call(this);});
 const closeSpy=vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){attempted.add(this.root);if(this.root===f.snapshot&&!failed){failed=true;throw cleanupFault;}return close.call(this);});
 let failure:unknown;
 try{try{await service.inspect(f.transaction);}catch(error){failure=error;}
  expect(new Set(flatten(failure))).toEqual(new Set([primary,cleanupFault]));
  expect(attempted).toEqual(new Set([f.backup,f.author,f.snapshot,join(f.createdRoot,f.project),f.workspace]));
 }finally{verifySpy.mockRestore();closeSpy.mockRestore();let closing:unknown;try{await service.close();}catch(error){closing=error;}
  expect(new Set(flatten(closing))).toEqual(new Set([cleanupFault]));}
});
