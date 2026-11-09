import { it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CreateProject, IntakePut } from '../../../src/contracts/agent-driven-types.js';
import { NarralensHost } from '../../../src/host/server.js';
import { ProjectResolver } from '../../../src/host/projects/project-resolver.js';
import { ProjectCatalog } from '../../../src/host/projects/project-catalog.js';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import { ProjectCreationStore, CREATION_COMMIT_BOUNDARIES, type CreatedSourceFact } from '../../../src/host/projects/project-creation-store.js';
import { ProductSqliteRepository } from '../../../src/host/agent-driven/product-sqlite-repository.js';
import { CreativeService } from '../../../src/host/creative/creative-service.js';
import { createTrustedCallerContext } from '../../../src/host/creative/trusted-context.js';
import { styleDigest } from '../../../src/host/creative/digest.js';
import { PersistentJobStore } from '../../../src/host/persistent-job-store.js';
import { CreationSourceVerifier } from '../../../src/host/projects/creation-source-verifier.js';
import { SnapshotStore } from '../../../src/host/projects/snapshot-store.js';
import { OPENFILM_UPSTREAM_SHA } from '../../../src/host/engine/engine-binding-store.js';
import { filmHtml } from '../../../src/host/projects/openfilm-migrator.js';
import { FPS_30 } from '../../../src/host/engine/time-model.js';
const paths: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => { for (const store of stores.splice(0))
    store.close(); for (const path of paths.splice(0))
    await rm(path, { recursive: true, force: true }); });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'narralens-created-store-'));
    paths.push(root);
    let now = new Date('2026-11-09T15:00:00Z');
    const path = join(root, 'host.sqlite'), store = new RevisionStore(path);
    stores.push(store);
    const snapshots = new SnapshotStore({ snapshotsRoot: join(root, 'snapshots') }), createdRoot = join(root, 'projects'), verifier = new CreationSourceVerifier(snapshots, '/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm', createdRoot);
    const creation = new ProjectCreationStore(store, () => now, verifier), repo = new ProductSqliteRepository(store), creative = new CreativeService({ repository: repo, now: () => Math.floor(now.getTime() / 1000) });
    const caller = createTrustedCallerContext({ principal_id: 'owner', channel: 'authenticated', source: 'driver_relay', session_ref: 'driver' });
    const ui = createTrustedCallerContext({ principal_id: 'owner', channel: 'trusted_ui', source: 'trusted_ui', session_ref: 'human' });
    const vectors = JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json', 'utf8')) as {
        vectors: {
            id: string;
            value: unknown;
        }[];
    };
    const body = structuredClone(vectors.vectors.find(x => x.id === 'definition:IntakePut:valid')!.value) as IntakePut;
    body.intake_id = null;
    body.base_version = 0;
    body.brief.narration_asset_id = null;
    body.brief.content_brief.material_strategy.narration_asset_id = null;
    body.brief.content_brief.script_ref = null;
    body.brief.content_brief.style.style_digest = styleDigest(body.brief.content_brief.style);
    const intake = await creative.putIntake(body, caller), decision = await creative.confirmIntake({ meta: { idempotency_key: 'confirm', correlation_id: 'confirm' }, intake_id: intake.intake_id, intake_version: intake.version, brief_sha256: intake.brief_sha256, choice: 'confirm_brief' }, ui);
    const input: CreateProject = { meta: { idempotency_key: 'create', correlation_id: 'create' }, intake_id: intake.intake_id, intake_version: intake.version, decision_id: decision.decision_id };
    const count = (table: string) => Number(store.compose(db => db.prepare('SELECT count(*) AS n FROM ' + table).get()?.n));
    return { root, path, store, creation, creative, caller, input, count, snapshots, verifier, createdRoot, setNow: (value: Date) => { now = value; }, now: () => now };
}
async function prepared(f: Awaited<ReturnType<typeof fixture>>) {
    const reservation = await f.creation.reserve(f.input, 'owner');
    const jobs = new PersistentJobStore(f.store);
    expect(jobs.acquireLease(reservation.job_id, { owner: 'worker', now: f.now(), leaseMs: 60000 })).toBe(true);
    f.creation.markStaging(reservation.command_id);
    const source = join(f.createdRoot, reservation.project_id, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'film.html'), filmHtml([], null, FPS_30, 0, { width: 1280, height: 720 }));
    const snapshot = await f.snapshots.publish({ projectId: reservation.project_id, engine: 'openfilm', engineUpstreamSha: OPENFILM_UPSTREAM_SHA, sourceRoot: source, roots: ['film.html'] });
    for (const [from, to] of [['received', 'preconditions_checked'], ['preconditions_checked', 'staged'], ['staged', 'validated'], ['validated', 'prepared']] as const)
        f.store.transition(reservation.transaction_id, from, to, to === 'prepared' ? { snapshot_id: snapshot.snapshot_id, source_digest_after: snapshot.source_digest } : {}, f.now());
    const fact: CreatedSourceFact = { schema_version: 1, roots: ['film.html'], subtitles: [], frame_count: 0, fps: { num: 30, den: 1 }, assets: [] };
    const proof = await f.verifier.prove(reservation, snapshot, fact);
    return { reservation, snapshot, fact, proof, sourceRoot: source, owner: 'worker', attempt: 1, command_id: reservation.command_id };
}
it('reserves the one actual Job/transaction and replays the original receipt, ignoring only correlation metadata', async () => {
    const f = await fixture(), first = await f.creation.reserve(f.input, 'owner');
    const second = await f.creation.reserve({ ...f.input, meta: { ...f.input.meta, correlation_id: 'new-correlation' } }, 'owner');
    expect(second.accepted).toEqual(first.accepted);
    expect(second.project_id).toBe(first.project_id);
    expect(f.count('job')).toBe(1);
    expect(f.count('project_transaction')).toBe(1);
    expect(f.count('migration')).toBe(0);
    expect(f.count('cp_a0_project_origin')).toBe(0);
    await expect(f.creation.reserve({ ...f.input, intake_version: 2 }, 'owner')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(f.count('job')).toBe(1);
});
it('does not turn a missing/foreign/expired trusted confirmation into creation permission', async () => {
    const f = await fixture();
    await expect(f.creation.reserve({ ...f.input, decision_id: 'invented' }, 'owner')).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await expect(f.creation.reserve(f.input, 'other')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    f.setNow(new Date('2026-11-09T15:15:00Z'));
    await expect(f.creation.reserve(f.input, 'owner')).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(f.count('job')).toBe(0);
    expect(f.count('cp_a0_bootstrap_command')).toBe(0);
});
it('commits real published snapshot metadata atomically, survives DB reopen and preserves the accepted response', async () => {
    const f = await fixture(), input = await prepared(f), result = await f.creation.commit(input);
    expect(result).toMatchObject({ origin: 'created', project_revision: 1, control_revision: 0, native_state: 'unconfirmed', native_ack: null });
    expect(f.store.activeCommit(result.project_id)).toMatchObject({ revision: 1, snapshot_id: input.snapshot.snapshot_id, transaction_id: input.reservation.transaction_id });
    expect(f.store.snapshotIsCommitted(result.project_id, input.snapshot.snapshot_id)).toBe(true);
    expect(f.store.readEngineBinding(result.project_id)).toMatchObject({ engine: 'openfilm', migrated_from: null });
    expect(f.count('migration')).toBe(0);
    expect(f.count('cp_a0_artifact_version')).toBe(1);
    expect(f.creation.receiptForJob(input.reservation.job_id, 'owner')).toMatchObject({ state: 'succeeded', bootstrap: result });
    expect(f.creation.receiptForJob(input.reservation.job_id, 'other')).toBeNull();
    const replay = await f.creation.reserve(f.input, 'owner');
    expect(replay.accepted).toEqual(input.reservation.accepted);
    const count = f.count('outbox');
    expect(await f.creation.commit(input)).toEqual(result);
    expect(f.count('outbox')).toBe(count);
    f.store.close();
    stores.splice(stores.indexOf(f.store), 1);
    const reopened = new RevisionStore(f.path);
    stores.push(reopened);
    const creation = new ProjectCreationStore(reopened, f.now);
    expect(creation.read(input.command_id)?.result).toEqual(result);
    expect(creation.sourceFact(result.project_id, input.snapshot.snapshot_id)).toEqual(input.fact);
    expect(creation.receiptForJob(input.reservation.job_id, 'owner')?.state).toBe('succeeded');
});
it.each(CREATION_COMMIT_BOUNDARIES)('rolls back every initial commit fact when failure occurs after %s', async (boundary) => {
    const f = await fixture(), input = await prepared(f), events = f.count('outbox');
    await expect(f.creation.commit({ ...input, fault: point => { if (point === boundary)
            throw new Error('injected:' + boundary); } })).rejects.toThrow('injected:' + boundary);
    expect(f.store.activeCommit(input.reservation.project_id)).toBeUndefined();
    expect(f.store.readEngineBinding(input.reservation.project_id)).toBeUndefined();
    expect(f.store.snapshotRow(input.snapshot.snapshot_id)).toBeUndefined();
    expect(f.store.projectTransaction(input.reservation.transaction_id)?.state).toBe('prepared');
    expect(f.store.state(input.reservation.project_id, 0, input.reservation.transaction_id).revision).toBe(0);
    for (const table of ['cp_a0_project_origin', 'cp_a0_artifact_version', 'cp_a0_artifact_head', 'created_source_fact'])
        expect(f.count(table), table).toBe(0);
    expect(f.creation.read(input.command_id)?.state).toBe('staging');
    expect(f.store.readJob(input.reservation.job_id)?.state).toBe('running');
    expect(f.count('outbox')).toBe(events);
    expect(await f.creation.commit(input)).toMatchObject({ project_revision: 1 });
});
it.each(['owner', 'attempt', 'expired', 'cancelled'] as const)('refuses a stale worker before any commit effect: %s', async (mode) => {
    const f = await fixture(), input = await prepared(f);
    if (mode === 'owner')
        input.owner = 'other';
    if (mode === 'attempt')
        input.attempt = 2;
    if (mode === 'expired')
        f.setNow(new Date(f.now().getTime() + 60000));
    if (mode === 'cancelled')
        f.store.compose(db => db.prepare("UPDATE job SET state='cancel_requested' WHERE job_id=?").run(input.reservation.job_id));
    await expect(f.creation.commit(input)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.store.activeCommit(input.reservation.project_id)).toBeUndefined();
    expect(f.count('cp_a0_project_origin')).toBe(0);
});
it('fails closed on changed created-fact schema instead of silently recreating a removed trigger', async () => {
    const f = await fixture();
    f.store.compose(db => db.exec('DROP TRIGGER created_source_fact_no_update'));
    expect(() => new ProjectCreationStore(f.store, f.now)).toThrow();
    expect(f.store.compose(db => db.prepare("SELECT 1 FROM sqlite_schema WHERE name='created_source_fact_no_update'").get())).toBeUndefined();
});
it('rechecks creation schema in a live store, not only after constructing a replacement', async () => {
    const f = await fixture(), input = await prepared(f);
    f.store.compose(db => db.exec('DROP TRIGGER created_source_fact_no_update'));
    await expect(f.creation.commit(input)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.store.activeCommit(input.reservation.project_id)).toBeUndefined();
    expect(f.count('cp_a0_project_origin')).toBe(0);
});
it('samples lease time after transaction admission instead of using time from before BEGIN', async () => {
    const f = await fixture(), input = await prepared(f), original = f.store.atomic.bind(f.store);
    f.store.atomic = work => { f.setNow(new Date('2026-11-09T15:01:00Z')); return original(work); };
    await expect(f.creation.commit(input)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.store.activeCommit(input.reservation.project_id)).toBeUndefined();
});
it('samples trusted confirmation time after reservation transaction admission', async () => {
    const f = await fixture(), original = f.store.atomic.bind(f.store);
    f.store.atomic = work => { f.setNow(new Date('2026-11-09T15:15:00Z')); return original(work); };
    await expect(f.creation.reserve(f.input, 'owner')).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(f.count('job')).toBe(0);
});
it.each(['lease', 'confirmation'] as const)('rolls back when %s expires after the final writes', async (mode) => {
    const f = await fixture(), input = await prepared(f);
    if (mode === 'confirmation')
        expect(f.store.renewLease(input.reservation.job_id, 'worker', 1, f.now().getTime(), f.now().getTime() + 1800000)).toBe(true);
    await expect(f.creation.commit({ ...input, fault: point => { if (point === 'outbox')
            f.setNow(new Date(f.now().getTime() + (mode === 'lease' ? 60000 : 900000))); } })).rejects.toMatchObject({ code: mode === 'lease' ? 'REVISION_CONFLICT' : 'APPROVAL_REQUIRED' });
    expect(f.store.activeCommit(input.reservation.project_id)).toBeUndefined();
    expect(f.count('cp_a0_project_origin')).toBe(0);
    expect(f.store.readJob(input.reservation.job_id)?.state).toBe('running');
});
it.each(['frame-count', 'fps', 'upstream'] as const)('does not mint a source proof for false native metadata: %s', async (mode) => {
    const f = await fixture(), input = await prepared(f);
    if (mode === 'frame-count')
        await expect(f.verifier.prove(input.reservation, input.snapshot, { ...input.fact, frame_count: 900 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    if (mode === 'fps')
        await expect(f.verifier.prove(input.reservation, input.snapshot, { ...input.fact, fps: { num: 25, den: 1 } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    if (mode === 'upstream') {
        const wrong = await f.snapshots.publish({ projectId: input.reservation.project_id, engine: 'openfilm', engineUpstreamSha: '0'.repeat(40), sourceRoot: input.sourceRoot, roots: ['film.html'] });
        await expect(f.verifier.prove(input.reservation, wrong, input.fact)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    }
    expect(f.count('cp_a0_project_origin')).toBe(0);
});
it('rejects a forged proof and byte changes after genuine pinned verification', async () => {
    const f = await fixture(), input = await prepared(f);
    await expect(f.creation.commit({ ...input, proof: {} as typeof input.proof })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await writeFile(join(f.snapshots.snapshotRoot(input.reservation.project_id, input.snapshot.snapshot_id), 'source', 'film.html'), 'changed snapshot');
    await expect(f.creation.commit(input)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.store.activeCommit(input.reservation.project_id)).toBeUndefined();
});
it('resolves a genuine created project without migration/cached layout, including after reopen', async () => {
    const f = await fixture(), input = await prepared(f), base = join(f.root, 'projects'), target = join(base, input.reservation.project_id);
    await mkdir(target, { recursive: true });
    const resolver = new ProjectResolver({ catalog: new ProjectCatalog(new Map()), revisions: f.store, migrationRoot: join(f.root, 'migrations') });
    resolver.attachCreatedProjects(f.creation, base);
    await expect(resolver.resolve(input.reservation.project_id)).rejects.toMatchObject({ status: 404 });
    await f.creation.commit(input);
    const view = await resolver.resolveNative(input.reservation.project_id);
    expect(view.kind).toBe('created');
    expect(view.frame_count).toBe(0);
    expect(view.source_root.value).toBe(join(target, 'source'));
    expect('migration_id' in view).toBe(false);
    expect(JSON.stringify(view.publicView())).not.toContain(f.root);
    await expect(resolver.resolveActivated(input.reservation.project_id)).rejects.toMatchObject({ status: 404 });
    f.store.close();
    stores.splice(stores.indexOf(f.store), 1);
    const reopened = new RevisionStore(f.path);
    stores.push(reopened);
    const creation = new ProjectCreationStore(reopened, f.now), next = new ProjectResolver({ catalog: new ProjectCatalog(new Map()), revisions: reopened, migrationRoot: join(f.root, 'migrations') });
    next.attachCreatedProjects(creation, base);
    expect((await next.resolveNative(input.reservation.project_id)).source_root.value).toBe(join(target, 'source'));
    expect(creation.sourceFact(input.reservation.project_id, input.snapshot.snapshot_id)).toEqual(input.fact);
});
it('refuses created source symlink escape even with byte-identical committed content', async () => {
    const f = await fixture(), input = await prepared(f), base = join(f.root, 'projects'), target = join(base, input.reservation.project_id);
    await f.creation.commit(input);
    const outside = join(f.root, 'outside-source');
    await rename(input.sourceRoot, outside);
    await symlink(outside, join(target, 'source'));
    const resolver = new ProjectResolver({ catalog: new ProjectCatalog(new Map()), revisions: f.store, migrationRoot: join(f.root, 'migrations') });
    resolver.attachCreatedProjects(f.creation, base);
    await expect(resolver.resolveNative(input.reservation.project_id)).rejects.toMatchObject({ status: 423 });
    expect(f.store.activeCommit(input.reservation.project_id)?.revision).toBe(1);
});
it('does not commit a proved snapshot when its author-source publication is replaced or absent', async () => {
    const f = await fixture(), input = await prepared(f), outside = join(f.root, 'outside-source');
    await rename(input.sourceRoot, outside);
    await symlink(outside, input.sourceRoot);
    await expect(f.creation.commit(input)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.count('cp_a0_project_origin')).toBe(0);
    expect(f.store.activeCommit(input.reservation.project_id)).toBeUndefined();
});
it('lets the real Host rebuild a created layout and inventory without a migration or registration hook', async () => {
    const f = await fixture(), input = await prepared(f);
    await f.creation.commit(input);
    const host = new NarralensHost({ catalog: new ProjectCatalog(new Map()), revisionStore: f.store, snapshotsRoot: join(f.root, 'snapshots'), migrationsRoot: join(f.root, 'migrations'), adoptionStagingRoot: join(f.root, 'adoption'), derivedRoot: join(f.root, 'derived') });
    try {
        host.projectResolver.attachCreatedProjects(f.creation, f.createdRoot);
        const view = await host.projectResolver.resolveNative(input.reservation.project_id);
        const rebuilt = await host.projections.layoutFor(view);
        expect(rebuilt.layout.root).toBe(input.sourceRoot);
        expect(rebuilt.layout.roots).toEqual(['film.html']);
        expect(rebuilt.expected_source_digest).toBe(input.snapshot.source_digest);
        const inventory = await host.assetInventory.inventory(input.reservation.project_id);
        expect(inventory).toMatchObject({ kind: 'created', store: 'created_source_fact', assets: [] });
        expect(f.count('migration')).toBe(0);
    }
    finally {
        await host.close();
        stores.splice(stores.indexOf(f.store), 1);
    }
});
it('refuses a same-bytes canonical path substitution after pinned proof', async () => {
    const f = await fixture(), input = await prepared(f), film = join(input.sourceRoot, 'film.html'), moved = join(input.sourceRoot, 'moved.html');
    await rename(film, moved);
    await symlink(moved, film);
    await expect(f.creation.commit(input)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.count('cp_a0_project_origin')).toBe(0);
});

it('re-proves reused snapshot durability through its source and both parent directories', async () => {
    const f = await fixture(), input = await prepared(f);
    const reused = await f.snapshots.publish({projectId: input.reservation.project_id, engine: 'openfilm', engineUpstreamSha: OPENFILM_UPSTREAM_SHA, sourceRoot: input.sourceRoot, roots: ['film.html']});
    expect(reused.created).toBe(false);
    const visited: string[] = [];
    const verifier = new CreationSourceVerifier(f.snapshots, '/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm', f.createdRoot, {afterFsync: path => { visited.push(path); }});
    await verifier.prove(input.reservation, reused, input.fact);
    const snapshotRoot = f.snapshots.snapshotRoot(input.reservation.project_id, input.snapshot.snapshot_id);
    expect(visited).toEqual(expect.arrayContaining([join(snapshotRoot, 'source', 'film.html'), join(snapshotRoot, 'source'), snapshotRoot, f.snapshots.projectRoot(input.reservation.project_id), join(f.root, 'snapshots'), input.sourceRoot, join(f.createdRoot, input.reservation.project_id), f.createdRoot]));
    const interrupted = new CreationSourceVerifier(f.snapshots, '/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm', f.createdRoot, {afterFsync: path => { if (path === snapshotRoot) throw new Error('snapshot fsync boundary interrupted'); }});
    await expect(interrupted.prove(input.reservation, reused, input.fact)).rejects.toThrow('snapshot fsync boundary interrupted');
    expect(f.store.activeCommit(input.reservation.project_id)).toBeUndefined();
});
