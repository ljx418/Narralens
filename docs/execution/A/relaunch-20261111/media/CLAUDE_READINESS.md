# MEDIA A · Claude 只读接手检查报告（CLAUDE_READINESS）

状态：`READINESS_REVIEW_COMPLETE`；本文件是唯一被写入的文件。本轮**不是**实现release，**不是**开工许可。全部业务测试/构建/渲染/服务启动 **NOT_RUN**；本文不含任何产品PASS、独立验收或人验签署声明。

---

## 1. verdict

**READY_WITH_BLOCKERS**

四份文档（D-01..D-07 裁决候选 + DESIGN/ACCEPTANCE/TASK）整体可接手：实体、符号、输入hash、白名单与可先实施范围都具体到文件/行/符号级别，且**与MAIN实际代码逐条核对后基本相符**（下文第4节给出可复核的验证结果）。但存在 **5 个 P0**：其中 3 个是MAIN裁决口径本身的缺口（不是MEDIA文档写错），2 个是D-04/D-05措辞与真实持久字段/真实代码流程不符。P0 未闭合前，不得把 A-MEDIA-3 的分阶段 render 实现当作可开工范围。**公共合同项一律由MAIN裁决，MEDIA不自签冻结。**

未出现路径不可达、缺失依赖、漂移或被覆盖的 dirty —— 这些阻塞不存在。

---

## 2. actual CLI / cwd / OS / Orca 身份 / 模型观察

| 项 | 观察值 | 证据来源（只读） |
|---|---|---|
| actual CLI | `claude` 2.1.300 (Claude Code)，`/home/administrator/.npm-global/bin/claude` | `which claude; claude --version` |
| 会话工作目录 | `/mnt/c/workSpace/videoWorkLine` | `pwd`（harness 声明的primary working directory，与 `pwd` 一致） |
| 实际取证目录 | `/mnt/c/workspace/videoworkline/Narralens`（canonical）、`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`（MAIN） | `ls`/`git` |
| OS / 平台 | Linux 6.18.40.1-microsoft-standard-WSL2，Windows 主机 `WIN-IDGU3FG2NTF`，WSL2 | `uname -a` |
| Orca 本任务 | task `task_2594e5bbcaa2`，dispatch `ctx_14a7ed7e66e3`，from `term_37251bd1-b0d6-4846-9a8f-28fd5aafb376` | Orca 注入的CLI参数（**未照抄父ID**） |
| 父任务 / 协调handle | 父 task `task_cb34e517149a`；MEDIA协调者 handle `term_d6cb9559-1366-4b42-849a-3ee926ccc58b`；MAIN handle `term_a731c232-35c7-4f55-a75d-9b2beeade398` | 任务书 + Orca 消息 |
| session model observation | 会话环境显示的模型标识为 `MiniMax-M3.1-Flash-Preview[1m]`（非敏感会话元信息） | 会话自身显示 |

**MiniMax match: YES** —— 依据仅为上述**会话已显示的模型标识**，以及标识本身点名 MiniMax。
明确声明：**未**因产品品牌名（"Claude Code"）推断供应商；**未**读取任何凭据、token 或配置中的 secret；**未**声称对供应商账户/额度做过任何验证。CLI 品牌名与模型标识是两件事，本结论只覆盖"会话显示的模型标识"这一层。

---

## 3. 路径可达性、HEAD/dirty、依赖与上游

### 3.1 可达性（全部 OK）

| 路径 | 结果 |
|---|---|
| canonical `/mnt/c/workspace/videoworkline/Narralens` | 可读可写（仅本次报告文件被写）；Windows 映射 `C:\workSpace\videoWorkLine\Narralens` 同目录 |
| MAIN `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` | 可读；`.git` 是 worktree 指针（`gitdir: .../Narralens/.git/worktrees/main-integration`）→ canonical 与 MAIN 是同一仓库的不同 worktree，**不是**独立clone |
| `docs/execution/A/relaunch-20261111/{00,02,05,baseline-observed.json}` 与 `media/{DESIGN,ACCEPTANCE,TASK,CLAUDE_PROMPT}.md` | 全部存在可读 |
| 上游 OpenFilm | `/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm` HEAD = `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` —— **与固定pin完全一致**（`contracts/openfilm-upstream-lock.json` 亦为同值） |
| vendor 子模块 | `vendor/OpenMontage` @ `9327439…`，`vendor/hypit` @ `6fdd8c0…`（submodule，非 OpenFilm pin，本轮未用） |
| J盘 | 未访问（符合约束） |

### 3.2 HEAD + dirty 与归档匹配（DESIGN 声明"25项全部匹配=True"**已独立复核为真**）

| worktree | HEAD | 实测 dirty | 归档 dirty_files |
|---|---|---|---|
| MAIN main-integration | `838ba5f2c8500f0103f56dbe51264ea9f70086fc` | 18 条 git 条目（9 个已跟踪 M + 9 个 ??，其中 5 个是未跟踪目录） | 25 个文件，**逐个 SHA256+bytes 全部匹配**（ok=25 / diff=0 / missing=0） |
| canonical | `ca5b67a8285b130c79055317c6202f73cfbb99c8` | 5 M + 若干 ??（文档类） | 非本轮主体 |
| bridge-observability | `50f4e193…` | 310 个 dirty 文件（历史候选） | 已归档，未动 |
| product-workbench | `07399c230023591b…` | 0 | — |
| media-delivery | `480561a9c08cc820…` | 0 | — |

