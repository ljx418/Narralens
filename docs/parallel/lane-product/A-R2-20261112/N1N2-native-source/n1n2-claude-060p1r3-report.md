# n1n2-claude-060p1r3 — 定点生命周期修复报告（十一轻量门，非 P2）

- release_id: `MAIN_RELEASE_060P1R3_TARGETED_LIFECYCLE_REPAIR`
- task_id: `task_8b6607f1acb4` / dispatch_id: `ctx_b76df1e29d74`
- 依据: `repair-060p1r3/RELEASE.json`、`repair-060p1r3/SPEC.md`、`repair-060p1r2/independent-review/custodian-review/REVIEW.md` + `FINDINGS.json`（**R2-C04/C06/C08/C09/C11、R2-N01..N04**）、`repair-060p1r2/independent-review/integration-review/REVIEW.md` + `FINDINGS.json`（**R2-I01..I07、R2-N01**）、`repair-060p1-review/ADR_060_REV3_CUSTODIAN_AND_REPAIR.md`（rev3）、`repair-060p1-review/060P1R_PRIVATE_CONTRACT.md`、`repair-060p1r2/SPEC.md`
- 上一波 `n1n2-claude-060p1r2-report.md` 与 `n1n2-claude-060p1r2-evidence-gap.md` **不覆盖**：本报告逐编号回应两位复验的新编号。
- 基线核对（写前）：**22 份 start_sha256 全部逐项实测一致**（0 mismatch）；`AGENTS.md` sha256 `37300463…4542b` 与 release 的 `protected_AGENTS_sha256` 一致；**git index 空**；HEAD 仍 `1d348d419120f23f45d958112ea8c43df5a04675`（历史 base）。**无 reset/stash/checkout/commit/push**。
- 实施者自签：**不是外审**。源码冻结、独立复验与运行票由 MAIN 组织。

## 0. 结论

本波**没有重写已通过的部分**：启动链（detached C、自身 session 核对、exec 管道所有权、非阻塞 exec 状态）、私有 HOME/XDG、phase lease 骨架、队列与单一 READY 预算**原样保留**。改动集中在复验指出的**九组真实缺口**：

1. **UNKNOWN 真的进入状态机**（R2-C04/N02、R2-I06）：`TargetCensus`（`cache-process-custodian.py:609`）把「活着的」「待 reap 的僵尸」「**UNKNOWN**」三件事分开；`group_members`（`:285`）在任何成员不可读时返回 `None` 而**不是**跳过它；`direct_children`/`read_process_identity` 的错误**不再**变成空列表；`_target_census`（`:1445`）把 UNKNOWN 带进状态机；`_reap_adopted`（`:1522`）与 `_reap_worker`（`:1553`）返回 **(waits, unknown)**；`TargetSettlement.run()`（`:769`）在 UNKNOWN 或仍有活目标时**不 reap N**、**不退出 C**，而是进入 `RECOVERY_HELD`。
2. **C 保留活的 wait owner 与 N 锚**（R2-C04）：显式状态机 `RUNNING → SETTLING → RECOVERY_HELD → SETTLING → RECEIPT_FLUSH → EXIT`（`:161` 起）；`_recover()`（`:1801`）在持责恢复中**保留 fork 事实、活 C、未 reap 的 N 锚、控制通道与原 failure**，并按**有界**间隔重查（`_wait_for_recovery` `:1838`，**不是 busy loop**）；Host 的 `reconcileCleanup` 通过 **`RECHECK` 命令唤醒活的 C**（`cache-process-supervisor.ts:#askCustodianRecheck`），而不是只检查 C 已 close 后的尸体。
3. **execution-ended 与 result-success 分离**（R2-C06）：C 的**诊断预算违规独立锁存**原 failure（`cache-process-custodian.py` 的 `_drain_worker_streams`），即使 domain 全 reap 也不能候选成功；收据带**完整 C/N 父身份 epoch**、exec 状态、wait 序列、目标枚举与最终 gone、诊断丢失/字节数/原 failure；Host **共用两个验证**：`validateCacheDomainReceipt`（`:756`，资源真的结束）与 `validateCacheExecutionReceipt`（`:891`，允许交付成功）——**清理证明可以成立而业务失败仍拒绝，且不因此永久 held**。
4. **完整分段 receipt 与真正 flush 状态**（R2-C08）：两端同步实现**有界 sequencied segments**（每段严格 <16KiB，段序/count/hash 明确），最终 summary 只含总量/摘要/状态与必要绑定；Host 按序收、增量摘要、严格聚合上限/身份 512/去重（`CacheReceiptAccumulator` `:513`），丢失/乱序/多余/truncated **fail closed**；C 本地 raw reap 后进入 **`RECEIPT_FLUSH`**（`:2031`），EAGAIN/短写**等未来 writable 再继续**（`_wait_writable` `:2054`），有界 deadline 内 flush；**不再"两次 flush 后 exit 4"**。
5. **真实事件入口 + 单一 finalize 截止**（R2-C09/N01/N03、R2-I05）：spawn 返回后**立即**装 ChildProcess 与两个私有 socket 的 **error 监听**（`cache-process-supervisor.ts` 的 `#run`），记录异步 ENOENT/EAGAIN/EPIPE/ECONNRESET，**error 不当 exit/close**；候选后的 draw 消息**与 C 的收据并发处理**（`#observeDrawTerminal` `:2244`）：`closed:false`/`fatal`/协议错都走**原锁存**；worker 的 `closePageFrames` 失败现在带**有界 error envelope**（`openfilm-cache-worker.mjs`）；**FINALIZE 前的 draw EOF 锁存具体失败**（`cacheDrawEndFailure` `:712`），FINALIZE 后是正常对照；**同一个 candidate 时间的 deadline** 管到 receipt、到 C 的 exit/close、到最终 fresh proof（3s 过期 → 锁存失败 → owned cleanup 继续，**迟到 close 只能完成失败清理，不能变成迟到成功**）。
6. **NOT_OWNED 普通拒绝 vs 真实 UNKNOWN，保原 promise**（R2-I01）：phase lease 增加 **`notOwned()`**（`cache-production-scope.ts:179/513`），**从未开始的阶段**记录 NOT_OWNED 事实并**正常释放 scope、下次可准入**；**真实取得资源而结束未知**的，workspace **保留原 closure、原资源对象、原 wholeProduction promise 与 scope** 到 fresh reconcile（`created-native-workspace.ts` 的 `#holdProduction` `:837`），**不先 reject 原 operation**，结束后**仍返回原 error**。
7. **精确责任可恢复、拒绝历史有界、终端目录回收**（R2-I02/I03/I07）：bridge 保存**全部未结责任**的 `issued handle → 责任` 映射（`openfilm-upstream.ts:1665`），**A held 时同 bridge 的 B 排队不会遮住 A**；工厂准入拒绝/超时/取消在**无未知资源且完整清理后**进入**终态 `refused`**（`:420/732`）并被剪枝，**调用计数只对真正计入的调用减**；held 后真实 reconcile 结束，**同一 owner 一次清私有 run 目录**（`#releaseRunDirectory`）。
8. **安全 pilot 是首门**（R2-C11、R2-I04、R2-N04）：lifecycle 测试**重写为两个安全 stage**——① **C identity（不发 AUTHORIZE_FORK）** ② **最小正向 synthetic protocol 往返**；`reserve/start` **立即登记真实 handle 与 owner**，所有 await/expect 在 **try/finally**；目录**只在真实结算后**才可删，UNKNOWN **保留并报告**；helper 被**复制进独占 runtime 根**并**校验固定 sha256**，scenario/events **不再写在 tests 源码旁**；leader-first 孙进程改用**owned sink（events 文件）**，**不再因父读端关闭 EPIPE 自行退出**。
9. **真实分支轻量验证**：Python 单元门**不再只喂 `FakeSettlementOperations`**——它现在**驱动真实的 `Custodian._settle_domain → KernelSettlementOperations → proc/wait/selector`**（35 例）；TS 纯门用**局部 mock**驱动**真实的 supervisor pump / 消息解释 / workspace-phase 调用**（58 + 16 例）。

