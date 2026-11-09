# Agent 驱动路线审查入口

> 最新体验讨论已完成关键选择，新增详细规格见`implementation-design/07_EXPERIENCE_SPEC.md`和`08_WORKFLOW_MCP_CONTRACT.md`：阶段展示/任务弹窗、分阶段Agent与工作台协作、样片/首章验证与稳定授权、章节审阅、MCP模板固化/在途计划调整、自动服务准备。V1不做工作台流程编辑器；核心方向已确认，产品与精确CP仍未实现/冻结。

> 当前文档开发权威入口：`implementation-design/00_READ_FIRST.md`。8页中文drawio、当前/目标L0L1、17包计划、35族验收、12项风险与独立审查在同一包；本轮尚未批准产品实现。旧R2/R3说明仅历史，不用于发实施任务。

> 最新批准（2026-11-09）：用户批准`s0-r4/prototype.html`通过，作为V1前端体验出门门限。权威门限为`V1_FRONTEND_EXIT_GATE.md`，冻结/批准记录为`s0-r4/FREEZE.json`与`APPROVAL.json`。R4原型人工通过不等于产品真实验收或IT-P02/生产release通过。下列旧候选与待核验状态保留历史。

> 2026-11-09 UX检视后用户确认“A；A”：先完整演练已有工程改单镜，系统控制采用可继续剪辑的非模态侧面板。最新交互候选为`s0-r4/prototype.html`，边界与体验步骤见`s0-r4/README.md`；该候选仍待人类核验，生产实现NOT_RELEASED。R3效果图与旧原型保留历史，不以原型模拟状态冒充真实视频制作能力。

> 2026-11-09 S0 R3最新页面划分：工作流位于全局顶部Bar，横向展开/折叠；另一入口是独立系统控制面板，负责服务、模型加载/预热/卸载、重试与诊断，不是Agent控制台。原剪辑区与M5业务控件保留。当前效果图与交互稿见`s0-r3/review.html`；R2右侧两section布局退为历史，生产实现仍未释放。

> 2026-11-09用户纠偏（前端实施优先）：保留现有OpenFilm剪辑区和M5导演面板，仅在原导演面板中新增工作流展示、Agent控制台两个可折叠section；服务监控归控制台。工作台呈现同一项目的真实剪辑状态，禁止另建agent-workbench独立前端/聊天入口/时间轴。详情与当前原型见`s0-r2/README.md`（本段路径按当前文档目录解析）。原始PRD功能目标和后台制作计划继续保留，既有审阅/批准/编辑尽量复用原入口。新S0 R2仍待用户核验，不是生产实现release。

历史S0初版入口（前端呈现已由`s0-r2/review.html`替代）：`s0/review.html`（可操作模拟原型、首轮schema/TS/SQL与冻结方案），详见`s0/README.md`。用户已批准完成并汇报S0；仍未释放A生产实现。S0原型需用户核验，本包工具检查不替代业务验收。

状态：`PROPOSED_FOR_REVIEW`；本轮仅文档开发，未授权进入新路线代码实现。
最新覆盖：用户已认可截至`867b3b3`的目标/规划文档；当前任务为并行架构/目录/任务划分。目标文档认可与原型/精确合同/实现release分开。新增入口07/08/09与parallel-plan.json优先解释并行边界。
基线：`8633786dfc15490761f5d6a46f20bca0bcdc7d80`，分支 `migration/m2.2-coordinator-persistence`，编写前工作树清洁。

顺序：
1. `../01_PRD.md`：当前新产品职责、21 条体验与发布边界。
2. `01_TARGET_ARCHITECTURE.md`：L0/L1、代码实体、接口与风险。
3. `../architecture/agent-driven-v1-r2.architecture.html`：R2 Archify 目标图；图中包含未实现节点。
4. `02_DEVELOPMENT_AND_ACCEPTANCE.md`：六阶段、交付、门槛与旧计划映射。
5. `review.html`：逐条体验、架构和阶段核对，完整上述 Markdown 内嵌镜像及意见导出。
6. `03_REVIEW_RECORD.md`：文档自审、自动图表检查和剩余条件。
7. `04_R2_FEEDBACK_AND_COMFY.md`：用户初审逐条处置、本地Comfy候选、并行/概念/转场合同与待核对项；只读清单 `local-comfy-inventory.json`。
8. `05_REALTIME_AND_MONITORING.md`：实时工作流、服务健康、资源/队列、断线与服务恢复合同。动态示意为模拟，不是真实监控。
9. `06_ITERATION_EXECUTION_PLAN.md`：最新准备轮+A/B/C三轮、17个IT任务包、依赖/合同/证据/停点；`iteration-plan.json`为同源机器清单，`tools/check-iteration-plan.mjs`检查文档依赖与覆盖，不是业务验收。
10. `07_PARALLEL_DEVELOPMENT.md`：主Agent+三泳道、独立worktree、并行批次、资源预约与统一冻结验收。
11. `08_PARALLEL_PORTS_AND_OWNERSHIP.md`：跨泳道接口/存储/注册/代码责任；`parallel-plan.json`为路径所有权与17包责任清单。
12. `09_PARALLEL_AGENT_HANDOFFS.md`：三个工作窗口提示词模板与MAIN release/交付协议。当前不是生产release。
13. `10_PARALLEL_REVIEW_RECORD.md`：两路只读设计复核、真实问题闭环、9项一次性仓库工具验证；不替代产品验收。

## 权威与历史

PRD v1.2 与本目录是新路线的**待批准目标**。R1用户意见已归档并核对摘要，认可只绑定原版本，不自动批准R2新增/变化。旧 M2–M5 架构/实现/证据仍描述原已验证范围；旧 M6/M7 不再作为新路线的无条件开工指令。新旧冲突先依据本次用户方向修订，不默默缩减 P0/P1。

`AD-S0..S5` 为新阶段，不冒充旧 Gate 的完成。M5 面板操作获用户正面反馈，但整体产品被指出缺少功能与指引，完整 UX-12 未获得逐项签署。任何方案核对页不是业务原型或实际验收。

## 本轮需要用户逐条核对

- AD-E01..21：目标体验是否符合预期；可标记认可/需修改/待讨论并写意见。
- AD-A01..13：职责和架构变化是否接受；尤其 Agent 编排、Host持久状态、并行、Comfy与实时监控分工。
- AD-S0..S5：阶段交付和顺序是否接受；S2 是短片里程碑，V1-Full 只能在 S5 声明。

页面意见仅保存在该浏览器本地，复制/下载后发回对话才能形成正式评审输入，不自动授予实现权限。

## 2026-11-09 统一目标核对与A精确准备包

最新可视入口：`final-review/index.html`；目标体验、Archify L0/L1、8页GAP、22实体、17任务包、阶段验收与全文同页。A精确候选见`cp-a0/00_READ_FIRST.md`，当前仍文档阶段、生产NOT_RELEASED；B/C逐阶段新合同门和人工出口保留。
