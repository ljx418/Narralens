# n1n2-claude-060p1r3a — 去掉责任期的有限到期（定点修复，非 P2）

- release_id: `MAIN_RELEASE_060P1R3A_REMOVE_RESPONSIBILITY_EXPIRY`
- task_id: `task_f4dea6c8de1d` / dispatch_id: `ctx_3d132d0baaf3`
- 依据: `repair-060p1r3a/RELEASE.json`、`repair-060p1r3/MAIN_HANDOFF_REVIEW/MAIN_BLOCKER_DECISION.json`（**R3-MAIN-01**，REQUEST_CHANGES_BEFORE_PILOT）、`repair-060p1r3/SPEC.md` §1（UNKNOWN 必须持责）、`repair-060p1-review/ADR_060_REV3_CUSTODIAN_AND_REPAIR.md` rev3 §1
- 基线核对（写前）：**3 份 `start_sha256` 全部逐项实测一致**；`AGENTS.md` sha256 `37300463…4542b` 与 release 的 `protected_AGENTS_sha256` 一致；**git index 空**；HEAD 仍 `1d348d419120f23f45d958112ea8c43df5a04675`。
- **只改了三个文件**：`src/adapters/openfilm/cache-process-custodian.py`、`tests/agent-driven/integration/helpers/cache-custodian-unit.py`、`src/adapters/openfilm/cache-worker-integrity.json`（生成物）。**R3 的其余 19 份文件与两份报告逐字节未变**（实测比对，见 §5）。
- **R3 的证据缺口 `n1n2-claude-060p1r3-evidence-gap.md` 原样保留**，本波不改写它。

## 0. 结论

R3-MAIN-01 指出的是**我自己写的**一个真实缺陷：R3 给 `RECOVERY_HELD` 定了 `RECOVERY_SECONDS = 60`，
`_recover` 以这个绝对期限为界，而 `_wait_for_recovery` 在**控制通道 EOF**或**selector 报错**时返回 `False`
并让 `_recover` **跳出循环**。两条路合起来的效果是：**在目标仍然未知、或者 Host 已经不在的时候，
唯一的 wait owner 仍然会发出一个 unknown 收据并退出**，而 N 的僵尸可能被 init 收养。
这**直接违反 R3 SPEC §1**（「UNKNOWN 必须保留活的 wait owner 与 N 锚」），而且那个 60 秒**不是任何被批准的预算**。

本波**只做这一件事**，没有重新设计、没有扩大源码范围：

- **删掉了责任期的有限到期**：`RECOVERY_SECONDS` 不存在了，代码里没有任何一个期限可以让责任结束。
  动作仍然有界（TERM 宽限、KILL 确认）、轮询仍然有界（0.5s），**责任没有界**。
- **Host 传输丢失 / 取消 / selector 错误都不是「结束」的证据，也不是「可以退出」的授权**：
  控制通道 EOF、selector 失败 → **注销死掉的端点**，然后**本地恢复继续**；
  **不会因为证明送不到就丢掉 wait ownership**。取消（CANCEL）同样只是被记录，不是退出的授权。
- **`_recover` 只返回「真的证明了」的结算**：未知域**永远到不了收据、也永远到不了退出**。
  `run()` 用 `while not settlement.get("ok")` 把这件事变成了结构上的保证。
- **Host 不在了而清理真的结束了**：可以**非成功退出**（exit 4），此时**没有子进程**，
  **原 failure 被保留**（写进 stderr，收据送不到时它仍在）。

## 1. 精确改动行

### 1.1 `src/adapters/openfilm/cache-process-custodian.py`

