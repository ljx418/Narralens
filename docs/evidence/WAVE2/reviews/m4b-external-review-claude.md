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

> 规则把**「捕获到达了脚本末尾」**也当作失败信号，而末尾标记是 **`git-status-after.txt` 单独**——
> 每个捕获脚本都**最后**写它。`overall.txt` **不是**末尾标记：当前脚本在它自己的 manifest 与 gate **之前**
> 写它，所以一份在那个窗口里被杀掉的捕获，所有退出都是绿的、outcome 是 "0"、没有诊断——它以前会被判成"干净"。
> `overall.txt` 只保留为失败**信号**（规则 4），永远不是末尾标记。

**第九轮复审指出的正是这一点**：这条规则是照着第四轮那版脚本的布局写的，而那一轮之后 `overall.txt` 的位置
变了。修正后失败捕获集合**完全不变**（仍是同样 17 份、同样成员），因此**已提交的 manifest 依然有效，
不需要重新捕获**。

其余 MINOR 全部关闭：源码里那段与代码相反的注释按**实现的行为**重写；一个标题与断言相反的测试改名并
去掉矛盾注释；两个 M4B 自己的行互不遮挡的**行为测试**补上（此前只有源码文本断言，改回单 id 也会全绿）；
一个残留的硬编码 capture 指针改成指向 manifest；一处注释写错了 manifest 字段名；`controlledRecovery`
收到空 ignore 集合时会静默退化（`??` 不处理空数组），现在退回该行本身。

**第七轮裁决：BLOCKER=0、MAJOR=1 → 仍不满足 M4B 外审 PASS 的条件。**
修复后再次捕获并再次由新的独立上下文复审，见第 9 节。

## 9. 第八轮复审与最终裁决

> 本节由**第八个**全新独立上下文复审填写。该上下文没有参与任何前轮审查或修复。

**裁决：NOT PASS（BLOCKER=0，MAJOR=1，MINOR=6）。**

复审确认**采用逻辑与四项修复中的三项都成立**：门有自己的规则实现（它甚至把两份实现的期望失败集合各自写了一遍，
所以分歧会**响亮地**失败而不是悄悄通过）；恢复不再被自己的行挡住，而且**行为测试真的能证伪**——复审在副本里把
`:565` 改成 `undefined`、再改成只忽略一个 id，测试两次都失败；第四项的四个子项全部核实。

MAJOR 仍然是证据机器，而且同样**结构性**：我写的末尾标记规则把 `overall.txt` 当成末尾标记之一，而当前脚本在它
自己的 manifest 与 gate **之前**写它 —— 于是「最后一个命令的 `.exit` 之后、`git-status-after.txt` 之前被杀」的
捕获被两份规则**一致地**判为干净，交叉检查也看不见（两份一致，但一致地错）。

修法就是复审给的：末尾标记只用 `git-status-after.txt`（每个脚本最后写的），`overall.txt` 只当失败信号。
修正后失败集合不变，**无需重新捕获**。

其余 MINOR 一并关闭：门现在**要求**那 17 条命令名齐全、且 `checked_manifest` 指向的文件确实存在（一份在 manifest
之前就被杀的捕获，因此从未跑过自己的 manifest 与 gate，以前能通过门）；两份实现对「诊断文件」的判定统一为前缀规则；
索引不再用同一句话描述两种不同的失败；一段测试注释把项目关闭归错了人；一个过时的 FAIL 凭据扫描产物的出处被写进
manifest 的声明限制。

**第八轮裁决：BLOCKER=0、MAJOR=1 → 仍不满足 M4B 外审 PASS 的条件。**
修复后再次由新的独立上下文复审，见第 10 节。

### 一处范围泄漏（M4B 树里的 M4C 代码）

第三轮的提交 `1c0703b` 用了 `git add -A`，把当时工作树里 **M4C 的** `RestoreEnginePlanIntent` 类型与它的
类型守卫、以及 Hypit adapter 里随之而来的那一行，一起扫进了 M4B 的提交。那是一个**只有类型、没有行为**的
声明，没有任何 M4B 路径引用它（Hypit 与 OpenFilm 的 adapter 仍然拒绝 restore intent），所以它不改变 M4B 的任何
行为——但它确实不属于 M4B 的冻结范围。

现在它已从 M4B 的树里**移出**（`git checkout 1c0703b^ -- src/host/engine/engine-plan-intent.ts
src/adapters/hypit/hypit-engine-adapter.ts`），并作为 M4C 的补丁保存：M4C 阶段再引入它。

这也是本轮记下的一条工作纪律：**阶段之间的边界要由提交范围保证，而不是靠事后检查。** 一个 `git add -A`
把下一阶段的类型带进了冻结树，而两轮外审都没有发现——因为它没有任何行为。

## 10. 第九轮复审与最终裁决

> 本节由**第九个**全新独立上下文复审填写。该上下文没有参与任何前轮审查或修复。

**裁决：NOT PASS（BLOCKER=0，MAJOR=2，MINOR=4）。**

### 10.0 方法与边界

复审对象是 `4d85cbd`（HEAD），冻结候选 `b2a4efb`，M4B 捕获 `10d96e5`。所有判定只依据
`git show 4d85cbd:<path>` 与 `git diff 10d96e5 4d85cbd -- <paths>`，不在真实树上执行任何写命令；
需要实跑的部分在 `/home/administrator/m4c-review9` 的副本里做。

实跑结果（在 HEAD 的副本上）：

| 项目 | 结果 |
| --- | --- |
| `pnpm check`（HEAD 全量） | **76 个测试文件 / 914 个测试全过**（1180.5s）+ golden 向量 8/8 + `vite build` 成功 |
| `pnpm test:wave2:m4b` | 6 个文件 / **58 个测试全过**（372.6s） |
| `tsc --noEmit` | 通过 |
| 凭据扫描 `tools/secret-scan.ts` | **findings=0 / 260 files**（捕获时同样是 0 / 260） |
| 完整性门（已提交 manifest） | **14 PASS / 0 FAIL** |
| 已提交 manifest vs 现场重新生成 | **逐字节相同**（`diff` 为空，可复现） |
| vendor checkout | `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`，工作树干净 |

本轮的两个 MAJOR 都**不是** M4B 的采用逻辑，而是第八轮那四个修复本身：**修复 1 只做了一半，
修复 2 把捕获脚本弄坏了。** 采用逻辑本身我在这一轮重新读了
`adoption-coordinator.ts` / `adoption-store.ts` / `author-source-publisher.ts` /
`revision-store.ts#commitAdoption` / `activated-projection-service.ts` / `impact-service.ts`，
逐条核了发布原子性、prepared 恢复、`commitAdoption` 的单事务、projection fact、
发布边界的 rights/锁/源重查、失败重放与三个原生可编辑 clip——**没有发现新的产品缺陷。**

### 10.1 四项修复的逐条裁决

#### 修复 1：末尾标记只用 `git-status-after.txt` —— **只做了一半（MAJOR-1）**

共享规则做对了：

- `tools/wave2-capture-outcome.mjs:93`
  `const reachedTheEnd = existsSync(resolve(directory, "git-status-after.txt"));`
- 同一文件 `:89-92` 的注释与之一致。

**门自己的那份实现没有改，只改了注释**：

- `tools/wave2-m4b-evidence-integrity.mjs:150-153`
  ```js
  // The end marker is `git-status-after.txt` alone: every capture script writes it last.
  // `overall.txt` is written before the manifest and the gate, so it cannot mark the end.
  const reachedTheEnd = recorded !== null
    || existsSync(join(directory, "git-status-after.txt"));
  ```
  注释写的是新规则，**代码仍然是旧的「`overall.txt` 或 `git-status-after.txt`」**。
  第八轮的 diff 里，这一处只有注释行变了，代码行原封不动。

所以「两份实现都用 `git-status-after.txt` 单独作末尾标记」这句话对门不成立；
这正是本轮要查的那一项，而它是假的。详细失败场景与修法见 10.2 的 MAJOR-1。

#### 修复 2：门要求 17 条命令名 + `checked_manifest` 指向存在的文件 —— **做了一半，且弄坏了捕获脚本（MAJOR-2）**

