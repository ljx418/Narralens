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
