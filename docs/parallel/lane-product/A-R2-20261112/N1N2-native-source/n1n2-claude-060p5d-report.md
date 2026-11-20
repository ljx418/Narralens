# n1n2-claude-060p5d — 完整异步生命周期、撤销权限下的终局证明与最终资格，一次合并修复

本波是 **MAIN_R5D_COMPLETE_ASYNC_LIFECYCLE_AND_FINAL_QUALIFICATION**（`MAIN_COMBINED_ADJUDICATION`
的 `verdict = REQUEST_CHANGES_CONSOLIDATED_NO_N_RUNTIME`）的实施波。它承接 R5C 已交还候选
（`msg_0e1f69a0c119`），**不重写已通过模块，不重置历史**。

范围**只有** release 具名的**八个既有路径**（`allow_new` 为空），外加**唯一**一个新文件：本报告
（SPEC 明文授权的 OWN 报告）。

| 路径 | 角色 | sha256（本波终态） |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | 生产：supervisor | `049489317e8f4f37be77556a90698c82027c8d8d4bf0ee51d15c15862b26d553` |
| `src/adapters/openfilm/cache-process-custodian.py` | 生产：custodian | `30583caab4024b3e4131183e19d60635b1711735892640c5dc7d7e0db34c34f2` |
| `src/adapters/openfilm/cache-worker-integrity.json` | 生成物：完整性清单（`generation_writable_only`） | `e916cc632b80794793342aff6b84a02eb6ab1a15a4b637d29d7137bb6180cda1` |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | 纯测试（supervisor / 启动 / reconcile / cancel / 终局观察） | `fcebae33a8eca72365a5a121042d7e107924de43ce7254c4b7abbf55e9a47d5a` |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | 纯单元（custodian 真实 adapter） | `3be0b3c533ea22c0ff9f882e4a2cc4683750101f2808536f8ed6238ca66dba31` |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | 旧的混合生命周期（**本票只 typecheck，不执行**） | `7293aed94e7ecdefa87208b8611672a6ca429e94efda7aa14cd83dad3243bea5` |
| `tools/native-cache-normal-pilot.ts` | 最小正向工具 | `a9e343cc257ddb1dad678be7de8bcb7a5bfdb9c8e99a0cd662b01b54067be3b3` |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | 纯测试（正向工具） | `7dadcb126ba6c370bb1dd4ccd10ea31ad7ab9920641594ae508ba37976b57352` |

