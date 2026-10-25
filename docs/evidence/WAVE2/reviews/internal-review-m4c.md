# M4C 四视角内部审查

状态：`BLOCKER=0 / MAJOR=0 / MINOR=6`。本结论只支持 `M4C_INTERNAL_EVIDENCED`；独立外审仍为 `REVIEW_PENDING`。

审查对象：`src/host/history/`（`HistoricalSnapshotResolver`、`HistoryRestorePlanBuilder`、`HistoryStore`、
`HistoryCommandTranslator`、`RestorePlanner`、`HistoryService`）、OpenFilm adapter 的 restore 分支、生产 Host 路由与装配、
`RevisionStore.commitHistoryRestore/abortHistoryRestore`、impact 的 restore arm、`history_restore_fact`、
M4C 合同与测试。基线为已通过外审的 M4B（`4d85cbd`…`25df0cb`，第十轮外审 `M4B_EXTERNAL_REVIEW_PASS`）；
没有改写 Wave 1/M3/M4A/M4B 历史证据。

四个视角由实现会话本人逐条走查，并各自写成可被外部复现的断言；本会话**不是**四个独立上下文，
四个独立上下文的尝试被账户用量上限拒绝（429）。M4C 的独立外审仍是 Codex 复核点，本文件不替代它。

## 1. 架构与合同

- 写入口只有 `/api/migration/v1/projects/:id/history/restore`，只接受 `RestoreRequestV1`；`history/undo`、`history/redo`
  只返回 typed intent，不写任何东西；`history` 是只读模型。
- 十二条冻结合同逐条成立：结果 snapshot id 复用目标的内容地址（`history-service.ts` 用
  `published.snapshot_id !== context.target.snapshot_id` **证明**而不是假设）；恢复只做 revision +1，pointer 不回拨；
  目标必须同项目、已 committed、在盘且可证；impact 携带真实 `HistoryRestorePlanV1.plan_sha256`；差异分类到
  visual/narration/duration/consumer，未知差异 422；`EnginePort` 仍恰好七方法；adapter 只 stage/validate；
  `project_transaction.state` 仍是唯一状态机，`history_restore_fact` 无 state 且有 UPDATE/DELETE trigger；
  `commitHistoryRestore` 一个 `BEGIN IMMEDIATE` 完成 revision+1、impact consumed、snapshot/projection 精确
  insert-or-verify、active pointer、outbox、幂等响应与事务 committed；同 kind/key/digest 完整重放、异 digest 409、
  adopt 与 restore 的 key 空间分离；undo/redo 只翻译；prepared 前取消丢弃晚到结果、prepared 后收敛。
- 单一权威：一条 SQLite、一条 revision 刻度、一条时间线、一张 `operation_idempotency`、一张
  `openfilm_projection_fact`。M4C 没有引入第二份 authority：`history_restore_fact` 无 state 列，只是事实。
- 合同三件套同提交移动：`ControlledWriteFailureResponseV1.operation` 扩为封闭枚举、`affected_ranges` 改为
  conditional、新增 `history.schema.json` 与 `history-intent.schema.json`，schema 与 TypeScript type 与 validator 同步。
- 路径、adapter 类名与 SQLite 文案没有进入任何响应体；`RestoreEnginePlanIntent` 不带路径，只带目标的字节与相对 root。

结论：无 BLOCKER/MAJOR。

**MINOR-1**：`history_restore_fact` 在 ADR-W2.0-006 D-06 的 DDL 之外多了五个事实列
（`project_id`、`impact_id`、`impact_hash`、`rights_digest`、`required_locks_json`）。它们是事实而不是权威
（没有状态、没有路径、没有 request body），代码里写明了理由；D-06 禁止的是绝对路径、request body 与状态枚举进入 fact。

## 2. 实现、并发与恢复

- 步骤顺序与 gate §4 一致，每一步的前提在下一步假设它之前确立：replay/conflict → 当前项目 → impact →
  gateway 翻译 → 重建 plan 并比对 hash → 锁 → transaction → stage → validate → publish → prepare →
  最终重查 → 发布作者源 → 证明 active source → 一次提交。
- 原子性：数据库侧全部在一个 `BEGIN IMMEDIATE`；发布侧复用 M4B 已验证的 publisher 算法（临时 token、同目录 rename、
  fsync），未放宽。
- 崩溃矩阵逐一有 seam 与断言：发布前六个边界重启后收敛为 aborted + revision +0 且 stage/temp 清理；
  发布后崩溃收敛为唯一一次 commit + revision +1；prepared 之后、发布之前崩溃仍然 abort +0。
- 并发：同项目由 `ProjectOperationQueue` 串行；未终结 restore 的接管先比较 request digest 再决定接管/冲突/新尝试；
  两个专用恢复按 transaction created_at 串行——较年轻的 restore 行在较年长的受控行仍 pending 时被 defer，
  由第二次 history recovery pass 决定。

审查期间发现并已闭环：

1. **恢复路径重建不出 plan。** 发布之后 current source 已经就是 target，此时重建 plan 必然是空差异并被 builder 拒绝，
   于是恢复会 latch terminal attention 而不是完成提交。改为：恢复**不重建 plan**，而是证明 target 自身的事实
   （归属、committed、字节、rights）并核对 impact 的 `native_plan_sha256` 与不可变 fact 的 `restore_plan_sha256` 相同；
   锁的作用域由 fact 记录。
2. **projection fact 的盲插。** M4C 让「恢复后再采用同一份 materialization」这条用户路径可达，而内容寻址使第二次采用
   得到同一个 snapshot id，fact 已存在，盲插触发主键冲突、整个提交回滚、项目进入 terminal attention。两个 commit 现在都
   做「插入或逐字段验证」。