两条检查确实存在（`tools/wave2-m4b-evidence-integrity.mjs:34-54`），`checked_manifest` 的存在性那半条
工作正常（实测 `PASS the manifest names a checked manifest file that exists`）。

但**「17 条命令名」那半条会让每一次新的 M4B 捕获都失败**，因为捕获脚本交给门的那份 manifest
**只能有 15 条**：

- `tools/wave2-m4b-run-evidence.sh:86` 写 `manifest.cmd`，`:87` 跑生成器写出 `$LOGS/manifest.json`，
  `:89` 才写 `manifest.exit`；`:93`/`:94` 才跑门，`:96` 才写 `m4b-integrity.exit`。
- 生成器 `tools/wave2-m4b-evidence-manifest.mjs:22` 的 `commands` 是**目录里现存的 `.exit` 文件**。
  于是 manifest 生成的那一刻，`manifest.exit` 与 `m4b-integrity.exit` 都还不存在 → 最多 15 条。
- 实测：已提交的捕获里那份 `manifest.json` 恰好就是 15 条（`build, check, contracts,
  credential-scan, m2.1, m4a-historical, m4a-integrity, typecheck, wave1-historical,
  wave1-integrity, wave2-fitness, wave2-m3, wave2-m4a, wave2-m4b, wave2-w2.0`）。

这条检查对**已提交的** manifest 是对的（被杀的截断捕获确实会被抓到），错在它被无差别地用在了
捕获**自己**的那一份上。详细失败场景与修法见 10.2 的 MAJOR-2。

#### 修复 3：两份实现对「诊断」的判定一致；索引不再用一句话描述两种失败 —— **已做（PASS）**

- `tools/wave2-capture-outcome.mjs:104-115`：`diagnosticFor` 用前缀 `CAPTURE_FAILED_DIAGNOSTIC.`；
- `tools/wave2-m4b-evidence-integrity.mjs:146`：`names.some((name) => name.startsWith("CAPTURE_FAILED_DIAGNOSTIC."))`；
  两者是**同一条前缀规则**，`.json` 之类的扩展名不再一边失败一边干净。✓
- `tools/wave2-m4b-evidence-manifest.mjs:72-76`：「捕获没有跑到脚本末尾」与「某条命令没有 `.exit`」
  现在是两句话，不再共用一句 `did not finish (no exit file)`。✓

#### 修复 4：M4C 的范围泄漏已移出 M4B 树，且 M4B 行为未变 —— **已做（PASS）**

- `git grep RestoreEnginePlanIntent 4d85cbd -- src/ tests/ contracts/` → **0 命中**。
  类型、类型守卫、以及 Hypit adapter 里那一行都不在了；`docs/migration/WAVE2/17_M4C_DEVELOPMENT_GATE.md`
  等文档里还提到它，但那是 M4C 自己的设计文档，不是 M4B 的代码。
- 行为不变：类型既然没了，Hypit adapter 里那行 `isRestoreEnginePlanIntent` 本来也编译不过；
  现在 `restore_snapshot` 落到 `intent.op !== "replace_visual_asset"` 分支，仍是 **422 UNSUPPORTED_EDIT**，
  只是措辞从「cannot plan an OpenFilm controlled operation」变成「cannot plan a restore_snapshot operation」。
  没有任何测试断言旧措辞（`git grep "OpenFilm controlled operation"` 在 `tests/` 下 0 命中）。
  M4B 从不规划 restore（`history_restore` 未挂载，门已核 `serverAtCapture`）。
- `git diff 10d96e5 4d85cbd -- src/ tests/ contracts/ tools/` 共 **6 个文件，全部在 M4B 范围内**：
  `src/` 只有上面那两处移除，`tools/` 是证据机器本身（`wave2-capture-outcome.mjs`、
  `wave2-m4b-evidence-integrity.mjs`、`wave2-m4b-evidence-manifest.mjs`、`wave2-m4b-run-evidence.sh`）。

### 10.2 本轮引入的新缺陷

#### MAJOR-1：门自己那份末尾标记规则没有跟着改，只改了注释

**位置**：`tools/wave2-m4b-evidence-integrity.mjs:150-153`

**具体失败场景**：一次捕获在脚本写完 `m4b-integrity.exit`（`:96`）之后、`git status --porcelain >
"$LOGS/git-status-after.txt"`（`:100`）之前被杀。此时该目录里有：每一份 `.exit`（含
`manifest.exit`、`m4b-integrity.exit`）、`overall.txt` 内容为 `0`、没有 `.cmd` 缺 `.exit`、没有诊断文件、
**没有 `git-status-after.txt`**。

- 共享规则（`wave2-capture-outcome.mjs:93-96`）→ 末尾标记缺失 → 判为失败并进索引。**正确。**
- 门自己的实现（`:152-153`）→ `recorded !== null` 为真 → `reachedTheEnd` 为真 → 不判失败；
  `recordedFailure` 为假（`overall.txt` 是 `0`）、无诊断 → **门判它干净**。

两份实现因此**不一致**。好消息是它不是静默的：门自己的交叉检查（`:178-184`）会报
「the gate's own rule and the shared rule disagree」，门以非零退出；坏消息是这个交叉检查给出的诊断是
「两份实现不一致，其中一份错了」，而不是「末尾标记规则被改了一半」，而且门自己的实现因为是**更弱**的那一份
（旧规则），**再也无法独立地发现共享规则的多报**——两份实现的价值恰恰在于各自能发现对方的错，
而现在在这一维度上门是旧规则的副本。

更直接的缺陷是：**门的注释（`:150-151`）说的规则和它下面的代码相反。** 「注释说的和代码相反」
正是前几轮反复点名的缺陷类别。

我也核对了当前语料：32 个捕获目录里，**没有一个**是「有 `overall.txt` 而没有 `git-status-after.txt`」
（有 `overall.txt` 的 4 个全都有 `git-status-after.txt`；缺 `git-status-after.txt` 的 3 个都没有
`overall.txt`，且都带诊断）。所以今天两份规则仍然一致（门输出
`PASS the gate's own rule and the shared rule agree on every capture`），**但这是语料的巧合，不是规则的等价**。

**修法**（一行）：

```js
// tools/wave2-m4b-evidence-integrity.mjs:152-153
const reachedTheEnd = existsSync(join(directory, "git-status-after.txt"));
```

（删掉 `recorded !== null ||` 那一支。`recordedFailure` 仍然是独立的失败信号，保留不动。）

#### MAJOR-2：门新加的「17 条命令名」检查让每一次新的 M4B 捕获都失败

**位置**：`tools/wave2-m4b-evidence-integrity.mjs:38-46` 与
`tools/wave2-m4b-run-evidence.sh:86-98`

**具体失败场景**：在 `4d85cbd` 上跑 `pnpm evidence:wave2:m4b`。

1. 脚本 `:86-87` 写 `manifest.cmd` 并跑生成器写出 `$LOGS/manifest.json`。生成器的 `commands`
   来自目录里现存的 `.exit` 文件；此时只有 15 个 `.exit`（`manifest.exit` 在 `:89` 才写，
   `m4b-integrity.exit` 在 `:96` 才写）→ 这份 manifest **必然只有 15 条**。
2. 脚本 `:93-94` 把这份 manifest 交给门。门的新检查 `:38-46` 要求 17 条
   （`..., "manifest", "m4b-integrity"`）→ **`FAIL the manifest is missing commands: manifest, m4b-integrity`**。
3. 门以 1 退出 → 脚本 `:98` 把 `overall` 置 1 → `:105-126` 写出 `CAPTURE_FAILED_DIAGNOSTIC.md` →
   脚本以 1 退出。这份捕获会被共享规则索引成**一次失败的捕获**。

我在副本里按脚本的行序复现了这两步（把捕获目录还原到「`manifest.cmd` 已写、`manifest.exit` 未写、
`m4b-integrity.*` 未写」的状态，再跑生成器与门），门输出：

```
PASS 15 command logs and exits match
FAIL the manifest is missing commands: manifest, m4b-integrity
PASS the manifest names a checked manifest file that exists
...
checks_failed=1 capture_commit=10d96e571e8f13d564f619c426fdf5781dc4f9be
GATE_EXIT=1
```