- **Git index 干净**：`git diff --cached --name-status` 为空；全部 dirty 都是工作树未暂存修改 + 未跟踪文件。**未**执行任何 git 写操作（无 add/commit/reset/stash/cherry-pick/rebase/push）。
- 归档自身 SHA256 = `f31f82d57a3eb2df6608b6fc47ffab68124ca8bb1e0d038c0c231838bd19e38a`，与 DESIGN 第7节所写**一致**。
- 归档 `worktrees[main].archive_sha256` = `6efbb7963258d50cec2cd537d24f0cfb91b3b00cef368d63e7142899d94ae94e`，`archive_content_verified=true`。
- `baseline-observed.json` 是**唯一权威归档**（4 worktree、25 MAIN dirty）；旧的 `docs/execution/A/baseline-observed.json` 已被正确弃用 —— DESIGN 的表述准确。
- **归档"25 dirty"与 git status"18 条目"的差异已核实为纯计数口径差**（git 把 5 个未跟踪目录折叠成 1 条），**不是漂移**。唯一一条看似不匹配的是 `src/host/agent-driven/created-task-gate.ts`（同时出现在"归档未live"与"live未归档"两个集合），复核后确认是集合比较脚本的切片口径问题，该文件**同时存在于两侧**且字节匹配。

### 3.3 关键 hash（DESIGN 表 14 项 + CP-A0 4 项 —— **全部逐字节复核通过**）

| 文件 | 复核结果 |
|---|---|
| `src/host/agent-driven/created-draft-processor.ts` | `6727b0b6…eeef5` ✅ |
| `src/host/agent-driven/prepared-draft-verifier.ts` | `ffefbd41…276db` ✅ |
| `src/host/agent-driven/created-task-store.ts` | `d7a4734c…b14` ✅ |
| `src/host/agent-driven/created-task-worker.ts` | `41a76585…34c4` ✅ |
| `src/host/agent-driven/creation-application.ts` | `20247ab1…92f9` ✅ |
| `src/host/agent-driven/committed-snapshot-authority.ts` | `91fd1e8b…d0aa` ✅ |
| `src/host/engine/source-digest-v1.ts` | `d32dfc43…c599d` ✅ |
| `src/host/render/native-draft-assembler.ts` | `1b8a6bc4…8877` ✅ |
| `src/host/render/ports.ts` | `06ab9bea…e6a` ✅ |
| `src/host/render/render-snapshot.ts` | `cb5d187e…7e46` ✅ |
| `src/host/delivery/qc.ts` | `05f7efc0…7310` ✅ |
| `src/host/delivery/delivery-service.ts` | `114f701a…fb90` ✅ |
| `src/host/delivery/download.ts` | `b01d97ac…1003` ✅ |
| `package.json` | `edace26f…3263` ✅ |
| CP-A0 四件（schema/registry/types/validator） | 与 `contract-freeze.json` 所载 SHA256 **全部相符** ✅（freeze 状态 `FROZEN_FOR_A_IMPLEMENTATION`，`registration: NOT_YET_REGISTERED_IN_HOST`，`humanProductAcceptance: NOT_RUN`） |

DESIGN 与 ACCEPTANCE 引用的**所有**测试文件（16 个）与**所有**白名单模块文件（11 个）在 MAIN 工作树中**均存在**（已逐个 stat）。

### 3.4 本地依赖可达性（仅读版本元数据，**未启动任何测试/服务**）

| 依赖 | 版本 | 说明 |
|---|---|---|
| node | v22.22.1 | ✅ |
| pnpm | 10.33.0 | ✅（ACCEPTANCE 的 `pnpm test` / `pnpm exec` / `pnpm run` 可用） |
| npm | 10.9.4 | ✅ |
| python3 | 3.12.3 | ✅（`check` 链里的 `python3 -I …impact-hash.golden.py` 前提满足） |
| ffmpeg / ffprobe | 6.1.1-3ubuntu5 | ✅（C4/QC/完整decode 的前提存在） |
| Chromium | Windows `C:\Program Files\Google\Chrome\Application\chrome.exe` | ✅（Headless 前提存在；**未启动**） |
| MAIN `node_modules` | 顶层 15 项 + `.pnpm` 264 包；`.bin` 含 tsc / tsserver / tsx / vite / vitest | ✅ 依赖树完整，**未安装任何东西** |
| vitest | `include: ["tests/**/*.test.{ts,tsx}"]`，`maxWorkers: 1` | ✅ C1–C4 的所有路径都被 include 命中；**并发已是 1，ACCEPTANCE 的"无提高并发"成立**。注意：全量 `check` 因 maxWorkers=1 会显著变慢，重型槽预约时按此估算 |

**未安装、未下载、未联网、未付费、未渲染、未启动服务。**

### 3.5 合同规模复核（MC-01 的实际状态）

- schema `$defs` = **80** ✅
- registry `routes` = **31** ✅
- `TaskPrepare.kind` enum = **仅** `["assemble_draft","render_snapshot"]` ✅（无第三种；TaskPrepare.kind 保持成立）
- `JOB_KINDS_V2` = `["proposal_comparison","render","snapshot_publish","materialize"]` ✅（**已有** render 与 snapshot_publish 两个 kind 可承载分阶段，无需新增）

