# n1n2-claude-060p1r4 — 无 fork 身份 pilot 工具（仅实现与 mock 自验证）

- release_id: `MAIN_RELEASE_060P1R4_NOFORK_HARNESS_ONLY`
- task_id: `task_a2192997a179` / dispatch_id: `ctx_b2582e7da3d8`
- 依据: `repair-060p1r4-nofork/RELEASE.json`、`repair-060p1r4-nofork/SPEC.md`、`repair-060p1r4-nofork/OPEN_PRODUCTION_FINDINGS.json`、`repair-060p1-review/ADR_060_REV3_CUSTODIAN_AND_REPAIR.md` rev3、`repair-060p1-review/060P1R_PRIVATE_CONTRACT.md`
- 基线核对（写前）：**25 份 `protected_existing25_sha256` 全部逐项实测一致**（sha256 **与字节数** 都一致，**CHANGED: NONE**）；`AGENTS.md` sha256 `37300463…4542b` 与 release 一致；**git index 空**；HEAD 仍 `1d348d419120f23f45d958112ea8c43df5a04675`。
- **只新增两个文件**（`allow_new` 全部）：`tools/native-cache-nofork-pilot.mjs`、`tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs`。**没有改任何既有源码、测试、manifest 或配置；没有 git 变更操作。**
- **本票不关闭任何生产缺陷**：`OPEN_PRODUCTION_FINDINGS.json` 的 **14 条**全部继续 OPEN。

## 0. 结论

这一票**不是**又一次生产链改写，而是一个**独立的小切片**：一个**独立于 Vitest 的**、
**标准库 only 的**、**无 fork 的** pilot 工具，加上它的**纯 mock 门**。

工具回答的是**一个很小的事实问题**：当 custodian 被单独启动（detached）、并且**没有人授权过
fork** 时——它是不是如实说出了自己的身份、它是不是自己 session 与 group 的组长、它能不能在
**不留任何东西**的情况下被结束。

**核心是那个账本**：spawn 返回之后、任何 await 之前，child/error/exit/close 与三条流的
end/error/data 就**同步登记**；close 是一个**共享的、持久的 promise**，它 resolve 的是**一个明确的
对象**；cleanup 回答的是**带标签的结果**（`closed` / `no-child-confirmed` / `unknown`），
**超时不是结束、错误不是结束、抛错的信号不是结束**。重复的 cleanup **共享同一个 promise**，
**不会重复发信号、不会把结束数两次**。

**这一票只动了两个既有评审条目**：R3-C02（nofork pilot 仍把超时当 close、缺异步账本）与
R3-I05（首个 nofork pilot 仍把 timeout 当 close）——**而且是在新文件里修的**，生产文件一个字节
没有动。其余 **12 条**生产发现原样保留 OPEN。

## 1. 两个新文件

| 路径 | sha256 | 字节 | 责任 |
|---|---|---|---|
| `tools/native-cache-nofork-pilot.mjs` | `bc8970400dcea1cfa33cc60dd6dbbc6a1129b250233bc53ed073f8d0b8d0a2ab` | 38042 | 独立 runner：账本、cleanup、身份核对、CLI |
| `tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs` | `33b46653410821fe8e876fd236bb50516f9ae13d90525625391d3f7cd6786134` | 28273 | 纯 mock 门：`node:test` + `node:assert`，注入 child/流/proc/时钟 |

### 1.1 无 fork 不变量（**结构性**，不是承诺）

工具的**控制通道只有读 API**：这个文件里**没有任何一个函数能往它写一个字节**。因此
`AUTHORIZE_FORK`、`GO` 和任何控制帧**都不可能被发出去**，worker N **不存在**，custodian
**没有需要回收的组**。

- 这一点由**结构**保证，不是由调用方保证：账本里有一个 `noAuthorizeWrites` 标志，
  **cleanup 在它不在位时拒绝发任何信号**，并把结果记成 `unknown`（保全并上报）。
