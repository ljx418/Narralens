# PRODUCT A 连续创作路径设计

状态：DESIGN_REVIEW_PENDING / 开发启动门准备；2026-11-11。仅文档与 Claude 只读 readiness；所有本轮产品验收 NOT_RUN。本文不是 ReleaseAssignment，不进入 B。事实以 MAIN 当前文件为准，旧 lane 不能证明 MAIN 缺实现。

## 基线与证据分层

canonical=/mnt/c/workspace/videoworkline/Narralens（同一 Windows C:\workSpace\videoWorkLine\Narralens）；MAIN=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration；PRODUCT 候选=/mnt/c/workspace/videoworkline/Narralens-agents/product-workbench。不新建替代项目。
MAIN HEAD=838ba5f2c8500f0103f56dbe51264ea9f70086fc，存在 dirty overlay，不等于已冻结实现。contract documentationCommit=f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450；cp-a0-r4 文件级锁见 canonical docs/execution/A/contract-freeze.json。baseline-observed.json 是 MAIN 归档，不是运行验收。本文件末尾输入哈希将代码事实与 HEAD 区分。

|层级|观察到的实体、调用和持久事实|边界|
|---|---|---|
|L0 产品入口|OwnedProjectBrowser→readOwnedProjects/openOwnedProject→GET /api/ui/v1/projects、POST /api/ui/v1/projects/:id/native-open→CreatedWorkbenchHttp→CreatedNativeWorkspaceService.prepare→m5Supervisor.ensure→issueNativeEntry|真实 created/newcreated 链已存在；入口返回 unconfirmed，不能称 loaded|
|L1 创作|ApplicationDispatcher.creativeHandlers→CreativeService.putIntake/putQuestion/answerQuestion/relayContentDecision/putArtifact→ProductSqliteRepository→Host revisions 同库事务|intake/question/answer/version/head、content_decision、artifact_version 持久；relay authority=content_only|
|L1 固定工作流|FixedWorkflowService.prepareRun/authorizeRun/startRun/recordStepAttemptInTransaction/publishReviewPackage/decideReview/readWorkflow；execution-guard、trusted-grant、creative-closure|run/checkpoint、step_attempt、review_request、review_decision、execution_grant、trusted_confirmation、approval、idempotency receipt、event 持久；不是 UI 状态|
|L0 原工作台|M5Panel 保留 Studio 原时间轴/播放器；SelectionCoordinator 与 PlaybackClock；WorkflowTopBar、CreativeReviewPanel、SystemControlPanel、NativeSyncIndicator 是可复用纯 UI|rg 挂载核对：前三组件当前仅 export/测试引用，未在 M5Panel 生产挂载；不得重写为第二应用/时间轴|
|L1 创建投影|CreatedWorkbenchService.read 核对 committed snapshot、revision/source/fps；CreatedNativeWorkspaceService 派生可丢弃副本|capabilities blocked、preview=null、native_sync=unknown；副本不是 author source|
|L1 MAIN 准备实现|dirty CreatedDraftTaskProcessor.execute→CreatedTaskStore/CreatedTaskGate→PinnedNativeDraftAssembler；PreparedDraftVerifier 校验 stage/source/资产/rights/reader pin；recordStepAttemptInTransaction 同事务|真实源码已存在但未提交且尚需装配与验收；不能覆盖、宣称不存在或因 verifier 存在就宣称 adopted|
|L1 MAIN 写权威|AdoptionCoordinator、author-source-publisher、NativeWriteGateway、Host coordinator、CommittedSnapshotAuthority|现有通用采用/快照机制可复用；不据此宣称 created review→commit 已接通|

明确未接通：creation-application.ts 当前 new FixedWorkflowService({repository})，没有 facts/adoption；dispatcher 仅 workflow.run.read/workflow.read，没有完整 workflowHandlers 注册；ProjectContextService native producer 参数 undefined。准备、审批、采用、完整 NativeAck 与正式双导出组合仍待 MAIN 释放接线。ProductWorkflow 是领域称呼，现有代码类型实际是 Workflow/WorkflowRun，不新增同名事实库。

已通过但受限（历史报告，本轮未重跑）：verification-codex.json 记载旧 PRODUCT 5 文件 100 测试、tsc 成功，不是当前 MAIN 全链。013 freeze=37ed5c7800d7e32818cdc75dfa8b915467d11a48，active source=eeb6c7b0b6c046d39d7c633f4ee0029e23b3f7d6；check2 tsc/build 0，helper H-R1 窄 VM 修复与 8 golden，不证明浏览器/Host/nativeAPI。015 freeze=07399c230023591b84fa2872b45b2a8b58b286f4，active source=7141357f0453caa9253b43098ef43ab50fddeeea；check1 build/Node 15 literal vectors 0，真实 source/UI 比对 NOT_RUN、独立复核 PENDING。013/015 CONTRACT 的“未 build”是旧 source 阶段文字，active-candidate/check results 才是历史执行状态，不修改旧证据。

## 按完整用户路径实现

P-A1 内容定义到真实审阅：Agent 用现有问答/内容 relay 定主题、观点、时长、素材策略、脚本/风格；必答缺失或旧版本阻止 run prepare。MAIN 依真实本地资产许可和登记能力生成 RunScope，可信 UI 授权固定 local-short-film@1。MEDIA 提供样片/首章 preview+narration+subtitles+shot_summary+rights_quality 同包；Agent 给 review_url，工作台同 ID 决定，Agent读同一事实，无二次批准。纯 UI onOpenPart 必须委托原播放器/selection，不能自己 new video clock。无可播产物就显示未就绪并禁用假预览；preview 故障不伪装原生 loaded。

