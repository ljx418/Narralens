import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The M5 failed-capture index.
 *
 * A failure that is not indexed is a failure nobody looked at, so every capture that did
 * not pass is recorded here — with the cases that failed and the reason. The index is
 * append-only: a capture that has been fixed keeps its entry, because the history of what
 * went wrong is part of the evidence.
 */
const root = resolve("docs/evidence/WAVE3/M5");
const capturesRoot = join(root, "captures");
const indexPath = join(root, "failed-captures.json");

const existing = existsSync(indexPath)
  ? JSON.parse(readFileSync(indexPath, "utf8"))
  : { kind: "narralens.m5_failed_captures@1.0", captures: [] };

const known = new Set(existing.captures.map((entry) => entry.capture));
const added = [];
for (const capture of readdirSync(capturesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
  const directory = join(capturesRoot, capture);
  const manifestPath = join(directory, "manifest.json");
  const overallPath = join(directory, "overall.txt");
  const blockedPath = join(directory, "blocked-env.json");
  const incomplete = !existsSync(manifestPath);
  const cases = [];
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const entry of manifest.cases ?? []) {
      if (entry.status !== "PASS") {
        cases.push({ case_id: entry.case_id, status: entry.status, failed_assertions: entry.failed_assertions });
      }
    }
  }
  const overall = existsSync(overallPath) ? readFileSync(overallPath, "utf8").trim() : "";
  const blocked = existsSync(blockedPath) ? readFileSync(blockedPath, "utf8").trim() : "";
  const failed = incomplete || cases.length > 0 || (overall !== "" && overall !== "0") || blocked !== "";
  if (!failed) continue;
  if (known.has(capture)) continue;
  const entry = {
    capture,
    recorded_at: new Date().toISOString(),
    incomplete,
    overall_exit: overall === "" ? null : Number(overall),
    blocked_env: blocked === "" ? null : JSON.parse(blocked).reason,
    cases,
    note: "这一次捕获没有通过；它被保留在这里，而不是被删除或重跑成一个绿色。",
  };
  existing.captures.push(entry);
  added.push(capture);
}

existing.captures.sort((left, right) => (left.capture < right.capture ? -1 : 1));
existing.updated_at = new Date().toISOString();
writeFileSync(indexPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
process.stdout.write(`failed-capture index: ${existing.captures.length} entries (${added.length} new)\n`);