- 这正是**为什么**这个工具可以结束 custodian：一个从未 fork 的 custodian 没有东西要回收。
  同一份能力**绝不能**被用到可能已经 fork 了 worker 的生产路径上——工具的文档里写明了这一点，
  而账本的不变量检查是它的机械保障。
- 纯 mock 门里有一条用例把 `noAuthorizeWrites` 置为 false，断言**一个信号都没有发出**、
  结果是 `unknown`。

### 1.2 固定的东西（**没有可配置项**）

| 东西 | 值 | 来源 |
|---|---|---|
| mode | `identity` / `assertion-failure`（**只有这两个**） | `parsePilotArguments` |
| 解释器 | `/usr/bin/python3.12`，sha256 `e50d468e…4bb150f` | 常量 + 启动前核对 |
| custodian | `<root>/src/adapters/openfilm/cache-process-custodian.py` | 常量 `CUSTODIAN_RELATIVE_PATH` |
| custodian 的 sha256 | **必须**等于 `--expected-custodian-sha256` 的参数 | 启动前核对 |
| argv | `[python, "-I", "-S", "-B", custodian]` | 常量 |
| stdio | `["ignore","pipe","pipe","pipe","pipe"]`，`detached: true` | 常量 |
| 子环境 | 固定白名单；`HOME`/`XDG_*`/`TMPDIR` 指向自有 root 的私有目录；**不读用户 env**；无 `NODE_OPTIONS`、无 `PYTHONPATH` | `privateEnvironment` |
| root | `var/native-cache-pilot/` 下的唯一 `mkdtemp`，**先登记再做任何后续步骤** | `REAL_DEPENDENCIES.createRoot` |

**参数解析器拒绝一切**别的参数：没有可执行文件、没有 argv、没有脚本、没有信号、没有 PID
（`parsePilotArguments` 对 `--python` / `--pid` / `--signal` / `--exec` 一律抛 `PilotFailure`；
纯 mock 门里逐个断言）。

**导入模块不会运行 CLI 也不会 spawn**：`main()` 只在 `isEntryPoint()` 为真时运行，
而纯 mock 门在文件开头就把 `REAL_DEPENDENCIES.spawnChild` 与 `REAL_DEPENDENCIES.createRoot`
换成会记账的守卫，文件末尾的 `after()` 断言**真实 spawn 调用次数为 0、真实 root 创建次数为 0**。

## 2. 账本与 cleanup 的真值表

### 2.1 登记在先（spawn 返回之后、任何 await 之前）

| 登记的东西 | 事实 |
|---|---|
| `child` 句柄、`pid` | 保存下来 |
| `error` 监听 | **error 不是 exit，也不是 close** |
| `exit` 监听 | **exit 不是 close**（stdio 可能还开着） |
| `close` 监听 | **唯一**的结束事实；它 resolve 的是 `{kind:"closed", code, signal}` 这个**明确对象** |
| stdout / stderr 的 data/end/close/error | 各自记；**流的 close 不是进程的 close** |
| control 的 data/end/close/error | **control 读结束不当进程结束**；帧**排队**，等待期间**不丢块** |
| `epoch` | spawn 之后立刻从 `/proc/<pid>/stat` 读的**完整 epoch**（pid/state/ppid/pgid/sid/start_ticks，start_ticks 是**精确字符串**） |
| `closePromise` | **一个**共享 promise，resolve 值是明确对象 |
| `noAuthorizeWrites` | 无 fork 不变量 |

**cleanup 期间新增的 close 监听不被依赖**：结果只看**登记时就已经存在**的那些事实。

### 2.2 cleanup 的真值表

