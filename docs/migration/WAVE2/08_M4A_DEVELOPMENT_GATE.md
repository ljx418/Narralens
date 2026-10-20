# M4A ImpactService 开发与验收门

状态：`READY_FOR_CLAUDE_CODE_IMPLEMENTATION`
文档日期：2026-10-20
进入基线：M3 最终候选 `fa08fe4bcb111aeb8329f5771bae9b92bed3583e`，独立外审 PASS
允许范围：M4A；完成后停止在 Codex 复核点，不进入 M4B；该复核只做 M4A→M4B 门控，不重复审计已冻结 M3

## 1. 当前事实

- W2.0 与 M3 已在生产 Host 装配；materialize POST/GET 已开放，PR-01..03、MT-01..06 为 PASSED。
- `ImpactSpecV1`、adopt/restore request、错误码已存在；缺少的是 `ImpactRequestV1`、ConsumerGraph、ImpactStore、
  ImpactService 和 impact route。
- `/api/migration/v1/projects/:id/impact`、versioned edits、history restore 仍为 404；M4A 只允许开放 impact。
- ProjectResolver、AssetInventoryPort、MigratedAssetLedger、LockService、EngineRegistry、同一 RevisionStore
  连接和 ProjectOperationQueue 必须复用；不得创建第二数据库、第二 actor 或第二 timeline。
- M3 的已知边界继续保留：`MEDIA_TOOL_UNAVAILABLE` 可终结单个 materialization 行；M4A 只能接受
  `ready_for_adoption` 且重新验证成功的行，不能“修复”旧 stale 行。

## 2. 0–1 层目标架构

```text
POST /api/migration/v1/projects/:projectId/impact
  └─ auth/origin + 1 MiB JSON + ImpactRequestV1 validator
     └─ ProjectOperationQueue.run(projectId)             # 与锁/写串行的读屏障
        └─ ProjectResolver.resolveActivated(projectId)    # 唯一 target/root/base
           ├─ RevisionStore active commit/control revision
           ├─ ActivatedProjectionService                  # 持久迁移事实→layout cache
           │  └─ EngineRegistry.require(openfilm).inspect(current active commit)
           ├─ MaterializeService.read(materializationId)  # 重验 base/source/assets/rights
           ├─ ConsumerGraph.build(projection, intent)
           ├─ LockService.assertUnlocked(actual impact)
           ├─ 二次 currentness 复核
           └─ ImpactService.create
              ├─ canonical ImpactSpecV1 + 15m injected clock
              └─ ImpactStore (same SQLite, active only)
```

M4A 不调用 EnginePort `plan/stage/validate/render`，不创建 project transaction/snapshot/outbox，不改变
materialization/job。ConsumerGraph 是当前 committed projection 的确定性只读派生，不是持久 author model。

## 3. 模块与提交顺序

### M4A-0 生产投影装配红灯门

交付：Host-only `ActivatedProjectionService`（或等价 seam），从 `ProjectResolver`、active commit、terminal
migration 的 immutable plan/target snapshot facts 与目标资产账本重建 `OpenFilmProjectLayout` 后调用 pinned adapter
inspect。允许 adapter layout map 作为可丢弃缓存，禁止它成为 authority；不得增加 EnginePort 方法或把
adapter/绝对路径暴露到 API。plan 的 `identity_map` 当前在复制前冻结为空，禁止依赖它恢复 target clips；
scene/clip 由 pinned upstream 解析 `film.html`，Host frame_count 仍取 migration store 的 durable
`target_total_frames`。

门：全新 Host 重启后不调用测试专用 `registerLayout()` 即可 inspect 已激活 target；layout 缓存绑定
`project_id+active_commit.snapshot_id+source_digest`；缺 film closure 引用文件或 plan subtitle/narration/ledger asset 事实、root escape、
source/ledger drift 均 fail closed。Host base/control/snapshot identity 取 `ActivatedProjectView`，不得信任 adapter
投影中为兼容保留的 revision 0 或 digest 派生 snapshot id。历史 snapshot 仍未可检视时 restore impact 保持关闭。
adapter 当前对无 id/src/未知 kind 的 clip 会静默跳过；本门必须补 projection completeness，证明 upstream 每个
track/clip 一一进入 projection，或因未建模字段/override/transition/跳过节点产生 `problems[]` 并拒绝 impact。

