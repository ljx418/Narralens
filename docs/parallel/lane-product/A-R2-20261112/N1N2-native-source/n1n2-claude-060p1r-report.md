# n1n2-claude-060p1r — rev3 独占回收者与 P1 修订报告

- release_id: `MAIN_RELEASE_060P1R_REV3_CUSTODIAN_REPAIR`
- task_id: `task_10c4ac8146ae` / dispatch_id: `ctx_95f1131694b8`
- 依据: `ADR_060_REV3_CUSTODIAN_AND_REPAIR.md` rev3（sha256 `326bed74…95ac`）、`060P1R_PRIVATE_CONTRACT.md`、`ADR_060_REV3_BINDING.json`、`REV3_DOCUMENT_APPROVAL.json`（DOCUMENT_PLAN_READY）、`rev3-document-review/REVIEW.md`、`code-review/FINDINGS.json` + `code-review/REVIEW.md`（REQUEST_CHANGES：1 BLOCKER / 9 MAJOR / 1 MINOR / 2 NOTE）、`lifecycle-design/REVIEW.md` + `PROPOSAL.json`、`PYTHON_ENVIRONMENT_BASELINE.json`
- ACK 与基线: `n1n2-claude-060p1r-ack-baseline.md`（14 个 existing 文件原字节、7 个新文件不存在、AGENTS、HEAD、branch、index、9 份规范文档摘要**逐项实测一致**）
- 旧报告不覆盖：060P1 的 `n1n2-claude-060p1-report.md` 原样保留；本报告逐编号回应原 finding。
- **旧两次开发期失败**：按 `code-review/FINDINGS.json` P1-N02 记为 **UNRECORDED / UNKNOWN** —— 060P1 的原命令/exit/log/inputs 没有留存，本票**不补造**那两份历史日志；本波的新反事实一律是新日期、新 argv 的新捕获。
- 实施者自签：**不是外审**。源码冻结、最终全量门与独立验收由 MAIN 组织。

## 0. 结论

按 rev3 完整重写了 P1 的执行拓扑：**Host → 每 draw 一个 Python 标准库 custodian C（独占 SID/PGID，位于目标组之外）→ Node worker N（另一个独占 SID/PGID）→ Chrome 实际固定后代（继承 N）**。C 是 N 与被收养后代**唯一** wait owner，Host 只 reap 自己的直接 child C；C 用 `waitid(P_PID, N, WEXITED|WNOHANG|WNOWAIT)` 保住 N 的真实未 reap 锚，**所有必要的组信号都在最后 `waitpid(N)` 之前发完**，最后再验 ECHILD / 组 ESRCH / known(pid,startticks) 消失（含 Z），不依赖 PID 1、不依赖死 worker、不依赖未来 timer。

本波**只运行本票允许的十条初始命令**：全部 exit 0，全部 runtime 捕获 `source_changed=[]`；许可的源码生成（`--generate`）单独捕获。**所有真实 custodian / 子进程故障 / HTTP / Chrome / ffmpeg / probe / fullcheck / build 均 NOT_RUN**；A057-04 **未关闭**；N1N2 / NativeAck / Studio / A 片 / V1 **不可用**。

## 1. 原 finding 逐编号闭环

