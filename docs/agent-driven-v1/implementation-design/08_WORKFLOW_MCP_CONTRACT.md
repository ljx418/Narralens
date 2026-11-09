# 工作流固化、MCP能力与验收增补

状态：业务规格设计候选。用户已确认07中的交互方向；此处对象字段与新增MCP名称是拟定，不冒充已注册API。具体runtime schema/TS/DDL/alias/测试向量仍需CP冻结。本轮不实现生产服务。

## 1. 版本化对象与执行边界

| 对象 | 必须绑定的事实 | 状态/规则 |
|---|---|---|
| WorkflowTemplateVersion | template_id/version、父版本、内容类型、输入参数schema、节点/依赖、capability_id/version、审阅/风险策略、execution_digest | draft→validated→published→deprecated；已发布版本不原地改，发布不等于运行授权 |
| CapabilityDescriptor | capability_id、合同版本、语义输入输出、executor/instance、可用性/reason、依赖/资源/许可/外部副作用、取消与重试类别 | registered不等于available；固定版本/模板；不能直接传任意workflow JSON、路径或代码 |
| WorkflowRun / RunPlanVersion | run_id、project、template版本、参数与输入摘要、计划版本、scope/grant、checkpoint、选中的artifact版本 | 模板更新不自动更改已有run；run计划版本与影片revision分开 |
| StepAttempt | stable step_id、attempt、输入摘要、dependency refs、job/provider refs、lease/fencing、产物与状态时间 | 旧attempt回报不能推进新计划；准备产物不写author source |
| ReviewRequest / Decision | stage/type、project/run/chapter/artifact/input版本、审阅包、允许动作、当前决定渠道、supersedes | pending/accepted/changes_requested/rejected/stale；一份请求跨端同一ID，关闭/沉默不接受 |
| StabilityRecommendation | 目标模板/风格/内容类型/相关模型摘要、历史审阅证据、推荐范围与原因 | Agent可提出、撤回/更新建议；不能自行签“稳定” |
| StabilityAuthorization | user、建议与可信决定ID、适用scope、允许省略的首章门、状态/创建与撤销时间 | active/revoked/stale；只省首章验证门，不免样片、章节、风险、QC或采用批准 |
| RunPlanChange | run_id、expected_plan_version、patch摘要、新依赖图、输入差异、保留/失效成果、成本风险、review_request、幂等键 | prepared→awaiting_review→applied/rejected/stale；影响变了重新确认；版本CAS与审阅消费原子绑定 |
| ExecutionGrant / SystemOperation | 可信授权来源、project/run/action/注册配置、允许资源/费用/外传scope、key、任务影响 | 内容决定不能扩大授权；load/warm/unload/重启依真实runtime回报，失联保持unknown |

运行状态区分ready/running/waiting_user/waiting_agent/waiting_resource/blocked/paused/reconciling/completed/failed/cancelled。暂停阻止后续dispatch，不等于杀死在途作业；取消需逐attempt/实例处理。完成要求所有必需节点、审阅门和交付事实齐备，不以Agent自报或单个job成功推断。

Host验证DAG无环、每个输入来自明确版本的产物或参数、类型匹配、能力版本可用、scope与输出路径受控、重试/取消/恢复语义完整。条件分支采用受限、可验证的结果/审阅状态条件，不提供任意JS/Python/Shell表达式。未知能力/自引用/缺输出/绕过审阅门一律拒绝。

## 2. Agent对话确认与可信批准

前期内容问答允许Agent经MCP提交用户选择及来源，持久记录为agent_conversation/driver_relay的内容Decision；Host不将其伪标为可信UI人类批准。这类决定可修订简报、脚本、风格草稿及发布候选计划，不能凭actor=human或confirmed=true获得新的付费/外传/服务接管/工程提交权限。

执行在既有可信授权范围内的本地准备可自动进行；模板发布本身不授予所有节点执行权。新增权限或正式采用仍用原可信确认机制。具体客户端如果能提供经过验证的独立用户确认通道，可在CP登记；普通Agent文本不能充当该通道。不具备可信通道时，仅高风险授权生成一次受信确认链接，普通内容问答仍在Agent闭环，避免把全部前期对话搬到网页。