P-A2 审阅到采用到真实编辑：工作台默认折叠横向阶段 Bar；节点弹窗仅观察，Escape/关闭恢复焦点不暂停任务。系统 aside 非模态、无遮罩焦点锁，编辑仍可用；健康 TTL 15 秒、未来/无效时间为 unknown，A 不新增模型/服务写控件。审阅 accept 仅记决定；accept_and_adopt 显示本次 impact 与保留项，同一次可信交互产生限定批准；随后 MAIN 在 commit 事务重验并消费，通过唯一 Coordinator +1；commit 后明确待原生加载，真实匹配后才 loaded。

P-A3 原生编辑到重开双导出：在同一原编辑区定位并改单镜，走 MAIN 原生写网关/impact/锁/Approval；不得直接写 source 或采用 staging。首次导出与改单镜后第二次导出均以不同当前 committed snapshot 为输入，展示真实作业、技术QC证据、待人类交付质量确认、正式发布以及manifest/download_ref。关服重开后读同库、重新建立 session/generation/view 观察；旧 Ack 不能沿用。UI 给导出入口及失败重试指引；实际 render/QC/publish 由 MEDIA/MAIN。无可用导出能力则明确 blocked，不能用预览下载冒充正式导出。

A 不实现动态 DAG、稳定授权豁免、运行计划任意改图、在线下载/Comfy/TTS/完整封面组合；这些 B/C。单章复用属于 A：同 run/scope、同 input/output/quality 摘要、真实 lineage、当前成功 attempt 的已接受包才能由服务端复用（reuse_of_package_id/reuse_of_gate_id）；首章/章节可合并，样片覆盖整章且完全相同可显式复用。换质量、内容、模型配置或输入即 stale，不能仅按 chapter_id/时长复用；audio 不满足章门，封面独立。无稳定授权实现时首章仍保留。

## 跨领域字段合同与权威

以下引用现有冻结 TS/服务类型，新增装配建议标为“提案”，不新增生产 API。

|producer → consumer|字段约束/错误/兼容|
|---|---|
|BRIDGE relay → CreativeService|QuestionAnswerPut meta(idempotency_key/correlation_id)、intake_id/expected_intake_version、question_id/question_version、input_digest、expected_answer_version CAS；action 与 text/choice_id/skip_allowed 一致。source_message_ref 可追溯；服务写 source 与 authority=content_only，不能信 actor=human/confirmed=true。旧答案保留并 stale，新 brief/问题不消费旧闭包|
|MAIN ProductFactPort → FixedWorkflowService|一次一致读取 project_id、exists、project_revision、control_revision、source_digest、snapshot_id、rights_authorized/rights_reason、capability_available/capability_fingerprint/capability_reason；fingerprint=真实四能力描述摘要。缺端口/未知能力 CAPABILITY_UNAVAILABLE；wrong project RUN_SCOPE_REQUIRED，缺项目 NOT_FOUND，许可不成立 IMPACT_STALE。不得从 UI/brief 自证许可|
|MEDIA + MAIN step authority → publishReviewPackage|project_id/run_id/plan_version=1；step_id/attempt 必须当前、job 与 input_digest/授权一致；package_id/kind/chapter_id；input_digest/output_digest/quality_digest 全部真实；parts 每个 kind+artifact_ref{id,version,sha256}+download_ref(null或受控下载引用)，五类章内容齐备；source_shot_ids/selection_reason；allowed_choices/impact/reuse_of_package_id 由 Host。拒绝取消/旧 attempt/假产物。预览下载路由及播放器定位适配是提案 RP-P1，由 MAIN+MEDIA 确认 URL 范围/过期/身份校验，不能编造端点|
|trusted_ui → decideReview → MAIN TrustedAdoptionAuthority|ReviewDecisionInput project/run/package/version/plan_version/input/output/quality 逐一匹配 pending 包；choice 在 allowed_choices；采用须 impact_id/plan_sha256 与 active 未过期 impact 同 project 匹配。registerConfirmation 绑定 actor/session/purpose/action_digest/issued_at/expires_at/channel；registerApproval 绑定 scope/step/attempt/input/change/impact/base_revision/control_revision。复核失败 REVIEW_STALE/IMPACT_STALE/APPROVAL_REQUIRED；同 key 同 request 回原 receipt，异内容 IDEMPOTENCY_CONFLICT。提案 RP-P2（按D-04细化）：可信决定与限定Approval同事务登记；随后commit事务重验并消费Approval/impact、写commit与事件，确认 UI 单次动作的实际路由组合；现有业务 port 不是已装配生产保证|
|Host Workflow/Context → UI/BRIDGE|Workflow project_id/workflow_revision、nodes[node_id,state,reason,input_refs,output_refs,job_id,attempt,dependencies,allowed_actions]；未派发 attempt=0/job=null。Context revision/control/snapshot/source/selection_version/active_run/native_ack 原样消费；断连保留最后观察时间并 unknown，不按时间增长假进度。投影乱序按项目与版本隔离；重连全量读后接游标，不把不同 generation 增量合并|
|MAIN NativeAck producer → Context/NativeSyncIndicator|project_id、bridge_session_id、instance_generation、loaded_project_revision、loaded_snapshot_id、source_digest、selection_version、observed_at 必须绑定真实会话与当前 commit。UI 只显示；Host 负责会话/generation/epoch/来源验证。现有 Indicator 只比较项目/revision/snapshot/source/selection，不能代替 Host 身份判定|
|MEDIA/MAIN delivery → PRODUCT|DeliveryManifest delivery_id/project_id/snapshot_id/source_digest/render_spec/render_config_digest/attempt/media_ref/ffprobe_ref/full_decode_ref/supplement_refs/qc/published_at/download_ref；QC block 不发布，preview/job success 不等于交付。提案 RP-P3：在 M5 delivery-preview 阶段接真实 created 导出入口，MAIN 指定注册路由、幂等键与快照 CAS；不自行热开能力|

