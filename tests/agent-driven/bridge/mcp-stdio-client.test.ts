/**
 * A-MCP: a real MCP client talking to the real façade over a real stdio transport.
 *
 * This is the case that cannot be faked with an in-process transport: the façade is
 * spawned as a child process exactly the way an MCP client spawns it, the SDK's own
 * `Client` performs the handshake over stdin/stdout, and the façade reaches a
 * local Host over HTTP.
 *
 * The Host here is a small HTTP server standing in for the production Host. It
 * records the requests it receives, so the assertion is not just "the tool
 * returned something" but "the tool's request reached the Host, on the path the
 * registry says, with the payload the client sent".
 *
 * These are still module cases: the Host is a stand-in, not the production Host,
 * and nothing here proves the production registration, the production
 * authentication or the production database.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Context, HealthRead, Instance } from "../../../src/contracts/agent-driven-types.js";

import { exposedToolNames } from "../../../src/mcp/index.js";

/**
 * The stdio server is started as a child process and loaded through the repository's own
 * `tsx`, which takes a few seconds on this filesystem. The default five second
 * timeout is therefore too tight for these cases; they are given a bound that fits
 * the slowest thing they do with room to spare for a loaded machine, not the whole
 * suite.
 */
const STDIO_TIMEOUT_MS = 60_000;

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const entry = resolve(repositoryRoot, "src", "mcp", "stdio-main.ts");

function resolveLoader(): string {
  try {
    return require.resolve("tsx/esm");
  } catch {
    throw new Error(
      "the repository dependencies are not installed: run 'pnpm install --offline --frozen-lockfile' "
      + "in the repository root before running the stdio case",
    );
  }
}

const INSTANCE = {
  instance_id: "narralens-a",
  generation: 1,
  api_version: "agent.v1",
  contract_version: "cp-a0-r4",
  capabilities: [{ id: "narralens_capabilities", version: 1, state: "available", reason: "registered" }],
  health: "ready",
} satisfies Instance;

const CONTEXT = {
  project_id: "p1",
  origin: "created",
  project_revision: 1,
  control_revision: 1,
  snapshot_id: "snap1",
  source_digest: "a".repeat(64),
  workflow_revision: 1,
  selection_version: 0,
  current_selection: null,
  active_jobs: [],
  artifacts: [],
  capabilities: [],
  next_actions: [],
  active_run: null,
  native_ack: null,
  native_sync: "unknown",
} satisfies Context;

const HEALTH = {
  services: [{
    service_id: "narralens-a",
    state: "ready",
    ownership: "owned",
    sampled_at: "2026-11-09T00:00:00.000Z",
    expires_at: "2026-11-09T00:00:15.000Z",
    reason: "api_ready",
    metrics: [],
  }],
  sample_interval_ms: 5000,
  stale_after_ms: 15000,
} satisfies HealthRead;

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

class FakeHost {
  readonly requests: RecordedRequest[] = [];
  #server: Server | null = null;
  #port = 0;

