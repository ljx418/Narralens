# Agent 驱动目标架构 L0 / L1

状态：待核对设计；本文所有“拟新增路径/接口”都不是现有 API。源码基线见 `00_READ_FIRST.md`。
约束源：PRD v1.1 §11–15。图为 `docs/architecture/agent-driven-v1.architecture.html`，JSON 为可再生成源。

## 1. 架构决策摘要

Agent 组织“下一步做什么”；Host 持久记录“已经做了什么、谁授权、结果能否采用”。工作台呈现和修改同一份项目事实。入口 Skill 为客户端方法，不另建隐式数据库或独立最终时间轴。

L0 主路径：用户意图 → 外部 Agent → Skill/技能库 → MCP → 应用服务 → 持久准备任务或 Coordinator 提交 → EnginePort/媒体适配器。工作台通过现有同源 HTTP/SSE 访问同一应用服务，不必绕 MCP，避免为 UI 额外引入协议复杂度。

图中的 Skill→MCP 表示 Agent 按技能指导调用，不表示 Markdown 文件是独立执行进程；应用服务→Job/Coordinator 为调用关系，结果沿请求/资源/事件返回。所有事实由 Host 查询接口读取；图未画每条返回箭头以避免重复路径。

## 2. 逐项架构变化

| ID | 现状 | 目标变化 | 代码实体与落点 | 状态/影响 |
|---|---|---|---|---|
| AD-A01 | M5 入口依赖测试环境创建临时工程，关窗清理 | 生产 ServiceSupervisor 独立生命周期；图标启动/状态/停止与重开项目 | 新 `src/launcher/service-supervisor.ts`、扩展 `tools/windows/`；历史 `tools/m5-human-experience.ts` 保留 | 新增生产入口，不修改旧体验入口语义 |
| AD-A02 | HTTP API 与产品内 Runner，尚无统一 MCP | 一个 MCP 外观，发现/工具/资源映射应用服务；本地多服务通过受控适配接入 | 新 `src/mcp/{server,tool-registry,resource-registry}.ts` | 先 stdio→常驻 Host；不为每个工具创建新 Host |
| AD-A03 | 固定 pipeline/内部提案 Runner 为主要生成入口 | 入口 Skill + Skill-Lib；外部驱动可提交结构化结果，旧 Runner 作为显式可选兼容路径 | 新 `skills/narralens/SKILL.md`、`skills/narralens-lib/*`、`src/host/creative/creative-artifact-service.ts` | 新增方法包；固定版本，避免驱动递归调用自身 |
| AD-A04 | 项目读取依赖 migration terminal record，不能创建一般空白工程 | ProjectCreationService 建立原生工程、binding、初始 snapshot 与资产上下文；Resolver 支持新建与迁移两种来源 | 新 `src/host/creative/project-creation-service.ts`；改 `projects/project-resolver.ts`、`m5/workbench-service.ts` | 关键适配风险；不能伪造 migration 记录或复制三镜 fixture |
| AD-A05 | 已有 Job/lease/event，但缺整次创作的持久步骤关系 | CreativeTaskStore/WorkflowCheckpointStore 保存 DAG、输入输出引用、等待原因与版本；Agent 任意合理编排 | 新 `src/host/creative/{task-store,checkpoint-store}.ts`，扩展共享 RevisionStore DDL | 不是第二个媒体提交状态机；阶段输入变化使下游 stale |
| AD-A06 | 单项目写串行已有，缺驱动接管语义 | DriverSessionService 与意图审批，单活动驱动租约、接管记录、selection_version | 新 `src/host/agents/{driver-session,approval-service}.ts`、扩展 UI selection read model | Driver lease、job lease、三类内容锁互不替代 |
| AD-A07 | materialize/impact/adopt/history 已有受控提交 | 两入口复用 application commands；新增意图绑定的审批，与 impact/base/锁/许可共同校验 | 保留 `projects/project-coordinator.ts`、`impact/`、`adoption/`、`history/` | 不改 EnginePort 七方法，不双写，不绕 gateway |
| AD-A08 | 资产导入/账本与部分适配已有 | ProviderGateway+DownloadService+Voice/Subtitle/Cover adapters，落地资产后才可绑定 | 新 `src/host/providers/`、`src/adapters/{retrieval,voice,subtitles,cover}/` | 首期最少能力；真实 provider/许可/费用可用性须探针 |
| AD-A09 | 面板暴露内部 ID、固定第一案、三路预览关联不清 | TaskSummary/CandidateReview/ChangeReview/ApprovalInbox/Delivery；候选有 proposal→proxy→绑定关系 | 改 `src/app/m5/`；新 `src/host/workspace/{selection,decision,review}-service.ts` | 保留原生 Studio；三阶段导航不变，不开发第二条 timeline |
| AD-A10 | 正式 Render/QC/Delivery 未闭环 | SnapshotRenderService、PreflightService、DeliveryPackage；任务查询、取消、审计 | 新 `src/host/{render,preflight,delivery}/` | 所有导出绑定 committed snapshot，工作区改动不污染在途导出 |

