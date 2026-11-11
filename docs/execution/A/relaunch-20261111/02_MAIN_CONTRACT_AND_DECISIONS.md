# MAIN 公共合同与集成约束（审定设计）

状态：MAIN_REVIEWED_DESIGN；本轮设计准入，不是实现release。源码摘要见source-map.json，历史CP-A0 manifest不改。以下既有不变量立即适用；新增接缝已由MAIN在D01–D15集中裁决，领域反馈及收口见06_MAIN_REVIEW_AND_START_GATE.md。

## 0层与1层事实

0层：外部驱动Agent经Skill/MCP调用同一Host；UI经HTTP/SSE消费同一应用事实；单RevisionStore连接及Coordinator控制工程提交；OpenFilm原生UI与默认渲染，Hypit旧路径保留。开发Agent层级不变成产品的多个Host。

1层实际实体：CreationApplication已装配创建/创作读写/有限任务读与原生入口；FixedWorkflowService存在完整固定模板但生产未注入ProductFactPort/TrustedAdoptionAuthority，未注册大部分变更路由；CreatedTaskGate/Store/Worker存在，CreatedDraftTaskProcessor/PreparedDraftVerifier为未提交真实候选，尚未生产装配；ProjectContextService只认创建job，native端口未注入；ProjectCoordinator与SnapshotStore/ProjectCreationStore/CommittedSnapshotAuthority已有提交基础；SnapshotRenderService原生渲染/QC/打包模块仍缺本轮生产持久端口接线。

以上只读事实不等于本轮运行复验；真实short-film/可信人类授权/NativeAck/两次正式交付仍须开发后证明。

## 永久锁定的公共边界

|ID|约束|生产/消费及验证责任|
|---|---|---|
|MC-01|冻结80defs/31routes/schema/TS/validator保持一致；未知生产者继续503；不得删门或放宽合同假接线|MAIN管理，BRIDGE协议消费，三领域合同测试|
|MC-02|单连接、单job/lease/attempt权威、单project_transaction状态机；immutable准备事实不是第二提交状态机|MAIN管理，BRIDGE共享核心实施；MEDIA只经port写事实|
|MC-03|每个Run四项真实能力的实现/配置摘要齐全且可执行才available；文件存在/纯桩不算|MEDIA提供真实实现manifest，BRIDGE装配并校验，MAIN审定fingerprint|
|MC-04|rights_refs只是引用；Host验证归属、许可、登记事实和当前bytes；Agent内容确认不授予执行权|MAIN许可合同，MEDIA验证，PRODUCT展现，BRIDGE执行守卫|
|MC-05|trusted_ui的认证会话产生限定确认/批准；Agent relay仅content_only；同事务绑定grant/decision/approval|MAIN授权模型，BRIDGE实现持久接缝，PRODUCT提供可信UI|
|MC-06|准备任务不写author/revision/pointer；本地文件访问由Host根和FD proof控制，不信任客户端绝对路径|MEDIA准备/证明，BRIDGE生产装配和资源关闭|
|MC-07|prepare、step、job、lease、取消、重试共用权威并原子收敛；listen专用恢复先于generic reaper，动态排除其job|BRIDGE实施，MEDIA遵守lease/cancel，MAIN故障矩阵|
|MC-08|采用必须server impact/hash、current base/source/control/selection、三类锁/许可/可信批准、幂等；一次revision+1|MAIN管理Coordinator，BRIDGE独占共享写，MEDIA只stage/validate|
|MC-09|Preview不是正式Delivery，prepared不是committed；正式导出只消费可证committed snapshot|MEDIA媒体端口，BRIDGE持久提交/读取端口，PRODUCT清晰区分|
|MC-10|Job完成、commit完成、NativeAck独立；Host expected与实际原生加载观测独立，不能把Host值抄作Ack|PRODUCT原生观察，MAIN校验scope/generation/身份，BRIDGE只投影|
|MC-11|同一Studio/React根/selection/clock，不另建聊天页/编排器/第二timeline；R4条与非模态系统面板增量挂载|PRODUCT实现；MAIN审核旧入口修改和native pin|
|MC-12|事件读取无业务写，快照/游标同水位，断线/重复/旧attempt/TTL诚实；不可缓存绿灯或显示模拟进度|BRIDGE事件与health，PRODUCT消费|
|MC-13|取消晚到/失lease不自动采用或ready；恢复旧内容产生新revision；ready与权威回执/事件原子发布|BRIDGE持久核心，MEDIAfence，MAIN恢复验收|
|MC-14|全重型门全机单槽；实际headless，失败/未知/未运行保留；模块自测不等于阶段或人验PASS|各领域自验证，MAIN组合审查、未参与者独立复核、人类签署|

