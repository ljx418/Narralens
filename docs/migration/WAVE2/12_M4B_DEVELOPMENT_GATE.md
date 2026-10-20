# M4B AdoptionCoordinator 开发与验收门

状态：`FROZEN_FOR_IMPLEMENTATION`，但只有 M4A 独立外审为 `M4A_EXTERNAL_REVIEW_PASS` 后才允许开工。

范围：只完成 `adopt_materialization`。禁止实现 `restore_snapshot`、M5 Studio UX、M6 正式 render、插件市场、
provider 调用或任何付费/外传。本门不重写 legacy `ProjectWriteActor`，不改变 Hypit 已验行为。

配套时序图：`11_M4B_CONTROLLED_ADOPTION.html`；可编辑源：
`11_M4B_CONTROLLED_ADOPTION.sequence.json`。

## 1. 出门声明

本门最高允许声明 `M4B_INTERNAL_EVIDENCED`。只有以下条件同时满足才可停止并交 Codex 独立复核：

1. M4A 外审已通过，且修复后的新证据绑定当前祖先提交；
2. 第 9 节全表（TX-01..08B、TX-11B、TX-13/14、M4B-NW、REG）逐项有直接证据；
3. 成功采用恰好 `revision + 1`，所有失败路径 `revision + 0`；
4. 三镜采用后仍是三个 OpenFilm 原生可编辑 clip，不得用 proxy/flattened MP4 替代；
5. source、snapshot、revision、active pointer、asset ledger、impact、idempotency、outbox 的发布顺序和恢复结论可证明；
6. 全量门、生产构建、真实上游探针、真实媒体链、凭据扫描与 M4B 当前门全绿；仅 §10 明列的
   `wave1:integrity`、`wave2:m4a:integrity` 两个 superseded current-tip 历史门允许预期非零，必须把命令、exit、
   原始输出与相应 historical PASS 一并作为出门产物，禁止调绿；
7. 内部四视角审查 `BLOCKER=0 / MAJOR=0`，实现会话不得自签外审。

禁止声明：M4C、Wave 2 完成、Gate D4.2、Gate V1-P0、V1-Full、headed/human 已验。

## 2. 0 层架构

```text
Studio/Headless client
  → POST /api/migration/v1/projects/:id/edits
  → auth/origin + AdoptRequestV1 validator
  → AdoptionCoordinator（唯一 adopt 编排入口）
  → ProjectCoordinator.controlledWrite（唯一 commit 权威，持有 ProjectOperationQueue）
      → ImpactService.requireCurrent
      → ProjectResolver + MigratedAssetLedger + MaterializeService.read + LockService
      → NativeWriteGateway + pinned OpenFilm capability
      → EnginePort.plan → stage → validate（只写 Host isolated root）
      → SnapshotStore.publish（immutable staged snapshot）
      → AuthorSourcePublisher.publish（内容寻址资产先行，film.html 单文件原子切换）
      → RevisionStore.commitAdoption（一个 SQLite 事务）
  → ControlledWriteResponseV1
```

权威只有三处：Host 持有事务/锁/revision；EnginePort 只规划、隔离写与验证；OpenFilm active source 是唯一原生
可编辑时间线。Materialization、Impact、proxy、ConsumerGraph 都不是第二时间线。

## 3. 1 层模块与代码实体