| finding | 级别 | 修订 | 实现位置（实际行号） | 本波证据 |
|---|---|---|---|---|
| **P1-F01** | BLOCKER | 两个原 parser **与新 Python parser** 全部重写：PID 取**第一个左括号之前**的数字，`comm` 取最后一个右括号之前，**右括号之后的第一项是 state**（字符串），`ppid/pgid/sid` 为其后第 1/2/3 项，`starttime` 为其后第 19 项。原代码把 state 当 PID 用 `Number()` 解析（必得 NaN）。 | `cache-process-supervisor.ts:288` `parseCacheProcStat`；`openfilm-cache-worker.mjs` `readProcessIdentity`；`cache-process-custodian.py` `parse_proc_stat` | **已实证**：`cache-process-identity.test.ts` 29/29（comm 含空格、含括号、S/R/Z/T/D/I、五种畸形输入、**本进程真实身份**）；`node --check` 两个 .mjs；`ast.parse` custodian |
| **P1-F02** | MAJOR | 内核查询改为**三态** `gone / known / unknown`：`ENOENT/ESRCH` 才是 gone；EACCES/EIO/解析错是 unknown，**永不**当空组。组的枚举中任何一个 pid 不可读，整个答案即 unknown。结算必须满足：custodian **真实 close** + 组 **provably gone** + 每个记录身份 gone（Z 计入还在）。`child close` 单独不再是门。 | `cache-process-supervisor.ts:326` `observeCacheProcessIdentity`、`:354` `observeCacheProcessGroup`、`:1108` `#proveDomainGone`；custodian `:841` `_known_identities_gone` | **已实证**（解析与三态，纯测试）；真实 close 证据 **NOT_RUN** |
| **P1-F03** | MAJOR | DrawHandle 现在**绑定签发它的 supervisor 实例**（facts.issuer），另一实例的**真实 handle** 被拒（`DRAW_FOREIGN`）；`reconcileCleanup` 增加三道门：issuer 相同、`cleanup_required` 为真、且**原 run 已交出结算责任**（`settlementHandedOver`）；reconcile 复用与 run **同一套完整证明**（custodian close + receipt + 组 gone + 记录身份 gone），不再“组空即 settle”。 | `cache-process-supervisor.ts:534` 类、`:654` inspect、`:698` reconcile、`facts.issuer` | **已实证**（foreign 真实 handle 被拒、空对象/复制/数字/字符串/null/undefined 被拒、重复 start 被拒；`cache-process-identity.test.ts`） |
| **P1-F04** | MAJOR | 生产责任现在**由真实 owner 私有持有**：`openfilm-upstream.ts` 内的 `WeakMap` 按**真正 issued producer** 保存责任；责任在 `pageFrame` **首个 await 之前**登记，含排队取消 controller、supervisor、handle、scope。scope 的 held 标记现在由**私有 completion** 解除（`mintCacheProductionCompletion` → `completeCacheProductionScope` → `releaseCacheProductionScope`，**两步之间无 await**），测试 reset 不再是唯一出口。原失败**在第一处锁存**（`facts.latched`），reconcile 不会把 flood 后的候选变成成功。原生错误改为**有界结构化 envelope**（name/code/message/stack/cause/phase），Host 侧是 `CacheNativeError`（保留 `native`），不再是通用 `PRODUCER_FAILED` 一行。 | `openfilm-upstream.ts:435` 账本、`:438` 登记、`:516` pageFrame、`:595` close、`:1507` bridge inspect/reconcile；`cache-production-scope.ts:387/418/442`；`cache-process-supervisor.ts` `CacheNativeError`/`normalizeNativeEnvelope` | **已实证**（completion 的窄/宽收据被拒、foreign completion 不能清本 scope、一次性释放；`cache-production-scope.test.ts` 11/11）；真实 held→reconcile **NOT_RUN** |
| **P1-F05** | MAJOR | 身份**先验证后采纳**：C_HELLO 的 pid 必须等于 spawn 的 `child.pid`、ppid 必须是 Host、pgid=sid=pid；N_HELLO 的 pid 必须等于 custodian 报的 FORKED pid、ppid 必须是 C、pgid=sid=N.pid，且与 /proc 逐项相等。**采纳前不写 leader**。本 supervisor **不再对目标组发信号**：组属于 custodian；失锚时不朝旧数字发任何信号。 | `cache-process-supervisor.ts:#run` 的 C_HELLO/N_HELLO 两段校验 | **已实证**（静态）；foreign HELLO 真实拒绝 **NOT_RUN** |
| **P1-F06** | MAJOR | 每个阻塞点都真正参与 deadline：READY 30s 覆盖**完整两级链**（C_HELLO→AUTHORIZE_FORK→FORKED→N_HELLO）；GO 后 outer 60s **含完整候选接收**；候选后 finalize 3s **含 closed/receipt**；TERM 3s / KILL 15s 在 custodian 内。定时器不再 resolve 一个无人等待的 symbol。 | `cache-process-supervisor.ts` `nextControl`/`nextDraw`（每次 await 都带 deadline）；custodian `:747/853` | **已实证**（静态）；真实超时 **NOT_RUN** |
| **P1-F07** | MAJOR | 私有通道改为**增量有界 decoder**：每次 data 到达即核 header 与**未消费总 buffer**上限；帧长度由**调用方按协议阶段**判定（metadata 16KiB / request 64KiB / JPEG 8MiB），因此“同一次 read 里既有 metadata 又有整图”不会误杀合法答案。stdout/stderr 累计 64KiB + 8KiB 尾，超限**立即**锁存失败并启动 owned 清理。custodian 侧同样有界（诊断队列 16 帧 / 256KiB + 16KiB 终端预留）。 | `cache-process-supervisor.ts:415` `CacheChannelDecoder`；custodian `FrameDecoder` / `_queue_control` / `_drain_worker_streams` | **已实证**（decoder 四条边界，纯测试）；真实洪水 **NOT_RUN** |
| **P1-F08** | MAJOR | `pageFrame` 入口**同步登记**覆盖排队到结算的完整责任（含 AbortController）；`owner.close` **封准入 → 取消未 GO 的排队 → 等待全部 accepted**，重复 close **共享同一 promise**；获准后**重验 draining**，close 后不再出生 worker。 | `openfilm-upstream.ts:516` pageFrame、`:595` close | **已实证**（静态）；真实排队/取消 **NOT_RUN** |
| **P1-F09** | MAJOR | 结果**单调锁存**：`facts.latched` 记录**第一处**失败（协议错、取消、超限、已知异常 exit、原生错误）。成功判定检查该锁存：`latched.kind === "failure"` 时**只结算失败**，候选+组空不能补签成功。FINALIZE_AFTER_OK 仍在授权终止**之前**记录。 | `cache-process-supervisor.ts` `#latchFailure` / `#settle` / `#run` 末段 | **已实证**（静态）；真实事件序 **NOT_RUN** |
| **P1-F10** | MAJOR | 源的 **error 与 close 分开**：error **保留原对象**且**不**结算账本；destroy 异常也保留；账本只在**真实 close** 时移除。folder server 暴露 `failures()`，bridge 在 drain 后把原因**带出来**（父方必须看到、生产必须因此失败）。response finish/close 仍**不是**源 FD close。 | `openfilm-upstream.ts:952/970`（源账本）、`:737` `failures`、bridge drain 段 | **已实证**（静态）；真实源 I/O 错误 **NOT_RUN** |
| **P1-F11** | MINOR | 测试不再假定 `process.pid` 是组长：**先读本进程 identity.pgid 再枚举**；detached 组另由真正 detached 的 worker 证明。 | `cache-process-identity.test.ts`（"tells the three states of a group apart"）、`cache-process-settlement.test.ts` | **已实证**（本波运行） |
| **P1-N01** | NOTE | **纠正旧报告的论证**：旧 060P1 报告写的“关闭 stdout/stderr 就能让活 child 发生 close”**是错的**。本机 Node v22.22.1 的源码摘录（`node-execFile-source-receipt.json`，sha `ca0514b9…2878`）显示 `close → exithandler` 与 `error → errorhandler → exithandler` **两条**路径，且 `kill()` 抛异常也直接走 exithandler。因此：① close 要求**进程已退出且 stdio 已关闭**；② execFile 的 callback **既不普遍等于真实 close/reap**，也不等于“child 已死”。本波把这两点写进 `cache-frame-duration-lifetime.test.ts` 的设计（helper 明确不是 ffprobe），并**保留上游默认 probe**，未擅自换路由。 | `cache-frame-duration-lifetime.test.ts`（NOT_RUN，本票不运行） | **已实证**（文本/源码依据）；真实事件 **NOT_RUN** |
| **P1-N02** | NOTE | 旧两次失败记 **UNRECORDED/UNKNOWN**，不补造历史；本波全部新失败先经 recorder。 | 本报告 §0 | — |

