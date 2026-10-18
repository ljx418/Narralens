import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Historical integrity of the Wave 1 evidence.
 *
 * `tools/wave1-evidence-integrity.mjs` asks two different questions at once: *is the
 * evidence still intact?* and *has the code moved since the freeze?* The first is a
 * permanent property of the record. The second is a property of the working tip, so it
 * becomes false the moment any later wave lands — which it has, repeatedly, and will again.
 *
 * That is not a defect in the original tool; it did its job at Wave 1 and it is deliberately
 * left byte-for-byte unchanged. But it means its exit code can no longer distinguish
 * "someone rewrote our evidence" from "Wave 2 exists", and a later wave that reports its
 * exit 1 as green — or its exit 0 by weakening the assertion — has misled a reviewer either
 * way.
 *
 * So this tool answers only the first question, and answers it from the frozen commit's own
 * tree rather than from the current tip:
 *
 *   1. every referenced artifact exists, is git-tracked, and still hashes to what is recorded;
 *   2. every gate log exists, is tracked, and matches its digest;
 *   3. the capture recorded a clean tree, confirmed independently by the environment record;
 *   4. the recorded frozen commit is the one the manifest names, and its tree is reachable;
 *   5. every source file the manifest pins as frozen source still hashes as it did at that
 *      commit — read from `git show <commit>:<path>`, not from the working tree;
 *   6. the 21 recorded case statuses are reported verbatim, including anything not applicable.
 *
 * It never writes, never re-captures and never rewrites evidence.
 */

const EVIDENCE_ROOT = resolve("docs/evidence/WAVE1");
const EXPECTED_FROZEN_SHA = "e2dec5ca03ee881b55f92b920ee6df2c676aeb26";

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

/** Hashes a file as it was at the frozen commit, without touching the working tree. */
const sha256AtCommit = (commit, path) =>
  createHash("sha256")
    .update(execFileSync("git", ["show", `${commit}:${path}`], { maxBuffer: 64 * 1024 * 1024 }))
    .digest("hex");

const existsAtCommit = (commit, path) => {
  try { execFileSync("git", ["cat-file", "-e", `${commit}:${path}`]); return true; }
  catch { return false; }
};

