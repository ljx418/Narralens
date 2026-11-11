import type {DatabaseSync} from 'node:sqlite';
import {dirname} from 'node:path/posix';
import {canonicalDigest,canonicalJson} from '../creative/digest.js';
import {ProductError} from '../creative/trusted-context.js';
import {RevisionStore} from '../projects/revision-store.js';
import {snapshotIdFor} from '../projects/snapshot-store.js';
import {assertSafeRelativePath} from '../render/snapshot-copy.js';
import {matchesFrozenSchemaNamespace} from './agent-schema-definition.js';
import {isCreatedSourceApplyTransaction} from './created-source-ports.js';
import {RetainedSourceTree,type RetainedTreeIdentity,type RetainedDirectoryIdentity} from './retained-source-tree.js';

export const CREATED_PUBLICATION_IDENTITY_DDL=`
CREATE TABLE created_publication_identity (
 transaction_id TEXT PRIMARY KEY REFERENCES project_transaction(transaction_id),
 project_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version=1),
 identity_json TEXT NOT NULL CHECK(json_valid(identity_json)),
 identity_sha256 TEXT NOT NULL CHECK(length(identity_sha256)=64),
 created_at TEXT NOT NULL
);
CREATE TRIGGER created_publication_identity_no_update BEFORE UPDATE ON created_publication_identity BEGIN SELECT RAISE(ABORT,'immutable publication identity'); END;
CREATE TRIGGER created_publication_identity_no_delete BEFORE DELETE ON created_publication_identity BEGIN SELECT RAISE(ABORT,'immutable publication identity'); END;
`;
export interface PublicationIdentityInput {
 readonly transaction_id:string;readonly project_id:string;
 readonly original_source_digest:string;readonly target_source_digest:string;readonly target_snapshot_id:string;
 readonly original_tree:RetainedTreeIdentity;readonly target_tree:RetainedTreeIdentity;readonly snapshot_tree:RetainedTreeIdentity;
 readonly snapshot_container:RetainedDirectoryIdentity;
}
export interface PublicationIdentityFact extends PublicationIdentityInput {
 readonly format:'narralens.created-publication-identity@1';readonly version:1;
}
const fail=():never=>{throw new ProductError('REVISION_CONFLICT','Publication identity facts are missing or inconsistent');};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();return value as Record<string,unknown>;};
const exact=(value:unknown,keys:readonly string[]):Record<string,unknown>=>{const row=object(value);if(Object.keys(row).sort().join(',')!==[...keys].sort().join(','))return fail();return row;};
const decimal=(value:unknown,zero=true):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&value.length<=40&&(zero||value!=='0');
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const inode=(value:RetainedDirectoryIdentity)=>value.dev+':'+value.ino;
function directory(value:unknown):void{const row=exact(value,['dev','ino']);if(!decimal(row.dev)||!decimal(row.ino,false))fail();}
function tree(value:unknown):RetainedTreeIdentity{
 const row=exact(value,['format','directories','files']);if(row.format!=='narralens.retained-tree-identity@1'||!Array.isArray(row.directories)||!Array.isArray(row.files)
  ||row.directories.length<1||row.files.length<1||row.directories.length+row.files.length>10000)fail();
 const dirs=row.directories as unknown[],files=row.files as unknown[],seenDirs=new Set<string>(),seenFiles=new Set<string>();
 let previous:string|undefined;
 for(const entry of dirs){const d=exact(entry,['relative_path','dev','ino']);if(typeof d.relative_path!=='string'||!decimal(d.dev)||!decimal(d.ino,false))fail();
  const path=d.relative_path as string;if(path!=='')assertSafeRelativePath(path);if(previous!==undefined&&path<=previous)fail();previous=path;seenDirs.add(path);}
 if(!seenDirs.has('')||(dirs[0] as {relative_path:string}).relative_path!=='')fail();
 for(const path of seenDirs)if(path!==''&&!seenDirs.has(dirname(path)==='.'?'':dirname(path)))fail();
 previous=undefined;
 for(const entry of files){const f=exact(entry,['relative_path','dev','ino','bytes','sha256']);if(typeof f.relative_path!=='string'||!decimal(f.dev)||!decimal(f.ino,false)
   ||typeof f.bytes!=='number'||!Number.isSafeInteger(f.bytes)||f.bytes<0||!hash(f.sha256))fail();
  const path=f.relative_path as string;assertSafeRelativePath(path);if(previous!==undefined&&path<=previous||seenDirs.has(path))fail();previous=path;seenFiles.add(path);
  if(!seenDirs.has(dirname(path)==='.'?'':dirname(path)))fail();
 }
 return value as RetainedTreeIdentity;
}
function validate(value:unknown):PublicationIdentityFact{
 const row=exact(value,['format','version','transaction_id','project_id','original_source_digest','target_source_digest','target_snapshot_id',
  'original_tree','target_tree','snapshot_tree','snapshot_container']);
 if(row.format!=='narralens.created-publication-identity@1'||row.version!==1||!id(row.transaction_id)||!id(row.project_id)
  ||!hash(row.original_source_digest)||!hash(row.target_source_digest)||row.target_snapshot_id!==snapshotIdFor(row.project_id,row.target_source_digest))fail();
 const original=tree(row.original_tree),target=tree(row.target_tree),snapshot=tree(row.snapshot_tree);directory(row.snapshot_container);
 const roots=[original.directories[0]!,target.directories[0]!,snapshot.directories[0]!,row.snapshot_container as RetainedDirectoryIdentity].map(inode);
 if(new Set(roots).size!==roots.length)fail();
 const closure=(v:RetainedTreeIdentity)=>v.files.map(f=>({path:f.relative_path,sha256:f.sha256,bytes:f.bytes}));
 if(canonicalDigest(closure(target))!==canonicalDigest(closure(snapshot))
  ||canonicalDigest(target.directories.map(d=>d.relative_path))!==canonicalDigest(snapshot.directories.map(d=>d.relative_path)))fail();
 return freeze(value as PublicationIdentityFact);
}
/** Immutable resource evidence on the original database. It has no state, FD numbers,
 * Approval, ready flag or proof issuer. Reading/recording this never commits a project. */