| 实体 | 目标路径 | 责任 | 明确禁止 |
|---|---|---|---|
| `AdoptionCoordinator` | `src/host/adoption/adoption-coordinator.ts` | 校验 adopt 引用关系，构造受控写输入；不持有第二套 commit | 直接写 DB/source；调用 legacy actor |
| `ProjectCoordinator.controlledWrite` | `src/host/projects/project-coordinator.ts` | 项目队列、事务状态机、最终复核、stage/publish/commit/recovery | 将 M4B 塞进 `executeEdit()` 分支；复制第二 actor |
| `AdoptionJournal` | `project_transaction` + 1:1 additive fact row | `project_transaction.state` 是唯一状态权威；fact row 只记录 before/after film SHA、staged digest、snapshot、installed assets 与 publish receipt | 在 fact row 再建 state；新建平行事务权威；覆盖旧行 |
| `AuthorSourcePublisher` | `src/host/projects/author-source-publisher.ts` | 验证允许 diff；安装内容寻址资产；原子切换 `film.html`；fsync；恢复判定 | 递归覆盖 active root；删除旧资产；接收客户端路径 |
| `RevisionStore.commitAdoption` | `src/host/projects/revision-store.ts` | 单事务 revision、pointer、ledger、impact consumed、idempotency、outbox、transaction committed | 多次事务拼接；失败后补写“成功” |
| `OpenFilmEngineAdapter` | `src/adapters/openfilm/openfilm-engine-adapter.ts` | 将 `adopt_materialization` 转成固定 upstream ops；stage 仅隔离 root；validate 完整投影 | rebased 当成功；未知 op；commit/rename active source |
| `NativeWriteGateway` / registry | 既有文件 | 只开放明确 adopt entry；未知/restore/native history 继续 fail closed | 全局开放 OpenFilm 写；裸转发 payload |
| HTTP route | `src/host/server.ts` | 原样验证 `AdoptRequestV1`，auth/origin 在资源查找前，调用 coordinator | 复用 legacy `/edits` 请求结构；回显绝对路径 |

`EnginePort` 仍恰好七个方法，不新增 commit/publish/rollback。`AbsoluteServerPath` 只在 Host composition 构造；
请求、响应、Materialization、Impact、EngineEditPlan ops 与 StagedSource 都不得携带绝对路径。
Coordinator 以 `mkdtemp` 在 Host 专属 staging parent 分配并拥有每事务 isolated root，通过 `absoluteServerPath()`
brand 后同时写入 `CommandContext.isolatedRoot` 与 `stage()` 参数；adapter 只能在其下创建相对子目录。成功后所有权
回到 Coordinator；失败、取消、恢复和 Host close 都必须有界清理，不由 adapter 选择任意目录。

### 3.1 wire request 与 engine plan input 不得混同

现有 `AdoptRequestV1`/`ControlledEditOperation` 只含客户端可回传的 id/hash/approval；仅凭这些字段，adapter 无法
生成三镜 native ops。禁止让 adapter 注入 MaterializationStore，也禁止把 `NativePlanV1` 加入 HTTP 请求。

M4B 在 Host engine 层新增 server-only `AdoptEnginePlanIntent`，最小结构为：

```ts
type AdoptEnginePlanIntent = {
  edit: AdoptMaterializationEditOperation;
  native_plan: NativePlanV1;
  materialization_id: string;
  rights_digest: Sha256;
  impact_hash: Sha256;
};
```

该类型放在 `src/host/engine/engine-plan-intent.ts`，不得进入 `contracts/*.schema.json`。目标形状冻结为
`EnginePlanIntent = TypedEdit | AdoptEnginePlanIntent`；`EnginePort.plan` 第二参数与 `EngineEditPlan.edit` 均使用
`EnginePlanIntent = TypedEdit | AdoptEnginePlanIntent`，方法总数不变。`EngineEditPlan.ops` 保持 engine-private，但
OpenFilm adapter 必须先构造并在 stage 前按 M4B Host-specific closed op schema 复验；固定上游的宽
`OpenFilmOp` 类型不是安全边界，不能把 `unknown[]` 当裸转发逃生口。Hypit adapter 收到非 `TypedEdit` intent 必须
422 fail closed。HTTP validator
永远不能接受 `native_plan/rights_digest`；Coordinator 在 public read/impact 重验后组装 intent。Gateway 只批准
`adopt_materialization` 入口并输出最小 typed edit，Coordinator 再注入受信事实；adapter 必须拒绝缺 plan、plan
hash 不符或 edit/materialization/impact 不一致。这样既不隐藏读取 Host store，也不允许客户端自报 ops。

