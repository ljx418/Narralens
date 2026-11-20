# n1n2-claude-060p1r4a — 无 fork pilot 工具的定向安全修正（NF01..NF06，仅两个新文件）

本波是 **MAIN_RELEASE_060P1R4A_NOFORK_SAFETY_CORRECTIONS** 的实施波。范围**只有**两个新文件：

| 文件 | 角色 | sha256（本波终态） |
|---|---|---|
| `tools/native-cache-nofork-pilot.mjs` | 工具 | `bc0a9e112431dc445bb2ac602862879d5446324903e1eee5c60afe613e79de9c` |
| `tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs` | 纯 mock 测试 | `d5f426108cbc4472dcc9770c22793efa21c6503903e48f299bd64344cd585ca8` |

起始 sha256（release `start_sha256`）：工具 `bc897040…d0a2ab`、测试 `33b46653…86134`。
**没有**新增任何源文件/测试文件；**没有**改任何生产文件；**没有** Git 操作；**没有**删改 R4 的任何捕获、
报告或证据。

## 0. 结论

- **NF01..NF06 六条全部在两个新文件里修完**，并各配**驱动真实 `main` + 真实 `runPilot` + 真实账本**的
  纯 mock 反例。**38 条原有用例一条没删**，现为 **49 条**（`# tests 49 / # pass 49 / # fail 0`）。
- **本波只有三种许可形式的运行，全部先经 recorder**，红绿都原处保留。
- **NF-06 的历史更正**：R4 的 `n1n2-claude-060p1r4-report.md` 第 172 行写「**五份**失败的捕获」是**错的**。
  实测 R4 的捕获是 **`test-001`..`test-004` 四份失败（exit 1）+ `test-005` 一份绿（exit 0，38/38）**，
  两份 `node --check` 均 exit 0。**旧报告不覆盖**（按 NF-06 的要求），本节即为更正。
- **真实 C / prctl / 真实 signal / 内核 / 真实 `/proc` / 真实 CLI 主入口：全部 NOT_RUN**。
  本报告**不**声称任何真实子进程或内核语义已被验收。

## 1. 每条 NF：实际 callsite、实际 mock 反例、风险

### NF01 — spawn 之后的证据写失败不得丢活 owner（MAJOR）

| 项 | 内容 |
|---|---|
| 实际 callsite | 工具 `:924` `writeEvidence()`（**所有**证据写的唯一入口，**不抛**）；`:939` preflight；`:950` preflight 写失败→拒绝；`:1151` `outcome.json`；`:1199` `main`；`:1235` `held.json`；`:1257`/`:1273` `final.json` |
| 改法 | ①证据写全部走 `writeEvidence()`，失败只**记**有界原 I/O error（`evidence_errors`），**不抛**；②preflight 写失败→**在 spawn 之前**拒绝（没有 child，没有 owner 可丢），root 保留；③`outcome.json` 写失败→`outcome.kind` 置 `failed`（**触发失败资格**），写不出来的**不补造**；④`held.json`/`final.json` 写失败→**记**事实，owner **不动**；⑤`main` 的 HELD 循环**只**在完整终局后返回；⑥`runPilot` 的 cleanup 外面再包一层 try/catch，cleanup 自己抛了也只是 `unknown` |
| 实际 mock 反例 | 测试 `:802`「keeps the owner when the outcome and the held evidence cannot be written」：`outcome.json` 抛 **ENOSPC**、`held.json` 抛 **EIO**；断言 **子仍活时 main promise 既没 settle 也没 reject**（`settled === null`、`child.exitCode === null`）；随后 `pushExit`+`pushClose`+`proc.gone` 才结束，返回 **1**；失败事实 `["held.json","outcome.json"]` 在案；HELD 之后**再没发过信号**（`killed` 仍只有 TERM+KILL） |
| 风险 | 真实 ENOSPC/EIO 下 detached 的 nofork C 会**一直等授权**，而 owner 没了。**本波只在 mock 上证明**，真实文件系统故障下的持责**未跑** |

### NF02 — 已记录的错误/溢出/完整帧队列影响资格（MAJOR）

