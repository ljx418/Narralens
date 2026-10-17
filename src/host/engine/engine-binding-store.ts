import { DatabaseSync } from "node:sqlite";
import { HttpError } from "../api-error.js";
import type { EngineBinding, EngineKind } from "../../contracts/engine-types.js";

/**
 * EngineBindingStore (`03_M2_M4_MODULE_DESIGN.md` §1.2, AC-001).
 *
 * One project has exactly one writable engine. The guarantee is enforced by the schema,
 * not by application discipline: `engine_binding.project_id` is the primary key, so a
 * second binding for the same project cannot be written at all.
 *
 * A binding is written when a project is created or migrated and is never changed by an
 * ordinary edit. `migrateTo()` deliberately does not exist in M2.1 — its only trigger is
 * the M2.3 `migrate-copy` route, which stays closed (ADR D-08).
 */

const SHA_PATTERN = /^[a-f0-9]{40}$/u;

export const HYPIT_UPSTREAM_SHA = "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf";
export const OPENFILM_UPSTREAM_SHA = "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3";

export function upstreamShaFor(engine: EngineKind): string {
  return engine === "hypit" ? HYPIT_UPSTREAM_SHA : OPENFILM_UPSTREAM_SHA;
}

export class EngineBindingStore {
  readonly #db: DatabaseSync;

  constructor(path = ":memory:") {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS engine_binding (
        project_id TEXT PRIMARY KEY,
        engine TEXT NOT NULL CHECK (engine IN ('hypit','openfilm')),
        engine_upstream_sha TEXT NOT NULL,
        binding_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        migrated_from TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS engine_binding_single_active
        ON engine_binding (project_id) WHERE project_id IS NOT NULL;
    `);
  }

  /**
   * Write the one binding for a project. Fails if a binding already exists: changing the
   * engine of a project is a migration/activation action, never an ordinary edit.
   */
  bind(projectId: string, engine: EngineKind, options: {
    engineUpstreamSha?: string;
    migratedFrom?: string | null;
    createdAt?: string;
  } = {}): EngineBinding {
    if (typeof projectId !== "string" || projectId.length === 0) {
      throw new HttpError(400, "INVALID_REQUEST", "Invalid project identifier");
    }
    const sha = options.engineUpstreamSha ?? upstreamShaFor(engine);
    if (!SHA_PATTERN.test(sha)) {
      throw new HttpError(500, "INTERNAL_ERROR", "Engine upstream sha must be a full 40-hex commit");
    }
    const createdAt = options.createdAt ?? new Date().toISOString();
    const migratedFrom = options.migratedFrom ?? null;
    try {
      this.#db.prepare(`INSERT INTO engine_binding(
        project_id, engine, engine_upstream_sha, binding_version, created_at, migrated_from)
        VALUES(?,?,?,1,?,?)`).run(projectId, engine, sha, createdAt, migratedFrom);
    } catch (error) {
      if (String(error).includes("UNIQUE") || String(error).includes("PRIMARY KEY")) {
        throw new HttpError(500, "TRANSACTION_FAILED", "ENGINE_BINDING_ALREADY_EXISTS");
      }
      throw error;
    }
    return { project_id: projectId, engine, engine_upstream_sha: sha, binding_version: 1,
      created_at: createdAt, migrated_from: migratedFrom };
  }

  /** At most one row, because `project_id` is the primary key. */
  read(projectId: string): EngineBinding | undefined {
    const row = this.#db.prepare(`SELECT project_id, engine, engine_upstream_sha, binding_version, created_at, migrated_from
      FROM engine_binding WHERE project_id=?`).get(projectId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : binding(row);
  }

  /**
   * A missing binding, or one whose pinned upstream no longer matches, is an attention
   * condition. Neither case falls back to a guessed default engine (`03:15`).
   */
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

  all(): EngineBinding[] {
    return (this.#db.prepare("SELECT * FROM engine_binding ORDER BY project_id").all() as Array<Record<string, unknown>>)
      .map(binding);
  }

  close(): void { this.#db.close(); }
}

function binding(row: Record<string, unknown>): EngineBinding {
  return {
    project_id: String(row.project_id),
    engine: String(row.engine) as EngineKind,
    engine_upstream_sha: String(row.engine_upstream_sha),
    binding_version: Number(row.binding_version),
    created_at: String(row.created_at),
    migrated_from: row.migrated_from === null || row.migrated_from === undefined ? null : String(row.migrated_from),
  };
}
