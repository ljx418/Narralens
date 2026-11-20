from pathlib import Path
import json,hashlib,subprocess,stat,os,uuid,datetime
main=Path('/mnt/c/workspace/videoworkline/Narralens-agents/main-integration')
source=Path('/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-PRODUCT/var/native-hydration-r2/managed-native-expected/dist')
evidence=Path(__file__).resolve().parent
pin_path='src/host/m5/openfilm-studio-ui-pin.json'
pin_bytes=subprocess.check_output(['git','show','e2eff61:'+pin_path],cwd=main)
assert (main/pin_path).read_bytes()==pin_bytes,'protected pin drift'
pin=json.loads(pin_bytes)['native_expected'];assert pin['approval']=='APPROVED'
h=lambda data:hashlib.sha256(data).hexdigest()
inputs=['build-expected.mjs','expected-projection.d.ts','expected-projection.mjs','native-pure.entry.ts','request013.patch','vite.expected.config.mjs']
lines=[]
for name in inputs:
 rel='tools/agent-driven/product/native-inputs/'+name
 data=(main/rel).read_bytes();assert data==subprocess.check_output(['git','show','e2eff61:'+rel],cwd=main),'protected input drift'
 lines.append(name+'\0'+h(data))
assert h('\n'.join(lines).encode())==pin['inputs_sha256'],'approved inputs mismatch'
assert source.is_dir() and not source.is_symlink()
assert {p.name for p in source.iterdir()}==set(pin['modules'])
modules={}
for name,expected in pin['modules'].items():
 assert name==Path(name).name and name not in ['.','..']
 path=source/name;st=path.lstat();assert stat.S_ISREG(st.st_mode) and not path.is_symlink()
 data=path.read_bytes();assert h(data)==expected,(name,h(data),expected)
 modules[name]=data
assert h(modules['build-manifest.json'])==pin['build_sha256']
manifest=json.loads(modules['build-manifest.json'])
assert manifest['upstream_sha']==pin['upstream_sha']
for item in manifest['files']:
 assert item['path'] in modules and len(modules[item['path']])==item['bytes'] and h(modules[item['path']])==item['sha256']
archive=evidence/'approved-modules';archive.mkdir(mode=0o700)
for name,data in modules.items():
 with (archive/name).open('xb') as handle:handle.write(data)
parent=main/'var/native-hydration-r2/managed-native-expected'
node=main
for component in ['var','native-hydration-r2','managed-native-expected']:
 node=node/component
 if not node.exists():node.mkdir(mode=0o700)
 st=node.lstat();assert stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode),str(node)
assert node.resolve()==node,'private runtime parent alias'
destination=parent/'dist';assert not destination.exists() and not destination.is_symlink(),'destination exists, preserve and stop'
stage=parent/('.approved-provision-'+uuid.uuid4().hex);stage.mkdir(mode=0o700)
for name,data in modules.items():
 fd=os.open(stage/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as handle:handle.write(data);handle.flush();os.fsync(handle.fileno())
for directory in [stage,parent]:
 fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
os.rename(stage,destination)
fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try:os.fsync(fd)
finally:os.close(fd)
files={}
for name,data in modules.items():
 path=destination/name;assert not path.is_symlink() and path.read_bytes()==data
 files[name]={'sha256':h(data),'bytes':len(data),'destination':str(path)}
assert {p.name for p in destination.iterdir()}==set(modules)
assert (main/pin_path).read_bytes()==pin_bytes,'protected pin changed during provisioning'
record={'operation':'COPY_EXACT_APPROVED_MODULES_NO_BUILD','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':str(source),'destination':str(destination),'source_base':'e2eff61b464d75d36598103d718cd2a75db5dfda','pin_sha256':h(pin_bytes),'approved_inputs_sha256':pin['inputs_sha256'],'approved_build_sha256':pin['build_sha256'],'upstream_sha':pin['upstream_sha'],'files':files,'portable_archive':str(archive),'source_observation_tree_copied':False,'source_or_index_writes':False,'build_or_network_or_provider':False,'runtime_business_verification':'NOT_RUN; child must use real verified loader under appropriate grant; this proves approved byte provisioning only'}
(evidence/'PROVISION_RECEIPT.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
