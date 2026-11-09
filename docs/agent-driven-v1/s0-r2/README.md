# S0 R2：在现有剪辑工作台增加可见性

最新用户纠偏：前端只新增工作流展示面板和控制台面板，继续展示现有剪辑状态，用户在Agent操作时能看懂发生了什么，提前介入以减少返工。上一版独立创作工作台原型偏离这一目标，现作为历史候选保留，不再指导前端实现。

入口：review.html；单独原型：prototype.html；接线图：architecture.html。状态S0_R2_REVIEW_CANDIDATE；用户核验待完成，CP-A0/生产实现仍NOT_RELEASED。旧s0目录及FREEZE原样保留，本版只替代前端呈现/接线和对应任务，不宣布后台制作、下载、配音或视频验收已经实现。

## 1. 前端范围锁定

保留OpenFilm素材库、实际播放器、检查器、原生时间轴，保留M5导演面板的选区、锁、提案、素材化、影响确认、采用、历史入口。沿用同一页面、React挂载根、GatewayApiClient、SelectionStore/PlaybackClock和SelectionCoordinator。不开第二工作台/聊天入口/时间轴，不把用户重新引入创作长表。主题和任务继续由外部Agent驱动；需要审阅或批准时定位原有UI。

只新增导演面板内两块可折叠section：
- 工作流：当前目标、镜头/时间范围、Agent身份、步骤、依赖、Job/attempt、等待原因、输入输出引用、是否已写工程与下一步。点击节点只复查；点击“定位镜头”调用既有选区/定位，不执行剪辑。
- Agent控制台：已公开的动作摘要、Host受理/开始/准备/批准/提交记录、脱敏结果/错误、服务健康及更新时间。默认只读，过滤和复制诊断；不是任意Shell，也不展示模型隐藏推理。Agent说明标“未验证”，只有Host事实能推进业务状态。

两块面板在现有导演面板header/facts之后、原业务控件之前插入；原控件保留原顺序/事件。两面板默认收起，工作流摘要常驻显示目标/当前步骤/写入与同步状态；未读错误摘要始终可见。展开只占原导演列，不掩埋默认业务入口。新增内容仅使导演列可滚动，不以浮层遮盖原生时间轴，不添加左侧导航或新页面。窄屏继承旧M5审阅限制（原生精剪≥768px），不声称手机可完整剪辑。

## 2. 原型与事实边界

本原型以真实历史UX-11截图作为保留区，CSS分栏只为演示在原导演列插入两块DOM，原图字节不改。素材/播放器/检查器/时间轴/原导演控件在本页是截图、不能操作，新增面板使用明确模拟事件，不连接Host/MCP/Comfy。基线图来自capture ff807c3；当前df4ef57与该捕获在src/app/m5和src/host/m5无源码差异，但这不等于本轮重新运行或验收了旧UI。baseline.json绑定图和源码SHA。

演练工具条在工作台外，明确“非产品新增控件”：模拟Agent受理→读取选区→准备镜头2候选→等待确认→Host提交r2→编辑区同步未确认→模拟加载确认。图像始终是历史r1，即使模拟确认后也明示“底图不变”，不能当真实剪辑或原生刷新证据。

## 3. 防黑盒的状态合同

| 用户问题 | 必须展示的事实 | 来源/边界 |
|---|---|---|
| 它想改哪里？ | 目标project、shot/time range、保留旁白/时长、原base | Agent公开意图可展示，标未验证；Host受理范围另列 |
| 它现在在做什么？ | 节点、Job、attempt、正在准备/等资源/等我/失败 | Host持久事件与受控worker报告；无百分比就不造百分比 |
| 视频已经被改了吗？ | 尚未写入/已提交transaction、revision与snapshot | 仅Coordinator commit事实算已写入 |
| 我看到的是新版吗？ | 期望commit与编辑区loaded revision/snapshot分别展示 | Job成功≠commit，commit≠编辑器加载完成；无native证据显示未确认 |
| 有什么需要我处理？ | 错误、影响范围和跳转既有批准/锁/历史入口 | 观测面板不再造批准/采用/恢复逻辑 |

