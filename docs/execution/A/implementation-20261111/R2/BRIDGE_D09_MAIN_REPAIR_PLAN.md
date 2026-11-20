# MAIN 接管 D09 根因与集成

独立审查 ctx_627c36d9ba50 已要求返修，B1/M1 未闭环。当前完整回归 real024 在运行，源码不修改。

## 根因与约束

1. registerApproval 早期时钟不能证明耗时 read/hash/guard/list 后授权仍有效。最终已有 approval 返回和新 approval 插入前，必须在全部事实读取完成后重新采样时钟，检查 confirmation/approval/plan/impact/执行 grant；使用既有 common guard，不能把 final source commit 的检查替代审批自身检查。相同确认仍只允许一份审批。
2. 读证明 release 先丢引用再可能失败，review 事务已提交后才出现异常。Reader 需在撤销 token 前登记所有对象关闭责任，所有资源尝试清理，保留原始与 cleanup 双错误并阻断后续 acquire/assertCurrent。Authority 需保留清理不确定性，拒绝同实例 replay 假成功，关闭继续尝试拥有的对象；不得伪装 rollback 已提交事务。重启/实例资源寿命与数据库已成功结果分开说明。
3. acquire 临时 stage 关闭失败也不得留已发放但调用者未取得的 proof；失败关闭必须撤销并登记它。共享 PublicationCleanup 仅记资源责任，不引入新 source/commit/Approval 权威。

## 实施与验收

精确导入清单见 BRIDGE_D09_MAIN_TAKEOVER.json，仅五个实际 lane 文件；MAIN 旧 E1/N3/clock 核心保留。先导入不带修复建立当前候选，再新增真实 expiry-during-validation/late-list 与 cleanup-failure/replay 用例并确认原行为失败，然后修复。覆盖实际 same DB/private proof，补首次成功/replay 和跨范围拒绝。Reader 的正常 release/close、acquire/release 双错误、失效 token、并行 pending-close 与全部对象尝试也需针对实际 fixture 验证。

生产组合随后由 MAIN 接线；fixture/桩验证不能冒充生产入口。审批与 preview material 包的权威、资源关闭与专项 crash recovery 都需继续推进。N3 审查/完整39回归本次未宣布通过。