---

## 4. 四份文档可接手程度（逐份）

### 4.1 `02_MAIN_CONTRACT_AND_DECISIONS.md`（D-01..D-07）—— 可接手，但 D-04/D-05 有 P0 措辞缺口

公共边界 MC-01..MC-14 与"永久锁定"表与代码一致；D-01..D-07 提出的接缝在**方向上**与代码事实吻合，且多数不需要动冻结合同。逐条 ACK 见第 5 节。

### 4.2 `05_MAIN_ACCEPTANCE_AND_REVIEW.md` —— 可接手

大阶段组合门、T20-A..H 语义、文档开工门7条与代码/流程一致；T20-E 的四个真实终止点（encode后QC前 / QC后publish前 / publish后DB前 / DB后events前）在代码里能找到对应边界（`render-snapshot.ts` 的 12 个编号步骤与 `onBoundary` 钩子）。"本轮业务测试一律NOT_RUN" 已如实标注。

### 4.3 `media/DESIGN.md` —— **可接手程度最高**，事实核验几乎全中

已核实为**准确**的关键断言（逐条附证据）：

- "assembler/processor/verifier 已有真实实现" → `CreatedDraftTaskProcessor`（`created-draft-processor.ts:47`）、`PreparedDraftVerifier`（`prepared-draft-verifier.ts:66`，`#proofs=new WeakMap<object,RecordProof>()` 行69）✅
- "proof 是 WeakMap 对象能力、JSON/复制 token 不能伪造" → 行69 + `proveExisting`（行248）+ `assertCurrent`（行255，要求当前 lease）✅
- "SnapshotRenderService 实例只在诊断CLI，不能说生产已ready" → **核实为真**：`new SnapshotRenderService` 在 `src/` 下**零命中**，唯一实例点是 `tools/agent-driven/media/render-delivery.ts:159`（诊断 sink）✅
- "dispatcher 当前未装配 task.prepare/正式render/delivery" → **核实为真**：`application-dispatcher.ts` 仅注册 creative + workflow + instance/health/context/project.create/job.read，**无** task.prepare、无 render、无 delivery ✅
- "80defs/31routes 保持" ✅
- "TaskPrepare.kind 不增加" ✅（枚举只有2值）
- "CommittedSnapshotAuthority 只认 registered created-source producer" → **核实为真**：`committed-snapshot-authority.ts:58-59` 找不到 sourceFact 即 `CAPABILITY_UNAVAILABLE 'This snapshot has no registered created-source producer'`；且 `transaction.state==='committed'`、`snapshot.engine==='openfilm'`、`source_digest===transaction.source_digest_after`、`revision=base_revision+1` 全部逐项校验（行52-57）✅
- "ImpactService 走 resolveActivated / MaterializationStore / MaterializeService / MigratedAssetLedger" → **核实为真**（`impact-service.ts:120,222,240,515,529`）✅
- "AdoptionCoordinator.adopt 显式读 materialization" → **核实为真**（`adoption-coordinator.ts:152,241,668`）✅
- "ProjectCreationStore.commit 是 bootstrap reservation、revision=1 专用事务" → **核实为真**（`project-creation-store.ts:220` 读 `created_source_fact`、行273 插入；表带 `IMMUTABLE_CREATED_SOURCE_FACT` 触发器禁止 UPDATE/DELETE，行60-61）✅
- "既有 render 端口逐字段约束" 与 `ports.ts`（`SnapshotEntry`/`SnapshotRightsFact`/`SnapshotClosure`/`SnapshotReadRequest`/`AttemptIdentity`/`AttemptFencePort`/`DeliveryCommitRequest`/`DeliveryCommitPort`/`RenderRequest`/`RenderOutcome`/`RenderPort`）**逐字段吻合** ✅
- "DeliveryManifest 既有字段逐项保留" → `buildDeliveryManifest` 的入参（`render-snapshot.ts:502-519`）与 `validateReceipt` 强制的字段（`published-package-store.ts:664-679`）一致 ✅
- "Draft-processor-real 日志是3秒诊断" → `docs/execution/A/logs/draft-processor-real-*/observed.json` 自述 "real synthetic registered media + actual source-only processor; not production Run rights/MCP/human voice/adoption/Delivery"，`result_ref: null`、`next_actions:["review_prepared_source"]` ✅ 与"未闭环"清单一致

DESIGN 唯一需要修订的硬缺口见 P0-1（encode→QC 断点）。

### 4.4 `media/ACCEPTANCE.md` —— 可接手；命令目录**已核实准确**，M09/M10 需要按 P0-1/P0-5 收紧

- "现有 scripts：test/build/check" → **与 MAIN `package.json` 逐字相符**：`test`=`vitest run --config vitest.config.ts`；`build`=`tsx tools/build-native-workbench-validators.ts --check && vite build && vite build --config vite.m5.config.ts`；`check`=`tsc --noEmit && vitest run … && python3 -I tests/wave2/m4a/impact-hash.golden.py … && vite build && vite build --config vite.m5.config.ts` ✅
- "没有 `test:media` 或生产导出E2E script，不编造" → **核实为真**：package.json 40+ 个 script 中无 `test:media`、无生产导出 E2E ✅
- C1–C5 所列 16 个测试文件 **全部存在**，路径与 vitest include 命中 ✅
- "现有 `tools/agent-driven/media/render-delivery.ts` 是 diagnostic sink，不能用它签生产ready" → **核实为真** ✅
- T20-E 拆成 E1..E4 四点，与代码边界一一对应 ✅
- M09/M10 已含正确反例（M09："在chapters直接调用整体render即使把commitReady替换no-op，也因已经publish而失败"；M10："manifest.attempt错用encode attempt"为失败）→ 与第 5 节 P0-1/P0-5 方向一致，但**缺少 encode 事实这一项断言**（见 P0-1）

