# PROPOSED：精确路径、私有端口与真实生产链

DRAFT_NOT_RELEASED。不存在的模块/方法明确是拟新增；014接口需接受冻结后绑定。下面是下一实施释放的候选清单，不授予当前writer越界权限；原HC_NATIVE_PREREQUISITE旧reader/mapper文件名不作为新allowlist。

## 路径与owner

|施工包|拟新增路径|拟修改已有路径|边界/责任|
|---|---|---|---|
|W1|src/host/agent-driven/created-native-selection-state.ts|src/host/projects/project-creation-store.ts|单Claude；只新增S01同库私有DDL与constructor bootstrap绑定，不改九字段commit|
|W2|src/host/m5/created-native-selection-mapper.ts；src/host/agent-driven/created-native-commit-permits.ts|src/host/m5/native-observation.ts；src/host/m5/native-ack-store.ts；src/host/agent-driven/project-context-service.ts|mapper目前只有NativeSelectionMappingPort接口，实施文件并不存在；新增实现复用已验reader/facts|
|W3|src/host/agent-driven/created-review-publication.ts|src/host/agent-driven/creation-application.ts；application-dispatcher.ts；created-run-authority.ts；created-prepared-source-store.ts|新模块包含preview publication编排、immutable receipt payload存储与media binding resolver，不另建审批/Job系统；同一writer|
|W3媒体授权接线|无新公开route/DTO|src/host/agent-driven/review-media-http.ts；src/host/agent-driven/agent-http-router.ts；src/host/agent-driven/creation-application.ts；application-dispatcher.ts|由真实鉴权上下文签发私有请求能力，逐await后的同步最终guard；准确合同见下文rev7；不能只替换binding resolver|
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
5. 新模块实现现有ReviewMediaBindingPort.currentPart/currentByReference，每次从当前run/package、prepared binding与不可变receipt重验，供ReviewMediaHttp和PreparedReviewMediaReaderImpl使用；binding resolver本身没有caller参数，不能因此宣称已完成session检查。必须同时完成下述rev7受信read-scope/transport接线。缺receipt/跨package/version/object/rights/session则不返回media。原CreationApplication #reviewMedia当前缺bindings，此处必须真实装配。
6. 原trusted UI通过既有review.read/decide及workbench session确认；配置真实CreatedRunAuthority.prepared依赖，而不是只传sessionGuard。FixedWorkflowService/CreatedRunAuthority在原事务写真实confirmation与approval；browser不能直接写state=accepted，driver/native_bridge不能伪造trusted UI。
7. 原ApplicationDispatcher装配现有change.prepare→上面的真实publication编排、change.apply→CreatedSourceAdoptionService，经过原approval/impact/lock/source/base与S01最终检查。startup recovery未完成不得开放采用；原闭合commit仍是唯一revision+1路径。原OperationIdempotencyStore与真实receipt决定重放，不重新渲染或另造Job。

### 拟receipt payload存储合同

拟在新模块中新增同原DB的不可变内容事实表created_review_publication；不新增审批权威、第二DB或修改cp_a0。主键prepared_source_id关联既有prepared source，唯一(project_id,package_id,package_version)；字段包括schema_version=1、project_id/run_id、package_id/version、receipt_digest、canonical receipt_json、input/output/rights digest、原producer/job/attempt标识、created_at。code重算receipt_digest与现有schema validator，严格校验JSON/整数/身份；immutable触发器拒绝UPDATE/DELETE，同请求只逐字段相等重放。媒体路径仍来自receipt中的opaque object_id，不能从caller传绝对路径。

这是新增私有schema提案，最终开工前必须给出逐字SQL+schema/独立migration marker指纹、同库原子install与损坏拒绝case，独立审定后才列入ReleaseAssignment；不允许constructor偷偷建表或用原cp_a0 schema comparator放宽绕过。此内容事实只补全现有prepared package binding的receipt preimage，不取代package/current run/approval的权威。

W2可先做mapper/Ack/Context component evidence；S01-P01、A/H完整生产路径、HC06/07/11/13/J04必须待本链真实前置形成后联合验收。任何生产前置缺失仍NOT_RUN，不用测试fixture的accepted policy/直接SQL充当它。

## rev7：NW6-A01 媒体请求授权与交付最终门（拟增私有接口）

此处是W3目标，不是057已有API，不是060代码release。最终范围明确包含 `src/host/agent-driven/review-media-http.ts` 的窄接线，及同目录 `created-review-publication.ts`、`creation-application.ts`、`application-dispatcher.ts`。不重写底层媒体reader/renderer、public DTO或原审批。

`CreatedReviewReadAuthority` 拟内聚于新publication模块，唯一由CreationApplication构造，使用同一真实ScopedAgentAuth、owner/run/package/prepared/publication原DB与S01读面。拟私有合同：

