# CP-A0 独立交叉文档审查

日期：2026-11-09。结论：**REVIEW_PENDING：两项MAJOR需闭环，不能据本审查冻结CP或发实现release**。本审查仅读取当前候选及源码/既有计划，唯一写入是本文件。没有改schema/TS/SQL/报告/产品/旧冻结，没有运行Host、provider、GUI、全套测试或真实媒体。

审查上下文未参与01合同/02数据候选实现，负责03/04验收与释放文档。因此对01/02的交叉核对具有作者分离；对03/04只能算交叉一致性自检，不冒充其独立外审，更不称代码独立外审或人验。产品全部NOT_RUN，CP-A0未冻结，生产NOT_RELEASED。

## 实际只读验证

- 独立使用仓库现有Ajv2020 + ajv-formats逐条校验contract-vectors.json的1134项JSON向量，真实exit=0，输出PASS_DOCUMENT_VECTORS_ONLY。未运行会覆盖生成文件的contract-check.mjs。
- 独立执行`node node_modules/typescript/bin/tsc --strict --noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext docs/agent-driven-v1/cp-a0/contracts.ts`，exit=0，无emit。
- 只读重算contract-check.json四项文件摘要及sql-check.json的migration摘要，与报告一致。SQL报告为作者执行的30项临时SQLite fixture结果，本文没有冒称独立重跑SQL或真实旧Wave库/Host。
- 人工逐项核对registry路由/schema引用、TS消费形状、固定计划与SQL摘要、文01/02持久化映射、23EX阶段拆分、19个A验收case、T20-A..H、17包DAG与四目录释放边界。

## 尚未闭环发现

| ID/级别 | 可定位证据与影响 | 要求及owner |
|---|---|---|
| CR-01 MAJOR | [contract-check.mjs](../contract-check.mjs:154)将`plan_change.dispatch`纳入当前policy，155行只对runtime.*做A不可用处理，因此`plan_change.dispatch:valid`在contract-check.json及contract-vectors.json记ALLOW。但[01协议](../01_PROTOCOL_AND_AUTH.md:71)和registry.deferred明确RunPlanChange及dispatch barrier为B blocked；[03验收](../03_EXECUTABLE_ACCEPTANCE.md:47)要求未实现入口unregistered而非PASS。文档oracle把一个A未注册副作用入口当可执行，易误导实现与验收。 | 合同作者区分“通用门判断参考”与“A能力可用性”，明确A plan-change无入口且实际拒绝；如保留通用gate向量，必须命名其不是A可用性证明，并增加实际A拒绝对照。重生成schema/TS/vectors/报告后复核。 |
| CR-02 MAJOR | iteration-plan.json IT-A03/A04和详细04 AD-T27要求结构化问题、UI答复/跳过/改答案及同版本Agent读取；[04释放任务](../04_RELEASE_ASSIGNMENTS.md:45)仍列A问答消费者。但当前contracts.schema.json `$defs`无Question/Answer DTO，`ContentDecisionRelay`只携intake/version/request/choice/source、不携答案；`Brief`仅有限topic/audience/duration/tone/assets/narration/concept_summary，registry无逐问题回答/跳过合同。尚未证明承诺的A T27能经本合同表达。 | MAIN与合同作者列A问答精确子集及对应DTO/route/版本/skip/修订/读回向量；需要补合同则限文档候选。若完整问答后置B，必须清楚列A可验子集，不能静默关闭T27或降低原要求。 |
| CR-03 MEDIUM | [contract-check.mjs](../contract-check.mjs:81)、87行对job.cancel与workflow pause/cancel统一`gatePolicy=run_scope`；129行唯一dispatch参考会拒绝grant revoked/待审/unknown。对照[01协议](../01_PROTOCOL_AND_AUTH.md:35)明确安全取消/暂停可在撤权/待审后收紧。当前机器策略没有区分identity-only安全控制与新派发。 | 合同作者明确safe-control机器策略或精确gatePolicy语义，增加revoked/pending/unknown下允许取消、不重新dispatch的向量；别让实现者将cancel套用dispatch oracle。 |
| CR-04 MINOR | canonical-vectors.json算法写ASCII keys，01协议RunScope段写Unicode排序；contract-check.mjs:37实际Object.keys.sort。当前受限schema键均ASCII、现有canonical向量一致，因此当前摘要未冲突；但扩展者可能误读允许字符域。 | 明确受限对象键为schema声明ASCII，还是Unicode排序算法；同步文字。duplicate_key负向目前是描述性JSON文本，不是已执行生产parser拒绝证明。 |

