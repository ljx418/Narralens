import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {
  adoptionBinding,
  completedSource,
  preparedDraftFixture,
  readBinding,
  registryFacts,
} from '../integration/helpers/created-draft-fixture.js';
import type {
  CompletedPreparedSourceV1,
  PreparedAdoptionBindingV1,
  PreparedReadBindingV1,
} from '../../../src/host/render/assembly-ports.js';

/**
 * The completed prepared source and its two proofs.
 *
 * This is the MEDIA lane's focused check of the R2 read/adopt separation. It uses the
 * real fixture: a real Host, a real SQLite database, the real worker, the real pinned
 * OpenFilm checkout and real `ffmpeg` — so the prepared bytes are real bytes and not a
 * fixture of a prepared source. What is faked is the confirmation of the author and the
 * rights, because those are the Host's facts and not MEDIA's: the callback that
 * re-checks them is the seam this test drives.
 *
 * What it proves:
 *
 * - a completed `SOURCE_ONLY` source is proven *without* a live lease, because the job
 *   that produced it has already given its lease back;
 * - a read proof is never an adoption proof, in either direction, at runtime;
 * - the proof is bound to its *complete* binding: every field of the identity, of the
 *   baseline and of the adoption transaction is part of what the proof is about;
 * - a proof cannot be manufactured from JSON, because the proof is an object the
 *   verifier issued and not a fact anybody can write down;
 * - the bytes and the current author and rights are re-checked at the final assertion,
 *   which is the moment BRIDGE's transaction depends on;
 * - a proof is released explicitly, and a released proof is gone.
 *
 * The real adoption transaction, the real publication and the real A acceptance belong
 * to BRIDGE and MAIN. They are `NOT_RUN` here.
 */

/** Wait for the real worker's persisted terminal result; never synthesize success. */
async function waitForTerminal(f: Awaited<ReturnType<typeof preparedDraftFixture>>): Promise<void> {
  const end = Date.now() + 60000;
  while (!['succeeded', 'failed', 'attention', 'cancelled'].includes(f.host.revisions.readJob(f.task.job_id)!.state) && Date.now() < end) {
    await new Promise<void>((done) => setTimeout(done, 20));
  }
}

/** Every descriptor this process holds under the fixture's root. */
async function openDescriptorsUnder(root: string): Promise<string[]> {
  const {readlink} = await import('node:fs/promises');
  const targets = await Promise.all((await readdir('/proc/self/fd')).map((fd) => readlink('/proc/self/fd/' + fd).catch(() => '')));
  return targets.filter((path) => path.startsWith(root));
}

