# A-R2 PRODUCT / P-A2 — preparation only

Status: PREPARED_NOT_RELEASED. This dispatch authorizes only TASK.md, HANDOFF.md and CLAUDE_IMPLEMENT.md here; no source/index/branch/runtime mutation or Claude invocation. Current A authorization supersedes historical sealed “not started” prose, but does not release this R2 ticket. No new approval or independent module audit gate is introduced.

Owner: PRODUCT Codex; future implementation writer: one configured MiniMax Claude in the exact MAIN-released checkout, managed through Orca. MAIN owns integration and shared interfaces. Current task task_53b92ba54e4d / dispatch ctx_e096a6ec16b9 / terminal term_5d201dddd71c06b292832ed632f5eb98.

## Baselines and outcome

Inspected immutable integrated R1 `de086f32c48c44fb72d0212ef80365f1c786408c` using git show (MAIN directory `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`). Local HEAD remains `ed44a9b96ea4368175f99ff66c60253975ba0576`; do not reset or implement against that older source. MAIN must supply the actual R2 release/base and preserve local evidence when integrating. Frozen contract SHA `ca5b67a8285b130c79055317c6202f73cfbb99c8`; R0 source freeze `9f583239714835a89332fcae9363aa39d887821d` is historical scope evidence, not the R2 source base.

Deliver one continuous existing-workbench path: inspect actual prepared package → one trusted review decision → separately observe pending adoption and actual committed revision → real native hydration/independent expected verification → Host-validated NativeAck → current-version loaded. Preparation/acceptance does not commit; a decision response is not Applied; commit does not prove native loaded. Preserve R1 CSP-safe static validators, approved Bar/nonmodal system, original Studio/M5 controls and one timeline/selection/clock. No R3 delivery implementation or R4 acceptance claim is required by this ticket.

## Exact proposed source/test scope (15 paths, not released)

Intersection with MAIN's eventual exact assignment governs writes; shared ownership must be transferred explicitly. These are the minimal proposed P-A2 files, not blanket directory rights.

| Path | At integrated R1 |
|---|---|
| `src/app/agent-workbench-client.ts` | existing |
| `src/app/m5/GatewayApiClient.ts` | existing |
| `src/app/m5/M5Panel.tsx` | existing |
| `src/app/observation/CreativeReviewPanel.tsx` | existing |
| `src/app/observation/NativeSyncIndicator.tsx` | existing |
| `src/host/m5/openfilm-studio-gateway.ts` | existing |
| `src/host/m5/native-observation.ts` | planned new |
| `src/host/m5/openfilm-native-expected.ts` | planned new |
| `src/host/m5/native-ack-store.ts` | planned new |
| `src/host/m5/openfilm-studio-ui-pin.json` | planned new |
| `tools/agent-driven/product/build-native-hydration.ts` | planned new |
| `tests/agent-driven/product/observation-ui.test.tsx` | existing |
| `tests/agent-driven/integration/created-native-ack.test.ts` | planned new |
| `tests/agent-driven/integration/created-workbench-review.test.ts` | existing |
| `tests/agent-driven/integration/created-workbench-headless.test.ts` | planned new |

Existing native transport remains MAIN-owned until explicitly released for the necessary observation adapter. No edits to controlled-studio-access, transport regression, shared server/creation application/context, RevisionStore, DDL, frozen DTO/schema/31 tools/80 definitions, vendor, dependency/lock files, static validator generator or arbitrary native candidates. Any required change outside these paths is implemented by its MAIN-assigned owner. Generated hydration source/dist/profile lives only in a separately reserved private runtime root, never a writable vendor or shared runtime. MAIN must name that root and pin input in release; no preparation creates it.

## Actual ports and dependencies

