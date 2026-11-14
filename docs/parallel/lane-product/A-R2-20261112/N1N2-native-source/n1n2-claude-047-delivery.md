# N1N2 047 — 单项 oracle 修正与缓存验收的实测交付

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_a8de95aeab93`,
terminal `term_ca33bde2-816a-489f-a7d7-b9502d3fe502`。
授权：`.../resume-claude-20261112/RESUME_TEST_VALIDATION_047.md` + 同名 `.json`（唯一权威）。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`。

**只改了一个文件、一个用例**：`tests/agent-driven/integration/native-cache-witness.test.ts`
（候选 sha256 `6ba76059a41c1820d580ea0a7ae684f62b7afcd445bdc431a1524b8c7647ccd4`，
基线 `4e24ec70a59498787734f33e11fd94a2124685f9d63100d2be7aeacc6abe3949` 保留在
`source-captures/4e24ec70….txt`）。生产代码、其它用例、夹具、配置、pin、索引**未改**。

---

## 1. 改了什么（唯一的 oracle 修正）

用例：`Q01 a registration failure with a genuine settlement failure keeps the primary and latches the service`

- **在破坏工作副本之前保存真实 production lease**：`const lease=f.productionLease();`
  放在 `servingFor` 之前（生命周期回调 `serving_root_verified` 会 `rmSync(f.workspaceRoot)`）。
  之前末尾那句 `f.productionLease()` 是在工作副本已被删除之后重新取 lease，fixture 必须重新获取，
  于是**同步抛 REVISION_CONFLICT，根本没有走到 production**——这正是 045 focused001 剩下的那个失败。
- `servingFor(lease, …)` 与后续 `produceNativeCacheEntry(lease, …)` **都用这一份保存的真实 lease**，
  没有伪造 lease、没有 mock producer、没有改生产顺序。
- **后续 production 精确断言 `NATIVE_CACHE_PRODUCTION_STALE`**（原先断言 `NATIVE_CACHE_PRODUCTION_UNCERTAIN`）。
  依据 MAIN 重读的真实源码顺序：`#produce` 先校验 lease 归属、再 `facts.lease.assertCurrent()`、
  再校验 producer、**最后**才查 `#uncertain`（`created-native-workspace.ts:651-659`）。
  工作副本已删 ⇒ lease 不再 current ⇒ **前置拒绝 STALE 先于 uncertain 分支**。
  用例注释明确写出这是「前置拒绝」，不声称覆盖了 uncertain 分支；
  uncertain 分支仍由未删除的 factory 用例（lease 仍 current）覆盖，**两条控制流不混称**。
- 保留并加强了原有断言：primary 的精确 code 是 `NATIVE_CACHE_PRODUCTION_STALE`、
  真实 genuine 对象在 **HOST 私有账本** `retainedCleanupFailures` 里**恰好一次**、
  `f.workspace.uncertain===true`、真实监听的端口已关闭（`fetch` 拒绝）。
- 新增「无见证」断言：`f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')` 为 `null`。

**没有**改生产实现、没有改生产检查顺序来迎合 expect、没有 `any throw`、没有手工往账本塞错误。

### 实际 diff（相对基线备份的唯一改动）

```
+  // The REAL lease of the issued view, taken BEFORE the working copy is broken.
+  const lease=f.productionLease();
-  try{await f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
+  try{await f.workspace.servingFor(lease,owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
+  // Nothing is visible: this production never produced a witness.
+  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
-  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
+  await expect(f.workspace.produceNativeCacheEntry(lease,{
     producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
-   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_UNCERTAIN'});
+   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_STALE'});
```
另加 15 行说明性注释（记录「先保存 lease」与「前置拒绝 vs uncertain 分支」的真实原因）。

---

## 2. 真实命令、实际 exit、日志 SHA

全部用**未改的**原 recorder `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`
（sha256 `88cd47ec732a340f54cdd4bb05b05878887697eebb0ddc94b1ccd7d0e434fd10`，未改）落盘，
cwd 均为 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，每次运行内输入冻结。

