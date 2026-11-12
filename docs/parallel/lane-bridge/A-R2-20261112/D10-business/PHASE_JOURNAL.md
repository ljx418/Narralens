# D10 业务恢复：修订批次 1 阶段日志（唯一写入者 = 本 Claude 会话）

task_id=`task_e115789b4321`，dispatch_id=`ctx_283c06941e68`，run_id=`run_399f9dd3ce5a`，
terminal=`term_213a3d1a-768d-4c87-afe7-55a7e3edfc3b`。
授权：`R2/D10_BUSINESS_REAL_TEST_GRANT_002.json`（grant_id=`R2-BRIDGE-D10-BUSINESS-REAL-002`，holder=本 ctx）。
不可变输入：D10_CLAUDE_IMPLEMENTATION_TICKET.md=`4519f0ce1a8a8c389401ddb280755481ed3212ae39d6a07661281f19e63e22ca`，
D10_CLAUDE_IMPLEMENTATION_RELEASE.json=`57d4403e9a7f8e30a7b7275fe5baa5e3f85f96df39830e03b7c8343ab0eed192`，
裁决 `R2/D10_MAIN_RULING_REQUEST_AND_DURABLE_RECOVERY.md`（全文已读，ACK=msg_1ce1302f1ac5）。

## 阶段 1：修订实现（已完成）

只写 4 个授权路径。未执行 git add/commit/reset/stash/push。`AGENTS.md`（MAIN 保护）未改。

| 路径 | 修订前 SHA256（= observed.json 的旧候选） | 修订后 SHA256 |
|---|---|---|
| `src/host/agent-driven/created-source-recovery.ts` | `702f9b342ba82450c9c99000817732d2c13d4d408a046f32667e1cee044b3106` | `0fa52f3c75d2f8704af7ed507eeb369b3e195356b56a39a0841f98355cd1f7fe` |
| `src/host/agent-driven/created-source-adoption-service.ts` | `2471c2ee40cb7bb8ba21ca92b3629a020b3e3e7b03a61d69750b7af37554bde2` | `9e140f5887b6e8ad5f406517504043ade1eaaa9df8978fee8a2d99d82c46ddb7` |
| `tests/agent-driven/integration/created-source-adoption.test.ts` | `04eb25fa45efede7d101878d0c603d96b8947f377c49896dc3422a74ed644548` | `04eb25fa45efede7d101878d0c603d96b8947f377c49896dc3422a74ed644548`（未改：旧 50 例与其期望原样保留） |
| `tests/agent-driven/integration/created-source-recovery.test.ts` | `8862ecd70579ce413a4d67764969a9ad17810a1e652854275e207c04f9a8db9f` | `edcb64202e417df810f8fe20a371be3ccb80e8ad0f9e90d95897f601726d2ab9` |

修订后字节副本：`candidate-v1/*.v1` + `candidate-v1/SHA256SUMS.txt`（本目录内，重启后可原样还原）。
旧候选字节仍在 `R2/orca-restart-20261112/1-created-source-recovery.ts.source.txt`（sha256=`702f9b34…`，与 observed.json 一致，未被本次改动触碰）。

### 逐条裁决 → 代码改动

1. **损坏/marker-only 请求绝不补偿或中止。**
   新增 `#legitimacy(row)` 作为**唯一闸门**，在 `#decision()` 内、任何受控路径读取之前执行：
   wrapper 恰为 `operation`+`input` → 原 `validateAgentDefinition('ApplyChange')` → `contentDigest(input)===row.request_hash`
   → project/base 匹配 → 有 adoption fact 时逐项匹配 `impact_id/approval_id/execution`，并由 `#plan()`+`#authorizationMatches()`
   匹配 `cp_a0_prepared_authorization` 的 `project_id/run_id/approval_id/facts_digest`。不合法 → `#attention(REQUEST_NOT_LEGITIMATE)`：
   **不读 owner/source 路径、不 inspect/move 资源、不调用 Publisher、不补偿、不中止**；只由原 `coordinator.attention()` 增加 attention 事实。
   旧代码在 `#recoverPrepared` 里算出 `#legitimateRequest` 却从不使用，非 published 布局直接 `compensate+abort`——该缺陷已消除。