- Existing AgentWorkbenchClient readContext/readWorkflow/readReview/decideReview call the closed agent.v1 operations through independent UI delegate; native.reopen is workbench.v1 with exact `{}`; describePart is existing review.part.describe. Reuse these contracts, read-vs-adoption proof separation and opaque download_ref token; no new third Gateway HTTP alias. Unknown response: reconcile same idempotency key/receipt; never retry with a fresh approval key blindly.
- BRIDGE owns D02/D08–10 mapping and adoption: real ps_ prepared fact → change.prepare impact → FixedWorkflowService.decideReview + TrustedAdoptionAuthority → same apply path/Coordinator/RevisionStore transaction. UI consumes actual ReviewDecision and Context/Workflow, never creates ps_/approval/proof or derives committed from accepted/running. Strict409 and legacy M3 dispatch remain intact.
- Existing `NativeContextPort.read(projectId): Promise<NativeContextFacts>` supplies selection, selection_version, ack, sync and independently authenticated active_bridge_session_id. ProjectContextService rechecks active revision/snapshot/source/control/recovery, session, generation and selection. Integrated CreationApplication still passes `undefined` for native port. MAIN/BRIDGE must inject PRODUCT's verified producer, supply session revocation/generation/selection authority and close ordering, without a second DB or queue.
- PRODUCT native-observation consumes real 013 ProjectView/useFilm state and enforces view/document/hydration epoch fences; openfilm-native-expected wraps 015 from independent current source listing/manifest/parser/probe/rights, not UI values. native-ack-store uses the existing Host/RevisionStore connection and existing cp_a0_native_ack definition; no new cp_a0 tables or relaxed fingerprint. Missing complete parts, dirty, failed, unsupported or stale identity refuses Ack.
- MEDIA/MAIN provide complete committed source closure, film/clip mapping, current asset rights and probe facts; 015 covers settings/markers only. Captions/subtitle_style and film/source closure require independently sourced comparison, and actual observed dirty/unsupported state must still reject even matching hashes. Native hydration does not prove decode/QC.
- Actual four capabilities are clip.prepare, snapshot.render, qc.inspect, delivery.package. Integrated CreatedRunFacts supports real descriptor/readiness providers but CreationApplication does not inject them. MAIN/MEDIA/BRIDGE must register actual executable producers/configuration digests; until all four exist Run stays unavailable, not fake 202/available. This does not block independent consumer/proof implementation; full real-Run E2E remains NOT_RUN until dependencies exist, not a demand that PRODUCT implement R3.

## Concrete interface requests to MAIN (bounded implementation seams)

I1: Identify exact native observation ingress/authenticated session adapter and owner, including generation/view epoch revocation and final current-commit recheck. R1 Gateway has native writes and closed UI aliases but no hydration ingress; do not squeeze observations into native.reopen or invent an uncounted alias. If a wire addition is needed, MAIN explicitly records closed schema/registry/count; frozen CP31/80 stay untouched.

I2: Pin the selected observed candidate and isolated build inputs. Old request013 active metadata names eeb6c7b0b6c046d39d7c633f4ee0029e23b3f7d6, patch f699889206e129dfe4fd913618b34baa8d7e04363f1940d3659664a1e7b9d435; integrated managed-native-observation active is p2-request-start-fence patch 214c629238c2635f5c6212e5e9207eab18f61d17454c08ee64ccd32be41dffa6. These are different candidates, not interchangeable PASS. Preserve p2 request-start fence and 013 callback-round fence; MAIN names one reconciled pin, not a silent downgrade. 015 active source 7141357f0453caa9253b43098ef43ab50fddeeea, source-files de57a3b27e70b56a9ff3f8769f4e3562eba173bdc859a798b712f646d6754418, upstream e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3. No old private root is reused for writing.

