import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

describe("M5 failed-capture index", () => {
  it("does not report its own still-running capture as a historical failure", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "narralens-m5-failed-captures-"));
    const captures = resolve(root, "captures");
    await mkdir(resolve(captures, "current"), { recursive: true });
    await mkdir(resolve(captures, "historical-incomplete"), { recursive: true });
    await mkdir(resolve(captures, "historical-pass"), { recursive: true });
    await writeFile(resolve(captures, "current", "environment.txt"), "capture=current\n", "utf8");
    await writeFile(resolve(captures, "historical-incomplete", "environment.txt"), "capture=old\n", "utf8");
    await writeFile(resolve(captures, "historical-pass", "manifest.json"), JSON.stringify({ cases: [] }), "utf8");
    await writeFile(resolve(captures, "historical-pass", "overall.txt"), "0\n", "utf8");

    await exec(process.execPath, ["tools/m5-failed-captures.mjs", "current", root], { cwd: resolve(".") });

    const index = JSON.parse(await readFile(resolve(root, "failed-captures.json"), "utf8"));
    expect(index.captures.map((entry: { capture: string }) => entry.capture)).toEqual(["historical-incomplete"]);
  });

  it("lets integrity inspect only its explicitly named live capture before overall is written", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "narralens-m5-live-integrity-"));
    const capture = resolve(root, "captures", "current");
    await mkdir(capture, { recursive: true });
    await writeFile(resolve(capture, "git-status-after.txt"), "", "utf8");
    await writeFile(resolve(capture, "manifest.json"), JSON.stringify({
      files: [],
      cases: [],
      declaration_ceiling: "M5_HEADLESS_EVIDENCED",
      human_experience: "NOT_RUN",
      environment: "human_experience=NOT_RUN\n",
    }), "utf8");
    await writeFile(resolve(root, "failed-captures.json"), JSON.stringify({ captures: [] }), "utf8");

    const live = await exec(process.execPath, ["tools/m5-evidence-integrity.mjs", "current", root], {
      cwd: resolve("."),
    });
    expect(live.stdout).toContain("0 failures");

    await expect(exec(process.execPath, ["tools/m5-evidence-integrity.mjs", "", root], {
      cwd: resolve("."),
    })).rejects.toMatchObject({
      stdout: expect.stringContaining("a failed capture is not in the failed-capture index"),
    });
  });
});
