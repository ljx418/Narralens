# A-MEDIA-2 — R2 source adoption proof cooperation

Status: PREPARED_NOT_RELEASED; 2026-11-12. This dispatch authorizes these three documentation files only, not code, tests or Claude startup. Current A authorization supersedes historical sealed NOT_RELEASED prose; MAIN must still release this exact R2 writer scope. No new architecture or human approval gate is proposed.

## Baseline and authority

Implementation reference: immutable integrated `de086f32c48c44fb72d0212ef80365f1c786408c`, inspected using git show, not local working source. Local HEAD remains `c8a06729c2a58d0e79c40042f3155c558ca6fd11`; no reset/merge/index operation. Prior dirty artifacts remain intact (HANDOFF). Preserve fixed preview `7b7b55cbdd8afb85470b07e2981ca103dd32e493` and its scoped independent PASS; this is not a repeat R1 audit. MAIN's integrated component/browser/Host evidence is historical evidence, not R2 execution or full A acceptance.

Authority: canonical docs/execution/A/relaunch-20261111/02_MAIN_CONTRACT_AND_DECISIONS.md D01–D15, 04_COORDINATED_EXECUTION_PLAN.md R2, media/DESIGN.md, media/ACCEPTANCE.md, implementation-prompts/media.md; latest canonical implementation-20261111/CONTINUE.md. Read alongside local AGENTS and delivery process. Frozen cp_a0 namespace/31 tools/80 definitions, EnginePort seven methods, strict409, original DB/queue/Coordinator remain unchanged. No B, render-phase implementation, Delivery, new timeline or clock.

## Exact proposed MEDIA path set — four, pending MAIN release

|Path|Current status / proposed purpose|
|---|---|
|src/host/agent-driven/prepared-draft-verifier.ts|Existing; only concrete caller-driven proof/closure defect correction if required, preserve established preview semantics|
|src/host/render/assembly-ports.ts|Existing; only agreed Host-only typing needed for real adoption caller, no duplicate preview DTOs or generalized redesign|
|tests/agent-driven/integration/created-draft-processor.test.ts|Existing; extend real SOURCE_ONLY/no-live-lease and cancellation/fence coverage|
|tests/agent-driven/media/prepared-source-adoption-proof.test.ts|Proposed new focused tests for proof purpose, complete binding, rights/bytes revalidation and release|

This is a maximum proposed subset, not a promise all four need edits. Existing working methods should be consumed unchanged when adequate. Shared fixture tests/agent-driven/integration/helpers/created-draft-fixture.ts is read-only dependency; changes require its actual owner. No other source/test path is assigned by this document. MAIN owns composition root and release alignment; BRIDGE owns adoption/change/publisher/typed transaction/DDL. Contract and preview files remain read-only.

## Existing interface and concrete dependency requests

Existing CompletedPreparedSourceV1 carries original TaskReservation, successful JobReceipt, terminal_reason SOURCE_ONLY, local.native-draft@1 provider receipt, PreparedTaskFact, actual producer_attempt and private source root. Build it from real persistent task/job/fact data, never fabricate a lease or use terminal attempt in place of producer attempt. Existing PreparedSourceIdentityV1 binds project/run/execution/prepared identity/job/fact/base/control/source/selection. Read purposes impact/preview are distinct from adoption; adoption additionally binds transaction_id, impact_id/hash, plan_sha256, approval_id and target_snapshot_id. proveForRead/assertCurrentForRead and proveForAdoption/assertCurrentForAdoption already exist; release/close own FD lifetime. Opaque proof identity cannot be recreated by JSON. Final assert's assertCurrentAuthorAndRights callback is synchronous, invoked around filesystem revalidation; Promise/no-op callbacks cannot replace real authority checks in production.

