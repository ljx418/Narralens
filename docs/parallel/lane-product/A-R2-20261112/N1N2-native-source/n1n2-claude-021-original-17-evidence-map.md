# N1N2 021 候选：原 17 项逐条证据映射

依据：MAIN 的 `N1N2_021_FINAL_ACCEPTANCE_CHECKLIST.json`（原文照录，不缩范围；`candidate_evidence` 由本次候选填写）。
`proof_required` 一律**原文照录**；每条给出：代码实体 / 具体测试断言 / 实际 capture / **尚缺证据** / 限制。
**不以数量代替覆盖**；**不自助外审**；本文件不构成任何 PASS。

> **更正记录（MAIN 复核）**：本文件初版把 R06 的 Node/ICU/locale 指纹与 R07 的「数字复用」记为未覆盖 —— **两处均为误报**：
> `F10`（1084..1089）已记录并断言实际环境（B1 日志实测 `node v22.22.1 / icu 78.2 / locale en-US`）；
> `P07`（1733..1770）已快照遍历释放的 fd 并断言 `release.some(fd=>walk.includes(fd))`（实际数字复用已被覆盖，B1 已过）。
> 另两处按 MAIN 要求改述：R01 的要求**不要求**无界组合枚举（按实际断言引用）；NEXT **并非完全未开始**
> （canonical next-wiring-draft 规划包已存在，状态 DRAFT_PENDING_N1N2_ACCEPTANCE；未完成的是「按已接受的候选提交重锚」）。
> **本文件其余"尚缺证据"未作任何放宽**，仍逐条列明。

候选字节：见 `n1n2-claude-021-final-summary.md` §1（15 份哈希 + 逐字备份）。唯一编译捕获 `n1n2-claude-021-tsc-020`（exit 0、空日志、无漂移）。

---

## R01 · producer_chain
> Actual bootstrap, SOURCE_ONLY draft and controlled adoption produce committed rich source; actual workspace/reader consumes it; preserve producer/rights/consumer identities.

- **代码实体**：`committed-snapshot-authority.ts` 的 `acquireNativeFacts` / `#nativeLineage`（producer/rights/consumer graph 的重验）、`readerForTransaction`（原 render SnapshotReadPort）；`created-native-workspace.ts` 的 `prepare`（真实复制已提交源）；`created-native-source-reader.ts` 的 `readSource`。
- **具体测试断言**：`R00 smoke reaches the reader from the real committed created source`、`R00 smoke commits a rich source with the native files and the media`、`R01 refuses the legacy project that has no created producer`（`created-native-source-reader.test.ts`）；夹具 `helpers/native-source-fixture.ts` 走真实 bootstrap → SOURCE_ONLY 生产 → 受控采用 → 提交。
- **实际 capture**：`n1n2-claude-021-run-B1`（exit 0，88 passed）。
- **尚缺证据**：外部复核未做。**更正我此前的表述**：原矩阵的要求**不要求**无界的组合枚举 —— 真实 producer 链由
  `R00 smoke reaches the reader from the real committed created source`、`R00 smoke commits a rich source with the native files and the media`
  与夹具 `helpers/native-source-fixture.ts` 的真实链（bootstrap → SOURCE_ONLY → 受控采用 → 提交 → 工作副本 → 读者）覆盖，
  rights/consumer lineage 由 `R01 refuses the legacy project that has no created producer` 与权威侧 `#nativeLineage` 的重验覆盖；我不以"未逐形态枚举"作为缺口。
- **限制**：夹具的 accepted-review / capability eligibility 是**夹具策略**，不是人审或生产能力；legacy 未知仍按原语义拒绝。

## R01 · independent_trees
> Committed source and workspace retain independent physical trees; equal relative paths never collapse resource ownership; nested and empty directories are separate evidence.

