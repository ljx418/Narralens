#!/usr/bin/env node
/**
 * Probe the Narralens MCP façade over a real stdio transport.
 *
 * This is the client half of the A-MCP evidence: it spawns the façade exactly the
 * way an MCP client would, connects with the SDK's own `Client`, and prints what
 * the façade advertises. It is a *discovery* probe — it does not call any business
 * tool, so it needs a running Host only if the Host is required for the handshake
 * (it is not: listing tools is answered by the façade alone).
 *
 * Usage:
 *   node tools/agent-driven/bridge/probe-mcp.mjs [--json]
 *
 * The output is JSON on stdout: the tool names, the resource templates and the
 * façade's own version. It is a description of the *protocol surface*, not proof
 * that the Host answered.
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..", "..", "..");

const require = createRequire(import.meta.url);
let loader;
try {
  loader = require.resolve("tsx/esm");
} catch {
  process.stderr.write(
    "probe-mcp: the repository dependencies are not installed. "
    + "Run 'pnpm install --offline --frozen-lockfile' in the repository root first.\n",
  );
  process.exit(1);
}

const client = new Client({ name: "narralens-probe", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", loader, resolve(repositoryRoot, "src", "mcp", "stdio-main.ts")],
  cwd: repositoryRoot,
  env: process.env,
  stderr: "inherit",
});

await client.connect(transport);

try {
  const tools = await client.listTools();
  const templates = await client.listResourceTemplates();
  const resources = await client.listResources();
  const report = {
    server: client.getServerVersion(),
    tool_count: tools.tools.length,
    tool_names: tools.tools.map((tool) => tool.name).sort(),
    resource_template_count: templates.resourceTemplates.length,
    resource_templates: templates.resourceTemplates.map((template) => template.uriTemplate).sort(),
    resource_count: resources.resources.length,
    resources: resources.resources.map((resource) => resource.uri).sort(),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await client.close();
}
