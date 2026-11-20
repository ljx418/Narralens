# n1n2-claude-060p5a — R3-C01 与 R3-C03 两个确定性缺陷（仅五个既有路径）

本波是 **MAIN_R5A_TWO_DETERMINISTIC_NORMAL_PATH_FIXES** 的实施波。范围**只有** release 具名的
**五个既有路径**，**没有**新增源文件/脚本/config/contract/路由/EnginePort/事务/预算改变：

| 路径 | 角色 | sha256（本波终态） |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | 生产：收据累积器 | `d6e582b2cf9b21e6eb29646ccc3a9078bdab86d76730a71330e6b4ea98ac7f20` |
| `src/adapters/openfilm/cache-process-custodian.py` | 生产：custodian | `8c7847bc65e9335654d6de571827252f16c5ac9533adff25804474dc1ac7e403` |
| `src/adapters/openfilm/cache-worker-integrity.json` | 生成物：完整性清单 | `43b507e5b3d8bdad41da6a889aa42a44f0eccd9994964e9953a6c8ffa888a0b8` |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | 纯测试 | `1e5032b7fa5ae7a68e033156eefddbac6c985229a02af3a8418dd2a68f214a54` |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | 纯单元 | `77c67215b168c6adfc9344dbd48f2d5c281e656b97973f3f5010ff50f81ef946` |

起始 sha256（release `start_sha256`）：`b561eda7…f07a` / `6b8d6df3…1618` / `9dac431b…4c65` /
`4d3e18f7…3585` / `85b738d0…9347` —— **五条逐字节吻合后才动手**。

**没有** Git 操作（无 add/commit/reset/stash/checkout/push），HEAD 仍是
`1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**；`AGENTS.md` sha256
`37300463…4542b` **未变**；R4/R4A/R4B 的捕获与报告**原处未动**。

## 0. 结论

- **R3-C01（BLOCKER）与 R3-C03（MAJOR）两条都修了**，并各配**实际类/实际方法**的纯 mock 反例：
  accumulator 用**实际的 `CacheReceiptAccumulator`**（不是 `Hash.copy` 本身、不是第二份 oracle）；
  custodian 用**实际的 `_wait_writable` / `_flush_receipt` / `_queue_segment`**（只 mock 底层的
  `select` / `write` / `clock`，**没有** mock 掉 `_wait_writable`）。
- **五个许可命令形式全部先经 recorder**，各跑两次，**全部 exit 0**；**本波没有失败的捕获**。
  第一个**实际变更**捕获是 `n1n2-claude-060p5a-generate-001`（只改了 integrity JSON）。
- **其余 12 条生产 finding、原 17、ISO-01..18、N1N2/NEXT 全部继续 OPEN**；本波**不**关闭其中任何一条，
  也**不**签任何外审、任何内核、任何全量通过。

## 1. R3-C01（BLOCKER）——只读的收据快照把 hash 破坏性终结了

### 1.1 生产行号

| 位置 | 内容 |
|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts:595` | `state()` 的**新**实现 |
| `:600` / `:602` / `:604` | 三个 digest 现在取自 **`copy()`**：`this.#eventsDigest.copy().digest("hex")`、waits、identities 同理 |
| 旧实现 `:584`/`:589`/`:591`/`:593` | `state()` 直接 `this.#eventsDigest.digest("hex")` —— **消费**了 hash |
| 调用点 `:1389`/`:1392`（`inspectCleanup`）、`:2228`/`:2231`（`#receiptEligibility`）、`:2303`/`:2306`（`#proveDomainGone`） | 三处都对**同一个** accumulator 读 `state()` |

### 1.2 旧实现为何会红（本票**不回退旧源、不执行变异**，以下为静态推理）

`Hash.digest()` 会**终结** hash：第二次调用抛 `ERR_CRYPTO_HASH_FINALIZED`，而在第一次 `state()`
之后 `update()` 也会抛。于是正常正向路径——`#proveDomainGone` 读一次 `state()`、`#receiptEligibility`
再读一次——的**第二次**读直接抛出；抛出后 catch 又走 `#fail → #proveDomainGone → state()`，第三次读
再抛，`void #run` 可能在**已发出**的 promise 之外 reject。**即使内核与收据完全正确**，一条小 ASCII 协议
也走不完。

### 1.3 实际分支 mock（**实际类**）

`tests/agent-driven/integration/cache-process-identity.test.ts`：

