# 并行Agent任务入口与交付协议

> 2026-11-09 S0 R3最新页面划分：工作流位于全局顶部Bar，横向展开/折叠；另一入口是独立系统控制面板，负责服务、模型加载/预热/卸载、重试与诊断，不是Agent控制台。原剪辑区与M5业务控件保留。当前效果图与交互稿见`s0-r3/review.html`；R2右侧两section布局退为历史，生产实现仍未释放。

> 2026-11-09用户纠偏（前端实施优先）：保留现有OpenFilm剪辑区和M5导演面板，仅在原导演面板中新增工作流展示、Agent控制台两个可折叠section；服务监控归控制台。工作台呈现同一项目的真实剪辑状态，禁止另建agent-workbench独立前端/聊天入口/时间轴。详情与当前原型见`s0-r2/README.md`（本段路径按当前文档目录解析）。原始PRD功能目标和后台制作计划继续保留，既有审阅/批准/编辑尽量复用原入口。新S0 R2仍待用户核验，不是生产实现release。

目前所有泳道只允许基线复核、IT-P01/IT-P02文档/原型协作。生产实现须等待MAIN发布CP-A0合同SHA与明确的release。工作目录已准备不代表任务已启动或准入已通过。

## Codex与Claude Code执行分工（用户批准）

三个lane均采用“目录内Codex负责设计、文档、验收；同目录Claude Code CLI负责具体实现”。MAIN仍负责公共合同/核心实现、跨lane接线、统一验收和发布，现有白名单、阶段依赖与资源预约不变。两种CLI由本机不同模型供应商提供；不得推定同一额度、共享凭据或擅自切换供应商。此批准落实团队分工，不替代IT-P01/IT-P02、CP-A0或具体生产release。

每个lane的Codex先落盘任务单（完整base/contract SHA、路径范围、输入输出、验收case、命令、资源预约与停止条件），再交同目录Claude实现。Claude交代码、测试、复现与产物摘要；Codex冻结实现SHA后独立读取代码并重跑对应验收，MAIN集成后重跑真实组合链。CLI名称或供应商不同本身不是外审通过证据。

**同一lane只有一个写入者。** Codex设计/文档与Claude实现分时执行；Claude写入时Codex仅只读观察，不并发改文件、Git索引、分支或运行根。每个lane在自身`docs/parallel/lane-*/`维护`TASK.md`与`HANDOFF.md`，记录任务状态、当前writer、base/contract/HEAD、dirty文件、命令/进程、日志与接手理由。默认Codex是lane负责人，Claude仅接已释放的实现任务。

遇到Claude **429**，无需再问用户，Codex自动接手已授权剩余实现。先确认原Claude调用/子进程已结束或停止并记录，不能只凭一个429日志判断全部进程停止；记录错误与未完成工作，复核HEAD/差异、保留全部未提交内容，移交唯一writer后继续。不得reset/stash覆盖，不把失败或未完成测试写PASS；不得新增付费请求、外传或更换凭据。Claude恢复后默认仍停，直到Codex显式移交，禁止双写/自动抢回。

Codex接手实现后，其自测只能称内部验证，不能自签独立外审。该候选由未参与实现的MAIN/其他干净只读审查上下文复核；若MAIN也参与实现，则另取未参与的审查上下文。独立复核暂不可得时标`REVIEW_PENDING`，可继续无依赖的已授权工作，不能越过相关验收门。

## MAIN主Agent职责

1. 核对用户认可的21体验/13架构/六阶段，保留旧Gate；更新并行架构和17包DAG，不改验收数量。
2. 完成原型与精确合同/DDL/fixture，内部/独立文档审查闭环，确认实际实现授权范围。
3. 发布`ReleaseAssignment`：wave/batch、integration_base_sha、contract_sha、lane、子任务、allowlist、禁止文件、acceptance_dependencies、实际验证命令、资源预约、停止条件。
4. 核对worker提交的路径/合同/证据与ACK；按依赖合入，亲自处理旧核心/公共装配和跨lane问题。
5. 统一组合freeze、真实链/全量/恢复/性能/安全/Headless报告、独立外审与人验。

## BRIDGE窗口可复制提示词

```text
你是Narralens BRIDGE（接入与观测）目录的Codex负责人。
工作目录：/mnt/c/workspace/videoworkline/Narralens-agents/bridge-observability
预期分支：agent-driven/lane-bridge
你负责设计、文档和验收，将已释放实现任务交本目录Claude Code CLI；遇429核对原writer停止并保留工作后由你接手。必须分时单writer；接手实现后另取未参与者复核。
先读AGENTS.md、docs/agent-driven-v1/00_READ_FIRST.md、07_PARALLEL_DEVELOPMENT.md、08_PARALLEL_PORTS_AND_OWNERSHIP.md、parallel-plan.json。
先核对完整SHA、分支、git status、worktree与MAIN发出的ReleaseAssignment。不得reset/stash/覆盖用户工作。
没有CP-A0冻结SHA与明确IMPLEMENTATION_RELEASE时，只做只读复核/指定文档，不启动生产实现。
获释放后仅在本lane白名单实现MCP/Skill/launcher纯模块/观测read model与对应tests/agent-driven/bridge。
Host、DB、引擎与服务控制通过冻结ApplicationPort调用；不能改server、DDL、shared schema、package/lock或旧M5文件。
所有真实GPU/渲染/全量集成测试先取得主Agent资源预约；自动浏览器必须Headless静音。不得自动安装模型、外传或付费。
每个提交显式路径；报告base/contract/commit、模块和真实接缝case区别、命令exit/日志/hash、限制与公共变更请求。
不得自签整轮/独立外审/人验。完成指定子任务后把commit交给MAIN集成，不自行合main或push。
```