  get port(): number {
    return this.#port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  async start(port = 0): Promise<void> {
    this.#server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        this.requests.push({ method: request.method ?? "GET", url: request.url ?? "", body });
        const path = (request.url ?? "").split("?")[0] ?? "";
        const payload = path === "/api/agent/v1/instance"
          ? INSTANCE
          : path === "/api/agent/v1/health"
            ? HEALTH
            : path === "/api/agent/v1/projects/p1/context"
              ? CONTEXT
              : null;
        if (payload === null) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({
            schema_version: "agent.v1",
            correlation_id: "fake-host",
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
    });
    await new Promise<void>((resolvePromise) => {
      this.#server?.listen(port, "127.0.0.1", () => resolvePromise());
    });
    const address = this.#server.address();
    this.#port = typeof address === "object" && address !== null ? address.port : port;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (server === null) return;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
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

async function spawnClient(hostUrl: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", resolveLoader(), entry],
    cwd: repositoryRoot,
    env: childEnvironment(hostUrl),
    stderr: "inherit",
  });
  const client = new Client({ name: "narralens-stdio-case", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

const host = new FakeHost();
let loaderResolved = true;

beforeAll(async () => {
  try {
    resolveLoader();
  } catch {
    loaderResolved = false;
  }
  await host.start();
});

afterAll(async () => {
  await host.stop();
});

describe("A-MCP stdio façade", () => {
  it("advertises exactly the registry's tool allowlist over a real stdio transport", async () => {
    expect(loaderResolved, "tsx must be installed for the stdio case").toBe(true);
    const client = await spawnClient(host.baseUrl);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(exposedToolNames().slice().sort());
      expect(tools.tools).toHaveLength(24);

      // Four of the five registered resources are templates. The fifth is concrete
      // and is listed as a resource, not as a template.
      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates).toHaveLength(4);

      const resources = await client.listResources();
      expect(resources.resources).toHaveLength(1);
      expect(resources.resources[0]?.uri).toBe("narralens://services/health");
    } finally {
      await client.close();
    }
  }, STDIO_TIMEOUT_MS);

  it("reads the concrete health resource over the real transport", async () => {
    const client = await spawnClient(host.baseUrl);
    try {
      const result = await client.readResource({ uri: "narralens://services/health" });
      const first = result.contents[0] as { text?: string } | undefined;
      const payload = JSON.parse(first?.text ?? "{}");
      expect(payload.services?.[0]?.service_id).toBe("narralens-a");
      expect(payload.sample_interval_ms).toBe(5000);
      expect(payload.stale_after_ms).toBe(15000);
    } finally {
      await client.close();
    }
  }, STDIO_TIMEOUT_MS);

  it("reaches the host over http and returns the contract output", async () => {
    const before = host.requests.length;
    const client = await spawnClient(host.baseUrl);
    try {
      const result = await client.callTool({ name: "narralens_capabilities" });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(INSTANCE);

      const recorded = host.requests.slice(before);
      const call = recorded.find((request) => request.url.startsWith("/api/agent/v1/instance"));
      expect(call, "the façade must have reached the host").toBeDefined();
      expect(call?.method).toBe("GET");
    } finally {
      await client.close();
    }
  }, STDIO_TIMEOUT_MS);

  it("verifies the host's contract version before the first dispatch", async () => {
    const before = host.requests.length;
    const client = await spawnClient(host.baseUrl);
    try {
      const result = await client.callTool({
        name: "narralens_context_read",
        arguments: { project_id: "p1" },
      });
      expect(result.isError).toBeFalsy();

      const recorded = host.requests.slice(before).map((request) => request.url);
      expect(recorded[0]).toContain("/api/agent/v1/instance");
      expect(recorded.some((url) => url.startsWith("/api/agent/v1/projects/p1/context"))).toBe(true);
    } finally {
      await client.close();
    }
  }, STDIO_TIMEOUT_MS);

  it("reads a project resource through the host", async () => {
    const client = await spawnClient(host.baseUrl);
    try {
      const result = await client.readResource({ uri: "narralens://projects/p1/context" });
      const first = result.contents[0] as { text?: string } | undefined;
      const payload = JSON.parse(first?.text ?? "{}");
      expect(payload.project_id).toBe("p1");
      expect(payload.source_digest).toBe("a".repeat(64));
    } finally {
      await client.close();
    }
  }, STDIO_TIMEOUT_MS);

  it("rejects an invalid field without reaching the host", async () => {
    const before = host.requests.length;
    const client = await spawnClient(host.baseUrl);
    try {
      const result = await client.callTool({
        name: "narralens_context_read",
        arguments: { project_id: "p1", unexpected: 1 },
      });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { code: string }).code).toBe("INVALID_REQUEST");
      expect(host.requests.length).toBe(before);
    } finally {
      await client.close();
    }
  }, STDIO_TIMEOUT_MS);

  it("reports an unreachable host and recovers when the host returns", async () => {
    const port = host.port;
    await host.stop();
    const client = await spawnClient(`http://127.0.0.1:${port}`);
    try {
      const result = await client.callTool({ name: "narralens_capabilities" });
      expect(result.isError).toBe(true);
      const envelope = result.structuredContent as { code: string; retryable: boolean };
      expect(envelope.code).toBe("CAPABILITY_UNAVAILABLE");
      expect(envelope.retryable).toBe(true);
    } finally {
      await client.close();
    }

    // The Host comes back on the same address; a fresh client must work again.
    await host.start(port);
    const reconnected = await spawnClient(host.baseUrl);
    try {
      const result = await reconnected.callTool({ name: "narralens_capabilities" });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(INSTANCE);
    } finally {
      await reconnected.close();
    }
  }, STDIO_TIMEOUT_MS);

  it("refuses an unknown tool name", async () => {
    const client = await spawnClient(host.baseUrl);
    try {
      const result = await client.callTool({ name: "narralens_review_decide" });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { code: string }).code).toBe("INVALID_REQUEST");
    } finally {
      await client.close();
    }
  }, STDIO_TIMEOUT_MS);
});
