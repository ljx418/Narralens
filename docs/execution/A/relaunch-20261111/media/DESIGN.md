# MEDIA A 恢复设计 · DESIGN_REVIEW_PENDING

> 当前执行设计以本文末尾“D01–D15最终ACK”及集中03名单为准，覆盖此前待裁决/历史备选措辞；这是设计任务包，不是实现release。

本轮仅设计/只读核对及可见 Claude 启动检查；不实现、不测试、不安装、不渲染、不启动服务、不提交，不进入B。产品验收全部 NOT_RUN。路径前缀 MAIN=`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，canonical=`/mnt/c/workspace/videoworkline/Narralens`（Windows `C:\workSpace\videoWorkLine\Narralens`）；旧lane不能证明MAIN缺失。最新授权覆盖AGENTS内历史暂停描述，但仅覆盖本轮准备。

## 事实边界与输入绑定

实际 MAIN HEAD `838ba5f2c8500f0103f56dbe51264ea9f70086fc`，canonical基线 `ca5b67a8285b130c79055317c6202f73cfbb99c8`。本轮权威归档为 `../baseline-observed.json`，不是旧 `docs/execution/A/baseline-observed.json`。以下是读取工作树实际字节，不能把 dirty 当已提交。归档 dirty 文件逐项重算：25项，全部匹配=True。归档本身SHA256 `f31f82d57a3eb2df6608b6fc47ffab68124ca8bb1e0d038c0c231838bd19e38a`。实现释放前必须重算，差异先归档并经MAIN解释。

| 实际源码/输入 | SHA256 |
|---|---|
| `src/host/agent-driven/created-draft-processor.ts` | `6727b0b64bc07cfdea0346e7f885d0ffcbd74832a66f939056735c66872eeef5` |
| `src/host/agent-driven/prepared-draft-verifier.ts` | `ffefbd4169dfd07930723e2606997845fc1bc4a1aa9d0f6b60b7bfd6eb5276db` |
| `src/host/agent-driven/created-task-store.ts` | `d7a4734cc9ed5924b7088a4cfaebecdd2ff202c373a9621c21078908f10e7b14` |
| `src/host/agent-driven/created-task-worker.ts` | `41a7658520d68a90be976690a9c27311f4be47a4a58776686e950ce3a563d4c4` |
| `src/host/agent-driven/creation-application.ts` | `20247ab174bc36bfc506a49126b80aa0ec784478f498f84b16121ad9581192f9` |
| `src/host/agent-driven/committed-snapshot-authority.ts` | `91fd1e8b517bfbcf4dcc385d3b243df3e945b48f8fec27ea7bee71e80fb1d0aa` |
| `src/host/engine/source-digest-v1.ts` | `d32dfc433865865749efd5e5f44f00eceff27b93d7607603c5eb9233708c599d` |
| `src/host/render/native-draft-assembler.ts` | `1b8a6bc403053091e74a3357815b35fddc3d9fb71aa5e8448782f66feb58877e` |
| `src/host/render/ports.ts` | `06ab9bea87df660e7e2297886b259a0d90d8561a6b01199f7bd16265f1ecee6a` |
| `src/host/render/render-snapshot.ts` | `cb5d187e5d7b3493259d68739992001b2f19aecaea6aeff4fd8064b6d8627e46` |
| `src/host/delivery/qc.ts` | `05f7efc080c134c50070b77dc8b57c153bd996e68388d005936a68244b3d7310` |
| `src/host/delivery/delivery-service.ts` | `114f701a87d69bdbb92dfe040f1f8fa461bd270f50fda247ae4c8b055caf0b90` |
| `src/host/delivery/download.ts` | `b01d97ac0a4efcb96f4a0a1bda90289999584883f16c22b8fd0d6d36889c1003` |
| `package.json` | `edace26fdfa5a9808f2706fe15ab3935d0512d08f765d4cffec268eb7e783263` |

CP-A0 `cp-a0-r4` 文档提交 `f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450`；合同冻结文件是历史实施授权，不代表所有registry声明已装配。MAIN当前合同核对：

| 合同 | 冻结SHA256 | MAIN相符 |
|---|---|---|
| `contracts/agent-driven-a.schema.json` | `088a451e9646199618261a6cc95a84e3767dbf4cc87004f3e5995dda86b60964` | True |
| `contracts/agent-driven-a.registry.json` | `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f` | True |
| `src/contracts/agent-driven-types.ts` | `54356697802c0bf048e5cbcde1f54eb33713d4fe58943b346406804011cb3644` | True |
| `src/contracts/agent-driven-validator.ts` | `f11a68bad982b7914e73f396ce48e99195ffc8fa88e842f137ffabf31900ea73` | True |

### 已有、已有但受限、尚未闭环

- **已有源码**：CreatedDraftTaskProcessor.execute→CreatedTaskGate.assertWorker→真实LocalAssetRegistry.resolve→PinnedNativeDraftAssembler.prepare→PreparedDraftVerifier.prove→CreatedTaskStore.recordPrepared/finishPrepared。processor、verifier及关联dirty属于MAIN未提交候选；不另写替代processor。
- **已有生产creation接线**：creation-application.ts 的 CreationApplication 构造creation store/worker、localAssets、CommittedSnapshotAuthority、CreatedNativeWorkspaceService与工作台只读入口。dispatcher当前未装配task.prepare/正式render/delivery；搜索src与tools显示SnapshotRenderService实例在诊断CLI，不能说生产已ready。
- **原生事实**：assembler用固定OpenFilm `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` 的readFilmFile校验原生video/iframe/audio clips，film.html、.film/settings.json、.film/subtitles.json、draft-plan.json、rights.json及资产闭包；概念说明是独立可编辑page clip。旁白完整音频单clip，字幕timing_basis=storyboard_plan，不声称ASR/逐词对齐。
- **已有受限证据**：旧lane HANDOFF `7439c0a9f3541c2d7345c2105dea3249e4cd725e` 内134模块测试为作者内部证据；media-independent-review后续记载具体R1/R4修复、137模块测试及1秒合成音CLI闭环。MAIN draft-processor-real日志为3秒诊断，不是真实中文人声和60–180秒影片。只读引用这些历史证据，本轮无重跑，也不外推A通过。
- **未闭环**：生产task processor装配、准备产物受控preview/read引用、created-source adopt契约、采用后的CreatedSourceFact producer、正式render持久fence/commit/record/authenticated download及重启对账、真实授权资产与中文录音/两主题/60–180秒、双正式导出与完整T20。不是说模块不存在，而是这些生产组合链未获实证或尚未装配。

## 0层：完整用户路径及权威

A-MEDIA-1（IT-A03/04/05）：Agent确认Brief/Script/Storyboard→已授权本地资产/人声登记→Host固定run门→native source准备→独立预览/章节审阅包。author source/revision/active_commit全不变。样片/首章门不可绕；单章同输入/输出/质量摘要可复用同决定。

A-MEDIA-2（IT-A05）：工作台一次“确认并采用”→MAIN可信ReviewDecision与限定Approval→唯一Coordinator提交→immutable snapshot/CreatedSourceFact→PRODUCT原生加载并ack。纯接受和关闭不提交；Job完成、commit、NativeAck三个事实不同。

A-MEDIA-3（IT-A01/05/06）：committed transaction绑定snapshot→正式render→完整decode/QC→不可覆盖包→同库ready/receipt/outbox→鉴权下载；关服重开，改单镜受控采用，第二次正式导出。MEDIA不自建DB、Job、审批、时间轴、源工程权威。

## 1层：实体、调用与持久事实

|实体/调用|producer → consumer|持久事实/不变量|
|---|---|---|
|LocalAssetRegistry.resolve / NativeDraftAsset|MAIN registry → MEDIA assembler/verifier|project_id/asset_id、sha256/bytes、duration_frames/kind/mime_type、source/license/rights_ref、recording_origin；absolute_path仅Host，必须同项目当前许可且真实blob hash一致；human_recording是有来源声明的事实，不由tone频率推断|
|TaskPrepare / CreatedTaskStore|BRIDGE façade→MAIN gate/store/worker→processor|meta幂等键+关联ID；project_id、kind、input_refs(id/version/sha256)、snapshot_id、base_revision/source_digest、execution、render_spec按冻结DTO；assemble必须恰为授权script+storyboard两ref、render_spec=null；render须有snapshot/spec。execution run/plan=1/step/attempt/input/authorization由Host真实读取，不信任客户端自报|
|PreparedTaskFact|processor+verifier → MAIN created_task_prepared|format固定created-task-prepared@1；stage_token只映射私有stage，不是公开路径；source_digest、plan_digest(nullable旧类型，native产物须非空)、rights_digest均hash；files(relative_path/bytes/sha256)与roots严格闭包。表按job唯一、fact不可更新/删除，lease_owner/lease_attempt另存；prepared-native.json不自含fact hash|
|PreparedDraftVerifier.prove/assertCurrent/proveExisting/release|MEDIA候选→MAIN processor/store|proof为WeakMap对象能力，绑定task摘要、lease、事实与保留FD；JSON/复制token不能伪造。恢复必须按持久fact重新开文件重算，签新lease proof；旧proof不能复用。assertCurrent只能在TaskStore真实lease事务内调用，不自行授权run|
|computeSourceDigest|MAIN engine→verifier/authority|SourceDigestV1域不变、固定upstream、完整roots/assets、external_reference_count=0；文件身份/类型/hash/引用必须一致。native小数比较使用相应JSON域，不偷改CP integer-only digest|
|CommittedSnapshotAuthority.readerForTransaction|MAIN revisions/snapshots/creation→SnapshotReadPort|project owner+transaction committed+snapshot digest/ID+creation.sourceFact必须一致；revision=transaction.base_revision+1。当前只认registered created-source producer，采用新snapshot必须新增真实sourceFact，不能复用bootstrap事实|
|SnapshotRenderService.render|MAIN Job dispatch→MEDIA模块|SnapshotReadPort闭包复制/核hash→preflight许可与必需附属件→NativeRenderer→runQualityControl→PublishedPackageStore→commitReady。不读live author，不把preview staging称snapshot|
|DeliveryService.read/download|MAIN durable record→MEDIA→BRIDGE/UI|ready且qc passed、manifest/receipt全部一致、包每文件校验才供字节；download同FD hash与stream、200/206/416，跨项目404；Host route负责principal鉴权与断开时close|

### 既有正式render端口逐字段约束

SnapshotReadRequest：project_id/snapshot_id必须匹配reader绑定；source_digest给定则严格相等。SnapshotClosure：project_id/snapshot_id/source_digest/project_revision固定该commit；expected_frames/expected_duration_seconds类型虽允许undefined，A producer必须提供真实原生预期；native_root/native_entry为私有路径；entries逐项relative_path安全POSIX、absolute_path仅Host、sha256/bytes精确、kind=native_source|asset|supplement、rights_ref为对应许可或first-party source才null、role标subtitle/许可等；rights每项asset_id/status/commercial_use/ref来自当前授权事实，unknown/restricted不能伪造cleared，字体与未知资源不能漏检。

AttemptIdentity：project_id/job_id/attempt/execution与原持久Job同一身份；claimAttempt原子唯一占用，checkAttempt=proceed|cancelled|superseded；releaseAttempt只释放自身且进程真实收敛后。MEDIA outcome.requires_reconciliation时MAIN保留未知/待对账事实，不新发attempt。

RenderRequest其project_id/job_id/snapshot_id/source_digest/attempt/execution绑定同一任务；render_spec不可临时改质量，required_supplements包含A承诺字幕与许可，signal来自Host取消。DeliveryCommitRequest的project_id/job_id/snapshot_id/source_digest/delivery_id、manifest、download_ref、package_id/object_id与真实不可变receipt一致；attempt是产包winner，execution是当前记录者，不能混淆。MAIN同事务重验授权/fence并保存ready+receipt+业务outbox。events_published是持久outbox之后的实际投递观察，不得在尚未commit时广播成功。

DeliveryManifest既有字段逐项保留：delivery_id/project_id/snapshot_id/source_digest、render_spec/render_config_digest、winner attempt、media_ref/ffprobe_ref/full_decode_ref/supplement_refs（每ref id/version/sha256）、qc每项id/status/reason/evidence_ref、published_at、download_ref。包不包含Host绝对路径/凭据；原生附件不等于完整独立可编辑工程导出。

## 公共合同请求（提案，绝非现有生产API）

**MEDIA-CP-01：历史备选（本轮不采用新增公开Ref；以末节D-02/D-03为准）：immutable prepared source引用/preview。** MAIN拥有schema/DDL/registry，MEDIA producer，PRODUCT review/preview和BRIDGE读消费者。建议新增明确类型PreparedSourceRef，不占用现有Script|Storyboard ArtifactContent，也不将stage_token直接当public URL。字段提案：id(opaque)、version(正整数不可变)、sha256(整个事实摘要)、project_id、job_id、execution(run_id/plan_version/step_id/attempt/input_digest/authorization_id)、base_revision/base_source_digest、prepared_source_digest、plan_digest、rights_digest、upstream_sha、frame_count/fps、asset_refs/subtitle_refs、preview_ref。所有hash绑定实际闭包；preview_ref只指鉴权只读预览能力，不能取得author写权或Delivery下载。Host将内部stage_token/原始lease_attempt映射到该ref；不向客户端泄露root/FD。精确命名、canonicalization、TTL与schema版本由MAIN冻结；未知字段默认拒绝。preview编码与正式render采用不同目的/授权/产物类型，不得伪造committed snapshot喂SnapshotReadPort。A可先使用隔离只读原生预览，不能把现有可编辑workspace端点直接指向stage。

**MEDIA-CP-02：历史方案比较（本轮收敛到末节D-02合法内部映射，不实施新wire）：created adopt接缝。** 既有PrepareChange与Change强制materialization_id，属于现有M3语义，不能填假ID、插M3 row或伪迁移。建议MAIN选择版本化discriminated source union或独立created prepare输入，再复用原impact/approval/apply/Coordinator；旧migrated分支原样兼容，created不静默降级。候选输入须绑定PreparedSourceRef+base_revision/base_source_digest+selection_version+execution+meta；服务端impact须绑定目标snapshot/source digest、plan_sha256、control_revision、三类锁、许可、有效期与确切修改范围。审批可信UI、一次消费，prepare/preview绝不修改revision；apply重查全部，旧输入409，成功revision+1恰一次，同时登记CreatedSourceFact供CommittedSnapshotAuthority读取。原native可编辑source的批准替换由Coordinator执行，不是MEDIA目录copy命令。

**MEDIA-CP-03：render生产装配与恢复。** MAIN提供真实AttemptFencePort/DeliveryCommitPort/DeliveryRecordPort、download鉴权、能力登记、generic reaper排除及关闭顺序；BRIDGE对接既有task/job/delivery DTO，不扩另一queue。无完成producer时保持capability unavailable，不返回永远queued。新增DDL/version/error只由MAIN批准；已有下载token/manifest不更改，不删除历史包；rollback只停新dispatch、保留对账与读取。

## 生命周期、错误与资源

输入/许可/上游pin不满足：INVALID_REQUEST/CAPABILITY_UNAVAILABLE或既有具体内部错误映射，绝不抹成成功。base/字节/rights变化：REVISION_CONFLICT；同key异输入IDEMPOTENCY_CONFLICT；缺授权/门按RUN_SCOPE_REQUIRED/RUN_GATE_BLOCKED；审批过期按IMPACT_STALE/APPROVAL_REQUIRED等现合同映射，不现场 invent HTTP码。

Worker容量已有上限2，但render全机重型槽由MAIN预约；等待审阅不长期占GPU/worker。cancel/lease丢失中止signal，processor finally释放proof，关闭必须先await worker所有在途再verifier.close/root FD，再DB；不凭超时假定进程终止。EMFILE/ENFILE等HOST_RESOURCE_EXHAUSTED可按已有retryRecoverable回pending，必须bounded且原记录不被覆盖。证明对象持有目录/文件FD，stage树、blob、author hash/identity与许可在record/finish前复核，异常finally关闭；下载断流/416/坏hash同样close。

崩溃分界：recordPrepared前无事实只残留私有stage；record后finish前可由持久fact+新lease重新proveExisting；finish后等用户，不commit。旧attempt晚到不进入新run/plan、无revision/outbox成功污染。render publish后DB前保留receipt对账，不删winner；DB后events前重放outbox不再编码。原生ack由PRODUCT真实加载验证，不由MEDIA Job success推导。

## A素材和质量边界

需人类或MAIN提供已授权本地视频/图片适配范围内素材、许可来源记录、中文真人完整录音与脚本事实，sha256/bytes/probe、可用时长、recording_origin与rights_ref关联；不读J盘，不联网下载，不新装模型。60–180秒、两主题、可编辑概念说明、音画字幕联合审阅、两次正式导出都保留。软件契约/装配/负向测试设计可先闭环，真实视听与A验收必须等素材。TTS/ASR、自动下载、Comfy、动态DAG/稳定豁免、长片及完整标题封面包留B/C，不以前置依赖扩大A。

## MAIN反馈对齐：保留wire的备选与实际Coordinator接缝

已读MAIN `02_MAIN_CONTRACT_AND_DECISIONS.md`、`05_MAIN_ACCEPTANCE_AND_REVIEW.md`，遵守MC-01..14。MEDIA-CP-02不是预先裁决新增wire；两方案提交MAIN比较：

|方案|兼容收益|必须新增的内部事实与风险|
|---|---|---|
|A：保留materialization_id字符串，合法映射不可变prepared-source|PrepareChange/Change wire字段可保持，BRIDGE与PRODUCT传参改动较小；旧M3语义按origin分流|MAIN显式登记origin=created_prepared或migrated_materialization的不可变引用事实及验证器，记录project/job/fact digest/base/source/rights/plan；不在M3表造行、不写migration。不能只因为字符串过schema就交给现MaterializeService.read；命名语义扩展需ADR、能力版本、双分支golden与旧客户端失败策略。Ref别名/跨origin碰撞必须拒绝|
|B：新增wire版本或source discriminant|类型表达直接，旧客户端不会误把created当M3；可明确prepared-source引用|需要schema/TS/validator/registry/SDK/UI/持久JSON版本迁移；旧路由保留或明确unsupported，不将旧freeze原地重写；新增接口实现工作更大|

推荐在MAIN确认合法内部origin事实及所有读者分流后评估A，以最小wire变化满足真实语义；若无法保证所有旧consumer不误读，采用B。两者当前均提案、未实现、待MAIN定案；本轮无新表/API注册。

实际现有 `ImpactService.create/#compute/#readMaterialization`（src/host/impact/impact-service.ts）走resolveActivated、MaterializationStore/MaterializeService、MigratedAssetLedger/MigrationStore；`AdoptionCoordinator.adopt`（src/host/adoption/adoption-coordinator.ts）经ProjectCoordinator.controlledWrite仍显式读materialization及native_plan，故不能直接传created token就称接通。`ProjectCoordinator.controlledWrite/controlledRecovery`与`commit`（src/host/projects/project-coordinator.ts）提供唯一排队/恢复门及commitWithPointer基础。`ProjectCreationStore.commit`目前是bootstrap reservation、revision=1专用事务，会写created_source_fact与origin；不能拿它给第二次采用再bootstrap。

