import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Evidence integrity check (M-02).
 *
 * The external review found that the manifest recorded SHA256 digests of `*.log` files that
 * the repository's .gitignore excludes, so nothing it pointed at could be obtained or
 * verified from a clone. This validator makes that class of mistake impossible to repeat:
 *
 *  1. every path the manifest references exists;
 *  2. every path is a file git actually tracks;
 *  3. every recorded SHA256 still matches the file on disk;
 *  4. the capture recorded a clean tree;
 *  5. no code, test, contract, tool or package file changed after the captured commit.
 *
 * Usage: node tools/m2.1-evidence-integrity.mjs
 */

const EVIDENCE_ROOT = "docs/evidence/M2/M2.1";
const CODE_PATHS = ["src", "tests", "contracts", "tools", "package.json"];
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const problems = [];
const fail = (message) => { problems.push(message); console.error(`FAIL ${message}`); };
const pass = (message) => console.log(`PASS ${message}`);

const manifestPath = resolve(`${EVIDENCE_ROOT}/evidence-manifest.json`);
if (!existsSync(manifestPath)) {
  console.error(`FAIL evidence manifest is missing: ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// 1 + 2 + 3 — every referenced artifact exists, is tracked, and matches its digest.
const referenced = new Set();
for (const entry of manifest.cases ?? []) {
  for (const artifact of entry.artifacts ?? []) {
    referenced.add(artifact.path);
    const absolute = resolve(EVIDENCE_ROOT, artifact.path);
    if (!existsSync(absolute)) { fail(`artifact is missing: ${artifact.path}`); continue; }
    try { git("ls-files", "--error-unmatch", "--", `${EVIDENCE_ROOT}/${artifact.path}`); }
    catch { fail(`artifact is not tracked by git: ${artifact.path}`); continue; }
    const actual = sha256(absolute);
    if (actual !== artifact.sha256) {
      fail(`artifact digest changed: ${artifact.path} manifest=${artifact.sha256} actual=${actual}`);
    }
  }
  for (const command of entry.commands ?? []) {
    referenced.add(command.stdout_stderr);
    const absolute = resolve(EVIDENCE_ROOT, command.stdout_stderr);
    if (!existsSync(absolute)) { fail(`log is missing: ${command.stdout_stderr}`); continue; }
    try { git("ls-files", "--error-unmatch", "--", `${EVIDENCE_ROOT}/${command.stdout_stderr}`); }
    catch { fail(`log is not tracked by git: ${command.stdout_stderr}`); continue; }
    if (command.stdout_stderr_sha256 && sha256(absolute) !== command.stdout_stderr_sha256) {
      fail(`log digest changed: ${command.stdout_stderr}`);
    }
  }
}
if (problems.length === 0) pass(`${referenced.size} referenced evidence files exist, are tracked and match their digests`);

// 4 — the capture recorded a clean tree.
if (manifest.repo_dirty_at_capture === false) pass("manifest records a clean tree at capture");
else fail(`manifest.repo_dirty_at_capture is ${manifest.repo_dirty_at_capture}, expected false`);

// The claim must match the independently recorded environment, not just the manifest field.
const captureDir = manifest.frozen_code_sha.slice(0, 7);
const environment = readFileSync(resolve(EVIDENCE_ROOT, "logs", captureDir, "environment.txt"), "utf8");
const recordedLines = Number(environment.split("\n").find((line) => line.startsWith("git_status_porcelain_lines="))?.split("=")[1] ?? "-1");
if (recordedLines === 0) pass("the capture environment independently records a clean tree");
else fail(`the capture environment recorded ${recordedLines} dirty paths`);

// 5 — no code changed after the captured commit.
const frozen = manifest.frozen_code_sha ?? manifest.repo_sha;
try {
  const changed = git("diff", "--name-only", frozen, "--", ...CODE_PATHS);
  if (changed === "") pass(`no code, test, contract, tool or package file changed after ${frozen}`);
  else fail(`code changed after the frozen commit ${frozen}:\n${changed}`);
} catch (error) {
  fail(`cannot compare against the frozen commit ${frozen}: ${String(error.message ?? error)}`);
}

// The manifest must not point at anything the repository ignores.
for (const relativePath of referenced) {
  try {
    const ignored = execFileSync("git", ["check-ignore", "-q", "--", `${EVIDENCE_ROOT}/${relativePath}`]);
    void ignored;
    fail(`referenced evidence is git-ignored: ${relativePath}`);
  } catch { /* check-ignore exits 1 when the path is NOT ignored, which is what we want */ }
}

console.log(`checks_failed=${problems.length} frozen_code_sha=${frozen}`);
process.exit(problems.length === 0 ? 0 : 1);
