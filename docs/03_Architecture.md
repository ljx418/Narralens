# 叙镜架构设计 v1.0
<!-- M2.1_REWORK_BASE_SHA=ee58ab5c6a9d4bbdf05e8ac8a394fd75218cae59 REVIEW_STATUS=REVIEW_PENDING -->

文档状态：Gate D1–D3、D4.0 与 D4.1 的历史结论保留。D4.2.1 的 M1A 逐编号证据已完成并由独立 Claude Code R4 外审通过；这只关闭 D4.2.1 prerequisite subset，不关闭 Gate D4.2。2026-10-16 经 `CR-MIG-001` 批准进入架构迁移：OpenFilm Studio 是目标原生 UI/默认渲染器，Hypit 降为 legacy/回退；M1B 隔离 spike 已通过，现允许 M2 开工但尚未实现任何生产 OpenFilm 路径。当前运行时仍以 Hypit 为唯一生产剪辑事实源，旧 Gate 历史不被覆盖。

## 1. 零层架构

```text
用户：聊天 / 观点 / 资料 / 实拍 / 录音
                  │
                  ▼
Narralens Unified Workbench
导演面板 + Hypit 编辑区域 + 时间轴 + 交付区
                  │
                  ▼
Narralens Local Host (TS/Node)
项目 / 任务 / 版本 / 锁 / 预算 / 权限 / 事件 / 事务
          │                         │
          │                         ▼
          │                 Hypit Adapter
          │                 Author Source + Run
          │                         │
          │                         ▼
          │                 Hypit compile/build
          │                         │
          ▼                         ▼
OpenMontage Adapter          预览 / MP4 / 字幕
受控 Agent Runner
pipeline + skills + tools
          │
          ▼
ProposalBundle / Evidence / AssetManifest
          │
          └──> 暂存区 → 审批/校验 → Source Adapter → 唯一主工程
```

**唯一剪辑事实源：Hypit Author Source + Run。** Narralens DB 不是第二条时间轴；OpenMontage 不直接写主工程。

## 2. 为什么这样集成
OpenMontage 的公开架构是 agent-first：编码智能体读取 YAML pipeline、Markdown skills，调用 Python tools，并通过 checkpoint 推进；它不是一个现成的单一 HTTP 视频生成 API。Backlot 是只读制作看板。因此我们复用它的制作方法、工具和产物，不把 Backlot 当编辑器。

Hypit 已有 Studio、时间模型、工程和本地渲染链路。Narralens 应在固定版本 Studio 应用层做薄改造，复用真实播放器/时间模型/工程写入，而不是重新发明渲染器。

## 3. 组件职责
| 组件 | 负责 | 禁止 |
|---|---|---|
| Narralens UI | 单页创作、选区、方案、精修、标题封面、交付 | 维护独立最终时间轴 |
| Local Host | 项目状态、任务、锁、版本、审批、预算、事务、SSE | 隐藏创作决策 |
| OpenMontage Adapter | 调用固定 pipeline/skills/tools，归一化提案和素材 | 直接覆盖主工程 |
| Agent Runner | 受控目录和白名单网络下运行 OpenMontage | 任意 shell/任意路径 |
| Hypit Adapter | Author Source 定位、typed patch、Run 产物选择、build | 正则猜写源码 |
| Hypit Runtime | 真实编译、预览、媒体装配、编码 | 自动理解用户聊天 |
| SQLite/Event Log | 任务、事件、修订、审批、映射 | 保存第二份影片结构 |

## 4. 技术栈基线
- UI：沿用固定 Hypit Studio 的 TypeScript/Vite 技术栈；新增 `DirectorPane`、`SpatialAlternatives`、`DeliveryPanel`。
- Host：Node.js + TypeScript；loopback 同源 API；每项目串行写 actor。
- Persistence：SQLite + append-only event log + project journal。
- OpenMontage：独立 Python venv，固定 commit SHA，受控 Agent Runner。
- Hypit：当前 distribution `@hypit/hypit` 0.3.1、Studio 0.2.0；Author Source Header 使用 `@hypit/markup@1`，媒体/时间等 module request 版本按 fixture import（如 `@hypit/media@1`）由该固定 distribution 解析。commit/version、Source/Run adapter 与实际 CLI/API 以 D1 探测结果为准。
- Testing：Vitest/现有 TS 测试 + Playwright + pytest（adapter）+ ffprobe + 帧采样。
- Media store：内容哈希目录；媒体不嵌入 JSON。

