# N1N2 059 — 修复自审报告（MAIN_RELEASE_059_CLEAR_REPAIRS）

Writer：Claude 唯一实现者，task `task_9b5c05ea4456`，dispatch `ctx_bdd7ae38429e`，
terminal `term_499fde1b-4bc4-40d0-a884-225e555d7b70`（同一实施树，未新建 writer/worktree）。
授权：`.../resume-claude-20261112/repair-058/RELEASE_059.json`（`MAIN_RELEASE_059_CLEAR_REPAIRS`）+
`MAIN_ACCEPTANCE_CRITERIA.md` + 本条决策。
执行根 W=`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，
基线 HEAD=`1d348d419120f23f45d958112ea8c43df5a04675`（**未变**，四次正式运行的 `cmd.json` 里 `git_head` 都是它）。
固定上游（只读）：`/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm` @
`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。

**本报告不是验收，也不是 PASS 声明。** 它是实现者对自己这一波的事实交代：
改了哪些字节、每条正式编号现在是什么状态、每条命令的真实 exit 与 hash、每个反事实怎么构造、
资源怎么释放、以及**哪些门没有跑**。A057-04 与所有重型用例保持 OPEN / NOT_RUN。

> **时间说明（MAIN 的更正已采纳）**：早先的 `n1n2-claude-059-ack.json` 里的 `at`
> `2026-11-14T00:00:00` 是手填的占位值，**不是实测时间，不作为执行证据**。
> 本报告里的每个时间都取自 recorder 的 `cmd.json.started_at` / `result.json.finished_at`（工具实测）。
> ACK 文件本身保留原样（不改历史），其时间字段按 MAIN 的指示视为 **unknown**。

---

## 0. 总结：逐编号状态

| 正式编号 | 状态 | 本波做了什么 | 证据 |
|---|---|---|---|
| `B01` | **实现完成，本波验证通过** | 词法遍历改为全 AST 作用域栈（function-like / 类 / 初始化器 / 默认值 / 计算名 / `this.method`），并新增**真实生产调用点枚举**断言 | `lock-006` 60/60；反事实 `cf-lock-003` 18 红 |
| `A057-01` | **实现完成，本波验证通过** | 最小 origin-form 校验 + 原 `new URL` 解析的窄 catch → 400；handler 顶层响应安全边界 | `http-003` 1/1；反事实 `cf-http-001` 真红（子进程被未捕获异常打死） |
| `A057-02` | **实现完成，本波验证通过（真实读字节观测）** | 文本预算在**首次数据读取之前**原子预占；按真实 read 系统调用计数 | `budget-008` 11/11；反事实 `cf-budget-003` 11 红 |
| `A057-03` | **实现完成，本波验证通过** | 全部摘要受捕获 size 上界 + 有界 extra-byte 探针；**读后精确身份栅栏**（dev/ino/size/mtimeNs/ctimeNs/nlink + 原路径链） | 同上；含同长度改复反例 |
| `A057-04` | **OPEN（未获实施批准，本波未动）** | 只读复核了 `independent-settlement-design-b.md`；**没有**改 producer 工厂 / bridge 计数 / close 语义 / workspace / vendor | 无代码改动 |
| `A057-05` | **代码已改；运行证据 NOT_RUN** | duration 分支与 pageframe/poster **共享**历史 witness 依赖身份核对 | 用例已写（`created-native-source-reader.test.ts` K04-c），**未跑**（需真实 fixed draw） |
| `A057-06` | **代码已改；运行证据 NOT_RUN** | posters/frames/waves 三个族**明确拒绝**（内部码 `NATIVE_SOURCE_CACHE_FAMILY_UNSUPPORTED`） | 用例已写（F05-c），**未跑** |

**未跑的重量级回归**：`tests/agent-driven/integration/created-native-source-reader.test.ts`（整文件）、
`tests/agent-driven/integration/native-cache-witness.test.ts`（整文件）、`pnpm check` 全门、
`vite build`、任何 Chrome/ffmpeg/ffprobe/真实 producer 用例、opt-in 超时用例。
**A057-04 与下一阶段接线、S01、NativeAck、Studio、A 影片、V1 一律未推进。**

---

## 1. 精确源码改动（最终字节）

