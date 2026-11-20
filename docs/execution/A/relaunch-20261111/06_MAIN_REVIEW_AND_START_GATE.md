# MAIN 审查结论与Claude开发启动门

日期：2026-11-11。结论范围：A恢复准备文档、分工、合同设计和接手检查；**不签产品验收，不释放实际实现**。本页与02/03为本包当前权威，领域文档中的早期提案及原readiness初轮BLOCKED/NEEDS_REVISION作历史证据，最后补充及此页给出闭环，不覆盖原失败。

## 1. 本轮完成范围

- 已复核canonical ca5b67a8285b130c79055317c6202f73cfbb99c8及MAIN 838ba5f2c8500f0103f56dbe51264ea9f70086fc；MAIN25项、BRIDGE310项dirty已有归档和逐字节核对，PRODUCT/MEDIA源工作树清洁。归档路径/hash见baseline-observed；本轮未改产品源码、索引、分支或旧evidence。
- 三个领域Codex已实际启动并编制DESIGN/ACCEPTANCE/TASK/只读CLAUDE_PROMPT；各自通过Orca派生真实ClaudeCode子窗口。三个子会话自报MiniMax-M3.1-Flash-Preview[1m]；仅据会话显示，不代表账户/配额验证。
- MAIN集中审核0/1层实体、公共端口/事务/源发布/恢复、完整创作体验和验收证据，形成D01–D15；03精确单writer路径与R0–R4依赖，04完整协调计划，05组合门及T20。
- 额外提供implementation-prompts/bridge.md、product.md、media.md，是下一轮正式实施可用的完整提示词；领域CLAUDE_PROMPT保留本轮只读派发用途，不能混作已经授权实现。
- Archify架构摘要已9/9 showcase、四视口Headless和图样light/dark核查；仅证明图样，非产品行为。本轮业务测试/生产build/render/服务启动全部NOT_RUN。

## 2. 三轮审查与主要问题闭环

第一轮：源码/接口事实核对。三领域读取真正MAIN而非旧lane，Claude分别复核实际符号、脚本、合同和25项overlay；发现change.*无Agent生产适配、facts/adoption只有测试实现、Context仅支持creation Job、旧审查/清单不覆盖当前字节。结论是开发目标与R0审查需求，不假称现代码可用。

第二轮：跨领域真实链审查。MAIN审核等待审阅attempt与普通guard、合法ps_来源、引用可读性、created采用对旧migration_id事务的硬依赖、render facade越阶段交付、encode→QC断点。通过D01–D12分别锁定具体服务、字段来源、typed事务、媒体端口和唯一owner，不把问题留给Claude自行选路线。

第三轮：复验设计可实施性。根据领域反例，新增D13–D15保护精确cp_a0 namespace，明确SOURCE_ONLY真实列与成功Job无live lease的新proof、不可变EncodedFact锚点、最终QC门必须可信人类决定、同delivery Job待审/续行。修正附属schema rights_ref.version=1与POST InventoryItem响应验证。三领域最终设计ACK与case补充分别见各TASK/DESIGN/ACCEPTANCE；实际文档检查结果和输入绑定在audit中。

以上是三个领域上下文与三个Claude只读检查加MAIN集中审查，**不冒称三个完全独立的整包外审，也不是产品独立外审PASS**。产品实现后仍须未参与实现者对冻结组合候选独立复核。