本波**只运行本票允许的十一条命令**（外加一次许可的 `--generate`）：全部 exit 0，全部 runtime 捕获 `source_changed=[]`；生成捕获的 `source_changed` **恰好只有** `src/adapters/openfilm/cache-worker-integrity.json`。**所有真实 custodian / prctl / fork / setsid / wait / signal / 子进程故障 / HTTP / Chrome / ffmpeg / ffprobe / 媒体 / fullcheck / build 均 NOT_RUN**。原 17 与 ISO-01..18 **不减**，A057-04 **未关闭**，N1N2 / NativeAck / Studio / A 片 / V1 **不可用**。

## 1. 复验的新编号逐条闭环

图例：**已实证** = 本波有真实捕获证据；**实现，真实证据 NOT_RUN** = 代码写了，但需要真实进程/浏览器/媒体；**NOT_RUN** = 本波未跑也未实现到可运行状态。

### 1.1 custodian-review（R2-C04/C06/C08/C09/C11、R2-N01..N04）

| 编号 | 级别 | 修订 | 实现位置 | 本波证据 |
|---|---|---|---|---|
| **R2-C04** | MAJOR | **UNKNOWN 保留活的 wait owner 与 N 锚**：`TargetCensus` 三态（live / pending-zombie / unknown）；`group_members` 任一成员不可读即 `None`；`_reap_adopted`/`_reap_worker` 返回 `(waits, unknown)`；`TargetSettlement.run()` 在 UNKNOWN 或有活目标时**不 reap N、不退出 C**；`_recover()` 进入 `RECOVERY_HELD`，**保留 fork 事实、活 C、N 锚、控制通道与原 failure**，有界重查且**不 busy loop**；**所有 post-fork 异常**（含 `set_blocking`/selector 注册）由 `run()` 的**宽 handler**接住并进入同一结算分支（不再逃到 `main` 的 return 2 丢 owner）；**ECHILD 只在 N 之后**问（`waitpid(-1)` 不会提前 reap 锚） | `cache-process-custodian.py:609` `TargetCensus`、`:685` `SettlementOperations`、`:686` `TargetSettlement`、`:769` `run(resignal)`、`:843` `KernelSettlementOperations`、`:1445` `_target_census`、`:1522` `_reap_adopted`、`:1553` `_reap_worker`、`:1613` `_settle_domain(resignal)`、`:1696` `run()`、`:1772` `_run_loop`、`:1801` `_recover`、`:1838` `_wait_for_recovery`、`:285` `group_members` | **已实证**（Python 单元 35/35，真实 adapter）：`TheRealAdapter` 的 `test_an_unknown_census_keeps_the_anchor_of_the_worker`（枚举 None → **不 reap N**、unknown=True、anchor_held=True）、`test_an_enumeration_that_fails_after_the_kill_keeps_the_anchor`、`test_a_failure_after_the_fork_is_reported_and_the_domain_is_settled`（`run()` 宽 handler → CUSTODIAN_FAILED + DOMAIN_REAPED + **非零退出**）；**真实 KILL 未终止 / 真实延迟收养：NOT_RUN** |
| **R2-C06** | MAJOR | **execution-ended 与 result-success 分离**：C 的诊断预算违规**独立锁存**原 failure（`diagnostics_lost` + `_failure`），domain 全 reap 也不洗白；C 的退出码在有 failure 时**非零**；收据带**完整 C/N 父身份 epoch**（pid/ppid/pgid/sid/start_ticks）、exec 状态、锚与 wait 序列、目标枚举与最终 gone、诊断丢失/字节数/原 failure；Host **共用两个验证**：`validateCacheDomainReceipt`（结构+绑定+wait/epoch/exec 语义）与 `validateCacheExecutionReceipt`（再加诊断/预算/原 failure/state）；**清理证明成立而业务失败仍拒绝，且不永久 held** | `cache-process-custodian.py` 的 `_drain_worker_streams`（锁存 `_failure`）、`:1951` `_send_receipt`（failure 字段）、`:1696` `run()`（退出码）；`cache-process-supervisor.ts:756` `validateCacheDomainReceipt`、`:891` `validateCacheExecutionReceipt`、`:2227` `#receiptEligibility` | **已实证**（identity 58/58）：`the proof of the domain and the eligibility of a success`（13 例：错 draw/ticket/protocol/seq/outcome/ECHILD/组/身份/事件链/等待数/epoch/exec 全拒；**`keeps the proof of the domain and the eligibility of a success apart`**——`diagnostics_lost`/超预算字节/custodian failure/`recovery_held` **domain 证明仍成立但不允许成功**）；**真实 flood 后候选：NOT_RUN** |
| **R2-C08** | MAJOR | **分段 receipt + 真正 flush 状态**：C 把 events/waits/identities 拆成**每段 <16KiB** 的 `RECEIPT_SEGMENT`（带 index/count/items_digest），最终 `DOMAIN_REAPED` 只含总量/摘要/状态与绑定；段**逐个**写出（队列先清空，绝不占用终端预留槽）；Host 按序收、增量摘要、**段数/条数/身份 512/去重**上限，**缺段/乱序/多余/截断/digest 不符全拒**；C 进入 **`RECEIPT_FLUSH`**：EAGAIN/短写**等未来 writable**（`select` 专等可写，不空转读），**有界 deadline** 内 flush；**未 flush 完不成功退出**；Host 断开 → 本地先清理 → 传输非成功退出 | `cache-process-custodian.py:1919` `_queue_segment`、`:1951` `_send_receipt`、`:2031` `_flush_receipt`、`:2054` `_wait_writable`、`:183` `RECEIPT_SEGMENT_MAX_BYTES`；`cache-process-supervisor.ts:513` `CacheReceiptAccumulator`、`:642` `cacheInterpretControlMessage`、`:756` `validateCacheDomainReceipt` | **已实证**：Python `test_the_receipt_is_segmented_and_bounded`（**多段**、每段 <16KiB）、`test_the_receipt_flush_waits_for_a_later_writable`（**EAGAIN → 等 writable → 写完**）、`test_a_broken_channel_is_not_a_success`；TS `the segments of a receipt`（7 例：乱序/重复/段数不符/digest 不符/身份重复/未知 kind）；**真实背压下的 transcript：NOT_RUN** |
| **R2-C09** | MAJOR | **候选后的终端消息真的被读**：`#observeDrawTerminal` 在**候选被接受之后**把 draw 队列里已到的帧**立刻解释**（`closed:false`/`fatal`/未知 kind → 原锁存），且 pump 在候选之后到达的帧**直接解释**（不再排队等人读）；worker's `closePageFrames` 失败改为**带 bounded error envelope**；**FINALIZE 前的 draw EOF 锁存具体失败**（零 witness），FINALIZE 后为正常对照；**不再等一个永不结束的 wrapper 才启用 owned termination**，原 3s 候选起截止保留 | `cache-process-supervisor.ts:2244` `#observeDrawTerminal`、`:676` `cacheInterpretDrawTerminal`、`:712` `cacheDrawEndFailure`、`#run` 的 `pumpDraw`/`onDrawEnd`；`openfilm-cache-worker.mjs` 的 `closeError` envelope | **已实证**（TS 纯门，真实解释函数）：`reads a closed message that failed as a failure of the draw`（closed:false → `WORKER_CLOSE_FAILED`、fatal → `WORKER_FAILED`、未知 kind → `PROTOCOL_UNEXPECTED`）、`reads the end of the draw channel as a failure only BEFORE the finalisation`；**真实 closed:false/fatal 的端到端：NOT_RUN** |
| **R2-C11** | MAJOR | **安全 pilot 是首门**：lifecycle 文件**重写为两个 stage**：① **C identity（不发 AUTHORIZE_FORK）**——直接 spawn custodian、读 C_HELLO、核对 pid/ppid/pgid/sid/start_ticks 与 `pgid==sid==pid`；② **最小正向 synthetic protocol 往返**（fixture 的 normal 模式，**真的成功**、digest 校验、收据校验、receipt_valid、目标组已 gone）；`reserve/start` **立即登记真实 handle**；所有 await/assert 在 **try/finally**；**目录只在真实结算后**才进 removable，UNKNOWN **保留并抛错报告**；probe 的 `reapHelper` **等真实 close**（deadline 只触发 UNKNOWN 保留，不当清理成功） | `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts`（全文重写：`ownChild`/`ownRoot`/`endChild`/`readControlFrame`/`createPilotRoot`）、`tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts`（`reapHelper` 返回真实 close） | **已实证**（类型/语法/静态）：owner 登记、finally 收割、UNKNOWN 保留；**真实两个 stage 的执行：NOT_RUN（P2a）** |
| **R2-N01** | MAJOR | **异步 spawn/socket 错误有监听**：spawn 返回后**立即** `child.on("error")`，两个私有 socket 也**立即**装 error 监听；原错误以**有界 envelope**保留（`normalizeNativeEnvelope`），走**同一 owned 清理**（锁存 → `nextControl/nextDraw` 返回 null → `#fail`）；**error 不当 exit 也不当 close**；区分**从未出生**（spawn 同步抛）与**born/unknown**（有 pid 后才出错） | `cache-process-supervisor.ts` 的 `#run`（`child.on("error")` 与 `onChannelError`）、`facts.custodianBorn`、`facts.transportFailure` | **已实证**（静态 + 类型）；**真实 next-tick error：NOT_RUN**（本波无法在轻量门里造出会通过身份核验的真实 child） |
| **R2-N02** | MAJOR | **不再用 close 缺失当 PID 权威**：C 的退出**一旦被观测**（`facts.custodianExit !== null`）就**绝不再按旧 pid 发信号**；只有在**退出未观测**且**内核确认仍是同一进程**（`/proc` 的 start_ticks 与登记的一致）时，才发**一次 SIGTERM**；**彻底移除了 SIGKILL**——超时**不再摧毁唯一的 reaper**；责任**留在 pending 的 owner**（held）而不是被信号杀掉 | `cache-process-supervisor.ts:#terminate`、`:2385` `#custodianIsStillThisProcess` | **已实证**（静态 + 类型）；**真实 exit 先于 close 的 PID 复用：NOT_RUN** |
| **R2-N03** | MAJOR | **一个 candidate 时间的 deadline 管到底**：`CacheDeadline` 从**候选**起算 3s，同时管 **receipt 到达、C 的 exit/close 与最终 fresh proof**；`#proveDomainGone(facts, finalize)` 在预算内等 close；**过期 → 锁存 `FINALIZE_TIMEOUT` → 走 `#fail`**（owned cleanup 在自己的动作截止内继续），**迟到 close 只能完成失败清理，不能变成迟到成功** | `cache-process-supervisor.ts:602` `CacheDeadline`、`:1602` `#run`（finalize 段）、`#proveDomainGone(facts, finalize?)` | **已实证**（静态 + 类型 + `the deadline of the startup chain` 纯门）；**真实 receipt 2.9s / close 4s：NOT_RUN** |
| **R2-N04** | MINOR | **leader-first 孙进程不再死于 EPIPE**：孙进程改用 **owned sink（events 文件）**，stdio 全部 ignore，**父读端关闭不会让它自行退出**；它从 **`/proc/self/stat`** 报**当前**身份（收养后 PPID=C），pilot 可核对同 epoch、TERM 后仍活、已触达才 KILL；**1024×0x4a 明确只是 synthetic protocol payload**，不称真实 JPEG/媒体解码 | `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs` 的 `spawnTermIgnoringChild`（events 文件 + `identity()`） | **已实证**（语法 + 静态）；**真实收养顺序与 KILL 前的存活：NOT_RUN（P2a）** |