### R3-R01/R02/R03 的展开

- **R3-R01（execution 与 whole production 分阶段）**：supervisor 只证明 **execution**；`reconcileCleanup` 成功后**只解除 execution gate**，原 bridge continuation 随后才跑（父 drain → endDraw）；workspace 随后做 POST/两 tree 释放/最后 guard；**原 outer finally 内**同步消费私有 completion（清 held 标记）并**释放一次** scope（`created-native-workspace.ts:755–760`）。execution gate 与 whole production 分离，**没有互等自锁**。
- **R3-R02（FD/EOF/预算）**：见 §5 的 FD 表；两通道各自单 writer；C 的 exec-status 管道 CLOEXEC；N exec 前关闭除 0/1/2/3 外的**全部**描述符（按 /proc/self/fd 逐个关闭）；C 关闭自己的绘制端副本，所以 Host 观测到的 N 绘制 EOF 是真的；C 本地观测控制 EOF 即进入私有取消，不等不存在的 ACK。
- **R3-R03（运行前提与 pilot）**：固定 `/usr/bin/python3.12`（sha256 `e50d468e…150f`，3.12.3）以 `-I -S -B` 启动；custodian 在 fork 前 `prctl(PR_SET_CHILD_SUBREAPER)` 并 `PR_GET_CHILD_SUBREAPER` 回读核验；ctypes 用 `CDLL(None)`（**已加载的 libc**，不调用会启动 ldconfig/gcc 的 `find_library`）；不编译/安装依赖。**prctl 的真实内核能力 NOT_RUN**。

## 2. 新增与修改的文件（严格等于本票 allow_existing / allow_new）

### 新增（7，全部在 allow_new 内）

