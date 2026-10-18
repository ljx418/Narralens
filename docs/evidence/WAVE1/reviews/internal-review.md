# Wave 1 内部四视角审查

审查对象：Wave 1 组合候选 `cb87a2c`；外审后修复/冻结代码 `e2dec5c`；证据捕获提交 `fd64762`
分支：`migration/m2.2-coordinator-persistence`
审查人：实现会话。**不签署独立外审。**
范围：M2.1 引擎治理 + M2.2 一致提交/三类锁/持久任务 + M2.3 迁移副本与可验证回退。

## 0. 门禁（最终组合捕获 `logs/e2dec5c/`）

| 命令 | exit |
|---|---|
| `corepack pnpm check` | 0（38 files / 383 tests，连续多次全绿） |
| `corepack pnpm test:contracts` | 0 |
| `corepack pnpm test:m2.1` | 0 |
| `vitest tests/m2.2` | 0 |
| `vitest tests/m2.3` | 0 |
| Python 黄金向量 | 0（10/10） |
| 变异门 `tools/m2.1-gate-mutation-check.sh` | 0（20/20 GATE_BITES） |
| `corepack pnpm check:m2.1-docs` | 0 |
| `corepack pnpm evidence:wave1:integrity` | 0（6/6 PASS） |
| `evidence:m2.2:integrity` | **1（信息项）** |

**关于最后一项**：M2.2 的完整性校验断言「M2.2 冻结之后没有代码变化」，而 M2.3 是在其上构建的，
因此它按预期报告了移动。其输出逐字记录在 `logs/e2dec5c/m2.2-integrity.txt`，未把门调绿，
manifest 的 `claim_limits` 明确写出「本组合捕获重跑了 M2.2 自身的门」。该项是 NOTE，不是
Wave 1 组合 Gate 的失败。

## 1. 架构视角

| 检查 | 结论 |
|---|---|
| 第二 actor / 第二项目写队列 | 无。`/edits`、迁移、锁、回退共用单例 `ProjectOperationQueue` |
| 第二个数据库 | 无。`migration` / `migration_step` 表进入既有 `RevisionStore` 的同一个句柄 |
| 第二套事务状态机 | 有意：协调器一套、迁移一套，各自前态校验。二者事务 id 互不重叠，不是同一事实的两个权威 |
| 第二份可写时间线 | 无。`EngineProjection` 只读；迁移副本是三个原生 clip，不是第二条时间线 |
| adapter commit 权 | 无。迁移的 pointer 由 `RevisionStore.commitMigrationTarget` 单事务写入 |
| 双写 | 无。旧项目 bytes / binding / Manifest@2 在全部迁移路径后逐字节不变（MIG-01、EN-03、MIG-05、MIG-06 断言） |
| 回退用 git reset | 无。回退是「停写 + 隔离在途 + 保留新副本 + 重开旧项目」，不改历史 |

## 2. 代码视角

本轮实现中被测试抓出并修复的**真实缺陷**（14 项，摘要）：

1. 变异工具用 `git checkout --` 回滚，会丢弃被测文件的未提交改动 —— 已改为从变异前快照恢复。
2. `markAttention` 被改成要求 journal 行，破坏外部变化在事务存在前置 attention 的**回归**。
3. 协调器两个 helper 曾是空壳，使 stale-base 检查成为**永假门**。
4. reaper 只丢 lease 不回 `queued`，孤儿任务永远无人再取。
5. `recordDelivery` 数已记录行数而非已注册消费者数，单消费者事件永不关闭。
6. 迁移 plan 声明了计划期不可能知道的 `source_snapshot_id` / `target_source_digest`。
7. 迁移副本的 snapshot 按引擎类型推导 roots，去找副本里不存在的 Hypit Run 文件。
8. recovery 无法离开 `recovering`，被打断的迁移永远无法收敛。
9. 副本 identity 依赖幂等 key，同一 source 用两个 key 可被迁移两次。
10. **真实导出立刻证明了结构校验的不足**：迁移出的三个 clip 能被上游解析，但渲染器拒绝 ——
    OpenFilm page clip 必须定义 `window.film.frame()`。仅看结构会交付一个渲染不出来的影片。
