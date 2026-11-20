# 037 独立有限实现审查

**PRE_RUNTIME_READONLY_IMPLEMENTATION_REVIEW_NOT_EXTERNAL_PASS — REQUEST_CHANGES**

candidate_commit=null；基线HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda` 不是候选。独立核对 COMPILE_037_002_GRANT.json **35项实际输入+35份逐字备份**，起止全部匹配，无漂移。8个生产改动及新增测试以当前实际MAIN树为准，保护路径未写入。本次0 BLOCKER、6 MAJOR：5项代码/测试实现缺陷的静态推论及1项权威反例证据缺口。没有执行反例或变异，不从编译推导业务PASS。

W=`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；下列相对引用均为该实际树。原036预审与legacy补充保留原位。037 tsc002 raw result实际exit0、log为空且SHA256独立复算一致、无input drift；001非零保留历史。**所有037业务case为NOT_RUN**；MAIN可能单独运行静态fitness/pin测试不在本审查执行内，亦不能替代业务与漏检反例。

## 实质发现

### MAJOR Q01 — Serving construction escapes close/drain and can leak after rejection

范围 PF01/R07；CODE_LIFECYCLE；STATIC_INFERENCE_NOT_RUN。

代码/断言：`src/host/agent-driven/created-native-workspace.ts:444`；`src/host/agent-driven/created-native-workspace.ts:455`；`src/host/agent-driven/created-native-workspace.ts:461`；`src/host/agent-driven/created-native-workspace.ts:874`；`src/host/agent-driven/created-native-workspace.ts:882`；`src/adapters/openfilm/openfilm-upstream.ts:825`；`src/adapters/openfilm/openfilm-upstream.ts:836`。

servingFor accepts a current view, then awaits factory verification/listen. Concurrent close/dispose snapshots only #operations, which does not contain this construction, and can close root resources before the continuation. After a listener starts, factory realpath/stat can throw, or service fstat/root validation can throw; neither path closes the new listener. A simple service.close during construction without dispose also permits owner registration/return after closing because #closing/current lease is never rechecked. Parallel servingFor calls both miss #servings and create distinct owners; last registration makes the earlier legitimate returned owner unusable.

当前断言不足：PF01:924 creates owners sequentially and closes a fully created owner before invoking production; no creation-await close, registration failure or concurrent same-view creation case.

最小同范围修正建议（未运行/未实现）：Admit and track the entire construction before its first await, single-flight by exact held view, recheck closing/lease/record after awaits before registration, and own cleanup of all partially-created listener/folder resources on every failed construction or registration. Add precise creation/close/parallel/failure cases; no extra public module needed.

### MAJOR Q02 — Serving owner closes listener before accepted draw dependencies finish

范围 PF01/R07；CODE_LIFECYCLE；STATIC_INFERENCE_NOT_RUN。

代码/断言：`src/adapters/openfilm/openfilm-upstream.ts:844`；`src/adapters/openfilm/openfilm-upstream.ts:851`；`src/adapters/openfilm/openfilm-upstream.ts:853`；`src/host/agent-driven/created-native-workspace.ts:608`；`src/host/agent-driven/created-native-workspace.ts:754`；`tests/agent-driven/integration/native-cache-witness.test.ts:924`。

An already accepted real pageFrame may still need its initial navigation or later asset/iframe requests. Caller can invoke returned serving.close while the draw is awaiting: close immediately stops listener/new connections and drains only currently registered folder HTTP/probe promises, not the producer draw. It can resolve in a gap with no active request while the draw later issues more HTTP. The draw fails or times out because its required origin was torn down. Concurrent repeated close also returns immediately on closed=true instead of sharing original settlement promise.

当前断言不足：Old B0-2 covers producer browser peer ownership; PF01 only exercises closed-before-draw refusal. Neither covers serving.close during draw with future HTTP dependencies. Service dispose waits its admitted productions, but the public Host-private serving.close path bypasses that wait.

最小同范围修正建议（未运行/未实现）：Stop admitting new productions separately from servicing dependencies of already admitted draws, give serving an actual draw lease/drain ownership, and share a close promise through true settlement before closing listener/root. Assert a delayed future dependency during owner close and repeated-close settlement.

