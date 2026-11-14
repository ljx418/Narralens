# N1N2 040 — 静态门禁的实际结果，以及对 MAIN 两处生命周期澄清的控制流分析（只读，未改源码）

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；`HEAD=e2eff61b464d75d36598103d718cd2a75db5dfda`；索引**空**。
放行：`BATCH_040_GRANT.json`（**ONE 静态门禁命令**）。**本轮没有改任何源码/测试/夹具/配置/索引**（冻结中）。

---

## 1. 040 静态门禁的实际结果（失败，保留）

| 项 | 值 |
|---|---|
| capture | `n1n2-claude-039-static-gates-001` |
| argv | `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts tests/architecture/m2.2-fitness.test.ts` |
| runner | 原 `run-recorded.py`（sha256 `88cd47ec…` 未改） |
| **实际 exit** | **1** |
| log sha256 | `8b8d9e83844bf5c1e0730dec51534e8cbca1077252b1717639c5e7f6e2c1db2f` |
| source_changed / source_added | `[]` / `[]`（运行中输入零漂移） |
| 结果 | `Test Files 1 failed | 1 passed (2)`，`Tests 2 failed | 31 passed (33)` |

**逐文件**：

| 文件 | 结果 |
|---|---|
| `tests/architecture/m2.2-fitness.test.ts` | **18/18 全绿** ✔（规则 1 与 1b 的合成负向照旧） |
| `tests/m2.1/openfilm-upstream-lock.test.ts` | **13/15**：13 条原门禁**全绿** ✔；**10 条新反例全部被同一个分析器精确命中一次** ✔（失败发生在它们之后的第 11 条）；**两条新失败**（见 §2） |

### 1.1 自有清理（终态之后的观察）

无自有子进程（无 vitest/tsc/ffprobe/ffmpeg/录制器）；4747/4748 **无监听**；`/tmp narralens-*` 仍 **234**（未删未扫）；
`HEAD` 未变、索引空；**27 个路径重算零漂移**。

---

## 2. 两条失败的准确诊断（**都是门禁一侧的问题，不是产品代码的问题**）

### 2.1 入口清单：模块现在有**六个**携带 vendor 路径的入口

失败断言（`openfilm-upstream-lock.test.ts:499`）：期望 5 项，实际 6 项，多出 **`openFilmServingBridge`**。

**这是模块的事实**：桥的 vendor 路径也来自**已签发 producer 的私有登记**
（`issuedProducerRoots.get(producer)`），所以按“模块自身事实”推导出的入口集合里**本来就该有它**。
⇒ 这条规则现在**多覆盖了一处**（桥的 producer 位也不能是请求派生 ✔），是**加强**，不是漏洞。
⇒ 修订：期望清单改为六项（并保留“清单是模块的事实、真正的证明是下面的反例”这句注释）。

### 2.2 保守的“整文件形参污染”产生了级联

失败断言（`:561`）：被污染的 loader 合成样本期望 **1** 条违规，实际 **5** 条。

**控制流**：我当前的分析器把“一个形参只要在某处被污染，就视为整文件被污染”。
于是 loader 合成样本里那一条 `openFilmAvailability(request.url)` 把 **`openFilmAvailability` 的形参 `vendorRoot` 标成污染**，
而模块内部**别处**对 `openFilmAvailability` 的调用传的正是名为 `vendorRoot` 的**局部变量** ⇒ 它们也被判成违规 ⇒ 5 条。

⇒ 这不只是计数问题：它意味着**任何一处污染都会让同名的形参在整文件里带上污点**，误报风险偏高。

**修订（更精确，且不削弱任何反例）**：形参污染**按函数作用域**判定 ——
一个形参的污点只作用于**它自己的函数体内部**；调用点实参的污点在**调用者的作用域**里求值。
- 反例 6（`helper(root:string)` 从 `helper(req.url)` 得到污点）**仍然成立** ✔：`helper` 的形参 `root` 在 **`helper` 的函数体里**是污染的 ⇒ `createPinnedOpenFilmUpstream(root)` 被命中 ✔。
- 被污染的 loader 合成样本将回到**恰好 1** 条 ✔（探针的调用在 `probe` 的作用域里；模块内部其它函数的调用不受影响 ✔）。
- 真实树里的误报风险同时下降 ✔。

---

## 3. MAIN 的两处生命周期澄清：**我在实际代码里逐条核对，两条都成立**

### 3.1 (1) `serving_root_verified` 在工厂的 try/catch **之外**；工厂的 catch 还吞掉了 `folder.drain()` 的失败

实际字节（`src/adapters/openfilm/openfilm-upstream.ts`）：

```
907:    options?.lifecycle?.("serving_listening");     ← 在 try 内
912:  } catch (error) {
915:    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
916:    try { await folder.drain(); } catch { /* the folder's own settlement is reported below */ }
917:    options?.lifecycle?.("serving_aborted");
918:    throw error;
919:  }
920:  options?.lifecycle?.("serving_root_verified");    ← 在 try 外
```

**成立的理由**：
1. `serving_root_verified`（:920）在 try **之外** ⇒ 若这个观察回调**抛异常**，异常直接逃出工厂：
   **listener 已经 listen**、**owner 从未返回** ⇒ **没有任何人负责关闭它**（服务拿不到这个 owner）⇒ Q01
   “工厂自己结算它自己的一部分构造”在这条路径上**不成立** ✔。
