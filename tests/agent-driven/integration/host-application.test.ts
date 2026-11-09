import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {ScopedAgentAuth} from '../../../src/host/agent-driven/scoped-auth.js';
import {ApplicationDispatcher,creativeHandlers} from '../../../src/host/agent-driven/application-dispatcher.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {CreativeService} from '../../../src/host/creative/creative-service.js';
import {styleDigest} from '../../../src/host/creative/digest.js';
import type {IntakePut,Intake} from '../../../src/contracts/agent-driven-types.js';

it('mounts real creative SQL in NarralensHost and denies the legacy bearer/session/write bypass',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-a-host-'));
 let auth:ScopedAgentAuth|undefined;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),
  snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),
  agentApplication:instance=>{
   auth=new ScopedAgentAuth(()=>instance.origin);
   const repo=new ProductSqliteRepository(instance.revisions);
   return {auth,dispatcher:new ApplicationDispatcher({...creativeHandlers(new CreativeService({repository:repo})),
     // Handshake metadata is explicit test data; this case does not certify the instance supervisor.
     instance:async()=>({instance_id:'test-host',generation:1,api_version:'agent.v1',contract_version:'cp-a0-r4',capabilities:[],health:'ready'}),
    })};
  },
 });
 try{
  await host.listen(0);const origin=host.origin;
  const driver=auth!.issue({principal_id:'local-user',channel:'authenticated',expires_at:Date.now()+60000});
  const ui=auth!.issue({principal_id:'local-user',channel:'trusted_ui',expires_at:Date.now()+60000});
  const headers={Origin:origin,Authorization:'Bearer '+driver.token};
  expect((await fetch(origin+'/api/session',{headers:{Origin:origin}})).status).toBe(403);
  expect((await fetch(origin+'/api/session',{headers})).status).toBe(403);
  expect((await fetch(origin+'/api/session',{headers:{Origin:origin,Authorization:'Bearer '+host.sessionToken}})).status).toBe(403);
  const uiHeaders={Origin:origin,Cookie:auth!.cookieName+'='+ui.token};
  expect((await fetch(origin+'/api/session',{headers:uiHeaders})).status).toBe(200);
  for(const path of ['/api/projects/missing/edits','/api/projects/missing/assets/import','/api/migration/v1/projects/missing/impact']){
   for(const attempt of [headers,uiHeaders,{Origin:origin,Authorization:'Bearer '+host.sessionToken}]){
    expect((await fetch(origin+path,{method:'POST',headers:{...attempt,'Content-Type':'application/json'},body:'{}'})).status).toBe(403);
   }
  }
  const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
  const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
  input.intake_id=null;input.base_version=0;input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
  const create=await fetch(origin+'/api/agent/v1/intakes',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(input)});
  expect(create.status).toBe(200);const saved=await create.json() as Intake;
  const read=await fetch(origin+'/api/agent/v1/intakes/'+saved.intake_id,{headers});expect(read.status).toBe(200);expect(await read.json()).toEqual(saved);
  expect(host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_intake_version').get()?.n)).toBe(1);
  const loader=createRequire(import.meta.url).resolve('tsx/esm');
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  env.NARRALENS_HOST_URL=origin;env.NARRALENS_HOST_TOKEN=driver.token;
  const transport=new StdioClientTransport({command:process.execPath,args:['--import',loader,resolve('src/mcp/stdio-main.ts')],cwd:process.cwd(),env,stderr:'pipe'});
  const client=new Client({name:'real-host-auth-probe',version:'1.0.0'},{capabilities:{}});
  try{
   await client.connect(transport);
   const result=await client.callTool({name:'narralens_intake_read',arguments:{intake_id:saved.intake_id}});
   expect(result.isError,JSON.stringify(result)).not.toBe(true);expect(result.structuredContent).toEqual(saved);
  }finally{await client.close();await transport.close();}

 }finally{await host.close();await rm(root,{recursive:true,force:true});}
},120000);
