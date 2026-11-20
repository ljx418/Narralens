# PROC-0 第二轮独立合同复核

**REQUEST_CHANGES**。仅余一项合同缺口 R2-01，涉及 L4 如何使用外部 MAIN 票判定一个 case 的多份证据全部齐备。W 的实际 HEAD 与 BASELINE 相符；rev2 保留 PROC0-01 至 PROC0-16，全部标记 NOT_RUN。

## R2-01　用 PROC0-13 核对最终交还格式

§6.2 要求 PROC0-13 同时交 L1 direct、L3 helper 成功退出 0、L3 helper 按指定原因退出 1 的证据。§6.1 和 RELEASE_SHAPE 给每个 case 一组允许的 command_ids，却只有一个 level、expected_inner_exit 和 expected_failure_requirement。即使两个 L3 capture 都已分配，分配表还可包含为重试预留的 basename，无法据此区分「两份都必交」与「可任选一次合格捕获」。要求全部允许 capture 也会误拒未动用的预留名。

最终 checker 的外部入口只接收一份 FINAL_METADATA 票，过去的两份 sidecar 各自绑定 L1/L3 的票据摘要。§6.2 要求核每份阶段票，样例未指定由最终 MAIN 票批准哪些历史摘要。若只跟随 packet 提供的历史票，即使源码相同，证据的授权来源仍无法从外部入口验证。

请合并补一份可直接照写的 **PROC0-13 最终票和 packet 静态样例**。在最终票固定获准阶段票的路径、SHA、phase、源码绑定；在同一原 case 下列出全部必需证据项。每项分别绑定层次、阶段票、命令与获准 capture/run、内层退出和失败凭据要求。把三份齐全列为正例，把漏任一份、用成功 capture 顶替指定失败、引用同源但未经最终票批准的历史票列为拒绝例。无需新增 case ID 或运行 helper。

## 其余首轮意见

- **G1 单阶段入口**已明确。runner/checker 取外部路径与 SHA，逐 case 核命令、层次、分配的 capture 和原始记录；共享 suite 需 MAIN 明示。
- **G2 目录与依赖**已闭合。原六件套只在原 recorder 目录新增获准 basename。L1 直接走原 recorder FIRST，L2 审源码，L3 待另票实证，L4 合并。L2 可在真实 helper 尚未运行时完成源码审查。
- **G3 状态与责任**已闭合。短锁内提交 STARTING，等待在锁外。同一 Popen 返回后的身份读取或落盘异常仍由原 owner wait。state 单一权威，pending_audit 阻止重入；取消与终局都在锁内重读合并。原租约结束、旧 pin 阻塞、新票 rebind 的顺序明确。
- **G4 退出码**已闭合。原件完整时才按 inner & 255 核对正常结束的 recorder；原件缺损或 recorder 自身被信号结束时保存实际 outer wait，资源状态另判。-15/241 仅用于 mock。

本轮只做静态文档复核。原 review 与产品证据保留，未运行测试、helper 或产品。本结论不授予实施或内核运行许可。
