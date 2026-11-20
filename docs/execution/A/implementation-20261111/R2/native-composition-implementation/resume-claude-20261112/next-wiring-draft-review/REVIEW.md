# Next wiring draft gap review

**DRAFT_GAP_REVIEW_NOT_FINAL_RELEASE_PASS**

The draft preserves the correct single-DB/single-owner direction, but needs changes before an implementation release. The absent accepted014 commit is an acknowledged prerequisite, not a new blocker raised by this review. No current014 writer was interrupted and no runtime, test, Host, browser or media command was executed.

All six manifest source hashes and all four draft document hashes match. The S01 appendix contains all 28 original IDs with exact level, steps, expected result and NOT_RUN status; there are no duplicates. HC08 no-session0 is explicitly superseded by persistent epoch, correctly retaining legacy mode. Atomic bootstrap permit/four-quadrant migration, same-instance Ack/Context final fences, real SIGKILL/FD9 and human/A-film limits are preserved in intent.

Findings below are document findings, not new acceptance-case IDs. References under shared-selection/native/host-recovery are relative to canonical R2; MAIN source observations are read-only live observations, not claims about a frozen014 candidate.

## NW-D01 — MAJOR: CONTRADICTORY_EVENT_ORDER

The draft orders real selection mapper before S01 pending/finish. The authoritative S01 contract requires accepted pending_token and fresh CAS to COMMIT before invoking the asynchronous mapper. A literal implementation permits a crash or business currentSelectionVersion read to miss accepted work.

Evidence: next-wiring-draft/01_CONTRACT.md:34; shared-selection-authority-design/CONTRACT.md:132.

Minimum change: Replace the arrow with authenticated ingress/sequence/profile check -> same-DB acceptMapping pending COMMIT and live-loaded revocation -> async mapper -> finishMapping final CAS -> fresh Expected/permit. State that document/hydration Expected proof may start from the epoch face without prior mapping, and add explicit pending-commit-before-mapper and crash barriers using original S01-E02/E05/R01/D01 IDs.

Existing acceptance linkage: No new case numbering: reuse S01-E02/E05/R01/D01 and original native A02.

## NW-D02 — MAJOR: PUBLIC_PRODUCER_PREREQUISITE_AND_DEPENDENCY

W3 says wiring existing Change/Adoption/Publisher plus trusted review, but no concrete owner/path/output chain produces the prepared preview receipt, immutable ReviewPackage, registered media binding, trusted review/confirmation/approval and prepared-source package association. Observed CreationApplication explicitly supplies no media binding producer and has no change.prepare/apply handlers. W2 is assigned all event/lifecycle cases before W3, although S01-P01 and real S/A/H acceptance require that public chain. Component W2 can precede W3; full production acceptance cannot.

Evidence: next-wiring-draft/02_DEVELOPMENT_AND_ACCEPTANCE.md:10; next-wiring-draft/02_DEVELOPMENT_AND_ACCEPTANCE.md:11; next-wiring-draft/01_CONTRACT.md:14; MAIN:src/host/agent-driven/creation-application.ts:63; MAIN:src/host/agent-driven/creation-application.ts:113; MAIN:src/host/agent-driven/creation-application.ts:159; host-recovery-composition-review/RELEASE_RECOMMENDATION.json:public_producer_followup.

Minimum change: Add a proposed public-producer subpackage and exact intended existing/new paths before release, naming PreparedPreviewService, FixedWorkflowService.publishReviewPackageInScope, prepared.bindPackage/media binding authority, trusted UI decision/approval producer, real Change/Adoption handlers and recovery admission gate. Separate W2 component evidence from W2+W3 real acceptance to avoid a dependency cycle. Reuse original public contracts and do not seed accepted policy/rows as end-to-end evidence.

Existing acceptance linkage: Bind S01-P01, original H01/H03, HC06/HC07/HC11/HC13 and J04 to this prerequisite; absent producer remains NOT_RUN rather than a pass.

## NW-D03 — MAJOR: EXACT_HANDOFF_PATHS_AND_PRIVATE_PORT_BINDING

