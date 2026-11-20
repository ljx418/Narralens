# MAIN 根实现扩展记录

用户已批准MAIN在同阶段超过两次返工后直接接管根因。根9文件及created-source-change-service仍由MAIN独占。为复用真实文件身份校验和解除虚构目标事实，MAIN新增以下内部实体；不发放其他lane越权，不注册新工具/路由/JobKind。

|代码实体|责任与边界|状态|
|---|---|---|
|src/host/agent-driven/retained-source-tree.ts|从publisher原实现抽出的FD/路径/闭包守卫；跨rename继续保留原inode，不能用同字节新inode重新建立信任|4个真实本地文件系统测试通过；非媒体/整链验收|
|src/host/agent-driven/created-source-facts-reader.ts|从真实同DB完成SOURCE_ONLY Job、prepared映射、registry、原author、固定上游及purpose=impact proof生成opaque私有token；保留原FD到最终同步检查；目标digest/snapshot来自prepared事实，非base|已编码、typecheck11通过；真实Host测试待资源|
|tests/agent-driven/integration/retained-source-tree.test.ts|原目录跟踪、同字节换文件/换整目录、闭包新增与释放后拒绝|已运行4例|

准备顺序仍严格按原冻结D03/D04：真实准备成功且step waiting_user→窄change.prepare/impact→将该真实impact纳入唯一ReviewPackage→可信审核/限定Approval→受控采用。不得要求impact前先存在已发布ReviewPackage，不伪造临时包/门/第二批准。当前BRIDGE E5要求已发布review会造成循环，MAIN已要求按原冻结纠正，不是扩张批准范围。

当前没有生产composition/能力准入；事实reader不写source、snapshot、revision、Job状态或Approval。它不能替代共同execution-guard、最终文件/许可/Run/锁复核或受控提交。MAIN服务接线等待真实E5接口冻结后继续。重型资源仍MEDIA，未依据单次cwd空列表擅自释放。

### Final-commit input read closure (2026-11-12)
MAIN final commit must re-read current bootstrap-bound intake head, current version, question heads/versions and answer heads/versions to recompute creativeInputClosure in the SAME project transaction. The closed repository scope now permits GET/LIST only for these six intake collections, only with the exact intake_id obtained from ProjectCreationStore.forProject(scope.project_id). It does not allow a global query, another intake, intake writes/CAS, intake event scope, another project or another transaction's prepared authorization. Guard errors poison the original outer scope even if swallowed. This is a required readonly dependency of final input freshness, not a second intake authority. Common approved_prepared_adoption gate reads current predecessor gates after final FD verification; FixedWorkflowService.recordStepAttemptInTransaction remains sole step/checkpoint/event writer. Independent review pending.
Initial real011 failed because original project-only scope rejected the legitimate intake read; two negative gate tests also threw this unrelated error, so they are NOT gate evidence. They now assert gate-specific failure. Failure capture preserved.

### N3 publication cleanup implementation ownership
MAIN owns publication-cleanup.ts (new internal runtime bookkeeping), created-source-publisher.ts and N3 changes to retained-source-tree.ts / prepared-draft-verifier.ts plus exact unit/integration tests. BRIDGE D09 scope remains own authority/workflow/type paths and readonly frozen dependencies; its incoming implementation manifest must exclude these MAIN files so current N3 changes are not overwritten by old5d imports. No public wire/state/JobKind/EnginePort change. Cleanup error remains existing ProductError CAPABILITY_UNAVAILABLE503 with nonretryable/reconciliation and non-enumerable diagnostic causes. Uncertain prior native-close faults stay recorded even after a later no-op; only original resource object operations can be retried, never naked FD numbers. Actual published proof tests and independent review remain pending.

### MAIN D10 service orchestration extension
MAIN implements src/host/agent-driven/created-source-adoption-service.ts and exact actual tests in created-run-authority.test.ts. It composes original Coordinator.controlledWrite queue, actual reader/preflight/common approved_prepared_adoption guard, immutable adoption fact + original prepared_authorization, original transaction phases, actual Publisher and RevisionStore closed commit. No schema/wire/JobKind/second Approval/second timeline. Preserve legacy routes; new production ingress remains disabled until dedicated recovery precedes generic edit recovery and selection authority/native composition is correctly assembled. Exact service tests are module+actualHost fixture evidence, not a production route/preview/person acceptance. Main owns public composition next; lanes must not overwrite this service or Reader fixes.