### MAJOR Q03 — A child-page draw can brand an unrelated preexisting film duration

范围 PF02/R04；CODE_PROVENANCE；STATIC_INFERENCE_NOT_RUN。

代码/断言：`src/host/agent-driven/created-native-workspace.ts:583`；`src/host/agent-driven/created-native-workspace.ts:665`；`src/host/agent-driven/created-native-workspace.ts:686`；`src/host/agent-driven/native-cache-witness.ts:185`；`src/host/agent-driven/created-native-source-reader.ts:1239`；`tests/agent-driven/integration/native-cache-witness.test.ts:1001`。

Place a forged finite duration JSON with the real film mtime:size in the issued root, then draw an existing non-film page such as a committed scenes page through the real registered serving. Fixed upstream pageframes.mjs writes film-duration only inside rel===FILM_PAGE and finite duration (pinned file:103), so this draw leaves the forged JSON untouched. The wrapper unconditionally captures any existing duration at665 as an output and activation makes it current by output path; the reader then accepts its full matching identity as witnessed. Likewise a nonfinite film draw can leave a previous duration and have it falsely reissued.

当前断言不足：PF02:1001 does only one film-poster draw and an equal-bytes/new-inode negative. There is no non-film/preexisting duration negative, change-and-restore duration negative, or actual two-different-frame consecutive draw N8 followed by consumption of both frame triples and latest duration. By-output mapping and per-frame restricted consumption are present statically, but no N8 execution/body proves the requested success.

最小同范围修正建议（未运行/未实现）：Issue authority only for outputs that this exact fixed-producer branch actually wrote; do not adopt prior duration merely because present at POST. Preserve latest per-output authority and old frame triples. Add actual non-film forged duration refusal plus the required two-draw/latest-output positive and tamper negatives.

### MAJOR Q04 — Vendor taint gate misses renamed imports and loader-local calls

范围 LF05/REG；STATIC_GATE_FALSE_NEGATIVE；STATIC_ORACLE_COUNTEREXAMPLES_NOT_EXECUTED。

代码/断言：`tests/m2.1/openfilm-upstream-lock.test.ts:124`；`tests/m2.1/openfilm-upstream-lock.test.ts:196`；`tests/m2.1/openfilm-upstream-lock.test.ts:204`；`tests/m2.1/openfilm-upstream-lock.test.ts:212`；`tests/m2.1/openfilm-upstream-lock.test.ts:388`。

Synthetic valid caller: import {createPinnedOpenFilmUpstream as load} from "../../adapters/openfilm/openfilm-upstream.js"; function call(req:IncomingMessage){load(req.url as string)}. imported contains local name load, but known maps exported names, so known.get(load) is undefined and no violation is reported. Namespace import OF.createPinnedOpenFilmUpstream(req.url) is also skipped because only identifier callees are visited. The loader module self-check has no import from itself, so imported is empty and its local openFilmAvailability(requestDerivedRoot) calls are not checked at all. A helper taking root:string and invoking the sink can receive req.url without parameter taint propagation; current helper test only tests pick(req) at a direct sink.

当前断言不足：Current synthetic request alias and renamed parameter cases do not rename loader import or call through helper into sink. Comment admits cross-file limit, but these bypasses are same-file and beyond that stated limitation. No current production request-controlled vendor path exploit is claimed.

最小同范围修正建议（未运行/未实现）：Resolve local imported aliases/namespaces to original exports, include loader-local entry calls, and follow actual argument-to-helper-parameter data flow or explicitly enforce a smaller audited composition capability boundary. Add these exact counterexamples before relying on the gate; keep fixed argv/pin/shell refusals.

### MAJOR Q05 — Real-media setup cannot overwrite copied opaque fixtures with current ffmpeg argv

范围 LF02/REG；TEST_PREREQUISITE_DEFECT；STATIC_INFERENCE_NOT_RUN。

