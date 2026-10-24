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

**复审上下文**：`45c3880`，全新独立上下文，未参与第一轮审查，也未参与修复。

**裁决：NOT PASS —— BLOCKER = 0，MAJOR = 2。**

复审确认八项修复**全部真实且在正确的层**：attention 跳过与 try/catch 包裹（`:340-377`）、
在线 423 与 terminal attention 的区分（`:225-268`）、同 key 接管（`:78`+`:81`，且 `_projectHasPending`
只排除被指定的那一行、另一条 pending 仍会挡住）、六个发布前缝隙与重启收敛、锁检查先于 currentness
（在线 `:176-181`、恢复 `:448-452`，且所有候选都是 `lock_type:"visual"`，所以 narration 不会过度阻塞）、
`outbox_event_id` 对着真实行断言、`frame_count` 改为采用源自身长度、生产写入路径真的执行校验。
复审还独立验证了「接管不会二次提交、不会提交错误的 transaction」：revision CAS 与
`prepared→committed` CAS 在同一事务里，接管复用的是**旧行**自己的 request/hash。

复审发现的两项 MAJOR：

| # | 摘要 | 处置 |
|---|---|---|
| MAJOR-1 | 接管的 `aborted` 结果被当作普通 `HttpError` 抛出，路由渲染成通用 `{code,message,correlation_id}`；于是**同一个 key 的首次回答与持久重放是两个不同的公开 body**，违反门 §7「route 首次及重放均用 error.http_status 返回完全相同的公开 JSON body」 | 已修：接管返回 canonical `ControlledWriteFailureResponseV1`；新增回归测试断言首次回答与持久重放逐字节相同 |
| MAJOR-2 | 修复声称「staging root 变为 per-Host」，实际默认路径是 checkout 级固定路径，同一台机器上任何 Host 的启动清扫都可能删掉另一个 Host 正在使用的树 | 已修：默认 staging root 改为**按数据库派生**（durable 数据库 → 跨重启稳定；内存数据库 → 每进程私有），并新增回归测试 |

复审另记录 9 项 MINOR（D3 新 key 后的 409 不写幂等行；D4 attention latch 过宽；D5 未终结行的读取在队列之外；
D6 通用恢复可能把 M4B 行挪进无出边的 `recovering`；D7 接管在旧请求不可读时静默放弃；D8 插入路径重复；
D9 一个测试没有显式 timeout）——**全部已修**，其中 D4 的修法是区分四种失败：锁冲突是活的、不可证明的证据与
改变的事实是终态、冲突只是没写成、其余是瞬时的（503 可重试），不再一律 latch 成终态。

复审记录的证据过度声明同样已改：TX-08B 原来声称 10 个边界而只有 9 个有测试（现补上 `after_active_inspect`
的测试）；TX-11B 原来暗示渲染了采用前后的两个源（实际两次渲染都是采用**后**的源，已改写）；staging root 的
per-Host 声明已由实现取代。

**第二轮裁决：BLOCKER=0、MAJOR=2 → 仍不满足 M4B 外审 PASS 的条件。**
修复后再次捕获并再次由新的独立上下文复审，见第 6 节。

## 6. 第二轮复审与最终裁决

> 本节由**第二个**全新独立上下文复审填写。该上下文同样没有参与第一轮审查或任何修复。

**裁决：NOT PASS —— BLOCKER = 0，MAJOR = 2，MINOR = 8。**

复审确认第一轮修复的九项**全部真实且在正确的层**（含 takeover 返回 canonical body、staging root 按数据库派生、
四种失败分流、无法读取的行被 latch、队列槽内重读未终结行、单一插入写入者、显式 timeout、证据过度声明已改、
夹具只重试可恢复资源失败）。

两个 MAJOR 与八项 MINOR 全部已修。其中两项值得逐字记录，因为它们是**同一个根因的两次显形**：

- **MAJOR-1（staging root）**：派生的输入是**构造参数** `dependencies.dbPath`，而生产入口
  `src/host/start.ts` 只传 `revisionStore`，不传 `dbPath`。于是生产每次启动都拿到一个新的随机目录，
  崩溃回收——正是这个清扫存在的理由——在生产里**完全失效**。第一轮的修复制造了第二轮的这个缺陷。
- **MAJOR-2（takeover）**：接管发生在**请求自身身份被确认之前**。待决行带着创建它的请求摘要；同 key 异摘要的
  请求被回以旧事务的失败体，而稍后同 key 的重放得到 409 —— 同一个 key，两个公开 body。

