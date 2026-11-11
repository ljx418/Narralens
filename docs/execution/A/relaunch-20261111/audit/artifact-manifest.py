"""Seal/verify documentation bytes only; never executes product code.
Run with --seal only after all package writers have settled.
"""
import argparse, hashlib, json, sys
from pathlib import Path
base=Path(__file__).resolve().parents[1]
manifest=base/'artifact-manifest.json'
receipt=base/'audit/artifact-integrity.json'
excluded={'artifact-manifest.json','audit/artifact-integrity.json'}
def entries():
 result=[]
 for p in sorted(base.rglob('*')):
  rel=p.relative_to(base).as_posix()
  if rel in excluded or '__pycache__' in p.parts:continue
  if p.is_symlink():raise ValueError('package symlink refused: '+rel)
  if p.is_file():
   result.append({'path':rel,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
 return result
ap=argparse.ArgumentParser();ap.add_argument('--seal',action='store_true');args=ap.parse_args()
if args.seal:
 manifest.write_text(json.dumps({'format':'narralens.a-preparation-artifacts@1','scope':'documentation preparation, not product acceptance or implementation release','self_hash_policy':'manifest and its integrity receipt excluded to avoid cycles','files':entries()},ensure_ascii=False,indent=2)+'\n')
if not manifest.is_file():sys.exit('manifest missing; seal only after writers settle')
m=json.loads(manifest.read_text());observed=entries();expected=m['files']
old={x['path']:x for x in expected};new={x['path']:x for x in observed}
errors=[{'path':p,'reason':'missing' if p not in new else 'added' if p not in old else 'bytes/hash changed'} for p in sorted(old.keys()|new.keys()) if old.get(p)!=new.get(p)]
r={'format':'narralens.a-preparation-artifact-check@1','scope':'documentation integrity only','manifest_sha256':hashlib.sha256(manifest.read_bytes()).hexdigest(),'checked_files':len(expected),'passed':not errors,'errors':errors}
receipt.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps(r,ensure_ascii=False));sys.exit(0 if r['passed'] else 1)