## 已由D01–D15裁决的问题目录（保留追踪）

1. 许可与LocalAsset登记引用如何被Agent发现、Ref namespace/摘要如何验证；不得让测试fixture形态成为隐式生产协议。
2. prepared-source到materialization_id的合法不可变映射，或显式新版本合同；禁止伪造M3 materialization/migration。
3. 审阅waiting_user与change.prepare/apply、样片/首章/章节/封面/交付的动作门，技术QC/采用Gate由谁写入；不得绕过执行守卫，也不得出现需要先正式提交才允许审阅的循环。
4. 四真实能力完成前Run不可用；允许后台并行实现独立生产者，禁止提前宣称available。
5. UI observed与Host expected使用候选013/015的具体字段、版本、生命周期和不支持状态。

## 兼容、停止与回退

保留旧Hypit/迁移入口与历史Gate。新增内部事实/表也需同库DDL迁移、旧库重开、逐字段校验；新增wire必须显式ADR/版本及producer-consumer测试，不原地改历史冻结记录。首个实现release须绑定实际共同base+overlay摘要，不能把老lane当最新基线。关闭新增路由/worker/mount可止新调用，保留已提交快照与证据；内容回退只走受控新revision。

上述问题的明确方案、唯一writer和验收case现见D01–D15、03所有权及05组合门；原CLAUDE_READINESS的初轮阻塞保留，实际闭环以06为准。

## MAIN 接缝裁决 D-01..D-07（D13–D15已将精确语义统一）

### D-01：真实本地素材输入与Agent发现

新增的是独立附属transport规范，不改原CP-A0四冻结文件/31路由的字节或把现有ArtifactContent扩成任意JSON。可信UI显示Host已配置sourceRoot中的受控相对文件选择，只接受当前registry支持的视频/音频；source/许可/recording_origin由真实用户确认，登记沿用LocalAssetRegistry.import，当前Brief可在项目创建后引用新资产并形成新内容闭包。拒绝绝对路径、symlink、未授权根、Agent伪造人类声明。

拟定UI入口（均需当前trusted_ui、owner与Origin）：GET /api/ui/v1/projects/:id/local-source-files（仅受控根的安全候选/相对显示名，有限分页）；POST /api/ui/v1/projects/:id/local-assets（既有LocalAssetInput精确字段；路径身份和bytes由Host验证，不能信expected_sha）；GET /api/ui/v1/projects/:id/local-assets（只读已登记库存）。SOURCE入口只读、受限条数/遍历预算，不递归扫描J盘、不打开未知媒体、不任意浏览本机。

给Agent只读附属resource narralens://projects/{id}/local-assets，HTTP GET /api/ui/v1/projects/:id/asset-inventory 的鉴权允许owner-scoped driver read，不能登记/修改许可。单独asset-inventory@1协议声明及读取测试由BRIDGE负责，原31工具不改；MCP resource注册显式受附属白名单约束。库存项固定：asset_id、sha256、bytes、registration_digest、media(LocalMediaFacts)、rights_ref(Ref)、source_label、license(AssetLicense)、recording_origin；无blob_token/absolute_path/operator session。rights_ref精确{id:真实rights_ref,version:1,sha256:registration_digest}，权限验证必须查真实同project row+当前bytes+许可，Ref相符本身不授信。默认分页limit32、最大64，按asset_id排序的owner/project/filter绑定cursor，读取不编码、不登记、不改revision。未知许可/读取失败不给rights_authorized=true。

### D-02：合法prepared-source命名空间

保留PrepareChange/Change的wire形状，新增明确的内部语义合同prepared-source@1；materialization_id允许引用两种真实类型，由Host分派：旧M3 proxy/segment物料，以及本轮真实原生源准备事实。后者不能调用旧M3 GET冒充其结果，也不能伪造materialization/migration行；这是显式扩展的引用命名空间，不声称旧生产消费者已支持。

拟新增同库不可变映射created_prepared_source：project_id+materialization_id主键、job_id绑定真实created_task_prepared、request_digest、prepared_fact_digest、execution完整绑定、base_revision/base_source_digest、prepared_source_digest、plan_digest、rights_digest、frame_count、fps_numerator/fps_denominator、descriptor_digest。没有state列，不建立新Job或提交状态机。materialization_id='ps_'+SHA256(canonical{project_id,job_id,request_digest,prepared_fact_digest})前60hex，完整digest另存用于碰撞拒绝；同job/事实只能一个映射。plan_digest必须非null；字段与原PreparedTaskFact/真实parser/probe逐项一致。插入及映射指向的prepared fact持久化同事务或从已持久事实做幂等补登记；失败不移动工程指针。

