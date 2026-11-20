# OWN_IMPLEMENTATION_REPORT — PROC-0 工具实施（L1 代码候选）

实施者：ClaudeCode（PROC-0 唯一实施者）。阶段：**WRITE_ONLY**，本文件不构成任何验收结论。

- 工作目录 W：`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`
- 分支：`agent-driven/main-a-integration`
- 观察 HEAD（写前与写后均未变）：`9bde8c4584e3d13bcad474564caccfcbce2ced6f`
- MAIN 实施 release：`/mnt/c/workspace/videoworkline/Narralens/docs/process/proc-0/implementation/RELEASE.json`
  实算 SHA-256 `97960315d1918f067a6e7c679ba1e6a9503506d9f8ba6e36e6af6c699dac617a`，与 `RELEASE.sha256` 一致。
  其 contract/plan/cases/review-round3 四个引用摘要实算一致（原 recorder `run-recorded.py`
  实算 `88cd47ec732a340f54cdd4bb05b05878887697eebb0ddc94b1ccd7d0e434fd10`，与 release pin 一致）。
- **未执行任何测试、编译、syntax-check、generator、runner 命令、helper、产品 import、信号、网络或费用。**
  没有产生任何 capture，没有 L1/L3/L4 结论。

## 1. 交付文件（release 允许的五条路径，无其它持久写入）

| 路径 | 角色 | SHA-256 | 行数 |
|---|---|---|---:|
| `tools/run-delivery.py` | 新增：薄标准库执行包装（status/begin-write/end-write/run/request-cancel/rebind） | `1ea2ad8d30dc400610cff8a81f7b09e27d6eccc23018ab667574665a65078456` | 1474 |
| `tools/check-delivery-spec.py` | 改写：metadata 门补强（外部 release 路径+SHA 为唯一信任根） | `3b1f0c2646cb1ab6ed1f4a279f15222ddae7ff93ad88e35f1685f178425aa4c0` | 1146 |
| `tests/process/test_delivery_admission.py` | 新增：runner 的 L1 direct tests（16 项中 14 项） | `58eb2ca4233f4a69d279c209224b83ca2a37402e46d6fb488da5b9aa7b54336c` | 711 |
| `tests/process/test_delivery_handoff.py` | 新增：checker 的 L1 direct tests（PROC0-14/15） | `7acae5f09afaa986ba4d0f99fd06ab9c9cd512e2b8d079659ceac5c6aeb8644c` | 193 |
| `tests/process/fixtures/admission_helper.py` | 新增：有限 helper（pass=0 / specified-fail=1），不 fork、不联网、不碰产品 | `baacdfe8b7ba8b54ada13af23a23b195f33e145cab179c65d4b8e64469d66a52` | 41 |
| `docs/process/proc-0/OWN_IMPLEMENTATION_REPORT.md` | 本文件（OWN_ 前缀允许） | — | — |

未改：`src/`、`contracts/`、`package.json`、`pnpm-lock.yaml`、`AGENTS.md`、原 `run-recorded.py`、
R6 协议与 fixtures、旧 evidence、`docs/process/proc-0/` 内 MAIN 拥有的文件。未做任何 Git 变更
（无 commit/stash/checkout/push），用户既有 dirty 保持原样。

**recorded_source 必须重绑**：原 recorder 的发现范围是 `src|contracts|tests|tools|docs/parallel/lane-bridge/A-R2-20261112`
加 4 个根文件；本次新增的 `tools/run-delivery.py` 与 `tests/process/**` 三个文件落在该范围内，
旧数量不可沿用。`docs/process/proc-0/OWN_*` 不在 recorder 扫描前缀内，不影响 recorded_source。
`tools/run-delivery.py` 内实现了与原 recorder 同规则的发现函数（`discover_recorded_source`），
run 前后都比对「实际发现集合 == release.recorded_source 路径集」，多一个文件即 BLOCKED。

## 2. 16 项 case 的 L1 direct 映射（实现入口 / 测试名 / 证明边界）

