# Narralens A BRIDGE Claude · 只读启动就绪检查

生成时间：2026-11-11T16:21:51+08:00（UTC 2026-11-11T08:21:51Z）
执行者：BRIDGE ClaudeCode 窗口（Orca handle `term_f361b74a-b799-4f1a-8172-f3e44bd052e9`）
父任务：`task_a915784941ed`；父协调终端：`term_6b4f4382-d829-4065-b446-97808e041937`
本轮性质：**只读开发启动检查**。不是产品验收，不是独立审查，不是 A/V1 结论。
本轮唯一写入文件：本文件 `docs/execution/A/relaunch-20261111/bridge/CLAUDE_READINESS.md`。其余全部只读。

---

## 0. 结论摘要

**结论：NEEDS_REVISION。**

4 份文档在**代码事实层面经得起逐条核对**：DESIGN.md 中 13 组可核断言我全部实读复现，未找到一处与源码矛盾的描述；ACCEPTANCE.md 引用的 17 个测试/工具路径全部真实存在；TASK.md 的基线、dirty 清单与 MAIN 逐字节一致；CLAUDE_PROMPT.md 与本次派发授权完全对齐。**文档不是空头计划，可以接手。**

但在 MAIN 发布具体 ReleaseAssignment 之前，有 **3 处必须先修订的实质问题**，否则接手的 Claude 会基于过时或缺失的事实开工：

| 编号 | 级别 | 问题 |
|---|---|---|
| F-01 | 高 | `change.prepare` / `change.approve` / `change.apply` 在 MAIN **完全没有实现**（不是"未注册"）。R5 因此不只是"门状态"问题，还缺整条 producer 链。 |
| F-02 | 高 | 生产环境**不存在** `ProductFactPort` 与 `TrustedAdoptionAuthority` 的任何实现（仓库中唯一具体实现是测试替身）。当前 `prepareRun`/`authorizeRun`/`decideReview` 必然硬失败。 |
| F-03 | 高 | draft-processor 的 "closure 局部静态 PASS" 记录**绑定的是更早的字节**；当前 dirty overlay 的 processor/store/worker 及 4 个测试文件已全部漂移，closure 未覆盖当前字节。 |
| F-13 | 高 | **（新增，见第 5.2 节）** MAIN 新拟的"窄 internal effect"（`prepare_review_impact` / `apply_review_adoption`，明确不经 HTTP）与冻结的 `change.*` 路由之间**存在 wire 缺口**：三条冻结路由仍 0 producer；若 internal effect 真的不经 HTTP，`change.apply` 就没有任何 wire 入口，而 ACCEPTANCE BR-A-05 仍以 `change.prepare/change.apply` 为入口。 |
| F-14 | 高 | **（新增）** prepared 场景下 `ReviewPackage.impact` 由谁构造未定：现有 `publishReviewPackage` 的 `impact` 是**调用方传入的可选参数**，MAIN 未指明 prepared 产物的 `Change`（`base_revision`/`control_revision`/`source_digest`/`selection_version`/`plan_sha256`/`target_snapshot_id`/`expires_at`/`state`）的事实来源与构造点；`decideReview` 要求 `state==='active'` 且未过期。 |

另有 F-04..F-12、F-15..F-17 共 12 项中低级发现，全部列在第 5 节。

**对 MAIN 新追加内容的核对结论（16:22:14 追加的 DESIGN/ACCEPTANCE/TASK 三节）**：新增的 prepared-source@1 / 窄 internal guard / delivery QC→package / R6 四组提案，其**事实基础均已实读复现且正确**（详见第 5.2 节的开头），不是空头提案；其中 **R6 的字段契约与现有 `LocalAsset` 数据模型完全吻合**，`ps_` 命名空间可落进冻结 `materialization_id` 模式而**无需扩 80defs** ✅。但新提案**尚未闭合 wire 入口与 impact 构造点**（F-13/F-14），且 delivery 子阶段事实与 R6 附属 transport 仍缺规范归属（F-15/F-16）。

**R5 判定：门已从"缺明确门"收敛为"门有轮廓但无 owner/无 wire/无 impact 构造点"。** 现有 guard 与 `decideReview` 的实读结论与 DESIGN 一致（`A_DISPATCHABLE_RUN_STATES=[ready,running]`、`A_DISPATCHABLE_ATTEMPT_STATES=[pending,running]`；`decideReview` 不写 `step_attempt`）。MAIN 新拟的窄 internal effect **方向正确且守住了"普通 action 的 dispatchable 集合不变"这条红线** ✅，但仍缺：归属与文件释放、事务边界、attempt 表示、**wire 入口（F-13）**、**impact 构造点（F-14）**、逐 action 负例绑定。**BR-A-REVIEW 必须保持 BLOCKED_FOR_CONTRACT；不得放宽 `A_DISPATCHABLE_*`；不得把 `waiting_user` 加入通用 dispatch 状态。** 本轮不实现、不放宽。

**即使本文件判为 READY 也不自动写任何代码。** 唯一授权是本文件的写入。

---

## 1. 会话、CLI、cwd 与路径可达性

| 项 | 实测值 | 来源（只读） |
|---|---|---|
| 实际 cwd | `/mnt/c/workSpace/videoWorkLine` | `pwd` |
| Orca worktree 绑定 | `ORCA_WORKTREE_ID=90974dd7-625f-46bf-a442-37f7cbadac25::C:\workSpace\videoWorkLine` | 环境变量 |
| `ORCA_CLI_COMMAND` | `orca-ide` | 环境变量 |
| orca-ide 实体路径 | `/mnt/c/Users/Administrator/AppData/Roaming/orca/wsl-managed-cli/67da581b740dd1fd43cd/orca-ide` | `which` |
| Orca 应用状态 | `ok:true`，app running(pid 4104)，runtime `state:ready` / `reachable:true` / `connected` | `orca-ide status --json` |
| 实时 guide | 已用同一二进制执行 `orca-ide skills get orchestration`，读到版本匹配的完整 guide | 只读 |
| `orchestration task-list` | 返回 `run_required`（我是 worker，非 Run 绑定）——**非阻塞**，按 guide 走 `orchestration send`/`check` | 只读 |
| node | `v22.22.1` → 满足 `engines.node>=22.15.0` | `node --version` |
| pnpm | **`10.31.0`** → `package.json` 声明 `packageManager: pnpm@10.33.0`，**实测不满足** | `pnpm --version` / `package.json` |
| pnpm 自升级行为 | `pnpm config get manage-package-manager-versions` = `false` → 不会联网自装 10.33.0；ACCEPTANCE 命令将在 10.31.0 下运行 | 只读配置查询 |
| git | `2.43.0` | `git --version` |
| 现有依赖可见性 | main-integration `node_modules/` 存在（pnpm 布局，`.pnpm/` 264 项）；`.bin/` 含 `tsc`、`tsserver`、`tsx`、`vite`、`vitest`；`@modelcontextprotocol/sdk` 存在 | `ls`（只读） |
| 安装动作 | **未执行**（本轮禁止 install） | — |

### 路径映射（真实可达，未新建替代项目）

- canonical Windows `C:\workSpace\videoWorkLine\Narralens` ≡ 本机 `/mnt/c/workspace/videoworkline/Narralens` —— 同一 inode 实证：`stat -c '%d:%i'` 两路径 `package.json` 均为 `73:4503599627872230`。
- `/mnt/c/workspace` 与 `/mnt/c/workSpace` 在本机 drvfs 挂载下等价，故下文统一写 `/mnt/c/workspace/videoworkline/...`。
- MAIN 源码事实目录：`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`（绝对路径读取，未复制、未新建项目）。

### 模型自报与 MiniMax 匹配

| 项 | 值 |
|---|---|
| 会话自报模型 | **`MiniMax-M3.1-Flash-Preview[1m]`** |
| 来源 | ①会话系统身份块 "You are powered by the model MiniMax-M3.1-Flash-Preview[1m]"；②环境变量 `CLAUDE_CODE_SUBAGENT_MODEL` / `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` 同值；③`AI_AGENT=claude-code_2-1-300_agent` |
| 是否从 Claude CLI 品牌推定 | **否**。未从品牌名推断 Anthropic 或 MiniMax，未执行任何会启动另一模型会话的 CLI 探测（不跑 `claude -p` 之类） |
| 是否读取凭据 | **否**。未打开任何密钥/认证文件，未输出任何 key |
| 与用户 MiniMax 一致 | **TRUE** |
| 证据强度 | 会话自身已公开的模型标识（非推测、非外部查询） |

---

## 2. MAIN 基线、dirty 与关键输入 hash 核对

### 2.1 HEAD 与工作树

| 项 | 实测 | 与文档比对 |
|---|---|---|
| main-integration HEAD | `838ba5f2c8500f0103f56dbe51264ea9f70086fc` | ✅ 与 TASK/DESIGN/CLAUDE_PROMPT 要求完全一致（实核，非引用） |
| 分支 | `agent-driven/main-a-integration` | — |
| HEAD 提交 | `A03(worker): renew task leases and settle cancellation before shutdown`（2026-11-10T09:48:58+08:00） | — |
| dirty 条目数 | **18**（6 个 ` M` 源文件 + 3 个 ` M` 测试文件 + 9 个 `??`） | ✅ 与 TASK.md 逐行清单**完全一致**（含顺序与内容） |
| canonical HEAD | `ca5b67a8285b130c79055317c6202f73cfbb99c8` | ✅ 与 11_AGENT_DELIVERY_PROCESS / baseline-observed 一致 |
| 其他 worktree HEAD | `bridge-observability 50f4e193`、`product-workbench 07399c23`、`media-delivery 480561a9` | ✅ 与 relaunch baseline-observed 记录一致，无漂移 |
| 合同来源 commit | `f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450`，cp-a0-r4 | ✅ 见 contract-freeze.json |
| candidateLock SHA256 | `9d1b12f302bb15922e0586c19e39bcddb1b52eab96c80e25b53ad1c0297e0029` | ✅ contract-freeze.json 与 TASK 一致 |

### 2.2 DESIGN.md「现场输入 SHA256」表 —— **22/22 全部逐字节相符，0 漂移**

实算 `sha256sum` 与 DESIGN 表逐行比对，含：`creation-application.ts`、`application-dispatcher.ts`、`fixed-workflow-service.ts`、`created-task-store.ts`、`created-task-gate.ts`、`created-task-worker.ts`、`created-draft-processor.ts`、`prepared-draft-verifier.ts`、`local-asset-registry.ts`、`server.ts`、`product-facts.ts`、`product-repository.ts`、`capability-fingerprint.ts`、`observation-cursor-ports.ts`、`project-context-service.ts`、`source-digest-v1.ts`、`native-draft-assembler.ts`、`package.json`、`contracts/agent-driven-a.schema.json`、`contracts/agent-driven-a.registry.json`、`src/contracts/agent-driven-types.ts`、`src/contracts/agent-driven-validator.ts` —— 全部 MATCH。

- canonical `relaunch-20261111/baseline-observed.json` SHA256 = `f31f82d57a3eb2df6608b6fc47ffab68124ca8bb1e0d038c0c231838bd19e38a` ✅ 与 DESIGN 记录一致
- canonical `docs/execution/A/contract-freeze.json` SHA256 = `532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170` ✅ 与 TASK 记录一致（亦等于 freeze 内 manifest 自身）

### 2.3 MAIN dirty overlay 逐文件 hash —— **25/25 相符，0 漂移**

对 relaunch `baseline-observed.json` 中 `main-integration.dirty_files` 的 25 条 `sha256` 逐个实算比对：**全部 MATCH，无 DRIFT，无 MISSING_ON_DISK**。当前 dirty overlay 与 MAIN 归档字节同源，可安全作为接手输入。

### 2.4 冻结合同计数复核（不扩大协议）

