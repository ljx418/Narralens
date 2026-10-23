# M4C HistoryService 开发与验收门

状态：`FROZEN_FOR_IMPLEMENTATION`

代码前置：M4B 内部冻结候选 `b2a4efb8be7f4b1c02f973ff32ea04b097196649`，独立外审必须先得到
`M4B_EXTERNAL_REVIEW_PASS`。若外审发现 BLOCKER/MAJOR，先修复、重捕获并由新的干净上下文复审，再进入 M4C。

范围：只完成历史 snapshot 的受控 restore，以及 native history restore/undo/redo 到 Host 的翻译。禁止 M5 UI、M6
生产 render、provider/联网/付费/外传、插件市场、读取 `J:\`、重写 legacy Hypit actor 或删除旧工程/历史。

配套：`ADR-W2.0-006-m4c-history-restore.md`、`16_M4C_HISTORY_RESTORE.html` 与 `.sequence.json`。

## 1. 目标体验与出门声明

用户选择当前项目的一份旧 committed snapshot，系统展示按当前 source/rights/locks 算出的 impact；用户确认后，旧内容
恢复为新的 revision。关闭重开后仍可在原生 OpenFilm 三镜中编辑；旧 revision、当前恢复前内容、费用与证据仍可追溯。

本门最高允许声明 `M4C_INTERNAL_EVIDENCED`。以下全部满足后才能停在 Codex 独立复核点：

1. M4B 外审 PASS；
2. 第 8 节 20 个 case 逐项有直接证据，不能以总测试数替代；
3. 成功 restore 恰好 revision +1；所有发布前失败 revision +0；
4. 恢复后的三个 clip 仍为三个原生可编辑 clip；
5. impact/locks/rights/source/base/control 在计算与 commit boundary 都重验；
6. received 至 response 的故障矩阵收敛，重启不重复 stage/publish/commit；
7. 全量门、生产构建、固定上游、真实媒体、凭据扫描、M4C evidence integrity 全绿；
8. 内部四视角审查 BLOCKER=0 / MAJOR=0；实现会话不得自签 M4C 外审。

禁止声明：`WAVE2_EDITABLE_ADOPTION_READY`、Wave 2 组合外审 PASS、Gate D4.2、V1-P0、V1-Full、M5/M6、
headed/human 已验。

## 2. 0 层与 1 层架构

```text
POST impact(restore intent)
  → HistoricalSnapshotResolver（同项目、committed、不可变 bytes/layout）
  → HistoryRestorePlanBuilder（当前 vs 目标 canonical diff）
  → ConsumerGraph + current rights + three lock classes
  → ImpactStore（15 分钟、canonical hash）

POST history/restore
  → auth/origin/schema/idempotency
  → HistoryService（ProjectOperationQueue 唯一编排）
  → current view + target snapshot + impact + NativeWriteGateway
  → EnginePort plan/stage/validate（isolated root only）
  → SnapshotStore publish/verify（content addressed）
  → prepared + immutable history_restore_fact
  → final base/source/control/rights/locks/impact/binding recheck
  → AuthorSourcePublisher（assets no-clobber + film atomic rename）
  → RevisionStore.commitHistoryRestore（一个 SQLite transaction）
  → response / startup recovery