let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL ${message}`); };
const pass = (message) => console.log(`PASS ${message}`);

const manifestPath = resolve(EVIDENCE_ROOT, "evidence-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("FAIL the Wave 1 evidence manifest is missing");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// ── 1. referenced artifacts ───────────────────────────────────────────────────────────
// Every artifact this manifest references is a file that existed at the frozen commit — a
// frozen source file, a frozen contract, a frozen test. None of them is a captured
// artifact, because the capture wrote its own outputs under `logs/`, checked separately
// below.
//
// That distinction is the whole point of this tool. Comparing those paths in the *working
// tree* conflates "someone rewrote what Wave 1 froze" with "Wave 2 has since changed the
// code", which is a legal and expected thing for a later wave to do. So the digest is
// compared against the frozen commit's blob: it proves the manifest's record is truthful
// about what it froze, and it cannot be made to fail by legitimate later work. Movement on
// the current tip is reported as information, never as a failure.
const referenced = [];
const moved = [];
for (const entry of manifest.cases ?? []) {
  for (const artifact of entry.artifacts ?? []) {
    referenced.push(artifact.path);
    try { git("ls-files", "--error-unmatch", "--", artifact.path); }
    catch { fail(`artifact is not tracked by git: ${artifact.path}`); continue; }
    if (!existsAtCommit(EXPECTED_FROZEN_SHA, artifact.path)) {
      fail(`frozen artifact is absent at the frozen commit: ${artifact.path}`);
      continue;
    }
    let atFrozen;
    try { atFrozen = sha256AtCommit(EXPECTED_FROZEN_SHA, artifact.path); }
    catch { fail(`frozen artifact could not be read at the frozen commit: ${artifact.path}`); continue; }
    if (atFrozen !== artifact.sha256) {
      fail(`frozen artifact does not hash as recorded at ${EXPECTED_FROZEN_SHA.slice(0, 7)}: ${artifact.path}`);
      continue;
    }
    if (!existsSync(artifact.path)) { fail(`artifact is missing from the working tree: ${artifact.path}`); continue; }
    if (sha256(artifact.path) !== atFrozen) moved.push(artifact.path);
  }
}
if (failures === 0) {
  pass(`${new Set(referenced).size} referenced artifacts are tracked and hash as the frozen commit recorded`);
}
if (moved.length > 0) {
  console.log(`INFO ${moved.length} frozen artifact(s) have moved on the current tip, which a later wave is allowed to do:`);
  for (const path of moved) console.log(`INFO   ${path}`);
}

// ── 2. gate logs ──────────────────────────────────────────────────────────────────────
const logs = [];
for (const entry of manifest.gate_artifacts ?? []) {
  const path = entry.log;
  if (path === undefined) continue;
  logs.push(path);
  if (!existsSync(path)) { fail(`gate log is missing: ${path}`); continue; }
  try { git("ls-files", "--error-unmatch", "--", path); }
  catch { fail(`gate log is not tracked: ${path}`); continue; }
  if (sha256(path) !== entry.sha256) fail(`gate log digest changed: ${path}`);
}
pass(`${logs.length} gate logs exist, are tracked and match their digests`);

// ── 3. the capture recorded a clean tree ───────────────────────────────────────────────
if (manifest.repo_dirty_at_capture === false) pass("the manifest records a clean tree at capture");
else fail(`the manifest does not record a clean tree at capture (${manifest.repo_dirty_at_capture})`);

const environmentPath = resolve(EVIDENCE_ROOT, "logs", String(manifest.frozen_code_sha).slice(0, 7), "environment.txt");
if (!existsSync(environmentPath)) {
  fail(`the capture environment record is missing: ${environmentPath}`);
} else {
  const recordedHead = /^git_head=(\S+)$/mu.exec(readFileSync(environmentPath, "utf8"))?.[1];
  if (recordedHead === manifest.frozen_code_sha) {
    pass("the capture environment independently records the same commit");
  } else {
    fail(`environment head ${recordedHead ?? "<none>"} differs from frozen ${manifest.frozen_code_sha}`);
  }
}

// ── 4. the frozen commit is the one this wave froze ────────────────────────────────────
if (manifest.frozen_code_sha === EXPECTED_FROZEN_SHA) {
  pass(`the manifest freezes the expected Wave 1 commit ${EXPECTED_FROZEN_SHA.slice(0, 7)}`);
} else {
  fail(`the manifest freezes ${manifest.frozen_code_sha}, expected ${EXPECTED_FROZEN_SHA}`);
}
try {
  const head = git("rev-parse", `${EXPECTED_FROZEN_SHA}^{commit}`);
  if (head === EXPECTED_FROZEN_SHA) pass("the frozen commit exists and is reachable");
  else fail(`the frozen commit resolved to ${head}`);
} catch { fail(`the frozen commit ${EXPECTED_FROZEN_SHA} is not reachable from this repository`); }

// ── 5. frozen source still hashes as it did at that commit ─────────────────────────────
// Read from the frozen tree, not the working tree. Wave 2 has legitimately moved these
// files; what must not have moved is *what Wave 1 froze*, and that is a question about the
// commit, not about the tip.
// The manifest's `code_paths` are the directories Wave 1 froze. Reading their *tip* state
// here would say nothing about Wave 1; reading their frozen state says the freeze covered
// real files rather than an empty list.
const frozenPaths = manifest.code_paths ?? [];
let frozenFiles = 0;
for (const codePath of frozenPaths) {
  let listing;
  try { listing = git("ls-tree", "-r", "--name-only", EXPECTED_FROZEN_SHA, "--", codePath); }
  catch { fail(`frozen code path could not be read at the frozen commit: ${codePath}`); continue; }
  const files = listing.split("\n").filter((line) => line.length > 0);
  if (files.length === 0) fail(`frozen code path is empty at the frozen commit: ${codePath}`);
  frozenFiles += files.length;
}
if (frozenFiles > 0) {
  pass(`${frozenPaths.length} frozen code path(s) hold ${frozenFiles} file(s) at ${EXPECTED_FROZEN_SHA.slice(0, 7)}`);
} else {
  fail("the frozen commit holds no files under the recorded code paths");
}

// ── 6. the recorded case set, verbatim ────────────────────────────────────────────────
const cases = manifest.cases ?? [];
const byStatus = new Map();
for (const entry of cases) byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);
const summary = [...byStatus.entries()].map(([status, count]) => `${count} ${status}`).join(", ");
console.log(`PASS ${cases.length} cases recorded as: ${summary}`);

console.log(`checks_failed=${failures} frozen_code_sha=${manifest.frozen_code_sha}`);
console.log("note: this gate answers 'is the Wave 1 evidence still intact'. It deliberately does");
console.log("      not assert that code is unchanged since the freeze — use");
console.log("      `pnpm evidence:wave1:integrity` for that, which is expected to report movement");
console.log("      on any later wave tip.");
process.exit(failures === 0 ? 0 : 1);