CR-01/02已立即通知MAIN及合同作者。CR-03同时通知。发现列表是当前读取快照，不阻止作者修订；后续必须记录具体处置与复核，不能直接把初审结论改成PASS而无证据。

## 已核一致项与边界

| 范围 | 核对结果与具体引用 |
|---|---|
| 候选身份/生产状态 | 01首段、02首段、registry.state、每route.production=NOT_IMPLEMENTED、contract-check.production_probes、sql-check.production_integration和readiness-check状态一致。只有文档向量/临时SQLite可以PASS，产品仍NOT_RUN，四实现角色NOT_STARTED。 |
| 固定计划/摘要 | registry.fixedWorkflow=`local-short-film@1`，4能力、6阶段，execution_digest与schema RunScope/FixedWorkflowVersion const、canonical-vectors.fixedPlan、SQL cp_a0_template_version CHECK一致。旧local.fixed-shortfilm命名已在当前候选关闭。 |
| A/B/C划分 | [01 B边界](../01_PROTOCOL_AND_AUTH.md:71)未注册动态模板/稳定授权/RunPlanChange/driver lease/GPU runtime/provider付费；03的23EX逐项保留A子集/B补齐/C复验，machine firstRequiredPhase不冒充整项通过。EX06/07/08/11/13/14/15/20/21/22完整能力留B；A保留缺授权不跳首章/旧输入隔离/未知拒绝安全门。CR-01例外待修。 |
| Wire→SQL | [02映射补充](../02_DATA_AND_RECOVERY.md)明确RunScope完整闭包存scope_json、RunAuthorization→execution_grant、decision purpose、ISO→epoch、review闭包与NativeAck字段映射；sql-check新增实际referenceVectors→SQL而非自造向量。plan_version=1已同时在wire与SQL受限。真实runtime验证/摘要重算不能由SQL json_valid替代。 |
| Bootstrap origin | 02已明确新cp_a0_project_origin只记录created，migrated从既有engine binding/migration读取；不补假created/migrated。01 BootstrapResult两个origin可表示读取来源，不应强行往新表写migrated。 |
| 事务/审批 | 02正式采用段及SQL prepared_authorization/approval/transaction触发器保留唯一Coordinator边界，承认SQL无法单独保证commit-time全过程。03 A-WRITE明确失败不推进影片/成功业务outbox/审批消费，合法拒绝审计允许。实际单连接/逐语句故障及恢复仍NOT_RUN。 |
| 事件与native事实 | 01 CursorClaims/HMAC scope/410重同步、native可信桥关联；03 A-EVENTS包含漏窗/重复乱序/篡改跨scope/延迟旧ack。没有将Host最新revision当nativeack；生产key轮换/真实载入仍NOT_RUN。 |
| 导出与恢复 | 01 RenderSpec/manifest、02 render/delivery与正式恢复表、03 T20-A..H/acceptance-plan 8子case对应。T20-E四个真实崩溃点单列，no-replace/winner隔离/完整decode/QC block/旧snapshot/GET无执行均保留；A最小交付不关闭B完整字幕封面费用QC包。 |
| 任务与路径 | 04沿parallel-plan完整复制保护前缀/文件、三lane白名单和MAIN bootstrap/旧M5/registry权；四绝对目录已存在但历史receipt基线非当前HEAD，要求release前复核。全部任务尚未释放，用户具体授权和完整ReleaseAssignment为前置。429要求停止旧进程、保留dirty、唯一writer、实现者不自签外审。 |
| 真实命令与资源 | 03现有package命令和未来tools/agent-driven runner分列，未来路径不冒充可执行；全量/多Host/ffmpeg/GPU与大fixture需MAIN预约，Headless静音不抢焦点。参考fixture真实hash不作为A授权媒体/60–180秒成片证明。 |