以上路径是实施设计，不宣称当前存在。已有实体精确路径以源码为准；同名拆分在各阶段接口冻结时确定，禁止建立重复权威模块。

## 3. L1 分层与依赖规则

| 层 | 允许依赖 | 禁止 |
|---|---|---|
| 客户端 Skill | 能力目录、项目资源、工具 schema | 内部文件绝对路径、SQL、直接写 author source |
| MCP transport | ToolRegistry、HostClient、错误映射 | 导入 DB/引擎适配器直接执行业务 |
| HTTP/SSE transport | 同一 application service | 各自实现一套采用/审批/锁规则 |
| 创作应用服务 | Catalog/Resolver、task/artifact/approval、既有 Job 和 Coordinator | 将 Agent 自报成功写为已提交工程事实 |
| 媒体任务执行器 | 固定 adapter、资产暂存、验证器、持久 JobStore | 在 provider callback 中采用工程、修改 revision |
| 提交服务 | 原 impact/锁/审批、snapshot/journal、EnginePort | 信任客户端 hash/范围，静默 rebase，第二事实时间轴 |
| 存储 | 同一共享数据库事务与受控文件目录 | 每个 MCP 进程另建数据库；把 workflow state 当 transaction state |

服务拆分是部署细节：先单 Host 多模块。媒体/TTS 依赖需要独立进程时由 supervisor 管理；可接本地 MCP service adapter，但其返回结果仍经资产验证、权限检查与统一 JobStore。

## 4. 桥接合同草案（非既有 API）

协议版本与包版本在 AD-S1 冻结，不使用 latest。首版推荐 stdio MCP façade 连接常驻 loopback Host；Host 实例由本机 rendezvous 描述文件提供 instance_id、版本和端点，凭据放用户私有目录且不出现在 URI、工作台或日志中。MCP 握手失败只报不可用，不另起独立事实 Host。需要 HTTP MCP 时单独验证客户端支持、鉴权与 Origin 策略。

| 工具族（拟定） | 输入核心 | 输出核心 | 副作用与保护 |
|---|---|---|---|
| `narralens_capabilities` | 客户端版本/能力 | 受权限过滤的工具版本、schema ref、availability/reason | 只读；blocked 不冒充可执行 |
| `narralens_project_create/read/list` | 已确认 brief；create 带幂等键 | project_id、revision、snapshot、workspace_uri | create 持久；临时体验另命名 |
| `narralens_context_read` | project_id、事件 cursor | brief/script/selection/decisions/jobs/checkpoint 引用、版本 | 不携完整媒体；按需分页/摘要 |
| `narralens_artifact_submit` | 类型、结构化内容、输入版本、幂等键 | artifact_id、验证状态、review_uri | 允许 Agent 提案，服务端校验后存储；不提交 timeline |
| `narralens_task_prepare/read/cancel` | task kind、输入引用、版本、授权引用 | job_id、状态、phase、artifact refs、error | prepare 返回异步事实；取消≠杀终端 |
| `narralens_change_prepare` | project、选区及其版本、proposal/input refs、base | change_id、server impact、前后预览、需审批项 | 只准备；approval_required 阻止 apply |
| `narralens_change_apply` | change_id、impact_id、approval_id、base、幂等键、driver session | transaction_id、committed revision 或明确错误 | 必须经过原 Coordinator；一次 revision+1 |
| `narralens_history_*` | 已提交目标、恢复意图、impact/approval/base | 新 commit 与新 revision | 同现有 history；不能回拨 pointer |
| `narralens_driver_attach/heartbeat/takeover` | client identity、project、lease token、接管授权 | driver session/lease expiry、接管记录 | fencing；不得信任 Agent 自称人工 |
| `narralens_delivery_prepare/read` | committed snapshot、输出配置、许可与 QC | render job、QC、包与下载引用 | QC block 不生成可发布交付状态 |

资源草案：`narralens://projects/{id}/brief|context|selection|decisions|jobs|delivery`。实际 MCP URI/schema 与 tool annotations 在 AD-S1 锁定。工作台 link 为可用 HTTP 页面地址，不能把资源 URI 当网页 URL。

统一结果至少含 schema_version、correlation_id、project_id（适用时）、revision/snapshot（适用时）、job/artifact 引用、state、next_actions。统一错误区分 invalid_input、stale_base、locked、approval_required、capability_unavailable、retryable_resource_error；HTTP 到 MCP 的 code/alias 表复用现有规则，不能把所有失败包装成 200 success。原 409/422/423/428/503 语义保留。

