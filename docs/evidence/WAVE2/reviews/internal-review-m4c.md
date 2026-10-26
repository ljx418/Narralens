# M4C 四视角内部审查

状态：`BLOCKER=0 / MAJOR=0 / MINOR=11`。本结论只支持 `M4C_INTERNAL_EVIDENCED`；独立外审仍为 `REVIEW_PENDING`。

审查对象：`src/host/history/`（`HistoricalSnapshotResolver`、`HistoryRestorePlanV1` 与 builder、`HistoryStore`、
`HistoryCommandTranslator`、`RestorePlanner`、`HistoryService`、`history-fault-registry`）、OpenFilm adapter 的 restore 分支、
生产 Host 路由与装配、`RevisionStore.commitHistoryRestore/abortHistoryRestore`、impact 的 restore arm、
`history_restore_fact`、M4C 合同与测试。基线为已通过外审的 M4B（第十轮 `M4B_EXTERNAL_REVIEW_PASS`，
BLOCKER=0 / MAJOR=0）与 Codex 对 M4C 冻结候选 `62b804e` 的 `NOT PASS`（BLOCKER=1 / MAJOR=5）。没有改写
Wave 1/M3/M4A/M4B 历史证据。

本轮四个视角由三个独立审查会话分别走查（架构与合同、体验与安全、测试与证据），并发与恢复维度由实现会话
逐条复核。审查在仓库上只读；所有实证都在仓库之外的 scratch 副本里跑。

## 0. 本轮关闭的 Codex 发现

| 编号 | 结论 | 依据 |
|---|---|---|
| **B-01** snapshot `source/` 符号链接逃逸 | **关闭** | `historical-snapshot-resolver.ts` 分三件事：snapshot 目录的 canonical 路径必须在项目 snapshot root 内；`source` 用 `lstat` 判定、是链接即拒（Linux symlink 与 Windows junction 都被捕获）；canonical `source` 必须在 canonical snapshot 目录内。目录树内部每个实际读取项仍由 `SourceDigestV1` 的 realpath + containment 兜住。回归测试真的构造逃逸（`source` 软链到项目外目录、外部字节与数据库 digest 完全匹配、把项目自己的 committed transaction 指向它），并断言拒绝路径上 source/revision/pointer/impact/outbox/idempotency 全部未变。**变异证明**：把 resolver 回退到 `5ac1402` 的版本，该用例变红（外部目录被接受）。 |
| **M-01** redo 的 current-commit 语义 | **关闭** | `HistoryStore.redoTarget()` 改为锚定 `activeCommit(projectId)`：当前 commit 必须是 committed 的 kind=history restore，且其不可变 fact 存在，否则无 redo 目标 → 422。路由级负向回归覆盖「restore → adoption → redo = 422、revision +0」与「紧邻 restore 的 redo 仍命名 source-before」。**变异证明**：回退 `history-store.ts` 到 `5ac1402`，该用例变红。 |
| **M-02** 锁模型与 ADR D-04 对齐 | **关闭** | `history-restore-plan.ts`：内容/asset/fit/time 改变 → 当前 clip 的 visual **shot** 锁；clip 增删、重排、边界或总帧数改变 → **visual project + duration project** 锁；narration/audio → narration project；subtitle → narration project + subtitle consumer；shared asset → 全部消费者 + 其实际视觉影响的锁。四类拓扑各有正向用例，另有两条用**真实 LockService** 证明这些锁确实阻断写入。**变异证明**：回退 plan 到 `5ac1402`，这些用例变红。 |
| **M-03** `HistoryRestorePlanV1` 的唯一权威 shape | **关闭** | 实现回归冻结 ADR D-03 的形态，逐字段对齐；`affected_ranges` 进入被哈希的 preimage（`historyRestorePlanPreimage` 取整个 plan 去 hash ✓）；旧实现里「在 plan 之外另算 ranges」的第二份拷贝已删除，impact 直接取 `context.plan.affected_ranges`。16 个冻结向量 + 独立 Python 实现逐字节一致。**变异证明**：把 `affected_ranges` 从哈希输入里摘掉，「reproduces every vector's hash and preimage byte for byte」变红。 |
| **M-04** 逐边界故障矩阵 | **关闭** | 见 §4。 |
| **M-05** 三份权威文档同步 | **关闭** | `docs/03_Architecture.md`、`docs/11_V1_Traceability.md`、`docs/migration/M1/route-inventory.md` 按真实状态改写：M4B 第十轮 PASS、M4C 已实现且外审返修中、四条 history 路由的真实注册与语义、headed/human `NOT_RUN`、Gate D4.2 与 Wave 2 与 V1-P0/V1-Full 未关闭。审查中发现 `03_Architecture.md` 仍有两处「restore 的 impact capability blocked」的自相矛盾陈述，已一并改正。 |