Host私有stage定位仅从原job与prepared lease_attempt取得，未验证不可向adoption交付文件。新resolver返回discriminated内部对象source_kind=m3_segment_plan|assembled_native_source，各自校验原权威；找不到/跨owner404，歧义或摘要冲突拒绝，不按前缀猜内容。后者再次复验当前author/资产/许可、完整prepared闭包、固定上游、plan/source摘要与opaque proof；复验失败不创建可用impact。

### D-03：无需公开stage的新审阅结果

JobReceipt.result_ref在真实ReviewPackage发布后才指其不可变package Ref，execution.run_id+ref.id足够调用现有review.read；未发布保持null和真实next_actions。包使用现有publishReviewPackage生产者，parts五项必须是真实preview/旁白/字幕/镜头概述/许可质量的受控引用。Host内部管理这些ref的明确namespace与hash，不经ArtifactPut把它们伪装成Script/Storyboard。下载链接是鉴权只读opaque ref，无stage路径；preview不是Delivery，禁止用SnapshotReadPort接受prepared source。

Host可在已有run scope的change.prepare授权内先生成真实impact，再把它纳入包，用户看到的是确切本次影响。纯accept不生成采用批准；accept_and_adopt一次可信交互记录限定Approval，不再让用户复制ID或重复批准。准备/预览时author、active_commit、revision都不变。

### D-04：等审状态的窄操作与共同守卫

保留普通action的ready/running与pending/running规则、原A_STAGE_ACTIONS和safe_control语义。不得把所有waiting_user加入可派发集合，也不得把已成功prepare Job/等待审阅的step伪改成running以通关。

在同一execution-guard模块设计两种Host-only受限effect：review_impact_prepare与approved_prepared_adoption。两者均重验owner/当前Run+plan=1/输入闭包/scope/真实有效grant/前置Gate/指定stage允许change action/当前source与许可，不接受客户端布尔或JSON proof。前者只允许同step当前waiting_user、真实succeeded SOURCE_ONLY job及不可变prepared proof匹配，效果仅impact/审阅准备。后者额外要求同包版本/input/output/quality的真实可信accept_and_adopt决定、active且未过期的限定Approval及impact、完整binding和prepared事实；即使review推进过观察checkpoint，也不得复用别的step/attempt，paused/cancelled/failed/blocked Run拒绝。使用同连接事务能力与只在Host构造的proof，普通action路径不受此例外影响。

采用未完成时，checkpoint不得宣称影片已采用，后续依赖该采用的写/导出必须查真实approval/prepared_authorization/project_transaction；不另存“采用完成”布尔作为权威。apply重试沿原idempotency回应，不重复+1。commit时用同一BEGIN IMMEDIATE重验并消费approval/impact，保存snapshot、CreatedSourceFact、pointer、revision+1、job/step完成证据及outbox/幂等；通过现有RevisionStore/Coordinator扩展，不能在方法前后各开一笔事务。现有纯审阅accept路径和legacy M4B行为保持回归。

### D-05：原生渲染与正式交付按权限分段

snapshot.render只在原允许chapters/cover阶段处理已committed snapshot。复用现有native renderer/QC/package函数，将“编码/技术QC的不可变结果”与“正式发布Delivery”分段，不能原样调用一口气commitReady的facade越过cover/QC门。旧SnapshotRenderService.render facade对原诊断/模块调用保持兼容，新生产装配只用阶段化端口并分别执行共同守卫。

拟定CommittedRenderReceiptV1持久事实（同库cp_a0_render_attempt及原产物receipt，不新状态机）：project_id/job_id/producer_execution/snapshot_id/source_digest/render_spec/config_digest/attempt、媒体及ffprobe/full_decode/必需sidecar的Ref/bytes/hash、QC结果、私有package准备引用。只接受与CommittedSnapshotAuthority一致的闭包、真实完整decode及许可；未正式发布不产生ready Delivery/download。

cover在A仅需明确选择的真实封面/帧预览，不声称B的4封面/8标题生成。delivery阶段由Host固定阶段执行器在已有有效scope内调度qc.inspect，记录技术证据与pending QC门；人类通过原review.decide接受真实质量包后，才派发delivery.package（D15精确定义）。内部工作复用原Job/lease/step_attempt与幂等权威，payload是已固定plan动作/receipt输入；不暗扩TaskPrepare.kind，不将delivery步骤伪装snapshot.render。授权过期/暂停/未知副作用按原Gate停止，资源不足waiting_resource；只有真实consumer就绪才注册能力。

