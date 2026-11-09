/**
 * A-MCP: the skill's bin wrapper owns its child and nothing else.
 *
 * An MCP client spawns the wrapper; the wrapper spawns the stdio server. When the
 * client goes away, the wrapper's stdin closes, and the server must not survive as
 * an orphan with nobody to talk to. The wrapper has to take its own child down —
 * and only its own child: the Host is a separate process with its own lifetime,
 * and an Agent session ending is not a reason to stop the Host.
 */

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..", "..", "..");
const wrapper = resolve(repositoryRoot, "skills", "narralens", "bin", "narralens-mcp.mjs");
const childEntry = resolve(here, "helpers", "long-lived-child.mjs");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) {
        resolvePromise(true);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        resolvePromise(false);
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe("A-MCP skill bin wrapper", () => {
  it("stops the server it started when the client disconnects", async () => {
    const directory = mkdtempSync(join(tmpdir(), "narralens-wrapper-"));
    const pidFile = join(directory, "child.pid");
    const wrapperProcess = spawn(process.execPath, [wrapper], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NARRALENS_MCP_ENTRY: childEntry,
        NARRALENS_CHILD_PID_FILE: pidFile,
      },
      stdio: ["pipe", "inherit", "inherit"],
    });

    let childPid: number | null = null;
    try {
      const appeared = await waitFor(() => existsSync(pidFile), 10_000);
      expect(appeared, "the wrapper must have started its child").toBe(true);
      childPid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
      expect(Number.isInteger(childPid)).toBe(true);
      expect(isAlive(childPid as number)).toBe(true);

      // The client disconnects: the wrapper's stdin closes.
      wrapperProcess.stdin.end();

      const exited = await waitFor(() => wrapperProcess.exitCode !== null, 10_000);
      expect(exited, "the wrapper must exit when its stdin closes").toBe(true);
      const stopped = await waitFor(() => !isAlive(childPid as number), 10_000);
      expect(stopped, "the server must not survive the client").toBe(true);
    } finally {
      if (childPid !== null && isAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
      if (wrapperProcess.exitCode === null) {
        wrapperProcess.kill("SIGKILL");
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not stop anything but its own child", async () => {
    // A local service that is not the wrapper's child: the Host, in this shape.
    const host = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolvePromise) => host.listen(0, "127.0.0.1", () => resolvePromise()));
    const address = host.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    const directory = mkdtempSync(join(tmpdir(), "narralens-wrapper-"));
    const pidFile = join(directory, "child.pid");
    const wrapperProcess = spawn(process.execPath, [wrapper], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NARRALENS_MCP_ENTRY: childEntry,
        NARRALENS_CHILD_PID_FILE: pidFile,
      },
      stdio: ["pipe", "inherit", "inherit"],
    });

    try {
      const appeared = await waitFor(() => existsSync(pidFile), 10_000);
      expect(appeared).toBe(true);
      wrapperProcess.stdin.end();
      await waitFor(() => wrapperProcess.exitCode !== null, 10_000);

      // The unrelated service is still serving: shutting the façade down is not a
      // reason to take the Host down.
      const response = await fetch(`http://127.0.0.1:${port}/api/agent/v1/health`);
      expect(response.status).toBe(200);
    } finally {
      if (wrapperProcess.exitCode === null) {
        wrapperProcess.kill("SIGKILL");
      }
      await new Promise<void>((resolvePromise) => host.close(() => resolvePromise()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