不因Agent开始就移动播放头/改变人类选区。用户显式点定位才跳转，既有播放时钟保持唯一；人类未保存草稿不被事件覆盖。提交事件到达先刷新工作台projection，当前工程不匹配则不自动加载别的项目；原生加载完成后读桥接project/revision/snapshot与期望值比对。有人工未保存编辑或正在播放时显示新版本提示，按既有安全更新机制处理，不强制重载丢内容。无法获得真实loaded snapshot时保持“同步未确认”，不能用Host查询新值代替编辑器确认。这个桥接探针是A必须闭环的实现风险。

## 4. 架构与接口增量

新增PRODUCT `src/app/observation/{WorkflowPanel,AgentConsolePanel,ProjectObservationAdapter}.tsx`和轻量hook；组件只接typed props/read ports，沿用M5主题tokens。MAIN在M5Panel内做小范围导入/插入，panel.tsx的唯一createRoot不变，不迁移旧业务控件。BRIDGE提供Host WorkflowEventProjector/ConsoleReadModel，读既有Job/outbox/项目commit；日志不是第二事务或工程事实库。MEDIA准备/渲染worker报告结构化动作与真实进度，不直接发布工程。

拟新增只读GET /api/agent/v1/projects/:id/observation与共享SSE游标消费；observation.schema.json给出精确目标DTO。已有s0接口是未注册的后台目标候选，除前端呈现假设外继续保留；没有因展示面板增加而扩大EnginePort七方法、另建数据库或放开工程写入口。

EditorViewReadPort是UI本地只读桥接：读当前加载的project_id、revision、snapshot_id、selected refs与观测时间。真实原生桥接不能提供时返回unknown，不在Host伪造ack。它不授予source写权限，也不成为持久工程权威。UI连接状态/样本年龄在客户端独立维护，不能把Job状态改成断线；业务事件沿现有SSE snapshot+scope cursor去重/重连，先前关于Last-Event-ID优先规则保留。

控制台不读任意终端窗口、不执行Shell、不展示环境变量、token、绝对路径或原始模型请求体。只展示公开动作/安全摘要，内容作为文本渲染，不执行HTML或日志内链接。Job取消走既有受控接口；“请求取消”不等于“已取消”，更不等于关闭整个Codex/Claude终端。提交后的内容回退仍走原有history，不提供“撤回日志即撤回剪辑”。

## 5. 开发计划调整（不新增大阶段）

保留S0+A/B/C、17包和所有PRD功能验收。只重排前端实现：A1先让既有工作台收到一个真实Host动作/Job与commit事件，形成可见操作链，再扩展一般新建与真实短片。A03/A05由PRODUCT实现两面板/复查UI；MAIN负责M5最小接线与真实原生同步探针。取消独立agent-workbench/App和自建剪辑页任务。B在同两块面板补队列/资源、节点资料复查与复用现有批准入口；C补长片/多驱动观测压力证据。后台MCP、一般项目创建、素材/声音/渲染仍按原计划实施，不能只交两面板就说短片或V1完成。

三目录仍Codex设计/文档/验收、Claude具体实现，429停旧writer后Codex接手。PRODUCT白名单改为src/app/observation/；M5Panel/panel.tsx/stores/Gateway共享文件由MAIN最小接线；其他泳道无权直接改旧M5。实现前MAIN汇报实际任务与Agent状态，阶段末统一真实链/独立复核/人工验收。当前只有文档/原型，未启动生产实现。

## 6. 逐case验收（目标，生产均未执行）