publish重用同snapshot/config的已证编码产物，package no-replace+目录fsync，正式ready/receipt/manifest/outbox原子登记；恢复比较真实receipt/包字节，不再编码冒充恢复。producer attempt与后续publication execution分别保存核对，不把新lease attempt覆盖媒体产物来源。T20-A..H保留原冻结含义。

### D-06：NativeAck分层

013观察模块与015独立expected算法先按各自固定hash在隔离副本构建，不改固定vendor。settings/markers的015 computed不证明全工程，film/source闭包、captions/style、实际dirty/失败/unsupported、原生clip映射分别核查。Host最终同时核owner/session/generation/view/document_epoch/单调hydration_epoch/commit/revision/source/selection。任何缺项unknown/pending或具体失败，不扩native_sync枚举、不抄Host版本为observed。

### D-07：实施基线与集成所有权

现有MAIN dirty为已保全输入，不重写；第一实施动作必须校验838ba5f2c8500f0103f56dbe51264ea9f70086fc+baseline overlay哈希。由MAIN管理的唯一core writer完成候选检视/必要复验和显式路径冻结，得到共同可复现commit后，再通过Orca建立/调整实际实施checkout，研究lane原分支与310项未提交候选保留。不能把三旧lane直接并行cherry-pick到不含最新MAIN代码的基线上。

本轮先锁责任和准备文档，未来release记录填入现场生成的完整共同commit SHA、合同摘要及精确文件清单后才实施；共同commit值不能提前编造。此为机械开工前置，不把领域实现变成每小模块找用户批准。

## Claude只读反馈后的具体化 D-08..D-12

### D-08：wire入口、批准唯一性和服务归属

“Host-only effect”表示客户端不能直接提交effect种类/facts/proof，不表示服务不能被HTTP/MCP调用。采用第三种明确接线：原change.prepare→新CreatedSourceChangeService.prepare；原change.apply→该服务apply；两者先由原router验证冻结DTO/身份/owner，然后服务从真实行和私有proof构造窄effect。同一prepare方法也供Host审阅包producer调用。原31路由都按此接线，无需把它们永久503、无需让HTTP携带internal effect。legacy migrated materialization明确派发原M4A/M4B分支，不把其旧producer重写。

原review.decide仍是工作台一次确认并采用的主入口，沿原FixedWorkflowService.decideReview与同事务TrustedAdoptionAuthority生成决定及限定Approval。Host在该调用事务结束后，经完全相同的apply服务自动尝试已授权采用；Agent也可对同impact/approval调用change.apply，两者同原idempotency/impact消费权威，不能各+1。review.decide响应仍是原ReviewDecision，UI随后读Context/Workflow显示“决定已登记，采用待完成”，不把响应改成Applied或代替NativeAck。

原change.approve是同一批准权威的兼容适配：approve只能解析该impact绑定的唯一当前审阅包，以该不可变包事实构造同一次trusted_ui accept_and_adopt决定，复用同一TrustedAdoptionAuthority与持久去重；已有同subject/impact/plan的合法决定/批准则回原结果，不能签第二个独立批准。reject仅拒绝/撤销本次impact的未消费批准并记真实可信决定。跨subject/不同scope/包不当前拒绝，不能凭Boolean绕过包。审批本身不写影片；之后沿同一apply路径。默认UI不再展示第二次批准按钮。

拟新增实体（不是现有实现）：created-run-facts.ts、created-run-authority.ts、created-source-change-service.ts、created-source-impact-store.ts、created-source-adoption-store.ts、created-source-adoption-service.ts、fixed-phase-executor.ts。均由BRIDGE Claude作为MAIN指定共享core唯一writer实施；普通UI由PRODUCT，媒体准备/阶段化模块由MEDIA。原execution-guard.ts、fixed-workflow-service.ts、product-repository.ts、RevisionStore与Host精确名单在03_OWNERSHIP_AND_DEPENDENCIES.json集中释放，不再以“待定owner”下发。

### D-09：prepared Change各字段的真实来源

CreatedSourceChangeService是Change构造者，MEDIA只提供可验证准备闭包，PRODUCT不构造授权事实。服务在项目串行队列内：owner→idempotency→真实current active_commit/base/control/selection→prepared映射与当前文件/许可→native完整性/消费者图/三类锁→再次核对世界→同DB写impact及原idempotent response。

