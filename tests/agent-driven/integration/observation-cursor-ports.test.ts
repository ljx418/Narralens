import { describe,it,expect } from 'vitest';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import { DurableCursorCodec } from '../../../src/host/agent-driven/durable-cursor.js';
import { observationCursorPorts } from '../../../src/host/agent-driven/observation-cursor-ports.js';
import { verifyCursor, rejectionToCode, CursorRejection } from '../../../src/host/observability/cursor.js';
import type { CursorClaims } from '../../../src/contracts/agent-driven-types.js';
const claims:CursorClaims={principal_id:'principal1',project_id:'project1',filter_digest:'a'.repeat(64),instance_generation:1,outbox_watermark:42,issued_at:'2026-11-09T00:00:00.000Z',expires_at:'2026-11-09T00:10:00.000Z',key_id:'key1'};
const scope={principal_id:claims.principal_id,project_id:claims.project_id,filter_digest:claims.filter_digest,instance_generation:1};
const keys=new Map([['key1',Buffer.alloc(32,7)]]);
describe('real durable cursor to BRIDGE verification contract',()=>{
 it('rejects a foreign expired token as scope mismatch before reporting expiry',async()=>{
  const store=new RevisionStore();try{
   const token=await new DurableCursorCodec(store,keys,()=>Date.parse(claims.issued_at)).sign(claims);
   const codec=new DurableCursorCodec(store,keys,()=>Date.parse(claims.expires_at));
   const ports=observationCursorPorts(codec,'key1');
   await expect(verifyCursor(ports.verification,token,{scope:{...scope,principal_id:'other'},nowMs:Date.parse(claims.expires_at)})).rejects.toMatchObject({kind:'scope_mismatch'});
   await expect(verifyCursor(ports.verification,token,{scope,nowMs:Date.parse(claims.expires_at)})).rejects.toMatchObject({kind:'expired'});
  }finally{store.close();}
 });
 it('checks scope before refusing a future-issued signed token, and never accepts it in its own scope',async()=>{
  const store=new RevisionStore();try{
   const future={...claims,issued_at:'2026-11-09T00:05:00.000Z'};
   const token=await new DurableCursorCodec(store,keys,()=>Date.parse(future.issued_at)).sign(future);
   const ports=observationCursorPorts(new DurableCursorCodec(store,keys,()=>Date.parse(claims.issued_at)),'key1');
   await expect(verifyCursor(ports.verification,token,{scope:{...scope,principal_id:'other'},nowMs:Date.parse(claims.issued_at)})).rejects.toMatchObject({kind:'scope_mismatch'});
   await expect(verifyCursor(ports.verification,token,{scope,nowMs:Date.parse(claims.issued_at)})).rejects.toMatchObject({kind:'not_yet_valid'});
  }finally{store.close();}
 });
 it('preserves malformed400 and tampered403 instead of flattening all codec failures',async()=>{
  const store=new RevisionStore();try{
   const codec=new DurableCursorCodec(store,keys,()=>Date.parse(claims.issued_at));const ports=observationCursorPorts(codec,'key1');
   for(const [token,code] of [['42','INVALID_REQUEST'],['c'+'a'.repeat(16)+'_'+'a'.repeat(43),'ORIGIN_REJECTED']]){
    try{await verifyCursor(ports.verification,token!,{scope,nowMs:Date.parse(claims.issued_at)});throw new Error('accepted bad cursor');}
    catch(error){expect(error).toBeInstanceOf(CursorRejection);expect(rejectionToCode((error as CursorRejection).kind)).toBe(code);}
   }
  }finally{store.close();}
 });
});