建议MAIN在上述唯一Coordinator边界内增加created source的Host-only解析/影响/采用分支（实体名与DDL待MAIN分配）：先读取immutable reference及真实prepared fact，重proveExisting与当前rights、project/base/source/control/selection/locks；在author publish之前持久准备交易与目标snapshot描述；SnapshotStore建不可变source闭包并复验SourceDigestV1、固定parser投影、fps/frame_count/assets/subtitles。受控publish后再次核author与snapshot字节一致；同一个RevisionStore.compose事务消费impact/approval、更新project revision与active_commit、transaction committed、幂等response、业务outbox，并插入对应snapshot的created_source_fact（不能仅“成功后补写”）。复用既有恢复journal和publisher补偿语义，不能新增另一提交权威；精确扩展commitWithPointer/commitAdoption的选择由MAIN审核。CreatedSourceFact须完整roots、fps/frame_count、assets许可/来源、subtitles，格式校验与fact digest；CommittedSnapshotAuthority读取新transaction时应立刻可验证。事务失败不得出现pointer已指新snapshot但无source_fact；恢复先对账实际publish状态，不能再消费一次Approval。

**消除阶段循环**：准备/preview的运行许可是clip.prepare scope，样片审阅前允许已授权代表性产物；纯技术预览检查只产preview质量证据，不能宣称正式Delivery。review等待状态允许只读preview与change.prepare计算impact；accept_and_adopt消费同一可信决定形成有限采用批准，apply守卫检查“批准有效”，不要求该步骤已经succeeded或已经有正式render。采用commit后才开放snapshot.render的执行依赖；正式QC完成才允许delivery完成。不能要求先正式导出才能批准采用，也不能要求采用完成才能看样片。MAIN需冻结各动作的stage门矩阵；A保留首章门、同包复用，B稳定豁免不提前。