| 项 | 实测 | 结论 |
|---|---|---|
| schema `$defs` 数量 | **80** | ✅ 与 MC-01 / DESIGN 一致 |
| registry `routes` 数组长度 | **31** | ✅ |
| `src/mcp/registry-view.ts` `AGENT_ROUTE_COUNT` | `31`，且 `assertRegistryShape()` 在**模块加载时**断言 route 数量、id 集合、tool 唯一性、路径占位符绑定、owner 归属 | ✅ 漂移会响亮失败，不会静默漏路由 |
| DESIGN 表 17 行 | 逐行与 registry 比对：id/HTTP 路径/MCP 工具/渠道 **全部 MATCH**；`change.approve`、`workflow.run.authorize`、`review.decide`、`events.snapshot` 的 MCP 工具确为 `none`（trusted_ui 通道） | ✅ |
| registry 内嵌 `state` | `"REVIEW_CANDIDATE_NOT_FROZEN_NOT_RELEASED"`，而 contract-freeze 为 `FROZEN_FOR_A_IMPLEMENTATION` + `registration: NOT_YET_REGISTERED_IN_HOST` | ⚠️ 见 F-05（两文件均被 freeze 字节锁定，**不得改 contracts**，需 MAIN 在审查记录中一句话裁定以哪一读法为准） |

---

## 3. 四份文档逐份可接手判断

### 3.1 DESIGN.md —— **可接手，但需 5 处修订**

**已实读复现、未找到矛盾的断言（13 组）：**

1. `CreationApplication` 构造 `ProductSqliteRepository` ✅（`creation-application.ts:66`）、`FixedWorkflowService({repository})` 仅带 repository ✅（:67）、`ProjectContextService(..., undefined, ...)` native 端口未注入 ✅（:68）。
2. dispatcher 只注册 `workflow.read` / `workflow.run.read` 等，**未 spread `workflowHandlers`** ✅（:74-95，仅 `...creative`）；`task.prepare` 未注册 ✅；`job.cancel` 未注册 ✅；`job.read` 仅允许 creation Job，否则 `CAPABILITY_UNAVAILABLE` ✅（:90）。
3. `ApplicationDispatcher.invoke` 缺 handler → `CAPABILITY_UNAVAILABLE` ✅（`application-dispatcher.ts:17`）。
4. `CreatedTaskGate`：真实 owner 校验 ✅、activeCommit 的 `base_revision`/`source_digest` 比对 ✅、creative closure digest ✅、固定计划 `canonicalDigest(FIXED_PLAN)` ✅、immutable `workflow.run.prepared` 事件**恰 1 条** ✅、`input_refs` 必须落在已批准输入集合内且 namespace 为 `artifact` ✅、assemble 必须恰 2 个（script+storyboard）✅、`new_reserve` 在当前 attempt ∈ {pending,running,waiting_user,unknown} 时拒 ✅、attempt 连续性 ✅。
5. `CreatedTaskWorker`：容量上限 2 ✅、复用 `PersistentJobStore` lease ✅、**`processor.recover()` 先于 claim** ✅（:37 先于 :43 排队查询）、heartbeat 按 leaseMs/3 ✅、取消/失租约 abort ✅、`close()` 等待全部在途（代码注释显式 "No five-second detach"）✅、关服仅释放自有 lease ✅。
6. `CreatedTaskStore`：`reserve`/`receipt`/`readPrepared`/`recordPrepared`/`finishPrepared`/`finishFailed`/`reapExpired`/`leaseReaperExclusions` 全部存在 ✅；`receipt()` 对 succeeded job 的 `next_actions` = `['review_prepared_source']` ✅（:287）；不可变触发器 ✅；`#hook` 为同连接受限同步 SQL 能力（`liveTaskConnections` WeakMap + `isCurrentTaskTransaction` 溯源、禁异步 hook、禁嵌套事务）✅。
7. `CreatedDraftTaskProcessor`：仅支持 `assemble_draft` ✅（:114）、`PinnedNativeDraftAssembler` ✅、`PreparedDraftProofPort` ✅、`finishPrepared` 把 attempt 置 `waiting_user` ✅（:145）、`recover()` → `reapExpired` ✅、`close()` 先 `verifier.close()` 再关 root FD ✅、author/rights/bytes 全量重核 ✅、stage 根与 protectedRoots 重叠即拒绝 ✅。
8. `PreparedDraftVerifier`：导出 `prove`/`proveExisting`/`assertCurrent`/`release`/`close` ✅，API 与候选 HANDOFF 描述逐项一致 ✅（`assertCurrent` 拒绝 thenable 回调、WeakMap 身份绑定 proof）。
9. `ProductFactPort`：`requireFactPort` 未注册即 fail closed ✅、fingerprint 必须 64 位小写 hex ✅、许可失败 `IMPACT_STALE` ✅、能力不可用 `CAPABILITY_UNAVAILABLE` ✅、跨 project `RUN_SCOPE_REQUIRED` ✅。
10. `ProjectContextService`：`capabilities:[]` 为空 ✅、native 端口未注入 ✅、active job 非 creation job → `CAPABILITY_UNAVAILABLE` ✅（:54）、有持久 native ack 但无 trusted bridge 生产者 → `CAPABILITY_UNAVAILABLE` ✅（:59）。
11. `server.ts` 生命周期：`listen()` 顺序 = `recoverBeforeGeneric`(:718) → history.recoverOnStart → adoption.recoverOnStart → history 二次 sweep → coordinator.recoverOnStart → migrations.recover → materialize.recover → materialize drain timer → outbox.start → leaseReaper interval(:761) → **HTTP listen**(:767) → **application.start()**(:775)；`#close()` 顺序 = `application.close()` → abort controllers → stopOutbox → materialize.shutdown → m5Supervisor.close → closeAfterNative → clear leaseReaper → server.close → **revisions.close()（DB 最后）** ✅。DESIGN 的第 5、6 条提案描述与实际**完全吻合**（含"HTTP 在 application.close 等待期间仍存在"）。
12. leaseReaper **每次 tick 实时读取** `this.#agentApplication?.leaseReaperExclusions?.()` ✅（闭包内求值，非启动缓存）——DESIGN 提案 4 的"实时读取"要求**现状已满足**，缺的只是合并 tasks 排除集。
13. 四能力 = `clip.prepare` / `snapshot.render` / `qc.inspect` / `delivery.package` ✅（registry `fixedWorkflow.capability_ids` 与 `fixed-workflow-service.ts:92` 一致）；阶段 `definition/sample/first_chapter/chapters/cover/delivery` 与 `CAPABILITY_SLUG` 映射 ✅。

**R5 相关实读（与 DESIGN 一致）：**

- `A_DISPATCHABLE_RUN_STATES = ["ready","running"]`、`A_DISPATCHABLE_ATTEMPT_STATES = ["pending","running"]` ✅（`execution-guard.ts:116-122`）。
- `assertRunDispatchable` / `assertAttemptDispatchable` 分别抛 `RUN_PLAN_STALE` ✅。
- `decideReview`（`fixed-workflow-service.ts:1074+`）在同一事务内写 `content_decision`、`review_request.state`、`run.checkpoint_json`（含 gate）、`run` 行并 emit 事件；**全程不写 `step_attempt`**（`tx.put("step_attempt", …)` 只出现在 :739 / :804 两处，均在 attempt 记录路径）。→ 接受采用后原 prepared attempt **仍为 `waiting_user`** ✅，DESIGN 的判断成立。

**需修订（详见第 5 节）：** F-01、F-02（应更强表述）、F-03、F-04、F-06、F-07。

**16:22:14 追加的「MAIN拟定接缝安全复核」与「BR-A-R6」两节（msg_3ce30c95b625 / msg_9d4d963b56ab，仍待最终裁决）：事实基础已逐条实读复现，全部成立 ✅** ——

- `publishReviewPackage` **确实存在**（`fixed-workflow-service.ts:872`），并确实把 Run 置 `waiting_user`（:1015 `this.#withCheckpoint(run, checkpoint, "waiting_user", createdAt)`）✅ → 新提案的现状描述正确。
- `decideReview` 的 `#assertAdoptionImpact`（:1630）**不构造 impact**，而是读取 `packageDocument.impact` 并校验 `impact_id` 归属、`state==='active'`、`expires_at` 未过期、`plan_sha256` 一致 ✅ → 新提案"prepare_review_impact 只登记影响"确属**新增能力**，非既有能力改名。
- 冻结 DTO `Change`（`src/contracts/agent-driven-types.ts:31`）字段完整：`impact_id`/`project_id`/`materialization_id`/`base_revision`/`control_revision`/`source_digest`/`selection_version`/`plan_sha256`/`target_snapshot_id`/`expires_at`/`state`/`summary`；`materialization_id` 模式为 `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` → **`ps_` 命名空间可原样承载而不必扩 80defs** ✅，与"保持 80defs/31routes 字节"一致。
- 冻结 `PrepareChange`/`ApplyChange` **均要求 `execution: ExecutionBinding`**（绑定 `attempt`/`plan_version`/`step_id`/`input_digest`/`run_scope_digest`/`authorization_id`）→ 采用路径上的 attempt 状态约束是真实存在的，F-13 由此而来。
- R6 的 Rights Ref 规格 `{id: asset.rights_ref, version: 1, sha256: asset.registration_digest}` **与现有数据模型完全吻合** ✅：`LocalAsset.registration_digest` 存在（`local-asset-registry.ts:40`，DDL 为 `length=64` CHECK，:62），且 `asset_id='asset_'+registration_digest.slice(0,56)`、`rights_ref='rights_'+registration_digest.slice(0,56)`（:428）；`LocalAssetRegistry.list`（:312）/ `import`（:325）存在 ✅。ACCEPTANCE 新增命令基座 `tests/agent-driven/integration/local-assets-host.test.ts` **真实存在**（25,612 bytes）✅。

→ 该追加内容**方向正确、有真实代码依据、且不要求扩大冻结面**；但仍留 F-13/F-14/F-15/F-16 四处未闭合。

### 3.2 ACCEPTANCE.md —— **可接手，本轮未发现事实错误**

- 命令入口与 `package.json` scripts **逐字相符**：`test` = `vitest run --config vitest.config.ts` ✅、`test:contracts` ✅、`build` = `tsx tools/build-native-workbench-validators.ts --check && vite build && vite build --config vite.m5.config.ts` ✅、`start` = `tsx src/host/start.ts` ✅、`check` = tsc + 全量 vitest + python golden + 双 build ✅。**无 `test:a` 脚本，ACCEPTANCE 未编造** ✅。
- 引用的 17 个路径**全部存在**：`tests/agent-driven/bridge/`、4 个 integration 测试、`tests/agent-driven/product/fixed-workflow-service.test.ts`、`capability-fingerprint.test.ts`、`scoped-auth.test.ts`、`created-draft-processor.test.ts`、`source-digest-resource-boundary.test.ts`、`creative-context-host.test.ts`、`host-application.test.ts`、`host-close-lifecycle.test.ts`、`durable-cursor.test.ts`、`observation-cursor-ports.test.ts`、`contract-freeze.test.ts`、`agent-http-router.test.ts`、`tools/agent-driven/bridge/probe-mcp.mjs` —— 全部 OK，无 MISSING。
- `maxWorkers=1 --minWorkers=1` 显式串行 ✅，符合"不得提高 vitest 默认并发掩盖问题"。
- BR-A-01..BR-A-10 的前置/步骤/不得变化/变异反例/证据列齐全；prepared≠commit、纯 accept 无 Approval、Job 完成≠commit≠NativeAck 三条边界在 BR-A-04/05/09 中均有对应否定断言 ✅。
- C7 明示"只作真实 stdio 发现探针，不能证明业务执行" ✅；C4/C9/C10 明示须 MAIN 资源预约 ✅。
- 全部 case 状态 NOT_RUN ✅，本轮未执行任何一条。
- 唯一缺项：**变异反例未绑定到具体测试文件与单条红断言**（F-10），导致票据无法客观关闭。

### 3.3 TASK.md —— **可接手，基线部分完全可信；票据依赖列需补 2 条**

