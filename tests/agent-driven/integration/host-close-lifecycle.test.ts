import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {ScopedAgentAuth} from '../../../src/host/agent-driven/scoped-auth.js';
import {ApplicationDispatcher,creativeHandlers} from '../../../src/host/agent-driven/application-dispatcher.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {CreativeService} from '../../../src/host/creative/creative-service.js';
it('joins simultaneous Host closes and lets an admitted real HTTP handler finish before closing SQLite',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-close-race-'));
 let entered!:()=>void,release!:()=>void;
 const reached=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 let auth!:ScopedAgentAuth;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),agentApplication:instance=>{
  auth=new ScopedAgentAuth(()=>instance.origin);
  const handlers=creativeHandlers(new CreativeService({repository:new ProductSqliteRepository(instance.revisions)}));
  return {auth,dispatcher:new ApplicationDispatcher({...handlers,'intake.read':async(input,principal)=>{entered();await gate;return handlers['intake.read']!(input,principal);}})};
 }});
 try{
  await host.listen(0);const credential=auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+60000});
  const request=fetch(host.origin+'/api/agent/v1/intakes/missing',{headers:{Origin:host.origin,Authorization:'Bearer '+credential.token}});
  await reached;const first=host.close(),second=host.close();const settled=Promise.allSettled([first,second]);
  // Even if the assertion fails on the old implementation, release the admitted request.
  release();const response=await request;await settled;expect(response.status).toBe(404);expect(first).toBe(second);await Promise.all([first,second]);
 }finally{release();await host.close();await rm(root,{recursive:true,force:true});}
},120000);
