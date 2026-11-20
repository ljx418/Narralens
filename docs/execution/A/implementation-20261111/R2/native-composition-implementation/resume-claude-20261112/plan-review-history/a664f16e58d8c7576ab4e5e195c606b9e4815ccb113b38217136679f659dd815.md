# N1N2 037 — PF01–PF03 与 LF01–LF05 统一修正方案（可实施，待 037 source/runtime release）

依据：`USER_AUTHORIZED_RESUME_20261113_POST036.md`（本检查点＝文档期）、`PREFREEZE_OPEN_FINDINGS_REGISTER.json`、
`PF01_PF03_CORRECTION_DESIGN_PENDING_RELEASE.md`、`LF03_CONCURRENCY_ACCEPTANCE_PENDING_RELEASE.md`、
`LF04_STATE_OWNERSHIP_DESIGN_PENDING_RELEASE.md`、`PLAN_037_READONLY_REVIEW_001.json`、
`independent-pre-freeze-review-021/REVIEW.md`、`BATCH_036_MAIN_FINAL_FAILURE_VERIFICATION.json`、036 原始捕获日志。

**状态：DESIGN_ONLY / REQUESTING_037_RELEASE。本轮未写任何源码、测试、tools、config、fixture、索引；未编译、未跑测试、未跑 Host/媒体/浏览器/构建。**
**本文件不构成 PASS，不自签独立外审，不宣称 NativeAck/Studio/A 影片/V1。**

改写前字节：SHA256 `21df73c88a2d4773ceafacf825810967af81ff6ddd58697a95c2166231cc32b2`（同字节副本另存于 MAIN
`resume-claude-20261112/plan-review-history/21df73c8….md`，历史未改写）。

---

## 0. 证据基线（本次实际读取，未漂移）

- cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；`HEAD=e2eff61b464d75d36598103d718cd2a75db5dfda`；索引空。
- 036 终态：**exit 1**；8 failed files / 47 failed / 2513 passed / 1 skipped；log SHA256 `3a58fadcd86ed1e269089d107d4243318208c18210dd796b5f0135d3e1895d02`；
  capture `n1n2-claude-021-final-check-001`；argv `corepack pnpm check`。
  因 `&&` 链，**Python impact-hash golden 与两次 vite build 未执行**（不可自行补跑）。
- 15 个候选源码/测试字节与独立预审字节表**逐字一致**（见 037 清理收据第 3 节）。
- 自有子进程清理：036 遗留的 2 个孤儿 OpenFilm vendor server（PID 2728937/2728944，ppid=1，监听 4747/4748）已**定向** SIGTERM 并验证退出、端口释放；
  170 个 `/tmp/narralens-n1n2*` 目录与其余临时物**全部保留**。收据：`n1n2-claude-037-owned-cleanup-receipt.md`。

### 0.1 8 个失败套件的归因（本轮实际读取源码与日志后确定）

| 失败套件（036） | 失败数 | 归因 | 处理项 |
|---|---|---|---|
| `tests/m2.3/migration-service.test.ts` | 26/26 | **夹具缺失**：`tests/fixtures/m2.1/snapshot-project/assets/generated/visual-10s.mp4` ENOENT（复制到私有 source 时） | LF01 |
| `tests/m2.3/migration-real-export.test.ts` | 2/2 | **夹具缺失**：同路径 ENOENT；且存在**声明风险**（opaque 17 字节 + 常量 `durationFrames:900` 被称作“real/recorded D1”） | LF01 + LF02 |
| `tests/m2.2/snapshot-store.test.ts` | 9/9 | **夹具缺失**：`assets/generated/narration-30s.wav`（+ 两个 visual） | LF01 |
| `tests/m2.3/openfilm-migrator.test.ts` | 6/7 | **夹具缺失**：`visual-10s.mp4`、`narration-30s.wav` | LF01 |
| `tests/m2.2/host-coordinator-integration.test.ts` | 1/2 | **夹具缺失**：`assets/generated/visual-10s.mp4` | LF01 |
| `tests/agent-driven/integration/local-assets-host.test.ts` | 1/23 | **真实代码缺陷**：`LocalAssetRegistry.#hashFile:515` ← `#import:452` | LF03 |
| `tests/architecture/m2.2-fitness.test.ts` | 1/17 | **状态归属登记缺口**：2 个 offender | LF04 |
| `tests/m2.1/openfilm-upstream-lock.test.ts` | 1/14 | **门禁断言作用域失效**（整文件 `request./req./body.` 正则命中新增 HTTP serving） | LF05 |

> 5 个套件是**前置条件缺失**（夹具不在本 worktree），不是本候选引入的逻辑回归；3 个是真实代码/门禁问题。
> 两类**分开保存**，不合并计数、不互相抵消。

---

## 1. PF01 — 渲染 origin 未与被签发的根绑定（CODE_DEFECT_STATIC_INFERENCE，MAJOR）

### 1.1 可达调用链（当前实际字节）

1. `tests/agent-driven/integration/native-cache-witness.test.ts:78-121` 的 `localFolderServer(root)`：用**调用方自己的** `http.createServer`
   把 `createPinnedOpenFilmFolderServer(...).handle` 挂到 `127.0.0.1:<随机端口>`，并把 `base` 交给生产。
2. `src/host/agent-driven/created-native-workspace.ts:446-450`：`produceNativeCacheEntry(production, request)` 的 request 含 **`base: string`**（自由字符串）。
3. `created-native-workspace.ts:515`：`request.producer.pageFrame({root, base:request.base, rel, ms, width, overrides})` —— `base` **原样**进入固定上游。
4. `src/adapters/openfilm/openfilm-upstream.ts:398-406`：该 `base` 直接传给固定上游 `pageFrame(root, base, rel, ms, width, overrides)`。
5. 固定上游 `pageframes.mjs:90` 按 `base` 取**页面**，`:101/:178` 却按传入 `root` **落盘并读依赖身份**。
6. `created-native-workspace.ts:530-536/568-581` 用**被签发 root** 的 PRE/POST 闭包比对依赖与输出身份并激活见证。

⇒ 若 `base` 指向**另一个自有根**（同名 `film.html`、内容不同）：绘制的是别处的字节，而依赖/输出身份取自被签发 root；
PRE/POST 身份可全等、摘要与那次**错误 origin** 的绘制一致 ⇒ **见证被激活，而它声称的依赖并未提供被渲染的字节**。
（独立预审的静态推论；**本轮仍未执行反例**。）

**现有断言为何不足**：B0-1（`:136`）/B0-4（`:302`）总是 `localFolderServer(f.workspaceRoot)`，绑定由**夹具**安排，生产从不强制。
生产者品牌只证明“执行了固定代码”，不证明“HTTP 回答来自那个根”。

### 1.2 最小实现（私有接口，不改公共 DTO / EnginePort / pin / 015 产物）

**`src/adapters/openfilm/openfilm-upstream.ts`（Host-private，新增自持 serving owner）**

```ts
/** 一个受控的页面服务 owner：它自己创建并持有真实 loopback listener、固定 handler、root 身份与代次。 */
export interface OpenFilmServingOwner{
  readonly origin:string;              // 只读副本，不是权威
  readonly generation:number;
  close():Promise<void>;
}
/** 工厂：唯一的写入口。只有它能把 owner 写进模块私有表。 */
export async function createPinnedOpenFilmServingOwner(vendorRoot:string,root:string,
  verified?:OpenFilmAvailability, options?:{headers?:Record<string,string>}):Promise<OpenFilmServingOwner>;
/** 只读出口：返回该 owner 的私有事实；非本模块签发的对象 → null。 */
export function openFilmServingBinding(owner:unknown):{readonly origin:string;readonly canonical_root:string;
  readonly dev:string;readonly ino:string;readonly generation:number;readonly closed:boolean}|null;
```