- 基线/dirty/合同/白名单/禁止路径/回退/停止条件齐备 ✅，dirty 清单与 MAIN 逐行一致 ✅（第 2.1 节）。
- 文件所有权提案精确到文件，并显式"未列文件一律不可写" ✅；`contracts/**`、`src/contracts/**`、`package.json`、`AGENTS.md`、`src/app/**`、`src/host/render/**`、`src/host/engine/**`、`src/host/projects/**` 禁止 ✅。
- **R5 / BR-A-REVIEW 标为 BLOCKED_FOR_CONTRACT ✅ 正确**，且明确"若批准涉及 `execution-guard.ts` / `fixed-workflow-service.ts` / `product-repository.ts`，MAIN 须新增精确独占文件释放，当前名单不授权它们" ✅ —— 这是本轮最关键的护栏，写得对。
- 需修订：F-08（**已由 16:22 追加的「Claude实际启动记录」段基本解决** —— 该段已正确记录 Task `task_e8bb4549c314`、Dispatch `ctx_55ed85325974`、handle `term_f361b74a-b799-4f1a-8172-f3e44bd052e9`、父 task_a915784941ed，并明确"模型由子会话自报待核，不能由 agent=claude 推断"；但第 3 行旧句"本窗口 term_6b4f4382…"仍与新段冲突，建议一并修正）、F-11（ENTRY 实为"已在 MAIN 落地"，需改表述）、F-01/F-02（须反映到"立即可释放票 vs 依赖后票"的依赖列）。
- **16:22 追加的两段复核**：①「R6 素材发现纳入 BR-A-ENTRY/FACTS」—— 分工（PRODUCT 可信 UI 声明 / MEDIA 既有 registry import+probe / BRIDGE 只读 inventory 接线+Ref 映射 / MAIN 独占 sourceRoot 配置与 transport 批准）与"现有 80defs/31routes 不改""新增 inventory 文件/资源名未冻结故不列即时实现白名单""新增合同不得隐含授 Agent 写许可权限"三条处理**均正确且可接受** ✅；②「Claude实际启动记录」—— 见上，且与我本文件的模型自报口径一致（本会话自报 `MiniMax-M3.1-Flash-Preview[1m]`，与用户 MiniMax 一致，见第 1 节）。
- **仍需补入 TASK 的依赖列**：BR-A-10 / delivery 的"原Job持久端口冻结"前置（ACCEPTANCE 已自承"当前NOT_RUN且不可用桩通过替代"，但 TASK 的票据表未体现），以及 R6 附属 transport 的规范落点（F-16）。

### 3.4 CLAUDE_PROMPT.md —— **PASS**

与本次 Orca 派发 preamble 逐项对齐：父任务/父终端、唯一可写文件、禁止清单、阅读顺序、路径映射、结论词表、交付模板、"不自行实现或放宽状态"、R5 未获裁决时 REVIEW 不可释放 ✅。无冲突、无遗漏、无扩大授权。

---

## 4. 已确认的代码符号与调用点（可直接引用）

| 事实 | 符号 / 位置 | 分类 |
|---|---|---|
| Host 装配当前只含创建链 | `CreationApplication` ctor `creation-application.ts:41-96` | **现有实现（存在但仅覆盖创建链）** |
| dispatcher 缺 handler 即不可用 | `ApplicationDispatcher.invoke` `application-dispatcher.ts:15-19` | **现有实现** |
| `workflowHandlers` 工厂存在但未被装配 | `application-dispatcher.ts:39-52`（只含 run.* ×7 + `workflow.read` + `review.read` + `review.decide`） | **现有实现（未接通）** |
| 预留门（owner/事实/计划/输入/事件） | `CreatedTaskGate.assertAllowed` `created-task-gate.ts:18-40`；`assertCurrent` :51-79 | **现有实现** |
| 任务持久层 | `CreatedTaskStore` `created-task-store.ts:103-295`（`reserve` :164、`recordPrepared` :202、`finishPrepared` :228、`finishFailed` :238、`retryRecoverable` :251、`reapExpired` :263、`receipt` :285、`readPrepared` :289） | **现有实现（未接入生产）** |
| 调度器 | `CreatedTaskWorker` `created-task-worker.ts:19-100` | **现有实现（未接入生产）** |
| 准备处理器 | `CreatedDraftTaskProcessor` `created-draft-processor.ts:47-156` | **现有实现（未接入生产、未提交）** |
| 证明器 | `PreparedDraftVerifier` `prepared-draft-verifier.ts:66`（`prove` :241 / `proveExisting` :248 / `assertCurrent` :255 / `release` :141 / `close` :142） | **现有实现（未接入生产、未提交、候选记录已过期，见 F-04）** |
| 事实端口契约 | `ProductFactPort` / `requireFactPort` / `assertProjectFacts` `product-facts.ts:49/60/76` | **现有契约（无生产实现，见 F-02）** |
| 可信采用授权契约 | `TrustedAdoptionAuthority` `product-repository.ts:1059-1079`（`registerConfirmation` / `registerApproval`） | **现有契约（无生产实现，见 F-02）** |
| 运行权威的 attempt 推进缝 | `FixedWorkflowService.recordStepAttemptInTransaction` `fixed-workflow-service.ts:713-…`（**可在保持 binding 列冻结的前提下推进已有 attempt 的 state**） | **现有实现（MAIN 独占；R5 的天然落点，但当前白名单禁写该文件）** |
| guard 白名单 | `A_DISPATCHABLE_RUN_STATES` / `A_DISPATCHABLE_ATTEMPT_STATES` `execution-guard.ts:116-122` | **现有实现（不得放宽）** |
| 阶段→能力映射 | `CAPABILITY_SLUG` `fixed-workflow-service.ts:168-175` | **现有实现** |
| 生命周期顺序 | `NarralensHost.listen` :687-776；`#close` :780-816 | **现有实现** |
| 上下文投影 | `ProjectContextService.read` `project-context-service.ts:24-64` | **现有实现（capabilities 为空、native 未接、仅认 creation job）** |
| MCP 协议外观 | `src/mcp/{mcp-server,host-application-ports,host-error-mapping,registry-view,stdio-main,tool-schemas}.ts` | **现有实现，已在 MAIN 落地**（见 F-11） |
| 启动器 | `src/launcher/{launcher-plan,health-registry,service-supervisor,workbench-entry,…}.ts` | **现有实现，已在 MAIN 落地** |
| 入口测试 | `tests/agent-driven/bridge/{cursor-events,launcher-cold,mcp-host-client,mcp-registry,mcp-stdio-client,mcp-wrapper-cleanup,skill-library}.test.ts` | **现有实现，已在 MAIN 落地** |

---

## 5. 确定的发现：设计错误、缺失输入、阻塞与最小修订建议

### F-01（高）`change.prepare` / `change.approve` / `change.apply` 在 MAIN **没有任何实现**

- 实读：`grep -rn "prepareChange|applyChange|approveChange|'change\." src/ --include=*.ts` → **零命中**。三条路由虽在 Frozen31 内（`POST /api/agent/v1/projects/:id/changes`、`…/changes/:impact/approval`、`POST /api/agent/v1/projects/:id/apply`），但 `ApplicationDispatcher` 的 handler 映射里**没有任何 change.* 条目**，`workflowHandlers` 也只覆盖 run.* / workflow.read / review.*。
- 所有请求经 `agent-http-router.ts:110` 的 `this.dispatcher.invoke(id,input,current)` → 一律 `CAPABILITY_UNAVAILABLE`。
- **后果**：DESIGN 的 R5 提案把"change.prepare 生成无 source 写的 impact"当作既有能力来描述，但该 producer **不存在**。R5 因此**不是单纯的 guard 状态放宽问题**，还缺整条 producer→consumer 链（impact 构造、approval 绑定、apply 消费、revision+1、锁）。
- **最小修订**：DESIGN 的 R5 段必须显式写明"change.* 三路由当前无任何实现"，并把 R5 的裁决项扩展为 **(a) 专用采用门** + **(b) change.* 的 producer/consumer 归属与文件释放**；否则 MAIN 即使批准了"专用分支"，接手的 Claude 依然无处落地。
- **对票据的影响**：`BR-A-REVIEW`、ACCEPTANCE `BR-A-05`/`BR-A-10` 在 F-01 未被 MAIN 裁决前**不可释放**（TASK 现有 BLOCKED_FOR_CONTRACT 判定正确，但理由需补全）。

### F-02（高）生产环境不存在 `ProductFactPort` / `TrustedAdoptionAuthority` 的任何实现

- 全仓检索 `registerApproval|registerConfirmation|TrustedAdoptionAuthority` 的命中仅 4 处：接口定义（`product-repository.ts`）、`fixed-workflow-service.ts`（消费方）、`src/host/creative/index.ts`（re-export）、以及 **`tests/agent-driven/product/support/fixtures.ts` 中的 `TestFactPort` / `TestAdoptionAuthority`**。**无生产实现。**
- 直接后果（当前装配下必然发生，非"可能"）：
  - `CreationApplication` 用 `new FixedWorkflowService({repository})` 构造 → `#facts === undefined` → `prepareRun` 的 `requireFactPort` 抛 `CAPABILITY_UNAVAILABLE("No project fact port is registered")`。
  - `#adoption === undefined` → `authorizeRun` 抛 `APPROVAL_REQUIRED("No trusted adoption authority is registered")`；`decideReview` 抛同一错误。
  - **即：今天无法 prepare 任何 Run、无法 authorize、无法 review。**
- **对"生产 trusted confirmation ≠ 测试 Grant"的强化**：`TestAdoptionAuthority` / `TestFactPort`（后者默认 `capability_available:true`、`rights_authorized:true`、`capability_fingerprint:"6"*64`）是**唯一**的具体实现。若有人为"让测试过"把测试替身注入生产，即构成 CLAUDE_PROMPT 明令禁止的"把测试 port 置入生产"，并会同时违反 MC-03（真实能力 manifest）与 MC-05（trusted_ui 同事务授权）。
- **最小修订**：DESIGN 的「未接通」段改为显式表述"**当前 0 个生产实现**，唯一实现是 `tests/agent-driven/product/support/fixtures.ts` 的测试替身；`prepareRun`/`authorizeRun`/`decideReview` 在当前装配下 100% 硬失败"。FACTS 票应据此新增验收项"生产装配下 `requireFactPort` 不再抛错"，且必须断言注入对象**不是**测试替身类型。

### F-03（高）draft-processor 的 closure 记录绑定旧字节，未覆盖当前 overlay

对 `docs/execution/A/reviews/draft-processor-pre-review/` 实算比对：

| 文件 | closure 记录 | 当前磁盘 | 结论 |
|---|---|---|---|
| `created-draft-processor.ts` | `3b702b93…` | `6727b0b6…` | **DRIFT** |
| `created-task-store.ts` | `8d3d98a2…` | `d7a4734c…` | **DRIFT** |
| `created-task-worker.ts` | `38f5fe5b…` | `41a76585…` | **DRIFT** |
| `created-task-gate.ts` | `1a65d8f3…` | `1a65d8f3…` | MATCH |
| `local-asset-registry.ts` | `84ce6395…` | `84ce6395…` | MATCH |
| 4 个 integration 测试 | 均记录在案 | 全部 | **4/4 DRIFT** |

- 且原始 NOT PASS 评审 `input-hashes.json` 绑定的是**更早一代**字节（processor `4b86283e…`、store `d30c5b83…`）。即存在 **3 代字节 / 2 份评审记录**，没有任何一份覆盖当前字节。
- `closure-input-hashes.json` 本身**没有 verdict 字段**（只有 "MAJOR closure static review" 与 method）；`REVIEW.md` 的结论是 **NOT PASS（MAJOR 2）**。所谓"局部静态 PASS"实为**推断**，非记录中的显式结论。
- **最小修订**：DESIGN 中"closure 记录局部静态 PASS"改为"closure 记录绑定 `3b702b93/8d3d98a2/38f5fe5b` 一代字节，当前 overlay 未被任何评审覆盖；当前字节视为未评审"。这是对"局部历史通过"分类的**强制修正**。

### F-04（中）`prepared-draft-verifier` 候选清单与 MAIN 实体文件已不同步

