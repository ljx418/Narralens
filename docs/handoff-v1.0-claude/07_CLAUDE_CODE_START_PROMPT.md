# 给 Claude Code CLI 的启动提示词

将以下内容原样发送给 Claude Code CLI：

```text
你正在接手 Narralens V1.0 的持续自动化开发。Windows 路径为 C:\workSpace\videoWorkLine\Narralens；本机实际 WSL 映射为 /mnt/c/workspace/videoworkline/Narralens（大小写按各自环境原样使用）。远端为 https://github.com/ljx418/Narralens，分支 main。用户已经批准实际开发；无需再次请求普通开发许可。不要设置全局硬性预算上限或尝试次数；但每次 provider 重试必须有依据、遵守 Retry-After/退避并可审计，确定性 422 不重试，429/529 不得盲目紧循环或制造重复费用。

第一步必须完整阅读 docs/handoff-v1.0-claude/00_README.md 至 09_EXTERNAL_AUDIT_SESSION_PROMPT.md，然后按索引阅读 PRD、架构、工作流、D4.2 总体计划、D4.2.1 专项计划和现有审计。先运行 git status、git diff --stat、git log -1、git submodule status、git diff --check，保护所有未提交修改，不允许 reset/checkout 覆盖它们。

当前本地冻结实现 HEAD 是 84775af32950b06c90ed7c2555cf9e46d0c5095c。D1、D2、D3、D4.0、D4.1 已通过。D4.2.1 的生产实现、Headless Chrome 100%/原生 200%、全量 126/126 和内部总审计已通过；当前只剩独立外部总审计、发现闭环、最终状态提交与推送。不得重做已经通过的门禁，也不得提前开发 D4.2.2。

工作树包含 D4.2.1 状态文档、最终内部审计、canonical/attempt 浏览器 JSON/截图和本交接包。先按 09_EXTERNAL_AUDIT_SESSION_PROMPT.md 在新的只读会话执行外部总审计。真实 Headless Chrome 原生 200% 已由隔离 profile preference、DPR 和 viewport 比率证明；所有自动化浏览器、交互、截图与 E2E 仍必须 Headless、无声、无可见窗口、无弹窗且不得抢占焦点，不得自行启动 headed Chrome。使用 J: 视频制作移动盘前仍须通知用户。

D4.2.1 收口后，按 03_REMAINING_ROADMAP.md 严格串行推进到 V1.0：D4.2.2 文档内外审→实现验收，D4.2.3 文档内外审→实现与 D4.2 总验收，D5 先补完整文档再实现，D6 产品工作台/真实章节切片，D7 交付闭环与 Gate V1，最后做中文 HTML 可视化验收、人工体验、Git 同步和 sync-project-progress。每个子阶段执行：验收标准→开发计划→内部审查→新的 Claude 只读外审→实现→真实数据 E2E→PRD 检视→证据落盘→实现内外审→Git 推送。critical/major/must-fix 非零不得出门。

始终遵守：不以 mock/静态页/截图证明真实能力；不手写宽松协议 parser；不正则改 Hypit Author Source；不绕过 Host/ProjectWriteActor；不把 UI 状态当服务端锁；不放宽 origin/token/path/license/expected SHA/revision；失败不能精确恢复就进入诚实 attention；导入成功不等于素材化或采用；D4.2.2 成功只能写“已准备采用”；只有 D4.2.3 允许写 Source 且 revision 恰好 +1。

若文档不足以安全支持下一阶段，停在文档开发并补齐，不要猜实现。若发现虚假验证、架构/PRD 偏移、真实数据不可得或无法消减的高风险路线分歧，停止并向用户报告具体原因、影响、备选路线、架构冲击和体验影响。否则持续推进，直到 V1.0 自动 Gate 全绿；最终人工体验仍由用户确认。

现在先汇报：当前 HEAD、dirty 文件、已通过门禁、D4.2.1 精确剩余项和你准备执行的前三个动作，然后立即执行 D4.2.1 独立外部总审计与收口。
```
