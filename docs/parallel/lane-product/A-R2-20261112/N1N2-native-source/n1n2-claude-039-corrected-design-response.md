# N1N2 039 — 对 MAIN 四条修正的更正设计（**仅 OWN 文档；未改任何源码/测试/配置/夹具/索引**）

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；`HEAD=e2eff61b464d75d36598103d718cd2a75db5dfda`；索引**空**。
背景：038 静态门禁 exit 1（fitness 18/18 绿；upstream-lock 14/15，唯一失败是我自己的期望列表），
MAIN 的独立只读复核 `ctx_9614731cbcda` 正在冻结本快照的字节 ⇒ **本轮不动源码**。

MAIN 的四条更正是对的，我**全部接受**，并把更正后的设计写在这里（可直接实施，未写码）。

---

## 1. 更正一：关闭必须等「已受理的绘制」，而不是等「当前 HTTP」

**MAIN 的纠正**：`folder.drain()` 只等**当前**的 HTTP / raw probe；把它挪到 `server.close()` 之前**并不能**等住
一个**已受理、但此刻还没发请求**的绘制（此刻 HTTP 计数为 0）。正确形态必须是
**serving 自己的受理/保留账本**。

### 1.1 正确形态（serving 侧，`src/adapters/openfilm/openfilm-upstream.ts`）

```ts
interface OpenFilmServingFacts{
  ...
  /** 已受理、尚未结算的绘制数。 */
  accepted:number;
  /** 关闭中：不再受理新的绘制。 */
  closing:boolean;
  /** 所有已受理绘制结算后兑现。 */
  drained:Promise<void>;
  resolveDrained:()=>void;
}
export interface OpenFilmServingOwner{
  readonly origin:string;readonly root:string;readonly generation:number;
  /** 受理一次绘制。关闭中 ⇒ 拒绝。 */
  beginDraw():void;
  /** 这次绘制结算了（成功或失败都算）。 */
  endDraw():void;
  close():Promise<void>;
}
```

`close()` 的**确切顺序**（这是本次更正的要点）：

1. `closing = true` ⇒ **不再受理新的绘制**（拒绝新生产）；
2. `await drained` ⇒ **等所有已受理的绘制真正结算**，包括它们**之后**才会发出的 HTTP 依赖
   （此刻 HTTP 计数为 0 也在等）；
3. `await folder.drain()` ⇒ 当前在途的 HTTP 请求与真实 media probe 结算；
4. `server.close()` + `server.closeIdleConnections()` ⇒ 断监听；
5. 结算不完整时**如实抛出**（`settlement.open>0`），不假装干净。

**不**关闭共享的 producer / browser（那是 producer owner 的生命周期，跨 owner 共享，规则不许动）；
**不**引入任意的 raw base / 回调式权威。

### 1.2 私有桥（唯一被允许发起绘制的东西）

```ts
/** 只有这个私有桥可以用「本 serving 自己的事实」调用**已登记的固定 producer**。 */
export interface OpenFilmServingBridge{
  /** 用固定 producer 画一页；origin 与 root 都取自 serving 的私有事实，不来自调用者。 */
  draw(request:{readonly rel:string;readonly ms:number;readonly width:number;readonly overrides:unknown[]|null}):Promise<Buffer>;
}
/** 非本模块签发的 owner / producer ⇒ null。 */
export function openFilmServingBridge(owner:unknown,producer:unknown):OpenFilmServingBridge|null;
```

- 桥从**私有登记**取两样东西：serving 的事实（`origin` / `canonical_root` / `dev` / `ino` / `generation`）
  与 producer 的登记（`issuedCacheProducers` + `issuedProducerRoots`）⇒ **伪造的 owner 或 producer 直接没有桥** ✔。
- 桥的 `draw()`：`beginDraw()` → `producer.pageFrame({root: facts.canonical_root, base: facts.origin, ...})`
  → `endDraw()`（**成功或失败都结算**）✔ —— producer 的**真品牌与生命周期保持不变**（共享浏览器仍由 producer owner 管）✔。
- 调用者**不能**给 base、不能给回调权威：origin 与 root 永远来自 serving 的事实 ✔。

### 1.3 服务侧（`src/host/agent-driven/created-native-workspace.ts`）

- 生产入口**不再接受任何 origin 字段**（`base` 与 `serving` 都去掉）：绘制只用**服务自己登记的桥** ⇒
  「调用者提供的 base 或对象字段」彻底不再是权威 ✔（比 037 的实现更强）。
