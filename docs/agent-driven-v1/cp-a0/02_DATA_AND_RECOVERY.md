# CP-A0 数据迁移与恢复候选

状态：`DESIGN_FOR_REVIEW / NOT_RELEASED`。仅文档候选；`migration.sql`仅在临时 SQLite fixture 执行。S0 原冻结包不改，当前候选不是生产 DDL 注册，也不是 CP 冻结。真实 Host/原生桥/ffmpeg/磁盘满/进程终止验收全部 `NOT_RUN`。

## 权威与范围

唯一事实库仍是 `RevisionStore` 的同一连接，通过 `compose` 组合 store。影片仍只由 Coordinator、`project_transaction`、`project_state.revision`、`snapshot`、`active_commit` 和原有 journal/publisher 决定。新增 run/plan/step 的 completed/succeeded 不能移动影片指针。禁止另建 workflow.commit、第二 SQLite 或自有 commit 状态机。

依据实际 `src/host/projects/revision-store.ts` 的 constructor DDL、`job-kind-migration.ts`、`operation-idempotency-store.ts` 和 `server.ts` 组合/恢复顺序，以及 implementation-design/02、07、08。旧 `s0/baseline.json` 是旧 SHA 下存在性记录，不证明本轮实现；旧 `s0/migration.sql` 不能追加执行后冒充本候选（旧 ad_* 与新 cp_a0_* 必须预检，存在旧实验表的库需另审转换，禁止默认双权威）。

A：固定 `local-short-film@1` 能力的不可变模板/固定 plan_version=1、本地已授权步骤/attempt、样片/首章/章节/封面/风险门、内容 relay 与可信确认分离、run scope、受控采用、创建来源、事件/native ack、固定 committed snapshot 渲染与最小 QC/交付。没有稳定授权时保留首章门；同一完整短片复用审阅需相同输入/包/规格摘要并登记 reuse_review_id。B：任意已登记能力组合、运行中通用 patch/barrier、稳定建议/授权、driver epoch、GPU/resource lease、付费/provider/system lifecycle 等均延期，A拒绝这些写入口，不伪造空表或默认成功。

## 精确存储与约束

SQL 是字段/枚举/主键/FK/CHECK/索引的唯一精确清单；此表解释业务含义。JSON只通过 `json_valid` 不能证明类型/语义，必须同时通过本包 runtime schema，且重新计算摘要。

| SQL 对象 | 合同对象与职责 | 不变性 / CAS / 范围 |
|---|---|---|
| cp_a0_intake_version / intake_head / intake_content_decision / intake_confirmation | 前期简报版本/内容决定/创建可信确认 | intake版本与决定append-only；relay永远content_only；创建可信确认另存trusted_ui，origin必须引用它 |
| cp_a0_template_version / template_head | FixedWorkflowVersion / 固定模板草稿头 | version行不可更新/删除；head expected_version CAS；发布前校验固定能力、执行摘要、完整必需门与内容确认；published_version不授运行权 |
| artifact_version / artifact_head | ArtifactRevision / 草稿头 | 不变版本包含输入闭包和内容摘要；head CAS不改影片revision；parent输入语义由schema验证 |
| run / plan_version | WorkflowRun / 固定 RunPlan | project+run+scope复合FK；A plan只能1；模板更新不改旧run；start前服务端核对发布版本与执行摘要；checkpoint不是影片提交 |
| review_request / content_decision | ReviewPackage / ContentDecisionRelay | 请求绑定run/plan/artifact/input/package；relay保留真实来源，channel不能作为人类安全批准；内容版本不变、决定append-only |
| trusted_confirmation | ReviewDecision的受信确认依据 | channel只能trusted_ui、已认证actor/session、action digest/期限；MCP不可写；即使actor写human也无权生成此记录 |
| execution_grant | RunAuthorization | 绑定project/run/scope/principal/可信确认/固定能力/有效期；A仅登记的本地动作且paid=external=0；模板/内容确认均不能代替grant |
| step_attempt | ExecutionBinding / StepAttempt | plan/step/attempt/input/grant与project级job/output FK；同step仅一个pending/running/waiting_user/unknown attempt；旧attempt迟到结果隔离 |
| approval / prepared_authorization | 限定工程采用批准 | 审阅与批准分表；绑定run/scope/plan/step/attempt/input/change/impact/base/control/action/facts/expiry；prepared绑定原transaction，批准一次消费，跨project拒绝 |
| bootstrap_command / project_origin | 创建命令 / BootstrapResult来源 | pre-project reservation唯一(principal,operation,key)；origin仅created，旧工程不补假created；initial snapshot和transaction跨project拒绝 |
| event | EventEnvelope与现有outbox关系 | event_id就是outbox.event_id，复合FK保证project一致；不可变；不建立第二事件队列或cursor；attempt细节来自已验证typed outbox payload |
| native_ack | NativeAck | 原生受信桥真实回报的loaded snapshot/revision/source+session/seq；跨project拒绝；新ack追加，过期session/sequence/currentness由桥验证；不能复制Host版本当ack |
| render_attempt / delivery | RenderSpec / DeliveryManifest | snapshot/config/attempt固定；encode/probe/full decode/sidecars/QC未满足不能ready；manifest只能引用ready attempt且关联同project outbox事件；正式包不可变 |

