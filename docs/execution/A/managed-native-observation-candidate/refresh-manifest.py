#!/usr/bin/env python3
"""Refresh portable patch and pre/post hashes from the private candidate only."""
import difflib,hashlib,json,pathlib,subprocess
here=pathlib.Path(__file__).resolve().parent;lane=here.parents[4]
vendor=pathlib.Path('/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm')
sha='e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3'
files=['packages/openfilm/studio/ui/src/lib/host.ts','packages/openfilm/studio/ui/src/editor/use-film.ts','packages/openfilm/studio/ui/src/components/ProjectView.tsx','packages/openfilm/studio/ui/src/lib/media-queue.ts']
patch=[];records=[]
for file in files:
 before=subprocess.check_output(['git','show',sha+':'+file],cwd=vendor)
 after=(lane/'var/managed-native-observation/source'/file).read_bytes()
 patch.extend(difflib.unified_diff(before.decode().splitlines(True),after.decode().splitlines(True),fromfile='a/'+file,tofile='b/'+file))
 records.append({'path':file,'pre_sha256':hashlib.sha256(before).hexdigest(),'post_sha256':hashlib.sha256(after).hexdigest()})
blob=''.join(patch).encode();(here/'candidate.patch').write_bytes(blob)
(here/'source-manifest.json').write_text(json.dumps({'upstream_sha':sha,'patch_sha256':hashlib.sha256(blob).hexdigest(),'files':records,'status':'SOURCE_CANDIDATE_NOT_COMPILED','build':'NOT_RUN','browser':'NOT_RUN'},indent=2)+'\n')
print(json.dumps({'patch_sha256':hashlib.sha256(blob).hexdigest(),'files':len(records)}))
