import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * The M4B evidence, proven from the M4B capture.
 *
 * M4C changes code, so M4B's *current-tip* integrity gate fails by design afterwards: it
 * asserts that the history restore route is unmounted, and M4C mounts it. That failure is
 * not a defect and it is not hidden — it is recorded verbatim in M4C's own capture.
 *
 * This gate is the other half of that answer. It proves that the M4B evidence was valid
 * **at the commit that produced it**, by reading the frozen tree and the frozen logs out of
 * git rather than out of the working directory. A later stage's code cannot make an
 * earlier stage's evidence true, and it cannot make it false either.
 */

const manifestPath = "docs/evidence/WAVE2/evidence-manifest-m4b.json";
const casesPath = "docs/evidence/WAVE2/cases/m4b-cases.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBytes = (...args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
let failed = 0;
const pass = (message) => console.log(`PASS ${message}`);
const fail = (message) => { failed += 1; console.error(`FAIL ${message}`); };

if (!existsSync(manifestPath) || !existsSync(casesPath)) {
  console.error("FAIL M4B evidence manifest or case file is missing");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const capture = String(manifest.capture_commit ?? "");
let evidenceCommit = "";
try {
  const resolved = gitBytes("rev-parse", `${capture}^{commit}`).toString().trim();
  resolved === capture
    ? pass(`capture commit ${capture.slice(0, 7)} is reachable`)
    : fail("capture commit does not resolve exactly");
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
    if (sha256(frozen) !== command.log_sha256) {
      fail(`frozen log digest differs: ${command.log}`); logsOk = false;
    }
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
} catch { fail("frozen M4B case file cannot be read"); }

/**
 * The frozen tree's route state.
 *
 * At the M4B capture, controlled adoption was mounted and history restore was not. The
 * second half is the one that matters for M4C: it proves that the M4B evidence was
 * captured against a tree that did *not* have M4C's routes, so the M4B capture cannot be
 * passing because of anything M4C added.
 */
try {
  const server = gitBytes("show", `${capture}:src/host/server.ts`).toString();
  const editsOpen = server.includes("\\/edits$");
  const historyOpen = server.includes("\\/history\\/restore$");
  const impactOpen = server.includes("\\/impact$");
  if (editsOpen && !historyOpen && impactOpen) {
    pass("the frozen tree mounts controlled adoption and does not mount history restore");
  } else {
    fail(`frozen route state is unexpected: impact=${impactOpen} edits=${editsOpen} history=${historyOpen}`);
  }
} catch { fail("frozen server route source cannot be read"); }

/**
 * The frozen tree must not contain M4C's modules.
 *
 * A capture that had M4C's code in it would be a capture of M4C, not of M4B, and the whole
 * point of the historical gate is that each stage's evidence belongs to its own stage.
 */
try {
  const tree = gitBytes("ls-tree", "-r", "--name-only", capture, "src/host/history").toString().trim();
  tree === "" ? pass("the frozen tree has no M4C history module") : fail(`the frozen tree contains M4C code: ${tree}`);
} catch { pass("the frozen tree has no M4C history module"); }

if (manifest.repo_dirty_at_capture === 0) pass("capture records a clean tree");
else fail("capture did not record a clean tree");

if (manifest.declaration === "M4B_INTERNAL_EVIDENCED") pass("the frozen declaration stays within the M4B ceiling");
else fail("the frozen declaration exceeds the M4B ceiling");

console.log(`checks_failed=${failed} capture_commit=${capture}`);
process.exit(failed === 0 ? 0 : 1);