**后果**：**在 `4d85cbd` 上，冻结证据已经无法重新捕获**——每次捕获都必然是一次失败捕获。
已提交的 `10d96e5` 之所以是绿的，是因为它是用**上一版**门捕获的（它的 `m4b-integrity.txt` 里没有
那条新检查）。这条 MAJOR 正好落在「证据机器」这一层，也就是前八轮 MAJOR 反复出现的同一层。

**修法**（二选一）：

- 让门区分两份 manifest：捕获**自己**那份用 15 条的必需集合（`manifest` 与 `m4b-integrity` 是
  它自己正在跑的两步，在生成它的那一刻还不存在），**已提交**那份用 17 条；或者
- 调整脚本顺序（例如先写 `manifest.exit` 再跑门、门对自己的那份只要求除 `m4b-integrity` 外的 16 条），
  并让生成器把「捕获自己那份」标注出来供门判断。

无论哪种，都必须让「必需命令集合」与「这份 manifest 在被检查时物理上可能包含哪些命令」一致。

#### MINOR-1：「每个捕获脚本都最后写 `git-status-after.txt`」这句话不成立

`tools/wave1-run-evidence.sh`、`tools/m2.1-run-evidence.sh`、`tools/m2.1-finalize-evidence.sh`
都不写 `git-status-after.txt`（grep 计数 0；只有 `w2.0`、`wave2-m3`、`wave2-m4a`、`wave2-m4b` 写）。
共享规则只扫 `docs/evidence/WAVE2/logs`，而 Wave 1 的捕获在 `docs/evidence/WAVE1/logs`，
所以今天只是潜在的；但只要这些脚本的捕获被放进那棵树，就会被误判成「没有跑到脚本末尾」。
修法：把注释改成「WAVE2 的捕获脚本都最后写它」，或给那三个脚本补上这个标记。

#### MINOR-2：`checked_manifest` 只查「存在」，不查「是捕获自己那份」

门从不读 `manifest.checked_manifest` 的内容，只做 `existsSync`（`:48-53`）。
而 `tools/wave2-m4b-run-evidence.sh:84-85` 的注释说这个字段「names the file the gate actually read」——
门并没有读它，它读的是 `argv[2]`。一份手工改过的 manifest 把 `checked_manifest` 指向任何已存在的文件都能过这道检查。
修法：门读它、并核对它的 `capture_commit` 与 `commands` 是否与被审的那份一致。

#### MINOR-3：TX-13 的「重读 rights」没有被任何 M4B 行为测试钉住

case 的 evidence 文本声称「发布前重读 impact/materialization/view/rights，并重查锁」，
但它引用的三条测试证明的全是**锁**；`tests/wave2/m4b/adoption-route.test.ts` 里没有一处提到 rights
（`grep rights` 0 命中）。代码确实重读了 rights（`adoption-coordinator.ts:244` 比对
`finalMaterialization.rights_digest !== materialization.rights_digest`；
`impact-service.ts` 的 `#assertSpecStillCurrent` 比对 `row.rights_digest !== spec.rights_digest`），
且 `materialization.rights_digest` 是可写的（`materialization-store.ts:266` 的 UPDATE），
所以这条主张为真、不是恒真式——但它没有回归测试保护。另外 M4B 路线测试用的 rights digest 是 harness 的
`testRightsDigest(...)` 占位值，不是生产 `BindingService` 的真值（harness 自己在注释里说明了这一点）。

#### MINOR-4：`diagnosticFor` 返回 readdir 顺序里的第一个前缀命中，且不排除目录

`tools/wave2-capture-outcome.mjs:108-113`。同一目录里同时有 `.md` 与 `.txt` 时，索引里记哪一个是不确定的；
一个恰好叫 `CAPTURE_FAILED_DIAGNOSTIC.foo` 的**目录**也会被当成诊断。不影响判定（门只看「有没有」），
但索引里的路径不是确定的。

### 10.3 证据是否诚实

**总体判断：证据本身是诚实的、可复现的、内部一致的；不诚实的是它对**当前 HEAD**的可重新捕获性，
而那正是 MAJOR-2。** 逐条：

- **可复现**：已提交的 `docs/evidence/WAVE2/evidence-manifest-m4b.json` 与现场重新生成的
  `node tools/wave2-m4b-evidence-manifest.mjs 10d96e5… <out>` **逐字节相同**。✓
- **门通过**：在 HEAD 上对已提交的 manifest 跑门 → **14 PASS / 0 FAIL**。✓
- **捕获日志完整**：`10d96e5` 的 17 条命令全部有 `.cmd`/`.txt`/`.exit`；`wave1-integrity` 与
  `m4a-integrity` 按设计为 1、其余全为 0；`check.txt` 记录 76 个测试文件 / 914 个测试全过，
  `wave2-m4b.txt` 记录 58 个测试全过；`credential-scan.txt` 记录 findings=0 / 260 files，
  我在 HEAD 上重跑同样是 0 / 260。✓
- **失败索引**：`known_failed_captures` 17 条，与两份规则在当前语料上一致；每条带 `kept: true` 与
  「它不是一次通过的运行的证据，也永远不会被当作一次」这句说明。✓
- **`route_status.history_restore: false`**：门对**捕获树**核过 `/history/restore` 未挂载；
  `src/host/server.ts` 自 `10d96e5` 起未变，HEAD 仍然如此。✓
- **`claim_limits` 逐条核对**：
  - 冻结失败并集确实是 `409 | 422 | 423 | 428 | 500`（`src/contracts/wave2-types.ts:218`），
    所以关于 500/503 的边界说明属实；`HOST_RESOURCE_EXHAUSTED` 的别名在别处确实是 503。✓
  - 「900 帧三片段」属实：测试用固定上游真的跑 `openfilm.mjs render`，再用
    `ffprobe -count_frames` 数出**解码**帧数为 900；我核了 vendor checkout 就在
    `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` 且工作树干净。✓
  - 「Wave 1 / M4A 的 current-tip 完整性检查按设计失败，历史门通过且非零日志被保留」：与
    `wave1-integrity exit=1`、`m4a-integrity exit=1`、`wave1-historical exit=0`、
    `m4a-historical exit=0` 一致。✓
  - 「不匹配任一 digest 即终态 attention，M4B 不自动清除」：与
    `adoption-coordinator.ts:292-302`（latch `ADOPTION_RECOVERY_UNPROVABLE`）一致。✓
  - 关于 `docs/evidence/WAVE2/security/credential-scan-m4b.json` 是 `be93a183…` 那次 FAIL 扫描的说法：
    与索引里 `be93a183` 的 `credential-scan exit=1` 一致；但那份 JSON **内部没有 capture id**，
    所以「它就是那一次扫描的产物」只能由时间戳与内容推断，无法从文件本身证明。**记为观察，不是缺陷。**
- **case 文件**：
  - TX-11B / TX-14 的媒体主张站得住：渲染两次、`ffprobe` 数出 900 帧、只改中镜 `overrides` 后
    两侧 clip id 不变（`["shot-001","shot-002","shot-003"]`）、第二次渲染摘要改变——测试逐条断言了这些。
  - TX-11B 的 notes 老实交代「采用**前**的源没有被渲染」。✓
  - TX-01/02/03/04/05/06/07/08B/M4B-NW/REG 的引用都被门核对过（引用的测试名确实存在；
    TX-08B 引了全部 **18** 条 crash 边界行）。✓
  - 唯一的证据缺口是 MINOR-3 里的 TX-13 rights 部分。
- **捕获与 HEAD 的差距**：`git diff 10d96e5 4d85cbd -- src/ tests/ contracts/ tools/` **不为空**
  （6 个文件）。`src/` 的两处是 Fix 4 说的 M4C 类型移除，对 M4B 行为无影响（我在 HEAD 上重跑了
  **完整 `pnpm check`：76 个测试文件 / 914 个测试全过**，golden 向量 8/8，构建成功）。
  所以**产品侧的证据仍然成立**。
  但**证据机器**在 HEAD 上已经变了，而按 MAJOR-2，它现在连一次绿色捕获都产不出来——
  也就是说「冻结证据可以被重新捕获」这个前提在 HEAD 上**不成立**，而已提交的证据仍然是绿的
  （它是用上一版门捕获的）。这一条必须写进模块的已知边界，否则读者会以为那份 manifest 可以随时重放。

