# PROC-0 rev3 独立合同复核

**PLAN_READY。R2-01 在设计层闭合。** 本轮复核范围为合同 §6.5、对应计划与案例、票据形状及 PROC0-13 静态样例。

最终 MAIN 票按路径、文件 SHA-256、phase、recorded_source 和 protected_inputs 指定 L1、L3 票。两份阶段文件的实算摘要分别匹配最终票，完整 packet 的最终票引用也匹配实际文件。外部 CLI 提供最终票路径与预期摘要，packet 无权自行增加历史票。

| PROC0-13 必需证据 | 阶段票与命令 | 内层退出 | 附加要求 |
|---|---|---:|---|
| L1_DIRECT | L1 / direct | 0 | 原 recorder 直接调用的旁证 |
| L3_SUCCESS | L3 / helper0 | 0 | 绑定成功运行的 capture 和 sidecar |
| L3_EXPECTED_FAILURE | L3 / helper1 | 1 | 指定断言 TOOL_HELPER_EXPECTED_FAILURE、清理证据及对应运行的失败凭据 |

完整样例逐槽对应阶段票的三个已分配 run_id 和 basename。合同要求每槽恰好一次，L3 另行预留的 example-unused-reserve-002 未列为必需证据。五个反例分别删除三个槽之一、在失败槽复用成功运行、在成功槽引用源码相同但未经批准的阶段票。字段差异与预期拒绝原因逐项吻合。

RELEASE_SHAPE 的单阶段票使用同一 required_evidence 结构。CASES 保留 PROC0-01 至 PROC0-16；单案例样例只说明票据形状。原17项、ISO01–18、R6 C06–09、R7、R8 及 NEXT 停点沿用原计划。阶段样例省略真实签发字段，源码、capture 和 sidecar 仍为占位。metadata 准入、工具行为与产品运行均未验证。MAIN 可据此准备精确实施票；实际 helper 仍须 L2 后另票。
