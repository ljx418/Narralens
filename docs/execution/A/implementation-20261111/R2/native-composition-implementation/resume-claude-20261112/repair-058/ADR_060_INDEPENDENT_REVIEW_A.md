# ADR060 independent document/architecture review A

Verdict: **REQUEST_CHANGES** — the isolation direction is feasible and appropriate; three concrete interface/ownership amendments are required before it completely guides autonomous implementation. No BLOCKER demands an unrelated architecture replacement. Two smaller scheduling/outcome clarifications should be incorporated in the exact060 package.

This review uses W frozen commit `1d348d419120f23f45d958112ea8c43df5a04675` and V `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`. Moving059 W bytes were never used as a source baseline. The ADR and feasibility markdown SHA256 values match their companion receipt declarations. Actual complete input hashes are recorded below and in the JSON.

This is **document review only**. Implementation, tests, compile, Host/HTTP/Chrome/media/probe/import execution and new containment experiments are all **NOT_RUN**. No W/V/Git/var changes, configuration/environment/secret reads, network access or worker dispatch occurred. Only the two assigned review output files are written.059 retains its writer;060 still requires writer handback and an exact MAIN release. No N1N2/A/NativeAck/Studio/V1 implementation acceptance or NEXT completion is signed here.

## Feasible elements and honest boundaries

The core proof can be small: execute the exact fixed producer once in a dedicated worker whose Node and browser execution domain is owned; retain candidate JPEG until that entire domain and parent-owned work settle. This closes late-launch continuations and race-rejected page work without claiming every hidden promise resolved. Losing cross-draw page/cache-in-memory reuse while retaining disk cache and native keys is a deliberate semantic/performance change, expressly disclosed by the ADR. It is consistent with peer isolation only if Host-side shared closePageFrames ownership is removed from the cache path: each worker closes its own browser, and owner.close drains its own complete registered draws without touching B. Preserve the existing brand and public pageFrame/close signatures; do not return a worker object as the producer.

Frozen native-renderer.ts workerEnvironment112-121 is reusable as an allowlisted environment constructor; no environment was inspected during this review. groupExistsOfProcess132-140 conservatively recognizes only ESRCH as absent, but is only one observation. signalProcessGroup143-151 cannot be copied: its swallowed group-signal error and leader-only fallback do not prove group cleanup. awaitChildExit218-303 provides event/timer structure through seams, not a sufficient ownership protocol; natural leader close with a residual group merely observes, and its timeout result is not a settlement capability. requireSuccessfulRendererExit311-317 must not classify the new controlled-finalize protocol.

media-process-policy.mjs25-47 correctly forces detached:false for spawn/spawnSync/execFile and syncs named ESM exports, provided installation precedes upstream/Playwright loading. It does not guard fork/exec/execFileSync/native setsid. Use an additional worker-local birth gate/allowlist for the exact approved executable path, reject uncovered entrypoints, and validate the actual native closure. The existing offline wrapper and loader-hook pattern can be imported into each isolated worker; it already wraps original FilmPage.open locally and enforces network/context rules. New mute handling must be confined to the cache worker/guard facade while preserving all existing blocking flags. Do not import the existing render worker entrypoint itself: it reads its own argv and runs main; reuse the pattern and stable helper modules.

HELLO/GO with a pre-spawn reservation is implementable. The parent can register responsibility before PID exists, then obtain actual PID/startticks/PPID/PGID/SID from procfs before permitting upstream execution. Ticket/channel provenance prevents cross-talk; it does not replace kernel identity. Keep all admission/close/reentrant callbacks behind registration and share one close/settlement promise. Bounded incremental pipe framing is a real improvement over claiming Node IPC deserialization is bounded.

The platform boundary is appropriately Linux/WSL/procfs/POSIX and tested fixed Node/Playwright/Chrome bytes. Neither JS policy nor proc sampling is a sandbox against arbitrary hostile native setsid. A sampled descendant list cannot prove all unsampled escaped descendants never existed; fixed executable-path assumptions plus current containment diagnostics are required admission evidence. If an actual escape is observed, reject that capability and preserve responsibility. Demanding arbitrary-native containment would require a separate kernel mechanism, and is not necessary to approve this scoped direction. Group signal0, scan and startticks verification are not one atomic signal operation. The feasibility report53 states that unavoidable check-to-numeric-signal race honestly; preserve it in the final ADR and do not market it as a pidfd/cgroup guarantee. No blind numeric fallback is acceptable after the anchor is lost.

