# BRIDGE A TASK / HANDOFF

当前状态 DESIGN_REVIEW_PENDING，writer=BRIDGE Codex（仅这4份文档）；未来Claude只读检查只写CLAUDE_READINESS.md。无实现release、无测试执行授权、不进入B。Task task_a915784941ed，父MAIN终端term_a731c232-35c7-4f55-a75d-9b2beeade398，BRIDGE Codex窗口term_6b4f4382-d829-4065-b446-97808e041937。

## 输入与完整基线

main-integration HEAD `838ba5f2c8500f0103f56dbe51264ea9f70086fc`；合同来源完整commit `f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450`，cp-a0-r4，candidateLock SHA256 `9d1b12f302bb15922e0586c19e39bcddb1b52eab96c80e25b53ad1c0297e0029`。具体4合同与关键源码SHA256见DESIGN，MAIN消息确认4份合同逐字节一致80defs/31routes。不能用旧lane HEAD替换MAIN。以canonical本轮`docs/execution/A/relaunch-20261111/baseline-observed.json`归档再核现场。

本轮观察dirty（只读保全）：

```text
 M src/host/agent-driven/created-task-gate.ts
 M src/host/agent-driven/created-task-store.ts
 M src/host/agent-driven/created-task-worker.ts
 M src/host/agent-driven/local-asset-registry.ts
 M src/host/engine/source-digest-v1.ts
 M src/host/render/native-draft-assembler.ts
 M tests/agent-driven/integration/created-task-gate.test.ts
 M tests/agent-driven/integration/created-task-store.test.ts
 M tests/agent-driven/integration/created-task-worker.test.ts
?? docs/execution/A/candidates/prepared-draft-verifier/
?? docs/execution/A/logs/created-draft-chain/
?? docs/execution/A/logs/draft-processor-real-1794277917161/
?? docs/execution/A/logs/draft-processor-real-1794278226017/
?? docs/execution/A/reviews/draft-processor-pre-review/
?? src/host/agent-driven/created-draft-processor.ts
?? src/host/agent-driven/prepared-draft-verifier.ts
?? tests/agent-driven/integration/created-draft-processor.test.ts
?? tests/agent-driven/integration/source-digest-resource-boundary.test.ts

```

释放前执行只读 `git rev-parse HEAD`、`git status --short`、`git diff --stat` 和逐文件sha256，与上述及MAIN归档比对；任何未说明差异先暂停该票交MAIN确认。归档存在不代表可覆盖dirty；不cherry-pick/rebase/reset/stash，不改索引、不提交/合并/push。输入不匹配时重新审阅而不是直接回滚别人的代码。

## 按用户路径分组的剩余票据

“立即可实施”指依赖设计可先独立释放，不指本轮准许实现。只在MAIN发布绑定完整SHA/overlay/文件owner的ReleaseAssignment后转writer。

| 票据/映射 | 完整交付与依赖 | 释放顺序 |
|---|---|---|
| BR-A-ENTRY（IT-A01/A02/A03，关联A04） | 在MAIN已落地的stdio/Skill入口模块上补真实接线与回归、可信确认引导、Job/Run/context同回执与断线只读恢复；保留现有协议模块和错误映射。无生产Host时先补严谨消费者回归，不造接口 | 立即可释放现有BRIDGE文件范围；真实联调依赖HOST与四能力就绪 |
| BR-A-HOST（IT-A01/A03/A05）核心独占票 | MAIN共享CreationApplication装配gate/store/worker/processor、task receipts resolver给context/job.read、workflow handlers、取消桥、恢复/exclusions/close。MAIN可独占释放给BRIDGE Claude，不要求MAIN亲写；保护未提交processor/verifier | 立即可审定后释放装配实现；运行开放依赖真facts/可信确认及MEDIA四能力/R1..R4裁决 |
| BR-A-FACTS（IT-A03/A05）共享核心票 | 真ProductFactPort、4能力descriptor/fingerprint、当前资产许可事实、trusted confirmation/approval同tx生产适配；明确与PRODUCT审阅和MEDIA执行器接口 | 依赖MAIN确认权威注入和PRODUCT/MEDIAproducer manifest；未知/缺一能力fail closed，不造grant |
| BR-A-REVIEW（IT-A05/A06） | prepared正式读取(R1)、不可变prepared-source→materialization_id采用映射(R4)、MCP/UI同Decision/impact/Approval，受控adopt后native同步，再正式render | 依赖MAIN批准共享合同/映射、MEDIA source proof与render/QC/delivery、PRODUCT review/native端；不能把prepared当commit |
| BR-A-RECOVER（IT-A01/A02/A03/A05/A06） | 新进程重开、未知写结果对账、取消/失lease/耗尽、cursor重连、单双导出关联证据；ACCEPTANCE 06..10 | HOST后可先轻量故障闭环，真实媒体证据最后由MAIN预约统一集成 |