## MAIN拟定收敛方案与分阶段媒体执行（提案优先级更新）

MAIN消息拟定preserve80defs/31routes：内部`prepared-source@1`以`ps_` ID合法映射现有materialization_id命名空间，Host生成原ReviewPackage、JobReceipt.result_ref指包Ref，不公开stage对象。MEDIA认为可行，条件是MAIN冻结origin分派、不可变事实与原M3消费者隔离；本节作为优先候选替代前文“新增公开PreparedSourceRef”的倾向，前文保留为备选比较。`ps_`本身不是授权，映射必须查持久origin/owner/project与真实fact hash；不得只按字符串前缀猜事实类型。外部只见现有包Ref(id/version/sha256)，Host将包的output_digest绑定prepared source闭包/plan/rights和preview实际输出，package/input/quality摘要变化会使旧ReviewDecision stale。Ref namespace由MAIN明确，不能塞进现只接受Script/Storyboard的artifact读取分支。

**当前代码问题**：SnapshotRenderService.render约步骤5..12串行编码→QC→publish→commitReady，finally总会清理stage；不能只在chapters获snapshot.render权限就调用整条方法而偷执行delivery.package。仅插一个前端按钮或无操作commitReady不是分阶段方案。必须抽取可复用步骤并提供持久中间产物handoff；保留现render默认facade给已授权完整流程和诊断兼容，但生产固定阶段调用有分明门的内部执行器。以下实体名全部为拟定Host-only端口，不增加TaskPrepare.kind/wire route，不伪换snapshot。

