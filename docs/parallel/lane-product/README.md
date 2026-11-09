# PRODUCT工作区文档入口

创作业务与工作台泳道。生产release尚未发布。
公共合同/DDL/旧M5挂载请求放本目录`requests/`，模块证据放`evidence/`；不复制timeline，不伪造新项目migration。
权威职责/白名单/交接提示词见 `docs/agent-driven-v1/07_PARALLEL_DEVELOPMENT.md`、`parallel-plan.json`、`09_PARALLEL_AGENT_HANDOFFS.md`。

## 双CLI执行

本目录Codex负责设计、文档、任务单与验收；Claude Code CLI负责已释放范围的实现。Claude报429时Codex核对旧writer停止后自动接手。TASK.md/HANDOFF.md记录任务、SHA、dirty工作、进程与唯一writer；不能同时写入。接手实现后需未参与者复核，MAIN统一集成。完整规则见根AGENTS.md。

最新前端范围：只新增src/app/observation内WorkflowPanel、AgentConsolePanel与只读适配，不实现独立agent-workbench前端。M5挂载/共享store由MAIN负责。当前原型/验收约束见docs/agent-driven-v1/s0-r2/README.md；旧s0为历史候选。

## S0 R3最新前端语义

用户要求顶部可折叠横向工作流Bar，及独立系统控制（服务启动/就绪、模型按需加载/预热/卸载、重试与诊断），不是Agent控制台。原剪辑区与导演控件保留。当前候选docs/agent-driven-v1/s0-r3/review.html；旧s0/s0-r2冻结保留历史。PRODUCT实现src/app/observation/WorkflowTopBar及src/app/system/SystemControlPanel；MAIN最小布局接线并独占系统生命周期命令，BRIDGE健康/服务发现，MEDIA受控模型runtime。当前只文档与图像，未运行模型/服务，生产实现NOT_RELEASED。
