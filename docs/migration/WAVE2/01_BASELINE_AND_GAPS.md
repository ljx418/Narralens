# Wave 2 基线与实现差异

核对日期：2026-10-18
分支：`migration/m2.2-coordinator-persistence`
文档基线：`36473c89c2a26acba8161226e6066b4b9fdb69d0`

## 1. 已通过且必须复用

| 能力 | 真实实体 | Wave 2 使用方式 |
|---|---|---|
| 单项目单引擎 | `EngineBindingStore`、`EngineRegistry` | 不新增第二 binding，不双写 Hypit/OpenFilm |
| 七方法引擎口 | `EnginePort` | 方法集合保持不变；只扩充明确的 TypedEdit 与 OpenFilm 实现 |
| 写入口治理 | `NativeMutationRegistry`、`NativeWriteGateway` | adopt/history 新入口必须先登记，再开放 capability |
| 单项目串行 | `ProjectOperationQueue` | materialize 最终复核、impact 创建、adopt/history 全部复用 |
| 唯一提交权 | `ProjectCoordinator` | 抽出受控写内部原语，但保留 legacy `executeEdit()` 响应与测试 |
| 快照/commit | `SnapshotStore`、`RevisionStore.active_commit` | 先 stage/validate/publish，再单事务 pointer + revision + outbox |
| 三类锁 | `LockService` | 按 native plan + ConsumerGraph 计算，不信客户端 preserve |
| 持久 Job/SSE | `PersistentJobStore`、`Outbox` | materialize worker 使用 owner+attempt lease；晚到 quarantine |
| 迁移副本 | `MigrationService`、`OpenFilmMigrator` | 使用已迁移 OpenFilm 三 clip fixture 作为真实 Wave 2 基线 |
| 素材台账 | legacy `AssetRegistry`、Manifest@2 | 经 `AssetInventoryPort` 复用；OpenFilm 目标先补 target-owned ledger，不假设 Manifest 已被迁移 |

## 2. 当前真实路由

已存在：engine、migrate-copy/report/rollback、project/assets/import、proposal、legacy edits、jobs/events/cancel。

尚不存在且必须保持 404，直到对应模块 Gate 通过：

- `POST /api/migration/v1/projects/:id/proposals/:proposalId/materialize`
- `GET /api/migration/v1/materializations/:materializationId`
- `POST /api/migration/v1/projects/:id/impact`
- `POST /api/migration/v1/projects/:id/edits`
- `POST /api/migration/v1/projects/:id/history/restore`

## 3. 代码差异

| Gap | 当前事实 | Wave 2 必须新增/修改 | 防返工约束 |
|---|---|---|---|
| W2-G01 合同 | runtime 无 materialization/impact/adoption/history schema/type/validator | 同提交新增 schema、TS 类型、validator、错误码与 contract tests | schema/type/HTTP 不分批漂移 |
| W2-G02 Job kind | DB CHECK 与 `JobKind` 仅 proposal/render/snapshot_publish | 增加 `materialize`，含向前迁移与旧 DB 打开测试 | 不重建/丢弃旧 job 表 |
| W2-G03 TypedEdit | 只有 fit 与 replace asset | 增加 `adopt_materialization`、`restore_snapshot`，保持 discriminated union | 禁止 `payload:any` |
| W2-G04 OpenFilm 写 | capability 全 blocked，`plan()` 固定 422 | 只开放 adopt/history 所需明确 op；stage 仍严格拒绝 rebased | 不开放任意 native op |
| W2-G05 Coordinator | 仅 legacy `executeEdit()`，commit 参数绑定 `EditResponse` | 增加内部 controlled-write 流程与 Wave 2 response；legacy wrapper 字节兼容 | 不创建第二 actor/commit 路径 |
| W2-G06 持久实体 | 无 binding/materialization/impact/history read model | 在同一 `RevisionStore` 连接上增加 additive tables/store | 不建第二 SQLite/第二 revision |
| W2-G07 Materialize | 无服务/worker/renderer/artifact store | 增加只读准备链和内容寻址衍生产物区 | source/revision/active manifest 全部 NOWRITE |
| W2-G08 Impact | 无 server canonical impact/hash/TTL | 当前 snapshot/control/rights/plan 计算并持久化 | 客户端不能自报 impact |
| W2-G09 History | native undo/redo/restore 均 blocked | 翻译为 `restore_snapshot` 新 revision | 禁止直接换 active pointer |
| W2-G10 Evidence | 无 WAVE2 script/manifest/integrity | 新增不可覆盖捕获和逐 case 映射 | 测试总数不能替代 case |
| W2-G11 迁移目标解析 | `migratedRoots` 会在启动时恢复，但 `ProjectCatalog` 仍只认识静态 `d1-30s`；默认 registry 也没有把 OpenFilm port 组成进去 | W2.0 增加 `ProjectResolver`/`ActivatedProjectView`，从已提交 migration + binding + active commit 解析目标 root/投影，并显式装配 pinned OpenFilm port | 不把迁移 root 塞回 legacy catalog，不从请求接收 root，不靠进程内 map 作为权威 |
| W2-G12 目标资产账本 | M2.3 复制媒体到目标 `assets/`，但没有复制 Manifest@2，migration plan 的 asset 行也不含完整 license；目标项目不能直接复用 `AssetRegistry` | W2.0 增加 target-owned `MigratedAssetLedger`：只对可证明的旧迁移做一次 bootstrap，逐项从源 Manifest@2、migration plan/report、目标 bytes 交叉核对后写入同一 DB；新迁移激活时原子播种 | 账本不写 author source；不得静默跨项目 fallback；任一映射/许可/bytes 不唯一则 capability blocked |
| W2-G13 提案归属 | D4.1 comparison 的 `project_id` 是创建它的源项目；现有真实证据不能自动变成目标项目提案 | materialize 强制 comparison/project/active commit 同项目；验收可将已记录真实 runner draft 通过正常 adapter 在目标投影上重放构建，保存来源 SHA lineage | 禁止改 JSON project_id、跨项目 rebind 或把 replay 冒充新 provider 调用 |