The draft names entities and promises a later exact ReleaseAssignment, but offers no proposed path inventory or private method binding table. It lists native-selection-mapper as an existing entity, while the inspected source has NativeSelectionMappingPort only, with no implementation file of that name. Ack record currently accepts only data and Context port has read only; a phrase about a permit/final fence does not define constructor-only validator ownership, transaction scope, single-use consumption, replay or read-lease release. Old HC recommendations also contain superseded reader filenames and broad DDL protection that cannot serve as the new exact allowlist.

Evidence: next-wiring-draft/01_CONTRACT.md:12; next-wiring-draft/01_CONTRACT.md:36; next-wiring-draft/03_CLAUDE_HANDOFF.md:5; MAIN:src/host/m5/native-observation.ts:202; MAIN:src/host/m5/native-ack-store.ts:83; MAIN:src/host/agent-driven/project-context-service.ts:19; shared-selection-authority-design/ACCEPTANCE_AND_RELEASE.json:release_recommendation; host-recovery-composition-review/RELEASE_RECOMMENDATION.json:release_groups.

Minimum change: Prepare an explicitly PROPOSED path/owner/protected/test inventory and existing-versus-new port table now, to be re-anchored after accepted014 commit. Include mapper implementation path, S01 bootstrap constructor binding, same-DB Ack permit issue/validate/consume and Context read-lease/final-assert/release APIs, plus HC13 child/constructor-only barrier paths. Keep public DTOs/cp_a0/nine-field commit unchanged; no raw DB/callback provided by callers. This requests a draft proposal, not the currently pending accepted commit.

Existing acceptance linkage: Final release must bind each W package, original cases and protected files to exact paths and one writer, with private signatures independently reviewed.

## NW-D04 — MAJOR: LIFECYCLE_PARTIAL_ORDER_AND_RECONCILIATION

One owner and DB-last are correct but insufficient as an executable lifecycle. The draft does not schedule S01 settleInterruptedObservations/reconcileBaseline relative to dedicated recovery, generic recovery/reaper, worker/listener admission and normal prepare/apply/native/context calls. Nor does it define how public revoke/stopAdmission differs from keeping business-read authority alive for accepted recovery, or when failed drain prevents closing DB/native roots. Those are critical original invariants, not optional final implementation details.

Evidence: next-wiring-draft/01_CONTRACT.md:42; next-wiring-draft/02_DEVELOPMENT_AND_ACCEPTANCE.md:12; shared-selection-authority-design/CONTRACT.md:43; shared-selection-authority-design/CONTRACT.md:140; shared-selection-authority-design/CONTRACT.md:159; shared-selection-authority-design/CONTRACT.md:161; host-recovery-composition-review/ACCEPTANCE_CASES.md:Common real harness and evidence.

Minimum change: Add one explicit startup and shutdown dependency table with operation owners: owned FD9/original DB -> S01 migration/validation -> pending settlement/baseline reconciliation -> dedicated and generic recovery/reaper gates -> public/task/native admission; reconcile before each new prepare/apply/native/context round and after real baseline/control changes, pure comparison inside final guards. On shutdown revoke ingress/live-loaded, drain raw acquisitions/scans/adoptions/mappers/probes/cache calls while their dependencies remain readable, stop native before workspace disposal, then close selection/dependencies/DB under exact ownership. Preserve primary plus cleanup and fail honestly on unresolved processes.

Existing acceptance linkage: Bind existing S01-C02/R01-R03/L01-L02, J01-J05 and HC01/03/09/10/13; actual IPC/pid/start/FD9/descendant exit evidence remains required.

## NW-D05 — MAJOR: ROLLBACK_OLD_ZERO_MODE

Rollback is described as closing only new mounted entries/capabilities while retaining data. On a binary without S01, original created paths can still use session-local/default selection0. Merely removing the new wiring can therefore re-enable the very old-mode write/Context behavior prohibited by the authoritative rollback contract.

