# 文档独立审查与复验记录

审查对象：本目录全部 Markdown、两份 Archify 图和本地权威引用。
审查原则：每轮从新的检查清单独立开始，不以前一轮“已通过”为前提；发现问题先修文档，再对受影响项复验。

版本说明：第 1–4 节记录 v1.0“逐小阶段停工”版本的历史审查，不作为当前推进节奏的最终结论；第 6–9 节是用户批准“四波次连续交付”后对 v1.1 的重新独立复审。历史结论和哈希保留，避免把新内容伪装成当时已审。

## 1. Round A：架构与实现可行性审查

检查范围：L0/L1、模块所有权、真实代码落点、依赖方向、事务/持久性、迁移/回退、阶段依赖。

待核对：

- [ ] 当前生产 Hypit 与目标 OpenFilm 状态没有混淆；
- [ ] M2.1–M2.3 能在现有 Actor/RevisionStore 上增量演进；
- [ ] 没有第二 timeline、双写、adapter commit 或 spike→production 依赖；
- [ ] snapshot/commit-record/journal/outbox 的原子与恢复语义闭合；
- [ ] 每个阶段进入/退出/停止条件完整；
- [ ] 回退不是 reset，迁移后工作不会丢失。

执行：2026-10-17；人工逐页对照本地源码地图、M2 kickoff、PRD 与 traceability，并用脚本验证现有代码入口存在、目标 M2 路径尚不存在。

结果：

- `existing_missing=[]`：server、Actor、RevisionStore、Queue、AssetRegistry、Hypit/OpenMontage 入口全部可定位；
- `targets_already_present=[]`：EnginePort、OpenFilm production adapter、persistent jobs、materialize 仍确属未实现；
- 未发现双写、第二 timeline、adapter commit 或把 spike 当 production 的设计；
- snapshot/commit-record/journal/outbox 的职责与 M2.1→M2.2→M2.3 顺序闭合；
- 回退明确为旧项目重新激活/导出，不是 git reset。

Findings：`BLOCKER=0, MAJOR=0, MINOR=0`。结论：`PASS`。

## 2. Round B：接口、安全、状态与代码规范审查

检查范围：API、schema/type、错误优先级、canonical hash、幂等、锁、Job/SSE/lease、路径/provider/security、编程规范。

待核对：

- [ ] 目标 API 均明确为 planned，未冒充当前路由；
- [ ] 旧错误/路由兼容和新版本策略不冲突；
- [ ] revision/source/control/manifest/job 版本含义分离；
- [ ] 取消/晚到/未知费用/commit 不确定都有安全终态；
- [ ] native/provider/CLI/file 绕过路径均有默认拒绝；
- [ ] 代码规范能直接约束 Claude Code 实现。

执行：2026-10-17；将 `src/contracts/types.ts` 的现有 `ApiErrorCode`、`JobState`、AssetBlockingReason 与目标 API/契约逐项比对，并复核 route activation。

Findings 与修订：

- `B-01 MAJOR`：目标错误表未显式说明 `INVALID_PROPOSAL*`、`TRANSACTION_FAILED` 等既有 code 仍须兼容，可能诱导实现者缩窄 union。已在 `05_API_INTERFACE_SPEC.md` 增补现有 24 个 code 的兼容规则，并把 AssetBlockingReason 与 HTTP code 分离。
- `B-02 MAJOR`：目标 Job 状态未说明现有 `completed_after_cancel` 旧记录的迁移读取。已冻结为旧读兼容、新写映射 `cancelled + quarantined artifact/receipt`，要求数据库迁移与合同测试。
- `B-03 MINOR`：M2 API 章节可能让实现者在 M2.1 提前开放 `migrate-copy`。已明确 engine 只读接口到 M2.1 通过后开放，migrate-copy 到 M2.3 才开放。
- `B-04 MINOR`：M5–M7 仅有规则而缺目标接口索引。已增加阶段、目标路由、核心输入与副作用表。

复验：现有 24 个 `ApiErrorCode` 和 7 个当前 `JobState` 在接口文档中均可定位；无遗漏。修订后 `BLOCKER=0, MAJOR=0, MINOR=0`，结论：`PASS`。

## 3. Round C：PRD、完整体验、测试与证据审查

检查范围：13 P0、6 NFR、P1、用户路径、Headless/headed/human 分层、逐 case、真实数据、Gate 声明。

待核对：

- [ ] P0/P1/NFR 均映射到阶段、实体和 case；
- [ ] M2–M7D 所有既有 case family 无遗漏；
- [ ] 真实媒体/重启/导出/provider/人工签署未被 mock 或截图替代；
- [ ] 自动 UI 默认 Headless/静音/无干扰；headed 和 human 独立；
- [ ] M6/V1-P0 与 M7D/V1-Full 口径严格分开；
- [x] v1.0 当时的 Claude 提示词只开放 M2.1；该历史流程条件已被 v1.1 四波次授权明确替代。

