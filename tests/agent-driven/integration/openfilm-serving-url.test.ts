import {afterEach, describe, expect, it} from "vitest";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {spawn, type ChildProcess} from "node:child_process";
import {fileURLToPath} from "node:url";

/**
 * A malformed public request must be refused INSIDE the serving.
 *
 * The serving is the FIXED pinned one, on its OWN loopback listener, in a child
 * process of its own: the request target `//[` is not something a client library
 * sends, and the case is about what the serving does with it when it does - so the
 * child has to be able to die (or not) without taking the test run with it.
 *
 * Nothing is rendered and nothing is probed: the only file asked for is a text
 * file of the fixture's own folder.
 */
const VENDOR_ROOT = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";
const CHILD = resolve("tests/fixtures/openfilm-serving-url-child.mjs");
const HELLO = "hello from the fixture\n";

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    await new Promise<void>(done => {
      child.once("exit", () => done());
      child.once("error", () => done());
    });
  }
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

/** The status line of a raw answer. */
const statusOf = (raw: string): string => raw.split("\r\n", 1)[0] ?? "";
/** The body of a raw answer, with the chunked framing taken off. */
const bodyOf = (raw: string): string => {
  const head = raw.split("\r\n\r\n", 1)[0] ?? "";
  const body = raw.slice(head.length + 4);
  if (!/transfer-encoding:\s*chunked/iu.test(head)) return body;
  let out = "";
  let rest = body;
  for (;;) {
    const cut = rest.indexOf("\r\n");
    if (cut < 0) return out;
    const size = Number.parseInt(rest.slice(0, cut), 16);
    if (!Number.isFinite(size) || size === 0) return out;
    out += rest.slice(cut + 2, cut + 2 + size);
    rest = rest.slice(cut + 4 + size);
  }
};

describe("the OpenFilm serving refuses a malformed request target", () => {
  it("answers a bounded 400, stays alive, and still answers the next legal request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "n1n2-serving-url-"));
    roots.push(dir);
    writeFileSync(join(dir, "hello.txt"), HELLO);
    const child = spawn(process.execPath, [CHILD, VENDOR_ROOT, dir], {stdio: ["ignore", "pipe", "pipe"]});
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; });
    const exit = await new Promise<number>((done, failed) => {
      child.once("error", failed);
      child.once("exit", code => done(code ?? -1));
    });
    // The child is the proof that the serving survived the malformed target: on the
    // old implementation the exception escaped the HTTP listener and the process
    // died with it.
    expect(stderr, stderr).not.toMatch(/ERR_INVALID_URL|Uncaught/i);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
    const line = stdout.trim().split("\n").pop() ?? "";
    const report = JSON.parse(line) as Record<string, string>;
    // The malformed target really reached the serving, and the serving refused it
    // ITSELF: the policy headers are on the answer, and the body is its own.
    expect(statusOf(report.badTarget ?? "")).toBe("HTTP/1.1 400 Bad Request");
    expect(report.badTarget ?? "").toMatch(/content-security-policy:/u);
    expect(bodyOf(report.badTarget ?? "")).toBe("bad address");
    // The same serving, right after: the legal asset is answered with its bytes.
    expect(statusOf(report.good ?? "")).toBe("HTTP/1.1 200 OK");
    expect(bodyOf(report.good ?? "")).toBe(HELLO);
    expect(report.good ?? "").toMatch(/content-security-policy:/u);
    // The refusals that were there before are still there.
    expect(statusOf(report.wrongHost ?? "")).toBe("HTTP/1.1 403 Forbidden");
    expect(statusOf(report.escape ?? "")).toBe("HTTP/1.1 403 Forbidden");
    expect(statusOf(report.absent ?? "")).toBe("HTTP/1.1 404 Not Found");
  }, 120000);
});
