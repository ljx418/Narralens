"""Document/contract checks only. Does not import or execute product code."""
from pathlib import Path
import json,hashlib,copy,sys,subprocess
from jsonschema import Draft202012Validator
base=Path(__file__).resolve().parents[1]
canonical=base.parents[3]
result=[]
def check(name,condition,detail):
 result.append({"check":name,"passed":bool(condition),"detail":detail})
s=json.loads((base/"contracts/asset-inventory-v1.schema.json").read_text())
Draft202012Validator.check_schema(s)
check("adjunct-schema-valid",True,"Draft 2020-12 structural check only")
media={"kind":"audio","media_type":"audio/wav","extension":"wav","duration_frames":90,"duration_ms":3000,"width":None,"height":None,"sample_rate":48000,"channels":1,"codec":"pcm_s16le"}
item={"asset_id":"asset_test","sha256":"1"*64,"bytes":288044,"registration_digest":"2"*64,"media":media,"rights_ref":{"id":"rights_test","version":1,"sha256":"2"*64},"source_label":"authorized diagnostic example","license":{"status":"cleared","label":"operator attestation example","commercial_use":True},"recording_origin":"synthetic"}
example={"format":"narralens.asset-inventory@1","project_id":"project_test","items":[item],"cursor_next":None}
v=Draft202012Validator(s)
check("inventory-positive-shape",v.is_valid(example),"synthetic documentation JSON, not media or legal validation")
check("inventory-item-response-shape",v.is_valid(item),"POST InventoryItem response is explicitly in schema top-level union")
legacy=copy.deepcopy(example);legacy["items"][0]["source_label"]="x"*1600;legacy["items"][0]["license"]["label"]="y"*1600
check("legacy-valid-long-labels",v.is_valid(legacy),"inventory must represent labels allowed by existing LocalAssetRegistry, not narrow to512")
for name,mutate in [
 ("wrong-rights-version",lambda x:x["items"][0]["rights_ref"].update({"version":2})),
 ("unknown-field",lambda x:x.update({"absolute_path":"/private/file"})),
 ("bad-ref-hash",lambda x:x["items"][0]["rights_ref"].update({"sha256":"bad"})),
 ("oversize-page",lambda x:x.update({"items":[copy.deepcopy(item) for _ in range(65)]})),
 ("wrong-format",lambda x:x.update({"format":"unregistered-format"}))]:
 x=copy.deepcopy(example);mutate(x);check("inventory-reject-"+name,not v.is_valid(x),"schema must reject this precise negative shape")
owner=json.loads((base/"03_OWNERSHIP_AND_DEPENDENCIES.json").read_text());paths=[x["path"] for x in owner["files"]]
check("single-writer",len(paths)==len(set(paths)),str(len(paths))+" exact paths")
check("known-writers",all(x["writer"] in ["bridge-Claude","product-Claude","media-Claude"] for x in owner["files"]),"MAIN coordinates, no implicit second writer")
protected=set(x for x in owner["always_protected"] if not x.endswith('/'))
check("frozen-not-released",not protected.intersection(paths),"frozen contract files and lockfile are outside release list")
reg=json.loads((base/"contracts/asset-inventory-v1.registry.json").read_text())
check("explicit-additive-count",len(reg["additional_http_routes"])==4 and len(reg["additional_mcp_resources"])==1,"4 inventory/source UI HTTP plus one resource, original31 separate")
r=json.loads((base/"contracts/review-media-v1.registry.json").read_text())
check("preview-explicitly-separate",len(r["routes"])==1 and r["routes"][0]["method"]=="GET","fifth adjunct HTTP; not a Delivery or hidden frozen registry edit")
baseline=json.loads((base/"baseline-observed.json").read_text())
for tree in baseline["worktrees"]:
 root=Path(tree["path"]);mismatches=[]
 head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip()
 status=subprocess.check_output(["git","status","--porcelain","-uall"],cwd=root,text=True)
 check("head-"+tree["name"],head==tree["head"],"full commit unchanged")
 check("dirty-set-"+tree["name"],status==tree["status"],"exact git/index dirty set unchanged, not only original file hashes")
 for f in tree["dirty_files"]:
  p=root/f["path"]
  if f["kind"]=="file" and (not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=f["sha256"]): mismatches.append(f["path"])
 check("preserved-"+tree["name"],not mismatches,mismatches or str(len(tree["dirty_files"]))+" original dirty entries unchanged")
 archive=Path(tree["archive"])
 check("backup-"+tree["name"],archive.is_file() and hashlib.file_digest(archive.open("rb"),"sha256").hexdigest()==tree["archive_sha256"],"local archive hash; not committed/uploaded")
main=Path(next(t["path"] for t in baseline["worktrees"] if t["name"]=="main-integration"))
freeze=json.loads((canonical/"docs/execution/A/contract-freeze.json").read_text())
for f in freeze["files"]:
 check("frozen-"+f["path"],hashlib.sha256((main/f["path"]).read_bytes()).hexdigest()==f["sha256"],"historical frozen bytes unchanged")
check("frozen-sql",hashlib.sha256((main/"contracts/agent-driven-a.migration.sql").read_bytes()).hexdigest()=="5572530b5036728e414a0653fc36fd43958874a3a89cc8223e3984194c4a1fa4","exact shipped SQL protected")
changed=subprocess.check_output(["git","diff","--name-only","HEAD"],cwd=canonical,text=True).splitlines()
check("canonical-no-product-edit",all(n=="AGENTS.md" or n.startswith("docs/") for n in changed),changed)
for lane in ["bridge","product","media"]:
 for name in ["DESIGN.md","ACCEPTANCE.md","TASK.md","CLAUDE_PROMPT.md","CLAUDE_READINESS.md"]:
  p=base/lane/name
  check("deliverable-"+lane+"-"+name,p.is_file() and p.stat().st_size>100,"presence only; MAIN semantic review is separate")
passed=all(r["passed"] for r in result)
receipt={"format":"narralens.documentation-check@1","passed":passed,"business_tests":"NOT_RUN","production_implementation":"NOT_STARTED","checks":result}
(base/"audit/document-check.json").write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({"passed":passed,"checks":len(result),"failed":[r for r in result if not r["passed"]]},ensure_ascii=False))
sys.exit(0 if passed else 1)
