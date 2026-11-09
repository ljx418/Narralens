/** Runs before the existing Studio deferred modules. Secrets arrive only through a
 * one-use fragment exchange; no Host credential is ever given to this origin. */
export const CONTROLLED_NATIVE_ENTRY_HTML=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>打开叙镜工程</title><body><p role="status">正在打开工程…</p><script>
(async function(){
 var ticket=location.hash.startsWith('#native_ticket=')?location.hash.slice(15):'';
 history.replaceState(null,'',location.pathname);
 try{
  if(!/^[A-Za-z0-9_-]{43}$/.test(ticket))throw new Error('entry');
  var r=await fetch('/narralens/session/exchange',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:ticket})});ticket='';
  if(!r.ok)throw new Error('entry');var session=await r.json();
  if(!/^[A-Za-z0-9_-]{43}$/.test(session.csrf)||!/^\\/projects\\/[A-Za-z0-9_-]+\\?target=[A-Za-z0-9_-]+$/.test(session.path))throw new Error('entry');
  sessionStorage.setItem('narralens.native.session',JSON.stringify(session));location.replace(session.path);
 }catch(e){document.querySelector('[role=status]').textContent='工程入口已失效，请从叙镜工作台重新打开。';}
})();</script></body></html>`;
export const CONTROLLED_NATIVE_TRANSPORT_SCRIPT=`
(function(){'use strict';
 function session(){try{return JSON.parse(sessionStorage.getItem('narralens.native.session')||'null');}catch(e){return null;}}
 var initial=session();
 if(!initial||!/^[A-Za-z0-9_-]{43}$/.test(initial.csrf)||!/^[A-Za-z0-9_-]{43}$/.test(initial.read_token))return;
 var originalFetch=window.fetch.bind(window);
 window.fetch=function(input,init){
  var request=new Request(input,init),url=new URL(request.url,location.href),s=session();
  if(url.origin===location.origin&&(url.pathname.indexOf('/api/')===0||url.pathname.indexOf('/narralens/api/')===0||url.pathname.indexOf('/narralens/native/')===0)&&s){
   var headers=new Headers(request.headers);headers.set('X-Narralens-Native-CSRF',s.csrf);request=new Request(request,{headers:headers});
  }
  return originalFetch(request);
 };
 function mediaUrl(input){
  try{var url=new URL(input,location.href),s=session();
   if(s&&url.origin===location.origin&&new RegExp('^/api/projects/'+s.native_project_id+'/(media|poster)$').test(url.pathname)){
    url.searchParams.set('native_read',s.read_token);return url.href;
   }
  }catch(e){}return input;
 }
 window.narralensNativeTransport=Object.freeze({mediaUrl:mediaUrl,projectId:initial.project_id,nativeProjectId:initial.native_project_id});
 var RealSocket=window.WebSocket;
 function ScopedSocket(input,protocols){
  var url=new URL(input,location.href),s=session();
  var same=(url.protocol==='ws:'&&location.protocol==='http:'||url.protocol==='wss:'&&location.protocol==='https:')&&url.host===location.host;
  if(s&&same&&(url.pathname==='/api/events'||url.pathname==='/api/projects/'+s.native_project_id+'/events'))return new RealSocket(url.href,['narralens.read.v1',s.read_token]);
  return protocols===undefined?new RealSocket(input):new RealSocket(input,protocols);
 }
 Object.setPrototypeOf(ScopedSocket,RealSocket);ScopedSocket.prototype=RealSocket.prototype;window.WebSocket=ScopedSocket;
})();`;