## 5. 文件布局
```text
narralens/
  vendor/hypit/                 # 固定 SHA 的薄 fork
  vendor/openmontage/           # 固定 SHA，独立 venv
  app/director/                 # 导演面板、空间备选、标题封面
  host/                         # API、actor、事务、事件、SQLite
  adapters/openmontage/         # pipeline 交接、产物归一化
  adapters/hypit/               # author identity、patch、run/build
  contracts/                    # JSON Schema + examples
  projects/<project-id>/
    film/
    media/<sha256>/
    proposals/
    runs/
    .narralens/
```

### 5.1 代码实体与实现状态

| 目标实体 | 目标路径 | 直接上游/下游 | 状态 | 进入开发的前置证据 |
|---|---|---|---|---|
| `NarralensApp` / `StageRouter` | `src/app/director/` | 用户 → HostApiClient | D2 部分实现：精修页/单提案；完整三阶段路由待后续 | D2 evidence |
| `SelectionCoordinator` | `app/director/selection/` | 导航/播放器/时间轴/导演面板 | 未开发 | 帧/时间模型经 D1 确认 |
| `DirectorPane` / `ProposalCompare` | `src/app/director/` | Proposal API → 后续 Edit transaction | D4.1 已实现 3–6 方案、结构/素材/来源/费用比较和 generation 隔离；不含采用 | D4.1 UI/真实浏览器证据 |
| `TimelineSurface` | `app/director/timeline/` | Hypit 时间模型 / SelectionContext | 未开发 | D1 确认复用点；禁止自建第二时间轴 |
| `DeliveryWorkspace` | `app/director/delivery/` | render job / preflight / assets | 未开发 | 真实 build 与交付产物路径确认 |
| `HostApiClient` | `src/app/director/api/` | UI ↔ Local Host | comparison 读取与原有 projects/jobs/events/proposals/edit 均已实现 | D4.1 HTTP/UI tests |
| `LocalHost API` | `src/host/server.ts` | UI ↔ actors/adapters | D4.1 comparison job、读取、revision 复核与 NOWRITE diagnostics 已实现 | D4.1 contract/HTTP/NOWRITE tests |
| `ProposalComparisonAdapter` | `src/adapters/openmontage/` | Runner draft → Host 绑定 → atomic staging | D4.1 已实现 schema、GCD 语义差异、空来源白名单和全有或全无暂存 | D4.1 adapter/真实证据 |
| `AssetImportService` | `src/host/assets/` | multipart → staging → ffprobe → AssetRegistry | D4.2.1 已实现并完成 M1A 逐 case 独立外审：流式导入，不接收本机绝对路径 | M1A 完整冻结矩阵已关闭；后续变更须保留回归 |
| `ProjectOperationQueue` | `src/host/projects/project-operation-queue.ts` | ImportService / ProjectWriteActor → 每项目串行 commit | D4.2.1 已实现 interface、FIFO/错误隔离/跨工程并行，Host 单例已注入 Actor | ImportService 实现时必须复用同一实例 |
| `MaterializeService` / `MaterializeRenderer` | `src/host/materialize/` | Proposal + bindings → ffmpeg composite → materialized staging | D4.2 docs-only：异步 Job、确定性 recipe、NOWRITE | D4.2.2 计划，受 D4.2.1 门禁约束 |
| `ProjectWriteActor` | `src/host/projects/` | API → transaction → adapters | D3 fit 与 D4.0 单镜媒体替换已实现 revision、lock、幂等、补偿/attention/recovery | D4.1 禁止调用；提案采用待 D4.2 |
| `SQLiteEventStore` | `src/host/projects/revision-store.ts` | actor/import ↔ revision/edit journal/import journal/idempotency | D3 revision/edit journal/event 与 D4.2.1 import journal 已实现；Job/SSE 仍为内存态 | 导入不得增加影片 revision；持久 Job/outbox 待 M2 |
| `OpenMontageAdapter` | `src/adapters/openmontage/` | Host ↔ ControlledAgentRunner | D2 单提案保留；D4.1 单次 CLI 多提案、完整 provider schema 与真实 audit 已实现 | 禁止直写 Hypit；D4.2 materialize 另阶段 |
| `HypitAdapter` | `src/adapters/hypit/` | Actor ↔ Author Source + Run | D3 `parameter.adjust`、D4.0 `media.replace` 与 D4.2.1 expected manifest SHA 已实现 | fork commit `6fdd8c0...` 已固定；@1/@2 安全重载、TOCTOU/Source 补偿与真实 D4.0 回归已通过 |
| JSON contracts | `contracts/` | UI/Host/Adapters/Tests | D4.1 合同已实现；D4.2.1 四份 runtime 合同、@1/@2 manifest union 与两项错误码已实现 | 89/89、SHA pin、后续三合同未注册 |
| D4.2 review contracts | `docs/contracts/d4.2-*` | 文档审查 → 后续运行时合同 | 七份审查快照；D4.2.1 四份已同步 runtime，materialize/adopt 三份仍 docs-only | `docs/contracts/README.md` 映射为权威 |

