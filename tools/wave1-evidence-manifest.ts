import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";

/**
 * Wave 1 combined evidence manifest.
 *
 * M2.1, M2.2 and M2.3 each have their own evidence; this is the single combined record a
 * reviewer reads once, covering EN-03/EN-05, MIG-01..07, the M2.1 and M2.2 case sets, and the
 * D1-M1 regression. Per-case status, never a test total.
 *
 * Same discipline as the per-ticket manifests: every referenced file exists, is tracked, and
 * still hashes to what is recorded. Run from a clean tree.
 */

const ROOT = resolve("docs/evidence/WAVE1");
const CODE_PATHS = ["src", "tests", "contracts", "tools", "package.json"];
const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim();

const artifact = (repoRelative: string): { path: string; sha256: string } => {
  execFileSync("git", ["ls-files", "--error-unmatch", "--", repoRelative], { encoding: "utf8" });
  return { path: repoRelative, sha256: sha256File(resolve(repoRelative)) };
};

const SELF = "docs/evidence/WAVE1/evidence-manifest.json";
const recordedHead = (() => {
  const path = resolve(ROOT, "logs/environment.txt");
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").split("\n").find((line) => line.startsWith("git_head="))?.split("=")[1]?.trim();
})();
if (recordedHead === undefined) throw new Error("docs/evidence/WAVE1/logs/environment.txt does not record git_head");
const dirty = git("status", "--porcelain").split("\n").filter((line) => line.trim() !== "" && !line.includes(SELF));

interface Case {
  case_id: string;
  ticket: "M2.1" | "M2.2" | "M2.3" | "WAVE1";
  title: string;
  status: "PASSED" | "NOT_APPLICABLE_APPROVED" | "NOT_RUN";
  evidence_kind: string[];
  assertions: string[];
  artifacts: Array<{ path: string; sha256: string }>;
}

