# R0 independent current-byte source review

Outcome: **PASS (R0 source-review scope only, one nonblocking minor)**. Blocking findings: 0; major findings: 0; minor findings: 1. This is not product acceptance, a production-registration approval, or an A human-acceptance signature.

Reviewer: dispatched independent Codex context, task `task_c7c404aa839e`, dispatch `ctx_fe84a1a5c726`; this context did not author the overlay. Review date: 2026-11-11. Latest explicit user authorization for actual A development takes precedence over historical pause/document-only text. Read canonical AGENTS.md, delivery process 11, relaunch 06 and 04, baseline-observed/source-map, and relevant D02/D04/D09/D10/D12/D13 decisions. No implementation, Git mutation, test/build/media/browser/Host process, external provider, or helper worker was used. Only this report was written.

## Binding and method

Source root: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`.
Original and end-of-review HEAD: `838ba5f2c8500f0103f56dbe51264ea9f70086fc`.
All 13 current overlay source/test files match their full SHA256 in the preserved preparation baseline. Review covers the actual current verifier `ffefbd4169dfd07930723e2606997845fc1bc4a1aa9d0f6b60b7bfd6eb5276db`; no PASS was inherited from the old closure or 380b candidate. The eight source files and five affected overlay tests were inspected, with supporting authority/recovery/assembler code traced as listed below. Supporting large files were read at relevant call sites, not exhaustively audited.

## Finding R0-M01 — minor, nonblocking: graceful shutdown leaves stale workflow progress

Location: `src/host/agent-driven/created-task-worker.ts:88` (shutdown release), with `created-draft-processor.ts:94` (`#progress`) and `created-task-store.ts:260` (`reapExpired`).

Trigger/reproduction for MAIN: use the real processor/CP fixture, pause an admitted execution after it has recorded its `running` step (for example at `before_prepare`), call `worker.close()`, allow the boundary to return, and await close. With a still-live lease and no user cancellation, the worker skips failure settlement during shutdown and calls only `PersistentJobStore.releaseLease`. The Job becomes `queued` with no lease, but `cp_a0_step_attempt.state` and the matching Run checkpoint attempt stay `running`. Read these rows before starting another worker, or reopen SQLite without starting the worker, to observe the mismatch. `recover()` scans expired running/cancel_requested jobs, so it does not reconcile this already-queued row.

Impact: durable workflow observation can say preparation is running when no worker owns it. This does not publish a prepared success, alter author source, bypass a grant, or prevent the current implementation from resuming: the next execution accepts the existing running CP attempt and records running again. Accordingly this is a nonblocking progress-consistency defect, not a source-integrity or recovery-loss major.

Narrow fix: route graceful release through a synchronous same-DB processor/task-store composition that records pending step/checkpoint/event together with releasing the matching live lease; preserve the existing user-cancellation branch and awaited cleanup. Do not redesign the scheduler or add a new job state machine. Add one real CP shutdown/reopen assertion (queued Job, pending attempt/checkpoint, no duplicate settlement on recovery, successful resume); the existing worker shutdown test checks Job/cleanup with a fixture processor and cannot detect this CP discrepancy. This reproduction is source-derived, NOT_RUN by this reviewer.

## Reviewed invariants and boundaries