Change.project_id取真实owner项目；materialization_id取D02真实ps_映射；base_revision/source_digest取当前committed base，与请求逐项比较；control_revision取RevisionStore当前控制版本；selection_version取Host权威selection事实（全项目采用可用真实持久初始0，无选区不是伪造选镜）。target_snapshot_id使用已有snapshotIdFor(project_id, prepared_source_digest)内容寻址函数，**只是可验证的预期ID**，采用前不插snapshot/active_commit行，不宣称committed；publish后验证ID完全相等。

plan_sha256是域分离的PreparedAdoptionPlanV1完整授权计划摘要，不只hash film.html。preimage包含version/source_kind/project/base_revision/base_source_digest/control_revision/selection_version、materialization_id/prepared_fact_digest/request_digest/producer execution、target_source_digest/target_snapshot_id、完整roots/files/资产许可及消费者摘要、原生计划摘要、帧数/有理fps、affected ranges与三类锁scope、固定upstream和expires_at；字段ASCII、safe integer/规范小写hash，数组显式排序，沿CP受限canonical规则。frame ranges用整数帧，不把native浮点塞进CP canonical。locks_checked与消费者图真实构造，未知图fail closed。批准facts_digest沿同一preimage计算，不重复不同摘要集合。

impact初始active，TTL固定15分钟，now>=expires_at拒绝；同key重放原expires_at不续期，已consumed返回原消费事实/重放，stale或expired不复活。原Change.state支持revoked而旧ImpactStore.state支持stale，adapter将真实stale投影revoked并保留原因，不修改历史枚举。

同库沿用原impact表及其状态权威，新增明确operation='adopt_prepared_source'需经受控前向schema升级（保留旧两值及旧行/索引，不能IF NOT EXISTS掩盖CHECK未升级）；不可变created_impact_fact(impact_id主键FK、format、plan_json、plan_sha256、prepared_source_id、source_kind)保存新preimage，**没有state列**。旧ImpactStore的M3 hash解析只处理旧operation，新service解析新operation；两个域拒绝互认。旧迁移API不因此接受任何新虚构operation。schema/同key/跨项目/旧库重开/新旧hash域/回退测试必须实际证明。

### D-10：created采用完整闭包与恢复

既有RevisionStore.commitAdoption依赖migrated projection/ledger，不能仅填假migration_id调用。新created分支沿唯一Coordinator.controlledWrite与原project_transaction(kind=edit，request.operation='agent.created_source.apply@1')，通过新不可变created_adoption_fact记录原/目标完整闭包、原生计划、impact/approval绑定、私有stage/backup token及预期snapshot；该表不含state。created_source_fact沿现有namespace按同snapshot逐字段验证或插入；project_origin仍created，不能改bootstrap来源或伪造迁移。

CreatedSourcePublisher（新共享core文件）对Host独占created source根准备完整隔离目录，各文件/底层目录fsync并复验；prepare前无author写；prepare后记录原journal事实再把旧source移至本事务私有backup、完整新source原子rename到固定author根，父目录fsync；中间缺口由项目pending recovery gate阻止读取/新写，不能被普通source观察误判terminal attention。不得只换film.html而遗漏settings/subtitles/资产。发布/DB/事件间崩溃由此专项recover在generic之前对账，只能完成原已批准事务或恢复旧完整闭包/attention；不把工作流accepted当commit证明。

RevisionStore新增同权威commitPreparedCreatedSource入口（新分支，不是另一状态机）：一个BEGIN IMMEDIATE中CAS当前base/source/control/锁/许可/Run/批准与impact，消费Approval/impact、验证snapshot/source_fact、revision恰+1/pointer、step结算/原event/outbox与原idempotency响应、project_transaction committed。不得方法前后另写source_fact或consume批准。文件发布成功但DB未提交保留prepared事实并阻止新写，由专项恢复决定；DB已提交只能读回同事实，不再+1。保留旧Hypit/M3/adopt/history所有旧行为与测试。

### D-11：delivery子阶段去重、持久端口及命令归属

BRIDGE core的FixedPhaseExecutor管理同一delivery step的真实Job与lease/attempt；Job payload不可变，包含project/run/plan=1/step/delivery action pair/input/grant/render_receipt_ref。step_attempt仍原唯一活动约束，不为qc/package各造一个无绑定同step Job。一个Job从当前QC检查继续到发布，内部阶段不另有可写状态列：真实不可变QC事实和publish receipt是否存在决定恢复动作，Job/step是唯一进度状态。去重键(project_id,run_id,plan_version,step_id,execution_attempt,producer_render_receipt_digest)，沿原operation_idempotency记录，不混新lease attempt与原execution attempt。