起始 sha256（release `start_sha256`）**逐字节吻合后才动手** ✓。
release 具名的**七个保护文件**终态实测**逐项未变** ✓（见 §6）。
HEAD 仍是 `1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**，**无 push** ✓。

## 0. 结论

- R5D 的**十个根因组**（ASYNC-NORMAL / ASYNC-FAULT / CANCEL-IDEMPOTENCE / STARTUP-UNBOUND /
  REVOKED-PROOF / BOUNDED-REFUSALS / RAW-CLEANUP / FINAL-QUALIFICATION / ROOT-OWNERSHIP /
  DIRECT-EVIDENCE）全部落地，每组都配**实际分支**的反例：能走**实际** supervisor + mock child/proc
  边界的走实际 supervisor，其余走**实际**的私有方法与真实内核边缘 mock。
- **先红后修**：新增反例先在**未改生产的旧实现**上跑出**真实红**（§3），再一次合并修复；
  修完后**最终同源**的六类命令**全部 exit 0**（§4）。
- **本波没有**真实 C/N/fork/prctl/wait/signal/CLI/Host/媒体/浏览器/full gates/网络/env；
  **没有**改动未授权文件；**没有**自签外审、**没有**自签全阶段 PASS。
- R6/R7、原 17、ISO-01..18、N1N2/NEXT **继续 OPEN** ✓。

## 1. 十个根因组的实际落点

### 1.1 ASYNC-NORMAL（N01/O01）—— pending 不是错误，正常路径不被自己取消

`tools/native-cache-normal-pilot.ts`：

| 位置 | 内容 |
|---|---|
| `:744` `continueToTerminal()` | **唯一**的终局 continuation。取消与等待**分离**：只有当运行**自己真有失败**要报（`state.originalFailure !== null`）且**尚未**取消过时，才对**同一个** handle 发一次 owned cancel；**仅仅 pending** 的 draw **不取消**，而是**等它的自然结果**。同一个原 promise 被跟随到底，held 时用**同一个 owner** reconcile 到新鲜证明（轮询有界、**责任无期限**） |
| `:804` `observeSettlement()` | 原 settlement 的**结果**被读进状态：picture、**原 error 对象**、以及**原始 cleanup 事实**（不是计数） |
| `:991` `runPositivePilot()` | setup 与 try/finally 保持 R5C 的部分登记；**新增** `state.cancelIssued`，避免重复取消 |

**反例（红）**：`n1n2-claude-060p5d-red-pilot` 的
「does NOT cancel a draw that is still making progress」——旧实现里 finally 第一件事就是
`requestCancel(DRAW_NOT_SETTLED)`，断言 `cancelErrors == []` 与 `kind == "ok"` 双双失败 ✓。
**修复后绿**：`n1n2-claude-060p5d-final-pilot`（43 例通过，含该例）。

### 1.2 ASYNC-FAULT（N01/O02）—— 先等被接受的 N，再等绑定的 GO，最后同步全 epoch 活态

| 位置 | 内容 |
|---|---|
| `:846` `waitForAcceptedWorker()` | **有界**等待 accepted N epoch。等待期间 `worker === null` 是**启动态**而不是失败观察；**真实早失败**（settlement 带着 error 落地）被**如实**当作本次结果返回，**不**冒充预期故障；**观察期限只决定是否注入**，绝不当资源结束 |
| `:881` `runTheDeliberateFailure()` | 顺序固定：accepted N → 本 root 本 draw ticket_digest 本 N 的 GO → **最后一次同步** fresh `pid/startticks/ppid/pgid/sid` 且非 Z/死 → **中间无 await** → 注入并取消**同一个** handle |

**反例（红）**：`red-pilot` 的「waits for the accepted worker before it injects the deliberate failure」
与「does NOT inject when the draw REALLY failed before the worker was accepted」——旧实现里
`acceptedWorker()` **同步**取一次就判空拒绝 ✓。

### 1.3 CANCEL-IDEMPOTENCE（N02/O03）—— 首次 primary 事实不可变

`src/adapters/openfilm/cache-process-supervisor.ts`：

| 位置 | 内容 |
|---|---|
| `:1860` | **第一次** cancel 写 provenance：若无更早失败，它接受为 primary 并**保原 Error 对象**；若已有更早 native/transport 失败，primary 仍是那个旧错误 |
| `:1874` | **后续** cancel 只写**有界** secondary 事实（`count` + 最后一条 message），**不改写**首次 provenance，**不覆盖**原 cause |
| `#requestCustodianCancel` 的 `cancelSent` 闸门 | CANCEL 消息**只写一次** ✓（重复取消是观察，不是第二条消息） |

**反例（红）**：`n1n2-claude-060p5d-red-identity` 的三条
（same Error 再来一次 / 不同 Error 后到 / CANCEL 不写两次）✓。

### 1.4 STARTUP-UNBOUND（N03/NOTE-01）—— 未绑 epoch 时也能由**真实的 gone** 收敛

| 位置 | 内容 |
|---|---|
| `:2937`–`:2951` | epoch 为 null 时**不再直接拒绝**：**Host 实际拿到的那个 child PID** 现在会被真的查询——**fresh gone** ⇒ 原 child 真的结束，可收敛；**fresh unknown** ⇒ 继续 held；**fresh known** ⇒ 那是**另一个进程**，**不许猜**为原 child（`CUSTODIAN_EPOCH_UNBOUND`） |
| `:2958`–`:2972` | epoch 已绑时：**同 epoch 的 Z 不算 gone**（MAIN 澄清的合同：僵尸必须被真实 wait/reap 后才消失），只有 **fresh gone** 或**真正不同的 epoch** 才证明原 generation 结束 |
| `:2851` `#recordTerminalObservation()` | 终局证明的**实际观察**被就地记录：presence、号码、epoch、状态、时刻 |

### 1.5 REVOKED-PROOF（N04）—— 撤销的是**信号权限**，不是**终局取证**

`src/adapters/openfilm/cache-process-custodian.py`：

| 位置 | 内容 |
|---|---|
| `:863`–`:920` `TargetSettlement.run()` | **不再**因 `authority_lost` 提前返回。census、reap、ECHILD、group、已知原 epoch 的 fresh 检查**继续**进行；欠着的硬信号在权限丢失时**仍是欠着**（不消费、不送达替代进程），并在 `reasons` 里留事实 |
| `:735`/`:1018`/`:1199` `anchor_state()` | anchor 的**真实状态**：`running`/`held`/`reaped`/`none`；`_held()` 不再硬编码 `anchor_held=True` |

