# 叙镜 · AI 导演工作台

**Narralens — AI-Assisted Directing Studio**

**产品 / 架构 / 交互体验 / 开发 / 验收 / 计划完整开发基线**

版本：v1.0 · 2026-10-11

> 本文档用于本地 Codex 终端直接开展实现。当前架构以 OpenMontage 作为创作与素材上游、Hypit 作为真实编辑与渲染底座、Narralens 作为统一控制与交互层。D1 必须固定上游 commit SHA 并以真实环境验证为准。

---



\newpage

# 叙镜 PRD v1.0

## 1. 产品一句话
叙镜是一款以“观点与对话”为入口、以“逐镜头可控”为核心的 AI 导演工作台：它把资料研究、脚本、分镜、素材、声音、时间轴精修、封面标题和导出整合到一个本地工作流中。

## 2. 零号用户与首发场景
零号用户是单人创作者，已有 Cursor/Codex 和本地剪辑相关工具，希望尽可能复用开源项目、减少手写代码。首发内容为中文时政观点视频：通常 10–12 分钟，必要时 15 分钟；强调背景、因果、争议与结论讲清楚。

### 2.1 首条内容形态
- 平台优先：B 站；输出默认 16:9、1080p、30fps，可配置。
- 结构：片头钩子 → 背景/问题定义 → 来龙去脉 → 核心论证 → 反方/边界 → 结论。
- 章节：脚本中明确，画面不默认做明显章节切换动画。
- 小分镜：通常 5–10 秒；遇到原片、地图、数据图、关键引用可更长。
- 声音：旁白作为主时间轴；支持本人录音优先，后续接授权 TTS。
- 封面：AI 辅助生成，需与事实和视频主旨一致；不伪造现场。
- 标题：多候选，兼顾吸引力与事实准确，不允许“标题结论”与正文冲突。

## 3. 核心问题
现有“一键生成视频”工具往往不可控：一个镜头不满意会触发大范围重做，创作者无法知道改动影响、费用和来源。专业剪辑软件可控但前期研究、分镜和素材准备耗时。叙镜要把两者结合：AI 负责提案与劳动密集型环节，人负责观点、选择与最终导演判断。

## 4. 核心体验原则
1. **一页完成主要创作**：不在 OpenMontage、Hypit、终端之间来回切换。
2. **先提案，再生成**：先比较分镜设计，再为选中方案生成/获取素材。
3. **默认局部影响**：改镜头不改旁白；改局部不重做全片；共享对象变更先显示影响范围。
4. **锁定是真锁**：锁定必须作用于实际工程写入路径，而非只禁用按钮。
5. **所有 AI 产物可追溯**：来源、生成模型、许可、费用、时间、版本可查。
6. **事实与视觉分开审核**：资料可作为事实依据，不等于素材有再利用许可。
7. **失败可恢复**：任何生成、适配或渲染失败不得损坏已确认工程。

## 5. 目标用户流程
### 5.1 创建项目
用户粘贴与 ChatGPT/智能体的聊天结果，或导入标准任务包；可附 PDF/网页摘录、自有视频、录音。

系统先生成“创作任务摘要”：主题、核心观点、必须保留原话、待核验主张、目标时长、账号风格、资料清单。用户只纠正关键内容，不需要写 JSON。

### 5.2 研究与脚本
系统把主张分为：已证实、存在争议、作者判断、待核验。研究输出保留来源与时间。基于确认后的任务生成章节、大纲、逐字稿和每段视觉意图。

### 5.3 粗分镜与素材
OpenMontage 上游生成结构化分镜方案、素材需求与候选来源。系统先展示“怎么讲”的方案，不默认为每个候选生成昂贵素材。

### 5.4 精修
进入统一工作台：左侧/中央实际播放器，右侧导演面板，底部完整时间轴。选择镜头或时间段后，可：
- 替换画面/素材；
- 生成 3–6 个结构不同的分镜备选；
- 调整入出点、缩放、裁切、字幕、速度和关键帧；
- 锁定画面、旁白、时长；
- 查看修改前后差异、影响范围和费用；
- 应用、撤回或恢复历史版本。

