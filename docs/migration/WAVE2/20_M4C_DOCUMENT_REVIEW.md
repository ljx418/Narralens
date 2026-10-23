# M4C 文档独立审查记录

审查日期：2026-10-23

审查对象：ADR-W2.0-006、M4C gate、Claude handoff、剩余路线、Wave 2 总架构/计划、主架构/追踪、真实 M4B
实现接口与 evidence。

结论：`M4C_DOCUMENT_GATE_PASS`。三轮均在不同问题框架下从空白检查表重新审视；最终
`BLOCKER=0 / MAJOR=0 / MINOR=0`。该结论仅说明文档可实施，不签署 M4B 外审，也不代表 M4C 已实现。

## 第一轮：架构、权威与数据一致性

检查问题：谁拥有历史内容、谁能改变 active source、snapshot/revision 身份是否一致、是否引入第二 timeline/状态机、
崩溃后能否仅凭持久事实判定。

首次发现并关闭：

1. **BLOCKER：旧文字要求恢复相同内容仍产生不同新 snapshot，与 content-addressed `snapshotIdFor(project,digest)`
   冲突。** 修为相同内容复用 immutable snapshot id，但必须产生新 history transaction、commit、revision+1、outbox 与
   idempotency response；no-op current=target 拒绝。ADR D-01、总合同与追踪同步。
2. **BLOCKER：ImpactService 现有 restore placeholder 没有历史 source/layout 权威。** 新增唯一 Host-only
   HistoricalSnapshotResolver，联合 snapshot row、committed history、SnapshotStore root、projection fact/migration plan、
   fixed upstream 与 SourceDigestV1；明确禁止用 current source 冒充 target。
3. **MAJOR：若 history fact 自带 state，会与 project_transaction 形成第二状态机。** fact 冻结为 immutable 1:1 evidence，
   prepared 同事务落盘；project_transaction 保持唯一状态权威。
4. **MAJOR：递归恢复 source tree 无原子保证。** M4C 限定为 exact `film.html` + 缺失内容寻址资产，外置可变 roots 差异
   fail closed；复用 M4B 已证明 publisher，不删除旧资产。
5. **MAJOR：projection fact 以 snapshot 为 PK，恢复旧 snapshot 时可能已存在。** commit 冻结为 exact
   insert-or-verify；migration 初始 snapshot 无 fact 时允许由 immutable migration facts 建立，已有 fact 必须逐字段一致。

复验：EnginePort 仍 7 方法；Host 独占 transaction/locks/revision/publish/commit；active OpenFilm source 唯一 timeline；
content rollback 与 deployment rollback 分离；BLOCKER=0 / MAJOR=0。

## 第二轮：代码可实现性、接口与并发恢复

检查问题：逐一对照 SnapshotStore、AdoptionStore/Coordinator/Publisher、RevisionStore、ActivatedProjectionService、
ImpactService、EnginePort/OpenFilm adapter、NativeMutationRegistry 与 server，验证每个目标调用都能落到具体实体。

首次发现并关闭：

1. **BLOCKER：仅写“overlay target film”会让 HistoryService 绕过 EnginePort，或迫使 adapter 反向依赖 SnapshotStore。**
   冻结 server-only `RestoreEnginePlanIntent` 和唯一 closed `restore_film` op；Host 读取并验证 target bytes，adapter 只在
   isolated root 写 exact film，fixed upstream validate；不增加 EnginePort 方法、不进入 wire/log。
2. **MAJOR：`ImpactSpecV1.affected_ranges` 全局 minItems=1 无法表达 narration-only restore。** 冻结 conditional：adopt
   仍至少 1，restore 可为 0，但 consumer/required locks 必须非空；防止为过 schema 伪造 visual range。
3. **MAJOR：现有 failure response operation 只允许 adoption。** M4C 合同阶段同提交扩为 closed two-arm enum；400/404
   等 transaction 前错误不写 terminal failure，避免错误地扩大 idempotent abort shape。
4. **MAJOR：native undo/redo 如果直接执行会绕过两阶段授权。** Translator 只解析 target 并生成 typed intent；仍须
   impact + explicit approval。redo 只从 immutable restore fact 的 source-before snapshot 解析；无唯一目标 422。
5. **MAJOR：客户端断开与 prepared source publish 冲突。** prepared 前 abort 丢弃晚到 stage；prepared 后进入原子
   恢复域，不能因连接断开留下 source/DB 半状态。同 key 重放最终结果。
