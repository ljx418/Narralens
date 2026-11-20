/** Studio's private background frames use the pinned `localhost` film origin.
 * Reuse the reviewed offline page/context guard and allow ONLY that name to resolve
 * to loopback; the renderer's older resolver intentionally knows only 127.0.0.1.
 * Never rewrite film URLs: their origin is also the native dependency-cache identity.
 */
export * from '../render/openfilm-offline-wrapper.mjs';
import {guardBrowser,guardedLaunchArgs} from '../render/openfilm-guard-rules.mjs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.NARRALENS_OPENFILM_ROOT;
if(!root)throw new Error('Missing pinned native root');
const original=await import(pathToFileURL(join(root,'packages/openfilm/src/host.mjs')).href+'?narralens-original');
export async function launch(options={}){
 const args=guardedLaunchArgs([...(options.args??[]),'--mute-audio']).map(value=>value.startsWith('--host-resolver-rules=')?'--host-resolver-rules=MAP localhost 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1':value);
 return guardBrowser(await original.launch({...options,headed:false,args}));
}