## Findings and minimum executable amendments

### ADR060-A01 — MAJOR: CLEANUP_REQUIRED still lacks a selected owner/return contract for the already-live PRE and serving

Sources: `ADR_060_ISOLATED_CACHE_DRAW.md:20`; `ADR_060_ISOLATED_CACHE_DRAW.md:26`; `ADR_060_ISOLATED_CACHE_DRAW.md:42`; `isolated-process-feasibility.md:39`; `isolated-process-feasibility.md:53`; `isolated-process-feasibility.md:63`; `W@057/src/host/agent-driven/created-native-workspace.ts:727`; `W@057/src/host/agent-driven/created-native-workspace.ts:815-831`; `W@057/src/adapters/openfilm/openfilm-upstream.ts:1101-1112`

Concrete trigger: Worker crashes after Chrome is spawned and the leader anchor disappears, or KILL/EPERM/proc uncertainty prevents a group-gone receipt. A naive supervisor rejects at its confirmation deadline. The frozen bridge finally calls endDraw, then workspace releases PRE even while the escaped/residual browser might still use that root. Merely returning an error with cleanup_required=true does not transfer ownership.

Assessment: The ADR correctly forbids this but defers the actual owner/return semantics to a later design. This exceptional branch is mandatory to implement; it cannot be left for an implementer to guess while claiming the minimal adapter-only plan is complete. R05 child_lifetime and R07 cleanup_uncertainty/drain_and_delivery require real ownership on every branch.

Minimum amendment: Choose the no-transfer design for this release: register an owned DrawRecord before spawn and keep the bridge pageFrame promise pending on an explicit settlement barrier while CLEANUP_REQUIRED is separately observable. Deadline failure never rejects that operation before safe settlement. Keep beginDraw, workspace lexical PRE ownership, the root lock and unresolved process reservation alive; workspace close/dispose must continue waiting for that operation. A bounded diagnostic receipt exposes cleanup_required without calling the operation complete. Only a reconciliation method holding the exact internal draw capability may accept new kernel/group and parent-drain proof and resolve the barrier; then the operation rejects its original primary once, and normal finally releases PRE. If prompt caller return is required instead, specify an atomic quarantine transfer including PRE, serving, workspace disposal exclusion, mutex, quota and receipt owner before any rejection; that is a different explicit interface, not a flag on Error. Preserve abnormal records across a supervised restart if restart cleanup is in scope; stale receipts never authorize numeric kill.

Required assertions:

- Abrupt worker exit with a real residual group: neither endDraw, PRE release, root disposal nor unknown process-slot release occurs on the deadline.
- After independently established disappearance and real parent drain, reconciliation settles FAILED_SETTLED once, releases once and permits the affected scope to recover.
- Ordinary seek/JOB/TERM-ignore paths actively TERM/KILL and reach FAILED_SETTLED; do not pass them by entering permanent cleanup_required.

### ADR060-A02 — MAJOR: Existing folder.drain does not implement the promised parent stream settlement boundary

Sources: `ADR_060_ISOLATED_CACHE_DRAW.md:19`; `ADR_060_ISOLATED_CACHE_DRAW.md:42`; `isolated-process-feasibility.md:59`; `W@057/src/adapters/openfilm/openfilm-upstream.ts:598-629`; `W@057/src/adapters/openfilm/openfilm-upstream.ts:681-689`; `V@e70d9d9/packages/openfilm/src/host.mjs:128-133`; `V@e70d9d9/packages/openfilm/src/host.mjs:157-164`

Concrete trigger: A real media response is aborted when the worker/browser is terminated. The adapter removes its request on ServerResponse close, while pinned folderFiles owns an independent fs.ReadStream. Node pipe does not make destination close proof of source FD close. Also an idle persistent listener can admit another local request after a zero-size ledger observation unless admission is explicitly frozen.

Assessment: The document promises HTTP/stream/ffprobe drain but only identifies a read-only folder.drain seam whose frozen implementation tracks responses and frameDuration promises, not the underlying source stream close. Killing the worker group cannot reap resources started in the parent. Reusing that promise alone would reproduce A057-04 at the parent resource layer.