|内部事实/producer→consumer|字段与不可变约束|授权/持久阶段|
|---|---|---|
|CommittedEncodeFact@1 / MEDIA encode→MAIN事实存储→PRODUCT章节包、后续QC|fact_id/version/fact_digest、project_id/transaction_id/snapshot_id/source_digest/project_revision、render_spec/render_config_digest、upstream_sha/renderer_fingerprint、producer_job_id/lease_attempt/execution、media{object_ref,sha256,bytes}、closure_digest/rights_digest、expected_frames/expected_duration_seconds、native/supplement refs、created_at；object_ref私有受管immutable对象，禁止绝对路径出UI|只在当前snapshot.render scope且committed snapshot成立执行；存事实与原job/step/outbox在同连接、重查fence；不是Delivery ready/download|
|CommittedQcFact@1 / MEDIA QC→MAIN→授权publish执行器|qc_id/version/digest、encode_fact_ref、media_sha256、snapshot/source/config/rights_digest、qc_profile_digest、producer_job_id/attempt/execution、ffprobe_ref/full_decode_ref(含bytes/hash)、items原QCItem、required_supplements及实际refs/hash、disposition_refs、checked_at；绑定确切encode bytes，不能只绑snapshot|在MAIN冻结的qc.inspect当前门下执行；技术preview probe不等于正式QC。若章节允许技术检查，结果标technical_preview且不可冒充最终qc.inspect；最终复用需MAIN明确同输入/profile/许可和授权语义，否则重新QC|
|DeliveryPublishInput / MAIN授权执行器→MEDIA package→MAIN commitReady|encode_fact_ref+qc_fact_ref+原RenderRequest绑定字段、delivery_job_id/attempt/execution、批准的supplements与处置；manifest仍既有字段，不加私有事实字段|cover/章节/采用及delivery阶段qc.inspect、delivery.package门齐全后，Host用原Job/CP attempt语义发起，不由Agent扩TaskPrepare kind。生产调度动作允许集合与DTO校验由MAIN锁定|

分拆复用点：copyCommittedSnapshot/verifySnapshotCopy与NativeRenderer维持原byte核对；runQualityControl保持完整decode/frames/stream/字幕/许可断言；buildDeliveryManifest、PublishedPackageStore.publish、DeliveryService不重写。新增内部prepareEncoded / inspectEncoded / publishValidated（拟名）从render-snapshot.ts抽出，旧render仍按原顺序组合，不改变diagnostic sink仅MODULE_PACKAGE_CREATED边界。检查每步都使用MAIN的当前fence/grant，不能继承上一步较窄授权。

中间持久产物不能沿用会被finally discard的临时stage路径：MAIN登记Host-owned immutable对象与hash，写完整并fsync再以原Job事务确认可读；只在确认归属移交后释放本次stage，事务前崩溃的对象隔离为orphan待对账，不向review公开；事务后崩溃按fact重新hash而非重编码。多次QC引用同一encode对象不修改它；任何media/closure/config/rights/profile变化生成新事实或明确stale，旧证据不覆盖。取消/晚到先隔离对象，当前lease之外不能登记事实；未知子进程保留reconciliation，不释放后再并发写。review等待不保留FD/worker长租，消费者重新open/hash/close。

