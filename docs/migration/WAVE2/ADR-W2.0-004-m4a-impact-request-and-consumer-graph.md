# ADR-W2.0-004：M4A Impact 请求与 ConsumerGraph 收口

状态：`APPROVED_FOR_M4A_IMPLEMENTATION`
日期：2026-10-20
影响契约：AC-008、AC-009、AC-010；不改变 EnginePort 七方法、单引擎或唯一提交权

## 1. 触发事实

Wave 2 冻结文档已经定义 `ImpactSpecV1` 和 impact route，但没有定义 route 的 runtime request schema；
同时 `EngineProjection` 能表达 clip/track/subtitle/asset reference，却没有通用 transition 图或字幕时间范围。
若实现者自行猜测请求字段或把未知消费者当作“无影响”，M4B 会出现合同返工或锁漏检。

本 ADR 是实现前的加法收口，不改已落盘的 response/hash/TTL 语义，不开放任何写入工程的能力。

## 2. 决策 A：新增明确的 ImpactRequestV1

新增 `contracts/impact-request.schema.json`、`ImpactRequestV1` TypeScript 类型、validator 和合同测试：

```ts
type ImpactIntentV1 =
  | { op: "adopt_materialization"; materialization_id: string }
  | { op: "restore_snapshot"; target_snapshot_id: string };

interface ImpactRequestV1 {
  format: "narralens.impact-request@1.0";
  base_revision: number;
  expected_source_digest: Sha256;
  control_revision: number;
  intent: ImpactIntentV1;
  idempotency_key: string;
}
```

所有对象 `additionalProperties=false`；ID 非空；`idempotency_key` 长度 1..200；revision 为非负安全整数；
SHA 为小写 64 hex。请求不含
affected range、consumer、rights、lock、engine SHA、expiry、hash、path、URL 或 shell 参数，这些全部由 Host
重读。impact POST 会持久化授权事实，因此遵守统一写请求幂等规则：同项目/operation/key 且 request digest
相同，完整重放原 spec（包括 impact id/hash/expiry）；同 key 不同 digest 返回 409。过期后要重新评估必须换新 key，
不能用旧 key 延长授权窗口。request digest 对去掉 `idempotency_key` 后的规范请求计算。

## 3. 决策 B：ConsumerGraph 是可重建只读图，不是第二 timeline

目标文件 `src/host/projects/consumer-graph.ts`。输入只能是当前 committed `EngineProjection`、已重验的
`MaterializationV1/NativePlanV1` 或属于本项目的 immutable snapshot projection；输出为规范、排序后的边：

```ts
interface ConsumerEdgeV1 {
  producer_kind: "clip" | "asset" | "track" | "subtitle";
  producer_id: string;
  consumer_kind: ConsumerKind;
  consumer_id: string;
  range: HalfOpenRange | null;
  relation: "contains" | "references" | "overlaps" | "preserves";
}
```

M4A 默认不持久化 `consumer_edge`；先由 projection 确定性重建。若以后缓存，缓存键必须包含
`project_id+Host active_commit.snapshot_id+source_digest`，只能删后重建，不能成为写入权威。adapter 返回的
`projection.snapshot_id` 当前由 source digest 派生，不是 `RevisionStore` snapshot id，禁止拿它替代 Host commit
identity。

固定 V1 OpenFilm 三镜能力按下列规则计算：

- materialization native plan 必须是已验证的连续半开覆盖；每个 plan range 与当前 projection 的 visual
  page/video/still clip 求交。`affected_ranges[].clip_id` 使用**当前 projection clip id**并合并同 clip 的相邻交集，
  不使用尚未提交的 `clip-<segment>` id；没有唯一、完整覆盖或越出 project frame_count 直接拒绝；
- 每个被覆盖的当前 visual clip 生成 `visual/replace` consumer；plan clip/asset identity 由 native plan hash 绑定，
  不冒充当前锁 target；
- 当前 projection 中与 affected range 重叠的 sound/audio clip、subtitle、track 与 asset reference 只记录真实
  preserve/relink 关系；不因“想覆盖三类锁”制造不存在的变化；
- source_ref 与 asset reference path 必须唯一匹配；重复、悬空或 ambiguous 直接 422，不能少算 shared asset；
- 当前 projection 出现 M4A 不会表达的 transition、未知 clip kind、无范围但可能被改变的消费者或
  `problems[]` 非空时，impact capability fail closed，不生成 spec；
