import { HttpError } from "../api-error.js";
import type { EngineKind } from "../../contracts/engine-types.js";
import { EngineBindingStore } from "./engine-binding-store.js";
import type { EnginePort } from "./engine-port.js";

/**
 * Resolves the one writable engine for a project (AC-001).
 *
 * There is exactly one `EnginePort` per `EngineKind`, and a project resolves through its
 * single binding. Nothing here can hand out two engines for one project, and a project
 * with no binding, or one whose pinned upstream no longer matches, becomes an attention
 * condition rather than falling back to a default.
 */
export class EngineRegistry {
  readonly #ports = new Map<EngineKind, EnginePort>();
  readonly #bindings: EngineBindingStore;

  constructor(bindings: EngineBindingStore, ports: Partial<Record<EngineKind, EnginePort>> = {}) {
    this.#bindings = bindings;
    for (const [kind, port] of Object.entries(ports)) this.#ports.set(kind as EngineKind, port);
  }

  register(kind: EngineKind, port: EnginePort): void {
    if (this.#ports.has(kind)) throw new Error(`ENGINE_ALREADY_REGISTERED:${kind}`);
    this.#ports.set(kind, port);
  }

  kinds(): EngineKind[] { return [...this.#ports.keys()]; }

  /** The one engine this project may write through. Throws rather than guessing. */
  resolve(projectId: string, correlationId?: string): { engine: EngineKind; port: EnginePort; binding: ReturnType<EngineBindingStore["read"]> } {
    const binding = this.#bindings.require(projectId, undefined, correlationId);
    const port = this.#ports.get(binding.engine);
    if (!port) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE",
        `Engine ${binding.engine} is bound but not installed in this Host`, undefined, correlationId);
    }
    return { engine: binding.engine, port, binding };
  }

  /** Re-check the pinned upstream on every read, so drift becomes attention (fitness rule 14). */
  resolveVerified(projectId: string, expectedUpstreamSha: string, correlationId?: string) {
    const resolved = this.resolve(projectId, correlationId);
    const binding = this.#bindings.require(projectId, expectedUpstreamSha, correlationId);
    return { ...resolved, binding };
  }
}
