# 当前生产接缝核对（供实施设计制图）

核对日期：2026-11-09。源码 HEAD：`fd3021c336387b4c6405b3db08abaafa81c842ff`。文档工作树已有用户修改，本核对按现场文档与该 HEAD 源码读取，没有重置文件、修改产品、启动服务/provider/GPU 或运行测试。以下“已有”仅指源码有实体且找到实际装配/调用，**不构成本轮可运行、业务通过或 release 证明**。原型批准与真实验收分开：PRD 第18节、`s0-r4/APPROVAL.json`、`V1_FRONTEND_EXIT_GATE.md` 为体验权威；真实 R4 产品验收仍 NOT_RUN。

## 1. 最容易画错的事实

1. `src/app/main.tsx:3,6` 挂载 **NarralensApp**，不是 M5。`src/app/director/NarralensApp.tsx:28` 启动后固定读取 `d1-30s`；`:120-128` 仍为 D1/D3/D4 页面。不能把这个入口画作新 Agent 工作台，也不能把它当已满足 R4。
2. 已有 M5 是 **Gateway 注入 OpenFilm Studio 原页面的另一个 bundle**，不是第二个产品编辑器。`src/app/m5/panel.tsx:1-16` 挂 `M5Panel` 到 `narralens-m5-panel`；`src/host/m5/studio-host-bridge.ts:26-35,79-104` 创建 mount、注册 `openfilmHost` 并载入 `/narralens/panel.js`；`src/host/m5/panel-assets.ts:20-24` 读取 `dist/m5/narralens-panel.js/css`。
3. Host 已有真实迁移、素材化、影响计算、受控采用、历史恢复和启动恢复装配，不能统称“未来新增”。但一般项目创建、外部 Agent/MCP、新工作流/系统控制、完整制作交付仍是新增或扩展。
4. M5 当前流程确实仍需操作者提供录制 comparison ID，随后点击素材化、impact、采用。`M5Panel.tsx:405-425,733-777`；素材化固定取 `comparison.proposals[0]`（`:430`），按 inventory 顺序轮转绑定素材（`:434-441`）。这与 R4“用户选方案、Agent/Host 编排准备、用户只审差异和确认”存在实质缺口。
5. `EnginePort.render` 存在类型并不代表导出可用。OpenFilm `src/adapters/openfilm/openfilm-engine-adapter.ts:702-703` 与 Hypit `src/adapters/hypit/hypit-engine-adapter.ts:165-166` 都抛 `CAPABILITY_NOT_ENABLED`。M5 `delivery-preview` 明示渲染、标题、封面、preflight 未开放（`M5Panel.tsx:623-630`）。

## 2. 当前实体、关系和边界

