# 实施架构与差距：L0 / L1

日期：2026-11-09。源码观察基线：`fd3021c336387b4c6405b3db08abaafa81c842ff`。当前为文档设计，生产实现未释放。R4批准的是目标体验，旧Gate只保留其原证据范围；本轮没有重新执行产品验收。

## 1. 权威、状态与设计决定

顺序：最新用户指令→原PRD规格与已批准R4体验门→本实施设计→旧路线历史。`../V1_FRONTEND_EXIT_GATE.md`与R4 FREEZE/APPROVAL不改写。旧S0/R2候选schema、SQL、图仍保留，但不是生产注册表。遇到本文与已批准PRD冲突须修本文，不静默缩减PRD。

图中绿色“已有”只指源码有实体且发现生产调用；橙色“需修改”表示已有模块需增量接线；蓝色“待新增”表示不存在的新实体；紫色“待验证/未开放”表示接口存在但能力未获证明。**产品开发中实体：0，本轮只有文档设计在进行。** 详细现状与真实API见`reviews/current-code-audit.md`，合同差距见`reviews/contract-baseline-audit.md`。

锁定的架构原则：单Host、单共享SQLite连接/迁移权威、每项目单引擎、单原生时间轴/选择/时钟；所有影片变更经ProjectCoordinator；任务完成、提交、原生加载分别记录。外部Agent通过Skill/MCP驱动，不获得SQL、任意路径、任意Shell或原生裸写能力。系统控制非模态且不直接改影片。

## 2. L0运行关系

用户在终端表达目标→Agent按入口Skill调用MCP façade→常驻Host中的同一应用服务→持久准备任务/产物→可信人类审阅/有限授权→Coordinator→EnginePort隔离stage/validate/publish→共享journal/snapshot/active_commit/outbox。工作台经同源HTTP/SSE读同一应用服务；UI不必绕MCP，也不建立第二套业务规则。

Supervisor管理自有Host/Studio/worker实例和就绪；MCP只是客户端外观，不为每个窗口再起数据库。BRIDGE读观测事实；MEDIA写准备产物与receipt；PRODUCT维护创作对象/交互；MAIN独占注册、存储、原核心和提交。

当前默认`src/app/main.tsx`仍挂载旧NarralensApp，M5则由Gateway注入Studio的独立bundle。目标生产入口必须明确返回真实持久工程的Gateway工作台，不能把Vite旧演示入口或R4 HTML当生产入口。保留既有bundle/挂载拓扑，**不强求新建单一React createRoot**，要求的是同一原生编辑器、选择与时钟，不另建应用壳。

## 3. L1实体清单与相互依赖

下表拟新增路径是实施设计，尚无对应代码；生产注册均由MAIN完成。“业务owner”不等于server/registry/DDL写权限。

