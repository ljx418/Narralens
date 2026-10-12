import { NarralensHost } from "./server.js";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { RevisionStore } from "./projects/revision-store.js";

mkdirSync(resolve("var"), { recursive: true });
const databasePath = process.env.NARRALENS_DB_PATH ? resolve(process.env.NARRALENS_DB_PATH) : resolve("var/narralens.sqlite");
const host = new NarralensHost({ revisionStore: new RevisionStore(databasePath) });
const port = await host.listen(Number.parseInt(process.env.NARRALENS_PORT ?? "4173", 10));
process.stdout.write(`Narralens listening on http://127.0.0.1:${port}\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void host.close().then(() => process.exit(0)); });