| 情形 | 结果 | 发的信号 |
|---|---|---|
| `noAuthorizeWrites` 不在位 | **unknown**（保全） | **无** |
| 没有 pid（spawn 失败）**且**没有 error | **unknown** | 无 |
| 没有 pid（spawn 失败）**且** error 已记 **且**真实 close 到了 | **no-child-confirmed** | 无 |
| 没有 pid（spawn 失败）**且** close 永不到 | **unknown** | 无 |
| close **在 cleanup 之前**就到了 | **closed** | **无** |
| exit 已见、stdio 未关 | 真实 close 到了 → **closed**；没到 → **unknown** | **无**（已结束的进程不再被发信号） |
| 活着的进程：TERM → 3s 内真实 close | **closed** | 仅 TERM |
| 活着的进程：TERM 无效 → KILL → 15s 内真实 close | **closed** | TERM + KILL |
| 活着的进程：两个信号都没有换来 close | **unknown** | TERM + KILL |
| 信号**抛错** | **unknown** | 只发到抛错的那一步 |
| 信号被**拒绝**（返回 false） | **unknown** | 只发到被拒的那一步 |
| **PID 被复用**（fresh epoch 的 start_ticks 不同） | **unknown** | **无** |
| fresh `/proc` **不可读**（EIO 等） | **unknown** | **无** |
| close 到了**但原 epoch 还在** | **unknown**（进程还活着） | 无 |

**信号之前的三道同步核验**（**核验与 `child.kill` 之间没有 await**）：
① 账本**没有**见过 exit，且 `child.exitCode`/`child.signalCode` **都不是**终值；
② fresh `/proc` 的 **pid + start_ticks + ppid + pgid + sid** 与**启动时记下的 epoch**逐项相同；
③ 无 fork 不变量在位。

**从来不**用裸 `process.kill` 打一个旧 PID 或一个组：**只**对**精确签发的 ChildProcess** 调
`child.kill`。

### 2.3 unknown 之后

- **不删**、**不置 settled**、**不 `process.exit`**：child 句柄、**原 closePromise**、root、事件
  账本**全部留着**；
- 独立的 main **保持责任并等真实 close**（`await ledger.closePromise`，**没有超时**），
  并写出**一次**结构化的 `HELD`（stderr 一行 + root 里的 `held.json`），让 MAIN 能**精确定位 owner**；
- **不会**出现「计时器赛跑之后正常 return、然后被 Vitest 杀掉 runner」那种结局——这个工具本来就
  **独立于 Vitest** 运行。

## 3. 身份与控制读

| 事实 | 实现 | 边界 |
|---|---|---|
| 帧格式 | 4 字节长度在前，**载荷上限 16KiB**、未消费缓冲上限 16KiB+4 | 超出 → **拒绝**，不截断 |
| 文本 | **严格 UTF-8**（`TextDecoder(fatal)`）、严格 JSON、必须是对象 | 违反 → `PilotFailure` |
| C_HELLO | `protocol@3`、`seq===1`、`subreaper===true`、`kind==="C_HELLO"` | 违反 → 拒绝 |
| 发送 | **一个字节都不发** | 控制通道只有读 API |
| stdout/stderr | 各 64KiB 累计、8KiB 尾 | 超限 → `diagnosticsLost`（失败仍走 owned cleanup） |
| HELLO 截止 | 30s **总计** | **只是锁存失败并进入 cleanup**，**不是** C 退出的证明 |
| `/proc` 解析 | 只读最后一个右括号之后的 Linux 字段：state/ppid/pgrp/session/starttime；starttime 是**精确字符串** | 读不了 → **unknown**，**不**假装是空 |
| gone | **只有** ENOENT / ESRCH | 其它错误 → **unknown** |
| 身份核对 | `C_HELLO.pid === spawn 的 pid`、`ppid === 工具自身 pid`、`pgid === sid === pid`、`start_ticks === fresh /proc`、`fresh pgid/sid` 相符 | 任一不符 → `IDENTITY_MISMATCH` |

**Python 的真实 SET/GET** 仍然只由**将来**真实运行的 `C_HELLO`（`subreaper: true`）提供；
**mock 不是内核证明**。

## 4. 两种 mode

