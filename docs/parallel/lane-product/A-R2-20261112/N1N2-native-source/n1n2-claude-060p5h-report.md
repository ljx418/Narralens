# n1n2-claude-060p5h — R5H 必需 nullable 字段：一次统一存在性收口

本文件是 R5H（`MAIN_R5H_REQUIRED_NULLABLE_SINGLE_GATE`，SPEC sha256
`b17e2e2b07f57fa7df62e553fce302fd37b23d419c293cc071ab7d5ebc488f35`）的 OWN 报告。
本轮关闭 R5G 独立受影响复审的**唯一**未闭项 **R5G-O01**（mandatory nullable 字段的
**自有属性存在性**与 null snapshot 分支），并沿用已审完整契约
（`RESULT_CONTRACT_AND_CASE_MATRIX.md`，sha256
`493f86e334b25a4d2fa240b2248f485c910f379747b9c7e1e91ec4b82f124319`）的 F07/F10 义务；
**没有**新增产品或 kernel 范围，**没有**另造 checker，**没有**重开已关闭的 kernel/guard。

HEAD 仍是 `1d348d419120f23f45d958112ea8c43df5a04675`，**git index 空**，**没有** add/commit/push/
merge/reset/stash/checkout ✓。本轮**只**改了 `tools/native-cache-normal-pilot.ts` 与
`tests/agent-driven/integration/native-cache-normal-pilot.test.ts` 与本报告 ✓；其余六份既有文件
**逐字节未变** ✓（见 §4）；用户的 dirty 工作与保护七文件**原样保留** ✓。

## 0. 边界（如实声明）

- **只**执行了 `RELEASE.json` 的六种 recorder 命令形态，全部经
  `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`，
  capture 前缀 `n1n2-claude-060p5h-`；**没有** timeout 包裹 recorder、**没有**造 PID/exit、
  **没有**覆盖任何已有 capture。
- **没有**执行真实 C/N、真实 pilot、Host/Chrome/媒体/网络/付费、Q2、全量门、build、
  **混合 lifecycle 测试文件**（`cache-custodian-lifecycle.test.ts` **只 typecheck、不可执行**）、
  J 盘、Git 变更、凭据/CLI 配置。
- 原 pure guards **没有**弱化 ✓；原始 group / reaping / authority / cancel 算法**没有**重写 ✓
  （supervisor 与 custodian **逐字节未变** ✓）。
- **没有**继续增加 20s 预算、**没有**改生产 deadline、**没有**改断言求绿 ✓；
  旧 5s/20s 超时的**根因仍未知** ✓（见 §6.2）。
- 本报告**只是内部自验证**：**不**自签独立审查，**不**声明真实 N、N1/N2、R6/R7/R8、V1。

## 1. 统一修法（一次存在性收口）

### 1.1 局部 required-own-field 表（内部 tool，不是新的公共 schema）

`tools/native-cache-normal-pilot.ts:152`/`:164`/`:172`/`:189` 四张表，逐项**对照真实 writer** 核对过
（candidate 对象 `:1628` 起、manifest `:1685` 起、final `:1712` 起、`REAL_DEPENDENCIES.artifactFacts`）：

| 表 | key 数 | 内容 |
|---|---|---|
| `REQUIRED_CANDIDATE_KEYS` | 19 | kind, authoritative, mode, root, custodian_sha256, fixture_sha256, copied_fixture_sha256, scenario, expected_image, actual_image, original_failure, settlement_failure, cleanup_facts, terminal_proof, terminal_proof_observations, receipt_summary, accumulator_summary, raw_segments_saved, timeline |
| `REQUIRED_MANIFEST_KEYS` | 8 | kind, authoritative, root, artifacts, listing_error, excluded, exclusion_reason, required_artifacts |
| `REQUIRED_FINAL_KEYS` | 28 | kind, authoritative, publication_protocol, mode, root, exit_code, kind_of_run, fault_case_passed, terminal_proof, picture_sha256, picture_bytes, picture_is_the_exact_one, original_failure, settlement_failure, cleanup_facts, reporting_failure, reporting_failures, evidence_errors, evidence_problems, manifest_error, required_artifacts, candidate_sha256, candidate_bytes, manifest_sha256, manifest_bytes, terminal_proof_observations, diagnostic_snapshot |
| `REQUIRED_ARTIFACT_ROW_KEYS` | 4 | name, digest, bytes, **error** |

