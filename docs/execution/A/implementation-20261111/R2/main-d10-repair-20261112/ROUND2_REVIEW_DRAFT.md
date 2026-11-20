# D10 MAIN 修复后独立复审票（冻结前草案，尚未派发）

原候选 eba0d42 的独立审查 REQUEST_CHANGES（MAJOR-01/02、MINOR-01），报告与探针保留在 R2/d10-business-independent-review。MAIN 本轮亲自实现两路径：created-source-recovery.ts 与其 integration test，未修改原 adoption 实现、合同、DDL、Coordinator、Publisher 或 RecoveryFiles。最终冻结 SHA 与四路径摘要将在命令全部真实结束后补入正式票，本草案不是资源 grant。

必审：
- 两条早期 abort 出口、构造失败、Publisher/lease 清理都立即 sticky 记录同项目不确定性，聚合保留每个错误。真实终态与主操作错误不能被 finally 覆盖。close 全 attempt 且不得假称资源全部清理。
- recoverOnStart 整轮在 callback 前受理登记，close 后只拒绝新公开调用，已受理扫描内部继续并被 close 等待，不提前关闭资源。DB 决策/有限进展/排序不变。
- adoption 缺失仍独立查既存 prepared authorization，与 input project/run/approval 匹配；不可变 impact plan hash 与原 approval 的 base/control/execution 字段验证 surviving authorization。真正无授权早期 branch 与合法匹配 branch 不可误封；损坏请求必须在 owner/author proof 之前持久 attention，其余 authority/文件不变。

MAIN 留存旧实现三 lifecycle 真断言失败与真实 producer 授权不符仍被 abort 的失败；新探针保持审查者原字节，不能改诊断使其变绿。fixture/类型声明错误独立保存，不计作业务反例。

最终冻结后资源候选：只在 MAIN 原 cwd 运行原 recovery 文件 -t "MAIN lifecycle|MAIN authorization|MAIN cleanup|commits the original published transaction exactly once|resource cleanup failed"。预计9例，以实际命中为准；可重跑完整 tsc 和原只读生命周期探针。无 build/浏览器/全量/网络/provider/J/付费/新worktree/源及索引改动。未授前不执行重型命令。

独立报告仅写新的 canonical R2/main-d10-independent-round2，不覆盖首轮。保存 source/index/AGENTS 前后不变、真实 argv/stdout-stderr/exit/SHA256 与判断，全部自有验证终止后交回唯一 writer 与资源槽。可给模块 bounded ACCEPT/REQUEST_CHANGES，不能签生产 Host/SIGKILL/合法后继/NativeAck/影片/A 人验。