### 5.5 标题与封面
成片内容稳定后，基于“事实摘要 + 核心观点 + 受众”生成标题候选和封面提示/候选。必须显示与正文不一致的风险提示；用户确认后保存为交付资产。

### 5.6 交付
导出 MP4、字幕、来源/许可清单、标题/封面、版本与生成记录。第一阶段手动发布；后续导入播放数据和评论，生成下一版工作流建议。

## 6. 工作台功能范围
### P0（必须）
- 项目创建与任务包导入。
- 章节/脚本/镜头列表。
- 真实播放器与统一时间码。
- 全片时间轴 + 局部精修模式。
- 镜头/区间选择、逐帧定位。
- 3–6 个分镜提案对比。
- 画面/旁白/时长分项锁。
- 本地素材导入、来源和许可状态。
- 局部改动差异确认。
- 版本、撤回、恢复、冲突提示。
- 真实工程重开与 MP4 导出。
- 标题与封面候选工作区。
- 基础发布前检查。

### P1（首月）
- 完整 10–15 分钟项目稳定运行。
- 账号风格模板与 StyleProfile 版本。
- TTS/ASR/字幕对齐适配。
- 素材检索与生成服务适配。
- 章节导航、评论与反馈锚点。
- 预算、失败重试、任务队列。

### P2（后续）
- 多账号批量生产。
- 自动化反馈学习与模板建议。
- 多人协作与权限。
- 自动发布（单独验收）。
- SaaS/多租户（需重新评估许可）。

## 7. 明确不做
- 第一周不做多租户、自动发布、复杂跨镜自由变形、完整专业 NLE 替代。
- 不把未经授权的 B 站/YouTube 素材下载视为默认能力。
- 不把 AI 重建画面当作新闻/历史证据。
- 不允许模型直接覆盖已锁定工程或扩大选区。
- 不让 UI 演示代替真实编译和真实 MP4 验收。

## 8. 非功能要求
- 本地优先：素材和凭据默认留在本机；需外传时逐任务记录。
- 可恢复：崩溃后可检测未完成事务并恢复到最后已提交修订。
- 可观察：长任务显示真实阶段、失败原因、费用状态；无真实百分比时不显示假进度。
- 可测试：关键接口有契约测试；编辑改动可通过帧数、哈希、ffprobe、帧采样验证。
- 性能：10–15 分钟、100+ 镜头项目仍能流畅导航；重型生成异步执行。
- 可访问：键盘逐帧、可见焦点、减少动态效果、状态不只靠颜色。

## 9. 成功指标
第一阶段成功不是“按钮很多”，而是：零号用户能从真实项目中找到任意镜头/语义位置，提出一个局部要求，比较方案，保留旁白，应用修改，撤回，再重开项目并导出真实 MP4；且已确认内容没有被无关重生成。

首月成功是：同一流程完成一条完整 10–15 分钟时政观点视频，包含标题、封面、字幕、来源记录和发布前检查。



\newpage

# 叙镜 UX / 交互体验规范 v1.0

## 1. 导航模型
主流程只保留三个阶段：**想法 → 精修 → 交付**。研究、脚本、素材、声音等属于阶段内部对象，而不是让用户走十几个步骤页。

### 顶栏
项目名 / 账号模板 / 当前修订 / 保存与任务状态 / 想法·精修·交付 / 更多。

## 2. 精修页布局
### 2.1 中央：实际影片
占主要视觉面积。显示真实 Hypit 编译预览，不做另一套假播放器。支持播放、暂停、时间码输入、逐帧、全屏、当前素材/生成状态。

### 2.2 右侧：导演面板
上下文驱动，而非固定表单堆叠。
- 无选区：显示当前章节、主旨和待处理问题。
- 选中镜头：显示解说、画面、来源、锁和常用参数。
- 选中时间段：显示“提出导演要求”与 3–6 个方案。
- 时间点模式：显示关键帧可写参数。
- 采用前：显示影响范围、保留对象、费用、缺素材、版本冲突。

### 2.3 底部：二维时间轴
横向时间，纵向轨道。至少：画面 / 字幕 / 解说 / 音乐。全片和局部两种缩放级别。

