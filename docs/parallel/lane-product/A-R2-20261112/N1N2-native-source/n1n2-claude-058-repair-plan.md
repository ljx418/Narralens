# N1N2 058 — 只读修复方案（READ_ONLY_REPAIR_DESIGN_058）

Writer：Claude implementation child，task `task_031f802dca9a`，dispatch `ctx_cb50f012865b`，
terminal `term_499fde1b-4bc4-40d0-a884-225e555d7b70`（同一实施树，未新建 writer/worktree）。
只读授权：`.../resume-claude-20261112/independent-frozen-review-057/CLAUDE_READONLY_REPAIR_DESIGN_058_SPEC.md`
+ 同目录 `MAIN_PRELIMINARY_FINDINGS.json` + `review-a/{REVIEW.md,FINDINGS.json}` + `review-b/{REVIEW.md,FINDINGS.json}`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，
HEAD `1d348d419120f23f45d958112ea8c43df5a04675`（冻结候选，未动）。

**本文件只是方案，不是实现、不是验收、不是 PASS。** 本波**没有**写任何源码/测试/pin/vendor/Approved015/dist，
**没有** git add/commit/reset/stash/checkout，**没有**跑测试/构建/Host/browser/media 工具，**没有**联网/安装/付费/读凭据或 .env，
**没有**启动新 worker。唯一写入是本文件与同名 `.json`。
用户工作原样保留（`AGENTS.md` 的 M 与 lane-media 的 8 个未跟踪证据目录仍在）。
所有运行结论一律标 `NOT_RUN`；下文引用的运行事实只来自 **MAIN 与两位独立评审已归档的记录**，并注明出处。

固定上游（只读复核，未改一字节）：`/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm`，
`git rev-parse HEAD` = `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`（与 pin 一致）。本文引用其
`packages/openfilm/studio/server/pageframes.mjs` 与 `packages/openfilm/src/host.mjs` 的行号，均为该 SHA 的实际字节。

---

## 0. 编号映射与总览

| 正式编号 | 严重度 | 位置 | 本方案小节 | 需要新 pin / 改 vendor？ | 需要真实 runtime？ |
|---|---|---|---|---|---|
| `B01` | MAJOR | `tests/m2.1/openfilm-upstream-lock.test.ts:358` | §1 | 否 | 否（纯 AST） |
| `A057-01` | MAJOR | `src/adapters/openfilm/openfilm-upstream.ts:654` / `:943` | §2 | 否 | 是（真实 loopback + 子进程） |
| `A057-02` | MAJOR | `src/host/agent-driven/retained-native-closure.ts:679,685,772` | §3 | 否 | 是（真实读字节观测） |
| `A057-03` | MAJOR | `src/host/agent-driven/retained-native-closure.ts:994,1094,805,824,1066` | §4 | 否 | 是（并发增长写者） |
| `A057-04` | MAJOR | `src/adapters/openfilm/openfilm-upstream.ts:402,412,1109` + `created-native-workspace.ts:815` | §5 | 否（**明确不改 vendor/pin**） | 是（真实浏览器超时属重活） |
| `A057-05` | MAJOR | `src/host/agent-driven/created-native-source-reader.ts:1226,1239,1245,1327` | §6 | 否 | 是（真实 draw + 真实读轮） |
| `A057-06` | MINOR | `src/host/agent-driven/created-native-source-reader.ts:1205,1210,1217` | §7 | 否 | 是（真实读轮） |

**依赖顺序（必须按序）**：`A057-02` 与 `A057-03` 同落在 `retained-native-closure.ts` 的读原语上，
应作为**同一处改动**一次做完（`#hash`/`#hashSync` 的上界 + 文本预算前置），否则第二处会重复改同一段。
`A057-04` 的 adapter 改动会碰 `OpenFilmServingOwner` 的公开形状（`endDraw`），会波及
`created-native-workspace.ts` 与 `native-cache-witness.test.ts`，因此排在 `A057-01`（同一文件，早改更省冲突）之后。
`A057-05`/`A057-06` 同在 reader 的 `#classifyCache`，可与 `A057-04` 的 workspace 改动并行准备，但**同一时刻只有一个 writer**。

**统一原则（写给实施者的硬约束）**
1. 不放宽任何既有门限：`maxTextBytes 8 MiB` / `maxTotalTextBytes 64 MiB` / `maxPaths 4096` / `maxDepth 12` /
   `maxDescriptors 8192`、reader 的 probe 30 s、output 上限等**一律不动**，只把「判定」提前。
2. 不改固定 vendor、不改 pin、不改 Approved015、不改 dist。
3. 不把「wrapper 结算」当「raw 结算」，不把「文件/JSON 形状」当「producer 授权」。
4. 每一个新断言都必须**能打红旧实现**；打不红旧实现的断言不算证据。
5. 不以测试总数、后一次绿代替逐条断言的证明。

---

## 1. `B01` — vendor-path 静态门只走顶层 `FunctionDeclaration` / `ExpressionStatement`

### 1.1 现状（可复核事实）

`tests/m2.1/openfilm-upstream-lock.test.ts:324-369` 的 `buildScopes` 只做两件事：

- `:331-337` 只把**顶层** `VariableStatement` / `FunctionDeclaration` 的名字绑进 module scope；
- `:358-367` 只对**顶层** `FunctionDeclaration`（递归其体内的嵌套 `FunctionDeclaration`）与
  **顶层** `ExpressionStatement` 收集 `CallExpression`。

于是**类方法、构造器、类属性初始化器、顶层箭头/函数表达式、对象字面量方法**里的调用**一条都不进 `model.calls`**。
`:713` 的断言 `expect(vendorPathViolations(productionSources(), entries)).toEqual([])` 因此**只覆盖了 10 个生产站点中的 2 个**。
污点传播本身（`:418-492`）没有错，错的是**词法遍历的覆盖面**；`:475-478` 的被调用者解析还额外要求
`ts.isFunctionDeclaration(callee)`，所以即使调用点被收集，箭头/方法作为**被调用者**时参数也不 tainted。

生产站点实测枚举（`rg` 于 `src/`，逐个确认其所在函数形态）：

| # | 位置 | 调用 | 所在形态 | 旧遍历是否枚举 |
|---|---|---|---|---|
| 1 | `src/host/server.ts:529` | `createPinnedOpenFilmUpstream` | 构造函数(`:412`)里的对象字面量属性 `verifyStagedProject: async (root)=>{…}` | **否** |
| 2 | `src/host/render/upstream-pin.ts:112` | `openFilmAvailability` | 顶层 `export async function` | 是 |
| 3 | `src/host/engine/openfilm-composition.ts:103` | `createPinnedOpenFilmUpstream` | 顶层 `export async function` | 是 |
| 4 | `src/host/projects/creation-source-verifier.ts:61` | `createPinnedOpenFilmUpstream` | 类方法 `async prove(...)` | **否** |
| 5 | `src/host/m5/openfilm-studio-supervisor.ts:342` | `openFilmAvailability` | 私有类方法 `async #runProbe()` | **否** |
| 6 | `src/host/agent-driven/committed-snapshot-authority.ts:298` | `createPinnedOpenFilmUpstream` | 私有类方法 `async #loadAdapter()` | **否** |
| 7 | `src/host/agent-driven/committed-snapshot-authority.ts:366` | `createPinnedOpenFilmUpstream` | 类方法 | **否** |
| 8 | `src/host/agent-driven/committed-snapshot-authority.ts:403` | `createPinnedOpenFilmUpstream` | 类方法 | **否** |
| 9 | `src/host/agent-driven/created-native-workspace.ts:532` | `createPinnedOpenFilmServingOwner` | 类方法内的 async IIFE `(async()=>{…})()` | **否** |
| 10 | `src/host/agent-driven/created-native-workspace.ts:551` | `openFilmServingBridge` | 同上 | **否** |

即 **8/10 生产站点从未被这条门检查过**。这与 `B01` 的结论一致，且**不是**「当前 vendorRoot 可由 HTTP 控制」的断言。

### 1.2 修复依赖

无外部依赖（纯静态）。只需 TypeScript 编译器 API（仓库已有 `typescript@5.9.2`）。

### 1.3 精确建议路径

**唯一改动文件：`tests/m2.1/openfilm-upstream-lock.test.ts`**（不改 `src/`，不改门限）。

1. `buildScopes`（`:324-369`）改为**全 AST 作用域栈遍历**：
   - 新增 `functionLikeOf(node)`：`FunctionDeclaration | FunctionExpression | ArrowFunction | MethodDeclaration | Constructor | GetAccessor | SetAccessor`。
   - 每个 function-like 节点建一个 `LexicalScope`，绑定其**形参**（按声明身份）与**自身名字**（有名字的函数表达式）；
     其**函数体**在该 scope 内遍历；嵌套 function-like 建子 scope。
   - `ClassDeclaration` / `ClassExpression`：在**外层** scope 绑定类名；类体建一个 scope（静态块、属性初始化器、计算属性名）；
     每个方法在自己的 scope（父 = 类 scope）；**属性初始化器里的箭头**也建自己的 scope。
   - 任意层级的 `VariableStatement`：名字绑进**当前** scope；初始化器若是 function-like，则该 function-like 的函数体在**它自己的** scope 遍历。
   - **所有** `CallExpression` 都在其**所在 scope** 记录（对象字面量、箭头体、类属性初始化器、静态块、默认参数初始化器一律算）。
