#!/usr/bin/env tsx
/**
 * The native hydration build (A-R2, L06).
 *
 * It prepares the private runtime root of the pinned native candidate and runs the
 * *pinned* build. It never builds anything of its own: the actual library is produced
 * by the pinned `build-expected.mjs`, and this tool only
 *
 * 1. re-hashes the tracked inputs and refuses to continue if one of them moved,
 * 2. stages the pinned upstream source and the pinned 013 patch into this worktree's
 *    private root,
 * 3. refuses to build unless the *pinned* offline toolchain is already present,
 * 4. runs the pinned build,
 * 5. records what was built, with the digests MAIN needs to approve it.
 *
 * It never installs anything, never reaches the network, never writes to `vendor` and
 * never writes outside `var/native-hydration-r2`. The upstream repository it reads is
 * read-only: it is read with `git archive` at the pinned commit.
 *
 * Usage (from the repository root):
 *
 *   corepack pnpm exec tsx tools/agent-driven/product/build-native-hydration.ts \
 *     --upstream /mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm
 *
 * `--stage-only` prepares the tree and prints the digests without building; `--build`
 * additionally runs the pinned build. Without a build, the expected side stays
 * fail-closed: the loader refuses an unapproved candidate.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
const inputsRoot = resolve(here, 'native-inputs');
const runtimeRoot = resolve(repositoryRoot, 'var/native-hydration-r2');
const expectedRoot = resolve(runtimeRoot, 'managed-native-expected');
const observationRoot = resolve(runtimeRoot, 'managed-native-observation');

/** The pinned upstream the candidate was cut from. */
const UPSTREAM_SHA = 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3';
/** The pinned 013 candidate patch. */
const PATCH_SHA256 = 'f699889206e129dfe4fd913618b34baa8d7e04363f1940d3659664a1e7b9d435';
/** The pinned native toolchain. Anything else is refused. */
const PINNED_VITE = '7.3.7';
const PINNED_REACT = '19.3.0';

/** The tracked inputs and their pinned digests. */
const PINNED_INPUTS: Readonly<Record<string, string>> = Object.freeze({
  'build-expected.mjs': '60027ead5a509522f2d35fda33749675923dee523bb8cc12f2b7de3dca8f840d',
  'expected-projection.d.ts': '0f5f565a3d8b70de995aeb0dfdfb6052acad53cbf452c8d70168f555a8937f80',
  'expected-projection.mjs': '3500b1d6485791b13ec9364c6eb80740531142c16754877e21923ad73e9d494e',
  'native-pure.entry.ts': '1ca8590535d412f0d91a522fbf942cbacabba7d95c64f3e849ca9f0fbf416354',
  'request013.patch': PATCH_SHA256,
  'vite.expected.config.mjs': 'ffac37faeb5e9fcc53460f19d235cc9c38251b3bf969a9183e8cffe5e0657f29',
});

/** The files the pinned 013 patch touches, and their post-patch digests. */
const PINNED_PATCHED_FILES: Readonly<Record<string, string>> = Object.freeze({
  'packages/openfilm/studio/ui/src/lib/host.ts': '62facd2ebf670defb1d4ba100c2fe6e26c0a6227bde8ba5d85482b337e959f0b',
  'packages/openfilm/studio/ui/src/editor/use-film.ts': '61d38d1c3d0e74f3c5a1d127d71e9b0192de4980c7411dc7d2555c4efe57033b',
  'packages/openfilm/studio/ui/src/components/ProjectView.tsx': '93cc1f7c5c02e8e8e20a8c10b97bce2a48f993c2130a4530a5be33ef2fbb7b30',
  'packages/openfilm/studio/ui/src/lib/media-queue.ts': '669b2add59d9cdbe2e53a438fd0de47f717f35ef6d7879bd13bb2c36ad474d25',
  'packages/openfilm/studio/ui/src/lib/use-film-subtitles.ts': '412ffbc8ac47ef23a92c78bd1c89f9878c8a7bcbf31c31801eac72aa2693eb80',
  'packages/openfilm/studio/ui/src/lib/use-subtitle-style.ts': '901128d7b6a847ca1612dd2fd9e861f700e1ad30f33fc78b56e03c880633e995',
  'packages/openfilm/studio/ui/src/components/use-editor-tools.tsx': 'ae9e8c021a800b2d97b6c40c56f3cc8f6f4bf8bf8b24d453d68e3d33b5f5de67',
  'packages/openfilm/studio/ui/src/lib/native-hydration.ts': '5db47837e690590c9e9678a97e53a10a7115631bd05807ddf6afc925904e2f64',
});

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const digestOf = (path: string): string => sha256(readFileSync(path));

class BuildRefused extends Error {}

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? null : value;
}

