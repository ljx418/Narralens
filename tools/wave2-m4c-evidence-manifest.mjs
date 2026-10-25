import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnosticFor, expectedFailureCommands, failedCaptures } from "./wave2-capture-outcome.mjs";

const capture = process.argv[2];
if (capture === undefined || !/^[a-f0-9]{40}$/u.test(capture)) {
  console.error("usage: wave2-m4c-evidence-manifest.mjs <capture-sha>");
  process.exit(2);
}
const root = resolve(".");
const logs = `docs/evidence/WAVE2/logs/${capture}`;
if (!existsSync(resolve(root, logs))) process.exit(1);
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const environment = Object.fromEntries(readFileSync(resolve(root, logs, "environment.txt"), "utf8")
  .split("\n").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
// The set of commands this capture expects to fail comes from the capture's own record,
// read through the shared rule — not from a second copy of the list. Two copies of the same
// rule are two truths, and the gate only checks one of them.
const expected = expectedFailureCommands(resolve(root, logs));
const commands = readdirSync(resolve(root, logs)).filter((name) => name.endsWith(".exit")).sort().map((name) => {
  const stem = name.slice(0, -5);
  const log = `${logs}/${stem}.txt`;
  const entry = { name: stem, command: readFileSync(resolve(root, logs, `${stem}.cmd`), "utf8").trim(),
    exit: Number(readFileSync(resolve(root, logs, name), "utf8").trim()), log,
    log_sha256: hash(resolve(root, log)) };
  return expected.has(stem) ? { ...entry, expected_failure: true } : entry;
});
const casesPath = resolve(root, "docs/evidence/WAVE2/cases/m4c-cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const manifest = {
  format: "narralens.wave2-evidence-manifest@1", stage: "M4C", module: "HistoryRestore",
  capture_commit: capture, capture_logs: logs, captured_at_utc: environment.date_utc,
  repo_dirty_at_capture: Number(environment.repo_dirty_at_capture), environment,
  origin_main: git("rev-parse", "origin/main"), branch: git("branch", "--show-current"), commands,
  cases: cases.map(({ case_id, status, production_seam }) => ({ case_id, status, production_seam })),
  // The manifest the capture checks is the one inside its own log directory; the committed
  // copy is regenerated from it afterwards and therefore lists more commands. This names the
  // file the gate actually read, so a reader does not think the committed file was the one
  // that was checked.
  checked_manifest: `docs/evidence/WAVE2/logs/${capture}/manifest.json`,
  route_status: { materialize: true, impact: true, edits: true, history: true, history_restore: true },
  declaration: "M4C_INTERNAL_EVIDENCED", review: { internal: "PASS", external: "REVIEW_PENDING" },
  claim_limits: [
    "M4C internal evidence does not close Wave 2, Gate D4.2, Gate V1-P0 or V1-Full.",
    "History restore, undo and redo are translated into an impact-bound restore intent; they never move the active pointer and never create a revision without an impact and an explicit approval.",
    "Headed and human experience are NOT_RUN; automation is headless, muted, windowless and loopback-only.",
    "The real media proof is a fixed 900-frame three-clip film rendered by the pinned upstream, not a long-film performance claim or a production render route.",
    "Wave 1, M4A and M4B current-tip integrity checks fail by design after later stages move code; their historical gates pass and their non-zero logs are preserved.",
    "M4B's current-tip integrity gate is recorded verbatim in this capture; its verdict is about M4B's own evidence and does not open M4C.",
    "M4C does not open a production render route and does not impersonate the full TX-12 acceptance.",
    "A restore is a content-addressed reuse: the result snapshot id equals the target's, so the old content is restored as a new revision rather than as a new identity.",
    "The restore plan supports the differences M4C models — the same clip identity and track topology, with the change inside src/time/overrides. A clip added, removed or moved to another track is refused.",
    "The undo and redo translations resolve a target from the project's committed history; there is no redo stack, because this architecture has exactly one timeline.",
  ],
};

/**
 * The captures that failed, and why.
 *
 * A manifest is the index a reader starts from, and an index that only names the successful
 * captures hides the fact that one failed. The failed directory is kept and marked; this
 * entry makes it findable from the index rather than only from a directory listing.
 */
manifest.known_failed_captures = failedCaptures(root).map((entry) => {
  const relative = `docs/evidence/WAVE2/logs/${entry.capture_commit}`;
  const diagnostic = diagnosticFor(entry.directory);
  return {
    capture_commit: entry.capture_commit,
    failed_commands: entry.failures.map((failure) => failure.exit === null
      ? (failure.name === "the capture never reached the end of its script"
        ? failure.name
        : `${failure.name} did not finish (no exit file)`)
      : `${failure.name} exit=${failure.exit}`),
    diagnostic: diagnostic === null ? null : relative + "/" + diagnostic.split("/").pop(),
    kept: true,
    note: "A failed capture, kept verbatim. It is not evidence of a passing run and is never counted as one.",
  };
});

const target = resolve(root, process.argv[3] ?? "docs/evidence/WAVE2/evidence-manifest-m4c.json");
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote M4C manifest: commands=${commands.length} cases=${cases.length}`);