| 文件 | 状态 | 最终 sha256 | 字节 |
|---|---|---|---|
| `src/adapters/openfilm/openfilm-upstream.ts` | 改 | `1583d4aba7f1a2fde487b1339745a039759d09b29fe81edc3268a76edb054e41` | 56803 |
| `src/host/agent-driven/retained-native-closure.ts` | 改 | `ef1f3db57ba42da36d216dc6e066b8662861a5f1b9cba2c3394e788da7f56e90` | 75089 |
| `src/host/agent-driven/committed-snapshot-authority.ts` | 改 | `e7277382b1b3819d1f6aaa8459dc4d2bf904169d31e614aa45ac6a7b3c610f8b` | 44152 |
| `src/host/agent-driven/created-native-source-reader.ts` | 改 | `057015a54e9daee8d08f56eadbd7b2766622f2f915f29a0ebc330e0d4cc676b6` | 79025 |
| `tests/m2.1/openfilm-upstream-lock.test.ts` | 改 | `9b2cf8525c7e51da9a7c0d9eb579b65be56a679651fcbb5bfb5bd8e1424c175a` | 58158 |
| `tests/agent-driven/integration/created-native-source-reader.test.ts` | 改 | `4880dfea7600c53c0246d384c92b3a60f52522058a42be494f33164cf9920598` | 168963 |
| `tests/agent-driven/integration/retained-native-budget.test.ts` | **新增** | `3241bdd2c8b7b958e9852db2f28bd831f5a6f70bd2c09d975c09295769e7cd9d` | 16277 |
| `tests/agent-driven/integration/openfilm-serving-url.test.ts` | **新增** | `6c02e6d3cf56f60e33cbbb74a1b56bef3eaabbb20f10bba025e41e4f3de74e2b` | 4379 |
| `tests/agent-driven/integration/helpers/native-read-byte-observer.mjs` | **新增** | `a249498702425a01cb3964ef87cfddbbd036b6998a2d03a8938a755d43b89169` | 2486 |
| `tests/agent-driven/integration/helpers/native-read-growth-child.mjs` | **新增** | `2a31e13d30b98d161a69fcd4c33a125d2733762adb65dddb75fd1b79517f5c84` | 1708 |
| `tests/fixtures/openfilm-serving-url-child.mjs` | **新增** | `db3caf37f9983bdebf69ea76795925c79a446e88a779e063235f3d402d085a41` | 2951 |
| `docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/n1n2-claude-059-ack.json` | **新增**（ACK） | 见文件 | — |

改动全部落在 `RELEASE_059.json` 的 `allow_existing` / `allow_new` 之内。
**`tests/agent-driven/integration/native-cache-witness.test.ts` 未改**（在 allow 内但不需要）。
`git diff --stat`：`6 files changed, 705 insertions(+), 182 deletions(-)`（src+tests）。

用户工作原样：未提交的 `AGENTS.md`（sha256 `37300463a72a…`，与 release 的 `protected_AGENTS_sha256` 一致）、
lane-media 的 8 个未跟踪证据目录、058 的两份方案文档，全部未动。
Git 索引未动（`git add` 一次也没有；MAIN 持有索引与 commit 权限）。

**逐文件 diff（基线 → 候选）**存于证据目录：
`n1n2-claude-059-cf-adapter-old-to-new.diff`、`n1n2-claude-059-cf-closure-old-to-new.diff`、
`n1n2-claude-059-cf-locktest-old-to-new.diff`（`diff <(git show 1d348d4:…) <当前文件>`）。

---

## 2. `B01` — vendor-path 静态门（MAJOR）

### 2.1 改了什么（`tests/m2.1/openfilm-upstream-lock.test.ts`）

- **解析种类**：`parseSource` 现在按文件后缀选 `ScriptKind.TS` / `TSX`（`:140-149`）。
  **这是本波发现的一个额外事实**：旧代码把所有 `.ts` 当 TSX 解析，而 `committed-snapshot-authority.ts`
  里有一个 `<` 使 TSX 解析把**整个类**（连同它的全部方法）吞进了一个 JSX 元素 ——
  那条门**连 authority 的类都从未看见**（本波诊断实测：该文件旧解析下 `tree.statements` 里
  **0 个 ClassDeclaration**、11 个 scope、55 个 call；改后 1 个类、70 个 scope、355 个 call）。
  `B01` 报告说的“8/10 生产站点未被枚举”因此是**下界**：其中 3 个（authority 的三处）是被 TSX 解析整个吞掉的。
- **作用域遍历**：`buildScopes`（`:362-…`）改为全 AST 作用域栈：
  function-like（函数声明/函数表达式/箭头/方法/构造器/取值器/赋值器）各开自己的 scope；
  类体开自己的 scope；**默认参数值在函数自己的 scope 求值**；
  **成员的计算名在类被书写的那一层 scope 求值**（不与方法体混层）；类的成员方法绑在类 scope 上，
  `this.helper(…)` 因此能解析到**这个类真正声明**的方法（类是 `this` 的边界，类外的同名不是）。
