# M2.2 内部四视角审查

审查对象：`5e4c075`（模块 1–6 完成后的冻结候选）
审查人：实现会话。**不得**签署独立外审。
基线：M2.1 第三轮独立复审 PASS（`ca7dbf3`，声明 `M2_1_CONTROL_BOUNDARY_READY`）。

## 0. 门禁（实际执行）

| 命令 | exit | 结果 |
|---|---|---|
| `corepack pnpm check` | 0 | **34 files / 344 tests**，tsc + 生产 build；连续三次全绿 |
| `corepack pnpm test:m2.1` | 0 | M2.1 回归保持通过 |
| `corepack pnpm test:contracts` | 0 | — |
| `corepack pnpm check:m2.1-docs` | 0 | PASS |
| `python3 -I …/source-digest-v1.golden.py` | 0 | 10/10 |
| `bash tools/m2.1-gate-mutation-check.sh <tmp>` | 0 | **20/20 GATE_BITES**（MUT-A..L、M/J/S/T/R/Q/O/P） |
| 真实 OpenFilm 上游探针 | 0 | 12 checks PASS |
| 两个外审复现实验 | 0 / 0 | 均 `passed=true` |
| `node tools/m2.1-evidence-integrity.mjs` | 0 | 见 M2.1 证据 |

## 1. 架构视角

| 检查 | 结论 |
|---|---|
| 第二 actor / 第二项目写队列 | 无。`ProjectCoordinator` 持有 Host 单例 `ProjectOperationQueue`，`/edits` 全部经协调器 |
| 第二个数据库 | 无。M2.1 的 `engine_binding` 已并入 `RevisionStore`；fitness 断言 `src/**` 仅一处 `new DatabaseSync` |
| 第二套状态机 | 无。`project_transaction` 唯一权威，11 处旧任意 UPDATE 已改为带前态的 `advanceJournal`；job 状态由 `job-defaults.ts` 的转换表唯一声明 |
| 第二份可写时间线 | 无。`EngineProjection` 仍是只读投影，不落库 |
| adapter commit | 无。fitness 断言 `ProjectWriteActor` 内无 `transition`/`advanceJournal`/lease/reaper |
| commit 不确定 | 进入 attention，不猜成功 |

**已记录的缺口（不是隐藏，是本 ticket 的已知边界）**：

- **AC-005 部分满足**：legacy Hypit edit 仍由 actor **就地**改写 author source，协调器随后把提交后的字节**捕获**为 snapshot 并建立 `active_commit` 指针。即 snapshot 是事后捕获，不是「先在隔离 stage 生成再原子发布」。保持这一点是为了不改动 D3/D4.2.1 已验证行为（AC-019）。完整的 stage→snapshot→指针流程随 M2.3 迁移副本与 M4A 采用落地。**不得**把 AC-005 表述为已满足。
- **duration / narration 锁的集成层未验证**：M2.2 没有任何 typed edit 能改变时长或旁白（`replace_visual_asset` 要求资产帧长**恰好等于**选区）。分类器以合成载荷单测，集成层标 `NOT_APPLICABLE_APPROVED`，不留空白格冒充通过。
- **`render` / `snapshot_publish` 无 runner**：M2.2 只保证其存储、lease、事件、恢复与 NOWRITE 语义，端到端产出属 M6。

## 2. 实现视角

- 事务状态机：`transition()` 把前态写进 `WHERE` 并断言 `changes===1`；`recovering` 只能经 `markRecovering()`，在线代码不可达。
- 锁：分类器是纯函数，读的是 `active_commit` 解析出的**已提交**投影；`preserve` 只写进 `reason`，MUT-R 把检查改成看 reason 文本后套件失败。
- 快照：staging→逐文件 fsync→自底向上目录 fsync→rename→父目录 fsync；任一步不可证明则**完全不发布**（含撤销已发生的 rename）。
- Job：CAS lease；失 lease 回队列或进 attention，**绝不** succeeded；未知费用保持 unknown；晚到结果 quarantine。
- Outbox：消费者组合期注册；先查 `outbox_delivery` 再调 handler；全消费确认才关闭；上限关闭时留原因并置 attention。