- **代码实体**：`retained-native-closure.ts` 的 `RetainedNativeClosure`（每棵树各自的闭包与分配账本）；`created-native-source-reader.ts` 的 `sourceRetained` / `workspaceRetained` 与按 `dev:ino` 的别名判定（`NATIVE_SOURCE_COPY_ALIASED`）。
- **具体测试断言**：`G07 holds both trees and a parallel proof under one descriptor pool`、`G07 holds every nested and empty directory of both trees independently`、`G07 invalidates an old proof when an external hardlink appears after it`、`F04 refuses a hardlink alias and an unknown directory in the working copy`。
- **实际 capture**：`n1n2-claude-021-run-B1`。
- **尚缺证据**：**已闭合（034 + 035）**：G07 用例已**加强**为——递归枚举两棵树的**实际完整目录集**（含根、嵌套、空目录），
  与读者持有的**子目录观察列表逐项相等**且 dev/ino 逐项一致（statSync bigint 精确身份），并且**完整 actual（含两根）**的每一项
  都由「第二次 read 前后 /proc/self/fd **活描述符数量增加**」逐项证明（读前基线里别的 owner 已持有的身份不得充数）。
  实际执行：capture `n1n2-claude-021-run-P09G07`（exit 0，3 passed / 87 skipped）✔
  剩余：**非目录**的分配清单仍未逐条枚举；观察事实本身仍不等于活 FD 证明（现由上面的活描述符证明补上）。
- **限制**：两树的同名相对路径是两份独立资源对象，按 path 去重被禁止且有断言覆盖。

## R02 · tamper_and_authority
> Same bytes/new inode, parent/root replacement, same-size/restored mtime, symlink, copied/foreign/released capability and stale base/control/owner/generation are refused before authoritative use.

- **代码实体**：`retained-native-closure.ts` 的 `verifyFileExact`（held FD + 路径身份的纳秒全等 + 按 retained size 有界的流式散列）、`verifyRootChain`、`verifyDirectoryChain`（内部父链 dev/ino/type）；`created-native-source-reader.ts` 的 `sameFileIdentity`（消费侧全身份）；`created-native-workspace.ts` 的模块私有 `productionLeases` / `witnessLeases` 与 `assertCurrent`。
- **具体测试断言**：`K04-a`（同字节新 inode → 精确 `NATIVE_SOURCE_CACHE_FORGED`）、`K04-b`（同 inode 改后写回、mtime 纳秒精确恢复 → `NATIVE_SOURCE_CACHE_STALE`）、`P07 refuses a symbolic link, a same-bytes replacement and a restored change time`、`F04 refuses a working copy leaf that is hardlinked to an external file`、`K01-a`（未知/复制/同形 lease → producer 前拒绝且零副作用）、`K01-b`（另一真实 service 的 lease）、`K01-c`（手工品牌见证不被晋升）、`K01-d`（被替换 view 的 lease → 精确 `NATIVE_CACHE_PRODUCTION_STALE`，且页面 origin 请求数未增）、`K06-b`（归属权威）、`K06-c`（已提交 base）、`K06-d`（控制修订）、`K06-e`（ref/generation）。
- **实际 capture**：`n1n2-claude-021-run-B2`（K01-*/K04-*）、`n1n2-claude-021-run-B1`（P07/F04/K06-*）。
- **尚缺证据**：外部独立复核未绑定本候选（原 round3 审的是 019 字节）。
- **限制**：owner/base/control/ref/generation 为**三个分开的真实权威 + 一个 view 权威**，每个都有记录的 hit；消费者与真实 producer 合同均未放宽。

## R03 · complete_dependencies
> Positive/negative style/settings/markers/subtitle/translation dependencies, added empty directory and actual listing changes invalidate stale proofs.