制作后的候选/章节/音频/封面审阅、稳定授权和当前RunPlan影响确认在工作台形成可信决定；Agent读取同一记录，不另造一份批准。不同渠道的同一请求只消费一次，迟到/旧输入的决定标stale。Agent说“用户没意见”不是接受。

## 3. MCP开放能力清单（拟定；尚未注册）

现有S0候选名称继续按原注册表处理，不随意改名。以下工作流增量拟用同一Host应用端口映射，业务producer不等于生产registry/DDL owner；MAIN统一注册，BRIDGE实现协议外观。

| 能力族/候选工具 | Agent可做什么 | 服务端约束与返回 |
|---|---|---|
| capabilities / context / workflow_read | 发现已登记语义能力，读模板、项目、run、审阅/检查点与当前画面状态 | 权限过滤、分页、版本/可用原因；无token/绝对路径/媒体大对象 |
| workflow_template_draft / revise | 按语义能力创建或修改草稿，声明参数/依赖/审阅门 | expected_version CAS、类型/引用/环/权限验证，返回版本和差异；不运行任务 |
| workflow_template_validate / publish / deprecate | 请求Host校验，保存固定可复用版本或停止新调用 | 发布绑定已确认的创作路线/内容Decision和通过的执行摘要；未确认则待办；保留旧版本供已有run继续，publish不授执行权 |
| workflow_run_prepare / start | 绑定输入、版本、已授权scope，创建运行并请求启动 | 缺授权/依赖/审阅门返回明确待办，幂等；不随意放宽策略 |
| workflow_run_read / pause / resume / cancel | 查询/控制原运行，显式继续或取消 | 控制范围/expected版本/幂等；恢复先核checkpoint与外部receipt，不重提未知副作用 |
| workflow_run_change_prepare / apply | 提出本次未执行部分调整；消费对应人类影响确认后应用 | 保留完成事实；拒热换在途参数、旧版本、跨scope确认或未经复核的重算 |
| review_request / review_read | 发起结构化待办、给用户工作台链接、读取实际决定 | 不提供通用“以Agent身份批准人类请求”的工具；请求不等于决定 |
| stability_recommend / stability_read | 建议稳定、说明证据，查询人类授权与适用性 | 不开放MCP自签稳定授权；版本/风格变化使旧授权失效 |
| task_prepare / job_read / job_cancel | 调用已登记语义任务并观察/取消其attempt | 统一持久Job、资源与费用授权；外部unknown先对账；结果进入Artifact/Asset |
| change_prepare / change_apply | 准备真实镜头变化，已有可信批准后受控采用 | 保留impact/base/三类锁/许可/approval/严格409；一次revision+1 |

这些是命名与能力设计，不代表现有`/api/agent/v1`已经可用。能力内部至少可区分：asset.search/download、media.generate_image/video、audio.synthesize、subtitle.align、clip.prepare、snapshot.render、qc.inspect、delivery.package、runtime.ensure_ready；只有实际交付且通过探针的能力才available。注册外部本地MCP服务需固定服务身份、版本、工具映射、权限/副作用与健康探针，不允许Agent任意连接服务或把外部工具裸转发为工程写权。

## 4. 运行中调整的具体顺序

1. Agent读取run_plan_version、步骤/attempt/输入与已经完成的结果，提出声明范围的patch。
2. Host校验能力/依赖/授权，构建新RunPlan候选，计算要新增/停止dispatch/重算的子图，明确保留的结果及审批/稳定授权影响；原计划此时不变。
3. 活跃运行的RunPlanChange无论创作阶段，都通过已注册可信用户确认通道审阅影响，V1默认工作台；Agent提供直达链接。普通Agent对话转述不能消费该确认。前期尚无活跃运行时修改模板/内容草稿，仍在Agent闭环，不要求逐条到网页。人类拒绝则原计划不变；接受绑定新旧版本和影响摘要，不是给Agent任意修改权。
4. Host在短原子边界重查expected_run_version、步骤状态/输入及决定；若某节点已经从未执行变成运行中，旧patch拒绝为stale并重新算影响，不抢改在途任务。
5. 原子登记新计划、决定消费、失效/保留关系和调度事件；未执行节点按新计划调度，旧attempt输出隔离。影片source/revision仍不变，直到另一次原受控采用。

模板稳定授权只作用于已确认范围。RunPlan变化不得偷偷删掉样片/首章/章节/风险门；计划变化影响授权条件时将其标stale并要求相应复验。断线/取消/崩溃后的恢复按持久计划版本进行，不以Agent内存里的最新描述替换Host事实。