2. **早期缺 fact 是独立分支。**
   `#recoverPrepared` 在 `adoption` 缺失时先查 `#publicationEvidence()`（发表 journal + publication identity）：
   有发表证据却无匹配 fact → `attention(IDENTITY_NOT_PROVABLE)`（保全，不中止）；
   无发表证据 → 才走 `#abortUnpublished()` 的独立证明分支（真实 DB creation owner/origin + committed 原 base + 当前 author 完整闭包）。
   另：原 request 的 `source_digest` 必须等于 committed base 的 source digest，否则 `REQUEST_NOT_LEGITIMATE`。
3. **attention 必须真落原库，进展必须真来自原库。**
   新增 `#attention()`：`host.coordinator.attention(transactionId,'CREATED_SOURCE_RECOVERY_ATTENTION',reason,now)`
   → `project_transaction.state='attention'` + `project_state.attention=1` + `attention_reason=<机器令牌>`。
   `recoverOnStart()` 的 progress 改为**观测原 DB 状态变化**（前后 state 快照 diff，DECIDED=committed/aborted/attention），
   不再按返回标签累加；`unresolved_transaction_ids` 含 attention/recovering；`stopped` 与 MAIN 三族 scheduler 同语义
   （全部 DECIDED 才是 `decided`），不再出现空集假就绪。
4. **瞬时/未知失败不终态。**
   新增 `classifyResource()`：`conflict`（实际模块证明冲突）/ `absent`（**按操作/上下文分别解释**）/ `unknown`（机器）/ `fatal`（编程错误，原样抛出）。
   `#proveOwner`（owner.json ENOENT=缺失事实；其它=unknown）、`#sourceFact`（DB 读错=unknown；事实损坏=refused）、
   `#plan`、`#journalPhases`（**仅确证无表时返回空**；I/O/坏 schema→unknown）、`#proveOriginalHeld`、`#guard`、`#rights`、
   `#authority` 全部改为分流。`ProductError('HOST_RESOURCE_EXHAUSTED'/'CAPABILITY_UNAVAILABLE')` 与 ENOMEM/EIO 等一律
   `deferred`（保留 prepared 与文件），不再是「不符证据」。外层 catch 不再把所有 409/ProductError 当 gate：
   只有原 gate 的 `PROJECT_ATTENTION_REQUIRED` 才是 `GATE_BLOCKED`；逃逸的 `REVISION_CONFLICT` 记 `PUBLISHED_NOT_PROVABLE`（未决）。
   `created-source-adoption-service.ts#authorHoldsBase` 改为三态 `holds|differs|unknown`，瞬时错误不再被当成「作者不持有原闭包」。
5. **已提交回放不能假成功。**
   `#verifyCommitted()` 删掉末尾 fallthrough（原本无条件报 `already_committed` + `base_revision+1`）。
   现在必须匹配合法 request+adoption+原 receipt（同 key/digest/transaction/principal/`Applied`）才返回 `already_committed`；
   缺失或损坏 → `deferred(RECEIPT_NOT_REPLAYABLE)`、`revision=null`，**不编造 Applied、不回退已 committed 的文件/指针**。
6. **补代码 + 真正会失败的对应反例，保留旧候选/错误断言及失败捕获。**
   新增/改写用例见下节；旧候选字节、旧错误断言与其被裁决反转的理由都保留在本目录
   （`candidate-v1/` 存修订后字节；旧候选存于 `R2/orca-restart-20261112/`；被反转的旧断言原文摘录于下文）。
   确切外部未决 prepared 仍 `deferred(OTHER_PREPARED_PENDING)`，未改原 closedcommit 来调绿。

### 被裁决反转的两处旧断言（原文保留）

- 旧：`expect(result).toMatchObject({outcome:'aborted',reason:'REQUEST_NOT_LEGITIMATE'})` + `state==='aborted'`
  + `expect(await readFile(f.authorRoot,'film.html'))).toEqual(f.authorBytes)`（补偿还原）。
  新：attention + 真落库 + 文件字节与 inode 均不变（不补偿）。
