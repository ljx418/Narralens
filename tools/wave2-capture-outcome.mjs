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
 * The sixth is the one that closes the residual hole, and the end marker it uses is
 * `git-status-after.txt` **alone**, because the Wave 2 capture scripts write it last. It is
 * not `overall.txt`: the current script writes that one *before* its own manifest and its own
 * gate, so a capture killed in that window has every exit green, an outcome of "0" and no
 * diagnostic — and would be classified clean. `overall.txt` stays a failure *signal* (rule 4),
 * never an end marker.
 *
 * The Wave 1 and M2.1 capture scripts predate the end marker and do not write one. Their
 * captures live under `docs/evidence/WAVE1/logs`, which this rule does not read, so the
 * rule and the directories it reads stay in step.
 */

/**
 * The commands whose non-zero exit is expected, and therefore not a failure by themselves.
 *
 * This is the *default*. A capture may narrow or widen it, and it records the set it used
 * in its own `environment.txt` — because "which failures did this capture expect?" is a
 * fact about that capture, not about the repository. M4C, for instance, runs M4B's
 * current-tip integrity gate, and that gate fails *by design* once M4C has mounted the
 * history route; the expectation belongs to the M4C capture, and a global set could not
 * express it without also declaring M4B's own integrity gate a failure — which it is not.
 */
export const DEFAULT_EXPECTED_FAILURE_COMMANDS = new Set(["wave1-integrity", "m4a-integrity"]);

/**
 * The expected-failure set a capture recorded for itself.
 *
 * A capture that does not record one — every capture before this field existed — uses the
 * default.
 */
export function expectedFailureCommands(directory) {
  try {
    const text = readFileSync(join(directory, "environment.txt"), "utf8");
    const line = text.split("\n").find((entry) => entry.startsWith("expected_failure_commands="));
    if (line === undefined) return DEFAULT_EXPECTED_FAILURE_COMMANDS;
    const names = line.slice("expected_failure_commands=".length)
      .split(",").map((name) => name.trim()).filter((name) => name !== "");
    return names.length === 0 ? DEFAULT_EXPECTED_FAILURE_COMMANDS : new Set(names);
  } catch { return DEFAULT_EXPECTED_FAILURE_COMMANDS; }
}

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
  const expected = expectedFailureCommands(directory);
  const exits = new Set(entries.filter((name) => name.endsWith(".exit")));
  for (const entry of exits) {
    const name = entry.slice(0, -".exit".length);
    const raw = readFileSync(join(directory, entry), "utf8").trim();
    // A truncated or empty `.exit` is not a success. It is the absence of a result.
    const code = /^\d+$/u.test(raw) ? Number(raw) : null;
    if (expected.has(name)) {
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
    // The end marker is `git-status-after.txt` **alone**, because every capture script writes
    // it last. `overall.txt` is not an end marker: the current script writes it before its own
    // manifest and its own gate, so a capture killed in that window has every exit green, an
    // outcome of "0" and no diagnostic — and would be classified clean.
    const reachedTheEnd = existsSync(resolve(directory, "git-status-after.txt"));
    if (!reachedTheEnd) {
      failures.push({ name: "the capture never reached the end of its script", exit: null });
    }
    if (failures.length === 0 && !diagnostic && !recordedFailure) continue;
    out.push({ capture_commit: entry.name, directory, failures });
  }
  return out;
}

/** The diagnostic a capture carries, or `null` when it has none. */
export function diagnosticFor(directory) {
  // The prefix rule, so the gate and this module agree on what a diagnostic is. An earlier
  // version accepted only `.md` and `.txt` here while the gate accepted any extension,
  // which would make a `.json` diagnostic failed by one and clean by the other.
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return null; }
  // Sorted, and files only. The read order is not a specification, so an index that named
  // "the" diagnostic by read order would name a different file on a different machine; and a
  // *directory* with the diagnostic's prefix is not a diagnostic at all.
  const names = entries.filter((entry) => entry.isFile() && entry.name.startsWith("CAPTURE_FAILED_DIAGNOSTIC."))
    .map((entry) => entry.name).sort();
  if (names.length === 0) return null;
  return join(directory, names[0]);
}