### 4.5 `media/TASK.md` —— 可接手；白名单、票据、启动恢复记录**均与现场一致**

- MAIN HEAD/canonical HEAD/CP-A0 文档commit/OpenFilm pin 四项与现场**全部一致** ✅
- 白名单 11 个模块文件 + 8 个测试文件**全部存在**；"MAIN 独占、MEDIA 只读"清单（`created-draft-processor.ts`、`prepared-draft-verifier.ts`、`created-task-store.ts`、`created-task-gate.ts`、`created-task-worker.ts`、`creation-application.ts`、`local-asset-registry.ts`、`committed-snapshot-authority.ts`、`source-digest-v1.ts`）与 `git status` 的 dirty 分布**吻合** ✅
- "A-MEDIA-1/2/3"三票据的依赖表述与代码接线状态吻合 ✅
- **启动恢复记录属实**：首次 CLI 读取 spec-file 阶段 ENOENT（Windows 进程把 WSL 路径误解成 `C:\mnt\c`），未返回 Task/Dispatch、未创建 MEDIA Claude worker；本窗口**不是**那次失败启动的重试，是**新的一次实际 dispatch**（task `task_2594e5bbcaa2` / dispatch `ctx_14a7ed7e66e3`）。本轮全程只读，未 fresh 启动、未 poll、未自建 PTY ✅

---

## 5. D-01..D-07 逐条 ACK 与具体反例

