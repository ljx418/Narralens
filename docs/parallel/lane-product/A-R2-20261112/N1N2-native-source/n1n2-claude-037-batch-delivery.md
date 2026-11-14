# N1N2 037 — 集中批次交付（源码 + 测试 + 夹具 + 一次编译的实际结果）

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，`HEAD=e2eff61b464d75d36598103d718cd2a75db5dfda`，索引**空**。
范围：`UNIFIED_CORRECTIVE_RELEASE_037.md` + `.json`（18 个源码/测试路径 + 3 个固定摘要 opaque 夹具）。
**未** git add/commit/reset/stash/checkout/push；**未**改保护文件（AGENTS.md、Expected015、committed-snapshot-authority、
revision-store 生产实现、pin/配置/契约/tools/旧 Gate）。

---

## 1. 一次编译的实际结果（失败，保留）

| 项 | 值 |
|---|---|
| capture | `n1n2-claude-037-tsc-001`（`docs/execution/A/implementation-20261111/integration/e1-main-takeover/`） |
| argv | `corepack pnpm exec tsc --noEmit`（经原 `run-recorded.py`，sha256 `88cd47ec…` 未改） |
| **实际 exit** | **2** |
| log sha256 | `4eac4966689928f83312543c5aa286f2d42a442cc7e83f993ec77cae0c800813` |
| source_changed / source_added | `[]` / `[]`（运行中输入零漂移） |
| 错误 | **16 条，全部在 2 个测试文件**；**8 个生产文件零类型错误** |

失败明细（原样保留在 capture 日志里）：

| 文件 | 错误 | 性质 |
|---|---|---|
| `tests/agent-driven/integration/native-cache-witness.test.ts:539,544` | TS2304 Cannot find name 'serving' | 我把 K01-d 的 serving 声明**误插到了 K01-a**（脚本锚点命中了第一个同形片段） |
| `tests/agent-driven/integration/native-cache-witness.test.ts:731` | TS2304 Cannot find name 'workspaceRoot' | 我把 `workspaceRoot=f.workspaceRoot;` **误插到了 K05-b**（同上），K05-c 反而缺赋值 |
| `tests/m2.1/openfilm-upstream-lock.test.ts`（13 条） | TS2339/TS7006 | **TypeScript 5.9 的 `ts.Expression` 是 interface 而不是 union**，`switch (expression.kind)` 不再收窄；`ts.SpreadElement` 也不在 `Expression` 里 |

### 1.1 失败后已做的三处修正（**改在失败 capture 之后**，因此需要一次新的编译来验证）

1. `native-cache-witness.test.ts`：K01-a 里多余的 serving 声明删除；K01-d 在**视图被替换之前**取 serving；
   K05-b 里误插的赋值删除；K05-c 在夹具创建后补 `workspaceRoot=f.workspaceRoot;`。
2. `openfilm-upstream-lock.test.ts`：`tainted()` 改用**编译器的类型守卫**（`ts.isIdentifier` / `isPropertyAccessExpression` /
   `isElementAccessExpression` / `isCallExpression` / `isNewExpression` / `isAwaitExpression` / `isParenthesizedExpression` /
   `isNonNullExpression` / `isAsExpression` / `isTypeAssertionExpression` / `isSatisfiesExpression` / `isConditionalExpression` /
   `isBinaryExpression` / `isSpreadElement`）逐类收窄，**不再依赖 kind 的 switch 收窄**。规则的**语义未变**：
   仍按请求的**类型**（`IncomingMessage`/`ServerResponse` 等）+ 别名 + helper 传递来追taint。
3. 字节备份与全路径清单已按修正后的字节**重新保存**（§4）。

**没有**为了让编译变绿而改任何断言、放宽类型或改动生产实现。

---

## 1b. 第二次编译（037 放行）：**实际 exit 0**

| 项 | 值 |
|---|---|
| grant | `COMPILE_037_002_GRANT.json`（`N1N2_037_COMPILE_002_ONLY`，串行一次，仅编译） |
| capture | `n1n2-claude-037-tsc-002` |
| argv | `corepack pnpm exec tsc --noEmit`（原 recorder，sha256 `88cd47ec…` 未改） |
| **实际 exit** | **0** |
| log | **0 字节**，sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（空文件摘要——tsc 没有输出任何一行） |
| source_changed / source_added | `[]` / `[]`（626 个输入，零漂移） |
| 起止 | 2026-11-13T07:45:04Z → 07:45:33Z，`git_head=e2eff61…` |