1. MAIN composition request: expose an explicitly lifecycle-owned verifier to the BRIDGE adoption caller, reusing current construction where possible; current CreationApplication constructs it for processor use. BRIDGE supplies authoritative completed-source lookup and real synchronous author/rights check on the same DB and Coordinator. No MEDIA DB reader or parallel state machine.
2. BRIDGE publisher sequencing request: immutable prepared root must survive full-tree copy/stage/publish until proof release; moving it invalidates its open-FD/root proof. The proof authenticates original prepared bytes, not an arbitrary copied target root. Publisher must validate staged/published complete closure against the same fact/digest, bind its journal and rights, and provide final typed commit validation. Pin the exact phase callbacks: before publication compare live old author/base; after swap validate approved old baseline through authoritative transaction/backup plus current target closure, not old source_digest against new author. Do not bypass this with a no-op callback or rewriting proof.root. This is a concrete calling-sequence closure for D09/D10, not a new public contract.
3. BRIDGE CreatedSourceChangeService prepare/apply, CreatedSourceAdoptionService/publisher and MAIN RevisionStore.commitPreparedCreatedSource are planned R2 dependencies, absent at the inspected base. Original review.decide automatic apply and Agent change.apply must converge on the same approval/impact transaction; compatibility change.approve cannot mint a second approval. Source kind remains assembled_native_source, never fake M3 row/migration.
4. Actual capabilities remain factual dependencies: clip.prepare, snapshot.render, qc.inspect, delivery.package. Current application does not wire the full descriptors/readiness callbacks; partial manifests cannot report ready. Continue independent proof tests, but mark blocked real admission scenarios honestly. Do not demand R3/R4 implementation in this ticket or hardcode available to unlock R2.

No discovered need to alter frozen public contracts. If concrete implementation cannot satisfy these existing obligations, return exact caller/type/phase counterexample to MAIN rather than quietly redesigning it.

## Acceptance mapping and end-to-end obligations

All R2 execution below is NOT_RUN. MEDIA module evidence and BRIDGE/MAIN integrated evidence are separate.

|Cases|Real sequence / positive assertion|Negative and recovery assertion / owner|
|---|---|---|
|M01, M07|Real task.prepare → original worker → successful SOURCE_ONLY with durable source fact; lease released; author/revision/pointer unchanged|Cancel before/after prepare, lost lease, late finish/record cannot publish or mutate author; recover new valid proof, release all FDs; MEDIA processor + BRIDGE worker|
|M08, M17|Read impact/preview from completed source without reclaiming successful Job; acquire separate adoption proof for approved transaction|Read proof as adoption, fabricated JSON, cross-project/run/execution/job/fact/transaction/impact/approval/target/base/control/selection rejected; no author/revision change; MEDIA focused tests|
|M03, M11|Real trusted review accept_and_adopt plus concurrent Agent apply consume one approval/impact; source_fact/snapshot/pointer/outbox/revision+1 atomically; successful source Job retains no live lease|Duplicate/different request keys converge or conflict correctly, no second approval/+1, cross-owner/origin refused; BRIDGE created-source-change/adoption tests|
|M12, M17|Current complete film/settings/subtitles/assets/rights closure matches immutable fact and approved plan through final validation|Same-size byte replacement, missing/added closure input, symlink/root replacement, rights revoke, pause/cancel/scope revoke, stale selection/control/base, changed lock/consumer graph fail with +0; TTL 15min not renewed by replay, expiry rejected; MEDIA proof + BRIDGE authority|
|M13|Full private stage/backup/journal publish under original Coordinator; final typed transaction binds exact source_fact and snapshotIdFor|Real kill/reopen at old→backup/new→author gap, publish-before-DB, DB-before-outbox: recovery fence hides half-tree, restore old closure or finish exact approved commit, never bootstrap/recommit/+1 twice; BRIDGE/MAIN harness, not exception-only simulation|
|M04|CommittedSnapshotAuthority opens new committed closure and source fact; PRODUCT independently observes native loaded projection|No fabricated loaded ack, no stale generation acceptance, same editor/clock; PRODUCT/MAIN integration dependency, MEDIA does not edit UI|
|M20|New created_* facts preserve original cp_a0 fingerprint|Reject namespace/schema corruption; BRIDGE schema tests, no MEDIA DDL changes|

