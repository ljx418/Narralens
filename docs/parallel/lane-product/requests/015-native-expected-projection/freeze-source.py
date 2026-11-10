#!/usr/bin/env python3
"""Hash/package source only. No JS import, build, compiler or test execution."""
import hashlib,json,pathlib,tarfile
here=pathlib.Path(__file__).resolve().parent;lane=here.parents[4];root=lane/'var/managed-native-expected/source'
native=json.loads((here/'native-source-closure.json').read_text());files=[]
for item in native['files']:
 data=(root/item['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==item['sha256'];files.append({'path':item['path'],'sha256':item['sha256'],'origin':item['origin']})
for file in sorted((here/'candidate').iterdir()):
 data=file.read_bytes();target=root/'managed-expected'/file.name;assert target.read_bytes()==data
 files.append({'path':'managed-expected/'+file.name,'sha256':hashlib.sha256(data).hexdigest(),'origin':'candidate-adapter'})
files.sort(key=lambda x:x['path'])
with tarfile.open(here/'native-expected-source.tar.gz','w:gz') as archive:
 for item in files:archive.add(root/item['path'],arcname=item['path'],recursive=False)
contract_paths=['CONTRACT.md','candidate/expected-projection.d.ts','literal-vectors.json']
contract=[{'path':file,'sha256':hashlib.sha256((here/file).read_bytes()).hexdigest()} for file in contract_paths]
manifest={'kind':'narralens.native-expected-projection-source@1','upstream_sha':native['upstream_sha'],'canonical_source_commit':'eeb6c7b0b6c046d39d7c633f4ee0029e23b3f7d6','native_closure_sha256':native['closure_sha256'],'source_files_sha256':hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'files':files,'contract_files':contract,'contract_sha256':hashlib.sha256(json.dumps(contract,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'source_archive_sha256':hashlib.sha256((here/'native-expected-source.tar.gz').read_bytes()).hexdigest(),'source_archive_bytes':(here/'native-expected-source.tar.gz').stat().st_size,'status':'SOURCE_CANDIDATE_ONLY','node_import':'NOT_RUN','typecheck':'NOT_RUN','library_build':'NOT_RUN','tests':'NOT_RUN','browser':'NOT_RUN','host':'NOT_RUN','independent_review':'PENDING'}
(here/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:v for k,v in manifest.items() if k not in ['files','contract_files']}))