**自有清理（终态之后的观察）**：本次运行没有留下任何自有子进程（无 tsc/vitest/ffprobe/ffmpeg/录制器）；
`127.0.0.1:4747`/`:4748` **无监听**（早前 036 的两个孤儿仍然消失）；`/tmp/narralens-*` 计数 **234**，未删未扫；
`HEAD` 未变、**索引空**、已跟踪 dirty 集合 = `AGENTS.md` + 释放白名单内的路径；18 个候选 + 3 个夹具重算
**零漂移**（与 `n1n2-claude-037-batch-inventory.json` 逐项相等）；三个 opaque 夹具仍**未被跟踪且被忽略**
（`.gitignore:19`），其 `git add -f` 仍由 MAIN 执行。

**编译不是 PASS**：它不构成验收，N1..N24 **全部仍 NOT_RUN**；LF03 的因果链仍只是**实际代码 + 036 栈的静态推论**
（N10 未复现）；PF03 与 LF03 的**变异/反事实**证据**仍未**主张；**没有**把「新增测试不存在」当成 old-red 证明。

---

## 2. 本批次实际实现（逐条对应 037 的裁决）

### PF01 — origin 与被签发根同源（`src/adapters/openfilm/openfilm-upstream.ts`、`src/host/agent-driven/created-native-workspace.ts`）

- 新增 **自持 listener 的 serving owner**：`createPinnedOpenFilmServingOwner(producer, root, options?)`。
  它自己 `createServer` + `listen(127.0.0.1,0)`、自己拥有 handler、自己关闭；**只**接受**本模块签发的 producer**，
  vendor 路径取自 producer 的私有登记（`issuedProducerRoots`），**不接受调用者的字符串**。
- 模块私有 `WeakMap` 是唯一登记处；`openFilmServingBinding(owner)` 只给出**只读副本**（origin / canonical_root / dev / ino /
  generation / closed / requests / producer）。复制体、同形对象、handler-only 工具都**不在表里** ⇒ 无绑定。
  handler-only 的 `createPinnedOpenFilmFolderServer` **保留为非授权工具**。
- 服务**自己创建并登记** serving：`CreatedNativeWorkspaceService.servingFor(production, producer, options?)`
  按**确切签发 view 实例**（`HeldWorkspace` 对象）登记到 `#servings`，**不比较任何 generation 数字**（跨域数字相等不算绑定）。
  核对 = 对象分配身份（`request.serving === registered.owner`）+ 当前 view 事实（`assertCurrent`、当前 record）
  + root-held FD 的 **dev/ino** + owner 代次 + 未关闭。
- 生产入口**不再接受自由 `base`**：request 改为携带 `serving`，origin 只从绑定读出。
  外根真实 owner、复制体、同形对象、handler-only 工具、同根的第二 owner、已关闭 owner ⇒
  **绘制前**拒绝（`NATIVE_CACHE_ORIGIN_FOREIGN`），零页面请求、零缓存写。
- **见证激活前再次复核**同一 owner 与同一 root 分配（关闭/重开/换根 ⇒ 撤销见证、拒绝激活）。
- 关闭语义：`close()` **阻止新的生产受理**，但**不**提前断 listener；已受理绘制与真实 raw probe 继续到结算；
  `disposeAfterNative()` 在所有操作结算**之后**才关 listener，再释放 root。

### PF02 — film-duration 由真实 draw 见证（`native-cache-witness.ts`、`created-native-workspace.ts`、`created-native-source-reader.ts`）

- 真实 draw 后，POST 闭包把 `.film/cache/film-duration.json` 作为**该次 draw 的真实输出**捕获，并入 **pending 见证**
  （进入 `outputs` ⇒ 自动进入既有最终全身份围栏 ⇒ **清理确认后才 active**）。
- 账本按**输出路径**维护**当前 active 授权**（`lookupByOutput`）：后来的合法绘制成为当前授权；
  **撤销/失效不回退到旧授权**（撤销时只删除指向该见证的条目）。