6. **MINOR：多专用 recovery 的固定调用顺序可能被误解为并行。** gate 要求按 transaction created_at、项目队列串行；
   同项目出现多个未终结 controlled writes 视为不可证明并 attention，不静默任选。

复验：每个目标实体有路径、输入/输出、持久表、CAS、错误与禁止项；所有绝对路径保持 Host-only；BLOCKER=0 /
MAJOR=0 / MINOR=0。

## 第三轮：完整体验、验收与证据可信度

检查问题：从“选择旧版本→看 impact→确认→恢复→重开→编辑→渲染验证”反推 case；区分 Headless、headed、human；
检查旧 Gate、真实媒体、负向/变异、证据追加、声明上限与最近人工体验门。

首次发现并关闭：

1. **MAJOR：旧总计划把 TX-12 写成完整生产导出，但 M6 render route 明确未开放。** M4C 只关闭 TX-12C
   snapshot-immutability subset：在途 harness 绑定旧 committed snapshot，restore 后输入 bytes/digest 不变；生产 render
   与正式 MP4 留给 M6，不冒充。
2. **MAJOR：M4B 独立外审仍 pending，直接写 M4C 会把未签基线继续放大。** Claude handoff 首阶段固定为对
   `b2a4efb...` 的独立外审；有 BLOCKER/MAJOR 则修复、重捕获并用新干净上下文复审，PASS 后才实现 M4C。
3. **MAJOR：初稿写“M4C-01..18”，实际混用 M4C/TX 编号且不存在 M4C-07..13，容易制造虚假总数。** 改为 gate
   §8 的 20 个显式 case，不以连续编号或总测试数替代逐项证据。
4. **MAJOR：只有 current-tip integrity 会在后续代码变化后必然红，容易再次发生“调绿历史门”。** M4C-0 必须新增
   `evidence:wave2:m4b:historical`；current-tip 非零保存原始输出，用 historical PASS 证明冻结树。
5. **MINOR：最近人工体验门与 M4C 技术门混淆。** 路线图明确：M4C+Wave2 外审后仍需 M5A/B/C；第一次正式人工
   体验在 M5C Headless 技术门全绿之后。M4C headed/human 固定 NOT_RUN。
6. **MINOR：可视图浏览器验证环境缺 Chrome。** Archify deterministic deliver 已 9/9、0 error/0 warning；automated
   browser visual-check 如实 `SKIPPED`，visual review `pending`，不阻止文档技术门且不冒充人工视觉通过。

复验：20 case 覆盖合同、resolver、digest/upstream、plan hash、impact、三锁/consumer、竞态、幂等、崩溃、历史、
bypass、snapshot subset、native/media、取消、NOWRITE、全回归；每个有失败门限。Headless/静音/无窗口、不读 J 盘、
无 provider/费用均进入 handoff；BLOCKER=0 / MAJOR=0 / MINOR=0。

## 机械一致性与可视化收据

- `git diff --check`：PASS；
- 权威文件存在/非空：PASS；
- M4C case 计数：20，逐项列在 gate §8；
- Archify sequence validate：showcase 9/9，composition error=0、warning=0；
- spec SHA256：`2f286788b09d3eb4272e9809e3c5d6c15700f1748da7bf254e828d7ae1af54e8`；
- HTML SHA256：`db4944741d0a940ce373cec9f141a84412f575e3c5f468885f10d9d073f51aec`；
- automated browser visual-check：`SKIPPED`（本机无 Chrome/Chromium）；human visual review：`pending`。

文档冻结前的非业务基线复验：`test:contracts` 3 files / 21 tests PASS；`test:wave2:m4b` 6 files / 36 tests PASS；
`evidence:wave2:m4b:integrity` 8/8 PASS；`check:m2.1-docs` PASS。它们证明本次文档编辑未改变当前生产合同或 M4B
证据，不替代 M4B 独立外审，也不算 M4C 业务验收。

最终全量 `corepack pnpm check`：exit 0，76 files / 892 tests，8/8 impact Python golden vectors，TypeScript 与生产
Vite build 全部通过（1345.70 秒）。本次未执行 headed/human，也未运行 M4C 业务测试（实现尚不存在）。

## 开发门结论

允许交给一个全新 Claude Code 会话执行 `18_M4C_CLAUDE_HANDOFF.md`：先独立外审 M4B，再连续实现 M4C，最后停在
Codex 独立复核点。不得据此提前声明 M4B 外审 PASS、M4C 完成、Wave 2 完成、Gate D4.2、V1-P0 或 V1-Full。