## 不可由本审查解决的真实探针

授权媒体/真实中文录音与rights/full closure hash；客户端实际MCP/Skill链与Codex/Claude/DSH独立矩阵；raw fresh及真实历史Wave DB副本升级/备份/漂移/恢复；可信用户/桥session与审批消费/Coordinator原子性；cursor签名密钥/初连水位与实际native ack；render/encode/ffprobe/full-decode/QC/T20真实崩溃；B固定模型/许可/GPU/receipt/未知费用/取消；参考机时延及阶段人工内容/体验签署。上述全部NOT_RUN，不把文档向量绿灯升级成CP冻结或实现release。

## 本次读取摘要

以下hash界定本轮审查快照；作者后续修改须复核受影响项。

| 文件 | SHA256 |
|---|---|
| 01_PROTOCOL_AND_AUTH.md | `e64eb3102b40dc9c98907a679fbc7a4d3f53d8d3e891e089f72ef799c3bc5aac` |
| 02_DATA_AND_RECOVERY.md | `1283b0523af191ea10ce2cda236d6989900c04a2b2301b9ad9dbe6b6fd43b4e1` |
| 03_EXECUTABLE_ACCEPTANCE.md | `701fc60ff1c4f86a5126db283893a7c6c074f6ee07eee81cef8aee870e7038d9` |
| 04_RELEASE_ASSIGNMENTS.md | `891e0d08a6044c5293c95b803be70c800f478b987c3e25b45c50f8693cb252a9` |
| acceptance-plan.json | `59da6561d74aa6acd4a313481772183815fed33be8dfd1980aa31d53189c2747` |
| canonical-vectors.json | `ef66c39f030572ba41b9479d4b428ad799dd392edb0cc0d58ebe984af1882a0d` |
| contract-check.json | `d75f922bd134347887244c320db830f7fc1ea30b016088948ddf1c464a3cf872` |
| contract-check.mjs | `58616c89240a46e63fab7a64e4815d936cde10de59675b9e12e32ba80da85f4a` |
| contract-vectors.json | `f156c2db67b754f0b274c98a4a32424c897866606a214b003d80890c5c8060ec` |
| contracts.schema.json | `522140358ecf27a50b258e328b247a49a77fecfaa26cf73428e946fa4e90a35b` |
| contracts.ts | `f1fe154ed2c9592c40db7a80a9b918ca90694dbbe4d2b59bd7ced640dcc3e052` |
| migration.sql | `d3f5aee6946da91273e6bcb38be35830896f10a3293693cc4a4adb8fa4580f52` |
| readiness-check.json | `cf64c2fec87e50cf343c38450e07949e8dd9956c259eeafa05fcaea2b1288123` |
| registry.json | `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f` |
| sql-check.json | `5b3ddabfc3b18df297786ad31a31442ce75f63287bd2e2ace0849e29482e2344` |
| sql-check.py | `9a0c8f5bc2e630a13da3a8da00d9c43348e10b4d334bdf258c477938c76cbf39` |

## 2026-11-09 复验追加（保留以上初审记录）

复验时间：2026-11-09T10:32:00.228687+00:00。当前结论：**CR-01/02/03的文档缺口已关闭；CR-04文字域仍待统一，新增问答intake版本策略须MAIN澄清后冻结。文档候选可继续审核，不能据此自动冻结CP或释放实现。**本结论不代签本人03/04完整包的独立审查。

实际验证（唯一产品状态仍NOT_RUN）：

1. 独立Ajv2020直接读取当前落盘schema/vectors，1320项正负向全部符合预期，exit=0。
2. 在内存将contract-check.mjs唯一write函数替换为Map，原生成/校验/policy/tsc逻辑只读重执行，77 defs / 31 routes / 1320 vectors / 153 policies / tsc PASS，exit=0。生成schema/TS/registry/vectors与落盘四文件逐字节一致；没有覆盖原检查报告。这是对文档reference oracle的重跑，不是Host/客户端真实验证。
3. 在内存拦截sql-check.py最后报告写入，真实执行40项临时SQLite fixture，SQLite3.45.1、40 PASS、exit=0；只创建自动清理的系统临时DB，没有访问生产DB或改sql-check.json。仍不证明Node同连接装配/真实旧Wave库升级/真实进程崩溃。
4. 重算contract-check四文件摘要和sql-check migration摘要，全部与当前报告匹配。03 EX表已补Markdown分隔行，仅格式修复，23项EX及其阶段/状态未变；diff --check无空白错误。