- `candidates/prepared-draft-verifier/candidate-manifest.json`：`source_sha256 = 380b235f…`，而 MAIN 实际文件 = `ffefbd41…` → **DRIFT**。
- `candidate.patch` 自身 hash `8e700a88…` 仍 MATCH（补丁文件未被改动）。
- manifest 的 `dependencies_at_base` 中 3 条已漂移：`source-digest-v1.ts`、`local-asset-registry.ts`、`created-task-store.ts`（其余 8 条 MATCH）。
- manifest 自述 `status: SOURCE_CANDIDATE_NO_CHECKS`、`typecheck: NOT_RUN`、`tests: NOT_RUN`。
- **最小修订**：DESIGN"PreparedDraftVerifier 文件存在…"一句应补"候选清单已过期（380b235f→ffefbd41），需重出 manifest 或标注 superseded"。**不得**把该 manifest 当作当前 verifier 的来源证据。

### F-05（中）registry 内嵌 state 与 freeze 状态字面冲突

`contracts/agent-driven-a.registry.json.state = "REVIEW_CANDIDATE_NOT_FROZEN_NOT_RELEASED"`，而 `contract-freeze.json.status = "FROZEN_FOR_A_IMPLEMENTATION"`、`registration = "NOT_YET_REGISTERED_IN_HOST"`。两文件**都被 freeze 字节锁定**，本轮**不得修改 contracts**（MC-01）。建议 MAIN 在 `06_MAIN_REVIEW_AND_START_GATE.md` 写一句裁定：A 轮以哪一读法为准（建议：freeze 为准，registry 内嵌 state 视为撰写时的历史注记），避免接手者误判"合同未冻结"而自行扩协议。

### F-06（中）R5 提案：**16:22 追加后门已收窄，但仍未闭合**

**16:22 追加的「MAIN拟定接缝安全复核」已把 R5 从"无轮廓"推进到"有轮廓"**，新增了具体形状：`prepare_review_impact`（只登记影响，不改 author、不开媒体 job、不消费 Approval）与 `apply_review_adoption`（必须真实 UI 同包 accepted 且有限 Approval 当前有效），两者都重核 owner/project/run/plan/step/execution attempt、Job succeeded、prepared fact/source 映射 hash、current grant/rights/live bytes、base/control/selection 及前序 stage gates；显式拒绝 Run paused/cancelled/reconciling；允许 waiting_user **仅针对此包**；**普通 action 的 dispatchable 集合不变** ✅（这条红线守住了，本轮复核确认写法正确）。

已确认 DESIGN 对现状的描述准确（guard 白名单 + `decideReview` 不重置 attempt + `publishReviewPackage` 置 Run waiting_user）。**仍缺的可实施规格**：

| 缺失项 | 状态 |
|---|---|
| 归属与文件 | 仍缺。"同一execution-guard 模块内增窄 internal effect" → 落在 `src/host/creative/execution-guard.ts`，而 TASK **明确不授权**该文件（"若批准涉及 `execution-guard.ts`…MAIN 须新增精确独占文件释放，当前名单不授权它们"）→ 需 MAIN 出具该文件的**精确独占释放** |
| 事务边界 | 仍缺。impact 生成、Decision、limited Approval 的同事务顺序与"恰一次消费"落点未定义（`decideReview` 已有 `registerConfirmation`+`registerApproval` 同事务骨架可参照，但那是**既有 review 路径**，不是 prepared 路径） |
| attempt 表示 | 仍缺。采用后原 `waiting_user` attempt 如何在不触碰 `A_DISPATCHABLE_*` 的前提下被"采用"未定义。**已存在的 MAIN 独占缝**：`FixedWorkflowService.recordStepAttemptInTransaction`（`fixed-workflow-service.ts:713+`）可在**保持 binding 列冻结**的前提下推进已有 attempt 的 state —— 这是最自然的落点，但同样需 MAIN 释放该文件 |
| wire 入口 | **仍缺，且是新问题 → 见 F-13** |
| impact 构造点 | **仍缺，且是新问题 → 见 F-14** |
| 负例清单 | 已由追加段落给出 13 条方向正确的反例（ps_ 跨项目/映射篡改/同包换 version/悬空 result_ref/旧 lease 晚发布/internal effect 混入 HTTP/pure accept 误授 Approval/审批后改 rights 或 bytes/pause-cancel 后采用/sample impact 用于 chapters/其他 risk 门旁路/QC 失败仍 package/重复恢复生成第二 job），但**未逐条绑定到具体测试文件与单条红断言**（F-10 同款问题） |

**判定**：R5 **仍不可按现文实施**。MAIN 需先裁决 6 项：owner/文件释放（execution-guard.ts、fixed-workflow-service.ts、product-repository.ts）、事务边界、attempt 表示、wire 入口（F-13）、impact 构造点（F-14）、负例到测试的绑定。**本轮不得实现、不得放宽 `A_DISPATCHABLE_*`、不得把 `waiting_user` 加入通用 dispatch 状态。**

### F-07（中）"registry 实际路由"表只列了 17/31，且未给出"已注册 producer"的全景

- DESIGN 标题为「冻结合同与实际注册」，正文写"下面记录registry实际路由"，但表内 **17 行 = BRIDGE 相关子集**，非 31 全量。读者可能误以为这就是全部路由。
- 实测当前装配的 producer 覆盖：**31 条中仅 15 条有已注册 producer**（`intake.put/read/confirm`、`question.put/answer/answer.ui`、`content.relay`、`artifact.put`、`instance`、`health.read`、`context.read`、`workflow.read`、`workflow.run.read`、`project.create`、`job.read`(仅 creation)）。**其余 16 条无 producer**：`task.prepare`、`job.cancel`、`change.prepare`、`change.approve`、`change.apply`、`events.snapshot`、`editor.native.ack`、`delivery.read`、`workflow.run.prepare/authorize/start/pause/resume/cancel`、`review.read`、`review.decide`。
- 注意：`events.snapshot` 与 `editor.native.ack` 虽在 HTTP router 里有专门的 body 预处理，**仍经 dispatcher.invoke**，故同样落到 `CAPABILITY_UNAVAILABLE`。
- **最小修订**：DESIGN 增加一行统计（"31 条中 15 条已注册 producer，16 条未接通"），并把表标题改为"BRIDGE 相关 17 条（另 14 条不在本表）"或补全 31 行；同时明确"**不得**通过新增路由或新增 `$def` 来让接线看起来成立"——这正是 MC-01 与本轮"不扩大协议"的要求。

### F-08（低，**已部分解决**）TASK.md 第 3 行的 Claude 窗口 handle 陈旧

TASK.md 第 3 行写"本窗口 `term_6b4f4382-d829-4065-b446-97808e041937`"。但按本次派发 preamble，`term_6b4f4382…` 是**BRIDGE Codex 协调终端**，本 Claude 窗口实际 handle 为 `term_f361b74a-b799-4f1a-8172-f3e44bd052e9`。

**16:22 追加的「Claude实际启动记录」段已正确记录**：Task `task_e8bb4549c314`、Dispatch `ctx_55ed85325974`、handle `term_f361b74a-b799-4f1a-8172-f3e44bd052e9`、mode=terminal、state=ready、keepOpen=true、父 `task_a915784941ed`，并写明"模型由子会话自报待核，不能由 agent=claude 推断" ✅ —— 与本文件第 1 节的自报口径一致。**残留**：第 3 行旧句与新段并存仍构成同文档内的 handle 冲突，建议一并修正；另该段提到首个 `--spec-file` WSL 路径在 Windows CLI 读文件阶段 ENOENT，确认未重复启动 worker ✅（本轮 `worker-list`/`task-list` 亦无 BRIDGE 子 Task 重复创建）。

### F-09（低）pnpm 版本与声明不符

实测 `pnpm 10.31.0`；`package.json.packageManager = pnpm@10.33.0`；`engines.node >= 22.15.0`，实测 node `v22.22.1` ✅。因 `manage-package-manager-versions=false`，pnpm 不会联网自装 10.33.0，因此 ACCEPTANCE 命令将在 10.31.0 下执行。建议在 release 记录中写明实测版本，而不是默认可用 10.33.0。（不构成阻塞。）

### F-10（低）变异反例未绑定到具体测试与红断言

ACCEPTANCE 的 BR-A-01..10 以散文写"变异移除 final_reserve/rollback""变异用 generic reaper 代替专属 reapExpired"等，未绑定到**测试文件 + 单条红断言**。TASK 的 S1 原则"只读模块审查不能改测试输入后沿用旧绿灯"是对的，但票据形式上无法客观关闭。**最小修订**：ACCEPTANCE 增加一列 `变异 → 测试文件/case id → 期望红断言`，供 MAIN 审定时逐条勾销。

### F-11（低）ENTRY 票的表述与现实不符：入口模块**已在 MAIN 落地**

实测 `main-integration` 已包含（均已提交进 HEAD 838ba5f2）：

- `src/mcp/{mcp-server,host-application-ports,host-error-mapping,registry-view,stdio-main,tool-schemas,index}.ts`
- `src/launcher/{launcher-plan,launcher-types,health-registry,local-runtime-ports,service-supervisor,workbench-entry,index}.ts`
- `skills/narralens/`、`skills/narralens-lib/`
- `tests/agent-driven/bridge/`（7 个测试文件 + helpers）
- `tools/agent-driven/bridge/probe-mcp.mjs`

与旧 lane worktree `bridge-observability`（HEAD `50f4e193`）逐文件比对：**全部字节相同，唯一例外 `src/mcp/host-application-ports.ts`** —— MAIN 自行追加了 Origin 绑定加固（删除客户端可注入的 `origin` 头，改写为已校验 loopback origin）。

因此 ENTRY 票应表述为"**在 MAIN 已落地的入口模块上做真实接线与回归**"，而不是"从零实现入口"。否则接手者可能重复改写可用代码。旧 lane 的 `ReleaseAssignment.json`（A-BRIDGE-001，base `ca5b67a8`，directory `…/bridge-observability`，completion `MODULE_VALIDATED_PRODUCTION_ASSEMBLY_PENDING`）**不授权**在 MAIN 目录内施工。

### F-12（低/信息）旧 lane 记录的定位复核（按要求不用于断言 MAIN 缺实现）

旧 lane 的 `TASK.md`/`REVIEW-1.md`（NEEDS_WORK，10 项）/`REVIEW-2.md`（NEEDS_WORK，5 项）/`HANDOFF.md` 均基于 **旧基线** `ca5b67a8` / 测试码 `a325f948`。实测确认其成果已并入 MAIN（见 F-11）。**结论：旧 lane 的 NEEDS_WORK 条目不得被引用为"MAIN 尚未实现"的证据**；同样，MAIN 中存在 `src/mcp` 也不得被引用为"入口已验收"。本轮未重跑任何旧 lane 测试。

---

## 5.2 追加发现的细项（针对 16:22 MAIN 新拟接缝）

> 背景：MAIN 在 16:22:14 向 DESIGN.md 追加「MAIN拟定接缝安全复核（msg_3ce30c95b625）」与「BR-A-R6（msg_9d4d963b56ab）」，向 ACCEPTANCE.md 追加「MAIN拟定内部接缝追加变异矩阵」与「BR-A-01/R6 素材发现前置case」，向 TASK.md 追加「R6 素材发现纳入 BR-A-ENTRY/FACTS」与「Claude实际启动记录」。协调终端经 `orchestration check` 通知本窗口读取文档末尾并纳入 readiness。以下为对该批追加内容的独立只读复核结论。

### F-13（高）窄 internal effect 与冻结 `change.*` 路由之间的 wire 缺口