## NativeAck 的独立 expected 与 observed

提案 RP-P4（MAIN 装配/合同审核，BRIDGE 可信传输，PRODUCT 仅候选）：013 observed 与015 expected 不是互相背书。完整 ACK 还需 film 文档/source closure 与 captions/subtitle_style 等全部要求；015 仅计算 settings/markers 两部分，不足以将全部 source loaded 判绿。

Host expected 输入严格使用015 expected-projection.d.ts：format=narralens.native-expected-input@1、upstream_sha=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3、profile=narralens.native-expected-numeric@1；binding project_id/project_revision/snapshot_id/source_digest/film_sha256；source_entries 封闭规范相对路径+真实hash。provenance host_independent 的 source_manifest/listing digest 与适用 rights/media_catalog digest 来自独立 reader/DB，不接受浏览器 relabel；null 仅已证明不适用，未知拒绝。
film.file/value 为原 parser 的真实文档和 clip id/src/显式 at/time/speed；settings/markers 明确 present/absent、固定路径/hash/value，不得把读取失败当 absence。clip_refs 每 clip 一条，registered_asset 用真实 asset_id/rights_digest；controlled_source_artifact 用真实 artifact_ref/producer_digest/producer_receipt_digest/文件hash，概念页不伪造 AssetRegistry。media_facts source_ref/source SHA、origin、proof_digest、duration_ms/fps/has_audio 来自实际 probe 或合法确定性页面事实；video_files_in_native_order 包括未引用视频及原 native 排序，不能用 UI rows 决定 fallback FPS。span_facts numeric_source_only/not_used/[] 或真实 host_attested；动态未知不猜。ui_profile pending_drops/preview_error/live_height/browser_preferences=excluded，Host 还要独立拒绝实际脏态，excluded 不证明不存在。
computeExpectedProjection 复用原 filmShape/layoutTracks/trackNamesOf/trackHeightsOf/ownTrackHeight/footageFps/placeMarkers 与 parseProjectSettings/parseMarkers，绝不写另一套时间线算法。返回 computed/value/canonical_utf8/sha256/input_sha256/not_proven 或 unsupported；computed 不授信。hash preimage 是013 hydration effective envelope，不与 CP integer canonical digest 混用（原生秒数允许小数）。

Observed 由原 Studio ProjectView/useFilm 已消费状态产生：project_id=native ID（Host 私有映射），editor_view_id、document_epoch、单 view 单调 hydration_epoch；parts=settings/subtitle_style/captions/markers，各 state=pending/hydrated/absent_default/dirty/failed/unsupported，origin=project/explicit_default/browser_preference，effective_sha256 仅 hydrated/absent_default 可非 null。settings 包含真实 resolved_fps/fps_source/track_names/track_heights；style 是完整原生对象；captions 包含 cues/sourceLanguage/languages/untranscribed；markers 为实际 placed marker/ms/clip_id。原 GET 失败维持 failed，dirty sticky，浏览器记忆样式 unsupported，即使 hash 恰好等于默认也不接受。
同 document epoch 只读 revalidation 比较原生当前实际状态与新 GET，不 reseed 状态、不写偏好、不启动媒体。callback throw 应 abort 当前轮（013 H-R1），旧 view/session/generation/document_epoch/hydration_epoch 输出全部失效。Host 在最终边界重新核对 active commit、源文件闭包、session alive 与 selection_version；失联 unknown，等待 pending，明确失败显示原因，旧版本 stale 只读历史；三态对外 native_sync 不扩枚举，细原因从受控诊断映射。媒体 decoded、ASR、burn/QC 另证，不借 hydration 推定。

## 持久性、取消与恢复

UI 不是事实源；关闭 panel/网页不取消 Host。pause 阻止未来 dispatch，不等于停止在途，cancel 以 Host receipt/attempt 对账；未知响应先读取同 operation/key 的事实，禁止盲重提采用/导出。准备产物不会改 author source/revision；失 lease/取消的晚到结果不能发布 review 或 commit。流程 workflow_revision、plan_version=1、project revision、control revision、selection version 分开。
重开先核 checkpoint/receipt/source/current commit，再恢复明确授权确定步骤；需要推理显示 waiting_agent，不自动拉新 Agent。旧 grant/approval/impact 过期重新确认，不能 UI 自动续期。采用失败允许已记录可信决定/限定Approval而commit尚未发生，UI显示采用待处理；不得出现Approval已消费但source半写，由 MAIN 原恢复协议保证。PRODUCT 不实现另一个 reaper/DB/commit manager。

## 输入 SHA256（本轮只读采样）

路径均相对 MAIN；dirty 文件哈希不是提交声明。

