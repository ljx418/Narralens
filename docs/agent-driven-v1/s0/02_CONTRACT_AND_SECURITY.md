# 首轮精确接口、权限与序列化

contracts.schema.json是单一字段源，contracts.ts为生成镜像，registry.json是目标路由/工具/资源清单；它们没有注册到生产。只冻结首轮A边界，B/C在各轮开工前另冻，不承诺所有未来字段。

## 1. 分层和实体

BRIDGE `src/mcp/{server,tool-registry,resource-registry,host-client}.ts`仅翻译协议/身份。MAIN `src/host/agent-driven/composition.ts`接旧Host/唯一RevisionStore，持有ProjectCreation/Command/Approval/Snapshot端口。PRODUCT `src/host/creative`和workspace实现Intake/Artifact/Workflow read model；`src/app/agent-workbench`通过同源HTTP/SSE消费。MEDIA render/preflight/delivery从SnapshotReadPort读取，只产生Job结果与资产，不能写source/pointer/revision。现有EnginePort七方法、Coordinator、snapshot/journal/锁与旧回归不变。

新代码目录owner见parallel-plan，公共server、schema、错误、DDL、配置、旧M5只由MAIN改。目录Codex设计/文档/验收，同目录Claude具体实现；429后Codex核实原writer停止再接手，另取未参与者复核。

## 2. 传输与版本

MCP首端采用stdio，协议基线固定2025-11-25（不是声称最新），官方SDK候选固定1.26.0/MIT与registry完整性摘要；metadata已读不等于安装或兼容实测。不新增HTTP MCP，不为每个工具创建Host。stdout只含JSON-RPC，日志到stderr。SDK协商不支持基线时明确拒绝，不手写假成功协商。工具unknown/JSON参数非法是协议错误；业务拒绝返回isError=true与Error结构，成功structuredContent必须过输出schema。readOnlyHint等注解仅提示，不能授权。

官方依据：https://modelcontextprotocol.io/specification/2025-11-25/basic/transports 、https://modelcontextprotocol.io/specification/2025-11-25/server/tools 。完整schema不是MCP协议本身；SDK包装后仍须真实tools/list/call/resources/read探针。UI沿同源HTTP；错误真实4xx/5xx，不包装200成功。

GET的input是路径/查询展开DTO，不发送GET JSON body。路径id与body project_id/impact_id/intake_id/job_id必须一致，非法400且零副作用。所有未知字段拒绝；标识符不允许路径、URL、`..`或绝对路径。工具输出不含token、本机路径、stack、任意file URL；媒体返回opaque asset/download_ref，再由Host校验归属后流式读。

## 3. 认证与可信人类

Host只绑定127.0.0.1；生产state root由supervisor决定，Windows在当前用户LocalAppData/Narralens，WSL独立XDG_STATE_HOME/narralens，跨系统不共用可写SQLite。工作区var/dist/DB/端口隔离。用户只通过Host受控导入拿asset_id，不从Agent输入路径构造目录。共享Comfy只读发现，A不提交生成、不中断别人的任务。

生产首启seed在用户私有目录由OS权限保护：Windows需当前用户ACL（仅chmod不算证明），WSL文件0600/目录0700；失败则不发凭据。supervisor discovery只带instance_id/generation/loopback地址/secret_ref，禁止token上URL、仓库或普通日志。MCP环境配置只引用凭据位置，不在明文项目配置复制seed。Host认证发放scoped client token，MCP无trusted_ui scope。instance重启generation变化撤销旧session，旧业务command幂等结果仍可读。

浏览器由用户启动入口一次性bootstrap换取短期HttpOnly/SameSite=Strict会话（本地HTTP不冒充TLS）；bootstrap不进URL/query，入口以本机IPC或短期本地文件POST传递并单次消费。UI写入须会话+同源Origin/Host校验+CSRF nonce；不能从Agent `actor=human`参数授予权限。ConfirmBrief与ApproveChange仅UI权限，MCP根本不注册这两工具。服务端生成actor与scope；文本、日志、资产元数据和提示词均为不可信内容。

## 4. 首轮命令语义

IntakePut首次intake_id=null/base_version=0；更新必须匹配version，否则409。同版本确认绑定brief_sha256；改变内容产生新版本并使旧确认无效。brief无素材可暂存，但创建前必须证明至少一份本地视觉素材和实际旁白/本人录音的许可及可读性，不以schema通过代替媒体检查。

ProjectCreate读取已确认intake，服务端分配project_id/根目录，不接受origin、engine、source path。同一数据库BEGIN IMMEDIATE保留全局命令键并绑定保留的project_id/job，返回202 JobReceipt；既有job.kind=snapshot_publish，payload受控subtype=project_create（不扩张kind CHECK）。job尚无project_state也必须可读，授权从同库command的reserved_project_id证明；未完成context查询409 PROJECT_NOT_READY（Error使用REVISION_CONFLICT+next_actions=read_job），不能404丢失任务。

