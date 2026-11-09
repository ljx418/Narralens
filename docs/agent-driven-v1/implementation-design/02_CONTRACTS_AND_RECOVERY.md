# 接口、数据、控制与恢复设计

状态：DESIGN_FOR_REVIEW，未注册生产、未执行迁移。架构原则与R4目标已认可；本文件的精确设计仍需IT-P02审查/CP与用户实施授权。旧S0合同保持冻结，不原地修改。先用已有adapter、Coordinator和registry，禁止裸转发任意原生写入口。

体验交流后的字段/语义增补以`07_EXPERIENCE_SPEC.md`和`08_WORKFLOW_MCP_CONTRACT.md`为准：前期Agent对话可转述内容Decision但不是可信安全批准；制作阶段章节审阅与采用可用一次UI动作、后端分离ReviewDecision/Approval。新增模板版本、RunPlan版本、稳定建议/授权与运行变更语义需进入CP，旧S0 Decision只覆盖简报确认，不能冒充已支持这些类型。

## 1. 合同基线与命名

已有合同：根`contracts/`与`src/contracts/{types,engine-types,wave2-types,wave3-types,validator}.ts`；已有HTTP/Gateway在代码审计表中。未来Agent外观先沿用`s0/registry.json`中的`narralens_artifact_put`、`narralens_job_read/cancel`等候选名；旧概念文档中的artifact_submit/task_read/cancel只是历史别名，未实现兼容前不得向客户端同时宣传。API前缀`/api/agent/v1`是目标，不是现有路由。

CR-DOC-001将本设计作为旧S0候选的增量：拆清trusted approval/selection、一般project origin、项目级事件与native ack、系统生命周期。A的Brief可以60–180秒为限定首链版本；不能把此限制锁进完整V1，B/C支持PRD长片规格。Artifact扩展采用带version/discriminator的明确schema，不放开任意JSON。研究/主张/引用、Question/Answer、候选选择和brief确认分别定义，不把同一Decision结构强行泛化。

## 2. L1接口与责任（拟定字段，不是当前API）

公共输入带schema_version、correlation_id；有写副作用的输入带idempotency_key、业务输入版本和授权引用。project_id/相对asset ref可由客户端传，绝对server路径、credential、shell和SQL不可传。只读默认最小分页，媒体只返回受控引用。

| 合同族 | 必需输入与服务端事实 | 必需输出/错误 | producer / consumer / 注册 |
|---|---|---|---|
| HostInstance/Application | client_protocol/version，可信会话；受控rendezvous读取实例 | instance_id、协议/工具版本、归属、可用能力与reason；不回token | MAIN / BRIDGE+UI / MAIN |
| ProjectBootstrap/Read | confirmed_intake_id/version、key；MAIN确认范围/身份，控制目录 | project_id、origin=new/migrated、initial snapshot/revision、workspace HTTP URL或持久job；失败补偿，重复同key同结果 | MAIN / PRODUCT+MEDIA / MAIN |
| CreativeRepository | artifact_kind、project、base_artifact_version、typed content、input refs/hash、key | immutable artifact/version、validation、lineage、revision CAS冲突；影片revision不变 | MAIN存储+PRODUCT业务 / UI+MCP / MAIN |
| Question/Decision | question/selection id及version、回答/选案、可信会话；选区含workspace/selection_version | decision_id/version、supersedes；过期问题/选择拒绝，选案不提交 | PRODUCT / BRIDGE+UI / MAIN |
| ChangePrepare | project、base、selection_version、selected proposal/version、binding refs、key | change_id、materialization/job、server plan/impact、before/after与保留项、requires_approval | MAIN应用+既有Materialize/Impact / UI+MCP / MAIN |
| Approval/Apply | approve：可信UI、change/impact/base、action/input digest；apply：approval_id、key、driver_epoch（适用时） | project绑定、期限、状态、consumed transaction；冲突409、锁423、过期/缺影响428按既有alias映射；失败不增加revision | MAIN / PRODUCT审阅+BRIDGE调用 / MAIN |
| EventSnapshot/Cursor | project、after cursor、filter；服务端权限与保留窗口 | snapshot+watermark、顺序event_id、source/attempt/input version、observed_at、resync_required；不漏初连窗口 | MAIN日志+BRIDGE投影 / UI+MCP / MAIN |
| EditorView/Selection | 受信Gateway/原生桥回报project/loaded revision/snapshot、selection及观察时间 | 实际loaded/unknown和selection_version；不同项目/旧ack拒绝 | MAIN桥+PRODUCT适配 / UI+MCP只读 / MAIN |
| SystemState/Lifecycle | instance_id、registered runtime/model config_id、有限action、key、scope；MAIN查owned/shared及活动/未知任务 | job/operation_id、accepted/loading/warming/ready/unknown、reason；不把受理返回成ready | MAIN命令、BRIDGE读、MEDIA执行 / UI / MAIN |
| ResourceClaim/ProviderReceipt | task/attempt、pool/capacity、lease/epoch、provider request digest/receipt | granted/waiting/expired、外部ID、result/charge known/unknown、允许恢复动作 | MAIN / MEDIA+BRIDGE观测 / MAIN |
| AssetRead/Register | stage ref、bytes SHA/真实probe、来源/许可/授权与provider lineage | registered asset_id、inventory/rights digest、可用/blocked原因 | MAIN / MEDIA+PRODUCT / MAIN |
| SnapshotRender/QC/Delivery | committed snapshot_id、project、固定engine/config、output spec、key；读取授权闭包 | 持久job、真实MP4/ffprobe/完整decode、QC项pass/warn/block/NA及原因、交付manifest | MEDIA / UI+MCP / MAIN |
| DriverSession（B） | attach/heartbeat/takeover、project/client身份、epoch、接管授权 | 单活动编排者、lease/fencing、接管事件；迟到驱动拒绝，worker有效任务保留 | MAIN / 三端 / MAIN |

