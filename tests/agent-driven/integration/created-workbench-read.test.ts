import {it,expect,vi} from 'vitest';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createdProjectFixture} from './helpers/created-project-fixture.js';
import {validateCreatedWorkbench} from '../../../src/contracts/created-workbench.js';
import {validateWorkbenchProjection} from '../../../src/contracts/validator.js';
import {validateAgentDefinition} from '../../../src/contracts/agent-driven-validator.js';
const path=(id:string)=>'/api/ui/v1/projects/'+id+'/created-workbench';
it('reads the actual HTTP-created zero-frame native project without starting native or creating a workspace or revision',async()=>{
 const f=await createdProjectFixture();
 try{
  const before=f.host.revisions.projectTransactions(f.projectId),events=f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM outbox').get()?.n);
  const response=await f.request(path(f.projectId),undefined,true);expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
  const value=validateCreatedWorkbench(await response.json());expect(value).toMatchObject({format:'narralens.created-workbench@1.0',origin:'created',frame_count:0,migration_id:null,source_project_id:null,preview:null,native_sync:'unknown',clips:[],tracks:[{track_id:'track_0',index:0,clip_ids:[]},{track_id:'track_1',index:1,clip_ids:[]}],revision:f.commit.revision,active_snapshot_id:f.commit.snapshot_id,source_digest:f.commit.source_digest,narration:'absent'});
  expect(value.history).toEqual([{kind:'snapshot_publish',revision:f.commit.revision,snapshot_id:f.commit.snapshot_id,transaction_id:f.commit.transaction_id}]);expect(value.capabilities.every(c=>c.state==='blocked')).toBe(true);
  expect(validateWorkbenchProjection(value).ok).toBe(false);
  expect(JSON.stringify(value)).not.toContain(f.root);expect(f.host.revisions.projectTransactions(f.projectId)).toEqual(before);expect(f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM outbox').get()?.n)).toBe(events);
  await expect(stat(join(f.root,'projects-native-workspaces'))).rejects.toMatchObject({code:'ENOENT'});await expect(stat(join(f.root,'studio-runtime'))).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);
 }finally{await f.close();}
},60000);
it('rejects anonymous, driver, cross-origin, and cookie-only reads before resolving an unavailable project',async()=>{
 const f=await createdProjectFixture();
 try{
  const url=f.host.origin+path('missing-project');
  expect((await fetch(url,{headers:{Origin:f.host.origin}})).status).toBe(401);
  expect((await f.request(path('missing-project'))).status).toBe(403);
  for(const headers of [
   {Origin:f.host.origin,Cookie:f.app.auth.cookieName+'='+f.ui.token},
   {Origin:'http://127.0.0.1:1',Cookie:f.app.auth.cookieName+'='+f.ui.token,'X-Narralens-CSRF':f.ui.csrf!},
  ])expect((await fetch(url,{headers})).status).toBe(403);
  const foreign=f.app.auth.issue({principal_id:'foreign',channel:'trusted_ui',expires_at:Date.now()+60000});
  const response=await fetch(f.host.origin+path(f.projectId),{headers:{Origin:f.host.origin,Cookie:f.app.auth.cookieName+'='+foreign.token,'X-Narralens-CSRF':foreign.csrf!}});expect(response.status).toBe(404);const errorBody=await response.json() as {error:unknown};validateAgentDefinition('Error',errorBody.error);expect(JSON.stringify(errorBody)).not.toContain(f.root);
  expect((await f.request(path(f.projectId)+'?principal_id=foreign',undefined,true)).status).toBe(400);
 }finally{await f.close();}
},60000);
it('refuses genuine source drift and closed service reads without publishing stale committed facts',async()=>{
 const f=await createdProjectFixture();
 try{
  await writeFile(join(f.authorRoot,'film.html'),f.authorBytes.toString()+'\n<!-- actual drift -->');
  const response=await f.request(path(f.projectId),undefined,true);expect(response.status).toBe(409);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
  expect(JSON.stringify(await response.json())).not.toContain(f.authorRoot);
  f.app.createdWorkbench.close();await expect(f.app.createdWorkbench.read(f.projectId,f.owner)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 }finally{await f.close();}
},60000);
it('validates explicit created lineage, zero frames and unknown native state rather than permitting old migration claims',async()=>{
 const f=await createdProjectFixture();
 try{
  const value=validateCreatedWorkbench(await (await f.request(path(f.projectId),undefined,true)).json());
  for(const patch of [{migration_id:'fake-migration'},{source_project_id:'legacy-source'},{frame_count:-1},{native_sync:'loaded'},{preview:{kind:'openfilm-studio',url:'http://127.0.0.1:9',bridge_version:1}},{author_path:f.authorRoot}])expect(()=>validateCreatedWorkbench({...value,...patch})).toThrow();
 }finally{await f.close();}
},60000);

it('rechecks the genuine UI credential after the actual project read before returning any private projection',async()=>{
 const f=await createdProjectFixture();
 const read=f.app.createdWorkbench.read.bind(f.app.createdWorkbench);
 const intercept=vi.spyOn(f.app.createdWorkbench,'read').mockImplementation(async(id,caller)=>{
  const actual=await read(id,caller);f.app.auth.revoke(f.ui.token);return actual;
 });
 try{
  const response=await f.request(path(f.projectId),undefined,true);expect(response.status).toBe(401);
  const body=JSON.stringify(await response.json());expect(body).not.toContain(f.commit.source_digest);expect(body).not.toContain(f.root);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{intercept.mockRestore();await f.close();}
},60000);
