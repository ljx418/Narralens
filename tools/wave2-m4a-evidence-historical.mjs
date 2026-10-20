import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const manifestPath = "docs/evidence/WAVE2/evidence-manifest-m4a.json";
const casesPath = "docs/evidence/WAVE2/cases/m4a-cases.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBytes = (...args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
let failed = 0;
const pass = (message) => console.log(`PASS ${message}`);
const fail = (message) => { failed += 1; console.error(`FAIL ${message}`); };

if (!existsSync(manifestPath) || !existsSync(casesPath)) {
  console.error("FAIL M4A evidence manifest or case file is missing");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const capture = String(manifest.capture_commit ?? "");
let evidenceCommit = "";
try {
  const resolved = gitBytes("rev-parse", `${capture}^{commit}`).toString().trim();
  resolved === capture ? pass(`capture commit ${capture.slice(0, 7)} is reachable`) : fail("capture commit does not resolve exactly");
} catch { fail(`capture commit ${capture} is not reachable`); }
try {
  const representativeLog = String(manifest.commands?.[0]?.log ?? "");
  evidenceCommit = gitBytes("log", "-1", "--all", "--format=%H", "--", representativeLog)
    .toString().trim();
  if (evidenceCommit === "") throw new Error("missing evidence seal");
  pass(`evidence seal ${evidenceCommit.slice(0, 7)} is reachable`);
} catch { fail("the evidence seal commit cannot be resolved"); }

let logsOk = true;
for (const command of manifest.commands ?? []) {
  try {
    const frozen = gitBytes("show", `${evidenceCommit}:${command.log}`);
    if (sha256(frozen) !== command.log_sha256) { fail(`frozen log digest differs: ${command.log}`); logsOk = false; }
    const exitPath = String(command.log).replace(/\.txt$/u, ".exit");
    const exit = Number(gitBytes("show", `${evidenceCommit}:${exitPath}`).toString().trim());
    if (exit !== command.exit) { fail(`frozen exit differs: ${exitPath}`); logsOk = false; }
  } catch { fail(`frozen command evidence is missing: ${command.log}`); logsOk = false; }
}
if (logsOk) pass(`${manifest.commands.length} frozen command records match the manifest`);

try {
  const frozenCases = gitBytes("show", `${evidenceCommit}:${casesPath}`);
  const cases = JSON.parse(frozenCases.toString());
  const manifestIds = [...(manifest.cases ?? []).map((entry) => entry.case_id)].sort();
  const caseIds = [...cases.map((entry) => entry.case_id)].sort();
  JSON.stringify(manifestIds) === JSON.stringify(caseIds)
    ? pass(`${caseIds.length} frozen cases match the manifest`)
    : fail("frozen case set differs from the manifest");
} catch { fail("frozen M4A case file cannot be read"); }

try {
  const server = gitBytes("show", `${capture}:src/host/server.ts`).toString();
  const editsOpen = /projects\/\(\[A-Za-z0-9_-\]\+\)\\\/edits/.test(server);
  const historyOpen = /history\\\/restore/.test(server);
  const impactOpen = server.includes("/impact");
  if (!editsOpen && !historyOpen && impactOpen) pass("the frozen tree has only the M4A impact route open");
  else fail(`frozen route state is unexpected: impact=${impactOpen} edits=${editsOpen} history=${historyOpen}`);
} catch { fail("frozen server route source cannot be read"); }

if (manifest.repo_dirty_at_capture === 0) pass("capture records a clean tree");
else fail("capture did not record a clean tree");

console.log(`checks_failed=${failed} capture_commit=${capture}`);
process.exit(failed === 0 ? 0 : 1);
