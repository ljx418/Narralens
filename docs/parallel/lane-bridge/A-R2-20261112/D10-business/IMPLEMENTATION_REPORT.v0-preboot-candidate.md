# D10 原业务恢复实施报告（Claude 唯一写入者）

## 身份与基线

- task_id=`task_e115789b4321`，dispatch_id=`ctx_416fe0a4fa5a`，run_id=`run_399f9dd3ce5a`，我的 terminal=`term_bef098e5-1eaf-47ea-9e6d-d51dc985dd2d`（state=ready / stage=input_accepted / liveness=live / terminalState=retained）。
- 工作目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，平台 WSL2 Linux `6.18.40.1-microsoft-standard-WSL2`，与 dispatch 的 workspace 映射 `C:\workspace\videoworkline\Narralens-agents\main-integration` 一致，无执行宿主/cwd 错配。
- HEAD=`de438d17dfc777a9d113c7207b98e1923ab72e6c`（票面基线 `45377c9d0c13264d9f7af7da4f1db56cd6679fe2` 的后继提交），分支 `agent-driven/main-a-integration`。
- 不可变输入 SHA256 实测匹配：D10_CLAUDE_IMPLEMENTATION_TICKET.md=`4519f0ce1a8a8c389401ddb280755481ed3212ae39d6a07661281f19e63e22ca`，D10_CLAUDE_IMPLEMENTATION_RELEASE.json=`57d4403e9a7f8e30a7b7275fe5baa5e3f85f96df39830e03b7c8343ab0eed192`。
- 本轮唯一写入者＝本 Claude 会话。MAIN/BRIDGE 在此期间对生产源与索引只读。未执行 git add/commit/reset/stash/push。

## dirty 文件（精确 4 路径，全部在 RELEASE 内）

| 路径 | 状态 | SHA256 |
|---|---|---|
| `src/host/agent-driven/created-source-recovery.ts` | 新增 | `702f9b342ba82450c9c99000817732d2c13d4d408a046f32667e1cee044b3106` |
| `src/host/agent-driven/created-source-adoption-service.ts` | 修改 | `2471c2ee40cb7bb8ba21ca92b3629a020b3e3e7b03a61d69750b7af37554bde2` |
| `tests/agent-driven/integration/created-source-adoption.test.ts` | 修改 | `04eb25fa45efede7d101878d0c603d96b8947f377c49896dc3422a74ed644548` |
| `tests/agent-driven/integration/created-source-recovery.test.ts` | 新增 | `8862ecd70579ce413a4d67764969a9ad17810a1e652854275e207c04f9a8db9f` |

无新增 helper 路径。`tests/agent-driven/integration/helpers/created-source-recovery-fixture.ts` 未创建：新建测试文件改为自包含 fixture，只读复用既有 `helpers/created-draft-fixture.ts` 与 `helpers/created-project-fixture.js`。回退方式＝对两个已修改文件 `git checkout --`、对两个新增文件删除，即回到 `de438d1`；未使用 stash/reset，未触碰用户工作。

## 实现内容

### 1. `created-source-recovery.ts`（新，Host-only 业务恢复）

服务只识别真实原库中 `kind=edit` 且 request 的 `operation` 精确等于 `agent.created_source.apply@1` 的行（复用 `controlledRecoveryFamily`）。它不建立第二状态机：所有决定都走原 `ProjectCoordinator.controlledRecovery` 队列、原 `CreatedSourcePublisher`、原 `CreatedPublicationRecoveryFiles` 资源租约、原 `RevisionStore.commitPreparedCreatedSource` 闭合提交。

公开接口只有三个，不新增 wire DTO 与持久 state：

- `recoverOnStart()`：只处理本 family 原行；每轮重读真实行集合，按 `(created_at, transaction_id)` 稳定全序处理；只有真实终态（committed/aborted/attention）才计进展，单轮无进展即停止，不 busy loop、不虚报进展；`attention`/`recovering` 不重置、保留为未决并出现在 `unresolved_transaction_ids`。
- `recoverTransaction(transactionId)`：单事务重入入口；已决行返回真实既有结果（`already_committed`），不再签发、不再消费、不 +1。
- `close()`：先拒新（`#open()` 抛 `CAPABILITY_UNAVAILABLE`），再等待本服务已接收的恢复，然后关闭 Publisher 与 RecoveryFiles 资源；数据库留给 Host 最后关。清理不确定以 `PublicationCleanupError` 抛出且 sticky。