- **被调用者解析**：`calleeDeclaration`（名称解析 + `this.method`）与 `callableOf`（声明本身或变量持有的函数）
  取代了旧的“只认标识符 + 只认函数声明”。
- **真实生产调用点枚举**（本次的核心新增）：`loaderCallSites()`（`:…`）在 `src/` 的真实源码里
  枚举 loader 入口的调用点，断言**等于**下面这 10 条（不是“总数 10”）：

```
src/host/agent-driven/committed-snapshot-authority.ts:createPinnedOpenFilmUpstream  ×3
src/host/agent-driven/created-native-workspace.ts:createPinnedOpenFilmServingOwner
src/host/agent-driven/created-native-workspace.ts:openFilmServingBridge
src/host/engine/openfilm-composition.ts:createPinnedOpenFilmUpstream
src/host/m5/openfilm-studio-supervisor.ts:openFilmAvailability
src/host/projects/creation-source-verifier.ts:createPinnedOpenFilmUpstream
src/host/render/upstream-pin.ts:openFilmAvailability
src/host/server.ts:createPinnedOpenFilmUpstream
```
  （loader 模块自身不在这个集合里：它自己的调用由既有的独立断言检查。）
- **向量**：16 个正例（类方法 / 构造器 / 顶层箭头 / 顶层函数表达式 / 方法内箭头 / 对象字面量方法 /
  类属性初始化器 / 静态块（真实数据流）/ 跨形态 helper / 箭头 helper / 类方法里的 serving owner /
  类方法里的 bridge / **参数默认值**（函数与方法）/ **成员计算名** / **`this.method`**）
  + 8 个负例（字符串形参 / 同名非请求 / **遮蔽外层请求的参数** / 无请求的静态块 / 无关类 /
  无请求的默认值 / 无请求的计算名 / `this.method` 传非请求值）。
  **旧的正向/负向参数化族（`:770-807` 那一批）逐字保留**，一条未删未改。

### 2.2 证据

- 正式运行：`n1n2-claude-059-lock-006`，exit **0**，`60 passed (60)`，
  log sha256 `525c4bf2337d184fb812dcd795f9dffd331994c0f9b38d33021a96c2e768fd3b`，
  recorder 实测 `2026-11-14T03:38:53.876700Z → 03:39:04.816341Z`，`source_changed=[]`、`source_added=0`。
- 反事实：`n1n2-claude-059-cf-lock-003`，exit **1**，`18 failed | 42 passed (60)`，
  log sha256 `7f23dc0b55f4547db81516949ee22201c860876260920a1bd606908aa92ae519`。
  失败明细：16 个新正例（“expected +0 to be 1”，旧遍历一条都没收集到）+
  **“accepts a parameter that shadows a request of an outer scope”**（旧遍历在这里**误报**了 1 条违规：
  它把外层的 tainted 形参当成了内层遮蔽形参的值 ⇒ 旧门在两个方向上都不对）+
  **生产调用点枚举**（“expected [ …(2) ] to deeply equal [ …(10) ]”，旧遍历只枚举到 2 条）。
  **是真断言红**：不是缺模块、不是编译红、不是新 API 缺失。

### 2.3 已知边界（诚实登记）

- 污点**只**沿真实数据流走：没有真实来源的值不会 tainted（058 的 C8「globalThis.x 因同文件另一个 tainted 形参就违规」
  被 MAIN 否决，本波**没有**写这条期待）。
- 未建模：`obj.method(…)` 中 `obj` 的**类型**未知 ⇒ 不解析（只有 `this.method(…)` 有类边界内的解析）；
  `this` 在 static 方法里指向类而非实例（未区分）；成员计算名只按外层 scope 求值一次。

---

## 3. `A057-01` — 畸形请求目标外逸（MAJOR）

### 3.1 改了什么（`src/adapters/openfilm/openfilm-upstream.ts`）

- **最小 origin-form 校验**（`handle` 内，`url` 取出之后立即）：
  `!url.startsWith("/") || url.startsWith("//")` ⇒ **400 `bad address`**。
  `//[` 以 `//` 开头（authority 引用，不是路径）⇒ 在**任何解析之前**被拒。
- **原解析的窄 catch**：`new URL(url, "http://127.0.0.1").searchParams` 保持**原解析器、原语义**，
  只在外面包一层 catch ⇒ 400。**没有**换成 `URLSearchParams(raw query)`（MAIN 否决：fragment 语义不等价）。
- **handler 顶层响应安全边界**：`handle` 包住整个回答逻辑，意外异常 ⇒ **500 `unavailable`**
  （若响应头已发则只 `end()`）。**不是 400**（资源/媒体错误不是坏地址），
  **也不是成功**（500 不是 2xx）。
