# N1N2 039 — 集中修复候选交付（Q01–Q06 + PF03 + N8）

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；`HEAD=e2eff61b464d75d36598103d718cd2a75db5dfda`；**索引空**。
放行：`CONSOLIDATED_PREFLIGHT_CORRECTION_039.md` + `.json`（**9 个精确路径** + 3 个固定摘要 opaque 夹具）。
**没有** add/commit/reset/stash/checkout/push；**没有**改 AGENTS.md、Expected015、committed-snapshot-authority、
revision-store 生产实现、pin/配置/契约/运行器/旧 Gate、公共 DTO、EnginePort。

---

## 1. 编译的实际记录（三轮，红灯全部保留）

| capture | argv | **实际 exit** | log sha256 | 说明 |
|---|---|---|---|---|
| `n1n2-claude-039-tsc-001` | `corepack pnpm exec tsc --noEmit` | **2** | `a26a0284adb1cb557202286326596f2875e51a2ed6106bcbc4802b6b801bb939` | 唯一错误：`created-source-adoption.test.ts(670,12) TS1005 '}' expected` —— 我的行区间替换吃掉了 describe 的收尾括号 |
| `n1n2-claude-039-tsc-002` | 同上 | **2** | `641e0805d3d258128e632857e9b90d3981846936a3b03d4552549d412c9ddc17` | 三条：adoption 的 `withCleanup` 不存在（本文件用 afterEach 约定）；witness 测试的 `points.filter(point=>…)` 被 TS 当成**类型实参**解析（`Cannot find name 'point'`） |
| `n1n2-claude-039-tsc-003` | 同上 | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | **绿**：log **0 字节**（空文件摘要），`source_changed []`、`source_added []`，零漂移 |

三轮都经**未改动的** `run-recorded.py`（sha256 `88cd47ec…`）；两个红灯 capture 的文件**原样保留**，未覆盖。
两处修正都是**类型/语法**层面（039 允许范围内）：补回 describe 收尾括号；改用本文件既有的清理约定；
给 `filter` 的回调加括号（无括号时 TS 把它读成类型实参）。**没有任何断言被放宽**，没有任何生产行为因此改变。

终态（另一次工具调用读取）：exit 0、log 0 字节、626 输入零漂移；**自有清理**：无自有子进程、
4747/4748 无监听、`/tmp narralens-*` 仍 234（未删未扫）、HEAD 未变、索引空、**27 个路径重算零漂移**。

---

## 2. Q01 — 创建、关闭与并发注册（`created-native-workspace.ts`、`openfilm-upstream.ts`）

| 要求 | 实现 | 用例 |
|---|---|---|
| 整个操作在**第一个异步挂起之前**登记为受理工作 | `servingFor` 先建 `flight` promise、**先** `this.#operations.add(flight)`、**再**启动构造体 ⇒ `close()` 会等它 | **Q01-a** 构造期间 close |
| 按**确切 HeldWorkspace/view** single-flight | `#servingFlights: Map<HeldWorkspace, Promise<Bridge>>`；同一 record 的并发请求共享**同一个** flight ⇒ 一个 listener、一个 owner | **Q01-c** 两个并发请求共享一次构造（`'serving_listening'` 只发生一次） |
| 失败清除 pending，仅在事实仍有效时可重建 | finally 里 `delete(record)`；失败后不再复活失效 view | Q01-a/Q01-b |
| **工厂自己**结算它自己的 listen/后置 realpath/stat 失败 | 工厂在 `listen` 之后把 realpath/stat 包在 try 里，失败时**自己**关掉 listener 并抛 `serving_aborted`（owner 从未返回 ⇒ 服务无从负责） | 观察点 `serving_aborted` |
| service 得到 owner 后的任何 closing/lease/current-record/rootFD 比对失败 ⇒ **立即**关闭该 owner | 构造体内的 catch：`await owner.close()` **当场**关闭、保留 primary、把关闭异常并入 primary（`mergeRetainedCleanupCauses`），**不**等 dispose | **Q01-b** 构造期间 root 被换 ⇒ `NATIVE_CACHE_ORIGIN_FOREIGN` + 观察点 `serving_closed` |
| 具名生命周期观察点（不产生权威、回调后重验事实） | adapter：`serving_listening` / `serving_root_verified` / `serving_request` / `serving_aborted`；service：`serving_closed` | 由 `native-source-fixture.ts` 的 `servingLifecycle` 注入 |

