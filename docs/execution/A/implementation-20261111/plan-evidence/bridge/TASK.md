# A-R1-BRIDGE 聚焦任务单

2026-11-11。状态：PREFLIGHT_COMPLETE / PREPARED_NOT_RELEASED。仅任务准备完成；implementation NOT_STARTED，所有本票业务验收 NOT_RUN。

## 现场基线与授权

- 实际目录：`/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-BRIDGE`。
- 实测 HEAD / 本票 base：`9f583239714835a89332fcae9363aa39d887821d`。
- contract SHA：`ca5b67a8285b130c79055317c6202f73cfbb99c8`；合同文档 SHA：`f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450`。
- cp-a0-r4 candidateLock：`9d1b12f302bb15922e0586c19e39bcddb1b52eab96c80e25b53ad1c0297e0029`。
- preparation manifest 实测：`2a847488f59259b196caeb22e0407327583fed6985516ed16fa9bf9a87aad0c0`，与 ReleaseAssignment 相符。
- 初始 dirty 仅 `?? docs/parallel/lane-bridge/A-R1-20261111/ReleaseAssignment.json`，MAIN 提供；未改其字节。
- owner=bridge-Codex；当前唯一 writer=bridge-Codex，仅 TASK.md、HANDOFF.md、CLAUDE_IMPLEMENT.md；未来 bridge-Claude 尚未启动/领取写权。
- 实际任务 task_20b0c703b577 / ctx_f95ca4adc643；当前窗口 term_a584ae0a-6ca5-4f80-aa33-f0905471716f，MAIN term_a731c232-35c7-4f55-a75d-9b2beeade398，run_399f9dd3ce5a。

用户已授权 A 实际开发，覆盖旧暂停文字；本 dispatch 只释放三份文档。D01–D15全部沿用，sealed relaunch 包不改。MAIN 发放 RELEASED 与唯一 writer 交接、凭据事件处置确认前不调用 Claude；本票不授权 Codex实现、不启动其他worker。

## 字节核对

四冻结文件已逐项计算 SHA256，与 contract-freeze.json 一致（只读比较，不是合同测试运行）。

|文件|现场 SHA256|
|---|---|
|`contracts/agent-driven-a.schema.json`|`088a451e9646199618261a6cc95a84e3767dbf4cc87004f3e5995dda86b60964`|
|`contracts/agent-driven-a.registry.json`|`05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f`|
|`src/contracts/agent-driven-types.ts`|`54356697802c0bf048e5cbcde1f54eb33713d4fe58943b346406804011cb3644`|
|`src/contracts/agent-driven-validator.ts`|`f11a68bad982b7914e73f396ce48e99195ffc8fa88e842f137ffabf31900ea73`|

附属设计件当前 SHA256：

- `contracts/asset-inventory-v1.schema.json`：`45e1978432fbf26aa5afdd5b37986384bf074794cabb65b2a2f9ca6d171d6428`。
- `contracts/asset-inventory-v1.registry.json`：`f326e0d7da655d4427f086c80ee9bd1af108672cedfdd8ad2dd8c91774d3a406`。
- `contracts/review-media-v1.registry.json`：`77290e4376ec013e0f7f75f8e6fccf02d1dede0a03623a4527280d75dfb8212e`。

R0 decision 当前为 scope-only PASS、0 blocker/0 major/1 minor，MAIN 已记录 tsc exit0、8文件123测试 exit0、Python10 vectors无失败；本票未重跑、不继承为产品PASS。R0-M01 原报告为 implementation-20261111/R0/independent-current-byte-review.md；下述修复只针对该已知进度一致性缺陷，不重复完整R0审查。

## 用户路径与精确R1边界

ENTRY/HOST/FACTS：外部 MCP/HTTP → 同 CreationApplication → 真 facts/可信确认 → 原 workflow/TaskStore/Worker → Job/context/events 同事实；可信 UI 登记本地素材 → 附属库存 HTTP/MCP resource → MEDIA 权限消费；附属 review-media 仅接已证读取端口。

