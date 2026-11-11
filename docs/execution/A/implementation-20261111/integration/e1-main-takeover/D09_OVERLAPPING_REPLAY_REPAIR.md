# D09 并发清理/重放窗口修复

原独立结论 msg_a67e6c53aac8：B1 最终有效期已限定闭环；Reader M1 资源责任正确；M2 尚有重叠重放窗口。原结论不删除，修复外审仍 PENDING。

静态反例已转为实际测试：在第一个真实 review 的同步事务 work 回调返回前排入第二次相同请求，第二请求在第一请求 release 前通过初始可用性检查，随后真实 verifier release 观察器报清理异常，第二请求仍从原 ledger 返回成功。测试仅调度微任务并通过原 Authority/FixedWorkflow/SQLite/实际 SOURCE_ONLY 证明；不返回伪造 Approval/事实。

real034 旧行为实际1FAIL（第二请求 error undefined/成功返回）；real035 修复后1PASS。CreatedRunAuthority 现在在首次事务回调、首次 await 之后、fast replay 回调与其 await 之后、实际 acquire 之后且 finally 保护范围内、第二次事务回调与其 await 之后均重新检查实例可用性。后取得 proof 的拒绝路径仍 finally 释放。没有新幂等/批准/状态机。

real036 当前两文件68/68PASS：authority36、workflow32，无skip；包含前述 overlap、实际 source adoption 和新快照来源检查。typecheck42 exit0；全部输入扫描无变更，原失败日志保留。记录 Node1893434 当前已消失属于 MAIN 当前观察，不证明全机或历史所有进程均不存在。

专项恢复的详细设计 D10_RECOVERY_IMPLEMENTATION_PLAN.md 同本候选冻结，但仍仅设计，全部 RCV-D10 业务证据 NOT_RUN；不得据此开生产采用入口。D10 服务/快照分支独立复核另行进行，不把本窗口修复当 A 通过。