| 初审项 | 处置/复验结果 | 结论 |
|---|---|---|
| CR-01 plan_change可用性 | contract-check中aBlocked明确包含plan_change.dispatch；当前policy `plan_change.dispatch:valid`=CAPABILITY_UNAVAILABLE，runtime.load/warm同样拒绝；registry仍列B deferred。固定workflow/RunScope paid/external/runtime=false，动态模板/稳定授权/运行修改未新增为A工具。 | CLOSED_DOCUMENT_ONLY；真实入口availability与全部绕门仍NOT_RUN |
| CR-02 A T27问答 | 新增MaterialStrategy/StyleDirection/ContentBrief/IntakeRead/QuestionChoice/Question/QuestionPut/QuestionAnswerPut/QuestionAnswer九定义；四route为intake.read、question.put、question.answer、question.answer.ui。QuestionPut有intake及question expected-version CAS；答案绑定题/简报/input/answer-version，text/choice/skip互斥及null条件明确，skip_allowed和choice成员由服务端oracle检查。输出source由通道赋值且authority只能content_only，UI答案也不升级批准。01问答补充与02持久化映射覆盖不可变答案/当前投影/下游stale。 | 原“无DTO/route表达A27”缺口CLOSED_DOCUMENT_ONLY；新增版本策略澄清见下条，不声称真实T27 PASS |
| CR-03 取消安全门 | RegistryRoute已允许safe_control；job.cancel、workflow.run.pause/cancel均使用它。safeControl oracle对撤权+待审仍ALLOW，未认证UNAUTHORIZED、跨run RUN_SCOPE_REQUIRED；start/resume/new task仍run_scope完整门。 | CLOSED_DOCUMENT_ONLY；真实worker停止/迟到隔离/unknown对账仍NOT_RUN |
| CR-04 canonical文字域 | 当前01 RunScope段仍写Unicode键排序，canonical-vectors.algorithm写ASCII keys。schema声明的键全ASCII，当前两向量及执行摘要没有冲突；但允许域文字未统一。已再次通知MAIN与合同作者，不修改其文件。 | OPEN_MINOR，冻结前统一允许键域与排序措辞 |

新增澄清CR-05：02末尾明确“问题修订/答案改变必须在同一DB事务追加新intake版本和新digest”，01问答段则写“如需据答案修改Brief，由IntakePut...创建新Brief/version”。前者是必升intake，后者看似仅条件式；这会影响question.answer输出intake_version、下一题expected_intake_version、current_answers及下游stale。需明确Brief版本与完整Intake闭包版本是否分开、答复时是否总升Intake，并让两文及fixture一致。已通知MAIN/合同作者；当前定为OPEN_CLARIFICATION，不把数据roundtrip通过冒充该业务策略已确认。

本轮所有检查仍只证明候选文件/JSON/SQL fixture与reference policy；合同冻结SHA、producer/consumer签字、具体实现授权/ReleaseAssignment、媒体许可与真人录音、客户端/Host/native/完整decode/崩溃/性能/人验均未通过。03/04整包独立审查仍由MAIN或其他未参与作者上下文签署。

复验输入hash快照（不包含本审查文件本身）：

