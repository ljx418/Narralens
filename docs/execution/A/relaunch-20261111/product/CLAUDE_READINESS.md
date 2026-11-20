# PRODUCT A · Claude 只读接手检查（CLAUDE_READINESS）

任务 task_8e0380980def / Dispatch ctx_291a3c63fe4f；领域 Codex=term_cbb662e5-3041-44b3-bb26-aac1213e1695；MAIN=term_a731c232-35c7-4f55-a75d-9b2beeade398。
本文件是 PRODUCT ClaudeCode 的只读 readiness 回执。本轮**未写任何代码、未跑任何业务测试、未启动任何服务、未改任何配置或工作树**；除本文件外无其它写入。**开发未释放。**

---

## 1. 实际 CLI 与 cwd

|项|实际值|
|---|---|
|CLI|`/home/administrator/.npm-global/bin/claude`（`claude`）|
|会话 cwd|`/mnt/c/workSpace/videoWorkLine`（`pwd` 实测）|
|Orca 启动回执（TASK.md:78 记录）|Task `task_8e0380980def`，Dispatch `ctx_291a3c63fe4f`，handle `term_15069fcf-7f1f-46cc-be33-225cf860c4f2`，agent=claude，mode=terminal，state=ready，keptOpen=true，Run `run_20296ffbad2e`，workspace `90974dd7-625f-46bf-a442-37f7cbadac25::C:\workSpace\videoWorkLine`|
|本次唯一可写文件|`/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/relaunch-20261111/product/CLAUDE_READINESS.md`|

cwd 与 canonical 是**同一目录的两种大小写写法**：本机 `/mnt/c/workspace/...` 与 `/mnt/c/workSpace/...` 指向同一 WSL mount（大小写不敏感），实测两侧 `ls`/`git rev-parse` 结果一致。**未新建任何替代项目。**

---

## 2. 路径可达性与 HEAD / dirty 匹配

|工作树|路径（实测可达）|HEAD 实测|期望|一致|
|---|---|---|---|---|
|canonical|`/mnt/c/workspace/videoworkline/Narralens`|`ca5b67a8285b130c79055317c6202f73cfbb99c8`|11_AGENT_DELIVERY_PROCESS.md:50 记载|✅|
|MAIN 事实|`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`|`838ba5f2c8500f0103f56dbe51264ea9f70086fc`|838ba5f2…|✅ branch `agent-driven/main-a-integration`|
|PRODUCT 候选|`/mnt/c/workspace/videoworkline/Narralens-agents/product-workbench`|`07399c230023591b84fa2872b45b2a8b58b286f4`|07399c23…|✅ branch `agent-driven/lane-product`，工作树**干净**|

MAIN dirty overlay（`git status --porcelain`，只读）：**9 M + 9 ??**，含 processor/verifier——`src/host/agent-driven/created-draft-processor.ts`(??)、`prepared-draft-verifier.ts`(??)，以及 M 的 `created-task-gate.ts` / `created-task-store.ts` / `created-task-worker.ts` / `local-asset-registry.ts` / `src/host/engine/source-digest-v1.ts` / `src/host/render/native-draft-assembler.ts` + 对应 3 个既有测试 M + `source-digest-resource-boundary.test.ts`(??)。**与期望的 dirty processor/verifier 完全吻合。**

保全核对：TASK.md:13-37 的 **25 行 dirty overlay 表逐行复算 SHA256 → 0 处不一致**（归档 SHA = 当前 SHA = 25/25 True）。`baseline-observed.json` 记录 main-integration `dirty_files` 数量 = 25，与现场一致；`business_tests_this_round` = `NOT_RUN`；`captured_at` = 2026-11-11T08:04:09Z；其中 4 个 worktree head 与现场实测全部一致。

CP-A0 冻结四文件在 MAIN 的实际 SHA256 与 `docs/execution/A/contract-freeze.json` **逐一相符**（`agent-driven-a.schema.json` 088a451e… / `agent-driven-a.registry.json` 05f29d94… / `src/contracts/agent-driven-types.ts` 54356697… / `agent-driven-validator.ts` f11a68ba…）。DESIGN.md:70-88 的 **15 个输入 SHA256 逐个复算全部相符**；`contract-freeze.json` = 532cd43c…、`baseline-observed.json` = f31f82d5… 亦与 DESIGN 记载相符。

---

## 3. 会话报告模型与证据

|项|值|证据|
|---|---|---|
|**会话报告模型**|**`MiniMax-M3.1-Flash-Preview[1m]`**|本会话注入的模型报告（唯一权威来源）|
|供应商|**MiniMax**|`~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL` = `https://api.minimax.cn/anthropic`（Anthropic 兼容端点；**非** api.anthropic.com）|
|配置内可选模型|`modelPicker.replaceBuiltInOptions = true`，选项全为 MiniMax：`MiniMax-M3.1-Flash-Preview[1m]`（首项）、`MiniMax-M3[1m]`、`MiniMax-M2.7`、`MiniMax-M2.7-highspeed`；`env.ANTHROPIC_SMALL_FAST_MODEL` = `MiniMax-M2.7-highspeed`|同上|
|**一致性结论**|**CONSISTENT**（会话模型 == 配置 MiniMax 选项首项；供应商 == MiniMax；与 AGENTS.md:34「各领域 ClaudeCode（MiniMax）」一致）|—|

- **未推定**：模型不是由 `claude` 这个 CLI 名推出的，而是由会话模型报告 + 配置里的 MiniMax 端点/选项交叉确认的。
- **UNKNOWN（按约束刻意不查）**：配额、账户归属、凭据是否与其它 lane 共享、额度是否同池 —— AGENTS.md:34 明确「不得推定同一额度、共享凭据」，本轮**未读任何凭据值**，故记 UNKNOWN。
- **两点如实说明（不隐瞒）**：
  1. 为定位模型键名，对 `~/.claude/settings.json` 做过一次键名级 grep；该 grep 的匹配行**连带显示了 `ANTHROPIC_AUTH_TOKEN` 的字面值**。该值**未写入本文件、未写入任何其它文件、未在本回执中复述**，仅出现在当次工具输出里。若按最小暴露原则处理，建议用户/MAIN 之后轮换该凭据。
  2. `settings.json` 顶层残留 `"model": "opus[1m]"`。因 `modelPicker.replaceBuiltInOptions = true` 且实际生效为 picker 首项（MiniMax-M3.1-Flash-Preview），该顶层值当前**不生效**；但它是一处易误读的残留，建议 MAIN 记录，避免未来会话被误判供应商。`switchModelsOnFlag = true` 也意味着模型可被 flag 切换 —— 429 时**不得擅改配置或模型**（TASK.md:67）。
- **未切换供应商、未切模型、未改任何配置。**

---

## 4. 四文档审阅结论

### **BLOCKED**（文档层，非开发层）

含义：**四文档作为「A 连续路径可交接」的依据尚不充分** —— 经 D-01..D-12 两轮收窄后，仍有 **4 项必须 MAIN 裁决**（N-1 / B3 / B5 / D-04+D-05+D-08..D-11 的生产装配与归属）与 **18 项可在四文档内直接闭环**（E1..E18）的错漏/缺引证。**这不是「开发已释放」或「开发被永久否决」**：阻塞面是有限且可枚举的，关闭后即可转 READY_FOR_MAIN_REVIEW。**本轮不启动编码。**

#### 4.1 逐项只读复核结论（正面）

以下事实我已在 MAIN 源码中逐一复核，**四文档的证据层准确率极高**，未发现任何编造：