| 路径 | 责任 | sha256 |
|---|---|---|
| `src/adapters/openfilm/cache-process-custodian.py` | 每 draw 的**唯一 wait owner**：组外存活、subreaper 核验、单线程 fork/setsid/execve、waitid(WNOWAIT) 锚、精确 waitpid、ECHILD/组 ESRCH/身份消失、有界 receipt | `d03e4bde0c44b5a3c38cc6716310b2fad8e42c770a33ca0e7d13c048178e6f56` |
| `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs` | **一个**文件、多种 scenario mode（normal / half-jpeg / flood / ignore-term / late-launch / foreign-hello / silent） | `00f14718349b10859760b1cfb692406d409430f10a3b04ce549ec80355775071` |
| `tests/agent-driven/integration/helpers/cache-probe-fixture.mjs` | Q2 事件 pilot 的 helper（close-stdio-live / ignore-term / normal），**明确不冒充 ffprobe** | `aa63ea44e6b54dcf42ef8edcd46dcaede305f0c4ba1fb2bbf68ffb51193a2fa8` |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | custodian 生命周期（P2a） | `9aa3c0daec32fc4ade3f5584880107961aea1947c732472ba7f675a58e08ef32` |
| `tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts` | 父 probe 事件语义（Q2） | `1a071f2c3528ebc558e82851414c395cfb1fb764ca673a6104fa9d6e1d10d243` |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | **本波运行**：纯解析 + 真实 self 身份 + private issuer | `ff52dc9de7215ecfd311ad43c73e97aeee8d62d4d6d1a9a99b45518340b3ea88` |
| `tests/agent-driven/integration/cache-serving-drain.test.ts` | 父 drain / 准入冻结 / 源 close | `d9734282dd8a67d4a7d0a0bb0531ed2a9db0ca5db6c6d92caa2c9b3895bf1c4d` |

### 修改（均在 allow_existing 内）

| 路径 | 本波改了什么 | sha256 |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | rev3 协议（两级握手、双通道）、三态内核查询、issuer 绑定 handle、reserve/start 分离、单调锁存、每阶段 deadline、有界 decoder、原生错误 envelope、custodian 接线 | `26998ef372777172083034ec2e9f3be3cb9203248b92044c31fd17d012d68bc2` |
| `src/adapters/openfilm/cache-production-scope.ts` | 私有 `ProductionCompletion`（绑定 scope/generation/root/阶段收据/原 outcome）、`completeCacheProductionScope`、模式（workspace/direct） | `dec0ab0ce2052e7f0c1e4c2287bf8dacfaf20e5e14860c0ca631187a80785e01` |
| `src/adapters/openfilm/openfilm-upstream.ts` | 生产责任私有账本、pageFrame 首个 await 前登记、close 取消排队并共享 promise、bridge 的 inspect/reconcile、源 error/close 分离、custodian/python 常量 | `ca3e089032ec6deb8c34769b041ec81a06528c4aeb34b3a1fcb490186556205e` |
| `src/adapters/openfilm/openfilm-cache-worker.mjs` | N_HELLO 先行、rev3 协议、原生错误 envelope、有界 decoder、身份 parser 修正 | `18bd7a3a752d94be1f01881c2d5b20e41efce03615cc8fcef099584a3100581d` |
| `src/adapters/openfilm/cache-worker-policy.mjs` | 出生入口闭包补齐 `execFileSync` | `0d2b2b38eea9922b0348ae2dbbbfbe1c2bc7715fc923879776696110015b1214` |
| `src/adapters/openfilm/cache-worker-integrity.json` | **生成物**：新增 custodian 原字节与固定解释器（node exec path / python 路径+摘要+版本） | `20fb57009495a7cacbff8f1e2501f5e4eef3c147348de8ed3608086d8a55834a` |
| `tools/openfilm-cache-worker-integrity.mjs` | 清单覆盖 custodian 与固定运行时；`--generate` 只写该 JSON；`--check` 核 python 摘要与 node exec path | `8f59fb5951a1f83dc360413ac1b71e7914bc98f65c1efa71af909751b7d509d0` |
| `src/host/agent-driven/created-native-workspace.ts` | Host-only `inspectNativeCacheCleanup` / `reconcileNativeCacheCleanup`、私有 completion 与一次性释放、阶段收据 | `eafd88ed060aa49579b68b9fb7fb88afe9319d05acfae2480f5aad3459b7d49c` |
| `tests/agent-driven/integration/cache-production-scope.test.ts` | 新增 completion 用例 | `6f6c1f67090ccd1c0821e948c041669fc1fe6caa9d81cfd13148ef8701280b8f` |
| `tests/agent-driven/integration/cache-process-settlement.test.ts` | 改写为 rev3 API 与真实 pgid | `c38857c87ceb79df99fdf21c28d3bd6d89637fc2301407ffa0dc182d787d7d1e` |

