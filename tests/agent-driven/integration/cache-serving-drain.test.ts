import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPinnedOpenFilmFolderServer } from "../../../src/adapters/openfilm/openfilm-upstream.js";
import { vendorRoot } from "./helpers/created-project-fixture.js";

/**
 * The drain of the parent of a draw.
 *
 * The serving of a project folder holds resources of its own: the HTTP requests
 * it answers, the REAL SOURCES it streams into the responses, and the media
 * probes it starts. The end of a draw is not the end of those: the end of a draw
 * is the end of the EXECUTION, and the parent still has to finish what it
 * started.
 *
 * These cases are NOT RUN in the 060P1R wave: the wave that released this file
 * allowed the identity, the scheduler and the static gates only. They need the
 * pinned upstream and a loopback listener, and they run under the exact P2a
 * resource ticket.
 */

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project folder with a file in it. */
function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "narralens-serving-drain-"));
  roots.push(root);
  writeFileSync(join(root, "page.html"), "<!doctype html><title>page</title>", "utf8");
  writeFileSync(join(root, "movie.mp4"), Buffer.alloc(4096, 7), "utf8");
  return root;
}

/** The serving of that folder, on a loopback listener of its own. */
async function servingOf(root: string): Promise<{
  readonly origin: string;
  readonly pending: () => number;
  readonly freeze: () => void;
  readonly open: () => void;
  readonly drain: () => Promise<{ readonly open: number }>;
}> {
  const folder = await createPinnedOpenFilmFolderServer(vendorRoot, root);
  let port = 0;
  const server = createServer((req, res) => { folder.handle(req, res); });
  servers.push(server);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the serving has no port");
  port = address.port;
  return {
    origin: `http://127.0.0.1:${port}`,
    pending: () => folder.pending(),
    freeze: () => folder.freezeAdmission(),
    open: () => folder.openAdmission(),
    drain: () => folder.drain(),
  };
}

describe("the drain of the parent of a draw", () => {
  it("refuses a new request after the freeze, and answers it again after the reopen", async () => {
    const root = projectRoot();
    const serving = await servingOf(root);
    // Before the freeze the origin answers.
    const before = await fetch(`${serving.origin}/page.html`);
    expect(before.status).toBe(200);
    expect(await before.text()).toContain("page");
    // The freeze is SYNCHRONOUS and it refuses WITHOUT touching the project: the
    // answer is bounded and the file is not opened.
    serving.freeze();
    const refused = await fetch(`${serving.origin}/page.html`);
    expect(refused.status).toBe(503);
    // The next draw opens the admission again, explicitly.
    serving.open();
    const again = await fetch(`${serving.origin}/page.html`);
    expect(again.status).toBe(200);
  });

  it("waits for the real close of the source of an answer", async () => {
    const root = projectRoot();
    const serving = await servingOf(root);
    const answer = await fetch(`${serving.origin}/movie.mp4`);
    expect(answer.status).toBe(200);
    // The source of the answer is a real stream with its own descriptor: the end
    // of the RESPONSE is not the end of the SOURCE, and the drain waits for the
    // source.
    const settlement = await serving.drain();
    expect(settlement.open).toBe(0);
    expect(serving.pending()).toBe(0);
  });

  it("keeps the listener up while the accepted resources are drained", async () => {
    const root = projectRoot();
    const serving = await servingOf(root);
    const answer = await fetch(`${serving.origin}/movie.mp4`);
    expect(answer.status).toBe(200);
    serving.freeze();
    // The listener is still there: a request that was accepted keeps its origin.
    const refused = await fetch(`${serving.origin}/movie.mp4`);
    expect(refused.status).toBe(503);
    const settlement = await serving.drain();
    expect(settlement.open).toBe(0);
  });
});