|路径|SHA256|
|---|---|
|package.json|edace26fdfa5a9808f2706fe15ab3935d0512d08f765d4cffec268eb7e783263|
|src/host/agent-driven/creation-application.ts|20247ab174bc36bfc506a49126b80aa0ec784478f498f84b16121ad9581192f9|
|src/host/creative/fixed-workflow-service.ts|affb339613036d4b7a6572d63247f53754725a98488ae671c76b7317995aaf7e|
|src/host/creative/creative-service.ts|b896b99e4b0e5f293d8d95c282aad4fa23614a5d252c933f0a4f46bff8f6fa8c|
|src/host/creative/product-repository.ts|f071a02f1ed691e70a7f7cc774c6f4b5948c088e4a8411491fb51adb7affc3b7|
|src/contracts/agent-driven-types.ts|54356697802c0bf048e5cbcde1f54eb33713d4fe58943b346406804011cb3644|
|src/app/m5/M5Panel.tsx|bc14306afd082adf1d95ebe45f613802955670e669c59081b67ae98551eecd7e|
|src/app/observation/WorkflowTopBar.tsx|c37ca965c3482ef5f5fb6fbe8d36933fda3989b375995820a1031579fec919eb|
|src/app/observation/CreativeReviewPanel.tsx|6686701049664268a8725c069cff5f06dc3d2ed16779517b1f138c31a05b784f|
|src/app/system/SystemControlPanel.tsx|a75200b68ae317f1af360618c068ad40c459f16413ee313b533439ccd61436c0|
|src/app/observation/content-views.tsx|f57cf8ddd284eb85fe6ffb194e28e4cc9a6fdbeae2ec698ccca4e0069a66e8c9|
|src/host/agent-driven/created-workbench-service.ts|18508271d20dbc7fef7a6a540d88b86e25fc59c927221381f9bcfd2c5b2a7937|
|src/host/agent-driven/created-native-workspace.ts|90fa46ca3bc677bd687060ed7f3fb89f653b7cea89688641b0a43cd63ab467f4|
|src/host/agent-driven/created-draft-processor.ts|6727b0b64bc07cfdea0346e7f885d0ffcbd74832a66f939056735c66872eeef5|
|src/host/agent-driven/prepared-draft-verifier.ts|ffefbd4169dfd07930723e2606997845fc1bc4a1aa9d0f6b60b7bfd6eb5276db|

canonical `docs/execution/A/contract-freeze.json` SHA256=532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170。

canonical `docs/execution/A/relaunch-20261111/baseline-observed.json` SHA256=f31f82d57a3eb2df6608b6fc47ffab68124ca8bb1e0d038c0c231838bd19e38a。


## MAIN 草案对齐（2026-11-11 补充）

已读同级02_MAIN_CONTRACT_AND_DECISIONS.md、05_MAIN_ACCEPTANCE_AND_REVIEW.md；MC-01..14作为不变量，裁决仍是DRAFT，不能当release。RP-P1..4还须明确以下内部接缝：
- RP-P2a：prepared-source不可变证明如何合法映射materialization_id，MAIN须裁决兼容适配或显式版本变更；不得伪造M3 migration/materialization，不原地扩冻结80defs/31routes。
- RP-P2b：waiting_user下review→change.prepare/apply的动作门和QC/adoption Gate唯一writer，由MAIN明确；预览审阅不应依赖先正式commit，否则形成循环。PRODUCT只呈现已获允许动作，不绕过execution-guard。
- RP-P1a：MAIN/BRIDGE须给Agent真实LocalAsset发现/Ref namespace与摘要验证；不把测试fixture形态作为生产协议。MEDIA实际预览producer声明授权、输入/输出/quality，Host验证后发布包。
- RP-P4a：015只覆盖settings/markers；captions/subtitle_style/film/source完整闭包的独立expected与原生真实观察必须有明确producer，不允许由PRODUCT显示组件填补未知。

兼容策略：旧Hypit/迁移入口、七方法EnginePort与strict409维持；新增内部事实/DDL也需MAIN审定同库迁移及旧库重开；新增wire必须显式ADR/版本和双方合同测试。依赖未关闭的票据保持BLOCKED_DEPENDENCY；无需新增逐模块人验，A组合门统一验收。


## P-A1 补充：用户素材登记路径（MAIN msg_ffc4f450b981）

事实：LocalAssetRegistry 只有 Host import/list/resolve 方法，尚无生产素材选择/登记入口；import 要求 trusted_ui，list 对认证owner开放，不能误称已实现UI/MCP inventory。sourceRoot由Host配置，客户端不能选择根或传绝对路径。
用户路径：可信创建工程后，在原工作台素材区打开“登记本地素材”；读取配置根内受控相对文件目录，选择实际视频与中文录音，填写来源/许可及录音来源声明，确认本次登记；Host核字节/摘要、probe和完整decode及owner后返回登记事实。UI显示文件名、类型、实际时长/状态及许可提示；确认后Agent通过只读inventory取同一asset_id/rights_ref与摘要并更新简报，不让用户复制ID到命令行。根未配置、目录不可读或无可用文件明确blocked，不扫描其它盘，不上传、不下载、不扩大sourceRoot。

新增提案RP-P5：MAIN冻结独立UI transport与只读MCP inventory附属合同，不改原80defs/31routes。建议纯组件 LocalAssetRegistrationPanel（新文件须MAIN精确释放），受控props为目录读取状态、候选项、选择、source/license/recording_origin表单、登记receipt与error；UI动作通过MAIN adapter，组件不访问文件系统。目录候选DTO按MAIN附属schema使用opaque candidate_id/display_name/kind/bytes/expires_at，客户端不获可注入路径或hash；分页/过期/根版本由附属registry约束，均不是已注册生产wire。shared入口请求包括Host安全目录枚举/登记transport、原工作台挂载与Agent inventory读取；未冻结前禁用提交，不填伪列表。