| 项 | 内容 |
|---|---|
| 实际 callsite | 工具 `:315` `noteLedgerFailure()`（**first unexpected failure 锁存**）；`:412` child error；`:436`/`:443` stdout/stderr overflow；`:458` stdio error；`:472` 解码错误；`:483` 完整帧队列越界；`:499` control error；`:1126`–`:1128` 资格判定 |
| 改法 | ①账本新增 `firstFailure`（**最早真实失败，后来者只进有界 `failureLog`，不覆盖**）与 `failureLog`（上限 16 条）；②`child-error`/`stdout-overflow`/`stderr-overflow`/`stdout-error`/`stderr-error`/`control-decode-error`/`control-error`/`control-queue-overflow` **全部进同一个锁存**；③完整帧队列**同时**限**帧数**（`controlQueueFrames=64`）与**总字节**（`controlQueueBytes=256KiB`），越界即锁存，**已入队的第一个 HELLO 不丢**；④`identityProved = primary===null && unexpected===null && 完整终局`；⑤`faultCasePassed = 故意注入 && unexpected===null && 完整终局` |
| 实际 mock 反例 | 测试 `:844` stdout overflow 后 `unexpected_failure.source==="stdout-overflow"`、`cleanup.kind==="closed"`、**终局完整**，但 `kind==="failed"`（合法 HELLO **不能** mask 已知失败）；`:867` control error 后 `fault_observed===true` 而 **`fault_case_passed===false`**；`:891` 帧**数**越界；`:916` 帧**字节**越界（20 个 16KiB 帧，字节界先到） |
| 风险 | 真实 C 的 transcript 很小，**本波没有**观察到外部洪泛；这里证明的是**事件入口到结果判定的那条路**不再忽略已知失败 |

### NF03 — HELD 期间必须有完整 fresh 终局证明（MAJOR）

| 项 | 内容 |
|---|---|
| 实际 callsite | 工具 `:593` `checkTerminalProof()`（**唯一**的终局判定）；`:657` `finalizeClosed()`（cleanup 返回）；`:1120` 前后 `runPilot` 的最终资格；`:1254`–`:1266` `main` 的 HELD 轮询 |
| 改法 | ①`checkTerminalProof(ledger, deps)` 统一给 cleanup 返回、HELD 恢复、main 最终结果：**close 真的见过** + **exit 真的发生**（或**合法 no-birth**：无 pid 且有错误）+ **原 epoch fresh gone**（`gone` 或 `start_ticks` 换代）；②`unknown` 的 `/proc` **不是**证明；③只证明**原 epoch** gone，**不**取新 pid 的权力（换代也算原 epoch gone，但**不**声称新占用者归本工具管）；④HELD 分支**不再**只 `await closePromise` 就返回：改成**有界非 busy 轮询**（`waitForClose(1s)` + `checkTerminalProof` + `sleep(50ms)`），**无责任期限**，**绝不再 signal** 已 exit/reaped 的 C；⑤迟到证明只把原失败**结束**为 1，**不**洗白成功 |
| 实际 mock 反例 | 测试 `:939`「waits for the fresh proof when the close was seen but the process was not」：`/proc` 按脚本读 `known,known,unknown×9,gone`；断言 **close 已见过但 proc EIO 时 main 没有提前 settle**、**一个信号都没发**（`killed` 为空）；`gone` 到达后才结束为 **1**；`final.json` 里 `proof.complete===true`；`proc.lastStep==="gone"`（**结束必须发生在证明之后**） |
| 风险 | 真实 Node 的 `close` 与 `exit` 时序、真实 `/proc` 换代**一次都没跑**；本波只证明**判定逻辑**不再把 close 当终点 |

### NF04 — 无 PID 的异步 spawn 错误（MINOR）

| 项 | 内容 |
|---|---|
| 实际 callsite | 工具 `:1062`（无 pid 时**原错误**优先）、`:1017`（epoch 读取**不再解引用 null**） |
| 改法 | ①`ledger.pid === null` 时 **epoch 为 null**，**不再**读 `epoch.presence`（原 `TypeError` 盖掉 EAGAIN/ENOENT 的洞）；②**没有 child** 时，`helloFailure` 一律让位给**真实的首个错误**（`ledger.firstError`）；③走**合法 no-child-confirmed** 路由：close 真的来过 + 无 pid + 有错误；④原错误**原样保留**在 `outcome.error`（code 不变） |
| 实际 mock 反例 | 测试 `:977`「keeps the original start failure when the child was never born」：`pid=undefined`，**下一 tick** 才发 `EAGAIN` 与 **无 exit 的 close**（`pushClose(null,null)`）；断言 `outcome.error.code==="EAGAIN"`、`cleanup.kind==="no-child-confirmed"`、`terminal_proof.no_birth===true`、`terminal_proof.complete===true`、**没有 TypeError** |
| 风险 | 真实 `spawn` 的 EAGAIN/ENOENT 时序**未跑**；这里只证明**真实 runner 次序**下不再被 TypeError 覆盖 |

### NF05 — fresh 身份的 PPID 比较（NOTE）

