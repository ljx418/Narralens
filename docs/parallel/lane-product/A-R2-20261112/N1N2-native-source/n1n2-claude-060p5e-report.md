# n1n2-claude-060p5e — R5E 收口：纯测试边界封口 + 四类根因（Stage A + Stage B）

本文件是 R5E（`MAIN_R5E_ORIGINAL_GROUP_AND_JOINT_PUBLICATION_V2`，SPEC sha256
`9723fa7be4c37908a5f97f4290ac3662584e8c19851ff1235d7a1501f77b0fee`）的 OWN 报告。
**本轮续接的是 Stage B**：Stage A（纯测试系统调用边界）在 MAIN 的静态批准
（`MAIN_STAGE_A_APPROVAL.json`，正式回复 `msg_ba614742777d`）之后继续完成，四类根因
（`PURE_OS_GUARDS` / `ORIGINAL_GROUP_PROOF` / `REQUIRED_ARTIFACT_HASHES` /
`FINAL_PUBLICATION_AND_CONSUMERS`）在本次一并实现。

HEAD 仍是 `1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**，**没有** add/commit/push/
merge/reset/stash/checkout ✓。本轮**只**改了那八份既有文件与本报告 ✓；用户的 dirty 工作
（`AGENTS.md`、五个 host/adapter 文件、三个既有测试）**原样保留** ✓。

## 0. 本轮的边界（如实声明）

- **只**执行了 `RELEASE.json` 的六种 recorder 命令形态，全部经
  `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`，
  capture 前缀 `n1n2-claude-060p5e-`；**没有** timeout 包裹、没有造 PID/exit、没有覆盖已有 capture。
- **没有**执行真实 C/N、真实 pilot、Host/Chrome/媒体/网络/付费、Q2、全量门、build、混合
  lifecycle 测试文件（`cache-custodian-lifecycle.test.ts` **可改、不可执行**）、J 盘、Git 变更。
- 本报告**只是内部自验证**：我**不**自签独立外审，**不**声明 N1/N2/V1，**不**声明真实 N 基线。
  R6/R7/R8、原 17+ISO18、真实冻结审查与下一接线包重锚**仍然未完成**。

## 1. 逐 finding → 代码 → 测试 → capture 映射

| finding | 根因组 | 代码（文件:行） | 测试 | capture（exit） |
|---|---|---|---|---|
| `R5D-N04` / `R5D-O03`（Node 真实 `process.kill`） | PURE_OS_GUARDS | `tests/agent-driven/integration/cache-process-identity.test.ts:112-190`（守卫、deny ledger、显式 `scriptRawKill` / `scriptGroupProbe`）、`tests/agent-driven/integration/native-cache-normal-pilot.test.ts:114-170`（同一守卫形态） | identity 的 `the guard of the raw edges > records the refusal of the raw signal, and it is never a delivery`、`refuses every other edge of child_process`；pilot 的同名拒绝用例 | `…-guard-identity`（exit 1，**旧字节**）、`…-guard-identity-002`（exit 1，**旧字节**）、`…-final-identity`（exit 0） |
| `R5D-NOTE-01`（Python `_FakeOs` 回退真实 OS） | PURE_OS_GUARDS | `tests/agent-driven/integration/helpers/cache-custodian-unit.py:751-775`（`_FakeOs.__getattr__` 拒绝表）、`:135-193`（全局守卫） | `TheGuardOfTheRawEdges` 的四条（漏 `killpg` / `kill` / `prctl` / `signal` 脚本） | `…-final-python`（exit 0） |
| `R5D-N01` / `R5D-O04`（撤销后丢掉原始 group 的证据义务） | ORIGINAL_GROUP_PROOF | `src/adapters/openfilm/cache-process-custodian.py:2130-2149`（原始 group 义务与 destructive authority **解耦**） | `TheRevokedAuthorityStillProvesTheDomain > test_the_original_group_is_proved_by_a_raw_probe_after_the_revoke`（新），并给既有用例补上「最后那次探测**真的**发生了」 | `…-python-oldlogic-red`（exit 1，**旧逻辑下的红灯**）、`…-final-python`（exit 0） |
| `R5D-N02` / `R5D-O01`（必需 hash / 行级 error / 链接摘要不门控） | REQUIRED_ARTIFACT_HASHES | `tools/native-cache-normal-pilot.ts:139-216`（`REQUIRED_ARTIFACTS`、`evidenceProblemsOf`）、`:1569-1576`（判定**前**读取并校验 candidate/manifest 链接） | `the JOINT publication of a run` 的「REQUIRED artifact 带 error」「REQUIRED artifact 缺失」「manifest 不命名磁盘上 candidate 的摘要」「REAL filesystem：必需记录没写成」 | `…-final-pilot`（exit 0） |
| `R5D-N03` / `R5D-O02`（final 写失败仍是绿的；legacy 消费者只看返回字段） | FINAL_PUBLICATION_AND_CONSUMERS | `tools/native-cache-normal-pilot.ts:453-500`（`publishEvidence`：同 root 独占临时文件 → 完整写 → close → rename）、`:1613-1655`（发布与撤销）、`:1696-1800`（共享私有 `jointQualification`、协议 `positive-pilot-publication-v2` 与 exit 0/1/2/3）、`:1613-1655`（发布与撤销）；`tests/agent-driven/integration/cache-custodian-lifecycle.test.ts:204-300`（legacy 消费者的联合判定） | pilot：`publishes the final into the root of the run`、`revokes the qualification when the publication fails BEFORE the bytes are written`、`… AFTER the complete write`、`answers 3 when the publication of the run failed`、`a CONSUMER that applies the joint judgement rejects a run whose publication failed`；既有：`answers 0 …`、`answers 1 …`、`answers 2 …` | `…-final-pilot`（exit 0） |

## 2. 最终八文件 hash（本次终态）

| 路径 | sha256 | 与 release `start_sha256` 的关系 |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | `049489317e8f4f37be77556a90698c82027c8d8d4bf0ee51d15c15862b26d553` | **未变**（逐字节） |
| `src/adapters/openfilm/cache-process-custodian.py` | `bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79` | **已变**（B1 修复） |
| `src/adapters/openfilm/cache-worker-integrity.json` | `9860bcb1b5888bf66636592464fc02f24453abaab8dd3245ac1d96995afe8a7b` | **已变**（`--generate` 重生，只改这一个文件） |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | `70dd232045d3cbd84f45eeaa0e655ee78853db3f6cdd9917cf80067b3be1a751` | **已变**（守卫修正两处） |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `f35721741cb62afc946b84c507d029ff16746c739d5b63b0335f49d7855efa61` | **已变**（B1 反例 + probe/census 分离） |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | `4438da359f31547fad4fa98f54b06729770e5c9f0f8f37aef614e473236db6b2` | **已变**（legacy 联合判定 + custodian pin 更新） |
| `tools/native-cache-normal-pilot.ts` | `80f3a68f7c5b828d69a6c00140a98efca1bfb1114387cfd6997647ffe0b0dfe8` | **已变**（B2 + B3） |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | `7f858a3d17b59ee83edea5fb5c40e30868e267b07bc0d32442d3aa0b8330b974` | **已变**（真实字节 harness + 新反例） |

**保护七文件**：逐项实测**全部 MATCH** ✓（`native-cache-nofork-pilot.mjs`、
`native-cache-nofork-pilot.test.mjs`、`cache-worker-fixture.mjs`、`retained-native-closure.ts`、
`created-native-workspace.ts`、`openfilm-upstream.ts`、`AGENTS.md`）。

## 3. 最终捕获（同一最终源字节，`source_changed` 全部为 `[]`）

| capture | 命令 | exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-060p5e-final-tsc` | `corepack pnpm exec tsc --noEmit` | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `n1n2-claude-060p5e-final-identity` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | **0** | `80cff56d6240e22218641f90d932add38c24e52034a610f10286b46ac5b05a18` |
| `n1n2-claude-060p5e-final-python` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | **0** | `cc3a6bb4da32c65b383fcc704a59fd67c61e01c6f23f99f8071f1b0b3c9918f6` |
| `n1n2-claude-060p5e-final-pilot` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | **0** | `2e2a0a1a9f9d7db1a0779e679dd50973f3323548a73ea163a8869e4b08dee11a` |
| `n1n2-claude-060p5e-final-integrity-generate` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | **0** | `92def9d08b9bfd01bbe4bbdf5c693c9a24c7834e9ff0d6e2b8328efb38a8fd4c` |
| `n1n2-claude-060p5e-final-integrity-check` | `node tools/openfilm-cache-worker-integrity.mjs --check` | **0** | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` |

测试规模：identity **86 passed**，python **59 passed**，pilot **54 passed**（本轮从 43 增到 54）。

## 4. 本轮的中间捕获（失败与红灯，全部原样保留）

| capture | exit | 含义 |
|---|---|---|
| `…-guard-identity` | 1 | 上一轮旧字节：63 failed（MAIN 的 `MAIN_GUARD_FIRST_CAPTURE_DIAGNOSIS.json` 所述） |
| `…-guard-identity-002` | 1 | 上一轮旧字节：2 failed（守卫组织修正未完成） |
| `…-identity-003` | 1 | 本轮第一跑（当前字节）：2 failed——见 §5.1 的两处修正 |
| `…-identity-004` | 0 | 两处守卫修正后：identity 全绿 |
| `…-python-001` | 1 | 本轮 python 首跑：新反例的一处断言写错（第一遍之后 authority 还是 `bound`，第二遍才被 revoke）→ 已改成 review 指出的「post-reap refusal → revoked → census 恢复 → probe 仍 unknown → ESRCH 才收敛」顺序 |
| `…-python-oldlogic-red` | 1 | **红灯证明**：把 custodian 临时还原成旧逻辑后，新反例与被加强的既有用例**都失败**（`assertFalse(third["ok"])` → `True is not false`；`('group', 200, 0) not found in []`）。全程只用安全 mock，**没有**恢复任何真实 OS 泄漏；随后逐字节还原并用 sha256 校验 |
| `…-pilot-001/002/003` | 1 | pilot 三轮中间态：新协议下 exit 1→3 的语义迁移、link 一致性、脚本化 group probe |
| `…-tsc-003` | 2 | 工具改依赖后的 typecheck 红灯（测试侧尚未迁移），已修复 |
| `…-integrity-generate-001` | 0 | `--generate` 的唯一一次真实写入：`source_changed` 只有 `src/adapters/openfilm/cache-worker-integrity.json` ✓ |

## 5. 本轮改了什么（按类）

### 5.1 PURE_OS_GUARDS（Stage A 的收尾，两处）

1. `cache-process-identity.test.ts` 的「tells the three states of a group apart」：对**那一个**合成组
   `0x7ffffff0` 显式 `scriptGroupProbe(0x7ffffff0, "gone")`，并断言探测**真的**发生了
   （`-2147483632/0`）。此前它靠默认拒绝得到 `unknown`，断言 `gone` 必红。
2. 同一文件「does NOT write the CANCEL of the custodian twice」：该用例的 custodian **从未**说过身份，
   因此生产**不会**去 signal 一个它无法证明的进程；原来的 `killCalls.length > 0` 与生产行为矛盾。
   改为断言**没有**任何破坏性信号离开（`killCalls.length === 0`，且只有 signal 0 的组探测被脚本化），
   并由姊妹用例「keeps a draw HELD when it was ALLOWED to fork and no worker was proved」（那里有 C_HELLO）
   覆盖「SIGTERM 经由脚本送出」的路径。**没有**删除守卫，**没有**放宽断言。

### 5.2 ORIGINAL_GROUP_PROOF

- `cache-process-custodian.py::_settle_domain`：原始 group 的**证据义务**现在由
  `original_worker_epoch` 单独决定，**与** destructive signal authority 是否被撤销**无关**。
  撤销后仍然：记录原始目标、对**原始** PGID 做新鲜只读探测；`unknown` 保持 held；
  只有原始组的 raw `ESRCH` 能让同一责任收敛。
  破坏性路径**未被触碰**：`_signal()` 仍然每次向 `_authorise_signal()` 询问新鲜授权，
  被撤销时只得到 `refused-forbidden:…`，**不会**到达 raw 调用，也**不会**恢复授权，
  更不会改瞄 replacement PID/group。
- 反例（`cache-custodian-unit.py`）：实际 `_settle_domain → KernelSettlementOperations`，只 mock raw 边缘。
  TERM → N 真正被 waitpid 消费（anchor 释放）→ census 不可读导致欠下的硬信号被**拒绝**（授权撤销）
  → census 恢复为**空**且 children 为空，但原始组的 raw 探测是 **EIO**：
  断言原始 PGID **真的**被探测（`("group", 200, 0)` 在 raw 记录里）、**没有**任何非零 raw 调用、
  结果仍然 **held**（`group_esrch` 为 false）；再把探测换成 **ESRCH**，同一责任才收敛。
  为了把「census 为空」和「raw 探测 unknown」**分开**，测试里新增了独立的 `probe_unknown` 开关。

### 5.3 REQUIRED_ARTIFACT_HASHES

- `REQUIRED_ARTIFACTS = ["candidate.json", "cache-worker-fixture.mjs"]`：manifest **必须**逐个命名它们，
  且每一行都要有**非空** digest、**没有**行级 error。
- `evidenceProblemsOf()` 把下列每一条都记成**有界实际错误**：listing 失败、必需名缺失、行级 error、
  行级 digest 为 null、candidate 读不到、manifest **不命名磁盘上 candidate 的真实摘要**（`EIDMATCH`）、
  manifest 读不到。
- candidate/manifest 的链接摘要在**判定之前**从文件**读出并校验**，不再只信 final 里的自声明。
- 判定的门从「只有 top-level error」改为「`evidenceProblems` 为空 **且** `evidenceErrors` 为空
  **且** 报告没有失败」。

### 5.4 FINAL_PUBLICATION_AND_CONSUMERS（协议 `positive-pilot-publication-v2`）

- **发布**：同一**已拥有** evidence root 内的**独占**临时文件（`open(..., "wx")`）→ 完整写入 →
  **成功 close** → `rename` 成 `final.json`。所有必需 callback/report 在发布**之前**完成，
  发布之后**不再**有必需写入。
- **不确定结果**（写前失败 / 完整序列化后抛错 / close 失败 / rename 失败）：返回
  `kind=failed`、`faultCasePassed=false`、`authoritative=false`、`exitCode=3`；
  **原始业务 Error / 图像 / cleanup 事实原样保留**；**不**靠再次覆盖坏 final 来证明失败。
- **退出码（旧 → 新，如实记录）**：
  - 旧：拒绝参数 = 2，**其余一切**失败 = 1；final 没真写出来也照样返回绿色资格。
  - 新：**0** = 正常成功且联合发布完整；**1** = 预期 fault 被真实观测且联合发布完整，
    **或**普通业务失败（**即使 exit 1 也绝不被判为通过**）；**2** = 参数/入口拒绝；
    **3** = 任何 mandatory evidence / report / publication 不可靠，**绝不**作为 expected fault 接受。
  - 因此：证据或报告失败、manifest 不可构建、发布失败、run 在复制 helper 之前就拒绝（证据不完整）
    ——这些**由 1 变为 3**；一条**普通**业务失败（在证据完整时）仍然是 **1**。
  - 历史捕获的 exit **原样保留**，没有改写。
- **联合判定（消费者侧）**：返回的 `publication` 携带发布资格、final/manifest/candidate 的**实际摘要**
  与字节数、以及协议 exit code；工具内有一个**共享私有** `jointQualification()`（不新增文件、不新增公共 API）。
  同文件内的 legacy normal 消费者（`cache-custodian-lifecycle.test.ts`）现在**必须**同时满足：
  发布资格 + **磁盘上的真实字节**摘要与返回值一致 + exit 协议一致，才接受并允许删除证据。
  一个「看起来是绿的」final **不再**是权威。

### 5.5 测试 harness 的诚实化

- pilot 的测试 harness 现在保存**真正序列化的字节**（`Buffer`），测试读回字节而不是持有可变对象引用；
  后续的 error 数组变化**不再**能悄悄改写「已发布」的事实。
- 新增用**默认真实临时文件系统**（`mkdtemp` + 真实 `writeEvidence`/`publishEvidence`/`artifactFacts`/
  `fileFacts`）验证证据分支的用例；custodian 与 helper 的 pin 是**显式常量**，不是自签名。

## 6. 已经实际计算的 bounded receipt / accumulator 摘要（不伪造 raw segments）

下面这些数字**确实**由生产 supervisor 计算出来，并被本次执行的用例**断言**（见
`native-cache-normal-pilot.test.ts` 的「the ORCHESTRATION over the ACTUAL supervisor」，
以及 capture `n1n2-claude-060p5e-pilot-007` 的日志原文）：

```
receipt_summary   = {kind:"DOMAIN_REAPED", outcome:"reaped", seq:4, segments:1,
                     events_count:0, waits_count:1, identities_count:0, exec_ok:true,
                     echild:true, group_esrch:true, known_ids_gone:true,
                     anchor_retained:true, identity_overflow:false,
                     events_truncated:false, diagnostics_lost:false, state:"exit"}
