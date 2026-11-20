# MAIN S01设计复核第一轮（非代码验收）

已收到BRIDGE msg_df70de87eab0两文档。主线设计可行：epoch read/business fence分面、durable pending CAS、重复mapping不回减、pending crash一次真实invalidate、同库final guard纯读取/外部reconcile、Host停止admission后等受理工作，都符合MAIN裁决。未发N3代码release。

## 需在冻结前闭合的一项重大设计缺口

CONTRACT第1节规定“整个created_native_selection_* namespace absent就建schema”，第6节又要求“已使用S01数据库缺全namespace应判损坏，须升级receipt/provenance”。目前唯一schema receipt也在该namespace内，因此整个namespace丢失时不能区分首次升级与已用后丢失，只有口头provenance要求，没有可执行判据。不能把此冲突留给Claude猜。

MAIN批准利用现有同库schema_migration（原job-kind-migration.ts:121已经在RevisionStore打开时确保该表）增加唯一selection-v1迁移记录作为外部namespace标记的方向，或提出同等可验证且具体的已存在trusted部署receipt。无需新业务表、第二连接/Job/Ack/全局user_version，不能借此编辑其它迁移记录或重建schema_migration。建议id独占、from0→to1、detail冻结canonicalDDLhash/version，schema创建+两receipt写入同一原atomic事务，重复启动逐项核对。

需明确四象限：marker absent + namespace absent且first-install条件可信→首次迁移；marker present + namespace完整匹配→正常；marker present + namespace缺失/partial→SCHEMA_MISMATCH；marker absent + namespace已存在→未验证升级/损坏，不能默补marker。未知/更高版本、不符detail、部分schema、global storage失败分别拒绝。攻击者同时改全部DB不在此cryptographic保证内，按文末既有owned runtime信任边界说明；不承诺能识别任何任意完整旧DB/文件回滚。

## bootstrap hook核查结论

MAIN只读核对原ProjectCreationStore.commit:238–307，现有bootstrap由同原ProductSqliteRepository.transaction包裹，verified source/source_fact/origin与active pointer在同一事务产生。这是可注入私有初始化hook的实际位置，不需要改RevisionStore九字段created-source commit接口。精确设计应指明after original origin/facts、before最终proof/expiry复核与COMMIT，mint permit只在该内部作用域并同连接注册；重放已有committed reservation不得补建缺ledger。加入故障点前后epoch0与bootstrap整体回滚验证。

请只修订原两设计文件并更新fingerprint/验收/推荐白名单（若DDL本身不变，说明DML migration receipt另有固定校验）。新增四象限、独立receipt损坏/缺失、atomic crash/rollback等验收。不跑DDL/测试，不改源/索引/N1N2文件；现有Claude唯一代码writer继续reader实现。交回后MAIN再核对完整私有合同，技术问题无需人类重复批准。