### 1.2 integration-review（R2-I01..I07、R2-N01）

| 编号 | 级别 | 修订 | 实现位置 | 本波证据 |
|---|---|---|---|---|
| **R2-I01** | MAJOR | **NOT_OWNED 普通拒绝 vs 真实 UNKNOWN，保原 promise**：phase lease 增加 `notOwned(reason)`——**从未开始的阶段**记 NOT_OWNED、**正常释放 scope**、下次准入（**不伪造 settled:true，也不让三个 lease 空挂永久 held**）；**真实取得资源而结束未知**的，workspace **不先 reject 原 operation**：把原 closure、原资源对象、原 failure 与原 promise 留在 `#pendingProductions`，**scope 保持 held**，直到 fresh reconcile 重试释放成功 → settle lease → **一次** mint/consume/release → **以原 error 结束原 promise**；`close()/disposeAfterNative()` 通过 `#operations` **等这个 pending 生产**；inspect/reconcile **能触达真实未结束的 tree/parent**（不只是 supervisor 的浏览器） | `cache-production-scope.ts:179/513` `notOwned`、`:538` mint（读模块自己的相位记录）；`created-native-workspace.ts:837` `#holdProduction`、`:866` `#finalizeProductionScope`、`:244` `#pendingProductions`、`:513`（inspect 列出 pending）、`:545`（reconcile pending 分支）、`:1107`（trees 未释放 → hold 而非 throw） | **已实证**（scope 16/16）：`gives the root back when a phase was NEVER STARTED`（`owned:false` 的 receipt、root 回 idle、**下次同 root 可准入**）、`keeps the root held when a phase that WAS TAKEN did not end`（无 completion、root 保持 cleanup_required、**下一次准入被挡**）；**真实 tree close 故障下的原 promise 与 dispose：NOT_RUN** |
| **R2-I02** | MAJOR | **bridge 保存全部未结责任**：按**已签发的 opaque handle** 建 `Map<handle, 责任>`；**inspect 返回列表**（每个未结生产一条，各带自己的 handle）；**reconcile 直接按 handle 查**（不经一个会被覆盖的 current）；**每 draw 局部 current 仍保留**给父 drain 归属；cross-bridge / foreign / stale handle 仍被拒 | `openfilm-upstream.ts:1665` `unsettled`、`:1688` `inspect`、`:1692` `reconcileCleanup`、`:1740`（draw 内登记与删除）；`OpenFilmServingBridge.inspectCleanup(): readonly OpenFilmCleanupView[]` | **已实证**（静态 + 类型；`created-native-workspace.ts:513` 逐条列出）；**真实 A held / B 排队：NOT_RUN** |
| **R2-I03** | MAJOR | **拒绝也进入终态并被剪枝**：责任相位新增 **`refused`**（终态）；准入拒绝/超时/取消/关闭后被拒的 draw 在 finally 里**变成 `refused`**（原来停在 `queued`），于是**被剪枝**；**未 settled 的一条都不剪**（真实 held 保留）；**调用计数只对真正计入的调用减**（`counted` 标志），**不再出现负数**；保留最多 8 份 settled/refused 有界摘要 | `openfilm-upstream.ts:420/425`（相位）、`:546`（剪枝含 refused）、`:732`（refused 终态）、`counted` 标志、`:515` `openFilmProductionResponsibilityCount`（只读计数） | **已实证**（scope 16/16）：`ends a draw that was refused before it took a resource`（**真实工厂**连续 40 次无资源拒绝 → 责任表 **≤8**、close 真的返回）；**真实 queue-full/timeout 压力：NOT_RUN** |
| **R2-I04** | MAJOR | **失败清理不把 deadline 当 close**：lifecycle 与 probe 都改为**先登记 owner**（handle/child/identity/close promise）、**finally 里真正 close/reap**；**目录只在真实 close/结算后**才删，UNKNOWN **保留目录、场景、事件与 owner 并报告**；`reapHelper` 返回**是否真的 close**，5s 只触发 UNKNOWN 保留；**不靠测试框架 timeout 跳过后再 rm** | `cache-custodian-lifecycle.test.ts`（`owned`/`ownRoot`/`endChild`/afterEach 抛错）、`cache-frame-duration-lifetime.test.ts`（`reapHelper` 返回 bool、`owned` 账本、afterEach 抛错） | **已实证**（静态 + 类型）；**故意中途 assert 失败 / kill 抛错 / 延迟 close：NOT_RUN（P2a）** |
| **R2-I05** | MAJOR | **真实 draw EOF 取消进入失败锁存**：FINALIZE **之前**的 draw EOF **锁存具体失败**（`DRAW_EOF_BEFORE_FINALIZE`）→ **零 witness**；FINALIZE **之后**的 EOF 是正常对照（允许）；取消入口不再只发 CANCEL 而不锁存 | `cache-process-supervisor.ts:712` `cacheDrawEndFailure`、`#run` 的 `onDrawEnd` | **已实证**（纯门，真实规则函数）：`reads the end of the draw channel as a failure only BEFORE the finalisation`；**真实 pre/post FINALIZE EOF 的端到端：NOT_RUN** |
| **R2-I06** | MAJOR | **真实 adapter 把 UNKNOWN 传给状态机**（详见 R2-C04）：`group_members` 任一成员不可读 → `None`；`direct_children` 的 `None` → unknown 而非空；`_live_targets` 被 `_target_census` 取代，**Z 被当作待 reap 的资源而不是"没有目标"**；`_reap_adopted` 把枚举失败当 unknown；**UNKNOWN 期间不 reap N、不退出 C**；恢复后**孙先 N 后** | `cache-process-custodian.py:285`、`:1445`、`:1522`、`:686`/`:769` | **已实证**（Python 35/35，**真实 adapter**）：`test_an_unknown_census_keeps_the_anchor_of_the_worker`、`test_a_zombie_worker_and_a_living_grandchild_are_reaped_in_that_order`（**SIGKILL 真的发到组**、**waits == [300, 200]**、**`waitpid(-1)` 在 N 之后**）、`test_an_enumeration_that_fails_after_the_kill_keeps_the_anchor` |
| **R2-I07** | MINOR | **已证明结束的 held 之后，run 目录真的释放**：`reconcileCleanup` 在证明成立后**清 cleanupRequired**、**一次** `#releaseRunDirectory`；`#releaseRunDirectory` 的条件是 `settled && !cleanupRequired`；rm 失败**保留原 cleanup 对象**并可检视 | `cache-process-supervisor.ts:#reconcileCleanup`、`:1589` `#releaseRunDirectory` | **已实证**（静态 + 类型）；**真实 held→reconcile→目录一次清：NOT_RUN** |
| **R2-N01**（integration） | NOTE | **证据边界保持**：R2 的 3 份失败捕获（typecheck exit 2、custodian-unit exit 1、scheduler exit 1）原样保留；R2 那次**未记录的 `node --check`** 由 R2 的 evidence-gap 承认；旧 P1/P1R **四次**失败仍 UNRECORDED/UNKNOWN；R2 的 generate-001 记录 source_changed 仅 integrity JSON，与 P1R 的同字节重复区别保持 | 见本波 evidence-gap §1/§2 | **已实证**（本波 evidence-gap 逐条复述并**新增**本波自己的未记录承认） |