| 项 | 内容 |
|---|---|
| 实际 callsite | 工具 `:264`（`fresh.identity.ppid === toolPid`）、`:268`（fresh ppid 与**登记 epoch** 的 ppid 一致）、`:553`（signal 前的 live 校验，本波未动） |
| 改法 | `verifyCustodianIdentity` **显式**比较 **fresh** epoch 的 ppid 与 `toolPid`，并（传入登记 epoch 时）与登记 epoch 的 ppid 一致；HELLO 的 ppid 比较**保留** |
| 实际 mock 反例 | 测试 `:1005`：单元级 `verifyCustodianIdentity` 对**错 fresh PPID** 返回 `ok===false`；再走真实 `runPilot`：`/proc` 的 ppid 是 4243 → `outcome.error.code==="IDENTITY_MISMATCH"`、`kind==="failed"` |
| 风险 | 固定 C 是本工具的直系子进程，**没有**声称存在外来父进程利用；这里只是**把断言补全** |

### NF06 — 捕获计数更正（NOTE）

见 §0：**R4 是 `test-001`..`test-004` 四份失败 + `test-005` 一份绿**，不是五份失败。旧报告**不覆盖**。
两份 `node --check` 都是 exit 0。

## 2. 本波实际执行的命令（**三种许可形式，全部先经 recorder**）

recorder：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`
（sha256 `88cd47ec…fd10`，**未修改**）。前缀 `n1n2-claude-060p1r4a-`。
**运行时源码冻结**；**没有**直接试跑；**没有**预跑；**没有**跑其它命令形式。

| capture | argv | exit | log sha256 | `source_changed` | 内容 |
|---|---|---|---|---|---|
| `n1n2-claude-060p1r4a-check-tool-001` | `node --check tools/native-cache-nofork-pilot.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿（**当时的字节**，早于最后一次修正，保留） |
| `n1n2-claude-060p1r4a-test-001` | `node --test tests/…/native-cache-nofork-pilot.test.mjs` | **1** | `3750b2d5ca1fb1fe4b34ebb32364db0b4e058da9ca7ebde2160d293569a03a34` | `[]` | **失败并保留**：48/49。唯一失败是**无 birth 那条**：`outcome.error.code` 是 `CUSTODIAN_CLOSED` 而不是 `EAGAIN`——工具里「无 pid 时让位给原错误」的那条分支**还没写**。**代码已修**（`:1063`） |
| `n1n2-claude-060p1r4a-test-002` | 同上 | **0** | `70c1b99018c51447127a5f3714b128fb86f83a825801cfbc26e01b1464fd5623` | `[]` | **49/49 通过**（`# tests 49 / # pass 49 / # fail 0`）。**这份捕获绑定的是最后一次「去重」之前的字节**（工具 `ab215046…90e3c`） |
| `n1n2-claude-060p1r4a-test-003` | 同上 | **0** | `113ae9ff0b5122f6741b6367f8b4b44cb83b0faa2b1d80054660a208ebc672b7` | `[]` | **49/49 通过**（`# tests 49 / # pass 49 / # fail 0`）。**这份捕获的 `inputs.json` 绑定的正是本报告 §0 的两个终态 sha256**（工具 `bc0a9e11…de9c`、测试 `d5f42610…5ca8`） |
| `n1n2-claude-060p1r4a-check-tool-002` | `node --check tools/native-cache-nofork-pilot.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿（**去重之前的字节**，保留） |
| `n1n2-claude-060p1r4a-check-tool-003` | `node --check tools/native-cache-nofork-pilot.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿（**终态字节**） |
| `n1n2-claude-060p1r4a-check-test-001` | `node --check tests/…/native-cache-nofork-pilot.test.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿（**终态字节**） |
| `n1n2-claude-060p1r4a-check-test-002` | `node --check tests/…/native-cache-nofork-pilot.test.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿（**终态字节**，复跑以与 test-003 同一批字节） |

**失败的那一份原处保留**，没有覆盖、没有删除。**本波没有一次未经 recorder 的试跑。**

**本波没有运行**（票内明令禁止）：真实 CLI 主入口、真实 custodian C、任何真实 child、任何真实信号、
内核、真实 `/proc`、`tsc`、`vitest`、全量门、generation、浏览器、网络、凭据、J 盘。
**只读**的文件哈希与源检索是允许的，也只做了这些。

## 3. 25 份受保护文件：原 sha256 **全未变**

写后**逐项实测**（sha256 与字节数，脚本对照 release 的 `protected_existing25_sha256`）：
**CHANGED: NONE**（25/25）。`AGENTS.md` sha256 `37300463…4542b` **未变**。
**git index 空**；HEAD `1d348d419120f23f45d958112ea8c43df5a04675` **未变**；
**没有** add/commit/reset/stash/checkout/push。

