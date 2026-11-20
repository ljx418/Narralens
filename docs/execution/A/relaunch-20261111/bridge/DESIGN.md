# BRIDGE A 恢复准备详细设计

状态：DESIGN_REVIEW_PENDING；仅开发启动门准备，产品验收全部 NOT_RUN。2026-11-11；用户本次授权覆盖旧文档“不可启动窗口”，但只允许只读 Claude 启动，不释放实现。

## 基线与事实分类

源码唯一观察基线 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `838ba5f2c8500f0103f56dbe51264ea9f70086fc` + 当前 dirty overlay。canonical `/mnt/c/workspace/videoworkline/Narralens`（Windows `C:\workSpace\videoWorkLine\Narralens`）只作指定文档写区。不得复制成替代项目。MAIN 本轮归档 `../baseline-observed.json` 为事实索引；旧 `docs/execution/A/baseline-observed.json` 只作历史。

事实：CreationApplication 构造 ProductSqliteRepository、FixedWorkflowService({repository})、ProjectContextService，但未注入 facts/adoption。dispatcher 注册 workflow.read/run.read，而未 spread workflowHandlers；task.prepare/job.cancel 未注册，job.read 仅允许 creation Job。ApplicationDispatcher 缺 handler 明确 CAPABILITY_UNAVAILABLE。不能因为 registry 历史 production=NOT_IMPLEMENTED 就认定所有实现不存在，也不能因为注册表列出名字就认为生产可调用。

事实：CreatedTaskStore 已有 reserve/receipt/readPrepared/recordPrepared/finishPrepared/finishFailed/reapExpired/leaseReaperExclusions；CreatedTaskGate 已核真实 owner、activeCommit、creative closure、immutable prepared event、固定 plan、execution guard。CreatedTaskWorker 已有最多2槽、原 PersistentJobStore lease、恢复先于 claim、heartbeat、取消/失租约 abort、close 等待所有操作；CreatedDraftTaskProcessor 是未提交实际实现，只支持 assemble_draft，调用 PinnedNativeDraftAssembler 与 PreparedDraftProofPort。PreparedDraftVerifier 文件存在，不能用历史缺席描述抹掉，仍需最终绑定验收。

已通过但受限：lane HANDOFF 记载 a325f9483cb5106aeb829121fc20ac34496e34e3 下 108 项模块检查和 tsc；SDK 子进程测试使用 stand-in Host，不是首端真实产品。task-worker pre-review 与 draft-processor pre-review closure 记录局部静态 PASS，后者关闭 revoke 异步窗口和 job/CP reaper 分裂；这些历史结论不覆盖当前overlay：Claude核对closure输入与当前processor/store/worker及测试已漂移；当前字节须重新绑定审查。本轮未重跑，绝不是 A PASS。旧 bridge lane 候选只能逐文件对 MAIN 本次 hash 判断，不回移旧实现。

未实现/未接通的用户链：真实 ProductFactPort、可信确认/限定Approval生产适配、固定Run生产写路由、原task Job读/取消、prepared产物正式消费入口、实际 task worker Host 装配、Run取消到Job取消完整桥、prepared→审阅→受控采用→NativeAck→正式render同事实贯通。已有模块须复用；render/QC/delivery由MEDIA提供，不向草稿processor塞假成功。

## 0/1 层实体与真实调用

L0：首端真实 Codex MCP→现有 stdio-main/createMcpServer→createHostApplicationPorts→AgentHttpRouter/ScopedAgentAuth→ApplicationDispatcher→同一 NarralensHost、RevisionStore、Coordinator。UI通过 trusted_ui 同一事实库，不能有另一个审批/任务库。BRIDGE不是产品驱动的多Agent接力控制器，后者B。

L1已存在：FixedWorkflowService.prepareRun/authorizeRun/startRun/pauseRun/resumeRun/cancelRun/readRun；CreatedTaskStore.reserve 在 RevisionStore.atomic 内经 assertAllowed(new_reserve)、bindStep、assertAllowed(final_reserve)绑定原job与cp_a0_step_attempt；ProductSqliteRepository.joinTaskTransaction 使用当前同连接的受限同步SQL能力。processor.execute→gate.assertWorker→author/assets bytes检查→side-effect前再guard→assembler.prepare→verifier.prove→recordPrepared→finishPrepared，finish同事务推进原job成功、CP waiting_user及event。prepared成功不是workflow completed，更不是commit。

