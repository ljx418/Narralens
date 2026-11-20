# n1n2-claude-060p5c — 不可逆的原 fork 信号权限、晚到终局的真实和解、单一终局 continuation

本波是 **MAIN_R5C_IMMUTABLE_AUTHORITY_AND_TERMINAL_OWNER**（`MAIN_COMBINED_ADJUDICATION` 的
`verdict = REQUEST_CHANGES_BEFORE_N_RUNTIME`）的实施波。范围**只有** release 具名的
**八个既有路径**（`allow_new` 为空，**只有**本报告是新增文件，且是 SPEC 明文授权的 OWN 报告）：

| 路径 | 角色 | sha256（本波终态） |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | 生产：supervisor | `1d069b382324a183dcb7fb0bee19fe464eb39fd4216613b80114fdcbda36caaa` |
| `src/adapters/openfilm/cache-process-custodian.py` | 生产：custodian | `36387d5287ee6977ee1625e9a6ebbe61f2f8992fa4502c19310d11548d9503d7` |
| `src/adapters/openfilm/cache-worker-integrity.json` | 生成物：完整性清单（`generation_writable_only`） | `4708eeafb085cfbf56a8b162b8cebe2149766241f79d97613c373e3279aa7447` |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | 纯测试（supervisor / 启动 / reconcile / cancel） | `6f500be7697fd3f8142c4854e80988e88906af14a9ce300e87d033716421aa18` |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | 纯单元（custodian 真实 adapter） | `a8dd736d1a4d407c08c9b67933689799af02afb74029ad83a99dfe09c0072ad3` |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | 旧的混合生命周期（**本票只 typecheck，不运行**） | `0f91d1676ad4580ef33415c8f53a8542c1832e006e10947c8a79a71894c9da2d` |
| `tools/native-cache-normal-pilot.ts` | 最小正向工具 | `2dad75da85ef30c37a600c98a5dc5b644f6e6ccf57907ff0cb89dcb6ee264af8` |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | 纯测试（正向工具） | `253ff712e99614e6bf556c5752a7f8fdd213eba604486b1f501defeee205baef` |

起始 sha256（release `start_sha256`）**逐字节吻合后才动手** ✓。
release 具名的**七个保护文件**（nofork 工具与其测试、helper fixture、retained-native-closure、
created-native-workspace、openfilm-upstream、`AGENTS.md`）**终态实测逐项未变** ✓。

