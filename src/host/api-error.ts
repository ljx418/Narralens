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

export function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return new HttpError(500, "INTERNAL_ERROR", "Internal host error");
}
