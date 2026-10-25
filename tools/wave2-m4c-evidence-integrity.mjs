import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { failedCaptures } from "./wave2-capture-outcome.mjs";

/**
 * The M4C integrity gate.
 *
 * It audits the capture it is given: the command records, the command *set*, the case file
 * and its citations, the route state of the captured tree, the declaration ceiling, and the
 * index of failed captures.
 *
 * Two properties are worth naming.
 *
 * - **The gate audits with its own rule.** The failed-capture index is recomputed here from
 *   the logs, in this file's own code, and required to agree with the shared rule. One
 *   implementation called twice is a tautology; two independent implementations that agree
 *   are a check.
 * - **The command set is the one the manifest can physically contain.** The manifest the
 *   capture generates inside its own log directory is written before the manifest and gate
 *   commands finish, so requiring those two names would fail every capture the gate is part
 *   of. The required set is the commands that are finished before the manifest is
 *   generated, and the two later ones are covered by the agreement rule instead.
 */

const root = resolve(".");
const manifestPath = resolve(root, process.argv[2] ?? "docs/evidence/WAVE2/evidence-manifest-m4c.json");
const casesPath = resolve(root, "docs/evidence/WAVE2/cases/m4c-cases.json");
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

{
  const requiredCommands = [
    "check", "typecheck", "contracts", "m2.1", "wave2-w2.0", "wave2-m3", "wave2-m4a",
    "wave2-m4b", "wave2-m4c", "wave2-fitness", "build", "wave1-historical", "m4a-historical",
    "m4b-historical", "restore-plan-golden-python", "restore-plan-vectors", "credential-scan",
  ];
  // Written after the manifest is generated, so they may be absent from a manifest that was
  // checked inside its own capture and present in the committed copy.
  const writtenAfterTheManifest = new Set(["manifest", "m4c-integrity"]);
  const present = new Set((manifest.commands ?? []).map((entry) => entry.name));
  const absent = requiredCommands.filter((name) => !present.has(name));
  if (absent.length === 0) pass(`the manifest lists all ${requiredCommands.length} required commands`);
  else fail(`the manifest is missing commands: ${absent.join(", ")}`);
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
  const checked = String(manifest.checked_manifest ?? "");
  if (checked === "" || !existsSync(resolve(root, checked))) {
    fail(`the manifest's checked_manifest is missing or does not exist: ${checked || "(unset)"}`);
  } else {
    try {
      const checkedManifest = JSON.parse(readFileSync(resolve(root, checked), "utf8"));
      const sameCapture = checkedManifest.capture_commit === manifest.capture_commit;
      const checkedNames = new Set((checkedManifest.commands ?? []).map((entry) => entry.name));
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

/**
 * The cases.
 *
 * Every required case must be present and closed, and every citation must name a file that
 * exists — and, when it names a test, a test that exists. A case that points at a test
 * which was renamed or deleted is exactly the drift this gate exists to catch.
 */
{
  const required = new Set([
    "M4C-01", "M4C-02", "M4C-03", "M4C-04", "M4C-05", "M4C-06",
    "TX-03C", "TX-04C", "TX-05C", "TX-07C", "TX-08C", "TX-09", "TX-10",
    "TX-12C", "TX-13C", "M4C-14", "M4C-15", "M4C-16", "M4C-17", "M4C-18",
  ]);
  for (const entry of cases) {
    required.delete(entry.case_id);
    if (entry.status !== "CLOSED") fail(`${entry.case_id} is not CLOSED`);
    for (const ref of entry.tests ?? []) {
      const [file, ...rest] = String(ref).split("::");
      if (!existsSync(resolve(root, file))) { fail(`missing test reference: ${ref}`); continue; }
      const name = rest.join("::").trim();
      if (name === "") continue;
      if (name.includes("%s")) continue; // a table-driven case: the file is the evidence
      const text = readFileSync(resolve(root, file), "utf8");
      if (text.includes(name)) continue;
      const templates = [
        ...[...text.matchAll(/"([^"]*%s[^"]*)"/gu)].map((match) => match[1].split("%s")[0]),
        ...[...text.matchAll(/`([^`]*\$\{[^`]*`)/gu)].map((match) => match[1].split("${")[0]),
      ];
      const matches = templates.some((prefix) => prefix !== "" && name.startsWith(prefix));
      if (!matches) fail(`test reference names a test that does not exist: ${ref}`);
    }
  }
  required.size === 0
    ? pass(`all ${cases.length} required M4C cases are directly mapped`)
    : fail(`missing cases: ${[...required].join(",")}`);
}

/**
 * The captured tree's route state.
 *
 * M4C opens the history read model, the controlled restore and the two history
 * translations. The controlled adoption has to still be there: M4C added to M4B, it did
 * not replace it.
 */
{
  const serverAtCapture = execFileSync("git", ["show", `${manifest.capture_commit}:src/host/server.ts`],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const routes = {
    edits: serverAtCapture.includes("\\/edits$"),
    history: serverAtCapture.includes("\\/history$"),
    restore: serverAtCapture.includes("\\/history\\/restore$"),
    undo: serverAtCapture.includes("\\/history\\/undo$"),
    redo: serverAtCapture.includes("\\/history\\/redo$"),
  };
  for (const [name, open] of Object.entries(routes)) {
    open ? pass(`capture tree mounts the ${name} route`) : fail(`capture tree does not mount the ${name} route`);
  }
}

/**
 * The frozen restore-plan vectors.
 *
 * The file is committed evidence and the capture regenerates it into a temporary copy and
 * compares, so a drift in the canonical rules is *detected* rather than caused. This gate
 * checks the committed file against the Python implementation, which is the independent
 * half of the cross-check.
 */
{
  const vectors = resolve(root, "tests/wave2/m4c/restore-plan.vectors.json");
  if (!existsSync(vectors)) {
    fail("the frozen restore-plan vectors are missing");
  } else {
    const document = JSON.parse(readFileSync(vectors, "utf8"));
    const expectedDomain = "narralens-history-restore-plan-v1\\n";
    document.domain === expectedDomain
      ? pass("the frozen restore-plan vectors carry the frozen domain")
      : fail(`the frozen vectors' domain is ${document.domain}`);
    (document.vectors ?? []).length >= 10
      ? pass(`the frozen restore-plan vectors hold ${document.vectors.length} cases`)
      : fail("the frozen restore-plan vectors hold fewer than ten cases");
    const hashes = new Set((document.vectors ?? []).map((vector) => vector.plan_sha256));
    // Every single-field mutation must move the hash, and the reordered case must not.
    const base = (document.vectors ?? []).find((vector) => vector.name === "base");
    const reordered = (document.vectors ?? []).find((vector) => vector.name === "reordered-arrays");
    const mutations = (document.vectors ?? []).filter((vector) => vector.name.startsWith("mutated-"));
    if (base !== undefined && reordered !== undefined
      && reordered.plan_sha256 === base.plan_sha256
      && mutations.every((mutation) => mutation.plan_sha256 !== base.plan_sha256)
      && hashes.size === mutations.length + 2) {
      pass(`every one of the ${mutations.length} single-field mutations moves the hash, and the reordered case does not`);
    } else {
      fail("the frozen restore-plan vectors do not bite the way they claim to");
    }
  }
}

/**
 * The failed-capture index, recomputed by this gate's own rule.
 */
{
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
  const shared = failedCaptures(root).map((entry) => entry.capture_commit).sort();
  const own = [...computed.keys()].sort();
  if (JSON.stringify(shared) === JSON.stringify(own)) {
    pass("the gate's own rule and the shared rule agree on every capture");
  } else {
    fail("the gate's own rule and the shared rule disagree; one of them is wrong");
  }
}

manifest.declaration === "M4C_INTERNAL_EVIDENCED"
  ? pass("declaration stays within the M4C ceiling")
  : fail("declaration exceeds the M4C ceiling");
manifest.review?.external === "REVIEW_PENDING"
  ? pass("the external review is not self-signed")
  : fail("the external review status is not REVIEW_PENDING");
console.log(`checks_failed=${failures} capture_commit=${manifest.capture_commit}`);
process.exit(failures === 0 ? 0 : 1);