MAIN共享装配提案（待MAIN独占释放，可由BRIDGE Claude实现）：
1. CreationApplication 保留现有创建链，共用 repository/authority/workflow；注入真实 facts 和 trusted adoption 适配。facts不足保持 fail closed，不能把四能力硬编码available。
2. 实例化 gate、task store、verifier、draft processor、worker；store hook 显式委托 gate、workflow.recordStepAttemptInTransaction 和 processor.assertPrepared。循环依赖只能在构造完毕后启用handler/start，缺delegate就报不可用，禁止默认放行。
3. 加 workflowHandlers 时保留 owner 校验，注入经过审核的 task.prepare/job.read/job.cancel；只对确有执行器的 kind 放行。先核生产权限，再reserve，不以202占坑。
4. recoverBeforeGeneric 先原创建恢复，再tasks专属同步恢复；leaseReaperExclusions 合并 creation.pending 与 tasks.leaseReaperExclusions。每次generic tick实时读取，不只启动缓存。
5. Host.listen 当前顺序是领域恢复→history/adoption/coordinator恢复→materialize恢复→outbox/reaper→HTTP listen→application.start。提案保持恢复先于HTTP和claim，确保task exclusions在generic启用前已可读。
6. close 当前先application.close再materialize/native/reaper/server.close/DB.close；HTTP在应用close等待期间仍存在。提案先设置服务端closing准入栅栏（拒新写），停止接收/派发，await task worker.close→processor.close(verifier/root)→assets/native资源→既有Host关闭→DB；已有请求/取消仍须durable settlement，不能五秒detach。不得改坏native closeAfterNative顺序。

## 跨领域逐字段约束（既有类型，除明确提案）

| 数据/producer→consumer | 字段和强约束 | 兼容/错误 |
|---|---|---|
| ProductProjectFacts MAIN→FixedWorkflowService | project_id、exists、project_revision、control_revision、source_digest、snapshot_id来自同一权威读；rights_authorized/reason来自实际本地素材许可闭包；capability_available/fingerprint/reason来自4个实际executor配置，fingerprint为64位小写hex | 缺port/能力失败CAPABILITY_UNAVAILABLE；许可失败IMPACT_STALE；跨project RUN_SCOPE_REQUIRED。未知不得true；异步读后派发仍重核当前事实 |
| TaskPrepare BRIDGE/UI→Host | meta.idempotency_key/correlation_id；project_id；kind assemble_draft/render_snapshot；input_refs每项id/version/sha256精确匹配原run inputs；base_revision/source_digest=current commit；snapshot_id null或current且render必须非null；render_spec assemble必须null/render必须非null | frozen schema拒额外字段；script/storyboard恰2个且不可变；旧base REVISION_CONFLICT，旧输入REVIEW_STALE |
| ExecutionBinding Host核验←客户端引用 | run_id、plan_version=1、step_id、attempt(连续执行attempt)、input_digest、run_scope_digest、authorization_id | 不接受客户端actor/grant布尔值；lease attempt与execution attempt不同，不混用；RUN_PLAN_STALE/RUN_GATE_BLOCKED/RUN_SCOPE_REQUIRED |
| TrustedConfirmation MAIN→PRODUCT | project_id/run_id/review_id(nullable)、input_digest、purpose(run.authorize/review/change.approve)、authenticated_actor/session_ref由真实session、action_digest、issued_at/expires_at（秒） | registerConfirmation在同tx持久；trusted_ui、当前会话、scope/actor/time绑定；测试Grant不能生产注入；driver relay内容决定只content_only |
| Approval MAIN→Coordinator/PRODUCT | confirmation_id/run_scope_digest/plan_version/step_id/attempt/input_digest/change_id/impact_id/base_revision及实际impact/期限 | registerApproval同tx，不可join返回null并拒绝；纯accept无Approval；accept_and_adopt只在展示有效impact后生成限定批准，apply再核锁/base/许可且恰一次消费 |
| TaskReservation Store→worker | job_id/principal_id/request/request_digest/stage_token/accepted/job_kind/max_attempts均持久冻结；stage_token是私有根opaque定位 | policy由Host非客户端；同key同语义返回原Job，异语义IDEMPOTENCY_CONFLICT；同run/step/execution attempt唯一；callback异常整笔回滚 |
| PreparedTaskFact MEDIA processor→Store→未来审阅适配 | format=narralens.created-task-prepared@1，stage_token、source_digest、plan_digest(nullable)、rights_digest、files(relative_path/bytes/sha256)、roots；绑定持久lease_owner/lease_attempt/fact_digest | 不是FrozenDTO、不是公开路径；JSON/token不代替opaque proof；readPrepared校验digest，仅内部入口，当前正式HTTP job.read无法读取此任务 |
| JobReceipt Host→MCP/UI | job_id/project_id/state/attempt/snapshot_id/result_ref/next_actions/execution/bootstrap；目前prepared receipt next_actions=review_prepared_source | succeeded只说明prepare成功；result_ref须真实可解析Ref，不能伪造；不得把prepared source_digest填为committed context |
| EventSnapshot/Context Host→BRIDGE→PRODUCT | context/cursor/oldest_retained_event_id/snapshot_event_id/filter_digest/instance_generation原子读取；Event event_id/project_id/workflow_revision/entity_type/entity_id/entity_version/attempt/state/observed_at/run_id/plan_version/input_digest | 同scope签名cursor、generation/retention/过滤验证；过期重取snapshot，不重提任务；native_sync loaded须真实NativeAck |

