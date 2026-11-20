# Narralens A BRIDGE Claude · 只读启动检查

你是MAIN→BRIDGE Codex→ClaudeCode三级可见窗口的第三层。本次只做开发启动检查，不开发、不测试。父任务task_a915784941ed，父终端term_6b4f4382-d829-4065-b446-97808e041937；通过Orca orchestration返回，不自建PTY、不派子worker。使用现有用户ClaudeCode/MiniMax配置，不改模型、不读凭据、不输出key、不新外传。

## 当前唯一授权

只读核对下面4份文档与实际代码，唯一可写文件：
`/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/relaunch-20261111/bridge/CLAUDE_READINESS.md`。
不得写其他文件，包括产品代码、配置、AGENTS、4份父文档、Git索引；不得运行测试/typecheck/build/install/render/启动产品服务，不能提交/合并/push/cherry-pick/rebase/reset/stash，不得清理dirty或修产品缺陷。业务验收全部NOT_RUN。仅允许读取文件、git只读状态、路径/CLI可达性和会话自身已公开模型信息。CLI查询不能启动另一个模型会话；不得读取密钥/认证配置来猜模型。

## 阅读顺序

1. `/mnt/c/workspace/videoworkline/Narralens/AGENTS.md`；同目录`docs/agent-driven-v1/11_AGENT_DELIVERY_PROCESS.md`；`execution-planning/01_EFFORT_AND_STAGE_PLAN.md`与`implementation-design/07_EXPERIENCE_SPEC.md`、`08_WORKFLOW_MCP_CONTRACT.md`（后3路径均相对docs/agent-driven-v1）。
2. canonical `docs/execution/A/contract-freeze.json`、`docs/execution/A/relaunch-20261111/baseline-observed.json`；再读本目录DESIGN.md、ACCEPTANCE.md、TASK.md和本文件。
3. 源码事实目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD必须实核`838ba5f2c8500f0103f56dbe51264ea9f70086fc`及dirty；读DESIGN列举的4合同/package scripts/creation-application/current dispatcher/fixed-workflow-service/created-task-store/gate/worker/processor/verifier/product-facts/project-context-service/server lifecycle。
4. 读本领域现有`docs/parallel/lane-bridge/TASK.md`、HANDOFF.md及任务候选/测试，只对MAIN真实文件判断实现程度。旧lane与MAIN基线不同，不能从旧lane缺代码断言MAIN没有实现。
5. `/home/administrator/.agents/skills/orca-cli/SKILL.md`和`orchestration/SKILL.md`，用ORCA_CLI_COMMAND同一二进制读取实时guide，按当前派发preamble完成回报。

路径映射：canonical Windows `C:\workSpace\videoWorkLine\Narralens`与本机`/mnt/c/workspace/videoworkline/Narralens`指同一项目；只用真实可达映射，不新建替代项目。当前Orca工作目录可能是上层workspace，必须记录实际cwd并用绝对路径读取MAIN。

## 本轮检查任务

- 记录真实CLI/cwd/路径可达性，node>=22.15.0、pnpm10.33.0与现有依赖是否可见（只读存在性/版本，不安装）。
- 记录会话自己报告的模型名及来源，是否与用户MiniMax一致；没有可信会话信息写UNKNOWN，不从Claude CLI品牌推定Anthropic或MiniMax，不查凭据。
- 核对4文档是否足以接手：代码实体/字段/producer-consumer、完整SHA+dirty、MAIN共享释放范围、四能力依赖、prepared≠commit、生产trusted confirmation不等于测试Grant、R1/R4仍提案、实际测试命令与逐case变异反例、启动恢复/generic reaper/关闭顺序、writer/HANDOFF、重型资源与回退停止条件。
- 列出确定的设计错误、缺失输入、阻塞及最小修订建议，区分“现有实现”“局部历史通过”“未接通”“等待MAIN合同裁决”。尤其核对Frozen31 routes/80defs不扩大协议；判断立即可释放票与依赖后票是否清楚。
- 不能把只读就绪检查称独立产品验收，结论用READY_FOR_MAIN_REVIEW / NEEDS_REVISION / BLOCKED；即使READY也不自动写代码。

## 未来开发说明（本轮禁止执行）

