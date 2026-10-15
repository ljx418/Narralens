import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

import { NarralensHost } from "../../src/host/server.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

const fixtureRoot = process.env.D421_FIXTURE_ROOT;
if (!fixtureRoot) throw new Error("D421_FIXTURE_ROOT is required");
const root = resolve(fixtureRoot);
await mkdir(resolve(root, ".narralens"), { recursive: true });
const catalog = new ProjectCatalog(new Map([["d1-30s", resolve(root, "narralens.project.json")]]));
const host = new NarralensHost({ catalog, revisionStore: new RevisionStore(resolve(root, ".narralens/browser-evidence.sqlite")) });
const port = await host.listen(Number.parseInt(process.env.D421_PORT ?? "4174", 10));
process.stdout.write(`${JSON.stringify({ status: "ready", origin: `http://127.0.0.1:${port}` })}\n`);

let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await host.close();
  process.exit(0);
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void close(); });