所有 client digest 必须规范化后重算：SHA-256小写64位，JSON采用 canonical-vectors.json 指定规则；SQL长度检查不等于内容正确。模板 definition_json/plan_json/input_refs_json/dependencies_json/manifest_json 不是任意代码或路径入口。server必须拒绝未知能力、缺输入/环、未声明的输出、越审阅门、绝对路径/逃逸引用、未知JSON字段；SQL不承担图算法、身份认证、期限时钟或媒体真实性验证。

project命令复用现有 `operation_idempotency(project_id,operation_kind,idempotency_key)`，无第二个project command表。同行为同key同digest重放原response/transaction/job；异digest409。bootstrap尚无project行，先以principal+project.create+key预留project ID，所有后续重复指向同一reservation；reserved_project_id必须与origin一致。command记录中的committed不是影片commit权威。

## 迁移、升级和回退步骤

1. 当前仅运行 `python3 docs/agent-driven-v1/cp-a0/sql-check.py`，脚本自行建立/删除系统临时目录，不接收DB路径，不访问var/provider。`sql-check.json`记实际结果与源DDL/hash。
2. 未来获得生产release后，MAIN在无活动writer的启动阶段，通过唯一RevisionStore连接执行；先验证旧schema/current Wave升级记录与实际column/CHECK、foreign_key_check、重复复合scope键、旧实验ad_*、已有cp_a0对象精确fingerprint。缺base表/未知版本/记录与schema不一致一律停止，不用IF NOT EXISTS掩盖漂移。
3. 同目录受控备份（`VACUUM INTO`）、校验摘要/可打开/行数；备份保留。现有job升级必须先由其原migration负责完成，不由本SQL重建。全新库先原RevisionStore基表/既有store schema，再本增量。
4. `foreign_keys=ON`须在事务外验证；BEGIN IMMEDIATE中增加scope唯一索引和cp_a0表/触发器。旧表不删列/不改kind CHECK。执行后比较完整schema fingerprint和migration版本，再foreign_key_check，成功提交。重复执行只在精确fingerprint相等时允许；IF NOT EXISTS本身不是漂移校验。
5. 异常/磁盘写失败rollback并停止启动；不得标已升级。启动前整段回滚安全。升级成功但未写新业务数据时可恢复校验过备份；一旦有新记录，禁止DROP表“回退”，需只读/停写并另批前向修复或全DB加文件事实一致恢复。

本fixture直接抽取真实源码的project_state/project_transaction/snapshot/active_commit/outbox和JOB_TABLE_DDL，构造最小真实legacy表并预置旧工程行；没有先调用constructor后把已升级库命名legacy。覆盖最小legacy兼容，不代表所有真实历史Wave库、M5目录、旧运行记录组合已验证。旧M5/Wave真实受控副本完整启动/备份/恢复仍是准入条件。

## 正式采用的单事务边界

prepare阶段，原Coordinator完成真实materialization/source闭包/impact/journal及受控发布准备；同DB记录prepared_authorization绑定transaction与批准摘要，批准仍active。不在prepare提前消费批准；不把普通relay复制成trusted_confirmation。

正式commit必须在现有authoritative BEGIN IMMEDIATE内部扩展，不能在它前后另开事务，不能嵌套 `RevisionStore.atomic`。重验project/base/source/control/三类锁/许可/素材/impact、run_scope/plan/step/attempt/input、可信确认来源、grant、批准状态/有效期/action/facts；CAS消费approval并检查changes=1；原有revision+1、impact消费、snapshot验证/插入、projection、active_commit、业务outbox+cp_a0_event、operation_idempotency响应、project_transaction committed在同一事务完成。任何一步失败全部回滚；批准不因失败丢失或被重复采用。已有strict 409不改。