四真实能力未齐保持 CAPABILITY_UNAVAILABLE/blocked，不给永远 queued 的202。R1可交付拒绝路径及可联调端口，不要求提前实现R2采用或R3最终发布。不开 created adoption/publisher/FixedPhaseExecutor/final QC/Delivery；不把 prepared 当 committed，不提供假的result_ref或NativeAck。TrustedAdoptionAuthority 的 confirmation 生产适配在本票，registerApproval 在缺少真实当前impact/包/同事务权威时返回null而不造批准；实际采用激活留R2。

## 计划修改文件

ReleaseAssignment 的54路径是未来上限，均属于03的bridge-Claude；本票聚焦计划45路径（30已存在、15拟新增），不是要求无理由修改每个文件。以下清单为准确拟实施子集，只有未来release及交接后可写；当前产品写权为零。

### 已存在（复用，只补确定接缝）

- `src/host/server.ts`
- `src/host/agent-driven/creation-application.ts`
- `src/host/agent-driven/application-dispatcher.ts`
- `src/host/agent-driven/project-context-service.ts`
- `src/host/agent-driven/created-task-store.ts`
- `src/host/agent-driven/created-task-gate.ts`
- `src/host/agent-driven/created-task-worker.ts`
- `src/host/agent-driven/local-asset-registry.ts`
- `src/host/agent-driven/product-sqlite-repository.ts`
- `src/host/creative/fixed-workflow-service.ts`
- `src/host/projects/revision-store.ts`
- `src/host/agent-driven/start-runtime.ts`
- `src/host/agent-driven/observation-cursor-ports.ts`
- `src/mcp/mcp-server.ts`
- `src/mcp/host-application-ports.ts`
- `src/mcp/host-error-mapping.ts`
- `src/mcp/stdio-main.ts`
- `skills/narralens/SKILL.md`
- `tests/agent-driven/integration/host-application.test.ts`
- `tests/agent-driven/integration/host-close-lifecycle.test.ts`
- `tests/agent-driven/integration/creative-context-host.test.ts`
- `tests/agent-driven/integration/created-task-store.test.ts`
- `tests/agent-driven/integration/created-task-gate.test.ts`
- `tests/agent-driven/integration/created-task-worker.test.ts`
- `tests/agent-driven/bridge/mcp-host-client.test.ts`
- `tests/agent-driven/bridge/mcp-registry.test.ts`
- `tests/agent-driven/bridge/mcp-stdio-client.test.ts`
- `tests/agent-driven/bridge/cursor-events.test.ts`
- `tests/agent-driven/product/fixed-workflow-service.test.ts`
- `tests/agent-driven/product/execution-guard.test.ts`

### 拟新增（当前不存在）

- `src/host/agent-driven/created-run-facts.ts`
- `src/host/agent-driven/created-run-authority.ts`
- `src/host/agent-driven/created-task-application.ts`
- `src/host/agent-driven/local-asset-http.ts`
- `src/host/agent-driven/asset-inventory.ts`
- `src/mcp/asset-inventory-resource.ts`
- `contracts/agent-local-assets-v1.schema.json`
- `contracts/agent-local-assets-v1.registry.json`
- `src/contracts/agent-local-assets-types.ts`
- `src/contracts/agent-local-assets-validator.ts`
- `tests/agent-driven/integration/created-run-authority.test.ts`
- `tests/agent-driven/integration/local-assets-transport.test.ts`
- `src/host/agent-driven/review-media-http.ts`
- `tests/agent-driven/integration/review-media-transport.test.ts`
- `tests/agent-driven/integration/created-schema-upgrade.test.ts`

上限中暂不计划改动的9项（保留只读消费；如确定必须改先向MAIN说明delta）：

