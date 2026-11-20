# D10 完整执行授权修复独立复核

冻结 abf34c9a04ae31639ce9ea2180fda32458413a17，真实只读 MAIN cwd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration，branch agent-driven/main-a-integration，唯一dirty仍为保护的AGENTS.md，不可修改/恢复/提交。所有src/tests/contracts/tools/config/index/HEAD冻结直至你明确交回。你未参与实现，MAIN实现不能自签；不派生实现者。

先读当前MAIN AGENTS、你本人 R2/main-d10-independent-round2/REVIEW.md、MAIN同目录 integration/e1-main-takeover/MAIN_D10_FULL_EXECUTION_REPORT.md 与 VERIFICATION.json。相对于1349636，源码仅新增两条canonicalDigest(input.execution) == canonicalDigest(plan.producer_execution)，分别覆盖存在adoption和无adoption但有surviving authorization。两条新真实producer测试先在1349636实际错误abort/2断言失败，再在修复版完整33PASS、full tsc0；旧源/失败/前三轮报告保持不变。

精确四路径hash：
{
  "src/host/agent-driven/created-source-recovery.ts": "392ffe1dcb64bfd3478287524996fc774e001d3b3ea8f61cae296a3e12289f97",
  "src/host/agent-driven/created-source-adoption-service.ts": "9e140f5887b6e8ad5f406517504043ade1eaaa9df8978fee8a2d99d82c46ddb7",
  "tests/agent-driven/integration/created-source-recovery.test.ts": "f4750e9fb5201434bfeab07197d7ce8edeb63b89824c9f730850f8bc262d9466",
  "tests/agent-driven/integration/created-source-adoption.test.ts": "04eb25fa45efede7d101878d0c603d96b8947f377c49896dc3422a74ed644548"
}

复核整个相关合法性继承行为与这次full execution共因是否闭环：不能只检查一个有效grant，不得从plan回填请求。adoption缺失和adoption重复execution被一并破坏都应在owner/author proof前持久attention、其它authority/文件身份保全；真正无auth早期分支和匹配surviving authorization对照保留。原清理/扫描关闭修复字节未变，不重复以次数跑无关50例。若确有新具体缺陷，给准确因果/反例与范围，不自签通过。

授予独占槽 R2-D10-FULL-EXECUTION-INDEPENDENT-REAL-001，唯一重型argv：
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-source-recovery.test.ts -t "MAIN full execution|MAIN authorization still permits|commits the original published transaction exactly once"
实际预期4例（2新负向+1匹配授权安全abort+1原committed/replay），以真实命中数为准。允许full tsc及原字节纯生命周期探针，但不要求重复上一轮已不受影响的门。不得修改任何原源/测试/工具/配置/索引或开新项目/node_modules，禁止full suite/build/浏览器/provider/网络/付费/J/安装/配置/重型扩围。

新独立证据只写canonical /mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/main-d10-independent-round3/，保留原两轮。记录冻结SHA、源/AGENTS/HEAD/索引/所读证据前后不变、实际argv/stdout-stderr/exit/logSHA；原probe脚本如运行逐字节放新证据目录，临时fixture/FD/自有进程及时清理。全部命令真实终止后只读交回重型槽及唯一writer，并worker_done报告明确bounded ACCEPT或REQUEST_CHANGES。

声明范围仍仅四路径模块；生产Host挂载/generic/scheduler、真实SIGKILL/合法后继、NativeAck/Studio/两影片及A人验均未完成，不能由本票关闭。这些后续完整目标仍按原审定包推进，不作降级。