| 裁决 | ACK | 核实与反例（附代码位置） |
|---|---|---|
| **D-01** 素材输入/Agent发现 | **ACK（可实施，需MAIN给路由与白名单）** | `LocalAssetRegistry.import(input, caller, signal)` 存在（`local-asset-registry.ts:325`），入参 `LocalAssetInput{project_id, idempotency_key, relative_path, expected_sha256, kind, source, license, recording_origin, attestation_ref}`（行20-30）；Host 侧真实做 `realpath`/containment 校验并自算 digest（行380-385），**不信任 expected_sha256** ✅ 与 D-01 措辞一致。**反例/注意**：该方法是**同步调用方必须是 trusted caller**（`#access(project_id, caller, true)`），D-01 的三个 `/api/ui/v1/...` 路由在 **31 条冻结路由之外**、属独立附属 transport —— 与 D-01 "不改原31路由" 一致 ✅；但需 MAIN 明确这三个路由的注册位置与鉴权（`trusted_ui` + owner + origin）归属，否则会被 `ApplicationDispatcher` 的"缺 handler 即 CAPABILITY_UNAVAILABLE"（`application-dispatcher.ts`）静默变成不可用。 |
| **D-02** ps_ 命名空间 | **ACK（wire 兼容成立；消费者清单须补）** | ✅ wire 无需改动：`PrepareChange.materialization_id` pattern `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`（schema `$defs.PrepareChange`）容纳 `ps_`+60hex（63字符）；`Change.materialization_id` 是普通 string（`agent-driven-types.ts:31`）；80defs/31routes/registry 全部不动。**具体反例**：唯一 materialization 读路径是 `ImpactService.#readMaterialization` → `deps.materialize.read(id)`（`impact-service.ts:515,529`），`AdoptionCoordinator.adopt` 另有两处 `materialize.read`（`adoption-coordinator.ts:152,241`）与 `:668`；`fixed-workflow-service.ts:1204,1211` 会把 `impact.materialization_id` 抄进 workflow/checkpoint 记录。⇒ **D-02 需显式枚举这三个 MAIN 独占文件的分派改造**（`src/host/impact/impact-service.ts`、`src/host/adoption/adoption-coordinator.ts`、`src/host/creative/fixed-workflow-service.ts`），否则"只按字符串过 schema"就会命中旧 M3 消费者。DESIGN 已正确指出这一点 ✅，D-02 应补上清单。 |
| **D-03** result_ref→ReviewPackage Ref | **ACK（成立，且无需新 wire）** | ✅ `JobReceipt.result_ref: Ref | null`（`agent-driven-types.ts:13`），`Ref={id,version,sha256}`（行3）—— 直接可用；`publishReviewPackage` 已把包作为 artifact 实体落库、`artifactId = input.package_id`（`fixed-workflow-service.ts:933`）、`review_url=/workbench/projects/{pid}/reviews/{package_id}`（行911）、`ReviewRead={project_id,run_id,package_id}`（行69）、`review.read` 路由已在 registry（route 28）且已装配 handler（`application-dispatcher.ts` workflowHandlers）✅。`ArtifactContent` 仍只有 Script|Storyboard（行18）→ D-03 "不经ArtifactPut伪装" 与代码一致 ✅。**补充**：`result_ref` 指向包 Ref 时，`execution.run_id + ref.id` 足以定位 review，但 `review.read` 还需要 `project_id` —— 文档宜写全三元组。 |
| **D-04** 两种 Host-only 受限 effect | **ACK 方向；措辞须改（P0-3）** | ✅ 现状**已经**无循环：`A_STAGE_ACTIONS`（`execution-guard.ts:73-80`）sample/first_chapter/chapters/cover 均允许 `change.prepare/change.apply`；`A_STAGE_GATE_REQUIREMENTS`（行86-93）chapters 只依赖 `first_chapter` 门、cover 依赖 `chapter_pack`、delivery 依赖 `cover`；`A_ACTION_GATE_REQUIREMENTS`（行105-112）`delivery.package` 才需要 `qc` 门 ⇒ **采用/审批完全不需要先有正式导出**，D-04 的"消除阶段循环"目标在代码里已经成立。**P0-3 反例**：`SOURCE_ONLY` **不是 job kind**，而是 job 表的 `terminal_reason` 列值（`created-task-store.ts:234` 调 `completeCallback(..., 'SOURCE_ONLY', ...)`，`revision-store.ts:1053-1059` 将第6参写入 `terminal_reason`）；`job.kind` 恒在 `JOB_KINDS_V2` 内（`created-task-store.ts:150,166` 强制）。D-04 的"真实succeeded SOURCE_ONLY job"必须落成可判定断言：**`job.state='succeeded' AND job.terminal_reason='SOURCE_ONLY' AND provider_receipt_json.kind='local.native-draft@1'`（其 payload 内 `stage:'SOURCE_ONLY'`）+ 该 job 的 `created_task_prepared` 不可变事实**。 |
| **D-05** render/QC/publish 分段 | **ACK 方向正确；两处必须补（P0-1、P0-5）** | ✅ 冻结面保持：`FIXED_PLAN` 的 `execution_digest` 由**计划文档**（stages/capabilities）算出（`digest.ts:238-260`），**不含** `A_STAGE_ACTIONS` ⇒ 阶段→阶段动作矩阵可以扩充而不动 80defs/31routes/registry/digest；`A_ALLOWED_ACTIONS` 已有 `qc.inspect`、`delivery.package`；`A_STAGE_ACTIONS.delivery=["qc.inspect","delivery.package"]` 已给出"delivery 阶段做 QC 再打包"的现成口径 ⇒ 分段**不需要新 TaskPrepare.kind、不需要新 job kind**（现有 `render` / `snapshot_publish` 即可），也**不需要第5种能力**（`capabilityFingerprint` 强制恰好4个描述符）。**P0-1 见第6节。P0-5**：`execution-guard.ts` 头部契约明写"the guard deliberately does not **not** mark a gate accepted, never advances a step and never creates an artifact"，且 `delivery.package` 依赖 `qc` 门、`FIXED_PLAN` 给 delivery 阶段 `review:"qc"` ⇒ D-05 的"自动调度 qc.inspect → **记录真实qc Gate** → delivery.package"若被读成"执行器自动接受qc门"，与守卫契约冲突且构成自动放行。D-05 应改为：**执行器产出 QC 证据 + 提交 qc 审阅包；qc 门由既有决定路径（review.decide）接受；接受之后 delivery.package 才可派发**。 |
| **D-06** NativeAck 分层 | **ACK（与 MAIN MC-10 一致，MEDIA 不实现）** | 属 PRODUCT/MAIN 的 observed 观察面；`MC-10` 已要求 Job完成/commit完成/NativeAck 三事实独立。MEDIA 侧只需保证不把 Job success 推导为 ack（DESIGN 已声明）✅。本轮未核 013/015 模块实现细节（不在 MEDIA 范围，且属产品实现非本轮任务）。 |
| **D-07** 实施基线与所有权 | **ACK（可执行）** | ✅ HEAD `838ba5f2…` + 25 dirty overlay 归档已复核一致（见 3.2）；`git worktree list` 显示 4 个 lane worktree + openfilm spike worktree；桥接 worktree 确有 310 个未提交候选。⇒ "第一实施动作校验 fullSHA+overlay哈希" 可执行；"共同commit值不能提前编造"与本报告一致（**本报告不给出共同commit**）。 |

---

## 6. P0 / P1 缺项清单（按严重级；公共合同项标 [MAIN裁决]）

### P0-1 [MAIN裁决 + MEDIA实现] D-05 的 `CommittedRenderReceiptV1` **无法覆盖 encode→QC 断点**（协调者点名）

**代码事实**（`src/host/render/render-snapshot.ts`）：
1. 步骤5 编码输出写到 **本次 attempt 的 staging 目录**：`outPath = resolve(staging, PACKAGE_FILES.media)`（行280-296）；staging 目录名来自 `packages.createStaging(\`attempt${request.attempt}\`)`（行260），实际目录名 = `<label>-<randomUUID>`（`published-package-store.ts:226-231`）—— **不含 job_id**，因此崩溃后无法按 job 归属。
2. 步骤7 `runQualityControl` 读该 staging 内的成品（行342；`qc.ts:211`）。
3. 步骤9-10 才把字节 hard-link 出 staging 进 `objects/<uuid>` 并把 receipt link 到 `published/<package_id>`（`published-package-store.ts:287-397`，含 `#syncFile`/`#syncDir`）。
4. `finally` 对 staging 执行 `discardStaging`（或 `quarantineStaging`）（行597-607）。

