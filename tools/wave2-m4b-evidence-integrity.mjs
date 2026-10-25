import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { failedCaptures } from "./wave2-capture-outcome.mjs";
import { join, dirname } from "node:path";
import { resolve } from "node:path";

const root = resolve(".");
// The manifest path is an argument so the capture can check the manifest it produced
// itself, inside its own log directory, and record that proof as evidence.
const manifestPath = resolve(root, process.argv[2] ?? "docs/evidence/WAVE2/evidence-manifest-m4b.json");
const casesPath = resolve(root, "docs/evidence/WAVE2/cases/m4b-cases.json");
let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL ${message}`); };
const pass = (message) => console.log(`PASS ${message}`);
if (!existsSync(manifestPath)) process.exit(1);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
try {
  const commit = execFileSync("git", ["rev-parse", `${manifest.capture_commit}^{commit}`], { encoding: "utf8" }).trim();
  commit === manifest.capture_commit ? pass("capture commit exists") : fail("capture commit mismatch");
} catch { fail("capture commit missing"); }
manifest.repo_dirty_at_capture === 0 ? pass("capture began from a clean tree") : fail("capture tree was dirty");
for (const command of manifest.commands ?? []) {
  const path = resolve(root, command.log);
  if (!existsSync(path) || hash(path) !== command.log_sha256) fail(`log mismatch: ${command.name}`);
  const exitPath = path.replace(/\.txt$/u, ".exit");
  if (!existsSync(exitPath) || Number(readFileSync(exitPath, "utf8").trim()) !== command.exit) fail(`exit mismatch: ${command.name}`);
  if (command.expected_failure === true ? command.exit === 0 : command.exit !== 0) fail(`unexpected exit: ${command.name}`);
}
failures === 0 && pass(`${manifest.commands.length} command logs and exits match`);

// The gate must require a *command set*, not merely check whatever the manifest lists. A
// manifest regenerated from a capture that was killed before its own manifest step would list
// fewer commands and pass every other check.
{
  // **The required set is the commands that are finished before the manifest is generated.**
  //
  // An earlier version demanded seventeen names, including `manifest` and `m4b-integrity` —
  // the two the capture writes *after* it has generated the manifest it is checking. A
  // manifest generated inside a capture therefore physically cannot carry them, so the gate
  // failed every capture it was part of, and re-capturing M4B evidence at the fixed commit
  // could only produce a failed capture. The set below is what the manifest can contain when
  // it is checked, and the two later commands are checked by the agreement rule below
  // instead.
  const requiredCommands = [
    "check", "typecheck", "contracts", "m2.1", "wave2-w2.0", "wave2-m3", "wave2-m4a",
    "wave2-m4b", "wave2-fitness", "build", "wave1-historical", "m4a-historical",
    "wave1-integrity", "m4a-integrity", "credential-scan",
  ];
  // Written after the manifest is generated, so they may be absent from a manifest that was
  // checked inside its own capture and present in the committed copy.
  const writtenAfterTheManifest = new Set(["manifest", "m4b-integrity"]);
  const present = new Set((manifest.commands ?? []).map((entry) => entry.name));
  const absent = requiredCommands.filter((name) => !present.has(name));
  if (absent.length === 0) pass(`the manifest lists all ${requiredCommands.length} required commands`);
  else fail(`the manifest is missing commands: ${absent.join(", ")}`);
  // And the manifest must agree with the capture directory: every command that finished
  // there is listed, and nothing is listed that did not finish. This is the check that
  // catches a manifest which quietly omits a command — the hole the fixed command set alone
  // would leave.
  const firstLog = manifest.commands?.[0]?.log;
  if (typeof firstLog !== "string" || firstLog === "") {
    fail("the manifest lists no command logs, so the capture directory cannot be found");
  } else {
    const directory = dirname(resolve(root, firstLog));
    const finished = readdirSync(directory).filter((name) => name.endsWith(".exit"))
      .map((name) => name.slice(0, -".exit".length));
    const unlisted = finished.filter((name) => !present.has(name) && !writtenAfterTheManifest.has(name));
    if (unlisted.length === 0) {
      pass(`the manifest lists every command that finished in the capture (${finished.length} finished)`);
    } else {
      fail(`the manifest omits commands that finished in the capture: ${unlisted.join(", ")}`);
    }
  }
  // And the file the capture checked must exist, and must be a manifest for *this* capture.
  // The committed manifest names the copy inside the capture's log directory, so the two
  // files differ; what has to agree is the capture they describe.
  const checked = String(manifest.checked_manifest ?? "");
  if (checked === "" || !existsSync(resolve(root, checked))) {
    fail(`the manifest's checked_manifest is missing or does not exist: ${checked || "(unset)"}`);
  } else {
    try {
      const checkedManifest = JSON.parse(readFileSync(resolve(root, checked), "utf8"));
      const sameCapture = checkedManifest.capture_commit === manifest.capture_commit;
      const checkedNames = new Set((checkedManifest.commands ?? []).map((entry) => entry.name));
      // The capture checked the manifest inside its own log directory, which is generated
      // before the two last commands finish, so it carries *fewer* commands than the
      // committed copy. The direction that matters is the one below: nothing the capture
      // checked may be missing from the manifest being read.
      const lost = [...checkedNames].filter((name) => !present.has(name));
      if (sameCapture && lost.length === 0) {
        pass("the manifest names a checked manifest for the same capture, with no command lost");
      } else {
        if (!sameCapture) fail("the checked manifest describes a different capture");
        if (lost.length > 0) fail(`the checked manifest lost commands: ${lost.join(", ")}`);
      }
    } catch {
      fail(`the manifest's checked_manifest cannot be read: ${checked}`);
    }
  }
}
const required = new Set(["TX-01", "TX-02", "TX-03", "TX-04", "TX-05", "TX-06", "TX-07", "TX-08B", "TX-11B", "TX-13", "TX-14", "M4B-NW", "REG"]);

