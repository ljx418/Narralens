# A PRODUCT implementation

Base and contract: `ca5b67a8285b130c79055317c6202f73cfbb99c8`. Manifest SHA256 `532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170` (docs/execution/A/contract-freeze.json).
Session allocated for Claude: `4548ddcb-e870-405b-863f-a17a4a7ed683`. Status: **Codex takeover source fixes internally validated; MAIN integration/independent review pending**.

Implement only ReleaseAssignment allowed prefixes, excluding protected project-creation-service. Use production DTO/validator. Creative intake/questions/answer/content relay/artifacts: CAS, exact idempotency, digest closure, content-only authority, deterministic fixed A workflow, trusted review gates, input/attempt isolation. No second DB or production memory fallback. MAIN injects atomic repository and trusted authority/adoption ports. Existing BootstrapPort is MAIN-owned; product returns data only.

Frontend follows frozen R4 prototype: default collapsed stage Bar, horizontal stages, task dialog focus return/Escape, no inferred success/native ack. Separate nonmodal SystemControlPanel with health TTL, unknown values, readonly shared service; lifecycle actions are MAIN callbacks. Review chapter audio/video/subtitles as one pack; cover independent. Brief/script/storyboard readers/review controls consume existing ports; no app/timeline/player clock duplication. Use frontend-design skill with R4 palette/typography as exact brief.

Cases/commands and rollback in ReleaseAssignment. Resource reservation currently RUNNING: no install/tsc/test/browser/ffmpeg; source changes permitted. Tests authored but NOT_RUN until release. Freeze implementation commit before Codex review; no self-sign whole A/human acceptance. Stop on contract drift/required public write; request MAIN.

---

## Writer log

| When | Writer | What |
| --- | --- | --- |
| 2026-11-09 | Codex | Task single, ReleaseAssignment `A-PRODUCT-001` released, base frozen. |
| 2026-11-09 | Claude Code CLI (session `4548ddcb-e870-405b-863f-a17a4a7ed683`) | First pass ended by a controlled TERM (exit 143), not a 429. No source edits lost. |
| 2026-11-09 | Claude Code CLI (same session, resumed) | Built the seam (`product-repository.ts` + request 002), then the services, the R4 frontend and the tests. Committed as `23434c1`, `d438362`, `7e4f8b0`. |
| 2026-11-09 | Codex | First independent acceptance: install exit 0, `tsc` exit 2 (8 errors), `vitest` exit 1 (37 passed / 15 failed / 52). Decision record `22cc663a`. |
| 2026-11-09 | Claude Code CLI (same session, resumed) | SOURCE REPAIR batch 1: the eight `tsc` errors, the fifteen test failures (six of them false, caused by a missing DOM cleanup) and the seven consolidated review cases. Record: `logs/2026-11-09-source-repair-batch1.md`. |

Codex was read-only during every Claude writing window. No concurrent modification of the
code, the git index, the branch or the run root.

## What exists now

### Lane source

| Path | Purpose |
| --- | --- |
| `src/host/creative/product-repository.ts` | The closed repository seam: 25-member `ProductCollection` union, per-collection record DTOs, primary keys, list scopes, collection specs with the exact `cp_a0_*` table, write/CAS semantics, `tx.emit`, idempotency recall/record on the transaction, `TrustedAdoptionAuthority`, the runtime-branded `TrustedCallerContext`. |
| `src/host/creative/digest.ts` | Restricted-JCS canonical JSON, SHA-256 digests, the metadata-free request digest, the style digest recomputation, the exact golden `FIXED_PLAN` and its digest assertion. |
| `src/host/creative/time.ts` | Epoch seconds ↔ ISO-8601 (the frozen SQL stores deadlines as INTEGER epoch seconds). |
| `src/host/creative/trusted-context.ts` | The out-of-band caller context, the frozen error code → HTTP status map, the lane's `ProductError`. |
| `src/host/creative/creative-closure.ts` | The creative input closure and its digest. |
| `src/host/creative/execution-guard.ts` | `guardExecution(binding, effect, facts)` and `guardExecutionInTransaction(...)` — the one gate MAIN calls before every actual side effect. It fails closed without the durable facts. |
| `src/host/creative/product-facts.ts` | The mandatory read-only project fact port MAIN injects. |
| `src/host/creative/creative-service.ts` | Intake put/read/confirm, question put, answer (relay and workbench), content relay, artifact put, and the brief's own consistency rules. |
| `src/host/creative/fixed-workflow-service.ts` | Run prepare/authorize/start/pause/resume/cancel/read, `recordStepAttempt`, review package publication/read/decision, the workflow nodes. |
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
plus `support/memory-repository.ts` (a test-only seam implementation that enforces the
frozen foreign keys, triggers and binding rules) and `support/fixtures.ts`.

### Lane documents

`INTEGRATION.md` (how MAIN wires it, the exact commands),
`requests/002-exact-record-mapping.md`,
`requests/003-idempotency-scope-and-route-ownership.md` (**MAIN's decisions, final**),
`requests/004-project-fact-port.md` (the one open item),
`logs/2026-11-09-closed-ports-and-records.md`,
`logs/2026-11-09-source-repair-batch1.md` (the repair record).

## Still open for MAIN

1. The **project fact port** — request 004. The lane cannot prepare a run without it, by
   design.
2. The **style digest formula** — the lane's proposal is in request 004 §5 and
   `INTEGRATION.md` §6.1; MAIN's brief writer has to match it.
3. The **repository adapter** over MAIN's `RevisionStore` connection, with the write rules
   of request 002 §4.
4. The **resource release** for `tsc` and the test run. Everything here is `NOT_RUN`, and
   the lane does not claim the A round or the module is ready.

## Codex takeover outcome
MAIN explicitly directed takeover after repeated roots across two actual checks. Claude repair2 PID3658688/exec77491 stopped exit143 before any source edits. Codex became unique implementation writer and corrected domain mapping/import/readonly/iterator errors, actual trigger focus, authenticated user fixtures and real review predecessor sequence; added style Brief carrier role+payload/hash binding, latest attempt/stage guards, exact frozen runtime validation, native project checks, style golden+single-field mutation and owner/closure checks.

Internal tsc exit0 and five files/98 tests PASS (26.10s); verification-codex.json records raw logs/handles/hashes and earlier failures. Codex implemented fixes, so independent review stays REVIEW_PENDING; no A/Host/browser/media/human PASS. MAIN has the next integration and final effect boundary.

Final fingerprint increment retested at frozen source9eb701d901cf39aa03a7ea3d04cc5a938fa3386f: tsc0 and100/100 internal tests. No source edits afterwards. Independent review and MAIN composition remain pending.

## 2026-11-10 managed native observation candidate

MAIN explicitly authorized controlled candidate source/patch artifacts under requests/010 and private var/managed-native-observation. Sole writer Codex; no Claude/provider. Exact upstream e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3 read-only; only exported host/use-film/ProjectView observer metadata changes. Shared Host and vendor/legacy dist untouched. Build/browser/Host require separate MAIN resource notification. Evidence and rollback in requests/010/README.md; this candidate does not self-sign independent PASS.