accumulator_summary = {segments:1, received:1, events:0, waits:1, identities:0, refused:false}
```

- 这些是**计数与标志**，**不是** digest 字符串；持久化的证据里 `raw_segments_saved=false`，
  本报告**不**把它描述成完整/可复现的 transcript，也**不**编造未保存的 raw segments。
- 它满足 R5D-NOTE-02 的最小要求：把**已经算出来的**有界事实复制进证据合同，
  而**不**在这里要求 R6 的完整 segment 语义。

## 7. 失败与 INCOMPLETE 索引（原样保留，未被本次覆盖）

| 名称 | 状态 | 说明 |
|---|---|---|
| `n1n2-claude-060p5d-red-python-002` | exit 1，**一次真实越界** | 真实 `os.kill(200, SIGTERM)` 事件。日志原样保留（`('group', 200, <Signals.SIGTERM: 15>)`）。**事后 PID 不存在不能证明当时没有影响**；本轮**没有**重跑该实验，也**没有**再触碰任何固定 PID |
| `n1n2-claude-060p5d-red-python`、`-red-python-003`、`-red-python-004` | exit 1 | 旧逻辑下的红灯，原样保留 |
| `n1n2-claude-060p5d-red-identity`、`-red-pilot` | exit 1 | 同上 |
| `n1n2-claude-060p5d-red-tsc` | exit 2 | 同上 |
| `n1n2-claude-060p5d-fix-pilot-004` | exit 1 | **MAIN 的精确停止**（把卡住的测试停掉），**不是**自然超时，也**不是**语义反例 |
| `n1n2-claude-060p5d-fix-pilot-005` | **INCOMPLETE** | 只有 claim/cmd/inputs/txt，**没有** `.exit`、**没有** `.result.json` —— 仍然是 INCOMPLETE，本轮**没有**补造 exit/result |
| `n1n2-claude-060p5d-fix-pilot-006`、`-fix-identity-001`、`-fix-tsc-001`、`-fix-tsc-004` | exit 1 / 2 | 旧波次的中间态，原样保留 |
| `n1n2-claude-060p5e-guard-identity`、`-guard-identity-002`、`-identity-003`、`-python-001`、`-python-oldlogic-red`、`-pilot-001/002/003`、`-tsc-003` | exit 1 / 2 | 本轮的中间态与**故意**的红灯（证明新反例在旧逻辑下失败），原样保留 |

## 8. 已知限制（如实声明）

1. **内部自验证而已**：本报告不构成独立安全复审，也不构成 N1/N2/V1 的验收。
   MAIN 的独立复审仍是**下一步**。
2. **没有真实 N**：本轮**没有**任何真实 C/N 执行许可，也**没有**执行真实 pilot 或混合 lifecycle 文件；
   `cache-custodian-lifecycle.test.ts` 的联合判定只经过 **tsc 类型检查**，**未经运行**。
   其中「legacy 消费者拒绝」的**可执行**覆盖放在 pilot 测试里（同样的联合判定，对同一批真实字节），
   因为混合 lifecycle 文件在本票**不可执行**。
3. **协议 v2 只在内部 CLI**：没有改 Host API、public DTO 或 EnginePort；新增的只是工具内部的
   `deps.fileFacts` / `deps.publishEvidence` 边界与 `PositivePilotOutcome.publication` 字段。
4. **一次运行前的取舍**：当一次 run 在复制 helper **之前**就拒绝（pin 不符、root 准备失败），
   它的 manifest 就不完整 → 证据不可靠 → exit **3**（而不是 1）。这是刻意的 fail-closed 取舍，
   §5.4 已逐条写明；原始失败仍然保存在 final 记录里。
5. **既有行为保持**：取消主因、晚到 N 回收、替代 PID 信号保护、无 root 不写 cwd、真实 reporting
   factory、bounded streams 等既有闭环**未被改动**；`cache-process-supervisor.ts` **逐字节未变**
   （sha256 与 release 起点相同）。
6. **未完成的更大范围**：R6/R7/R8、原 17+ISO18、真实冻结审查与下一接线包重锚**仍然 OPEN**；
   本票不替代它们。

## 9. 请求 MAIN

- 请对 §2 的**八份精确 SHA**做只读复核，并把 §5 的**旧→新 exit 语义**记入裁决。
- 本轮**没有**新的 429，没有重试，没有改模型供应商，没有由 Codex 自动接手；
  没有 git 变更、没有 push、没有覆盖任何旧 capture、没有碰保护七文件与用户 dirty 工作。
- B 部分已完成并交还；等待 MAIN 的**独立安全复审**与另发的真实 N 许可。