- 当前 adapter 会静默跳过无 id/src/未知扩展名的 clip，且 `EngineProjection` 没有 transition 字段。M4A 必须把
  projection completeness 纳入生产投影门：adapter/独立只读验证器须对每个 upstream track/clip 建立一一映射，
  遇到未建模字段、非空 overrides、未知 consumer/transition 线索或被跳过节点写入 `problems[]`/拒绝；不得用
  “projection 中没看见”证明 upstream 中不存在；
- `duration_policy="preserve"` 且 plan 的连续覆盖边界与被替换范围一致时不声明 duration 变化；否则 M4A
  capability blocked（真正改变 duration 属 M4B 扩展）。`narration_policy="preserve"` 下 sound/subtitle/audio
  consumer 只记录 preserve，不触发 narration lock；若无法证明 preserve 则拒绝而非乐观放行；
- `locks_checked` 是本次评估读取的全部 active lock 的稳定排序快照（最多 64）；任一真实 affected lock 冲突则
  423 且不创建 spec。无 active lock 时为空；超过合同上限 fail closed。`approvals_required` 在 M4A 固定为
  `["human_confirmation"]`，与 M4B `approval.confirmed=true` 对齐，不代表费用或外传授权；
- ConsumerGraph 不保存 clip 顺序或另一份最终 timeline，不允许被 adapter 写入。

## 4. 决策 C：ImpactStore 与 currentness

在现有 `RevisionStore` 的同一 SQLite 连接增加 `impact` 表，不新建数据库：

```sql
impact(
  impact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('adopt_materialization','restore_snapshot')),
  reference_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  source_digest TEXT NOT NULL,
  control_revision INTEGER NOT NULL,
  rights_digest TEXT NOT NULL,
  native_plan_sha256 TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  impact_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','consumed','expired','stale')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, impact_hash)
)
```

状态仅允许 `active→consumed|expired|stale`，全部 CAS。M4A 只创建 active，并提供供 M4B/M4C 使用的
`requireCurrent()`；不在 M4A 消费。固定 TTL 为从注入时钟起 15 分钟，边界为 `now >= expires_at` 即 expired。
幂等重放不得刷新 expiry、重新计算 impact 或创建第二 row；读取重放 row 时仍执行 hash/state/TTL/currentness，
过期/失效返回 428 而不是悄悄签发新授权。

幂等权威必须复用现有 `operation_idempotency(project_id,operation_kind,idempotency_key)`，固定 operation kind 为
`impact.adopt_materialization` 或 `impact.restore_snapshot`。不得在 impact 表再建 key 唯一约束或第二幂等表。
创建 impact row 与写入包含完整 ImpactSpec 的 operation-idempotency response 必须处于同一个
`RevisionStore.atomic` 事务：任何一边失败都不留 orphan row/response。可以从 `MaterializationStore` 抽取窄的
`OperationIdempotencyStore`，或复用其现有实现，但表、连接和权威只能有一份，旧 materialize 行为不得改变。

`impact_hash = SHA256("narralens-impact-v1\n" + canonical(spec without impact_hash))`。canonical 复用
`source-digest-v1.ts` 的键排序规则；数组按语义排序后进入 spec：range 按 start/end/clip_id，consumer 按
kind/id/action，locks 按 lock_id。提供固定 JSON vectors 与 Python 或独立 JS 实现互校，不以同一函数自证。

## 5. 决策 D：创建顺序与副作用边界

route 内顺序固定为：auth/origin → body/schema → `ProjectOperationQueue` 的项目串行读屏障 →
`ProjectResolver.resolveActivated`（capability）→ 通用 operation idempotency replay/conflict/currentness → base/source/control →
active commit/snapshot 的 `EnginePort.inspect` →
materialization 或 snapshot reference 重验 → asset/rights/bytes currentness → ConsumerGraph → 实际锁分类与
`LockService.assertUnlocked` → 二次 base/source/control/currentness → ImpactStore insert → 201。

允许副作用只有同一事务内的 impact row 与通用 operation-idempotency response row。前后必须相等：author
source closure、revision、active commit/snapshot pointer、engine binding、asset ledger、materialization/job/
outbox。Impact 不调用 `EnginePort.plan/stage/validate`，不创建 project transaction，不写 snapshot，不发送
provider 请求。

第一次检查后、最终检查前发生的 source/control/rights/materialization/active commit 变化必须拒绝且不留 active
row。insert 之后发生的外部 filesystem 变化无法由 SQLite 事务倒转时间；它必须在任何重放或 M4B 使用前由
`requireCurrent()` 检出并以 CAS 将 row 置 stale，再返回 428。M4A 不允许任何消费者仅凭 `state='active'` 使用
impact。