| `EnginePort` | `src/host/engine/engine-port.ts` | ProjectCoordinator ↔ 引擎 | **M2.1 已实现、独立复审待确认**：七方法与无 commit 门已实现；`absoluteServerPath` 已移入 Host-only 模块，adapter 只回传相对 staging 目录名 | M2.1 AC-001/002；第二轮返修基线 `ee58ab5c...` |
| `EngineBindingStore` / `EngineRegistry` | `src/host/engine/engine-binding-store.ts`、`engine-registry.ts` | project_id → 唯一引擎 + `EnginePort` | **M2.1 已实现、独立复审待确认**：主键保证单项目单引擎；Host 持有只写一次的 source digest 基线，生产读取检测外部变化并持久进入 attention | 外审 B-01 返修证据 ER-B-01 |
| `NativeMutationRegistry` / `NativeWriteGateway` | `src/host/engine/native-mutation-registry.ts`、`native-write-gateway.ts` | native 入口 → TypedEdit 或拒绝 | **M2.1 已实现、生产强制接线待 M2.2/M4A**：每引擎 capability map 完整；缺失/未验证能力 fail closed；Host service 能力单独表达 | 外审 M-01 返修证据 ER-M-01；ADR D-12 限制保留 |
| `SourceDigestV1` | `src/host/engine/source-digest-v1.ts` | source 引用闭包 → canonical → SHA256 | **M2.1 已实现、独立复审待确认**：Hypit 引用资产当前 bytes 纳入闭包，不一致 fail closed；identity 使用 realpath，alias 每个 canonical path 恰一行 | 外审 B-02/M-03 返修证据 ER-B-02/ER-M-03 |
| 时间模型 | `src/host/engine/time-model.ts` | 整数半开帧 ↔ rational fps | **M2.1 已实现**：精确 BigInt 有理换算；已验仅 30/1；短素材拒绝而不循环/冻结/变速 | TM-01/02/03（`AT-PREVIEW-01`/`AT-SELECTION-01`） |
| `HypitEngineAdapter` | `src/adapters/hypit/hypit-engine-adapter.ts` | EnginePort ↔ 现有 Hypit read/write | **M2.1 已实现**：包装既有 adapter，legacy 合同、入口与测试未改 | AC-019；134 条旧回归全绿 |
| `OpenFilmAdapter` | `src/adapters/openfilm/openfilm-engine-adapter.ts`、`openfilm-upstream.ts` | EnginePort ↔ 固定上游接缝 | **M2.1 只读实现、独立复审待确认**：固定 HEAD、可证明 clean、package/lock/license/传递模块摘要三层校验；Git clean 无法证明即 `ENGINE_UNAVAILABLE`；OF-06a/b/c 分离真实 upstream、真实 adapter 与合同证据 | 外审 M-04/M-05、R2-M-01 返修基线 `ee58ab5c...` |

状态口径：`已实现` 只覆盖对应 Gate 的证据范围，不外推到完整 V1；`docs-only/待后续` 表示目标明确但尚无生产能力。

## 6. 核心数据模型
### CreativeTask
主题、核心观点、目标时长、平台、章节策略、必须保留原话、待核验主张、资料引用、视觉偏好、输出规格。

### NarrationBlock
稳定 `block_id`、文本、语义锚点、音频资源、对齐结果。

### ShotRef
稳定 `shot_id`、章节、帧范围、素材引用、对应 NarrationBlock、分项锁、style override。

### ProposalBundle
`proposal_id/base_revision/selection/preserve/segments/assets/cost/source_refs/renderable`。它是意图，不是 Hypit 工程语法。