I3: Confirm producer binding for preview package digest. Integrated ProjectContextService emits Context.artifacts from artifact_head/artifact_version; PRODUCT packageDigestOf requires the current review package Ref. D03 explicitly forbids disguising ReviewPackage as Script/Storyboard via ArtifactPut. Supply actual immutable review-package Ref through an existing valid producer/receipt mapping (and consumer adaptation if needed), with project/run/version/hash; do not inject fake artifact rows or expand frozen Context. Actual SOURCE_ONLY Job may have released lease; proveForAdoption must rebuild proof, not reclaim succeeded Job.

I4: MAIN assigns concrete independent expected producers for film/source closure, captions/style and selection/session identity, and supplies their dependency injection signatures alongside NativeContextPort. PRODUCT implements comparison/producer adapter within released files; shared authority remains MAIN/BRIDGE. This is a port closure request, not reopening D06 or adding architecture approval.

## Acceptance map (all R2 cases NOT_RUN)

| Cases | Scenario and negative/recovery evidence |
|---|---|
| P03/P05 → A-WRITE/A-ENTRANCES | Real prepared five-part package/receipt, current successful SOURCE_ONLY producer; preview reads change no author/revision; pure accept +0; one accept_and_adopt records decision/limited Approval, pending commit remains explicit; actual apply +1 once; same-key repeat/concurrent Agent apply no double approval/commit. Reject expired impact, wrong owner/run/version/digests/attempt, changed base/control/selection/locks/rights/bytes, cancelled/paused run and relay approval; verify zero forbidden writes. |
| P06/P08 → A-UI | Real original Studio loads adopted committed closure; independent 015 settings/markers plus full film/captions/style proof; Host records matching Ack only after final session/generation/current source/selection recheck. Missing probe/rights/listing closure, dynamic unsupported span, UI-derived expected, merely format-valid hash, settings/markers-only proof cannot loaded. |
| P07/P10 → A-EVENTS/A-COLD | Old view/document/hydration epoch, session/generation rotation, callback throw, pending fetch then source switch, GET failure, sticky dirty or browser preference (even equal hash) invalidate observation. Disconnect/Host restart/new native.reopen requires fresh observation; old Ack cannot revive. Abort/close await outstanding reads; no source or preference mutation by observation. |
| P03/P09 | Descriptor/receipt/bytes/current package exact binding, wrong package/version/fps/hash/content type rejected; package/project switch aborts delayed reads and revokes blob URLs. Prepared preview occupies original slot; native paused at actual observed position; no second clock, no automatic native playback on exit. Reopen loads actual current committed snapshot, not prepared staging. |
| P09/P02 | Real CSP cold browser reads actual context/workflow/health, fold Bar, dialog Escape returns focus, nonmodal system leaves editing usable; TTL future/invalid/>15s unknown; noRun revision0 empty workflow creates no Run/Job. Keep static browser validators; no unsafe-eval workaround. |
| P05/P10 | Disconnect after trusted decision before commit: show accepted/commit pending; reconcile same receipt, not duplicate decision. Crash around source publish/DB/outbox uses MAIN real recovery; gate prohibits new writes/loaded while uncertain; commit once or restore old complete closure. Old source/late result cannot masquerade current. |

R2 shared transaction/NativeAck independent review is MAIN's existing plan, not self-signed by PRODUCT; P11/P12/P14 full delivery and two exports remain later R3/R4.

## Future commands and resource policy

NOT EXECUTED in this preflight. Run from actual release.directory after common base is installed by MAIN; freeze input hashes before tests. No installation/network or shared writable node_modules/DB/dist/profile.

Light after release: `corepack pnpm exec tsc --noEmit`; `corepack pnpm test tests/agent-driven/product/observation-ui.test.tsx tests/agent-driven/integration/created-workbench-review.test.ts --maxWorkers=1 --minWorkers=1`; `corepack pnpm test:contracts`. Existing tests are real files but new R2 cases must be added; old 108/280 passes do not prove them.