执行：2026-10-17；独立从 migration acceptance 抽取 EN/TM/JB/PR/MT/TX/UX/PF/DL/P1 编号，与本包全文求差集；再检查 P0-01..13、NFR-01..06、M6/M7 完成口径和 Headless/headed/human 分层。

Findings 与修订：

- `C-01 MAJOR`：初稿使用 `MT-01..06`、`TX-01..14` 等范围缩写，虽语义覆盖，但不满足项目要求的逐编号直接映射。已在 `09_TEST_ACCEPTANCE_PLAN.md` 显式展开所有缺失编号及其判定主题。
- 复验结果：migration 包 65 个后续 case ID，`missing=[]`；13 个 P0、6 个 NFR 均显式映射；P1-01..06 显式存在。
- Headless 明确为默认静音无干扰；headed 与 human 均不能被自动截图替代。
- M6 只允许 V1-P0，M7D 才允许 V1-Full。

修订后 `BLOCKER=0, MAJOR=0, MINOR=0`，结论：`PASS`。

## 4. Round D：交叉引用与机械复验（补充）

执行与结果：

- 内部 Markdown 交叉引用：`missing_refs=[]`；标题格式无异常；尾随空白清零。
- 状态误报检索：未发现把 M2–M7 写成“已实现/已通过”的语句。
- migration 原包 `validate_package.py`：14 checks，`PACKAGE_ONLY_PASS`；97 个包内 planned case 全为 NOT_RUN；不冒充业务验收。
- `verify_checksums.py`：PASS。
- `corepack pnpm check`：exit 0；TypeScript、17 files / 134 tests、production Vite build 全通过。此结果仅证明文档变更未破坏当前代码基线，不代表 M2 实现。
- 目标架构图：Archify showcase 9/9、0 error/0 warning；Headless Chrome 四桌面视口 pass；human visual review pending。
- 流程图首轮发生纵向溢出，修正 5 泳道/3 卡片为 3 泳道/2 卡片后重新 deliver；最终 showcase 9/9、0/0，四视口明暗主题无溢出；human visual review pending。
- 外部只读 Claude Code 尝试经 MiniMax gateway 长时间无完整可审计输出，终止并标 `BLOCKED_ENV`；它不计入三轮内部 PASS，也不被伪称为独立外审。

被审内容集合（排除本自引用审查文件）SHA256：`751ae1263907db33cb8c11f5d2e8a18303fea1d644f4dee72be3ee0648cb6502`。

结论：`PASS_WITH_EXTERNAL_REVIEW_PENDING`。文档足以交给 Claude Code 从 M2.1 开工；M2.1 的实现外审仍必须在冻结实现 commit 后另行执行。

## 5. 复验结果填写规则

每轮执行后记录：日期/观察 SHA、方法/命令、findings（severity、file、修复）、受影响复验、残余风险和 PASS/FAIL。若修订发生，旧结果只对旧内容有效；最终结论必须绑定最终文档 tree hash 或 commit。

残余风险：本包没有实现 M2；OpenFilm production 接缝、Windows/WSL 文件 durability、M5 headed 性能、M6 真实内容/许可/人工签署和 M7 provider/预算都只能在对应阶段实证。当前工作树中的本包尚未提交，Claude 开工前应先由负责人决定是否提交为文档冻结点。

## 6. v1.1 Round 1：架构顺序与跨模块返工风险审查

独立问题：把十余个小停点压缩为四个波次后，是否破坏依赖顺序、安全边界或 Gate 语义？

执行：2026-10-17。重新从 `01_MASTER_ROADMAP.md`、L0/L1、M2–M7 模块设计和 AC-001..020 建立“前置合同→实现波次→正式组合 Gate”关系，不沿用 v1.0 的“文档已通过”假设。

结果：

- Wave 1 仍按 M2.1→M2.2→M2.3 顺序，只取消普通检查点等待；EnginePort/写入治理先于 snapshot/Job，snapshot/Job 先于 migrate-copy/rollback；
- Wave 2 仍严格为 M3 materialize 先于 M4 adopt，未把采用、history 或 author-source 写入前置；
- Wave 3/4 仍分别以 V1-P0、V1-Full 为声明上限，M6 不得吞并 P1；
- 双写、第二 timeline、adapter commit、stale rebase、数据损坏、费用/外传等硬停止条件未放宽；
- 波次末审核对象改为组合 commit，避免分别通过的模块树替代真实集成树。

Findings：`BLOCKER=0, MAJOR=0, MINOR=0`。结论：`PASS`。减少的是重复停工与重复报告，不是依赖检查或验收门限。

