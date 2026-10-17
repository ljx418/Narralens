# 剩余需求—阶段—实体—验收追踪

本表是实施索引，状态继承 `docs/11_V1_Traceability.md`，不覆盖其历史结论。

## 0. 波次映射

| 正式交付波次 | 保留的需求/Gate 编号 | 正式组合审核点 |
|---|---|---|
| Wave 1 | M2.1/M2.2/M2.3 | 完整 M2 组合候选 |
| Wave 2 | M3/M4A/M4B/M4C | 可编辑采用闭环组合候选 |
| Wave 3 | M5A/M5B/M5C/M6.1/M6.2/M6.3 | Gate V1-P0 组合候选 |
| Wave 4 | M7A/M7B/M7C/M7D | V1-Full 组合候选 |

Mx.y 仍是逐项需求、测试、证据和故障定位编号，但普通模块检查点不再自动触发人工停工或独立外审。

## 1. P0/NFR

| 需求 | 当前基线 | 目标 Gate | 责任实体 | 验收 |
|---|---|---|---|---|
| P0-01 项目/任务包 | not-started | M5A | IdeaWorkspace、ProjectCreationService | UX-01/02 |
| P0-02 章/脚本/镜 | partial | M5A | StoryProjection、ChapterNavigator | UX-03/04 |
| P0-03 播放器/时间码 | partial | M2/M5A | OpenFilmAdapter、PlaybackClock | TM-01、UX-05 |
| P0-04 全片/局部时间轴 | not-started | M5A/B | native Timeline、StoryAtlas | UX-05/06、PF-01 |
| P0-05 区间/逐帧 | partial | M2/M5A | SelectionCoordinator | TM-01/02、UX-05 |
| P0-06 3–6 提案 | D4.1 done，engine migration 待验 | M3/M5B | ProposalAdapter、CandidateFocus | PR-01/02、UX-07 |
| P0-07 三类锁 | visual partial | M2/M4B | LockService、ConsumerGraph | TX-03/04/13 |
| P0-08 素材/来源/许可 | import partial | M3 | AssetRegistry、Binding/Materialize | MT-01..06 |
| P0-09 差异确认 | partial | M4A | ImpactService | TX-01/02/05 |
| P0-10 版本/恢复/冲突 | partial | M2/M4B/C | Snapshot/History/Recovery | JB、TX-06..12 |
| P0-11 重开/MP4 | 短 fixture partial | M4C/M6 | SnapshotRenderService | TX-11/12、DL-01 |
| P0-12 标题/封面 | not-started | M6.2 | Title/CoverWorkspace | DL-02/03 |
| P0-13 发布检查 | not-started | M6.2/3 | PreflightService | DL-04..06 |
| NFR-01 本地优先 | partial | M2/M7C | Security/ProviderGateway | EN-06、P1-03 |
| NFR-02 可恢复 | partial | M2/M4 | Journal/Snapshot/Recovery | JB、TX-08/12 |
| NFR-03 可观察 | partial/in-memory | M2/M3 | PersistentJob/Event | JB-01..06、MT-05 |
| NFR-04 可测试 | partial | 全阶段 | contracts/evidence | 全部 case |
| NFR-05 性能 | not-started | M5C/M7D | projection/virtualization | PF-01..03 |
| NFR-06 可访问 | partial | M5C/M6 | Studio UI | UX-11、DL-06 |

## 2. P1

| 需求 | Gate | 责任实体 | 验收 |
|---|---|---|---|
| StyleProfile/账号模板 | M7A | StyleProfileService | P1-01 |
| TTS/ASR/字幕对齐 | M7B | VoiceAdapter、AlignmentGraph | P1-02 |
| 素材检索/生成、预算、队列 | M7C | ProviderGateway、BudgetLedger | P1-03 |
| 评论/反馈锚点 | M7C | FeedbackService | P1-04 |
| 完整 10–15 分钟稳定流程 | M7D | 全系统 | P1-05/06 |

## 3. 架构契约到 Gate

| Gate | 必须关闭的 AC |
|---|---|
| M2.1 | AC-001..006、AC-016、AC-019 |
| M2.2 | AC-005..008、AC-012/013 |
| M2.3 | AC-001/004/006/011/019 |
| M3 | AC-009/011/012/014/016 |
| M4 | AC-004/005/007/008/010/011/013 |
| M5 | AC-002/003/015/018 |
| M6 | AC-013/014/018/020 |
| M7 | AC-016/017/018/020 |

## 4. 路由开放表

| 路由/能力 | M2 | M3 | M4 | M5+ |
|---|---|---|---|---|
| engine binding/capabilities | 开放只读/迁移控制 | 保持 | 保持 | 保持 |
| materialize | 404 | Job 开放 | 保持 | UI 接入 |
| impact | 404 | 可选只读设计但不采用；默认 404 | 开放 | 保持 |
| adopt/edit materialization | 404/虚构 op 422 | 同左 | 开放 | UI 接入 |
| history restore | 关闭 | 关闭 | 开放 | UI 接入 |
| provider generation | 默认拒绝 | 本地 proxy 非 provider | 仍拒绝未授权 | M7C 才开放 |

## 5. 完成口径

表中任何 `partial/not-started/NOT_RUN/BLOCKED_*` 均不得按“总体百分比”吞掉。M6 检查所有 P0/NFR；M7D 再检查 P0/P1/NFR。旧证据可以作为回归输入，但新引擎相关能力必须重新实证。

