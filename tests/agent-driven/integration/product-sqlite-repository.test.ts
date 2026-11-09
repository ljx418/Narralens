import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Brief, IntakePut } from '../../../src/contracts/agent-driven-types.js';
import { validateAgentDefinition } from '../../../src/contracts/agent-driven-validator.js';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import { ProductSqliteRepository } from '../../../src/host/agent-driven/product-sqlite-repository.js';
import { styleDigest } from '../../../src/host/creative/digest.js';
import { CreativeService } from '../../../src/host/creative/creative-service.js';
import { createTrustedCallerContext } from '../../../src/host/creative/trusted-context.js';
import type { ProductEvent, ProductTransaction, IntakeVersionRecord, ProductIdempotencyReceipt } from '../../../src/host/creative/product-repository.js';

const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
const sample=<T>(name:string)=>validateAgentDefinition<T>(name,vectors.vectors.find(v=>v.id===`definition:${name}:valid`)!.value);
const row=(version=1):IntakeVersionRecord=>({intake_id:'intake1',version,principal_id:'principal1',input_digest:'a'.repeat(64),content_json:sample<Brief>('Brief'),created_at:'2026-11-09T00:00:00Z'});
const event:ProductEvent={topic:'creative.intake.versioned',source:'host',scope:{kind:'intake',intake_id:'intake1',intake_version:1,brief_sha256:'a'.repeat(64)},entity:{type:'artifact',id:'intake1',version:1,state:'draft'},attempt:1,input_digest:'a'.repeat(64),observed_at:'2026-11-09T00:00:00Z',payload:{}};
const receipt:ProductIdempotencyReceipt={operation:'test.put',principal_id:'principal1',project_id:null,idempotency_key:'key1',request_digest:'a'.repeat(64),correlation_id:'correlation1'};
const scope={kind:'principal',principal_id:'principal1'} as const;
function fixture(){const store=new RevisionStore();return {store,repo:new ProductSqliteRepository(store)};}
function count(store:RevisionStore,table:string){return store.compose(db=>Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n));}