- 既有拒绝面逐条保留：405（method）、503（root 身份）、400（坏地址）、403（点/..、`__film` 非白名单、
  上游自己拒绝）、404（不在 root 内）、上游的 206/Range 与越界拒绝；
  `refuse()` 的**策略头在每一个回答上**（含拒绝）**未改**；Host/port 守卫未改。

### 3.2 证据

- 正式运行：`n1n2-claude-059-http-003`，exit **0**，`1 passed (1)`，
  log sha256 `f3d7e95d3566e9819d5a3ca7866f97034f302741c3e7b76021df6cdf0d0ef588`，
  recorder 实测 `03:39:22.255069Z → 03:39:31.980390Z`。
  子进程内**真实 raw socket**（`node:net` 手写请求行，不用 fetch/http.request）打到**原 owned listener**：
  `//[` ⇒ **400** + **带 CSP 策略头** + body `bad address`（证明**确实到达了原 handler**，
  不是 Node 解析器代答）；随后 `GET /hello.txt` ⇒ **200** + 字节逐字相符；
  `Host: evil.example:<port>` ⇒ 403；`/../outside.txt` ⇒ 403；`/nothing.txt` ⇒ 404。
  子进程 **exit 0**，无未捕获异常栈，serving 与 producer 都在退出前释放。
- 反事实：`n1n2-claude-059-cf-http-001`，exit **1**，log sha256
  `1feda9fa4183038075a3f8c4687640db56f34e2603c0780e81a68013250147c9`。
  旧实现的日志里是**真的崩溃**：`Error [ERR_INVALID_URL] input: '//['`，
  栈为 `at Object.handle (…/openfilm-upstream.ts:654:21)` → `at Server.<anonymous> (…:962:12)`
  → `at Server.emit (node:events:519:28)` → 进程崩溃横幅 `Node.js v22.22.1`。
  断言 `expect(stderr).not.toMatch(/ERR_INVALID_URL|Uncaught/i)` **红**（真断言红）。

---

## 4. `A057-02` / `A057-03` — 文本预算与有界摘要（MAJOR ×2）

### 4.1 改了什么（`src/host/agent-driven/retained-native-closure.ts` + authority 一处引用）

- **分类只有一个定义**：`RETAINED_NATIVE_ASSET_EXTENSIONS` 收进 closure（与 authority 原来的那份**逐字相同**，
  即 `source-digest-v1` 的那一份），authority 改为**引用它**（`committed-snapshot-authority.ts:25` + `:126-131`）。
  **未知扩展名 = 文本**（fail-closed），**known media 继续流式**、不受文本门限。
- **文本预算前置并原子预占**（`retainFile`）：在**任何字节被读之前**判单文件门限与累计门限，
  并**当场把该文件的字节记入** `#textBytesByFile`；一次文件计一次，重复 retain/重复读不重复计；
  retain 失败（增长/截短/身份漂移）时**把预占还回去**（按真实所有权：文件没有被保留 ⇒ 它的字节没有被持有）。
  `readText` 保留自己的门限判断（幂等兜底），且**不能**让 media 标签绕过文本预算
  （媒体文件走 `readText` 仍按文本门限拒绝）。
- **所有摘要受捕获 size 上界 + 有界 extra-byte 探针**：
  新增 `#hashBounded(fd, expectedBytes, relativePath)`（按捕获尺寸读恰好那么多 + 多读 1 字节探针；
  增长 ⇒ 拒、截短 ⇒ 拒、**不截断不接受**），`#hash`/`#hashSync`（读到 EOF）**已删除**；
  `hashFile` / `verifyFile` / `verify()` / `verifyFileExact` 全部走有界原语
  （`#hashBoundedSync` 已存在，只是现在人人都在用）。
- **读后精确身份栅栏**（MAIN 的追加要求）：`#identityHolds(fd, relativePath, membership)` 在
  `retainFile` / `hashFile` / `verifyFile` / `verify()` 的**数据读取之后、返回事实/true 之前**核对
  **captured identity**（dev / ino / size / mtimeNs / ctimeNs / nlink）**以及原路径链**
  （路径仍指向描述符持有的那个文件）。**同长度改复**（字节与长度不变、只有 inode 的 ctime 变）
  只有这里能抓住 —— extra-byte 探针看不见它。
- **诚实登记**：同步 guard 的**原签名与 bounded memory 保留**；本轮解决的是**字节上界**，
  **不等于**所有异常 IO 的**时间**有界（同步循环仍会阻塞事件循环）—— 时间上界登记为**未关闭项**，未谎称已修。