| mode | 行为 | 通过的条件 |
|---|---|---|
| `identity` | 核对身份之后进 finally cleanup | cleanup 是 `closed` |
| `assertion-failure` | **合法 HELLO 与 epoch 成立之后**，**故意**抛 `EXPECTED_ASSERTION_FAILURE`；finally 完整清理 | **只有**同时满足：① 观察到的错误**确实**是那一个；② cleanup 是 `closed`；③ 原 epoch **真的 gone** → 才标 `fault-observed` |

**任意 reject 都不能过门**：纯 mock 门里有一条用例断言——当 child **没有**真的关闭时，
`fault-observed` **不成立**。

**这一票对这条 case 的诚实说法**：它声明**没有** N、**没有**成片、**没有** whole-production。
真实运行时那个 custodian **可能**以 SIGKILL 结束（因为**没有 N** 时它的恢复逻辑仍然持责），
**不得**为这个 nofork case 要求「创作成功、exit 0」；**实际事实如实记**。

## 5. 本波实际执行的命令（**三种许可形式，全部先经 recorder**）

recorder: `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`
（sha256 `88cd47ec…fd10`，与 release 一致，**未修改**）。前缀 `n1n2-claude-060p1r4-`。
**运行时源码冻结**；**没有**预跑确认；**没有**直接试跑。

