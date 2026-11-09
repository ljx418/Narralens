/**
 * Cursor claims: scope, expiry and the resume point (BRIDGE / E13, case A-EVENTS).
 *
 * A cursor is an opaque token. The client never sends a bare event id, and the server
 * never trusts one. What the server trusts is the *claims* the token carries, and it
 * only trusts them after four independent checks:
 *
 * 1. **Integrity** — the token verifies against the signing key (the verifier port).
 * 2. **Time** — the claims have not expired.
 * 3. **Scope** — the claims name the same principal, project, filter and instance
 *    generation as the request that presented them.
 * 4. **Retention** — the position the claims point at is still inside the retained
 *    window.
 *
 * Each failure has a different, contract-defined outcome, and collapsing them would
 * either leak information across projects or make a recoverable resync look fatal:
 *
 * | failure                     | outcome                                    |
 * |-----------------------------|--------------------------------------------|
 * | structurally invalid token  | `INVALID_REQUEST` (400)                    |
 * | forged / unknown token      | `ORIGIN_REJECTED` (403)                     |
 * | token from another scope    | `ORIGIN_REJECTED` (403)                     |
 * | expired token               | `CURSOR_EXPIRED` (410) — resync required   |
 * | position below retention    | `CURSOR_EXPIRED` (410) — resync required   |
 */

import type { CursorClaims } from "../../contracts/agent-driven-types.js";
import { validateAgentDefinition } from "../../contracts/agent-driven-validator.js";
import type { CursorVerificationPort } from "./ports.js";

/**
 * Why a cursor was refused.
 *
 * The kinds map one-to-one onto the contract's error codes; see `rejectionToCode`.
 */
export type CursorRejectionKind =
  | "malformed"
  | "tampered"
  | "unknown"
  | "expired"
  | "scope_mismatch"
  | "outside_retention";

/** The error codes the contract defines for cursor failures. */
export type CursorErrorCode = "INVALID_REQUEST" | "ORIGIN_REJECTED" | "CURSOR_EXPIRED";

/**
 * A cursor refusal.
 *
 * The message never contains the token, the claims or any path: a cursor is a bearer
 * artefact and echoing it into a log or an error body leaks it.
 */
export class CursorRejection extends Error {
  constructor(readonly kind: CursorRejectionKind, message: string) {
    super(message);
    this.name = "CursorRejection";
  }
}

/** Map a rejection onto the contract error code it must surface as. */
export function rejectionToCode(kind: CursorRejectionKind): CursorErrorCode {
  switch (kind) {
    case "malformed":
      return "INVALID_REQUEST";
    case "expired":
    case "outside_retention":
      return "CURSOR_EXPIRED";
    case "tampered":
    case "unknown":
    case "scope_mismatch":
      return "ORIGIN_REJECTED";
  }
}

/**
 * The scope a cursor must belong to.
 *
 * All four fields participate. The filter digest is included because a cursor that
 * resumes under a different filter would silently deliver a different event set than
 * the one the client is rendering, and the instance generation because a cursor that
 * survives a restart can point at a log that no longer exists.
 */
export interface CursorScope {
  readonly principal_id: string;
  readonly project_id: string;
  readonly filter_digest: string;
  readonly instance_generation: number;
}

/**
 * Check the claims against the scope they were presented under.
 *
 * A mismatch is `ORIGIN_REJECTED`, never `NOT_FOUND` and never a silent restart: the
 * client is holding a cursor that belongs to somebody else's view, and the correct
 * answer is to refuse and let it resync under its own scope.
 */
export function assertCursorScope(claims: CursorClaims, scope: CursorScope): void {
  const matches = claims.principal_id === scope.principal_id
    && claims.project_id === scope.project_id
    && claims.filter_digest === scope.filter_digest
    && claims.instance_generation === scope.instance_generation;
  if (!matches) {
    throw new CursorRejection("scope_mismatch", "cursor_scope_mismatch");
  }
}

/** True when the claims are past their expiry at `nowMs`. */
export function isCursorExpired(claims: CursorClaims, nowMs: number): boolean {
  const expiresAt = Date.parse(claims.expires_at);
  if (Number.isNaN(expiresAt)) {
    // An unparsable expiry is treated as expired: it is the only safe reading of a
    // timestamp the server cannot understand.
    return true;
  }
  return expiresAt <= nowMs;
}