## 1. 架构与合同

- 十二条冻结合同逐条成立（内容寻址复用、revision +1、目标同项目/已 committed/可证、impact 携带真实 plan hash、
  差异分类到三类锁与 consumer、EnginePort 仍七方法、adapter 只 stage/validate、唯一状态机、单事务提交、
  同 key/digest 重放而异 digest 409、undo/redo 只翻译、prepared 前取消丢弃晚到结果而 prepared 后收敛）。
- 单一权威未变：一个 SQLite、一条 revision 标度、一条时间线、一张 `operation_idempotency`、一张
  `openfilm_projection_fact`（PK=snapshot_id，"存在则逐字段一致，不存在则插入"）、一个状态机
  （`project_transaction.state`；`history_restore_fact` 无 state 列，UPDATE/DELETE trigger 齐备）。
- 计划合同只有一份：`HistoryRestorePlanV1` 即 ADR D-03 冻结的形态，canonical preimage、黄金向量、Python 独立实现、
  impact 的 `native_plan_sha256` 与完整性门四处同源。
- 「锁模型描述差异」与「本阶段可否恢复」的分界清楚且已实现：builder 描述 clip 增删（project 级锁），
  `restoreTargetIsEligible` 与 planner 决定本阶段是否允许恢复（422）。

**MINOR-1**：`history_restore_fact` 的 DDL 是 ADR D-06 字面 DDL 的超集（多 `project_id`、`impact_id`、
`impact_hash`、`rights_digest`、`required_locks_json` 五列）。这五列都是**事实**（授权身份与锁范围），
没有绝对路径、request body 或状态枚举，符合 D-06 的禁止项；但 ADR 未被修订，本轮**有界接受**并在代码里写明理由，
未静默偏离。下一步应由 ADR supersession 记录。

## 2. 实现、并发与恢复

- 步骤顺序仍是门 §4 的顺序，每一步的前提在下一步假设它之前确立。
- 发布仍然原子：复用 M4B 已验证的 publisher 算法（事务域临时 token、同目录 rename、fsync）。本轮为
  「film rename 前」新增了一个边界缝，M4B publisher 的冻结顺序断言随之**变长**（仍钉住完整顺序，未放宽）。
- 单事务提交仍是一个 `BEGIN IMMEDIATE`；本轮为 9 条语句各加了前后缝，故障落在任一语句之间都会整体回滚。
- 恢复在「发布已发生、提交未发生」时收敛为唯一一次 commit；发布前则 abort + revision +0。
- ADR D-05 的第一类允许变更（安装目标引用而 active root 缺失的内容寻址资产）**本轮实现**了——此前实现是拒绝，
  这也是 publisher 的 asset install 边界此前不可达的原因。
- 取消：prepared 前 abort + revision +0，晚到的 stage 结果既不 prepare 也不 publish（无不可变 fact、无 snapshot）；
  prepared 后收敛。

**MINOR-2**：fact 里持久化的 `required_locks_json` 无法用 `restore_plan_sha256` 复算——恢复路径重建不出计划
（发布后 current source 就是 target，差异按构造为空），所以必须有一份可检查的锁范围副本。它不是第二权威
（fact 不可变、单写者、与 plan hash 同事务写入），但值得在 ADR 里写明。

**MINOR-3**：`restore_plan_sha256` 与 fact 的锁列表之间的绑定目前由恢复路径的代码保证，不是由 hash 保证。
若将来有人重建计划并只比 hash，锁列表仍会来自 fact，可接受；但 ADR supersession 应写明。

## 3. 完整体验与安全

- 用户路径真实存在：旧 snapshot → 在**当前** rights/locks 下计算 impact → 确认 → 旧内容成为当前 revision →
  影片仍是三个原生可编辑 clip（`shot-001/002/003`，无 media src）；重启后旧 snapshot 的字节不变。