**没有** Git 操作（无 add/commit/reset/stash/checkout/push），HEAD 仍是
`1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**；用户的 dirty 工作区**原样保留** ✓。

## 0. 结论

- **R5B 的 S01..S06 与 O01..O06 十二条全部按 SPEC 落地**（映射见 §2），每条都配**实际分支**的
  mock（不是 validator、不是纯 helper、不是仍然拒绝的 reconcile）✓。
- **六个许可命令形式全部先经 recorder**，各跑多次，**最终一轮六条全 exit 0**；**所有红与一次 INCOMPLETE
  原处保留**（§4.3）✓。
- **没有**真实 C/N/fork/prctl/wait/signal/CLI/Host/媒体/浏览器/full gates/网络/env；**没有**任何真实
  内核动作；**没有**改动未授权文件。
- **本波不签外审、不签全阶段 PASS、不签内核**。R6/R7、原 17、ISO-01..18、N1N2/NEXT **继续 OPEN** ✓。

## 1. 本波改动的生产语义（逐条）

### 1.1 S01 —— 信号权限是**不可逆的原 fork authority**，不是可刷新号码

`src/adapters/openfilm/cache-process-custodian.py`：

| 位置 | 内容 |
|---|---|
| `:1107`–`:1114` | **原 epoch**（`original_worker_epoch`）、**当前观测**（`current_worker_observation`，另存）、**信号权限**（`unbound`/`bound`/`revoked`）与撤销原因 |
| `:1635` `_bind_original_epoch()` | epoch **只绑一次**：后来的观测**永不**替换它 |
| `:1653` `_revoke_signal_authority()` | 撤销是**不可逆**的 |
| `:1600` `_wait_authority()` | 等待权限四态：`running`/`exited`/`unknown`/`reaped`；**ECHILD 即 reaped** ⇒ 永久撤销 |
| `:1678` `_authorise_signal()` | **每次信号前**核：原 epoch 已绑时 fresh 必须**同一 start_ticks**（`unknown` 不猜、别号 ⇒ 撤销）；组必须是**原 N 自己的** PGID/SID、fresh 组里必须仍是**同一 epoch**、且与 C/Host 分离；**初始 epoch 未绑**时只允许**精确未 reap 的直属子进程号**做 bootstrap，**组一律不碰** |
| `:1667` `_refusal()` | 拒绝是**有界事实**：`refused:<原因>` / `refused-forbidden:<原因>`，**永远不是投递** |
| `:978`/`:984` `KernelSettlementOperations.signal_group/signal_pid` | **raw `os.kill`/`os.killpg` 之前的实际闸门**：不允许就**根本不进内核** |
| `:1771` `_signal_group_id()` | 只有**当下**可瞄的组才返回号；**缓存的旧组不是 fallback** |
| `:793` `TargetSettlement._signal()` | `_signal` **只**用 `worker_group_id()`（fresh），**删掉**「fresh 为 0 就退回缓存旧组」的分支 |
| `:833` `TargetSettlement.run()` | **只有真正发出的 TERM/KILL 才消费动作债**；拒绝/未知/EPERM 记录事实并 **held**（等 fresh）；已发**不重复**；deadline **不重置**；欠着的 KILL **不因被拒而消失**；权限永久丢失时 `authority_lost` 置位，**不再尝试** |
| `:1791` `_target_census()` | census **不重绑** epoch；**外来 epoch 不纳入原 target**；组里没有原 worker ⇒ 该组**不是本 draw 的组**（不枚举、不算活目标） |
| `:2022` `_settle_domain()` | **原 epoch 决定组**；fresh 与原 epoch 不符 ⇒ 撤销权限 |
| `:1908` `_target_group()` | 只认**原 epoch** 的组，从不被后来的观测刷新 |
| `:1542` `_finish_exec()` | 首次读到身份时**绑定原 epoch** |
| `:2514`–`:2527` | 收据新增 `signal_authority` / `signal_authority_reason` / `original_worker_epoch` / `current_worker_observation`（**当前观测与原 fork 分开** ✓） |

### 1.2 S02/S05/O05 —— 晚到的 noAuthorize/noBirth 仍可由**原 handle** 恢复

`src/adapters/openfilm/cache-process-supervisor.ts`：

| 位置 | 内容 |
|---|---|
| `:1695` `#reconcileLedger()` | **按事实台账**（不是按「有没有 hello」）选择证明：`forked` / `no-birth` / `no-authorize` / `unknown` |
| `:1645` `reconcileCleanup()` | 旧的一刀切 `DRAW_NO_IDENTITY` **删掉**；`unknown`（**已授权 fork 但从无 worker 证明**）**继续 held**，绝不因「无 HELLO」推「无 N」 |
| `:2760`–`:2778` `#proveDomainGone()` | **原 epoch 必须真的 gone**：fresh `unknown` ⇒ **hold**（`CUSTODIAN_EPOCH_UNKNOWN`）；fresh 已知且 epoch 不同 ⇒ 算原 C 已结束；**绑不到 epoch ⇒ hold**（不再静默跳过） |
| `:2346` | `custodianHelloEpoch`：**经内核核对过的 C_HELLO epoch** 是「起始观测不可读」时的**保守**原身份来源 |
| `:1422` | `limits` 的类型改为**数值型**（`Object.freeze` 的字面量类型让这个选项本来**不可用**）；**只放宽类型**，不改默认、不改运行时行为 |

### 1.3 S03/O01 —— **一个** canonical terminal continuation，放在真正的 finally

`tools/native-cache-normal-pilot.ts`：

