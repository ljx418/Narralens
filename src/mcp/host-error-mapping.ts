/**
 * Host error mapping for the MCP façade (BRIDGE / E07).
 *
 * The Host answers with the contract's `Error` envelope. The MCP façade has to
 * present that envelope to the client *as* the contract's `Error` envelope, with the
 * same code, the same status and the same meaning — an Agent that reads
 * `CURSOR_EXPIRED` must be able to resynchronise, and one that reads a generic
 * failure must not be tempted to retry a request that will fail the same way.
 *
 * Four failure sources are distinguished:
 *
 * 1. **The Host answered with a contract error.** Its code, status, retryability
 *    and next actions are kept as they are. The façade does not recompute them:
 *    the Host knows more about a failure than the façade does, and a façade that
 *    second-guesses "retryable" would talk a client into repeating a request the
 *    Host has already refused.
 * 2. **The Host answered with something else** (an older route, a proxy page, an
 *    HTML error). The status is mapped to the closest contract code and the body is
 *    not echoed.
 * 3. **The Host did not answer at all.** For a read, that is a retryable
 *    `CAPABILITY_UNAVAILABLE`: the request demonstrably did not take effect.
 * 4. **A write's outcome is unknown.** A write that timed out, whose response
 *    body could not be read, or that came back off-contract, may or may not have
 *    been applied. That is *not* a failure and it is *not* a success, and it is
 *    never reported as a retryable one: the client has to reconcile the original
 *    idempotency key against the Host's facts before it does anything else.
 *
 * Messages are sanitised before they leave this module: an error body is read by an
 * LLM, and a local absolute path or an outbound URL in it is a leak.
 */

import type { Error as AgentError } from "../contracts/agent-driven-types.js";
import { validateAgentDefinition } from "../contracts/agent-driven-validator.js";
import { AGENT_ERROR_CODES, errorCodeForStatus, statusForErrorCode } from "./registry-view.js";

/** Codes for which retrying the same request can succeed. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "CAPABILITY_UNAVAILABLE",
  "HOST_RESOURCE_EXHAUSTED",
  "INTERNAL_ERROR",
]);

/** What a client should do next, per code. */
const NEXT_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  INVALID_REQUEST: ["fix_request_payload"],
  UNAUTHORIZED: ["refresh_credentials"],
  ORIGIN_REJECTED: ["resync_snapshot"],
  NOT_FOUND: ["check_identifier"],
  REVISION_CONFLICT: ["reload_current_state"],
  IDEMPOTENCY_CONFLICT: ["use_new_idempotency_key"],
  TARGET_LOCKED: ["wait_for_unlock"],
  IMPACT_REQUIRED: ["request_impact_review"],
  IMPACT_STALE: ["recompute_impact"],
  APPROVAL_REQUIRED: ["obtain_trusted_approval"],
  CAPABILITY_UNAVAILABLE: ["retry_after_backoff", "check_host_reachable"],
  HOST_RESOURCE_EXHAUSTED: ["retry_after_backoff"],
  CURSOR_EXPIRED: ["resync_snapshot"],
  INTERNAL_ERROR: ["check_host_logs", "retry_after_backoff"],
  PAYLOAD_TOO_LARGE: ["reduce_payload_size"],
  RUN_SCOPE_REQUIRED: ["obtain_run_scope"],
  RUN_GATE_BLOCKED: ["await_gate_decision"],
  RUN_PLAN_STALE: ["reload_run_plan"],
  REVIEW_STALE: ["reload_review_package"],
  NATIVE_ACK_STALE: ["reload_native_state"],
  PROVIDER_RESULT_UNKNOWN: ["reconcile_by_idempotency_key", "read_back_before_retry"],
};

export interface AgentErrorInput {
  readonly code: string;
  readonly message: string;
  readonly correlation_id: string;
  readonly retryable?: boolean;
  readonly next_actions?: readonly string[];
}