### 2.4 空间备选视图（三维概念）
按需展开，默认不常驻。
- X：时间。
- Y：媒体轨道。
- Z：同一范围的备选设计。
- 展开当前范围 3–6 个候选；相邻时间线保持可见。
- 点击候选只预演；“采用”才进入写入事务。
- 每个方案必须在结构上有差异，不只是色彩滤镜。

## 3. 示例：第 7 镜后半段
用户选中 01:04:12–01:10:00，输入：“改成三镜组接，保留原解说，不改变总时长。”

系统返回：
- A 观察式长镜头；
- B 远景→中景→特写三镜；
- C 资料全貌→局部标注→回现场；
- D 对照式画面；
- E 轻运动信息图；
- F 使用用户实拍的替换方案。

每张卡显示：镜头组成、预计时长、所需素材、是否需生成、来源/许可、预计成本、是否可直接渲染。

采用 B 前，面板显示：
- 替换范围；
- 旁白 N03 保留；
- 总帧数保持；
- 需要 2 个新素材；
- 费用/外传审批；
- baseRevision。

## 4. 长视频导航
10–15 分钟项目预计约 60–180 个小分镜，不能靠纵向镜头卡片浏览。
- 顶层：章节导航。
- 中层：镜头缩略轨。
- 底层：局部帧级编辑。
- 支持按语义查找：“讲到‘供应链外溢’那一句”。
- 搜索结果同时定位 ScriptBlock、NarrationBlock 和时间范围。

## 5. 章节体验
章节只用于结构与导航。默认不插入明显的章节转场动画。若需要章节卡，由用户或账号模板显式启用。章节边界可以用轻微音乐/节奏变化或自然素材切换表达。

## 6. 标题与封面工作区
在交付阶段显示，不与剪辑主界面争夺空间。
- 标题默认生成 8 个候选：信息型、观点型、问题型等；标记夸张/风险词。
- 封面默认生成 4 个设计方向；素材必须来自真实人物/事件许可图或明确标注的合成设计。
- 封面和标题共享“事实摘要”，避免与正文结论冲突。
- 用户可锁定标题、封面，不随重剪自动重写。

## 7. 动效规范
目标：精致但不喧宾夺主。
- 面板/切镜 180–240ms；空间展开 360–420ms。
- 候选悬停抬升 2–4px；采用成功使用短暂确认动画。
- 播放头绝不做视觉滞后缓动，位置严格跟帧。
- 生成过程不显示假百分比；显示真实阶段：排队/研究/生成/校验/写入/渲染。
- `prefers-reduced-motion` 下关闭空间旋转和装饰动画。

## 8. 键盘与效率
- ←/→：逐帧；Shift+←/→：1 秒。
- J/K/L：后退/暂停/前进（可配置）。
- I/O：设置选区入/出点。
- Cmd/Ctrl+Z：撤回当前未提交操作；已提交修订通过历史恢复创建新 revision。
- F：放大预览。
- /：聚焦语义/镜头搜索。

## 9. 错误和冲突
- 版本冲突：保留草稿，提示“项目已变化”，允许重新定位或重新生成提案。
- 锁冲突：明确指出锁的是画面/旁白/时长哪一项。
- 素材缺失：方案可保存为“待补素材”，但不能伪装为可导出完成状态。
- 渲染失败：保留源工程和上次成功输出；可重试指定阶段。
- 上游不可用：工作台仍可手工编辑，不被 AI 服务完全阻塞。



\newpage

# 叙镜架构设计 v1.0

## 1. 零层架构

```text
用户：聊天 / 观点 / 资料 / 实拍 / 录音
                  │
                  ▼
Narralens Unified Workbench
导演面板 + Hypit 编辑区域 + 时间轴 + 交付区
                  │
                  ▼
Narralens Local Host (TS/Node)
项目 / 任务 / 版本 / 锁 / 预算 / 权限 / 事件 / 事务
          │                         │
          │                         ▼
          │                 Hypit Adapter
          │                 Author Source + Run
          │                         │
          │                         ▼
          │                 Hypit compile/build
          │                         │
          ▼                         ▼
OpenMontage Adapter          预览 / MP4 / 字幕
受控 Agent Runner
pipeline + skills + tools
          │
          ▼
ProposalBundle / Evidence / AssetManifest
          │
          └──> 暂存区 → 审批/校验 → Source Adapter → 唯一主工程
```