MAIN single-slot, after new files exist: `corepack pnpm test tests/agent-driven/integration/created-native-ack.test.ts tests/agent-driven/integration/created-workbench-headless.test.ts --maxWorkers=1 --minWorkers=1`; existing real regression `corepack pnpm test tests/agent-driven/headless/created-native-entry.test.ts tests/agent-driven/headless/owned-project-entry.test.ts --maxWorkers=1 --minWorkers=1`; `corepack pnpm build`. Hydration build tool is planned new: its actual argv/isolated root must be documented when implemented, not invented as an existing command. Original 013/015 C8 commands are historical evidence only, never run on old writable candidate roots. MAIN schedules shared C3/C5 adoption/recovery, full check and native regression commands from domain ACCEPTANCE; PRODUCT never runs simultaneous heavy suites.

Capture exact cwd/argv/start/end/exit, immutable source+contract/input hashes, real project/run/package/decision/impact/revision/snapshot/session-generation/epoch correlation without secrets, DB/source before-after, screenshots/browser errors, raw failed logs and final logs, output hashes and own-PID/FD cleanup. A fixture test proves only its component; real Host/browser/media evidence named separately.

## Rollback / writer / completion

On source conflict stop that write and request exact owner closure; keep useful independent authorized work. No reset/stash/vendor edit. Code rollback is MAIN's explicit scoped revert/new candidate preserving old logs/pins; data rollback is controlled new revision/recovery, never rewriting committed source or deleting Ack/history to force green. Disable new observation exposure/mount on rollback and retain unknown, preserve original editor and existing R1 delegate.

After exact release, Codex records full base/hash/dirty and delegates one visible keep-open configured Claude child with real Task/Dispatch IDs; while child writes Codex is read-only. Claude freezes exact files and self-verifies; Codex reads and reruns authorized scope. 429 requires real old invocation and descendants stopped, dirty preserved and recorded writer transfer before Codex takes over; no configuration/provider switch, no auto-resume. More than two stage reworks go to MAIN for common root cause. No credentials/config/env reads, paid external calls, downloads or J disk. Finish bounded module evidence, not external/independent/A/human PASS; no B.


## MAIN reconciliation incorporated (2026-11-12, docs-only follow-up)

Read canonical `implementation-20261111/R2/MAIN_RECONCILIATION.md` and `current-code-map.json`; verified all 12 recorded source hashes and absence of all 10 listed missing entities against immutable de086f32c48c44fb72d0212ef80365f1c786408c. In particular native-observation.ts, openfilm-native-expected.ts and native-ack-store.ts are planned production files, not shipped producers. Proposed scope remains exactly 15 paths; no new write rights.

MAIN schedules R3 encode/inspect/publish media phase ports and real guarded Host executor foundations early in parallel to remove the four-capability admission dependency. This does not move R3 delivery/T20 acceptance into R2, release those files to PRODUCT, or permit cover/QC bypass. All four real producer-and-consumer bindings must exist before production Run admission; no TestGrant/fakeRun fixture or function-exists check substitutes for them. PRODUCT can develop independent consumers once released while real combined scenarios remain NOT_RUN.

### Precise native interface plan (existing contract shapes, not a new wire release)