```

| 代码实体 | 目标路径 | 单一责任 | 禁止 |
|---|---|---|---|
| `HistoricalSnapshotResolver` | `src/host/history/historical-snapshot-resolver.ts` | 验 snapshot 归属、committed、磁盘 closure、projection facts | 从 active source 猜旧内容；返回客户端路径 |
| `HistoryRestorePlanBuilder` | `src/host/history/history-restore-plan.ts` | canonical current/target diff、consumer、锁、rights、plan hash | 全锁兜底；未知字段忽略 |
| `HistoryStore` | `src/host/history/history-store.ts` | 不可变 restore fact 与 history read model | 自建 state/pointer/revision |
| `HistoryCommandTranslator` | `src/host/history/history-command-translator.ts` | restore/undo/redo 解析成 typed target | 自动批准/提交；裸 upstream history |
| `HistoryService` | `src/host/history/history-service.ts` | 队列内验证、stage、publish、commit、recovery | 复制第二 Coordinator；直接 DB/source 写 |
| `AuthorSourcePublisher` | 既有 `src/host/adoption/author-source-publisher.ts` | 最小泛化 operation-neutral 文案；保持相同原子算法 | 递归覆盖、多文件非原子 restore |
| `ImpactService` | 既有文件 | restore arm 使用真实 HistoricalSnapshotResolver/restore plan | capability placeholder；复用 current projection 冒充 target |
| `RevisionStore.commitHistoryRestore` | 既有文件 | 唯一 DB commit，revision/pointer/impact/idempotency/outbox/transaction 同成败 | legacy commitWithPointer；多事务补写 |
| `NativeWriteGateway/registry` | 既有文件 | 只翻译明确 history entry；其余 default deny | checkout/merge/discard/commit 开放 |
| HTTP route | `src/host/server.ts` | 原样 schema、auth/origin 优先、调用 HistoryService | 接收路径/ops/plan；跨项目泄露 |

`EnginePort` 仍恰好 7 方法。OpenFilm adapter 无 commit/publish/rollback 权。active OpenFilm source 仍是唯一可编辑
timeline；snapshot/history/impact 都不是第二 timeline。

## 3. 合同锁定

### 3.1 Wire

- `ImpactRequestV1.intent={op:"restore_snapshot",target_snapshot_id}`；客户端不能提交 range/locks/rights/plan/hash；
- `RestoreRequestV1` 现有 shape 不变，`additionalProperties=false`；
- `ControlledWriteFailureResponseV1.operation` 扩为 closed enum
  `adopt_materialization|restore_snapshot`，其余字段不变；
- `ImpactSpecV1.affected_ranges` 改为 conditional：adopt 至少 1；restore 的 narration/audio-only diff 可为 0，但
  `affected_consumers` 与 restore plan 的 `required_locks` 不得为空；
- restore 的 `ImpactSpecV1.native_plan_sha256` 是 server-only `HistoryRestorePlanV1.plan_sha256`；
- `ControlledWriteResponseV1.operation=restore_snapshot`；body 不含路径、adapter 类名、SQLite 文案或内部 token；
- body 上限保持 Host 64 KiB，不放宽。

Schema、TypeScript type、validator、registry 与 contract tests 必须同一提交移动。未知属性 400；缺 impact 428
`IMPACT_REQUIRED`；过期/篡改/currentness 变化 428 `IMPACT_STALE`；base/source/control 409；锁 423；不可恢复
snapshot/diff 422；跨项目/不存在 snapshot 同 404。

### 3.2 Snapshot 恢复资格

目标 snapshot 必须同时满足：同 project；OpenFilm；真实目录；数据库已 committed 引用；SourceDigestV1 与 row 一致；
可从 immutable fact 重建 layout；固定 upstream inspect 无 problems；非 film 可变 roots 与 current 对应 bytes 相同；所引用
资产在当前策略下 rights cleared/commercial。当前 digest 与目标相同直接 422 no-op。

不得恢复 orphan snapshot、M3 proxy、Hypit snapshot、外部目录、任意用户路径或未通过固定 upstream 的 source。
M4C 只支持 current/target 具有相同 clip identity/track topology，且差异均落在已建模 `src/time/overrides` 与
`film.html` 内部 narration/audio 字段的 snapshot；clip 增删、未知字段、外置可变 root 改动 422 fail closed。

### 3.3 Restore plan canonical 规则

canonical JSON 使用既有 `canonicalJson`；数组排序规则：clip 按 target timeline start/clip_id，consumers 按 kind/id/action，
locks 按 lock_type/scope/target/range，roots 字典序，subtitles 按 subtitle_id/path。hash domain 固定
`narralens-history-restore-plan-v1\n`。至少 10 个冻结 golden vectors，由 TS 与 Python/独立实现互校；每个字段有单点
变异测试。

### 3.4 History read/undo/redo

HistoryStore 按 revision 返回 committed snapshot references：migration 初始 commit + committed controlled writes。只读模型
不允许改变 active pointer。undo 选择严格小于当前 revision 的最近 snapshot；redo 仅从当前 restore transaction 的
`source_before_snapshot_id` 推导。没有唯一目标返回 422；translator 生成 intent 后仍必须先创建 impact、再提交显式
approval，不允许一个 native 调用绕过两阶段授权。

## 4. 受控恢复算法

所有步骤位于同一 `ProjectOperationQueue.run(projectId)`：

```text
replay/conflict（controlled_write.restore_snapshot）
→ resolve current active project + pinned binding
→ HistoricalSnapshotResolver.resolve(target)
→ requireCurrent(impact) + request/impact/target exact match
→ gateway history.restore translation + approval
→ rebuild HistoryRestorePlanV1; exact hash/rights/locks match impact
→ begin project_transaction(kind=history)
→ preconditions_checked
→ HistoryService 读取并验 target film bytes，注入 server-only RestoreEnginePlanIntent
→ EnginePort plan/stage：复制 active source，在 isolated root 写入 exact target film + missing content-addressed assets
→ EnginePort validate：固定 upstream 重读并重算 target closure
→ staged → validated
→ publish/verify content-addressed snapshot（可 created=false）
→ atomic prepare(history_restore_fact + validated→prepared)
→ final re-resolve current/target + rebuild plan + recheck impact/rights/locks/binding/base/source/control
→ AuthorSourcePublisher.publish
→ pinned inspect active source equals target proof
→ RevisionStore.commitHistoryRestore
→ committed response
```

新增 server-only `RestoreEnginePlanIntent` 与唯一 closed engine op：

```ts
{ op: "restore_film", target_snapshot_id, target_film_sha256, target_film_text }
```

该 op 只存在于 Host→adapter 内存边界，不进入 HTTP/schema/日志；adapter `plan()` 验 target hash 与 restore plan，
`stage()` 复制 current source 后仅在 isolated root 写 exact target film，`validate()` 用固定 upstream 和 target roots 证明
projection/digest。不能增加 EnginePort 方法、不能把路径放入 intent、不能调用 upstream 裸 history checkout，也不允许
HistoryService 手写第二个 OpenFilm parser。`target_film_text` 仅用于 isolated stage，证据/错误不得回显正文。

## 5. 数据库与发布原子性

`history_restore_fact` 完整 DDL、不可变 trigger 与字段语义以 ADR D-06 为准。`prepare()` 必须把 fact insert 与
validated→prepared 放入同一事务。result snapshot id 可以等于 target id，这是内容寻址正确结果。

`commitHistoryRestore` 的单事务顺序：校验 immutable fact → project_state CAS + revision+1 → impact consumed CAS →
snapshot/projection exact insert-or-verify → active_commit → outbox → response → operation_idempotency → transaction committed →
COMMIT。任何 SQL/constraint/CAS 失败整体 rollback；不能捕获后补写成功。

active source 发布只允许 M4B 已验证的两类 diff。staged tree 可包含 current root 的未引用旧资产，但 SnapshotStore roots
只能是 target plan roots，不能把多余文件收入 source digest。旧 active 资产不删除。

## 6. 故障、取消与启动恢复

至少注入：received 后、preconditions 后、target resolve 后、plan 后、stage copy 中/后、validate 后、snapshot publish
前/后、prepared 前/后、asset install 前/后、film temp fsync 后、film rename 前/后、active inspect 后、DB transaction
各语句前/后、response 前。

| 可观察事实 | 唯一允许结论 |
|---|---|
| prepared 前，active film=before | abort + revision 0，stage/temp 清理，终态 failure 幂等记录 |
| prepared，active film=before | abort + revision 0；同 key 重放 failure，不再次 stage |
| prepared，active film=after，fact/snapshot/impact/current facts 全可证明 | 不重复 publish，完成唯一 commit；临时无法完成则 423、重启继续 |
| active film 既非 before 也非 after，或 target/snapshot/rights/plan 无法证明 | terminal attention；不猜成功/失败 |
| DB committed | 从唯一 idempotency row 完整重放；不再次 stage/publish/revision |

`HistoryService.recoverOnStart()` 在 `AdoptionCoordinator.recoverOnStart()` 与通用 recovery 的可预测顺序中运行；两类
专用恢复按 transaction created_at 串行获取同一项目队列。不得先把可证明的 prepared history 行改成 generic
recovering/attention。Host 在专用恢复完成前不得开放 versioned history route。

AbortSignal 在 prepared 前阻止 prepare 并清理隔离结果；prepared 后必须收敛，客户端断开不能撤销已经开始的原子发布。

## 7. 实施批次（每批 30–60 分钟可验）

### M4C-0 M4B 独立外审与红灯基线

复核 M4B frozen SHA、证据完整性、route、source publisher、commit/recovery。PASS 才新增 M4C 失败测试：history route 404、
restore impact capability blocked、native history blocked、failure schema 不接受 restore。

### M4C-1 合同与 HistoricalSnapshotResolver

同提交完成 failure enum、restore validators/registry tests、snapshot ownership read、resolver、initial migration/adoption
projection 两条路径、digest/realpath/committed 负向矩阵。所有写 route 仍 404。

### M4C-2 RestorePlan/Impact/Locks

实现 plan canonical/golden、current-vs-target diff、consumer/三锁分类、current rights 与 restore ImpactService arm。impact 是
NOWRITE；target/current 竞态在 insert 前二次读取，任何漂移不得留下 active impact。

### M4C-3 HistoryStore/Translator/Stage

新增不可变 fact/history read model；restore/undo/redo translator；server-only engine intent；隔离 staging 与 fixed upstream
validate。checkout/merge/discard/commit 保持 blocked。route 仍不 commit。

### M4C-4 Publisher/Commit/Route

泛化 publisher 文案但不放宽算法；实现 `commitHistoryRestore`；装配 HistoryService 与 route；auth/origin 优先、精确合同、
归属隐藏、完整幂等、final rechecks。

### M4C-5 Recovery/Concurrency/真实链

故障矩阵、双 restore、restore 与 adopt 并发、锁/source/rights/control 漂移、取消晚到、Host 重启。真实 migrate→adopt→
restore→重开→改中镜→固定上游渲染/decode；证明三个原生 clip 与旧 snapshot bytes 不变。

### M4C-6 证据与冻结

同步 architecture/traceability/route inventory；追加 evidence，不覆盖旧目录；四视角内审闭环；clean capture commit；完整性
篡改测试；冻结 candidate 后停止给 Codex 外审，不进入 M5。

## 8. 逐 case 验收矩阵

| ID | 层级 | 必须直接证明 | 失败门限 |
|---|---|---|---|
| M4C-01 | contract | Restore request/response/failure schema-type-validator 同步，unknown field 400 | 宽 payload/漂移 |
| M4C-02 | resolver | 同项目 committed migration/adoption snapshot 可解析 | active source 冒充历史 |
| M4C-03 | negative | 跨项目/不存在同 404；orphan/Hypit/逃逸/缺 bytes fail closed | 泄露/越界 |
| M4C-04 | digest/upstream | 历史 roots 重算 digest，fixed upstream inspect 零 problems | 只信 DB/hash 标签 |
| M4C-05 | hash | restore plan 10+ golden vectors 双实现一致，字段变异全咬 | 占位 native hash |
| M4C-06 | impact/NOWRITE | restore impact 201/replay；target/rights/locks/current drift 拒绝且零 active row | stale 授权 |
| TX-03C | locks | 真实 narration/visual/duration 差异分别命中相应锁 | 少锁或全锁兜底 |
| TX-04C | graph | subtitle/audio/transition/shared asset 完整分类；未知字段 422 | consumer 漏算 |
| TX-05C | race | stale base/source/control/target bytes/rebased 均 revision 0 | TOCTOU commit |
| TX-07C | idempotency | 同 kind/key/digest 完整重放；异 digest 409；与 adopt key 空间分离 | 二次 stage/revision |
| TX-08C | crash | 每个边界收敛 committed/aborted/attention，无孤儿进行态 | 猜成功/重复发布 |
| TX-09 | history | 旧内容恢复为 current revision+1；旧 snapshot/transaction 不删 | revision 倒退/换指针 |
| TX-10 | bypass | restore/undo/redo 只翻译至 impact+approval；其他 history op blocked | 裸 native history |
| TX-12C | snapshot subset | restore 期间已绑定旧 snapshot 的 harness 输入/bytes/digest 不变 | 读取 latest mutable source |
| TX-13C | commit race | stage 期间新锁、source、rights、binding、target mutation 阻止 commit | final check 缺失 |
| M4C-14 | native | restore 后仍三个原生 clip；改单镜两侧 identity 不变 | flattened composite |
| M4C-15 | media | 固定上游真实 render + 完整 decode + 900 帧/音轨/字幕事实 | JSON/mock 冒充媒体 |
| M4C-16 | cancellation | prepared 前取消 revision 0；晚到 stage 结果不 prepare/publish | 自动采用晚到结果 |
| M4C-17 | NOWRITE failure | 每个失败路径 source/revision/pointer/impact/outbox/idempotency 差异明确 | 不实 NOWRITE |
| M4C-18 | REG | M2/M3/M4A/M4B、legacy、contracts、fitness、build 全绿 | 删除/弱化旧门 |

## 9. 命令与证据合同

实现新增以下脚本；不存在时不得把计划命令写成已执行：

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm test:contracts
corepack pnpm test:m2.1
corepack pnpm test:wave2:w2.0
corepack pnpm test:wave2:m3
corepack pnpm test:wave2:m4a
corepack pnpm test:wave2:m4b
corepack pnpm test:wave2:m4c
corepack pnpm test:wave2:fitness
corepack pnpm check
corepack pnpm build
corepack pnpm evidence:wave1:historical
corepack pnpm evidence:wave1:integrity
corepack pnpm evidence:wave2:m4b:historical
corepack pnpm evidence:wave2:m4b:integrity
corepack pnpm evidence:wave2:m4c
corepack pnpm evidence:wave2:m4c:integrity
```

