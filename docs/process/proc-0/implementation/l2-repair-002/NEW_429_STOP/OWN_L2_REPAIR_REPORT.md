# OWN_L2_REPAIR_REPORT — PROC-0 L2 修订 001（依 MAIN 的 repair-001 票）

实施者：ClaudeCode（唯一 writer）。Task `task_1e803fda402b` / Dispatch `ctx_ab2f1ac4c732`。
票：`D/implementation/repair-001/RELEASE.json`，外部 SHA-256
`48fc472720140e62e1587ed87729b6df55f9a8898552f79fd3dfd9014437985f`（已实算一致）。
合同 rev4 §7 SHA-256 `d2a5dea065fd78b1e4df997cd46788b04132309c842da787352aa2bf07442169`
（W 与 B 两份实算一致）。

**本轮状态：WRITE_ONLY。** 未执行任何测试、未跑 selftest、未调用受审 CLI / 新 runner / helper /
corepack/node / R6 / 产品命令，未做信号、网络、fork/wait/prctl 操作。只做源码写入与
**标准库 AST 静态语法核查**（`ast.parse`，不 import 被审模块、不执行任何测试）。
未做任何 Git 变更；未触碰 `src/`、contracts、包配置、依赖、原 recorder、MAIN observer、旧证据、
合同与案例；未新增框架、未切引擎。

## 1. 起点与当前五文件 SHA-256

| 路径 | 起点（repair-001 `start_source5`） | 当前（冻结候选） |
|---|---|---|
| `tools/run-delivery.py` | `f9aced2bd199e4f9ffccda2e7d91dae5b3b62fe4285f2c077da21e992e9b4e93` | `8cc37503961b7efe4be7d1146cbd4b6c3000d3325d5a43daaf3d3a62dc44079f` |
| `tools/check-delivery-spec.py` | `056a277d6ecf05cb9120f85ae1abfee624fed2e1505ada97858da8098b881eb8` | `6edd56ed818e8d9dbd1e85a65245cb8a59be862c15d5c938f90dadf47e2fd36e` |
| `tests/process/test_delivery_admission.py` | `f3b2ec48d58dfae4c5b72858ecd82424f05c2f71865266197b553df741c91cbe` | `be739865027fae9c04e78e7ff5c49d635d5a460c42dfe1cbbbacaa4eaed31afe` |
| `tests/process/test_delivery_handoff.py` | `c9748a59b86e4a284f775607026da1dc69845339e35d6b5f65a99e3e57fdaf32` | `42e5bea0b03732a738915095a716a4175f1a36cb5d126c832f5744d8a721f225` |
| `tests/process/fixtures/admission_helper.py` | `25fc6db481e22f8364471107a72021d3a25007c90115a3f50298a0b81eede3cf` | `65dd48515b3ddee4bbc901ebc74aa544e5335fb75bcd9a1c09feb66c1eeaed3e` |

其余 651 项 recorded 输入与保护项**未改**，由 MAIN 在 bootstrap-002 重绑。

## 2. 逐 finding 闭环（L2-01..09）

### L2-01（BLOCKER）返回 child 后仍有路径跳过原 owner 的 wait

- 入口：`tools/run-delivery.py` 的 `OwnedChild`（幂等单次 wait）、`command_run` 的启动段与
  `finally: outer = owned.wait()`。
- 改法：**把「无 child 的启动失败」与「返回后的任何异常」彻底分开**。只有
  `subprocess.Popen` 本身抛 OSError（child 从未创建）才是 `POPEN_FAILED_NO_CHILD`；日志句柄
  打开失败是 `LOG_OPEN_FAILED_NO_CHILD`；**child 已返回后**日志 close 失败、身份读取失败、
  落盘失败一律进入同 owner 的 `finally` wait，**永不记 NO_CHILD**。`OwnedChild.wait()` 幂等，
  任何路径下该 child 恰好被 wait 一次，不重启。
- direct 反例：
  - `test_proc0_08_a_log_close_failure_after_the_child_keeps_the_wait`（close 在返回后报错 →
    仍 wait、state 的 `resource_status` 不是 NO_CHILD、只启动一次）
  - `test_proc0_08_popen_failure_has_no_child`（真 Popen 未返回 → NO_CHILD 且没有 wait）
  - `test_proc0_08_an_unverified_recorder_epoch_still_waits_but_blocks`

