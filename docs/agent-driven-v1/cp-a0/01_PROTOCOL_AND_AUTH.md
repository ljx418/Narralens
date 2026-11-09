# CP-A0 R4 精确合同候选：协议、工作流与权限

状态：REVIEW_CANDIDATE_NOT_FROZEN；生产 NOT_RELEASED。本目录只是文档包，不被 src 导入，不注册生产 API。用户授权的是完成准备包及统一 HTML；MAIN 审查/记录冻结之前不得称 CP-A0 已冻结。07/08 体验规格优先于历史 S0；旧 s0 文件未修改。

## 权威文件与可复现检查

`contracts.schema.json` 使用新命名空间 `urn:narralens:cp-a0-r4:contracts`；复制 S0 定义后显式扩展；所有 object 拒绝 additionalProperties，所有声明字段必填。nullable 是“字段必须存在，值可为 null”，不能省略字段。`contracts.ts` 与 `registry.json` 由 `contract-check.mjs` 生成。运行：

```sh
node docs/agent-driven-v1/cp-a0/contract-check.mjs
```

使用仓库已有 Ajv 8.18.0、ajv-formats 3.0.1 和 TypeScript 5.9.2，无安装/升级，无 SDK/网络/客户端调用。检查 runtime schema、每个定义样本、每条路由输入/输出的缺字段与未知字段、registry 本身、资源映射/重名、错误状态映射和候选 TS 严格编译。文档策略 oracle 另检查全部执行入口门、可信通道、签名游标、原生 ack、审阅绑定与复用。输出 `contract-check.json` 记录真实运行；它是候选合同自检，不能代签真实 Host/DB/媒体/客户端探针。

`contract-vectors.json` 是可复现的真实 JSON 正反向向量，包含 schema 名称、expected-valid、输入值；覆盖 registry 所有候选 route 的两端。与 `contract-check.json` 中的策略结果一起消费，不能只读 TS 跳过 runtime 校验。生成器从冻结 S0 读取后构造新候选；不得把生成器作为生产 validator 装配。

## 名称、版本与职责

S0 的 16 个 route id/tool 名称继续保留；原有 `intake.confirm`、`change.approve` 仍无 MCP tool。明确 delta：Instance.contract_version 改 `cp-a0-r4`；TaskPrepare/PrepareChange/ApplyChange/JobCancel 新增 execution；TaskPrepare 新增 nullable render_spec；JobReceipt 新增 nullable execution/bootstrap；Context 新增 active_run/native_ack/native_sync；Event 新增 nullable run_id/plan_version/input_digest；EventSnapshot 新增 filter_digest/instance_generation，输入改 CursorRead；Delivery 新增 nullable manifest；Error 增加 run/review/native/unknown 类错误及逐 code-status 约束。旧 name 不等于 wire-compatible；版本握手不匹配即拒绝，不隐式补默认值。

新增工具：`narralens_content_decision_relay`、`narralens_workflow_run_prepare/start/read/pause/resume/cancel`、`narralens_review_read`。新增可信 UI route：workflow.run.authorize、review.decide；新增仅原生桥 route：editor.native.ack。精确 URL/输入输出以 registry 为准，无临场拼 tool 名称。无“代人批准”MCP tool。

registry 分别记录 businessProducer（业务产物负责）、protocolOwner=BRIDGE（协议外观）、registrationOwner=MAIN（公共端口/注册/DDL）；旧 owner 仅兼容历史 lane 标签。PRODUCT 产生内容/工作流/审阅业务，MEDIA 产生真实 render/QC/delivery，MAIN 执行授权、事务和持久调度。业务 producer 不能自行注册生产 route 或修改公共存储。SQL 物理表由 `02_DATA_AND_RECOVERY.md` 候选负责，API 名与表名不要求同名：RunAuthorization 对应 execution_grant；ReviewPackage 对应 review_request；ReviewDecision/Approval 与 content_decision 分离。

## A 固定流程、scope 和所有执行入口

A 唯一模板是 `local-short-film@1`。执行顺序为 definition → sample → first_chapter → chapters；cover 在 chapters 后，delivery 依赖 chapters+cover，仍须 QC 与 adoption 门。精确固定计划及 SHA256 由生成器中的 fixedPlan 以同一受限 JCS 生成（canonical 文本与实际 SHA 见 contract-vectors.referenceVectors.fixedPlan），registry.fixedWorkflow.execution_digest 是消费权威。该摘要包括依赖、门、能力清单及 false 权限标志；FixedWorkflowVersion 与 RunScope 的 execution_digest 均为 const，不接受任意 64 位散列。阶段/能力集合也为 const。这里的 published 仅指候选固定模板状态，不表示生产模板已经注册发布。

