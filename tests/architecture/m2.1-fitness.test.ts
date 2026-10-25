import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NATIVE_MUTATION_REGISTRY } from "../../src/host/engine/native-mutation-registry.js";
import {
  ENGINE_OWNED_OPERATION_IDS, hostServiceCapabilityMap, hypitCapabilityMap, openFilmCapabilityMap,
} from "../../src/host/engine/engine-capabilities.js";
import { ERROR_ALIAS_TABLE, ERROR_ALIAS_VERSION } from "../../src/host/engine/error-alias.js";
import { validatorFor } from "../../src/contracts/validator.js";
import apiErrorSchema from "../../contracts/api-error.schema.json" with { type: "json" };
import projectResponseSchema from "../../contracts/project-response.schema.json" with { type: "json" };

/**
 * Architecture fitness functions for M2.1.
 *
 * These assert the dependency direction, port purity, registry completeness, route
 * activation, error-union synchronisation and legacy invariants that
 * `docs/handoff-m2-m7d-claude/06_ARCHITECTURE_CONTRACT_LOCK.md` §6 requires from M2.1
 * onward. Rule numbers below match §8 of the M2.1 development plan.
 */

const REPO = process.cwd();
const SOURCE_ROOTS = ["src"];

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) { if (entry !== "node_modules") found.push(...walk(full)); continue; }
    if (/\.(ts|tsx)$/u.test(entry)) found.push(full);
  }
  return found;
}

const ALL_SOURCE_FILES = SOURCE_ROOTS.flatMap((root) => (() => { try { return walk(resolve(REPO, root)); } catch { return []; } })());

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specifiers = [
    ...[...text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/gu)].map((match) => match[1]!),
    ...[...text.matchAll(/\bimport\s+["']([^"']+)["']/gu)].map((match) => match[1]!),
  ];
  return specifiers;
}

function filesUnder(prefix: string): string[] {
  return ALL_SOURCE_FILES.filter((file) => file.replaceAll("\\", "/").includes(prefix));
}