| 位置 | 内容 |
|---|---|
| `:660` `continueToTerminal()` | **唯一的终局 continuation**：`try` 的正常路径、setup 失败、异常**都**走它。它：**同 handle** 请求 owned cancel（幂等）、**无条件**跟随**同一个原 startPromise**、读**原 promise 的结果**（picture/原 error/cleanup）、held 时用**同一个 owner** 一直 inspect/reconcile 到**新鲜证明**（**有界轮询、责任无期限**）、**没有 handle** 时明确「未启动」且**无幻影子进程** |
| `:837`–`:950` `runPositivePilot()` | entry **在创建任何资源之前**以**部分形态**建立（root/supervisor/handle/startPromise **皆可空**）；`mkdtemp` 是**唯一**分配动作，**立刻**登记 root，**之后**才 prepare；pin → copy → **对副本再哈希** → construct → reserve → start **逐个同步挂进 entry**；**全部**在**同一个 try/finally** 内；catch **只保存第一失败** |
| `:278` `readHelperEvents()` | 只消费**完整行**（未终止的行是「还在写」）；**完整但无效**的行 ⇒ **失败**（进同一 finally） |
| `:210`/`:249` | `createRoot`（唯一分配）与 `prepareRoot`（准备）**分开** |

### 1.4 S04/O04 —— **真的复用**受审的 R4B 报告边界

| 位置 | 内容 |
|---|---|
| `:400` | `NOFORK_PILOT_SPECIFIER = "./native-cache-nofork-pilot.mjs"`（**固定本地**相对说明符） |
| `:409` `createReviewedReportingBoundary()` | **动态 import 那一个本地文件的实际 export** `createReportingBoundary`；**类型显式**（`ReviewedReportingBoundary` / `ReviewedReportingOptions`）；**无 ts-ignore、无任意路径**；导出缺失 ⇒ 拒绝运行 |
| — | 工具里**同名仿制 factory 已删除** ✓；**nofork 的 signal/cleanup 权限未复用**，只复用报告工厂 ✓ |
| `:1107` `main()` | 边界在**任何资源创建之前**装好；**同一个实例**传给 `runPositivePilot`；**所有报告走 `report`**，`deps.writeStderr` **只**作为工厂的 write 路线，**没有旁路**；**pending 报告被 await**；**报告失败 ⇒ 该案非绿**（exit 1） |

### 1.5 S06/O02/O03 —— 精确 cancel 原因与同 epoch live 注入

| 位置 | 内容 |
|---|---|
| supervisor `:1730`–`:1765` `requestCancel()` | 取消可作**首失败**时**保原 Error 对象本身**（`facts.error = originalError`）；**更早的** native/transport 失败**不覆盖**；**有界 cancel provenance**（`accepted_as_primary` / `superseded_by_earlier_failure`）；issued/foreign/idempotent/预启动 no-spawn 语义**保留** ✓ |
| supervisor `:206` `CacheCancelProvenance` / `:1829`–`:1830`、`:1852` | 诊断快照新增 **`draw_id` + `ticket_digest`（摘要，不是 raw ticket）** 与 **cancel provenance**；**只读、有界、无可变能力** ✓ |
| tool `:533` `isTheSameEpoch()` | fresh 观测必须**同 pid、同 start_ticks、同 ppid、同 pgid、同 sid**，且**不是 Z/死** |
| tool `:597` `waitForAuthorisation()` | GO 事件必须**来自本 run 的 root 副本**、**pid == 已接受 worker**、**ticket_digest == 本 draw 摘要** |
| tool `:794` | **注入前最后一次同步 fresh 内核核验**；其**与同步 cancel 之间无 await** ✓ |
| tool `:1000` 附近判定 | 期望失败只认**同一个错误对象（或其明确 cause）**；**picture 必须为 null 且不是那一张**；**无其它 native/transport/cleanup/evidence/report 失败**；**cancel 必须是 primary**；**完整终局** |

### 1.6 O06 —— 去掉 legacy 的降级旁证

`tests/agent-driven/integration/cache-custodian-lifecycle.test.ts`（**本票只 typecheck，不运行**）：

- C 的 pin 从 **`digestOfFile(当前文件)`**（自签）改成**显式常量** `REVIEWED_CUSTODIAN_SHA256`，
  并在注释里说明**本波 custodian 字节确实变了**（本波新值 `36387d52…03d7`）；**工具 CLI 的 MAIN 另票 pin
  不受此影响** ✓。
- **5 秒 timer 不再当结束**：只等**真实 close**（`error` ⇒ 拒绝，`close` ⇒ 完成）✓。
- **不再用 Host 组数当「没有 fork」的旁证**：改用**受审 runner 自己的 receipt**
  （`outcome.json` 的 `kind`/`identity_proved`/`terminal_proof.complete`/`unexpected_failure`/
  `evidence_errors`）✓。