内部结果只含 `transaction_id / project_id / outcome / reason / revision`。`reason` 是封闭的机器令牌集合（`CreatedSourceRecoveryReason`），全模块不做人类文案模糊匹配，也不把任意 409/CAPABILITY_UNAVAILABLE/Error 归为授权失效。

分类依据只有三类真实事实：
1. **资源身份证明失败**（原 RecoveryFiles `inspect`/`layout` 抛 `ProductError('REVISION_CONFLICT')`）→ `attention` 保全，不移动任何文件。
2. **原闭合提交的精确机器失败标记**（`CREATED_COMMIT_*`，原 RevisionStore 自己的令牌，非人类文案）→ 授权类 `abort`（先补偿再中止）/ 基座与身份类 `attention` / `CREATED_COMMIT_OTHER_TRANSACTION_PENDING` → `deferred` 保留 prepared。
3. **自身从实际行读出的授权事实**（approval/confirmation/run/grant/step/plan_version/impact/lock/selection/rights/creative input 闭包）→ 逐项机器判定；确证失效才补偿后中止，未知或瞬时（errno 集合、cleanup 不确定）一律 `deferred` 保留 prepared。

关键决策分支：

- **请求合法性**：request_json 必须恰有 `operation` 与 `input` 两键；`input` 用原 `validateAgentDefinition('ApplyChange', …)` 校验；`contentDigest(input)` 必须等于原 `request_hash`；project/base/execution/impact/approval 必须匹配真实原 immutable adoption。旧仅 marker 的请求不是合法请求，不得当合法请求使用。
- **owner 与路径**：owner 只来自真实 `creation.ownerOf()`、`creation.forProject()`、`creation.origin()`（必须为 `created`）与 Host 固定根下的 `owner.json` 标记；author 路径只由 `createdRoot + 已验证 project_id` 派生；不接受 request/journal 中的任意绝对路径。
- **未发表事务**：`received/preconditions_checked/staged/validated` 与无 published journal 的 prepared 只能走原 `Coordinator.abort`，且必须先独立证明：原 committed base 的 revision/source_digest/project_state 未动、原 R1 `created_source_fact` 几何存在、author 根仍持有完整原闭包（整体 source digest，不是只比 `film.html`）、真实 owner 标记成立，并由 `RetainedSourceTree` 保留句柄直到中止为止。缺原 base、未知身份或来源不符不得安全中止。
- **已发表事务**：用真实 `CreatedPublicationRecoveryFiles.inspect`/`layout` 判定 `original / rename_gap / published / rollback_gap / restored` 五种实际布局。`published` 时：当前授权仍有效 → 真实 `Publisher.recoverPublished` 取本实例私有 proof，随后原 `RevisionStore.commitPreparedCreatedSource` 以精确 9 字段完成同 transaction，revision 恰 +1，不建新 transaction/job/snapshot/编码；确证取消/暂停/过期/新锁/selection/rights/creative 输入变化 → 先 `restoreOriginal` + 同步 `assertOriginalRestored` 补偿，再原中止，保留全部 target/staging/snapshot。非 published 布局一律先补偿后原中止。
- **忽略集合**：传给原 `controlledRecovery` 的 ignored IDs 由实际数据库行构造，取本项目三 family（created/history/adoption）的全部未决行；不接受客户端 ID，也不做全局无条件 skip。队列前后都重读并用 `hasOlderControlledPending` 拦更老未决行；未知 kind/operation 的 pending 行保持原 gate 阻塞。
- **已提交**：只读验证原持久 receipt（同 key、同 digest、同 transaction、同 project、Applied 的 revision=base+1、snapshot 与 source_digest 对齐原事务行），不新签 proof、不重消费、不 +1；后续合法 revision 存在时不要求旧 target 仍是 current author。

### 2. `created-source-adoption-service.ts`（在线错误与关闭/恢复衔接）

原错误分支把「有 journal 就 terminal attention、没 journal 就 abort」一律处理：已发表中断被封成终态 attention，无法交给专用恢复。改为：

- 存在 `published` journal（发表已发生、提交未发生）时**不再**写 terminal attention，保留原 `prepared` 给专用恢复，原 gate 继续阻写该项目；不假称已恢复、不假称已提交。
- 无 `published` journal 时，中止前必须真证明 author 根仍持有完整原闭包（`computeSourceDigest` 与 `plan.base_source_digest` 全量比对）。**不凭 journal 空断言未改作者**。证明成立才走原 `Coordinator.abort`；证明不成立则保留 `prepared`。
- cleanup 不确定仍 sticky 且完整清理，原错误不被抹掉，已 committed 的结果不回滚；关闭路径仍先拒新、等本服务 pending、再关 Publisher。