| 文件 | SHA256 |
|---|---|
| 00_READ_FIRST.md | `9374d7d684054b9c42fe679c43431d2d897481ee0f767c35324ad3f406d8fb20` |
| 01_PROTOCOL_AND_AUTH.md | `0c87a279a45874aaa44e50684e1db44a1eecd436d30bac3bf3acc24d82cb507d` |
| 02_DATA_AND_RECOVERY.md | `89e9b89ee7d12522ece6aac8a2b851417c8492db382c76b9e42fab3693bbf4a0` |
| 03_EXECUTABLE_ACCEPTANCE.md | `b0c5c33717983f386ceda4ca207c6538452966374da6ae7919675a211f6077ac` |
| 04_RELEASE_ASSIGNMENTS.md | `891e0d08a6044c5293c95b803be70c800f478b987c3e25b45c50f8693cb252a9` |
| acceptance-plan.json | `59da6561d74aa6acd4a313481772183815fed33be8dfd1980aa31d53189c2747` |
| canonical-vectors.json | `47703f9b36c941868fb92fcca60f29e3631b4b2bcb2d10bba47abf775ff3e2bd` |
| contract-check.json | `6d9e0dd79a6bf0689e5299b7fe27aed8a0e5d44585e86f217d7a8ca6f5767ca9` |
| contract-check.mjs | `58616c89240a46e63fab7a64e4815d936cde10de59675b9e12e32ba80da85f4a` |
| contract-vectors.json | `f156c2db67b754f0b274c98a4a32424c897866606a214b003d80890c5c8060ec` |
| contracts.schema.json | `522140358ecf27a50b258e328b247a49a77fecfaa26cf73428e946fa4e90a35b` |
| contracts.ts | `f1fe154ed2c9592c40db7a80a9b918ca90694dbbe4d2b59bd7ced640dcc3e052` |
| environment-observed.json | `753c531ca40b233c1d94807ac5c98ce3e0e52f25baaa2bde7d7d5c06c5cc0fa3` |
| migration.sql | `2939e6bc69aba0f3b66d20939def301f8d21b04d8ec000b0f752bdc5098bcd3f` |
| readiness-check.json | `cf64c2fec87e50cf343c38450e07949e8dd9956c259eeafa05fcaea2b1288123` |
| registry.json | `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f` |
| sql-check.json | `b5409935b5ae0df9693c70b9d50e0c1d793d037d59dc090d14157044f077cbd1` |
| sql-check.py | `b3f21d8c0703a1cb2c423930db625c1c151d7fa3f513c3d5c4ae7984c8751b15` |

## 2026-11-09 最终复验追加：CR04/CR05闭环

时间：2026-11-09T10:36:48.257984+00:00。**最终结论：本审查提出的CR-01..05全部CLOSED_DOCUMENT_ONLY；01协议/合同候选与02数据/恢复候选的本次跨文件审查无未闭环BLOCKER/MAJOR。**本节取代前面快照中的OPEN_MINOR/OPEN_CLARIFICATION结论，原发现和中间复验保留。该结论仅是文档候选的作者分离审查；本人03/04完整包仍不能由本人代签独立审查。CP-A0继续候选未冻结、生产NOT_RELEASED、真实业务全部NOT_RUN。

| 项 | 最终关闭依据 |
|---|---|
| CR-04 canonical域 | 01“创作输入摘要的精确定义”已明确仅schema声明ASCII key、UTF-16排序（ASCII域等价）、值可含Unicode但不正规化。canonical-vectors.algorithm同样限定ASCII；generator canonical拒绝非ASCII键、浮点/-0/非有限值/undefined。实际Brief含中文的UTF-8 canonical与SHA可重算，固定计划执行摘要未变。重复key仍要求原始输入解析阶段拒绝，未把文档检查说成生产parser已实现。 |
| CR-05 intake/题答版本策略 | 01与02均明确Question/Answer仅追加自身版本并CAS head，不自动提升intake_version/Brief SHA；只有实际修改Brief才IntakePut升版本。Question input_digest绑定Brief SHA；内容Decision/RunPrepare/RunScope另绑定精确定义的CreativeInputClosure SHA，不能混用。SQL新增question_head，当前题版本对应answer_head，新题版本不继承旧答案。 |
| CR-05 当前闭包与失效 | CreativeInputClosure含intake_id/intake_version/brief_sha256、全部当前题head且按ASCII question_id排序，未答也answer:null；版本引用解析到不可变typed题答。新增题/修订题/改答均改变闭包；旧内容决定在content.relay、workflow.run.prepare、workflow.run.start三入口被reference policy明确REVIEW_STALE。既有run保留原授权输入，不热换计划。 |
| CR-05 SQL/黄金向量 | canonical-vectors.referenceVectors.creativeInput与contract-vectors的完整creativeInput逐对象相等。41项临时SQLite实际重跑包含同intake改答append/head+失效outbox同事务rollback/commit、Brief行不变及旧decision摘要拒绝。仅证明候选/SQLite，不证明Host已接线。 |

