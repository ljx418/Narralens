# M4B 独立外审（Claude Code，独立上下文）

审查日期：2026-10-24
审查对象：M4B（`AdoptionCoordinator` / `AdoptionStore` / `AuthorSourcePublisher` 及 M4B 的
`RevisionStore`、`ProjectCoordinator`、OpenFilm adapter 接缝）
M4B 内部冻结候选：`b2a4efb8be7f4b1c02f973ff32ea04b097196649`
M4B 证据捕获提交：`0da4ba23d35f3371ce89572529f4ba20151ca4d8`
审查时 HEAD：`88e5fc008ec4aa0cb2b4cb027d230c0fa61b5610`（与冻结候选之间仅 `docs/` 差异，
`git diff b2a4efb..HEAD -- src/ tests/ contracts/` 为空）

## 0. 方法与独立性

两名独立审查上下文，均为只读、无 M4B 实现上下文，均被要求**不得**先读仓库自带的
`docs/evidence/WAVE2/reviews/internal-review-m4b.md`，先自行从源码得出结论后才可对照并
**报告分歧而非采纳**。两名审查者都独立地跑了 `pnpm test:wave2:m4b`（均 36/36 通过）与
`pnpm test:wave2:w2.0`（14 files / 189 tests 通过），并各自写了复现脚本（写在仓库之外的
`/tmp`，只写 `mkdtemp` 目录）。

**两名审查者独立复现了同一个 BLOCKER**，并且各自用不同的方法（源码路径追踪 + 进程重启
复现；源码路径追踪 + 独立复现脚本）得到同一结论。

## 1. 第一轮裁决

**NOT PASS —— BLOCKER = 1，MAJOR = 6。**

| 视角 | 结论 |
|---|---|
| 原子性与恢复 | BLOCKER 1、MAJOR 1 |
| 合同、边界与证据 | BLOCKER 1、MAJOR 5 |

### 1.1 BLOCKER —— 一旦 M4B 把某个项目锁进 terminal `attention`，Host 永久无法启动

- 位置：`src/host/adoption/adoption-coordinator.ts:197`（`recoverOnStart`）、
  `src/host/projects/project-coordinator.ts:100-103`（`controlledRecovery`）、
  `src/host/projects/revision-store.ts:678-682`（`incompleteTransactions`）。
- 机制：`incompleteTransactions()` 的状态集合包含 `'attention'`；`attention` 在
  `ALLOWED_TRANSITIONS` 中没有出边，是终态；M4B 恢复却会重新进入它。`controlledRecovery`
  在 recovery gate 关闭时抛 423，而该调用位于 `recoverOnStart` 内层 try/catch **之外**，
  于是异常穿出 `server.ts` 的 `listen()`。
- 复现（两次独立复现，两名审查者各一次）：
  `RESTART_1_OK` → `ATTENTION ['of_d1-30s_…']` → `RESTART_2_THREW Another condition blocks
  adoption recovery`。
- 可达性：不止是"无法证明边界"的极端情况。审查者用"外部在 staging 期间改写 active
  `film.html`"这一 TX-13 的普通竞态复现了同一条路径 —— 任何在采用进行期间发生的外部编辑
  都会永久破坏 Host 的启动能力，并带走部署里的**每一个**项目。
- 附带缺陷：失败的采用把 transaction 留在 `prepared` 且 `error_code` 为空，客户端拿到 423
  但没有持久原因，`project_state.attention` 仍为 0。

### 1.2 MAJOR

| # | 摘要 |
|---|---|
| M1 | 在线 "source=after、DB 未 commit" 状态返回 500 `INTERNAL_ERROR`，而门 §7 要求 423 `PROJECT_ATTENTION_REQUIRED`（**不是 500**），且在线路径从不 latch attention |
| M2 | 没有 versioned-edit HTTP 能接管未终结的 M4B 恢复；门 §7 要求"所有 versioned edit HTTP 在处理重放前必须先完成该 project 的未终结 M4B 恢复"与"同 key 请求必须先接管原 transaction 恢复" |
| M3 | 崩溃矩阵只实现门 §7 约 18 个边界中的 8 个；**发布前的 abort 规则完全没有测试**（把 abort 前态列表收窄到只剩 `prepared`，整套 M4B 仍全绿） |
| M4 | "stage 后新取得 visual 锁"的测试无法证伪：锁获取会移动 control revision，currentness 检查先抛 428，`assertUnlocked` 永远到不了 —— 删掉两处 `assertUnlocked` 整套测试仍绿 |
| M5 | `outbox_event_id: 1` 是恒等断言（全新库里第一行恰好是 1），无法区分真实的 `lastInsertRowid` 与一个常量 |
| M6（恢复视角） | 采用的 staging 目录在硬崩溃后永不回收（`finally` 在进程死亡时不执行），且 staging 路径不在不可变 fact 里，恢复也无从清理 —— 无界磁盘增长 |

### 1.3 与仓库自带内审的分歧（记录而非采纳）