- 旧：`expect(result.outcome).toBe('attention')` + `expect(state).toBe('prepared')`（只返回标签）。
  新：outcome=attention 且 `state==='attention'`、`project_state.attention=1`。

### 类型检查

`corepack pnpm exec tsc --noEmit`，cwd=`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，**实际退出码 0**。
无 install、无下载、无网络、无 provider、无 J 盘、无付费。

## 阶段 2：冻结（已完成）

- 4 个授权路径的 SHA256 如上表；字节副本在 `candidate-v1/`。
- 旧候选字节：`R2/orca-restart-20261112/1-created-source-recovery.ts.source.txt`（sha256 `702f9b34…`）。
- 本阶段无编译器/测试/捕获进程在运行。

## 阶段 3：旧源差分捕获

### 3a. 第一次捕获 `d10-business-oldsel-001` —— **failed_setup（已保留，不重写）**

- 捕获名：`d10-business-oldsel-001`（证据：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/d10-business-oldsel-001.*`）。
- 实际退出码：**1**；`source_changed=[]`、`source_added=[]`；log sha256=`18d81cfaaf6f44e9a178de2dc8c7ebd8675bf9d130e25883eec192d5c299b927`。
- 换入的旧源 sha256=`702f9b342ba82450c9c99000817732d2c13d4d408a046f32667e1cee044b3106`（44891 字节，与 observed.json 一致）。
- **结果不是业务断言反例，而是 setup 失败**：两条选中用例都在 fixture 内报
  `Error: FOREIGN KEY constraint failed`（`ProductSqliteRepository.insert`，`tests/…/created-source-recovery.test.ts:93`）。
- **根因（真实缺陷，位于候选的 fixture）**：`cp_a0_prepared_authorization` 的建表语句含
  `FOREIGN KEY(project_id,transaction_id) REFERENCES project_transaction(project_id,transaction_id)`
  （`contracts/agent-driven-a.migration.sql:138`）。候选 fixture 先写 `prepared_authorization`、**之后**才
  `revisions.beginTransaction(...)`，违反外键。旧 50 例的 fixture 顺序是对的（先 `beginTransaction` 后写授权），
  所以该缺陷此前从未暴露。这说明该恢复测试文件**从未真正跑通过**。
- 处置（MAIN msg 指示，同一四路径 release 内修正）：不改 FK、不关触发器、不改旧 50 例期望、不减断言；
  只把 `revisions.beginTransaction(...)` 移到 `prepared_authorization` 之前，marker-only 用例的「无合法请求事实」
  与 tamper 用例的完整前态保持不变。
- 换回后已断言恢复：`created-source-recovery.ts` = `0fa52f3c…`（见上表），其余三路径 hash 未变。

### 3b. fixture 修正后的重新冻结

- `tests/agent-driven/integration/created-source-recovery.test.ts` sha256 由 `edcb64202e417df810f8fe20a371be3ccb80e8ad0f9e90d95897f601726d2ab9`
  变为 `641312e5a9ed7f8f3ae3a23ec5224713a4601ebb216cde74aad71053ee572fe8`（唯一改动 = fixture 中 `beginTransaction` 的位置）。
- `corepack pnpm exec tsc --noEmit` 实际退出码 **0**。
- 字节副本已更新到 `candidate-v1/`；四个 SHA256 见 `candidate-v1/SHA256SUMS.txt`。

### 3c. 第二次旧源差分捕获 `d10-business-oldsel-002` —— **有效反例（真实断言失败）**

- 捕获名：`d10-business-oldsel-002`（证据同目录 `d10-business-oldsel-002.*`）。
- 换入的旧源 sha256=`702f9b342ba82450c9c99000817732d2c13d4d408a046f32667e1cee044b3106`；实际退出码 **1**；
  `source_changed=[]`、`source_added=[]`；log sha256=`2fa63fda6b592403c53f2267be70ac558a5176c5ae9f2525f77ec816b4a30c65`。