Each scenario records immutable SHA+dirty, input/fact/closure hashes, job/producer attempt, before/after source/revision/pointer and relevant approval/impact/transaction/outbox, command exit/log hashes, owned processes/FD cleanup. Synthetic assets and component fixtures remain labeled; no product readiness claim from them. Real authorized media inputs are MAIN-provided, no J disk lookup or paid call.

## Future commands and resources (none run now)

After exact release and local offline dependencies confirmed, use actual release cwd. No installation prompt accepted. Proposed module commands:

- `corepack pnpm exec tsc --noEmit`
- `corepack pnpm test tests/agent-driven/integration/created-draft-processor.test.ts tests/agent-driven/media/prepared-source-adoption-proof.test.ts --maxWorkers=1 --minWorkers=1` (new file must first exist)
- `corepack pnpm test:contracts`

MAIN/BRIDGE integrated commands after their planned files exist: `corepack pnpm test tests/agent-driven/integration/created-source-change.test.ts tests/agent-driven/integration/created-source-adoption.test.ts tests/agent-driven/integration/created-source-process-recovery.test.ts tests/agent-driven/integration/created-schema-upgrade.test.ts --maxWorkers=1 --minWorkers=1`. Confirm exact released filenames before invocation; these are planned test targets, not claims of existing runners. MAIN supplies real Host kill/reopen harness invocation and target PID ownership, not an invented script. No blanket preview re-review; any actually affected preview regression is selected with MAIN while preserving fixed7b evidence.

Heavy single slot from MAIN required for real Host/multi-Host, media, browser, build/full check and large fixtures; all headless/quiet. Lightweight isolated module checks only as released; no increased concurrency. Unique local DB/var/dist/staging/profile/node_modules; upstream vendors read-only. No shared writable runtime or restart of old children.

## Delivery, rollback and stop rules

After MAIN release, same-directory configured Claude CLI is concrete implementation/self-test writer; Codex documents first then reads only during Claude writes. Freeze candidate SHA and truthful case evidence before Codex review. No auto-push/merge or all-path add; only explicit owned files. MAIN owns integration/independent review and A human gate. Failures/NOT_RUN remain visible.

Before commit failure leaves old authority intact; publish gaps recover using same journal/Coordinator, restoring complete old closure or completing the exact approved transaction. After committed adoption use authorized forward change/recovery, never reset user revision or overwrite source fact. Retain source candidate, backup and failed evidence until authoritative recovery/ownership permits cleanup. No git reset/stash or global process kills.

429 transfer: record actual error and in-flight state; prove original Claude and descendants stopped, preserve dirty bytes/HEAD/logs, then record unique writer transfer before Codex implements authorized remainder. No inference of exit from silence or settled status. More than two stage reworks go to MAIN for common-root-cause handling. Current credential disposition UNKNOWN; never read credentials/config/env or switch provider. This ticket ends at documentation readiness, not code acceptance, external review, A PASS or B entry.


## MAIN dependency-order supplement — msg_64f49744bbf5

This supplement supersedes only the earlier exclusion of render-phase implementation from the proposed future scope and the four-path total: MAIN now requests preparation of the early R3 media slice alongside R2, still with NO code release. It is not a restart of the completed documentation task or old Claude. D05/D11/D14/D15 and separate R2/R3 acceptance remain unchanged. R1 exact release excluded these stages; their absence is expected, not an R1 failure. Existing adoption proof is reused, not rewritten.

### Exact added owner paths: five (combined proposed scope nine)

|Path|Status at de086 / bounded work after release|
|---|---|
|src/host/render/ports.ts|Existing; MEDIA pure Host-only encode/inspect/publish inputs, receipts and persistence handoff interface types, agreed with BRIDGE|
|src/host/render/committed-render-phases.ts|Absent; MEDIA implementation of the three media stages, reuse existing renderer/QC/package store|
|src/host/render/render-snapshot.ts|Existing; extract reusable stage logic and preserve existing diagnostic/full facade compatibility, never wire whole facade as chapter-stage executor|
|tests/agent-driven/media/committed-render-phases.test.ts|Absent; MEDIA stage isolation, receipts, cancellation, reuse and cleanup tests|
|tests/agent-driven/media/render-snapshot.test.ts|Existing; compatibility regression for extraction|

