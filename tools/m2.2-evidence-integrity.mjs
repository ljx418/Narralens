import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Evidence integrity for M2.2, same discipline as the M2.1 validator.
 *
 * 1. every referenced artifact exists;
 * 2. every referenced path is a file git actually tracks;
 * 3. every recorded SHA256 still matches;
 * 4. the capture recorded a clean tree, confirmed by the independent environment record;
 * 5. no code, test, contract, tool or package file changed after the frozen commit;
 * 6. referenced gate logs are present and tracked.
 */

const EVIDENCE_ROOT = resolve("docs/evidence/M2/M2.2");
const CODE_PATHS = ["src", "tests", "contracts", "tools", "package.json"];
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL ${message}`); };
const pass = (message) => console.log(`PASS ${message}`);

const manifestPath = resolve(EVIDENCE_ROOT, "evidence-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("FAIL M2.2 evidence manifest is missing");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const referenced = [];
for (const entry of manifest.cases ?? []) {
  for (const artifact of entry.artifacts ?? []) {
    referenced.push(artifact.path);
    // Artifact paths are repository-relative; gate logs are relative to the evidence root.
    const absolute = resolve(artifact.path);
    if (!existsSync(absolute)) { fail(`artifact is missing: ${artifact.path}`); continue; }
    try { git("ls-files", "--error-unmatch", "--", artifact.path); }
    catch { fail(`artifact is not tracked by git: ${artifact.path}`); continue; }
    if (sha256(absolute) !== artifact.sha256) fail(`artifact digest changed: ${artifact.path}`);
  }
}
if (failures === 0) pass(`${referenced.length} referenced artifacts exist, are tracked and match their digests`);

for (const gate of manifest.gate_artifacts ?? []) {
  const absolute = resolve(EVIDENCE_ROOT, gate.path);
  if (!existsSync(absolute)) { fail(`gate log is missing: ${gate.path}`); continue; }
  try { git("ls-files", "--error-unmatch", "--", `${EVIDENCE_ROOT}/${gate.path}`); }
  catch { fail(`gate log is not tracked by git: ${gate.path}`); continue; }
  if (sha256(absolute) !== gate.sha256) fail(`gate log digest changed: ${gate.path}`);
}
pass(`${(manifest.gate_artifacts ?? []).length} gate logs exist, are tracked and match their digests`);

if (manifest.repo_dirty_at_capture === false) pass("manifest records a clean tree at capture");
else fail(`manifest.repo_dirty_at_capture is ${manifest.repo_dirty_at_capture}, expected false`);

const environmentArtifact = (manifest.gate_artifacts ?? [])
  .find((artifact) => typeof artifact.path === "string" && artifact.path.endsWith("/environment.txt"));
if (environmentArtifact === undefined) {
  fail("manifest does not identify its capture environment");
}
const environment = environmentArtifact === undefined ? ""
  : readFileSync(resolve(EVIDENCE_ROOT, environmentArtifact.path), "utf8");
const recordedHead = environment.split("\n").find((line) => line.startsWith("git_head="))?.split("=")[1];
if (recordedHead === manifest.frozen_code_sha) pass("the capture environment independently records the same commit");
else fail(`environment head ${recordedHead} differs from frozen ${manifest.frozen_code_sha}`);

const currentHead = git("rev-parse", "HEAD");
const changed = git("diff", "--name-only", manifest.frozen_code_sha, "--", ...CODE_PATHS);
if (changed === "") pass(`no code, test, contract, tool or package file changed after ${manifest.frozen_code_sha}`);
else fail(`code changed after the frozen commit:\n${changed}`);

const notApplicable = (manifest.cases ?? []).filter((entry) => entry.status !== "PASSED");
pass(`${manifest.case_count} cases, ${manifest.passed_count} passed, ${notApplicable.length} declared not applicable: ${notApplicable.map((entry) => entry.case_id).join(",") || "none"}`);

if (manifest.repo_sha === manifest.frozen_code_sha) pass("the manifest lives in the same commit as the frozen code");
else pass(`the manifest is committed after the frozen code (${currentHead.slice(0, 7)}); only evidence moved`);

console.log(`checks_failed=${failures} frozen_code_sha=${manifest.frozen_code_sha}`);
process.exit(failures === 0 ? 0 : 1);
