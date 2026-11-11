import {it,expect} from 'vitest';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {ProjectCreationStore} from '../../../src/host/projects/project-creation-store.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {CreatedRunAuthority} from '../../../src/host/agent-driven/created-run-authority.js';
import {CreatedRunFacts} from '../../../src/host/agent-driven/created-run-facts.js';
import {
  A_CAPABILITIES,
  capabilityFingerprint,
  type RuntimeCapabilityDescriptor,
} from '../../../src/host/agent-driven/capability-fingerprint.js';

/** Real SQLite rows and the real product repository. No Host, no media, no fixture
 * processor: the authority and the facts port are exercised against the original
 * database and the original closed adapter. */
const NOW = Math.floor(Date.parse('2026-11-11T00:00:00Z') / 1000);
const AT = '2026-11-11T00:00:00.000Z';
const SCOPE = 'c'.repeat(64);
const INPUT = 'd'.repeat(64);
const FULL: readonly RuntimeCapabilityDescriptor[] = A_CAPABILITIES.map((id, index) => ({
  id,
  version: 1,
  implementation_digest: String(index).repeat(64).replace(/[^a-f0-9]/g, 'a'),
  configuration_digest: 'f'.repeat(64),
}));

function fixture() {
  const revisions = new RevisionStore();
  const creation = new ProjectCreationStore(revisions);
  const repository = new ProductSqliteRepository(revisions);
  const authority = new CreatedRunAuthority({ now: () => NOW, confirmationTtlSeconds: 3600 });
  const factsOptions = { revisions, creation, repository };
  const seed = () => revisions.compose((db) => {
    db.prepare('INSERT OR IGNORE INTO project_state(project_id,revision,updated_at) VALUES(?,1,?)').run('project-1', AT);
    db.prepare("INSERT OR IGNORE INTO cp_a0_template_version(template_id,version,execution_digest,capability_id,capability_version,definition_json,created_at) VALUES('local-short-film',1,'b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32','clip.prepare','1','{}',?)").run(AT);
    db.prepare("INSERT OR IGNORE INTO cp_a0_run(project_id,run_id,run_scope_digest,template_id,template_version,current_plan_version,state,scope_json,checkpoint_json,created_at) VALUES('project-1','run-1',?,'local-short-film',1,1,'running','{}','{}',?)").run(SCOPE, AT);
    db.prepare("INSERT OR IGNORE INTO cp_a0_plan_version(project_id,run_id,plan_version,run_scope_digest,input_digest,plan_json,created_at) VALUES('project-1','run-1',1,?,?,'{}',?)").run(SCOPE, INPUT, AT);
    db.prepare("INSERT OR IGNORE INTO job(job_id,project_id,kind,payload_digest,state,attempt,max_attempts,cost_status,created_at,updated_at) VALUES('job-1','project-1','snapshot_publish',?,'running',1,3,'unknown',?,?)").run('1'.repeat(64), AT, AT);
    // A review request is the real evidence a review decision is bound to.
    db.prepare("INSERT OR IGNORE INTO cp_a0_artifact_version(project_id,artifact_id,version,kind,schema_version,input_digest,content_digest,content_json,input_refs_json,created_at) VALUES('project-1','artifact-1',1,'chapter',1,?,?,'{}','[]',?)").run(INPUT, INPUT, AT);
    db.prepare("INSERT OR IGNORE INTO cp_a0_review_request(project_id,run_id,plan_version,run_scope_digest,review_id,gate,artifact_id,artifact_version,input_digest,package_digest,state,reuse_review_id,created_at) VALUES('project-1','run-1',1,?,'review-1','sample','artifact-1',1,?,?,'pending',NULL,?)").run(SCOPE, INPUT, '5'.repeat(64), AT);
  });
  return { revisions, creation, repository, authority, factsOptions, seed, close: () => revisions.close() };
}

const confirmation = (over: Partial<Parameters<CreatedRunAuthority['registerConfirmation']>[1]> = {}) => ({
  project_id: 'project-1',
  run_id: 'run-1',
  review_id: null,
  input_digest: INPUT,
  purpose: 'run.authorize' as const,
  authenticated_actor: 'owner',
  session_ref: 'session-1',
  action_digest: '2'.repeat(64),
  issued_at: NOW,
  expires_at: NOW + 600,
  ...over,
});

