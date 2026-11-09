# Narralens 多Agent工作约定

## 当前授权与权威入口

用户已认可截至`867b3b3`的Agent驱动路线文档，并授权并行架构/目录/任务规划。尚未把精确合同或产品原型冻结，也没有本轮生产实现release。先读 `docs/agent-driven-v1/00_READ_FIRST.md`、`07_PARALLEL_DEVELOPMENT.md`、`08_PARALLEL_PORTS_AND_OWNERSHIP.md`、`parallel-plan.json`。

有用户后续明确授权时以最新指令为准；MAIN将其记录为ReleaseAssignment（合同/基线/范围/owner/验收）。文档认可、创建worktree、模块测试通过均不能冒充生产准入或整体验收。

## 角色与范围

- canonical `Narralens` worktree的主Agent负责集成与公共文件；`agent-driven/lane-bridge|product|media`按parallel-plan.json对应白名单工作。
- 默认拒绝白名单外修改；protectedFiles/protectedPrefixes优先于allowPrefixes。需要公共改动，在自身 `docs/parallel/lane-*/requests/` 提交具体请求，不直接改server、DDL、合同、配置、旧核心或其他分支。
- 三lane从同一合同冻结SHA起步；一个文件一次一个owner；git显式add自己的路径，不reset/stash用户工作，不自动push/合main。
- 主Agent持续接线、负责冲突/真链；worker证据只证明模块，不能自签独立外审、人验或整轮PASS。

## Codex与Claude Code执行分工（用户批准）

三个lane均采用“目录内Codex负责设计、文档、验收；同目录Claude Code CLI负责具体实现”。MAIN仍负责公共合同/核心实现、跨lane接线、统一验收和发布，现有白名单、阶段依赖与资源预约不变。两种CLI由本机不同模型供应商提供；不得推定同一额度、共享凭据或擅自切换供应商。此批准落实团队分工，不替代IT-P01/IT-P02、CP-A0或具体生产release。

每个lane的Codex先落盘任务单（完整base/contract SHA、路径范围、输入输出、验收case、命令、资源预约与停止条件），再交同目录Claude实现。Claude交代码、测试、复现与产物摘要；Codex冻结实现SHA后独立读取代码并重跑对应验收，MAIN集成后重跑真实组合链。CLI名称或供应商不同本身不是外审通过证据。

**同一lane只有一个写入者。** Codex设计/文档与Claude实现分时执行；Claude写入时Codex仅只读观察，不并发改文件、Git索引、分支或运行根。每个lane在自身`docs/parallel/lane-*/`维护`TASK.md`与`HANDOFF.md`，记录任务状态、当前writer、base/contract/HEAD、dirty文件、命令/进程、日志与接手理由。默认Codex是lane负责人，Claude仅接已释放的实现任务。

遇到Claude **429**，无需再问用户，Codex自动接手已授权剩余实现。先确认原Claude调用/子进程已结束或停止并记录，不能只凭一个429日志判断全部进程停止；记录错误与未完成工作，复核HEAD/差异、保留全部未提交内容，移交唯一writer后继续。不得reset/stash覆盖，不把失败或未完成测试写PASS；不得新增付费请求、外传或更换凭据。Claude恢复后默认仍停，直到Codex显式移交，禁止双写/自动抢回。

Codex接手实现后，其自测只能称内部验证，不能自签独立外审。该候选由未参与实现的MAIN/其他干净只读审查上下文复核；若MAIN也参与实现，则另取未参与的审查上下文。独立复核暂不可得时标`REVIEW_PENDING`，可继续无依赖的已授权工作，不能越过相关验收门。

## 运行与验收

- 每worktree独立var/dist/node_modules/DB/staging/profile/端口；共享固定上游只读。禁止复制或链接可写运行根制造状态串扰。
- 轻量模块测试可并行；全量、多Host、ffmpeg/GPU/Comfy与大fixture首建须主Agent全机资源预约；不得提高vitest默认并发掩盖问题。
- 自动化一律Headless、静音、不抢焦点；真实人工窗口提前告知；不访问J盘/下载模型/产生付费或外传，除非当前任务范围明确授权。
- 无假进度、无测试替身冒充生产；失败与NOT_RUN保留，未知费用/取消结果如实处理；所有工程写仍经唯一Coordinator与base/锁/审批。

## 当前允许动作

基线复核、隔离目录准备、指定原型/文档/合同协作。没有MAIN正式实现release时不自行开生产功能。后续实际开发依本轮冻结计划连续推进，普通失败自己修复，第3次返工接管共同根因；仅在人工事实/高风险契约/授权或真实外部阻塞处升级。

## 实现前汇报与大阶段人工验收（最新用户要求）

每个大阶段开始具体实现前，MAIN必须先向用户汇报：目标/范围与不承诺项、任务包与依赖、每个Agent的实际目录/角色/状态、公共改动责任、真实测试与回退、阶段人工验收步骤/通过门槛、需用户决策项。计划中的Agent不得冒充已启动或已领取任务。

采用准备轮S0和A/B/C三轮交付：A=真实短片，B=协作及完整制作，C=长片与完整V1。模块级设计/开发/内审/接线由MAIN推进，阶段末冻结同一SHA统一实证与独立复核，再由用户验收；人工结论不能由Agent代签。未取得本阶段所需准入/上一阶段人工验收前，不自动跨入依赖它的下一阶段生产实现。当前未启动实现Agent或发放生产release。

## S0工作入口

用户已批准完成并汇报S0原型与首轮合同冻结方案。旧候选见docs/agent-driven-v1/s0/并保留冻结；当前前端候选见docs/agent-driven-v1/s0-r2/review.html。所有schema/TS/SQL位于文档包，尚未注册生产；S0-HUMAN=REVIEW_PENDING，CP-A0=NOT_RELEASED。下一步等待具体原型核验，开A前先汇报任务与实际分配，不能把本次文档批准当实现release。

## 2026-11-09 前端纠偏（最新约束）

用户要求只在现有剪辑工作台增加工作流展示和Agent控制台，其他前端保留；目标是在Agent操作时可见目标/动作/准备/待批/commit/编辑区同步状态，及早介入减少返工。上一版独立创作工作台原型不再指导前端。当前S0 R2见docs/agent-driven-v1/s0-r2/README.md；旧s0冻结包保留历史。PRODUCT新增组件放src/app/observation，MAIN最小挂载M5Panel；不加第二应用根、聊天页、时间轴或播放头。Job完成≠commit，commit≠原生编辑区已加载，无法核对native版本时显示未确认。生产实现未释放。