const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** Re-hash the tracked inputs. A moved input stops the whole preparation. */
function verifyTrackedInputs(): void {
  for (const [name, digest] of Object.entries(PINNED_INPUTS)) {
    const path = resolve(inputsRoot, name);
    if (!existsSync(path)) throw new BuildRefused(`THE_PINNED_INPUT_IS_MISSING ${name}`);
    if (digestOf(path) !== digest) throw new BuildRefused(`THE_PINNED_INPUT_MOVED ${name}`);
  }
}

/** The upstream repository, read at the pinned commit. */
function upstreamRoot(): string {
  const upstream = argument('upstream');
  if (upstream === null) throw new BuildRefused('THE_UPSTREAM_REPOSITORY_IS_REQUIRED');
  const root = resolve(upstream);
  if (!existsSync(resolve(root, '.git'))) throw new BuildRefused('THE_UPSTREAM_REPOSITORY_IS_NOT_A_GIT_REPOSITORY');
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${UPSTREAM_SHA}^{commit}`], { stdio: 'pipe' });
  } catch {
    throw new BuildRefused('THE_PINNED_UPSTREAM_COMMIT_IS_MISSING');
  }
  return root;
}

/**
 * Stage the pinned upstream source.
 *
 * `git archive` reads the commit without touching the repository's working tree, its
 * index or its branches.
 */
function stageUpstream(root: string): void {
  const target = resolve(expectedRoot, 'source');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const archive = execFileSync('git', ['-C', root, 'archive', '--format=tar', UPSTREAM_SHA], { maxBuffer: 512 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', target], { input: archive, maxBuffer: 512 * 1024 * 1024 });
}

/**
 * Apply the pinned 013 patch.
 *
 * The patch is the tracked input, and its own digest was verified above. The result is
 * checked against the eight post-patch digests MAIN measured.
 */
function applyPinnedPatch(): void {
  const target = resolve(expectedRoot, 'source');
  const patch = resolve(inputsRoot, 'request013.patch');
  try {
    execFileSync('git', ['apply', '--whitespace=nowarn', '-p1', patch], { cwd: target, stdio: 'pipe' });
  } catch (error) {
    throw new BuildRefused(`THE_PINNED_PATCH_DID_NOT_APPLY ${String(error)}`);
  }
  for (const [path, digest] of Object.entries(PINNED_PATCHED_FILES)) {
    if (digest === '') continue;
    const file = resolve(target, path);
    if (!existsSync(file)) throw new BuildRefused(`THE_PATCHED_FILE_IS_MISSING ${path}`);
    if (digestOf(file) !== digest) throw new BuildRefused(`THE_PATCHED_FILE_MOVED ${path}`);
  }
}

/** The 013 source root the pinned build resolves its react alias and its helper from. */
function stageObservationSource(): void {
  const target = resolve(observationRoot, 'source/packages/openfilm');
  rmSync(resolve(observationRoot, 'source'), { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const path of Object.keys(PINNED_PATCHED_FILES)) {
    const source = resolve(expectedRoot, 'source', path);
    if (!existsSync(source)) continue;
    const destination = resolve(target, path.replace(/^packages\/openfilm\//, ''));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(source));
  }
}

/** The five pinned 015 candidate files, copied verbatim into the pinned layout. */
function stageExpectedAdapter(): void {
  const target = resolve(expectedRoot, 'source/managed-expected');
  mkdirSync(target, { recursive: true });
  for (const name of ['build-expected.mjs', 'expected-projection.mjs', 'expected-projection.d.ts', 'native-pure.entry.ts', 'vite.expected.config.mjs']) {
    writeFileSync(resolve(target, name), readFileSync(resolve(inputsRoot, name)));
  }
}

/**
 * The pinned offline toolchain.
 *
 * It is *copied*, never installed. When it is absent, or when its versions are not the
 * pinned ones, the build is refused: the pinned script checks them too, and a build
 * with another vite would not be the pinned candidate.
 */
function verifyPinnedToolchain(): void {
  const nodeModules = resolve(runtimeRoot, 'toolchain/packages/openfilm/node_modules');
  const vite = resolve(nodeModules, 'vite/package.json');
  const react = resolve(nodeModules, 'react/package.json');
  if (!existsSync(vite) || !existsSync(react)) {
    throw new BuildRefused('THE_PINNED_OFFLINE_TOOLCHAIN_IS_MISSING');
  }
  const viteVersion = String(JSON.parse(readFileSync(vite, 'utf8')).version ?? '');
  const reactVersion = String(JSON.parse(readFileSync(react, 'utf8')).version ?? '');
  if (viteVersion !== PINNED_VITE) throw new BuildRefused(`PINNED_NATIVE_VITE_REQUIRED ${viteVersion}`);
  if (reactVersion !== PINNED_REACT) throw new BuildRefused(`PINNED_NATIVE_REACT_REQUIRED ${reactVersion}`);
}

/** The digest of the staged source tree, so MAIN reviews a closure and not a name. */
function closureDigest(root: string): { readonly digest: string; readonly files: number } {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(`${full.slice(root.length + 1)}\0${digestOf(full)}`);
    }
  };
  walk(root);
  files.sort();
  return { digest: sha256(Buffer.from(files.join('\n'), 'utf8')), files: files.length };
}

/**
 * The pinned offline toolchain closure.
 *
 * It is *copied*, never installed: the resolved dependency and symlink closure of the
 * pinned upstream is reproduced inside this worktree's private root, and the source and
 * the vendor stay read-only. Every link must resolve inside the private tree; a link
 * that would escape it, or one that does not resolve at all, stops the copy.
 */
function copyToolchainClosure(vendorRoot: string): { readonly entries: number; readonly files: number; readonly bytes: number; readonly digest: string; readonly versions: Record<string, string> } {
  const outRoot = resolve(runtimeRoot, 'toolchain');
  const seedRelative = 'packages/openfilm/node_modules';
  const seedSource = resolve(vendorRoot, seedRelative);
  if (!existsSync(seedSource)) throw new BuildRefused('THE_PINNED_DEPENDENCY_SEED_IS_MISSING');
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outRoot, { recursive: true });

  const links: Array<{ readonly path: string; readonly raw: string }> = [];
  const copyTree = (source: string, destination: string): void => {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.name === '.bin') continue;
      const from = resolve(source, entry.name);
      const to = resolve(destination, entry.name);
      if (entry.isSymbolicLink()) {
        links.push({ path: to, raw: readlinkSync(from) });
        symlinkSync(readlinkSync(from), to);
        continue;
      }
      if (entry.isDirectory()) {
        copyTree(from, to);
        continue;
      }
      copyFileSync(from, to);
    }
  };
  copyTree(seedSource, resolve(outRoot, seedRelative));

  // Every link must land inside the private tree. A link that points into a pnpm
  // virtual store brings that whole entry with it; anything else is refused.
  const copied = new Set<string>();
  let pending = [...links];
  while (pending.length > 0) {
    const link = pending.shift()!;
    const target = resolve(dirname(link.path), link.raw);
    const relativeTarget = relative(outRoot, target);
    if (relativeTarget.startsWith('..')) throw new BuildRefused(`THE_DEPENDENCY_LINK_ESCAPES ${relativeTarget}`);
    if (existsSync(target)) continue;
    const vendorTarget = resolve(vendorRoot, relativeTarget);
    if (!existsSync(vendorTarget)) throw new BuildRefused(`THE_DEPENDENCY_LINK_IS_UNRESOLVED ${relativeTarget}`);
    const parts = relativeTarget.split('/');
    if (parts[0] !== 'node_modules' || parts[1] !== '.pnpm' || parts.length < 3) {
      throw new BuildRefused(`THE_DEPENDENCY_LINK_IS_NOT_VIRTUAL ${relativeTarget}`);
    }
    const entry = `node_modules/.pnpm/${parts[2]}`;
    if (copied.has(entry)) continue;
    copied.add(entry);
    const before = links.length;
    copyTree(resolve(vendorRoot, entry), resolve(outRoot, entry));
    pending = pending.concat(links.slice(before));
  }

  // The final pass: nothing may point out of the private tree any more.
  const files: string[] = [];
  let bytes = 0;
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = resolve(dirname(full), readlinkSync(full));
        if (!resolved.startsWith(outRoot + '/') && resolved !== outRoot) {
          throw new BuildRefused(`THE_DEPENDENCY_LINK_ESCAPES ${relative(outRoot, resolved)}`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const blob = readFileSync(full);
      bytes += blob.byteLength;
      files.push(`${relative(outRoot, full).split('\\').join('/')}\0${sha256(blob)}`);
    }
  };
  walk(outRoot);
  files.sort();
  const versions: Record<string, string> = {};
  for (const name of ['react', 'react-dom', 'vite', 'typescript', '@vitejs/plugin-react', '@tailwindcss/vite', 'tailwindcss']) {
    const manifest = resolve(outRoot, seedRelative, name, 'package.json');
    if (!existsSync(manifest)) throw new BuildRefused(`THE_PINNED_DEPENDENCY_IS_MISSING ${name}`);
    versions[name] = String(JSON.parse(readFileSync(manifest, 'utf8')).version ?? '');
  }
  if (versions.vite !== PINNED_VITE) throw new BuildRefused(`PINNED_NATIVE_VITE_REQUIRED ${versions.vite}`);
  if (versions.react !== PINNED_REACT) throw new BuildRefused(`PINNED_NATIVE_REACT_REQUIRED ${versions.react}`);
  return {
    entries: copied.size,
    files: files.length,
    bytes,
    digest: sha256(Buffer.from(JSON.stringify(files.map((entry) => entry.split('\0'))), 'utf8')),
    versions,
  };
}

/**
 * The link from the 013 source root to the private toolchain.
 *
 * The pinned build resolves its react alias and its helper beside that root, so the
 * root must find the closure. It is a relative link inside the private tree: nothing
 * points outside it, and the shared node_modules is never written to.
 */
function linkObservationToolchain(): void {
  const target = resolve(runtimeRoot, 'toolchain/packages/openfilm/node_modules');
  const link = resolve(observationRoot, 'source/packages/openfilm/node_modules');
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { recursive: true, force: true });
  symlinkSync(relative(dirname(link), target), link);
  const resolved = realpathSync(link);
  if (!resolved.startsWith(runtimeRoot + '/')) throw new BuildRefused('THE_TOOLCHAIN_LINK_ESCAPES');
}


function main(): void {
  verifyTrackedInputs();
  const root = upstreamRoot();
  stageUpstream(root);
  applyPinnedPatch();
  stageObservationSource();
  stageExpectedAdapter();
  // The link into the private toolchain belongs to the 013 source root, and the
  // staging above rewrites that root. It is restored here whenever the toolchain is
  // already there, so a build does not depend on the copy having been made in the
  // same invocation.
  if (existsSync(resolve(runtimeRoot, 'toolchain/packages/openfilm/node_modules'))) linkObservationToolchain();
  if (has('toolchain')) {
    // The authorised isolated copy of the pinned offline closure. It is a copy, never
    // an install: the source and the vendor are read-only and stay that way. It runs
    // after the source staging, because the link into it belongs to that root.
    const closure = copyToolchainClosure(root);
    linkObservationToolchain();
    const report = {
      kind: 'narralens.r2-native-toolchain-copy@1',
      source: resolve(root, 'packages/openfilm/node_modules'),
      private_root: resolve(runtimeRoot, 'toolchain'),
      method: 'private physical copies with private relative symlinks; no pnpm install, no lifecycle scripts, no network',
      virtual_entries: closure.entries,
      files: closure.files,
      file_bytes: closure.bytes,
      versions: closure.versions,
      closure_sha256: closure.digest,
      build: 'NOT_RUN',
    } as const;
    writeFileSync(resolve(runtimeRoot, 'toolchain-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  const staged = closureDigest(resolve(expectedRoot, 'source'));
  const report = {
    kind: 'narralens.r2-native-hydration-preparation@1',
    upstream_sha: UPSTREAM_SHA,
    patch_sha256: PATCH_SHA256,
    inputs: PINNED_INPUTS,
    runtime_root: runtimeRoot,
    staged_source_files: staged.files,
    staged_source_digest: staged.digest,
    toolchain: { vite: PINNED_VITE, react: PINNED_REACT },
    build: 'NOT_RUN',
  } as const;
  writeFileSync(resolve(runtimeRoot, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (!has('build')) {
    process.stdout.write('THE_BUILD_WAS_NOT_REQUESTED\n');
    return;
  }
  verifyPinnedToolchain();
  const script = resolve(expectedRoot, 'source/managed-expected/build-expected.mjs');
  // The pinned build refuses to run with NODE_PATH set, and the runner that starts
  // it sets NODE_PATH for its own module resolution. The child therefore gets the
  // variable removed, which is exactly what the pinned script asks for; the pinned
  // script imports its dependency by an absolute path and needs nothing from it.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.NODE_PATH;
  const output = execFileSync(process.execPath, [script], {
    cwd: resolve(expectedRoot, 'source'), env: childEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const dist = resolve(expectedRoot, 'dist');
  const built: Record<string, string> = {};
  for (const name of readdirSync(dist)) {
    const path = resolve(dist, name);
    if (statSync(path).isFile()) built[name] = digestOf(path);
  }
  const approval = {
    kind: 'narralens.r2-native-expected-approval-candidate@1',
    upstream_sha: UPSTREAM_SHA,
    inputs_sha256: sha256(Buffer.from(Object.keys(PINNED_INPUTS).sort()
      .map(name => `${name}\0${digestOf(resolve(inputsRoot, name))}`).join('\n'), 'utf8')),
    build_sha256: digestOf(resolve(dist, 'build-manifest.json')),
    modules: built,
  } as const;
  writeFileSync(resolve(runtimeRoot, 'expected-approval-candidate.json'), `${JSON.stringify(approval, null, 2)}\n`);
  process.stdout.write(`${output}\n${JSON.stringify(approval, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof BuildRefused ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