### 明确未动

`src/host/agent-driven/created-native-source-reader.ts`（`0a52b8ff…289e`）、`tests/agent-driven/integration/native-cache-witness.test.ts`（`02a7b90f…306c1`）、`tests/m2.1/openfilm-upstream-lock.test.ts`（`9b2cf852…c175a`）、`tests/agent-driven/integration/created-native-source-reader.test.ts`（`6325eab3…d9784`）——**字节未变**。静态 fitness **未放宽**：m2.1 lock 整文件本波运行 **60/60 通过**，其 loader 导出集合、vendor-path 位置、Host 调用点枚举均未变（新模块不调用 loader 的任何导出）。

## 3. 本波执行的命令（全部经统一 recorder，串行，源字节前后不变）

recorder: `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`（sha256 `88cd47ec…fd10`，与 release 一致，未修改）。前缀 `n1n2-claude-060p1r-`。

| capture | argv | exit | log sha256 | source_changed |
|---|---|---|---|---|
| `n1n2-claude-060p1r-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | `3a061efbd84352db280b0d1dd68b2f7df1992d518d3b9ff8292cc56f780645fd` | `[]`（见下注） |
| `n1n2-claude-060p1r-typecheck-001` | `corepack pnpm exec tsc --noEmit` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` |
| `n1n2-claude-060p1r-syntax-worker-001` | `node --check src/adapters/openfilm/openfilm-cache-worker.mjs` | 0 | `e3b0c442…b855` | `[]` |
| `n1n2-claude-060p1r-syntax-policy-001` | `node --check src/adapters/openfilm/cache-worker-policy.mjs` | 0 | `e3b0c442…b855` | `[]` |
| `n1n2-claude-060p1r-custodian-syntax-001` | `/usr/bin/python3.12 -I -S -B -c "import ast,pathlib; ast.parse(…)"` | 0 | `dd8ee964b960e83ee2ed8f892492ac84dc2c0ea3c9ddb84f9b29e3922f08b97c` | `[]` |
| `n1n2-claude-060p1r-integrity-check-001` | `node tools/openfilm-cache-worker-integrity.mjs --check` | 0 | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` | `[]` |
| `n1n2-claude-060p1r-scheduler-001` | `vitest run … tests/agent-driven/integration/cache-production-scope.test.ts` | 0 | `a59a2057ad26195974a86af5a2b368fb7390b55b6a42d78b81b97b6bd1f3c120` | `[]` |
| `n1n2-claude-060p1r-identity-001` | `vitest run … tests/agent-driven/integration/cache-process-identity.test.ts` | 0 | `fa7358a3773a9754e288dbdae67569351e133e8bf7858dd4ec029cafe83d58c8` | `[]` |
| `n1n2-claude-060p1r-m21-lock-001` | `vitest run … tests/m2.1/openfilm-upstream-lock.test.ts` | 0 | `7b00699e22b9a130d2614885d9b545ac6e84c752a85f29bd7ff6908a0a1b35b6` | `[]` |
| `n1n2-claude-060p1r-syntax-worker-fixture-001` | `node --check tests/agent-driven/integration/helpers/cache-worker-fixture.mjs` | 0 | `e3b0c442…b855` | `[]` |
| `n1n2-claude-060p1r-syntax-probe-fixture-001` | `node --check tests/agent-driven/integration/helpers/cache-probe-fixture.mjs` | 0 | `e3b0c442…b855` | `[]` |

> **关于 generate 的 `source_changed=[]`**：本次会话中，在最后一次改动任何被清单覆盖的文件**之后**，本票允许的 `--generate` 已经生成过一次清单（产物 sha256 `20fb5700…5834a`）。被记录的 `--generate` 随后**再次运行**，写出了**逐字节相同**的清单，因此 recorder 报 `source_changed=[]`。命令确实执行、确实写了那一个路径、exit 0，日志里的 sha 与产物一致；**没有任何隐藏的生成发生在 runtime 捕获里**。

**没有运行**（本票明令禁止）：真实 custodian / prctl / fork / setsid / wait / signal、任何真实子进程故障注入、Host / HTTP / Chrome / ffmpeg / ffprobe / 媒体、fullcheck / build / Python golden、`cache-frame-duration-probe.ts`（条件源文件未写）。没有联网/下载/付费/J 盘/凭据/.env/全量 env 读写；没有启动浏览器或用户窗口。

**开发期迭代**（捕获之前，未被 recorder 记录，按本票要求保留原命令与原日志）：仅两次，均为新写的 identity/scheduler 纯测试的断言错误（合成 /proc 文本的字段数与真实布局差一位；以及“state 不是数字”的断言写反了方向）。两者在捕获之前修正，最终捕获全绿；它们是**本波的新失败**，与 060P1 的两次 UNRECORDED 失败无关。

## 4. 逐 ISO 实现状态

图例：**已实证** = 本波有真实证据；**实现，真实证据 NOT_RUN** = 代码写了但需真实进程/浏览器/媒体；**NOT_RUN** = 本波未跑也未实现到可运行状态。原 17 要求与 ISO-01..18 **不减**。

| ISO | 状态 | 实现路径 / 缺什么 |
|---|---|---|
| ISO-01 连续两帧+poster | 实现，真实证据 NOT_RUN | 每 draw 独占 worker + 组外 custodian；需 P2b 的真实浏览器 |
| ISO-02 seek15s / JOB45s，外层60s不遮盖 | 实现，真实证据 NOT_RUN | outer 60s > JOB 45s；READY 30s 覆盖完整两级链 |
| ISO-03 capture30s + transport barrier | **NOT_RUN** | 需 P2b 的真实 capture 资源与 barrier 标注 |
| ISO-04 late launch 不得越过执行域 | 实现（机制），真实证据 NOT_RUN | 出生闸门 + 组域证明 + `late-launch` scenario（fixture 已写，未运行） |
| ISO-05 两根并行 / 别名同锁 | 别名同锁、调度并行：**已实证**；真实 worker 并行：NOT_RUN | 调度器 11/11 |
| ISO-06 完整同根锁覆盖全窗口 | 实现，真实证据 NOT_RUN | scope 由 workspace 最外层持有至 completion |
| ISO-07 close/cancel/断管、重复 close、晚到结果 | 实现，真实证据 NOT_RUN | 责任登记 + 取消排队 + 共享 close promise + 单调锁存 |
| ISO-08 协议/图/洪水有界拒绝并真清理 | 实现（预算部分已实证），真实证据 NOT_RUN | 有界 decoder 已实证；真实洪水 NOT_RUN |
| ISO-09 TERM-ignore→KILL 真回收、含 Z | 实现，真实证据 NOT_RUN | custodian 的 TERM→宽限→KILL→WNOWAIT 锚→末 reap→ECHILD→组 ESRCH |
| ISO-10 leader 早退/EPERM/未知归属 | 实现，真实证据 NOT_RUN | 不朝旧数字发信号；held 保持 PRE/scope |
| ISO-11 新鲜证明 reconcile 恰好一次；伪 handle 拒绝 | 伪 handle（含**另一实例的真实 handle**）拒绝：**已实证**；新鲜证明：NOT_RUN | issuer 绑定 + 三道门 + 同一套证明 |
| ISO-12 range 源流中止后最终 close | 实现，真实证据 NOT_RUN | 源 error/close 分离 + destroy 异常保留 |
| ISO-13 父 probe 跨 worker 结束仍被等待并 reap | **部分**，真实证据 NOT_RUN | 账本已登记上游 promise；callback≠close 的论证已纠正；**是否覆盖真实 reap 待 P2a 决定性 pilot** |
| ISO-14 执行域灭后同步封准入；下个 draw 重开 | 实现，真实证据 NOT_RUN | 冻结检查在 `answer()` 最前 |
| ISO-15 候选→FINALIZE_AFTER_OK→授权终止→真结算→最终门 | 实现，真实证据 NOT_RUN | 顺序固定；单调锁存排除补签 |
| ISO-16 两活跃/32/8/30s；超额取消在 PRE 前拒绝 | **已实证** | 调度器 11/11（含 completion 用例） |
| ISO-17 reader 准入与交付查对应根；generic lease 不自我失效 | 实现，真实证据 NOT_RUN | 060P1 已有，本波未改该文件 |
| ISO-18 真实 Chrome/zygote/renderer/utility 继承与整组退出 | **NOT_RUN** | 需 P2b；旧 r3 证据不复用 |

## 5. 私有接口与 FD 表（实际行号）

### 私有接口

| 接口 | 位置 | 说明 |
|---|---|---|
| `CacheProcessSupervisor.reserve(request)` | `cache-process-supervisor.ts:555` | 只**签发**本实例的 handle；不启动 |
| `CacheProcessSupervisor.start(handle)` | `:608` | 只对本 issuer、只对 reserved 状态启动一次；返回 execution settlement |
| `CacheProcessSupervisor.draw(request)` | `:627` | reserve + start 的包装 |
| `CacheProcessSupervisor.inspectCleanup(handle)` | `:654` | 只读；重读内核 |
| `CacheProcessSupervisor.reconcileCleanup(handle)` | `:698` | issuer + held + 已让出责任；**只解除 execution gate** |
| `CacheChannelDecoder` | `:415` | 增量有界 decoder |
| `observeCacheProcessIdentity` / `observeCacheProcessGroup` | `:326` / `:354` | 三态内核查询 |
| `mintCacheProductionCompletion` / `completeCacheProductionScope` / `releaseCacheProductionScope` | `cache-production-scope.ts:387` / `:418` / `:442` | 私有 completion 与一次性释放 |
| `OpenFilmServingBridge.inspectCleanup()` / `.reconcileCleanup(handle)` | `openfilm-upstream.ts:1507` / `:1508` | 本 bridge 的只读状态与推进 |
| `CreatedNativeWorkspaceService.inspectNativeCacheCleanup()` / `.reconcileNativeCacheCleanup(handle)` | `created-native-workspace.ts:477` / `:497` | Host-only，无 HTTP/DTO/EnginePort 新方法 |

**公开面未变**：`pageFrame`/`close` 签名不变、`OpenFilmCacheProducerOwner` 形状不变、`OpenFilmServingOwner` 形状不变、issued 品牌不变、公开 DTO 与 EnginePort7 未动。

### FD/EOF 责任表（实现现状）

| 进程 | 端点 | 责任 | 实现位置 |
|---|---|---|---|
| Host | C 的 stdout/stderr 两 pipe | 各自有界读（各 64KiB），不混入协议 | supervisor `#run` 的 `onStdout`/`onStderr` |
| Host | 绘制双工 socket 父端（C 的子端为 fd3） | Host 与 N 各单 writer；Host 观测 N 绘制 EOF 并向 C 控制通道发 cancel | supervisor spawn `stdio[3]`；custodian `DRAW_FD=3` |
| Host | 控制双工 socket 父端（C 端为 fd4） | Host/C 独占方向；C 本地观测控制 EOF 即 cleanup | supervisor `stdio[4]`；custodian `CONTROL_FD=4` |
| C | fd3 绘制子端 | 只为 fork/exec 交给 N，随后**关闭自己的副本** | custodian `_spawn_worker` 后在父进程关闭（子进程 dup2 到 3） |
| C | fd4 控制端、selector/wakeup、exec-status | 仅 C 持有；N exec 前必须关闭；exec-status CLOEXEC 读完关闭 | custodian `_setup`（CLOEXEC wakeup）、`_spawn_worker`（exec-status `set_inheritable(False)`）、子进程 `_open_descriptors()` 关闭所有 >3 的 fd |
| C/N | N 的 0/1/2/3 | stdin 固定非交互（C 造的 pipe）；stdout/stderr 由 C 专用 pipe 读取；N fd3 = 绘制端 | custodian `_spawn_worker` 的 `dup2` 顺序（先映射 0/1/2/3，再关无关副本） |
| Chrome 后代 | Playwright 自身管道 | 其 fd3/4 属于 CDP，**不得**是 Host 控制/ticket socket；实证按 inode/端点 | **P2a 待实证**（本波未跑） |