All five are media-Claude owned in reviewed03; exact MAIN release still controls. native-renderer.ts, snapshot-copy.ts, delivery/qc.ts, published-package-store.ts and manifest.ts are existing read-only dependencies for this minimal slice, not implicitly added writable paths. BRIDGE exclusively owns fixed-phase-executor.ts, created evidence/phase stores and migrations, guards, approvals, Job/ready/outbox and actual capability registration; MAIN owns assembly and resource reservation. No frozen wire DTO/SQL changes or new route. The proposed new adoption-proof test from the first slice remains an explicit MAIN release request, not inherited blanket03 authorization.

### Producers, consumers and stage handshake

Proposed method names prepareEncoded / inspectEncoded / publishValidated follow the reviewed design; MAIN freezes the concrete names/types once with BRIDGE before implementation. Existing RenderRequest, SnapshotReadPort, AttemptFencePort, NativeRenderPort, RenderBoundaryHooks and PublishedPackageStore are reused, not parallel render machinery. New internal phase results must not return RenderOutcome ready to imply DB readiness.

- **encode**: BRIDGE executor supplies current snapshot.render execution/fence, real committed SnapshotReadPort closure, original render Job/producer lease attempt, RenderRequest config/supplements and abort signal. MEDIA copies/verifies committed closure, runs real native renderer, waits actual close, validates bytes and returns immutable encoded-object receipt. Receipt supports D14 EncodedFactV1: project/job/producer_execution/producer_lease_attempt/snapshot/source/render_spec/config_digest, media_object_id/hash/bytes, expected_frames/fps, created_at, plus closure/rights and immutable supplement references required for later validation; no fabricated QC pass. MAIN/BRIDGE allocates Host private object domain/ownership, persists exact bytes with file+directory fsync and registers original Job-bound append-only encoded fact in the same DB/fence transaction. Precise durable-object writer/ack callback must be frozen: MEDIA cannot discard transferred bytes before durable registration acknowledgment, nor claim durable fact from filesystem receipt alone. Failure between fsync and registration leaves owned orphan for reconciliation, not a public ref.
- **inspect**: executor resolves registered encoded fact and privately opens the same object with verified hash/size/config/closure/rights. MEDIA reuses runQualityControl for full ffprobe/decode and required native/subtitle/license supplements, producing immutable QcReceipt with parent encoded digest, exact media hash, profile/config/rights digests, checks and evidence refs/hashes. BRIDGE records qc_inspected under the same delivery Job used later for package, not a new QC Job. MEDIA neither accepts a gate nor creates a DB fact. Technical pass still requires real D15 human QC review; block cannot be accepted, warnings require complete bound dispositions.
- **publish**: executor supplies same delivery Job and current execution/lease, exact encoded+QC facts, current rights, accepted original chapter/cover and QC gates, and actual warning dispositions. MEDIA verifies references/bytes and current fence, reuses buildDeliveryManifest/PublishedPackageStore.publish with no-clobber semantics and returns real immutable package receipt. BRIDGE persists phase/ready/outbox under its own final current guard transaction. Receipt/manifest attempt is actual publication winner, distinct from encode producer and current lease. A receipt alone never authorizes ready/download. Existing receipt is rehashed/reconciled before creating output; cancelled/revoked work cannot be auto-readied, and published winner is retained.

created_render_evidence key stays (project_id,job_id,execution_attempt,phase), encoded|qc_inspected and parent digest; created_delivery_phase_fact remains append-only qc_inspected|package_published with no alternate state machine. Encoded Job is render; QC/package share snapshot_publish Job, preserving business execution across lease renewal. Do not require equal encode/delivery Job IDs or attempt numbers. D15 awaiting review releases lease and queues same delivery Job while step waiting_user; BRIDGE filters pending gate to avoid busy claim/inspect, then fresh lease after actual decision. MEDIA holds no FD/worker across user wait: reopen/hash/close on each call. Abort/error closes owned readers/children; uncertain process exit reports requires_reconciliation, never frees a retry claim by assumption. Cleanup deletes only untransferred UUID staging, never registered immutable objects or published winner.