### L2-02（BLOCKER）未取得完整 epoch 也可被持久化为 CLEAN/READY

- 入口：`read_wrapper_epoch`、`read_recorder_epoch`、`command_run` 的 epoch 段。
- 改法：
  - **wrapper epoch 必须完整才预约**：`boot_id` 必须是非空字符串；身份必须是 dict 且
    `pid == os.getpid()`；`start_ticks/ppid/session/group` 必须是整数。任一缺失 →
    `WRAPPER_EPOCH_INCOMPLETE_NO_SPAWN`，**不 spawn**。
  - **recorder epoch 与创建链合证**：`identity.pid` 必须等于该 Popen 的 pid；`ppid` 必须等于
    wrapper 的 pid；`sid`/`pgid` 必须等于该 child 自己的 pid；`boot_id` 必须与 wrapper 相同；
    整数字段缺失即不完整。**身份记录与身份核实分开记账**（`identity_verified`）。
    未核实的 epoch → 仍然真实 wait，但 `resource_status=UNKNOWN`、admission BLOCKED，
    **不以空 group 或 inferred tuple 代证 CLEAN**。
  - 返回契约统一为 `(epoch, verified, problems)`，调用点一致；**不再用宽 except 把内部解包
    ValueError 伪装成身份负例**（调用点只捕 OSError）。
- direct 反例：`test_proc0_06_a_missing_wrapper_epoch_never_spawns`、
  `test_proc0_08_an_unverified_recorder_epoch_still_waits_but_blocks`、
  `test_proc0_12_an_undeterminable_group_is_never_signed_clean`、
  handoff 的 `test_an_after_return_identity_read_error_keeps_the_wait`。
- fixture 口径：测试的 wrapper tuple 与 child tuple 是**两套不同真实事实**（child 的 ppid 是
  wrapper 的 pid），不是恒定 ppid=1 放松生产检查。

### L2-03（BLOCKER）同一项目可形成两个准入权威

- 入口：`authority_root(project_root)`、`read_authority_state`、`validate_state`、
  `require_binding`、`command_rebind`、`command_end_write`。
- 改法：
  - **唯一 project authority 固定为 `<project_root>/var/process-admission/authority/`**，
    票面 `state_root` 降级为**该票的产物根**（logs/sidecars/credentials/receipts），不再是准入权威。
  - **损坏/空/字段不全的 state 一律拒绝**（`STATE_EMPTY_REFUSED` / `STATE_UNPARSABLE` /
    `STATE_SCHEMA_INVALID`），**绝不 initial READY**；只有完全没有 state 文件才是首次绑定。
  - **普通写状态入口必须匹配已绑定 release SHA/owner/generation**（`require_binding`）；
    `end-write` 另核 lease 的 release SHA（`WRITE_LEASE_RELEASE_MISMATCH`）。
  - `end-write` 关闭原 lease 后保持 `STALE_PIN_AFTER_AUTHORIZED_SOURCE_CHANGE`；**只有显式
    `rebind` 能更新 pin**，且 rebind 要求**更新一代 generation**（`REBIND_GENERATION_NOT_NEWER`）
    与不同的 release SHA。`run` 不再有任何 stale 例外（旧票不能绕过换绑）。
  - `status` 只读，不重绑、不 repair pending。
- direct 反例：`test_proc0_16_two_tickets_share_one_authority`（两份受信票两个产物根 → 同一
  authority、新票拿不到第二槽；显式 rebind 后才可继续）、`test_proc0_16_a_pending_audit_is_never_cleared_by_a_later_event`、
  `test_proc0_05_the_write_lease_identity_is_enforced`。

### L2-04（MAJOR）checker 在核准产物位置前读取 packet 路径

- 入口：`tools/check-delivery-spec.py` 的 `derive_capture_paths` / `derive_sidecar_path` /
  `derive_credential_path` / `derive_receipt_path` / `canonical_within`，以及
  `check_capture` / `check_sidecar` / `check_failure_artifact` / `check_terminal_receipt`。