以下仅是Host内部LocalAssetInput调用合同，绝非UI POST DTO（浏览器只提交RegistrationRequest，见下文D-01精确补充）：project_id绑定已创建owner工程；idempotency_key绑定一次逻辑登记且重试复用；relative_path为配置根内安全相对路径；expected_sha256由Host候选事实取得并在登记时重查，不让UI猜hash；kind为video/audio；source={kind:owned/generated/licensed/derived,label,可选uri或lineage}须匹配现有校验，derived lineage必须已在同项目登记；license={status:cleared/restricted/unknown,label,commercial_use}不预选为cleared；recording_origin视频必须null，音频明确human_recording/synthetic/unknown，A真实录音只接受有真实人类录音证据的human_recording，不由音频扩展名推定；attestation_ref绑定这次可信用户声明，由MAIN附属合同定义产生与防重放，不能普通Agent文本伪造。
Host返回LocalAsset中的project_id/asset_id/sha256/bytes/media/source/license/rights_ref/registration_digest供UI与inventory消费；attestation.operator_id/session_ref/source_message_ref/recorded_at的公开字段由MAIN最小化投影，不把内部会话字段直接发MCP。source/许可声明不等于已授采用/运行；后续Run许可守卫仍重核。source.uri仅来源说明不触发网络。目录/登记错误映射沿现有ProductError，由附属transport锁HTTP语义，不自创新wire错误码。

状态：unconfigured→loading_directory→selecting→validating/submitting→registered或failed；未知响应进入reconciling，先按同key回执/列表对账而非新key重提。失败保留用户表单但不显示已登记，文件替换/hash变化刷新候选重确认，跨owner/旧会话/路径越界/symlink一律拒。取消等待实际Host停止/回执，不因UI关闭宣称取消；成功只增加受控blob/登记/receipt/outbox，不改author source/revision/active snapshot，不自动批准Run或采用。共享根变更和实际音频真实性未知均阻止A素材放行。


## D-01..D-07 领域反馈（设计ACK，不是release或独立验收）

|裁决候选|PRODUCT结论及体验/合同边界|
|---|---|
|D-01|ACK：配置sourceRoot候选选择→真实声明→登记→Agent库存，无手抄ID。按草案UI三个local-source-files/local-assets入口与owner-scoped asset-inventory只读resource作为拟定接缝；不是原31工具。inventory rights_ref固定Ref{id:真实rights_ref,version:1,sha256:registration_digest}，需真实row/current bytes/许可核对；limit32/max64、绑定cursor，无session/blob/绝对路径。目录expected hash来源、候选过期冲突刷新由附属schema定稿；不把来源声明当独立许可验证|
|D-02|ACK：显式prepared-source@1及discriminated resolver，无伪migration/M3行；UI只消费包与impact，不消费stage。相同短ID但完整digest冲突必须拒绝；读旧M3端点不能误返回prepared-source|
|D-03|ACK：JobReceipt.result_ref只有实际包发布后才指package Ref，以execution.run_id/ref.id走现有review.read；UI不把非null任意Artifact Ref当审阅包。五parts真实namespace/hash由Host保证，opaque鉴权下载；未发布显示待准备，已发布后刷新包版本再决定。必须补result_ref与review.read返回version/hash一致及跨owner拒绝case|
|D-04|ACK，修正本文RP-P2事务表述：一次可信点击记录决定+限定Approval可以先完成，随后采用pending；只有真实commit成功显示已提交，只有完整原生观察确认显示已加载。pending不要求用户重复批准同一未变化影响，Approval失效或事实变化才重新审阅。普通guard不得开放所有waiting_user；只允许Host proof窄effect。后续依赖采用的写/导出必须查真实transaction而非review accepted。反例：decideReview当前会将包gate accepted、可能把run投影running，而commit未完成；若UI或调度只看此gate/run会提前绿灯，必须在D-04生产接线与验收中拦住|
|D-05|ACK：preview≠Delivery，committed render/QC receipt与正式publish分开；UI封面只要求真实选帧，不引入B多封面。已有render receipt不显示可下载正式交付，只有真实ready manifest可正式下载；producer attempt与publication execution分别绑定，重试不能覆盖来源|
|D-06|ACK：不改vendor，013/015按pin隔离构建，全身份/epoch/current source重查。明确剩余实现依赖：015无captions/style完整expected，不能把其computed作为整工程ready；必须给真实producer与浏览器负向实证，缺一仍unknown/pending。此处是依赖未实现，不是反对分层裁决|
|D-07|ACK：MAIN先核838ba5f2c8500f0103f56dbe51264ea9f70086fc+已归档overlay，再由唯一core writer得到共同可复现commit；当前不能填写未来SHA、直接在旧lane实现/合入。release必须重写实际路径/完整SHA/白名单|

D-01新增附属端点和resource均保持“裁决候选”，当前未注册/未实现，不改变历史冻结字节。D-04的异步两段业务边界不增加人验次数，也不创建采用完成布尔。D-03与D-04组合须保证样片/首章/章节同scope同输入输出质量完全一致时合法复用一次可信决定；不能因同一产物有三个门就机械发三次确认。


## D-08..D-12 与 D-01 精确DTO ACK（最新有效细化）

