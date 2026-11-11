import { describe, expect, it } from "vitest";
import { createDeliveryPhaseFixture } from "./helpers/created-production-run-fixture.js";
import { FixedPhaseExecutor } from "../../../src/host/agent-driven/fixed-phase-executor.js";

/**
 * What a restarted delivery finds.
 *
 * The recovery reads the recorded evidence, not the memory of a process that is gone.
 * These cases restart the executor against the same database and check that the work
 * already done is not done again and that the phases tell the recovery where to
 * continue.
 */
describe("the delivery recovery", () => {
  it("continues from the recorded encoded fact instead of encoding again", async () => {
    const f = createDeliveryPhaseFixture();
    const encoded = await f.executor.encode(f.request, f.lease);
    // A new executor over the same database stands for the restarted process.
    const resumed = new FixedPhaseExecutor({
      revisions: f.revisions,
      phases: {
        prepareEncoded: async () => { throw new Error('the resumed process must not encode again'); },
        inspectEncoded: async () => { throw new Error('the resumed process must not inspect yet'); },
        publishValidated: async () => { throw new Error('the resumed process must not publish yet'); },
      },
      fence: { claimAttempt: async () => true, checkAttempt: async () => 'proceed', releaseAttempt: async () => undefined },
      renderDelivery: f.delivery,
      reviewGates: f.gates,
      now: () => new Date('2026-11-12T00:00:00.000Z'),
    });
    const again = await resumed.encode(f.request, f.lease);
    expect(again.receipt_digest).toBe(encoded.receipt_digest);
    expect(f.calls.encode).toBe(1);
    f.revisions.close();
  });

  it("tells the recovery which phase the delivery reached", async () => {
    const f = createDeliveryPhaseFixture();
    expect(f.executor.progress(f.request)).toEqual({ encoded: null, inspected: null, published: null });
    await f.executor.encode(f.request, f.lease);
    const afterEncode = f.executor.progress(f.request);
    expect(afterEncode.encoded).not.toBeNull();
    expect(afterEncode.inspected).toBeNull();
    expect(afterEncode.published).toBeNull();
    await f.executor.inspect(f.request, f.lease);
    const afterInspect = f.executor.progress(f.request);
    expect(afterInspect.inspected?.technical_status).toBe('pass');
    expect(afterInspect.published).toBeNull();
    await f.executor.publish(f.request, f.lease);
    const afterPublish = f.executor.progress(f.request);
    expect(afterPublish.published?.parent_qc_digest).toBe(afterInspect.inspected?.receipt_digest);
    f.revisions.close();
  });

  it("records the published phase idempotently when the record is written after the publication", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    await f.executor.inspect(f.request, f.lease);
    const published = await f.executor.publish(f.request, f.lease);
    // The same receipt, recorded again, is a replay and changes nothing.
    f.delivery.recordPhase({
      project_id: f.request.project_id,
      job_id: f.request.job_id,
      phase: 'package_published',
      receipt: published,
      now: new Date('2026-11-12T00:05:00.000Z'),
    });
    const phase = f.delivery.phase(f.request.project_id, f.request.job_id, 'package_published');
    expect(phase?.receipt_digest).toBe(published.receipt_digest);
    expect(f.delivery.phases(f.request.project_id, f.request.job_id)).toEqual(['qc_inspected', 'package_published']);
    f.revisions.close();
  });

  it("refuses a different receipt for a phase that was already recorded", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    await f.executor.inspect(f.request, f.lease);
    await f.executor.publish(f.request, f.lease);
    const encoded = f.delivery.encodedFact(f.request.job_id)!;
    const other = { ...encoded, media_object_id: 'object-other' };
    expect(() => f.delivery.recordEvidence({
      project_id: f.request.project_id,
      job_id: f.request.job_id,
      kind: 'encoded',
      encoded: other,
      now: new Date('2026-11-12T00:05:00.000Z'),
    })).toThrow();
    f.revisions.close();
  });

  it("keeps the recorded evidence immutable", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    const db = f.revisions.compose((connection) => connection);
    expect(() => db.prepare("UPDATE created_render_evidence SET media_object_id='tampered' WHERE evidence_id=?")
      .run(`${f.request.job_id}:encoded`)).toThrow();
    expect(() => db.prepare("DELETE FROM created_render_evidence WHERE evidence_id=?")
      .run(`${f.request.job_id}:encoded`)).toThrow();
    expect(f.delivery.encodedFact(f.request.job_id)).not.toBeUndefined();
    f.revisions.close();
  });

  it("refuses a late phase that arrives with a lease the job no longer holds", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    await f.executor.inspect(f.request, f.lease);
    // The lease is gone by the time the publication arrives.
    f.release();
    await expect(f.executor.publish(f.request, f.lease)).rejects.toMatchObject({ code: 'RUN_SCOPE_REQUIRED' });
    expect(f.calls.publish).toBe(0);
    expect(f.delivery.phase(f.request.project_id, f.request.job_id, 'package_published')).toBeUndefined();
    f.revisions.close();
  });
});
