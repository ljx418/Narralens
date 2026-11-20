# n1n2-claude-060p5i — R5I 真实 normal 模式失败：终局通道顺序的最小修复

本文件是 R5I（`MAIN_R5I_NORMAL_TRANSPORT_ORDERING`，SPEC sha256
`072f69fd63d63ca002b739be879730b1fd09e7d10238eabbcabf3b87ef4e95da`）的 OWN 报告。
本轮关闭**真实 normal CLI 的第一次失败**（`n1n2-main-060p5h-real-normal-001`，outer exit **1**、
`CHANNEL_ERROR` / `read ECONNRESET`、无图），方式是：**先写精确纯反例验证终局通道顺序，再做最小修复**；
同时**顺手关闭已披露的 R5H-O01 MINOR**（null-baseline 参数化 tuple 的目标与标签一致）✓。

HEAD 仍是 `1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**，**没有** add/commit/push/
merge/reset/stash/checkout ✓。本轮只改了 `src/adapters/openfilm/cache-process-supervisor.ts`、
`src/adapters/openfilm/cache-worker-integrity.json`（`--generate` 重生）、
`tests/agent-driven/integration/native-cache-normal-pilot.test.ts` 与本报告 ✓；其余五份既有文件
**逐字节未变** ✓（见 §5）。**没有**新建源码文件 ✓。

## 0. 边界（如实声明）

- **只**执行了 `RELEASE.json` 的六种 recorder 命令形态，全部经
  `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`，
  capture 前缀 `n1n2-claude-060p5i-`；**没有** timeout 包裹 recorder、**没有**造 PID/exit、
  **没有**覆盖任何已有 capture。
- **没有**执行真实 C/N、真实 CLI/pilot、Host/Chrome/媒体/网络/付费、Q2、全量门、build、
  **混合 lifecycle 测试文件**（`cache-custodian-lifecycle.test.ts` **只 typecheck、不可执行**）、
  J 盘、Git 变更、凭据/CLI 配置。
- **真实 normal-001 的 runtime root 保留未动**：
  `var/native-cache-positive-pilot/run-zfJOqD`（candidate/final/manifest/helper.events 全部**只读** ✓，
  **没有**删除任何 evidence，**没有**手工改它的内容 ✓）。
- **没有**屏蔽 ECONNRESET/EPIPE、**没有**把错误降级为 warn、**没有**吞错误、
  **没有**把「资源清理证明」当成成功 ✓；**没有**改生产 deadline、**没有**继续加 20s 预算、
  **没有**改断言求绿 ✓；**没有**改 protected fixture ✓（它不是补时序的地方 ✓）。
- 原 pure guards **没有**弱化 ✓；C 的 sole-wait owner、原 group/identity/revoked authority、
  unknown 持有原 promise、normal 无自取消、first error 不变、one CANCEL、replacement PID 保护、
  最终实际 byte checker 与完整事实合同 **全部保留** ✓。
- 本报告**只是内部自验证**：**不**自签真实 normal/fault、N1N2、R6/R7/R8、原 17+ISO18、
  冻结审查、NEXT、V1 ✓。

## 1. 已证实的事实与仍属推断的部分（严格区分）

### 1.1 真实失败里**已证实**的事实（来自保留的 evidence）

| 事实 | 证据位置 |
|---|---|
| outer exit **1**，`CHANNEL_ERROR`：`The control channel of the custodian failed: read ECONNRESET` | `pilot-060p5h-real-n/normal-001/FAILED_ACCEPTANCE.json` |
| **没有图**：`picture_sha256=null`、`picture_bytes=null` | 同上 + 该 root 的 `final.json` |
| **Host 确实发了 CANCEL**：`observed_signals = ["CANCEL:custodian:the draw channel closed", "exit:code 0"]` | 该 root 的 `final.json` → `diagnostic_snapshot.observed_signals` |
| **收据真的到了**：receipt_summary 是 `DOMAIN_REAPED`（seq 4，state `receipt_flush`） | 同上 |
| **终局证明是真的**：custodian/worker 原 epoch 与 group 全部 `gone` | 同上 + `terminal_proof_observations` |
| **helper 从未收到 FINALIZE**：events 只有 `scenario`/`go`/`answered`，**没有** `finalized` | 该 root 的 `cache-worker-fixture.events` |
| C 与 N 确实出生过，之后二者原 epoch 均不存在、两原 group 只读 0 探测均 **ESRCH**、MAIN 未发任何破坏性信号 | `FAILED_ACCEPTANCE.json` + `OBSERVER.json`（`destructive_signals_sent: []`） |

### 1.2 由**实际代码**证实的事实（本轮的纯反例）

用已批准的 **实际 supervisor + 协议回调 fake** 跑出的**实际 control 写序列**（诊断捕获
`n1n2-claude-060p5i-pilot-002` 的日志原文）：

```
CONTROL_WRITES:["AUTHORIZE_FORK","FINALIZE","CANCEL"]
```

⇒ **旧代码在 FINALIZE 已授权之后仍然补发了一次 CANCEL** ✓（这是**已证实**的代码行为 ✓）。
fixture 的 `finalized` 事件只在它**收到** FINALIZE 时才写 ⇒ 真实运行里 **Host 从未发出过 FINALIZE**
（§1.1 的 events 证实 ✓）⇒ 真实运行里 CANCEL 之前的候选**没有完成** ✓。
 custodian 的循环（`cache-process-custodian.py:2324`）在收到 `FINALIZE` **或** `CANCEL` 时终止 ✓
⇒ 真实运行里 custodian 是被**那次 CANCEL** 终止的 ✓（收据与 exit 0 与此一致 ✓）。

### 1.3 仍然**只是推断**的部分（不当作已证实根因）

- 真实的**帧顺序没有被保存**（`OBSERVER.json` 只保存了 recorder 的结果与采样，没有原始控制帧）⇒
  「ECONNRESET 的方向」（是 Host 向已关闭的 socket 写入触发 RST，还是 custodian 退出时接收队列
  仍有未读字节）**无法从保存的 evidence 判定** ✓；
- 因此本报告**不**宣称「ECONNRESET 的根因已证实」✓；
- 旧 5s/20s mock 超时的根因**仍然未知** ✓：本轮的通过**不**证明它的根因 ✓
  （观察：在旧逻辑的 mutant 下，ORCHESTRATION 例**曾经**在 20000ms 处超时过一次，
  而在新逻辑下它稳定通过 —— 这是一个**观察**，**不是**旧超时的根因证明 ✓）。

## 2. 最小修复

`src/adapters/openfilm/cache-process-supervisor.ts:2397`（`onDrawEnd`）：

```ts
      const failure = cacheDrawEndFailure(facts.finalizeAfterOk);
      if (failure !== null) this.#latchFailure(facts, failure.code, failure.message);
      // The CANCEL is a COMMAND, and it is sent only when the draw ended
      // WITHOUT the finalisation being authorised: ...
      if (failure !== null) {
        this.#requestCustodianCancel(facts, controlChannel, "the draw channel closed");
      }
