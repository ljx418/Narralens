import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Build `evidence-manifest-m4a.json` from a capture directory.
 *
 * The manifest never hashes itself: it records the digest of every *other* artefact, so the
 * file cannot contain a claim about its own contents that has to be recomputed the moment it
 * is written. The capture commit comes from the argument, not from `HEAD`, so a manifest can
 * never describe a tree other than the one it was captured from.
 *
 * Usage: node tools/wave2-m4a-evidence-manifest.mjs <capture-sha>
 */

const REPO = resolve(".");
const capture = process.argv[2];
if (capture === undefined || !/^[a-f0-9]{40}$/u.test(capture)) {
  console.error("usage: wave2-m4a-evidence-manifest.mjs <full-capture-sha>");
  process.exit(2);
}

const logsRelative = `docs/evidence/WAVE2/logs/${capture}`;
const logsAbsolute = resolve(REPO, logsRelative);
if (!existsSync(logsAbsolute)) {
  console.error(`FAIL no capture directory at ${logsRelative}`);
  process.exit(1);
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

const environment = Object.fromEntries(
  readFileSync(resolve(logsAbsolute, "environment.txt"), "utf8")
    .split("\n").map((line) => line.trim()).filter(Boolean)
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }));

// ── the commands, read from the capture rather than restated ─────────────────────────
// The exit comes from the `.exit` file beside the log. A manifest that typed an exit code
// here could disagree with what actually ran, and the integrity gate would then be checking
// the manifest against itself.
const expectedFailures = new Set(["wave1-integrity"]);
const commands = [];
for (const file of execFileSync("bash", ["-lc",
  `ls "${logsRelative}" | sed -n 's/\\.exit$//p' | sort`], { encoding: "utf8" })
  .split("\n").map((line) => line.trim()).filter(Boolean)) {
  const log = `${logsRelative}/${file}.txt`;
  const exit = Number(readFileSync(resolve(logsAbsolute, `${file}.exit`), "utf8").trim());
  const entry = {
    name: file,
    command: readFileSync(resolve(logsAbsolute, `${file}.cmd`), "utf8").trim(),
    exit,
    log,
    log_sha256: existsSync(resolve(REPO, log)) ? sha256(resolve(REPO, log)) : null,
  };
  if (expectedFailures.has(file)) entry.expected_failure = true;
  commands.push(entry);
}

const cases = JSON.parse(readFileSync(resolve(REPO, "docs/evidence/WAVE2/cases/m4a-cases.json"), "utf8"));
const vectorsPath = "tests/wave2/m4a/impact-hash.vectors.json";

const manifest = {
  format: "narralens.wave2-evidence-manifest@1",
  stage: "M4A",
  module: "ImpactService",
  capture_commit: capture,
  capture_logs: logsRelative,
  captured_at_utc: environment.date_utc ?? null,
  repo_dirty_at_capture: Number(environment.repo_dirty_at_capture ?? "1"),
  environment,
  openfilm_upstream: environment.openfilm_upstream ?? "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
  origin_main: git("rev-parse", "origin/main"),
  branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  commands,
  hash_vectors: vectorsPath,
  hash_vectors_sha256: sha256(resolve(REPO, vectorsPath)),
  cases: cases.map((entry) => ({
    case_id: entry.case_id, status: entry.status, production_seam: entry.production_seam,
  })),
  route_status: {
    materialize: true, materializations: true,
    // M4A's own addition.
    impact: true,
    // M4B and M4C. These two are asserted closed by this manifest's integrity gate, so a
    // future stage that opens one has to change the claim *and* the gate.
    edits: false, history_restore: false,
  },
  declaration: "M4A_INTERNAL_EVIDENCED",
  claim_limits: [
    "The highest declaration is M4A_INTERNAL_EVIDENCED. Nothing here closes Wave 2, Gate D4.2, Gate V1-P0, V1-Full, M5 or M6, and nothing here is an external review.",
    "M4B (adopt) and M4C (history restore) are not implemented. Their routes are unmounted, and the integrity gate fails if either is ever mounted.",
    "restore_snapshot intent is capability-blocked with 422 CAPABILITY_NOT_ENABLED. M4A has no independent read path for an immutable historical snapshot, because a SnapshotRef carries only a source digest.",
    "TX-02A, TX-03A, TX-04A and TX-05A are INTERNAL_EVIDENCED_SUBSET, not PASSED. TX-01 and the commit-time final re-check of TX-02..05 belong to M4B's write entry.",
    "TX-03A and TX-05A prove the *read* side of a lock and of a mid-computation change. A lock taken between the final check and a real commit is M4B's race, and M4A cannot close it.",
    "The layout is roots-only and carries no declaredAssets, because computeSourceDigest folds declaredAssets into the manifest and adding them would change source_digest. ADR-W2.0-005 records this; the ledger is checked against the roots rather than merged into them.",
    "The proxy encode is real in impact-real-chain.test.ts and stored-row-built everywhere else. The shortcut exercises M4A's own arithmetic, not M3's renderer; M3's suite is the gate on the renderer.",
    "The frozen hash vectors agree with an independently written Python implementation over the same eight vectors, including the preimage bytes. Agreement is evidence the canonical rules were transcribed correctly twice, not proof no shared misconception exists.",
    "The full gate runs at maxWorkers=1. That changes nothing about what is asserted, how long a test may take, or which tests run; the failed 002461b capture proved that two independent media-heavy Hosts can still produce a retryable 503 under aggregate load.",
    "evidence:wave1:integrity exits 1 by design: it asserts no code moved after the Wave 1 freeze, and Wave 2 moved code. Its output is kept verbatim and was never tuned green.",
    "The M3 integrity checker was changed to compare route claims against the tree at M3's own capture commit rather than the tip, and to stop printing PASS after a failed check. M3's manifest, logs and failed captures are untouched. Without that change a frozen historical record fails for later stages doing their job.",
    "headed/human experience is NOT_RUN: this stage adds no UI. Automation is headless, muted, windowless, offline and non-focus-stealing; no provider call, no payment, and no read of J:\\.",
    "No production crash-recovery GC exists for impact rows; no long-film performance, streaming-hash or full-render behaviour has been exercised.",
    "Post-insert currentness now re-runs pinned OpenFilm inspect and MaterializeService.read. Real source, asset or rights drift invalidates the impact; a retryable read failure remains 503 and does not permanently stale an authorization whose facts were not disproven.",
  ],
  supersedes: {
    // M4A's own earlier state, for a reader who finds the tree mid-flight.
    note: "This capture supersedes the first M4A capture at cec51dd for the two Codex external-review findings only. The earlier capture and all M3 captures remain append-only historical records.",
  },
};

const target = resolve(REPO, "docs/evidence/WAVE2/evidence-manifest-m4a.json");
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`wrote ${target}`);
console.log(`commands=${commands.length} cases=${manifest.cases.length} claims=${manifest.claim_limits.length}`);