2. `resolveDeclaration`（`:393-401`）与污点的被调用者解析（`:475-478`）：把 `ts.isFunctionDeclaration(callee)`
   放宽为「任意 function-like 声明」，这样箭头/方法/函数表达式的**形参**也能被 tainted（参数身份按**声明节点**而非名字）。
3. `isRequestSource`（`:424-434`）**规则不变**：形参看类型注解（`IncomingMessage` 等），无类型注解时才在「本文件 import 了 node:http」时回退到名字
   （`req/request/res/response`）。类方法形参带类型注解 → 走同一条类型规则，天然覆盖。
4. `vendorEntries`（`:277-303`）**保持现有语义**：loader 模块的入口现在全是 `export async function`，断言 `:700-711` 的 6 项映射不变。
   （可选加固：让入口发现也接受 `export const x = (…) => …`；**不得**因此改动 `:700-711` 的期望值。）

### 1.4 会打红旧实现的断言（新增，旧的 `:718-825` 向量**逐字保留**）

新增「反例向量」（旧实现全部得到 0 条违规 → 期望 1 → **RED**）：

| 向量 | 形态 | 旧 | 新 |
|---|---|---|---|
| C1 | `class H { run(incoming: IncomingMessage){ createPinnedOpenFilmUpstream(incoming.url as string); } }` | 0 | 1 |
| C2 | `class H { constructor(req: IncomingMessage){ createPinnedOpenFilmUpstream(req.url as string); } }` | 0 | 1 |
| C3 | `const h = (req: IncomingMessage) => createPinnedOpenFilmUpstream(req.url as string);` | 0 | 1 |
| C4 | `const h = function (req: IncomingMessage){ return createPinnedOpenFilmUpstream(req.url as string); };` | 0 | 1 |
| C5 | `class H { run(){ const f = (req: IncomingMessage)=>createPinnedOpenFilmUpstream(req.url as string); f(q); } }`（箭头在方法内） | 0 | 1 |
| C6 | `const o = { run(req: IncomingMessage){ createPinnedOpenFilmUpstream(req.url as string); } };` | 0 | 1 |
| C7 | `class H { handler = (req: IncomingMessage) => createPinnedOpenFilmUpstream(req.url as string); }` | 0 | 1 |
| C8 | `class H { static { createPinnedOpenFilmUpstream((globalThis as any).x); } }` + 同文件另有 tainted 形参 | 0 | 1 |
| C9 | **helper 跨形态传播**：`class H { run(req: IncomingMessage){ helper(req.url as string); } } function helper(root: string){ createPinnedOpenFilmUpstream(root); }` | 0 | 1 |

新增「负例向量」（旧/新都应是 0，用来证明没有过度污点）：

| 向量 | 期望 |
|---|---|
| N1 | `class H { run(root: string){ createPinnedOpenFilmUpstream(root); } }` → 0 |
| N2 | `class H { run(req: string){ createPinnedOpenFilmUpstream(req); } }` → 0（同名不被当请求） |
| N3 | 另一文件里无关的类方法 → 0 |
| N4 | `class H { run(req: IncomingMessage){ other(req.url as string); } }`（`other` 非 loader 入口）→ 0 |

**生产站点枚举断言（本次的核心新增）**：在 `productionSources()`（不含 loader 模块本身；loader 模块另有 `:715` 的独立断言）上
断言「loader 入口调用点集合」**等于**下表（按 `(文件, 入口名)` 计数）：

```
server.ts:createPinnedOpenFilmUpstream×1, upstream-pin.ts:openFilmAvailability×1,
openfilm-composition.ts:createPinnedOpenFilmUpstream×1, creation-source-verifier.ts:createPinnedOpenFilmUpstream×1,
openfilm-studio-supervisor.ts:openFilmAvailability×1, committed-snapshot-authority.ts:createPinnedOpenFilmUpstream×3,
created-native-workspace.ts:createPinnedOpenFilmServingOwner×1, created-native-workspace.ts:openFilmServingBridge×1
```
旧实现只能枚举出 2 条 → **RED**；新实现 10 条 → GREEN。行号不写进断言（避免行漂移），但**实施时必须核对**这 10 个调用点
确实是上面 10 个（用 `rg` 复核，见 §8 的复核 argv）。
另外保留并加强 `:715` 的 loader 模块自身断言（同一套新遍历）。

### 1.5 代价 / 风险

- 纯测试文件改动，无生产行为变化；**不涉及**「当前 vendorRoot 可否被 HTTP 控制」的任何结论（`B01` 明确不是这个断言）。
- 风险：新遍历可能产生**假阳性**（把不相关的调用算成 loader 入口调用）→ 用上面的负例向量 N1–N4 与既有 `:770-807` 的
  正/负参数化族兜底；既有族**逐字保留**，不得删改。

---

## 2. `A057-01` — `new URL(req.url)` 在 handler 外逸，异常逃出 HTTP 回调

### 2.1 现状（可复核事实）

`src/adapters/openfilm/openfilm-upstream.ts`：

- `:641` `const url = req.url ?? "/"`；`:642` `rawPath = url.split("?")[0]`；`:643-645` `decodeURIComponent` 有 catch → 400；
  `:646-647` 反斜杠/NUL/冒号 → 400；`:648-652` 点开头段 → 403；`:653` `..` 段 → 403；
- `:654` **`const query = new URL(url, "http://127.0.0.1").searchParams;` —— 没有 catch**。
  WHATWG URL 解析器把 `//` 开头当作 **authority 引用**：`//[` 的 host 是未闭合的 IPv6 → 抛 `ERR_INVALID_URL`。
  MAIN 已在**内置 URL 纯解析**层面复现（其 `MAIN_PRELIMINARY_FINDINGS.json` 的 `MAIN-PRELIM-URL`）；
  **本方案未运行任何解析器**（`NOT_RUN`），此处只引用该已归档事实与源码矛盾。
- `:943-962` 的 `createServer` 回调同样**没有** try/catch：`:962` 直接 `folder.handle(req,res)`。
  Node 的 `request` 事件监听器抛出 ⇒ 未捕获异常 ⇒ 默认**进程终止**（冻结 `src/`/`tools/` 内未发现 `uncaughtException` 处理）。
- `:595-597` 的 `refuse()` 已把策略头放在**每一个**回答上（含拒绝），这点**必须保持**。
- 触发路径是公共输入：`produceNativeCacheEntry → servingFor → createPinnedOpenFilmServingOwner → loopback createServer → folder.handle`，
  不需要任何 Host 私有 hook 或调用方能力。

### 2.2 修复依赖

无（纯本地）。**不改上游**、不改 pin。**注意**：`:654` 之后的 `query` 只被 `:663` 的 `of` 参数使用，
`:689` 的 `serve(req,res,rawPath,query)` 也吃 `query`——所以替换解析方式必须**逐字保持** `query` 的语义。

### 2.3 精确建议路径（唯一改动文件：`src/adapters/openfilm/openfilm-upstream.ts`）

**(a) `:654` 之前加 origin-form 判定（把歧义目标挡在解析之前）**

```
// 请求目标必须是 origin-form：以 "/" 开头，且不是 "//"（authority 引用，不是路径）。
if (!url.startsWith("/") || url.startsWith("//")) { refuse(res, 400, "bad address"); return; }
```
`//[`、`//evil/x` 这类目标在**进入任何解析之前**就被 400 拒绝；这正是 MAIN 的「parse only a validated origin-form target」。

**(b) `:654` 的解析改为「不带 host 解释的原始 query 解析」，并且不再会抛**

```
const qIndex = url.indexOf("?");
const query = new URLSearchParams(qIndex < 0 ? "" : url.slice(qIndex + 1));
```
`URLSearchParams` 对同一段 query 的解码结果与 `new URL(url, base).searchParams` **一致**（同样的 `+`→空格与百分号解码），
但**不涉及 host**，因此 `//` 形式永远不会变成「另一个 origin」。
**兼容性**：`:663` 的 `query.get("of")`、`:689` 传给上游的 `query` 语义不变；上游自己怎么用 query 仍由上游决定。

**(c) handler 边界兜底（防止任何未来解析分支再次外逸）**

把 `:641-689` 的解析段整体放进一个 `try { … } catch { refuse(res, 400, "bad address"); return; }`，
并在 `:962` 的调用点再加一层：
```
try { folder.handle(req, res); } catch { /* 不允许异常逃出 request 监听器 */ if (!res.headersSent) refuse(res, 500, "unavailable"); else res.end(); }
```
（`:943-962` 的 Host/port 守卫、`:950` 的计数、`:954-961` 的 lifecycle 事件、`res.on("finish")` 的完成事件**全部保持不变**，
`finish` 事件仍会照常触发，`drain()` 的 finished/aborted 统计不受影响。）

