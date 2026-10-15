# 叙镜开发计划 v1.0

状态：实际开发已批准；Gate D1、D2、D3、D4.0、D4.1 已通过。D4.2 总体文档及子阶段边界已通过内外审。D4.2.1 生产实现、全量 126/126 回归及 Headless 浏览器 100%/原生 200% 证据已完成，内部总审计通过；仅待独立外部总审计，关闭前不得宣告 Gate 通过或进入 D4.2.2。总览见 `Narralens-V1-Development-GAP.drawio` 第 5 页，需求追踪见 `11_V1_Traceability.md`。

## 当前前置阶段 — V1 前端体验冻结（文档中）

- 已批准 `prototype-v0` 作为 V1 目标原型。
- 正在用 `10_V1_Frontend_Optimization.md` 与 `prototype-v1/` 冻结三阶段体验、组件边界、完整状态和验收门限。
- 本阶段出门条件是项目负责人批准细化后的架构、目标体验和三层 Gate。
- 每个子阶段仍须先冻结开发/验收计划并闭环审计；D1 已完成真实底座验证，D2 已完成单提案真实链，D3 审计通过后才实现类型化局部写入。

## 0. 开工原则
先证明真实链路，再优化视觉。任何“看起来可编辑”的页面，如果没有写入真实工程、重开后仍存在、并能导出真实 MP4，都不算完成。

## Phase 0 — D0/D1：基线与技术探测
### 任务
- 建立 `narralens` 仓库，导入本包文档。
- 克隆并固定 OpenMontage 与 Hypit 的 commit SHA；记录 license。
- 探测 Hypit Studio 实际启动、工程格式、check/plan/build、预览与写入入口。
- 用中文旁白 + 现有素材制作 30 秒真实项目，导出、关闭、重开、修改一个镜头、再次导出。
- 记录机器环境、字体、ffmpeg/浏览器/Node/Python 版本。
### Gate
若 30 秒声画链路不通，停止做业务 UI，先解决底座。

## Phase 1 — D2：统一宿主与提案链
- 在 Hypit Studio 应用层加入 `DirectorPane` 与项目头部。
- Host 提供 projects/jobs/events 最小 API。
- OpenMontage Adapter 能在同页触发真实 Agent Runner，返回一个结构化 ProposalBundle。
- 手工复制 JSON 不算通过。

## Phase 2 — D3：真实选区写入
- 建立 stable shot/source identity 映射。
- 实现同镜范围 typed edit、baseRevision、视觉/旁白/时长锁。
- staging → check → commit → revision。
- 过期提案、锁冲突、缺素材有稳定错误。

## Phase 3 — D4：多分镜提案与素材审批
- 同一选区至少 3 个结构不同的真实提案。
- 比较阶段不生成全部付费视频。
- 采用一个方案，若缺素材则进入 materialize；记录外传与费用。
- 一个方案真正落入 Hypit 工程并刷新真实预览。

D4 已拆分并按门禁顺序推进：D4.0 类型化单素材替换、D4.1 只读多提案比较均已通过；D4.2 计划拆为“契约/本地导入/资产登记及 manifest 兼容底座”“只读实体化与确定性 composite”“事务采用与交互闭环”。D4.2 只使用本地已登记素材，不接远程检索/生成 provider；多 segment 先确定性合成为可追溯 composite，再复用 D4.0 `media.replace`，避免破坏 stable shot identity。@2 manifest 与 Hypit 安全重载必须和首次导入同批交付，禁止阶段间回退 D4.0。详见 `implementation/D4.2-development-and-acceptance-plan.md`。

## Phase 4 — D5：声音、字幕、复用与恢复
- 视觉改动不重跑已锁旁白。
- 字幕与语音对齐保持。
- 历史恢复创建新 revision。
- 崩溃/取消/晚到任务/外部文件修改处理。

## Phase 5 — D6/D7：真实章节切片验收
- 使用一条真实 10–15 分钟时政项目作为母项目。
- 全片完成章节、脚本、粗分镜进入工作台。
- 选择其中 3–5 分钟章节，完成真实素材、字幕、声音和逐镜精修。
- 零号用户亲自：找到指定句子 → 选区 → 比较方案 → 保留旁白采用 → 锁定 → 恢复 → 重开 → 再导出。
- 记录耗时、费用、失败、人工步骤。

## 第 2 周
- 优化全片 60–180 镜头导航。
- 完成空间备选视图生产化。
- 跨镜选区和更丰富关键帧仅在 D1 证明 Hypit Source 模型支持跨镜 stable ID，且相应契约测试通过后进入；否则转入 V1.x 候选，不阻塞 V1。
- 三个不同选题回归。
- 标题/封面候选工作区接入真实生成。

## 第 3–4 周
- 完成一条完整 10–15 分钟视频端到端。
- StyleProfile / 账号模板。
- 模型/provider 配置、预算与队列。
- 素材检索/生成适配器。
- 发布前检查、标题/封面、人工发布。
- 导入反馈并生成改进提案；不自动直接改生产模板。

