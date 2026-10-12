import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ProjectResponse } from "../../contracts/types.js";
import { HttpError } from "../../host/api-error.js";
import { ProjectCatalog } from "../../host/projects/project-catalog.js";

export interface HypitReadResult { project: ProjectResponse; run_sha256: string }

export class HypitReadAdapter {
  constructor(private readonly catalog: ProjectCatalog) {}

  async readProject(projectId: string): Promise<HypitReadResult> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    const root = await realpath(this.catalog.descriptorRoot(projectId));
    const runPath = await realpath(resolve(root, descriptor.run_file));
    if (!runPath.startsWith(`${root}${sep}`)) throw new HttpError(400, "INVALID_REQUEST", "Run descriptor escaped project root");
    const run = await readFile(runPath);
    const { run_file: _runFile, ...project } = descriptor;
    return { project, run_sha256: createHash("sha256").update(run).digest("hex") };
  }
}
