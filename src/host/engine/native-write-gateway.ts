import { HttpError } from "../api-error.js";
import type { CapabilityMap, TypedEdit } from "../../contracts/engine-types.js";
import {
  NativeMutationRegistry, type NativeMutationEntry, type NativePolicy,
} from "./native-mutation-registry.js";

/**
 * NativeWriteGateway (`03_M2_M4_MODULE_DESIGN.md` §1.4, AC-003).
 *
 * The only translator between a native entry point and a Narralens typed edit. Behaviour:
 *
 * - known + `translated`               -> a `TypedEdit` for the Host's existing write path
 * - known + `translated_host_service`  -> dispatch to the Host asset service (no film revision)
 * - known + `blocked`                  -> 422 `UNSUPPORTED_EDIT` with the recorded reason
 * - known + `read_only`                -> passes with no side effect
 * - unknown                            -> denied by default and recorded as a security event
 *
 * Disabling a button is not governance; every bypass must be refused here as well.
 */

export const NATIVE_WRITE_DENIED_EVENT = "native_write_denied";

export interface NativeWriteRequest {
  readonly entry_id: string;
  readonly transport?: string;
  readonly shot_id?: string;
  readonly asset_id?: string;
  readonly value?: "contain" | "cover";
}

export type GatewayDecision =
  | { readonly kind: "translated"; readonly entry: NativeMutationEntry; readonly edit: TypedEdit }
  | { readonly kind: "translated_host_service"; readonly entry: NativeMutationEntry; readonly asset_id: string }
  | { readonly kind: "read_only"; readonly entry: NativeMutationEntry }
  | { readonly kind: "blocked"; readonly entry: NativeMutationEntry; readonly status: 422; readonly code: "UNSUPPORTED_EDIT"; readonly reason: string }
  | { readonly kind: "denied"; readonly status: 422; readonly code: "UNSUPPORTED_EDIT"; readonly reason: string; readonly security_event: typeof NATIVE_WRITE_DENIED_EVENT };

export interface SecurityEvent {
  readonly event: typeof NATIVE_WRITE_DENIED_EVENT;
  readonly entry_id: string;
  readonly transport: string;
  readonly reason: string;
}

const MAX_EVENTS = 64;

export class NativeWriteGateway {
  readonly #events: SecurityEvent[] = [];
  readonly #registry: NativeMutationRegistry;

  constructor(registry: NativeMutationRegistry = new NativeMutationRegistry()) {
    this.#registry = registry;
  }

  /**
   * Decide without throwing so callers can render a reason, and so the deny path is
   * testable in isolation from HTTP.
   */
  decide(request: NativeWriteRequest, capabilities?: CapabilityMap): GatewayDecision {
    const entry = this.#registry.find(request.entry_id);
    const transport = request.transport ?? entry?.transport ?? "unknown";

    if (!entry) {
      const decision: GatewayDecision = {
        kind: "denied", status: 422, code: "UNSUPPORTED_EDIT", reason: "Unregistered native entry point",
        security_event: NATIVE_WRITE_DENIED_EVENT,
      };
      this.#record({ event: NATIVE_WRITE_DENIED_EVENT, entry_id: request.entry_id, transport,
        reason: "unregistered native entry point" });
      return decision;
    }

    // A capability the engine reports as unverified is refused regardless of policy
    // (`03_M2_M4_MODULE_DESIGN.md:11`: production write paths do not allow `unverified`).
    const reported = capabilities?.entries[entry.entry_id];
    if (reported?.state === "unverified") {
      this.#record({ event: NATIVE_WRITE_DENIED_EVENT, entry_id: entry.entry_id, transport,
        reason: "capability is unverified" });
      return { kind: "blocked", entry, status: 422, code: "UNSUPPORTED_EDIT",
        reason: `Capability is unverified for ${entry.entry_id}` };
    }

    return this.#translate(entry, request, transport);
  }

  /** Same decision as `decide`, surfaced as an `HttpError` for the request path. */
  enforce(request: NativeWriteRequest, capabilities?: CapabilityMap): Exclude<GatewayDecision, { kind: "translated" } | { kind: "translated_host_service" } | { kind: "read_only" }> {
    const decision = this.decide(request, capabilities);
    if (decision.kind === "translated" || decision.kind === "translated_host_service" || decision.kind === "read_only") {
      throw new Error(`GATEWAY_ENFORCE_ON_PERMITTED_DECISION:${decision.kind}`);
    }
    return decision;
  }

  #translate(entry: NativeMutationEntry, request: NativeWriteRequest, transport: string): GatewayDecision {
    switch (entry.policy as NativePolicy) {
      case "translated": {
        if (entry.typed_intent === "set_visual_fit") {
          if (!request.shot_id || !request.value) return this.#invalid(entry, "set_visual_fit requires shot_id and value");
          return { kind: "translated", entry, edit: { op: "set_visual_fit", shot_id: request.shot_id, value: request.value } };
        }
        if (entry.typed_intent === "replace_visual_asset") {
          if (!request.shot_id || !request.asset_id) return this.#invalid(entry, "replace_visual_asset requires shot_id and asset_id");
          return { kind: "translated", entry, edit: { op: "replace_visual_asset", shot_id: request.shot_id, asset_id: request.asset_id } };
        }
        return this.#invalid(entry, "translated entry has no typed intent");
      }
      case "translated_host_service": {
        if (!request.asset_id) return this.#invalid(entry, "host service entry requires asset_id");
        return { kind: "translated_host_service", entry, asset_id: request.asset_id };
      }
      case "read_only":
        return { kind: "read_only", entry };
      case "blocked":
      default:
        this.#record({ event: NATIVE_WRITE_DENIED_EVENT, entry_id: entry.entry_id, transport, reason: entry.reason });
        return { kind: "blocked", entry, status: 422, code: "UNSUPPORTED_EDIT", reason: entry.reason };
    }
  }

  #invalid(entry: NativeMutationEntry, reason: string): GatewayDecision {
    return { kind: "blocked", entry, status: 422, code: "UNSUPPORTED_EDIT", reason };
  }

  #record(event: SecurityEvent): void {
    this.#events.push(event);
    if (this.#events.length > MAX_EVENTS) this.#events.splice(0, this.#events.length - MAX_EVENTS);
  }

  /** Diagnostics only. Discards on restart; it is never a durable fact. */
  securityEvents(): readonly SecurityEvent[] { return [...this.#events]; }

  deniedCount(): number { return this.#events.length; }

  toHttpError(decision: GatewayDecision, correlationId?: string): HttpError {
    if (decision.kind === "denied") {
      return new HttpError(decision.status, decision.code, decision.reason, { entry_id: "unregistered" }, correlationId);
    }
    if (decision.kind === "blocked") {
      return new HttpError(decision.status, decision.code, decision.reason, { entry_id: decision.entry.entry_id }, correlationId);
    }
    throw new Error(`GATEWAY_DECISION_NOT_REFUSABLE:${decision.kind}`);
  }
}