## 7. v1.1 Round 2：执行流程、交接与返工抑制审查

独立问题：Claude Code 是否会因旧 M2.1 文档再次停工，或因接口分批设计而重复返工？

执行：2026-10-17。逐项检索“只做 M2.1 / 一次只开放 / M2.1 后停止 / 不进入 M2.2”等旧节奏语句，并对照 README 权威层级、开发流程、Wave 1 提示词和新出现的 M2.1 ADR/计划。

Findings 与闭环：

- `F-01 MAJOR`：`docs/migration/M2/M2.1-development-and-acceptance-plan.md` 保留“唯一允许 M2.1”，与最新波次授权冲突。该文件属于另一会话已落盘工作，未覆盖；在 `00_README.md` 和 Claude 提示词中明确：D-01..D-06、历史编号与技术合同继续有效，旧停点只保留为历史流程记录，并要求新增 Wave 1 总计划/兼容补充；
- `F-02 MAJOR`：v1.0 审查清单仍要求提示词只开放 M2.1。已把该项标为历史条件，并以本节取代当前结论；
- `F-03 MINOR`：traceability 只有 Mx.y、没有正式波次映射。已新增 Wave 1–4 到旧 Gate 的映射，保留原编号作证据和故障定位；
- EnginePort、Binding、Digest、Snapshot、CommitRecord、Lock、Job/Event/Lease、MigrationReport 被要求在 Wave 1 开工前一次冻结；M3/M4 合同同理在 Wave 2 一次冻结；
- 模块检查点只运行增量/受影响验证并自动继续；只有波次候选、架构契约变化或硬风险触发完整复验/停工。

复验检索只剩两类预期命中：README/提示词中的“旧节奏已被替代”说明，以及未修改 M2.1 历史计划本身；交接包中无仍具执行效力的“完成 M2.1 后等待”指令。修订后 `BLOCKER=0, MAJOR=0, MINOR=0`，结论：`PASS`。

## 8. v1.1 Round 3：PRD、完整体验与验收强度审查

独立问题：减少正式审核次数是否造成规格、用户体验或真实证据被删减？

执行：2026-10-17。从 migration `08_Acceptance.md` 重新抽取 case ID，与 v1.1 全包求差集；独立枚举 P0/NFR；复核 Headless/headed/human、真实 fixture、重开、双导出、回退和外审规则。

结果：

- 后续 migration case 共 65 个，`missing=[]`；EN/TM/JB/PR/MT/TX/UX/PF/DL/P1 均保留逐编号映射；
- P0-01..13 共 13 项、NFR-01..06 共 6 项均显式存在；P1 仍只在 Wave 4/V1-Full 关闭；
- Wave 1 仍需真实 OpenFilm/Hypit、restart、双引擎导出、rollback；Wave 2 仍需三案为三个原生可编辑 clip；Wave 3/4 的真实内容、headed 和人类体验没有被 Headless 截图替代；
- 自动 UI 仍强制 Headless、静音、隔离 profile、无窗口、不抢焦点；headed/human 未运行必须写 `NOT_RUN`；
- 外审从“每小模块一次”合并为“每个组合 commit 一次”，仍必须由独立会话绑定冻结 commit，实施会话不能自签。

Findings：`BLOCKER=0, MAJOR=0, MINOR=0`。结论：`PASS`。

## 9. v1.1 机械复验与最终结论

执行：2026-10-17。

- Markdown：尾随空白 `[]`，奇数代码围栏 `[]`；
- migration 包 `validate_package.py`：14 checks，`PACKAGE_ONLY_PASS`，97 个 planned case 全为 `NOT_RUN`；
- migration 包 `verify_checksums.py`：PASS；
- `corepack pnpm check`：exit 0；TypeScript、17 files / 134 tests、production Vite build 全通过；只证明当前基线未被文档修改破坏，不代表 M2 实现；
- 四波次流程图：Archify showcase 9/9、0 error/0 warning；Headless Chrome 1440×900、1600×1000、1920×1080、2048×1320 明暗主题通过、无溢出；human visual review 仍为 `pending`；
- 生产代码改动：无；M2–M7 业务验收：未执行；独立实现外审：必须等 Wave 1 冻结组合 commit 后执行。

被审 v1.1 内容集合（排除本自引用审查文件；按路径排序后拼接各文件 `sha256sum` 输出再哈希）SHA256：`84f2629c4f5a20e477b60b07ca79e7b20b443b4453f05457f96bc92e98ea9c98`。

最终结论：`IMPLEMENTATION_READY / EXTERNAL_IMPLEMENTATION_REVIEW_PENDING`。文档足以授权 Claude Code 连续完成 Wave 1；不允许据此宣称 M2、D4.2、V1-P0 或 V1-Full 已实现或通过。