- 既有门限一律未放宽：`maxTextBytes 8 MiB` / `maxTotalTextBytes 64 MiB` / `maxPaths` / `maxDepth` /
  `maxDescriptors` 与 probe 的 30 s、output 上限均未动。

### 4.2 观测（按 MAIN 的更正重做）

第一版的观测**只是**累计 closure 自己的 `onReadChunk`（MAIN 的审计指出：旧 closure 不通知就“看似零读”）⇒ **已废弃**。
现在的观测是**真实的系统调用观测**：

- `vi.mock("node:fs", …)` **只**作用于本测试文件的模块图：真实 `readSync` / `openSync` 被调用、
  **真实返回值原样返回**，同时把**真实 fd → 真实路径**与**真实读字节**记录下来
  （`tests/agent-driven/integration/helpers/native-read-byte-observer.mjs` 经 `require(ESM)` 加载，
  测试与被 hoist 的 mock 工厂共享**同一份状态**）。
  ⇒ **旧 closure（不通知 `onReadChunk`）也被同样观测到**，观测不依赖被测者自报。
- `/proc/self/io` 的 `rchar` 只作**辅助**信号（进程级计数会混入别文件/并发/模块加载），**不**用来证明某文件零读。
- **突变是确定性的**：`native-read-growth-child.mjs` 是**一次性**真实变异子进程
  （`grow` 追加 / `truncate` 截半 / `rewrite` **写回同一字节**——长度、内容、摘要都不变，只有 inode 的 ctime 变）。
  父进程在**第一次真实读**发生时（wrapper 内部）`spawnSync` 这个子进程 ⇒
  **捕获 stat 之后、第一块读之后、其余摘要之前**，且父进程**在 wrapper 返回前已回收该子进程**
  （子进程 status 必须为 0，文件大小必须真的变了）。
  **没有 marker、没有 sleep、没有定时猜测。**

### 4.3 证据

- 正式运行：`n1n2-claude-059-budget-008`，exit **0**，`11 passed (11)`，
  log sha256 `96e0207ce22c7ddf2a5173ab06caeef3a9b899ed7d525cd5320e7617b86617a7`，
  recorder 实测 `03:39:13.071347Z → 03:39:20.682696Z`，`source_changed=[]`。
  11 条：单文件文本预算零读 / 累计预算零读 / known media 流式 + 未知扩展名按文本拒 /
  **hash 期间增长**（retainFile）/ **hash 期间截短** / **hash 期间同长度改复** / **rehash 增长** /
  **文件 guard** / **整树 guard** / **retain 失败时预算归还** / **retain 失败且释放失败时保留 genuine failure 与不确定性**。
- 反事实：`n1n2-claude-059-cf-budget-003`，exit **1**，`11 failed (11)`，
  log sha256 `436611d6b4897e08d5e53ef3a74cdc6fe66d753d145545802b4163c1dbaf5d28`。
  失败明细（真断言红）：6 条“promise resolved … instead of rejecting”（预算未在读前生效）、
  2 条“expected 34603008 to be less than or equal to 33554433”（**真实读字节**证明旧代码读过了捕获尺寸，
  33 MiB > 32 MiB + 1）、1 条“expected undefined to be defined”、其余同理。

### 4.4 未关闭项（诚实）

- **时间上界**：同步摘要仍是同步循环；字节有界 ≠ 时间有界。本轮未改，未声称已修。
- **重型回归未跑**：`native-cache-witness.test.ts`（含 K05/P07/P08 等旧语义）与 reader 整文件未跑。
  读后身份栅栏会让“曾经为 true 的 guard”在文件被改后变 false —— 这正是意图，
  但**旧用例里若有“改文件后期望 guard 为 true”的期待，本波无法验证**（未跑 ⇒ 登记为风险）。

---

## 5. `A057-05` — duration-alone 的历史依赖核对（MAJOR，代码已改，运行 NOT_RUN）

### 5.1 改了什么（`src/host/agent-driven/created-native-source-reader.ts`）

- `#proveWitnessDependencies(witness, files)`（新私有方法）：**共享**的依赖核对 ——
  witness 读过的每一个文件必须**在本工作副本里被保留**，且**完整身份**（sha256/bytes/dev/ino/mtime_ns/ctime_ns/nlink）
  逐字相符；缺失 ⇒ `NATIVE_SOURCE_CACHE_UNPROVEN`，不符 ⇒ `NATIVE_SOURCE_CACHE_STALE`。