/**
 * Gate A: the crash-matrix case must cite every crash test that exists.
 *
 * The case file's evidence text claims a number of boundaries; a reader follows the
 * citations. A citation list that quietly lost six of them left the claim true and the
 * index false, and nothing caught it — the *existence* check passed, because the six tests
 * still existed. So the rule is concrete rather than textual: every test in the M4B suites
 * whose name is about a crash boundary must be cited by TX-08B.
 */
{
  const crashTests = [];
  for (const file of readdirSync(resolve(root, "tests/wave2/m4b"), { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".test.ts")) continue;
    const text = readFileSync(resolve(root, "tests/wave2/m4b", file.name), "utf8");
    // A table-driven crash test counts as **one row per row**: citing one row of a five-row
    // table does not evidence the other four, and the case's own text says each is restarted.
    // The `as const` is optional: a table-driven crash test written without it must still be
    // visible to this gate, or TX-08B could silently stop citing it.
    for (const match of text.matchAll(/it\.each\(\[([\s\S]*?)\]\s*(?:as const\s*)?\)\("([^"]+)"/gu)) {
      const template = match[2] ?? "";
      if (!/boundary|crash/iu.test(template)) continue;
      // The template's `%s` is the table's **first** column. Taking every quoted string in
      // the table instead would invent titles like "recovers … at aborted", which are not
      // tests at all.
      const rows = [...match[1].matchAll(/\[([^\]]*)\]/gu)]
        .map((row) => (row[1].match(/"([^"]+)"/u) ?? [])[1])
        .filter((row) => row !== undefined);
      for (const row of rows) crashTests.push({ file: `tests/wave2/m4b/${file.name}`,
        title: template.replace("%s", row) });
    }
    for (const match of text.matchAll(/it\("([^"]+)"/gu)) {
      const title = match[1] ?? "";
      if (!/boundary|crash/iu.test(title)) continue;
      crashTests.push({ file: `tests/wave2/m4b/${file.name}`, title });
    }
  }
  const cited = (cases.find((entry) => entry.case_id === "TX-08B")?.tests ?? []).join(" ");
  const uncited = crashTests.filter((entry) => !cited.includes(entry.title));
  if (crashTests.length === 0) fail("no crash-boundary test was found to check the citations against");
  else if (uncited.length === 0) pass(`TX-08B cites all ${crashTests.length} crash-boundary rows`);
  else {
    for (const entry of uncited) fail(`TX-08B does not cite the crash test "${entry.title}"`);
  }
}