- 模块私有 `WeakMap<object,ServingFacts>`：`origin / canonical_root / root 的 dev+ino / generation / closed`。
  **只有工厂能写入** ⇒ 复制对象、伪造同形对象、跨实例对象都取不到绑定（`openFilmServingBinding` 返回 null）。
- owner **自己** `http.createServer` + `listen(127.0.0.1, 0)` + 固定 handler（复用既有 `folderFiles`）。
- 既有 `createPinnedOpenFilmFolderServer`（handler-only，`:534`）**保留但降级为非授权工具**：它**不写**上面那张私有表，
  挂到任意 server 后无法取得可签字能力（与设计文件第 12 行一致）。
- 关闭：owner 停止**新受理**；**已受理的绘制与真实 raw probe 正常结算**（不 kill、不把 aborted 当结算）。

**`src/host/agent-driven/created-native-workspace.ts`（生产入口）**

```ts
// request 不再接受自由 base 字符串，改为接受受控 owner：
readonly serving:unknown;   // 必须是本模块签发的 owner
```
- 生产前：取 `openFilmServingBinding(serving)`；`null` ⇒ `NATIVE_CACHE_ORIGIN_FOREIGN`（**producer 运行前**拒绝，零请求零写）。
- 逐项比对：`binding.canonical_root === 被签发 root`（`facts.root`）、`binding.dev/ino === 被签发 root 的持有目录身份`、
  `binding.generation` 与本 view 的 generation 一致、`binding.closed === false` ⇒ 任一不符即拒绝。
- **见证激活前再次复核**同一 owner 与同一 root 分配（设计文件第 14 行）：关闭/重开/换根 ⇒ 撤销见证、拒绝激活。
- `base` 由服务从绑定中取得，**不接受调用者给出的 origin 字符串**。

### 1.3 旧接口调用方

- `createPinnedOpenFilmFolderServer`：生产代码内**无**调用方；唯一调用方是 `native-cache-witness.test.ts:79`。
- `produceNativeCacheEntry` 的 `request.base`：唯一调用方是 `native-cache-witness.test.ts`（B0-1/B0-2/B0-3/B0-4/K01-a…K04-b 等 11 处）。
  ⇒ 改签名只影响该测试文件（**已在 15 候选内**）。

### 1.4 必红测试（对旧实现必红 → 新实现绿）

| 用例 | 旧实现 | 新实现 |
|---|---|---|
| **N1（真实异目录 origin 负例）**：本 case 自有**另一个根**，其中放同名 `film.html`（可运行、内容不同），用**真实受控 owner** 服务它；把**本根 lease** + **外根 owner** 交给生产 | **绿/错**：旧实现照画不误并**激活见证** → 断言“绘制前被拒、零页面请求、零缓存写入、见证不可见” ⇒ **红** | 绿（`NATIVE_CACHE_ORIGIN_FOREIGN`） |
| **N2（复制/伪装/已关闭/重开 owner）**：复制 owner、伪造同形对象、关闭后的 owner、重开产生新代次的 owner | 旧实现不检查 origin ⇒ 可能红/绿不定，**断言“绘制前被拒”⇒ 红** | 绿 |
| **N3（本根正例）**：本根 owner ⇒ 真实 pageframe/海报绘制成功、见证激活、下一稳定轮被读者接受 | 绿 | 绿（回归保护） |
| **N4（peer close 语义）**：B0-2 的 owner close 不杀对端在飞绘制 | 绿 | 绿（回归保护） |

> N1 需要**真实上游 headless 浏览器**（HEAVY）。

### 1.5 原 17 映射

`R04/native_cache`（预审标 UNPROVEN_REMAINING_MAJORS）直接命中；`R02/tamper_and_authority`（外来能力在权威使用前被拒）加强；
`R01/R02/lease_isolation`（lease↔owner 随实例绑定）加强；其余 14 项**不受影响**。

### 1.6 资源归属与关闭

listener 归 owner 自己；服务 `disposeAfterNative` 先关闭 owner（停止受理）再释放 root；已受理请求由 Node server 收尾；
真实 raw probe 归上游 serving，由上游自己的 promise 结算，关闭时**等它结算**（不 kill）。无裸数字 FD 重试；不全局杀进程。

### 1.7 回退与受影响门禁

回退＝恢复 `source-captures/` 中上一代字节（`openfilm-upstream.ts 29a0827a…`、`created-native-workspace.ts 32d5adae…`）。
受影响：`native-cache-witness.test.ts`（B0/B2/A3c 重跑）、`created-native-source-reader.test.ts`（消费路径）、全量 `pnpm check`。

---

## 2. PF02 — film-duration 仍是**未被见证**的有限值伪造（CODE_DEFECT_STATIC_INFERENCE，MAJOR）

### 2.1 可达调用链（当前实际字节）

1. 固定上游绘制 film 页时**额外**写 `.film/cache/film-duration.json`（`pageframes.mjs:103`，内容 `{film:'<mtimeMs>:<size>',duration}`）。
2. `src/host/agent-driven/created-native-source-reader.ts:1226-1235`：读者只做**形状**校验
   —— JSON 可解析 ✔、`record.film === \`${film.mtime_ms}:${film.bytes}\`` ✔、`duration` 为有限数 ✔ ⇒ **接受**。
3. 该分支**不查任何见证**（`#proveWitnessedCache` 只覆盖 pageframe 三件套 `:1244-1251` 与海报 `:1237-1243`）。
⇒ 在稳定签发的 workspace 里**手写** `film-duration.json`（stamp 与真实 film 一致、`duration:999999` 或负有限数）**不调用 producer**，
下一次稳定读取即接受这些**伪造字节**（静态推论，**未执行**）。

### 2.2 最小实现（复用**现有** service-owned 见证账本，不引入第二套自签权威）

**`src/host/agent-driven/native-cache-witness.ts`（账本，按输出路径查找）**

```ts
/** 账本里**按输出路径**找到那次真实 guarded production 的 ACTIVE 见证。 */
lookupByOutput(workspace_ref:string,generation:number,output_path:string):NativeCacheWitness|null
```
- 账本在 `activate()` 时维护 `scope+' '+output_path → witness` 的**最新**索引（同路径被后来的合法绘制激活时替换旧索引）。
- 来源仍是那一次**实际 guarded production**；不是任意文件补签接口。

**`src/host/agent-driven/created-native-workspace.ts`（把 duration 作为真实输出捕获进 pending 见证）**

- 生产成功、POST 闭包持有后：若 `.film/cache/film-duration.json` 存在 ⇒ `after.retainFile(...)` 取其**全身份**，
  作为**这次 draw 的真实输出**并入 staged 见证（例如新增 `duration_output: NativeCacheFileIdentity|null`，
  或作为 `outputs` 中该路径的一项）。
- 因为它进入 `witness.outputs`，**既有的最终围栏自动覆盖它**：`created-native-workspace.ts:616-646` 的 `checkOutputs()`
  会在**结算之后、激活之前**用**真实路径身份**再核一次（`sameIdentity` 全项：dev/ino/size/mtime_ns/ctime_ns/nlink），
  失败 ⇒ `NATIVE_CACHE_OUTPUT_MOVED` ⇒ 见证撤销。**满足 MAIN 的“pending 捕获 + 最终全身份复验 + 清理确认后才 active”。**

