import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnosticFor, failedCaptures } from "./wave2-capture-outcome.mjs";

const capture = process.argv[2];
if (capture === undefined || !/^[a-f0-9]{40}$/u.test(capture)) {
  console.error("usage: wave2-m4b-evidence-manifest.mjs <capture-sha>");
  process.exit(2);
}
const root = resolve(".");
const logs = `docs/evidence/WAVE2/logs/${capture}`;
if (!existsSync(resolve(root, logs))) process.exit(1);
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const environment = Object.fromEntries(readFileSync(resolve(root, logs, "environment.txt"), "utf8")
  .split("\n").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
const expected = new Set(["wave1-integrity", "m4a-integrity"]);
const commands = readdirSync(resolve(root, logs)).filter((name) => name.endsWith(".exit")).sort().map((name) => {
  const stem = name.slice(0, -5);
  const log = `${logs}/${stem}.txt`;
  const entry = { name: stem, command: readFileSync(resolve(root, logs, `${stem}.cmd`), "utf8").trim(),
    exit: Number(readFileSync(resolve(root, logs, name), "utf8").trim()), log,
    log_sha256: hash(resolve(root, log)) };
  return expected.has(stem) ? { ...entry, expected_failure: true } : entry;
});
const casesPath = resolve(root, "docs/evidence/WAVE2/cases/m4b-cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const manifest = {
  format: "narralens.wave2-evidence-manifest@1", stage: "M4B", module: "ControlledAdoption",
  capture_commit: capture, capture_logs: logs, captured_at_utc: environment.date_utc,
  repo_dirty_at_capture: Number(environment.repo_dirty_at_capture), environment,
  origin_main: git("rev-parse", "origin/main"), branch: git("branch", "--show-current"), commands,
  cases: cases.map(({ case_id, status, production_seam }) => ({ case_id, status, production_seam })),
  // The manifest the capture checks is the one inside its own log directory; the committed
  // copy is regenerated from it afterwards and therefore lists more commands. This names the
  // file the gate actually read, so a reader does not think the committed file was the one
  // that was checked.
  checked_manifest: `docs/evidence/WAVE2/logs/${capture}/manifest.json`,
  route_status: { materialize: true, impact: true, edits: true, history_restore: false },
  declaration: "M4B_INTERNAL_EVIDENCED", review: { internal: "PASS", external: "REVIEW_PENDING" },
  claim_limits: [
    "M4B internal evidence does not close M4C, Wave 2, Gate D4.2, Gate V1-P0 or V1-Full.",
    "History restore, undo and redo remain capability-blocked and their HTTP route remains unmounted.",
    "Headed and human experience are NOT_RUN; automation is headless, muted, windowless and loopback-only.",
    "The real media proof is a fixed 900-frame three-clip film, not a long-film performance claim or a production render route.",
    "Wave 1 and M4A current-tip integrity checks fail by design after later stages move code; their historical gates pass and their non-zero logs are preserved.",
    "A film matching neither durable before nor after digest is terminal attention and needs explicit later repair tooling; M4B does not auto-clear it.",
    "A recoverable resource failure is published as a controlled failure with http_status 500, because the frozen failure union is 409|422|423|428|500 and has no 503, while HOST_RESOURCE_EXHAUSTED is aliased to 503 elsewhere. The record therefore says 500 and carries recoverable:true in its details. Changing it means amending a frozen contract, so it is recorded here as a known boundary instead."
  ]
};
// The output path is an argument so the capture can produce a manifest *inside* its own
// log directory and check it there, rather than the committed file — which cannot exist yet
// for a capture that has not been committed.
/**
 * The captures that failed, and why.
 *
 * A manifest is the index a reader starts from, and an index that only names the successful
 * captures hides the fact that one failed. The failed directory is kept and marked; this
 * entry makes it findable from the index rather than only from a directory listing.
 */
// The failed captures, derived from each capture's own exit files by the shared rule. The
// diagnostic is looked up for the reader's convenience, but its *presence* is not the
// criterion: a failure nobody wrote a note for is still a failure.
manifest.known_failed_captures = failedCaptures(root).map((entry) => {
  const relative = `docs/evidence/WAVE2/logs/${entry.capture_commit}`;
  const diagnostic = diagnosticFor(entry.directory);
  return {
    capture_commit: entry.capture_commit,
    failed_commands: entry.failures.map((failure) => failure.exit === null
      ? `${failure.name} did not finish (no exit file)`
      : `${failure.name} exit=${failure.exit}`),
    diagnostic: diagnostic === null ? null : relative + "/" + diagnostic.split("/").pop(),
    kept: true,
    note: "A failed capture, kept verbatim. It is not evidence of a passing run and is never counted as one.",
  };
});

const target = resolve(root, process.argv[3] ?? "docs/evidence/WAVE2/evidence-manifest-m4b.json");
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote M4B manifest: commands=${commands.length} cases=${cases.length}`);