**推论**：`narralens.delivery_package_receipt@1.0` 只能在 **QC 之后**产生（它强制 `qc` 字段、`validateReceipt` 校验 `receipt.attempt===manifest.attempt`），因此 D-05 名为"CommittedRenderReceiptV1"的事实**无法表示"已编码但未QC"**；同时 T20-E1（encode后QC前真实终止并重启）要求的"已编码持久证据"目前**不存在**：staging 既会被 finally 丢弃，又没有 job 归属。

**建议（供 MAIN 冻结口径）**：
- 在 D-05 中补一条 **QC 之前的 encode 事实**（MAIN 命名表/字段，例：DESIGN 末节已提的 `CommittedEncodeFact@1`）：`job_id + producer_execution(attempt) + snapshot_id + source_digest + render_config_digest + media{object_id, sha256, bytes} + 预期 frames/duration + created_at`，**不含 QC 字段**。
- 编码完成后**先把媒体对象搬进 Host 拥有的 immutable objects 根**（复用 `PublishedPackageStore` 已有的 `objects_dir`/`object_id`/`#syncFile`/`#syncDir` 原语，`published-package-store.ts:204,287+`）并 fsync，再在原 Job 事务里登记该事实，**然后**才允许释放本次 staging。事实登记前崩溃 ⇒ 对象为 orphan（待对账，不向 review 公开）；事实登记后崩溃 ⇒ 按事实重新 hash 而非重编码。
- **不得**新增第二套提交状态机（沿用原 Job/lease/step_attempt 权威），**不得**把 staging 路径本身当持久引用。
- 明确"事实表 DDL 属 MAIN 独占"（TASK 白名单已如此规定）；MEDIA 侧可实施范围 = `src/host/render/render-snapshot.ts` + `src/host/delivery/published-package-store.ts`（两者**均在** MEDIA 白名单内）——即"步骤抽取 + 对象登记"这部分**在 MAIN 给出表/字段后即可开工**。
- ACCEPTANCE M10 需增加断言：真实 kill 于 encode 完成、QC 之前 ⇒ 重启后存在**绑定了该 job/attempt 的已编码对象**且可复验 hash，**无重编码**、无静默丢中间文件。

### P0-2 [MAIN裁决 + MEDIA实现] `chapters` 阶段借 `snapshot.render` 提前产出 `delivery.package` —— **成立且当前无技术拦截**

- `A_STAGE_ACTIONS`：`chapters:["snapshot.render","change.prepare","change.apply"]`、`cover:["snapshot.render",…]`、`delivery:["qc.inspect","delivery.package"]`（`execution-guard.ts:73-80`）。
- `TaskPrepare.kind` 只有 `assemble_draft|render_snapshot`；`JOB_KINDS_V2` 只有 `proposal_comparison|render|snapshot_publish|materialize` ⇒ **没有**"只编码"的 kind，也**没有**独立的 QC/打包 kind。
- `snapshot.render` 的唯一实现 `SnapshotRenderService.render` 一步做完 encode→QC→package→publish→commitReady（行184-607），并返回 `state:"ready"` + `download_ref`。
- 该服务**在生产中未装配**（只在诊断 CLI），所以今天还不会真的越权；但 D-05 一旦接线而不做分段，**chapters 的 snapshot.render 就会产出 ready Delivery + 下载口**，违反 D-05 与 ACCEPTANCE M08/M09。

**建议**：(a) 生产装配**只允许**阶段化端口进入，诊断/模块路径保留旧 facade 兼容（D-05 已写明 ✅）；(b) MAIN 冻结"阶段 → 阶段动作"矩阵，明确 `chapters/cover` 的 snapshot.render **只允许到 encode 事实**、`delivery` 才允许 qc.inspect 与 delivery.package（现有 `A_STAGE_ACTIONS` 已提供该口径，**无需改合同**）；(c) 阶段边界必须由**服务端事实**（是否存在 encode 事实 / 是否存在 qc 门接受）判定，不能靠客户端传参。

### P0-3 [MAIN裁决措辞] D-04 的 "succeeded SOURCE_ONLY job" 不是持久字段名

见第 5 节 D-04 行。建议 D-04 直接写出断言字段：`job.state='succeeded'` ∧ `job.terminal_reason='SOURCE_ONLY'` ∧ `provider_receipt_json.kind='local.native-draft@1'` ∧ 同 job 的 `created_task_prepared` 不可变事实 ∧ 当前 lease 匹配。否则实现方极可能去 `JOB_KINDS_V2` 里找一个不存在的 kind，或新增 kind（会改动冻结的 job kind 集合）。

### P0-4 [MAIN裁决] D-05 的 "自动调度 qc.inspect → 记录真实 qc Gate → delivery.package" 不得成为自动放行

见第 5 节 D-05 行。建议改写为"产出 QC 证据并提交 qc 审阅包；qc 门由既有决定路径接受；接受后才可派发 delivery.package"。同时 ACCEPTANCE M09 的反例应补一条："delivery 阶段在 qc 门未接受时执行 delivery.package" 必须失败。

### P0-5 [MAIN裁决口径] D-02 的 origin 分派必须点名 MAIN 独占的消费者文件

`src/host/impact/impact-service.ts`（`#readMaterialization`）、`src/host/adoption/adoption-coordinator.ts`（`adopt` ×2 + `:668`）、`src/host/creative/fixed-workflow-service.ts`（把 materialization_id 抄进 workflow 记录）三处不在 MEDIA 白名单内。D-02 若不点名，下游实现者会把 `ps_` 直接交给 `MaterializeService.read`。DESIGN 已明确警告 ✅，但 D-02 本身仍需补清单（属**可直接修正的文档问题**，不需改代码）。