A只开放已完成、已测的能力，未支持的系统写操作返回blocked并说明；B真实runtime接通后才开放模型装载按钮。未知或缺失能力不能放开任意URL、workflow JSON或native operation代替。

## 3. 权限与幂等矩阵

- MCP可提交草稿/prepare/read；不能调用trusted-ui批准路由、伪造人类选择/扩费用/外传范围。经用户预授权的自动动作也必须有服务端绑定的scope记录，不能沿用客户端confirmed布尔值作为新批准依据。
- UI与MCP共享应用服务与幂等权威。相同project/action/key/digest重放同response/job/transaction；异digest同key409；越项目404/权限拒绝，资源查找前先auth/Origin。错误details脱敏，不回绝对路径、token或prompt原文。
- Apply最终检查base、source闭包、control/三类锁、资产许可、materialization currentness、server impact/hash、approval scope/期限/消费、driver fencing；再受控发布及原子commit。原有严格409不被上游rebased=true绕过。
- 取消前置准备：终止/标记原attempt，只保留可审计产物；取消后晚到结果不自动采用。prepared之后的工程事务不靠任意kill中断，按现有状态机收敛或attention。

## 4. 存储设计与索引（目标表，不执行SQL）

| 表族（拟新增） | 主键/唯一约束 | 主要字段与检查 | 同事务关系 |
|---|---|---|---|
| creative_project_origin | project_id唯一 | origin、创建intake/version、initial transaction、受控root ref；new不伪装migration | bootstrap初始snapshot/binding/commit一起登记；失败留可恢复记录 |
| creative_artifact | project/id/version；project/key唯一 | kind/schema、typed content、input digest、parent refs、status、created_by | 不变版本与创建事件一起写，编辑CAS |
| creative_workflow / workflow_step | project/workflow_revision；step/attempt复合键 | dependencies、input refs/version、job/artifact/decision refs、state/reason | DAG无环检查与revision CAS；step与job关联事件原子持久 |
| creative_decision / approval | decision_id、approval_id；消费transaction唯一 | authenticated actor、project/action/base/hash/scope/expiry/state | 选择与批准分开；approval消费与正式commit/幂等/outbox同DB事务 |
| driver_session / resource_claim | project活动driver唯一；resource slot/lease唯一 | owner/client、epoch、expires_at、attempt、pool、容量 | fencing/claim CAS；不能对多个Comfy端口重复计算同块GPU容量 |
| provider_receipt / delivery_manifest | provider instance/request digest/attempt唯一；delivery id | external ID、结果与费用状态、bytes/probe、snapshot、config、QC与附属引用 | 外部副作用先登记意图；unknown不自动重发；发布交付与事件关联 |