| case | L1 入口与测试 | 证明边界 |
|---|---|---|
| PROC0-01 | `test_delivery_admission.py::test_proc0_01_unknown_command_and_bad_release_are_refused` | 未知 command_id、外部 SHA 不符、argv 含空项、非 python3.12 解释器，全部在 Popen 前拒绝；断言 `Popen` 未被调用 |
| PROC0-02 | `::test_proc0_02_source_protected_and_recorder_drift_are_refused` | recorded_source/protected/recorder 漂移 → `PREFLIGHT_SOURCE_OR_PROTECTED_FAILURE`，既有 state 字节不变，无进程启动 |
| PROC0-03 | `::test_proc0_03_existing_capture_and_unsafe_basenames_are_refused` | 六个 suffix 任一存在 → `CAPTURE_ALREADY_EXISTS`；basename 穿越/slash/dot/空格/Unicode → 拒绝；Popen 未被调用 |
| PROC0-04 | `::test_proc0_04_a_second_client_finds_the_slot_busy` | 槽被占 → `RUN_SLOT_BUSY`；已存在锁 → `LOCK_HELD_UNRECOGNISED` 且锁文件不被删；无第二进程 |
| PROC0-05 | `::test_proc0_05_the_write_lease_identity_is_enforced` | 租约期间 run/rebind 被拒；nonce/generation/owner 不符被拒；真 owner 可结束；结束后 admission=BLOCKED/STALE_PIN |
| PROC0-06 | `::test_proc0_06_unknown_state_blocks_and_locks_are_never_removed` | UNKNOWN 槽阻断 run/rebind/begin-write；不自动重跑、不清锁 |
| PROC0-07 | `::test_proc0_07_status_never_claims_the_epoch_is_gone` | /proc 读不出 → 只报「不可证明已退出」；start_ticks 不符 → 只报不符；不扩信号权限 |
| PROC0-08 | `::test_proc0_08_popen_failure_has_no_child`、`::test_proc0_08_a_lost_epoch_after_the_child_was_returned_keeps_the_wait` | Popen 失败 → 无 child、`NO_CHILD`、BLOCKED；child 已返回后状态写失败 → 仍由同 owner wait，epoch 丢失 → `UNKNOWN` 不解锁 |
| PROC0-09 | `::test_proc0_09_cancel_only_records_a_request` | 运行中 request-cancel 只置 sticky 事实、槽仍 RUNNING；终局合并该事实；迟到请求 → `ALREADY_TERMINAL`；不发信号 |
| PROC0-10 | `::test_proc0_10_metadata_and_resource_state_are_separate`、`::test_proc0_10_the_inner_and_outer_exit_domains_stay_separate`、`::test_proc0_10_a_recorder_killed_by_a_signal_is_never_decoded` | metadata 坏与资源状态分开判定；inner -15 / outer 241 仅 mock；recorder 自身被信号 → 拒绝推断 inner |
| PROC0-11 | `::test_proc0_11_source_drift_during_the_run_is_saved` | 运行期改源 → 保存 drift、BLOCKED、不签 ready |
| PROC0-12 | `::test_proc0_12_a_live_group_member_keeps_the_slot_unknown` | 组内仍有成员 → DIRTY/UNKNOWN，槽不释放，下一次 run 被拒 |
| PROC0-13 | `::test_proc0_13_each_exit_is_bound_to_its_own_run` | exit 0 与 exit 1 各自闭环、凭据绑定 case/capture/run/assertion/cleanup；非零不是自动 PASS（`business_acceptance=false`） |
| PROC0-14 | `test_delivery_handoff.py::test_proc0_14_a_partial_or_trimmed_packet_is_refused`、`::test_proc0_14_an_unapproved_same_source_stage_release_is_refused` | PARTIAL/删 case/删 source/换 release 引用/旧格式/外部 SHA 不符/缺任一 slot/同源未获准阶段票 → 全部拒绝 |
| PROC0-15 | `test_delivery_handoff.py::test_proc0_15_a_capture_from_another_case_is_refused`、`::test_proc0_15_a_capture_whose_recorded_cwd_does_not_match_is_refused`、`::test_proc0_15_a_shared_suite_that_main_explicitly_allowed_is_accepted` | 两合法 case 互换 capture → `SLOT_BINDING_MISMATCH`；cmd cwd 不符 → 拒绝；MAIN 显式共享套件 → 接受 |
| PROC0-16 | `test_delivery_admission.py::test_proc0_16_a_capture_is_never_overwritten_and_rebind_is_exact`、`::test_proc0_16_a_pending_audit_blocks_new_executions`、`::test_proc0_16_a_failed_state_replace_keeps_the_old_state` | 旧 capture 不覆盖（字节不变）；新 MAIN pin + 无 live/unknown 才 rebind、旧 history 保留；pending_audit 阻断新执行；replace 前失败保旧 state |

另有两条静态/结构断言：`test_the_runner_declares_no_signal_fork_or_reaper_api`
（runner 源码不含 `os.kill(`/`os.killpg(`/`os.fork(`/`os.waitpid(`/`os.waitid(`/`prctl`/`import signal`）、
`test_all_sixteen_cases_have_a_direct_mapping`（16 个 ID 全部有映射，且 handoff 文件中确有对应测试名）。

**L3 真实实证仍为 NOT_RUN**：真实 helper 跨进程、两个真实客户争抢同一槽、真实 wrapper 死亡注入、
真实 inner/outer 退出码、真实原 capture 六件套 —— 均未运行，不得以本文件的 L1 候选冒充。

## 3. 请求 MAIN 绑定的 bootstrap FIRST 票（原 recorder 直启，不经新 wrapper）

每条命令由原 recorder 唯一生成六件套，cwd 固定为 W，capture 目录固定为原 recorder 目录
`W/docs/execution/A/implementation-20261111/integration/e1-main-takeover/`，basename 唯一且只含
`[A-Za-z0-9_-]`。建议 argv（原 recorder 形式：`python3.12 -I -S -B <recorder> <basename> <inner argv...>`）：

| # | 内层命令（inner argv，cwd = W） | 建议 capture basename | 期望 inner exit |
|---|---|---|---:|
| B1 | `/usr/bin/python3.12 -I -S -B tests/process/test_delivery_admission.py` | `proc0-l1-admission-001` | 0 |
| B2 | `/usr/bin/python3.12 -I -S -B tests/process/test_delivery_handoff.py` | `proc0-l1-handoff-001` | 0 |
| B3 | `/usr/bin/python3.12 -I -S -B tools/check-delivery-spec.py --self-test` | `proc0-l1-checkself-001` | 0 |

B3 的 `--self-test` 只跑 checker 自身的合成正反分支（SYNTHETIC_METADATA_ONLY），不碰产品与真实 R6 packet。

需要 MAIN 在 BOOTSTRAP_CODE release 中一并给出的字段（缺任一项则 run 入口会拒绝）：
`project_root`（W）、`state_root`（必须在 `W/var/process-admission` 之内，见 §5 假设 A1）、
`recorder{path,sha256}`、`recorded_source`（含本次 5 个新/改文件的实算摘要）、`protected_inputs`、
`commands`（精确 argv/cwd/runtime_class/expected_inner_exit/allowed_phases）、
`required_cases`、`case_bindings`（每 case 的 required_evidence slot）、
`capture_allocations`（basename/command_id/run_id/phase/case_ids/recorder_directory）、
`owner_task`、`generation`、`contract{path,sha256}`。

失败处置：任一 B 失败即保留原 capture 与原件，不覆盖、不复用旧 pin、不套 timeout、不后台脱管；
按票范围内修复后由 MAIN 重新绑定新输入（新 basename），不得沿用失败 capture。

## 4. 工具当前支持的形状（MAIN 绑定时需要知道的口径）

- runner CLI：`status | begin-write | end-write | run | request-cancel | rebind`；
  除 `--self-test` 外的每个入口都要求 `--release <MAIN文件> --expected-release-sha256 <sha> --owner-task <id>`；
  `--owner-task` 必须等于 `release.owner_task`。不接受原始 argv、`--shell`、任意 cwd、未知 flag。
