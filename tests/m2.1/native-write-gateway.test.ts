import { describe, expect, it } from "vitest";
import { NATIVE_WRITE_DENIED_EVENT, NativeWriteGateway } from "../../src/host/engine/native-write-gateway.js";
import { hostServiceCapabilityMap, hypitCapabilityMap, openFilmCapabilityMap } from "../../src/host/engine/engine-capabilities.js";
import { HypitEngineAdapter } from "../../src/adapters/hypit/hypit-engine-adapter.js";
import { HypitReadAdapter } from "../../src/adapters/hypit/hypit-read-adapter.js";
import { HypitWriteAdapter } from "../../src/adapters/hypit/hypit-write-adapter.js";
import { OpenFilmEngineAdapter } from "../../src/adapters/openfilm/openfilm-engine-adapter.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { resolve } from "node:path";
import {
  AUDIO_ENTRY_IDS, NATIVE_DIMENSION_COVERAGE, NATIVE_INVENTORY_COVERAGE, NATIVE_MUTATION_REGISTRY,
  NativeMutationRegistry, type NativePolicy,
} from "../../src/host/engine/native-mutation-registry.js";
import type { CapabilityMap } from "../../src/contracts/engine-types.js";

/** AC-003: every native write entry is translated, blocked or read_only; unknown is denied. */

const ALLOWED_POLICIES: NativePolicy[] = ["translated", "translated_host_service", "blocked", "read_only"];
const gateway = new NativeWriteGateway();
const hypitCapabilities = hypitCapabilityMap();
const hostServices = hostServiceCapabilityMap().entries;

describe("NativeMutationRegistry completeness", () => {
  it("AC-003 registers no unknown policy at all", () => {
    expect(NATIVE_MUTATION_REGISTRY.length).toBeGreaterThan(0);
    for (const entry of NATIVE_MUTATION_REGISTRY) {
      expect(ALLOWED_POLICIES, entry.entry_id).toContain(entry.policy);
      expect((entry.policy as string), entry.entry_id).not.toBe("unknown");
    }
    expect(NATIVE_MUTATION_REGISTRY.filter((entry) => (entry.policy as string) === "unknown")).toHaveLength(0);
  });

  it("AC-003 every entry records transport, impact, lock, reason and a test id", () => {
    for (const entry of NATIVE_MUTATION_REGISTRY) {
      expect(entry.transport, entry.entry_id).toBeTruthy();
      expect(entry.impact_class, entry.entry_id).toBeTruthy();
      expect(entry.lock_class, entry.entry_id).toBeTruthy();
      expect(entry.reason.length, entry.entry_id).toBeGreaterThan(10);
      expect(entry.test_id, entry.entry_id).toMatch(/^EN-\d+$/u);
    }
  });

  it("AC-003 covers every row of the verified OpenFilm native inventory exactly once", () => {
    const covered = new Map<string, string[]>();
    for (const map of [NATIVE_INVENTORY_COVERAGE, NATIVE_DIMENSION_COVERAGE]) {
      for (const [row, ids] of Object.entries(map)) {
        for (const id of ids) covered.set(id, [...(covered.get(id) ?? []), row]);
      }
    }
    for (const entry of NATIVE_MUTATION_REGISTRY) {
      expect(covered.get(entry.entry_id), `${entry.entry_id} is not covered by an inventory row`).toHaveLength(1);
    }
    for (const [row, ids] of Object.entries(NATIVE_INVENTORY_COVERAGE)) {
      const registry = new NativeMutationRegistry();
      expect(ids.map((id) => registry.has(id)), row).toEqual(ids.map(() => true));
      if (row !== "WebSocket / callback") expect(ids.length, row).toBeGreaterThan(0);
    }
    for (const id of AUDIO_ENTRY_IDS) expect(new NativeMutationRegistry().has(id)).toBe(true);
  });

  it("AC-003 the WebSocket / callback row yields no writable entry, so an event cannot trigger a commit", () => {
    expect(NATIVE_INVENTORY_COVERAGE["WebSocket / callback"]).toEqual([]);
    expect(NATIVE_MUTATION_REGISTRY.filter((entry) => entry.transport === "websocket")).toHaveLength(0);
  });

  it("AC-016 every provider and credential entry is blocked", () => {
    for (const entry of NATIVE_MUTATION_REGISTRY) {
      if (entry.entry_id.startsWith("provider.") || entry.entry_id.startsWith("cli.")) {
        expect(["blocked", "read_only"], entry.entry_id).toContain(entry.policy);
      }
    }
  });

  it("AC-003 only the two already-shipped typed edits and the Host asset import are translated", () => {
    const translated = NATIVE_MUTATION_REGISTRY.filter((entry) => entry.policy.startsWith("translated"));
    expect(translated.map((entry) => [entry.entry_id, entry.typed_intent]).sort()).toEqual([
      ["asset.import", null],
      ["timeline.replace_visual_asset", "replace_visual_asset"],
      ["timeline.set_visual_fit", "set_visual_fit"],
    ]);
  });
});