D-08 ACK：现有change.prepare/apply HTTP/MCP输入先过冻结DTO/身份/owner验证，再由新CreatedSourceChangeService从真实行构造Host-only effect；不是开放客户端proof，也不是永久503。review.decide仍返回ReviewDecision，事务后自动apply与Agent同impact/approval apply必须共享幂等/消费权威；兼容change.approve解析唯一当前包并复用可信决定/限定Approval，默认UI只有一次确认并采用。拒绝/撤销只作用本次未消费批准。新服务由BRIDGE Claude受MAIN单writer释放，PRODUCT不写共享core。
D-09 ACK：Change由Host构造；target_snapshot_id采用前只是内容寻址预期ID，UI不得显示已保存/已提交。base/source/control/selection/完整PreparedAdoptionPlanV1摘要/真实锁图/15分钟impact TTL由Host，重放不续期；now>=expires_at拒绝；stale投影revoked，不扩wire枚举。integer帧与有理fps进入CP canonical，native浮点留013独立域。
D-10 ACK：created保留真实origin，新分支仍唯一Coordinator/project_transaction；完整闭包发布、backup/journal/fsync与恢复gate，不只替换film。UI遇pending recovery显示恢复待核，不自动新任务/假terminal attention；DB commit/批准消费/+1/事件同边界，重开不得重复+1。不得伪migration调用旧commitAdoption。
D-11 ACK：同delivery Job/lease/step，QC/publish是不可变事实驱动恢复，非第二进度状态；UI不把QC通过显示为已正式发布，不把publication attempt覆盖producer身份。新增组合tests路径是未来文件，不冒称当前存在。
D-12 ACK：原CP四文件bytes不变，但明确新增素材4 HTTP+1 MCP resource及review-media 1 HTTP协议面，不声称总面未扩；附属schema/registry当前DESIGN_ONLY。旧PASS不适用当前漂移字节；MAIN R0重审当前overlay，子Claude工具链以自身Node/corepack pnpm结果为准，>=22.15.0及pnpm10.33.0，不安装或联网补足。

D-01当前精确UI合同优先于上文历史提案：SourceFileListing={format:narralens.local-source-files@1,project_id,items[{candidate_id,display_name,kind,bytes,expires_at}],cursor_next}；只读目录不hash全目录、不probe打开未知媒体。RegistrationRequest={meta:{idempotency_key,correlation_id},project_id,candidate_id,source,license,recording_origin}，additionalProperties=false；禁止UI提交relative_path/expected_sha256/attestation_ref/kind等Host私有输入。Host解析principal/project/root-generation+regular-file identity候选，仅hash所选文件，重核后构造原LocalAssetInput。source owned/licensed/generated的uri为nullable字段，Host须把null归一为省略再进旧校验；derived用同项目lineage（最多128）。license/source标签按附属512上限，UI不裁剪已存事实来伪装兼容。video recording_origin=null，audio必须明确取值，业务交叉约束由Host再验。
UI成功消费InventoryItem公开投影；source候选与cursor TTL=900秒，默认32最大64，cursor绑定principal/project/operation/filter/root-generation，失效410必须刷新，不悄悄续新generation。登记同key同digest已成功先回receipt，即使candidate过期也不要求重新选择；异内容409。400校验错误、401重新可信登录、403渠道/Origin拒绝、404不可访问、409刷新冲突事实、410候选/游标过期、503配置/工具/资源不足如实展示；不自动重试有副作用新key。

本次附属设计输入 contracts/asset-inventory-v1.schema.json SHA256=64bb24e9f4e67bfadf75ca484b50a397c591d99aaf4bdfbfa2a7b6c5974ae6c0；非生产冻结声明。

本次附属设计输入 contracts/asset-inventory-v1.registry.json SHA256=c01590441d06e25f40695e9119bbcc3ddc95d6a3427bc0cc895deabed4099a8d；非生产冻结声明。


## Claude readiness 逐项闭环（领域复核，非独立验收）

原始回执CLAUDE_READINESS.md保留不覆盖；其BLOCKED是审阅当时结论，不自动视为最终MAIN门。以下采用实际源码和最新D08..12/03 owner表纠正与闭环，未运行任何业务测试。