- undo/redo 仍然只翻译：返回 `narralens.history-intent@1.0`，不写 source/revision/pointer，仍需新 impact 与显式 approval。
- 权威边界：请求体封闭（`additionalProperties=false`），客户端只能提交 target snapshot id、impact id/hash 与
  `approval.confirmed`；不能提交路径、URL、shell 参数、rights 事实、impact 事实、锁范围。reviewer 用 10 个对抗向量
  实测：symlink 的 `source` 目录（指向项目外/项目内）、source 内的 symlink 文件、被引用的 symlink 资产、
  snapshot 根本身是 symlink、跨项目 snapshot、客户端用 `../../../../etc` 当 id、越界 root、绝对路径 root，
  全部被拒（422/404），合法快照正常解析。
- 声明天花板：全仓扫描未发现 `WAVE2_EDITABLE_ADOPTION_READY`、Wave 2 组合 PASS、Gate D4.2、V1-P0、V1-Full、
  M5/M6 或 headed/human 的越权声明。

**MINOR-4**：narration 的 rights 豁免目前只有代码阅读与形状推理，没有负向用例（让旁白目标的字节与 ledger 记录
不一致）。豁免以精确路径为键，而该路径不可能是内容寻址形态，因此推理是可靠的；本轮**有界接受**为 MINOR。

**MINOR-5**：客户端不能提交锁范围，但 `RestoreRequestV1` 的 schema 也没有显式列出"客户端不得提交"的字段
（`additionalProperties=false` 已覆盖）。有界接受。

## 4. 测试与证据（M-04）

- **枚举式 registry**：`src/host/history/history-fault-registry.ts` 是生产代码里的边界清单——22 个
  service/publisher/adapter 边界 + 单事务 9 条语句各前后共 18 个数据库边界 = **40** 个。
- **矩阵按 registry 行走**，不是代表性子集：`tests/wave2/m4c/history-fault-matrix.test.ts` 逐个注入。
- **双向核对**（本轮新增，且是本轮最重要的修补）：代码里出现而 registry 没有的边界、以及 registry 里有而代码
  走不到的边界，都会让检查失败。审查发现 `before_film_rename` 曾在 publisher 里抛出却没接进映射表，
  矩阵却因为「没触发」走了成功分支而报绿——这正是「把缺口打扮成已覆盖」。现在：映射缺失会抛
  `UNMAPPED_PUBLISHER_FAULT_POINT`，矩阵遇到未声明却未触发的边界直接失败。
- **每个边界断言同一组事实**：source、revision、pointer、impact、outbox、idempotency、temp、snapshot 的
  before/after，并逐边界证明重启后收敛到 committed/aborted——发布前边界 abort + revision +0 + pointer/source 不动
  + impact 保持 active + 无 outbox 行；发布之后（含 film rename 之后与事务内任一语句前后）唯一一次 commit +
  revision +1 + impact consumed + 恰好一条 outbox 行 + 无新增 snapshot。无孤儿进行态、无重复发布、无重复 revision。
- **两个 asset install 边界用专门的前置条件真正触达**（先恢复旧快照 → 删掉已采用的内容寻址资产 → 恢复已采用的
  快照），而不是记成 not_reached。

**MINOR-6**：完整性门原本拿**工作树**里的测试文件核对 case 的引用，因此「引用了捕获时还不存在的测试」不会被发现。
本轮改为从**捕获提交**读取引用文件核对（`git show <capture>:<file>`）：当前这份 manifest（指向返修前的捕获）
因此如实变红，直到新捕获产生为止。

### 4.1 第四个视角（实现、并发与恢复）在本轮之后提出的问题与处置