### 1.6 BOUNDED-REFUSALS（N05）—— 长期 EPERM 不撑爆库存

| 位置 | 内容 |
|---|---|
| `:125` `MAX_RETAINED_SIGNAL_FACTS = 32` | 保留事实的**固定上限** |
| `:1215` `_record_signal()` | 保留**首**事实与**近**事实，其余**计数**；饱和时**锁存失败**（收据不再是完整证明），但**kill/wait 继续**；**首错误**永不被替换 |
| 收据 | 新增 `signals_truncated` 与 `signal_facts_total`：**截断是明说的**，不冒充完整成功证明 |

### 1.7 RAW-CLEANUP（O04/NOTE-02）—— raw cleanup 与最终诊断都参与资格

`tools/native-cache-normal-pilot.ts`：状态里保留 `cleanupFacts`（**有界可序列化**的原始 cleanup），
判定要求 `cleanupFacts.length === 0` **且** `snapshot.cleanup_failures === 0`；
fault 另需「同一精确原 cancel 确被 primary 接受」「null picture」「完整终局」。

### 1.8 FINAL-QUALIFICATION（O05）—— 报告结算之后才落最终资格（非循环产物协议）

产物顺序（`tools/native-cache-normal-pilot.ts:1254`→`:1321`）：

1. **`candidate.json`** —— 候选事实，**显式** `authoritative: false`；含原 settlement、原 error、
   raw cleanup、实际/参考图片分离、终局观察、receipt summary/segment digest 事实，
   并**明说** `raw_segments_saved: false`（原始段没有保存）；
2. **报告** —— 候选报告走**同一个**受审 boundary（`{"kind":"CANDIDATE", "authoritative":false, …}`），
   然后 `await boundary.settled()`；
3. **`manifest.json`** —— 真实存在产物的清单与 digest，**显式排除** `manifest.json` 与 `final.json`
   （自引用与循环被明说），listing/hash 失败被**记为失败**而不是空清单；
4. **`final.json`** —— **准入权威**：`authoritative: true`，写明 `candidate_sha256` 与 `manifest_sha256`，
   并含 `reporting_failure`、`evidence_errors`、`manifest_error`。

**没有 self-hash 循环**：final → manifest → candidate → 无引用；manifest 不引用自己与 final；
**final 记录的 hash 由外层 recorder / MAIN 另核** ✓。
「必须报告完成之后才提交资格」✓：final 写在报告结算之后；迟到 EPIPE 会让 final 记
`fault_case_passed=false` 且 `reporting_failure` 有值，**即使 exit 仍是 1** ✓。

### 1.9 ROOT-OWNERSHIP（O06）—— root 没分配就**不写**任何证据

`createRoot` 抛错时 `entry.root` 保持 **null**：finally **不调用** `writeEvidence`，
**不**把工作目录当 root，**不**造 phantom supervisor/handle，registry 里**没有**条目；
只走**受控有界**的 refusal 报告 ✓。

### 1.10 DIRECT-EVIDENCE（O07）—— 直接证据来自**生产证明路径**

`CacheDiagnosticSnapshot` 新增（Host-私有、有界、只读；**无** raw ticket / FD / 可变能力 / 绝对路径，
**无** EnginePort 方法、**无** 公共 DTO）：
`terminal_proof`（`{at, proven, truncated, observations[]}`，每条含 `kind`/`presence`/`pid`/
`start_ticks`/`state`/`reason`/`at`）、`cleanup_facts[]`（有界序列化）、`cancel_secondary`。
观察由 `#proveDomainGone` **就地**记录（custodian epoch、worker epoch、group、known-target），
工具**不**事后硬造 ✓。

## 2. 实际 supervisor 编排（新增，回应 MAIN 的两条预交还缺口）

`tests/agent-driven/integration/native-cache-normal-pilot.test.ts` 里新增了
**实际** `CacheProcessSupervisor` + **mock child/proc 边界**的编排，`FakeCustodian` 按**真实协议顺序**
说话：C_HELLO(seq 1) → [Host 的 AUTHORIZE_FORK] → FORKED(seq 2) → **N_HELLO（异步，在 GO 之前）**
→ [Host 的 GO] → result + picture（silent 场景**不**回图）→ [Host 的 FINALIZE / CANCEL] → 收据（段 + 摘要）
→ custodian 与 worker **一起**真的消失。