- `IssuedReviewReadRequest` 是经真实认证后由装配层私有WeakMap签发的对象；记录实际AgentPrincipal引用、真实channel/session_ref及project、认证方式与本次请求生命周期。issuer只在既有HTTP鉴权成功或dispatcher已认证的内部路径签发；不能从describe的结构化caller三字段或wire JSON补造。HTTP的headers/凭据不进入public错误、receipt、日志或SQL。原`isPrincipalActive`只在已签发能力对应的真实principal上使用，不把它当结构对象可自行授予授权的issuer。
- `acquire(request: IssuedReviewReadRequest, binding: ReviewMediaBinding, signal?) -> Promise<ReviewReadScope>`：校验本issuer、当前请求和项目归属，持有需要的真实S01读租约，绑定当前run/package/version/digest、receipt/object/rights、两份marker及完整schema事实。异步acquire结束仍需最终门，不能把捕获时快照当永久授权。
- `ReviewReadScope.assertCurrent(): void`：同步、只读；核对真实session仍有效（非native_bridge）、当前owner、同run/package/part/object、publication canonical/重复列、双marker和namespace、持有S01租约的最终有效性。需要新鲜DB读取时，在同一原连接的短只读事务内完成一致快照核对；不跨await持有SQLite事务，不创建/修复记录、不render，不调用用户callback。每次调用重新核验，不缓存PRAGMA schema_version代替marker DML。拒绝字面码依现有HTTP合同，最终release逐项锁定。
- `ReviewReadScope.prepareFinish(): Promise<ReadyDelivery>` 排空raw read、媒体handle.close与异步辅助清理，但保留真实S01 guard租约及其所有最终依赖、预算、DB；`finishAndDeliver(ready, ownedSink): void` 在仍held时同步最终复核、执行可检查的同步终端释放，然后同一调用栈交付。只允许既有Host transport sink；不是wire callback。取消走`abortAndDrain(): Promise<void>`，未交付就永久拒绝交付，真正排空再释放。完整合同以rev8选定方案为准，删除先release再复核的方案。

transport的`describe`、`openMedia`与HTTP GET都必须携带该真实请求能力；不能仅保留现有binding port并声称自动获得session。created分支缺此能力/authority直接拒绝；legacy按原界限保持，不能因此把created降级到legacy。公开RPC/body不增回调、principal、raw DB或授权字段。ApplicationDispatcher与CreationApplication的内部调用明确传入该能力，不能由调用者三字段伪造。

具体交付顺序：

1. 校验auth/Origin/请求语法在资源查找前；binding await、scope acquire、reader.open以及最后binding重读之后，均同步调用scope最终门。取得descriptor不等于已交付。
2. describe先形成候选descriptor，再由prepareFinish真正排空媒体close和异步辅助清理，但不释放最终S01 guard租约及其依赖；候选与私有ReadyDelivery跨dispatcher await仍由同一authority持有。最终HTTP response边界调用finishAndDeliver，不能把业务方法return误认成交付。不得先完整release后再拿失效lease或旧facts复核。
3. openMedia交付的私有handle在返回前检查；每次bounded read前及raw read await后再检查。仅返回一个检查过的Buffer不能替代最终transport的交付门。私有handle额外携带该authority可识别的同步 `assertCurrent()`，由CreationApplication实际delegate和HTTP在每次最终写/返回前调用；不加到wire DTO。
4. HTTP发headers前、每个read await后且response.write前、每次backpressure await后、最终response.end前重新检查；guard与对应交付之间不得另有await。backpressure前已写入socket的字节无法撤回；只承诺检查线性化后不再新增陈旧交付。跨进程外部修改与socket写入不存在本票可声称的原子事务，禁止宣称能撤回在途字节或密码学实时撤权。
5. 任何scope失效、取消或close错误：不再新增descriptor/字节交付；headers前沿既有错误合同拒绝，headers后终止该响应。所有已启动raw read和descriptor close真实排空；不吞close失败冒充成功。已交付handle由请求操作唯一负责最终close/release，重复close等待同一settlement；stop admission后仍保留DB/authority直到所有接受项完成，DB最后关。

PUB-RD01新增窗口矩阵仍用原编号：真实binding await、scope acquire、reader.open、最后binding重读、bounded read、socket backpressure、describe的descriptor close及prepareFinish异步排空；每个窗口分别撤销实际请求session（owner/package不变）、换package/run/rights、marker DML（schema_version不变）。断言陈旧后无新交付、GET零写零render、所有raw read/close排空及DB最后关闭。零变更对照成功；仅换同owner另一session不得恢复旧请求。双marker/原像损坏映射PUB-DB02，实际transport映射NW-API03，停服映射S01-L01/L02。所有运行当前NOT_RUN。

## rev8：NW7-A01 选定两阶段终端合同