**本轮被测试抓出并修复的真实缺陷**（10 项）：

1. `markAttention` 被改成要求 journal 行 —— **回归**，破坏外部变化在事务存在前置 attention 的路径。已改回容忍缺失/终态行，并先确保 project 行存在。
2. 协调器初版两个 helper 是空壳，会让 stale-base 检查成为永假门。已改为注入真实 source/digest 解析器。
3. fitness 规则把 WHERE 子句里的 `state='running'` 误判为写 state。
4. 快照重复发布同内容 `ENOTEMPTY` 失败（应为幂等空操作）。
5. 父目录 fsync 失败后留下无指针的已发布目录。
6. 复制完整性守卫无 seam 不可测（`copy` 现可注入）。
7. reaper 只丢 lease 不回 `queued`，孤儿任务永远无人再取。
8. `comparison_id` 与 `error` 未持久化，两个 legacy HTTP 测试变红。
9. 关闭 Host 时在途 job 触碰已关闭数据库。
10. `recordDelivery` 数的是已记录行数而非已注册消费者数，单消费者事件永远不关闭、无限重放。

## 3. 测试与证据视角

- **逐 case**，不以总数代替：JB-01/02/03/04/05/07、LOCK、SER、SNAP、DUR、JRNL、BYP、AT-CONTRACT-01、AT-E2E-01、ER-M-01。
- **变异门 20/20**，每条指向生产路径上承载该行为的那一行；两条变异最初未生效，均已定位并修正目标（MUT-D 锚点失效、MUT-I 打到已冗余的代码、MUT-Q 与 MUT-O 覆盖不到），不是靠改测试绕过。
- **发现并修复的假绿灯**：MUT-Q 移除网关检查后无测试变红——网关拒绝路径不可达。补「把项目绑到 OpenFilm 再请求写片」后才真正失败。
- **发现并修复的套件不稳定**：全量并行下约一半概率出现 1 条超时。根因是快照测试为 fsync 六个文件却复制了 **135 MB** 的 D1 fixture。改用 8 KB 专用 fixture 后连续三次全绿，且**没有**放宽任何超时预算。
- Mock 边界：协调器测试用 actor 桩只验证协调器自身规则（并断言"门在 actor 之前"是断言而非假设）；actor 行为由 D3/D4.2.1 套件覆盖。
- headed / human：`NOT_RUN`；本轮无任何 UI 自动化。

## 4. 验收与声明视角

- 门限：`M2_2_DURABILITY_READY`。
- 保持关闭并有断言：materialize / adopt / impact / migrate-copy / history restore 仍 404；虚构 operation 仍 422 且项目 bytes 不变。
- 未宣称：M2 完成、Gate D4.2、`Gate V1-P0`、`V1-Full`。
- 未进入 M2.3、M3、M4。

## 5. 结论

- BLOCKER = 0
- MAJOR = 0
- MINOR = 3（AC-005 事后捕获、duration/narration 集成层 `NOT_APPLICABLE_APPROVED`、无 runner 的 kind）——三项均为已如实声明的范围边界，不是未发现缺陷。

**实现层结论：PASS，可提交冻结候选交独立复审。独立复审 PASS 前不得进入 M2.3。**

## 6. 残余风险

1. AC-005 的 stage→snapshot→指针尚未端到端成立（见 §1）。
2. Windows/WSL 上目录 fsync 语义未在本环境验证；不可证明时进入 attention 是设计意图，但平台行为需 M2.2 独立复审在目标平台复核。
3. `recovery.attention` 在 `outbox` 上以伪 project id 记录，真实接入属运维接线。
4. M2.1 与 M2.2 的 fitness 分处两个文件；合并为一个总门属后续整理。