- 改法：**先按已批准 stage + allocation + 固定命名推导唯一位置，并核规范目标，再读内容**；
  packet 声称的路径与推导位置不一致 → 立即拒绝该项（`not the derived location`），
  **不读后再累计错误**；越界/链接逃逸 → `escapes the recorder directory` / `escapes the artefact root`。
  凭据只能引用**同一个已核 sidecar**；run_id 与 capture basename 都必须是
  非空 ASCII `[A-Za-z0-9_-]`。
- direct 反例：handoff 的 `test_an_artefact_outside_the_derived_location_is_never_read`
  （用无害哨兵 + 读跟踪，断言哨兵**零内容读取**且其内容不进 problems）、checker 自检的
  `external_sidecar_path` / `external_capture_path` / `credential_references_another_credential`。

### L2-05（MAJOR）slot 身份与退出事实链未闭合

- 入口：`check_slot_chain`、`slot_matches`、`check_capture`、`check_sidecar`、
  `check_failure_artifact`、`check_terminal_receipt`。
- 改法：
  - slot 必须**非空、完整、唯一**；每 slot 逐字段归属一致（stage alias、case、phase、
    command/capture/run/level/expected exit）；`slot_matches` 现在**含 approved_stage_release**。
    **预留 allocation 不是必交 slot**（不计入必交，仍可执行不要求产物）。
  - **事实链**：原件 inner ↔ sidecar inner/outer ↔ 实际 wait/cleanup ↔ 资格凭据 连成一条；
    凭据的 `cleanup.source` 必须与**同一 sidecar 的实测对象**逐项相符；
    凭据的 inner 必须等于原件的 inner。
  - **非对象 JSON 明确拒绝**（sidecar/credential/receipt 均为 `not a JSON object`）。
  - producer 必须**从实际日志核指定断言确已触发**才签 `case_passed`
    （`assertion_reached` + 日志实读）；否则只记真实 CLEAN 与 exit，**不签资格**。
- direct 反例：checker 自检的 `stage_alias_swapped` / `wrong_evidence_level` /
  `capture_from_another_case` / `empty_evidence` / `sidecar_inner_differs_from_originals` /
  `assertion_not_reached_in_log` / `credential_cleanup_source_differs` /
  `sidecar_is_not_an_object` / `credential_is_not_an_object`；admission 的
  `test_proc0_13_a_slot_of_another_run_cannot_lend_its_assertion` 与
  `test_proc0_13_a_slot_of_another_command_cannot_lend_its_assertion`。

### L2-06（MAJOR）核验与预约之间的竞争窗口

- 入口：`command_run` 的 preflight → AuthorityLock 事务段。
- 改法：**最终校验与唯一 STARTING 预约在同一 authority 短事务内完成**；事务内
  再次核 **generation/sequence 未被期间 write/rebind 改变**（`STATE_CHANGED_DURING_PREFLIGHT`）
  并**再次核 capture 六 suffix 均不存在**；锁**不跨 wait**；**不得借 NO_CHILD 或 stale 例外重入**。
- direct 反例：`test_proc0_16_a_state_change_during_the_preflight_refuses_the_late_client`
  （两受控 mock 客户：另一客户端在预检后完成一次写事务，滞后请求被拒且**无第二 Popen**）、
  `test_proc0_03_existing_capture_and_unsafe_basenames_are_refused`（任一 suffix 存在即拒）、
  `test_proc0_04_a_second_client_finds_the_slot_busy`。

### L2-07（MAJOR）审计失败或旁证未落盘仍可显示成功

- 入口：`commit_event`、`_persist_running`、`_write_sidecar`、`_write_credential`、
  `_write_receipt`、`command_run` 的终局段与 `main`。
