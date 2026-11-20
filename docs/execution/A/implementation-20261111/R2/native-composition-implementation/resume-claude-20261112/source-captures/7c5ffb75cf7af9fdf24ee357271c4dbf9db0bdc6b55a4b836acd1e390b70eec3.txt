import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {rm,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createdProjectFixture} from '../integration/helpers/created-project-fixture.js';
import {launchChrome,makeProfile,findChrome,type ChromeHandle} from '../../m5/headless/chrome.js';
import {CdpSession} from '../../m5/headless/cdp.js';
it('starts at the real owned project chooser, preserves refresh, and opens the selected original native editor',async()=>{
 const operator=randomBytes(32).toString('base64url');
 const f=await createdProjectFixture({workbench:{principalId:'owner',operatorSecret:operator}});
 let browser:ChromeHandle|undefined,profile:string|undefined,tab:CdpSession|undefined;
 const denied:string[]=[];
 const deny=createServer((_req,res)=>{denied.push('http');res.writeHead(403);res.end();});deny.on('connect',(_req,socket)=>{denied.push('connect');socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
 try{
  await new Promise<void>(resolve=>deny.listen(0,'127.0.0.1',resolve));
  const r=await fetch(f.host.origin+'/api/workbench/session/open',{method:'POST',headers:{Origin:f.host.origin,Authorization:'Bearer '+operator,'Content-Type':'application/json'},body:'{}'});expect(r.status).toBe(200);const entry=await r.json() as {url:string};
  const executable=await findChrome();if(!executable)throw new Error('BLOCKED_ENV_NO_LOCAL_CHROME');
  profile=await makeProfile(executable,'narralens-owned-entry-');browser=await launchChrome({profileRoot:profile,proxyOrigin:'http://127.0.0.1:'+((deny.address() as {port:number}).port)});tab=await CdpSession.open(browser.endpoint);
  let legacyRequests=0,exceptions=0;tab.on('Network.requestWillBeSent',value=>{const url=(value as {request?:{url?:string}}).request?.url;if(url?.includes('d1-30s'))legacyRequests++;});tab.on('Runtime.exceptionThrown',()=>exceptions++);
  const waitFor=async(expression:string)=>{for(const end=Date.now()+30000;Date.now()<end;){if(await tab!.evaluateWithRetry<boolean>(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('OWNED_ENTRY_UI_NOT_READY');};
  await tab.navigate(entry.url);await waitFor("!!document.querySelector('[data-owned-projects=ready] .nl-owned-entry-open')");
  expect(await tab.evaluate<string>('location.hash')).toBe('');
  expect(await tab.evaluate<string>("document.querySelector('.nl-owned-entry-list')?.textContent||''")).toContain('空工程');
  const evidence=resolve('docs/execution/A/logs','owned-project-entry-'+Date.now());await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,'owned-dark.png'),Buffer.from(await tab.screenshot(),'base64'));
  await tab.evaluate("document.documentElement.dataset.theme='light'");await writeFile(join(evidence,'owned-light.png'),Buffer.from(await tab.screenshot(),'base64'));
  await tab.navigate(f.host.origin+'/');await waitFor("!!document.querySelector('[data-owned-projects=ready] .nl-owned-entry-open')");
  await tab.evaluate("document.querySelector('.nl-owned-entry-open').click()");
  await waitFor("!!document.querySelector('.workspace-shell')&&!!document.querySelector('[data-narralens-panel=ready]')");
  expect(await tab.evaluate<boolean>("location.hash===''&&!!document.querySelector('.tl-scroll')")).toBe(true);
  expect(await tab.evaluate<string>("document.querySelector('.m5-phase')?.textContent||''")).toContain('待确认');
  await writeFile(join(evidence,'opened-native.png'),Buffer.from(await tab.screenshot(),'base64'));
  expect(legacyRequests).toBe(0);expect(exceptions).toBe(0);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
  expect(f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_native_ack').get()?.n)).toBe(0);
  await writeFile(join(evidence,'observed.json'),JSON.stringify({scope:'owned root navigation to zero-frame native draft only; NOT film/NativeAck/human acceptance',headless:true,muted:true,chooser:true,refresh:true,native:true,light_dark_chooser:true,legacy_fixture_requests:legacyRequests,uncaught_exceptions:exceptions,denied_external_attempts:denied.length},null,2)+'\n');
 }finally{
  tab?.close();try{await browser?.close();}finally{deny.closeAllConnections();await new Promise<void>((resolve,reject)=>deny.close(error=>error&&('code' in error&&error.code!=='ERR_SERVER_NOT_RUNNING')?reject(error):resolve()));await f.close();if(profile)await rm(profile,{recursive:true,force:true});}
 }
},120000);
