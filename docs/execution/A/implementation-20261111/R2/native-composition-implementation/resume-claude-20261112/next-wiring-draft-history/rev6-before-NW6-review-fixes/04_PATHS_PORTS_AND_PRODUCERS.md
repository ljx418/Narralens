# PROPOSED：精确路径、私有端口与真实生产链

DRAFT_NOT_RELEASED。不存在的模块/方法明确是拟新增；014接口需接受冻结后绑定。下面是下一实施释放的候选清单，不授予当前writer越界权限；原HC_NATIVE_PREREQUISITE旧reader/mapper文件名不作为新allowlist。

## 路径与owner

|施工包|拟新增路径|拟修改已有路径|边界/责任|
|---|---|---|---|
|W1|src/host/agent-driven/created-native-selection-state.ts|src/host/projects/project-creation-store.ts|单Claude；只新增S01同库私有DDL与constructor bootstrap绑定，不改九字段commit|
|W2|src/host/m5/created-native-selection-mapper.ts；src/host/agent-driven/created-native-commit-permits.ts|src/host/m5/native-observation.ts；src/host/m5/native-ack-store.ts；src/host/agent-driven/project-context-service.ts|mapper目前只有NativeSelectionMappingPort接口，实施文件并不存在；新增实现复用已验reader/facts|
|W3|src/host/agent-driven/created-review-publication.ts|src/host/agent-driven/creation-application.ts；application-dispatcher.ts；created-run-authority.ts；created-prepared-source-store.ts|新模块包含preview publication编排、immutable receipt payload存储与media binding resolver，不另建审批/Job系统；同一writer|
|W3消费端|无第二份实现|src/host/agent-driven/created-source-facts-reader.ts；created-source-change-service.ts；created-source-adoption-service.ts；created-source-publisher.ts；created-source-recovery.ts|只装配S01业务读面、真实producer、constructor-only HC13边界；算法变化另列差异审查|
|W4公共装配|无第二Host|src/host/server.ts；src/host/agent-driven/creation-application.ts；start-runtime.ts；src/host/projects/project-creation-service.ts|唯一MAIN释放给同Claude，按05启动/关闭；若过滤修复仍需要project-coordinator/adoption/history文件，先比对e2已有修复，不重复重写|
|原生GET接线|无新公开route|src/host/m5/openfilm-studio-gateway.ts；controlled-studio-access.ts；openfilm-studio-supervisor.ts；src/host/agent-driven/creation-application.ts|只接014实际producer/ref/witness owner；原allowlist不能掩盖GET写cache，遵循05|
|HC13测试seam|tests/agent-driven/integration/helpers/host-recovery-child.ts|CreatedSourcePublisher/AdoptionService/Recovery构造期私有barrier|只测试构造注入+真实IPC，不新增HTTP fault/环境开关；正式commit路径相同|

上表未给完整前缀的同格文件均位于该格首个完整路径的目录；最终ReleaseAssignment必须展开为每个完整路径，不把此简写当运行allowlist。多个施工包共有CreationApplication/server，所以串行移交同writer，不能并发改同文件。

拟新增tests：tests/agent-driven/integration/created-native-selection-state.test.ts、created-native-selection-restart.test.ts、created-native-selection-composition.test.ts、created-review-publication.test.ts、created-native-composition.test.ts、created-native-ui-transport.test.ts、host-recovery-composition.test.ts、host-recovery-crash.test.ts；helpers/host-recovery-child.ts；tests/agent-driven/headless/created-native-entry.test.ts。原ack/workspace/source/recovery/adoption/owned-runtime及m2.2 Host回归保留。

保护：AGENTS.md、public contracts/DTO、cp_a0表/namespace comparator、RevisionStore九字段commit与pending gate、原批准/事务表DDL、pin/artifact/vendor/deps/config、已验014内部实现均不在默认修改范围。014若需新增接线hook必须单独准确附录，不能以“消费端”名义重写。只允许测试seam/API明确新增的私有能力。

## 私有端口合同（均PROPOSED，不是现有API）