- `src/host/agent-driven/committed-snapshot-authority.ts`
- `src/host/creative/execution-guard.ts`
- `src/host/creative/product-repository.ts`
- `src/host/projects/project-creation-store.ts`
- `src/host/projects/project-coordinator.ts`
- `src/host/projects/project-resolver.ts`
- `src/host/impact/impact-store.ts`
- `src/launcher/workbench-entry.ts`
- `package.json`

不得写 MEDIA processor/verifier/render 或其测试、PRODUCT UI/native、persistent-job-store.ts、其他未列路径；不得改四冻结文件/冻结SQL、lockfile/vendor/旧Gate。新增素材合同是已审附属设计映射，非修改原31路由。当前也不改索引/分支/commit，不安装依赖、不跑测试/构建/Host/媒体/浏览器。

## 实际接口与接线

|生产者 → 消费者|当前事实 / R1具体工作|
|---|---|
|CreationApplication → FixedWorkflowService|当前 `new FixedWorkflowService({repository})` 无facts/adoption，dispatcher只读workflow/run；复用同ProductSqliteRepository/CreativeProjectAuthority，注入created-run-facts/authority并接已有workflowHandlers，保owner校验|
|ProductFactPort.readProjectFacts(projectId) → prepareRun/guard|既有ProductProjectFacts含project/revision/control/source/snapshot、rights_authorized/reason、capability_available/fingerprint/reason；从同RevisionStore/当前asset row+bytes读，不能读客户端布尔；capabilityFingerprint仅校验4个RuntimeCapabilityDescriptor，不证明运行就绪|
|TrustedAdoptionAuthority → authorizeRun/review|既有registerConfirmation(tx,input)及registerApproval(tx,input)同步同ProductTransaction；使用真实ScopedAgentAuth会话/actor/purpose/范围/期限，driver relay只content_only；不能拿fixture authority投入生产|
|CreatedTaskStore → processor/CP|现有assertAllowed、bindStep、assertPrepared同步hook和TaskTransactionDb；repo.joinTaskTransaction接workflow.recordStepAttemptInTransaction；单连接，thenable/抛错整笔回滚；不新增第二Job/队列|
|CreatedTaskApplication（拟新增） → Job/context|装配现有gate/store/CreatedDraftTaskProcessor/PreparedDraftVerifier/worker；共用receipt resolver服务job.read和ProjectContextService，保creation Job兼容；job.cancel与run.cancel按原reservation/lease绑定收敛|
|Host.listen/close → application/worker|专属recover先generic；每tick动态合并creation+task exclusions；close拒新写→停止dispatch→await worker及processor/verifier资源→assets/native→DB，保closeAfterNative生命周期|
|LocalAssetHttp（拟新增） → LocalAssetRegistry.import → inventory|采用已审RegistrationRequest；UI仅candidate/source/license/origin，Host算sha/相对路径/63字符attestation；成功同key先receipt重放再候选TTL，异body409；GET无登记/编码/源写；rights Ref查同project row+bytes+许可|
|AssetInventoryResource（拟新增） → owner HTTP inventory|独立resource `narralens://projects/{id}/local-assets`；31原HTTP+5附属HTTP/+1resource分别计数，原registry不改；32默认/64上限、900秒绑定cursor|
|MEDIA PreviewPreparedSource → ReviewMediaHttp → PRODUCT播放器/Agent|设计已规定opaque ref→真实package/version/input/output/quality/producer attempt+已证FD；owner-scoped driver或trusted_ui read-proof，native_bridge拒绝；Range/断流/416/error关闭自有FD，GET不启动producer；缺producer503，未知ref404/漂移409|
|observation snapshot/cursor → MCP/UI|同水位同generation/filter，重连不重提任务；保Job完成/commit/NativeAck分离；PRODUCT native观察尚未接入时unknown/unconfirmed|

## R0-M01最小实施与真实回归