代码/断言：`tests/m2.3/migration-real-export.test.ts:97`；`tests/m2.3/migration-real-export.test.ts:101`；`tests/m2.3/migration-real-export.test.ts:105`；`tests/m2.3/migration-real-export.test.ts:107`；`tests/m2.3/migration-real-export.test.ts:133`；`tests/m2.3/migration-real-export.test.ts:137`；`tests/m2.3/migration-real-export.test.ts:228`。

Both real-export cases cp SOURCE_FIXTURE recursively, including now-restored17/17/18-byte files, then prepareDiagnosticMedia writes exactly the same output paths. ffmpeg argv has -nostdin and no -y, nor does setup remove only these owned copied files first. Existing output is refused, so the first visual preparation exits before manifest probing, migration, target renders or second edited export. This is a source/CLI control-flow inference, not a claimed run.

当前断言不足：New actual frames/real AssetRegistry and preserved target900/edit/hash assertions are promising but unreachable from the restored fixture under this setup. Counts/titles or tsc cannot establish LF02.

最小同范围修正建议（未运行/未实现）：Explicitly overwrite or remove only the three owned files in the private copied fixture before fixed bounded generation; preserve canonical opaque bytes and all real render/decode/two-export assertions. Verify audio as well as visual decode; diagnostic remains non-A media.

### MAJOR Q06 — Foreign impact/transaction test uses absent IDs or mismatched request fields

范围 LF04/REG；AUTHORITY_NEGATIVE_COVERAGE_GAP；STATIC_TEST_REACHABILITY_NOT_RUN。

代码/断言：`tests/agent-driven/integration/created-source-adoption.test.ts:567`；`tests/agent-driven/integration/created-source-adoption.test.ts:570`；`tests/agent-driven/integration/created-source-adoption.test.ts:586`。

The branch described as an impact of another project never creates such an impact in the same authority; it substitutes imp_of_another_project, an absent ID, and accepts any throw. The transaction branch only substitutes project_id on the original input without creating/selecting an actual transaction belonging to another project. Early missing-row or publication-binding refusal can satisfy both without exercising cross-project CAS/transaction ownership. A defect allowing valid foreign rows could survive these assertions.

当前断言不足：Tampered stored impact_hash branch is a real DB mutation; expiry delegation and file-scoped fitness registration are present. Those do not establish the two separate actual foreign-authority negatives required by037 LF04.

最小同范围修正建议（未运行/未实现）：Arrange real second-project impact/transaction rows in the same database/authority, prove their existence and foreign ownership before invocation, then assert the intended ownership/CAS refusal and unchanged complete authorities; retain the real hash/rollback and scanner negatives.

## 逐项集中修复覆盖