- Preparation remains source-only: the processor reads the current author baseline, assembles under its private stage domain, and records immutable prepared facts. It has no author publication, revision increment, active-pointer mutation, or acceptance path. Successful completion records `SOURCE_ONLY`, not an adopted project.
- Reservation, immutable fact insertion, success/failure settlement, and dedicated expired-lease recovery use the original RevisionStore connection. ProductSqliteRepository joins the live revocable task capability; asynchronous hooks are refused, swallowed SQL faults poison the scope, and failure rolls back checkpoint/event/outbox changes. The shutdown observation above is the identified exception to consistent progress settlement.
- Worker gate rechecks actual durable step/job binding, current creative closure and immutable run input refs, base/source/recovery status, owner, plan, scope, grant and prerequisite gates. Cancellation/expiry prevent prepared publication; revoked/expired grants cannot pass the worker guard. Failed or interrupted work is not invented as success. Recovery requeues only within its retry policy and settles cancellation/exhaustion through CP composition without latching an otherwise healthy project into attention.
- Existing prepared facts are immutable and retain their producer lease attempt. Retry locates that original stage and rebuilds a new proof under the new lease; JSON/token possession does not mint a proof. Verifier proof maps bind task/lease/fact, retain file/directory descriptors, recheck identity/permissions/hash/current registry facts, reject symlinks/unlisted files, and explicitly release/close descriptors.
- Registry facts and actual blob bytes are checked against used assets and rights metadata; producer and verifier independently bind the plan/Script/Storyboard hashes, native clip identities/timing, narration, sidecar VTT bytes, settings/style, rights file and full described source manifest. Explicit roots include native implicit sidecars and metadata; resource errors at the modified digest boundary remain resource errors rather than false source-drift reports.
- Scheduler polls cancellation/lost leases, renews leases, frees slots on processor completion, reports unsettled processor contracts, and awaits admitted cleanup on close. Processor/verifier lifecycle depends on the caller closing scheduler first, as documented.
- **Component seam, not registered production handler:** CreationApplication does not instantiate/register this task processor/worker or `task.prepare`; its generic-reaper exclusions currently cover creation jobs. The processor integration tests explicitly use fixture eligibility/adoption ports and diagnostic synthetic media. Production task wiring, task reaper exclusions and Host close ordering belong to R1; adopted-source proof and review/commit belong to later released scope. Their absence is not an R0 defect, and this review does not attest them.

## Validation evidence and limits

Reviewer execution: tests/typecheck/build/render/browser/Host **NOT_RUN**, as instructed. MAIN alone used the reserved slot. At review completion MAIN sent orchestration message `msg_4dd18159746e`: `tsc --noEmit` exit 0 and 8 files / 123 affected tests exit 0. I read canonical `R0/checks.json`: both commands have exit 0, the original source HEAD, start/end times, log locations/hashes, and `all_requested_completed: true`. The 123-test count is MAIN-reported; no raw CLI logs were read. The source/test hash comparison independently matches the preserved bytes.

Thus MAIN affected validation is completed rather than pending; the additional R0-M01 regression is pending and nonblocking. This static PASS must not be interpreted as independent rerun, full A regression, real human voice/media acceptance, production integration, adoption, delivery, or R1–R4 acceptance. Any changes to the bound source bytes require corresponding delta review.

## Complete SHA256 — reviewed overlay source/tests

| Path | SHA256 |
|---|---|
| `src/host/agent-driven/created-draft-processor.ts` | `6727b0b64bc07cfdea0346e7f885d0ffcbd74832a66f939056735c66872eeef5` |
| `src/host/agent-driven/created-task-gate.ts` | `1a65d8f3e9950847decdea2478a2d8542bb33d5018119282c18144c2694a8860` |
| `src/host/agent-driven/created-task-store.ts` | `d7a4734cc9ed5924b7088a4cfaebecdd2ff202c373a9621c21078908f10e7b14` |
| `src/host/agent-driven/created-task-worker.ts` | `41a7658520d68a90be976690a9c27311f4be47a4a58776686e950ce3a563d4c4` |
| `src/host/agent-driven/local-asset-registry.ts` | `84ce639583427de6adfbf4dab892b9a77fd888de1c5f005d824d22bc3aca2e92` |
| `src/host/agent-driven/prepared-draft-verifier.ts` | `ffefbd4169dfd07930723e2606997845fc1bc4a1aa9d0f6b60b7bfd6eb5276db` |
| `src/host/engine/source-digest-v1.ts` | `d32dfc433865865749efd5e5f44f00eceff27b93d7607603c5eb9233708c599d` |
| `src/host/render/native-draft-assembler.ts` | `1b8a6bc403053091e74a3357815b35fddc3d9fb71aa5e8448782f66feb58877e` |
| `tests/agent-driven/integration/created-draft-processor.test.ts` | `a1df47e95f6bb7a8e7825ced877a9a03d74bfe5b899b131821e99c164f7bb3ec` |
| `tests/agent-driven/integration/created-task-gate.test.ts` | `238050e8eb0aa88c7badebe22ea639c7b88ba8e04c01b350af7b35f302e25aa3` |
| `tests/agent-driven/integration/created-task-store.test.ts` | `1c262f7c87979935c99f63a3aa6ab649f8c91d7af8c07d17b6e1b985943ca002` |
| `tests/agent-driven/integration/created-task-worker.test.ts` | `a3589079d3f53f9286947e194349c356e25118cde60f687171686ef0f7e0159e` |
| `tests/agent-driven/integration/source-digest-resource-boundary.test.ts` | `b6aa70b3fde614a30a43dbe0505c39d6dec1cae2e90c2c5eabbf6fac073c3ed5` |