新建runner通过隔离stage初始化可编辑OpenFilm空工程、闭包验证、snapshot、唯一受控发布/元数据事务完成origin(created)/descriptor/project_state/binding/active_commit。初始revision=0、control_revision=0；首个应用变为1。空工程不能当短片通过；empty初始snapshot与render禁止规则需真实上游证明。不能复用migration identity_map或固定三镜fixture。已reserved的失败重试保留同一project_id；发布前取消不发布；prepared后取消收敛旧事务但不自动发后续任务，晚到结果不采用。该语义须对旧Coordinator实施差距单测，不是现有行为声明。

ArtifactPut版本独立于project revision，base_version=0创建/已有版本CAS更新；input_digest按已确认上游refs计算，调用者给的hash必须重算比对。Script与Storyboard是提议内容，编译器完成语义校验后才materialize，渲染绝不直接读取它们重建另一timeline。shot_id/paragraph_id唯一，引用存在；storyboard总帧应与当前Brief.duration_seconds*30一致；每镜素材都在本项目可访问许可集合。只有经EnginePort生产验证的编译产物才能成为正式影片。

TaskPrepare assemble_draft仅接受当前script+storyboard refs，snapshot_id必须null，映射snapshot_publish受控子任务；worker准备materialization，不增project revision。render_snapshot必须snapshot_id=本项目已committed且闭包可证，input_refs空，映射render，不能读工作目录latest。未知kind/虚构操作422。所有输出JobReceipt在prepared/stale/cancel场景均不自动apply。

PrepareChange通过MAIN调用既有ImpactService，输出Change是安全投影而非第二impact权威。ApproveChange从impact行重新读取base/control/source/selection/materialization/plan/hash/许可与到期，绑定Approval。ApplyChange执行同一项目串行边界内重读并原子consume approval与impact，旧base严格409，不接受上游rebased=true绕过；锁423，缺/过期impact428，批准缺失428，成功一次revision+1失败+0。投影ad_approval不能成为第二事务状态机；prepared前检查与prepared后恢复都必须携带原不可变授权事实。

## 5. 幂等与哈希

幂等scope=(authenticated principal, operation, idempotency_key)，create全局而非project=null导致UNIQUE失效；同键同digest重放原job/response，不新建job/outbox；异digest409。相关correlation_id不影响digest。业务payload递归对象key按Unicode code point排序、数组顺序保留、UTF-8、无空白、字符串保持原始码点不做NFC、-0规范为0、禁止浮点/NaN/Infinity及超过JS安全整数；原型健康小数不参与命令hash。canonical输入必须过对应schema；operation、principal和body均进入preimage，删去meta两字段，保留可信授权ID。SHA256(canonical UTF-8)，黄金向量用独立Python复验。UUID/时间不在待命令payload里由客户端偷偷变化。

## 6. 错误与重试

| HTTP | Error.code | 操作/不变量 |
|---|---|---|
|400|INVALID_REQUEST|schema/路径body不一致，无写入|
|401|UNAUTHORIZED|无效会话；认证在资源查找前|
|403|ORIGIN_REJECTED|非同源/无scope，不泄露对象存在性|
|404|NOT_FOUND|已授权但对象不存在|
|409|REVISION_CONFLICT / IDEMPOTENCY_CONFLICT|base、artifact、选区或同键异内容，重读不自动覆盖|
|410|CURSOR_EXPIRED|游标出保留窗，先重取snapshot|
|422|INVALID_REQUEST|语义/操作不支持，不能重试盲猜|
|423|TARGET_LOCKED|锁/attention，读原因不可自清|
|428|IMPACT_REQUIRED / IMPACT_STALE / APPROVAL_REQUIRED|重新准备或可信人类决定|
|503|HOST_RESOURCE_EXHAUSTED / CAPABILITY_UNAVAILABLE|瞬时读/依赖不可用；前者retryable=true，不能置永久attention|
|500|INTERNAL_ERROR|脱敏correlation；未知原因不归类ENOMEM|

本表的新别名仍为目标：MAIN正式注册runtime schema/TS/alias并保留旧错误码语义后才生效。确认字节漂移走已有attention；读失败!=漂移。网络/provider限流费用未知不得记0；A无新付费provider。

## 7. 实时与交付