**唯一剪辑事实源：Hypit Author Source + Run。** Narralens DB 不是第二条时间轴；OpenMontage 不直接写主工程。

## 2. 为什么这样集成
OpenMontage 的公开架构是 agent-first：编码智能体读取 YAML pipeline、Markdown skills，调用 Python tools，并通过 checkpoint 推进；它不是一个现成的单一 HTTP 视频生成 API。Backlot 是只读制作看板。因此我们复用它的制作方法、工具和产物，不把 Backlot 当编辑器。

Hypit 已有 Studio、时间模型、工程和本地渲染链路。Narralens 应在固定版本 Studio 应用层做薄改造，复用真实播放器/时间模型/工程写入，而不是重新发明渲染器。

## 3. 组件职责
| 组件 | 负责 | 禁止 |
|---|---|---|
| Narralens UI | 单页创作、选区、方案、精修、标题封面、交付 | 维护独立最终时间轴 |
| Local Host | 项目状态、任务、锁、版本、审批、预算、事务、SSE | 隐藏创作决策 |
| OpenMontage Adapter | 调用固定 pipeline/skills/tools，归一化提案和素材 | 直接覆盖主工程 |
| Agent Runner | 受控目录和白名单网络下运行 OpenMontage | 任意 shell/任意路径 |
| Hypit Adapter | Author Source 定位、typed patch、Run 产物选择、build | 正则猜写源码 |
| Hypit Runtime | 真实编译、预览、媒体装配、编码 | 自动理解用户聊天 |
| SQLite/Event Log | 任务、事件、修订、审批、映射 | 保存第二份影片结构 |

## 4. 技术栈基线
- UI：沿用固定 Hypit Studio 的 TypeScript/Vite 技术栈；新增 `DirectorPane`、`SpatialAlternatives`、`DeliveryPanel`。
- Host：Node.js + TypeScript；loopback 同源 API；每项目串行写 actor。
- Persistence：SQLite + append-only event log + project journal。
- OpenMontage：独立 Python venv，固定 commit SHA，受控 Agent Runner。
- Hypit：固定 commit/version；Source/Run adapter；实际 CLI/API 以 D1 探测结果为准。
- Testing：Vitest/现有 TS 测试 + Playwright + pytest（adapter）+ ffprobe + 帧采样。
- Media store：内容哈希目录；媒体不嵌入 JSON。

## 5. 文件布局
```text
narralens/
  vendor/hypit/                 # 固定 SHA 的薄 fork
  vendor/openmontage/           # 固定 SHA，独立 venv
  app/director/                 # 导演面板、空间备选、标题封面
  host/                         # API、actor、事务、事件、SQLite
  adapters/openmontage/         # pipeline 交接、产物归一化
  adapters/hypit/               # author identity、patch、run/build
  contracts/                    # JSON Schema + examples
  projects/<project-id>/
    film/
    media/<sha256>/
    proposals/
    runs/
    .narralens/
```

## 6. 核心数据模型
### CreativeTask
主题、核心观点、目标时长、平台、章节策略、必须保留原话、待核验主张、资料引用、视觉偏好、输出规格。

### NarrationBlock
稳定 `block_id`、文本、语义锚点、音频资源、对齐结果。

### ShotRef
稳定 `shot_id`、章节、帧范围、素材引用、对应 NarrationBlock、分项锁、style override。

### ProposalBundle
`proposal_id/base_revision/selection/preserve/segments/assets/cost/source_refs/renderable`。它是意图，不是 Hypit 工程语法。

### AssetRef
`asset_id/sha256/mime/duration/origin/rights_status/license_evidence/synthetic/local_resource`。

### Revision
单调递增。恢复旧内容也创建新 revision，不回退数字。