- 读者对 `film-duration.json` 必须先取到该输出的当前授权，再比对**全身份**（sha/bytes/dev/ino/mtime_ns/ctime_ns/nlink）
  ⇒ 未见证、同字节新 inode、改后恢复一律拒绝（`NATIVE_SOURCE_CACHE_UNWITNESSED` / `..._FORGED`）。
- frame 三件套**只**检验它自身的实际输出，不因新的合法 duration 替换而永久失效。
- lookup 是**既有服务持有**的只读能力（`cacheWitnessByOutput`），外部无法补签。

### PF03 — PRE/POST 多条真实清理错误的联合（`retained-native-closure.ts`、`created-native-workspace.ts`）

- `RetainedNativeDescriptorOps` 增加**可选**的分配观察元数据（**向后兼容**：既有调用方零改动）：
  `close?(fd, allocation?)`、`open?(path, flags, allocation?)`、`phase?: string`；
  `RetainedNativeAllocation = {namespace, id, phase, path}` —— **单调 id + 相位 + 路径**，**不是 fd 数字**。
- 相位由**生产**包装注入（`phaseOps('PRE'|'POST')`），**调用者不能自报相位**。
- 新联合用例 **K05-c**：真实 producer 真实绘制；在 **POST acquisition 的 root open**（该树取身份**之前**）确定性改动工作副本
  ⇒ 真实比较得到主因 `NATIVE_CACHE_SOURCE_RACED`（**不是** SOURCE_MOVED：改动发生在 POST 取身份之前）；
  再对 PRE 根与 POST 根各注入**独立**的具名 release 故障（先真实 close 再报错）⇒
  断言主因**未被覆盖**、两个 genuine Error **各一次**、PRE/POST 各一次分配与释放、**零可见见证**、**粘滞拒绝**。
- 断言读的是**嵌套一层**的真实 cause（closure 的 refusal 携带它自己的 cause），不是数组非空。
- **未**声称“删除 POST 原因的变异必红”：真实变异/反事实证据需要另一次运行授权，本次 **NOT_RUN**。

### LF03 — 哈希证明窗口（`local-asset-registry.ts`）

- 根因已从假设变成**实际代码事实**：`link(staging,destination)` 使 destination 与发布者 staging **同一 inode**；
  `:492` 的 `unlink(staging)` 改变该 inode 的 **ctime**；`#hashFile:514` 用含 ctime 的 `fingerprint` 比较 ⇒ `:515` 抛错
  （036 实录栈 `#hashFile:515 ← #import:452` 一致）。而**断言端** `#assertBlob:533-548` **早已**对这一良性 ctime 变化做了重读重哈希。
- 修法：**只在已发布内容寻址对象**的证明路径上，ctime 变化时从**同一 FD、显式 offset 0** 重读完整内容，
  摘要仍须匹配 expected，**二次读取前后完整 fingerprint（含 ctime）稳定**，最终复核路径/身份；
  同步（fstat/read 风格）⇒ 同进程其他 staging 清理无法插入窗口；有界 MAX_BYTES、失败关闭、**只做一次**、无重试循环、
  **不声称知道 ctime 为何变化**。**私有 staging 路径保持严格比较，不放宽。**
- 新增 Host-private 观察点 `after_published_stat`（published blob 初始 stat 之后、读取之前），
  N10 用**真实 link/unlink** 在这个**真实证明窗口**里制造变化，并记录前后 ctime/完整身份/hash/命中次数。
  **并发上限 2、两次同内容不同 key 都要成功、一资产两回执一次事件、取消不漏槽**等原要求全部保留（N9 真实并发用例未动）。

### LF04 — 一个状态权威与原子提交（`created-source-impact-store.ts`、`created-source-change-service.ts`、`tests/architecture/m2.2-fitness.test.ts`、两个业务测试）

- `CreatedSourceImpactStore.expire(impactId, now)` ⇒ 委托既有 `ImpactStore.markExpired`；`created-source-change-service.ts` 的
  `#replay` **不再直接写 impact 状态**，改为**委托 + 读回真实状态**，不再无条件本地置 `expired`。
