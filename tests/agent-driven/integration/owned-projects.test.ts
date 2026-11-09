import {it,expect} from 'vitest';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createdProjectFixture} from './helpers/created-project-fixture.js';
import {validateOwnedProjects} from '../../../src/contracts/owned-projects.js';
it('lists only actual owned durable projects and GET leaves project, outbox and native runtime untouched',async()=>{
 const f=await createdProjectFixture();
 try{
  const before=f.host.revisions.projectTransactions(f.projectId),events=f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM outbox').get()?.n);
  const r=await f.request('/api/ui/v1/projects',undefined,true);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');
  const page=validateOwnedProjects(await r.json());expect(page.projects).toHaveLength(1);expect(page.projects[0]).toMatchObject({project_id:f.projectId,state:'saved',frame_count:0,project_revision:f.commit.revision,snapshot_id:f.commit.snapshot_id});expect(page.projects[0]!.title.length).toBeGreaterThan(0);expect(page.next_after).toBeNull();expect(JSON.stringify(page)).not.toContain(f.root);
  expect(f.host.revisions.projectTransactions(f.projectId)).toEqual(before);expect(f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM outbox').get()?.n)).toBe(events);
  await expect(stat(join(f.root,'studio-runtime'))).rejects.toMatchObject({code:'ENOENT'});
  const following=await f.request('/api/ui/v1/projects?after='+f.projectId,undefined,true);expect(validateOwnedProjects(await following.json()).projects).toEqual([]);
  const foreign=f.app.auth.issue({principal_id:'foreign',channel:'trusted_ui',expires_at:Date.now()+60000});
  const other=await fetch(f.host.origin+'/api/ui/v1/projects',{headers:{Origin:f.host.origin,Cookie:f.app.auth.cookieName+'='+foreign.token,'X-Narralens-CSRF':foreign.csrf!}});expect(other.status).toBe(200);expect(validateOwnedProjects(await other.json()).projects).toEqual([]);
 }finally{await f.close();}
},60000);
it('rejects driver, cookie-only, anonymous and forged pagination instead of leaking saved titles',async()=>{
 const f=await createdProjectFixture();
 try{
  expect((await f.request('/api/ui/v1/projects')).status).toBe(403);
  expect((await fetch(f.host.origin+'/api/ui/v1/projects',{headers:{Origin:f.host.origin}})).status).toBe(401);
  expect((await fetch(f.host.origin+'/api/ui/v1/projects',{headers:{Origin:f.host.origin,Cookie:f.app.auth.cookieName+'='+f.ui.token}})).status).toBe(403);
  for(const query of ['?after=','?after=..','?after=a&after=b','?principal_id=foreign'])expect((await f.request('/api/ui/v1/projects'+query,undefined,true)).status).toBe(400);
 }finally{await f.close();}
},60000);
