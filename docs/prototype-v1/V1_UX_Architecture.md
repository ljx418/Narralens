# V1 UX 与前端架构审查摘要

## 冻结项

- 一级流程：想法 → 精修 → 交付。
- 精修布局：左侧定位、中部真实预览、右侧导演面板、底部二维时间轴。
- 统一选区：`shotId + [startFrame,endFrame) + scriptAnchor`。
- 采用事务：staging → check → commit → revision → 真实 Run。
- 锁：画面 / 旁白 / 时长。
- 交付：预检 + 8 标题 + 4 封面 + 人工确认。
- 事实源：Hypit Author Source + Run；UI store 仅保存界面状态与草稿。

## 组件分层

| 层 | 组件 | 交付责任 |
|---|---|---|
| App | NarralensApp / StageRouter | 主题、路由、焦点、错误边界 |
| Stage | IdeaWorkspace / RefineWorkspace / DeliveryWorkspace | 三阶段业务外壳 |
| Coordination | SelectionCoordinator | 章节、语义、镜头、帧范围同步 |
| Editing | RealPreviewSurface / DirectorPane / TimelineSurface | 预览、比较、采用、帧级定位 |
| Delivery | PreflightChecklist / TitleCandidates / CoverDirections | 阻塞检查与人工确认 |
| Client | WorkbenchState / HostApiClient | 草稿、typed API、SSE、幂等 |
| Host | HypitPreviewBridge | 真实工程写入与 Run 刷新 |

## 完整状态

默认、加载、空、缺素材、版本冲突、锁冲突、需审批、Runner 不可用、写入失败、成功均必须具有可见说明与下一步动作。生成过程只显示真实阶段，不显示假百分比。

## 体验门限摘要

- 1440×900 无横向溢出；核心工作台在首屏建立清晰主次。
- 键盘、焦点、文本状态、减少动态、明暗/系统主题完整。
- 3–6 个提案只预演，“采用”才提交；提交前展示影响与保留对象。
- 生产准入依赖 D1 真实 30 秒工程闭环；实现出门依赖真实 3–5 分钟切片和失败路径证据。

完整内容见上级目录 `10_V1_Frontend_Optimization.md`。