RunPlanChange准备时，Host原子登记受影响未执行节点的dispatch barrier及计划版本；等待审阅期间仅该子图停止派发，不预占长期GPU/worker执行槽，独立已授权分支可继续。已有在途节点保持原输入；如必须停止，先明确取消/对账，不热换。拒绝或过期后撤掉对应barrier并重核原计划的全部门再继续，不能借“恢复原计划”绕过新风险。并发准备/取消/手动操作若已改变步骤状态或barrier归属，旧apply必须stale；客户端不能自行声明哪些任务独立。

## 4.1 所有副作用入口共同执行的门

Host不只在workflow_run_start检查门。MCP task_prepare、UI准备、子job派发、resume/retry、系统load/warm、另建run及计划变更后派发均进入同一授权/依赖检查。每项有服务端绑定的project/run/plan/step/attempt/input_digest、ExecutionGrant、能力配置与实际状态；客户端标“独立任务”不能免除样片/首章/风险和权限检查。

另建run重新绑定自己的输入、审阅与适用稳定授权，不能凭同项目另一个run已审通过而继承。无run的即时有副作用命令也要明确受信授权scope；不允许用临时任务、嵌套流程、伪装预热/重试或外部MCP旁路执行本应等待审阅的批量生成。只读健康/能力探测可独立继续，不能借检查入口启动媒体生成。

稳定授权复核实际有效的模板执行摘要、参数/风格override、内容类型与已登记模型/能力指纹，不只检查客户端递交的profile ID。缺失/未知指纹不能当作相等；相关变化或质量问题使scope不再成立时置stale，并在越过相关门之前再次检查。授权只对明确的用户与复用范围有效；即使允许同模板跨运行复用，也不继承另一项目的费用/外传/工程采用许可。撤销/过期只阻断未来尚未授权的派发，不自动kill未知或在途任务。

## 4.2 一次审阅动作与后端权限分离

章节/候选审阅涉及正式采用时，可在展示有效impact、范围与保留项后提供一次“确认并采用”。同一个可信交互记录ReviewDecision和限定Approval；正式提交时仍重验并消费Approval，与revision/active_commit/业务outbox同事务。纯审阅不授提交权，过期或改输入需重新确认。同一决定跨端消费幂等，不要求用户为同一未变化内容重复确认。

## 5. 实体与阶段分工增补

MAIN在既有E08/E10/E12/E19中负责ExecutionGrant、稳定授权、RunPlan CAS/决定消费、持久调度与资源互斥、生产注册；PRODUCT在E15新增TemplateVersion/RunPlan/ReviewRequest业务与章节审阅适配，E04/E05只展示阶段/任务细节/系统状态；BRIDGE在E07/E13做MCP映射、上下文与事件；MEDIA在E20/E21提供已登记执行器、样片/章节/声音/封面产物和runtime。

A交付首条可独立继续的固定版本本地流程、样片/首章门、章节包和阶段展示；B补齐通用已登记能力组合、稳定授权/运行调整、真实模型与完整媒体能力；C在长片/三端范围总验。A若尚无稳定授权实现，保留首章验证，不能前端自行隐藏；若运行中通用改图留B，A需真实支持原改单镜/依赖范围，并明确其子集。A/B/C包数和原35族不变。

## 6. 新增直接验收子case（全部NOT_RUN）