| 实体 | 真实连接/作用 | 源码位置 | 设计口径 |
|---|---|---|---|
| NarralensHost / start | 启动单 SQLite RevisionStore，再 listen loopback Host | `src/host/start.ts:6-11`；`server.ts:264,386-414` | 已有；新能力继续装配于同 Host |
| ProjectCatalog | 默认 registry 只有 `d1-30s` descriptor，读固定工程事实 | `src/host/projects/project-catalog.ts:24-39,68-74` | 已有旧种子；不是通用项目创建/列表仓库 |
| ProjectOperationQueue | Host 创建或接收一个队列，Actor、Import、Coordinator 共用 | `server.ts:391-400,408-414` | 已有项目串行写接缝；不是 IO/CPU/GPU 资源调度器 |
| ProjectWriteActor / AssetImportService | 旧 typed edit / 本地上传导入；共享 catalog/assets/revisions/queue | `server.ts:394-400`；`src/host/assets/asset-import-service.ts` | 已有；上传不等于在线许可下载 |
| RevisionStore / PersistentJobStore / Outbox | 同库保存 revision、journal、job/lease/event/outbox | `server.ts:390,398-399`；`src/host/projects/revision-store.ts:180-237` | 已有；新 DAG/driver/approval/resource 需要补合同和存储 |
| ProjectCoordinator | recovery gate → 同项目队列 → typed 校验/基线/锁 → Actor → snapshot → 原子 commit/pointer/idempotency/outbox | `src/host/projects/project-coordinator.ts:97-119,196-214,221-310` | 已有唯一正式提交边界；新通道不能绕开 |
| SnapshotStore | 内容寻址工程闭包发布、rollback、read | `src/host/projects/snapshot-store.ts:88-95,119-198` | 已有；应复用 immutable snapshot 作为渲染输入 |
| EngineRegistry / EngineBindingStore / EnginePort | 项目绑定引擎；七方法 inspect/capabilities/plan/stage/validate/preview/render；port 无 commit | `server.ts:1767-1787`；`src/host/engine/engine-port.ts:91-99` | 已有；render 在两个 adapter 都未开放 |
| OpenFilmComposition | listen 时验证固定 vendor，验证成功才载入上游、注册 adapter；失败保留不可用原因 | `server.ts:658-670`；`src/host/engine/openfilm-composition.ts:81-108` | 已有真实生产注册，不能说只能测试 registerLayout |
| MigrationService / MigrationStore / OpenFilmMigrator | 源工程 → isolated 迁移副本 → 原生验证/快照/绑定/激活；持久记录支持恢复/回退 | `server.ts:483-536`；`src/host/projects/migration-service.ts:129,192,354,397,446` | 已有迁移；不等于从任意简报新建持久工程 |
| ProjectResolver / MigratedAssetLedger / ActivatedProjectionService | 由 terminal migration/binding/active snapshot/ledger 重建目标工程事实；composition registrar 让真实 adapter 可 inspect | `server.ts:430-442,537-543,667-670,686-689` | 已有持久事实接缝；不可再建内存权威项目表 |
| MaterializeService / BindingService / NativePlanBuilder / ProxyRenderer | comparison + binding → 校验 → native plan/proxy/lineage/持久 job；Host 定时 drain | `server.ts:442-464,690-708`；`src/host/materialize/materialize-service.ts:168,263,332,721,786-805,817` | 已有准备能力；不直接修改正式工程 |
| ImpactService / ImpactStore / ConsumerGraph | committed facts + intent → base/source/control/素材许可/锁复核 → canonical impact；支持采用与恢复分支 | `server.ts:543-571`；`src/host/impact/impact-service.ts:112-141,222-303,400-437,583` | 已有；R4 可隐去技术步骤，但不可略去其复核 |
| AdoptionCoordinator / AuthorSourcePublisher | 通过 Coordinator.controlledWrite，校验 impact/currentness、隔离 stage、受控 publish、正式 commit | `server.ts:585-595`；`src/host/adoption/adoption-coordinator.ts:83-89,484,627` | 已有；不能把素材化 job succeeded 写成已 commit |
| HistoryService / HistoryStore / HistoricalSnapshotResolver / RestorePlanner / Translator | 历史读取；undo/redo 仅产生恢复 intent；impact + 显式确认后 restore 生成新正式版本 | `server.ts:548-584`；`src/host/history/history-service.ts:124-128,177-195,283-373,426-459` | 已有；恢复不是回拨 revision/pointer |
| OpenFilmStudioSupervisor → Gateway → M5 | workbench 可按目标工程启动 Studio；Gateway 注入 bridge+panel，浏览器业务操作回到 Host service | `server.ts:597-620`；`src/host/m5/openfilm-studio-gateway.ts:497-525` | 已有；保留 native 播放器/时间轴/导演区 |
| SelectionCoordinator / SelectionStore / WorkbenchStore | M5 原生选区、面板选区及 UI 状态，投影变化时重定位；bridge 传 selection/command | `M5Panel.tsx:153-166,206-226`；`studio-host-bridge.ts:59-89` | 已有前端选区；不是 Agent 可持久读取的 SelectionContext 服务 |

## 3. 已注册 API（现状；不是新路线拟定合同）

Host 来源/会话检查在 `src/host/server.ts:760-776,858-861`。以下 project 记作 `:p`，proposal/comparison/materialization/migration/job 记作其稳定 ID。

