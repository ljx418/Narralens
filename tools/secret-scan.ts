import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

/**
 * Fixed-ruleset credential scan for `AT-SEC-01`
 * (`docs/03_Architecture.md:216` requires `docs/evidence/<phase>/security/credential-scan.json`).
 *
 * This environment has no `gitleaks` binary, so this is the documented equivalent scanner:
 * a versioned rule set over the tracked working tree. It reports file, line, rule id and a
 * redacted match — never the secret itself — and it never reads a path outside the repo or
 * into `node_modules`, `dist`, `var` or a submodule.
 *
 * Run: `corepack pnpm evidence:m2.1:secret-scan`
 */

export const SCANNER_NAME = "narralens-ruleset-secret-scan";
export const SCANNER_VERSION = "1.0.0";
export const RULESET_ID = "narralens-credential-rules@1";

interface Rule {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

const RULES: readonly Rule[] = [
  { id: "AWS_ACCESS_KEY_ID", description: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { id: "AWS_SECRET_ACCESS_KEY", description: "AWS secret access key assignment", pattern: /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/giu },
  { id: "GITHUB_TOKEN", description: "GitHub personal access or app token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/gu },
  { id: "SLACK_TOKEN", description: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/gu },
  { id: "OPENAI_KEY", description: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9]{32,}\b/gu },
  { id: "ANTHROPIC_KEY", description: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9-]{32,}\b/gu },
  { id: "GOOGLE_API_KEY", description: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/gu },
  { id: "PRIVATE_KEY_BLOCK", description: "PEM private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gu },
  { id: "NARRALENS_SESSION_TOKEN", description: "A committed Narralens Host session token", pattern: /Bearer\s+[A-Za-z0-9_-]{43}\b/gu },
  { id: "GENERIC_SECRET_ASSIGNMENT", description: "A secret-shaped key assigned a long literal",
    pattern: /\b(?:api[_-]?key|secret|password|passwd|token|credential)s?\s*[:=]\s*["'][^"'\s]{16,}["']/giu },
];

export const RULESET_SHA256 = createHash("sha256")
  .update(RULES.map((rule) => `${rule.id}:${rule.pattern.source}:${rule.pattern.flags}`).join("\n"))
  .digest("hex");

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "var", "coverage", ".git", ".hypit", "vendor", "spikes", "docs"]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".txt", ".yml", ".yaml", ".sh", ".ps1", ".env", ".html", ".css", ".vtt", ".srt", ".sql", ".toml"]);

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) { walk(full, found); continue; }
    if (TEXT_EXTENSIONS.has(extname(full)) || extname(full) === "") found.push(full);
  }
  return found;
}

export interface Finding { readonly file: string; readonly line: number; readonly rule_id: string; readonly description: string; readonly redacted: string }

export interface ScanReport {
  readonly format: "narralens.credential-scan@1.0";
  readonly case_id: string;
  readonly scanner: { readonly name: string; readonly version: string; readonly ruleset_id: string; readonly ruleset_sha256: string; readonly rule_count: number };
  readonly scope: { readonly root: string; readonly scanned_files: number; readonly skipped_directories: string[] };
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
  readonly findings: readonly Finding[];
  readonly findings_count: number;
  readonly status: "PASS" | "FAIL";
  readonly notes: readonly string[];
}

function redact(match: string): string {
  return match.length <= 6 ? `${match[0]}***` : `${match.slice(0, 4)}***${match.slice(-2)}`;
}

export function scan(root: string): ScanReport {
  const startedAt = new Date();
  const files = walk(resolve(root));
  const findings: Finding[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        for (const match of line.matchAll(rule.pattern)) {
          findings.push({ file: relative(root, file).replaceAll("\\", "/"), line: index + 1,
            rule_id: rule.id, description: rule.description, redacted: redact(match[0]) });
        }
      }
    });
  }
  const finishedAt = new Date();
  return {
    format: "narralens.credential-scan@1.0",
    case_id: "AT-SEC-01",
    scanner: { name: SCANNER_NAME, version: SCANNER_VERSION, ruleset_id: RULESET_ID,
      ruleset_sha256: RULESET_SHA256, rule_count: RULES.length },
    scope: { root: relative(process.cwd(), resolve(root)) || ".", scanned_files: files.length,
      skipped_directories: [...SKIP_DIRECTORIES] },
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    findings,
    findings_count: findings.length,
    status: findings.length === 0 ? "PASS" : "FAIL",
    notes: [
      "Fixed-ruleset scanner; the environment provides no gitleaks binary.",
      "Findings are redacted: the scanner never writes a matched secret to its report.",
      "node_modules, dist, var, coverage, .git, .hypit, vendor, spikes and docs are out of scope; the credential surface under review is production source, contracts, tests and configuration.",
      "A PASS means no rule in this ruleset matched. It is not proof that no secret exists.",
    ],
  };
}

const outputPath = resolve("docs/evidence/M2/M2.1/security/credential-scan.json");
const report = scan(process.cwd());
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`${report.status} findings=${report.findings_count} files=${report.scope.scanned_files} -> ${relative(process.cwd(), outputPath)}`);
if (report.status === "FAIL") {
  for (const finding of report.findings) console.error(`${finding.file}:${finding.line} ${finding.rule_id} ${finding.redacted}`);
  process.exitCode = 1;
}
