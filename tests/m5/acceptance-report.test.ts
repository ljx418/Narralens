import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

describe("M5 acceptance report evidence links", () => {
  it("resolves every rendered screenshot src to the capture's real file", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "narralens-m5-report-"));
    const capture = resolve(root, "captures", "frozen-sha");
    const screenshot = resolve(capture, "screenshots", "UX-01.png");
    const output = resolve(root, "acceptance-report.html");
    await mkdir(dirname(screenshot), { recursive: true });
    await mkdir(resolve(capture, "cases"), { recursive: true });
    await writeFile(screenshot, "real screenshot bytes", "utf8");
    await writeFile(resolve(capture, "cases", "UX-01.json"), JSON.stringify({
      case_id: "UX-01",
      title: "report path",
      status: "PASS",
      assertions: [{ claim: "screenshot exists", ok: true }],
    }), "utf8");
    await writeFile(resolve(capture, "environment.txt"), "git_head=frozen-sha\n", "utf8");

    await exec(process.execPath, ["tools/m5-acceptance-report.mjs", capture, output], {
      cwd: resolve("."),
    });

    const html = await readFile(output, "utf8");
    const src = /<img src="([^"]+)"/u.exec(html)?.[1];
    expect(src).toBe("captures/frozen-sha/screenshots/UX-01.png");
    expect(src).not.toContain("captures/captures/");
    expect(await realpath(resolve(dirname(output), src!))).toBe(await realpath(screenshot));
  });
});