- 「waits for the REAL asynchronous start of the normal mode, and cancels NOTHING」：
  hello 在 runner **已经开始等**之后才发出；断言 **cancel 次数为 0**、结果是 **精确 1024×0x4a**、终局证明成立 ✓；
- 「waits for the LATE worker of the fault mode before it injects」：worker 晚到，注入只发生在
  同 epoch 活态之后，且是 fault-observed ✓；
- 真实 destination：`RealDestination extends Writable`（真实 callback / 真实 error 事件），
  「revokes the final qualification when the destination fails LATE」用 **actual main + actual factory**，
  final 记录 `fault_case_passed=false` 且 `reporting_failure` 有值 ✓；
  「does NOT lose the owner when the destination breaks while the settlement is PENDING」证明
  **原 settlement 仍 pending 时** destination 报错，**同一个 owner** 仍在等、**没有被取消**、
  **没有换 draw**，交付发生在 terminal 之后 ✓。

## 3. 先红后修：**真实红**捕获（原处保留，未修饰）

| 捕获 | exit | 事实 |
|---|---|---|
| `n1n2-claude-060p5d-red-identity` | **1** | **6 例红**：cancel 幂等 ×3、未绑 epoch 的 gone 收敛、同 epoch Z 不放行、终局观察缺失 |
| `n1n2-claude-060p5d-red-pilot` | **1** | **12 例红**：正常 pending 被取消、fault 早拒绝、真实早失败被冒充、raw cleanup 不参与资格、final 诊断 cleanup 失败不 disqualify、root 未分配仍写证据、最终资格协议缺失 ×3 |
| `n1n2-claude-060p5d-red-tsc` | **2** | 红灯轮的类型错误（`artifactFacts` 尚不存在）——**预期** |
| `n1n2-claude-060p5d-red-python` | **1** | 2 例红，但**其中一条是 fixture 未触达 TERM→真实 waitpid 消费 N 的失败**（MAIN 指出），**不算**语义反例 |
| `n1n2-claude-060p5d-red-python-002` | **1** | fixture 修正后仍红；**该轮到达过一次 raw `os.kill` 边缘**（本机 **pid 200 不存在**，`ProcessLookupError`，**没有**任何进程被真的信号到）——见 §7 的诚实声明 |
| `n1n2-claude-060p5d-red-python-003` | **1** | **语义红**：held 记录硬编码 `anchor_held=True`，而该路径**真的 reap 过**（`True is not false`）✓ |
| `n1n2-claude-060p5d-red-python-004` | **1** | **两条语义红**：①`anchor_held` 硬编码；②保留的信号事实**随轮次增长**（40 > 32）✓ |

修过程中的捕获同样原处保留：`fix-tsc-001/003/004`（exit 2）、`fix-pilot-001/003/004/006`（exit 1）、
`fix-identity-001`（exit 1）、`fix-python-001`（exit 0）。

**两个非业务失败的捕获，诚实标注**：

- `n1n2-claude-060p5d-fix-pilot-004`（exit 1）：**MAIN 对本波自己拥有的**挂起测试链做了精确
  stop（证据在 R 目录的 `MAIN_PILOT004_*`），recorder 随后写出真实的 exit/result；
  它**不是**自然超时，**不是**业务失败，**不**作为任何旧语义的红证据 ✓。
- `n1n2-claude-060p5d-fix-pilot-005`：**INCOMPLETE**——外壳的 `timeout 300` 终止了 recorder，
  **没有** `.exit` / `.result`，**未补造** ✓。

**R5B 的 `n1n2-claude-060p5b-python-001`（无 exit）原样保留，未补写** ✓。

## 4. 最终同源捕获（六类命令，全部 `n1n2-claude-060p5d-*`）