| Boundary | Required facts and authority |
|---|---|
| Original Studio → observation adapter | Preserve optional `StudioHost.narralensHydration={version:1,onState(event)}` from fixed 013: native project_id, editor_view_id from actual useFilm view UUID, document_epoch nonnegative integer, hydration_epoch positive monotonically increasing per view, and parts exactly settings/subtitle_style/captions/markers. Each part has state pending/hydrated/absent_default/dirty/failed/unsupported, origin project/explicit_default/browser_preference, effective_sha256 lowerhex64 or null; only hydrated/absent_default may carry a hash. Browser reports no approvals or trusted Host revision. Original film observation v1 is separate DOM/bytes evidence, not whole hydration. |
| Authenticated native session → adapter | MAIN supplies independently authenticated bridge_session_id, instance_generation, logical-to-native project mapping, active editor_view_id/document_epoch and authoritative selection/version. Never trust these from unauthenticated event JSON or copy UI-delegate authority into native observation. Bind callback to the active native session; old views/sessions/generations invalidate all parts, lower/replayed hydration epochs cannot advance current state. I1 still requests exact authenticated ingress/ownership, not permission to invent an endpoint. |
| Host independent source → expected | Reuse 015 `computeExpectedProjection(ExpectedProjectionInput)` at pinned source SHA7141357f0453caa9253b43098ef43ab50fddeeea and upstream e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3. Input binding is project_id/project_revision/snapshot_id/source_digest/film_sha256; source_entries/listing/native video order, actual parser/probe/rights/clip refs and provenance are independent Host facts. `computed` returns settings/markers plus not_proven; `unsupported` is a refusal, never an empty successful default. Source absence must be proven; failed GET/parser is not absence. No second layout algorithm or UI-row-derived expected. |
| Full validation → frozen Ack | Independently verify film/source closure and all captions/style effective values beyond settings/markers. Dirty/pending/failed/unsupported, preference-origin style, missing clip mapping or unverifiable transients reject even equal hashes. Recheck after every async read/hash and at final record boundary: active session/generation/view/document/hydration epoch, current commit/source/selection and recovery gate. Original read-only same-epoch revalidation must not reseed state, clear sticky dirty, write preferences or start media. Callback throw aborts round. |
| Ack producer → NativeContextPort | Only after complete proof emit existing frozen NativeAck fields: project_id, bridge_session_id, instance_generation, loaded_project_revision, loaded_snapshot_id, source_digest, selection_version, observed_at. View/document/hydration epochs remain validated internal producer context, not silently added to frozen Ack DTO. Persist only through existing Host-owned connection/table authority; no invented new queue/state machine. `read(projectId)` returns existing NativeContextFacts including independently sourced active_bridge_session_id; MAIN injects it into ProjectContextService and revokes on close/reopen/source change. |
| Context → app | Existing readContext/NativeSyncIndicator consume actual Host native_sync plus matching ack project/revision/snapshot/source/selection; Host handles identity and epoch validation. Decision receipt → accepted/pending adoption, actual committed revision → waiting for native confirmation, full current Ack → loaded; loss of connection/session/freshness → unknown/pending. A cached matching Ack cannot survive generation change or a new committed source without revalidation. Prepared preview is not native loaded or Delivery. |

013 fixed source artifacts and integrated p2 metadata remain separately identified in I2; reconciliation does not select a different pin or justify dropping either request-start or callback-round fence. I3 package↔receipt/object binding remains a real missing producer identified by MAIN, not a reason to insert fake creative artifact facts. The UI must retain actual package/run/version/hash matching and cancel stale reads.

R1 cold Gateway context/workflow/health reads, folding Bar, nonmodal focus and single editor are proven baseline behavior with no Ack; do not generalize this to real adopted source loading. Keep exact public DTOs and generated static validators under existing CSP, with no app import from Host or dynamic Ajv/compiler fallback. Add negative checks for missing full-part proof, wrong session/generation/view/epoch, old async hash after switch, dirty/default equal-hash, and fake capability admission to the existing P05–P10 map; use true Host/Studio paths for production claims.


# EFFECTIVE MAIN R2 IMPLEMENTATION RELEASE — supersedes earlier preparation status

Actual release received for task_a80e19dd8567 / ctx_28c97d42b1c4 / parent term_a12b41198786723b7ec686bacd39039f. RELEASED assignment is local ReleaseAssignment.json, exact SHA256 03ac04a80e1e3e1ec0a8d283ab7f8fe111befbb9b6d6d316229de82a6a2889fb; INTERFACE_LOCK.md SHA256 e25140ff5e71272f042387804fb75b751cf576621eb99c381dc93c221c529b17. Both match immutable MAIN commit dd2be1f08e65305dac6d0e4ecb05a03e1875e5b2. Actual implementation base39201d932cd10e0ce60b023bdde2f233dfb009e5, branch agent-driven/a-r1-product, source-equivalent common0c1b73cbe384938083482355aaba8eb548c7971b/de086. All earlier docs-only limits, proposed15 count and unresolved I1–I4 are historical and superseded by this exact31-path release and L01–L08; no new user approval is needed.

