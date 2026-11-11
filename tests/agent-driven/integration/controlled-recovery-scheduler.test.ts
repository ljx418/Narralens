import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';
import {
  ControlledRecoveryScheduler, controlledRecoveryFamily, hasOlderControlledPending,
  type ControlledRecoveryFamily, type ControlledRecoveryHandlers,
} from '../../../src/host/projects/controlled-recovery-scheduler.js';

// Actual original SQLite rows, synthetic family callbacks only. Not Host/specialized recovery acceptance.
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const requests = {
  created: JSON.stringify({ operation: 'agent.created_source.apply@1' }),
  history: JSON.stringify({ format: 'narralens.restore-request@1.0' }),
  adoption: JSON.stringify({ format: 'narralens.adopt-request@1.0' }),
};
async function fixture(memory = false) {
  const root = await mkdtemp(join(tmpdir(), 'narralens-controlled-scheduler-'));
  const store = new RevisionStore(memory ? ':memory:' : join(root, 'host.sqlite'));
  cleanup.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const ids: string[] = [];
  const add = (family: ControlledRecoveryFamily, id: string, project = 'p1', at = '2026-11-12T00:00:00.000Z') => {
    store.beginTransaction({ transaction_id: id, project_id: project, kind: family === 'history' ? 'history' : 'edit',
      correlation_id: 'scheduler-component', request_json: requests[family], request_hash: 'a'.repeat(64),
      base_revision: 0, createdAt: new Date(at) }); ids.push(id);
  };
  const rows = () => ids.map(id => store.projectTransaction(id)!);
  const calls: string[] = [], decisions: string[] = [];
  const handlers: ControlledRecoveryHandlers = Object.fromEntries((['created', 'history', 'adoption'] as const)
    .map(family => [family, async ({ sweep }: { sweep: boolean }) => {
      calls.push(`${family}:${sweep}`);
      const currentRows = rows();
      for (const row of currentRows.sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1
        : a.transaction_id < b.transaction_id ? -1 : 1)) {
        if (row.state !== 'received' || controlledRecoveryFamily(row) !== family || hasOlderControlledPending(row, currentRows)) continue;
        store.transition(row.transaction_id, 'received', 'aborted'); decisions.push(row.transaction_id); row.state = 'aborted';
      }
      return { recovered: 999999 }; // Must not influence scheduler progress.
    }])) as ControlledRecoveryHandlers;
  return { store, add, rows, calls, decisions, handlers };
}
it('resolves the A1-C2-H3 counterexample from actual database decisions', async () => {
  const f = await fixture(); f.add('adoption', '1'); f.add('created', '2'); f.add('history', '3');
  const result = await new ControlledRecoveryScheduler(f.store, f.handlers).recover();
  expect(result).toEqual({ passes: 2, decided: 3, unresolved_transaction_ids: [], stopped: 'decided' });
  expect(f.decisions).toEqual(['1', '2', '3']);
  expect(f.calls).toEqual(['created:true', 'history:true', 'adoption:true', 'created:false', 'history:false', 'adoption:false']);
});
it('uses as many progress passes as a long alternating chain actually requires', async () => {
  // Same original SQLite schema/readers; in-memory only for exhaustive chain throughput, no durability claim.
  const f = await fixture(true), sequence: ControlledRecoveryFamily[] = Array.from({ length: 96 }, (_, i) => ['adoption', 'history', 'created'][i % 3] as ControlledRecoveryFamily);
  for (let i = 0; i < sequence.length; i++) f.add(sequence[i]!, String(i).padStart(3, '0'));
  const result = await new ControlledRecoveryScheduler(f.store, f.handlers).recover();
  expect(result.decided).toBe(96); expect(result.passes).toBeGreaterThan(3);
  expect(f.decisions).toEqual(f.rows().map(row => row.transaction_id));
  expect(f.calls.filter(call => call.endsWith(':true'))).toHaveLength(3);
});
it('orders equal timestamps by transaction id instead of mutually deferring', async () => {
  const f = await fixture(); f.add('history', 'b'); f.add('adoption', 'a');
  expect(hasOlderControlledPending(f.store.projectTransaction('a')!, f.rows())).toBe(false);
  expect(hasOlderControlledPending(f.store.projectTransaction('b')!, f.rows())).toBe(true);
  await new ControlledRecoveryScheduler(f.store, f.handlers).recover(); expect(f.decisions).toEqual(['a', 'b']);
});
it('does not let blocked older work in one project block another project', async () => {
  const f = await fixture(); f.add('adoption', '1'); f.add('created', '2'); f.add('created', '3', 'p2');
  f.handlers.adoption = async () => ({ recovered: 1000000 });
  const result = await new ControlledRecoveryScheduler(f.store, f.handlers).recover();
  expect(result).toEqual({ passes: 2, decided: 1, unresolved_transaction_ids: ['1', '2'], stopped: 'no_progress' });
  expect(f.decisions).toEqual(['3']);
});
it('ignores fabricated progress and stops after one unchanged pass', async () => {
  const f = await fixture(); f.add('created', '1');
  const handlers = { created: async () => ({ recovered: 1 }), history: async () => ({ aborted: 1 }), adoption: async () => ({ attention: 1 }) };
  expect(await new ControlledRecoveryScheduler(f.store, handlers).recover()).toEqual({ passes: 1, decided: 0, unresolved_transaction_ids: ['1'], stopped: 'no_progress' });
});
it('does not count forward nonterminal state movement as a recovery decision', async () => {
  const f = await fixture(); f.add('created', '1');
  f.handlers.created = async () => f.store.transition('1', 'received', 'preconditions_checked');
  const result = await new ControlledRecoveryScheduler(f.store, f.handlers).recover();
  expect(result.passes).toBe(1); expect(result.decided).toBe(0); expect(result.stopped).toBe('no_progress');
});
it('retains attention and recovering rows in unresolved exclusion and ordering', async () => {
  const f = await fixture(); f.add('adoption', '1'); f.add('created', '2'); f.add('history', '3', 'p2');
  f.store.transition('1', 'received', 'attention'); f.store.markRecovering('3', 'component');
  const result = await new ControlledRecoveryScheduler(f.store, f.handlers).recover();
  expect(result).toEqual({ passes: 1, decided: 0, unresolved_transaction_ids: ['1', '2', '3'], stopped: 'no_progress' });
  expect(f.store.projectTransaction('1')?.state).toBe('attention'); expect(f.store.projectTransaction('3')?.state).toBe('recovering');
});
it('counts a new attention decision once without treating the blocked project as writable', async () => {
  const f = await fixture(); f.add('created', '1');
  f.handlers.created = async () => f.store.transition('1', 'received', 'attention');
  expect(await new ControlledRecoveryScheduler(f.store, f.handlers).recover()).toEqual({ passes: 1, decided: 1, unresolved_transaction_ids: ['1'], stopped: 'decided' });
});
it.each(['new pending', 'new committed', 'reclassified unknown'] as const)('refuses lifecycle growth: %s', async mode => {
  const f = await fixture(); f.add('created', '1');
  if (mode === 'reclassified unknown') {
    f.store.beginTransaction({ transaction_id: 'unknown', project_id: 'p1', kind: 'edit', correlation_id: 'component', request_json: '{}', request_hash: 'a'.repeat(64), base_revision: 0 });
  }
  f.handlers.created = async () => {
    if (mode === 'reclassified unknown') f.store.compose(db => db.prepare('UPDATE project_transaction SET request_json=? WHERE transaction_id=?').run(requests.created, 'unknown'));
    else {
      f.add('history', 'new');
      if (mode === 'new committed') f.store.compose(db => db.prepare("UPDATE project_transaction SET state='committed' WHERE transaction_id='new'").run());
    }
  };
  await expect(new ControlledRecoveryScheduler(f.store, f.handlers).recover()).rejects.toThrow('LIFECYCLE_SET_CHANGED');
});
it.each(['regression', 'terminal reopen', 'request mutation', 'row removal'] as const)('refuses lifecycle violation: %s', async mode => {
  const f = await fixture(); f.add('created', '1');
  if (mode === 'regression') f.store.transition('1', 'received', 'preconditions_checked');
  if (mode === 'terminal reopen') f.store.transition('1', 'received', 'aborted');
  f.handlers.created = async () => f.store.compose(db => {
    if (mode === 'row removal') db.prepare("DELETE FROM project_transaction WHERE transaction_id='1'").run();
    else if (mode === 'request mutation') db.prepare("UPDATE project_transaction SET request_hash=? WHERE transaction_id='1'").run('b'.repeat(64));
    else db.prepare("UPDATE project_transaction SET state='received' WHERE transaction_id='1'").run();
  });
  await expect(new ControlledRecoveryScheduler(f.store, f.handlers).recover()).rejects.toThrow('LIFECYCLE_');
});
it('propagates family failure, restores its single-flight guard and rejects overlapping execution', async () => {
  const f = await fixture(); f.add('created', '1');
  let release!: () => void;
  f.handlers.created = () => new Promise<void>(resolve => { release = resolve; });
  const scheduler = new ControlledRecoveryScheduler(f.store, f.handlers), first = scheduler.recover();
  await expect(scheduler.recover()).rejects.toThrow('ALREADY_RUNNING'); release(); await first;
  f.handlers.created = async () => { throw Error('family failure'); };
  await expect(scheduler.recover()).rejects.toThrow('family failure');
  f.handlers.created = async () => undefined;
  expect((await scheduler.recover()).stopped).toBe('no_progress');
});
it('sweeps each family once even with an empty database', async () => {
  const f = await fixture();
  expect(await new ControlledRecoveryScheduler(f.store, f.handlers).recover()).toEqual({ passes: 1, decided: 0, unresolved_transaction_ids: [], stopped: 'decided' });
  expect(f.calls).toEqual(['created:true', 'history:true', 'adoption:true']);
});
it.each([
  { kind: 'edit', request_json: '{}' }, { kind: 'edit', request_json: '{' },
  { kind: 'asset_import', request_json: requests.created }, { kind: 'history', request_json: requests.created },
  { kind: 'edit', request_json: requests.history }, { kind: 'snapshot_publish', request_json: requests.adoption },
] as const)('does not claim malformed or wrong-kind request $kind/$request_json', row => {
  expect(controlledRecoveryFamily(row)).toBeUndefined();
});