|复核项|结论|
|---|---|
|L0 入口链（`GET /api/ui/v1/projects`、`POST /api/ui/v1/projects/:id/native-open` → `CreatedWorkbenchHttp` → `CreatedNativeWorkspaceService.prepare` → `m5Supervisor.ensure` → `issueNativeEntry`，返回 `native_state:'unconfirmed'`）|**全部真实存在**，逐符号命中|
|L1 创作（`creativeHandlers` 8 路由 / `CreativeService` / `ProductSqliteRepository` / 同库事务 / `authority:"content_only"` / `source_message_ref`）|**准确**|
|冻结类型逐字段：`QuestionAnswerPut`（meta/idempotency_key/intake_id/expected_intake_version/question_id/question_version/input_digest/expected_answer_version/action/text/choice_id/source_message_ref）、`ContentDecisionRelay`、`DeliveryManifest`（14 字段全对）、`ReviewPackage`（allowed_choices/impact/reuse_of_package_id）|**逐字段相符**|
|错误码 `CAPABILITY_UNAVAILABLE` / `RUN_SCOPE_REQUIRED` / `NOT_FOUND` / `IMPACT_STALE` / `REVIEW_STALE`（`product-facts.ts:60-94`、`fixed-workflow-service.ts` 20+ 处）|**全部相符**|
|R4 三组件**未在 M5Panel 生产挂载**（`M5Panel.tsx` 的 import 段无 observation/system；`new PlaybackClock` 全仓仅 M5Panel 一处，单 selection/clock 成立）|**准确**|
|`CreatedWorkbenchService.read` → `capabilities[].state='blocked'`、`preview:null`、`native_sync:'unknown'`|**准确**|
|013 四 parts（settings/subtitle_style/captions/markers）、epoch 语义；015 `format=narralens.native-expected-input@1` / `upstream_sha=e70d9d93…` / `profile=narralens.native-expected-numeric@1`，且 `computeExpectedProjection` **确实复用** `filmShape/layoutTracks/trackNamesOf/trackHeightsOf/ownTrackHeight/footageFps/placeMarkers/parseProjectSettings/parseMarkers`；013/015 `active-candidate.json` 各字段（source_commit、browser NOT_RUN、independent_review PENDING、15 literal vectors）|**逐项相符**；DESIGN「015 仅 settings/markers 两部分」**成立**|
|`NativeSyncIndicator` 只比较 project/revision/snapshot/source/selection 五个字段，Host 侧 `project-context-service.ts:61` 才做 bridge_session_id + instance_generation 判定|**准确**（MC-10 成立）|
|`ProductWorkflow` 类型全仓不存在（现有为 Workflow/WorkflowRun）|**准确**|
|ACCEPTANCE C1..C7 命令来源与 MAIN `package.json` scripts 逐条相符；**C1..C8 引用的全部测试路径真实存在**（含 P13 的 `tests/agent-driven/integration/local-assets-host.test.ts`）|**准确**|
|TASK.md:55 提议白名单的 **11 个路径全部存在**；RP-P5 的两个新文件 `LocalAssetRegistrationPanel.tsx` / `local-asset-registration-ui.test.tsx` **确实尚未存在/未释放**|**准确**|
|RP-P5 逐字段消费 `LocalAssetInput`：project_id/idempotency_key/relative_path/expected_sha256/kind/source/license/recording_origin/attestation_ref **与冻结类型逐字段相符**；`LocalAsset` 返回字段（含 `attestation{operator_id,session_ref,source_message_ref,recording_origin,recorded_at}`）**相符**；Host 实际校验：写操作要求 `trusted_ui`（`#access` write=true 分支）、list 只认认证 owner、**video 的 recording_origin 必须为 null**、audio 限 human_recording/synthetic/unknown、license status 限 cleared/restricted/unknown、**成功只写 blob/登记/receipt/outbox（`asset.local.registered`）不改 source/revision/snapshot**|**RP-P5 全部成立**|**（`src/host/agent-driven/local-asset-registry.ts:250-293,312,325,461`）|

**结论：四文档没有把「公共合同请求」当成生产 API，也没有编造端点、字段或既有实现。** 这一点做得正确且重要。

#### 4.2 阻塞项（已按 D-01..D-12 收窄；仍需 MAIN 裁决 —— 我无法代裁）

**说明**：MAIN `02_MAIN_CONTRACT_AND_DECISIONS.md` 已追加 D-01..D-12（裁决候选），四文档已回 ACK/反例。原 B1/B2/B4 已被 D-05/D-02/D-04 **在原则上覆盖**，但**仍未裁决为 release**；B3/B5 **未被任何 D 项覆盖**。另新发现 N-1（见 4.2b）。

|编号|阻塞|D-轮状态|已验证事实|归属|
|---|---|---|---|---|
|**B1**|双导出 producer 无生产装配（P-A3 承重缺口）|**D-05 已给方向**（编码/技术 QC 的不可变结果与正式 publish 分段、阶段化端口、共同守卫、`CommittedRenderReceiptV1`）|`SnapshotRenderService implements RenderPort` 存在于 `src/host/render/render-snapshot.ts:177`，但**全仓 `new SnapshotRenderService` 仅 2 处**：`tools/agent-driven/media/render-delivery.ts`（工具脚本）与 `tests/agent-driven/media/render-snapshot.test.ts`（测试）。`src/host/server.ts`、`src/host/agent-driven/start-runtime.ts`、`src/host/render/assembly-ports.ts` **均无装配**。<br>**D-05 的前提已在源码坐实**：旧 facade `async render(request)` 在 `render-snapshot.ts:184`，其内部 `:557` 直接调用 `this.#deps.commit.commitReady({...})` —— 正是 D-05 所说「一口气 commitReady 越过 cover/QC 门」。故新生产装配**必须走阶段化端口，不能复用该 facade**。|MAIN：阶段化端口的生产装配 + Delivery 持久化 + created 路径触达|
|**B2**|created 链 → 采用链缺交接键|**D-02 已给方案**（`prepared-source@1` + `cp_a0_prepared_source` 映射表 + `materialization_id='ps_'+SHA256(...)` 前 60 hex + discriminated resolver `source_kind=m3_segment_plan\|assembled_native_source`）|created 链产出 `PreparedTaskFact { format:'narralens.created-task-prepared@1', stage_token, source_digest, plan_digest, rights_digest, files, roots }`（`created-task-store.ts:39-44`）——**无 `materialization_id`**；`created-draft-processor.ts:45` 自述「Real local preparation processor, **not a committed project producer**」，processor 内 0 处 coordinator/adoption/commit 引用。<br>**新发现 N-1（见 4.2b）**：D-02 只定义了**生产侧**，消费侧尚未适配。|MAIN：D-02 裁决 + **N-1 的消费侧改动**|
|**B3**|**受控采用路由与 facts/adoption 注入不可分**|**未被任何 D 项覆盖**|`workflowHandlers(service)` 已存在于 `src/host/agent-driven/application-dispatcher.ts:38`，含 10 路由（workflow.run.prepare/authorize/read/start/pause/resume/cancel、workflow.read、review.read、review.decide）——但 `creation-application.ts:16` 只 import `ApplicationDispatcher, creativeHandlers`，第 74 行只 spread `creative`，**workflowHandlers 从未注册**。且 `FixedWorkflowService` 的 `facts?: ProductFactPort` / `adoption?: TrustedAdoptionAuthority` 是**可选**依赖（`fixed-workflow-service.ts:231,238`），`creation-application.ts:67` 只传 `{repository}`，`requireFactPort` 缺端口即抛 `CAPABILITY_UNAVAILABLE`（`product-facts.ts:60-63`）。⇒ **只注册路由必然在 prepare 处失败**；路由注册与端口注入是同一个不可分任务。D-04 定义了 effect 语义，但**无人拥有「注册 workflowHandlers + 注入两个端口」**。|**MAIN：明确 core writer 归属（注册 + 注入 + TrustedAdoptionAuthority 实现），并与 D-04 的窄 effect 顺序绑定**|
|**B4**|waiting_user 下的 review→change/采用门与 QC/采用 Gate writer|**D-04/D-05 已给方向**（Host-only 窄 effect `review_impact_prepare` / `approved_prepared_adoption`；采用未完成时 checkpoint 不得宣称影片已采用；QC Gate 由阶段化执行器记录）|**FixedWorkflowService 内不存在** change.prepare/change.apply（`changePrepare/changeApply/prepareChange/applyChange` 全仓 0 命中）；08 文档的 `change_prepare/change_apply` 仅为**拟定 MCP 名**。既有 typed 写原语只有 `NativeWriteGateway`（`src/host/engine/native-write-gateway.ts`）：`set_visual_fit(shot_id,value)` / `replace_visual_asset(shot_id,asset_id)` / `restore_snapshot(target_snapshot_id,impact_id,impact_hash)`。|**MAIN：把 D-04 窄 effect 写成明确裁决 + owner；PRODUCT 不得自造 change API**|
|**B5**|**不存在覆盖 PRODUCT 的 ReleaseAssignment；A 素材授权 pending**|**D-07 覆盖了基线程序，未覆盖 ReleaseAssignment 与素材授权**|在库唯一 ReleaseAssignment = `docs/execution/A/ReleaseAssignment-MAIN.json`（`A-MAIN-CORE-001`，status=RELEASED，recordedAt 2026-11-09T13:15:06Z）：owner=**MAIN**、writer=**Codex /root**、base_sha=**ca5b67a8…**（非 MAIN 当前 838ba5f2）、allowed_files 25 条**全为 MAIN 核心**（**零** observation/system/product 路径）、allowed_new_prefixes 不含 `src/app/observation/`、`src/app/system/`、`tests/agent-driven/product/`。其 `fixtures` = 「authorized A media manifest **pending**; never substitute synthetic speech」，`mediaAuthorization` = `REQUESTED_PENDING`。<br>**D-07 的「310」已核对为真**：bridge-observability `git status --porcelain=v1 -uall` = **310** 个未跟踪候选文件（5 个顶层路径：A03-CREATED-TASK-STORE-CANDIDATE / A03-PREPARED-DRAFT-VERIFIER-CANDIDATE / A03-STEP-ATTEMPT-TX-CANDIDATE / A03-STEP-PROGRESSION-EVENT-CANDIDATE / reviews）。各 lane 未提交计数实测：main-integration 18（= 25 文件/9 ?? 目录）、bridge-observability 5 路径(310 文件)、media-delivery 0、product-workbench 0。|**MAIN：先按 D-07 产出共同可复现 commit，再签发覆盖 PRODUCT 的 bounded ReleaseAssignment + 素材授权**|