| capture | argv | exit | log sha256 | `source_changed` | 内容 |
|---|---|---|---|---|---|
| `n1n2-claude-060p1r4-test-001` | `node --test tests/…/native-cache-nofork-pilot.test.mjs` | **1** | `5fcaded8aa29152a2945466bb4e82df3fa48a936762fd1c3f5649b7513affd69` | `[]` | **失败并保留**：30/38。8 例失败，**全部是测试自身的问题**：假 `/proc` 文本多了一个 0（start_ticks 读到 `0`）；`parseCustodianHello` 被喂了**带长度前缀**的帧（严格 UTF-8 拒绝）；断言写的是**消息**而代码在 `error.code` 上；假 child 没有 `pushError`；PID 复用那条用例把 epoch 记成了**被复用的那个**。**生产代码未改**。 |
| `n1n2-claude-060p1r4-test-002` | 同上 | **1** | `e754ee96e48af39d5c012bbe7af26a37da00390e85bde753365b6fb217d70ff7` | `[]` | **失败并保留**：上一次的字节（修测试的脚本自己在中途断言失败，**没有写盘**），所以这一份与 001 等价。 |
| `n1n2-claude-060p1r4-test-003` | 同上 | **1** | `944b385c09e584309163ea3d9924112fa12d5d0be7eb619eeebf063b966c3e94` | `[]` | **失败并保留**：37/38。剩下的 1 例是**生产代码的一处真实次序错误**：cleanup 里「close 已经见过」的分支排在「没有 pid」之前，于是「spawn 失败、没有 child」的 case 被答成 `closed` 而不是 `no-child-confirmed`。**生产代码已修**（把「没有 pid」分支提前）。 |
| `n1n2-claude-060p1r4-test-004` | 同上 | **1** | `c04bb651f5406159d0cf0c872f4c3d37ebbcaa9ba2984d366d897e256d93d77a` | `[]` | **失败并保留**：37/38。还是那一条——因为**假 child 的构造函数的默认参数**把 `{pid: undefined}` 变成了默认 pid，于是账本以为有 child。**测试已修**（构造后显式 `child.pid = undefined`）。 |
| `n1n2-claude-060p1r4-test-005` | 同上 | **0** | `29615c1356e21e7b213123628b5259fb44112f7b74ccec287b17ff29982a2741` | `[]` | **38/38 通过**（`# tests 38 / # pass 38 / # fail 0`） |
| `n1n2-claude-060p1r4-check-tool-001` | `node --check tools/native-cache-nofork-pilot.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿 |
| `n1n2-claude-060p1r4-check-test-001` | `node --check tests/…/native-cache-nofork-pilot.test.mjs` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 语法绿 |

**五份失败的捕获全部原处保留**，没有覆盖、没有删除。**本波没有一次未经 recorder 的试跑。**

**本波没有运行**（票内明令禁止）：真实 CLI 主入口、真实 custodian C、任何真实 child、
任何真实信号、内核、`tsc`、`vitest`、`node --check` 之外的任何东西、generation、
fullcheck、build、浏览器、网络、配置凭据、J 盘。**只读的文件哈希与源检索**是允许的，也只做了这些。

## 6. 25 份受保护文件：原 sha256 全未变

写前与写后**逐项实测**（sha256 **与字节数**）：**CHANGED: NONE**。

| 类别 | 文件 |
|---|---|
| 生产源码（6） | `openfilm-upstream.ts` `17fe1138…a2b6`、`created-native-workspace.ts` `d83edbda…562c`、`created-native-source-reader.ts` `0a52b8ff…289e`、`cache-production-scope.ts` `0072d30b…f8b3`、`cache-process-supervisor.ts` `b561eda7…f07a`、`openfilm-cache-worker.mjs` `579a484b…b089`、`cache-worker-policy.mjs` `0d2b2b38…b1214`、`cache-process-custodian.py` `6b8d6df3…1618` |
| 工具与清单（2） | `openfilm-cache-worker-integrity.mjs` `8f59fb59…509d0`、`cache-worker-integrity.json` `9dac431b…4c65` |
| 测试（11） | `openfilm-upstream-lock.test.ts`、`native-cache-witness.test.ts`、`created-native-source-reader.test.ts`、`cache-production-scope.test.ts`、`cache-process-settlement.test.ts`、`cache-worker-fixture.mjs`、`cache-probe-fixture.mjs`、`cache-custodian-lifecycle.test.ts`、`cache-frame-duration-lifetime.test.ts`、`cache-process-identity.test.ts`、`cache-serving-drain.test.ts`、`cache-custodian-unit.py` |
| 报告（3） | `n1n2-claude-060p1r3-report.md`、`n1n2-claude-060p1r3-evidence-gap.md`、`n1n2-claude-060p1r3a-report.md` |

`AGENTS.md` sha256 `37300463…4542b` 未变；**git index 空**；HEAD 未变；**没有** add/commit/reset/
stash/checkout/push。

## 7. 生产缺陷：14 条**全部继续 OPEN**

`OPEN_PRODUCTION_FINDINGS.json` 的 14 条（R3-C01…R3-C09、R3-I01…R3-I05）**一条都没有被本票关闭**。

本票**只在两个新文件里**动了其中两条的**工具侧**部分：

| 编号 | 原描述 | 本票做了什么 | **没有**做什么 |
|---|---|---|---|
| **R3-C02** | nofork pilot 仍把超时当 cleanup 完成、缺异步账本 | **新工具**的账本与 cleanup：超时**只**能产生 `unknown`，error/exit/close 各自独立，close 是**明确对象**的共享 promise，重复 cleanup 共享同一 promise | **没有**动任何生产文件；R3-C02 的**生产侧**部分（R3-C01 的收据快照等）仍在生产文件里，**继续 OPEN** |
| **R3-I05** | 首个 nofork pilot 仍把 timeout 当 close；positive pilot 未登记完整 supervisor owner | **新工具**的 owner 登记：spawn 之前先登记 root、spawn 之后立刻登记 handle/epoch/账本，unknown 时**保留 owner 与 root**并等真实 close | **没有**动 positive pilot（那需要生产 supervisor 的 owner 登记）；R3-I05 的 **positive 部分继续 OPEN** |

**原 17 / ISO-01..18 / N1N2 / NEXT / A057-04 全部不变**，本票**不**关闭其中任何一条。

## 8. NOT_RUN 与风险

| 项 | 状态 |
|---|---|
| 真实 CLI 主入口（`node tools/native-cache-nofork-pilot.mjs …`） | **NOT_RUN**（票内明令不执行） |
| 真实 custodian C / 真实 prctl / 真实 fork / 真实 wait / 真实 signal | **NOT_RUN** |
| 真实 `/proc` 读（在本机上） | **NOT_RUN**（门里是注入的假 `/proc`） |
| 真实浏览器 / 媒体 / Host / HTTP | **NOT_RUN** |
| `tsc` / `vitest` / 全量门 / build / generation | **NOT_RUN**（不在本票的三种许可形式里） |
| 原 17 / ISO-01..18 / 14 条生产发现 / N1N2 / NEXT | **NOT_RUN / 继续 OPEN** |

**风险（真实）**：

1. **纯 mock 门证明的是账本的逻辑，不是内核**。真实 `/proc`、真实 `detached`、真实 SIGTERM/SIGKILL
   与真实 Node 的 `close` 时序**一次都没有跑过**。
2. **Node 的 `close` 语义**（exit 之后还要等 stdio 关）在门里是**假事件**给出的；真实情形里一个
   孙进程持有 stdio 会让 close 迟到——那正是 `unknown` 的情形，而工具会**一直等**，**不会**假装结束。
3. **工具被外部杀死**（例如被 OOM 或被外部 kill）**不是**本工具能解决的：那时账本随进程一起没了。
   这一点写进了工具的文档与本报告，**不**称这里解决了所有进程异常。
4. **`RECOVERY_SECONDS` 已从生产里删掉**（R3A），所以真实运行时那个**没有 N** 的 custodian 会**一直
   持责**；本工具因此**可能**需要对它发 KILL，而 KILL 之后它**没有**任何东西要回收——这是本工具
   **可以**结束它的唯一理由。**这一点必须在真实首跑时被 MAIN 复核。**
5. 场景文件与证据目录在 `var/native-cache-pilot/` 下；**证据 root 作为产物保留**，**没有** afterEach 的
   无脑删除。多次真实跑会留下多个目录。

## 9. 下一步：**准确的两条真实 CLI 调用**（**本票不执行**）

MAIN 过门后，第一次真实 pilot 是**两条**，一条一条来，**单重型槽**：

```sh
# ① 正常：核对身份，然后清理
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
node tools/native-cache-nofork-pilot.mjs \
  --mode identity \
  --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618

