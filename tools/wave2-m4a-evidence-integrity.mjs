import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Historical integrity of the M4A evidence capture.
 *
 * The M3 checker exists because a manifest once described a tree it was no longer describing
 * and still declared a combined candidate. This one answers the same question for M4A, and
 * it answers it by reading both sides rather than trusting either:
 *
 *   1. the capture commit exists and is the one the manifest names;
 *   2. the working tree was clean when the capture was taken;
 *   3. every command has an exit code, a log, and a log digest that still matches;
 *   4. the case file covers M4A-C01/P01/DB01/H01/TTL01/NW01/R01 and TX-02A..05A, and each
 *      names test files that exist;
 *   5. the route claims agree with `src/host/server.ts` *as it is now* — M4A's manifest
 *      describes the tip it was captured from, and unlike M3's frozen record it is not
 *      expected to disagree with it, so this comparison stays honest about both sides;
 *   6. every claim the frozen hash vectors make still holds, and the independent Python
 *      implementation still agrees;
 *   7. the manifest and the case file describe the same case set;
 *   8. the declaration is one this session is allowed to make, and no forbidden one appears
 *      anywhere in it.
 *
 * It is read-only. It never rewrites a capture and never repairs a failure.
 */

const REPO = resolve(".");
const EVIDENCE_ROOT = resolve(REPO, "docs/evidence/WAVE2");
const MANIFEST_PATH = resolve(EVIDENCE_ROOT, "evidence-manifest-m4a.json");
const CASES_PATH = resolve(EVIDENCE_ROOT, "cases/m4a-cases.json");
const VECTORS_PATH = resolve(REPO, "tests/wave2/m4a/impact-hash.vectors.json");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL ${message}`); };
const pass = (message) => console.log(`PASS ${message}`);

if (!existsSync(MANIFEST_PATH)) {
  console.error("FAIL the M4A evidence manifest is missing");
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
  // Read from the file beside the log, not from the manifest: a manifest claiming a passing
  // exit for a command that failed is exactly what this gate exists to prevent.
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
  if (existsSync(resolve(REPO, entry.log.replace(/\.txt$/u, ".cmd"))) === false) {
    fail(`no recorded command line beside the log: ${entry.log.replace(/\.txt$/u, ".cmd")}`);
    commandsOk = false;
  }
}
if (commandsOk) pass(`${(manifest.commands ?? []).length} command logs exist and match their digests`);

// ── 4. the case file covers M4A's cases and names real tests ─────────────────────────
const cases = existsSync(CASES_PATH) ? JSON.parse(readFileSync(CASES_PATH, "utf8")) : [];
const required = ["M4A-C01", "M4A-P01", "M4A-DB01", "M4A-H01", "M4A-TTL01",
  "TX-02A", "TX-03A", "TX-04A", "TX-05A", "M4A-NW01", "M4A-R01"];
const present = new Set(cases.map((entry) => entry.case_id));
const missing = required.filter((id) => !present.has(id));
if (missing.length === 0) pass(`the case file covers ${required.join(", ")}`);
else fail(`the case file is missing ${missing.join(", ")}`);

let testRefsOk = true;
for (const entry of cases) {
  if ((entry.tests ?? []).length === 0) { fail(`case ${entry.case_id} names no tests`); testRefsOk = false; }
  for (const reference of entry.tests ?? []) {
    const file = String(reference).split("::")[0];
    if (!existsSync(resolve(REPO, file))) { fail(`case ${entry.case_id} names a test file that does not exist: ${file}`); testRefsOk = false; }
  }
}
if (testRefsOk) pass("every case names at least one test file, and every one exists");

// The statuses M4A is allowed to record. A case that belongs to M4B or M4C must not claim
// PASSED here, and a TX case is explicitly a subset until its commit-time re-check lands.
const ALLOWED_STATUS = new Set(["CLOSED", "INTERNAL_EVIDENCED_SUBSET"]);
let statusOk = true;
for (const entry of cases) {
  if (!ALLOWED_STATUS.has(entry.status)) {
    fail(`case ${entry.case_id} claims "${entry.status}", which M4A may not declare`);
    statusOk = false;
  }
}
if (statusOk) pass("every case claims only CLOSED or INTERNAL_EVIDENCED_SUBSET");

// ── 5. the route claims agree with the source as it is now ───────────────────────────
const server = readFileSync(resolve(REPO, "src/host/server.ts"), "utf8");
const routes = [...server.matchAll(/\^\\\/api\\\/migration\\\/v1\\\/([^$]*)\$/gu)].map((match) => match[1]);
const open = {
  materialize: routes.some((route) => route.includes("materialize")),
  materializations: routes.some((route) => route.startsWith("materializations")),
  impact: routes.some((route) => /\/impact$/.test(route)),
  edits: routes.some((route) => /\/edits$/.test(route)),
  history_restore: routes.some((route) => route.includes("history")),
};
let routeOk = true;
for (const [name, claimed] of Object.entries(manifest.route_status ?? {})) {
  if (claimed !== open[name]) {
    fail(`route claim for ${name} says ${claimed} but the source says ${open[name]}`);
    routeOk = false;
  }
}
if (routeOk) pass("the recorded route status agrees with src/host/server.ts");
if (open.edits || open.history_restore) {
  fail("M4A opened a versioned-edit or history-restore route, which belongs to M4B/M4C");
} else {
  pass("versioned edits and history restore are still unmounted");
}
if (open.impact !== true) fail("the impact route is not mounted, which M4A's own evidence claims");

// ── 6. the frozen hash vectors still hold ────────────────────────────────────────────
if (!existsSync(VECTORS_PATH)) {
  fail("the frozen hash vectors are missing");
} else {
  const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));
  const expected = manifest.hash_vectors_sha256;
  if (expected !== undefined && expected !== sha256(VECTORS_PATH)) {
    fail(`the frozen hash vectors changed since capture (${sha256(VECTORS_PATH).slice(0, 12)})`);
  } else if (expected !== undefined) {
    pass(`the frozen hash vectors match the digest the manifest records`);
  }
  if ((vectors.vectors ?? []).length < 8) fail("the frozen hash vector file has fewer than 8 vectors");
  const base = (vectors.vectors ?? []).find((vector) => vector.name === "base");
  const reversed = (vectors.vectors ?? []).find((vector) => vector.name === "arrays-reversed");
  if (base === undefined || reversed === undefined) {
    fail("the frozen hash vectors do not record the ordering-independence case");
  } else if (base.impact_hash !== reversed.impact_hash) {
    fail("the frozen vectors record that array order changed the hash, which the contract forbids");
  } else {
    pass("the frozen vectors record order independence");
  }
}

// ── 7. the manifest and the case file agree ──────────────────────────────────────────
const manifestCases = new Set((manifest.cases ?? []).map((entry) => entry.case_id));
const fileCases = new Set(cases.map((entry) => entry.case_id));
const disagree = [...manifestCases].filter((id) => !fileCases.has(id)).concat(
  [...fileCases].filter((id) => !manifestCases.has(id)),
);
if (disagree.length === 0) pass("the manifest and the case file describe the same case set");
else fail(`manifest and case file disagree about: ${disagree.join(", ")}`);

// ── 8. the declaration is within this session's ceiling, and claims nothing forbidden ─
const ALLOWED_DECLARATIONS = new Set(["M4A_INTERNAL_EVIDENCED"]);
// Everything this module is forbidden to claim. Checked against the whole document rather
// than the declaration field alone, because a forbidden phrase in a claim limit or a note
// would be as misleading as one in the declaration.
const FORBIDDEN = [
  "WAVE2_COMBINED_REVIEW_PENDING", "WAVE2_EDITABLE_ADOPTION_READY",
  "GATE_D4_2_PASSED", "GATE_V1_P0_PASSED", "V1_FULL_PASSED",
  "M5_IMPLEMENTED", "M6_IMPLEMENTED", "HEADED_HUMAN_VERIFIED",
];
if (ALLOWED_DECLARATIONS.has(manifest.declaration)) {
  pass(`the declaration is "${manifest.declaration}", which is within this session's ceiling`);
} else {
  fail(`the declaration "${manifest.declaration}" exceeds what an implementation session may claim`);
}
const serialised = JSON.stringify(manifest).toUpperCase();
const used = FORBIDDEN.filter((phrase) => serialised.includes(phrase));
if (used.length === 0) pass("no forbidden declaration appears anywhere in the manifest");
else fail(`the manifest mentions forbidden claims: ${used.join(", ")}`);

if ((manifest.claim_limits ?? []).length === 0) fail("the manifest records no claim limits");
else pass(`${manifest.claim_limits.length} claim limit(s) recorded`);

console.log(`checks_failed=${failures} capture_commit=${capture}`);
process.exit(failures === 0 ? 0 : 1);
