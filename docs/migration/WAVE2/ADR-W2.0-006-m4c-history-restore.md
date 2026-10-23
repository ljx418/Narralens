# ADR-W2.0-006：M4C 历史快照恢复、身份与提交语义
新增表、schema arm、route 和 capability 均为 additive。部署回退关闭 restore impact、restore route 与三个 history
translator 条目；保留 snapshot、fact、transaction、outbox 与历史 commit。内容回退只能再执行一次 HistoryService
restore，禁止 git reset、数据库 pointer 手改或删除历史行。
状态：`ACCEPTED_FOR_M4C_IMPLEMENTATION`

日期：2026-10-23

适用基线：M4B 内部冻结候选 `b2a4efb8be7f4b1c02f973ff32ea04b097196649`。M4B 独立外审仍是 M4C
开工前置门，不因本文而自动通过。

## 1. 决策背景

M4C 必须让用户恢复旧内容，同时保持 revision 单调递增、OpenFilm 原生可编辑、三类锁与当前许可策略有效，且不能
把历史恢复误做成 `active_commit` 指针回拨。现有实现已提供 content-addressed `SnapshotStore`、M4B 原子 source
publisher、`openfilm_projection_fact`、Impact/Lock/RevisionStore，但没有可验证的历史 snapshot 读取边界，也没有
restore 的持久恢复事实。

另有一个必须显式裁决的语义冲突：旧计划写“产生新 snapshot”，但 snapshot id 由
`project_id + source_digest` 内容寻址。恢复完全相同的旧内容时，正确 id 必然等于旧 snapshot id；人为生成新 id 会破坏
不可变内容身份。

## 2. 决策

### D-01 恢复是新 commit，不是新内容身份

每次成功恢复必须产生一个新的 `project_transaction(kind=history)`、新的 committed revision（恰好 `+1`）、新的
outbox event 与新的幂等 response。恢复内容若与历史 snapshot 逐字节相同，则复用同一个 content-addressed
`snapshot_id`；“新 snapshot”在本阶段解释为“新 commit 对不可变 snapshot 的新引用”，不复制相同 bytes、也不伪造
不同 snapshot id。旧 transaction、snapshot、费用与 lineage 不删除。

当前内容与目标 snapshot 的 source digest 相同属于 no-op，返回 422 `UNSUPPORTED_EDIT`，不产生 transaction/revision。

### D-02 单一历史读取边界

新增 Host-only `HistoricalSnapshotResolver`，只接受 `projectId + targetSnapshotId`，并同时证明：

1. `snapshot` 行属于同一项目且 engine=`openfilm`；跨项目与不存在统一 404；
2. snapshot 目录存在于 `SnapshotStore` 管理根，realpath 不逃逸；
3. snapshot 是 terminal migration 初始快照，或已 committed 的受控写快照；孤儿/未提交 snapshot 不可恢复；
4. layout 来自该 snapshot 的不可变 `openfilm_projection_fact`；migration 初始快照允许从 immutable migration plan、
   target snapshot facts 与 migration-provenance ledger 重建；
5. 使用固定 OpenFilm upstream inspect snapshot bytes，SourceDigestV1 必须等于 `snapshot.source_digest`；
6. roots/subtitles/frame count/clip identity 均来自目标 snapshot，而不是当前 active source 或请求。

Resolver 返回 Host-only path；HTTP、合同、日志与 adapter response 禁止出现绝对路径。

### D-03 历史恢复计划与 ImpactSpecV1

新增 server-only `HistoryRestorePlanV1`，由当前 projection 与目标 projection 的 canonical diff 生成：

```ts
interface HistoryRestorePlanV1 {
  format: "narralens.history-restore-plan@1.0";
  project_id: string;
  target_snapshot_id: string;
  current_snapshot_id: string;
  current_projection_sha256: Sha256;
  target_projection_sha256: Sha256;
  affected_ranges: readonly (HalfOpenRange & { clip_id: string })[];
  affected_consumers: readonly AffectedConsumer[];
  required_locks: readonly AffectedLock[];
  target_roots: readonly string[];
  target_subtitles: readonly { subtitle_id: string; path: string }[];
  target_frame_count: number;
  rights_digest: Sha256;
  plan_sha256: Sha256;
}
```

`ImpactSpecV1.native_plan_sha256` 在 restore arm 中绑定上述真实 restore plan 的 `plan_sha256`，不是 materialization plan、
占位 hash 或目标 snapshot id hash。wire shape 不升级；adopt arm 语义不变。restore spec 固定
`materialization_id=null`、`target_snapshot_id!=null`。

现有 `affected_ranges.minItems=1` 只对 adopt arm 保持；restore 可为仅 narration/audio 的真实变化，因此 restore arm 允许
空 ranges，但 `affected_consumers` 与 `required_locks` 必须非空。schema 用 conditional 约束两条 arm，不能全局放宽 adopt。

Impact 必须按当前策略重新读取 target roots 所引用的资产/许可并生成 rights digest。相同目标、不同当前 revision/
source/control/rights/locks 必须产生不同或拒绝的授权，不得重放旧授权。

### D-04 差异分类与三类锁

只对真实差异加锁，不因“restore”操作名全项目过度锁定：

- clip 内容/asset/fit/time 改变：对应当前 clip 的 visual shot range；
- clip 增删、重排、边界或总帧数改变：visual project + duration project；
- narration/audio 改变：narration project；
- subtitle 文本/范围改变：narration project，并记录 subtitle consumer；
- shared asset/transition 改变：记录所有消费者，并按其实际视觉/时长影响加锁；
- 未知 projection 字段、无法一一分类或超过上限：422 fail closed，不以全项目锁掩盖分类缺口。

