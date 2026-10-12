# D2 开发计划内部审计

日期：2026-10-12  
结论：本文件保留实现前审计历史。项目负责人随后批准 Claude Code CLI 作为真实产品 Runner，不设本地硬预算/次数，服务端约束为权威边界；D2.6 已在该授权内执行。

## 审查结论

- PRD 范围：D2 只实现同页单提案链和真实预览读取，不提前实现 D3 写入/锁/revision，也不承诺 D4 的 3–6 结构提案，范围未膨胀。
- 架构：UI → Host → Job/Runner → Proposal staging 单向；Hypit D2 只读；不存在第二时间轴或 OpenMontage 直写 Source。
- 测试：contract、安全、SSE、真实 Hypit、UI、Runner 故障、真实 Runner、无写入均有独立门限；test double 明确不计入真实出门。
- 安全：loopback、Origin/token、登记路径、无 shell、stdin/stdout 上限、日志脱敏和外传字段最小化已前置。
- 风险（已关闭）：项目负责人已批准 Claude Code CLI、既有登录态和限定结构化字段外传；媒体、凭据、绝对路径及任意文件仍禁止外传。

Claude Code CLI 外审确认 `SAFE_TO_IMPLEMENT_D2_1_TO_D2_5=yes`、`REAL_RUNNER_GATE_REQUIRED=yes`。外审提出的 schema 清单、PRD 子阶段映射、D1 NOWRITE 基线和 `source_packet` optional 语义已补入阶段计划；这些修订不改变 Provider Gate。

## 放行范围

历史放行范围为 D2.1–D2.5；后续人工 Gate 已关闭。最终实现仍必须由真实 Provider、严格 Proposal 校验、NOWRITE 和浏览器 E2E 同时证明，不能以 503 UI 或 test double 宣称通过。