具体字段编码、CHECK枚举、索引与升级DDL在CP-A0/CP-B0/CP-C0按责任冻结；全新库、旧M5/Wave库副本、升级中断、重复升级和旧schema拒绝均是强制向量。旧表的active pointer实际是`active_commit`，不得误写成不存在的project_state.active_snapshot_id。本轮设计不声称新增表已存在。

## 5. 状态机与恢复边界

创作step：pending→running/waiting_resource→waiting_user/succeeded/failed/cancelled/stale；输入变更使相关消费者stale，不删除独立结果。影片提交仍使用既有project_transaction状态机；不可另造workflow.committed决定影片成败。系统命令：requested→accepted→loading/warming/stopping→verified ready/stopped；缺回报为unknown，不能据浏览器定时器变成功。

启动必须保留现有专项恢复顺序；新恢复在相应依赖就绪后注册，不把通用recovery放到专项adoption/history之前。具体边界矩阵：

| 注入位置 | 重开后必须出现的结果 | 不允许 |
|---|---|---|
| create建目录后/初始DB提交前 | 清理自己staging或按记录幂等恢复；不产生可打开的半工程 | 创建假migration/重复project |
| provider已受理但本地未知 | 查provider receipt/外部ID；无法核实则unknown+阻断付费重提 | retry盲扣费/取消他人任务 |
| proxy完整但晋升中断 | 以行状态CAS和bytes摘要恢复可达；不将有效结果置不可恢复stale | 重复发布覆盖他人staging |
| 最终影响检查后/正式prepare前 | 重查变化事实，拒旧base/锁/许可/授权 | 携带过期的第一次读取结果 |
| prepared/发布中/DB commit前后 | 按journal/publisher事实收敛至新commit或可解释attention；版本0或+1 | source/pointer/revision分叉或+2 |
| Host已提交/native未加载 | 显示待同步，重读原生actual版本；无ack不宣称完成 | 以Host rN复制填native rN |
| UI关闭/Agent退出/lease失效 | Host持久任务继续或按策略暂停，新驱动读取checkpoint；旧epoch拒绝 | 删除工程、串改别的attempt |
| Host关闭/进程被真实终止 | worker/心跳停止触库，await受控终止或留持久可恢复记录 | 已关DB后的未捕获回调/孤儿worker |

## 6. CP冻结和适用性

CP-A0覆盖A完整垂直链：instance/auth、project origin/bootstrap、artifact/brief/questions、selection/可信approval、change/job/event/native ack、snapshot render和最小QC。CP-B0在其上扩展多候选/依赖、driver/资源/费用、下载/Comfy/声音/完整QC。CP-C0扩展长片、风格、反馈与全后期。

每次冻结必须给runtime schema/TS/validator/registry/alias/DDL差异、黄金向量、producer/consumer、取消与恢复矩阵、fixture和实际命令、许可证/固定版本及回退。当前为设计文档，不能将CP状态写FROZEN或把计划中的命令当已运行。未闭环的精确字段/版本可继续文档设计，不得交实现者临场发明。

## 7. 正式导出与交付原子发布（AD-T20补充）

正式导出在独立UUID staging中工作，输入固定committed snapshot与render config/hash，不能因为影片又修改而改绑最新版。只有encode退出成功、ffprobe与完整decode通过、要求的附属文件齐备且QC无block，才以无覆盖/幂等方式原子发布完整delivery manifest并提供ready/download引用。交付发布与事件记录关联，崩溃后能按manifest/receipt核实；半成品不进入正式下载列表。

磁盘满/写失败、ffmpeg失败/损坏帧、输出重名/并发、取消、render完成但QC未完成、publish/DB前后真实进程退出分别有独立子case。取消等待子进程与心跳停止；晚到产物只隔离，不自动变ready。清理仅自己staging；已完成包不可被后续重试或loser cleanup删除。可重试错误保留原snapshot/config，异输入使用新attempt；外部付费渲染结果未知先对账。
