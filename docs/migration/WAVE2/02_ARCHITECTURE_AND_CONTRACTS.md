# Wave 2 详细架构与契约冻结

状态：`FROZEN_FOR_WAVE2_IMPLEMENTATION`。本文冻结实现行为，不代表路由已存在。

配套可视化源：`docs/migration/wave2-m3-m4-architecture.archify.json`。

## 1. 零层与一层数据流

```text
OpenFilm Studio / Headless client
  → Local Host versioned routes
  → ProjectResolver（legacy catalog | activated OpenFilm view）
      → MigratedAssetLedger（target-owned Host metadata）
  → M3 MaterializeService（只读 source）
      → PersistentJobStore lease → NativePlan + proxy + lineage
  → M4A ImpactService（只读 current committed snapshot）
  → M4B AdoptionCoordinator / M4C HistoryService
      → ProjectOperationQueue
      → NativeWriteGateway + locks/base/source/control/rights/impact
      → EnginePort.plan → stage → validate
      → SnapshotStore.publish
      → RevisionStore atomic revision/pointer/idempotency/outbox
  → 单项目唯一 OpenFilm source
```

数据所有权：Proposal/Asset 是输入事实；Materialization 是可丢弃重算的只读准备事实；Impact 是短期授权
事实；Snapshot/active commit/revision 是内容事实；EnginePort 只规划和操作隔离 stage，不能 commit。

## 2. 组件边界

| 组件 | 责任 | 禁止 |
|---|---|---|
| `MaterializationStore` | binding、request digest、state、native plan、proxy、lineage、blocking | 保存第二份完整 timeline；修改 active source |
| `ProjectResolver` | 由静态 catalog 或 terminal migration+binding+commit 解析唯一 project/source root | 请求路径、内存 map 或 adapter 猜 root |
| `MigratedAssetLedger` | 保存 target-owned asset/license/bytes lineage；为 M3/M4 解析目标素材 | 静默跨项目 fallback；成为第二 timeline；写 author source |
| `BindingService` | 解析 proposal segment→eligible asset span，复核 hash/rights/frames | 自动 loop/freeze/speed；信任客户端许可 |
| `NativePlanBuilder` | 生成确定的 clip spec、稳定 ID、目标帧范围 | 生成 flattened 单 clip 替代三 clip |
| `ProxyRenderer` | 固定 ffmpeg argv 生成比较 proxy，内容寻址 | shell、任意参数、网络、source 写入 |
| `ImpactStore/Service` | 从 committed projection/plan/locks/rights 计算 canonical impact | 接受客户端自报消费者/影响 |
| `AdoptionCoordinator` | 调用 ProjectCoordinator 的唯一受控写流程 | 自己写 revision/binding/source |
| `HistoryService` | 将 old snapshot 内容转为新的 controlled write | 直接更新 active_commit 指向旧 snapshot |
| `ConsumerGraph` | narration/subtitle/audio/transition/shared asset 消费关系 | 持久化第二时间线 |

## 3. 核心合同

所有对象 `additionalProperties=false`；SHA 为 64 位小写 hex；帧区间为整数半开区间；fps 为约分后的
`{num,den}`。下面字段是 runtime schema 和 TypeScript 类型的最小全集。

### 3.1 MaterializeRequestV1

```ts
interface MaterializeRequestV1 {
  format: "narralens.materialize-request@1.0";
  comparison_id: string;
  base_revision: number;
  expected_source_digest: Sha256;
  control_revision: number;
  profile: { profile_id: "wave2-proxy-720p30-v1" };
  segment_bindings: Array<{
    segment_id: string;
    asset_id: string;
    source_start_frame: number;
    source_end_frame_exclusive: number;
  }>;
  idempotency_key: string;
}
```

语义：`proposal_id` 来自 path；comparison、proposal 与 path project 必须同属目标 OpenFilm project，禁止把
源 Hypit comparison 改写 project id；每个 proposal segment 恰一条 binding，不能多/少/重复；source span 长度
必须至少为 segment 目标帧数，M3 v1 要求恰长裁切且不隐式变速。Host 重读 comparison/proposal、当前
active commit、目标资产账本、asset bytes、rights 和 control revision。legacy Hypit 资产由 Manifest@2 提供；
OpenFilm 目标资产只由已验证的 `MigratedAssetLedger` 提供，二者实现同一只读 `AssetInventoryPort`。