Prelaunch evidence R2_RELEASE_PREFLIGHT.json records source/index checks, all33 protected alignment files unchanged, ticket hashes before this append, node22.22.1/pnpm10.33.0, settled/retained old child and no old Claude descendants/active owned runtime commands observed. Keep old retained CLI idle; launch a fresh visible R2 task since worker terminal reuse is not supported by this worker-start context, never resume R1 task. Parent owns documentation now and becomes read-only during Claude source/index/runtime ownership. Child records its actual launch receipt in HANDOFF once received; parent sends receipt to MAIN without concurrent file writes.

## Effective L01–L08 scope and closures

L01: exactly31 paths below; early real native observation/expected interface export commit after light tsc, explicitly selected files only, report full SHA+typed signatures+commands to parent/MAIN immediately then continue independent work. Do not use stubs/any/duplicate DTOs. BRIDGE consumes actual immutable candidate, no hand-copied runtime placeholder.
L02/L03: BRIDGE alone owns same-DB opaque commit/join scope, complete plan hash/unique approval and two narrow effects; PRODUCT does not edit core/DDL or invent Approved boolean. Consume actual decision/Context independently of commit/Ack.
L04 closes I3: actual publishReviewPackage already writes legitimate ReviewPackage artifact_version/head; Context.artifacts naturally supplies its immutable Ref. Preserve packageDigestOf; BRIDGE supplies transactional package↔receipt/object binding and result_ref. Parts are not ArtifactPut scripts; reads never render or register.
L05 closes I1/I4: exact additional POST /narralens/native/observation (+1 separately counted) before native-write catch-all; JSON native cookie+Native-CSRF/session-only, closed envelope format/sequence/event_kind/event, document/hydration/selection original schemas. Latest sequence recorded before awaits; authenticated exchange sessionOpened/observe/sessionClosed port from grant.nativeObservation; no client Host identity/revision/proof. NativeObservationService implements original NativeContextPort; BRIDGE injects same instance and closes before DB. Expected interface prove(binding)/assertCurrent(binding,proof)/release(proof)/close is opaque, independently reads complete source and all four parts; 015 alone covers settings/markers only. Final synchronous Ack boundary rechecks sequence/session/generation/view/document/hydration/current commit/control/selection/recovery. Frozen Ack DTO unchanged; selection version Host-owned.
L06 closes I2: select request013-f699-p2-hr1 actual patch f699889206e129dfe4fd913618b34baa8d7e04363f1940d3659664a1e7b9d435 from eeb6c7b0b6c046d39d7c633f4ee0029e23b3f7d6, eight post hashes and actual helper5db47837e690590c9e9678a97e53a10a7115631bd05807ddf6afc925904e2f64; p2 request-start inheritance and H-R1 retained. Reject stale198c active metadata; preserve historical metadata bytes. 015 source7141357f0453caa9253b43098ef43ab50fddeeea five listed source files; copy only explicit native-inputs paths with provenance manifest. Private runtime var/native-hydration-r2, vendor read-only. Build/archive updates only after actual build grant/success; exact managed extraction/path/byte guards remain.
L07: MEDIA exports real CommittedRenderPhasesPort/opaque object resolver and immutable fsynced objects; successful object retained through DB reconciliation, no cross-human-wait FD. BRIDGE owns actual execution/registration/fence. PRODUCT does not implement or fake these other-lane ports.
L08: four actual producers plus guarded consumers before Run availability; early R3 foundations parallel but R2/R3/T20 gates distinct. Heavy slot for Host/media/ffmpeg/browser/build/full, only isolated type/small unit otherwise. Do not run existing integration suites casually if they start Host/listeners. Parent requests slot to MAIN. No artificial budget or attempt cap; real422/529/429 logged, silence is not quota evidence;429 takeover only after invocation/descendants stopped and dirty preserved, >2 stage reworks MAIN root cause.

