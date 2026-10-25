import { describe, expect, it } from "vitest";
import { openFilmCapabilityMap, hypitCapabilityMap } from "../../../src/host/engine/engine-capabilities.js";
import { NativeMutationRegistry } from "../../../src/host/engine/native-mutation-registry.js";
import { NativeWriteGateway } from "../../../src/host/engine/native-write-gateway.js";

describe("M4B native adoption governance", () => {
  it("registers one translated adoption entry and leaves the raw history surface closed", () => {
    const registry = new NativeMutationRegistry();
    expect(registry.find("timeline.adopt_materialization")).toMatchObject({
      typed_intent: "adopt_materialization", policy: "translated", lock_class: "visual",
    });
    // **M4C translated the three history entry points** into a typed restore intent. The
    // *raw* history surface — a checkout, a merge, a discard, a commit — is still closed:
    // each of those would move the source without a Narralens revision.
    for (const id of ["history.restore", "history.undo", "history.redo"]) {
      expect(registry.find(id)).toMatchObject({
        typed_intent: "restore_snapshot", policy: "translated",
      });
      expect(registry.find(id)?.reason).toContain("M4C");
    }
    for (const id of ["history.checkout", "history.merge", "history.discard", "history.commit"]) {
      expect(registry.find(id)).toMatchObject({ policy: "blocked" });
    }
  });

  it("translates a history entry into a typed restore intent that still needs an impact and an approval", () => {
    const gateway = new NativeWriteGateway();
    const decision = gateway.decide({
      entry_id: "history.restore", target_snapshot_id: "c".repeat(64),
      impact_id: "impact_1", impact_hash: "a".repeat(64), approval_confirmed: true,
    }, openFilmCapabilityMap());
    expect(decision).toMatchObject({ kind: "translated", edit: {
      op: "restore_snapshot", target_snapshot_id: "c".repeat(64), impact_id: "impact_1",
      impact_hash: "a".repeat(64), approval: { confirmed: true },
    } });
    // Without the authorization it is refused, exactly as the adoption entry is.
    expect(gateway.decide({
      entry_id: "history.restore", target_snapshot_id: "c".repeat(64),
    }, openFilmCapabilityMap()).kind).toBe("blocked");
    // And a checkout is refused outright.
    expect(gateway.decide({
      entry_id: "history.checkout", target_snapshot_id: "c".repeat(64),
      impact_id: "impact_1", impact_hash: "a".repeat(64), approval_confirmed: true,
    }, openFilmCapabilityMap()).kind).toBe("blocked");
  });

  it("reports adoption only for OpenFilm", () => {
    expect(openFilmCapabilityMap().entries["timeline.adopt_materialization"]?.state).toBe("supported");
    expect(hypitCapabilityMap().entries["timeline.adopt_materialization"]?.state).toBe("blocked");
  });

  it("translates only the minimal authorised request and never client ops", () => {
    const gateway = new NativeWriteGateway();
    const decision = gateway.decide({
      entry_id: "timeline.adopt_materialization", materialization_id: "mat_1",
      impact_id: "impact_1", impact_hash: "a".repeat(64), approval_confirmed: true,
    }, openFilmCapabilityMap());
    expect(decision).toMatchObject({ kind: "translated", edit: {
      op: "adopt_materialization", materialization_id: "mat_1", impact_id: "impact_1",
      impact_hash: "a".repeat(64), approval: { confirmed: true },
    } });
    expect(gateway.decide({
      entry_id: "timeline.adopt_materialization", materialization_id: "mat_1",
    }, openFilmCapabilityMap()).kind).toBe("blocked");
  });
});
