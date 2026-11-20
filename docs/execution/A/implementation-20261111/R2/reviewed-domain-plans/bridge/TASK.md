# BRIDGE R2 — BR-A-REVIEW 与准入所需执行器基础

状态 PREPARED_NOT_RELEASED；本票仅文档。2026-11-12；MAIN msg_5e2a426c87c5、msg_4556de410db6。当前parent task_2b6d7608940d / ctx_12c54ee14b8e / term_024e4a8a774258bb008acddcc1180f68；run_399f9dd3ce5a。没有R2 Claude、代码或测试启动；所有以下验收 NOT_RUN。

观察源码是 immutable `de086f32c48c44fb72d0212ef80365f1c786408c`，由git show读取，不是本地HEAD。本地HEAD `5274a8aceb71c3c27d4617b597d6c88e428e8e6e`，R1两源dirty保留；共同release/base须MAIN后续实际准备，不自行merge/reset。R0 scope-only freeze9f583239714835a89332fcae9363aa39d887821d不等于当前产品PASS。canonical CONTINUE最新R1记录和R2/MAIN_RECONCILIATION.md/current-code-map.json已读取；MAIN报告R1范围通过不继承为R2/A通过。

## 目标与顺序

真实prepared→不可变ps_→五part ReviewPackage/receipt/object绑定→一次可信Decision/Approval→冻结change.*→窄guard→同Coordinator typed提交→CreatedSourceFact→PRODUCT真实NativeAck。prepare/accept不写source，adopt恰一次revision+1；成功SOURCE_ONLY Job不重新claim。原生未实测仍unknown。保持单DB、原queue/project_transaction、EnginePort七方法、strict409、单Studio/clock和cp_a0冻结空间。

按MAIN最新顺序决定，R3媒体阶段端口与BRIDGE真实guarded executor基础提前并行：clip.prepare、snapshot.render、qc.inspect、delivery.package四项须有真实producer和consumer才可登记。不是用函数名/静态manifest证明available；CreationApplication现未注入两个facts选项，仍fail closed。基础实现服从D05/D11/D14/D15，正式QC人审/交付/T20属于R3，不在R2提前宣称通过或绕门发布。

## 拟精确产品路径（不是写权限）

共44项：26已有需修改，18未开发；不得照03整表或整目录写。以下拟BRIDGE唯一writer，含共享core委托候选；MAIN保留DDL/共同事务/恢复最终权威，释放时须明确这些路径由MAIN写还是独占委托BRIDGE，其他lane不能同时写。新增三项prepared映射/package/binding专属路径是将既定D02/D03持久职责落盘的精确增量，不新增公开协议。capability-fingerprint测试也须列入release。无需package/锁/vendor/冻结合同修改。

| 路径 | de086状态 | 分配依据 |
|---|---|---|
| `src/host/agent-driven/creation-application.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/project-context-service.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-task-store.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-task-application.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-run-facts.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-run-authority.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/product-sqlite-repository.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/review-media-http.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-source-change-service.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-source-impact-store.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-source-adoption-store.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-source-adoption-service.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-source-publisher.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/fixed-phase-executor.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-render-delivery-store.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-review-gate-store.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `src/host/creative/execution-guard.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/creative/fixed-workflow-service.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/creative/product-repository.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/projects/revision-store.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/projects/project-creation-store.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/projects/project-coordinator.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/projects/project-resolver.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/impact/impact-store.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `src/host/agent-driven/created-prepared-source-store.ts` | 未开发，新增 | 请求MAIN追加精确路径 |
| `src/host/agent-driven/created-review-package-service.ts` | 未开发，新增 | 请求MAIN追加精确路径 |
| `src/host/agent-driven/created-review-media-bindings.ts` | 未开发，新增 | 请求MAIN追加精确路径 |
| `tests/agent-driven/integration/created-source-change.test.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-source-adoption.test.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-source-process-recovery.test.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-schema-upgrade.test.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-run-authority.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/review-media-transport.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/host-application.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/host-close-lifecycle.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/creative-context-host.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-task-store.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-task-gate.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/capability-fingerprint.test.ts` | 已有，修改 | 请求MAIN追加精确路径 |
| `tests/agent-driven/product/fixed-workflow-service.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/product/execution-guard.test.ts` | 已有，修改 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-render-delivery.test.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-delivery-recovery.test.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |
| `tests/agent-driven/integration/created-qc-review.test.ts` | 未开发，新增 | 03已有BRIDGE设计归属 |