Minimum amendment: Specify a parent-owned resource ledger and a private drainAfterExecutionEnds(drawCapability) operation. Before invoking the pinned handler, attach ServerResponse pipe listeners to register the actual upstream source streams, watch each source close/error and response completion, and on aborted destination destroy only its owned sources while awaiting their real close. Retain all actual close errors. Reuse the exact upstream frameDuration promise only with a documented proof that its fixed execFile callback represents child close/reap; if that premise cannot be verified, introduce an explicit narrowly owned probe seam instead of assuming response close proves child exit. Once the worker execution domain is gone, freeze new request admission for this serialized serving, keep its listener up for accepted work, then drain existing HTTP, source streams and probes; reopen only for the next admitted draw. Do not call serving.close from inside an accepted draw. Add these ledger/admission changes explicitly to the openfilm-upstream.ts release scope; no vendor edit or shared fs prototype patch is needed.

Required assertions:

- Abort a real media range stream during termination and observe the source stream close/FD release before folder-drained/endDraw/PRE release.
- Keep a real parent frame-duration probe outstanding across worker-group exit and prove its child is reaped before delivery.
- Inject a request exactly at drain admission freeze; it cannot create a new owned stream/probe after the final empty-ledger decision, while already accepted responses still settle.

### ADR060-A03 — MAJOR: Workspace serialization must cover producer authorization through POST and witness activation, not just worker.draw

Sources: `ADR_060_ISOLATED_CACHE_DRAW.md:28`; `ADR_060_ISOLATED_CACHE_DRAW.md:42`; `isolated-process-feasibility.md:61`; `W@057/src/host/agent-driven/created-native-workspace.ts:700-727`; `W@057/src/host/agent-driven/created-native-workspace.ts:730-814`; `W@057/src/host/agent-driven/created-native-workspace.ts:775-793`; `W@057/src/host/agent-driven/created-native-workspace.ts:843-897`; `V@e70d9d9/packages/openfilm/studio/server/pageframes.mjs:101-109`

Concrete trigger: Two valid different-frame productions target the same actual workspace. A supervisor mutex released after A group/drain but before A POST allows B to overwrite the shared film-duration output while A is retaining POST files. A can observe B's changed duration as an output of A, since the frozen duration capture only compares PRE/POST change and film branch. Distinct frame keys do not eliminate the shared duration path.

Assessment: The direction says same-root serial but leaves its start/end and its relationship to the workspace-owned witness gate unspecified, while proposing workspace changes only if uncertainty needs them. A mutex solely in the pageFrame supervisor cannot enforce full authorization serialization after returning the JPEG. This is a concrete producer-output attribution gap rather than a demand to change the native algorithm.

Minimum amendment: Define one internal production lease keyed by verified canonical workspace root plus physical dev/ino, shared across every service/owner using that root. Acquire it before preexisting-output checks and PRE capture, retain it through worker-group cleanup, parent drain, POST capture, both tree releases, final identity/currentness checks and witness activation/refusal; release only after the production fully settles or is explicitly transferred to the cleanup owner. The process execution semaphore remains separate. Add the small CreatedNativeWorkspaceService.#produce acquisition/final-release change to 060 scope and pass an opaque already-held token to the supervisor if needed, avoiding recursive acquisition of the same lock. Distinct roots may still run concurrently, up to the two-process cap.

Required assertions:

- Two legal different-frame calls on the same root cannot interleave B writes between A draw completion and A witness activation.
- Different service/producer instances referring to the same physical root share the mutex, while two independent roots really overlap in separate groups and B succeeds during A timeout.
- Cancel/throw/cleanup_required at each boundary does not prematurely release or duplicate the root lease.

### ADR060-A04 — MINOR: Forced-finalize success needs an observable truth table rather than causal SIGKILL attribution

Sources: `ADR_060_ISOLATED_CACHE_DRAW.md:26`; `ADR_060_ISOLATED_CACHE_DRAW.md:36`; `isolated-process-feasibility.md:43`; `isolated-process-feasibility.md:51-55`; `W@057/src/host/render/native-renderer.ts:311-317`

Concrete trigger: A complete candidate has arrived, and an unexpected signal/exit races the parent's decision or actual TERM/KILL. The child close event carries a signal name, not the identity or cause of the sender.

Assessment: Allowing deliberate cleanup after successful work is reasonable and need not be rejected for lacking graceful exit0. However neither Node close(signal) nor a successful numeric kill can prove which of two simultaneous signal sources caused exit. The feasibility report honestly acknowledges the check-to-signal race; the final ADR must not imply a stronger classifier exists.