- `#proveWitnessCache`（pageframe / film-poster）改为调用它（**行为不变**，K04-b 的强检查保留）。
- **duration 分支新增调用**：duration 的 witness 是「写下它的那次 draw」的 witness，
  其**依赖**（film.html 等）必须仍然成立 ⇒ 改后改复（字节与 mtime 还原、**ctime 变**）会被
  `NATIVE_SOURCE_CACHE_STALE` 拒绝。
  **不要求无关的历史输出（三元组）仍在盘**（三元组是另一个缓存族）。
- **当前 output 授权保留**：`cacheWitnessByOutput`（ledger 的 `#byOutput`）仍是「当前授权」，
  撤销后不回退到旧授权、多帧时属于最新那次 draw —— **未改**。
- `film-poster` 的「最后一次 poster、非权威」语义 —— **未改**。

### 5.2 用例（已写，**NOT_RUN**）

`tests/agent-driven/integration/created-native-source-reader.test.ts` 的 **K04-c**：
真实 fixed draw（`film.html`, ms=0，不写 poster）→ 稳定正例 → **只删三件 frame triple** →
**duration-only 仍被接受**（原规则明确：三元组缺失不撤销 duration 自身的授权）→
film 原地改后**还原字节与 mtime**、断言 **ctime 真的变了** → 新读轮必须拒绝 `NATIVE_SOURCE_CACHE_STALE`。
**需要真实 fixed draw（真实上游 + 真实浏览器），本票据未授权 ⇒ 未跑。**

### 5.3 未验证的部分（诚实）

- 该用例**只通过 `tsc`（类型检查）**，**没有运行**；其运行时行为（真实 draw 写不写 duration、
  三元组删除后的目录状态、ctime 断言）**在本波未被证明**。
- 共享化的改动**没有**跑旧的重型回归（reader/native-cache 整文件）⇒ 「旧语义未变」在本波**未被证明**。

---

## 6. `A057-06` — 未证派生媒体族（MINOR，代码已改，运行 NOT_RUN）

### 6.1 改了什么

`#classifyCache` 的 `posters/`、`frames/`、`waves/` 三个分支改为**明确拒绝**：
`NATIVE_SOURCE_CACHE_FAMILY_UNSUPPORTED`（MAIN 批准的**内部**码；**未扩 public 合同/aliases**）。
- 这三个族由上游的 `derived.mjs`（ffmpeg 链）产出，**不是**本 Host 固定并签发的 producer ⇒ 无法证明。
- **空目录仍允许**（目录白名单 `:764-765` 未动）；**已证的 probe / pageframe / film-poster 一律未改**。
- 「下一阶段原 Studio 必要 GET 的生产证明」**保留为后续接线义务，未删除**；当前 reader 无法确认时**不显示已加载**
  （reader 不再把这些族当成可用的缓存条目）。

### 6.2 用例（已写，**NOT_RUN**）

**F05-c**：用**工作副本里真实媒体文件**的**正确 upstream key**
（`sha1(path\0bytes\0round(mtimeMs)).slice(0,20)`，与 reader 的 `upstreamMediaKey` 同式）
分别造 `.film/cache/posters/<key>.jpg`、`.film/cache/frames/<key>-0-32.jpg`、`.film/cache/waves/<key>.json`，
期望读轮以 `NATIVE_SOURCE_CACHE_FAMILY_UNSUPPORTED` 拒绝，且**不删任何东西**。
**未跑**（需要真实读轮与 fixture 的完整链）。

---

## 7. `A057-04` — 保持 OPEN（未获实施批准）

- 本波**没有**修改 producer 工厂、bridge 计数、close 语义、workspace 或固定 vendor 的**任何一行**。
- 只读复核了 `C/repair-058/independent-settlement-design-b.md`（结论：原公开 API 不足，
  需 MAIN 批准的派生观测 seam 或独立 realm/子进程路线）。
- 058 方案里的 D2/D3/D5（永久隔离 / 假 module 永不 settle / 改名记 uncertain）**未实施**，
  MAIN 的判断（本波已接受）：永久 fail-closed 不是闭环。
- **状态 OPEN**：等 MAIN 的精确裁决。

---

## 8. 命令、exit、hash（全部经 recorder，cwd=W）

### 8.1 正式四串行命令（**输入运行前后不变**：每条 `source_changed=[]`、`source_added=0`）