**`src/host/agent-driven/created-native-source-reader.ts`（分类改为要求见证）**

```ts
// film-duration.json 分支：
const witness=this.#workspaces.cacheWitnessByOutput(baseline.workspace_ref,baseline.instance_generation,
  '.film/cache/film-duration.json');
if(witness===null)refuse('NATIVE_SOURCE_CACHE_UNWITNESSED','The film duration cache entry was not produced by the fixed producer');
const output=witness.outputs.find(e=>e.path==='.film/cache/film-duration.json');
if(output===undefined||!sameFileIdentity(file,output))refuse('NATIVE_SOURCE_CACHE_FORGED','The film duration cache entry is not the output the witness is about');
// 既有形状校验（film stamp + finite duration）保留，作为**第二道**而非唯一一道
```
- 服务侧新增只读入口 `cacheWitnessByOutput(ref,generation,outputPath)` 转发到账本（`created-native-workspace.ts:376` 旁）。

**不把旧 frame 永久绑死在当时的 duration inode 上**：duration 的证明来自**按输出路径查到的最新 ACTIVE 见证**；
后续合法绘制更新同一 duration 输出时由**最新**见证证明；**第一次**绘制的 frame 三件套仍按**各自**输出与依赖被接受（不被 duration 变更打死）；
陈旧 metadata 也不会被自动再授权（其见证已非最新且身份不符 ⇒ 拒绝）。

### 2.3 必红测试（对旧实现必红）

| 用例 | 旧实现 | 新实现 |
|---|---|---|
| **N5（无 producer 伪造 duration）**：稳定 workspace 里手写 `film-duration.json`（`film` 与真实 film 的 `mtime_ms:bytes` 一致、`duration:999999`）⇒ 读者必须拒绝 | **绿（错）**：旧实现只查形状 ⇒ “拒绝”断言 **红** | 绿（`NATIVE_SOURCE_CACHE_UNWITNESSED`） |
| **N6（同字节新 inode / 改后恢复 / 来源不同）** | 旧实现接受 ⇒ **红** | 绿（`..._FORGED` / `..._STALE`） |
| **N7（真实产出稳定消费）**：真实 producer 绘制 film 页 ⇒ duration 由该次 draw 的见证覆盖 ⇒ 下一稳定轮接受 | 旧实现也绿（但**无见证**）⇒ 需新断言“见证存在且覆盖该输出路径” ⇒ **红** | 绿 |
| **N8（连续两次合法绘制）**：第二次合法绘制更新同一 duration 输出 ⇒ 当前 metadata 由**最新**见证证明；**第一次**的 frame 三件套仍可消费 | 旧实现无见证概念 ⇒ 新断言 **红** | 绿 |

> N5–N8 需要真实 producer（HEAVY：上游 headless 浏览器）；N5 的伪造部分本身是纯 FS。

### 2.4 原 17 映射

`R04/native_cache` 直接命中；`R03/complete_dependencies`（sidecar/元数据依赖须被证明）加强；`R02/tamper_and_authority` 加强；其余不受影响。

### 2.5 资源归属与关闭

纯读路径（账本查询 + 身份比较），**不新增 FD、不新增资源**；见证的产出身份沿用既有 `outputs` 与最终围栏。

### 2.6 回退与受影响门禁

回退＝`source-captures/` 上一代字节（`native-cache-witness.ts 85b1e804…`、`created-native-workspace.ts 32d5adae…`、`created-native-source-reader.ts f00e0278…`）。
受影响：`native-cache-witness.test.ts`、`created-native-source-reader.test.ts`（B1）、全量 `pnpm check`。

---

## 3. PF03 — PRE/POST 多条真实清理错误的合并**未实际触达**（EXPLICIT_FAULT_COVERAGE_GAP，MAJOR）

### 3.1 可达调用链（当前实际字节）

1. `created-native-workspace.ts:507`（PRE `RetainedNativeClosure.open`）→ `:515` producer 真跑 → `:517`（POST `open`）。
2. 失败路径：`:582` 捕获 primary；`:585` `after.release()`、`:586` `before.release()` 各自收集；
   `:595-598` 把 `cleanupFailures` 与 primary 自带的 genuine 合并，`mergeRetainedCleanupCauses(primary, cleanupFailures)`。
3. 现用例 **K05-a**（`native-cache-witness.test.ts:678-735`）在 producer **之前**失败（owner 已 close）⇒ **POST 从未打开**；
   **K05-b**（`:748-799`）成功但只对**一个**分配注入故障（`opened[0]`），且只断言**一次**命中。
⇒ 一个“静默丢掉 `after.release` 的失败”或“只保留其中一条”的实现能通过现有缓存用例；纯闭包三因场景
（`created-native-source-reader.test.ts:2814`）**不执行** wrapper 的合并/撤销路径。

### 3.2 最小实现

**先落用例，不先改生产代码**（设计文件第 31 行：不得改预期去适应实现）。

**(a) 让“具名分配身份”可观测（Host-private seam 的最小扩展）**

`src/host/agent-driven/retained-native-closure.ts:273-297` 的 `RetainedNativeDescriptorOps` 目前只有
`close?(fd:number)`、`open?(path,flags)`、`onRead`、`onReadChunk` —— 回调只能拿到 **fd 数字**，而 MAIN 明确要求
“**不以 fd 数字作为分配身份**”并“独立记录 allocation id、phase、path”。

```ts
/** 一次真实分配的具名身份：闭包内的单调 id + 路径 + 相位。不含 fd。 */
export interface RetainedNativeAllocation{readonly id:number;readonly path:string;readonly phase:'PRE'|'POST';}
export interface RetainedNativeDescriptorOps{
  readonly close?:(fd:number,allocation?:RetainedNativeAllocation)=>void;
  readonly open?:(path:string,flags:number,allocation?:RetainedNativeAllocation)=>number;
  readonly phase?:'PRE'|'POST';   // 由服务按闭包注入；闭包在 open/close 回调里带给用例
  ... // onRead / onReadChunk 不变
}
```
- 闭包内部维护**单调 allocation id**（每开一个描述符 +1）；`path` 为该描述符打开的路径；`phase` 由服务在
  `RetainedNativeClosure.open(root,{},{...this.#descriptorOps,phase:'PRE'},pool)` / `'POST'` 注入。
- **向后兼容**：`allocation` 是可选参数，既有夹具（K05-a/K05-b、034/035 其它用例）不改也能编译、语义不变。

**与 MAIN 设计的差异（明说）**：设计文件说“不需要新增公共 hook”。我的最小实现**扩展的是既有 Host-private 观察 seam**，
**不是**新增公共 hook、不新增公共 DTO/EnginePort/pin/015 产物；扩展的**唯一目的**是满足 MAIN 自己的
“独立记录 allocation id、phase、path；不以 fd 数字作为分配身份”。

**(b) 联合用例（真实触达）**

`tests/agent-driven/integration/native-cache-witness.test.ts` 新增 **K05-c**：

1. **真实 producer 成功**（owner 正常，不关闭）⇒ POST 闭包**确实打开**（用 `phase==='POST'` 的分配证明）。
2. 在 **POST acquisition 的既有 Host-private 观察 seam**（`descriptorOps.onRead`）上，对**本 case 自己的工作副本**
   制造**确定性内容变化** ⇒ 真实比较得到主因 `NATIVE_CACHE_SOURCE_RACED`（真实比较，不是伪造媒体事实，不需要新公共 hook）。
