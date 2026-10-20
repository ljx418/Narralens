import { randomUUID } from "node:crypto";
import type { ApiError, ApiErrorCode } from "../contracts/types.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly correlationId?: string,
  ) { super(message); }

  body(): ApiError {
    return {
      code: this.code,
      message: this.message,
      correlation_id: this.correlationId ?? randomUUID(),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/**
 * Turns anything unexpected into a response-safe error.
 *
 * The correlation id is generated *here* and attached to the error, not left to
 * `body()`: a diagnostic recorded by the Host has to be matchable against the id the client
 * was actually given, and generating it twice makes the two disagree. `body()` keeps its
 * fallback for errors constructed directly rather than normalized.
 */
/**
 * Node error codes that mean "the machine could not do this right now" rather than "the Host
 * is broken".
 *
 * Without this an allocation failure anywhere in a request became an opaque 500, which told a
 * client nothing it could act on and told an operator nothing they could look for. The
 * captured case was `ENOMEM: not enough memory, read` surfaced as
 * `500 INTERNAL_ERROR` from a migration that had done nothing wrong.
 */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "ENOMEM", "EMFILE", "ENFILE", "EBUSY", "EAGAIN", "EIO", "ETXTBSY", "ENOSPC", "ECONNRESET",
]);

/**
 * Preserve retryable host-resource failures across subsystem boundaries.
 *
 * Media tooling, filesystem adapters and child-process wrappers must call this before
 * translating an error into a domain-specific failure. Otherwise a raw `ENOMEM` from
 * ffmpeg becomes `INVALID_MEDIA`, which incorrectly makes an unchanged project terminal.
 */
export function asHostResourceError(error: unknown, correlationId?: string): HttpError | undefined {
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || !TRANSIENT_CODES.has(code)) return undefined;
  return new HttpError(503, "HOST_RESOURCE_EXHAUSTED",
    "The Host could not complete this right now",
    { reason: `TRANSIENT:${code}`, recoverable: true }, correlationId ?? randomUUID());
}

export function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    if (error.correlationId !== undefined) return error;
    return new HttpError(error.status, error.code, error.message, error.details, randomUUID());
  }
  const resourceError = asHostResourceError(error);
  if (resourceError !== undefined) return resourceError;
  return new HttpError(500, "INTERNAL_ERROR", "Internal host error", undefined, randomUUID());
}