| # | capture | argv | recorder 实测 | exit | log sha256 | 结果 |
|---|---|---|---|---|---|---|
| 1 | `n1n2-claude-059-tsc-007` | `corepack pnpm exec tsc --noEmit` | `03:38:29.519225Z → 03:38:52.327294Z` | **0** | `e3b0c44298fc…7852b855`（空日志） | 通过 |
| 2 | `n1n2-claude-059-lock-006` | `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts` | `03:38:53.876700Z → 03:39:04.816341Z` | **0** | `525c4bf2337d…8fd3b` | **60 passed (60)** |
| 3 | `n1n2-claude-059-budget-008` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/retained-native-budget.test.ts` | `03:39:13.071347Z → 03:39:20.682696Z` | **0** | `96e0207ce22c…17a7` | **11 passed (11)** |
| 4 | `n1n2-claude-059-http-003` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/openfilm-serving-url.test.ts` | `03:39:22.255069Z → 03:39:31.980390Z` | **0** | `f3d7e95d3566…ef588` | **1 passed (1)** |

### 8.2 反事实（**真断言红**，逐字备份 + 显式路径替换 + 恢复核对）

| capture | 旧实现怎么放回去 | exit | 红的断言 | log sha256 |
|---|---|---|---|---|
| `n1n2-claude-059-cf-lock-003` | 把基线的 `parseSource`(TSX) + `buildScopes` + 被调用者解析**逐字**拼进**新**测试文件（新用例保留） | **1** | 16 个新正例“expected +0 to be 1”；1 个负例被旧遍历**误报**；枚举“expected [ …(2) ] to deeply equal [ …(10) ]” | `7f23dc0b55f4…ae519` |
| `n1n2-claude-059-cf-budget-003` | 把基线的 `retained-native-closure.ts` **整份**放回（`git show 1d348d4:…`） | **1** | 11 条全红：6 条“promise resolved … instead of rejecting”、2 条“expected 34603008 to be less than or equal to 33554433”（**真实读字节**）、其余同理 | `436611d6b489…50d28` |
| `n1n2-claude-059-cf-http-001` | 把基线的 `openfilm-upstream.ts` **整份**放回 | **1** | 子进程被 `ERR_INVALID_URL` 未捕获异常打死：`expect(stderr).not.toMatch(/ERR_INVALID_URL\|Uncaught/i)` | `1feda9fa4183…147c9` |

**备份与恢复（逐字）**：`n1n2-claude-059-cf-new-{openfilm-upstream.ts,retained-native-closure.ts,openfilm-upstream-lock.test.ts}`
（证据目录内，三份当前候选的逐字副本）。恢复后逐份核对 sha256：
adapter `1583d4ab…`、closure `ef1f3db5…`、lock test `9b2cf852…` —— 与 §1 的最终值一致。
**未用 `git restore` / `git reset` / `git stash`**（一次也没有）；反事实期间也没有动 Git 索引。

### 8.3 迭代中失败/作废的 capture（全部保留，不覆盖）

| capture | exit | 事实 |
|---|---|---|
| `n1n2-claude-059-tsc-001` | 2 | `walk(node.body)` 可能 undefined（TS2345）⇒ 修 |
| `n1n2-claude-059-tsc-002` | 0 | 通过 |
| `n1n2-claude-059-lock-001` | 1 | 8 个新向量红（我把类成员用 `forEachChild` 走，丢了方法自己的 scope）⇒ 修 |
| `n1n2-claude-059-lock-002` | 0 | 通过（60/60 前身 54/54） |
| `n1n2-claude-059-lock-003` | 1 | 同上（枚举 2≠10）⇒ 修（TSX 解析） |
| `n1n2-claude-059-lock-004` | 1 | 我把类成员 scope 弄丢了 ⇒ 修 |
| `n1n2-claude-059-lock-005` | 0 | 60/60 |
| `n1n2-claude-059-lock-diag-001/002` | 1 | **诊断用**：临时诊断测试（找 authority 的类为何没被枚举）⇒ 已删除 |
| `n1n2-claude-059-budget-001` | 1 | 3 条增长用例红（子进程用 `"r+"` 覆盖写，文件**没变大**）⇒ 改为 `"a"` 追加 |
| `n1n2-claude-059-budget-002` | 0 | 7/7（第一版观测）⇒ MAIN 审计后重做 |
| `n1n2-claude-059-budget-003` | 1 | mock 工厂递归（observer 也 import node:fs）⇒ 改 |
| `n1n2-claude-059-budget-004` | 1 | 4 条红（字节断言用了累计值而非增量；uncertain 后不能再 admit）⇒ 修 |
| `n1n2-claude-059-budget-005` | 1 | **作废**：命令里误写了一个不存在的测试路径（`…/re1-main-takeover`），capture 名被占用；重跑用 `budget-006` |
| `n1n2-claude-059-budget-006` | 0 | 10/10 |
| `n1n2-claude-059-budget-007` | — | 未产生（capture 名已存在，被 recorder 拒绝） |
| `n1n2-claude-059-http-001` | 1 | body 断言没剥 chunked 框架 ⇒ 修 |
| `n1n2-claude-059-http-002` | 0 | 1/1 |
| `n1n2-claude-059-tsc-003/004/005/006` | 2/2/2/0 | 类型错误（`.mjs` 无声明 TS7016 / `readSync` position 类型 / `ts.isThis` 不存在）⇒ 修 |
| `n1n2-claude-059-cf-lock-001/002` | 1 | 第一次拼接过宽（把 `vendorRegistryNames` 一起删掉）⇒ 重做；`cf-lock-003` 为最终反事实 |
| `n1n2-claude-059-cf-budget-001/002` | 1 | 第一/二版预算用例下的旧闭包反事实 ⇒ `cf-budget-003` 为最终反事实 |

