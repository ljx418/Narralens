# A-R1-MEDIA CLAUDE_IMPLEMENT — 尚未释放，不执行

这是完整审定MEDIA实施提示词的逐字嵌入加R1范围约束，不是新架构。当前dispatch只允许Codex写三文档；不要启动Claude。将来仅在MAIN正式RELEASED且确认凭据事件可继续、明确移交writer后，使用本文件。

## 本票覆盖与操作顺序

先读同目录TASK.md/HANDOFF.md/ReleaseAssignment.json。实际目录、完整base/contract、12个精确文件及hash、M01/M02/M07/M16/M17、命令和资源以TASK为准；历史提示词中旧base、旧overlay、全A范围不自动授权。本票只做SOURCE_ONLY闭包、proveForAdoption及安全prepared preview/read ports；原提示词第3–5项committed phases/QC/Delivery及T20留在后续release，不在本R1实现，也不先要求完成。

1. 只读核HEAD/dirty/合同/ReleaseAssignment；保全R0既有源，不重跑全R0或重写已通过模块。R0-M01由BRIDGE同DB release+真实CP重启回归解决，不越界写其store/worker。
2. 在MAIN已答复TASK的I1/I2后落实同一producer/consumer接口；成功SOURCE_ONLY无live lease，adoption proof绑定实际transaction/impact/approval，impact/preview不得虚构这些字段。当前assertCurrent lease分支保持兼容，adoption同步校验分支与purpose不可混用。
3. 实现隔离副本preview及五类真实字节receipt，复用现有renderer导出，不改本票外ports/native-renderer或整体render facade；BRIDGE持有opaque ref/HTTP/同DB注册，PRODUCT消费原播放器。只读bytes FD close归属按MAIN接线决定。
4. 先在允许的processor测试中解决旧docs/execution/A/logs写入位置，再按TASK由MAIN预约执行；纯单测与真实render证据区分。禁止测试期间改源码、提高并发、隐式安装。依赖由MAIN准备。
5. 交所属Codex实际文件差异/复现/逐case日志hash；没有真实consumer/媒体不得写整链PASS。Codex只读观察期间不并发写；需修文档时先停止并移交writer。本票无新增子worker许可。

## 完整审定基础提示词（原文保留，范围受上述R1约束）

# MEDIA ClaudeCode（MiniMax）A阶段实施提示词

本提示词是下一轮正式实施输入，**本轮只读检查不执行它**。先核MAIN实际发放的IMPLEMENTATION_RELEASE与此lane ReleaseAssignment；没有实施授权或status不是RELEASED，仅向所属Codex报告NOT_RELEASED，不写产品代码、不运行测试或服务。本提示词/文档认可本身不产生release。

## 阅读顺序与保全

canonical /mnt/c/workspace/videoworkline/Narralens（Windows C:\workSpace\videoWorkLine\Narralens）；包docs/execution/A/relaunch-20261111。先读canonical AGENTS.md、docs/AGENT_MEMORY.md、docs/agent-driven-v1/11_AGENT_DELIVERY_PROCESS.md，再本包00_READ_FIRST、02_MAIN_CONTRACT_AND_DECISIONS（D01-D15全篇，末节覆盖旧草案）、03_OWNERSHIP_AND_DEPENDENCIES.json、04_COORDINATED_EXECUTION_PLAN、05_MAIN_ACCEPTANCE_AND_REVIEW、06_MAIN_REVIEW_AND_START_GATE，然后media/DESIGN、ACCEPTANCE、TASK以及CLAUDE_READINESS的原发现/后续关闭记录。

已观察MAIN HEAD 838ba5f2c8500f0103f56dbe51264ea9f70086fc + baseline-observed.json中25文件overlay；原合同commit ca5b67a8285b130c79055317c6202f73cfbb99c8，文档commit f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450。共同新实施commit应由R0实际生成，再由MAIN填写；不要捏造SHA或自行改base。按release.directory执行git rev-parse HEAD/status，核完整SHA、contract manifest和overlay/候选hash；若不是所述实际版本先报领域Codex，不reset/stash/rebase/cherry-pick覆盖。研究lane不是最新MAIN来源，保持所有未提交候选。

## 职责与写入范围

你是具体编码/接线/开发子阶段自验证节点；所属MEDIA Codex负责详细设计、文档和领域复核，MAIN负责总合同/跨领域协调与大阶段验收。唯一允许产品文件是MAIN实际ReleaseAssignment与03表中分给media-Claude且本票已释放的**交集**。禁止默认全目录授权；未列文件或需要改冻结合同，先报Codex提出精确请求。共用文件有唯一writer，其他窗口只读；不用全目录git add，不自动push/合主干。

保持同Host/RevisionStore连接/原Job与lease/step_attempt/Coordinator/project_transaction、原生七方法EnginePort、strict409、一个引擎绑定与同Studio timeline/selection/clock。不能新项目/第二DB/第二队列或写源旁路。新created_*事实表不是第二状态机，不能污染精确cp_a0_* namespace。31原路由/80defs/冻结SQL不暗改；附属5HTTP+1resource单独schema/注册/版本计数。