| 方法 | 实际路径 | 注册位置 |
|---|---|---|
| GET | `/api/session` | `server.ts:773-775` |
| GET | `/api/projects/:p`、`/api/projects/:p/assets` | `server.ts:815-818` |
| POST | `/api/projects/:p/assets/import`、`/api/projects/:p/proposals`、`/api/projects/:p/edits` | `server.ts:819-824` |
| GET | `/api/jobs/:job`、`/api/jobs/:job/events` | `server.ts:825-832` |
| POST | `/api/jobs/:job/cancel` | `server.ts:833-834` |
| GET | `/api/proposals/:proposal`、`/api/proposal-comparisons/:comparison` | `server.ts:835-842` |
| GET | `/api/migration/v1/projects/:p/engine`、`/api/migration/v1/projects/:p/workbench` | `server.ts:777-780` |
| POST | `/api/migration/v1/projects/:p/migrate-copy` | `server.ts:781-782` |
| POST | `/api/migration/v1/projects/:p/proposals/:proposal/materialize` | `server.ts:783-787` |
| POST | `/api/migration/v1/projects/:p/impact`、`/api/migration/v1/projects/:p/edits` | `server.ts:789-792` |
| GET | `/api/migration/v1/projects/:p/history` | `server.ts:793-794` |
| POST | `/api/migration/v1/projects/:p/history/restore`、`.../history/undo`、`.../history/redo` | `server.ts:795-800` |
| POST / DELETE | `/api/migration/v1/projects/:p/locks` / `.../locks/:lock` | `server.ts:801-805` |
| POST | `/api/migration/v1/projects/:p/comparisons/replay` | `server.ts:807-808` |
| GET | `/api/migration/v1/materializations/:materialization`、`/api/migration/v1/migrations/:migration` | `server.ts:809-812` |
| POST | `/api/migration/v1/migrations/:migration/rollback` | `server.ts:813-814` |

Gateway 是另一个地址空间，**不能把它和上述 Host API 混成同一路径**。`src/host/m5/openfilm-studio-gateway.ts:504-519` 中的前缀是 `/narralens/api`，project 由 `?project_id=:p` 寻址，含 GET `/workbench`、`/history`、`/inventory`、`/materializations/:id`；POST `/comparisons/replay`、`/locks`、`/materialize`、`/impact`、`/history/undo|redo|restore`；DELETE `/locks/:id`。受控原生写另走 `/narralens/native/:entry_id`，会话、注册 entry、来源复核后调用 Host（`:420-455`）；采用 entry 是 `timeline.adopt_materialization`（`src/host/engine/native-mutation-registry.ts:47-48`）。Gateway 上游原生 API 只代理 allowlist；其注释明确不开放 export/import/delete/transcribe（`openfilm-studio-gateway.ts:102-113`）。

## 4. 恢复、并发与测试接缝须精确描述

- 启动顺序不是泛泛的“启动后恢复”：`server.ts:642-644` 先处理 import/legacy edit/临时 comparison；`:658-670` 验证并装配 OpenFilm；`:676-686` history → adoption → 第二次 history → generic Coordinator → migration；`:692-708` materialize 恢复及周期 drain；`:710-714` outbox replay/lease reaper。
- Coordinator 通用恢复会把无法确定的残留事务转 recovering/attention，不能代替专项 adoption/history 的收敛决定；源码顺序特意先运行专项恢复（`project-coordinator.ts:334-365`、`server.ts:671-685`）。
- `MaterializeService.#drainOnce` 已通过 `Promise.allSettled` 并发执行 runnable rows，默认 drain(limit=8)（`materialize-service.ts:721,786-805`）。因此“当前所有准备必定串行”不属事实；缺口是通用 DAG、父子 job、IO/CPU/GPU/RAM 资源 claim/可见等待与模型独占治理。
- `server.ts:402-405` 注册的 outbox consumer 回调目前是空函数。持久 outbox/replay 已有，不等于完整 WorkflowSnapshot/cursor 的跨 Agent/UI 实时订阅已接线。
- `MigrationDeps.exportProject` 是可选注入（`migration-service.ts:65`）；未传即返回空导出数组（`:533-544`）；Host migration 装配 `server.ts:483-536` 没有注入它。不能拿测试/探针迁移后再导出记录作为产品 snapshot-bound render 已实现的证据。
- M5 三个 proxy 名称是冻结 fixture 名单（`M5Panel.tsx:53-59`；`panel-assets.ts:27-41`），Host 默认 `mediaRoot` 未提供时返回空名单。必须把已有素材化 proxy 与 M5 fixture 比较播放器区分，后续需真实动态候选/前后预览绑定。
- `src/host/recover.ts:22-23` 是旧 imports/actor 手工恢复入口；不能把该 CLI 画成覆盖全部新式 history/adoption/migration 的万能恢复命令。

## 5. 对照 R4/PRD 的十项最大剩余缺口