| 事项 | 处置 |
|---|---|
| M4B 的 publisher 边界序列被本轮改长，M4B 冻结断言未同步 | **已关闭**：M4B 的断言随之变长（仍钉住完整顺序，未放宽），M4B 套件重新全绿 |
| `before_film_rename` 在 publisher 抛出却没接进映射表，矩阵的「没触发」降级分支把它标成绿灯 | **已关闭**：映射表移进 registry（矩阵与服务读同一张表），未映射的边界直接抛 `UNMAPPED_PUBLISHER_FAULT_POINT`；矩阵遇到未声明却未触发的边界直接失败；registry 与生产代码双向核对成为一条测试 |
| 两个 asset install 边界是本轮新增能力的零覆盖路径 | **已关闭**：两个边界用专门的前置条件真正触达（恢复旧快照 → 删掉已采用的内容寻址资产 → 恢复已采用的快照），能力本身另有端到端用例 |
| `stage copy 中` 没有 seam | **已关闭**：adapter 在「树已复制、目标资产已就位、目标 film 未写入」处新增 `during_stage_copy`，与 `after_stage_copy` 一起覆盖门点名的「中/后」 |
| outbox/snapshot 只采集不断言、「attention」收敛从未出现、边界计数写错 | **已关闭**：每个边界都断言 outbox 行数与 snapshot 行数；计数改为真实的 40（22 + 18） |
| 恢复路径的 commit 没有 DB seam | **已关闭**：恢复路径的 `commitHistoryRestore` 同样收到逐语句 seam |
| 恢复只清理 film 临时文件，不清理资产临时文件 | **已关闭**：恢复会按后缀清理 active root 里的资产临时文件 |
| fact 的 `installed_assets` 记的是「意图」而不是「观测」 | **有界接受**：fact 是发布意图的不可变记录，M4B 的 fact 有同样性质；观测值由 publisher 的原子安装保证 |
| 故障模型不是真正的进程丢失（publisher 的 catch 会执行清理） | **有界接受**：M4B 的崩溃矩阵用同一模型；「真实进程丢失」只会让清理更少发生，不会让结论更弱 |
| ADR D-05 字面写 422 `CAPABILITY_NOT_ENABLED`，实现是 422 `UNSUPPORTED_EDIT` | **有界接受**：门 §3.2 只要求 422 fail closed，行为合规；ADR 字面与实现的差异待 supersession 记录 |
| abort 的状态白名单会把范围外的状态静默改写成 500 | **有界接受**：当前几乎不可达（能力检查在开事务之前） |
| 门 §4 的字面顺序与实现不同（目标在 plan 内部解析） | **有界接受**：可观察行为等价（impact 校验只比 id 与 hash） |

### 4.2 本轮新增的用例（缺口的补齐）

| 门点名的项 | 用例 |
|---|---|
| TX-05C 的 stale **base** | `refuses a restore whose base revision is stale, and the revision does not move` |
| M4C-06 的 impact 期漂移 | `refuses the impact when the project's facts moved, and leaves no active row behind` |
| M4C-03 的 Hypit snapshot | `refuses a Hypit snapshot: this stage restores OpenFilm content only` |
| TX-03C 的 narration/subtitle/shared asset 锁 | `asks for a narration project lock when the narration changed, and not for a shot one` 等三条 |
| M-01 的 redo current-commit 规则 | `answers 422 after an adoption has been committed on top of the restore` 等两条 |
| M4C-16 的晚到 stage 结果 | `aborts with revision +0 and publishes nothing`（断言没有不可变 fact，也没有为它发布的 snapshot） |
| D-05 的资产安装 | `installs the missing asset, and refuses one filed under a digest that is not its own bytes` |

### 4.3 本轮审查自身发现的一处声明不实

内部审查初稿在 case map 里写「每个边界都有直接注入与断言」，而当时矩阵对「没触发」走的是降级分支，
这句话当时并不成立。修正的方式不是改措辞，而是改矩阵：未声明却未触发的边界现在让矩阵失败，
并且 registry 与生产代码的双向核对成为一条测试。

## 5. 本轮之前的证据状态与本轮修复

Codex 对 `62b804e` 的 `NOT PASS` 成立。本轮之后：`src/host/history/history-fault-registry.ts` 这个本轮核心新文件
在旧捕获上并不存在，`historical-snapshot-resolver.ts` 的 B-01 修复也不在旧捕获上，因此**旧 manifest 不能证明本轮任何
修复**。本轮修复后的捕获会在干净提交上重跑、重生成 manifest 与内审；在此之前 `docs/evidence/WAVE2/` 处于
「cases 说一套、manifest 指另一套」的状态，**不应被当成已冻结的证据集引用**。

## 6. 有界 MINOR 汇总与处置