/**
 * Verify a cursor and check its scope and expiry.
 *
 * The order matters. Integrity first, because a token that does not verify has no
 * claims to compare. Then the claims themselves — a verifier that returns
 * something the contract does not describe is not trusted, even if it came from
 * the signing port. Then scope, then expiry: a cursor that belongs to another
 * principal or another project is refused as foreign before anything is said
 * about *when* it was valid, so a caller cannot use the error to probe another
 * scope's cursor state.
 */
export async function verifyCursor(
  verify: CursorVerificationPort,
  token: string,
  input: { readonly scope: CursorScope; readonly nowMs: number },
): Promise<CursorClaims> {
  if (typeof token !== "string" || token.length === 0) {
    throw new CursorRejection("malformed", "cursor_missing");
  }
  let raw: CursorClaims | null = null;
  try {
    raw = await verify.verify(token);
  } catch (error) {
    if (error instanceof CursorRejection) throw error;
    throw new CursorRejection("tampered", "cursor_verification_failed");
  }
  if (raw === null || typeof raw !== "object") {
    throw new CursorRejection("malformed", "cursor_claims_missing");
  }
  let claims: CursorClaims;
  try {
    claims = validateAgentDefinition<CursorClaims>("CursorClaims", raw);
  } catch {
    // The verifier returned claims the contract does not describe. Treating them as
    // real would be trusting a shape this module cannot reason about.
    throw new CursorRejection("malformed", "cursor_claims_invalid");
  }
  if (!isWellFormedInterval(claims)) {
    throw new CursorRejection("malformed", "cursor_interval_invalid");
  }
  if (!Number.isSafeInteger(claims.outbox_watermark) || claims.outbox_watermark < 0) {
    throw new CursorRejection("malformed", "cursor_watermark_invalid");
  }
  assertCursorScope(claims, input.scope);
  if (isCursorExpired(claims, input.nowMs)) {
    throw new CursorRejection("expired", "cursor_expired");
  }
  return claims;
}

/** True when the claims describe a positive interval that ends in the future. */
export function isWellFormedInterval(claims: CursorClaims): boolean {
  const issuedAt = Date.parse(claims.issued_at);
  const expiresAt = Date.parse(claims.expires_at);
  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) return false;
  return issuedAt < expiresAt;
}

/** Build the claims for a new cursor. */
export function buildCursorClaims(input: {
  readonly scope: CursorScope;
  readonly outbox_watermark: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly keyId: string;
}): CursorClaims {
  const claims: CursorClaims = {
    principal_id: input.scope.principal_id,
    project_id: input.scope.project_id,
    filter_digest: input.scope.filter_digest,
    instance_generation: input.scope.instance_generation,
    outbox_watermark: input.outbox_watermark,
    issued_at: new Date(input.issuedAtMs).toISOString(),
    expires_at: new Date(input.expiresAtMs).toISOString(),
    key_id: input.keyId,
  };
  return validateAgentDefinition<CursorClaims>("CursorClaims", claims);
}

/**
 * The position a client wants to resume from.
 *
 * Both the initial cursor and the `Last-Event-ID` header are verified, separately and
 * in full, when both are present. `Last-Event-ID` wins as the resume position because
 * it is the transport's own continuity token, but it does not get to *excuse* the
 * other one: a foreign cursor presented alongside a valid `Last-Event-ID` is still a
 * foreign cursor and is still refused. "Precedence" is about which position to resume
 * from, not about which one to check.
 */
export interface ResumePoint {
  /** The watermark to resume after, or `null` for a first connect. */
  readonly watermark: number | null;
  /** Which of the two tokens decided the position. */
  readonly source: "last_event_id" | "cursor" | "initial";
  readonly claims: CursorClaims | null;
}

export async function resolveResumePoint(input: {
  readonly verify: CursorVerificationPort;
  readonly scope: CursorScope;
  readonly nowMs: number;
  readonly cursor: string | null;
  readonly lastEventId: string | null;
}): Promise<ResumePoint> {
  const cursorClaims = input.cursor === null
    ? null
    : await verifyCursor(input.verify, input.cursor, { scope: input.scope, nowMs: input.nowMs });
  const lastEventClaims = input.lastEventId === null
    ? null
    : await verifyCursor(input.verify, input.lastEventId, { scope: input.scope, nowMs: input.nowMs });

  if (lastEventClaims !== null) {
    return { watermark: lastEventClaims.outbox_watermark, source: "last_event_id", claims: lastEventClaims };
  }
  if (cursorClaims !== null) {
    return { watermark: cursorClaims.outbox_watermark, source: "cursor", claims: cursorClaims };
  }
  return { watermark: null, source: "initial", claims: null };
}