- **代码实体**：`created-native-source-reader.ts` 的 `#sidecarInputs` / `#supplyMissing`（有界的依赖发现）、`#classifyDerived`（未知项拒绝）、依赖账本的四项核对（consumed / negative / directory / media lookups 逐项反查 retained 闭包）。
- **具体测试断言**：`G06 refuses a working copy whose settings file was deleted and sees it change under a proof`、`R03 refuses a sidecar, an unknown item and a missing committed file`、`G06 refuses an empty directory born alone under a held proof`、`R03 refuses a translation beside the media that the committed source does not have`、`G03 refuses a film that is replaced between the bounded digest and the parse`、`K06-a`（真实 heard 消费者查询 + 缺失依赖 + birth 失效）。
- **实际 capture**：`n1n2-claude-021-run-B1`。
- **尚缺证据**：该 producer 只写一个 narration VTT，**一般性 translation 可达性**对该 producer 仍受限（已如实记录，非本轮引入）。
- **限制**：观察到的 UI 摘要从不生成 expected 事实；消费者的每条 negative lookup 必须对应闭包中**已证的缺失**，否则整轮被拒。

## R04 · native_cache
> Unknown/forged native metadata or cache refused; concrete approved producer derivation invalidates old round, then stable proven native derivation can be read; no broad cache whitelist.

- **代码实体**：`created-native-workspace.ts` 的受控生产（模块私有 production lease 表、固定 producer 品牌、exact request 规则、既存三件套与旧海报拒绝、pending/active/revoked 账本、结算确定后才激活）；`created-native-source-reader.ts` 的 `#classifyCache` / `#proveWitnessedCache`（同一次绘制的海报见证可覆盖该 frame 的三件套，frame_key 必须相等）。
- **具体测试断言**：`G04 refuses a page frame entry that no fixed producer witnessed`、`G04 refuses a film poster that no fixed producer witnessed`、`R04 refuses a foreign native id, a forged probe cache and a file in flight`、`R04 accepts a legitimate cache in the next stable round`、`B0-1`（真实海报正向：直查为空 + 海报见证覆盖配对三件套 + 读者接受 + 另一 frame key 被拒）、`B0-2`（同伴 close 不互杀）、`B0-4`（真实页帧正向）、`K01-a/b/c/d`、`K03-a/b`、`K04-a/b`、`K05-a/b`。
- **实际 capture**：`n1n2-claude-021-run-B2`（16/16）、`n1n2-claude-021-run-B1`（R04/G04 用例）。
- **尚缺证据**：独立外审未绑定本候选。
- **限制**：缓存白名单仍逐项（无 `.film` 宽泛放行）；真实 producer 成功**已取得**（非 mock、非永久禁用某族）。

## R05 · actual_probe
> Fixed local ffprobe uses same held parent-PID FD; normalized duration/first-video/fps/rotation/audio/dimensions and provenance match pinned upstream; no injected facts.

- **代码实体**：`created-native-source-reader.ts` 的 `#probe`（`/proc/<parentPid>/fd/<fd>` 的 held 描述符路径）、`normalizeNativeProbe`（上游 `derived.probe` 规则）、provenance 摘要（工具版本/argv/输入 sha/bytes/ledger 身份/规范化结果）。
- **具体测试断言**：`F05 binds the probe evidence to the concrete tool, argv, input and result`、`F05 refuses every injected probe failure through the production runner`、`F09 normalises a rotated video and the first of two video streams`。
- **实际 capture**：`n1n2-claude-021-run-B1`。
- **尚缺证据**：无新增缺口（规范化向量取自固定上游既有向量）。
- **限制**：探测子进程只用于**诊断**媒体，从不代表中文 A 影片。

## R05 · child_lifetime
> Timeout/cancel/abrupt child: actual child exit and reap precede input release; limits refuse rather than truncate; diagnostic media never represents Chinese A films.

- **代码实体**：`created-native-source-reader.ts` 的 `#runTool`（等 child 的 `close`、超限即拒绝而非截断）；`retained-native-closure.ts` 的 `probePath` 与 held FD 保持到 child 真正结束。
- **具体测试断言**：`G05 refuses a real stdout overflow and a real stderr overflow`、`G05 kills and reaps a real hung child and keeps the input held until it ends`、`G05 proves a real child that dies by a signal and a real child that is cancelled`、`F09 refuses every injected probe failure through the production runner`。
- **实际 capture**：`n1n2-claude-021-run-B1`。
- **尚缺证据**：**两条 60–180 秒中文有声 A 影片仍 NOT_RUN**（明确超出组件范围，未用彩条/正弦音冒充）。
- **限制**：固定上游既有 timeout 生效，未新增硬预算；诊断媒体不冒充 A 影片。

