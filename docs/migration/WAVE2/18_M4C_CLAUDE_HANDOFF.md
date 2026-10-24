# Claude Code 交接：M4B 独立外审后连续实现 M4C

以下正文可直接复制给一个全新 Claude Code 会话。

---

你是 Narralens Wave 2 收口实施负责人。先独立外审 M4B 冻结候选；外审 PASS 后连续实现 M4C，不在模块检查点停下。
只在高风险人工裁决、不可恢复外部阻塞或 M4C 完成并冻结到 Codex 独立复核点时停止。

## 现场与基线

仓库：`/mnt/c/workspace/videoworkline/Narralens`

- 预期分支：`migration/m2.2-coordinator-persistence`
- M4B 内部冻结候选：`docs/evidence/WAVE2/evidence-manifest-m4b.json` 的 `capture_commit`（M4B 外审经过多轮修复与重新捕获；不要硬编码某个提交，用 manifest 读当前值）
- M4B 证据捕获提交：`docs/evidence/WAVE2/evidence-manifest-m4b.json` 的 `capture_commit`（不要硬编码）
- origin/main：`304c89134fdf9f834f7d69e3f4d5c89a68044c60`
- OpenFilm upstream：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`
- Hypit upstream：`6fdd8c0f02c17b9970aee6deb4550a70e9d57acf`

先只读输出完整 HEAD/branch/status/remotes/merge-base。当前 HEAD 应包含 Codex 的 M4C 文档冻结提交，不能 reset 回
M4B frozen（manifest 的 `capture_commit`）；用 ancestry/diff 验证从 M4B frozen 到当前仅有文档/diagram 变化。保护所有用户工作，不 reset/stash/
force push，不改 origin/main，不覆盖旧 evidence。

完整阅读顺序：

1. `docs/migration/WAVE2/00_READ_FIRST.md`
2. `docs/migration/WAVE2/ADR-W2.0-006-m4c-history-restore.md`
3. `docs/migration/WAVE2/17_M4C_DEVELOPMENT_GATE.md`（本轮直接权威）
4. `docs/migration/WAVE2/16_M4C_HISTORY_RESTORE.html` 与 `.sequence.json`
5. `docs/migration/WAVE2/02_ARCHITECTURE_AND_CONTRACTS.md`
6. `docs/migration/WAVE2/03_DEVELOPMENT_AND_ACCEPTANCE_PLAN.md`
7. `docs/migration/WAVE2/12_M4B_DEVELOPMENT_GATE.md`、`14_M4B_DOCUMENT_REVIEW.md`
8. `docs/evidence/WAVE2/evidence-manifest-m4b.json`、`cases/m4b-cases.json`、`reviews/internal-review-m4b.md`
9. 当前 `docs/03_Architecture.md`、`docs/11_V1_Traceability.md`
10. 真实 SnapshotStore、RevisionStore、ActivatedProjectionService、AdoptionCoordinator/Store/Publisher、ImpactService/
    Store、ProjectResolver/Coordinator/Queue、LockService、EnginePort、NativeWriteGateway/registry、OpenFilm adapter、server、
    schema/validator/package scripts 与 M4A/M4B tests/evidence。

事实冲突按“当前源码/数据库约束 → 已冻结真实证据 → M4C gate/ADR → 总架构/追踪 → 旧草案”裁决。任何会改变
内容寻址 snapshot、单 revision、单 timeline、EnginePort 7 方法或发布原子性的冲突必须停给人类；普通实现差异记录后
按最新门修复。

## 第一步：M4B 独立外审

你不是 M4B 实现会话，可签 M4B 外审，但必须绑定 manifest 记录的 `capture_commit`（当前捕获提交），不能仅复述报告：

1. 验证 frozen/capture ancestry、工作树与证据摘要；
2. 运行 `pnpm test:wave2:m4b`、M4B integrity、全量 check/build、凭据扫描及关键真实上游/真实媒体链；
3. 重点审查 source publisher 原子性、prepared recovery、commitAdoption 单事务、projection fact、final rights/locks/source
   rechecks、failure replay、三 clip 原生性；
4. 在 `docs/evidence/WAVE2/reviews/m4b-external-review-claude.md` 记录逐 case 与 BLOCKER/MAJOR/MINOR；
5. 只有 BLOCKER=0/MAJOR=0 才写 `M4B_EXTERNAL_REVIEW_PASS` 并进入 M4C。

若发现 BLOCKER/MAJOR：在 M4B 范围内根因修复、增加会在旧实现失败的回归、重捕获；随后启动一个新的干净上下文
只读复审修复后 frozen commit。不得由修复上下文自签。超过两轮返工主动做共同根因闭环，不机械退回。

## 唯一开发范围

外审通过后只实现 M4C：HistoricalSnapshotResolver、HistoryRestorePlanV1、restore impact、三类锁/consumer diff、
HistoryStore/HistoryService、history restore/undo/redo translation、history route、原子发布/commit/recovery、真实链与证据。

禁止 M5 UI、M6 production render、provider/联网/付费/外传、读取 `J:\`、删除 Hypit/旧 snapshot/旧证据、第二 timeline/
DB/revision、任意 native op、直接 pointer rewind、递归覆盖 active root、重写已通过 legacy actor。

## 不可协商合同

1. 相同内容复用 content-addressed snapshot id；restore 新增 commit/revision/outbox/transaction，不随机造 snapshot id。
2. 目标 snapshot 必须同项目、committed、磁盘 closure/digest/upstream projection 可证明；跨项目与不存在同 404。
3. restore impact 使用真实 `HistoryRestorePlanV1.plan_sha256`，按当前 rights/locks/source/base/control 重新计算。
4. diff 精确分类 visual/narration/duration 与 consumers；未知 diff 422，不用全锁掩盖。
5. EnginePort 仍 7 方法；adapter 只 stage/validate；Host 独占 transaction/locks/revision/publish/commit。
6. active source 只安装缺失内容寻址资产并原子替换 film.html；非 film 可变 roots 不同则本阶段 fail closed。
7. `project_transaction.state` 唯一；`history_restore_fact` 只是不可变恢复事实且与 prepared 原子写入。
8. `commitHistoryRestore` 一个 BEGIN IMMEDIATE 完成 project CAS/revision+1、impact consumed、snapshot/projection exact
   insert-or-verify、active pointer、outbox real id、idempotency response、transaction committed。
9. 同 kind/key/digest 重放零二次 stage/publish；异 digest 409；adopt 与 restore key namespace 分离。
10. native restore/undo/redo 只翻译成 typed intent，仍需 impact+approval；checkout/merge/discard/commit blocked。
11. prepared 前取消丢弃晚到结果；prepared 后必须恢复收敛，不把客户端断开变成半发布。
12. production render route 保持关闭；TX-12 只关闭 snapshot immutability subset，不冒充 M6。

## 连续实施顺序

严格执行 `17_M4C_DEVELOPMENT_GATE.md` 的 M4C-0→6：先红灯与合同，再 resolver，再 plan/impact/locks，再 store/
translator/stage，再 publisher/commit/route，最后 recovery/concurrency/真实媒体/evidence。每批先写会在旧实现失败的测试，
通过受影响回归后自动继续；不得先实现后写同义“绿灯测试”。

必须逐项关闭 gate §8 的 20 个 case；不得用总数替代。真实链至少为：固定 fixture migrate →
真实 materialize/impact/adopt → 新 restore impact → restore → Host 关闭重开 → inspect 三个原生 clip → 改中镜且两侧 identity
不变 → 测试 harness 固定上游 render/完整 decode。不得调用 provider，不用 flattened MP4 冒充编辑工程。

故障注入覆盖 received、preconditions、resolve、plan、stage、validate、snapshot publish、prepared、asset install、film fsync/
rename、active inspect、DB 每个关键语句、outbox、response。每点记录 source/revision/pointer/impact/idempotency/outbox/
temp/snapshot 差异。无法证明 publication 状态进入 attention，不猜。

## 测试与证据

自动化全部 Headless、静音、隔离、无窗口、不抢焦点；不启动 headed Chrome。不得放宽 timeout/assertion、删除/skip
旧测试、用总数代替逐 case、用 mock 替代所有真实 filesystem/SQLite/upstream/media。

最低命令以 gate §9 为准，并必须实际新增/运行：

```bash
corepack pnpm test:wave2:m4c
corepack pnpm evidence:wave2:m4b:historical
corepack pnpm evidence:wave2:m4c
corepack pnpm evidence:wave2:m4c:integrity
```

加上 tsc、contracts、m2.1、w2.0、m3、m4a、m4b、fitness、check、build、Wave1 historical/current-tip、credential
scan。历史 current-tip integrity 因后续合法代码变化非零时必须保存原始输出并配 historical PASS，不能调绿。

证据追加到 `docs/evidence/WAVE2/`，捕获目录只追加。manifest 绑定 clean capture commit、完整 repo/upstream SHA、
环境、命令/exit/计数、case、artifact SHA256、声明限制。实现期失败捕获原样保留。

## 审查、冻结与停止

做四个独立视角内审：架构/合同、实现/并发/恢复、完整体验/安全、测试/证据。关闭全部 BLOCKER/MAJOR；MINOR 明确
有界。冻结 clean capture 与 candidate；实现会话不得自签 M4C 外审，不进入 M5。

最终报告必须列：branch/full HEAD/origin/upstream/working tree、提交序列、M4B 外审、改动/未改动、逐 case、命令与
exit、真实媒体/SHA、故障矩阵、NOWRITE diff、内审、证据路径、回退、已知边界、下一允许 ticket。最高声明
`M4C_INTERNAL_EVIDENCED`；不得声明 Wave2 组合 PASS、Gate D4.2、V1-P0、V1-Full 或 headed/human 已验。
