# Error codes

Every failure the façade reports is the contract's `Error` envelope:

```json
{
  "schema_version": "agent.v1",
  "correlation_id": "…",
  "code": "CURSOR_EXPIRED",
  "http_status": 410,
  "message": "…",
  "retryable": false,
  "next_actions": ["resync_snapshot"]
}
```

Read `code` first. `message` is for humans, it is sanitised, and it is not a
contract.

| code | status | what it means | what to do |
|---|---|---|---|
| `INVALID_REQUEST` | 400 | the payload does not match the route's contract definition | fix the payload. Retrying it unchanged fails identically |
| `UNAUTHORIZED` | 401 | no or stale credentials | refresh the token; do not retry with the same one |
| `ORIGIN_REJECTED` | 403 | wrong channel: a trusted-UI route from a plain MCP token, a cursor from another scope, a foreign Origin | do not retry from this channel. Use the workbench, or resynchronise |
| `NOT_FOUND` | 404 | the project, job or package does not exist, or belongs to another project | re-read the identifiers |
| `REVISION_CONFLICT` | 409 | the base you sent is not the current one | re-read and recompute |
| `IDEMPOTENCY_CONFLICT` | 409 | the same idempotency key was used with different content | use a new key |
| `TARGET_LOCKED` | 423 | another operation holds the lock | wait |
| `IMPACT_REQUIRED` | 428 | the change needs an impact review first | request the review |
| `IMPACT_STALE` | 428 | the impact was computed against older inputs | recompute it |
| `APPROVAL_REQUIRED` | 428 | a trusted approval is missing | the workbench must approve |
| `CAPABILITY_UNAVAILABLE` | 503 | the capability is not reachable right now | back off and retry |
| `HOST_RESOURCE_EXHAUSTED` | 503 | the machine could not do it right now | back off and retry |
| `CURSOR_EXPIRED` | 410 | the cursor or its position has expired or left the retained window | take a fresh snapshot. Do not retry the old cursor |
| `INTERNAL_ERROR` | 500 | the Host failed, or answered with something off-contract | retry with backoff; if it persists, report it |
| `PAYLOAD_TOO_LARGE` | 413 | the request body is too large | send less |
| `RUN_SCOPE_REQUIRED` | 428 | the run has no authorised scope yet | the scope must be granted in the workbench |
| `RUN_GATE_BLOCKED` | 428 | a gate (sample, first chapter, risk, QC) is not accepted | wait for the human decision |
| `RUN_PLAN_STALE` | 409 | the run plan moved on | re-read the run |
| `REVIEW_STALE` | 409 | the review package changed | re-read the package |
| `NATIVE_ACK_STALE` | 409 | the native editor's confirmation is for an older revision | re-read the editor state |
| `PROVIDER_RESULT_UNKNOWN` | 428 | a write was sent but its outcome is unknown: the Host may have applied it and the answer was lost, truncated or off-contract | reconcile before retrying; never assume, never rekey — see below |

## A write whose outcome is unknown

`PROVIDER_RESULT_UNKNOWN` is the one code that means *both* "it failed" and "it
worked". The request was sent; the answer never arrived intact. The Host may have
applied it, may not have, and may have applied it twice already if something else
replayed it.

What to do:

1. **Keep the original idempotency key.** Never send the request again under a new
   key: the new key is a new request, and it may apply the change a second time.
2. **Read the facts back.** The job, the run, the project's revision and snapshot
   tell you whether the write landed. That read is safe — it changes nothing.
3. **Decide from what you read.** If the effect is there, the write succeeded; if it
   is not there and the Host reports no pending work, the write can be sent again
   **with the original key**, which the Host will treat as a replay rather than a
   new request.

Never assume the failure. Never rekey.

## Retrying

`retryable` is part of the envelope, but it is not the whole answer:

- `retryable: true` means the same request may succeed later. Back off before
  retrying; a tight retry loop turns a busy Host into a busy Host.
- `retryable: false` means the same request will fail the same way. `CURSOR_EXPIRED`
  and `REVISION_CONFLICT` are the two that most often get retried by mistake: both
  need a fresh read first, not a resend.
- `PROVIDER_RESULT_UNKNOWN` is never retryable, because "retry" is exactly the
  mistake it warns about. It needs a read, not a resend.

## Correlation

`correlation_id` matches the id the Host logged. Quote it when reporting a failure —
it is the only thing that ties an agent's report to the Host's own record.
