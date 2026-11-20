# n1n2-claude-060p5b — 失败启动的真实终局、最小 N 工具持责与两个内部面

本波是 **MAIN_R5B_FAILED_START_AND_POSITIVE_OWNER** 的实施波。范围**只有** release 具名的
**六个既有路径**与**两个新增路径**：

| 路径 | 角色 | sha256（本波终态） |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | 生产：supervisor | `9429ec959cc45715fc2837117bef9cc5b218e1260793cc92d21d97025679481f` |
| `src/adapters/openfilm/cache-process-custodian.py` | 生产：custodian | `01a3636b890ae4b4c929cd4653ab3af0ec8b96c0d2af1242f298bf209967ae12` |
| `src/adapters/openfilm/cache-worker-integrity.json` | 生成物：完整性清单 | `b59ebb17805c83929a183f8918040474146284e27bb50ba84f4848141931170e` |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | 纯测试 | `6c50dca3681c48a8769daae3adae923a461124adcafc4251a450be48b591a7b2` |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | 纯单元 | `436eb6a854117ccf5540e03a2d0759501a0f982cdac0a87f61ac92cab0ca8789` |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | 旧的混合生命周期（**本票不运行**） | `2ee89a2cdb157aefcf4b5cb6bbe21df404ec72f69250e367dca85fbd78b0250c` |
| `tools/native-cache-normal-pilot.ts` | **新增**：最小正向工具 | `30b01a0eafe295e6d048c88c0c0adcce96ac4b342edcdcf72167dd3ed5282539` |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | **新增**：纯测试 | `d7ab14329aae848b5a3c3aeae253bf989a5accad10c603c5199b55975145ff40` |

起始 sha256（release `start_sha256`）：`b561eda7…f07a` / `6b8d6df3…1618` / `9dac431b…4c65` /
`4d3e18f7…3585` / `85b738d0…9347` / `5491f60e…35d0` —— **六条逐字节吻合后才动手**。

**没有** Git 操作（无 add/commit/reset/stash/checkout/push），HEAD 仍是
`1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**；release 具名的**七个保护文件**
（nofork 工具与其测试、helper fixture、retained-native-closure、created-native-workspace、
openfilm-upstream、`AGENTS.md`）**逐项实测未变**；R4/R4A/R4B 的捕获与报告**原处未动**。

## 0. 结论

- **R3-C04 与 R3-C05 两条都修了**（`R3-C02`/`R3-I05` 的**正向 owner 部分**随之收紧），
  并各配**实际类 / 实际方法**的纯 mock 反例；**另加**两个 Host-私有内部面与一个**独立最小正向工具**。
- **六个许可命令形式全部先经 recorder**，各跑多次，**全部 exit 0**；**所有失败与一次挂死都原处保留**。
  第一个**实际变更**捕获是 `n1n2-claude-060p5b-generate-001`（只写了 integrity JSON）。
- **其余 12 条生产 finding、原 17、ISO-01..18、N1N2/NEXT 全部继续 OPEN**；本波**不**签外审、
  **不**签内核、**不**签全量通过。

## 1. R3-C04 —— 资源已结束不要求创作 exec 成功

### 1.1 生产行号

| 位置 | 内容 |
|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts:550` | `MAX_RECEIPT_WAIT_FACTS = 256`：**有界**的 wait 事实 |
| `:580` / `:695` | `CacheReceiptAccumulatorState.wait_facts`：**真实 wait 的 pid 与结局**（R5A 的非破坏快照保留 ✓） |
| `:652` / `:711` | `take()` 记录 wait 事实；`#recordWaitFact()` 记录**哪一个进程**被真的等过、**怎么结束** |
| `:958` / `:966` | 域证明：**exec 失败**时，要求**那个失败 worker 自己的终局 wait**；别的进程的 wait 不算 |
| `:1042` | **成功资格**独立要求 `exec.ok === true`：失败 exec **永不可**创作成功 |
| `:2602` | **从未出生**的 child：没有 exit、没有 epoch，**close 就是证明**（错误本身不是 close） |
| `:2620`–`:2623` | custodian 的**原 epoch** 真的 gone（换代也算原 epoch gone） |
| `:1928` / `:1954` | 同步 spawn 抛错与**异步**无 PID 错误都保留**原 errno**，代码为 `CUSTODIAN_NOT_BORN` |
| `:1942` | spawn 之后立刻读 **custodian epoch**（原进程的证明） |
| `:2246` | `facts.execOk`：exec 的真实结果 |
| `:1585` | reconcile：`worker===null` **不再**永拒——**fork 权威**（`forkedPid`）才是判据 |

