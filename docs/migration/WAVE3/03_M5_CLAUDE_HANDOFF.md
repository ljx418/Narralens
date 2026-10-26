# Claude Code：M5 连续实现交接

状态：`REVIEW_PENDING`。只有同目录文档在新冻结提交上通过独立复审后，本文件才可作为开工入口。

下面提示词是下一阶段唯一开工入口；完整可复制版本也会打印在 Codex 对话中。

## 执行策略

- 基线必须是最终复审 PASS 后由 Codex 给出的完整 SHA，先复核 SHA/branch/status，保留用户工作，不 reset/stash。
- M5A→M5B→M5C 连续实现；模块内普通红灯自行修复，不在每个小模块反复要求外审。
- 每个子阶段先写会失败的合同/生产 seam/Headless case，再实现；测试不得只用 FakeClient 冒充 E2E。
- 不重写 Wave 2 已通过服务；按 04 的冻结裁决实现 Studio Gateway、comparison replay、薄 read model、严格 CAS lock API
  和前端 orchestration，不得用 raw upstream Studio 或 source comparison 直接绕过。
- 自动浏览器严格 Headless/静音/隔离/无窗口、不抢焦点；不得读取 `J:\`、联网、调用 provider 或付费。
- 停点：BLOCKER/MAJOR 无法消减、需要架构/数据/费用决策、或 M5C 自动门全绿等待人工体验。

## 必须交付

1. M5A contracts + Host workbench/replay/locks + Studio Supervisor/Gateway + typed client + store/layout；
2. M5B 真实 comparison/materialize/impact/adopt/history restore 同页闭环；
3. M5C Headless、a11y、200%、性能、中文 HTML 报告；
4. 逐 case、失败捕获、SHA256、凭据扫描、四视角内审；
5. 冻结候选与诚实声明，不自签外审或 human。

详细合同和门限以同目录 01/02 文档为准。
