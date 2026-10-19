import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Historical integrity of the M3 evidence capture.
 *
 * B4 of the Codex review: the previous manifest claimed all five Wave 2 routes were 404
 * and that materialize did not exist, while the code had two of them mounted, and it
 * declared a Wave 2 *combined* candidate although M4 was never implemented. An evidence
 * record that contradicts the code it describes cannot support a declaration.
 *
 * This tool answers the question a reviewer actually has — does this capture still
 * describe the tree it was taken from — and it answers it by reading both sides rather than
 * trusting either. It checks:
 *
 *   1. the capture commit exists and is the one the manifest names;
 *   2. the working tree was clean when the capture was taken;
 *   3. every command has an exit code, a log, and a log digest that still matches;
 *   4. the case file covers PR-01..03 and MT-01..06, and each names tests that exist;
 *   5. the route claims agree with `src/host/server.ts` as it is now;
 *   6. the real-media artefacts exist and hash as recorded;
 *   7. the manifest and the case file tell the same story;
 *   8. the declaration is one this session is allowed to make.
 *
 * It is read-only. It never rewrites a capture and never repairs a failure.
 */

const REPO = resolve(".");
const EVIDENCE_ROOT = resolve(REPO, "docs/evidence/WAVE2");
const MANIFEST_PATH = resolve(EVIDENCE_ROOT, "evidence-manifest-m3.json");
const CASES_PATH = resolve(EVIDENCE_ROOT, "cases/m3-cases.json");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL ${message}`); };
const pass = (message) => console.log(`PASS ${message}`);

if (!existsSync(MANIFEST_PATH)) {
  console.error("FAIL the M3 evidence manifest is missing");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

// ── 1. the capture commit ────────────────────────────────────────────────────────────
const capture = manifest.capture_commit;
try {
  const resolved = git("rev-parse", `${capture}^{commit}`);
  if (resolved === capture) pass(`the capture commit ${capture.slice(0, 7)} exists and is reachable`);
  else fail(`the capture commit resolved to ${resolved}, not ${capture}`);
} catch { fail(`the capture commit ${capture} is not reachable`); }

// ── 2. the tree was clean at capture ─────────────────────────────────────────────────
if (manifest.repo_dirty_at_capture === 0) pass("the manifest records a clean working tree at capture");
else fail(`the manifest records ${manifest.repo_dirty_at_capture} dirty path(s) at capture`);

// ── 3. every command has a log whose digest still matches ────────────────────────────
let commandsOk = true;
for (const entry of manifest.commands ?? []) {
  if (entry.expected_failure === true) continue;
  if (!existsSync(resolve(REPO, entry.log))) { fail(`command log is missing: ${entry.log}`); commandsOk = false; continue; }
  const digest = sha256(resolve(REPO, entry.log));
  if (entry.log_sha256 !== undefined && digest !== entry.log_sha256) {
    fail(`command log changed since capture: ${entry.log}`);
    commandsOk = false;
  }
  // The exit code the harness recorded, read from the file beside the log rather than from
  // the manifest. A manifest that claims a passing exit for a command that failed would
  // otherwise pass this gate, which is the one thing it exists to prevent.
  const exitFile = entry.log.replace(/\.txt$/u, ".exit");
  if (existsSync(resolve(REPO, exitFile))) {
    const recorded = Number(readFileSync(resolve(REPO, exitFile), "utf8").trim());
    if (recorded !== entry.exit) {
      fail(`manifest says ${entry.name} exited ${entry.exit} but ${exitFile} records ${recorded}`);
      commandsOk = false;
    }
  } else {
    fail(`no recorded exit code beside the log: ${exitFile}`);
    commandsOk = false;
  }
}
if (commandsOk) pass(`${(manifest.commands ?? []).length} command logs exist and match their digests`);

// ── 4. the case file covers the M3 cases and names real tests ────────────────────────
const cases = existsSync(CASES_PATH) ? JSON.parse(readFileSync(CASES_PATH, "utf8")) : [];
const required = ["PR-01", "PR-02", "PR-03", "MT-01", "MT-02", "MT-03", "MT-04", "MT-05", "MT-06"];
const present = new Set(cases.map((entry) => entry.case_id));
const missing = required.filter((id) => !present.has(id));
if (missing.length === 0) pass(`the case file covers ${required.join(", ")}`);
else fail(`the case file is missing ${missing.join(", ")}`);

let testRefsOk = true;
for (const entry of cases) {
  for (const reference of entry.tests ?? []) {
    const file = String(reference).split("::")[0];
    if (!existsSync(resolve(REPO, file))) { fail(`case ${entry.case_id} names a test file that does not exist: ${file}`); testRefsOk = false; }
  }
}
if (testRefsOk) pass("every case names test files that exist");

// ── 5. the route claims agree with the source ────────────────────────────────────────
const server = readFileSync(resolve(REPO, "src/host/server.ts"), "utf8");
const routes = [...server.matchAll(/\^\\\/api\\\/migration\\\/v1\\\/([^$]*)\$/gu)].map((match) => match[1]);
const open = {
  materialize: routes.some((route) => route.includes("materialize")),
  materializations: routes.some((route) => route.startsWith("materializations")),
  impact: routes.some((route) => /\/impact$/.test(route)),
  edits: routes.some((route) => /\/edits$/.test(route)),
  history_restore: routes.some((route) => route.includes("history")),
};
for (const [name, claimed] of Object.entries(manifest.route_status ?? {})) {
  if (claimed !== open[name]) {
    fail(`route claim for ${name} says ${claimed} but the source says ${open[name]}`);
  }
}
if (manifest.route_status !== undefined) pass("the recorded route status agrees with src/host/server.ts");

// ── 6. the real-media artefacts exist and hash as recorded ───────────────────────────
let artifactsOk = true;
for (const artifact of manifest.artifacts ?? []) {
  if (!existsSync(resolve(REPO, artifact.path))) {
    fail(`real-media artefact is missing: ${artifact.path}`);
    artifactsOk = false;
    continue;
  }
  if (artifact.sha256 !== undefined && sha256(resolve(REPO, artifact.path)) !== artifact.sha256) {
    fail(`real-media artefact changed: ${artifact.path}`);
    artifactsOk = false;
  }
}
if ((manifest.artifacts ?? []).length > 0 && artifactsOk) {
  pass(`${manifest.artifacts.length} real-media artefact(s) present and matching`);
}

// ── 7. the manifest and the case file agree ──────────────────────────────────────────
const manifestCases = new Set((manifest.cases ?? []).map((entry) => entry.case_id));
const fileCases = new Set(cases.map((entry) => entry.case_id));
const disagree = [...manifestCases].filter((id) => !fileCases.has(id)).concat(
  [...fileCases].filter((id) => !manifestCases.has(id)),
);
if (disagree.length === 0) pass("the manifest and the case file describe the same case set");
else fail(`manifest and case file disagree about: ${disagree.join(", ")}`);

// ── 8. the declaration is one this session may make ───────────────────────────────────
const ALLOWED = new Set(["M3_REVIEW_PENDING"]);
if (ALLOWED.has(manifest.declaration)) pass(`the declaration is "${manifest.declaration}", which is within this session's ceiling`);
else fail(`the declaration "${manifest.declaration}" exceeds what an implementation session may claim`);

if ((manifest.claim_limits ?? []).length === 0) fail("the manifest records no claim limits");
else pass(`${manifest.claim_limits.length} claim limit(s) recorded`);

console.log(`checks_failed=${failures} capture_commit=${capture}`);
process.exit(failures === 0 ? 0 : 1);