### 3.2 NativePlanV1 与 MaterializationV1

```ts
interface NativePlanV1 {
  format: "narralens.native-plan@1.0";
  engine: "openfilm";
  fps: { num: 30; den: 1 };
  clips: Array<{
    clip_id: string; segment_id: string; asset_id: string; asset_sha256: Sha256;
    timeline: HalfOpenFrameRange; source: HalfOpenFrameRange; track_id: string;
  }>;
  narration_policy: "preserve";
  duration_policy: "preserve";
  total_frames: number;
  plan_sha256: Sha256;
}

type MaterializationState = "queued" | "running" | "validating" |
  "ready_for_adoption" | "stale" | "cancel_requested" | "cancelled" |
  "failed" | "attention";

interface MaterializationV1 {
  format: "narralens.materialization@1.0";
  materialization_id: string; job_id: string; project_id: string;
  comparison_id: string; proposal_id: string; state: MaterializationState;
  base_revision: number; source_digest: Sha256; control_revision: number;
  proposal_sha256: Sha256; asset_inventory_sha256: Sha256; rights_digest: Sha256;
  request_digest: Sha256; native_plan: NativePlanV1 | null;
  proxy: null | { token: string; sha256: Sha256; frame_count: number; profile_id: string };
  lineage: Array<{ output_sha256: Sha256; input_asset_id: string; input_sha256: Sha256;
    source: HalfOpenFrameRange; output: HalfOpenFrameRange }>;
  blocking_reasons: string[]; created_at: string; updated_at: string;
}
```

proxy token 只由 Host 解析，API 不返回绝对路径。三镜 fixture 的 `clips.length` 必须为 3，ID 稳定且
互不重复。materialization 读取时重新复核 base/source/control/inventory/rights/bytes；任一变化返回
`state=stale`，永不自动升级或采用。

### 3.3 ImpactSpecV1

```ts
interface ImpactSpecV1 {
  format: "narralens.impact@1.0";
  impact_id: string; project_id: string; operation: "adopt_materialization" | "restore_snapshot";
  materialization_id: string | null; target_snapshot_id: string | null;
  base_revision: number; source_digest: Sha256; control_revision: number;
  engine: "openfilm"; engine_upstream_sha: string;
  affected_ranges: Array<HalfOpenFrameRange & { clip_id: string }>;
  affected_consumers: Array<{ kind: "visual"|"narration"|"subtitle"|"audio"|"transition"|"shared_asset";
    id: string; action: "preserve"|"replace"|"relink" }>;
  locks_checked: Array<{ lock_id: string; control_revision: number }>;
  rights_digest: Sha256; native_plan_sha256: Sha256; approvals_required: string[];
  expires_at: string; impact_hash: Sha256;
}
```

impact hash：`SHA256("narralens-impact-v1\n" + canonical(spec without impact_hash))`。固定 TTL 15 分钟，
使用注入时钟测试；读取时 base/source/control/rights/plan 任一变化即 `IMPACT_STALE`。

### 3.4 AdoptRequestV1 / RestoreRequestV1 / ControlledWriteResponseV1

```ts
interface AdoptRequestV1 {
  format: "narralens.adopt-request@1.0";
  base_revision: number; expected_source_digest: Sha256; control_revision: number;
  materialization_id: string; impact_id: string; impact_hash: Sha256;
  approval: { confirmed: true }; idempotency_key: string;
}
interface RestoreRequestV1 {
  format: "narralens.restore-request@1.0";
  base_revision: number; expected_source_digest: Sha256; control_revision: number;
  target_snapshot_id: string; impact_id: string; impact_hash: Sha256;
  approval: { confirmed: true }; idempotency_key: string;
}
interface ControlledWriteResponseV1 {
  format: "narralens.controlled-write-response@1.0";
  transaction_id: string; project_id: string; operation: "adopt_materialization"|"restore_snapshot";
  previous_revision: number; new_revision: number; snapshot_id: string;
  source_digest: Sha256; outbox_event_id: number; status: "committed";
}
interface ControlledWriteFailureResponseV1 {
  format: "narralens.controlled-write-failure@1.0";
  transaction_id: string; project_id: string; operation: "adopt_materialization";
  previous_revision: number; new_revision: number; source_digest: Sha256; status: "aborted";
  error: { http_status: 409|422|423|428|500; code: ApiErrorCode; message: string; details?: JsonValue };
}
```