#### 4.2b 新发现 N-1：D-02 的**消费侧**未适配（MAIN 必须裁决）

D-02 定义了生产侧（新表 `cp_a0_prepared_source`、`materialization_id='ps_'+…`、discriminated resolver），但**既有消费方无法读取新事实**：

|消费方|位置|现状|
|---|---|---|
|`AdoptionCoordinator`|`adoption-coordinator.ts:153`|硬性要求 `materialization.state === 'ready_for_adoption'` **且** `materialization.native_plan !== null`|
|`AdoptionCoordinator`|`adoption-coordinator.ts:244, :713`|再次要求 `finalMaterialization.state === 'ready_for_adoption'`|
|`ImpactService`|`impact-service.ts:241, :331, :641, :693`|4 处要求 `row.state === 'ready_for_adoption'`（`:693` 过期即 `stale`）|

⇒ D-02 明确「没有 state 列」，而上述 **7 处 `state === 'ready_for_adoption'` 门 + 1 处 `native_plan !== null`** **均不按 `source_kind` 判别**。**结论**：D-02 的 resolver 必须被**新的消费分支**接入（`assembled_native_source` 分支），或这 8 处检查必须改成 kind-aware；`AdoptionCoordinator` 现有代码路径**不能直接消费** `cp_a0_prepared_source` 行。D-02 文本未涵盖此消费侧改动 → 若不裁决，A 实施期会在此处才发现断链。**建议 MAIN 在 D-02 裁决中写明：哪些消费方新增 kind 分支、`native_plan` 对新源_kind 的语义、旧 M3 路径零回归的证明方式。**

#### 4.3 可在四文档内直接闭环的错漏（18 项：E1..E9 初轮 + E10..E15 D-01..D-07 轮 + E16..E18 D-08..D-12 轮；Codex 可改，不需 MAIN 裁决）