- `run` 只接受 release 的 `command_id` 枚举；解释器必须是绝对路径且 basename 匹配 `python3.12`；
  cwd 必须等于 release 绑定的 project root；原 recorder 以 `[python, -I, -S, -B, recorder, basename, *inner argv]` 启动，
  原 recorder 单独会话/进程组；runner 同步等待这一次 Popen，不设命令超时。
- 状态根：`<project_root>/var/process-admission/`，内含 `state.json`（唯一权威）、`journal.jsonl`（审计投影）、
  `.lock`（O_EXCL 短锁）、`logs/<run_id>.recorder.log`、`credentials/<run_id>.json`。
  状态落盘顺序：state(pending_audit=true) → journal append → state(pending_audit=false)；
  替换前失败保旧 state，替换后失败保新 state+pending_audit（阻断新执行）。
- 一次 run 的旁证 sidecar 与失败凭据由 runner 写入 state 根，字段见 §5 的 B1/B2 说明与
  `tools/check-delivery-spec.py` 中 `check_sidecar` / `check_failure_artifact` 的实际读取字段。

## 5. 需要 MAIN 确认或按此绑定的假设（实施者自行选定，请裁决）

- **A1（state_root 位置）**：实现按合同 §2「工具状态、wrapper 旁证与 helper 自有数据仅 W/var/process-admission/」
  强制 `release.state_root` 位于 `<project_root>/var/process-admission/` 之内，否则拒绝。若 MAIN 绑定到其它路径，
  需 MAIN 具名放宽或改绑。
- **A2（packet 形状）**：checker 接受 `narralens.delivery-packet@2`，要求 `status == "READY_FOR_REVIEW"`、
  `implementation == "COMPLETE"`、每 case 有 `production_entry` 与 `test_name`、每 case 一个 `evidence[]`；
  `release{path,sha256}` 必须与外部 MAIN 入口逐字一致（否则 `REJECTED_PACKET_RELEASE_REPLACED`）。
  `packet.contract` 若存在必须等于 `release.contract`；`packet.source` 必须与 `release.recorded_source` 全等
  （多删一个键即拒绝）；`packet.required_cases` 必须与 release 全等。
- **A3（slot 与阶段票）**：`case_bindings[case].required_evidence[]` 的每个 slot 绑定
  `approved_stage_release / command_id / capture_basename / run_id / level / expected_inner_exit /
  expected_failure_requirement`；packet 的 evidence 必须逐字段匹配，`alternatives` 为空即无备选。
  FINAL_METADATA 票用 `approved_stage_releases` 固定历史阶段票的 path+SHA+phase+source+protected；
  packet 自带的历史票只做比对，不构成授权。
- **A4（sidecar 字段）**：checker 要求 sidecar 含 `run_id / command_id / capture_basename /
  evidence_layer / release_sha256 / source / protected / inner_exit / recorder_wait_returncode`；
  `evidence_layer` 必须与阶段票 phase 匹配（BOOTSTRAP_CODE ↔ `BOOTSTRAP`/`L1_DIRECT`，
  TOOL_RUNTIME ↔ `TOOL_RUNTIME`），bootstrap 旁证不得用于 TOOL_RUNTIME。
- **A5（失败凭据字段）**：非零期望的 `expected_failure_artifact` 须含
  `case_id / capture_basename / run_id / command_id / assertion / inner_exit / source / protected /
  cleanup.verified / case_passed`，可选 `log_sha256`（若给出必须等于该 capture 的 `.txt` 实算摘要）；
  且要求断言字符串真实出现在该 capture 的 `.txt` 日志中。
- **A6（L1 bootstrap 旁证由谁产出）**：L1 由原 recorder 直启，wrapper 未参与；因此 L1 slot 的
  `recorder_wait_returncode` 需要由该次直接调用的 owner 记录成 sidecar。若 MAIN 另有既有旁证格式，
  请给出字段口径，我按之调整 checker 的读取面（当前实现按 A4）。
- **A7（未读 /proc 条目）**：组扫描中读不出的 /proc 条目只作观测限制如实计数，不单独判定为 DIRTY；
  已观测到的组成员（含 Z）一律 DIRTY → UNKNOWN 不解锁。若 MAIN 要求读不明即 UNKNOWN，请具名要求，实施者改。

## 6. 偏差与如实记录
- PROC0-09 线程竞态已按 MAIN 预检修好：具名 Event 同步、无跨线程 stdout、finally 释放 gate 并 join 且断言无存活线程；取消/不释放槽/sticky 断言未放宽。

- 本轮出现过两次工具参数 malformed（Edit 工具 JSON 被截断），期间未产生任何写入；恢复后所有落盘均经
  Write/短命令完成。
- 为修补两处文本，短暂在 `/tmp` 下建过 `proc0_patch_checker.py`、`proc0_patch_runner.py` 两个一次性
  脚本（仓库外、不进入交付、不影响任何 recorded_source），收到 MAIN 提示后已 `rm` 删除并确认不存在。
  这是本轮唯一一次范围外持久写入，如实记录，不宣称全程无偏差；未删除任何其它 /tmp 文件。
- 未执行测试、未编译、未 syntax-check、未启动 helper/产品/网络、未产生费用；无 capture、无 exit 实测、
  无日志 SHA、无 PASS 结论。所有 L1 结果目前只是「代码候选」，真实判定必须由 MAIN 在 BOOTSTRAP_CODE 票下
  用原 recorder FIRST 取得。

## 7. 请 MAIN 做的下一步

1. 核本文件 §1 的 5 个文件 SHA 与当前 HEAD（写前写后均为 `9bde8c4`，无 Git 变更）。
2. 出具 BOOTSTRAP_CODE release：绑定 §3 的 B1/B2/B3 三条精确 argv、唯一 capture basename、
   重绑后的 `recorded_source`（含 5 个新/改文件）、`protected_inputs`、以及 §5 的 A1–A7 口径。
3. 回复后我才运行这三条命令；运行期输入保持不变，失败保原 capture，不套 timeout，不后台脱管。
4. L1 通过后由独立上下文做 L2 源码审；L3 的真实 helper/双客户争抢仍需 MAIN 另票。
5. 完整工具通过后再由 MAIN 继续原 R6（其 8 条源码本轮未提前写）。

