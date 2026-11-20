# R7 rev3 定向文档复核

**DOC_CONDITIONAL_READY**。R7-D03 与 R7-D05 在条件设计层闭合。本轮将两份修订文档与 rev2 归档逐段对照，并核实当前合同和验收草案与修订回执的 SHA-256 一致。

| 原项 | 闭环依据 | 已写入验收的关键区分 |
|---|---|---|
| R7-D03 | §D03 将未发布 prepare、新建但未注册的 serving、尚未交付 owner 的工厂资源分别归到原 owner。serving flight 仅处置新取得的资源，借用的 prepared 目录继续由 workspace 持有。工厂 attempt 在首次 I/O 前建立，成功时移交，未知时保留原根依赖。 | D03-f/g 分别观察物理终局后诊断抛错、真实 close/drain 未证实；无资源早拒绝另有正控。全局 phase-one 和父 FD 依赖仍约束 dispose。 |
| R7-D05 | §D05 将 witness 可交付与 scope 可归还分开。业务或 activate 失败但 phase 凭据齐全时，先撤销候选，再消费 failed completion，释放原 scope 一次并保留原 cause。缺凭据或消费被拒时继续持责。 | D05-b 通过预装的同步不可重入返回值检验原 caller；D05-f 单独检验原函数拒绝已消费或外来凭据；D05-e 验失败归还。成功及同根排队正控按原 scope 身份判断，两种 lookup 均按本次 witness 核验。 |

DEVELOPMENT_ACCEPTANCE_DRAFT.md 已同步列入 D03-a..g 和 D05-a..f。D01、D02、D04 及 35 项原映射沿用上一轮结论。本轮未运行产品或测试。实际 listener、源流和媒体的分层实证仍待相应运行票。R6 实际接受后须按接受 commit 重锚私有接口与受影响 caller，再形成精确实施票。
