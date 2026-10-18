# Claude Code 交接：Wave 2 可编辑采用闭环

状态：`READY_TO_COPY`。本包 `00_READ_FIRST.md` 已达到
`READY_FOR_CLAUDE_CODE_IMPLEMENTATION`，以下提示词可直接执行。

```text
你是本地 Narralens 仓库的 Wave 2 实施负责人。请在现有项目上增量完成 M3→M4A→M4B→M4C，
不要新建替代项目，不重写或删除已通过的 Wave 1 模块。模块检查点通过后自动继续，直到 Wave 2
组合候选、真实验收、内部审查和冻结证据完成；然后停止并交独立外审，不能自签外审。

【现场核对与用户工作保护】
repo=/mnt/c/workspace/videoworkline/Narralens
报告文档基线=36473c89c2a26acba8161226e6066b4b9fdb69d0
Wave1 frozen code=e2dec5ca03ee881b55f92b920ee6df2c676aeb26
OpenFilm upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3
Hypit upstream=6fdd8c0f02c17b9970aee6deb4550a70e9d57acf

先输出实际 branch、完整 HEAD、origin/main、remote、worktree、与报告差异。文档基线之后可能有纯文档
提交，以实际 HEAD 为准；不要 reset 回任何报告 SHA。保护全部用户改动，不 stash、不 force push、
不删除旧工程/证据。若工作树非 clean，先判断是否与本波重叠；能隔离则继续，不能安全隔离才停下。

【权威阅读顺序】
1. docs/migration/WAVE2/00_READ_FIRST.md
2. docs/migration/WAVE2/01_BASELINE_AND_GAPS.md
3. docs/migration/WAVE2/02_ARCHITECTURE_AND_CONTRACTS.md
4. docs/migration/WAVE2/03_DEVELOPMENT_AND_ACCEPTANCE_PLAN.md
5. docs/migration/WAVE2/04_INTERNAL_REVIEW.md
6. docs/03_Architecture.md、docs/11_V1_Traceability.md
7. docs/handoff-m2-m7d-claude/06_ARCHITECTURE_CONTRACT_LOCK.md、07_CODE_STANDARDS.md、
   08_TEAM_DEVELOPMENT_WORKFLOW.md、09_TEST_ACCEPTANCE_PLAN.md
8. 当前 src/tests/contracts/tools/package.json、docs/evidence/WAVE1/evidence-manifest.json。

事实冲突顺序：当前源码/测试/DB constraint → Wave1 冻结证据 → WAVE2 冻结文档 → 总文档 → 早期
docs-only D4.2 schema。旧 d4.2-materialized-proposal 的单 composite/Hypit replace 模型仅是历史快照，
不得复制成 Wave 2 runtime 合同。

【开工前门】
1. 重跑 corepack pnpm evidence:wave1:integrity，必须 6/6 PASS；
2. 重跑 corepack pnpm check、test:contracts、test:m2.1；记录真实结果，不照抄报告；
3. 证明 materialize/impact/versioned edits/history restore 当前仍 404；
4. 把 WAVE2 合同转为 runtime schema/type/validator 的失败测试；新路由在模块出门前保持关闭；
5. 若发现文档 BLOCKER/MAJOR，先修文档与失败测试；普通问题自动闭环，不等待用户。

【不可改变的架构契约】
- 一个 project 只有一个可写 engine；不双写 Hypit/OpenFilm，不保存第二份最终 timeline。
- EnginePort 保持恰好 inspect/capabilities/plan/stage/validate/preview/render 七方法，无 commit/shell/path。
- Host/ProjectCoordinator 拥有 revision、locks、snapshot pointer、idempotency、outbox 和 commit。
- M3 只写 materialization/job/event/derived artifact；author source、active commit、revision、binding、
  active asset ledger 前后必须不变。旧目标 ledger bootstrap 只在 W2.0 开工前执行，不能由请求懒触发。
- M4 必须 queue→gateway→base/source/control/rights/impact/locks→EnginePort stage/validate→snapshot→
  atomic commit。OpenFilm rebased=true 永远是严格 409。
- 成功 adopt/restore 恰好 revision+1；失败 0；restore 生成新 revision，不能直接切旧 pointer。
- 三镜方案采用后仍为三个原生可编辑 clip；proxy/flattened MP4 不能替代 native plan。
- callback/provider/worker 只能登记 stage/artifact/state；取消或失 lease 后晚到结果 quarantine，绝不采用。
- 所有 render 绑定 committed snapshot；本波真实 renderer harness 不冒充 M6 生产 render route。
- legacy routes/contracts/tests/evidence 全部保留。

【实现顺序——连续执行，不逐模块等待】

W2.0 Activation compatibility, contracts & red gates
- 先补 `ProjectResolver`/`ActivatedProjectView`：legacy 委托 ProjectCatalog；OpenFilm 必须由 terminal migration、
  唯一 binding、active commit 和 migration-root containment 共同解析。把 project/proposal/materialize/impact/write
  的读取接缝统一到 resolver；`migratedRoots` 只能是 cache，不是权威。显式装配固定 SHA 的 OpenFilm port。
- 增加 target-owned `MigratedAssetLedger` 与只读 `AssetInventoryPort`。旧 target 只允许在任何 Wave2 写之前做
  一次 bootstrap：当前源 tree digest 必须等于 migration 的 source_sha256_before；源 Manifest@2、migration
  plan/report、目标 bytes 双次 hash/frames/license 必须一一对应，basename 冲突/多对一拒绝，
  保存完整 lineage 且不改 author source/revision/active commit；失败 attention/capability blocked。新 migration
  activation 原子播种同一 ledger。materialize 不得懒初始化或静默跨项目 fallback。
- 新增 MaterializeRequestV1、NativePlanV1、MaterializationV1、ImpactSpecV1、AdoptRequestV1、
  RestoreRequestV1、ControlledWriteResponseV1 的 runtime JSON Schema、TS 类型、validator 与 contract tests。
- 扩展 ApiErrorCode 但保留 alias；新增 route registry/fitness，确保未开放能力仍 404。
- 新增旧 SQLite fixture 的 forward migration test；严禁删表重建丢记录。

M3.1 Persistence & Binding
- 在同一个 RevisionStore/SQLite 连接加入 materialization 表；JobKind 支持 materialize。SQLite job CHECK
  扩展必须先 VACUUM INTO 可验证备份，再以 job_v2 显式列复制、核对行/键/状态/lease/receipt digest、
  事务替换并写 schema_migration；用 Wave1 数据库 fixture 证明无损重开。max attempts=3、lease=30s。
  加入 operation_idempotency，为 Wave2 按 project+kind+key 唯一。
- BindingService 逐 segment 重读 proposal、资产账本、rights、bytes SHA/MIME/frame count；对 OpenFilm 只读
  MigratedAssetLedger。comparison.project_id/proposal.project_id/path project 必须相同，禁止源 comparison 改绑。
  source span 使用整数半开帧；短素材/未知/重复/越界拒绝，不 loop/freeze/speed。

M3.2 Native plan & proxy
- NativePlanBuilder 为固定三镜 fixture 生成三个稳定 clip spec；总帧与 proposal selection 精确一致。
- ProxyRenderer 只用固定 execFile argv/profile，无 shell/网络；全局并发2、同项目1、每 segment 120s；
  artifact 内容寻址并 fsync/rename。lineage 覆盖每个 input bytes/span/rights/tool version。
- derived 产物放 materialization 专属根，不发布 active asset ledger，不进入 author source。

M3.3 Routes/recovery
- 开放 POST .../:proposalId/materialize 与 GET materializations/:id；POST 返回 202 Job + materialization_id。
- worker 必须先持 owner+attempt lease；取消、晚到、重启、失 lease、部分文件全部按 WAVE2 状态机处理。
- 每次 GET 复核 base/source/control/inventory/rights/bytes；变化则 stale，不能 ready/adopt。
- M3 PR-01..03、MT-01..06 到 INTERNAL_EVIDENCED 后自动进入 M4A，不做独立外审。

M4A Impact
- ConsumerGraph 从 committed EngineProjection/native plan 得出 visual/narration/subtitle/audio/transition/
  shared_asset 消费关系，不持久化第二 timeline。
- ImpactService 从当前 snapshot/base/source/control/rights/locks/plan 计算 canonical spec；域前缀
  narralens-impact-v1\n；TTL 固定15分钟并注入时钟；客户端只回传 id/hash。
- 开放 POST /api/migration/v1/projects/:id/impact；不写 source/revision。

M4B Adopt
- TypedEdit 新增 adopt_materialization；Native registry/capability 只开放对应明确入口。
- OpenFilm adapter.plan 把 NativePlanV1 转成已验证的固定 upstream ops；stage 只写 Host isolated root；
  validate 三 clip、identity、total frames、narration/subtitle/neighbour invariants。
- Host 按资产 hash 在 isolated stage 安装为 `inputs/<sha256>/source.mp4`，只把相对 token 交给 EnginePort；
  adapter stage 再复制为目标 `assets/<sha256>/source.mp4`。任何请求/合同/port 结果不携带服务器绝对路径。
- 从 ProjectCoordinator 抽取内部 controlled-write 原语；legacy executeEdit 行为/响应保持。不得创建第二 actor。
- 开放 versioned POST /api/migration/v1/projects/:id/edits；approval 仅为当前 session 对匹配 impact 的
  confirmed=true，不授权费用/外传；幂等/base/source/control/rights/impact/locks
  依序复核，snapshot 后单事务 revision+1/pointer/idempotency/impact consumed/outbox。

M4C History
- TypedEdit 新增 restore_snapshot；HistoryService 对旧 snapshot 在当前策略下重新 impact/stage/validate/commit。
- native undo/redo/restore translated 到 Host 或继续 blocked；绝不裸调用/直接换 active pointer。
- 开放 POST .../history/restore；恢复成功产生新 snapshot/revision+1，旧历史和费用记录保留。

【逐 case 与真实验收】
必须逐项关闭 ACT-01..02、ASSET-01..03、PR-01..03、MT-01..06、TX-01..14、W2-REG，定义和断言以
03_DEVELOPMENT_AND_ACCEPTANCE_PLAN.md 为准。测试总数不能替代逐 case。

真实链必须使用：已迁移 OpenFilm 三 clip fixture + target-owned D4.1 proposal + 已登记 cleared/commercial MP4。
为避免未经授权的新 Claude 费用，允许使用已保存的真实 D4.1 runner draft/audit 作为离线输入，在目标投影上
重新走正常 adapter 构建 comparison；证据同时绑定原 stdout/payload SHA 与新 comparison SHA，并明确标为
`RECORDED_PROVIDER_OUTPUT_REPLAY`。禁止直接修改 JSON project_id 或称作本轮新 provider 调用。
完成真实 proxy、完整 decode、ffprobe、首末帧/边界帧；adopt 后 upstream native inspect 仍三 clip；首次
导出；关闭 Host 重开；改中间一镜；再次导出且 SHA 改变、总帧符合批准 impact、两侧 clip identity 不变；
restore 旧内容生成新 revision。不得以 mock/JSON/扁平 MP4替代原生和媒体证据。

故障覆盖：M3 create/lease/segment/fsync/rename/lineage/ready/cancel/callback；M4 impact、received、stage、
validate、snapshot rename、prepared、DB commit、outbox、history。并发覆盖双 worker、双采用、锁/rights/
external source 在 stage 期间变化。任一不确定发布进入 attention。

自动浏览器一律 Headless、静音、隔离 profile、无窗口、不抢焦点，结束清理。headed/human 本波记
NOT_RUN。未经授权不得外传、付费、读取 J:\ 私有素材或打开可见窗口。

【门禁与证据】
新增 package scripts：test:wave2:m3、test:wave2:m4、test:wave2:fitness、evidence:wave2、
evidence:wave2:integrity。保留并执行：check、test:contracts、test:m2.1、tests/m2.2、tests/m2.3、
evidence:wave1:integrity。不要调弱 timeout/assertion 或删除旧测试来制造全绿。

证据写 docs/evidence/WAVE2/，logs/<capture-sha>/ 只追加不覆盖；记录 .cmd/.txt/.exit、环境、full
repo/upstream SHA、fixture hash、逐断言、产物 SHA256、credential scan 和 claim limits。捕获时工作树
clean；manifest 自身避免自哈希循环。旧失败日志保留。

模块检查点只跑增量、fitness、受影响回归并自动继续。Wave2 末运行完整组合门，做架构/代码/体验/
验收四视角内部审查，修复全部 BLOCKER/MAJOR，冻结组合 commit。再启动独立干净 Claude Code 会话
只读审查冻结 commit 并复跑关键 Gate；实现会话不可自签。外审不可用则 REVIEW_PENDING。

【自动修复与唯一停止条件】
普通编译、测试、race、adapter 差异、文档小错、证据工具问题自动修复。同阶段第3次返工必须自行做
根因修复+防回归门。仅在需要人工内容/体验核验、架构/不可逆数据/费用/外传高风险决策，或必须移交
另一 Claude Code 会话时停止；422/429/529 只在确实阻断真实验证且替代路径耗尽后报告。

【回退】
能力开关可关闭五条 Wave2 路由；停止 worker、回收 lease、保留 Wave2 DB 表、迁移备份、derived
artifacts/evidence。
内容恢复只走 HistoryService 新 revision。禁止 git reset、force push、删除 snapshot、覆盖旧工程或双写。

【最终声明与报告】
最高只允许 WAVE2_EDITABLE_ADOPTION_READY。不得声明 Gate V1-P0、V1-Full、M5 Studio UX、M6 正式
render、长片性能、headed/human 已通过。

最终报告必须输出：阶段、branch/HEAD/origin/worktree、提交序列、实现/未实现、逐 case 状态、实际命令
和 exit、真实媒体/原生证据 SHA256、NOWRITE/ revision exactly+1/回退结果、内审/外审、evidence 路径、
限制、下一个允许阶段和禁止宣称范围。完成后停止，不进入 Wave3。
```
