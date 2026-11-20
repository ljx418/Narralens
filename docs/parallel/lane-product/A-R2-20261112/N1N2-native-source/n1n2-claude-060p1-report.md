# n1n2-claude-060p1 — 每 draw 独占 worker 域与父资源排空接线（实施与自验证报告）

- release_id: `MAIN_RELEASE_060P1_ISOLATED_CACHE_IMPLEMENTATION`
- task_id: `task_82ff141a33a3` / dispatch_id: `ctx_514ede48a225`（本次为用户显式恢复后的同任务新 dispatch；上一次 `ctx_d18c60329d26` 的 429 停止回执 `060P1_429_STOP_CONFIRMED.json` 完整保留，未被覆盖）
- 依据: `ADR_060_ISOLATED_CACHE_DRAW.md` rev2（sha256 `27c6bcbc46ab5473716cc04a92ac3f50a1ee027d68045db72048af488168d6f2`，与 `RELEASE_060P1.json` 的 `adr_sha256` 实测一致）、`ADR_060_APPROVAL.json`、`060P1_EXACT_SCOPE_PROPOSAL.json`（其 NOT_RELEASED 状态由本票覆盖，仅取其最终 JSON 路径/命令）、`RELEASE_060P1_PREPARATION_DRAFT.md`
- ACK 与基线: `n1n2-claude-060p1-ack-baseline.md`
- 实施者自签: **不是外审**。源码冻结、最终全量门与独立审查由 MAIN 后续组织。

## 0. 一句话结论

本波按已审 ADR 写出了**真正的**每 draw 独占 worker 域（独占 POSIX session/group、私有有界 pipe、真实 PID/startticks/PPID/PGID/SID 握手、候选≠settled、FINALIZE_AFTER_OK 先于授权终止、精确组 TERM→KILL、Z 与已知后代都要消失）与**父资源排空接线**（真实 Readable 源 close、HTTP、frameDuration probe 的账本；执行域灭→同步封准入→drain→endDraw），并把完整 production scope 从 workspace 最外层 PRE 前持到 witness 激活之后。**本波只运行了本票允许的静态/调度门**；所有真实 child/Chrome/媒体证据 **NOT_RUN**，A057-04 **未修复完成**，N1N2/NativeAck/Studio/A/V1 **不可用**。

## 1. 写入范围（严格等于本票 allow_existing / allow_new）

### 新增（8 个，全部在 allow_new 内）

| 路径 | 责任 | sha256 |
|---|---|---|
| `src/adapters/openfilm/cache-production-scope.ts` | Host 内**唯一**的生产 scope 调度器：物理根 dev/ino 共享锁、别名同锁、2 活跃/32 总排队/同根 8 排队/30 秒排队截止、可取消队列、只读根状态、CLEANUP_REQUIRED 保持占用 | `62950689cafa932e062f376d5201508772d2b8e25c3de3759ca4d25d24e2cc3f` |
| `src/adapters/openfilm/cache-process-supervisor.ts` | 私有 reservation/DrawHandle、HELLO/GO 握手与内核身份核验、有界私有协议、候选与结算分离、分阶段精确回收、无转移 barrier、inspect/reconcile | `1f9d559024d817308b5890088809a45b20cb0eb991d740214a7d97efab152c27` |
| `src/adapters/openfilm/openfilm-cache-worker.mjs` | 单 draw worker：先验字节→装局部 policy→装正式 render 的 offline guard→直接加载固定 pageframes 原字节→只画一次→封出生→关浏览器→等授权终止 | `eae2aa1c1f26b05938784b14eaec7bb58fdb6a9791a3c82d0eed609f749eaed5` |
| `src/adapters/openfilm/cache-worker-policy.mjs` | worker 局部 policy：复用正式 render 的 `media-process-policy.mjs` **原字节**，拒绝 fork/exec/execSync，记录真实调用清单，出生闸门 | `55c08c83d6d1f0f6cfa4e042e3aa0703f3ca2a8bcb62418be1e32175a090ddd1` |
| `src/adapters/openfilm/cache-worker-integrity.json` | 新完整性清单（生成物，**不含自身**；上游摘要来自 canonical lock） | `0def2c352eba2562dd8e41252e5008ad31cdf4906320d97a8814959ad69d275d` |
| `tools/openfilm-cache-worker-integrity.mjs` | 默认只 check 的完整性工具；`--generate` 仅写上面那一个路径 | `4c207c8d41bcd0601eadafb9294733eefce9f1af542cfd7add1a8c4dd62fc18b` |
| `tests/agent-driven/integration/cache-production-scope.test.ts` | 调度器整文件纯测试（**本波已运行，10/10 通过**） | `cb79ce0ee6b070b878594f91626d65f8c2662ff726cb0da6553669003cf69a9c` |
| `tests/agent-driven/integration/cache-process-settlement.test.ts` | 结算测试（本波**不运行**，见 §6 的 P2 计划） | `309b1c12adbbca2113c5b7acd21fe887eeebbc01bd7b075e360c9af0aee2df16` |