publish前重新核许可/授权与QC、全部附件hash，不能用旧qc pass替代现在许可。提交Delivery的attempt定义须MAIN选择并锁：建议保持manifest.attempt=实际package producer的delivery attempt，encode/QC各自attempt由内部lineage记录；不要把早期chapter attempt塞入delivery execution。原去重winner manifest保留真实package attempt，当前commit execution单独验证。旧包可重复读取；重启后复用已验证encode/QC事实只省重复计算，不免当前delivery授权。T20-E跨阶段恢复仍四个真实终止点，特别encode后QC前必须有真实持久handoff证据，QC后publish前必须证明授权尚未被消费或被复核。

未决硬门：MAIN明确内部事实schema/hash域/DDL、Job kind与step绑定、result_ref指ReviewPackage的authority consumer、QC阶段profile与处置来源、当前80defs/31routes的能力指纹与阶段动作矩阵；在这些未锁前不释放生产split实现。MEDIA可在确切白名单内设计/验证步骤提取的行为等价，不能调用整体facade绕门。

## 最终领域复核：D-01..D-07 ACK与未闭合边界

Claude只读报告已回收（CLAUDE_READINESS.md，READY_WITH_BLOCKERS），本节为MEDIA领域复核/文档修正，不是独立验收。以下覆盖前文备选歧义；**新增wire union与公开PreparedSourceRef本轮不采用**，收敛到MAIN D-02/D-03既有wire+内部真实origin映射。MAIN裁决仍是实现释放前置。

|裁决|MEDIA结论|明确落实/未决|
|---|---|---|
|D-01|ACK|只支持现registry视频/音频，受控源根/trusted_ui许可；Agent只读inventory；字体/未知附属资源仍需许可，不因输入UI不支持字体而豁免闭包检查|
|D-02|ACK选定方向|created_prepared_source不可变真实fact映射、ps_ ID完整hash防碰撞，零M3/migration假行；必须点名MAIN独占消费者 `src/host/impact/impact-service.ts`、`src/host/adoption/adoption-coordinator.ts`、`src/host/creative/fixed-workflow-service.ts` 及其注入authority，不能把ps_直交MaterializeService.read|
|D-03|ACK|JobReceipt.result_ref对应现ReviewPackage Ref，调用review.read完整输入是 `{project_id,run_id,package_id}`；每个parts Ref须实际producer/namespace/hash且只读鉴权，不泄露stage。CommittedSnapshotAuthority现代码已经拒绝非committed或无created_source_fact，不只是未来建议|
|D-04|ACK窄effect；字段口径需固化|SOURCE_ONLY是job.terminal_reason不是kind：原job.state=succeeded、terminal_reason=SOURCE_ONLY、provider_receipt_json.kind=local.native-draft@1且stage=SOURCE_ONLY，加created_task_prepared及其事实摘要/原生产attempt。完成job可能已释放lease，采用时不得要求该旧job仍持有活跃lease；须校验原生产归属与当前采用授权/事务proof，运行时proof重开后授予当前操作，不能复用旧lease proof|
|D-05|ACK分阶段方向；两项合同仍待MAIN|QC前encode事实/私有对象的持久锚点，以及QC gate合法生产/接受路径须定案；不得原样装配整体facade，不能宣称现有review.decide已经能接受qc门（见下）|
|D-06|ACK|实际observed与Host expected分离；只证明settings/markers不等于整片；MEDIA只提供source/clip/caption闭包，不自写loaded|
|D-07|ACK|先验证原fullSHA+25项dirty overlay再由MAIN形成共同提交；本轮没有实现release或产品源码改动|

### 编码、QC和发布的可恢复锚点

当前createStaging标签为attempt+UUID，没有持久job→stage归属登记；finally会discard/quarantine。因此不能仅凭目录猜job。建议MAIN定案QC前CommittedEncodeFact（不含QC结果），字段见分阶段表；媒体对象先写入独占私有不可变objects域、fsync文件与目录，再原job同库事务校验lease/input并登记fact。登记前进程丢失可为orphan，严格对账后恢复或明确失败，不能凭目录猜成功；登记后再触发可恢复encode_finished边界并释放stage，T20-E1该边界终止重开须能校验同对象而不重编码。QC完成再写独立QcFact/CommittedRenderReceipt并引用encode fact，不能原地增改不可变fact或填假QC。objects域分配/owner/DDL由MAIN独占，MEDIA步骤提取不等于获准改表。

正式publish receipt是已发布包字节的持久锚点；**DB仍是授权、Job、ready和outbox权威**，不采纳“DB行不是权威”的笼统建议。publish后DB前恢复只能在当前合法scope/许可/fence/批准均核实后补commitReady；若已取消不得见receipt就自动ready/可下载。已发布对象保留供对账，不删winner。相同project/snapshot/config已有合法包时早期查receipt并复核其字节/语义，第二次publish不得重编码，也不应额外建object；并发败者允许已有自有临时对象但只清理自身。

manifest.attempt与package receipt.attempt固定为实际publication winner；encode producer_execution/attempt、QC execution/attempt与当前commit execution在内部事实分别存，后到新lease不改winner。消费者按receipt→encode_ref→producer lineage交叉核对，不要求两个不同阶段attempt数值相等，不把manifest单字段解读成所有阶段执行者。复用 `render` 作编码、`snapshot_publish`作发布为候选映射，QC原Job/step归属由MAIN最终明确；不得新增JOB_KINDS_V2或TaskPrepare.kind。

### QC gate：不盲采Claude建议

实际execution-guard.ts明确delivery.package需qc accepted且guard不接受gate；fixed-workflow-service.ts的PACKAGE_GATE只映射sample/first_chapter/chapter_pack/cover，audio=null；冻结ReviewPackage.kind也没有qc。因此Claude建议“QC证据提交qc审阅包、由现review.decide接受”不是当前可直接调用实现，本轮不得制造kind=qc或伪装cover来绕过。MEDIA请求MAIN明确在不改80defs/31routes的前提下，原可信决定/内部事实如何绑定qc gate、由谁原子写入，是否需要限定附属可信UI transport；不能由渲染执行器自己标accepted。QC技术全pass是证据，不等于运行门接受；此前已审决定仅可在确切同输入/输出/quality与实际权限绑定成立时复用。没有合法producer则能力保持不可用，M09继续NOT_RUN，不能为开工默认为自动通过。