内审记录 `BLOCKER=0 / MAJOR=0 / MINOR=3`，并把 terminal attention 描述为"a safe stop"。
**两名审查者都不接受这个定性**：它不是"安全停止"，而是"下一次启动即失败"，且没有操作员
补救路径；内审 §2.2 提到"通用恢复的 pending 门曾挡住 M4B 的精确恢复"，但那个修复并不完整
—— 新增的调用在恢复自身的错误处理之外抛出，把"通用恢复吃掉这行"变成了"Host 起不来"。

内审 §2 的"上述问题均有会在旧实现失败的测试"在 TX-03 锁测试与 `outbox_event_id` 两处不成立。

内审 §4 声称 `evidence:wave2:m4b:integrity` 复核过捕获，但**捕获脚本从未运行该命令**，
仓库里也没有对应日志。

## 2. 修复（M4B 范围内根因修复 + 会在旧实现失败的回归）

全部修复都在 M4B 范围内；每一项都先写好会在旧实现上失败的测试，再改生产代码。

| 缺陷 | 修复 | 回归测试 |
|---|---|---|
| B1 | `recoverOnStart` 跳过已是 `attention` 的行（终态无出边）；`controlledRecovery` 的调用包进 per-transaction try/catch，gate 的拒绝不再穿出 `listen()`；`adopt()` 在证据不可证明时就地 latch terminal attention 并记录原因 | `starts again after latching terminal attention, because one blocked project must not stop the Host`（旧实现上实测抛 `Another condition blocks adoption recovery`） |
| M1 | 在线 prepared 分支把"证据不可证明"与"活的锁冲突"分开：前者 latch terminal attention 并返回 423，后者返回受控 423 且不 latch、不写幂等行；`TRANSACTION_FAILED` 500 只留给"已证明 source 仍 before" | `answers a visual lock held during recovery with a controlled 423 and nothing committed` |
| M2 | `ProjectCoordinator.controlledWrite` 接受 `ignoredTransactionId`；`AdoptionCoordinator.adopt()` 在处理重放之前先接管本 project 未终结的 M4B transaction | `records the source=after / DB-not-committed transition state field by field`（同 key 重试接管并补交为 200） |
| M3 | 新增 6 个发布前缝隙（`after_received` / `after_preconditions` / `after_plan` / `after_stage` / `after_validate` / `after_snapshot_publish`），发布前崩溃由重启恢复收敛为 `aborted` + revision +0 + stage/temp 清理 | `converges the pre-publish crash boundary <boundary> to aborted with revision +0`（6 例） |
| M4 | 锁检查移到 currentness 检查**之前**（在线与恢复两条路径），visual 锁因而以 `TARGET_LOCKED` 报告而不是被 control revision 抢先；锁分类证明"preserve narration 不过度阻塞" | `rejects a visual lock acquired after staging with revision +0`（期望 423 TARGET_LOCKED）、`does not over-block an adoption that preserves narration while a narration lock is held` |
| M5 | 先插入一行 outbox，再断言 `outbox_event_id` 等于**携带本 transaction 的那一行**的 `event_id` 且 > 1 | `commit-adoption.test.ts::commits revision, pointer, impact, projection, outbox and replay response exactly once` |
| M6 | 启动时清扫 staging 根下所有 `adopt-*` 目录；staging 根改为每 Host 隔离（否则一个 Host 的清扫会删掉另一个 Host 正在使用的树） | `sweeps an adoption staging tree left behind by a hard crash` |

另外关闭的 MINOR：

- projection fact 的 `frame_count` 改为**采用源自身的长度**（native plan 的 `total_frames`），
  不再是项目 frame_count 的副本 —— 原先的守卫在拿副本和它的来源比较，是空转的；
- `openfilm_projection_fact` 的**生产写入路径**改为走已导出的 `assertProjectionFact`，
  此前的校验代码存在却从未被执行；
- `m2.2-fitness` 的 M4B 豁免从"按方法名全局豁免"收窄为"按文件豁免"；
- publisher 测试的误标名修正（`../escape.mp4` 是被内容寻址 token 规则拒绝，不是 realpath
  包含检查），并补了真正的"非内容寻址 token"用例与"发布失败后 temp 被清理"用例；
- 捕获脚本现在**自己**生成 manifest 并运行 `evidence:wave2:m4b:integrity`，把结果落盘；
  内审那条无日志的声明因此有了产物。
- `evidence:wave2:m4b:integrity` 的检查器增强：现在校验 case 文件里**具名的**测试引用
  真实存在（支持 `it.each` 与模板字符串两种形式），不再只校验文件路径。

## 3. 重新捕获

修复后的 M4B 证据在下一节记录的提交上重新捕获；捕获目录只追加，旧捕获与其失败记录原样保留。

## 4. 裁决

**第一轮：NOT PASS（BLOCKER=1，MAJOR=6）。**
**修复后：由一个全新的独立上下文复审修复后的冻结提交，见第 5 节。**

实现会话不得自签本模块的外审；第 5 节的裁决由另一个干净上下文作出。

## 5. 修复后的独立复审（全新上下文）

> 本节由修复完成后的**全新独立上下文**复审填写。该上下文没有参与第一轮审查，也没有参与
> 修复，因此它对修复后代码的结论不来自任何既有的结论。

见下文（由复审上下文产出）。
