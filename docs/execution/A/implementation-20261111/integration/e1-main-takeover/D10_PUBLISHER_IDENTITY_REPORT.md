# D10 Publisher 持久身份与 prepared journal 原子接线候选

MAIN 基线 64884a8；只修改精确释放的 Publisher 与原 adoption 真实测试文件。身份组件已有独立 bounded ACCEPT，本接线仍待独立复核。没有开放生产 apply 或实现专项恢复。

Publisher 从真实 guard 获取 original author、实际隔离 staging（不是 producer stage）、target snapshot/source 和其已保留父容器身份。新表与 prepared journal 在原 RevisionStore.atomic 同一事务写入，成功后才进行任何 rename。目标 guard 贯穿 staging→author 移动；原 author guard 贯穿 author→backup，未按同字节新路径重新签发身份。snapshot、target、backup 三个角色同时保留至原 closed commit 的身份重检及全部既有授权/选择/许可校验。原 journal DDL、opaque proof 外观、EnginePort、wire、审批权威与唯一业务状态机均保持。

## 真实验证

- typecheck-48：exit0，完整输入无变化。
- real037：4 PASS / 39 SKIPPED（总43）。真实 Host/固定上游/本地实际诊断媒体；接受审阅策略仍是明确 fixture，无人验声明。
- before rename 正向：在 record 的原同步调用里证明 SQLite.isTransaction、尚无 journal、旧 author bytes、无 backup，四个真实目录 dev/ino 与输入逐一相符；新独立 RevisionStore 连接读回完整身份记录，正常原 closed commit +1、同请求不二次提交。
- AFTER INSERT identity 与 AFTER INSERT prepared journal 两个 SQLite 真故障：身份/journal 均0行、完整原 source digest+RetainedTree 集合不变、revision1、transaction prepared、impact active；没有 source rename，孤立 workspace 被原有清理释放。
- 删除身份事实且恢复原不可变 schema 的负向：原 closed commit 拒绝，revision/transaction/impact/Approval/outbox 不变。
- real038-publisher-identity-old：只还原生产 Publisher 到64884a8，测试不变，2 FAIL / 1 PASS / 40 SKIPPED。失败为没有真实 record 与没有 identity insert fault；旧 journal 单独失败测试本身通过，不冒称三条都打红。
- real039-publisher-atomic-split：只将 identity 与 journal 拆成两个提交，测试不变，1 FAIL / 42 SKIPPED，真实残留 identity=1 直接违反原子性。完整失败日志保全。
- 两次控制后代码精确恢复，SHA256 见 publisher-identity-restoration.json，候选备份 publisher-identity-candidate.ts.txt。所有捕获 source_changed/source_added 为空。
- 完整43项真实 adoption/N3清理回归：本候选冻结时尚未执行，随后使用相同源字节独占重型资源捕获 real040；以实际退出和最终日志为准，不能继承早期 real024 的39通过。

## 待完成边界

prepared 发布错误仍由原服务 eager attention；专项恢复/补偿、真实 SIGKILL/重开、三域 family/generic/Host 调度装配、运行根独占复核、原生 NativeAck 与双正式导出仍未完成。RCV-D10-01..10 NOT_RUN。持久 dev/ino 是强绑定事实，不单独证明防 inode 回收、文件系统迁移或物理断电。当前只是实施候选，不能宣称 A 通过或用户体验可验收。
