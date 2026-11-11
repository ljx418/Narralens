# A-R1-BRIDGE Claude 实施交接候选（未激活）

本文件前置约束覆盖下方完整原始提示词中较宽的A范围和历史基线；原文保留为实施基座，不是新的架构设计。

当前 **PREPARED_NOT_RELEASED / DO_NOT_EXECUTE**。不得启动Claude，凭据事件等待MAIN确认；当前Codex只写本目录三文档，无实现或测试许可。收到MAIN RELEASED、凭据处置确认、唯一writer交接后才执行。

实际cwd=/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-BRIDGE；base=9f583239714835a89332fcae9363aa39d887821d；contract=ca5b67a8285b130c79055317c6202f73cfbb99c8；preparation manifest=2a847488f59259b196caeb22e0407327583fed6985516ed16fa9bf9a87aad0c0。只在此checkout工作，不写canonical或旧研究lane。TASK.md包含现场四合同hash、45路径聚焦清单（54项release上限内）、现有/拟新增状态、接口/逐case命令及停止条件，必须完整读取。

精确R1：BR-A-ENTRY/HOST/FACTS、本地素材登记/库存及review-media只读transport、R0-M01同库同步graceful release和真实CP shutdown/reopen/resume。先关闭R0-M01再生产worker激活；复用现有processor/verifier，不重复R0审查或跨MEDIA写。四真实能力缺一继续503/blocked，真实producer没有就不发空202。registerApproval没有R2当前impact/包权威时fail closed；不实现created adoption/publisher/final delivery、不创建未来R2/R3表、不要求后续阶段完成才能交R1适配。

下方原提示词主线1/2/3仅在本票具体范围适用；主线4/5与BR-A-05/10、正式采用/导出/T20均只作后续约束，**不在本票执行**。MAIN封存包里的历史IMPLEMENTATION_RELEASE不能自行改写；以后以MAIN当前implementation-20261111实际release记录与本票ReleaseAssignment为激活证据，不把旧NOT_RELEASED文案误当永久暂停，也不把用户总授权误当本次已移交writer。

消费者先遵守已审D01–D15。待MAIN交MEDIA准确FD reader export和真实能力manifest接入，不自造生产proof。R0-M01可在store/application adapter完成，不抢写MEDIA processor；若必须改签名报MAIN精确owner请求。失败/NOT_RUN保留；模块自测不签独立复核/A人验。无子worker、无凭据/配置/env读取，无网络/安装/供应商切换；MAIN安排依赖与重型资源。429与>2返工遵TASK和MAIN明确交接，先确认旧进程停止。

---

## 完整已审实施提示词基座（逐字保留）

# BRIDGE ClaudeCode（MiniMax）A阶段实施提示词

本提示词是下一轮正式实施输入，**本轮只读检查不执行它**。先核MAIN实际发放的IMPLEMENTATION_RELEASE与此lane ReleaseAssignment；没有实施授权或status不是RELEASED，仅向所属Codex报告NOT_RELEASED，不写产品代码、不运行测试或服务。本提示词/文档认可本身不产生release。

## 阅读顺序与保全

canonical /mnt/c/workspace/videoworkline/Narralens（Windows C:\workSpace\videoWorkLine\Narralens）；包docs/execution/A/relaunch-20261111。先读canonical AGENTS.md、docs/AGENT_MEMORY.md、docs/agent-driven-v1/11_AGENT_DELIVERY_PROCESS.md，再本包00_READ_FIRST、02_MAIN_CONTRACT_AND_DECISIONS（D01-D15全篇，末节覆盖旧草案）、03_OWNERSHIP_AND_DEPENDENCIES.json、04_COORDINATED_EXECUTION_PLAN、05_MAIN_ACCEPTANCE_AND_REVIEW、06_MAIN_REVIEW_AND_START_GATE，然后bridge/DESIGN、ACCEPTANCE、TASK以及CLAUDE_READINESS的原发现/后续关闭记录。

已观察MAIN HEAD 838ba5f2c8500f0103f56dbe51264ea9f70086fc + baseline-observed.json中25文件overlay；原合同commit ca5b67a8285b130c79055317c6202f73cfbb99c8，文档commit f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450。共同新实施commit应由R0实际生成，再由MAIN填写；不要捏造SHA或自行改base。按release.directory执行git rev-parse HEAD/status，核完整SHA、contract manifest和overlay/候选hash；若不是所述实际版本先报领域Codex，不reset/stash/rebase/cherry-pick覆盖。研究lane不是最新MAIN来源，保持所有未提交候选。

## 职责与写入范围

你是具体编码/接线/开发子阶段自验证节点；所属BRIDGE Codex负责详细设计、文档和领域复核，MAIN负责总合同/跨领域协调与大阶段验收。唯一允许产品文件是MAIN实际ReleaseAssignment与03表中分给bridge-Claude且本票已释放的**交集**。禁止默认全目录授权；未列文件或需要改冻结合同，先报Codex提出精确请求。共用文件有唯一writer，其他窗口只读；不用全目录git add，不自动push/合主干。

保持同Host/RevisionStore连接/原Job与lease/step_attempt/Coordinator/project_transaction、原生七方法EnginePort、strict409、一个引擎绑定与同Studio timeline/selection/clock。不能新项目/第二DB/第二队列或写源旁路。新created_*事实表不是第二状态机，不能污染精确cp_a0_* namespace。31原路由/80defs/冻结SQL不暗改；附属5HTTP+1resource单独schema/注册/版本计数。