### 1.2 门的位置与语义

- `:199` `missingRequiredKeys()`：用 **`Object.hasOwn`**（**不是** `in`：继承属性不是已发表字段），
  且 **own property 的值若是 `undefined` 也算缺失** ⇒ **只有真正的 `null` 才表示「这里没有东西」** ✓。
- `:2371`–`:2382`：三份记录的存在性门，**在 baseline / mode / ordinary 分支之前**执行 ✓；
  既有类型门与语义门**随后照常执行** ✓。
- `:276` `artifactRowProblems()`：每一行先过 own-property 门（**含 `error`**）；
  `error` 必须是**显式 null**（无错）或**合法 bounded failure**；
  **不能**用「删掉 error」来表示无错 ✓；有效的非 null error 仍然让证据不可靠 ✓。
- F10 的三个「无错」字段改为 `!== null`（**不再**接受 `undefined` 当作无错）：
  `manifest.listing_error`（`:2397`）、`final.reporting_failure`（`:2610`）、
  `final.manifest_error`（`:2616`）✓。
- `:2528` null baseline 分支：`final.diagnostic_snapshot` 必须**存在且明确 null**；
  `candidate.receipt_summary` / `candidate.accumulator_summary` /
  `candidate.terminal_proof_observations` / `final.terminal_proof_observations`
  **四字段也必须各自存在且明确 null** ✓；**没有 snapshot 时不会造一个 mock 证明来过门** ✓。
- 非 null baseline 分支：四个摘要**全部**与基线比较，**不再**有 optional 跳过 ✓。

### 1.3 全面扫描（不止 review 列出的三四个 if）

按指令扫了工具里所有 `!== null && !== undefined` 与 optional 跳过：

| 位置 | 处置 |
|---|---|
| `artifactRowProblems` 的 `row.error` | **改**：own-property 门 + 显式 null ✓ |
| `manifest.listing_error` / `final.reporting_failure` / `final.manifest_error` | **改**：`!== null` ✓ |
| `errorFactDifference` / `cleanupFactsDifference` 的 `value === undefined` | **已正确**：「does not carry the field」⇒ 差异 ⇒ 3 ✓（保留） |
| `sameFacts` 的 `expected === undefined` | **已正确**：那是**基线**（actual 对象）没有该字段，不是记录缺字段 ✓（保留） |
| `canonicalError` / `settlementIsTheOriginal` / `boundedError` 的 undefined | **已正确**：那是 **actual 对象**，不是已发表记录 ✓（保留） |
| `evidenceProblemsOf` 的 `candidateRow !== undefined` | **已正确**：candidate 行缺失时，必需名门（`ENOENT`）先拒绝 ✓（保留） |
| baseline 分支的 `if (baseline.receipt_summary !== null || …)` 跳过 | **删除**：四个摘要无条件比较 ✓ |

**没有**为了让某个 case 变绿而放宽任何谓词 ✓；**没有**削弱 guard ✓。

## 2. 逐 key/case → 代码 → actual consumer → recorded 证据

测试全部在 `tests/agent-driven/integration/native-cache-normal-pilot.test.ts`：
`:2778`/`:2786`/`:2790` 的三张**独立于工具**的发布 key 表（**合同**），
`:2801` 的 `the PRESENCE of every published field`、`:2932` 的 `the run WITHOUT a snapshot`、
`:2743` 的 `the run WITHOUT a root`。
变更发生在**真实 writer / publisher 的写边缘**（既有 `tamperWith`）：复制记录、改**一项**、
再交给**真实** writer/publisher 序列化 ⇒ 真实 mapper、真实 hash、真实长度、真实 links
**自然对应真实坏字节** ✓；**没有**伪造 hash ✓；**没有**复制 consumer ✓。

