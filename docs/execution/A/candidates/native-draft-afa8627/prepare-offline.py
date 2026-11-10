#!/usr/bin/env python3
"""Exact MAIN archive + candidate overlay + privately copied offline Node dependencies. No install/tests."""
import hashlib, json, os, pathlib, shutil, subprocess, tarfile

lane = pathlib.Path(__file__).resolve().parents[5]
main = lane.parent / 'main-integration'
sha = '824b7dba9cd37ced3da597e2b490c555c17e8c01'
out = lane / 'var/native-draft-824b7db/source'
docs = pathlib.Path(__file__).resolve().parent
if out.exists(): raise SystemExit('Refusing an existing private archive')
manifest = {'base_sha': sha, 'network': 'NONE', 'install': 'NOT_RUN', 'tests': 'NOT_RUN', 'typecheck': 'NOT_RUN', 'media': 'NOT_RUN'}
raw = subprocess.check_output(['git', 'archive', '--format=tar', sha], cwd=main)
out.mkdir(parents=True, mode=0o700)
import io
with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    archive.extractall(out, filter='data')
package = json.loads((out / 'package.json').read_text())
seed_package = json.loads((lane / 'package.json').read_text())
if any(package[k] != seed_package[k] for k in ['dependencies', 'devDependencies']): raise RuntimeError('Dependency declarations changed')
if (out / 'pnpm-lock.yaml').read_bytes() != (lane / 'pnpm-lock.yaml').read_bytes(): raise RuntimeError('Dependency lock changed')
files = [
    'src/host/render/assembly-ports.ts',
    'src/host/render/native-draft-plan.ts',
    'src/host/render/native-draft-io.ts',
    'src/host/render/native-draft-assembler.ts',
    'src/host/render/native-subtitle-burn-source.ts',
    'tests/agent-driven/media/native-draft.test.ts',
]
manifest['overlay'] = []
for relative in files:
    data = (lane / relative).read_bytes()
    (out / relative).parent.mkdir(parents=True, exist_ok=True)
    (out / relative).write_bytes(data)
    manifest['overlay'].append({'path': relative, 'sha256': hashlib.sha256(data).hexdigest()})
shutil.copytree(lane / 'node_modules', out / 'node_modules', symlinks=True, ignore=shutil.ignore_patterns('.bin'))
hashes = []
for directory, dirs, names in os.walk(out / 'node_modules', followlinks=False):
    for name in dirs + names:
        path = pathlib.Path(directory) / name
        if path.is_symlink():
            raw_link = os.readlink(path)
            if os.path.isabs(raw_link):
                relative = pathlib.Path(raw_link).relative_to(lane)
                path.unlink(); path.symlink_to(os.path.relpath(out / relative, path.parent))
            path.resolve(strict=True).relative_to(out)
        elif path.is_file(): hashes.append((path.relative_to(out).as_posix(), hashlib.sha256(path.read_bytes()).hexdigest()))
manifest['dependency_file_sha256'] = sorted(hashes)
manifest['dependency_files'] = len(hashes)
manifest['dependency_closure_sha256'] = hashlib.sha256(json.dumps(sorted(hashes), separators=(',', ':')).encode()).hexdigest()
manifest['lock_sha256'] = hashlib.sha256((out / 'pnpm-lock.yaml').read_bytes()).hexdigest()
manifest['private_root'] = str(out)
(docs / 'offline-preparation.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({k:v for k,v in manifest.items() if k != 'dependency_file_sha256'}))
