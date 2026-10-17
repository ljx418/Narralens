# M2–M7D 四波次总体开发路线

## 1. 推进模型

剩余工作合并为四个可形成真实垂直结果的开发波次。原 M2.1–M7D 编号继续作为模块、case 和证据定位，不再默认成为人工停工点。

```text
Wave 1：M2.1 → M2.2 → M2.3
受控 OpenFilm 运行时、持久性、迁移副本与回退
                         │ 组合 Gate：EN/TM/JB + legacy
                         ▼
Wave 2：M3 → M4A → M4B → M4C
素材绑定、代理/native plan、impact、采用、历史与恢复
                         │ 组合 Gate：PR/MT/TX 真实编辑链
                         ▼
Wave 3：M5A → M5B → M5C → M6.1 → M6.2 → M6.3
同页 Studio、真实章节、性能/可访问、P0 交付
                         │ Gate V1-P0 + 用户签署
                         ▼
Wave 4：M7A → M7B → M7C → M7D
风格、声音字幕、Provider/预算/反馈、完整长片
                         │ V1-Full Gate
                         ▼
                     V1-Full
```

波次内连续实现：模块检查点通过后自动进入下一模块，不重复等待独立外审。波次末才运行组合全量回归、冻结 evidence、内部四视角审查和一次独立外审。完整规则见 `13_ACCELERATED_DELIVERY_STRATEGY.md`。

## 2. 四波次交付表

| 波次 | 包含模块 | 用户/系统可见结果 | 组合验收 | 出门声明 |
|---|---|---|---|---|
| Wave 1 | M2.1 EnginePort/网关；M2.2 snapshot/Job/三类锁；M2.3 migrate-copy/回退 | 一个固定 OpenFilm 副本可受控编辑、重启、恢复、导出并切回旧项目 | EN-01..06、TM-01..03、JB-01..06、D1–M1 旧回归 | `CONTROLLED_OPENFILM_READY` |
| Wave 2 | M3 binding/materialize；M4 impact/adopt/history/recovery | 三案真实 proxy，采用后仍为三个原生 clip，可撤回、重开、双导出 | PR-01..03、MT-01..06、TX-01..14 | `ADOPTION_AND_RECOVERY_READY` |
| Wave 3 | M5 同页 Studio；M6 实片/P0 交付 | 真实 3–5 分钟、20+ 镜章节在统一工作台完成并生成发布包 | UX-01..12、PF-01..03、DL-01..06、13 P0/6 NFR | `Gate V1-P0 ACCEPTED` |
| Wave 4 | M7A–D P1 | 完整 10–15 分钟项目含风格、声音、素材服务、预算和反馈 | P1-01..06 + P0/P1/NFR 全回归 | `V1-Full ACCEPTED` |

## 3. 波次内模块检查点

模块检查点不是正式 Gate，只回答“是否安全继续本波次”：

1. 新增合同、schema 和状态机已实现并通过合同测试；
2. 受影响单元/HTTP/集成/故障测试通过；
3. 架构 fitness 无 AC 违例；
4. 旧行为没有被删除或弱化；
5. 证据已追加到波次 manifest；
6. 没有 BLOCKER/MAJOR 或需要用户授权的事项。

满足后 Claude Code 直接继续下一模块。普通编译、类型、局部回归或 adapter 差异由实现会话自动修复，不向用户请求逐项批准。

## 4. Wave 1：完整 M2 受控运行时

### 统一设计冻结

开工前一次性冻结 EnginePort、EngineBinding、NativeMutationRegistry、SourceDigestV1、SnapshotRef、CommitRecord、ProjectCoordinator、Lock、Job/Event/Lease、MigrationReport。目标是避免 M2.1 做临时接口、M2.2 再整体推翻。

### 连续实现顺序

1. M2.1：合同/黄金向量/架构测试 → Hypit wrapper → OpenFilm adapter → native gateway → source digest/time model。
2. M2.2：同一 Coordinator → immutable snapshot/commit record → journal/outbox → durable Job/Event/lease/cancel → visual/narration/duration locks。
3. M2.3：已知 fixture migrate-copy → loss report → 新旧真实重开/导出 → crash/rollback drill。

### 只在以下情况停下

双写、native 绕过、strict 409 被 rebase 破坏、commit 不确定、Job 仍只有内存、回退不能真实重开，或需要用户处理高风险外部状态。M3 materialize/adopt 仍关闭。

## 5. Wave 2：素材化到可编辑采用

开工前一次性冻结 ProposalBinding、MaterializationSpec、NativePlan、Lineage、Impact、Adoption 和 History。M3 产物必须天然支持 M4 采用，不能交付一个随后丢弃的临时 composite 模型。

连续实现：合法资产绑定 → 持久 materialize Job → 三路真实 proxy/native segments → NOWRITE → server impact → typed adoption → locks/幂等/并发 → history/undo/redo → journal 故障 → 重开双导出。

Wave 2 出门必须是一条完整真实链，而不是分别通过的模块单测。

## 6. Wave 3：同页 Studio 到 P0

连续实现项目/任务导入、章句镜映射、共享 selection/clock、StoryAtlas、三路候选、原生精剪、120 镜性能、可访问性、真实章节、后期、标题封面、preflight 与交付报告。

技术模块可连续推进；真实素材、headed 和人类体验在 Wave 3 末统一协调一次。缺真实内容或授权时标 `BLOCKED_INPUT`，不阻止此前的工程实现，但阻止 P0 Gate 声明。

## 7. Wave 4：P1 与完整 V1

连续实现 StyleProfile、真实 TTS/ASR/对齐、最小检索/生成 provider、预算/外传/receipt、反馈锚点和完整长片回归。Provider 接入前仍需要用户明确费用和外传授权。

M7D 的分母包含全部 P0/P1/NFR，不能因部分 provider 缺失而缩小 V1-Full 口径。

## 8. 每个波次的统一交付物

- 一个冻结组合 commit，而不是若干互不兼容的模块分支；
- 代码、合同、数据库迁移、测试、复现命令和旧回归；
- 逐 case evidence manifest、失败尝试、日志和 SHA256；
- 真实工程/媒体/重启/导出或明确的 `BLOCKED_INPUT`；
- 架构、路由、追踪和工作流登记同步；
- 一次内部四视角审查和一次独立外审；
- 回退演练和下一个波次开工包。

## 9. 全局硬停止条件

- 第二份可写 timeline、同项目双引擎写入或 adapter 自主 commit；
- stale base 被 native `rebased` 当作成功；
- commit/snapshot/Job 状态不确定却继续写入；
- materialize 修改 author source/revision；
- 三镜采用只剩 flattened MP4；
- 未授权费用、外传、凭据或私有素材风险；
- 真实 Gate 连续两轮未减少失败数量；
- 需要用户的内容、授权、人工体验或架构取舍。

