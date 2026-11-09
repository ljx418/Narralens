# Log — closed ports and records (schema-accurate)

Lane: PRODUCT. Session `4548ddcb-e870-405b-863f-a17a4a7ed683`.
Base/contract `ca5b67a8285b130c79055317c6202f73cfbb99c8`, manifest
`532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`.
Writer: Claude Code CLI (sole writer for this lane). Codex read-only.

The previous CLI invocation ended by a controlled TERM (exit 143), not by a 429. No source
edits were lost; the working tree at resumption contained only the untracked lane documents
(`TASK.md`, `HANDOFF.md`, `ReleaseAssignment.json`, `CLAUDE_TASK.txt`, `logs/`, `requests/`).

## Delivered in this step

| Path | Purpose |
| --- | --- |
| `src/host/creative/product-repository.ts` | The closed repository seam: `ProductCollection` union (24 members), per-collection record DTOs, primary keys, list scopes, collection specs with the exact table, write semantics, `tx.emit`, `ProductIdempotencyReceipt`, `TrustedAdoptionAuthority`. |
| `src/host/creative/digest.ts` | Restricted-JCS canonical JSON, SHA-256 digests, deterministic ids. |
| `src/host/creative/trusted-context.ts` | Out-of-band caller context minting plus the frozen error vocabulary. |
| `docs/parallel/lane-product/requests/002-exact-record-mapping.md` | Column-level mapping of every collection to its `cp_a0_*` table, write/CAS semantics, event mapping, trusted adoption contract, and the six points MAIN still has to decide. |

## Schema accuracy notes MAIN asked for

- The collection union is closed and one-to-one with the frozen `cp_a0_*` tables. A generic
  KV/JSON state store cannot satisfy it: `get`/`list`/`put` are typed down to
  `ProductRecords[K]` and the keys are typed per collection.
- `cp_a0_render_attempt` and `cp_a0_delivery` are **not** in the union — they are MEDIA's
  rows. `cp_a0_migration` is MAIN's. `cp_a0_event` is read-only for the lane because its
  `event_id` is a foreign key onto MAIN's `outbox`.
- Immutable versions and their heads are separate rows, as the SQL requires: six
  `*_version` collections plus five `*_head` collections, with compare-and-set on the head
  version column.
- Project commands reuse MAIN's existing `operation_idempotency`; the lane only produces
  the request digest and the receipt. The pre-project receipt is `cp_a0_bootstrap_command`,
  addressed by `(principal_id, operation, idempotency_key)`.
- No second command authority and no workflow commit: the lane never writes
  `project_state`, `snapshot`, `active_commit`, `project_transaction` or `job`.
- `tx.emit` carries an explicitly discriminated scope (`run` or `intake`) and maps to
  MAIN's authoritative `outbox` in the same transaction; run-scoped events are mirrored
  into `cp_a0_event` by MAIN.
- The trusted approval callback takes the lane's transaction and must register the finite
  approval inside it; a `null` return fails `accept_and_adopt` closed.

## Decisions that need MAIN's confirmation (details in request 002 §7)

1. Gate vocabulary mapping (`ReviewPackage.kind` ↔ `review_request.gate`).
2. The wire `RunGate` objects live in `cp_a0_run.checkpoint_json` — the frozen schema has
   no `cp_a0_run_gate` table.
3. The review package body lives in `cp_a0_artifact_version.content_json`.
4. Wire `Approval.plan_sha256` maps to `cp_a0_approval.action_digest`.
5. The pre-project receipt is addressed by its `UNIQUE(principal_id, operation, idempotency_key)`
   index rather than by `command_id`.
6. Intake-scoped events reach the outbox but not `cp_a0_event` (`run_id` is a mandatory
   foreign key onto `cp_a0_run`).

## Resource state

No install, no `tsc`, no test run, no browser, no ffmpeg — the MAIN resource reservation is
still RUNNING. Everything above is source-only and has **not** been compiled or executed.