| 合同义务 | 代码 | actual consumer | 测试 | recorded 证据 |
|---|---|---|---|---|
| **F10 每个已发表 key 必须存在** | `:2371`–`:2382` 的三张表门 | actual main / legacy / pure **同一个** `verifyPublishedRun` | `refuses the publication without $id`（**55 个 key 各一条**：candidate 19 + manifest 8 + final 28） | `…-pilot-004`、`…-final-pilot`（exit 0） |
| **F10 行必须存在 `error`** | `:276` `artifactRowProblems` + `REQUIRED_ARTIFACT_ROW_KEYS` | 同上 | `refuses a manifest whose artifact row does not carry its error` | `…-pilot-004` |
| **F10 有效非 null error 仍不可靠** | `:276`（非 null 且合法 ⇒ 差异）、`:2397`/`:2610`/`:2616` | 同上 | `refuses a final.reporting_failure that carries a REAL failure`、`refuses a manifest.listing_error that carries a REAL failure`、`refuses an artifact row that carries a REAL failure` | `…-pilot-004` |
| **F07 null baseline：四字段存在且明确 null** | `:2528` | 同上 | `the run WITHOUT a snapshot` 的四条「missing」与四条「wrong type」；`refuses the run without the snapshot when … is missing` | `…-pilot-004` |
| **F07 null baseline：合法 ordinary 1 保留** | `:2528` + kind=`failed` 的 ordinary 分支 | 同上 | `keeps it reliable, not accepted, and at the exit code 1`（helper 已拷贝后 `createSupervisor` 抛普通 Error ⇒ root/helper/三记录完整、actual snapshot 为 null ⇒ reliable=true / accepted=false / **1**） | `…-pilot-004` |
| **no-root 先拒绝 3，不读不存在的 final/cwd** | `:2371` 之前的 root 门 + producer 的 no-root 分支 | actual main | `answers 3 and it writes NOTHING`（断言 repo 根下**没有** final/candidate/manifest） | `…-pilot-004` |
| **既有矩阵仍成立** | — | 同上 | 原 **186** 例（normal 0、确切 fault 1、wrapper cause、ordinary 1、参数 2、mandatory 证据 3）全部保留 ✓；并把先前标成「wrong type」却其实只是**换了一个 string** 的条目改成**真正的错型**（字符串字段用 array/object）✓ | `…-pilot-004` |

### 2.1 安全红灯（本轮新反例在 R5G 逻辑下**确实失败**）

`n1n2-claude-060p5h-pilot-oldlogic-red`（exit 1，**21 failed / 232 passed**）：
把 checker 的**结果事实门**在**其辅助函数层**中和回 R5G 的语义
（`missingRequiredKeys` 恒返回空、F10 的三个 `!== null` 恢复成 `!== null && !== undefined`、
行 `error` 恢复同形、null baseline 分支的四字段检查清空），
**字节链、全行规则、发布与报告门保持原样** ⇒ 这正是 R5G checker 对这些用例的行为。

- 失败的 21 条正是**只被存在性门挡住**的那些：
  `candidate.custodian_sha256`、`candidate.fixture_sha256`、`candidate.copied_fixture_sha256`、
  `candidate.scenario`、`candidate.timeline`、`manifest.authoritative`、`manifest.listing_error`、
  `manifest.exclusion_reason`、`manifest.required_artifacts`、`final.reporting_failure`、
  `final.manifest_error`、`final.required_artifacts`、行缺 `error`、
  以及 null baseline 的四字段 ×（缺失 / 错型）✓。
- **准确表述**：这是一个**辅助函数 neutralization mutant**——它**不是**存档 R5G tool 的逐字节重放
  （其 tool SHA 与 R5G 终态不同），只说明**该 mutant 让这 21 条断言失败** ✓；
  **不**宣称它是「26 条历史语义失败」的同类物 ✓。
- 跑完后工具文件**按 sha256 逐字节还原**（`sha256sum -c` 通过 ✓，无 RED LIGHT 标记残留 ✓）✓。

## 3. 测试规模

| 套件 | R5G 终态 | R5H 终态 |
|---|---|---|
| identity | 87 passed | **87 passed**（未变） |
| python | 59 passed | **59 passed**（未变） |
| pilot | 186 passed | **254 passed**（+68：55 个已发表 key + 行 error + 3 个真错 + null baseline 8 条 + no-root 1 条） |

## 4. 最终八文件 hash