- 两个入口**仍委托安全 runner**，**不自行 spawn/kill** custodian ✓；**不用 runmixedfile** ✓。

## 2. 逐 finding 的实际分支 mock（不是 validator、不是仍拒绝的 reconcile）

### 2.1 S01（custodian 真实 adapter，`tests/agent-driven/integration/helpers/cache-custodian-unit.py`）

| 用例 | 行 | 断言 |
|---|---|---|
| 「the epoch of the fork is bound once and never replaced」 | `:1514` | 第二次 `_bind_original_epoch` 返回 **False**；原 epoch 的 start_ticks 仍是 **100**；当前观测**不**改写它 |
| 「the reap of the worker revokes the authority for ever」 | `:1532` | `anchor_reaped` ⇒ `_authorise_signal` **不允许**且 **permanent**；权限状态变 `revoked` |
| 「the loss of the wait authority revokes the signal for ever」 | `:1545` | `waitid` 抛 **ECHILD** ⇒ `_wait_authority` 判 **reaped**、**永久撤销**、`anchor_reaped` 置位 |
| 「a reused number after the reap is never signalled」 | `:1556` | reap 之后**同一号码**被**外来进程**占用（start_ticks 不同）⇒ **raw dispatch 零调用**（`self.signals == []`）、结果是 `not ok` + `unknown`、收据里是 **`refused-forbidden` 而不是投递** |
| 「a group that could not be asked is not the cached group」 | `:1577` | 组**枚举不出来**时**没有** `group` 信号；**只有精确 pid** 被瞄 |
| 「the owed hard signal goes to the original group only once」 | `:1592` | 欠着的 **SIGKILL 只发一次**且发到**原组**；第二遍**零信号**（动作是一次 lifetime 的状态） |
| 「the hard signal is owed and is sent when the identity returns」（**R5B 原有，未删**） | `:1387` | 初始读不到身份 ⇒ 先瞄**精确未 reap 子进程**；身份恢复后**欠着的硬信号**发到**原组一次** |
| 「a second pass never repeats a signal」（**R5B 原有，未删**） | `:1419` | 第二遍**零**新信号 |

### 2.2 S02/S05/O05（**实际** supervisor，`cache-process-identity.test.ts`）

| 用例 | 行 | 断言 |
|---|---|---|
| 「reconciles a draw that was NEVER BORN when its close arrives late」 | `:1069` | 真实 `start()` + 真实 `reconcileCleanup()`：**首窗口没 close ⇒ held**；**晚到的 close 之后** reconcile **成功**，原 promise 结算为**原失败** `CUSTODIAN_NOT_BORN`，**无 picture** |
| 「reconciles a draw whose custodian was NEVER ALLOWED to fork」 | `:1095` | C 出生但**从未授权**、晚到 close、**原 epoch fresh gone** ⇒ 和解成功，结算为**原失败** `CUSTODIAN_NOT_READY` |
| 「keeps a draw HELD when the fresh epoch of the custodian is UNKNOWN」 | `:1120` | fresh epoch **EIO（unknown）** ⇒ reconcile **拒绝**、**仍 held**、**未结算**（unknown 不放行） |
| 「keeps a draw HELD when it was ALLOWED to fork and no worker was proved」 | `:1141` | **已发 AUTHORIZE_FORK** 但**无 fork/receipt 证明** ⇒ reconcile **拒绝**（`allowed to fork`）、**继续 held** |
| 「is refused for the DOMAIN, and not for a missing worker」（**R5B 原有，未删**） | `:990` | 真实 fork 过 ⇒ 拒绝理由是**域**，不是 `DRAW_NO_IDENTITY` |

`/proc` 读取是**唯一**被 mock 的内核边界（`node:fs` 的 `readFileSync` 对**一个**路径可返回合成
`stat` 文本**或**抛 `ENOENT`/`EIO` ✓）；spawn 被 mock 成 `FakeChild`（**不产生任何真实进程**）✓。

### 2.3 S06/O02/O03（**实际** supervisor + **实际**工具编排）

