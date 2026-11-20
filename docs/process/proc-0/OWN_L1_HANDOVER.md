# OWN_L1_HANDOVER — PROC-0 L1 交还（逐 case + 真实原件/旁证引用）

实施者：ClaudeCode（PROC-0 唯一实施者）。本文件是 **L1 代码候选的交还材料**，不是验收结论：
不签 L2/L3/L4，不是产品验收，不证明业务语义。

## 1. 本次执行的事实

- 票：`D/implementation/bootstrap-003/RELEASE.json`，外部信任 SHA-256
  `5cd157511a0e4888383835b57563cf842e65427848386956c8632459a3e39a92`（实算一致）。
- `phase=BOOTSTRAP_CODE`、`owner_task=task_d0bbeef5f54f`、`generation=3`、
  `base_head=9bde8c4584e3d13bcad474564caccfcbce2ced6f`（与实际 HEAD 一致）。
- 票面核对（只用标准库实算，未把 656 行摘要读入上下文）：
  `recorded_source` 656 项**不匹配 0**，`protected_inputs` 6 项**不匹配 0**。
- observer：`D/implementation/bootstrap-001/observe-first.py`（受保护），cwd = W，无 timeout、无后台。
- 唯一获准执行的是三条原 recorder FIRST 的纯 mock 验证；实际新 runner、corepack/node、R6、
  helper、产品、信号、网络**均未放行**，本轮也未执行。

| 门 | 命令 | inner | recorder outer wait | resource_status | metadata_ok | observer | direct 测试 |
|---|---|---:|---:|---|---|---:|---|
| B1 | `tests/process/test_delivery_admission.py` | 0 | 0 | CLEAN | true | 0 | **Ran 25 tests … OK** |
| B2 | `tests/process/test_delivery_handoff.py` | 0 | 0 | CLEAN | true | 0 | **Ran 24 tests … OK** |
| B3 | `tools/check-delivery-spec.py --self-test` | 0 | 0 | CLEAN | true | 0 | 自检 28 个分支全执行，scope `SYNTHETIC_METADATA_ONLY` |

三者 `source_changed []`、`source_added []` → **运行期零源漂移**。

## 2. 真实原件与旁证引用

原 recorder 目录（`W/docs/execution/A/implementation-20261111/integration/e1-main-takeover/`）：

| capture | 六件套实算 SHA-256 |
|---|---|
| `proc0-l1-admission-003` | `.claim.json d5242abc93c70d0171b0a783df7e7995716f7c4abb10716bd4518dbc3152f122` / `.cmd.json 699e8841958c4ccb3551268f034ea902a358834d7bf175725a6d4430204ba2b0` / `.inputs.json d8ccfb2f1693b619a8f62bdf32fb9ade0b85d7debea71a7c7f14c92639b7be07` / `.txt f3c5eebbbb813528cf308dbcebd3117d2639a165646b8fa0ae9ff6884e2e9ac6` / `.exit 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` / `.result.json 4ed90b613c51086ae79c8846dabdeb1177861437dcf73e33f918ed0d894b9dbb` |
| `proc0-l1-handoff-003` | `.claim.json 1f5b418fdf94e37b368361fd1b7168c34f69cbf4c4f289ae48011f85d192f3ef` / `.cmd.json 2a4316dd83e3c7977f2066324fd33a6aff120081b00dbed83b003b1a0fa733aa` / `.inputs.json d8ccfb2f1693b619a8f62bdf32fb9ade0b85d7debea71a7c7f14c92639b7be07` / `.txt a15bd16bea3e3c08899ecc08f08889be8f95b06d280c935abf625f1990461039` / `.exit 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` / `.result.json a4e68c9ac294e03f5e71a6ae604c46c355e19bfd28e939caff8422de471dd02d` |
| `proc0-l1-checkself-003` | `.claim.json bd01b6bb7bd0324914e8ed96c979abd1177690403f223ba45cd0ee97ea5d0041` / `.cmd.json b808b9e3074d3c10b6ccd22e3674f1b34ff12bab5901d5a9e917a46bfe62ab6a` / `.inputs.json d8ccfb2f1693b619a8f62bdf32fb9ade0b85d7debea71a7c7f14c92639b7be07` / `.txt ca1d88d545086f47109863c0c61702cc9a1433984f8f91ba4cb612c2772bc3e8` / `.exit 9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` / `.result.json 5d06df34e1d49b71eb0a6d3cee529366568adc7919c119d18020022eda9e76cd` |

observer 旁证（`W/var/process-admission/proc0-l1-20261120/bootstrap/`）：