### 修改（均在 allow_existing 内）

| 路径 | 本波改了什么 | sha256 |
|---|---|---|
| `src/adapters/openfilm/openfilm-upstream.ts` | 生产者不再在 Host 内加载 pageframes；每 draw 走 supervisor；folder serving 增加真实 Readable 源账本、准入冻结/重开、父资源 drain 顺序；bridge 在 endDraw 前先灭域、封准入、drain | `5a417f9ebe231ad332589e0fa299d24602285f002a33991373f3ca839ab23579` |
| `src/host/agent-driven/created-native-workspace.ts` | `#produce` 最外层持 scope（PRE 前取、witness 激活后还），取 scope 后重新核对 lease/视图/根 | `bbf25b455d95a780f96719c83a414b4f0e8cb02b7cd4932e5535576a45e6bf94` |
| `src/host/agent-driven/created-native-source-reader.ts` | 读取准入与交付 guard 都查**对应物理根**的安静状态（新增 `NATIVE_SOURCE_ROOT_BUSY`）；generic production lease 的 `assertCurrent` **未**因此自我失效 | `0a52b8ff16652cf4bf439ef19812b05a4a417396a9139dd4ee4ce7df8505289e` |
| `tests/agent-driven/integration/native-cache-witness.test.ts` | B0-2 的**语义**随 ADR 变化：共享浏览器不存在了，每 draw 一个进程域；断言体不变，说明文字改正 | `02a7b90f4163e36fd039ee865b15c08860f4ee295c403eed996617b2eca306c1` |

### 没有动的东西

- `tests/m2.1/openfilm-upstream-lock.test.ts`：**未修改**（静态 fitness 无需登记新 owned-callsite——新模块不调用 loader 的任何导出，loader 的导出集合与 vendor-path 位置也未变；该测试在本波**运行并通过**，60/60）。
- `tests/agent-driven/integration/native-cache-witness.test.ts` 之外的既有测试文件、`created-native-source-reader.test.ts`、AGENTS.md、pin/V/vendor/lock/Approved015/正式 render 代码/公共 DTO/EnginePort7/源事务与审批/旧证据/无关 media-lane 工作：**全部未动**。
- 059/P0 的全部 dirty 与失败证据保留；git index 仍为空；未执行任何 git add/commit/reset/stash/checkout/push/merge。

## 2. 逐条 ADR 要求的实现位置