### ProposalComparison（D4.1 已实现）

Runner 只产生不带项目绑定和费用事实的 `ProposalComparisonDraft`；Host 使用当前 project/revision/selection 包装成 `ProposalComparison`，生成 comparison/proposal ID，并从 CLI wrapper 注入真实模型、费用、耗时和 stdout SHA。每个候选必须具备唯一 strategy，且在 segment 数、role 序列或归一化时长序列上至少再有一项结构差异。整个 comparison 原子暂存，任一候选无效则全部失败。D4.1 不调用 `ProjectWriteActor`，不改变 Hypit Source/Run/revision。

### AssetRef / AssetManifest

逻辑 `AssetRef` 保持 `asset_id/sha256/mime/duration/origin/rights_status/license_evidence/synthetic/local_resource`。D4.0 的落盘载体 `narralens.asset-manifest@1` 使用以下明确映射，不是第二套含义：

| 逻辑字段 | D4.0 manifest | 决策 |
|---|---|---|
| `asset_id` | `asset_id` | 保留 |
| `sha256` | `sha256` | 保留，内容身份 |
| `mime` | `media_type` | 名称规范化，D4.0 仅 `video/mp4` |
| `duration` | `duration_frames` | 固定为工程时间基帧 |
| `origin` | `source.kind/label/uri` | `uri` 仅来源元数据，不可执行/下载 |
| `rights_status/license_evidence` | `license.status/label/commercial_use` | D4.0 只采用 cleared + commercial_use |
| `synthetic` | 由 `source.kind=generated` 推导 | 不另存互相矛盾的布尔值 |
| `local_resource` | `project_path` | 仅工程内相对 locator；API 不暴露 |

运行时 schema 权威路径为根目录 `contracts/asset-manifest.schema.json`；`docs/contracts/d4-asset-manifest.schema.json` 是 D4.0 审查快照，关系见 `docs/contracts/README.md`。D4.0 固定后 P0-08 仍只标 partial。

`generated` 与许可 `cleared` 是正交事实：前者要求 UI/证据标记为 synthetic，后者只表示当前使用已获许可，不得被解释为真实现场或事实证据。`restricted/unknown` 即使声明可商业使用也不能进入采用链，因为仍可能存在其他使用限制。

### MaterializedProposal（D4.2 docs-only）

D4.2 不把一个 registered shot 拆成新的顶层 Hypit items。`AssetImportService` 流式登记本地 MP4；`MaterializeRenderer` 将所选 Proposal 的每个 segment 绑定到 cleared/commercial input asset，以固定 ffmpeg argv 从第 0 帧确定性裁切、缩放/letterbox、去音频并拼成一个精确帧数 composite。`MaterializedProposal` 保存 proposal/manifest/composite/recipe SHA、segment 输出范围与输入 lineage，只作采用与审计，不是可独立渲染的第二时间轴。

AssetManifest v2 新增 `source.kind=derived` 和输入 SHA lineage：`generated` 继续表示合成/生成来源，`derived` 表示由已清除本地素材确定性加工而来，二者不得混用。AssetRegistry 兼容读取 v1，@1 工程第一次成功提交的 D4.2.1 导入在同一原子 transaction 中保留旧条目、加入新条目并迁移到 v2；失败保持或补偿原始 bytes，成功后不维护第二份活跃清单。当前 Hypit 启动后会固定 @1 manifest SHA 且因任一未清除条目拒绝整表，因此 D4.2.1 必须在开放导入前同批把薄 fork扩展为 @1/@2 安全重载：`media.replace` 携带 expected manifest SHA，Studio 在写 Source 前完整重读并复核，只在 resolve 目标资产时要求 cleared/commercial，且 TOCTOU 变化继续拒绝。采用时 `ProjectWriteActor` 重验当前 revision、visual lock、impact approval、materialization、manifest 和 composite bytes，再调用这一窄扩展后的 D4.0 `media.replace`。因此原 shot Clip/Window identity、旁白与总时长保持，Hypit Source 仍是唯一影片事实源。

### Revision
单调递增。恢复旧内容也创建新 revision，不回退数字。