| area | 状态 | 具体证据与限制 |
|---|---|---|
| PF01 | REQUEST_CHANGES_STATIC;BUSINESS_NOT_RUN | Private owner WeakMap + read-only binding, registered held-view identity, root dev/ino, preproduction and preactivation liveness checks are present. 断言：tests/agent-driven/integration/native-cache-witness.test.ts:924 foreign root, same-root second allocation, clones/shape/handler string, closed owner zero-request negatives。限制：Q01/Q02; positive and new negatives not executed. |
| PF02 | REQUEST_CHANGES_STATIC;BUSINESS_NOT_RUN | By-output current authority and full duration identity consumption replace bare stamp acceptance; frame reader only checks its actual triple rather than all witness outputs. 断言：tests/agent-driven/integration/native-cache-witness.test.ts:1001 one draw/current-output lookup/newinode。限制：Q03; actual N8 consecutive two draws body absent; no revoked-newest/no-fallback or duration change-restore assertion. |
| PF03 | PARTIAL_ASSERTIONS;BUSINESS_AND_MUTATION_NOT_RUN | Production overrides PRE/POST phase, descriptor metadata namespace/monotonic allocationid/path. K05-c changes existing film at POST root-open; this does not change root entry identity, so PRE/POST comparison SOURCE_RACED appears reachable. Both real closes fail separately and genuine messages checked. 断言：tests/agent-driven/integration/native-cache-witness.test.ts:1056 K05-c; retained-native-closure.ts:429 rootallocation id1。限制：K05-c records messages, not exact Error object references; no inventory/assertion for all allocated IDs/all-attempt count, only two root faults. No actual mutation/old-red claim authorized or obtained. Proposed precise reachability still NOT_RUN. |
| LF01 | LOCAL_BYTES_SUPPORTED;FREEZE_TRACKING_PENDING | Three opaque fixtures independently hash-match exact17/17/18 bytes and backups. 断言：Existing component contract remains opaque, not video/audio.。限制：Clean-checkout tracking is MAIN freeze follow-up; no git index change or durable staging claimed. |
| LF02 | REQUEST_CHANGES_STATIC;BUSINESS_NOT_RUN | Private diagnostic generator/real measured asset frame counts, real AssetRegistry, source digest-only rollback explicitly distinguished from fresh Hypit export, two target export900/edit/hash checks retained. 断言：tests/m2.3/migration-real-export.test.ts:95 generator;143 real registry;180 and200 target export assertions。限制：Q05; no ffmpeg run/actual decode evidence. frameCount count_frames is actual video decode, audio full-decode setup assertion not supplied. Do not weaken target assertions or edit old migrator. |
| LF03 | STATIC_IMPLEMENTATION_SUPPORTED;BUSINESS_AND_COUNTERFACTUAL_NOT_RUN | Private staging strict fingerprint; published-only ctime path rehashes sameFD using explicit offset0, bounded MAX_BYTES and full second fingerprint plus original dev/ino/size/mtime; final SQL #assertBlob reproof remains. 断言：local-assets-host.test.ts:310 two-different-key concurrent success/capacity2/cancel;343 real link/unlink exact after_published_stat;188 tamper rollback。限制：No execution establishes N9/N10 or strict-comparison counterfactual. N10 positive alone does not run every tamper variant; samekey event assertion is at202, different-key event count not separately asserted. Async realpath/sync after second pass is followed by synchronous #assertBlob; no high-confidence new LF03 production defect found. |
| LF04 | IMPLEMENTATION_PARTIAL_PROOF;BUSINESS_NOT_RUN | expire delegates existing ImpactStore.markExpired, service rereads state. Fitness is exact file+method pair, negatives otherfile/samename and samefile/unregistered; hash mutation and postconsume rollback bodies retained. 断言：created-impact-atomic.test.ts:60; m2.2-fitness.test.ts:122; created-source-adoption.test.ts:567,603。限制：Q06; no fake async race invented for sync SQL. |
| LF05 | REQUEST_CHANGES_STATIC | AST uses typed request sources, properties, aliases, selected expressions; pin/fixedargv/shell/forgedverdict tests retained. 断言：tests/m2.1/openfilm-upstream-lock.test.ts:388 synthetic direct/property/body/requestalias/renamedparameter/pick(req)。限制：Q04; staticfitness execution, if MAIN separately authorizes/runs it, cannot close omitted counterexamples. |

## 原17项保持原范围

这里不把新037测试数量当替代范围。未受影响的旧证据作为历史保留；新资源/缓存/回归更改未运行，均不重签旧通过。

