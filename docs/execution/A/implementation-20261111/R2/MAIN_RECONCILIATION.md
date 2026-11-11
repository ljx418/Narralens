# R2 当前代码复核与实施顺序约束

当前代码冻结：de086f32c48c44fb72d0212ef80365f1c786408c。当前仅领域详细任务准备，尚未释放R2产品文件；本轮只读核查，不捏造源码或未运行测试。源摘要和缺失实体见current-code-map.json。封存D01–D15及R1合同仍有效，不重写旧Gate。

|边界|当前源码事实|R2实施/验收约束|
|---|---|---|
|生产Run准入|CreatedRunFacts要求四真实描述符和readiness；CreationApplication当前未注入capabilities/readiness|仍保持不可用；不能传TestGrant/硬编码true或改四能力规则制造生产Run|
|准备媒体|完成SOURCE_ONLY的Task/Job/provider receipt及MEDIA read/adoption双purpose proof已有；安全preview已修复并独立限定PASS|复用真实同库prepared事实；成功Job不重新claim lease；read proof不得当adoption proof|
|准备映射/变更|ps_映射、prepared impact及created adopter/publisher在冻结源码缺失|沿D02/D09/D13新增created_*不可变事实，无state；impact沿旧唯一权威及受控schema升级；不同source_kind拒绝互认|
|共同守卫|GuardedEffect目前仅action/safe_control；普通可派发Run/attempt规则仍严格|新增两种Host-only窄effect需真实事实，不扩大普通waiting_user派发集合，不把成功Job改回running|
|批准摘要|FixedWorkflowService当前facts_digest仍为五字段摘要；CreatedRunAuthority有真实confirmation/session入口但未接prepared完整计划|prepared分支必须绑定唯一PreparedAdoptionPlan完整preimage/plan_sha；旧legacy行为保留；不得复制审批服务形成第二Approval权威|
|同库事务能力|ProductSqliteRepository.transaction开RevisionStore.atomic；joinTaskTransaction只接受当前真实TaskStore能力|最终RevisionStore提交需要受限同连接join能力；不能nested BEGIN或暴露裸DB/长期tx；任一吞错仍回滚|
|created source fact|ProjectCreationStore当前只有初始bootstrap提交写created_source_fact；旧commitAdoption依赖migrated ledger|新增created专用提交入口，原Coordinator/queue/journal/transaction；禁假migration_id及单换film.html|
|预览读取|ReviewMediaHttp有安全reader但CreationApplication没有持久package↔receipt/object binding生产者|接真实publishReviewPackage及不可变绑定；result_ref只有包发布后赋值；GET不渲染|
|原生加载|native observation/expected/ack拟定实体当前未生产实现|由PRODUCT复用固定013/015来源，独立expected与真实UI观察；commit不等于loaded；所有epoch/session/generation核对|
|冷启动显示|已授权工程无Run现在只读revision0空nodes；真实UI有Context/Workflow/Health/非模态系统|不制造Run或Job；健康registry的样本TTL保持；真实样片加载属于后续R2组合，不把当前空工程浏览器PASS泛化|

## MAIN实施顺序决定：先消除准入依赖环，验收不合并冒签

R1实际ReleaseAssignment曾明确MEDIA只做prepared proof/preview，不含committed encoding/Delivery；因此缺committed-render-phases不是已释放R1返工，也绝不能声称已实现。原总计划R1条目提及的阶段化媒体部分，在后续精确释放中尚未执行。

R2端到端真实Run依赖四能力，而snapshot.render/qc.inspect/delivery.package的完整生产消费者原属R3。MAIN将**R3媒体阶段端口及对应真实Host执行器基础接线提前并行实现**，仍采用原D05/D11/D14/D15合同、原所有权与全机单槽，不增加V1/B范围。能力在对应真实producer+guarded consumer均装配/可验证后才登记，不以媒体函数存在就判就绪。编码/QC/正式包交付和T20仍分别属于R3门；R2采用/原生确认门也必须实际通过，不能借将来R3结果填绿。

这只是A内依赖与实施顺序调整，不授权现在就写任何未release文件，也不允许越过cover/QC门发布。领域任务须明确并行文件范围与共享依赖，MAIN冻结唯一接口后一次释放连续开发，减少模块之间反复退回。

## 领域交付要求

BRIDGE：提出唯一core writer精确文件和同库join/plan/hash/批准/提交/恢复接口；把阶段执行器/四能力真实装配依赖写清，不在R2测试里补假能力。MEDIA：复用现有proof，提出阶段化encode/inspect/publish纯媒体端口及输入输出/不可变receipt/清理，不写DDL或审批。PRODUCT：真实013/015来源、expected/observed数据流、native session/epochs/ack、UI采用pending到loaded路径，绝不自造第二时间轴或从Host复制observed。

各领域文档按同一de086f3源逐个注明已有/需修改/未开发，提供可执行case与命令、数据出处及回退。完成后MAIN结合实际文件冲突决定精确release；不做无问题证据支撑的多轮整包重审。