| 编号 | 事项 | 处置 |
|---|---|---|
| MINOR-1 | fact 的 DDL 是 ADR D-06 的超集 | 有界接受；待 ADR supersession 记录 |
| MINOR-2 | fact 的锁列表无法用 plan hash 复算 | 有界接受；待 ADR supersession 记录 |
| MINOR-3 | 锁列表与 plan hash 的绑定由代码而非 hash 保证 | 有界接受；待 ADR supersession 记录 |
| MINOR-4 | narration rights 豁缺没有负向用例 | 有界接受（形状推理可靠）；可补一条用例 |
| MINOR-5 | 请求体封闭但未显式列举"客户端不得提交" | 有界接受（`additionalProperties=false` 已覆盖） |
| MINOR-6 | 完整性门原本不核对捕获提交 | **已关闭**：本轮改为按捕获提交核对引用 |
| MINOR-7 | fact 的 `installed_assets` 记的是意图而非观测 | 有界接受：fact 是发布**意图**的不可变记录，M4B 的 fact 同样如此；观测由 publisher 的原子安装保证 |
| MINOR-8 | 故障模型不是真正的进程丢失（publisher 的 catch 会执行清理） | 有界接受：M4B 的崩溃矩阵用同一模型；真实进程丢失只会让清理更少发生，不会让结论更弱 |
| MINOR-9 | ADR D-05 字面是 422 `CAPABILITY_NOT_ENABLED`，实现是 422 `UNSUPPORTED_EDIT` | 有界接受：门 §3.2 只要求 422 fail closed，行为合规；字面差异待 supersession 记录 |
| MINOR-10 | abort 的状态白名单会把范围外的状态静默改写成 500 | 有界接受：当前几乎不可达（能力检查在开事务之前） |
| MINOR-11 | 门 §4 的字面顺序与实现不同（目标在 plan 内部解析） | 有界接受：可观察行为等价（impact 校验只比 id 与 hash） |

Codex 外审提出的其余 MINOR（门自身诊断判定与共享规则的分歧、manifest 生成器的第三份硬编码预期失败集合、
门不检查 manifest 是否覆盖当前树）在本轮一并处理：诊断判定两边都按「排序 + 只认文件」实现；manifest 生成器改用
共享规则读捕获自己的记录；门现在按捕获提交核对引用。

## 7. 声明限制

1. 内部四视角由三个独立审查会话加实现会话完成；**Codex 独立外审未签**，实现会话不得自签。
2. 真实媒体只覆盖固定 900 帧短片，不代表长片吞吐、磁盘压力或生产 render route。
3. M4C 只支持「同一 clip identity 与 track topology、差异落在 src/time/overrides」的快照；clip 增删、换轨、
   未知字段 fail closed。这是范围限制，不是被推迟的工作。
4. headed/human 为 `NOT_RUN`；M4C 后端用户路径成立，但不是 M5 Studio UX 的人工体验结论。
5. M4C 不打开生产 render route，也不冒充完整 TX-12 验收。

禁止声明：Wave 2 组合 PASS、`WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、Gate V1-P0、V1-Full、M5/M6、headed/human 已验。

## 8. Codex 第二轮外审返修复验（2026-10-26）

第二轮外审 `m4c-external-review-codex-round2.md` 的 6 项 MAJOR 已逐项进入实现与测试：

1. projection digest 绑定有序 track topology；eligibility 比较顺序、track 与视觉/声音 kind 类；纯重排、
   重排+内容和 page→sound 均有旧实现必红用例。`LockService` 同时修复“project change 绕过 shot lock”的
   单向 scope 匹配漏洞。
2. visual timing/topology 变化均产生非空 affected range；asset consumer 以 clip id 去重。当前 projection 无
   transition，依 ADR-W2.0-007 与开发门正式记为 `NOT_APPLICABLE_APPROVED`，未知字段继续 422 fail closed。
3. post-publication recovery 只消费 immutable fact 的 `required_locks`，不再把 affected range 猜成 visual-shot；
   真实 LockService 证明 narration-only 锁语义。
4. 保留 40 边界异常矩阵，并新增五个独立子进程 hard-exit：asset temp fsync、asset link、film temp fsync、
   film rename、DB commit。子进程直接 exit，catch/finally/close 均不执行；父进程递归查 temp 并重启收敛。
5. `docs/03_Architecture.md` 已把 M4B edits 路由同步为已实现；新增自动文档状态 fitness，覆盖架构、追踪、
   route inventory 与 ADR/gate。
6. ADR-W2.0-007 正式裁决 fact 五类增量字段、plan hash/lock 绑定、422 `UNSUPPORTED_EDIT` 与 transition 边界。

外审 MINOR 同批关闭：fault registry union/stage 不再靠 cast 掩盖；`after_committed` 描述改为 response 前；计数统一
为 22+18=40；旁白豁免增加“仅精确 migration-proven path 可豁免”的负向用例。历史 §0–§7 是上一候选的原始
内审记录，本节为其 superseding addendum。新证据捕获与独立外审完成前，状态仍是 `REVIEW_PENDING`，不得自签。
