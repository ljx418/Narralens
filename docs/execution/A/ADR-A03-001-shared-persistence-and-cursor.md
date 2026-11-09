# ADR A03-001：共享事务、精确记录映射与有界wire游标

状态：MAIN实施决定；A范围，不改变已批准wire/模型能力。原图E12共享数据、E13观测、G07、IT-A03、AD-T12/27/33适用。旧冻结报告不修改。本文件不是A03整体验收。

## 实现和证据

批准CP-A0 SQL原字节复制到contracts/agent-driven-a.migration.sql，Node迁移器校验固定SHA，在原RevisionStore.compose同一连接内，一次BEGIN IMMEDIATE提交DDL和schema回执。回执记录精确sqlite_schema指纹，拒绝不带回执的已有CP表、DDL/回执漂移；迁移中断回滚DDL。新增agent_driven_schema_receipt仅管理元数据，不是业务状态机。真实Node fresh/reopen/FK/不可变/错误注入等7个测试通过，日志main-schema；真进程kill与完整旧库升级仍须后续Host验收。

ProductSqliteRepository逐一映射PRODUCT closed collections到冻结cp_a0表，PK/范围/列白名单，JSON规范化；不存在通用KV替代事实库。head仅CAS，版本append-only，同key同事实重放、异事实冲突。版本/head/幂等/事件在同一原RevisionStore.atomic提交；禁止async、嵌套和逸出的transaction。既有operation_idempotency为唯一命令权威：preproject用principal:<已认证principal>命名空间（':'不符合真实project ID），project用原ID，operation_kind增加agent.v1:前缀；原response_json保存receipt+原响应。

真实SQLite适配7个测试通过，包括实际CreativeService重放、失败后版本/head/命令回执/outbox全部回滚。同次全局tsc仍有PRODUCT候选已知8项错误，完整日志product-sqlite-first保留；不能称组合编译通过。PRODUCT正在独立lane修复，MAIN不双写其服务。

## 游标格式与存储

冻结EventSnapshot.cursor继承ID上限64，而完整自含claims+HMAC token会超长；CursorRead允许较长opaque输入，不应让生产者违反消费者原合同。保留wire与HMAC-SHA256，MAIN采用61字符opaque持久句柄：c + 12随机bytes的16字符base64url + 下划线 + 完整HMAC的43字符base64url。固定首字母，满足两端schema。HMAC输入绑定nonce和完整canonical CursorClaims；不以裸watermark续传，不截短信任字段或MAC。

新增同连接agent_cursor_claim只保存transport签名收据，非工程/工作流事实；读快照可以记录该传输收据，但不增project/workflow revision、不写成功业务outbox。私钥由MAIN单独注入，不来自MCP/UI，不在DB或Git；测试固定key仅是公开fixture。真实key持久化/轮换与生产身份接线仍待实现验证。

DurableCursorCodec校验claim schema、签名、期限与key；BRIDGE观测投影必须另行核当前principal/project/filter/generation及所有同时提供的cursor。三条真实Node测试覆盖关闭重开、wire长度、签名/持久claims篡改、到期和key移除。未接Host/SSE，不能据此关闭A-EVENTS。保留窗与过期收据清理策略仍需在Host接线/运行恢复测试中确定，不把未实现GC称已完成。

## 责任与兼容

MAIN保留敏感7route的producer/注册/可信身份及批准权威；PRODUCT提供域算法，批准消费仍须同Coordinator最终commit。普通Agent relay只作内容决定。准备产物不写影片，业务完成、commit和native ack分开。

未改变80定义/31route、EnginePort七方法、单引擎/单timeline/旧Gate；无B模型/编排/稳定豁免。发生存储漂移时阻断新能力并保留原数据，不自动降级schema或重建工程；停用新路由即可回到旧入口，旧内容回退仍受控restore新revision。