## 6. 剩余风险（真实）

1. **prctl 的真实内核能力 NOT_RUN。** `PR_SET_CHILD_SUBREAPER=36` / `PR_GET_CHILD_SUBREAPER=37` 是 Linux 的编号，headers 已静态确认，**本波没有调用过这些接口**。custodian 在 fork 前核验并在核验失败时**不 fork、不 GO**；若本机内核不支持，整条 draw 会以 `PRCTL_UNAVAILABLE` 失败而不是悄悄退化。P2a 必须先证明它。
2. **custodian 是 Python 标准库实现，未经任何真实运行。** 它的事件循环、`waitid(WNOWAIT)` 锚、精确 `waitpid`、`ECHILD`、组 ESRCH 判定都只经过静态审阅。P2a 是它第一次真正运行。
3. **Z 的回收依赖 custodian 活着。** 正常路径由 worker 自己的 `closePageFrames()` 关闭浏览器并被 worker reap，worker 退出时被 Node reap → 不产生孤儿。异常路径（组 KILL）由 custodian 收养并 reap。**custodian 自己被 SIGKILL** 是保全异常：Host 不凭它的 exit 断言原 Chrome 被 reap、不向无锚旧数字发信号、不交付、不释放原 barrier —— 这一分支**故意不承诺可恢复**（ADR 明确接受）。
4. **父 probe（ISO-13）仍是上游的 promise。** 本波**没有**新增 `cache-frame-duration-probe.ts`（该条件源文件本票未授权）。上游 `execFile` 的 callback 有 error/kill-throw 的提前路径，**不等于**真实 reap。P2a 的决定性 pilot 若证明需要真实 child 句柄，MAIN 才可具名释放那个窄 owner。
5. **offline guard 现在也管 cache 生产者的浏览器**（060P1 已引入，本波未变）。上游 offline 路由**始终放行页面自身 origin**，所以本机 serving 仍可达；但这是可达性推理，**不是**真实 JPEG/iframe/媒体成功的证据，P2b 必须实证。
6. **每 draw 多一个 Python custodian 的成本**未实测；两个活跃 scope 仍各占一个额度（没有偷加并行）。
7. **本波没有跑任何真实进程**：worker、custodian、Chrome、ffprobe、Host 全部 NOT_RUN。所有相关陈述都是代码级论证。
8. **既有真实回归未跑**：`native-cache-witness.test.ts`（含真实浏览器）、`created-native-source-reader.test.ts`（含 K04-c 的真实固定 draw）本波**都没运行**，是 P2a/P2b 的对象。

