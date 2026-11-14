# N1N2 042 — 集中闭环候选交付（五个路径；编译绿；一次静态门禁实际结果）

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；`HEAD=e2eff61b464d75d36598103d718cd2a75db5dfda`；**索引空**。
放行：`CORRECTIVE_SOURCE_RELEASE_042.md` + `.json`（**五个精确路径**）。
**没有**改 AGENTS/Expected015/pin/配置/公共 DTO/EnginePort/旧 Gate；**没有** add/commit/reset/stash/checkout/push；
**没有**跑任何 Host/browser/ffmpeg/ffprobe/media/build/mutation/full。

---

## 1. 编译与静态门禁的实际记录（红灯全部保留）

| capture | 类型 | **实际 exit** | log sha256 | 说明 |
|---|---|---|---|---|
| `n1n2-claude-042-tsc-001` | 编译 | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | log **0 字节**、零漂移 |
| `n1n2-claude-042-static-gates-001` | **条件静态门禁（唯一一次）** | **1** | `57524161766fdaddc0085a6c5e0c859f6a2a4d1bf3844e4e6677a54811a92328` | `Test Files 1 failed | 1 passed (2)`，`Tests 1 failed | 32 passed (33)`；fitness **18/18 全绿**；upstream-lock **14/15** |
| `n1n2-claude-042-tsc-002` | 编译 | **0** | 同上 | 静态门禁失败后的**修正**（见 §3.4）编译仍绿 |

静态门禁的**唯一失败**（原样保留在 capture 里）：
派生入口集合里**多了 `isIssuedOpenFilmCacheProducer`**（`expected {…(6)} to deeply equal {…(7)}` 的对侧）——
我的**传递规则**把「**检查**一个值是不是已签发 producer」也当成了「**携带** vendor 路径」。
⇒ 该谓词只**测试**这个能力，**不使用**它 ⇒ 不是入口 ✔（见 §3.4 的修正）。

⇒ 按 042 的规定，**条件静态门禁只跑那一次**，非零即停：**我没有自行修后重跑静态** ✔。
修正只落在源码里，并另行编译 ✔。

---

## 2. 服务 cleanup uncertainty 的真正闭环（`created-native-workspace.ts` + adapter）

- **真权威在 adapter 自己的私有 WeakMap**：`genuineServingFailures`（模块私有），
  导出 **Host-private 只读 getter** `genuineServingCleanupFailures(failure)` ✔。
  ⇒ 「一个普通 property」不再是权威（会丢、可伪造、frozen 上留不住）✔；
  **frozen / primitive 的 primary 也不会静默丢原因**：primitive primary 被**包装**成一个对象，
  包装对象才是 ledger 的键，原值作为 `cause` 保留 ✔。
- **归属三条清楚**：
  - 工厂未 return 的失败 ⇒ **工厂自己**结算（listener + folder 各自独立尝试）+ ledger ✔；
  - service 已拿到 owner 后的登记失败 ⇒ **service 当场关闭该 owner**，并把「工厂的 genuine」与「自己 close 的 genuine」都并入 primary ✔；
  - `owner.close()` 里 `folder.drain()` 失败 ⇒ adapter 的 close 也**各自独立尝试**（drain 与 listener 互不跳过），
    失败进入同一个 ledger ✔。
- **primary 保持原位**：所有 genuine 对象用 `mergeRetainedCleanupCauses` 并入 primary（primary 不被替换）✔。
- **uncertain 只在真有 genuine 时锁**：`#keepPrimaryWithGenuineFailures` 只在 genuine 非空时置 `#uncertain=true` ✔
  ⇒ 「普通观察失败 / 普通文件读取失败」**不会**误置 uncertain ✔；
  ⇒ 「构造被正常拒绝且资源干净」**不**置 uncertain ✔（新增断言）。
- **未 listen 的 ERR_SERVER_NOT_RUNNING 如实归类**：listener 从未起来时，那不是「资源损坏」，
  按**实际状态**归类（不计为 genuine）✔；而 **close callback 的 error 参数**不再被忽略 ✔。
- **无无限等待、无吞 cleanup**：每一步各自 try，一个失败不跳过后面 ✔；不重试 ✔。

**新增场景**（真实释放后抛指定对象，不 mock 工厂/HTTP/producer）：
- **工厂失败 + 其结算失败**：观察点抛出**指定的 primary 对象**，`serving_cleanup:listener` 处再抛出**指定的 genuine 对象**
  （listener 此时**已真的关闭**）⇒ 断言 primary 是**同一个对象**、genuine 对象**恰好一次**、
  **它真正 listen 的端口**随后拒绝连接、服务 **uncertain** 且**后续生产被拒** ✔。
- **service 登记失败 + 其结算失败**：登记失败（工作副本被换）+ `serving_cleanup:folder` 处 genuine 失败
  ⇒ 同一 primary、genuine 恰好一次、服务粘滞 ✔。
- **正常拒绝且资源干净** ⇒ 服务**不**粘滞 ✔（新增断言）。

---

## 3. 生命周期事件兼容、Q02、门禁规则

### 3.1 事件兼容（旧 named 仍精确触发）
adapter 现在**同时**发旧具名事件与带载荷事件：
`serving_listening` + `serving_listening:<origin>`、`serving_request` + `serving_request:<path>`、
新增 `serving_request_completed` + `serving_request_completed:<path>`（**请求真的被回答**）、
`serving_cleanup:<what>`（资源**真的已关闭**之后，测试可在此注入 genuine 失败）、
`serving_aborted`、`serving_closed` ✔。
⇒ 旧消费点 `point==='serving_listening'` **重新可达** ✔（此前只剩 payload 形式，旧 Q01 断言已失效 ✔ 现已修复）。
⇒ **service 的类型不再用 `as` 假装合法**：service 的 Host-private 类型**就是 adapter 自己的类型**
（`NativeServingLifecyclePoint = OpenFilmServingLifecyclePoint`），fixture 同步 ✔。