3. **两个专用恢复的顺序。** 较年轻的 restore 行若在较年长的 adoption 行之前决定，会把 revision 推走，使较年长的
   adoption 无法证明。加入 defer 规则与第二次 history recovery pass。

并发结果：同 key/digest 并发得到一个 commit 与逐字 replay；发布前重读 impact/rights/view/target 并重查锁；
锁检查先于 currentness 检查，因此 visual 锁以 `TARGET_LOCKED` 报告。

结论：上述问题均有会在旧实现失败的测试，无残留 BLOCKER/MAJOR。

**MINOR-2**：在线路径里 plan hash 的比对是**防御纵深**而非可达分支——只要 current 事实动过，impact 的 currentness
先失败（428），所以 plan hash 比对在当前流程里恒真。没有测试能到达它；这不是安全属性缺失（行为由 impact 的
currentness 钉住），但它意味着该行代码的「冗余」未被单独钉住。

**MINOR-3**：发布与提交之间的短窗口里，adapter 注册的 layout 已经是恢复后的 closure，而 committed 事实仍指向旧的
snapshot。M4B 的采用有同样的窗口；M4C 用 `useLayout` 让窗口尽量短，并用提交后的 `projections.forget()` 让下一次
`layoutFor` 从事实重建。

## 3. 完整体验与安全

- 自动化走完整生产路径：真实 migrate-copy → 三镜 materialization → impact → adopt → impact(restore) → restore →
  重启 → 重开 → 原生编辑 → 固定上游真实 render + 完整 decode（900 帧）。
- 恢复后仍是三个原生可编辑 clip（`shot-001/002/003`），改单镜时另外两镜 identity 不变；没有 flattened MP4。
- 全程 headless、静音、无窗口、无焦点抢占；仅 loopback；未读 `J:\`，未调用 provider、网络付费或外传。
- 客户端能断言的只有 id、base/source/control 与 impact 的 id/hash；不能提交 path、URL、shell 参数、rights 事实、
  impact 事实、revision 或锁作用域。跨项目与不存在同 404，orphan 与缺字节 fail closed。
- rights 以**当前**许可策略重算；narration 的豁免是事实豁免（迁移刻意不把旁白放进资产账本），不是洞。
- 声明上限：只到 `M4C_INTERNAL_EVIDENCED`。响应体、证据与文档里没有越界声明。

结论：无 BLOCKER/MAJOR。

**MINOR-4**：publisher 的两条拒绝文案此前写的是「M4B」，而 M4C 复用同一算法。已改为 operation-neutral 的
「a controlled write」，算法未放宽。

## 4. 测试与验收

逐 case 映射见 `docs/evidence/WAVE2/cases/m4c-cases.json`（20 条，每条指向直接证据）。冻结捕获执行 contracts、
M2.1、W2.0、M3、M4A、M4B、**M4C**、fitness、全量 check、生产 build、三个历史门、冻结向量重生成+比对、
独立 Python 实现与 credential scan；Wave 1/M4A current-tip integrity 因后续合法改码非零，日志原样保留。

**变异证明**（在副本上改坏生产代码，确认测试变红）：

| 被改坏的地方 | 期望 | 实测 |
|---|---|---|
| `commitAdoption` 改回盲插 projection fact | restore→再 adopt 变红 | 红（503，项目进入 attention）✓ |
| resolver 的 committed 判定恒真 | orphan 用例变红 | 红 ✓（用例已加强到「只有未 committed 这一条能拒绝它」）✓ |

冻结 restore-plan 向量：18 条（基础 + 每个字段的单点变异 + 乱序 + builder 产物），TypeScript 与独立 Python
实现逐字节一致；15 条单点变异全部改变 hash，乱序不改变。

回归面：M2.1/M2.2/M2.3/M3/M4A/M4B、legacy 路由、contracts、fitness 与生产构建在 M4C 之后全绿。
被 M4C 编辑过的既有断言只有三类，且每一处都写明了理由：路由表（阶段开启）、capability 表（受控路径新增）、
M4A 的 restore-intent 用例（从「能力未开启 422」改为「resolver 的 404」）——没有一处是删除或放宽。

结论：无 BLOCKER/MAJOR。

**MINOR-5**：本轮之前，孤儿用例被「没有 projection facts」这条更早的规则拒绝，因此 committed 判定没有被钉住；
用例已加强。plan hash 比对仍然不可达（见 MINOR-2）。

**MINOR-6**：M4B 的 manifest 生成器仍有第三份硬编码的预期失败集合（第十轮 M4B 外审 §11 记录）。本轮没有改它：
M4B 的证据已封存并通过外审，改动它会使封存证据与代码脱钩。该记录保留在 M4B 外审文件中。

## 5. 有界 MINOR / 声明限制

1. 恢复路径依赖不可变 fact 记录 plan hash 与锁作用域，而不是重建 plan；fact 丢失即 terminal attention，无人工 repair 工具。
2. 真实媒体只覆盖固定 900 帧短片，不代表长片吞吐、磁盘压力或生产 render route。
3. M4C 只支持「同一 clip identity 与 track topology、差异落在 src/time/overrides」的快照；clip 增删、换轨、未知字段
   一律 422 fail closed。这是范围限制，不是被推迟的工作。
4. headed/human 为 `NOT_RUN`；M4C 后端用户路径成立，但不是 M5 Studio UX 的人工体验结论。
5. M4C 不打开生产 render route，也不冒充完整 TX-12 验收。
6. 内部四视角由实现会话本人完成，不是四个独立上下文；独立外审仍是 Codex 复核点。

禁止声明：Wave 2 组合 PASS、`WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、Gate V1-P0、V1-Full、M5/M6、headed/human 已验。