## 7. API 基线（Narralens 自定义，不伪称上游原生）
- `POST /api/projects/:id/proposals`：选区 + 意图 + baseRevision → jobId。
- `GET /api/jobs/:id` / SSE events：真实阶段、费用和结果。
- `POST /api/proposals/:id/materialize`：批准的素材生成/获取。
- `POST /api/projects/:id/edits`：typed operations + baseRevision → newRevision。
- `POST /api/projects/:id/renders`：revision + profile → jobId。
- `POST /api/jobs/:id/cancel`：尽力取消，已产生外部费用如实记录。
- `POST /api/projects/:id/feedback`：revision + shotId + range + text。

错误码：409 `REVISION_CONFLICT`；423 `TARGET_LOCKED`；422 `UNSUPPORTED_EDIT/MISSING_ASSET/AMBIGUOUS_TIME`；428 `APPROVAL_REQUIRED`；503 `RUNNER_UNAVAILABLE`。

## 8. 编辑事务
采用方案必须走统一事务：
1. 校验 baseRevision、锁、选区、共享消费者、资产许可、预算。
2. 复制到 staging，生成 typed patch。
3. 执行 Hypit check/compile（真实命令以 D1 为准）。
4. 验证帧范围、音频引用、不变区域。
5. 安装文件并提交 metadata revision。
6. 任一步失败都回滚，提案保留。

journal 状态：`prepare → staging_validated → files_installed → metadata_committed`。启动时先恢复未完成 journal。

## 9. 产物复用
锁定镜头必须显式引用已完成资产、旁白和对齐结果。只改视觉时，不重跑 TTS；只改标题时，不重渲染影片。缓存命中必须基于内容哈希、配置、模型/工具版本，不依赖“看起来没变”。

## 10. 政治/新闻类内容事实与素材边界
- Claim 与 VisualAsset 分离。
- 事实证据保存来源、发布日期/访问时间、引文上下文。
- 视频素材另存许可和使用依据；能引用报道不代表能剪其视频。
- AI 合成画面标记 `synthetic=true`；不得让合成现场冒充真实现场。
- 标题/封面必须经过正文一致性检查。

## 11. 安全
- Host 仅 loopback + Origin/token 校验。
- Agent Runner 最小目录、命令和网络域名白名单。
- 资料内容永远当数据，不当系统指令。
- 凭据不进网页、不进项目 JSON、不进日志。
- 禁止任意文件路径写入；媒体用 asset_id 映射。

## 12. 许可基线
- OpenMontage：AGPL-3.0。当前按本地自用开发；未来网络服务/分发需再次审查义务。
- Hypit：其公开 LICENSE 是附加条件的 Hypit Open Source License（基于 Apache 2.0 条款并增加多租户、商业再分发、标识等约束）。当前本地单组织自用符合其明确允许路径；未来 SaaS/对外产品需商业许可/法律审查。



\newpage

# 叙镜开发计划 v1.0

## 0. 开工原则
先证明真实链路，再优化视觉。任何“看起来可编辑”的页面，如果没有写入真实工程、重开后仍存在、并能导出真实 MP4，都不算完成。

## Phase 0 — D0/D1：基线与技术探测
### 任务
- 建立 `narralens` 仓库，导入本包文档。
- 克隆并固定 OpenMontage 与 Hypit 的 commit SHA；记录 license。
- 探测 Hypit Studio 实际启动、工程格式、check/plan/build、预览与写入入口。
- 用中文旁白 + 现有素材制作 30 秒真实项目，导出、关闭、重开、修改一个镜头、再次导出。
- 记录机器环境、字体、ffmpeg/浏览器/Node/Python 版本。
### Gate
若 30 秒声画链路不通，停止做业务 UI，先解决底座。

## Phase 1 — D2：统一宿主与提案链
- 在 Hypit Studio 应用层加入 `DirectorPane` 与项目头部。
- Host 提供 projects/jobs/events 最小 API。
- OpenMontage Adapter 能在同页触发真实 Agent Runner，返回一个结构化 ProposalBundle。
- 手工复制 JSON 不算通过。

## Phase 2 — D3：真实选区写入
- 建立 stable shot/source identity 映射。
- 实现同镜范围 typed edit、baseRevision、视觉/旁白/时长锁。
- staging → check → commit → revision。
- 过期提案、锁冲突、缺素材有稳定错误。