Prepared正式读取提案 BR-A-R1：优先复用冻结 JobReceipt.result_ref 与 review.read，不扩80defs：Host从已验证prepared产物发布 immutable review artifact/package，Ref=id/version/sha256可由受控review读取解析，MCP/UI引用同package/Decision。若冻结Artifact/ReviewPart承载不了所需source/rights/plan摘要，则MAIN新增版本化只读prepared DTO/route，而不是塞入Script或将私有PreparedTaskFact直接返回；在MAIN批准schema/registry/错误/范围与consumer前不得实现新API。该提案尚无正式task.read路由，严禁声称已存在。

BR-A-R2：Run cancel与job.cancel必须同库对账，冻结JobCancel执行binding与原reservation匹配；请求取消可进入cancel_requested，worker abort并用原lease callback终结，queued无lease也由专属恢复闭合。Run pause只挡新派发不暗杀在途。lease丢失旧owner不得完成；专属reaper requeue→CP pending，耗尽→job attention/CP failed，取消→两侧cancelled。重开复用original job，不另开任务；prepared重用需当前author/rights新proof。

BR-A-R3：受控adopt与render阶段动作不可混同。clip.prepare可准备样片，review accept不修改source；change.prepare/apply仍受execution guard、impact/approval/locks，Coordinator唯一发布source/revision/active_commit/outbox。render_snapshot只吃committed snapshot并按当前stage允许snapshot.render，不能以sample准备权执行后续chapter/delivery，更不能以prepared替正式render。固定CAPABILITY_SLUG(stage)和gate映射必须由MAIN确认与MEDIA执行kind一致；不为使测试过而放宽门。

## 冻结合同与实际注册

实读schema有80个$defs。MAIN本轮逐字节复核确认80defs/31routes；Frozen31DTO须按冻结31路由的输入输出投影核对，当前源码未发现同名export，不能把31当defs总数。下面仅记录BRIDGE相关17条registry路由子集（非31条全量），registry历史状态不替代CreationApplication装配事实；不得修改Frozen31/80defs来规避生产缺口。合同文档commit f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450；candidateLock 9d1b12f302bb15922e0586c19e39bcddb1b52eab96c80e25b53ad1c0297e0029；版本cp-a0-r4。

