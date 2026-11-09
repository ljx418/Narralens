/**
 * A-MCP: the skill's bin wrapper, end to end, and the child it owns.
 *
 * This case runs the **real** path: the SDK's own `Client`, over the SDK's own stdio
 * transport, against the **actual** skill wrapper, which starts the **actual** stdio
 * server. The only stand-in is the Host, which is a micro HTTP server on a loopback
 * port — everything above it is production code.
 *
 * Two things are pinned.
 *
 * **The streams are not corrupted.** The wrapper and the server must not read the
 * same input: if the wrapper consumed the client's stdin, the JSON-RPC stream would
 * be split between them and the handshake would fail. The client completing a
 * handshake and listing the tools is the proof that the wiring is right.
 *
 * **Nothing is left behind.** When the client disconnects, the wrapper's stdin
 * closes, and the server must not survive it as an orphan with nobody to talk to.
 * The wrapper's own child is looked up while it is running, and the case checks
 * that the process is gone afterwards.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { HealthRead, Instance } from "../../../src/contracts/agent-driven-types.js";

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const wrapper = resolve(repositoryRoot, "skills", "narralens", "bin", "narralens-mcp.mjs");

const INSTANCE = {
  instance_id: "narralens-a",
  generation: 1,
  api_version: "agent.v1",
  contract_version: "cp-a0-r4",
  capabilities: [{ id: "narralens_capabilities", version: 1, state: "available", reason: "registered" }],
  health: "ready",
} satisfies Instance;

const HEALTH = {
  services: [],
  sample_interval_ms: 5000,
  stale_after_ms: 15000,
} satisfies HealthRead;

class MicroHost {
  #server: Server | null = null;
  #port = 0;

  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  async start(): Promise<void> {
    this.#server = createServer((request, response) => {
      const path = (request.url ?? "").split("?")[0] ?? "";
      const payload = path === "/api/agent/v1/instance"
        ? INSTANCE
        : path === "/api/agent/v1/health"
          ? HEALTH
          : null;
      if (payload === null) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({
          schema_version: "agent.v1",
          correlation_id: "micro-host",
          code: "NOT_FOUND",
          http_status: 404,
          message: "No such route.",
          retryable: false,
          next_actions: ["check_identifier"],
        }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolvePromise) => {
      this.#server?.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const address = this.#server.address();
    this.#port = typeof address === "object" && address !== null ? address.port : 0;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (server === null) return;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The processes whose parent is the given pid. */
function childPids(parentPid: number): number[] {
  try {
    const output = execFileSync("ps", ["-o", "pid=", "--ppid", String(parentPid)], { encoding: "utf8" });
    return output
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
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

function childEnvironment(hostUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env["NARRALENS_HOST_URL"] = hostUrl;
  delete env["NARRALENS_HOST_TOKEN"];
  return env;
}

/**
 * The wrapper starts the server as a child process and loads it through the
 * repository's own `tsx`, which takes a few seconds on this filesystem. The
 * default five second timeout is therefore too tight for these cases; they are
 * given a bound that fits the slowest thing they do, not the whole suite.
 */
const STDIO_TIMEOUT_MS = 60_000;

describe("A-MCP skill bin wrapper", () => {
  it("serves the real client through the real wrapper and leaves nothing behind", async () => {
    // The wrapper loads the TypeScript server through the repository's own `tsx`,
    // so this case needs the repository's dependencies installed.
    expect(() => require.resolve("tsx/esm")).not.toThrow();

    const host = new MicroHost();
    await host.start();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [wrapper],
      cwd: repositoryRoot,
      env: childEnvironment(host.baseUrl),
      stderr: "inherit",
    });
    const client = new Client({ name: "narralens-wrapper-case", version: "1.0.0" }, { capabilities: {} });

    let serverPid: number | null = null;
    try {
      await client.connect(transport);

      // The handshake completed and the tools were listed: the wrapper forwarded
      // the client's input to the server without consuming any of it.
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(24);

      const wrapperPid = transport.pid;
      expect(wrapperPid).not.toBeNull();
      const children = childPids(wrapperPid as number);
      expect(children.length, "the wrapper must have started the server").toBeGreaterThan(0);
      serverPid = children[0] as number;
      expect(isAlive(serverPid)).toBe(true);

      // The client disconnects.
      await client.close();

      const wrapperGone = await waitFor(() => !isAlive(wrapperPid as number), 15_000);
      expect(wrapperGone, "the wrapper must exit when the client disconnects").toBe(true);
      const serverGone = await waitFor(() => !isAlive(serverPid as number), 15_000);
      expect(serverGone, "the server must not survive the client").toBe(true);
    } finally {
      if (serverPid !== null && isAlive(serverPid)) {
        process.kill(serverPid, "SIGKILL");
      }
      await client.close().catch(() => undefined);
      await host.stop();
    }
  }, STDIO_TIMEOUT_MS);

  it("does not stop anything but its own child", async () => {
    // A local service that is not the wrapper's child: the Host, in this shape.
    const host = new MicroHost();
    await host.start();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [wrapper],
      cwd: repositoryRoot,
      env: childEnvironment(host.baseUrl),
      stderr: "inherit",
    });
    const client = new Client({ name: "narralens-wrapper-case", version: "1.0.0" }, { capabilities: {} });

    try {
      await client.connect(transport);
      await client.listTools();
      await client.close();

      // The unrelated service is still serving: shutting the façade down is not a
      // reason to take the Host down.
      const response = await fetch(`${host.baseUrl}/api/agent/v1/health`);
      expect(response.status).toBe(200);
    } finally {
      await client.close().catch(() => undefined);
      await host.stop();
    }
  }, STDIO_TIMEOUT_MS);
});