---

## 3. Q02 — 实际绘制租约，而不是 HTTP 计数（`openfilm-upstream.ts`、`created-native-workspace.ts`）

- **serving 自己的受理账本**：`accepted`（已受理未结算的绘制数）、`closing`（不再受理新的绘制）、
  `drawsSettled`（最后一个绘制结算时兑现）。
- **私有桥** `openFilmServingBridge(owner, producer)`：只对**本模块签发的 owner**与**本模块签发的 producer**成立
  （`issuedServings` / `issuedCacheProducers` / `issuedProducerRoots` 三张私有表）；`draw()` 用 **serving 自己的事实**
  （origin、root）调用固定 producer，`beginDraw()`/`endDraw()` 包住**真实 pageFrame 的 Promise**（失败也结算）。
  调用者**不能**给 base、不能给回调权威、不能给 producer。
- **`close()` 的确切顺序**：标记 closing（拒新受理）→ **等全部已受理绘制真实结算**（含它们之后才发出的页面/iframe/媒体请求）
  → `folder.drain()`（在途 HTTP 与真实 raw probe）→ 断监听与闲置连接 → 结算不全时**如实抛出**。
  **多次 close 返回同一结算 promise**（`facts.closePromise`），第二次 close 不会提前返回。
- **生产入口不再接受任何 origin 字段**：request 只有 `producer`；绘制走**服务自己登记的桥**。
  激活前再次复核 serving 的 closing/liveness/generation/root 身份。
- **用例**：**Q02** 真实绘制在两个 HTTP 请求之间、当前 HTTP=0 时 close ⇒ 之后仍能发出依赖请求、绘制完成、
  close 在绘制**之后**才结算、第二次 close 等同一结算；**B0-2** 的 producer peer-close 正例**改为走私有桥**保留；
  **closed-before-draw 拒绝**保留（PF01 用例）。

---

## 4. Q03 — duration 只能证明本次真实输出（`created-native-workspace.ts` + 用例）

- 捕获 duration 的**充要条件**：`request.rel==='film.html'`（固定上游唯一会写它的地方）**且** POST 身份与 PRE 身份
  **不同**（或 PRE 树里没有该文件）⇒ 这次绘制真的写了它。既有/未变/非 film 的元数据**永远不获得授权**。
- 进入 **pending** 见证 ⇒ 经既有**最终全身份围栏**复验 ⇒ **清理确认后才 active**。
- 账本按输出路径维护**当前**授权；**撤销不回退**到更老授权（撤销时只删除指向该见证的条目）。
- **用例**：**Q03-a** 非 film 页面绘制 + 事前伪造 duration ⇒ 该见证**不含** duration、输出无授权、reader 仍拒绝；
  **Q03-b** 两次合法不同 frame（ms=0/ms=1）⇒ 两个 key 各自三件套可消费、当前 duration 属**最新**那次、旧 frame 不被绑死；
  **Q03-c** 账本本身：最新授权撤销后**没有**授权（不回退）；**PF02** 保留一次真实绘制 + 等字节新 inode 负例。

---

## 5. Q04 — 门禁覆盖语义入口与真实数据流（`openfilm-upstream-lock.test.ts`）

- **入口从模块自身事实推导**：直接来源 = `vendorRoot` 形参；**间接来源** = 模块私有 WeakMap（值类型为 `string` 的那份）
  的 `.get(<形参>)` ⇒ serving owner 的 vendor 路径位置由**模块自己的代码**决定（`producer: unknown` **原样保留**，
  fail-closed 校验不动，生产类型不改、名字不改）。