Concrete shared interface requests are durable-object ownership/transfer acknowledgment and resolver lifetime, exact receipt canonical serialization/digest/profile lineage, and executor guard/capability registration timing. They implement existing D14 semantics; no new architecture decision is delegated to Claude. Four capabilities become available only after real producer AND guarded consumer assembly; pure media functions alone do not satisfy admission. Independent module development may proceed after release while that wiring is pending; actual Run tests remain honestly blocked until ready.

### Additional cases, commands and recovery (all NOT_RUN)

M09: chapter/cover encode produces genuine object+encoded fact, zero QC acceptance/package receipt/ready/download; premature publish denied. M10/D14: crash after object fsync before fact is orphan reconciliation; after registered encoded fact reopen/hash and inspect same object without a second encode. M14/M15: same delivery Job QC→human wait→package, new lease with unchanged execution, late old lease denied; existing receipt replay creates no second encoding/object/package. M18/M19: technical pass pending gate blocks publish, wrong package/quality/warn IDs and hard-block accept denied; restart wait preserves facts and no worker occupancy. MEDIA tests receipts and boundary behavior; BRIDGE integrated tests prove real same-DB guards and waiting semantics.

T20-A/B/F: write failure/nonzero encode/truncated or tail-corrupt decode/missing supplement/changed rights or same-size bytes must fail without ready. T20-C/D/G: concurrent winner preserved, cancellation stops owned descendants or reports reconciliation, old committed snapshot remains independent of a newer edit. T20-E1..4/H: MAIN real owned-process kill/reopen verifies immutable encoded/QC/publication/DB-outbox boundaries and repeated reads without business work; exceptions alone are unit evidence, not recovery acceptance. These remain R3 evidence gates even when implementation is scheduled early; R2 adoption/native gate is independently required.

Additional future single-worker command after files exist and MAIN heavy slot: `corepack pnpm test tests/agent-driven/media/committed-render-phases.test.ts tests/agent-driven/media/render-snapshot.test.ts --maxWorkers=1 --minWorkers=1`; affected existing QC/package-store tests selected with MAIN if extraction changes their call flow. Existing tsc/contracts commands remain. BRIDGE planned combined targets are `tests/agent-driven/integration/created-render-delivery.test.ts`, `created-delivery-recovery.test.ts` and `created-qc-review.test.ts`; MAIN releases actual harness commands for real kill/reopen and media tools. No tests or tooling install executed for this supplement. Same shared heavy slot, quiet Headless, isolated roots, retained failed artifacts and 429/>2-rework rules apply. Rollback keeps legacy facade callable and gates unavailable until correct wiring; never delete registered objects to hide an incomplete transaction, never reset DB/old candidate.


## EFFECTIVE IMPLEMENTATION RELEASE — 2026-11-12

MAIN task task_8fb0a15c6712 / dispatch ctx_1002e7bfb3b2 authorizes actual R2 plus early R3 foundations. This section supersedes all PREPARED_NOT_RELEASED/no-execution and proposed-only language above for the exact released scope. Base HEAD 51b84015981ce2a2e5fc281b4ec302f7742ee984; common source 0c1b73cbe384938083482355aaba8eb548c7971b equals de086. Protocol/release commit dd2be1f08e65305dac6d0e4ecb05a03e1875e5b2, frozen contract ca5b67a8285b130c79055317c6202f73cfbb99c8. Canonical R2/INTERFACE_LOCK.md SHA256 e25140ff5e71272f042387804fb75b751cf576621eb99c381dc93c221c529b17 and releases/media.json SHA256 bf21df6d37c8e16439ba5b1c5aae51bef2c731b8b3966a9245d6a6fba70eef37 verified against actual bytes and git blobs. Read those full files as binding instructions.