**根因闭环**（第三次返工按规则要求的不只是补丁）：

> 这两个反复出现的 MAJOR 有同一个根因：**M4B 的恢复/接管路径与 staging root 是照着测试夹具的形状写的，
> 而不是照着生产组合的形状写的。** 因此每一轮的修复都在夹具里成立、在生产里不成立。

据此，加了两道**穿过生产组合**的防回归门：

1. `reclaims a crashed staging tree through the production composition, where the database path is
   the store's` —— 用 `new NarralensHost({ revisionStore: new RevisionStore(file) })`（生产真正用的形状）
   构造 Host，断言崩溃留下的树在下次启动后被回收。派生改为读 `RevisionStore.databasePath`
   （store 知道自己开在哪个文件上），而不是读一个生产不传的构造参数。
2. `answers one idempotency key with one body, whatever the request body is` —— 断言同 key 异 body 是 409
   （与重放路径同一个答案），而同 key 同 body 每次得到**同一个** body。请求身份现在**先于**接管被确认：
   摘要相同才是同一笔事务，摘要不同且 key 相同是冲突，key 不同则是另一次尝试。

其余 MINOR 的处置：M4B 夹具的重试改为同时识别通用 body 形状（原来只认 canonical 形状，而 canonical 形状是
**已记录**的失败，重放它不会改变任何事，所以那个重试是惰性的）；`after_active_inspect` 测试名由
「revision +0」改为「revision +1」（它证明的是 +1）；**只有自称 adopt-request 的行**才由 M4B 裁决
（legacy edit 路由的行归通用恢复）；启动时 gate 拒绝**不再 latch project**（那会关掉一个本可恢复的项目）；
`ADOPTION_*_MISSING` 这类损坏级失败被当作终态；TX-08B 的引用补齐到它自己声称的 15 个边界；
manifest 新增 `known_failed_captures`，把 Wave 2 历史上**全部 8 个**失败捕获从索引里点出来。

m8（可恢复资源失败被发布为 `http_status: 500`）**没有改**：门 §7 冻结的失败联合类型是
`409|422|423|428|500`，没有 503，而 `HOST_RESOURCE_EXHAUSTED` 在错误别名表里绑的是 503。改它就要改一个
已冻结的合同，超出 M4B 的范围；这里记录为已知边界，并说明触发它的正是 M4B 自己。

**第三轮裁决：BLOCKER=0、MAJOR=2 → 仍不满足 M4B 外审 PASS 的条件。**
修复后再次捕获并再次由新的独立上下文复审，见第 7 节。

## 7. 第三、四、五、六轮复审与最终裁决

> 第 3 至第 6 轮各由一个**全新独立上下文**复审。每一个上下文都没有参与前一轮的审查或修复。

| 轮次 | 裁决 | 缺陷落在哪 |
|---|---|---|
| 3 | NOT PASS（BLOCKER=0，MAJOR=2，MINOR=8） | 接管在请求身份确认之前插手；staging root 的派生输入是生产不传的构造参数 |
| 4 | NOT PASS（BLOCKER=0，MAJOR=3，MINOR=7） | 一条修复根本没落地（补丁脚本中途 assert 失败退出）；六个引用被过宽的过滤器误删；失败捕获索引漏了本阶段自己的失败捕获 |
| 5 | NOT PASS（BLOCKER=0，MAJOR=2，MINOR=9） | 上一轮的 pid 改动让 durable 数据库的 staging root 不再跨重启稳定；Gate B 与生成器共用谓词因而对脚本产出的捕获永远不可能失败 |
| 6 | NOT PASS（BLOCKER=0，MAJOR=1，MINOR=10） | **采用逻辑本身四项全部验证为正确**；剩下的 MAJOR 全在证据机器里：新的失败判定是旧规则的真子集，把一个中途被杀、没有 `.exit` 的捕获漏出了索引 |

### 共同根因

六轮里反复出现的缺陷有两个共同根因，它们都不是"忘了改"：