### Claude结果的证据边界

会话自报模型`MiniMax-M3.1-Flash-Preview[1m]`，MiniMax match YES仅指会话显示，不验证供应商账户。CLI claude 2.1.300，cwd `/mnt/c/workSpace/videoWorkLine`；其核验14核心hash、4合同hash和25dirty均匹配，文件/测试入口存在。node22.22.1、pnpm10.33.0、ffmpeg/ffprobe6.1.1等版本和依赖文件存在只证明启动前提，未验证实际render兼容；Windows Chrome存在不能证明WSL固定renderer可使用它。vitest maxWorkers=1；GPU是否必要按固定配置，不新加GPU作为A片默认依赖，不凭文件数编造耗时。业务测试全部NOT_RUN。

## D08–D12收敛：最终接线任务规格与ACK

本次读取MAIN裁决文件SHA256 `920da35e15fc08fcd8665e845d0c435f6e1852a1798dd3c01cca6d5b090e7a61`；MAIN原25项dirty overlay再次全部匹配。D08–D12均为**设计ACK**，不是实现已存在声明；当前文档解决前轮“让实施者自行选择”问题，按以下唯一路径实施，不再考虑新增wire union、假M3行、独立QC Job或MEDIA写DDL。

### D08/D09：真实created变更入口与影响

原change.prepare→CreatedSourceChangeService.prepare，原change.apply→同服务apply；router保留冻结DTO/鉴权/owner校验，服务内部才构造窄effect。review.decide只返回原ReviewDecision；事务结束后自动apply与Agent主动apply共享impact/approval消费权威，两个不同请求幂等键也不能产生第二次revision，已消费impact须能定位原transaction/Applied响应。change.approve仅兼容同包同subject同plan的唯一批准，禁止签第二份。PRODUCT显示“决定已登记/采用待完成”，只有Context/真实native observation推进提交/loaded。

CreatedSourceChangeService按D09完整preimage构造plan_sha256：版本域/source_kind、真实project/base_revision/base_source_digest/control_revision/selection_version、ps_引用/request/prepared fact摘要/原producer execution、target_source_digest、snapshotIdFor(project,target_source_digest)、roots/files/资产许可/消费者摘要、原生plan、frames/fps、affected ranges/三类锁/upstream/expires_at。所有整数帧与有理fps；native小数先由明确原生事实摘要承载，不塞入CP integer-only canonical。数组排序写入实现向量，同内容不同排列必须得同计划；缺项/未知consumer graph拒绝，不能用空数组当“无影响”。真实selection初始0只适用于持久无选区事实，不能覆盖用户已有选择。

target_snapshot_id仅**预期内容地址**，当前snapshot-store.ts的snapshotIdFor真实使用SNAPSHOT_DOMAIN+canonical project/source；prepare不插snapshot、source_fact或active_commit。15分钟TTL、重放不续期、now>=expires_at拒绝；consumed回读原结果，stale→revoked投影不恢复有效性。原impact表只增受控operation及同库无state的created_impact_fact；新旧hash域不互认。新增表/前向schema升级/旧库回归由BRIDGE唯一core writer负责。

### D10：唯一Coordinator内完整闭包采用

ACK采用ProjectCoordinator.controlledWrite→CreatedSourceAdoptionService/CreatedSourcePublisher→RevisionStore.commitPreparedCreatedSource typed分支；不调用旧commitAdoption塞假migration_id。已核现commitAdoption会verifyOrInsertProjectionFact读取input.projection.migration_id，故typed分支为真实必要改动。

MEDIA提供stage完整闭包/SourceDigest/原生parser事实；BRIDGE复验owner/base/control/selection/locks/rights/grant/impact/approval，并以原project_transaction(kind=edit, request.operation=agent.created_source.apply@1)及不可变created_adoption_fact记录old/target闭包、stage/backup token。CreatedSourcePublisher fsync完整树后按D10 old→私有backup/new→固定author root，专项pending recovery gate覆盖rename缺口；源读入口和native入口不能在缺口误报terminal attention或读半工程。typed commit在**一个**BEGIN IMMEDIATE内消费批准/impact、验证或插入snapshot+created_source_fact、revision+1/pointer、step/event/outbox/幂等响应和transaction committed。已存在同snapshot的source_fact逐字段相等才复用，不能ON CONFLICT直接忽略差异。

文件publish后DB前失败：维持原journal/pending gate，恢复完成原已批准交易或恢复旧完整闭包/attention；绝不能顺手创建新批准或复用bootstrap revision=1事务。DB后重启回读同transaction，不二次+1；new author/source_fact/snapshot三者digest闭包一致才能打开后续render。MAIN/BRIDGE负责公共实现，MEDIA不写新publisher/DDL/RevisionStore。

### D11：MEDIA纯媒体输出与BRIDGE持久端口

MEDIA在现 `src/host/render/ports.ts` 定义以下**内部候选TS签名**（设计名，非生产API）；实现时BRIDGE/MEDIA必须共同编译消费这些类型，不能各自重造JSON：

```ts
interface PhaseMediaPort {
  encode(input: EncodePhaseInput): Promise<EncodedReceipt>;
  inspect(input: InspectPhaseInput): Promise<QcReceipt>;
  publish(input: PublishPhaseInput): Promise<PublishedReceipt>;
}
```

