# Narralens 前端原型审查包 v0

本文件夹是一个可独立审查的概念设计包，不是生产实现。文件数控制在 10 个以内。

## 查看顺序

1. 打开 `index.html`，审查工作台布局、状态表达、组件关系和用户路径。
2. 打开 `target-architecture.html`，核对目标架构边界。
3. 在 `index.html` 的“用户路线”中核对 PRD 承诺的主操作链与失败恢复。
4. 阅读 `gemini-prompt.md`，可将整个文件夹交给 Gemini 继续做交互体验改进。

## 事实边界

- 当前项目尚未发现生产源码。
- `assets/current-baseline.png` 是既有 `narralens-product-baseline.html` 的截图，属于文档型产品基线。
- v0 中所有工作台交互均为原型模拟，不代表 OpenMontage、Hypit、Local Host 或真实导出已经接通。
- 架构图中的模块均来自现有 PRD 和架构文档，状态为“目标/规划中”。

## 文件清单

- `index.html`
- `target-architecture.json`
- `target-architecture.html`
- `gemini-prompt.md`
- `assets/current-baseline.png`
- `assets/prototype-v0.png`
- `assets/workbench-v0.png`

## 图表验证记录

`target-architecture.html` 由 Archify 生成：showcase 验证 9/9，通过 1440×900、1600×1000、1920×1080 与 2048×1320 自动浏览器检查，无横向或纵向溢出。目标架构 JSON SHA-256 为 `01be3abd64a39d4141278fe8214a6fb964cfa37c0a437a5c4083012caa3b80da`，HTML SHA-256 为 `69d8c386f856bcaac4d7e316737f848aad111ef18d945bf09ef97bbef458fd0a`。

用户路线最初尝试使用 Archify workflow，但浏览器首屏出现纵向溢出，后续几何修复又产生关系线共享走廊。该版本未纳入审查包，改为 `index.html` 内的确定性 HTML/CSS 路线图，避免交付已知可读性缺陷。