Evidence: next-wiring-draft/02_DEVELOPMENT_AND_ACCEPTANCE.md:41; shared-selection-authority-design/ACCEPTANCE_AND_RELEASE.json:rollback_preservation; MAIN:src/host/agent-driven/project-context-service.ts:35; MAIN:src/host/m5/native-observation.ts:559.

Minimum change: State that rollback to an incompatible binary puts affected created writes/native loaded claims into explicit read-only/unavailable mode; bootstrap, prepare/apply, recovery authorization and Context must not silently use legacy0. Preserve ledger/schema/receipts and resume only a compatible audited binary. Separate untouched Hypit/migrated legacy mode and already-true committed receipts.

Existing acceptance linkage: Use original S01-X01/B04 and rollback provenance checks; do not add down migration, erase history or turn missing authority into0.

## NW-D06 — MAJOR: 014_CACHE_AND_POOL_ROUTE_OWNERSHIP_BINDING

The draft correctly defers to accepted014 and rejects browser witnesses/global singleton pools, but does not map controlled native GET/background cache producer paths to the trusted wrapper, issued workspace/ref/generation registry, shared explicit pool and shared-browser owner. Without this binding the new stage can leave a normal native cache path bypassing witnessed production, or create per-proof budgets/close a peer producer. This is a missing next-stage wiring contract, not a finding about the ongoing014 implementation.

Evidence: next-wiring-draft/01_CONTRACT.md:11; next-wiring-draft/01_CONTRACT.md:16; next-wiring-draft/01_CONTRACT.md:42; G01_G07_CONSOLIDATED_014_RELEASE.md:3-7; G01_G07_MAIN_DESIGN_CONSTRAINTS.md:G04/G07.

Minimum change: Add a proposed call/ownership table for each native cache-producing route/background action and reader/mapper/proof acquisition. Specify trusted source of producer parameters, where issued witnesses are registered/revoked, behavior for unknown pre-existing cache/cache-hit and new workspace/restart, and explicit pool injection shared across both trees and parallel proofs. Name last-browser-owner close/drain and workspace disposal order. Rebind actual signatures only after014 acceptance; do not invent new persistent witness authority.

Existing acceptance linkage: Plan existing R04/J03/J04/H02 and014 G04/G07 interface-consumption regressions including stale/foreign witness, cache-hit without witness, budget accounting and peer-owner drain; never count a test-only registry as production wiring.

## NW-D07 — MINOR: REFERENCE_CLOSURE_AND_ENVIRONMENT

All six declared input hashes and four draft hashes match. However the handoff asks for Native design semantics while manifest omits native-source-composition-design/DESIGN.md; the three shared MAIN decisions and current014 architectural constraints are also not bound. Source root is only indirectly discoverable through referenced historical files, and the provisional handoff does not list planned evidence roots/command partitions. This leaves an avoidable stale-document/file-name ambiguity before final re-anchor.

Evidence: next-wiring-draft/manifest.json:source_inputs; next-wiring-draft/00_READ_FIRST.md:7; next-wiring-draft/03_CLAUDE_HANDOFF.md:5.

Minimum change: Extend the draft input manifest with actual referenced DESIGN and applicable MAIN decisions/014 constraints, record explicit canonical-doc root versus actual MAIN implementation cwd, and mark their live or historical authority. Add planned evidence root and test-category/IPC seam inventory; final exact hashes/argv/accepted commit remain the known future release gate, not something requested now.

Existing acceptance linkage: Recompute manifest after draft correction; preserve original IDs and all source-doc hashes as immutable references.

## Minimum handoff

First correct the durable-pending event order and fail-closed rollback. Then propose the exact private ports/path inventory, real public review/prepare/apply production chain, startup/close dependency schedule and native GET/pool/witness route table. Update the input manifest. These are planning changes in this draft, without authorizing implementation or asking for the intentionally pending accepted commit now.

Final release remains MAIN-owned: wait014 full original requirement evidence, actual writer handback, real commit and independent acceptance; bind exact ports/paths/runtime argv then. No new R IDs, no waived original cases, no external PASS or Studio/A/V1 readiness is asserted. Only this review directory was written.
