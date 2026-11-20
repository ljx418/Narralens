# n1n2-claude-060p1r2 — 证据缺口与历史更正

本文件是 `n1n2-claude-060p1r2-report.md` 的**附属**证据说明。它**不覆盖**任何旧报告：
`n1n2-claude-060p1-report.md`、`n1n2-claude-060p1r-report.md`、两位的 `REVIEW.md`/`FINDINGS.json`
与所有旧 capture 都**原样保留**。这里只**补记**缺口，并**更正**两处历史说法。

- release_id: `MAIN_RELEASE_060P1R2_CONSOLIDATED_REPAIR`
- task_id: `task_4ba8760231b0` / dispatch_id: `ctx_c79af5ef24d4`
- recorder: `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`
  （sha256 `88cd47ec…fd10`，与 release 一致，**未修改**）

## 1. 四次**未记录**的开发期失败

| 波次 | 次数 | 状态 | 证据 |
|---|---|---|---|
| 060P1（旧） | **2** | **UNRECORDED / UNKNOWN** | 原命令、原 exit、原时刻、原日志路径、原 inputs **均未留存** |
| 060P1R（上一波） | **2** | **UNRECORDED / UNKNOWN** | 同上；整合审查已指出并搜索过，本波再次搜索，仍**找不到** |
| 060P1R2（本波） | **3** | **已记录** | 见 §3，全部原处保留 |

### 1.1 本波的实际搜索（只读，未新增任何文件）

在 recorder 的 capture 目录 `docs/execution/A/implementation-20261111/integration/e1-main-takeover/`
里，与 `060p1*` 前缀相关的结果文件共 **19** 份：

```
n1n2-claude-060p1-generate-001        exit=0  changed=[src/adapters/openfilm/cache-worker-integrity.json]
n1n2-claude-060p1-integrity-check-001 exit=0  changed=[]
n1n2-claude-060p1-m21-lock-001        exit=0  changed=[]
n1n2-claude-060p1-scheduler-001       exit=0  changed=[]
n1n2-claude-060p1-syntax-policy-001   exit=0  changed=[]
n1n2-claude-060p1-syntax-worker-001   exit=0  changed=[]
n1n2-claude-060p1-typecheck-001       exit=0  changed=[]
n1n2-claude-060p1r-custodian-syntax-001           exit=0  changed=[]
n1n2-claude-060p1r-generate-001                   exit=0  changed=[]        ← 见 §2.2
n1n2-claude-060p1r-identity-001                   exit=0  changed=[]
n1n2-claude-060p1r-integrity-check-001            exit=0  changed=[]
n1n2-claude-060p1r-m21-lock-001                   exit=0  changed=[]
n1n2-claude-060p1r-scheduler-001                  exit=0  changed=[]
n1n2-claude-060p1r-syntax-policy-001              exit=0  changed=[]
n1n2-claude-060p1r-syntax-probe-fixture-001       exit=0  changed=[]
n1n2-claude-060p1r-syntax-worker-001              exit=0  changed=[]
n1n2-claude-060p1r-syntax-worker-fixture-001      exit=0  changed=[]
n1n2-claude-060p1r-typecheck-001                  exit=0  changed=[]
```

**19 份全部 exit 0。** 也就是说：那四次失败**根本没有留下任何 capture**——没有 `.txt`、没有
`.exit`、没有 `.cmd.json`、没有 `.inputs.json`、没有 `.result.json`。在
`docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/`
下按 `*060p1*` 搜索亦**无任何文件**。

**因此**：那四次失败的原 argv、原时刻、原日志内容、原失败原因**一律记 UNRECORDED / UNKNOWN**。
本波**不编造**它们的命令、退出码或日志，也**不用**后面成功的 capture 去冒充它们。
唯一可以确定的是：**它们发生在 recorder 之前或之外**（否则会有 capture），因此**不可复原**。

### 1.2 为什么这四次失败不可复原