## 2. 文件清单（严格等于本票 allow_existing，**无新增文件**）

### 修改（14 份；其余 8 份**字节未变**）

| 路径 | 本波改了什么 | sha256 |
|---|---|---|
| `src/adapters/openfilm/cache-process-custodian.py` | `TargetCensus` 三态、UNKNOWN 贯穿状态机、显式状态机与 `RECOVERY_HELD`/`RECEIPT_FLUSH`、宽异常 handler、锚持有与 N-last 条件、分段 receipt 与可写等待、诊断预算独立锁存 | `78093fe81b31a55db1ffb500cdde19d5e67bf30d5ba884747c0ada643bfec221` |
| `src/adapters/openfilm/cache-process-supervisor.ts` | `CacheReceiptAccumulator`、分段收据的两个验证器、**纯消息解释函数**（control/draw/EOF）、error 监听、候选后终端消息、EOF 锁存、单一 finalize 截止贯穿证明、**不 KILL 唯一 reaper**、RECHECK 唤醒、run 目录一次清 | `b561eda7141590b98e00250a856688be80ddce1492955cf8a763b5fc1d47f07a` |
| `src/adapters/openfilm/cache-production-scope.ts` | phase lease 的 `notOwned`、收据的 `owned` 事实 | `0072d30b8e465658d26942010c7cad800bdedef5d32dc743df44e644acbef8b3` |
| `src/adapters/openfilm/openfilm-upstream.ts` | bridge 的**未结责任映射**与列表式 inspect、`refused` 终态与剪枝、计数修正、只读责任计数、`OpenFilmDrawResult` | `17fe1138e50bc30df5c26b74e1e0ff9393140c070e1233676d2811485890a2b6` |
| `src/host/agent-driven/created-native-workspace.ts` | pending 生产（保留原 closure/promise/scope）、`#finalizeProductionScope` 一次释放、inspect/reconcile 触达 pending、bridge 列表与 draw 结果 | `d83edbdac8cd6dd7db6b5d18f1d0f5d3beb028279297a822f59f97f6504d562c` |
| `src/adapters/openfilm/openfilm-cache-worker.mjs` | `closePageFrames` 失败的有界 error envelope | `579a484bea740d768f7b183b46de85775446a3b0f8ea62ab7927d7e026d5b089` |
| `src/adapters/openfilm/cache-worker-integrity.json` | **生成物**：本波这些字节的**第一次实际生成** | `55eadbd6a8f9ec72d1eb245eaddce83560bcd4bcb46edf0bffe92c3a54eec08c` |
| `tests/agent-driven/integration/cache-custodian-unit.py` | **35 例**：新增**真实 adapter** 的 UNKNOWN/僵尸/枚举失败/post-fork 异常/分段/flush 用例 | `713af110affccd7b613ed5df56fe9da5320a9eedb22ded834c1b3a75e9601e7d` |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | 新验证器签名、**分段累加器**、**真实消息解释**、domain vs eligibility、epoch 绑定 | `4d3e18f759496a2a4123fb2c89d737e682600073763b619908397899d9643585` |
| `tests/agent-driven/integration/cache-production-scope.test.ts` | NOT_OWNED vs UNKNOWN、**真实工厂的 40 次无资源拒绝**与有界账本 | `3aa86112afc8b419b03e4d9176dd4872bc39321d88fa8f712cfb2ca2530f6088` |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | **两个安全 stage**、owner 登记、finally 收割、UNKNOWN 保留、独占 runtime 根与固定 hash | `5491f60ef72a55486dd270fb97c680690cedfbb65d62f1d3a6f29902d77c35d0` |
| `tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts` | `reapHelper` 等真实 close、UNKNOWN 保留并报告 | `df45f9294d5b583367506ad4ce4fbc733a8c87e7997855fab8be2151e55864bc` |
| `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs` | 孙进程改用 owned sink 与 `/proc` 身份 | `e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab` |
| `tests/agent-driven/integration/native-cache-witness.test.ts` | 跟随 `bridge.draw()` 的新返回形状 | `33ce515e5555eb79ea842ee95d832bcf4d310df0696a6d75016d3e6cac1ac218` |