### 10.4 未能判定的事项

1. **HEAD 上的完整 `pnpm check` 已在副本上跑完并通过**（76 个测试文件 / 914 个测试、golden 向量
   8/8、`vite build` 成功）。所以「捕获 `10d96e5` 早于 HEAD」这一点**不再影响产品侧结论**：
   HEAD 的树是绿的，`src/` 的那两处移除对 M4B 行为无影响，已被这 914 个测试覆盖。
   未复现的只有**证据机器本身**在 HEAD 上的行为（见本节第 2 条）。
2. **我没有真正重跑一次 `pnpm evidence:wave2:m4b`**（那会写真实树）。MAJOR-2 的失败是**按脚本行序
   在副本里逐行复现**「写 `manifest.cmd` → 跑生成器 → 跑门」这三步，并直接读到了门的那一行 FAIL
   与退出码 1；不是完整跑一次脚本。
3. `docs/evidence/WAVE2/security/credential-scan-m4b.json` 与 `be93a183…` 的对应关系是**推断**，不是证明
   （文件内部没有 capture id）。
4. 按本轮要求，我在形成裁决之前**没有读** `docs/evidence/WAVE2/reviews/m4b-external-review-claude.md`
   的前九节；第 9 节对四项修复的描述是按源码独立核对后才对照的，结论是**其中三项成立、
   一项（修复 1）只做了一半**，且修复 2 引入了 MAJOR-2。
5. 我没有独立复核 900 帧的真实媒体内容本身（除通过测试里那次真实渲染 + `ffprobe` 帧计数）；
   「三片段、两侧 id 不变、中镜可原生编辑」这些断言来自测试本身，我没有另写一份独立的复现脚本。

### 10.5 结论

**第九轮裁决：BLOCKER=0、MAJOR=2 → 不满足 M4B 外审 PASS 的条件。**

M4B 的采用逻辑本身，这一轮重新读下来是站得住的：发布的原子性、prepared 恢复的四分法、
`commitAdoption` 的单事务与回滚矩阵、projection fact 的非恒真守卫、发布边界的锁/rights/源重查、
失败重放的同键同体、以及三个原生可编辑 clip 的真实渲染证据，我没有找到新的产品缺陷。
两个 MAJOR 都在**证据机器**这一层，而且都是第八轮那两个修复本身带进来的：

- **MAJOR-1**：门自己的末尾标记规则只改了注释、没改代码，于是「两份独立实现」在一处退化成了
  「一份新规则 + 一份旧规则」，靠语料巧合保持一致；门的注释还与自己的代码相反。
- **MAJOR-2**：门新加的「17 条命令名」检查用在了捕获自己那份**物理上只有 15 条**的 manifest 上，
  于是 **在 `4d85cbd` 上重新捕获 M4B 证据必然得到一份失败捕获**。

两处修法都很小：MAJOR-1 删掉 `recorded !== null ||` 那一支；MAJOR-2 让「必需命令集合」与
「这份 manifest 在被检查时可能包含哪些命令」一致（捕获自己那份 15 条、已提交那份 17 条，或调整脚本顺序）。

修完这两处之后，**冻结证据需要重新捕获**：当前 `10d96e5` 是用上一版门捕获的，
它证明不了 `4d85cbd` 这一版门的行为；而且按现状，新捕获根本产不出来。

## 11. 第十轮复审与最终裁决

> 本节由**第十个**全新独立上下文复审填写。该上下文没有参与任何前轮审查或修复，也没有先读第九轮
> 对「四项修复」的描述；所有判断都先按 `git show 25df0cb:<path>` / `git show 15dac08:<path>` 独立做出，
> 之后才与那份描述对照。第九轮的描述**没有被当作证据**，只当作待核对的断言。

裁决：M4B_EXTERNAL_REVIEW_PASS（BLOCKER=0 / MAJOR=0）

本轮另记 **MINOR=6**、**OBSERVATION=4**（见 11.2、11.3）。第九轮的两条 MAJOR 经代码核实**都已修复**；
第九轮六条断言里，三条完全成立、两条部分成立、一条（TX-13 的回归测试）**只钉住「两份重读同时被删」
这一种情形**。M4B 的采用逻辑本身本轮重读后**没有发现新的产品缺陷**。

### 11.0 方法与边界