### 1.2 旧实现为何会红（静态推理，本票**不回退旧源、不执行变异**）

旧实现里 `validateCacheDomainReceipt` 一律要求 `exec.ok === true`，所以「N exec 失败」这一类
**真实的基础设施失败**永远无法证明域结束 → cleanup 被**永久 hold**；而 `reconcile` 又用
`facts.worker === null` 一刀切 → 「C 已授权但 N 从未说 HELLO」这一类**永远无法和解**。
异步 spawn 无 PID 时 Node **不发 exit**，旧证明却要求 `custodianExit !== null` → 同一类失败被
**永久 hold**。这三处都是「真实失败被当成资源未结束」。

### 1.3 实际分支 mock

`tests/agent-driven/integration/cache-process-identity.test.ts`（**实际** supervisor + **实际** validator）：

| 用例 | 行 | 断言 |
|---|---|---|
| 「ends as the ORIGINAL failure of the start, and it is NOT held」 | `:826` | **实际** `start()`：spawn 无 PID → 异步 `EAGAIN` + **只有 close、没有 exit** → 结算为 `CUSTODIAN_NOT_BORN`（消息含 **EAGAIN**）、**未 hold**、**没有 custodian/worker epoch** |
| 「may PROVE that the domain ended, and is NEVER a success」 | `:856` | 收据 `exec.ok=false` + **那个 worker 自己的终局 wait** → **域证明成立**；**成功资格不成立** |
| 「is NOT a proof when the wait of the failed worker is missing」 | `:856` 块内 | 只有**别的**进程的 wait → **域证明不成立**（计数不是证明） |
| 「never delivers a receipt whose exec did not work」 | `:647`（**旧用例改判**） | 旧用例断言「域证明拒绝」；新真相是「域**可以**成立、成功**永不**成立」——用例**保留**，断言按新真相改写 |
| 「is refused for the DOMAIN, and not for a missing worker」 | `:976` | **实际** reconcile：真实 fork 过、N 从未说 HELLO 的 held draw → 拒绝理由是**域**（`still there|domain`），**不是** `DRAW_NO_IDENTITY` |

`/proc` 的读取是**唯一**被 mock 的内核边界（`node:fs` 的 `readFileSync` 对**一个**路径返回合成的
`stat` 文本 ✓），其余 `/proc` 读取仍是真实的 ✓。

## 2. R3-C05 —— 初始读不到 N identity 也必须持责并能升级

### 2.1 生产行号

| 位置 | 内容 |
|---|---|
| `src/adapters/openfilm/cache-process-custodian.py:621` | **新的** `TerminationActions`：TERM/KILL/截止**各自一次**，**永不重置** |
| `:1547` | census **总是**把 worker 当作目标：它的存在是**fork 的事实**，不是「读得到身份」的事实 |
| `:695` / `:933` | `worker_group_id()`：只有**核实过**的独立组才可作为信号目标 |
| `:787` | 每次发信号**重新问**组权威：后来核实过的组可以被瞄准，**从未核实过的组永远不被瞄准** |
| `:842`–`:867` | 动作状态机：TERM 只发一次；**欠着的 KILL 必须在同一 lifetime 里升级**；已发的 KILL 不重复 |

### 2.2 旧实现为何会红（静态推理）

旧实现里 `_target_census` **只在 `worker_identity` 已经有值时**才读 worker，而 `direct_children()`
又**跳过** `worker_pid` → 一个活着的 N 在账本里**根本不是目标**；随后 `_reap_worker` 超时，
**一次 KILL 都没发**。恢复时旧代码用 `resignal=False` 表示「别再发信号」，于是
`escalated = not resignal` 恒为真 → **恢复期永远不升级**，TERM-ignore 的域**永远结束不了**。

### 2.3 实际分支 mock

`tests/agent-driven/integration/helpers/cache-custodian-unit.py`（**实际** `KernelSettlementOperations`，
内核边界 mock）：

| 用例 | 行 | 断言 |
|---|---|---|
| 「an unreadable worker is unknown and never an empty domain」 | `:1369` | 身份**读不到** → census **unknown**、**不 settled**、理由是「worker 的身份读不到」 |
| 「the hard signal is owed and is sent when the identity returns」 | `:1380` | TERM 走**精确子进程 PID**（组当时**未**核实）；身份后来可读 → **欠着的 KILL 只发一次**，且发往**后来核实过的组**；worker 最后被 reap |
| 「a second pass never repeats a signal」 | `:1412` | 第二遍**没有**新增任何信号 |

