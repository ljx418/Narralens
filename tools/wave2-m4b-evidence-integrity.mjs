import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
