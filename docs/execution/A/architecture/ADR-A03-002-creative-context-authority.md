# ADR-A03-002 创作内容与上下文的生产权威

状态：实施候选，独立冻结复核待完成。公开cp-a0 DTO、schema、DDL及已批准HTML保持原字节。

## 层次与实体

`AgentHttpRouter → ScopedAgentAuth → ApplicationDispatcher → CreationApplication` 只向同一个 `NarralensHost` 的应用服务分发。`CreativeService` 保留内容算法及幂等；MAIN注入 `CreativeProjectAuthority`，通过同连接 `ProductSqliteRepository.transaction` 验证已有created origin/owner、创作闭包及输入版本。内容草稿不修改原生source、不递增项目revision、不授予执行/采用权限。

`ProjectContextService` 先核归属，再经 `ProjectResolver → ActivatedProjectionService.layoutFor → EnginePort.inspect` 实际验证原生源，异步观察后在单个SQLite事务重核commit/revision/control/recovery并读取artifact heads、run、grant、trusted_confirmation及真实活动job。EngineProjection内部revision/snapshot标记不替代Host commit事实。没有native producer时明确unknown/null；没有某个活动job producer时503，不隐去该行。

`trustedGrantConfirmation` 是投影及执行facts的共用确认来源：purpose、UI channel、actor、scope、input、expires以及安全整数issued_at都必须匹配，签发时间不得晚于当前时间。过期确认可作为expired记录展示；未来/损坏确认不构成授权，投影返回authorization:null。真正动作仍由严格requireActiveGrant/guardExecution核验。暂停与取消不会因为不可用授权的响应投影异常而回滚；这不等于已把实际渲染任务取消接入生产。

## 边界与兼容

- Bootstrap intake Ref来自实际intake/version/Brief hash；Brief carrier是另一个不可变artifact，不能混为一物。跨项目引用、命名空间冲突、重复内容ID和悬空paragraph均拒绝。
- 内容决定project_id为null时保留合法建项前交流；非null时必须是当前用户的committed created工程且originating intake相同，校验位于幂等回放之前。它仍是content_only，不是可信执行审批。
- 新草稿必须绑定当前问题/答案完整闭包。原幂等请求在输入更新后仍重放原响应，但归属始终先校验。
- source读取在同一个nonblocking/no-follow句柄上stat确认regular file后读bytes并关闭，拒绝FIFO而不是挂住Host；不改变SourceDigestV1哈希域、canonical规则或黄金向量。
- Agent错误码只按冻结错误集合和明确旧码/结构化source_error映射；未知原因不分类成ENOMEM，用户响应不带绝对路径或凭据。

## 验证与限制

真实Host/SQLite/固定上游测试包括自动创建、HTTP内容写入、项目归属/引用、源漂移/FIFO、活动job缺生产者；授权观察与safe-control测试使用明确标注的合成eligibility/adoption test ports，仅证明观察和事务语义。早期失败捕获完整保留，不能当已通过。

本候选不声明完整A03/A04、Run生产执行、真实媒体许可、工作台native ack、正式Delivery、短片/双导出、人验或B。下一步必须补真实能力producer、资产/许可与执行接线，并完成原工作台和正式导出链路。