### 3.2 Q02：**实际可解码**的 late asset，且真实 frame 明确 await 它
- 先静态复核了固定上游的绘制契约（只读，未改上游）：`pageframes.mjs` 的 `draw` → `FilmPage.open`
  → `page.goto(url, { waitUntil: 'load' })` ⇒ **页面 load 事件会等它的图片加载完** ✔
  ⇒ 页面里一张**真实 PNG**（1×1，测试自己写进工作副本）会被**真实请求并解码**，
  而**绘制本身等它** ✔。
- 用例现在断言：**先**证明空档（`pending === 0` 且 `accepted >= 1`，且**图片尚未被请求**）⇒ 才 close；
  close 之后**那张确切的图片**被请求（路径含 `late-dependency.png`）**并被完成**（completion 观察）✔；
  生产随后**必然**以 `NATIVE_CACHE_ORIGIN_FOREIGN` 结束（最终围栏，只有 draw 之后才走到 ⇒ 同时证明 draw 真的完成）✔；
  两个 close 等同一结算 ✔；无可见见证、不 sticky ✔；**最终围栏未改弱**（`created-native-workspace.ts` 的围栏本身未动）✔。

### 3.3 门禁：按**真实能力流**推导入口
三条规则，全部从**模块自身事实**推导（不靠词名、不靠数量）：
1. **DIRECT**：形参名 `vendorRoot` ✔；
2. **REGISTRY**：**该函数自己体内**从「值类型为 string 的模块私有 WeakMap」读取的那个形参 ✔
   （`createPinnedOpenFilmServingOwner` 的 `producer`，位置 0）✔；
3. **TRANSITIVE**：该函数**检查**了「已签发 producer 的私有登记」（那个与 vendor 路径 WeakMap **同时**被写入的 WeakSet）
   的那个形参，且**真的用它调用 producer 自己的绘制能力**（`pageFrame`，直接或经别名）✔
   ⇒ `openFilmServingBridge` 的 `producer`，**位置 1** ✔。
⇒ 期望断言改成**名字→位置**的完整映射（六项，含桥的**位置 1**）⇒ 不是数量匹配 ✔ ✔。

### 3.4 静态门禁失败后的修正（已编译）
`isIssuedOpenFilmCacheProducer` 被判成入口 ⇒ 修正：传递规则**要求该函数真的使用这个能力**
（调用它自己的 `pageFrame`），**只做检查的谓词不是携带** ✔ ⇒ 入口集合回到六项 ✔。
⇒ 另补**正控**：同名 `producer` 形参但**没有任何 registry 检查**的导出**不是**入口 ✔（已在 040/041 保留）。
⇒ 原 10 条反例、helper 传播、同名不同 scope 正控、装配可信正控、旧 pin/argv/shell 检查**全部保留** ✔。

---

## 4. 候选字节

`n1n2-claude-042-batch-inventory.json`（5 个批次路径 + 15 个未改候选的 sha256/字节数），
逐字备份按 `<sha256>.txt` 存于 `source-captures/`：

| 路径 | sha256/16 |
|---|---|
| `src/adapters/openfilm/openfilm-upstream.ts` | `013f50ce87e04b3f` |
| `src/host/agent-driven/created-native-workspace.ts` | `3702917cf6efe092` |
| `tests/agent-driven/integration/native-cache-witness.test.ts` | `c4303230fbdb37fb` |
| `tests/agent-driven/integration/helpers/native-source-fixture.ts` | `419332f4f5d8e2ec` |
| `tests/m2.1/openfilm-upstream-lock.test.ts` | `2f32519a05da494e` |

自有清理（终态之后）：无自有子进程、4747/4748 无监听、`/tmp narralens-*` 仍 234（未删未扫）、
HEAD 未变、索引空、20 个路径零漂移。

## 5. 需要的下一步（**待 MAIN 放行；本轮一个都没跑**）

1. **再放一次静态门禁**（唯一一次条件运行已用掉且非零）：同一对文件、新的 capture 名。
   042 的失败点正是本轮改的（入口推导），**必须**有真实结果。
2. 之后才是高判别力业务用例（native-cache-witness 的 C1/C2/PF01/PF02/Q03/K05-c、
   created-native-source-reader、local-assets-host、created-source-adoption、migration-real-export、
   created-impact-atomic），再是夹具相关套件，再是变异/反事实，最后才是全量。

## 6. 未宣称（明说）

- 编译绿**不是** PASS，**不**关闭原 17 项，**不**关闭 PF01–PF03。
- 本轮只跑了**一条**编译和**一条**条件静态门禁；**所有业务用例仍 NOT_RUN** ⇒
  C1/C2/C3/C4 的修复仍是**静态实现 + 已写好的反例**，可达性**未由运行证明**；
  「新增反例」**不是** old-red 证明。
- 静态门禁**实际 exit 1**（1 failed / 32 passed）：fitness 18/18 绿，upstream-lock 14/15，
  唯一失败已定位并修正（已编译，待新的静态运行给出真实结果）✔。
- LF03 的 N9/N10、两个变异反事实仍 NOT_RUN；三个 opaque 夹具仍**未被跟踪**（MAIN `git add -f`）。
- 不宣称 NativeAck / Studio / A 影片 / V1 / 下一接线；不自签独立外审。