| ADR 要求 | 实现位置 | 本波状态 |
|---|---|---|
| A03 完整生产 scope（PRE 前→POST/两树释放/最后 witness 激活之后） | `created-native-workspace.ts` `#produce`（外层取 scope，`finally` 在 `#produceWithinScope` 完全结束后才还） | 已实现；**真实路径 NOT_RUN** |
| A03 同物理根 dev/ino 跨 owner 共享锁、别名不双锁 | `cache-production-scope.ts` `cacheProductionRootFacts`/`rootKey`（dev:ino 为索引，canonical root 同时核验） | **已实证**（调度器测试含别名用例） |
| A03 direct factory 共享同一 scheduler、不递归占槽 | `openfilm-upstream.ts` 生产者 `pageFrame`：有环境 scope 就复用，没有就从**同一**调度器取自己的 | 已实现；真实路径 NOT_RUN |
| A03 reader 准入/交付 guard 查对应根；generic lease 不自我失效 | `created-native-source-reader.ts` 两处 `cacheProductionRootState(workspaceLease.root)`；`assertCurrent` 未改 | 已实现；真实路径 NOT_RUN |
| A05 2 scope / 32 排队 / 同根 8 / 30 秒 | `cache-production-scope.ts` `CACHE_PRODUCTION_LIMITS` | **已实证**（含 32/8/超时/取消） |
| A01 无转移 barrier、CLEANUP_REQUIRED 保持 pending | `cache-process-supervisor.ts` `#holdForCleanup`（不 settle，标记 scope）；`#fail` 只有在 `#proveDomainGone` 为真时才 settle 失败 | 已实现；真实路径 NOT_RUN |
| A01 inspect/reconcile 只认私有 handle、用新鲜证明结算一次 | `CacheProcessSupervisor.inspectCleanup` / `reconcileCleanup`（WeakMap 私有表 + 重新读内核 + settleOnce） | 部分实证（外来 handle 被拒已在本波自审；新鲜证明需真进程） |
| A02 真正 Readable 源 close 账本（response close ≠ 源 FD close） | `openfilm-upstream.ts` `res.on("pipe", source)` 登记源，源 `close/error` 才出账本；响应中止时 destroy 本响应真正拥有的源 | 已实现；真实 FD 证据 NOT_RUN |
| A02 准入冻结 + drain + 下次 draw 重开 + close 永久封 | `openfilm-upstream.ts` `freezeAdmission/openAdmission`、`servingFor.beginDraw` 重开、`close` 永久封、bridge 先灭域→封准入→drain→endDraw | 已实现；真实证据 NOT_RUN |
| A04 FINALIZE_AFTER_OK 先于授权终止、记录观察 signal | `cache-process-supervisor.ts` `facts.finalizeAfterOk=true` → 之后才 `writeMessage({kind:"finalize"})`；`observedSignals` 记 `exit:`/`SIGTERM:group`/`SIGKILL:group` | 已实现；真实证据 NOT_RUN |
| 候选 JPEG ≠ settled | supervisor 只在 `#proveDomainGone` 为真后才 `#settle(picture)` | 已实现；真实证据 NOT_RUN |
| 真实 owned 域退出才算结束（含 Z 与已知后代） | `#proveDomainGone`：组为空 **且** 每个记录过的 (pid,startticks) 都不在了（Z 计入“还在”） | 已实现；真实证据 NOT_RUN |
| 不盲杀旧数字 PID | `#terminate` 先用内核校验 leader 的 (startticks,pgid)，只对**组**发信号；leader 身份不可读时只对自己 spawn 的 child pid 发信号（Node 未 reap 前 pid 不可复用） | 已实现；真实证据 NOT_RUN |
| HELLO/GO + 真实 PID/startticks/PPID/PGID/SID | supervisor 与 worker 双向核验（worker 自述 + /proc 读数必须逐项相等，且 pgid==pid==sid、ppid==Host） | 已实现；真实证据 NOT_RUN |
| 私有有界 pipe；ticket 不在 argv/env/URL/log | ticket 只在私有 pipe 的 GO 帧里；worker argv 只有自身路径；env 是白名单（无 NODE_OPTIONS） | 已实现 |
| 固定 pageframes 原字节直接加载；局部 policy 在上游/Chrome 前安装 | worker：`verifyIntegrity` → `installCacheWorkerPolicy()` → 注册 guard → `import(pageframes)` | 已实现；真实证据 NOT_RUN |
| 只复用正式 render 工具原字节，不执行其 entrypoint，不改其 policy/guard | worker 复用 `media-process-policy.mjs` / `openfilm-offline-hooks.mjs` / `openfilm-offline-wrapper.mjs` / `openfilm-guard-rules.mjs` 的**原字节**（清单里的摘要与 `openfilm-render-pin.json` 相同）；未 import `openfilm-render-worker.mjs` | **已实证**（integrity --check 通过，摘要与正式 render pin 一致） |
| integrity 工具默认只 check、不隐式写；--generate 只写许可路径 | `tools/openfilm-cache-worker-integrity.mjs`：默认分支即 `--check`；`--generate` 只写 `cache-worker-integrity.json` | **已实证**（--check 退出 0；--generate 的 source_changed 只有那一个文件） |
| manifest 不 hash 自身；Host 编译信任与固定上游 pin 区分 | 清单 `host_modules`（本仓库原字节）与 `pinned_upstream`（**复制**自 `contracts/openfilm-upstream-lock.json`，不被 --generate 重算）两段分开；清单不含自身路径 | **已实证**（工具对这两条都有断言） |

## 3. 本波实际执行的命令（全部经统一 recorder，串行，源文件前后不变）

recorder: `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`（sha256 `88cd47ec732a340f54cdd4bb05b05878887697eebb0ddc94b1ccd7d0e434fd10`，与 release 一致）

