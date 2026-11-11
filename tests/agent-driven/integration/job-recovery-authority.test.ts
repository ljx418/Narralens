import { afterEach, expect, it } from 'vitest';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import { PersistentJobStore } from '../../../src/host/persistent-job-store.js';

const stores: RevisionStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const at = new Date('2026-11-11T00:00:00Z');
function fixture() {
  const store = new RevisionStore(); stores.push(store);
  const jobs = new PersistentJobStore(store);
  const job = jobs.create({ projectId: 'project_recovery', kind: 'snapshot_publish', payload: {} });
  return { store, jobs, id: job.job_id };
}
it.each(['live', 'owner', 'attempt', 'expiry'] as const)('does not reclaim a lease with a changed %s condition', (condition) => {
  const { store, jobs, id } = fixture();
  expect(jobs.acquireLease(id, { owner: 'worker', now: at, leaseMs: 1000 })).toBe(true);
  const before = store.readJob(id)!;
  const now = new Date(at.getTime() + (condition === 'live' ? 999 : 1000));
  expect(store.requeueExpiredObservedLease(id, condition === 'owner' ? 'other' : 'worker',
    condition === 'attempt' ? 2 : 1, before.lease_expires_at! + (condition === 'expiry' ? 1 : 0), now)).toBe(false);
  expect(store.readJob(id)).toEqual(before);
});
it('requeues the exact expired lease once, preserving its attempt and every unrelated job', () => {
  const { store, jobs, id } = fixture();
  const second = jobs.create({ projectId: 'project_recovery', kind: 'snapshot_publish', payload: { other: true } });
  const other = store.readJob(second.job_id);
  jobs.acquireLease(id, { owner: 'worker', now: at, leaseMs: 1000 });
  const expiry = store.readJob(id)!.lease_expires_at!;
  expect(store.requeueExpiredObservedLease(id, 'worker', 1, expiry, new Date(expiry))).toBe(true);
  expect(store.readJob(id)).toMatchObject({ state: 'queued', attempt: 1, lease_owner: null, lease_expires_at: null });
  expect(store.requeueExpiredObservedLease(id, 'worker', 1, expiry, new Date(expiry))).toBe(false);
  expect(store.readJob(second.job_id)).toEqual(other);
});
it('settles a truly unowned cancellation once without acquiring or incrementing a lease', () => {
  const { store, jobs, id } = fixture();
  jobs.requestCancel(id, at);
  expect(store.completeUnownedCancellation(id, 1, null, at)).toBe(false);
  expect(store.completeUnownedCancellation(id, 0, at.getTime(), at)).toBe(false);
  expect(store.completeUnownedCancellation(id, 0, null, at)).toBe(true);
  expect(store.readJob(id)).toMatchObject({ state: 'cancelled', attempt: 0, lease_owner: null });
  expect(store.completeUnownedCancellation(id, 0, null, at)).toBe(false);
});
it('cannot use unowned recovery to settle an active owner callback', () => {
  const { store, jobs, id } = fixture();
  jobs.acquireLease(id, { owner: 'worker', now: at, leaseMs: 1000 });
  jobs.requestCancel(id, at);
  const before = store.readJob(id)!;
  expect(store.completeUnownedCancellation(id, 1, before.lease_expires_at, new Date(at.getTime() + 2000))).toBe(false);
  expect(store.readJob(id)).toEqual(before);
});
it('rolls back the shared recovery write with the caller transaction', () => {
  const { store, jobs, id } = fixture(); jobs.requestCancel(id, at);
  const before = store.readJob(id)!;
  expect(() => store.atomic(() => {
    expect(store.completeUnownedCancellation(id, 0, null, at)).toBe(true);
    throw new Error('fault after Job CAS, before workflow settlement');
  })).toThrow('fault after Job CAS');
  expect(store.readJob(id)).toEqual(before);
});
