# N1N2 038 — 静态门禁的实际结果，以及对 MAIN 预检四项关切的逐条回应

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；`HEAD=e2eff61b464d75d36598103d718cd2a75db5dfda`；索引**空**。
本文件只写自身 OWN 文档：**没有**改任何源码/测试/配置/夹具/索引（037 字节保持冻结）。

---

## 1. 038 静态门禁的实际结果（失败，保留）

| 项 | 值 |
|---|---|
| grant | `BATCH_038_GRANT.json`（`N1N2_037_STATIC_REGRESSION_RUNTIME_038`，一次、仅一条命令） |
| capture | `n1n2-claude-037-static-gates-001` |
| argv | `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts tests/architecture/m2.2-fitness.test.ts` |
| runner | 原 `run-recorded.py`，sha256 `88cd47ec…` 未改 |
| **实际 exit** | **1** |
| log sha256 | `09623992127eabd36b8f938c0c725444ffdbc131f8a59efe77af078c8fd0b58f` |
| source_changed / source_added | `[]` / `[]`（运行中输入零漂移） |
| 结果 | `Test Files 1 failed | 1 passed (2)`，`Tests 1 failed | 32 passed (33)`，10.24s |

**逐文件**：

| 文件 | 结果 |
|---|---|
| `tests/architecture/m2.2-fitness.test.ts` | **18/18 全绿** ✔ —— 含规则 1（`commitPreparedCreatedSource` 的文件+方法登记）与新加的 **1b** 合成负向（另一文件同名、同文件未登记方法**都仍报红**） |
| `tests/m2.1/openfilm-upstream-lock.test.ts` | **14/15**；**唯一失败是我自己新写的断言**（见 §2），其余 13 条原门禁**全绿** |

### 1.1 自有清理（终态之后的观察）

无自有子进程存活（无 vitest/tsc/ffprobe/ffmpeg/录制器）；`127.0.0.1:4747`/`:4748` **无监听**；
`/tmp/narralens-*` 计数 **234**（未删未扫）；`HEAD` 未变、**索引空**；
18 个候选 + 3 个夹具重算 **零漂移**（与 `n1n2-claude-037-batch-inventory.json` 逐项相等）。

---

## 2. 唯一失败的准确诊断（失败在**我的测试期望**，不在产品代码）

失败断言：`tests/m2.1/openfilm-upstream-lock.test.ts:372`

```
expected [ …(4) ] to deeply equal [ …(5) ]
- "createPinnedOpenFilmServingOwner"      // 期望里有，实际检测结果里没有
```

**为什么**：我的规则把「携带 vendor 路径的参数」识别为**名为 `vendorRoot` 的参数**。
而新增的 serving owner 工厂是：

```ts
export async function createPinnedOpenFilmServingOwner(producer: unknown, root: string, options?: {...})
```

它的**第一个参数是 `producer`，不是 `vendorRoot`** —— 这正是 PF01 的设计：**vendor 路径不是调用者给的字符串，
而是从「本模块签发的 producer」的私有登记里读出来的**（`issuedProducerRoots`）。
所以这个工厂**根本没有 vendor 路径形参**，规则自然没有检测到它 ⇒ 我的期望列表写错了一项。

**判据**：这不是「规则漏掉了入口」这一类缺陷，而是**规则目前的表达能力只认「名为 vendorRoot 的形参」**，
而 serving owner 的 vendor 路径是**经由签发的 producer 间接进入**的。
按 MAIN 的 LF05 裁决（「serving 工厂路径与调用点也要覆盖」「按来源与能力，不靠词名」），正确的表达是：

- 入口的 vendor 路径有**两种来源**：
  1. **直接**：名为 `vendorRoot` 的形参（四个 loader / `openFilmAvailability`）；
  2. **间接**：**类型为本模块自己的 `OpenFilmCacheProducerOwner`** 的形参 —— 它的 vendor 路径在 producer 的私有登记里。
- 规则对**两种**都成立：那个位置上的实参**不得是请求派生**；而且 adapter 侧还有第二道
  （`issuedProducerRoots.get(producer)` 认不出就 503 ⇒ 伪造的 producer 根本到不了 vendor 路径）。

**待放行后的确切改法**（**本轮未改**）：

1. `vendorEntryPoints()` 识别两类参数位：名为 `vendorRoot` 的，**或**类型文本含 `OpenFilmCacheProducerOwner` 的；
   于是 `createPinnedOpenFilmServingOwner` **进入**入口集合（期望列表恢复为 5 项 ✔）。
2. 新增一条**合成负向**：把请求派生的值放在 producer 位
   （`createPinnedOpenFilmServingOwner(req.headers['x'] as unknown as OpenFilmCacheProducerOwner)`）⇒ 必须报红；
   并保留「装配期字符串不报红」「无关文件不报红」两条正控。
3. 规则**不靠词名**判断「是不是请求」，仍按**类型 + 别名 + helper 传递**追 taint（与已通过的门禁行为一致）。

---

## 3. 对 MAIN 四项预检关切的逐条回应（**我同意四项**，并给出确切改法；本轮未改源码）

### 3.1 `servingFor` 的异步创建未被纳入 `#operations`，注册失败或服务关闭时 owner 无人清理 —— **成立，我同意**

现状：`servingFor()` 在 `await createPinnedOpenFilmServingOwner(...)` 之后才做 dev/ino 核对，
而**创建成功、核对失败**时，owner 已经**开了 listener**，却既没进 `#servingOwners`，也没进 `#operations`：
- `close()` 不会等它 ⇒ 服务可能在 owner 仍活着时就结束；
- 该 owner 的 listener **永远不会被关闭**（泄漏）。

