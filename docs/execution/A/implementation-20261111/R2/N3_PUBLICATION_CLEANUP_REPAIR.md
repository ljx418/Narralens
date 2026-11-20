# N3 发布器异常清理修复单（MAIN 接管，未实现）

真实现状：CreatedSourcePublisher 的 publishGuarded catch/finally、外层 held.close、release、close 均可能被第一个释放异常中断。release 先删 opaque token 和 issued 集合，故错误后缺少仍持有资源的清理记录；close 的 rejected promise 缓存也妨碍后续处理。RetainedSourceTree.close 和 PreparedDraftVerifier.dispose 已各自尝试所有底层 FD，但发生原生 close 错误后会标记 closed/清掉表，Publisher 不得因第二次 no-op 就推断上次不确定 FD 已确认关闭。

修复次序：
1. 在撤销 token 的同时先建立私有运行态清理记录，保留实际 guard、preparedProof 与其对象级 close/release 动作；不增加 DB 状态、公开 callback、授权能力或时间线。关闭失败令 issuer 不可用于任何后续 commit。
2. 每个资源动作独立 try/catch，始终尝试其他资源。保留主操作失败与所有清理失败，不能由 finally 覆盖前一个错误。外层 held、正常成功后的临时 stage guard、失败后的 original/blob/snapshot/author guards、verifier 都要覆盖。原备份和 journal 在任一 rename 后保留；不能把未知补偿伪装为完成。
3. close 等待既有 publish，再逐个处理所有 issued 和未完成清理记录；一个 proof 失败不能跳过其余 proof。允许后续 close 重试仍未完成的对象级动作，但不得盲重试已失去身份的原始 FD 编号（ABA 风险）。曾经的底层 close 不确定性必须保留并拒绝宣称清理成功，必要时以受控 runtime 重启收敛，而非把 idempotent no-op 当证据。
4. 同一关闭轮次共享 Promise；错误后的重试不能重新激活 proof。未经证明的清理状态持续可观察为失败/待协调，不能 self-sign Ready。

实际验收必须用真正 completed SOURCE_ONLY 及 publication proof（非伪造 WeakMap/token）：A verifier.release 在执行前失败一次仍关闭所有其他 guards、token 立即失效、失败记录可重试；B guard.close 首项失败仍尝试其余 guard/verifier；C publish fsync 主失败与清理失败同时发生均保留，原 author/base/revision/pointer/Approval/impact/outbox/idempotency 不动；D 成功 release/close 的已拥有 FD 回基线；E 并发 close 屏障及失败后的不可复活。故障注入只替换释放动作，不能替换真实 source/rights/proof 验证。已确认底层关闭但观察者抛错，与原生 close 身份未知要分别披露。测试清理不能全局吞异常，预期故障要在对应 case 内明确验收。

资源：BRIDGE 当前预约 D09 真 Host/本地 ffmpeg 矩阵，MAIN 可做无 Host/媒体的实现、单测和静态检查；N3 真实用例必须等单重型槽回执，不与其重叠。当前无 N3 实现/通过声明。