复审对象是冻结候选 `25df0cb9ef33d3b48c11f6838adf6b8a6d2d1dee`（父提交 `ca0708d` 带第九轮的修复）、
证据捕获目录 `docs/evidence/WAVE2/logs/25df0cb…/`、封存提交 `15dac08`、
权威 manifest `docs/evidence/WAVE2/evidence-manifest-m4b.json`。
所有代码判定只依据 `git show <sha>:<path>` 与 `git diff <a> <b> -- <paths>`；
需要实跑的部分全部在 `/home/administrator/m4c-review10/repo`（`15dac08` 的副本）里做，
真实树只被追加了本节。**未提交、未推送、未联网、未读取 `J:\`、无窗口无焦点、无 provider 无付费。**

**一条必须记下的时序事实**：我开始复审时真实树的 HEAD 还是 `15dac08`，
而我写下本节的时候，真实树已经前进到 `e483fb4`（其上叠着 `28e52ad`，M4C 的历史恢复已经落地，
工作区里还留着 `docs/evidence/WAVE2/logs/e483fb4d…/` 这个正在进行的 M4C 捕获目录）。
**本节的所有判定都是按 SHA 做的**（`git show 25df0cb:<path>` / `git show 15dac08:<path>`），
所以树的移动不影响结论；本节也**没有**对 M4C 的任何内容下判断。
`docs/evidence/WAVE2/reviews/m4b-external-review-claude.md` 在 `15dac08` 与 `e483fb4` 之间**未变**，
所以本节直接接在第十节之后。

先记一条**范围事实**：`git diff --stat ca0708d 25df0cb` 只有三个文件，全在 `tools/`
（`wave2-capture-outcome.mjs`、`wave2-m4b-evidence-integrity.mjs`、`wave2-m4b-run-evidence.sh`），
`src/`、`tests/`、`docs/` 一行未动。也就是说**产品代码在这次「捕获提交」里根本没有变**，
第九轮的修复（`git diff --stat 4d85cbd ca0708d`：5 个文件）在 `ca0708d` 就已经落地；
TX-13 的新测试也是 `ca0708d` 加的（`git show 4d85cbd:tests/wave2/m4b/adoption-route.test.ts`
里 `grep -c "re-reads the rights before publication"` = 0，`ca0708d` = 1）。
这一点决定了本轮所有结论的落点：**本轮审的是证据机器，不是产品。**

实跑结果（副本上）：

| 项目 | 结果 |
| --- | --- |
| `pnpm test:wave2:m4b`（基线，未改代码） | **6 个文件 / 59 个测试全过**（与捕获记录的 `wave2-m4b.txt`「59 passed」一致） |
| 完整性门（已提交 manifest） | **16 PASS / 0 FAIL**，exit 0 |
| 完整性门（捕获自己那份 `checked_manifest`） | **15 PASS / 1 FAIL**，exit 1（见 11.2-MINOR-4） |
| 已提交 manifest vs 现场重新生成 | **逐字段相同**，只有 `branch` 不同（副本是 detached HEAD，真实树上相同） |
| 凭据扫描 `tools/secret-scan.ts` | **findings=0 / 259 files**（捕获时 0 / 260） |
| 捕获 `check.txt` 记录 | **76 个测试文件 / 915 个测试全过**（上一轮捕获是 914，多的正是 TX-13 那一条） |
| 变体 A（删掉协调器那份 rights 重读）**全量 M4B 套件** | **6 个文件 / 59 个测试全过**（367.06s）——没有一条用例变红 |
| 变体 A / 变体 B / 变体 A+B（只跑 TX-13 那一条） | 见 11.2-MINOR-5 |
| 合成捕获 S1…S5 | 见 11.2-MINOR-1/2/3 |

**一个必须先说清楚的前提**：M4B 的 900 帧媒体夹具落在 `fixtures/d1-30s/assets/generated/` 与
`fixtures/d1-30s/output/`，这两个目录在 `.gitignore` 里、**不在版本控制内**（`.gitignore` 里有
`fixtures/d1-30s/output/`、`fixtures/d1-30s/assets/generated/`、`*.mp4`、`*.wav`）。
全新 clone 拿不到它们，媒体链那两条用例（TX-11B / TX-14）**跑不起来**；我是从真实树把那两个目录
拷进副本才跑通的。这不是产品缺陷，但它意味着「克隆即可复现捕获」这句话对媒体部分不成立。

### 11.1 第九轮六条断言的逐条核对

| 第九轮断言 | 本轮结论 | 依据 |
| --- | --- | --- |
| MAJOR-1 门的末尾标记规则仍是旧规则 | **已修复** | 见下 ① |
| MAJOR-2 门的「17 条必需命令」用在了物理上只有 15 条的 manifest 上 | **已修复** | 见下 ② |
| MINOR-1 共享规则声称「每个捕获脚本都写末尾标记」 | **部分修复** | 见下 ③ |
| MINOR-2 `checked_manifest` 只查存在不读内容 | **已修复** | 见下 ④ |
| MINOR-3 TX-13 的 rights 重读没有回归测试 | **部分修复** | 见下 ⑤（→ 11.2-MINOR-5） |
| MINOR-4 `diagnosticFor` 取 readdir 首个命中且不排除目录 | **半修复** | 见下 ⑥（→ 11.2-MINOR-1） |

**① 门的末尾标记规则：已修复。** 门自己的那份实现现在是
`tools/wave2-m4b-evidence-integrity.mjs:228`
`const reachedTheEnd = existsSync(join(directory, "git-status-after.txt"));`——
`recorded !== null ||` 那一支**已经删掉**，注释（`:222-227`）与代码现在说同一件事。
共享规则 `tools/wave2-capture-outcome.mjs:124` 是同一句规则。
合成捕获 S2（15 条命令全绿、`overall.txt` = 0、**没有** `git-status-after.txt`）实测：
两份实现都判「the capture never reached the end of its script」，**一致**。✓

**② 必需命令集合：已修复。**
`tools/wave2-m4b-evidence-integrity.mjs:47-51` 的必需集合是 **15** 条
（`check, typecheck, contracts, m2.1, wave2-w2.0, wave2-m3, wave2-m4a, wave2-m4b, wave2-fitness,
build, wave1-historical, m4a-historical, wave1-integrity, m4a-integrity, credential-scan`），
`:54` 把 `manifest` 与 `m4b-integrity` 放进 `writtenAfterTheManifest`。
这 15 条正好是**生成 manifest 之前就已经跑完**的命令
（`tools/wave2-m4b-run-evidence.sh:53-74` 写 `.exit`，`:90-93` 才生成 manifest），
所以捕获自己那份 manifest **物理上能**包含它们。✓
实测：在冻结提交上重新捕获不再必然失败——已提交的捕获本身就是绿的
（17 条命令、`m4b-integrity.exit` = 0、`overall.txt` = 0、无诊断文件）。
被杀在 manifest 那一步之前的捕获**仍然被抓到**：合成捕获 S1（只有 3 条命令）→
`FAIL the manifest is missing commands: m2.1, wave2-w2.0, …`。✓

**③ 「每个捕获脚本都写末尾标记」：部分修复。**
模块级文档注释确实改了（`tools/wave2-capture-outcome.mjs:24-33` 现在写
「because the **Wave 2** capture scripts write it last」，并补了一段说明 Wave 1 / M2.1 的脚本不写它、
它们的捕获在 `docs/evidence/WAVE1/logs`、规则不读那个目录）。
但**同一句假话还留在另外两处**（→ 11.2-MINOR-6）。
实测三个脚本确实不写末尾标记：`git show 25df0cb:tools/wave1-run-evidence.sh | grep -c git-status-after.txt` = 0，
`m2.1-run-evidence.sh` = 0，`m2.1-finalize-evidence.sh` = 0；
而 `w2.0` / `wave2-m3` / `wave2-m4a` / `wave2-m4b` 各自 = 1 / 1 / 1 / 2。

**④ `checked_manifest`：已修复。** 门现在**读它、解析它、并交叉核对**
（`tools/wave2-m4b-evidence-integrity.mjs:77-102`）：要求
`checkedManifest.capture_commit === manifest.capture_commit`，且
`lost = [...checkedNames].filter((name) => !present.has(name))` 为空；
读不出或解析失败也各自报一条 FAIL。实测已提交 manifest 报
`PASS the manifest names a checked manifest for the same capture, with no command lost`。✓

**⑤ TX-13 的 rights 重读回归测试：部分修复。** 详见 11.2-MINOR-5。

**⑥ `diagnosticFor`：半修复。** 共享规则那一份做对了
（`tools/wave2-capture-outcome.mjs:144-147`：`entry.isFile() && entry.name.startsWith(...)`，再 `.sort()`）；
门自己那一份**没改**（`tools/wave2-m4b-evidence-integrity.mjs:218`）。
详见 11.2-MINOR-1。

### 11.2 本轮新发现的缺陷

以下六条**都不构成 BLOCKER，也都不构成 MAJOR**：每一条都已经被现有机制**挡住**（要么门会大声报错、
要么结论只影响 M4C 的捕获、要么只是注释/措辞），**没有一条让一次失败的捕获被呈现为绿色**。
它们是「证据机器还差最后一点」的性质，不是「证据机器说错了话」的性质。

#### MINOR-1：门自己那份诊断判定不排除目录，与共享规则在一种输入上不一致

**位置**：`tools/wave2-m4b-evidence-integrity.mjs:218`
**对照**：`tools/wave2-capture-outcome.mjs:144-147`

```js
// 门：:218
const diagnostic = names.some((name) => name.startsWith("CAPTURE_FAILED_DIAGNOSTIC."));
// 共享规则：:144-147
const names = entries.filter((entry) => entry.isFile() && entry.name.startsWith("CAPTURE_FAILED_DIAGNOSTIC."))
  .map((entry) => entry.name).sort();
```

第九轮的 MINOR-4 只修了共享规则那一份，门自己那一份**原封不动**。
后果：两份实现**在一种输入上会给出相反的答案**。实测（合成捕获 S5：目录里放一个
**目录**，名字叫 `CAPTURE_FAILED_DIAGNOSTIC.md`）：

```
共享规则：failedCaptures 不含该捕获；diagnosticFor(...) = null
门自己：  "the capture carries a failure diagnostic"
门输出：  FAIL a failed capture is not in the index: ce42fd5a… (the capture carries a failure diagnostic)
          FAIL the gate's own rule and the shared rule disagree; one of them is wrong
          checks_failed=2