| 形式 | 捕获 | exit | 结果 |
|---|---|---|---|
| `corepack pnpm exec tsc --noEmit` | `n1n2-claude-060p5d-final-tsc` | **0** | 全仓类型检查通过 |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | `n1n2-claude-060p5d-final-identity` | **0** | **84** 例通过 |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | `n1n2-claude-060p5d-final-pilot` | **0** | **43** 例通过 |
| `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `n1n2-claude-060p5d-final-python` | **0** | **54** 例通过（0.043s） |
| `node tools/openfilm-cache-worker-integrity.mjs --generate` | `n1n2-claude-060p5d-final-generate` | **0** | 只写完整性清单；**`source_changed == []`**（幂等） |
| `node tools/openfilm-cache-worker-integrity.mjs --check` | `n1n2-claude-060p5d-final-check` | **0** | `{"ok":true,"checked":8}` |

最终一轮六条的 `result.json` 里 **`source_changed` 与 `source_added` 都是 `[]`**——**运行时源冻结** ✓。
唯一改了字节的那一次生成是 `n1n2-claude-060p5d-final-generate-001`（`source_changed` 只含
`src/adapters/openfilm/cache-worker-integrity.json`）✓。

## 5. 本波**没有**运行（NOT_RUN）

真实 CLI 主入口、真实 custodian C、真实 N、真实 fork、真实 prctl、真实 wait、**真实 signal**、
真实内核、真实 `/proc`（除 mock 边界）、正常 N pilot、故意断言失败 pilot、Host、HTTP、Chrome、Q2、
媒体、**`cache-custodian-lifecycle.test.ts` 整个文件**（本票只 typecheck 其接线）、
fullcheck、build、generation 以外的任何写入、网络/下载/付费、J 盘、用户 env 凭据、用户窗口：
**全部 NOT_RUN** ✓。

## 6. 保护七、index、资源

| 文件 | sha256（终态） | 与 release 一致 |
|---|---|---|
| `tools/native-cache-nofork-pilot.mjs` | `73fed24c66ec310ccd811fdd7e4dfb51be6d22875ce81a50e1a86a47072fe00d` | ✓ |
| `tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs` | `feb9786b4f38044382ab6ac2ca8435f3bdf89ae83c0882b47177573136deb5ce` | ✓ |
| `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs` | `e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab` | ✓ |
| `src/host/agent-driven/retained-native-closure.ts` | `fd896104149d6cd2663b63a59d50beabbeee546f3e3f46a5d6bf07fbe662ede9` | ✓ |
| `src/host/agent-driven/created-native-workspace.ts` | `d83edbdac8cd6dd7db6b5d18f1d0f5d3beb028279297a822f59f97f6504d562c` | ✓ |
| `src/adapters/openfilm/openfilm-upstream.ts` | `17fe1138e50bc30df5c26b74e1e0ff9393140c070e1233676d2811485890a2b6` | ✓ |
| `AGENTS.md` | `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` | ✓ |

- **git index 空** ✓；HEAD 未动 ✓；**无** add/commit/reset/stash/checkout/push/merge ✓。
- **没有**真实 C/N 被启动：本波的所有「进程」都是 mock 的 child/proc 边界；
  **没有**真实信号发出（唯一的 raw `os.kill` 边缘在 §7 里如实声明）✓。
- **没有需要交还的 owner**：本波结束后进程表里没有本 lane 的解释器、custodian、recorder 或 pilot ✓。

## 7. 诚实声明与限制

1. **一次 raw 边缘的越界（如实记录）**：`n1n2-claude-060p5d-red-python-002` 那一轮，fixture
   还没有 mock `os.kill`，测试**到达过一次真实的 `os.kill(200, SIGTERM)` 系统调用**。本机 **pid 200
   不存在**，调用返回 `ProcessLookupError`，**没有任何进程被真的信号到**；随后 fixture 立即补上了
   `os.kill` 的 mock。该轮**不**作为任何语义红证据，语义红取自 `-003`/`-004` 两轮 ✓。
2. **R5C 的旧断言被改写的两处**，理由是合同变了，不是为了让绿：
   - pilot 测试里「证据在 root 里」原来断言 `summary.json`/`outcome.json`；本波的**产物协议**换成
     `candidate.json`/`manifest.json`/`final.json`，断言随之改为**新协议的三个名字**，
     并新增「candidate 必须显式 not authoritative」「final 才是权威」两条 ✓；
   - identity 测试里 cancel 幂等那一条：它原先假设「cancel 是首失败」，而该用例的 draw **真的先失败**
     （custodian 从未说 HELLO ⇒ `CUSTODIAN_NOT_READY` 先锁存），因此正确结论是
     **cancel 不是 primary**；断言改成「首次 provenance 不被后续取消改写 + secondary 计数」，
     **不是**放宽 ✓。
3. **final 记录的完整性依赖外层**：本工具**不**自哈希，`final.json` 的 digest 由 recorder / MAIN 另核 ✓。
4. **stderr 的一行是候选报告**（`{"kind":"CANDIDATE","authoritative":false,…}`）：它写在报告结算**之前**，
   所以它**不可能**包含它自己的结局；**准入权威是 `final.json`**，退出码与它一致 ✓。
5. **stdout 的 stderr 语义变了**：R5C 的 stderr 末行是结果 JSON，本波改为**候选**报告；下游若读 stderr 的
   `kind`，必须改读 `final.json` 或退出码 ✓（这是**有意的合同变更**，SPEC G 要求）。
6. **终局观察的 `state` 与 `start_ticks`** 来自**当次**证明路径的读数；`gone` 的观察没有 fresh epoch，
   记的是**原 epoch** ✓。
7. **真实 N 往返仍是未跑的下一道门**：本波只证明**合同判定逻辑**与**编排顺序**，不证明内核行为 ✓。

## 8. 其余发现：继续 OPEN

本波**只**动 R5D 的十个根因组。`MAIN_COMBINED_ADJUDICATION` 点名的 **R6/R7** 两条**继续 OPEN**；
`R5A C01/C03` 维持 **CLOSED_STATIC**（**未回退**）；原 17 / ISO-01..18 / N1N2 / NEXT / 全量门
**全部不变** ✓。本波**不**自签独立外审、**不**自签全阶段 PASS、**不**签内核。

## 9. 下一步：**准确的两条真实 N 调用**（**本票不执行**）

MAIN 按本波修改与关联不变量做**独立复核**，两道安全门（定点 startup 复核 + 定点 owner 复核）过之后，
若获发**精确许可**，实际首跑是**两条**，一条一条来，**单重型槽**（cwd = 仓库根）：

```sh
# ① 正常：真的画出来，而且域真的没了
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts \
  --mode normal \
  --expected-custodian-sha256 30583caab4024b3e4131183e19d60635b1711735892640c5dc7d7e0db34c34f2 \
  --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

