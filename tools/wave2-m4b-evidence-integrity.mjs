import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { failedCaptures } from "./wave2-capture-outcome.mjs";
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
 * was silently dropped. The rule is now a union, in `wave2-capture-outcome.mjs`, and this
 * gate recomputes it from the logs rather than reading the manifest it audits.
 */
{
  // Recomputed from the captures' own exit files, **not** from the manifest's list. The
  // manifest is what this gate audits; reading its answer back would make the audit
  // circular, and an earlier version of this check shared the generator's predicate and
  // therefore could not fail for any capture the script produced.
  const listed = new Set((manifest.known_failed_captures ?? []).map((entry) => entry.capture_commit));
  const computed = failedCaptures(root);
  const unlisted = computed.filter((entry) => !listed.has(entry.capture_commit));
  const spurious = [...listed].filter((commit) => !computed.some((entry) => entry.capture_commit === commit));
  if (unlisted.length === 0) pass(`every failed capture is indexed (${listed.size} listed)`);
  else {
    for (const entry of unlisted) {
      fail(`a failed capture is not in the index: ${entry.capture_commit} (${entry.failures.map((f) => `${f.name}=${f.exit}`).join(", ")})`);
    }
  }
  if (spurious.length === 0) pass("the index names no capture that did not fail");
  else fail(`the index names a capture that did not fail: ${spurious.join(", ")}`);
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