gateway 新条目固定为 `timeline.adopt_materialization`，capability key 同名、policy=`translated`、typed intent=
`adopt_materialization`。`NativeWriteRequest` 只为该条目新增 `materialization_id/impact_id/impact_hash/approval_confirmed`
字段，translator 生成现有 `AdoptMaterializationEditOperation`；不得携带 NativePlan/rights/路径。HTTP route 仍以
`AdoptRequestV1` 为 wire authority，并把已验证字段送入 gateway；未知/缺字段 fail closed。

恢复事实表冻结为：

```sql
CREATE TABLE adoption_transaction_fact (
  transaction_id TEXT PRIMARY KEY REFERENCES project_transaction(transaction_id),
  source_before_sha256 TEXT NOT NULL,
  source_after_sha256 TEXT NOT NULL,
  staged_source_digest TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  installed_assets_json TEXT NOT NULL,
  film_temp_token TEXT NOT NULL,
  publish_intent_created_at TEXT NOT NULL,
  CHECK (source_before_sha256 <> source_after_sha256)
);
```

该行在已得到 staged film 的 after SHA 与 immutable snapshot 后，与 `validated→prepared` transition 在同一
`BEGIN IMMEDIATE` 一次插入，此后不可 UPDATE；不得出现“fact 已落行但 transaction 仍 validated”的半状态。它没有
`state` 或“已发布”字段，不能独立决定流程。真正恢复判据联合使用：同一 `project_transaction` 在 `prepared` 时
持久写入的闭包 `source_digest_before/source_digest_after/snapshot_id`；fact row 的 film before/after bytes SHA；以及
active root 当前重算的 film SHA + SourceDigestV1。是否已 rename 由这些 bytes/闭包事实推断，不使用时间戳猜测。
`installed_assets_json` 为 canonical、closed-shape 的相对 token+SHA 数组，读取时重验；
绝对路径不得入库。除上述 fact+prepared 原子组合外，每个 journal transition 各自提交，最终业务事实才由
`commitAdoption` 一笔事务提交。

## 4. active source 原子发布契约

M4B v1 的 native plan 只能产生两类 active-root 变化：

- 新增 `assets/<sha256>/source.<approved-ext>` 内容寻址文件；
- 替换 `film.html`。

不得修改/删除既有内容寻址资产、字幕、设置、旁白或其他 root；若 staged diff 超出白名单，422
`UNSUPPORTED_EDIT`。发布顺序固定：

1. stage 内验证每个新增资产 bytes 等于 plan/ledger SHA；
2. 以独立 temp + fsync + no-clobber link/rename 安装新资产；已存在则重新验 hash；旧 film 尚未引用它们；
3. 将 staged `film.html` 复制到 active root 同目录的 transaction temp，验 hash、fsync；
4. commit-boundary 逐项再跑：`ImpactService.requireCurrent()`；`MaterializeService.read()`；从
   `AssetInventoryPort` 现场 inventory，并复用 `rightsDigest(bindings, inventorySha256)` 重算包含 license
   status/commercial_use 的 rights 摘要，与 materialization/impact
   比对；复用 M4A impact 的 `affected_consumers/affected_ranges` 和 ConsumerGraph 重新推导三类锁集合后调用
   `LockService.assertUnlocked()`（不得只信 stored locks_checked）；`EngineBindingStore` 的 engine/upstream SHA；
   以及 base/source/control。
   `rights_digest` 字符串相等本身不算现场 rights 重验；
5. 以同目录 rename 原子替换 `film.html`，随后 fsync parent；该 rename 是 source publish point；
6. 重新由 pinned adapter inspect active root，必须与 staged projection/source digest 一致；OpenFilm snapshot/digest 的
   roots = `openFilmRoots` 得到的迁移基线 roots ∪ 本次 NativePlan 新引用的 target asset token，排序去重后覆盖
   film、字幕/设置与全部引用资产；不得只复用旧 migration plan 漏掉 adopted assets；
7. 一个 SQLite `BEGIN IMMEDIATE` 完成第 7 节列出的全部事实。

新增内容寻址资产在 film publish 前崩溃只会成为未引用、安全可回收文件，不构成 adopted source。禁止以递归目录
覆盖或逐文件覆盖制造可观察的混合时间线。

