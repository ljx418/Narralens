// A real separate process: SIGKILL deliberately skips all JS catch/finally and Host.close.
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {NarralensHost} from '../../../../src/host/server.js';
import {ProjectCatalog} from '../../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../../src/host/agent-driven/creation-application.js';
import {PersistentJobStore} from '../../../../src/host/persistent-job-store.js';
import {styleDigest} from '../../../../src/host/creative/digest.js';
import {createTrustedCallerContext} from '../../../../src/host/creative/trusted-context.js';
import {CreativeService} from '../../../../src/host/creative/creative-service.js';
import {ProductSqliteRepository} from '../../../../src/host/agent-driven/product-sqlite-repository.js';
import type {IntakePut} from '../../../../src/contracts/agent-driven-types.js';
const [root,point]=process.argv.slice(2);if(!root||!point)throw new Error('Missing owned crash-test root/boundary');
const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
let app!:CreationApplication;
const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),openFilmVendorRoot:vendorRoot,
 agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot,worker:{leaseMs:1000,pollMs:10,boundary:(boundary,reservation)=>{if(boundary===point||(point==='cancel_after_source'&&boundary==='after_source')){if(point==='cancel_after_source')new PersistentJobStore(instance.revisions).requestCancel(reservation.job_id);writeFileSync(join(root,'crash-marker.json'),JSON.stringify({boundary:point,accepted:reservation.accepted,transaction_id:reservation.transaction_id}));process.kill(process.pid,'SIGKILL');}}}})});
await host.listen(0);
const creative=new CreativeService({repository:new ProductSqliteRepository(host.revisions)});
const caller=createTrustedCallerContext({principal_id:'owner',channel:'authenticated',source:'driver_relay',session_ref:'crash-driver'});
const human=createTrustedCallerContext({principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:'crash-human'});
const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
input.intake_id=null;input.base_version=0;input.brief.narration_asset_id=null;input.brief.content_brief.material_strategy.narration_asset_id=null;input.brief.content_brief.script_ref=null;input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
const intake=await creative.putIntake(input,caller);
const decision=await creative.confirmIntake({meta:{idempotency_key:'confirm',correlation_id:'confirm'},intake_id:intake.intake_id,intake_version:intake.version,brief_sha256:intake.brief_sha256,choice:'confirm_brief'},human);
await app.worker.create({meta:{idempotency_key:'create',correlation_id:'create'},intake_id:intake.intake_id,intake_version:intake.version,decision_id:decision.decision_id},'owner');
// Failure to reach the requested boundary must fail, not look like a successful crash.
setTimeout(()=>{process.exitCode=9;void host.close();},20000);
