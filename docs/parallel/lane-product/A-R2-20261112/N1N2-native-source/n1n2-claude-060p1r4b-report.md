# n1n2-claude-060p1r4b — 异步报告边界与两项资格/解码残留（仅两个已有文件）

本波是 **MAIN_RELEASE_060P1R4B_ASYNC_REPORTING_BOUNDARY** 的实施波。范围**只有**两个**已有**文件：

| 文件 | 角色 | sha256（本波终态） |
|---|---|---|
| `tools/native-cache-nofork-pilot.mjs` | 工具 | `73fed24c66ec310ccd811fdd7e4dfb51be6d22875ce81a50e1a86a47072fe00d` |
| `tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs` | 纯 mock 测试 | `feb9786b4f38044382ab6ac2ca8435f3bdf89ae83c0882b47177573136deb5ce` |

起始 sha256（release `start_sha256`）：工具 `bc0a9e11…de9c`、测试 `d5f42610…5ca8`（**逐字节吻合**）。
**没有**新增源文件/测试文件；**没有**改任何生产文件；**没有** Git 操作；**没有**删改 R4/R4A 的任何
捕获、报告或证据（R4A 的 8 份捕获与 `n1n2-claude-060p1r4a-report.md`
`sha256 f2ce3aaf…ae7` **原处未动**）。

**NF03..NF06 保持 CLOSED_STATIC，本次没有回退它们**：本波只动了 R4A 复审留下的三条残留
（`R4A-NF01-A` 主项、`R4A-NF01-B` 资格项、`R4A-NF02-A` 解码项）。

## 0. 结论

- **三条残留全部在两个已有文件里修完**，并各配**驱动真实 `main` / 真实 `runPilot` / 真实账本 / 真实
  decoder** 的纯 mock 反例。**已有 49 条用例一条没删**，现为 **53 条**（`# tests 53 / # pass 53 /
  # fail 0`）。
- **本波只有三种许可形式的运行，全部先经 recorder**；**本波没有出现失败的捕获**（首试即绿）。
  R4A 的红捕获全部原处保留。
- **真实 CLI / 真实 custodian C / prctl / fork / 真实 signal / 内核 / 真实 `/proc`：全部 NOT_RUN**。
  本报告**不**声称任何真实子进程或内核语义已被验收，**不**自签外审。

## 1. 三条残留：实际 callsite、实际 mock 反例、风险

### A（主项，`R4A-NF01-A`）— 默认 stderr 的**异步** EPIPE 不得丢掉活 owner

| 项 | 内容 |
|---|---|
| 实际 callsite | 工具 `:887` `createReportingBoundary()`（**新**）；`:917` 目的地 **error 事件**监听（`stream.on("error")`，**在任何 spawn 之前**装、**owner 存活期内永不卸除**）；`:944` **写完成 callback** 错误；`:953` 同步 throw；`:928` `report()`（坏掉之后**不再重试**）；`:1013`/`:1015` `REAL_DEPENDENCIES.reportStream = process.stderr` 与 `writeStderr(text, callback)`（**默认适配器与 main 共用同一边界**）；`:1378` main **第一件事**就建边界；`:1391`/`:1400`/`:1446`/`:1484` `await reporting.settled()`；`:1453`/`:1471`/`:1489`/`:1495` 失败事实进证据与资格 |
| 改法 | ①两条错误通路**都**处理：目的地的 `error` **事件**与写完成的 **callback**；②**同一失败只记一次**（两路去重，按错误对象身份）；③失败保存为**有界**事实（≤8 条，`firstFailure` 不被后来的覆盖）；④目的地坏掉后**不重试写日志**、**不递归报错**；⑤**listener 在 owner 存活期不卸除**；⑥**模块 import 不碰 `process.stderr`**：边界只在**显式执行 `main()`** 时创建；⑦`main` 在给出退出码前 **await 所有 pending 写**，所以「下一 tick 才来的日志错误」**不会丢在成功之后**；⑧报告失败**就是**该 case 的失败：`kind` 置 `failed`、`identity_proved`/`fault_case_passed` 清零、退出码不为 0 |
| 实际 mock 反例 | 测试 `:1112`「keeps the live owner when the reporting destination breaks asynchronously」：注入**同形 Writable**（`:203` `FakeWritable`，能 `emit("error")`，错误**异步**到达，且**两条路都到**）；断言 **listener 已装**（否则 `emit("error")` 会直接崩进程）、**错误事件真的发出过**（`writable.emitted===1`）、**EPIPE 到达后 main 仍未 settle**（owner 没丢）、**root 没被删也没换**（`state.roots.length===1`）、**没有再发信号**（`killed` 仍只有 TERM+KILL）；随后 `pushExit`+`pushClose`+`proc.gone` 才结束为 **1**，且 `final.json` 里 **`reporting_failure.error.code==="EPIPE"`**、**`reporting_failures.length===1`**（两路去重）、`proof.complete===true` |
| 风险 | 真实 `process.stderr` 的 EPIPE 时序**一次都没跑**；这里证明的是**边界逻辑**：监听已装、异步错误被收、owner 不丢、退出码不绿 |

