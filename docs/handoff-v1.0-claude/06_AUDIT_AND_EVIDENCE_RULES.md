# 审计、证据与声明规则

## 证据最小字段

每个 artifact 至少记录：测试编号、UTC 与本地时间、机器/工具版本、Narralens 与两个上游 SHA、fixture/input SHA、命令、退出码、关键断言、产物 SHA、清理状态、claim limits。不得记录 session token、API key、绝对用户路径或移动硬盘路径。

## 真实能力证据组合

| 声明 | 至少需要 |
|---|---|
| UI 可用 | 浏览器交互日志 + 状态截图 + axe/键盘/200% + API/落盘事实 |
| 写入成功 | HTTP/response + journal + Source/Run/manifest SHA + revision + 重开 |
| 导出成功 | MP4 + ffprobe + 完整 decode + 帧样本 + 工程/输入 SHA |
| 恢复成功 | 故障点 + preimage + journal state + 重启 + 精确 postcondition |
| 无无关重生成 | provider/Runner 调用数 + 已锁资产 SHA + 非目标实体逐字段对比 |
| 安全 | origin/token/path traversal/URI 请求/credential scan + 工具版本 |

## 审查分层

1. 计划内审：规格覆盖、实体所有权、状态机、失败语义、可验收性。
2. 计划外审：新的 Claude 会话，只读完整上下文。
3. 实现内审：代码与计划逐项映射，主动寻找假验证。
4. 实现外审：新的 Claude 会话复核 diff、生产路径、测试真实性和声明边界。
5. 阶段总审计：PRD/架构/Draw.io/代码/证据一致性。

## 429/422/529 处理

- 429：保留当前命令和状态，遵守服务端 `Retry-After` 或退避，等待/重启会话后从最近未完成门禁继续；不得重复写入或丢弃失败记录。
- 422：优先视为输入/合同/规格问题；读取响应与 schema，修正文档或实现后重新验收，不做盲目重试。
- 529/provider overload：UI 必须如实展示；记录单次请求事实，服务恢复后用同一冻结输入重新执行。
- 用户没有设定全局预算或尝试次数上限；这不等于允许无依据的紧循环或无界 provider 调用。每次重试都必须有新的恢复条件、遵守退避、可计数且可审计；确定性的 422 不重试，同一外部阻塞在没有状态变化时停止消耗并报告，而不是伪造成功。

## Git 纪律

- 不 reset/checkout 用户修改，不把 unrelated dirty files 混入提交。
- 实现提交与文档/证据提交分离；提交消息描述单一能力。
- push 后核对远端 SHA。阶段结束前工作树应干净；无法清理时列出每个文件所有权与原因。
- 只有阶段出门后更新“done/passed”；中途只能写 `in-progress` 或 `partial`。