export class CreatedPublicationIdentityStore {
 readonly #db:DatabaseSync;#schemaVersion=-1;
 constructor(private readonly revisions:RevisionStore){this.#db=revisions.compose(db=>db);this.#schema();}
 #schema():void{
  const version=Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);if(version===this.#schemaVersion)return;
  if(!this.#db.prepare("SELECT name FROM sqlite_master WHERE name='created_publication_identity'").get())this.#db.exec(CREATED_PUBLICATION_IDENTITY_DDL);
  if(!matchesFrozenSchemaNamespace(this.#db,CREATED_PUBLICATION_IDENTITY_DDL,'created_publication_identity'))fail();
  this.#schemaVersion=Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
 }
 read(transactionId:string):PublicationIdentityFact|undefined{
  this.#schema();const row=this.#db.prepare('SELECT * FROM created_publication_identity WHERE transaction_id=?').get(transactionId);if(!row)return;
  let parsed:unknown;try{parsed=JSON.parse(String(row.identity_json));}catch{return fail();}
  const fact=validate(parsed);
  if(row.version!==1||fact.transaction_id!==transactionId||fact.project_id!==row.project_id||canonicalDigest(fact)!==row.identity_sha256
   ||canonicalJson(fact)!==row.identity_json)fail();return fact;
 }
 /** Must join the caller transaction that will append the prepared journal. No BEGIN
  * here: Publisher owns that atomic pair before any file rename is attempted. */
 record(input:PublicationIdentityInput,now=new Date()):PublicationIdentityFact{
  this.#schema();if(!this.#db.isTransaction)throw new ProductError('REVISION_CONFLICT','Publication identity must join its journal transaction');
  const fact=validate({format:'narralens.created-publication-identity@1',version:1,...structuredClone(input)});
  const parent=this.revisions.projectTransaction(fact.transaction_id);
  if(!parent||parent.project_id!==fact.project_id||!isCreatedSourceApplyTransaction(parent))fail();
  const old=this.read(fact.transaction_id);if(old){if(canonicalJson(old)!==canonicalJson(fact))fail();return old;}
  if(parent?.state!=='prepared')fail();
  this.#db.prepare('INSERT INTO created_publication_identity VALUES(?,?,1,?,?,?)').run(fact.transaction_id,fact.project_id,canonicalJson(fact),canonicalDigest(fact),now.toISOString());
  return this.read(fact.transaction_id)!;
 }
 /** Fresh actual guards must match the pre-rename observations. This comparison
  * grants no permission to publish or commit; those still require private proofs. */
 assertCurrent(transactionId:string,original:RetainedSourceTree,target:RetainedSourceTree,snapshot:RetainedSourceTree,snapshotContainer:string):void{
  const expected=this.read(transactionId);if(!expected)fail();
  const actual={original_tree:original.identity(),target_tree:target.identity(),snapshot_tree:snapshot.identity(),snapshot_container:snapshot.directoryIdentity(snapshotContainer)};
  for(const key of ['original_tree','target_tree','snapshot_tree','snapshot_container'] as const)if(canonicalDigest(expected![key])!==canonicalDigest(actual[key]))fail();
 }
}