现代码worker finally在关闭时只调用 jobs.releaseLease；processor已把step/checkpoint写running，recover只扫描expired running/cancel_requested，所以重开前queued Job与running CP分裂。必须在R1生产worker注册前修复。

在BRIDGE拥有的store新增同步同DB graceful-release composition，并从worker/CreatedTaskApplication适配调用：仅匹配仍有效owner+lease attempt+running Job，在同事务释放lease回queued并用既有repo/workflow受限事务将对应step/checkpoint置pending及必要事件；回调失败/thenable全部rollback。保用户cancel_requested分支走真实processor.failed取消收敛；旧lease/已完成job不改，不把正常关闭写失败。不要仅更新job或仅改checkpoint，不重写scheduler。

原真实processor由MEDIA拥有，优先在BRIDGE的application adapter实现release组合，不要求越owner修改其接口。回归放已授权host-close-lifecycle.test.ts/created-task-worker.test.ts，复用真实processor+ProductSqliteRepository+FixedWorkflowService及真实CP行，不用fixture processor冒充：在before_prepare录running后暂停→worker.close→边界返回→await cleanup→核queued/null lease、pending step与checkpoint、事件恰一次→关闭并重开同隔离DB但先不启worker核durable事实→recover不重复结算→resume原job成功且execution attempt不混新lease attempt；author/revision/source保持。同时cancel/旧lease反例。不需修改MEDIA的created-draft-processor.test.ts，后者可作为授权后只读回归底座。

## MAIN需要收口的具体接线依赖（不重议D01–D15）

1. MEDIA→BRIDGE review-media：语义和owner已冻结，当前 `preview-prepared-source.ts` 尚不存在，无可导入的真实FD reader签名；请MAIN在MEDIA交付时给准确export/入参/返回descriptor/幂等close及错误映射，与本票review-media-http消费者对齐。R1可先交fail-closed适配，不能伪造package/ref或为了读路径抢做R2包发布。
2. MEDIA实际四能力→created-run-facts：已有RuntimeCapabilityDescriptor(id/version/implementation_digest/configuration_digest)，但真实producer readiness/manifest供给入口当前未装配；请MAIN统一实际manifest来源和调用句柄后再激活。R1不要求R2–R4提前完成，缺任一能力保持不可用，禁止把hash存在当可执行。
3. R0-M01上面的store/application adapter路线不改MEDIA processor；若实际实现确实需要改变processor public接口，由MAIN明确跨lane签名/owner交接后再做，不能两lane并改。真实CP测试所需工具/素材fixture/重型slot由MAIN给，当前无预约。

以上是生产者交付/消费者绑定事项，不另设独立模块审计门；不影响完成本票准备或release后无依赖的fail-closed实现。

## 逐case与实施后命令（当前全部NOT_RUN）

所有命令cwd为本票实际目录；MAIN先提供已存在工具依赖、独立node_modules/var/dist/DB/staging/profile/端口，不共享可写运行根。工具版本本票未执行；未来须确认Node>=22.15.0与已缓存corepack pnpm10.33.0，无安装提示获准。不可自动下载。

|已有case|R1断言/计划落点|命令|
|---|---|---|
|BR-A-01/03/NEG1|缺任一真实能力拒绝且Run/Job增量0；真实session confirmation、relay拒绝；host-application/created-run-authority/fixed-workflow-service|C-R1/C-AUTH|
|BR-A-02|同key恰1 Job/step/event，异key同attempt及hook失败/thenable rollback；created-task-store|C-TASK|
|BR-A-04|仅接既有SOURCE_ONLY proof/receipt，不注册采用；真实processor regression；result_ref未发布null|C-TASK；MEDIA真实fixture由MAIN预约|
|BR-A-06/07/08 + R0-M01|真实关闭/同库重开/原job续跑、cancel/失lease/耗尽、动态reaper排除、DB最后关闭；host-close-lifecycle/worker/store|C-R1/C-TASK，真实多Host/媒体需MAIN slot|
|BR-A-09|job.read与context同task receipt，snapshot/cursor同水位；creative-context-host/cursor-events|C-R1/C-ENTRY|
|R6 / BR-A-01素材前置|登记重放跨TTL/restart/session/correlation；异body409无新asset，路径/symlink/跨owner/Ref.version/bytes漂移拒绝；local-assets-transport/mcp-registry|C-READ/C-ENTRY|
|D03只读 transport|权限/包scope/Range/416/断流/FD关闭/bytes漂移/无副作用；review-media-transport|C-READ，真实producer缺席记NOT_RUN/blocked|
|D13兼容子集|当前R1实际新增namespace与旧库重开保持cp_a0 fingerprint；不创建未来R2/R3表|C-READ（created-schema-upgrade）|

