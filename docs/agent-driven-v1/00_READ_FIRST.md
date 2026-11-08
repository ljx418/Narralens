# Agent 驱动路线审查入口

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
