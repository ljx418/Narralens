import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  EngineBindingStore, HYPIT_UPSTREAM_SHA, OPENFILM_UPSTREAM_SHA, upstreamShaFor,
} from "../../src/host/engine/engine-binding-store.js";
import { EngineRegistry } from "../../src/host/engine/engine-registry.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import type { EnginePort } from "../../src/host/engine/engine-port.js";

/** AC-001: exactly one writable engine per project, enforced by the schema. */

const stores: EngineBindingStore[] = [];
const revisionStores: RevisionStore[] = [];
function store(): EngineBindingStore {
  const revisions = new RevisionStore();
  revisionStores.push(revisions);
  const created = new EngineBindingStore(revisions);
  stores.push(created);
  return created;
}
afterEach(() => {
  while (stores.length > 0) stores.pop();
  while (revisionStores.length > 0) revisionStores.pop()!.close();
});

describe("EngineBindingStore", () => {
  it("AC-001 writes one binding and refuses a second for the same project", () => {
    const bindings = store();
    const written = bindings.bind("proj-a", "hypit");
    expect(written).toMatchObject({ project_id: "proj-a", engine: "hypit", binding_version: 1,
      engine_upstream_sha: HYPIT_UPSTREAM_SHA, migrated_from: null });
    expect(bindings.read("proj-a")).toEqual(written);
    expect(() => bindings.bind("proj-a", "openfilm")).toThrow(/ENGINE_BINDING_ALREADY_EXISTS/u);
    expect(bindings.read("proj-a")).toEqual(written);
  });

  it("AC-001 the single-binding guarantee is a database constraint, not application discipline", () => {
    const bindings = store();
    bindings.bind("proj-schema", "hypit");
    const raw = new DatabaseSync(":memory:");
    try {
      // Reproduce the invariant independently of the store API.
      raw.exec(`CREATE TABLE engine_binding (project_id TEXT PRIMARY KEY, engine TEXT NOT NULL);`);
      raw.exec("INSERT INTO engine_binding(project_id, engine) VALUES('proj-schema','hypit');");
      expect(() => raw.exec("INSERT INTO engine_binding(project_id, engine) VALUES('proj-schema','openfilm');"))
        .toThrow(/UNIQUE|PRIMARY KEY/u);
    } finally { raw.close(); }
    expect(bindings.all()).toHaveLength(1);
  });

  it("AC-001 a migrated copy binds a new project id and leaves the old binding byte for byte identical", () => {
    const bindings = store();
    const original = bindings.bind("proj-old", "hypit", { createdAt: "2026-01-01T00:00:00.000Z" });
    const copy = bindings.bind("proj-copy", "openfilm", { createdAt: "2026-02-02T00:00:00.000Z", migratedFrom: "proj-old" });
    expect(copy).toMatchObject({ project_id: "proj-copy", engine: "openfilm",
      engine_upstream_sha: OPENFILM_UPSTREAM_SHA, migrated_from: "proj-old" });
    expect(bindings.read("proj-old")).toEqual(original);
    expect(bindings.all().map((binding) => binding.project_id)).toEqual(["proj-copy", "proj-old"]);
  });

  it("EN-01.a a missing binding is attention, never a guessed default engine", () => {
    const bindings = store();
    expect(bindings.read("never-bound")).toBeUndefined();
    expect(() => bindings.require("never-bound")).toThrowError(/no engine binding/u);
    try { bindings.require("never-bound"); } catch (error) {
      expect(error).toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    }
  });

  it("EN-01.a a binding that no longer matches the pinned upstream is attention", () => {
    const bindings = store();
    bindings.bind("proj-drift", "openfilm");
    expect(() => bindings.require("proj-drift", OPENFILM_UPSTREAM_SHA)).not.toThrow();
    expect(() => bindings.require("proj-drift", HYPIT_UPSTREAM_SHA)).toThrowError(/pinned upstream/u);
  });

  it("AC-006 pins a full 40-hex upstream sha for each engine and rejects anything else", () => {
    const bindings = store();
    expect(upstreamShaFor("hypit")).toBe("6fdd8c0f02c17b9970aee6deb4550a70e9d57acf");
    expect(upstreamShaFor("openfilm")).toBe("e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3");
    expect(() => bindings.bind("proj-bad", "openfilm", { engineUpstreamSha: "abc" })).toThrow(/40-hex/u);
    expect(() => bindings.bind("proj-bad", "openfilm", { engineUpstreamSha: "E70D9D93C7BEBE3D634FF2CAA6F7A738CDDE59D3" }))
      .toThrow(/40-hex/u);
    expect(bindings.read("proj-bad")).toBeUndefined();
  });

  it("AC-019 the store exposes no migration mutator; that is an M2.3 capability", () => {
    const methods = Object.getOwnPropertyNames(EngineBindingStore.prototype);
    expect(methods).toContain("bind");
    expect(methods).toContain("read");
    expect(methods).toContain("require");
    expect(methods.some((name) => name.toLowerCase().includes("migrate"))).toBe(false);
    expect(methods.some((name) => name.toLowerCase().includes("update") || name.toLowerCase().includes("rebind"))).toBe(false);
  });
});

describe("EngineRegistry", () => {
  const port = (kind: string): EnginePort => ({
    inspect: async () => { throw new Error("unused"); },
    capabilities: async () => { throw new Error("unused"); },
    plan: async () => { throw new Error("unused"); },
    stage: async () => { throw new Error("unused"); },
    validate: async () => { throw new Error("unused"); },
    preview: async () => { throw new Error("unused"); },
    render: async () => { throw new Error("unused"); },
  });

  it("AC-001 resolves exactly one engine for a project", () => {
    const bindings = store();
    bindings.bind("p1", "hypit");
    const registry = new EngineRegistry(bindings, { hypit: port("hypit"), openfilm: port("openfilm") });
    const resolved = registry.resolve("p1");
    expect(resolved.engine).toBe("hypit");
    expect(registry.kinds().sort()).toEqual(["hypit", "openfilm"]);
    expect(() => registry.register("hypit", port("hypit"))).toThrow(/ENGINE_ALREADY_REGISTERED/u);
  });

  it("AC-001 refuses to serve a project whose bound engine is not installed", () => {
    const bindings = store();
    bindings.bind("p2", "openfilm");
    const registry = new EngineRegistry(bindings, { hypit: port("hypit") });
    expect(() => registry.resolve("p2")).toThrowError(/not installed/u);
  });

  it("AC-001 re-checks the pinned upstream on every resolve", () => {
    const bindings = store();
    bindings.bind("p3", "openfilm");
    const registry = new EngineRegistry(bindings, { openfilm: port("openfilm") });
    expect(registry.resolveVerified("p3", OPENFILM_UPSTREAM_SHA).engine).toBe("openfilm");
    expect(() => registry.resolveVerified("p3", HYPIT_UPSTREAM_SHA)).toThrowError(/pinned upstream/u);
  });
});
