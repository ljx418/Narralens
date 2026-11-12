# D10 原业务恢复实施报告（修订批次 1 之后）— Claude 唯一写入者

> 本文件取代修订前的同名报告；修订前原文保留为 `IMPLEMENTATION_REPORT.v0-preboot-candidate.md`，
> 逐阶段日志见 `PHASE_JOURNAL.md`，ACK 正文见 `ACK_RULING_REVISION_1.md`。

## 1. 身份、基线与授权

- task_id=`task_e115789b4321`，dispatch_id=`ctx_283c06941e68`，run_id=`run_399f9dd3ce5a`，
  terminal=`term_213a3d1a-768d-4c87-afe7-55a7e3edfc3b`。
- 工作目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，平台 WSL2 Linux
  `6.18.40.1-microsoft-standard-WSL2`，hostname `WIN-IDGU3FG2NTF`，与 dispatch 的 workspace 映射
  `C:\workspace\videoworkline\Narralens-agents\main-integration` 一致，**无执行宿主/cwd 错配**。
- HEAD=`de438d17dfc777a9d113c7207b98e1923ab72e6c`，分支 `agent-driven/main-a-integration`。
- 不可变输入 SHA256 复算匹配：票据=`4519f0ce1a8a8c389401ddb280755481ed3212ae39d6a07661281f19e63e22ca`，
  release=`57d4403e9a7f8e30a7b7275fe5baa5e3f85f96df39830e03b7c8343ab0eed192`；
  裁决 `R2/D10_MAIN_RULING_REQUEST_AND_DURABLE_RECOVERY.md` 全文已读并 ACK（msg_1ce1302f1ac5）。
- 资源授权：`R2-BRIDGE-D10-BUSINESS-REAL-002`（grant002），仅本 ctx 独占使用；重型槽在本任务内串行使用并已释放。
- 全程未执行 git add/commit/reset/stash/push；`AGENTS.md`（MAIN 新增保护文件）未修改。
- **本会话未出现 429。**

## 2. 最终 dirty 文件（精确 4 路径 + 自有日志目录）

| 路径 | 状态 | 最终 SHA256 |
|---|---|---|
| `src/host/agent-driven/created-source-recovery.ts` | 新增 | `eb980288feb888a743475d185c1e34df3a67313d69dc2bb772e1eb9d13bfd1b5` |
| `src/host/agent-driven/created-source-adoption-service.ts` | 修改 | `9e140f5887b6e8ad5f406517504043ade1eaaa9df8978fee8a2d99d82c46ddb7` |
| `tests/agent-driven/integration/created-source-adoption.test.ts` | 修改（旧 50 例与其期望未改） | `04eb25fa45efede7d101878d0c603d96b8947f377c49896dc3422a74ed644548` |
| `tests/agent-driven/integration/created-source-recovery.test.ts` | 新增 | `38bf3a469dfd8437c819f90751a0e004f817d724813a7a8e615ee7a0ed088445` |
| `docs/parallel/lane-bridge/A-R2-20261112/D10-business/` | 自有日志/报告/候选副本 | — |

回退方式：`git checkout --` 两个已修改文件并删除两个新增文件即回到 `de438d1`；候选字节副本见
`candidate-v1/`（= 捕获 005 的输入）、`candidate-v2/`、`candidate-v3/`（= 最终字节），各自带独立 `SHA256SUMS.txt`。

授权的捕获产物按 grant001/002 落在 MAIN 的文档目录
`docs/execution/A/implementation-20261111/integration/e1-main-takeover/d10-business-*.*`（66 个新文件，全部保留）。

## 3. 实现内容（对照 MAIN 六条修订）

1. **损坏/marker-only 请求绝不补偿或中止**：新增 `#legitimacy()` 作为唯一闸门，在 `#decision()` 内、任何受控路径读取之前，
   校验 wrapper 恰为 `operation`+`input`、原 ApplyChange、`contentDigest(input)===request_hash`、project/base，
   并在 adoption fact 存在时逐项匹配 `impact_id/approval_id/execution`，且匹配 `cp_a0_prepared_authorization`
   的 `project_id/run_id/approval_id/facts_digest` 与 plan 的 base/source。合法前**不读 owner/source 路径、
   不 inspect/move 资源、不调用 Publisher**。不合法 → 原 `coordinator.attention()` 持久 attention
   （`REQUEST_NOT_LEGITIMATE`），**不补偿、不中止、不消费批准、不改 revision/pointer/impact/outbox/幂等/journal**。
2. **早期缺 fact 是独立分支**：无 adoption fact 时先查发表证据（journal + publication identity）；
   有发表证据无匹配 fact → `attention(IDENTITY_NOT_PROVABLE)`（保全不中止）；无发表证据才走独立证明后的原 abort。
   原 request 的 `source_digest` 必须等于 committed base 的 source digest。