RunPrepare 只创建候选运行，绑定内容决定、输入版本、样式与固定模板，不派发媒体作业。Host 计算 RunScope 并按受限 JCS（对象键仅限本 schema 的 ASCII 字段名并按 UTF-16 码元排序（在此 ASCII 域等同 ASCII 顺序）、UTF-8 JSON、数组顺序保留、整数仅 safe integer、无浮点/undefined）作 SHA256 得 scope_digest；客户端不能自行决定 capabilities、权限或费用。RunScope 必须绑定 project/run/plan/template/execution/input/style/content-type/实际能力指纹和有限 actions；A 的 paid、external_write、runtime_mutation 强制 false。RunAuthorize 必须来自已验证可信 UI，记录 RunAuthorization 的 principal、scope、digest、可信 decision、有效期和 active/revoked/expired；前期内容确认不产生此权限。

TaskPrepare、UI prepare、子 job 派发、start/resume/retry、系统 load/warm、另建 run、计划调整后派发及 change.prepare/apply 都必须进入同一服务端检查。ExecutionBinding 精确绑定 run_id、plan_version、step_id、attempt、input_digest、run_scope_digest、authorization_id；Host 从持久事实解析项目、scope、授权状态/期限、能力与 gate，不能仅比较客户端参数。原 job 输入、input refs 的版本及闭包摘要也必须匹配。新增 run 重新获得自己的样片/首章门与 scope，不继承同项目其他 run 的审阅。

A 没有 runtime 写工具。即使从内部尝试 load/warm，仍须 scope 校验且 A allow_runtime_mutation=false 导致 CAPABILITY_UNAVAILABLE/blocked；“检查健康”不能启动生成。取消命令需鉴权并校验原 run/job/attempt 身份，可以在 grant 撤销或 gate 待审后继续收紧/取消，不能因为门未通过而拒绝安全取消；取消不派发新作业。暂停同理只阻后续派发，恢复和重试再次过全部门。任务读、健康读、native ack 不生成媒体。

Host 脱离 Agent/UI 后可继续已授权且依赖满足的确定步骤；需要创作推理时 waiting_agent，需要审阅时 waiting_user。Job succeeded、workflow completed、影片 committed、native loaded 和 delivery ready 是五种事实，不互相替代。Run plan_version 与影片 project_revision 分开；采用仍走唯一 Coordinator、旧 base 严格 409、锁/许可/impact/approval 重验，成功 revision 恰 +1。

## 内容 relay 与可信审阅/批准

ContentDecisionRelay.source 只能 agent_conversation/driver_relay，携 source_message_ref，返回 ContentDecision.authority=content_only。允许普通内容问答在 Agent 完成；request/intake/version/input_digest 不匹配则 stale。actor=human、confirmed=true、source=trusted_ui 是未知/非法输入，不能升级权限。intake.confirm 为兼容保留的可选 UI 内容确认，不授权工程采用或外部副作用。CreateProject.decision_id 可解析已绑定本 intake/version/hash 的 ContentDecision 或旧 Decision；服务端校验真实内容决定及 create 权限，不接受任意 ID。

可信 UI 是服务端鉴别的用户会话、同源/允许 Origin、CSRF 与项目权限组合，不是 JSON 内 channel 字符串。普通 MCP token 只可 draft/prepare/read/有限 apply，不可请求可信确认路由；native_bridge 是独立桥会话身份，不可由 UI/MCP token 伪造。注册客户端独立确认通道留后续 CP，A 不推定 CLI 文本是可信通道。

ReviewPackage 绑定 project/run/plan/chapter/package/version、input/output/quality 摘要、preview/narration/subtitles/shot_summary/rights_quality 版本引用、选择理由和真实工作台相对链接。chapter_pack 必须包含这五类 parts；sample 记录来源镜头与选择理由；cover 独立包，不能混入章包必答。链接由 Host 构建并经已验证 instance origin 解析；不得返回任意外站跳转或本地绝对路径。ReviewRead 返回同一包，Agent 可引导用户一次点击并读回同一决定，不在终端重复确认。

