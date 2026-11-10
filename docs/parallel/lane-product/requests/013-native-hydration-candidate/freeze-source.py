#!/usr/bin/env python3
"""Freeze source bytes/diffs only; never compiles, builds, starts native or modifies vendor."""
import difflib,hashlib,json,pathlib,subprocess
here=pathlib.Path(__file__).resolve().parent;lane=here.parents[4];root=lane/'var/managed-native-observation/source';previous=lane/'var/managed-native-observation/pre-hydration'
vendor=pathlib.Path('/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm');sha='e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3';prefix='packages/openfilm/studio/ui/src/'
paths=[prefix+p for p in ['lib/host.ts','editor/use-film.ts','components/ProjectView.tsx','lib/media-queue.ts','lib/use-film-subtitles.ts','lib/use-subtitle-style.ts','components/use-editor-tools.tsx','lib/native-hydration.ts']]
files=[];full=[];delta=[]
for path in paths:
 after=(root/path).read_bytes()
 raw=subprocess.run(['git','show',sha+':'+path],cwd=vendor,capture_output=True)
 if raw.returncode!=0 and path!=prefix+'lib/native-hydration.ts':raise RuntimeError(raw.stderr.decode())
 before=raw.stdout if raw.returncode==0 else b''
 old=(previous/path).read_bytes() if (previous/path).exists() else b''
 full.extend(difflib.unified_diff(before.decode().splitlines(True),after.decode().splitlines(True),fromfile='a/'+path if raw.returncode==0 else '/dev/null',tofile='b/'+path))
 delta.extend(difflib.unified_diff(old.decode().splitlines(True),after.decode().splitlines(True),fromfile='pre-hydration/'+path if old else '/dev/null',tofile='hydration/'+path))
 files.append({'path':path,'pre_sha256':hashlib.sha256(before).hexdigest() if raw.returncode==0 else None,'pre_extension_sha256':hashlib.sha256(old).hexdigest() if old else None,'post_sha256':hashlib.sha256(after).hexdigest()})
fullblob=''.join(full).encode();deltablob=''.join(delta).encode();(here/'candidate.patch').write_bytes(fullblob);(here/'extension.patch').write_bytes(deltablob)
manifest={'upstream_sha':sha,'previous_candidate_commit':'e96ca4ce06fc6515c6351844ac4375f15e481a78','previous_patch_sha256':'214c629238c2635f5c6212e5e9207eab18f61d17454c08ee64ccd32be41dffa6','patch_sha256':hashlib.sha256(fullblob).hexdigest(),'extension_patch_sha256':hashlib.sha256(deltablob).hexdigest(),'source_files_sha256':hashlib.sha256(json.dumps([(f['path'],f['post_sha256']) for f in files],separators=(',',':')).encode()).hexdigest(),'files':files,'status':'SOURCE_CANDIDATE_ONLY','typecheck':'NOT_RUN','build':'NOT_RUN','tests':'NOT_RUN','browser':'NOT_RUN','host':'NOT_RUN','independent_review':'PENDING'}
(here/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:v for k,v in manifest.items() if k!='files'}))