**(d) 既有拒绝语义逐条保留**：405（method）、503（root 身份变了）、400（bad address）、403（点/..、`__film` 非白名单路由、
上游自己拒绝）、404（不在 root 内）、上游的 206/Range 与越界拒绝——**一条都不许因为 (a) 而改变**。
唯一的**新**拒绝是「目标不是 origin-form」→ 400。

### 2.4 会打红旧实现的测试方案

**分区 P2（新文件）**：`tests/agent-driven/integration/openfilm-serving-url.test.ts`
（子进程脚本：`tests/fixtures/openfilm-serving-url-child.mts`，用仓库自带 `tsx` 载入 TS 源码：
`process.execPath --import tsx/esm tests/fixtures/openfilm-serving-url-child.mts`）。

1. **handler 级负例（真实原 handler，不是另写 parser）**：用真实的
   `createPinnedOpenFilmFolderServer(vendorRoot, root, undefined, {headers: PAGE_ORIGIN_HEADERS})` 拿到 `serving.handle`，
   传入一个 `url = "//["`、带正确 `method/headers` 的最小 `IncomingMessage` 替身与一个记录 `writeHead/end` 的
   `ServerResponse` 替身 → 期望：**不抛异常**，且回答 **400**，且**带策略头**。
   旧实现：抛 `ERR_INVALID_URL` → **RED**。
2. **owned serving 的真实 HTTP 负例（子进程内，raw socket）**：子进程里用
   `createPinnedOpenFilmServingOwner(producer, root)` 起**真实 loopback 监听**，
   用 `node:net` 直连 `127.0.0.1:<port>`，**手写请求行**：
   `GET //[ HTTP/1.1\r\nHost: 127.0.0.1:<port>\r\nConnection: close\r\n\r\n`
   → 期望 **HTTP/1.1 400**。**不得用 `fetch`/`http.request`**（它们可能先规范化/拒绝目标，见 `A057-01` 的要求）。
   然后同一连接序列再发一次合法请求 `GET /hello.txt …` → 期望 **200** 且字节逐字相符。
   最后 `await owner.close()`，子进程 `process.exit(0)`。
   父进程断言：**子进程 exit=0**（旧实现：未捕获异常 ⇒ 子进程非 0 退出 ⇒ **RED**）、stderr 无未捕获异常栈、
   第一次 400、第二次 200 且内容相符、子进程报告 `serving.pending()===0` 且监听已关。
3. **既有语义不回退**：同一子进程里补三例——非法方法 → 405、越界路径 → 403/404、`..` → 403；
   再补一个 **Range 请求**（上游的 206）与一个**不在 root 内**的路径 → 各自仍是上游/Host 原有的拒绝，
   证明 (a)(b)(c) 没有改动既有拒绝面。
4. **无 sleep**：父进程只等子进程的 `exit` 事件（带一个上限），不做任何基于时间的成功判定。

### 2.5 代价 / 风险

- 风险：拒绝 `//` 开头的目标会**新增**一种 400。现有生产流量里没有这种目标（浏览器不发），代价可忽略；
  但这是**可见的行为变化**，须在实现说明里写明。
- 风险：(b) 换解析器必须保持 `query` 语义等价 → 用第 3 条（Range/越界/`of` 参数）回归证明等价。
- `A057-01` 的「进程终止」结论依赖「冻结 `src/` 内无 `uncaughtException` 处理」这一事实，实施时应**再次只读复核**（`rg` 一次即可）。

---

## 3. `A057-02` — 文本预算在**首次数据读取之前**没有生效（前置 hash 已读完整文件）

### 3.1 现状（可复核事实）

`src/host/agent-driven/retained-native-closure.ts`：

- `retainFile`（`:657-699`）：`:671` 打开描述符 → `:679` `fstatSync` → `:680-684` 身份/别名/尺寸检查 →
  **`:685` `const digest = this.#hash(fd);`** → `#hash`（`:994-1006`）**一路 `readSync` 到 EOF**，**没有任何 size 上界**。
- `readText`（`:756-797`）的预算在 `:772`（单文件 `maxTextBytes`）与 `:775-778`（累计 `maxTotalTextBytes`）才判，
  **在 `#hash` 之后**。
- `#readAll`（`:1010-1025`）在 `:1018` 调 `this.#onReadChunk?.(...)`；**`#hash` / `#hashSync` 不通知**。
  所以 `F06`（`tests/agent-driven/integration/created-native-source-reader.test.ts:989-1010`）断言的
  `moved.get('film.html') ?? 0 === 0` **只证明了「没有被解码读取」**，没有证明「没有被读过」。
  `F06` 用的正是**真实 authority 路径**（`acquireNativeFacts` → `#streamDigest.read` → `retainFile` → `#hash` → `readText`）。
- 另一条同型路径：workspace reader 在 `created-native-source-reader.ts:711-724` **先 retain 每一个叶子**，再分类；
  `committed-snapshot-authority.ts:449-470` 的 `#streamDigest.read` 先 `retainFile`（已 hash）再按扩展名分流。

**`R07 budgets` 的原话**：`Size checks precede bounded text read; growth, total bytes, path/depth/FD/output/time bounds have explicit rejection; no unbounded media read.`

### 3.2 修复依赖

`A057-02` 与 `A057-03` 共用同一读原语，**必须一起改**（否则第二处会重复改同一段）：
- 决策点 **D1**（见 §10）：文本/媒体的**分类由谁给出**。
  - **D1-a（推荐）**：分类规则**收进 closure 内部**，规则沿用 authority 已经在用的那一条
    （`committed-snapshot-authority.ts:126-130` 的 `ASSET_EXTENSIONS`：命中 = 媒体，否则 = 文本）。
    closure 自己导出这一个集合，authority 改为引用它（消除重复定义）。
    ⇒ `retainFile(path)` 的**公开签名不变**，4 个调用点不必改。
  - **D1-b**：`retainFile(path, kind: 'text'|'media')` 由调用方声明；4 个调用点都要改，且
    `readText` 必须拒绝「声明为 media 的文件」（否则预算可被绕过）。
- **D1-a 的代价**：一个**扩展名未知但大于 8 MiB 的媒体**会被当文本拒绝（fail-closed，与 authority 今天的行为一致：
  authority 今天也会对它走 `readText` 并被拒）。**D1-b 的代价**：分类责任外移，漏声明就会把文本当媒体（预算被绕过）。

**推荐 D1-a**，理由：与既有 authority 规则一致、调用点零改动、失败方向一致（都是拒绝）。

### 3.3 精确建议路径（唯一改动文件：`src/host/agent-driven/retained-native-closure.ts`；另加一处引用收敛）

1. **文本预算前置到「第一次数据读取之前」**：
   - `retainFile` 内，在 `:685` 之前算出该文件的类别（`D1-a`：扩展名 → 媒体/文本）。
   - **文本类**：先判单文件门限（`size > maxTextBytes` ⇒ `NATIVE_CLOSURE_BUDGET`）与累计门限
     （`total - held + size > maxTotalTextBytes` ⇒ `NATIVE_CLOSURE_BUDGET`），**在读任何字节之前**抛。
     ⇒ 「超预算的文本，一个字节都没读」成为**结构性事实**，而不是测试观察。
   - **媒体类**：不占文本预算；其摘要按 §4 的**捕获尺寸上界**流式计算（内存仍是 64 KiB 缓冲）。
   - `readText` 的 `:772-778` 判定**保留**（幂等兜底），但不再是唯一防线。
2. **累计计账不重复**：`#textBytesByFile` 已在 `readText` 用 `Math.max(held, bytes.length)` 记账（`:794`）；
   `retainFile` 前置判定时用同一张表的当前值计算 `total`，**不**提前写入（避免与 `readText` 双重计账）。
3. **媒体/文本的语义保持**：文本的 UTF-8 严格解码（`:784`，`fatal:true, ignoreBOM:true`）与
   「字节必须重新编码回自己」（`:786`）**不动**；来源身份（dev/ino/size/mtime_ns/ctime_ns/nlink）**不动**。

### 3.4 会打红旧实现的测试方案

**分区 P3**：`tests/agent-driven/integration/created-native-source-reader.test.ts`（改 `F06`）+ `native-cache-witness.test.ts`（新增 closure 用例）。

**关键点：观测必须独立于 closure 自报的计数器**，否则旧实现「没通知」就等于「没读」。
建议用 **`/proc/self/io` 的 `rchar`**（进程级读字节计数，内核给出，closure 无法隐藏；仓库已在用 `/proc/<pid>/fd`，同源）：

1. **修正后的 `F06`**（保留原用例与原断言，另加两条）：
   - 原断言保留：`acquireNativeFacts` 拒绝 `NATIVE_CLOSURE_BUDGET`。
   - 新断言 A：`/proc/self/io` 的 `rchar` 增量 **< 1 MiB**（被拒文件是 9 MiB）。
     旧实现：`retainFile` 的 `#hash` 读了 9 MiB ⇒ `rchar` 增量 ≥ 9 MiB ⇒ **RED**。
   - 新断言 B：closure 的 `onReadChunk` 计数仍为 0（`#hash` 修复后**也**必须通知 → 计数为 0 只能是因为「没读」，
     不能是因为「没通知」；两条同时成立才排除「漏通知」的解释）。
   - 注意：`rchar` 会被同进程其它读取污染 ⇒ 用「前后差值 + 阈值」而不是绝对值；阈值 1 MiB 对 9 MiB 的文件是充分分离。
