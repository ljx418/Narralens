# M4C 第二轮独立外部审查（Codex）

审查日期：2026-10-26  
审查对象分支：`migration/m2.2-coordinator-persistence`  
冻结候选 HEAD：`c49b05900796cff4f528519d193c8ca8c0dbd9b2`  
实现/捕获提交：`c7307f8e02c5294f083d94ddc1a0dda645dcba11`  
前次外审记录：`5ac14027ac50c858f7f23803ea63c92ea2b7b088`  
结论：**NOT PASS — BLOCKER=0 / MAJOR=6 / MINOR=4**

本文件是独立只读外审结论。审查没有修改生产代码、合同、测试或既有 evidence，没有进入 M5，也没有自签任何后续 Gate。

## 1. 执行摘要

上轮 B-01 路径逃逸、M-01 redo current-commit、M-03 plan 字段形态已经实质关闭；M4C 的真实恢复、幂等、路径负向、媒体渲染和当前异常注入矩阵也稳定通过。但候选仍不能取得外审 PASS：

1. 差异分类器没有把同轨 clip 顺序和 clip kind 纳入 topology，存在实际少锁路径。
2. visual 边界变化可生成项目锁却返回空 `affected_ranges`；单一 clip 会被误报为 shared asset；transition 没有实现却关闭了 TX-04C。
3. 发布后的恢复把所有 affected range 再解释为 visual-shot 锁，使 narration/audio 恢复被无关视觉锁阻断。
4. fault matrix 测的是异常抛出和正常清理，不是真实进程丢失；它也没有观测嵌套 asset temp，却声明检查了所有 temp。
5. 权威架构文档仍把已经通过 M4B 外审的 migration edits 路由写成“未实现”。
6. 已接受 ADR 与真实 DDL、锁事实绑定和 D-05 错误码仍不一致，交付报告也明确把 ADR supersession 列为未完成。

这些问题会直接影响 M5 要展示的 impact、锁冲突和恢复状态，因此不能带入人工体验阶段。

## 2. 独立验证结果

基线核对与交付报告一致：branch、HEAD、origin/main 正确，测试开始前工作树干净；`c7307f8` 到 `c49b059` 没有 `src/`、`tests/`、`contracts/`、`tools/` 或 package scripts 变化，只有捕获 evidence。

本审查独立执行：

```text
corepack pnpm test:wave2:m4c
  exit 0 — 6 files / 113 tests

corepack pnpm evidence:wave2:m4c:integrity
  exit 0 — 20 checks

corepack pnpm test:wave2:fitness
  exit 0 — 3 files / 45 tests
```

M4C 专项实际耗时约 2010 秒；其中 fault matrix 42/42、真实 900 帧渲染、resolver symlink 负向、redo 回归均通过。捕获中的 `pnpm check` 为 82 files / 1029 tests、exit 0；本次没有重复运行整套 check，故只把它记为“冻结捕获已核验”，不冒充本审查会话独立复跑。

绿灯说明已覆盖路径稳定；下面的发现均来自生产代码检查和独立最小复现，不能由现有测试数量抵消。

## 3. 上轮发现的关闭状态

| 上轮项 | 第二轮判定 | 说明 |
|---|---|---|
| B-01 snapshot `source/` symlink 逃逸 | **CLOSED** | source `lstat`、canonical containment 与真实逃逸测试成立 |
| M-01 redo 锚定错误 | **CLOSED** | redo 已锚定 active commit，restore→adopt→redo 为 422 |
| M-02 D-04 锁模型 | **PARTIAL** | boundary 的 project locks 已增加，但顺序/kind/affected ranges 仍有缺口 |
| M-03 plan 唯一 shape | **CLOSED** | 实现回归 ADR D-03，affected ranges 已进入 hash preimage |
| M-04 逐边界故障矩阵 | **PARTIAL** | seam 枚举与异常矩阵成立，但真实进程丢失/temp 证据仍不成立 |
| M-05 权威文档同步 | **PARTIAL** | history 路由已同步，但 migration edits 状态仍错误 |

## 4. 重大问题

### M4C-R2-01：顺序与 kind 未进入 topology，实际锁范围可被低估

严重度：**MAJOR**  
涉及：`src/host/history/history-restore-plan.ts:93-120,233-284,451-461`、ADR D-04、TX-03C

`projectionDigest()` 按 `clip_id` 排序且完全不包含 `tracks[].clip_ids`；`restoreTargetIsEligible()` 只比较 clip 数量、id 和 track id；`topologyChanged` 只看增删、frame boundary 和总帧数。因此：

