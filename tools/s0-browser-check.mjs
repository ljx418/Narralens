import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'docs/agent-driven-v1/s0');
const chrome='/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const profile=await mkdtemp('/mnt/c/workspace/videoworkline/.narralens-s0-review-');
const win=path=>path.replace(/^\/mnt\/([a-z])\//,(_,drive)=>drive.toUpperCase()+':/');
const uri=path=>'file:///'+win(path);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,child;let sequence=0;const pending=new Map();
const receipt={kind:'supplementary-windows-headless-CDP',status:'running',businessAcceptance:'NOT_RUN',viewports:[],screenshots:[]};
const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method))},15000);
  pending.set(id,msg=>{clearTimeout(timer);msg.error?reject(Error(JSON.stringify(msg.error))):resolve(msg.result)});
  socket.send(JSON.stringify({id,method,params}));
});
const evaluate=async(expression)=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
async function navigate(path){await call('Page.navigate',{url:uri(path)});await wait(900)}
async function viewport(width,height){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await wait(180)}
async function capture(name){const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name),Buffer.from(result.data,'base64'));receipt.screenshots.push(name)}
try{
  child=spawn(chrome,['--headless=new','--disable-gpu','--mute-audio','--no-first-run','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${win(profile)}`,'about:blank'],{stdio:'ignore'});
  child.on('error',()=>{});
  let port;
  for(let i=0;i<80;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{}await wait(150)}
  if(!port)throw Error('CHROME_PORT_UNAVAILABLE');
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
  socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.method?.startsWith('Browser.download')){(receipt.downloadEvents??=[]).push(msg)}if(msg.id&&pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id)}});
  await call('Page.enable');
  const assert=(name,pass)=>{if(!pass)throw Error(name);(receipt.checks??=[]).push({id:name,status:'PASS'})};
  const bound=async name=>{const b=await readFile(join(output,name));(receipt.hashes??={})[name]=createHash('sha256').update(b).digest('hex')};
  await bound('prototype.html');await bound('architecture.html');await bound('review.html');
  await navigate(join(output,'architecture.html'));
  for(const [width,height]of [[1440,900],[1600,1000],[1920,1080],[2048,1320]]){await viewport(width,height);const v=await evaluate('({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})');receipt.viewports.push({artifact:'architecture',...v});assert('diagram-fit-'+width,v.scrollWidth<=width&&v.scrollHeight<=height);if(width===1440||width===2048)for(const theme of ['light','dark']){await evaluate(`document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)})`);await capture(`architecture-${width}-${theme}.png`)}}
  await navigate(join(output,'prototype.html'));await viewport(1440,1000);await evaluate('S0.reset()');
  assert('invalid-empty-brief-refused',await evaluate("(()=>{document.querySelector('#topic').value='';document.querySelector('#create').click();return !S0.read().created})()"));
  await evaluate("document.querySelector('#topic').value='为什么雨后出现彩虹？';document.querySelector('#create').click()");
  assert('create-intake-and-origin-demo',await evaluate("S0.read().created&&S0.read().revision===0&&S0.read().contents.brief.includes('90秒')"));
  assert('research-source-not-certified',await evaluate("!document.querySelector('#research-panel').classList.contains('hidden')&&document.querySelector('#research-panel').textContent.includes('待真实查证')"));
  await evaluate("document.querySelector('#claim-kind').selectedIndex=1;document.querySelector('#claim-review').click()");
  await evaluate("document.querySelector('[data-node=visual]').click();document.querySelector('#editor').value='未保存的新画面';document.querySelector('#editor').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-node=voice]').click();document.querySelector('[data-node=visual]').click()");
  assert('draft-buffer-retained-on-node-switch',await evaluate("document.querySelector('#editor').value==='未保存的新画面'"));
  await evaluate("document.querySelector('#save').click()");assert('only-visual-version-increments',await evaluate("S0.read().versions.visual===2&&S0.read().versions.voice===1&&S0.read().versions.script===1&&S0.read().revision===0"));
  await evaluate("document.querySelector('#prepare').click();document.querySelector('#approve').click()");assert('approval-before-after-scope-rights',await evaluate("document.querySelector('#confirm').open&&['之前','之后','镜头2','许可','费用'].every(x=>document.querySelector('#confirm-summary').textContent.includes(x))"));await capture('approval-1440.png');
  await evaluate("document.querySelector('#confirm-apply').click();document.querySelector('#confirm-apply').click()");assert('apply-once',await evaluate('S0.read().revision===1&&S0.read().prepared===null'));
  await evaluate("document.querySelector('#export').click();document.querySelector('#prepare').click();document.querySelector('#concurrent').click();document.querySelector('#approve').click();document.querySelector('#confirm-apply').click()");assert('stale-base-refuses-keeps-human',await evaluate("S0.read().revision===2&&S0.read().prepared===null&&S0.read().humanText.includes('保留')&&document.querySelector('#toast').textContent.includes('409')"));
  await evaluate("document.querySelector('#prepare').click();document.querySelector('#cancel').click();document.querySelector('#late').click()");assert('cancel-late-quarantine',await evaluate("S0.read().revision===2&&document.querySelector('#toast').textContent.includes('隔离')"));
  await evaluate("document.querySelector('#prepare').click();document.querySelector('#reopen').click()");await wait(900);assert('reopen-requires-new-prepare',await evaluate('S0.read().revision===2&&S0.read().prepared===null&&S0.read().exports.length===1&&S0.read().claimReviewed'));
  await evaluate("document.querySelector('#disconnect').click()");assert('offline-unknown-and-submit-disabled',await evaluate("document.querySelector('#services').textContent.includes('未知')&&document.querySelector('#prepare').disabled"));await evaluate("document.querySelector('#recover').click();document.querySelector('#resource-error').click()");assert('transient-not-attention',await evaluate('S0.read().attention===false&&S0.read().revision===2'));
  await evaluate("document.querySelector('[data-stage=B]').click();document.querySelectorAll('[data-candidate]')[1].click()");assert('candidate-selection-does-not-commit',await evaluate("S0.read().candidate===2&&S0.read().revision===2&&document.querySelectorAll('[data-candidate]')[1].getAttribute('aria-pressed')==='true'"));
  await evaluate("document.querySelector('[data-stage=C]').click();document.querySelector('#driver').value='DSH';document.querySelector('#handover').click()");assert('longform-unverified-not-fake-compatible',await evaluate("document.querySelector('#long-note').textContent.includes('NOT_RUN')&&document.querySelector('#long-note').textContent.includes('DSH')"));
  assert('storage-write-failure-degrades',await evaluate("(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('quota simulation')};try{document.querySelector('#resource-error').click();return document.querySelector('#storage-note').textContent.includes('无法持久')}finally{Storage.prototype.setItem=original}})()"));
  await evaluate("document.querySelector('[data-stage=A]').click();document.querySelector('[data-node=visual]').click()");
  for(const [width,height]of [[1440,1000],[390,844]]){await viewport(width,height);const v=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert('prototype-no-horizontal-overflow-'+width,v.scrollWidth<=width);receipt.viewports.push({artifact:'prototype',...v});await capture('prototype-'+width+'.png')}
  await evaluate("document.querySelector('[data-node=script]').click();document.querySelector('#editor').value='修改脚本，尚未重算旁白';document.querySelector('#editor').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#save').click()");assert('nonvisual-stale-not-falsely-adopted',await evaluate("document.querySelector('#prepare').disabled&&S0.read().stale.includes('voice')&&S0.read().revision===2"));
  assert('synthetic-storage-conflict-stops-writer',await evaluate("(()=>{dispatchEvent(new StorageEvent('storage',{key:'narralens-s0-prototype-v3',newValue:'{}'}));return S0.read().externalConflict&&document.querySelector('#prepare').disabled})()"));
  await navigate(join(output,'review.html'));for(const [width,height]of [[1440,1000],[390,844]]){await viewport(width,height);const v=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,count:document.querySelectorAll("[data-id]").length})');assert('review-layout-'+width,v.scrollWidth<=width&&v.count===17);receipt.viewports.push({artifact:'review',...v});await capture('review-'+width+'.png')}
  await evaluate("document.querySelector('[data-id=PX01] [value=change]').click();const t=document.querySelector('[data-id=PX01] textarea');t.value='需要核对简报';t.dispatchEvent(new Event('input',{bubbles:true}))");
  await call('Page.reload');await wait(800);assert('review-opinion-persistence',await evaluate("document.querySelector('[data-id=PX01] [value=change]').checked&&document.querySelector('[data-id=PX01] textarea').value==='需要核对简报'"));
  const downloadRoot=join(profile,'downloads');await mkdir(downloadRoot);await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:win(downloadRoot).replaceAll('/','\\'),eventsEnabled:true});await call('Runtime.evaluate',{expression:"document.querySelector('#download').click()",userGesture:true,returnByValue:true});let downloaded;for(let i=0;i<100;i++){try{const n=(await readdir(downloadRoot)).find(n=>n.endsWith('.json'));if(n){downloaded=JSON.parse(await readFile(join(downloadRoot,n),'utf8'));break}}catch{}await wait(100)}assert('review-opinions-download-bound-version',downloaded?.items.length===17&&downloaded.items[0].choice==='change'&&downloaded.revision===await evaluate('revision'));receipt.download={items:17,status:'pass'};
  receipt.status='pass';console.log(JSON.stringify({status:'pass',checks:receipt.checks.length,productionAcceptance:'NOT_RUN'}));
}catch(error){receipt.status='fail';receipt.error=String(error);console.error(error);process.exitCode=1}
finally{
  await writeFile(join(output,'browser-check.json'),JSON.stringify(receipt,null,2)+'\n');
  if(socket?.readyState===1){try{await call('Browser.close')}catch{}socket.close()}
  await wait(500);
  if(child?.exitCode===null){await new Promise(done=>{const cleanup=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$needle='--user-data-dir='+$env:NARRALENS_REVIEW_PROFILE; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($needle)} | ForEach-Object {taskkill.exe /PID $_.ProcessId /T /F | Out-Null}"],{env:{...process.env,NARRALENS_REVIEW_PROFILE:win(profile)},stdio:'ignore'});cleanup.once('exit',done);cleanup.once('error',done)})}
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