| run_id | 旁证 | 旁证文件 SHA-256 |
|---|---|---|
| `proc0-l1-003-b1` | `proc0-l1-003-b1.json` | `f2b3ea0226d4256da9ec6101b1d08837ff0d2e99d597bef91ff575f6e6d0b458` |
| `proc0-l1-003-b2` | `proc0-l1-003-b2.json` | `379a46cc938dc41b44c838c7f397e61dd0ea891fc94d20192e15b969cb0b350d` |
| `proc0-l1-003-b3` | `proc0-l1-003-b3.json` | `118af575048d9bf57118722ccda2b03f7d321fb010dbb4cca7d94523ad145f3d` |

三份旁证均记录：`evidence_layer=BOOTSTRAP`、`inner_exit=0`、`recorder_wait_returncode=0`、
`resource_status=CLEAN`、`metadata_ok=true`、`cleanup_source.kind=MAIN_bootstrap_wait_and_owned_group_observation`。

## 3. 逐 case 的 direct 证据（16 项全部有直接映射）

`A` = `tests/process/test_delivery_admission.py`（B1 背书）；
`H` = `tests/process/test_delivery_handoff.py`（B2 背书）；`S` = checker 自检（B3 背书）。

| case | direct 测试 | 背书 |
|---|---|---|
| PROC0-01 | `A::test_proc0_01_unknown_command_and_bad_release_are_refused`、`A::test_proc0_01_a_signed_corepack_command_uses_the_fixed_outer_interpreter`、`A::test_proc0_01_the_caller_cannot_inject_a_shell_or_a_raw_argv` | B1 |
| PROC0-02 | `A::test_proc0_02_source_protected_and_recorder_drift_are_refused` | B1 |
| PROC0-03 | `A::test_proc0_03_existing_capture_and_unsafe_basenames_are_refused` | B1 |
| PROC0-04 | `A::test_proc0_04_a_second_client_finds_the_slot_busy` | B1 |
| PROC0-05 | `A::test_proc0_05_the_write_lease_identity_is_enforced` | B1 |
| PROC0-06 | `A::test_proc0_06_unknown_state_blocks_and_locks_are_never_removed` | B1 |
| PROC0-07 | `A::test_proc0_07_status_never_claims_the_epoch_is_gone` | B1 |
| PROC0-08 | `A::test_proc0_08_popen_failure_has_no_child`、`A::test_proc0_08_a_lost_epoch_after_the_child_was_returned_keeps_the_wait`、`H::test_an_after_return_identity_read_error_keeps_the_wait`、`H::test_a_raw_write_error_keeps_the_wait_and_the_responsibility` | B1+B2 |
| PROC0-09 | `A::test_proc0_09_cancel_only_records_a_request` | B1 |
| PROC0-10 | `A::test_proc0_10_metadata_and_resource_state_are_separate`、`A::test_proc0_10_the_inner_and_outer_exit_domains_stay_separate`、`A::test_proc0_10_a_recorder_killed_by_a_signal_is_never_decoded` | B1 |
| PROC0-11 | `A::test_proc0_11_source_drift_during_the_run_is_saved` | B1 |
| PROC0-12 | `A::test_proc0_12_a_live_group_member_keeps_the_slot_unknown`、`H::test_an_undeterminable_group_is_never_signed_clean`、`H::test_a_vanished_entry_is_only_an_observation_limit` | B1+B2 |
| PROC0-13 | `A::test_proc0_13_each_exit_is_bound_to_its_own_run`、`A::test_proc0_13_a_slot_of_another_run_cannot_lend_its_assertion`、`A::test_proc0_13_a_slot_of_another_command_cannot_lend_its_assertion`、`H::test_the_expected_failure_chain_carries_its_credential`、`H::test_a_run_without_an_exact_slot_match_is_refused_by_the_real_checker`、`H::test_an_unsettled_resource_never_yields_a_verified_credential` | B1+B2 |
| PROC0-14 | `H::test_proc0_14_a_partial_or_trimmed_packet_is_refused`、`H::test_proc0_14_an_unapproved_same_source_stage_release_is_refused`、`H::test_proc0_14_a_missing_contract_binding_is_refused` | B2（并由 B3 自检同源覆盖） |
| PROC0-15 | `H::test_proc0_15_a_capture_from_another_case_is_refused`、`H::test_proc0_15_a_capture_whose_recorded_cwd_does_not_match_is_refused`、`H::test_proc0_15_a_shared_suite_that_main_explicitly_allowed_is_accepted` | B2（并由 B3 自检同源覆盖） |
| PROC0-16 | `A::test_proc0_16_a_capture_is_never_overwritten_and_rebind_is_exact`、`A::test_proc0_16_a_pending_audit_blocks_new_executions`、`A::test_proc0_16_a_failed_state_replace_keeps_the_old_state` | B1 |

