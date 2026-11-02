import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The M5 evidence manifest.
 *
 * It records every file of a capture with its SHA256, the case statuses and the
 * environment facts. The manifest is the thing a reader checks the evidence *against*:
 * a file that is not in the manifest is not evidence, and a file whose digest does not
 * match is a different file.
 */
const captureSha = process.argv[2];
const manifestPath = process.argv[3] ?? "docs/evidence/WAVE3/M5/captures/manifest.json";
if (!captureSha) {
  process.stderr.write("usage: node tools/m5-evidence-manifest.mjs <capture-sha> [manifest-path]\n");
  process.exit(2);
}

const captureRoot = resolve("docs/evidence/WAVE3/M5/captures", captureSha);
if (!statSync(captureRoot, { throwIfNoEntry: false })) {
  process.stderr.write(`the capture ${captureSha} does not exist\n`);
  process.exit(2);
}

const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) { walk(absolute); continue; }
    const bytes = readFileSync(absolute);
    files.push({
      path: relative(captureRoot, absolute).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
};
walk(captureRoot);

const cases = [];
for (const file of files.filter((entry) => entry.path.startsWith("cases/") && entry.path.endsWith(".json"))) {
  const value = JSON.parse(readFileSync(join(captureRoot, file.path), "utf8"));
  cases.push({
    case_id: value.case_id,
    title: value.title,
    status: value.status,
    assertions: value.assertions.length,
    failed_assertions: value.assertions.filter((assertion) => !assertion.ok).map((assertion) => assertion.claim),
    path: file.path,
    sha256: file.sha256,
  });
}
cases.sort((left, right) => (left.case_id < right.case_id ? -1 : 1));

const environment = statSync(join(captureRoot, "environment.txt"), { throwIfNoEntry: false })
  ? readFileSync(join(captureRoot, "environment.txt"), "utf8") : "";

const manifest = {
  kind: "narralens.m5_evidence_manifest@1.0",
  capture_sha: captureSha,
  files,
  cases,
  counts: {
    files: files.length,
    cases: cases.length,
    passed: cases.filter((entry) => entry.status === "PASS").length,
    failed: cases.filter((entry) => entry.status === "FAIL").length,
    blocked_env: cases.filter((entry) => entry.status === "BLOCKED_ENV").length,
    not_run: cases.filter((entry) => entry.status === "NOT_RUN").length,
  },
  environment,
  declaration_ceiling: "M5_HEADLESS_EVIDENCED",
  human_experience: "NOT_RUN",
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(manifest.counts)}\n`);