| 编号 | 用户场景与操作 | 必须达到的门槛 | 对应既有门 |
|---|---|---|---|
| EX-01 | 新流程开始，前期在Agent确认主题/脚本/素材策略/风格 | 同版本内容Decision持久；不让用户复制ID；没有伪造安全授权 | T05/27 |
| EX-02 | 进入制作，Agent提示去工作台看小样 | 真实项目/审阅链接直达，明确待决定事项；UI确认后Agent读取同一结果，无二次确认 | T03/10/33 |
| EX-03 | 顶部观察阶段，点击节点弹窗 | 默认无冗余任务树；详情输入/任务/attempt/输出/等待均有真实来源；关弹窗不暂停/改工程，焦点返回 | T15/32/33；R4-07/11 |
| EX-04 | 新模板/风格首次制作 | 样片接受后才越过首章验证；首章未接受不启动依赖它的后续高成本批量制作 | T06/27/31 |
| EX-05 | 单章短片，小样已覆盖完整同一产物 | 同摘要、同规格审阅明确复用，不重复逼用户确认；输入变更不能复用 | T06/15/27 |
| EX-06 | 多次良好记录后Agent建议稳定 | 有实际审阅证据；无固定次数自动放行；没有人类确认则首章门仍有效 | T27/31/34 |
| EX-07 | 用户确认稳定后新运行 | 只在绑定的模板/风格/内容类型/模型范围省首章门；样片/章节/QC/采用批准仍有效 | T12/27/31 |
| EX-08 | 改风格/模板/相关模型，或用户撤销稳定 | 旧授权stale/revoked，待越过的首章门恢复；不偷取消其他在途任务 | T12/14/31 |
| EX-09 | 工作台审整章，发现一处音频/字幕/镜头问题 | 音画字幕同一包/版本；可定位局部；封面独立；接受/修改与关闭有区别 | T10/11/17/19 |
| EX-10 | 多任务有相同正常准备或同一异常原因 | 普通技术细节自动执行；未变化的待办合并；无每次轮询弹窗；风险判断有依据/未知标识 | T15/18/35 |
| EX-11 | Agent组合已登记能力，包含缺依赖/环/未知能力 | Host逐项拒绝无效图，草稿/校验/发布分开；失败无执行，发布不授运行权限 | T02/26/31 |
| EX-12 | 启动固定模板后Agent退出、关闭UI | 已授权确定步骤继续；需要Agent推理才waiting_agent；已声明审阅门可由UI满足；不擅起额外Agent | T07/09/13 |
| EX-13 | Agent修改正在运行流程的未执行部分 | 展示保留/重做/风险；拒绝原计划不变；确认后CAS应用，影片revision不变 | T12/28/31 |
| EX-14 | 影响审阅期间某节点已开始执行 | 旧patch拒绝/重算影响，不能热换参数；重复apply不重复调度，旧attempt不能污染新计划 | T09/12/28/31 |
| EX-15 | 当前节点需要未加载的登记模型 | Host自动申请资源并加载/预热；面板说明为哪项准备；accepted/loaded/warm/ready分别真实可证 | T29/32/34 |
| EX-16 | 共享实例/未知任务/资源紧张时准备或卸载 | 不越权接管/清队列/卸载；不明状态先对账；新任务与卸载原子互斥，低价值探测不反复求确认 | T18/28/34 |
| EX-17 | 新模型下载/安装节点/扩大付费外传范围 | 未授权则blocked/待确认，自动准备不能暗含新权限；许可等硬失败不能点继续绕过 | T12/16/18/26 |
| EX-18 | 恢复/取消/重连并收到旧执行或旧审阅回报 | 与run/plan/attempt/input匹配；对账不重提，旧决定不消费，晚到结果不采用 | T09/18/31/33 |
| EX-19 | 在首章/风险待审时直接task_prepare、子job、重试、模型预热或另建run | 所有副作用入口按服务端scope/依赖检查；禁止客户端自称独立或借检查绕门，等待子图无生成副作用 | T02/12/28/31/34 |
| EX-20 | 以Agent relay或confirmed=true确认活跃RunPlanChange | 不能消费可信确认；返回真实确认链接；普通前期草稿问答仍可在Agent闭环 | T02/12/27 |
| EX-21 | 等待修改计划审阅时并发派发/取消/资源申请 | 受影响未执行子图有barrier且不占长期执行槽，独立分支继续；拒绝后重核原门，冲突旧apply拒绝 | T09/12/28/31 |
| EX-22 | ID不变但风格override、模型指纹/内容类型变化；撤销稳定或跨项目复用 | 比较实际scope摘要，未知不算相等；相关门恢复；不继承费用/外传/采用授权，不误杀在途 | T12/18/26/31/34 |
| EX-23 | 用户一次章节“确认并采用”，并重放/制造过期 | 正常只需一次UI确认，后端决定/批准分离且+1恰一次；纯审阅无写权，过期重新确认 | T10/11/12/15 |

所有子case需真实Host/已注册执行器与逐项事件/版本/媒体/授权记录；本轮对话和文档不涂绿产品。具体样片质量/长时风险提醒策略、runtime/许可/provider版本与通道验证在CP冻结，不能临场改验收阈值换PASS。
