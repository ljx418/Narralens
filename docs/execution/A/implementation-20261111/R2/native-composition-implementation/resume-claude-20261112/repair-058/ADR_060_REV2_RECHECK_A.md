# ADR060 rev2 independent recheck A

**DOCUMENT_PLAN_READY — document/architecture scope only.** Rev2 closes ADR060-A01 through A05 at the owner, interface and required-test level. There are no remaining document BLOCKER/MAJOR/MINOR findings from this recheck. This is not an implementation PASS, a runtime result, a060 implementation release, or authorization to take059's writer.

Reviewed rev2 markdown SHA256: `27c6bcbc46ab5473716cc04a92ac3f50a1ee027d68045db72048af488168d6f2`.
Reviewed rev2 JSON SHA256: `a771d12f69b2faf904cd081dc921a67314661135aa30b9f47c5362f67389dd48`.
The companion JSON identifies revision2 and matches the actual markdown bytes. Rev1 archive and original independent reports remain preserved and unchanged.

Architecture source baseline is W `1d348d419120f23f45d958112ea8c43df5a04675`; source reads in this recheck used git show of that commit only, not the moving059 working tree. Fixed upstream remains `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`. All runtime is **NOT_RUN**: no imports, tests, compile, business execution, Host/HTTP/Chrome/CDP, probe/media/containment or reconciliation experiments. No W/V/Git/var modification, secret/config/environment read, network access or worker launch occurred. Only these two assigned recheck documents are written.

## A01–A05 disposition

### ADR060-A01 — closed in document design

Rev2 lines 59-65. The selected design has no PRE transfer: the full bridge promise remains pending during CLEANUP_REQUIRED, while a separate bounded diagnostic exposes that state. The lexical PRE owner, beginDraw, production lock, FD and capacity remain live; private WeakMap handle reconciliation requires fresh domain disappearance and parent drain proof and settles the same barrier once. No old numeric PID becomes recovery authority. Normal timeout/TERM-ignore is still required to actively settle, so exception preservation is not substituted for successful cleanup.

Still required in implementation validation:

- Abrupt leader exit with residual group cannot release PRE, endDraw, scope or quota at a deadline.
- Forged/cross-supervisor/released handle cannot reconcile; two real reconciliation/close calls share one settlement.
- Fresh disappearance plus true parent drain permits exactly one FAILED_SETTLED rejection and release; ordinary seek/JOB paths do not stay pending.

### ADR060-A02 — closed in document design

Rev2 lines 67-76. The plan now explicitly expands the parent handler ledger beyond the frozen folder.drain promise: source streams are observed through real response pipe events before pinned handler invocation, destination abort destroys only its owned sources and waits for source close, and HTTP/probe originals remain tracked. drainAfterExecutionEnds(scope) freezes admission only after the worker execution domain is gone, then waits actual parent resources without recursive serving.close. The fixed frameDuration/execFile child-close premise is explicitly a source/Node-semantic plus real-child evidence gate; an unproved premise cannot be treated as implementation PASS.

Still required in implementation validation:

- Aborted real range stream source FD close precedes endDraw and PRE release.
- Parent frame-duration probe remains tracked across worker exit until actual child reap.
- A request at admission freeze creates no new stream or probe; accepted requests still finish.

### ADR060-A03 — closed in document design

Rev2 lines 78-86,107-111. The canonical path is checked as a fact while dev/ino is the cross-service/owner lock identity. workspace.#produce acquires the scope before output preflight/PRE and retains it through POST, both closure releases, final currentness/identity checks and witness activation/refusal. Bridge and supervisor reuse the same active issued scope, and a direct call goes through the same scheduler. This removes the earlier B-duration-write window during A POST. The new read-side root-quiescence query is explicitly narrow and cannot invalidate the generic production lease used by record/serving/final activation.

Still required in implementation validation:

- Pause A after worker/drain and before POST/activation: B same physical root cannot write even via another producer/service instance.
- Distinct roots overlap in actual independent groups, and the peer succeeds through A timeout.
- Own active production scope preserves genuine owner/base/control/ref/generation currentness; read proof admission/delivery and held-proof guard refuse/unconfirm a busy or cleanup-required root.
- Released scope in a late ALS continuation is refused; nested bridge/factory work does not recursively acquire the root lock.

### ADR060-A04 — closed in document design