|类型|字段/来源/逐项约束|
|---|---|
|PhaseContext（三个input共用）|project_id、job_id、lease_owner、lease_attempt、execution(原CP execution attempt，不能混lease attempt)、snapshot_id/source_digest、render_spec/config_digest、signal；全部由BRIDGE真实行生成且MEDIA仅比较不授信。fence为Host注入AttemptFencePort，只能check/claim自身；每次副作用前BRIDGE重验scope/当前stage action|
|EncodePhaseInput|context + CommittedSnapshotAuthority限定reader + Host已分配私有对象域/opaque ownership token + required_supplements；固定upstream pin、真实expected_frames/duration、closure rights来自reader，非客户端路径。MEDIA只做snapshot复制/验证、编码、不可变对象文件fsync及receipt返回，不写DB/gate/ready|
|EncodedReceipt|format/version、project/job/producer_execution/lease_attempt、snapshot/source/config/upstream指纹、media{object_id,relative_file,sha256,bytes}、closure_digest、rights_digest、expected_frames/fps/expected_duration_seconds、native和sidecar descriptors、receipt_digest。无QC必填字段，无download_ref/ready，私有对象路径不出wire；期望时长用frames/fps计算，摘要域用整数/有理值而非未定义浮点canonical|
|InspectPhaseInput|context + encoded_receipt及其持久fact引用/hash + qc_profile_digest、当前rights、required_supplements及真实处置引用；MEDIA重开同对象/hash，不能再编码或换snapshot|
|QcReceipt|format/version、encode_receipt_digest、project/job/snapshot/source/config、inspection_execution/lease_attempt、media hash/bytes、ffprobe/full_decode及sidecar Ref+bytes+hash、qc_profile_digest、QCItem[]/处置引用与receipt_digest、requires_reconciliation。没有state=ready；hard block或未处置warn不得进入publish，真实完整decode不可由probe代替|
|PublishPhaseInput|context + encoded receipt + QC receipt + 当前已accepted qc gate/授权的Host端证明（只能Host构造，MEDIA不生成或接受客户端布尔）+ required_supplements；同delivery Job和原CP attempt继续，当前lease可因恢复更新|
|PublishedReceipt|复用现PublishedPackageStore真实receipt及manifest/package_id/object_id/download_ref和实际publication winner attempt，附内部encode/QC lineage引用；这里只证明已发布完整包，**不代表DB ready**。DeliveryManifest不加新wire字段，MEDIA不能调用DB提交或发ready事件|

EncodedReceipt与QcReceipt先由MEDIA产生候选，BRIDGE在真实原Job事务内重验fence/输入/文件proof并登记created_render_evidence；编码证据阶段不得要求尚未产生的QC字段，使用不可变format/phase判别字段，phase描述事实种类而非可更新状态。QC完成登记created_delivery_phase_fact(phase=qc_inspected)，publish完成登记phase=package_published；同phase真实结果不能原地改写。BRIDGE DDL应落实唯一键(job_id, phase, producer_render_receipt_digest)及完整hash核对，或等价唯一约束，不能只以hash覆盖旧事实。encode原Job与delivery Job不同；QC和publish必须是**同一个delivery Job、同一CP execution attempt**，保留原step_attempt活动约束。

delivery去重键严格D11 `(project_id,run_id,plan_version,step_id,execution_attempt,producer_render_receipt_digest)`；renew/reclaim产生新lease attempt不改该业务键。QC阶段登记后不把delivery Job/step提前succeeded；释放资源等待必要处置时由原Job状态表达，恢复重验原scope/gates，不能创建第二个同step QC Job避开唯一约束。若输入render receipt变化，须合法新execution/input，不可在同payload中热换。

### QC门结论与恢复顺序（覆盖前轮未决表述）

按MAIN D15最终裁决：BRIDGE FixedPhaseExecutor只登记真实QC证据与pending门，不得自动accepted。人类通过原review.decide接受真正QC包后，才在同一可信决定事务内更新绑定qc Gate及warn处置；具体包为既有chapter_pack wire形状加不可变created_review_gate_fact私有绑定，详见末节，不能把普通章包或技术全pass当已接受。

恢复决策明确：无encode事实且仅有orphan对象→BRIDGE按owner token对账/明确失败，不凭目录猜成功；encode事实存在→同对象重hash继续QC、不重编码；qc_inspected存在→验证原对象/许可/profile/处置并重验package授权，不重新创建另一个QC Job；package receipt存在但phase/ready缺失→复验真实包和当前授权/lease后幂等补登记；DB ready→只读验证下载，不再次encode/publish。取消/授权失效时即使receipt存在也不能ready；保留published对象待对账。未知子进程仍requires_reconciliation，确认停止前不得释放可重发claim。

对象durability：MEDIA只能清自己尚未移交的临时stage；EncodedReceipt指向已fsync的私有不可变对象不能被旧render finally删除。BRIDGE接收持久化失败时对象仍保留为可查owner的orphan，不由MEDIA盲删；清理须证明未被任何事实/receipt引用。原render facade保留诊断兼容，生产装配只引用新PhaseMediaPort，不得从chapters调用整体facade。

publication winner attempt写manifest/原包receipt，encode producer attempt和delivery执行/当前lease在内部事实分别保存；校验关联而非强求数值相等。同key已有完整包优先解析并hash复验，不能重新编码。相同业务key异receipt内容明确冲突，不覆盖first winner。

### D12与交付前置

ACK承认附属协议是真实扩展：原31保持，另有4 HTTP+1 MCP resource；MEDIA仅消费已批准asset库存，不在本轮注册。旧证据只绑定旧字节，本轮25项hash相同也不是当前候选测试通过。实际实施checkout必须用其 `corepack pnpm --version`核对10.33.0、Node>=22.15.0，Claude报告中的工具链摘要不是所有窗口已满足的证明；不自行安装。

本轮读取时MAIN引用的 `03_OWNERSHIP_AND_DEPENDENCIES.json` 尚不存在，因此不能伪称最终文件release已发布；本MEDIA任务书已给出明确模块/接口/消费者/新测试路径，公共文件按D08 BRIDGE core独占，MAIN仍须发布集中准确白名单与共同SHA才开工。这是机械release前置，不是留给实施者选架构。


## 最终owner与安全收口

集中03名单现已读取并对齐：MEDIA负责dirty processor/verifier/source-digest及render/delivery模块，新增 `src/host/render/preview-prepared-source.ts`、`src/host/render/committed-render-phases.ts`；BRIDGE负责共享core、所有DDL/持久ports、`src/host/agent-driven/review-media-http.ts`。此前“03尚不存在”仅历史，精确清单见TASK末节，不再作为当前文档阻塞。

D03受控媒体补充ACK：公开面现在是原31加**5条附属HTTP及1个MCP resource**（不是之前4条）；新增GET `/api/ui/v1/projects/:id/review-media/:ref`只读取opaque receipt映射。MEDIA producer向BRIDGE交已证字节/FD读取能力（同FD核hash后读取、幂等close），BRIDGE验证owner/UI读证明、ref对应的真实package/version/input/output/quality/producer attempt，再适配HTTP断流/error/结束关闭；PRODUCT消费原播放器/VTT/转义JSON。只允许媒体/VTT/JSON，不供HTML/任意source或绝对路径，不转用正式Delivery ready条件冒充preview，也不因预览读取生成任务。权限或包绑定变更时拒绝旧ref；正常重读只核实文件不写业务状态。缺文件/摘要错/不可用返真实错误，无假URL或fallback到author source。