## Phase 3 — D4：多分镜提案与素材审批
- 同一选区至少 3 个结构不同的真实提案。
- 比较阶段不生成全部付费视频。
- 采用一个方案，若缺素材则进入 materialize；记录外传与费用。
- 一个方案真正落入 Hypit 工程并刷新真实预览。

## Phase 4 — D5：声音、字幕、复用与恢复
- 视觉改动不重跑已锁旁白。
- 字幕与语音对齐保持。
- 历史恢复创建新 revision。
- 崩溃/取消/晚到任务/外部文件修改处理。

## Phase 5 — D6/D7：真实章节切片验收
- 使用一条真实 10–15 分钟时政项目作为母项目。
- 全片完成章节、脚本、粗分镜进入工作台。
- 选择其中 3–5 分钟章节，完成真实素材、字幕、声音和逐镜精修。
- 零号用户亲自：找到指定句子 → 选区 → 比较方案 → 保留旁白采用 → 锁定 → 恢复 → 重开 → 再导出。
- 记录耗时、费用、失败、人工步骤。

## 第 2 周
- 优化全片 60–180 镜头导航。
- 完成空间备选视图生产化。
- 跨镜选区和更丰富关键帧（仅在真实写入模型支持时）。
- 三个不同选题回归。
- 标题/封面候选工作区接入真实生成。

## 第 3–4 周
- 完成一条完整 10–15 分钟视频端到端。
- StyleProfile / 账号模板。
- 模型/provider 配置、预算与队列。
- 素材检索/生成适配器。
- 发布前检查、标题/封面、人工发布。
- 导入反馈并生成改进提案；不自动直接改生产模板。

## 里程碑
M0：真实 30 秒工程链路。
M1：同页 OpenMontage 提案链。
M2：真实局部写入 + 锁 + revision。
M3：3–5 分钟章节切片可精修和重导出。
M4：完整 10–15 分钟视频闭环。
M5：多账号模板与稳定批量。

## 工程纪律
- 每个提交只有一个可观察能力 + 测试 + 复现步骤。
- 新增接口必须写契约和错误码。
- 不凭猜测写上游内部接口；D1 探测后更新适配层。
- 不用正则改 Author Source，不用数组下标猜 identity。
- 不重复开发渲染器。
- 未验证能力文档标注 `planned/blocked`，不能写 `ready`。



\newpage

# 叙镜验收计划 v1.0

## A. D1 底座验收
- [ ] 固定 OpenMontage/Hypit commit SHA 和依赖版本。
- [ ] 30 秒中文声画项目可预览、导出 MP4。
- [ ] 关闭重开后工程完整。
- [ ] 修改一个镜头后再次导出，旁白/字幕正确。
- [ ] 记录真实命令、日志位置和产物路径。

## B. 提案链验收
- [ ] 页面发起导演要求，真实 Agent Runner 返回 ProposalBundle。
- [ ] 每个 proposal 绑定 baseRevision 和选区。
- [ ] 候选显示结构、资产缺口、来源、费用状态。
- [ ] 浏览候选不自动触发所有昂贵生成。
- [ ] OpenMontage 输出不能直接写主工程。

## C. 编辑事务验收
用选区 `[start,end)`：
- [ ] 采用方案后总帧数符合差异说明。
- [ ] 非目标相邻镜头逐字段不变。
- [ ] `preserve=narration` 时原旁白资产哈希不变。
- [ ] 视觉锁同时阻止 UI 和 Agent 路径。
- [ ] 过期 proposal 返回 409，不覆盖新版。
- [ ] 写入失败后主 Source 哈希恢复。
- [ ] 历史恢复产生新 revision。

## D. 3–5 分钟章节切片验收（首周）
- [ ] 来自真实 10–15 分钟母项目。
- [ ] 至少 20+ 镜头进入真实工程。
- [ ] 用户能按章节、镜头、语义和时间码定位。
- [ ] 至少 3 个位置完成“多方案→采用→导出”。
- [ ] 中文字幕无明显超框/错位。
- [ ] 音量、静音、截断、黑帧检查通过。
- [ ] 导出后随机抽样帧与预览一致。
- [ ] 重开项目后所有媒体可重新关联。

