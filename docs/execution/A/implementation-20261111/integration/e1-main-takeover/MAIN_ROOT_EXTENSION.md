# MAIN 根实现扩展记录

用户已批准MAIN在同阶段超过两次返工后直接接管根因。根9文件及created-source-change-service仍由MAIN独占。为复用真实文件身份校验和解除虚构目标事实，MAIN新增以下内部实体；不发放其他lane越权，不注册新工具/路由/JobKind。

|代码实体|责任与边界|状态|
|---|---|---|
|src/host/agent-driven/retained-source-tree.ts|从publisher原实现抽出的FD/路径/闭包守卫；跨rename继续保留原inode，不能用同字节新inode重新建立信任|4个真实本地文件系统测试通过；非媒体/整链验收|
|src/host/agent-driven/created-source-facts-reader.ts|从真实同DB完成SOURCE_ONLY Job、prepared映射、registry、原author、固定上游及purpose=impact proof生成opaque私有token；保留原FD到最终同步检查；目标digest/snapshot来自prepared事实，非base|已编码、typecheck11通过；真实Host测试待资源|
|tests/agent-driven/integration/retained-source-tree.test.ts|原目录跟踪、同字节换文件/换整目录、闭包新增与释放后拒绝|已运行4例|

准备顺序仍严格按原冻结D03/D04：真实准备成功且step waiting_user→窄change.prepare/impact→将该真实impact纳入唯一ReviewPackage→可信审核/限定Approval→受控采用。不得要求impact前先存在已发布ReviewPackage，不伪造临时包/门/第二批准。当前BRIDGE E5要求已发布review会造成循环，MAIN已要求按原冻结纠正，不是扩张批准范围。

当前没有生产composition/能力准入；事实reader不写source、snapshot、revision、Job状态或Approval。它不能替代共同execution-guard、最终文件/许可/Run/锁复核或受控提交。MAIN服务接线等待真实E5接口冻结后继续。重型资源仍MEDIA，未依据单次cwd空列表擅自释放。
