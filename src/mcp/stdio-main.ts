#!/usr/bin/env node
/**
 * The stdio MCP server executable (BRIDGE / E07).
 *
 * This is what an MCP client spawns. It speaks JSON-RPC over stdin/stdout and
 * nothing else: **stdout belongs to the protocol**. A stray `console.log` anywhere in
 * this process would corrupt the stream, so every diagnostic in this file goes to
 * stderr.
 *
 * The Host is reached over local HTTP. Its address comes from the environment:
 *
 * - `NARRALENS_HOST_URL` — the Host's base URL (default `http://127.0.0.1:4173`,
 *   the port the existing Host listens on). It must be a loopback address; the
 *   client refuses anything else before it makes a request.
 * - `NARRALENS_HOST_TOKEN` — an optional bearer token. MAIN owns authentication;
 *   the façade forwards what it is given and never invents or logs a credential.
 * - `NARRALENS_FILTER_DIGEST` — the filter digest the events-snapshot resource uses
 *   when its URI carries none. It is MAIN's policy value, so it is not defaulted
 *   here: without it the discovery and read tools work, and the events-snapshot
 *   resource answers with a configuration failure that names the missing value.
 *
 * The credentials live in the environment rather than in a file so that a client can
 * pass them per-spawn, and so that nothing has to be written to disk to run the
 * façade.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHostApplicationPorts } from "./host-application-ports.js";
import { createMcpServer } from "./mcp-server.js";

const baseUrl = process.env["NARRALENS_HOST_URL"] ?? "http://127.0.0.1:4173";
const token = process.env["NARRALENS_HOST_TOKEN"];
const filterDigest = process.env["NARRALENS_FILTER_DIGEST"];

const ports = createHostApplicationPorts({
  baseUrl,
  headers: () => (token === undefined || token.length === 0 ? {} : { authorization: `Bearer ${token}` }),
});

const server = createMcpServer({
  ports,
  ...(filterDigest === undefined || filterDigest.length === 0 ? {} : { filterDigest }),
});
const transport = new StdioServerTransport();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}

await server.connect(transport);