## 7. API 基线（Narralens 自定义，不伪称上游原生）
- `POST /api/projects/:id/proposals`：选区 + 意图 + baseRevision → jobId。
- `GET /api/jobs/:id` / SSE events：真实阶段、费用和结果。
- `GET /api/proposal-comparisons/:id`：读取并重新校验 D4.1 原子暂存的 3–6 个只读候选，同时复核当前 revision；已实现。
- `POST /api/projects/:id/assets/import`：D4.2.1 已实现并通过 M1A 外审；流式本地 MP4 + 来源/许可元数据，不接受客户端路径。
- `GET /api/projects/:id/assets`：D4.2.1 已实现并通过 M1A 外审；返回 `AssetInventoryResponse` 公开库存，包含 cleared/restricted/unknown、source/license/availability/eligible/blocking，但不返回 `project_path`、绝对路径、原文件名或 token；每次请求重验 bytes SHA，不使用跨请求可用性缓存。
- `POST /api/proposals/:id/materialize`：D4.2 docs-only；本地绑定与 composite 异步 Job，不调用远程 provider。
- `GET /api/materializations/:id`：D4.2 docs-only；重验并返回采用影响摘要与 current impact SHA。
- `POST /api/projects/:id/edits`：typed operations + baseRevision → newRevision。
- `POST /api/projects/:id/renders`：revision + profile → jobId。
- `POST /api/jobs/:id/cancel`：尽力取消，已产生外部费用如实记录。
- `POST /api/projects/:id/feedback`：revision + shotId + range + text。

统一错误码基线：

| HTTP | code | 适用边界 |
|---|---|---|
| 400 | `INVALID_REQUEST` | malformed JSON/transport；契约语义错误由 Host 稳定映射 422 |
| 413 | `INVALID_REQUEST` | JSON 或 multipart 流超过 Host 上限；立即停止接收并清理私有暂存 |
| 422 | `INVALID_MEDIA` | 导入媒体 MIME/container/CFR/帧数或完整解码不合格 |
| 503 | `MEDIA_TOOL_UNAVAILABLE` | ffprobe/ffmpeg 缺失、启动失败或 Host 级超时；不伪装为 Hypit 故障 |
| 401 | `INVALID_SESSION` | Host session 缺失/失效 |
| 403 | `ORIGIN_REJECTED` | Host 或 Studio 同源策略拒绝 |
| 409 | `REVISION_CONFLICT` | Narralens/Studio revision、Source preimage 或启动后 manifest 变化 |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | 同 key 对应不同 canonical request |
| 409 | `MANIFEST_CHANGED` | 资产清单或已授权 bytes 在准备/采用期间变化；code 已在生产 union/schema，D4.2 补齐导入/重载/采用调用路径 |
| 422 | `UNSUPPORTED_EDIT` | 不支持拓扑、非局部影响、编译/后置拒绝 |
| 422 | `MISSING_ASSET` | 未登记、bytes/hash/MIME 不可用 |
| 422 | `AMBIGUOUS_TIME` | 选区无法唯一映射 |
| 422 | `INVALID_PROPOSAL_SET` | D4.1 候选数量、帧数、引用、结构差异或可信字段校验失败 |
| 423 | `TARGET_LOCKED` | 分项锁阻断 |
| 423 | `PROJECT_ATTENTION_REQUIRED` | 未完成/不确定事务阻断写入 |
| 428 | `APPROVAL_REQUIRED` | 当前影响/许可快照未确认或已过期；未来外传/费用仍需额外 provider 审批事实 |
| 500 | `TRANSACTION_FAILED` | 内部失败且已证明未写或已补偿 |
| 503 | `HYPIT_UNAVAILABLE` / `RUNNER_UNAVAILABLE` | 已登记本地依赖不可达 |
| 504 | `RUNNER_TIMEOUT` | 受控 Runner 超时或取消终止；费用未知时不得伪造为零 |
| 529 | `PROVIDER_OVERLOADED` | provider 权威过载；不自动重试，保留用户草稿 |

阶段计划只能引用并收窄此表，不得另造同义 code。生产 `contracts/api-error.schema.json` 必须与 TypeScript union 同步。

## 8. 编辑事务
采用方案必须走统一事务：
1. 校验 baseRevision、锁、选区、共享消费者、资产许可、预算。
2. 由 Hypit Adapter 从当前 Studio session 解析 authored identity 与可写参数，生成 typed mutation；禁止正则或文本位置猜写。
3. 由 Studio 执行带 preimage 的事务、重新编译和结果验证；Narralens 复读 session/hash 做不变量校验。
4. 验证帧范围、音频引用、不变区域。
5. 安装文件并提交 metadata revision。
6. 任一步失败都回滚，提案保留。