### B（资格项，`R4A-NF01-B`）— outcome 写失败后不得留下 `fault_case_passed=true`

| 项 | 内容 |
|---|---|
| 实际 callsite | 工具 `:1354`–`:1359`（outcome 写失败后的**权威结果重算**）；`:1306` `identity_proved` 字段；`:1495` 报告失败的 best-effort 证据 |
| 改法 | ①`outcome.json` 写失败 → **重新生成一致的权威结果**：`kind="failed"`、`identity_proved=false`、`fault_case_passed=false`、`evidence_published=false`；②**原错误与 cleanup proof 全部保留**（`error` 仍是 `EXPECTED_ASSERTION_FAILURE`，`cleanup`/`terminal_proof` 不变）；③写失败本身是**该 case 的 unexpected failure**（`unexpected_failure.source==="evidence-write"`），**最早的真实失败不被覆盖**（账本已有失败时保留账本那条，只追加到 `failure_log`）；④写失败**可能留下半个文件**，那只是**候选**，不是已提交的收据 |
| 实际 mock 反例 | 测试 `:1164`「clears every pass marker when the evidence of the outcome cannot be written」：**已完整终局**的 `assertion-failure` case（合法 HELLO → exit+close+fresh gone），**只让 `outcome.json` 写失败（ENOSPC）**：断言写之前 `fault_observed===true`/`cleanup.kind==="closed"`/`terminal_proof.complete===true`；写之后 `kind==="failed"`、`fault_case_passed===false`、`identity_proved===false`、`evidence_published===false`、`unexpected_failure.source==="evidence-write"`、`unexpected_failure.error.code==="ENOSPC"`、`evidence_errors[0].name==="outcome.json"`；**原错误与 cleanup proof 仍在**；再走**真实 main** 断言**退出码是 1**（不是「预期故障」的 1） |
| 风险 | 真实 `ENOSPC` 下半个 `outcome.json` 的内容**未跑**；这里证明的是**返回的权威结果**不再自相矛盾 |

### C（解码项，`R4A-NF02-A`）— 第一次解码 fatal 后立刻终结并释放无效 buffer

| 项 | 内容 |
|---|---|
| 实际 callsite | 工具 `:180` `createControlDecoder()`；`:182`/`:183` **failed 状态 + 释放无效 buffer**；`:193` 失败后 `feed()` **直接返回空**（不再累积）；`:215` `get failed()`；`:498`/`:500` 账本：**至多一个** error marker（`controlDecoderFailed`/`controlErrorMarker`）；`:544`/`:550` `takeControlFrame()` **消费记账**（取走的帧不再算在队列字节里） |
| 改法 | ①第一次 fatal（`CONTROL_OVERSIZE`/`CONTROL_FRAME_TOO_LARGE`）→ decoder **立刻终结**：`failed=true`、**无效 buffer 释放为 0 字节**；②此后的 `feed()` **一律返回空**：该 channel **不再累积**、**不再每个 data push 一个 null**；③账本只保留**至多一个有界 error marker**，**已有有效帧队列的 count/bytes 上限不变**（64 帧 / 256 KiB，**没有扩大预算**）；④`takeControlFrame` 的字节记账随消费递减（**顺手最小修**） |
| 实际 mock 反例 | 测试 `:1212`「keeps the decoder terminal after the first bad chunk」：**真实账本**上先喂一个越界 header（`CONTROL_FRAME_TOO_LARGE`），再喂 **3000 个**坏 chunk：断言 `controlDecoder.failed===true`、`controlDecoder.pending===0`、`frames.length===1`（**只有那一个 marker**）、`controlErrorMarker===true`、`frameQueueBytes===0`、`firstFailure.source==="control-decode-error"` 且 `controlError.code==="CONTROL_FRAME_TOO_LARGE"`（**第一个错误被保留**）；测试 `:1234` 另证**消费记账**：帧被取走后 `frameQueueBytes===0` |
| 风险 | 固定 C 的小 transcript 正常路径**未改**（`:180` 之前的解码逻辑逐字保留，只加了终结态）；真实洪泛**未跑** |