/** A path with at least two segments, so `/tmp` alone is not noisy but `/a/b` is. */
const ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\/)[^\s'"`,;:()\[\]]*[^\s'"`,;:()\[\]\s]/gu;
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`]+/giu;
const MESSAGE_LIMIT = 400;

/**
 * Remove what must not be echoed, keep what identifies the failure.
 *
 * This is deliberately *narrower* than the Host's diagnostics redactor
 * (`src/host/host-diagnostics.ts`), which additionally collapses every run of 24 or
 * more word characters. That rule is right for a bounded diagnostic ring — it is
 * where an opaque token might be pasted — but wrong here: a diagnostic-shaped
 * message such as `cursor_outside_retention_window` is exactly the reason a client
 * needs, and replacing it with `<redacted>` would leave the Agent guessing. Paths and
 * URLs are removed; the words are kept.
 */
export function sanitizeMessage(message: string): string {
  const withoutUrls = message.replace(URL_LIKE, "<url>");
  const withoutPaths = withoutUrls.replace(ABSOLUTE_PATH, "<path>");
  return withoutPaths.length > MESSAGE_LIMIT
    ? `${withoutPaths.slice(0, MESSAGE_LIMIT)}…`
    : withoutPaths;
}

/**
 * Build the contract error envelope.
 *
 * The envelope is validated against the frozen schema before it is returned, so a
 * malformed code or an over-long message fails here rather than on the wire.
 */
export function buildAgentError(input: AgentErrorInput): AgentError {
  const code = AGENT_ERROR_CODES.has(input.code) ? input.code : "INTERNAL_ERROR";
  const status = statusForErrorCode(code) ?? 500;
  const message = sanitizeMessage(input.message).slice(0, 400) || "The request could not be completed.";
  const nextActions = input.next_actions ?? NEXT_ACTIONS[code] ?? [];
  const error = {
    schema_version: "agent.v1" as const,
    correlation_id: input.correlation_id,
    code,
    http_status: status as AgentError["http_status"],
    message,
    retryable: input.retryable ?? RETRYABLE_CODES.has(code),
    next_actions: [...nextActions].slice(0, 8),
  };
  return validateAgentDefinition<AgentError>("Error", error);
}

/**
 * Translate a Host response into the contract error envelope.
 *
 * `body` is whatever the Host sent. It is inspected, never echoed.
 *
 * When the body is a contract error envelope, its own `retryable` and
 * `next_actions` are kept. Only the code and the status are checked against the
 * contract, because those are the two things the contract pins.
 */
export function errorFromHostResponse(
  status: number,
  body: unknown,
  correlationId: string,
): AgentError {
  const candidate = body as {
    code?: unknown;
    message?: unknown;
    correlation_id?: unknown;
    next_actions?: unknown;
    retryable?: unknown;
  } | null;
  const bodyCode = typeof candidate?.code === "string" ? candidate.code : null;
  const bodyMessage = typeof candidate?.message === "string" ? candidate.message : null;
  const bodyCorrelation = typeof candidate?.correlation_id === "string" ? candidate.correlation_id : null;
  const bodyNextActions = Array.isArray(candidate?.next_actions)
    ? candidate.next_actions.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const bodyRetryable = typeof candidate?.retryable === "boolean" ? candidate.retryable : undefined;

  if (bodyCode !== null && AGENT_ERROR_CODES.has(bodyCode)) {
    const expectedStatus = statusForErrorCode(bodyCode);
    if (expectedStatus !== undefined && expectedStatus !== status) {
      // The Host sent a code and a status that the contract does not pair. Passing it
      // through would teach the client an impossible combination.
      return buildAgentError({
        code: "INTERNAL_ERROR",
        message: "The host returned an error envelope that does not match the contract.",
        correlation_id: bodyCorrelation ?? correlationId,
      });
    }
    return buildAgentError({
      code: bodyCode,
      message: bodyMessage ?? "The host rejected the request.",
      correlation_id: bodyCorrelation ?? correlationId,
      ...(bodyNextActions === undefined ? {} : { next_actions: bodyNextActions }),
      ...(bodyRetryable === undefined ? {} : { retryable: bodyRetryable }),
    });
  }

  return buildAgentError({
    code: errorCodeForStatus(status),
    message: bodyMessage ?? `The host responded with status ${status}.`,
    correlation_id: correlationId,
  });
}

/** The envelope for a transport failure on a read: the Host could not be reached. */
export function errorFromTransportFailure(reason: string, correlationId: string): AgentError {
  return buildAgentError({
    code: "CAPABILITY_UNAVAILABLE",
    message: reason,
    correlation_id: correlationId,
    retryable: true,
  });
}

/**
 * The envelope for a write whose outcome is unknown.
 *
 * It is deliberately **not** retryable and it never proposes a new idempotency
 * key: the request may have been applied, and replaying it under a fresh key would
 * apply it twice. The client has to read the Host's facts back under the *original*
 * key and decide there.
 */
export function errorFromUnknownOutcome(reason: string, correlationId: string): AgentError {
  return buildAgentError({
    code: "PROVIDER_RESULT_UNKNOWN",
    message: reason,
    correlation_id: correlationId,
    retryable: false,
    next_actions: ["reconcile_by_idempotency_key", "read_back_before_retry"],
  });
}

/** The envelope for a request the façade refused before it reached the Host. */
export function errorFromInvalidRequest(reason: string, correlationId: string): AgentError {
  return buildAgentError({
    code: "INVALID_REQUEST",
    message: reason,
    correlation_id: correlationId,
    retryable: false,
  });
}

/**
 * The envelope for a façade that is not configured for the request.
 *
 * This is the server's fault, not the client's: the client asked for something
 * legitimate and the façade cannot serve it because a policy value was never
 * supplied. It is reported as an internal fault with the missing policy named, so
 * the operator can see which knob to turn.
 */
export function errorFromConfiguration(reason: string, correlationId: string): AgentError {
  return buildAgentError({
    code: "INTERNAL_ERROR",
    message: reason,
    correlation_id: correlationId,
    retryable: false,
    next_actions: ["check_facade_configuration"],
  });
}