- 新提案明确 internal effect "**必须是 Host 可构造的受信事实能力，不能从 HTTP DTO 直传 effect 字符串/任意facts**"，并把"将 internal effect 混入 HTTP"列为**反例**。
- 但冻结 registry 中唯一的采用 wire 面是三条路由：`change.prepare`（`POST /api/agent/v1/projects/:id/changes`，authenticated）、`change.approve`（`…/changes/:impact/approval`，trusted_ui）、`change.apply`（`POST /api/agent/v1/projects/:id/apply`，authenticated）。**三者在本轮实读中均无任何 producer**（`grep "prepareChange|applyChange|approveChange|'change\."` 在 `src/` 零命中；`workflowHandlers` 只含 run.* ×7 + `workflow.read` + `review.read` + `review.decide`）。
- 冻结 DTO `PrepareChange` / `ApplyChange` **都强制要求 `execution: ExecutionBinding`**（绑定 `attempt`/`plan_version`/`step_id`/`input_digest`/`run_scope_digest`/`authorization_id`）。prepared 产物的 attempt 恰是 `waiting_user` —— 即：即使给 `change.prepare`/`change.apply` 补上 producer，也**必然**要经过 R5 分支才能通过 `assertAttemptDispatchable`。因此"internal effect 完全不经 HTTP"与"冻结 change.* 路由可用"**不能同时成立**。
- 另有**双批准来源**问题：`review.decide`（trusted_ui，既有 `decideReview` 已实现"一次 accept_and_adopt 同 tx 写 Decision + limited Approval"）与 `change.approve`（trusted_ui，0 producer）都能产生 Approval。08_WORKFLOW_MCP_CONTRACT §4.2 描述的是前者语义。MAIN 须明确 A 轮只用哪一个为**唯一**批准来源。
- **最小修订**：MAIN 必须在两种 wiring 中明确选一，并使 ACCEPTANCE BR-A-05 的"入口"列与之字面一致：
  - (a) 内部接线：`review.decide` 写 Decision+Approval → 由 Host 装配调用 `apply_review_adoption` 完成 revision+1。则 `change.apply` 永久无 wire 入口，**ACCEPTANCE BR-A-05 必须把入口改写为 internal effect + 其 Host 组合入口**（并明示 `change.*` 三路由在 A 轮不实现）。
  - (b) 冻结接线：`change.prepare` → `change.approve` → `change.apply` 补齐 producer，且由 R5 分支接受 `execution.attempt==='waiting_user'`。则须同时释放 `execution-guard.ts`/`fixed-workflow-service.ts`/`product-repository.ts`，并说明 `review.decide` 在该路径中的角色（避免双批准）。
- **无论选哪条，`change.*` 的 producer 在 MAIN 明确前都不得实现**（F-01 保持有效）。

### F-14（高）prepared 场景下 `ReviewPackage.impact` 的构造点与事实来源未定

- 实读：`decideReview` 的 `#assertAdoptionImpact`（`fixed-workflow-service.ts:1630-1670`）**只读取** `packageDocument.impact` 并校验 `impact_id` 归属 / `project_id` / `state==='active'` / `expires_at` 未过期 / `plan_sha256` 相等；`impact===null` → `IMPACT_REQUIRED`。
- 实读：`publishReviewPackage` 的 `PublishReviewPackageInput.impact?: Change | null`（:209）是**调用方传入的可选参数** —— 也就是说，"package 自带 impact"这件事**今天没有任何模块负责**。
- 因此新提案的 `prepare_review_impact` 确实是**新增能力**：MAIN 须指定 prepared 产物对应的 `Change` 记录由谁构造、依据什么事实。**未决的技术冲突**：冻结 `Change` 含 `target_snapshot_id`（采用前的 prepared 产物**没有** committed snapshot），`base_revision`/`control_revision`/`source_digest`/`selection_version` 在 prepared 状态下分别取什么值也未定义。
- **最小修订**：MAIN 需给出 `Change` 在 prepared 场景的字段取值规则（含 `target_snapshot_id` 的语义与 `state`/`expires_at` 的生命周期）与构造点（属 `execution-guard.ts`？`fixed-workflow-service.ts`？MEDIA 的 producer？），否则 `apply_review_adoption` 无法被实现或验证。

### F-15（中）delivery QC→package 的子阶段事实与去重键无归属、无 DDL、无命令基座

- 新提案要求："需要明确 delivery 一个 step 内 QC→package 子动作的持久去重键/子阶段事实及原Job可恢复回执，不能用同step唯一约束冲突后创建无绑定第二队列；QC 通过才可 package，未知 QC/迟到结果不得 ready。" 这是**新增持久事实**，触发 MAIN 02 文档的"新增内部事实/表也需同库DDL迁移、旧库重开、逐字段校验"要求。
- 归属空白：该子阶段事实落在哪个模块（MAIN 独占的 `product-repository.ts` DDL？MEDIA 的 delivery 执行器？），delivery 执行器按 MAIN 02 §分工属 MEDIA，而 TASK 当前把 `src/host/render/**`、`src/host/engine/**` 列为禁止路径。
- ACCEPTANCE 自己已诚实标注："delivery真实恢复依MAIN/MEDIA原Job持久端口冻结后补充实际命令，当前NOT_RUN且不可用桩通过替代" ✅ —— 但这意味着 **BR-A-10 在该端口冻结前没有可执行命令**，且 TASK 的票据依赖列未体现这一前置。
- **最小修订**：MAIN 指定 delivery 原Job持久端口的 owner 与冻结时点；在 TASK 的 BR-A-RECOVER/BR-A-10 行补该依赖。

### F-16（中）R6 "附属 transport" 的规范归属与"不扩大 Frozen31" 的判定方式空白

- 新提案同时要求"**不得偷偷加到Frozen registry**"与"附属transport需独立规范、鉴权/字段/分页/错误/**注册**与producer-consumer测试"。二者之间存在规范落点空白：**谁写这份规范、放在哪、鉴权通道是什么、它是否计入"31 routes"口径、PRODUCT/MEDIA 如何消费**。
- 需注意 registry 的 `resources` 段同样在**冻结字节**内（registry 文件整体被 candidateLock 锁定），因此"附属 MCP resource"若要出现在冻结 registry 中就会违反"80defs/31routes 不变"；若另开规范，又必须回答"它是否构成协议面扩大"。
- TASK 已正确处理一半："新增inventory文件/资源名未冻结，不列即时实现白名单，待MAIN逐文件独占释放"、"现有80defs/31routes不改"、"新增合同不得隐含授Agent写许可权限" ✅。
- **最小修订**：MAIN 指定该附属 transport 的规范文档落点与"不算入冻结协议面"的判定口径，并明确其是否对 Agent 暴露（只读清单）。

### F-17（中，**正面结论**）R6 的字段契约有真实代码依据，非凭空提案

- `LocalAsset.registration_digest` 存在（`local-asset-registry.ts:40`，DDL `length(registration_digest)=64` CHECK，:62，且 `UNIQUE(project_id,registration_digest)`）。
- `rights_ref`/`asset_id` 均由 `registration_digest` 派生（:428 `'rights_'+…slice(0,56)` / `'asset_'+…slice(0,56)`）→ R6 规定 Ref 的 `sha256` 用 `registration_digest` **与现有不变量自洽**。
- `LocalAssetRegistry.list`（:312）与 `import`（:325）真实存在；R6 所述"现有 import/list 尚无生产 UI/MCP 入口"与实读一致（`src/` 内无调用方）。
- ACCEPTANCE 新增命令基座 `tests/agent-driven/integration/local-assets-host.test.ts` **真实存在**（25,612 bytes）✅，命令 `pnpm test tests/agent-driven/integration/local-assets-host.test.ts tests/agent-driven/bridge/mcp-registry.test.ts --maxWorkers=1 --minWorkers=1` 的两个目标路径均存在 ✅。
- → **R6 是本批追加内容中最"可落地"的一条**：其字段级契约、Host 侧校验对象、现有命令基座三者齐备，唯一缺口是 F-16 的 transport 规范归属。

---

## 6. 立即可释放票 vs 依赖后票

> "立即可实施"指**设计已可独立审定、只等 MAIN 发 ReleaseAssignment 并转移唯一 writer**，**不代表本轮准许实现**。本轮不写任何代码。

### 6.1 可先实施（MAIN 释放后即可开工，单 writer，逐文件白名单）

| 票 | 范围 | 关键约束 | 前置 |
|---|---|---|---|
| **BR-A-ENTRY** | 在 MAIN 已落地的 `src/mcp/`、`src/launcher/`、`skills/narralens/`、`tests/agent-driven/bridge/` 上补**真实接线回归**与必要的最小修正；保留现有协议模块与错误映射。**R6 部分按 TASK 仅可先做"现有协议消费回归设计"，inventory 文件/资源名未冻结 → 不列即时实现白名单** | 不得改 Frozen31/80defs；不得新增协议面；`registry-view` 的 31 断言必须保持响亮失败；新增合同不得隐含授 Agent 写许可权限 | MAIN ReleaseAssignment（明确"入口模块已在 MAIN 落地，只做接线与回归"）+ writer 转移 |
| **BR-A-HOST**（核心独占票） | 在 `creation-application.ts` / `application-dispatcher.ts` / `project-context-service.ts` / `server.ts` 装配：`CreatedTaskStore`+`CreatedTaskGate`+`CreatedTaskWorker`+`CreatedDraftTaskProcessor`+`PreparedDraftVerifier`；新增 **task.prepare / job.read(任务Job) / job.cancel** handler（带 owner 校验，先核生产权限再 reserve，不以 202 占坑）；receipt resolver 同时接给 `job.read` 与 `context.read`；`leaseReaperExclusions` 合并 `creation.pending()` 与 `tasks.leaseReaperExclusions()`；`recoverBeforeGeneric` 追加 tasks 专属同步恢复；close 顺序加 closing 准入栅栏 → 停止派发 → `await worker.close()` → `processor.close()`（含 verifier/root FD）→ 既有资源 → 既有 Host close → DB 最后 | **仅 fail-closed 装配**：未注入真实 facts/adoption 时相关路由必须继续 `CAPABILITY_UNAVAILABLE`，不得以测试替身冒充；不得改 `execution-guard.ts` / `fixed-workflow-service.ts` / `product-repository.ts`（除非 MAIN 新增精确独占释放）；不得把 prepared 当 commit | MAIN ReleaseAssignment（4 个文件逐项独占释放，server.ts 不可多人接线） |
| **BR-A-RECOVER（轻量部分）** | HOST 之后的轻量故障闭环：取消/失 lease/耗尽、queued 无 lease 闭合、旧 lease 晚回调拒绝、重开复用原 job、cursor 重连 | 通用 reaper 不得抢 created-task job；不得把 lease attempt 当 execution attempt；重复恢复不增事件 | 依赖 BR-A-HOST 落地 |

### 6.2 必须等待 MAIN 合同裁决（**本轮不可释放**）

| 票 | 等待的裁决 | 阻塞证据 |
|---|---|---|
| **BR-A-FACTS** | 生产 `ProductFactPort` 的实现归属与注入点（当前 0 实现）、四能力 descriptor/fingerprint 的权威来源（MC-03 要求 MEDIA 真实 manifest）、当前资产许可事实的生产适配、生产 `TrustedAdoptionAuthority`（当前 0 实现，仓库内唯一实现是测试替身）、与 PRODUCT 审阅 / MEDIA 执行器的 producer-consumer 接口 | F-02；MAIN 02 文档待裁决接缝 #1/#4/#5 |
| **BR-A-REVIEW** | **R1**（prepared 正式读取，不扩 80defs 的版本化只读 DTO/route）、**R4**（prepared-source@1 `ps_` 命名空间 → 冻结 `materialization_id` 的不可变映射，含命名/DDL/版本/读取与授权）、**R5**（窄 internal effect `prepare_review_impact` / `apply_review_adoption`：owner + 文件释放 + 事务边界 + attempt 表示 + **wire 入口** + **impact 构造点** + 负例到测试的绑定）、**以及 F-01 的 change.* producer 归属** | F-01 / F-06 / F-13 / F-14；MAIN 02 文档待裁决接缝 #2/#3 |
| **BR-A-ENTRY/FACTS 的 R6 只读 inventory 接线** | MAIN 冻结**附属 transport 独立规范**（鉴权/字段/分页/错误/注册/归属，见 F-16）+ PRODUCT 可信 UI 输入 + MEDIA 既有 registry/import/probe | F-16；按 TASK，inventory 文件/资源名**未冻结 → 不列即时实现白名单**，仅可先做"现有协议消费回归设计" |
| **BR-A-ENTRY 真实联调** | HOST 装配 + 四能力真实就绪 + 可信确认通道 | 依赖 BR-A-HOST 与 BR-A-FACTS |
| **BR-A-10 / delivery QC→package** | MAIN/MEDIA 冻结 **delivery 原Job持久端口** + delivery 单 step 内 QC→package 的持久去重键/子阶段事实归属与 DDL | F-15；ACCEPTANCE 已自承"当前 NOT_RUN 且不可用桩通过替代" → 在此之前 BR-A-10 **无可执行命令**，不可释放 |
| **BR-A-RECOVER 真实媒体证据** | MAIN 全机单槽预约 | 05 文档 T20-A..H |