基础路径fixed-phase-executor、created-render-delivery-store、created-review-gate-store及三个delivery/qc测试仅释放MAIN批准的提前基础；不能据此越过R3门。保护MEDIA assembly-ports/verifier/preview/committed-render-phases及PRODUCT app/gateway/native*，它们仅作依赖；不改server与冻结HTTP/tool/schema。

## 当前接口与具体生产接线

1. CreatedTaskStore真实prepared fact/原Job/provider receipt为唯一输入。新CreatedPreparedSourceStore在同RevisionStore连接登记D02不可变映射：ps_+canonical(project/job/request/fact) hash前60，保留全hash碰撞检查；绑定execution/base/source/plan/rights/frame_count/rational fps/descriptor和Host私有stage。无新state、无假M3 materialization。可由已持久事实幂等重建；完成但包未就绪时result_ref=null，禁止悬空引用。真实processor仍MEDIA owner，BRIDGE经store/装配边界消费，不越界写processor。
2. 新CreatedReviewPackageService调MEDIA PreparedSourceProofPort.proveForRead(purpose=preview)→PreparedPreviewPort.preview，再核当前author/rights/proof与真实receipt五part/descriptor/bytes；release proof在finally，不能release后借旧proof。登记不可变receipt/object关系后调用已有FixedWorkflowService.publishReviewPackage。包/receipt可见性与原Job.result_ref投影必须同库原子或明确未就绪；读取不能触发preview。CreatedReviewMediaBindings实现已有ReviewMediaBindingPort.currentPart和currentByReference，返回当前package id/version/digest+原part+receipt/object/slot。ReviewMediaHttp复用实际reader和CR-R1 §8 describe，包替换/跨project/旧Ref拒绝；metadata/descriptor/bytes统一receipt_digest。
3. CreatedSourceChangeService接已有change.prepare/apply，created ps_与旧M3按真实source kind分派，保留legacy路径。D09 PreparedAdoptionPlanV1完整preimage为唯一plan/facts来源，包含base/control/selection、prepared/execution、全部root/files/rights、consumer/nativeplan、frame/fps、锁/上游/expiry。target_snapshot_id沿snapshotIdFor预测，无提前snapshot。impact TTL15min，重放不续期；现有ImpactStore唯一active/consumed/stale权威，created_impact_fact仅不可变事实。impact operation CHECK用前向迁移保留旧行/值，不能改冻结SQL。
4. FixedWorkflowService.decideReview当前adopting已正确purpose=change.approve；不是purpose漏洞。具体缺口是现有五字段facts_digest不足D09，需prepared分支取同一完整plan摘要；CreatedRunAuthority在同transaction核它与当前impact/package。review.decide与兼容change.approve共享相同确认/批准去重，pure accept无Approval，reject撤销未消费批准。一次Decision完成后Host自动attempt apply和MCP重试共享同一key，失败不把accepted当committed。不得另建Approval authority或第二次人审。
5. execution-guard当前仅action/safe_control。按D04增加Host-only review_impact_prepare、approved_prepared_adoption两窄effect；HTTP不接effect/proof。核当前run/grant/package/execution/source/rights和前序门；只豁免该待审产物本门；普通waiting_user派发集合不变，paused/cancelled/stale仍拒绝。不得把成功Job改回running。
6. CreatedSourceAdoptionService先取得MEDIA.proveForAdoption(completed, binding含transaction/impact/approval/target, registryFacts)，持有FD直到同步最后assertCurrentForAdoption及提交；read proof不兼容。CreatorPublisher完整树私有copy/fsync→durable journal→原根backup/rename，不只film.html。保留original完整闭包；专项recover先generic并在HTTP/claim可达之前完成。发布后DB前crash必须可校验完成或完整恢复，无法确定attention，不能默默开放工程。
7. 拟MAIN锁定内部类型（非公开DTO）：RevisionStore.commitPreparedCreatedSource接typed prepared plan+publication事实+受控commit capability，同BEGIN IMMEDIATE里consume Approval/impact、snapshot/source_fact/active pointer/revision+1、step/outbox/idempotency。ProductSqliteRepository新增受限same-connection commit join，区别现有joinTaskTransaction；只接受当前RevisionStore同步作用域、绑定同project/transaction、出域失效、拒thenable/嵌套BEGIN/裸DB/跨库，回调吞错亦使外层rollback。MAIN最终给出精确签名并独占委托上述共享文件；不让Claude自行选择另一事务模型。
8. 提前基础FixedPhaseExecutor消费MEDIA committed-render-phases（目前缺失）真实encode/inspect/publish；同原Job/lease、原execution attempt、D11去重键，保存EncodedFact及parent digest，D14 producer lease与publication winner分开。QC evidence只pending，D15可信决定后同Job新lease续package；created-review-gate-store明确qc gate binding，普通chapter包不代替QC。未具备这些真实consumer时不声明四能力就绪。CreatedRunFacts复用capabilities/readiness选项，MAIN提供实际生产装配证据及配置摘要；不新增hardcoded registry。
9. PRODUCT消费Change/ReviewPackage/ReviewDecision/CreatedSourceFact，不从Host expected复制observed；native ack session/epoch/generation/commit核对由PRODUCT端口生产。BRIDGE只在共同装配消费真实ack，与NativeSync状态区分；无ack保持未确认，不改变EnginePort或创建第二时钟。