- 两条选中用例均为**真实断言失败**（非 setup/type/fixture）：
  - marker-only：期望 `outcome:'attention'`，实际 `'aborted'`（旧实现补偿后中止）；
  - tamper：期望事务状态 `'attention'`，实际 `'prepared'`（旧实现只返回标签）。
- 换回后断言：`created-source-recovery.ts` = `0fa52f3c…`，其余三路径 hash 未变。

### 3d. 修订源运行（捕获 `d10-business-repairedsel-003`）

- 同一 argv 在修订源上：实际退出码 **0**，`Tests 2 passed | 18 skipped`；log sha256=`dd9da8330a8b56d5020a5d6b7ac4a1458a7ad009f595546af9ddf821f305a686`。

### 3e. 完整恢复文件第一次（捕获 `d10-business-repairedfull-004`）—— **failed_setup（保留）**

- 实际退出码 **1**；`Tests 19 passed | 1 failed`；log sha256=`10364619ca1de993ce7264fd4aaed08cd1aa2762aa474b285783ecbb69015133`。
- 唯一失败**不是业务断言**，而是新增锁 fixture 违反真实锁合同：
  `CHECK constraint failed: lock_type IN ('visual','narration','duration')`（`revision-store.ts:1527`）。
- 修正（同一 4 路径 release 内，不改 DDL/锁服务/旧 50 项）：`lock_type` 由非法值 `'timeline'` 改为真实
  `LockType` 的 `'visual'`，`scope:'project'` 已是真实 `LockScope`；其余字段与 `upsertLock` 签名一致。
  真实 active 锁阻断、补偿还原、零消费断言全部保留。
- 修正后 `tsc --noEmit` 实际退出码 **0**，重新冻结。

### 3f. 完整恢复文件第二次（捕获 `d10-business-repairedfull-005`）—— 通过

- 实际退出码 **0**，`Tests 20 passed (20)`；log sha256=`ae660ef28a802e69ccd88007a34b22c3712c2ac628d65078e34a7abfd3338003`。

## 阶段 3g：MAIN 只读审计提出的 3 处闭环缺口（同一批次内补齐）

1. `#verifyCommitted` 过去只核 `operation/request_digest/project_id`。现补核
   `principal_id`（绑定**原执行授权** grant 的 principal，由不可变 adoption execution 指定，
   不用项目当前 grant 替代历史）、`idempotency_key`（原 `input.meta`）、`correlation_id`（原事务行）；
   任一不符 ⇒ `deferred(RECEIPT_NOT_REPLAYABLE)`，无 revision、无写入。
   对应反例：错 principal / 错 key / 错 correlation 三种真实回执篡改均被拒且无副作用；
   合法回执在**后来提交成为当前 author** 之后仍可重放（不把旧 target 当 current author）。
2. `#guard` 过去在 `new RetainedSourceTree` 成功后又 `guard.verify()`；该二次 verify 抛错时
   catch 未关闭已保留的 guard → 描述符泄漏。现**去掉多余的二次 verify**（构造函数自身已 verify 并在失败时自清理），
   清理失败不被吞（构造函数的 `PublicationCleanupError` 原样抛出）。
   对应反例：注入“构造后失败”的 verify，断言只验证一次且 `/proc/self/fd` 数量不增长。
3. `#uncertain` 过去只在 finally 写入、只在 close 读取，恢复入口不拒绝同项目后续工作。
   现**粘性拒绝**：某项目资源清理失败后，该项目后续恢复一律 `deferred(TRANSIENT_RESOURCE_ERROR)`
   （不是假 attention，也不重试原始 FD），而当次**已经真实发生的 commit/abort 事实保留**；
   失败信息在最终 `close()` 仍可见（`PublicationCleanupError`）。
   对应反例：注入一次 release 失败 ⇒ 当次提交仍为 `committed`；同项目下一条事务 `deferred` 且状态未变；close 仍抛。

