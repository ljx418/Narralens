# A阶段恢复准备包

日期：2026-11-11。范围：用户批准三级协作恢复准备，止于ClaudeCode开发启动门；代码IMPLEMENTATION_NOT_STARTED，全部本轮业务验收NOT_RUN，不进入B。Orca可见窗口为真实研发协作会话，Claude只读检查完成不等于实施授权。

推荐先看[index.html](index.html)总览，再按以下顺序：

1. [MAIN审查与启动门](06_MAIN_REVIEW_AND_START_GATE.md)：完成范围、问题闭环、剩余条件及实际凭据事件。
2. [MAIN交接](07_MAIN_HANDOFF.md)：重启窗口恢复步骤与下一轮简短goal。
3. [公共合同D01–D15](02_MAIN_CONTRACT_AND_DECISIONS.md)、[精确所有权/DAG](03_OWNERSHIP_AND_DEPENDENCIES.json)、[协调计划R0–R4](04_COORDINATED_EXECUTION_PLAN.md)。
4. [组合验收](05_MAIN_ACCEPTANCE_AND_REVIEW.md)与三个领域子目录DESIGN/ACCEPTANCE/TASK、保留原发现的CLAUDE_READINESS。
5. 下一轮三份真正[实施提示词](implementation-prompts/)；领域CLAUDE_PROMPT仅为本轮只读派发，不混用。
6. [基线/备份](baseline-observed.json)、[源码事实](source-map.json)、[文档与保全检查](audit/document-check.json)、[Orca实际启动记录](orca-dispatches.json)、最终artifact-manifest.json。

原CP-A0四合同及冻结SQL字节不变；另有明确设计的5条附属HTTP和1个只读MCP resource，均未注册生产。新的内部created_*事实不能混入精确cp_a0_* namespace。旧提案/初轮阻塞不是最终指令，跨领域以MAIN02/03/06、领域TASK最后补充为准；保留历史，不伪改原PASS/失败。

MAIN25文件与BRIDGE310候选已校验归档，PRODUCT/MEDIA源码工作树清洁。当前base与dirty分别记录，不覆盖用户工作；实际共同实施commit留到下一轮R0生成。当前IMPLEMENTATION_RELEASE.json为PREPARED_NOT_RELEASED。

所有文档检查、架构图检查只证明本包，不证明A产品或V1已验收。产品阶段仍需真实中文录音/授权素材、完整链/恢复/独立审查/人工决定。