| id | HTTP | MCP工具 | 渠道 |
|---|---|---|---|
| task.prepare | `POST /api/agent/v1/projects/:id/tasks` | narralens_task_prepare | authenticated |
| job.read | `GET /api/agent/v1/projects/:id/jobs/:job` | narralens_job_read | authenticated |
| job.cancel | `POST /api/agent/v1/projects/:id/jobs/:job/cancel` | narralens_job_cancel | authenticated |
| change.prepare | `POST /api/agent/v1/projects/:id/changes` | narralens_change_prepare | authenticated |
| change.approve | `POST /api/agent/v1/projects/:id/changes/:impact/approval` | None | trusted_ui |
| change.apply | `POST /api/agent/v1/projects/:id/apply` | narralens_change_apply | authenticated |
| events.snapshot | `GET /api/agent/v1/projects/:id/events-snapshot` | None | authenticated |
| workflow.read | `GET /api/agent/v1/projects/:id/workflow` | narralens_workflow_read | authenticated |
| workflow.run.prepare | `POST /api/agent/v1/projects/:id/runs` | narralens_workflow_run_prepare | authenticated |
| workflow.run.authorize | `POST /api/agent/v1/projects/:id/runs/:run/authorization` | None | trusted_ui |
| workflow.run.read | `GET /api/agent/v1/projects/:id/runs/:run` | narralens_workflow_run_read | authenticated |
| workflow.run.start | `POST /api/agent/v1/projects/:id/runs/:run/start` | narralens_workflow_run_start | authenticated |
| workflow.run.pause | `POST /api/agent/v1/projects/:id/runs/:run/pause` | narralens_workflow_run_pause | authenticated |
| workflow.run.resume | `POST /api/agent/v1/projects/:id/runs/:run/resume` | narralens_workflow_run_resume | authenticated |
| workflow.run.cancel | `POST /api/agent/v1/projects/:id/runs/:run/cancel` | narralens_workflow_run_cancel | authenticated |
| review.read | `GET /api/agent/v1/projects/:id/runs/:run/reviews/:package` | narralens_review_read | authenticated |
| review.decide | `POST /api/agent/v1/projects/:id/runs/:run/reviews/:package/decision` | None | trusted_ui |

## 现场输入 SHA256

以下为本轮只读观察字节；任务释放前必须与MAIN归档/dirty逐项核对，hash变化停止接手，不覆盖。

| MAIN相对路径 | SHA256 |
|---|---|
| `src/host/agent-driven/creation-application.ts` | `20247ab174bc36bfc506a49126b80aa0ec784478f498f84b16121ad9581192f9` |
| `src/host/agent-driven/application-dispatcher.ts` | `25a772d8d0f9b00bf985be6b13cf09a7d27234221d5f86935407d1205e20d9d0` |
| `src/host/creative/fixed-workflow-service.ts` | `affb339613036d4b7a6572d63247f53754725a98488ae671c76b7317995aaf7e` |
| `src/host/agent-driven/created-task-store.ts` | `d7a4734cc9ed5924b7088a4cfaebecdd2ff202c373a9621c21078908f10e7b14` |
| `src/host/agent-driven/created-task-gate.ts` | `1a65d8f3e9950847decdea2478a2d8542bb33d5018119282c18144c2694a8860` |
| `src/host/agent-driven/created-task-worker.ts` | `41a7658520d68a90be976690a9c27311f4be47a4a58776686e950ce3a563d4c4` |
| `src/host/agent-driven/created-draft-processor.ts` | `6727b0b64bc07cfdea0346e7f885d0ffcbd74832a66f939056735c66872eeef5` |
| `src/host/agent-driven/prepared-draft-verifier.ts` | `ffefbd4169dfd07930723e2606997845fc1bc4a1aa9d0f6b60b7bfd6eb5276db` |
| `src/host/agent-driven/local-asset-registry.ts` | `84ce639583427de6adfbf4dab892b9a77fd888de1c5f005d824d22bc3aca2e92` |
| `src/host/server.ts` | `f1b9029158730bd24967361f4cd677b1d37c8c9474c1b0af7049e9ca5dd5025d` |
| `src/host/creative/product-facts.ts` | `de93e00c5478c17a20af4bb2ed1dafd654faa794b4b28d61e65a866df7913a64` |
| `src/host/creative/product-repository.ts` | `f071a02f1ed691e70a7f7cc774c6f4b5948c088e4a8411491fb51adb7affc3b7` |
| `src/host/agent-driven/capability-fingerprint.ts` | `d961a777040cb3c8d99b421b920e9cf229409c3b246a4a79f683048c8d95e8a2` |
| `src/host/agent-driven/observation-cursor-ports.ts` | `c568746a71723881a54b1d513434a93a56ee25f091e351710d4c2c834d7af549` |
| `src/host/agent-driven/project-context-service.ts` | `56f55e16646b7e3cb5847719251defd8f58f4da055611e958240727822433687` |
| `src/host/engine/source-digest-v1.ts` | `d32dfc433865865749efd5e5f44f00eceff27b93d7607603c5eb9233708c599d` |
| `src/host/render/native-draft-assembler.ts` | `1b8a6bc403053091e74a3357815b35fddc3d9fb71aa5e8448782f66feb58877e` |
| `package.json` | `edace26fdfa5a9808f2706fe15ab3935d0512d08f765d4cffec268eb7e783263` |
| `contracts/agent-driven-a.schema.json` | `088a451e9646199618261a6cc95a84e3767dbf4cc87004f3e5995dda86b60964` |
| `contracts/agent-driven-a.registry.json` | `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f` |
| `src/contracts/agent-driven-types.ts` | `54356697802c0bf048e5cbcde1f54eb33713d4fe58943b346406804011cb3644` |
| `src/contracts/agent-driven-validator.ts` | `f11a68bad982b7914e73f396ce48e99195ffc8fa88e842f137ffabf31900ea73` |

