# 叙镜V1目标体验、L0/L1与阶段计划统一核对

主入口：[index.html](index.html)。一个HTML内嵌PRD/架构/追踪、实施详细设计、CP-A0说明、批准R4交互原型、AI目标示意、Archify L0/L1、8页GAP、任务包与验收门、精确候选合同下载和版本绑定反馈。可离线使用，不启动产品服务。

建议顺序：目标体验→R4原型→L0/L1与22实体→A/B/C计划→最近A人验→合同状态→逐项反馈。反馈仅为文档意见，不生成生产授权或人验签署。

Archify图有独立规范与交付摘要。原生visual-check因当前WSL无Chrome保持SKIPPED；Windows Headless补充测量和截图单独在browser/。AI图仅目标示意，30秒样例不是A或长片门槛，不能作为真实产品证据。完整首章与样片、非模态系统侧栏等以07/08和CP实际规格为准。

`build-review.py`只在docs内生成页面及内容绑定，不改产品。`browser/check.mjs`运行静音Headless、使用独立profile并清理，不抢焦点。产物自检不等于业务验收。文档候选字节锁与生产release分开。