| capture | argv | exit | log sha256 | source_changed |
|---|---|---|---|---|
| `n1n2-claude-060p1-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | `b126163571b5b74f17bba6ed24789018cf3c72ce7f597c4e95e99ca48b8bfb64` | `["src/adapters/openfilm/cache-worker-integrity.json"]`（**这就是许可的源码生成变更，单独捕获，未混进 runtime**） |
| `n1n2-claude-060p1-typecheck-001` | `corepack pnpm exec tsc --noEmit` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` |
| `n1n2-claude-060p1-syntax-worker-001` | `node --check src/adapters/openfilm/openfilm-cache-worker.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` |
| `n1n2-claude-060p1-syntax-policy-001` | `node --check src/adapters/openfilm/cache-worker-policy.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` |
| `n1n2-claude-060p1-integrity-check-001` | `node tools/openfilm-cache-worker-integrity.mjs --check` | 0 | `80519d2216cfff4c3355a8052cacd64f9dc5023625f27e3e3125b69e2fbae816` | `[]` |
| `n1n2-claude-060p1-scheduler-001` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-production-scope.test.ts` | 0 | `d48d6a8905cbb2e4ed7105d059ce83f41766c8f12f203e0926f536f52344aadc` | `[]` |
| `n1n2-claude-060p1-m21-lock-001` | `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts` | 0 | `46d2e2627dec28d66d4fb086762a93ef13ec7c91945ca5f93e516c5114b38d16` | `[]` |

全部 **exit 0**，全部 runtime 捕获 **source_changed=[]**。没有失败需要保留（唯一一次失败发生在**捕获之前**的开发迭代：调度器测试最初把“全局队列满”判在“同根队列满”之前，与 ADR 无冲突但让同根的窄拒绝不可观测；已改为先判窄拒绝，该次失败已由最终捕获取代，细节见 §7）。

**没有运行**（本票明令禁止）：fullcheck/build、任何真实 child/browser/media/Host、SIGKILL/EPERM 探针、用户窗口/焦点；没有联网/下载/付费/J 盘/凭据/.env/全量 env 读写。

## 4. ISO-01..18 逐条状态

图例：**实现并实证** = 代码写了且本波有真实证据；**实现，真实证据 NOT_RUN** = 代码写了但需要真实进程/浏览器/媒体，本波未跑；**NOT_RUN** = 本波未跑也未实现到可运行状态。

| ISO | 内容 | 状态 | 实现路径 / 缺什么 |
|---|---|---|---|
| ISO-01 | 真实连续两帧 + poster | 实现，真实证据 NOT_RUN | 生产者改为每 draw 独占 worker；需要 P2 的真实浏览器证据 |
| ISO-02 | 真实 seek 15s / JOB 45s，外层 60s 不遮盖 | 实现，真实证据 NOT_RUN | `CACHE_DRAW_LIMITS.outerMs=60_000 > 45_000`；worker 侧仍走上游自己的 FRAME/JOB 分支 |
| ISO-03 | capture 30s 走真实资源 + 明确 transport barrier | **NOT_RUN** | 需要 P2 的真实 capture 资源与 barrier 标注 |
| ISO-04 | late launch / newPage continuation 不得越过执行域清理 | 实现（机制），真实证据 NOT_RUN | 出生闸门 + 组域证明；需 P2 的“晚启动” fixture worker（**需 MAIN 释放 helper 路径**） |
| ISO-05 | 两个物理根并行，清理 A 时 B 存活；同根别名共享锁 | **别名共享锁：已实证**；两根并行：已实证（调度器）；真实 worker 并行：NOT_RUN | 真实部分需 P2 |
| ISO-06 | 完整同根锁覆盖 preexisting→PRE→worker→drain→POST→两树释放→最终门→witness 激活 | 实现，真实证据 NOT_RUN | scope 在 `#produce` 最外层持有 |
| ISO-07 | close/cancel/断管（GO 前/后）；重复 close 只结算一次；不交付晚到结果 | 部分实现，真实证据 NOT_RUN | `settleCalled` 保证一次；外层 deadline 到点先失败、晚到候选不被采纳 |
| ISO-08 | 真实协议/JPEG/stdout-stderr 洪水有界拒绝并真正清理 | 实现，真实证据 NOT_RUN | 帧上限 8MiB、消息上限 64KiB、stdout/stderr 各 64KiB、诊断尾 8KiB；需 P2 的洪水 fixture worker |
| ISO-09 | TERM-ignore→KILL 实际回收；child close + 组 ESRCH + 已知后代消失（含 Z） | 实现，真实证据 NOT_RUN | 组 TERM→3s→组 KILL→15s 确认；**Z 的回收见 §5 风险 1** |
| ISO-10 | leader 意外退出 / EPERM / 未知归属不盲杀不伪 settled；PRE/FD/scope/quota 不释放 | 实现，真实证据 NOT_RUN | `#adoptLeader` 只在 pgid==pid 时采纳；信号只发组；不释放 scope |
| ISO-11 | 真实 handle reconcile 用新鲜证明结算恰好一次；伪 handle/旧 JSON/PID 不能签发成功 | 外来 handle 拒绝：已实证（自审）；新鲜证明：NOT_RUN | `reconcileCleanup` 重读 /proc，组非空即抛 `CacheCleanupRequiredError` |
| ISO-12 | 真实 range 源流在响应中止后曾存活且最终 close | 实现，真实证据 NOT_RUN | `res.on("pipe")` 登记源；中止时 destroy 并等真实 close |
| ISO-13 | 父 frameDuration probe 跨 worker 结束仍被等待并 reap | **部分，真实证据 NOT_RUN**，且有一处需 MAIN 裁定（§5 风险 2） | 账本已登记上游 probe promise；其 execFile 回调是否覆盖 child close/reap 需 P2 真实 child 实证 |
| ISO-14 | 执行域消失后同步封准入；冻结边界新请求不访问源/创建 probe；下一 draw 显式重开 | 实现，真实证据 NOT_RUN | 冻结检查在 `answer()` 最前 |
| ISO-15 | 完整候选→单调 FINALIZE_AFTER_OK→授权终止→真实结算→最终源/witness 门；不得倒填或由 SIGKILL 推成功 | 实现，真实证据 NOT_RUN | 顺序由代码固定；SIGKILL 不产生成功路径 |
| ISO-16 | 两活跃 scope、32/8 排队、30 秒截止；超额/取消在 PRE 前拒绝且不生 child/泄漏 FD | **已实证** | 调度器测试 10/10 |
| ISO-17 | reader 准入及交付同时查对应物理根；generic lease 不自我失效 | 实现，真实证据 NOT_RUN | 见 §2 表 |
| ISO-18 | 当前 worker/policy 原字节下真实 Chrome/zygote/renderer/utility 继承与整组退出；旧 policy 证据不复用 | **NOT_RUN** | 需要 P2 的真实 Chrome pilot |

