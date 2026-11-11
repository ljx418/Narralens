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