| 用例 | 文件:行 | 断言 |
|---|---|---|
| 「keeps the ORIGINAL error object of the owner」 | identity `:1170` | `settlement.error` **就是**传入的那个 Error **对象**（`toBe`）；latch code 是 `DRAW_CANCELLED`；provenance `accepted_as_primary === true` |
| 「does NOT replace an EARLIER failure with the cancel of the owner」 | identity `:1188` | 更早的失败**保持 primary**；provenance `accepted_as_primary === false`、`superseded_by_earlier_failure === true` |
| 「refuses a handle of ANOTHER supervisor」 | identity `:1214` | foreign handle **在任何副作用之前**被拒 |
| 「injects the deliberate failure only after the worker was REALLY alive」 | pilot `:414` | 注入的 error **就是** deliberate 对象；**结算的 error 与原 error 是同一对象**（`toBe`） |
| 「does NOT inject … after a GO of another worker / of another draw」 | pilot `:450` | GO 的 pid 或 ticket_digest 不符 ⇒ **不注入**（`WORKER_NOT_OBSERVED`）、**非** fault-observed |
| 「does NOT inject … when the worker is a zombie / another start time / another parent / another group」 | pilot `:464` | 四种**同号不同进程**/僵尸 ⇒ **不注入** |
| 「does NOT accept an unrelated failure as the expected fault」 | pilot `:481` | 已有别的 latched 失败 ⇒ `faultCasePassed === false` |
| 「does NOT accept a transport failure as the expected fault」 | pilot `:494` | `transport_failure` 非空 ⇒ `faultCasePassed === false` |

### 2.4 S03/O01/S04/O04（**实际** 工具编排）

| 用例 | pilot:行 | 断言 |
|---|---|---|
| 「keeps the owner when the ROOT could not be prepared, and it starts nothing」 | `:539` | root **已登记**、**未启动任何东西**（`supervisor.calls == []`）、**无幻影子进程** |
| 「keeps the owner when the RESERVE failed, and there is no phantom child」 | `:553` | root 已登记、**从未调用 start** ✓ |
| 「refuses a COPY of the helper that is not the reviewed one」 | `:404` | **副本**的摘要不符 ⇒ 不启动 ✓ |
| 「reads the ORIGINAL result of a draw that was held and that ended LATE」 | `:566` | **晚到的结算**的 picture **真的被读到**（sha256/bytes 精确）、**完整终局** |
| 「keeps the owner when the event reader failed after the start」 | `:585` | 事件读取 **EIO** ⇒ 失败进**同一 finally**、**同一个 handle 被 cancel**、**非** fault-observed |
| 「keeps the owner of a HELD draw and ends with the fresh proof」 | `:520` | held 时**用同一个 owner** 轮询到新鲜证明；registry 里 root/supervisor/startPromise **都还在** |
| 「does not lose the owner when the destination fails asynchronously」 | `:611` | 真实**回调式** write 延迟 **EPIPE** ⇒ 证据**照写**、退出码 **1**（**不绿**）、**owner 未丢** |
| 「really succeeds, and the picture is EXACTLY the synthetic one」 | `:352` | 正常路径仍绿 ✓ |

## 3. 六个许可命令形式（全部经 recorder，全部 `n1n2-claude-060p5c-*`）