```sh
# C-TASK
corepack pnpm test tests/agent-driven/integration/created-task-store.test.ts tests/agent-driven/integration/created-task-gate.test.ts tests/agent-driven/integration/created-task-worker.test.ts --maxWorkers=1 --minWorkers=1
# C-R1
corepack pnpm test tests/agent-driven/integration/host-application.test.ts tests/agent-driven/integration/host-close-lifecycle.test.ts tests/agent-driven/integration/creative-context-host.test.ts --maxWorkers=1 --minWorkers=1
# C-AUTH (created-run-authority.test.ts拟新增，其余已存在)
corepack pnpm test tests/agent-driven/integration/created-run-authority.test.ts tests/agent-driven/product/fixed-workflow-service.test.ts tests/agent-driven/product/execution-guard.test.ts --maxWorkers=1 --minWorkers=1
# C-ENTRY
corepack pnpm test tests/agent-driven/bridge --maxWorkers=1 --minWorkers=1
# C-READ (三文件均拟新增，创建后才可执行)
corepack pnpm test tests/agent-driven/integration/local-assets-transport.test.ts tests/agent-driven/integration/review-media-transport.test.ts tests/agent-driven/integration/created-schema-upgrade.test.ts --maxWorkers=1 --minWorkers=1
corepack pnpm exec tsc --noEmit
corepack pnpm test:contracts
```

保留已有ACCEPTANCE C4 processor/source-digest真实回归为MAIN与MEDIA预约项；不在此重跑R0全量。实际首端Codex stdio→Host业务、重开进程和真实MEDIA证据另由MAIN组合调度，不以SDK stand-in或probe-mcp发现替代。build/check/浏览器/ffmpeg多Host均MAIN单重型槽；无预约不运行。BR-A-05采用、BR-A-10短片/双导出/T20/A人验属于后续阶段，当前NOT_RUN且不是R1前置要求。

每次验证保存实际SHA+dirty输入hash、cwd/命令/开始结束/exit/脱敏stdout stderr、job/CP/lease/event前后、文件hash及清理；关键负向必须能使旧违规路径变红。Claude自测→Codex冻结候选只读复核→MAIN组合，不自签独立审查或人工PASS。

## 停止、回退与交接

release未生效/凭据未处置/HEAD或合同漂移/未知dirty/owner冲突/需未列文件/运行根重叠停止相应写入并报MAIN；缺生产者仅阻该能力，保持fail closed推进无依赖范围。生产新路由/worker可关闭止新调用，保留原job/CP/prepared/原候选，未知写结果查原key；不reset/stash/删除历史或做破坏性DDL回退。

429须核实原Claude及子进程确实停止、记录未完成命令/dirty/lease后，由MAIN明确本票writer接手；不得仅据错误日志双写。超过两次阶段返工MAIN接管根因。Claude恢复默认不抢回；无新付费/外传/换provider/凭据读取。交付后停本票，不进入B。


## CR-R1-001 有界接口核对 ACK（2026-11-11）

