# Wave 2 开工包：先读本文

状态：`M4C_FROZEN_FOR_IMPLEMENTATION`（M4B 内部冻结候选已形成、独立外审待签；M4C 文档门已冻结）
范围：M3 materialize + M4A impact + M4B adopt + M4C history/restore
当前实现基线：`b2a4efb8be7f4b1c02f973ff32ea04b097196649`（M4B 内部冻结候选）
Wave 1 冻结代码：`e2dec5ca03ee881b55f92b920ee6df2c676aeb26`
目标声明上限：`WAVE2_EDITABLE_ADOPTION_READY`

## 1. 阅读顺序

1. 本文；
2. `01_BASELINE_AND_GAPS.md`；
3. `02_ARCHITECTURE_AND_CONTRACTS.md`；
4. `03_DEVELOPMENT_AND_ACCEPTANCE_PLAN.md`；
5. `04_INTERNAL_REVIEW.md`；
6. `05_CLAUDE_CODE_HANDOFF.md`；
7. `06_DOCUMENT_FREEZE.md`；
8. `docs/03_Architecture.md`、`docs/11_V1_Traceability.md`；
9. `docs/handoff-m2-m7d-claude/06_ARCHITECTURE_CONTRACT_LOCK.md` 与真实源码、测试、evidence。

M4C 开工时在第 3 项后插入以下直接权威，且优先于早期 Wave 2 总纲：

1. `ADR-W2.0-006-m4c-history-restore.md`；
2. `17_M4C_DEVELOPMENT_GATE.md`；
3. `16_M4C_HISTORY_RESTORE.html` 与 `.sequence.json`；
4. `18_M4C_CLAUDE_HANDOFF.md`。

事实冲突时按以下顺序裁决：当前源码/测试/数据库约束 → Wave 1 冻结证据 → 本包冻结决策 → 总架构与
追踪矩阵 → 早期 docs-only D4.2 草案。不得用旧草案覆盖已通过的 M2 实现。

## 2. 本波唯一垂直结果

从一个已迁移的 OpenFilm 三镜项目和一组真实 D4.1 proposal 出发，完成：

`绑定已登记素材 → 只读 materialize → server impact/hash → 用户批准语义 → 受控采用 → revision +1
→ 三个原生 clip 仍可独立编辑 → snapshot 绑定导出 → 关闭重开 → 改一镜 → 再导出 → 恢复旧内容产生新 revision`。

M3 不写 author source、active commit 或 project revision。M4 的所有写入必须经过
`ProjectOperationQueue → NativeWriteGateway → ProjectCoordinator → EnginePort stage/validate →
SnapshotStore → commit record/outbox`，adapter 无 commit 权。

## 3. 明确不在本波

- M5 同页 Studio 完整 UI、章节/镜头地图、六类选择和 headed 人工体验；
- M6 标题、封面、preflight、正式交付和 Gate V1-P0；
- M7 风格、TTS/ASR、Provider/预算、长片和 V1-Full；
- 插件市场、第二 timeline、Gemini 服务、Remotion 全片后端；
- 删除 Hypit、改写旧 Gate 证据或把 migration rollback 当作 history restore；
- 未授权外传、付费生成或读取 `J:\` 移动硬盘中的私有素材。

## 4. 开工前门

Claude Code 只能在以下条件同时成立后写代码：

- 工作树用户改动已识别并保护，不 reset/stash/force push；
- Wave 1 historical integrity PASS；current-tip 历史门按后续合法变化如实记录；
- 本包状态为 `M4C_FROZEN_FOR_IMPLEMENTATION`；
- 不存在未关闭 BLOCKER/MAJOR 文档问题；
- M4B 独立外审为 PASS，M4C 文档三轮审查为 PASS，且现场基线复验命令仍通过；
- materialize/impact/adopt 已按 M3/M4A/M4B 开放；history restore 在 M4C 开工前仍为 404；
- 本轮不需要费用、外传、headed 或人工内容判断。

## 5. 出门口径

只有 M3/M4 全部逐 case 证据、组合回归、内部四视角审查和独立外审通过，才能声明
`WAVE2_EDITABLE_ADOPTION_READY`。该声明仍不等于 D4.2 以外的完整 P0，更不等于 V1-P0/V1-Full。