## 4. 生产缺陷：14 条**全部继续 OPEN**

`OPEN_PRODUCTION_FINDINGS.json` 的 14 条（R3-C01…R3-C09、R3-I01…R3-I05）**一条都没有被本票关闭**。
本票只改**两个新文件**，**不动任何生产文件**，**不做任何 N 正向修复**。
**原 17 / ISO-01..18 / N1N2 / NEXT / A057-04 / 全量门**全部不变，本票**不**关闭其中任何一条。

## 5. NOT_RUN 与风险

| 项 | 状态 |
|---|---|
| 真实 CLI 主入口（`node tools/native-cache-nofork-pilot.mjs …`） | **NOT_RUN**（票内明令不执行） |
| 真实 custodian C / prctl / fork / wait / signal | **NOT_RUN** |
| 真实 `/proc` 读、真实 detached、真实 Node `close` 时序 | **NOT_RUN**（门里是注入的假 `/proc` 与假事件） |
| 真实 ENOSPC/EIO 下的持责 | **NOT_RUN**（门里是注入的写失败） |
| 真实浏览器 / 媒体 / Host / HTTP / 网络 | **NOT_RUN** |
| `tsc` / `vitest` / 全量门 / build / generation | **NOT_RUN** |

**风险（真实）**：

1. **纯 mock 门证明的是账本与判定的逻辑，不是内核**。真实 `/proc`、真实 `detached`、真实信号、
   真实 Node 的 `close`/`exit` 次序**一次都没有跑过**。
2. `checkTerminalProof` 认「close 带着 code/signal」为 exit 事实；真实 Node 里 `close` **确实**带
   code/signal，但**没有**在本机上验证过这一条。
3. `identityProved` / `faultCasePassed` 现在**要求**完整终局；真实首跑若 `/proc` 读不到，
   工具会**一直持责**并写 `HELD`——这是**设计**，但真实首跑必须有人盯着。
4. 工具被外部杀死（OOM / 外部 kill）**不是**本工具能解决的：账本随进程一起没了。
5. 证据 root 在 `var/native-cache-pilot/` 下**保留**，**不删**；多次真实跑会留下多个目录。
6. **NEW：`RELEASE.json` 的 `allow_new` 是空数组，而 SPEC 第 27 行要求「OWN 新增
   `n1n2-claude-060p1r4a-report.md`」。本波按 SPEC 新增了**这一份报告**（非源文件/测试文件），
   并在此**显式标出**这一处差异，请 MAIN 判定。**

## 6. 下一步：**准确的两条真实 CLI 调用**（**本票不执行**）

MAIN 独立精确复验这两个新文件之后，若过门，实际首跑是**两条**，一条一条来，**单重型槽**：

```sh
# ① 正常：核对身份，然后清理
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
node tools/native-cache-nofork-pilot.mjs \
  --mode identity \
  --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
```

（上面的 digest 与 `src/adapters/openfilm/cache-process-custodian.py` 的实测 sha256 相同。）

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
| `identity` | `kind==="ok"`：无 primary、**无已知 unexpected failure**、**完整终局**（close + exit + 原 epoch fresh gone） | 其它一切：失败、身份不符、**任何**已知失败（overflow / 通道错误 / 帧队列越界）、**证据写失败**、终局不完整 | 参数不合法 |
| `assertion-failure` | **不可能** | `kind==="fault-observed"` **仅当**「唯一注入确实是 `EXPECTED_ASSERTION_FAILURE`」+「**没有**其它 unexpected failure」+「**完整终局**」三者同时成立；否则是失败（`kind==="failed"`） | 参数不合法 |

- **不把任意 exit 1 叫「通过」**：② 的 exit 1 是**预期**，但**只有**回执里同时出现
  `fault_case_passed=true`、`cleanup.kind="closed"`、`terminal_proof.complete=true`、
  `unexpected_failure=null` 时，它才是**预期且被证明**的；缺任何一条，exit 1 就是**失败**。
- ① 的 exit 0 **不是**「创作成功」，只是**身份核对与清理被证明**。
- **cwd** 必须是仓库根（工具自己核对，不符就**拒绝且不 spawn**）；root 由工具自己建并**先登记**，
  证据留在那里**不删**；真实运行需要 MAIN 另发的**精确许可**。**本波不请求、也不执行。**

## 7. 交还

writer 权与资源在本报告完成后交还 MAIN。本波**不**运行真实 pilot，**不**改任何生产文件，
**不**关闭任何生产发现。MAIN 独立复验这两个新文件的**精确字节**之后，另发实际首跑票（两条 CLI）。
生产 N 正向与全部 14 条生产发现**需另修另验**。