| 编号 | 操作 | 通过门槛 |
|---|---|---|
| OBS-01 | 打开旧工程/折叠展开面板 | 同一Studio页面和挂载根；原素材/播放/检查器/时间轴/导演功能均可用；无新路由或第二clock |
| OBS-02 | Agent经MCP真实替换镜头2 | UI呈现读取→准备→待批→commit，范围/保留项与Host日志一致，准备阶段revision不变 |
| OBS-03 | Job成功但未commit | 不能显示“视频已更新”；有Job/产物引用，无假完成 |
| OBS-04 | commit后尚未原生加载、随后完成加载 | 分别显示commit rN和编辑区loaded rM/unknown；真实bridge确认后才标匹配，原生镜头可见 |
| OBS-05 | 人工选镜头3并输入草稿时Agent事件到达 | 不抢选区/播放头、不丢输入；用户点击定位才切镜头2 |
| OBS-06 | 两项目交错、旧attempt/乱序/重复事件 | 错项目不更新；scope/cursor/版本去重，未读错误可定位，重连不重做剪辑 |
| OBS-07 | 断线、样本超15秒、恢复 | 显示最后状态与真实采样时间/unknown；无缓存绿灯，重同步不提交 |
| OBS-08 | 取消中→晚到；提交后要求取消 | 等worker确认，不提前写已取消；晚到隔离；已commit提示走受控恢复 |
| OBS-09 | 日志含脚本/token/路径、全量遥测不可用 | 文本渲染/脱敏/分页、缺指标unknown；无任意Shell |
| OBS-10 | 真实端到端与资源负载 | 事件正常连接p95≤2秒、5s/15s健康规则，旧M5全量回归及短片/双导出继续通过 |

本轮HTML测试只证明新增面板模拟交互、布局与状态分离，不冒充上述生产case通过。重点人工核验：是否仍是原来的工作台，是否一眼知道Agent在改哪里、有没有写片、画面是否同步、接下来需不需要介入。

## 7. 精确观测更新与组合数据约束

Observation新增goal、authenticated_host_session提供的Agent身份（客户端自报名字不等于验证供应商）、Scope.range、Step.dependencies/input_refs/output_refs/next_actions及HealthRead。输入输出只传opaque ref，时间范围是当前操作范围，不保存全片timeline。HealthRead沿用旧s0相同schema定义，保留独立采样/TTL，不因读取业务快照而把旧样本变新。range必须end>start，shot/refs须与project事实一致，由服务端语义验证；schema不伪称可比较所有跨字段关系。

共享SSE Event仅作为失效通知，不含完整Observation patch。订阅适用project的事件后，adapter以最大event_id为required watermark，GET一致Observation快照。响应携带instance_id/generation/view_scope_id和同事务snapshot_event_id；若后端投影未追上水位返回503，不先发旧状态当新。UI切项目会增加本地epoch；回包若epoch/scope/generation不同、watermark低于required/已应用值则丢弃并重读。相同水位仅接受不早于已应用请求序号的回包；health还要单独按observed_at拒旧，不能刷新旧TTL。取消/新attempt同理走事实重读，Agent公共说明只能进日志，不能推进Step或last_commit。

Job/工作流/commit各类变更必须在同库事实写入时产出既有outbox失效事件；MAIN逐producer补接并测试，不能假定旧Job所有路径已经做到。原生EditorView独立从本地bridge读取，不随Observation回包覆盖。OBS-06必须测试切项目途中响应、GET乱序、旧attempt、等水位健康样本和投影落后。

空态是合法事实：agent_identity=null表示没有活动驱动，Scope.range=null表示尚无Host受理操作范围；goal可空、steps可空、last_commit可空。旧工程/空created工程照常打开，两面板显示暂无任务，不要求填造Agent、镜头或时间范围。背景Job还在执行但驱动已退出时，identity可为空、步骤仍来自Host；不因无Agent就判Job取消。

控制台可合并UI本地native桥接回报，但须标“UI本地观测”，不把它写成Host commit/outbox事实；它只用于当前编辑区同步提示，不能改变last_commit。