/**
 * Gate B: every capture that failed is in the index.
 *
 * The index used to be built from the presence of a hand-written diagnostic, so a failure
 * nobody wrote a note for was invisible; and a later version read only the `.exit` files,
 * which is a strict *subset* — a capture killed mid-command leaves no `.exit` at all, and it
 * was silently dropped. The rule is now a union, in `wave2-capture-outcome.mjs`.
 *
 * And this gate does not *import* that rule: it re-derives it here, from the logs, and
 * requires the two to agree. An earlier version shared the generator's predicate, so the
 * audit could never fail for a capture the script produced — one implementation called twice
 * is a tautology, not a check.
 */
{
  // **The gate's own implementation of the rule**, written here rather than imported.
  //
  // An earlier version of this check imported the generator's function. Moving the rule into
  // a shared module made the *data source* independent — the logs, not the manifest's list —
  // but the *predicate* was still the generator's, so the two could never disagree and the
  // audit was blind to exactly the class of defect the last two rounds' MAJORs lived in. Two
  // independent implementations that agree are a check; one implementation called twice is
  // a tautology.
  /**
   * The failures a capture expected, from the capture's own record.
   *
   * "Which failures did this capture expect?" is a fact about the capture, and a later
   * stage's capture may expect a failure that an earlier stage's capture must not have.
   * M4C, for instance, runs M4B's current-tip integrity gate — which fails *by design*
   * once M4C has mounted the history route. A global set could not say that without also
   * declaring M4B's own integrity gate a failure, which it is not.
   *
   * This is the gate's own implementation of the rule. The shared module implements it
   * too, and the two have to agree; that is what makes the agreement check below a check.
   */
  const expectedFailuresFor = (directory) => {
    const fallback = ["wave1-integrity", "m4a-integrity"];
    try {
      const text = readFileSync(join(directory, "environment.txt"), "utf8");
      const line = text.split("\n").find((entry) => entry.startsWith("expected_failure_commands="));
      if (line === undefined) return new Set(fallback);
      const names = line.slice("expected_failure_commands=".length)
        .split(",").map((name) => name.trim()).filter((name) => name !== "");
      return names.length === 0 ? new Set(fallback) : new Set(names);
    } catch { return new Set(fallback); }
  };
  const failuresOf = (directory) => {
    const expectedFailures = expectedFailuresFor(directory);
    const names = readdirSync(directory);
    const exits = new Set(names.filter((name) => name.endsWith(".exit")));
    const failures = [];
    for (const entry of exits) {
      const name = entry.slice(0, -".exit".length);
      const raw = readFileSync(join(directory, entry), "utf8").trim();
      const code = /^\d+$/u.test(raw) ? Number(raw) : null;
      if (expectedFailures.has(name)) {
        // Expected to fail. One that succeeded is a failure of the expectation.
        if (code === 0) failures.push(`${name} unexpectedly succeeded`);
        continue;
      }
      if (code !== 0) failures.push(`${name} exit=${code}`);
    }
    for (const entry of names) {
      if (!entry.endsWith(".cmd")) continue;
      const name = entry.slice(0, -".cmd".length);
      if (exits.has(`${name}.exit`)) continue;
      failures.push(`${name} did not finish`);
    }
    const diagnostic = names.some((name) => name.startsWith("CAPTURE_FAILED_DIAGNOSTIC."));
    const outcomePath = join(directory, "overall.txt");
    const recorded = existsSync(outcomePath) ? readFileSync(outcomePath, "utf8").trim() : null;
    const recordedFailure = recorded !== null && recorded !== "" && recorded !== "0";
    // The end marker is `git-status-after.txt` alone. `overall.txt` is written *before* the
    // manifest and the gate, so a capture killed in that window has every exit green and an
    // outcome of "0" — and `recorded !== null` would have called that the end of the script.
    // The comment used to say the new rule while the code still ran the old one, which is
    // exactly the kind of drift this gate exists to catch; the code and the comment now say
    // the same thing.
    const reachedTheEnd = existsSync(join(directory, "git-status-after.txt"));
    if (!reachedTheEnd) failures.push("the capture never reached the end of its script");
    else if (recordedFailure) failures.push("the capture recorded a failed outcome");
    else if (diagnostic) failures.push("the capture carries a failure diagnostic");
    return failures;
  };

  const listed = new Set((manifest.known_failed_captures ?? []).map((entry) => entry.capture_commit));
  const computed = new Map();
  for (const entry of readdirSync(resolve(root, "docs/evidence/WAVE2/logs"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const failures = failuresOf(resolve(root, "docs/evidence/WAVE2/logs", entry.name));
    if (failures.length > 0) computed.set(entry.name, failures);
  }
  const unlisted = [...computed.entries()].filter(([commit]) => !listed.has(commit));
  const spurious = [...listed].filter((commit) => !computed.has(commit));
  if (unlisted.length === 0) pass(`every failed capture is indexed (${listed.size} listed)`);
  else {
    for (const [commit, failures] of unlisted) {
      fail(`a failed capture is not in the index: ${commit} (${failures.join(", ")})`);
    }
  }
  if (spurious.length === 0) pass("the index names no capture that did not fail");
  else fail(`the index names a capture that did not fail: ${spurious.join(", ")}`);
  // And the two implementations must agree, or one of them is wrong.
  const shared = failedCaptures(root).map((entry) => entry.capture_commit).sort();
  const own = [...computed.keys()].sort();
  if (JSON.stringify(shared) === JSON.stringify(own)) {
    pass("the gate's own rule and the shared rule agree on every capture");
  } else {
    fail("the gate's own rule and the shared rule disagree; one of them is wrong");
  }
}
for (const entry of cases) {
  required.delete(entry.case_id);
  if (entry.status !== "CLOSED") fail(`${entry.case_id} is not CLOSED`);
  // A reference may be a bare file or `file::test name`. When it names a test, the name has
  // to exist in that file: a case that points at a test which was renamed or deleted is
  // exactly the drift this gate exists to catch.
  for (const ref of entry.tests ?? []) {
    const [file, ...rest] = String(ref).split("::");
    if (!existsSync(resolve(root, file))) { fail(`missing test reference: ${ref}`); continue; }
    const name = rest.join("::").trim();
    if (name === "") continue;
    if (name.includes("%s")) continue; // a table-driven case: the file is the evidence
    const text = readFileSync(resolve(root, file), "utf8");
    if (text.includes(name)) continue;
    // A table-driven case: the file holds a template with `%s` and the reference names one
    // of its rows. The reference has to start with the template's prefix, so it still has to
    // be a row of *that* table rather than of any test in the file.
    const templates = [
      ...[...text.matchAll(/"([^"]*%s[^"]*)"/gu)].map((match) => match[1].split("%s")[0]),
      ...[...text.matchAll(/`([^`]*\$\{[^`]*`)/gu)].map((match) => match[1].split("${")[0]),
    ];
    const matches = templates.some((prefix) => prefix !== "" && name.startsWith(prefix));
    if (!matches) fail(`test reference names a test that does not exist: ${ref}`);
  }
}
required.size === 0 ? pass("all required M4B cases are directly mapped") : fail(`missing cases: ${[...required].join(",")}`);
const serverAtCapture = execFileSync("git", ["show", `${manifest.capture_commit}:src/host/server.ts`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const open = { edits: serverAtCapture.includes("\\/edits$/"),
  history_restore: serverAtCapture.includes("\\/history\\/restore$/") };
open.edits ? pass("capture tree mounts controlled adoption") : fail("capture tree does not mount adoption");
open.history_restore ? fail("capture tree prematurely mounts history restore") : pass("history restore remains unmounted");
manifest.declaration === "M4B_INTERNAL_EVIDENCED" ? pass("declaration stays within M4B ceiling") : fail("declaration exceeds M4B ceiling");
manifest.review?.external === "REVIEW_PENDING" ? pass("external review is not self-signed") : fail("external review status is not REVIEW_PENDING");
console.log(`checks_failed=${failures} capture_commit=${manifest.capture_commit}`);
process.exit(failures === 0 ? 0 : 1);