3. 对 **PRE 与 POST 各一个不同具名分配**（按 `phase`+`path`+`id` 选定）分别注入**独立**的 release 故障：
   **先真实 close，再报错**（不留下活着的 FD、不二次关闭、不按裸数字重试）。
4. 断言：
   - ① 预定主因**确实触达且未被覆盖**（`code==='NATIVE_CACHE_SOURCE_RACED'`，且它仍在 cause 链首位）；
   - ② **每个独立 genuine Error 对象恰一次**保留（两个 Error 实例各出现一次，且是同一个对象）；
   - ③ **PRE/POST 均有实际分配和释放命中**（按 `phase`+`path`+`id` 记录，非 fd）；
   - ④ 所有受理资源都被**尝试结算**（每个分配各 close 一次，无重复）；
   - ⑤ 失败后**任何见证不可见**（`cacheWitness(...)===null`）；
   - ⑥ 服务**粘滞**拒绝后续生产（`NATIVE_CACHE_PRODUCTION_UNCERTAIN`）。
5. **oracle 自检（负控制）**：同文件再跑一遍“注入但不抛”的配置，断言原因数**恰好为 1** ⇒ 证明该断言对
   “丢掉 POST 失败”的实现**会红**（若断言恒真 ⇒ 收据作废，本用例不得签署）。

**(c) 若新用例暴露合并确实丢失**（例如只保留一条 genuine），再按 MAIN 审核的**最小**实现修补
`created-native-workspace.ts:584-598` 的合并段（保留 primary、逐条保留 cleanup causes、全部尝试结算），并复验受影响证据。
**不**先改实现。

### 3.3 旧接口调用方

`RetainedNativeDescriptorOps` 的生产方：`created-native-workspace.ts:195/197`（构造参数 `descriptorOps`）与 `:507/:517`（两次 open）；
用例方：`tests/agent-driven/integration/helpers/native-source-fixture.ts`（`productionDescriptorOps` 透传）与
`native-cache-witness.test.ts:682/752`。扩展为**可选参数** ⇒ 其它用例零改动。

### 3.4 原 17 映射

`R07/cleanup_uncertainty`（预审 PARTIAL_EXPLICIT_COVERAGE_GAP）直接命中；`R07/per_allocation_fd_lifetime`（分配身份与一次释放）命中；
`R04/native_cache`（见证不可见/粘滞）命中；其余不受影响。

### 3.5 资源归属与关闭

注入的 close **先真实关闭再报错** ⇒ 无残留 FD、无二次关闭、无裸数字重试；分配身份为单调 id+phase+path；
失败后服务粘滞（`#uncertain`），owner 仍持有的 FD **不被手动销毁**。

### 3.6 回退与受影响门禁

回退＝`source-captures/` 上一代字节（`retained-native-closure.ts 776331d6…`、`native-cache-witness.test.ts eb5c71c9…`）。
受影响：`native-cache-witness.test.ts`（B2/A3c）、`created-native-source-reader.test.ts`（B1）、全量 `pnpm check`。

---

## 4. LF03 — 并发同内容导入被误拒（**真实代码缺陷**，实际栈 `#hashFile:515` ← `#import:452`）

### 4.1 已确定的根因（本轮读到实际字节，**不再是假设**）

`src/host/agent-driven/local-asset-registry.ts`：

| 行 | 事实 |
|---|---|
| `:106` | `fingerprint(info) = [dev, ino, size, mtimeNs, ctimeNs].join(':')` —— **含 ctimeNs** |
| `:397` | 每次导入建自己的 `staging`（随机名 `.input`） |
| `:446` | `await link(staging, destination)`；EEXIST 被容忍（`:449-451`）⇒ **destination 与发布者的 staging 是同一 inode**（nlink=2） |
| `:452` | `blobProof = await this.#hashFile(destination, expected, true, destinationCanonical)` |
| `:492` | `finally { … await unlink(staging) }` ⇒ **发布者撤掉自己的 staging 硬链接 ⇒ destination inode 的 ctime 改变**（nlink 2→1），字节不变 |
| `:497-523` | `#hashFile`：`before` stat → 读哈希 → `:514` `fingerprint(before) !== fingerprint(await handle.stat(...))` → `:515` `throw conflict()` |
| `:524-549` | `#assertBlob`：**已经**对“同字节 ctime 变化”做了**重读重哈希**处理（`:533-534` 注释明写“发布者撤销 staging 硬链接会改变 ctime 而不改字节”），但只在**断言端** |

⇒ **失败点不是 `#assertBlob`，而是 `#hashFile` 自己内部的前后身份比较（`:514`）**：并发导入 B 在 `destination` 上取证明时，
A 恰好在 B 的证明窗口内撤销了自己的 staging 链接 ⇒ B 的 `before`/`after` ctime 不同 ⇒ 误判“事实或字节已变”。
036 实录栈正是 `#hashFile:515 ← #import:452 ← #importWithSlot:368`（log 第 2746-2757 行）。

> MAIN 指出的“方案 §7.3 针对 `before_publish/assertBlob` 的复现不证明此 bug”**正确**：本节改为在 **`#hashFile` 的真实证明窗口**内复现。

### 4.2 最小实现（不放宽身份检查、不盲删 ctime 校验、不用重试掩盖 tamper）

**`src/host/agent-driven/local-asset-registry.ts:497-523`（`#hashFile`）**：把内部稳定性比较改成与 `#assertBlob` **同一套**语义：

```ts
// 内容身份：dev/ino/size/mtime 相同 —— 换 inode、换路径、改大小、改 mtime 仍然拒绝
const contentIdentity=(a:BigIntStats,b:BigIntStats):boolean=>
  a.isFile()&&[a.dev,a.ino,a.size,a.mtimeNs].join(':')===[b.dev,b.ino,b.size,b.mtimeNs].join(':');
const after=await handle.stat({bigint:true});
if(!contentIdentity(before,after))throw conflict();
// ctime-only 变化（并发发布者撤销 staging 硬链接）：从**同一个已打开的 fd** 重读并重哈希，
// 内容摘要必须仍是 expected，且重读前后身份必须稳定（沿用 #assertBlob:547 的写法）
if(before.ctimeNs!==after.ctimeNs){ /* 重读 + 重哈希 + 稳定性复核 */ }
```
- **仍然拒绝**：路径替换、符号链接、不同 inode、大小/mtime 改变、真实字节损坏（内容摘要不符）、`realpath !== canonical`。
- **仅容忍**：同一 inode、同一内容、同一 mtime，仅因**链接计数变化**导致的 ctime 变化（发布者撤 staging 的正常生命周期）。
- 与 `#assertBlob`（`:535-548`）**同一套**判定 ⇒ 两端语义一致，不再出现“断言端已容忍、证明端仍误拒”的分裂。

> MAIN 拒绝的**方案 A**（“允许一次失败让用户重试以降低合同”）**不采纳**；并发的两次同内容导入**必须都成功**。

### 4.3 必红测试