## R06 · native_bytes_and_order
> Exact UTF8/BOM/CRLF/native_rev vectors; numeric localeCompare video ordering vs separate actual caption readdir order; Node/ICU/locale recorded.

- **代码实体**：`created-native-source-reader.ts` 的 `nativeVideoListingOrder`（上游 `listFiles` 的 numeric `localeCompare` 规则）与**独立**的 caption readdir 顺序；`committed-snapshot-authority.ts` 的 film 原字节 `native_rev`（SHA256 前 16 位，不 trim/不改换行/不去 BOM）。
- **具体测试断言**：`P06 reproduces the five pinned native revision vectors`、`P06 lists the media in the numeric order of the host`、`F10 lists the media as the pinned consumer lists it`、`F10 keeps the caption directory in the platform order`、`P06 shows that the pinned consumer refuses a clip without a number`。
- **实际 capture**：`n1n2-claude-021-run-B1`。
- **尚缺证据**：**无**（更正我此前的误报）：`F10`（用例 1084..1089）**已经**记录实际环境 —— `console.log('N1N2_ENVIRONMENT_FINGERPRINT '+JSON.stringify(fingerprint))`，
  且断言 node/icu/locale 三项非空；B1 捕获的日志里**实际**印出 `{"node":"v22.22.1","icu":"78.2","locale":"en-US"}` ✔。
- **限制**：两种顺序严格分开：video 用数值 locale 比较，caption 目录用平台 readdir 原序。

## R07 · budgets
> Size checks precede bounded text read; growth, total bytes, path/depth/FD/output/time bounds have explicit rejection; no unbounded media read.

- **代码实体**：`retained-native-closure.ts` 的 `RETAINED_NATIVE_BUDGET` 与 `readText`（**先**查大小再读、总量预算、增长即拒）、`hashFile`/`#hashBoundedSync`（64KiB 有界流式）、`#enumerate`（路径数/深度上限）、`#reserveDescriptor`（FD 预算先于 open）；`committed-snapshot-authority.ts` 的 `#streamDigest`（媒体按**有界流**散列，绝不整读）。
- **具体测试断言**：`P07 refuses a grown file, the cumulative text, the deep tree and the descriptor budget`、`P07 refuses a text file above the budget and bounds the total`。
- **实际 capture**：`n1n2-claude-021-run-B1`。
- **尚缺证据**：**已闭合（034 + 035）**：新增两条**真实**用例并已实际执行——
  `P09 refuses a tree with more paths than the budget allows and settles every allocation once`（路径计数闸门：depth 保持宽松以免遮蔽，
  断言拒绝码 NATIVE_CLOSURE_BUDGET、理由含 paths、确实分配过、**每个分配恰一次且无活分配遗留**，分配身份用**单调 id**而非描述符数字）；
  `P09 keeps the platform error of a vanished path and settles every allocation once`（**具名真实 lstat 故障**：遍历中移除本 case 拥有的
  后继同级兄弟 ⇒ 平台真实 ENOENT，断言 primary 的**首**个 cause 含 code=ENOENT / syscall=lstat / path=该具名路径；
  独立的释放故障用**同一个保存的 Error 对象、hit 恰 1**，genuine 集合含该对象且 primary 仍首位）。
  实际执行：capture `n1n2-claude-021-run-P09G07`（exit 0，3 passed / 87 skipped）✔
  剩余：**stat 故障之外的其它注入维度**（如权限类 EACCES 的注入）仍无专门用例；未新增任何生产 stat 钩子。
- **限制**：这些是运行期保护，不是开发者时间/额度上限；未扩大 text 预算。

## R07 · per_allocation_fd_lifetime
> Descriptor allocation generations own closes; recycled integer after temporary directory walk still closes newly retained allocation exactly once; no raw numeric retry.