Minimum amendment: Record an irreversible parent FINALIZE_AFTER_OK decision only after the complete bounded candidate is validated and before requesting termination, with monotonically ordered control events, checked worker identity and result/sequence digest. Permit DELIVERED only after that authorized finalization, no observed prior unexpected exit, no known native/protocol/cancel/output/cleanup failure, and a real group/child/folder settlement receipt plus final workspace gates. Any exit or malformed/partial result before that decision is FAILED, never promoted from exit0/SIGKILL. Signal errors/identity uncertainty enter A01. Describe accepted late process disappearance as authorized finalization with observed signal, not proof the parent uniquely caused the signal; if exclusive causal attribution is required, reject such ambiguous successes instead of inventing it. Include races in tests.

### ADR060-A05 — MINOR: Two active workers does not bound queued reservations or retained PRE resources

Sources: `ADR_060_ISOLATED_CACHE_DRAW.md:28`; `ADR_060_ISOLATED_CACHE_DRAW.md:34`; `isolated-process-feasibility.md:26`; `isolated-process-feasibility.md:61`; `isolated-process-feasibility.md:67`

Concrete trigger: An owner admits many calls while two workers are running or one root is cleanup_required. Each queued request/DrawRecord and possibly its PRE closure remains owned, despite per-message byte caps.

Assessment: The new finite pipe budgets are explicit and platform-qualified, but the queue has no finite count/wait/admission boundary. This is a small scheduling contract omission, not a reason to reject process isolation.

Minimum amendment: Name the one shared supervisor/scheduler instance that enforces the cap across producer owners, add a fixed finite queued-reservation cap (for example32 total, with a separately stated per-root cap), specify rejection and cancellation-before-GO semantics, and give queue wait its own bounded budget which does not masquerade as the native JOB timer. Acquire capacity before opening new PRE resources where practicable; otherwise account their retained descriptors under the existing pool and new root ownership record. An uncertain live group continues consuming process capacity until its disappearance is proved. Tune proposed values with the actual approved fixture rather than claiming all legacy arbitrary requests fit.

## Minimal interface and file contract to add to the release

The following is a document recommendation, not code written or released:

- `cache-process-supervisor.ts`: a shared scheduler, pre-spawn DrawRecord, bounded queues, verified process identity, private protocol parser and separate outcome/settlement state. Its owned handle has `state`, a bounded diagnostic view, cancellation/close admission and `settlement: Promise<SettledReceipt>`; a cleanup-required notification is not a receipt. Only the supervisor creates receipts after actual child close, domain disappearance and the specified parent drain. A caller cannot construct a receipt from JSON, PID or an Error property.
- `openfilm-cache-worker.mjs`: bootstrap/control channel before any upstream load, HELLO/GO, code checks, single native call, sealed birth gate, candidate/error envelope, leader-preserving FINALIZE/EXIT behavior and EOF cancellation. Original native errors crossing IPC retain bounded typed fields and cause provenance, not impossible cross-process JavaScript Error object identity. Genuine parent PRE/POST cleanup objects remain the original parent objects under existing K05 assertions.
- `cache-worker-policy.mjs`: compose the frozen media policy with explicit allowed child commands/entrypoints and SEALED refusal, and keep new silence/guard behavior local. If a separate guard facade is selected, name `src/adapters/openfilm/cache-worker-guard.mjs` explicitly before release; otherwise state exactly how the allowed policy/worker files contain that facade. No formal-render source/pin changes are implied.
- `openfilm-upstream.ts`: preserve the issuing factory/WeakSet and private root/serving capability chain, remove cache draws from shared Host-browser teardown, implement the parent source-stream/admission ledger and private drain. The bridge only calls endDraw after actual settlement; no accepted-draw recursive serving.close.
- `created-native-workspace.ts`: small internal production-root lease acquisition/release covering preflight through witness activation, and the selected A01 exceptional ownership behavior. Its existing source/transaction/Expected algorithms stay intact.
- A named cache-only integrity manifest and its generation/check source: explicitly list their exact paths in ReleaseAssignment. Build-trusted supervisor/worker hashes and fixed-upstream hashes are different trust roots; avoid embedding a module's own hash in its bytes. Hash the worker-local helpers, actual module dependency closure and fixed executable environment prerequisite; do not change Approved015 or render pin.
- `tests/agent-driven/integration/cache-process-settlement.test.ts`, plus exactly named protocol/fault helpers and a new containment evidence script in the release: retain all proposed real normal/seek15s/JOB45s/capture30s/late-launch/peer/cancel/flood/TERM-ignore cases and add the three ownership/drain/serialization cases above. Existing Q02/Q03/K05, source-reader, Expected and renderer regressions remain required.

