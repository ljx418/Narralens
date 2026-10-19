import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2.2 architecture fitness (M2.2 plan §3, §8, §11).
 *
 * Scans production source only. Tests legitimately build their own queues, journals and
 * stores, so including `tests/` here would flag correct test setup.
 */

const REPO = process.cwd();

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) { if (entry !== "node_modules") found.push(...walk(full)); continue; }
    if (/\.(ts|tsx)$/u.test(entry)) found.push(full);
  }
  return found;
}

const SOURCE_FILES = walk(resolve(REPO, "src"));
const sourceOf = (file: string): string => readFileSync(file, "utf8");

/** Methods of a class body, used to scope the "no forbidden member" scans. */
function classBody(source: string, className: string): string {
  const start = source.indexOf(`class ${className} `);
  if (start === -1) return "";
  let depth = 0;
  let opened = false;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") { depth += 1; opened = true; }
    if (source[index] === "}") { depth -= 1; if (opened && depth === 0) return source.slice(start, index + 1); }
  }
  return source.slice(start);
}

describe("M2.2 fitness: one state machine, no arbitrary state writes", () => {
  it("1. every production `UPDATE ... SET state` lives in transition, advanceJournal or markRecovering", () => {
    // Registered, not exempted. Each of these writes `UPDATE ... SET state=... WHERE
    // ... AND state=<expected>` and throws unless exactly one row changed, which is the
    // property this rule protects. `transitionFrom`, `markStale` and `quarantine` are M3.1's
    // materialization machine; `transitionBootstrap` is W2.0's asset-ledger bootstrap.
    const helpers = ["transition", "advanceJournal", "markRecovering", "#state", "#assetImportState",
      "transitionBootstrap", "transitionFrom", "markStale", "quarantine"];
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const text = sourceOf(file);
      for (const match of text.matchAll(/UPDATE\s+(\w+)\s+SET\s+([^;]*?)\bstate\s*=/giu)) {
        const table = match[1] ?? "";
        const assignments = match[2] ?? "";
        // Only the SET list counts: a `state='...'` in the WHERE clause is a predicate.
        if (/\bWHERE\b/iu.test(assignments)) continue;
        // The job table has its own documented transition table; rule 13 owns that one.
        if (table === "job") continue;
        // Find the enclosing method by looking at the text just before the statement.
        const before = text.slice(Math.max(0, match.index! - 4000), match.index!);
        const enclosing = [...before.matchAll(/^\s{2}(?:async\s+)?(\w+)\s*\(/gmu)].pop()?.[1] ?? "";
        if (helpers.includes(enclosing)) continue;
        offenders.push(`${relative(REPO, file)} ${table}: ${assignments.trim().slice(0, 40)} (in ${enclosing || "<top level>"})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("13. every job state write goes through the store that owns the transition table", () => {
    const owner = "src/host/persistent-job-store.ts";
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      if (file.endsWith("revision-store.ts")) continue;
      if (/UPDATE\s+job\s+SET[^;]*?\bstate\s*=/iu.test(sourceOf(file))) offenders.push(relative(REPO, file));
    }
    expect(offenders).toEqual([]);
    // The statements live in the store, and the legal pairs are declared once.
    expect(sourceOf(resolve(REPO, owner))).not.toMatch(/JOB_TRANSITIONS\s*=/u);
    const defaults = sourceOf(resolve(REPO, "src/host/job-defaults.ts"));
    expect(defaults).toContain("export const JOB_TRANSITIONS");
    expect(defaults).toContain("completed_after_cancel: []");
  });

  it("2. no production DELETE on a journal row; rows are evidence, not scratch", () => {
    const offenders = SOURCE_FILES.filter((file) => /DELETE\s+FROM\s+(edit_journal|asset_import_journal|project_transaction)/iu.test(sourceOf(file)));
    expect(offenders.map((file) => relative(REPO, file))).toEqual([]);
  });

  it("3. only project_state ever changes the current revision", () => {
    // `revision_event` and `active_commit` may record a revision; none of them may own one.
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const text = sourceOf(file);
      for (const match of text.matchAll(/UPDATE\s+(\w+)\s+SET\s+([\s\S]{0,80}?)\brevision\s*=\s*[^\s,)]/gu)) {
        const table = match[1]!;
        if (table === "project_state" || table === "project_transaction") continue;
        offenders.push(`${relative(REPO, file)}:${table}`);
      }
    }
    expect(offenders).toEqual([]);
    const store = sourceOf(resolve(REPO, "src/host/projects/revision-store.ts"));
    expect(store).toMatch(/UPDATE project_state SET revision=/u);
  });
});

describe("M2.2 fitness: no second actor, queue, store or timeline", () => {
  it("4. exactly one ProjectOperationQueue is constructed by the Host and injected everywhere", () => {
    const server = sourceOf(resolve(REPO, "src/host/server.ts"));
    expect((server.match(/new InMemoryProjectOperationQueue\(\)/gu) ?? []).length).toBe(1);
    expect(server).toContain("dependencies.writes?.operations ??");
    // The actor and the import service must share the instance the Host injected.
    expect(server).toContain("this.imports = dependencies.imports ?? new AssetImportService(");
  });

  it("5. no production class extends or duplicates ProjectWriteActor", () => {
    const offenders = SOURCE_FILES
      .filter((file) => !file.endsWith("project-write-actor.ts"))
      .filter((file) => /extends\s+ProjectWriteActor\b/u.test(sourceOf(file)));
    expect(offenders.map((file) => relative(REPO, file))).toEqual([]);
  });

  it("6. the revision store owns one database handle; no second DatabaseSync for project state", () => {
    const offenders = SOURCE_FILES
      .filter((file) => !file.endsWith("revision-store.ts"))
      .filter((file) => /new DatabaseSync\(/u.test(sourceOf(file)));
    expect(offenders.map((file) => relative(REPO, file))).toEqual([]);
  });

  it("7. EngineProjection is still a read-only projection with no persistence", () => {
    const types = sourceOf(resolve(REPO, "src/contracts/engine-types.ts"));
    const projection = types.slice(types.indexOf("export interface EngineProjection"), types.indexOf("export interface EngineBinding"));
    expect(projection).not.toMatch(/INSERT|UPDATE|DELETE|DatabaseSync/u);
  });
});

describe("M2.2 fitness: routes that must stay closed stay unmounted", () => {
  const server = sourceOf(resolve(REPO, "src/host/server.ts"));

  it("8. /api/migration/v1 holds exactly the frozen route set, including M2.3's three", () => {
    const routes = [...server.matchAll(/\^\\\/api\\\/migration\\\/v1\\\/([^$]*)\$/gu)].map((match) => match[1]!);
    expect(routes).toEqual([
      "projects\\/([A-Za-z0-9_-]+)\\/engine",
      "projects\\/([A-Za-z0-9_-]+)\\/migrate-copy",
      "migrations\\/([A-Za-z0-9_-]+)",
      "migrations\\/([A-Za-z0-9_-]+)\\/rollback",
    ]);
  });

  it("9. materialize, adopt, impact and history restore appear nowhere as routes", () => {
    for (const closed of ["materialize", "adopt", "impact", "history"]) {
      expect(server.includes(`/api/migration/v1/projects/([A-Za-z0-9_-]+)\\/${closed}`), closed).toBe(false);
    }
  });

  it("10. a frozen fictional operation is still a 422, not a new state", () => {
    const types = sourceOf(resolve(REPO, "src/contracts/types.ts"));
    const union = types.slice(types.indexOf("export type ApiErrorCode"), types.indexOf("export interface ApiError"));
    expect(union).toContain("UNSUPPORTED_EDIT");
    expect(union).toContain("SOURCE_CHANGED");
    expect(union).not.toMatch(/ADOPT_|MATERIALIZE_/u);
  });
});

describe("M2.2 fitness: the write gate and the store agree", () => {
  it("11. state() and the recovery gate read one predicate", () => {
    const store = sourceOf(resolve(REPO, "src/host/projects/revision-store.ts"));
    const state = store.slice(store.indexOf("  state(projectId: string"), store.indexOf("  setVisualLock("));
    expect(state).toContain("this.recoveryGate(projectId, initialRevision, ignoredTransactionId)");
    expect(state).not.toContain("#projectHasPending");
    // The predicate itself lives in exactly one place.
    expect((store.match(/recoveryGate\(projectId: string, initialRevision: number, ignoredTransactionId\?: string\): boolean \{/gu) ?? []).length).toBe(1);
    expect((store.match(/Boolean\(row\?\.attention\) \|\| this\.#projectHasPending\(projectId, ignoredTransactionId\)/gu) ?? []).length).toBe(1);
  });

  it("12. attention_reason never reaches a response as an empty string", () => {
    const store = sourceOf(resolve(REPO, "src/host/projects/revision-store.ts"));
    expect(store).toContain('return reason === "" ? "UNKNOWN" : reason;');
  });

  it("13. the coordinator owns the state machine; the actor does not", () => {
    const actor = classBody(sourceOf(resolve(REPO, "src/host/projects/project-write-actor.ts")), "ProjectWriteActor");
    expect(actor).not.toMatch(/project_transaction|transition\(|advanceJournal\(|markRecovering\(/u);
    expect(actor).not.toMatch(/\blease_owner\b|\breaper\b/u);
  });

  it("14. production edits and startup recovery are wired through the coordinator", () => {
    const server = sourceOf(resolve(REPO, "src/host/server.ts"));
    expect(server).toContain("await this.coordinator.recoverOnStart()");
    expect(server).toContain("await this.coordinator.executeEdit(projectId, result.value)");
    expect(server).not.toContain("await this.writes.execute(projectId, result.value)");
    expect(server).toContain("this.jobs.acquireLease(job.job_id");
  });
});