**当前状态：CODE_CANDIDATE_FOR_REVIEW（仅代码候选），不是任何阶段的 PASS。**

## 8. 更正（依 MAIN 对 msg_978fc693dce0 的合并裁决 `D/implementation/MAIN_PREBOOTSTRAP_DISPOSITION.md`）

§1–§7 保留为历史快照，不改写；本节记录按裁决所做的实现更正与当前冻结状态。仍未执行任何测试、
编译、syntax-check、helper、产品、信号或网络；没有 capture、没有 exit 实测、没有 PASS。

### 8.1 当前五文件 SHA-256（冻结候选）

| 路径 | 角色 | SHA-256 | 行数 |
|---|---|---|---:|
| `tools/run-delivery.py` | 薄标准库执行包装 | `89c15941bc362bf25c0b05ccf10b8c24d38fd9f93cc0be2979f8161ef313363e` | 1629 |
| `tools/check-delivery-spec.py` | metadata 门（外部 release 路径+SHA 为唯一信任根） | `3ce5de4933040932f1be1811e5eb7bc9a8855c292365c721ade66df66fd30dcb` | 1440 |
| `tests/process/test_delivery_admission.py` | runner 的 L1 direct tests | `507824d40dfacebdad505321e76bb64e3b1418a5f0ea9dd1d44cd0bb93d42f53` | 711 |
| `tests/process/test_delivery_handoff.py` | checker direct tests + 实际 producer→consumer 链 + runner 异常分支 | `6a3faff402de86b32cdefb8df9da5d68329bff1505e82bafbd177090986f21d9` | 587 |
| `tests/process/fixtures/admission_helper.py` | 有限 helper（pass / specified-fail / barrier 设计） | `25fc6db481e22f8364471107a72021d3a25007c90115a3f50298a0b81eede3cf` | 123 |

HEAD 仍为 `9bde8c4584e3d13bcad474564caccfcbce2ced6f`，无 Git 变更，未新增/删除任何仓库外持久文件
（上一轮的两个 `/tmp` 一次性脚本已按 MAIN 要求删除并确认不存在，本轮未再新建）。

### 8.2 A1–A7 逐条处置

- **A1 state_root**：接受并保持。实现强制 `release.state_root` 位于 `<project_root>/var/process-admission/`
  之内，否则 `RELEASE_STATE_ROOT_OUTSIDE_ALLOWED_AREA`。
- **A2 packet status 分层**：按裁决改为按根票 phase 决定。
  `BOOTSTRAP_CODE` 根票要求 packet `status == "CODE_CANDIDATE_FOR_REVIEW"`，checker 只输出
  `CODE_CANDIDATE_FOR_REVIEW`，**永不输出整体 ready**；`FINAL_METADATA`/`TOOL_RUNTIME` 根票要求
  `READY_FOR_REVIEW`，输出 `METADATA_READY_FOR_REVIEW`。`packet.contract` 改为**必需**：缺失即
  `packet has no contract binding`，与根票 `contract` 不逐字段相等即拒绝。对应正反例已加。
- **A3 slot/阶段票**：不变，仍逐字段精确绑定，`alternatives` 为空即无备选。
- **A4 真实 sidecar**：runner 现在在终局写出**独立 sidecar**
  `var/process-admission/sidecars/<run_id>.json`，字段为实算值：
  `evidence_layer`（BOOTSTRAP_CODE→`BOOTSTRAP`，否则 `TOOL_RUNTIME`）、`release_sha256`/`release_id`/
  `release_phase`、`run_id`/`command_id`/`capture_basename`/`capture_directory`、`owner_task`/
  `generation`、`recorder_argv`/`inner_argv`/`cwd`、**`capture_digests`（原六件套逐个实算 SHA-256）**、
  `inner_exit`、**`recorder_wait_returncode`（该次 Popen 的实际 wait）**、
  **`source_pre`/`source_post`**、**`protected_pre`/`protected_post`**、`resource_status`、
  **`cleanup_source`**（`kind`/`pgid`/`boot_id`/`observed_members`/`vanished_entries`/
  `undeterminable_entries`/`resource_status`/`waited_returncode`/`scanned_at`）、
  `epoch`（pid/start_ticks/ppid/pgid/sid/boot_id/`identity_inferred`）、`identity_persist`、
  `metadata_ok`/`metadata_problems`。checker 逐项重算比对：六件套摘要必须等于现文件实算值；
  `source_post`/`protected_post` 必须等于当前磁盘实算值；`source_pre`/`protected_pre` 必须等于阶段票
  的清单；缺项/错值即拒绝。L1 bootstrap 的旁证仍由该次直接调用的 owner 保存（接受 A6），但须用
  **同一 schema 的实算值**，不得只填自报布尔。
- **A5 失败凭据**：不再接受「log 摘要可选」与「只靠 `case_passed`/`cleanup.verified`」。
  `var/process-admission/credentials/<run_id>.json` 现在必含 `source`/`source_post`/`protected`/
  `protected_post`、**`capture_digests`（原六件套实算）**、**`sidecar` 路径 + `sidecar_sha256`**、
  **`cleanup.source`（引用 sidecar 的实际观测）**、`resource_status`、`case_id`/`capture_basename`/
  `run_id`/`command_id`/`assertion`/`inner_exit`/`recorder_wait_returncode`。checker 逐项重算比对，
  并核被引 sidecar 的实算摘要、run/capture 一致、其 `resource_status` 必须为 CLEAN；
  `cleanup` 必须带 `source` 且其 `resource_status` 为 CLEAN、无残留成员；日志含断言只是必要条件。
- **A7 不可读 /proc**：区分真实消失与无法判定。`scan_group_members` 现在返回
  `(members, vanished_entries, undeterminable_entries)`：`ENOENT`/`ESRCH` 记为观察局限；
  `EACCES`/`EPERM`/解析失败记为 `undeterminable_entries`。**任一 `undeterminable_entries > 0` 即
  `resource_status = UNKNOWN`，绝不签 CLEAN**；已观测到组成员（含 Z）→ `DIRTY` → UNKNOWN 持责；
  仅当组成员为空且无不可判定项才是 CLEAN。已加 direct 反例（不可判定项→UNKNOWN、消失项→仍 CLEAN
  并如实计数）。未引入 kill/reaper，工具仍不声称完整 fork 记录。