Impact 计算时检查一次，source publish 前从当前 projection 与目标 snapshot 重新构造计划并再次检查；仅比较已存
`locks_checked` 不足以提交。

### D-05 可恢复 source 发布范围

M4C 只恢复 Wave 2 可证明的 OpenFilm 快照。目标与当前的非 `film.html` 可变 roots（外置字幕、旁白资产、设置等）必须逐字节
一致；否则 422 `CAPABILITY_NOT_ENABLED`，留待后续支持多文件原子包。本阶段允许的 active-root 变化仍为：

1. 安装目标 snapshot 引用但 active root 缺失的内容寻址资产；
2. 原子替换 `film.html`；
3. 不删除当前未再引用的旧内容寻址资产。

因此复用并最小泛化 `AuthorSourcePublisher`，禁止递归覆盖 active root、逐文件覆盖字幕/设置或删除旧资产。`film.html`
内部已建模的 narration/audio/time 字段可以随整份 film 原子恢复，并按实际 diff 触发 narration/duration 锁。

### D-06 唯一状态权威与恢复事实

`project_transaction.state` 仍是唯一状态机，kind=`history`。新增 1:1 不可变 `history_restore_fact`，无 state：

```sql
CREATE TABLE history_restore_fact (
  transaction_id TEXT PRIMARY KEY REFERENCES project_transaction(transaction_id),
  target_snapshot_id TEXT NOT NULL,
  source_before_snapshot_id TEXT NOT NULL,
  source_before_sha256 TEXT NOT NULL,
  source_after_sha256 TEXT NOT NULL,
  staged_source_digest TEXT NOT NULL,
  result_snapshot_id TEXT NOT NULL,
  restore_plan_sha256 TEXT NOT NULL,
  installed_assets_json TEXT NOT NULL,
  film_temp_token TEXT NOT NULL,
  publish_intent_created_at TEXT NOT NULL,
  CHECK(source_before_sha256 <> source_after_sha256)
);
```

fact 插入与 `validated→prepared` 在同一 `BEGIN IMMEDIATE` 完成。表须有禁止 UPDATE/DELETE trigger。绝对路径、
request body、状态枚举不得进入 fact。

### D-07 唯一数据库提交

`RevisionStore.commitHistoryRestore()` 的一个 `BEGIN IMMEDIATE` 必须完成：

- CAS 当前 revision/source/control/attention；revision 恰好 `previous+1`；
- CAS impact `active→consumed`；
- 校验 history fact、target snapshot 与 result snapshot 一致；
- 对 `openfilm_projection_fact` 执行“已存在则逐字段一致，不存在则插入”的不可变 upsert；
- 更新唯一 `active_commit`，不删除旧 snapshot/transaction；
- 插入真实 `project.committed` outbox 并把 `lastInsertRowid` 写入 response；
- 写唯一 `operation_idempotency`，kind=`controlled_write.restore_snapshot`；
- `project_transaction prepared→committed`。

任一步失败整体回滚。禁止调用 legacy `commitWithPointer()`，禁止建立第二 active pointer/revision/history 数据库。

### D-08 native history 入口

`history.restore`、`history.undo`、`history.redo` 可变为 `translated_host_service`，但只能进入 HistoryService：

- restore：显式 target snapshot；
- undo：解析当前 commit 的前一个 committed snapshot，随后仍需新 impact 与确认；
- redo：仅当当前 commit 是 restore 时，从 immutable restore fact 解析其 source-before snapshot；随后仍需新 impact 与确认；
- checkout/merge/discard/commit 继续 blocked。

Translator 只产生 typed intent，不直接写 source，不自动确认 impact。无法唯一解析 target 时 422 fail closed。

### D-09 取消、客户端断开与晚到结果

stage/validate 未完成且尚未 prepared 时收到 abort signal：删除 isolated root、transaction aborted、revision +0，后到的
adapter result 丢弃。`prepared` 之后进入原子发布恢复域：客户端断开不允许留下半发布 source，也不视为撤销授权；
系统必须收敛为 committed/aborted/attention，同 key 可重放结果。M4C 无 provider/异步生成结果，任何无 transaction
所有权的晚到 callback 都不得发布或 commit。

### D-10 TX-12 的阶段口径

M4C 不开放 M6 render route。TX-12 在 M4C 关闭 `SNAPSHOT_IMMUTABILITY_SUBSET`：测试 harness 先绑定并开始读取旧
committed snapshot，随后执行 restore，旧 snapshot bytes/digest 与 harness 输入保持不变。生产 render Job、正式 MP4
和取消策略仍由 M6 关闭，M4C 不冒充完整 TX-12。

## 3. 被否决路线

- 直接把 `active_commit.snapshot_id` 改回旧值而不加 revision：破坏单调历史与审计。
- 给相同内容生成随机 snapshot id：破坏 content-addressed identity，制造重复 bytes。
- 用当前 active projection 代表目标 snapshot：无法证明历史内容，可能错误授权。
- 递归覆盖 active root：存在混合时间线、崩溃不可判定和数据丢失风险。
- history coordinator 复制一套 revision/lock/impact 数据库：形成第二权威。
- 为未知 diff 一律加所有锁：隐藏 classifier 缺口，违背“不少算也不过度阻塞”。
- 在 M4C 顺带开放 render/Studio UI：扩大 Gate，混淆 Headless 技术验收与人工体验。

## 4. 演进与回退

新增表、schema arm、route 和 capability 均为 additive。部署回退关闭 restore impact、restore route 与三个 history
translator 条目；保留 snapshot、fact、transaction、outbox 与历史 commit。内容回退只能再执行一次 HistoryService
restore，禁止 git reset、数据库 pointer 手改或删除历史行。
