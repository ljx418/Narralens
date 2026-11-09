# Agent驱动目标架构：R4实施设计入口

状态：文档设计候选。R4原型人工已批准；本轮不写产品代码。当前源码HEAD为`fd3021c336387b4c6405b3db08abaafa81c842ff`，绿色已有仅表示源码与生产接缝，不表示本轮复验。旧R2/R3正文归档`history/pre-r4-implementation-design/`，不再用于发放实现指令。

权威细图与定义：`implementation-design/01_ARCHITECTURE_AND_GAP.md`（22个L1实体、代码路径/状态/owner/交互）、`02_CONTRACTS_AND_RECOVERY.md`（端口/存储/恢复）、8页中文`Narralens-V1-R4-实施与验收-GAP.drawio`及`review.html`。Archify最终交付图为`implementation-design/target-l1.architecture.html`，可信批准箭头表示调用关系，消费与正式commit仍须同DB事务。

## L0与设计约束

外部Agent按Skill调用MCP外观→常驻Host应用服务→持久准备/产物→可信人类批准→Coordinator→EnginePort→journal/snapshot/active_commit/outbox。工作台经同源HTTP/SSE读同一服务；系统非模态，不直接改影片。单Host/共享库/单项目引擎/唯一原生selection-clock；M5既有独立注入bundle保留，不强行另造应用根或第二timeline。

当前默认main.tsx仍为旧d1-30s演示，Gateway注入的M5才是已有原生工作台；生产入口需明确指向持久项目。已有migration/materialize/impact/adoption/history继续复用，新增bootstrap/MCP/创作DAG/健康资源/模型/正式render-QC-delivery，不重写旧已验证模块。

## 保留的AD-A编号与目标变化

