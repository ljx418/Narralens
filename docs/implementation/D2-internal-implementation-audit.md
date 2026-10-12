# D2 实现后内部独立审查

日期：2026-10-12  
结论：**内部通过，提交外部代码审查**。结论只覆盖 D2 单提案读取/生成/展示链，不等于 D3 写入或 V1 完成。

## 规格与范围

- UI → loopback Host → async job → ControlledAgentRunner → ProposalAdapter → staging 与 D2 架构一致。
- HypitReadAdapter 只读；真实 Runner 前后 Source/Run SHA-256 一致，没有提前实现 D3 写事务。
- `source_packet` 仍为 optional；真实提案不是手工 JSON或 test double。
- 页面保留批准原型的信息层级和真实状态文案，没有实现或暗示 3–6 提案比较、采用写入、导出等后续规格。

## 安全与故障

- Host 仅绑定 IPv4 loopback；API 需要 same-origin 浏览器证明及短期 Bearer token；project/path 显式登记，body/output 有界。
- Runner 固定数组参数、`shell:false`、无工具、safe/plan mode；不向 Provider 发送媒体、凭据、路径或文件。
- 422/529 按 `D2-RUNNER-01` 由 CLI 协议 test double 注入，ENOENT/timeout/非 JSON/过大/schema 失败均落为真实失败；单个 job 自动重试次数为 0。真实成功门槛没有自然触发 422/529，故不扩大为“真实服务端错误已实测”。
- CLI schema 只做结构引导，完整 Draft 2020-12 + 语义绑定由 ProposalAdapter 强制执行；无自动修复模型输出。

## 验收

- `corepack pnpm check`：5 files / 22 tests，通过；production build 通过。
- 真实 CLI 最终证据：MiniMax-M3，$0.101904，44.872 s，2 turns；三段 100+120+80=300 帧。
- 修复后 Headless Chrome 通过真实 SSE 路径点击：项目、选区、success、NOWRITE 文案可见；1414/1414 无横向溢出；成功态截图目视无布局或事实错误。
- 凭据与本机路径模式扫描 0 命中；专用 Chrome profile 已清理。

## 保留风险

- JobStore/proposal staging 是单进程本地实现，进程恢复属于 D5；不能视为持久 journal。
- 预览是 Hypit Studio 真实入口和只读 descriptor，不是完整播放器控件。
- 真实 Provider 输出有非确定性；严格校验会拒绝不合格提案，用户需要手动重试。
- 完整 WCAG/axe、200% 文本、120 镜头性能和 10–15 分钟母项目尚未进入其计划阶段。

内部审查未发现致命或重大规格偏移；外审需重点检查 SSRF/Origin、child process 生命周期、SSE 资源释放、schema 双层边界与 UI 状态竞争。