| 实体ID / 层 | 当前具体实体或目标路径 | 状态 | 关联与职责 | owner / 阶段 |
|---|---|---|---|---|
| E01 入口 | `src/app/main.tsx` / `director/NarralensApp.tsx` | 需修改/保留legacy | 默认旧d1-30s演示不作为生产；生产启动定位E02真实项目 | MAIN / A |
| E02 原工作台 | `src/host/m5/{workbench-service,openfilm-studio-supervisor,openfilm-studio-gateway,studio-host-bridge,panel-assets}.ts` | 已有→需扩展 | Studio进程/Gateway注入M5，连接E03/E09；归属与关窗语义接生产Supervisor | MAIN / A |
| E03 创作决策 | `src/app/m5/M5Panel.tsx`、`SelectionCoordinator.ts`、`stores.ts` | 需修改 | 移除日常ID劳动和默认首案，绑定真实候选、影响、可信决定；复用原selection/clock | MAIN挂载、PRODUCT消费端口 / A/B |
| E04 流程Bar | 拟`src/app/observation/{WorkflowTopBar,ProjectObservationAdapter}.tsx` | 待新增 | 读E13事件与E15投影，定位E03，不持有timeline/提交权 | PRODUCT / A |
| E05 系统面板 | 拟`src/app/system/{SystemControlPanel,SystemStateAdapter}.tsx` | 待新增 | 非模态读E13健康/资源，命令经E08授权；关闭不终止服务 | PRODUCT / A/B |
| E06 启动器 | 拟`src/launcher/service-supervisor.ts`及现有`tools/windows/`增量 | 待新增 | 单实例发现、持久目录、进程归属、就绪、停止/恢复；旧临时人验入口独立标识 | BRIDGE纯模块、MAIN注册 / A |
| E07 协议层 | 拟`src/mcp/{server,tool-registry,resource-registry}.ts`、`skills/narralens/`、`skills/narralens-lib/` | 待新增 | stdio façade连接E08；查询同一项目/任务；不能直导DB/adapter | BRIDGE / A |
| E08 应用装配 | 拟`src/host/agent-driven/{composition,application-port,approval-service,driver-session,system-lifecycle-command}.ts` | 待新增 | Host单次构造，通过冻结port接E09/E10/E12/E14；可信身份与授权、fencing | MAIN / A/B |
| E09 Host transport | `src/host/server.ts`、`security.ts`、`api-error.ts` | 已有→需修改 | 保留旧路由、auth/Origin；新route只映射E08，HTTP/MCP不复制规则 | MAIN / A |
| E10 项目写边界 | `projects/{project-operation-queue,project-write-actor,project-coordinator,lock-service}.ts` | 已有→需接新审批 | 同项目串行提交，重查base/source/锁/许可/批准；legacy就地写限制单列 | MAIN / A/B |
| E11 引擎 | `engine/{engine-port,engine-binding-store,engine-registry,openfilm-composition}.ts`及OpenFilm/Hypit adapters | 已有；render未开放 | 七方法无commit；单引擎；stage/validate受E10控制；不能据render签名算导出完成 | MAIN接缝、MEDIA渲染实现 / A |
| E12 数据与恢复 | `projects/{revision-store,snapshot-store}.ts`、`persistent-job-store.ts`、`outbox.ts` | 已有→需扩展 | 共享连接/事务；journal、snapshot、active_commit；新DDL与迁移只MAIN维护 | MAIN / A/B |
| E13 观测 | 拟`src/host/observability/{workflow-event-projector,service-health-registry,resource-sampler,monitoring-query}.ts` | 待新增 | 从E12/E14/E15构建只读snapshot+cursor；不以心跳推业务成功 | BRIDGE / A/B |
| E14 项目初始化 | 拟`src/host/projects/project-creation-service.ts`；已有catalog/resolver/activated-projection/asset-ledger | 待新增+修改 | new/migrated origin，隔离创建/验证/初始snapshot/commit；不能伪造migration记录 | MAIN / A |
| E15 创作事实 | 拟`src/host/creative/{task-store,artifact-revision-service,question-service,decision-service,workflow-service}.ts` | 待新增 | 基于MAIN仓储port写brief/script/storyboard/Decision/版本DAG；不存第二份timeline | PRODUCT / A/B |
| E16 准备链 | `materialize/{materialize-service,binding-service,native-plan-builder,proxy-renderer,derived-artifact-store}.ts` | 已有→需绑定新提案 | 当前已有并发drain/lease；准备proxy/plan/lineage，不改工程revision | MAIN旧模块、PRODUCT/MEDIA消费 / A |
| E17 采用/恢复 | `impact/impact-service.ts`、`adoption/{adoption-coordinator,author-source-publisher}.ts`、`history/{history-service,history-store,historical-snapshot-resolver,restore-planner}.ts` | 已有→需接E08授权 | 原currentness与typed intent复用；undo/redo不裸转发，restore新revision | MAIN / A/B |
| E18 资产 | `assets/{asset-import-service,media-validator}.ts`、`projects/{asset-registry,asset-inventory-port,migrated-asset-ledger}.ts` | 已有→扩展 | 当前本地上传非在线下载；内容/许可验证、来源和ledger；消费E20/E21结果 | MAIN接缝 / A/B |
| E19 资源 | 拟`src/host/jobs/resource-scheduler.ts`、E08 resource port | 待新增 | IO/CPU/RAM/GPU容量、lease/CAS；DriverSession不等于worker租约；发布仍串行 | MAIN内核、MEDIA消费 / B |
| E20 下载与生成 | 拟`src/host/providers/{provider-gateway,comfy-workflow-registry,model-runtime}.ts`、`src/adapters/comfyui/`及下载/声音worker | 待新增 | 固定模板/配置、允许来源、超时/大小/许可、receipt、取消晚到隔离；不得直接采用 | MEDIA / B |
| E21 导出/QC | 拟`src/host/{render,preflight,delivery}/` | 待新增/未开放 | 从已提交snapshot固定输入，真实encode+完整decode、QC阻断与成套交付；不读可变工作区 | MEDIA、MAIN任务注册 / A/B/C |
| E22 风格/反馈 | 拟`src/host/creative/{style-profile,feedback-anchor,post-edit-capability}.ts` | 待新增 | 版本化风格和局部override、评论锚点；原后期承诺逐项可渲染测试 | PRODUCT+MEDIA、MAIN采用 / C |