journal 目标状态为 `prepared → source_validated → metadata_committed`，失败终态为 `aborted/compensated/attention`；启动时先恢复未完成 journal。D3 的精确恢复算法见 `implementation/D3-development-and-acceptance-plan.md`。总架构中“提案保留”指业务 Proposal 对象不因写入失败而删除；D4.0 的 Source rollback 仍必须回到 byte-exact before，两者不是同一状态。

## 9. 产物复用
锁定镜头必须显式引用已完成资产、旁白和对齐结果。只改视觉时，不重跑 TTS；只改标题时，不重渲染影片。缓存命中必须基于内容哈希、配置、模型/工具版本，不依赖“看起来没变”。

## 10. 政治/新闻类内容事实与素材边界
- Claim 与 VisualAsset 分离。
- 事实证据保存来源、发布日期/访问时间、引文上下文。
- 视频素材另存许可和使用依据；能引用报道不代表能剪其视频。
- AI 合成画面标记 `synthetic=true`；不得让合成现场冒充真实现场。
- 标题/封面必须经过正文一致性检查。

## 11. 安全
- Host 仅 loopback + Origin/token 校验。
- Agent Runner 最小目录、命令和网络域名白名单。
- 资料内容永远当数据，不当系统指令。
- 凭据不进网页、不进项目 JSON、不进日志。
- `AT-SEC-01` 使用锁定版本的 gitleaks（不可用时采用等价且记录原因的扫描器）扫描源码、前端构建物、项目 JSON 和脱敏日志；规则集、工具版本、扫描时间与机器信息随阶段证据落到 `docs/evidence/<phase>/security/credential-scan.json`，报告不得包含凭据明文。
- 禁止任意文件路径写入；媒体用 asset_id 映射。

## 12. 许可基线
- OpenMontage：AGPL-3.0。当前按本地自用开发；未来网络服务/分发需再次审查义务。
- Hypit：其公开 LICENSE 是附加条件的 Hypit Open Source License（基于 Apache 2.0 条款并增加多租户、商业再分发、标识等约束）。当前本地单组织自用符合其明确允许路径；未来 SaaS/对外产品需商业许可/法律审查。

## 13. 分层依赖与架构测试

- UI 只依赖 contracts 与 `HostApiClient`，不得直接 import vendor/Hypit/OpenMontage 内部模块。
- `LocalHost API` 只做认证、解析、幂等和 actor 分发；项目写操作必须经过 `ProjectWriteActor`。
- OpenMontage Adapter 只能写 `proposals/`、`media/<sha256>/` 和受控暂存目录，不得写主 Source。
- Hypit Adapter 是唯一可安装 typed patch 的边界；正则写 Source、数组下标 identity、任意路径写入均由架构测试拒绝。
- SQLite/Event Log 只能保存任务、事件、修订、锁、审批与映射；测试必须证明它不保存可独立重建影片的最终时间轴。
- 所有外部调用携带 correlation/job/revision 标识；SSE 重连必须按事件 ID 去重。
- M2.1 起由 `tests/architecture/m2.1-fitness.test.ts` 机械执行：`app/**` 不 import host/adapters/vendor；
  `contracts/**` 不 import React/Node/adapters/host；生产代码不 import `spikes/**`；
  `EnginePort` 成员恰为 7 个且 adapter 无 commit/lock/process 方法；registry policy 四选一且 `unknown` 计数为 0；
  `/api/migration/v1` 下只挂载 engine 只读路由；`ApiErrorCode` union / JSON Schema / alias 表三者一致；
  legacy `frame_rate` 仍为 number 且 `end_frame_exclusive` 未被改名。
- 每条 fitness 规则都由 `tools/m2.1-gate-mutation-check.sh` 的变异用例证明会失败（MUT-A..MUT-F），
  避免出现「永远不会红的绿灯」。

## 14. D1 允许与不允许调整的范围

允许：依据固定上游版本修正真实命令、入口、文件路径、时间单位、Adapter 接口和测试夹具。  
不允许：改变三阶段体验、绕开统一事务、建立第二时间轴、允许 OpenMontage 直写主工程、用 mock 取代真实出门证据。若确需改变不允许项，退回 PRD/原型审批。
