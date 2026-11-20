# n1n2-claude-060p5f — R5F 收口：一个真正读取字节的联合校验器

本文件是 R5F（`MAIN_R5F_SINGLE_ACTUAL_BYTE_CHECKER`，SPEC sha256
`75a3f0dd5fe1c5821b99e2eab6f434f0a1c204380a291add6c51d151185f2265`）的 OWN 报告。
本轮是 R5E 交还字节的**续作**：R5E 的两审（startup 静态 safe 有前提、owner 2 MAJOR + 1 MINOR）
已经结束，MAIN 裁决 `REQUEST_CHANGES_BEFORE_MINIMAL_N`，本票关闭 owner 的三个未闭项：

- **R5E-O01**：被发布的 manifest **每一行**都必须门控（不只是 candidate/helper 两个名字）；
- **R5E-O02**：仓库里**只有一个**真正读取字节的 checker，actual main、legacy 消费者与可执行 pure
  测试**调用同一个函数**；
- **R5E-O03 / NOTE-02**：把 supervisor **已经算好并验证过**的 receipt/accumulator 摘要字符串
  （`events_digest` / `waits_digest` / `identities_digest`）复制进 readonly/frozen 的诊断摘要。

HEAD 仍是 `1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**，**没有** add/commit/push/
merge/reset/stash/checkout ✓。本轮**只**改了那八份既有文件与本报告 ✓；用户的 dirty 工作与保护七文件
**原样保留** ✓。

## 0. 边界（如实声明）

- **只**执行了 `RELEASE.json` 的六种 recorder 命令形态，全部经
  `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`，
  capture 前缀 `n1n2-claude-060p5f-`；**没有** timeout 包裹 recorder、**没有**造 PID/exit、
  **没有**覆盖任何已有 capture。
- **没有**执行真实 C/N、真实 pilot、Host/Chrome/媒体/网络/付费、Q2、全量门、build、
  **混合 lifecycle 测试文件**（`cache-custodian-lifecycle.test.ts` **只 typecheck、不可执行**）、
  J 盘、Git 变更、凭据/CLI 配置。
- 本报告**只是内部自验证**：**不**自签独立审查，**不**声明真实 N、N1/N2、R6/R7/R8、V1。
  R6/R7/R8、原 17+ISO18、真实冻结审查与下一接线包重锚**仍然未完成**。
- 原 pure guards **没有**重开 Stage A：Node 默认 deny / 精确 case 脚本 / ledger 的 finally 隔离，
  Python 的全局 os/ctypes/signal 守卫，**逐字节未动** ✓；**没有**用「所有组默认 ESRCH」求绿 ✓；
  原始 group 证明义务与 destructive authority 的分离**没有**改动（custodian 逐字节未变）✓。

## 1. 逐 finding → producer → 实际 consumer → 测试 → 捕获

| finding | producer（代码） | 实际 consumer | 测试 | 捕获 |
|---|---|---|---|---|
| **R5E-O01**（被发布的行带 error 仍判绿） | `tools/native-cache-normal-pilot.ts:151`（`RESERVED_RECORD_NAMES`）、`:154`（`isSimpleArtifactName`）、`:164`（`isFullSha256`）、`:169`（`isByteCount`）、`:181`（`artifactRowProblems`）、`:241`（`evidenceProblemsOf`：遍历**每一行**、重复名、必需名、candidate 链接的 digest **与**字节数） | 同上（producer 侧判定不可靠 → `failed`/`faultCasePassed=false`/`authoritative=false`/exit 3）；checker 侧再逐行复算 | `the JOINT publication of a run` 的「REQUIRED artifact 带 error / 缺失」「manifest 不命名 candidate 的摘要」；**`the JOINT checker of a published run > the REAL mapper: a single EIO on a third artifact makes the run unreliable`**（真实 mapper + 真实临时 FS + **只在 scan 阶段**的单文件 EIO 注入） | `…-pilot-010`、`…-pilot-018`、`…-final2-pilot`（exit 0） |
| **R5E-O02**（所谓共享校验不读字节、三份副本） | `tools/native-cache-normal-pilot.ts:1787`（`PilotByteReader`）、`:1806`（`PilotJointVerdict`）、`:1905`（**`verifyPublishedRun`**：读 final/manifest/candidate 与**每一个**被列出的 artifact 的实际字节，核对 hash/bytes、JSON schema、root/mode/protocol、final links、manifest 行、报告/证据失败、原结果、terminal proof、原 settlement 与最终 diagnostic cleanup、mode 特定结果）、`:495`（`deps.readBytes` 边界）、`:2230`（**actual main 调用它**） | **同一个** `verifyPublishedRun`：`tests/…/cache-custodian-lifecycle.test.ts:13,273`（legacy 消费者与**证据根删除条件**）与 `tests/…/native-cache-normal-pilot.test.ts`（可执行 pure consumer 测试）。**两份消费副本已删除**：lifecycle 的 `jointQualification` 与测试里的 `consumerAccepts` | `the JOINT checker of a published run` 的 **15 条新用例**：正常 0 / 精确 fault 1 / 普通业务 1（不 accepted）/ 带额外错误的 fault 1（不 accepted）/ final 读 EIO / candidate 读 EIO / helper 读 EIO / 第三列 artifact 读 EIO / 记录丢失 / 合法 hash 但 mode 错 / 合法 hash 但 protocol 错 / 合法 hash 但 link 错 / 合法 hash 但字节数错 / command 读到 3 且**证据根保留** | `…-pilot-018`、`…-final2-pilot`（exit 0） |
| **R5E-O03 / NOTE-02**（已算好的 digest 字符串缺失） | `src/adapters/openfilm/cache-process-supervisor.ts:682`（`boundedDigestString`：只接受**完整**的 64 位小写 hex，其余显式 `null`）、`:312` 与 `:332`（两个摘要类型的三个 digest 字段）、`:1971`（receipt 的三个 digest）、`:2007`（accumulator 的三个 digest） | runner 的 candidate 直接持久化 `receipt_summary`/`accumulator_summary`，final 的 `diagnostic_snapshot` 里持久化同一份 ✓；`raw_segments_saved=false` **保持** ✓ | `cache-process-identity.test.ts:1364`（**实际 supervisor**：两次 snapshot 读数相等、摘要 **frozen**、accumulator 的三个 digest 等于它真算出来的值）；`native-cache-normal-pilot.test.ts` 的 ORCHESTRATION 例（**实际 supervisor + mock 协议**：receipt 的 digest 与 accumulator 的 digest **逐字相等**、candidate 与 final 两次读数相等） | `…-identity-001`、`…-final2-identity`、`…-final2-pilot`（exit 0） |

### 1.1 R5E-O01 的实际反例（不是「替换整份 artifactFacts」）

`the REAL mapper: a single EIO on a third artifact makes the run unreliable` 用的是：

- **真实**临时文件系统（`mkdtemp`）+ **真实** `artifactFacts` / `fileFacts` / `writeEvidence` / `publishEvidence`；
- 注入点是**文件系统的读边界**（`node:fs` 的 `readFileSync` mock，`:201` 的 `readFailures`），
  而且只针对**第三列** artifact（`cache-worker-fixture.scenario`）——它在 scan 之前**没有任何人读**，
  所以 EIO **只发生在 scan 阶段**；
- 结果由用例断言：`kind="failed"`、`faultCasePassed=false`、`authoritative=false`、`exitCode=3`，
  **持久化的 manifest 行**里 `digest=null` 且 `error!=null`，而 **top-level `listing_error` 仍是 null**
  （证明走的是真实 mapper 的「行级 error」路径，而不是把整份 facts 换掉）。

### 1.2 R5E-O02 的语义（三个字段必须分开）

`verifyPublishedRun` 返回 `{evidenceReliable, accepted, exitCode, reasons}`：

| 情形 | evidenceReliable | accepted | exitCode |
|---|---|---|---|
| normal 完整可靠 + 真实成功（精确 1024×0x4a 及其 hash、terminal proof、无任何额外失败、事实与 outcome 一致） | true | **true** | **0** |
| assertion-failure 完整可靠 + **确切** `EXPECTED_ASSERTION_FAILURE` + 同一取消主因（`cancel_provenance.accepted_as_primary`）+ null 图像 + 无额外失败 + 完整终局 | true | **true** | **1** |
| 普通业务失败，但证据完整可靠 | true | **false** | **1**（**绝不被当成 expected fault PASS**） |
| 必需证据 / 发布 / 读取 / 解析 / 协议 / 链接 不可靠 | **false** | false | **3** |
| 参数/入口拒绝（未变） | — | — | **2** |

- **可靠性**与**接受**是分开的：报告/证据的失败、read/parse/schema/link 的失败 ⇒ **3**；
  run 自己的失败（普通业务失败）⇒ 证据仍可靠 ⇒ **1** 且 `accepted=false`。
- checker **不抛未处理异常**（整段包在 try/catch 里，异常 ⇒ 拒绝 + 3），**不删除证据**（用例断言根仍在）✓。
- **CLI 不能读取自己未来的 OS exit**：checker 只验证内部协议与真实字节；
  **外层 recorder / acceptor 另核 actual observed exit**。本报告**不**把内存里的 exit 字段称作外层退出证据 ✓。

### 1.3 一份 checker，三处调用（副本已删）

- `tools/native-cache-normal-pilot.ts`：**唯一**实现 `verifyPublishedRun`（导出并标注 `@internal`；
  它**不是** Host API、public DTO 或 EnginePort，也没有新增源码文件）；
- `tools/native-cache-normal-pilot.ts:2230`：**actual main** 调用它；
- `tests/…/cache-custodian-lifecycle.test.ts:273`：**legacy 消费者**调用它，
  并且**证据根的删除条件**也用它（`verdict.accepted`）✓（该文件**只 typecheck**）；
- `tests/…/native-cache-normal-pilot.test.ts`：**可执行 pure consumer 测试**调用它。
- 已删除：`cache-custodian-lifecycle.test.ts` 的 `jointQualification`（原副本）、
  `native-cache-normal-pilot.test.ts` 的 `consumerAccepts`（原副本）、
  工具内那个**不读字节**的私有 `jointQualification`（已被 `verifyPublishedRun` 取代）✓。
  现在仓库里**没有**第二份 predicate，也没有「注释说共享、代码三份」的情况 ✓。

## 2. R5E-O03 / NOTE-02：实际算出来的 digest 字符串

下面是**实际捕获里**的值（`native-cache-normal-pilot.test.ts` 的 ORCHESTRATION 例断言了它们，
该例用**实际 supervisor + mock 协议**；值来自 custodian 的 DOMAIN_REAPED 与 Host 的 accumulator）：

```
receipt_summary.waits_digest        = ed8e31ae409545cb792e2ee0499e7924f858a75a54f6c09799b49e706a916022
receipt_summary.events_digest       = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
receipt_summary.identities_digest   = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
accumulator_summary.waits_digest     = ed8e31ae409545cb792e2ee0499e7924f858a75a54f6c09799b49e706a916022
accumulator_summary.events_digest    = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
accumulator_summary.identities_digest= e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

