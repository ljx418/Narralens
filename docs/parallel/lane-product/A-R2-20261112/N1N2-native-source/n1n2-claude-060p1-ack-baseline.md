# n1n2-claude-060p1 ACK 与基线

- release_id: MAIN_RELEASE_060P1_ISOLATED_CACHE_IMPLEMENTATION
- task_id: task_82ff141a33a3
- dispatch_id: ctx_514ede48a225
- lane: A-R2-20261112 / N1N2-native-source
- 实施者: 原 Claude（唯一 writer，沿用同一工作树 W，不新建 worktree/项目）
- ACK 实际时间 (UTC): 2026-11-14T07:56:46Z

## 恢复授权（同一 task 的新 dispatch）

- 用户明确指令：“ClaudeCode额度已经恢复了，继续执行goal”。
- MAIN 恢复记录：`repair-058/060P1_USER_RESUME_001.json`（`060P1_USER_RESUME_001_START_RECEIPT.json` 给出 dispatch `ctx_514ede48a225`、run `run_399f9dd3ce5a`、terminal `term_d0665d9c-43a6-4e89-8580-118e2777d3b1`）。
- 恢复不是自动重试：上一次的 429 停止回执 `repair-058/060P1_429_STOP_CONFIRMED.json` 完整保留，未被覆盖。
- 恢复记录中的 `release_sha256=885dd6c0…5200` 与 `spec_sha256=1d4a3370…72be` 已实测与
  `repair-058/RELEASE_060P1.json`、`repair-058/RELEASE_060P1_SPEC.md` 一致。
- 本次 ACK 之后再次核对：HEAD 仍 `1d348d419120f23f45d958112ea8c43df5a04675`，index 仍空，
  059/P0 的全部 dirty 与证据文件仍在原处；本票八个新路径在本波开始时**都不存在**（070P1 的
  `existing_raw_sha256` 与 `all_prior_dirty_source_sha256` 逐项实测一致，见下表）。

## 基线事实（实际核对）

- HEAD: 1d348d419120f23f45d958112ea8c43df5a04675（与 RELEASE_060P1.json base_head 一致）
- git status --porcelain 行数: 268（含 059/P0 全部 dirty 与 untracked 证据文件）
- git index: 空（`git diff --cached --stat` 无输出）

## existing_raw_sha256 逐项核对（实际 sha256sum 结果）

| 路径 | RELEASE 值 | 实测 | 结果 |
|---|---|---|---|
| src/adapters/openfilm/openfilm-upstream.ts | 1583d4aba7f1a2fde487b1339745a039759d09b29fe81edc3268a76edb054e41 | 1583d4aba7f1a2fde487b1339745a039759d09b29fe81edc3268a76edb054e41 | MATCH |
| src/host/agent-driven/created-native-workspace.ts | 3702917cf6efe09287030435c1883e1cdd57eb6e0da2fdd577bf3879ab965c1e | 3702917cf6efe09287030435c1883e1cdd57eb6e0da2fdd577bf3879ab965c1e | MATCH |
| src/host/agent-driven/created-native-source-reader.ts | 057015a54e9daee8d08f56eadbd7b2766622f2f915f29a0ebc330e0d4cc676b6 | 057015a54e9daee8d08f56eadbd7b2766622f2f915f29a0ebc330e0d4cc676b6 | MATCH |
| tests/m2.1/openfilm-upstream-lock.test.ts | 9b2cf8525c7e51da9a7c0d9eb579b65be56a679651fcbb5bfb5bd8e1424c175a | 9b2cf8525c7e51da9a7c0d9eb579b65be56a679651fcbb5bfb5bd8e1424c175a | MATCH |
| tests/agent-driven/integration/native-cache-witness.test.ts | 6ba76059a41c1820d580ea0a7ae684f62b7afcd445bdc431a1524b8c7647ccd4 | 6ba76059a41c1820d580ea0a7ae684f62b7afcd445bdc431a1524b8c7647ccd4 | MATCH |
| tests/agent-driven/integration/created-native-source-reader.test.ts | 6325eab3e4411e77a0b000a084793fb57545d961437c572d0a990625a50d9784 | 6325eab3e4411e77a0b000a084793fb57545d961437c572d0a990625a50d9784 | MATCH |

## all_prior_dirty_source_sha256 逐项核对

| 路径 | RELEASE 值 | 实测 | 结果 |
|---|---|---|---|
| src/adapters/openfilm/openfilm-upstream.ts | 1583d4ab…4e41 | 同上 | MATCH |
| src/host/agent-driven/committed-snapshot-authority.ts | e7277382b1b3819d1f6aaa8459dc4d2bf904169d31e614aa45ac6a7b3c610f8b | e7277382b1b3819d1f6aaa8459dc4d2bf904169d31e614aa45ac6a7b3c610f8b | MATCH |
| src/host/agent-driven/created-native-source-reader.ts | 057015a5…76b6 | 同上 | MATCH |
| src/host/agent-driven/retained-native-closure.ts | fd896104149d6cd2663b63a59d50beabbeee546f3e3f46a5d6bf07fbe662ede9 | fd896104149d6cd2663b63a59d50beabbeee546f3e3f46a5d6bf07fbe662ede9 | MATCH |
| tests/agent-driven/integration/created-native-source-reader.test.ts | 6325eab3…9784 | 同上 | MATCH |
| tests/m2.1/openfilm-upstream-lock.test.ts | 9b2cf852…175a | 同上 | MATCH |
| tests/agent-driven/integration/helpers/native-read-byte-observer.mjs | a249498702425a01cb3964ef87cfddbbd036b6998a2d03a8938a755d43b89169 | 同上 | MATCH |
| tests/agent-driven/integration/helpers/native-read-growth-child.mjs | 2a31e13d30b98d161a69fcd4c33a125d2733762adb65dddb75fd1b79517f5c84 | 同上 | MATCH |
| tests/agent-driven/integration/openfilm-serving-url.test.ts | 6c02e6d3cf56f60e33cbbb74a1b56bef3eaabbb20f10bba025e41e4f3de74e2b | 同上 | MATCH |
| tests/agent-driven/integration/retained-native-budget.test.ts | 3241bdd2c8b7b958e9852db2f28bd831f5a6f70bd2c09d975c09295769e7cd9d | 同上 | MATCH |
| tests/fixtures/openfilm-serving-url-child.mjs | db3caf37f9983bdebf69ea76795925c79a446e88a779e063235f3d402d085a41 | 同上 | MATCH |

## 其他绑定摘要

- protected_AGENTS_sha256: 37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b — 实测 AGENTS.md = 37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b → MATCH
- adr_sha256: 27c6bcbc46ab5473716cc04a92ac3f50a1ee027d68045db72048af488168d6f2 — 实测 ADR_060_ISOLATED_CACHE_DRAW.md = 27c6bcbc46ab5473716cc04a92ac3f50a1ee027d68045db72048af488168d6f2 → MATCH

## 结论

全部 existing_raw_sha256 / all_prior_dirty_source_sha256 / protected AGENTS / ADR 摘要实测一致，可以按本票精确 allow_existing / allow_new 开始实施。059 与 060P0 的 dirty、失败证据、用户工作全部保留，未触碰 git index。