- **A8（自行提出）**：epoch 读取与落盘失败后的责任不再被 helper 吞掉。`read_identity_after_session`
  在 wait 之前调用，现由 `command_run` 直接包裹 `except (OSError, ValueError)`；`_persist_running`
  除 `AdmissionError` 外也捕获原始 `OSError`。**已返回的 child 永远由同 owner 实际 wait**，两种注入
  均有 direct 反例断言 `wait` 仍发生。

### 8.3 实际 producer→consumer direct 链（原缺口）

`tests/process/test_delivery_handoff.py` 新增 `ChainCase`：用真实 runner（底层 recorder 仍 mock，
不真实运行任何命令）产出原六件套 + sidecar + 凭据，再用真实 checker 读同一批文件：

- `test_the_real_runner_output_is_accepted_by_the_real_checker`：runner 的真实产物被 checker 接受（0 问题）。
- `test_the_expected_failure_chain_carries_its_credential`：指定失败(inner 1)的凭据绑定
  case/capture/run/assertion/cleanup/sidecar 摘要后被接受。
- `test_a_missing_sidecar_is_refused_by_the_real_checker`：删 sidecar → 拒绝。
- `test_a_tampered_capture_piece_is_refused_by_the_real_checker`：改 `.exit` → 拒绝。
- `test_an_unsettled_resource_never_yields_a_verified_credential`：组内仍有成员 → runner 记 DIRTY，
  凭据 `cleanup.verified=false`、`case_passed=false`，checker 拒绝该凭据。
- `test_an_after_return_identity_read_error_keeps_the_wait`、
  `test_a_raw_write_error_keeps_the_wait_and_the_responsibility`、
  `test_an_undeterminable_group_is_never_signed_clean`、
  `test_a_vanished_entry_is_only_an_observation_limit`：A7/A8 的分支反例。

checker 侧另有 `test_an_l1_root_only_ever_reports_the_l1_level`、
`test_an_l1_packet_never_reports_the_overall_ready_state`、
`test_proc0_14_a_missing_contract_binding_is_refused`。

### 8.4 后续 L3 可实施性（只写与 mock，绝不实际运行）

`tests/process/fixtures/admission_helper.py` 增加 `barrier` 模式（仅写，未运行）：
`barrier <root> <name> <seconds>` 只在绑定 root 下创建 `<name>.held`，等待观察到 `<name>.release`
才退出 0；窗口耗尽则以自身有界失败码 3 退出，**时间过去不等于资源消失**。root 由纯函数
`resolve_barrier_root()` 校验：必须绝对路径且位于 `var/` 之内，不创建不读取任何文件。
direct 测试只调用该纯校验函数（越界 root 抛 `ValueError`），断言 barrier 目录**未被创建**。
真实两客户争抢与在途取消仍需 MAIN 的 L3 精确票，绑定该 helper 路径与自建 var root。

### 8.5 待 MAIN 绑定的 bootstrap FIRST 票（与 §3 相同，仍未释放）

B1 `python3.12 -I -S -B tests/process/test_delivery_admission.py`、
B2 `python3.12 -I -S -B tests/process/test_delivery_handoff.py`、
B3 `python3.12 -I -S -B tools/check-delivery-spec.py --self-test`，
cwd = W，capture 只在原 recorder 目录用唯一 ASCII basename（建议 `proc0-l1-admission-001`、
`proc0-l1-handoff-001`、`proc0-l1-checkself-001`），期望 inner exit 均为 0。
L1 bootstrap 的旁证 sidecar 请按 §8.2 A4 的**实算字段**填写（六件套摘要、protected pre/post、
实际 wait、cleanup_source）；B3 的 `--self-test` 已在合成材料上覆盖上述正反分支（SYNTHETIC_ONLY）。

**当前状态：CODE_CANDIDATE_FOR_REVIEW（仅代码候选）。L2 源码审、L3 真实 helper/双客户争抢、L4 整体
交还全部 NOT_RUN；不签任何阶段 PASS，R6 的 8 条源码仍未提前写。**

## 9. 更正二（依 MAIN 的 repair-001 票 `D/implementation/repair-001/SPEC.md`）

§1–§8 保留为历史快照，不改写；本节记录 L1 首次红灯后的修复与当前冻结状态。**本轮未执行任何测试、
未跑 B1/B2/B3、未跑 selftest，未改旧 capture，未做任何 Git 变更。**

### 9.1 L1 首次红灯的事实（B1，已复核）

| 项 | 值 |
|---|---|
| observer 退出 | 2（非 0） |
| inner exit / recorder outer wait | 1 / 1（`1 & 255`，一致） |
| resource_status | CLEAN（原组无成员） |
| direct 测试 | 20 通过 / 1 失败 |
| 失败用例 | `test_proc0_13_each_exit_is_bound_to_its_own_run`：`credential['assertion']` 为 None，期望 `TOOL_HELPER_EXPECTED_FAILURE` |
| B2 / B3 | **NOT RUN**（首个非 0 即停） |

失败原件全部保留：原 recorder 目录的 `proc0-l1-admission-001.*` 六件套（`exit 1`、
`source_changed []`、`source_added []`）与 observer 旁证
`var/process-admission/proc0-l1-20261120/bootstrap/proc0-l1-001-b1.json`。

### 9.2 两个根因与修复

- **根因一（command_id 取不到）**：`release["commands"]` 的 command_id 是**字典键**，命令对象本身没有
  `command_id` 字段；原实现用 `command.get("command_id")` 去匹配 slot，恒为 `None`，只有
  `capture_basename` 的兜底能命中，于是**只有第一个 capture** 能拿到断言。
  修复：把**已校验的真实 command_id**（CLI 传入、且已在 `release["commands"]` 中命中）显式传入
  sidecar 与 credential 的**全部生产路径**；凭据里再也不会出现 `command_id: null`。
