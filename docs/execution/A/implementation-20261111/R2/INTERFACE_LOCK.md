# R2/R3基础接缝锁定 — MAIN实施决定

源基线0c1b73cbe384938083482355aaba8eb548c7971b（src/tests/contracts/tools/package/lock与de086完全相同）。本文件关闭领域I1–I4及MEDIA对象移交/BRIDGE事务接缝；不是新PRD目标或额外人工审批。精确代码release与实际目录对齐回执仍单独记录，未释放前不写产品。原D01–D15、R1 CR-001/002不变。

## L01 唯一writer与早交类型

BRIDGE独占其TASK的44个core/test路径，允许新增`src/host/agent-driven/created-source-ports.ts`集中下述Host-only类型。MEDIA独占TASK的9路径，类型追加原render/ports.ts与必要assembly-ports.ts，不另造公共wire DTO；PRODUCT独占其TASK15路径及下述原生接缝明确增量。MAIN最终集成/合同/门禁。三个目录同源对齐后，一次释放连续实现，不为每个类新增外审门；依赖缺项只阻塞相应用例，不构造生产替身。MEDIA与PRODUCT先交可编译的最小真实类型/固定输入候选，BRIDGE消费该commit；不以空壳实现或any绕编译。

## L02 同库created提交能力（BRIDGE单一core writer）

固定入口名：`RevisionStore.commitPreparedCreatedSource(input: CommitPreparedCreatedSourceInput): Applied`，返回原冻结Applied DTO。输入Host-only封闭对象：project_id、transaction_id、impact_id、approval_id、prepared_source_id、execution(原ExecutionBinding)、idempotency_key、request_digest、publication_proof。不得接收客户端validate函数、裸DB、任意SQL或自行构造的snapshot/revision/已批准布尔。目标snapshot/CreatedSourceFact/plan及预期base/control/selection全部从该transaction关联的不可变created_adoption_fact与created_impact_fact读取、逐字段核对。事务/impact/approval与所有FK须同项目、同Run/plan/step/attempt/输入/完整计划。

`publication_proof`是CreatedSourcePublisher本实例持有的opaque对象：JSON/同结构对象无效，绑定本事务原完整源、备份、完整目标树、预期source/fact/snapshot及当前文件描述符，验证函数不能由HTTP提供。publish前核live旧author；publish后核真实journal/backup仍证明原base、当前author完整目标树等于批准目标，不能把新author与旧digest直接比较或用no-op绕过。持有原prepared proof到最终检查，不能移动其根。

唯一BEGIN IMMEDIATE由RevisionStore.atomic持有，先校验原project_transaction可提交状态及全部当前base/control/selection/锁/许可/Run/grant/approval/impact/proof，再原子消费批准/impact、snapshot/source_fact逐字段验证或插入、revision恰+1/active pointer、原step完成、event/outbox/idempotency及transaction committed。任一步失败全回滚，文件发布后DB失败仍保持恢复gate，不先写source_fact/后补consume。原migrated/history/legacy分支保持。

固定仓储join名：`ProductSqliteRepository.joinCreatedSourceCommit(scope: CreatedSourceCommitScope, work: (tx: ProductTransaction) => T): T`。scope只能由当前RevisionStore提交的同步atomic作用域创建，绑定同DB/project/transaction，不导出可构造器；用真实identity记录，不凭结构字段。scope出域立即失效；拒绝跨库/跨项目/过期/Promise或thenable/嵌套BEGIN；即使调用者catch内部错误也poison外层回滚。不得将通用compose(db=>...)当新的commit能力。该join不替代/放宽原joinTaskTransaction。内部类型细节由BRIDGE在上述封闭输入与能力规则内实现，跨模块名称和权限边界不由Claude另选。

## L03 完整计划与唯一批准

PreparedAdoptionPlanV1沿D09全部字段/显式排序/整数帧有理fps。plan preimage必须明确域`narralens.prepared-adoption-plan@1`，受限canonical后SHA256；同一preimage的摘要同时作为Change.plan_sha256与prepared批准facts_digest，不再维护五字段子摘要。旧legacy批准仍用旧语义，不能改旧hash域。先冻结正负黄金向量并由独立Python互核；修改任何原D09字段均改变hash。expiry固定15分钟、重放不续。