**旧用例一条没删**：43 → 46 例 ✓（43 旧 + 3 新）。

## 3. 两个 Host-私有内部面（**没有**新的公共 API）

`src/adapters/openfilm/cache-process-supervisor.ts:1641` `requestCancel(issuedHandle, originalError)`：

- **严格**只认本 supervisor 签发的 handle（`:1641` 之后的 `#factsOf`）——**外来 handle 在任何副作用之前被拒** ✓；
- **同步**锁存**最早**的原 Error（`:1655` 附近）：重复调用**幂等**、**不覆盖** primary、**不自己等**整个结算（防自锁）✓；
- **reserve 之后、start 之前**取消 → `start()` **拒绝 spawn**（`:1475`）并完成**真正无 birth**的失败 ✓；
- **已 fork** 的 draw **只由存活的 C 清 N**：本方法**不发信号、不杀组、不杀 C** ✓；
- **已终局**的 draw **不会**被重新变成失败 ✓。

`src/adapters/openfilm/cache-process-supervisor.ts:1679` `diagnosticSnapshot(issuedHandle)`：
**有界、只读**的 JSON 副本（C/N 完整 epoch、fork/exec、custodian 的真实 exit+close、已知 target、
收据摘要、累加器计数摘要、原 outcome、fresh cleanup 观察、transport failure）。
**不返回** raw ticket / token / socket / 进程句柄 / 任何可变内部权威 ✓；返回的一切都是**冻结的副本** ✓。
它**不是** public DTO / MCP / HTTP / EnginePort 方法 ✓；**七个既有方法不变** ✓（只**增加**这两个）。

## 4. 一个独立最小正向工具（新增两个文件）

`tools/native-cache-normal-pilot.ts`：

- **CLI 只收** `--mode normal|assertion-failure` + `--expected-custodian-sha256` + `--expected-fixture-sha256`
  （`:283` 附近）；**不接受**任何可执行文件 / argv / PID / 信号 ✓；**入口 guard** 在文件末尾 ✓（import 不 autorun ✓）。
- **固定** W、当前 custodian、固定 Python、**固定已受审 helper**：先**核对 sha256**，再把 helper **复制**进
  自有 `var/native-cache-positive-pilot/run-*/` ✓，场景文件写在**副本旁** ✓（不改 helper ✓）。
- **root 创建立即登记** ✓；**registry 项**是 `{root, supervisor, reservedHandle, startPromise, originalFailure, state}`
  ——**每个对象创建即同步纳入**（`:594`/`:604`）✓，不是 root/boolean ✓。
- **normal 必须真成功**：picture **恰好** 1024 个 `0x4a` 且 sha256 精确（`:427` `isTheExactPicture`）✓
  ——**不是** `length>0` ✓；这是**合成协议**，不是 JPEG/视频解码 ✓。
- **故意失败**：**实际观测**同一 N epoch 已 HELLO+GO 且**真实存活**之后，才注入
  `EXPECTED_ASSERTION_FAILURE`，并对**同一个 issued handle** 调 `requestCancel`（`:619`/`:626`）✓。
- **永不杀 C、永不杀组**：只调 `requestCancel` ✓；**没有**复用 nofork 工具的 C-kill 能力 ✓。
- **UNKNOWN**：保留原 supervisor/handle/原 promise/root 与实际 C，按 owner **inspect/reconcile 有界轮询**
  直到真实 proof（`pollForTerminalProof`）✓，**不超时丢 owner、不顶层 throw** ✓；迟到结果只结束原失败，
  **不自动采纳 picture** ✓。
- **报告边界**（`:282` `createReportingBoundary`）是 R4B 已审边界的**等价小 typed 实现**：目的地的
  `error` 事件 + 写完成 callback **两路**、**同一失败只记一次**、坏掉后**不重试**、owner 不丢 ✓；
  **没有**全局 Host patch ✓。（**为什么不是直接 import 那个 .mjs**：本仓库的 tsconfig **没有** `allowJs`，
  静态 import 一个无声明的 `.mjs` 会得到 TS7016，而 `ts-ignore` 是本票**明令禁止**的 —— 所以这里
  写的是**等价的小 typed 边界**，这正是 SPEC 允许的第二种做法。）