## 5. 持久创作模型与状态语义

- `CreativeTask`：目标、资料引用、用户确认摘要、目标时长、风格版本、project_id。
- `CreativeArtifact`：brief/script/storyboard/proposal 等结构化版本、来源、生成者与输入摘要；无法独立重建最终时间轴。
- `WorkflowCheckpoint`：step_id、依赖、输入摘要、job_id、输出引用、decision_id、失败/等待原因。建议状态 pending/running/waiting_user/succeeded/failed/cancelled/stale；提交事务状态机仍由原 project_transaction 独占。
- `Decision`：actor 类型、已认证操作者、选中 artifact/proposal、版本、时间、拒绝原因与 supersedes。用户身份来自 UI 会话/可信批准渠道，不接受 MCP 参数 `actor=human` 自证。
- `Approval`：scope、project、输入/plan hash、允许动作/费用/外传、expiry、consumed/revoked；任何改变绑定事实都重新评估，不沿用旧 token。
- `DriverSession`：client、project、owner、epoch/fencing、expiry；driver lease 只决定谁推进，不免除 base、impact 与锁。

同键同内容重放同一结果；异内容同键冲突。媒体任务的“恰一次”不能仅靠客户端幂等保证：本地提交恰一次，外部副作用按 provider idempotency/receipt 对账；结果不明时 unknown/attention，禁止自动重复扣费。

## 6. 五条必须真实证明的关键序列

### 6.1 从想法创建
Agent→project_create(brief,key)→ProjectCreationService→隔离初始化原生工程→校验→初始 snapshot/EngineBinding/提交事实→持久项目。不能以 migration 记录伪造 create；首次失败回滚，重试不重复建工程。工作台打开相同 project_id。

### 6.2 人工选案回传
Agent submit proposals→工作台显示绑定预览→用户选 B→DecisionService 记录带版本事件→Agent context_read(cursor) 读 B→只对 B prepare。用户随后改选 C，B 的未采用准备不能自动采用。

### 6.3 局部修改与并发
工作台 selection(v)→Agent 读取→prepare(base,selection v)→server impact→用户批准→apply→Coordinator 二次检查当前 source/base/锁/许可/approval→原子发布→revision+1。中途人工改变工程返回409，Agent重读并重新准备；不静默扩大范围。

### 6.4 驱动中断与接管
Agent 退出→服务继续已授权任务→lease 过期→新客户端读取 checkpoint→显式接管 epoch+1→只续作未完成项。旧客户端迟到 apply 被 fencing/base/approval 拒绝；不要取消仍有效的 Host worker lease。

### 6.5 渲染交付
指定已提交 snapshot→持久 render job→固定引擎/配置→真实 encode+decode/ffprobe→QC→来源许可与标题封面检查→delivery package。中途项目发生新 revision，在途输出仍指向原 snapshot，不能贴成最新版。

## 7. 风险、取舍与技术探针

| 风险 | 本设计应对 | 开工前/阶段证据 |
|---|---|---|
| DSH 的 MCP/Skill 支持未知 | 客户端 profile 逐个探测；最小 fallback 为符合相同合同的适配客户端，不复制业务 | AD-S1 三端支持矩阵；不支持时保留 BLOCKED 并请求路线裁决 |
| 旧 Resolver 依赖迁移、新项目无法打开 | new/migrated origin 分支，公共 committed projection | AD-S2 新工程→关服务→重开→编辑→双导出 |
| Agent 自组织导致无界重试 | Host 幂等/授权范围/依赖 stale/receipt 对账 | AD-S2 中断；S4 provider unknown 负向 |
| 多 MCP 重复启动服务与状态分叉 | 单实例 supervisor + MCP 外观；媒体进程受管理 | 两客户端同一 project/snapshot/job |
| UI 改动与 Agent 冲突 | revision+selection version+driver fencing；UI 编辑保留原锁 | 两客户端竞争与用户改选竞态 |
| 自动下载任意 URL 越权 | 来源 allowlist、重定向/SSRF/大小/超时/许可检查；引用不等于下载授权 | S4 下载隔离与错误矩阵；无绕过许可承诺 |
| 队列保活和生产退出不可靠 | supervisor 停止时等待/取消/恢复 worker；关闭 UI 不关闭 Host | 真实进程退出/重启，不只 throw fault |

## 8. 合同冻结门

当前为设计草案，不称“架构契约已锁定”。AD-S0 核对产品方向；AD-S1 实现前把 runtime schema/TS/validator/SQL migration、tool/resource registry、权限与错误码、版本兼容、取消/重试/接管/授权、真实 case 对齐并独立文档审查。不得同时扩张 EnginePort 或重写已验模块；确需变更先 ADR，明确旧回归与回退。
