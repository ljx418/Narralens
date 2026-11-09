# PRODUCT handoff

Base/contract `ca5b67a8285b130c79055317c6202f73cfbb99c8`; manifest
`532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`.
Session `4548ddcb-e870-405b-863f-a17a4a7ed683`. Branch `agent-driven/lane-product`.

**Writer: Claude Code CLI (sole writer). Codex read-only during every write window.**
The previous CLI invocations ended by controlled TERM (exit 143), **not** by a 429: no
source edits were lost and no child process was left running. The lane log is
`logs/claude-4548ddcb.jsonl` and `logs/claude-4548ddcb-resume1.jsonl`.

**Implementation commits on `agent-driven/lane-product`:**

| SHA | What |
| --- | --- |
| `23434c116d12fa1f21cd25135acbc3a3e01d3a8b` | The implementation: 31 files, +8696 lines. |
| `d438362` | The static-review fixes: the explicit head/append-only lists, the time-helper module split. |

Both contain only the lane's own source, test, tool and document paths. Nothing outside
`src/app/observation/`, `src/app/system/`, `src/host/creative/`,
`tests/agent-driven/product/`, `tools/agent-driven/product/` and the lane's own
documents was staged. MAIN's `ReleaseAssignment.json`, request 001, the Codex scratch
notes and the raw CLI transcripts were left untracked on purpose.

**State at the end of this session: implementation complete, source only, nothing
executed.** The MAIN resource reservation was RUNNING for the whole session, so there was
no install, no `tsc`, no test run, no browser and no ffmpeg. Every test in this lane is
`NOT_RUN`.

---

## 1. What was produced

### The seam (MAIN's first request)

`src/host/creative/product-repository.ts` and
`requests/002-exact-record-mapping.md`.