3. **attention 真落原库、进展真来自原库**：attention 由原 Coordinator 持久化（`project_transaction.state='attention'`、
   `project_state.attention=1`、`attention_reason=<机器令牌>`）；`recoverOnStart()` 的 progress 只统计**观测到的原 DB 终态变化**，
   `unresolved_transaction_ids` 含 attention/recovering，`stopped` 与 MAIN 三族 scheduler 同语义（不再空集假就绪）。
4. **瞬时/未知失败不终态**：新增 `classifyResource()`（conflict/absent/unknown/fatal），逐操作按上下文解释 ENOENT
   （owner.json 缺失=事实；可选 journal 表缺失=无发表证据；必需资源缺失=资源丢失）；ENOMEM/EIO/503
   `HOST_RESOURCE_EXHAUSTED`/`CAPABILITY_UNAVAILABLE` 一律 `deferred` 且传播真实类型；外层 catch 不再把所有
   409/ProductError 当 gate（只有原 gate 的 `PROJECT_ATTENTION_REQUIRED` 才是 `GATE_BLOCKED`）。
   adoption service 的 `#authorHoldsBase` 改为三态 `holds|differs|unknown`。
5. **已提交回放不能假成功**：`#verifyCommitted()` 删除 fallthrough；必须匹配合法 request+adoption+原 receipt，
   并核 `operation/request_digest/project_id/principal_id/idempotency_key/correlation_id`；principal 绑定
   **原执行授权** grant（由不可变 adoption execution 指定，不用项目当前 grant 替代历史）。不符 → `deferred(RECEIPT_NOT_REPLAYABLE)`，
   `revision=null`，不编造 Applied、不回退已 committed 的文件/指针。
6. **补代码与真正会失败的对应反例**：24 例（20 基础 + 4 补齐），旧候选字节、旧错误断言原文与其被反转的理由均保留
   （`candidate-v1/`、`R2/orca-restart-20261112/`、`PHASE_JOURNAL.md`）。外部未决 prepared 仍 `deferred(OTHER_PREPARED_PENDING)`，
   未改原 closedcommit 调绿。

另按 MAIN 只读审计补齐两处资源/关闭闭环：
- `#guard` 去掉构造成功后的多余 `verify()`（构造函数自身已 verify 并在失败时自清理），消除「已保留 guard 泄漏描述符」；
- `#uncertain` 变为**粘性项目拒绝**：某项目资源清理失败后，该项目后续恢复一律 `deferred(TRANSIENT_RESOURCE_ERROR)`
  （不假 attention、不重试原始 FD），当次已真实发生的 commit/abort 事实保留，失败信息在最终 `close()` 仍可见。

## 4. 实际命令、退出码与证据（全部经 `run-recorded.py`，前缀 `d10-business-*`）

cwd 恒为 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；每条命令与全部子进程终止后才进行下一步。

| 捕获 | argv | 实际 exit | 结果 |
|---|---|---|---|
| `d10-business-oldsel-001` | 旧源 + 选中两条 | 1 | **failed_setup**（FK）——见 §5 |
| `d10-business-oldsel-002` | 旧源 + 选中两条 | 1 | 真实断言失败（修 fixture 后） |
| `d10-business-repairedsel-003` | 修订源 + 选中两条 | 0 | 2 passed |
| `d10-business-repairedfull-004` | 修订源 + 完整恢复文件 | 1 | **failed_setup**（锁 CHECK）——见 §5 |
| `d10-business-repairedfull-005` | 修订源 + 完整恢复文件 | 0 | 20 passed |
| `d10-business-oldsel-006` | 旧源 + 中间测试文件 | 1 | 真实断言失败 |
| `d10-business-repairedsel-007` | 修订源 + 中间测试文件 | 0 | 2 passed |
| `d10-business-oldsel-007` | 旧源 + **最终**测试文件 | 1 | 真实断言失败（最终字节） |
| `d10-business-repairedsel-008` | 修订源 + 最终测试文件 | 0 | 2 passed |
| `d10-business-repairedfull-009` | 修订源 + 完整恢复文件 | 0 | **24 passed** |
| `d10-business-adoption-010` | 修订源 + 旧 50 例文件 | 0 | **50 passed** |

- 类型检查：`corepack pnpm exec tsc --noEmit`，实际 exit **0**（最终字节）。
- 旧源差分的两条失败均为**真实业务断言失败**（不是 setup/type/fixture）：
  marker-only 期望 `outcome:'attention'` 实得 `'aborted'`（旧实现补偿后中止）；
  tamper 期望事务状态 `'attention'` 实得 `'prepared'`（旧实现只返回标签）。
