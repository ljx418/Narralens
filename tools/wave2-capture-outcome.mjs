import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * One rule for "did this capture fail", shared by the manifest generator and the integrity
 * gate.
 *
 * It is a **union**, and that matters: an earlier version of this rule looked only at the
 * `.exit` files, which is a strict *subset* of the signals a capture can leave behind. A
 * capture killed mid-command leaves its `.cmd` and a partial `.txt` and nothing else — no
 * `.exit`, no `overall.txt`, no diagnostic — and that capture was silently dropped from the
 * index this rule is supposed to keep complete. A narrower rule is not a better rule.
 *
 * So a capture failed when **any** of these is true:
 *
 *   1. a command other than the two documented expected failures exited non-zero;
 *   2. one of those two *succeeded* — it is expected to fail, so a success is a failure of
 *      the expectation;
 *   3. a `CAPTURE_FAILED_DIAGNOSTIC.*` file is present;
 *   4. `overall.txt` exists and is non-zero;
 *   5. the capture is **incomplete**: a `.cmd` with no matching `.exit`;
 *   6. the capture **never reached the end of its script**.
 *
 * The sixth is the one that closes the residual hole: a capture killed after its last
 * command's `.exit` but before the script finished leaves every exit green, no diagnostic
 * and no outcome file, and would otherwise be classified as a clean capture. The end
 * markers are `overall.txt` (the current scripts) and `git-status-after.txt` (the older
 * ones, which wrote it last) — a capture with neither never finished.
 */

/** The commands whose non-zero exit is expected, and therefore not a failure by themselves. */
export const EXPECTED_FAILURE_COMMANDS = new Set(["wave1-integrity", "m4a-integrity"]);

/**
 * The failing commands of a capture directory.
 *
 * @param {string} directory the capture's log directory
 * @returns {{ name: string, exit: number | null }[]} the commands that failed unexpectedly
 */
export function failedCommands(directory) {
  const failures = [];
  let entries;
  try { entries = readdirSync(directory); }
  catch { return failures; }
  const exits = new Set(entries.filter((name) => name.endsWith(".exit")));
  for (const entry of exits) {
    const name = entry.slice(0, -".exit".length);
    const raw = readFileSync(join(directory, entry), "utf8").trim();
    // A truncated or empty `.exit` is not a success. It is the absence of a result.
    const code = /^\d+$/u.test(raw) ? Number(raw) : null;
    if (EXPECTED_FAILURE_COMMANDS.has(name)) {
      // These are expected to fail. One that *succeeded* is a failure of the expectation.
      if (code === 0) failures.push({ name, exit: 0 });
      continue;
    }
    if (code !== 0) failures.push({ name, exit: code });
  }
  // A command that was started and never finished. The capture died while it ran.
  for (const entry of entries) {
    if (!entry.endsWith(".cmd")) continue;
    const name = entry.slice(0, -".cmd".length);
    if (exits.has(`${name}.exit`)) continue;
    failures.push({ name, exit: null });
  }
  return failures;
}

/**
 * Every capture under `docs/evidence/WAVE2/logs` that failed.
 *
 * @param {string} root the repository root
 * @returns {{ capture_commit: string, directory: string, failures: { name: string, exit: number | null }[] }[]}
 */
export function failedCaptures(root) {
  const logs = resolve(root, "docs/evidence/WAVE2/logs");
  const out = [];
  let entries;
  try { entries = readdirSync(logs, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(logs, entry.name);
    const failures = failedCommands(directory);
    const diagnostic = diagnosticFor(directory) !== null;
    const outcome = resolve(directory, "overall.txt");
    const recorded = existsSync(outcome) ? readFileSync(outcome, "utf8").trim() : null;
    const recordedFailure = recorded !== null && recorded !== "" && recorded !== "0";
    // The capture must have reached the end of its script to be classified at all.
    const reachedTheEnd = recorded !== null
      || existsSync(resolve(directory, "git-status-after.txt"));
    if (!reachedTheEnd) {
      failures.push({ name: "the capture", exit: null });
    }
    if (failures.length === 0 && !diagnostic && !recordedFailure) continue;
    out.push({ capture_commit: entry.name, directory, failures });
  }
  return out;
}

/** The diagnostic a capture carries, or `null` when it has none. */
export function diagnosticFor(directory) {
  for (const name of ["CAPTURE_FAILED_DIAGNOSTIC.md", "CAPTURE_FAILED_DIAGNOSTIC.txt"]) {
    const path = join(directory, name);
    if (existsSync(path)) return path;
  }
  return null;
}