|编号|准确位置|现状|问题|建议|
|---|---|---|---|---|
|E1|DESIGN.md:20「没有完整 workflowHandlers 注册」|说法正确但未点名、未说耦合|MAIN 看不到「注册即可用」的错觉，也看不到与 facts/adoption 的不可分性|点名 `application-dispatcher.ts:38 workflowHandlers`（10 路由）与 `product-facts.ts:60 requireFactPort`；补一句「注册路由必须与 facts/adoption 注入同批，否则 prepare 抛 CAPABILITY_UNAVAILABLE」|
|E2|DESIGN.md「明确未接通」段（缺行）|未记 created→adoption 交接键缺失|B1/B2 是 P-A2/P-A3 的承重事实，文档层未承载|补一条已验证事实：`PreparedTaskFact` 无 `materialization_id` vs `AdoptionCoordinator` 要求 `materialization.state==='ready_for_adoption'`；并把 RP-P2a 明确映射到 P-A2/P-A3 的依赖票据|
|E3|DESIGN.md L1 表 + RP-P3|只描述冻结 `DeliveryManifest` 类型与 UI 路由提案，**完全未提 `SnapshotRenderService` 无生产装配**|MAIN 会低估 P-A3 双导出的实际工作量与归属|在 L1 表新增一行「L1 交付 producer」：`SnapshotRenderService` 存在但生产未装配，dual-export 依赖 MAIN/MEDIA 装配 RenderPort + Delivery 持久端口；PRODUCT 仅出入口/状态 UI|
|E4|DESIGN.md:46 RP-P3|M5 的 `delivery-preview` 阶段其实**已存在**（`M5Panel.tsx:107 M5Stage="idea"|"refine"|"delivery-preview"`，`:628` 渲染该 panel），但 created 路径只有 2 个路由（`created-workbench-http.ts:26,32`），无导出 producer|RP-P3 写成「接入口」，未说明 UI 半边已就位，MAIN 会重复估工|改述为「UI 阶段已存在，缺 producer/路由/幂等键/快照 CAS；UI 侧只剩接线与状态呈现」|
|E5|DESIGN.md:30 P-A3「走 MAIN 原生写网关/impact/锁/Approval」|措辞正确但未点名实体，且未说明「改单镜」可用 op 集合有限|PRODUCT 可能按 08 文档自造 `change.prepare/apply`|**更正本条（重要）**：冻结 registry **确有** `change.prepare` / `change.approve` / `change.apply`（31 路由中的 3 条，path `/api/agent/v1/projects/:id/changes`、`.../changes/:impact/approval`、`.../apply`；tool `narralens_change_prepare`/`narralens_change_apply`；DTO `PrepareChange`/`Change`/`ApproveChange`/`Approval`/`ApplyChange`/`Applied`）——**它们不是「仅拟定的 MCP 名」**，而是**已冻结的合同路由 + DTO**。但三条全部标 `production: "NOT_IMPLEMENTED"`，且 **Host 侧无对应方法**（`changePrepare/changeApply` 全仓 0 命中）、**生产 dispatcher 未注册**（`workflowHandlers` 10 条路由里无 change.*）。建议改写为：点名 `src/host/adoption/adoption-coordinator.ts`（AdoptionCoordinator）+ `src/host/engine/native-write-gateway.ts`（NativeWriteGateway），写明 A 内可用 typed op 仅 `set_visual_fit` / `replace_visual_asset`（另 `restore_snapshot`），并写明「change.* 是**冻结合同面但尚无 Host 生产者与注册路由**（对应 D-08 的新 producer 接线），PRODUCT 不得另造 change API，也不得把冻结 DTO 当已实现」|
|E6|DESIGN.md:32 单章复用|未点名服务端实现|ACCEPTANCE P04 要求「不得仅UI隐藏门」，但文档没给出该门的代码位置，验收方无法定向复核|点名 `fixed-workflow-service.ts:1575-1605 #assertReuse`（同章+同 input/output/quality，否则 `REVIEW_STALE`）、`:890 publishReviewPackage` 调用点、`:910/:996` 落库 `reuse_of_package_id`/`reuse_of_gate_id`；并挂到 P04「服务端门」证据要求|
|E7|ACCEPTANCE.md:12 C1|`pnpm test tests/agent-driven/product` 实际覆盖 **6 个测试文件 + support/**（creative-service、fixed-workflow-service、observation-ui、**execution-guard**、**digest**、support/），而 TASK.md:55 提议白名单只列其中 3 个|C1 会跑到白名单外文件；MAIN 释放白名单时若不含 execution-guard/digest，验收命令与白名单不一致|MAIN 释放时明确 `execution-guard.test.ts` 与 `digest.test.ts` 归属；或在 ACCEPTANCE 标注 C1 的实际覆盖面|
|E8|TASK.md:55 vs :56（内部张力）|后续实现白名单把 `tests/agent-driven/product/fixed-workflow-service.test.ts`、`creative-service.test.ts` 给 PRODUCT；但 :56 规定 `src/host/**（含creative现有逻辑）` 为 **MAIN 独占**|这俩测试正是 MAIN 独占逻辑的测试；PRODUCT 改它们等于代 MAIN 改核心语义，且可能触发「测试替身冒充生产」风险|拆开：PRODUCT 只新增 `tests/agent-driven/product/observation-ui.test.tsx` 与 RP-P5 新增的 `local-asset-registration-ui.test.tsx`（+ 未来 adapter 测试）；既有 service 测试若必须改，走 MAIN 独占或由 MAIN 显式单 writer 释放|
|E9|TASK.md:9「archive sha256=6efbb796…」|**6efbb796… 不是 baseline-observed.json 的文件 SHA**（文件 SHA = f31f82d5…，DESIGN.md:88 已正确记载）；它是 baseline-observed.json **内部 main-integration 条目的 `archive_sha256` 字段值**（该条目 dirty_files=25）|同名字段易被读成「归档文件自身的摘要」，后续核对会取错基线|改为「`baseline-observed.json` 内 main-integration 条目的 `archive_sha256` 字段 = 6efbb796…；该文件自身 SHA256 = f31f82d5…（见 DESIGN.md:88）」|

**D-01..D-07 轮新增的引证修订（7 项，同样 Codex 可直接闭环）**

|编号|准确位置|现状|问题|建议|
|---|---|---|---|---|
|**E10**|DESIGN.md D-04 ACK 行 / ACCEPTANCE D-01..07 反例段的 P05|反例描述**完全正确**，但未给源码位置|这是 D-04 里**最容易提前绿灯**的一处，验收方需要能直接定位复核|补源码：`fixed-workflow-service.ts:1245-1285`（同事务写 `content_decision` choice=accepted → `review_request.state='accepted'` → **gate.state='accepted'` → `#nextRunState` 重投影 run → `tx.put('run')`）与 **`#nextRunState` 在 `:1780-1785`：`gates.find(g => g.kind !== 'adoption' && g.state==='pending')` —— 显式排除 adoption gate**，故只剩 adoption gate 待办时 run 被投影为 **`running`**（`#workflowNextActions` 随之给 `await_step`）。而 `decideReview` **内部不做 commit**，`registerApproval` 只持久化 Approval。⇒ 「accepted gate / run running」与「revision+1 已提交」是两件事，UI 与调度必须查真实 transaction/approval/prepared_authorization。另 `PACKAGE_GATE`(`:132-138`)：sample→sample / first_chapter→first_chapter / chapter_pack→chapter_pack / **audio→null** / cover→cover|
|**E11**|DESIGN.md D-05 ACK 行|D-05 的前提未给源码位置|MAIN 复核与实施者需自己再找一遍|补：`src/host/render/render-snapshot.ts:177`（`export class SnapshotRenderService implements RenderPort`）、`:184`（`async render(request: RenderRequest)`）、`:557`（`await this.#deps.commit.commitReady({...})`）；`:80/:82` 的 `DEFAULT_RENDER_TIMEOUT_MS`/`DEFAULT_QC_TIMEOUT_MS`；`:162` `applyDispositionGate`。写明「旧 facade 对诊断/模块调用保持兼容，但**新生产装配不得调用它**，须走阶段化端口」|
|**E12**|DESIGN.md D-01 ACK 行|只回 ACK，未记端点注册状态|MAIN 需知道这三个端点**当前不存在**，避免误判已实现|补事实：`local-source-files` / `local-assets` / `asset-inventory` 在 `src/` **零命中**（未注册、未实现）。**并补命名冲突风险**：既有 wave2 已有 `AssetInventoryPort`（`src/host/projects/asset-port.ts`，被 `src/host/impact/impact-service.ts` 与 `src/host/server.ts` 消费），与 D-01 的 owner-scoped `/api/ui/v1/projects/:id/asset-inventory` **不是同一概念**，需在附属合同中显式区分命名。另：sourceRoot 确由 Host 配置 —— `src/host/agent-driven/start-runtime.ts` 读 `NARRALENS_LOCAL_ASSETS_ROOT` 环境变量名注入 `localAssets.sourceRoot`（只记变量名，未取值）|
|**E13**|DESIGN.md D-03 ACK 行 / ACCEPTANCE P03 变体|反例已写对，未指明 `result_ref` 的现状|MAIN 需知道该字段现在是什么状态|补：`JobReceipt.result_ref` 在**真实 ReviewPackage 发布前**必须保持 `null`；`review.read` 走现有 `workflowHandlers` 的 `'review.read' → FixedWorkflowService.readReview`（**当前该路由未注册**，见 B3），故 D-03 的「以 execution.run_id/ref.id 走 review.read」**依赖 B3 先关闭**|
|**E14**|DESIGN.md D-06 ACK 行|已明确 015 不覆盖 captions/style|未给「015 只覆盖 settings/markers」的源码依据|补：`015` 的 `candidate/expected-projection.mjs:66-67` 只调 `parseProjectSettings` / `parseMarkers`，`:155-169` 只产出 tracks/names/heights/fps 与 `markersValue`；`candidate/expected-projection.d.ts:30-32`（format/upstream_sha/profile）、`:62-65`（`EXPECTED_PROFILE` 与 computed/unsupported 联合类型）。⇒ 整工程 loaded 必须另有 captions/subtitle_style/film/source 闭包的独立 expected producer|
|**E15**|ACCEPTANCE D-01..07 反例段|反例已补齐|缺一条**总闸**|补一条全局反例：**D-07 共同基线 commit 未生成前，一切未来实现与业务命令一律 NOT_RUN**（与该段末句一致，但应提升为段首总则，避免被读成局部约束）|

**D-08..D-12 轮新增的引证修订（3 项）**

|编号|准确位置|现状|问题|建议|
|---|---|---|---|---|
|**E16**|DESIGN D-12 ACK / MAIN 02 D-12「附属协议面放本包 contracts/…」|MAIN 02 写「本包 contracts/」，实际落盘在 **`docs/execution/A/relaunch-20261111/contracts/`**（`asset-inventory-v1.schema.json` 11505 B、`asset-inventory-v1.registry.json` 3611 B），**不在仓库根 `contracts/`**|仓库根 `contracts/**` 是 TASK.md:56 的 MAIN 独占区，也是 contract-freeze.json 四冻结文件所在；表述含糊可能导致后续被误放进根 `contracts/`|四文档统一写绝对相对路径 `docs/execution/A/relaunch-20261111/contracts/…`，并注明「**刻意不放仓库根 `contracts/`**（冻结区）」；同时注明两文件状态标记不同（schema `$comment` 用 `DESIGN_ONLY`，registry 用 `"status":"DESIGN_REVIEW_PENDING_NOT_REGISTERED"`），**建议统一为一个标记词**，避免后续读者误判为两种状态|
|**E17**|DESIGN D-08 ACK / TASK.md:55-56|拟新增 7 个 core 文件 + `CreatedSourcePublisher`（实测 **8/8 不存在**）已分配给「BRIDGE Claude 作为 MAIN 指定共享 core 唯一 writer」|MAIN 需落到 `03_OWNERSHIP_AND_DEPENDENCIES.json`；PRODUCT 必须确认这些文件**不在**自己的白名单内，避免双写|在 TASK 的「必须MAIN独占分配」段补一句显式清单（8 个文件全名），并注明「均为**待释放新文件**，当前不存在」；同时写明 PRODUCT 白名单与之零交集|
|**E18**|DESIGN D-08 ACK / ACCEPTANCE 变更段|D-08 写「原 change.prepare→…；原 change.apply→…」|**「原」二字易被读成既有生产路由**。实际：冻结 registry 的 31 条中确有这 3 条 change 路由，但**全部 `production:"NOT_IMPLEMENTED"`**，Host 侧无方法、生产 dispatcher 未注册|改述为「**冻结合同路由** change.prepare/change.approve/change.apply（31 条之一，全部标 NOT_IMPLEMENTED）**尚无 Host 生产者与注册路由**，D-08 是在其上**挂接新 producer**，不是改写既有生产路由」；同时补：原 `review.decide`（`workflowHandlers` 内，**当前未注册**）才是工作台一次确认+采用的主入口|

#### 4.4 D-01..D-07 轮只读核对结论

已读 MAIN `02_MAIN_CONTRACT_AND_DECISIONS.md`（已追加 D-01..D-07，状态「待领域反例核对」）与四文档的 D 轮 ACK/反例。**逐项核对结论：**

|D|MAIN 裁决候选|我已验证的代码事实|领域 ACK 是否成立|我补充的关键内容|
|---|---|---|---|---|
|**D-01**|真实本地素材输入 + Agent 发现；附属 transport/resource，inventory 固定字段，limit32/max64 + 绑定 cursor|`LocalAssetRegistry` 确只有 `list`(:312)/`import`(:325)/`resolve`(:551)；写操作要求 `trusted_ui`（`#access` write=true，:255）；list 只认认证 owner；license 3 值 + `commercial_use` boolean + label 长度（:269）；**video 的 `recording_origin` 必须为 null**、audio 限 3 值（:293）；成功只写 blob/登记/receipt/outbox `asset.local.registered`（:461）|**成立**|端点**未注册**（`src/` 零命中）；**与既有 wave2 `AssetInventoryPort` 的命名冲突**；sourceRoot 由 `NARRALENS_LOCAL_ASSETS_ROOT` 注入（E12）|
|**D-02**|`prepared-source@1` + `cp_a0_prepared_source` 映射 + discriminated resolver|created 链 `PreparedTaskFact` **无** `materialization_id`；`created-draft-processor.ts:45` 自述非提交生产者；**7 处 `state==='ready_for_adoption'` + 1 处 `native_plan!==null` 均不按 kind 判别**|**成立，但缺消费侧**|**N-1（4.2b）：8 处既有检查不 kind-aware，resolver 需新分支接入或检查需改 kind-aware**|
|**D-03**|JobReceipt.result_ref 发布后才指 package Ref；五 parts 受控引用；opaque 鉴权下载|现有 `publishReviewPackage` 已是包生产者；`review.read` 路由存在但**未注册**（B3）|**成立**|**依赖 B3 先关闭**；result_ref 发布前必须 null；补 case 引用（E13）|
|**D-04**|两种 Host-only 窄 effect；采用未完成不得宣称已采用；commit 时同 `BEGIN IMMEDIATE` 重验并消费|**反例在源码坐实**：`decideReview` 同事务写 decision(accepted) + `review_request.state='accepted'` + **gate.state='accepted'`** + `#nextRunState` 重投影 run，**且 `#nextRunState`(:1780-1785) 显式排除 `adoption` kind 的 pending gate** ⇒ 只剩 adoption gate 待办时 run 被投影 **`running`**（nextActions 给 `await_step`），而 `decideReview` **不做 commit**；`registerApproval` 仅持久化 Approval|**成立（反例正确且结构性）**|**E10：补全部源码行号 + `PACKAGE_GATE` 映射 + 「accepted gate/run running ≠ revision+1」的判据**|
|**D-05**|render/QC 不可变结果与正式 publish 分段；阶段化端口；`CommittedRenderReceiptV1`|**前提坐实**：旧 facade `render()`(`:184`) 内部 `:557` 直接 `commit.commitReady({...})`|**成立**|**E11：补源码行号 + 「新生产装配不得调用旧 facade」**| 
|**D-06**|013 observed / 015 expected 分层；缺项 unknown/pending，不扩枚举|015 只覆盖 settings/markers（`expected-projection.mjs:66-67,155-169`）；013 四 parts（`native-hydration.ts:48`）|**成立**|**E14：补 015 源码依据 + 「整工程 loaded 需另找 captions/style/film/source 独立 expected producer」**|
|**D-07**|先核 838ba5f2 + overlay，唯一 core writer 得共同 commit，再建实施 checkout|**「310」= bridge-observability `git status -uall` 实测 310 个未跟踪候选文件（5 个顶层路径）**；各 lane 实测 main 18(25 文件) / bridge 5(310 文件) / media 0 / product 0|**成立（数字准确）**|补：310 的精确归属（bridge 侧 A03-* 候选与 reviews），MAIN 冻结时应按 lane 分别列清单|

**D 轮总体结论**：D-01..D-07 的**方向与领域 ACK 均成立**，未发现编造端点、字段或「已有实现」冒充。四文档对 D-03/D-04/D-05/D-06 的反例与边界描述**经源码核对全部正确**。剩余缺口集中在 **N-1（D-02 消费侧）**、**B3（路由注册 + 端口注入归属）**、**B5（PRODUCT ReleaseAssignment + 素材授权）**，以及 **E1..E15 的引证补全**。

#### 4.5 D-08..D-12 轮只读核对结论（最终轮）

已读 MAIN `02_MAIN_CONTRACT_AND_DECISIONS.md` 的 **D-08..D-12** 与 **D-01 精确附属 DTO 补充**。**逐项核对：**

|D|MAIN 裁决候选|我已验证的代码事实|核对结论|
|---|---|---|---|
|**D-08**|wire 入口与批准唯一性：`change.prepare→CreatedSourceChangeService.prepare`、`change.apply→同服务 apply`；原 `review.decide` 仍是工作台一次确认+采用主入口，同事务生成决定+限定 Approval；Host 在该事务后经**同一 apply 服务**自动尝试已授权采用；`change.approve` 为兼容适配；拟新增 7 个 core 文件由 **BRIDGE Claude 作为 MAIN 指定共享 core 唯一 writer** 实施|**冻结 registry 的 31 路由中确有 `change.prepare`/`change.approve`/`change.apply`（全部 `production:"NOT_IMPLEMENTED"`）；但 Host 侧方法 0 命中、生产 dispatcher 未注册（`workflowHandlers` 10 条无 change.*）。⇒ D-08 的「原change.prepare」指的是**冻结合同路由**，不是既有生产路由。**<br>**拟新增的 7 个文件 + `CreatedSourcePublisher` 实测全部不存在**：`created-run-facts.ts` / `created-run-authority.ts` / `created-source-change-service.ts` / `created-source-impact-store.ts` / `created-source-adoption-store.ts` / `created-source-adoption-service.ts` / `fixed-phase-executor.ts` / `created-source-publisher.ts`（8/8 MISS）|**成立**；需在 DESIGN 注明这些是**待释放的新文件**（E17）|
|**D-09**|Change 各字段真实来源；plan_sha256 为域分离 PreparedAdoptionPlanV1 完整摘要；影响 TTL 15 分钟、同 key 重放不续期、stale 不复活；新表 `cp_a0_created_impact_fact` 无 state 列、新旧 hash 域拒绝互认|既有 `ImpactStore` 状态为 `stale`、新 `Change.state` 为 `revoked` —— D-09 已给出 adapter 投影规则；既有 `impact-service.ts` 的 `state==='ready_for_adoption'` 检查对**旧 operation** 生效|D-09 与 **N-1** 一致：新旧域拒绝互认**要求** `impact-service.ts` / `adoption-coordinator.ts` 分域解析。**N-1 由此升级为 D-09+D-02 共同的消费侧义务**|
|**D-10**|created 采用完整闭包与恢复：`Coordinator.controlledWrite` + `project_transaction(kind=edit, operation='agent.created_source.apply@1')`；`CreatedSourcePublisher` 原子 rename + 父目录 fsync + 缺口由 pending recovery gate 挡住；`RevisionStore` 新增 `commitPreparedCreatedSource` 同一 `BEGIN IMMEDIATE`；revision 恰 +1|既有 `RevisionStore.commitAdoption` 依赖 migrated projection/ledger；`AdoptionCoordinator` 走 `deps.materialize.read(request.materialization_id)` + `impact.requireCurrent` + `gateway.decide`|`CreatedSourcePublisher` 不存在（MISS）。**D-10 已把 N-1 的落点写清（`commitPreparedCreatedSource` 新分支），但 `CreatedSourcePublisher` 与 `cp_a0_created_adoption_fact` 的 DDL 尚无实现载体**| 
|**D-11**|delivery 去重键 `(project_id,run_id,plan_version,step_id,execution_attempt,producer_render_receipt_digest)`；同库 `cp_a0_render_attempt`/`cp_a0_delivery` 仍是唯一 ready 权威；新增 `cp_a0_render_evidence`/`cp_a0_delivery_phase_fact` 附属事实无 state 列；端到端命令基座 = `tests/agent-driven/media/render-snapshot.test.ts`，新增 `tests/agent-driven/integration/created-render-delivery.test.ts` 与 `created-delivery-recovery.test.ts`（**新文件，当前 NOT_RUN，不冒称已存在**）|**`tests/agent-driven/media/render-snapshot.test.ts` 确实存在**（旧 facade 的测试基座）；**两个新增测试文件实测不存在**（2/2 MISS）|**成立**；「不冒称已存在」一句经核对为真|
|**D-12**|历史证据与工具链：原 `contract-freeze.json` 是 A 实施合同权威；registry 内 `state` 是**冻结时注记**，不代表当前准入；附属协议面是**明确新增**（不计入原 31，但总暴露 = 31 + 附属路由/资源，**不能报告「总协议完全未扩大」**）；旧 PASS 只证明其绑定 SHA；**候选 `380b…` verifier 与当前 `ffef…` 不同**；Node **>= 22.15.0**；用目标 worktree 的 **corepack pnpm** 核对 **10.33.0**，**不能把 Claude PATH 下的 10.31.0 写成已满足**|① 冻结 registry **31 条路由的 `production` 全部为 `NOT_IMPLEMENTED`** —— 坐实 D-12「state 是冻结时注记」。<br>② 附属协议面文件**实际落盘在 `docs/execution/A/relaunch-20261111/contracts/`**（`asset-inventory-v1.schema.json` 11505 B，`asset-inventory-v1.registry.json` 3611 B），**不在仓库根 `contracts/`**；schema 的 `$comment` 标 `DESIGN_ONLY; …`，registry 标 `"status": "DESIGN_REVIEW_PENDING_NOT_REGISTERED"`，`implementation_writer: "BRIDGE-Claude"`，`additional_http_routes` + 1 resource。<br>③ verifier 漂移**核对为真**：bridge 侧 `A03-PREPARED-DRAFT-VERIFIER-CANDIDATE/candidate-manifest.json` 的 `source_sha256` = `380b235ff8ccc…`，与 MAIN 当前 `prepared-draft-verifier.ts` 的 `ffefbd4169df…` 不同。<br>④ 工具链（本会话实测，见 §5）：**node v22.22.1 ≥ 22.15.0 ✓**；PATH 上 `pnpm` = **10.31.0**（正是 D-12 警告的那个）；`corepack` 0.34.6；**`~/.cache/node/corepack/v1/pnpm/10.33.0` 已存在** ⇒ `corepack pnpm` 可命中**既有缓存**，**无需联网安装**（另有 12.11.2 / 9.15.9 缓存）。**我未运行 `corepack pnpm`**，以免触发下载。|**成立**；E16 补路径与标记差异|
|**D-01 精确补充**|UI POST 只发 `meta/project_id/candidate_id/source/license/recording_origin`；**Host** 解析 opaque 候选、计算 `expected_sha256`、生成会话绑定 `attestation_ref`、构造安全 `relative_path` 后调原 `import`；**不散列整个目录**，只散列用户选定项；`source.uri` 的 nullable 需显式转成旧 AssetSource 的可选字段，**不能传 null 给原校验**；候选 token 失效只影响新登记，同 key 已完成请求先重放 receipt|`LocalAssetInput`（Host 内部）实际含 `relative_path`/`expected_sha256`/`attestation_ref` —— **这些正是浏览器不得注入的字段**；`#access` 写操作要求 trusted_ui；成功路径写 blob/登记/receipt/outbox|**成立，且是对我先前 E12 的重要收敛**：UI 绝不暴露 `LocalAssetInput` 全字段。建议 DESIGN 在 RP-P5 明确「**UI DTO（RegistrationRequest）与 Host 内部 LocalAssetInput 的字段切分表**」|

**D-08..D-12 轮总体结论**：12 条裁决候选的**方向与领域 ACK 均成立**，逐条经源码核对未发现编造端点、字段或「已有实现」冒充；**D-11 的「不冒称已存在」与 D-12 的「310b/ffef 漂移」「PATH pnpm≠corepack pnpm」三处自省表述经核对全部为真**。新增待办集中在 **N-1（消费侧升级为 D-02+D-09+D-10 共同义务）**、**E16/E17/E18（路径、文件清单与 change.* 语义表述）**。

---

## 5. 现有工具链依赖存在性与未来资源要求（只读存在性检查，未运行）

|依赖|实测|结论|
|---|---|---|
|`node`|`/usr/bin/node`，**v22.22.1**|✅ 存在；**满足 D-12 的 `>=22.15.0`**|
|`pnpm`（PATH 上）|`/mnt/c/Users/Administrator/AppData/Roaming/npm/pnpm`，版本 **10.31.0**|✅ 存在，但**正是 D-12 所指「Claude PATH 下的 10.31.0」——不得写成已满足 10.33.0**|
|`corepack`|**0.34.6**；`~/.cache/node/corepack/v1/pnpm/` 下已缓存 **10.33.0**（另有 12.11.2、9.15.9）|✅ **10.33.0 已在既有 corepack 缓存中** ⇒ 目标 worktree 的 `corepack pnpm` 可命中缓存，**无需联网安装**（本轮**未运行** `corepack pnpm`，以免触发下载）|
|`npm` / `npx`|`/usr/bin/npm`、`/usr/bin/npx`|✅ 存在|
|`python3`|`/usr/bin/python3`|✅ 存在（`check` 脚本需 `python3 -I` golden）|
|`git`|`/usr/bin/git`|✅ 存在|
|`ffmpeg` / `ffprobe`|`/usr/bin/ffmpeg`、`/usr/bin/ffprobe`|✅ 存在（P11 双导出/T20 QC 前提）|
|`node_modules`（canonical / main-integration / product-workbench）|三处均存在，各 15 顶层条目|✅ 存在（**未执行任何 install**）|
|`vendor/`（openfilm 原生源码）|canonical / MAIN 均存在（`upstream-pin.json` 在 `src/host/render/`）|✅ 存在（**未读取 J 盘、未下载模型**）|
|工具链结论|**D-12 的 Node ≥ 22.15.0 与 corepack pnpm 10.33.0 两项均已具备**（后者在既有缓存中）；无工具链阻塞|**MAIN 释放时可直接使用；子窗口必须以**自身** worktree 的 `corepack pnpm --version` 为准，不得沿用 MAIN PATH 结论**|

**未来资源要求（本轮未预约、未占用）**：D1 轻量 vitest 可并行；D2/D3 的 `pnpm run check` / `pnpm run build`（含 validator check + 两个 Vite build）、多 Host、ffmpeg/GPU、browser 大 fixture、真实 60–180 秒中文录音渲染、**T20-A..H 真实自有进程丢失**均须 **MAIN 全机单槽预约**（AGENTS.md:47、MAIN 05 草案）。`check`/`build` 含全量 Vitest + Python golden + 双 Vite build，属**重型**。本轮未预占任何槽位、未启动任何进程。

---

## 6. 立即可实施票据 vs 依赖票据

**「立即可实施」= MAIN 审定并正式 release 后、无需新增业务合同即可开始的纯 UI / 现有类型负向检查；不等于本轮可写代码（本轮零代码）。**

### 6.1 依赖已满足、release 后可由 PRODUCT 单 writer 独立完成（纯组件/负向）

|票|范围|依赖|
|---|---|---|
|P-A2-UI-1|`WorkflowTopBar` 折叠横 Bar + 节点弹窗**仅观察** + Escape/关闭恢复焦点 + 不暂停任务（`src/app/observation/WorkflowTopBar.tsx`）|仅现有类型；**不依赖** B1/B2/B3|
|P-A2-UI-2|`SystemControlPanel` 非模态 aside、无遮罩焦点锁、编辑仍可用、健康 TTL 15 秒、未来/无效时间 → `unknown`（`src/app/system/SystemControlPanel.tsx`）|同上；**A 不新增模型/服务写控件**|
|P-A2-UI-3|`NativeSyncIndicator` 只显示、仅比较 5 字段、未知/过期一律 unknown（`src/app/observation/content-views.tsx`）|同上；**不得代替 Host 身份判定**|
|P-A2-UI-4|`CreativeReviewPanel` accept / accept_and_adopt 的**纯呈现**（显示本次 impact 与保留项），**不自行产生 Approval**（`src/app/observation/CreativeReviewPanel.tsx`）|同上；同事务消费仍归 MAIN（RP-P2）|
|P-A1-UI-5|`LocalAssetRegistrationPanel` 纯组件（目录读取状态 / 候选项 / 选择 / source·license·recording_origin 表单 / receipt / error），组件**不访问文件系统**，经 MAIN adapter（`src/app/observation/LocalAssetRegistrationPanel.tsx` —— **当前不存在**）|需 MAIN 释放该新文件；**未冻结 transport 前禁用提交**（RP-P5）|
|P-A1-UI-6|素材登记**负向 UI**（根未配置/目录不可读/无文件 → blocked，不扫其它盘、不上传、不扩大 root）|同上|
|P-A3-UI-7|改单镜的**定位/选中/时钟委托**（`onOpenPart` 必须委托原播放器/selection，**不自建 video clock**）+ 导出入口/失败重试指引 UI（双导出**状态**呈现，非产物）|UI 半边可做；真实产物依赖 B1|
|负向用例集|C1/C6 覆盖下的 stale / 错误 / 过期 impact / 异内容同 key / 旧 attempt / 跨 owner 等**纯 UI 呈现**断言|需 MAIN 释放 `tests/agent-driven/product/` 下精确测试文件归属（见 E8）|

### 6.2 依赖未满足、必须等 MAIN/其它领域（BLOCKED_DEPENDENCY）

|票|阻塞于|责任|
|---|---|---|
|P-A1-接线-1|内容 relay → prepare 的真实闭包、`facts`/`adoption` 注入|**B3** MAIN（未被任何 D 项覆盖）|
|P-A1-接线-2|Agent 可信 UI 素材登记 transport + 只读 MCP inventory 附属合同（RP-P5）|MAIN 冻结附属合同（**D-01** 候选：3 端点 + `narralens://projects/{id}/local-assets` resource + owner-scoped inventory；当前未注册）|
|P-A2-接线-3|样片/首章五类真实预览 producer + review_url + 受控下载路由（RP-P1/RP-P1a）|MAIN+MEDIA（**D-03**）|
|P-A2-接线-4|受控采用：impact/锁/Approval/同事务 Coordinator **revision+1**（RP-P2/RP-P2b）|**D-04** 窄 effect + **B3** 端口注入|
|P-A2-接线-5|created 链 → materialization/采用 的合法交接（RP-P2a）|**D-02** + **N-1 消费侧**（AdoptionCoordinator/ImpactService 8 处 kind-aware 改动）|
|P-A3-接线-6|正式 render/QC/publish 生产装配 + Delivery 持久化|**D-05** 阶段化端口 + **B1** 生产装配（旧 facade `render()` 不得直接用）|
|P-A3-接线-7|真实 A 素材 + **真实中文录音** + 60–180 秒 + 两主题 + 可编辑概念说明|**B5** MAIN 素材授权|
|P-A2-接线-8|Host 独立 expected（015 之外 parts）+ 真实原生 observed + Ack 生产（RP-P4/RP-P4a）|**D-06**（015 只覆盖 settings/markers）|
|全路径|覆盖 PRODUCT 的 **ReleaseAssignment**（含精确 base/overlay/合同 hash、白名单、资源、命令、停止/回退）|**D-07** 共同 commit + **B5** ReleaseAssignment|

---

## 7. 公共合同请求（仅提请求，**不改**公共合同、不新增生产 API、不改 wire）

冻结四文件 `contracts/agent-driven-a.schema.json` / `agent-driven-a.registry.json` / `src/contracts/agent-driven-types.ts` / `src/contracts/agent-driven-validator.ts` **逐字节未改**，本轮无任何修改。以下为**请求**，由 MAIN 裁决（AGENTS.md:28、11_AGENT_DELIVERY_PROCESS.md:37）：

|编号|请求|类型|MAIN 决定|
|---|---|---|---|
|C-1|**Host 安全目录枚举 + 素材登记附属 UI transport**（受控相对目录候选 DTO：显示名 / 相对路径 / opaque 选择引用 / 分页 / 根版本绑定 / 过期；登记 receipt 公开投影）|**新附属合同**，不改 80defs/31routes|D1 新 wire 须显式 ADR/版本 + producer-consumer 合同测试；不编造端点（RP-P5）|
|C-2|**只读 Agent inventory**（按 project 读 asset_id/rights_ref/摘要），**不新开读源/写权、不启动 probe/render、不注册**|**MCP 附属能力**，非原 80defs 变更|由 MAIN 注册；**PRODUCT 不自行扩 wire**（RP-P5）|
|C-3|**Host 独立 expected 的补全 producer**（015 仅 settings/markers；captions/subtitle_style/film/source 闭包需独立 expected 与真实原生 observed）|**新 producer 责任**，不是 UI 组件责任|**不允许由 PRODUCT 显示组件填补未知**（RP-P4a）|
|C-4|**prepared-source → materialization_id 的合法不可变映射**（或显式新版本合同）|**合同裁决**|**禁止伪造 M3 materialization/migration**，不原地扩冻结 80defs/31routes（RP-P2a / B2）|
|C-5|**QC / 采用 Gate 的唯一 writer** 与 waiting_user 下的 review→change 动作门|**职责裁决**|不得绕过 execution-guard；不得形成「必须先正式 commit 才允许审阅」的循环（RP-P2b / B4）|
|C-6|**created 导出路由 + 幂等键 + 快照 CAS**（M5 delivery-preview 阶段已有，缺 producer）|**路由注册裁决**|MAIN 指定注册路由与幂等语义，PRODUCT 不自热开能力（RP-P3 / E4 / B1）|
|C-7|**Ref namespace / 摘要验证**（Agent 发现素材的合法方式）|**合同裁决**|不得把测试 fixture 形态当隐式生产协议（RP-P1a / MC-03）|
|C-8|**LOCAL 素材登记的 A 素材授权**（真实授权素材 + 真实中文录音；`recording_origin` 须为有真实人录证据的 `human_recording`，不由扩展名推定）|**授权 + fixture**|**B5**；`never substitute synthetic speech`|

---

## 8. 本轮业务验收

**全部 NOT_RUN。** 具体如下（本轮**一条也未执行**）：

|项|状态|
|---|---|
|C1 `pnpm test tests/agent-driven/product`|NOT_RUN|
|C2 / C3 / C4 / C5 / C6 / C7 / C8|全部 NOT_RUN|
|`pnpm run check` / `pnpm run build`|NOT_RUN|
|P01..P13（含新增 P13 受控素材选择与登记）|**全部 NOT_RUN**（P03/P05/P06/P07/P09/P11/P12 的真实组合 harness 尚待 MAIN 装配）|
|**D-01..D-07 追加反例段 / D-08..D-12 派生的验收义务**|**全部 NOT_RUN**。D-11 明确列出的 `tests/agent-driven/integration/created-render-delivery.test.ts` 与 `created-delivery-recovery.test.ts` **实测不存在**（2/2 MISS），D-08/D-10 的 7 个新 core 文件 + `CreatedSourcePublisher` **实测不存在**（8/8 MISS）—— 即「不冒称已存在」为真，且这些用例**当前无从执行**|
|T20-A..H 恢复矩阵|**NOT_RUN**（缺真实自有进程丢失 runner，命令由 MAIN 核实后补）|
|A-COLD / A-MCP / A-CREATE / A-FILM / A-WRITE / A-ENTRANCES / A-EVENTS / A-CANCEL / A-UI / A-REOPEN|**NOT_RUN**（本轮无组合装配）|
|产品人工验收 / 用户人验|**NOT_RUN**；**未代签**|
|**独立验收**|**未做**。本文件是**领域子 Claude 的只读 readiness**，不是独立审查，不自签独立验收、不代签人验、不代表任何阶段 PASS。|

本轮**未执行**任何：产品测试、build、安装、渲染、服务启动、业务脚本、`git commit/merge/push/cherry-pick/rebase/reset/stash`、配置更改、新外传、密钥/J盘读取、子 agent。仅使用只读 `cat/rg/git status/git rev-parse/sha256sum/ls` 与依赖目录存在性检查；**未运行也未 import 任何产品模块**。

---

## 9. 结论与下一步

1. **四文档 = BLOCKED（文档层，范围已收窄）**。证据层准确率极高、**无编造 API/端点/字段**；**D-01..D-12 两轮裁决候选的方向与领域 ACK 经源码核对全部成立**（含 D-04 提前绿灯反例、D-05 的 `commitReady` facade 前提、D-07 的「310」、D-11 的「新文件不冒称已存在」、D-12 的「380b≠ffef 漂移」与「PATH pnpm≠corepack pnpm」）。剩余：**4 项必须 MAIN 裁决** —— **N-1**（消费侧 kind-aware：8 处 `state==='ready_for_adoption'`/`native_plan!==null` 检查，现已明确为 D-02+D-09+D-10 的共同义务）、**B3**（`workflowHandlers` 注册 + `facts`/`adoption` 注入归属，**D-08..D-12 未覆盖**）、**B5**（覆盖 PRODUCT 的 ReleaseAssignment + A 素材授权）、**D-04/D-05/D-08..D-11 的生产装配与 owner 落表**；以及 **18 项可由 PRODUCT Codex 直接修订**（E1..E18）的引证与措辞。
2. **E1..E18 由 PRODUCT Codex 直接修订**即可，不需 MAIN 裁决；**N-1 / B3 / B5 / 生产装配归属**必须 MAIN 逐项裁决并写进 `06_MAIN_REVIEW_AND_START_GATE.md`。**E10 是最关键的一条**：D-04 的提前绿灯不是理论风险而是**结构性事实**（`#nextRunState` 显式排除 `adoption` kind ⇒ run 被投影 `running`），必须在 D-04 生产接线与验收中拦住。**E5 的更正同样关键**：change.prepare/approve/apply 是**冻结合同路由（全部 NOT_IMPLEMENTED）**，不是「仅拟定的 MCP 名」，也不是既有生产路由。
3. **模型/供应商**：会话报告 `MiniMax-M3.1-Flash-Preview[1m]`，配置端点 `https://api.minimax.cn/anthropic` → 供应商 MiniMax，**CONSISTENT**；未切模型、未换供应商、未改配置；配额/账户/凭据归属 **UNKNOWN**（未读凭据值）。
4. **工具链**：**无阻塞** —— node **v22.22.1 ≥ 22.15.0** ✓；corepack 0.34.6 且 **pnpm 10.33.0 已在既有缓存** ✓（PATH 上的 10.31.0 不可作数）。本轮未安装、未联网。
5. **开发启动门：关闭。** 编码启动必须等待 ① MAIN 对 N-1/B3/B5/生产装配归属的明确裁决、② MAIN 审定四文档修订（E1..E18）、③ 按 D-07 产出共同可复现 commit 后签发覆盖 PRODUCT 的**完整 ReleaseAssignment**（精确 base/overlay/合同 hash、白名单、资源、命令、停止与回退）、④ 领域 Codex 发出 bounded 任务包并指定唯一 writer。当前**不启动任何编码**。
5. **未来开发自验证（仅供检查计划，不是本次授权）**：按 TASK 单 writer + 精确白名单实施；ACCEPTANCE 命令从 MAIN `package.json` scripts 出发；逐 case 记录前后事实/产物 hash/退出码/**首次失败**与**变异反例**；整体链与重型资源由 MAIN 预约；正式交付按 TASK HANDOFF 模板；**停 A 人工门不进 B**；429 时**不得擅改配置或模型**，按 Orca 报告并由领域 Codex 确认原 writer 已停后接管。

**已写路径**：`/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/relaunch-20261111/product/CLAUDE_READINESS.md`（本文件，唯一写入）。**未做实现，未做产品验收，未做独立验收。**