## E. 完整 10–15 分钟验收（首月）
- [ ] 章节结构完整、过渡自然，无默认刻意章节动画。
- [ ] 小分镜通常 5–10 秒，但允许必要长镜头。
- [ ] 关键事实有来源；争议和作者判断不伪装为事实。
- [ ] AI 合成画面有可追溯标记。
- [ ] 生成 8 个标题候选和至少 4 个封面方向；最终项经人工确认。
- [ ] MP4、字幕、来源/许可清单、标题/封面一起交付。
- [ ] 单次失败不会导致整项目重做或丢失确认结果。

## F. 性能与稳定性
- [ ] 100+ 镜头项目时间轴可交互，不因生成任务阻塞 UI。
- [ ] SSE 断线重连不重复应用旧事件。
- [ ] 任务取消如实显示“已请求取消/已产生费用”。
- [ ] 无 API key/凭据泄漏到前端、项目 JSON、日志。
- [ ] 目录穿越和未登记路径写入被拒绝。

## G. “不弱于 OpenMontage / Hypit”对照验收
不做空泛功能表比较。使用同一脚本、同一素材、相近预算，对比：
1. 成片叙事、画面相关性、字幕、声音、节奏。
2. 指定区间改动的操作步骤和可控性。
3. 保留旁白/已确认素材的能力。
4. 恢复旧版本、重开、再导出。
5. 总耗时、人工步骤、生成费用与失败次数。

只有真实成片与修改压力测试通过，才声明在零号用户核心场景“不弱”。



\newpage

# 叙镜 Codex 开发交接 v1.0

## 你的角色
你在本地仓库实现 Narralens。先做真实视频工程，再做体验包装。不要把已有 HTML 原型当生产系统。

## 开工第一条命令前先做
1. 阅读 `00_README.md` 到 `05_Acceptance_Plan.md`。
2. 扫描当前本地已有 UI/剪辑代码，不删除用户已有成果。
3. 克隆或定位 OpenMontage 与 Hypit；记录 commit SHA、license、依赖、实际 CLI 帮助。
4. 新建 `docs/implementation/D1-environment-audit.md`，写明真实环境与可执行命令。
5. 在任何 Narralens 业务功能前，完成 30 秒中文视频“预览→导出→重开→局部改→再次导出”。

## 不可变架构边界
- 一个统一工作台，不拼两个 iframe。
- Hypit Author Source + Run 是唯一最终剪辑事实源。
- OpenMontage 只通过 Adapter/暂存区输出提案与素材，不直接写主 Source。
- Narralens DB 只存任务、版本、锁、审批、映射、预算和事件，不存第二条最终时间轴。
- 所有人工/Agent 写入走同一个 edit transaction。
- 未验证的上游内部接口不可凭猜测编码。

## 首周开发顺序
D1 底座探测 → D2 DirectorPane + Proposal API → D3 real source edit/revision/locks → D4 alternatives/materialize → D5 reuse/recovery → D6-D7 真实 3–5 分钟章节精修。

## 推荐初始目录
```text
app/director/
host/
adapters/openmontage/
adapters/hypit/
contracts/
tests/e2e/
docs/implementation/
```

## 第一批契约
先实现并测试：
- `contracts/creative-task.schema.json`
- `contracts/proposal-bundle.schema.json`
- `contracts/asset-ref.schema.json`
- `contracts/edit-operation.schema.json`
- `contracts/event-envelope.schema.json`

## 第一批 API
- POST `/api/projects/:id/proposals`
- GET `/api/jobs/:id`
- GET `/api/projects/:id/events`
- POST `/api/projects/:id/edits`
- POST `/api/projects/:id/renders`

先返回真实但最小的数据，不要为了“接口齐全”造假后台。

## 提交门槛
每次提交必须带：
- 变更说明；
- 自动化测试；
- 手工复现命令；
- 真实产物/日志位置；
- 已知限制；
- 如果接触上游，记录 commit SHA。

## 禁止
- 不允许用静态 HTML 演示声称“视频系统完成”。
- 不允许写不存在的 `openmontage generate --hypit` 等命令。
- 不允许正则替换或数组索引猜 Hypit author identity。
- 不允许因一个镜头变化无故重跑全部付费生成。
- 不允许把研究来源自动当作可复用视频素材许可。
- 不允许删除上游要求保留的版权/标识。