| 行 | 改动 |
|---|---|
| `:167-175` | **删除 `RECOVERY_SECONDS = 60.0`**。注释改为明确写出：**没有责任期的到期**——结算的动作有界、恢复的轮询有界，但**责任没有界**；一个有限的责任预算等于在一个组可能还活着的时候丢掉唯一的 wait owner。`RECOVERY_POLL_SECONDS = 0.5` 保留（它是**轮询**间隔，不是到期）。 |
| `:1014` | 新增 `self._host_is_gone = False`：Host 不在了之后，**死掉的端点被注销**，本地恢复继续。 |
| `:1762-1765` | `run()` 里：`settlement = self._settle_domain()` 之后是 **`while not settlement.get("ok"): settlement = self._recover(settlement)`**。收据**只**接收一个真的被证明了的结算；未知域**结构上**到不了收据与退出。 |
| `:1766-1790` | 收据写不出来时（`flushed` 为假）：**`_report_failure_to_stderr()`** 然后 `return 4`。**非成功退出**，此时结算**已经证明没有子进程**；**原 failure 被保留**并写进 stderr（控制通道没了，stderr 是还开着的那一条）。 |
| `:1787-1806` | 新增 `_report_failure_to_stderr()`：把原 failure（或 `RECEIPT_NOT_DELIVERED`）以 JSON 写进 stderr。 |
| `:1834-1886` | `_recover()`：**没有期限**。`while True:` —— 每一轮：进入 `RECOVERY_HELD`；**第一次**发 `CUSTODIAN_HELD`；`_wait_for_recovery()`；若是 `"gone"` 则 `_local_pause()`（有界，不空转）；回到 `SETTLING`，**不再发信号**地 `_settle_domain(resignal=False)`；**只有 `ok` 才 return**。**它返回的结算永远是「真的证明了」的**。 |
| `:1888-1890` | 新增 `_local_pause()`：`time.sleep(RECOVERY_POLL_SECONDS)`——本地恢复**有界且不空转**。 |
| `:1892-1903` | 新增 `_unregister_dead_endpoints()`：置 `_host_is_gone = True` 并从 selector 里**注销控制通道**。**wait ownership 不随之丢掉**：本程序仍是这个 draw 唯一的 wait owner，本地恢复自己轮询域。 |
| `:1905-1950` | `_wait_for_recovery()` 的返回值从 `bool` 改成 **`"recheck" | "poll" | "gone"`**：`_host_is_gone` → `"gone"`；**selector 报 OSError** → 记 `selector-failed-in-recovery`、**注销死端点**、`"gone"`；**控制通道读失败（CustodianFailure）** → 记 `control-closed-in-recovery`、**注销死端点**、`"gone"`；收到 `RECHECK` → `"recheck"`；收到 `CANCEL` → **只记录**（取消不是退出的授权）；否则 `"poll"`。 |

**没有改动的部分**：`TargetCensus` / `TargetSettlement` / `KernelSettlementOperations`（UNKNOWN 的语义、
N-last 的次序、锚的持有）、`_settle_domain`、`_spawn_worker`、exec 管道的所有权、分段收据、
`RECEIPT_FLUSH`、诊断预算的锁存——**一字未动**。

### 1.2 `tests/agent-driven/integration/helpers/cache-custodian-unit.py`

| 行 | 改动 |
|---|---|
| `:564-571` | 新增 `_failing_read`（端点不在了）与 `_failing_killpg`（组不在了，答案只有 ESRCH）——**内核边界的确定性 mock**。 |
| `:574-604` | 新增 `_FakeEvent` 与 `_FakeSelector`（脚本化的 selector：可返回事件、可报 OSError、记录 register/unregister）。 |
| `:539-556` | `_FakeOs` 增加 `read` 与 `killpg` 的可注入实现（默认分别是「读失败」与「ESRCH」）。 |
| `:894-1074` | 新增 `TheRecoveryOfAnUnknownDomain`：**驱动真实的 `Custodian._recover` → `_wait_for_recovery` → `_settle_domain` → `KernelSettlementOperations`**，只在 proc 读、wait、时钟与 selector 四个边界上 mock。**不是** `FakeOperations`。 |

## 2. 反事实（mock counterfactual）

三个用例的共同形状：**census 一直是 UNKNOWN，直到时钟越过 `unknown_until = 1070.0`**
（起始 1000.0，即**超过 70 秒**），然后它变成确定。Worker 是一个**僵尸**（Z）：它不是活的，
但它是**仍需 reap 的资源**，而它是**锚**。

