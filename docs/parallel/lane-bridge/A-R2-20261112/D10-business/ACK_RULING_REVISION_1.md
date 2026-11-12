# ACK：MAIN 首轮修订批次（6 条）— D10 业务恢复实现

发给监督者：BRIDGE dispatch `ctx_582d083346ef`；抄送 MAIN（run_399f9dd3ce5a）。
本文件是 ACK 正文留档，与 Orca `send` 的 body 同文。

## 身份 / 宿主核对（任何写入之前完成）

- task_id=`task_e115789b4321`，dispatch_id=`ctx_283c06941e68`，run_id=`run_399f9dd3ce5a`，
  我的 terminal=`term_213a3d1a-768d-4c87-afe7-55a7e3edfc3b`（state=ready / stage=input_accepted /
  liveness=live / terminalState=retained）。
- cwd=`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，与 dispatch 的 workspace
  映射 `C:\workspace\videoworkline\Narralens-agents\main-integration`（wt2:local:3e906924-8c30-4dd8-bd81-cbebd88eb807）
  一致；平台 linux `6.18.40.1-microsoft-standard-WSL2`，hostname `WIN-IDGU3FG2NTF`。
- HEAD=`de438d17dfc777a9d113c7207b98e1923ab72e6c`，分支 `agent-driven/main-a-integration`。
- **无执行宿主/cwd 错配**，无需在写入前挂起。
- 冻结输入复算匹配：D10_CLAUDE_IMPLEMENTATION_TICKET.md=`4519f0ce1a8a8c389401ddb280755481ed3212ae39d6a07661281f19e63e22ca`，
  D10_CLAUDE_IMPLEMENTATION_RELEASE.json=`57d4403e9a7f8e30a7b7275fe5baa5e3f85f96df39830e03b7c8343ab0eed192`。

## 工作树状态（刻意 dirty，非基线污染）

dirty = 4 个授权路径（= `R2/orca-restart-20261112/observed.json` 记录的候选，二次读取一致）+ MAIN 保护的
`AGENTS.md` + 我自己的 `docs/parallel/lane-bridge/A-R2-20261112/D10-business/`。

| 路径 | SHA256（现读） | 与 observed.json |
|---|---|---|
| `src/host/agent-driven/created-source-recovery.ts` | `702f9b342ba82450c9c99000817732d2c13d4d408a046f32667e1cee044b3106` | 一致 |
| `src/host/agent-driven/created-source-adoption-service.ts` | `2471c2ee40cb7bb8ba21ca92b3629a020b3e3e7b03a61d69750b7af37554bde2` | 一致 |
| `tests/agent-driven/integration/created-source-adoption.test.ts` | `04eb25fa45efede7d101878d0c603d96b8947f377c49896dc3422a74ed644548` | 一致 |
| `tests/agent-driven/integration/created-source-recovery.test.ts` | `8862ecd70579ce413a4d67764969a9ad17810a1e652854275e207c04f9a8db9f` | 一致 |

`AGENTS.md` 为 MAIN 新增保护文件，我不会修改。未执行 git add/commit/reset/stash/push。

## 已读并 ACK 的文件

- `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/D10_MAIN_RULING_REQUEST_AND_DURABLE_RECOVERY.md`（全文）
- `.../R2/orca-restart-20261112/observed.json`（全文）
- 冻结票据 + release json（哈希复算）
- 根 `AGENTS.md` 最高 429 规则与 D10 写入前检查点

## 六条修订的 ACK（逐条复述我的理解）

1. **损坏/marker-only 请求绝不补偿或中止。** 合法校验必须前置到原队列内、且在任何受控动作之前：
   wrapper 恰为 `operation`+`input`、原 ApplyChange 校验、`contentDigest(input)`==原 `request_hash`、
   project/base/source/execution 逐项匹配，并与已存在的 adoption / prepared 授权逐项匹配。
   合法校验之前**不得**读 owner/source 路径、不得 inspect/move 资源、不得调用 Publisher。
   已被本 family 分类但损坏的请求：保全全部 source/backup/staging/snapshot，用**原 Coordinator 真实持久
   attention**，`reason=REQUEST_NOT_LEGITIMATE`；只允许增加 attention 事实，不消费批准、不改
   revision/pointer/impact/outbox/幂等/发表 journal。未知 kind/op 仍 `not_owned`。
2. **早期缺 fact 是独立分支。** 只有「完整合法原 request/hash/project/base/source + 真实 DB creation
   owner/origin + 确实无发表 journal/identity」同时成立，才可独立证明当前 author 与 committed 原
   base/owner 后走原 abort。若**已有发表证据**却无匹配 fact → 保全 attention（不 abort）。
   无 journal 从不单独证明作者未写；测试不得从另一个已 published target 的 fixture 假称原 source 未变。
3. **attention 必须真落原库，进展必须真来自原库。** `#result` 只是标签，不是持久决定；测试同时期待
   attention 又期待 prepared 是错规格。原 Coordinator 在队列内落 attention（并验证 transaction/project gate）；
   `recoverOnStart` 的 progress 只能统计**观测到的原 DB 终态变化**，不得按返回标签累加而对同一 prepared
   无限循环；attention/recovering 必须出现在 `unresolved_transaction_ids`，不得返回空集假就绪；终态绝不复活。
