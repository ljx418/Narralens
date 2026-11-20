import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import { ProjectCoordinator, type CoordinatorDeps } from '../../../src/host/projects/project-coordinator.js';
import { AdoptionCoordinator, type AdoptionCoordinatorDeps } from '../../../src/host/adoption/adoption-coordinator.js';
import { HistoryService, type HistoryServiceDeps } from '../../../src/host/history/history-service.js';
import { InMemoryProjectOperationQueue } from '../../../src/host/projects/project-operation-queue.js';
import { OperationIdempotencyStore } from '../../../src/host/projects/operation-idempotency-store.js';
import type { ControlledRecoveryFamily } from '../../../src/host/projects/controlled-recovery-scheduler.js';

// Actual family entrypoints + original SQLite/Coordinator; invalid minimal requests are
// deliberate parse sentinels. No valid publication, Host startup, three-domain business
// recovery, provider/renderer or SIGKILL result is claimed by these branch tests.
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function strictDeps<T>(known: Record<string, unknown>): T {
  return new Proxy(known, { get(target, key) {
    if (typeof key === 'string' && Object.hasOwn(target, key)) return target[key];
    throw new Error('Unexpected unprovided recovery dependency: ' + String(key));
  } }) as T;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'narralens-recovery-family-'));
  const store = new RevisionStore(join(root, 'host.sqlite'));
  cleanup.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const idempotency = new OperationIdempotencyStore(store.compose(db => db));
  const coordinator = new ProjectCoordinator(strictDeps<CoordinatorDeps>({ store, queue: new InMemoryProjectOperationQueue() }));
  const history = new HistoryService(strictDeps<HistoryServiceDeps>({ revisions: store, coordinator, stagingRoot: root }));
  const adoption = new AdoptionCoordinator(strictDeps<AdoptionCoordinatorDeps>({ revisions: store, coordinator, stagingRoot: root }));
  const add = (family: ControlledRecoveryFamily, id: string, project = 'p1', at = '2026-11-12T00:00:00.000Z') => {
    store.beginTransaction({ transaction_id: id, project_id: project, kind: family === 'history' ? 'history' : 'edit',
      request_json: JSON.stringify(family === 'created' ? { operation: 'agent.created_source.apply@1' }
        : { format: family === 'history' ? 'narralens.restore-request@1.0' : 'narralens.adopt-request@1.0' }),
      request_hash: 'a'.repeat(64), correlation_id: 'actual-family-order-component', base_revision: 0, createdAt: new Date(at) });
  };
  const recover = (family: 'history' | 'adoption', sweep = false) => (family === 'history' ? history : adoption).recoverOnStart({ sweep });
  return { root, store, coordinator, history, adoption, add, recover, idempotency };
}
it.each([
  ['created', 'adoption'], ['created', 'history'], ['history', 'adoption'], ['adoption', 'history'],
] as const)('actual %s predecessor defers younger %s before validating its own request', async (older, younger) => {
  const f = await fixture(); f.add(older, 'a'); f.add(younger, 'b');
  await f.recover(younger);
  expect(f.store.projectTransaction('a')?.state).toBe('received');
  expect(f.store.projectTransaction('b')?.state).toBe('received');
  expect(f.store.projectsInAttention()).toEqual([]);
});
it.each(['history', 'adoption'] as const)('actual %s equal-time older row is not mutually deferred', async family => {
  const f = await fixture(); f.add(family === 'history' ? 'adoption' : 'history', 'b'); f.add(family, 'a');
  await f.recover(family);
  expect(f.store.projectTransaction('a')?.state).toBe('attention'); // Invalid minimal request was really inspected.
  expect(f.store.projectTransaction('b')?.state).toBe('received');
  expect(f.store.projectTransaction('a')?.error_code).toBe(family === 'history' ? 'HISTORY_REQUEST_UNREADABLE' : 'ADOPTION_REQUEST_UNREADABLE');
});
it.each(['history', 'adoption'] as const)('actual %s sorts same-family rows before considering the younger one', async family => {
  const f = await fixture(); f.add(family, 'b'); f.add(family, 'a');
  await f.recover(family);
  expect(f.store.projectTransaction('a')?.state).toBe('attention');
  expect(f.store.projectTransaction('b')?.state).toBe('received');
});
it.each(['history', 'adoption'] as const)('actual %s keeps another project independent of an older created row', async family => {
  const f = await fixture(); f.add('created', 'a'); f.add(family, 'b', 'p2');
  await f.recover(family);
  expect(f.store.projectTransaction('a')?.state).toBe('received');
  expect(f.store.projectTransaction('b')?.state).toBe('attention');
  expect(f.store.projectsInAttention()).toEqual(['p2']);
});
it.each(['attention', 'recovering'] as const)('actual families cannot pass an older created %s row', async state => {
  const f = await fixture(); f.add('created', 'a'); f.add('history', 'b'); f.add('adoption', 'c');
  if (state === 'attention') f.store.transition('a', 'received', 'attention'); else f.store.markRecovering('a', 'component');
  await f.history.recoverOnStart({ sweep: false }); await f.adoption.recoverOnStart({ sweep: false });
  expect(f.store.projectTransaction('b')?.state).toBe('received'); expect(f.store.projectTransaction('c')?.state).toBe('received');
});
it.each(['history', 'adoption'] as const)('actual %s may inspect after the older transaction was safely aborted', async family => {
  const f = await fixture(); f.add('created', 'a'); f.add(family, 'b'); f.store.transition('a', 'received', 'aborted');
  await f.recover(family); expect(f.store.projectTransaction('a')?.state).toBe('aborted');
  expect(f.store.projectTransaction('b')?.state).toBe('attention');
});
it('legacy adoption sweep defaults true, while explicit false retains later-pass evidence', async () => {
  const f = await fixture(), path = join(f.root, 'adopt-kept', 'evidence.txt');
  await mkdir(join(f.root, 'adopt-kept')); await writeFile(path, 'not a completed recovery');
  expect(await f.adoption.recoverOnStart({ sweep: false })).toEqual({ recovered: 0, aborted: 0, attention: 0 });
  expect(await readFile(path, 'utf8')).toBe('not a completed recovery');
  expect(await f.adoption.recoverOnStart()).toEqual({ recovered: 0, aborted: 0, attention: 0 });
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('history retains explicit no-sweep and existing default sweep behavior', async () => {
  const f = await fixture(), path = join(f.root, 'restore-kept', 'evidence.txt');
  await mkdir(join(f.root, 'restore-kept')); await writeFile(path, 'restore evidence');
  await f.history.recoverOnStart({ sweep: false }); expect(await readFile(path, 'utf8')).toBe('restore evidence');
  await f.history.recoverOnStart(); await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('preserves the existing legacy corrupt-JSON decided state and observable error code', async () => {
  const f = await fixture(); f.store.beginTransaction({ transaction_id: 'corrupt', project_id: 'p1', kind: 'edit',
    request_json: '{not json at all', request_hash: 'a'.repeat(64), correlation_id: 'old-corrupt-case', base_revision: 0 });
  await f.adoption.recoverOnStart({ sweep: false });
  expect(f.store.projectTransaction('corrupt')).toMatchObject({ state: 'attention', error_code: 'ADOPTION_REQUEST_UNREADABLE' });
});
it('both actual family entrypoints leave readable unknown legacy requests to generic recovery', async () => {
  const f = await fixture(); f.store.beginTransaction({ transaction_id: 'legacy', project_id: 'p1', kind: 'edit',
    request_json: JSON.stringify({ format: 'narralens.edit-request@1.0' }), request_hash: 'a'.repeat(64), correlation_id: 'unknown-legacy', base_revision: 0 });
  await f.history.recoverOnStart({ sweep: false }); await f.adoption.recoverOnStart({ sweep: false });
  expect(f.store.projectTransaction('legacy')?.state).toBe('received'); expect(f.store.projectsInAttention()).toEqual([]);
});

function validRequest(family: 'history' | 'adoption', key: string) {
  return { format: family === 'history' ? 'narralens.restore-request@1.0' : 'narralens.adopt-request@1.0',
    base_revision: 0, expected_source_digest: 'a'.repeat(64), control_revision: 0,
    ...(family === 'history' ? { target_snapshot_id: 'snapshot-target' } : { materialization_id: 'materialization-target' }),
    impact_id: 'impact', impact_hash: 'b'.repeat(64), approval: { confirmed: true }, idempotency_key: key };
}
it.each(['history', 'adoption'] as const)('actual %s queue allows older unpublished work to abort while retaining a younger created row', async family => {
  const f = await fixture(); f.add(family, 'a'); f.add('created', 'b');
  f.store.compose(db => db.prepare('UPDATE project_transaction SET request_json=? WHERE transaction_id=?')
    .run(JSON.stringify(validRequest(family, 'recover-before-publication')), 'a'));
  await f.recover(family);
  expect(f.store.projectTransaction('a')?.state).toBe('aborted');
  expect(f.store.projectTransaction('b')?.state).toBe('received'); expect(f.store.projectsInAttention()).toEqual([]);
  expect(f.store.recoveryGate('p1', 0)).toBe(true); // Remaining created transaction still blocks ordinary writes.
  const op = family === 'history' ? 'controlled_write.restore_snapshot' : 'controlled_write.adopt_materialization';
  const response = f.idempotency.recall('p1', op, 'recover-before-publication');
  expect(response?.transaction_id).toBe('a'); expect(JSON.parse(response!.response_json)).toMatchObject({ status: 'aborted', previous_revision: 0, new_revision: 0 });
  expect(f.store.activeCommit('p1')).toBeUndefined(); expect(f.store.outboxRowCount()).toBe(0);
});
it.each(['history', 'adoption'] as const)('actual %s queue does not ignore an unknown pending write', async family => {
  const f = await fixture(); f.add(family, 'a');
  f.store.compose(db => db.prepare('UPDATE project_transaction SET request_json=? WHERE transaction_id=?')
    .run(JSON.stringify(validRequest(family, 'must-not-abort')), 'a'));
  f.store.beginTransaction({ transaction_id: 'unknown', project_id: 'p1', kind: 'edit', request_json: JSON.stringify({ format: 'narralens.edit-request@1.0' }),
    request_hash: 'a'.repeat(64), correlation_id: 'unknown-stays-owned', base_revision: 0 });
  await f.recover(family);
  expect(f.store.projectTransaction('a')?.state).toBe('attention'); expect(f.store.projectTransaction('unknown')?.state).toBe('received');
  const op = family === 'history' ? 'controlled_write.restore_snapshot' : 'controlled_write.adopt_materialization';
  expect(f.idempotency.recall('p1', op, 'must-not-abort')).toBeUndefined();
  expect(f.store.recoveryGate('p1', 0)).toBe(true); expect(f.store.outboxRowCount()).toBe(0);
});
