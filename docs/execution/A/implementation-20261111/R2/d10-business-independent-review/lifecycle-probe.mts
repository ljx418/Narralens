// Readonly review probe: real SQLite/Coordinator/queue/FS and retained guards.
// Seeded authority rows and controlled creation adapter are diagnostic only, not bootstrap/business acceptance.
import {RevisionStore} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/projects/revision-store.ts';
import {ProjectCreationStore} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/projects/project-creation-store.ts';
import {ProjectCoordinator} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/projects/project-coordinator.ts';
import {InMemoryProjectOperationQueue} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/projects/project-operation-queue.ts';
import {CreatedSourceRecovery} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/agent-driven/created-source-recovery.ts';
import {RetainedSourceTree} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/agent-driven/retained-source-tree.ts';
import {PublicationCleanupError} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/agent-driven/publication-cleanup.ts';
import {computeSourceDigest} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/engine/source-digest-v1.ts';
import {OPENFILM_UPSTREAM_SHA} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/engine/engine-binding-store.ts';
import {canonicalJson,canonicalDigest,contentDigest} from '/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/src/host/creative/digest.ts';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=mkdtempSync(new URL('./diagnostic-',import.meta.url).pathname);
const results:any[]=[];const hash='a'.repeat(64);
const vector=JSON.parse(readFileSync('/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')).vectors.find((v:any)=>v.id==='definition:ApplyChange:valid').value;
function setup(){const revisions=new RevisionStore(':memory:');new ProjectCreationStore(revisions);const queue=new InMemoryProjectOperationQueue();const coordinator=new ProjectCoordinator({store:revisions,queue} as any);const creation={forProject:()=>({command_id:'creation-command',transaction_id:'creation-txn'}),origin:()=>({origin:'created'}),ownerOf:()=> 'owner'};const service=new CreatedSourceRecovery({host:{revisions,coordinator,snapshots:{}},creation,createdRoot:root,privateRoot:join(root,'private'),stageDomainRoot:join(root,'stage'),selection:{currentSelectionVersion:()=>0},tasks:{},assets:{},verifier:{}} as any);return {revisions,queue,coordinator,service};}
function transaction(revisions:any,id:string,project:string,input?:any){revisions.beginTransaction({transaction_id:id,project_id:project,kind:'edit',correlation_id:'id1',request_json:canonicalJson(input?{operation:'agent.created_source.apply@1',input}:{operation:'agent.created_source.apply@1'}),request_hash:input?contentDigest(input):hash,base_revision:1,createdAt:new Date(id.endsWith('1')?0:1)});}
try{
 const f=setup();const project='early';const source=join(root,project,'source');mkdirSync(source,{recursive:true});writeFileSync(join(source,'film.html'),'<html><body>diagnostic</body></html>');writeFileSync(join(root,project,'owner.json'),canonicalJson({kind:'narralens.created-root@1',project_id:project,command_id:'creation-command',transaction_id:'creation-txn'}));
 const digest=await computeSourceDigest({root:source,roots:['film.html'],engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
 f.revisions.ensureProject(project,1);const fact={schema_version:1,roots:['film.html'],subtitles:[],frame_count:0,fps:{num:30,den:1},assets:[]};
 f.revisions.compose(db=>{db.prepare('UPDATE project_state SET source_digest=? WHERE project_id=?').run(digest.source_digest,project);db.prepare('INSERT INTO snapshot(snapshot_id,project_id,source_digest,engine,created_at) VALUES(?,?,?,?,?)').run('snapshot',project,digest.source_digest,'openfilm',new Date().toISOString());db.prepare('INSERT INTO active_commit VALUES(?,?,?,?,?,?,?)').run(project,1,'snapshot',digest.source_digest,'openfilm','creation-txn',new Date().toISOString());db.prepare('INSERT INTO created_source_fact VALUES(?,?,?,?)').run(project,'snapshot',canonicalJson(fact),canonicalDigest(fact));});
 const input={...vector,project_id:project,base_revision:1,source_digest:digest.source_digest};transaction(f.revisions,'early1',project,input);
 const originalClose=RetainedSourceTree.prototype.close;let injected=false;
 RetainedSourceTree.prototype.close=function(){originalClose.call(this);if(!injected&&this.root===source){injected=true;throw new PublicationCleanupError([new Error('injected close outcome unknown after real FD release')]);}};
 let first:any,second:any,closeError:any=null;
 try{first=await f.service.recoverTransaction('early1');transaction(f.revisions,'early2',project,input);second=await f.service.recoverTransaction('early2');try{await f.service.close();}catch(e){closeError=e.message;}}
 finally{RetainedSourceTree.prototype.close=originalClose;}
 results.push({scenario:'early_guard_cleanup_not_sticky',injected,first,firstState:f.revisions.projectTransaction('early1')?.state,second,secondState:f.revisions.projectTransaction('early2')?.state,closeError,defect:injected&&second?.outcome==='aborted'&&closeError===null});f.revisions.close();
 const g=setup();transaction(g.revisions,'sweep1','sweep-a');transaction(g.revisions,'sweep2','sweep-b');let release!:()=>void;const gate=new Promise<void>(r=>release=r);const held=g.queue.run('sweep-a',()=>gate);const events:string[]=[];
 const sweep=g.service.recoverOnStart().then(v=>{events.push('sweep_resolved');return {value:v};},e=>{events.push('sweep_rejected');return {error:e.message};});
 const closing=g.service.close().then(()=>{events.push('close_resolved');});release();await held;await closing;const swept=await sweep;
 results.push({scenario:'close_while_startup_sweep_accepted',events,swept,first:g.revisions.projectTransaction('sweep1')?.state,second:g.revisions.projectTransaction('sweep2')?.state,defect:'error' in swept});g.revisions.close();
}finally{rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify(results,null,2));process.exitCode=results.some(x=>x.defect)?1:0;
