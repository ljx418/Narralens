# 当前实例恢复发布凭据候选（内部证据）

在4b42352上新增 Publisher.recoverPublished，并将原 producer/metadata/rights/semantic plan 检查抽成共用私有preparedContext；正常发表仍沿原闭包、真实copy/snapshot/journal和原closedcommit。恢复不复制、不编码、不创建新job/snapshot/业务transaction。原private WeakMap issuer、N3 cleanup和当前字段/锁/批准/selection检查保持。

恢复先要求真实 CreatedPublicationRecoveryFiles 活租约、同原DB、实际published位置与Host配置一致；重新读取真实SOURCE_ONLY Job/attempt和stage、固定原生计划/许可，独立重新持有original backup/target author/snapshot及媒体blob FD，对照pre-move持久身份，重做真实父目录fsync。缺published journal时按实际文件事实追加原tid:published。只当前Publisher可签opaque token，不能把prepared JSON或克隆lease当proof；实际提交仍只允许原RevisionStore.closedcommit完成，权威失效不能靠恢复绕过。

## 捕获

- typecheck53/54exit0，但当时没有真实入口验收，不冒充通过。
- real042：新4项真实Host/SOURCE_ONLY全部失败，原因在resource helper的目标摘要根顺序，不是供应商/资源噪声。source-digest-v1.ts247-272明确第一个root决定entry角色；真实prepared依赖roots排序与固定film入口不同。
- recovery-files008-root-order-old：最小单点复现1FAIL22FILTERED，原helper直接用plan.roots会把scene或settings当entry。保留该失败。
- 修复强制原生film.html先行、余依赖保留，并拒绝不含film根的目标plan；SourceDigestV1实现、域与旧向量完全未改，仍要求完整源摘要相等。
- real043：真实Host/bootstrap/实际本地诊断媒体/SOURCE_ONLY/原R1所有权/原闭包+原commit四项PASS43FILTERED。分别为关闭旧issuer后新实例重证并原tid恰+1且重放、缺published行按实际事实补齐且无新job或SnapshotStore.publish、克隆lease/selection变化拒绝不消费批准、过期拒发proof且完整旧源补偿后原Coordinator中止+0/不消费批准/无新outbox。
- recovery-files009：23resource+10retained+15identity=48PASS；typecheck55exit0。全部原始输入前后无变化，四个新发布路径封存前hash再次匹配。

评论：审阅决定依然是显式accepted-policy fixture，selection也是明确测试port；这些是实际Host/Producer/issuer模块链，不是生产HTTP入口、真实用户确认或工作台NativeAck。两个新helper方法只供Host取当前published路径和同步fsync，绝不表示业务授权。原公开wire/CP31/80defs/EnginePort7/原事务state均未改。

## 尚未完成

此处只是原business恢复release的issuer子步，CreatedSourceRecovery、在线prepared/attention区别、确定性取消/过期策略与可重试I/O、generic保留和Host进展调度尚未实现，未注册生产入口。新的SIGKILL/Host恢复矩阵、NativeAck、正式双导出与A人工验收仍NOT_RUN。所有RCV业务case未因本次4+48通过而关闭。当前发行差异及entry修复未自签独立外审。

正常发表的preparedContext重构需要完整现有47项回归；候选冻结时该整组未运行，随后单独捕获real044。不能继承real04043项为本重构背书。独立审查应绑定本次源码，完整回归结论等实际结果后再追加。