canonical本轮 baseline-observed.json SHA256 `f31f82d57a3eb2df6608b6fc47ffab68124ca8bb1e0d038c0c231838bd19e38a`；contract-freeze.json SHA256 `532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`。

## MAIN 本轮审查补充（msg_0829f8502091）

prepareRun依赖四能力全链生产可用：MEDIA真实render→QC→delivery与clip.prepare均完成manifest/配置与可用性验证，才可令ProductFactPort.capability_available=true；BRIDGE装配及故障测试可先实现，但仅clip.prepare可用时Run仍拒绝，不能为了走通样片伪造四能力。capabilityFingerprint仅计算完整描述摘要，不是运行就绪证明。

prepared→adopt新增备选提案 BR-A-R4：保留现有materialization_id wire入口，建立独立不可变prepared-source映射，记录project/job/原execution binding/prepared fact digest/source digest/plan digest/rights digest及Host私有stage定位；禁止虚构M3 materialization行或假迁移。MAIN裁决命名、DDL、版本、读取/授权和existing adoption consumer扩展，MEDIA负责source证明，PRODUCT消费impact，BRIDGE只映射已批准端口。此提案与R1分别解决采用/可读审阅，不能把proposal当生产API。

额外实读缺口：ProjectContextService.active_jobs只支持创建Job，遇到任务Job会CAPABILITY_UNAVAILABLE；context.capabilities当前为空，native port未注入。共享装配票必须把receipt resolver同时接给job.read与context，不然MCP task成功后context立刻失败。TrustedApprovalInput还需control_revision/action_digest/facts_digest/expires_at，均来自当前impact与Host权威；秒级持久时间转wire ISO，不能混毫秒。PreparedDraftVerifier已含FD/祖先目录/bytes/hash与固定上游解析证明实现，最终是否闭环仍待绑定后的真实验收。

## BR-A-R5：waiting_user采用循环，必须MAIN裁决后释放REVIEW

已实读execution-guard.ts：action仅允许Run ready/running、attempt pending/running；sample/first_chapter允许change.prepare/apply，delivery不允许change动作。processor.finishPrepared把attempt置waiting_user；publishReviewPackage把Run置waiting_user。decideReview接受后Run可回running，但代码不同时把原prepared attempt改回pending/running。因此“先prepare草稿→等审阅→直接change.prepare→apply”在现有guard下不合法；单纯UI按钮接线不能解决，Run恢复running也不足以解锁原attempt。

可行设计提案R5（不是既有实现）：保留普通dispatch guard完全不放宽，增加专门的受控采用事实检查分支（内部语义能力，名称由MAIN定），只允许已完成prepare且当前waiting_user产物对应的change.prepare生成无source写的impact；核project/run/plan/step/execution attempt、job succeeded、immutable prepared/source映射、当前input/scope/grant、前序stage gates、owner及base/control/selection/rights/bytes。当前stage自己的内容门可以仍pending，因为它正待用户审阅；其他前序门不可豁免。impact产生前后均不把Run/attempt伪改running，也不dispatch任何媒体。