结构性断言：`A::test_all_sixteen_cases_have_a_direct_mapping`（16 个 ID 全部有映射，且 handoff 文件确有对应
测试名）、`A::test_the_runner_declares_no_signal_fork_or_reaper_api`（runner 源码无
`os.kill(`/`os.killpg(`/`os.fork(`/`os.waitpid(`/`os.waitid(`/`prctl`/`import signal`）、
`H::test_the_real_runner_output_is_accepted_by_the_real_checker`（真实 runner 产物被真实 checker 接受）、
`H::test_the_real_checker_self_test_completes_with_its_established_negatives`（真实自检跑完且 28 个分支
都真实执行；无 try/except，AttributeError 不会被吞成 PASS）、`H::test_the_finite_helper_exposes_a_bounded_owned_file_barrier`
（只验纯校验函数，未执行 barrier）。

## 4. B3 自检实际执行的 28 个分支（checker 侧负例，SYNTHETIC_METADATA_ONLY）

`assertion_missing_from_log`、`capture_cwd_mismatch`、`complete_packet_admitted`、
`credential_claims_unknown_cleanup`、`credential_sidecar_digest_mismatch`、
`credential_without_cleanup_source`、`extra_capture_input_key`、`foreign_failure_artifact`、
`l1_packet_admitted`、`l1_status_on_final_root`、`missing_contract_binding`、`missing_l1_direct`、
`missing_l3_expected_failure`、`missing_l3_success`、`missing_release_rejected`、`missing_sidecar`、
`recorder_outer_mismatch`、`replaced_release_reference`、`sidecar_capture_digest_mismatch`、
`sidecar_protected_post_mismatch`、`sidecar_unsettled_resource`、`success_substitutes_failure`、
`swapped_case_captures`、`tampered_capture_exit`、`trimmed_case_inventory`、
`trimmed_source_inventory`、`unapproved_same_source_stage`、`wrong_external_sha_rejected`。

## 5. 冻结候选（五文件 SHA-256，供 L2 独立源码审）

| 路径 | SHA-256 |
|---|---|
| `tools/run-delivery.py` | `f9aced2bd199e4f9ffccda2e7d91dae5b3b62fe4285f2c077da21e992e9b4e93` |
| `tools/check-delivery-spec.py` | `056a277d6ecf05cb9120f85ae1abfee624fed2e1505ada97858da8098b881eb8` |
| `tests/process/test_delivery_admission.py` | `f3b2ec48d58dfae4c5b72858ecd82424f05c2f71865266197b553df741c91cbe` |
| `tests/process/test_delivery_handoff.py` | `c9748a59b86e4a284f775607026da1dc69845339e35d6b5f65a99e3e57fdaf32` |
| `tests/process/fixtures/admission_helper.py` | `25fc6db481e22f8364471107a72021d3a25007c90115a3f50298a0b81eede3cf` |

HEAD 仍为 `9bde8c4584e3d13bcad474564caccfcbce2ced6f`，本轮及之前各轮**均无 Git 变更**。
历史证据（bootstrap-001 的 B1 红灯、bootstrap-002 的 B1/B2 绿与 B3 夹具红灯）全部保留、未覆盖。

## 6. L1 明确**没有**证明的事（不得越读）

- **L3 真实实证仍 NOT_RUN**：真实 helper 的跨进程行为、两个真实客户争抢同一槽、在途取消的真实窗口、
  真实 inner/outer 退出码、真实 wrapper 死亡注入，均未运行。
- **实际新 runner CLI、corepack/node、R6/产品、信号、网络**均未执行；本轮只验证了「签名命令会被逐字
  记录」这一纯 mock 承载能力。
- metadata 门只给送审资格，**不判业务语义**；自检材料是 `SYNTHETIC_METADATA_ONLY`。
- 本工具是**合作式流程门**，不宣称 OS 隔离，也不宣称完整 fork 历史；/proc 观测只是当下可见的采样。

**状态：CODE_CANDIDATE_FOR_REVIEW（L1 代码候选）。** 请 MAIN 收回 writer 后交独立上下文做 L2 源码审；
L2 之前不放行 L3，L3 之前不签 L4，R6 的 8 条源码仍未提前写。
