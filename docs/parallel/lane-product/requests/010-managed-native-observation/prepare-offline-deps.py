#!/usr/bin/env python3
"""Copy only the existing pinned package dependency closure into the private export. No install/network/scripts."""
import hashlib,json,os,pathlib,shutil
lane=pathlib.Path(__file__).resolve().parents[5]
vendor=pathlib.Path('/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm')
out=lane/'var/managed-native-observation/source'
docs=pathlib.Path(__file__).resolve().parent
seed=pathlib.Path('packages/openfilm/node_modules')
if (out/seed).exists(): raise SystemExit('Refusing to overwrite dependency preparation')
queue=[];done=set();links=[]
def inspect_links(root):
 for directory,dirs,files in os.walk(root,followlinks=False):
  for name in dirs+files:
   p=pathlib.Path(directory)/name
   if not p.is_symlink():continue
   target=p.resolve(strict=True)
   rel=target.relative_to(vendor)
   links.append((p.relative_to(vendor).as_posix(),rel.as_posix()))
   parts=rel.parts
   if len(parts)>2 and parts[:2]==('node_modules','.pnpm'):
    entry=pathlib.Path(*parts[:3])
    if entry not in done:queue.append(entry)
   elif not (out/rel).exists():raise RuntimeError('Non-virtual external dependency '+str(rel))
def copy(relative):
 src=vendor/relative;dest=out/relative
 dest.parent.mkdir(parents=True,exist_ok=True)
 shutil.copytree(src,dest,symlinks=True,ignore=shutil.ignore_patterns('.bin'))
 inspect_links(src)
copy(seed)
while queue:
 relative=queue.pop()
 if relative in done:continue
 done.add(relative);copy(relative)
# Relocate absolute links; ensure every symlink points wholly within the private tree.
file_hashes=[];total=0
for directory,dirs,files in os.walk(out/'node_modules',followlinks=False):
 for name in dirs+files:
  p=pathlib.Path(directory)/name
  if p.is_symlink():
   raw=os.readlink(p)
   if os.path.isabs(raw):
    rel=pathlib.Path(raw).relative_to(vendor);p.unlink();p.symlink_to(os.path.relpath(out/rel,p.parent))
   p.resolve(strict=True).relative_to(out)
  elif p.is_file():
   blob=p.read_bytes();total+=len(blob);file_hashes.append((p.relative_to(out).as_posix(),hashlib.sha256(blob).hexdigest()))
for directory,dirs,files in os.walk(out/seed,followlinks=False):
 for name in dirs+files:
  p=pathlib.Path(directory)/name
  if p.is_symlink():p.resolve(strict=True).relative_to(out)
versions={}
for name in ['react','react-dom','vite','typescript','@vitejs/plugin-react','@tailwindcss/vite','tailwindcss']:
 package=out/seed/name/'package.json';versions[name]=json.loads(package.read_text())['version']
manifest={'status':'COPIED_OFFLINE_NOT_BUILT','method':'private physical copies with private relative symlinks, no pnpm install or lifecycle scripts','virtual_entries':len(done),'files':len(file_hashes),'file_bytes':total,'versions':versions,'closure_sha256':hashlib.sha256(json.dumps(sorted(file_hashes),separators=(',',':')).encode()).hexdigest(),'file_sha256':sorted(file_hashes),'network':'NONE','build':'NOT_RUN'}
(docs/'offline-dependencies.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:v for k,v in manifest.items() if k!='file_sha256'}))