| ID | 现状 | 目标变化 | 代码实体与落点 | 状态/影响 |
|---|---|---|---|---|
| AD-A01 | M5 入口依赖测试环境创建临时工程，关窗清理 | 生产 ServiceSupervisor 独立生命周期；图标启动/状态/停止与重开项目 | 新 `src/launcher/service-supervisor.ts`、扩展 `tools/windows/`；历史 `tools/m5-human-experience.ts` 保留 | 新增生产入口，不修改旧体验入口语义 |
| AD-A02 | HTTP API 与产品内 Runner，尚无统一 MCP | 一个 MCP 外观，发现/工具/资源映射应用服务；本地多服务通过受控适配接入 | 新 `src/mcp/{server,tool-registry,resource-registry}.ts` | 先 stdio→常驻 Host；不为每个工具创建新 Host |
| AD-A03 | 固定 pipeline/内部提案 Runner 为主要生成入口 | 入口 Skill + Skill-Lib；外部驱动可提交结构化结果，旧 Runner 作为显式可选兼容路径 | 新 `skills/narralens/SKILL.md`、`skills/narralens-lib/*`、`src/host/creative/creative-artifact-service.ts` | 新增方法包；固定版本，避免驱动递归调用自身 |
| AD-A04 | 当前Resolver以迁移目标为主 | 一般新建origin与隔离初始commit、重开 | MAIN拟新增 `src/host/projects/project-creation-service.ts`；复用Catalog/Resolver/SnapshotStore | 待新增/需修改，PRODUCT只消费bootstrap port |
| AD-A05 | 已有 Job/lease/event，但缺整次创作的持久步骤关系 | CreativeTaskStore/WorkflowCheckpointStore 保存业务DAG、输入输出版本、等待原因；编辑后生成新版本与下游重算计划 | 新 `src/host/creative/{task-store,checkpoint-store,artifact-revision-service}.ts`，扩展共享 RevisionStore DDL | Agent可规划分支；图编辑不绕过提交边界 |
| AD-A06 | 单项目写串行已有，缺驱动接管语义 | 单活动驱动负责编排；ResourceScheduler 按IO/CPU/RAM/GPU池调度多个镜头下载、章节合成与音频child jobs | 新 `src/host/agents/driver-session.ts`、`src/host/jobs/resource-scheduler.ts`、现有JobStore | 编排租约不串行化准备任务；正式工程提交仍串行 |
| AD-A07 | materialize/impact/adopt/history 已有受控提交 | 两入口复用 application commands；新增意图绑定的审批，与 impact/base/锁/许可共同校验 | 保留 `projects/project-coordinator.ts`、`impact/`、`adoption/`、`history/` | 不改 EnginePort 七方法，不双写，不绕 gateway |
| AD-A08 | 资产导入/账本与部分适配已有 | AssetPlanService 先按主题/章节/台词缺口检索，再对选中方案分批下载/生成，缓存与来源/许可关联 | 新 `src/host/assets/asset-plan-service.ts`、ProviderGateway、retrieval/voice/subtitles/cover adapters | 资源准备不一次性批量获取所有素材 |
| AD-A09 | M5暴露ID、默认首案、分步技术操作 | 已批准R4改单镜、顶部横向工作流、非模态系统面板 | MAIN改旧M5挂载；PRODUCT拟 `src/app/observation/WorkflowTopBar.tsx`、`src/app/system/SystemControlPanel.tsx` | 目标已批，产品未实现，不新建前端根/时间轴 |
| AD-A10 | EnginePort.render签名存在，两个adapter仍未开放 | snapshot真实render/QC/持久交付 | MEDIA拟 `src/host/{render,preflight,delivery}/`；MAIN接原adapter/registry | 待新增/需接线；代理片与探针不代替正式导出 |
| AD-A11 | 本地已有多套ComfyUI JSON与执行器，Narralens尚未接通 | ComfyWorkflowRegistry/ComfyAdapter固定模板与参数映射；能力预检→作业关联→结果资产验证→受控采用 | 新 `src/adapters/comfyui/`、`src/host/providers/comfy-workflow-registry.ts`，复用已有固定执行器 | 不复制模型、不自动安装节点、不导入任意有副作用图 |
| AD-A12 | 概念说明/AI转场没有明确语义合同 | ConceptSceneSpec/TransitionSpec 分离可编辑图形与生成背景；检验术语/首尾/时长/音轨再组装 | 新 `src/host/creative/{concept-scene,transition-plan}.ts`，复用原生图形和EnginePort | 生成素材不等于概念事实正确；原生clip与文字可编辑 |
| AD-A13 | 原有Job/SSE与服务启动职责尚未形成统一监控 | WorkflowEventProjector/ServiceHealthRegistry/ResourceSampler/MonitoringQuery提供实时业务图与服务/队列/资源面板 | 新 `src/host/observability/`、`src/app/observation/`与`src/app/system/`，复用supervisor与Job/outbox/SSE | 快照+游标恢复；状态/健康/资源分离，监控不新增提交权威 |

## 状态、合同与准入

已有API见implementation-design/reviews/current-code-audit.md。`/api/agent/v1`、MCP和新增端口仍是目标，不是生产注册。旧S0/R2 schema/SQL保持冻结；CP-A0/B0/C0按阶段锁定精确producer/consumer、错误/权限、DDL与向量。业务producer不等于生产注册owner，MAIN独占共享schema/server/核心与初始commit。当前CP未冻结、生产NOT_RELEASED。

R4体验门、35个AD-T族和17包DAG不变；新增详细场景与回退见implementation-design/03..05文档。缺完整真实证据不得宣称V1。

## 体验层职责细化（讨论后确认）

主体拓扑不变。新增对象与方法边界详见implementation-design/07_EXPERIENCE_SPEC.md、08_WORKFLOW_MCP_CONTRACT.md：E04仅阶段投影和节点弹窗，E05非模态系统/按需准备；E07映射已登记能力和版本化模板/运行操作；E08持有可信批准/稳定授权/运行变更消费；E15维护模板、RunPlan与ReviewRequest；E19以同一门控调度全部副作用入口，禁止直接task或另建run绕过首章/风险门。

普通Agent转述可记录前期内容Decision，但不充当可信安全批准。章节审阅与采用可一次UI交互、后端分别记录ReviewDecision/Approval；最终仍走原Coordinator。V1没有工作台可视化流程编辑器，模板/运行结构由Agent通过MCP管理。
