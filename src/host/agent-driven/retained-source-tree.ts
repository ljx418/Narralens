import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,lstatSync,realpathSync,fstatSync,readdirSync,readSync,type BigIntStats} from 'node:fs';
import {dirname,basename,resolve,sep} from 'node:path';
import {canonicalDigest} from '../creative/digest.js';
import {ProductError} from '../creative/trusted-context.js';
import {assertSafeRelativePath} from '../render/snapshot-copy.js';
import type {PreparedSourceFileFact} from './created-source-ports.js';
function fail(_code:'REVISION_CONFLICT',message:string):never{throw new ProductError('REVISION_CONFLICT',message);}

/** A retained tree guards original file descriptors, names and complete membership. */
export class RetainedSourceTree {
  readonly #dirs = new Map<string, {fd:number; identity:string}>();
  readonly #files = new Map<string, {fd:number; fingerprint:string; bytes:number; sha256:string}>();
  #closed = false;
  #root:string;
  get root():string{return this.#root;}
  constructor(root:string, files:readonly PreparedSourceFileFact[], private readonly whole=true) {
    this.#root=root;
    try {
      this.#directory(root);
      for (const file of files) {
        assertSafeRelativePath(file.relative_path);
        const path=resolve(root,file.relative_path),parent=this.#directory(dirname(path));
        const fd=openSync(`/proc/self/fd/${parent.fd}/${basename(path)}`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        this.#files.set(file.relative_path,{fd,fingerprint:'',bytes:file.bytes,sha256:file.sha256});
        const info=fstatSync(fd,{bigint:true});
        this.#files.set(file.relative_path,{fd,fingerprint:stamp(info),bytes:file.bytes,sha256:file.sha256});
        if(!info.isFile())fail('REVISION_CONFLICT','The source entry is not a regular file');
      }
      this.verify();
    } catch(error) { this.close(); throw error; }
  }
  /** Follow the actual retained directory through a Host rename. Never reopen the
   * backup and establish a new inode as authority merely because its bytes match. */
  relocatedTo(nextRoot:string):void {
    if(this.#closed||resolve(nextRoot)!==nextRoot)fail('REVISION_CONFLICT','Invalid backup relocation');
    const original=this.#dirs.get(this.#root);
    if(!original||realpathSync(`/proc/self/fd/${original.fd}`)!==nextRoot)
      fail('REVISION_CONFLICT','Original backup identity was not retained');
    const previous=this.#root,entries=[...this.#dirs.entries()];
    for(const [path] of entries)if(path===previous||path.startsWith(previous+sep))this.#dirs.delete(path);
    for(const [path,value] of entries)if(path===previous||path.startsWith(previous+sep))this.#dirs.set(nextRoot+path.slice(previous.length),value);
    this.#root=nextRoot;this.#directory(dirname(nextRoot));this.verify();
  }
  #directory(path:string):{fd:number;identity:string} {
    const old=this.#dirs.get(path);if(old)return old;
    const parent=path==='/'?null:this.#directory(dirname(path));
    const fd=openSync(parent?`/proc/self/fd/${parent.fd}/${basename(path)}`:'/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    const entry={fd,identity:''};this.#dirs.set(path,entry);const info=fstatSync(fd,{bigint:true});entry.identity=directoryStamp(info);
    if(!info.isDirectory()||realpathSync(`/proc/self/fd/${fd}`)!==path)fail('REVISION_CONFLICT','Source root identity differs');
    return entry;
  }
  verify():void {
    if(this.#closed)fail('REVISION_CONFLICT','The source guard was released');
    for(const [path,d] of this.#dirs){
      const named=lstatSync(path,{bigint:true});
      if(!named.isDirectory()||named.isSymbolicLink()||directoryStamp(named)!==d.identity
        ||directoryStamp(fstatSync(d.fd,{bigint:true}))!==d.identity||realpathSync(path)!==path)
        fail('REVISION_CONFLICT','A source directory changed');
    }
    for(const [relative,file] of this.#files){
      const path=resolve(this.root,relative),d=this.#dirs.get(dirname(path));if(!d)fail('REVISION_CONFLICT','Source parent missing');
      const named=lstatSync(`/proc/self/fd/${d.fd}/${basename(path)}`,{bigint:true});
      if(!named.isFile()||named.isSymbolicLink()||stamp(named)!==file.fingerprint
        ||stamp(fstatSync(file.fd,{bigint:true}))!==file.fingerprint)fail('REVISION_CONFLICT','A source file identity changed');
      const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let offset=0;
      for(;;){const n=readSync(file.fd,buffer,0,buffer.length,offset);if(!n)break;offset+=n;if(offset>file.bytes)fail('REVISION_CONFLICT','Source size changed');hash.update(buffer.subarray(0,n));}
      if(offset!==file.bytes||hash.digest('hex')!==file.sha256||stamp(fstatSync(file.fd,{bigint:true}))!==file.fingerprint)
        fail('REVISION_CONFLICT','Source bytes changed');
    }
    if(this.whole){
      const found:string[]=[];
      const walk=(path:string,prefix:string):void=>{
        const directory=this.#dirs.get(path);if(!directory)fail('REVISION_CONFLICT','Unproven directory');
        for(const name of readdirSync(`/proc/self/fd/${directory.fd}`)){
          const rel=prefix?`${prefix}/${name}`:name,full=resolve(this.root,rel),s=lstatSync(`/proc/self/fd/${directory.fd}/${name}`);
          if(s.isSymbolicLink())fail('REVISION_CONFLICT','Source link refused');
          if(s.isDirectory())walk(full,rel);else if(s.isFile())found.push(rel);else fail('REVISION_CONFLICT','Unknown source entry');
        }
      };walk(this.root,'');
      if(canonicalDigest(found.sort())!==canonicalDigest([...this.#files.keys()].sort()))fail('REVISION_CONFLICT','Source closure membership changed');
    }
  }
  close():void {if(this.#closed)return;this.#closed=true;let failed=false;for(const f of [...this.#files.values()].reverse())try{closeSync(f.fd);}catch{failed=true;}
    for(const d of [...this.#dirs.values()].reverse())try{closeSync(d.fd);}catch{failed=true;}
    this.#files.clear();this.#dirs.clear();if(failed)fail('REVISION_CONFLICT','Source descriptors could not be closed');}
}
const directoryStamp=(s:BigIntStats)=>`${s.dev}:${s.ino}:${s.mode}:${s.uid}`;
const stamp=(s:BigIntStats)=>`${directoryStamp(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