A全部BRIDGE剩余由以上用户路径覆盖；A02三客户端分别探针仍留真实证据要求，首端Codex业务链先完成，其他客户端发现/兼容探针不冒充B多驱动接力。B通用模板组合、稳定授权、运行图调整、多driver交接不前置。

## 精确文件所有权提案

当前BRIDGE Codex唯一允许写：canonical `docs/execution/A/relaunch-20261111/bridge/{DESIGN.md,ACCEPTANCE.md,TASK.md,CLAUDE_PROMPT.md}`；Claude本轮只允许同目录`CLAUDE_READINESS.md`。下列均是未来释放提案，不是现在白名单：

- ENTRY：`src/mcp/mcp-server.ts`、`src/mcp/host-application-ports.ts`、`src/mcp/host-error-mapping.ts`、`src/mcp/stdio-main.ts`、`skills/narralens/SKILL.md`、`tests/agent-driven/bridge/mcp-host-client.test.ts`、`tests/agent-driven/bridge/mcp-registry.test.ts`、`tests/agent-driven/bridge/mcp-stdio-client.test.ts`、`tests/agent-driven/bridge/cursor-events.test.ts`。只有实际需要修改者进入release，不全目录授权。
- HOST：`src/host/agent-driven/creation-application.ts`、`src/host/agent-driven/application-dispatcher.ts`、`src/host/agent-driven/project-context-service.ts`、`src/host/server.ts`；验证`tests/agent-driven/integration/host-application.test.ts`、`host-close-lifecycle.test.ts`、`creative-context-host.test.ts`、`created-task-worker.test.ts`、`created-task-store.test.ts`、`created-task-gate.test.ts`（后三者同tests/agent-driven/integration目录）。MAIN须逐项独占释放，server.ts不可多人接线。
- FACTS拟新增`src/host/agent-driven/created-run-facts.ts`、`src/host/agent-driven/created-run-authority.ts`；这些名字是提案；验证复用`tests/agent-driven/integration/capability-fingerprint.test.ts`、`host-application.test.ts`、`scoped-auth.test.ts`。新文件只有MAIN确定精确接口后释放。
- REVIEW/RECOVER：先由MAIN裁决R1/R4，白名单待批准后追加，未列文件一律不可写；不以任务标题隐含开放DDL/合同/采用核心。当前receipt/Host验证可用HOST既有名单，MEDIA processor/verifier测试由其owner保管。

