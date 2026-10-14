import { resolve } from "node:path";
import { ProjectCatalog } from "./projects/project-catalog.js";
import { ProjectWriteActor } from "./projects/project-write-actor.js";
import { InMemoryProjectOperationQueue } from "./projects/project-operation-queue.js";
import { RevisionStore } from "./projects/revision-store.js";
import { AssetImportService } from "./assets/asset-import-service.js";

const projectId = process.argv[2];
if (!projectId || process.argv.length !== 3) {
  process.stderr.write("usage: pnpm recover <project-id>\n");
  process.exitCode = 2;
} else {
  const databasePath = process.env.NARRALENS_DB_PATH ? resolve(process.env.NARRALENS_DB_PATH) : resolve("var/narralens.sqlite");
  const store = new RevisionStore(databasePath);
  try {
    const catalog = new ProjectCatalog();
    const operations = new InMemoryProjectOperationQueue();
    const actor = new ProjectWriteActor(catalog, store, undefined, operations);
    const imports = new AssetImportService(catalog, actor.assets, store, operations);
    const before = store.incomplete().filter((record) => record.project_id === projectId).length
      + store.incompleteAssetImports().filter((record) => record.project_id === projectId).length;
    await imports.recoverIncomplete(projectId);
    await actor.recoverIncomplete(projectId);
    const after = store.incomplete().filter((record) => record.project_id === projectId).length
      + store.incompleteAssetImports().filter((record) => record.project_id === projectId).length;
    const state = await actor.projectState(projectId);
    process.stdout.write(`${JSON.stringify({ project_id: projectId, evaluated: before, remaining: after, state })}\n`);
    if (after > 0 || state.attention) process.exitCode = 1;
  } finally { store.close(); }
}