然后将绑定impact的包展示给真实UI，一次accept_and_adopt同tx写Decision+limited Approval；apply采用专用检查重核同package已accepted、对应Approval活跃、完整action/facts摘要与Coordinator三类锁，恰一次提交并消费，之后才记录采用Gate/CP。其他包pending、pause、cancel、撤权、旧attempt/base/impact仍按精确策略拒绝；不得通过把waiting_user添加到A_DISPATCHABLE_RUN_STATES/ATTEMPT_STATES对所有action放行。技术QC Gate只由MEDIA真实QC回执推进，adoption Gate只由Coordinator实际commit回执推进，不能由review accept预写。

备选“在publish前先做impact”只有processor仍running时才可能，但需要在真实prepared proof和commit base固定的边界组合，并且apply时attempt仍waiting_user问题尚未解决，故不能当免合同裁决捷径。R5需要MAIN批准内部authority/同步事务接口、恢复语义、暂停策略与逐action负例；当前REVIEW票明确BLOCKED_FOR_CONTRACT，不阻止ENTRY和受限HOST只读/故障装配开发。MAIN消息msg_54db6cb4056d及02/05草案已对齐。

## MAIN拟定接缝安全复核（msg_3ce30c95b625；仍待最终裁决）

原则一致：保持80defs/31routes字节；internal prepared-source@1以ps_命名空间映射真实不可变prepared闭包，非M3假行；预览完成形成真实ReviewPackage，JobReceipt.result_ref=该包Ref，Agent以execution.run_id+ref.id调用review.read。result_ref的version/sha256必须与返回的package版本及其冻结摘要一致，不能只按id读取“最新版”；读取入口若没有expected version参数，consumer收到不同Ref摘要必须报stale而不能当原结果。package publication与job receipt可见性必须原子或有显式未就绪状态，绝不能succeeded携带悬空Ref。

同一execution-guard模块内增窄internal effect可避免分裂授权权威，但必须是Host可构造的受信事实能力，不能从HTTP DTO直传effect字符串/任意facts。prepare_review_impact只登记影响，不改author、不开媒体job、不消费Approval；apply_review_adoption必须真实UI同包accepted且有限Approval当前有效，两者都重核owner/project/run/plan/step/execution attempt、Job succeeded、prepared fact/source映射hash、current grant/rights/live bytes、base/control/selection及前序stage gates。对Run paused/cancelled/reconciling明确拒绝；允许waiting_user仅针对此包，不能绕其他相关risk门。正在同scope重算/取消/新revision时旧impact失效，普通action的dispatchable集合不变。

正式render_snapshot只chapters/cover符合既有stage action表；delivery的qc.inspect/delivery.package由Host授权确定执行器调度，仍绑定原job/lease/step/execution/input并以同步事务回执推进，不扩TaskPrepare.kind、不伪装snapshot.render。需要明确delivery一个step内QC→package子动作的持久去重键/子阶段事实及原Job可恢复回执，不能用同step唯一约束冲突后创建无绑定第二队列；QC通过才可package，未知QC/迟到结果不得ready。

反例清单：ps_跨项目/映射至M3或任意路径；同ps_改闭包；同包id新version却消费旧result_ref；preview未完成已有可见ReviewPackage；旧lease晚回调换result_ref；普通task指定internal effect绕门；pure accept冒用Approval；审批后改rights或source bytes；Run pause/cancel后内部采用；sample impact用于chapters；另一个risk pending借waiting_user例外采用；QC失败仍package；delivery重复恢复生成第二job或重复发布。每项必须拒绝且source/revision/active_commit不变，唯一正常采用恰一次revision+1，正常package只一次ready。

## BR-A-R6：本地素材登记和只读发现（MAIN拟锁，msg_9d4d963b56ab）

现有LocalAssetRegistry.import/list尚无生产UI/MCP入口。拟由可信UI从Host预配置sourceRoot选择相对文件，声明license/origin，Host走既有import；Agent只读附属asset inventory resource/HTTP，不开放写许可工具。Rights Ref严格为{id:asset.rights_ref,version:1,sha256:asset.registration_digest}，Host查询同project真实row并核登记与当前bytes，不把Ref字形当许可。原80defs/31routes不变；附属transport需独立规范、鉴权/字段/分页/错误/注册与producer-consumer测试，不得偷偷加到Frozen registry。

