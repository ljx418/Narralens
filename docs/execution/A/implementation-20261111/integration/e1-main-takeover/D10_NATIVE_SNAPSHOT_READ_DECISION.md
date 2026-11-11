# R2 D10：created 采用后快照的原生读取边界

状态：MAIN 实施候选，独立审查 PENDING；公共 EnginePort/DTO/旧 completeness 规则不变。

## 真实发现

real028 服务已完成真实审批→同项目队列→原子 revision2，并发重放只+1，两个发布前拒绝用例通过；正向在重新读取已提交 snapshot 时失败。real029 固定上游诊断证明 frame90/fps30正确，旧 M4 completeness 拒绝 concept-s1.box、shot-s1/s2.style、shot-s1/s2.volume。固定上游真实解析确认它们分别是页面矩形、视频 object-fit 字符串和 muted=0。失败与日志全部保留。

## 读取契约

CommittedSnapshotAuthority 保持 owner/committed transaction/snapshot ID/source_digest/完整源闭包/资产匹配原门。对于存在真实 immutable created_adopted_source_fact 的内容地址，逐项验证：

1. 原生产事务 committed 且 snapshot/source 一致；created_adoption_fact、源来源和 created_impact_fact 的完整计划 hash/项目/prepared source/目标 snapshot/目标 source/native plan 均相互绑定。
2. prepared-native.json 与 draft-plan.json 从 snapshot 内受限、非链接常规文件读取，逐文件对照实际 digest manifest 的 size/hash。不能凭存在一个文件打开此分支。
3. metadata 几何与已有 immutable created_source_fact 完全相等；整数帧/fps 与批准计划一致；preparedSourceConsumerGraph 重新构造并匹配完整 consumer digest。
4. 固定上游 readProjectFilm 无问题，读取 film 字节哈希匹配 manifest；所有原生 clip identity 和顺序与被提交 metadata 精确一致。该支信任的几何来源是原已验证生产者及完整不可变源内容，未冒称重新 probe/渲染了每个资产。
5. 没有该已提交生产者链时保留旧 adapter 检查；未知旧源字段仍拒绝。负向用例在独立临时 DB 删除来源事实后验证，即便相同影片与原生元数据仍在也拒绝。

## 不扩大结论

此为 committed snapshot 读取能力，不给任意 M4 graph 放行新字段，不宣称 Context/影响分析已支持该丰富原生形态，不产生 NativeAck 或 ready Delivery。后续 MAIN 须补 created Context projection/selection mapping、生产装配、专项崩溃恢复、原生工作区/实际 UI hydrate/正式渲染。未完成前本轮新 change.apply 生产入口保持关闭。

## 同轮服务

CreatedSourceAdoptionService 复用 Coordinator.controlledWrite、共同 approved_prepared_adoption guard、真实持有读证明、immutable adoption/prepared_authorization、原事务阶段、Publisher 与原子 RevisionStore commit；无新状态机/幂等/Approval。缺失审批/选区变化必须在事务/发布前拒绝。发布后错误保留原 journal/backup 并进入现有 attention，专项恢复尚待实现；不能把该策略当恢复通过。关闭等待服务自身 pending 并清理 Publisher，清理不确定性保留。
