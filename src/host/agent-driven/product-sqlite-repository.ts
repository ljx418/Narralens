import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { canonicalJson } from '../engine/source-digest-v1.js';
import { RevisionStore } from '../projects/revision-store.js';
import { OperationIdempotencyStore } from '../projects/operation-idempotency-store.js';
import {isCurrentTaskTransaction,type TaskTransactionDb} from './created-task-store.js';
import { applyAgentSchema } from './agent-schema.js';
import {
  PRODUCT_COLLECTIONS,
  type ProductCollection, type ProductRecordKeys, type ProductRecordScopes, type ProductRecords,
  type ProductHeadCollection, type ProductRepository, type ProductTransaction, type ProductEvent,
  type ProductIdempotencyScope, type ProductIdempotencyEntry, type ProductIdempotencyReceipt,
} from '../creative/product-repository.js';

export class AgentDataError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'CAPABILITY_UNAVAILABLE', message: string) { super(message); }
}
const conflict = () => new AgentDataError('REVISION_CONFLICT', 'Stored facts or version no longer match');
const invalid = () => new AgentDataError('INVALID_REQUEST', 'Invalid persistence operation');
const scopes: Record<ProductCollection, { required: readonly string[]; optional?: readonly string[] }> = {
  intake_version: {required:['intake_id']}, intake_head:{required:['intake_id']},
  intake_content_decision:{required:['intake_id'],optional:['intake_version']}, intake_confirmation:{required:['intake_id']},
  question_version:{required:['intake_id','intake_version'],optional:['question_id']}, question_head:{required:['intake_id','intake_version']},
  answer_version:{required:['intake_id','intake_version','question_id'],optional:['question_version']}, answer_head:{required:['intake_id','intake_version','question_id']},
  template_version:{required:['template_id']}, template_head:{required:['template_id']},
  artifact_version:{required:['project_id'],optional:['artifact_id']}, artifact_head:{required:['project_id']},
  run:{required:['project_id'],optional:['run_id']}, plan_version:{required:['project_id','run_id']},
  review_request:{required:['project_id','run_id']}, content_decision:{required:['project_id','run_id']}, trusted_confirmation:{required:['project_id','run_id']},
  execution_grant:{required:['project_id','run_id']}, step_attempt:{required:['project_id','run_id'],optional:['plan_version','step_id']},
  approval:{required:['project_id','run_id']}, prepared_authorization:{required:['project_id'],optional:['run_id']},
  bootstrap_command:{required:['principal_id','operation']}, project_origin:{required:['project_id']}, native_ack:{required:['project_id','editor_session_id']}, event:{required:['project_id']},
};
const mutable: Partial<Record<ProductCollection, readonly string[]>> = {
  run:['state','checkpoint_json'], review_request:['state','reuse_review_id'], execution_grant:['state'],
  step_attempt:['state','job_id','output_artifact_id','output_version','updated_at'], approval:['state','consumed_transaction_id'],
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw invalid();
  return value as Record<string,unknown>;
};
const scalar = (value: unknown): SQLInputValue => {
  if (value === null || typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw invalid();
};
const quote = (name: string) => { if(!/^[a-z][a-z0-9_]*$/.test(name)) throw invalid(); return `"${name}"`; };
const encode = (column:string,value:unknown): SQLInputValue => column.endsWith('_json') && value!==null ? canonicalJson(value) : scalar(value);
const decode = (row:Record<string,unknown>):Record<string,unknown> => Object.fromEntries(Object.entries(row).map(([k,v])=>[k,k.endsWith('_json')&&v!==null?JSON.parse(String(v)):v]));

/** Closed table-specific adapter, over the SAME RevisionStore connection and command ledger. */
export class ProductSqliteRepository implements ProductRepository {
  readonly #db: DatabaseSync;
  readonly #commands: OperationIdempotencyStore;
  #inside = false;
  #poison:((error:unknown)=>void)|undefined;
  #schemaVersion = 0;
  constructor(private readonly revisions: RevisionStore) {
    this.#db = revisions.compose(db => { applyAgentSchema(db); return db; });
    this.#commands = new OperationIdempotencyStore(this.#db);
    this.#schemaVersion = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
  }
  transaction<T>(work:(tx:ProductTransaction)=>T):Promise<T> {
    if(this.#inside){const error=invalid();this.#poison?.(error);throw error;}
    try{return Promise.resolve(this.revisions.atomic(()=>this.scope(work)));}
    catch(error){return Promise.reject(error);}
  }
  /** Join only the live same-connection TaskStore scope. No BEGIN, promise or leaked tx.
   * The enclosing task capability is poisoned even if a composition hook catches failure. */
  joinTaskTransaction<T>(rows:TaskTransactionDb,work:(tx:ProductTransaction)=>T):T {
    if(!isCurrentTaskTransaction(rows,this.#db)||!this.#db.isTransaction)throw invalid();
    return rows.within(()=>this.scope(work));
  }
  private scope<T>(work:(tx:ProductTransaction)=>T):T {
    if (this.#inside) {const error=invalid();this.#poison?.(error);throw error;}
    let live = true,poisoned=false;
    let fault:unknown;
    this.#poison=error=>{poisoned=true;fault=error;};
    const guarded=<V>(operation:()=>V):V=>{
      if(!live)throw invalid();
      if(poisoned)throw fault;
      try{return operation();}catch(error){poisoned=true;fault=error;throw error;}
    };
    try {
      const current = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
      if(current!==this.#schemaVersion){applyAgentSchema(this.#db);this.#schemaVersion=current;}
      this.#inside=true;
      const result=(()=>{
        const tx:ProductTransaction={
          get:(c,k)=>guarded(()=>this.read(c,k)),
          list:(c,s)=>guarded(()=>this.list(c,s)),
          put:(c,k,v)=>guarded(()=>this.write(c,k,v)),
          compareAndSet:(c,k,n,v)=>guarded(()=>this.cas(c,k,n,v)),
          recallIdempotency:(s,o,k)=>guarded(()=>this.recall(s,o,k)),
          recordIdempotency:(s,o,k,r,v)=>guarded(()=>this.remember(s,o,k,r,v)),
          emit:e=>guarded(()=>this.emit(e)),
        };
        const value=work(tx);
        if(value && typeof (value as {then?:unknown}).then==='function') {
          void Promise.resolve(value).catch(()=>{});
          throw invalid();
        }
        if(poisoned)throw fault;
        return value;
      })();
      return result;
    } catch(error){ throw error; }
    finally {live=false;this.#inside=false;this.#poison=undefined;}
  }
  private spec(c:ProductCollection) {
    if(!Object.hasOwn(PRODUCT_COLLECTIONS,c)) throw invalid();
    return PRODUCT_COLLECTIONS[c];
  }
  private where(columns:readonly string[], key:unknown) {
    const value=object(key);
    if(Object.keys(value).length!==columns.length || columns.some(c=>!Object.hasOwn(value,c)||value[c]===null)) throw invalid();
    return {sql:columns.map(c=>`${quote(c)}=?`).join(' AND '),values:columns.map(c=>scalar(value[c]))};
  }
  private read<K extends ProductCollection>(c:K,key:ProductRecordKeys[K]):ProductRecords[K]|null {
    const spec=this.spec(c),where=this.where(spec.primaryKey,key);
    const row=this.#db.prepare(`SELECT * FROM ${quote(spec.table)} WHERE ${where.sql}`).get(...where.values);
    return row?decode(row) as unknown as ProductRecords[K]:null;
  }
  private list<K extends ProductCollection>(c:K,scope:ProductRecordScopes[K]):ProductRecords[K][] {
    const spec=this.spec(c),value=object(scope),policy=scopes[c],cols=Object.keys(value);
    if(policy.required.some(k=>!Object.hasOwn(value,k))||cols.some(k=>![...policy.required,...(policy.optional??[])].includes(k)))throw invalid();
    const where=this.where(cols,value);
    return this.#db.prepare(`SELECT * FROM ${quote(spec.table)} WHERE ${where.sql} ORDER BY ${spec.primaryKey.map(quote).join(',')}`).all(...where.values).map(decode) as unknown as ProductRecords[K][];
  }
  private insert<K extends ProductCollection>(c:K,key:ProductRecordKeys[K],value:ProductRecords[K]) {
    const spec=this.spec(c),record=object(value);this.where(spec.primaryKey,key);
    if(spec.primaryKey.some(k=>!Object.hasOwn(record,k)||canonicalJson(record[k])!==canonicalJson(object(key)[k])))throw invalid();
    const cols=this.#db.prepare(`PRAGMA table_info(${quote(spec.table)})`).all().map(row=>String(row.name));
    const supplied=Object.keys(record);
    if(!supplied.length||supplied.some(k=>!cols.includes(k)))throw invalid();
    this.#db.prepare(`INSERT INTO ${quote(spec.table)} (${supplied.map(quote).join(',')}) VALUES (${supplied.map(()=>'?').join(',')})`).run(...supplied.map(k=>encode(k,record[k])));
    return this.read(c,key)!;
  }
  private write<K extends ProductCollection>(c:K,key:ProductRecordKeys[K],value:ProductRecords[K]) {
    const spec=this.spec(c);
    if(!spec.writable||spec.kind==='head')throw invalid();
    const old=this.read(c,key);
    if(!old)return {record:this.insert(c,key,value),replayed:false};
    if(canonicalJson(old)===canonicalJson(value))return {record:old,replayed:true};
    if(spec.kind!=='mutable_state')throw new AgentDataError('IDEMPOTENCY_CONFLICT','Immutable fact differs');
    const allowed=mutable[c];if(!allowed)throw invalid();
    const before=object(old),after=object(value);
    if(Object.keys(before).length!==Object.keys(after).length || Object.keys(before).some(k=>!Object.hasOwn(after,k)||!allowed.includes(k)&&canonicalJson(before[k])!==canonicalJson(after[k])))throw conflict();
    const changes=allowed.filter(k=>Object.hasOwn(after,k)),where=this.where(spec.primaryKey,key);
    if(!changes.length)throw invalid();
    this.#db.prepare(`UPDATE ${quote(spec.table)} SET ${changes.map(k=>`${quote(k)}=?`).join(',')} WHERE ${where.sql}`).run(...changes.map(k=>encode(k,after[k])),...where.values);
    return {record:this.read(c,key)!,replayed:false};
  }
  private cas<K extends ProductHeadCollection>(c:K,key:ProductRecordKeys[K],expected:number,value:ProductRecords[K]) {
    const spec=this.spec(c);if(spec.kind!=='head'||!Number.isSafeInteger(expected)||expected<0)throw invalid();
    const old=this.read(c,key),column=spec.versionColumn;
    if(!old){if(expected!==0)throw conflict();return {record:this.insert(c,key,value),replayed:false};}
    if(Number(object(old)[column])!==expected)throw conflict();
    const before=object(old),after=object(value);
    if(Object.keys(before).length!==Object.keys(after).length||Object.keys(before).some(k=>!Object.hasOwn(after,k)||k!==column&&canonicalJson(before[k])!==canonicalJson(after[k])))throw conflict();
    const next=Number(after[column]);if(!Number.isSafeInteger(next)||next<=expected)throw conflict();
    const where=this.where(spec.primaryKey,key);
    const result=this.#db.prepare(`UPDATE ${quote(spec.table)} SET ${quote(column)}=? WHERE ${where.sql} AND ${quote(column)}=?`).run(next,...where.values,expected);
    if(Number(result.changes)!==1)throw conflict();
    return {record:this.read(c,key)!,replayed:false};
  }
  private ledgerScope(scope:ProductIdempotencyScope):string {
    if(scope.kind==='principal' && scope.principal_id)return 'principal:'+scope.principal_id;
    if(scope.kind==='project' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(scope.project_id))return scope.project_id;
    throw invalid();
  }
  private recall(scope:ProductIdempotencyScope,operation:string,key:string):ProductIdempotencyEntry|null {
    const found=this.#commands.recall(this.ledgerScope(scope),'agent.v1:'+operation,key);
    if(!found)return null;
    const entry=object(JSON.parse(found.response_json));
    if(entry.format!=='agent.idempotency@1')throw conflict();
    const receipt=object(entry.receipt);
    if(receipt.request_digest!==found.request_digest||receipt.operation!==operation||receipt.idempotency_key!==key||receipt.project_id!==(scope.kind==='project'?scope.project_id:null)||typeof receipt.principal_id!=='string'||scope.kind==='principal'&&receipt.principal_id!==scope.principal_id)throw conflict();
    return {receipt:receipt as unknown as ProductIdempotencyReceipt,response:entry.response};
  }
  private remember(scope:ProductIdempotencyScope,operation:string,key:string,receipt:ProductIdempotencyReceipt,response:unknown) {
    const principal=scope.kind==='principal'?scope.principal_id:receipt.principal_id;
    if(receipt.operation!==operation||receipt.idempotency_key!==key||receipt.principal_id!==principal||receipt.project_id!==(scope.kind==='project'?scope.project_id:null))throw invalid();
    const found=this.recall(scope,operation,key);
    const entry={receipt,response};
    if(found){if(canonicalJson(found)!==canonicalJson(entry))throw new AgentDataError('IDEMPOTENCY_CONFLICT','Idempotency receipt differs');return;}
    this.#commands.record({projectId:this.ledgerScope(scope),operationKind:'agent.v1:'+operation,idempotencyKey:key,requestDigest:receipt.request_digest,response:JSON.parse(canonicalJson({format:'agent.idempotency@1',...entry}))});
  }
  private emit(event:ProductEvent) {
    const s=event.scope;
    const project=s.kind==='intake'?'':s.project_id;
    const result=this.#db.prepare('INSERT INTO outbox(topic,project_id,payload_json,created_at) VALUES(?,?,?,?)').run(event.topic,project,canonicalJson(event),event.observed_at);
    const event_id=Number(result.lastInsertRowid);
    if(s.kind==='run')this.#db.prepare('INSERT INTO cp_a0_event(project_id,event_id,run_id,run_scope_digest,source,input_digest,observed_at) VALUES(?,?,?,?,?,?,?)').run(project,event_id,s.run_id,s.run_scope_digest,event.source,event.input_digest,event.observed_at);
    return {event_id,topic:event.topic,observed_at:event.observed_at};
  }
}
