#!/usr/bin/env node
/**
 * Spawn the Narralens stdio MCP server.
 *
 * An MCP client can run this directly:
 *
 *   { "command": "node", "args": ["<repo>/skills/narralens/bin/narralens-mcp.mjs"] }
 *
 * It exists so the client does not have to know where the repository is or how the
 * TypeScript sources are loaded. The server itself is `src/mcp/stdio-main.ts`, which
 * is TypeScript and is loaded with the repository's own `tsx`.
 *
 * stdout is inherited unchanged: the JSON-RPC stream must not be interleaved with
 * anything. Diagnostics go to stderr.
 *
 * The wrapper owns exactly one thing: the child process it started. It forwards the
 * signals it receives, it kills the child when its own stdin closes — that is what
 * a client disconnect looks like from here — and it never touches anything else. In
 * particular, shutting the façade down does **not** stop the Host: the Host is a
 * separate process with its own lifetime, and an Agent session ending is not a
 * reason to take the Host down with it.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..", "..", "..");
/**
 * The server entry.
 *
 * `NARRALENS_MCP_ENTRY` is a local override, used by the lane's own case to point
 * the wrapper at a script it can observe. It is not part of the client's contract.
 */
const entry = process.env.NARRALENS_MCP_ENTRY ?? resolve(repositoryRoot, "src", "mcp", "stdio-main.ts");

const require = createRequire(import.meta.url);

/**
 * The command that starts the server.
 *
 * A TypeScript entry is loaded with the repository's own `tsx`; a JavaScript entry
 * runs directly. The distinction matters for the wrapper's own behaviour: a
 * JavaScript entry needs nothing installed, so the wrapper can be exercised
 * without the repository's dependencies.
 */
function serverCommand() {
  if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) {
    return [entry];
  }
  let loader;
  try {
    loader = require.resolve("tsx/esm");
  } catch {
    process.stderr.write(
      "narralens-mcp: the repository dependencies are not installed. "
      + "Run 'pnpm install --offline --frozen-lockfile' in the repository root first.\n",
    );
    process.exit(1);
  }
  return ["--import", loader, entry];
}

const child = spawn(process.execPath, serverCommand(), {
  cwd: repositoryRoot,
  stdio: "inherit",
  env: process.env,
});

let stopping = false;

/** Stop the child this wrapper started, and only this child. */
function stopChild(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}

child.on("error", (error) => {
  process.stderr.write(`narralens-mcp: the server could not be started (${error.message}).\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.exit(signal === null ? (code ?? 0) : 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChild(signal);
  });
}

// The client closed the pipe. Without this the stdio server would survive as an
// orphan with nobody to talk to.
process.stdin.on("end", () => stopChild("SIGTERM"));
process.stdin.on("close", () => stopChild("SIGTERM"));
process.stdin.resume();
