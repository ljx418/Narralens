# N1N2 044 — 真实重点生命周期用例的实际执行结果（12 通过 / 3 失败）

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
放行：`CORRECTIVE_SOURCE_AND_VALIDATION_044.md` + `.json`（唯一可改：`tests/m2.1/openfilm-upstream-lock.test.ts`；
连续 compile + static 自验证；static 实际 0 后**一次**真实 browser 重点运行）。
**本轮没有改任何源码/测试/夹具/配置/工具/索引**（冻结保持 ✔）；失败后**没有**自修、**没有**重跑 ✔。

---

## 1. 连续自验证的三个回合（044 明确授权）

| capture | 类型 | **实际 exit** | log sha256 |
|---|---|---|---|
| `n1n2-claude-044-tsc-001` | 编译 | **0** | `e3b0c442…`（0 字节） |
| `n1n2-claude-044-static-gates-001` | 静态门禁 | **1** | `3d866bf8fbb4acd8…` |
| `n1n2-claude-044-tsc-002` | 编译 | **0** | `e3b0c442…` |
| `n1n2-claude-044-static-gates-002` | 静态门禁 | **1** | `9b2f7832ade4b0c8…` |
| `n1n2-claude-044-tsc-003` | 编译 | **0** | `e3b0c442…` |
| `n1n2-claude-044-static-gates-003` | 静态门禁 | **0** | `63f703279681c781…`（`Test Files 2 passed (2)`、`Tests 53 passed (53)`） |

两轮红灯的**根因 → 修正**映射（每轮都有具体根因，没有无修改重碰）：
1. **static-001**：别名 `const issued = producer as Owner` 的初始化式是 **`as` 表达式** ⇒ 我的别名解析只认纯标识符 ⇒
   别名没登记 ⇒ 「真的使用」不成立 ⇒ 桥被漏判为入口 ⇒ **修正**：别名解析**穿过**透明包装（括号／`as`／类型断言／
   `satisfies`／非空），并沿**链式别名**前进 ✔。
2. **static-002**：我的**合成**能力流模块里，producer 集合的 WeakSet **没有**与 vendor 路径的 WeakMap **同时**被写入 ⇒
   它按规则**不是**「已签发 producer 的登记」⇒ 传递规则不匹配 ⇒ **修正**：合成模块补上与真实桥**同形**的登记
   （`issued.add(value); registry.set(value, "/vendor");`）✔ —— **规则没有为了让测试过而放宽** ✔。
   （同一轮还把该文件的用例**拆成独立命名/表驱动**：`it.each` 的反例与正控**各自独立成例**，一个失败不阻断其它 ✔。）

## 2. 条件放行的**一次**真实 browser 重点运行

