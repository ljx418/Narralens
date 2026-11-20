import {it,expect,vi,afterEach} from 'vitest';
import {exchangeWorkbenchFragment} from '../../src/app/workbench-session.js';
import {HostApiClient} from '../../src/app/director/api/HostApiClient.js';
afterEach(()=>vi.unstubAllGlobals());
it('removes the entry secret before its only exchange request, without browser persistence',async()=>{
 const order:string[]=[],replaceState=vi.fn(()=>{order.push('clear');});
 const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{order.push('request');expect(init).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error'});expect(JSON.parse(init!.body as string)).toEqual({ticket:'a'.repeat(43)});return new Response(JSON.stringify({csrf:'b'.repeat(43)}));});
 await exchangeWorkbenchFragment({hash:'#workbench_ticket='+'a'.repeat(43),pathname:'/',search:''},{replaceState},fetcher);
 expect(order).toEqual(['clear','request']);expect(replaceState).toHaveBeenCalledWith(null,'','/');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('clears a malformed secret and stops; ordinary legacy entry performs no exchange',async()=>{
 const fetcher=vi.fn<typeof fetch>(),replaceState=vi.fn();
 await expect(exchangeWorkbenchFragment({hash:'#workbench_ticket=bad',pathname:'/',search:'?project=test'},{replaceState},fetcher)).rejects.toThrow('WORKBENCH_ENTRY_UNAVAILABLE');
 expect(replaceState).toHaveBeenCalledWith(null,'','/?project=test');expect(fetcher).not.toHaveBeenCalled();
 await exchangeWorkbenchFragment({hash:'',pathname:'/',search:''},{replaceState},fetcher);expect(fetcher).not.toHaveBeenCalled();
});
it('treats a failed exchange as unavailable instead of mounting a logged-out workbench',async()=>{
 await expect(exchangeWorkbenchFragment({hash:'#workbench_ticket='+'a'.repeat(43),pathname:'/',search:''},{replaceState:vi.fn()},async()=>new Response('{}',{status:401}))).rejects.toThrow('WORKBENCH_ENTRY_UNAVAILABLE');
});
it('uses the actual cookie-only UI transport and CSRF; never combines it with a legacy bearer',async()=>{
 const requests:{url:string;init:RequestInit|undefined}[]=[],csrf='a'.repeat(43);
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{requests.push({url,init});return new Response(JSON.stringify(url.endsWith('/api/session')?{mode:'trusted_ui'}:url.endsWith('/api/workbench/session')?{csrf}:{}));}));
 const client=new HostApiClient();await client.start();await client.project('project');await client.cancel('job');
 for(const request of requests.slice(2)){expect(request.init?.headers).toMatchObject({'X-Narralens-CSRF':csrf});expect(request.init?.headers).not.toHaveProperty('authorization');expect(request.init?.credentials).toBe('same-origin');}
});