- **根因二（slot 混用）**：兜底匹配会把不同 slot 混在一起。
  修复：新增 `qualify_slots(release, allocation, command_id)`，**同 case + 同 command_id +
  同 capture_basename + 同 run_id + 阶段绑定全部精确相等**才算授权；**没有 command OR capture 兜底**。
  无精确匹配时：凭据**不写** `case_id`/`assertion`/`expected_failure_requirement`（键缺失，不是 null），
  `case_qualified=false`、`case_passed=false`；而**物理观测照实保留**——真实 CLEAN 仍是 CLEAN，
  cleanup 实际观测照实写，**不因授权缺失把真实 CLEAN 伪造成 UNKNOWN**。

### 9.3 测试前置修正与新增负控（不放宽断言）

- 原 fixture 的问题是：改了 inner 预期与 argv，却把同 case 的 `required_evidence` 仍留在
  capture-a/run-a，然后去跑 capture-b/run-b——那不是合法的第二个失败 slot。
  修正为**合法授权前置**：fixture 增加独立命令 `direct-fail`（argv 带 `specified-fail`、
  `expected_inner_exit=1`）与其自己的 capture-b/run-b 分配，并在 case 绑定中给出该 slot
  （`command_id=direct-fail / capture-b / run-b / expected 1 / 带断言要求`）。
  断言本身**未放宽**：仍严格断言指定失败、`command_id`、capture/run 绑定、完整 sidecar 与原件绑定。
- 新增负控（同命令不同 run/capture、跨命令同 basename，均不得借首个 slot 的断言）：
  - `test_proc0_13_a_slot_of_another_run_cannot_lend_its_assertion`：`direct-fail` 跑 run-d
    （capture-d）→ 凭据无 `assertion`/`case_id`、`case_qualified=false`、`case_passed=false`；
    同时 `resource_status` 仍为 CLEAN、`admission` 仍为 READY（授权缺失不伪造 UNKNOWN）。
  - `test_proc0_13_a_slot_of_another_command_cannot_lend_its_assertion`：`direct` 跑 run-c
    （capture-c，而 fixture 里故意把该 capture 绑到 `direct-fail` 的 slot）→ 跨命令不得混配。
  - `test_a_run_without_an_exact_slot_match_is_refused_by_the_real_checker`（handoff 文件）：
    真实 runner 产出的凭据在无精确 slot 时不被 checker 接受。
- fixture 里保留了一个**故意错绑**的 slot（L1_WRONG_COMMAND：同 capture/run、异 command），
  专门用来证明它借不出断言。

### 9.4 当前五文件 SHA-256（repair-001 冻结候选）

| 路径 | 本轮 | SHA-256 |
|---|---|---|
| `tools/run-delivery.py` | **改** | `393c76248eff0272c139fc4ec5d9b07aee3408d45f74411f816162f642003bef` |
| `tests/process/test_delivery_admission.py` | **改** | `de35cbbaec65e46e766614e38b3f5a3361c9aa0d6bef292d2183860635c4d277` |
| `tests/process/test_delivery_handoff.py` | **改** | `26c7e8d4dfcd2f1f4550263c4af31fee5cee27f07aaba9de8ae41d599b04dbd7` |
| `tools/check-delivery-spec.py` | 未改（保护项） | `3ce5de4933040932f1be1811e5eb7bc9a8855c292365c721ade66df66fd30dcb` |
| `tests/process/fixtures/admission_helper.py` | 未改（保护项） | `25fc6db481e22f8364471107a72021d3a25007c90115a3f50298a0b81eede3cf` |

### 9.5 请 MAIN 做的事

请据 §9.4 重绑 **bootstrap-002**：全部实际 recorded 输入按上述三文件新摘要重绑，
`protected_inputs` 不变，并给出**全新 capture basename**（旧的 `proc0-l1-admission-001` 不得复用或覆盖）。
收到新票前我不运行 B1/B2/B3，也不改任何源。

**当前状态：CODE_CANDIDATE_FOR_REVIEW（仅代码候选）。B1 红灯的真实失败记录保留，未调绿、未改预期、
未删断言；L2 源码审、L3 真实 helper/双客户争抢、L4 整体交还仍 NOT_RUN。**

## 10. bootstrap-002 实跑结果与 B3 红灯（依 MAIN 的 bootstrap-002 票）

§1–§9 保留为历史快照，不改写。本节记录 bootstrap-002 的真实执行结果。

### 10.1 票面核对（只用标准库核摘要，未把 656 行 hash 读入上下文）

- 票：`D/implementation/bootstrap-002/RELEASE.json`，实算 SHA-256
  `e6d9b71de7322900303d946e5df699c907fc72a691bf7879b19c32f9f9cd5aa9`，与 MAIN 给出的外部信任 SHA 一致。
- `phase=BOOTSTRAP_CODE`、`owner_task=task_d0bbeef5f54f`、`generation=2`。
- `recorded_source` 656 项：**实算不匹配 0 项**；`protected_inputs` 6 项：**实算不匹配 0 项**。
- 命令与分配（全新 capture / run_id，旧 001 保留不可覆盖）：
  `B1 → proc0-l1-admission-002 / proc0-l1-002-b1`、
  `B2 → proc0-l1-handoff-002 / proc0-l1-002-b2`、
  `B3 → proc0-l1-checkself-002 / proc0-l1-002-b3`；三条 `expected_inner_exit` 均为 0；
  `required_cases` 16 项。

### 10.2 真实执行（observer = 受保护的 `bootstrap-001/observe-first.py`，cwd = W）

| 命令 | inner exit | recorder outer wait | resource_status | metadata_ok | observer exit | direct 测试 |
|---|---:|---:|---|---|---:|---|
| B1 `tests/process/test_delivery_admission.py` | 0 | 0 | CLEAN | true | 0 | **Ran 23 tests … OK** |
| B2 `tests/process/test_delivery_handoff.py` | 0 | 0 | CLEAN | true | 0 | **Ran 23 tests … OK** |
| B3 `tools/check-delivery-spec.py --self-test` | **1** | 1 | CLEAN | **false** | **2** | 自检中断（见 §10.3） |

