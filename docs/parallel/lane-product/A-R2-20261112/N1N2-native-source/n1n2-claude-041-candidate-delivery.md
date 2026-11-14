# N1N2 041 — 集中修正候选交付（C1–C4，四个路径；编译绿）

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；`HEAD=e2eff61b464d75d36598103d718cd2a75db5dfda`；**索引空**。
放行：`CORRECTIVE_SOURCE_RELEASE_041.md` + `.json`（**四个精确路径**）。
**没有**改 `created-native-workspace.ts`（不在白名单 ⇒ **最终 closing 围栏原样未动**）、AGENTS.md、Expected015、
公共 DTO/EnginePort、pin、配置/运行器/旧 Gate；**没有** add/commit/reset/stash/checkout/push。

---

## 1. 编译的实际记录（三轮，红灯全部保留）

| capture | **实际 exit** | log sha256 | 说明 |
|---|---|---|---|
| `n1n2-claude-041-tsc-001` | **2** | `c91ce3fe52270fab76d2b84621de79b27332cb3a5cfd212752250bd4e237bf09` | ① adapter 的观察点类型是字面量联合，装不下带载荷的模板串；② 门禁里我的 `resolve` 与 `node:path` 的 `resolve` **同名冲突**（TS2440），引发一串级联错误 |
| `n1n2-claude-041-tsc-002` | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | **绿**：log **0 字节**、`source_changed []`、`source_added []`、零漂移 |
| `n1n2-claude-041-tsc-003` | **0** | 同上 | 补完「构造间 dispose」用例后的**再次绿**（log 0 字节、零漂移） |

三轮都经**未改动的** `run-recorded.py`（`88cd47ec…`）；两个红灯 capture 原样保留、未覆盖。
两处修正都是**类型/命名**层面：观察点的类型扩展为「字面量 ∪ 模板串」（服务的强转仍然成立），
以及把我的声明解析器改名（不再与 `node:path` 的 `resolve` 冲突）。**没有任何断言被放宽**，生产行为未因此改变。

终态（另一次工具调用读取）：exit 0、log 0 字节、零漂移；**自有清理**：无自有子进程、4747/4748 无监听、
`/tmp narralens-*` 仍 234（未删未扫）、HEAD 未变、索引空、**20 个路径重算零漂移**。

---

## 2. C1 — 工厂与清理闭环（`src/adapters/openfilm/openfilm-upstream.ts`）

| 要求 | 实现 |
|---|---|
| listen 以后所有尚未 return 的抛出路径都在工厂的结算边界内 | `listen` 本身也移入 try；`serving_root_verified` 观察点**移入 try**（此前它在 try 之外） |
| 工厂保留 primary 并**合并** `folder.drain`、`server.close` 的实际失败 | `withCleanupFailures(primary, failures)`：primary **不被替换**，清理失败挂在 `cleanup_failures` 上，`cause` 指向第一条清理失败 |
| 不能 catch 空吞 | `folder.drain()` 的失败**被收进** `failures`（此前是 `catch {}` 空吞） |
| 清理应尽力完成所有已拥有资源，某一步失败不跳过后面清理 | listener 关闭与 folder drain **各自独立 try**，互不短路 |
| `open>0` 不得声称 clean | drain 的结算若 `open>0`，**额外**记一条 genuine 失败 |
| 观察异常不能覆盖 primary | `serving_aborted` 的回调被单独 try 包住；它的异常**不进入** primary |
| listen 失败也有确定的资源归属 | listen 在 try 内 ⇒ 失败路径同样结算（`server.close()` 对未监听的 server 会抛，被收进 `failures` 而不是吞掉） |

**观察点的载荷**（Host-private 只读）：`serving_listening:<origin>` 与 `serving_request:<path>`
—— 类型扩展为「字面量 ∪ 模板串」⇒ 用例能**证明它真正 listen 的那个端口**已被关闭。

**新增反例**（`native-cache-witness.test.ts`）：
- **观察点抛出一个具名 Error** ⇒ 工厂**重抛同一个对象**（`expect(thrown).toBe(named)`）、
  报 `serving_aborted`、**它真正 listen 的端口**随后拒绝连接（`fetch` 失败）、
  服务对该 view **没有** serving。
- **listen 之后的 root 校验失败** ⇒ 抛的是平台自己的 `ENOENT`（不是包装），端口同样被关闭。
- **构造间 dispose** ⇒ dispose **等待**这次构造（构造是受理中的工作），构造看到服务正在关闭 ⇒
  owner **当场**关闭（`serving_closed`），端口被关闭，服务对该 view 没有 serving。

> **仍在本轮白名单之外、我没有实现的一项（如实记录）**：
> MAIN 的 C1 还要求「service 对清理不确定仍应保持粘滞」。那一句落在
> `src/host/agent-driven/created-native-workspace.ts` —— **本轮不在白名单** ⇒
> **未实现**，需要下一次放行。当前行为：服务在登记失败时把清理异常**合并进 primary**（primary 不被替换），
> 但**没有**把服务置为 sticky。**如实标注为未完成项。**

---

## 3. C2 — 真实 draw 结算与 authority 分开（`native-cache-witness.test.ts`）

- **真实空档**：工作副本的 film 页**自己**在稍后才请求一个依赖（页面里的定时器创建 Image）⇒
  用例轮询到 **`pending === 0` 且 `accepted >= 1`** 才发起 close —— 这两个数都是**实际断言** ✔。
- **关闭后仍有实际 HTTP 请求并完成**：close 之后观察到的请求里**确实有**那个晚到的依赖
  （`requested` 里出现 `late-dependency.txt`），且**请求数比 close 前更多** ✔。