|owner/拟API|输入权威与事务线性化|重放/失效/释放|
|---|---|---|
|S01 createSelectionAuthority(revisions)→owner/epoch/business三个面|一个RevisionStore连接与一个唯一owner；scope/permit由Host受信构造，不能传rawDB或浏览器JSON；方法形态沿原S01 CONTRACT|同连接重复owner拒绝；epoch/CAS/namespace错误fail closed|
|ProjectCreationStore constructor-only installBootstrapSelection(binding)|原store在原事务scope创建一次性BootstrapInitPermit；origin后、最终guard前调用initializer，调用前标已消费|rollback不复活permit；committed replay不init；调用者commit(input)不能带hook|
|CreatedNativeSelectionMapper.mapSelection(existing input)|实现现有NativeSelectionMappingPort，独立读取已验committed producer/clip/frame事实；NativeObservation必须先acceptMapping COMMIT|临时reader/proof lease在finally释放；不能用浏览器label/序号猜shot|
|NativeAckCommitAuthority.issue(verifiedRound)→opaque permit|只接受原Observation的issued round+Expected proof，绑定原DB/owner/profile/session/ref/generation/epoch+CAS/commit/control/source；不是结构对象|单次permit、同round重复不增Ack；foreign/old/clone拒绝，失败不得用旧permit重试|
|NativeAckStore constructor-only createdAuthority；record(input,privatePermit?)|record公开wire input不增字段；created项目由原DBorigin判定，事务内创建opaque同步AckWriteScope，在原INSERT前validate/consume；输入caller不能传scope/callback/rawDB|created缺permit拒绝；legacy无该要求保持原行为。permit预消费后SQL失败需新round；已提交同permit重放返回同历史record，不分配新ack_seq；同nonce异input拒绝|
|CreatedNativeContextPort.acquireRead(projectId,caller)→ReadLease|拟新增Host私有read face；lease包含NativeContextFacts及绑定token，持有实际Expected/selection读资源|assertCurrent()在原Context同步事务最后、返回前调用；release()在finally全attempt；source或CAS变化即不loaded；失败/释放错误保全原始原因|
|ProjectContextService constructor-only createdReadPort|created分支不再用native??0；旧NativeContextPort.read仅legacy；未知authority返回既有CAPABILITY_UNAVAILABLE，已知epoch未证mapping返回unknown/null selection/no live Ack|所有异步读取后比较sameepoch+CAS/source/session/owner；cached loaded也需要每次lease末端guard|

Ack permit与ReadLease的issuer、validator、consume都放同一个Host私有工厂/WeakMap；wire DTO、浏览器、SQLite一行shape都不能mint。同步最终guard不得await或调用外部用户callback；如果与实际014签名不符，最终重锚时改此表，不在执行时凭空猜。

## 真实public review/prepare/apply生产链

1. 原task生产SOURCE_ONLY prepared source，CreatedPreparedSourceStore/原task store提供同project/run/execution/fact及immutable staged files。仍未author commit。
2. CreatedPreparedReviewPublication（拟新类，位于created-review-publication.ts）取得真实PreparedSourceProofPort，调用现有src/host/render/preview-prepared-source.ts::PreparedPreviewService.preview，实际生成五part对象和PreparedPreviewReceiptV1；objectRoot与author/stage/native根分离，取消/失败保留真实清理证据。
3. 调用现有CreatedSourceChangeService.prepare取得impact/唯一D09 plan（原实现允许review_impact_prepare在正式批准前）。不反向伪造review来解锁impact。取得不可变receipt、impact后重验author/rights/run/step/selection；异步renderer不在SQLite事务内。
4. 在同一原ProductTransaction内：写实际part artifact与不可变receipt payload事实；调用FixedWorkflowService.publishReviewPackageInScope(tx,input,caller)；调用prepared.bindPackage；持久记录package/receipt对应。只能一份package身份、同一receipt digest，不能在memory Map授予binding。任何失败整笔回滚，外部已生成但未发表对象按其真实owned ID保全/清理，不宣称SQLite回滚删除媒体。
5. 新模块实现现有ReviewMediaBindingPort.currentPart/currentByReference，每次从当前run/package、prepared binding与不可变receipt重验，供现有ReviewMediaHttp和PreparedReviewMediaReaderImpl使用。缺receipt/跨package/version/object/rights/session则不返回media。原CreationApplication #reviewMedia当前缺bindings，此处必须真实装配。
6. 原trusted UI通过既有review.read/decide及workbench session确认；配置真实CreatedRunAuthority.prepared依赖，而不是只传sessionGuard。FixedWorkflowService/CreatedRunAuthority在原事务写真实confirmation与approval；browser不能直接写state=accepted，driver/native_bridge不能伪造trusted UI。
7. 原ApplicationDispatcher装配现有change.prepare→上面的真实publication编排、change.apply→CreatedSourceAdoptionService，经过原approval/impact/lock/source/base与S01最终检查。startup recovery未完成不得开放采用；原闭合commit仍是唯一revision+1路径。原OperationIdempotencyStore与真实receipt决定重放，不重新渲染或另造Job。

### 拟receipt payload存储合同

拟在新模块中新增同原DB的不可变内容事实表created_review_publication；不新增审批权威、第二DB或修改cp_a0。主键prepared_source_id关联既有prepared source，唯一(project_id,package_id,package_version)；字段包括schema_version=1、project_id/run_id、package_id/version、receipt_digest、canonical receipt_json、input/output/rights digest、原producer/job/attempt标识、created_at。code重算receipt_digest与现有schema validator，严格校验JSON/整数/身份；immutable触发器拒绝UPDATE/DELETE，同请求只逐字段相等重放。媒体路径仍来自receipt中的opaque object_id，不能从caller传绝对路径。

这是新增私有schema提案，最终开工前必须给出逐字SQL+schema/独立migration marker指纹、同库原子install与损坏拒绝case，独立审定后才列入ReleaseAssignment；不允许constructor偷偷建表或用原cp_a0 schema comparator放宽绕过。此内容事实只补全现有prepared package binding的receipt preimage，不取代package/current run/approval的权威。

W2可先做mapper/Ack/Context component evidence；S01-P01、A/H完整生产路径、HC06/07/11/13/J04必须待本链真实前置形成后联合验收。任何生产前置缺失仍NOT_RUN，不用测试fixture的accepted policy/直接SQL充当它。