| 用例 | 行 | 断言 |
|---|---|---|
| 「reads its state again and again, and it never consumes the accumulator」 | `:395` | **空** accumulator 连读两次 → 完全相等；**部分** state 读过一次之后**仍能接受下一段**（`received` 由 1 变 2、`identities` 变 1）；**终态**连读两次 → 完全相等 |
| 「still refuses a segment that arrives out of order, or with a forged digest」 | `:425` | 读过 state 之后，**乱序**仍被拒（`/out of order/`），**伪造 digest** 仍被拒（`/digest/`） |
| 「proves the domain and checks the eligibility on the SAME accumulator」 | `:519` | **同一个** accumulator 上**连续**跑**实际** `validateCacheDomainReceipt`（域证明）→ `validateCacheExecutionReceipt`（成功资格）→ 再一次域证明，**三次都不抛**且都是 `{ok:true}`；并核对 `waits/identities/received` 与三个 digest 与收据一致 |

用例用的是模块**实际导出的** `CacheReceiptAccumulator` 与**实际**的两个 validator；`itemsDigest()`
用模块**实际**的 `canonicalCacheReceiptItem`，**没有**第二份 digest 实现当 oracle。

### 1.4 风险

**真实 N 往返未跑**：本波只证明**读快照不再破坏累加器**，不证明真实内核下的完整正向收据。

## 2. R3-C03（MAJOR）——真实可写等待引用了一个不存在的字段

### 2.1 生产行号

| 位置 | 内容 |
|---|---|
| `src/adapters/openfilm/cache-process-custodian.py:1003` | `self._control_fd = CONTROL_FD` —— **custodian 自己持有**的唯一控制端描述符 |
| `:1004` | `self._control = ControlWriter(self._control_fd)` —— **同一个来源**交给 writer |
| `:1008` | `self._control_read = self._control_fd` —— 读侧也是同一个 |
| `:554` | `ControlWriter.fd` 属性 —— writer **真正**写入的那个描述符 |
| `:2152` | `_wait_writable()` —— 现在 `select.select([], [self._control.fd], [], timeout)`（`:2165`） |
| 旧实现 `:2138`/`:2146` | `select.select([], [self._control_write], [], timeout)` —— **`_control_write` 从未被赋值**，只在 EAGAIN 时才触发 `AttributeError` |

### 2.2 旧实现为何会红（静态推理）

真实控制写遇到 EAGAIN → `_queue_segment`/`_flush_receipt` 调 `_wait_writable` → 读
`self._control_write` → **AttributeError 逃出**，`main` 返回 2 而不是续写；这一分支里裸资源已经被回收，
所以丢的是**结算证明**，不是编造的活儿子。旧单元用 `instance._wait_writable = lambda ...` 把它**替掉**，
于是缺陷被掩盖。

### 2.3 实际分支 mock（**实际方法**，只 mock 底层）

`tests/agent-driven/integration/helpers/cache-custodian-unit.py`（新增 `FakeSelect` `:87`、
`FakeClock` `:115`；两者都只**重绑定 custodian 模块自己的** `select`/`time` 名字，不动全局）：

| 用例 | 行 | 断言 |
|---|---|---|
| 「the wait watches the descriptor of the writer」 | `:952` | custodian 交给 writer 的就是 `CONTROL_FD`；读侧同一个；**`_control_write` 不再存在**；selector 收到的 fd **就是 writer 的 fd** |
| 「a full socket is resumed and the frame goes out whole」 | `:980` | **短写**（8/17 字节）→ **EAGAIN** → **实际** `_wait_writable` → selector 收到 writer 的 fd → 再写时**从 offset 续写**（第一次写整段、第二次写 `body[8:]`）；队列清空、`remaining==0` |
| 「a descriptor that cannot be asked about fails closed」 | `:1024` | selector 抛 `EBADF` → `_wait_writable` 返回 False → `_flush_receipt` **False**，帧仍在队列里 |
| 「a deadline that runs out fails closed」 | `:1045` | 时钟每读一次前进 1000s → **deadline 先到** → `_flush_receipt` **False**，**selector 一次都没被问** |
| 「a segment that cannot be written is not a success」 | `:1070` | 通道里已有写不出去的帧 → **实际** `_queue_segment` 返回 **False**（fail closed） |
| 「the receipt flush waits for a later writable」（**旧用例改造**） | `:896` | 原来是 `instance._wait_writable = lambda`；现在**只 mock select**，走**实际**等待 |
| 「a broken channel is not a success」（**旧用例改造**） | `:934` | 同上：断开的语义不退化 |

测试用的 fd 是**测试自己的本地 fd**（`os.open(os.devnull, O_WRONLY)`），只做**纯 writer 验证**，
**不**进入任何内核目标进程语义；**没有**真实 C、fork、prctl、signal、wait。

### 2.4 风险

真实控制通道背压/续写**未跑**；固定 C 的真实 transcript **未跑**。

## 3. 本波实际执行的命令（**五种许可形式，全部先经 recorder**）

