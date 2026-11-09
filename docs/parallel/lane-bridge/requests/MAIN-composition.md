# MAIN composition request — frozen CP-A0

Use src/launcher/index.ts, src/mcp/index.ts and src/host/observability/index.ts after module review. MAIN alone supplies real process/instance identity, ApplicationPorts, atomic shared-repository snapshot+global scanned watermark, authentication and cursor keys/storage. No lane module is registered yet.

MAIN confirmed persistent opaque cursor wire: fixed `c` + 12 random bytes base64url (16 chars) + `_` + full HMAC-SHA256 base64url (43 chars) = 61 characters; HMAC binds nonce and complete CursorClaims. Persist nonce/claims mapping. Authenticate before lookup; verify principal/project/filter/generation/time/kid. No self-contained dot token and no frozen schema changes. Do not hardcode token length in protocol beyond frozen schema constraints.

Event batch watermark must cover only the actually scanned contiguous global range. If limit truncates visible events, do not advance to the global tail beyond unreturned rows. MAIN handles durable storage/signature/rotation; test codec is a test helper only. MAIN supplies exact filter digest and finite cursor TTL policy; no module-invented production policy.

HTTP errors after write acceptance may be unknown; keep original idempotency key, reconcile read facts before any replay. Never replace key automatically. Actual Host/DB/credential/client/native chains remain MAIN integration NOT_RUN.