M4A route 可同时计算 adopt 与 restore impact，以冻结 M4B/M4C 共用接口；但 restore 的 snapshot 必须属于同一
项目且能由 pinned adapter inspect。若当前实现尚不能可靠 inspect immutable historical snapshot，则 restore
intent 保持 404/422 capability blocked，不用 active source 冒充旧 snapshot。

## 6. 决策 E：生产投影装配必须来自持久事实

当前 `composeOpenFilmPort()` 只把 `OpenFilmEngineAdapter` 注册进 `EngineRegistry`；adapter 的
`registerLayout()` 只在测试/探针调用。生产重启后，直接 `EnginePort.inspect()` 会因为没有 layout 而 fail closed。
M4A 必须先关闭此接缝，不能把测试手工注册当作生产证明。

新增 Host-only `ActivatedProjectionService`（或等价命名）并遵守以下约束：

- 先由 `ProjectResolver.resolveActivated()` 得到 `source_root`、migration id、Host revision、active commit
  snapshot id、source digest 与 control revision；请求不能提供 root/layout；
- 从同一 `RevisionStore` 的 terminal migration、immutable plan、target snapshot facts 与
  `MigratedAssetLedger` 重建 `OpenFilmProjectLayout`：`film.html` 为第一 root；plan 中 narration/subtitle 的
  target path 作为显式 roots；ledger 中 target path/id/hash 形成 declared assets；scene/html/css/js/font 由
  `film.html` 的受控 source-digest closure 发现。路径均相对 root 且 realpath/closure fail closed，不得目录扫描后
  “猜”出权威清单；
- 不得依赖 `MigrationPlanV1.identity_map` 恢复 target clips：当前 plan 在复制前冻结，该字段为空；当前 target clip
  identity 必须来自 pinned upstream 对 `film.html` 的解析，frame_count 的 Host 权威仍是 migration store 的
  `target_total_frames`；不得把临时 report extras 冒充 durable facts；
- 可以把 layout 注册到 adapter 的进程内 map，但它只是由持久事实重建的缓存，Host 重启后必须无需测试 hook
  即可再次装配；缓存键至少绑定 `project_id+active_commit.snapshot_id+source_digest`，事实变化时刷新；
- 该 seam 位于 Host composition，不增加 EnginePort 第八方法，不把 concrete adapter、绝对路径或 layout 暴露到
  API/`OpenFilmComposition` 公共响应；`EnginePort.inspect()` 仍是唯一解析 OpenFilm film 的入口；
- adapter 投影中的 `project_revision/control_revision=0` 是旧读模型占位。Impact 的 base/control/snapshot identity
  必须取 Host `ActivatedProjectView`，不得信任或比较 adapter 的两个 0；projection 只提供 engine content graph、
  digest、fps、clips/tracks/subtitles/assets/problems；
- `SnapshotRef` 只有 source digest，因而 M4A 只允许 inspect 当前 active commit。历史 restore 若没有独立 immutable
  snapshot root/layout 解析能力，必须保持 capability blocked。

`M4A-P01` 必须以全新 Host 进程证明：一个已经 terminal/activated 的 OpenFilm target 不调用测试专用
`registerLayout()` 也能通过 pinned adapter inspect；缺迁移事实、root escape、ledger/source 漂移均 fail closed。

## 7. 错误语义

- malformed/extra-field：400 `INVALID_REQUEST`；
- project/materialization/snapshot 不存在或不属于项目：404 `NOT_FOUND`，不泄漏跨项目事实；
- base/source/control/current facts 改变：409 `REVISION_CONFLICT` 或 `SOURCE_CHANGED`；
- 同 idempotency key 不同 request digest：409 `IDEMPOTENCY_KEY_CONFLICT`；
- materialization 非 `ready_for_adoption`、缺 plan/lineage 或 projection 无法完整分类：422 `INVALID_REQUEST`
  或既有更具体 code，且不创建 impact；
- 项目 attention：423 `PROJECT_ATTENTION_REQUIRED`；实际受影响锁命中：423 `TARGET_LOCKED`；
- impact 在后续读取时 hash/TTL/current facts 不符：428 `IMPACT_STALE`。

## 8. 回退与兼容

关闭 impact route 即可回退部署；保留 additive impact 表和已有 active/expired rows。M4A 不改变 legacy route、
M3 materialize、source 或 revision，因此无需内容回退。不得删除历史 evidence 或用 git reset 回退。
