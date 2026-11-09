import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,chmod,symlink,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareManagedEditor,assertManagedEditor} from '../../../src/host/m5/managed-editor.mjs';
import pin from '../../../src/host/m5/managed-editor-pin.json' with {type:'json'};
const vendor='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
it('publishes exactly the fixed managed build, reuses it without writes and verifies independently before serving',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-managed-editor-'));
 try{
  const one=prepareManagedEditor(root,vendor);expect(one.build_sha256).toBe(pin.dist_manifest_sha256);expect(one.isCurrent()).toBe(true);
  expect(assertManagedEditor(one.directory,root,vendor)).toBe(one.directory);
  for(const file of pin.files){const bytes=await readFile(join(one.directory,file.path));expect(bytes.length).toBe(file.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);}
  const two=prepareManagedEditor(root,vendor);expect(two.directory).toBe(one.directory);expect(one.isCurrent()).toBe(true);
  const path=join(one.directory,'index.html');await chmod(path,0o600);await writeFile(path,'tampered native build');
  expect(one.isCurrent()).toBe(false);expect(()=>assertManagedEditor(one.directory,root,vendor)).toThrow('MANAGED_EDITOR_UNVERIFIED');expect(()=>prepareManagedEditor(root,vendor)).toThrow('MANAGED_EDITOR_UNVERIFIED');
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
it('rejects aliased roots, foreign editor directories, added files and unsupported vendor before serving',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-managed-alias-'));
 try{
  const privateRoot=join(root,'private');await mkdir(privateRoot);await symlink(privateRoot,join(root,'alias'),'dir');
  expect(()=>prepareManagedEditor(join(root,'alias'),vendor)).toThrow('MANAGED_EDITOR_UNVERIFIED');
  const editor=prepareManagedEditor(privateRoot,vendor);
  expect(()=>assertManagedEditor(editor.directory,root,vendor)).toThrow('MANAGED_EDITOR_UNVERIFIED');
  expect(()=>prepareManagedEditor(privateRoot,root)).toThrow('MANAGED_EDITOR_UNVERIFIED');
  await writeFile(join(editor.directory,'unexpected.js'),'not pinned');expect(editor.isCurrent()).toBe(false);
  expect(()=>assertManagedEditor(editor.directory,privateRoot,vendor)).toThrow('MANAGED_EDITOR_UNVERIFIED');
 }finally{await rm(root,{recursive:true,force:true});}
},30000);

it('invalidates the running guard if the runtime ancestor is replaced by an alias to the same files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-managed-ancestor-'));
 try{
  const runtime=join(root,'runtime'),moved=join(root,'moved');await mkdir(runtime);const editor=prepareManagedEditor(runtime,vendor);expect(editor.isCurrent()).toBe(true);
  await rename(runtime,moved);await symlink(moved,runtime,'dir');expect(editor.isCurrent()).toBe(false);
  expect(()=>assertManagedEditor(editor.directory,runtime,vendor)).toThrow('MANAGED_EDITOR_UNVERIFIED');
 }finally{await rm(root,{recursive:true,force:true});}
},30000);

it('the actual private child independently refuses a modified prepared editor rather than trusting parent arguments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-managed-child-'));let child:ReturnType<typeof spawn>|undefined;
 try{
  const editor=prepareManagedEditor(root,vendor),file=join(editor.directory,'index.html');await chmod(file,0o600);await writeFile(file,'modified after parent verification');
  await mkdir(join(root,'home'));await mkdir(join(root,'library'));await mkdir(join(root,'tmp'));
  child=spawn(process.execPath,[fileURLToPath(new URL('../../../src/host/m5/openfilm-studio-child.mjs',import.meta.url)),vendor,editor.directory,root],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env:{...process.env,OPENFILM_HOME:join(root,'home'),OPENFILM_LIBRARY:join(root,'library'),OPENFILM_NO_UPDATE_CHECK:'1',TMPDIR:join(root,'tmp'),NARRALENS_STUDIO_TEMP_ROOT:join(root,'tmp')}});
  const closed=new Promise<void>((resolve,reject)=>{child!.once('close',()=>resolve());child!.once('error',reject);});
  const message=await new Promise<unknown>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('MANAGED_CHILD_DID_NOT_ANSWER')),15000);child!.once('message',value=>{clearTimeout(timer);resolve(value);});child!.once('error',error=>{clearTimeout(timer);reject(error);});});
  expect(message).toMatchObject({kind:'failed',stage:'managed_editor'});await closed;
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const closing=new Promise<void>(resolve=>child!.once('close',()=>resolve()));child.kill('SIGKILL');await closing;}
  await rm(root,{recursive:true,force:true});
 }
},30000);