D11的同delivery Job、不可变QC/publish事实、BRIDGE技术qc Gate写入与MEDIA纯receipt边界保持；D09完整preimage及D10同Coordinator typed采用保持。当前未发现需再由MAIN选择的MEDIA语义分支；代码尚待实施/产品NOT_RUN是状态，不等于设计缺口。

安全约束：本域与所属Claude均不得读取任何配置/凭据或dump全量env，不复制此次其他域工具日志，不修改/轮换凭据；模型只按会话自报，不追加配置验证。此约束覆盖此前“非敏感会话元信息”措辞中可能被误解为读配置的路径。


## D01–D15最终ACK

D13–D15明确覆盖本文件此前关于自动技术qc Gate的解释；该旧解释已撤回。最终D01–D15及03精确分工设计ACK，无新增阻断反例；以下是必须交给实施者的唯一语义，而非可选建议。

**D13 namespace。** 新事实统一created_prepared_source、created_impact_fact、created_adoption_fact、created_render_evidence、created_delivery_phase_fact、created_review_gate_fact、created_qc_disposition_fact；既有cp_a0_render_attempt/cp_a0_delivery保持原权威。已核applyAgentSchema及matchesFrozenAgentSchema按cp_a0_*精确fingerprint检查；禁止向该域新增表或放宽校验，独立created_*固定DDL版本由BRIDGE采用matchesFrozenSchemaNamespace检查，且校验范围须涵盖原有created_task_*等实际所属表，不能分模块各拿不完整DDL校验同一宽prefix导致互相判漂移。所有DDL/升级/原impact operation扩展仍BRIDGE独占。

**D13完成事实与采用proof。** 精确前置：Job succeeded、terminal_reason=SOURCE_ONLY、provider receipt kind=local.native-draft@1/stage=SOURCE_ONLY/source_digest与同job PreparedTaskFact一致；原production execution及producer lease_attempt取持久记录，不要求成功Job持有live lease。MEDIA在03已分配的prepared-draft-verifier.ts新增只读 `proveForAdoption`，复用完整文件、目录身份、hash、fixed native parser/metadata/registry验证原语，绝不重新claim完成Job。

内部签名设计为 `proveForAdoption(completedSource, adoptionBinding, registryFacts): Promise<object>`：completedSource由BRIDGE从持久job/task/prepared事实构造，包含原TaskReservation、PreparedTaskFact、完成receipt、producer lease_attempt及Host解析root；adoptionBinding包含project_id、受控transaction_id、impact_id/plan_sha256、approval_id、base_revision/base_source_digest、control_revision/selection_version、prepared_fact_digest、target_snapshot_id/target_source_digest。MEDIA重新开并保留私有FD，以WeakMap把proof绑定这些摘要和当前文件/许可；不得序列化或复用TaskLease proof。消费端是BRIDGE created-source-adoption-service及typed事务，须在当前transaction内重验绑定和文件/rights有效性；复用现assertCurrent的底层验证但不传伪TaskLease，采用专用同步校验分支区分proof目的。release(proof)/close沿既有FD所有权释放，成功/异常/取消均finally关闭；跨transaction或改变impact/base的proof一律拒绝。proof只证明文件，不替代BRIDGE owner/Run/批准/锁/事务权威。

**D14锚点与唯一键。** created_render_evidence精确主键 `(project_id,job_id,execution_attempt,phase)`，phase=encoded|qc_inspected，append-only且parent digest连接真实前驱；替换此前泛化唯一键建议，不另造可写phase状态。encode的Job为render，QC/publish同一delivery Job为snapshot_publish；qc事实通过parent encoded digest引用前一个Job，不能要求两个Job ID相同。EncodedFactV1字段按MAIN D14，绝无伪QC通过字段；encoder真实close→不可变对象文件/目录fsync→原Job同事务记录→才允许进入QC。对象前事实后崩溃为不可公开orphan；事实后重启核同对象hash再QC，无重编码。receipt/manifest publication winner attempt一致，编码producer execution/lease attempt另存并以media hash连接；DB ready与真实包receipt缺一不可。

**D15真实QC人审。** Host-only publishQcReviewPackage生成真实成片chapter_pack，五parts为preview/旁白/字幕/镜头概述/许可质量，依据实际QC结果，不是普通章包改标题。不可变created_review_gate_fact精确绑定gate_kind=qc、producer_step=delivery、project/run/package/version/input/output/quality/render_evidence_digest；只有BRIDGE真实producer构造，客户端不传target_gate。保持review_request.gate=chapter及原wire enum；decideReview按该私有绑定更新qc Gate，默认普通chapter_pack仍映射chapter_pack门。前置原chapter_pack/cover已接受且当前committed snapshot吻合；不得复用早期样片/章包决定直接接受最终QC。

技术全pass也必须人类一次确认；block不能accept；warn必须在该决定中明确绑定当前全部warn IDs与quality摘要，原事务同时写created_qc_disposition_fact(reason_code=user_accepted_disclosed_warning、decision_id、item_id)，不允许执行器补默认处置。MEDIA inspect只产QcReceipt，BRIDGE建立pending包/门；trusted_ui原review.decide是唯一实际接受通路，PRODUCT以RunGate.kind=qc显示交付质量确认；BRIDGE/Agent仍按project/run/package三元组读取。

待审时同delivery Job原子settle step waiting_user、释放自身lease并回queued；claim查询过滤真实pending qc gate，不反复inspect/占worker。接受后同Job重新claim，新lease_attempt、原execution attempt不变，真实开始package才推进step running并执行普通共同guard。拒绝/changes_requested保持不可发布，输入变化必须新合法执行输入，不热换旧payload；pause/cancel/授权过期仍阻止claim，取消queued也结算原step。QC包后旧lease晚到publish永远拒绝。只有package完成才按原Job/step/Delivery/outbox权威最终结算。

**readiness引用闭环。** 原CLAUDE_READINESS.md为只读历史报告，不改其字节、不冒称Claude重审D13–D15：其QC前锚点问题由D14解决；阶段越权由分段和D15门解决；SOURCE_ONLY/live lease问题由D13及proveForAdoption解决；qc接受路径由真实chapter_pack+private gate binding解决（不是原报告暗示已有qc wire kind）；origin消费者与owner由D08–D10/03落实。DB“仅派生”建议不采用，D14明确双重权威。当前结论为MEDIA领域文档ACK，不是产品PASS/独立验收。