### P1（可直接修正文档，或需 MAIN 一句话口径）

- **P1-1 manifest.attempt 语义在分段后改变**：`buildDeliveryManifest` 写入 `attempt: request.attempt`（行508），`validateReceipt` 强制 `receipt.attempt===manifest.attempt`（`published-package-store.ts:676-679`），而 `#assertSameKey` **不比 attempt**（行422-431）⇒ 后到 attempt 会命中"名字已占"分支并返回 **winner 的** manifest。分段后 `manifest.attempt` = 发布 attempt（ACCEPTANCE M10 明令不得用 encode attempt ✅），但**冻结的 manifest 将不再能回答"这些字节由哪个 attempt 产出"**。建议 MAIN 明确：产出 attempt 只存在于 render/encode 事实中，manifest 保持字节不变；并在 ACCEPTANCE M10 增加"manifest 与 encode 事实的 attempt 交叉核对"断言。
- **P1-2 同 snapshot+config 的重复 publish 必须不重编码**：delivery key = `{project_id, snapshot_id, render_config_digest}`（行245-256），`packageId = pkg_<32hex>`、`deliveryId = d_<32hex>`、`downloadRef = dl_<同32hex>`（`package-layout.ts:74-104`）⇒ 同快照同配置永远落同一 package id，第二次 publish 会走 `already_published` 分支。**这正好支撑 M06 的"旧包 bytes/hash/manifest 相同且无新 render"** ✅。建议 M10 显式断言"第二次 publish 找到既有 receipt、编码次数不变、不新建 object"。
- **P1-3 receipt 与 DB 行的先后锚点须写死**：T20-E3（publish 可见、DB ready 缺失）要求 **receipt link 是持久锚点，DB 行可由 receipt 重建**。代码里 `commitReady` 失败已返回 `COMMIT_FAILED`（retryable）并保留已发布包（行555-562），语义正确，但 D-05 应写明"DB 行是 receipt 的派生，不是权威"。
- **P1-4 D-05 应写明 job kind 复用**（`render`=encode、`snapshot_publish`=publish），以免实现者新增 kind 触碰 `JOB_KINDS_V2` 冻结集合。
- **P1-5 preview/committed 区分已有代码背书**：`committed-snapshot-authority.ts:52-59` 已强制 committed transaction + registered created-source producer，D-03 的"禁止用 SnapshotReadPort 接受 prepared source" ✅ 有实现层保证。建议在 DESIGN 里把这句从"提案"升格为"已由代码保证"，减少后续误实现。
- **P1-6 D-03 补全 review.read 的入参三元组**（`project_id` + `run_id` + `package_id`）。
- **P1-7 ACCEPTANCE 缺"编码→QC 断点"的正向断言**（随 P0-1 一并补）；M09 建议补"delivery 阶段在 qc 门未接受时 delivery.package 失败"（随 P0-4 一并补）。
- **P1-8 `SOURCE_ONLY` 之外的"READY SOURCE ONLY"措辞**（候选 HANDOFF 用语）与持久字段不同名，建议四份文档统一用持久字段名，避免实现方按英文标签写判定。
- **P1-9 重型资源估算**：vitest `maxWorkers: 1`，全量 `check` 耗时按秒级×数百文件估算，MAIN 重型槽预约应据此留量；C4（真实媒体）另需 ffmpeg 与 GPU/Chromium 资源。

---

## 7. 可独立开始的后续票据 / 依赖后票据 / 人类素材需求

### 7.1 现在就可独立开始（不依赖公共合同裁决，也不需MAIN新放行范围）
> 仍需 MAIN 的**正式实现 release**才能动手；此处只说明"哪部分不被 P0 阻塞"。

1. **A-MEDIA-1 现有候选的复核与补强**（TASK 已列）：processor/verifier/assembler 的事实复核、stage 闭包、元数据、资源释放与恢复验证的**只读/局部**工作。
2. **C1/C2 局部回归的可执行性准备**（命令与文件已核实存在，vitest include 命中，依赖齐备）。
3. **P1-2/P1-5/P1-6 的文档级修订**（属 MEDIA Codex 的四文件写权范围）。
4. **媒体模块的步骤抽取设计与等价性论证**（`render-snapshot.ts` 内部拆分 prepareEncoded/inspectEncoded/publishValidated，**只做代码组织与等价性证明**，不改生产装配、不新增表、不改 wire）——这属于 DESIGN 末节"可在确切白名单内设计/验证步骤提取的行为等价"的范畴。

### 7.2 依赖 MAIN 裁决后才可开始
1. A-MEDIA-2 全链：依赖 D-02 的 origin 分派清单与 D-04 两种受限 effect 的字段口径（**P0-3、P0-5**）。
2. A-MEDIA-3 的正式分阶段装配：依赖 D-05 的 encode 事实表/字段（**P0-1**）、阶段→阶段动作矩阵（**P0-2**）、qc 门接受路径（**P0-4**）。
3. 任何新增文件（表/工具/测试）：须 MAIN 在 release 中**列准确名称**（TASK 规定）。
4. 正式 render 持久端口（AttemptFencePort/DeliveryCommitPort/DeliveryRecordPort）与 MAIN 的 Host 装配、generic reaper 排除、关闭顺序。