11. 服务猜测了一个从未创建的 project root，而不是用自己登记的 root。
12. plan 的字幕摘要是占位空串。
13. `verifyCopy` 曾拿普通 tree hash 去比 snapshot 记录的 SourceDigestV1 摘要，两者永远不可能相等。
14. route fitness 门捕获了我新增的三个迁移路由 —— 这正是它们存在的意义；冻结集合已显式写成四条。

## 3. 体验视角

本波无 UI 改动。自动验收全部 Headless、静音、无窗口、不抢焦点，渲染由固定 argv 的
`openfilm render` 子进程完成（无 shell，参数不可由调用方控制）。headed / human = `NOT_RUN`。

## 4. 验收视角

- 逐 case 记账，21 个 case：20 PASSED + 1 `NOT_APPLICABLE_APPROVED`（LOCK-NA，附理由）。
- 未用测试总数代替逐项证据。
- mock 只出现在协调器层（用于断言「门在 actor 之前」），不用于关闭迁移、原生可编辑、导出或回退 Gate。
- 两个外审复现实验（M2.1 B-02 / M-03）现为可执行脚本，断言的是修复后的行为。

## 4.1 返修中关闭的残余风险

内部审查初稿把「副本根只登记在进程内存、重启后失联」列为残余风险 #4。本次直接修掉：
`listen()` 现在从 migration 记录重新播种副本根，副本在重启后仍可解析。该改动进入组合捕获。

## 4.2 独立外审结论与据此返修

独立干净会话对组合候选 `cb87a2c` 的复审结论：**PASS**（BLOCKER=0、MAJOR=0、MINOR=2、NOTE=2），
并明确「在记录两条 MINOR 后可声明 `CONTROLLED_OPENFILM_READY`」。

据此在声明前修完：

| 外审项 | 处置 |
|---|---|
| F-1 `MigrationService.recover()` 只在测试里跑，生产 `listen()` 未接线 | 已接线：`listen()` 现在调用 `recover()`，被打断的迁移在重启时收敛为完成 / 可重试 / attention |
| F-2 `before_report` 崩溃边界声明但从未命中 | `execute()` 现在真的在该边界崩溃，crash 矩阵由 8 个边界增至 9 个 |
| 残余 #7 回退时源工程导出用的是摘要标签，不是真实渲染 | 已修正：导出回调现在接收**引擎**，回退时用源工程自己的引擎；并明确写出 **不宣称** 对 Hypit 源工程做新鲜渲染（其 Build 需外呼与付费，本波未获授权），源工程以字节一致、绑定与既有 D1 产物证明 |

## 5. 结论

- BLOCKER = 0
- MAJOR = 0
- 未关闭 BLOCKER / MAJOR / 外审 MINOR = 0
- 已声明产品边界 = 3；信息项 = 1

**已声明产品边界**：

1. **AC-005 在 legacy Hypit edit 路径仍是事后捕获**。actor 仍就地提交 author source，协调器随后
   捕获 snapshot。保留是为不改 D3/D4.2.1 已验证行为。**迁移路径**才是完整的 stage→snapshot→pointer。
2. **duration / narration 锁集成层 `NOT_APPLICABLE_APPROVED`**。M2.2 无可改变二者的 typed edit。
3. **`render` / `snapshot_publish` 无业务 runner**，只证明存储/lease/事件/恢复/NOWRITE。

信息项：**M2.2 完整性校验在本组合下按预期报 1**（M2.3 已在其冻结点之后继续开发），见 §0。

**最终结论：PASS。独立外审为 PASS（BLOCKER=0、MAJOR=0、MINOR=2、NOTE=2），两条 MINOR 已在
`e2dec5c...` 关闭并完成组合捕获，因此允许声明 `CONTROLLED_OPENFILM_READY`。外审结论记录见
`docs/evidence/WAVE1/reviews/external-review.md`。**

## 6. 残余风险

1. 迁移仅覆盖已盘点的三镜 fixture；未知 feature 直接 blocking，不做通用 Hypit DSL 编译。
2. Windows/WSL 上目录 fsync 语义未在本环境验证；不可证明时进入 attention 是设计意图。
3. 真实导出的覆盖是 1280×720 / 900 帧的短片；长片性能与字幕烧录未在本波验证。
5. 回退的「重开旧项目并真实导出」在测试中由固定 renderer 完成，未覆盖用户手动重开 GUI 的路径。
6. 副本根的登记在本次返修中改为启动时从 migration 记录重新播种，因此副本在重启后仍可解析；
   该播种本身尚无独立测试覆盖。