recorder 在写 `.claim.json` 时用 `open("x")` **独占创建**，并在 capture 已存在时以
`CAPTURE_NAME_ALREADY_EXISTS` 拒绝。这意味着**任何一次经过 recorder 的运行都必然留下六个文件**。
四次失败没有留下文件，因此它们**从未经过 recorder**。这是事实陈述，不是推测。

## 2. 两处历史说法的更正

### 2.1 IR10：旧 identity 轻量门**真的启动过解释器**，旧报告"零真实进程"**不实**

旧的门（`tests/agent-driven/integration/cache-process-identity.test.ts` 的 `starts a draw only once`）
调用了 `owner.start(handle)`。`start` → `#run` → `spawn(...)`，参数是**固定**的
`/usr/bin/python3.12 -I -S -B /nonexistent/custodian.py`。

事实（如实，不补造）：

- **真的**有一个 `/usr/bin/python3.12` 进程被启动，并且**真的**因为找不到
  `/nonexistent/custodian.py` 而失败退出；
- **目标 custodian 没有运行**：`cache-process-custodian.py` 的字节**没有被执行**，
  `prctl` / `fork` / `setsid` / `wait` / `signal` **一次都没有发生**；
- **child 的 PID 与 close 没有被记录**：旧用例没有断言它们，recorder 的日志里也没有它们，
  因此它们的值**不可复原**，记 **UNKNOWN**；
- 因此旧报告里"零真实进程""没有任何真实 spawn"的说法**不成立**。

**本波的更正与做法**：

- 本波把 spawn **局部 mock 掉**（`vi.hoisted` + `vi.mock("node:child_process")`），
  被 mock 的实现**直接抛错**，因此纯用例**不可能**启动任何进程；
- 不启动 draw 的用例**显式断言 `expect(spawnMock).not.toHaveBeenCalled()`**；
- 唯一会 `start` 的用例断言 **`spawnMock` 恰好被调用 1 次**、**argv 固定**、
  **`detached === true`**、**子进程的 HOME 是私有目录而不是 Host 的 HOME**——
  也就是说，"确实走到了 spawn 入口"是被**断言**的，而"没有真的启动进程"是由
  mock **保证**的；
- **本波没有启动过任何进程**：唯一的 Python 运行是 `-I -S -B` 的 `unittest`（不 fork），
  唯一的 Node 运行是 `node --check` 与 vitest（纯测试）。

### 2.2 生成清单：上一波是**同字节重复**，本波才是**第一次实际生成**

| capture | argv | exit | `source_changed` | 说明 |
|---|---|---|---|---|
| `n1n2-claude-060p1r-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | **`[]`** | **同字节重复**：命令确实执行、确实写了那一个路径，但写出的清单与已有清单**逐字节相同**，所以 recorder 报"没有源变化" |
| `n1n2-claude-060p1r2-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | **`["src/adapters/openfilm/cache-worker-integrity.json"]`** | **本波这些字节的第一次实际生成**：产物 sha256 `6489c739…c27a4a`，捕获**如实记录到了真实的变化** |

**更正**：上一波报告 §3 的说法是"本次会话中，在最后一次改动任何被清单覆盖的文件之后，
本票允许的 `--generate` 已经生成过一次清单……因此 recorder 报 `source_changed=[]`"。
那句话**在字面上成立**，但它**容易被读成"捕获到了一次真实生成"**——事实是**那次捕获没有记录到
任何变化**。本波把这件事**分清**：本波的生成捕获里 `source_changed` **恰好只有**那一个 JSON，
是**可核对的真实生成**，而不是重复。

**本波没有提前偷偷生成**：生成动作在**所有源码修改完成之后**才执行，且**只执行了一次**
（`n1n2-claude-060p1r2-generate-001`）；随后的 `--check`（`n1n2-claude-060p1r2-final-integrity-check-001`）
在同一批字节上 exit 0。清单**不含自己**，工具**只写那一个 JSON**。

## 3. 本波的全部失败（**已记录**，原处保留）

