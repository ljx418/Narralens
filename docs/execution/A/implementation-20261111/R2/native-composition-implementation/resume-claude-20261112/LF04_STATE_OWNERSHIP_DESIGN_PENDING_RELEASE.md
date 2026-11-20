# LF04 状态写入归属：待放行修复约束

状态：DESIGN_PENDING_SOURCE_RELEASE。只读设计，不授权源码修改、测试或提交。

全量036完整差异为：created-source-change-service.ts 的 #replay 直接写 impact expired；revision-store.ts 的 commitPreparedCreatedSource 写 impact consumed。两者不是同一类问题，不应用一份全局白名单处理。

- 重放服务现直接通过 compose 执行 UPDATE，随后无条件将本地 state 置 expired。现有 ImpactStore.markExpired/transition 已具有期限判断、合法迁移、预期状态及 changes 检查，应优先复用此权威；CreatedSourceImpactStore 可增加最小 Host 内部委托。必须保持同一共享数据库，不引入另一状态机。核对过期边界、终态重放、并发状态变化，不得凭本地赋值报告数据库没有发生的状态。
- commitPreparedCreatedSource 是多事实原子提交。现有代码按 impact_id/project_id/active/impact_hash 做 CAS，并要求恰好一行，和 revision、approval、snapshot、active commit 处于同一原子边界。评估其是否属于与 commitAdoption/commitHistoryRestore 相同的合法数据库拥有者；若确认，应采用精确文件+方法归属注册，并有状态/摘要/项目错配拒绝及整个事务回滚证据。不得移动到非原子异步服务或先消费后提交。
- 原扫描器 AST 所属方法识别和两个负向自身用例必须保留。若新增合法条目，另证明同名方法在其他文件、新的未授权方法以及去掉前态/hash/CAS 任一保护都会被相应约束或业务负向用例打红。
- 原 Gate 历史、当前红灯捕获均保留。此处仅提供审查方向；由现有 ClaudeCode 提交精确改动与用例计划，经 MAIN 核验清理后另行放行。