```

**为什么不是 MAJOR**：门是**更严**的那一份（它把目录当诊断），所以分歧的方向是「把可疑的东西判失败」，
**不可能把失败藏起来**；而且门自己的交叉检查（`:255-259`）会当场报「两份实现不一致」，以非零退出。
**为什么仍是缺陷**：这门的设计原则就写在它自己的注释里（`:165-172`）——
「两份独立实现**一致**才算检查；一份实现调用两次是恒真式」。现在两份实现在一个维度上不一致了。
修法只有一行：把 `:218` 换成 `readdirSync(directory, { withFileTypes: true })` 后
`entry.isFile() && entry.name.startsWith(...)`。

#### MINOR-2：manifest 生成器里还有**第三份**硬编码的预期失败集合

**位置**：`tools/wave2-m4b-evidence-manifest.mjs:18`

```js
const expected = new Set(["wave1-integrity", "m4a-integrity"]);
```

这个文件**解析了** `environment.txt`（`:16-17`，解析结果存进 `manifest.environment`），
却**没有用它**去算「这次捕获预期哪些命令失败」。
共享规则（`wave2-capture-outcome.mjs:54-63`）与门自己那一份
（`wave2-m4b-evidence-integrity.mjs:185-195`）**都**读 `environment.txt` 里的
`expected_failure_commands=`，两份都对了。**生成器是第三份，它没跟上。**

后果实测（合成捕获 S4，就是 `25df0cb` 这个提交要解决的那个 M4C 场景：
`environment.txt` 记 `expected_failure_commands=wave1-integrity,m4a-integrity,m4b-integrity`，
且 `m4b-integrity.exit` = 1）：

```
两份失败规则：都判「干净」（这个捕获在 known_failed_captures 里没有出现）
生成的 manifest：m4b-integrity 这条 **没有** expected_failure: true
门：FAIL unexpected exit: m4b-integrity      checks_failed=1   exit 1
```

也就是说：**一份按设计预期会失败的捕获，被生成器写成了「不该失败」，门于是把它判成失败。**
提交 `25df0cb` 的标题就是「the expected-failure set belongs to the capture, not to the repository」，
而这次修复**只到了两份规则，没到生成器**。
**为什么不是 MAJOR**：方向是 fail-closed（干净的捕获被说成失败），失败**没有**被藏起来；
而且它只在 M4C 那种「预期 M4B 自己的完整性门失败」的捕获上发作，M4C 不在本轮范围内。

#### MINOR-3：门分不出「跑完了的捕获」与「在 manifest 之后、门之前被杀的捕获」

**位置**：`tools/wave2-m4b-evidence-integrity.mjs:47-58`（必需集合 15 条）+ `:54`
（`writtenAfterTheManifest = new Set(["manifest", "m4b-integrity"])`）

第九轮自己给出的两条修法是「**让门区分两份 manifest**：捕获自己那份用 15 条，已提交那份用 17 条」
或「调整脚本顺序」。实际实现只做了前半句的后一半：**15 条这一套被无差别地用在了两份 manifest 上**。
后果实测（合成捕获 S2b：15 条命令 + `manifest.cmd` / `manifest.exit` / `manifest.json`，
**门那一步从未运行**，也没有 `git-status-after.txt`）：

```
PASS 16 command logs and exits match
PASS the manifest lists all 15 required commands
PASS the manifest lists every command that finished in the capture (16 finished)
PASS every failed capture is indexed (18 listed)
PASS the index names no capture that did not fail
...
checks_failed=0        exit 0
```

**门对一份被截断的捕获报绿。** 第八轮那套「17 条命令」的规则本来能抓到它
（`FAIL the manifest is missing commands: m4b-integrity`）。
**为什么不是 MAJOR**：截断**没有被藏起来**——这份捕获在 `known_failed_captures` 里，
带着「the capture never reached the end of its script」；而提交给读者的那份 manifest 也会显示
「16 finished」而不是「17 finished」。也就是说信息在，只是门没有把「少了一条」当成失败。
**修法**（第九轮自己写过）：要么按 manifest 的来源分别用 15/17；要么——
既然捕获目录里**有** `git-status-after.txt` 就说明它跑到了末尾、**必然**跑过门，
那就应当在这种情况下要求 `m4b-integrity` 也在集合里。

#### MINOR-4：捕获自己那份 manifest 把自己列成了失败捕获，今天重跑门是红的

**位置**：`docs/evidence/WAVE2/logs/25df0cb9ef33d3b48c11f6838adf6b8a6d2d1dee/manifest.json`
（`known_failed_captures` 有 **18** 条，第 5 条就是它自己），
对照 `docs/evidence/WAVE2/evidence-manifest-m4b.json`（**17** 条，**没有**它自己）。

原因在脚本的行序里，是**结构性的**：`tools/wave2-m4b-run-evidence.sh:90-91` 生成 manifest，
`:98` 才跑门，`:104` 才写 `git-status-after.txt`。manifest 是在捕获**还没写末尾标记**的时候生成的，
于是那一刻共享规则诚实地判它「没有跑到脚本末尾」，生成器就把**它自己**写进了失败索引。

后果实测（同一棵树上，两份 manifest 各跑一次门）：

```
门 vs 已提交 manifest：      16 PASS / 0 FAIL   exit 0
门 vs 捕获自己那份 manifest：15 PASS / 1 FAIL   exit 1
      FAIL the index names a capture that did not fail: 25df0cb9ef33d3b48c11f6838adf6b8a6d2d1dee
```

捕获当时记录的 `m4b-integrity.txt` 里是
`PASS the index names no capture that did not fail`——**同一份文件、同一棵树，今天重跑是红的。**
原因是门的判定**依赖时间**：`git-status-after.txt` 存在与否，捕获当时不存在、现在存在。
**为什么不是 MAJOR**：权威的那份（已提交 manifest）**是绿的、可复现的**；这份红的是一份
**历史快照**（捕获当时检查的那一份）。方向也是 fail-closed（把一次绿色捕获的旧快照判红）。
**为什么仍是缺陷**：证据机器的全部前提是「读者重跑能得到同一个答案」，而这里不能。
而且已提交 manifest 的 `checked_manifest` 字段**恰恰指向这份文件**——
读者顺着 manifest 的指引去重跑，就会撞上一个与捕获记录矛盾的 FAIL。
**修法**：生成器生成**自己这份** manifest 时，应当把「当前捕获」排除在 `known_failed_captures` 之外
（它无法知道自己的结局），由事后再生成的已提交那份来补上。

#### MINOR-5：TX-13 的新回归测试**只钉住「两份 rights 重读同时被删」**，单独删任何一份都仍然全绿

**位置**：`tests/wave2/m4b/adoption-route.test.ts:333-360`（第九轮加在 `ca0708d`）；
被测的两份重读在 `src/host/adoption/adoption-coordinator.ts:244` 与
`src/host/impact/impact-service.ts:579`。

先说这条测试**做对了**的部分：

- 它**真的在发布边界上**。`authorizedAdoption()` 只把工程与 materialization 准备好并建好 impact，
  **不**发起采用；`postAdoption()` 发起的那一次采用走到
  `adoption-coordinator.ts:224` 的 `after_prepared` 故障缝时，才把
  `materialization.rights_digest` 直接 UPDATE 成 `9…9`。这个缝在 `prepare()` 之后、
  发布边界的重查（`:226-247`）之前，**在同一次采用之内**。
- 它断言的东西也是真的：428 / `IMPACT_STALE` / `status: "aborted"` / `previous_revision: 1,
  new_revision: 1` / 激活态 revision 仍是 1（`tests/wave2/m4b/adoption-route.test.ts:355-359`）。
- 它是**会红**的：两份重读**同时**删掉时，这条测试失败。

但是——**单独删掉任何一份，它都不红**。三组变体实测（副本上，只跑这一条用例）：

| 变体 | 改的地方 | 结果 |
| --- | --- | --- |
| A | `adoption-coordinator.ts:244` 的 `finalMaterialization.rights_digest !== materialization.rights_digest` → 与自身比较 | `✓ re-reads the rights before publication … 7895ms` / **1 passed** |
| B | `impact-service.ts:579` 的 `row.rights_digest !== spec.rights_digest` → 与自身比较 | `✓ re-reads the rights before publication … 9944ms` / **1 passed** |
| A+B | 两处同时 | **FAIL**：`expected 200 to be 428`，`tests/wave2/m4b/adoption-route.test.ts:355` |

而且不只是那一条用例没红：**把变体 A 施加到整个 M4B 套件上，59 个测试全过**
（`Test Files 6 passed (6)` / `Tests 59 passed (59)` / `Duration 367.06s`），
包括 TX-13 那条本身。也就是说：**删掉协调器在发布边界的那次 rights 重读，
今天整个 M4B 套件看不出任何区别。**

**为什么这重要**：两份重读覆盖的是**不同的窗口**，不是同一件事的两次拷贝。

- `impact-service.ts:579` 比的是「materialization 行的 rights_digest」与「**impact 规格里记的**
  rights_digest」，覆盖的是「**从 impact 被授权到此刻**」这一段；
- `adoption-coordinator.ts:244` 比的是「刚读回来的」与「**这次采用一开始读到的**」，
  覆盖的是「**这一次采用内部**」这一段。

变体 A 之后，`:239` 的 `requireCurrent` 仍然会在发布边界重读 rights，所以**可观察到的行为没变**；
变体 B 之后，`:244` 的比较仍然会挡住这次漂移，**行为也没变**。
换句话说：**没有产品缺陷**，安全属性由另一份重读兜住了。
**但覆盖窗口确实不同**：

- 变体 A 之下，发布前**最后一次**读 rights 的地方是
  `impact-service.ts:573`（`requireCurrent` 在 `:239` 里读那一行），
  从那一次读之后到发布完成之间的任何 rights 变化**不再有任何检查**；
- 变体 B 之下，`:244` 仍然覆盖「这一次采用之内」，但「从 impact 被授权到这次采用开始」那一段
  （即 `adoption-coordinator.ts:156` 那次 `requireCurrent` 之前）不再有检查。

而**没有任何一条测试**能钉住这两段——新测试的**注释**
（`tests/wave2/m4b/adoption-route.test.ts:334-336`）写的是
「The lock half had a regression test; the rights half did not, so a change that dropped
the rights re-read would have left every test green. **This is that test.**」，
按变体 A 的实测（全套件 59 个测试全过），**改完之后这条测试仍然全绿**。
`docs/evidence/WAVE2/cases/m4b-cases.json` 的 TX-13 evidence 里那句
「没有这条测试时删掉这次重读仍然全绿」**按字面是真的**
（删掉协调器那一份，全套件仍然全绿——实测；删掉 impact-service 那一份，TX-13 那条仍然全绿——实测），
但标题句「rights 的重读由一条回归测试钉住」只在**两份一起删**时成立。
**为什么不是 MAJOR**：行为被保护着，措辞的每一句都可以按字面读通；
这是**冗余没有被钉住**，不是**安全属性没有钉住**。第九轮的 MINOR-3 说的是「没有回归测试」，
现在**有**了，而且它在两份同时消失时会红。**修法**：要么让测试分别针对两处重读
（例如在 `:239` 与 `:240` 之间加一个故障缝，或直接对 `impact-service.ts:579` 单独做变体测试），
要么在 case 文本里把「钉住」的粒度写清楚。

#### MINOR-6：「每个捕获脚本都写末尾标记」这句假话还剩两处

**位置**：`tools/wave2-capture-outcome.mjs:120-121` 与 `tools/wave2-m4b-run-evidence.sh:78-79`

```js
// tools/wave2-capture-outcome.mjs:120-121
// The end marker is `git-status-after.txt` **alone**, because every capture script writes
// it last. …