精确黄金例复核：initialAnswer与changedAnswer均intake_version=1，同Brief SHA=`e7723bb464fc795ec8dbc297baa0a4e839e5d7e486b701319533140c29c34ddc`，audience question_version均1、未答purpose保留answer:null；只把audience-answer.answer_version由1变2。初答canonical SHA=`b6b615c776ddb6a815758d9cc8fd506c2aaf8a4d5df072b6263449a7f15678e0`，改答canonical SHA=`9f168593f70c857cf0b8bc5aa51c354eb79e483f72f16e1fd7004348b6d5639f`；两者已由本审查独立重算相等于落盘黄金值且彼此不同。

最终实际执行与范围：

- 独立Ajv2020直接读取落盘1335向量，全部符合预期，exit=0。
- 将唯一write在内存拦截后只读重执行当前contract-check.mjs：80定义/31路由/1335向量/161策略/tsc PASS，exit=0；生成schema/TS/registry/vectors与落盘逐字节一致，未覆盖报告。
- 将最终报告写入在内存拦截后运行sql-check.py：SQLite3.45.1，41项临时fixture PASS，exit=0，临时目录自动清理；未访问生产DB或覆盖sql-check.json。
- 当前contract-check报告四文件hash、sql-check migration hash与本次读取一致；canonical creativeInput逐对象相等。safe_control、plan_change A不可用和题答content_only仍保留，未因CR04/05修改扩大A权限。

剩余项全部是已有明确实施/真实验收前置：真实Host所有入口current-head闭包计算/鉴权/事务/outbox接线、客户端标准链、真实旧库与原生桥/签名游标、真实媒体许可及录音/完整decode/正式发布崩溃、资源和人验，均NOT_RUN；不属于可以用本次文档PASS代替的事项。MAIN还须完成其他作者对03/04的独立审查、最终包版本/合同hash冻结与实际用户实现授权/有限ReleaseAssignment。没有新增全仓或后续B/C授权。

最终输入hash范围（覆盖当前cp-a0顶层全部文件；不自引用reviews，不替换旧冻结）：

| 文件 | SHA256 |
|---|---|
| 00_READ_FIRST.md | `9374d7d684054b9c42fe679c43431d2d897481ee0f767c35324ad3f406d8fb20` |
| 01_PROTOCOL_AND_AUTH.md | `8b3a4c2793928727541082d7e0242116ce2049d31b8acdb2c76fc2a382e58573` |
| 02_DATA_AND_RECOVERY.md | `8d2e8086d61fc73c2c577dffbe30876aea3c88d1b6231373050428b8929c93e0` |
| 03_EXECUTABLE_ACCEPTANCE.md | `b0c5c33717983f386ceda4ca207c6538452966374da6ae7919675a211f6077ac` |
| 04_RELEASE_ASSIGNMENTS.md | `891e0d08a6044c5293c95b803be70c800f478b987c3e25b45c50f8693cb252a9` |
| acceptance-plan.json | `59da6561d74aa6acd4a313481772183815fed33be8dfd1980aa31d53189c2747` |
| canonical-vectors.json | `cc42014593ea9b3bd4e8480dbcd982d47c071e1a38915e18fb42ab0f5d28c738` |
| contract-check.json | `51108dffa17e4761cf603b5b685bf371a525c9757f097442394a8a18add1e51f` |
| contract-check.mjs | `9bfae6a4f0680c713d7d81e4c42f19f0cee0a6aa643e66eca1484e484909de0b` |
| contract-vectors.json | `93dcc5b9803835a53765a1a9216999f4e5e42d34ec6162039d438b2f560c35d3` |
| contracts.schema.json | `088a451e9646199618261a6cc95a84e3767dbf4cc87004f3e5995dda86b60964` |
| contracts.ts | `64a509bed408eee25b89168fecc7f545553abffd2de8d12a47017cbdd5e2fccd` |
| environment-observed.json | `753c531ca40b233c1d94807ac5c98ce3e0e52f25baaa2bde7d7d5c06c5cc0fa3` |
| migration.sql | `5572530b5036728e414a0653fc36fd43958874a3a89cc8223e3984194c4a1fa4` |
| readiness-check.json | `cf64c2fec87e50cf343c38450e07949e8dd9956c259eeafa05fcaea2b1288123` |
| registry.json | `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f` |
| sql-check.json | `97d5d7139360604bc53f021c094735e4ac80b352ed5938d25271a86cccea2d8e` |
| sql-check.py | `6ca3b82780c6ae4914ce9137125ed47df04d917f7250b0454d19236d72e965d6` |