## 5. 请求、身份与错误优先级

路由只接受 `AdoptRequestV1`，`additionalProperties=false`，body 上限沿当前 Host 64 KiB 实际限制，不为对齐旧
1 MiB 文案而放宽。顺序固定：

1. auth/origin；
2. schema 与 operation capability；
3. 同 project + `operation_kind=controlled_write.adopt_materialization` + idempotency key/digest 重放或冲突；该 kind
   必须与 M4A 的 `impact.adopt_materialization` 分离，同一客户端 key 在两个 kind 下互不冲突；
4. project/materialization/impact 归属，跨项目与不存在返回相同 404；
5. base/source/control 与 attention；
6. materialization public read、rights/bytes、impact id/hash/TTL/approval；
7. active lock；
8. stage/validate/publish/commit。

`approval.confirmed=true` 只表示本地当前会话确认匹配的 impact，不授权网络、provider、费用或外传。缺 impact 为
428 `IMPACT_REQUIRED`；id/hash/TTL/currentness 不成立为 428 `IMPACT_STALE`；锁为 423；base/source/control 为
409；未知 native op/rebased 为 422/409，按既有 alias 表输出，不新增同义错误码。

## 6. 受控写算法

同一 project 的整个流程必须在现有 `ProjectOperationQueue.run()` 内；不能在进入队列前做可过期授权判断。

```text
replay-or-conflict
→ resolve active project/binding and verify upstream pin
→ require ready materialization through MaterializeService.read
→ require matching active impact and approval
→ recompute affected locks and assert unlocked
→ begin project_transaction(received)
→ preconditions_checked
→ EnginePort.plan(adopt_materialization)
→ EnginePort.stage(isolated root)
→ staged
→ EnginePort.validate + native inspect invariants
→ validated
→ SnapshotStore.publish(staged source)
→ prepared（各 journal transition 独立持久提交；写 transaction before/after/snapshot + immutable fact row）
→ final requireCurrent + base/source/control/rights/locks/binding recheck
→ AuthorSourcePublisher.publish
→ inspect active source equals staged proof
→ RevisionStore.commitAdoption
→ committed response
```

`commitAdoption` 自行开启唯一一个 `BEGIN IMMEDIATE`；不得调用自带事务且写 legacy `edit_idempotency` 的
`commitWithPointer()`，不得嵌套 `atomic()`。它在同一事务内必须：

- CAS project current revision/control/source 与请求基线；
- revision 恰好 `previous + 1`；
- 写 snapshot 与 active_commit pointer；
- 只加入本次 native plan 真正引用的新 target asset ledger 行/引用事实，且许可仍 cleared/commercial；
- impact `active→consumed` CAS，任何其他前态使整个事务回滚；
- 写唯一 `operation_idempotency` 完整 response；
- 直接插入一条 `project.committed` outbox，以该 INSERT 的 `lastInsertRowid` 作为真实 event id；
- project_transaction `prepared→committed`。

不得继续使用 legacy `edit_idempotency` 作为 M4B 第二权威。`ControlledWriteResponseV1.outbox_event_id` 必须是同一
事务真正插入的行号，不能事后查询猜测。

## 7. 恢复与故障矩阵

M4B 专用恢复器必须在 Host 启动的 legacy `ProjectCoordinator.recoverOnStart()` 通用 journal 恢复之前运行，并在同一
`ProjectOperationQueue.run(projectId)` 内完成。M4B 行在可证明路径上不得先被通用恢复标为 `recovering` 或
`attention`；因此无需给冻结的 terminal `attention` 新增出边，也不得自动清除既有 `project_state.attention`。
进程重启后队列为空，由专用恢复器取得该项目的首个队列槽后再开放写路由。M4B 行以 canonical
`request_json.format="narralens.adopt-request@1.0"` + intent op 识别；`request_json.idempotency_key` 定位重试键，
transaction_id 是恢复主键。所有 versioned edit HTTP 在处理重放前必须先完成该 project 的未终结 M4B 恢复。