| 顺序 | 当前缺口及实际证据 | 拟新增/扩展（目标，未在本核对实施） |
|---|---|---|
| 1 | 默认目录固定种子，HTTP 无一般 project create；已有迁移副本与重开底座 | MAIN 通用项目仓储、create/bootstrap、首 snapshot、持久打开入口；保留迁移与原生工作台 |
| 2 | `src` 当前树无 MCP/launcher/入口 Skill 生产模块；旧 Host session 是浏览器接口 | BRIDGE stdio MCP/能力发现/入口 Skill/实例 descriptor；MAIN 同源 application port/鉴权/生命周期接线；逐驱动真实探针 |
| 3 | M5 comparison 手填、固定第一案、顺序素材绑定、逐步按钮 | MAIN/PRODUCT 目标/选区绑定、真实选案 Decision、Host 编排准备；M5 最小挂载 R4 意图→候选差异→影响确认→结果回看 |
| 4 | 现有选择为前端 store，缺外部驱动共享持久 Brief/Question/Answer/Script/Artifact/DAG/checkpoint | PRODUCT 产物/版本/依赖 read model；MAIN 仓储及接口注册。工作台与 Agent 共享同一项目事实 |
| 5 | 源码无 WorkflowTopBar/SystemControlPanel，M5 没有原生已加载 snapshot/revision 的完整回执协议 | PRODUCT 顶部可折叠横向工作流、非模态系统侧栏；MAIN/BRIDGE event snapshot+cursor、重连、真实 native loaded 核对。job 完成、commit、native loaded 三态分别显示 |
| 6 | 已有 base/source/control/locks/impact，但缺持久活动 DriverSession、可信 Approval 与授权/费用范围的统一事实 | MAIN 冻结 driver lease/接管/selection/currentness/审批动作绑定；并发 Agent 与人工编辑复用 Coordinator |
| 7 | 已有 job lease/materialize 并发，但缺通用 child jobs、分池资源调度、未知付费结果与跨 provider 取消事实 | MAIN 通用 resource/job/attempt 合同，MEDIA workers，BRIDGE 可观察等待/队列/取消；正式提交继续单项目串行 |
| 8 | 现有本地上传/registry/rights 不是在线检索与下载链 | MEDIA 来源候选→许可/授权→下载 receipt/cache/bytes/注册；只补缺口、下载与素材采用分开，禁止任意 URL 执行 |
| 9 | `src` 无 Comfy 模型 runtime、TTS/字幕/封面生产模块；只有旧素材和 native plan 接缝 | MEDIA 受控固定模板 Comfy、模型按需加载/预热/卸载、声音/字幕/标题封面、概念/转场与后期；MAIN 唯一系统生命周期命令；共享服务归属复核 |
| 10 | 两 adapter render 均 disabled、M5 delivery-preview 明确占位；无 snapshot 绑定 QC/正式交付包 | MEDIA SnapshotRead→真实 render→QC→MP4/字幕/来源许可/封面标题/版本费用包；MAIN 注册并绑定 committed snapshot；A 真短片与改单镜双导出，B 完整制作，C 长片/多驱动/全部规格终验 |

上述“无”限定于本次读取的当前 `src` 生产树及 `server.ts` 注册表，不据文档候选或工具脚本推定生产能力存在。`docs/03_Architecture.md:98-140` 保留旧 Gate 实体证据，但 `:119-124` 仍含 D4.2 待后续的历史语句，须结合 `:114-118` 已实现 M3/M4A/B/C 解释，不能整体复制旧表成为新方案现状。新路线文档/原型/schema/SQL 位于 docs 的候选不能冒充生产已注册。

## 6. 制图取舍建议

图中“保留”可集中为四组：① OpenFilm Studio+M5+Gateway；② Host 应用/Coordinator/锁；③ SQLite journal/job/outbox+SnapshotStore；④ migration/materialize/impact/adoption/history/engine port。新增分别用“拟新增/需扩展”标出 Agent/MCP、创作共享事实、可见工作流/系统侧栏、调度/runtime、下载声音、snapshot render/QC/delivery。所有写箭头回 Coordinator，准备结果箭头回 Asset/Artifact，不可直入 author source；观测箭头是读模型，不能变成另一事实源。图上的生产状态证据与未来 A/B/C 验收门分别标识。

本报告为只读源码核对，不签人验、不签独立业务 PASS、不放行 CP-A0/IT-P02 或生产 release。
