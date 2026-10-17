import { HttpError } from "../api-error.js";
import type { EngineBinding, EngineKind } from "../../contracts/engine-types.js";
import { RevisionStore } from "../projects/revision-store.js";

/**
 * EngineBindingStore (`03_M2_M4_MODULE_DESIGN.md` §1.2, AC-001).
 *
 * One project has exactly one writable engine. The guarantee is enforced by the schema,
 * not by application discipline: `engine_binding.project_id` is the primary key.
 *
 * M2.2 folded the table and its statements into `RevisionStore` so the Host owns exactly
 * one database. This class is the typed face of those statements; it holds no connection.
 */
export const HYPIT_UPSTREAM_SHA = "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf";
export const OPENFILM_UPSTREAM_SHA = "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3";

export function upstreamShaFor(engine: EngineKind): string {
  return engine === "hypit" ? HYPIT_UPSTREAM_SHA : OPENFILM_UPSTREAM_SHA;
}

export class EngineBindingStore {
  constructor(private readonly revisions: RevisionStore) {}

  /** Fails if a binding already exists: changing engine is a migration action, not an edit. */
  bind(projectId: string, engine: EngineKind, options: {
    engineUpstreamSha?: string;
    migratedFrom?: string | null;
    createdAt?: Date | string;
  } = {}): EngineBinding {
    if (typeof projectId !== "string" || projectId.length === 0) {
      throw new HttpError(400, "INVALID_REQUEST", "Invalid project identifier");
    }
    const sha = options.engineUpstreamSha ?? upstreamShaFor(engine);
    if (!/^[a-f0-9]{40}$/u.test(sha)) {
      throw new HttpError(500, "INTERNAL_ERROR", "Engine upstream sha must be a full 40-hex commit");
    }
    const migratedFrom = options.migratedFrom ?? null;
    if (this.read(projectId) !== undefined) {
      throw new HttpError(500, "TRANSACTION_FAILED", "ENGINE_BINDING_ALREADY_EXISTS");
    }
    try {
      this.revisions.bindEngine(projectId, engine, sha, migratedFrom,
        typeof options.createdAt === "string" ? options.createdAt : options.createdAt ?? new Date());
    } catch (error) {
      if (String(error).includes("UNIQUE") || String(error).includes("PRIMARY KEY")) {
        throw new HttpError(500, "TRANSACTION_FAILED", "ENGINE_BINDING_ALREADY_EXISTS");
      }
      throw error;
    }
    return this.require(projectId);
  }

  read(projectId: string): EngineBinding | undefined {
    return this.revisions.readEngineBinding(projectId) as EngineBinding | undefined;
  }

  require(projectId: string, expectedUpstreamSha?: string, correlationId?: string): EngineBinding {
    const found = this.read(projectId);
    if (!found) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "Project has no engine binding; the engine is not guessed", undefined, correlationId);
    }
    if (expectedUpstreamSha !== undefined && found.engine_upstream_sha !== expectedUpstreamSha) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "Engine binding does not match the engine's current pinned upstream", undefined, correlationId);
    }
    return found;
  }

  all(): EngineBinding[] { return this.revisions.allEngineBindings() as EngineBinding[]; }
}
