# D2 统一宿主与真实提案链证据

状态：**Gate D2 通过（2026-10-12）**。内部验收与两轮独立外审闭环；真实 Runner、修复后 SSE 浏览器 E2E 与 NOWRITE 全部通过。

## 当前实现

- React `NarralensApp` 保持获批原型的“精修 / 真实工程 / Director Pane / 提案卡片”信息层级，并支持浅色、深色、系统主题与 reduced-motion。
- 8 个 JSON Schema、TS 类型、Ajv Draft 2020-12 校验及帧覆盖/revision/selection/preserve 语义绑定。
- 只监听 `127.0.0.1` 的 Host；same-origin loopback、短期 constant-time token、64 KiB body、显式 ProjectCatalog、静态文件路径边界。
- JobStore 提供单调 event ID、历史 replay、live SSE、取消/晚到完成真实状态；UI 不显示假百分比。
- HypitReadAdapter 只读 D1 descriptor 与 Run 哈希；D2 不写 Source/Run/Result。
- ControlledAgentRunner 使用 `spawn(executable,args)`、`shell:false`、无工具、plan/safe mode、stdin JSON、1 MiB stdout、180 秒超时；422/529 分别映射且单 job 不自动重试。
- CLI 外层仅负责 JSON 类型约束；Narralens 完整 schema 与语义校验始终是最终接纳门槛，不自动修补 Provider 输出。

## 当前测试

命令：`corepack pnpm check`  
最终结果：TypeScript 通过；5 个测试文件、24 项测试通过；Vite production build 通过。

覆盖：8 schema 合法/非法值、路径/Origin/token、浏览器 same-origin、Job replay/live/cancel、真实 D1 900 帧/30fps/3 shot 读取、Runner ENOENT/timeout/非 JSON/过大/422/529、Host 异步 proposal、UI 键盘提交与 529 恢复提示。

曾发生一次 Vitest 误扫 `vendor/hypit`，触发大量不属于 Narralens 的上游测试；进程已终止，`vitest.config.ts` 和 package scripts 现显式只匹配 `tests/**/*.test.ts`。该失败不计为产品通过证据，但作为阶段失败记录保留在本文。

## 真实 Runner 与浏览器证据

- `artifacts/real-runner-e2e.json`：Claude Code CLI 2.1.205，实际模型 `MiniMax-M3`，一次最终证据调用 `$0.101904`、44,872 ms、2 turns；queued → running → succeeded；三段共 300 帧；Source/Run 前后 SHA-256 一致。
- `artifacts/browser-e2e.json`：修复后 Headless Chrome 通过真实 SSE 路径点击“生成提案”，观察到项目、选区、成功态与“不写入 Source”；页面宽 1414 等于 viewport 1414，无横向溢出。
- `artifacts/ui-1440x1000.png`：初始真实工程页面。
- `artifacts/ui-real-runner-success.png`：浏览器真实 Runner 成功态，含三段提案卡片。

真实 Runner 调试与验收共发生 9 个产品 job：前 6 个用于关闭 CLI schema 方言、结构化输出与严格校验问题，后 3 个分别为脚本审计成功证据、旧轮询版浏览器成功证据、修复后 SSE 浏览器成功证据；另有 1 次最小 CLI connectivity smoke，不属于产品 job。没有自动重试或并发重放。历史失败依次为 Draft 2020-12 元数据不兼容、`error_max_structured_output_retries`、错误字段类型；均未被计为通过，最终通过 Narralens 完整 schema 的输出才进入 staging。

## 安全与事实边界

- 外传只有项目摘要、revision、帧率/总帧、selection、intent、preserve 与固定 pipeline/schema 摘要；没有媒体、凭据、绝对路径或任意文件。
- 凭据模式扫描（`sk-ant-`、`sk-`、AWS key、private key、显式 API key/Bearer）对 `src/contracts/scripts/tests/docs/evidence/D2` 为 0 命中；证据与日志未发现本机绝对路径。
- 浏览器使用专用 `.narralens-chrome-e2e` profile；只终止带该唯一命令行标识的测试进程，临时目录已清理。

## 明确保留/禁止扩大结论

- D2 只完成单个真实 ProposalBundle 的展示链，不写 Hypit Source；D3 的事务、锁、revision 与 journal 尚未实现。
- 真实预览当前是已验证 descriptor/入口，不是完整嵌入式逐帧播放器；完整 TimelineSurface 与 3–6 提案比较仍属后续阶段。
- 422/529 按冻结计划的 `D2-RUNNER-01` 通过协议故障注入验证映射；`D2-RUNNER-REAL-01` 证明真实成功链。本次真实 Provider 调用没有自然触发 422/529，因此不声称已实测真实服务端错误 envelope；若未来 CLI envelope 漂移，未知非零退出会保守映射为 503，而不会伪造成功。
- 10–15 分钟母项目、20+ 镜头、导出、字幕、来源许可、性能与完整可访问性仍属于 D3–D7/V1 Gate，D2 通过不得解释为 V1 完成。
