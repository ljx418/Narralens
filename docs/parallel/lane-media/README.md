# MEDIA工作区文档入口

媒体执行/适配/渲染/QC交付泳道。生产release尚未发布。
公共Job/Asset/Resource/Approval接缝请求放本目录`requests/`，模块媒体证据放`evidence/`；不在回调里发布source/revision，不自行运行共享GPU/全量门。
权威职责/白名单/交接提示词见 `docs/agent-driven-v1/07_PARALLEL_DEVELOPMENT.md`、`parallel-plan.json`、`09_PARALLEL_AGENT_HANDOFFS.md`。

## 双CLI执行

本目录Codex负责设计、文档、任务单与验收；Claude Code CLI负责已释放范围的实现。Claude报429时Codex核对旧writer停止后自动接手。TASK.md/HANDOFF.md记录任务、SHA、dirty工作、进程与唯一writer；不能同时写入。接手实现后需未参与者复核，MAIN统一集成。完整规则见根AGENTS.md。