- fitness 规则 1 精确登记 `revision-store.ts` / `commitPreparedCreatedSource`（**文件+方法**作用域，**不改** revision-store 生产实现）。
- 负向：fitness 测试里**合成**证明「另一文件的同名方法」与「同文件未登记方法」**仍报红**；
  业务负向（真实）：他项目 impact、存储 hash 不符、他项目事务 ⇒ 提交被拒且**没有任何权威移动**（revision 仍为 1、
  impact 仍 active、approval 仍 active、事务仍 prepared）；过期语义的权威由 created-impact-atomic 的真实用例证明
  （未到期限不动、到期真动、终态不再动、缺失 impact 抛错）。
- **诚实边界**：旧实现“本地无条件置 expired”的**并发可达窗口**未被证明可达 ⇒ **不构造不可达 race 签通过**，该点记 NOT_RUN。

### LF05 — 能力边界代替整文件词法猜测（`tests/m2.1/openfilm-upstream-lock.test.ts`）

- 整文件 `request./req./body.` 词法搜索**被替换**为**来源与能力**的 AST 规则：请求按**类型**识别（`IncomingMessage`、
  `ServerResponse` 等），别名（`const q = req`）、重命名参数、经 helper 传递的值都会被追到；
  规则跟随**值**进入 loader 模块**每个** vendor 入口（从模块自身读出：`createPinnedOpenFilmUpstream` /
  `createPinnedOpenFilmCacheProducer` / `createPinnedOpenFilmFolderServer` / `createPinnedOpenFilmServingOwner` /
  `openFilmAvailability`）在 **Host 全部调用点**的参数位。
- **未**新增 serving 文件、**未**改变量名、**未**删断言；固定 argv、shell 拒绝、伪造 pin verdict 拒绝等其余 13 条**原样保留**。
- 合成负向自证有牙：header 来源、body 来源、别名、**重命名**参数、helper 传递 ⇒ 全部必须报红；装配期字符串与无关文件**不报红**。
- **已声明的局限**：taint 逐文件追踪；跨模块经“干净参数”传递的污点看不见。已写在测试注释里，**不**写成假完备断言。

### LF01 / LF02 — 夹具与真实渲染证据

- LF01 方案 A：三个 opaque 文件按固定摘要**只读复制**交付（17/17/18 字节，SHA256 逐字相符），
  **未被 git add**（被 `*.mp4`/`*.wav` 忽略），可复现性由 MAIN 显式 `git add -f` 完成；
  自身清单：`n1n2-claude-037-fixture-manifest.md`（明说它们**不是** MP4/WAV、不是真实媒体证据）。
- LF02：`migration-real-export.test.ts` 在**自己的私有临时副本**里用固定本机 ffmpeg 准备**真实可解码**的诊断媒体
  （900 帧 @30fps，两个不同画面 + 旁白），用固定 ffprobe **实测**帧数与完整解码，并把**私有副本**的 manifest 更新为
  **真实字节摘要与真实帧数**；`AssetRegistry` 改用**真实 probe**（不再用常量 900）。
  两条真实目标渲染、900 帧、中镜修改与第二次导出的既有要求**原样保留**；
  Hypit 回退侧的“导出”明确其性质：**是已记录的诊断产物**，帧数是**实测**的，不是声明的，也**不**冒称新鲜源工程导出。
  **诊断媒体不是 A 创作影片**；固定 opaque 夹具**未被改动**；生成动作只在后续重型授权内执行。

---

## 3. 逐 case 映射与当前状态