describe("NativeWriteGateway decisions", () => {
  it("AC-003 translates a known entry to the legacy typed edit with no mapping layer", () => {
    const decision = gateway.decide({ entry_id: "timeline.set_visual_fit", shot_id: "shot-002", value: "cover" }, hypitCapabilities);
    expect(decision).toMatchObject({ kind: "translated", edit: { op: "set_visual_fit", shot_id: "shot-002", value: "cover" } });
    const media = gateway.decide({ entry_id: "timeline.replace_visual_asset", shot_id: "shot-002", asset_id: "asset_visual_d4_alt" }, hypitCapabilities);
    expect(media).toMatchObject({ kind: "translated", edit: { op: "replace_visual_asset", shot_id: "shot-002", asset_id: "asset_visual_d4_alt" } });
  });

  it("AC-003 routes an asset import to the Host asset service rather than a film edit", () => {
    const decision = gateway.decide({ entry_id: "asset.import", asset_id: "asset_visual_d4_alt" }, hypitCapabilities, hostServices);
    expect(decision).toMatchObject({ kind: "translated_host_service", asset_id: "asset_visual_d4_alt" });
    // Without the Host service map the entry is not permitted either.
    expect(gateway.decide({ entry_id: "asset.import", asset_id: "asset_visual_d4_alt" }, hypitCapabilities))
      .toMatchObject({ kind: "blocked" });
    expect(gateway.decide({ entry_id: "asset.import" }, hypitCapabilities, hostServices)).toMatchObject({ kind: "blocked" });
  });

  it("AC-003 blocks every registered blocked entry with its recorded reason", () => {
    for (const entry of NATIVE_MUTATION_REGISTRY.filter((candidate) => candidate.policy === "blocked")) {
      const decision = gateway.decide({ entry_id: entry.entry_id }, hypitCapabilities);
      expect(decision, entry.entry_id).toMatchObject({ kind: "blocked", status: 422, code: "UNSUPPORTED_EDIT", reason: entry.reason });
    }
  });

  it("AC-003 passes read_only entries with no typed edit and no security event", () => {
    const local = new NativeWriteGateway();
    for (const entry of NATIVE_MUTATION_REGISTRY.filter((candidate) => candidate.policy === "read_only")) {
      expect(local.decide({ entry_id: entry.entry_id }, hypitCapabilities), entry.entry_id).toMatchObject({ kind: "read_only" });
    }
    expect(local.deniedCount()).toBe(0);
  });

  it("AC-003 denies an unregistered entry by default and records a security event", () => {
    const local = new NativeWriteGateway();
    const decision = local.decide({ entry_id: "totally.unknown.operation", transport: "http" });
    expect(decision).toMatchObject({ kind: "denied", status: 422, code: "UNSUPPORTED_EDIT",
      security_event: NATIVE_WRITE_DENIED_EVENT });
    expect(local.securityEvents()).toContainEqual({
      event: NATIVE_WRITE_DENIED_EVENT, entry_id: "totally.unknown.operation",
      transport: "http", reason: "unregistered native entry point",
    });
  });

  it("EN-02.b refuses a write whose capability the engine reports as unverified, whatever the policy", () => {
    const capabilities: CapabilityMap = {
      entries: { "timeline.set_visual_fit": { state: "unverified", reason: "no evidence" } },
      fps: { num: 30, den: 1 },
      fps_verified: true,
    };
    expect(gateway.decide({ entry_id: "timeline.set_visual_fit", shot_id: "shot-001", value: "cover" }, capabilities))
      .toMatchObject({ kind: "blocked", reason: "Capability is unverified for timeline.set_visual_fit" });
    // With the real Hypit map the same request is translated, because Hypit reports it.
    expect(gateway.decide({ entry_id: "timeline.set_visual_fit", shot_id: "shot-001", value: "cover" }, hypitCapabilities))
      .toMatchObject({ kind: "translated" });
    // With the OpenFilm map it is refused: the engine does not claim the capability.
    expect(gateway.decide({ entry_id: "timeline.set_visual_fit", shot_id: "shot-01", value: "cover" }, openFilmCapabilityMap()))
      .toMatchObject({ kind: "blocked" });
    expect(gateway.decide({ entry_id: "timeline.replace_visual_asset", shot_id: "shot-01", asset_id: "asset_visual_d4_alt" }, openFilmCapabilityMap()))
      .toMatchObject({ kind: "blocked" });
  });

  it("AC-002 maps a refusal to a stable HTTP error and refuses to throw on a permitted decision", () => {
    const blocked = gateway.decide({ entry_id: "history.undo" }, hypitCapabilities);
    expect(gateway.toHttpError(blocked, "test-correlation-id"))
      .toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT", details: { entry_id: "history.undo" } });
    const denied = new NativeWriteGateway().decide({ entry_id: "nope" });
    expect(gateway.toHttpError(denied)).toMatchObject({ status: 422, details: { entry_id: "unregistered" } });
    expect(() => gateway.toHttpError(gateway.decide({ entry_id: "markers.put" }, hypitCapabilities))).toThrow(/NOT_REFUSABLE/u);
    expect(() => gateway.enforce({ entry_id: "markers.put" }, hypitCapabilities)).toThrow(/PERMITTED_DECISION/u);
  });

  it("AC-003 refuses a translated entry whose typed intent is incomplete instead of inventing it", () => {
    expect(gateway.decide({ entry_id: "timeline.set_visual_fit" }, hypitCapabilities)).toMatchObject({ kind: "blocked" });
    expect(gateway.decide({ entry_id: "timeline.replace_visual_asset", shot_id: "shot-001" }, hypitCapabilities)).toMatchObject({ kind: "blocked" });
  });
});