- 同一 track 内只改变 clip 顺序，projection digest 相同、target 被认为 eligible，builder 报“没有差异”；
- 顺序变化再叠加一个 clip 的素材变化时，builder 只申请该 clip 的 visual-shot 锁，不申请 ADR 要求的 visual-project + duration-project；
- page/video ↔ sound 的 kind 变化也被认为 eligible，并按 current kind 分类，可能把 audio/narration 变化错分为 visual-shot。

独立复现：当前 `[a,b]`，目标 `[b,a]` 并仅修改 `a.source_ref`，实际 plan 只有 `visual/shot/a`。用真实 `LockService` 在 `b` 上持有 visual-shot 锁后，`assertUnlocked(project, plan.required_locks)` 仍然通过。目标 film 会整体改变顺序语义，而 `b` 的保护没有参与授权。

该项最终定为 MAJOR 而非 BLOCKER：当前 M4B/M4C 的正式写路径不会生成“只改变同轨顺序”的 committed snapshot，因此尚未证明 V1 用户可以直接触发这条绕过；但 builder、合同和 CLOSED case 已承诺支持/分类该差异，且后续 native edit 一旦开放就会使路径可达，所以必须在进入 M5 前关闭。

现有“clips were reordered”测试实际交换的是两个 clip 的 frame ranges，并没有测试只改变 `tracks[].clip_ids` 顺序，所以无法咬住此缺陷。

修复门：projection digest 必须绑定 track 顺序；eligibility 必须验证 kind 与精确 topology；纯顺序、顺序+内容、page/video↔sound 都须 fail closed 或按 ADR 生成完整 project locks/consumers。使用真实 LockService 证明任一受影响 clip 的锁都能阻断。

### M4C-R2-02：affected ranges、shared consumer 与 transition 图仍不完整

严重度：**MAJOR**  
涉及：`src/host/history/history-restore-plan.ts:259-406`、ADR D-03/D-04、TX-04C

三个可复现问题属于同一个 consumer/impact 分类器：

1. visual clip 只有 frame boundary 变化时会得到 visual-project + duration-project locks，但 `affected_ranges=[]`。冻结 wire 只允许 narration/audio-only diff 合理为空；视觉边界变化不应向用户呈现空影响范围。
2. asset users 通过 `[current.source_ref, target.source_ref]` 追加到数组；两者相同时，同一个 clip 被添加两次。一个 clip 的 trim/override 变化因此会虚构 `shared_asset` consumer。独立复现得到 `shared_asset/assets/shared.mp4/replace`，实际上只有一个 consumer。
3. Gate TX-04C 明确要求 subtitle/audio/**transition**/shared asset 完整分类；生产 plan 没有 transition 分支，测试和 case map 也没有 transition 用例，却把 TX-04C 标为 CLOSED。

修复门：范围必须覆盖每个视觉 timing/topology 差异；asset users 按 clip id 去重；transition 要么实现受 hash 绑定的 consumer/locks，要么正式修改 Gate 并把 case 标为未支持，不能继续以 CLOSED 宣称完整分类。

### M4C-R2-03：崩溃恢复把所有 affected range 错当 visual-shot 锁

严重度：**MAJOR**  
涉及：`src/host/history/history-service.ts:662-670`

恢复路径先把 `impact.affected_ranges` 全部映射成：

```ts
{ lock_type: "visual", scope: "shot", target_id: range.clip_id, ... }
```

随后才检查 immutable fact 的真实 `required_locks`。但 plan 会为 narration/audio 变化生成 affected range，并要求 narration-project lock。发布后发生恢复时，无关的 visual-shot 锁会阻断本应只受 narration lock 约束的恢复；这与在线提交和 ADR D-04 的锁语义不同。

修复门：恢复只使用经过不可变 fact/plan 授权的真实锁集合；增加 narration-only/audio-only 在发布后崩溃、同时存在无关 visual 锁的恢复测试，必须收敛而不是返回 TARGET_LOCKED。也要验证应命中的 narration lock 仍然阻断。

### M4C-R2-04：fault matrix 没有证明真实进程丢失和嵌套临时文件清理

严重度：**MAJOR**  
涉及：`tests/wave2/m4c/history-fault-matrix.test.ts:37-88,195-330`、TX-08C、M4C-17

40 个 seam 在异常模型内全部通过，这部分证据有效。但测试中的 `SimulatedHistoryCrash` 是 throw；`AuthorSourcePublisher` 的 catch 会继续运行并删除 temp，随后 service finally 也会清理 isolated tree。这不是进程在边界直接消失。