| 用例 | 旧实现 | 新实现 |
|---|---|---|
| **N9（036 真实并发用例，`local-assets-host.test.ts:310`）**：两次同内容、不同幂等键的并发导入 ⇒ 都成功、**一份**不可变资产事实、**两份**正确回执、**一次**业务注册事件、并发上限 2、已取消排队请求不占槽 | **红**（036 实录：1 failed，错误“Local asset facts or bytes changed”） | 绿 |
| **N10（`#hashFile` 证明窗口内的确定性复现）**：用**既有** `boundary` seam 在**第二个**导入的 `before_publish` 之后，对 **destination** 追加/撤销一个临时硬链接（只改链接计数、**不改字节**）⇒ 命中 `#hashFile` 的 ctime 分支 | **红**（旧实现抛 “Local asset facts or bytes changed”） | 绿（接受，内容摘要相同） |
| **N11（tamper 负例，不得被放宽）**：路径替换、符号链接、不同 inode、大小/mtime 改变、字节损坏 ⇒ 全部仍拒绝 | 绿 | 绿（回归保护） |
| **N12（replay/冲突/回滚/取消/超时/媒体子进程退出/Host 关闭）** | 绿 | 绿（回归保护） |

- N10 的断言必须**同时**证明：① 字节与内容摘要**完全相同**（这是 ctime-only 差异，不是内容变化）；
  ② 两次导入的**内容事实**一致；③ 没有引入第二个幂等权威、数据库或跨项目内容信任。

### 4.4 写路径与门禁

- **新写路径**：`src/host/agent-driven/local-asset-registry.ts`（**不在** 15 候选内，需 037 新增授权）。
- 测试文件 `tests/agent-driven/integration/local-assets-host.test.ts`（HEAVY：真实媒体子进程 ffprobe/ffmpeg）。
- 受影响门禁：`local-assets-host.test.ts`、全量 `pnpm check`。

---

## 5. LF04 — 状态写入归属（两个 offender，**两类不同问题**）

### 5.1 offender ①：`src/host/agent-driven/created-source-change-service.ts:54`（`#replay`）

当前字节：
```ts
this.options.host.revisions.compose(db=>db.prepare("UPDATE impact SET state='expired',updated_at=? WHERE impact_id=? AND project_id=? AND state='active'")
  .run(this.#clock().toISOString(),impact.impact_id,input.project_id));state='expired';
```
- 直接 SQL 写 `impact` 状态，随后**无条件**把本地 `state` 置为 `'expired'`；
  现有权威 `ImpactStore.markExpired/transition`（`src/host/impact/impact-store.ts:173-201`）已具备
  **期限判断、合法迁移、预期状态与 changes 检查**，且 `CreatedSourceImpactStore` 已有同样的委托先例
  （`src/host/agent-driven/created-source-impact-store.ts:484-494`：`consume()` → `this.#impacts.transition(impactId,'active','consumed',now)`）。
- **修法（最小、复用权威）**：
  1. `src/host/agent-driven/created-source-impact-store.ts` 增加**最小 Host 内部委托**（与 `consume()` 同形）：
     ```ts
     /** Move to 'expired' only when the deadline really passed. The authority decides. */
     expire(impactId:string,now:Date):ImpactRow{ return this.#impacts.markExpired(impactId,now); }
     ```
  2. `created-source-change-service.ts:52-56` 改为调用该委托，并把 `state` 取自**数据库读回**（`this.options.impacts.state(...)`），
     **不再本地无条件赋值**；过期边界、终态重放、并发状态变化由权威判定。
  3. **不引入第二套状态机**、不换数据库：仍同一 `revisions` DB（`ImpactStore` 与该服务同一连接）。
- **必红测试（对旧实现必红）**：
  - **N13**：`#replay` 命中过期时，**数据库里的 impact 行确实变为 expired**（不是仅本地 state 变量）——旧实现写库了，此条绿；
    ⇒ 真正的必红点是下一条。
  - **N14（必红）**：**未到期限**或**已是终态**时，`#replay` **不得**报告 expired：旧实现的条件是
    `state==='active' && now>=expires_at` 才写库，条件相同 ⇒ 需更强的场景：
    **并发状态变化**（另一写入方在 `#replay` 读取之后把 impact 推进到 `consumed`）⇒ 旧实现的 UPDATE 因 `state='active'` 谓词**匹配 0 行**，
    却仍**本地**把 `state` 置为 `'expired'`（**报告了数据库没有发生的状态**）⇒ 断言“报告的状态必须与库中实际状态一致”**红**；
    新实现（委托 + 读回）⇒ 库中为 `consumed`，报告也必须是 `consumed`/`revoked` 对应值 ⇒ 绿。
  - **N15**：到期边界（`now === expires_at`）与终态重放（`expired`/`stale`/`consumed`）行为由权威判定，断言与 `ImpactStore` 一致。

### 5.2 offender ②：`src/host/projects/revision-store.ts:672-673`（`commitPreparedCreatedSource`）

- 实际字节：`UPDATE impact SET state='consumed',updated_at=? WHERE impact_id=? AND project_id=? AND state='active' AND impact_hash=?`
  且 `changes!==1 → fail('IMPACT_CAS')` —— **已经**满足 MAIN 要求的“前态在谓词里 + 恰好一行 + 与 revision/approval/snapshot 同事务回滚”。
- 与已在 fitness 规则中**按文件+方法注册**的 `commitAdoption`（`:905-908`）、`commitHistoryRestore`（`:1027-1030`）**同形同义**。
- **结论**：这是**登记缺口**，不是代码缺陷。
- **修法**：`tests/architecture/m2.2-fitness.test.ts` 的 `scopedHelpers` 增加
  `["commitPreparedCreatedSource"]`（**仅** revision-store.ts 这一个文件），保持规则“registered, not exempted”的语义。
- **必红测试（扫描器负向必须能打红）**：
  - **N16**：规则 1 变绿（0 offender）。
  - **N17（负向）**：在**另一个文件**里造一个同名 `commitPreparedCreatedSource` 方法并写同形 UPDATE ⇒ 规则 1 必须**报红**
    （证明不是按名字全局放行）。
  - **N18（负向）**：在 revision-store.ts 里新增一个**未注册**的同类写入方法 ⇒ 必须**报红**。
  - **N19（负向）**：把现有注册项去掉任一保护（前态谓词 / `changes!==1` / hash 谓词）⇒ 对应**业务负向用例**（状态错配、跨项目、摘要不符）必须**打红**。

### 5.3 写路径与门禁

- **新写路径**：`src/host/agent-driven/created-source-change-service.ts`、`src/host/agent-driven/created-source-impact-store.ts`、`tests/architecture/m2.2-fitness.test.ts`。
- 受影响门禁：`m2.2-fitness.test.ts`、涉及 `change.prepare` 的既有测试、全量 `pnpm check`。

---

## 6. LF05 — 整文件 `request./req./body.` 正则命中新增 HTTP serving

### 6.1 事实

- 失败断言：`tests/m2.1/openfilm-upstream-lock.test.ts:212`
  `expect(source).not.toMatch(/request\.|req\.|body\./u)`（用例名 “never lets a caller supply the vendor path through a request”，`:209`）。
- 现在命中**正当**代码：`src/adapters/openfilm/openfilm-upstream.ts:331/398`（`pageFrame(request:{…})`）、`:627`（`req.method !== "GET"`）、
  以及 folder server 的 `handle(req,res)`。这些是**本候选新增**的固定上游页面服务，不是“调用者从请求里塞 vendor 路径”。
- 门禁**意图**（`:210` 注释）：vendor 路径只能是**装配期参数**，不能来自请求。

### 6.2 修法（用真实能力边界证明，不改变量名、不删断言、不整体豁免）

**改 `tests/m2.1/openfilm-upstream-lock.test.ts` 的该条断言为能力边界证明**（保留其余 13 条不动）：

