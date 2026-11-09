# A PRODUCT implementation

Base and contract: `ca5b67a8285b130c79055317c6202f73cfbb99c8`. Manifest SHA256 `532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170` (docs/execution/A/contract-freeze.json).
Session allocated for Claude: `4548ddcb-e870-405b-863f-a17a4a7ed683`. Status: **IMPLEMENTATION COMPLETE, SOURCE ONLY, NOT_RUN**.

Implement only ReleaseAssignment allowed prefixes, excluding protected project-creation-service. Use production DTO/validator. Creative intake/questions/answer/content relay/artifacts: CAS, exact idempotency, digest closure, content-only authority, deterministic fixed A workflow, trusted review gates, input/attempt isolation. No second DB or production memory fallback. MAIN injects atomic repository and trusted authority/adoption ports. Existing BootstrapPort is MAIN-owned; product returns data only.

Frontend follows frozen R4 prototype: default collapsed stage Bar, horizontal stages, task dialog focus return/Escape, no inferred success/native ack. Separate nonmodal SystemControlPanel with health TTL, unknown values, readonly shared service; lifecycle actions are MAIN callbacks. Review chapter audio/video/subtitles as one pack; cover independent. Brief/script/storyboard readers/review controls consume existing ports; no app/timeline/player clock duplication. Use frontend-design skill with R4 palette/typography as exact brief.

Cases/commands and rollback in ReleaseAssignment. Resource reservation currently RUNNING: no install/tsc/test/browser/ffmpeg; source changes permitted. Tests authored but NOT_RUN until release. Freeze implementation commit before Codex review; no self-sign whole A/human acceptance. Stop on contract drift/required public write; request MAIN.

---

## Writer log

| When | Writer | What |
| --- | --- | --- |
| 2026-11-09 | Codex | Task single, ReleaseAssignment `A-PRODUCT-001` released, base frozen. |
| 2026-11-09 | Claude Code CLI (session `4548ddcb-e870-405b-863f-a17a4a7ed683`) | First pass ended by a controlled TERM (exit 143), not a 429. No source edits lost. |
| 2026-11-09 | Claude Code CLI (same session, resumed) | Read `AGENTS.md`, `TASK.md`, `ReleaseAssignment.json`, requests 001–003, `AGENTS.md`, cp-a0 01/02/03, implementation-design 07/08, the R4 prototype and the frozen schema. |
| 2026-11-09 | Claude Code CLI (same session) | Built the seam first (`product-repository.ts` + request 002), then the services, the R4 frontend and the tests. |

Codex was read-only throughout the Claude writing windows. No concurrent modification of
the code, the git index, the branch or the run root.

## What exists now

### Lane source

| Path | Purpose |
| --- | --- |
| `src/host/creative/product-repository.ts` | The closed repository seam: 24-member `ProductCollection` union, per-collection record DTOs, primary keys, list scopes, collection specs with the exact `cp_a0_*` table, write/CAS semantics, `tx.emit`, idempotency recall/record on the transaction, `TrustedAdoptionAuthority`, the runtime-branded `TrustedCallerContext`. |
| `src/host/creative/digest.ts` | Restricted-JCS canonical JSON, SHA-256 digests, the metadata-free request digest, the exact golden `FIXED_PLAN` and its digest assertion. |
| `src/host/creative/time.ts` | Epoch seconds ↔ ISO-8601 (the frozen SQL stores deadlines as INTEGER epoch seconds). |
| `src/host/creative/trusted-context.ts` | The out-of-band caller context, the frozen error code → HTTP status map, the lane's `ProductError`. |
| `src/host/creative/creative-closure.ts` | The creative input closure and its digest. |
| `src/host/creative/execution-guard.ts` | `guardExecution(binding, action, context)` — the one gate MAIN calls before every actual side effect. |
| `src/host/creative/creative-service.ts` | Intake put/read/confirm, question put, answer (relay and workbench), content relay, artifact put. |
| `src/host/creative/fixed-workflow-service.ts` | Run prepare/authorize/start/pause/resume/cancel/read, review package publication/read/decision, the workflow nodes. |
| `src/host/creative/index.ts` | The lane's public entry point. |
| `src/app/observation/WorkflowTopBar.tsx` | The R4 collapsed-by-default stage bar with the task detail dialog. |
| `src/app/observation/CreativeReviewPanel.tsx` | The review panel: the chapter bundle, the independent cover, the separated decisions. |
| `src/app/observation/content-views.tsx` | Brief, script and storyboard readers, plus `nativeSyncState`. |
| `src/app/observation/observation.css` | The R4 palette, the focus ring and the 390px review layout. |
| `src/app/system/SystemControlPanel.tsx` | The non-modal system aside with the health staleness rule. |
| `src/app/system/system.css` | The panel's styles. |
| `src/app/observation/index.ts`, `src/app/system/index.ts` | The frontend entry points. |
| `tools/agent-driven/product/record-mapping.ts` | Prints the collection → table mapping from the code itself. |

### Lane tests (authored, **NOT_RUN**)

`tests/agent-driven/product/` — `digest.test.ts`, `creative-service.test.ts`,
`fixed-workflow-service.test.ts`, `execution-guard.test.ts`, `observation-ui.test.tsx`,
plus `support/memory-repository.ts` (a test-only seam implementation) and
`support/fixtures.ts`.

### Lane documents

`INTEGRATION.md` (how MAIN wires it, the exact commands), `requests/002-exact-record-mapping.md`,
`requests/003-idempotency-scope-and-route-ownership.md`,
`logs/2026-11-09-closed-ports-and-records.md`.

## Still open for MAIN

1. The pre-project idempotency namespace in the existing `operation_idempotency` table
   (request 003 §1).
2. The route-ownership conflict between the frozen registry and the A release assignment
   for `intake.confirm`, `workflow.run.authorize/start/pause/resume/cancel` and
   `review.decide` (request 003 §2).
3. The storage decisions listed in request 002 §7 and request 003 §3.
4. The `ProductRepository` adapter itself, over MAIN's `RevisionStore` connection.
5. The resource release for `tsc` and the test run. Everything here is `NOT_RUN`.