- 登记时按**确切签发 view 实例**（`HeldWorkspace`）核对：对象分配身份（桥就是本服务登记的那一个）
  + 当前 view 事实 + root-held FD 的 dev/ino + owner 代次 + 未关闭 ✔。

### 1.4 测试（MAIN 点名的那条）

**用例**：一次**真实绘制**（真实上游 headless 浏览器）先请求页面、**稍后**才请求它的资产；
测试在**第一个请求被回答之后、第二个请求还没发出**的空隙里调用 `owner.close()`。

断言：
1. 空隙里 `folder.pending()` 可能是 0（这正是「当前 HTTP 计数」骗人的地方），
   但**绘制仍在受理中**（`accepted>0`）⇒ `close()` **不得**立刻断监听；
2. **后来的资产请求仍然成功**（绘制真的完成，图片真的画出）；
3. `close()` **在绘制结算之后**才兑现，且结算不完整时**如实抛出**。

**NOT_RUN**：需要真实浏览器 ⇒ HEAVY。

---

## 2. 更正二：`servingFor` 的单飞、受理跟踪、事后复核与**立即**清理

**MAIN 的纠正**：只把 owner 放进集合只是**把泄漏推迟到 dispose**；而且**服务无法清理一个在返回 owner 之前就抛错的 await**。

### 2.1 服务侧（确切改法）

1. **单飞（single-flight）**：同一个**确切 record**（view 实例）同时只允许一次 `servingFor` 在飞：
   第二次调用**复用同一个 promise**（而不是各建一个 owner / 一个 listener）。
   ⇒ 实现形态：per-record 的 `Promise<Bridge>` 缓存 + 失败后清空（失败必须能被重试）。
2. **受理为 admitted operation**：整个 `servingFor`（含创建、核对、登记）**进入 `#operations`**，
   于是 `close()` 的 `Promise.allSettled([...this.#operations])` **会等它结算** ⇒ 创建与关闭不会交错。
3. **await 之后的复核**：拿到 owner 之后**重新**核对：当前 view 仍是那个 record（`#prepared.get(project_id) === record`）、
   `this.#closing` 仍为 false；任一不成立 ⇒ **立刻关闭刚建好的 owner** 并抛原有错误。
4. **登记失败 ⇒ 立即清理**：dev/ino 或 canonical root 的核对失败时，**当场** `await owner.close()`，
   **不**依赖 `disposeAfterNative`（MAIN 的原话：加进集合只是把泄漏推迟）。

### 2.2 工厂侧（MAIN 点名的第二半：**服务救不了抛错的 await**）

`createPinnedOpenFilmServingOwner` 里，**listen 之后**还有会抛的步骤（`realpathSync(root)`、`statSync(root)`）。
若它们抛错，listener 已经开了而 owner **从未返回** ⇒ **服务拿不到它** ⇒ 只能由**工厂自己**收拾：

```ts
try{
  facts.canonical_root = realpathSync(resolve(root));
  const info = statSync(facts.canonical_root,{bigint:true});
  facts.dev = info.dev.toString(); facts.ino = info.ino.toString();
}catch(error){
  await new Promise<void>(resolveClose=>server.close(()=>resolveClose()));  // 工厂自己关掉自己的监听
  throw error;                                                            // 不把半成品交出去
}
```
⇒ **工厂对自己的失败负责**；服务只为**已经返回**的 owner 负责 ✔。

---

## 3. 更正三：LF05 的入口识别必须按**语义能力**，不能按类型文本

**MAIN 的纠正**：`createPinnedOpenFilmServingOwner` 的 producer 形参类型是 **`unknown`**，我提的「按类型文本探测」
**依然会漏**；不许为了让规则变绿而改生产类型或改名字；`unknown` 的 fail-closed 校验必须保留。

### 3.1 正确形态：**从模块自身推导** vendor 路径的来源

规则不再猜「哪个形参叫 vendorRoot」，而是**读模块自己的事实**：

- **直接来源**：形参名为 `vendorRoot` 的导出函数（`createPinnedOpenFilmUpstream` / `createPinnedOpenFilmCacheProducer` /
  `createPinnedOpenFilmFolderServer` / `openFilmAvailability`）⇒ vendor 路径在**位置 i**；