2. **累计预算用例（`A057-02` 明确要求）**：多个文本文件，总量超过 `maxTotalTextBytes`（64 MiB）→
   期望：**跨线那个文件**在读之前被拒；`rchar` 增量 **小于**「若全部读完」的总量（阈值同样分离）。
   旧实现：先把每个文件 hash 完 ⇒ 增量 ≈ 总量 ⇒ **RED**。
3. **workspace reader 路径**（`A057-02` 点名的第二条路径）：同一组断言改在真实 workspace reader 轮次上跑一遍
   （reader 在 `:711-724` 先 retain 每个叶子）→ 证明「reader 也遵守先判后读」。
4. **媒体不被误伤（正向对照）**：一个 > 8 MiB 的**媒体**文件（真实 `.mp4` 诊断字节）必须**能被 retain/hash**
   （媒体路径不受 `maxTextBytes` 限制，只受捕获尺寸上界约束）→ 旧/新都应是绿，防止修复把媒体也拒了。

### 3.5 代价 / 风险

- 风险：**text-sized 媒体**（例如 5 MiB 的 mp4）在 `D1-a` 下会按文本计账 → 可能触发 `maxTotalTextBytes`。
  这是**更严**不是更松，但可能产生**新的拒绝**。缓解：`D1-a` 的媒体判定用 authority 已有的扩展名集合（视频/音频/图片扩展名），
  5 MiB 的 `.mp4` 命中 → 走媒体路径 → 不计文本预算。**未知扩展名的二进制**才会被当文本（fail-closed）。实施时须用真实项目文件清单核对一次。
- 风险：`#hash` 改为**有上界**后，若文件在枚举后被截短，摘要与字节数会变 → 必须**明确拒绝**而不是截断（见 §4）。
- 不放宽任何门限；不改变 UTF-8/身份语义；不改变 probe 的 30 s / output 上限。

---

## 4. `A057-03` — `retain/hash/verify` 用 EOF 循环，而不是**捕获尺寸**做上界

### 4.1 现状（可复核事实）

同一个文件里已经有**正确的**原语，只是没被普通路径用上：

- `#hashBoundedSync`（`:886-900`）：按**捕获尺寸**读恰好那么多字节，**再多读 1 字节必须不存在**，
  短了返回 `null`、长了返回 `null`。**只有** `verifyFileExact`（`:863`）在用它。
- `#hash`（`:994-1006`）与 `#hashSync`（`:1094-1105`）：**读到 EOF 为止**，没有捕获尺寸计数、没有「多一字节」探针、
  没有时间上限，且是**同步循环**（阻塞事件循环 → `reader.close`、子进程定时器都跑不了）。
- 使用点：`retainFile`→`#hash`（`:685`）；`hashFile`→`#hash`（`:805`）；`verifyFile`→`#hashSync`（`:824`）；
  整体 `verify()`→`#hashSync`（`:1066`）。
- `A057-03` 指出的并发增长窗口：`retainFile` 的 `fstat`（`:679`）与随后的 hash 之间，文件可被外部写者增长 ⇒
  `#hash` 一直读到当前 EOF，工作量无上界。

### 4.2 修复依赖

与 §3 同一次改动（同一文件、同一读原语）。**不需要**新依赖。

### 4.3 精确建议路径（`src/host/agent-driven/retained-native-closure.ts`）

1. 新增**一个有上界的异步摘要原语**（与 `#hashBoundedSync` 同形）：
   `#hashBounded(fd, expectedBytes, relativePath)`：
   - 按 `expectedBytes` 读**恰好**这么多（64 KiB 缓冲，内存不变）；
   - 每块**必须**通知 `onReadChunk`（**修复 `A057-02` 里「hash 漏通知」的那一半**）；
   - 读完后再读 **1 字节**：还有 ⇒ 判「文件增长了」；读不到但提前 EOF ⇒ 判「文件被截短」；
     两种都 ⇒ **明确拒绝**（`NATIVE_CLOSURE_MEMBERSHIP_MOVED`，消息与现有语义一致），**不截断、不接受**。
2. `#hash` 的两个调用点改为用它：
   - `retainFile`（`:685`）：`expectedBytes = info.size`（**捕获尺寸**，`fstat` 刚拿到的那个）；
   - `hashFile`（`:805`）：`expectedBytes = record.membership.size`（**保留时的尺寸**，不是当前尺寸）。
3. `#hashSync` 的两个调用点改为**已有的** `#hashBoundedSync`：
   - `verifyFile`（`:824`）：`expectedBytes = record.membership.size`；
   - `verify()`（`:1065`）：同上（每个 file record 自己的尺寸）。
   `#hashBoundedSync` 已经实现了「多一字节探针」，**不需要新写**。
4. hash 之后**复查身份**（`A057-03` 的 minimal correction 明确要求 "recheck exact identity after hashing"）：
   在 `retainFile` 的 hash 之后 fstat 一次，dev/ino/size/mtime_ns/ctime_ns/nlink 与捕获值不符 ⇒ 拒绝。
5. **同步循环阻塞事件循环**的问题：`:994`/`:1094` 是同步的，§4 的修复把**长度**封顶了，但**同步**本身仍在
   （`verify()` 遍历全树）。本轮**不要求**改成异步（会动 `verifyFile`/`verify` 的公开同步签名 ⇒ 影响面大），
   但**必须**在实现说明里写明：**上界来自捕获尺寸，不是时间**；并把「同步」列入已知限制（与 `A057-03` 的
   "no ... time bound or cancellation yield" 对齐：本轮解决字节上界，时间上界作为**未关闭项**登记，不谎称已修）。

### 4.4 会打红旧实现的测试方案

**分区 P3（同上文件）**，新增「并发增长」用例（`A057-03` 要求用**外部进程/屏障**在 hash 期间追加）：

1. **真实外部写者**：起一个真实子进程（`process.execPath -e`），在屏障后**持续追加**到被保留的文件
   （建议 1 MiB/次、持续数秒、有上限），主进程在追加进行中对**已保留**的文件调用 `hashFile` / `verifyFile` / `verify`。
2. 断言（新实现）：
   - 观察到的**读取字节数 ≤ 捕获尺寸 + 1**（`onReadChunk` 计数 + `/proc/self/io` 的 `rchar` 双证）；
   - 结果是**明确拒绝**（`NATIVE_CLOSURE_MEMBERSHIP_MOVED`），**不是**截断摘要、**不是**接受；
   - 清理能完成（描述符全部释放，`close()` 成功或带明确失败）。
   旧实现：`#hash` 读到当前 EOF ⇒ 读字节数 ≥ 捕获尺寸 + 追加量 ⇒ **RED**（且旧实现会**接受**一个更长文件的摘要，
   不抛错 —— 这本身就是更严重的一条：旧实现对 `hashFile` 会把增长后的内容当成有效摘要返回）。
3. **截短方向**：外部把文件截短 ⇒ 新实现读到提前 EOF ⇒ 明确拒绝；旧实现读到短 EOF 后**接受**短摘要（**RED**）。
4. **`retainFile` 窗口**：在 `retainFile` 的 hash 期间增长 ⇒ 新实现拒绝；旧实现接受（**RED**）。
   屏障的实现细节（如何在 fstat 与 hash 之间精确落点）**允许**用「子进程持续追加 + 尺寸充分大」的方式保证落入窗口
   （例如被保留文件 ≥ 32 MiB，子进程每 10 ms 追加 1 MiB）——断言只区分「捕获尺寸 + ε」与「捕获尺寸 + 增长量」，
   不依赖精确时刻。**不得**用固定 sleep 判定成功。
5. **`verifyFileExact` 不回退**：既有 `verifyFileExact` 行为必须不变（它本来就用有上界原语）→ 既有用例保持绿。

### 4.5 代价 / 风险

- 风险：把 `#hash` 改为有上界后，**合法**的「文件在保留之后被正常编辑」会从「返回新摘要」变成「明确拒绝」。
  这是**期望**行为（`R02 tamper_and_authority` 要求「同尺寸/恢复 mtime 的篡改被拒绝」），但可能影响
  既有依赖 `hashFile` 拿到「当前内容摘要」的调用点 —— `committed-snapshot-authority.ts:462` 的媒体摘要
  正是要「保留时的字节」，语义一致。实施时须逐个复核 `hashFile` 的调用点。
- 未关闭项：**时间上界/取消**（同步循环）本轮不解决，登记为遗留项，不得在验收里写成已修。

---

## 5. `A057-04` — 被拒绝的 page-frame promise **不能**证明 page/browser 工作已结算

> 本节是本次方案里最需要「不自欺」的一节。三份材料必须一起读：
> `A057-04` 的正式结论、固定上游 `pageframes.mjs` 的实际字节、以及下面 §5.1 的**能力边界分析**。