- **调用解析到真实 export**：具名 import 的**改名**（`as load`）、**命名空间** import（`OF.createPinned…`）、
  以及 **loader 模块自身的本地调用**（无 self-import）都归一到同一个入口。
- **数据流**：请求按**类型**识别；别名、重命名参数、helper 形参传播（`helper(root:string)` 从 `helper(req.url)` 得到污点）
  都被追到。**范围明说**：逐文件追踪，形参一旦在某次调用里被污染则整文件视为污染。
- **原样反例全部覆盖**（同一分析器）：header、body、别名、重命名参数、helper、**helper 形参传播**、
  **改名 import**、**命名空间 import**、**producer 位**、**loader 自调用**；正控：装配期字符串、无关文件。
- 其余 13 条原门禁（pin/固定 argv/shell 拒绝/伪造 verdict 拒绝）**原样保留**。

---

## 6. Q05 — 私有真实媒体准备必须可达（`migration-real-export.test.ts`）

- 生成之前**只移除**私有副本里那三个**精确**已复制文件（先断言该目录确实在本 case 的私有根之内）；
  **不动** canonical 固定 opaque 字节、**不动**用户媒体、**不**做前缀清扫。
- 视频**真的完整解码**（`ffmpeg -i … -f null -`，非零即失败），画面**真的**用固定 ffprobe 计帧；
  旁白**真的探测**（48 kHz、三十秒）**并真的完整解码**。
- 私有副本的 manifest 写入**真实字节摘要与真实帧数**；`AssetRegistry` 用**真实 probe**（不再用常量 900）。
- 两条真实目标 render、900 帧完整 decode、中镜真实编辑、关后重开、两次结果不同 —— **全部保留**。
- 诊断媒体**不是** A 创作影片；旧 migrator 标题页**不等于**原画面迁移；Hypit 侧明确是**既有产物/摘要**，不是 fresh 渲染。

---

## 7. Q06 — 真正跨项目 authority 负例（`created-source-adoption.test.ts`）

- **第二个真实项目**：通过 Host 自己的 API（intake → decision → projects）在**同一个 Host、同一个数据库**里创建，
  等它真的 succeeded ⇒ `activeCommit(otherProjectId)` 存在。
- **真实外来 impact**：用真实 `CreatedSourceImpactStore.create(...)` 在同一 DB 里为**那个项目**写入 impact + plan fact；
  **调用前**断言它存在且 `project_id` 确属另一个项目。
- **真实外来 transaction**：`RevisionStore.beginTransaction(...)` 为**那个项目**写入一条**真的 apply 事务**
  （kind='edit' + `operation:'agent.created_source.apply@1'`）；调用前断言其归属。
- 两次拒绝分别是**明确的 authority/ownership 错误**：`CREATED_COMMIT_PLAN_MISMATCH`（impact 与 plan 不属本项目）
  与 `CREATED_COMMIT_TRANSACTION_MISMATCH`（事务不属本项目）—— **如实记录**，不称命中更深的 SQL CAS。
- **两个项目的完整事实未变**：revision、source_digest、snapshot、approval 状态、impact 状态、transaction 状态、
  outbox 行数、idempotency 行数，前后相等。
- 保留**真实存储 hash 篡改**负例（改为断言明确的 `CREATED_COMMIT_PLAN_MISMATCH`）与既有回滚用例。

---

## 8. PF03 证据补全（`native-cache-witness.test.ts`）

- K05-c 现在**保存每个独立 genuine Error 的对象引用**（两个具名 `Error` 对象），断言**恰好一次**、且就是抛出的**那一个对象**
  （按身份比较，不是按 message）。
- **全部受理分配**按 `namespace + 单调 id + phase + path` 记录（`open`/`close` 两个观察点），断言
  **每个分配恰好一次 close 尝试**、无遗漏、无重复，**不以 fd 数字作身份**。
- 主因未被覆盖、无见证可见、服务 sticky —— 全部保留。旧 K05-a/K05-b 与 reader 多因子用例**未删**。

## 9. LF03 业务事件基数（`local-assets-host.test.ts`，第 9 个路径）