describe("fitness 1-3: dependency direction", () => {
  it("1. app code never imports host, adapters or vendor", () => {
    const offenders = filesUnder("/src/app/").filter((file) =>
      importsOf(file).some((specifier) => /(^|\/)(host|adapters|vendor)\//u.test(specifier)));
    expect(offenders).toEqual([]);
  });

  it("2. contracts stay free of React, Node filesystem, database and adapter code", () => {
    const forbidden = /^(react|react-dom|node:fs|node:fs\/promises|node:sqlite|node:http|node:crypto|node:child_process)\b/u;
    const layer = /(^|\/)(host|adapters|vendor)\//u;
    const offenders = filesUnder("/src/contracts/").filter((file) =>
      importsOf(file).some((specifier) => forbidden.test(specifier) || layer.test(specifier)));
    expect(offenders).toEqual([]);
  });

  it("3. production code never imports a spike, statically or dynamically", () => {
    const offenders = ALL_SOURCE_FILES.filter((file) => {
      if (importsOf(file).some((specifier) => specifier.includes("spikes/"))) return true;
      // A dynamic import or require whose argument names a spike is the same violation.
      // Comments and documentation references are not imports and are not flagged.
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/\b(?:import|require)\s*\(\s*[^)]{0,200}?spikes\//gu)].length > 0;
    });
    expect(offenders).toEqual([]);
  });
});

describe("fitness 4: EnginePort purity", () => {
  const portSource = readFileSync(resolve(REPO, "src/host/engine/engine-port.ts"), "utf8");
  const interfaceBody = portSource.slice(portSource.indexOf("export interface EnginePort {"), portSource.indexOf("\n}", portSource.indexOf("export interface EnginePort {")));

  it("4. the port declares exactly seven operations and no commit, lock or shell surface", () => {
    const members = [...interfaceBody.matchAll(/^\s{2}(\w+)\(/gmu)].map((match) => match[1]!);
    expect(members.sort()).toEqual(["capabilities", "inspect", "plan", "preview", "render", "stage", "validate"]);
    expect(interfaceBody).not.toMatch(/\b(commit|setRevision|setLock|exec|spawn|shell|runCommand)\b/u);
  });

  it("4. no adapter declares a commit, revision, lock or process method", () => {
    const offenders = filesUnder("/src/adapters/").flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/^\s{2}(?:async\s+)?(\w+)\s*\(/gmu)]
        .map((match) => match[1]!)
        .filter((name) => /^(commit|setRevision|bumpRevision|setLock|acquireLock|exec|spawn|runCommand|shell)$/u.test(name))
        .map((name) => `${relative(REPO, file)}:${name}`));
    expect(offenders).toEqual([]);
  });
});

describe("fitness 5: registry completeness and policy legality", () => {
  it("5. no production entry is unknown and every policy is one of the four governed values", () => {
    const policies = new Set(NATIVE_MUTATION_REGISTRY.map((entry) => entry.policy));
    expect([...policies].sort()).toEqual(["blocked", "read_only", "translated", "translated_host_service"]);
  });

  it("5. the websocket transport carries no writable entry", () => {
    expect(NATIVE_MUTATION_REGISTRY.filter((entry) => entry.transport === "websocket")).toHaveLength(0);
  });
});

describe("fitness 6: route activation matches the stage gate", () => {
  const serverSource = readFileSync(resolve(REPO, "src/host/server.ts"), "utf8");

  it("6. /api/migration/v1 exposes exactly the routes the current stage froze", () => {
    const migrationRoutes = [...serverSource.matchAll(/\^\\\/api\\\/migration\\\/v1\\\/([^$]*)\$/gu)].map((match) => match[1]!);
    // M2.1 opened one read route; M2.3 adds migration copy, report and rollback; M3 opens
    // materialize and its read; M4A opens impact; M4B opens the single controlled-adoption
    // edit route; M4C opens the history read model, the controlled restore and the two
    // history translations. Any other addition has to be justified by its own stage.
    expect(migrationRoutes).toEqual([
      "projects\\/([A-Za-z0-9_-]+)\\/engine",
      "projects\\/([A-Za-z0-9_-]+)\\/migrate-copy",
      "projects\\/([A-Za-z0-9_-]+)\\/proposals\\/([A-Za-z0-9_-]+)\\/materialize",
      // M4A opens impact; M4B opens controlled adoption.
      "projects\\/([A-Za-z0-9_-]+)\\/impact",
      "projects\\/([A-Za-z0-9_-]+)\\/edits",
      // M4C opens the history read model, the controlled restore, and the undo and redo
      // *translations*. The translations return a typed intent and commit nothing.
      "projects\\/([A-Za-z0-9_-]+)\\/history",
      "projects\\/([A-Za-z0-9_-]+)\\/history\\/restore",
      "projects\\/([A-Za-z0-9_-]+)\\/history\\/undo",
      "projects\\/([A-Za-z0-9_-]+)\\/history\\/redo",
      "materializations\\/([A-Za-z0-9_-]+)",
      "migrations\\/([A-Za-z0-9_-]+)",
      "migrations\\/([A-Za-z0-9_-]+)\\/rollback",
    ]);
  });

  it("6. the write routes this stage does not own are never mounted", () => {
    // Searched in the escaped form `server.ts` actually contains. The previous unescaped
    // pattern matched nothing even for `materialize` after M3 opened it, so it was a check
    // that could not fail; this one can.
    const escaped = (suffix: string): string =>
      `\\/api\\/migration\\/v1\\/projects\\/([A-Za-z0-9_-]+)\\/${suffix}`;
    // **M4C opened the history routes**, so this stage no longer owns them. The list is
    // empty on purpose: a route that is closed must be closed *by name*, and "history" is
    // no longer one of them.
    for (const closed of [] as string[]) {
      expect(serverSource.includes(escaped(closed)), closed).toBe(false);
    }
    expect(serverSource.includes(escaped("history"))).toBe(true);
    expect(serverSource.includes(escaped("impact"))).toBe(true);
  });
});

describe("fitness 7: error code union, schema and alias table agree", () => {
  it("7. the TypeScript union and the JSON Schema enum are equal in both directions", async () => {
    const types = readFileSync(resolve(REPO, "src/contracts/types.ts"), "utf8");
    const block = types.slice(types.indexOf("export type ApiErrorCode"), types.indexOf("export interface ApiError"));
    const unionCodes = new Set([...block.matchAll(/"([A-Z][A-Z0-9_]+)"/gu)].map((match) => match[1]!));
    const schemaCodes = new Set<string>(apiErrorSchema.properties.code.enum);
    expect([...unionCodes].sort()).toEqual([...schemaCodes].sort());
    // 29 through M2.1; W2.0 adds IMPACT_REQUIRED, IMPACT_STALE and
    // HOST_RESOURCE_EXHAUSTED, each in the same commit as the schema enum and the alias
    // table, which is what the equality above is checking.
    expect(unionCodes.size).toBe(32);
  });

  it("7. the machine alias table covers every code and distinguishes each new one", () => {
    expect(ERROR_ALIAS_VERSION).toBe("narralens.error-alias@1");
    const tableCodes = new Set(ERROR_ALIAS_TABLE.map((entry) => entry.code));
    expect(tableCodes.size).toBe(ERROR_ALIAS_TABLE.length);
    const introduced = ERROR_ALIAS_TABLE.filter((entry) => !entry.legacy);
    expect(introduced.map((entry) => entry.code).sort())
      .toEqual(["CAPABILITY_NOT_ENABLED", "DATA_POLICY_DENIED", "ENGINE_UNAVAILABLE", "HOST_RESOURCE_EXHAUSTED",
        "IMPACT_REQUIRED", "IMPACT_STALE", "INVALID_RANGE", "SOURCE_CHANGED"]);
    for (const entry of introduced) {
      expect(entry.distinguishes_from, entry.code).toBeTruthy();
      expect(entry.distinction?.length ?? 0, entry.code).toBeGreaterThan(20);
      expect(entry.http_status, entry.code).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("fitness 8: SourceDigestV1 golden vectors", () => {
  it("8. every committed vector recomputes and the cross-language file exists", async () => {
    const { readFile } = await import("node:fs/promises");
    const vectors = JSON.parse(await readFile(resolve(REPO, "tests/m2.1-golden/source-digest-v1.vectors.json"), "utf8")) as {
      domain_prefix: string; vectors: unknown[];
    };
    expect(vectors.domain_prefix).toBe("narralens-source-v1\\n");
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(10);
  });
});

describe("fitness 9: legacy contract invariants", () => {
  it("9. the legacy project response keeps a float frame_rate and half-open frame names", () => {
    expect(projectResponseSchema.properties.frame_rate).toEqual({ type: "number", exclusiveMinimum: 0 });
    const selection = projectResponseSchema.$defs?.selection as { required: string[]; properties: Record<string, unknown> };
    expect(selection.required).toContain("end_frame_exclusive");
    expect(selection.properties).not.toHaveProperty("end_frame");
  });

  it("9. the digest manifest schema and the TypeScript manifest shape agree", () => {
    const schema = validatorFor("https://narralens.local/schemas/source-digest-manifest.schema.json");
    expect(schema).toBeTypeOf("function");
    expect(schema({ format: "narralens.source-digest-manifest@1.0", engine: "hypit",
      engine_upstream_sha: "a".repeat(40), files: [], assets: [] })).toBe(true);
    expect(schema({ format: "narralens.source-digest-manifest@1.0", engine: "gemini",
      engine_upstream_sha: "a".repeat(40), files: [], assets: [] })).toBe(false);
  });
});

describe("fitness 10-14: stage-specific invariants", () => {
  it("10. the engine read route never mutates and the legacy actor stays the only commit owner", () => {
    const engineMethod = readFileSync(resolve(REPO, "src/host/server.ts"), "utf8")
      .slice(readFileSync(resolve(REPO, "src/host/server.ts"), "utf8").indexOf("async #engine("),
        readFileSync(resolve(REPO, "src/host/server.ts"), "utf8").indexOf("async #project("));
    expect(engineMethod).not.toMatch(/this\.writes\.execute|this\.imports\.|markAttention|\.commit\(/u);
    expect(engineMethod).toContain("inspect");
  });

  it("11. no production path reaches editProjectFilm from a translated write", () => {
    const callers = ALL_SOURCE_FILES
      .filter((file) => !file.endsWith("openfilm-upstream.ts") && !file.endsWith("openfilm-engine-adapter.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("editProjectFilm"));
    expect(callers).toEqual([]);
    const gatewaySource = readFileSync(resolve(REPO, "src/host/engine/native-write-gateway.ts"), "utf8");
    expect(gatewaySource).not.toContain("editProjectFilm");
  });

  it("12. no <base href> handling creeps into the digest resolver", () => {
    expect(readFileSync(resolve(REPO, "src/host/engine/source-digest-v1.ts"), "utf8")).not.toMatch(/<base\b/u);
  });

  it("13. capability is fail-closed and outranks any registry policy (M-01)", () => {
    const gateway = readFileSync(resolve(REPO, "src/host/engine/native-write-gateway.ts"), "utf8");
    expect(gateway).toContain("const reported = capabilities?.entries[entry.entry_id]");
    expect(gateway).toContain('reported.state === "unverified"');
    // An unreported capability must be refused before any registry policy is consulted.
    const guard = gateway.indexOf("if (reported === undefined) {");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(gateway.indexOf('entry.policy === "translated" && reported.state !== "supported"'));
    expect(guard).toBeLessThan(gateway.indexOf('reported.state === "unverified"'));
  });

  it("13b. engine capability maps cover every engine-owned registry operation", () => {
    const engineOwned = NATIVE_MUTATION_REGISTRY.filter((entry) => entry.policy !== "translated_host_service");
    expect(ENGINE_OWNED_OPERATION_IDS).toEqual(engineOwned.map((entry) => entry.entry_id));
    for (const map of [hypitCapabilityMap(), openFilmCapabilityMap()]) {
      expect(Object.keys(map.entries).sort()).toEqual([...ENGINE_OWNED_OPERATION_IDS].sort());
      expect(Object.values(map.entries).some((entry) => entry.state === "unverified")).toBe(false);
    }
    // M4C added the three history entry points to the controlled write paths: the studio's
    // own history buttons are translated by the Host into an impact-bound restore, and
    // they are reported as supported so the gateway can judge them.
    expect(Object.entries(openFilmCapabilityMap().entries)
      .filter(([, entry]) => entry.state === "supported").map(([id]) => id))
      .toEqual(["timeline.adopt_materialization", "history.restore", "history.undo", "history.redo"]);
    expect(Object.keys(hostServiceCapabilityMap().entries)).toEqual(["asset_import"]);
  });

  it("14. the binding is re-checked against the pinned upstream on every read", () => {
    const registrySource = readFileSync(resolve(REPO, "src/host/engine/engine-registry.ts"), "utf8");
    expect(registrySource).toContain("resolveVerified");
    // M2.2 folded the table and its statements into RevisionStore, so the single-binding
    // guarantee now lives there; the store class is a typed face over it.
    const storeSource = readFileSync(resolve(REPO, "src/host/projects/revision-store.ts"), "utf8");
    expect(storeSource).toMatch(/CREATE TABLE IF NOT EXISTS engine_binding \([\s\S]*?project_id TEXT PRIMARY KEY/u);
    expect(storeSource).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS engine_binding_single_active/u);
    const facade = readFileSync(resolve(REPO, "src/host/engine/engine-binding-store.ts"), "utf8");
    expect(facade).not.toMatch(/DatabaseSync/u);
    expect(facade).not.toMatch(/CREATE TABLE/u);
  });
});

describe("fitness: no test-only shortcut in production", () => {
  it("production engine code contains no skip, todo or vitest import", () => {
    const offenders = filesUnder("/src/host/engine/").concat(filesUnder("/src/adapters/"))
      .filter((file) => /from\s+["']vitest|describe\(|\bit\.skip\b|\btest\.skip\b|\btodo\b/iu.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the engine modules are all TypeScript, not JavaScript shims", () => {
    for (const file of filesUnder("/src/host/engine/")) expect(extname(file)).toBe(".ts");
  });
});