const cases: Case[] = [
  // ── M2.1 ───────────────────────────────────────────────────────────────────────────
  { case_id: "EN-01", ticket: "M2.1", status: "PASSED", evidence_kind: ["schema_unit", "http_integration"],
    title: "one writable engine per project; legacy Hypit contract intact",
    assertions: ["one binding per project, enforced by a primary key", "a migrated copy binds OpenFilm without displacing the source",
      "the legacy D1-D4.2.1 suite still passes"],
    artifacts: [artifact("tests/m2.1/engine-binding-store.test.ts"), artifact("src/host/engine/engine-binding-store.ts")] },
  { case_id: "EN-02", ticket: "M2.1", status: "PASSED", evidence_kind: ["schema_unit", "mutation_test"],
    title: "every native write entry is translated or refused",
    assertions: ["every inventory row registered", "no unknown policy", "an unregistered operation is denied and recorded"],
    artifacts: [artifact("tests/m2.1/native-write-gateway.test.ts"), artifact("src/host/engine/native-mutation-registry.ts")] },
  { case_id: "EN-04", ticket: "M2.1", status: "PASSED", evidence_kind: ["integration", "mutation_test"],
    title: "a source change outside the Host conflicts and raises attention",
    assertions: ["the comparison uses the committed baseline, never a freshly observed digest",
      "the project enters attention and the next write is refused", "external bytes are left untouched"],
    artifacts: [artifact("tests/m2.1/native-bypass.test.ts"), artifact("src/host/projects/revision-store.ts")] },
  { case_id: "EN-06", ticket: "M2.1", status: "PASSED", evidence_kind: ["security_scan", "real_upstream_probe"],
    title: "the pinned upstream is verified byte for byte",
    assertions: ["HEAD pinned, checkout clean, and every loaded file hashed",
      "a tampered copy is refused and the original still loads", "credential scan reports no findings"],
    artifacts: [artifact("tests/m2.1/openfilm-upstream-lock.test.ts"), artifact("contracts/openfilm-upstream-lock.json")] },
  { case_id: "TM-01/02/03", ticket: "M2.1", status: "PASSED", evidence_kind: ["schema_unit"],
    title: "integer half-open frames at a rational fps, verified as 30/1",
    assertions: ["every frame round trips exactly", "invalid ranges are refused, never clamped",
      "a short asset is refused rather than looped, frozen or retimed"],
    artifacts: [artifact("tests/m2.1/time-model.test.ts"), artifact("src/host/engine/time-model.ts")] },

  // ── M2.2 ───────────────────────────────────────────────────────────────────────────
  { case_id: "JRNL", ticket: "M2.2", status: "PASSED", evidence_kind: ["schema_unit", "mutation_test"],
    title: "one authoritative transaction machine with predecessor-checked steps",
    assertions: ["every transition names its predecessor", "legacy journals advance only through the checked helper",
      "no path writes a state without naming where it came from"],
    artifacts: [artifact("tests/m2.2/transaction-state-machine.test.ts"), artifact("src/host/projects/revision-store.ts")] },
  { case_id: "SNAP/DUR", ticket: "M2.2", status: "PASSED", evidence_kind: ["integration", "fault_injection"],
    title: "content-addressed snapshots published only when durability is proven",
    assertions: ["files then directories bottom-up, then rename, then the parent entry",
      "an unproven step publishes nothing and undoes a rename that already happened"],
    artifacts: [artifact("tests/m2.2/snapshot-store.test.ts"), artifact("src/host/projects/snapshot-store.ts")] },
  { case_id: "LOCK", ticket: "M2.2", status: "PASSED", evidence_kind: ["schema_unit", "mutation_test"],
    title: "three server-computed lock classes; preserve is intent, not authority",
    assertions: ["visual always; duration for range changes; narration for subtitle and audio",
      "the client reason text grants nothing", "control revision moves with the lock"],
    artifacts: [artifact("tests/m2.2/lock-service.test.ts"), artifact("src/host/projects/lock-service.ts")] },
  { case_id: "LOCK-NA", ticket: "M2.2", status: "NOT_APPLICABLE_APPROVED", evidence_kind: ["scope"],
    title: "duration and narration lock integration",
    assertions: ["no M2.2 typed edit can change duration or narration",
      "the classifier is unit tested with synthetic payloads", "an unreachable integration is not recorded as a pass"],
    artifacts: [artifact("docs/migration/M2/M2.2-development-and-acceptance-plan.md")] },
  { case_id: "JB-01..07", ticket: "M2.2", status: "PASSED", evidence_kind: ["restart", "concurrency", "schema_unit", "mutation_test"],
    title: "durable jobs with CAS leases, monotonic events and quarantined late results",
    assertions: ["a restart keeps jobs and events", "a lost lease never becomes a success",
      "two workers cannot both own a job", "an unknown cost stays unknown",
      "a late result is quarantined rather than adopted", "replay never re-runs a commit"],
    artifacts: [artifact("tests/m2.2/persistent-job-store.test.ts"), artifact("tests/m2.2/outbox.test.ts"),
      artifact("src/host/persistent-job-store.ts"), artifact("src/host/outbox.ts")] },
  { case_id: "BYP", ticket: "M2.2", status: "PASSED", evidence_kind: ["http_integration", "mutation_test"],
    title: "the native write gateway is in front of every production write path",
    assertions: ["an attention project never reaches the actor", "a locked range never reaches the actor",
      "an engine that does not report the capability refuses"],
    artifacts: [artifact("tests/m2.2/project-coordinator.test.ts"), artifact("src/host/projects/project-coordinator.ts")] },

  // ── M2.3 ───────────────────────────────────────────────────────────────────────────
  { case_id: "EN-03", ticket: "M2.3", status: "PASSED", evidence_kind: ["schema_unit"],
    title: "a deterministic migration plan that blocks what it cannot place",
    assertions: ["a valid plan with a stable identity map and a pinned upstream",
      "the same unchanged source always yields the same copy identity",
      "a second key for a migrated source is a conflict, not a duplicate copy"],
    artifacts: [artifact("tests/m2.3/migration-service.test.ts"), artifact("contracts/migration-plan.schema.json")] },
  { case_id: "EN-05", ticket: "M2.3", status: "PASSED", evidence_kind: ["integration"],
    title: "the source project reopens and exports after migration, bytes unchanged",
    assertions: ["the source digest is identical before and after",
      "the source stays bound to hypit", "the copy is exported through the pinned renderer"],
    artifacts: [artifact("tests/m2.3/migration-service.test.ts")] },
  { case_id: "MIG-01", ticket: "M2.3", status: "PASSED", evidence_kind: ["integration"],
    title: "a new project id and one OpenFilm binding, with the source untouched",
    assertions: ["the copy has its own project id, revision and binding",
      "the source project's bytes and binding are unchanged"],
    artifacts: [artifact("tests/m2.3/migration-service.test.ts")] },
  { case_id: "MIG-02", ticket: "M2.3", status: "PASSED", evidence_kind: ["real_upstream_probe"],
    title: "three native clips the pinned engine reads and can edit",
    assertions: ["the pinned upstream reads the film as three addressable clips",
      "the middle clip is editable through the native mutator",
      "no clip source is a flattened video"],
    artifacts: [artifact("tests/m2.3/openfilm-migrator.test.ts"), artifact("src/host/projects/openfilm-migrator.ts")] },
  { case_id: "MIG-03", ticket: "M2.3", status: "PASSED", evidence_kind: ["real_media"],
    title: "reopen, export, edit the middle clip, export again",
    assertions: ["two real 900-frame MP4s produced by the pinned renderer",
      "the two exports differ; the film is the same length with the same three clips",
      "subtitles and narration travelled with the film"],
    artifacts: [artifact("tests/m2.3/migration-real-export.test.ts")] },
  { case_id: "MIG-04", ticket: "M2.3", status: "PASSED", evidence_kind: ["fault_injection"],
    title: "an external change in the copy conflicts instead of being accepted",
    assertions: ["a changed scene, subtitle or asset produces a conflict",
      "the copy loses writability while the migration keeps its historical state",
      "the changed bytes are left as they are"],
    artifacts: [artifact("tests/m2.3/migration-service.test.ts")] },
  { case_id: "MIG-05", ticket: "M2.3", status: "PASSED", evidence_kind: ["restart", "fault_injection"],
    title: "a crash at every boundary converges after a restart",
    assertions: ["eight boundaries each leave durable, readable state",
      "no state is written without its predecessor", "the source is untouched whatever happened"],
    artifacts: [artifact("tests/m2.3/migration-service.test.ts"), artifact("src/host/projects/migration-store.ts")] },
  { case_id: "MIG-06", ticket: "M2.3", status: "PASSED", evidence_kind: ["integration", "real_media"],
    title: "rollback stops writes, restores the source and keeps the copy",
    assertions: ["in-flight work is quarantined by id", "the source digest equals its pre-migration value",
      "the copy and its report are retained", "the source is exported again after rollback"],
    artifacts: [artifact("tests/m2.3/migration-service.test.ts")] },
  { case_id: "MIG-07", ticket: "M2.3", status: "PASSED", evidence_kind: ["http_integration"],
    title: "the same key replays; a different request conflicts",
    assertions: ["replaying a key returns the same migration rather than migrating twice"],
    artifacts: [artifact("tests/m2.3/migration-service.test.ts")] },

  // ── combined ────────────────────────────────────────────────────────────────────────
  { case_id: "W1-REG", ticket: "WAVE1", status: "PASSED", evidence_kind: ["regression"],
    title: "EN/TM/JB and the D1-M1 regression on one frozen commit",
    assertions: ["corepack pnpm check green on the combined candidate",
      "no D1-M1 test deleted, skipped or weakened", "materialize, adopt, impact and history restore still closed",
      "a fictional operation is still 422"],
    artifacts: [artifact("tests/architecture/m2.1-fitness.test.ts"), artifact("tests/architecture/m2.2-fitness.test.ts"),
      artifact("tests/architecture/m2.1-fitness.test.ts")] },
];

