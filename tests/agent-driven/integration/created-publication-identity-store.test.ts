import {mkdtemp,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,it,expect} from 'vitest';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {snapshotIdFor} from '../../../src/host/projects/snapshot-store.js';
import {computeSourceDigest} from '../../../src/host/engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../../../src/host/engine/engine-binding-store.js';
import {canonicalDigest,canonicalJson} from '../../../src/host/creative/digest.js';
import {CreatedPublicationIdentityStore,type PublicationIdentityInput} from '../../../src/host/agent-driven/created-publication-identity-store.js';
import {RetainedSourceTree} from '../../../src/host/agent-driven/retained-source-tree.js';
import {isCreatedSourcePublicationProof} from '../../../src/host/agent-driven/created-source-publisher.js';

// Resource/SQLite component evidence. No approved review, native video, publication,
// process-crash or business acceptance is fabricated by this fixture.
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{const errors:unknown[]=[];for(const close of cleanup.splice(0).reverse())try{await close();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Identity fixture cleanup failed');});
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'narralens-publication-identity-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const author=join(root,'author'),stage=join(root,'staging'),container=join(root,'snapshot'),snapshot=join(container,'source');
 const guards:RetainedSourceTree[]=[];
 const files=async(path:string)=>Promise.all(['film.html','scenes/one.html'].map(async relative_path=>{const bytes=await readFile(join(path,relative_path));return {relative_path,bytes:bytes.length,sha256:sha(bytes)};}));
 const guard=async(path:string)=>{const value=new RetainedSourceTree(path,await files(path));guards.push(value);return value;};
 for(const [path,label]of [[author,'original'],[stage,'target'],[snapshot,'target']] as const){await mkdir(join(path,'scenes'),{recursive:true});await writeFile(join(path,'film.html'),'<p>'+label+'</p>');await writeFile(join(path,'scenes/one.html'),'<p>'+label+' scene</p>');}
 const original=await guard(author),target=await guard(stage),saved=await guard(snapshot);
 cleanup.push(async()=>{const failures:unknown[]=[];for(const g of guards)try{g.close();}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(failures);});
 const digest=async(path:string)=>(await computeSourceDigest({root:path,roots:['film.html','scenes/one.html'],engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA})).source_digest;
 const originalDigest=await digest(author),targetDigest=await digest(stage),dbPath=join(root,'host.sqlite');
 let revisions=new RevisionStore(dbPath),store=new CreatedPublicationIdentityStore(revisions);
 cleanup.push(async()=>revisions.close());
 revisions.beginTransaction({transaction_id:'txn_identity',project_id:'project-1',kind:'edit',correlation_id:'identity-component',request_json:JSON.stringify({operation:'agent.created_source.apply@1'}),request_hash:canonicalDigest({component:'identity'}),base_revision:1});
 for(const [from,to]of [['received','preconditions_checked'],['preconditions_checked','staged'],['staged','validated'],['validated','prepared']] as const)revisions.transition('txn_identity',from,to);
 const input:PublicationIdentityInput={transaction_id:'txn_identity',project_id:'project-1',original_source_digest:originalDigest,target_source_digest:targetDigest,target_snapshot_id:snapshotIdFor('project-1',targetDigest),
  original_tree:original.identity(),target_tree:target.identity(),snapshot_tree:saved.identity(),snapshot_container:saved.directoryIdentity(container)};
 return {root,author,stage,container,snapshot,original,target,saved,input,guard,get revisions(){return revisions;},get store(){return store;},
  record:()=>revisions.atomic(()=>store.record(input,new Date('2026-11-12T00:00:00Z'))),
  reopen:()=>{revisions.close();revisions=new RevisionStore(dbPath);store=new CreatedPublicationIdentityStore(revisions);}};
}
it('requires the existing journal transaction and rolls back with its owner',async()=>{
 const f=await fixture();expect(()=>f.store.record(f.input)).toThrow(/join/);
 expect(()=>f.revisions.atomic(()=>{f.store.record(f.input);throw Error('journal append failed');})).toThrow('journal append failed');
 expect(f.store.read('txn_identity')).toBeUndefined();expect(f.revisions.projectTransaction('txn_identity')?.state).toBe('prepared');
});
it('persists exactly one immutable fact, reopens the original database and rejects conflicting replay',async()=>{
 const f=await fixture(),first=f.record();f.reopen();expect(f.store.read('txn_identity')).toEqual(first);
 expect(f.revisions.atomic(()=>f.store.record(f.input,new Date('2030-01-01T00:00:00Z')))).toEqual(first);
 expect(f.revisions.compose(db=>db.prepare('SELECT created_at FROM created_publication_identity').get()?.created_at)).toBe('2026-11-12T00:00:00.000Z');
 expect(()=>f.revisions.atomic(()=>f.store.record({...f.input,original_source_digest:'f'.repeat(64)}))).toThrow();
 expect(f.store.read('txn_identity')).toEqual(first);
 expect(()=>f.revisions.compose(db=>db.prepare("UPDATE created_publication_identity SET created_at='later'").run())).toThrow(/immutable/);
 expect(()=>f.revisions.compose(db=>db.prepare('DELETE FROM created_publication_identity').run())).toThrow(/immutable/);
 expect(isCreatedSourcePublicationProof(first)).toBe(false);expect(f.revisions.activeCommit('project-1')).toBeUndefined();
 expect(f.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM snapshot').get()?.n)).toBe(0);
});
it('matches original and target after actual directory renames without borrowing old parent names',async()=>{
 const f=await fixture();f.record();const backup=join(f.root,'backup');
 await rename(f.author,backup);f.original.relocatedTo(backup);await rename(f.stage,f.author);f.target.relocatedTo(f.author);
 expect(()=>f.store.assertCurrent('txn_identity',f.original,f.target,f.saved,f.container)).not.toThrow();
});
it.each(['original file','target file','snapshot file','snapshot tree','snapshot container'] as const)('refuses same-byte replaced %s against persisted real descriptors',async role=>{
 const f=await fixture();f.record();let original=f.original,target=f.target,snapshot=f.saved;
 const path=role==='original file'?f.author:role==='target file'?f.stage:f.snapshot;
 if(role.endsWith('file')){const file=join(path,'film.html'),replacement=join(path,'new-copy');await writeFile(replacement,await readFile(file));await rename(replacement,file);}
 if(role==='snapshot tree'){await rename(f.snapshot,join(f.root,'old-snapshot-tree'));await mkdir(join(f.snapshot,'scenes'),{recursive:true});for(const relative of ['film.html','scenes/one.html'])await writeFile(join(f.snapshot,relative),await readFile(join(f.stage,relative)));}
 if(role==='snapshot container'){const moved=join(f.root,'old-snapshot-container');await rename(f.container,moved);await mkdir(f.container);await rename(join(moved,'source'),f.snapshot);}
 if(role==='original file')original=await f.guard(f.author);else if(role==='target file')target=await f.guard(f.stage);else snapshot=await f.guard(f.snapshot);
 // Even the container-only replacement preserves every source file/root inode;
 // the separately persisted actual container descriptor must still refuse it.
 expect(()=>f.store.assertCurrent('txn_identity',original,target,snapshot,f.container)).toThrow(/identity/);
});
it.each(['missing dir','unclosed field','unknown version','wrong snapshot','target closure'] as const)('rejects invalid %s without storing a resource fact',async field=>{
 const f=await fixture(),input=structuredClone(f.input) as PublicationIdentityInput;
 if(field==='missing dir')Reflect.set(input.target_tree,'directories',[]);
 if(field==='unclosed field')Reflect.set(input.snapshot_container,'fd',99);
 if(field==='unknown version')Reflect.set(input,'version',2);
 if(field==='wrong snapshot')Reflect.set(input,'target_snapshot_id','0'.repeat(64));
 if(field==='target closure')Reflect.set(input.snapshot_tree.files[0]!,'sha256','f'.repeat(64));
 expect(()=>f.revisions.atomic(()=>f.store.record(input))).toThrow();expect(f.store.read('txn_identity')).toBeUndefined();
});
it('fails closed on a checksum-valid future JSON version with the exact schema restored',async()=>{
 const f=await fixture(),fact=f.record(),future={...fact,version:2};
 f.revisions.compose(db=>{const trigger=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_publication_identity_no_update'").get()?.sql);
  db.exec('DROP TRIGGER created_publication_identity_no_update');try{db.prepare('UPDATE created_publication_identity SET identity_json=?,identity_sha256=?').run(canonicalJson(future),canonicalDigest(future));}finally{db.exec(trigger);}});
 expect(()=>f.store.read('txn_identity')).toThrow(/identity/);
});
it('refuses an existing partial schema instead of silently accepting missing immutability',async()=>{
 const f=await fixture();f.revisions.compose(db=>db.exec('DROP TRIGGER created_publication_identity_no_update'));
 expect(()=>new CreatedPublicationIdentityStore(f.revisions)).toThrow(/identity/);
});