边界至少包括：received、preconditions_checked、plan 后、stage 后、validate 后、snapshot rename 前/后、asset
install 前/后、film temp fsync 后、film rename 前/后、active inspect 后、DB commit 前/后、outbox insert 前/后、
response 前。每点独立故障注入，结论只能是：

| 观察事实 | 恢复结论 |
|---|---|
| prepared 前，DB 未 commit | 结构上尚未调用 publisher；从当前合法前态 CAS 到 aborted，清理 stage/temp，revision +0；同一 abort 事务写唯一 operation idempotency 失败 response |
| prepared 后 active film 为 before，DB 未 commit | 从 prepared CAS 到 aborted，清理 stage/temp，revision +0；同 key/digest 永久重放已记录失败且不得再次 stage/publish，新 key 才允许新尝试 |
| active film 为 after，DB 未 commit，transaction before/after/snapshot、immutable fact、impact/current facts 全可证明 | 本次请求若可立即完成则完成同一 `commitAdoption` 后返回 200；否则返回 423 `PROJECT_ATTENTION_REQUIRED`（不是 500），保留 after source，重启/同 key 重试先恢复且不得再次 stage/publish；只有满足下述 recovery-current 规则才最终 revision +1 |
| active film 不是 before/after，或 snapshot/rights/impact 无法证明 | project attention；禁止猜成功、禁止自动重试写源 |
| DB committed | 从唯一 operation idempotency 行重放同一完整 response；不得再次 stage/publish/加 revision |

Impact TTL 只限制新写开始，不撤销已经在到期前进入 `prepared` 且发布了 after source 的授权。M4B 新增 Host-only
`ImpactService.requirePreparedRecoveryCurrent(transactionId, impactId, hash)`：仅当 immutable fact 的
`publish_intent_created_at`
早于 `expires_at`、source 已为 after、impact 仍 active，且 revision/source/control/materialization/rights/native-plan
全部现场重验不变时，恢复可忽略墙钟 TTL 并在最终事务 CAS active→consumed。任何事实变化、impact 已
expired/stale/consumed 或未在到期前 prepared 都进入 attention，不承诺 +1。写路由在 recovery 完成前不得调用
普通 `requireCurrent()` 提前把该 impact 标 expired。

若 active 为 after 但证据不可证明，保持 source=after，不做未经证明的自动回滚；CAS 进入 terminal attention 并返回
423。此状态允许差异明确为：source=after、revision/pointer/ledger/impact/outbox/idempotency 均未提交；M4B-NW 必须
逐字段记录。`TRANSACTION_FAILED` 500 仅用于已证明 source 仍 before 或已完成 byte-exact 补偿的情况。

恢复时先 M4B 专用 journal，再通用 journal/outbox/lease，再开放路由。stage/temp 可清理；允许残留未被 pointer
引用的 immutable snapshot、不可变 fact row 与未引用 content-addressed asset，并在差异清单标注；旧 source bytes、
旧 ledger/history 不删除。取消或失去执行权后的晚到结果只能 quarantine，不能进入 source publish/commit。

## 8. OpenFilm plan / validate 冻结

`TypedEdit` 已有 `adopt_materialization` 类型，但 registry、capability、gateway translator 与 adapter plan 需一起开放，
不得留下“类型存在、生产不可达”或“capability 全开、translator 未限定”的半状态。

隔离探针 `15_M4B_OPENFILM_OP_SPIKE.md` 已否决 insert 配方。生成机制冻结为：adapter `plan()` 对三个既有视觉
clip（ID 必须与 active projection 和 NativePlan 一致）按 plan 顺序各生成三条 Host-closed `set` op：`src` = Host
生成的 content-addressed asset token（不带 fragment）、`time` = NativePlan source 半开帧换算的秒区间、
`overrides` = null；timeline `at`、track、stable id、stage 与 narration clip 不写，从 active source 原样保留。
总计恰好九条 op，不 remove/insert、不新增 clip。随后 `stage()` 复制 active source 到 Host isolated root，并调用
固定签名 `editProjectFilm(stagedRoot, before.rev, ops)` 生成 staged `film.html`。禁止直接拼写 active film.html。
Host-specific validator 只接受上述 9 条 `set` op 及字段/值形状；固定上游宽 `OpenFilmOp` 不是安全边界。