### 6.3 重型资源（仅 MAIN 预约）

C4 真实媒体、C9 `pnpm run build`、C10 `pnpm run check`、多 Host、Headless、ffmpeg/渲染、原生工作台、T20-A..H、真实双导出 —— 全部须 MAIN 全机单槽预约。本轮**未执行任何一项**。

---

## 7. 本轮命令清单（全部只读）

> 无一条命令写入产品代码、配置、Git 索引或 4 份父文档；无一条运行测试 / typecheck / build / install / render / 启动产品服务；无一条 commit / merge / push / cherry-pick / rebase / reset / stash。

| # | 命令（要点） | 读/写 |
|---|---|---|
| 1 | `pwd` | 读 |
| 2 | `which orca-ide node pnpm git`；`node --version`；`pnpm --version`；`git --version` | 读 |
| 3 | `ls -la` canonical / workspace 目录 | 读 |
| 4 | `git rev-parse HEAD`；`git status --porcelain=v1`（canonical 与 main-integration） | 读 |
| 5 | `stat -c '%d:%i'` 两路径 `package.json`（路径映射 inode 实证） | 读 |
| 6 | `git rev-parse --abbrev-ref HEAD`；`git log -1` | 读 |
| 7 | `sha256sum` ×22（DESIGN 输入表） | 读 |
| 8 | `sha256sum` baseline-observed.json / contract-freeze.json | 读 |
| 9 | `node -e` 读 schema `$defs` 计数、registry routes 枚举与 route 明细 | 读 |
| 10 | `node -e` 比对 relaunch baseline 的 25 条 dirty hash 与磁盘字节 | 读 |
| 11 | `node -e` 比对 closure-input-hashes / input-hashes / candidate-manifest 与磁盘字节 | 读 |
| 12 | `Read`：`AGENTS.md`、`11_AGENT_DELIVERY_PROCESS.md`、`01_EFFORT_AND_STAGE_PLAN.md`、`07_EXPERIENCE_SPEC.md`、`08_WORKFLOW_MCP_CONTRACT.md`、`contract-freeze.json`、relaunch `02_MAIN_CONTRACT_AND_DECISIONS.md`、`05_MAIN_ACCEPTANCE_AND_REVIEW.md`、`bridge/{DESIGN,ACCEPTANCE,TASK,CLAUDE_PROMPT}.md` | 读 |
| 13 | `Read`/grep/sed：`creation-application.ts`、`application-dispatcher.ts`、`created-task-gate.ts`、`created-task-store.ts`、`created-task-worker.ts`、`created-draft-processor.ts`、`prepared-draft-verifier.ts`、`project-context-service.ts`、`product-facts.ts`、`product-repository.ts`（接口段）、`execution-guard.ts`、`fixed-workflow-service.ts`（`decideReview`/`authorizeRun`/`recordStepAttemptInTransaction`/`CAPABILITY_SLUG`）、`server.ts`（listen/close）、`local-asset-registry.ts`（符号） | 读 |
| 14 | `Read`/cat：旧 lane `lane-bridge/{TASK.md,HANDOFF.md,REVIEW-1.md,REVIEW-2.md,ReleaseAssignment.json}`、`draft-processor-pre-review/{REVIEW.md,input-hashes.json,closure-input-hashes.json}`、`candidates/prepared-draft-verifier/{HANDOFF.md,candidate-manifest.json}` | 读 |
| 15 | `diff -rq` bridge-observability ↔ main-integration（`src/mcp`、`skills`、`tests/agent-driven/bridge`、`tools/agent-driven/bridge`）；`diff -u` 单文件 | 读 |
| 16 | `ls`/`test -e` 校验 ACCEPTANCE 引用的 17 个路径 | 读 |
| 17 | `ls node_modules` / `.bin` / `.pnpm` / `@modelcontextprotocol`；`node -e` 读 `package.json` scripts/engines/packageManager | 读 |
| 18 | `pnpm config get manage-package-manager-versions`；`cat .npmrc`（不存在）；`cat pnpm-workspace.yaml` | 读 |
| 19 | `env | grep`（模型与 Orca 变量；未读取任何凭据文件、未输出 key） | 读 |
| 20 | `orca-ide status --json`；`orca-ide orchestration task-list --json`（返回 `run_required`，非阻塞）；`orca-ide skills get orchestration` | 读 |
| 21 | `Read`：`/home/administrator/.agents/skills/orca-cli/SKILL.md`、`/home/administrator/.agents/skills/orchestration/SKILL.md` | 读 |
| 22 | `date -Iseconds` / `date -u` | 读 |
| 23 | `orca-ide orchestration check`（收到协调终端通知：MAIN 已追加接缝） | 读 |
| 24 | `ls -la --time-style=full-iso` + `wc -l` + `sha256sum`（DESIGN/ACCEPTANCE/TASK 追加后：DESIGN 140 行 / 24413 B、ACCEPTANCE 47 行 / 10597 B、TASK 81 行 / 10627 B；新增 sha 见下） | 读 |
| 25 | `sed -n` 读 DESIGN.md 追加段（:114-140）、ACCEPTANCE.md 追加段（:38-47）、TASK.md 追加段（:70-81） | 读 |
| 26 | `grep publishReviewPackage` / `grep registration_digest` / `sed` 读 `LocalAsset` 接口与 DDL、`LocalAssetRegistry.list/import`、`PublishReviewPackageInput`、`#assertAdoptionImpact`、`publishReviewPackage`、`ReviewPackage` 冻结 DTO、`PrepareChange`/`ApproveChange`/`ApplyChange`/`Change` 冻结 schema | 读 |
| 27 | `ls tests/agent-driven/integration/local-assets-host.test.ts`（R6 命令基座核验） | 读 |

**追加后 3 份父文档的字节指纹（便于 MAIN 复核本轮读到的正是最新版本）：**

| 文件 | SHA256 |
|---|---|
| `bridge/DESIGN.md` | `59addd6c6b5e7751d4f6ea4e8a73d890ad4927cf9b4c4186873966afb115fb91` |
| `bridge/ACCEPTANCE.md` | `4a487cf2841a8f003e7aac84c27a2aaf2cf5521a9cd6eb6f809f7fd15c3232b6` |
| `bridge/TASK.md` | `e8f44ceb46df5d9949225e391df1e32008cc5df8327fb2c725c8b5c4d2452f27` |
| `bridge/CLAUDE_PROMPT.md` | 本轮未改动（未取指纹；mtime 16:17:08，早于 16:22 的追加批次） |

**未执行（明确禁止）**：任何 `pnpm test` / `vitest` / `tsc` / `pnpm run build` / `pnpm run check` / `pnpm install` / `pnpm run start` / 渲染 / ffmpeg / 浏览器 / 真实媒体 / `git add|commit|merge|push|cherry-pick|rebase|reset|stash` / 凭据读取。

### 产品验证状态

| 项 | 状态 |
|---|---|
| 全部业务验收 case（BR-A-01..10） | **NOT_RUN** |
| C1..C10 | **NOT_RUN** |
| T20-A..H | **NOT_RUN** |
| A 阶段 / V1 / 人工验收 | **NOT_RUN** |
| 历史 Gate 状态 | 未改动、未调绿 |
| 本轮唯一写入 | 本文件 `docs/execution/A/relaunch-20261111/bridge/CLAUDE_READINESS.md` |

---

## 8. 未来开发交付模板（本轮禁止执行，仅为格式约定）

> 仅在 **MAIN 发布具体 ReleaseAssignment**（绑定完整 base SHA + dirty overlay 摘要 + 合同 hash + 精确白名单 + 唯一 writer）**且 BRIDGE 转移唯一 writer** 之后，才按 TASK 票据编码。本轮不得填写为已完成。

```
[BRIDGE 开发交付回执]
release_id      : <MAIN 发布的 ReleaseAssignment ID>            # 未发布则填 NOT_RELEASED
ticket          : <BR-A-ENTRY | BR-A-HOST | BR-A-FACTS | BR-A-REVIEW | BR-A-RECOVER>
writer          : <唯一 writer handle>                          # 转移时间、双方 handle、dispatch id
基线            : base SHA / dirty overlay 摘要 / 合同 hash / candidateLock
                 （逐文件 sha256 复核结果：MATCH / DRIFT，DRIFT 即停止并报 MAIN）
改动文件        : 逐文件列出（含新增），全部落在 release 白名单内
真实命令与 exit  : 每条命令的完整命令行 + cwd + 实际 exit code（0 与非 0 都要写）
证据 hash       : 产物 / 日志 / DB 事实的 sha256；before-after revision/source/snapshot 对照
首次失败        : 第一个失败用例（命令、case id、错误码、原始输出），原样保留，不美化
剩余风险        : 未覆盖 case、未知/未运行项、资源预约缺口
回退            : 具体回退动作与保留物（不回滚已发布 commit、不删 prepared 证据）
进程/资源结束状态: worker/子进程/FD/端口/临时运行根是否全部结束（给出证据）
请求 MAIN 裁决  : 需要 MAIN 决定的合同/接口/文件释放项（逐条编号）
独立审查        : NOT_SIGNED_BY_IMPLEMENTER —— 参与实现者不自签独立审查
```

**红线（未来开发同样适用）**：不得绕过 MAIN 的 R1..R5 裁决；不得把测试 port / `TestFactPort` / `TestAdoptionAuthority` 置入生产；不得把 `waiting_user` 加入 `A_DISPATCHABLE_RUN_STATES` / `A_DISPATCHABLE_ATTEMPT_STATES`；不得修改 Frozen31 / 80defs / `contracts/**` / `src/contracts/**`；不得用 prepared 冒充 committed / commit 冒充 NativeAck；失败如实保留，不修绿历史 Gate；不进入 B。

---

## 9. 交付状态与请求 MAIN 裁决项

### 9.1 交付状态

- 本轮为**只读就绪检查**，**不构成独立产品验收**，也**不构成 A / V1 结论**。
- 结论：**NEEDS_REVISION** —— 高优先级修订 5 项（F-01、F-02、F-03、F-13、F-14），中低级 12 项（F-04..F-12、F-15..F-17）。
- **正面结论**：4 份文档的**代码事实基础经得起逐条实读复现**（DESIGN 13 组断言 0 反例；ACCEPTANCE 17 个路径 0 缺失；TASK 基线/dirty 0 漂移；22/22 输入 hash 与 25/25 dirty hash 全部相符）；16:22 追加的 prepared-source@1 / 窄 internal guard / delivery QC→package / R6 四组提案**均有真实代码依据**，且**不要求扩大冻结面**（`ps_` 可落入冻结 `materialization_id` 模式，R6 字段与 `LocalAsset.registration_digest` 自洽）。文档质量足以支撑交接。
- 即便修订后判为 READY_FOR_MAIN_REVIEW，**也不自动写代码**；实施仍须 MAIN 的具体 ReleaseAssignment + 唯一 writer 转移。
- R5 未获 MAIN 裁决前，`BR-A-REVIEW` 保持 **BLOCKED_FOR_CONTRACT**；本轮**未实现任何专用采用分支、未放宽任何 guard 状态、未把 `waiting_user` 加入 `A_DISPATCHABLE_*`**。

### 9.2 请求 MAIN 裁决项（按优先级，本轮不代为决定）