### M4A-1 合同与红灯门

交付：`ImpactRequestV1` schema/type/validator/contract tests；route fitness 从“impact 必须 404”改成“只有 impact
可开放，versioned edits/history 仍 404”；错误 alias 不重命名。先写失败测试，再实现。

门：extra fields、路径/URL、客户端 affected consumers/locks/rights/hash 全拒绝；旧合同与 EnginePort 七方法全绿。

### M4A-2 ImpactStore、幂等与 canonical hash

交付：同一 RevisionStore DB 的 additive impact 表、CAS 状态机、复用唯一 `operation_idempotency` 的同
key/digest 完整重放与 key 冲突、fixed clock TTL、canonical hash、黄金向量和
独立实现互校。旧数据库打开后自动创建新表但不重写旧行；未知 state/operation 由 SQLite CHECK 拒绝。

门：键顺序变化 hash 相同；range/consumer/lock/rights/plan/base/source/control/engine SHA/expiry 任一语义变化
hash 不同；篡改 canonical JSON、hash 或 state fail closed；`now == expires_at` 为 expired。
幂等重放不得刷新 expiry 或产生第二 row；过期 row 用原 key 重放返回 428，重新评估必须用新 key。
impact row 与通用幂等 response 同一事务提交，故障注入任一边都不得留下 orphan；impact 表不得再建第二套
idempotency key 约束。若抽取通用 store，M3 materialize 的幂等行为必须无漂移。

### M4A-3 ConsumerGraph 与锁分类

交付：纯 `ConsumerGraph`、确定排序、shared asset 唯一解析、采用 intent 的 affected ranges/consumers；未知或
ambiguous consumer fail closed。复用 LockService，但不得用客户端 preserve 或无差别三锁。

门：plan range 与当前 visual clip 求交，`affected_ranges.clip_id` 使用当前 projection clip id，而不是新 plan clip
id；三镜视觉替换命中 visual；边界/总时长改变才命中 duration；真实 narration/audio/subtitle/shared consumer
变化才命中对应关系；preserve 且未变化不误阻塞。当前固定 fixture 的未知 transition/override/被跳过 clip/
悬空 source_ref 明确拒绝。`locks_checked` 为全部 active lock 的稳定快照（最多 64），approval 固定只含
`human_confirmation`。

### M4A-4 ImpactService 与生产路由

交付：服务端重读 current facts、双重 currentness 复核、ImpactStore insert、201 route；Host composition 只能有
一个 ImpactStore/Service 实例。route body 受现有 JSON 上限、session、Origin 保护。

门：真实 migrated OpenFilm target + ready materialization 经 HTTP 得到有效 spec；前后 filesystem/DB authority
NOWRITE；错误优先级稳定；第一次检查后、最终检查前注入 lock/source/control/rights/materialization 变化不能
生成 active impact。insert 后才发生的外部变化必须在重放/读取时由 requireCurrent CAS stale，M4B 不得只看
数据库 active 标志。

### M4A-5 模块检查点与交接

同步主架构、traceability、route inventory、workflow registry；生成 `tests/wave2/m4a/`、`test:wave2:m4a` 和
只追加 evidence。完成本门后状态最高为 `M4A_INTERNAL_EVIDENCED`，停止并交 Codex 判断能否进入 M4B；不把
M4A 单独声明成 Wave 2 完成，不重复做整波独立外审。

## 4. 直接验收矩阵