- **间接来源**：模块里**私有登记**的读取点 —— `issuedProducerRoots.get(<形参>)`
  ⇒ vendor 路径在**那个形参的位置**（`createPinnedOpenFilmServingOwner` 的位置 0）。

两条都由**模块自己的代码**决定，不是词名猜测，也不是生产类型改动 ✔；`producer: unknown` 与
「认不出就 503」的 fail-closed 校验**原样保留** ✔。

### 3.2 规则本体

- 入口集合 = 上面两类导出函数（**5 个**，与服务里的真实集合一致）；
- 对每个入口的**vendor 位置**，检查 Host 里**每一个调用点**的实参**不是请求派生**；
- 请求的识别仍然是**类型 + 别名 + helper 传递**（不看 `req`/`body` 这些词）✔。

### 3.3 合成负向（必须全部报红）

| 负向 | 目的 |
|---|---|
| header 来源 `req.headers['x-vendor']` | 直接来源被请求污染 |
| body 来源 `request.body.vendor` | 同上，另一形态 |
| 别名 `const q = req; … q.url` | 别名不藏污点 |
| **重命名参数** `(incoming: IncomingMessage)` | 规则不靠词名 |
| **helper 传递** `pick(req)` | 污点穿过函数 |
| **producer 位** `createPinnedOpenFilmServingOwner(req.headers['x'] as unknown as ...)` | **间接来源**同样被追（这是本次更正新增的那条） |

正控：装配期字符串不报红；无关文件不报红；**五个真实入口全部被列出**（数量与名字都对）。

**NOT_RUN**：需要重跑 038 的那条静态门禁命令 ⇒ 需 MAIN 的新运行放行。

---

## 4. 更正四：duration 的来源必须同时满足 rel=film **和** PRE/POST 身份不同

**MAIN 的纠正**：`rel=film` + PRE/POST 差异是**必要**条件；**未变**的、**既有的**、**非 film** 的元数据
**永远不得**因此获得权威；N8 要求**两次合法的不同 frame 真实绘制**的真实证明。

### 4.1 确切改法

- 捕获 duration 的**充要条件**（三条同时成立）：
  1. `request.rel === 'film.html'`（固定上游唯一会写 duration 的页面：`if (rel === FILM_PAGE) { … if (Number.isFinite(duration)) await writeAtomic(…FILM_DURATION…) }`）；
  2. **PRE 树与 POST 树里该路径的身份不同**（或 PRE 树里**没有**这个文件）⇒ **这次绘制真的写了它**；
  3. 该文件在 POST 树里被**保留**（retained）并进入 pending 见证的输出，随后经既有最终全身份围栏复验 ✔。
- 于是：**既有的伪造/未变文件** ⇒ 身份相同 ⇒ **不捕获、不授权** ✔；
  **非 film 页面的绘制** ⇒ rel 不符 ⇒ **不捕获** ✔；
  **真实 film 绘制** ⇒ 身份变化 ⇒ 捕获 ✔。

### 4.2 N8（缺失的用例，仍缺）

**用例**：第一次真实绘制 **film.html / ms=0**（frame A），第二次真实绘制 **film.html / ms=1**（frame B，另一个 key）。
断言：
1. 两个 key 的三件套**各自**被**自己**的见证覆盖（按 key 命中）；
2. **当前**的 duration 由**最新**的 active 授权覆盖（`cacheWitnessByOutput` 命中第二次的见证）；
3. **第一次**的 frame 三件套**仍然可被读者接受** —— duration 的更新**不**让旧 frame 永久失效；
4. 第二次绘制**不**因第一次留下 duration 而被拒绝（既有文件 ≠ 未见证的输出）✔。

**NOT_RUN**：需要真实上游 headless 浏览器 ⇒ HEAVY。

---

## 5. 这一轮没有发生的事（明说）

- **没有**改任何源码/测试/配置/夹具/索引：037 字节保持冻结（18 候选 + 3 夹具重算**零漂移**），`HEAD` 未变，索引空。
- **没有**跑任何命令（038 之后只做了只读观察与本 OWN 文档）。
- 038 静态门禁**不关闭** PF01–PF03，**不**关闭原 17 项，**不**构成 PASS。
- N1..N24 **仍全部 NOT_RUN**；LF03 的 N10 **仍是静态因果推论**，未复现；
  PF03/LF03 的**变异/反事实**证据**仍未**主张；**没有**把「新增测试不存在」当成 old-red 证明。
- 没有新 429。