### 7.3 人类/MAIN 必须提供的素材与事实（当前缺失，全部 BLOCKED）
- 已授权本地视频/图片素材 + 许可来源记录（source/license/rights_ref）+ sha256/bytes/probe + 可用时长；
- **中文真人完整录音**（recording_origin=human_recording，脚本事实齐全）；
- 两主题、各 60–180 秒的真实短片素材；
- 独立 DB/var/staging/profile/端口；
- 全机重型槽（ffmpeg/Chromium/全量回归）；
- 固定上游 OpenFilm 探针目录 `Narralens-openfilm-m1b/vendor/openfilm`（已确认存在且 pin 正确）。

**真实视听与 A 级验收在这些素材到位前一律 BLOCKED/NOT_RUN**；软件契约与负向测试可先闭环。

---

## 8. 本轮 actions performed / 唯一修改文件 / 未执行项

**唯一修改文件**：
`/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/relaunch-20261111/media/CLAUDE_READINESS.md`（本文件，唯一获授权写入）

**已执行（全部只读）**：
- 阅读：根 `AGENTS.md`、`docs/agent-driven-v1/11_AGENT_DELIVERY_PROCESS.md`、`execution-planning/01_EFFORT_AND_STAGE_PLAN.md`、`implementation-design/07_EXPERIENCE_SPEC.md`、`08_WORKFLOW_MCP_CONTRACT.md`、`docs/execution/A/contract-freeze.json`、`relaunch-20261111/{00_READ_FIRST.md, 02_MAIN_CONTRACT_AND_DECISIONS.md, 05_MAIN_ACCEPTANCE_AND_REVIEW.md, baseline-observed.json}`、`media/{DESIGN.md, ACCEPTANCE.md, TASK.md, CLAUDE_PROMPT.md}`、MAIN `package.json`、MAIN `contracts/*`、MAIN `src/contracts/agent-driven-types.ts`、MAIN 相关 src（agent-driven/creative/render/delivery/materialize/impact/adoption/projects/adapters/openfilm）、相关 tests 存在性、候选 HANDOFF、诊断日志 observed.json。
- 只读命令：`pwd/uname/which/--version`、`ls/stat/find`、`git rev-parse/status/diff/log/worktree list/submodule rev-parse`（**仅查询**）、`sha256sum`、`node -e`（仅 JSON 解析/计数，未执行项目代码）、`grep/sed -n`。
- 依赖元数据：node/pnpm/npm/python3/ffmpeg/ffprobe 版本字符串、Chrome 路径存在性、`node_modules` 目录清单与 `.bin` 清单。

**未执行（明令禁止项，逐条声明）**：
- ❌ 任何测试（vitest）、build、tsc、lint
- ❌ 任何安装 / 下载 / 联网 / 付费 / 外传
- ❌ 任何渲染、ffmpeg 调用、Chromium/Headless 启动
- ❌ 任何产品服务 / Host / worker / dispatcher 启动
- ❌ 任何代码实现、文件创建（除本报告）、配置改动
- ❌ 任何 git 写操作（add/commit/merge/push/reset/stash/cherry-pick/rebase/checkout/branch）
- ❌ 读取任何凭据、token、secret 或配置中的敏感值
- ❌ 切换模型 / 供应商 / 配置
- ❌ J 盘访问、helper worker 启动、subagent 派发
- ❌ 自我签署冻结 / 自我签署独立验收 / 自我宣称任何产品PASS

**声明**：本报告**不包含**任何产品PASS、阶段验收PASS、独立审查结论或人验签署；所有业务测试一律 NOT_RUN；本文只读审查已完整完成。

---

## 9. 交接与下一步（给 MEDIA 协调者 / MAIN）

1. **给 MAIN 的裁决请求**（按优先级）：
   - P0-1：冻结 **QC 之前的 encode 事实**（表名/字段/owner）与"编码后先把对象搬进 objects 根再登记事实"的顺序 + orphan 对账规则；这是 D-05 当前最大的缺口，直接决定 T20-E1 能否实现。
   - P0-2：冻结 **阶段→阶段动作矩阵**（chapters/cover 只到 encode；delivery 才 qc.inspect + delivery.package），并明确"生产装配只走阶段化端口"。
   - P0-3/P0-5：D-04 的持久字段断言口径、D-04/D-05 不得自动接受 qc 门的措辞。
   - P0-5'：D-02 点名三个 MAIN 独占消费者文件。
   - 附带确认：分阶段复用既有 job kind（`render` / `snapshot_publish`），不新增 TaskPrepare.kind、不新增能力、不动 80defs/31routes/registry/execution_digest（本文已核实这在技术上成立）。
2. **给 MEDIA Codex 的文档修订项**（均在四文件写权内，可分时执行）：P1-1..P1-9；把 DESIGN 第3节"当前代码问题"补上"staging 名不含 job_id、encode→QC 无持久锚点"的实证，把 ACCEPTANCE M09/M10 补上 encode 事实与 qc 门未接受的断言，把 TASK 的"已有、受限、未闭环"清单与本文第4.3节的核实结论对齐。
3. **不需要**因本次只读检查做任何回退或重写：MAIN 的 25 个 dirty 文件、processor/verifier 候选、归档证据均完整未被触碰。