FixedWorkflowService.decideReview对真实prepared impact从同事务不可变plan取完整摘要，CreatedRunAuthority重验impact/package/confirmation/scope和摘要。原review.decide、兼容change.approve、自动apply与Agent显式apply沿同一权威、同消费去重，不铸第二Approval；纯accept无批准/影片+0，采用成功+1一次。两个窄effect在execution-guard中实现，不扩大普通waiting_user dispatch。

## L04 I3：ReviewPackage Ref并非缺第二套Artifact协议

当前FixedWorkflowService.publishReviewPackage已经合法写`ArtifactDocument=Brief|Script|Storyboard|ReviewPackage`的不可变artifact_version与artifact_head，package kind映射chapter/cover；这是原生产者的内部支持，不是经ArtifactPut冒充Script/Storyboard。沿该唯一publish入口持久化真实package，并使Context现有artifacts自然带出Ref；不新造假row、不扩冻结Context。

parts不通过ArtifactPut伪装内容；由created_review_media_bindings实际不可变receipt/object关系验证。绑定持久化+publishReviewPackage+可见result_ref在同原ProductTransaction作用域完成（需提供同事务publish内部方法，外部公开方法保留封闭事务包装）。没有成功publish则result_ref=null，不能把receipt filesystem存在当包已发布。Job result_ref投影从真实binding派生，禁止重新结算/claim已成功SOURCE_ONLY Job。GET只读，不生成preview或补登记。PRODUCT现有packageDigestOf(Context.artifacts)继续消费真实producer结果，无须另加wire字段。

## L05 I1/I4：原生观察的单独受控入口

MAIN批准一个新增、单独计数的Gateway内部入口：`POST /narralens/native/observation`。它不加入31 MCP工具、不替换两个UI别名，也不开放任何原生写能力。先于native write catch-all精确分派；只接受同源JSON、现有native HttpOnly cookie+Native-CSRF、真实活跃ControlledStudioAccess session，严格body大小/字段验证。UI cookie、read_token、跨Origin、无cookie/旧session不能发有效观察。

封闭envelope为{format:"narralens.native-observation@1",sequence,event_kind,event}；sequence为1..MAX_SAFE_INTEGER，同真实session严格单调，入站先记录最新sequence再异步验证，较老回调不能回绿。event_kind仅document/hydration/selection。document事件严格原p2 NarralensDocumentState（protocol_version=1、native project/view/document epoch、committed或invalidate分支）；hydration事件严格013 event.schema.json五字段/四parts规则；selection事件严格原StudioSelection，经当前Host绑定和committed clip映射验证。原生秒数允许有限小数，使用专属native规范化，不塞入CP整数canonical域。禁止body携带logical project/actor/session/grant/Host revision/snapshot/source/Approval/proof；这些由session.grant绑定提供。

ControlledStudioAccess在实际exchange创建非secret bridge_session_id，Host内部session对象与grant生命周期回调联接NativeObservationService。新增grant可选`nativeObservation`端口，由BRIDGE在#openNative闭包捕获真实owner/项目/commit/instance generation/已验证workspace与权威selection；客户端不能构造。端口固定方法：sessionOpened(sessionBinding)、observe(sessionBinding,envelope)、sessionClosed(sessionBinding)，绑定包含Host生成bridge_session_id/instance_generation及isCurrent回调；native真实session未建立不得提前active。Gateway只传authenticate返回的同一session与其固定grant，不从body重建。最近显式打开并exchange的会话作为该项目当前active，旧session/view、换代、断连/close立即失效；不能由第一条伪造观察抢active。

PRODUCT新增NativeObservationService实现原NativeContextPort.read(projectId)，并通过上述端口接真实回调；BRIDGE只构造/注入同一实例至CreationApplication的原ProjectContextService，生命周期close先停止入站/异步验证再DB。NativeAckStore用原RevisionStore连接和原cp_a0_native_ack，不增cp表/第二队列。UI只消费原Context/NativeAck，不自报loaded。