it('persists the trusted confirmation inside the caller transaction and binds it to the real session', async () => {
  const f = fixture();
  try {
    const record = await f.repository.transaction((tx) => f.authority.registerConfirmation(tx, confirmation()));
    expect(record.channel).toBe('trusted_ui');
    expect(record.confirmation_id).toMatch(/^confirm_[a-f0-9]{32}$/);
    expect(record.authenticated_actor).toBe('owner');
    expect(record.session_ref).toBe('session-1');
    const stored = await f.repository.transaction((tx) => tx.get('trusted_confirmation', {
      project_id: 'project-1', run_id: 'run-1', confirmation_id: record.confirmation_id,
    }));
    expect(stored).toEqual(record);
  } finally { f.close(); }
});

it('refuses a confirmation whose session is no longer active and writes nothing', async () => {
  const f = fixture();
  const guarded = new CreatedRunAuthority({ now: () => NOW, sessionGuard: () => false });
  try {
    await expect(f.repository.transaction((tx) => guarded.registerConfirmation(tx, confirmation())))
      .rejects.toThrow();
    const rows = await f.repository.transaction((tx) => tx.list('trusted_confirmation', { project_id: 'project-1', run_id: 'run-1' }));
    expect(rows).toEqual([]);
  } finally { f.close(); }
});

it.each([
  ['an expired lifetime', { expires_at: NOW + 100000 }],
  ['a lifetime that is not in the future', { expires_at: NOW }],
  ['an issued time in the future', { issued_at: NOW + 10 }],
  ['a review purpose without a review', { purpose: 'review' as const }],
  ['a non hash input digest', { input_digest: 'not-a-digest' }],
  ['a foreign actor', { authenticated_actor: 'a'.repeat(70) }],
] as const)('refuses a confirmation with %s', async (_name, over) => {
  const f = fixture();
  try {
    await expect(f.repository.transaction((tx) => f.authority.registerConfirmation(tx, confirmation(over))))
      .rejects.toThrow();
    const rows = await f.repository.transaction((tx) => tx.list('trusted_confirmation', { project_id: 'project-1', run_id: 'run-1' }));
    expect(rows).toEqual([]);
  } finally { f.close(); }
});

it('rolls the confirmation back with the transaction that wrote it', async () => {
  const f = fixture();
  try {
    await expect(f.repository.transaction((tx) => {
      f.authority.registerConfirmation(tx, confirmation());
      throw Error('the caller transaction failed');
    })).rejects.toThrow('the caller transaction failed');
    const rows = await f.repository.transaction((tx) => tx.list('trusted_confirmation', { project_id: 'project-1', run_id: 'run-1' }));
    expect(rows).toEqual([]);
  } finally { f.close(); }
});

const approval = (over: Partial<Parameters<CreatedRunAuthority['registerApproval']>[1]> = {}) => ({
  project_id: 'project-1',
  run_id: 'run-1',
  run_scope_digest: SCOPE,
  confirmation_id: 'confirm_missing',
  plan_version: 1 as const,
  step_id: 'sample',
  attempt: 1,
  input_digest: INPUT,
  change_id: 'change-1',
  impact_id: 'impact-1',
  base_revision: 1,
  control_revision: 0,
  action_digest: '3'.repeat(64),
  facts_digest: '4'.repeat(64),
  expires_at: NOW + 600,
  ...over,
});

