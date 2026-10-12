# 叙镜 V1 阶段性前端优化规格

状态：**V1 目标原型已获批准；当前仅做原型与文档细化，未进入生产代码开发。**  
基线日期：2026-10-12  
审查入口：`prototype-v1/index.html`

## 1. 本阶段结论

V1 前端不再扩展新的一级步骤，固定为 **想法 → 精修 → 交付**。精修工作台是核心：真实影片预览居中，章节/语义定位在左，导演提案在右，二维时间轴在底部；空间备选只按需展开。前端不得维护第二份最终时间轴，所有已提交影片结构必须来自 Hypit Author Source + Run。

本阶段要解决的是“人如何判断、比较、采用和恢复”，不是证明 OpenMontage/Hypit 已接通。生产实现必须先通过 D1 的 30 秒真实工程门限。

## 2. 目标体验

### 2.1 想法

- 输入创作任务、受众、平台和时长；显示研究主张、争议、作者判断与待核查项。
- 主张必须以文字标签表达状态，不只依赖颜色。
- 用户确认后形成章节、脚本、旁白和粗分镜输入；此阶段不伪装为已经生成成片。

### 2.2 精修

- 章节、镜头、语义搜索和时间码共享同一个 `SelectionContext`。
- 选中时间段后提出导演要求，得到 3–6 个结构不同的 Proposal；默认不批量生成昂贵素材。
- 采用前必须显示替换范围、保留对象、缺失素材、费用/外传状态和 `baseRevision`。
- 采用是可确认事务：staging → check → commit → revision → 刷新真实 Run。版本冲突、锁冲突、缺素材、写入失败不得伪装成功。
- 锁粒度固定为画面、旁白、时长；已提交修订的恢复产生新 revision。

### 2.3 交付

- 先执行预检，再选择标题与封面，最后导出。
- 默认 8 个标题候选、4 个封面方向；都共享正文事实摘要并由用户确认。
- 交付包包含 MP4、字幕、来源/许可清单、标题和封面；任一阻塞项未通过时导出按钮必须说明原因。

## 3. 前端目标架构

```text
NarralensApp
├─ StageRouter（想法 / 精修 / 交付）
├─ IdeaWorkspace
├─ RefineWorkspace
│  ├─ ChapterNavigator + SemanticSearch
│  ├─ RealPreviewSurface
│  ├─ SelectionCoordinator
│  ├─ DirectorPane + ProposalCompare
│  └─ TimelineSurface（60–180 镜头虚拟化）
├─ DeliveryWorkspace
│  ├─ PreflightChecklist
│  ├─ TitleCandidates（8）
│  └─ CoverDirections（4）
├─ WorkbenchState（仅 UI 草稿、选区、乐观状态）
└─ HostApiClient（typed API / SSE / idempotency）
   └─ HypitPreviewBridge（唯一影片事实源）
```

职责边界：

| 实体 | 责任 | 不允许承担 | 当前状态 |
|---|---|---|---|
| `StageRouter` | 三阶段路由、离开前未保存提示 | 业务任务编排 | V1 目标，未开发 |
| `SelectionCoordinator` | 统一 `shotId`、`[startFrame,endFrame)`、脚本锚点 | 复制最终时间轴 | V1 目标，未开发 |
| `DirectorPane` | 意图输入、提案比较、影响预览、采用确认 | 直接改写工程文件 | V1 核心，未开发 |
| `TimelineSurface` | 帧级定位、多轨显示、局部缩放 | 自建渲染器 | 待 D1 对接 |
| `WorkbenchState` | 草稿、焦点、布局、乐观状态 | 保存最终影片结构 | V1 目标，未开发 |
| `HostApiClient` | typed command、错误映射、SSE 归并 | 暴露凭据或任意文件写入 | 待 D1 |
| `HypitPreviewBridge` | Author Source + Run 的真实预览/刷新 | 接受前端猜测的内部接口 | D1 事实验证 |

详细图见 `prototype-v1/frontend-architecture.html`。

## 4. 路由与组件契约

| 路由 | 页面组件 | 关键输入 | 必备输出/状态 |
|---|---|---|---|
| `/projects/:id/idea` | `IdeaWorkspace` | `CreativeTask`、研究主张 | draft / researching / needs-review / confirmed / failed |
| `/projects/:id/refine` | `RefineWorkspace` | `ProjectRevision`、selection、Run | idle / proposing / comparing / materializing / committing / conflict / failed |
| `/projects/:id/delivery` | `DeliveryWorkspace` | 当前 revision、预检结果 | blocked / ready / exporting / exported / failed |

建议组件基础：Dialog、Tabs、Tooltip、ToggleGroup 等采用 Radix Primitives 的无障碍交互模式；复杂集合与拖放交互参考 React Aria；长时间轴虚拟化使用 TanStack Virtual。当前只冻结行为与边界，不在原型阶段安装依赖。

## 5. 状态矩阵