### 3. `created-source-adoption.test.ts`（保留旧 50 例）

fixture 的原创建事务此前只存 marker `{operation:'agent.created_source.apply@1'}`，`request_hash` 是与 ApplyChange 无关的合成摘要，无法支撑恢复侧「完整 wrapper + 原 hash」校验。现改为：构造完整合法 `ApplyChange`（meta/project/impact/approval/base_revision/source_digest/execution），`request_json` 存 `canonicalJson({operation, input})`——与生产服务 `canonicalJson({operation:'agent.created_source.apply@1',input})` 的形状一致——`request_hash` 存 `contentDigest(applyChange)`，并把同一 digest 交给原 `commitPreparedCreatedSource` 的 `request_digest`（原闭合提交要求 `transaction.request_hash === request_digest`，二者同源）。impact 自身的 `request_digest` 保持原合成值不变，与原提交路径无关。旧 50 例的断言与期望未改动；旧例中断言 `request_hash`/`request_json` 的地方本就没有。

### 4. `created-source-recovery.test.ts`（新）

自包含 fixture：真实 created bootstrap → SOURCE_ONLY producer → 原 publisher 发表链，真实 SQLite、真实文件、原 `ProjectCreationStore`/`CreatedSourcePublisher`/`CreatedPublicationRecoveryFiles`/`RevisionStore`。新例清单见下节。

## 类型检查证据

### 正式冻结捕获（可作为验收证据）

- argv：`corepack pnpm exec tsc --noEmit`
- cwd：`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`
- 实际进程退出码：**0**（`typecheck-001.exit.txt`，内容 `ACTUAL_EXIT_CODE=0`）
- stdout：0 字节；stderr：0 字节（两者均为完整原始输出，未截断、未接管道）
- 输入冻结：6 个输入文件在执行前后 SHA256 完全一致（`inputs-before.sha256` 与 `inputs-after.sha256` 逐字节相同，diff 为空）
- 日志与哈希（`docs/parallel/lane-bridge/A-R2-20261112/D10-business/logs/`）：
  - `typecheck-001.exit.txt` = `8b603e387ddf350abc5892b56d19354fe3b458c58f01426c569d31dc7d2b21d9`
  - `typecheck-001.inputs-before.sha256` = `typecheck-001.inputs-after.sha256` = `29d3c6ebfa25143b62cb5c510e6736ffb4c9752abfc669f86494f00501a34415`
  - `typecheck-001.meta.txt` = `fa8b313e4277b7d804f2e9db4e8ea55654dd2d86c34a241c88809bbc692f1051`
  - `typecheck-001.stdout.txt` = `typecheck-001.stderr.txt` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（空文件的标准 SHA256）
- 无 install、无下载、无网络、无 provider、无 J 盘、无付费。

### 早前诊断（只作诊断，不作验收）

在正式捕获之前，我用 `npx tsc --noEmit 2>&1 | head -40` 做过三次诊断性检查。第一次**真实失败**，输出为：

```
src/host/agent-driven/created-source-recovery.ts(230,5): error TS2322: Type '{...}[]' is not assignable to type 'ProjectTransactionRow[]'.
  Type '{...}' is missing the following properties from type 'ProjectTransactionRow': source_digest_before, source_digest_after, snapshot_id, error_code, and 2 more.
```

该诊断因管道截断与 `head` 只能反映管道状态，**不作为 exit 0 的依据**；已按 MAIN msg_ddaeb1cfb88e 的要求原样保留，并由后续正式捕获取代。`npx` 未发生安装或网络抓取（本地 `node_modules/.bin/tsc`），但正式证据只采用上面的 `corepack pnpm exec tsc --noEmit`。

## 新增业务恢复用例清单（当前全部 NOT_RUN）

`tests/agent-driven/integration/created-source-recovery.test.ts`，14 例：