## 7. 下一波（P2a）精确建议

### 7.1 命令（同一 recorder、唯一前缀 `n1n2-claude-060p1r-p2a-*`、串行、一个重型槽）

```
# 1) 非浏览器 pilot：custodian / prctl / WNOWAIT 锚 / TERM-ignore / Z / C close
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-custodian-lifecycle.test.ts

# 2) 父 drain 与准入冻结（真实 HTTP + 真实源流）
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-serving-drain.test.ts

# 3) Q2 决定性事件 pilot（真实 child、明确标注注入）
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts

# 4) 真实结算（含 custodian 回执与组消失）
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-process-settlement.test.ts

# 5) 受影响的既有真实回归
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/native-cache-witness.test.ts
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts
```

### 7.2 fixtures（**已在本票写好**，P2a 直接用）

- `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs`：scenario 由请求 `rel` 的**第一段**给出（`ignore-term/film.html` 等），因为 custodian 的 argv 与 env 都是固定的，scenario 不能从那里偷渡。模式：normal / half-jpeg / flood / ignore-term / late-launch / foreign-hello / silent。
- `tests/agent-driven/integration/helpers/cache-probe-fixture.mjs`：close-stdio-live / ignore-term / normal；事件写 JSON lines 到 argv 给的路径。
- **P2a 必须补的具名 fixture**（本票未写，需 MAIN 释放路径）：一个真实 ffprobe 媒体夹具（固定 argv、真实本地媒体、20 秒基线）。