M4C 必须新增 `evidence:wave2:m4b:historical`，从 M4B capture/frozen tree 验证当时证据。M4C 合法修改代码后，M4B
current-tip integrity 若按设计非零，保存原始输出并以 historical 门证明，不得调绿或删检查。

证据追加在 `docs/evidence/WAVE2/`：`cases/m4c-cases.json`、`evidence-manifest-m4c.json`、
`logs/<capture-sha>/`、真实媒体 artifacts、credential scan、internal/external review。每条命令保存 `.cmd/.txt/.exit`，
每个 artifact 保存 SHA256；失败捕获永不覆盖。

全部自动化 Headless、静音、隔离、无窗口、不抢焦点；不读取 `J:\`，不用网络/provider/付费。headed/human 固定
`NOT_RUN`，不阻止技术门但不得冒充通过。

## 10. 回退与停止

部署回退：关闭 restore impact arm、history route 与 restore/undo/redo translator；保留 additive 表、行、snapshot 与证据。
内容回退：再次执行受控 restore；禁止手改 pointer、删除 snapshot 或 git reset。

普通编译/测试/竞态/文档同步问题自动修复。同一 M4C 超过两次返工由当前 Agent 主动根因闭环。仅在不可逆数据风险、
合同必须改写、费用/外传/隐私授权、真实外部阻塞或完成 M4C 冻结需要 Codex 独立复核时停止。