## 2. 本波实际执行的命令（**三种许可形式，全部先经 recorder**）

recorder：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`
（sha256 `88cd47ec…fd10`，**未修改**）。前缀 `n1n2-claude-060p1r4b-`。
**运行时源码冻结**；**没有**直接试跑；**没有**预跑；**没有**跑其它命令形式。

| capture | argv | exit | log sha256 | `source_changed` | 内容 |
|---|---|---|---|---|---|
| `n1n2-claude-060p1r4b-test-001` | `node --test tests/…/native-cache-nofork-pilot.test.mjs` | 0 | `4ece57a842a5b241ed98377ab05d4edd5f933fa6b5ef41837133ae97c13aebd8` | `[]` | **53/53 通过**（**首试即绿**）。绑定的字节是加「错误事件真的发出过」断言**之前**的测试文件 |
| `n1n2-claude-060p1r4b-test-002` | 同上 | **0** | `fb2a53bce330e0b41abcb0cf7b6ba9c509ae293427c6f084ca265554ac9e2ed9` | `[]` | **53/53 通过**（`# tests 53 / # pass 53 / # fail 0`）。**这份捕获的 `inputs.json` 绑定的正是本报告 §0 的两个终态 sha256** |
| `n1n2-claude-060p1r4b-check-tool-001` | `node --check tools/native-cache-nofork-pilot.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿（**终态字节**） |
| `n1n2-claude-060p1r4b-check-test-001` | `node --check tests/…/native-cache-nofork-pilot.test.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿（**终态字节**） |

**本波没有失败的捕获**（第一次试跑即绿）。R4A 的 8 份捕获（48 个文件）与 `060p1r4a-report.md`
**原处保留**。

**本波没有运行**（票内明令禁止）：真实 CLI 主入口、真实 custodian C、任何真实 child、任何真实信号、
内核、真实 `/proc`、`tsc`、`vitest`、全量门、generation、浏览器、网络、凭据、J 盘、`env` 读取。
**只读**的文件哈希与源检索是允许的，也只做了这些。

## 3. 25 份受保护文件：原 sha256 **全未变**

写后**逐项实测**（sha256 与字节数，对照 release 的 `protected_existing25_sha256`）：
**CHANGED: NONE**（25/25）。`AGENTS.md` sha256 `37300463…4542b` **未变**。
**git index 空**；HEAD `1d348d419120f23f45d958112ea8c43df5a04675` **未变**；
**没有** add/commit/reset/stash/checkout/push。

## 4. 生产缺陷：14 条**全部继续 OPEN**

`OPEN_PRODUCTION_FINDINGS.json` 的 14 条（R3-C01…R3-C09、R3-I01…R3-I05）**一条都没有被本票关闭**。
本票只改**两个已有文件**，**不动任何生产文件**，**不做任何 N 正向修复**。
**原 17 / ISO-01..18 / N1N2 / NEXT / A057-04 / 全量门**全部不变，本票**不**关闭其中任何一条。

## 5. NOT_RUN 与风险

| 项 | 状态 |
|---|---|
| 真实 CLI 主入口（`node tools/native-cache-nofork-pilot.mjs …`） | **NOT_RUN**（票内明令不执行） |
| 真实 custodian C / prctl / fork / wait / signal | **NOT_RUN** |
| 真实 `/proc` 读、真实 detached、真实 Node `close`/`exit` 次序 | **NOT_RUN**（门里是注入的假 `/proc` 与假事件） |
| 真实 `process.stderr` 的 EPIPE 时序 | **NOT_RUN**（门里是同形 Writable 注入） |
| 真实 ENOSPC/EIO 下的持责 | **NOT_RUN**（门里是注入的写失败） |
| 真实浏览器 / 媒体 / Host / HTTP / 网络 | **NOT_RUN** |
| `tsc` / `vitest` / 全量门 / build / generation | **NOT_RUN** |