同库cp_a0_render_attempt/cp_a0_delivery继续是正式ready/交付权威。需要新增的编码/QC/publish原始证据只以不可变created_render_evidence（job/snapshot/config/producer attempt/各Ref+bytes+hash/QC canonical）与created_delivery_phase_fact（同delivery Job、phase=qc_inspected|package_published、receipt_json/hash）的FK附属事实保存，无state列、不另存第二ready。所有DDL迁移与原持久ports由BRIDGE core独占，MEDIA提供纯媒体端口和真实receipt，PRODUCT只读展示。

SnapshotRenderService拆阶段后的MEDIA端口输出D05 receipt；FixedPhaseExecutor每次resume先核原Job/lease/grant/gates，再读证据验证文件，qc Gate只能在真实QC inspect后建立pending绑定；accepted仅随D15真实可信人类决定同事务登记，package阶段晚到/旧lease不得commitReady。publish后DB前先验证已有包receipt，幂等补记；DB ready后不重新encode/publish。依赖字段/签名在MEDIA DESIGN+ports候选中按上述锁定，端到端命令基座是现有tests/agent-driven/media/render-snapshot.test.ts，新增生产组合验证精确文件tests/agent-driven/integration/created-render-delivery.test.ts与created-delivery-recovery.test.ts（新文件，当前NOT_RUN，不冒称已存在）。

### D-12：历史证据、规范归属与工具链

原contract-freeze.json是A实施合同版本的权威；registry内state是被冻结的编写时注记，不代表当前准入/注册状态。新附属asset-inventory规范放本包contracts/asset-inventory-v1.schema.json与contracts/asset-inventory-v1.registry.json（设计文件）；**这是明确新增的只读协议面**，不计入原冻结31，但未来总暴露数=31原路由+附属路由/资源，不能报告“总协议完全未扩大”。MAIN批准规范，BRIDGE唯一producer/注册writer，PRODUCT/MEDIA消费者。原冻结resources不改，runtime显式合并附属受控注册并分别验证/宣告版本。

所有旧PASS只证明其绑定SHA/字节。当前processor/store/worker相对历史closure已漂移，候选380b verifier与当前ffef不同，均保留历史而不标当前审查通过；R0必须当前字节重审/受影响复验再冻结。Node满足>=22.15.0；使用目标worktree的corepack pnpm --version核对10.33.0，不能把Claude PATH下的10.31.0写为已满足，也不能据MAIN PATH的10.33.0推定子窗口一致。本轮不安装，未来未满足时由MAIN复用已存在corepack缓存/可执行文件，仍缺则记录工具链阻塞，不擅自联网升级。


### D-01精确附属DTO补充

资产附属schema/registry现已在contracts/目录落盘，均标DESIGN_ONLY。UI登记请求是RegistrationRequest，而非直接暴露Host-only LocalAssetInput：UI发meta/project_id/candidate_id/source/license/recording_origin；Host解析已授权根中的opaque候选，计算所选文件expected_sha256、生成与真实声明主体绑定且跨会话稳定的attestation_ref、构造安全relative_path后调用原import。文件列表不读取/散列全部大文件；只散列用户选定项。Source owned/licensed/generated的nullable uri在适配时显式转成旧AssetSource可选字段，不能传null给原校验。目录/候选token失效只影响新登记，已完成同key请求先重放receipt，不因旧候选过期拒绝原成功响应。上文“既有LocalAssetInput精确字段”仅指Host内部调用，不是浏览器可注入私有路径/声明主体。资源只读，新的四HTTP和一个MCP resource是公开承认的附属扩展，不假称原31就是全部暴露面。


### D-03受控媒体读取补充

现有ReviewPackage只提供Ref/download_ref，不能用私有文件路径或正式Delivery下载器冒充预览。具体附属只读transport见contracts/review-media-v1.registry.json：GET /api/ui/v1/projects/:id/review-media/:ref，当前owner鉴权及UI读证明、opaque ref→实际包/版本/输入输出/quality/producer attempt与文件receipt；只读允许媒体/VTT/JSON，绝不返回HTML工程执行入口或任意stage文件。MEDIA提供已证字节/FD读取端口，BRIDGE独占HTTP装配，PRODUCT原播放器/转义视图消费，读取不触发编码或状态写入。此为第五条明确新增附属HTTP，不混入原冻结31。缺预览返回真实不可用，不得创建假链接。