Rev2 lines 88-97. An irreversible ordered FINALIZE_AFTER_OK record is based on a complete validated candidate before requesting termination; no result is inferred from exit0/SIGKILL. Previously observed unexpected exit, native/protocol/cancel/output failure and final source drift prevent delivery; unknown identity or cleanup returns to the barrier. The truth table expressly limits its claim to observed authorized finalization, not unique causal attribution between racing signal sources.

Still required in implementation validation:

- Unexpected exit/partial candidate before the decision never becomes success.
- Candidate then authorized forced finalize can succeed only after all settlement and witness gates; it is logged as forced finalization, not graceful exit0.
- Late cancel/source drift overrides saved candidate; finalization cannot be backfilled after close.

### ADR060-A05 — closed in document design

Rev2 lines 99-103. There is one Host-module scheduler with at most2 full active production scopes,32 queued reservations and8 queued per physical root. Queue wait is30s and occurs before PRE/worker/pipe allocation. Direct factory/workspace paths share the same quota and scope; passing an existing scope does not double-charge it. Unknown active responsibility retains capacity. These are explicit new resource limits, separately labeled from READY/GO/native deadlines and payable API budgets.

Still required in implementation validation:

- Queue count/per-root count/time overflow refuses before PRE/child/pipe allocation and does not consume another slot.
- Queued cancellation and repeated cancellation release only their own reservation once.
- Direct factory and workspace calls share the same2 active cap; already-held scope is reused.
- Actual default normal/poster/two-frame fixtures fit the chosen byte/time budgets.

## Scope/read-quiescence interaction

The new design is implementable without self-lock or authority expansion. The outer workspace production obtains one complete scope before PRE; its nested serving/factory/supervisor uses that already-issued scope. A direct component entry uses the same scheduler if no outer scope exists. The record keys physical dev/ino and checks canonical path and held identity; an alias, a string, a JSON object or an unrelated ALS context is not a second permission or a new slot. Scope release follows POST, tree cleanup, final identity/currentness and witness activation/refusal. A retained scope in CLEANUP_REQUIRED cannot be silently retired by a deadline.

The read-side predicate must remain a **separate, synchronous, read-only quiescence check**, as rev2 line86 requires. It is not a modification to generic production lease.assertCurrent: the frozen production path invokes that lease in initial validation, record, serving and final authorization. Making that method require an idle root would reject the operation holding the root itself. The separate read predicate can refuse/unconfirm read admission, final delivery and held verifyClosure while production/cleanup is active, without taking or waiting for the production mutex. It checks the authenticated root/ref/generation and does not infer one root's state from a different idle root. Existing owner/base/control/ref/generation and source/rights verification still apply independently.

At implementation, put the last quiescence observation after reentrant liveness callbacks and immediately before delivery, with no intervening await/callback, and include it in the retained verifyClosure. This is the concrete placement of rev2's admission/delivery-guard contract at frozen reader520-578,644-669,939-958. Do not insert it as a blanket denial in workspace922-953 or production430-446/645-674/795-896. Add the own-production-positive and busy-reader-negative tests listed above. A failed read need not block waiting for the mutex it would be observing.

Keep the two kinds of close admission distinct. Closing an owner immediately stops **new draw** admission and waits its accepted calls, as line30 retains. Existing executing draws must still obtain the HTTP/media resources they need. The new resource-admission freeze belongs after execution-domain disappearance at line73; line74's permanent close freeze must not be implemented as early HTTP refusal during an accepted running draw. Listener teardown follows accepted resource settlement. This follows the rev2 ordering and preserves the original Q02 requirement without recursive serving.close.

The unavoidable check-to-numeric-signal race remains a stated trust boundary. HELLO/GO, PID/startticks/PPID/PGID/SID verification and an intentionally retained leader give a practical fixed-runtime ownership window; they do not make procfs+kill one atomic operation or prove unique signal causation. Unknown/lost-anchor branches retain the barrier and never use a leader-only fallback. Rev2's observable finalization truth table is sufficient for this scoped Linux/WSL design; arbitrary hostile-native cgroup containment is not silently required or claimed. Current Chrome/native identity containment still requires its own real evidence.

## Exact ReleaseAssignment still required

The plan is ready to guide an exact release; these ordinary release details remain to be locked before coding/runtime:

**Existing implementation paths**

- `src/adapters/openfilm/openfilm-upstream.ts`
- `src/host/agent-driven/created-native-workspace.ts`
- `src/host/agent-driven/created-native-source-reader.ts`

**Named new implementation paths**