- **代码实体**：`retained-native-closure.ts` 的 `OwnedDescriptor`（**分配**拥有 close，不是数字）、`closeOwned`（至多一次）、`RetainedDescriptorBudget.release(certain)`（不确定的释放不归还容量）。
- **具体测试断言**：`P07 refuses to release while work is in flight and releases every allocation once`、`G01 keeps the alias reason and the release failure of the same acquisition`、`K05-a`（真实 close 之后再报故障：分配确实结算、无 FD 泄漏、无二次关闭）、`K05-b`（同样的真实 close 故障 + 不交付）。
- **实际 capture**：`n1n2-claude-021-run-B1`、`n1n2-claude-021-run-B2`。
- **尚缺证据**：**无**（更正我此前的误报）：`P07`（用例 1733..1770）**已经**把遍历释放的 fd 快照下来，
  并显式断言 `expect(release.some(fd=>walk.includes(fd))).toBe(true)`（活分配确实复用了遍历释放过的数字，且仍被释放），
  另断言 `new Set(release).size===release.length`（释放中无数字重复）✔；B1 已过 ✔。
- **限制**：任何地方都**不**按裸数字 FD 重试。

## R07 · cleanup_uncertainty
> Nth open/stat/verify/close/reentry failures preserve primary and all cleanup errors; every outstanding resource attempted; sticky uncertainty prevents new proof.

- **代码实体**：`retained-native-closure.ts` 的 `mergeRetainedCleanupCauses` / `retainedCleanupFailures` / `markRetainedCleanupFailures`（genuine 私有账本）；`created-native-source-reader.ts` 的 `#cleanupFailures` / `#cleanupUncertain`；`created-native-workspace.ts` 的 `#uncertain` 粘滞闩；`committed-snapshot-authority.ts` 的解析副本结算（成功/失败都结算）。
- **具体测试断言**：`G01 adopts the genuine cleanup uncertainty of a rejected source acquisition`、`G01 keeps the reader usable after an ordinary failure of the acquisition`、`G01 adopts the genuine uncertainty of a raw rejection that arrives after the caller was cancelled`、`P07 keeps the named primary and every cleanup cause of the real unpack path`、`K02-c`（移除失败 → 不交付任何事实 + 真实平台错误码 + 粘滞）、`K05-a`（producer 的 primary 与全部 genuine cause 并存 + 后续被粘滞拒绝）。
- **实际 capture**：`n1n2-claude-021-run-B1`、`n1n2-claude-021-run-B2`。
- **尚缺证据**：无新增缺口；原矩阵所记「2501 顶层聚合 FAIL」已由本候选的 88/88 取代（失败捕获仍保留）。
- **限制**：primary 永不被 cleanup 覆盖；每个待释放资源都被尝试；不确定即粘滞。

## R07 · drain_and_delivery
> Close drains accepted reads and probes; success transfers source/workspace plus directory/negative guards; reader close cannot destroy delivered resources.

- **代码实体**：`created-native-source-reader.ts` 的 `#adopt`（原始 promise 的 settle 被追踪，close 等它真正结束）与 `Transfer`（资源随交付的句柄转移，close 不再关闭已交付资源）；`created-native-workspace.ts` 的 `#operations`（生产作为已受理操作，close 等它 settle）。
- **具体测试断言**：`R07 ends a read at a close and releases a late result exactly once`、`R07 lets the real media child exit before the reader closes`、`R07 registers the read before a binding callback can close the reader`、`R07 keeps the delivered resources until their owner releases them`、`R02 releases the whole closure only after the last retained leaf`。
- **实际 capture**：`n1n2-claude-021-run-B1`。
- **尚缺证据**：**「交付后 close 不得销毁已交付资源」**已有 `R07 keeps the delivered resources until their owner releases them` 覆盖；缓存侧「发布早于清理确定」由 `K05-b` 反证（此时**不交付**）✔。
- **限制**：已交付资源的归属是句柄，close 只停受理并 drain。

## R01/R02 · lease_isolation
> Releasing one acquired lease does not revoke ref or another lease; repeated proof works; issuing instance checked and replaced generation invalidates prior proof.

