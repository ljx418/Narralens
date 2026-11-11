import { describe, expect, it } from "vitest";
import { createDeliveryPhaseFixture } from "./helpers/created-production-run-fixture.js";

/**
 * The delivery phases, as BRIDGE consumes them.
 *
 * The job, its lease, the evidence stores and the executor are the production ones.
 * The MEDIA phase port is a double, because the real producer is not in this
 * repository; what the cases below prove is BRIDGE's side of the chain.
 */
describe("the fixed phase executor", () => {
  it("encodes once and records the encoded fact as immutable evidence", async () => {
    const f = createDeliveryPhaseFixture();
    const encoded = await f.executor.encode(f.request, f.lease);
    expect(encoded.receipt_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(f.calls.encode).toBe(1);
    expect(f.delivery.encodedFact(f.request.job_id)?.receipt_digest).toBe(encoded.receipt_digest);
    // A second encode does not encode again: the recorded fact is the answer.
    const again = await f.executor.encode(f.request, f.lease);
    expect(again.receipt_digest).toBe(encoded.receipt_digest);
    expect(f.calls.encode).toBe(1);
    f.revisions.close();
  });

  it("inspects the recorded encoded fact and binds the quality-control gate as pending", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    const qc = await f.executor.inspect(f.request, f.lease);
    expect(qc.technical_status).toBe('pass');
    expect(f.calls.inspect).toBe(1);
    expect(f.delivery.qcReceipt(f.request.job_id)?.receipt_digest).toBe(qc.receipt_digest);
    expect(f.delivery.phases(f.request.project_id, f.request.job_id)).toEqual(['qc_inspected']);
    const binding = f.gates.qcGateBinding('project-1', 'run-1');
    expect(binding?.receipt_digest).toBe(qc.receipt_digest);
    expect(binding?.gate_kind).toBe('qc');
    // A second inspection does not inspect again.
    await f.executor.inspect(f.request, f.lease);
    expect(f.calls.inspect).toBe(1);
    f.revisions.close();
  });

  it("publishes from the recorded bytes and records the published phase", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    await f.executor.inspect(f.request, f.lease);
    const published = await f.executor.publish(f.request, f.lease);
    expect(published.parent_encoded_digest).toBe(f.delivery.encodedFact(f.request.job_id)?.receipt_digest);
    expect(f.calls.publish).toBe(1);
    expect(f.delivery.phases(f.request.project_id, f.request.job_id)).toEqual(['qc_inspected', 'package_published']);
    // A second publish does not publish again.
    const again = await f.executor.publish(f.request, f.lease);
    expect(again.receipt_digest).toBe(published.receipt_digest);
    expect(f.calls.publish).toBe(1);
    f.revisions.close();
  });

  it("refuses to publish a blocked inspection and a warning without a disposition", async () => {
    const blocked = createDeliveryPhaseFixture();
    await blocked.executor.encode(blocked.request, blocked.lease);
    blocked.setStatus('block');
    await blocked.executor.inspect(blocked.request, blocked.lease);
    await expect(blocked.executor.publish(blocked.request, blocked.lease)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(blocked.calls.publish).toBe(0);
    blocked.revisions.close();

    const warned = createDeliveryPhaseFixture();
    await warned.executor.encode(warned.request, warned.lease);
    warned.setStatus('warn');
    warned.setItems([{ id: 'qc-1', status: 'warn', reason: 'the audio is a little loud', evidence_ref: null }]);
    await warned.executor.inspect(warned.request, warned.lease);
    await expect(warned.executor.publish(warned.request, warned.lease)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(warned.calls.publish).toBe(0);
    warned.revisions.close();
  });

  it("publishes a warning that has a recorded disposition", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    f.setStatus('warn');
    f.setItems([{ id: 'qc-1', status: 'warn', reason: 'the audio is a little loud', evidence_ref: null }]);
    await f.executor.inspect(f.request, f.lease);
    const request = { ...f.request, qc_dispositions: ['qc-1'] };
    const published = await f.executor.publish(request, f.lease);
    expect(published.receipt_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(f.calls.publish).toBe(1);
    f.revisions.close();
  });

  it("refuses the work when the job does not hold a live lease", async () => {
    const f = createDeliveryPhaseFixture();
    f.release();
    await expect(f.executor.encode(f.request, f.lease)).rejects.toMatchObject({ code: 'RUN_SCOPE_REQUIRED' });
    expect(f.calls.encode).toBe(0);
    f.revisions.close();
  });

  it("refuses the work when the attempt may no longer act", async () => {
    const f = createDeliveryPhaseFixture();
    f.setVerdict('superseded');
    await expect(f.executor.encode(f.request, f.lease)).rejects.toMatchObject({ code: 'RUN_PLAN_STALE' });
    // The fence is asked BEFORE the bytes are produced, so nothing was encoded and
    // nothing was recorded.
    expect(f.calls.encode).toBe(0);
    expect(f.delivery.encodedFact(f.request.job_id)).toBeUndefined();
    f.revisions.close();
  });

  it("refuses a lease of another execution attempt", async () => {
    const f = createDeliveryPhaseFixture();
    await expect(f.executor.encode(f.request, { ...f.lease, execution_attempt: 2 })).rejects.toMatchObject({ code: 'RUN_PLAN_STALE' });
    f.revisions.close();
  });
});
