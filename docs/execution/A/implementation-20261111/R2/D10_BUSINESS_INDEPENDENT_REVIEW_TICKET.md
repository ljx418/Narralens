# D10 business recovery 独立冻结审查

目标：对 MAIN 冻结 eba0d42fc41d0c9c99e1ddf90364149d3a8d5880 做未参与实现的只读独立审查。你之前仅实现过独立 PRODUCT 审查，没有参与 D10 实现；不派生实现者或修改候选。

真实目标目录 /mnt/c/workspace/videoworkline/Narralens-agents/main-integration，branch agent-driven/main-a-integration。核对 HEAD 与四文件字节，MAIN AGENTS.md 有 MAIN 保护的未提交写入前检查点，不得恢复/修改它。无其他 source/index writer；MAIN 将保持源码、测试、工具、配置与Git索引冻结直到你的真实命令结束和只读交回。源源码无需存在于你自己 PRODUCT checkout，必须读/测上述 MAIN 原目录，不能复制工程或链接node_modules。

## 证据与阅读

先读MAIN AGENTS.md、冻结票 docs/execution/A/implementation-20261111/integration/e1-main-takeover/D10_CLAUDE_IMPLEMENTATION_TICKET.md 与 RELEASE.json（实际后缀文件名 D10_CLAUDE_IMPLEMENTATION_RELEASE.json），再读 canonical /mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/D10_MAIN_RULING_REQUEST_AND_DURABLE_RECOVERY.md 及 D10_MAIN_READONLY_IMPLEMENTATION_FINDINGS.json、D10_TEST_EVIDENCE_BOUNDARY_FINDING.json。

候选及报告 docs/parallel/lane-bridge/A-R2-20261112/D10-business/{IMPLEMENTATION_REPORT.md,PHASE_JOURNAL.md,MAIN_HANDOFF_VERIFICATION.json,candidate-v1..v3}。源码：created-source-recovery.ts、created-source-adoption-service.ts；测试：created-source-recovery.test.ts、created-source-adoption.test.ts，均在 src/host/agent-driven 和 tests/agent-driven/integration 对应目录。

独立审查整个新增业务服务及改动，不只看最后补丁。依赖实际 Coordinator/RevisionStore closed commit/Publisher/RecoveryFiles/RetainedSourceTree/身份和原日志只读核对。不要修改上述既有核心来调绿。

## 必审

1. 唯一created family/原状态机/队列/base/来源owner；严格 wrapper+原ApplyChange+hash+project/base/source/execution+已有adoption/authorization gate。损坏请求不读受控文件、不补偿不中止，只由原Coordinator持久attention，全部authority和文件保全。
2. 真正早期无fact/发表证据是独立分支，完整原author/committedbase/owner证明后才abort；发表缺fact保全attention。原prepared资源identity、journal、lease受私有producer约束，不能字符串/marker自签证明。
3. 合法published只能原closed commit一次，批准/所有gate/锁/最终expiry/source/rights/selection被实际重验。补偿必须原resourcelease/真实原closure/fsync，失败unknown不可伪造abort或attention。
4. attention落DB且projectgate可见；recoverOnStart真实DB进展、有限终止、保留attention/recovering unresolved；generic/Host/scheduler本票未接线，不可虚构。
5. 瞬时I/O/503/ENOMEM和cleanup未知保持defer，已证明漂移/缺失按操作语义分类；已取得retained所有权全attempt清理，失败sticky拒绝同项目后续决策，主错误/cleanup原因保留；关闭等待已受理工作后才释放DB相关资源。
6. 已committed严格匹配原key/digest/principal/correlation/transaction/Applied/snapshot/revision，缺损不假成功；不消费两次、不rollback已提交。当前synthetic pointer用例不是真合法后继，真实后继仍NOT_RUN。
7. 新测试能否证明其命名目标；异常注入/同进程业务调用不能冒充Host生产启动或SIGKILL。保留无断言变绿、假fixture、未触达边界的识别。

已知声明边界：新service未Host装配，RCV-D10-10与阶段业务闭环/真实SIGKILL/合法后继/A都NOT_RUN；closedcommit保留其它prepared拒绝，不因本票偷偷削弱，完整多族生产策略待MAIN接线。可给此模块 bounded ACCEPT/REQUEST_CHANGES，但不得给生产或A通过。确有新B/M直接列精确行和因果/最小复现；不要求重跑已证明且不受改动影响的50项只是追次数。

## 已独立观察的门

12组捕获全部原样保留：旧finaloldsel007的2项真实断言失败，finalrepairedsel0082PASS，repairedfull00924PASS，adoption01050PASS，tsc011exit0。最终三个成功捕获各616业务code/config输入与冻结候选逐个相同，原logSHA/exit一致。failed_setup001(FK)与004(lock enum)保留；v1曾同名覆盖但机械回退后与capture005原hash完全相同，v2/v3分存。Claude报告66files/11groups的旧计数由MAIN_HANDOFF_VERIFICATION更正为72files/12groups；其checkout/delete回退recipe不得执行。

## 允许验证与资源

只读源码/Git与完整tsc（禁止源码/测试/工具/配置/索引/分支写）。可在原MAIN目录使用既有解释器与固定上游、真实自有fixture。为避免重复全门负载，本票唯一预授重型命令是：

corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-source-recovery.test.ts -t "commits the original published transaction exactly once|reconstructs a missing published journal|marker-only request|published author bytes were tampered|receipt names another principal|resource cleanup failed"

命中应为6个真实文件/DB/诊断本地media用例，记录实际命中数/完整stdout-stderr/actual exit，不使用head/pipeexit冒称通过。先核对argv实际匹配测试名。此次只有你持单一重型槽，非其他Agent。不得build/浏览器/全量/网络/provider/付费/J/安装/配置/新worktree/共享可写root。如果发现需更多重型复现，先ask ROOT精确argv。不得变异原源码，新增只读最小探针只在你报告目录内，结束清理自有fixture/FD/子进程。

所有新增报告和日志仅写canonical /mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/d10-business-independent-review/。记录冻结SHA、命令、实际退出码、产物hash、源码/索引前后不变；报告中文，说明范围和NOT_RUN。完成全部命令后worker_done回ROOT，给明确独立结论及只读交回，不做实现/提交/自签人验。