## 4. 当前调用链与保留边界

`NarralensHost`创建RevisionStore/共享队列→构造Resolver、asset ledger、Materialize、Impact、Adoption、History→listen装配固定OpenFilm→专项恢复→Coordinator通用恢复→migration恢复→materialize恢复/drain→outbox与lease reaper。原生Gateway按allowlist代理；native写入口经登记与Host服务，不开放任意上游export/import/delete。

当前典型用户链：Gateway/M5输入已录制comparison ID→复制提案→取首案准备→materialize→impact→native采用→Coordinator受控提交→projection同步。目标变化是新的Agent/Host编排与真实选案，不重写已验证stage/publish/journal/恢复。旧Actor在Hypit路径存在事后snapshot捕获边界，不能画成所有路径都先stage原子发布；新增正式采用与初始化必须走隔离准备。

现有API按Host的`/api/projects/...`、`/api/migration/v1/...`和Gateway的`/narralens/api?...project_id=`分表；新`/api/agent/v1`仅候选。三类前缀不可混用。完整现状清单见代码审计，不把文档schema或工具脚本当生产路由。

## 5. 关键数据权威与一致性

| 事实 | 唯一权威/写入者 | 版本与关联 | 不得混淆 |
|---|---|---|---|
| 正式影片 | `project_state`、`active_commit`、`project_transaction`与snapshot，E10/E12 | project revision、snapshot/source digest、transaction | workflow/artifact version不增加影片revision |
| 原生画面已加载 | E02原生桥的实际回报，含project/revision/snapshot匹配与观察时间 | editor-view version与selection_version | Host rN不是native ack；无法核对显示未知 |
| 创作目标/产物 | E15经共享连接仓储；拟creative_artifact/workflow_step/decision | immutable artifact version、input_digest、workflow revision | 产物不是可独立重建全片的第二timeline |
| 人类批准 | E08可信UI身份/批准服务 | project、action、plan/input hash、base、expiry、consumed | 候选选择不是批准；MCP参数actor=human不能自证 |
| 执行与资源 | PersistentJobStore+resource claim+provider receipt | parent/child、attempt、lease/fencing、外部ID | driver租约不取消有效worker，WS消息不算成功 |
| 系统状态 | Supervisor/runtime/HealthRegistry真实探针 | observed_at/TTL/source/allowed_actions | 进程存活≠API就绪≠模型就绪；未知不填0 |

新表均在原RevisionStore同连接迁移。详细表/字段/索引设计见`02_CONTRACTS_AND_RECOVERY.md`；本轮不执行DDL。source摘要包含film.html、scene、字幕、设置及引用资产闭包，canonical realpath去别名、缺失/逃逸拒绝；瞬时读失败按已有可重试错误分类，不能等同已证漂移并永久锁死。

## 6. 差距与分阶段处理

G01生产入口/E06；G02 MCP/Skill/E07；G03一般创建/E14；G04创作对象/问答/E15；G05 R4主线与任意选案/E03–05；G06可信审批/驱动/E08；G07事件/监控/E13；G08资源/未知结果/E19；G09在线素材/本地生成/声音/E20；G10snapshot render/QC/delivery/E21；G11风格/长片/全后期/E22。G01–07及G10的短片子集在A完成；B补齐协作/媒体生产；C实现全规格与长片。对应17包不新增大阶段，见详细计划。

架构变更必须给出相关E/G/IT/R4-UX/AD-T/PRD条目、producer/consumer、兼容与回退；不允许通过删除功能、放宽schema或重命名Gate掩盖差距。
