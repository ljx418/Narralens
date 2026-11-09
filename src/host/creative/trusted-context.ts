/**
 * The trusted caller context and the lane's error vocabulary.
 *
 * The frozen request DTOs carry no principal, no channel and no session. That is
 * deliberate: a body field is a claim, and a claim is not authority. The context is minted
 * by MAIN's dispatcher after it authenticated the session and passed in out of band; the
 * services check the runtime brand before they use it.
 */

import {
  TrustedContextBrand,
  isTrustedCallerContext,
  type TrustedCallerContext,
} from "./product-repository.js";

export { isTrustedCallerContext };
export type { TrustedCallerContext };

/**
 * Mints a caller context from an already-authenticated session.
 *
 * Only MAIN's HTTP dispatcher calls this. Nothing inside the PRODUCT lane calls it, so a
 * request body can never turn into a trusted context.
 */
export function createTrustedCallerContext(input: {
  principal_id: string;
  channel: "authenticated" | "trusted_ui" | "native_bridge";
  source: "agent_conversation" | "driver_relay" | "trusted_ui";
  session_ref: string;
}): TrustedCallerContext {
  if (input.principal_id.length === 0) {
    throw new Error("A caller context needs an authenticated principal");
  }
  if (input.channel === "trusted_ui" && input.source !== "trusted_ui") {
    throw new Error("A trusted UI session cannot claim a relay source");
  }
  if (input.channel !== "trusted_ui" && input.source === "trusted_ui") {
    throw new Error("Only a trusted UI session may claim the trusted_ui source");
  }
  return {
    [TrustedContextBrand]: true,
    principal_id: input.principal_id,
    channel: input.channel,
    source: input.source,
    session_ref: input.session_ref,
  };
}

/** True when the context came from an authenticated trusted-UI session. */
export function isTrustedUi(context: TrustedCallerContext): boolean {
  return context.channel === "trusted_ui" && context.source === "trusted_ui";
}

/** True when the context came from an ordinary authenticated (non-trusted) session. */
export function isPlainAuthenticated(context: TrustedCallerContext): boolean {
  return context.channel === "authenticated";
}

/* -------------------------------------------------------------------------------------- */
/* Error vocabulary                                                                        */
/* -------------------------------------------------------------------------------------- */

/** The codes the frozen `Error` DTO allows. */
export type ProductErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "ORIGIN_REJECTED"
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "TARGET_LOCKED"
  | "IMPACT_REQUIRED"
  | "IMPACT_STALE"
  | "APPROVAL_REQUIRED"
  | "CAPABILITY_UNAVAILABLE"
  | "HOST_RESOURCE_EXHAUSTED"
  | "CURSOR_EXPIRED"
  | "INTERNAL_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "RUN_SCOPE_REQUIRED"
  | "RUN_GATE_BLOCKED"
  | "RUN_PLAN_STALE"
  | "REVIEW_STALE"
  | "NATIVE_ACK_STALE"
  | "PROVIDER_RESULT_UNKNOWN";

/**
 * The frozen code-to-status map.
 *
 * These are the pairs the contract's schema and registry agree on, copied verbatim so a
 * lane failure carries the same status MAIN's dispatcher would have chosen.
 */
export const PRODUCT_ERROR_HTTP_STATUS: Readonly<Record<ProductErrorCode, number>> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  ORIGIN_REJECTED: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  TARGET_LOCKED: 423,
  IMPACT_REQUIRED: 428,
  IMPACT_STALE: 428,
  APPROVAL_REQUIRED: 428,
  CAPABILITY_UNAVAILABLE: 503,
  HOST_RESOURCE_EXHAUSTED: 503,
  CURSOR_EXPIRED: 410,
  INTERNAL_ERROR: 500,
  PAYLOAD_TOO_LARGE: 413,
  RUN_SCOPE_REQUIRED: 428,
  RUN_GATE_BLOCKED: 428,
  RUN_PLAN_STALE: 409,
  REVIEW_STALE: 409,
  NATIVE_ACK_STALE: 409,
  PROVIDER_RESULT_UNKNOWN: 428,
};

const DEFAULT_RETRYABLE: Readonly<Record<ProductErrorCode, boolean>> = {
  INVALID_REQUEST: false,
  UNAUTHORIZED: false,
  ORIGIN_REJECTED: false,
  NOT_FOUND: false,
  REVISION_CONFLICT: false,
  IDEMPOTENCY_CONFLICT: false,
  TARGET_LOCKED: true,
  IMPACT_REQUIRED: false,
  IMPACT_STALE: false,
  APPROVAL_REQUIRED: false,
  CAPABILITY_UNAVAILABLE: true,
  HOST_RESOURCE_EXHAUSTED: true,
  CURSOR_EXPIRED: false,
  INTERNAL_ERROR: true,
  PAYLOAD_TOO_LARGE: false,
  RUN_SCOPE_REQUIRED: false,
  RUN_GATE_BLOCKED: false,
  RUN_PLAN_STALE: false,
  REVIEW_STALE: false,
  NATIVE_ACK_STALE: false,
  PROVIDER_RESULT_UNKNOWN: false,
};

/** A lane failure. MAIN's dispatcher owns the wire envelope. */
export class ProductError extends Error {
  readonly code: ProductErrorCode;
  readonly http_status: number;
  readonly retryable: boolean;
  readonly next_actions: ReadonlyArray<string>;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ProductErrorCode,
    message: string,
    options: {
      http_status?: number;
      retryable?: boolean;
      next_actions?: ReadonlyArray<string>;
      details?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super(message);
    this.name = "ProductError";
    this.code = code;
    this.http_status = options.http_status ?? PRODUCT_ERROR_HTTP_STATUS[code];
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[code];
    this.next_actions = options.next_actions ?? [];
    this.details = options.details ?? {};
  }
}

/** True when the failure is one of the lane's own domain errors. */
export function isProductError(error: unknown): error is ProductError {
  return error instanceof ProductError;
}
