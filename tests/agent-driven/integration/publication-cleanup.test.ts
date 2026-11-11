import {describe,it,expect} from 'vitest';
import {ProductError} from '../../../src/host/creative/trusted-context.js';
import {PublicationCleanup,PublicationCleanupError} from '../../../src/host/agent-driven/publication-cleanup.js';

describe('publication cleanup ownership (no proof/Host/media authority)',()=>{
 it('shares actual resource ownership across multiple cleanup records',()=>{
  const cleanup=new PublicationCleanup(),first={},second={},resource={};let calls=0;
  cleanup.register(first,[{identity:resource,close:()=>{calls++;}}]);
  cleanup.register(second,[{identity:resource,close:()=>{throw new Error('must keep original ownership action');}}]);
  cleanup.drain();expect(calls).toBe(1);expect(cleanup.owners()).toEqual([]);
 });
 it('attempts all actions and retains failures and ownership for reconciliation',()=>{
  const cleanup=new PublicationCleanup(),owner={},first={},second={},events:string[]=[];
  const failure=new Error('first failed');let fail=true;
  cleanup.register(owner,[{identity:first,close:()=>{events.push('first');if(fail)throw failure;}},
   {identity:second,close:()=>{events.push('second');}}]);
  let caught:unknown;try{cleanup.run(owner);}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(PublicationCleanupError);
  expect((caught as PublicationCleanupError).errors).toEqual([failure]);
  expect(events).toEqual(['first','second']);expect(cleanup.owners()).toEqual([owner]);
  fail=false;expect(()=>cleanup.run(owner)).toThrow(PublicationCleanupError);
  expect(events).toEqual(['first','second','first']);
  // A later no-op/success cannot prove an earlier uncertain OS close was settled.
  expect(cleanup.owners()).toEqual([owner]);
 });
 it('deduplicates ownership and does not close successful resources twice',()=>{
  const cleanup=new PublicationCleanup(),owner={},identity={};let calls=0;
  const resource={identity,close:()=>{calls++;}};
  cleanup.register(owner,[resource,resource]);cleanup.run(owner);cleanup.run(owner);cleanup.drain();
  expect(calls).toBe(1);expect(cleanup.owners()).toEqual([]);
 });
 it('a failed owner cannot skip another owners resources',()=>{
  const cleanup=new PublicationCleanup(),events:string[]=[];
  cleanup.register({},[{identity:{},close:()=>{events.push('one');throw new Error('one');}}]);
  cleanup.register({},[{identity:{},close:()=>{events.push('two');}}]);
  expect(()=>cleanup.drain()).toThrow(PublicationCleanupError);expect(events).toEqual(['one','two']);
 });
 it('retains explicit asynchronous workspace cleanup failures without serializing paths',()=>{
  const cleanup=new PublicationCleanup(),owner={},cause=new Error('/private/path denied');
  cleanup.recordFailure(owner,cause);
  let failure:unknown;try{cleanup.run(owner);}catch(error){failure=error;}
  expect((failure as PublicationCleanupError).errors).toEqual([cause]);
  expect(JSON.stringify(failure)).not.toContain('/private/path');
  expect(failure).toBeInstanceOf(ProductError);
  expect(failure).toMatchObject({requires_reconciliation:true,code:'CAPABILITY_UNAVAILABLE',retryable:false,http_status:503});
 });
 it('rejects unsettled thenables and still attempts the following resource',async()=>{
  const cleanup=new PublicationCleanup(),owner={};let next=false;
  cleanup.register(owner,[{identity:{},close:()=>Promise.resolve()}, {identity:{},close:()=>{next=true;}}]);
  expect(()=>cleanup.run(owner)).toThrow(PublicationCleanupError);expect(next).toBe(true);
  await Promise.resolve();expect(()=>cleanup.run(owner)).toThrow(PublicationCleanupError);
 });
});