**风险（真实）**：

1. **纯 mock 门证明的是边界与判定的逻辑，不是内核**。真实 `/proc`、真实 `detached`、真实信号、
   真实 Node 的 `close`/`exit` 次序、**真实 stderr 管道断开**的时序**一次都没有跑过**。
2. `process.stderr.write(text, callback)` 的 callback 在 Node 里带错误时**是否**与 `error` 事件
   同一个对象，**未在本机验证**；边界按**错误对象身份**去重，若两路是**不同对象**，会被记成**两条**
   失败（`reporting_failures.length` 会是 2）——这是**保守**方向，不会漏记。
3. `await reporting.settled()` 在真实实现里会等 stderr 的写完成；**目的地永久不回调**时 main 会
   **一直等**——这与本工具「无责任期限」的持责语义一致，但也意味着真实首跑需要有人盯着。
4. 写失败可能留下**半个** `outcome.json`：那只是**候选**，**不得**当作已提交的收据；权威是**返回的
   结果**与**退出码**。
5. `reporting.json` 是**新增的一个 best-effort 证据名**（只在报告真的失败时写）；它**不在**
   `outcome.json` 里，因为那时 `outcome.json` 已经写完了。若目的地已坏、它也写不成，事实就**只留在
   内存**里（`outcome.reporting_failure`）——**不补造**。
6. 工具被外部杀死（OOM / 外部 kill）**不是**本工具能解决的：账本随进程一起没了。
7. 证据 root 在 `var/native-cache-pilot/` 下**保留**，**不删**；多次真实跑会留下多个目录。

## 6. 下一步：**准确的两条真实 CLI 调用**（**本票不执行**）

MAIN 定点独立复核这两个文件的**精确字节**之后，若过门，实际首跑是**两条**，一条一条来，**单重型槽**：

```sh
# ① 正常：核对身份，然后清理
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
node tools/native-cache-nofork-pilot.mjs \
  --mode identity \
  --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
```

```sh
# ② 故意断言失败：合法的 HELLO 与 epoch 之后故意抛 EXPECTED_ASSERTION_FAILURE，finally 完整清理
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
node tools/native-cache-nofork-pilot.mjs \
  --mode assertion-failure \
  --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
```

**现行 exit 语义（本波已改，必须照此读回执）**：

| mode | exit 0 | exit 1 | exit 2 |
|---|---|---|---|
| `identity` | `kind==="ok"`：无 primary、**无已知 unexpected failure**、**完整终局**（close + exit + 原 epoch fresh gone）、**报告没有任何失败** | 其它一切：失败、身份不符、任何已知失败（overflow / 通道错误 / 帧队列越界 / 解码终结）、**证据写失败**、**报告失败**、终局不完整 | 参数不合法 |
| `assertion-failure` | **不可能** | `kind==="fault-observed"` **仅当**「唯一注入确实是 `EXPECTED_ASSERTION_FAILURE`」+「**没有**其它 unexpected failure」+「**完整终局**」+「**证据已成功发布**（`evidence_published===true`）」+「**报告没有任何失败**」同时成立；否则是失败（`kind==="failed"`） | 参数不合法 |

- **不把任意 exit 1 叫「通过」**：② 的 exit 1 是**预期**，但**只有**回执里同时出现
  `fault_case_passed=true`、`cleanup.kind="closed"`、`terminal_proof.complete=true`、
  `unexpected_failure=null`、`evidence_published=true` 且**没有** `reporting_failure` 时，它才是
  **预期且被证明**的；缺任何一条，exit 1 就是**失败**。
- ① 的 exit 0 **不是**「创作成功」，只是**身份核对、清理与报告都被证明**。
- **cwd** 必须是仓库根（工具自己核对，不符就**拒绝且不 spawn**）；root 由工具自己建并**先登记**，
  证据留在那里**不删**；真实运行需要 MAIN 另发的**精确许可**。**本票不请求、也不执行。**

## 7. 交还

writer 权与资源在本报告完成后交还 MAIN。本波**不**运行真实 pilot，**不**改任何生产文件，
**不**关闭任何生产发现，**不**自签外审。MAIN 定点独立复核这两个文件的**精确字节**之后，另发实际
首跑票（两条 CLI）。生产 N 正向与全部 14 条生产发现**需另修另验**。