### 明确未动（字节未变）

`src/host/agent-driven/created-native-source-reader.ts`（`0a52b8ff…289e`）、`tests/m2.1/openfilm-upstream-lock.test.ts`（`9b2cf852…c175a`）、`tests/agent-driven/integration/created-native-source-reader.test.ts`（`6325eab3…d9784`）、`src/adapters/openfilm/cache-worker-policy.mjs`（`0d2b2b38…b1214`）、`tools/openfilm-cache-worker-integrity.mjs`（`8f59fb59…7d509d0`）、`tests/agent-driven/integration/cache-process-settlement.test.ts`（`ddd557cf…b115`）、`tests/agent-driven/integration/helpers/cache-probe-fixture.mjs`（`80388bae…20ef`）、`tests/agent-driven/integration/cache-serving-drain.test.ts`（`d9734282…bf1c4d`）。

**静态 fitness 未放宽**：m2.1 lock 整文件本波运行 **60/60 通过**（loader 导出集合、`openFilmServingBridge(owner, producer)` 的参数位置、Host 调用点枚举均未变）。公开 DTO、`EnginePort` 7、`pageFrame`/`close` 签名、`OpenFilmCacheProducerOwner` 形状、issued 品牌、正式 render / V / Approved015 / 公开合同 / 源事务 **未动**。**未新增**任何源文件、协议模块、测试文件、config、包脚本、依赖、路由、公共 DTO、EnginePort 方法；`cache-frame-duration-probe.ts` **仍未写**。