| 编号 | 用例 | 文件 | 旧实现 | 状态 |
|---|---|---|---|---|
| N1 | 真实异目录 origin 负例（零请求零写） | native-cache-witness.test.ts（PF01） | 旧实现不检查 origin | **NOT_RUN** |
| N2 | 复制/同形/handler-only/第二 owner/已关闭 owner 负例 | 同上 | 同上 | **NOT_RUN** |
| N3 | 本根真实绘制正例（B0-1/B0-4 保留） | 同上 | 绿 | **NOT_RUN** |
| N4 | peer close 语义（B0-2 保留） | 同上 | 绿 | **NOT_RUN** |
| N5 | 无 producer 伪造 film-duration | created-native-source-reader.test.ts（PF02） | 旧实现只查形状 | **NOT_RUN** |
| N6 | 同字节新 inode / 改后恢复 | native-cache-witness.test.ts（PF02） | 旧实现接受 | **NOT_RUN** |
| N7 | 真实产出被见证且覆盖 duration 输出 | 同上 | 旧实现无见证概念 | **NOT_RUN** |
| N8 | 连续两次合法绘制 | 同上 | 同上 | **NOT_RUN** |
| N9 | 并发同内容两次导入**都成功** | local-assets-host.test.ts（LF03） | **红（036 实录）** | **NOT_RUN** |
| N10 | `#hashFile` 真实证明窗口内 ctime-only 复现 | 同上 | 红 | **NOT_RUN** |
| N11 | tamper 负例仍拒绝 | 同上 | 绿 | **NOT_RUN** |
| N12 | replay/冲突/回滚/取消/媒体子进程/Host 关闭回归 | 同上 | 绿 | **NOT_RUN** |
| N13/N14/N15 | 到期权威、未到期不动、终态不动、缺失抛错 | created-impact-atomic.test.ts（LF04） | — | **NOT_RUN** |
| N16 | fitness 规则 1 变绿 | m2.2-fitness.test.ts（LF04） | **红（036 实录 2 offender）** | **NOT_RUN** |
| N17/N18 | 另一文件同名、同文件未登记方法**仍报红** | 同上 | — | **NOT_RUN** |
| N19 | 他项目 impact / hash 不符 / 他项目事务 ⇒ 无权威移动 | created-source-adoption.test.ts（LF04） | — | **NOT_RUN** |
| N20/N21 | header/body 来源、别名、重命名、helper 传递 ⇒ 报红 | openfilm-upstream-lock.test.ts（LF05） | — | **NOT_RUN** |
| N22 | 夹具交付后 5 个迁移套件转绿（组件级） | m2.2/m2.3 套件 | **红（ENOENT）** | **NOT_RUN** |
| N23 | 真实媒体私有副本：真实 probe + 完整解码 | migration-real-export.test.ts（LF02） | 红（不存在） | **NOT_RUN**（生成只在重型授权内执行） |
| N24 | PF03 联合清理 + 嵌套 cause 断言 | native-cache-witness.test.ts（PF03） | 覆盖缺口 | **NOT_RUN** |

**全部 NOT_RUN**：本轮只获准一次编译，且它失败了；**没有**运行任何 vitest / Host / 媒体 / 浏览器 / 构建 / 变异 / 全量。
**变异证据**（删除 POST 原因的变异必红、旧严格比较变异下 N10 打红）需要另一次运行授权，**未**声称。

---

## 4. 交付字节与清单

- 全路径清单（含 18 个候选 + 3 个夹具的 SHA256/字节数、以及失败 capture 的记录）：
  `n1n2-claude-037-batch-inventory.json`（修正后的字节）。
- 逐字备份：每个候选的新字节都按 `<sha256>.txt` 存于 `source-captures/`（该目录既有惯例）。
- 037 清理收据：`n1n2-claude-037-owned-cleanup-receipt.md`（sha `9b3ad345…`）。
- 夹具清单：`n1n2-claude-037-fixture-manifest.md`。
- 失败编译证据：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/n1n2-claude-037-tsc-001.*`（未覆盖、未删除）。

## 5. 回退

- 上一代候选字节在 MAIN 的 `resume-claude-20261112/source-captures/`（35 项）与本目录 `source-captures/` 中逐字保存 ⇒
  回退＝恢复那些字节，**不需要** reset/stash/checkout。
- 本批次新增的三处修正相对失败 capture 的差异只有上面三处（两个测试文件），可逐字回退到 capture 输入清单的哈希。
- 三个 opaque 夹具可随时移除（它们是未跟踪、被忽略的文件）。

## 6. 未宣称

不宣称 N1/N2 通过、不宣称任何 case 通过、不宣称独立外审、不宣称 NativeAck/Studio/A 影片/V1、
不宣称可复现的干净 checkout（夹具仍需 MAIN `git add -f`）、不宣称编译通过（唯一一次编译 **exit 2**）。