## 本领域实施主线（BR-A-ENTRY/HOST/FACTS/REVIEW/RECOVER）

1. R0由MAIN协调先保护/核对当前候选。接线时保留现有MCP/启动器代码；同repo/authority/workflow实例装配真实ProductFactPort、TrustedAdoptionAuthority和workflowHandlers，不能仅注册路由。四真实能力及许可未就绪就继续503/blocked，不硬编码true、不引测试Grant。
2. CreatedTask store/gate/worker/实际processor接入task.prepare、job.read/cancel及Context统一receipt，listen专用恢复先于generic reaper并动态合并排除集；关闭拒新写→await worker/processor/proof/assets/native→DB。真实重开、queued取消/耗尽/lease丢失各自Job/CP收敛。
3. 依据contracts/附属设计接可信UI素材候选/登记与只读inventory/MCP resource、review-media只读读取。Host解析candidate并计算选中文件hash，界面不传任意路径/声明主体，rights Ref必须回真实同project row验证。sourceRoot未配置不扫描其它盘；GET不编码/登记。
4. 依D02/D08-D10/D13实施created源Change服务、合法ps_ resolver、同impact状态权威和私有事实；原change.* HTTP验证后在服务内构造窄effect，禁止客户端提交proof或放宽普通dispatch集合。review.decide和change.approve复用唯一批准权威；CreatedSourcePublisher完整source树发布/恢复；同RevisionStore typed commit原子消费Approval/impact、+1/pointer/snapshot/CreatedSourceFact/step/outbox/idempotency，无假migration_id。
5. D11/D14/D15同原Job执行确定的最终QC→待人类决定→同Job继续package。编码证据与发布包/DB ready分别核；new tables只用created_*。最终chapter_pack通过Host-only qc gate binding明确目标门，普通章包不能假冒QC，不自动接受QC、不可由守卫写Gate。真实T20与首端MCP/取消/重开/双导出由MAIN调度。

必须重点验证：事实端口缺一能力拒绝；可信actor/session/用途错配拒绝；跨项目ps/rights/引用404；current base变化严格409；prepared完成并无live lease时用新adoption proof；重复采用+1一次；accepted review而commit未到时不显示成功或允许依赖导出；多个Agent/worker晚到无越权。生产端口/DDL由你独占，但媒体函数/PRODUCT UI不得跨owner直接改。

## 连续开发、自验证和证据

按领域ACCEPTANCE逐case完成；先最窄真实路径再负向矩阵，不为每个函数停下来问人。既有通过模块复用，无确定缺陷不重写。纯fixture只证明组件，真实Host/CLI/媒体/浏览器分别标证据；无测试替身注入生产。不得为过测放松guard/超时/合同，未知异常不一律归因ENOMEM；保留第一失败与修复后证据，重要负向必须能在旧违规实现上打红。

工具链先在实际worktree用corepack pnpm --version确认10.33.0、node>=22.15.0，只读元信息可查；禁止自行安装/下载、读取用户配置/凭据或全量env。模型只采信会话自报，UNKNOWN也可；禁止为验证供应商读取~/.claude、~/.codex、.env或密钥。凭据事件见audit/CREDENTIAL_EVENT，相关人类处置由MAIN负责。

以下是**实施释放后**才执行的已存在入口（命令cwd=release.directory）；具体新case文件在创建后纳入同一test过滤，不冒称现在已有：
- corepack pnpm exec tsc --noEmit
- corepack pnpm test tests/agent-driven/bridge tests/agent-driven/integration/created-task-store.test.ts tests/agent-driven/integration/created-task-worker.test.ts tests/agent-driven/integration/created-task-gate.test.ts --maxWorkers=1 --minWorkers=1
- corepack pnpm test:contracts
- corepack pnpm build（需要MAIN重型资源预约）

全量corepack pnpm check、多Host/ffmpeg/Headless/GPU大fixture由MAIN全机单槽统一预约，不能三窗口各跑一套。自动化Headless、静音、无弹窗/焦点抢占；每个Host/profile/DB/var/staging独立并精确清理，禁止kill所有浏览器/服务。不读J盘/不付费/不新外传或切供应商，除非当前任务明确授权。

交付记录ticket、base/contract/实现完整SHA、dirty manifest/修改文件与来源、真实命令cwd/开始结束/exit/日志和SHA256、逐case PASS/FAIL/NOT_RUN、恢复/回退/进程清理/剩余依赖。git只显式add本票文件，冻结后交所属Codex只读复核。子阶段自测不能签独立或人验；实际Orca task/from以注入preamble为准，不复用旧任务ID。

429：记录错误，停止写入并把dirty/在途命令交Codex；Codex核实旧调用及子进程停止后才接管。超过两次返工由MAIN接管共同根因，不机械反复重试。服务422/529等按真实原因保留，不改模型/配置逃避。未知写结果读原idempotency/job/receipt，不能换key盲重发。

停止在本票实际出门条件或真实越权/高风险阻塞；将结果回所属Codex，不进入未释放票据。A末由MAIN统一全量/独立审查/中文HTML/人工入口，不自行宣称A/V1通过，不进入B。
