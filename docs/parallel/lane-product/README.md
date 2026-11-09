# PRODUCT工作区文档入口

创作业务与工作台泳道。生产release尚未发布。
公共合同/DDL/旧M5挂载请求放本目录`requests/`，模块证据放`evidence/`；不复制timeline，不伪造新项目migration。
权威职责/白名单/交接提示词见 `docs/agent-driven-v1/07_PARALLEL_DEVELOPMENT.md`、`parallel-plan.json`、`09_PARALLEL_AGENT_HANDOFFS.md`。

## 双CLI执行

本目录Codex负责设计、文档、任务单与验收；Claude Code CLI负责已释放范围的实现。Claude报429时Codex核对旧writer停止后自动接手。TASK.md/HANDOFF.md记录任务、SHA、dirty工作、进程与唯一writer；不能同时写入。接手实现后需未参与者复核，MAIN统一集成。完整规则见根AGENTS.md。

最新前端范围：只新增src/app/observation内WorkflowPanel、AgentConsolePanel与只读适配，不实现独立agent-workbench前端。M5挂载/共享store由MAIN负责。当前原型/验收约束见docs/agent-driven-v1/s0-r2/README.md；旧s0为历史候选。