SQL触发器约束已prepared事务不能在未消费批准时标committed，消费必须匹配prepared facts，terminal批准不可修改；这些是防错辅助。SQLite没有通用commit-time断言，持有DB写权者仍可绕过应用顺序，故SQL不能单独证明“消费必和active_commit一起提交”。fixture演练该边界的rollback/commit，仅证明SQLite事务与约束，不证明实际Coordinator已经扩展。正式实现必须在原提交方法逐statement故障注入并核对唯一revision/指针/source/outbox/幂等/approval，禁止新增提交状态机。

## 恢复与取消矩阵

| 故障注入点 | 必须持久化/恢复 | 正式结果与禁止动作 |
|---|---|---|
| bootstrap reserve后/建目录后/DB前 | reservation、自己staging身份；初始snapshot/binding/commit/origin/idempotency一事务 | 无半工程可打开；重放同project，清理只自己staging；不标migrated |
| step dispatch前/已发起后未知 | 固定run/plan/attempt/input/grant/job；重开先读checkpoint | Agent/UI离开不删除job；需要推理waiting_agent；unknown先核实，不盲目重发 |
| 样片/首章待审/旧回报 | 请求输入/包与真实决定；重启重查所有副作用入口依赖 | 无沉默接受；relay不能满足受信风险/批准；旧attempt/过期输入隔离 |
| prepare前取消/晚到结果 | cancelled attempt与原产物审计 | 停止派发；等worker/心跳结束再关DB，晚到隔离不自动采用 |
| prepared/文件publish前后/DB前后崩溃 | 使用原journal/publisher/active_commit事实与prepared auth对账 | 原专项恢复收敛commit或attention，revision为0或+1；不可凭workflow状态补写pointer |
| Host commit/native尚未加载 | Host事实和原生session/seq真实ack分开 | 待同步/unknown；无ack不显示编辑区已加载 |
| render写入磁盘满/encode失败/损坏帧 | attempt失败原因、固定snapshot/config、自己UUID staging | 无ready/download；保留可解释重试，清理不得删winner包 |
| encode成功/QC未完/任一block | render.state=qc，probe/decode/sidecars与QC证据 | 不能ready，完整decode必须真实执行；warn有受控原因，block不能继续 |
| render取消/进程退出 | 子进程及心跳停止后记录cancelled/unknown | 晚到隔离；重试原snapshot/config新attempt，不热换最新snapshot |
| package已写/publish前或后/DB前 | 完整manifest/bytes摘要，publish_pending，no-replace原子发布 | 重启验证已发布包，幂等补登记/attention；半包不可下载，冲突loser不能覆盖/删除winner |
| DB ready/delivery/outbox提交后崩溃 | delivery manifest和outbox同事务，按delivery唯一键重放 | 同包同下载引用；事件可重投不重复发布；不可重复渲染冒充恢复 |

保持现有server启动专项顺序：import/write恢复、合法性核验、history→adoption→history non-sweep→coordinator→migration→materialize。新恢复在所依赖原事实恢复后挂载，不能提前通用扫描把prepared标stale。正式交付查询必须同时要求render ready、delivery记录和可验证已发布manifest，单个ready行不足。

## 实测与准入缺口

`sql-check.json`为实际隔离SQLite结果。涵盖raw legacy DDL、fresh、重跑、半途rollback、不可变版本、跨scope/FK、trusted channel/relay拒绝、唯一幂等、active attempt、无QC/无ready交付拒绝、批准/transaction辅助约束及fixture原子边界。未注册生产迁移，未改src/package，未运行Host/provider/服务。

必须在实施后补：真实旧Wave库升级/备份恢复/schema漂移拒绝；Node SQLite同连接组合；所有写入口统一依赖/授权验证；真实鉴权/Origin和trusted session；真实Coordinator逐语句fault/crash/diskfull；真实bootstrap目录补偿；多端事件初连窗口/cursor保留与resync；原生ack乱序/过期；ffmpeg完整decode/QC和T20-A..H、no-replace并发、真实取消/进程终止后的worker/心跳/DB生命周期。全部保持NOT_RUN直到留存对应证据。