## 3. 本波执行的命令

recorder: `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`（sha256 `88cd47ec…fd10`，与 release 一致，**未修改**）。前缀 `n1n2-claude-060p1r3-`。运行期间源码冻结，无并行修代码。

### 3.1 十一条许可命令（全部 exit 0，`source_changed=[]`）

| capture | argv | exit | log sha256 | 内容 |
|---|---|---|---|---|
| `n1n2-claude-060p1r3-typecheck-001` | `corepack pnpm exec tsc --noEmit` | 0 | `e3b0c44298fc1c14…` | 类型全绿 |
| `n1n2-claude-060p1r3-syntax-worker-001` | `node --check src/adapters/openfilm/openfilm-cache-worker.mjs` | 0 | `e3b0c442…` | 语法绿 |
| `n1n2-claude-060p1r3-syntax-policy-001` | `node --check src/adapters/openfilm/cache-worker-policy.mjs` | 0 | `e3b0c442…` | 语法绿 |
| `n1n2-claude-060p1r3-custodian-syntax-001` | `python3.12 -I -S -B -c "ast.parse(…)"` | 0 | `dd8ee964b960e83e…` | `CUSTODIAN_SYNTAX_OK` |
| `n1n2-claude-060p1r3-integrity-check-001` | `node tools/openfilm-cache-worker-integrity.mjs --check` | 0 | `7480083d801311b0…` | `{"ok":true,"checked":8}` |
| `n1n2-claude-060p1r3-scheduler-001` | `vitest run … cache-production-scope.test.ts` | 0 | `9b48619c827a4e60…` | **16/16** |
| `n1n2-claude-060p1r3-identity-001` | `vitest run … cache-process-identity.test.ts` | 0 | `9730576b05d243f8…` | **58/58** |
| `n1n2-claude-060p1r3-m21-lock-001` | `vitest run … tests/m2.1/openfilm-upstream-lock.test.ts` | 0 | `5953e319f89241fe…` | **60/60** |
| `n1n2-claude-060p1r3-syntax-worker-fixture-001` | `node --check …/cache-worker-fixture.mjs` | 0 | `e3b0c442…` | 语法绿 |
| `n1n2-claude-060p1r3-syntax-probe-fixture-001` | `node --check …/cache-probe-fixture.mjs` | 0 | `e3b0c442…` | 语法绿 |
| `n1n2-claude-060p1r3-custodian-unit-001` | `python3.12 -I -S -B …/cache-custodian-unit.py` | 0 | `ea57a1768c572b4d…` | **35/35**（`Ran 35 tests … OK`） |

### 3.2 许可的生成（这些字节的**第一次实际生成**）

| capture | argv | exit | `source_changed` | log sha256 |
|---|---|---|---|---|
| `n1n2-claude-060p1r3-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | **`["src/adapters/openfilm/cache-worker-integrity.json"]`** | `34c83f4222134df8…` |

产物 sha256 `55eadbd6a8f9ec72d1eb245eaddce83560bcd4bcb46edf0bffe92c3a54eec08c`。**在最后一次改动任何被清单覆盖的文件之后执行**，只写那一个 JSON。

### 3.3 本波**未经 recorder** 的运行（如实承认，详见 evidence-gap §3）

本波的开发期试跑**没有**全部先经 recorder：我在实现过程中直接运行了**上表那十一条命令中的若干次**（`tsc`、三个 vitest、`node --check`×2、custodian `ast.parse`、Python 单元），其中**若干次是失败**。逐条清单与失败内容在 `n1n2-claude-060p1r3-evidence-gap.md` §3，**不补造**。最终的十一条捕获绑定的是**最终字节**，`source_changed=[]`。

### 3.4 **没有运行**（本票明令禁止）

真实 custodian / prctl / fork / setsid / waitid-waitpid / signal / 故障 child、任何真实子进程故障注入、HTTP/Host/Chrome/ffmpeg/ffprobe/媒体、fullcheck/build/Python golden、`cache-frame-duration-probe.ts`（**未写**）、`cache-custodian-lifecycle.test.ts` / `cache-process-settlement.test.ts` / `cache-frame-duration-lifetime.test.ts` / `cache-serving-drain.test.ts` / `native-cache-witness.test.ts` / `created-native-source-reader.test.ts`。没有联网/下载/付费/J 盘/凭据/.env/全量 env 读写；没有启动浏览器或用户窗口；**没有 git add/commit/reset/stash/checkout/push/merge**。

## 4. 资源状态机、FD/receipt schema、UNKNOWN 控制与恢复、原 promise 责任表

### 4.1 资源状态机（custodian）

```
RUNNING ──(CANCEL/FINALIZE/EOF)──▶ SETTLING ──(全部目标终局且等待充分)──▶ RECEIPT_FLUSH ──▶ EXIT(0)
   │                                   │
   │                                   ├─(UNKNOWN 或仍有活目标)──▶ RECOVERY_HELD
   │                                   │      │  (保留 fork 事实 / 活 C / 未 reap 的 N 锚 /
   │                                   │      │   控制通道 / 原 failure；有界重查 + RECHECK)
   │                                   │      └──(重查后证明)──▶ SETTLING ──▶ …
   │                                   └──(枚举/等待异常)──▶ RECOVERY_HELD（不 reap N、不退出 C）
   └──(任何 post-fork 异常)──▶ SETTLING（宽 handler 接管，owner 不丢）