## 最终语义补充 D-13..D-15（覆盖原草案同项不精确措辞）

### D-13：冻结SQL namespace与明确prepare成功条件

当前applyAgentSchema对全部cp_a0_*及agent_driven_schema_receipt做精确schema fingerprint/定义比较。因而新事实表**统一用created_*独立内部namespace**：created_prepared_source、created_impact_fact、created_adoption_fact、created_render_evidence、created_delivery_phase_fact，以及本节的created_review_gate_fact/created_qc_disposition_fact。前轮草案中的cp_a0_前缀提案作废，不向原namespace塞表、不放松matchesFrozenAgentSchema、不改冻结agent-driven-a.migration.sql。每个内部namespace用既有matchesFrozenSchemaNamespace按固定版本DDL校验，未知/漂移fail closed；影响表operation的前向升级按D09处理，保留旧CHECK值和行且不更改旧API允许operation。

D04的SOURCE_ONLY是具体持久字段值，不是job kind：job.state='succeeded' AND job.terminal_reason='SOURCE_ONLY' AND provider_receipt_json.kind='local.native-draft@1' AND provider_receipt_json.stage='SOURCE_ONLY' AND receipt.source_digest=同job真实created_task_prepared.source_digest。生产execution attempt和存储producer lease_attempt对应；**成功Job已释放lease，不能要求它仍有running lease、更不能重新claim成功Job伪造proof**。采用所需proof由MEDIA新增只读proveForAdoption入口（名称定案，职责复用原完整验证原语）从持久prepared fact/producer completion+当前author/资产许可重建，绑定本次受控transaction及私有FD能力；原工作中TaskLease proof不冒用、不序列化。

### D-14：encode、QC、publish必须分别有持久锚点

D05/D11的总receipt不能单独覆盖encode后QC前。created_render_evidence按不可变phase='encoded'|'qc_inspected'与前驱digest形成append-only证据链，主键(project_id,job_id,execution_attempt,phase)，没有state列。EncodedFactV1至少含format/project_id/job_id/producer_execution/producer_lease_attempt/snapshot_id/source_digest/render_spec/config_digest、media_object_id/media_sha256/media_bytes、expected_frames/fps及created_at；**无QC通过字段**。实际encode close后先将本次UUID staging的字节保存到Host私有不可变对象域并fsync，随后同原Job/lease事务登记事实；任何公共读取/ready均不因此放行。对象登记前崩溃是不可公开orphan，按私有归属对账；登记后重启按该fact重新hash复验再QC，不重编码假冒恢复。

QC证据是同一media对象真实ffprobe/full decode/字幕许可sidecars及原结果的Ref/hash/bytes、QC项和parent encoded fact digest；完整结果后才追加qc_inspected事实，不提前写ready。取消/失lease的事实不能作为当前成功阶段结果，晚到隔离。receipt.attempt与manifest.attempt保持现有“已发布winner包”的一致性；producer encode execution/lease attempt仅在不可变EncodedFact单独保留并与媒体对象hash交叉验证，不能把它偷换为publication attempt。重复同snapshot/config发布命中已发布receipt时不重编码、不新建媒体对象。

持久包receipt是文件发布存在性的证据，数据库Delivery/ready是授权后的业务可见性权威，**二者必须一致**；不能笼统说DB只是可丢弃派生或仅凭receipt直接给下载。publish后DB前按完整receipt+仍合法prepared authorization/fence恢复原登记，DB ready后缺包则阻断/attention而非继续下载。Job kind复用已有render（编码）及snapshot_publish（同一delivery步骤QC/发布），不新增JobKind，不改TaskPrepare.kind。

### D-15：QC是审阅门，执行器不能自签accepted

原fixedPlan.delivery.review='qc'及协议“QC不免审”保持。**D05/D11中“自动调度qc.inspect→记录QC Gate→package”指产出真实技术证据并建立pending门，不是自动接受QC**。common guard永远不写accepted。Host让人类在工作台一次检查成片/质量报告；通过原review.decide写真实可信决定后才接受qc Gate，之后Host在原scope内继续确定的delivery.package。无block才可接受；warn需明确展示并由该决定绑定全部当前warn IDs和质量摘要，生成真实受控处置事实（reason_code=user_accepted_disclosed_warning、decision_id与item_id），无决定不能静默视为passed。block不能靠accept覆盖。

