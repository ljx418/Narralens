# Narralens 从 M4C 到最近人工体验门的剩余路线

状态：`ACTIVE_PLAN`

基线：M4B 与 M4C 已分别通过独立外审；Wave 2 组合候选已完成当前 tip 的 84 files / 1040 tests 全量复验，
组合独立外审 PASS，达到 `WAVE2_EDITABLE_ADOPTION_READY`。M5/M6 尚未完成。

## 1. 大步交付顺序

| 波段 | 开发目标 | 自动出门门 | 是否停人工 |
|---|---|---|---|
| W2-Close | M4B 外审 + M4C restore + Wave2 组合冻结 | TX/MT/PR 全表、真实三镜、重启、恢复、全量回归、独立外审 | 否；普通问题自动修 |
| W3-UX | M5A/B/C 同页 Studio | UX-01..12、Headless E2E、键盘/焦点/200%、3–5 分钟 20+ 镜性能 | **是：最近人工体验门** |
| W3-P0 | M6.1/2/3 真实后期、标题封面、snapshot-bound render、preflight、证据报告 | DL-01..06、13 P0、6 NFR、独立外审 | **是：Gate V1-P0 签署** |
| W4-Full | M7A–D provider/预算/长片/P1 | P0/P1 全量真实证据、成本与外传审批、10–15 分钟长片 | **是：V1-Full 签署** |

## 2. 最近人工体验门前仍需完成

1. M5A：打开/迁移已有事实项目、WorkbenchProjection、受控 Studio Gateway、章/句/镜与 OpenFilm
   timeline/player 的共享 selection/clock/snapshot；空白项目创建延期到 M6/M7；
2. M5B：3–6 提案比较、试听、impact 预览、采用/恢复、Inspector/History 状态在同页闭环；
3. M5C：20+ 镜、3–5 分钟真实 fixture 的虚拟化/响应性、键盘、焦点、reduced motion、200% 文本与 Headless E2E；
4. 生成中文可视化验收报告后，才进入第一次正式人工体验。

Wave 2 完成不等于“可人工验收完整产品”；它关闭的是后端受控写与恢复闭环。最近人工体验门位于 M5C 后，剩余工作
是一段完整前端阶段（M5A/B/C）及其 Headless 验收报告。不以百分比吞掉任何 `NOT_RUN`。

## 3. M5 人工体验出门场景

人工最小路径固定为：打开已迁移项目 → 从章节/镜头地图定位镜头 → 播放器/时间轴/Inspector 同步 selection → 查看
3–6 提案 → 试听并查看 impact → 采用一项 → 关闭重开 → 编辑中镜 → 恢复旧内容 → 验证 revision/history → 键盘完成
核心路径。任何 mock 媒体、第二 timeline、假截图、不可重开的内存态均不允许签署。

自动化与人工严格分层：Headless 静音测试先全绿；headed 只在用户明确参与时启动；人工判断交互、可懂性、审美与真实
内容，不代替事务/恢复/媒体证据。

## 4. M6/V1-P0 后续验收

M6 才开放 snapshot-bound production render、3–5 分钟真实交付、标题 8 候选、封面 4 候选、preflight 与发布包。
所有 provider/外传/费用逐任务授权；缺真实内容或用户签署记录为 `BLOCKED_INPUT`。M6 最高只允许 Gate V1-P0，M7A–D
及 P1 全部证据通过后才允许 V1-Full。

## 5. 团队执行与停点

- Claude Code：按冻结 gate 连续实现、局部回归、真实证据、内部四视角审查；实现会话不自签外审；
- Codex：冻结合同、独立复核组合候选、处理超过两轮返工的根因、维护主追踪；
- 项目负责人：只处理架构/数据/费用/外传等高风险裁决与 M5/M6/M7 人工体验签署；
- 普通红灯、可复现竞态、文档同步、测试不稳定由当前 Agent 自动修复，不在模块间反复停工；
- 自动 UI 永远 Headless、静音、隔离、无窗口、不抢焦点；人工体验需用户明确参与。