固定模板精确ID为 `local-short-film@1`，execution_digest=`b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32`（与registry一致）。SQL模板capability_id是该固定流程的入口 `clip.prepare`，完整4项能力/阶段与scope允许动作以固定definition和runtime schema验证，不能解释为只有一个能力。BootstrapResult可读existing engine_binding/migration的migrated来源；新origin表仅记录本轮created工程。

### Wire 到持久化映射补充

`referenceVectors.fixedPlan` 的 value 规范化后必须等于 canonical 并得到其 sha256；template_version 的 template_id/version/execution_digest对应这三项，definition_json保存该canonical。`referenceVectors.runScope` 中project_id/run_id/plan_version/template_id/template_version映射run/plan的同名列，run_scope_digest是完整scope的sha256，plan.input_digest对应input_digest；style_ref、capability_fingerprint、allowed_actions及false权限位包含在经过schema验证的scope闭包，持久化必须保存该完整闭包到不可变run.scope_json字段并每次重算，不能仅保存客户端摘要。固定计划放plan_json。fixture实际读取这些wire向量而非重写同名假向量，并拒绝plan2及错误project的plan记录。

`RunAuthorization.authorization_id`映射grant_id，decision_id映射purpose=run.authorize的trusted_confirmation（此类可无review_id），scope_digest映射run_scope_digest，principal_id/state/expires_at对应grant同名事实；ISO时刻转换为UTC epoch秒，解析失败拒绝。授权允许动作是scope闭包中受限集合，execution_grant.action代表本次登记动作，不能从它推导未授权动作。ReviewDecision映射purpose=review/change.approve确认及内容决定，完整package/input/output/quality/choice/impact记录在不可变artifact内容与action_digest闭包；只有accept_and_adopt且有有效impact才额外生成approval。NativeAck.bridge_session_id映射editor_session_id；loaded_project_revision映射loaded_revision；instance_generation/selection_version必须随受信桥session记录并验证，ack_seq是存储侧单调序列，不能由Host revision代替。

### 独立审查修正：确认用途、状态和A最小问答

Approval持久状态与wire精确一致：`active / consumed / rejected / revoked`；不存`expired`。有效期由expires_at实时判断，过期active不能消费，也不能把过期伪装rejected。ExecutionGrant的`expired`与其RunAuthorization合同相同。SQL grant插入触发器强制trusted_confirmation.purpose=`run.authorize`、authenticated_actor=principal_id、action_digest=run_scope_digest且有效期不扩大；普通review与change.approve即使来自同一个可信UI也不能发放运行grant。Approval插入强制purpose=`change.approve`且input/action摘要一致，run.authorize或纯review不能提交工程。approval actor从不可变confirmation派生；应用在消费时必须比较当前已认证principal/批准主体与允许代执行策略，不能信客户端actor。受信session真实性、当前时间/撤销和actor权限仍须真实Host验证。

SQL fixture已拆为三个独立可信记录：review观察、run.authorize运行授权、change.approve采用批准。负向覆盖review→grant、adoption→grant、不同actor、不同scope摘要、run.authorize/review→adoption、非canonical expired状态，以及rejected终态不可恢复。普通relay仍只content_only。

A保留最小结构化问答：`cp_a0_question_version`绑定intake_id/intake_version/input_digest/question_id/question_version、text|choice、skip_allowed、完整Question JSON；`cp_a0_answer_version`绑定精确问题版本、正整数answer_version、真实channel/principal、content_only、skipped和完整QuestionAnswer JSON；两者append-only。`cp_a0_answer_head`按同问题版本保存当前答案，写入必须expected_answer_version CAS，0表示尚无答案。SQL检查跨问题/旧intake版本、禁止跳过的skip、答案假冒批准和不可变性；选项ID合法性、文本长度/必答及JSON字段类型由runtime schema验证。

Brief及ContentBrief整体保存在不可变`cp_a0_intake_version.content_json`（schema验证后的Brief wire对象），其中script_ref/material_strategy/style refs与fingerprint采用合同精确字段，摘要是完整规范化Brief。Question/Answer的payload原样存入对应JSON列；题目/答案存储侧版本名到wire版本名由DTO映射明确，不能丢弃choice/text/skipped/source。A仅本地素材策略与受控asset refs/rights；多轮富交互、通用流程组合和外部生成仍B。