成功必须 `new_revision=previous_revision+1`；失败 0。恢复旧内容仍生成新 snapshot/commit/revision，不能
复用旧 active pointer 作为“成功”。同 project+operation+key 同 digest 重放完整响应；不同 digest 409。
`approval.confirmed` 只在有效 loopback session、未过期且 hash 匹配的 impact 上生效；它不授权费用或外传。
aborted 事务以 failure response 的 `error.http_status` 首次返回并逐字重放，且 new=previous；不得冒充 committed。

## 4. 持久模型

所有表加入现有 `RevisionStore` 的同一 SQLite 连接。新表采用 additive migration。`migrated_asset` 以
`(project_id,asset_id)` 为主键，保存 migration/source manifest/target path/bytes/license/frame lineage；每个目标
另有唯一 bootstrap record（state、input digest、control revision）。它只在新 migration activation 或旧目标的
W2.0 前置 bootstrap 中写入。`job.kind` 的 SQLite
CHECK 无法原地扩展，因此是唯一允许的受控表迁移：先用 `VACUUM INTO` 生成同目录可验证备份，再在
`BEGIN IMMEDIATE` 中创建 `job_v2`、按显式列逐行复制、校验行数/主键/状态/lease/receipt digest、替换表并
记录 `schema_migration`；任一步失败保留旧表和备份并拒绝启动。必须有 Wave 1 真实数据库 fixture 重开测试。

| 表 | 主键/唯一约束 | 必需字段 |
|---|---|---|
| `materialization` | PK id；UNIQUE(project, operation key) | proposal/base/source/control/inventory/rights/request digest、state、job、plan/proxy/lineage JSON、blocking、timestamps |
| `impact` | PK id；UNIQUE(project, impact_hash) | operation/ref/base/source/control/rights/plan hash、canonical JSON、expires/state |
| `operation_idempotency` | PK(project, operation_kind, key) | request_digest、response_json、transaction_id、created_at |
| `consumer_edge` | PK(project,snapshot,kind,consumer,producer) | range、relation；可由 projection 重建，不含完整 timeline |
| `migrated_asset` | PK(project,asset)；UNIQUE(project,target_path) | migration/source project/source tree+manifest、target path/bytes、frames、source/license canonical JSON |
| `asset_ledger_bootstrap` | PK project；UNIQUE(project,input_digest) | migration、state、control revision、created_at；只允许 prepared→active/attention |

`job.kind` CHECK 与 `JobKind` 增加 `materialize`，默认 max attempts=3、lease=30 秒；失 lease 可重排，
达到上限进入 attention。全局 materialize worker 并发 2，同项目 active materialize 1；每 segment 本地工具
超时 120 秒，最多 64 segment。取消后的产物进入 quarantine，materialization 不得变为 ready。

Adoption 复用 `project_transaction.kind=edit`，以 versioned request_json 区分；history 使用现有
`kind=history`，因此不扩张该表 CHECK。`rights_digest` 按 proposal segment 语义顺序对
`asset_id/bytes_sha/license status/commercial_use/manifest_sha` canonical 后计算，不能只散列 label。

## 5. 状态机

```text
materialization:
queued → running → validating → ready_for_adoption
  ├→ cancel_requested → cancelled
  ├→ stale
  ├→ failed
  └→ attention

impact: active → consumed | expired | stale

controlled write:
received → preconditions_checked → staged → validated → prepared → committed
  ├→ aborted（任何可证明未发布的合法前态，包含 source 仍为 before 的 prepared）
  ├→ recovering
  └→ attention（发布/commit 不确定）
```