| 用例 | 注入 | 断言 |
|---|---|---|
| `test_the_recovery_has_no_expiry_and_keeps_the_anchor`（`:1002`） | 枚举一直是 `None`（UNKNOWN） | ① 时钟推进 **> 60 秒**（`now - 1000.0 > 60`）而**恢复仍在进行**；② 恢复**只**返回 `ok=True` 的结算；③ **未知期间没有发出任何最终收据**（`sent` 里没有 `DOMAIN_REAPED`），只发过一次 `CUSTODIAN_HELD`；④ **N 在 census 变确定之前没有被 reap**（`n_reaped_before_settled is False`），最终 `waits == [200]`；⑤ **恢复期间没有再发信号**（`len(signals) == 2`：只有第一次结算的 TERM 与 KILL）；⑥ **原 failure 被保留**（`_failure.code == "SOMETHING"`）。 |
| `test_the_recovery_survives_the_end_of_the_control_channel`（`:1031`） | selector 报一次控制通道事件，而该端点的读**失败**（`_failing_read`） | ① 恢复**完成**（`ok=True`）——**控制通道 EOF 不是结束，也不是退出的授权**；② **死端点被注销**（`CONTROL_FD in selector.unregistered`）、`_host_is_gone is True`；③ **wait ownership 没有被丢掉**：N 仍然只在**被证明**的那次结算里被 reap（`waits == [200]`，`n_reaped_before_settled is False`）；④ **没有**向一个不在的 Host 发出收据。 |
| `test_the_recovery_survives_a_failing_selector`（`:1053`） | selector 每次都抛 `OSError(EIO)` | ① 恢复**完成**（`ok=True`）；② `_host_is_gone is True`；③ N 仍然只在被证明的那次结算里被 reap；④ **原 failure 被保留**。 |

**这三个用例在 R3 的字节上会怎么失败**：R3 的 `_recover` 有 `deadline = time.monotonic() + RECOVERY_SECONDS`，
而 `monotonic()` 是 mock 的时钟（1000.0）→ **第一个用例的第一次 `_settle_domain` 之后时钟是 1018**，
`while time.monotonic() < deadline` 在 1018 < 1060 时成立 → 它会再转几轮；**但一旦时钟越过 1060，
循环就会退出**，返回那个 **unknown** 的结算 → `settlement["ok"]` 为假、`unknown` 为真 →
**断言 ② 与 ① 都会失败**。用例 ② 与 ③ 在 R3 的字节上：`_wait_for_recovery` 返回 `False` →
`_recover` **break** → 返回 unknown 的结算 → **断言 ① 失败**。

## 3. 本波实际执行的命令（三种许可形式，全部经 recorder）

recorder: `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`
（sha256 `88cd47ec732a340f54cdd4bb05b05878887697eebb0ddc94b1ccd7d0e434fd10`）。
**逐字核对**：`repair-060p1r2`、`repair-060p1r3`、`repair-060p1r3a` 三份 release 里的
`recorder_sha256` **完全相同**，且**与实测的文件哈希一致**；**recorder 文件本身从未改变**，
本波也**未修改**它。

| capture | argv | exit | log sha256 | `source_changed` | 内容 |
|---|---|---|---|---|---|
| `n1n2-claude-060p1r3a-unit-001` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | **1** | `5cd6100cf21b43e1134c7c241ff453df5a962823630958310f361a3e36d52fbc` | `[]` | **失败并保留**：37 例通过、1 例 error——`test_the_recovery_survives_the_end_of_the_control_channel` 的**假 selector 返回的不是 `(key, mask)` 元组**，真实代码 `for key, _mask in events` 解不开它。**是测试的错**，生产代码未改。 |
| `n1n2-claude-060p1r3a-unit-002` | 同上 | **0** | `4d875fedc582561cde1f243eafa5d4e02956cf374028ab9ddd019828c4c590fd` | `[]` | **38/38 通过**（`Ran 38 tests in 0.035s … OK`）。唯一的改动是那个假事件的形状。 |
| `n1n2-claude-060p1r3a-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | `935887d3b5e12302baa46695d2edd70b82320677eca3372b38eae4610f86bd11` | **`["src/adapters/openfilm/cache-worker-integrity.json"]`** | **这些字节的第一次实际生成**；产物 sha256 `9dac431b53d620c2ea8832a6dbab02e1c66e5583f5b634c399defe24250f4c65`。 |
| `n1n2-claude-060p1r3a-integrity-001` | `node tools/openfilm-cache-worker-integrity.mjs --check` | 0 | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` | `[]` | `{"ok":true,"checked":8}` |

