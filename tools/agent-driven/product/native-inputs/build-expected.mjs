/** Build candidate only. Must not be executed until MAIN resource admission. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, copyFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const entryRoot = dirname(fileURLToPath(import.meta.url));
const nativeTools = resolve(entryRoot, '../../../managed-native-observation/source/packages/openfilm');
const vitePackage = JSON.parse(await readFile(resolve(nativeTools, 'node_modules/vite/package.json'), 'utf8'));
if (vitePackage.version !== '7.3.7') throw Error('PINNED_NATIVE_VITE_REQUIRED');
if (process.env.NODE_PATH) throw Error('UNSET_NODE_PATH_REQUIRED');
const { build } = await import(pathToFileURL(resolve(nativeTools, 'node_modules/vite/dist/node/index.js')).href);
await build({ configFile: resolve(entryRoot, 'vite.expected.config.mjs'), configLoader: 'native' });
const out = resolve(entryRoot, '../../dist');
const library = await readFile(resolve(out, 'native-pure-library.mjs'), 'utf8');
// The selected original pure exports must tree-shake all unrelated transport, hooks, I/O and clocks.
if (/\b(?:node:fs|node:child_process|node:http|node:https|node:net)|\b(?:fetch\s*\(|window\.|document\.|localStorage|useSyncExternalStore|setTimecodeFps|currentFps|NativeHydrationObserver|AudioContext)/.test(library))
  throw Error('NON_PURE_NATIVE_LIBRARY_RESIDUE');
for (const name of ['expected-projection.mjs', 'expected-projection.d.ts']) await copyFile(resolve(entryRoot, name), resolve(out, name));
await copyFile(resolve(entryRoot, '../LICENSE'), resolve(out, 'NATIVE_LICENSE.txt'));
const files = [];
for (const path of (await readdir(out)).sort()) {
  const data = await readFile(resolve(out, path)); files.push({ path, bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') });
}
const manifest = { kind: 'narralens.native-expected-projection-build@1', upstream_sha: 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3',
  vite: vitePackage.version, node: process.version, files,
  files_sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), runtime_tests: 'NOT_RUN' };
await writeFile(resolve(out, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