M4B-1 必读 `15_M4B_OPENFILM_OP_SPIKE.md`、`openfilm-migrator.ts`、`openfilm-upstream.ts`、
`tests/m2.3/openfilm-migrator.test.ts` 与 `migration-real-export.test.ts`，并冻结正式 op golden vector。

plan 不得接收客户端 ops。adapter 必须拒绝非 OpenFilm、project mismatch、base/source/control mismatch、未知
字段、未知 clip/track、重复 ID、重叠/缺口、总帧变化、narration policy 非 preserve、duration policy 非 preserve。

validate 必须由 pinned upstream 重新读取 staged `film.html`，并使用与 stage 相同的 `openFilmRoots` 自行重算
`SourceDigestV1`；禁止回显 `StagedSource.source_digest` 冒充重算结果。digest 计算由 Host 提供的纯函数/roots input
完成，adapter 不得反向读取 Host store。再证明：

- 恰好三个原生可编辑视觉 clip，稳定 ID 与 plan 一致；独立 narration clip 不计入“三个视觉 clip”且必须保持；
- 每个 clip 的 timeline/source 半开帧区间、asset SHA、track、总帧一致；
- narration/subtitle/audio 与未受影响相邻 identity 保持；
- projection `problems=[]`；
- source digest 闭包包含 film、scene/字幕/设置和全部引用资产；
- staged 输出可真实渲染/完整 decode，不以 JSON shape 代替。

## 9. 逐 case 验收

| Case | 必须直接证明 | 失败门限 |
|---|---|---|
| TX-01 | 缺 impact、缺 approval 在 stage 前 428，stage 调用计数 0 | 有源写/临时发布 |
| TX-02 | 篡改/过期/消费/事实漂移 impact 在入口和 commit 前均拒绝 | 只看 stored active flag |
| TX-03 | visual 锁必触发；preserve narration 不过度阻塞 | 漏锁或无差别三锁 |
| TX-04 | M4A graph 与 staged diff 一致；未知 consumer fail closed | staged 实际变化超出 impact |
| TX-05 | stale/rebased/source/control/rights 变化 revision +0 | rebased 当成功 |
| TX-06 | 双采用只有一个 commit；另一方完整 replay 或确定 409 | 双 revision、混合 source |
| TX-07 | committed 与 aborted 两类同 kind/key/digest response 均逐字重放且不再次 stage/publish；异 digest 409；aborted 后仅新 key 可新尝试 | 第二次 stage/publish |
| TX-08B | 本文第 7 节每个 M4B 边界重启后收敛为 committed 或 aborted 且项目可继续写；不可证明者 terminal attention 且具有明确人工修复事实；不得留下无合法出边的 running/recovering | 孤儿 running、猜成功、成功后 attention latch 仍阻断 |
| TX-11B | 真实采用后由测试 harness 调固定上游 renderer，产物可完整 decode；不开放 M6 生产 render route | 只测 fixture JSON/proxy，或偷开生产 render |
| TX-13 | stage 期间 lock/source/rights/active commit 变化，final check 拒绝 | TOCTOU 成功 |
| TX-14 | adopt 后 inspect 仍三 clip；改中镜再验证两侧 ID 不变 | flattened MP4 |
| M4B-NW | 每个失败路径 source/revision/pointer/ledger/impact/idempotency/outbox 的允许差异明确；特别记录 film=after/DB 未 commit 的受控 423 过渡态 | 不实 NOWRITE |
| REG | M4A、M3、Wave1、legacy routes/contracts 均保持 | 删除/弱化旧门 |