同时 `facts().temp` 只执行 active root 顶层 `readdir()`，且只收集包含 `.film.tmp` 的文件；asset temp 实际位于 `assets/<sha>/source.mp4.<uuid>.tmp`，完全不可见。case 文案却声明每个边界都检查 `temp`、不存在任何 orphan。

所以当前矩阵没有证明 `#sweepAssetTemporaries()` 在真实遗留 temp 上有效，也不能支持“真实进程丢失只会让清理更少、不会让结论更弱”的推断。

修复门：至少增加一个独立子进程 hard-exit/kill 的测试，分别停在 asset temp fsync、asset link、film temp fsync、film rename 与 DB commit 附近；重启后递归枚举 staging/active roots，断言所有 temp、source、revision、pointer、impact、outbox、idempotency、snapshot 与 transaction。若本阶段只承诺异常注入，就必须下调 TX-08C/M4C-17 状态和文案，不能称作完整 crash matrix。

### M4C-R2-05：权威架构文档仍有当前状态冲突

严重度：**MAJOR**  
涉及：`docs/03_Architecture.md:188`、M4C-6

同一份当前架构文档先声明 M4B 外审 PASS，随后仍写：

```text
POST /api/migration/v1/projects/:id/edits：Wave 2 冻结、未实现
```

真实 route inventory 和 manifest 都证明该路由已由 M4B 实现并通过外审。M4C-6 要求 architecture/traceability/route inventory 同步，这一当前状态冲突说明 M-05 尚未完整关闭。

修复门：把该行同步到真实 M4B adopt route、合同和写入所有者；再对三份权威文档做自动化 route/status 一致性检查，避免只依赖人工查残句。

### M4C-R2-06：已接受 ADR 尚未成为真实实现的唯一合同

严重度：**MAJOR**  
涉及：ADR-W2.0-006 D-05/D-06、`src/host/history/history-store.ts:95-137`、交付报告未完成项

候选仍明确承认下列未裁决差异：

- `history_restore_fact` 比 D-06 锁定 DDL 多五个事实字段；
- `required_locks_json` 与 `restore_plan_sha256` 的绑定依赖写入代码，而不是可独立复算的合同；
- D-05 指定的 422 error code 与实现不同；
- 内部审查把这些记为“以后 supersession”。

这些可以是合理设计，但在状态为 `ACCEPTED_FOR_M4C_IMPLEMENTATION` 的架构契约里仍是未裁决偏差。项目流程要求架构契约锁定后才能交给下一阶段，因此不能一边保留旧 ADR 为权威、一边以内部 MINOR 延后正式裁决。

修复门：补一份明确 supersede/augment D-05/D-06 的 ADR，逐字段说明不可变性、恢复用途、hash/lock 绑定和错误码；同步开发门、架构、traceability 与测试。若决定回归旧 ADR，则修改实现和数据迁移，不能只改审查措辞。

## 5. 次要问题

1. `HistoryFaultPoint` union 缺少运行时 registry 中的 `during_stage_copy`、`after_published`；`HistoryFaultDescriptor.stage` 也没有 `adapter`，代码用 `as HistoryFaultDescriptor[]` 掩盖了类型错误。
2. `after_committed` 在 HTTP response 返回前触发，但描述写成“response has been produced”，名称与观测边界不一致。
3. 内审 §4 先写 21+18=39，§4.1 又写真实计数为 40；最终 case 写 40。应统一，防止 evidence 读者误判。
4. narration rights 豁免仍没有负向测试；该项可保持 MINOR，但建议与上述分类器测试同批补齐。

## 6. 复审准入条件

下一冻结候选须一次性满足：

1. topology/kind/order/range/consumer 分类表成为单一可枚举合同，并有旧实现必红的测试。
2. 真实 LockService 覆盖 pure reorder、reorder+content、kind change、boundary-only、narration/audio recovery。
3. TX-04C 的 transition 语义实现或正式下调范围，case 状态不再过度声明。
4. fault matrix 增加真实子进程丢失与递归 temp 证据，或诚实降低 Gate 状态。
5. ADR supersession 与三份权威状态文档同步完成，并增加自动一致性门。
6. 原 113 项 M4C 测试、全回归、build、凭据扫描、黄金向量和 evidence integrity 在干净 capture commit 上重新通过。
7. 新冻结 commit 由独立会话再次复验；实现会话不得自签。

## 7. 声明边界

本轮结论为 `M4C_EXTERNAL_REVIEW_NOT_PASS_ROUND2`。当前最高声明保持 `M4C_INTERNAL_EVIDENCED`。不得进入 M5，不得声明 M4C 外审 PASS、Wave 2 组合 PASS、`WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、V1-P0、V1-Full、headed/human 已验。

