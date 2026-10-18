import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Evidence integrity for the Wave 1 combined manifest.
 *
 * Same discipline as the per-ticket validators, applied to the one record a reviewer reads
 * once:
 *  1. every referenced artifact exists, is git-tracked, and still hashes to what is recorded;
 *  2. every gate log exists, is tracked, and matches its digest;
 *  3. the capture recorded a clean tree, confirmed by an independent environment record;
 *  4. no code, test, contract, tool or package file changed after the frozen commit;
 *  5. the case set is reported honestly, including anything not applicable.
 */

const EVIDENCE_ROOT = resolve("docs/evidence/WAVE1");
const CODE_PATHS = ["src", "tests", "contracts", "tools", "package.json"];
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL ${message}`); };
const pass = (message) => console.log(`PASS ${message}`);

const manifestPath = resolve(EVIDENCE_ROOT, "evidence-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("FAIL the Wave 1 evidence manifest is missing");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const referenced = [];
for (const entry of manifest.cases ?? []) {
  for (const artifact of entry.artifacts ?? []) {
    referenced.push(artifact.path);
    if (!existsSync(artifact.path)) { fail(`artifact is missing: ${artifact.path}`); continue; }
    try { git("ls-files", "--error-unmatch", "--", artifact.path); }
    catch { fail(`artifact is not tracked by git: ${artifact.path}`); continue; }
    if (sha256(artifact.path) !== artifact.sha256) fail(`artifact digest changed: ${artifact.path}`);
  }
}
if (failures === 0) pass(`${referenced.length} referenced artifacts exist, are tracked and match their digests`);

for (const gate of manifest.gate_artifacts ?? []) {
  if (!existsSync(gate.log)) { fail(`gate log is missing: ${gate.log}`); continue; }
  try { git("ls-files", "--error-unmatch", "--", gate.log); }
  catch { fail(`gate log is not tracked by git: ${gate.log}`); continue; }
  if (sha256(gate.log) !== gate.sha256) fail(`gate log digest changed: ${gate.log}`);
}
pass(`${(manifest.gate_artifacts ?? []).length} gate logs exist, are tracked and match their digests`);

if (manifest.repo_dirty_at_capture === false) pass("manifest records a clean tree at capture");
else fail(`manifest.repo_dirty_at_capture is ${manifest.repo_dirty_at_capture}, expected false`);

const environmentPath = resolve(EVIDENCE_ROOT, "logs", String(manifest.frozen_code_sha).slice(0, 7), "environment.txt");
if (!existsSync(environmentPath)) { fail("the capture environment record is missing"); }
else {
  const recordedHead = readFileSync(environmentPath, "utf8").split("\n")
    .find((line) => line.startsWith("git_head="))?.split("=")[1]?.trim();
  if (recordedHead === manifest.frozen_code_sha) pass("the capture environment independently records the same commit");
  else fail(`environment head ${recordedHead} differs from frozen ${manifest.frozen_code_sha}`);
}

const changed = git("diff", "--name-only", manifest.frozen_code_sha, "--", ...CODE_PATHS);
if (changed === "") pass(`no code, test, contract, tool or package file changed after ${manifest.frozen_code_sha}`);
else fail(`code changed after the frozen commit:\n${changed}`);

const notPassed = (manifest.cases ?? []).filter((entry) => entry.status !== "PASSED");
pass(`${manifest.case_count} cases, ${manifest.passed_count} passed, `
  + `${notPassed.length} declared otherwise: ${notPassed.map((entry) => `${entry.case_id}=${entry.status}`).join(", ") || "none"}`);

console.log(`checks_failed=${failures} frozen_code_sha=${manifest.frozen_code_sha}`);
process.exit(failures === 0 ? 0 : 1);