4. **瞬时/未知失败不终态。** `#proveOriginalHeld`/`#guard`/`#proveOwner` 的 catch-all 不得把
   ENOMEM/EIO、现有 503 `HOST_RESOURCE_EXHAUSTED`、cleanup 不确定变成「不符证据」；必须传播真实类型并
   defer/reconciliation，保全 prepared 与文件；只把**已证**身份/内容冲突判为 attention。不得默认所有
   409/ProductError 都是 gate；journal 读取除**确证**无表/无行外，不得把 I/O/坏 schema 吞成空。
5. **已提交回放不能假成功。** `#verifyCommitted` 在没有匹配合法 request/fact/owner/原 receipt 时，
   **不得** fallthrough 报告 `already_committed` 与 `base+1`；必须严格验证原同 key/digest/transaction/
   principal/Applied，缺失或损坏只能诚实拒绝/待核对：不回退已 committed 的文件/指针，不编造 Applied 或
   revision。真实历史 receipt 可在后续合法 commit 存在时复读，不把旧 target 当 current author。
6. **补代码 + 真正会失败的对应反例，并保留旧候选/错误断言及失败捕获。** 确切外部未决 prepared 仍
   defer；不改原 closedcommit 来调绿。裁决文末另要求：测试必须同时核对完整文件字节+身份，以及
   状态/批准/impact/revision/pointer/step/outbox/幂等，不能只验返回标签。

本裁决**优先于原候选中的错误测试预期**，并优先于原冻结票据中与之冲突的条款。

## 候选中与之对应的实际缺陷（我的定位，待修）

- `created-source-recovery.ts#recoverPrepared`：request 合法性算出来了却没用；非 published 布局直接
  compensate+abort ⇒ 违反第 1 条（损坏请求被补偿并中止）。
- `#recoverPrepared`/`#abortUnpublished`：owner/source 路径读取与资源 inspect 早于合法校验 ⇒ 违反第 1 条前置。
- 全部 `attention` 分支只 `return #result(...)`，从未调用原 Coordinator 落库 ⇒ 违反第 3 条；
  且 `recoverOnStart` 按返回标签累加 progress ⇒ 同一 prepared 行会无限循环。
- `recoverOnStart` 的 `pending` 只含 ABORTABLE，`attention`/`recovering` 行会从 `unresolved` 消失 ⇒ 假就绪。
- `#proveOriginalHeld`/`#guard`/`#proveOwner`/`#journalPhases` 全是 catch-all ⇒ ENOMEM/EIO/坏 schema 被吞成
  「不符证据」或空 journal ⇒ 违反第 4 条；`isTransientResourceError` 对所有 ProductError 一律 false，
  503 `HOST_RESOURCE_EXHAUSTED` 不会被 deferred。
- `#recover` 的 catch 把 `REVISION_CONFLICT` 一律当 `GATE_BLOCKED` ⇒ 违反第 4 条「不得默认所有 409 都是 gate」。
- `#verifyCommitted` 末尾 fallthrough 直接报 `already_committed` + `base_revision+1` ⇒ 违反第 5 条（假成功）。
- `#recoverPrepared` 无 adoption 时直接走 abort 路径，未区分「已有发表证据却缺 fact」⇒ 违反第 2 条。
- `created-source-adoption-service.ts#authorHoldsBase` catch-all ⇒ 瞬时错误被吞成「不符证据」⇒ 第 4 条。

## 修复计划（仅在获授权的 4 路径内）