每个 transition 必须以允许前态写入 `WHERE`/CAS；不得任意 UPDATE state。
M4B 不扩张 terminal `attention` 的出边：专用 adoption recovery 必须在通用 `recoverOnStart()` 之前、项目队列内
检查 active `film.html` 的 before/after bytes 与 transaction/snapshot/fact/impact 权威事实。可证明 after 时直接从
原合法前态完成 commit；可证明 before 时从原合法前态 abort；不可证明才进入 terminal attention。不得先把 M4B
prepared 行改成 recovering/attention 再尝试恢复，也不得为“恢复成功”自动清除既有 project attention latch。

## 6. API 冻结

| Route | M3/M4 | 成功 | 主要错误 |
|---|---|---|---|
| `POST .../:proposalId/materialize` | M3 | 202 JobResponse + materialization_id | 409 stale/idempotency；422 binding/media；423 attention |
| `GET /api/migration/v1/materializations/:materializationId` | M3 | 200 MaterializationV1 | 404；读取发现变化则 200 stale |
| `POST /api/migration/v1/projects/:id/impact` | M4A | 201 ImpactSpecV1 | 409 base/source；422 ref；423 lock/attention |
| `POST /api/migration/v1/projects/:id/edits` | M4B | 200 ControlledWriteResponseV1 | 409 base/source/idempotency；423 lock；428 impact/approval |
| `POST /api/migration/v1/projects/:id/history/restore` | M4C | 200 ControlledWriteResponseV1 | 同上，另 422 snapshot 不属于项目 |

错误优先级保持：auth/origin → schema/capability → idempotency → project/resource ownership → base/source/control
→ attention → materialization/rights/impact/approval → locks → execution；M4B 的更细调用顺序以
`12_M4B_DEVELOPMENT_GATE.md` §5 为唯一权威。Wave 2 versioned 写请求沿用 Host 已落地的 64 KiB body 上限；不接受 path、URL、
shell 参数或客户端 rights/hash 事实。旧版 1 MiB 文案已被实际 Host 限制与 M4A 外审观察取代，不为文档对齐而
放宽生产入口。

## 7. M3 NOWRITE 清单

materialize 前后必须逐字/逐值相等：author source closure、active commit、project revision、engine binding、
active asset ledger（legacy 是 Manifest@2；OpenFilm 是 MigratedAssetLedger）。允许变化：materialization/job/event/
outbox read model、专属 derived artifact 目录。旧目标 ledger bootstrap 属于 W2.0 开工前兼容迁移，不得夹在
materialize 请求中懒执行。

## 8. M4 写入顺序

1. 在项目队列内重放/冲突检查；
2. 读取唯一 active commit/binding；复核 base/source/control；
3. 重读 materialization/impact/rights/bytes，验证 TTL/hash/approvals；
4. 从 native plan + ConsumerGraph 计算实际受影响锁并拒绝冲突：adopt 至少触发 visual，clip 边界变化
   触发 duration；只有真实 narration/subtitle/audio consumer 改变才触发 narration；restore 按旧/当前
   projection 差异可触发三类锁，不能为了“覆盖三类”而无差别过度阻塞；
5. Host 从 `AssetInventoryPort` 按 asset id/hash 解析受控 bytes，分配 isolated root，并只向 plan/stage 传
   相对 input token `inputs/<sha256>/source.mp4`；Host 将 bytes 安装到该 token，adapter 在 stage 中复制为目标
   `assets/<sha256>/source.mp4`。请求、materialization、EnginePort 结果均不携带绝对服务器路径；
6. `EnginePort.plan()` 只生成明确 OpenFilm ops，adapter stage 写 isolated root；rebased=true 必须 409；
7. validate 三个独立 clip、总帧数、旁白/字幕/相邻区不变量；
8. publish immutable snapshot；
9. 再次复核 control/base，单事务 revision +1、active pointer、目标 asset ledger 新引用、幂等、impact consumed、outbox；
10. 失败清理 stage；发布不确定进入 attention；callback/晚到不得执行第 9 步。

## 9. 回退

部署级回退先关闭五条 Wave 2 capability，停止 worker、等待/回收 lease，保留 additive 表和衍生产物，
继续开放 Wave 1 只读/迁移能力。内容级回退只使用 `HistoryService` 生成新 revision。禁止 git reset、删除
snapshot、覆盖旧工程或反向同步 Hypit。
