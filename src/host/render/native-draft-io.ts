import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { NativeDraftAsset, NativeDraftFile } from './assembly-ports.js';
import { NativeDraftError, checkDraftAbort } from './native-draft-plan.js';

function rejected(): never { throw new NativeDraftError('DRAFT_PATH_REJECTED', 'Draft paths must be private, distinct and outside every protected source domain'); }
function changed(): never { throw new NativeDraftError('DRAFT_SOURCE_CHANGED', 'Draft input or output identity changed'); }
const inside = (root: string, child: string): boolean => root === '/' || child === root || child.startsWith(root + sep);
const identity = (s: BigIntStats): string => `${s.dev}:${s.ino}`;
const fingerprint = (s: BigIntStats): string => `${identity(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
function absolute(path: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path !== resolve(path) || /[\u0000-\u001f]/.test(path)) rejected();
  return path;
}
/** Constructor-only fault boundary; never copied from NativeDraftRequest or a tool body. */
export interface DraftIoBoundaries {afterCreatedDirectoryStat?:(relative:string)=>Promise<void>;}
interface Directory { path: string; handle: FileHandle; stat: BigIntStats }
interface Input { asset: NativeDraftAsset; handle: FileHandle; stat: BigIntStats }
/** Linux/WSL fd-relative anchoring; it never follows a caller-provided link for a write. */
export class DraftWorkspace {
  readonly #dirs = new Map<string, Directory>();
  readonly #inputs = new Map<string, Input>();
  readonly #outputs = new Map<string, BigIntStats>();
  readonly #outputDirs = new Map<string, Directory>();
  #target: Directory | null = null;
  #parent: Directory | null = null;
  #createdStat: BigIntStats | null = null;
  #leaf = '';
  #finished = false;
  private constructor(readonly root: string, readonly signal?: AbortSignal,private readonly boundaries?:DraftIoBoundaries) {}
  static async create(root: string, protectedRoots: readonly string[], assets: readonly NativeDraftAsset[], signal?: AbortSignal,boundaries?:DraftIoBoundaries): Promise<DraftWorkspace> {
    const workspace = new DraftWorkspace(absolute(root), signal,boundaries);
    try { await workspace.#initialize(protectedRoots, assets); return workspace; }
    catch (error) { await workspace.dispose(); throw error; }
  }
  #at(directory: Directory, name = ''): string { return `/proc/self/fd/${directory.handle.fd}${name ? '/' + name : ''}`; }
  async #directory(path: string): Promise<Directory> {
    absolute(path);
    const known = this.#dirs.get(path); if (known) return known;
    const parent = path === '/' ? null : await this.#directory(dirname(path));
    const handle = await open(parent ? this.#at(parent, basename(path)) : '/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isDirectory() || await realpath(this.#at({ path, handle, stat })) !== path) rejected();
      const directory = { path, handle, stat }; this.#dirs.set(path, directory); return directory;
    } catch (error) { await handle.close(); throw error; }
  }
  async #initialize(protectedRoots: readonly string[], assets: readonly NativeDraftAsset[]): Promise<void> {
    checkDraftAbort(this.signal);
    const getuid = process.getuid;
    if (process.platform !== 'linux' || !getuid || this.root === '/' || protectedRoots.length === 0) rejected();
    const uid = BigInt(getuid());
    const paths = [...protectedRoots.map(absolute), ...assets.map(asset => dirname(absolute(asset.absolute_path)))];
    if (paths.some(path => inside(path, this.root) || inside(this.root, path))) rejected();
    const domains = [];
    for (const path of new Set(paths)) { checkDraftAbort(this.signal); domains.push(await this.#directory(path)); }
    this.#parent = await this.#directory(dirname(this.root));
    if (this.#parent.stat.uid !== uid || (this.#parent.stat.mode & 0o077n) !== 0n) rejected();
    // A mounted alias can share identity without sharing its textual path.
    for (const directory of this.#dirs.values()) {
      if (inside(directory.path, dirname(this.root)) && domains.some(domain => identity(domain.stat) === identity(directory.stat))) rejected();
    }
    const seen = new Set<string>();
    for (const asset of assets) {
      checkDraftAbort(this.signal);
      const parent = await this.#directory(dirname(asset.absolute_path));
      const handle = await open(this.#at(parent, basename(asset.absolute_path)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile() || stat.size !== BigInt(asset.bytes) || seen.has(identity(stat)) || await realpath(`/proc/self/fd/${handle.fd}`) !== asset.absolute_path) rejected();
        seen.add(identity(stat)); this.#inputs.set(asset.asset_id, { asset, handle, stat });
      } catch (error) { await handle.close(); throw error; }
    }
    await this.verify(); checkDraftAbort(this.signal);
    this.#leaf = basename(this.root);
    // Not recursive; EEXIST never becomes owned and is never cleaned up.
    await mkdir(this.#at(this.#parent, this.#leaf), { mode: 0o700 });
    this.#createdStat = await lstat(this.#at(this.#parent, this.#leaf), { bigint: true });
    if(!this.#createdStat.isDirectory()||this.#createdStat.isSymbolicLink())changed();
    await this.boundaries?.afterCreatedDirectoryStat?.('');
    const handle = await open(this.#at(this.#parent, this.#leaf), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat({ bigint: true });
      if(!stat.isDirectory()||identity(stat)!==identity(this.#createdStat!))changed();
      this.#target = { path: this.root, handle, stat };
      this.#outputDirs.set('', this.#target);
      if ((stat.mode & 0o077n) !== 0n || stat.uid !== uid) rejected();
    } catch (error) { if (!this.#target) await handle.close(); throw error; }
    await this.verify();
  }
  async verify(): Promise<void> {
    checkDraftAbort(this.signal);
    for (const directory of this.#dirs.values()) {
      const current = await lstat(directory.path, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || identity(current) !== identity(directory.stat)) changed();
    }
    for (const input of this.#inputs.values()) {
      const current = await lstat(input.asset.absolute_path, { bigint: true });
      if (!current.isFile() || fingerprint(current) !== fingerprint(input.stat) || fingerprint(await input.handle.stat({ bigint: true })) !== fingerprint(input.stat)) changed();
    }
    if (this.#parent && (await this.#parent.handle.stat({ bigint: true })).mode !== this.#parent.stat.mode) changed();
    for (const directory of this.#outputDirs.values()) {
      const current = await lstat(directory.path, { bigint: true });
      if (!current.isDirectory() || identity(current) !== identity(directory.stat) || (current.mode & 0o077n) !== 0n) changed();
    }
  }
  async #outDirectory(relative: string): Promise<Directory> {
    const known = this.#outputDirs.get(relative); if (known) return known;
    const parentPath = dirname(relative) === '.' ? '' : dirname(relative);
    const parent = await this.#outDirectory(parentPath);
    checkDraftAbort(this.signal);
    await mkdir(this.#at(parent, basename(relative)), { mode: 0o700 });
    const created=await lstat(this.#at(parent,basename(relative)),{bigint:true});
    if(!created.isDirectory()||created.isSymbolicLink())changed();
    await this.boundaries?.afterCreatedDirectoryStat?.(relative);
    const handle = await open(this.#at(parent, basename(relative)), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let tracked = false;
    try {
      const stat = await handle.stat({ bigint: true });
      if(!stat.isDirectory()||identity(stat)!==identity(created))changed();
      const directory = { path: join(this.root, relative), handle, stat }; this.#outputDirs.set(relative, directory); tracked = true;
      if ((stat.mode & 0o077n) !== 0n) rejected();
      return directory;
    } catch (error) { if (!tracked) await handle.close(); throw error; }
  }
  #relative(path: string): void {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(path) || isAbsolute(path) || path.split('/').some(part => !part || part === '.' || part === '..') || this.#outputs.has(path)) rejected();
  }
  async #write(path: string, chunks: AsyncIterable<Uint8Array>): Promise<NativeDraftFile> {
    this.#relative(path); checkDraftAbort(this.signal); await this.verify();
    const directory = await this.#outDirectory(dirname(path) === '.' ? '' : dirname(path));
    const handle = await open(this.#at(directory, basename(path)), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256'); let bytes = 0;
    try {
      this.#outputs.set(path, await handle.stat({ bigint: true }));
      for await (const chunk of chunks) {
        checkDraftAbort(this.signal); hash.update(chunk); bytes += chunk.byteLength;
        let at = 0;
        while (at < chunk.byteLength) { checkDraftAbort(this.signal); const { bytesWritten } = await handle.write(chunk, at, chunk.byteLength - at); if (bytesWritten <= 0) throw new NativeDraftError('DRAFT_IO_FAILED', 'Draft write made no progress'); at += bytesWritten; }
      }
      await handle.sync(); this.#outputs.set(path, await handle.stat({ bigint: true }));
    } finally { await handle.close(); }
    await this.verify();
    return { relative_path: path, bytes, sha256: hash.digest('hex') };
  }
  async writeText(path: string, text: string): Promise<NativeDraftFile> {
    async function* chunks(): AsyncGenerator<Uint8Array> { yield Buffer.from(text, 'utf8'); }
    return this.#write(path, chunks());
  }
  async copyAsset(id: string, path: string): Promise<NativeDraftFile> {
    const input = this.#inputs.get(id); if (!input) rejected();
    const signal = this.signal;
    async function* chunks(): AsyncGenerator<Uint8Array> {
      let position = 0;
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        checkDraftAbort(signal);
        const { bytesRead } = await input!.handle.read(buffer, 0, Math.min(buffer.length, input!.asset.bytes + 1 - position), position);
        if (!bytesRead) break;
        position += bytesRead;
        if (position > input!.asset.bytes) changed();
        yield buffer.subarray(0, bytesRead);
      }
    }
    const copied = await this.#write(path, chunks());
    if (copied.sha256 !== input.asset.sha256 || copied.bytes !== input.asset.bytes) changed();
    return copied;
  }
  async finish(files: readonly NativeDraftFile[]): Promise<void> {
    await this.verify();
    if (files.length !== this.#outputs.size || new Set(files.map(file => file.relative_path)).size !== files.length) changed();
    for (const [relative, directory] of this.#outputDirs) {
      const expected = [
        ...[...this.#outputs.keys()].filter(path => (dirname(path) === '.' ? '' : dirname(path)) === relative).map(path => basename(path)),
        ...[...this.#outputDirs.keys()].filter(path => path && (dirname(path) === '.' ? '' : dirname(path)) === relative).map(path => basename(path)),
      ].sort();
      if (JSON.stringify((await readdir(this.#at(directory))).sort()) !== JSON.stringify(expected)) changed();
    }
    // Re-read exact final bytes via the owned directory fd; hash returned descriptors, not just write buffers.
    for (const file of files) {
      checkDraftAbort(this.signal);
      const parent = this.#outputDirs.get(dirname(file.relative_path) === '.' ? '' : dirname(file.relative_path)); if (!parent) changed();
      const handle = await open(this.#at(parent, basename(file.relative_path)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile() || fingerprint(stat) !== fingerprint(this.#outputs.get(file.relative_path)!)) changed();
        const hash = createHash('sha256'); let bytes = 0; const buffer = Buffer.allocUnsafe(1024 * 1024);
        for (;;) { checkDraftAbort(this.signal); const read = await handle.read(buffer, 0, buffer.length, bytes); if (!read.bytesRead) break; bytes += read.bytesRead; if (bytes > file.bytes) changed(); hash.update(buffer.subarray(0, read.bytesRead)); }
        if (bytes !== file.bytes || hash.digest('hex') !== file.sha256 || fingerprint(await handle.stat({ bigint: true })) !== fingerprint(stat)) changed();
      } finally { await handle.close(); }
    }
    for (const directory of [...this.#outputDirs.values()].reverse()) await directory.handle.sync();
    await this.#parent!.handle.sync(); await this.verify(); checkDraftAbort(this.signal);
    this.#finished = true;
  }
  async dispose(): Promise<void> {
    let failed = false;
    try {
      if (!this.#finished && this.#createdStat && this.#parent) {
        // Never recurse through names that may now point somewhere else. Remove only held/recorded inodes.
        for (const [relative, stat] of [...this.#outputs].reverse()) {
          const directory = this.#outputDirs.get(dirname(relative) === '.' ? '' : dirname(relative));
          if (!directory) { failed = true; continue; }
          const path = this.#at(directory, basename(relative));
          const current = await lstat(path, { bigint: true }).catch(() => null);
          if (current && identity(current) === identity(stat) && !current.isDirectory()) await unlink(path);
          else if (current) failed = true;
        }
        for (const [relative, directory] of [...this.#outputDirs].reverse()) {
          if (!relative) continue;
          const parent = this.#outputDirs.get(dirname(relative) === '.' ? '' : dirname(relative));
          if (!parent) { failed = true; continue; }
          const path = this.#at(parent, basename(relative));
          const current = await lstat(path, { bigint: true }).catch(() => null);
          if (current?.isDirectory() && identity(current) === identity(directory.stat)) await rmdir(path);
          else if (current) failed = true;
        }
        const path = this.#at(this.#parent, this.#leaf);
        const current = await lstat(path, { bigint: true }).catch(() => null);
        if (current?.isDirectory() && identity(current) === identity(this.#createdStat)) await rmdir(path);
        else if (current) failed = true;
        // A renamed/replaced root is never guessed at or removed as someone else's path.
      }
    } catch { failed = true;
    } finally {
      const handles = [...this.#inputs.values(), ...[...this.#outputDirs.values()].reverse(), ...[...this.#dirs.values()].reverse()].map(value => value.handle);
      if ((await Promise.allSettled(handles.map(handle => handle.close()))).some(result => result.status === 'rejected')) failed = true;
    }
    if (failed) throw new NativeDraftError('DRAFT_IO_FAILED', 'Native draft cleanup could not be confirmed');
  }
}