| 场景 | 页面必须显示 | 可继续动作 | 禁止行为 |
|---|---|---|---|
| 默认 | 当前 revision、保存状态、选区 | 搜索、播放、提出要求 | 隐藏事实源状态 |
| 加载/生成 | 真实阶段：排队/研究/生成/校验/写入/渲染 | 取消请求、查看任务 | 假百分比 |
| 空状态 | 为什么为空、如何开始 | 导入/创建/返回想法 | 空白面板 |
| 素材缺失（422） | 缺什么、影响哪个方案 | 保存待补、替换素材 | 标成可导出 |
| 版本冲突（409） | base/current revision、草稿保留 | 重新定位/重新生成 | 覆盖新版 |
| 锁冲突（423） | 画面/旁白/时长具体锁项 | 解锁或保留 | 泛化“操作失败” |
| 需审批（428） | 外传对象、费用、提供方 | 批准/拒绝 | 自动付费或外传 |
| Runner 不可用（503） | 服务不可用、草稿未丢 | 手工编辑/重试 | 阻塞整个工作台 |
| 写入失败 | 主 Source 未变、上次成功输出 | 重试指定阶段 | 展示成功 toast |
| 成功 | 新 revision 与真实 Run 已刷新 | 继续精修/查看历史 | 仅更新本地 UI |

## 6. 用户体验路径

### P1：定位并比较

`/` 聚焦语义搜索 → 输入一句正文 → 同时定位 ScriptBlock、NarrationBlock 与时间范围 → 设置 I/O → 输入导演要求 → 比较 3–6 个结构方案。

### P2：保留旁白采用

选择方案 → 锁定旁白与总时长 → 查看素材/费用/版本影响 → 确认采用 → Host 事务提交 → 新 revision → 真实 Run 刷新。

### P3：冲突恢复

提交遇到 409/423/422/428/503 → 保留用户草稿 → 显示具体对象与恢复动作 → 重新定位、解锁、补素材、审批或切换手工编辑 → 再次提交。

### P4：交付

进入交付 → 运行黑帧/字幕/音量/来源预检 → 从 8 标题、4 封面中人工确认 → 导出交付包 → 关闭重开并复核媒体关联。

## 7. 验收门限

### Gate P — 原型出门（当前阶段）

- 三阶段、组件职责、完整状态、4 条用户路径与 PRD 一致，未增加自动发布等越界承诺。
- 1440×900 桌面视口无横向溢出；精修页首屏可见预览、导演面板和时间轴入口。
- 明/暗/跟随系统主题；可见焦点；状态不只靠颜色；支持 `prefers-reduced-motion`。
- 原型中的模拟动作均明确标记，不得声称真实工程、AI、导出已接通。
- 项目负责人批准后，才允许进入开发文档冻结；这不等于允许直接写生产代码。

### Gate D1 — 生产开发准入

- 固定 OpenMontage/Hypit commit SHA、license 和真实扩展点。
- 30 秒中文项目真实预览、导出 MP4、关闭重开、修改一镜、再次导出全部通过。
- 真实命令、工程格式、帧/时间模型、日志和产物路径已记录；接口契约据此更新。
- 任一项失败：停止业务 UI 实现，回到底座验证。

### Gate V1 — 实现出门

- 真实 10–15 分钟母项目的 3–5 分钟章节切片进入工作台，至少 20 个镜头。
- 至少 3 个位置完成“定位 → 多方案 → 保留对象采用 → 真实预览 → 导出”。
- 409/422/423/428/503 与写入失败均有自动化证据；主 Source 在失败时保持不变。
- 120 镜头验收夹具下，选择反馈 p95 ≤100ms，滚动/生成任务不阻塞输入；记录测试机器和 trace。
- 键盘路径、可见焦点、文本缩放 200%、对比度和减少动态通过自动化加人工审查。
- 导出后抽样帧与预览一致；重开后媒体重新关联；MP4、字幕、来源/许可清单齐全。
- PRD、架构图、实现和测试证据一致，任何重大偏差或模拟证据均拒绝出门。

验收流程图见 `prototype-v1/acceptance-gates.html`。

## 8. 仍未关闭的风险

1. 当前仓库没有生产源码，所有组件实体均是目标设计，不能评估真实集成复杂度。
2. Hypit 的 Source/Run 写入边界、时间模型与扩展点未通过 D1；前端契约只能冻结到语义层。
3. OpenMontage ProposalBundle 的真实 schema 和 Runner 启动方式未验证。
4. 性能门限需要在 D1 记录参考机器；当前数值是 V1 出门目标，不是已通过结果。
5. 真实素材许可、费用和外传策略仍需项目配置；原型只表达审批点。

## 9. 外部组件依据

- Radix Primitives：可组合、无样式、处理 ARIA、焦点管理和键盘导航的低层组件。<https://www.radix-ui.com/primitives/docs/overview/introduction>
- React Aria：无障碍交互行为与复杂集合/拖放模式参考。<https://react-spectrum.adobe.com/react-aria/getting-started.html>
- TanStack Virtual：用于长列表/大集合虚拟化的无头工具。<https://tanstack.com/virtual/latest/docs/introduction>