## 里程碑
M0：真实 30 秒工程链路。
M1：同页 OpenMontage 提案链。
M2：真实局部写入 + 锁 + revision。
M3：3–5 分钟章节切片可精修和重导出。
M4：完整 10–15 分钟视频闭环。
M5：多账号模板与稳定批量。

## 阶段执行契约

| 阶段 | 进入条件 | 开发交付 | 必做测试 | 退出条件 |
|---|---|---|---|---|
| DOC | V1 目标原型获批 | PRD、架构、计划、验收、追踪矩阵、7 页 Draw.io | 一致性审计、图表渲染、链接/校验和 | 0 个未关闭致命/重大文档问题，项目负责人批准方向 |
| 实际开发批准 | DOC Gate 内审与外审均通过 | 项目负责人单独批准进入第 5 步；记录批准日期与范围 | 核对 `09_Development_Workflow.md` 第 5 节和外审关闭记录 | 未明确批准不得创建生产实现或开始 D0–D1 |
| D0–D1 | DOC Gate 通过且已获实际开发批准 | 上游固定、环境审计、30 秒真实工程、Adapter 事实记录 | 双导出、重开、改单镜、ffprobe、帧样本 | Gate D1 全绿；否则停止业务 UI |
| D2 | D1 全绿 | NarralensApp/DirectorPane、Host API、真实 Runner/Proposal | contract + Playwright + Runner integration | 页面请求产生真实 ProposalBundle；手工 JSON 不算 |
| D3 | D2 全绿 | stable identity、typed edit、revision、locks、rollback | 409/422/423、不变区字段对比、失败回滚 | 一个局部方案真实写入且刷新 Run |
| D4 | D3 全绿 | 3+ 结构提案、materialize、许可/费用审批 | 428、缺素材、仅采用方案生成、来源追踪 | 三方案比较并采用一个真实方案 |
| D5 | D4 全绿 | 产物复用、字幕/声音锁、历史恢复、任务恢复 | 崩溃/取消/晚到/外部修改、资产哈希 | 已锁对象不重跑；恢复创建新 revision |
| D6–D7 | D5 全绿 | 真实 3–5 分钟切片、预检与交付 | 20+ 镜头、3 处采用链、重开、双导出 | Gate V1 首周部分全绿 |

每个阶段开始前必须在 `docs/implementation/` 新建阶段计划和验收文件；结束时增加 evidence manifest，列出真实命令、产物路径、日志、测试结果、限制和 PRD 差异。没有 evidence manifest 不得开始下一阶段。

## 当前里程碑状态（2026-10-12）

| 里程碑 | 状态 | 原因 |
|---|---|---|
| DOC | 通过 | 内审与两轮 Claude Code CLI 外审均无未关闭致命/重大/一般问题；文档与图表已同步 |
| 实际开发批准 | 已批准 | 项目负责人于 2026-10-12 明确授权进入实际开发 |
| M0 / Gate D1 | 通过（限制已声明） | 上游固定、30 秒双导出、定点差异、Studio 写回、OpenMontage 探针与安全扫描均有证据 |
| M1 / Gate D2 | 通过（限制已声明） | 单页面真实项目→Claude Code CLI Runner→结构化 ProposalBundle→SSE 展示已由真实 E2E 证明；仅一个提案，未写工程 |
| M2 / Gate D3 | 通过（限制已声明） | 单镜 visual fit typed edit、revision/visual lock/journal/恢复、真实 Studio/Host 重启与 baseline 恢复均有证据；不含 D4 proposal 采用 |
| Gate D4.0 | 通过（限制已声明） | 注册本地视频资产的类型化单镜替换、许可/来源展示、事务恢复、真实重建与精确恢复已验；Hypit fork/gitlink 已固定；不含 D4.1 多提案和 D4.2 素材化采用 |
| Gate D4.1 文档 | 通过 / 允许实现 | 多提案 request/draft/comparison schema、只读比较架构和开发验收计划已建立；内部复审 PASS，Claude Code CLI 第二轮 17/17 CLOSED |
| Gate D4.1 实现 | 通过（限制已声明） | 3–6 多提案只读比较、真实 CLI audit、GCD 差异、原子暂存、80/80、浏览器/NOWRITE、内外实现审查均通过；不含 materialize/采用 |
| Gate D4.2.1 实现 | 内审通过 / 外审待完成 | 本地流式导入、@1→@2、库存、Hypit lease/TOCTOU、故障恢复、Headless 100%/原生 200%、126/126 已留证；不含 materialize/采用 |
| M3–M5 | 未开始 | 依赖前置 Gate，不得提前声称实现 |

## 工程纪律
- 每个提交只有一个可观察能力 + 测试 + 复现步骤。
- 新增接口必须写契约和错误码。
- 不凭猜测写上游内部接口；D1 探测后更新适配层。
- 不用正则改 Author Source，不用数组下标猜 identity。
- 不重复开发渲染器。
- 未验证能力文档标注 `planned/blocked`，不能写 `ready`。
- 自动化开发每个子阶段必须执行“验收标准 → 审计闭环 → 实现 → 真实数据 E2E → PRD 检视 → 证据落盘”；发现重大偏差或虚假验收风险立即停止并报告。