独立expected固定接口名：`prove(binding): Promise<NativeExpectedProof>`、`assertCurrent(binding, proof): NativeExpectedProjection`、`release(proof)`/`close()`；proof必须opaque并持有验证期间需要的原始文件身份，不能JSON重建。binding由Host私有grant/commit/workspace/selection创建。projection含真实film hash/bytes、原native rev、source闭包以及settings/subtitle_style/captions/markers各自独立effective digest与明确absence/unsupported。015原算法只负责settings/markers；其not_proven的film/字幕/style由Host committed reader与固定原native parser/consumer规则独立补证，不能用UI row反推expected。未知/读取失败/浏览器偏好/dirty/unsupported不产出完整Ack。

observe在每个await/hash/reader返回后和最终同步record边界复核session/current sequence/generation/view/document/hydration epoch、active commit/source/control/selection及恢复gate；expected来源独立于UI。part任一pending/dirty/failed/unsupported或偏好origin即失效，即使hash相同；callback异常整轮终止。最后写原NativeAck，loaded仅解释当前编辑状态绑定完整源，非全媒体decode/ASR/QC。selection_version由Host对真实当前选择单调管理，不能信客户端自报版本。

新增schema/registry由PRODUCT写`contracts/native-observation-v1.schema.json`、`contracts/native-observation-v1.registry.json`，附属计数显式+1；Host入口配置仍BRIDGE，原frozen CP四文件不改。PRODUCT独占controlled-studio-access.ts、controlled-studio-browser.ts、studio-host-bridge.ts的本次观察适配，以及原提案gateway/native-observation/expected/ack文件；BRIDGE不并发改它们。

## L06 I2：固定实际字节，拒绝陈旧active pointer

MAIN已实测：在private临时副本把实际eeb6c7b0b6c046d39d7c633f4ee0029e23b3f7d6内candidate.patch（SHAf699889206e129dfe4fd913618b34baa8d7e04363f1940d3659664a1e7b9d435）应用到固定e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3，8文件post hash全部匹配source-manifest。该manifest previous_patch=214c629238c2635f5c6212e5e9207eab18f61d17454c08ee64ccd32be41dffa6，use-film pre_extension=9361b5...，保留p2请求起点。actual helper SHA5db47837e690590c9e9678a97e53a10a7115631bd05807ddf6afc925904e2f64，与H-R1 helper-after输入一致；当前MAIN依赖下重新执行真实helper VM：失败pending零读/零hash/零hydrate，新轮正向、final异常不能同轮重试及8literal goldens均0。

同commit的active-candidate.json声称patch198c8b...，与实际tracked candidate.patch不一致，不能当有效pin；不改旧metadata/历史PASS。R2选用上述**实际f699及8个post hash**作为起点，名称`request013-f699-p2-hr1`；不退回只有p2的旧dist，也不从旧private root构建。MAIN新结果见pin-preflight/result.json（scope仅text apply+VM，不是UI build/Host）。

015固定source commit7141357f0453caa9253b43098ef43ab50fddeeea及其5个candidate源文件/实际字节，重新在独立临时源根build并核模块输入sha；不用陈旧dist/hash宣称已验证。PRODUCT可将原候选必要源码作为build输入保存为明确tracked本票文件/生产support文件，内容、来源commit/path/hash和本次改动需manifest逐项列出，不依赖不可达Git对象或另一机器旧var。原vendor只读，copy/patch/build都在本worktree私有var/native-hydration-r2。运行时继续managed-editor的exact archive/bytes/manifest验证；仅在实际新build通过后更新managed-editor-pin.json和managed-editor-dist.tar.gz，旧p2归档保留。构建与browser占MAIN单槽，离线依赖已有缓存、不安装或联网。

PRODUCT额外允许managed-editor.mjs/.d.mts/pin.json/dist.tar.gz、isolated-studio.ts仅本次固定hydration选择/安全加载；必要原013 patch和015五源文件保存于`tools/agent-driven/product/native-inputs/`的**明确单文件名单**，release中列出，不是前缀授权。保持原managed提取/路径/byte guards，metadata不当验收。

## L07 MEDIA阶段端口与对象接管

固定新增`CommittedRenderPhasesPort`，三个方法：`prepareEncoded(request: RenderRequest): Promise<EncodedFactV1>`；`inspectEncoded(input:{request:RenderRequest,encoded:EncodedFactV1}):Promise<QcReceiptV1>`；`publishValidated(input:{request:RenderRequest,encoded:EncodedFactV1,qc:QcReceiptV1}):Promise<PublishedPhaseReceiptV1>`。RenderRequest、ExecutionBinding、AttemptFencePort、SnapshotReadPort、NativeRenderPort与PackageReceipt复用原类型；class/factory构造依赖由MEDIA在相同ports.ts导出typed接口，MAIN/BRIDGE消费，不追加公开HTTP。