/**
 * M-01 (external review): the capability map must be complete and fail closed.
 *
 * Both adapters returned `entries: {}`, which the gateway read as "nothing reported" and
 * then happily translated. A missing capability has to mean "unknown", never "allowed".
 */
describe("M-01 capability completeness and fail-closed behaviour", () => {
  const engineOwned = NATIVE_MUTATION_REGISTRY.filter((entry) => entry.policy !== "translated_host_service");

  it("every engine-owned registry operation has an entry in the capability map", async () => {
    const catalog = new ProjectCatalog(new Map([["d1-30s", resolve("fixtures/d1-30s/narralens.project.json")]]));
    const hypit = new HypitEngineAdapter({
      catalog, reader: new HypitReadAdapter(catalog), writer: new HypitWriteAdapter(catalog),
    });
    const openFilm = new OpenFilmEngineAdapter({
      revOf: () => "0000000000000000",
      readProjectFilm: async () => ({ text: "", rev: "", value: null, doc: null, problems: ["unused"] }),
      editProjectFilm: async () => { throw new Error("unreachable"); },
    });
    const ctx = { correlationId: "m21-capability-test", projectId: "cap", signal: AbortSignal.timeout(1_000) };
    const snapshot = { project_id: "cap", engine: "hypit" as const, source_digest: "" };

    for (const [name, map] of [["hypit", await hypit.capabilities(snapshot, ctx)],
      ["openfilm", await openFilm.capabilities(snapshot, ctx)]] as const) {
      for (const entry of engineOwned) {
        expect(map.entries[entry.entry_id], `${name} is missing ${entry.entry_id}`).toBeDefined();
        expect(map.entries[entry.entry_id]!.state, `${name}.${entry.entry_id}`).not.toBe("unverified");
      }
      expect(Object.keys(map.entries).length, `${name} reports extra operations`)
        .toBe(engineOwned.length);
    }
  });

  it("OpenFilm reports its two film writes as blocked, never as supported", async () => {
    const openFilm = new OpenFilmEngineAdapter({
      revOf: () => "0",
      readProjectFilm: async () => ({ text: "", rev: "", value: null, doc: null, problems: ["unused"] }),
      editProjectFilm: async () => { throw new Error("unreachable"); },
    });
    const map = await openFilm.capabilities(
      { project_id: "of", engine: "openfilm", source_digest: "" },
      { correlationId: "m21-openfilm-capability", projectId: "of", signal: AbortSignal.timeout(1_000) });
    for (const operation of ["timeline.set_visual_fit", "timeline.replace_visual_asset"]) {
      expect(map.entries[operation], operation).toMatchObject({ state: "blocked" });
      expect(map.entries[operation]!.reason, operation).toMatch(/M2\.1|translated write path/u);
    }
    expect(Object.values(map.entries).some((entry) => entry.state === "supported")).toBe(false);
  });

  it("refuses a translated write when the capability map does not report the operation", () => {
    const local = new NativeWriteGateway();
    const partial: CapabilityMap = { entries: {}, fps: { num: 30, den: 1 }, fps_verified: true };
    expect(local.decide({ entry_id: "timeline.set_visual_fit", shot_id: "shot-001", value: "cover" }, partial))
      .toMatchObject({ kind: "blocked", reason: expect.stringContaining("not reported") });
  });

  it("refuses a translated write when no capability map is supplied at all", () => {
    const local = new NativeWriteGateway();
    expect(local.decide({ entry_id: "timeline.set_visual_fit", shot_id: "shot-001", value: "cover" }))
      .toMatchObject({ kind: "blocked" });
    expect(local.decide({ entry_id: "timeline.replace_visual_asset", shot_id: "shot-001", asset_id: "asset_visual_d4_alt" }))
      .toMatchObject({ kind: "blocked" });
  });

  it("still translates when the engine positively reports the capability", () => {
    const hypit = hypitCapabilityMap();
    expect(gateway.decide({ entry_id: "timeline.set_visual_fit", shot_id: "shot-001", value: "cover" }, hypit))
      .toMatchObject({ kind: "translated" });
  });

  it("expresses asset import as a Host service capability, not an engine write", () => {
    const hostServices = hostServiceCapabilityMap();
    expect(hostServices.entries.asset_import).toBeDefined();
    expect(hypitCapabilityMap().entries).not.toHaveProperty("asset.import");
    expect(openFilmCapabilityMap().entries).not.toHaveProperty("asset.import");
  });
});