1. **F-13 — A 轮采用的 wire 入口二选一**：内部接线（`review.decide` 写 Decision+Approval → Host 组合调 `apply_review_adoption`；`change.*` 三路由 A 轮不实现，ACCEPTANCE BR-A-05 入口须改写）**或** 冻结接线（`change.prepare`/`change.approve`/`change.apply` 补 producer，由 R5 分支接受 `execution.attempt==='waiting_user'`）。并明确**唯一批准来源**（`review.decide` vs `change.approve`）。
2. **F-14 — prepared 场景 `ReviewPackage.impact` 的构造点与字段取值规则**，特别是 `target_snapshot_id` 在采用前的语义、`base_revision`/`control_revision`/`source_digest`/`selection_version` 的取值与 `state`/`expires_at` 生命周期。
3. **F-06 — R5 的归属与文件释放**：`src/host/creative/execution-guard.ts`（窄 internal effect 落点）、`fixed-workflow-service.ts`（attempt 表示，`recordStepAttemptInTransaction` 现成缝）、`product-repository.ts`（事务/授权接口）三者的**逐文件精确独占释放**；并给出事务边界与 attempt 表示方案。
4. **F-02 — 生产 `ProductFactPort` 与 `TrustedAdoptionAuthority` 的实现归属**（当前仓库内唯一具体实现是 `tests/agent-driven/product/support/fixtures.ts` 的测试替身，**不得注入生产**）；以及四能力 descriptor/fingerprint 的权威来源。
5. **F-01 — `change.prepare`/`change.approve`/`change.apply` 的 producer 归属**（或明确 A 轮不实现）。
6. **F-03 / F-04 — 评审证据与候选清单的字节重绑定**：对 `3b702b93/8d3d98a2/38f5fe5b` 一代或当前 overlay 重做静态 closure 评审；`prepared-draft-verifier` 候选清单（`380b235f` → 现 `ffefbd41`）重出或标 superseded。
7. **F-15 — delivery 原Job持久端口 + QC→package 子阶段去重键/子阶段事实的 owner 与 DDL 归属**（并据此冻结 BR-A-10 的实际命令）。
8. **F-16 — R6 附属 transport 的规范落点与"不计入冻结协议面"的判定口径**。
9. **F-05 — registry 内嵌 `state:"REVIEW_CANDIDATE_NOT_FROZEN_NOT_RELEASED"` 与 freeze `FROZEN_FOR_A_IMPLEMENTATION` 以哪一读法为准**（两文件均冻结，不改 bytes，只写裁定）。
10. **F-07 / F-10 / F-11 — 文档微调**：31 路由 producer 覆盖统计（15/31）与表标题、变异反例到"测试文件 + 单条红断言"的绑定表、ENTRY 票改述为"已在 MAIN 落地"。

### 9.3 本轮唯一写入

`/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/relaunch-20261111/bridge/CLAUDE_READINESS.md`
（其余 4 份父文档、产品代码、配置、Git 索引、运行根、DB、素材、证据历史**均未写入**；父文档由 MAIN/BRIDGE Codex 追加，不属本窗口写入。）

---

# 补充：定向复核（第 2 轮，仅复核新增修订；原第 0–9 节历史全部保留不改）

复核时间：2026-11-11（承 `task_0bd1d303a11c` / Dispatch `ctx_aca9dc7af0f2`，handle `term_c7b45237e89f62cd4defe27cbb8c6f00`）
范围：仅 `relaunch-20261111/02_MAIN_CONTRACT_AND_DECISIONS.md`（D08–D12、D01 精确 DTO、D13–D15）、`03_OWNERSHIP_AND_DEPENDENCIES.json`、`contracts/asset-inventory-v1.schema.json`、`contracts/asset-inventory-v1.registry.json`、`contracts/review-media-v1.registry.json` 及必要的 MAIN 源码核对。**不重审历史**；产品验证全部 **NOT_RUN**；未写产品代码/测试/配置，未跑 typecheck/install/render/服务，未读凭据或配置，未派子 worker。

## 10.1 结论

**本轮 ACK 通过。** F01 / F02 / F13 / F14 / F15 / F16 六项**均已由 MAIN 的 D08–D15 与已落盘的 03 所有权表闭合**，本轮逐条实读复现后给出 ACK；F03 保留真实历史且 MAIN 的处置（R0 当前字节重审）正确；F09 由实测闭合。**剩余仅 3 项非阻塞观察**，无阻塞项。**本轮仍未写任何代码，未做任何产品验证。**

## 10.2 F01/F02/F13/F14/F15/F16 逐项 ACK

| 编号 | MAIN 处置 | 本轮实读复核 | ACK |
|---|---|---|---|
| **F-01** `change.*` 零 producer | D-08：`change.prepare`→`CreatedSourceChangeService.prepare`，`change.apply`→该服务 `apply`；**原 31 路由按此接线，无需永久 503，也无需让 HTTP 携带 internal effect**。D-10：created 分支沿 `Coordinator.controlledWrite` + 原 `project_transaction(kind=edit, request.operation='agent.created_source.apply@1')`，新增不可变 `created_adoption_fact`（无 state 列），`RevisionStore.commitPreparedCreatedSource` 在**一个 BEGIN IMMEDIATE** 内 CAS base/source/control/锁/许可/Run/批准与 impact、消费 Approval/impact、revision 恰 +1、结算 step/event/outbox、project_transaction committed。03 已把 `created-source-change-service.ts`/`created-source-impact-store.ts`/`created-source-adoption-store.ts`/`created-source-adoption-service.ts`/`created-source-publisher.ts` 分配给 BRIDGE | 接线、归属、事务边界、文件释放四项齐备；且明确"旧迁移 API 不因此接受任何新虚构 operation"、"不把工作流 accepted 当 commit 证明" | **ACK** |
| **F-02** 生产无 `ProductFactPort`/`TrustedAdoptionAuthority` | D-08/D-09：新建 `created-run-facts.ts` + `created-run-authority.ts`（03 分配 BRIDGE）；D-09 要求真实 current base/control/selection、prepared 映射、native 完整性/消费者图/三类锁、"locks_checked 与消费者图真实构造，未知图 fail closed"；03 的 R1 activation_constraint 写明 **"Run remains blocked until four actual capability producers"** | 生产实现有归属、有文件、无"提前宣称 available"的口子；测试替身不被允许进生产的约束（初轮 F-02）已被"真实 producer 门 + fail closed"取代 | **ACK** |
| **F-13** internal effect 与冻结 `change.*` 的 wire 缺口 | D-08 明确选择**冻结路由接线**：router 先验冻结 DTO/身份/owner，服务再从**真实行和私有 proof** 构造窄 effect；`review.decide` 仍是工作台一次确认并采用的主入口，事务后 Host 经**完全相同的 apply 服务**自动尝试已授权采用，Agent 也可对同 impact/approval 调 `change.apply`，"两者同原 idempotency/impact 消费权威，**不能各 +1**"；`change.approve` 为同一批准权威的兼容适配 | 初轮问题正是"wire 入口二选一未定"，现已定；且"不能各 +1"正面覆盖了我担心的双提交 | **ACK** |
| **F-14** prepared 场景 `ReviewPackage.impact` 构造点未定 | D-09 逐字段给出来源：`materialization_id`=D02 真实 `ps_` 映射；`base_revision`/`source_digest`=当前 committed base 并与请求逐项比较；`control_revision`=RevisionStore 当前；`selection_version`=Host 权威 selection（真实持久初始 0，不伪造选镜）；**`target_snapshot_id` 用既有 `snapshotIdFor(project_id, prepared_source_digest)` 内容寻址函数，"只是可验证的预期 ID"，采用前不插 snapshot/active_commit 行，不宣称 committed，publish 后验证 ID 完全相等**；`plan_sha256`=域分离 `PreparedAdoptionPlanV1` 完整 preimage（字段、数组显式排序、frame range 用整数帧），`facts_digest` 沿**同一 preimage** 计算 | 我初轮担心的正是 `target_snapshot_id` 在采用前无 committed snapshot 可填 —— 现已给出"预期 ID"语义且**不需要扩 80defs**（`materialization_id` 模式 `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` 可容纳 `ps_` 前缀）；同 key 重放不续期、已 consumed 返回原事实、stale/expired 不复活亦已写明 | **ACK** |
| **F-15** delivery 子阶段去重/事实/命令无归属 | D-11：`FixedPhaseExecutor`（BRIDGE core）管同一 delivery step 的真实 Job 与 lease/attempt；**Job payload 不可变**、含 delivery action pair；`step_attempt` 保留原唯一活动约束，**不为 qc/package 各造一个无绑定同 step Job**；一个 Job 从当前 QC 检查继续到发布，**内部阶段不另有可写状态列**（真实不可变 QC 事实与 publish receipt 是否存在决定恢复动作）；去重键 `(project_id,run_id,plan_version,step_id,execution_attempt,producer_render_receipt_digest)` 沿原 `operation_idempotency`，不混新 lease attempt 与原 execution attempt；新增 `created_render_evidence` + `created_delivery_phase_fact`（无 state 列、不另存第二 ready）。D-14 追加 append-only phase 链，主键 `(project_id,job_id,execution_attempt,phase)`，phase `encoded`/`qc_inspected`，`EncodedFactV1` **无 QC 通过字段**，encode 后先落私有不可变对象域再同事务登记。命令基座 = 既有 `tests/agent-driven/media/render-snapshot.test.ts` + 2 个新文件（明写 NOT_RUN、不冒称已存在） | 去重键、单 Job、恢复判据、DDL 归属、命令归属五项全闭合；D-14 还把"encode 后 QC 前"这一缺口单独锚定 | **ACK** |
| **F-16** R6 附属 transport 规范归属空白 | D-12 + 两份 registry 落盘：规范文件、设计文件与注册策略齐备（MAIN 批准 / BRIDGE 唯一 producer 与注册 writer / PRODUCT·MEDIA 消费者 / 原冻结 resources 不改 / runtime 显式合并附属注册并**分别验证与宣告版本**）；计数口径写死："31+4 HTTP and +1 resource must be reported separately"、review-media "one explicitly additional read route; do not count as original frozen31 or as asset-inventory four routes" → **总暴露 = 原 31 HTTP + 附属 5 HTTP + 1 MCP resource**；且明确**不得再称"总协议完全未扩大"** | 我初轮的 F-07（隐藏扩面）被这条正面封死；F-16 本身闭合 | **ACK** |

## 10.3 指定精确性检查（逐条实读结果）

