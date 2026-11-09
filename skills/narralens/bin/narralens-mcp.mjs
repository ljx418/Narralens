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
 * **The streams are wired by hand, and that matters.** The wrapper and the server
 * must not read the same input: if the wrapper inherited the client's stdin *and*
 * read it, the two consumers would split the JSON-RPC stream between them and the
 * client would see truncated messages. So the wrapper gives the child its own pipe
 * for stdin, forwards the client's stdin into it, and copies the child's output
 * streams back out. The wrapper never interprets a byte of the protocol.
 *
 * The wrapper owns exactly one thing: the child process it started. It forwards the
 * signals it receives, it shuts the child down when the client's stream ends — that
 * is what a disconnect looks like from here — and it never touches anything else. In
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
const entry = resolve(repositoryRoot, "src", "mcp", "stdio-main.ts");

/** How long a politely stopped child is given before it is killed outright. */
const SHUTDOWN_GRACE_MS = 2000;

const require = createRequire(import.meta.url);
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

const child = spawn(process.execPath, ["--import", loader, entry], {
  cwd: repositoryRoot,
  env: process.env,
  // Pipes, not "inherit": the wrapper needs its own handles on the child's streams
  // so it can forward them without competing for the client's input.
  stdio: ["pipe", "pipe", "pipe"],
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
process.stdin.pipe(child.stdin);

let stopping = false;

/**
 * Stop the child this wrapper started, and only this child.
 *
 * A polite stop first, then an unconditional kill if the child has not gone after
 * the grace period: a server that ignores `SIGTERM` must not outlive its client.
 */
function stopChild() {
  if (stopping) return;
  stopping = true;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, SHUTDOWN_GRACE_MS);
  timer.unref();
}

child.on("error", (error) => {
  process.stderr.write(`narralens-mcp: the server could not be started (${error.message}).\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.exit(signal === null ? (code ?? 0) : 1);
});

// The client closed the pipe, or the wrapper was asked to stop. Either way the
// child goes with it; without this the stdio server would survive as an orphan
// with nobody to talk to.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChild();
  });
}
process.on("exit", () => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
});
process.stdin.on("end", () => stopChild());
process.stdin.on("close", () => stopChild());
process.stdin.on("error", () => stopChild());