- `e3b0c442…` 是**空集合的 digest**（该轮只有 1 个 wait、0 个 event、0 个 identity）✓；
  `ed8e31ae…` 是那**一个 wait** 的 digest ✓。
- **证据位置**：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/`
  下的 `n1n2-claude-060p5f-pilot-0xx.txt`（用例日志）与 `n1n2-claude-060p5f-final2-pilot.txt` ✓；
  持久化位置是 candidate 的 `receipt_summary`/`accumulator_summary` 与 final 的
  `diagnostic_snapshot`（同一份摘要）✓。
- **两端一致**：receipt 的 digest 与 accumulator 的 digest **逐字相等**（用例断言）✓ ——
  custodian 与 Host 对同一批字节的结论一致。
- 这些是**已经算好并验证过**的字符串的**复制**，不是新的 oracle；不合法时显式 `null`，
  **不造摘要** ✓。`raw_segments_saved=false` **保持** ✓；完整 raw segment 与 R6 语义**不在本票** ✓。

## 3. 最终八文件 hash

| 路径 | sha256 | 与 R5F `start_sha256` 的关系 |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | `7706449e8f259a6e17e9ca2a40af8a5c344cef827a01c7881fc04a4a570b9b63` | **已变**（只增加有界私有摘要：三个 digest 字段 + `boundedDigestString`） |
| `src/adapters/openfilm/cache-process-custodian.py` | `bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79` | **逐字节未变** ✓ |
| `src/adapters/openfilm/cache-worker-integrity.json` | `7bb4bd1813987a6860bb9eb7a332ccbedb237c009a8767bc75e6418f1595c2db` | **已变**（`--generate` 重生，只改这一个文件） |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | `d4e60d2d81c78c3c01e62d7bec232a4371cf81b9426ae13ecdf77c91c90ad8bf` | **已变**（新增一条 frozen 摘要用例） |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `f35721741cb62afc946b84c507d029ff16746c739d5b63b0335f49d7855efa61` | **逐字节未变** ✓ |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | `230cbf8882e903a8752d663d2ff58f7cc729d5ab6e129ec2e566ba15a8077258` | **已变**（legacy 消费者改成薄调用；副本已删） |
| `tools/native-cache-normal-pilot.ts` | `bb5ab8dfa788629cbcd0762302cb1c595412d9a15d54381e70b92ab4b5207afa` | **已变**（R5E-O01 的行级门控 + 唯一的 `verifyPublishedRun`） |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | `991bea38c8c15ba51e1404bb3437117e75706c88dcad6d60c248b99217aad4e1` | **已变**（真实字节 harness、15 条新反例、read 边界注入、单一 checker 调用） |

**保护七文件**：逐项实测**全部 MATCH** ✓（`native-cache-nofork-pilot.mjs`、
`native-cache-nofork-pilot.test.mjs`、`cache-worker-fixture.mjs`、`retained-native-closure.ts`、
`created-native-workspace.ts`、`openfilm-upstream.ts`、`AGENTS.md`）。

## 4. 最终捕获（同一最终源字节，`source_changed` 全部为 `[]`，651 个输入文件零漂移）

| capture | 命令 | exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-060p5f-final2-tsc` | `corepack pnpm exec tsc --noEmit` | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `n1n2-claude-060p5f-final2-identity` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | **0** | `df70205ef9917b29dde829af5ee61cb6dd48928a62fd105e807fbc715e61e9d2` |
| `n1n2-claude-060p5f-final2-python` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | **0** | `2fd551dad481f8681eb46281d97ed4b5396809219b041df8ff56e041c3eedaa1` |
| `n1n2-claude-060p5f-final2-pilot` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | **0** | `c6e3d77461ca4a57f922a511351fab840095e3554052669c5e4372d18b96996d` |
| `n1n2-claude-060p5f-final2-integrity-generate` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | **0** | `4c25cc12a7c348fe34847d0f81b72ebf0a57c767533a3912e540f6a84d5ade39` |
| `n1n2-claude-060p5f-final2-integrity-check` | `node tools/openfilm-cache-worker-integrity.mjs --check` | **0** | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` |

测试规模：identity **87 passed**（86 → 87），python **59 passed**（未变），pilot **69 passed**（54 → 69）。

## 5. 失败索引（全部保留，未被覆盖、未被补造）

### 5.1 本轮中间捕获

| capture | exit | 含义（**不是**语义红灯的都是 harness/实现错误，已自行修） |
|---|---|---|
| `…-tsc-001` | 2 | supervisor 加了摘要字段后，测试里的 stub 快照类型缺字段 → 已补 |
| `…-tsc-003` | 2 | 新用例里 transport failure 夹具类型不全 → 已补 |
| `…-pilot-001` | 1 | checker 首次接入：main 仍走旧的私有 predicate → 已改 |
| `…-pilot-002` | 1 | probe 用例里 harness 用错（读的是另一个 harness 的 map） → 已修 |
| `…-pilot-003` | 1 | probe：stub 的 helper 字节与它自称的 digest 不一致 → 已让 stub 写**真**字节并让 digest 等于它 |
| `…-pilot-004` | 1 | probe：stub 自称的字节数是虚构的 → 已改为真实字节数 |
| `…-pilot-006` | 1 | 新用例：real-fs harness 缺 `readBytes`/`fileFacts` 与真实路径 → 已补 |
| `…-pilot-007` | 1 | probe：fake receipt 的 digest 期望写错（它是**空集合的 digest**，不是 null） → 已按实际值改 |
| `…-pilot-008` | 1 | real-fs harness：helper/scenario 没有落到真实 root → 已修（stub 的 fixture 源路径是虚构的） |
| `…-pilot-009` | 1 | probe：真实 custodian/fixture 路径缺失导致 pin 失败 → 已改用仓库里的真实字节 |
| `…-pilot-011` / `…-pilot-012` / `…-pilot-013` | 1 | 摘要断言的取值位置与「两次 snapshot 读数」的比较对象写错 → 已按实际结构改 |
| `…-final-pilot` | **1** | **真实失败，保留**：`the ORCHESTRATION over the ACTUAL supervisor > waits for the REAL asynchronous start of the normal mode` 在 5000ms 处 **超时**（该例用**真实 timer**驱动真实协议，机器繁忙时 vitest 的默认预算小于生产自己的清理 deadline）。随后两次重跑（`…-pilot-017-1/2`）通过；本轮把这两个真实 supervisor 用例的预算显式写成 `REAL_SUPERVISOR_CASE_TIMEOUT_MS = 20_000`（**不是**语义 deadline，断言一个都没有放宽），并重新完整捕获了六条命令（`…-final2-*`） |
| `…-integrity-generate-001` | 0 | `--generate` 的唯一一次真实写入：`source_changed` 只有 `src/adapters/openfilm/cache-worker-integrity.json` ✓ |

### 5.2 更早的失败与 INCOMPLETE（原样保留，本轮**没有**触碰）

| 名称 | 状态 | 说明 |
|---|---|---|
| `n1n2-claude-060p5d-red-python-002` | exit 1，**一次真实越界** | 真实 `os.kill(200, SIGTERM)` 事件；**事后 PID 不存在不能证明当时没有影响**；本轮**没有**重跑该实验，也**没有**触碰任何固定 PID |
| `n1n2-claude-060p5d-red-python`、`-red-python-003`、`-red-python-004`、`-red-identity`、`-red-pilot` | exit 1 | 旧逻辑下的红灯，原样保留 |
| `n1n2-claude-060p5d-red-tsc` | exit 2 | 同上 |
| `n1n2-claude-060p5d-fix-pilot-004` | exit 1 | **MAIN 的精确停止**（卡住的测试），**不是**自然超时，也**不是**语义反例 |
| `n1n2-claude-060p5d-fix-pilot-005` | **INCOMPLETE** | 只有 claim/cmd/inputs/txt，**没有** `.exit`、**没有** `.result.json`；本轮**没有**补造 |
| `n1n2-claude-060p5d-fix-pilot-006`、`-fix-identity-001`、`-fix-tsc-001`、`-fix-tsc-004` | exit 1 / 2 | 旧波次的中间态，原样保留 |
| `n1n2-claude-060p5e-*`（R5E 波次，含 `…-python-oldlogic-red`、`…-guard-identity`/`-002`、`…-identity-003`、`…-pilot-001..003`、`…-tsc-003`） | exit 1 / 2 | 上一波次的中间态与**故意**的红灯，原样保留 |

**没有**补造任何 PID、exit 或日志；**没有**把「未达 fixture 的失败」称作语义旧代码红灯 ✓。

## 6. 已知限制（如实声明）

1. **内部自验证**：本报告不构成独立安全复审，也不构成真实 N / N1N2 / R6 / R7 / R8 / V1 的验收；
   MAIN 的**受影响复核**仍在下一步。
2. **混合 lifecycle 文件只 typecheck**：`cache-custodian-lifecycle.test.ts` 的联合判定
   **未经运行**（本票禁止执行它）。可执行的覆盖放在 pilot 套件里：**同一个** checker、
   **真实**临时文件系统、**真实**发布之后再去破坏证据 ✓。
3. **checker 不观察外层退出码**：它验证内部协议与真实字节；**实际**观察到的退出码由外层
   recorder/acceptor 另核。本报告**不**把内存里的 exit 字段当作外层退出证据 ✓。
4. **协议与旧语义的差异（明确记录）**：R5E 的 exit 语义是「除拒绝参数外一律 1 或 0」；
   R5F **不**改变已批准的协议：普通业务失败**仍然**是 1（只是**不被接受**），
   证据/发布/读取/解析/协议/链接不可靠是 **3**，参数/入口拒绝**仍然**是 **2**。
   本轮**没有**把普通 failed 1 一律改成 3 ✓。
5. **一个取舍**：run 在复制 helper **之前**就拒绝（例如 pin 不符）时，它的 manifest 缺一个必需名
   ⇒ 证据不完整 ⇒ **3**（而不是 1）。这是 fail-closed 的取舍，R5E 已记录，本轮沿用 ✓。
6. **既有闭环未动**：原始 group 证明义务与 destructive authority 的分离、取消主因、晚到 N 回收、
   替代 PID 信号保护、无 root 不写 cwd、真实 reporting factory、bounded streams、
   同 root 独占 temp→完整 write→close→rename，**逐字节保持** ✓（custodian 与 python 测试未变）。
7. **未完成的更大范围**：R6/R7/R8、原 17+ISO18、真实冻结审查与下一接线包重锚**仍然 OPEN**；
   本票不替代它们。

## 7. 交还 MAIN

- 请对 §3 的**八份精确 SHA**与 §4 的**六条捕获**做只读复核；本轮的**唯一**新面是
  `verifyPublishedRun`（唯一的字节/protocol checker）、被它取代的三份旧 predicate、
  supervisor 的三个有界摘要字段，以及随之而来的测试。
- 本轮**没有**新的 429、没有重试、没有改模型供应商、没有由 Codex 自动接手；
  **没有** git 变更、没有 push、没有覆盖任何旧 capture、没有碰保护七文件与用户 dirty 工作、
  没有读改凭据/CLI 配置。
- 交还后**冻结字节**接受独立受影响复核；安全通过后由 MAIN 另发**真实 N 票**。
