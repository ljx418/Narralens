#!/usr/bin/env python3
"""Copy a pinned static runtime import closure; no JavaScript evaluation/install/build."""
import hashlib,json,pathlib,re,subprocess
here=pathlib.Path(__file__).resolve().parent;lane=here.parents[4];vendor=pathlib.Path('/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm');out=lane/'var/managed-native-expected/source';sha='e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3';prefix='packages/openfilm/'
managed=lane/'var/managed-native-observation/source';previous=json.loads((here.parent/'013-native-hydration-candidate/source-manifest.json').read_text());managed_hashes={x['path']:x['post_sha256'] for x in previous['files']}
seeds=[prefix+x for x in ['studio/ui/src/lib/film-shape.ts','studio/ui/src/lib/timeline-layout.ts','studio/ui/src/lib/timeline-nav.ts','studio/ui/src/lib/track-heights.ts','studio/ui/src/lib/markers.ts','studio/ui/src/lib/timecode.ts','studio/server/project-settings.mjs','studio/ui/src/lib/native-hydration.ts']]
overrides={prefix+'studio/ui/src/lib/native-hydration.ts',prefix+'studio/ui/src/lib/host.ts'};queue=seeds[:];records={};externals=set()
def source(path):
 if path in overrides:
  data=(managed/path).read_bytes()
  if hashlib.sha256(data).hexdigest()!=managed_hashes[path]:raise RuntimeError('013 SOURCE CHANGED '+path)
  return data,'managed013-H-R1'
 raw=subprocess.run(['git','show',sha+':'+path],cwd=vendor,capture_output=True)
 if raw.returncode:raise FileNotFoundError(path)
 return raw.stdout,'upstream-fixed'
while queue:
 relative=queue.pop()
 if relative in records:continue
 data,origin=source(relative);dest=out/relative;dest.parent.mkdir(parents=True,exist_ok=True)
 if dest.exists():raise RuntimeError('Refusing to overwrite prepared source '+relative)
 dest.write_bytes(data);imports=[]
 if pathlib.Path(relative).suffix in {'.ts','.tsx','.mjs','.js'}:
  text=data.decode()
  for match in re.finditer(r'^\s*import\s+(?!type\b)([\s\S]*?)\s+from\s+[\'"]([^\'"]+)[\'"]',text,re.M):
   bindings,target=match.groups()
   if bindings.strip().startswith('{'):
    names=[x.strip() for x in bindings.strip()[1:-1].split(',') if x.strip()]
    if names and all(x.startswith('type ') for x in names):continue
   imports.append(target)
   if not target.startswith('.'):
    externals.add(target);continue
   path=(pathlib.PurePosixPath(relative).parent/target).as_posix();parts=[]
   for part in path.split('/'):
    if part=='..':parts.pop()
    elif part!='.':parts.append(part)
   path='/'.join(parts);candidates=[path] if pathlib.Path(path).suffix else [path+'.ts',path+'.tsx',path+'.mjs',path+'.js']
   chosen=None
   for option in candidates:
    try:source(option);chosen=option;break
    except FileNotFoundError:pass
   if chosen is None:raise RuntimeError('Unresolved static import '+relative+' '+target)
   queue.append(chosen)
 records[relative]={'path':relative,'origin':origin,'sha256':hashlib.sha256(data).hexdigest(),'runtime_imports':imports}
for relative in ['package.json','pnpm-lock.yaml','LICENSE','packages/openfilm/package.json']:
 data,origin=source(relative);dest=out/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);records[relative]={'path':relative,'origin':origin,'sha256':hashlib.sha256(data).hexdigest(),'runtime_imports':[]}
rows=sorted(records.values(),key=lambda x:x['path']);manifest={'upstream_sha':sha,'canonical_managed_source_commit':'eeb6c7b0b6c046d39d7c633f4ee0029e23b3f7d6','files':rows,'external_imports':sorted(externals),'closure_sha256':hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'static_only':True,'javascript_execution':'NOT_RUN','typecheck':'NOT_RUN','build':'NOT_RUN','tests':'NOT_RUN'}
(here/'native-source-closure.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'files':len(rows),'external_imports':sorted(externals),'closure_sha256':manifest['closure_sha256'],'javascript_execution':'NOT_RUN'}))