| capture | argv | exit | 失败内容与处置 |
|---|---|---|---|
| `n1n2-claude-060p1r2-typecheck-001` | `corepack pnpm exec tsc --noEmit` | **2** | 7 条类型错误：`ScopeFacts` 无 `root` 字段；`lastProductionResponsibility` 返回 `\| undefined` 而代码按 `null` 判空。**已修**：`cache-production-scope.ts:559` 改用 `scope.root`；`openfilm-upstream.ts:1657` 改为 `?? null` |
| `n1n2-claude-060p1r2-custodian-unit-001` | `python3.12 -I -S -B tests/…/cache-custodian-unit.py` | **1** | `test_a_short_write_keeps_the_tail_of_the_frame`：`AssertionError: 0 != 3`。**是测试的假写入器**每次写满，第一轮 `flush()` 就写完了整帧，看不到中间态。**已修**：假写入器改为"第一次短写 7 字节 / 第二次 EAGAIN / 第三次写完"。**生产代码未改** |
| `n1n2-claude-060p1r2-scheduler-001` | `vitest run … cache-production-scope.test.ts` | **1** | `refuses a phase lease of another owner…`：`expected null not to be null`。**是用例**先开了一次 `parent_drain` 租约却没 settle，第二次开租约按设计返回 null。**已修**：用例改为持有并 settle 同一份租约。**生产代码未改** |

三份 capture 的 `.txt`（原始日志）、`.exit`、`.cmd.json`、`.inputs.json`、`.result.json`、
`.claim.json` **全部保留**，未覆盖、未删除。

## 4. 本波**唯一**一次未经 recorder 的运行（如实承认）

在记录 `n1n2-claude-060p1r2-syntax-worker-fixture-001` **之前**，我**在 recorder 之外**先跑了一次：

```
node --check tests/agent-driven/integration/helpers/cache-worker-fixture.mjs
```

- 结果：**exit 0**，无输出；
- 副作用：**无**（`--check` 只做语法解析）；
- 该命令**本身**在 RELEASE.json 的 `allowed_runtime` 里；
- 但它**没有被 recorder 记录**，因此按本票规则记为 **UNRECORDED**；
- 之后的 `n1n2-claude-060p1r2-syntax-worker-fixture-001` 与
  `n1n2-claude-060p1r2-final-syntax-worker-fixture-001` 两次捕获都对**最终字节**成立。

这是本波**唯一**一次"先跑确认再记录"。本波其余全部开发运行（语法、类型、纯单元、纯 vitest、
生成）**都先经 recorder**，包括上面 §3 的三次失败。

## 5. 本波**没有**做的事（与"证据缺口"同样重要）

- **没有**运行真实 custodian / prctl / fork / setsid / waitid-waitpid / signal / 故障 child；
- **没有**运行 HTTP / Host / Chrome / ffmpeg / ffprobe / 媒体；
- **没有**运行 `cache-custodian-lifecycle.test.ts`、`cache-process-settlement.test.ts`、
  `cache-frame-duration-lifetime.test.ts`、`cache-serving-drain.test.ts`、
  `native-cache-witness.test.ts`、`created-native-source-reader.test.ts`；
- **没有**运行 fullcheck / build / Python golden；
- **没有**联网 / 下载 / 安装 / 付费 / 读 J 盘 / 读凭据 / 读 `.env` / 读全量 env；
- **没有** `git add` / `commit` / `reset` / `stash` / `checkout` / `push` / `merge`；
- **没有**写 `docs/parallel/lane-product/A-R2-20261112/N1N2-native-source` 之外的 OWN 目录，
  **没有**写 recorder 目录之外的任何证据目录；
- **没有**改 `AGENTS.md`、正式 render、V、Approved015、公共合同、源事务、
  `created-native-source-reader.ts`、`cache-serving-drain.test.ts`、`cache-worker-policy.mjs`、
  `tools/openfilm-cache-worker-integrity.mjs`、`native-cache-witness.test.ts`、
  `created-native-source-reader.test.ts`、`tests/m2.1/openfilm-upstream-lock.test.ts`
  （这些文件的字节**未变**，哈希见报告 §2）。

因此本波**没有**任何"运行期"证据：所有关于真实进程、真实收据、真实回收的陈述都是**代码级论证**，
并且在报告 §5 里逐项标为 **NOT_RUN**。
