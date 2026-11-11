# D10 采用服务候选（内部证据）

尚未开放生产路由；专项 recovery、Context/selection/NativeAck 与组合验收仍待完成。独立审查 PENDING。

## 实现

CreatedSourceAdoptionService 复用 Coordinator 项目串行队列；申请真实 Reader 能力，校验当前输入闭包/计划/Run/审批/confirmation/impact/许可与全局锁；以原事务 kind=edit、精确 operation 记录不可变原/目标闭包和 prepared_authorization，走原阶段机、真实 Publisher、RevisionStore 闭合提交。最终消费 approval/impact、revision+1、snapshot/pointer/step/outbox/idempotency 均仍由原单笔提交完成。关闭等待自己 pending，资源异常持久于实例、清理全部对象并阻断重放假绿。

CommittedSnapshotAuthority 新增明确的已提交 created producer 分支，详见 D10_NATIVE_SNAPSHOT_READ_DECISION.md。旧 M4 completeness 不改，不按错误名单无条件放行；无源来源事实时即使同样 metadata/film 也拒绝。几何信任基础为原已验证生产者的 immutable full-source digest/计划/事实与固定原生 parser，并非重新测量全部视频。

## 真实执行与缺陷发现

- typecheck36 exit2：原 impact planFact 没有 project_id 属性，改为验证实际 plan 项目和 prepared 映射归属；失败保留。
- real028：2PASS/1FAIL，真实审批/并发采用提交后 snapshot read 失败。
- real029：诊断重现，旧 M4 projection 只拒 box/style/volume，帧90/fps30一致。
- real030：新的 producer read 已通过，随后发现 altered-key 测试中的 sync throw/Promise 契约差异；apply 改为一致 async 入口。
- real031：无来源负向确实拒绝，但注入删除 trigger 未恢复导致 schema 校验提前失败，不能拿它充当来源分支的证据。已改为保存并恢复原 trigger SQL，实际实例化原 store 验证 schema 完整后确认来源行不存在再读 snapshot。
- real032：3/3PASS，包含实际审批→并发调用只+1→可读同内容快照→异请求同 key 拒绝→删除来源仍拒绝。
- 内审追加 acquire 清理失败必须被 service 自身 close 记住，不能只依赖外部 Reader owner。
- real033 最终：4/4PASS（31未选/总35）；新增真实 stage close 故障，服务/Reader 仅允许已知注入错误参与专属 teardown；无全局异常忽略。
- typecheck40 exit0 对应最终输入；本轮所有捕获 input changed/added 均空，失败原样保留。

## 明确限制

真实 Host/SOURCE_ONLY/native source 与原 SQLite/Publisher/closed commit；ReviewPackage part refs 仍是隔离元数据夹具，不是可预览人验影片。新服务未注册生产；出现 prepared publication 错误保留 journal/backup 并进入原 attention，只是安全停止，不是完成恢复。旧 M4 投影对丰富原生属性仍拒绝，Context 需要 MAIN 后续详细接线。没有真实 kernel close 故障、官方导出、UI hydrate/NativeAck、中文授权双影片、全仓全阶段或 A PASS 的声明。