## 5. 真实剩余风险（必须由 MAIN 知道）

1. **Zombie 回收没有权威路径，需要 MAIN 裁定一个具名方案。**
   正常路径不产生僵尸：worker 自己调用上游的 `closePageFrames()`，Playwright 关浏览器时**等**它退出，worker 作为父进程 reap 它；worker 退出时 Node reap 它。所以正常超时/TERM 路径可以真正回收。
   异常路径（worker 被 KILL，Chrome 变孤儿）里，Chrome 的僵尸在 PID 1 不 reap 的环境下会留在组里，**按 ADR（含 Z 不算消失）就会进入 CLEANUP_REQUIRED**。
   ADR 说“kernel subreaper、Python/native launcher 或额外进程域如果必要，先提出具名路径和精确方案，由 MAIN 审定后才写”。**本波没有写 subreaper，也没有暗用新依赖。**
   具名提案（待 MAIN 审定后才可实施）：在 **worker 进程内**用 `prctl(PR_SET_CHILD_SUBREAPER, 1)`（Node 没有内建绑定，需要一个**具名的**极小 native/launcher 文件），使 worker 成为其后代孙子的 reaper，worker 退出前把它们 reap 掉。精确路径提案：`src/adapters/openfilm/cache-worker-subreaper.mjs` + 一个具名 native helper；**两者都不在本票 allow_new 内，需要 MAIN 明确释放**。不批准的替代路径是：接受 ISO-09 在 TERM-ignore 情形下停在 CLEANUP_REQUIRED，并把该分支如实写进验收（不得用“计数 0”或超时签字掩盖）。