- **证据**：root 内 `summary.json` / `outcome.json`（含原失败、只读诊断、终局证明、失败清单）✓；
  **真终局后保留证据**，**不按计时删根** ✓；**主工具自己的 reporting failure 不得藏在绿候选后**
  ——**判定在证据写完之后**才做（`:735` 附近的 `judge()` 与其后的复判）✓。

`tests/agent-driven/integration/native-cache-normal-pilot.test.ts`（**新增**，14 例）：
参数只有 mode+两个 digest ✓；import 不 autorun ✓；normal 真成功且 picture 精确 ✓；
picture 不是那一个就**不是**成功 ✓；字节不是受审的就**什么都不启动** ✓；
只在 worker **真活着**之后注入 ✓；worker 没被观测就**不**注入 ✓；
**证据写失败**永远不是绿 case ✓；**HELD** 的 draw 保留 owner 并以 fresh proof 结束 ✓；
**工具只「问」、不杀** ✓；退出码 0 / 1 / 2 ✓；picture 的 sha256 是常量且被复算 ✓。

## 5. 两个旧的不安全入口：最小接到受审 runner

`tests/agent-driven/integration/cache-custodian-lifecycle.test.ts`（**本票不运行**这个混合文件 ✓）：

- **第一阶段（身份）**：不再**自己** spawn custodian 再用 `endChild` 的 TERM→KILL 阶梯（那是 R3-C02 指出的
  不安全入口 ✓）——改为**跑当前 R4B 已审的 nofork runner**（`tools/native-cache-nofork-pilot.mjs` 的
  `--mode identity` ✓），由**runner** 拥有那个进程与它的根；用例断言 **exit 0** 且**宿主组没有变大**（没有 fork）✓。
- **第二阶段（最小正向往返）**：不再**直接**用 supervisor 而没有 owner——改为**跑新的独立 runner**
  `runPositivePilot` ✓，它拥有 root/supervisor/handle/promise；用例断言 **kind=ok / exit 0**、
  **picture 恰好是那一个**（不是 `length>0` ✓）、**终局证明成立** ✓、helper 的 events 里真的有
  `scenario` 与 `answered` ✓、宿主组没有变大 ✓。
- 原来的 `ownChild` / `endChild` / `createPilotRoot` / `readControlFrame` / `delay` **全部删除** ✓
  ——不再有「自己拥有原始 child」的代码路径 ✓。

## 6. 六个纯门、全部记录

recorder：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`
（sha256 `88cd47ec…fd10`，**未修改**）。前缀 `n1n2-claude-060p5b-`。cwd=W。
**运行时源码冻结**；**没有** recorder 外预跑；**没有**跑其它命令形式。

### 6.1 最终三门（**全部 exit 0**）

| capture | argv | exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-060p5b-tsc-004` | `corepack pnpm exec tsc --noEmit` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `n1n2-claude-060p5b-vitest-identity-004` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | 0 | `e734d93694eeec2f04af268c781f0476123c69abf6a67d7d2d64940fd0a8d1c2` |
| `n1n2-claude-060p5b-python-005` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | 0 | `fe200d97f80f37c657d3d9e35d41080494f36b8a5e940254f18a58b825d10817` |
| `n1n2-claude-060p5b-vitest-pilot-005` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | 0 | `612492483c989f3f0f2ab0b23be73a244da38ea2daa5a3156132e457e6debe2f` |
| `n1n2-claude-060p5b-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | `4c4f54d40c6627249ebe7517e2c3d4580c66295029a1efe25dff514caaff104e` |
| `n1n2-claude-060p5b-check-001` | `node tools/openfilm-cache-worker-integrity.mjs --check` | 0 | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` |

计数：**identity 68/68**（61 旧 + 7 新）、**python 46/46**（43 旧 + 3 新）、**pilot 14/14**（全新）。
`generate-001` 的 `source_changed` **只有** `src/adapters/openfilm/cache-worker-integrity.json` ✓
（**首个实际变更捕获** ✓）；其余捕获的 `source_changed` 都是 `[]` ✓。

### 6.2 所有失败与一次挂死（**全部原处保留**）

