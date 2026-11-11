import { describe, expect, it } from "vitest";
import { createDeliveryPhaseFixture, encodedFactOf, qcReceiptOf } from "./helpers/created-production-run-fixture.js";

/**
 * The quality-control gate and the evidence behind it.
 *
 * A gate is bound to the receipt of a real inspection, and to nothing else. The
 * binding is a fact about the evidence; the gate's own state belongs to the run's
 * checkpoint, and it moves to `accepted` only with the trusted human decision that the
 * workflow registers. Nothing in this store decides anything.
 */
describe("the quality-control gate binding", () => {
  it("binds the gate to the receipt of a real inspection", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    const qc = await f.executor.inspect(f.request, f.lease);
    const binding = f.gates.qcGateBinding('project-1', 'run-1');
    expect(binding?.gate_id).toBe('gate-qc');
    expect(binding?.receipt_digest).toBe(qc.receipt_digest);
    expect(binding?.receipt.technical_status).toBe('pass');
    // The binding is a fact; it is not a decision about the gate.
    expect(Object.keys(binding ?? {}).some((key) => key === 'state')).toBe(false);
    f.revisions.close();
  });

  it("refuses a gate that is bound to something which is not an inspection", () => {
    const f = createDeliveryPhaseFixture();
    const encoded = encodedFactOf(f.request);
    expect(() => f.gates.bindQcGate({
      project_id: 'project-1',
      run_id: 'run-1',
      gate_id: 'gate-qc',
      gate_kind: 'qc',
      receipt: encoded as never,
      now: new Date('2026-11-12T00:00:00.000Z'),
    })).toThrow();
    expect(f.gates.qcGateBinding('project-1', 'run-1')).toBeUndefined();
    f.revisions.close();
  });

  it("refuses a gate that is bound to a receipt of another project", () => {
    const f = createDeliveryPhaseFixture();
    const encoded = encodedFactOf(f.request);
    const qc = qcReceiptOf(encoded, 'pass');
    expect(() => f.gates.bindQcGate({
      project_id: 'project-2',
      run_id: 'run-1',
      gate_id: 'gate-qc',
      gate_kind: 'qc',
      receipt: qc,
      now: new Date('2026-11-12T00:00:00.000Z'),
    })).toThrow();
    f.revisions.close();
  });

  it("refuses a receipt that was edited after it was made", () => {
    const f = createDeliveryPhaseFixture();
    const encoded = encodedFactOf(f.request);
    const qc = qcReceiptOf(encoded, 'pass');
    const tampered = { ...qc, technical_status: 'pass' as const, frame_count: 91 } as never;
    expect(() => f.gates.bindQcGate({
      project_id: 'project-1',
      run_id: 'run-1',
      gate_id: 'gate-qc',
      gate_kind: 'qc',
      receipt: tampered,
      now: new Date('2026-11-12T00:00:00.000Z'),
    })).toThrow();
    f.revisions.close();
  });

  it("refuses a gate that is already bound to another receipt", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    await f.executor.inspect(f.request, f.lease);
    const encoded = f.delivery.encodedFact(f.request.job_id)!;
    // A DIFFERENT receipt: the same bytes inspected again with a recorded check.
    const other = qcReceiptOf(encoded, 'pass', [{ id: 'qc-2', status: 'pass', reason: 'checked again', evidence_ref: null }]);
    expect(() => f.gates.bindQcGate({
      project_id: 'project-1',
      run_id: 'run-1',
      gate_id: 'gate-qc',
      gate_kind: 'qc',
      receipt: other,
      now: new Date('2026-11-12T00:01:00.000Z'),
    })).toThrow();
    f.revisions.close();
  });

  it("keeps the binding immutable", async () => {
    const f = createDeliveryPhaseFixture();
    await f.executor.encode(f.request, f.lease);
    await f.executor.inspect(f.request, f.lease);
    const db = f.revisions.compose((connection) => connection);
    expect(() => db.prepare("UPDATE created_review_gate_binding SET receipt_digest=? WHERE gate_id='gate-qc'")
      .run('a'.repeat(64))).toThrow();
    expect(f.gates.qcGateBinding('project-1', 'run-1')).not.toBeUndefined();
    f.revisions.close();
  });

  it("does not let a chapter package stand in for an inspection", async () => {
    const f = createDeliveryPhaseFixture();
    // The delivery gate of a chapter is a different gate; the quality-control gate is
    // bound to the inspection and to nothing else.
    await f.executor.encode(f.request, f.lease);
    await f.executor.inspect(f.request, f.lease);
    expect(f.gates.qcGateBinding('project-1', 'run-1')?.receipt.technical_status).toBe('pass');
    expect(f.gates.binding('project-1', 'run-1', 'gate-other')).toBeUndefined();
    f.revisions.close();
  });
});