| 路径 | sha256 | 与 R5H `start_sha256` |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | `7706449e8f259a6e17e9ca2a40af8a5c344cef827a01c7881fc04a4a570b9b63` | **逐字节未变** ✓ |
| `src/adapters/openfilm/cache-process-custodian.py` | `bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79` | **逐字节未变** ✓ |
| `src/adapters/openfilm/cache-worker-integrity.json` | `7bb4bd1813987a6860bb9eb7a332ccbedb237c009a8767bc75e6418f1595c2db` | **逐字节未变** ✓（`--generate` 幂等，`source_changed=[]`） |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | `d4e60d2d81c78c3c01e62d7bec232a4371cf81b9426ae13ecdf77c91c90ad8bf` | **逐字节未变** ✓ |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `f35721741cb62afc946b84c507d029ff16746c739d5b63b0335f49d7855efa61` | **逐字节未变** ✓ |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | `230cbf8882e903a8752d663d2ff58f7cc729d5ab6e129ec2e566ba15a8077258` | **逐字节未变** ✓ |
| `tools/native-cache-normal-pilot.ts` | `e4db3499f715d5b6b5634568677a6688cf80a897c9321c45e93cda98c6a19ebb` | **已变**（统一存在性门 + nullable 收口） |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | `5dc95e5602bfbbb57303fc068ce82b5d4b6f902c8dceaec21c08eedb7ea24be9` | **已变**（逐 key 矩阵 + null baseline + no-root + 真错型标签） |

**保护七文件**：逐项实测**全部 MATCH** ✓。

## 5. 最终捕获（同一最终源字节，`source_changed` 全部为 `[]`，651 个输入文件零漂移）

| capture | 命令 | exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-060p5h-final-integrity-generate` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | **0** | `4c25cc12a7c348fe34847d0f81b72ebf0a57c767533a3912e540f6a84d5ade39` |
| `n1n2-claude-060p5h-final-tsc` | `corepack pnpm exec tsc --noEmit` | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `n1n2-claude-060p5h-final-identity` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | **0** | `0ce2ee145a60102528c64a8263293ab509648115e84fd55889c0adbb8739f9ab` |
| `n1n2-claude-060p5h-final-python` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | **0** | `1aa0ede09d92b87760bb502ce84ed6c4f7db5939222ec68ee3ee84cbdb1fb3ec` |
| `n1n2-claude-060p5h-final-pilot` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | **0** | `0569523d38e66923d95c1a199cb792d7f55bb8353dce6789460b7dcc7d8f1844` |
| `n1n2-claude-060p5h-final-integrity-check` | `node tools/openfilm-cache-worker-integrity.mjs --check` | **0** | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` |

## 6. 失败索引（全部保留，未覆盖、未补造）

### 6.1 本轮中间捕获

| capture | exit | 含义 |
|---|---|---|
| `…-tsc-003` | 2 | 新增 no-root 用例的一处语法笔误（`new StubSupervisor`）→ 已改（**不是**语义红灯） |
| `…-pilot-003` | 1 | 同一处语法笔误导致套件**没有收集到任何用例**（`Tests no tests`）→ 已改 ✓ |
| `…-pilot-001` / `…-pilot-002` | 0 | 存在性门后的绿 ✓ |
| `…-pilot-oldlogic-red` | **1** | **安全红灯**：R5G 逻辑下 **21** 条新反例失败（§2.1）✓ |
| `…-pilot-004` | 0 | 扩展后的绿（254）✓ |
| `…-final-*` | 0 | 最终六命令 ✓ |

### 6.2 超时事实（如实记账，根因仍未知）

- 老 **5s** 失败（R5F `n1n2-claude-060p5f-final-pilot`）与 R5G 的一次 **20s** 失败
  （`n1n2-claude-060p5g-pilot-001`）**原样保留** ✓；
- **20s 仍是 harness 预算调整，不是生产 deadline** ✓；本轮**没有**再加预算、
  **没有**改生产 deadline、**没有**改断言求绿 ✓；本轮的所有运行**没有**再次出现该超时 ✓；
- **根因未证实**：**没有**「机器繁忙已证实」的说法 ✓；它**不是**内核活性证明 ✓；
- **afterEach 清表不等于等待旧 promise 已终结**：本套件的 `afterEach` 清的是
  `PILOT_REGISTRY` / 脚本 / map，**没有** settle 已经超时的原 promise，也**没有**统一取消
  FakeCustodian 的定时器 ⇒ 失败用例之后的旧 fake 操作仍可能继续 ✓。
  本报告**不**声称「finally 已经等完」✓；这只是测试隔离/诊断的局限，
  **没有**建立新的真实 OS 信号逃逸路径（`process.kill` 拒绝 wrapper 从不恢复、`child_process`
  保持 mock）✓。