### 5.1 固定上游的实际形态（只读复核，SHA `e70d9d93…`）

`packages/openfilm/studio/server/pageframes.mjs`：

```
268 function withPage(url, w, version, use) {
269   const job = queue.then(async () => {
273     const late = new Promise((_, fail) => {
274       timer = setTimeout(() => { void closeBrowser(); fail(new Error(`drawing ${…} took over ${JOB_MS/1000} s`)); }, JOB_MS);   // JOB_MS = 45_000
275     });
276     const work = pageFor(url, w, version).then(use);
278     work.catch(() => {});                       // ← raw work 的失败被上游自己吞掉
279     try { return await Promise.race([work, late]); }
281     catch (e) { forget(url, w, version); throw e; }
284     finally { clearTimeout(timer); idle = setTimeout(() => void closeBrowser(), IDLE_MS); idle.unref(); }   // IDLE_MS = 60_000
289   });
290   queue = job.then(() => {}, () => {});
291   return job;
292 }
294 function forget(url, w, version) { … open.delete(key); void page?.then((p) => p.close(), () => {}); }   // ← fire-and-forget
176 export async function closePageFrames() { … await closeBrowser(); }
183 async function closeBrowser() { const b = browser; browser = null; open.clear(); if (b) await (await b).close().catch(() => {}); }
42  let browser = null;      // ← 进程级唯一浏览器
44  const open = new Map();  // ← url → open page
46  let queue = Promise.resolve();  // ← 全部 draw 串行
```

`packages/openfilm/src/host.mjs`：`FilmPage.open`（`:294`）`waitMs=15_000`/`readyMs=FRAME_MS`、
`:338` `page.goto(..., {timeout: 60_000})`（失败时 `await film.context.close()`）；
`:381-411` `seek(t,{timeoutMs})`；`:431` `close(){ await this.context.close(); }`。

**由此得到四条硬事实**

1. **只有「resolve」才证明 raw work 结算了。** `Promise.race([work, late])` 的 **resolve 只可能来自 `work`**；
   `late` 只会 reject。所以：**wrapper resolve ⇒ raw work 已完成**（画面真的画完了，输出真的写了）。
2. **「reject」不能证明 raw work 结算了。** JOB 超时（45 s）时：上游先 `void closeBrowser()`（**不 await**），
   再 reject；`work`（`pageFor → FilmPage.open → goto`）**仍在跑**；`forget()` 的 `page.close()` 也是 fire-and-forget；
   `work.catch(()=>{})` 把 raw work 的失败吞掉，**上游不把它交出来**。
3. **`closePageFrames()` 在这条路径上**不是**结算屏障**：上游的 `void closeBrowser()` 已经把模块级 `browser` 置 `null`，
   之后再调 `closePageFrames()` → `closeBrowser()` → `b === null` → **立刻 resolve**，
   **不能**证明先前那次 `b.close()` 已经结束。这正是「`closeBrowser` 已把 `browser=null` 而真实 close 可能仍进行」的机制来源。
4. **上游的浏览器是进程级的**（`browser`/`open`/`queue` 都是模块级）：JOB 超时路径上的 `void closeBrowser()`
   **会关掉 peer owner 的浏览器**——这是上游自身的行为，Host **不能**通过「多调一次 close」去补救，
   也**不能**用「整体 kill」去「加速」。

### 5.2 结论（明确回答任务里的问题）

> **在固定 vendor 的现有公开 API（`pageFrame` / `closePageFrames`）下，Host 无法取得「真实 raw page/browser 结算」的正向证明。**
> 能取得的只有：
> - **wrapper resolve** ⇒ raw work 结算（事实 1）；
> - **Host 自己这一侧的真实结算**：serving 的在飞请求/探针（`folder.drain()`）、Host 持有的树与描述符、vendor 写出的输出三元组；
> - **失败方向没有正向证明** ⇒ 只能**fail-closed 记账**：把「未证明」记成「未证明」，保留不确定性、保留所有权、不宣称释放。

因此方案**不是**「去把 raw promise 拿到手」（拿不到），**也不是**「catch 一下重调 close」（事实 3：重调不 await 旧 close），
**也不是**「sleep 一段时间」（无证明力），**也不是**「杀掉共享 peer browser」（违反约束且伤 peer）。
可行的是：**在 adapter 层建立「每调用结算契约」，把「wrapper resolve」当作唯一正向结算证据；
把「wrapper reject」当作**未结算**，据此保留 draw 所有权、隔离 producer、保留不确定性，
并把「上游超时后可能仍在写树」的后果用**视图隔离**兜住。**

### 5.3 修复依赖 / 决策点

- **决策点 D2（结算契约的宽窄）**：
  - **D2-a（推荐，fail-closed）**：**任何**「已启动后 reject」的调用都记为**未结算**（raw unproven）。
    代价：一次普通的页面失败（上游自己的 `PageFrameError`/`FrameError`）也会让该 producer 被隔离、
    让 workspace 的不确定性被闩住（见 §5.5 的代价）。
  - **D2-b（收窄）**：用上游**已导出**的 `PageFrameError`（`pageframes.mjs:50`）区分「上游自己的领域拒绝（页不存在）」与
    「其它 reject（帧失败 / JOB 超时）」；前者仍按「未结算」处理但**不**闩住 service。
    代价：帧失败（`host.mjs` 的 `FrameError`，不在 `pageframes.mjs` 里）仍要靠**消息/类名**识别 ⇒ 依赖 pin 的字节文本；
    且 `forget()` 的 `page.close()` 在**任何**失败分支上都是 fire-and-forget ⇒ 「页关闭已结算」在两条分支上**都无法证明**。
  - **推荐 D2-a**，理由：它不需要解析上游的字符串，也不依赖「上游的错误形状」；
    它陈述的正是可证明的事实（reject ⇒ 未证明）。`A057-04` 的要求也是「不要把 race rejection 或 fire-and-forget 的浏览器关闭
    当作释放证据」。
- **决策点 D3（可测性 seam）**：确定性复现「45 s 超时」需要真实浏览器 + 45 s（重活、且不稳定）。
  为了有一个**不靠 sleep、不靠真实超时**的确定性用例，需要一个 **Host 私有注入缝**，形态与仓库既有
  `observeNativeFacts`（`committed-snapshot-authority.ts:191-256`）一致：**Host 私有注入，不是公共 HTTP 权限**。
  - 形态建议：`src/adapters/openfilm/openfilm-upstream.ts` 增加
    `export interface OpenFilmProducerTestHooks { readonly module?: (loaded: Record<string, unknown>) => Record<string, unknown>; }`
    与 `export function observeOpenFilmProducer(hooks?: OpenFilmProducerTestHooks): void`；
    `createPinnedOpenFilmCacheProducer` 在**完成 pin/摘要校验之后**、取用 `loaded` 时应用一次
    `hooks?.module?.(loaded) ?? loaded`。生产路径不设 hook ⇒ 行为完全不变。
  - 备选：**不做 seam**，只保留真实超时重活用例（§5.6）——但那样就没有「会打红旧实现」的确定性断言。

### 5.4 精确建议路径（改动文件：`src/adapters/openfilm/openfilm-upstream.ts` + `src/host/agent-driven/created-native-workspace.ts`）

**A. adapter：`OpenFilmCacheProducerOwner` 增加「每调用结算」事实**

1. `owner.pageFrame`（`:399-407`）改为**逐调用记账**：
   - `:400` 的 `if (draining) throw …` 是**启动前**拒绝 ⇒ **不**产生任何未结算事实（保住 `K05-a` 的既有期望）。
   - `:402` 真正调用 `loaded.pageFrame(...)` 之后才算「已启动」；此后：
     - **resolve** ⇒ 该调用**结算**（事实 1）；
     - **reject** ⇒ 该调用**未结算**：记入 `unsettled` 集合，并把一个**带 Host 私有 brand 的失败**抛给调用方
       （例如 `class OpenFilmRawUnsettledError extends Error`，或 WeakSet brand + 导出谓词
       `isOpenFilmRawUnsettled(error)`；brand 必须是模块私有的，不能是错误对象上的可伪造属性）。
     - `cacheProducerCalls` 的计数语义保持「已启动未结算」的个数 ⇒ **未结算的调用仍然占用在飞计数**。
2. `owner.close`（`:408-419`）改为：
   - 停止准入 → **等所有「已启动」调用结算**（resolve 的）；**未结算的调用不被当作已结算**；
   - **只要还有未结算调用，就不调用 `loaded.closePageFrames()`**（避免杀掉 peer 的浏览器；上游自己的 60 s idle
     计时器会关它，泄漏被**记为不确定性**而不是被假装干净）；
   - 若存在未结算调用 ⇒ `close()` **不返回干净结果**：按既有 `withCleanupFailures` / `genuineServingCleanupFailures`
     机制把「未结算」记成**genuine settlement failure**（与 `A057-04` 的 "cleanup uncertainty is retained if settlement
     cannot be established" 对齐）。