2. **父 frame-duration probe 的 child 归属需要 MAIN 裁定（ADR A02 的“窄 owned probe seam”）。**
   现状：Host 登记的是**上游自己的** `frameDuration` promise（上游在 `host.mjs` 里用 `execFile('ffprobe', …, callback)`）。Node 语义依据：`execFile` 的回调绑定在 child 的 `'close'` 事件上，而 `'close'` 在 `'exit'` 之后、stdio 关闭之后才发出，libuv 在 `'exit'` 时即已 reap 该 child——所以在**正常退出**下回调覆盖 child close/reap。**缺口**：若 child 忽略 SIGTERM 且自行关闭 stdio，`'close'` 会在 child 仍存活时发出，此时 promise 已 resolve 而 ffprobe 还活着；上游的超时正是 SIGTERM。
   ADR 的规定是：“若做不到则**先审定**窄的 owned probe seam，不用 HTTP close 代替”。**本波没有擅自换 seam**，只实现了原 promise 的账本登记（父 drain 会等它）。
   需要 MAIN 裁定的具名方案（未实施）：由 Host 自己拥有 ffprobe 的 child（`spawn` + 自己的 ChildProcess 句柄），在 `__film/frame-duration` 路由上**由 Host 直接作答**（body 形状与上游一致：`{"seconds": number|null}`），从而父方能证明 child 的 exit/close。代价：不再复用上游“每文件版本一个 promise”的缓存（Host 侧仍可自建同样的缓存）。**这是公开响应语义面，需要 MAIN 明确批准后才做。**

3. **上游 `pageframes.mjs` 的模块级状态在每 draw 之间不再共享。**
   ADR 明说“跨 draw 内存页缓存不保留”，所以这是**预期**的语义变化，但它的可观察后果是：连续两帧现在每次都付一次浏览器启动开销（浏览器启动被 ADR 明确接受，“不能承诺性能不变”）。既有 G04 用例（`native-cache-witness.test.ts`）的断言体不变，但它们的**耗时**会变长；本波不能跑它们，超时余量需要在 P2 观察。

4. **offline guard 现在也管 cache 生产者的浏览器。**
   原来 cache 生产者在 Host 内直接 import `pageframes.mjs` → 直接拿到上游原生 `FilmPage.open`（**无**路由限制）。新路径按 ADR 复用正式 render 的 offline guard，于是 `FilmPage.open` 被强制 `offline: true, network.allow: []`。
   已核对上游语义：`host.mjs` 的 offline 路由**始终放行页面自身 origin**（`!url.href.startsWith(origin + '/')` 才拦截），所以本机 serving 的页面仍能加载；外部 origin 被拦并记为 page problem。上游 `problems` 只进错误文案、不单独导致失败。**但这条路径本波没有真实浏览器证据**，P2 必须实证“真实两帧与 poster 仍可生成”。

5. **本波没有跑任何真实 child。** worker/supervisor 的真实路径（握手、候选、回收、Z）**一行都没有在真实进程上执行过**。所有相关陈述都是代码级论证，不是证据。

6. **既有真实回归未跑**：`native-cache-witness.test.ts`（28 个用例，含真实浏览器）、`created-native-source-reader.test.ts`（含 K04-c 的真实固定 draw）本波**都没有运行**，它们是 P2 的对象。

## 6. 下一波（P2）精确建议：命令 / fixture / helper

### 6.1 需要 MAIN 释放的具名路径（**本波未写**）

| 路径 | 责任 | 为什么必需 |
|---|---|---|
| `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs` | 一个**假** worker：按私有协议回 HELLO/GO，可配置为晚启动子进程、忽略 SIGTERM、洪水输出、超大帧 | ISO-04/08/09/10/11/15 的确定性对冲；真实浏览器不能稳定制造这些故障 |
| `tests/agent-driven/integration/helpers/cache-worker-ignores-term.mjs` | 忽略 SIGTERM 的 worker | ISO-09 的 TERM-ignore→KILL |
| `tests/agent-driven/integration/helpers/cache-worker-floods.mjs` | 洪水 stdout/stderr 的 worker | ISO-08 |
| `src/adapters/openfilm/cache-worker-subreaper.mjs`（+ 一个具名 native helper） | worker 内的 subreaper | §5 风险 1 的 Z 回收；**只有在 MAIN 批准 subreaper 时才写** |

### 6.2 P2 精确命令（建议，全部串行、同一 recorder、唯一前缀 `n1n2-claude-060p1-p2-*`）