只有MAIN发布具体ReleaseAssignment且BRIDGE转移唯一writer，才按TASK票据编码。先重新核HEAD/overlay/hash、精确白名单与合同；完整用户路径为ENTRY/HOST→FACTS四能力→REVIEW受控采用→RECOVER正式双导出证据，优先复用实际模块。轻量开发自验证采用ACCEPTANCE中C1..C8对应命令，先负例/事务回滚/旧lease/取消/恢复，再正向；C4真实媒体及C9/C10/多Host/Headless/渲染须MAIN资源预约。不得绕过MAIN R1..R4裁决或把测试port置入生产。失败如实保留，不修绿历史Gate，不进入B。

## 本轮交付模板

CLAUDE_READINESS.md需包含：
- 时间、实际cwd/CLI、模型报告及MiniMax匹配TRUE/FALSE/UNKNOWN（依据且无凭据）。
- MAIN完整HEAD、dirty摘要与关键输入hash核对结果；路径可达性和依赖观察。
- 4文档逐份可接手判断；已确认代码符号/调用点；阻塞/缺项/修改建议；可先实施票与依赖票。
- 本轮命令清单（只读），全部产品验证NOT_RUN；结论与唯一写入文件。
- 未来开发交付模板：release/ticket/writer/基线/改动文件/真实命令及exit/证据hash/首次失败/剩余风险/回退/进程资源结束状态/请求MAIN裁决项；不得自签独立审查。

完成后按本次Orca派发preamble发送worker_done恰一次给BRIDGE，报告readiness路径和真实发现；若启动或授权路径阻塞按preamble升级。不继续工作、不sleep/poll，等待新任务。

追加重点：阅读MAIN relaunch的02_MAIN_CONTRACT_AND_DECISIONS.md和05_MAIN_ACCEPTANCE_AND_REVIEW.md，并核对DESIGN新增R5 waiting_user循环。现有guard仅Run ready/running及attempt pending/running，decideReview不重置attempt；请检查R5专用采用分支提案是否仍缺明确门，不能自行实现或放宽状态。R5未获MAIN裁决时REVIEW不可释放。

## 启动检查完成后的交接补充（给未来实施者）

本次只读检查已完成，原报告CLAUDE_READINESS.md保留；D01..D07原则ACK和剩余精确裁决见DESIGN末尾，旧R1/R4/R6备选由D02/D03/D01选择替代。生产facts/adoption与change.*适配确实尚缺实现，不是仅注册；现有MCP/launcher已在MAIN，复用而不重写。旧closure虽有显式追加PASS但未覆盖当前overlay，verifier候选manifest亦旧，不继承结论。pnpm实测10.31.0而声明10.33.0，MAIN释放前确认工具链。未来只有MAIN最终定案D04 wire/impact目标snapshot、D05持久端口/动作键、共同SHA和逐文件单writer之后才能执行依赖票；本文件从未授权本轮编码。

## D08–D12定向复核范围（当前仍只读）

MAIN新任务要求只审D08–D12与contracts/asset-inventory-v1.{schema,registry}.json，保留旧readiness历史，唯一写CLAUDE_READINESS.md追加节。D08冻结HTTP→Host内部effect可共存；D09预期snapshotIdFor不发布；D10新created typed commit不伪migration；D11单Job去重/子阶段receipt；D12承认4HTTP+1resource附属扩面。给具体反例或ACK，不重跑历史业务检查。关注Ref.version精确1、InventoryItem响应definition验证、uri:null适配及候选过期成功重放。R0再验证当前字节，历史显式PASS不套用当前overlay；03名单缺失时只记实际，不自行造文件。

最新MAIN输入对齐：03_OWNERSHIP_AND_DEPENDENCIES.json已落盘，120项路径均唯一，其中BRIDGE 65项；之前ENOENT为历史观察，现已关闭。具体文件白名单和R0–R4依赖以该表为唯一设计分配权威，覆盖本文早期拟名单，仍须未来ReleaseAssignment才有实现权。review-media-v1.registry.json明确新增只读GET（鉴权opaque Ref、真实bytes/Range、无渲染副作用），当前总协议扩面=原31 HTTP+附属5 HTTP、另增1 MCP resource，不能仍称仅4附属HTTP。新文件尚不存在是计划实现状态，不是未定义语义；准确工具链入口为目标worktree corepack pnpm --version，子窗口只读核验中。

