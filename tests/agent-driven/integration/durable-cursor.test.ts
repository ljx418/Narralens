import { describe,it,expect } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import { DurableCursorCodec } from '../../../src/host/agent-driven/durable-cursor.js';
import type { CursorClaims } from '../../../src/contracts/agent-driven-types.js';
import { validateAgentDefinition } from '../../../src/contracts/agent-driven-validator.js';
const keys=new Map([['key1',Buffer.alloc(32,7)]]); // Public deterministic TEST fixture, never a production default.
const claims:CursorClaims={principal_id:'principal1',project_id:'project1',filter_digest:'a'.repeat(64),instance_generation:1,outbox_watermark:42,issued_at:'2026-11-09T00:00:00.000Z',expires_at:'2026-11-09T00:10:00.000Z',key_id:'key1'};
const now=()=>Date.parse('2026-11-09T00:01:00.000Z');
describe('durable signed opaque cursors',()=>{
 it('fits BOTH frozen cursor schemas and preserves every claim across actual close/reopen',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'narralens-a-cursor-'));let store:RevisionStore|undefined;
  try{store=new RevisionStore(join(dir,'state.sqlite'));let codec=new DurableCursorCodec(store,keys,now);const token=await codec.sign(claims);
   expect(token).toHaveLength(61);expect(token).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
   expect(()=>validateAgentDefinition('CursorRead',{project_id:'project1',filter_digest:claims.filter_digest,cursor:token,last_event_id:null})).not.toThrow();
   store.close();store=undefined;store=new RevisionStore(join(dir,'state.sqlite'));codec=new DurableCursorCodec(store,keys,now);
   expect(await codec.verify(token)).toEqual(claims);
   expect(store.compose(db=>db.prepare('SELECT count(*) AS n FROM outbox').get()?.n)).toBe(0);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
 });
 it('rejects bare numbers, modified signatures, and valid signatures with altered durable claims',async()=>{
  const store=new RevisionStore();try{const codec=new DurableCursorCodec(store,keys,now),token=await codec.sign(claims);
   await expect(codec.verify('42')).rejects.toMatchObject({code:'INVALID_REQUEST'});
   const bad=token.slice(0,-1)+(token.endsWith('A')?'B':'A');await expect(codec.verify(bad)).rejects.toMatchObject({code:'ORIGIN_REJECTED'});
   store.compose(db=>db.prepare('UPDATE agent_cursor_claim SET claims_json=?').run(JSON.stringify({...claims,project_id:'other'})));
   await expect(codec.verify(token)).rejects.toMatchObject({code:'ORIGIN_REJECTED'});
  }finally{store.close();}
 });
 it('rejects expired receipts at the exact boundary and keys no longer in the configured keyring',async()=>{
  const store=new RevisionStore();try{const token=await new DurableCursorCodec(store,keys,now).sign(claims);
   await expect(new DurableCursorCodec(store,keys,()=>Date.parse(claims.expires_at)).verify(token)).rejects.toMatchObject({code:'CURSOR_EXPIRED'});
   await expect(new DurableCursorCodec(store,new Map([['rotated',Buffer.alloc(32,8)]]),now).verify(token)).rejects.toMatchObject({code:'ORIGIN_REJECTED'});
  }finally{store.close();}
 });
});