MAIN选择“异步排空，保留真实最终依赖；同步复核/终端释放/交付”，不采用release后重acquire或旧facts自证的分支。下面覆盖rev7不明确的finalization，仍全部PROPOSED/NOT_RUN。

### 真实资源与状态

`OPEN → PREPARING → READY → DELIVERED`；异常/取消进入`ABORTING → CLOSED_FAILED`，清理未证为`CLEANUP_REQUIRED`。ReadyDelivery由本authority私有WeakMap签发，绑定同request/scope/candidate/transport，不接受外部shape、nonce或PID。一个scope只有一份terminal promise；同prepare重复返回它，重复finish不再次写响应/释放，取消后finish拒绝。

- OPEN/PREPARING：原请求能力、真实S01 guard lease、其持有的native/source/selection依赖、预算和DB均保留。prepareFinish先停止该scope新raw read，等待实际在途read，关闭media descriptor，排空所有异步probe/辅助owner；这些步骤不能释放最后guard lease的依赖来伪造READY。
- READY：media handle已真实close，所有剩余资源都可由明确同步终端动作释放。原S01 guard lease及它的全部最终依赖仍held，不能只留valid标记。prepareFinish期间任何raw close失败进入失败路径，不签发ReadyDelivery。
- 最小拟受审私有hook为 `S01MediaGuardLease.prepareTerminal(): Promise<S01ReadyTerminal>` 与 `S01MediaGuardLease.finishTerminalSync(ready): void`，由拟新增的created-native-selection-state.ts/created-review-publication.ts同一owner接线提供，不修改旧generic lease合同、不向wire开放。prepareTerminal不释放最后guard实际依赖；finishTerminalSync先真实assertCurrent，再逐一同步关闭剩余held FD/lease/预算并检查每个结果，标记一次终端完成。不得在该同步阶段启动Promise、异步close/probe或用户回调；若实际接受后的依赖只能异步释放，不能假造同步成功，须在最终ReleaseAssignment前补足该依赖的专用两阶段hook并再独立审查，未满足则不release。
- `finishAndDeliver(ready, ownedSink)`只由受信transport调用：先验证ready issuer/状态/请求与真实S01依赖；在原DB短只读一致快照内完成新鲜session/owner/package/receipt/rights/双marker/namespace检查及同步S01末端guard；然后执行同步终端释放，任一步失败不调用sink，保留primary与cleanup原因。所有结果可检查后，调用已注册的Host同步sink一次，sink只能序列化已校验的候选并调用response.write/end，不接受Promise或用户函数。最终检查、终端释放、调用sink之间没有await、事件循环让步或外部业务callback。不能在终端已释放的lease上再调用assertCurrent。
- 线性化点是最后仍held时的同步guard；同步释放与同调用栈交付之间无可观测异步窗口。跨进程外部DB/文件改变与socket不承诺原子化；这是已声明边界，不能由该设计声称撤回在途字节。
- sink抛错或socket已关闭不得重试交付；终端资源已释放保持一次，不复活能力。异步abortAndDrain只用于未交付分支，raw任务真实排空后释放；任何未证清理保留owner与DB依赖，不能deadline强制关闭数据库。Host lifecycle账本跟踪所有scope至真实终端；DB最后关。

### 候选跨dispatcher与最终response接线

明确新增窄修改 `src/host/agent-driven/agent-http-router.ts`，不修改public ApplicationPorts/DTO。拟内部 `invokeForTransport` 为受信created审阅分支返回 `OwnedReviewDelivery`（候选wire value、私有ready capability、authority）；该对象不能通过wire序列化。路由先按原validator验证候选output，然后在真正send边界调用其finishAndDeliver，调用的sink只接收已验证output。普通dispatcher.invoke及legacy行为保留，但created describe缺该内部completion协议必须拒绝，不能静默走原无guard send。CreationApplication/dispatcher/HTTP由同owner共享能力；外部调用者不能提供sink或伪造ready。

openMedia/HTTP流的OPEN阶段在每次bounded read返回/每次背压等待后由仍held的scope同步assertCurrent，随后同调用栈写该chunk；交付私有handle之前也检查。终端prepareFinish/finish在流结束前进行，最后response.end仍由同一finishAndDeliver控制；已交付chunk不能撤回。describe关闭media descriptor后才READY，跨dispatcher的候选尚未对客户端可见。

### 必须增加的实际证明

PUB-RD01/NW-API03/S01-L01/L02保留原矩阵，新增：零变化完整prepare→READY→finalize→send成功；prepare期间真实S01依赖/FD/预算仍held；guard或同步终端释放失败零sink调用；取消后ready失效；重复prepare/finish/abort不重复close/写；候选跨dispatcher await期间撤session/换包/改marker/S01失效拒绝；用实际路由而非直接调业务方法证明最后response门。单独测试每个原依赖若无同步终端能力必须在release前拒绝接线，不能只让正常对照一直失败。运行全部NOT_RUN。