| 项 | 值 |
|---|---|
| capture | `n1n2-claude-044-focused-lifecycle-001` |
| argv | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-witness.test.ts -t "Q01\|Q02\|Q03\|K05-c\|PF01\|PF02"` |
| **实际 exit** | **1** |
| log sha256 | `890546b890f85c20b74fbb0feffc42530aa4d17dcf3b59859617bb2b66db6e77` |
| 结果 | `Test Files 1 failed (1)`，`Tests 3 failed | 12 passed | 16 skipped (31)`，183.81s |

### 2.1 逐 case 的**实际执行**与结果

| case | 结果 | 耗时 |
|---|---|---|
| PF01 拒绝未登记的 serving | **通过** | 14912ms |
| PF02 用写下它的绘制证明 film duration | **通过** | 12773ms |
| K05-c 保留真实绘制的主因与两棵树的各自释放失败 | **通过** | 14322ms |
| Q01 构造期间的 close | **通过** | 9536ms |
| Q01 构造期间工作副本被换 | **失败** | 9261ms |
| Q01 同一 view 的两个并发请求共享一次构造 | **通过** | 14481ms |
| Q01 构造期间的 dispose | **通过** | 9770ms |
| Q01 观察点抛错时工厂结算自己的构造 | **通过** | 10746ms |
| Q01 listen 之后 root 校验失败 | **通过** | 9415ms |
| Q01 工厂失败 + 其结算也失败 | **通过** | 10417ms |
| Q01 登记失败 + 其结算也失败 | **失败** | 9608ms |
| Q02 真实绘制期间的 close | **通过** | 10917ms |
| Q03 另一页面的绘制绝不为 duration 签字 | **失败** | 25869ms |
| Q03 两次合法的不同 frame | **通过** | 12527ms |
| Q03 最新授权撤销后不回退 | **通过** | 0ms |
| 其余 16 个非重点 case | **未执行**（`↓` skipped） | — |

### 2.2 三条失败的**最早断言**与真实原因

1. **Q01「构造期间工作副本被换」** — 最早断言 `native-cache-witness.test.ts:1233`
   `expected 'NATIVE_CACHE_PRODUCTION_STALE' to be 'NATIVE_CACHE_ORIGIN_FOREIGN'`。
   ⇒ 拒绝是**真的**，但它是**租约过期**那一条，不是 origin 那一条：工作副本被移除后，被签发的 view（及其租约）
   已经失效，服务在构造后的复核里**先**查租约 ⇒ 给出 `PRODUCTION_STALE` ⇒ ⇒ origin 分支在此路径**到不了** ⇒
   **是我的期望写错了**（断言了实际不发生的那一条）✔。
2. **Q01「登记失败 + 其结算也失败」** — 最早断言 `expected +0 to be 1`（genuine 失败个数）。
   ⇒ 我读的是**adapter** 的账本，但这条路径上的 primary 是**服务自己的拒绝**，genuine 失败已被服务用
   `mergeRetainedCleanupCauses` 并进 primary ⇒ 它们在**host** 的账本里 ⇒ **读错了账本** ✔（产品行为正是设计的那一个：
   primary 带着 genuine 失败 ✔）。
3. **Q03「另一页面的绘制绝不为 duration 签字」** — 最早断言是上游自己的
   `FrameError: window.film with a frame() function did not appear within 15 s`（`host.mjs:351`），25.9s。
   ⇒ **固定上游的 producer 只能画 film 页**：`FilmPage.open` 等的是 `window.film.frame` ✔ ⇒
   ⇒ **「非 film 页面的绘制」不可达** ⇒ ⇒ 我这个反例的前提不成立 ⇒ 需要换成**可达**的等价形态（或由 MAIN 裁定删去）。
   ⇒ 上游自己的 15s 预算**原样用尽**，我没有延长任何预算、也没有放弱任何断言 ✔。

⇒ 三条失败**都在** `tests/agent-driven/integration/native-cache-witness.test.ts`（**不在** 044 的白名单内）⇒
需要 MAIN 对该文件的新放行才能修 ⇒ 本轮**不修、不重跑** ✔。

## 3. 自有清理与冻结核对（真实运行之后）

- 无自有进程存活（vitest/chrome/ffprobe/ffmpeg 均无）✔；机器上另有 playwright-mcp 与 `/mnt/c/workSpace/navia/…`
  的 `node --test`，**不属本 lane** ⇒ 未触碰 ✔。
- `127.0.0.1:4747`/`:4748` **无监听** ✔；`/tmp narralens-*` 仍 **234**（未删未扫，170 个历史 `narralens-n1n2-film-*` 保留）✔。
- `HEAD=e2eff61…` 未变；索引**空** ✔；已跟踪 dirty 集合不变 ✔；**20 个路径重算零漂移** ✔ ⇒ 冻结全程保持 ✔。

## 4. 未宣称

不宣称 PASS、不关闭原 17 项、不关闭 PF01–PF03；真实执行只覆盖上表 15 个重点 case（12 通过 / 3 失败），
**其余 16 个 case 未执行**（不是通过）✔；LF03 的 N9/N10、两个变异反事实、reader/其它套件/full/build/mutation 全部 NOT_RUN；
三个 opaque 夹具仍**未被跟踪**；不自签独立外审。