describe('PRODUCT adapter on the real shared SQLite connection',()=>{
 it('roundtrips immutable typed JSON without a second store and rejects different data at the same key',async()=>{
  const {store,repo}=fixture();try{
   await repo.transaction(tx=>{expect(tx.put('intake_version',{intake_id:'intake1',version:1},row()).replayed).toBe(false);});
   await repo.transaction(tx=>{expect(tx.get('intake_version',{intake_id:'intake1',version:1})).toEqual(row());expect(tx.put('intake_version',{intake_id:'intake1',version:1},row()).replayed).toBe(true);});
   await expect(repo.transaction(tx=>tx.put('intake_version',{intake_id:'intake1',version:1},{...row(),created_at:'changed'}))).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
   expect(count(store,'cp_a0_intake_version')).toBe(1);
  }finally{store.close();}
 });
 it('rolls back version/head/receipt/outbox together on a real SQL failure',async()=>{
  const {store,repo}=fixture();try{
   await expect(repo.transaction(tx=>{
    tx.put('intake_version',{intake_id:'intake1',version:1},row());
    tx.compareAndSet('intake_head',{intake_id:'intake1'},0,{intake_id:'intake1',current_version:1});
    tx.recordIdempotency(scope,'test.put','key1',receipt,{ok:true});
    tx.emit(event);
    // FK failure after ALL preceding effects: proves the same DB transaction owns them.
    tx.compareAndSet('intake_head',{intake_id:'missing'},0,{intake_id:'missing',current_version:999});
   })).rejects.toThrow();
   for(const table of ['cp_a0_intake_version','cp_a0_intake_head','operation_idempotency','outbox'])expect(count(store,table),table).toBe(0);
  }finally{store.close();}
 });
 it('poisons a transaction even if the domain callback catches a failed event mirror or CAS',async()=>{
  const {store,repo}=fixture();try{
   const bad:ProductEvent={...event,scope:{kind:'run',project_id:'project1',run_id:'missing',run_scope_digest:'a'.repeat(64),plan_version:1}};
   await expect(repo.transaction(tx=>{try{tx.emit(bad);}catch{};return 'swallowed';})).rejects.toThrow();
   expect(count(store,'outbox')).toBe(0);expect(count(store,'cp_a0_event')).toBe(0);
   await repo.transaction(tx=>{tx.put('intake_version',{intake_id:'intake1',version:1},row());tx.compareAndSet('intake_head',{intake_id:'intake1'},0,{intake_id:'intake1',current_version:1});});
   await expect(repo.transaction(tx=>{tx.put('intake_version',{intake_id:'intake1',version:2},row(2));try{tx.compareAndSet('intake_head',{intake_id:'intake1'},0,{intake_id:'intake1',current_version:2});}catch{};return 'swallowed';})).rejects.toThrow();
   expect(count(store,'cp_a0_intake_version')).toBe(1);
  }finally{store.close();}
 });
 it('uses a real head CAS and rolls back the new version on stale input',async()=>{
  const {store,repo}=fixture();try{
   await repo.transaction(tx=>{tx.put('intake_version',{intake_id:'intake1',version:1},row());tx.compareAndSet('intake_head',{intake_id:'intake1'},0,{intake_id:'intake1',current_version:1});});
   await expect(repo.transaction(tx=>{tx.put('intake_version',{intake_id:'intake1',version:2},row(2));tx.compareAndSet('intake_head',{intake_id:'intake1'},0,{intake_id:'intake1',current_version:2});})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
   expect(count(store,'cp_a0_intake_version')).toBe(1);
   expect(await repo.transaction(tx=>tx.get('intake_head',{intake_id:'intake1'}))).toEqual({intake_id:'intake1',current_version:1});
  }finally{store.close();}
 });
 it('keeps project and principal scopes disjoint in the ORIGINAL command authority',async()=>{
  const {store,repo}=fixture();try{
   await repo.transaction(tx=>tx.recordIdempotency(scope,'test.put','key1',receipt,{ok:true}));
   expect(await repo.transaction(tx=>tx.recallIdempotency(scope,'test.put','key1'))).toEqual({receipt,response:{ok:true}});
   expect(await repo.transaction(tx=>tx.recallIdempotency({kind:'principal',principal_id:'other'},'test.put','key1'))).toBeNull();
   await expect(repo.transaction(tx=>tx.recallIdempotency({kind:'project',project_id:'principal:principal1'},'test.put','key1'))).rejects.toMatchObject({code:'INVALID_REQUEST'});
   expect(store.compose(db=>db.prepare('SELECT project_id,operation_kind FROM operation_idempotency').get())).toMatchObject({project_id:'principal:principal1',operation_kind:'agent.v1:test.put'});
  }finally{store.close();}
 });
 it('checks the immutable command digest instead of trusting the embedded receipt copy',async()=>{
  const {store,repo}=fixture();try{
   await repo.transaction(tx=>tx.recordIdempotency(scope,'test.put','key1',receipt,{ok:true}));
   const forged={format:'agent.idempotency@1',receipt:{...receipt,request_digest:'b'.repeat(64)},response:{ok:true}};
   store.compose(db=>db.prepare('UPDATE operation_idempotency SET response_json=?').run(JSON.stringify(forged)));
   await expect(repo.transaction(tx=>tx.recallIdempotency(scope,'test.put','key1'))).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  }finally{store.close();}
 });
 it('rejects async callbacks, leaked transactions and nested transactions without committing partial rows',async()=>{
  const {store,repo}=fixture();try{
   let leaked:ProductTransaction|undefined;
   await expect(repo.transaction(async tx=>{leaked=tx;tx.put('intake_version',{intake_id:'intake1',version:1},row());await Promise.resolve();tx.emit(event);})).rejects.toMatchObject({code:'INVALID_REQUEST'});
   await Promise.resolve();
   expect(count(store,'cp_a0_intake_version')).toBe(0);
   expect(()=>leaked!.emit(event)).toThrow();
   await expect(repo.transaction(()=>repo.transaction(()=>undefined))).rejects.toThrow();
   expect(count(store,'outbox')).toBe(0);
  }finally{store.close();}
 });
 it('validates every collection/key/scope and never exposes a global list or arbitrary table name',async()=>{
  const {store,repo}=fixture();try{
   await expect(repo.transaction(tx=>tx.list('intake_version',{} as never))).rejects.toThrow();
   await expect(repo.transaction(tx=>tx.get('intake_version',{intake_id:'intake1'} as never))).rejects.toThrow();
   await expect(repo.transaction(tx=>tx.get('project_state' as never,{} as never))).rejects.toThrow();
   await expect(repo.transaction(tx=>tx.put('event',{} as never,{} as never))).rejects.toThrow();
  }finally{store.close();}
 });
 it('runs the ACTUAL CreativeService against durable SQL and replays unchanged content despite a new correlation id',async()=>{
  const {store,repo}=fixture();try{
   const service=new CreativeService({repository:repo,now:()=>1794229000});
   const caller=createTrustedCallerContext({principal_id:'principal1',channel:'authenticated',source:'driver_relay',session_ref:'session1'});
   const input=structuredClone(sample<IntakePut>('IntakePut'));
   input.intake_id=null;input.base_version=0;
   input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
   const first=await service.putIntake(input,caller);
   const outboxBefore=count(store,'outbox');
   const second=await service.putIntake({...input,meta:{...input.meta,correlation_id:'different-correlation'}},caller);
   expect(second).toEqual(first);expect(count(store,'outbox')).toBe(outboxBefore);
   expect(count(store,'cp_a0_intake_version')).toBe(1);expect(count(store,'operation_idempotency')).toBe(1);
   expect(count(store,'cp_a0_event')).toBe(0); // preproject event is only in authoritative outbox
  }finally{store.close();}
 });
});