- `created-source-recovery.ts`
  - A1 请求合法性前置并成为闸门；不合法 ⇒ 原 Coordinator 持久 attention(`REQUEST_NOT_LEGITIMATE`)，
    不补偿、不中止、不消费批准、不改 revision/pointer/impact/outbox/幂等/journal。
  - A2 「早期缺 fact」独立分支：有发表证据无匹配 fact ⇒ attention；无发表证据 + 完整合法 request ⇒
    才走独立证明后的原 abort。
  - A3 新增真实持久 attention 写入（原 `host.coordinator.attention`），替换所有仅标签的 attention。
  - A4 `recoverOnStart` 进度改为观测 DB 状态变化；attention/recovering 计入 unresolved；不再假就绪。
  - A5 瞬时/未知分流：ENOENT 确证缺失 ⇒ attention；其它 IO/ENOMEM/503 ⇒ deferred 并传播真实类型；
    journal 仅在确证无表/无行时为空；REVISION_CONFLICT 不再一律 GATE_BLOCKED。
  - A6 `#verifyCommitted` 去掉 fallthrough 假成功 ⇒ 诚实拒绝/待核对，无 revision。
- `created-source-adoption-service.ts`
  - B1 `#authorHoldsBase` 改三态（holds / not_holds / unknown）；unknown（瞬时）⇒ 不 abort、保全 prepared、
    保留原错误类型。
- `tests/agent-driven/integration/created-source-recovery.test.ts`
  - C1 **反转两处被裁决判为错规格的旧断言**：marker-only 用例（旧：aborted + 补偿还原）⇒ 新：attention +
    state `attention` + 项目 attention + source/backup/staging/snapshot 保全 + 批准仍 active + revision/pointer
    不变 + journal/outbox/幂等 无新增；篡改用例（旧：attention 且 prepared）⇒ 新：attention 真落库。
  - C2 新增**对旧候选真实失败**的反例：损坏 request 在 published 布局不补偿不中止；attention 真落库
    （project_transaction.state + project_state.attention + attention_reason）；progress 来自 DB 终态变化、
    attention 计入 unresolved 且非空集假就绪；瞬时 EIO/ENOMEM 不产生终态且 prepared 保全；503
    `HOST_RESOURCE_EXHAUSTED` ⇒ deferred；有发表证据但缺 adoption fact ⇒ attention 不 abort；
    receipt 缺失/损坏 ⇒ 诚实拒绝、不报 `already_committed`+base+1、不改 revision/pointer。
  - C3 旧候选字节、旧错误断言与失败捕获留档于本目录（并标注被裁决反转），不删除。
- `tests/agent-driven/integration/created-source-adoption.test.ts`：保留旧 50 例与其期望不变。

## 计划命令（实际 argv）

允许范围内（无需新 grant）：
- `corepack pnpm exec tsc --noEmit`（cwd=`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`）

需要**新的明确 MAIN grant**（重型：每 case 一个真实 `NarralensHost` + 真实 SQLite + 真实文件 + 每 case 两次
`ffmpeg` 生成诊断媒体；`vitest.config.ts` 已固定 `maxWorkers: 1`；无浏览器/GPU/Comfy/provider/网络/下载/J 盘/付费）：
- `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-source-recovery.test.ts`
- `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-source-adoption.test.ts`

## 需要裁决的两个精确问题

1. 上述两条 vitest argv 的**新明确重型 grant**（重启后资源已暂停，我已停止一切重型运行）。
2. 「新反例在旧候选上真实失败」的失败捕获方式二选一（我倾向 A，不触碰授权工作树的 src/tests）：
   - **A（建议）**：在授权目录**之外**建临时副本（例如 `/tmp/d10-ab-<ts>`），复制本仓库（排除
     `node_modules`/`.git`）并链接 `node_modules`，把 `R2/orca-restart-20261112/` 归档的**旧候选**
     放回其 4 路径、保留**新测试文件**，跑同一条 argv 捕获真实失败输出；工作树 src/tests 全程不动。
     该临时副本是新增 helper 路径，需要 MAIN/BRIDGE 批准其精确路径。
   - B：在工作树内临时换回旧候选再换回（需 hash 复核还原）；与「保全候选、不得覆盖」冲突，风险更高。

## 停止条件

本会话未出现 429。出现即按 AGENTS 最高 429 规则停工、保全源码/dirty/日志/证据并上报，不自动重试、不重启
旧窗口、不换供应商或凭据、不让 Codex/MAIN 未经用户显式授权接手。本实现不自签独立外审、不自签人验、
不自签业务恢复门或 A 阶段 PASS。