|发现|处置与精确依据|当前边界|
|---|---|---|
|生产change.*、facts/adoption不存在适配|D08指定CreatedSourceChangeService及created-run-facts/authority，03归BRIDGE；workflow注册与真实port注入同批|待实施，不从测试导入Grant|
|prepared引用会命中M3消费者|D02/D09/D10明确合法ps_事实、新source_kind/impact域及created typed提交；旧M3分支不接假行|待实施且保旧回归|
|waiting_user普通guard无法采用|D04/D08窄Host-only effect，HTTP仍验证原DTO后由服务构造真实proof；普通dispatch不广放|当前基础守卫不改，本轮无代码|
|impact如何带target snapshot|D09用已有snapshotIdFor推算预期ID，prepare不登记committed；完整preimage绑定授权事实|目标ID不表示已提交|
|current源码不等于历史closure/380b候选|D12与R0保留原报告并按当前hash重审/必要复验；25文件归档匹配|当前候选未获产品验收签署|
|附属库存/预览协议隐式扩大面|contracts明确5条附属HTTP+1只读MCP resource，独立版本/鉴权/计数；原31/80/冻结SQL不改|均DESIGN_ONLY，未注册|
|新cp_a0表会破坏精确schema matcher|D13全部新事实created_*独立namespace，固定DDL校验；原cp_a0表/receipt不放松|旧库/新库实际验证待开发|
|encode后QC前无法恢复|D14不可变对象先fsync再EncodedFact，同Job/fence登记，QC后独立证据，不靠被finally删掉的stage|T20-E真实进程终止待执行|
|技术QC被误写accepted/无合法QC包kind|D15完整chapter_pack容器+私有qc gate事实绑定，经原review.decide真实确认，warn处置同决定，普通章包不冒充QC|不可自动接受或添加wire qc kind|
|多个窗口写共享文件|03精确单writer，BRIDGE共享core、PRODUCT UI/native、MEDIA媒体；领域旧名单由03覆盖|正式release/共同SHA留待下一轮生成|
|工具链不同PATH|主环境corepack pnpm实测10.33.0，部分Claude默认PATH 10.31.0；按目标checkout准确corepack入口核对，不安装/改配置|每实施窗口启动时复核|
|PRODUCT误读配置暴露token|已披露，audit/CREDENTIAL_EVENT保留自报事实；禁止再读配置/全量env/敏感输出；没有擅改凭据|账户持有人处置未知，不宣称安全通过|

## 3. 实际团队与实施安排

MAIN：管理总计划/公共合同/依赖/共享更改分配、领域设计与验收方案审核、集成及大阶段验收。三个领域Codex已实际完成各自方案并管理Claude只读子窗口；Claude是实施节点，本轮仅完成接手检查，没有实施。具体Dispatch/terminal与后续reopen历史见orca-dispatches.json/最终运行快照，不把旧handle当永远有效。

BRIDGE Claude未来承担ENTRY/HOST/FACTS/REVIEW/RECOVER及显式释放共享core；PRODUCT Claude承担P-A1/P-A2/P-A3与独占native观察/expected模块；MEDIA Claude承担A-MEDIA-1/2/3的真实准备、preview、阶段媒体ports与质量/下载模块。先R0共同基线，再R1并行，再R2真实采用/原生确认，再R3正式交付/恢复，R4大阶段统一审查后人验。原文件/源码未丢弃，研究分支不被重置。

## 4. 停在什么门、还阻塞什么

**设计准备门：可供MAIN下一轮发布有界实施任务；不是IMPLEMENTATION_RELEASED。** 三领域设计方向、接口/依赖/owner、case与回退已明确；07交接/最终manifest记录精确文档字节。当前Goal要求在此停止，不能启动产品开发或B。

仍须明确保留的开工/验收条件：
1. MAIN下一轮实际生成共同可重现实现commit与每lane完整SHA的ReleaseAssignment、移交writer/隔离运行根；本轮不编造未来SHA。
2. PRODUCT凭据事件的账户持有人处置或风险决策尚未知；MAIN已披露，不自行轮换/切模型或声称外传风险为零。
3. 真实授权本地素材/中文人声输入仍待提供及登记；不妨碍已授权软件实现，但缺它们不能关闭A真实影片和人工门。
4. 所有业务端到端、故障恢复/两次正式导出、R4产品体验、独立产品审查、人验仍NOT_RUN/待实施。组件源码/历史模块测试不能顶替。

未来只在需人类核验/重大决策/实际外部阻塞或约定大阶段门停下；普通工程问题内部闭环，超过两次返工MAIN接管根因。完成A人工门前不实施依赖B。

## BRIDGE最终只读检查收口

bridge/CLAUDE_READINESS.md第10节已实际落盘：F01/F02/F13/F14/F15/F16逐条ACK、F09准确工具入口闭合、F03旧字节历史保留并留R0重审，无设计阻塞。三条非阻塞观察已由MAIN直接补入02最终精确性节与04独立复核排程：声明63字符、设计/运行时命名映射、独立reviewer回避与REVIEW_PENDING规则。原第0–9节未覆盖，不把该ACK解释成产品或整包独立外审PASS。所属Codex任务最终回执与实时窗口状态另见orca记录。