## Complete SHA256 — supporting source inspected at relevant call sites

| Path | SHA256 |
|---|---|
| `src/host/agent-driven/creation-application.ts` | `20247ab174bc36bfc506a49126b80aa0ec784478f498f84b16121ad9581192f9` |
| `src/host/agent-driven/product-sqlite-repository.ts` | `e0beb9353f8f34fcdef9a5b434959f0b63c990aef3de8588cae25cea34a328a1` |
| `src/host/creative/fixed-workflow-service.ts` | `affb339613036d4b7a6572d63247f53754725a98488ae671c76b7317995aaf7e` |
| `src/host/creative/execution-guard.ts` | `e9ddb03a7d50b1f4e247405c7579beb7e6ccd311a714d3dd688a75322bba6010` |
| `src/host/persistent-job-store.ts` | `56dcb72f1784739ae2ebabf5d2eb8c74c76c0f1f5b6fe37432e910e4a4fdbe54` |
| `src/host/projects/revision-store.ts` | `fea46b6310be044d2c90b6c846b07e04600da286643411a53313680230978dae` |
| `src/host/render/native-draft-plan.ts` | `b4091aa1ffa786fe703a59296b291ae0485e5032e57f9aa4dfa31e9d37631d3e` |
| `src/host/render/native-draft-io.ts` | `4228400591b5561b795a72cfab551bed9b214378e6222b49f415b91ac0d7436a` |
| `src/host/server.ts` | `f1b9029158730bd24967361f4cd677b1d37c8c9474c1b0af7049e9ca5dd5025d` |

## Authority and validation record hashes

| Canonical path | SHA256 |
|---|---|
| `AGENTS.md` | `97ac5c36150c792e931087bc3e84686f11464f3bb59d6001d2b4996a5e42c26a` |
| `docs/agent-driven-v1/11_AGENT_DELIVERY_PROCESS.md` | `742b633d9a019bf650fc2126a7c05edec8b9a496a2782034fec623506063144f` |
| `docs/execution/A/relaunch-20261111/06_MAIN_REVIEW_AND_START_GATE.md` | `7e99137f5dfe9c245771dfed4e6715098422013c156f74fbeaa00581b3bddb7c` |
| `docs/execution/A/relaunch-20261111/04_COORDINATED_EXECUTION_PLAN.md` | `adb39810f0130dc11fbabcc0e2fe34f4a4448c24244d9c25b1e1943fa72d97b0` |
| `docs/execution/A/relaunch-20261111/02_MAIN_CONTRACT_AND_DECISIONS.md` | `27f5d38c8a492a857f01d0cb7e1d8032a13aeadf9492517252454faa4bb27899` |
| `docs/execution/A/relaunch-20261111/baseline-observed.json` | `f31f82d57a3eb2df6608b6fc47ffab68124ca8bb1e0d038c0c231838bd19e38a` |
| `docs/execution/A/relaunch-20261111/source-map.json` | `1c1818908c55cb88d31d9a7059295fb2de714723becc1896a79eaf8e79ebb5ad` |
| `docs/execution/A/implementation-20261111/R0/checks.json` | `c936e6c9f583ef9dbe36cb563f360a81151a9f09045e8772fb054b8945b553ea` |