describe('a completed SOURCE_ONLY source and its two proofs', () => {
  it('is proven without a live lease, because the job already gave its lease back', async () => {
    const f = await preparedDraftFixture();
    let closed = false;
    const close = async (): Promise<void> => { if (closed) return; closed = true; await f.close(); };
    try {
      f.worker.start();
      await waitForTerminal(f);

      expect(f.tasks.receipt(f.task.job_id, 'owner').state).toBe('succeeded');
      const lease = f.host.revisions.compose((db) => db.prepare('SELECT lease_owner,lease_expires_at FROM job WHERE job_id=?').get(f.task.job_id)) as {lease_owner: string | null; lease_expires_at: number | null} | undefined;
      expect(lease?.lease_owner ?? null).toBeNull();

      const completed = completedSource(f);
      expect(completed.terminal_reason).toBe('SOURCE_ONLY');
      expect(completed.producer_attempt).toBe(f.tasks.preparedLeaseAttempt(f.task.job_id, 'owner'));

      // The proof reopens the real descriptors of the real prepared root.
      const binding = readBinding(completed, 'impact');
      const proof = await f.verifier.proveForRead(completed, binding, registryFacts(f));
      expect(() => f.verifier.assertCurrentForRead(completed, binding, proof, () => {})).not.toThrow();
      f.verifier.release(proof);
    } finally {
      await close();
    }
    expect(await openDescriptorsUnder(f.root)).toEqual([]);
  }, 120000);

  it('keeps the read proof and the adoption proof apart in both directions', async () => {
    const f = await preparedDraftFixture();
    let closed = false;
    const close = async (): Promise<void> => { if (closed) return; closed = true; await f.close(); };
    try {
      f.worker.start();
      await waitForTerminal(f);

      const completed = completedSource(f);
      const read = readBinding(completed, 'preview');
      const adopt = adoptionBinding(completed);
      const assets = registryFacts(f);

      const readProof = await f.verifier.proveForRead(completed, read, assets);
      expect(readProof.format).toBe('narralens.prepared-read-proof@1');
      expect(readProof.purpose).toBe('preview');
      expect(() => f.verifier.assertCurrentForAdoption(completed, adopt, readProof as never, () => {})).toThrow();

      const adoptionProof = await f.verifier.proveForAdoption(completed, adopt, assets);
      expect(adoptionProof.format).toBe('narralens.prepared-adoption-proof@1');
      expect(adoptionProof.purpose).toBe('adoption');
      expect(() => f.verifier.assertCurrentForRead(completed, read, adoptionProof as never, () => {})).toThrow();
      expect(() => f.verifier.assertCurrentForAdoption(completed, adopt, adoptionProof, () => {})).not.toThrow();

      f.verifier.release(readProof);
      f.verifier.release(adoptionProof);
    } finally {
      await close();
    }
    expect(await openDescriptorsUnder(f.root)).toEqual([]);
  }, 120000);

  it('binds the proof to the complete adoption binding', async () => {
    const f = await preparedDraftFixture();
    let closed = false;
    const close = async (): Promise<void> => { if (closed) return; closed = true; await f.close(); };
    try {
      f.worker.start();
      await waitForTerminal(f);

      const completed = completedSource(f);
      const adopt = adoptionBinding(completed);
      const proof = await f.verifier.proveForAdoption(completed, adopt, registryFacts(f));

      const mutations: ReadonlyArray<readonly [string, PreparedAdoptionBindingV1]> = [
        ['project', {...adopt, project_id: 'proj_other'}],
        ['run', {...adopt, run_id: 'run_other'}],
        ['execution', {...adopt, execution: {...adopt.execution, attempt: adopt.execution.attempt + 1}}],
        ['prepared source', {...adopt, prepared_source_id: 'prepared_other'}],
        ['prepared job', {...adopt, prepared_job_id: 'job_other'}],
        ['fact digest', {...adopt, fact_digest: 'f'.repeat(64)}],
        ['base revision', {...adopt, base_revision: adopt.base_revision + 1}],
        ['control revision', {...adopt, control_revision: adopt.control_revision + 1}],
        ['source digest', {...adopt, source_digest: '0'.repeat(64)}],
        ['selection version', {...adopt, selection_version: adopt.selection_version + 1}],
        ['transaction', {...adopt, transaction_id: 'txn_' + '9'.repeat(32)}],
        ['impact', {...adopt, impact_id: 'imp_' + '9'.repeat(32)}],
        ['impact hash', {...adopt, impact_hash: '9'.repeat(64)}],
        ['plan', {...adopt, plan_sha256: '9'.repeat(64)}],
        ['approval', {...adopt, approval_id: 'apr_' + '9'.repeat(32)}],
        ['target snapshot', {...adopt, target_snapshot_id: 'snap_' + '9'.repeat(32)}],
      ];
      for (const [what, other] of mutations) {
        expect(() => f.verifier.assertCurrentForAdoption(completed, other, proof, () => {}), what).toThrow();
      }
      // The proof itself is still good for its own binding.
      expect(() => f.verifier.assertCurrentForAdoption(completed, adopt, proof, () => {})).not.toThrow();
      f.verifier.release(proof);
    } finally {
      await close();
    }
    expect(await openDescriptorsUnder(f.root)).toEqual([]);
  }, 120000);

  it('refuses a proof that was manufactured from JSON', async () => {
    const f = await preparedDraftFixture();
    let closed = false;
    const close = async (): Promise<void> => { if (closed) return; closed = true; await f.close(); };
    try {
      f.worker.start();
      await waitForTerminal(f);

      const completed = completedSource(f);
      const binding = readBinding(completed, 'preview');
      const proof = await f.verifier.proveForRead(completed, binding, registryFacts(f));

      const fabricated = JSON.parse(JSON.stringify({...proof, format: 'narralens.prepared-read-proof@1', purpose: 'preview'})) as never;
      expect(() => f.verifier.assertCurrentForRead(completed, binding, fabricated, () => {})).toThrow();

      // Even the real completed source, written down, is not a proof.
      const written = JSON.parse(JSON.stringify(completed)) as never;
      expect(() => f.verifier.assertCurrentForRead(completed, binding, written, () => {})).toThrow();

      f.verifier.release(proof);
    } finally {
      await close();
    }
    expect(await openDescriptorsUnder(f.root)).toEqual([]);
  }, 120000);

  it('re-checks the bytes at the final assertion', async () => {
    const f = await preparedDraftFixture();
    let closed = false;
    const close = async (): Promise<void> => { if (closed) return; closed = true; await f.close(); };
    try {
      f.worker.start();
      await waitForTerminal(f);

      const completed = completedSource(f);
      const binding = readBinding(completed, 'preview');
      const proof = await f.verifier.proveForRead(completed, binding, registryFacts(f));

      const file = completed.fact.files.find((entry) => entry.relative_path === 'film.html');
      if (!file) throw new Error('The prepared film is missing');
      const path = join(completed.root, file.relative_path);
      const original = await readFile(path);
      const tampered = Buffer.from(original);
      tampered[0] = tampered[0] === 0x3c ? 0x3e : 0x3c;
      expect(tampered.length).toBe(original.length);
      await writeFile(path, tampered);

      expect(() => f.verifier.assertCurrentForRead(completed, binding, proof, () => {})).toThrow();
      // The author of the project is untouched by the tampering of a prepared copy.
      expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
      f.verifier.release(proof);
    } finally {
      await close();
    }
    expect(await openDescriptorsUnder(f.root)).toEqual([]);
  }, 120000);

  it('re-checks the current author and the current rights at the final assertion', async () => {
    const f = await preparedDraftFixture();
    let closed = false;
    const close = async (): Promise<void> => { if (closed) return; closed = true; await f.close(); };
    try {
      f.worker.start();
      await waitForTerminal(f);

      const completed = completedSource(f);
      const binding = readBinding(completed, 'preview');
      const proof = await f.verifier.proveForRead(completed, binding, registryFacts(f));

      // The Host says the current author changed.
      expect(() => f.verifier.assertCurrentForRead(completed, binding, proof, () => { throw new Error('the current author changed'); })).toThrow();
      // The check is synchronous: an asynchronous callback leaves the window open.
      expect(() => f.verifier.assertCurrentForRead(completed, binding, proof, (() => Promise.resolve()) as never)).toThrow();
      // A callback that returns something is not the agreed shape either.
      expect(() => f.verifier.assertCurrentForRead(completed, binding, proof, (() => 'ok') as never)).toThrow();
      // With the Host's own facts, the assertion holds.
      expect(() => f.verifier.assertCurrentForRead(completed, binding, proof, () => {})).not.toThrow();

      f.verifier.release(proof);
    } finally {
      await close();
    }
    expect(await openDescriptorsUnder(f.root)).toEqual([]);
  }, 120000);

  it('releases a proof explicitly and forgets it', async () => {
    const f = await preparedDraftFixture();
    let closed = false;
    const close = async (): Promise<void> => { if (closed) return; closed = true; await f.close(); };
    try {
      f.worker.start();
      await waitForTerminal(f);

      const completed = completedSource(f);
      const binding = readBinding(completed, 'preview');
      const proof = await f.verifier.proveForRead(completed, binding, registryFacts(f));
      expect(() => f.verifier.assertCurrentForRead(completed, binding, proof, () => {})).not.toThrow();

      f.verifier.release(proof);
      // A released proof is gone, and releasing it twice is not an error.
      expect(() => f.verifier.assertCurrentForRead(completed, binding, proof, () => {})).toThrow();
      f.verifier.release(proof);
    } finally {
      await close();
    }
    expect(await openDescriptorsUnder(f.root)).toEqual([]);
  }, 120000);

  it('closes every descriptor the verifier still holds', async () => {
    const f = await preparedDraftFixture();
    let closed = false;
    const close = async (): Promise<void> => { if (closed) return; closed = true; await f.close(); };
    try {
      f.worker.start();
      await waitForTerminal(f);

      const completed = completedSource(f);
      const read = readBinding(completed, 'preview');
      const adopt = adoptionBinding(completed);
      const assets = registryFacts(f);
      const readProof = await f.verifier.proveForRead(completed, read, assets);
      const adoptionProof = await f.verifier.proveForAdoption(completed, adopt, assets);

      await f.verifier.close();

      // A closed verifier holds nothing and proves nothing.
      expect(() => f.verifier.assertCurrentForRead(completed, read, readProof, () => {})).toThrow();
      expect(() => f.verifier.assertCurrentForAdoption(completed, adopt, adoptionProof, () => {})).toThrow();
      await expect(f.verifier.proveForRead(completed, read, assets)).rejects.toBeTruthy();
    } finally {
      await close();
    }
    expect(await openDescriptorsUnder(f.root)).toEqual([]);
  }, 120000);
});

/* The types are imported so that the mutations above stay honest about what a binding
 * is: every field of it is part of the proof. */
export type {CompletedPreparedSourceV1, PreparedReadBindingV1};