本次 task_8cd3a33f139f / ctx_5efd36566044，窗口 term_3c66928ee6fc567f5c0a0fb486bb6d62；实际HEAD仍为 `9f583239714835a89332fcae9363aa39d887821d`。已实读canonical implementation-20261111下三件当前文件，绑定如下；不修改封存包或ReleaseAssignment。

- `CR-R1-001-INTERFACE-LOCK.md` SHA256 `a5694b60e86b07ba05495625310bdac18c6cdc30315e0bd4e4b046a570e42a1b`。
- `contracts/gateway-ui.registry.json` SHA256 `40af12a3bd4a6b0a2dba4aee7a4d4092b155a2352bf9b2fb790a34c8eab7d765`。
- `ownership-delta.json` SHA256 `8027fb4fd83eab107c140a7aea3e5a8c803c8e31a5898d4fdd82040f62367d06`。

结论：**ACK，无BRIDGE具体硬反例**；这是R1接口选择核对，不是产品独立审查或激活许可。原TASK/HANDOFF中“MEDIA FD reader准确签名待统一”的设计依赖由本CR第6节关闭；实现/真实producer可用性仍需后续证明，缺能力保持fail closed。

- 可信UI：仅CreationApplication真实trusted_ui native-open分支铸造Host-only闭包，捕获真实parent actor/session/project/generation；Gateway独立UI cookie/proof/map/expiry，逐调用及异步返回前重核parent/owner。当前NativeStudioGrant只有原native isCurrent/readWorkbench，新增可选ui由PRODUCT类型/传输持有、BRIDGE构造业务闭包，边界可接。不得复用当前native #collect/recheck的revision失效条件删除仍有效UI会话；commit后UI可读新Context，native仍stale。native cookie/proof/read_token、driver和请求JSON均不授UI权。
- RPC：严格surface/operation/input三字段和registry闭集，保原DTO完整校验、原status/body/错误；同project固定scope，未知字段/组合拒绝，不把allowlist中的未来change/delivery名当已实现handler。workbench.v1/native.reopen严格空input，提取复用现有native-open内部方法并validateNativeEntry，不添Host业务路由或授原生写。明确统计31冻结Host+5附属Host+2新Gateway；原CP31及四冻结文件不变。
- MEDIA proof：CompletedPreparedSourceV1由BRIDGE真实同库行构造；proveForRead/assertCurrentForRead仅impact/preview且无虚构批准，proveForAdoption/assertCurrentForAdoption另绑真实transaction/impact/approval/target，purpose弱映射互拒。成功SOURCE_ONLY不重新claim；异步证明之后仍在受控SQL边界同步复核当前权威，R1端口不代表R2采用通过。
- Preview receipt/reader：无反向package hash，BRIDGE在真实包建立时登记receipt_digest/object_id与package/part/attempt闭包；open(receipt,object_id,{signal})返回content_type/bytes/sha256/read/close，安全整数offset/length且单read≤1MiB。Host和Gateway复用同一已授权reader；MEDIA open失败释放FD，BRIDGE成功/断流/取消/416/异常finally关闭且close幂等。没有真实登记/producer就拒绝，GET不生成预览或登记。
- M5消费者：ACK复用原proxyRefs预览槽与PlaybackClock，review模式不向author seek/select；进入前用已有seek并pause在真实观测帧，退出/原timeline操作终止预览，Blob/request精确释放。第4节“receipt真实fps必须与clock匹配”是生产者/消费者必验要求，实施时必须携带可核真实fps并拒绝缺失/不匹配，不能猜帧率；未知native同步保持未确认。此处仅接口ACK，单clock/音频/焦点仍须真实Headless联调。
- 所有权增量准确为4个新增分配路径：BRIDGE `contracts/agent-workbench-ui-v1.registry.json`；PRODUCT `src/host/m5/controlled-studio-access.ts`、`src/host/m5/controlled-studio-browser.ts`、`tests/agent-driven/integration/created-native-ui-transport.test.ts`；既有 `src/host/m5/openfilm-studio-gateway.ts`仍PRODUCT。新增分配不等于文件均新建；不跨owner写。BRIDGE计划在原45路径基础上增加1项registry为46项，须由MAIN实际release纳入后才执行，不自行改ReleaseAssignment。