1. **保留**：伪造验证判决被拒（`:193-207`）、无 shell/spawn（`:215-218`）、固定 argv git status（`:218`）。
2. **改为 AST 能力边界断言**（复用 `tests/architecture/m2.2-fitness.test.ts:30-40` 已有的 `ts.createSourceFile` 手法，**不新增依赖**）：
   - 找出 `src/adapters/openfilm/openfilm-upstream.ts` 中所有导出工厂（`createPinnedOpenFilmUpstream`、
     `createPinnedOpenFilmCacheProducer`、`createPinnedOpenFilmFolderServer`、**新增的 serving owner 工厂**），
     断言它们的 vendor 路径参数（`vendorRoot`）是**普通 `string` 形参**（装配期），且**函数体内没有任何**
     request/req/body 形参或标识符参与 vendor 路径的求值（AST 上：vendor 路径的引用链只经过形参与模块常量）。
   - 断言模块**没有**从任何 `IncomingMessage`/`ServerResponse` 形参派生 vendor 路径。
3. **新增负向证据**（证明新断言有牙）：
   - **N20**：在一个**合成副本**里把 vendor 路径改成从 `req.headers['x-vendor']` 派生 ⇒ 新断言必须**报红**。
   - **N21**：把 vendor 路径改成经由 `request.body` 传入 ⇒ 必须**报红**。
4. **明确不做**：不把 `openfilm-upstream.ts` 里的 `request`/`req` 改名为别的词（MAIN 明确拒绝“仅改变量名”）；
   不删除该断言；不把整个模块从门禁范围里排除。

> 备选（若 MAIN 认为**不得**改这道遗留门禁）：把新增的 HTTP serving 迁到独立模块
> `src/adapters/openfilm/openfilm-serving.ts`，让 loader 模块重新“request-free”。
> 该备选**新增一个写路径**且会把门禁范围缩小，**我推荐上面的 AST 能力边界方案**，但由 MAIN 裁决。

### 6.3 写路径与门禁

- **新写路径**：`tests/m2.1/openfilm-upstream-lock.test.ts`（该文件**不在** 15 候选内）。
- 纯静态用例（合成 checkout 于 `/tmp`、假 git），**非 HEAVY**。

---

## 7. LF01 / LF02 — 迁移夹具缺失与“真实媒体”声明边界

### 7.1 完整引用清点（本轮实际读取）

**唯一缺失源**：`tests/fixtures/m2.1/snapshot-project/assets/generated/`（**整个目录在本 worktree 不存在**）。

| 文件 | manifest/descriptor 声明 | canonical 实际字节 | 本 worktree |
|---|---|---|---|
| `assets/generated/visual-10s.mp4` | `narralens.assets.json:6-7` → sha256 `0427d617584264ac2875243d6cf711dd985577566f71db6b9d5faf051575989c` | **17 字节**，`SNAPFIX-VISUAL-A\n`（sha 与 manifest **逐字一致**） | **缺失** |
| `assets/generated/visual-alt-10s.mp4` | `narralens.assets.json:23-24` → sha256 `40d825e66ee7e69ae53dfdc8d5195fbb9ffc3af7eb07452a5081c51e24115cff` | **17 字节**，`SNAPFIX-VISUAL-B\n`（逐字一致） | **缺失** |
| `assets/generated/narration-30s.wav` | `narralens.project.json:32` `narration_asset` | **18 字节** opaque（sha `e4276d5e…`） | **缺失** |
| `assets/narration.vtt`、`narralens.assets.json`、`narralens.project.json`、`runs/build.svrun` | — | 已跟踪 | **存在** ✔ |

**引用方（全部 5 个失败套件 + 1 个既有通过套件）**：

| 引用点 | 需要的文件 |
|---|---|
| `tests/m2.3/migration-service.test.ts:26,54-55`（`cp` 整个 fixture 目录到私有 source） | 两个 visual |
| `tests/m2.3/migration-real-export.test.ts:30,214`（`readFile(SOURCE_FIXTURE + "assets/generated/visual-10s.mp4")`） | visual-10s |
| `tests/m2.2/snapshot-store.test.ts:30,74,91-94` | 两个 visual + narration-30s.wav |
| `tests/m2.3/openfilm-migrator.test.ts:18,38,71` | visual-10s + narration-30s.wav |
| `tests/m2.2/host-coordinator-integration.test.ts:70,107-108` | visual-10s |
| `tests/m2.1/native-bypass.test.ts:267,283`（036 通过） | 引用但未打开字节 |

**关键事实**：这三个文件被 `.gitignore` 命中（`.gitignore:19-20` 的 `*.mp4`、`*.wav`；以及 `fixtures/d1-30s/assets/generated/`），
**从来不在 git 里**，只存在于 canonical 工作副本（`git status --ignored` 显示 `!! tests/fixtures/m2.1/snapshot-project/assets/generated/`）。
⇒ 本 worktree 缺它们不是回归，而是**前置条件从未随仓库分发**。

**并且**：manifest 里登记的 sha256 **正是**那 17 字节占位符的摘要 ⇒ 组件合同就是这组 opaque 字节，
**换成真实媒体会破坏合同**（LF03 观察文件亦如此记载：`fixtures/d1-30s` 有真实 3.3MB mp4，但**不得**换入）。

### 7.2 交付方案（请 MAIN 裁决，我执行其中之一）

**方案 A（推荐）：字节精确地把这三个 opaque 文件交付到本 worktree**
- 来源：canonical `/mnt/c/workspace/videoworkline/Narralens/tests/fixtures/m2.1/snapshot-project/assets/generated/`（**只读**复制）。
- 交付后校验：三个文件的 sha256 与 manifest/观察记录**逐字相等**（`0427d617…`、`40d825e6…`、`e4276d5e…`），大小 17/17/18。
- **它们是 gitignored、未跟踪** ⇒ 不需要 `git add`、不改 `.gitignore`、不进索引；写路径需 MAIN 精确授权
  （`tests/fixtures/m2.1/snapshot-project/assets/generated/{visual-10s.mp4,visual-alt-10s.mp4,narration-30s.wav}`）。
- 交付后 5 个套件应转绿；**证据性质＝组件夹具流转**，**不是**真实媒体验收。

**方案 B：夹具在测试 setup 里确定性生成**（改 5 个套件的 harness 写出相同 17/17/18 字节）
- 需要 5 个测试文件的新写路径（`migration-service.test.ts`、`migration-real-export.test.ts`、`snapshot-store.test.ts`、
  `openfilm-migrator.test.ts`、`host-coordinator-integration.test.ts`），改动面更大，且会把“合同字节”散落进 5 处。

**方案 C：维持缺失**，把这 5 个套件记为 `NOT_RUN / BLOCKED_BY_MISSING_FIXTURE`。
- 诚实，但**全量门禁无法转绿**，且 036 的 47 条失败中 44 条仍悬空。

### 7.3 LF02：声明边界必须更正（不得互相冒充）

- 事实 1：`narralens.assets.json` 把 17 字节文件声明为 `media_type: "video/mp4"`、`kind: "video"`、`duration_frames: 900`
  —— 它是**不透明占位**，**不是视频**。
- 事实 2：`tests/m2.3/migration-service.test.ts:64-67` 明确写着这些资产“都声明 900 帧”，并用
  `new AssetRegistry(catalog,{videoFrames:async()=>900})` —— 该 harness **自己声明**了这是 stub（这一点它没有隐瞒 ✔）。
- 事实 3：`tests/m2.3/migration-real-export.test.ts:80` 用例名 “produces two **real**, different exports …”、
  `:209-215` 注释称 `recorded D1 artifact` —— 但它只是 `readFile` 17 字节并 `sha256`，然后直接返回 `durationFrames: 900`。
  ⇒ **声明与事实冲突**：该用例证明的是 opaque 字节与清单的流转，**不**证明真实 SOURCE 视频/导出，也不证明 900 帧时长。
