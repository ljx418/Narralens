# R4目标驱动的V1实施文档包

日期：2026-11-09。当前阶段：**文档开发/审查**。产品代码不开发，生产实现NOT_RELEASED。R4原型人工批准与冻结保持；本包是对已认可目标的实施设计候选，不能自动变成代码开工授权。

## 阅读与人类审核顺序

1. `review.html`：中文可视审查入口；逐页查看8页GAP与全部详细文档。
2. `Narralens-V1-R4-实施与验收-GAP.drawio`：可在diagrams.net打开编辑的8页中文源文件；同内容SVG在pages/。
3. `01_ARCHITECTURE_AND_GAP.md`：L0主链、22个L1实体的实际/拟定路径、状态、关系与owner。
4. `02_CONTRACTS_AND_RECOVERY.md`：producer/consumer/注册分离、数据权威、关键字段、状态/恢复、CP冻结与导出原子性。
5. `03_DELIVERY_PLAN.md`：准备轮+A/B/C、17包DoD、里程碑、团队流程与编码约束。
6. `04_ACCEPTANCE_SCENARIOS.md`：35个既有AD-T族的用户场景/操作/阈值；R4门、T20-A..H导出故障矩阵与人验脚本。
7. `05_RISKS_AND_DECISIONS.md`：12项风险、约束/待冻结事项、回退与声明边界。
8. `target-l1.architecture.html`：Archify生成的可信批准→提交边界L1图，独立于GAP总览。图箭头不是提前消费批准；消费与最终commit须同DB事务。
9. `reviews/`：源码现状、合同基线、最终体验/验收三个独立上下文审视与返修复核。它们不是代码外审或业务验收。

体验交流后的增补：`07_EXPERIENCE_SPEC.md`详列阶段交互、节点弹窗、样片/首章/稳定授权、章节审阅和自动服务准备；`08_WORKFLOW_MCP_CONTRACT.md`定义模板/运行版本、MCP能力边界、运行中修改和EX-01..23验收子case。用户已确认其核心方向；新增精确字段/工具名仍是待CP核验的设计，不声称已注册。8页总体架构保持，不新增V1流程编辑器。

## 当前代码事实

观察HEAD为fd3021c336387b4c6405b3db08abaafa81c842ff；保留用户已有dirty文档。已有migration/materialize/impact/adoption/history/Job/journal/snapshot生产接缝。普通Vite入口仍是旧演示；Gateway注入的M5真实存在但还未符合R4。两引擎adapter的render尚未开放；生产Agent/MCP、新建一般项目、R4增量UI、通用资源池/真实AI媒体/完整交付仍待实现。

“已有”仅表示源码接缝，不表示本轮重跑业务验收。产品开发中模块0。现有源码证据见current-code-audit；拟定路径均显式标注，不能将docs候选schema/SQL当生产API。

## 这次不发生的事情

不修改src/contracts根生产文件、server、产品UI或数据库；不执行迁移/服务/GPU/provider/真实媒体任务，不读J盘，不发实现release，不提交/合并/push用户工作。文档图表生成、验证与Headless截图属于文档产物操作，不计产品开发或业务验收。

## 设计与证据的三条界限

- R4体验HUMAN_APPROVED；12个真实产品体验case仍NOT_RUN。
- Archify `deliver`的9项检查与SHA证明产物一致性，不证明业务或人类审美。原生visual-check因WSL内无Chrome为skipped；Windows Headless CDP补充记录不修改该结果。实际视觉审视另记。
- 一份L0草图未通过Archify标签间距门，按Skill两轮无改善后停止，记录在archify-l0-rejected.md；未交付失败HTML。最终L0为GAP第3页/SVG镜像，Archify最终合格图为独立L1。

## 下一门槛

先审核架构风险、规格覆盖和阶段出门方向，闭环本包意见，再完成对应CP-A0精确schema/TS/DDL/注册/向量/实际命令与兼容探针设计。只有用户明确批准产品实现、MAIN汇报实际Agent分配并发放ReleaseAssignment后，才可进行A。不得把本轮文档通过扩大为所有未来合同冻结或V1完成。

旧根文档的原字节归档于`../history/pre-r4-implementation-design/manifest.json`；旧S0/R2/R4冻结文件与历史Gate不改写。后续方案须保持原PRD的13P0、6P1、6NFR、21体验及原长片/章节承诺。

## 首轮精确准备包已另行落盘

本文件前述“下一门槛”是当时状态；最新A候选为`../cp-a0/00_READ_FIRST.md`，综合页面为`../final-review/index.html`。最终Archify L0已通过9/9，源与交付在final-review/l0.architecture.*；前述未通过的草图保留历史，不作交付图。L1及8页GAP保持原字节。实际生产实现/客户端/媒体/人验仍NOT_RUN，不以这次文档完成取代实施授权。