阶段方法不另claim Job/lease，原FixedPhaseExecutor持有真实lease，传绑定当前执行的fence；每await/发布前后checkAttempt，最终DB业务可见仍BRIDGE同事务重验。不得用整个旧render facade在chapters阶段调用commitReady。旧SnapshotRenderService.render保持兼容，提取共用逻辑但没有章阶段Delivery ready。

EncodedFactV1字段锁：format=narralens.encoded-fact@1、project_id/job_id(真实encoder Job)、producer_execution、producer_lease_attempt、snapshot_id/source_digest、render_spec/config_digest、media_object_id、media_ref、files(每项id/relative_path/role/bytes/sha256)、frame_count、fps_numerator/fps_denominator、closure_digest/rights_digest、created_at、receipt_digest。没有QC pass/ready字段。补充物与完整native源由files及各Ref/哈希关联；真实probe原始小数JSON放独立证据文件，CP receipt preimage仅安全整数/字符串/布尔/null。receipt_digest是去自身后受限canonical hash，不能从物理绝对路径派生或将producer attempt覆盖为后续lease。

QcReceiptV1字段锁：format=narralens.qc-receipt@1、project_id、snapshot_id/source_digest/config_digest、parent_encoded_digest、qc_object_id、qc_items(原QCItem[])、technical_status(pass|warn|block)、files(同封闭物件描述)、created_at、receipt_digest。真实ffprobe/full_decode及字幕/许可等证据Ref必须指可重开的实际文件；技术pass不接受QC门，warn必须由D15绑定具体此quality的dispositions，block不得接受。

PublishedPhaseReceiptV1字段锁：format=narralens.published-phase-receipt@1、package_receipt(原PackageReceipt)、parent_encoded_digest/parent_qc_digest、publication_execution、publication_lease_attempt、receipt_digest。publish只用同原始encoder字节与已证supplements，不再渲染或以新attempt改来源；QC/package可属于另一个delivery Job及新lease，不能强制等encoder Job ID/attempt。原RenderRequest.qc_dispositions由实际可信决定提供，并由BRIDGE fence/finalcommit核真实绑定，不能把字符串列表当新授权来源。

对象移交采用**先持久完整对象、后登记事实**：MEDIA构造器固定Host选定private objectRoot和workspaceRoot；每次UUID专属staging，完整files/hash+文件/目录fsync后发布immutable object并返回receipt。返回成功对象永不被MEDIA.close或后续失败自动删除；无需跨用户等待持FD或等DB ack才能close。BRIDGE取得receipt后在真实fence内同库登记immutable Encoded/QC fact。fsync后登记前崩溃对象为private orphan，不是ready/publicRef；MAIN/BRIDGE按实际数据库引用及对象receipt做对账，不能当Delivery或按猜测删除他人对象。

MEDIA提供固定内部resolver `openPhaseObject(input:{object_id,relative_path,sha256,bytes,signal?})`，从自己固定objectRoot解析，拒逃逸/替换/错hash，返回bounded read/close句柄（沿R1最大1MiB原则）。只Host executor能在验证原DB fact后调用，不暴露HTTP路径；对象root/factory lifecycle由BRIDGE持有close先于DB。inspect/publish每次重开复验，所有FD finally关闭；不可将encoded对象原地追加QC文件，QC另一个immutable对象。PublishedPackageStore仍唯一no-clobber发布权威，不建第二公开包store。

## L08 一次释放及验收边界

三领域对齐共同source后，MAIN记录实际merge HEAD、保留proof、唯一写者及精确白名单，冻结本文件hash+source/contract SHA再让其Codex启动一个可见configured Claude实施。R2+早期R3基础代码可并行，heavy串行。429核旧writer/children真正停止再接手，>2返工MAIN根因接管。任何positive只证明实际范围，R2/R3/T20/A门分别留case，旧失败不改绿。真正外部高风险/输入问题才请人类；本锁无重复用户审批。