| capture | exit | 内容 |
|---|---|---|
| `n1n2-claude-060p5b-python-001` | **无 exit**（挂死，被停止） | **一次真实的挂死**：持久化的动作 deadline 让恢复循环**不再推进时钟** → 空转。**它确实被停掉了**：harness 的后台任务 `ba0m4qsfk` 被 `TaskStop` 停止（"Successfully stopped task ba0m4qsfk" ✓）；证据写在 **`docs/execution/A/implementation-20261111/integration/e1-main-takeover/n1n2-claude-060p5b-python-001.stop-evidence.json`** ✓（捕获目录里有 claim/cmd/inputs 与 **32 字节**的截断日志，**没有** `.exit`/`.result.json` ✓；停止后的进程检查**没有任何**本 lane 的解释器/custodian/recorder/pilot 存活 ✓）。**代码已修**（每遍都 `sleep`） |
| `n1n2-claude-060p5b-tsc-002` | **2** | 类型错误：只读字段被赋值、`start_ticks` 的类型、`PositivePilotFailure.code`。**代码已修** |
| `n1n2-claude-060p5b-python-003` | **1** | 新用例「KILL 发往后来核实过的组」失败：组权威在**构造时**被冻结。**代码已修**（每次发信号重新问） |
| `n1n2-claude-060p5b-vitest-identity-001` | **1** | 5 例失败：TDZ 的 `supervisor` 局部名、`/foreign` 正则、**失败 exec 的域证明**、reconcile 用例**超时**。**代码已修** |
| `n1n2-claude-060p5b-vitest-identity-002` | **1** | 1 例失败：收据的 `identities_digest` 没跟上累加器。**代码已修** |
| `n1n2-claude-060p5b-vitest-pilot-001` | **1** | **OOM**：假时钟不前进 → 有界等待不结束。**代码已修**（假时钟随 sleep 前进） |
| `n1n2-claude-060p5b-vitest-pilot-002` | **1** | 2 例失败：证据写失败仍被判为绿、故意失败时 draw 自己结算了。**代码已修**（判定移到证据之后；用例改为由 cancel 结算） |
| `n1n2-claude-060p5b-vitest-pilot-003` | **1** | 1 例失败：同上（证据写失败仍是绿）。**代码已修** |

### 6.3 本波**没有**运行

真实 CLI 主入口、真实 custodian C、真实 N、fork、prctl、真实 signal、真实 wait、内核、
真实 `/proc`、正常 N pilot、Host、HTTP、媒体、浏览器、Q2、**那个旧的混合生命周期文件**、
fullcheck、build、generation 以外的任何写入、网络/下载/付费、J 盘、用户 env 凭据、
用户窗口：**全部 NOT_RUN** ✓。

**本波没有留下任何活着的运行物**：本 lane 的解释器、custodian、recorder 与 pilot
**一个都不在进程表里** ✓（2026-11-15T03:03:30Z 的 `ps` 检查；机器上仅有的 python3 是
无关的 `unattended-upgrades` 与另一个 agent 的无关 shell ✓）。
**没有需要交还的 owner** ✓ —— 纯门从不 fork 任何真实进程 ✓，那次挂死也已被停掉并留了证据 ✓。

## 7. NOT_RUN 与风险

| 项 | 状态 |
|---|---|
| 真实 N 正向往返（正常 N + 故意断言失败） | **NOT_RUN**（本票不授权） |
| 真实 C / fork / prctl / signal / wait / 内核 / 真实 `/proc` | **NOT_RUN** |
| 真实控制通道背压与续写 | **NOT_RUN** |
| `tools/native-cache-normal-pilot.ts` 的 CLI | **NOT_RUN**（计划用 `corepack pnpm exec tsx tools/native-cache-normal-pilot.ts`，本票**不**运行） |
| `cache-custodian-lifecycle.test.ts` 整个文件 | **NOT_RUN**（它仍有真实内核动作） |
| 原 17 / ISO-01..18 / 其余 12 条生产 finding / N1N2 / NEXT | **NOT_RUN / 继续 OPEN** |

**风险（真实）**：

1. **两条修复解释的是「为什么正常路径走不完」，不是内核语义**。真实 N 往返仍是**未跑**的下一道门。
2. **域证明现在接受 `exec.ok=false`**（在**那个 worker 自己的终局 wait** 被证明之后）。这是**有意的**：
   失败 exec 的清理**真的结束**了；但**成功资格**另外要求 `exec.ok === true` ✓，两道门是分开的 ✓。
3. **custodian 的 epoch gone** 用的是「fresh 读到的不是同一 epoch」✓；若真实运行中该 pid 仍以**僵尸**存在
   （Node 在 `exit` 前已 reap ✓，但**未在真机上验证**），证明会失败 → draw 被 hold ✓（**保守**方向 ✓）。
4. **KILL 可能在一次恢复之后才发**：动作状态是**一次 lifetime** 的 ✓；已发的信号**不重复** ✓，
   欠着的**一定升级** ✓；动作截止**只是** UNKNOWN/恢复，**不是**弃责 ✓。
