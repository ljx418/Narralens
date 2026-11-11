# D09 scoped implementation and real003 verification

Result: bounded implementation completed with author/internal validation; independent REVIEW_PENDING. This does not sign R2 completion, a whole-product Gate, production availability or A/human acceptance.

Implementation source candidate: 10d97994df80ebc8e2ad95aaeba912709690b345. Tested source+test freeze: 0e07402859d8daef96eda391963e0e1b8c192c21. Implementation three files are byte-identical between those commits. Owned implementation: created-run-authority.ts, fixed-workflow-service.ts, product-repository.ts; tests: created-run-authority.test.ts, fixed-workflow-service.test.ts. Exact full input hashes are in inputs.json; argv/exit/log SHA/PIDs in result.json. MAIN readonly dependency manifests still match5d99e47, and original service81249 archival bytes remain unchanged.

## Behavior

Concrete Host dependency composition constructs same-RevisionStore product/impact/prepared stores and actual CreatedSourceFactsReader. A Host-only review transaction holds the real prepared read proof through full-plan verification and approval registration, releasing it in finally. Private transaction identity prevents a copied transaction from borrowing proof. Both approval digests bind the immutable D09 plan; durable plan/impact/hash/expiry/package/execution/input closure and actual source/rights/selection/native facts are reread. Canonical range/lock comparison uses the existing D09 canonicalizer. Confirmation replay returns the one original active approval; changed bindings refuse. The legacy five-field digest remains the ordinary branch; no route/schema/second state authority introduced.

## Actual case map

| Selected real003 case | Result |
|---|---|
| Real Host/bootstrap/SOURCE_ONLY/native reader approval, full digests, replay once, FD release | PASS |
| Validly rehashed false native-plan fact rejected, no approval, pending review, FD release | PASS |
| Wrong package version rejected, no approval, pending review, FD release | PASS |
| Missing actual immutable rights registration rejected with exact registry error; state/FD checks | PASS |
| Current selection differs from stored immutable plan; exact IMPACT_STALE, state/FD checks | PASS |
| Expired impact rejected with exact expiry error; state/FD checks | PASS |
| Actual creative intake revision differs; exact closure error, state/FD checks | PASS |
| Copied transaction refused while real proof held; rollback/no approval/FD release | PASS |

Exact reserved command: `corepack pnpm test tests/agent-driven/integration/created-run-authority.test.ts --maxWorkers=1 --minWorkers=1 -t "D09 real prepared"`. One run, exit0,8selected passed,17 unrelated filtered,0selected skipped. No source/index edits during run; all input hashes and HEAD unchanged. Command PID1788543/test Node1788595 and descendants tracked; none remained. All8 roots independently confirmed absent. Slot returned in msg_6cdc50d3a95e.

Light evidence: corrected test-only freeze tsc exit0; pure canonicalization counterexample1pass; earlier isolated workflow/SQLite48pass and old-code5fail/43pass are retained at their original input manifests, not relabeled as tests of this newer freeze. Real001 remains FAILED/provisional (raw-range-order defect); real002 remains FAILED (two exact test expectations wrong and their subsequent assertions NOT_RUN). Real003 runs corrected expectations after state/FD checks; prior failures were not erased.

## Scoped author review and remaining limits

Reviewed owned three-source delta after source freeze: actual authority owns the transaction/proof association, full-plan and current-fact joins precede registration, readonly MAIN dependencies unchanged, confirmation dedup uses existing approval rows, finally releases proof, and no public contract/state machine changed. Pure normalization regression covers the observed native-order counterexample. This is author review, not independent review.

Fixture limitations: package part refs are isolated publication metadata; no actual preview transport/human approval claim. Rights fault injection deliberately deletes immutable registry rows after dropping only the fixture deletion guard; it is not a production rights-revocation API. Selection is a controlled Host port in the fixture; no browser/native acknowledgement asserted. Wrong-transaction coverage is copied-object proof refusal, not a claim of exhaustive cross-DB attack coverage. No production composition edit, official render, full gate or B work ran.

MAIN retains production creation-application wiring of prepared Host dependencies, readonly root work and independent integration/review. R2/whole A acceptance remains pending. No additional feature or heavy scope is claimed by this report.