1. 已发表且授权有效 → 同 transaction 提交、revision 恰 +1、审批被消费一次；再次请求返回 `already_committed` 同一 receipt，不再 +1。
2. published journal 缺失 → 由真实资源补录后提交一次，不新建 snapshot/job。
3. 未知 operation 与未知 kind → 不接管（`not_owned`），行保持 `received`，revision 不变。
4. 仅 marker 的旧请求 → 不作合法请求；补偿还原原源并原中止，审批不消费，revision 不变。
5. 早期未发表（`received`）→ 完整原闭包证明后中止，revision 不变。
6. 审批过期 → 补偿还原原源后中止，审批保持 `active` 未消费，revision 不变。
7. selection 变化 → 补偿还原原源后中止。
8. 活动锁 → 补偿还原原源后中止。
9. Run 已取消 → 补偿还原原源后中止。
10. 瞬时资源错误（EIO 注入于资源租约入口）→ `deferred`，行保持 `prepared`，不产生终态。
11. 已发表内容被外部篡改 → `attention`，保全全部材料，不消费审批，revision 不变。
12. 存在更老的另一 family 未决行 → `deferred`（`ORDERED_AFTER_OLDER_PENDING`），不越序。
13. 存在无关未知 pending 行 → 交给原 gate（`GATE_BLOCKED`），不静默忽略。
14. `recoverOnStart()` 只决定本 family 行并如实报告未决集合；`close()` 在已接收工作完成后才返回并拒新。

旧 50 例（`created-source-adoption.test.ts`）在 fixture 改为完整 ApplyChange wrapper 后仍需重跑确认——当前 **NOT_RUN**。

## 资源请求（更正后）

先前一版请求把这两个文件描述为「无 ffmpeg」，该描述**不准确**：既有 `tests/agent-driven/integration/helpers/created-draft-fixture.ts:31` 用 `execFileSync('ffmpeg', …)` 生成诊断媒体，`preparedDraftFixture` 每个 case 都会调用。更正后的实际资源画像：

- 真实 Host：每 case 一个 `NarralensHost`，含 `host.listen(0)` 回环监听、真实 SQLite、真实文件、原 OpenFilm vendor root。
- ffmpeg：每 case 两次（lavfi 生成 3 秒 320x180 视频与 3 秒 48kHz 音频，单线程 libx264/pcm_s16le，30 秒超时）。
- 无浏览器、无 GPU、无 Comfy、无 provider、无网络、无下载、无 install、无 J 盘、无付费、无官方渲染、无 build、无全量 gate。
- 计划用 `--maxWorkers=1 --minWorkers=1` 单 worker 串行；一次一个文件。

建议顺序：**先跑新增的最小恢复子集**（`created-source-recovery.test.ts`，14 例）以验证新服务本身，再跑既有 50 例回归确认 fixture 改动没有回归旧期望。理由：新增文件是本次改动的直接证据，先跑它可以在不触碰旧期望的前提下定位问题；旧 50 例随后作为回归。若 MAIN 只愿意给一次槽，则先跑新增子集并把旧 50 例留作下一轮。

## 明确未做与不可声明

- 新服务**未接入 Host**：没有 Host 装配、没有 `Host.listen` 调用专项恢复、没有 generic 排除接线、没有真实运行根独占证明。因此 **RCV-D10-10 NOT_RUN**，**RCV-D10-01..09 的业务闭环 NOT_RUN**，**A 阶段不通过**，无人验 PASS。
- 真实 SIGKILL/进程丢失、真实进程重开、物理断电/文件系统灾难恢复 **NOT_RUN**：本轮全部是同进程内的异常注入与真实文件/DB 操作，异常注入不是进程丢失证据。
- 跨进程跨身份（inode 重建、迁移机具后 inode 改变）只有既有组件级证据，本轮未新增业务级证据。
- 本实现未自签独立外审、未自签人验、未自签整轮 PASS；独立复核仍需 MAIN/未参与上下文的干净审查上下文。
- 未改 Publisher、RecoveryFiles、RevisionStore、Coordinator、Host、CreationApplication、合同/DDL/路由/依赖/配置，未改任何其他测试，未启用任何路由。

## 需要 MAIN 裁决的精确设计问题

原闭合提交 `commitPreparedCreatedSource` 在同项目存在任何其它 `prepared/recovering/attention` 行时以 `CREATED_COMMIT_OTHER_TRANSACTION_PENDING` 拒绝（`revision-store.ts:554`）。对本 family 的恢复，这意味着同项目存在另一条未决 prepared 行时，**同 transaction +1 无法收敛**。按票面第 9 条，本实现**不绕过该条件**，保留真实 `deferred` 并如实上报（`OTHER_PREPARED_PENDING`）。请 MAIN 明确该边界的产品处置：是允许受控恢复在原队列内跳过其它 family 的行，还是维持现状并由 operator 处理——该决定需要公共合同变更，不在本轮可写路径内。

## 停止条件

本会话未出现 429。若出现，按 AGENTS 最高 429 规则立即停止实现，保全源码/dirty/日志/证据并上报，不自动重试、不重启旧窗口、不换供应商或凭据、不让 Codex/MAIN 未经用户显式授权接手。