|反馈|具体闭环/证据|
|---|---|
|E1/B3|application-dispatcher.ts的workflowHandlers含10路由；creation-application.ts当前未装配完整handlers且FixedWorkflowService只传repository。必须同批注册handlers、注入ProductFactPort及TrustedAdoptionAuthority并接trusted权限，缺facts的requireFactPort直接CAPABILITY_UNAVAILABLE。03表已将creation-application/application-dispatcher/created-run-facts/created-run-authority分配BRIDGE-Claude（设计owner，非release）；不再写“无人负责”|
|E2/N-1|PreparedTaskFact无materialization_id；旧AdoptionCoordinator/ImpactService有ready_for_adoption/native_plan专属M3检查。D08..10的新CreatedSourceChangeService→CreatedSourceAdoptionService→Coordinator.controlledWrite→commitPreparedCreatedSource构成assembled_native_source独立消费分支，legacy继续旧服务；不得把新行送进旧8处检查或简单删除旧门。因此需要验证分派边界而非强制修改旧8处；MAIN最终复核该消费闭包，RP-P2a依P-A2/P-A3仍保留|
|E3/E4/E11|render/render-snapshot.ts的SnapshotRenderService implements RenderPort存在，render内部调用commitReady；当前生产creation/start/server未装配。M5Panel已有delivery-preview阶段与render分支，UI不重造，补真实producer/route/CAS/状态。新生产按D05/D11阶段化端口，旧facade保留旧测试；双导出依BRIDGE持久装配+MEDIA阶段producer|
|E5/E18|change.prepare/change.approve/change.apply是冻结31路由内的合同面，不是08中的新增拟定MCP名；冻结registry production注记不代表当前运行状态。当前CreationApplication无这三producer注册，D08新增producer挂接；review.decide也需完整workflowHandlers装配。原NativeWriteGateway的set_visual_fit/replace_visual_asset/restore_snapshot是有限typed原语，不能宣称任意改单镜已经可用|
|E6|FixedWorkflowService.publishReviewPackage调用#assertReuse，后者核同run内来源、同chapter_id、input/output/quality摘要；reuse_of_package_id与reuse_of_gate_id进入checkpoint/包事实。P04必须取服务端记录而非UI隐藏首章|
|E7/E8|C1会执行全部现有product测试，不等于允许修改全部测试。现有test文件为creative-service/fixed-workflow-service/observation-ui/execution-guard/digest共5个，support不是额外test。PRODUCT测试修改白名单移除service测试；fixed-workflow-service/execution-guard测试由03的BRIDGE writer负责，digest/creative-service仅回归读取，未单独释放不得改|
|E9|6efbb796…是baseline-observed内部MAIN归档tar的archive_sha256，不是baseline JSON本身；文件自身SHA见输入表（f31f82d5…）|
|E10|FixedWorkflowService.decideReview在同事务写content_decision、review_request.accepted、gate.accepted、run；#nextRunState明确过滤adoption kind，只剩adoption pending时可投影running，方法本身不commit。故采用pending/commit/Ack分开是必需实现与P05负例，不是可选文案|
|E12|新local-source-files/local-assets/asset-inventory端点当前未装配；现有projects/asset-port.ts AssetInventoryPort是旧wave2消费者端口，不等同新owner-scoped库存DTO。配置根由start-runtime的NARRALENS_LOCAL_ASSETS_ROOT变量名注入（未读取其值），附属inventory不得替换旧port|
|E13|result_ref在包发布前null，之后project/run/package/version/hash一致；review.read通过workflowHandlers→readReview，依B3同批装配，纯UI不能自行伪包|
|E14|015 candidate/expected-projection.mjs调用parseProjectSettings/parseMarkers并仅构造settings/markers输出；d.ts computed/unsupported类型无全工程证明。完整captions/style/film/source producer由03给PRODUCT的Host native模块实施、MAIN审核接线；不是显示组件补值|
|E15|共同实现commit及release未产生前所有未来业务命令NOT_RUN；提升为ACCEPTANCE总闸|
|E16|附属设计准确目录为docs/execution/A/relaunch-20261111/contracts/asset-inventory-v1.schema.json与asset-inventory-v1.registry.json，当前不在仓库根contracts。schema DESIGN_ONLY、registry DESIGN_REVIEW_PENDING_NOT_REGISTERED都表示未注册设计，兼容解释无需擅改MAIN标记；以后生产文件只按03明确释放|
|E17|created-run-facts.ts、created-run-authority.ts、created-source-change-service.ts、created-source-impact-store.ts、created-source-adoption-store.ts、created-source-adoption-service.ts、fixed-phase-executor.ts、created-source-publisher.ts均为src/host/agent-driven下未来新文件，由03的BRIDGE-Claude负责，PRODUCT零交集|

B5的共同commit/正式ReleaseAssignment/真实素材授权未完成，是本轮预期开发停止条件，不能伪称消失，也不是必须在仅文档轮实施才能交付文档。D04/D05/D08..11生产装配owner已由03落表，所有路径仍是设计分配未激活。MAIN最终06审核N-1消费闭包、B3端口注册同批和依赖项；领域不能自行签启动许可。

对readiness自身的限制：其“cwd与canonical同目录”措辞不准确，实际cwd是父工作区/mnt/c/workSpace/videoWorkLine，canonical另在其Narralens子目录；仅大小写变体映射同文件。其“未读凭据”与同文承认token出现在工具输出矛盾，按违规事件记录，不采信未读声明。模型仅采信会话自报MiniMax-M3.1-Flash-Preview[1m]与用户MiniMax要求相符，账户/额度未知；不以读取配置交叉验证。corepack缓存存在不等于实际corepack pnpm命令已验证，版本启动复核仍未运行。


## 最终 D-13..D-15 ACK（本次 task_e29d113e9db3；覆盖旧QC含混表述）

结论：D13/D14/D15均ACK；以下反例是实施必测条件，不是重新索取文档裁决或把当前无release误报文档缺陷。结合已settled Claude的E1..E18/N-1/B3反馈，设计消费链与owner已闭环；R0共同commit→正式release仍是有意保留的开发停止边界。本次未再启动子Claude、未读取用户配置，原凭据事件记录保留。

**D13：内部表与准备成功。** 实读agent-schema.ts:fingerprint/applyAgentSchema覆盖全部cp_a0_*；因此新增表只用created_prepared_source、created_impact_fact、created_adoption_fact、created_render_evidence、created_delivery_phase_fact、created_review_gate_fact、created_qc_disposition_fact，前轮cp_a0前缀提案撤销；既有cp_a0_render_attempt/delivery仍维持原权威，原SQL/四冻结合同不动。独立内部namespace固定DDL校验，不放松原schema匹配。实读created-task-store.completeCallback终态确是succeeded/SOURCE_ONLY，provider receipt kind=local.native-draft@1、stage=SOURCE_ONLY、source_digest匹配持久prepared fact；UI显示准备完成而非已采用。成功任务无running lease，不能为采用重新claim成功Job；MEDIA proveForAdoption从持久producer completion+当前source/rights重建私有FD proof绑定受控transaction，PRODUCT不序列化proof或自证资产。

