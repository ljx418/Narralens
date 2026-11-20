# 同项目第二条 prepared：MAIN 接线前边界核查

状态：只读核查和下一接线验收约束，未改变 eba0d42 冻结源码、合同或审查范围；不是批准跳过既有提交门。

## 实际代码

- ProjectCoordinator.controlledRecovery 的 ignored IDs 仅让恢复回调进入队列，不授予提交权；原 recoveryGate 仍拥有 project attention 与未知 pending 拒绝。
- RevisionStore.commitPreparedCreatedSource 在 BEGIN/原封闭 scope 内仍独立查同项目其它 prepared/recovering/attention，命中 CREATED_COMMIT_OTHER_TRANSACTION_PENDING。输入仍精确九字段；外部不能提供 ignore/force。
- CreatedSourceRecovery 把该机器失败转为真实 deferred(OTHER_PREPARED_PENDING)，不编造提交、不消费第二份权限、不自动删除另一个事务。
- 原 accepted D10 RD-05 要求按实际 DB 进展处理三族交错，并让不可决者保留 unresolved/gate；不允许用固定遍数，也不允许把仅 scheduler mock 全绿算业务已收敛。

## MAIN 当前裁决与出门约束

保留封闭提交门，禁止本票/接线票通过增加裸 ignore/force 参数、删 pending SQL、伪造 terminal、先中止年轻行或临时移动另一工程来调绿。多条 prepared 的来源及对应物理 author/backup/snapshot 不明时只能保全与原 gate 阻断，健康项目仍可使用；不得为了“全部 ready”清理冲突。

这不把原 RD-05 的可恢复链验收降级为“遇到任何链都永久 deferred”。下一接线票必须先区分真实可达且事实相容的恢复链，与手工造表/跨生命周期破坏而没有实际物理前态的状态，逐项展示真实 producer 和对应文件位置。对前者仍需按原约束真实收敛；对无法证明者保留原attention/deferred并给明确诊断，而非假恢复成功。

必须覆盖：

1. 正常写入口在已有 pending 后不能新建第二份受控写；用真实生产入口/队列验证，不能手写表冒充这条证明。
2. 两个项目的真实 pending 独立收敛，一项目 unresolved 不冻结另一项目。
3. 同项目相容的多族 early/prepared 链按原 facts/base/snapshot 有效性真实排序；相同 created_at 用 transaction_id 全序。需要证明前态可由原 producer 或实际中断形成，不能直接写几行 label 就宣称合法后继。
4. 多 prepared 的 author/backup 当前归属冲突或无法证明：原 closed commit 拒绝，全部 source/批准/impact/outbox/idempotency 保全，Host 不报 writable/loaded，运行诊断暴露具体未决事务。
5. 若案例1–4证明当前两个门的组合阻止了原目标中的真实可恢复链，MAIN 在单独精确公共核心 release 中设计最小可信恢复上下文修补；只允许 Coordinator 原队列/原恢复生命周期内部产生权限，维持普通写入和 unknown/attention 拒绝、原九字段public shape、真实最终source/授权重验。修补须先独立架构审查与相应会打红的实际业务用例；不能由领域票自行扩核心权限。

当前这些 Host/跨族真实组合尚NOT_RUN，不能据本文件关闭 RCV-D10-08/10、T20或A。此文件把原报告的“需要MAIN产品决策”落实为保留保护、先证明真实前态并按条件设计的具体路径；不另向用户重复索取常规实现批准，也不绕过真实高风险事实需要人工处理的门。