## D13–D15覆盖性定案ACK

本节取代前文同名表/自动QC的早期提案：新增事实统一created_*（created_prepared_source/impact_fact/adoption_fact/render_evidence/delivery_phase_fact/review_gate_fact/qc_disposition_fact），不改cp_a0_*精确matcher或冻结DDL；各独立namespace版本检查，不借IF NOT EXISTS掩盖漂移。D13 SOURCE_ONLY由成功job terminal_reason/provider receipt+真实prepared digest证明，成功Job没有live lease；采用只读proveForAdoption绑定当前受控事务与FD，绝不重新claim成功Job。ACK。

D14 encode close→私有不可变对象fsync→同原Job/lease登记EncodedFact，再QC，phase+parent digest不可变链，无第二state。producer lease与publication winner attempt分别保存；包receipt和DB ready共同成立才能下载，取消/失lease晚到隔离。ACK。

D15技术QC仅产证据/pending门，不能自动accepted；Host-only publishQcReviewPackage以完整chapter_pack与不可变gate fact绑定qc，可信review.decide才接受，无block且明确当前warn处置。待审同snapshot_publish Job queued释放lease，claim必须过滤pending QC；接受后同Job新lease、原execution attempt真实执行package并恢复running，暂停/取消/过期仍阻止。旧普通章节映射不变，客户端不提交target_gate。ACK。

当前123条所有权全部唯一（取代前120条统计）；未来代码尚不存在不再列为设计阻塞。唯一尚见规范可执行不一致：asset-inventory schema的rights_ref.version仍允许2而registry要求1，应const:1；InventoryItem POST响应需明确按definition验证。均可MAIN直接修正文档合同，无需新架构决策。所有产品验收NOT_RUN，等Claude定向回报。

MAIN最终修订复核：已实读asset-inventory schema，rights_ref.version={const:1}且顶层anyOf已包含InventoryItem，前述两项精确性反馈关闭；标签/lineage合法既有范围按MAIN最终schema。02(D01–D15)、03及06_MAIN_REVIEW_AND_START_GATE.md为当前权威，覆盖本文前期备选/待定描述。未来实施入口为../implementation-prompts/bridge.md（与本轮只读CLAUDE_PROMPT分开），只在下一轮正式授权、R0共同SHA及ReleaseAssignment/单writer就绪后执行。本轮只到开发启动准备门，全部产品NOT_RUN；Claude最后定向ACK仍待实际回报，不预写已完成。

## 最终定向复核回执（覆盖前文等待状态）

已实读CLAUDE_READINESS.md第10节，ctx_aca9dc7af0f2 / task_0bd1d303a11c / handle term_c7b45237e89f62cd4defe27cbb8c6f00：F01/F02/F13/F14/F15/F16全部ACK，无阻塞；F03确认旧追加显式PASS但仅旧hash，R0重审当前overlay；F09在子窗口目标main-integration准确执行corepack pnpm --version=10.33.0，无安装。报告历史不改写，仅本节记录当前结论。

123条唯一writer分配中BRIDGE68项，以03当前内容为准，旧120/65统计仅历史。MAIN已接收三项非阻塞完善：attestation_ref ui_+first60hex总63字符且<=64；设计asset-inventory-v1.*与运行时agent-local-assets-v1.*一一映射；R0/R2/R4安排未参与实现者独立复核。无需再审或自行扩任务。D01–D15设计最终ACK，未实现新文件均未来工作，不是未定义语义。

本轮仅准备门：产品实现NOT_STARTED，业务测试/构建/渲染/服务/验收全部NOT_RUN。未来按MAIN implementation-prompts/bridge.md、02/03/06和R0共同SHA+ReleaseAssignment/单writer交接执行，不凭本次ACK启动开发或进入B。

封包前最终状态：已核对MAIN 02末尾三项精度补充与04独立复核排程，attestation_ref 63字符/最大64、设计到运行时schema映射、R0/R2/R4未参与实现者复核均已明确，三项非阻塞观察全部关闭。Claude ctx_aca9dc7af0f2已正式succeeded且readiness第10节ACK，无剩余设计阻塞；本领域文档写入结束，可由MAIN封包。implementation NOT_STARTED，产品验收全部NOT_RUN，不另启worker或扩大审查。
