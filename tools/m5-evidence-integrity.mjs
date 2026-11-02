import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The M5 evidence integrity gate.
 *
 * It checks the things that make the evidence trustworthy:
 *
 * - every capture is *complete* (it has an end marker) and has a manifest;
 * - every file the manifest names is there, with the digest the manifest recorded;
 * - every command that was run has its raw `.cmd`, `.txt` and `.exit` triple;
 * - every case in the manifest has a case file, and every case file is in the manifest;
 * - the human experience gate is still `NOT_RUN`, and the declaration ceiling is not
 *   above `M5_HEADLESS_EVIDENCED`;
 * - every failed capture is in the failed-capture index — a failure that is not indexed
 *   is a failure nobody looked at.
 *
 * It exits non-zero on any failure, and it prints what failed.
 */
const root = resolve("docs/evidence/WAVE3/M5");
const failures = [];
const note = (message) => failures.push(message);

const capturesRoot = join(root, "captures");
const captures = existsSync(capturesRoot)
  ? readdirSync(capturesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : [];

if (captures.length === 0) note("there is no M5 capture at all");

for (const capture of captures) {
  const directory = join(capturesRoot, capture);
  const files = new Set(readdirSync(directory, { recursive: true }).map((name) => name.replaceAll("\\", "/")));
  const manifestPath = join(directory, "manifest.json");

  // 1. A capture with no manifest never finished: it is an *incomplete* run, not a formal
  //    capture. It is not judged here — the failed-capture index has to know about it, and
  //    that gate checks exactly that below.
  if (!existsSync(manifestPath)) continue;

  // 2. A formal capture is complete: the end marker is written last.
  if (!files.has("git-status-after.txt")) note(`${capture}: no end marker (the capture did not finish)`);

  // 3. The manifest exists and is inside the capture.
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // 3. Every file the manifest names is there, with the recorded digest.
  for (const file of manifest.files ?? []) {
    const path = join(directory, file.path);
    if (!existsSync(path)) { note(`${capture}: the manifest names a missing file: ${file.path}`); continue; }
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (digest !== file.sha256) note(`${capture}: ${file.path} does not match its manifest digest`);
  }

  // 4. Every command has its raw triple.
  const commands = [...files].filter((name) => name.endsWith(".cmd")).map((name) => name.slice(0, -4));
  for (const command of commands) {
    if (!files.has(`${command}.txt`)) note(`${capture}: ${command} has no raw output`);
    if (!files.has(`${command}.exit`)) note(`${capture}: ${command} has no exit code`);
  }

  // 5. The cases and the manifest agree.
  const caseFiles = [...files].filter((name) => name.startsWith("cases/") && name.endsWith(".json"));
  for (const caseFile of caseFiles) {
    if (!manifest.cases?.some((entry) => entry.path === caseFile)) {
      note(`${capture}: ${caseFile} is not in the manifest`);
    }
  }
  for (const entry of manifest.cases ?? []) {
    if (!files.has(entry.path)) note(`${capture}: the manifest names a missing case: ${entry.path}`);
    const value = JSON.parse(readFileSync(join(directory, entry.path), "utf8"));
    if (value.status !== entry.status) note(`${capture}: ${entry.case_id} disagrees with the manifest status`);
  }

  // 6. The declaration ceiling and the human gate.
  if (manifest.declaration_ceiling !== "M5_HEADLESS_EVIDENCED") {
    note(`${capture}: the declaration ceiling is ${manifest.declaration_ceiling}`);
  }
  if (manifest.human_experience !== "NOT_RUN") {
    note(`${capture}: the human experience gate is not NOT_RUN`);
  }
  const environment = manifest.environment ?? "";
  if (!environment.includes("human_experience=NOT_RUN")) {
    note(`${capture}: the environment does not record the human gate as NOT_RUN`);
  }
}

// 7. The failed-capture index lists every capture that did not pass.
const indexPath = join(root, "failed-captures.json");
if (existsSync(indexPath)) {
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const indexed = new Set((index.captures ?? []).map((entry) =>
    (typeof entry === "string" ? entry : entry.capture)));
  for (const capture of captures) {
    const manifestPath = join(capturesRoot, capture, "manifest.json");
    // A capture with no manifest never finished; it is a failure too, and it has to be
    // indexed so it is not invisible.
    if (!existsSync(manifestPath)) {
      if (!indexed.has(capture)) note(`${capture}: an incomplete capture is not in the failed-capture index`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const failed = (manifest.cases ?? []).some((entry) => entry.status === "FAIL");
    const overall = join(capturesRoot, capture, "overall.txt");
    const overallText = existsSync(overall) ? readFileSync(overall, "utf8").trim() : "";
    if (failed || overallText !== "0") {
      if (!indexed.has(capture)) note(`${capture}: a failed capture is not in the failed-capture index`);
    }
  }
} else {
  note("there is no failed-capture index");
}

if (failures.length > 0) {
  process.stdout.write(`${failures.map((failure) => `FAIL ${failure}`).join("\n")}\n`);
  process.stdout.write(`M5 evidence integrity: ${failures.length} failure(s)\n`);
  process.exit(1);
}
process.stdout.write(`M5 evidence integrity: ${captures.length} capture(s), 0 failures\n`);