| 检查项 | 结果 | 依据 |
|---|---|---|
| **`rights_ref.version` 是否精确为 1** | **是，`{"const": 1}`** | `asset-inventory-v1.schema.json` → `InventoryItem.rights_ref.version` = `const: 1`（不是范围、不是枚举多值）；`additionalProperties:false` + `required:[id,version,sha256]`。registry 侧 `rights_ref` 条目写 "id=real asset.rights_ref; version=1; sha256=registration_digest; row/project/bytes/license must still validate" —— 形状与语义分离 ✅ |
| **顶层 schema 是否含 `InventoryItem`** | **是** | 顶层 `anyOf` = `[Inventory, SourceFileListing, RegistrationRequest, InventoryItem]`；`asset-inventory-v1.registry.json` 中 `local-assets.import` 的 `response` = `"InventoryItem"` → **POST 响应是合法的顶层文档**，与 `local-assets.read.ui`/`asset-inventory.read` 的 `Inventory` 区分清楚 ✅ |
| **`InventoryItem` 响应验证是否与真实已登记对象兼容（读面不收窄）** | **兼容 ✅** | schema 的 `media` 10 个字段与真实 `LocalMediaFacts`（`src/host/agent-driven/local-media-probe.ts:6-17`）**逐字段一致**：kind/media_type/extension 枚举/duration_frames/duration_ms/width/height/sample_rate/channels/codec，nullability 相同；`duration_ms` 由 `Math.ceil` 生成并经 `Number.isSafeInteger` 校验（`local-media-probe.ts:150`），`duration_frames` 经 `Number.isSafeInteger` 校验（`src/host/assets/media-validator.ts:53`）→ schema 的 `"type":"integer"` 不会拒掉任何合法已登记对象；标签上限 2000 == 真实 `input.license.label.length > 2000` / `source.label.length > 2000` 拒绝线；derived `lineage` 上限 256 == 真实 `source.lineage.length > 256` 拒绝线（`local-asset-registry.ts:269/272/275`）→ **D-15 的"不因新读取 schema 变窄而不可读"经源码核对成立** |
| **`source uri` null → 缺省** | **已明确规定，且是必需适配步骤 ✅** | schema：`owned/generated/licensed` 分支 `uri` 在 `required` 内但 `anyOf[string,null]`；`derived` 分支无 uri、改用 `lineage` → `oneOf` 判别无歧义。schema `$comment` 明确 "normalize owned source uri:null to absent for existing LocalAssetInput"；D-01 "nullable uri 在适配时显式转成旧 AssetSource 可选字段，**不能传 null 给原校验**"。真实校验：`local-asset-registry.ts:281` 只接受 uri **缺省或 string**（`typeof null !== 'string'` → 会被拒）→ **null 必须被剥离**，三处口径一致 |
| **同 key 已成功、候选过期后重放** | **顺序与结果均已规定 ✅** | registry `idempotency.lookup_order`：**先** recall 原 import operation receipt 并校验 asset/operator/声明引用、匹配则返回原 `InventoryItem`；**只有无 receipt 才**校验 candidate TTL/root/file 并构造原 `LocalAssetInput`。`same_key_success_after_expiry_or_restart`："replay original authenticated import receipt without requiring candidate cache; do not reopen/re-probe source input or **generate new attestation ref**"。`same_key_different_public_input`："IDEMPOTENCY_CONFLICT **even if candidate expired**; never replay an unrelated declaration"。D-15 追加："候选过期/Host 重启不能挡原成功 receipt，异 body 必须 409；**禁止新建第二幂等表/状态或先验证过期候选再找成功回执**" |
| **（追加自查）`attestation_ref` 长度是否满足真实 `ID` 约束** | **满足 ✅（但 02 正文比 registry 松）** | registry 定义 `attestation_ref = ui_ + first60hex(SHA256(domain narralens-local-asset-declaration-v1 + "\n" + canonical public_digest preimage))` → **63 字符**，符合真实 `ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`（`local-asset-registry.ts:67`，用于 `ID.test(input.attestation_ref)`，:261），且以 `u` 起始 ✅；派生确定性（排除 correlation_id/时间/session/root-generation）→ 同 key 同 body 同 ref → `registration_digest` 稳定 ✅ |

## 10.4 F-03 真实历史与 R0（保留，不改写）

- `docs/execution/A/reviews/draft-processor-pre-review/REVIEW.md`（sha `d02735fd…`）**确有追加的显式结论**：`## Closure review — 2026-11-10` → **"PASS — BLOCKER 0 / MAJOR 0 / MINOR 0"**，覆盖 M1（异步撤销 grant 的长窗口：`before_prepare` 返回后于 stage 创建前经 `withRunningTask()` 只读 `gate.assertWorker()` 回查且不重复 `#progress`）与 M2（`reapExpired` 同事务 CAS 原 job + 同步 hook 推进 CP；requeue→CP pending / 耗尽→CP failed + job attention / 取消→两侧 cancelled；`recover()` 为同步必需端口且在 claim 之前；`leaseReaperExclusions()` 暴露活跃 created-task jobs）。该节**明写"追加原始 NOT PASS，不覆盖历史 finding"** → **真实历史被保留，未被抹绿** ✅。
- **但该 closure 绑定的字节仍不覆盖当前 overlay**（本轮复算，逐字节）：`closure-input-hashes.json`（sha `d31a3568…`）记 processor `3b702b93…` / store `8d3d98a2…` / worker `38f5fe5b…` / gate `1a65d8f3…` / local-asset-registry `84ce6395…` + 4 个测试文件；当前磁盘为 processor `6727b0b6…` / store `d7a4734c…` / worker `41a76585…` / gate `1a65d8f3…` / verifier `ffefbd41…` → **3/5 源文件与 4/4 测试文件漂移**，gate 与 local-asset-registry 仍匹配。本轮另行确认：当前 overlay 5 个关键文件与**初轮（16:21）读到的字节完全一致**，会话期间无漂移；MAIN HEAD 仍 `838ba5f2…`、dirty 仍 18 项。
- **MAIN 的处置正确，ACK** —— D-12："所有旧 PASS 只证明其绑定 SHA/字节。当前 processor/store/worker 相对历史 closure 已漂移，候选 380b verifier 与当前 ffef 不同，**均保留历史而不标当前审查通过；R0 必须当前字节重审/受影响复验再冻结**"；03 的 `dependencies[0]` = `R0-preserve-freeze`，outputs = "reviewed common integration commit"。→ **该 closure 是历史事实，不是当前审查通过；当前字节的重审归属 R0，不是设计缺陷。** 本轮据此**不**将 processor/store/worker 记为"已审查通过"。

## 10.5 03_OWNERSHIP_AND_DEPENDENCIES.json（实际记录，不猜）

- **文件现存在** canonical `docs/execution/A/relaunch-20261111/03_OWNERSHIP_AND_DEPENDENCIES.json`（磁盘 21415 B，序列化 16542 B，mtime 2026-11-11 16:48:29）。**初轮（16:16–16:22）读取时尚不存在**（当时该目录尚未落盘），属**历史观察**，现已关闭；BRIDGE Codex 在 TASK.md 第 98 行亦已如此记录 ✅。
- 本轮**实测**：`status` = `MAIN_DESIGN_REVIEWED_NOT_IMPLEMENTATION_RELEASE`；`base_sha` = `838ba5f2c8500f0103f56dbe51264ea9f70086fc`（**与现场 MAIN HEAD 一致** ✅）；`overlay_manifest` = `baseline-observed.json` ✅；`contract_documentation_sha` = `f0c4f4f3…`（与 contract-freeze.json 一致 ✅）；`contract_sha` = `ca5b67a8…` ✅。
- **`files` 数组实测 123 项**：writer 分布 = **bridge-Claude 68 / media-Claude 28 / product-Claude 27**。
  → 与 BRIDGE Codex 第 98 行记录的"**120 项 / BRIDGE 65 项**"相比**已再增 3 项**（本轮新增可见 `src/host/agent-driven/review-media-http.ts`、`src/host/agent-driven/created-review-gate-store.ts`、`tests/agent-driven/integration/created-schema-upgrade.test.ts`）。**实施时以文件当前内容为准**，120/65 已过期。
- `always_protected` 9 项含冻结四合同文件、`pnpm-lock.yaml`、`vendor/`、`contracts/agent-driven-a.migration.sql` ✅ —— 冻结面受保护，而 BRIDGE 拥有的 `contracts/agent-local-assets-v1.*` / `src/contracts/agent-local-assets-{types,validator}.ts` 是**不同的新增文件**，二者不冲突 ✅。
- `dependencies` 5 项 = **R0-preserve-freeze → R1-producers-and-consumers → R2-review-adopt-native → R3-render-delivery-recovery → R4-stage-A-freeze**，各有 owners/outputs ✅。
- **初轮 F-06 的文件释放问题已闭合**：`src/host/creative/execution-guard.ts`、`fixed-workflow-service.ts`、`product-repository.ts`、`src/host/projects/{revision-store,project-creation-store,project-coordinator,project-resolver}.ts`、`src/host/impact/impact-store.ts`、`src/host/server.ts`、`package.json` 现均列为 **bridge-Claude 唯一 writer** → 与 D-08 "原 execution-guard.ts、fixed-workflow-service.ts、product-repository.ts、RevisionStore 与 Host 精确名单在 03 集中释放" 一致 ✅。TASK.md 亦已追加逐文件白名单节并声明"以该表为唯一设计分配权威，覆盖本文早期拟名单"，**初轮"package.json 属禁止路径"与新分配的冲突随之闭合** ✅。

## 10.6 工具链（准确入口实测）

- 目标 worktree 实测：`cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration && corepack pnpm --version` → **`10.33.0`** ✅（仅版本查询；未触发下载/安装提示、未联网、未写任何文件）。
- node `v22.22.1` ≥ `22.15.0` ✅。PATH 上的 `pnpm` 仍为 `10.31.0`；按 D-12"使用目标 worktree 的 corepack pnpm --version 核对 10.33.0，不能把 Claude PATH 下的 10.31.0 写为已满足，也不能据 MAIN PATH 的 10.33.0 推定子窗口一致" —— 本轮**在子窗口自己的目标 worktree 实测**得 10.33.0，**初轮 F-09 由此闭合** ✅。
- 执行期间 Bash 曾两次被既有 MiniMax 网关的 auto 模式分类器超时提示拦截（只读 Bash 调用，非任务错误）；按协调终端指示**未改任何配置/供应商/凭据、未启新 worker**，重试后正常完成 —— 记录为工具链瞬时现象，不影响结论。

## 10.7 剩余观察（均为非阻塞，不构成开工门）

1. **02 正文与 registry 的精度差**（可追溯性）：D-01 正文只写"`ui_` 前缀声明引用"，未给长度规则；精确规则（`ui_ + first60hex(...)`，63 字符）只在 `asset-inventory-v1.registry.json` 的 `idempotency.attestation_ref`。只读 02 的实施者可能推导出 `ui_`+64 hex（67 字符）→ **超出真实 `ID` 上限 64 会被真实 registry 拒收**。建议 02 在正文补一句"长度 ≤64，精确派生见 registry"。（registry 已被 02 指定为精确步骤权威，故为文档精度问题，非语义未定义。）
2. **附属协议的命名映射**：DESIGN_ONLY 设计件名为 `asset-inventory-v1.*`，而 03 分配给 BRIDGE 的运行时文件名为 `agent-local-assets-v1.*`（含 types/validator）。两者是同一附属协议的两套名字，**建议 02/03 写明一一对应**，避免实施者另造第二套协议。
3. **独立复核容量**：BRIDGE 现持 123 项中的 68 项，且含 Coordinator / RevisionStore / impact-store / execution-guard / product-repository / package.json 等共享核心。单 writer 纪律已满足（每文件一个 writer），但 AGENTS.md 要求"参与实现者不自签独立审查" —— R2/R4 的**独立复核可得性**将成约束。建议 MAIN 在 R0 明确复核上下文安排（不由 BRIDGE 自签）。另 `03_OWNERSHIP` 中 `activation` 字段亦写明实现 release 需在 R0 之后、不得凭空发明未来 SHA ✅（与初轮一致）。

## 10.8 本轮命令清单（全部只读；产品验证全 NOT_RUN）

`ls`/`Read`/`sed -n`/`grep`（指定文档与源码）；`node -e`（解析 03 与 schema、枚举 registry 路由）；`sha256sum`（overlay 5 文件 + closure/REVIEW 记录 + 3 份父文档指纹）；`git rev-parse HEAD` / `git status --porcelain`（只读）；`corepack pnpm --version`（版本查询，无安装/无网络）。
**未执行**：任何 `pnpm test` / `vitest` / `tsc` / `pnpm run build` / `pnpm install` / `pnpm run start` / 渲染 / ffmpeg / 浏览器 / 真实媒体；任何 `git add|commit|merge|push|cherry-pick|rebase|reset|stash`；任何凭据或配置文件读取；任何子 worker。

## 10.9 交付状态（本轮）

- 本轮为**定向只读复核**，不是产品验收，不构成 A/V1 结论，不自签独立审查。
- **F01 / F02 / F13 / F14 / F15 / F16 = ACK（已闭合）；F03 = 保留真实历史 + R0 重审（处置正确）；F09 = 实测闭合。** 剩余仅 10.7 三项非阻塞观察。
- 本轮唯一写入：本文件 `bridge/CLAUDE_READINESS.md`（**追加**第 10 节；第 0–9 节历史原样保留）。产品验证全部 NOT_RUN。
