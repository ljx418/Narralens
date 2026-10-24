import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * One rule for "did this capture fail", shared by the manifest generator and the integrity
 * gate.
 *
 * It is read from the capture's **own exit files**. Two earlier versions got this wrong in
 * opposite directions: one built the index from the presence of a hand-written diagnostic —
 * so a failure nobody wrote a note for was invisible — and one had the gate re-apply the
 * generator's own predicate to the manifest it was auditing, which cannot fail for any
 * capture the script produced.
 *
 * The rule is therefore the simplest one that cannot be wrong: a capture failed when a
 * command other than the two documented expected failures exited non-zero. The exits are
 * written by the capture itself, so they cannot disagree with what happened.
 */

/** The commands whose non-zero exit is expected, and therefore not a failure. */
export const EXPECTED_FAILURE_COMMANDS = new Set(["wave1-integrity", "m4a-integrity"]);

/**
 * The failing commands of a capture directory.
 *
 * @param {string} directory the capture's log directory
 * @returns {{ name: string, exit: number }[]} the commands that failed unexpectedly
 */
export function failedCommands(directory) {
  const failures = [];
  let entries;
  try { entries = readdirSync(directory); }
  catch { return failures; }
  for (const entry of entries) {
    if (!entry.endsWith(".exit")) continue;
    const name = entry.slice(0, -".exit".length);
    if (EXPECTED_FAILURE_COMMANDS.has(name)) continue;
    const raw = readFileSync(join(directory, entry), "utf8").trim();
    const code = Number(raw);
    if (Number.isFinite(code) && code !== 0) failures.push({ name, exit: code });
  }
  return failures;
}

/**
 * Every capture under `docs/evidence/WAVE2/logs` that failed.
 *
 * @param {string} root the repository root
 * @returns {{ capture_commit: string, directory: string, failures: { name: string, exit: number }[] }[]}
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
    if (failures.length === 0) continue;
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