```sh
# ② 故意断言失败：先真的观测到同 epoch 的 HELLO+GO 与存活，再注入 EXPECTED_ASSERTION_FAILURE
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts \
  --mode assertion-failure \
  --expected-custodian-sha256 30583caab4024b3e4131183e19d60635b1711735892640c5dc7d7e0db34c34f2 \
  --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

**现行 exit 语义**：

| mode | exit 0 | exit 1 | exit 2 |
|---|---|---|---|
| `normal` | `kind==="ok"`：无失败、**完整终局**、picture **恰好**是那 1024 个 `0x4a`、**raw cleanup 与最终诊断都干净**、**证据全部写成功**、**最终记录真的写了**、**报告没有失败** | 其它一切（含**没有 root**） | 参数不合法 |
| `assertion-failure` | **不可能** | `kind==="fault-observed"` **仅当**「注入的**精确**是 `EXPECTED_ASSERTION_FAILURE`」+「**结算的错误就是那同一个对象（或其明确 cause）**」+「**cancel 被接受为 primary**」+「**null picture**」+「**完整终局**」+「**raw cleanup 与最终诊断都干净**」+「**最终记录真的写了**」+「**报告没有失败**」同时成立；否则是失败 | 参数不合法 |

- **不把任意 exit 1 叫「通过」**：② 的 exit 1 是**预期**，但**只有** `final.json` 里同时出现
  `fault_case_passed=true`、`terminal_proof=true`、`picture_is_the_exact_one=false`、
  `cleanup_facts=[]`、`evidence_errors=[]`、`reporting_failure=null`、
  `cancel_provenance.accepted_as_primary=true` 时，它才是**预期且被证明**的 ✓。
- 真实运行需要 MAIN 另发的**精确许可**（真实 C/N、真实信号、内核）。**本票不请求、也不执行。**

## 10. 交还

writer 权与资源在本报告完成后交还 MAIN。本波**不**运行真实 N pilot，**不**改任何未授权文件，
**不**关闭除 R5D 十个根因组外的任何 finding，**不**自签外审、**不**自签全阶段 PASS。
MAIN 按本波修改与关联不变量做**独立复核**，两道安全门过之后另发实际首跑票（两条 CLI）。
生产 N 正向与 R6/R7 及其余发现**需另修另验**。
