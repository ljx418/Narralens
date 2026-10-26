import { readFile } from "node:fs/promises";
import { startOn, postRestore } from "./harness.js";

/**
 * Deliberately tiny child-process driver for the process-loss gate.
 *
 * `process.exit(86)` is intentional: it prevents every catch/finally/close hook in the
 * Host from running.  The parent test then opens the same durable directory as a new
 * process would and judges recovery from disk alone.
 */
const [base, projectId, requestPath, boundary] = process.argv.slice(2);
if (!base || !projectId || !requestPath || !boundary) process.exit(64);

const request = JSON.parse(await readFile(requestPath, "utf8")) as unknown;
const running = await startOn(base, { historyFault: (at) => {
  if (at === boundary) process.exit(86);
} });

// A returned response means the requested boundary was not reached.  Never report that as
// a crash pass; use a distinct exit code so the parent gives a useful error.
await postRestore(running, projectId, request);
process.exit(87);
