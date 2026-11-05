# M5 / UX-12 前置阶段审计（2026-11-05）

结论：旧捕获 `2a8337d316a6ed503c2e85e065a0385b0dcc87e6` 的文件完整性成立，但语义验收不成立，
不得继续作为 `M5_HEADLESS_EVIDENCED` 的出门依据。状态降为 `M5_ACCEPTANCE_REWORK`，UX-12 暂缓。

独立审查发现：

- PF-01 实际打开的是 3 clip 工程，120 clip 媒体未进入 Workbench/Studio；
- UX-11 未执行 J/K/L、I/O、F，也未真实切换主题或强制 reduced-motion；
- 1440/1024/768/360 四视口未逐一运行；PF-02/PF-03 缺增长序列与掉帧事实；
- 成功截图发生在 `env.close()` 之后，14 张图显示连接丢失；
- `fullDecode()` 在 `-v error` 下解析不到 frame，报告的解码帧数均为 0；
- Windows Chrome 的 WSL PID 被误当成 Windows PID，捕获结束后存在专用 Chrome 进程；
- 整页 axe 存在 serious contrast 与不可聚焦时间线滚动区，旧门只检查面板子树。

本次返修要求不降低 PRD/合同：建立真实 120 个原生 clip 的迁移工程、实现章节导航和完整键盘映射，
逐视口运行，补内存/媒体质量序列，修复整页可访问性、解码计数、成功态截图和按 profile 精确清理。
旧捕获原样保留，不覆盖、不删除；新的冻结提交与新捕获通过后才能恢复阶段声明。

