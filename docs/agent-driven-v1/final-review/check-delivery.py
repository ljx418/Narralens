from pathlib import Path
import json,hashlib,subprocess,re,xml.etree.ElementTree as ET
from html.parser import HTMLParser
R=Path(__file__).resolve().parents[3];D=R/'docs/agent-driven-v1';F=D/'final-review';C=D/'cp-a0'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
checks=[]
def ck(name,passed,detail):checks.append({'id':name,'passed':bool(passed),'detail':detail})
b=json.loads((F/'content-bindings.json').read_text());bad=[x['path'] for x in b['files'] if sha(R/x['path'])!=x['sha256']];ck('SOURCE_BINDINGS',not bad,bad)
ri=b['revisionInputs'];rsha=hashlib.sha256(json.dumps(ri,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest();bad=[x['path'] for x in ri['inputs'] if sha(R/x['path'])!=x['sha256']]+[x['path'] for x in ri['attachments'] if hashlib.sha256((D/x['path']).read_text().encode()).hexdigest()!=x['sha256']];ck('ALL_EMBEDDED_INPUT_BINDINGS',not bad and rsha==b['documentRevision'],bad)
ck('HTML_BINDING',sha(F/'index.html')==b['htmlSHA256'],sha(F/'index.html'))
lock=json.loads((C/'candidate-lock.json').read_text());bad=[x['path'] for x in lock['files'] if sha(C/x['path'])!=x['sha256']];ck('CANDIDATE_BYTE_LOCK',not bad,bad)
page=(F/'index.html').read_text()
class Assets(HTMLParser):
 def __init__(self):super().__init__();self.external=[];self.frames=0;self.images=0
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='iframe':
   self.frames+=1
   if 'srcdoc' not in a:self.external.append('iframe without srcdoc')
   else:
    child=Assets();child.feed(a['srcdoc']);self.external+=child.external
  if tag=='img':self.images+=1
  for k in (['src'] if tag in ['img','script','iframe','audio','video','source'] else ['href'] if tag=='link' else []):
   v=a.get(k,'')
   if v and not v.startswith(('data:','blob:','#')):self.external.append(tag+':'+v)
p=Assets();p.feed(page);ck('SELF_CONTAINED',not p.external,{'externalRequiredAssets':p.external,'frames':p.frames,'images':p.images})
ck('NO_TEMPLATE_MARKERS',not re.search(r'__[A-Z_]{3,}__',page),'all replacement tokens resolved')
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip();ck('SOURCE_SHA_UNCHANGED',head==b['observedSourceSHA'],head)
diff=subprocess.check_output(['git','diff','--name-only','--','src','contracts','package.json','pnpm-lock.yaml'],cwd=R,text=True).strip();ck('NO_PRODUCT_DIFF',not diff,diff.splitlines())
r=json.loads((C/'readiness-check.json').read_text());ck('NO_RELEASE_OR_PRODUCT_PASS',r['implementationRelease']=='NOT_RELEASED' and r['productAcceptance']=='NOT_RUN' and all(x['status']=='NOT_STARTED' for x in r['implementationSessions']),{'release':r['implementationRelease'],'business':r['productAcceptance']})
ck('GAP_EIGHT_PAGES',len(ET.parse(D/'implementation-design/Narralens-V1-R4-实施与验收-GAP.drawio').getroot().findall('diagram'))==8,'eight editable Chinese GAP pages')
plan=json.loads((D/'iteration-plan.json').read_text());acceptance=json.loads((C/'acceptance-plan.json').read_text());ck('PLAN_COVERAGE',len(plan['tickets'])==17 and plan['acceptanceFamilies']==35 and len(acceptance['experienceCases'])==23,{'tickets':len(plan['tickets']),'families':plan['acceptanceFamilies'],'EX':len(acceptance['experienceCases'])})
ck('DIAGRAMS_DELIVERED',all(json.loads(x.read_text())['validation']['checksPassed']==9 for x in [F/'l0-delivery.json',D/'implementation-design/archify-delivery.json']),'two Archify showcase receipts 9/9')
br=json.loads((F/'browser/check.json').read_text());ck('BROWSER_DOCUMENT_CHECK',br.get('pass') and br.get('artifactSHA256')==sha(F/'index.html') and br.get('documentRevision')==b['documentRevision'],'headless document UI only, exact artifact bound')
ck('CONCEPT_SEPARATE_FROM_EVIDENCE','AI目标体验示意，不是运行截图' in page and '文档自检通过不等于实际视频、客户端或人类验收通过' in page,'concept and real acceptance separately labelled')
result={'format':'narralens.final-review.document-check@1','status':'PASS' if all(c['passed'] for c in checks) else 'FAIL','scope':'DOCUMENT_CONSISTENCY_ONLY','checks':checks,'productAcceptance':'NOT_RUN','implementationRelease':'NOT_RELEASED','htmlSHA256':sha(F/'index.html'),'documentRevision':b['documentRevision']}
(F/'document-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False));raise SystemExit(0 if result['status']=='PASS' else 1)