- **代码实体**：`created-native-workspace.ts` 的 `#leases`（每次获取独立）、`acquireExpectedLease`、`#invalidateRefsOf`、模块私有 `productionLeases`（按签发实例登记）；`committed-snapshot-authority.ts` 的 `#factsLeases` 与 `isNativeFactsLease`。
- **具体测试断言**：`R02 keeps parallel leases independent and refuses foreign and copied tokens`、`R02 refuses a facts lease of another authority`、`K01-b`（另一真实 service 的 lease）、`K01-c`（手工品牌的见证）、`K01-d`（被替换 view 的旧 lease 失效 + 生产前拒绝）、`K06-e`（ref/generation 窗口）。
- **实际 capture**：`n1n2-claude-021-run-B1`、`n1n2-claude-021-run-B2`。
- **尚缺证据**：无新增缺口。
- **限制**：品牌按实例；复制品与外来者一律不认。

## REG · existing_behavior
> Original render SnapshotReadPort, legacy refusal and accepted Expected lifecycle/84 assertions preserved; loader only approved015 minimal exports, no artifact/pin change.

- **代码实体**：`committed-snapshot-authority.ts` 的 `readerForTransaction` / `#read`（原 render SnapshotReadPort 的形状与错误语义未改）；`openfilm-native-expected.ts` 仅增 `parseProjectSettings` / `parseMarkers` 两个**已批准 015 模块**的导出（文件哈希 `19110e45…` 与 014 候选一致，**本轮未改**）；pin / artifact / 依赖**未动**。
- **具体测试断言**：`C3`（`created-native-ack.test.ts` 85/85，含继承的 84 条断言）、`C2`（`committed-snapshot-host.test.ts` 11/11）、`C1`（`created-native-workspace.test.ts` 11/11）、`R01 refuses the legacy project that has no created producer`（B1）。
- **实际 capture**：`n1n2-claude-021-run-C1`、`-C2`、`-C3`、`-B1`。
- **尚缺证据**：无新增缺口；`created-native-ack.test.ts` 的哈希 `5f50db85…` 与 014 候选一致，即 84 条断言的**字节同一性**得到保证。
- **限制**：loader 只做最小导出扩展；无 artifact/pin 变更；未自签外审。

## EVIDENCE · frozen_capture
> Exact ten-file diff and protected hashes checked; unique captures retain all failures, source/index immutable during commands, actual exits and source/artifact SHA256 verified.

- **代码实体**：不适用（过程项）。证据在 `n1n2-claude-021-final-summary.md`、`n1n2-claude-021-a1-diagnosis-and-cleanup.md`、`source-captures/`（逐字备份 + INDEX.json 十代候选）。
- **具体测试断言**：每一步 capture 的 `.exit`、`.result.json`（含 `source_changed`/`source_added` 与 `log_sha256`）均被**独立工具步骤**读取核对；15 份候选哈希与逐字备份逐一致。
- **实际 capture**：P08/A3c/B1/B2/C1/C2/C3/D1(失败)/D2/D1b/D3/D4/D5 + tsc 001..020（全部保留，含全部失败：`n1n2-claude-021-run-A1`、`-A1b`、`-A2`、`-A3`、`-D1` 与 tsc 001/002/003/005/008/011/013）。
- **尚缺证据**：**候选 commit 仍为 null**（`candidate_commit: null`）——冻结的候选提交尚未产生（Git 索引/提交由 MAIN 独占），本项因此**未闭合**；另 D2 的越条件启动仍需 MAIN 处置。
- **限制**：运行期间源/测试/工具/配置/索引全冻结（每步 `source_changed=[] source_added=[]`）；历史目录 170 个只记录不盲删。

## REVIEW · independent_acceptance
> Freeze actual candidate and obtain independent review bound to it; fix then reverify affected gates. No self-signed external pass.

- **代码实体**：不适用。
- **具体测试断言**：**无**——尚无绑定本候选的独立复核（原 round3 审的是 019 字节，不是本候选）。
- **实际 capture**：无。
- **尚缺证据**：**整项未闭合**：候选未冻结提交、未取得绑定其上的独立复核。
- **限制**：**不自助外审**；本文件的任何表述都不构成外审 PASS。