Exact nine writable product paths:
- src/host/agent-driven/prepared-draft-verifier.ts
- src/host/render/assembly-ports.ts
- tests/agent-driven/integration/created-draft-processor.test.ts
- tests/agent-driven/media/prepared-source-adoption-proof.test.ts
- src/host/render/ports.ts
- src/host/render/committed-render-phases.ts
- src/host/render/render-snapshot.ts
- tests/agent-driven/media/committed-render-phases.test.ts
- tests/agent-driven/media/render-snapshot.test.ts

L01: unique MEDIA writer; early real typed ports candidate commit after light tsc, no any/runtime stubs/duplicate DTOs. L02: BRIDGE owns opaque publication proof and same-DB bounded commit scope; retain original prepared proof/root, phase-specific authoritative validation. L03: full canonical prepared-plan digest and single approval belong BRIDGE. L04: existing real publishReviewPackage produces legitimate Context.artifacts Ref; MEDIA returns real immutable objects, no fake artifact rows. L05: PRODUCT/BRIDGE own separately counted native observation ingress and independent expected/ack, not MEDIA source. L06: actual request013-f699-p2-hr1 plus eight posthashes and fixed015 inputs, not stale198c active metadata; MEDIA does not alter pins or UI. L07: implement exact CommittedRenderPhasesPort prepareEncoded(RenderRequest), inspectEncoded({request,encoded}), publishValidated({request,encoded,qc}) with exact EncodedFactV1/QcReceiptV1/PublishedPhaseReceiptV1 fields and canonical receipt hashes, constructor typed dependencies exported in ports.ts; resolver openPhaseObject exact input and bounded <=1MiB read/close. L08: continuous scoped development, heavy single-slot and separate R2/R3/T20 gates.

L07 OVERRIDES earlier DB-ack cleanup proposal: MEDIA fully writes/hashes/fsyncs files and directories then publishes immutable private object and returns receipt; successful objects are NEVER removed by close or later failure, do not wait for DB acknowledgment to close FDs. BRIDGE separately registers/reconciles DB facts and private orphans. QC writes separate immutable object, never alters encoded object. PublishedPackageStore remains sole public publisher. Reopen and validate on each phase; no FD across human wait. Exact receipt fields in lock win over earlier illustrative field lists. Current attempt fences at each await/publication and BRIDGE final transaction; technical pass is not QC approval. No hardcoded four-capability readiness.

Preflight: original35 protected hashes verified unchanged before this authorized R2 documentation append, source diff and product index empty; R1 evidence untouched. Old Claude PID735622 has no descendants and rendered idle prompt; reuse terminal only with NEW Orca R2 task, keep-open, no resumed old failed assignment. Codex now transfers exclusive file/index/runtime writer to that single child; parent read-only until explicit child handoff. Child records actual new task/dispatch/terminal in HANDOFF as its first documentation action; no stale IDs. Existing provider/config untouched; session-reported model only or UNKNOWN.

Child must report first coherent ports.ts type commit + exact SHA/tsc evidence to parent promptly, then continue authorized independent implementation. Parent reports actual launch and early candidate to MAIN. Ask parent for MAIN heavy resource slot before any Host/media/ffmpeg/browser/build/full checks; pure tsc/small isolated units only otherwise. Preserve failures and actual 422/529/429 without inference; no new arbitrary attempt budget. 429 transfer only after proven stopped writer/descendants and preserved dirty; >2 same-stage rework MAIN root cause. Freeze exact implementation SHA, command/exit/log hashes, cases and cleanup; parent scoped review after writer handoff, not external/A/human PASS. No B.

Launch correction: Orca rejected terminal reuse with invalid_argument and explicitly reported no effects (request3c0e9ad9-a9e2-4aea-910e-0a0dddc4c5ba); workers must start helpers as a fresh agent. Follow its recovery by using --agent claude in this exact current checkout, keep-open; old R1 terminal remains idle and receives no task. This supersedes reuse wording above.