3. **producer 隔离**：一旦出现未结算调用，`owner.pageFrame` **拒绝新的 draw**（新的失败码，如
   `NATIVE_CACHE_PRODUCER_UNSETTLED`），直到该 owner 被关闭。⇒ 新的 draw 绝不会与一个可能仍在跑的 raw work 混在一张图上。

**B. serving/bridge：draw 所有权保留到「结算或明确放弃」**

4. `OpenFilmServingOwner.endDraw()`（`:1035-1038`）增加一个**已放弃**语义：新增
   `abandonDraw()`（或 `endDraw(abandoned: boolean)`）——**只有当该 draw 的 raw 结算被证明（或被明确记为未结算并放弃）时才允许结束它**。
   facts 里增加 `abandoned: number`。
5. `openFilmServingBridge(...).draw`（`:1101-1113`）的 `finally`（`:1109-1112`）改为：
   - 调用**正常结算** ⇒ `endDraw()`；
   - 调用**未结算失败**（带 brand）⇒ `abandonDraw()`（**不**当作正常结算），并把该事实传给 serving。
6. `createPinnedOpenFilmServingOwner` 的 `close`（`:1039-1076`）：
   - `facts.accepted > 0` 时等 `drawsSettled`；**被放弃的 draw 也必须让 close 能继续**（否则 close 永久挂住），
     所以 `abandonDraw()` 要把 accepted 计数减到 0 并**记录 `abandoned`**；
   - close 完成时，若 `abandoned > 0` ⇒ 记一条 genuine failure（沿用既有措辞
     `the page origin still has N unsettled items`），使「close 干净」这一说法**不成立**；
   - `folder.drain()`（`:1054`）仍然**先于**关监听执行 ⇒ **输入侧**的真实结算被等待；
   - 监听关闭后，任何迟到的请求必然失败 ⇒ orphan 不可能再从 Host 拿到新的输入。

**C. workspace：把「未结算」记成 genuine failure，并隔离那棵树**

7. `created-native-workspace.ts` `#produce`（`:645-898`）：
   - `:727` 的 draw 失败若带 **raw-unsettled brand** ⇒ 该失败**计入 genuine**（`:828` 的 `genuine` 列表）⇒
     `:829` `this.#uncertain = true`（sticky uncertainty：不再能出具新证明）；witness 仍按 `:822`/`:837` 撤销。
   - **树隔离**：未结算的 raw work **可能在 Host 已经释放 PRE 之后继续写 `.film/cache/pageframes/*`**。
     ⇒ 该 view 必须被**作废并重新准备**：用既有机制
     `this.#prepared.delete(projectId)`（与 `:277` 的「损坏副本可重建」同一手法）+ `#invalidateRefsOf(record)`（`:957`），
     使下一次 `prepare()`（`:261-302`）**复制一棵全新的树**（新的 `workspace-<uuid>` 目录）。
     这一步同时解决上游的 30 s 失败缓存（`pageframes.mjs:87` 的 `failures` 以 `root\0key\0version` 为键）——
     新 root ⇒ 新 id ⇒ 不会被上游的 30 s 记忆挡住。

### 5.5 会打红旧实现的测试方案

**分区 P4**：`tests/agent-driven/integration/native-cache-witness.test.ts`（用 §5.3 的 seam 注入一个**假 producer 模块**，
其 `pageFrame` **reject**，同时持有一个**永不 settle 的 raw promise**；其 `closePageFrames` 立刻 resolve（模拟 `browser===null`））。

| 用例 | 断言 | 旧实现 | 新实现 |
|---|---|---|---|
| S1 | 未结算事实可见：调用方收到的失败带 Host 私有 brand（`isOpenFilmRawUnsettled(e)===true`） | **无 brand → RED** | GREEN |
| S2 | peer 安全：存在未结算调用时，`owner.close()` **不**调用 `closePageFrames`（注入模块计数） | 旧实现会调用 → **RED** | GREEN |
| S3 | close 不干净：`owner.close()` 在有未结算调用时**不是**干净返回（抛出/报告 genuine failure） | 旧实现干净返回 → **RED** | GREEN |
| S4 | producer 隔离：未结算之后 `owner.pageFrame` 再被调用 ⇒ 拒绝（新 draw 不得与 orphan 混用） | 旧实现照常调用 → **RED** | GREEN |
| S5 | draw 所有权：未结算的 draw 之后，serving 的 `accepted`/`abandoned` 反映出来；`closeServing` 的结算**报告**未结算项（不谎称干净） | 旧实现 `endDraw` 把 accepted 归零 ⇒ close 干净 → **RED** | GREEN |
| S6 | service 闩住：workspace 在这种 draw 之后 `uncertain===true`，witness 查不到，下一次生产被拒 `NATIVE_CACHE_PRODUCTION_UNCERTAIN` | 旧实现不闩 → **RED** | GREEN |
| S7 | 树隔离：这种 draw 之后 `prepare()` 得到**新树**（目录名/ino 不同），旧树里的孤儿写入不会被下一次读轮接受 | 旧实现复用旧树 → **RED** | GREEN |
| S8 | **无 sleep**：在测试自己 resolve 那个 raw promise 之前，`owner.close()` **不得**返回（用「close 未 settle」的事实断言，不用定时器） | 旧实现立即返回 → **RED** | GREEN |
| S9 | 启动前拒绝不产生未结算事实：`K05-a`（`:655`）的既有用例**逐字保留**并仍绿 | 绿 | 绿 |

**真实重活确认（可选、NOT_RUN 默认）**：在真实 vendor 上触发 **JOB 超时**分支——让被画的页面**永远不 load**
（例如 `film.html` 内联一个永不结束的同步循环 ⇒ `load` 事件不触发 ⇒ `host.mjs:338` 的 `goto` 60 s 超时，
而 **45 s 的 JOB 计时器先到**）。可观测事实（应记录进证据）：
① wrapper 在 ≈45 s reject，消息形如 `drawing … took over 45 s`；
② 该时刻 raw work 仍在跑（`goto` 未结束）；
③ 之后 `closePageFrames()` **立刻返回**（证明 §5.1 事实 3：它不是屏障）；
④ 缓存三元组**没有**被写出来（raw work 未走到写文件那步）；
⑤ 进程**没有**崩溃。
该用例**必须**是 opt-in（类似 `NARRALENS_PHASE_REAL_TOOLS`），**不进默认 fullcheck**，耗时 ≥ 45 s ⇒ 需要 MAIN 的资源预约。

### 5.6 代价 / 风险（诚实列出）

- **D2-a 的代价**：一次普通页面失败也会隔离 producer、闩住 workspace 的不确定性、需要重新准备视图。
  这是**更严**的行为，可能影响「失败后重试」的既有期望。`A057-04` 与 `R07 cleanup_uncertainty`（sticky uncertainty
  prevents new proof）支持这种严格度，但**这是需要 MAIN 裁定的行为变化**，不能由实施者擅自决定。
- **残留不可证明项（必须如实登记，不得隐藏）**：JOB 超时后，**上游的 raw page/browser 工作是否真的停了，Host 无法证明**。
  新方案能做的是：不再宣称结算、保留所有权、隔离 producer、隔离视图、保留不确定性、并让「无迟到请求越过 serving」
  成为**结构性**事实（监听在 folder drain 之后关闭）。
- **不得**引入：固定 sleep、catch 后重调 close、杀共享 peer 浏览器、吞异常当成功、修改 vendor/pin。
- 改动会碰 `OpenFilmServingOwner` 的公开形状 ⇒ `created-native-workspace.ts` 与 `native-cache-witness.test.ts` 同步改；
  实施时**同一时刻只有一个 writer**。

---

## 6. `A057-05` — 只有 duration、没有 frame 三元组时，**依赖身份**从未被核对

### 6.1 现状（可复核事实）

`src/host/agent-driven/created-native-source-reader.ts`：

- `#classifyCache` 的 duration 分支（`:1226-1247`）只做了三件事：
  `:1239-1241` 取**当前**授权该输出的 witness（`cacheWitnessByOutput`）；`:1242-1244` 比对**输出**身份
  （`sameFileIdentity(file, output)`，`:91-94` 比 sha256/bytes/dev/ino/mtime_ns/ctime_ns/nlink）；
  `:1245` 比 `record.film === \`${film.mtime_ms}:${film.bytes}\``（**只有 mtime_ms 与 size**）。
- **没有**核对 `witness.dependencies`（`:72` 的字段）。而依赖核对只在 `#proveWitnessedCache`（`:1284-1333`）里做
  （`:1327-1331`），它**只在三元组存在时**才被调用（`:1256-1262`）。
- ⇒ 复现链（与 `A057-05` 一致）：真实 draw（`film.html`, ms=0，**不写 poster**）→ 产出 witness（含 duration 与三元组）
  → 读者只分类**当前还在的文件** → **删掉 `.jpg/.json/.stamp` 三件** → `film.html` 原地改后再**还原字节与 mtime**
  （**ctime 变**）→ 新一轮读：
  - 源副本摘要仍相符（`:735-739`）；
  - duration 的**输出身份**仍相符（字节没变）；
  - `record.film` 仍是 `mtime_ms:bytes`（还原了）⇒ 通过；
  - 三元组不在 ⇒ `#proveWitnessedCache` 不会被调用 ⇒ **依赖身份从未被比较** ⇒ **接受**。