EventsSnapshot在同一读事务取context与snapshot_event_id，生成绑定principal/project/filter/generation的opaque cursor；SSE从该ID之后回放，初连无漏窗。event_id是同库递增序列；消费者丢弃重复，按实体version/attempt拒旧；服务器发现投影完整性失败才resync；全局outbox按项目/topic过滤后的数值间隙是正常现象，不按ID连续性判断丢失。重启generation不匹配或过保留窗410，不静默从now开始。默认7天事件保留，可能过期必须有测试；心跳5秒，不当业务完成，正常连接端到端p95≤2秒。Browser EventSource用同源cookie不放token到URL，MCP专用events-snapshot资源返回EventSnapshot（context+cursor）；context/workflow/jobs资源仅返回registry声明的DTO，订阅按客户端能力声明。

健康采样5秒/15秒过期，过期/断线显示unknown，数值null不冒充0。服务ready须实际依赖探针，进程存在不代表ready。停止/重启只限自有服务且检查在途job；共享服务不可kill/清全队列。A仅基础状态，B补资源/告警/节点关联。

导出Job始终绑定输入snapshot，即便当前工程变新也保留旧标签。QC完整decode/帧数/真实音轨/黑静帧阈值与采样清单跑前冻结，任何阻断不能变ready；ready要求package、source/rights清单和hash均可读。download_ref校验主体/项目/工件，支持流式与范围读取，不暴露绝对路径。两份导出需同时保留。业务payload超过1MiB直接413（沿用Host既有payload过大错误，经A正式alias补齐，以PAYLOAD_TOO_LARGE进入本包Error枚举；正式alias仍需A实现注册）。

## 8. 兼容隔离矩阵（首轮安全冻结）

现有server的/api/session发全权token、旧adopt/restore接受approval.confirmed是待治理真实入口，不能当成新可信批准边界已成立。A的生产launcher显式构造production profile，由本机受信配置决定，不接受HTTP参数切换。legacy-test仅给旧fixture/隔离测试实例，不能挂载新建生产根。

| 实例/身份 | /api/session | 新agent端点 | 旧adopt/restore/edits等写入口 |
|---|---|---|---|
| production匿名或MCP scoped token | 403，不返回旧全权token；同源头不能授权 | 按scope/项目，trusted_ui入口403 | 403；不得以confirmed布尔值批准 |
| production可信UI session | 不返回旧全权token | 同源CSRF+具体scope | 新建项目必须走新统一应用服务；旧UI挂载需MAIN受控桥接，不能返回裸token |
| legacy-test隔离fixture身份 | 保留旧测试入口，仅隔离catalog | 不挂载新agent生产入口/根 | 保留旧回归范围，不可写created工程 |
| production旧裸Bearer | 403 | 401 | 403；不能成为生产回退通道 |

MCP的HostClient只持scoped凭据；服务端所有旧写路由在资源查找/昂贵重验前执行profile/身份/origin检查，不能只保护新前缀。旧M5 UI生产桥接也须服务端同样的impact/approval校验，不保留confirmed绕行。必测：带伪造Origin/Referer直接取/api/session；MCP凭据调用旧adopt/restore/edits；旧token调用新API；新建根注入legacy catalog；均零写入。服务owner的种子凭据不发给MCP。该API隔离不声称对拥有同OS用户任意文件/浏览器控制权限的恶意进程提供沙箱；主机开发权限与产品驱动身份必须分离。

## 9. Artifact input_refs与恢复精确化

ArtifactPut新增input_refs并持久保存顺序规范化的[{id,version,sha256}]；在schema验证后服务端逐个读本项目不可变ref核对digest。script允许input_refs为空，其输入从本项目origin的已确认intake派生；storyboard必须且仅包含一个当前script ref。输入hash preimage固定为{project_id,kind,intake:{id,version,sha256},refs:[按id/version/sha256排序的refs]}，采用第5节canonical；不信客户端hash，不从当前head隐式重建旧版本。重复ref拒422，变更/缺失/跨项目拒409/403，refs及input_digest入不可变artifact行。workflow stale按这些保存引用判定，不靠自增UI版本猜测。

SSE初始query cursor与Last-Event-ID均为Host签名的opaque cursor，绑定principal/project/filter/generation与全局outbox水位；原生EventSource重连会保留初始URL游标并发送较新的Last-Event-ID，因此合法Last-Event-ID优先于query；两者仍须验证相同principal/project/filter/generation（允许水位不同），不同scope/无效签名拒403；过期的旧query仅作scope校验，按有效header水位续传。无header才用query；数字ID或他人cursor拒403。SSE每条id回传新的opaque cursor，data中的event_id仍可用于去重；过期410，epoch重启按重同步处理。snapshot的水位与事实同一事务；从全局水位之后按scope过滤，不以过滤产生的ID间隙判丢失。若缓存投影落后不得宣称snapshot包含未投影水位，返回503或用事实同步构建。