recorder：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`
（sha256 `88cd47ec…fd10`，**未修改**）。前缀 `n1n2-claude-060p5a-`。cwd=W。
**运行时源码冻结**；**没有** recorder 外预跑；**没有**跑其它命令形式。

| capture | argv | exit | log sha256 | `source_changed` | 内容 |
|---|---|---|---|---|---|
| `n1n2-claude-060p5a-tsc-001` | `corepack pnpm exec tsc --noEmit` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 类型绿（**生成清单之前**的字节） |
| `n1n2-claude-060p5a-vitest-001` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | 0 | `c6aac5d1b793e73d91927108b5f833ea9c61596b11018d0c8a135632487f8aff` | `[]` | **61/61 通过**（生成清单之前） |
| `n1n2-claude-060p5a-python-001` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | 0 | `68c22d0f5d5c705baf07da0bad8580be2d5796eea2dcea8cd5f75712992a5a2f` | `[]` | **43 tests OK**（生成清单之前） |
| `n1n2-claude-060p5a-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | `d87001fd40b9fe73141f69c689667025f3f572c9feb17e913a5863bc57e75549` | **`["src/adapters/openfilm/cache-worker-integrity.json"]`** | **首个实际变更捕获**：只写了那一个 JSON（新 custodian `8c7847bc…`、新 supervisor `d6e582b2…`），清单自身 sha256 `43b507e5…` |
| `n1n2-claude-060p5a-check-001` | `node tools/openfilm-cache-worker-integrity.mjs --check` | 0 | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` | `[]` | `{"ok":true,"checked":8}` |
| `n1n2-claude-060p5a-tsc-002` | 同 tsc | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `[]` | 类型绿（**终态字节**：含新清单） |
| `n1n2-claude-060p5a-vitest-002` | 同 vitest | 0 | `37b174aed86c67a85cd6a68504a1788dc7b564e922df8aea5cd4abccd2e4b3ac` | `[]` | **61/61 通过**（终态字节） |
| `n1n2-claude-060p5a-python-002` | 同 python | 0 | `b41815a0b35cc91256ed6ac2723fa8b7f3fd1d202e1f66d740d043fdc2e6b9e3` | `[]` | **43 tests OK**（终态字节） |
| `n1n2-claude-060p5a-check-002` | 同 check | 0 | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` | `[]` | `{"ok":true,"checked":8}`（终态字节） |

**本波没有失败的捕获**（每种形式的**首试**即绿）。后四条（`-002`）是为了让最终捕获的 `inputs.json`
**同时绑定**终态的五个文件（含新生成的清单），消除捕获之间的输入漂移。

**本波没有运行**（票内明令禁止）：真实 C/N、fork、prctl、真实 signal、wait、内核、正常 N pilot、
Host、媒体、浏览器、probe、fullcheck、build、generation 以外的任何写入、网络/下载/付费、J 盘、
用户配置或 env 凭据、用户窗口。

## 4. 保护与未授权文件

- `AGENTS.md` sha256 `37300463…4542b` **未变**；HEAD `1d348d4191…` **未变**；**git index 空**；
  **没有** add/commit/reset/stash/checkout/push。
- 以 R4B 的 25 份受保护基线逐项实测：**只有 release 具名授权的五个路径变了**，**其余没有任何未授权
  变化**（`CHANGED-NOT-AUTHORIZED: NONE`）。
- 其余生产 workspace / upstream / scope / 工具 / 53 个 mock / 旧证据 / 旧报告 **全部未动**。

## 5. 其余 12 条生产 finding：继续 OPEN

`OPEN_PRODUCTION_FINDINGS.json` 的 14 条里，本波**只**动了 **R3-C01** 与 **R3-C03** 两条（自验证，
非外审）；**其余 12 条一条都没有被关闭**：

| id | 级别 | 标题（未改） |
|---|---|---|
| R3-C02 | MAJOR | nofork pilot 仍把 timeout 当 cleanup 完成、缺异步启动 owner |
| R3-C04 | MAJOR | 资源终局证明仍拒绝合法的失败启动，无法调和 preHELLO 失败 |
| R3-C05 | MAJOR | 未知 N identity 可能跳过升级，活着的 TERM-ignore 域不可恢复 |
| R3-C06 | MAJOR | digest/count 相同仍不校验真实 wait/identity 语义 |
| R3-C07 | MAJOR | 诊断记账在结算一开始就停止 |
| R3-C08 | MAJOR | identity 预算失败变成不可逆的持责，即使所有子进程都结束 |
| R3-C09 | MINOR | 被收养的 TERM-ignore helper 在 leader 离开前没有 ready/liveness 屏障 |
| R3-I01 | MAJOR | 普通拒绝与真实失败拿不到完整阶段凭证，永久占住 whole-production scope |
| R3-I02 | MAJOR | 原生成功但 tree release 失败仍提前 reject，绕过原 promise barrier |
| R3-I03 | MAJOR | reconcile 把 release 的幂等 no-op 当成 fresh tree 结束证明 |
| R3-I04 | MAJOR | direct bridge 的 handle 在 await 获准后才创建，未进入可恢复 map |
| R3-I05 | MAJOR | 首个 nofork pilot 仍把 timeout 当 close；positive pilot 未登记完整 supervisor owner |

