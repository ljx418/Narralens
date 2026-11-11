import {mkdtemp,mkdir,writeFile,rename,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,it,expect} from 'vitest';
import {RetainedSourceTree} from '../../../src/host/agent-driven/retained-source-tree.js';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'narralens-retained-tree-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'),backup=join(root,'backup');await mkdir(source);
 const bytes=Buffer.from('<p>original</p>');await writeFile(join(source,'film.html'),bytes);
 const guard=new RetainedSourceTree(source,[{relative_path:'film.html',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]);
 cleanup.push(async()=>guard.close());return {root,source,backup,bytes,guard};
}
describe('retained source descriptor identity across publication rename',()=>{
 it('reads original metadata through its retained descriptor and bounds allocation',async()=>{
  const f=await fixture();expect(f.guard.readBytes('film.html')).toEqual(f.bytes);
  expect(()=>f.guard.readBytes('film.html',1)).toThrow(/bounded/);
  await writeFile(join(f.source,'replacement'),f.bytes);await rename(join(f.source,'replacement'),join(f.source,'film.html'));
  expect(()=>f.guard.readBytes('film.html')).toThrow(/identity changed/);
 });
 it('follows the actual original descriptor to its backup location',async()=>{
  const f=await fixture();await rename(f.source,f.backup);f.guard.relocatedTo(f.backup);
  expect(()=>f.guard.verify()).not.toThrow();expect(f.guard.root).toBe(f.backup);
 });
 it('refuses a same-byte file replacement before the retained root is re-bound',async()=>{
  const f=await fixture();await rename(f.source,f.backup);
  const file=join(f.backup,'film.html'),other=join(f.backup,'replacement');await writeFile(other,f.bytes);await rename(other,file);
  expect(await readFile(file)).toEqual(f.bytes);
  expect(()=>f.guard.relocatedTo(f.backup)).toThrow(/identity changed/);
 });
 it('refuses a same-byte replacement of the whole backup directory',async()=>{
  const f=await fixture();await rename(f.source,f.backup);await rename(f.backup,join(f.root,'retained-original'));
  await mkdir(f.backup);await writeFile(join(f.backup,'film.html'),f.bytes);
  expect(()=>f.guard.relocatedTo(f.backup)).toThrow(/backup identity/);
 });
 it('rejects newly added closure members and refuses use after release',async()=>{
  const f=await fixture();await writeFile(join(f.source,'unapproved.txt'),'extra');expect(()=>f.guard.verify()).toThrow(/membership/);
  f.guard.close();expect(()=>f.guard.verify()).toThrow(/released/);
 });
});


it('captures stable frozen identities from held descriptors across a real rename',async()=>{
 const f=await fixture(),before=f.guard.identity(),parent=f.guard.directoryIdentity(f.root);
 expect(Object.isFrozen(before)).toBe(true);expect(Object.isFrozen(before.files[0])).toBe(true);
 expect(before.directories[0]?.relative_path).toBe('');expect(before.files[0]?.relative_path).toBe('film.html');
 expect(parent.ino).toMatch(/^[1-9][0-9]*$/);expect(Object.keys(parent).sort()).toEqual(['dev','ino']);
 await rename(f.source,f.backup);f.guard.relocatedTo(f.backup);expect(f.guard.identity()).toEqual(before);
 expect(()=>f.guard.directoryIdentity(join(f.root,'not-held'))).toThrow(/not retained/);
 f.guard.close();expect(()=>f.guard.identity()).toThrow(/released/);
});
it('distinguishes a freshly opened same-byte replacement from the persisted file identity',async()=>{
 const f=await fixture(),before=f.guard.identity();
 const replacement=join(f.source,'replacement');await writeFile(replacement,f.bytes);await rename(replacement,join(f.source,'film.html'));
 const fresh=new RetainedSourceTree(f.source,[{relative_path:'film.html',bytes:f.bytes.length,sha256:createHash('sha256').update(f.bytes).digest('hex')}]);
 cleanup.push(async()=>fresh.close());
 expect(fresh.identity().files[0]?.sha256).toBe(before.files[0]?.sha256);
 expect(fresh.identity().files[0]?.ino).not.toBe(before.files[0]?.ino);
 expect(()=>f.guard.identity()).toThrow(/identity changed/);
});


it('moves through retained parents and syncs them without releasing identity',async()=>{
 const f=await fixture(),parent=new RetainedSourceTree(f.root,[],false),before=f.guard.identity();cleanup.push(async()=>parent.close());
 f.guard.moveTo(f.backup,parent);parent.syncDirectory();expect(f.guard.identity()).toEqual(before);expect(f.guard.root).toBe(f.backup);
 expect(await readFile(join(f.backup,'film.html'))).toEqual(f.bytes);
});
it('refuses even an empty existing destination instead of replacing its identity',async()=>{
 const f=await fixture(),parent=new RetainedSourceTree(f.root,[],false);cleanup.push(async()=>parent.close());await mkdir(f.backup);
 const identity=parent.directoryIdentity(f.root);expect(()=>f.guard.moveTo(f.backup,parent)).toThrow(/already exists/);
 expect(await readFile(join(f.source,'film.html'))).toEqual(f.bytes);expect(parent.directoryIdentity(f.root)).toEqual(identity);
});
it('refuses wrong parent, read-only partial source and released sync operations',async()=>{
 const f=await fixture(),parent=new RetainedSourceTree(f.root,[],false);cleanup.push(async()=>parent.close());
 expect(()=>f.guard.moveTo(join(f.root,'nested','target'),parent)).toThrow(/Invalid/);
 expect(()=>parent.moveTo(f.backup,parent)).toThrow(/Invalid/);parent.close();expect(()=>parent.syncDirectory()).toThrow(/released/);
});
