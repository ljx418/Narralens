# 同库数据、迁移与恢复设计

## 1. 唯一事实边界

SQL是目标草案，S0不运行生产DB。MAIN在RevisionStore同一个连接迁移；不创建新Host、新SQLite事实库或第二timeline。已有project_state、snapshot、active_commit、engine_binding、project_transaction、job/event/outbox仍权威。ad_project_origin只登记新建origin，migration记录保留原义。ad_command只做应用命令幂等与保留身份，不替代project_transaction提交状态机。ad_workflow_node不保存Job状态，状态从job与版本输入投影；UI自己不能持久记成功。outbox直接保留ad.* topic的事实事件，不另造递增event表。

## 2. 表和原子边界

migration.sql列出12个新增表、索引、CHECK/FK和不可变触发器。应用层必须以schema检查JSON内容，SQLite json_valid只检查语法。artifact/head更新需CAS，不用MAX+1无锁竞态。intake head与version追加、确认失效、outbox在同一IMMEDIATE事务。命令key、保留project_id与job创建同一事务，响应丢失重放读取同一job，不建孤儿任务。job.kind沿用snapshot_publish/render；子类型与主体归属来自服务端命令，不接受客户端随意payload。

ad_project_origin只在新工程发布对应project_transaction committed时同事务插入，并核对snapshot/descriptor/binding/active_commit；不先写假origin让Resolver误判可读。一般ProjectResolver分created/migrated两条来源，均汇入同一EngineProjection，不能编造terminal migration。旧fixture保持可读，新增生产项目目录来自可信supervisor配置。

审批的bound_facts_json固定project/base/control/source/selection/materialization/plan/hash/target/rights与本地执行范围，expiry在服务端now>=expiry拒。Approve route必须读取当前impact，不能信任客户端省略的事实。impact唯一权威是既有行；ad_approval的consume必须与core commit同一IMMEDIATE事务。prepared后恢复读取不可变授权事实，不能在重启时重新要求已过期的用户token从而锁死已准备事务；也不能因此允许新的命令复用过期授权。

## 3. 迁移与兼容

A开工时MAIN提供schema迁移ID ad_s0_a1与本包contract manifest SHA，备份采用既有同目录VACUUM INTO并SHA256校验、旧库留存；不以复制正在写的SQLite文件当安全备份。BEGIN IMMEDIATE建表/索引/trigger并写migration row；重复启动只校验精确版本/hash，不篡改未知schema到“看似完成”。所有旧表行数/主键/关键字段/receipt/hash前后相同。旧job.kind CHECK不拓宽；全新库与真实旧DDL必须分别验证。库内DDL失败则rollback、旧库可重开；DDL已生效但feature off时新增数据保留，只读可用，禁止drop表倒迁移。

SQL草案可幂等DDL不代表生产migration校验完整；verify-sql.py仅证明隔离旧DDL摘录+新增约束与rollback，不代替真实RevisionStore全量重开/故障试验。测试应从旧冻结DDL/真实备份建库，禁止用已迁移构造函数生成“旧库”导致假绿。

## 4. 创建/采用恢复矩阵（A必须真实执行）

| 边界 | 恢复要求 | 必查不变量 |
|---|---|---|
| 命令键/Job落盘前后 | 同键重试找到唯一command+job与保留project_id | 无重复、无半响应 |
| stage写入中/校验前后 | 丢弃仅自有未完成staging或重试；不影响旧项目 | stage独立UUID，不删别人的临时文件 |
| snapshot完成/尚未prepared | 快照不可变；无active发布；取消不采用 | source/pointer/revision不变 |
| prepared / source发布中 | 由既有journal唯一恢复，终态committed/可重试/attention | 不另开第二commit，锁/许可/授权事实可证 |
| 元数据/源已发布、响应前 | 原命令返回原project/job/snapshot | initial revision仍0；无假migration |
| artifact保存/输出返回前 | 幂等重放同版本 | 不重复创建版本/事件 |
| render lease丢失/取消/Host关闭 | 续租CAS、重排或隔离，关闭前停心跳并await有界收敛 | 晚到不采用、不触已关DB；超时不能说清理完成 |
| impact/approval consume中断 | 单事务要么全未写要么全commit | 成功+1失败+0；恢复无重复outbox |
| SSE断线/游标过期 | 同一scope回放或410重同步 | 无漏事件，无缓存绿灯 |

需至少一组真实进程kill/restart测试，不能只抛异常；停止只操作本次实例PID与profile。永久attention仅确认漂移/不可恢复事实，ENOMEM/EIO等没读到不能算读到不同。资源错误重试同job、同幂等范围，失败日志原样保留；不通过加长轮询掩盖worker活性问题。

## 5. 回退与出门

关闭新agent入口、MCP注册与新UI挂载，新数据/资产/快照保留；旧M5入口与旧工程恢复原行为。已创建项目仍应可读与受控导出，不靠删除origin回退。恢复旧内容走新revision受控restore，禁止手改pointer、删除snapshot或git reset。若旧binary不认识新origin，它不获得该项目写权限，不能直接用旧binary写新项目。

S0批准冻结的是方案与具体schema字节，不是上述恢复已运行。A轮门要求真实原Host/上游/媒体完整实现并验证，再由用户确认短片结果。

## 6. MAIN必须改动的真实提交接缝

既有RevisionStore.commitAdoption/commitHistoryRestore各自BEGIN IMMEDIATE；不能从外层开启事务再调用，也不能提前单独consume approval。MAIN为内部提交增加可选的PreparedAuthorizationRef {approval_id,facts_sha256}，仅production新应用服务允许要求该参数；旧legacy-test路径保持其冻结行为。prepare阶段在同连接既有project_transaction达到prepared的事务内写ad_prepared_authorization（immutable facts完整JSON+hash）。提交方法自己的唯一BEGIN IMMEDIATE中，先读该ref与fact，逐项核对项目/impact/plan/目标/授权范围，然后同一事务CAS active→consumed并写consumed_transaction_id=当前tx，接原有impact消费/metadata/outbox；任一失败整事务rollback。恢复是读取既有prepared fact继续原tx，不再创建批准或延长expiry。过期只阻止新prepare，不反悔已经合法prepared的事实。必须测试commit内部consume前后crash、行数0、重复恢复、拒绝改事实与回滚无副作用。

空created工程不能复用要求migration_id且frame_count>0的旧projection_fact。MAIN新增ad_created_projection（同库、immutable snapshot身份/帧数/fps/闭包摘要），CreatedProjectionService以origin+committed快照重建Host-only roots，再用固定上游parse原生clip；无第二timeline。空frame_count=0只供初始化上下文/工作台，render与交付必须422拒；首个正式组装必须实际原生可编辑且>0。若固定上游不能重开空film，MAIN应在CP-A0探针改为已确认storyboard首次初始化的独立版本方案并走ADR，不能默默塞固定三镜。该探针未执行，保留明确风险。