- 补齐后重新冻结：`created-source-recovery.ts` = `eb980288feb888a743475d185c1e34df3a67313d69dc2bb772e1eb9d13bfd1b5`，
  `created-source-recovery.test.ts` = `20232b07161becbe1d1c5fd3484190574c7a766f2864175bb5a797386981edc6`，
  `created-source-adoption-service.ts` = `9e140f5887b6e8ad5f406517504043ade1eaaa9df8978fee8a2d99d82c46ddb7`（本轮未再改），
  `created-source-adoption.test.ts` = `04eb25fa45efede7d101878d0c603d96b8947f377c49896dc3422a74ed644548`（旧 50 例未改）。
- `corepack pnpm exec tsc --noEmit` 实际退出码 **0**。

## 阶段 3h：最终捕获序列（全部完成）

| 捕获 | argv | 实际 exit | 结果 | log sha256 |
|---|---|---|---|---|
| `d10-business-oldsel-007` | 旧源（`702f9b34…`）+ **最终**测试文件的两条选中用例 | **1** | 真实断言失败：marker-only 期望 `attention` 实得 `aborted`；tamper 期望状态 `attention` 实得 `prepared` | `92d314bfb96cc5e1eefc26721919d6deb8282f2bf961bf0d8fb453573e84b176` |
| `d10-business-repairedsel-008` | 修订源 + 同两条选中用例 | **0** | `Tests 2 passed \| 22 skipped (24)` | `a88ea1383665953afb8027467995d85999a6a2f94bf08b0dd5f8c61f69f70e32` |
| `d10-business-repairedfull-009` | 修订源 + 完整 `created-source-recovery.test.ts` | **0** | `Tests 24 passed (24)` | `e94a5977b69a9bf3111a299513aa96704571ca6fb005c8c08bd019bf42d0630b` |
| `d10-business-adoption-010` | 修订源 + 完整 `created-source-adoption.test.ts`（旧 50 例） | **0** | `Tests 50 passed (50)` | `9d6147989d60a80adc27937b6b2d5127fa770e6b3ad52507add8738cbcac733d` |
| `d10-business-tsc-011` | `corepack pnpm exec tsc --noEmit`（全输出记录） | **0** | 输出 0 字节（空文件标准 sha256 `e3b0c442…`） | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

- 所有捕获的 `source_changed=[]`、`source_added=[]`（捕获期间无源写入）。
- 每次换入旧源只换 `created-source-recovery.ts` 一个文件；换回后逐条断言四个 SHA256。
- **最终四路径与 `candidate-v3/SHA256SUMS.txt` 逐字节相同**：
  `eb980288…` / `9e140f58…` / `04eb25fa…` / `38bf3a46…`。
- 全部历史捕获（001…011）原日志一律保留，未覆盖、未删除。

## 阶段 4：自有 fixture 清理与进程终止

- 全部 11 组捕获的 runner 与 vitest 子进程均已终止（捕获后 `ps` 复核：只剩本 Claude 进程）。
- 测试 fixture 自身在 `afterEach` 中关闭 Host/worker/registry/publisher/recovery 并删除临时根；
  工作树无残留：`git status` 仅剩授权的 4 路径、自有 `D10-business/` 目录、MAIN 保护的 `AGENTS.md`，
  以及 grant001/002 授权落在 MAIN 文档目录的 66 个捕获产物文件。
- 重建用的临时副本（`/tmp/d10-recon`）在哈希核验通过后已删除。

## 阶段 5：交回

- 交回 4 个路径与 `src/tests/tools/index`；`grant002` 可释放。
- 不自签独立外审、不自签 Host 生产接线、不自签 A 通过。
- 未做：Host 装配（RCV-D10-10 NOT_RUN）、真实 SIGKILL/进程丢失、真实合法后继提交集成（合成指针用例已如实标注）。

## 阶段 4：修订源运行（待执行）

1. 同一 argv 在修订源上跑（应 PASS）；
2. 整文件 `created-source-recovery.test.ts`；
3. 整文件 `created-source-adoption.test.ts`（旧 50 例回归）。
串行执行，每条命令与全部子进程终止后再进行下一步。

## 阶段 5：清理与释放（待执行）

- 断言源与测试 SHA256 回到阶段 2 的值；记录全部原始 exit/日志与 SHA256；向 BRIDGE 汇报起止与释放。