原件与旁证（全部保留）：
- 原 recorder 目录：`proc0-l1-admission-002.*`、`proc0-l1-handoff-002.*`、`proc0-l1-checkself-002.*`
  六件套（B1/B2 `exit 0`，B3 `exit 1`；三者 `source_changed []`、`source_added []`，即运行期零源漂移）。
- observer 旁证：`var/process-admission/proc0-l1-20261120/bootstrap/proc0-l1-002-b1.json`、
  `…-b2.json`、`…-b3.json`。

### 10.3 B3 红灯：缺陷在受保护的 checker 自检里（按 repair SPEC「同根因需要额外路径先向 MAIN 提出」）

B3 自检 traceback（`proc0-l1-checkself-002.txt`）：

```
File "tools/check-delivery-spec.py", line 1281, in outer_mismatch
    sidecar = json.loads(path.read_text())
AttributeError: 'str' object has no attribute 'read_text'
```

根因：`build_synthetic_fixture()` 返回的 `captures[...]["sidecar"]` 与 `captures[...]["artifact"]`
是**纯字符串路径**，而 §8.2(A4/A5) 轮新增的负控里我按 Path 用法写了 `path.read_text()`，
于是自检在第一个新负控（`recorder_outer_mismatch`）就抛出 AttributeError，`--self-test` 以 1 退出。

受影响共 7 处（均为字符串路径当 Path 用）：
`tools/check-delivery-spec.py` 的 self_test 内 —— sidecar：第 1280、1330、1337、1344 行；
artifact：第 1352、1362、1369 行。逐处修法一致：`path = Path(fixture["captures"][...][...])`
（该文件已 `from pathlib import Path`，无需新增 import）。

**本票（repair-001）把 `tools/check-delivery-spec.py` 列为保护项**，故本轮**未改**该文件，
也未改 helper。按 repair SPEC「若同根因需要具体额外路径，先向 MAIN 一次提出」，就此提出：
请 MAIN 授权修改 `tools/check-delivery-spec.py`（或由 MAIN 自行施加同一 7 处修法），随后重绑
**bootstrap-003**（重绑全部实际 recorded 输入 + 全新 capture basename，例如
`proc0-l1-admission-003 / handoff-003 / checkself-003`，run_id `proc0-l1-003-b1/b2/b3`）。
旧的 001 与 002 失败/成功原件一律保留、不可覆盖。

### 10.4 当前状态

B1/B2 全绿且证据完整；B3 因**受保护文件内的自检缺陷**红灯，与 §9 的 runner 修复无关
（runner 的 23 项 direct 测试在 B1 全绿）。**整体 L1 未完成**：不放行 L2，不签任何阶段 PASS，
不冒充 R6/产品完成；R6 的 8 条源码仍未提前写。

本轮未改任何源（等 MAIN 授权）、未跑新命令、未做任何 Git 变更。

## 11. 更正三（依 MAIN 的 repair-002 票 `D/implementation/repair-002/SPEC.md`）

§1–§10 保留为历史快照，不改写。本轮只有 WRITE 许可：**未执行任何测试、未跑 B1/B2/B3、未跑 selftest、
未改旧 capture、未做任何 Git 变更**。

### 11.1 修的是什么（同一类问题一次修完，不逐个试错）

真实根因：`build_synthetic_fixture()` 把 `captures[*].sidecar` / `captures[*].artifact`
声明为 **JSON 字符串路径**（这对 packet 是正确的），而 `self_test` 的多个 mutator 把该字符串当 Path 用
`read_text()`，于是 B3 在 `outer_mismatch` 处抛 `AttributeError`；后面的 sidecar / credential mutator
会逐个抛同样的错。

修法（统一收口在文件 I/O 边界）：

- 新增模块级 `fixture_path(fixture, *keys)`：把声明路径解析为真正的 Path（相对路径再按
  `fixture["root"]` 归一）。**只有自检的文件 I/O 用它**；fixture 对外返回的仍是字符串，
  packet 里仍是 JSON 字符串，**没有把 Path 对象塞进 packet**。
- 7 处同类点全部改用该边界：sidecar 4 处（原 1280/1330/1337/1344 行）、
  artifact 3 处（原 1352/1362/1369 行）。不是只修第一处、靠逐次重跑发现下一个。

### 11.2 负例的还原责任与防假绿

- `reject()` 改为 `mutate → check → restore` 且 **restore 放在 finally**：
  即使 check 或 mutator 抛异常，原件还原责任仍然执行。
- 新增 `assert_positive_admitted(label)`：**每个负例之前与还原之后**都显式确认**原始正例仍被准入**
  （FINAL 根票的正例与 L1 根票的正例各查一次）。这样「前一个负例留下的坏状态让后一个负例以错误原因
  假绿」会被当场抓住，而不是被当成通过。

### 11.3 handoff direct 测试：真正跑通 checker 自检

`tests/process/test_delivery_handoff.py` 新增
`test_the_real_checker_self_test_completes_with_its_established_negatives`：
**直接调用真实 `checker.self_test()`**（纯合成、不 spawn、不绕到副本谓词），断言它**顺利跑完**、
`scope == "SYNTHETIC_METADATA_ONLY"`、`business_acceptance` 为假，并逐项断言 28 个既定正例/负例分支
都真实执行过（含 `recorder_outer_mismatch`、三个 sidecar 负例、三个 credential 负例、
`missing_contract_binding`、`l1_status_on_final_root` 等）。**此处不写任何 try/except**：
自检内部若再抛 AttributeError，本测试必须**失败**，不得被吞成 PASS。现有负例/退出码/错误断言未放宽。

### 11.4 当前五文件 SHA-256（repair-002 冻结候选）