it('returns no approval when the current confirmation, run or attempt is missing', async () => {
  const f = fixture();
  try {
    f.seed();
    // No confirmation at all.
    expect(await f.repository.transaction((tx) => f.authority.registerApproval(tx, approval()))).toBeNull();
    // A confirmation for another purpose is not an adoption approval.
    const review = await f.repository.transaction((tx) => f.authority.registerConfirmation(tx, confirmation({ purpose: 'review', review_id: 'review-1' })));
    expect(await f.repository.transaction((tx) => f.authority.registerApproval(tx, approval({ confirmation_id: review.confirmation_id })))).toBeNull();
    // A run scope that is not the current run.
    const run = await f.repository.transaction((tx) => f.authority.registerConfirmation(tx, confirmation()));
    expect(await f.repository.transaction((tx) => f.authority.registerApproval(tx, approval({ confirmation_id: run.confirmation_id, run_scope_digest: '9'.repeat(64) })))).toBeNull();
    // An attempt that does not exist.
    expect(await f.repository.transaction((tx) => f.authority.registerApproval(tx, approval({ confirmation_id: run.confirmation_id })))).toBeNull();
    // An expired approval.
    expect(await f.repository.transaction((tx) => f.authority.registerApproval(tx, approval({ confirmation_id: run.confirmation_id, expires_at: NOW - 1 })))).toBeNull();
    const rows = await f.repository.transaction((tx) => tx.list('approval', { project_id: 'project-1', run_id: 'run-1' }));
    expect(rows).toEqual([]);
  } finally { f.close(); }
});

it('writes the limited approval only when the current run, attempt and confirmation are real', async () => {
  const f = fixture();
  try {
    f.seed();
    // The execution grant is bound to its OWN run.authorize confirmation; the adoption
    // approval is bound to the change.approve confirmation of the reviewed package.
    const authorize = await f.repository.transaction((tx) => f.authority.registerConfirmation(tx, confirmation({ action_digest: SCOPE })));
    const change = await f.repository.transaction((tx) => f.authority.registerConfirmation(tx, confirmation({ purpose: 'change.approve', review_id: 'review-1', action_digest: '3'.repeat(64), expires_at: NOW + 900 })));
    // The execution grant and the durable attempt of the reviewed execution.
    f.revisions.compose((db) => {
      db.prepare("INSERT OR IGNORE INTO cp_a0_execution_grant(project_id,run_id,grant_id,run_scope_digest,confirmation_id,principal_id,action,capability_id,capability_version,allow_paid,allow_external,state,expires_at) VALUES('project-1','run-1','grant-1',?,?,'owner','clip.prepare','clip.prepare','1',0,0,'active',?)").run(SCOPE, authorize.confirmation_id, NOW + 300);
      db.prepare("INSERT OR IGNORE INTO cp_a0_step_attempt(project_id,run_id,plan_version,run_scope_digest,step_id,attempt,grant_id,input_digest,dependencies_json,state,job_id,output_artifact_id,output_version,updated_at) VALUES('project-1','run-1',1,?,'sample',1,'grant-1',?,'[]','waiting_user','job-1',NULL,NULL,?)").run(SCOPE, INPUT, AT);
    });
    const record = await f.repository.transaction((tx) => f.authority.registerApproval(tx, approval({ confirmation_id: change.confirmation_id })));
    expect(record).not.toBeNull();
    expect(record?.state).toBe('active');
    expect(record?.confirmation_id).toBe(change.confirmation_id);
    expect(record?.plan_version).toBe(1);
    expect(record?.consumed_transaction_id).toBeNull();
    const stored = await f.repository.transaction((tx) => tx.list('approval', { project_id: 'project-1', run_id: 'run-1' }));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(record);
  } finally { f.close(); }
});

