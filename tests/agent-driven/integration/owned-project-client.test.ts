import {it,expect,vi} from 'vitest';
import {discoverWorkbenchMode,openOwnedProject,readOwnedProjects} from '../../../src/app/owned-project-client.js';
const response=(body:unknown,status=200)=>vi.fn(async()=>new Response(JSON.stringify(body),{status})) as unknown as typeof fetch;
it('routes trusted UI to actual owned projects and only explicit legacy session to the previous page',async()=>{
 expect(await discoverWorkbenchMode(response({mode:'trusted_ui'}))).toBe('owned');
 expect(await discoverWorkbenchMode(response({token:'legacy',expires_at:'2030-01-01T00:00:00Z'}))).toBe('legacy');
 for(const f of [response({},401),response({}),response({mode:'other'})])await expect(discoverWorkbenchMode(f)).rejects.toThrow();
});
it('accepts only the exact selected project entry and rejects expired, remote and malformed destinations',async()=>{
 const body={format:'narralens.native-entry@1.0',project_id:'actual-project',revision:1,snapshot_id:'a'.repeat(64),native_state:'unconfirmed',expires_at:Date.now()+60000,url:'http://127.0.0.1:12345/narralens/entry#native_ticket='+'a'.repeat(43)};
 expect((await openOwnedProject('actual-project',response(body))).url).toBe(body.url);
 for(const patch of [{project_id:'other'},{expires_at:0},{url:'https://evil.example/'},{url:body.url.replace('12345','65536')},{native_state:'confirmed'}])await expect(openOwnedProject('actual-project',response({...body,...patch}))).rejects.toThrow();
 await expect(openOwnedProject('../escape',response(body))).rejects.toThrow();
});
it('validates saved facts and uses same-origin, noncached, nonredirecting authenticated transport',async()=>{
 const fetcher=response({format:'narralens.owned-projects@1.0',projects:[],next_after:null});
 expect((await readOwnedProjects('page-id',fetcher)).projects).toEqual([]);
 expect(fetcher).toHaveBeenCalledWith('/api/ui/v1/projects?after=page-id',expect.objectContaining({credentials:'same-origin',cache:'no-store',redirect:'error'}));
 await expect(readOwnedProjects(null,response({projects:[]}))).rejects.toThrow();
});