- 新一轮读拿到的是**当前**状态（新闭包、新 ctime），但 witness 是**历史**的（记录的是 draw 时刻的身份，含 ctime_ns）
  ⇒ “fresh 闭包拿到新状态” **不能**修复历史 witness 的依赖失配。

### 6.2 修复依赖

- 与 `A057-06`（§7）**同一函数**（`#classifyCache`）⇒ 建议**同一次改动**完成，避免两次改同一分支。
- 不依赖任何新外部前置。

### 6.3 精确建议路径（唯一改动文件：`src/host/agent-driven/created-native-source-reader.ts`）

1. **抽出共享的依赖核对**（把 `#proveWitnessedCache:1327-1331` 的循环提成一个私有方法，例如
   `#proveWitnessDependencies(witness, files)`），**两处共用**：
   - `#proveWitnessedCache`（pageframe / film-poster）——行为**不变**；
   - **duration 分支新增调用**：对该 duration witness 的**每一条** dependency：
     - 该路径必须**是本工作副本里被保留的文件**（缺失 ⇒ `NATIVE_SOURCE_CACHE_UNPROVEN`）；
     - 身份必须**逐字相符**（`sameFileIdentity`，含 `ctime_ns`）⇒ 不符 ⇒ `NATIVE_SOURCE_CACHE_STALE`。
   - `A057-05` 明确要求：**不要求无关的历史输出仍在**（三元组可以不在），只要求**依赖身份**成立。
2. **「最新授权」保持现状**：`cacheWitnessByOutput`（`:1239`）取的就是该输出的**当前**授权
   （ledger 的 `#byOutput`，`native-cache-witness.ts:149-156,185,196-201,208-214`）⇒ 撤销后不回退到旧授权、
   多帧时当前授权属于最新那次 draw。**这段语义不得改动**。
3. **poster 的「非权威」语义保持**：`film-poster` 分支（`:1249-1254`）与 `#proveWitnessedCache` 里
   `kind==='film-poster'` 的「最后一次 poster」语义（`:1307-1311`）**不动**。
4. `record.film` 的 mtime_ms:bytes 比对（`:1245`）**保留**（那是上游自己的 stamp 语义），但它**不再单独承担**“这个 duration 是不是关于当前 film”的判断。

### 6.4 会打红旧实现的测试方案

**分区 P5**：`tests/agent-driven/integration/created-native-source-reader.test.ts`（K04-b 附近，`:874-906` 之后新增）。

1. **新反例（duration-only + 变更还原）**：
   - 真实 draw（`film.html`, ms=0）→ 真实读轮通过（正向对照）；
   - 删除 `.film/cache/pageframes/<key>.{jpg,json,stamp}` 三件（**只删这三件**，duration 留下）；
   - `film.html` 原地改（不同字节）→ **还原字节** → 用 `utimesSync` **还原 mtime**；
   - **断言 ctime 真的变了**（`statSync(...).ctimeMs` 与 draw 前不同）——这是「还原骗过了 mtime:size」的证据；
   - 新一轮读 ⇒ 期望拒绝 `NATIVE_SOURCE_CACHE_STALE`。
     旧实现：接受（无依赖核对）⇒ **RED**。
2. **正向对照（duration-only 且 film 未动）**：同样删掉三件、**不改 film** ⇒ 新一轮读**必须仍然接受**
   （原规则下 duration 是「关于这个 film 的缓存条目」，与 frame 三元组无关）。
   这条明确回答任务里的「正常 duration-only 是否允许按原规则明确」：**允许**，因为三元组是**另一个**缓存族，
   其缺失不撤销 duration 自身的授权；**但** film 的身份必须仍然成立。
   ⇒ 该对照在旧/新实现下都应是绿（防止修复过度收紧）。
3. **保留既有强检查**：`K04-b`（`:874-906`，保留三元组的情况）必须仍然拒绝 ⇒ 共享化不能削弱它。
4. **保留多帧/当前授权**：`Q03`（`:1707` 两个合法不同帧、`:1750` 最新授权不回退）必须仍然绿；
   `PF02`（`:1015` duration 由写下它的那次 draw 证明）必须仍然绿。
5. **不得用「强制所有 cache 不存在」绕过**（任务明确禁止）：测试必须**真的**保留 duration 文件并走完整的分类路径。

### 6.5 代价 / 风险

- 风险：duration 的依赖里可能包含**不是文本**的资产（若上游的 dependency 列表含媒体）⇒ 核对只比身份，不读内容 ⇒ 无成本。
- 风险：若某次真实 draw 的 witness 依赖里含**已被合法替换**的文件（例如缓存自身的变动），新核对会拒绝
  ⇒ 这正是 `R02 tamper_and_authority` 要求的（陈旧授权失效），但会让「陈旧 duration」被拒而不是被静默接受 —— 期望行为。

---

## 7. `A057-06` — poster / frame / wave 三个缓存族仍按**文件名与 JSON 形状**准入

### 7.1 现状（可复核事实）

`created-native-source-reader.ts` 的 `#classifyCache`：

- `:1205-1208` `.film/cache/posters/<20hex>.jpg` ⇒ **只查 media key 在不在** ⇒ 直接 `return`（无 producer 授权）；
- `:1210-1215` `.film/cache/frames/<20hex>-<n>-<w>.jpg` ⇒ 查 key + 宽度合法性 ⇒ `return`；
- `:1217-1224` `.film/cache/waves/<20hex>.json` ⇒ 解析成 object ⇒ `return`。
- 这三个族在固定上游里**不是** `pageframes.mjs` 写的：上游的 `derived.mjs:103`（posters）、`:115`（frames）、`:131`（waves）
  用 ffmpeg 产出；Host 固定的 producer 是 `pageframes.mjs`，**只写** `pageframes/<key>.{jpg,json,stamp}`、
  `film-duration.json`、`film-poster.jpg`（`pageframes.mjs:101-110`）。
  ⇒ **Host 现有的固定 producer 无法为这三个族签发授权**；要真证明它们，必须另钉上游的 `derived.mjs` 及其工具链
  ——那是**新 pin**，本轮**明确不做**（`REG existing_behavior`：no artifact/pin change）。
- 对照：**已被真证明**的族必须**不变**：probe 缓存（`:1178-1204`，用读者自己的独立 probe 逐字段比对）、
  pageframe 三元组与 film-poster（`:1256-1262` / `:1249-1254`，走 witness）。

### 7.2 修复依赖 / 决策点

- **决策点 D4**：MAIN 的指示是「优先真实证明既有 producer；**暂不支持的家族必须明确拒绝**；不能把本来承诺的 producer 核验
  改成更弱合同后宣称 R04 通过」。既然既有 producer 证明不了这三个族 ⇒ **本轮必须明确拒绝**（D4-a）。
  另一条路（D4-b：把合同显式收窄为「这些族是 retained、非权威」，并让 MAIN 显式批准）**与 MAIN 的指示冲突**，
  本方案**不推荐**，只作为记录列出。
- 「下一阶段原 Studio 必要 GET 仍须单独落实」：**拒绝发生在 Host 的读轮分类里**，不删除 Studio 的任何功能；
  但**必须**在下一阶段单独落实「Host 准备的工作副本不会带这些族」或「这些族被真证明」，否则真实 Studio 写过的工作副本会被读轮拒绝。
  这一条**明确登记为下一阶段义务**，不在本轮偷偷删掉。

### 7.3 精确建议路径（唯一改动文件：`src/host/agent-driven/created-native-source-reader.ts`）

1. `#classifyCache` 的三个分支（`:1205-1224`）改为**明确拒绝**，用一个**新而明确**的失败码（建议
   `NATIVE_SOURCE_CACHE_FAMILY_UNSUPPORTED`，**码名需 MAIN 拍板**；不得复用 `NATIVE_SOURCE_CACHE_UNKNOWN`
   ——那是「未知种类」，与「已知但本轮未证明」不是一回事）。
2. **目录白名单不动**（`:764-765` 仍允许 `.film/cache/posters|frames|waves` 三个**目录**）：
   空目录无害；**里面的文件**被上面的分支拒绝。这样「Studio 留下的空目录」不会变成另一种拒绝。
3. **已被真证明的族逐字不动**：probe（`:1178-1204`）、pageframe 三元组（`:1256-1262`）、film-poster（`:1249-1254`）。

### 7.4 会打红旧实现的测试方案

**分区 P6**：同 `created-native-source-reader.test.ts`。

1. 三个新反例（**key 必须是正确的 media key**，以免撞到更早的边界）：
   - `.film/cache/posters/<正确key>.jpg`，字节随意；
   - `.film/cache/frames/<正确key>-0-32.jpg`，字节随意；
   - `.film/cache/waves/<正确key>.json`，内容 `{}`。
   期望：读轮**明确拒绝**（新码）。
   旧实现：**接受**（只看 key/形状）⇒ **RED**。
