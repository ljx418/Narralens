# n1n2-claude-060p1r ACK 与基线

- release_id: `MAIN_RELEASE_060P1R_REV3_CUSTODIAN_REPAIR`
- task_id: `task_10c4ac8146ae` / dispatch_id: `ctx_95f1131694b8`
- 实施者: 原唯一 Claude（沿用同一工作树 W，不新建 worktree/项目）
- 前序: 060P1 已交还（`msg_976da93154ee`），经独立静态代码复核 `REQUEST_CHANGES`（1 BLOCKER / 9 MAJOR / 1 MINOR / 2 NOTE）。**060P1 不是 P2 PASS**；本票是 rev3 修订，不是 P2。
- 旧 429 与全部失败保留：`repair-060p1-review/` 内的 `code-review/FINDINGS.json` P1-N02 已记录 060P1 两次开发期失败为 **UNRECORDED/UNKNOWN**；本票**不补造**那两次失败的原日志，只在新日期新 argv 下另做反事实。

## 基线事实（实际核对，命令与结果逐项）

- HEAD: `1d348d419120f23f45d958112ea8c43df5a04675`（= release `base_head`）
- branch: `agent-driven/main-a-integration`（= release `branch`）
- git index: **空**（`git diff --cached --stat` 无输出）
- 未执行任何 git add/commit/reset/stash/checkout/push/merge。

### 14 个 existing 文件原字节（实测 sha256 == release `existing_raw_sha256`）

| 路径 | 实测 | 结果 |
|---|---|---|
| src/adapters/openfilm/openfilm-upstream.ts | 5a417f9ebe231ad332589e0fa299d24602285f002a33991373f3ca839ab23579 | MATCH |
| src/host/agent-driven/created-native-workspace.ts | bbf25b455d95a780f96719c83a414b4f0e8cb02b7cd4932e5535576a45e6bf94 | MATCH |
| src/host/agent-driven/created-native-source-reader.ts | 0a52b8ff16652cf4bf439ef19812b05a4a417396a9139dd4ee4ce7df8505289e | MATCH |
| tests/m2.1/openfilm-upstream-lock.test.ts | 9b2cf8525c7e51da9a7c0d9eb579b65be56a679651fcbb5bfb5bd8e1424c175a | MATCH |
| tests/agent-driven/integration/native-cache-witness.test.ts | 02a7b90f4163e36fd039ee865b15c08860f4ee295c403eed996617b2eca306c1 | MATCH |
| tests/agent-driven/integration/created-native-source-reader.test.ts | 6325eab3e4411e77a0b000a084793fb57545d961437c572d0a990625a50d9784 | MATCH |
| src/adapters/openfilm/cache-production-scope.ts | 62950689cafa932e062f376d5201508772d2b8e25c3de3759ca4d25d24e2cc3f | MATCH |
| src/adapters/openfilm/cache-process-supervisor.ts | 1f9d559024d817308b5890088809a45b20cb0eb991d740214a7d97efab152c27 | MATCH |
| src/adapters/openfilm/openfilm-cache-worker.mjs | eae2aa1c1f26b05938784b14eaec7bb58fdb6a9791a3c82d0eed609f749eaed5 | MATCH |
| src/adapters/openfilm/cache-worker-policy.mjs | 55c08c83d6d1f0f6cfa4e042e3aa0703f3ca2a8bcb62418be1e32175a090ddd1 | MATCH |
| src/adapters/openfilm/cache-worker-integrity.json | 0def2c352eba2562dd8e41252e5008ad31cdf4906320d97a8814959ad69d275d | MATCH |
| tools/openfilm-cache-worker-integrity.mjs | 4c207c8d41bcd0601eadafb9294733eefce9f1af542cfd7add1a8c4dd62fc18b | MATCH |
| tests/agent-driven/integration/cache-production-scope.test.ts | cb79ce0ee6b070b878594f91626d65f8c2662ff726cb0da6553669003cf69a9c | MATCH |
| tests/agent-driven/integration/cache-process-settlement.test.ts | 309b1c12adbbca2113c5b7acd21fe887eeebbc01bd7b075e360c9af0aee2df16 | MATCH |

### 7 个新文件在开工前均不存在

`src/adapters/openfilm/cache-process-custodian.py`、`tests/agent-driven/integration/helpers/cache-worker-fixture.mjs`、`tests/agent-driven/integration/helpers/cache-probe-fixture.mjs`、`tests/agent-driven/integration/cache-custodian-lifecycle.test.ts`、`tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts`、`tests/agent-driven/integration/cache-process-identity.test.ts`、`tests/agent-driven/integration/cache-serving-drain.test.ts` —— 逐个实测 absent。

### 保护与规范摘要

- protected AGENTS: `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` —— 实测 AGENTS.md 一致 → MATCH
- 9 份 normative 文档 sha256 全部与 `RELEASE_060P1R.json` 的 `normative_document_sha256` 一致：ADR_060_REV3_CUSTODIAN_AND_REPAIR.md `326bed74…95ac`、ADR_060_REV3_BINDING.json `f77e8df2…7346`、REV3_DOCUMENT_APPROVAL.json `6ea04a08…af13`、060P1R_PRIVATE_CONTRACT.md `bead5edc…3a2e`、PYTHON_ENVIRONMENT_BASELINE.json `39b65976…a538`、code-review/FINDINGS.json `688f8f40…babe`、code-review/REVIEW.md `0e9958e0…92bc`、lifecycle-design/REVIEW.md `a7106a97…d45`、rev3-document-review/REVIEW.md `52a09d01…78f5`。

## Python 运行前提（按 PYTHON_ENVIRONMENT_BASELINE.json，**本票不执行任何内核动作**）

- 解释器: `/usr/bin/python3.12`，version 3.12.3，sha256 `e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f`，8020928 bytes
- 已观察到的 stdlib 能力符号: fork / setsid / waitid / waitpid / WNOWAIT / WEXITED / WNOHANG / P_PID —— **仅符号存在**；prctl 与实际 wait 行为 **NOT_RUN**
- 本票唯一允许的 Python 运行是 `ast.parse` 语法检查；custodian 主程序、prctl、fork、setsid、wait、signal 一律不执行。

## 结论

基线全部一致，可以按本票精确 `allow_existing` / `allow_new` 开始 rev3 修订。059/P0/060P1 的全部 dirty、失败与用户工作保留，git index 仍为空。