```

- **动作有界，证明不充分只进入持责恢复，不叫已结束。**
- 恢复后完成的是**原失败**，不变成成功。
- 正常 TERM-ignore 仍须实际完成 **KILL + 收养 wait + N-last**；**永久 held 不能替代它**（真实路径见 §7）。

### 4.2 Host–C–N 的 FD 与 receipt 分段

| 进程 | 端点 | 责任 |
|---|---|---|
| Host | C 的 stdout/stderr 两 pipe | 各自有界（64KiB），超限**当场**锁存失败 |
| Host | 绘制双工 socket 父端（C 的子端为 fd3） | Host 与 N 各单 writer；**draw EOF 当场**发 CANCEL，**FINALIZE 前**另锁存失败 |
| Host | 控制双工 socket 父端（C 端为 fd4） | 分段收据与最终 summary；**error 监听**；C 端断开 → 本地先清理 |
| C | fd3 绘制子端 | 只为 fork/exec 交给 N，**父进程随即关闭自己的副本** |
| C | fd4 控制端、selector/wakeup、exec-status | 仅 C 持有；N exec 前关闭（**exec 写端除外**）；exec-status CLOEXEC 且父进程立刻关写端 |
| C/N | N 的 0/1/2/3 | N fd3 = 绘制端；N 关闭一切 >3（**exec 写端除外**） |

**receipt 分段 schema（两端同步）**：

| 帧 | 内容 | 上限 |
|---|---|---|
| `RECEIPT_SEGMENT` | `seq`、`index`、`count`、`items[]`（`t`=`e`/`w`/`i`）、`items_digest` | 每帧 body **< 16KiB**（目标 ≤8KiB） |
| `DOMAIN_REAPED`（summary） | `protocol`、`draw_id`、`ticket_digest`、`seq`、`outcome`、**C/N 完整 epoch**（pid/ppid/pgid/sid/start_ticks）、`exec`、各流 **count + digest**、`segments`、`events_truncated`、`identity_overflow`、`anchor_retained`、`echild`、`group_esrch`、`known_ids_gone`、`diagnostics_lost`、`stdout_bytes`/`stderr_bytes`、`failure`、`state` | **终端预留槽**（1 帧 + 16KiB），summary 远小于 16KiB |

聚合上限：items ≤ 4096、**身份 ≤ 512 且去重**、段数必须**声明数 = 实到数**。

### 4.3 UNKNOWN 的控制与恢复入口

| 入口 | 位置 | 作用 |
|---|---|---|
| `RECHECK`（Host → C） | `cache-process-supervisor.ts:#askCustodianRecheck` | 唤醒**仍活着**的 C 重查一次；Host 等一张新收据（有界） |
| `CUSTODIAN_HELD`（C → Host） | `cache-process-custodian.py:_recover` | 报告持有责任：原 reason、reasons、`anchor_held: true` |
| `reconcileCleanup(handle)` | `cache-process-supervisor.ts` | 先 RECHECK，再走**同一套** domain 证明；成立后清 `cleanupRequired` 并**一次**释放 run 目录 |
| `RECOVERY_HELD` 重查 | `cache-process-custodian.py:_wait_for_recovery` | 有界间隔（0.5s）+ 立即响应 RECHECK；**不 busy loop**、**不再发第二个信号** |

### 4.4 原 promise 的责任表（workspace）

| 阶段 | 真实取得资源？ | 结束方式 | scope | 原 promise |
|---|---|---|---|---|
| execution | 是（bridge 的 draw） | 正常/失败 | 保持 | 继续 |
| parent_drain | 是（bridge 的 drain） | bridge 在 drain 后 settle 租约 | 保持 | 继续 |
| tree_release | **是**（PRE/POST 树） | 两棵树**都**释放成功 → settle | 保持 | 继续 |
| tree_release | **否**（PRE 前拒绝） | `notOwned()` → NOT_OWNED 事实 | **释放**，下次可准入 | **以原 error 结束** |
| tree_release | **是**且**结束未知** | **不 settle** → 无 completion → **root 保持 held** | **保持 held** | **保持 pending**（不先 reject）；reconcile 成功后**以原 error 结束** |

## 5. 本波**未**做（NOT_RUN 清单）

| 项 | 状态 |
|---|---|
| 真实 C 启动 / prctl GET 回读 / detached 的 sid/pgid | **NOT_RUN** |
| 真实 exec 成功 / 真实 errno / 子进程卡在 exec 前 | **NOT_RUN** |
| 真实 waitid(WNOWAIT) 锚 / 延迟收养 / 真孙进程忽略 TERM / 组 KILL / Z 全回收 | **NOT_RUN** |
| 真实 UNKNOWN → RECOVERY_HELD → RECHECK 恢复 | **NOT_RUN** |
| 真实分段 receipt 在背压下的完整 transcript | **NOT_RUN** |
| 真实候选后 `closed:false`/`fatal`、pre/post FINALIZE EOF、receipt 2.9s / close 4s | **NOT_RUN** |
| 真实 HTTP/Host/Chrome/ffmpeg/ffprobe/媒体 | **NOT_RUN** |
| lifecycle 两个 stage、settlement、frame-duration、serving-drain | **NOT_RUN**（P2a 授权后） |
| `native-cache-witness.test.ts` / `created-native-source-reader.test.ts` | **NOT_RUN**（P2a/P2b） |
| fullcheck / build / Python golden / 全量门 / 独立外审 | **NOT_RUN** |
| 原 17 与 ISO-01..18 的整体验收 | **NOT_RUN / 未整体验收** |

