# M4B 开工包三轮独立文档审查

状态：`M4A_EXTERNAL_REVIEW_PASS_SATISFIED / M4B_DOCUMENT_REWORKED_PENDING_FINAL_REVIEW`。

审查对象：`02_ARCHITECTURE_AND_CONTRACTS.md`、`03_DEVELOPMENT_AND_ACCEPTANCE_PLAN.md`、
`11_M4B_CONTROLLED_ADOPTION.*`、`12_M4B_DEVELOPMENT_GATE.md`、`13_M4B_CLAUDE_HANDOFF.md`，以及当前生产
ProjectCoordinator/RevisionStore/SnapshotStore/ImpactService/MaterializeService/EnginePort/gateway/adapter/route 合同。

三轮均从不同问题集合重新核对，不把前一轮结论当事实。

## 第一轮：架构与权威边界

结论：最初发现 2 个 MAJOR，已闭环；`BLOCKER=0 / MAJOR=0`。

1. **MAJOR：目录级覆盖会产生混合时间线。** 旧计划只写“stage 后发布 source”，未说明多个 source 文件如何原子
   发布。修订为 M4B v1 白名单：先 no-clobber 安装未引用的内容寻址资产，再以同目录 rename 原子替换唯一引用
   入口 `film.html`；任何字幕/设置/旁白/旧资产变化 fail closed。恢复以 before/after film SHA 判断。
2. **MAJOR：journal 可能成为第二状态机。** 修订为 `project_transaction.state` 唯一状态权威，1:1
   `adoption_transaction_fact` 只保存不可变恢复事实且没有 state 字段。

确认：EnginePort 保持 7 方法；adapter 无 commit 权；ProjectCoordinator/ProjectOperationQueue 是唯一写边界；
OpenFilm active source 是唯一 timeline；legacy ProjectWriteActor 不重写。

## 第二轮：代码可实现性与接口闭包

结论：最初发现 2 个 MAJOR，已闭环；`BLOCKER=0 / MAJOR=0`。

1. **MAJOR：adapter 只有 materialization id，无法纯函数生成 native ops。** 若让 adapter 读取 Host store 会反向依赖，
   若把 NativePlan 放入 HTTP 又允许客户端自报事实。新增 gate §3.1：wire request 与 server-only
   `EnginePlanIntent` 分离；Coordinator 经 public read/impact 重验后注入 NativePlan/rights/impact，adapter 明确拒绝
   缺失或不一致，EnginePort 方法数不变。
2. **MAJOR：outbox id 与幂等 response 容易被拆成两次事务。** 冻结 `commitAdoption` 顺序：同一
   `BEGIN IMMEDIATE` 先插入 outbox 取得真实 row id，再构造完整 response，随后 ledger、impact CAS、idempotency、
   pointer/revision/transaction 一起提交；任一失败整体回滚。

确认：现有 OperationIdempotencyStore 支持外层事务的 recall/record；ImpactStore 有 active CAS；SnapshotStore 能先
发布 immutable staged snapshot；缺口均可增量实现，不需要替代项目或破坏 M2/M3/M4A。

## 第三轮：完整体验、测试与证据可审计性

结论：最初发现 2 个 MAJOR、1 个 MINOR，已闭环；`BLOCKER=0 / MAJOR=0 / MINOR=0`。

1. **MAJOR：在 M4B tip 要求 M4A current-tip integrity 为 0 不可能成立。** M4B 合法开放 edits 并移动代码；强行调绿
   会篡改历史门。修订为 M4B-0 新增 `evidence:wave2:m4a:historical`，从冻结 tree 校验；current-tip 非零原样记录。
2. **MAJOR：TX-11 容易越界偷开 M6 render route。** 修订为测试 harness 调固定上游 renderer 并完整 decode，明确
   生产 render route 继续关闭。
3. **MINOR：旧架构写 1 MiB body，真实 Host 为 64 KiB。** `02_ARCHITECTURE_AND_CONTRACTS.md` 已同步 64 KiB，
   禁止为对齐旧文放宽入口。

逐 case 不再用总数替代，故障矩阵覆盖 source publish point 前后和 DB commit 前后；真实三镜、重开、改单镜、
双采用、幂等、commit-time source/rights/lock 漂移都有直接门。headed/human 明确 NOT_RUN，自动化仅 headless、
静音、无窗口、不读取 `J:\`、不联网/付费。

## 可视化验证

- Archify sequence showcase validate：9/9 artifact checks，composition errors=0、warnings=0；
- deliver：spec SHA256 `5f51e9538736ea8bc01bdb321ff27c9f172c752931e38075e203f86898fb3cda`；
  HTML SHA256 `8cffac880dd3a5622c8cb1f57c8706dab43ca49b193359fd6ad7e4593f922f38`；
- automated browser visual-check：`SKIPPED`，本机无 Chrome/Chromium；没有伪称浏览器或人类视觉通过。

## 最终判断

M4A 已在外审记录提交 `cac16d754deafe93c468519d82c7860ec2a40b74` 取得
`M4A_EXTERNAL_REVIEW_PASS`。首次 M4B 外审随后发现 1 BLOCKER / 3 MAJOR / 16 MINOR；本文件前三轮内部结论不再
被用作开工依据。第四轮修订已明确：M4B 专用恢复先于通用 journal recovery 且不扩张 terminal attention；
film=after/DB 未提交的 423 与同 key 收敛语义；transaction 三列 + immutable fact 的恢复判据；固定三条
`OpenFilmOp.insert` 生成机制；以及外审列出的接口、route、命令、错误码和证据细节。必须以第四轮独立复审
`BLOCKER=0 / MAJOR=0` 才允许开工。

## 第四轮：首次外审问题闭环

- BLOCKER-01：不新增 `recovering/attention` 出边。Host 启动先执行 M4B 专用恢复，再执行通用 recovery；可证明
  before 从原合法前态 abort，可证明 after 从原合法前态 commit，不可证明才进入 terminal attention。
- MAJOR-01：source 已 after、DB 未 commit 时不返回虚假 500；能立即收敛则 200，否则 423，同 key 后续不再次
  stage/publish并完成唯一 commit。
- MAJOR-02：`adoption_transaction_fact` 完整 DDL、单次插入时点、不可变边界已冻结；恢复以 transaction
  before/after/snapshot 三列与当前 bytes 为准，不用 timestamp 猜 rename。
- MAJOR-03：adapter plan 固定把三个 NativePlan clip 映射为三个 closed insert op，stage 只在 isolated root 调
  pinned upstream；op golden vector 与真实三镜渲染为 M4B-1 门。
- MINOR-01..16：错误优先级、operation kind、精确 route inventory、命令表、SHA 角色、模块路径、intent/plan
  形状、openFilmRoots/digest 重算、rights/lock/binding API、commitAdoption 禁止嵌套事务、case 全表、错误码与
  journal 独立提交均已落盘；native history reason 的 M4C 防呆文字列为 M4B-1 首个红灯修复，不提前改生产代码。