- 改法：
  - 每个事务先校验 state schema、slot/run 身份与**未完成 pending_audit**；**旧 pending 不能被新
    事件清掉**（`PENDING_AUDIT_NOT_CLEARED`），journal 失败后不自动 repair。
  - **物理 wait 事实与持久化/交还资格分离**：sidecar、凭据或 terminal 提交任一必需落盘失败 →
    CLI **明确非成功**（`NOT_ADMITTED` / 退出码 2）、admission BLOCKED/UNKNOWN，**不伪造内存 READY**。
  - 终局在 authority 事务内提交 terminal event（绑定 run、原件摘要、inner/outer、资源事实与
    产物 SHA），成功后写**本票唯一不可覆盖的 per-run terminal receipt**，绑定
    `event_id`/`sequence` 与产物 SHA；receipt 写失败也不报准入成功。
  - checker **从外部阶段票导出收据与 authority journal 位置**，核**同一事件确实存在且已提交**
    （不是只信 `sidecar.metadata_ok` 或一个自报 persisted 布尔）。
- direct 反例：`test_proc0_16_a_pending_audit_is_never_cleared_by_a_later_event`
  （state replace 成功、journal 失败 → 保原 event/pending，后续不得清旧 pending、不得报 READY）、
  checker 自检的 `terminal_receipt_missing` / `receipt_names_an_uncommitted_event`、
  handoff 的 `test_an_unsettled_resource_never_yields_a_verified_credential`。

### L2-08（MINOR）有限 barrier 的路径与时长约束依赖发票人

- 入口：`tests/process/fixtures/admission_helper.py` 的 `resolve_barrier_root`、
  `validate_barrier_markers`、`validate_barrier_hold`。
- 改法：barrier 根必须落在**当前项目自有 `var/process-admission/selftest/` 下的新具名根**；
  拒绝越界、相对路径与链接逃逸；**已有 held 或 release 标记即拒绝复用**（独占创建）；
  时长必须**有限且严格为正**（拒绝 NaN/inf/非正）；**清理失败如实失败**（不默默成功）。
  只用 pure 验证测试，**不跑实际 helper**。
- direct 反例：handoff 的 `test_the_helper_barrier_validation_is_bounded`。

### L2-09（MINOR）真实保护项路径与 direct fixture 形状不同

- 入口：`validate_release` 的 `protected_inputs` 规则、`verify_protected`、`digest_rows`。
- 改法：**recorded_source 继续只允许仓内相对路径**；**protected_inputs 允许 MAIN 精确列出的
  仓内相对项与必要绝对 pin**（固定 Python、MAIN observer 等），两者都实算 pre/post；
  **不变成 packet 任意文件读取许可**（checker 的产物路径一律由 stage+allocation 推导）。
- direct 反例：admission 的 `test_proc0_02_an_absolute_protected_pin_is_accepted_and_verified`
  （绝对 pin 正确 → 准入；摘要错 → 启动前拒绝）。

## 3. 原 16 case 的 direct 映射（未减少、未弱化）

