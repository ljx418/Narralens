/** Host-owned native Studio child. No browser and no automatic external update check.
 * Private IPC is the only place the upstream launch key leaves this process.
 */
import {assertManagedEditor} from './managed-editor.mjs';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
import {installMediaProcessPolicy} from '../render/media-process-policy.mjs';
import pin from '../render/openfilm-render-pin.json' with {type:'json'};
import {pathToFileURL} from 'node:url';
let studio;
let stopping;
let stage='configuration';
const temporaryRoot=process.env.NARRALENS_STUDIO_TEMP_ROOT;
const stop=()=>stopping??=(async()=>{
 const force=setTimeout(()=>{try{process.kill(-process.pid,'SIGKILL');}catch{process.exit(1);}},5000);force.unref();
 try{await studio?.close();if(temporaryRoot)await rm(temporaryRoot,{recursive:true,force:true});}finally{clearTimeout(force);process.exit(0);}
})();
process.on('disconnect',()=>{void stop();});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void stop();});
process.on('message',message=>{if(message?.kind==='close')void stop();});
try{
 if(!process.send||!process.connected||!process.env.OPENFILM_HOME||!process.env.OPENFILM_LIBRARY||process.env.OPENFILM_NO_UPDATE_CHECK!=='1')throw new Error('INVALID_OWNED_STUDIO');
 const vendor=process.argv[2];if(!vendor)throw new Error('MISSING_PINNED_STUDIO');
 stage='offline_guard';
 for(const [relative,expected] of Object.entries(pin.guard_module_sha256??{})){
  if(createHash('sha256').update(readFileSync(new URL('../../../'+relative,import.meta.url))).digest('hex')!==expected)throw new Error('Guard pin mismatch');
 }
 installMediaProcessPolicy();
 process.env.NARRALENS_OPENFILM_ROOT=vendor;
 register(new URL('../render/openfilm-offline-hooks.mjs',import.meta.url),{data:{host_url:pathToFileURL(resolve(vendor,'packages/openfilm/src/host.mjs')).href,wrapper_url:new URL('./openfilm-studio-offline-wrapper.mjs',import.meta.url).href,marker:'?narralens-original'}});
 stage='module_load';
 const upstream=await import(pathToFileURL(resolve(vendor,'packages/openfilm/studio/server/server.mjs')).href);
 if(globalThis.__narralensOfflineGuard?.installed!==true)throw new Error('Offline guard absent');
 if(stopping)process.exit(0);
 stage='managed_editor';
 const managedDirectory=process.argv[3],managedRoot=process.argv[4];
 if(!!managedDirectory!==!!managedRoot)throw new Error('MANAGED_EDITOR_UNVERIFIED');
 const editorDir=managedDirectory?assertManagedEditor(managedDirectory,managedRoot,vendor):resolve(vendor,'packages/openfilm/studio/ui/dist');
 stage='start_studio';
 studio=await upstream.startStudio({port:0,openBrowser:()=>undefined,advertise:false,onQuit:()=>undefined,stays:true,editorDir,working:()=>[]});
 if(stopping||!process.connected){await studio.close();process.exit(0);}
 stage='ipc_ready';
 process.send({kind:'ready',offline_guard:true,origin:studio.origin,filmOrigin:studio.filmOrigin,port:studio.port,key:studio.key});
}catch(error){
 // No upstream exceptions/paths/provider configuration or launch key in stdout/stderr.
 if(process.connected)process.send?.({kind:'failed',stage,reason:['ENOMEM','EMFILE','ENFILE','EACCES','EPERM','ENOENT','EADDRINUSE','ERR_MODULE_NOT_FOUND','ERR_UNKNOWN_FILE_EXTENSION'].includes(error?.code)?error.code:'UPSTREAM_START_FAILED'});
 await stop();
}