Successful native work followed by deliberate process-domain termination is compatible with the goal. No result may be promoted from exit0 or SIGKILL alone. Unknown leader death with remaining browser processes cannot safely become a normal rejection followed by PRE cleanup; it needs A01 ownership even if that exception remains unresolved for human reconciliation. Such an exceptional pending record is legitimate preservation, not a completed implementation outcome or a replacement for real normal/timeout cleanup.

The proposed60s GO timer permits the original45s JOB branch in the intended single-worker test; queued waiting and READY must be separately identified. capture30s may be preempted by the enclosing JOB45s depending on startup/seek timing, so its real transport-barrier fixture must put capture early enough or explicitly record which timer won. Do not shorten native constants or relabel an outer timeout as native coverage. No test result exists yet.

## Required completion sequence

MAIN can resolve the document findings without changing the chosen architecture: select the A01 barrier/owner policy, extend the same-root serialization boundary, define the parent resource drain and fill the two small budget/outcome rules. Freeze revised ADR hashes and exact files/interfaces/cases after059 returns the writer, then authorize060 implementation and real resource tests. Only a subsequent frozen implementation review can close A057-04. All17 original requirements remain; the ADR does not waive the others, override059 repairs, change the upstream pin or approve NEXT.

## Actual input SHA256

- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/ADR_060_ISOLATED_CACHE_DRAW.md` — `3dafa8c381fdc1a763c5075b073ae678f05a91e458997137604368e86fee949a` (8524 bytes).
- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/ADR_060_ISOLATED_CACHE_DRAW.json` — `9ed99a504be09410025157187b31ece358ab6dafb8beea00a2e18afdc70f9786` (1022 bytes).
- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/isolated-process-feasibility.md` — `dade7b14358b3107ab8733868801320830d7b57bb3c74f2ca39741523034ef16` (19761 bytes).
- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/independent-frozen-review-057/review-a/FINDINGS.json` — `7449495e62dcfb4de4e01506bf9accf146203052ed48462c7c78a27ec380ae3a` (14446 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:docs/evidence/N1N2/freeze-057/ORIGINAL_REQUIREMENTS.json` — `7270eb4d3f9bdcb0aabaf500e8e3055ee39ab82a2fe2e69f91afbd0326bae756` (9530 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/render/native-renderer.ts` — `591c30235a12df42a0234ad9bdf3bf09975864db818ca2b4ed2484a4ca8c829f` (18640 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/render/media-process-policy.mjs` — `3d448ff79c497ee5e123f6931c554a716bc033088e05e701e1de42e48ae995bc` (2505 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/render/openfilm-render-worker.mjs` — `a074a3e7aefeef1ea85a9a058447151cf42aef6351a1c0528323ae76bcd94f39` (20102 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/render/openfilm-offline-wrapper.mjs` — `3da8a0b3a817d80bc9fad8be3d92f022b638c6919e4c959b9a5d895b62a08d30` (3661 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/render/openfilm-offline-hooks.mjs` — `1f73d6b61741062d8b2419323174743ea42ffc93ae282a08cab6f97fe1a7f1ee` (1747 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/render/openfilm-guard-rules.mjs` — `8ff1f73170dc0fd8414fb8fc8015416ac9e8522d0d7d092b903782f657c90c0a` (4068 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/adapters/openfilm/openfilm-upstream.ts` — `013f50ce87e04b3ff542e15f3c98d833ae43940fef9d85ccad79ff38e5bd200b` (55012 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/agent-driven/created-native-workspace.ts` — `3702917cf6efe09287030435c1883e1cdd57eb6e0da2fdd577bf3879ab965c1e` (65816 bytes).
- `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3:packages/openfilm/studio/server/pageframes.mjs` — `87d82f73add17d699aab963a99e45b4406cf68ecf547389b61a24083658f2828` (17816 bytes).
- `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3:packages/openfilm/src/host.mjs` — `dfed0fd5b068823d06b5091fbc01821791f0f470bbf061741bf21a25dc0bb170` (29805 bytes).