## Exact31 released product paths

- `src/app/agent-workbench-client.ts`
- `src/app/m5/GatewayApiClient.ts`
- `src/app/m5/M5Panel.tsx`
- `src/app/observation/CreativeReviewPanel.tsx`
- `src/app/observation/NativeSyncIndicator.tsx`
- `src/host/m5/openfilm-studio-gateway.ts`
- `src/host/m5/native-observation.ts`
- `src/host/m5/openfilm-native-expected.ts`
- `src/host/m5/native-ack-store.ts`
- `src/host/m5/openfilm-studio-ui-pin.json`
- `tools/agent-driven/product/build-native-hydration.ts`
- `tests/agent-driven/product/observation-ui.test.tsx`
- `tests/agent-driven/integration/created-native-ack.test.ts`
- `tests/agent-driven/integration/created-workbench-review.test.ts`
- `tests/agent-driven/integration/created-workbench-headless.test.ts`
- `contracts/native-observation-v1.schema.json`
- `contracts/native-observation-v1.registry.json`
- `src/host/m5/controlled-studio-access.ts`
- `src/host/m5/controlled-studio-browser.ts`
- `src/host/m5/studio-host-bridge.ts`
- `src/host/m5/managed-editor.mjs`
- `src/host/m5/managed-editor.d.mts`
- `src/host/m5/managed-editor-pin.json`
- `src/host/m5/managed-editor-dist.tar.gz`
- `src/host/m5/isolated-studio.ts`
- `tools/agent-driven/product/native-inputs/request013.patch`
- `tools/agent-driven/product/native-inputs/expected-projection.mjs`
- `tools/agent-driven/product/native-inputs/expected-projection.d.ts`
- `tools/agent-driven/product/native-inputs/native-pure.entry.ts`
- `tools/agent-driven/product/native-inputs/vite.expected.config.mjs`
- `tools/agent-driven/product/native-inputs/build-expected.mjs`


All other source remains protected, including static validator generator/public contracts/other-lane ports. Preserve exact public DTO/static browser validator/CSP fixes; no app Host imports/dynamic compiler. Reuse P03/P05–10 cases and genuine old-browser regression with new interfaces; each real E2E awaits actual peers, no production fakeRun. No broadadd/push/reset/stash/merge/install/network/J/config/credential access. Capture commands, failures, scopes, raw logs+hashes, final exact SHA and own cleanup. Scoped Codex review follows writer settlement; not independent/A/human PASS and no B.


## Native effective sidecars release — 2026-11-12
MAIN task task_b791e12b46a4 / dispatch ctx_2b91bed536f5 releases only new native-effective-sidecars.ts, its test, oracle and vectors plus own docs. Sole writer PRODUCT Codex under recorded prior safe 429 takeover; previous Claude remains stopped. MAIN immutable base d8fdc1a0b16cd5a594ba7516dd0cb932d3cc910f; own pre-task HEAD 0f527060d0ab002bb472cee2505b06dfb7386082. Existing untracked evidence stays. Pure independently supplied native sidecar computation only: no proof/Ack/rights authority, FS/probe/provider calls or existing-source edits. Targeted isolated pure oracle/tests and typecheck only; no heavy slot, Host/browser/build/ffmpeg or new dependencies. Frozen pinned consumer algorithms are retained verbatim where possible; missing closed inputs refuse rather than default-empty.

Completed component scope at `25b417556a617267a79b276acb7d39ab516edd00`; see SIDECARS_DELIVERY.md and SIDECARS_VALIDATION.json for exact commands/hashes and honest limitations.