**原 17 / ISO-01..18 / N1N2 / NEXT / A057-04 / 全量门**全部不变，本波**不**关闭其中任何一条。
**本波不签外审、不签内核、不签生产通过。**

## 6. nofork 两 case 的真实结果：仍是**旧字节**的历史证明

MAIN 的 `MAIN_COMBINED_VERDICT.json`（`pilot-060p2a-nofork/`，2026-11-15）确实收了 nofork 的两个真实
case：正常 exit 0、故意断言失败 exit 1、C 真的 exit/close/gone、649 个输入全部匹配。**但那份验收绑定
的是当时的 custodian sha `6b8d6df3…1618` 与 supervisor sha `b561eda7…f07a`。**

**本波把这两个生产文件的字节改了**（custodian → `8c7847bc…e403`，supervisor → `d6e582b2…7f20`），
所以**那份真实验收是旧字节的历史证明，不冒充新源的全验收**。**未来任何真实 N 正向门都需要一份新的
完整基线 hash**（新的 custodian/supervisor 字节 + 新清单 `43b507e5…`），并且要重新绑 649 输入。

## 7. NOT_RUN 与风险

| 项 | 状态 |
|---|---|
| 真实 N 正向往返（正常 N + 故意断言失败） | **NOT_RUN**（本票不授权） |
| 真实 C / fork / prctl / signal / wait / 内核 | **NOT_RUN** |
| 真实控制通道背压与续写 | **NOT_RUN**（门里是注入的 select/write/clock） |
| 正常 N pilot / Host / 媒体 / 浏览器 / probe | **NOT_RUN** |
| fullcheck / build / 全量门 / tsc 之外的类型面 | **NOT_RUN**（`tsc --noEmit` 已过，但**不等于**全量门） |
| 原 17 / ISO-01..18 / 其余 12 条生产 finding / N1N2 / NEXT | **NOT_RUN / 继续 OPEN** |

**风险（真实）**：

1. **两条修复都是「确定性缺陷」级**：它们解释的是「为什么正常路径根本走不完」，**不是**内核语义。
   真实 N 往返仍是**未跑**的下一道门。
2. `Hash.copy()` 是 Node 的**深拷贝**状态快照：它**不**终结原 hash，原 hash 仍可继续 `update()`。
   这条语义由 @types/node 文档给出，但**真实调用**只在门里跑过（vitest 61/61）。
3. custodian 的 `_wait_writable` 现在等的是 **fd4（控制端）**；fd4 是**同一端**既读又写的 socketpair 端，
   这与旧代码「读一个不存在的字段」不同，但**真实 socketpair 上的可写语义未跑**。
4. 完整性清单已随字节更新（`43b507e5…`）。**任何**持有旧清单 sha 的旧证据**不再**描述当前字节；
   本波**没有**改任何旧报告或旧捕获，它们各自记录的是当时的字节。
5. `FakeSelect`/`FakeClock` 只**重绑定 custodian 模块自己的** `select`/`time` 名字并在 finally 里**还原**，
   没有全局打补丁；但它们确实**替换了模块的名字空间**，真实 `select` 的行为**未跑**。

## 8. 下一步

按 `REMAINING_EXECUTION_PLAN.md`：**R5B** = 修 **R3-C04**（失败 exec / 无 birth 的资源终局）与
**R3-C05**（无初始 identity 时的持责升级），并补 **positive N** 的完整 owner/handle/finally
（含 R3-C02 / R3-I05 的工具侧未修部分）；先做**实际最小正常 C→N 合成协议往返**与**故意断言失败清理**，
再各负例。**不能杀可能已拥有 N 的 C。**

R5B 之前，MAIN 需要**定点复核本波这两个生产文件的精确字节**与本报告；**真实 N 正向门需要新的完整
基线 hash**，不能用 nofork 的旧 sha 顶替。

## 9. 交还

writer 权与资源在本报告完成后交还 MAIN。本波**不**运行真实 N pilot，**不**改任何未授权文件，
**不**关闭除 R3-C01/R3-C03 外的任何 finding，**不**自签外审。生产 N 正向与其余 12 条生产发现
**需另修另验**。