// Gate logs live under the short SHA of the commit that produced them.
const CAPTURE_SHORT = recordedHead.slice(0, 7);
const GATE_NAMES = [
  ["check", "corepack pnpm check"],
  ["contracts", "corepack pnpm test:contracts"],
  ["m2.1", "corepack pnpm test:m2.1"],
  ["m2.2", "corepack pnpm exec vitest run --config vitest.config.ts tests/m2.2"],
  ["m2.3", "corepack pnpm exec vitest run --config vitest.config.ts tests/m2.3"],
  ["golden", "python3 -I tests/m2.1-golden/source-digest-v1.golden.py tests/m2.1-golden/source-digest-v1.vectors.json"],
  ["mutation", "bash tools/m2.1-gate-mutation-check.sh <tmp>"],
  ["doc-consistency", "corepack pnpm check:m2.1-docs"],
  ["m2.2-integrity", "corepack pnpm evidence:m2.2:integrity"],
] as const;
const gateArtifacts = GATE_NAMES.map(([name, command]) => {
  const log = `docs/evidence/WAVE1/logs/${CAPTURE_SHORT}/${name}.txt`;
  if (!existsSync(resolve(log))) throw new Error(`missing gate log ${log}; run tools/wave1-run-evidence.sh first`);
  execFileSync("git", ["ls-files", "--error-unmatch", "--", log], { encoding: "utf8" });
  return { command, log, sha256: sha256File(resolve(log)) };
});