| 形式 | 最终捕获 | exit | 说明 |
|---|---|---|---|
| `corepack pnpm exec tsc --noEmit` | `n1n2-claude-060p5c-final-tsc` | **0** | 全仓类型检查（含工具与两个测试文件） |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | `n1n2-claude-060p5c-final-identity` | **0** | **75** 例通过 |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | `n1n2-claude-060p5c-final-pilot` | **0** | **28** 例通过 |
| `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `n1n2-claude-060p5c-final-python` | **0** | **52** 例通过（0.045s） |
| `node tools/openfilm-cache-worker-integrity.mjs --generate` | `n1n2-claude-060p5c-final-generate` | **0** | 只写 `cache-worker-integrity.json`；**最终轮 `source_changed == []`**（幂等） |
| `node tools/openfilm-cache-worker-integrity.mjs --check` | `n1n2-claude-060p5c-final-check` | **0** | `{"ok":true,"checked":8}` |

**首轮「实际变更」捕获**是 `n1n2-claude-060p5c-generate-001`（只写了完整性清单）✓。
最终一轮六条**源在运行期间冻结**（每个 `result.json` 的 `source_changed` 都是 `[]`）✓。

## 4. 全部红与 INCOMPLETE（原处保留，未修饰）

### 4.1 红

| 捕获 | exit | 事实 |
|---|---|---|
| `n1n2-claude-060p5c-tsc-001` | **2** | 首轮类型检查红：注册 entry 的字段被声明为 `readonly`、动态 import 的 `exactOptionalPropertyTypes`、`settlement` 的 `never` 收窄。**代码已修** |
| `n1n2-claude-060p5c-identity-001` | **1** | 两例红：epoch-unknown 的拒绝消息匹配写错、foreign handle 的消息匹配写错。**断言已改**（生产语义未变） |
| `n1n2-claude-060p5c-pilot-001` | **1** | 1 例红：held 的用例期望有 `reconcile`，但 stub 在 cancel 时就结算了。**stub 已改为模拟生产的异步结算** |
| `n1n2-claude-060p5c-pilot-002` | **1** | 1 例红：晚到结算的用例判定为 `ok`。**stub 已改为在 reconcile 时带出 latch 的失败**（与生产一致） |
| `n1n2-claude-060p5c-custodian-unit-001` | **1** | 2 例红：假 ops **没有** `worker_group_id` ⇒ 组信号消失。**假 ops 已补上「当下可瞄的组」**（生产语义未变） |
| `n1n2-claude-060p5c-tsc-003` / `-004` | **2** | `limits` 的字面量类型让选项不可用。**类型已放宽为数值型**（只放宽类型） |

### 4.2 INCOMPLETE / 未跑

- 本波**没有**任何 INCOMPLETE 捕获：本波**没有**429，没有中断，没有挂死；**没有**需要交还的活进程 ✓。
- 上一波遗留的 `n1n2-claude-060p5b-python-001`（无 `.exit`/`.result`）**不在本波范围**，**原样保留**，未补写 ✓。

### 4.3 交接时的现场

- HEAD 仍是 `1d348d41…4675`；**index 空**；**无 push** ✓。
- 本波**没有**启动任何真实进程（spawn 被 mock；custodian 的单元测试**不 fork**；**没有**真实 C/N）✓。
- **无**需要交还的 owner ✓。

## 5. 本波**没有**运行（NOT_RUN）

真实 CLI 主入口、真实 custodian C、真实 N、真实 fork、真实 prctl、真实 signal、真实 wait、内核、
真实 `/proc`、正常 N pilot、故意断言失败 pilot、Host、HTTP、媒体、浏览器、Q2、
**`cache-custodian-lifecycle.test.ts` 整个文件**（本票只 typecheck 其接线）、
fullcheck、build、generation 以外的任何写入、网络/下载/付费、J 盘、用户 env 凭据、用户窗口：
**全部 NOT_RUN** ✓。

## 6. NOT_RUN 与风险

| 项 | 状态 |
|---|---|
| 真实 N 正向往返（正常 N + 故意断言失败） | **NOT_RUN**（本票不授权） |
| 真实 C / fork / prctl / signal / wait / 内核 / 真实 `/proc` | **NOT_RUN** |
| `tools/native-cache-normal-pilot.ts` 的 CLI | **NOT_RUN**（§8 给出精确命令） |
| `cache-custodian-lifecycle.test.ts` 整个文件 | **NOT_RUN**（仍有真实内核动作） |
| R6 / R7 / 原 17 / ISO-01..18 / N1N2 / NEXT | **NOT_RUN / 继续 OPEN** |

**风险（真实）**：

1. **两条修复解释的是「为什么正常路径走不完」，不是内核语义**。真实 N 往返仍是**未跑**的下一道门。
2. **custodian 的信号权限是保守的**：一旦 reap 或号码换人，权限**永久撤销** ⇒ 该 draw **永久 held**
   （这是 SPEC 要求的**保守**方向：宁可持责，不可误杀替代进程）✓。
3. **组不可枚举时改瞄精确 pid**：这与旧行为（瞄缓存组）**不同**，是 SPEC 明确要求的；
   它意味着「组读不到」时**不会**再对组发信号 ✓。
4. **期望失败的门更严**：现在要求**同一个错误对象**、**picture 为 null**、**cancel 是 primary**、
   **无其它失败**；旧工具把「任意非 null error」当通过 ⇒ **旧的真实验收结论不能直接沿用** ✓。
5. **报告边界改为复用受审 nofork 的真实 export**：动态 import 在 vitest 与 tsx 下**均已实测可加载**
   （`n1n2-claude-060p5c-final-pilot` 28 例通过即证据 ✓）；但**真实 CLI 入口未跑** ✓。
6. **本波改了 custodian 与 supervisor 的字节**：nofork 的真实验收绑定的是**旧字节**，**不**替代新源的
   全验收；**未来真实 N 门需要新的完整基线 hash** ✓。
7. **legacy 混合文件的真实行为仍未跑**：它现在**需要**受审 runner 的 receipt 与**真实 close**，
   这比旧断言**更强**，但**未验证** ✓。

## 7. 其余发现：继续 OPEN

本波**只**动 R5B 的 **S01..S06 / O01..O06**。`MAIN_COMBINED_ADJUDICATION` 里点名的
**R6/R7** 两条**继续 OPEN**；`R5A C01/C03` 维持 **CLOSED_STATIC**（**未回退**）；
原 17 / ISO-01..18 / N1N2 / NEXT / 全量门**全部不变** ✓。
本波**不**自签独立外审、**不**自签全阶段 PASS、**不**签内核。

## 8. 下一步：**准确的两条真实 N 调用**（**本票不执行**）

MAIN 定点独立复核**这两个生产文件的精确字节**与**两个工具/测试文件**之后，若过门，实际首跑是**两条**，
一条一条来，**单重型槽**（cwd = 仓库根）：

```sh
# ① 正常：真的画出来，而且域真的没了
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts \
  --mode normal \
  --expected-custodian-sha256 36387d5287ee6977ee1625e9a6ebbe61f2f8992fa4502c19310d11548d9503d7 \
  --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

