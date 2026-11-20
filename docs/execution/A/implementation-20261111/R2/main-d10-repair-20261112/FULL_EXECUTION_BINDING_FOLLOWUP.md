# 1349636 冻结期间补查：完整 producer_execution

这是 MAIN 只读发现并发送独立审查的明确缺口，尚待正式交回。原 normal adoption 的 preflight 使用 canonicalDigest(input.execution) == canonicalDigest(plan.producer_execution)，恢复分支应保留同一原始输入绑定。PreparedAdoptionPlanV1.producer_execution 包含 run_id、plan_version、step_id、attempt、input_digest、run_scope_digest、authorization_id。

当前 surviving authorization 验证 approval 的部分字段，approval 表没有 authorization_id。故仅改 request 的 schema 合法 authorization_id 并重算内容摘要，在 adoption fact 已缺损而 authorization/impact/approval 均存时仍可能被当作合法早期请求；不能把它称为原请求已验证。该检查必须读取同一 immutable plan 的完整 execution，不是只查一个仍有效的 grant，也不是把 plan 字段回填进请求。

交回后的最小精确改动（目前不执行）：无 adoption 但已有 authorization 的 plan 证明加完整 canonical execution equality；有 adoption 的合法性门同样核对 immutable plan.producer_execution，避免只对 adoption 自洽。真正早期无 auth/无 adoption 保持原独立 owner/base/完整 source 证明，不能为了新检查查询不存在的 impact 表而阻断它。

回归：扩展 existing real-producer missing-adoption 用例，分别替换 approval_id 与 authorization_id（合法schema+重算request hash，保留原DB授权）。后者先在1349636取得真实断言失败；新源应在任何 owner/author guard 前真实持久 attention，所有 source bytes/identity 和 approval/impact/revision/pointer/step/outbox/idempotency/journal 保全。匹配 surviving authorization 正向对照必须仍能安全 abort。必要时补有 adoption / immutable plan 不同 execution 的损坏事实负向，不能用只测 hash helper 取代真实 Coordinator 决定。

不在独立审查活跃期间改源码、测试、Git索引或配置。应先取得审查的真实命令终止与唯一写入权交回，再执行修复/受影响命令/新冻结；不能自签独立复核。