// tools/wave2-m4b-run-evidence.sh:78-79
// … the end marker is `git-status-after.txt`, which
// every script writes last.
```

第九轮的 MINOR-1 只改了模块级文档注释（`:24-33`），这两处**没改**，而这三句话都是假的
（`wave1-run-evidence.sh` / `m2.1-run-evidence.sh` / `m2.1-finalize-evidence.sh` 都不写它，
实测 grep 计数 0）。这不是风格问题：这条注释正是**规则本身的依据**，
而规则的读法必须是「WAVE2 的捕获脚本写它」。留着假话，下一轮就会有人按它去推理
「任何捕获都有末尾标记」——那正是第九轮 MAJOR-1 的形状。**修法**：把这两处也改成
「the Wave 2 capture scripts」，或直接引用模块级那段说明。

### 11.3 观察（不计入缺陷）

**OBS-1**：`tools/wave2-m4b-evidence-integrity.mjs:59-60` 的注释说这条规则有**两个方向**
（「every command that finished is listed, **and nothing is listed that did not finish**」），
但代码只实现了第一个方向（`:70` 的 `unlisted`）。第二个方向由 `:29` 的逐条 exit 交叉核对
间接覆盖（manifest 里列了但目录里没有的 `.exit` → `exit mismatch`）。
建议要么补上那个方向，要么把注释改成只说它实际做的那一个。

**OBS-2**：`tools/wave2-m4b-evidence-integrity.mjs:287` 的
`execFileSync("git", ["show", …])` **没有** try/catch。当 `manifest.capture_commit`
不是一个能解析的提交时（我用了一个假 sha 实测），门**抛出未捕获异常**、
直接以堆栈和 exit 1 结束，**来不及打印 `checks_failed=` 那一行**——
而 `:20-23` 对同一件事本来有一句体面的 `FAIL capture commit missing`。
方向是 fail-closed，但崩溃与「门自己判失败」在日志上长得不一样。

**OBS-3**：媒体夹具不在版本控制内（见 11.0）。这让「克隆即可复现捕获」对 TX-11B / TX-14 不成立。
这属于**证据的可复现性**问题，不是 M4B 逻辑的问题。

**OBS-4**：已提交 manifest 的 `commands` 有 **17** 条（多出 `manifest` 与 `m4b-integrity`），
捕获自己那份只有 **15** 条；两者都合法，但**门的必需集合只按 15 条判**
（见 MINOR-3）。另外门的 `:77-102` 只读 `checked_manifest` 做交叉核对，
**不会**在它上面再跑一遍门——所以「捕获自己那份现在是红的」（MINOR-4）这件事，
已提交 manifest 的绿色判定**发现不了**。

### 11.4 M4B 的采用逻辑本身：本轮重读，没有发现新的产品缺陷

按委托逐条重读（全部按 `git show 25df0cb:<path>`）：

- **发布原子性**（`src/host/adoption/author-source-publisher.ts`）：内容寻址资产用
  临时文件 + fsync + `link` 安装（EEXIST 则逐字节核对后 423），`film.html` 用**同目录**
  `rename` 原子替换（`:94-109`），替换前**立刻**重算 active film 的 sha256
  （`:99-101`，与 `expectedFilmBeforeSha256` 不符即 409 `SOURCE_CHANGED`），
  受保护 root 逐字节比对（`:76-81`），路径逃逸由 `inside()` 挡住，
  发布后再验一次摘要（`:110-112`，不符即 423 `PROJECT_ATTENTION_REQUIRED`）。
  五个发布故障缝（`asset_temp_fsynced / asset_installed / film_temp_fsynced / film_renamed /
  parent_fsynced`）与十个协调器故障缝在 `tests/wave2/m4b/` 里逐条覆盖。
- **prepared 恢复**：`adoption-coordinator.ts:283` 起，`prepared` 之后用
  「同一 transaction 的 fact + 重新解析的 active 视图」推断结局，两个方向都不匹配就 latch
  终态 attention（`ADOPTION_RECOVERY_UNPROVABLE`），**不猜成功**。
- **`commitAdoption` 单事务**（`src/host/projects/revision-store.ts`）：一个
  `BEGIN IMMEDIATE` 里做 prepared 检查 → project_state CAS → impact 消费 CAS → snapshot 落行 →
  `insertProjectionFact` → ledger 行 → active_commit upsert → outbox 落行 → idempotency 行 →
  transaction 由 prepared CAS 到 committed → `COMMIT`；任何一步抛错都 `ROLLBACK`。
  没有「多事务拼接」也没有「失败后补写成功」。
- **projection fact**：`src/host/adoption/adoption-store.ts:59-67` 的 `assertProjectionFact`
  **被生产路径真的执行**（`:77` 的 `insertProjectionFact` 第一行就调它，注释也写明
  「exported so the *production* writer validates too」）。而且它**不是恒真式**：
  写入的 `frame_count` 是**被采用的源自己的** `materialization.native_plan.total_frames`
  （`adoption-coordinator.ts:273`），读回来时与**工程的** `view.frame_count` 比对
  （`src/host/engine/activated-projection-service.ts:146`）——两者来源不同，
  所以它证明的是「这次采用没有改变时长」，而不是「拿一份拷贝跟它自己比」。
- **发布边界的最终重查**（`adoption-coordinator.ts:226-247`）：**先查锁、再查 currentness**
  （`:234-239`），顺序有理由且被三条 visual 锁用例钉住；然后重读 materialization、
  解析激活视图、核对基线、比 rights、比 impact hash，任何一项移动都 428 `IMPACT_STALE`。
- **失败重放**：同 key 同 body 接管原 transaction 并补交，首答与持久重放逐字相同；
  同 key 异 body 是 409。
- **三个原生可编辑 clip**：TX-11B / TX-14 用固定上游真跑 `openfilm.mjs render`，
  再用 `ffprobe -count_frames` 数出**解码**帧数 900；只改中镜 `overrides` 后
  两侧 clip id 仍是 `["shot-001","shot-002","shot-003"]`，第二次渲染摘要改变
  （证明它是**原生**可编辑，不是 proxy/flattened MP4）。上游 checkout 就在
  `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。