## 本领域实施主线（A-MEDIA-1/2/3）

1. 保留并补强实际processor/verifier/assembler；真实registry授权媒体→原生每镜clip/完整旁白与storyboard_plan字幕→隔离prepared source。prepare不改author/revision/pointer。新增proveForAdoption从已完成SOURCE_ONLY事实和当前bytes/rights重建事务绑定proof，不要求成功Job仍有活lease，不冒用旧TaskLease proof。
2. PreviewPreparedSource只在隔离副本渲染并形成真实预览及五类review parts，不能把native可写workspace指向准备树、不能把prepared伪成committed SnapshotClosure。BRIDGE提供opaque Ref/read transport，HTML/stage不直接公开，PRODUCT沿原播放器消费。
3. 在committed-render-phases.ts按D05/D11/D14拆encode/inspect/publish并复用原renderer/QC/PublishedPackageStore；保留旧SnapshotRenderService.render诊断facade兼容，生产入口必须走分段端口。encode完成先immutable object/fsync和Host EncodedFact登记确认，再释放staging/进入QC；encode后QC前kill重开按fact继续，不重编码假恢复。
4. MEDIA只输出真实阶段receipt/FD/媒体事实，BRIDGE管理同库事实/Job/fence/最终QC决定与ready。chapters/cover的snapshot.render不发布Delivery；最终QC Gate必须由真实人类决定接受，warn需真实处置、block不可override。publication winner manifest/receipt attempt一致，编码producer attempt独立保存并与bytes/hash交叉验证。
5. 复用CommittedSnapshotAuthority给出的真实已提交闭包进行正式render，完整ffprobe/decode、字幕/许可/sidecars与no-clobber发布、取消晚到/并发/关服重开/两次正式导出。T20-E四真实终止点不得用throw替代；恢复不得删除winner或孤立原Job事实。

合成tone/3秒诊断仅做内部验证，不能声称真实中文录音/60–180秒影片。授权素材/人声由合法输入提供，不能访问J盘猜路径。Comfy/TTS/在线下载/长片/完整标题封面属B/C，不前置。共享DDL/Run/Coordinator/Impact/Approval/source_fact均由BRIDGE独占实现，你通过已审ports提供真实原生stage/validate/probe证明。

## 连续开发、自验证和证据

按领域ACCEPTANCE逐case完成；先最窄真实路径再负向矩阵，不为每个函数停下来问人。既有通过模块复用，无确定缺陷不重写。纯fixture只证明组件，真实Host/CLI/媒体/浏览器分别标证据；无测试替身注入生产。不得为过测放松guard/超时/合同，未知异常不一律归因ENOMEM；保留第一失败与修复后证据，重要负向必须能在旧违规实现上打红。

工具链先在实际worktree用corepack pnpm --version确认10.33.0、node>=22.15.0，只读元信息可查；禁止自行安装/下载、读取用户配置/凭据或全量env。模型只采信会话自报，UNKNOWN也可；禁止为验证供应商读取~/.claude、~/.codex、.env或密钥。凭据事件见audit/CREDENTIAL_EVENT，相关人类处置由MAIN负责。

以下是**实施释放后**才执行的已存在入口（命令cwd=release.directory）；具体新case文件在创建后纳入同一test过滤，不冒称现在已有：
- corepack pnpm exec tsc --noEmit
- corepack pnpm test tests/agent-driven/media --maxWorkers=1 --minWorkers=1
- corepack pnpm test:contracts
- corepack pnpm build（需要MAIN重型资源预约）

全量corepack pnpm check、多Host/ffmpeg/Headless/GPU大fixture由MAIN全机单槽统一预约，不能三窗口各跑一套。自动化Headless、静音、无弹窗/焦点抢占；每个Host/profile/DB/var/staging独立并精确清理，禁止kill所有浏览器/服务。不读J盘/不付费/不新外传或切供应商，除非当前任务明确授权。

交付记录ticket、base/contract/实现完整SHA、dirty manifest/修改文件与来源、真实命令cwd/开始结束/exit/日志和SHA256、逐case PASS/FAIL/NOT_RUN、恢复/回退/进程清理/剩余依赖。git只显式add本票文件，冻结后交所属Codex只读复核。子阶段自测不能签独立或人验；实际Orca task/from以注入preamble为准，不复用旧任务ID。

429：记录错误，停止写入并把dirty/在途命令交Codex；Codex核实旧调用及子进程停止后才接管。超过两次返工由MAIN接管共同根因，不机械反复重试。服务422/529等按真实原因保留，不改模型/配置逃避。未知写结果读原idempotency/job/receipt，不能换key盲重发。

停止在本票实际出门条件或真实越权/高风险阻塞；将结果回所属Codex，不进入未释放票据。A末由MAIN统一全量/独立审查/中文HTML/人工入口，不自行宣称A/V1通过，不进入B。