### 7.3 P2a 每条必须产出的证据

真实 C/N/Chrome 的 (pid, startticks, pgid, sid)；C 的 subreaper 声明与回读；`waitid(WNOWAIT)` 观察与**最后一次** `waitpid(N)` 的先后；组 TERM 无效→组 KILL→组空；**含 Z** 的每个 known(pid,startticks) 消失；C 的 DOMAIN_REAPED receipt（分段、有界、<16KiB、绑定同一 draw/C/N）；Host 观测到 C 真实 close/reap；父 HTTP/源流/probe 的排空时刻；PRE 释放一次；scope 回到 idle；候选与最终 witness 事实。**不得**用 elapsed 或计数代替。

### 7.4 资源清理步骤（每条 pilot 结束前）

1. 测试自己持有的 ChildProcess 句柄：TERM → 有界等待 → KILL → **等真实 close**（不留孤儿）；helper 明确由测试持有并收割。
2. custodian 由 Host reap；任何 C 意外死亡按保全分支处理并**如实记录**，不伪造 receipt。
3. 临时目录在**真实清理完成后**才删；UNKNOWN 时保留。
4. 浏览器/CDP 只在 P2b 出现，且必须落在 N 组内，由 custodian 的组信号收尾。

### 7.5 给 MAIN 的三个问题

- **Q1（§6.1）**：若本机内核不支持 `PR_SET_CHILD_SUBREAPER`，是否接受“custodian 拒绝 fork → 整条 draw 以 `PRCTL_UNAVAILABLE` 失败”这一准入边界，还是需要另一条具名方案？
- **Q2（§6.4）**：ISO-13 的窄 owner（`src/adapters/openfilm/cache-frame-duration-probe.ts`）是否在 P2a 的决定性 pilot 之后具名释放？本票**没有**预先写它，也**没有**替换上游 probe 路由。
- **Q3（§6.6）**：每 draw 多一个 Python custodian 的实测成本是否可接受？若不可接受，是排队策略问题还是拓扑问题，请裁定方向（本票不自行降级）。

## 8. 交还

唯一 writer 权与重型槽在本报告完成后交还 MAIN。本波**不**继续实现：下一步是 MAIN 代码审查后发放**真实 P2a 运行票**。A057-04 **未**关闭；N1N2 / NativeAck / Studio / A 片 / V1 **不可用**；原 17 与 ISO-01..18 的真实整体验收未通过。