- **凭据扫描**：捕获时 findings=0 / 260 files，我在副本上重跑 findings=0 / 259 files
  （差 1 个文件是副本与真实树的差异，不影响结论）。
  `docs/evidence/WAVE2/security/credential-scan-m4b.json` 确实是 `be93a183…` 那次 **FAIL** 扫描的产物
  （索引里 `be93a183` 的 `credential-scan exit=1` 与之一致，文件内有 2 条
  `GENERIC_SECRET_ASSIGNMENT`，落在 `tests/wave2/m4b/adoption-store.test.ts` 的第 26、33 行），
  manifest 的 `claim_limits` 那一条**是真的**。

### 11.5 证据是否诚实

**总体判断：这次捕获的证据是诚实的、内部一致的（除 MINOR-4 指出的那处），可复现的；
不诚实的地方是**证据机器的边角**，不是任何一条对 M4B 能力的主张。** 逐条：

- **可复现**：已提交 `docs/evidence/WAVE2/evidence-manifest-m4b.json` 与现场重新生成的
  `node tools/wave2-m4b-evidence-manifest.mjs 25df0cb… <out>` **逐字段相同**（只有 `branch` 一项，
  因为副本是 detached HEAD；真实树上相同）。✓
- **门通过**：在 `15dac08` 的副本上对已提交 manifest 跑门 → **16 PASS / 0 FAIL**。✓
- **捕获日志完整**：`25df0cb…` 目录里 17 条命令各有 `.cmd`/`.txt`/`.exit`；
  `wave1-integrity` 与 `m4a-integrity` 按设计为 1、其余全为 0；`overall.txt` = 0；
  无诊断文件；`environment.txt` 记了
  `expected_failure_commands=wave1-integrity,m4a-integrity`、`repo_dirty_at_capture=0`、
  `interaction=headless,muted,no-window,no-focus-steal,no-network,no-payment`、
  `openfilm_upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。✓
- **捕获记录的数字与实测一致**：`check.txt` 记 76 个测试文件 / 915 个测试全过 + golden 8/8 +
  构建成功；`wave2-m4b.txt` 记 6 个文件 / 59 个测试全过（我在副本上重跑同样是 59 全过）。✓
- **失败索引诚实**：`known_failed_captures` 17 条，每条带 `kept: true` 与
  「它不是一次通过的运行的证据，也永远不会被当作一次」这句说明；
  两条 current-tip 历史门（`wave1-integrity`、`m4a-integrity`）的非零被**保留**而没有调绿，
  它们的 historical 门（`wave1-historical`、`m4a-historical`）是 0。✓
- **`route_status.history_restore: false`**：门对**捕获树**核过 `/history/restore` 未挂载
  （`src/host/server.ts` 自 `10d96e5` 起未变）。✓
- **`claim_limits` 逐条核对**：冻结失败并集确实是 `409 | 422 | 423 | 428 | 500`
  （`src/contracts/wave2-types.ts:218`），关于 500/503 的边界说明属实；
  「900 帧三片段」属实；「Wave 1 / M4A 的 current-tip 门按设计失败」与 exit 一致；
  「不匹配任一 digest 即终态 attention」与 `adoption-coordinator.ts` 的 latch 一致；
  关于 `credential-scan-m4b.json` 是 `be93a183…` 那次 FAIL 扫描的说法**为真**。✓
- **case 文件**：TX-01…TX-08B / TX-11B / TX-14 / M4B-NW / REG 的引用都被门核对过
  （引用的测试名确实存在；TX-08B 引了全部 **18** 条 crash 边界行）。
  唯一的措辞缺口在 TX-13（MINOR-5）。

### 11.6 未能判定的事项

1. **我没有跑完整的 `pnpm check`（76 个文件 / 915 个测试）**，只跑了 M4B 那一组（59 个）与
   凭据扫描。捕获的 `check.txt` 记着全绿，但那是捕获当时的记录，不是我这一轮重跑的。
   因此「`25df0cb` 之后产品代码与捕获时逐字相同」这一点，我是用
   `git diff --stat ca0708d 25df0cb`（只有 `tools/` 三个文件）**推出来的**，不是跑出来的。
2. **我没有真正执行 `pnpm evidence:wave2:m4b`**（那会写真实树）。
   MINOR-2 / MINOR-3 的失败场景是**用真实工具在副本里逐个复现**的：
   MINOR-3 用的是真的 `wave2-m4b-evidence-manifest.mjs` + 真的
   `wave2-m4b-evidence-integrity.mjs`（读到了门自己的输出与退出码），
   不是完整跑一次脚本。
3. **变体 A 下的全量 M4B 套件**跑完了：删掉 `adoption-coordinator.ts:244` 之后
   **6 个文件 / 59 个测试全过**。但我**没有**同样地跑「变体 B 下的全量套件」与
   「变体 A+B 下的全量套件」——那两条只有单条用例级别的证据。
   也就是说「删掉 `impact-service.ts:579` 之后整个套件也全绿」这一句，
   本轮**没有**全套件级别的证据，只有 TX-13 那一条用例的证据。
4. **`docs/evidence/WAVE2/security/credential-scan-m4b.json` 与 `be93a183…` 的对应关系**：
   内容与时间戳都指向那一次，但文件内部没有 capture id，仍属推断（沿用上一轮的记法）。
5. **我没有独立复核 900 帧媒体内容本身**（除通过测试里那次真实渲染 + `ffprobe` 帧计数）；
   「三片段、两侧 id 不变、中镜可原生编辑」这些断言来自测试本身。
6. **`25df0cb` 之后 M4C 会怎么捕获**：MINOR-2 描述的正是 M4C 场景，我没有 M4C 的树，无法判断
   M4C 的捕获脚本是否会自己写 `expected_failure_commands`、以及 M4C 会不会沿用这份生成器。

### 11.7 结论

**第十轮裁决：BLOCKER=0、MAJOR=0 → 满足 M4B 外审 PASS 的条件。**

第九轮的两条 MAJOR 都被真正修掉了，而且不是只改注释：门的末尾标记规则现在真的只认
`git-status-after.txt`（合成捕获 S2 实测两份实现一致），必需命令集合现在与「被检查时
物理上能包含什么」一致（在冻结提交上重新捕获不再必然失败，而被截断的捕获仍然会被抓）。
第九轮的四条 MINOR 里，两条完全修复（`checked_manifest` 现在被读、被交叉核对；
`diagnosticFor` 在共享规则那一份被排序并排除了目录），一条部分修复（「每个捕获脚本都写末尾标记」
这句假话还剩两处），一条**只修了一半**（门自己那份诊断判定仍不排除目录，两份实现在一种输入上会分歧）。

本轮**新发现**六条 MINOR：门自己那份诊断判定与共享规则会分歧（MINOR-1）、
manifest 生成器里还有第三份硬编码的预期失败集合（MINOR-2）、
门分不出「在 manifest 之后被杀的捕获」（MINOR-3）、
捕获自己那份 manifest 把自己列成失败捕获、今天重跑门是红的（MINOR-4）、
TX-13 的新回归测试只钉住「两份重读同时被删」（MINOR-5）、
「每个捕获脚本都写末尾标记」的假话还剩两处（MINOR-6）。
**没有一条让一次失败的捕获被呈现为绿色**：要么门会当场大声报错并以非零退出，
要么结论只影响 M4C 的捕获，要么只是注释与措辞。

M4B 的采用逻辑本身，本轮重新读下来是站得住的：发布的原子性、prepared 恢复、
`commitAdoption` 的单事务与回滚、projection fact 的非恒真守卫、发布边界的锁/rights/源重查、
失败重放的同键同体、以及三个原生可编辑 clip 的真实渲染证据，我没有找到新的产品缺陷。

**留给下一轮的一句话**：MINOR-2、MINOR-3、MINOR-4 三条其实是同一件事的三个面——
「证据机器的判定依赖捕获还没结束时的状态」。真正该做的修法不是给门再加几条检查，
而是把**「这份 manifest 描述的捕获，结束了没有」**变成一个由文件本身回答的问题
（例如生成器在生成时把「当前捕获」从失败索引里排除，并让门要求
「捕获目录里有 `git-status-after.txt` ⇒ `m4b-integrity` 必须在 manifest 里」）。
在那之前，这台机器仍然是**宁可判红**的，这是它目前最大的优点。