### 6.3 更早的失败与 INCOMPLETE（原样保留，本轮**没有**触碰）

| 名称 | 状态 | 说明 |
|---|---|---|
| `n1n2-claude-060p5d-red-python-002` | exit 1，**一次真实越界** | 真实 `os.kill(200, SIGTERM)` 事件；**事后 PID 不存在不能证明当时没有影响**；本轮**没有**重跑，也**没有**触碰任何固定 PID |
| `n1n2-claude-060p5d-red-python`、`-red-python-003`、`-red-python-004`、`-red-identity`、`-red-pilot`、`-red-tsc` | exit 1 / 2 | 旧逻辑下的红灯，原样保留 |
| `n1n2-claude-060p5d-fix-pilot-004` | exit 1 | **MAIN 的精确停止**（卡住的测试），**不是**自然超时，也**不是**语义反例 |
| `n1n2-claude-060p5d-fix-pilot-005` | **INCOMPLETE** | 缺 `.exit` 与 `.result.json`；本轮**没有**补造 |
| `n1n2-claude-060p5d-fix-pilot-006`、`-fix-identity-001`、`-fix-tsc-001`、`-fix-tsc-004` | exit 1 / 2 | 旧波次中间态，原样保留 |
| `n1n2-claude-060p5e-*`、`n1n2-claude-060p5f-*`、`n1n2-claude-060p5g-*` | exit 1 / 2 | R5E/R5F/R5G 波次中间态与**故意**红灯（含 R5E 的 `…-python-oldlogic-red`、R5G 的 26-red mutant），原样保留 |

**没有**补造任何 PID、exit 或日志；**没有**把「未达 fixture 的失败」称作语义旧代码红灯 ✓；
**没有**伪造 raw segments ✓。

## 7. 已知限制（如实声明）

1. **内部自验证**：不构成独立受影响复审，也不构成真实 N / N1N2 / R6 / R7 / R8 / V1 的验收 ✓。
2. **checker 不是身份认证器**：它的信任前提是**同进程、同一次** actual outcome ✓（R5G 的结论不变）✓。
3. **混合 lifecycle 文件只 typecheck**：legacy 消费者的联合判定**未经运行**；
   可执行覆盖在 pilot 套件里，用**同一个** checker 与**真实**临时 FS ✓。
4. **CLI 不观察外层退出码**：checker 只验内部协议与真实字节；**实际**观察到的退出码由外层
   recorder/MAIN 另核 ✓。
5. **mock 终局事实不是内核证明**：stub 的 `proven:true` 是**显式 mock**；生产门**没有**为它放宽 ✓。
6. **协议未变**：普通业务失败**仍然**是 1（只是**不被接受**）；证据/发布/读取/解析/协议/链接/
   **存在性**不可靠是 **3**；参数拒绝**仍然**是 **2** ✓。
7. **既有闭环未动**：原始 group 证明义务与 destructive authority 的分离、取消主因、晚到 N 回收、
   替代 PID 信号保护、无 root 不写 cwd、真实 reporting factory、bounded streams、同 root 独占
   temp→完整 write→close→rename、逐 case 脚本与 deny ledger 的 finally 隔离，**逐字节保持** ✓。
8. **未完成的更大范围**：R6/R7/R8、原 17+ISO18、真实冻结审查与下一接线包重锚**仍然 OPEN** ✓。

## 8. 交还 MAIN

- 请对 §4 的**八份精确 SHA**与 §5 的**六条同源捕获**做只读复核；本轮的新面是
  `verifyPublishedRun` 的**统一 own-property 存在性门**、F10 nullable 的显式 null 收口、
  null baseline 分支的四字段门，以及随之而来的 68 条 pure 反例
  （其中 21 条已证明在 R5G 语义的 mutant 下失败）。
- 本轮**没有**新的 429、没有重试、没有改模型供应商、没有由 Codex 自动接手；
  **没有** git 变更、没有 push、没有覆盖任何旧 capture、没有碰保护七文件与用户 dirty 工作、
  没有读改凭据/CLI 配置。
- 交还后**冻结字节**接受独立受影响代码复核；安全通过后由 MAIN 另发**真实 N 票** ✓。