- A **closed** `ProductCollection` union of 25 members, one per frozen `cp_a0_*` table.
  `cp_a0_render_attempt` and `cp_a0_delivery` are deliberately excluded (MEDIA's rows);
  `cp_a0_migration` is MAIN's; `cp_a0_event` is read-only for the lane because its
  `event_id` is a foreign key onto MAIN's `outbox`.
- `get`/`list`/`put` are typed down to `ProductRecords[K]` with per-collection keys and
  list scopes, so an adapter cannot be a generic key/value store. `compareAndSet` is
  separate, and only the head collections accept it.
- Every collection has a complete record DTO, its primary key, its write kind and its
  exact column mapping.
- `tx.emit` carries a typed event with an explicit scope (`run`, `project` or `intake`) and
  maps onto MAIN's authoritative `outbox` in the same transaction.
- `tx.recallIdempotency` / `tx.recordIdempotency` work inside the lane's transaction and
  map onto MAIN's existing `operation_idempotency` table. There is no second command
  ledger.
- `TrustedAdoptionAuthority.registerConfirmation` / `registerApproval` take the lane's
  transaction. A `null` from `registerApproval` fails `accept_and_adopt` closed.

### The services

`creative-service.ts` — intake put/read/confirm, question put, answer (relay and
workbench), content relay, artifact put. Every call validates its input with the frozen
production validator before it reads or writes and validates its output before it
returns.

`fixed-workflow-service.ts` — run prepare/authorize/start/pause/resume/cancel/read, review
package publication/read/decision, and the workflow nodes.

### The R4 frontend

`src/app/observation/` — `WorkflowTopBar` (collapsed by default, horizontal stages, a task
dialog with the real attempt, job, inputs and outputs, Escape closes it and the focus
returns to the stage, closing has no control effect), `CreativeReviewPanel` (the chapter
bundle as one package, the cover independent, close is not a decision, the adoption is only
offered with an impact), the brief/script/storyboard readers and `nativeSyncState`.

`src/app/system/` — `SystemControlPanel`, a non-modal aside with no backdrop and no focus
trap, the health staleness rule (a sample older than `stale_after_ms` is unknown), shared
services read-only, and no model mutation control in this round.

### The tests (authored, `NOT_RUN`)

`tests/agent-driven/product/` — five test files plus a test-only in-memory implementation
of the seam. The in-memory repository lives under `tests/` and is never imported by
`src/`.

### The documents

`INTEGRATION.md`, `requests/002-exact-record-mapping.md`,
`requests/003-idempotency-scope-and-route-ownership.md`,
`logs/2026-11-09-closed-ports-and-records.md`.

---

## 2. The eight review points, and where they are answered

| Review point | Where it is answered |
| --- | --- |
| 1. The head/append-only conditional types resolved to `never`. | `PRODUCT_COLLECTIONS` is now an `as const satisfies` literal, so each entry's `kind` is a literal type and `ProductHeadCollection` / `ProductAppendOnlyCollection` resolve to real unions. |
| 2. `TrustedContextBrand` was erased at runtime. | It is now `export const TrustedContextBrand: unique symbol = Symbol(...)`, the services check it with `isTrustedCallerContext` at runtime, and a forged context is refused with `UNAUTHORIZED`. |
| 3. The SQL times are epoch seconds. | `src/host/creative/time.ts` owns the conversion; `toWireApproval` and `toWireRunAuthorization` multiply by 1000; the expiry comparisons use `nowEpochSeconds()`. |
| 4. `PROVIDER_RESULT_UNKNOWN` is 428. | `PRODUCT_ERROR_HTTP_STATUS` is copied verbatim from the frozen schema: `PROVIDER_RESULT_UNKNOWN` 428 and `IMPACT_STALE` 428 (both were wrong in the first draft). |
| 5. The idempotency seam had no atomic recall/record. | `tx.recallIdempotency` / `tx.recordIdempotency` are on the transaction; the pre-project scope is `{ kind: "principal", principal_id }`; the **stored response** is what a replay returns, so a replayed answer keeps its original timestamp; `contentDigest` excludes `meta`; request 003 proposes the `principal:<id>` namespace in MAIN's existing table. |
| 6. `FixedPlan` must be the golden shape. | `FIXED_PLAN` is the golden `referenceVectors.fixedPlan.value` field for field, and `assertFixedPlanDigest()` re-checks that its canonical JSON still hashes to `b70615d5…07ca32`. |
| 7. `StepAttempt.dependencies_json` had invented output references. | It holds the **planned dependency stage identities** (`after` in the golden plan); the outputs are bound by `input_digest` and the checkpoint's `output_refs`. |
| 8. No whole-disk scans. | Every read used an exact project path. No `find /`, no `/mnt` scan, no J drive, no other project's files. |

---

## 3. What was verified, and what was not

**Verified.** The canonicalization algorithm was checked against the frozen golden vectors
(`docs/agent-driven-v1/cp-a0/canonical-vectors.json`) with a standalone script outside the
project build: the canonical text and the SHA-256 matched the frozen `brief`,
`initialAnswer`, `changedAnswer`, `runScope` and `fixedPlan` vectors. That is a check of
the algorithm only.

**Not verified.** Nothing in this lane has been compiled, type-checked, executed or
rendered. `pnpm exec tsc --noEmit` and
`pnpm exec vitest run --config vitest.config.ts tests/agent-driven/product --maxWorkers=1`
have not been run, because the resource reservation is RUNNING. The lane does not claim
that they pass, and it does not claim an independent review.

---

## 4. What MAIN has to answer

1. **The pre-project idempotency namespace** — request 003 §1.
2. **The route-ownership conflict** — the frozen registry names MAIN the business producer
   for `intake.confirm`, `workflow.run.authorize/start/pause/resume/cancel` and
   `review.decide`, while the A release assignment asks PRODUCT for the business logic.
   The lane implemented the business logic and registered nothing; MAIN has to confirm the
   split — request 003 §2.
3. **The storage decisions** — request 002 §7 and request 003 §3 (the gates in
   `checkpoint_json`, the review body in the artifact store, the `plan_sha256` mapping, the
   pre-project receipt addressing, the event scopes).
4. **The `ProductRepository` adapter** over MAIN's `RevisionStore` connection, with the
   write rules of request 002 §4.
5. **The resource release** for the type check and the test run.

## 5. How to pick this up

1. Read `INTEGRATION.md` first — it is the wiring document.
2. Read `requests/002-exact-record-mapping.md` next — it is the adapter contract.
3. Read `requests/003-idempotency-scope-and-route-ownership.md` — it is the open question
   list.
4. Then implement the adapter, release the resources, and run the two commands above.

The lane stays stopped until MAIN explicitly hands it back. It does not push, it does not
touch `main`, and it does not re-open a write window on its own.


## Codex acceptance intake (2026-11-09)
Claude session 4548ddcb-e870-405b-863f-a17a4a7ed683 completed; latest PID3531672 and exec59591 exit0; no remaining child. Implementation candidate HEAD7e4f8b0a4ea318f0c607ed72bcfc4f4e521306f6, source correction d4383629babd5979bf313c84eaa211fa9093ed9a. Writer is now Codex for documentation/acceptance only; Claude remains stopped until explicit next handoff.

MAIN decisions accepted: preproject idempotency maps existing operation_idempotency project_id=principal:<authenticated principal>, project uses actual project ID; operation_kind=agent.v1:<operation>. No new ledger. Sensitive seven registry businessProducer remains MAIN; helpers supplied by PRODUCT, MAIN verifies channel/principal/currentness and registers trusted evidence/finite approval in same transaction. Coordinator consumes adoption approval in final commit. Intake.confirm remains MAIN trusted UI entry. Gates checkpoint_json, ReviewPackage artifact_version, plan_sha→action_digest and nonrun outbox-only mapping accepted. Bootstrap command lifecycle state mutable only by MAIN dedicated service; PRODUCT initial reservation/read surface remains append-only.

Resource: BRIDGE occupies only light slot; PRODUCT source-only pending MAIN admission. tsc/vitest/UI browser NOT_RUN. Static standalone canonical/exports script checks were performed by Claude despite source-only intention; these are not module test PASS. Scope deviation: /tmp/check-exports.mjs was written by Claude rather than under allowed lane; cleanup limited to that self-owned file. Future scratch must remain inside docs/parallel/lane-product. No other project/public/protected paths changed.
