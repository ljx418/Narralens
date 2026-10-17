# M5–M7D 模块详细设计

## 1. M5：同一 OpenFilm Studio 的完整工作台

### 1.1 共享前端状态

`SelectionStore` 是当前 project/snapshot/clip/shot/range 的唯一 UI 选择源；`PlaybackClock` 把原生 seconds/timebase 与目标整数帧互转；`CommandGateway` 只提交 Host 支持的 typed intent；`EngineProjectionStore` 保存只读 projection 和 revision/digest。

StoryAtlas、Timeline、Player、Inspector 使用这些共享对象。任何组件不得保存一份可独立恢复影片的 clip 数组。视图切换保留选区和播放位置，不重载项目。

### 1.2 M5A 模块

- `IdeaWorkspace/CreativeTaskForm`：聊天文本、标准包、资料元数据导入；显示字段级错误，保留原始观点。
- `ProjectCreationService`：创建真实 OpenFilm 工程、EngineBinding、初始 snapshot；不得克隆固定三镜 fixture 冒充任意项目。
- `StoryProjectionService`：从实际 source 和内容 metadata 建章/句/镜 stable ID 映射。
- `ChapterNavigator`：章、句、镜、时间码四种入口定位同一 Selection。
- `SelectionCoordinator`：半开帧范围、逐帧、跨镜能力检查；不支持操作明确 422。

### 1.3 M5B 模块

- `StoryAtlasSurface`：X 为帧时间，Y 为轨道/章节，Z 只表达候选深度；平移不重排剪辑。
- `CandidateFocus`：最多三路可见真实 proxy；离屏/后台暂停；音频只有一个焦点；autoplay 失败有手动入口。
- `ContextDrawer`：显示镜头目的、灵感原话、事实来源、台词和后期待办，不占影片秒数。
- `DecisionBar`：预演、采用、跳过、下一问题；低风险一击采用仍先取得 server impact。
- `NativeEditBridge`：同页进入 Timeline/Inspector，不丢选择；native edit 反向刷新 projection。

六类候选（画面、解说、音乐、音效、台词、过场）独立建组和锁语义。只实现 capability 明确且已验收的类别；未实现项显示 blocked，不做无副作用假按钮。

### 1.4 M5C 性能/可访问性

固定 harness：900 秒、6+ 章、120 镜、3 路 720p proxy。选中/平移/缩放/切章各 100 次，记录 event→paint 原始样本和 p95≤100ms；冷/热重开分开；另记首帧、丢帧、内存峰值，不把 AI/渲染延迟混入 p95。

自动测试默认 Headless、静音、无窗口。headed 测键盘、焦点、原生 200%、reduced-motion 和真实媒体行为；人类零号用户验证一分钟定位/比较与十秒找到撤回，三者结果分列。

## 2. M6：P0 真实交付

### 2.1 M6.1 内容与后期

输入必须是真实 10–15 分钟母项目及其中 3–5 分钟、20+ 镜章节。至少三处执行 proposal→materialize→impact→adopt→精修→导出。`PostEditCapability` 只开放已在 OpenFilm 真实渲染验证的 crop/fit/text/subtitle/audio/transition/基础颜色与声音操作。

字幕、旁白、音量、静音、截断、章节边界、黑帧分别检查；章节默认无刻意动画。只有机器检测与人工内容签署均通过才完成。

### 2.2 M6.2 标题/封面/发布检查

`TitleWorkspace` 产出 8 个基于正文事实摘要的实际候选；`CoverWorkspace` 产出 4 个方向和可观看候选，保存来源、synthetic、license。`ConsistencyChecker` 标记标题/封面与正文冲突，但最终事实/审美由人确认。

`PreflightService` 为每项输出 `pass/warn/block/not_applicable` 和 issue anchor：缺媒体、字幕范围、响度/静音/截断、黑帧、许可、来源、synthetic、未决事实、输出规格。阻断项禁止发布版导出，允许生成明确标水印的诊断输出时必须独立定义。

### 2.3 M6.3 报告与 Gate

`EvidenceReporter` 生成中文 HTML，链接真实截图、MP4、ffprobe、帧样本、命令、日志、case 和 SHA256。M6 仅在 13 项 P0、6 项 NFR 的 M6 口径和适用回归全绿、独立外审、用户签署后声明 `Gate V1-P0 ACCEPTED`。

## 3. M7A：StyleProfile

`StyleProfile` 是版本化策略，不是自由文本提示。包含语气、字幕、画面、声音、颜色、镜头节奏、标题/封面偏好，以及继承/override 来源。应用全片前计算 impact；局部 override 与锁优先；回滚 profile 也是受控新 revision。保存 profile version 与每个结果的 applied version。

验收必须证明 profile 真正改变工程或生成配置、重开仍在、回滚可见、锁定镜头/声音不被批量覆盖。

## 4. M7B：声音、ASR、TTS 和对齐

`VoiceAsset` 保存本人录音或授权合成的来源、许可、provider/model、receipt、内容哈希。`TranscriptVersion`、`NarrationBlock` 和 `AlignmentMap` 均有版本和消费者图。

文字变化使关联 voice/subtitle/alignment 进入 stale；只改视觉不触发声音重算。真实 provider 调用先走 DataPolicy/CostApproval；试听和审核后才能进入 adoption。对齐误差按实际中文 fixture 和输出帧测量，不用 UI 波形截图代替。

## 5. M7C：素材 provider、预算和反馈

### 5.1 ProviderGateway

插件 manifest 声明 capability/version/upstream SHA、输入输出 schema、网络/文件权限、编辑性、费用、超时/取消/幂等。M7C 只接入产品需要的最少一个许可检索与一个生成能力；不建设通用插件市场。

外传记录 asset/text hash、provider/model、目的、保留策略和批准范围。产物先进入 staging，经媒体验证、rights/provenance、AssetRegistry 后才能绑定；provider callback 不能采用工程。

### 5.2 BudgetLedger

记录 currency、estimate、approved ceiling、reservation、spent、receipt、unknown。未知完成或费用时保留 reservation/attention，不按 0，不盲目重试。重试策略按 provider 幂等能力和最大次数冻结。

### 5.3 FeedbackService

评论绑定 project revision、shot ID、半开范围和文本。重剪后明确 migrated 或 orphan；反馈只能生成下一版 proposal，不自动改 StyleProfile 或 author source。

## 6. M7D：V1-Full

完整 10–15 分钟真实项目覆盖 P0/P1：观点/资料、项目创建、章节脚本、真实素材、三路候选、逐镜采用、声音字幕、风格、标题封面、QC、交付、反馈。要求重开、恢复、双导出、成本/人工步骤/失败记录、旧回归和独立审查。

完成声明的必要条件：P0/P1/NFR 逐项均有 case、真实证据和适用的人类签署；任何 `not-started/partial/BLOCKED_*` 都阻止 `V1-Full`。

## 7. 体验状态词统一

全 UI 只能使用以下受控状态：

- 提案：`proposal_only`；
- 待绑定：`bindings_required`；
- 准备代理：`materializing`；
- 可预览：`preview_ready`；
- 待影响/授权：`approval_required`；
- 已准备采用：`ready_for_adoption`；
- 已采用：`adopted`；
- 过期/失败/取消：`stale/failed/cancelled`；
- 工程需处理：`attention`。

“已登记”“可预览”“已采用”“可交付”不能互换。进度没有真实百分比时显示阶段和活动，不伪造百分比。