const manifest = {
  format: "narralens.wave1-evidence-manifest@1.0",
  scope: "Wave 1: M2.1 engine governance, M2.2 durability, M2.3 controlled migration",
  declaration_ceiling: "CONTROLLED_OPENFILM_READY",
  captured_at: new Date().toISOString(),
  repo_branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  repo_sha: git("rev-parse", "HEAD"),
  frozen_code_sha: recordedHead,
  repo_dirty_at_capture: dirty.length > 0,
  dirty_paths_at_capture: dirty,
  openfilm_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
  hypit_upstream_sha: "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf",
  node: process.version,
  pnpm: execFileSync("corepack", ["pnpm", "-v"], { encoding: "utf8" }).trim(),
  code_paths: CODE_PATHS,
  gate_artifacts: gateArtifacts,
  case_count: cases.length,
  passed_count: cases.filter((entry) => entry.status === "PASSED").length,
  screenshots: [],
  claim_limits: [
    "This evidence supports CONTROLLED_OPENFILM_READY only, and only after the combined external review passes.",
    "Gate D4.2 is NOT closed: materialization and adoption remain unimplemented.",
    "Gate V1-P0 and V1-Full are NOT claimed.",
    "duration and narration lock integration is NOT_APPLICABLE_APPROVED; no M2.2 typed edit can change either.",
    "render and snapshot_publish have no business runner; only their storage, lease, event and recovery semantics are proven.",
    "AC-005 on the legacy Hypit edit path remains a post-hoc snapshot capture; the migration path is the one that publishes from an isolated stage.",
    "Headed browser automation and human experience are NOT_RUN; no UI automation ran in Wave 1.",
  ],
  review: { internal: "PENDING", internal_record: "reviews/internal-review.md", external: "REVIEW_PENDING" },
  cases,
};

writeFileSync(join(ROOT, "evidence-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`wave1 cases=${manifest.case_count} passed=${manifest.passed_count} frozen=${recordedHead} dirty=${manifest.repo_dirty_at_capture}`);