## MAIN一次释放需锁定的具体边界

- 共享RevisionStore.commitPreparedCreatedSource与受限commit-join exact type/callback范围；上面是D10落地提案，当前不存在，MAIN保留共同事务与DDL决定权。
- 三个新增映射/package/binding路径及capability测试精确owner，包发布/result_ref/receipt持久化同步边界；建议全部BRIDGE，同一连接，PRODUCT/MEDIA只消费。
- MEDIA早期阶段端口实际类型commit、真实四能力装配producer证据与PRODUCT native expected/observed端口commit；未产出时继续已释放独立store/negative/恢复工作，依赖组合case标BLOCKED，不用fixture冒充真实Run。
这是端口/唯一writer实施闭合，不重新审D01–15、不新增独立产品审查门；MAIN已决定提前基础顺序，无需再询问用户是否推进。

## 精确验收与命令（全部计划、NOT_RUN）

| case / 既有映射 | 必须验证 | 文件/命令组 |
|---|---|---|
| R2-01 BR-A-04/09 | prepared无source/revision变化；五真实part+包Ref+receipt哈希一致，重开可读；GET无写/渲染；旧包/错version/bytes/descriptor拒绝 | created-source-change、review-media-transport；C1/C2 |
| R2-02 BR-A-03/05 | 真UI accept+0；accept_and_adopt/兼容approve并发只1Approval及+1；自动apply/断线重放同结果；无提前snapshot、TTL不续期 | fixed-workflow-service、created-run-authority、created-source-adoption；C1 |
| R2-03 BR-A-05负例 | base/control/selection变化严格409；rights/bytes/锁/跨scope/旧包/过期拒绝且所有author/source/approval消费不变；五字段摘要替代完整plan须打红 | created-source-change/adoption、execution-guard；C1 |
| R2-04 BR-A-05/07 | waiting_user只有两内部effect；普通任务/HTTP伪effect拒绝；SOURCE_ONLY无lease用fresh adoption proof；read proof、旧lease、暂停取消不能采用 | created-task-gate、execution-guard、created-source-adoption；C1 |
| R2-05 BR-A-06/08 | real child Host在journal/backup rename/new-root rename/DB前后逐点退出，同DB重开；一次提交或完整old closure，重复恢复无+2/重复outbox；专项先generic，FD/子进程清理 | created-source-process-recovery、host-close-lifecycle；C2需slot，throw只组件 |
| R2-06 D10/D13 | 同库commit join跨DB/过期/thenable/吞错回滚；旧库升级保留旧impact，冻结cp_a0不变，无假migration；typed source事实完整 | created-schema-upgrade、created-source-adoption；C1 |
| R2-07 BR-A-01 | 四producer任一缺/consumer未装配/rights失效→prepareRun拒绝、Run/Job新增0；真实全部装配后才能真Run，不以TestGrant通过 | capability-fingerprint、host-application；C1/C2 |
| R2-08 BR-A-05/09 | 同真实Host/Gateway可信决定→commit→原M5加载/真实ack，commit到ack间pending/unknown，旧session/generation拒绝，单timeline/clock | MAIN+PRODUCT created-native-ack/workbench组合，C3 |
| R2-F BR-A-RECOVER提前基础 | 原Job/lease阶段去重；encoded恢复不重encode；QC未审queued不claim；旧lease取消不能发布；不得靠无guard媒体方法登记available | created-render-delivery/recovery、created-qc-review；C4，R3最终门另验 |

