import { describe,it,expect } from 'vitest';
import { ScopedAgentAuth } from '../../../src/host/agent-driven/scoped-auth.js';
const origin='http://127.0.0.1:4173';
const base={method:'POST',origin,authorization:undefined};
const fixture=()=>{let now=1000;const auth=new ScopedAgentAuth(()=>origin,()=>now);return {auth,advance:()=>now=2000};};
describe('MAIN scoped identities',()=>{
 it('keeps ordinary MCP credentials out of trusted UI and native bridge routes',()=>{
  const {auth}=fixture(),driver=auth.issue({principal_id:'local-user',channel:'authenticated',expires_at:2000});
  const request={...base,authorization:'Bearer '+driver.token};
  expect(auth.authenticate(request,'authenticated').channel).toBe('authenticated');
  expect(()=>auth.authenticate(request,'trusted_ui')).toThrow();expect(()=>auth.authenticate(request,'native_bridge')).toThrow();
 });
 it('requires the UI cookie plus CSRF, even when a genuine UI token is supplied as bearer',()=>{
  const {auth}=fixture(),ui=auth.issue({principal_id:'local-user',channel:'trusted_ui',expires_at:2000});
  expect(()=>auth.authenticate({...base,authorization:'Bearer '+ui.token,csrf:ui.csrf!},'trusted_ui')).toThrow();
  const request={...base,cookie:auth.cookieName+'='+ui.token};
  expect(()=>auth.authenticate(request,'trusted_ui')).toThrow();
  expect(()=>auth.authenticate({...request,csrf:'incorrect'},'trusted_ui')).toThrow();
  expect(auth.authenticate({...request,csrf:ui.csrf!},'trusted_ui')).toEqual(ui.principal);
 });
 it('supports actual same-origin browser GET metadata without accepting foreign or missing provenance',()=>{
  const {auth}=fixture(),ui=auth.issue({principal_id:'local-user',channel:'trusted_ui',expires_at:2000});
  const request={method:'GET',origin:undefined,authorization:undefined,cookie:auth.cookieName+'='+ui.token,referer:origin+'/workbench',secFetchSite:'same-origin'};
  expect(auth.authenticate(request,'authenticated')).toEqual(ui.principal);
  expect(()=>auth.authenticate({...request,referer:'http://127.0.0.1:9000/other'},'authenticated')).toThrow();
  expect(()=>auth.authenticate({...request,secFetchSite:'cross-site'},'authenticated')).toThrow();
  expect(()=>auth.authenticate({...request,origin:'null'},'authenticated')).toThrow();
 });
 it('does not promote native bridge credentials into content or human commands',()=>{
  const {auth}=fixture(),native=auth.issue({principal_id:'local-user',channel:'native_bridge',expires_at:2000});
  const request={...base,authorization:'Bearer '+native.token};
  expect(auth.authenticate(request,'native_bridge')).toEqual(native.principal);
  expect(()=>auth.authenticate(request,'authenticated')).toThrow();expect(()=>auth.authenticate(request,'trusted_ui')).toThrow();
 });
 it('revokes and expires actual issued credentials at exact boundary',()=>{
  const {auth,advance}=fixture(),first=auth.issue({principal_id:'local-user',channel:'authenticated',expires_at:2000});
  const request={...base,authorization:'Bearer '+first.token};
  auth.revoke(first.token);expect(()=>auth.authenticate(request,'authenticated')).toThrow();
  const second=auth.issue({principal_id:'local-user',channel:'authenticated',expires_at:2000});advance();
  expect(()=>auth.authenticate({...request,authorization:'Bearer '+second.token},'authenticated')).toThrow();
 });
 it('rejects duplicate/ambiguous credentials and injected actor metadata cannot grant human authority',()=>{
  const {auth}=fixture(),driver=auth.issue({principal_id:'local-user',channel:'authenticated',expires_at:2000});
  const request={...base,authorization:'Bearer '+driver.token};
  expect(()=>auth.authenticate({...request,rawHeaders:['Authorization','first','Authorization','second']},'authenticated')).toThrow();
  expect(()=>auth.authenticate({...request,cookie:auth.cookieName+'='+driver.token},'authenticated')).toThrow();
  expect(()=>auth.authenticate(Object.assign({},request,{actor:'human',channel:'trusted_ui'}),'trusted_ui')).toThrow();
  expect(()=>auth.authenticate({...request,origin:'http://127.0.0.1:9000'},'authenticated')).toThrow();
 });
});