MAIN本次通知三lane依赖已从正确既有store离线准备成功且无package/lock变更，记为MAIN报告，未自行安装或复跑。后续case沿原R1测试补UI鉴权零副作用、commit后UI/native分离、read-proof不能apply、媒体scope/hash/Range/close；不新增整包审计门，不前置R2–R4。凭据处置与唯一writer交接门保持；Claude/子worker/代码实现/业务测试/重型检查均未启动，本次只追加TASK/HANDOFF。


## P-CR-01 / CR-R1-MEDIA-FPS 最终字段闭合 ACK（2026-11-11）

本次 task_516426954642 / ctx_a3b656343243，窗口 term_2f4784e8327ecb6df77b944b9f7d46da。已实读canonical CR-R1-001第8节、更新的gateway-ui.registry及本地ReleaseAssignment，结论 **ACK，无剩余具体反例**，仅关闭本字段缺口，不新增架构选择或产品审计门。

实际HEAD仍 `9f583239714835a89332fcae9363aa39d887821d`；本地assignment确为55个精确BRIDGE路径、PREPARED_NOT_RELEASED，包含新增workbench registry。接口/registry现场hash与assignment相符：

- CR第1–8节：`7e9b61b339d9cf2bc80c7925e09139f6362eeee6ecc373a2bd142d4be0f895b8`。
- gateway registry：`8416e1abeec71b4e063df53c9e4974ea4ab1bab3b8f1f5ddfc280f5b5261e54f`。
- 当前ReleaseAssignment：`99c687717891def6d0acd17ac7fc353224f6b933db42381a84d697f72c18cb59`。

确认producer receipt顶层timeline fps/frame_count与video实际probe有理fps、完整count/decode帧数一致，正整数/gcd规范化并入receipt_digest，VFR/不可证/与计划不符不发布成功；audio以真实sample_rate/sample_count/channels入同摘要，不能假冒视频fps。reader metadata、descriptor与实际object hash绑定，读取不渲染。

BRIDGE在既有POST RPC内实现闭集workbench.v1/review.part.describe，严格input={run_id,package_id,package_version,part_kind,artifact_ref}，project仅取独立UI delegate；复用Ref校验并核当前包/part完整Ref及不可变receipt/object关联，通过同一MEDIA reader.open取metadata并finally close。返回第8节精确PreviewMediaDescriptorV1，绑定package_digest、完整原ReviewPart、receipt_digest/object_id、type/bytes/sha、timeline与判别media_facts，不泄露路径/凭据/FD。既有native.reopen空input不变；无第三HTTP，仍31+5+2，不改冻结ReviewPart/CP31。

consumer先核全部包/Ref/版本/摘要及真实有理fps与原PlaybackClock，再读同对象binary、核quoted-sha256 ETag及blob bytes/hash后才ready；拒绝metadata到bytes间对象变化或旧包重用，不改变原clock/author/version。按既有review-media-transport及PRODUCT真实单clock验收补负向：25fps对30/1拒绝、伪报fps/缺帧数/错误包part或receipt/对象漂移拒绝、音频按样本事实验证、metadata和binary所有成功/失败分支释放FD。当前均NOT_RUN，不把设计ACK当行为PASS。

前次assignment/接口hash保留为真实历史观察，本节绑定新版本；原计划46路径仍位于更新55项上限内。PRODUCT23/MEDIA12为MAIN本次通知，不越owner核改其文件。仅追加TASK/HANDOFF；未改CLAUDE_IMPLEMENT、assignment、源码、索引或分支，未启动Claude/子worker/测试/重型检查。凭据处置与唯一writer交接/正式release门保持，R0仍scope-only，未进入R2–R4或B。
