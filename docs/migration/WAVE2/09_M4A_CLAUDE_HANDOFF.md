# Claude Code 交接：M4A ImpactService

状态：`READY_TO_COPY`
交接提交：以交接时 `git rev-parse HEAD` 的完整值为准；最终对话给出冻结 SHA
实现范围：M4A；不得进入 M4B/M4C 工程写入

```text
你是本地 Narralens 仓库的 M4A 实施负责人。请在当前分支做增量实现，不新建替代项目、不重写已通过的
W2.0/M3/Wave 1 模块。完成 M4A 全部代码、测试、证据和内部四视角审查后停止在 Codex 复核点；本模块
不单独要求你自签外审，也不得进入 M4B adopt 或 M4C history commit。

【现场基线，先复核，不要 reset】
repo=/mnt/c/workspace/videoworkline/Narralens
branch=migration/m2.2-coordinator-persistence
handoff HEAD=<使用交接消息给出的完整冻结 SHA，并与本地 git rev-parse HEAD 核对>
M3 candidate=fa08fe4bcb111aeb8329f5771bae9b92bed3583e
M3 code/evidence capture=f2a41ff9f5613dc083ea89082505a496163175eb
origin/main=304c89134fdf9f834f7d69e3f4d5c89a68044c60
OpenFilm=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3

先输出实际 full HEAD、branch、origin/main、remote、worktree；对比 handoff HEAD 后保留所有用户工作，不
reset/stash/force push、不改写提交历史。若 SHA 不同，先列差异；能安全增量则继续，重叠且无法保护才停。

【权威阅读顺序】
1. docs/migration/WAVE2/09_M4A_CLAUDE_HANDOFF.md
2. docs/migration/WAVE2/08_M4A_DEVELOPMENT_GATE.md
3. docs/migration/WAVE2/ADR-W2.0-004-m4a-impact-request-and-consumer-graph.md
4. docs/migration/WAVE2/02_ARCHITECTURE_AND_CONTRACTS.md
5. docs/migration/WAVE2/03_DEVELOPMENT_AND_ACCEPTANCE_PLAN.md
6. docs/evidence/WAVE2/reviews/external-review-m3-final-2026-10-20.md
7. docs/03_Architecture.md、docs/11_V1_Traceability.md
8. docs/handoff-m2-m7d-claude/06_ARCHITECTURE_CONTRACT_LOCK.md、07_CODE_STANDARDS.md、
   08_TEAM_DEVELOPMENT_WORKFLOW.md、09_TEST_ACCEPTANCE_PLAN.md
9. 当前 src/contracts/wave2-types.ts、validator、server、ProjectResolver、MaterializeService/Store、
   RevisionStore、LockService、EngineRegistry/Port、AssetInventoryPort、package scripts 和 M3 evidence。

事实冲突顺序：当前源码/数据库约束/测试 → M3 最终证据与独立外审 → ADR-W2.0-004 与 08 gate → 原 Wave2
冻结文档 → 总文档。不要把早期“所有 Wave2 路由 404”测试恢复；当前 materialize POST/GET 已合法开放。

【开工前门】
- 工作树 clean 或已明确保护非本阶段改动；
- corepack pnpm evidence:wave2:m3:integrity exit 0；
- corepack pnpm test:wave2:m3、test:contracts、test:wave2:fitness 真实通过；
- 证明 impact/versioned edits/history restore 仍 404，legacy /api/projects/:id/edits 仍工作；
- 禁止修改 docs/evidence/WAVE2/logs/f2a41ff... 和旧失败捕获；M3 manifest 是历史冻结记录；
- 若文档与真实代码存在 BLOCKER/MAJOR，先追加 ADR 或修本文档及红灯测试，不静默猜测。

【M4A 唯一结果】
对已迁移 OpenFilm project 的 ready materialization，由服务器从当前 committed snapshot、materialization、
asset/rights、ConsumerGraph 和 locks 计算 ImpactSpecV1，持久化 15 分钟 active impact 并返回 201。客户端
只能提交 ImpactRequestV1 的 base/source/control + typed intent + idempotency_key，不能自报范围、消费者、
许可、锁、hash。
前后 source/revision/active commit/pointer/binding/ledger/materialization/job/outbox 必须完全不变。

【固定架构】
- 一个 project 一个可写 engine；无第二 timeline、第二 SQLite、第二 actor、adapter commit。
- EnginePort 仍恰好 inspect/capabilities/plan/stage/validate/preview/render 七方法。M4A 只允许 inspect，禁止
  plan/stage/validate/render。
- 复用 ProjectOperationQueue 形成与锁/写同项目串行的读屏障；复用 ProjectResolver、RevisionStore 同一连接、
  MaterializeService 的重验、AssetInventoryPort、LockService、EngineRegistry。
- 生产 OpenFilm adapter 当前只注册 port，layout 仅被测试/探针手工 register。先新增 Host-only
  ActivatedProjectionService（或等价 seam）：从 resolveActivated + active commit + terminal migration 的
  immutable plan/target snapshot facts + target asset ledger 重建 layout，再调用 inspect。`film.html` 是第一 root；
  plan narration/subtitle target path 是显式 roots；ledger target path/id/hash 是 declared assets；scene 等其余文件
  只由 source-digest closure 发现。缓存可写入 adapter map，但不是 authority；Host 重启必须可重建；不得把
  concrete adapter/绝对路径暴露到 API，也不得增加 EnginePort 方法。
- 当前 MigrationPlanV1.identity_map 在复制前冻结为空，禁止依赖它恢复 target clip；clip identity 来自 pinned
  upstream 解析 film.html，Host frame_count 来自 durable target_total_frames，禁止把临时 report extras 当持久事实。
- layout/cache identity 至少是 project_id + Host active_commit.snapshot_id + source_digest。adapter projection 的
  snapshot_id 是 digest 派生值，project_revision/control_revision 当前为 0；Impact 的 snapshot/base/control 必须
  使用 ActivatedProjectView，projection 只作为内容图，禁止信任这些占位字段。
- ConsumerGraph 是从 committed EngineProjection 确定性重建的只读图，不保存 clip 顺序或最终 timeline。
- 未知 transition/clip kind、projection problems、悬空或多义 source_ref/shared asset 必须 fail closed，不能少算。
  当前 adapter 会静默 skip 无 id/src/未知 kind 的 clip；M4A 必须补 projection completeness：upstream track/clip
  与 projection 一一对应，未建模字段、非空 override、transition 线索或任何 skip 都进入 problems/拒绝 impact。
- plan range 与当前 projection visual clip 求交并完整覆盖；ImpactSpec affected_ranges.clip_id 使用当前 clip id，
  不是尚未提交的 plan clip id；否则现有 shot/visual lock 会被绕过。交集相邻项按当前 clip 合并后规范排序。
- 锁按真实变化计算：adopt visual；边界/总时长真的变化才 duration；narration/subtitle/audio/shared consumer
  真的变化才相应关系。禁止客户端 preserve 授权，也禁止无差别三锁过度阻塞。
- impact hash 固定为 SHA256(narralens-impact-v1 换行 + canonical(spec without impact_hash))；数组进入 hash
  前按 ADR 指定语义排序；TTL 从 injected clock 起 15 分钟，now>=expires_at 即 expired。
- impact 仅允许同一事务写 impact row 与通用 operation-idempotency response row。impact 状态只
  active→consumed/expired/stale，M4A 不消费。
- locks_checked 是本次读取的全部 active locks 稳定快照，超过 64 拒绝；真实冲突返回 423 且不落 row。
  approvals_required 固定为 ["human_confirmation"]，只对应 M4B 的本地 session confirmed，不授权费用/外传。
- impact POST 使用统一幂等语义：同 project/operation/key + 同 request digest 完整重放原 spec，不续期、不重算；
  同 key 异 digest 409；过期后用原 key 返回 428，调用方须用新 key 请求一次全新服务端评估。
- 唯一幂等权威是现有 operation_idempotency 表，operation kind 固定为 impact.adopt_materialization 或
  impact.restore_snapshot。不得在 impact 表建立第二个 key 权威。impact row 与完整 response 必须在同一个
  RevisionStore.atomic 事务提交；可抽取现有 MaterializationStore 的通用幂等实现，但不得改变 M3 行为。

【实现顺序】
0. 生产投影红灯：先证明 fresh Host 对已激活 OpenFilm target 直接 inspect 会因无 layout 失败；再实现上述
   ActivatedProjectionService。layout roots 由持久迁移事实给出，film.html 优先，narration/subtitle/assets
   全部相对 source root 且 fail closed，scene 仅从 film closure 发现；不允许请求传 path，也不允许目录扫描猜权威。补重启、旧缓存、root
   escape、缺事实和 source/ledger drift 测试。历史 snapshot 无独立 root/layout 时 restore impact 保持 blocked。
1. 红灯合同：新增 ImpactIntentV1/ImpactRequestV1（含 idempotency_key）、impact-request.schema.json、validator、registry 与 contract
   tests；additionalProperties=false；请求无 path/URL/shell/affected/rights/hash。同步 route fitness，但只开放 impact。
2. ImpactStore：在 RevisionStore 同一 DB additive 建表；字段、约束、CAS、幂等 replay/conflict 和 reopen 按
   ADR §4。复用 operation_idempotency 单一权威并把 impact row+response 原子提交；用旧 DB fixture 证明无损；
   未知 operation/state 被 SQLite CHECK 拒；不建 schema_migration 假记录。
3. canonical：抽取/复用确定性 canonical；加固定 vectors 和 Python 或真正独立实现互校。键重排 hash 相同，
   range/consumer/lock/rights/plan/base/source/control/engine SHA/expiry 任一变化 hash 不同。
4. ConsumerGraph：从真实 EngineProjection + NativePlan 构边、排序、检测 ambiguity；affected range 映射当前
   clip id；补 adapter projection completeness；不得持久第二 timeline。
5. ImpactService：严格按 auth/schema→queue→resolveActivated→幂等 replay/conflict/currentness→base/source/control→
   inspect committed snapshot→materialization/snapshot currentness→asset/rights/bytes→graph→locks→二次
   currentness→insert 顺序。
6. Host composition + POST /api/migration/v1/projects/:id/impact；201 返回 validateImpactSpec 可接受的完整 spec；
   body 64 KiB、session、Origin 与 correlation 语义保持。
7. 同步架构/traceability/route inventory/workflow；新增 test:wave2:m4a 和只追加 M4A evidence。

restore_snapshot intent 可以在 M4A 共用 request/store/hash，但只有当 immutable historical snapshot 能由 pinned
adapter 真实 inspect 并完整构图时才开放；否则明确 capability blocked，不得用 active source 冒充旧 snapshot。

【逐 case，不以总测试数替代】
- M4A-C01：request schema/type/validator/HTTP 一致；客户端自报影响事实全部拒绝。
- M4A-P01：fresh Host 从持久事实恢复 current active layout 并 inspect；无测试 hook；漂移/逃逸 fail closed。
- M4A-DB01：additive table、旧库重开、state CAS、唯一通用幂等表、row+response 原子、同 key/digest 重放、
  异 digest 409、不续期、一个 DB。
- M4A-H01：domain hash、排序、独立黄金向量、篡改失败。
- M4A-TTL01：15m、边界过期、过期不复活。
- TX-02A：hash/TTL/materialization/base/source/control/rights/plan 任一变化 requireCurrent→428。
- TX-03A：真实 visual lock→423，preserve 不虚构变化。
- TX-04A：duration/shared subtitle/audio/transition/asset 完整分类；未知图 fail closed。
- TX-05A：HTTP stale/race 拒绝，revision 零增长。
- M4A-NW01：source/revision/commit/pointer/binding/ledger/materialization/job/outbox 前后相等。
- M4A-R01：adopt impact 新建/同 key 同 digest 重放=201；restore intent capability blocked；versioned
  edits/history=404；legacy/materialize routes 保持。

TX-01 和 TX-02..05 的写入口/commit 前最终结论属于 M4B，只标 INTERNAL_EVIDENCED_SUBSET，不得冒充 PASSED。

【故障、竞争与安全】
至少注入：impact 保存前/后、第一次检查后 lock/control 变化、source/active commit 变化、rights/bytes 变化、
materialization 变 stale、并发相同 intent、DB reopen、hash/canonical/state 篡改。任一前提变化不得留下 active
impact（指变化发生在最终检查前）。若外部变化发生在 insert 后，下一次 replay/requireCurrent 必须 CAS stale
并返回 428；任何 M4B 消费都必须调用 requireCurrent，不能只看 active flag。auth/origin 在资源查找前；响应/
日志不得含绝对路径、token、私有内容或凭据。

自动交互一律 Headless、静音、隔离 profile、无窗口、不抢焦点，结束清理；本阶段无 UI，headed/human
记 NOT_RUN。不得外传、付费、调用 provider、读取 J:\、打开可见窗口。

【门禁与证据】
真实执行并保存：tsc、test:contracts、test:wave2:m4a、test:wave2:m3、test:wave2:fitness、pnpm check、
M3 integrity、Wave1 historical、hash 独立向量、credential scan。不要运行或调绿“当前 tip 不得晚于历史冻结”
类旧门；应运行 historical 版本并保留语义说明。

证据写 docs/evidence/WAVE2/logs/<M4A-capture-full-sha>/ 和 cases/m4a-cases.json，按提交只追加；记录
.cmd/.txt/.exit、环境、repo/upstream SHA、case、assertion、artifact SHA256、claim limits。失败捕获保留。
捕获时工作树必须 clean；实现与证据提交分离，manifest 不自哈希循环。

做架构、实现、完整体验边界、测试验收四视角内部审查；关闭所有 BLOCKER/MAJOR。普通失败自动修复；
同阶段第 3 次返工必须自行根因修复+防回归门。只有架构契约/不可逆数据/费用外传/真实 Gate 连续两轮无改善
才停下请求决策。

【回退与停止】
回退仅关闭 impact route并保留 additive 表/rows/evidence；M4A 不应需要内容恢复。禁止 git reset、force push、
删除 snapshot/旧 evidence、覆盖源工程。

完成后停止在 Codex 复核点，不进入 M4B。最高声明 M4A_INTERNAL_EVIDENCED。禁止声明
WAVE2_COMBINED_REVIEW_PENDING、WAVE2_EDITABLE_ADOPTION_READY、Gate D4.2、V1-P0、V1-Full、M5/M6、
正式 render、长片、headed/human。

最终报告必须包含：branch/full HEAD/origin/worktree、提交序列、实现与未实现、逐 case 状态、所有实际命令
与 exit、hash vectors、NOWRITE diff、路由状态、证据路径/SHA256、四视角审查、回退、限制、下一个允许模块。
```