并发**不同幂等键、同一内容**的两个导入：**一份**不可变资产事实、**两份**回执、**一次**业务事件
（`outboxRowCount('asset.local.registered') === 1`）、并发上限 2、取消不漏槽 —— 全部保留并补上了事件基数这一条。
**未**改 `local-asset-registry.ts` 的生产实现（039 只授权该测试文件）。

---

## 10. 候选字节与清单

- 全路径清单（9 个批次路径 + 15 个未改候选 + 3 个夹具的 sha256/字节数）：
  `n1n2-claude-039-batch-inventory.json`；逐字备份按 `<sha256>.txt` 存于 `source-captures/`。
- 9 个批次路径：`29122f99e6ccdfaa` openfilm-upstream.ts、`2253bc1470aa6af7` created-native-workspace.ts、
  `cfe21efaa0a9542c` native-cache-witness.test.ts、`d29769cb95c0b1bd` native-source-fixture.ts、
  `31bf42ef94207fdc` openfilm-upstream-lock.test.ts、`0862247a6ddb953e` migration-real-export.test.ts、
  `8ab6dfcdc98bdef2` created-source-adoption.test.ts、`e6f1ddb662deea7c` created-impact-atomic.test.ts（未改）、
  `5c13f98cebe4bc19` local-assets-host.test.ts。
- 3 个夹具：`0427d617584264ac` / `40d825e66ee7e69a` / `e4276d5ec9199f11`（仍**未被跟踪且被忽略**，由 MAIN `git add -f`）。

## 11. 建议的下一轮运行（**全部待 MAIN 对本候选的新授权**）

1. **纯静态门禁**（与 038 同款，可先跑）：`corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts tests/architecture/m2.2-fitness.test.ts`
   —— 038 的失败点正是 LF05 的期望列表，现已改为从模块事实推导；**这是新代码**，需要真实结果。
2. **高判别力新反例（HEAVY，逐个）**：`tests/agent-driven/integration/native-cache-witness.test.ts`
   （上游 headless 浏览器；含 PF01/PF02/Q01/Q02/Q03/K05-c）→ `tests/agent-driven/integration/created-native-source-reader.test.ts`
   （真实 ffprobe）→ `tests/agent-driven/integration/local-assets-host.test.ts`（真实媒体子进程，含 LF03 的 N9/N10 与事件基数）
   → `tests/agent-driven/integration/created-source-adoption.test.ts`（Q06 的第二项目与外来权威）
   → `tests/m2.3/migration-real-export.test.ts`（Q05：真实 ffmpeg/ffprobe 与两次目标 render）
   → `tests/agent-driven/integration/created-impact-atomic.test.ts`（过期权威）。
3. **夹具相关套件**：`tests/m2.2/snapshot-store.test.ts`、`tests/m2.2/host-coordinator-integration.test.ts`、
   `tests/m2.3/migration-service.test.ts`、`tests/m2.3/openfilm-migrator.test.ts`（LF01 的三个 opaque 夹具）。
4. **变异/反事实**（单独授权）：LF03 的旧严格比较变异、PF03 的「丢掉 POST 原因」变异。
5. **最后**才是全量 `corepack pnpm check`（含两次 vite build）。

## 12. 未宣称（明说）

- 编译绿**不是** PASS，**不是**验收，**不**关闭原 17 项。
- 上面每一个新用例都**NOT_RUN**：本轮只获准编译，**没有**跑任何 vitest/Host/媒体/浏览器/构建/变异/全量。
- Q01/Q02/Q03/Q04/Q05/Q06 的修复是**静态实现 + 已写好的反例**，其**可达性尚未由运行证明**；反例的存在**不**等于 old-red。
- LF03 的 N9/N10 仍**未运行**；「旧严格比较变异必红」「丢掉 POST 原因的变异必红」的**反事实证据仍未取得**。
- 三个 opaque 夹具仍**未被跟踪**：干净 checkout 的可复现性仍待 MAIN `git add -f`。
- 不宣称 NativeAck / Studio / A 影片 / V1 / 下一接线；不自签独立外审。
