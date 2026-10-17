import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HypitEngineAdapter } from "../../src/adapters/hypit/hypit-engine-adapter.js";
import { OpenFilmEngineAdapter } from "../../src/adapters/openfilm/openfilm-engine-adapter.js";

/** AC-002: the Host owns commit, revision and locks. No adapter may hold that power. */

const PORT_METHODS = ["capabilities", "inspect", "plan", "preview", "render", "stage", "validate"] as const;
const FORBIDDEN_ADAPTER_MEMBERS = /\b(commit|setRevision|setLock|bumpRevision|acquireLock|runCommand|exec|spawn|shell)\b/u;

function portInterfaceBody(source: string): string {
  const start = source.indexOf("export interface EnginePort {");
  expect(start, "engine-port.ts must declare an EnginePort interface").toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
}

describe("EnginePort shape", () => {
  const source = readFileSync("src/host/engine/engine-port.ts", "utf8");
  const body = portInterfaceBody(source);

  it("AC-002 exposes exactly the seven governed operations", () => {
    const members = [...body.matchAll(/^\s{2}(\w+)\(/gmu)].map((match) => match[1]!);
    expect([...members].sort()).toEqual([...PORT_METHODS].sort());
  });

  it("AC-002 declares no commit, revision write, lock write or command execution on the port", () => {
    expect(body).not.toMatch(FORBIDDEN_ADAPTER_MEMBERS);
    expect(body).not.toMatch(/\burl\s*:/u);
    expect(body).not.toMatch(/\bpath\s*:\s*string/u);
  });

  it("AC-002 accepts only Host-constructed absolute paths, never a client-supplied one", () => {
    expect(source).toContain("export function absoluteServerPath");
    expect(source).toContain("const absoluteServerPathBrand: unique symbol = Symbol(");
    expect(source).not.toMatch(/export const absoluteServerPathBrand/u);
  });
});

describe("Engine adapters hold no commit power", () => {
  const files = [
    "src/adapters/hypit/hypit-engine-adapter.ts",
    "src/adapters/openfilm/openfilm-engine-adapter.ts",
    "src/adapters/openfilm/openfilm-upstream.ts",
  ];

  it("AC-002 no adapter declares a commit, revision or lock mutator", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const declarations = [...text.matchAll(/^\s{2}(?:async\s+)?(\w+)\s*\(/gmu)].map((match) => match[1]!);
      expect(declarations.filter((name) => FORBIDDEN_ADAPTER_MEMBERS.test(name)), file).toEqual([]);
    }
  });

  it("AC-002 both adapters implement the whole port or none of it", () => {
    const portMethods = ["inspect", "capabilities", "plan", "stage", "validate", "preview", "render"];
    for (const Adapter of [HypitEngineAdapter, OpenFilmEngineAdapter]) {
      for (const method of portMethods) {
        expect(typeof (Adapter.prototype as unknown as Record<string, unknown>)[method], Adapter.name)
          .toBe("function");
      }
    }
  });

  it("AC-004 the OpenFilm adapter refuses to plan any write instead of inventing one", async () => {
    const adapter = new OpenFilmEngineAdapter({
      revOf: () => "0000000000000000",
      readProjectFilm: async () => ({ text: "", rev: "", value: null, doc: null, problems: ["not used"] }),
      editProjectFilm: async () => { throw new Error("editProjectFilm must not be reachable in M2.1"); },
    });
    await expect(adapter.plan(
      { project_id: "of-1", engine: "openfilm", source_digest: "0".repeat(64) },
      { op: "set_visual_fit", shot_id: "shot-01", value: "contain" },
      { correlationId: "test-correlation-id", projectId: "of-1", idempotencyKey: "k",
        baseRevision: 1, expectedSourceDigest: "0".repeat(64), controlRevision: 0, signal: AbortSignal.timeout(1000) },
    )).rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
  });

  it("AC-004 the OpenFilm adapter surfaces an unreadable film as ENGINE_UNAVAILABLE, not a guess", async () => {
    const adapter = new OpenFilmEngineAdapter({
      revOf: () => "0",
      readProjectFilm: async () => ({ text: "<html>", rev: "0", value: null, doc: null, problems: ["film.html is broken"] }),
      editProjectFilm: async () => { throw new Error("unreachable"); },
    });
    adapter.registerLayout("of-2", { root: "tests/fixtures/m2.1/openfilm-project", roots: ["film.html"] });
    await expect(adapter.inspect(
      { project_id: "of-2", engine: "openfilm", source_digest: "" },
      { correlationId: "test-correlation-id", projectId: "of-2", signal: AbortSignal.timeout(1000) },
    )).rejects.toMatchObject({ status: 503, code: "ENGINE_UNAVAILABLE" });
  });

  it("EN-06 an unregistered project layout is unavailable rather than defaulted", async () => {
    const adapter = new OpenFilmEngineAdapter({
      revOf: () => "0",
      readProjectFilm: async () => ({ text: "", rev: "", value: null, doc: null, problems: ["x"] }),
      editProjectFilm: async () => { throw new Error("unreachable"); },
    });
    await expect(adapter.inspect(
      { project_id: "unknown-project", engine: "openfilm", source_digest: "" },
      { correlationId: "test-correlation-id", projectId: "unknown-project", signal: AbortSignal.timeout(1000) },
    )).rejects.toMatchObject({ status: 503, code: "ENGINE_UNAVAILABLE" });
  });
});