**D14：编码、技术QC与发布分开。** UI使用“编码完成，待质量检查”“技术检查完成，待你确认”“发布处理中”“正式交付就绪”独立状态；encoded fact没有QC通过字段，不能产生正式下载。created_render_evidence的encoded/qc_inspected以parent digest形成不可变链；receipt/manifest attempt是已发布winner一致身份，producer execution/lease另存，不混入UI最终交付版本。技术QC后仍必须走D15人类门。恢复从真实encoded对象hash复验后QC，不重新encode冒充恢复；包receipt与数据库ready必须一致，DB已ready但包缺失阻断并显示需处理，不能仅凭receipt给正式下载。预览媒体读取与正式下载仍分开。

**D15：最终QC的真实用户路径与字段。** 在P-A3两次正式导出各自的当前成片版本，Host自动完成低价值技术检查→形成五项chapter_pack容器和pending qc门→用户在原工作台“交付质量确认”查看当前成片、旁白、字幕、镜头概述、许可质量及所有warn→通过原review.decide可信确认→Host按原scope继续delivery.package。这是作品/质量门，不是增加逐模块人工批准；此前样片/章包接受不自动接受最终QC，无warn也仍需当前QC可信决定。

Producer/consumer：MEDIA提供实际encoded/QC/sidecar证据；BRIDGE的Host-only publishQcReviewPackage建立不可变created_review_gate_fact（gate_kind=qc、producer_step=delivery、project/run/package/version/input/output/quality/render_evidence_digest），并将包ID关联到现有WorkflowRun.gates中的qc RunGate；PRODUCT读取同run的gate.kind及review_package_id，与review.read包project/run/id/version和摘要匹配后显示QC标题，不按wire kind=chapter_pack误当普通章包。version/input/output/quality/render_evidence的最终一致性由Host重验，UI不接收或提交target_gate/internal fact；若UI读到gate和包不匹配，显示状态待刷新并禁用提交，不猜测QC身份。review_request.gate保留chapter分类，API/DTO/kind及决定渠道不新增。

可信UI仍提交原ReviewDecisionInput字段：meta、project_id/run_id、package_id/package_version、plan_version=1、input_digest/output_digest/quality_digest、choice、impact_id/plan_sha256；QC纯确认使用允许的accept（impact/plan为null），不会产生采用Approval或再+1。Host同事务核created_review_gate_fact、真实QC证据/当前snapshot、已有chapter_pack+cover门，并仅更新绑定qc Gate，不让普通PACKAGE_GATE[chapter_pack]分支误更新章门；旧publish/decide无该fact时保留原映射。common guard永不写accepted，Agent relay/技术通过/页面关闭不构成QC接受。

warn完整列表及quality digest从当前rights_quality证据读取并明确展示；只有用户对此包当前质量版本的可信决定，Host才在同事务写每个warn的created_qc_disposition_fact（reason_code=user_accepted_disclosed_warning、decision_id、item_id与当前质量证据绑定）。不扩wire增加warn布尔；新增warn或quality摘要变化使旧决定stale，必须展示新差异后重审。任何block都不能以accept或“已知风险”覆盖，UI禁用接受且Host强制拒绝；未知/缺失质量ref同样不放行。关闭面板不决定；纯章包复用规则不能移用于最终QC自动accept。

QC待审时同snapshot_publish Job回queued、step waiting_user、释放lease；claim排除pending QC，不能循环inspect/占槽。人类接受后同Job新lease_attempt、原execution attempt不变，开始真实package才step running；暂停/取消/授权过期仍阻止派发。UI明确“等待质量确认”而不是“发布中”，取消待审Job需原step收敛；成功后Job/step/Delivery/event同权威结算。

源码反例依据：fixed-workflow-service.ts现有PACKAGE_GATE.chapter_pack=chapter_pack且publish/decide按kind选择目标（约979/1263行），当前没有publishQcReviewPackage/created_review_gate_fact分支；直接用旧路径发最终chapter_pack会错误接受章门且QC仍pending。该新增内部分支由03明确分给BRIDGE，不由PRODUCT伪造qc状态；PRODUCT UI+native Host精确路径按TASK最新表由product-Claude独占，MAIN审核后于R0 release激活。

受控媒体附属入口已读docs/execution/A/relaunch-20261111/contracts/review-media-v1.registry.json：GET /api/ui/v1/projects/:id/review-media/:ref，opaque ref绑定当前包/版本/output/quality/attempt和文件receipt；trusted_ui读证明或owner driver可读，native_bridge禁止。仅media/VTT/JSON且文本转义；不HTML/stage路径、不读触发编码；416/断线释放FD，409摘要变更要求刷新。协议统计更新为原31+素材4 HTTP+review-media 1 HTTP及1库存resource，均仍设计未注册。

本次只读输入 `02_MAIN_CONTRACT_AND_DECISIONS.md` SHA256=e02b0e312930c15ce3a3994e674aeee9cce61b360990eaa1ac177bfe4a7a167b。

本次只读输入 `03_OWNERSHIP_AND_DEPENDENCIES.json` SHA256=bef665e67605b090b7a41d6ed48fd767b928e1a174d06ec745b437bdf6945db6。

本次只读输入 `contracts/review-media-v1.registry.json` SHA256=77290e4376ec013e0f7f75f8e6fccf02d1dede0a03623a4527280d75dfb8212e。