# ② 故意断言失败：合法的 HELLO 与 epoch 之后故意抛 EXPECTED_ASSERTION_FAILURE，finally 完整清理
cd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration
node tools/native-cache-nofork-pilot.mjs \
  --mode assertion-failure \
  --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
```

- **cwd**：仓库根（工具会自己核对，不符就**拒绝且不 spawn**）。
- **root**：`var/native-cache-pilot/run-XXXXXX`，工具**自己**建，**先登记**；证据留在那里，**不删**。
- **先登记 owner**：root 在任何后续步骤之前登记；child 的句柄、pid、epoch、账本在 spawn 返回后
  **立刻**登记，在任何 await 之前。
- **故意失败时的清理方案**：② 的失败是**已知**的 `EXPECTED_ASSERTION_FAILURE`；finally 里走**同一条**
  TERM→3s→KILL→15s 的阶梯；**只有**「错误确实是那一个」+「真实 close」+「原 epoch gone」三者同时成立
  才标 `fault-observed`；**任何一条不成立就是 `unknown`**，root 与账本**保留**，工具**等真实 close**并
  写一次 `HELD`。
- **真实运行需要 MAIN 另发的精确许可**（真实 child、真实信号、内核）。**本票不请求、也不执行。**

## 10. 交还

writer 权与资源在本报告完成后交还 MAIN。本波**不**运行真实 pilot，**不**改任何生产文件，
**不**关闭任何生产发现。MAIN 只独立审这两个新文件与这条 nofork case 的安全性；过门后另发实际首跑票。
生产 N 正向与全部 14 条生产发现**需另修另验**。