| ID | 层级 | 必须证明 | M4A 后状态 |
|---|---|---|---|
| M4A-P01 | production/restart | 持久事实重建当前 active OpenFilm layout；无测试 hook；漂移/逃逸 fail closed | CLOSED |
| M4A-C01 | contract | request schema/type/validator 一致，客户端不能自报影响事实 | CLOSED |
| M4A-DB01 | DB/reopen | additive impact 表、旧 DB 重开、state CAS、唯一通用幂等表、row+response 原子、无第二 DB | CLOSED |
| M4A-H01 | hash/golden | domain prefix、规范排序、独立实现向量一致、篡改失败 | CLOSED |
| M4A-TTL01 | clock | 15 分钟；边界过期；过期不可复活 | CLOSED |
| TX-02A | service | hash/TTL/materialization/base/source/control/rights/plan 任一变化使 requireCurrent 返回 428 | INTERNAL_EVIDENCED_SUBSET |
| TX-03A | lock | adopt 的真实 visual 锁命中 423；preserve consumer 不被虚构成变化 | INTERNAL_EVIDENCED_SUBSET |
| TX-04A | graph | duration 与 shared subtitle/audio/transition/asset 完整分类；未知图 fail closed | INTERNAL_EVIDENCED_SUBSET |
| TX-05A | HTTP/race | stale base/source/control、OpenFilm projection 漂移在 impact 创建前拒绝，revision 不增 | INTERNAL_EVIDENCED_SUBSET |
| M4A-NW01 | diff | source/revision/commit/pointer/binding/ledger/materialization/job/outbox 前后相等 | CLOSED |
| M4A-R01 | route | adopt impact 新建/幂等重放=201；restore intent capability blocked；versioned edits/history restore 仍 404；legacy routes 保持 | CLOSED |

`TX-01` 缺 impact 拒绝、`TX-02` 在写入入口的最终复核、`TX-03..05` commit 前竞争只能在 M4B 关闭；M4A
不得提前标 PASSED。测试总数不能替代以上逐 ID 映射。

## 5. 关键负向与竞争矩阵

- project 不存在、legacy Hypit project、非 terminal/attention migration、缺 binding/commit/root escape；
- 全新 Host 无内存 layout、缓存对应旧 snapshot/source、缺 terminal migration/plan/subtitle/narration/asset 事实；
- materialization 不存在、跨项目、queued/running/stale/cancelled/failed/attention、缺 plan/proxy/lineage；
- request base/source/control 不一致；current materialization 在检查中变 stale；asset rights/bytes 变化；
- visual/duration/narration 锁分别命中和不命中；范围边界接触但不重叠；shared asset 多对一/悬空；
- hash 篡改、canonical JSON 篡改、过期边界、并发同 key 同/异 digest、row/response 原子故障、重放不续期、DB reopen；
- 在第一次检查后、最终检查前注入 lock/control、source、rights 或 active commit 变化；不得留下 active row；
- insert 后注入外部 source/rights 漂移，下一次 replay/requireCurrent 必须 CAS stale 并 428；不得仅信 active flag；
- Host 重启后 active impact 可读但必须重新 currentness；不能仅因数据库中存在就可信。

## 6. 实际命令与证据

最低执行：

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm test:contracts
corepack pnpm test:wave2:m4a
corepack pnpm test:wave2:m3
corepack pnpm test:wave2:fitness
corepack pnpm check
corepack pnpm evidence:wave2:m3:integrity
corepack pnpm evidence:wave1:historical
```

新增 hash 独立实现命令和凭据扫描。M3 evidence 是历史冻结记录，不得因 M4A 后续代码移动而修改旧 capture；
M4A 日志写 `docs/evidence/WAVE2/logs/<m4a-capture-sha>/`，失败捕获不覆盖。每条记录 `.cmd/.txt/.exit`、
完整 repo/upstream SHA、环境、case、SHA256 和声明边界。

交互测试仅 Headless、静音、隔离 profile、无窗口、不抢焦点；M4A 没有 UI，因此 headed/human=`NOT_RUN`。

## 7. 回退与禁止项

回退：关闭 impact route，停止新 impact 创建；保留 additive table 和证据。无需修改 source 或 revision。

禁止：实现 M4B adopt/M4C restore commit；开放 versioned edits/history route；修改 legacy `/edits`；给
EnginePort 增加 commit；保存第二 timeline；信任客户端 range/consumer/rights/locks/hash；把未知消费者当无影响；
让 in-memory layout 或 adapter revision 0 成为 Host authority；外传、付费、读取 `J:\`、headed 浏览器、
force push/reset/delete 历史证据。

## 8. 停止与声明

普通实现/测试问题由 Claude Code 自动闭环；同阶段第 3 次返工必须做根因修复和防回归门。只在需人工
高风险契约决策、不可逆数据/费用/外传、真实 Gate 连续两轮无改善或必须移交另一实现者时停止。

M4A 最高声明：`M4A_INTERNAL_EVIDENCED`。仍禁止 `WAVE2_COMBINED_REVIEW_PENDING`、
`WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、Gate V1-P0、V1-Full、M5/M6、长片、headed/human。