### 最后补充向量与SQL42项复核

2026-11-09T10:37:31.161955+00:00：合同作者补充typed `referenceVectors.creativeInput.unansweredQuestion`（purpose@1），本审查独立Ajv验证该真实未答题及全部1335向量通过，contract-check报告hash一致。canonical-vectors完整creativeInput已与合同逐对象同步，两个初答/改答黄金SHA不变。独立内存拦报告写入重执行SQL检查，42项PASS（SQLite3.45.1），含真实Brief+两题+答案v1/v2落SQL后按current-head JOIN重建两黄金闭包，未升intake/Brief，旧决定拒绝。CR01..05全部文档关闭的结论保持；产品与人验仍NOT_RUN，未代签本人03/04整包。以下更新为最终输入hash，替代上一快照受影响文件的摘要。

| 文件 | SHA256 |
|---|---|
| 00_READ_FIRST.md | `9374d7d684054b9c42fe679c43431d2d897481ee0f767c35324ad3f406d8fb20` |
| 01_PROTOCOL_AND_AUTH.md | `8b3a4c2793928727541082d7e0242116ce2049d31b8acdb2c76fc2a382e58573` |
| 02_DATA_AND_RECOVERY.md | `8d2e8086d61fc73c2c577dffbe30876aea3c88d1b6231373050428b8929c93e0` |
| 03_EXECUTABLE_ACCEPTANCE.md | `b0c5c33717983f386ceda4ca207c6538452966374da6ae7919675a211f6077ac` |
| 04_RELEASE_ASSIGNMENTS.md | `891e0d08a6044c5293c95b803be70c800f478b987c3e25b45c50f8693cb252a9` |
| acceptance-plan.json | `59da6561d74aa6acd4a313481772183815fed33be8dfd1980aa31d53189c2747` |
| canonical-vectors.json | `bf32841f29ae6fdd4e269d1b6b977686e48d0b9946da475c70d0a8011ee9f99d` |
| contract-check.json | `51108dffa17e4761cf603b5b685bf371a525c9757f097442394a8a18add1e51f` |
| contract-check.mjs | `9bfae6a4f0680c713d7d81e4c42f19f0cee0a6aa643e66eca1484e484909de0b` |
| contract-vectors.json | `93dcc5b9803835a53765a1a9216999f4e5e42d34ec6162039d438b2f560c35d3` |
| contracts.schema.json | `088a451e9646199618261a6cc95a84e3767dbf4cc87004f3e5995dda86b60964` |
| contracts.ts | `64a509bed408eee25b89168fecc7f545553abffd2de8d12a47017cbdd5e2fccd` |
| environment-observed.json | `753c531ca40b233c1d94807ac5c98ce3e0e52f25baaa2bde7d7d5c06c5cc0fa3` |
| migration.sql | `5572530b5036728e414a0653fc36fd43958874a3a89cc8223e3984194c4a1fa4` |
| readiness-check.json | `cf64c2fec87e50cf343c38450e07949e8dd9956c259eeafa05fcaea2b1288123` |
| registry.json | `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f` |
| sql-check.json | `0dd0a3b91a946d9eefe013c704fa0fae0ad52eb9583b1e0b178ad30954a52b17` |
| sql-check.py | `6ca3b82780c6ae4914ce9137125ed47df04d917f7250b0454d19236d72e965d6` |
