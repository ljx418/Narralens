# D10 MAIN 修复候选独立复审正式票

冻结 HEAD：13496366d9c0a2ff3aec5efa4798ce6b5f1c9818
真实只读 cwd：/mnt/c/workspace/videoworkline/Narralens-agents/main-integration
branch：agent-driven/main-a-integration
AGENTS.md 为唯一受保护的原未提交变动，不可改/恢复/提交。所有 src/tests/contracts/tools/config/index/HEAD 均冻结直至审查命令真实结束并明确交回。

先读当前 MAIN AGENTS、首轮独立报告 R2/d10-business-independent-review/REVIEW.md、其原探针、MAIN_D10_REPAIR_REPORT.md/VERIFICATION.json（在 MAIN docs/execution/A/implementation-20261111/integration/e1-main-takeover）。MAIN 本轮参与实现，不能自签，你未参与此两路径修复。

完整候选四路径 SHA256：
{
  "src/host/agent-driven/created-source-recovery.ts": "e90f63b07e1659999a0ec8916b35fb42ce5c94875c4a73a22894ecd63105a0b7",
  "src/host/agent-driven/created-source-adoption-service.ts": "9e140f5887b6e8ad5f406517504043ade1eaaa9df8978fee8a2d99d82c46ddb7",
  "tests/agent-driven/integration/created-source-recovery.test.ts": "eda8cbbc0ba78368db5893def66b956888df97c3c8e65b3a59099b22ff077e13",
  "tests/agent-driven/integration/created-source-adoption.test.ts": "04eb25fa45efede7d101878d0c603d96b8947f377c49896dc3422a74ed644548"
}

MAIN 全 recovery31PASS/full tsc0，capture full006/type007 输入与冻结逐项相同。原 old-lifecycle001 三真实断言失败、old-authorization002 真实生产 fixture 错中止；type004 是测试类型声明错误，不能计为业务反例，均保留。原独立探针未改，MAIN 运行 exit0、两 defect=false。不要覆盖原独立目录。

本票明确授予你唯一重型槽 R2-D10-MAIN-ROUND2-REVIEW-REAL-001。唯一重型 argv：
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-source-recovery.test.ts -t "MAIN lifecycle|MAIN authorization|MAIN cleanup|commits the original published transaction exactly once|resource cleanup failed"
预计9例；记实际数，不把新7/继承2与全部业务混同。另允许完整 tsc、原始 lifecycle-probe.mts（保持原字节），均记录完整 argv/日志/exit/hash。没有必要重跑已不受影响50项。

报告和新诊断仅写 canonical /mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/main-d10-independent-round2/（不要写 MAIN 源码树；不创建/复制项目/node_modules）。保存冻结SHA/4path/AGENTS/索引以及所读原证据前后不变。无 source/测试/工具/配置/index/branch 写入、无新实现者、无重型扩围/浏览器/build/full suite/网络/provider/付费/J/安装/配置。若发现新问题，输出具体因果与直接证据；非零可作为负向证据，不可自动重试调绿。全部自有命令结束后明确交回重型槽和唯一 writer，用 worker_done 返回 bounded ACCEPT 或 REQUEST_CHANGES。不能宣称 Host接线、真实SIGKILL/合法后继、NativeAck、影片/A验收。

审查细则沿下方冻结前草案；其中草案“尚未派发/未授”由本正式票的SHA与grant覆盖，其余不变：

# D10 MAIN 修复后独立复审票（冻结前草案，尚未派发）

原候选 eba0d42 的独立审查 REQUEST_CHANGES（MAJOR-01/02、MINOR-01），报告与探针保留在 R2/d10-business-independent-review。MAIN 本轮亲自实现两路径：created-source-recovery.ts 与其 integration test，未修改原 adoption 实现、合同、DDL、Coordinator、Publisher 或 RecoveryFiles。最终冻结 SHA 与四路径摘要将在命令全部真实结束后补入正式票，本草案不是资源 grant。

必审：
- 两条早期 abort 出口、构造失败、Publisher/lease 清理都立即 sticky 记录同项目不确定性，聚合保留每个错误。真实终态与主操作错误不能被 finally 覆盖。close 全 attempt 且不得假称资源全部清理。
- recoverOnStart 整轮在 callback 前受理登记，close 后只拒绝新公开调用，已受理扫描内部继续并被 close 等待，不提前关闭资源。DB 决策/有限进展/排序不变。
- adoption 缺失仍独立查既存 prepared authorization，与 input project/run/approval 匹配；不可变 impact plan hash 与原 approval 的 base/control/execution 字段验证 surviving authorization。真正无授权早期 branch 与合法匹配 branch 不可误封；损坏请求必须在 owner/author proof 之前持久 attention，其余 authority/文件不变。

MAIN 留存旧实现三 lifecycle 真断言失败与真实 producer 授权不符仍被 abort 的失败；新探针保持审查者原字节，不能改诊断使其变绿。fixture/类型声明错误独立保存，不计作业务反例。

最终冻结后资源候选：只在 MAIN 原 cwd 运行原 recovery 文件 -t "MAIN lifecycle|MAIN authorization|MAIN cleanup|commits the original published transaction exactly once|resource cleanup failed"。预计9例，以实际命中为准；可重跑完整 tsc 和原只读生命周期探针。无 build/浏览器/全量/网络/provider/J/付费/新worktree/源及索引改动。未授前不执行重型命令。

独立报告仅写新的 canonical R2/main-d10-independent-round2，不覆盖首轮。保存 source/index/AGENTS 前后不变、真实 argv/stdout-stderr/exit/SHA256 与判断，全部自有验证终止后交回唯一 writer 与资源槽。可给模块 bounded ACCEPT/REQUEST_CHANGES，不能签生产 Host/SIGKILL/合法后继/NativeAck/影片/A 人验。
