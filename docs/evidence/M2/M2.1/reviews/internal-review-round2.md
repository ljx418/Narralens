# M2.1 内部审查记录（第二轮：外审返修）

审查对象：外审返修后的 M2.1 候选
审查人角色：实现会话。**不得**签署独立外审；外审由独立 Codex 会话执行。
审查前提：先复现外审报告的两个实验，再逐条返修；不允许只改文档或措辞关闭问题。

## 0. 先复现，再修复

外审的两个 BLOCKER 在修复前被逐字复现：

| 实验 | 外审结论 | 我的复现 |
|---|---|---|
| Hypit 视觉资产 bytes 改变、manifest 不变 | digest 不变（`57259ca4...5307`） | 一致：`manifest_unchanged=true`、`referenced_visual_bytes_changed=true`、`equal=true`，`assets[]` 只有 narration |
| 两个内部路径/symlink 指向同一 canonical file | manifest 出现两行 `assets/tokens.css` | 一致：`tokens_occurrences=2`、`duplicate=true` |

两个实验现已成为可执行脚本 `tools/m2.1-external-review-repro.mts`，断言的是**修复后**的行为。

## 1. 逐条返修

| Finding | 修复提交 | 关键实现 | 失败测试（修复前红） | 复验 |
|---|---|---|---|---|
| B-01 | `0364a54` | Host 在 `project_state` 持有已提交 `source_digest`，只在首次登记写入、永不再采样；adapter 以该基线比对；检测与置 attention 在既有 `ProjectOperationQueue` 项目串行边界内 | `tests/m2.1/native-bypass.test.ts` B-01 两条（修复前 200 而非 409） | 真实 HTTP 全链：409 → `attention=true` → typed edit 423 → 外部 bytes 未变；连续三次读仍 409 |
| B-02 | `0364a54`（见 §3 原子性说明） | Hypit 闭包重读每个被引用资产的当前 bytes；缺失/逃逸/hash 不符一律 fail closed | B-02 四条（修复前 digest 不变） | 合法重导入改变 digest；陈旧 manifest 下拒绝；缺失与逃逸拒绝 |
| M-01 | `3c1ddf1` + `6a389b1` | 每引擎对每条引擎自有 operation 返回显式状态；网关 fail closed；Host service 能力独立成表 | M-01 六条（修复前两 adapter 返回 `{}`） | 完整性、无 supported、无 unverified、OpenFilm 两条写为 blocked、缺表即拒 |
| M-03 | `91fed6f` | identity 是 realpath：roots 先 canonical 化，引用在去重前解析为 canonical 文件 | M-03 五条（修复前 symlink alias 重复两行） | alias 一行、根经 symlink 解析、环一次、Windows/WSL 形状拒绝 |
| M-04 | `5302dd1` | 固定 HEAD + 无 tracked 修改 + 每个将被执行/读取文件的固定 SHA256；三者缺一即 `ENGINE_UNAVAILABLE` | M-04 八条 | 合成树逐文件篡改全部被拒；真实探针 tamper 隔离副本被拒且原 checkout 仍可加载 |
| M-05 | `d445c56` | OF-06 拆为 06a/06b/06c，显式 `assert.equal(rebased, true)` | 原探针无 oracle（记录 PASS 但不断言） | 06a 真实上游 rebased；06b 生产 adapter 在真实上游拒绝且 author bytes 不变、无残留 staging；06c adapter 合同（stub，明确标注） |
| M-02 | `d445c56` + `9a58170` + `46b0e89` | 证据改 `.txt`/`.cmd`/`.exit`；manifest 绑定捕获提交、`repo_dirty_at_capture=false`；新增完整性校验脚本与测试 | 完整性校验曾报 `repo_dirty_at_capture=true` | 25 个被引用文件存在/被跟踪/未被 ignore/摘要一致；捕获后无代码变更 |

## 2. 变异测试：每条新门都能失败

11 条变异用例全部按预期使所属门失败（MUT-A..MUT-K），其中：