- 事实 4：旧 migrator 的 `clipHtml` 用 **title / stage / duration**，不是原始视觉素材
  ⇒ **真实输出帧本身不能证明源视觉被保留**。
- **修法**：
  1. **更正声明**（不改行为）：`migration-real-export.test.ts` 的用例名/注释改为与事实相符（“opaque fixture 的两次不同导出”，
     明确“非真实媒体、非录制 D1 产物、900 帧为常量输入”）。
  2. **新增一条真正分开**的用例（真实媒体链路）：用本 worktree **已存在**的真实媒体
     `fixtures/d1-30s/assets/generated/visual-10s.mp4`（3,376,451 字节）与 `narration-30s.wav`（5,760,078 字节），
     经**本机固定 ffmpeg/ffprobe** 实际探测/完整解码，断言真实 duration/fps/分辨率/音轨；该用例**单独命名、单独记录**，
     **不**与 m2.3 的组件用例混同，**不**宣称 A 影片级验收。
  3. **三类证据分层记录**（组件 opaque 流转 / 旧 migrator 结构化输出 / 真实媒体探测解码），任一类**不得**代替另一类宣称业务真实验收。
  4. 旧 Gate 记录与 036 失败**全部保留**，不追认、不改写。

### 7.4 写路径与门禁

- 方案 A：`tests/fixtures/m2.1/snapshot-project/assets/generated/` 下 3 个文件（未跟踪、被 ignore）。
- LF02：`tests/m2.3/migration-real-export.test.ts`（改名/注释 + 新增真实媒体用例）——**新写路径**。
- 真实媒体用例的资源：**本机既有 ffmpeg/ffprobe**（不下载、不安装、不联网）；诊断媒体**不是** A 影片证据。
- 真实 A 的两条 60–180 秒中文有声影片仍单列 **NOT_RUN**（不得用彩条/正弦音冒充）。

---

## 8. 精确写路径请求清单（请 037 逐条放行或拒绝）

### 8.1 已在 15 候选内（037 只需延续，无需新增）

`src/host/agent-driven/native-cache-witness.ts`、`src/host/agent-driven/created-native-workspace.ts`、
`src/host/agent-driven/committed-snapshot-authority.ts`、`src/host/m5/openfilm-native-expected.ts`、
`src/adapters/openfilm/openfilm-upstream.ts`、`src/host/agent-driven/retained-native-closure.ts`、
`src/host/agent-driven/created-native-source-reader.ts`、`tests/agent-driven/integration/native-cache-witness.test.ts`、
`tests/agent-driven/integration/created-native-source-reader.test.ts`、`tests/agent-driven/integration/helpers/native-source-fixture.ts`、
`tests/agent-driven/integration/helpers/created-draft-fixture.ts`、`tests/agent-driven/integration/created-native-workspace.test.ts`、
`tests/agent-driven/integration/committed-snapshot-host.test.ts`、`tests/agent-driven/integration/created-native-ack.test.ts`、
`tests/agent-driven/integration/created-draft-processor.test.ts`

### 8.2 **新增**请求写路径（本轮尚不存在授权）