## 4. 已识别的文档冲突及裁决

### C-01：旧 D4.2 composite 与目标原生三 clip 冲突

`docs/contracts/d4.2-materialized-proposal.schema.json` 以单个 `composite_asset_id` 为中心，适配旧 Hypit
`media.replace` 路线。Wave 2 的权威产物改为 `native_plan.clips[] + optional proxy`；三个 proposal segment
必须对应三个稳定、原生可编辑 clip。旧 schema 保留为历史审查快照，不注册到 runtime，不可复制实现。

### C-02：M3 写 Manifest@2 会破坏 NOWRITE

当前 source closure 会纳入 manifest/引用资产。M3 若把 proxy 写入 active Manifest@2，会改变 source digest，
与 AC-009 冲突。裁决：M3 的 proxy/plan/lineage 进入 materialization 专属内容寻址区和数据库 read model；
只读取 active asset ledger 的输入事实。M4 在隔离 stage 内把真正采用的资产写入目标 source，并随新 snapshot
一次提交；OpenFilm ledger 只在 commit 事务内同步新引用，不在 M3 修改。

### C-03：新路由与 legacy `/edits` 的关系

保留 `POST /api/projects/:id/edits` 及其合同。Wave 2 使用 versioned
`POST /api/migration/v1/projects/:id/edits`，不得把新字段塞进 legacy request 后破坏旧客户端。

### C-04：idempotency scope

legacy `edit_idempotency` 保持原样；Wave 2 新建通用 `operation_idempotency`，主键为
`(project_id, operation_kind, idempotency_key)`。每种 Wave 2 operation 只有这一处权威，不同时写两张幂等表。

### C-05：迁移目标不是 legacy `ProjectCatalog` 项目

`migratedRoots` 当前只记录/恢复路径，没有进入 `ProjectCatalog`，目标目录也没有目标 descriptor/Manifest@2。
Wave 2 不得用类型断言或内存 map 掩盖这个事实。裁决：增加 Host-owned `ProjectResolver`，legacy Hypit 继续委托
`ProjectCatalog`；OpenFilm 只接受同时存在 terminal migration、唯一 engine binding、active commit 且 root realpath
位于 migration root 下的 `ActivatedProjectView`。其 descriptor 是只读 projection，source root 仍是真实 OpenFilm
目录。所有 project/proposal/materialize/impact/write 接缝统一依赖 resolver，不能各自猜路径。

### C-06：目标资产事实的兼容播种

旧迁移没有目标 Manifest@2。W2.0 以一次性、可审计、幂等 bootstrap 建立 DB 内目标自有
`MigratedAssetLedger`：源 Manifest@2 的 asset id/license/source facts，与 migration plan/report 的 source→target
路径、目标文件的双次 SHA/帧数必须一一对应；源工程当前 tree digest 还必须等于 migration 捕获的
`source_sha256_before`，否则无法证明 license/manifest 是迁移时事实。保存源 manifest SHA、migration id 和目标
bytes SHA lineage；目标 basename 冲突或多对一也必须拒绝。
它是 Host 控制事实，不是第二 timeline，也不修改 author source/revision/active commit。bootstrap 只允许在任何
Wave 2 写入之前运行；若目标已经有 Wave 2 transaction、映射不唯一或源事实已无法证明，则进入 attention 并
保持新能力关闭。后续新迁移应在激活事务中直接播种同一账本。M3 只能读取该账本；不得在请求时回退读取源项目。

### C-07：proposal 不允许跨项目改绑

`ProposalComparison.project_id` 必须等于 materialize path 的 OpenFilm target id，且其 base revision/source facts
对应目标 active commit。Wave 2 验收无需重新付费调用 Claude：允许把已保存的真实 D4.1 runner draft/audit
作为离线输入，在目标 `ProjectResponse` 上重新走 `ProposalComparisonAdapter.build()`，并记录原始 stdout/payload
SHA、目标 comparison SHA 和 `replayed_from` lineage。它仍是 target-owned comparison，但报告必须写
`RECORDED_PROVIDER_OUTPUT_REPLAY`，不得称为本轮新 provider 成功。生产路径仍由正常 target proposal route 创建。

## 5. 非阻塞限制

- OpenFilm snapshot-bound正式 render 仍标记 M6；Wave 2 真实验收可复用固定上游 renderer harness 验证两次
  导出，但不得把它冒充 M6 生产 render route。
- headed/human 在本波为 `NOT_RUN`；自动 UI 如新增只能 Headless、静音、隔离 profile。
- 真实链先覆盖固定 30/1、三镜、900 帧 fixture；其他 fps/cross-project/未知 feature 继续 fail closed。