| case | L1 direct 测试（新/改） | 备注 |
|---|---|---|
| PROC0-01 | `test_proc0_01_unknown_command_and_bad_release_are_refused`、`…_a_signed_corepack_command_uses_the_fixed_outer_interpreter`、`…_the_caller_cannot_inject_a_shell_or_a_raw_argv` | 保留未知 command/坏 SHA/空项拒绝；新增注入拒绝与固定外层正例 |
| PROC0-02 | `test_proc0_02_source_protected_and_recorder_drift_are_refused`、`…_an_absolute_protected_pin_is_accepted_and_verified` | 新增绝对 pin 形状（L2-09） |
| PROC0-03 | `test_proc0_03_existing_capture_and_unsafe_basenames_are_refused` | 六 suffix 任一存在即拒；basename 规则 |
| PROC0-04 | `test_proc0_04_a_second_client_finds_the_slot_busy` | 槽忙 + 锁不被删 |
| PROC0-05 | `test_proc0_05_the_write_lease_identity_is_enforced` | 新增 lease release SHA 核 |
| PROC0-06 | `test_proc0_06_unknown_state_blocks_and_locks_are_never_removed`、`…_a_missing_wrapper_epoch_never_spawns` | 新增 wrapper 缺证不 spawn |
| PROC0-07 | `test_proc0_07_status_never_claims_the_epoch_is_gone` | /proc 读不明不当作已退出 |
| PROC0-08 | `test_proc0_08_popen_failure_has_no_child`、`…_a_log_close_failure_after_the_child_keeps_the_wait`、`…_an_unverified_recorder_epoch_still_waits_but_blocks` | L2-01/L2-02 |
| PROC0-09 | `test_proc0_09_cancel_only_records_a_request` | 取消/不释放槽/sticky 三类断言保留 |
| PROC0-10 | `test_proc0_10_metadata_and_resource_state_are_separate`、`…_the_inner_and_outer_exit_domains_stay_separate`、`…_a_recorder_killed_by_a_signal_is_never_decoded` | 内外码域分离 |
| PROC0-11 | `test_proc0_11_source_drift_during_the_run_is_saved` | 运行期漂移保存并阻塞 |
| PROC0-12 | `test_proc0_12_a_live_group_member_keeps_the_slot_unknown`、`…_an_undeterminable_group_is_never_signed_clean` | 新增不可判定组永不签 CLEAN |
| PROC0-13 | `test_proc0_13_each_exit_is_bound_to_its_own_run`、`…_a_slot_of_another_run_cannot_lend_its_assertion`、`…_a_slot_of_another_command_cannot_lend_its_assertion` | 授权前置修正 + 两条借断言负控 |
| PROC0-14 | handoff `test_proc0_14_a_partial_or_trimmed_packet_is_refused` | 增加空 evidence / 缺 contract / 换 release |
| PROC0-15 | handoff `test_proc0_15_a_capture_from_another_case_is_refused` | 互换 capture 拒绝 |
| PROC0-16 | `test_proc0_16_a_capture_is_never_overwritten_and_rebind_is_exact`、`…_two_tickets_share_one_authority`、`…_a_state_change_during_the_preflight_refuses_the_late_client`、`…_a_pending_audit_is_never_cleared_by_a_later_event` | L2-03/06/07 |

结构断言：`test_all_sixteen_cases_have_a_direct_mapping` 仍逐项核 16 个 ID 与测试名存在。

## 4. 实际执行过的命令与 NOT_RUN

- 实际执行：`sha256sum`、`grep`、`sed -n`、`wc -l`、`ls`、`git rev-parse/status`（只读）；
  以及 `python3 -c "import ast; ast.parse(...)"` 的**纯静态语法核查**（不 import 被审模块、
  不执行任何被审代码、不跑任何测试）。未运行 `python3.12 -I -S -B` 任何被审脚本。
- **NOT_RUN**：全部 direct tests、checker `--self-test`、受审 CLI、新 runner、helper、
  corepack/node、R6/C/N、Host/Chrome/model、信号、网络、Git 变更。
- **失败原件全部保留**：bootstrap-001 的 B1 红灯（inner/outer 1/1，credential assertion 为 None）、
  bootstrap-002 的 B1/B2 绿与 B3 夹具 AttributeError（`str.read_text`）、bootstrap-003 的 B1/B2/B3
  全绿与源码快照，均在原 recorder 目录与 `bootstrap-00x/` 目录中原样保留，未覆盖、未删除。

## 5. 未决风险（交 MAIN 与 L2 复审裁决）

1. 本轮**没有执行任何测试**，因此「代码存在」不等于「语义完整」；所有 L1 结论必须由 MAIN 在
   bootstrap-002 票下用原 recorder FIRST 实录取得。红绿以实录为准。
2. authority 的**跨进程唯一性**依赖项目根固定目录；未做真实并发实证（L3 另票）。
3. terminal receipt 与 authority journal 的绑定是**合作式证明**，不防同用户任意改文件；
   checker 的零读取纪律依赖 stage+allocation 推导，仍需 L2 独立复核其覆盖是否完整。
4. checker 的 `slot_matches` 现在比较 `approved_stage_release`；若 MAIN 的阶段票用别的别名口径，
   需 MAIN 明确后我再改（未自行放宽）。
5. `rebind` 要求 generation 严格更新；MAIN 的后续票若沿用同 generation 会被拒，需 MAIN 确认口径。
6. helper 的 barrier 模式**只写未跑**，其真实行为（独占标记、释放观察、清理失败）尚无证据。

## 6. 交还

见 `OWN_L2_REPAIR_HANDOVER.md`（逐 case 与冻结候选、待 MAIN 冻结并发 bootstrap-002 票）。