## 6. 剩余风险（真实）

1. **收据协议是本波再次改动的两端契约**（分段 + epoch + wait 语义）。两侧字段名、段语义、digest 口径必须**逐字一致**；一处写错就是「永远拿不到有效收据」＝**每条 draw 都失败**。这是本波最大的耦合风险，P2a 的第一条命令必须先证它。
2. **`RECOVERY_HELD` 的 60s 预算**是本波新定的：C 在 UNKNOWN 时最多持责 60s，之后**非成功退出**（此时 N 的僵尸会被 init 收养）。这个数字**未经真实内核验证**。
3. **`ECHILD` 与锚的次序**已在纯单元层证明（`waitpid(-1)` 在 N 之后），但**真实内核**的收养时序仍未跑。
4. **Host 不再 KILL C** 是有意的：若 C 真的挂死，draw 会**一直 pending**，根一直 held。这符合 ADR 的「保全异常」，但意味着**一个卡死的 custodian 会占住一个额度**。
5. **workspace 的 pending 生产**把「原 promise 不先 reject」落到了代码上，但**真实 tree release 失败**下的 dispose 顺序**未经真实运行**。
6. **bridge 的未结责任映射**是进程内的：一个**活着的 bridge**可以持有多个未结责任；**跨进程/跨 service 的 handle 仍被拒**（静态）。
7. **helper 的 runtime 根**在 `var/native-cache-pilot/`：单槽、独占、每跑一次一个目录；**未被清理的目录会留下**，pilot 必须自己收。
8. **scope 纯门现在会导入上游**（读 pinned vendor 树、跑一次只读 git 状态），它**不再是纯内存**的门；它仍然**不启动任何进程**、不碰媒体与浏览器。
9. **本波没有跑任何真实进程**：worker、custodian、Chrome、ffprobe、Host 全部 NOT_RUN。所有关于「真的会这样」的陈述都是代码级论证。
10. **本波的开发期运行没有全部先经 recorder**（§3.3）：最终的十一条捕获绑定最终字节，但**中间失败没有独立日志**。

## 7. 下一最小 pilot：C identity → normal 的**精确单 case 计划**（**本波不执行**）

### 7.1 单 case（stage ①：C identity）

- **argv**：`/usr/bin/python3.12 -I -S -B <abs>/src/adapters/openfilm/cache-process-custodian.py`，stdio `["ignore","pipe","pipe","pipe","pipe"]`，`detached: true`。
- **cwd**：仓库根 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`。
- **root**：**无**（stage ① 不 fork、不用 worker、不建 runtime 根）。
- **先登记 owner**：spawn 返回即记录 `child.pid`、`child.stdio[4]` 的 close promise、**不加入 removable**；`finally` 里 TERM → 有界等待 → KILL → **等真实 close**；**真实 close 未到 → kept + 抛错报告**。
- **断言**（最小集）：C_HELLO 的 `protocol`/`seq=1`/`subreaper=true`；内核身份 `pid == child.pid`、`ppid == Host`、`pgid == sid == pid`、`start_ticks` 相等；**不发 AUTHORIZE_FORK**（C 不 fork 任何东西）。
- **故意断言失败的清理方案**：把「`ppid == Host`」改成故意错的值 → 断言必须失败 → `finally` 必须**真的**结束 C 并**等它的 close** → 目录（无）不删 → 报告 owner 已收尾。
- **单 slot、一次一个**，用完即弃。

### 7.2 单 case（stage ②：最小正向）

- **前置**：stage ① 通过；`var/native-cache-pilot/run-XXXX/` 独占根；**复制已受审 helper**（sha256 `e3f4ccb1…3ab`，不符即拒）到该根；scenario=`normal` 写在**副本旁**。
- **argv**：`corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-custodian-lifecycle.test.ts`（**只跑 stage ② 那一个 case**）。
- **先登记 owner**：`reserve` 得到的 handle、supervisor、C 的 pid/identity、close promise **立即**登记；目录**不进 removable**，直到真实结算。
- **必须产出**：C/N 的真实 `(pid, startticks, pgid, sid)`、C 的 `pgid==sid==pid`、**分段收据的完整 transcript**（段序/count/digest）、summary 的 totals/digest、**C exit 0 + 真实 close**、**目标组 gone（含 Z）**、picture 的 **sha256 与长度**与 helper 声明一致、**不是**只看 `length > 0`。
- **失败即失败**：任何一环对不上 → 记录**精确**的失败原因，**不**把「任意 reject」当成功；根**保留**并报告。

### 7.3 之后的顺序（本票只建议）

stage ② 通过 → 再安排 **TERM-ignore / leader-first 收养 / preHELLO / Host EOF / 收据背压 / flood / C 死亡** 的负例（每个都有正常对照与「已触达才注入」的观测）→ 再是 **Q2 真实事件 pilot**（上游 probe 路由**不改**）→ 之后才是 P2b 的 Chrome。

## 8. 交还

唯一 writer 权与重型槽在本报告完成后交还 MAIN。本波**不**继续实现，也不运行 §7 的 pilot。下一步是 MAIN **定点复核真实安全门**（重点是收据分段协议的两端一致性与 UNKNOWN 持责路径），再发最小 P2a。A057-04 **未**关闭；N1N2 / NativeAck / Studio / A 片 / V1 **不可用**；原 17 与 ISO-01..18 的真实整体验收未通过。

## 9. 证据缺口

见同 prefix 的 `n1n2-claude-060p1r3-evidence-gap.md`：旧 P1 的 2 次、P1R 的 2 次、本波**自己未记录的开发期运行**（含失败），以及 IR10 历史「零 spawn」与「idempotent generation」两处说法的保留与更正。**任何旧报告都不被覆盖。**
