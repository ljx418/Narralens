# E1 第三次返工：MAIN 根因接管

当前输入：cfadc136c29b8d5c5cbc2911f01dd09d4916401b。状态：只读诊断与接管准备；尚待原 writer 实际停写及差异/进程交接确认，不在 lane 并发写。

## 已确认问题

1. RevisionStore.withCreatedSourceCommitScope(projectId, transactionId, work) 是公开签发入口，任意名字可进入真实 atomic，未通过既定 closed commit 的持久事实、批准、发布证明校验。模块私有 WeakMap 不能修复错误签发权。
2. ProductSqliteRepository.joinCreatedSourceCommit 将 scope 传给通用 ProductTransaction，未约束每个读写 key/scope/value/幂等/event 必须属于该 project 和 transaction，不能仅校验连接相同。
3. 外层 work 返回 thenable 未在提交前拒绝；内层 repository 的同步检查不能替代所有外层调用路径。
4. 该候选尚没有合同固定的 commitPreparedCreatedSource closed 入口。不能用额外公共 scope helper 冒充它已实现。

## 修复边界

由 MAIN 在独立 integration 工作目录实现，使用明确冻结输入并保留原候选及用户 dirty。真正的 scope 只在 closed commit 读取/验证实际不可变事实、批准与 publisher 所有者证明后私有创建，不另导出可签发 API。scope 绑定 store/DB/project/transaction，同步失效，拒绝任意名字、跨项目、过期、嵌套、thenable；所有失败 poison 并整体回滚，即使内部 catch。

必须保留原 legacy/adopt/history 行为与 joinTaskTransaction。真实 publication journal、backup、目标 source/proof 与同库 snapshot/fact/revision/approval/impact/step/outbox/idempotency 的完整关联仍按 L02 实现，不能只把 helper 改成 private 就宣称完整提交通过。

## 额外需要核对的实际源码关系

publisher 当前 createdSourceTreeDigest 使用自行定义的文件列表 SHA256，而项目 author/target source 使用 SourceDigestV1。需要真实源码和 fixture 证明二者关系，禁止将任意树摘要冒充项目 source_digest。Publisher.verify 当前为异步树读取，尚不能当 L02 最终同步持有文件身份的证明。以上应纳入同一接管范围核对，避免修掉签发后再返工。

## 接管触发与消息

领域负责人 escalation msg_c6d053fcb551；MAIN 接受并要求实际 writer fence msg_9c7401ef3154。未确认停写前只做不可变对象读取，不 reset/stash、不跨目录抢 index、不宣称修复已完成。

## 实际接管后新增根因

已收到实际 STOP ACK msg_11b356df322e，MAIN 导入9个冻结候选文件，原 lane 不变。初始实现已去掉公共 scope 签发方法、补外层 thenable 拒绝和仓储逐操作 project 约束；仍未完成 closed commit，未运行最终验收。

发现 created_source_fact 表名碰撞：R1 ProjectCreationStore 的既有表是 project_id/snapshot_id/fact_json/fact_sha256，承载后续 Context/task/render 所需完整几何事实。候选同名表改为 transaction/approval/source 等溯源结构，构造时 GLOB 会撞上原表并拒绝。MAIN 已将新增溯源表改为 created_adopted_source_fact，改为精确逐表 schema 检查；原 R1 表未改。完整 closed commit 必须在同一事务插入或核对新 snapshot 的原几何事实及独立采用溯源，不能只改表名就宣布完成。

当前 MAIN 有未提交实施修改，故暂不作为消费候选；下一步实现完整持久事实/发布证明衔接和真实旧库共存、权限及事务回滚测试。


## MAIN 真实验证续接（2026-11-12）

- real-002: exit 1，准备 worker 已真实运行；发现 impact 把 engine_upstream_sha 错当64位SHA256。完整40位Git SHA本应合法；MAIN修复impact及D09校验，新增64位与缩写负向，保留原错误向量副本。
- real-003: exit 1，新测试先插入 prepared_authorization 再建立 transaction，真实SQLite外键拒绝。调整夹具遵守真实先后关系，不放宽DDL。
- real-004: exit 1，publisher误把已排序roots直接交给SourceDigestV1，改变entry角色。修复为明确film.html入口，snapshot使用同一geometry roots。
- 修订D09 Python独立实现11向量通过；以上均只证明具体模块进展，不宣称R2或A验收通过。real-005正在实际验证，结论以其result.json为准。
- PRODUCT超过两次证据摘要错误由MAIN接管；从冻结e6bdb3d tree计算索引，见early-candidate-review/product-evidence-correction-main.json。错误摘要、历史PID未知、占位时间、越权Host执行记录均保留且明确更正。不得用文件hash证明日志叙述真实。


## E1 后续存储接线修复（2026-11-12）

MAIN在8f35330后发现CreatedSourceImpactStore.create自己BEGIN/COMMIT，不能与服务幂等响应组成同一个外层Host事务。已增加只允许真实外层SQLite事务调用的insertInTransaction，原create仍自行原子提交兼容旧调用。5个真实内存SQLite测试证明无外层拒绝、最终异常全回滚、真实幂等键冲突不留impact、成功三记录同提交、原入口事务结束。首次测试另抓出read丢impact_hash及初次/重放数组顺序不一致，已修；失败impact-atomic-01保留，impact-atomic-02 5/5，typecheck-07 exit0。

限制：尚未将created-source-change-service真实接入，因此不能把存储方法通过宣称为change.prepare整链通过。服务仍须从完成Job读取target source digest，而不是mapping.source_digest(base)；真正purpose=impact proof保留至同步最终guard，原工程closure/选区/权利/Run/grant/前序gate/当前review全复核，然后同Host事务插impact+幂等响应。E5公共窄门真实reader已向BRIDGE请求，避免另写同义授权规则。

重复证据摘要错误的MAIN根修复：新增tools/agent-driven/collect-frozen-evidence-index.py，仅从完整commit的regular tracked git blobs机械生成路径/长度/SHA256索引，明确不证明叙述、历史PID、执行、隔离或门禁。对PRODUCT e6bdb3d冻结21文件实际运行通过；不读CLI配置/环境/媒体/working files。