C1（release后现有脚本、先创建新增文件）：`corepack pnpm test tests/agent-driven/integration/created-source-change.test.ts tests/agent-driven/integration/created-source-adoption.test.ts tests/agent-driven/integration/created-schema-upgrade.test.ts tests/agent-driven/integration/created-run-authority.test.ts tests/agent-driven/integration/created-task-gate.test.ts tests/agent-driven/integration/capability-fingerprint.test.ts tests/agent-driven/product/fixed-workflow-service.test.ts tests/agent-driven/product/execution-guard.test.ts --maxWorkers=1 --minWorkers=1`。

C2（MAIN heavy slot）：`corepack pnpm test tests/agent-driven/integration/created-source-process-recovery.test.ts tests/agent-driven/integration/review-media-transport.test.ts tests/agent-driven/integration/host-application.test.ts tests/agent-driven/integration/host-close-lifecycle.test.ts tests/agent-driven/integration/creative-context-host.test.ts --maxWorkers=1 --minWorkers=1`。

C3由MAIN在PRODUCT文件实际创建并释放后执行：`corepack pnpm test tests/agent-driven/integration/created-native-ack.test.ts tests/agent-driven/integration/created-workbench-review.test.ts tests/agent-driven/integration/created-workbench-headless.test.ts --maxWorkers=1 --minWorkers=1`；BRIDGE不写这些文件，未创建不能宣称此命令已可验证。

C4（MAIN heavy slot，基础case与最终R3分别记录）：`corepack pnpm test tests/agent-driven/integration/created-render-delivery.test.ts tests/agent-driven/integration/created-delivery-recovery.test.ts tests/agent-driven/integration/created-qc-review.test.ts --maxWorkers=1 --minWorkers=1`。

补充 `corepack pnpm exec tsc --noEmit`、`corepack pnpm test:contracts`；build/check仅MAIN全机单槽。现有local source与观察SHA不同，本票不运行任何这些命令；不能用R1绿灯填结果。所有运行须Headless静音、独立DB/var/stage/profile/端口，MAIN离线准备依赖，vendor只读；不复制共享可写根、不安装/网络/J盘/配置读取。真实媒体/Host/多进程/browser先领单槽，附实际PID/cwd/命令/输入SHA/时间/exit/loghash及清理，只清理自己进程。

## 回退与交接

发布异常由原journal+专项恢复完整source根或attention；不能靠git reset模拟恢复。schema升级保留旧数据，不能直接向旧二进制降级不兼容库；MAIN保存原DB/完整source与新事实证据再选恢复。开发候选显式文件提交、旧dirty和失败日志原封保留；无需push/合主干。429先证明原writer和children/命令停止，记录dirty再移交；>2 stage rework交MAIN根因，不自动重启旧R1失败writer。独立R2复核按原04由MAIN安排，内部验证不自签；A人验/B不在本票。

## 观察输入SHA256（git show de086f32c48c44fb72d0212ef80365f1c786408c）

- `docs/execution/A/relaunch-20261111/02_MAIN_CONTRACT_AND_DECISIONS.md`: `27f5d38c8a492a857f01d0cb7e1d8032a13aeadf9492517252454faa4bb27899`
- `docs/execution/A/relaunch-20261111/03_OWNERSHIP_AND_DEPENDENCIES.json`: `d0fe36ea8951220ac5cf657c0e060b8b84442eed21291ea5095e4d9a2975b70c`
- `docs/execution/A/relaunch-20261111/04_COORDINATED_EXECUTION_PLAN.md`: `adb39810f0130dc11fbabcc0e2fe34f4a4448c24244d9c25b1e1943fa72d97b0`
- `docs/execution/A/relaunch-20261111/bridge/DESIGN.md`: `f027aece02c005a68f74a043cb351229bba67289ecd75739505d85ab465d7683`
- `docs/execution/A/relaunch-20261111/bridge/ACCEPTANCE.md`: `a84f503bc16c95fbfbdac9868247760c40736804b39be198a0e5dc63d2041cff`
- `docs/execution/A/relaunch-20261111/implementation-prompts/bridge.md`: `afda13239d15aa2910eae4ac2a2a2c90e183a10c059420454fba655eaa0040f3`
- `contracts/agent-driven-a.schema.json`: `088a451e9646199618261a6cc95a84e3767dbf4cc87004f3e5995dda86b60964`
- `contracts/agent-driven-a.registry.json`: `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f`
- `contracts/agent-driven-a.migration.sql`: `5572530b5036728e414a0653fc36fd43958874a3a89cc8223e3984194c4a1fa4`
- `src/contracts/agent-driven-types.ts`: `54356697802c0bf048e5cbcde1f54eb33713d4fe58943b346406804011cb3644`
