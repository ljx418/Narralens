/** Host-selected immutable UI artifact. Never accepts a browser-selected directory.
 * Original upstream server/renderer/legacy UI remain separately pinned and unchanged.
 */
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFileSync,lstatSync,realpathSync,readdirSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import pin from './managed-editor-pin.json' with {type:'json'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(cause)=>{throw new Error('MANAGED_EDITOR_UNVERIFIED',cause?{cause}:undefined);};
const safePath=p=>typeof p==='string'&&p.length>0&&!p.includes('\\')&&!p.includes('\0')&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
function canonicalDirectory(root){
 const path=resolve(root);if(realpathSync(path)!==path||!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())fail();
 for(let p=path;;p=dirname(p)){if(lstatSync(p).isSymbolicLink())fail();if(p===dirname(p))break;}
 return path;
}
function pinnedVendor(vendorRoot){
 const vendor=canonicalDirectory(vendorRoot);
 const head=execFileSync('git',['-C',vendor,'rev-parse','HEAD'],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim();
 const dirty=execFileSync('git',['-C',vendor,'status','--porcelain','--untracked-files=no'],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});
 if(head!==pin.upstream_sha||dirty!==''||sha(readFileSync(join(vendor,'pnpm-lock.yaml')))!==pin.original_lock_sha256)fail();
 return vendor;
}
function verifyPin(){
 const manifest=JSON.stringify(pin.files.map(f=>({bytes:f.bytes,path:f.path,sha256:f.sha256})));
 if(sha(manifest)!==pin.dist_manifest_sha256||new Set(pin.files.map(f=>f.path)).size!==pin.files.length||pin.files.some(f=>!safePath(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/.test(f.sha256)))fail();
}
function identityGuard(root){
 const paths=[root,...pin.files.map(f=>join(root,f.path)),join(root,'assets')];
 const identify=path=>{const s=lstatSync(path,{bigint:true});if(s.isSymbolicLink())fail();return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');};
 const before=paths.map(identify);
 return ()=>{try{canonicalDirectory(root);return paths.every((path,i)=>identify(path)===before[i]);}catch{return false;}};
}
function result(root){return {directory:root,build_sha256:pin.dist_manifest_sha256,isCurrent:identityGuard(root)};}
function archiveFiles(){
 const compressed=readFileSync(new URL('./managed-editor-dist.tar.gz',import.meta.url));
 if(compressed.length!==pin.archive_bytes||sha(compressed)!==pin.archive_sha256)fail();
 const tar=gunzipSync(compressed,{maxOutputLength:4*1024*1024}),files=new Map();
 let offset=0;
 for(;offset+512<=tar.length;){
  const header=tar.subarray(offset,offset+512);if(header.every(b=>b===0))break;
  const str=(start,end)=>header.subarray(start,end).toString('utf8').replace(/\0.*$/s,'');
  const name=str(0,100),prefix=str(345,500),type=header[156],sizeText=str(124,136).trim();
  if(!/^[0-7]+$/.test(sizeText)||prefix!==''||type!==48&&type!==0||!safePath(name))fail();
  const size=parseInt(sizeText,8),start=offset+512,end=start+size;
  const sum=header.reduce((sum,b,i)=>sum+(i>=148&&i<156?32:b),0),saved=str(148,156).trim();
  if(!/^[0-7]+$/.test(saved)||parseInt(saved,8)!==sum||!Number.isSafeInteger(size)||end>tar.length||files.has(name))fail();
  const expected=pin.files.find(f=>f.path===name),bytes=tar.subarray(start,end);
  if(!expected||bytes.length!==expected.bytes||sha(bytes)!==expected.sha256)fail();files.set(name,bytes);
  offset=start+Math.ceil(size/512)*512;
 }
 if(files.size!==pin.files.length||tar.subarray(offset).some(b=>b!==0))fail();
 return files;
}
function verifyFiles(directory){
 const root=canonicalDirectory(directory),expected=new Map(pin.files.map(f=>[f.path,f]));
 const seen=new Set();
 function walk(folder){for(const name of readdirSync(folder)){
  const path=join(folder,name),rel=relative(root,path).split(sep).join('/'),st=lstatSync(path);
  if(st.isSymbolicLink())fail();
  if(st.isDirectory()){if(![...expected.keys()].some(p=>p.startsWith(rel+'/')))fail();walk(path);continue;}
  const fact=expected.get(rel);if(!st.isFile()||!fact||st.size!==fact.bytes||sha(readFileSync(path))!==fact.sha256)fail();seen.add(rel);
 }}
 walk(root);if(seen.size!==expected.size)fail();return root;
}
/** Parent uses only its already-private runtime root. Child verifies again before serving. */
export function prepareManagedEditor(runtimeRoot,vendorRoot){
 try{
  verifyPin();const parent=canonicalDirectory(runtimeRoot);pinnedVendor(vendorRoot);
  const target=join(parent,'editor-'+pin.dist_manifest_sha256);
  try{lstatSync(target);return result(verifyFiles(target));}
  catch(error){if(error?.code!=='ENOENT')throw error;}
  const files=archiveFiles(),stage=join(parent,'.editor-'+randomUUID());mkdirSync(stage,{mode:0o700});
  try{
   for(const [path,bytes] of files){const output=join(stage,path);mkdirSync(dirname(output),{recursive:true,mode:0o700});writeFileSync(output,bytes,{flag:'wx',mode:0o400});}
   verifyFiles(stage);
   try{renameSync(stage,target);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error?.code))throw error;verifyFiles(target);rmSync(stage,{recursive:true,force:true});}
   return result(verifyFiles(target));
  }catch(error){rmSync(stage,{recursive:true,force:true});throw error;}
 }catch(error){fail(error);}
}
export function assertManagedEditor(directory,runtimeRoot,vendorRoot){
 try{
  verifyPin();const parent=canonicalDirectory(runtimeRoot),expected=join(parent,'editor-'+pin.dist_manifest_sha256);
  if(resolve(directory)!==expected)fail();pinnedVendor(vendorRoot);return verifyFiles(expected);
 }catch(error){fail(error);}
}
