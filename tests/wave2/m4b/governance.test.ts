import { describe, expect, it } from "vitest";
import { openFilmCapabilityMap, hypitCapabilityMap } from "../../../src/host/engine/engine-capabilities.js";
import { NativeMutationRegistry } from "../../../src/host/engine/native-mutation-registry.js";
import { NativeWriteGateway } from "../../../src/host/engine/native-write-gateway.js";

describe("M4B native adoption governance", () => {
  it("registers one translated adoption entry and leaves history for M4C", () => {
    const registry = new NativeMutationRegistry();
    expect(registry.find("timeline.adopt_materialization")).toMatchObject({
      typed_intent: "adopt_materialization", policy: "translated", lock_class: "visual",
    });
    for (const id of ["history.restore", "history.undo", "history.redo"]) {
      expect(registry.find(id)).toMatchObject({ policy: "blocked" });
      expect(registry.find(id)?.reason).toContain("M4C");
    }
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