2. **正向对照不得回退**：probe 缓存（独立 probe 比对）、pageframe 三元组、film-poster 的既有用例全部保持绿
   （`PF02` `:1015`、`K03-a` `:571`、`K04-a` `:824` 等）。
3. **不得**用「未知路径」当反例（任务与 `A057-06` 都要求打到**正确**的边界）。

### 7.5 代价 / 风险

- **真实代价**：一个**由真实 Studio 写过**的工作副本（含 posters/frames/waves）会被 Host 的读轮**拒绝**。
  这在「Host 自己准备的副本」上不会发生（固定 producer 不写这三族）。
  ⇒ 该影响必须写进实现说明与下一阶段清单（见 §7.2），**不得**用「反正不发生」搪塞。
- 风险：新失败码是**契约新增** ⇒ 需 MAIN 拍板名字，并检查是否有消费者枚举了 `NATIVE_SOURCE_CACHE_*`（仓库内已核对：
  `created-native-source-reader.test.ts` 只断言 `NATIVE_SOURCE_CACHE_FORGED` / `NATIVE_SOURCE_CACHE_UNWITNESSED`，无枚举式断言）。

---

## 8. 测试分区与建议 argv（**全部 NOT_RUN**；需 MAIN 的运行授权后才可执行）

| 分区 | 文件 | 覆盖 | 建议 argv（cwd = W） |
|---|---|---|---|
| P1 | `tests/m2.1/openfilm-upstream-lock.test.ts` | `B01` | `pnpm vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts` |
| P2 | `tests/agent-driven/integration/openfilm-serving-url.test.ts`（新） + `tests/fixtures/openfilm-serving-url-child.mts`（新） | `A057-01` | `pnpm vitest run --config vitest.config.ts tests/agent-driven/integration/openfilm-serving-url.test.ts` |
| P3 | `tests/agent-driven/integration/created-native-source-reader.test.ts`（F06 修正 + 新增） + `tests/agent-driven/integration/native-cache-witness.test.ts`（新增 closure 用例） | `A057-02` `A057-03` | `pnpm vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts tests/agent-driven/integration/native-cache-witness.test.ts` |
| P4 | `tests/agent-driven/integration/native-cache-witness.test.ts`（S1–S9） | `A057-04` | 同 P3 的第二个文件（**建议单独跑，便于隔离浏览器/子进程资源**） |
| P5/P6 | `tests/agent-driven/integration/created-native-source-reader.test.ts` | `A057-05` `A057-06` | 同 P3 的第一个文件 |
| 全门 | 仓库既有全门 | 回归 | `pnpm check`（`tsc --noEmit && vitest run --config vitest.config.ts && python3 -I tests/wave2/m4a/impact-hash.golden.py … && vite build && vite build --config vite.m5.config.ts`）；`pnpm test:m2.1` 覆盖 P1 所在的目录族 |

**复核用只读 argv（实施者自检，不产生写入）**
```
rg -n "createPinnedOpenFilmUpstream\(|openFilmAvailability\(|createPinnedOpenFilmCacheProducer\(|createPinnedOpenFilmFolderServer\(|createPinnedOpenFilmServingOwner\(|openFilmServingBridge\(" src/
rg -n "ASSET_EXTENSIONS" src/host/agent-driven/committed-snapshot-authority.ts
git -C /mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm rev-parse HEAD
```

**重活用例（opt-in，默认 fullcheck 不跑）**：`A057-04` 的真实 45 s 超时确认（§5.5 末）——需要 MAIN 的**资源预约**
（浏览器 + ≥60 s + 独占 loopback 端口），且**必须**与默认门分离。

---

## 9. 实际 runtime 前置与资源 owner / 清理

**前置（与既有捕获一致，缺一不可）**
1. 固定上游检出：`/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm` @ `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`
   （测试里的 `vendorRoot` 就是这个绝对路径：`tests/agent-driven/integration/helpers/created-project-fixture.ts:12`）。**只读**。
2. 已安装的 Playwright/Chromium（headless、静音；上游自己的 `headless: !headed` 默认不变）。
3. Node v22.22.1 / ICU 78.2 / locale en-US（冻结 fullcheck 记录的值）；仓库锁定依赖。
4. `ffprobe`（probe 用例）；Approved015 五个文件按既有路径只读，**不重建**。
5. **不需要**网络；**不读**任何凭据/配置/`.env`；**不碰** J 盘。

**资源 owner 与清理（每个用例自己拥有、必须自己释放）**

| 资源 | owner | 清理要求 |
|---|---|---|
| 临时工程目录 | 用例 | `afterEach` 删除；删除前先关掉 serving（否则监听占用目录） |
| `OpenFilmServingOwner` | 用例 | `await owner.close()`：**先 drain 再关监听**；有未结算项时 close 会**报告**（不得吞掉） |
| `OpenFilmCacheProducerOwner` | 用例 | `await owner.close()`：只有在**最后一个** owner 且**没有在飞调用**时才 `closePageFrames`；有未结算调用时**不**调用（peer 安全） |
| 共享浏览器 | **上游模块**（进程级） | Host 不单独拥有；`closePageFrames` 只在「最后 owner + 无在飞（含未结算）」时调用；上游自己的 60 s idle 计时器兜底 |
| `RetainedNativeClosure` | 用例/服务 | `release()`/`close()`；失败必须保留 primary + 全部 genuine（既有机制） |
| `A057-01` 的子进程 | 用例 | 父进程必须**回收**它（等 `exit`；失败路径要 kill + 等待退出）；**不得**留下孤儿 |
| raw socket | 用例 | 读完即 `destroy()`；子进程内关服后 `process.exit(0)` |
| 并发增长写者子进程 | 用例 | 有**上限**的追加循环，结束后必须被 kill 并回收；**不得**用固定 sleep 判定成功 |

**明确的禁止项（与任务一致）**：不改固定 vendor/pin；不杀共享 peer browser；不加 sleep 当成功；
不吞异常当成功；不降范围、不放弃原 producer；不推进 S01 / NativeAck / Studio / A 影片 / V1。

---

## 10. 需要 MAIN 裁定的决策点（本方案**不擅自决定**）

| # | 决策 | 推荐 | 备选与代价 |
|---|---|---|---|
| **D1** | 文本/媒体分类由谁给（§3.2） | **D1-a**：规则收进 closure（沿用 authority 的 `ASSET_EXTENSIONS`），`retainFile` 签名不变 | D1-b：调用方显式声明 kind → 4 个调用点改动 + `readText` 需拒绝 kind 不符；漏声明即预算被绕过 |
| **D2** | 未结算的判定宽窄（§5.3） | **D2-a**：任何「已启动后 reject」都记未结算（fail-closed） | D2-b：用上游导出的 `PageFrameError` 收窄 → 需依赖上游错误形状（pin 固定了字节，但语义脆弱）；且 `forget()` 的 page.close 在**任何**失败分支都不可证明 |
| **D3** | adapter 的 Host 私有 seam（§5.3） | **加**：形态照 `observeNativeFacts`（`committed-snapshot-authority.ts:191-256`），只在 pin/摘要校验**之后**替换模块对象 | 不加：则 A057-04 只有「真实 45 s 超时」重活用例，没有确定性、能打红旧实现的断言 |
| **D4** | poster/frame/wave 三族（§7.2） | **明确拒绝**（新码，名字待 MAIN 拍板） | 收窄合同为「retained 非权威」——与 MAIN 的指示冲突，**不推荐** |
| **D5** | `A057-04` 失败后的行为收紧 | 闩住 workspace 不确定性 + 隔离 producer + 重新准备视图 | 不闩住：则 sticky uncertainty 的既有语义（`R07 cleanup_uncertainty`）被削弱，**不推荐** |
| **D6** | `A057-01` 新增 400 的可见性 | 接受（新增「非 origin-form 目标」这一种拒绝） | 不接受：则只能靠 catch 兜底，`//` 目标会被交给上游处理，与 MAIN 要求的 400 不符 |

---

## 11. 本方案**没有**做、也**不**声称的事

- **没有**实现任何修复（无源码/测试/pin/vendor/Approved015/dist 改动）；**没有**跑任何测试/构建/Host/browser/media 工具；
  **没有**联网/安装/付费；**没有** git 写操作；**没有**读凭据/配置/`.env`；**没有**启动新 worker；**没有**读 J 盘。
- 固定上游只**只读**复核了 HEAD 与两处源文件的行号；**未改一字节**。
- 所有运行结论均为 `NOT_RUN`；上文引用的运行事实只来自 MAIN 与两位独立评审**已归档**的记录，并已注明出处。
- 本文件**不是**验收，**不**宣称任何 requirement PASS，**不**推进 S01 / NativeAck / Studio / A 影片 / V1；
  `ORIGINAL_REQUIREMENTS.json` 的 17 条、7 条 gate 与全部失败证据**原样保留**。
- 修复合入后仍需：MAIN 唯一 writer 执行 → 冻结新 SHA → **受影响门**重新验证 → **独立**复核（参与实现者不得自签外审）。