职责：PRODUCT可信UI选择/声明；MEDIA既有registry导入/probe/许可及字节证明；BRIDGE只读附属HTTP/MCP resource接线、scope校验、脱敏清单与Ref映射；MAIN独占sourceRoot配置、transport批准和Host装配。返回不得泄露绝对路径、密钥、stage根，不允许客户端指定任意root；current session/project owner过滤，未知登记不可listed为authorized。Read-only inventory不得触发import/probe写入/服务启动。

反例：Agent写license/origin；相对路径../、绝对路径、symlink逃逸sourceRoot；跨project rights_ref；version非1/sha不等registration_digest；同ID旧登记/bytes被替换；缺许可仍capability true；只读inventory触发副作用；未授权主体枚举项目/路径。各例拒绝且登记/素材/author均不改变，跨owner按既有NOT_FOUND/鉴权策略避免泄漏。

## Claude反馈闭环及D-01..D-07领域ACK（2026-11-11）

Claude只读任务已succeeded，readiness结论NEEDS_REVISION（文档输入可接手、公共接缝未最终冻结）。22/22输入hash、25/25 dirty hash吻合；自报MiniMax-M3.1-Flash-Preview[1m]，MiniMax匹配TRUE，仅会话自报不是额外供应商验证。报告保留原文，不由Codex改写。

事实修订：生产ProductFactPort/TrustedAdoptionAuthority无实现，不能描述为仅差注入；change.prepare/approve/apply三冻结路由无producer，需实现整个应用适配而非只spread handler。旧closure和verifier候选manifest未绑定当前overlay：verifier manifest 380b235f前缀与当前ffefbd41不同，当前视为待审。Claude F-03称REVIEW.md无显式PASS有误：本Codex实读该文件追加Closure review明确“PASS — BLOCKER 0 / MAJOR 0 / MINOR 0”；但其输入hash已旧，因此绝不覆盖当前字节。F-13所谓“internal不经HTTP与冻结路由不兼容”也需澄清：禁止的是客户端提供effect/proof，不禁止HTTP handler在服务端构造受信effect，两者可以兼容，仍需MAIN明确生产调用者。

装配覆盖：31routes中最多15个有已提供handler（instance/health以options注入为前提），16个缺producer接线：task.prepare、job.cancel、change.prepare/approve/apply、events.snapshot、editor.native.ack、delivery.read、workflow.run.prepare/authorize/start/pause/resume/cancel、review.read/decide。旧registry.state是冻结候选撰写时注记，实施授权读取contract-freeze/实际ReleaseAssignment；不改任一冻结字节，MAIN最终记录此读法。

| MAIN候选 | BRIDGE审查结论 | 实施必须明确的精确点 |
|---|---|---|
| D-01 | ACK；替代R6尚未命名的transport选择 | BRIDGE编制asset-inventory@1附属规范（建议MAIN管理`docs/execution/A/architecture/ADR-A02-asset-inventory-v1.md`，本轮不在该区写），资源单独allowlist，冻结resources字节不动；cursor绑定owner/project/filter/排序，重登记并发时禁止漏项伪全量，新增字段即拒 |
| D-02 | ACK；采用ps_映射替代R4开放备选 | 完整digest碰撞校验、same-job唯一、只读proof真实来源均必要；schema升级/旧库迁移由MAIN唯一core writer，BRIDGE实施候选在精确释放后写；stage roots不落公开DTO |
| D-03 | ACK；采用真实ReviewPackage Ref，撤回新增公开prepared DTO备选 | null result_ref可配已成功prepare但review尚未就绪的next_actions，不能将此称完整审阅完成；消费者必须比对Ref.version/sha而不是只读同ID最新版 |
| D-04 | ACK窄Host-only effect与单事务，普通action集合不变 | 推荐沿冻结change.prepare/apply handler由Host选effect、引用原waiting_user execution，UI review.decide为该包唯一采用Approval来源；change.approve不得为同包再造第二批准。此wire选择须MAIN明确采纳；impact构造及target_snapshot_id语义见下 |
| D-05 | ACK分段执行器、committed-only及producer/publication分绑 | BRIDGE持久编排/lease端口，MEDIA阶段执行器/bytes证明；qc.inspect→package的唯一动作键建议(project,run,plan,step,execution_attempt,action,input_digest)，同原job恢复，另存producer receipt不覆盖lease历史。必须MAIN冻结内部端口/DDL/动作键，不能让执行者猜 |
| D-06 | ACK观测与expected独立 | BRIDGE只投影可信NativeAck，不自行编造/补值；PRODUCT生产者未接通时unknown，不把ack记录存在等同当前会话loaded |
| D-07 | ACK共同可复现基线与唯一core writer | 旧lane保留。未来release完整共同SHA由MAIN实际冻结后填，不把本轮838ba5+dirty自动当写入许可 |

