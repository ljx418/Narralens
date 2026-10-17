import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M-02: evidence must be reproducible from a clone.
 *
 * The external review found the manifest recording SHA256 digests of `*.log` files that
 * .gitignore excludes, so nothing it pointed at could be obtained or verified. These
 * assertions run inside `pnpm check`, so the same mistake cannot come back silently.
 * `tools/m2.1-evidence-integrity.mjs` performs the same checks standalone.
 */

const EVIDENCE_ROOT = "docs/evidence/M2/M2.1";
const CODE_PATHS = ["src", "tests", "contracts", "tools", "package.json"];
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim();

interface Manifest {
  repo_dirty_at_capture: boolean;
  frozen_code_sha: string;
  review: { internal: string; external: string };
  cases: Array<{ case_id: string; status: string; artifacts: Array<{ path: string; sha256: string }>;
    commands: Array<{ command: string; exit_code: number; stdout_stderr: string; stdout_stderr_sha256?: string }> }>;
}

const manifest = JSON.parse(readFileSync(resolve(`${EVIDENCE_ROOT}/evidence-manifest.json`), "utf8")) as Manifest;
/** Evidence logs live under the capture commit's short SHA and are never reused. */
const captureDir = manifest.frozen_code_sha.slice(0, 7);
const referenced = manifest.cases.flatMap((entry) => [
  ...entry.artifacts.map((artifact) => artifact.path),
  ...entry.commands.map((command) => command.stdout_stderr),
]);

describe("M-02 evidence integrity", () => {
  it("records a clean tree and a real frozen commit", () => {
    expect(manifest.repo_dirty_at_capture).toBe(false);
    expect(manifest.frozen_code_sha).toMatch(/^[a-f0-9]{40}$/u);
    expect(git("cat-file", "-t", manifest.frozen_code_sha)).toBe("commit");
  });

  it("records logs under the capture commit so a rerun cannot invalidate them", () => {
    const captured = manifest.cases.flatMap((entry) => entry.commands.map((command) => command.stdout_stderr));
    for (const path of captured) expect(path.startsWith(`logs/${captureDir}/`), path).toBe(true);
    expect(existsSync(resolve(`${EVIDENCE_ROOT}/logs/${captureDir}/check.txt`))).toBe(true);
  });

  it("references only files that exist, are tracked and match their recorded digest", () => {
    expect(referenced.length).toBeGreaterThan(0);
    for (const relativePath of referenced) {
      expect(relativePath.endsWith(".log"), `${relativePath} must not be a .log (git-ignored)`).toBe(false);
      const absolute = resolve(EVIDENCE_ROOT, relativePath);
      expect(existsSync(absolute), relativePath).toBe(true);
      expect(() => git("ls-files", "--error-unmatch", "--", `${EVIDENCE_ROOT}/${relativePath}`),
        `${relativePath} is not tracked by git`).not.toThrow();
      const recorded = manifest.cases.flatMap((entry) => entry.artifacts).find((artifact) => artifact.path === relativePath)?.sha256
        ?? manifest.cases.flatMap((entry) => entry.commands).find((command) => command.stdout_stderr === relativePath)?.stdout_stderr_sha256;
      if (recorded !== undefined) expect(sha256(absolute), relativePath).toBe(recorded);
    }
  });

  it("records every command with an exit code", () => {
    for (const entry of manifest.cases) {
      for (const command of entry.commands) {
        expect(command.command.length, entry.case_id).toBeGreaterThan(0);
        expect(Number.isInteger(command.exit_code), command.command).toBe(true);
      }
    }
  });

  it("has no code change after the frozen commit", () => {
    expect(git("diff", "--name-only", manifest.frozen_code_sha, "--", ...CODE_PATHS)).toBe("");
  });

  it("still reports external review as pending until an independent session decides", () => {
    expect(manifest.review.internal).toBe("PASS");
    expect(manifest.review.external).toBe("REVIEW_PENDING");
  });
});