ReviewDecisionInput 必须匹配当前 package/version/plan 和全部摘要。choice=accept/changes_requested/reject 有独立语义；关闭/看完不产生决定。纯 accept 返回 approval=null，不授工程写权。accept_and_adopt 只在包具有当前有效 Change impact、界面展示差异与保留项时开放；同一次可信操作原子登记 ReviewDecision 与有限 Approval，后续 Coordinator 仍检查/一次消费。impact 过期、scope/base/输入变更重新确认，不能拿旧“接受”补签新批准。重放同 key 同 digest 返回同 decision/approval/transaction；异输入同 key 409。

RunGate 是持久门，不能由客户端传 accepted 或“独立任务”越过。A 首章默认保留；sample 通过后才能开始依赖它的首章，first_chapter 未接受不派发依赖它的高成本其余章节；正常章节包、cover、risk、QC、adoption 不免审。单章首章与章包可以同一决定同时满足，但必须明确同章、同 input/output/quality 摘要并记录 reuse_of_gate_id/reuse_of_package_id。样片覆盖整章且完全同规格也可复用；任何内容/质量输入变化使复用无效。批量接受需明确列出每个已展示版本；A 无泛化批量“一键全同意”接口。

## Bootstrap、snapshot/cursor 和原生确认

CreateProject 是 bootstrap 命令，鉴权 create scope，幂等键绑定 intake/version/decision。未有 run 的建工程只允许受控 root/初始事务，不允许夹带生成。返回持久 JobReceipt，完成时 bootstrap=BootstrapResult，含 created/migrated origin、initial transaction/snapshot/revision/source digest；new 不假造 migration。origin=migrated 仅用于读取既有合法 migration 结果，新的 bootstrap 只能创建 created origin 行，不为本次新建写伪迁移。BootstrapResult.native_state=loaded 仅可在匹配真实 NativeAck 后设置，默认 unconfirmed/native_ack=null。建目录至初始 DB commit 崩溃只清理自身 staging 或按 journal 幂等恢复，不留下可打开的半工程。

EventSnapshot 在同一读一致性边界读取 Context 与 global outbox watermark，然后返回已签 cursor。CursorClaims 为服务端签名载荷的精确 schema：principal/project/filter/generation/watermark/issued/expiry/key-id。wire cursor 为 opaque 文本，客户端不提交裸 event_id；SSE id 是更新 watermark 的新签名 cursor。snapshot_event_id 是观察水位，不是可伪造续传 token。初连先快照再订阅水位后事件，断线按全局水位含被 filter 跳过事件推进，不能按当前过滤列表计数漏窗。

Last-Event-ID 有效时优先于初始 cursor；若两者同时提供必须分别验签、验时限并匹配当前 principal/project/filter/generation，不允许用“优先”掩盖另一个越权游标。过期/超出保留窗口 410 CURSOR_EXPIRED 并要求 resync；篡改或跨 scope 403 ORIGIN_REJECTED，裸数字/结构错误 400 INVALID_REQUEST。文档 oracle 用公开测试 key 做真实 HMAC-SHA256 正反向向量；生产密钥存储/轮换/Host outbox 原子性尚未实现或探测。

NativeAck 来自受信桥会话，含 project/bridge-session/generation/actual loaded revision/snapshot/source digest/selection_version/observed_at。Host 验当前会话与项目、snapshot、revision、digest；跨项目、旧 generation/session/revision 的 ack 409 NATIVE_ACK_STALE。Host commit 只使 native_sync=pending，不能将 Host 的 revision 抄入 ack。失联/缺 ack 为 unknown/unconfirmed。选择版本独立检查，不可用旧选择批准当前镜头。真实 native 载入探针 NOT_RUN。

## 固定 snapshot 渲染与交付

TaskPrepare.kind=render_snapshot 时 snapshot_id 与 render_spec 必须非 null，并验证 snapshot 是本项目已提交、授权闭包可读的不可变版本；assemble_draft 时 render_spec=null。RenderSpec 固定 engine id、实际 engine version/config digest、尺寸/fps rational/容器/编解码；客户端不能给原生 operation、路径或任意 workflow JSON。render job 绑定同一 ExecutionBinding、snapshot 和 config，期间项目新 revision 不改绑输入。