D-04剩余具体建议（待MAIN签定，不让实现者自行二选一）：BRIDGE共享core writer新增prepared change应用服务，复用原Coordinator/impact策略，construct impact时取当前activeCommit.base/source、controlRevision、可信selection_version与verified prepared plan/rights；target_snapshot_id是Host预留且绑定impact的未来snapshot身份，仅在Coordinator实际发布后成为可读committed snapshot，准备时不能伪建ready snapshot。plan_sha256来自完整动作/选区/基线/准备闭包/目标snapshot/许可摘要的规范hash；expires_at服从现有impact TTL策略，prepare/approve/apply都重核，输入改变即stale。MAIN需确定是否复用现有snapshot分配器及与legacy M4B兼容；未确定前REVIEW仍BLOCKED_FOR_CONTRACT。

D-01..07原则均ACK，待MAIN最后闭环仅三类：D04 handler归属/唯一批准和impact target snapshot分配语义；D05持久端口/动作去重与精确DDL；共同SHA/逐文件白名单及依赖环境。以上不阻止先释放ENTRY与fail-closed HOST、后续轻量恢复票，不自动开放Run。

## D08–D12定向修订（取代前文待定选择）

D08 ACK：冻结change.prepare/apply→CreatedSourceChangeService→Host构造受信effect；HTTP不接收effect/facts/proof。review.decide与change.approve同包/impact/plan唯一批准，Host自动apply与Agent重试共享幂等消费权威。旧“二选一wire待定”已关闭，不再交实施者选择。
D09 ACK：Change由CreatedSourceChangeService构造，target_snapshot_id=snapshotIdFor(project,prepared_source_digest)仅预期ID，采用前无snapshot/active_commit行；15分钟固定TTL，重放不续期。完整域分离preimage和原impact状态权威/附属不可变fact按MAIN D09；撤回先前“另选ID分配器”开放建议。
D10 ACK：created_source采用走Coordinator原project_transaction、RevisionStore新typed commitPreparedCreatedSource；不得填假migration_id调用commitAdoption。完整闭包fsync/backup/rename及专项恢复先generic，审批消费/source_fact/snapshot/revision/job-step/outbox同事务；原created origin不变。
D11 ACK：BRIDGE FixedPhaseExecutor负责delivery单Job/lease，去重键(project_id,run_id,plan_version,step_id,execution_attempt,producer_render_receipt_digest)；MEDIA纯阶段端口，QC/publish事实不可变无第二state，当前QC/包字节对账后恢复，不重新encode假恢复。使用MAIN给定两个新增integration文件，明确尚不存在/未运行。
D12 ACK：冻结registry.state为历史注记；附属asset-inventory@1公开新增4HTTP+1resource，不可声称总协议未扩大，原31及80defs字节不变。R0必须重审当前overlay；历史closure追加显式PASS仅其旧hash，当前verifier manifest已旧。工具链以目标worktree corepack pnpm --version核，不安装。

附属合同定向发现供MAIN修订：rights_ref.version schema允许任意>=1而registry精确1，应改const:1；顶层anyOf仅Inventory/SourceFileListing/RegistrationRequest，POST响应InventoryItem必须按#/$defs/InventoryItem单独编译/校验（建议registry给明确ref，不能拿顶层校验响应）。03_OWNERSHIP_AND_DEPENDENCIES.json当前读取ENOENT，owner方向已定但具体名单需MAIN实际落盘，不据引用宣称存在。其余D08–D12未发现需改变总体方案的反例，等Claude定向复核后收敛。

本次读取contracts/asset-inventory-v1.schema.json SHA256 `64bb24e9f4e67bfadf75ca484b50a397c591d99aaf4bdfbfa2a7b6c5974ae6c0`。

本次读取contracts/asset-inventory-v1.registry.json SHA256 `c01590441d06e25f40695e9119bbcc3ddc95d6a3427bc0cc895deabed4099a8d`。

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
