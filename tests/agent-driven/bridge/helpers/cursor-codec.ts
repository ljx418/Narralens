/**
 * A test cursor codec — **not** a production implementation.
 *
 * The wire shape follows the scheme MAIN agreed for the production cursor
 * (`docs/parallel/lane-bridge/requests/MAIN-composition.md`):
 *
 * ```text
 * c + <12 random bytes, base64url (16 chars)> + "_" + <full HMAC-SHA256, base64url (43 chars)>
 * ```
 *
 * which is 61 characters in total and fits the frozen cursor shape
 * (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`) without any schema change. The MAC binds the
 * nonce and the complete `CursorClaims`, so a claim cannot be edited without
 * breaking it, and the nonce/claims mapping is persisted so the claims can be
 * recovered from the token.
 *
 * This lives under `tests/` on purpose. The production module exports the *ports*
 * for signing and verifying; MAIN owns the key material, the rotation and the
 * durable nonce/claims store. A codec in production code would be one more
 * implementation of the same scheme that could drift from it.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CursorClaims } from "../../../../src/contracts/agent-driven-types.js";
import { CursorRejection } from "../../../../src/host/observability/index.js";

/** The fixed prefix MAIN's scheme uses. */
const TOKEN_PREFIX = "c";
/** The nonce is 12 random bytes, which is 16 base64url characters. */
const NONCE_BYTES = 12;
const NONCE_CHARS = 16;
/** A full HMAC-SHA256 is 32 bytes, which is 43 base64url characters. */
const MAC_CHARS = 43;
const NONCE_OFFSET = TOKEN_PREFIX.length;
const MAC_OFFSET = NONCE_OFFSET + NONCE_CHARS + 1;

/**
 * Canonical encoding of the claims.
 *
 * A fixed field order rather than `JSON.stringify` of the object, so the MAC does
 * not depend on key order or on how the object happened to be built.
 */
export function canonicalizeClaims(claims: CursorClaims): string {
  return JSON.stringify([
    claims.principal_id,
    claims.project_id,
    claims.filter_digest,
    claims.instance_generation,
    claims.outbox_watermark,
    claims.issued_at,
    claims.expires_at,
    claims.key_id,
  ]);
}

export interface TestCursorCodecOptions {
  /** HMAC key. At least 16 bytes. */
  readonly key: Uint8Array;
  /** The key id embedded in the claims. */
  readonly keyId: string;
}

/**
 * A cursor codec for the lane's own cases.
 *
 * It implements the same port interfaces the production composition injects, so the
 * projection code under test is the production code and not a variant of it.
 */
export class TestCursorCodec {
  readonly key_id: string;
  readonly #key: Uint8Array;
  readonly #claims = new Map<string, CursorClaims>();

  constructor(options: TestCursorCodecOptions) {
    if (options.key.length < 16) {
      throw new Error("cursor_codec_key_too_short");
    }
    this.key_id = options.keyId;
    this.#key = options.key;
  }

  async sign(claims: CursorClaims): Promise<string> {
    const nonce = randomBytes(NONCE_BYTES).toString("base64url");
    const mac = this.#mac(nonce, claims);
    this.#claims.set(nonce, claims);
    return `${TOKEN_PREFIX}${nonce}_${mac}`;
  }

  async verify(cursor: string): Promise<CursorClaims> {
    if (
      typeof cursor !== "string"
      || cursor.length !== MAC_OFFSET + MAC_CHARS
      || !cursor.startsWith(TOKEN_PREFIX)
    ) {
      throw new CursorRejection("malformed", "cursor_malformed");
    }
    const nonce = cursor.slice(NONCE_OFFSET, NONCE_OFFSET + NONCE_CHARS);
    const mac = cursor.slice(MAC_OFFSET);
    if (!/^[A-Za-z0-9_-]+$/.test(nonce) || !/^[A-Za-z0-9_-]+$/.test(mac)) {
      throw new CursorRejection("malformed", "cursor_malformed");
    }
    // Authenticate before the lookup is trusted: the claims come from the store, but
    // only a row whose MAC matches may be served.
    const claims = this.#claims.get(nonce);
    if (claims === undefined) {
      throw new CursorRejection("unknown", "cursor_not_issued");
    }
    const expected = Buffer.from(this.#mac(nonce, claims), "base64url");
    const provided = Buffer.from(mac, "base64url");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new CursorRejection("tampered", "cursor_signature_mismatch");
    }
    return claims;
  }

  /** The number of outstanding cursors. Exposed for leak checks in tests. */
  get outstanding(): number {
    return this.#claims.size;
  }

  #mac(nonce: string, claims: CursorClaims): string {
    return createHmac("sha256", this.#key)
      .update(`${nonce}.${canonicalizeClaims(claims)}`)
      .digest()
      .toString("base64url");
  }
}