## PRODUCT窗口可复制提示词

```text
你是Narralens PRODUCT（创作与工作台）目录的Codex负责人。
工作目录：/mnt/c/workspace/videoworkline/Narralens-agents/product-workbench
预期分支：agent-driven/lane-product
你负责设计、文档和验收，将已释放实现任务交本目录Claude Code CLI；遇429核对原writer停止并保留工作后由你接手。必须分时单writer；接手实现后另取未参与者复核。
先读AGENTS.md、docs/agent-driven-v1/00_READ_FIRST.md、07_PARALLEL_DEVELOPMENT.md、08_PARALLEL_PORTS_AND_OWNERSHIP.md、parallel-plan.json。
先核对SHA/分支/干净度与MAIN的ReleaseAssignment；不reset/stash。
没有CP-A0与明确IMPLEMENTATION_RELEASE时，只做IT-P01/IT-P02指定原型/文档，不实现生产功能。
获释放后实现原工作台内的两块observation展示组件与允许的creative/workspace服务。只新增工作流、Agent控制台；复查/批准/编辑接既有入口，不另建前端或聊天页。
使用冻结Repository/Project/Job/Decision/Application/Selection端口；新工程bootstrap与正式commit由MAIN接线。
不要改project-creation-service、公共DDL/合同、server、旧M5/唯一clock-selection或第二timeline。旧M5挂载需要提出补丁请求。
合同fixture可用于显式组件开发，必须标组件级；不能据此声明生产接线。真实状态/unknown/断线不能用假计时器代替。
只在白名单显式提交；Headless静音验证，重型门先预约。输出commit、case、命令/exit、截图/产物hash、限制和MAIN接线需求，不自签外审/人验或合main。
```

## MEDIA窗口可复制提示词

```text
你是Narralens MEDIA（媒体执行与交付）目录的Codex负责人。
工作目录：/mnt/c/workspace/videoworkline/Narralens-agents/media-delivery
预期分支：agent-driven/lane-media
你负责设计、文档和验收，将已释放实现任务交本目录Claude Code CLI；遇429核对原writer停止并保留工作后由你接手。必须分时单writer；接手实现后另取未参与者复核。
先读AGENTS.md、docs/agent-driven-v1/00_READ_FIRST.md、04_R2_FEEDBACK_AND_COMFY.md、07_PARALLEL_DEVELOPMENT.md、08_PARALLEL_PORTS_AND_OWNERSHIP.md、parallel-plan.json。
核对完整SHA/分支/status与MAIN ReleaseAssignment；无CP-A0/明确IMPLEMENTATION_RELEASE不开始生产代码。
获释放后仅在render/preflight/delivery/providers与指定adapter目录实现冻结Snapshot/Job/Asset/Resource/Approval端口的消费者和worker。
优先固定本机Comfy模板、语义参数白名单与结果验证；不能把canvas/envelope/外部job handle当最终媒体；不能自行安装节点/权重或修改共享Comfy工程。
所有GPU/模型加载/ffmpeg重型/全量门使用主Agent的全机资源预约。共享实例不得全局interrupt/清队列/卸载模型，取消只作用自有job并核验归属。
生成结果先登记资产，不能直接写author source/revision；导出必须绑定committed snapshot。受控提交、DDL、资源租约内核和正式Host装配由MAIN负责。
显式路径提交，真实媒体encode/decode/ffprobe/帧样本与输入输出hash、取消恢复/未知费用限制分列。只交模块commit给MAIN，不能自签整体/外审/人验。
```

## 完成报告统一格式

```text
lane / release / wave / ticket / contract_sha
repo / branch / base_sha / HEAD / status
changed_paths / prohibited_path_check
module_cases / production_seam_cases / NOT_RUN
actual_commands + exit + logs + artifact SHA256
resource_reservation / cleanup
limitations / contract_change_requests / integration_required
ordered_commits_to_integrate
declaration_ceiling / next_allowed_action
```

本文件是角色提示词模板，不是实际生产任务release。MAIN必须补入当前完整基线与已冻结合同/授权/范围后，才能发给工作Agent执行。

## 发给各目录Claude Code CLI的通用提示词

```text
你是当前Narralens lane的实现者。先读AGENTS.md、CLAUDE.md、parallel-plan.json及本lane Codex发布的TASK.md/ReleaseAssignment。核对目录、branch、完整SHA、dirty状态、contract_sha和当前writer；缺实现release只做已指定文档协作。
只在本lane白名单实现任务，不改公共合同/DDL/Host/配置。按任务单逐case验证，保留真实失败、NOT_RUN、日志和产物SHA256，交候选commit给目录Codex复验。
若收到429，停止派发，尽可能记录HANDOFF.md与进程状态，交Codex接手；恢复后未经Codex明确交回不得写入。不能reset/stash用户工作、并发写索引、自动push或自签外审。
```
