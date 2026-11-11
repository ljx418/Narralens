import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {OperationIdempotencyStore} from '../../../src/host/projects/operation-idempotency-store.js';
import {ImpactStore} from '../../../src/host/impact/impact-store.js';
import {CreatedSourceImpactStore,type CreateCreatedImpactInput} from '../../../src/host/agent-driven/created-source-impact-store.js';
import {preparedAdoptionPlanDigest,type PreparedAdoptionPlanV1} from '../../../src/host/agent-driven/created-source-ports.js';

// Real SQLite only: no Host, worker, media tools, browser or runtime roots.
function fixture(){
 const revisions=new RevisionStore(':memory:');
 const operations=new OperationIdempotencyStore(revisions.compose(db=>db));
 const impacts=new CreatedSourceImpactStore(revisions,new ImpactStore(revisions,operations));
 const vectors=JSON.parse(readFileSync(new URL('../../../docs/parallel/lane-bridge/A-R2-20261112/golden/d09-plan-vectors.json',import.meta.url),'utf8')) as {cases:{expect:string;plan:PreparedAdoptionPlanV1}[]};
 const plan=structuredClone(vectors.cases.find(c=>c.expect==='accepted')!.plan);
 const now=new Date(Date.parse(plan.expires_at)-900000);
 const input:CreateCreatedImpactInput={impact_id:'imp_actual_atomic',project_id:plan.project_id,materialization_id:plan.materialization_id,
  target_snapshot_id:plan.target_snapshot_id,base_revision:plan.base_revision,source_digest:plan.base_source_digest,
  control_revision:plan.control_revision,engine_upstream_sha:plan.engine_upstream_sha,affected_ranges:plan.affected_ranges,
  affected_consumers:[{kind:'native',id:plan.consumer.consumer_id,action:'replace'}],locks_checked:plan.locks_checked,
  rights_digest:'a'.repeat(64),native_plan_sha256:preparedAdoptionPlanDigest(plan),approvals_required:['change.approve'],
  request_digest:'b'.repeat(64),plan,now};
 const remember=(response:unknown)=>operations.record({projectId:plan.project_id,operationKind:'agent.v1:change.prepare',
  idempotencyKey:'same-key',requestDigest:input.request_digest,response,transactionId:input.impact_id,now});
 const counts=()=>revisions.compose(db=>({impact:Number(db.prepare('SELECT count(*) AS n FROM impact').get()!.n),
  fact:Number(db.prepare('SELECT count(*) AS n FROM created_impact_fact').get()!.n),
  response:Number(db.prepare('SELECT count(*) AS n FROM operation_idempotency').get()!.n)}));
 return {revisions,operations,impacts,input,remember,counts};
}

describe('created impact and response share the original SQLite transaction',()=>{
 it('refuses an insertion without an outer Host transaction',()=>{
  const f=fixture();try{expect(()=>f.impacts.insertInTransaction(f.input)).toThrow(/Host transaction/);
   expect(f.counts()).toEqual({impact:0,fact:0,response:0});}finally{f.revisions.close();}
 });
 it('rolls back impact, immutable plan and response when the final caller boundary fails',()=>{
  const f=fixture();try{expect(()=>f.revisions.atomic(()=>{const impact=f.impacts.insertInTransaction(f.input);f.remember(impact);throw Error('after response');})).toThrow('after response');
   expect(f.counts()).toEqual({impact:0,fact:0,response:0});}finally{f.revisions.close();}
 });
 it('does not leave an active impact when a real response-key constraint fails',()=>{
  const f=fixture();try{f.revisions.atomic(()=>f.remember({original:true}));
   expect(()=>f.revisions.atomic(()=>{const impact=f.impacts.insertInTransaction(f.input);f.remember(impact);})).toThrow();
   expect(f.counts()).toEqual({impact:0,fact:0,response:1});}finally{f.revisions.close();}
 });
 it('commits all three records together and releases the transaction',()=>{
  const f=fixture();try{const impact=f.revisions.atomic(()=>{const row=f.impacts.insertInTransaction(f.input);f.remember(row);return row;});
   expect(f.counts()).toEqual({impact:1,fact:1,response:1});
   expect(f.revisions.compose(db=>db.isTransaction)).toBe(false);
   expect(f.impacts.read(impact.impact_id)).toEqual(impact);
   expect(JSON.parse(f.operations.recall(f.input.project_id,'agent.v1:change.prepare','same-key')!.response_json)).toEqual(impact);
  }finally{f.revisions.close();}
 });
 it('keeps the standalone create entry atomic for existing callers',()=>{
  const f=fixture();try{expect(f.impacts.create(f.input).impact_id).toBe(f.input.impact_id);
   expect(f.counts()).toEqual({impact:1,fact:1,response:0});
   expect(f.revisions.compose(db=>db.isTransaction)).toBe(false);
  }finally{f.revisions.close();}
 });
});
