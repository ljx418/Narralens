# 剩余开发工作流登记册

状态：`APPROVED`。每次新增入口、worker、状态或 provider 时必须同步本登记册；不删除旧行，只标记 deprecated。

## 1. 按工作流

| 工作流 | 目标波次 | 触发 | 主责任实体 | 当前状态 |
|---|---|---|---|---|
| Agent 连续推进与交接 | 全波次 | 阶段开工、检查点、异常或移交 | 当前 Agent、Claude Code、项目负责人 | Approved；仅三类停点 |
| 原生编辑治理 | Wave 1 | Studio/native/CLI 写意图 | NativeWriteGateway、ProjectCoordinator | Approved / Wave 1 外审 PASS |
| snapshot 提交与恢复 | Wave 1 | typed edit/history | SnapshotStore、Journal、Outbox | Approved / Wave 1 外审 PASS；legacy AC-005 边界保留 |
| 持久 Job/Event | Wave 1 | proposal/render/migration job | PersistentJobStore、Lease、SSE | Approved / Wave 1 外审 PASS；部分业务 runner 待后续 |
| migrate-copy 与回退 | Wave 1 | 显式迁移副本 | MigrationService | Approved / `CONTROLLED_OPENFILM_READY` |
| proposal 素材化 | Wave 2 | 用户绑定已登记素材 | MaterializeService | Draft |
| impact 与采用 | Wave 2 | 用户选择 ready proposal | ImpactService、AdoptionCoordinator | Draft |
| 历史/撤回 | Wave 2 | undo/redo/restore | HistoryService | Draft |
| 项目/章节/选择 | Wave 3 | 创建项目或定位内容 | StoryProjection、SelectionCoordinator | Draft |
| 三路候选与原生精剪 | Wave 3 | 用户比较/采用/精修 | CandidateFocus、NativeEditBridge | Draft |
| 发布检查与交付 | Wave 3 | 固定 snapshot 导出 | Preflight、DeliveryWorkspace | Draft |
| StyleProfile | Wave 4 | 应用/回滚风格版本 | StyleProfileService | Draft |
| TTS/ASR/对齐 | Wave 4 | 声音或文本版本变化 | VoiceAdapter、AlignmentGraph | Draft |
| Provider/预算/反馈 | Wave 4 | 明确授权的外传任务 | ProviderGateway、BudgetLedger | Draft |

## 2. 按组件

| 组件 | 参与工作流 |
|---|---|
| `src/host/server.ts` | 所有 HTTP/SSE 入口、认证、能力开关 |
| `ProjectCoordinator` | 原生编辑、采用、历史、锁、迁移激活 |
| `RevisionStore/SnapshotStore` | 提交、恢复、历史、导出绑定 |
| `PersistentJobStore` | proposal、materialize、render、provider、migration |
| `EnginePort` | OpenFilm/Hypit inspect/plan/stage/validate/preview/render |
| `AssetRegistry` | 导入、binding、materialize、provider 产物、交付许可 |
| Studio shared stores | 项目导航、候选、原生精剪、交付 |

## 3. 按用户旅程

| 用户体验 | 底层工作流 | 波次 |
|---|---|---|
| Agent 在安全范围内连续工作，仅在需要人或 Claude Code 时交接 | 自动继续→检查点→根因修复→三类停点之一 | 全波次 |
| 安全打开并编辑迁移副本 | migrate-copy→受控编辑→snapshot→重开/回退 | Wave 1 |
| 比较三案并真正采用 | proposal→binding→materialize→impact→adopt→restore | Wave 2 |
| 在一个 Studio 完成 P0 视频 | 项目→章节→地图→精剪→QC→标题封面→导出 | Wave 3 |
| 完成含风格、声音、素材服务的长片 | Style→Voice→Provider→Feedback→Full delivery | Wave 4 |

## 4. 按关键状态

| 状态 | 进入方式 | 退出方式 |
|---|---|---|
| `handoff_required` | 需要人工核验/决策，或需要 Claude Code 实现 | 人工结论或 Claude Code 按完整提示词接手 |
| `attention` | commit 不确定、外部修改、恢复失败 | 人工/受控 recovery 证明一致后 |
| `ready_for_adoption` | native plan/proxy/lineage 全部验证 | adopt、stale、cancel |
| `cancel_requested` | 用户取消运行中 Job | cancelled、attention；晚到 quarantine |
| `stale` | base/control/binding/rights 变化 | 重新计算/重新执行，不自动采用 |
| `adopted` | Coordinator 成功提交 revision +1 | 历史恢复生成新 revision |
| `blocked_input` | 缺授权、真实内容、人工签署 | 用户提供输入后继续 |

## 5. 未规格化即阻断的入口

任何新增 HTTP、WebSocket/IPC、CLI、worker callback、file watcher、provider webhook 或原生按钮写路径，如果未登记 trigger、payload、成功/失败、timeout、cleanup、observable state 和 case ID，即标记 `Missing`，阻止所在波次出门。