真实媒体使用仓库固定、无隐私 fixture；不得读取 `J:\`。真实 upstream 使用固定
`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` 隔离副本，预期本机路径为
`/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm`（大小写 realpath 后核对）；开工先验证 HEAD、
tracked clean、package/lock hashes。缺失则 `PINNED_OPENFILM_ABSENT` 停止真实上游门，不用 mock 或 latest 替代，
不得联网拉取或调用 provider。

## 10. 测试与证据命令

实现者新增 `test:wave2:m4b`、`evidence:wave2:m4b`、`evidence:wave2:m4b:integrity`。冻结前至少执行：

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm test:contracts
corepack pnpm test:m2.1
corepack pnpm test:wave2:w2.0
corepack pnpm test:wave2:m3
corepack pnpm test:wave2:m4a
corepack pnpm test:wave2:m4b
corepack pnpm test:wave2:fitness
corepack pnpm check
corepack pnpm build
corepack pnpm evidence:wave1:historical
corepack pnpm evidence:wave1:integrity # 期望历史 current-tip 非零，逐字保留
corepack pnpm evidence:wave2:m4a:historical
corepack pnpm evidence:wave2:m4a:integrity # M4B 开路由后期望非零，逐字保留
corepack pnpm evidence:wave2:m4b:integrity
```

所有命令 headless、静音、无窗口、无焦点抢占；失败捕获只追加不覆盖。证据必须绑定 clean capture commit，保存
`.cmd/.txt/.exit`、环境、完整 repo/upstream SHA、fixture/媒体/snapshot SHA256、逐 case、凭据扫描、claim limits。
历史 `wave1:integrity` 仍按 superseded historical gate 原样记录，不调绿。

M4B 会合法开放 versioned edits 并改变生产代码，因此当前 `evidence:wave2:m4a:integrity` 在 M4B tip 上不得被强行
调绿。M4B-0 先新增只从 M4A 捕获提交 tree 读取代码/证据的 `evidence:wave2:m4a:historical`；它必须验证 M4A
manifest/log/case/hash及当时 route 状态。原 current-tip integrity 的非零结果仍逐字保存并解释，不能覆盖或删掉。

## 11. 编程与审查规范

- TypeScript strict；公共合同无 `any`，跨边界输入一律 validator 后使用；错误必须为既有 `HttpError` 语义；
- 数据库 transition 一律 SQL 前态谓词/CAS；不得读后无条件 UPDATE；事务方法返回实际 outbox id/response；
- 文件发布只接受 Host 生成 token/相对路径；realpath containment、no-clobber、hash、fsync、rename 均需负向测试；
- 测试不能通过自建错误 fixture 绕开生产 migration/route；生产 seam 与组件 seam 在 case 文件逐项标注；
- 不放宽 timeout/assertion、不删旧测试、不用总数替代逐 case；变异必须先证明旧实现会失败；
- 每个模块完成即跑局部门与受影响回归，全部模块完成后一次四视角审查；同阶段返工超过两次由 Codex 接管；
- 只有需要人工高风险决策、人工体验或移交 Claude Code 时停止。

## 12. 开发顺序

1. `M4B-0`：状态同步、合同/route/fitness 红灯、journal 字段与原子 commit API 测试；route inventory 精确加入唯一
   新路由 `projects/([A-Za-z0-9_-]+)/edits`，history restore 仍须关闭，不得把精确相等放宽为 contains；
2. `M4B-1`：registry/capability/gateway/adapter plan-stage-validate，冻结 op golden vector 并跑真实 pinned upstream；
   同时把 registry 中 history restore/undo/redo 的旧 “M4B” reason 改为 M4C，但保持其 capability blocked；
3. `M4B-2`：`AuthorSourcePublisher` 与崩溃矩阵；
4. `M4B-3`：`AdoptionCoordinator` + ProjectCoordinator controlled-write + HTTP route；
5. `M4B-4`：并发、幂等、commit-time drift、真实三镜采用/重开/改单镜验证；
6. `M4B-5`：全量证据、四视角内审、冻结提交，停止到 Codex 外审点。

模块间自动连续推进，不做模块级外审；任何红灯先修本门，不得顺跳 M4C。
