import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createdProjectFixture} from '../integration/helpers/created-project-fixture.js';
import {launchChrome,makeProfile,findChrome,type ChromeHandle} from '../../m5/headless/chrome.js';
import {CdpSession} from '../../m5/headless/cdp.js';
it('uses the actual native entry in a quiet browser with the original editor and the existing panel, without a fabricated loaded acknowledgement',async()=>{
 const f=await createdProjectFixture();let browser:ChromeHandle|undefined,profile:string|undefined,tab:CdpSession|undefined;
 const denied:string[]=[];
 const deny=createServer((request,response)=>{denied.push('http');response.writeHead(403);response.end();});deny.on('connect',(_request,socket)=>{denied.push('connect');socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
 const root=await mkdtemp(join(tmpdir(),'narralens-native-browser-'));
 let leakedCookie='';const other=createServer((request,response)=>{leakedCookie=request.headers.cookie??'';response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>隔离探针</title>本机隔离探针');});
 try{
  await new Promise<void>(resolve=>deny.listen(0,'127.0.0.1',resolve));await new Promise<void>(resolve=>other.listen(0,'127.0.0.1',resolve));
  const response=await f.request('/api/ui/v1/projects/'+f.projectId+'/native-open',{},true);expect(response.status).toBe(200);const entry=await response.json() as {url:string};
  const nativeOrigin=new URL(entry.url).origin;expect((await fetch(nativeOrigin+'/')).headers.get('Content-Security-Policy')).not.toContain('unsafe-eval');const executable=await findChrome();if(!executable)throw new Error('BLOCKED_ENV_NO_LOCAL_CHROME');
  profile=await makeProfile(executable,'narralens-native-entry-');browser=await launchChrome({profileRoot:profile,proxyOrigin:'http://127.0.0.1:'+((deny.address() as {port:number}).port)});tab=await CdpSession.open(browser.endpoint);
  const errors:{kind:string;csp_eval:boolean}[]=[];tab.on('Runtime.exceptionThrown',value=>{const details=(value as {exceptionDetails?:{exception?:{className?:string;description?:string}}}).exceptionDetails?.exception;errors.push({kind:details?.className??'exception',csp_eval:/unsafe-eval|EvalError/.test(details?.description??'')});});
  await tab.navigate(entry.url);let ready=false;
  for(const deadline=Date.now()+30000;Date.now()<deadline;){
   ready=await tab.evaluateWithRetry<boolean>("location.hash===''&&!!document.querySelector('.workspace-shell')&&!!document.querySelector('[data-narralens-panel=ready]')");
   if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  const evidence=resolve('docs/execution/A/logs','controlled-native-headless-'+Date.now());await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,'native-created.png'),Buffer.from(await tab.screenshot(),'base64'));
  const observed=await tab.evaluateWithRetry<{hash:string;workspace:number;timeline:boolean;panel:string|null;proxies:number;range:string|null;phase:string;proofStored:boolean}>(`({hash:location.hash,workspace:document.querySelectorAll('.workspace-shell').length,timeline:!!document.querySelector('.tl-scroll'),panel:document.querySelector('[data-narralens-panel]')?.getAttribute('data-narralens-panel')||null,proxies:document.querySelectorAll('[data-narralens-proxy]').length,range:document.querySelector('[data-narralens-panel]')?.getAttribute('data-selection-range')||null,phase:document.querySelector('.m5-phase')?.textContent||'',proofStored:!!sessionStorage.getItem('narralens.native.session')})`);
  await writeFile(join(evidence,'observed.json'),JSON.stringify({scope:'created zero-frame native entry only; NOT film/native loaded/human acceptance',headless:true,muted:true,observed,ready,browser:browser.browser,uncaught_errors:errors.length,denied_external_attempts:denied.length},null,2)+'\n');
  expect(ready,JSON.stringify(observed)).toBe(true);expect(observed.workspace).toBe(1);expect(observed.timeline).toBe(true);expect(observed.proxies).toBe(0);expect(observed.range).toBe(null);expect(observed.phase).toContain('待确认');
  const status=await tab.evaluateWithRetry<number>(`(async()=>{var s=JSON.parse(sessionStorage.getItem('narralens.native.session'));return (await fetch('/api/projects/'+s.native_project_id)).status;})()`);expect(status).toBe(200);
  expect(await tab.evaluateWithRetry<boolean>(`new Promise(resolve=>{var socket=new WebSocket('ws://'+location.host+'/api/events');var timer=setTimeout(()=>{socket.close();resolve(false);},4000);socket.onopen=()=>{clearTimeout(timer);socket.close();resolve(true);};socket.onerror=()=>{clearTimeout(timer);resolve(false);};})`)).toBe(true);
  const reloadURL=await tab.evaluate<string>('location.href');await tab.navigate(reloadURL);expect(await tab.evaluateWithRetry<number>(`(async()=>{var s=JSON.parse(sessionStorage.getItem('narralens.native.session'));return (await fetch('/api/projects/'+s.native_project_id)).status;})()`)).toBe(200);
  const otherOrigin='http://127.0.0.1:'+((other.address() as {port:number}).port);await tab.navigate(otherOrigin);
  expect(leakedCookie.includes('narralens_native_')).toBe(true);expect(await tab.evaluate<boolean>("sessionStorage.getItem('narralens.native.session')===null")).toBe(true);
  expect((await fetch(nativeOrigin+'/api/projects',{headers:{Origin:nativeOrigin,Cookie:leakedCookie}})).status).toBe(401);
  expect(f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_native_ack').get()?.n)).toBe(0);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{
  tab?.close();await browser?.close();
  for(const server of [other,deny]){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error&&('code' in error&&error.code!=='ERR_SERVER_NOT_RUNNING')?reject(error):resolve()));}
  await f.close();if(profile)await rm(profile,{recursive:true,force:true});await rm(root,{recursive:true,force:true});
 }
},120000);
