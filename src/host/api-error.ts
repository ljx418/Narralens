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
export function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    if (error.correlationId !== undefined) return error;
    return new HttpError(error.status, error.code, error.message, error.details, randomUUID());
  }
  return new HttpError(500, "INTERNAL_ERROR", "Internal host error", undefined, randomUUID());
}