2. catch 里的 `folder.drain()` 失败被 `catch {}` **吞掉** ⇒ **primary 保住了，但清理失败被丢掉** ⇒
   “真正保留 primary + 清理异常”**不成立** ✔。

**修订设计（未实施，待 MAIN 放行）**：
- 把**两个观察点都放进 try 内**（`serving_listening` 已在；`serving_root_verified` 移入）⇒ 观察回调抛异常时由**工厂**结算 ✔；
  并且 `serving_aborted` 的回调本身若抛异常，**不得**覆盖原来的 primary（它只做观察）。
- 工厂的失败结算改为**保留两个失败**：primary 保持不变，`server.close()` 与 `folder.drain()` 的失败
  作为 **cause** 挂到 primary 上（与 retained closure 的 `mergeRetainedCleanupCauses` 同一手法），
  **不再吞掉** `folder.drain()` 的错误 ✔。

### 3.2 (2) Q02 用例在**第一个** `serving_request` 就 close；且它 await 整个生产拿见证

实际字节（`tests/agent-driven/integration/native-cache-witness.test.ts` 的 Q02 用例）与产品字节：

- 用例现在在**第一次** `serving_request` 观察点就调用 `closeServing(...)` ⇒
  ① 它**没有**断言那一刻 origin 的 `pending === 0`（“当前 HTTP 为 0 的空隙”**未被证明**）✔；
  ② 它**没有**证明“后续某个确切的 asset 请求”在 close 之后仍然完成 ✔。
- 更要紧的是：用例 `const witness=await drawing; expect(witness.kind).toBe('film-poster')` ——
  而产品的**最终激活围栏**（`created-native-workspace.ts:847`）明确写着
  `if(live===null||live.closed||live.closing||…) refuseCache('NATIVE_CACHE_ORIGIN_FOREIGN', …)`：
  **serving 一旦 closing，最终激活必然拒绝** ⇒ 用例里这一行**必然失败**（生产会 reject，而不是返回见证）✔。
  ⇒ 也就是说：**真实绘制结算**与**最终见证激活**必须**分别断言**，而当前用例把它们合成了一个 ⇒ 该用例按现在的写法是**错的** ✔。

**修订设计（未实施，待 MAIN 放行；**不改弱最终围栏**）**：
1. 启动真实绘制 ⇒ 等到 **origin 空闲而绘制仍在受理**的那一刻：`servingFacts.pending === 0` **且** `accepted >= 1`
   （这才是“当前 HTTP 为 0、绘制未结束”的**确证**）⇒ 此时才 `closeServing(...)`。
2. **分别断言**：
   - **绘制真的结算了**：绘制产出的文件真的落在工作副本里（文件系统的事实），且生产 promise **reject**
     了 `NATIVE_CACHE_ORIGIN_FOREIGN`（最终围栏拒绝 closing 的 serving）⇒ **见证不可见**、服务**不** sticky；
   - **close 在绘制之后才结算**（顺序断言），且**第二次 close 等同一结算**。
3. **最终围栏保持原样**（closing ⇒ 拒绝激活）—— 不为了让用例通过而放宽它 ✔。

⇒ 附带结论：Q02 这条用例在 039 的字节下**尚未运行**，它按现在的写法会红；这一点**如实记录**，不算 old-red 证明。

---

## 4. 我请求的下一次源码放行（**精确、逐条**）

| # | 路径 | 修订 |
|---|---|---|
| C1 | `src/adapters/openfilm/openfilm-upstream.ts` | 把 `serving_root_verified` 移入工厂的 try；工厂失败时**保留 primary + 清理异常**（不再吞 `folder.drain()`）；`serving_aborted` 不得覆盖 primary |
| C2 | `tests/agent-driven/integration/native-cache-witness.test.ts` | Q02 用例按 §3.2 重写（等 `pending===0 && accepted>=1`；分别断言绘制结算与激活拒绝；不改弱围栏） |
| C3 | `tests/m2.1/openfilm-upstream-lock.test.ts` | 入口期望清单改为**六项**（含 `openFilmServingBridge`） |
| C4 | `tests/m2.1/openfilm-upstream-lock.test.ts` | 分析器改为**按函数作用域**判定形参污染（消除级联、降低误报；helper 传播反例仍然成立） |

C1 与 C3/C4 的改动**只在这 9 个已放行路径内**；不改 pin/配置/契约/运行器/公共 DTO/EnginePort/Expected015/AGENTS.md/索引。

## 5. 这一轮没有发生的事（明说）

- **没有**改任何源码/测试/夹具/配置/索引（冻结中）；27 个路径重算**零漂移**。
- **没有**跑除 040 那**一条**静态门禁之外的任何命令；**没有**跑 vitest/Host/媒体/浏览器/构建/变异/全量。
- 静态门禁**不关闭** PF01–PF03，**不**关闭原 17 项，**不**构成 PASS。
- Q01/Q02/Q03/Q04/Q05/Q06 的**可达性仍未由运行证明**；本轮门禁只证明了**门禁自身**的行为（13 条原断言绿、
  10 条新反例被精确命中一次）✔，**没有**证明任何产品行为。
- LF03 的 N9/N10、PF03 的变异/反事实仍 **NOT_RUN**；三个 opaque 夹具仍**未被跟踪**。
- 没有新 429。