```

- **只**改「draw EOF 之后还要不要补发 CANCEL」这一件事 ✓；
- 条件与 `cacheDrawEndFailure(finalizeAfterOk)` **同一个事实** ✓：finalization 未授权 ⇒ 失败 **且**
  补发 CANCEL（custodian 可能还在读控制通道，必须由它停掉 domain ✓）；已授权 ⇒ **不**补发 ✓
  （custodian 正在自己收尾，**不**接受命令 ✓）；
- **没有**重写 custodian 算法或协议 ✓；**没有**改 protected fixture ✓；**没有**换引擎 ✓；
- 未授权 EOF、closed:false/fatal/半帧、foreign receipt、genuine reset-before/after candidate、
  延迟 close、fault 同原 Error 等**既有纯反例全部保留** ✓（identity 87、python 59、pilot 264 全绿 ✓）。

## 3. 逐 key/case → 代码 → actual consumer → recorded 证据

| 合同义务 | 代码 | actual consumer | 测试 | recorded 证据 |
|---|---|---|---|---|
| **已授权的终局不得补发无意义 CANCEL** | `cache-process-supervisor.ts:2397`（`onDrawEnd`） | actual main / legacy / pure **同一个** `verifyPublishedRun`；control 写序列由 **实际 supervisor** 产生 | `the ORDER of the terminal channels of a draw > does NOT send a CANCEL when the finalisation was already authorised`：实际 control 写序列恰为 `["AUTHORIZE_FORK","FINALIZE"]` ✓，run `ok`/exit 0 ✓、图 1024 字节 ✓、terminal proof ✓ | `…-pilot-006`/`…-pilot-010`、`…-final-pilot`（exit 0） |
| **未授权 EOF 必须失败并由 owned cleanup 收尾** | 同上（`failure !== null` 分支） | 同上 | `… > sends the CANCEL and FAILS when the draw ended WITHOUT the finalisation`：实际写序列**含** `CANCEL`、**不含** `FINALIZE` ✓；run `failed` ✓、无图 ✓、有 original failure ✓ | `…-pilot-010`、`…-final-pilot` |
| **真实 ECONNRESET/EPIPE/child error 在 candidate 后即使有收据也仍须失败** | 未改：CHANNEL_ERROR 仍然 latch ✓；未吞、未降级 ✓ | 同上 | 既有 `the reporting over a REAL destination` 与 identity 的通道错误用例**全部保留** ✓ | `…-final-identity`、`…-final-pilot` |
| **R5H-O01 MINOR：null-baseline tuple 直接带真实 field key 并实际使用，断言 target 与 label 一致** | 生产门**未改**（已静态正确 ✓） | 同上 | `the run WITHOUT a snapshot`：tuple `NULL_BASELINE_FIELDS` 带 `[id, record, where, field]`，用例先 `expect(id).toBe(\`${where}.${field}\`)` ✓ 再**按 field** 删除/改型 ✓ | `…-pilot-010`、`…-final-pilot` |
| **四个摘要字段各覆盖 delete / undefined / wrong type / 合法 non-null object** | 同上 | 同上 | `the run WITHOUT a snapshot` 的 4 字段 × 4 类 = **16** 条 ✓（`…is missing`/`…is explicitly undefined`/`…has the wrong type`/`…carries a legal object`）✓ | 同上 |
| **显式 null 的 ordinary 1 正控不变** | 同上 | 同上 | `keeps it reliable, not accepted, and at the exit code 1`（helper 已拷贝后 `createSupervisor` 抛普通 Error ⇒ root/helper/三记录完整、snapshot 为 null ⇒ reliable=true / accepted=false / **1**）✓ | 同上 |

### 3.1 安全红灯：新增反例在**旧逻辑**下确实失败

`n1n2-claude-060p5i-pilot-oldlogic-red-002`（exit 1，**1 failed / 263 passed**）：把 `onDrawEnd` 的
条件**临时**换成旧逻辑（CANCEL 无条件补发），**只有**新反例
`does NOT send a CANCEL when the finalisation was already authorised` 失败 ✓（实际写序列多了 `CANCEL` ✓）。
跑完后 supervisor **按 sha256 逐字节还原** ✓（`sha256sum -c` 通过 ✓）。

**准确表述**：这是一个**行为 mutant**（把一处条件换成旧语义），**不是**存档历史的逐字节重放；
只说明**该 mutant 让这一条断言失败** ✓。

## 4. 失败索引（全部保留，未覆盖、未补造）

| capture | exit | 含义 |
|---|---|---|
| `…-pilot-001` | 0 | 诊断用例（真实 control 写序列）✓ |
| `…-pilot-002` | 1 | 诊断用例误用了 realFsDeps（pin 不符）→ 已改用 realDeps ✓ |
| `…-pilot-003` | **1** | 新增用例的一处**语法/括号**问题（套件没有收集到用例：`Tests no tests`）→ 已改 ✓ |
| `…-pilot-004` | 1 | ORCHESTRATION 例因**测试隔离**而红：我的新用例先跑，把 fake 的 `procOverride.gone` 留下 ⇒ 后面的例读到「已消失」的 epoch ✓ → 已在新 describe 里加 `beforeEach` 清表 ✓（**没有**动生产 ✓） |
| `…-pilot-005` | 1 | 同上的隔离问题 ✓ |
| `…-pilot-006` | 0 | 隔离修好后的绿 ✓ |
| `…-pilot-007` | 1 | 未授权 EOF 例在 5000ms 处**超时**：fake custodian 没有真的离开，owned cleanup 等到真实 deadline ✓ → 已改为「silent 场景 + 明确 close()」，使该例**确定**且快速 ✓（**没有**加预算 ✓） |
| `…-pilot-008` / `…-pilot-009` | 1 | 未授权 EOF 例的候选完成与 draw end 的**竞态**（+20ms 让候选先完成 ⇒ 变成已授权分支）→ 已用 silent 场景消除该竞态 ✓ |
| `…-pilot-010` | 0 | 全绿（264）✓ |
| `…-pilot-oldlogic-red` | **1** | 旧逻辑 mutant：1 条新反例失败 ✓ |
| `…-pilot-oldlogic-red-002` | **1** | 同一 mutant 的最终捕获（1 failed / 263 passed）✓ |
| `…-final-*` | 0 | 最终六命令 ✓ |

### 4.1 更早的失败与 INCOMPLETE（原样保留，本轮**没有**触碰）

| 名称 | 状态 | 说明 |
|---|---|---|
| `n1n2-claude-060p5h-real-normal-001` | **真实失败，保留** | outer exit 1；CHANNEL_ERROR/ECONNRESET；无图；C/N 确实出生过且之后原 epoch 与 group 均 ESRCH；**MAIN 未发破坏性信号** ✓；其 runtime root **保留未动** ✓ |
| `n1n2-claude-060p5d-red-python-002` | exit 1，**一次真实越界** | 真实 `os.kill(200, SIGTERM)`；**事后 PID 不存在不能证明当时没有影响** ✓；本轮**没有**重跑 ✓ |
| `n1n2-claude-060p5d-red-python`、`-red-python-003`、`-red-python-004`、`-red-identity`、`-red-pilot`、`-red-tsc` | exit 1 / 2 | 旧红灯，原样保留 ✓ |
| `n1n2-claude-060p5d-fix-pilot-004` | exit 1 | **MAIN 的精确停止**（卡住的测试），**不是**自然超时 ✓ |
| `n1n2-claude-060p5d-fix-pilot-005` | **INCOMPLETE** | 缺 `.exit` / `.result.json`；本轮**没有**补造 ✓ |
| `n1n2-claude-060p5e-*`、`…-060p5f-*`、`…-060p5g-*`、`…-060p5h-*` | exit 1 / 2 | 既有波次中间态与**故意**红灯（含各次 mutant 捕获），原样保留 ✓ |

**没有**补造任何 PID、exit 或日志；**没有**伪造 raw segments；**没有**任何「当时无影响」的结论 ✓。

## 5. 最终八文件 hash

| 路径 | sha256 | 与 R5I `start_sha256` |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | `c697636065d6f9c88c806f23eb5cd75d88c1bd9b70ea61b385da41382ff7b755` | **已变**（`onDrawEnd` 的最小修复：已授权的终局不补发 CANCEL） |
| `src/adapters/openfilm/cache-process-custodian.py` | `bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79` | **逐字节未变** ✓ |
| `src/adapters/openfilm/cache-worker-integrity.json` | `c39d7e47d67f7d19a0fb9303271c4e3ad6e06dbe1c3dbc375107e8d88dba071a` | **已变**（`--generate` 重生，只改这一个文件 ✓） |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | `d4e60d2d81c78c3c01e62d7bec232a4371cf81b9426ae13ecdf77c91c90ad8bf` | **逐字节未变** ✓ |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `f35721741cb62afc946b84c507d029ff16746c739d5b63b0335f49d7855efa61` | **逐字节未变** ✓ |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | `230cbf8882e903a8752d663d2ff58f7cc729d5ab6e129ec2e566ba15a8077258` | **逐字节未变** ✓ |
| `tools/native-cache-normal-pilot.ts` | `e4db3499f715d5b6b5634568677a6688cf80a897c9321c45e93cda98c6a19ebb` | **逐字节未变** ✓（R5H 的 tool 已静态正确，本轮**没有**为迁就错 label 改生产 ✓） |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | `63a5a2e25f618f634ec1c5f59583ecc413b1d86a62c4330850731c301439e2a4` | **已变**（两条终局顺序反例 + null-baseline tuple/四类覆盖 + 隔离） |

**保护七文件**：逐项实测**全部 MATCH** ✓。

## 6. 最终捕获（同一最终源字节，`source_changed` 全部为 `[]`，651 个输入文件零漂移）

| capture | 命令 | exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-060p5i-final-integrity-generate` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | **0** | `44da36f58b93eb2a22892f573732802f45cf8ed57d6031dfaffa0e5318ccfa54` |
| `n1n2-claude-060p5i-final-tsc` | `corepack pnpm exec tsc --noEmit` | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `n1n2-claude-060p5i-final-identity` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | **0** | `f1ec31827ccd8d5662535012b41d0d2dd847158672b38089949791becb5bda2e` |
| `n1n2-claude-060p5i-final-python` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | **0** | `1aa0ede09d92b87760bb502ce84ed6c4f7db5939222ec68ee3ee84cbdb1fb3ec` |
| `n1n2-claude-060p5i-final-pilot` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | **0** | `7ebb56094362c11cc1e34db00706ccdf68aa2e09853fd8ea321eaced80ea298b` |
| `n1n2-claude-060p5i-final-integrity-check` | `node tools/openfilm-cache-worker-integrity.mjs --check` | **0** | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` |

测试规模：identity **87 passed**（未变）、python **59 passed**（未变）、pilot **264 passed**（254 → 264）✓。

## 7. 勘误（相对 R5H 报告；**旧报告不覆盖** ✓）

1. **R5H 报告 §4 的 final key 数写成了 28**：实际是 **27**；三份主记录的关键总数是 **54**
   （candidate 19 + manifest 8 + final 27）✓。本报告以 **final 27 / 主记录总 54** 为准 ✓；
   R5H 的工具实现里的表**本来就是 27** ✓（本轮**没有**改动那张表 ✓）。
2. R5H 的 null-baseline 用例的 tuple 标签与实际改动的字段**可能不一致**（MINOR）✓
   —— 本轮已修：tuple **直接带真实 field key**、用例按该 key 改、并断言 label 与 target 一致 ✓。

## 8. 已知限制（如实声明）

1. **内部自验证**：不构成独立受影响安全复核，也不构成真实 normal/fault/N1N2/R6/R7/R8/17+18/冻结/NEXT/V1 的验收 ✓。
2. **真实 normal-002 尚未跑**：本票**没有**任何真实 N/CLI 执行许可；修复的**效果**目前只有
   **纯反例与 mutant 红灯**支持 ✓，真实 normal002 需 MAIN 另发**精确 pin** 的票 ✓
   （本票**不**跳过失败门，**不**先开 fault ✓）。
3. **ECONNRESET 的方向未证实**（§1.3）✓；本修复针对的是**已证实**的代码行为
   （已授权的终局仍补发 CANCEL ✓）与它**可解释**的真实链路上的一环 ✓，
   **不**宣称它是已证实的根因 ✓。
4. **旧 5s/20s mock 超时根因仍未知** ✓；本轮**没有**把它说成已关闭 ✓；
   `afterEach` 清表**不等于**等待旧 promise 已终结 ✓（该局限照旧保留 ✓）。
5. **混合 lifecycle 文件只 typecheck**：legacy 消费者的联合判定**未经运行** ✓。
6. **checker 不观察外层退出码**：它只验内部协议与真实字节；**实际**退出码由外层 recorder/MAIN 另核 ✓。
7. **既有闭环未动**：C 的 sole-wait owner、原 group/identity/revoked authority、unknown 持有原 promise、
   normal 无自取消、first error 不变、one CANCEL、replacement PID 保护、无 root 不写 cwd、
   真实 reporting factory、bounded streams、同 root 独占 temp→完整 write→close→rename、
   逐 case 脚本与 deny ledger 的 finally 隔离 **全部保留** ✓。

## 9. 交还 MAIN

- 请对 §5 的**八份精确 SHA**与 §6 的**六条同源捕获**做只读复核；本轮的新面只有
  `onDrawEnd` 的**一处条件**、两条终局顺序反例，以及 R5H-O01 MINOR 的 tuple 修正 ✓。
- 本轮**没有**新的 429、没有重试、没有改模型供应商、没有由 Codex 自动接手；
  **没有** git 变更、没有 push、没有覆盖任何旧 capture、没有碰保护七文件与用户 dirty 工作、
  没有读改凭据/CLI 配置；真实 normal-001 的 root **保留未动** ✓。
- 交还后**冻结字节**接受独立受影响安全复核；通过后由 MAIN 另发**精确 pin 的真实 normal002**票 ✓
  （normal002 通过之后才另发 fault 票 ✓）。