1. **补丁脚本中途失败而没人察觉。** 第三轮的 MAJOR-1 就是一条从未落地的修复——它在同一个脚本里，而脚本在前一个 assert 处退出。修复改为：每个替换都断言落地、脚本打印应用了哪些、并在最后核对树的状态。
2. **声明与代码分离，而验证只覆盖了测试。** 每一轮都能看到"测试全绿但声明不成立"。所以现在**声明本身是机器可检的**：
   - **Gate A**：崩溃矩阵的 case 必须引用每一个崩溃测试的**每一行**（表格驱动的一行不再能代表五行）；
   - **Gate B**：每一个失败的捕获必须在索引里，而索引由捕获**自身的 exit 文件**判定——判定规则是一个**并集**（意外的退出、诊断文件、`overall.txt`、以及"`.cmd` 有而 `.exit` 没有"的中途夭折），并且门**从日志重算**而不是读它要审计的 manifest；
   - 冻结候选的指针不再硬编码提交，而是指向 manifest 的 `capture_commit`，因此不会再过时。

### 第五、六轮关闭的其余 MINOR

- staging root 恢复为**按数据库派生、跨重启稳定**（durable），pid 只留给内存分支；测试**观察** Host 实际用的根，而不是重算派生。
- 幂等冲突在**每一个**调用点带上请求的 correlation id，并补了测试。
- 被别的模块的未终结行挡住的恢复，被 latch 成终态并把原因写在**行**上——项目因此关闭，但关闭是可见的，而不是被通用恢复静默挪进无出边的 `recovering`。
- 恢复的 pending 检查可以忽略**一组**事务，因此 M4B 自己的行不再互相挡住恢复。
- 无法读取的行被 latch；被 gate 挡住的行被 latch；两者都有测试。
- impact 路由的 POST 与迁移一样重试可恢复的资源失败。
- 十个文档里过时的冻结候选指针改为指向 manifest。
- Gate A 不再要求表格驱动测试必须写 `as const`。
- manifest 记录门实际检查的是哪个文件。

**第六轮裁决：BLOCKER=0、MAJOR=1 → 仍不满足 M4B 外审 PASS 的条件。**
修复后再次捕获并再次由新的独立上下文复审，见第 8 节。

## 8. 第七轮复审与最终裁决

> 本节由**第七个**全新独立上下文复审填写。该上下文没有参与任何前轮审查或修复。

**裁决：NOT PASS（BLOCKER=0，MAJOR=1，MINOR=6）。**

复审确认**采用逻辑本身与四项修复全部正确**（恢复不再被自己的行挡住；被挡住的行被 latch 为终态；
失败判定是并集；索引经独立重算覆盖 17 个失败捕获，逐条与磁盘一致）。剩下的 MAJOR 仍然在证据机器里，
而且这一次是**结构性**的：

> 门**导入了生成器自己的模块**。把规则搬进共享模块让*数据源*独立了（读日志，而不是读 manifest 的清单），
> 但*谓词*仍然是生成器的那一份 —— 两者永远不可能不一致，于是审计对它本该覆盖的那一类缺陷是盲的。
> **两份独立实现一致是检查；同一份实现调用两次是恒等式。**

于是门现在有**自己的**规则实现（从 `.cmd`/`.exit`/`overall.txt`/诊断文件重新推导），并要求它与共享实现
**逐个捕获一致**；两者不一致即失败。同时补上了规则的最后一只盲点：

> 规则把**「捕获到达了脚本末尾」**也当作失败信号。末尾标记是 `overall.txt`（新脚本）或
> `git-status-after.txt`（旧脚本最后写的那一个）。一份在最后一个命令的 `.exit` 之后、`overall.txt` 之前
> 被杀的捕获，所有退出都是绿的、没有诊断、没有 outcome —— 它以前会被判成"干净"。
> 仓库里恰好有三份捕获没有末尾标记，而它们三份都有诊断。

其余 MINOR 全部关闭：源码里那段与代码相反的注释按**实现的行为**重写；一个标题与断言相反的测试改名并
去掉矛盾注释；两个 M4B 自己的行互不遮挡的**行为测试**补上（此前只有源码文本断言，改回单 id 也会全绿）；
一个残留的硬编码 capture 指针改成指向 manifest；一处注释写错了 manifest 字段名；`controlledRecovery`
收到空 ignore 集合时会静默退化（`??` 不处理空数组），现在退回该行本身。

**第七轮裁决：BLOCKER=0、MAJOR=1 → 仍不满足 M4B 外审 PASS 的条件。**
修复后再次捕获并再次由新的独立上下文复审，见第 9 节。

## 9. 第八轮复审与最终裁决

> 本节由**第八个**全新独立上下文复审填写。该上下文没有参与任何前轮审查或修复。

见下。