Delivery.state=ready 只在 manifest 非 null、qc=passed、artifact/download 引用一致且真实媒体编码成功、ffprobe、完整 decode、必需附属文件齐备、QC 无 block 后可出现。QC warn 需要适用用户处置记录，不把 pending/warn 当静默通过；not_applicable 有理由。manifest 绑定 snapshot/source、spec/config、attempt、真实 bytes SHA 的媒体/探测/完整解码/附属 Ref 与 QC。只读 delivery.read 不触发重渲染或发布。正式二进制下载沿用 S0 下载合同：项目/产物归属鉴权、无重定向、受控 ref、ETag=真实 SHA、单 range 200/206/416；不新增任意路径输入。

发布使用独立 UUID staging、无覆盖原子发布与 durable receipt；publish/DB/event 之间崩溃按事实对账，不能出现半包 ready。取消 await 子进程和心跳，晚到产物隔离，清理只动自身 staging，不删已发布包或别人的包。磁盘满、编码失败、损坏帧、并发重名、取消、render/QC 间及 publish/DB 前后进程退出必须在 A06 的真实 T20-A..H 探针验证；本轮全 NOT_RUN。

## 错误、边界与尚未证明的事实

错误 envelope 沿用 Error，精确 code/status 对在 schema allOf 和 registry.errorMapping 一一对应；400 输入、401 身份、403 origin/通道、404 跨项目或不存在、409 base/幂等/plan/review/native 冲突、410 游标过期、413 大包、423 锁、428 缺 impact/approval/run scope/gate/未知外部结果、503 缺能力/资源、500 内部错。既有 Host alias 到具体错误的实际生产映射需 MAIN 接线核对，不把文档候选当原路由事实。错误消息脱敏，不回 token/本地绝对路径/原始 prompt。所有路由先 auth/Origin 再资源查找，错误不递增 revision。

B 明确 blocked：动态 template draft/revise/validate/publish/deprecate、稳定建议/授权、RunPlanChange prepare/apply/dispatch barrier、driver lease、GPU/runtime 写、外部模型/下载/付费/外传。未注册的工具不得 fallback 到 arbitrary workflow/native operation。A 不生成“未实现稳定授权”假 ID，不跳首章。保留消费边界是固定 template/version/execution_digest、plan_version、RunScope/ExecutionBinding、ReviewPackage、RunGate、checkpoint、Capability fingerprint 与 independent artifact refs；B 需新版本 schema/能力握手，不能靠增加未知 JSON 字段热开。

MCP baseline/SDK 固定沿 S0：2025-11-25 / @modelcontextprotocol/sdk@1.26.0（MIT），integrity 原值见 registry.protocol；状态仍 METADATA_VERIFIED_NOT_INSTALLED_NOT_CLIENT_TESTED。本轮未安装、未升级、未浏览查版本。Codex/Claude/DSH 实际兼容、真实 Host routes、数据库升级恢复、UI可信会话/native、真实 render/full-decode、签名密钥管理均 NOT_RUN。准备包自检 PASS 只证明文件与 oracle 一致；CP 冻结、用户实施授权、MAIN ReleaseAssignment、真实生产验收各自独立。

结构性 maxItems/字段长度/安全整数范围只限制请求负载与编码，不设置生成总预算、重试次数或失败概率硬上限；风险阈值只决定何时聚合请求确认。

## A固定创作问答补充与审查修正

A 问答明确使用 QuestionPut/Question/QuestionAnswerPut/QuestionAnswer；精确 route 为 intake.read、question.put、question.answer、question.answer.ui。普通Agent内容问答经MCP question.answer闭环；工作台答案通过无MCP映射的可信UI路径记录同一题和答案版本，但 authority 仍 content_only。source 由已认证的服务端调用上下文写入输出，不允许客户端提交 actor/channel/source 获取人类权威。普通MCP relay 的 source_message_ref 必须有实际对话引用；UI 允许 null。

Question 绑定 intake_id/intake_version/input_digest 和 question_id/version，分 text/choice，choice_id 唯一且属于当前题，skip_allowed 明确是否能跳过。QuestionPut 的 question_id=null/expected_question_version=0 表示首次；编辑要求准确 expected_intake_version 和旧题版本CAS，产生新不可变题版本，不覆盖旧题。QuestionAnswerPut 绑定相同题/简报版本和摘要，expected_answer_version=0 为首次，后续改答案必须匹配当前答案版本。answer_text 必须 text 非null且 choice_id=null；answer_choice 反之并检查选项存在；skip 两者都null且题目允许跳过。旧题/旧简报/旧答案CAS/不允许skip/未知choice均拒绝，不生成执行授权。

