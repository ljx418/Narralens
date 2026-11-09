import {it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../src/host/agent-driven/creation-application.js';
import {launchChrome,makeProfile,findChrome,type ChromeHandle} from '../../m5/headless/chrome.js';
import {CdpSession} from '../../m5/headless/cdp.js';
/** Real built page and real browser cookies/storage. This is login transport only,
 * not the native created-project workbench, a creative decision, or A acceptance. */
it('exchanges the real built page entry, survives reload and shared-cookie renewal, and rejects a cookie leaked to another local port',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-ui-browser-'));
 let app!:CreationApplication;const operator=randomBytes(32).toString('base64url');
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot:join(root,'unavailable-vendor'),workbench:{principalId:'local-owner',operatorSecret:operator}})});
 let browser:ChromeHandle|undefined,profile:string|undefined,tab:CdpSession|undefined;
 let capturedCookie='';
 const other=createServer((request,response)=>{capturedCookie=request.headers.cookie??'';response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="zh-CN"><title>Local isolation probe</title><body>隔离测试</body></html>');});
 try{
  await host.listen(0);await new Promise<void>(resolve=>other.listen(0,'127.0.0.1',resolve));
  const executable=await findChrome();if(!executable)throw new Error('BLOCKED_ENV_NO_LOCAL_CHROME');
  profile=await makeProfile(executable,'narralens-a-ui-session-');browser=await launchChrome({profileRoot:profile});tab=await CdpSession.open(browser.endpoint);
  const entryResponse=await fetch(host.origin+'/api/workbench/session/open',{method:'POST',headers:{Origin:host.origin,Authorization:'Bearer '+operator,'Content-Type':'application/json'},body:'{}'});
  expect(entryResponse.status).toBe(200);const entry=await entryResponse.json() as {url:string};
  await tab.navigate(entry.url);
  const deadline=Date.now()+20000;let ready=false;
  while(Date.now()<deadline){
   ready=await tab.evaluate<boolean>("location.hash==='' && /^[A-Za-z0-9_-]{43}$/.test(sessionStorage.getItem('narralens.workbench.proof')||'')");
   if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  expect(ready).toBe(true);
  const probe=()=>tab!.evaluate<{status:number;mode:number;noCookie:boolean;noTicket:boolean}>(`(async()=>{
   const headers={'X-Narralens-CSRF':sessionStorage.getItem('narralens.workbench.proof')};
   const a=await fetch('/api/workbench/session',{headers}),b=await fetch('/api/session',{headers});
   return {status:a.status,mode:b.status,noCookie:!document.cookie.includes(${JSON.stringify(app.auth.cookieName)}),noTicket:!location.href.includes('workbench_ticket')};
  })()`);
  expect(await probe()).toEqual({status:200,mode:200,noCookie:true,noTicket:true});
  // Ignore the renewal body: the new browser cookie must still work with this tab's old proof.
  expect(await tab.evaluate<number>(`(async()=>{const r=await fetch('/api/workbench/session/renew',{method:'POST',headers:{'Content-Type':'application/json','X-Narralens-CSRF':sessionStorage.getItem('narralens.workbench.proof')},body:'{}'});return r.status;})()`)).toBe(200);
  expect((await probe()).status).toBe(200);
  await tab.navigate(host.origin+'/');expect((await probe()).status).toBe(200);
  const otherOrigin='http://127.0.0.1:'+((other.address() as {port:number}).port);
  await tab.navigate(otherOrigin+'/');expect(capturedCookie.includes(app.auth.cookieName+'=')).toBe(true);
  expect(await tab.evaluate<boolean>("sessionStorage.getItem('narralens.workbench.proof')===null")).toBe(true);
  const stolen=await fetch(host.origin+'/api/workbench/session',{headers:{Origin:host.origin,Cookie:capturedCookie}});expect(stolen.status).toBe(403);
  const stolenWrite=await fetch(host.origin+'/api/workbench/session/renew',{method:'POST',headers:{Origin:host.origin,Cookie:capturedCookie,'Content-Type':'application/json'},body:'{}'});expect(stolenWrite.status).toBe(403);
  await tab.navigate(host.origin+'/');expect((await probe()).status).toBe(200);
  expect(host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_project_origin').get()?.n)).toBe(0);
  const evidence=resolve('docs/execution/A/logs','workbench-headless-'+Date.now());await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,'result.json'),JSON.stringify({scope:'built-page trusted session only; NOT A05/native workflow or human acceptance',browser:browser.browser,headless:true,muted:true,fragment_removed:true,http_only:true,reload:true,lost_renew_body:true,cookie_leaked_across_ports:true,leaked_cookie_read_status:stolen.status,leaked_cookie_write_status:stolenWrite.status,foreign_origin_proof_absent:true,project_count:0},null,2)+'\n');
 }finally{
  tab?.close();try{await browser?.close();}finally{
   await new Promise<void>((resolve,reject)=>other.close(error=>error&&('code' in error&&error.code!=='ERR_SERVER_NOT_RUNNING')?reject(error):resolve()));
   await host.close();if(profile)await rm(profile,{recursive:true,force:true});await rm(root,{recursive:true,force:true});
  }
 }
},120000);