- MUT-G 网关去掉 fail-closed 守卫 → 能力测试红
- MUT-H Hypit 去掉资产 bytes → B-02 测试红
- MUT-I 队列退回逻辑引用路径 → M-03 测试红
- MUT-J 加载器跳过固定摘要校验 → M-04 测试红
- MUT-K Host 不再置 attention → B-01 测试红

**过程中发现两处工具自身缺陷，均已修复**：

1. MUT-I 最初改的是一行**已变得冗余**的代码（`visited.has(target.relative)`），因此并未真正失败；
   改为还原真正承载缺陷的那一行（入队用逻辑路径）后才正确失败。这说明「变异失败」必须逐条
   确认失败原因，不能只看 exit code。
2. MUT-D 的锚点在 canonical 化改动后失效，导致该门**假通过**；已更新锚点并加断言。

## 3. 诚实记录：两处流程瑕疵

- **I-R-01 MINOR（未修复，已披露）**：`0364a54` 用 `git add -A src tests tools`，把 B-01 与 B-02 两个
  finding 的改动一并提交，不是原子提交。此后提交均改用显式路径。不重写历史，按事实披露。
- **I-R-02 MINOR（已修复）**：`3c1ddf1` 提交时 fitness 断言仍写着旧的 `reported?.state` 写法，
  带着一条红灯提交；`6a389b1` 修正。此前会话也有同类情况（一次带着红灯、一次 `git add -A`
  误提交用户未提交文档）。改进：提交前必须先跑 `corepack pnpm check`。
- **I-R-03 NOTE**：B-02 的「manifest 不变、只改资产 bytes」实验，修复后的结果是**拒绝**而不是
  「digest 变了」。这比外审设想的更强，且更安全：一个自身内容指纹与实际内容矛盾的 source
  不应被当作完整 source 计算摘要。两个要求（纳入当前 bytes、hash 不一致 fail closed）同时成立，
  记于 ADR D-14。

## 4. 一并处理的三个观察项

- OpenFilm `stage()` 任何失败路径都清理临时目录（`try/finally`，成功才移交所有权）。
- `absoluteServerPath` 移到 Host-only 模块 `src/host/engine/isolated-root.ts`；
  `StagedSource` 只回传**相对目录名**，adapter 无法铸造服务端路径；fitness/测试断言
  `src/adapters/**` 不引用该构造器。
- 投影 preview 改为 Host loopback 地址（`/api/migration/v1/projects/:id/preview` 由 Host 绑定 origin），
  不再返回 `file://` 绝对路径；测试断言响应中无 `file://`、无 `/mnt/`、无盘符、无 `project_path`。
- materialize / impact / adopt / migrate-copy / history restore 仍全部 404，未提前开放。

## 5. 内部审查结论

- BLOCKER = 0
- MAJOR = 0（B-01、B-02、M-01..M-05 全部关闭并复验）
- MINOR = 2（I-R-01、I-R-02，均为流程瑕疵，已披露/已修复）
- NOTE = 1（I-R-03，属设计口径而非缺陷，已记入 ADR）

**结论：可提交返修后的冻结候选，交独立复审。**

在独立复审 PASS 之前：
- 不进入 M2.2；
- 不声明 `M2_1_CONTROL_BOUNDARY_READY`、M2、Gate D4.2、`Gate V1-P0` 或 `V1-Full`。

## 6. 残余风险

1. `vendor/openfilm` 仍未登记为 submodule，真实接缝验证依赖隔离 worktree，不是生产集成。
2. 网关的生产强制点仍待 M2.2 Coordinator 接线或 M4A 生效（ADR D-12）。
3. 三类锁、snapshot commit、持久 Job 全部未实现，Job 仍是内存态。
4. headed 与人类体验 `NOT_RUN`；本 ticket 无任何 UI 自动化。
5. 迁移副本注入演练与回退属 M2.3。
6. 交接包 `13_ACCELERATED_DELIVERY_STRATEGY.md`（Wave 1 = M2 全部）与本轮「先关外审再进入 M2.2」
   的要求并存；按用户本轮指令，独立复审通过后可自动继续 M2.2→M2.3。