禁止路径：contracts/**、src/contracts/**、package.json/pnpm-lock.yaml/所有配置、AGENTS.md、其他领域文档、src/app/**、src/host/render/**、src/host/engine/**、src/host/projects/**、vendor/上游、运行根/DB/素材/证据历史；除MAIN未来逐文件明确解除的共享路径外不写。未提交created-draft-processor.ts/prepared-draft-verifier.ts/local-asset-registry.ts/created-task-{store,gate,worker}.ts保留；未来如需要修改先MAIN释放其当前hash和writer，不能重做旧候选。

## 分阶段交付、资源与回退

S0本轮：4文档→MAIN审阅→可见Claude只读readiness（现有MiniMax配置，不读凭据）→领域修订可闭环设计问题→MAIN开发启动门；全部产品NOT_RUN。
S1授权后：先ENTRY/HOST轻量接线及事务/恢复负例，C1/C2/C3/C5/C6/C8；每lane一个writer、隔离运行根，默认maxWorkers=1。只读模块审查不能改测试输入后沿用旧绿灯。
S2依赖后：四能力真facts、R1/R4采用读取、PRODUCT UI确认同步、MEDIA真实执行器联调；持续对账，不等所有模块“结束”才首次连线。
S3 MAIN预约全机单重型槽：真实Host多进程/全量/build/Headless/ffmpeg/媒体/原生工作台/T20与双导出。没有授权不能下载模型、付费、外传、访问J盘；本轮不执行任何S1..S3。

回退：未来接线失败关闭新增路由/能力advertisement恢复fail closed，保留原job/CP/证据并先对账；不得回滚已发布commit或删除prepared证据。代码回退只撤自己经MAIN核定的patch，保留输入overlay；涉及DDL迁移/持久语义须MAIN单独给恢复方案。UNKNOWN写结果查询原idempotency/job，禁止自动新key重试。

停止条件：合同hash或HEAD漂移/未知dirty；owner冲突；需要未批准接口或白名单外文件；无真facts/许可/可信确认/四能力；运行根重叠；无法证明旧writer/子进程停止；429后先保全并向MAIN记录，只有本来已授权实现才可能转Codex，当前只读授权不升级成实现；同阶段>2次返工MAIN根因接管；A人工门未过不进B。

## HANDOFF必须追加的事实

writer移交时间与双方实际handle/dispatch、完整SHA/dirty/hash、票据release ID、修改文件、命令/exit/资源槽、产物hash与失败证据、剩余阻塞/合同请求、进程与锁是否结束。开发自测、领域复核、MAIN集成、独立验收、人工验收分别记，不混PASS。

Claude子窗口初始状态为NOT_STARTED；实际启动和最终完成见文末。父BRIDGE文档写入结束才派发Claude，Claude仅readiness文件写入；收到结果后Codex只修订4文档内确定问题，再向MAIN回报真实dispatch/handle/状态，不自行开始代码。

新增合同依赖R5：现有guard不允许waiting_user的impact/apply，decideReview也不推进原attempt。BR-A-REVIEW在MAIN批准专用采用authority之前BLOCKED_FOR_CONTRACT；不得放宽一般dispatch states。若批准涉及`src/host/creative/execution-guard.ts`、`fixed-workflow-service.ts`、`product-repository.ts`或采用核心，MAIN须新增精确独占文件释放，当前名单不授权它们。HOST可以先装配fail-closed的读/恢复链，不能宣称可用Run或完整采用。

R6素材发现纳入BR-A-ENTRY/FACTS：BRIDGE负责readonly inventory附属HTTP/resource、Ref映射与Host装配；依赖MAIN冻结独立transport规范、PRODUCT可信UI输入、MEDIA registry/import。现有80defs/31routes不改。可先做现有协议消费回归设计；新增inventory文件/资源名未冻结，不列即时实现白名单，待MAIN逐文件独占释放。新增合同不得隐含授Agent写许可权限。

Claude实际启动记录：首个--spec-file WSL路径在Windows CLI读文件阶段ENOENT，worker-list及run task-list确认无BRIDGE子Task/Dispatch创建；读取实时recovery guide后以同文件Windows路径重发，未重复启动已有worker。成功Task `task_e8bb4549c314`，Dispatch `ctx_55ed85325974`，handle `term_f361b74a-b799-4f1a-8172-f3e44bd052e9`，mode=terminal，state=ready，keepOpen=true，父task_a915784941ed；模型由子会话自报待核，不能由agent=claude推断。当前等Orca唤醒，无产品服务/测试启动。

## 最终HANDOFF（只读检查已完成）

Claude Task task_e8bb4549c314 / Dispatch ctx_55ed85325974 / handle term_f361b74a-b799-4f1a-8172-f3e44bd052e9；worker_done outcome=succeeded、readiness=NEEDS_REVISION，kept-open。模型自报MiniMax-M3.1-Flash-Preview[1m]、匹配TRUE；CLI真实pnpm10.31.0与声明10.33.0不一致（node22.22.1满足），依赖可见但未验证可执行。MAIN release须选择已有正确工具链或明确批准版本差异，不自行安装/改配置。

Codex修订闭环：F01/F02明确“生产适配缺实现”，F03/F04旧证据不覆盖overlay，F07表为17路由子集+完整覆盖统计，F08窗口角色区分，F10补变异断言表，F11明确复用已落地模块。F13不是协议不可能：客户端不得给effect/proof与Host从HTTP handler构造effect可以共存；最终wire调用归属交MAIN签定。F03“无显式PASS”与实读追加Closure段不符，保留报告但只承认旧hash局部PASS不覆盖当前。

D01..D07均原则ACK，以DESIGN末尾表为当前选择，替代前文未定的R1/R4/R6备选；D04 wire/impact目标snapshot分配、D05原Job持久端口/子动作键仍须MAIN最终明确，REVIEW和正式delivery验证未释放。未来所有共有实现文件由MAIN独占给一个BRIDGE Claude core writer，MEDIA仅render执行器，PRODUCT仅UI；跨目录不等于多人写同文件。现有共享release建议须扩展为MAIN审核的精确文件集：execution-guard.ts、fixed-workflow-service.ts、product-repository.ts（均src/host/creative下）；以及新prepared change/facts/authority服务和DDL文件具体名字由MAIN一次性锁定后下发，不允许实施者自己选。

BR-A-RECOVER真实媒体部分/BR-A-10明确依赖D05原Job持久端口与MEDIA分段执行器冻结。可先实施仅ENTRY、fail-closed HOST和其后的轻量RECOVER；本轮依然无生产实现授权。领域复核完成、MAIN最终合同与开发启动门待审，所有产品NOT_RUN。

## 新Task task_5277ee402d9f定向闭环

D08–D12已读取并按DESIGN末尾ACK，替代R5 wire/impact/持久端口的旧开放选择。MAIN指定BRIDGE Claude为新created-run-facts/authority、created-source-change/impact/adoption store/service、publisher、fixed-phase-executor及同库DDL/RevisionStore共享core唯一writer；MEDIA仅阶段执行器，PRODUCT仅UI。具体03_OWNERSHIP_AND_DEPENDENCIES.json本次读取尚不存在，等待MAIN落盘后按实际完整路径接收，不能扩大当前白名单。
Claude定向复核通过原dispatch消息续派，followUpOf ctx_55ed85325974，新Task task_0bd1d303a11c / Dispatch ctx_aca9dc7af0f2 / handle term_c7b45237e89f62cd4defe27cbb8c6f00，receipt ready；不是假称沿旧handle运行，当前等结果。仍仅可追加CLAUDE_READINESS.md，产品NOT_RUN。

最新MAIN输入对齐：03_OWNERSHIP_AND_DEPENDENCIES.json已落盘，120项路径均唯一，其中BRIDGE 65项；之前ENOENT为历史观察，现已关闭。具体文件白名单和R0–R4依赖以该表为唯一设计分配权威，覆盖本文早期拟名单，仍须未来ReleaseAssignment才有实现权。review-media-v1.registry.json明确新增只读GET（鉴权opaque Ref、真实bytes/Range、无渲染副作用），当前总协议扩面=原31 HTTP+附属5 HTTP、另增1 MCP resource，不能仍称仅4附属HTTP。新文件尚不存在是计划实现状态，不是未定义语义；准确工具链入口为目标worktree corepack pnpm --version，子窗口只读核验中。

03权威表SHA256 `3a45a799b3d9ee7aabd7dc7922d2d1db6f78979ebc8c454f339cedfd1c6e1261`；BRIDGE具体路径子集如下（仅设计分配，不是当下许可）：

- `src/host/server.ts`
- `src/host/agent-driven/creation-application.ts`
- `src/host/agent-driven/application-dispatcher.ts`
- `src/host/agent-driven/project-context-service.ts`
- `src/host/agent-driven/created-task-store.ts`
- `src/host/agent-driven/created-task-gate.ts`
- `src/host/agent-driven/created-task-worker.ts`
- `src/host/agent-driven/local-asset-registry.ts`
- `src/host/agent-driven/committed-snapshot-authority.ts`
- `src/host/agent-driven/product-sqlite-repository.ts`
- `src/host/agent-driven/created-run-facts.ts`
- `src/host/agent-driven/created-run-authority.ts`
- `src/host/agent-driven/created-task-application.ts`
- `src/host/agent-driven/created-source-change-service.ts`
- `src/host/agent-driven/created-source-impact-store.ts`
- `src/host/agent-driven/created-source-adoption-store.ts`
- `src/host/agent-driven/created-source-adoption-service.ts`
- `src/host/agent-driven/created-source-publisher.ts`
- `src/host/agent-driven/fixed-phase-executor.ts`
- `src/host/agent-driven/created-render-delivery-store.ts`
- `src/host/agent-driven/local-asset-http.ts`
- `src/host/agent-driven/asset-inventory.ts`
- `src/host/creative/execution-guard.ts`
- `src/host/creative/fixed-workflow-service.ts`
- `src/host/creative/product-repository.ts`
- `src/host/projects/revision-store.ts`
- `src/host/projects/project-creation-store.ts`
- `src/host/projects/project-coordinator.ts`
- `src/host/projects/project-resolver.ts`
- `src/host/impact/impact-store.ts`
- `src/host/agent-driven/start-runtime.ts`
- `src/host/agent-driven/observation-cursor-ports.ts`
- `src/mcp/mcp-server.ts`
- `src/mcp/host-application-ports.ts`
- `src/mcp/host-error-mapping.ts`
- `src/mcp/asset-inventory-resource.ts`
- `src/mcp/stdio-main.ts`
- `src/launcher/workbench-entry.ts`
- `skills/narralens/SKILL.md`
- `contracts/agent-local-assets-v1.schema.json`
- `contracts/agent-local-assets-v1.registry.json`
- `src/contracts/agent-local-assets-types.ts`
- `src/contracts/agent-local-assets-validator.ts`
- `tests/agent-driven/integration/host-application.test.ts`
- `tests/agent-driven/integration/host-close-lifecycle.test.ts`
- `tests/agent-driven/integration/creative-context-host.test.ts`
- `tests/agent-driven/integration/created-task-store.test.ts`
- `tests/agent-driven/integration/created-task-gate.test.ts`
- `tests/agent-driven/integration/created-task-worker.test.ts`
- `tests/agent-driven/integration/created-run-authority.test.ts`
- `tests/agent-driven/integration/created-source-change.test.ts`
- `tests/agent-driven/integration/created-source-adoption.test.ts`
- `tests/agent-driven/integration/created-source-process-recovery.test.ts`
- `tests/agent-driven/integration/created-render-delivery.test.ts`
- `tests/agent-driven/integration/created-delivery-recovery.test.ts`
- `tests/agent-driven/integration/local-assets-transport.test.ts`
- `tests/agent-driven/bridge/mcp-host-client.test.ts`
- `tests/agent-driven/bridge/mcp-registry.test.ts`
- `tests/agent-driven/bridge/mcp-stdio-client.test.ts`
- `tests/agent-driven/bridge/cursor-events.test.ts`
- `tests/agent-driven/product/fixed-workflow-service.test.ts`
- `tests/agent-driven/product/execution-guard.test.ts`
- `package.json`
- `src/host/agent-driven/review-media-http.ts`
- `tests/agent-driven/integration/review-media-transport.test.ts`

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

最终03权威表读取SHA256 `d0fe36ea8951220ac5cf657c0e060b8b84442eed21291ea5095e4d9a2975b70c`；完整路径集合为03.files中writer=bridge-Claude的68项，覆盖先前65项抄录；未列精确路径仍禁止写。只读readiness SHA256 `fff1fa9331f89298dfe84c51a0e63c356de8d2a894e5ba467ba8f584e4b0a30d`。

Orca正式结算：收到msg_54873b3c7a82，Claude ctx_aca9dc7af0f2 / task_0bd1d303a11c worker_done outcome=succeeded；定向复核已完成，不只是报告存在或live状态推断。BRIDGE本次task_5277ee402d9f交付四文档最终ACK，所有子任务已报告完成。

封包前最终状态：已核对MAIN 02末尾三项精度补充与04独立复核排程，attestation_ref 63字符/最大64、设计到运行时schema映射、R0/R2/R4未参与实现者复核均已明确，三项非阻塞观察全部关闭。Claude ctx_aca9dc7af0f2已正式succeeded且readiness第10节ACK，无剩余设计阻塞；本领域文档写入结束，可由MAIN封包。implementation NOT_STARTED，产品验收全部NOT_RUN，不另启worker或扩大审查。