```sh
# ② 故意断言失败：先真的观测到同 epoch 的 HELLO+GO 与存活，再注入 EXPECTED_ASSERTION_FAILURE
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts \
  --mode assertion-failure \
  --expected-custodian-sha256 36387d5287ee6977ee1625e9a6ebbe61f2f8992fa4502c19310d11548d9503d7 \
  --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

**现行 exit 语义**：

| mode | exit 0 | exit 1 | exit 2 |
|---|---|---|---|
| `normal` | `kind==="ok"`：无失败、**完整终局**、picture **恰好**是那 1024 个 `0x4a`、**证据全部写成功**、**报告没有失败** | 其它一切 | 参数不合法 |
| `assertion-failure` | **不可能** | `kind==="fault-observed"` **仅当**「注入的**精确**是 `EXPECTED_ASSERTION_FAILURE`」+「**结算的错误就是那同一个对象（或其明确 cause）**」+「**完整终局**」+「**picture 为 null 且不是那一张**」+「**无其它 native/transport/cleanup/evidence/report 失败**」+「**cancel 是 primary**」同时成立；否则是失败 | 参数不合法 |

- **不把任意 exit 1 叫「通过」**：② 的 exit 1 是**预期**，但**只有**回执里同时出现
  `fault_case_passed=true`、`terminal_proof=true`、`picture_is_the_exact_one=false`、
  `evidence_errors=[]`、`reporting_failure=null`、且 `cancel_provenance.accepted_as_primary=true` 时，
  它才是**预期且被证明**的 ✓。
- 真实运行需要 MAIN 另发的**精确许可**（真实 C/N、真实信号、内核）。**本票不请求、也不执行。**
- **交还后**，MAIN 的**两道独立安全门**（定点 startup 复核 + 定点 owner 复核）必须**先**过，
  然后才另票跑上面的真实 N；**R6/R7/原 17/ISO-01..18 继续 OPEN** ✓。

## 9. 交还

writer 权与资源在本报告完成后交还 MAIN。本波**不**运行真实 N pilot，**不**改任何未授权文件，
**不**关闭除 R5B S01..S06 / O01..O06 外的任何 finding，**不**自签外审、**不**自签全阶段 PASS。
MAIN 定点复核**这两个生产文件的精确字节**与**两个工具/测试文件**之后，另发实际首跑票（两条 CLI）。
生产 N 正向与 R6/R7 及其余发现**需另修另验**。