## Complete end-of-review dirty list

Captured with read-only `git status --porcelain=v1 -uall`. MAIN added current authorization/document material during review; product source/test hashes above remained unchanged. Historical evidence paths below are inventory only, not inherited validation.

```text
 M AGENTS.md
 M src/host/agent-driven/created-task-gate.ts
 M src/host/agent-driven/created-task-store.ts
 M src/host/agent-driven/created-task-worker.ts
 M src/host/agent-driven/local-asset-registry.ts
 M src/host/engine/source-digest-v1.ts
 M src/host/render/native-draft-assembler.ts
 M tests/agent-driven/integration/created-task-gate.test.ts
 M tests/agent-driven/integration/created-task-store.test.ts
 M tests/agent-driven/integration/created-task-worker.test.ts
?? docs/agent-driven-v1/11_AGENT_DELIVERY_PROCESS.md
?? docs/execution/A/candidates/prepared-draft-verifier/HANDOFF.md
?? docs/execution/A/candidates/prepared-draft-verifier/candidate-manifest.json
?? docs/execution/A/candidates/prepared-draft-verifier/candidate.patch
?? docs/execution/A/logs/created-draft-chain/credential-scan-final.json
?? docs/execution/A/logs/created-draft-chain/credential-scan.json
?? docs/execution/A/logs/draft-processor-real-1794277917161/film.html
?? docs/execution/A/logs/draft-processor-real-1794277917161/observed.json
?? docs/execution/A/logs/draft-processor-real-1794278226017/film.html
?? docs/execution/A/logs/draft-processor-real-1794278226017/observed.json
?? docs/execution/A/logs/draft-processor-real-1794402206887/film.html
?? docs/execution/A/logs/draft-processor-real-1794402206887/observed.json
?? docs/execution/A/relaunch-20261111/00_READ_FIRST.md
?? docs/execution/A/relaunch-20261111/02_MAIN_CONTRACT_AND_DECISIONS.md
?? docs/execution/A/relaunch-20261111/03_OWNERSHIP_AND_DEPENDENCIES.json
?? docs/execution/A/relaunch-20261111/04_COORDINATED_EXECUTION_PLAN.md
?? docs/execution/A/relaunch-20261111/05_MAIN_ACCEPTANCE_AND_REVIEW.md
?? docs/execution/A/relaunch-20261111/06_MAIN_REVIEW_AND_START_GATE.md
?? docs/execution/A/relaunch-20261111/07_MAIN_HANDOFF.md
?? docs/execution/A/relaunch-20261111/IMPLEMENTATION_RELEASE.json
?? docs/execution/A/relaunch-20261111/architecture/VISUAL_REVIEW.md
?? docs/execution/A/relaunch-20261111/architecture/a-integration.html
?? docs/execution/A/relaunch-20261111/architecture/a-integration.json
?? docs/execution/A/relaunch-20261111/architecture/a-integration.visual-check.1440x900.dark.png
?? docs/execution/A/relaunch-20261111/architecture/a-integration.visual-check.1440x900.light.png
?? docs/execution/A/relaunch-20261111/architecture/a-integration.visual-check.2048x1320.dark.png
?? docs/execution/A/relaunch-20261111/architecture/a-integration.visual-check.2048x1320.light.png
?? docs/execution/A/relaunch-20261111/architecture/a-integration.visual-check.html
?? docs/execution/A/relaunch-20261111/architecture/a-integration.visual-check.json
?? docs/execution/A/relaunch-20261111/architecture/deliver-receipt.json
?? docs/execution/A/relaunch-20261111/artifact-manifest.json
?? docs/execution/A/relaunch-20261111/audit/COMPLETION_AUDIT.md
?? docs/execution/A/relaunch-20261111/audit/CREDENTIAL_EVENT.md
?? docs/execution/A/relaunch-20261111/audit/artifact-integrity.json
?? docs/execution/A/relaunch-20261111/audit/artifact-manifest.py
?? docs/execution/A/relaunch-20261111/audit/document-check.json
?? docs/execution/A/relaunch-20261111/audit/document-check.py
?? docs/execution/A/relaunch-20261111/audit/index-browser-check.json
?? docs/execution/A/relaunch-20261111/audit/index-headless.png
?? docs/execution/A/relaunch-20261111/audit/index-local-links.json
?? docs/execution/A/relaunch-20261111/baseline-observed.json
?? docs/execution/A/relaunch-20261111/bridge/ACCEPTANCE.md
?? docs/execution/A/relaunch-20261111/bridge/CLAUDE_PROMPT.md
?? docs/execution/A/relaunch-20261111/bridge/CLAUDE_READINESS.md
?? docs/execution/A/relaunch-20261111/bridge/DESIGN.md
?? docs/execution/A/relaunch-20261111/bridge/TASK.md
?? docs/execution/A/relaunch-20261111/contracts/asset-inventory-v1.registry.json
?? docs/execution/A/relaunch-20261111/contracts/asset-inventory-v1.schema.json
?? docs/execution/A/relaunch-20261111/contracts/review-media-v1.registry.json
?? docs/execution/A/relaunch-20261111/dispatch-specs/bridge-codex.txt
?? docs/execution/A/relaunch-20261111/dispatch-specs/media-codex.txt
?? docs/execution/A/relaunch-20261111/dispatch-specs/product-codex.txt
?? docs/execution/A/relaunch-20261111/implementation-prompts/bridge.md
?? docs/execution/A/relaunch-20261111/implementation-prompts/media.md
?? docs/execution/A/relaunch-20261111/implementation-prompts/product.md
?? docs/execution/A/relaunch-20261111/index.html
?? docs/execution/A/relaunch-20261111/media/ACCEPTANCE.md
?? docs/execution/A/relaunch-20261111/media/CLAUDE_PROMPT.md
?? docs/execution/A/relaunch-20261111/media/CLAUDE_READINESS.md
?? docs/execution/A/relaunch-20261111/media/DESIGN.md
?? docs/execution/A/relaunch-20261111/media/TASK.md
?? docs/execution/A/relaunch-20261111/orca-current.json
?? docs/execution/A/relaunch-20261111/orca-dispatches.json
?? docs/execution/A/relaunch-20261111/orca-final-observation.json
?? docs/execution/A/relaunch-20261111/orca-terminals-before.json
?? docs/execution/A/relaunch-20261111/orca-worktrees.json
?? docs/execution/A/relaunch-20261111/preparation-authorization.json
?? docs/execution/A/relaunch-20261111/product/ACCEPTANCE.md
?? docs/execution/A/relaunch-20261111/product/CLAUDE_PROMPT.md
?? docs/execution/A/relaunch-20261111/product/CLAUDE_READINESS.md
?? docs/execution/A/relaunch-20261111/product/DESIGN.md
?? docs/execution/A/relaunch-20261111/product/TASK.md
?? docs/execution/A/relaunch-20261111/source-map.json
?? docs/execution/A/reviews/draft-processor-pre-review/REVIEW.md
?? docs/execution/A/reviews/draft-processor-pre-review/closure-input-hashes.json
?? docs/execution/A/reviews/draft-processor-pre-review/input-hashes.json
?? src/host/agent-driven/created-draft-processor.ts
?? src/host/agent-driven/prepared-draft-verifier.ts
?? tests/agent-driven/integration/created-draft-processor.test.ts
?? tests/agent-driven/integration/source-digest-resource-boundary.test.ts
```
