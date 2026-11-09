# MAIN composition request — frozen CP-A0

Use src/launcher/index.ts, src/mcp/index.ts and src/host/observability/index.ts after module review. MAIN alone supplies real process/instance identity, ApplicationPorts, atomic shared-repository snapshot+global scanned watermark, authentication and cursor keys/storage. No lane module is registered yet.

MAIN confirmed persistent opaque cursor wire: fixed `c` + 12 random bytes base64url (16 chars) + `_` + full HMAC-SHA256 base64url (43 chars) = 61 characters; HMAC binds nonce and complete CursorClaims. Persist nonce/claims mapping. Authenticate before lookup; verify principal/project/filter/generation/time/kid. No self-contained dot token and no frozen schema changes. Do not hardcode token length in protocol beyond frozen schema constraints.

Event batch watermark must cover only the actually scanned contiguous global range. If limit truncates visible events, do not advance to the global tail beyond unreturned rows. MAIN handles durable storage/signature/rotation; test codec is a test helper only. MAIN supplies exact filter digest and finite cursor TTL policy; no module-invented production policy.

HTTP errors after write acceptance may be unknown; keep original idempotency key, reconcile read facts before any replay. Never replace key automatically. Actual Host/DB/credential/client/native chains remain MAIN integration NOT_RUN.

## Final protocol integration details

GET transport omits null query values: MAIN must reconstruct events.snapshot cursor/last_event_id as explicit null before applying frozen CursorRead validator; POST carries the full DTO including path identity fields. A readonly GET never mutates business state.

MAIN confirmed after review: DurableCursorCodec.verifySignature validates only structure/HMAC/claims; ordinary codec.verify retains its direct time checks. Inject verifySignature into BRIDGE with explicit CursorError -> CursorRejection mapping (INVALID_REQUEST->malformed, ORIGIN_REJECTED->tampered, CURSOR_EXPIRED->expired where applicable). BRIDGE applies scope before time; do not directly inject time-checking codec.verify, which would lose 400/410 semantics or reveal expiry of a foreign cursor. MAIN will add scope-aware negative adapter tests. Sign port adds active key_id and delegates durable sign.

Frozen tested source/test SHA a325f9483cb5106aeb829121fc20ac34496e34e3. Independent Codex check tsc0 and 108/108 module tests; production Host composition still requires MAIN real-chain evidence.