**没有一条失败被改写成通过**：每次修复都另起一个 capture，旧日志原样保留。

---

## 9. 资源 owner 与清理

| 资源 | owner | 释放方式 | 证据 |
|---|---|---|---|
| HTTP 子进程（`openfilm-serving-url-child.mjs`） | 用例 | 子进程自己 `owner.close()` + `producer.close()` 后 `exit 0`；父进程等**真实 exit** | `http-003` exit 0 |
| 预算变异子进程（`native-read-growth-child.mjs`） | 用例 | `spawnSync` **同步等待**真实退出（status 断言为 0）；每个用例一次 | `budget-008` |
| loopback 监听 | adapter（owned serving owner） | `owner.close()`：先 drain 再关监听 | `http-003` |
| 固定上游的浏览器 | 上游模块（进程级） | 本波**没有**画任何一帧 ⇒ 浏览器从未启动 | `http-003`/`budget-008` |
| 临时目录 | 用例 | `afterEach` 删除 | 两个新测试文件 |
| 描述符 | closure | `release()`/`close()`；失败的释放保留 genuine failure 并闩住不确定性 | `budget-008` 末两条 |
| 用户/未知/peer 进程 | **不是我们的** | **没有**杀任何进程；只回收自己 spawn 的子进程 | — |

无网络、无安装、无付费、无 J 盘；未读任何凭据/配置/`.env`/全量 env；
未触碰固定 vendor/pin/lockfile/Approved015/dist；未改 Git 索引。

---

## 10. 没有跑的门（全部 NOT_RUN）

1. `tests/agent-driven/integration/created-native-source-reader.test.ts` **整文件**（含 K04-c / F05-c 这两条新用例）。
2. `tests/agent-driven/integration/native-cache-witness.test.ts` **整文件**（旧 K01/K03/K04/K05/P07/P08/Q01–Q03/F02–F05 语义回归）。
3. `pnpm check` 全门、`vite build`、validator `--check`、Python golden。
4. 任何**真实 fixed draw**、真实 Chrome、ffmpeg/ffprobe、真实 producer。
5. `A057-04` 的真实 seek/JOB 超时、真实 browser/page/context 结算。
6. 下一阶段接线、S01、NativeAck、Studio、A 影片、V1 —— **一律未推进**。
7. 原 17 项要求的整体验收：**本波不宣称任何 requirement PASS**；`ORIGINAL_REQUIREMENTS.json`、
   7 条 gate 与全部历史失败证据原样保留。

---

## 11. 交给 MAIN 的风险与待裁定点

1. **旧语义回归未跑**（§4.4、§5.3）：读后身份栅栏与共享依赖核对都让某些“曾经 true”的 guard 更严；
   旧重型用例里若有此类期待，本波无法证明它们仍绿。**这是下一批最该跑的东西。**
2. **A057-05/06 的运行证据缺失**：代码已改、用例已写（且过了 `tsc`），但**未跑**。
3. **`A057-04` 仍 OPEN**：需要 MAIN 的 seam/realm/子进程裁决；本波不动其任何代码。
4. **时间上界未关闭**：同步摘要的字节有界已修，**时间**未修（诚实登记）。
5. **`.mjs` helper 的类型**：仓库没有 JavaScript 的声明文件，`require(ESM)` 是本波的选择
   （`node:fs` 的 mock 工厂与测试必须共享**同一份**状态，否则观测会分裂成两份）——
   这条取舍请 MAIN 知悉。
6. **ACK 时间字段**：按 MAIN 的指示视为 unknown；真实时间只取自 recorder。

---

## 12. 交还

唯一 writer 交还 MAIN。本波**未提交**（`git add`/`git commit` 一次也没有），
**未自签外审**，**未宣称** N1N2 / A / V1 / 下一接线就绪。
候选字节已冻结在上面的 sha256 里，等 MAIN 冻结新 commit、受影响门重跑、再由**未参与实现者**独立复审。
