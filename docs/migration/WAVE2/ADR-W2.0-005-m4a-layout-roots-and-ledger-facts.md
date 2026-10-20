# ADR-W2.0-005：M4A 生产 layout 的 roots 与账本事实

状态：`ACCEPTED_M4A`
日期：2026-10-20
影响契约：AC-006、AC-008；不改变 EnginePort 七方法、单引擎或唯一提交权
前置：ADR-W2.0-004 §6

## 1. 触发事实

ADR-W2.0-004 §6 要求 `ActivatedProjectionService` 从 terminal migration、immutable plan、
target snapshot facts 与 `MigratedAssetLedger` 重建 `OpenFilmProjectLayout`，并写明
“ledger 中 target path/id/hash 形成 declared assets”。

在 M4A 实现时，源码事实与该句的后半段冲突，且冲突是 BLOCKER 级：`computeSourceDigest`
把 `declaredAssets` 折进 manifest——对同一文件，roots-only 路径写出 `asset_id: null`，
带 `declaredAssets` 的路径写出该 asset_id，两者 canonical JSON 不同，于是
`source_digest` 不同。而 `OpenFilmEngineAdapter.inspect()` 会把重算的 digest 与
`SnapshotRef.source_digest` 比较，不一致即 409 `SOURCE_CHANGED`。

也就是说：按 ADR 字面把账本资产作为 declared assets 加入 layout，会让**每一个已迁移
目标在 inspect 时都读作 SOURCE_CHANGED**，M4A-P01 与整条 impact 链路都无法成立。

## 2. 决策

**layout 只带 roots，不带 `declaredAssets`。**

- roots 由 `openFilmRoots(plan)` 给出：`film.html` 第一，其后 plan 的 narration、
  subtitles、assets 目标路径，去重并保序。这与 `MigrationService` 发布 snapshot 和
  `verifyCopy` 重验时使用的是**同一个实现**（`src/host/projects/openfilm-layout-facts.ts`），
  所以 digest 天然可比，不存在第二份“应该有哪些文件”的答案。
- 账本事实仍然参与，但作为**约束**而非额外 roots：`assertLedgerWithinRoots` 核对每个
  ledger `target_path` 都在 roots 之内，缺一即 fail closed。账本与 plan 是两条持久记录，
  二者矛盾时拒绝，而不是挑一条信。
- `subtitles` 来自 plan 的 `MigrationSubtitleMapping`，且它们同时是 roots，所以不改变
  digest。

## 3. 为什么这样仍然满足 ADR §6 的意图

ADR §6 的目的是“不要让 layout 成为可以随手拼装的缓存，事实要来自持久迁移记录”。roots
全部来自 immutable plan，root escape 在拼接之前就被词法拒绝，每个 root 的内容都进入
digest 闭包，缺事实即拒绝。账本作为一致性检查参与，比作为 roots 的一部分参与更严格：
加入 roots 会让一个只在账本里、不在 plan 闭包里的资产被静默纳入 digest，而拒绝会暴露
这处矛盾。

## 4. clip identity 与 frame_count

- clip identity 来自 pinned upstream 对 `film.html` 的解析（`EngineProjection.clips`），
  **不依赖** `MigrationPlanV1.identity_map`——该字段在复制前冻结为空，`ProjectResolver`
  已有注释说明依赖它会让每个目标都不可读。
- Host frame_count 仍取 migration store 的 `target_total_frames`。
- 不把 report 的 `target_clips` extras 或任何临时 report 字段当持久事实。

## 5. 影响

- `ActivatedProjectionService.layoutFor()` 的输出可被 adapter 复现出与迁移提交时**逐字节
  相同**的 `source_digest`；`M4A-P01` 的重启测试即以此为判据。
- 若将来要把账本资产以别的形式纳入 digest，必须新增一个独立的 digest 版本或字段，不得
  在 v1 内改变 roots-only 的语义。

## 6. 回退

本决策只影响 layout 的构造。若将来推翻，必须同时作废所有已签发的 active impact
（其 `source_digest` 参与 hash），并按 `impact -> stale` 收敛，不能让两种语义并存。