- `src/adapters/openfilm/cache-process-supervisor.ts`
- `src/adapters/openfilm/openfilm-cache-worker.mjs`
- `src/adapters/openfilm/cache-worker-policy.mjs`
- `src/adapters/openfilm/cache-production-scope.ts`
- `src/adapters/openfilm/cache-worker-integrity.json`

**Named acceptance test**

- `tests/agent-driven/integration/cache-process-settlement.test.ts`

**Still name exact paths before release**

- `integrity manifest generator/check script`
- `private protocol and real process fault helpers, if separate files`
- `real containment evidence script and its exact output schema`
- `any separate guard facade, unless fully contained in worker/policy`

**Read-only helper reuse**

- `src/host/render/native-renderer.ts helper exports; no dangerous group-signal fallback or renderer-success classifier`
- `src/host/render/media-process-policy.mjs`
- `existing offline wrapper/hooks/guard rules and exact pinned V modules`

**Protected boundaries**

- `fixed V/vendor/upstream pin/lock`
- `formal render source and render pin`
- `Approved015`
- `public DTO/EnginePort/source transaction and approval contracts`

Bind the actual059 handback commit and its preserved repairs as the060 implementation base;057 remains the frozen architecture reference. Name the integrity generator/checker, actual fault-helper and containment-script files and any separate guard facade. The final manifest must distinguish source hashes, actual built/loaded worker bytes, fixed-upstream hashes and executable environment prerequisites, without a self-hash cycle. Keep source/error provenance across IPC semantically; do not demand impossible cross-process Error object identity, and keep genuine parent cleanup objects intact.

The proposed focused test argv is:

```text
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-settlement.test.ts --maxWorkers=1 --minWorkers=1
```

This command is **NOT_EXECUTED** and is not a resource grant. The new containment script must first exist and have its argument parser reviewed before MAIN supplies its exact supported argv, case IDs, unique output root, port reservations, one heavy-resource slot and cleanup/stop owners. Lock the absolute Node executable, worker entry/argv/private-pipe layout and real Node/Playwright/Chrome paths/versions/hashes. State the exact affected Q02/Q03/K05/reader/Expected/formal-render and fullcheck/build commands. Preserve failures and the old opt-in REAL_TOOLS NOT_RUN. Queue30s, READY30s and GO60s must remain separately labeled; native seek15s/JOB45s/capture30s cases must prove which timer/path was actually hit.

MAIN can proceed to exact060 assignment after059 returns the writer. Actual implementation, required real containment/cleanup/peer evidence, affected regression and a newly frozen independent review remain outstanding. All17 original requirements and NEXT-after-acceptance remain; no A/NativeAck/Studio/V1 gate is signed here.

## Input hashes

- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/ADR_060_ISOLATED_CACHE_DRAW.md` — `27c6bcbc46ab5473716cc04a92ac3f50a1ee027d68045db72048af488168d6f2` (17680 bytes).
- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/ADR_060_ISOLATED_CACHE_DRAW.json` — `a771d12f69b2faf904cd081dc921a67314661135aa30b9f47c5362f67389dd48` (1407 bytes).
- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/ADR_060_REV1_BEFORE_REVIEW_FIX.md` — `3dafa8c381fdc1a763c5075b073ae678f05a91e458997137604368e86fee949a` (8524 bytes).
- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/ADR_060_REV1_BEFORE_REVIEW_FIX.json` — `9ed99a504be09410025157187b31ece358ab6dafb8beea00a2e18afdc70f9786` (1022 bytes).
- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/ADR_060_INDEPENDENT_REVIEW_A.md` — `53197c3d443a4e51886462e8eb706877514d20a6f1e4a82fe947f9587c7950e0` (24788 bytes).
- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-058/ADR_060_INDEPENDENT_REVIEW_A.json` — `b30d580c11b26982deb505ad04fc24b3db2a8b287b9f88007cd939f5d6e7df96` (19966 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/agent-driven/created-native-source-reader.ts` — `cde88435d61dba1a881bef403e6a013f1d4f2bb93db8e1ffa2b3c15b4c74f82b` (77595 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/host/agent-driven/created-native-workspace.ts` — `3702917cf6efe09287030435c1883e1cdd57eb6e0da2fdd577bf3879ab965c1e` (65816 bytes).
- `1d348d419120f23f45d958112ea8c43df5a04675:src/adapters/openfilm/openfilm-upstream.ts` — `013f50ce87e04b3ff542e15f3c98d833ae43940fef9d85ccad79ff38e5bd200b` (55012 bytes).