| 原要求 | 当前状态 | 证据引用/剩余 |
|---|---|---|
| R01/producer_chain | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `src/host/agent-driven/committed-snapshot-authority.ts:362`；`tests/agent-driven/integration/created-native-source-reader.test.ts:109`；`tests/agent-driven/integration/created-native-source-reader.test.ts:171`；`tests/agent-driven/integration/helpers/native-source-fixture.ts:105`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R01/independent_trees | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `src/host/agent-driven/created-native-source-reader.ts:740`；`tests/agent-driven/integration/created-native-source-reader.test.ts:801`；`tests/agent-driven/integration/created-native-source-reader.test.ts:823`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2702`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2723`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R02/tamper_and_authority | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `tests/agent-driven/integration/created-native-source-reader.test.ts:737`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1774`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2567`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3183`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3206`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3230`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3260`；`tests/agent-driven/integration/native-cache-witness.test.ts:853`；`tests/agent-driven/integration/native-cache-witness.test.ts:906`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R03/complete_dependencies | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `src/host/agent-driven/created-native-source-reader.ts:779`；`src/host/agent-driven/created-native-source-reader.ts:911`；`tests/agent-driven/integration/created-native-source-reader.test.ts:285`；`tests/agent-driven/integration/created-native-source-reader.test.ts:946`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1633`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2420`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2511`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3152`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R04/native_cache | UNPROVEN_REQUEST_CHANGES | `src/host/agent-driven/created-native-workspace.ts:462`；`src/host/agent-driven/created-native-source-reader.ts:1173`；`tests/agent-driven/integration/native-cache-witness.test.ts:136`；`tests/agent-driven/integration/native-cache-witness.test.ts:302`；`tests/agent-driven/integration/native-cache-witness.test.ts:471`；`tests/agent-driven/integration/native-cache-witness.test.ts:853`；`tests/agent-driven/integration/native-cache-witness.test.ts:906`。Q01/Q02/Q03 and missingN8; original R04 actual lifecycle/provenance not closed. |
| R05/actual_probe | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `src/host/agent-driven/created-native-source-reader.ts:499`；`tests/agent-driven/integration/created-native-source-reader.test.ts:361`；`tests/agent-driven/integration/created-native-source-reader.test.ts:568`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1020`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1537`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R05/child_lifetime | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `src/host/agent-driven/created-native-source-reader.ts:428`；`tests/agent-driven/integration/created-native-source-reader.test.ts:568`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2280`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2307`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2334`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2361`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R06/native_bytes_and_order | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `tests/agent-driven/integration/created-native-source-reader.test.ts:1064`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1093`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1663`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1686`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2941`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2975`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R07/budgets | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `src/host/agent-driven/retained-native-closure.ts:20`；`src/host/agent-driven/retained-native-closure.ts:702`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1181`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1294`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1743`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1820`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2280`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2307`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R07/per_allocation_fd_lifetime | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `tests/agent-driven/integration/created-native-source-reader.test.ts:1851`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1181`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2814`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| R07/cleanup_uncertainty | UNPROVEN_AFFECTED_LIFECYCLE | `src/host/agent-driven/created-native-source-reader.ts:385`；`src/host/agent-driven/committed-snapshot-authority.ts:391`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1230`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1957`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2007`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2030`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2638`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2814`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3028`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3051`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3085`。Q01/Q02 and PF03 exact-allocation/causes evidence pending. |
| R07/drain_and_delivery | UNPROVEN_AFFECTED_LIFECYCLE | `src/host/agent-driven/created-native-source-reader.ts:645`；`tests/agent-driven/integration/created-native-source-reader.test.ts:513`；`tests/agent-driven/integration/created-native-source-reader.test.ts:628`；`tests/agent-driven/integration/created-native-source-reader.test.ts:1616`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2099`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2173`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3004`。Q01/Q02 and PF03 exact-allocation/causes evidence pending. |
| R01/R02/lease_isolation | HISTORICAL_COMPONENT_EVIDENCE_CURRENT037_NOT_RUN | `src/host/agent-driven/created-native-workspace.ts:337`；`src/host/agent-driven/created-native-workspace.ts:698`；`tests/agent-driven/integration/created-native-source-reader.test.ts:401`；`tests/agent-driven/integration/created-native-source-reader.test.ts:447`；`tests/agent-driven/integration/created-native-source-reader.test.ts:2538`；`tests/agent-driven/integration/created-native-source-reader.test.ts:3260`；`tests/agent-driven/integration/native-cache-witness.test.ts:385`；`tests/agent-driven/integration/native-cache-witness.test.ts:425`；`tests/agent-driven/integration/native-cache-witness.test.ts:471`；`tests/agent-driven/integration/native-cache-witness.test.ts:526`。Prior036 concrete evidence retained as history; not claimed as runtime proof of037 changes. |
| REG/existing_behavior | UNPROVEN_REGRESSIONS037_NOT_RUN | `src/host/m5/openfilm-native-expected.ts:625`；`tests/agent-driven/integration/created-native-ack.test.ts:667`；`tests/agent-driven/integration/created-draft-processor.test.ts:72`；`tests/agent-driven/integration/created-native-source-reader.test.ts:193`。Q04/Q05/Q06 plus LF03 actual concurrency, real-media and state regression pending. |
| EVIDENCE/frozen_capture | EXPECTED_PENDING | `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/BATCH_036_GRANT.json`。All35 exact bytes captured; no candidate commit; final frozen acceptance and later contract reanchor not issued. |
| REVIEW/independent_acceptance | EXPECTED_PENDING | `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/independent-pre-freeze-review-021/TASK.md`。All35 exact bytes captured; no candidate commit; final frozen acceptance and later contract reanchor not issued. |
| NEXT/next_integration_plan | EXPECTED_PENDING | `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/MAIN_ACCEPTANCE_REQUIREMENTS.json`。All35 exact bytes captured; no candidate commit; final frozen acceptance and later contract reanchor not issued. |

## 35项精确输入与备份核对

以下SHA256均grant=start=end=实算backup；完整backup路径保存在MATRIX.json。

| W相对路径 | SHA256 |
|---|---|
| `src/host/agent-driven/native-cache-witness.ts` | `97c1fe93037f3f31afdf67e97a5d4451d42ac7016d3cca642217fe1750c2573b` |
| `src/host/agent-driven/created-native-workspace.ts` | `b29d0bf0d2345555a6ade5f21125ae1b640bde2b5bae65f1463f91618207de57` |
| `src/host/agent-driven/committed-snapshot-authority.ts` | `1c53360e3c618c603cfcbe61d0c2d57004c5bd33dc26a92c2fdec72a1844bd6d` |
| `src/host/m5/openfilm-native-expected.ts` | `19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3` |
| `src/adapters/openfilm/openfilm-upstream.ts` | `b4c6ca242d46096b7cf60afef73d599cba0393053d931c295bf6db79724b16e6` |
| `tests/agent-driven/integration/helpers/native-source-fixture.ts` | `7160a285930e61b7927d90bb517e7d9575f5f0888394d228b192baff80daf622` |
| `tests/agent-driven/integration/helpers/created-draft-fixture.ts` | `59788a8f9c08415a808b2418e86b4dac6bb7de65297ad5d1cb19b5f26eb22d27` |
| `tests/agent-driven/integration/created-native-workspace.test.ts` | `439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f` |
| `tests/agent-driven/integration/committed-snapshot-host.test.ts` | `bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037` |
| `tests/agent-driven/integration/created-native-ack.test.ts` | `5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c` |
| `src/host/agent-driven/retained-native-closure.ts` | `ab7ffead1c4b7b238f7e4f6097b1d17ad7792513e84591b623f67c95576ac6e7` |
| `src/host/agent-driven/created-native-source-reader.ts` | `cde88435d61dba1a881bef403e6a013f1d4f2bb93db8e1ffa2b3c15b4c74f82b` |
| `tests/agent-driven/integration/native-cache-witness.test.ts` | `cf4e86733b7937e985a5adce0a07e0fba64b7d7bd6fd88914bdeecbe3b963414` |
| `tests/agent-driven/integration/created-draft-processor.test.ts` | `684df1c287890a13ecd8b08a4cd32d5053c2868e80494eca2fcc6412cdc4e0b6` |
| `tests/agent-driven/integration/created-native-source-reader.test.ts` | `09ef2019ad95cbd3b3bb377e8f146b994c9462f48f4662db5e072b629383ea77` |
| `package.json` | `edace26fdfa5a9808f2706fe15ab3935d0512d08f765d4cffec268eb7e783263` |
| `pnpm-lock.yaml` | `66d38478d0b035777472a8cdb53954559a6c1a5f8803f7247caaffce1ac3584d` |
| `tsconfig.json` | `83fbe518b8002a19afcf522215bdd431b9addca24f88771732e123f689acb475` |
| `vitest.config.ts` | `b8cc675ba57ac95cc74b007db787a33b830fe628f7648f902a4dcf8235d787d4` |
| `vite.config.ts` | `6dc4858d37a5ddfac9779371b63b4d3d129641dc485c642de05c17f29a746f2c` |
| `vite.m5.config.ts` | `777295eb5278d162ce549a5fa695618fd68cfb35769b30a9b8c52344a3220ff7` |
| `contracts/openfilm-upstream-lock.json` | `69c4da1decfb27fd6002a030228a2ccadd1a9fb4392e42320cf249ae311b301b` |
| `src/host/agent-driven/local-asset-registry.ts` | `0f99ed585bc8152926b555a3139a240c80025c023db4dc690b26769e1635bb25` |
| `src/host/agent-driven/created-source-impact-store.ts` | `f1cb2d87b21dd5177c2ea29e214a0d89c46868eaa5a255cd6debe4cf4f72a3b1` |
| `src/host/agent-driven/created-source-change-service.ts` | `249df97d95939beeebcc1f9f51d3daed21100fc6aaebfb9b5d000d3a32c0f259` |
| `tests/agent-driven/integration/local-assets-host.test.ts` | `2cf891aab59bcd8db64750abf31cb73173be39b03ac35fde68962ce3951d2112` |
| `tests/agent-driven/integration/created-source-change.test.ts` | `9d82c3c47b23a44ee27cf129ea51aa61c7e29259e94d6d14a27ed43fc6817860` |
| `tests/agent-driven/integration/created-source-adoption.test.ts` | `cad88f2767a77c8afb14ef95886a7bf3131280666c6a3ce61dfb0ff448816792` |
| `tests/agent-driven/integration/created-impact-atomic.test.ts` | `e6f1ddb662deea7c506ec28d390aa1f548c818016a0bc829e8cebd3294e0f5d8` |
| `tests/architecture/m2.2-fitness.test.ts` | `e806d88c7a5452539e629a4da0f4c4e0a4346e0364c233f07e0f16675931cb63` |
| `tests/m2.1/openfilm-upstream-lock.test.ts` | `754f88c990bfe3405d973315ba67c9b9753c10e6d9355d785e36aab38c7ed813` |
| `tests/m2.3/migration-real-export.test.ts` | `a965bbe3c9add3db50479ea250829e8ccdead9d91361267bff4125685192334f` |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/visual-10s.mp4` | `0427d617584264ac2875243d6cf711dd985577566f71db6b9d5faf051575989c` |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/visual-alt-10s.mp4` | `40d825e66ee7e69ae53dfdc8d5195fbb9ffc3af7eb07452a5081c51e24115cff` |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/narration-30s.wav` | `e4276d5ec9199f11df067a98061508eaa11dbaf11ffac107775714b95962173d` |

