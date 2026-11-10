#!/usr/bin/env python3
"""Capture a portable patch against exact integration base; sync only our overlay in our private archive."""
import difflib, hashlib, json, pathlib, subprocess
lane = pathlib.Path(__file__).resolve().parents[5]
docs = pathlib.Path(__file__).resolve().parent
main = lane.parent / 'main-integration'
base = '824b7dba9cd37ced3da597e2b490c555c17e8c01'
files = ['src/host/render/assembly-ports.ts', 'src/host/render/native-draft-plan.ts', 'src/host/render/native-draft-io.ts', 'src/host/render/native-draft-assembler.ts', 'src/host/render/native-subtitle-burn-source.ts', 'tests/agent-driven/media/native-draft.test.ts']
patch = ''; records = []
for relative in files:
    before = subprocess.run(['git', 'show', base + ':' + relative], cwd=main, capture_output=True)
    if before.returncode not in (0, 128): raise RuntimeError('Cannot read frozen base')
    old = before.stdout if before.returncode == 0 else b''
    new = (lane / relative).read_bytes()
    patch += f'diff --git a/{relative} b/{relative}\n'
    if before.returncode != 0: patch += 'new file mode 100644\n'
    patch += ''.join(difflib.unified_diff(old.decode().splitlines(True), new.decode().splitlines(True), fromfile='a/' + relative if before.returncode == 0 else '/dev/null', tofile='b/' + relative))
    records.append({'path': relative, 'pre_sha256': hashlib.sha256(old).hexdigest() if before.returncode == 0 else None, 'post_sha256': hashlib.sha256(new).hexdigest()})
    target = lane / 'var/native-draft-824b7db/source' / relative
    if not target.parent.is_dir(): raise RuntimeError('Private archive not ready')
    target.write_bytes(new)
(docs / 'candidate.patch').write_text(patch)
manifest = {'base_sha': base, 'upstream_sha': 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3', 'patch_sha256': hashlib.sha256(patch.encode()).hexdigest(), 'files': records, 'review': 'REVIEW_PENDING', 'actual_media': 'NOT_RUN', 'host_adoption': 'NOT_IMPLEMENTED'}
(docs / 'candidate-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest))