- **raw draw 与完整 production 是两个结算边界**：close **只等**已受理的 raw draw 及其后续请求；
  production 随后走 POST 闭包与**最终围栏**。用例**分别**断言：
  - production **reject** 了 `NATIVE_CACHE_ORIGIN_FOREIGN`（最终围栏拒绝 closing 的 serving；
    而最终围栏**只有在 draw 之后**才会被走到 ⇒ 这同时证明 **draw 真的完成了**）✔；
  - close 在 draw 之后才结算；**第二次 close 等同一结算**（两个 close 都结算，且没有谁先于 draw 结算）✔；
  - **无可见见证**、服务**不** sticky（这次是被拒绝，不是丢失）✔。
- **没有**为让用例通过而改弱最终围栏：`created-native-workspace.ts` 本轮**未改一行** ✔。
- production 的 promise **从一开始就接好拒绝处理**（`drawing.then(…, error=>…)`）⇒ 不会有未处理的 rejection ✔。

---

## 4. C3 / C4 — 静态分析的有效性（`tests/m2.1/openfilm-upstream-lock.test.ts`）

**C3（入口按真实能力流识别）**
- 入口的 vendor 位置现在**按函数**识别：直接来源 = `vendorRoot` 形参；
  间接来源 = **该函数自己体内**对「值类型为 string 的模块私有 WeakMap」的 `.get(<形参>)` 读取。
  ⇒ 不再是「全模块扫一个 identifier，再按同名形参推每个函数」的启发式 ✔。
- **正控**：一个只有**同名** `producer` 形参、**完全没有 registry 读**的导出**不是入口** ✔（旧的启发式会误判它）。
- 入口清单据此更新为**六项**（含 `openFilmServingBridge` —— 它的 vendor 路径也来自已签发 producer 的私有登记）✔。
  **不是只改数量**：清单由模块事实推导，规则也据此多覆盖了桥的 producer 位 ✔。
- `producer: unknown` 的 fail-closed 签名**原样保留**，没有为门禁改生产类型 ✔。

**C4（taint 按词法作用域与声明身份追踪）**
- 每个**词法作用域**（函数体或模块顶层）有自己的声明表；标识符解析到**它真正的声明**（按声明节点，不是按名字）✔。
- **请求源**：**类型优先**；名字只在**没有类型标注**时兜底 ⇒ 一个标注为 `string` 的同名参数**不受**名字规则污染 ✔。
- **局部 initializer**、**helper 形参**都按同一作用域解析；helper 的实参在**调用者作用域**求值，
  污染**只作用于该 callee 自己的形参**（在它自己的函数体里）✔ ⇒ 级联消失，误报下降 ✔。
- 递归分析**有界收敛**（固定轮数）✔。
- **原 10 条反例全部保留**，每条仍**精确命中一次** ✔；**正控**保留（装配期可信参数、无关文件）✔。
- **新增正控**：两个**同名形参**的函数，只有一个真的持有请求数据 ⇒ 只有一处被命中 ✔。
- 有限范围**如实记录**：作用域按函数体近似（函数内的块不是独立作用域），**不**宣称通用静态安全证明 ✔。

---

## 5. 候选字节与清单

- 全路径清单：`n1n2-claude-041-batch-inventory.json`（4 个批次路径 + 16 个未改候选的 sha256/字节数）；
  逐字备份按 `<sha256>.txt` 存于 `source-captures/`。
- 四个批次路径：`874b7bb843305717` openfilm-upstream.ts、`a25bcf18fcb0bd3a` native-cache-witness.test.ts、
  `4593eef0a02c6002` openfilm-upstream-lock.test.ts、`8ad549119634fa51` native-source-fixture.ts。

## 6. 建议的下一轮运行（**全部待 MAIN 对本候选的新授权；本轮一个都没跑**）

1. **静态门禁**（同一对文件）：`corepack pnpm exec vitest run --config vitest.config.ts
   tests/m2.1/openfilm-upstream-lock.test.ts tests/architecture/m2.2-fitness.test.ts`
   —— 040 的两条失败正是本轮改的（入口清单与作用域），**必须**有真实结果。
2. **高判别力新反例（HEAVY，逐个）**：`native-cache-witness.test.ts`（C1 的三个新反例、C2 的 Q02 重写、PF01/PF02/Q03/K05-c）、
   `created-native-source-reader.test.ts`（真实 ffprobe）、`local-assets-host.test.ts`（真实媒体子进程 + LF03 的 N9/N10 与事件基数）、
   `created-source-adoption.test.ts`（Q06 的第二项目与外来权威）、`migration-real-export.test.ts`（Q05：真实 ffmpeg/ffprobe 与两次目标 render）、
   `created-impact-atomic.test.ts`（过期权威）。
3. **夹具相关套件**：snapshot-store、host-coordinator-integration、migration-service、openfilm-migrator。
4. **变异/反事实**（单独授权）：LF03 的旧严格比较、PF03 的「丢掉 POST 原因」。
5. **最后**才是全量 `corepack pnpm check`。

## 7. 未宣称（明说）

- 编译绿**不是** PASS，**不**关闭原 17 项，**不**关闭 PF01–PF03。
- 本轮**没有**跑任何 vitest/Host/媒体/浏览器/构建/变异/全量 ⇒ **每一个新反例都 NOT_RUN**；
  C1/C2/C3/C4 的修复是**静态实现 + 已写好的反例**，其**可达性仍未由运行证明**；
  反例的存在**不是** old-red 证明。
- **C1 的「service 对清理不确定保持粘滞」未实现**（落在本轮白名单之外）⇒ 明确未完成 ✔。
- LF03 的 N9/N10、两个变异反事实仍 NOT_RUN；三个 opaque 夹具仍**未被跟踪**（MAIN `git add -f`）。
- 不宣称 NativeAck / Studio / A 影片 / V1 / 下一接线；不自签独立外审。
