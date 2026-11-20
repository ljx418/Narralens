# n1n2-claude-060p5g — R5G 完整结果事实契约（F01..F10 / C01..C10 单批实施）

本文件是 R5G（`MAIN_R5G_RESULT_FACT_CONTRACT`，SPEC sha256
`843e8eeb09f21e138bb48cdda7d5d45d1a407d22bf49e7f5702a1cef3e2bbb6a`，正式合同 sha256
`493f86e334b25a4d2fa240b2248f485c910f379747b9c7e1e91ec4b82f124319`）的 OWN 报告。
本轮按已通过独立文档闭环（`MAIN_PLAN_REVIEW_AUDIT.json` = `PLAN_READY_FOR_SINGLE_BATCH_IMPLEMENTATION`，
plan-review `PLAN_READY`）的完整结果契约，把 **F01..F10 与 C01..C10 在同一实施批内全部实现**，
并关闭 R5F owner 的两个 MAJOR（R5F-O01 / R5F-O02）。

HEAD 仍是 `1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**，**没有** add/commit/push/
merge/reset/stash/checkout ✓。本轮**只**改了那八份既有文件中的**两份**与本报告 ✓（其余六份
**逐字节未变**，见 §4）；用户的 dirty 工作与保护七文件**原样保留** ✓。

## 0. 边界（如实声明）

- **只**执行了 `RELEASE.json` 的六种 recorder 命令形态，全部经
  `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`，
  capture 前缀 `n1n2-claude-060p5g-`；**没有** timeout 包裹 recorder、**没有**造 PID/exit、
  **没有**覆盖任何已有 capture。
- **没有**执行真实 C/N、真实 pilot、Host/Chrome/媒体/网络/付费、Q2、全量门、build、
  **混合 lifecycle 测试文件**（`cache-custodian-lifecycle.test.ts` **只 typecheck、不可执行**）、
  J 盘、Git 变更、凭据/CLI 配置。
- 原 pure guards **没有**弱化 ✓；原始 group / reaping / authority / cancel 算法**没有**重写 ✓
  （supervisor 与 custodian **逐字节未变** ✓）；**没有**用「所有组默认 ESRCH」求绿 ✓。
- 本报告**只是内部自验证**：**不**自签独立审查，**不**声明真实 N、N1/N2、R6/R7/R8、V1。
- 5s/20s 的超时事实**原样保留**：老 5s 失败（R5F `…-final-pilot`）与本轮一次 20s 失败
  （`…-pilot-001`）都**如实记账**，**根因未证实**，**没有**继续加预算、**没有**改生产 deadline、
  **没有**改断言求绿 ✓（见 §6 C10）。

## 1. 实现要点

### 1.1 一个事实投影 + 一个 checker（`tools/native-cache-normal-pilot.ts`）

| 位置 | 内容 |
|---|---|
| `:927` | `PositivePilotOutcome.diagnosticSnapshot: CacheDiagnosticSnapshot \| null` —— **必需的**内部 readonly 字段；它是 runner **已经取过一次**的那份**冻结** snapshot（`:1492` 的一次读取，赋给 `runSnapshot`），**不重新采样**、**不建第二时间点**、**不暴露 socket/handle/token**、**不另造持久权威** |
| `:1903` / `:1924` | `PilotResultFacts` + `resultFactsOf()`：actual outcome → **一份**规范投影（原失败/settlement/cleanup/terminal/image/kind/exit/fault），candidate、final、outcome **三者都与它逐字段比对** |
| `:1952` | `sameFacts()`：**逐字段**比较；**不用** `JSON.stringify`（那会丢掉 Error 的 name/message/cause），**不依赖**字段顺序；缺字段 ≠ null ≠ 不同值 |
| `:1982`–`:2100` | mandatory 字段的类型守卫：bounded error（name ≤128、message ≤1024、code null 或 ≤64）、image、terminal proof、latched outcome、native envelope（**不是**三字段 error）、cancel provenance、diagnostic snapshot 的**结果关键字段** |
| `:2130` / `:2148` | `errorFactDifference()` / `cleanupFactsDifference()`：**缺失、错型、显式 null 与实际不符、内容或顺序不同**是四件不同的事，**没有一件**被悄悄变成 null；cleanup 比较的是**全部内容与顺序**，不是只有 length |
| `:2211` | `verifyPublishedRun()`：**唯一** checker；actual main（`:2230` 之后的 `main`）、legacy 消费者（`cache-custodian-lifecycle.test.ts:273`）、可执行 pure 测试**调用同一个函数** ✓ |

### 1.2 三类退出语义（固定不变）

- `evidenceReliable=false` / `accepted=false` / **3**：缺字段、错型、跨记录矛盾、读/解析/协议/链接/
  发布/报告不可靠；**也包括「记录声称成功/预期 fault，而它自己的实际事实不支持」** ✓。
- `evidenceReliable=true` / `accepted=false` / **1**：**普通业务失败**（kind=`failed`）——
  证据可靠、**不是** PASS、也**没有**被偷换成 3 ✓。
- `accepted=true`：**0**（normal 完整可靠 + 真实成功）、**1**（assertion-failure 完整可靠 + 确切
  `EXPECTED_ASSERTION_FAILURE` + 同一取消主因 + null 图像 + 无额外失败 + 完整终局）✓。
- 参数/入口拒绝仍是 **2** ✓；CLI **不能**读取自己未来的 OS exit ✓（外层 recorder/MAIN 另核）✓。

### 1.3 mock fixture 的显式适配（不放宽生产门）

`StubSupervisor` 过去在模拟成功结算后仍返回 `terminal_proof: null`。F05 要求一个**显式的 mock 终局事实**，
所以 stub 现在返回一份**明确标注为 mock** 的 terminal proof（`proven:true`、两条 observation）✓。
**生产门没有被放宽** ✓；**纯 mock 的 `proven=true` 不是内核证明** ✓（plan-review 的要求）✓。
另加 `settlementWrapper` 变体：**合法 wrapper cause** 的正控（C07）✓。

## 2. 逐 F/C → producer → actual checker → actual consumer → 测试 → 捕获

矩阵在 `tests/agent-driven/integration/native-cache-normal-pilot.test.ts:1990` 的
`the RESULT FACTS of a published run`：每个适用 mandatory 字段**三类**（删除 / 错型 / 合法型但跨记录
矛盾）✓。变更发生在**真实 writer / publisher 的写边缘**（`:784` 的 `tamperWith`：复制记录、改**一项**、
再交给**真实** writer/publisher 序列化）✓ ⇒ 真实 mapper、真实 hash、真实长度、真实 links **自然对应真实
坏字节** ✓；**没有**伪造 hash ✓；**没有**复制 consumer ✓。

| 合同行 | producer（写入什么） | actual checker（门在哪里） | actual consumer | 测试（用例名 / 矩阵条目） | 捕获 |
|---|---|---|---|---|---|
| **F01**（root/mode/kind/authority/protocol/exit/fault flags） | `final.kind_of_run`、`exit_code`、`fault_case_passed`、`authoritative`、`mode`、`publication_protocol`、`root`；`candidate.authoritative` | `verifyPublishedRun` 的 F01 段：三记录的 root/mode 与 outcome 一致；final 的 kind/exit/fault 与 outcome **及** publication 一致；合法组合（ok/0/false 只 normal；fault-observed/1/true 只 fault；failed/1/false 是 ordinary）；非法组合 → 3 | main / legacy / pure **同一个** checker | 矩阵 `F01` 7 个字段 × 3 类 + `refuses an outcome whose kind, exit and fault flags contradict the records` | `…-pilot-007/008`、`…-final-pilot`（exit 0） |
| **F02**（原失败） | `candidate.original_failure`、`final.original_failure`（bounded error 或显式 null） | `errorFactDifference`：必须是**合法 bounded record 或显式 null**，且与 actual original 的规范投影**逐字段相等**；normal 成功必须 actual original === null | 同上 | 矩阵 `F02`（candidate/final 各 3 类）+ `refuses a record that says NULL where the run really failed` | `…-pilot-007/008` |
| **F03**（settlement） | `candidate.settlement_failure`、`final.settlement_failure` | 同 F02 的形状与相等；**关系**在**对象**上核：actual settlement === actual original **或** settlement.cause === actual original；空对象、无关 Error、同文案不同对象**都不算**关系 | 同上 | 矩阵 `F03`（candidate/final 各 3 类）+ `refuses a fault whose settlement is an unrelated failure` + `refuses a fault whose ACTUAL settlement is another object with the same text` + `ACCEPTS a fault whose settlement is the WRAPPER of the original error` | `…-pilot-007/008` |
| **F04**（cleanup facts） | `candidate.cleanup_facts`、`final.cleanup_facts` | `cleanupFactsDifference`：必需 array、每行合法 bounded failure、**内容与顺序**三者一致；可接受的两模式必须为空；真实且一致的非空 cleanup 属 ordinary 1 | 同上 | 矩阵 `F04`（candidate/final 各 3 类）+ `refuses an outcome whose own facts contradict the records` | `…-pilot-007/008` |
| **F05**（终局证明） | `candidate.terminal_proof`、`final.terminal_proof`；`candidate/final.terminal_proof_observations` | 三者一致且必须是**布尔**；可接受的两模式要求 actual snapshot 的终局证明**非 null 且 proven=true**；observations 字段与 actual baseline 一致（存在、类型、有限时间、有界数组） | 同上 | 矩阵 `F05`（candidate/final/诊断里的终局证明各 3 类） | `…-pilot-007/008` |
| **F06**（图像事实） | `candidate.expected_image`、`candidate.actual_image`、`final.picture_sha256/bytes/is_the_exact_one` | expected 必须是既有 1024/0x4a 常量；actual 是显式 null 或合法 record；三方一致；normal 接受须精确常量且 exact=true；fault 接受须图像/字节**全为 null** 且 exact=false | 同上 | 矩阵 `F06`（actual_image / expected_image / picture_sha256 / picture_bytes 各 3 类） | `…-pilot-007/008` |
| **F07**（actual snapshot） | `final.diagnostic_snapshot`、`candidate.receipt_summary/accumulator_summary/terminal_proof_observations` | final 的 snapshot **必须等于** actual baseline（逐字段）；candidate 的三个摘要也必须等于同一 baseline；**结果关键字段的类型单独校验**（两个缺字段的伪对象 deepEqual 也过不了）；早期一致 null 合法，接受两模式必须非 null | 同上 | 矩阵 `F07`（diagnostic_snapshot / accumulator_summary / receipt_summary / terminal_proof_observations 各 3 类）+ `does NOT change when the snapshot is read again` | `…-pilot-007/008` |
| **F08**（诊断的 cleanup/transport/latched） | `final.diagnostic_snapshot.cleanup_failures/cleanup_facts/transport_failure/latched_outcome` | 都是 mandatory、明确 null 或合法 record；cleanup count 是安全整数；native envelope 是**既有六字段形态**（stack/cause/phase），**不是**三字段 error；normal 接受须无 transport、latched.kind ≠ failure、raw 与诊断 cleanup 均无失败；fault 接受须无 transport 且 latched.kind=failure/code=DRAW_CANCELLED | 同上 | 矩阵 `F08`（cleanup_failures / cleanup_facts / transport_failure / latched_outcome 各 3 类）+ `refuses a final whose diagnostic carries an extra failure` | `…-pilot-007/008` |
| **F09**（取消来源） | `final.diagnostic_snapshot.cancel_provenance` 及其 `error_code/error_name/message` | mandatory nullable；非 null 须有既有六个字段与类型；fault 接受须 actual 原 Error.code=EXPECTED_ASSERTION_FAILURE、accepted=true、superseded=false、provenance.code=DRAW_CANCELLED，且 **error_name/error_code/message 绑定同一个原 Error**（既有截断规则）；**不**只看两个布尔 | 同上 | 矩阵 `F09`（cancel_provenance / error_name / error_code / message 各 3 类） | `…-pilot-007/008` |
| **F10**（报告/证据/发布/全行） | R5F 已闭环的必需字段与实际读取规则 | 保留 R5F 的**实际字节链、全行 hash/长度、原子 publish、每行规则**；错误 null 与缺失严格区分 | 同上 | R5F 的 15 条反例 + `answers 3 from the COMMAND when a result fact of the candidate is wrong`（**actual main** 决定性用例）+ `answers 3 from the COMMAND when the evidence cannot be read` | `…-pilot-007/008`、`…-final-pilot` |

### 2.1 C01..C10 的落点

| case | 用例 | 断言 |
|---|---|---|
| **C01** | `refuses a candidate that carries a failure, a cleanup and a missing field at once` | candidate 带 EIO + 非空 cleanup + 缺 settlement → **3**，root 留存 ✓ |
| **C02** | 矩阵 `F02`/`F03` 的 final 删除/string/array/{} 四类 | **3**；显式 null **不**与缺失混淆（`refuses a record that says NULL where the run really failed`）✓ |
| **C03** | `refuses a final whose diagnostic carries an extra failure` | final 带 EPIPE + latched failure，而 **actual outcome 的诊断基线不变** → 跨记录矛盾 → **3** ✓ |
| **C04** | `refuses an outcome whose own facts contradict the records`（改 actual outcome.cleanupFacts）、`refuses an outcome whose kind, exit and fault flags contradict the records` | **3** ✓ |
| **C05** | `refuses a fault whose settlement is an unrelated failure` + 矩阵 `F09` 的 error_code/error_name/message 三项单改 | **3** ✓ |
| **C06** | `refuses a fault whose ACTUAL settlement is another object with the same text` | 同文案**不同对象** ⇒ 关系不成立 ⇒ **不 accepted**（kind 声称 fault-observed ⇒ **3**）✓ |
| **C07** | `ACCEPTS a fault whose settlement is the WRAPPER of the original error`（**合法 wrapper cause 正控** ⇒ accepted/**1**）、`keeps an ordinary business failure reliable, not accepted, and at the exit code 1`、`keeps an ordinary failure of the FAULT mode reliable, not accepted, and at the exit code 1`、R5F 的 `does NOT accept a fault that carries an extra failure` | 普通失败**可靠、不接受、1** ✓；producer 阶段的额外 transport 如实 `failed/1` ✓ |
| **C08** | 矩阵 `F07` 的摘要/observations 矛盾与错型 + `does NOT change when the snapshot is read again` | **3**；actual frozen snapshot 重复读取不变 ✓ |
| **C09** | R5F 已有的正控（normal 0、精确 fault 1、参数 2、mandatory read/publish EIO 3）+ 本轮 `answers 3 from the COMMAND when a result fact of the candidate is wrong` | 全部继续成立 ✓；legacy 仍是薄调用，**未**运行混合 kernel suite ✓ |
| **C10** | 见 §6 | 5s 与 20s 的真实失败**原样保留**，根因**未证实** ✓ |

### 2.2 安全红灯：新增反例在 R5F 逻辑下**确实失败**

`n1n2-claude-060p5g-pilot-oldlogic-red`（exit 1，**26 failed / 129 passed**）：把 checker 的
**结果事实门**在**其辅助函数层**中和回 R5F 的语义（`errorFactDifference`/`cleanupFactsDifference`/
`sameFacts` 不再比较，acceptance 不再看 transport/latched/真实证明/settlement 关系/provenance 绑定），
**字节链、全行规则、发布与报告门保持 R5F 的原样**（它们在 R5F 已闭环）⇒ 这正是 R5F checker 对这些用例
的行为。**没有**恢复任何危险 guard 版本，**没有**真实 C/N ✓。
跑完后工具文件**按 sha256 逐字节还原**（`sha256sum -c` 通过 ✓，无 RED LIGHT 标记残留 ✓）。

## 3. 测试规模

| 套件 | R5F 终态 | R5G 终态 |
|---|---|---|
| identity | 87 passed | **87 passed**（未变） |
| python | 59 passed | **59 passed**（未变） |
| pilot | 69 passed | **186 passed**（+117：矩阵 35 字段 × 3 类 = 105 + 12 条专门用例） |

## 4. 最终八文件 hash

| 路径 | sha256 | 与 R5G `start_sha256` |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | `7706449e8f259a6e17e9ca2a40af8a5c344cef827a01c7881fc04a4a570b9b63` | **逐字节未变** ✓ |
| `src/adapters/openfilm/cache-process-custodian.py` | `bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79` | **逐字节未变** ✓ |
| `src/adapters/openfilm/cache-worker-integrity.json` | `7bb4bd1813987a6860bb9eb7a332ccbedb237c009a8767bc75e6418f1595c2db` | **逐字节未变** ✓（`--generate` 幂等，`source_changed=[]`） |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | `d4e60d2d81c78c3c01e62d7bec232a4371cf81b9426ae13ecdf77c91c90ad8bf` | **逐字节未变** ✓ |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `f35721741cb62afc946b84c507d029ff16746c739d5b63b0335f49d7855efa61` | **逐字节未变** ✓ |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | `230cbf8882e903a8752d663d2ff58f7cc729d5ab6e129ec2e566ba15a8077258` | **逐字节未变** ✓（R5F 的薄调用已足够） |
| `tools/native-cache-normal-pilot.ts` | `b21563aa7259c6e933b72d82eeb79a5a585576e91907acabe2fd443504797be7` | **已变**（F01..F10 的事实门与投影） |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | `d8690e8f9a9d72264b797beb41341bea70c519202f9ebd91d1a9dc6820cf15d0` | **已变**（矩阵 + 专门用例 + mock 终局适配） |

**保护七文件**：逐项实测**全部 MATCH** ✓。

## 5. 最终捕获（同一最终源字节，`source_changed` 全部为 `[]`，651 个输入文件零漂移）

| capture | 命令 | exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-060p5g-final-integrity-generate` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | **0** | `4c25cc12a7c348fe34847d0f81b72ebf0a57c767533a3912e540f6a84d5ade39` |
| `n1n2-claude-060p5g-final-tsc` | `corepack pnpm exec tsc --noEmit` | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `n1n2-claude-060p5g-final-identity` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | **0** | `98784d2ee1baf31871e22cdd33b8e60c5bb3a742cf7d4e3d886e40fec6128f81` |
| `n1n2-claude-060p5g-final-python` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | **0** | `e64047d662c7635f00d0dbd6ff59aa6e524d0394485c9489e983398c003065e0` |
| `n1n2-claude-060p5g-final-pilot` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | **0** | `af9c5e0106fddc7201ce1bb6d3caf58696a32a3f7623129337603d3d15af3a8c` |
| `n1n2-claude-060p5g-final-integrity-check` | `node tools/openfilm-cache-worker-integrity.mjs --check` | **0** | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` |

## 6. 失败索引（全部保留，未覆盖、未补造）

### 6.1 本轮中间捕获

| capture | exit | 含义 |
|---|---|---|
| `…-tsc-001` | 2 | outcome 增字段后快照局部类型未收窄 → 已改类型守卫 |
| `…-tsc-002` / `…-tsc-003` | 2 | 同上（latched/provenance 的类型谓词、`isDiagnosticSnapshotRecord` 的返回类型）→ 已改 |
| `…-tsc-005` / `…-tsc-006` | 2 | 终局证明校验器的一处括号失衡 → 已改（**不是**语义红灯） |
| `…-pilot-001` | **1** | **真实失败，保留**：`the ORCHESTRATION over the ACTUAL supervisor > waits for the REAL asynchronous start of the normal mode` 在 **20000ms** 处**超时**；同批另有 4 条因 mock 终局事实未适配而红（旧 stub 的 `terminal_proof:null`）。mock 已适配为**显式 mock 终局事实**（不放宽生产门）✓ |
| `…-pilot-002-1` / `…-pilot-002-2` | 1 | 同上（适配前的中间态） |
| `…-pilot-003` / `…-pilot-004` | 0 | mock 适配后的绿 |
| `…-pilot-005` | 1 | 矩阵两条用例写错：F04 的「错型」用了**合法**的空数组；C06 用了**同一个**对象（那正是合法关系）→ 已改为 object 错型与**两个不同**对象 ✓ |
| `…-pilot-006` … `…-pilot-008` | 0 | 矩阵扩充后的绿 |
| `…-pilot-oldlogic-red` | **1** | **安全红灯**：R5F 逻辑下 **26** 条新反例失败（§2.2）✓ |
| `…-final-*` | 0 | 最终六命令 ✓ |

### 6.2 C10：超时事实（如实记账，根因未证实）

- **老 5s 失败**（R5F `n1n2-claude-060p5f-final-pilot`，exit 1，5000ms 超时）**原样保留**；
  **20s 是 harness 预算调整，不是生产 deadline** ✓；**没有**证据证明「机器繁忙」是原因 ✓；
  本轮**没有**再加预算、**没有**改生产 deadline、**没有**改断言求绿 ✓。
- 本轮 `…-pilot-001` 又出现一次 **20000ms** 超时（同一用例、同一形状）；随后
  `…-pilot-002-1/2`、`…-pilot-003` 及之后的每次运行都**通过**（含最终六命令）✓。
  **根因未证实**：它**不是**内核活性证明，也**不是**「机器繁忙已证实」；
  本票**没有**再为它加预算或改生产行为，阶段事实与 capture 全部保留 ✓。
  若它再次挂住，处理方式是**保留阶段信息与 handle、按实际状态诊断**，
  **不**用 timeout 包裹 recorder ✓。

### 6.3 更早的失败与 INCOMPLETE（原样保留，本轮**没有**触碰）

| 名称 | 状态 | 说明 |
|---|---|---|
| `n1n2-claude-060p5d-red-python-002` | exit 1，**一次真实越界** | 真实 `os.kill(200, SIGTERM)` 事件；**事后 PID 不存在不能证明当时没有影响**；本轮**没有**重跑，也**没有**触碰任何固定 PID |
| `n1n2-claude-060p5d-red-python`、`-red-python-003`、`-red-python-004`、`-red-identity`、`-red-pilot`、`-red-tsc` | exit 1 / 2 | 旧逻辑下的红灯，原样保留 |
| `n1n2-claude-060p5d-fix-pilot-004` | exit 1 | **MAIN 的精确停止**（卡住的测试），**不是**自然超时，也**不是**语义反例 |
| `n1n2-claude-060p5d-fix-pilot-005` | **INCOMPLETE** | 缺 `.exit` 与 `.result.json`；本轮**没有**补造 |
| `n1n2-claude-060p5d-fix-pilot-006`、`-fix-identity-001`、`-fix-tsc-001`、`-fix-tsc-004` | exit 1 / 2 | 旧波次中间态，原样保留 |
| `n1n2-claude-060p5e-*`（含 `…-python-oldlogic-red`、`…-guard-identity`/`-002`、`…-identity-003`、`…-pilot-001..003`、`…-tsc-003`） | exit 1 / 2 | R5E 波次中间态与**故意**红灯，原样保留 |
| `n1n2-claude-060p5f-*`（含 `…-final-pilot` 的 5s 超时、`…-pilot-001..018`、`…-tsc-001..007`、`…-python-001`、`…-identity-001`） | exit 1 / 2 | R5F 波次中间态与**故意**红灯（`…-python-oldlogic-red` 属 R5E 波次），原样保留 |

**没有**补造任何 PID、exit 或日志；**没有**把「未达 fixture 的失败」称作语义旧代码红灯 ✓。

## 7. 已知限制（如实声明）

1. **内部自验证**：不构成独立受影响代码复审，也不构成真实 N / N1N2 / R6 / R7 / R8 / V1 的验收 ✓。
2. **checker 不是身份认证器**：它的信任前提是**同进程、同一次** actual outcome；
   它**不是**对任意重建 JSON outcome 的认证器（plan-review 的实施注意点）✓。
   C06 证明的是「实际对象的关系」被核验，而不是「文本相同即同一」✓。
3. **混合 lifecycle 文件只 typecheck**：legacy 消费者的联合判定**未经运行**；
   可执行覆盖在 pilot 套件里，用**同一个** checker 与**真实**临时 FS ✓。
4. **CLI 不观察外层退出码**：checker 只验内部协议与真实字节；**实际**观察到的退出码由外层
   recorder/MAIN 另核；本报告**不**把内存里的 exit 字段称作外层退出证据 ✓。
5. **mock 终局事实不是内核证明**：stub 的 `proven:true` 是**显式 mock**；
   生产门**没有**为它放宽 ✓。
6. **协议未变**：普通业务失败**仍然**是 1（只是**不被接受**）；证据/发布/读取/解析/协议/链接不可靠是
   **3**；参数拒绝**仍然**是 **2** ✓；**没有**把普通 failed 1 一律改成 3 ✓。
7. **既有闭环未动**：原始 group 证明义务与 destructive authority 的分离、取消主因、晚到 N 回收、
   替代 PID 信号保护、无 root 不写 cwd、真实 reporting factory、bounded streams、同 root 独占
   temp→完整 write→close→rename、逐 case 脚本与 deny ledger 的 finally 隔离，
   **逐字节保持** ✓（supervisor 与 custodian 未变 ✓）。
8. **未完成的更大范围**：R6/R7/R8、原 17+ISO18、真实冻结审查与下一接线包重锚**仍然 OPEN**；
   本票不替代它们 ✓。

## 8. 交还 MAIN

- 请对 §4 的**八份精确 SHA**与 §5 的**六条同源捕获**做只读复核；本轮的新面是
  `verifyPublishedRun` 的 F01..F10 事实门、`PositivePilotOutcome.diagnosticSnapshot`、
  以及随之而来的 117 条 pure 反例（其中 26 条已证明在 R5F 逻辑下失败）。
- 本轮**没有**新的 429、没有重试、没有改模型供应商、没有由 Codex 自动接手；
  **没有** git 变更、没有 push、没有覆盖任何旧 capture、没有碰保护七文件与用户 dirty 工作、
  没有读改凭据/CLI 配置。
- 交还后**冻结字节**接受独立受影响代码复核；安全通过后由 MAIN 另发**真实 N 票**
  （normal 与 fault 两张，分别单独 pin）✓。