5. **新的工具的判定在证据写完之后**：若 `outcome.json` 自己写失败，返回的 `kind` 仍是判定时的值，
   而 `evidence_errors` 里有那次失败 → `main` 的退出码按 `evidence_errors` 判定 ✓
   （**磁盘上不完整的那份不是已提交的收据** ✓）。
6. **旧生命周期文件本票没有运行**：它的两个入口**已接到受审 runner** ✓，但**真实行为仍未跑** ✓。
7. **本波改了 custodian 与 supervisor 的字节**：nofork 的真实验收（`MAIN_COMBINED_VERDICT.json`）绑定的是
   **旧字节**（`6b8d6df3…` / `b561eda7…`），**不**替代新源的全验收；**未来真实 N 门需要新的完整基线 hash** ✓。

## 8. 其余 12 条生产 finding：继续 OPEN

`OPEN_PRODUCTION_FINDINGS.json` 的 14 条里，本波**只**动了 **R3-C04** 与 **R3-C05**（以及
**R3-C02 / R3-I05 的正向 owner 部分**）。**本波没有碰的 12 条**是：
R3-C01、R3-C02、R3-C03、R3-C06、R3-C07、R3-C08、R3-C09、R3-I01、R3-I02、R3-I03、R3-I04、R3-I05 ——
**其中 R3-C01 与 R3-C03 已由 R5A 独立复审记为 CLOSED_STATIC，其余 10 条继续 OPEN** ✓，
并按 `REMAINING_EXECUTION_PLAN.md` 的顺序推进 **R5B 余项（启动失败 + 正向 owner）→ R6 → R7 → R8** ✓。
**原 17 / ISO-01..18 / N1N2 / NEXT / A057-04 / 全量门**全部不变 ✓。

## 9. 下一步：**准确的两条真实 N 调用**（**本票不执行**）

MAIN 定点独立复核**这两个生产文件的精确字节**与**两个新文件**之后，若过门，实际首跑是**两条**，
一条一条来，**单重型槽**（cwd = 仓库根）：

```sh
# ① 正常：真的画出来，而且域真的没了
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts \
  --mode normal \
  --expected-custodian-sha256 01a3636b890ae4b4c929cd4653ab3af0ec8b96c0d2af1242f298bf209967ae12 \
  --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

```sh
# ② 故意断言失败：先真的观测到 N 的 HELLO+GO 与存活，再注入 EXPECTED_ASSERTION_FAILURE
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts \
  --mode assertion-failure \
  --expected-custodian-sha256 01a3636b890ae4b4c929cd4653ab3af0ec8b96c0d2af1242f298bf209967ae12 \
  --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

**现行 exit 语义**：

| mode | exit 0 | exit 1 | exit 2 |
|---|---|---|---|
| `normal` | `kind==="ok"`：无失败、**完整终局**、picture **恰好**是那 1024 个 `0x4a`、**证据全部写成功**、**报告没有失败** | 其它一切 | 参数不合法 |
| `assertion-failure` | **不可能** | `kind==="fault-observed"` **仅当**「注入的**精确**是 `EXPECTED_ASSERTION_FAILURE`」+「**原 cancel 错误**在」+「**完整终局**」+「**没有**其它失败」+「**证据全部写成功**」+「**报告没有失败**」同时成立；否则是失败 | 参数不合法 |

- **不把任意 exit 1 叫「通过」**：② 的 exit 1 是**预期**，但**只有**回执里同时出现
  `fault_case_passed=true`、`terminal_proof=true`、`picture_is_the_exact_one`（② 无 picture）、
  `evidence_errors=[]`、`reporting_failure=null` 且**原失败**的 code 是 `EXPECTED_ASSERTION_FAILURE` 时，
  它才是**预期且被证明**的 ✓。
- 真实运行需要 MAIN 另发的**精确许可**（真实 C/N、真实信号、内核）。**本票不请求、也不执行。**

## 10. 交还

writer 权与资源在本报告完成后交还 MAIN。本波**不**运行真实 N pilot，**不**改任何未授权文件，
**不**关闭除 R3-C04/R3-C05（及正向 owner 部分）外的任何 finding，**不**自签外审。MAIN 定点复核
**这两个生产文件的精确字节**与**两个新文件**之后，另发实际首跑票（两条 CLI）。
生产 N 正向与其余 12 条生产发现**需另修另验**。
