# BRIDGE Codex：生产恢复接线只读架构审查

本任务是MAIN已批准A阶段内的架构/验收设计，不是新的生产实现release。你原BRIDGE D10监督任务已交回，当前只做此任务，无Claude/子Agent/实现者派生，无任何测试/Host/ffmpeg/browser/网络/provider/付费/J/安装/配置操作。

实际源基线：MAIN /mnt/c/workspace/videoworkline/Narralens-agents/main-integration，branch agent-driven/main-a-integration，HEAD abf34c9a04ae31639ce9ea2180fda32458413a17。独立D10模块审查ctx_5ac0367f389c同时只读运行并占唯一重型槽。MAIN保持所有src/tests/contracts/tools/config/index/HEAD冻结。你的BRIDGE checkout仍旧664f178，不用它冒充最新源、不checkout/reset/stash/cherry-pick/改索引/复制项目/node_modules、不触碰现有用户dirty/保护AGENTS。

阅读：MAIN AGENTS；canonical docs/execution/A/relaunch-20261111 的目标/实施与验收原约束；R2/D10_RECOVERY_IMPLEMENTATION_PLAN.md、D10_MULTI_PREPARED_BOUNDARY.md、NATIVE_EXPECTED_READER_INTEGRATION_CHECKLIST.md；R2/main-d10-full-execution-20261112/COMPOSITION_NEXT_TICKETS.md、R2/main-d10-repair-20261112/HOST_NEXT_OBSERVED.md。源只读定位当前 server.ts、CreationApplication、ProjectCoordinator、ControlledRecoveryScheduler、CreatedSourceRecovery/AdoptionService、CreatedTaskApplication、原运行根锁/launcher与native-observation服务、实际相关test/helpers。

交付目标：给MAIN一份可直接用于精确实现release的0–1层接线审查，具体代码实体/输入输出/所有权/生命周期/失败门/真实测试，不能空泛架构。

必审问题：
1. 原Host启动恢复顺序与一份实际DB有限初始集合三族scheduler；legacy入口与agent入口都如何处理相同DB上的已知族，保持未知generic。
2. generic不得抢created/history/adoption unresolved/attention/recovering。提出确切最小内部接缝，证明不对外开放ignore/force，不放松原recoveryGate/九字段closedcommit。分类是owner选择而不是写权限；损坏known请求保全attention，unknown仍generic。
3. 原runtime FD9/flock排它、写入入口关闭与同根同库，真实SIGKILL后旧进程/子进程终止证据以及租约/恢复生命周期；不能异常抛出冒充进程丢失。
4. 恢复与正常adoption/Publisher共享真实selection authority。目前生产未构造NativeObservationService，fixture的固定/可变端口不是真生产；不能从plan回填current或硬编码0。与NativeExpected/NativeAck接线的循环依赖如何拆成明确前后步骤；无session与失效session分别处理。
5. CreationApplication内真实tasks/assets/verifier实例同一性、created/adoption private roots在重开后确定、注册caps缺失如何保留每项目gate而不让全部健康项目停摆。
6. close等待全部被受理恢复/扫描，先停止新入口、后释放其依赖tasks/assets/selection/DB；startup失败也清理，不吞主要异常/cleanup原因。
7. 已有真实生产change.prepare/change.apply/review媒体binding producer尚未装配，区分恢复接线和用户可实际采用的剩余交付，不能仅方法调用自测后宣布端到端可用。
8. 多项目/相同timestamp/三族相容链真实可达前态、strict closedcommit第二prepared拒绝矛盾的解法条件：保留原裁决，若需核心改动给确切范围和先行反例，不用永远deferred降级RD05。

只写新canonical目录 /mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/host-recovery-composition-review/，四文件以内：REVIEW.md、CODE_MAP.json、ACCEPTANCE_CASES.md、RELEASE_RECOMMENDATION.json。源/证据只读，给实际SHA及涉及源blob/hash、行号和因果。列完整建议release文件白名单、应保持不动项、接口签名草案（明确非现有接口）、旧门保留、按真实过程的case输入/步骤/期望/证据/命令/资源需求。所有未跑测试标NOT_RUN；不强行判PASS，不自签实施准入/影片/A人验。

完成实际只读核查和文档后worker_done回ROOT，报告设计可执行性与必须先关闭的具体缺口；你的任务成功指完整设计审查交付，不是代码/阶段通过。全程0重型grant，源/index唯一writer不交给你，不需要请求运行测试。
