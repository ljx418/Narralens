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
  let legacyRequests=0,exceptions=0;
  // The DIAGNOSTIC facts of the run: what really happened, in order, with the URL
  // reduced to its path (no token, no query, no header is ever recorded).
  const consoleEvents:string[]=[];const failedRequests:string[]=[];const responses:Array<{path:string;status:number}>=[];const order:string[]=[];
  const pathOf=(url:string|undefined):string=>{if(url===undefined)return '';try{const parsed=new URL(url);return parsed.origin+parsed.pathname;}catch{return '';}};
  tab.on('Network.requestWillBeSent',value=>{const url=(value as {request?:{url?:string}}).request?.url;if(url?.includes('d1-30s'))legacyRequests++;order.push('request '+pathOf(url));});
  tab.on('Network.responseReceived',value=>{const response=(value as {response?:{url?:string;status?:number}}).response;if(response!==undefined){responses.push({path:pathOf(response.url),status:Number(response.status??0)});order.push('response '+String(response.status??0)+' '+pathOf(response.url));}});
  tab.on('Network.loadingFailed',value=>{const failure=(value as {errorText?:string;type?:string}).errorText??'failed';failedRequests.push(failure);order.push('failed '+failure);});
  tab.on('Runtime.exceptionThrown',value=>{exceptions++;const details=(value as {exceptionDetails?:{text?:string;exception?:{description?:string}}}).exceptionDetails;consoleEvents.push(details?.exception?.description??details?.text??'exception');order.push('exception');});
  const waitFor=async(expression:string)=>{for(const end=Date.now()+30000;Date.now()<end;){if(await tab!.evaluateWithRetry<boolean>(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('OWNED_ENTRY_UI_NOT_READY');};
  await tab.navigate(entry.url);await waitFor("!!document.querySelector('[data-owned-projects=ready] .nl-owned-entry-open')");
  expect(await tab.evaluate<string>('location.hash')).toBe('');
  expect(await tab.evaluate<string>("document.querySelector('.nl-owned-entry-list')?.textContent||''")).toContain('空工程');
  const evidence=resolve('docs/execution/A/logs','owned-project-entry-'+Date.now());await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,'owned-dark.png'),Buffer.from(await tab.screenshot(),'base64'));
  await tab.evaluate("document.documentElement.dataset.theme='light'");await writeFile(join(evidence,'owned-light.png'),Buffer.from(await tab.screenshot(),'base64'));
  await tab.navigate(f.host.origin+'/');await waitFor("!!document.querySelector('[data-owned-projects=ready] .nl-owned-entry-open')");
  await tab.evaluate("document.querySelector('.nl-owned-entry-open').click()");
  // The READINESS the assertion actually demands.
  //
  // The Narralens panel and the pinned Studio are TWO INDEPENDENT deferred module
  // graphs: the studio host bridge loads the panel as a module script and the Studio
  // loads its own modules the same way (src/host/m5/studio-host-bridge.ts), so
  // NOTHING orders the panel's `data-narralens-panel=ready` before the Studio's own
  // `.tl-scroll` exists. The old wait waited for the weaker state and the assertion
  // then demanded the stronger one, which is a timing hazard and not a product fact.
  //
  // The SAME wait now waits for the state the assertion asks about - the real native
  // timeline AND the empty hash - with the SAME 30 s budget and without a sleep. The
  // assertion below is NOT changed: nothing is weakened and nothing is tolerated.
  await waitFor("!!document.querySelector('.workspace-shell')&&!!document.querySelector('[data-narralens-panel=ready]')&&!!document.querySelector('.tl-scroll')&&location.hash===''");
  // The DIAGNOSTIC of THIS moment, taken BEFORE any assertion about it: the two
  // conditions of the next line SEPARATELY, the URL, the DOM state, the frames, the
  // console and the network. A false boolean is not a cause - these facts are.
  const ready=await tab.evaluate<object>(`(()=>{const d=document;return {hash:location.hash,url:location.origin+location.pathname,readyState:d.readyState,hasWorkspaceShell:!!d.querySelector('.workspace-shell'),hasPanelReady:!!d.querySelector('[data-narralens-panel=ready]'),hasTimelineScroll:!!d.querySelector('.tl-scroll'),timelineScrollCount:d.querySelectorAll('.tl-scroll').length,bodyHead:(d.body?.innerText||'').slice(0,300),htmlLength:d.documentElement.outerHTML.length};})()`);
  const tree=await tab.call('Page.getFrameTree') as {frameTree?:{frame?:{id:string;url:string};childFrames?:unknown[]}};
  const frameTree={root:tree.frameTree?.frame?.url??'',childFrames:(tree.frameTree?.childFrames??[]).length};
  await writeFile(join(evidence,'native-ready-state.json'),JSON.stringify({ready,frameTree,consoleEvents,failedRequests,responses,order},null,2)+'\n');
  await writeFile(join(evidence,'native-ready-before-assert.png'),Buffer.from(await tab.screenshot(),'base64'));
  console.log('[owned-project-entry] ready state '+JSON.stringify({ready,frameTree,consoleEvents,failedRequests,responses}));
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
