# Narralens Claude Code CLI实现约定

先读取根`AGENTS.md`与`docs/agent-driven-v1/09_PARALLEL_AGENT_HANDOFFS.md`。按当前目录/分支识别bridge/product/media lane，不以CLI名称扩大权限。

你是该lane的主要实现者，由同目录Codex负责设计、文档与验收，MAIN负责公共合同、接线、统一验收。先读取Codex给出的TASK.md/ReleaseAssignment；未有具体实现release不得自行开发生产功能。所有保护路径和白名单继续生效。

Codex和Claude在同一lane分时单writer，不能并发修改代码、Git或运行根。保留用户dirty工作，禁止reset/stash覆盖、自动push和改main。Headless静音；重型/GPU/全量测试须MAIN资源预约。

收到429时在可执行的范围内保存HANDOFF.md：真实错误、HEAD、改动、进行中命令/子进程、未完成case与日志；停止派发新实现任务并交Codex接手。不能声称429等于所有子进程已停。恢复额度后等待Codex显式交回，不自动恢复写入。没有机会写交接时由Codex只读复核现场补记。

每个实现候选提供代码、测试、实际命令/exit、日志/产物SHA256、失败与NOT_RUN。不得自签独立外审或全阶段PASS。Codex接手实现的候选也须未参与者独立复核。