答案修改是 append-only 新 QuestionAnswer.version，记录 supersedes_answer_id、实际 source/ref、state 与时间，原答案保留。Intake.questions/current_answers 以及 intake.read 为 Agent/UI 读取同一当前答案的入口。题目 input_digest 对应其不可变来源内容版本；依赖闭包必须同时包含实际题/答案版本，不能只hash原Brief并漏掉新答案。修改答案使依赖它的内容决定、已准备脚本/候选/impact 标 stale；如需据答案修改 Brief，由 IntakePut 的 base_version CAS 创建新 Brief/version，再重建/重绑题与内容确认。对活跃run的答案修改不改变既有plan/影片；A只能准备新固定run并重新审阅，不借问答绕过B RunPlanChange延期。

Brief.content_brief 结构化绑定 script_ref（未有脚本时null）、MaterialStrategy（authorized_local_only、asset_ids、rights_refs、真实旁白asset、选择说明）和 StyleDirection（style/version及画面/声音/字幕方向、重算style_digest）。脚本内容仍通过既有ArtifactPut Script版本保存；Agent确认最终Brief/Script/Style与答案闭包后才产生内容Decision与RunPrepare输入。MaterialStrategy与旧Brief.local_asset_ids/narration_asset_id必须一致，授权/许可仍服务端核验，不因写了rights_refs而自动合法。A只交固定短片创作问答，不提前实现B通用表单/富工作流编辑。

审查修正：registry.gatePolicy=safe_control 用于 job.cancel、workflow.run.pause/cancel；只校验认证项目/run/plan/原attempt归属，不因grant撤销/门待审阻止收紧。start/resume/retry/新任务仍run_scope完整门。策略oracle对runtime和plan_change.dispatch的A能力可用性明确拒绝，不再以通用门通过显示A已开放。Approval持久与wire统一 active/consumed/rejected/revoked；过期是expires_at产生的有效状态判断，不生成wire未声明的expired枚举。拒绝记录不能消费/恢复成active。SQL以独立run.authorize确认授grant，以change.approve确认授approval，不能拿纯review确认越权。


### 创作输入摘要的精确定义（CR04/CR05）

canonical采用受限JCS：对象key仅允许schema声明的ASCII字段名，按UTF-16码元升序（此域与ASCII升序等价）；值字符串允许中文等Unicode，保留原码点、不作Unicode正规化。UTF-8无BOM、无空白；数组保留顺序；只接受safe integer、boolean、null、string与本合同typed object/array，拒绝float、-0、非有限值、undefined及重复key。此修正不扩大canonical-vectors域，不更改固定模板执行摘要。

Question/QuestionPut/QuestionAnswer.input_digest是其来源不可变Brief完整canonical JSON的SHA256。题答自身append-only/CAS不自动增加intake_version；只有真正修改Brief时IntakePut才增加intake版本，旧题/答案/内容决定随后失效。题目版本和答案版本独立于简报版本。

ContentDecisionRelay/ContentDecision和RunPrepare.input_digest则必须是CreativeInputClosure的SHA256，不能直接填Brief SHA。精确闭包对象为 `{intake_id,intake_version,brief_sha256,questions:[{question_id,question_version,answer:null|{answer_id,answer_version}}]}`。questions必须包含该intake/version下所有当前题head，按ASCII question_id升序且不重复；未答题也保留answer=null。引用在此intake命名空间解析当前不可变Question/QuestionAnswer版本，验证来源Brief SHA、题答对应关系、答案head及typed内容；不能只接收客户端列表而漏掉新题。Brief全部结构（含script/material/style）已由brief_sha256传递绑定；引用的版本内容不可原地修改。

首次答复和修改答复的精确canonical文本/黄金SHA及其实际题答内容见 `contract-vectors.json.referenceVectors.creativeInput` 的 initialAnswer/changedAnswer。两例保持同intake_version=1、同Brief SHA，只把audience-answer从版本1改2；新摘要必须不同。新/改题答使旧内容决定stale；content.relay、run.prepare、run.start重新读取当前闭包并重算，不接受旧决定启动新输入。新增未回答题也改变闭包；存在必答未答时仍blocked，不因内容决定有效就跳过必答规则。既有已授权run保留原输入，不把这些内容编辑热换进A固定计划。