- 每次换入旧源只换 `created-source-recovery.ts` 一个文件（sha256 `702f9b34…`，与 observed.json 一致），
  换回后逐条断言四个 SHA256；最终四路径与 `candidate-v3/SHA256SUMS.txt` **逐字节相同**。
- 无 install、无下载、无网络、无 provider、无 J 盘、无付费、无 build、无浏览器、无全量 suite。

## 5. 两次 setup 失败（真实缺陷，已修，原日志保留）

1. `oldsel-001`：`cp_a0_prepared_authorization` 的 `FOREIGN KEY(project_id,transaction_id) REFERENCES project_transaction(...)`
   要求事务行先存在，而候选 fixture 先写授权、后 `beginTransaction` → `FOREIGN KEY constraint failed`。
   修正：把 `beginTransaction` 前移（不改 FK、不关触发器、不改旧 50 项、不减断言）。
2. `repairedfull-004`：新增锁 fixture 的 `lock_type:'timeline'` 违反真实 `LockType` 枚举
   （`visual|narration|duration`）→ `CHECK constraint failed`。修正为 `'visual'`（`scope:'project'` 本就合法），
   真实 active 锁阻断、补偿还原与零消费断言全部保留。
   **这两处说明该恢复测试文件此前从未真正跑通过。**

## 6. 候选目录覆盖事故与哈希核验恢复（如实披露）

补齐 MAIN 审计的 3 处缺口后，我曾把修订字节**同名覆盖**进 `candidate-v1/`，覆盖掉了捕获 005 的输入字节。
- 权威哈希来源：捕获自身的 `d10-business-repairedfull-005.inputs.json`（非我的记忆）。
- 恢复方式：以当时的交付记录为基准机械撤销冻结后的追加改动，再与权威哈希逐字节比对；
  `created-source-recovery.ts` → `0fa52f3c…` **完全一致**，`created-source-recovery.test.ts` → `76b00b70…` **完全一致**，
  四个文件全部与 `005.inputs.json` 交叉核对 MATCH。
- 处置：当前版本另存 `candidate-v2/`、`candidate-v3/`，各自独立 `SHA256SUMS.txt`；**不再覆盖任何历史候选**。
  过程记录见 `candidate-v1/PROVENANCE.md`。未做全机扫描、未读配置、未删除任何捕获日志。

## 7. 明确未做 / 不可声明

- **新服务未接入 Host**：没有 Host 装配、没有 `Host.listen` 专项恢复、没有 generic 排除接线、没有真实运行根独占证明。
  因此 **RCV-D10-10 NOT_RUN**，**RCV-D10-01..09 的业务闭环 NOT_RUN**，**A 阶段不通过**，无人验 PASS。
- **真实 SIGKILL / 进程丢失 / 物理断电 / 跨进程跨身份（inode 重建、迁移机具后 inode 改变）NOT_RUN**：
  本轮全部是同进程内的异常注入与真实文件/DB 操作，异常注入不是进程丢失证据。
- **真实合法后继提交的集成 NOT_RUN**：现有一条用例用「合成指针损坏」证明回执重放不依赖当前指针，
  该用例已如实标注为 *synthetic pointer-corruption independence*；它**不是**合法后继提交。
  合法后继（真实经 Coordinator/closed commit 产生较新 revision 后再重放旧回执并核验第二次提交所有事实不变）
  仍待统一验收，且当前四路径/现有 fixture 无法在不手改权威表的前提下构造。
- 原 closedcommit 在同项目存在其它未决 prepared 行时以 `CREATED_COMMIT_OTHER_TRANSACTION_PENDING` 拒绝，
  本实现**不绕过**该条件，保留真实 `deferred`，该产品处置仍需 MAIN 裁决（需公共合同变更，不在本轮可写路径）。
- 未改 Publisher / RecoveryFiles / RevisionStore / Coordinator / Host / CreationApplication / 合同 / DDL / 路由 /
  依赖 / 配置 / 其他测试；未启用任何路由；未自签独立外审、未自签人验、未自签整轮 PASS。

## 8. 恢复方式与交接

- 当前工作树即最终候选（4 路径），未暂存未提交，等 BRIDGE/MAIN 冻结。
- 回退：`git checkout -- src/host/agent-driven/created-source-adoption-service.ts
  tests/agent-driven/integration/created-source-adoption.test.ts` 并删除
  `src/host/agent-driven/created-source-recovery.ts`、`tests/agent-driven/integration/created-source-recovery.test.ts`。
- 证据：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/d10-business-*.*`（11 组捕获，含全部原始
  exit、日志与输入哈希）+ 本目录 `PHASE_JOURNAL.md` / `candidate-v1..v3/`。