问题修订/答案改变仅追加自身不可变版本并CAS更新对应question/answer head，不自动提升intake版本，也不改变Brief SHA。只有Brief内容实际改变才由IntakePut按base_version CAS追加新的intake版本。题答写入/head CAS、依赖内容决定及准备产物的失效记录、待办outbox必须在同一DB事务完成；新题答闭包产生新内容输入摘要，旧决定不能启动新run。旧intake确认/内容决定/下游artifact/run保留历史事实，不把旧答案自动应用到新Brief版本；新run要新绑定实际当前闭包和grant。若已有活跃run，内容答复只产生新的候选输入及明确stale关系，不能原地改变固定plan或在途attempt。未回答/skip不允许时继续blocked，不用空字符串伪造确认。此整段Host应用事务与真实T27交互仍NOT_RUN，fixture仅证明版本/FK/CAS约束。

问答精确字段映射：Question.version→question_version；Question.kind/skip_allowed/input_digest→对应列，prompt/choices/state与完整wire对象存question_json。QuestionAnswer.answer_id/version/input_digest/source/authority/recorded_at→answer_id/answer_version/input_digest/channel/authority/recorded_at；action=skip→skipped=1，否则0；text/choice_id/source_message_ref/supersedes_answer_id及完整wire对象存answer_json。principal_id只能取已认证会话，不能从来源转述推断。wire的current/stale及Question的answered/skipped状态在读取时根据intake head、answer head和失效事实投影，不能更新不可变历史JSON来伪造原记录；supersedes必须由应用验证指向同问题的旧当前答案，禁止引用当前/未来版本或跨问题替代；同一稳定answer_id的旧version可被新version的supersedes_answer_id引用。SQL真实wire roundtrip fixture将首答supersedes明确设null，并验证不丢失任何字段。

### CR05：简报版本与实际题答闭包分离

intake_version.input_digest及Question/QuestionAnswer.input_digest精确表示完整canonical Brief的SHA256；题答自身变化不改变该Brief SHA或intake_version。`cp_a0_question_head`按intake_id/intake_version/question_id指向当前题版本，QuestionPut以expected_question_version CAS。当前答案由对应当前题版本的answer_head解析；新题版本不自动继承旧题答案。只增加/修订题答时不得调用IntakePut假升简报版本。

内容决定和RunPrepare/RunScope.input_digest使用另一层`CreativeInputClosure`的SHA256，精确形状为`{intake_id,intake_version,brief_sha256,questions:[{question_id,question_version,answer:null|{answer_id,answer_version}}]}`。questions包括全部当前题head，按ASCII question_id升序；未答题也必须登记answer:null，不能因为无答案而从闭包删掉题目。引用必须解析到本intake版本的不可变Question/Answer、验证其来源Brief SHA和完整typed payload后再计算canonical摘要；拒绝重复题ID、错误版本、缺失引用或不同来源摘要。确定性排序用于闭包，题目展示顺序另由UI表达，不扩大合同。

IntakeContentDecision.input_digest登记该闭包摘要；启动run时服务端在同一读/写一致性边界重算实际current heads闭包并比较决定/RunPrepare输入，新增题、题版本变化、答案修改/skip改变/新增答案均使旧决定不能启动run。即使Brief SHA不变也不能通过；重放旧闭包不恢复旧批准。旧run保存原scope闭包并继续自己的已授权确定输入；新回答只形成候选输入和明确失效事实，不能改变在途参数、已提交影片或A固定plan。

fixture新增同intake版本改答案的事务演练：answer append/head CAS与`creative.input.invalidated` outbox一起rollback或commit，Brief/intake行完全不变；闭包变化使fixture run-prepare比较拒绝旧决定。这是候选算法/SQLite边界实证，不是生产Host已实现统一入口验证。实际Host question/answer→失效记录/outbox→新决定→RunPrepare的T27/T12链仍NOT_RUN。

精确golden例子见canonical-vectors.json.referenceVectors.creativeInput（与contract-vectors.json共用）：同intake-creative/version1、同Brief SHA `e7723bb464fc795ec8dbc297baa0a4e839e5d7e486b701319533140c29c34ddc`，audience当前答案由version1改2，purpose未答显式null；initialAnswer闭包SHA `b6b615c776ddb6a815758d9cc8fd506c2aaf8a4d5df072b6263449a7f15678e0`，changedAnswer闭包SHA `9f168593f70c857cf0b8bc5aa51c354eb79e483f72f16e1fd7004348b6d5639f`。两者canonical字符串与原始typed Brief/题答都在向量中，不以占位伪摘要说明本次golden。