| 路径 | 用途 | 归属 |
|---|---|---|
| `src/host/agent-driven/local-asset-registry.ts` | LF03 `#hashFile` 证明端与 `#assertBlob` 同一套 ctime 语义 | LF03 |
| `src/host/agent-driven/created-source-impact-store.ts` | LF04 增加最小 `expire()` 委托（复用 `ImpactStore.markExpired`） | LF04① |
| `src/host/agent-driven/created-source-change-service.ts` | LF04① `#replay` 改用权威委托并读回真实状态 | LF04① |
| `tests/architecture/m2.2-fitness.test.ts` | LF04② 精确文件+方法登记 `commitPreparedCreatedSource` + 负向用例 | LF04② |
| `tests/m2.1/openfilm-upstream-lock.test.ts` | LF05 能力边界断言 + 新负向证据 | LF05 |
| `tests/m2.3/migration-real-export.test.ts` | LF02 声明更正 + 独立真实媒体用例 | LF02 |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/visual-10s.mp4`（17B, sha `0427d617…`） | LF01 方案 A | LF01 |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/visual-alt-10s.mp4`（17B, sha `40d825e6…`） | LF01 方案 A | LF01 |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/narration-30s.wav`（18B, sha `e4276d5e…`） | LF01 方案 A | LF01 |
| （备选）`src/adapters/openfilm/openfilm-serving.ts` | LF05 备选：把 HTTP serving 迁出 loader 模块 | 仅当 MAIN 选备选 |

### 8.3 仍然**不**触碰

`contracts/**`、`src/contracts/**`、`package.json`、`pnpm-lock.yaml`、`config/dependencies`、`src/host/server.ts`、
`src/host/agent-driven/creation-application.ts`、`src/host/agent-driven/start-runtime.ts`、`src/host/projects/**`（除 §5.2 的**只读**核对）、
`src/host/m5/native-observation.ts`、`src/host/m5/native-ack-store.ts`、`src/host/agent-driven/created-source-recovery.ts`、
`src/host/agent-driven/created-source-adoption-service.ts`、`src/host/agent-driven/created-source-publisher.ts`、
`src/host/agent-driven/created-publication-recovery-files.ts`、`src/host/agent-driven/retained-source-tree.ts`、
pin/015 产物、`.gitignore`、`AGENTS.md`（保护）、索引与提交。

> 注：`src/host/projects/revision-store.ts` 的 **代码** 不需要改（LF04② 只是门禁登记），但它属于 MAIN 独占目录，
> 因此 §5.2 只做**只读**核对，任何写都需要 MAIN 另行放行。

---

## 9. 必红测试矩阵总览（旧实现必红 ⇒ 新实现绿）

| 编号 | 用例 | 文件 | 旧实现 | 真实资源 |
|---|---|---|---|---|
| N1 | 真实异目录 origin 负例（零请求零写） | native-cache-witness.test.ts | 红 | 上游 headless 浏览器 |
| N2 | 复制/伪装/关闭/重开 owner 负例 | 同上 | 红 | 同上 |
| N3 | 本根真实绘制正例 | 同上 | 绿（保护） | 同上 |
| N4 | peer close 语义 | 同上 | 绿（保护） | 同上 |
| N5 | 无 producer 伪造 film-duration | created-native-source-reader.test.ts | 红 | 纯 FS |
| N6 | 同字节新 inode / 改后恢复 / 来源不同 | 同上 | 红 | 纯 FS |
| N7 | 真实产出被见证且覆盖 duration 输出路径 | native-cache-witness.test.ts + reader | 红（新断言） | 浏览器 |
| N8 | 连续两次合法绘制：最新见证生效、旧 frame 仍可消费 | 同上 | 红 | 浏览器 |
| N9 | 036 并发同内容导入必须**都成功** | local-assets-host.test.ts | **红（036 实录）** | 真实媒体子进程 |
| N10 | `#hashFile` 证明窗口内 ctime-only 确定性复现 | 同上 | 红 | 真实媒体子进程 |
| N11 | tamper 负例仍拒绝 | 同上 | 绿（保护） | 同上 |
| N12 | replay/冲突/回滚/取消/媒体子进程/Host 关闭回归 | 同上 | 绿（保护） | 同上 |
| N13 | 过期时数据库确实变为 expired | change-service 相关 | 绿 | 纯 DB |
| N14 | 并发状态变化后**报告状态必须等于库中实际状态** | 同上 | **红** | 纯 DB |
| N15 | 到期边界/终态重放与 `ImpactStore` 一致 | 同上 | 红/绿（需断言） | 纯 DB |
| N16 | fitness 规则 1 变绿（0 offender） | m2.2-fitness.test.ts | **红（036 实录）** | 纯静态 |
| N17 | 另一文件的同名方法**仍报红** | 同上 | 红（需断言） | 纯静态 |
| N18 | 新增未注册写入方法**报红** | 同上 | 红（需断言） | 纯静态 |
| N19 | 去掉前态/hash/CAS 保护 ⇒ 业务负向**打红** | 同上 + 业务测试 | 红（需断言） | 纯 DB |
| N20 | 合成副本：从 `req.headers` 派生 vendor 路径 ⇒ 断言报红 | openfilm-upstream-lock.test.ts | 红（需断言） | 纯静态 |
| N21 | 合成副本：从 `request.body` 派生 vendor 路径 ⇒ 断言报红 | 同上 | 红（需断言） | 纯静态 |
| N22 | 夹具交付后 5 个迁移套件转绿（且**不**宣称真实媒体） | m2.2/m2.3 套件 | **红（ENOENT）** | 纯 FS/SQLite |
| N23 | 真实媒体独立用例：ffprobe 实际探测 + 完整解码 | migration-real-export.test.ts（新增） | 红（不存在） | 本机 ffmpeg/ffprobe |
| N24 | PF03 联合清理用例 + 负控制（oracle 有牙） | native-cache-witness.test.ts | 覆盖缺口 | 浏览器 |

---

## 10. 原 17 项映射（本次改动对每一项的影响）

| 原要求 | 本次影响 | 说明 |
|---|---|---|
| R01/producer_chain | 不变（回归） | PF01/PF02 只加强**证明**，不改生产链 |
| R01/independent_trees | 不变（回归） | 无目录/树结构改动 |
| R02/tamper_and_authority | **加强** | PF01（外来 origin 在权威使用前被拒）、PF02（未见证 duration 拒绝）、LF03（tamper 负例仍拒绝） |
| R03/complete_dependencies | **加强** | PF02 把 duration 纳入“须被证明的依赖” |
| R04/native_cache | **直接命中** | PF01（origin↔root）、PF02（duration 见证）、PF03（联合清理） |
| R05/actual_probe | 不变（回归） | LF03 的媒体子进程行为需回归（N12） |
| R05/child_lifetime | 不变（回归） | PF01 的 owner close 语义须与“子进程真实退出后才释放”一致（N4） |
| R06/native_bytes_and_order | 不变（回归） | 无字节/顺序改动 |
| R07/budgets | 不变（回归） | 无预算改动；PF01 新增 owner 不引入媒体读取 |
| R07/per_allocation_fd_lifetime | **加强** | PF03 引入具名分配（id+phase+path），不再以 fd 作身份 |
| R07/cleanup_uncertainty | **直接命中** | PF03 的 PRE+POST 联合清理证明 |
| R07/drain_and_delivery | 不变（回归） | PF01 owner 关闭须等已受理绘制结算 |
| R01/R02/lease_isolation | **加强** | PF01 owner↔lease↔instance 绑定 |
| REG/existing_behavior | **回归** | LF03/LF04/LF05 改既有模块 ⇒ 既有 84 断言与 legacy 门禁**必须全绿**才算未弱化 |
| EVIDENCE/frozen_capture | 记录 | 本轮只新增文档证据；源码字节在 037 release 冻结后重录 |
| REVIEW/independent_acceptance | 仍待 | 本方案不构成独立复核 |
| NEXT/next_integration_plan | 仍待 | 停在接线开工门槛之前 |

---

## 11. 真实资源与拟命令（**全部待 037 runtime grant，逐条精确 argv**）

### 11.1 资源判定

| 资源 | 归属 | 是否需要额外授权 |
|---|---|---|
| 上游固定 headless 浏览器（pinned vendor tree 自带 chromium） | 现有 036 已用；不下载、不安装 | 否（HEAVY 需排期） |
| 本机 ffmpeg / ffprobe | 现有；不下载、不安装 | 否（HEAVY 需排期） |
| SQLite（每 worktree 独立 var） | 现有 | 否 |
| `/tmp` 临时根 | 现有 | 否（收据纪律） |

**不涉及**：网络、下载、付费、J 盘、provider/凭据、浏览器可见窗口、迁移、旧 Gate 写、install、config。

### 11.2 拟命令顺序（串行；每步单独申请、单独读 result）

1. **纯静态/纯编译（不需 heavy slot）**
   - `corepack pnpm exec tsc --noEmit`（cwd = main-integration；唯一 capture 名 `n1n2-claude-037-tsc-001`；走既有 `run-recorded.py`）。
2. **纯 FS / 纯静态聚焦（不需 heavy slot）**
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts`
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/architecture/m2.2-fitness.test.ts`
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.2/snapshot-store.test.ts`
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.2/host-coordinator-integration.test.ts`
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.3/migration-service.test.ts`
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.3/openfilm-migrator.test.ts`
3. **HEAVY（真实浏览器 / 真实媒体子进程）—— 逐个申请，不并行**
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-witness.test.ts`（浏览器）
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts`（ffprobe + 诊断媒体）
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/local-assets-host.test.ts`（媒体子进程）
   - `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.3/migration-real-export.test.ts`（新增真实媒体用例时：ffmpeg/ffprobe）
4. **全量门禁**：`corepack pnpm check`（含两次 vite build）——**只在**上述全部绿、且 MAIN 单独发放全量 grant 后执行一次，不重跑。

**纪律**：capture 名唯一 `n1n2-claude-037-*`；完整 argv/stdout/stderr/实际 exit/输入 SHA256 全部留档；
运行中源码/测试/tools/config/索引冻结；**不得**从偶发绿里挑选；失败即保留。

---

## 12. 回退

- 每个改动点都对应 `source-captures/` 中的上一代字节（15 候选逐个备份）+ 下面这份文档记录的前值哈希；
  回退＝恢复那些字节，**不需要** `reset/stash/checkout`。
- 新增写路径（§8.2）在合并前是**新增文件/新增局部改动**，回退＝撤销该文件的改动或移除新增夹具文件（3 个 opaque 文件）即可。
- 全量门禁若因新改动转红，**失败即为失败**：保留捕获，不改预期去迎合实现。

---

## 13. 声明边界与不宣称

- 本文件是**方案**，不是实现，不是 PASS，不自签独立外审。
- 本轮**没有**执行任何反例：PF01/PF02 的反例、LF03 的确定性复现、N1–N24 全部**尚未运行**，其结果一律 **NOT_RUN**。
- PF01/PF02 的可达性论证来自**静态阅读实际字节**，不是已复现的失败。
- LF03 的根因是**静态可达性 + 036 实录栈**的结合：栈证明失败点在 `#hashFile:515`；
  “并发发布者撤销 staging 硬链接导致 destination inode ctime 变化”这条**因果链尚未用确定性复现证明**（N10 就是该复现）。
- 真实 A 的两条 60–180 秒中文有声影片：**NOT_RUN**（本阶段无用户素材，不用彩条/正弦音冒充）。
- 不宣称 NativeAck、Studio、接线、A 影片、V1。
- 新 429 ⇒ 立即停工保全，不自动重试、不换 provider/凭据/实现者。
