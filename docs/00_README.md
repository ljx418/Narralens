# 叙镜 · AI 导演工作台 / Narralens — AI-Assisted Directing Studio

版本：v1.0 开发基线（2026-10-11）

本包用于本地 Codex 终端直接开展实现。目标不是继续制作静态原型，而是在固定上游版本后，把统一工作台接到真实视频工程与真实输出链路。

## 先读顺序
1. `01_PRD.md`：产品目标、范围、用户故事、非功能要求。
2. `02_UX_Interaction.md`：统一工作台布局、交互状态、时间轴和三维备选。
3. `03_Architecture.md`：OpenMontage + Hypit + Narralens 控制层的零层/一层架构、数据与接口。
4. `04_Development_Plan.md`：7 天原型、1 个月闭环、阶段门槛。
5. `05_Acceptance_Plan.md`：可执行验收矩阵。
6. `06_Codex_Handoff.md`：Codex 开工指令、提交纪律、禁止事项。
7. `07_Decisions_Open_Issues.md`：已锁定决定与不阻塞开工的待确认项。
8. `08_Sources.md`：上游事实与许可来源。
9. `09_Development_Workflow.md`：项目负责人的阶段门槛、原型、文档、开发、审计、验收和迁移规则。
10. `10_V1_Frontend_Optimization.md`：获批 V1 原型的前端架构、目标体验、状态矩阵与三层验收门限。
11. `11_V1_Traceability.md`：P0/NFR 到代码实体、阶段、测试和真实证据的追踪矩阵。
12. `Narralens-V1-Development-GAP.drawio`：7 页中文 GAP、目标架构、前端模块、事务、计划、门限与风险图。
13. `architecture/v1-target-system.architecture.html`：Archify 生成并验证的全系统目标架构。
14. `12_V1_Internal_Document_Audit.md`：Gate DOC 内部一致性、风险隔离和备选路线审计结论。
15. `13_V1_External_Review_Brief.md`：外审范围、独立审查问题、判定格式与外审后状态转换。
16. `14_V1_External_Document_Audit.md`：Claude Code CLI 外审结论、问题清单、修订与复审记录。

## 当前锁定产品定义
- 首发场景：中文时政观点型长视频，通常 10–12 分钟，可延长至 15 分钟。
- 目标：把问题讲透、把来龙去脉讲清，观点有证据支撑、画面与内容相关。
- 镜头节奏：通常 5–10 秒一个小分镜，是软约束，不强制切镜；重要原片、图表或现场可更长。
- 章节：脚本结构清晰，但画面过渡自然，不默认使用明显章节动画或刻意转场。
- 封面与标题：由 AI 辅助生成多个候选，但不得改变正文事实与结论；最终由用户确认。
- 第一阶段体验：逐镜头可控、局部修改、锁定、回滚、重开、真实导出优先。
- 后续体验：稳定出片、批量生产、账号风格模板与反馈闭环。

## 开发阶段默认口径
- 第 1 周：以同一真实 10–15 分钟项目为母项目，完成其 3–5 分钟章节切片的真实精修与导出，并确保整片脚本/章节/分镜已可进入工作台。不要用静态 HTML 代替真实导出。
- 第 1 个月：跑通一条完整 10–15 分钟视频，从任务输入到真实成片、标题/封面、人工发布前检查。

如需改变以上口径，先更新 `07_Decisions_Open_Issues.md`，再改代码。

## 当前阶段（2026-10-13）

V1 目标原型、开发计划与实际开发均已批准。Gate D1、D2、D3、D4.0、D4.1 已通过。D4.0 类型化本地媒体替换已完成实现、真实构建、内外实现审查，并固定到 Hypit fork commit `437563f977541002066e6ee961f83a67cbebd3c2`；P0-08 仍为 partial。D4.1 已完成多提案生产实现、80/80 自动化测试、真实 Runner/浏览器/NOWRITE 验收及内外实现审查。D4.2 开发计划、五份审查契约和 Archify 目标架构已形成；修订后的子阶段边界已通过内部审查和 Claude Code CLI 两轮针对性复审，允许进入 D4.2.1，生产代码尚未开始。D4.0 计划与证据见 `implementation/D4.0-development-and-acceptance-plan.md`、`implementation/D4.0-external-implementation-audit.md` 与 `evidence/D4.0/evidence-manifest.json`；D4.1 计划、审计与证据见 `implementation/D4.1-development-and-acceptance-plan.md`、`implementation/D4.1-external-implementation-audit.md` 与 `evidence/D4.1/evidence-manifest.json`；D4.2 文档入口为 `implementation/D4.2-development-and-acceptance-plan.md`、`implementation/D4.2-external-plan-audit.md` 和 `architecture/d4.2-materialize-adopt.architecture.html`。原型入口仍为 `prototype-v1/index.html`，当前生产 UI 位于 `src/app/director/`。