it('answers the project facts from the real authorities and fails closed without a capability', async () => {
  const f = fixture();
  try {
    const facts = new CreatedRunFacts(f.factsOptions);
    const unknown = await facts.readProjectFacts('missing-project');
    expect(unknown.project_id).toBe('missing-project');
    expect(unknown.exists).toBe(false);
    expect(unknown.capability_available).toBe(false);
    expect(unknown.capability_reason).toContain('capability manifest');
    expect(unknown.rights_authorized).toBe(false);
    // The fingerprint is a real digest of the ACTUAL registered descriptors; it is
    // never a constant and it never claims readiness on its own.
    expect(unknown.capability_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const partial = new CreatedRunFacts({ ...f.factsOptions, capabilities: () => FULL.slice(0, 2) });
    const incomplete = await partial.readProjectFacts('missing-project');
    expect(incomplete.capability_available).toBe(false);
    expect(incomplete.capability_fingerprint).not.toBe(capabilityFingerprint(FULL));
    const complete = new CreatedRunFacts({
      ...f.factsOptions,
      capabilities: () => FULL,
      capabilityReadiness: () => ({ available: true, reason: 'every registered producer reported itself available' }),
    });
    const ready = await complete.readProjectFacts('missing-project');
    expect(ready.capability_fingerprint).toBe(capabilityFingerprint(FULL));
    expect(ready.capability_available).toBe(true);
    // A manifest that is registered but not ready stays unavailable.
    const notReady = new CreatedRunFacts({
      ...f.factsOptions,
      capabilities: () => FULL,
      capabilityReadiness: () => ({ available: false, reason: 'the delivery producer is still starting' }),
    });
    expect((await notReady.readProjectFacts('missing-project')).capability_available).toBe(false);
  } finally { f.close(); }
});

/** D09 boundary negatives use real SQLite, not a fake prepared-source reader. */
async function approvalFixture() {
  const f = fixture(); f.seed();
  const authorize = await f.repository.transaction(tx => f.authority.registerConfirmation(tx, confirmation({action_digest:SCOPE})));
  const change = await f.repository.transaction(tx => f.authority.registerConfirmation(tx,
    confirmation({purpose:'change.approve',review_id:'review-1',action_digest:'3'.repeat(64),expires_at:NOW+900})));
  f.revisions.compose(db => {
    db.prepare("INSERT INTO cp_a0_execution_grant(project_id,run_id,grant_id,run_scope_digest,confirmation_id,principal_id,action,capability_id,capability_version,allow_paid,allow_external,state,expires_at) VALUES('project-1','run-1','grant-1',?,?,'owner','clip.prepare','clip.prepare','1',0,0,'active',?)").run(SCOPE,authorize.confirmation_id,NOW+300);
    db.prepare("INSERT INTO cp_a0_step_attempt(project_id,run_id,plan_version,run_scope_digest,step_id,attempt,grant_id,input_digest,dependencies_json,state,job_id,output_artifact_id,output_version,updated_at) VALUES('project-1','run-1',1,?,'sample',1,'grant-1',?,'[]','waiting_user','job-1',NULL,NULL,?)").run(SCOPE,INPUT,AT);
  });
  return {...f, input:approval({confirmation_id:change.confirmation_id})};
}

it('D09 refuses a prepared id without actual Host proof even with real confirmation and attempt', async () => {
  const f = await approvalFixture();
  try {
    expect(await f.repository.transaction(tx => f.authority.registerApproval(tx,
      {...f.input,change_id:'ps_'+ 'a'.repeat(60)}))).toBeNull();
    expect(await f.repository.transaction(tx => tx.list('approval',{project_id:'project-1',run_id:'run-1'}))).toEqual([]);
  } finally { f.close(); }
});

it.each([
  ['changed action', {action_digest:'9'.repeat(64)}],
  ['extended confirmation lifetime', {expires_at:NOW+901}],
])('D09 refuses %s against the original trusted confirmation', async (_name,over) => {
  const f = await approvalFixture();
  try {
    expect(await f.repository.transaction(tx => f.authority.registerApproval(tx,{...f.input,...over}))).toBeNull();
  } finally { f.close(); }
});

it('D09 confirmation replay returns one original approval and rejects changed bindings', async () => {
  const f = await approvalFixture();
  try {
    const first = await f.repository.transaction(tx => f.authority.registerApproval(tx,f.input));
    expect(first).not.toBeNull();
    expect(await f.repository.transaction(tx => f.authority.registerApproval(tx,f.input))).toEqual(first);
    expect(await f.repository.transaction(tx => f.authority.registerApproval(tx,{...f.input,facts_digest:'8'.repeat(64)}))).toBeNull();
    expect(await f.repository.transaction(tx => tx.list('approval',{project_id:'project-1',run_id:'run-1'}))).toHaveLength(1);
  } finally { f.close(); }
});

// Reserved R2-BRIDGE-D09-REAL-001 only. Actual Host/bootstrap/SOURCE_ONLY worker,
// immutable native draft, asset registry and concrete reader. Package part refs are
// isolated publication metadata fixtures, not preview transport or human acceptance.
async function d09RealFixture(planMutation = false) {
  const {preparedDraftFixture,waitForCompletedDraft} = await import('./helpers/created-draft-fixture.js');
  const {CreatedPreparedSourceStore} = await import('../../../src/host/agent-driven/created-prepared-source-store.js');
  const {CreatedSourceImpactStore} = await import('../../../src/host/agent-driven/created-source-impact-store.js');
  const {CreatedSourceFactsReader} = await import('../../../src/host/agent-driven/created-source-facts-reader.js');
  const {CreatedSourceChangeService} = await import('../../../src/host/agent-driven/created-source-change-service.js');
  const {CreativeProjectAuthority} = await import('../../../src/host/agent-driven/creative-project-authority.js');
  const {ImpactStore} = await import('../../../src/host/impact/impact-store.js');
  const {OperationIdempotencyStore} = await import('../../../src/host/projects/operation-idempotency-store.js');
  const {FixedWorkflowService} = await import('../../../src/host/creative/fixed-workflow-service.js');
  const {canonicalDigest} = await import('../../../src/host/creative/digest.js');
  const {preparedAdoptionPlanDigest} = await import('../../../src/host/agent-driven/created-source-ports.js');
  const {createTrustedCallerContext} = await import('../../../src/host/creative/trusted-context.js');
  const f = await preparedDraftFixture();
  let reader: InstanceType<typeof CreatedSourceFactsReader> | undefined;
  try {
    f.worker.start(); const completed = await waitForCompletedDraft(f); await f.worker.close();
    const prepared = new CreatedPreparedSourceStore(f.host.revisions);
    const impacts = new CreatedSourceImpactStore(f.host.revisions,
      new ImpactStore(f.host.revisions,new OperationIdempotencyStore(f.host.revisions.compose(db=>db))));
    const projectAuthority = new CreativeProjectAuthority(f.app.creation);
    let selection = 0, clock = Math.floor(Date.now()/1000);
    const dependencies = {host:f.host,authority:projectAuthority,tasks:f.tasks,assets:f.registry,
      verifier:f.verifier,selection:{currentSelectionVersion:()=>selection},stageDomainRoot:f.taskRoot};
    reader = new CreatedSourceFactsReader({...dependencies,prepared});
    const execution = f.task.request.execution;
    expect(completed.terminal_reason).toBe('SOURCE_ONLY');
    const mapping = prepared.register({project_id:f.projectId,job_id:f.task.job_id,request_digest:f.task.request_digest,
      fact_digest:canonicalDigest(completed.fact),execution,base_revision:1,source_digest:f.commit.source_digest,
      plan_sha256:completed.fact.plan_digest!,rights_digest:completed.fact.rights_digest,frame_count:90,
      fps_numerator:30,fps_denominator:1,stage_root:completed.root,roots:completed.fact.roots,files:completed.fact.files});
    const changes = new CreatedSourceChangeService({host:f.host,prepared,impacts,facts:reader,authority:projectAuthority});
    let change = await changes.prepare({meta:{idempotency_key:'d09-prepare',correlation_id:'d09-prepare'},project_id:f.projectId,
      materialization_id:mapping.prepared_source_id,base_revision:1,source_digest:f.commit.source_digest,selection_version:0,execution},'owner');
    if (planMutation) {
      // A validly rehashed but false plan, registered through the actual impact store.
      // No accepted review/approval rows are forged to exercise this refusal.
      const plan = structuredClone(impacts.planFact(change.impact_id)!.plan) as import('../../../src/host/agent-driven/created-source-ports.js').PreparedAdoptionPlanV1;
      Reflect.set(plan.native_plan,'film_sha256','f'.repeat(64));
      const planDigest = preparedAdoptionPlanDigest(plan), original = impacts.read(change.impact_id)!;
      const impact = impacts.create({impact_id:'imp_d09_false_plan',project_id:f.projectId,materialization_id:mapping.prepared_source_id,
        target_snapshot_id:plan.target_snapshot_id,base_revision:plan.base_revision,source_digest:plan.base_source_digest,
        control_revision:plan.control_revision,engine_upstream_sha:plan.engine_upstream_sha,affected_ranges:plan.affected_ranges,
        affected_consumers:original.affected_consumers,locks_checked:plan.locks_checked,rights_digest:original.rights_digest,
        native_plan_sha256:planDigest,approvals_required:['change.approve'],request_digest:canonicalDigest({case:'false-plan'}),plan,
        now:new Date(Date.parse(plan.expires_at)-900000)});
      change = {...change,impact_id:impact.impact_id,plan_sha256:planDigest};
    }
    const authority = new CreatedRunAuthority({prepared:dependencies,now:()=>clock,
      sessionGuard:({principal_id,session_ref})=>f.app.auth.isPrincipalActive({principal_id,channel:'trusted_ui',session_ref,expires_at:0})});
    const workflow = new FixedWorkflowService({repository:f.repo,adoption:authority,now:()=>clock});
    const ui = createTrustedCallerContext({principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:f.ui.principal.session_ref});
    const pkg = await workflow.publishReviewPackage({project_id:f.projectId,run_id:execution.run_id,package_id:'d09-package',kind:'sample',chapter_id:null,
      input_digest:execution.input_digest,output_digest:completed.fact.source_digest,quality_digest:canonicalDigest({case:'D09 authority fixture only'}),
      parts:(['preview','narration','subtitles','shot_summary','rights_quality'] as const).map(kind=>({kind,artifact_ref:{id:'fixture-'+kind,version:1,sha256:canonicalDigest(completed.fact)},download_ref:null})),
      source_shot_ids:['s1','s2','s3'],selection_reason:'D09 authority fixture metadata, not preview or human acceptance',
      allowed_choices:['accept','accept_and_adopt'],impact:change,step_id:execution.step_id,attempt:execution.attempt},f.owner);
    prepared.bindPackage({prepared_source_id:mapping.prepared_source_id,package_id:pkg.package_id,package_version:pkg.version,receipt_digest:canonicalDigest(pkg)});
    const request: import('../../../src/contracts/agent-driven-types.js').ReviewDecisionInput = {
      meta:{idempotency_key:'d09-approve',correlation_id:'d09-approve'},project_id:f.projectId,run_id:execution.run_id,
      package_id:pkg.package_id,package_version:pkg.version,plan_version:1,input_digest:pkg.input_digest,output_digest:pkg.output_digest,
      quality_digest:pkg.quality_digest,choice:'accept_and_adopt',impact_id:change.impact_id,plan_sha256:change.plan_sha256};
    const close = async()=>{try {await reader!.close();} finally {await f.close();}
      const {existsSync}=await import('node:fs');expect(existsSync(f.root)).toBe(false);
      console.info(JSON.stringify({case:'D09 real prepared cleanup',pid:process.pid,root:f.root,removed:true}));};
    return {...f,completed,prepared,impacts,projectAuthority,authority,workflow,request,ui,change,execution,
      clockNow:()=>clock,advanceSelection:()=>{selection++;},expire:()=>{clock=Math.ceil(Date.parse(change.expires_at)/1000);},close};
  } catch(error) {try {await reader?.close();} finally {await f.close();}
    const {existsSync}=await import('node:fs');
    console.info(JSON.stringify({case:'D09 real prepared setup failure cleanup',pid:process.pid,root:f.root,removed:!existsSync(f.root)}));
    throw error;}
}

async function d09SourceDescriptors(roots: readonly string[]): Promise<string[]> {
  const {readdir,readlink} = await import('node:fs/promises');
  const found:string[]=[];
  for (const fd of await readdir('/proc/self/fd')) {
    try {const target=await readlink('/proc/self/fd/'+fd);if(roots.some(root=>target===root||target.startsWith(root+'/')))found.push(fd+':'+target);}catch{}
  }
  return found.sort();
}

it('D09 real prepared succeeds with full plan digest, replays once and releases held source FDs', async()=>{
  const f=await d09RealFixture();
  try {
    const roots=[f.authorRoot,f.completed.root],before=await d09SourceDescriptors(roots);
    const result=await f.workflow.decideReview(f.request,f.ui);
    expect(result.approval).not.toBeNull();
    const approvals=await f.repo.transaction(tx=>tx.list('approval',{project_id:f.projectId,run_id:f.execution.run_id}));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({action_digest:f.change.plan_sha256,facts_digest:f.change.plan_sha256,state:'active'});
    expect(await f.workflow.decideReview(f.request,f.ui)).toEqual(result);
    expect(await f.repo.transaction(tx=>tx.list('approval',{project_id:f.projectId,run_id:f.execution.run_id}))).toHaveLength(1);
    expect(await d09SourceDescriptors(roots)).toEqual(before);
    expect(f.host.revisions.activeCommit(f.projectId)!.revision).toBe(1);
  } finally {await f.close();}
},120000);

it.each(['plan','package','rights','selection','expiry','closure'] as const)(
  'D09 real prepared refuses changed %s without approval and releases held source FDs',async field=>{
    const f=await d09RealFixture(field==='plan');
    try {
      if(field==='package')f.request.package_version++;
      if(field==='selection')f.advanceSelection();
      if(field==='expiry')f.expire();
      if(field==='rights') {
        // Explicit durable-registry corruption fault injection: no rights mutation API
        // exists for immutable registrations. Never manufacture an accepted policy row.
        f.host.revisions.compose(db=>{db.exec('DROP TRIGGER created_local_asset_no_delete');
          db.prepare('DELETE FROM created_local_asset WHERE project_id=?').run(f.projectId);});
      }
      if(field==='closure') {
        const {CreativeService}=await import('../../../src/host/creative/creative-service.js');
        const creation=f.app.creation.forProject(f.projectId)!;
        const current=await f.repo.transaction(tx=>{const head=tx.get('intake_head',{intake_id:creation.request.intake_id})!;
          return tx.get('intake_version',{intake_id:head.intake_id,version:head.current_version})!;});
        const creative=new CreativeService({repository:f.repo,artifactAuthority:f.projectAuthority.assertArtifact,contentAuthority:f.projectAuthority.assertContent});
        await creative.putIntake({meta:{idempotency_key:'d09-change-intake',correlation_id:'d09-change-intake'},intake_id:current.intake_id,
          base_version:current.version,brief:{...current.content_json,topic:current.content_json.topic+' changed'}},f.owner);
      }
      const roots=[f.authorRoot,f.completed.root],before=await d09SourceDescriptors(roots);
      await expect(f.workflow.decideReview(f.request,f.ui)).rejects.toThrow();
      expect(await f.repo.transaction(tx=>tx.list('approval',{project_id:f.projectId,run_id:f.execution.run_id}))).toEqual([]);
      expect(await f.repo.transaction(tx=>tx.get('review_request',{project_id:f.projectId,run_id:f.execution.run_id,review_id:f.request.package_id})?.state)).toBe('pending');
      expect(await d09SourceDescriptors(roots)).toEqual(before);
      expect(f.host.revisions.activeCommit(f.projectId)!.revision).toBe(1);
    } finally {await f.close();}
  },120000);

it('D09 real prepared refuses a copied transaction object even while actual proof is held',async()=>{
  const f=await d09RealFixture();
  try {
    const roots=[f.authorRoot,f.completed.root],before=await d09SourceDescriptors(roots);
    await expect(f.authority.reviewTransaction!(f.request,f.ui,(tx,digest)=>{
      const now=f.clockNow(),expires=Math.min(now+60,Math.floor(Date.parse(f.change.expires_at)/1000));
      const confirm=f.authority.registerConfirmation(tx,{project_id:f.projectId,run_id:f.execution.run_id,review_id:f.request.package_id,
        input_digest:f.request.input_digest,purpose:'change.approve',authenticated_actor:'owner',session_ref:f.ui.session_ref,
        action_digest:digest!,issued_at:now,expires_at:expires});
      const copied={...tx};
      expect(f.authority.registerApproval(copied,{project_id:f.projectId,run_id:f.execution.run_id,run_scope_digest:f.execution.run_scope_digest,
        confirmation_id:confirm.confirmation_id,plan_version:1,step_id:f.execution.step_id,attempt:f.execution.attempt,input_digest:f.request.input_digest,
        change_id:f.change.materialization_id,impact_id:f.change.impact_id,base_revision:f.change.base_revision,control_revision:f.change.control_revision,
        action_digest:digest!,facts_digest:digest!,expires_at:expires})).toBeNull();
      throw Error('rollback wrong-transaction fixture confirmation');
    })).rejects.toThrow('rollback wrong-transaction fixture confirmation');
    expect(await f.repo.transaction(tx=>tx.list('approval',{project_id:f.projectId,run_id:f.execution.run_id}))).toEqual([]);
    expect(await d09SourceDescriptors(roots)).toEqual(before);
  } finally {await f.close();}
},120000);
