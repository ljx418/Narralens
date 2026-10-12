# D2 实现后外部审查与闭环

日期：2026-10-12  
审查器：Claude Code CLI 2.1.205，只读 `Read/Grep/Glob`

## 第一轮结论

第一轮为 `FAIL`，提出 2 critical、4 major：选区使用 JSON 字符串比较、要求真实 Provider 422/529 证明、UI 未消费 SSE、取消后潜在错误丢失、CLI 提示 schema 手工复制、容忍字符串化 `result`。

## 修订闭环

1. 选区改为 `shot_id/start/end` 逐字段比较，并增加 JSON 属性顺序变化回归测试。
2. UI 改为消费带 token 的 SSE stream；修复后重新执行真实 Headless Chrome 点击并通过。
3. 取消仅在 AbortSignal + `RUNNER_TIMEOUT` 时进入 cancelled；adapter/save 的真实错误保留为 failed。
4. CLI structural envelope 从 canonical `proposal-bundle.schema.json` 派生，并测试 optional `source_packet` 与全部顶层属性存在。
5. Runner 只接受 object `structured_output`；字符串化 `result` 不再被二次解析。
6. 422/529 证明边界按冻结计划澄清：`D2-RUNNER-01` 是协议故障注入，`D2-RUNNER-REAL-01` 是真实成功链；未自然触发的真实服务端 envelope 不作虚假声明。
7. UI 增加排队与取消路径测试；最终为 5 files / 22 tests。

## 第二轮结论

第二轮逐项核对实际代码、冻结测试矩阵和证据后结论为：`IMPLEMENTATION_EXTERNAL_REVIEW=PASS`。

- C1/C2/M1–M4 全部关闭。
- 9/9 D2 门限均有在库证据。
- 无致命或重大问题。
- 两个 minor：Runner prompt 字面量回归测试建议、早期 Vitest 误扫未进入 manifest limitations。前者由 strict structured output + canonical schema 派生控制，后者已补入 manifest；均不阻塞 D2。

因此 Gate D2 可以关闭，只允许进入 D3 计划、审计与后续实现，不代表 D3 写入或 V1 完成。