| 路径 | 本轮 | SHA-256 |
|---|---|---|
| `tools/check-delivery-spec.py` | **改** | `056a277d6ecf05cb9120f85ae1abfee624fed2e1505ada97858da8098b881eb8` |
| `tests/process/test_delivery_handoff.py` | **改** | `c9748a59b86e4a284f775607026da1dc69845339e35d6b5f65a99e3e57fdaf32` |
| `tools/run-delivery.py` | 未改（保护项） | `393c76248eff0272c139fc4ec5d9b07aee3408d45f74411f816162f642003bef` |
| `tests/process/test_delivery_admission.py` | 未改（保护项） | `de35cbbaec65e46e766614e38b3f5a3361c9aa0d6bef292d2183860635c4d277` |
| `tests/process/fixtures/admission_helper.py` | 未改（保护项） | `25fc6db481e22f8364471107a72021d3a25007c90115a3f50298a0b81eede3cf` |

### 11.5 请 MAIN 做的事

请据 §11.4 重绑 **bootstrap-003**：全部实际 recorded 输入按上述摘要重绑，`protected_inputs` 不变，
并给出**全新 capture basename**（旧的 001/002 一律保留、不可复用或覆盖；建议
`proc0-l1-admission-003 / handoff-003 / checkself-003`，run_id `proc0-l1-003-b1/b2/b3`）。
收到新票前我不运行 B1/B2/B3，也不改任何源。

**当前状态：CODE_CANDIDATE_FOR_REVIEW。** L1 尚未完成（B1/B2 在 bootstrap-002 已 23/23 绿；
B3 因本节修复的自检夹具错误而红，现已修复但**尚未重新录制**）；不签任何阶段 PASS，
不放行 L2，R6 的 8 条源码仍未提前写。

## 12. 更正四（依 MAIN 的 repair-003 票：固定外层，精确内部 argv）

§1–§11 保留为历史快照，不改写。本轮仍只有 WRITE 许可：**未执行任何测试、未跑 B1/B2/B3、
未运行 corepack/node/R6/helper、未改旧 capture、未做任何 Git 变更**。

### 12.1 真实缺口（主线适用性）

`command_run` 原先把**内部** `command.argv[0]` 当作**外层** recorder 的 Python，并要求它是
absolute 的 python3.12。后果两条：

1. 承载缺口：原 R6 已允许、MAIN 也已签入白名单的 `corepack pnpm tsc/Vitest`、
   `node integrity generate/check` 等命令**进不了 recorded**（被误判为错误解释器）。
2. 信任倒置：外层解释器本应由工具固定，却由内部命令派生。

### 12.2 最小修复

- 外层解释器**由源码常量固定**：`OUTER_INTERPRETER = "/usr/bin/python3.12"`。不新增任何 CLI
  解释器/路径/环境配置项；实际票已在 `protected_inputs` 绑定该二进制 SHA，runner 随 protected
  集合一并实算核对。
- **内部命令只来自外部 MAIN SHA 绑定的 `command_id` 白名单**，argv 逐字传给原 recorder：
  `[OUTER_INTERPRETER, "-I", "-S", "-B", <recorder>, <capture basename>, *inner argv]`。
  array/nonempty/type/cwd/phase/source/capture 各检查全部保留；Popen 仍是 argv 列表、shell=False，
  不拼接 shell 字符串；caller 没有原始 argv / `--shell` / 任意 cwd 入口。

### 12.3 测试改动（不放宽任何原拒绝断言）

- **删掉**旧 test_proc0_01 里「把已签的 `/bin/sh` 当成错误解释器而拒绝」那一段——它混淆了外层与内层；
  MAIN 已签的 `/bin/sh` 属于合法内部命令。
- **保留**原拒绝断言：未知 command_id、外部 SHA 不符、argv 含空项。
- **新增**注入类拒绝：`--shell /bin/sh`、`--argv anything`、`--cwd /tmp` 等未知 CLI 参数由 argparse
  直接拒绝（退出码 2），并断言 **Popen 从未被调用**。
- **新增 pure mock 正例** `test_proc0_01_a_signed_corepack_command_uses_the_fixed_outer_interpreter`：
  MAIN 签入的 corepack/node（以及已签 `/bin/sh`）命令被准入时，断言真实 runner 的 Popen 外层恰为
  `["/usr/bin/python3.12","-I","-S","-B",<原recorder>,<capture>]`、内层是**原精确 argv**，
  且原 `.cmd.json` / `.claim.json` 记录的是**内层** argv。**不执行真正 Node/corepack/R6 命令**
  （recorder 仍被 mock）。

### 12.4 当前五文件 SHA-256（repair-003 冻结候选）

| 路径 | 本轮 | SHA-256 |
|---|---|---|
| `tools/run-delivery.py` | **改** | `f9aced2bd199e4f9ffccda2e7d91dae5b3b62fe4285f2c077da21e992e9b4e93` |
| `tests/process/test_delivery_admission.py` | **改** | `f3b2ec48d58dfae4c5b72858ecd82424f05c2f71865266197b553df741c91cbe` |
| `tools/check-delivery-spec.py` | 未改（保护项） | `056a277d6ecf05cb9120f85ae1abfee624fed2e1505ada97858da8098b881eb8` |
| `tests/process/test_delivery_handoff.py` | 未改（保护项） | `c9748a59b86e4a284f775607026da1dc69845339e35d6b5f65a99e3e57fdaf32` |
| `tests/process/fixtures/admission_helper.py` | 未改（保护项） | `25fc6db481e22f8364471107a72021d3a25007c90115a3f50298a0b81eede3cf` |

### 12.5 请 MAIN 做的事

请把这次**合并候选**（上表五个摘要）绑定为 **bootstrap-003**：重绑全部实际 recorded 输入，
`protected_inputs` 不变，给出**全新 capture basename**（001/002 一律保留不可复用；建议
`proc0-l1-admission-003 / handoff-003 / checkself-003`，run_id `proc0-l1-003-b1/b2/b3`），
然后按同一受保护 observer 依次重跑 B1/B2/B3。收到新票前我不运行任何命令，也不改任何源。

**当前状态：CODE_CANDIDATE_FOR_REVIEW。** 这只修承载能力：实际新 runner / corepack / node / R6 /
helper 的运行许可**均未释放**；write lease 里的生成操作待 MAIN 明确；不放宽 source_changed 求绿。
L1 尚未完成，不签任何阶段 PASS，R6 的 8 条源码仍未提前写。
## 13. L1 handover: see OWN_L1_HANDOVER.md in this directory.