## NEXT · next_integration_plan
> After N1N2 acceptance freeze compatible next-stage contract and exact implementation/acceptance plan; no premature S01/NativeAck/Studio/film/A readiness claim.

- **代码实体**：不适用（未开始，按设计）。
- **具体测试断言**：无。
- **实际 capture**：无。
- **尚缺证据**：**更正我此前的表述**：**并非完全未开始** —— canonical 的 next-wiring-draft **规划包已存在**
  （`resume-claude-20261112/next-wiring-draft`），其状态是 `DRAFT_PENDING_N1N2_ACCEPTANCE`；**尚未完成**的是
  「冻结**已接受**的候选提交后重锚下一阶段合同与实施/验收包」这一项 ✔。
- **限制**：本轮**未**实现 S01/NativeAck/Studio/Context/selection DDL/接线；**未**宣称 loaded、Ack 落行、影片或 V1 可用；未提交、未改索引。

---

## 非替代规则逐条对照（MAIN 原文）

| 规则 | 本候选的事实 |
|---|---|
| No test count substitutes original requirement coverage | 本文件按 17 条逐条给证据/缺口，**不以通过数代替覆盖**；多条明确写「尚缺证据」（R06 的环境指纹、R07 budgets 的路径溢出/stat 故障、R07 fd 的数字复用情形、REVIEW 整项、EVIDENCE 的候选 commit、NEXT 整项）。 |
| 020 passed on old bytes remains historical and cannot prove021 | 020 及更早的捕获（001..006、resume-*）保持历史身份；本候选的证据只来自 021 链（P08/A3c/B1/B2/C1/C2/C3/D1b/D3/D4/D5）。 |
| Foreign negatives independently hit intended boundary, including actual service.record promotion and actual consumer refusal | 每个反例各自命中自己的边界且互不遮蔽：K01-a（未知/复制/同形 lease，producer 前零副作用）、K01-b（另一真实 service）、K01-c（**真实 service.record 拒绝**手工品牌见证）、K01-d（被替换 view 的 lease，**生产前**拒绝且页面 origin 无请求）、K04-a（**真实消费侧拒绝** FORGED）、K04-b（真实消费侧拒绝 STALE）、K05-a/b（真实 close 故障）。 |
| owner/base/control/ref/generation distinct authority changes with recorded hit | K06-b 归属（`cp_a0_bootstrap_command.principal_id`）、K06-c base（`project_state.revision`）、K06-d control（`project_state.control_revision`）、K06-e ref/generation（真实重建）——**三个分开的真实权威 + 一个 view 权威**，各有记录的 hit。 |
| No browser grant inferred from component grant; actual producer success required, no mocks or permanently disabled family | 浏览器批次 **A3c/B2 真实绘制成功**（B0-1/B0-2/B0-4，固定上游自己的 serving + 默认 timeline 运行时）；无 mock；两个族都有合法正向（页帧族 B0-4、海报族 B0-1）。 |
| Real cleanup failures retain primary and every genuine cause; borrowed numericFD never retried | K05-a（producer primary + 全部 genuine cause 并存）、K05-b（成功但清理失败 → 不交付 + 粘滞）、K02-c（副本移除失败 → 平台真实错误码 + 粘滞）；close hook 先真实 close 再报故障，**不**复用裸数字 FD。 |
| Historic parse-prefix leftovers require ownership proof before removal; no blind glob delete | 170 个 `narralens-n1n2-film-*` 全部记录归属、**一个未删**；今日新增 0 个。 |
| Failed captures preserved with complete commands/exits/hash inputs; unknown cause remains unknown | A1/A1b/A2/A3/D1 与 tsc 001/002/003/005/008/011/013 全部保留（命令、exit、日志 hash、输入摘要齐全）；未知原因未被猜测填补（如 K01-d 的误入绘制被如实记为窗口未开）。 |