```
# 1) 真实 Chrome pilot：证明新 worker/policy 字节下 Chrome 组继承与整组退出（含 Z）
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-process-settlement.test.ts

# 2) 既有真实回归（受影响面）
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/native-cache-witness.test.ts
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts

# 3) 受影响的其它门
corepack pnpm exec vitest run --config vitest.config.ts tests/architecture
corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1
```

### 6.3 P2 必须产出的真实证据（每条都要有命令/exit/日志 sha/产物 sha）

1. 真实连续两帧 + poster：**真实** worker、`/proc` 里的真实 pid/startticks/pgid/sid、**组内成员（Chrome/zygote/renderer/utility）的 (pid,startticks,pgid,sid)**、组清空后 `readCacheProcessGroup(pgid)` 为空的时刻。
2. 真实 range 源流：`res` 中止后 `fs.ReadStream` 的 `close` 事件时刻与 FD 数（`/proc/self/fd`）。
3. 真实父 probe：ffprobe child 的 pid 与其 `'exit'`/`'close'` 与 Host 侧 promise resolve 的先后（回答 §5 风险 2）。
4. TERM-ignore→KILL：组内 TERM 无效、KILL 后组清空、或明确记录 Z 仍在（据 §5 风险 1 的裁定）。
5. 洪水：stdout/stderr 超 64KiB 时 worker 被真实停下并回收。
6. 晚启动：draw 之后 worker 再 spawn 的子进程不得越过执行域清理（需要 §6.1 的 fixture worker）。

### 6.4 本波给 MAIN 的三个问题（带证据，不自行选退化路线）

- **Q1（§5 风险 1）**：TERM-ignore 情形下的 Z 回收，是否批准**具名** subreaper 路径（`cache-worker-subreaper.mjs` + 一个 native helper）？若不批准，ISO-09 是否接受在 TERM-ignore 下停在 CLEANUP_REQUIRED？
- **Q2（§5 风险 2）**：父 frame-duration probe 是否批准**窄 owned probe seam**（Host 自己拥有 ffprobe child 并直接作答 `__film/frame-duration`）？这会改变该路由由谁作答，属公开响应语义面。
- **Q3（§5 风险 3/4）**：ADR 已接受“跨 draw 内存页缓存不保留”与“浏览器启动开销增加”，且本波把 offline guard 也装到了 cache 生产者的浏览器上。请确认这两条语义变化与 G04 回归的耗时余量可接受；本波**没有**跑 G04。

## 7. 自审（实施者自审，**不是**外审）

- 已逐条对照 ADR rev2 的 A01..A05 与“原始输入、输出与结算三件事”“精确回收、peer 与并发”“私有协议、预算与可追溯性”，实现位置见 §2；**没有**发现实现与 ADR 相抵触之处。
- 发现的两个**实现期缺陷**（均在本波捕获之前修掉，最终捕获全绿；旧失败不另存，因为它们没有进入任何捕获）：
  1. 调度器把“全局队列满”判在“同根队列满”之前，使同根的窄拒绝不可观测 → 改为先判窄拒绝（`cache-production-scope.ts`）。
  2. supervisor 初版把“ready 超时”“outer 超时”只记进 cleanup 账本而**不结束等待**，且在失败路径上**先 settle 再回收**（违反“失败也要在真实排空后才 FAILED_SETTLED”）→ 改为 deadline 真正结束等待、失败先回收后 settle、`#fail`/`#settleDomain` 统一收口（`cache-process-supervisor.ts`）。
- 静态 fitness：**未放宽任何检测**。`tests/m2.1/openfilm-upstream-lock.test.ts` 未被修改且本波运行通过（60/60），其 loader 导出集合、vendor-path 位置、Host 调用点枚举均未变（新模块不调用 loader 的任何导出）。`unknown/class/arrow/this/computed` 检测与原红反事实原样保留。
- 架构 fitness 4.2（`/src/adapters/` 不得声明 commit/lock/exec/spawn/shell 类方法）用**静态脚本**核对过三个适配器文件：offenders 为空。
- 未自签外审、未签全阶段 PASS、未冻结源码、未动 git index。

## 8. 交还

唯一 writer 权与重型槽在本报告完成后交还 MAIN。本波**不**继续实现：下一步是 MAIN 审查本波实现后发放**真实 P2 运行票**（含 §6.1 的具名路径裁定与 §6.2 的命令）。A057-04 **未**在本波关闭；N1N2 / NativeAck / Studio / A 片 / V1 **不可用**；原 17 条要求的真实整体验收未通过。