**本波没有任何未经 recorder 的开发期试跑**：所有命令都先经 recorder，失败（unit-001）**原处保留**，
重跑用新名字（unit-002）。**没有 tsc / vitest / node --check / ast 预检**在本波运行过——
本波的语法检查就是**单元门本身**：它 import custodian，custodian 的语法错误会直接变成 import 错误。

## 4. 精确的运行边界（更正 R3 报告里过强的说法）

R3 报告 §0 写了「**本波没有启动过任何进程**」。**那句话过强，本波更正它**：
R3 的 scope 纯门 import 了上游模块，而上游的可用性核对**会在 pinned vendor 树上跑一次只读的 `git`**——
**那确实是一个子进程**。

**精确的说法是**：本波与 R3 都**没有**执行**目标**运行——**没有**真实的 custodian C、**没有**真实的
worker N、**没有**任何 fork / prctl / setsid / waitid / waitpid / signal、**没有**媒体、**没有**浏览器、
**没有** Host/HTTP、没有全量门与 build。上游可用性核对里的那次**只读 git** 是一个**工具链**子进程，
**不是**目标 C/N，也不是内核等待语义。

## 5. 文件与哈希

| 路径 | R3A start | 本波之后 | 说明 |
|---|---|---|---|
| `src/adapters/openfilm/cache-process-custodian.py` | `78093fe81b31a55db1ffb500cdde19d5e67bf30d5ba884747c0ada643bfec221` | `6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618` | 定点修复（§1.1） |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `713af110affccd7b613ed5df56fe9da5320a9eedb22ded834c1b3a75e9601e7d` | `85b738d0fc8cf81337749d65eed4eda06cfaa77e9e4d36eefbf47193c9d12347` | 新增三个反事实（§1.2/§2） |
| `src/adapters/openfilm/cache-worker-integrity.json` | `55eadbd6a8f9ec72d1eb245eaddce83560bcd4bcb46edf0bffe92c3a54eec08c` | `9dac431b53d620c2ea8832a6dbab02e1c66e5583f5b634c399defe24250f4c65` | **生成物**，只由 `--generate` 写 |

**R3 的其余 19 份文件与两份报告逐字节未变**（实测：与 R3 报告 §2 记录的哈希逐一比对，
**UNEXPECTED changes: NONE**）。

## 6. 对 R3 报告的**明确 REJECTED**

R3 报告 §6 风险 2 写的是：

> 「**`RECOVERY_HELD` 的 60s 预算**是本波新定的：C 在 UNKNOWN 时最多持责 60s，之后**非成功退出**
> （此时 N 的僵尸会被 init 收养）。这个数字**未经真实内核验证**。」

**这句话被 MAIN 明确 REJECTED**（`R3-MAIN-01`），并且**本波已经从代码里删除了那个预算**：
**没有责任期的到期**，也就**没有**「60 秒后非成功退出、N 的僵尸被 init 收养」这条路径。
那段文字**只作为历史保留在 R3 报告里**（本波不改写它），**它的结论不再成立**。

同样被本波更正的还有 R3 报告 §0 的「没有启动过任何进程」（见 §4）。

## 7. NOT_RUN

| 项 | 状态 |
|---|---|
| 真实 custodian / prctl / fork / setsid / wait / signal | **NOT_RUN** |
| 真实的目标 C/N、真实内核等待与收养 | **NOT_RUN** |
| 媒体 / 浏览器 / Host / HTTP / ffprobe | **NOT_RUN** |
| `tsc` / vitest / `node --check` / ast 预检 | **本波按票**未运行**（只跑了三种许可形式） |
| fullcheck / build / Python golden / 全量门 / 独立外审 | **NOT_RUN** |
| 原 17 与 ISO-01..18 的整体验收 | **NOT_RUN / 未整体验收** |
| A057-04 / N1N2 / NativeAck / Studio / A 片 / V1 | **未关闭 / 不可用** |

**本波的证据只证明一件事**：在**被 mock 的内核边界**上，那条「唯一 wait owner 因为一个期限或一个
坏掉的传输而放弃责任」的路径**不再存在**。**真实的内核行为一次都没有跑过。**

## 8. 交还

writer 权与资源在本报告完成后交还 MAIN。本波**不**继续实现，也**不**运行任何提议的 pilot。
MAIN 独立复核**完整的 R3 + 本波这处小修**之后，再决定最小 pilot。
**不得**把本波当成任何运行授权。