## 结论边界

MAIN列出的servingFor创建未追踪/注册失败未清理、owner.close提前停listener、任意既存duration被纳入输出三个担忧均由具体控制流确认；没有实际运行证明其发生频率。PF01新的私有allocation/root绑定封住原自由base混用，但并未关闭异步资源生命周期；PF02原bare JSON分类已增强，但POST“存在即本次生成”仍可制造假来源。LF03未发现足够证据支持新增高置信生产缺陷，其运行/反事实仍需精确grant。LF04状态单权威实现成立，测试中假foreign不能当真实跨项目CAS证明。

优先由MAIN裁决这些有限修正，在唯一writer获得新精确授权后处理；报告不是源码/测试/运行或接管许可。保持writer frozen，不改pin/artifact/公开DTO/EnginePort/旧migrator或已验Expected，不扩新模块/时间轴/项目，不弱化真实export/legacy门。修复后仅对受影响断言按授权取得实际证据，再冻结真实commit做绑定外审。候选commit、全部业务结果、真实mutation/counterfactual、ignored opaque fixture最终可复现追踪及NEXT重锚是预期待办；不将其伪装新增代码BLOCKER。

中文A影片、公共Studio/NativeAck/selectionDDL、下一接线与V1仍不属于本次组件实现验收。原runtime预算保护不等于开发时间/次数上限。无429重试、provider操作或实现接管；本次唯一写入为本目录REVIEW.md/MATRIX.json。