| capture | argv | 实际 exit | log sha256 | 结果 |
|---|---|---|---|---|
| `n1n2-claude-047-tsc-001` | `corepack pnpm exec tsc --noEmit` | **0** | `e3b0c442…855`（0 字节） | 编译干净 |
| `n1n2-claude-047-registration-001` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-witness.test.ts -t "Q01 a registration failure with a genuine settlement failure keeps the primary and latches the service"` | **0** | `073c9dae…da85` | `1 passed | 30 skipped (31)`，13.54s |
| `n1n2-claude-047-focused-lifecycle-001` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-witness.test.ts -t "Q01|Q02|Q03|K05-c|PF01|PF02"` | **0** | `ab52370c…3d33` | `15 passed | 16 skipped (31)`，181.20s |
| `n1n2-claude-047-native-cache-full-001` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-witness.test.ts` | **0** | `59b89102…0940` | `31 passed (31)`，381.00s |

每个 capture 的 `.exit` / `.result.json` 都由**另一个 tool 调用独立读过**，与上表一致；
四个 `.txt` 的 sha256 也由独立调用重算并与 `.result.json` 记录一致。

### 逐 case 的真实结果（focused 15 项，全部实际执行）

PF01、PF02、K05-c、Q01×8（close during construction／root moved／two concurrent／dispose／observation throws／
root check after listener／factory failure+genuine／registration failure+genuine）、Q02、Q03×2 —— **15 项全通过**。

### 完整文件 31 项（真实执行，全通过）

B0-1..B0-5、K01-a..d、K03-a/b、K04-a/b、K05-a/b/c、PF01、PF02、Q01×8、Q02、Q03×2 —— **31 passed (31)**。

其中此前 044 的三条红灯里，两条（Q01 root moved、Q03 非 film 页）已在 045 修正并在本轮保持绿；
剩下的 Q01 registration genuinecleanup 由本轮修正后转绿，**没有放宽任何断言**。

---

## 3. 冻结与资源结算

- 每次 capture 的 `inputs.json` 都是运行内冻结的 626 个文件；**四个 capture 结束后各自独立复核：626/626 匹配、0 缺失、0 不匹配**，
  候选文件在四次运行中始终是 `6ba76059…7ccd4`；每个 `result.json` 的 `source_changed`/`source_added` 均为空。
- HEAD 仍是 `e2eff61b464d75d36598103d718cd2a75db5dfda`；**git 索引为空**；已跟踪 dirty 集合 17 个文件未变；
  6 个 untracked src/tests 文件未变；受保护 `AGENTS.md` sha256 仍是 `37300463…4542b`。
- **没有** `git add/commit/reset/stash/checkout/push`；没有改 AGENTS/Expected015/pin/config/公共 DTO/EnginePort/旧 Gate/运行器。
- 自有进程全部结算：四次运行后无遗留 vitest/chrome/ffmpeg/ffprobe 进程；`127.0.0.1:4747/4748` 无监听；
  `/tmp` 的 `narralens-*` 计数 234，与 044 观察一致（未删未扫）。机器上另有 IDE 自己的 `playwright-mcp`
  与其它 workspace 的进程，**不属本 lane，未触碰**。
- 全程 Headless 静音、loopback 单重型槽；没有 J 盘、下载、付费、外传、安装、改供应商或凭据。
- **本轮没有 429**，也没有工具格式异常。

---

## 4. 未做 / NOT_RUN / 未宣称

- **未**运行 reader 套件、其它 suite、全量、build、mutation、browser 手工、媒体导出。
- 原 17 项、A 轮、V1、frozen review、独立外审：**均未宣称通过**；本文件只证明
  `native-cache-witness.test.ts` 这一个文件在本次授权范围内的实测结果。
- 本轮**没有**修改生产代码，**没有**关闭 PF01–PF03 之外的任何 MAIN 验收项，**没有**自签独立复核。

## 5. 回退

回退只需把 `tests/agent-driven/integration/native-cache-witness.test.ts` 还原到
`4e24ec70a59498787734f33e11fd94a2124685f9d63100d2be7aeacc6abe3949`
（`…/resume-claude-20261112/source-captures/4e24ec70….txt` 即逐字节副本）。
该文件是 untracked 新文件，索引为空，**回退不影响任何已提交内容与用户 dirty**。