保持原ReviewPackage wire kind：最终成片QC仍是完整chapter_pack（预览、旁白、字幕、镜头概述、许可质量五项），但其实际目标门由**新增只读不可变created_review_gate_fact**明确绑定gate_kind='qc'、producer_step='delivery'、project/run/package/version/input/output/quality/render_evidence_digest。这是显式新增内部语义，不把普通章包自动当QC。review_request.gate仍用原chapter分类，实际RunGate目标由该强绑定确定；FixedWorkflowService新增Host-only publishQcReviewPackage路径，旧publish/decide默认映射保持；decideReview同事务核此fact并只更新绑定的qc Gate。客户端不能提交target_gate/facts；只有Host经真实技术QC证明才构造该包，需原chapter_pack与cover门已接受、当前committed snapshot完全对应。

PRODUCT按RunGate.kind='qc'和绑定包显示“交付质量确认”，不按wire kind误标题为普通章节。BRIDGE/Agent仍沿review.read三元组(project_id,run_id,package_id)读取同包与质量ref，引导用户，不增第二套决定API；最终QC不能因之前看过样片/章包自动接受。Created_qc_disposition_fact只有真实可信QC决定才能写，无状态列，事实与同决定事务一致。

delivery的snapshot_publish Job在QC待审时原子记录step waiting_user并释放自身lease回queued，claim候选必须过滤真实pending QC门，不能轮询重复inspect/占住worker；receipt next_actions指向review。人类接受后同一Job重新claim（新lease_attempt，但原execution attempt不变），此时真实在执行package，方可将该step从waiting_user推进running并走普通delivery.package共同守卫；这与为绕过准备采用门伪造running不同。暂停/取消/授权过期继续阻止派发；取消queued待审Job也要收敛原step。package完成后正式Job/step/Delivery/event同权威结算。

本补充是方案修正，所有新实体/表/路径仍未实现。需要新增的精确代码/测试由03清单分配BRIDGE（持久/守卫/QC门）和MEDIA（EncodedFact对象原语/只读adoption proof）/PRODUCT（QC呈现）；各自Claude只做未来已授权范围。

附属schema最终精确性：InventoryItem及登记source/license标签上限与原LocalAssetRegistry一致为2000，derived lineage最大256，避免已合法登记对象因新读取schema变窄而不可读；rights_ref.version固定const1，顶层union明确允许POST InventoryItem响应。数据形状校验仍不能代替Host许可/bytes/身份语义验证。


D01登记幂等的精确实现：attestation_ref必须稳定，不得每次HTTP随机生成。Host从(principal/project/idempotency_key/candidate_id/source/license/recording_origin)的受限canonical摘要生成ui_前缀声明引用（域narralens-local-asset-declaration-v1，排除correlation_id/当前时间/session）；先检查原LocalAssetRegistry导入operation receipt并验证原asset/operator/声明引用，同key同body返回原库存项。只有无receipt才校验candidate TTL/root身份并计算所选文件hash，构造旧LocalAssetInput。候选过期/Host重启不能挡原成功receipt，异body必须409而非重放别人的声明；禁止新建第二幂等表/状态或先验证过期候选再找成功回执。精确步骤已写附属registry，BRIDGE在local-asset-http/registry已分配文件实现。

## 最终定向检查的三条精确性补充

1. D01声明引用的唯一派生规则为contracts/asset-inventory-v1.registry.json中idempotency.attestation_ref：`ui_` + SHA256指定域及canonical preimage的前60个hex字符，共63字符，必须满足既有ID最大64字符。不得用ui_+完整64hex，不得绑定瞬时session、correlation_id或时间导致重放漂移。
2. 设计件`contracts/asset-inventory-v1.schema.json` / `asset-inventory-v1.registry.json`分别对应下一轮根目录运行时`contracts/agent-local-assets-v1.schema.json` / `agent-local-assets-v1.registry.json`；BRIDGE据同一设计实现`src/contracts/agent-local-assets-types.ts`与`agent-local-assets-validator.ts`，不另造第二套素材协议。这里前两个相对路径位于本包，后四个按03是未来源仓路径。保持设计与运行时逐字段映射、附属版本一致并验证差异，不能复制后各自漂移。
3. R0/R2/R4独立复核由MAIN安排未参与被审实现的干净Codex上下文；R0核当前overlay而非旧closure，R2核共享事务/采用/NativeAck，R4核冻结组合与实际证据。BRIDGE作者不自签其68项共享实现，其他领域若曾改被审共享文件亦须回避该范围。MAIN记录冻结SHA、reviewer参与范围、命令和逐项结论；独立上下文不可用就REVIEW_PENDING，不能拿当前设计ACK代签产品验收。