**待放行后的确切改法**（在 `created-native-workspace.ts` 内）：

1. **先登记再核对**：owner 一创建出来就 `this.#servingOwners.add(owner)`（登记动作放在 dev/ino 核对**之前**），
   于是任何后续失败都由 `disposeAfterNative()` 负责关闭它 ⇒ 不再泄漏。
2. **把整个 `servingFor` 纳入 `#operations`**（与 `#produce` 同形：加入集合、结束后移除），
   于是 `close()` 的 `Promise.allSettled([...this.#operations])` **会等它结算**，关闭与创建不会交错。
3. 若创建过程中服务已进入关闭态（`this.#closing`），则**刚建好的 owner 立刻关闭**并抛原有错误。

### 3.2 `owner.close()` 先 `server.close()`，而已受理的绘制可能还要再发 HTTP 资产请求 —— **成立，我同意**

现状：`close()` 里 `server.close()` 在 `folder.drain()` **之前**执行。Node 的 `server.close()` 停止接受**新连接**，
已受理的请求继续，但**尚未发出**的后续请求（浏览器再取一张图/一个资产）会被拒（ECONNREFUSED）⇒
「已受理绘制可能继续发起页面/资产 HTTP 请求」这条裁决被违反。

**待放行后的确切改法**（在 `openfilm-upstream.ts` 内）：

1. **先结算、再断监听**：`const settlement = await folder.drain();` **在前**，
   `server.close()` + `server.closeIdleConnections()` **在后** —— 已受理的工作可以继续发起它需要的请求。
2. 「不再受理**新的生产**」由**服务侧**的 `#closing` 负责（`produceNativeCacheEntry` / `servingFor` 都已拒新），
   监听器**不是**那��道闸 ⇒ 两件事解耦，符合裁决原文。
3. 关闭后的结算若仍有未结项，仍然**如实抛出**（`settlement.open>0`），不假装干净。

### 3.3 duration 捕获是「文件存在就捕获」，可能给**既有伪造文件**签字 —— **成立，我同意**

现状：只要 draw 之后 `.film/cache/film-duration.json` 存在，就把它当作**这次 draw 的输出**并入见证。
若它其实是**上一次**留下的（或被人伪造的）文件，这次 draw 并没写它 —— 那么这次见证等于替一个**没被证明的**文件签了字。
（固定上游只在**画 film 页**且页面带出 duration 时才写它：`pageframes.mjs` 的 `if (rel === FILM_PAGE) { … if (Number.isFinite(duration)) await writeAtomic(…FILM_DURATION…) }`。）

**待放行后的确切改法**（在 `created-native-workspace.ts` 内）：

1. **只在本次 draw 真的写了它时才捕获**：比较 **PRE 闭包**里该路径的身份与 **POST 闭包**里的身份 ——
   身份**不同**（或 PRE 树里根本没有这个文件）才说明**这次 draw 写了它**；身份**相同** ⇒ 这次没写 ⇒ **不捕获**。
2. 再加一道上游自己的前提：只有 `request.rel === 'film.html'`（上游唯一会写 duration 的页面）才考虑捕获。
3. 于是「既有伪造文件」既不会被这次见证授权，也不会因为一次无关的绘制而被签字；
   而**真实两次合法绘制**（PF02 的 N8）仍能由**各自**的真实输出证明各自的 duration（第二次的身份与第一次不同 ⇒ 捕获 ✔）。

### 3.4 「连续两次不同 frame」的真实用例（N8）没有找到 —— **成立，我同意，确实缺**

现状：PF02 的测试只有「一次真实 draw + 被等字节替换的负向」；
**没有**「两次不同 frame 的连续合法绘制 ⇒ 当前 metadata 由**最新**active 授权证明，而**第一次**的 frame 三件套**仍然可消费**」。

**待放行后的确切改法**（`tests/agent-driven/integration/native-cache-witness.test.ts`）：

1. 第一次绘制 **film.html / ms=0**（frame A），第二次绘制 **film.html / ms=1**（frame B，另一个 key）。
2. 断言：两个 key 的三件套**各自**被自己的见证覆盖（`cacheWitness` 按 key 命中）；
   **当前**的 duration 由**最新** active 见证覆盖（`cacheWitnessByOutput`）；
   第一次的 frame 三件套**仍然可消费**（读者接受）—— 即 duration 的更新**不**让旧 frame 永久失效。
3. 该用例需要**真实上游 headless 浏览器** ⇒ 属 **HEAVY**，只能在相应运行放行内执行；本轮 **NOT_RUN**。

---

## 4. 这一轮没有发生的事（明说）

- **没有**改任何源码/测试/配置/夹具/索引；037 字节保持冻结（21 个路径零漂移）。
- **没有**跑 vitest/Host/媒体/浏览器/构建/变异/全量之外的任何东西；只跑了 038 放行的**那一条**静态门禁命令。
- 038 静态门禁**不关闭** PF01–PF03，**不**关闭原 17 项，**不**构成 PASS 或验收。
- N1..N24 **仍全部 NOT_RUN**；LF03 的 N10 **仍是静态因果推论**，没有被复现；
  PF03/LF03 的**变异/反事实**证据**仍未**主张；**没有**把「新增测试不存在」当成 old-red 证明。
- 没有新 429。