## D1 完成后必须向用户报告
1. 两仓库 SHA 和许可证摘要。
2. 实际运行命令与本机环境。
3. 30 秒真实 MP4 路径。
4. Studio UI 可改造入口。
5. Author Source/Run 写入与编译边界。
6. OpenMontage 最小可调用 pipeline 与产物位置。
7. 哪些 v1 设计必须因上游事实调整。

只有 D1 Gate 通过，才进入 D2。



\newpage

# 叙镜：决策与待确认项

## 已锁定
- 名称：**叙镜 · AI 导演工作台** / **Narralens — AI-Assisted Directing Studio**。
- 首发：时政观点型中文长视频。
- 时长：通常 10–12 分钟，必要时 15 分钟。
- 目标：把问题说透、把来龙去脉讲清。
- 小分镜：通常 5–10 秒，软约束。
- 章节：文案明确、画面自然，不默认刻意过渡。
- 封面：AI 辅助，但需契合实际。
- 标题：AI 多候选，吸引力与准确性并重。
- 体验优先级：第一阶段逐镜可控和精修质量；后续稳定出片、批量和风格控制。
- 集成：OpenMontage 创作/素材上游 + Hypit 编辑/渲染底座 + Narralens 统一控制层。

## 开发基线中的默认值（可配置，不阻塞开工）
- B 站优先，16:9，1920×1080，30fps。
- 第一周验收：真实 10–15 分钟母项目中的 3–5 分钟章节切片；全片脚本/章节/粗分镜已进入工作台。
- 第一个月：完整 10–15 分钟闭环。
- 标题默认 8 个候选；封面默认 4 个方向。
- 第一阶段手动发布。

## 开发前仍需通过 D1 事实验证的问题
这些不要靠讨论猜：
1. Hypit 固定版本的真实 Studio 扩展点、Author Source 写入边界、Run/Build 命令。
2. OpenMontage 固定版本最适合首发时政长视频的 pipeline、产物 schema 与 Agent Runner 启动方式。
3. 本机 GPU/CPU/内存、字体、浏览器、FFmpeg 和模型凭据对真实 10–15 分钟项目的性能。
4. 两仓库实际许可证文本与保留标识要求。

## 后续可在对话中继续确认，但不阻塞 D1
- 第一版旁白：本人录音还是授权 TTS 为默认。
- 允许进入成片的素材来源白名单。
- 单条视频模型/API 预算上限。
- 3 个参考视频及“具体喜欢的点”。
- 标题/封面更偏克制、媒体感还是强点击风格。



\newpage

# 上游来源与核对记录
核对日期：2026-10-11。开发时必须再次固定 commit SHA；下面 URL 只用于说明当前架构与许可依据。

## OpenMontage
- Repository: https://github.com/calesthio/OpenMontage
- Architecture: https://github.com/calesthio/OpenMontage/blob/main/docs/ARCHITECTURE.md
- Project context: https://github.com/calesthio/OpenMontage/blob/main/PROJECT_CONTEXT.md
- Backlot: https://github.com/calesthio/OpenMontage/blob/main/backlot/README.md
- License: repository declares GNU AGPLv3.

已核对事实：OpenMontage 是 agent-orchestrated / agent-first；智能体读取 pipeline manifest 与 skills、调用 Python tools、写 checkpoint。Backlot 是读取项目产物与事件的只读 living storyboard，不应当作本项目可写剪辑器。

## Hypit
- Repository: https://github.com/hypit-ai/hypit
- README: https://github.com/hypit-ai/hypit/blob/main/README.md
- License: https://github.com/hypit-ai/hypit/blob/main/LICENSE

已核对事实：Hypit 提供 Studio/工程/渲染相关能力；许可不是无附加条件的标准 Apache 2.0。当前许可文本明确允许组织内部/自用（包括自己的商业工作），但对多租户托管和商业再分发等场景增加约束，并包含标识/版权要求。未来 SaaS 或对外产品必须重新审查。
