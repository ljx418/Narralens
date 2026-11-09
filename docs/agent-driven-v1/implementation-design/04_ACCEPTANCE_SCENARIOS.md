# 真实场景开发验收目录

状态：文档设计；以下35个AD-T验收族全部NOT_RUN。保留原编号，不用本轮文档检查替代业务通过。R4-UX-01..12以已冻结门文件为准。每族须再按故障/状态/权限细分case，不以测试总数代替逐项映射。

## 1. 每项统一前置与证据

固定代码/合同/配置/上游/模型/机器及媒体SHA；创建隔离真实生产测试工程，授权素材与真实中文录音；声明是否允许网络/付费/外传。先验证probe能力，测试替身只记组件证据。每项记录命令、完整argv、exit、原始日志、before/after source/revision/active_commit/impact/outbox/幂等及产物SHA256。所有失败和NOT_RUN保留。

| 编号 | 场景/阶段 | 操作步骤 | 明确通过门槛 | owner | 当前状态 |
|---|---|---|---|---|---|
| AD-T01 | 双击启动、重复启动、停止并重开 / A/B | 新旧实例分别冷/热启动，关闭UI后检查Host再停止重启 | 同一实例/持久项目不丢失，进程存在与API就绪分开；不擅自终止共享实例 | BRIDGE+MAIN | NOT_RUN |
| AD-T02 | 能力发现与合同拒绝 / A | 真实首端列tools/resources，提交非法字段、未知版本、无权请求 | schema逐字段拒绝且无业务副作用；blocked能力不宣传可执行 | BRIDGE+MAIN | NOT_RUN |
| AD-T03 | 双客户端共享事实 / A/B | 两客户端读取同project/job/snapshot，再同时打开工作台 | ID/版本一致；只一个Host/DB事实源，关闭任一客户端不删项目 | BRIDGE+MAIN | NOT_RUN |
| AD-T04 | 服务不可用与Skill恢复 / A | 断Host后调用能力，再按Skill重新连接同实例 | 明确不可用与下一步，不新建影子Host/库，不猜成功 | BRIDGE | NOT_RUN |
| AD-T05 | 一般新工程创建 / A | 两个不同主题确认简报并创建；同key重放/异内容冲突；创建中崩溃 | 不同工程与内容；重放同结果，异内容409；重开可读，无假migration | MAIN+PRODUCT | NOT_RUN |
| AD-T06 | 真实可编辑短片 / A/B | 授权本地媒体和真实中文录音→Agent提交分镜→原生clip→snapshot渲染 | 60–180秒真实短片；逐镜可编辑，MP4完整decode，无空音轨冒充录音 | MAIN+MEDIA+PRODUCT | NOT_RUN |
| AD-T07 | 关服重开 / A/C | 生成并提交后关闭Agent/UI、受控停服、重启、重开同工程 | source/revision/snapshot/history一致，草稿与正式版本可区分 | MAIN | NOT_RUN |
| AD-T08 | 改单镜双导出 / A/C | 保存前一snapshot并导出，选镜只换画面保留旁白/时长，再导出 | 比较/拒绝+0，确认+1；不变范围与音轨保持；两产物绑定各自snapshot | MAIN+MEDIA+PRODUCT | NOT_RUN |
| AD-T09 | 驱动中断与续作 / A/C | 准备前/受理后/回报前中断CLI，重连读checkpoint | 不重复准备/提交/扣费；旧结果与新输入版本隔离，未核实结果unknown | MAIN+BRIDGE | NOT_RUN |
| AD-T10 | 任意候选选择 / A/B | 生成3–6案，选择非首案，改选并读Agent上下文 | 每案映射真实preview与版本；所选案用于准备；改选旧结果stale；选择不提交 | PRODUCT+MAIN | NOT_RUN |
| AD-T11 | UI选区与Agent精修 / A/B/C | 原播放器选区→Agent读selection_version→局部准备→审差异→确认 | 唯一选区/播放时钟，限定范围改变；人工改选后旧请求拒绝 | PRODUCT+MAIN | NOT_RUN |
| AD-T12 | 真实写路径安全 / A/B/C | 分别改变base/source/锁/许可/impact/approval/project后apply，保留对照成功 | 失败影片revision+0、source/active_commit/批准消费/成功commit不推进，允许合法拒绝审计；成功恰好+1；无裸写绕过 | MAIN | NOT_RUN |
| AD-T13 | 驱动争抢与接管 / B/C | 两个Agent争抢，失lease后显式接管，旧epoch迟到apply | 唯一活动编排者，旧epoch拒绝；有效worker不被误取消 | MAIN+BRIDGE | NOT_RUN |
| AD-T14 | 人工编辑冲突与恢复 / B/C | Agent准备后人工提交，再发送旧base；受控restore一次 | 旧操作409不覆盖；恢复旧内容产生新revision，undo/redo不裸转发 | MAIN+PRODUCT | NOT_RUN |
| AD-T15 | R4与可访问性 / A/B/C | 键盘完成比较/确认/系统面板，三个目标视口，原生预览稳定检查 | R4-UX适用项通过；首次定位/比较≤60秒，恢复入口≤10秒，学习后单列 | PRODUCT | NOT_RUN |
| AD-T16 | 检索下载与来源 / B | 依据AssetPlan检索→用户授权选源→有界下载→校验注册 | 至少一条真实许可来源；bytes/hash/probe/许可可证；SSRF/重定向/大小/超时拒绝 | MEDIA+MAIN | NOT_RUN |
| AD-T17 | 声音与字幕 / B | 真实录音/授权TTS、ASR/对齐→native字幕音轨→试听导出 | 采样/真实时长与字幕对应；音频锁阻止越权；偏差报告按CP冻结阈值判定 | MEDIA | NOT_RUN |
| AD-T18 | 费用与外部未知结果 / B | provider受理后断线，查receipt/费用；取消后送迟到结果 | 未知不记0/不盲重提；费用与输入/模型/attempt可追溯，晚到不采用 | MEDIA+MAIN | NOT_RUN |
| AD-T19 | 标题封面 / B | 基于同一事实摘要给8标题/4封面，选非首项，制造正文冲突 | 真实候选全部可选择；风险提示并保存选项/版本，不伪造现场画面 | PRODUCT+MEDIA | NOT_RUN |
| AD-T20 | QC与交付包 / A/B/C | 用已提交snapshot渲染，触发QC block再修复，导出附属文件 | block不能正式交付；MP4+字幕+来源许可+标题封面+版本费用按阶段齐备 | MEDIA+MAIN | NOT_RUN |
| AD-T21 | 长片母工程 / C | 真实10–15分钟、100+镜工程导航/精修/提交/双导出 | 原生可编辑，非扁平MP4迁移；完整P0/P1/NFR回归无未解释失败 | MAIN+MEDIA+PRODUCT | NOT_RUN |
| AD-T22 | 三端真实兼容 / A/C | Codex首端真实标准链；ClaudeCode/DSH分别连接、读取、续作 | 每端独立实际证据；A可明确blocked，C缺任一承诺端不得宣称Full | BRIDGE | NOT_RUN |
| AD-T23 | 风格与反馈 / C | 版本化StyleProfile，局部override，回滚；评论定位章节镜头 | 锁定内容不被覆盖，反馈锚点稳定；应用仍经受控提交 | PRODUCT+MAIN | NOT_RUN |
| AD-T24 | 长片性能 / C | 参考机100+镜项目，四类导航操作各采100样本；章节/导出预算跑前冻结 | 交互p95≤100ms；原始样本/分母/资源与预算留证，不能跑后放宽 | PRODUCT+MEDIA | NOT_RUN |
| AD-T25 | 事实与规格总审 / B/C | 逐项核主张/引用、素材许可、字幕/标题封面与PRD全量 | 事实/判断/争议分明；13P0/6P1/6NFR/21体验全覆盖；未通过保持未实现 | MAIN+PRODUCT | NOT_RUN |
| AD-T26 | Comfy模板登记探针 / A/B | 只读识别模板格式/固定SHA/模型节点/许可，隔离一图一视频smoke | 依赖不足blocked；无prompt外呼或安装默许；真实smoke与生产接入分开 | MEDIA | NOT_RUN |
| AD-T27 | 结构化提问回答 / A/B | 已有简报不重问，在UI答复/跳过/改答案后Agent读版本 | 已知/推断/待答分明，Decision版本一致，E03缺省审阅不得删事实核验 | PRODUCT+BRIDGE | NOT_RUN |
| AD-T28 | 有界并行 / B/C | 两镜下载/两章节声音画面准备，争GPU槽、取消一任务 | 容量真实受限且产物不覆盖；驱动单会话不串行全部准备；发布仍串行 | MAIN+MEDIA | NOT_RUN |
| AD-T29 | Comfy生产闭环 / B | 真实固定一图一短视频→外部job→probe/资产→native clip→采用→渲染 | 模型/seed/输入/receipt可追溯；不盲重提、不误伤共享任务，结果可播放 | MEDIA+MAIN | NOT_RUN |
| AD-T30 | 概念与转场 / B | 中文术语/数值图形可编辑，AI背景/首尾帧转场实际进入工程 | 文字关系人工核对；时长/音轨/锁/handles正确；fallback不冒充AI通过 | MEDIA+PRODUCT | NOT_RUN |
| AD-T31 | 依赖局部重算 / B/C | 改脚本节点版本→查看影响→批准子图重算，运行中再改输入 | 独立旁白/其他章节hash不变，旧产物保留；环/非法参数/旧attempt拒绝 | PRODUCT+MAIN | NOT_RUN |
| AD-T32 | 真实健康与资源 / A/B | 启动/停依赖、模拟能力缺失、停止采样、读取resource | 进程/API/模型分别就绪；5秒采样、15秒过期unknown/stale；无采样不填0 | BRIDGE+MEDIA | NOT_RUN |
| AD-T33 | 事件游标与原生确认 / A/B | 初连snapshot后并发事件；重复/乱序/断线/过期cursor；延迟nativeack | 无漏窗口和重复业务效果；重连校准快照，Host新值不能填nativeack | BRIDGE+MAIN+PRODUCT | NOT_RUN |
| AD-T34 | 系统受控恢复 / A/B | 非模态侧栏继续精修；owned/shared检查；活动/未知任务尝试卸载重启 | 仅自有授权动作；资源互斥在服务端生效；检查不重提媒体，错误脱敏 | MAIN+BRIDGE+MEDIA+PRODUCT | NOT_RUN |
| AD-T35 | 可观察性时延与压力 / A/B/C | 持续Host事件与媒体负载，记录事件到DOM/健康采样时间及定位恢复 | 正常连接呈现p95≤2秒，测量样本/参考机固定；故障明确，无假百分比 | BRIDGE+PRODUCT | NOT_RUN |

## 2. R4体验门的逐阶段范围

A：R4-UX-01/02/04/05/07/08/10/11/12的本地短片完整链；03/06为首链子集；09为自有实例与健康、未接管模型blocked。B补齐03多候选、06依赖子图、09真实模型/共享资源，并回归其余项。C在长片/多驱动/完整制作范围全部复验；前期子集不能关闭最终整项。

## 3. 三轮人工验收脚本

### A：真实短片与改单镜

1. 双击生产图标，看就绪和能力；向首端Agent提供新主题、授权媒体与真实录音，确认摘要。
2. 打开同一持久工程，播放60–180秒初稿，选镜换画面并保留旁白/时长；看候选、先拒绝一次，再核对影响并确认。
3. 延迟原生加载，核对准备/受理/提交/待同步/实际确认；打开系统侧栏仍可精修。
4. 保存两版本并导出，关闭Agent/UI，停服重开同工程再导出。检查文件可播放/完整decode、工程原生可编辑、未改区一致。
5. 人类逐条签署实际结论；首次定位/比较≤60秒、找恢复≤10秒；未验证的模型/多案/完整制作明确列为未完成。

### B：完整制作与协作

1. 从3–6案选非首案，确认Agent读取同一选择；改一个产物节点并只重算受影响分支。
2. 两镜/章节并行准备，取消一项、断线和接管，旧驱动迟到操作被拒；共享Comfy不被卸载/清队列。
3. 固定一图一短视频实际进入资产与可编辑clip，试听授权声音/字幕，选8标题/4封面，触发QC block再修复后完整交付。
4. 人验与独立审查通过只可签Beta；原P0章节/锁/恢复等均齐备时另判V1-P0。

### C：完整V1

1. 用真实10–15分钟、100+镜母工程，至少一个3–5分钟20+镜章节完成3处局部修改；验证StyleProfile/反馈与全部后期承诺。
2. Codex、ClaudeCode、DSH各做真实标准链并接力；故障/重开/双导出、所有P0/P1/NFR/AD-E/R4-UX逐项核对。
3. 四类交互各100样本、p95≤100ms；渲染/生成预算在跑前按参考机/模型冻结，不用事后阈值。
4. 仅当全部规格、证据、独立外审、人工签署齐备，才允许V1-Full。

## 4. 自动/人工证据分开

Headless自动化全程静音、不抢焦点；headed自动化与人验单列且提前告知。UI自动测试不能签人验。浏览器/Host/worker按自己实例清理，不kill共享服务。实际进程退出/重启必须用真实子进程模型，不只throw异常。诊断unknown不得凭猜测标ENOMEM。

## 5. 当前已有命令与拟新增门

源码现有命令：`corepack pnpm check`、`corepack pnpm test:contracts`、`corepack pnpm test:m5`、`corepack pnpm test:m5:headless`、`corepack pnpm test:wave2:m4c`、对应historical门；完整scripts见package.json。本轮未运行这些业务命令。

A/B/C的新聚合evidence脚本、client探针、scenario runner和完整性门属于实施交付，当前未存在，不打印为“可直接执行且已通过”。实现后每轮同一冻结SHA跑适用全量、生产构建、真实媒体、负向/恢复/安全/性能，旧冻结current-tip与historical语义分开。

## 6. 出门拒绝条件

承诺未实现、未覆盖的真实写路径、source/版本分叉、原生未确认却报已同步、重复付费或重复提交、活动/未知任务卸载越权、缺真实媒体/完整decode、原型/桩冒充生产、缺独立审查或人验，均拒绝全绿。环境失败保持失败，不通过删case/放宽schema/调整并发掩盖。

## 7. AD-T20正式导出恢复子矩阵（A首链必须执行）

统一前置：真实短片、已提交snapshot、固定配置、可写受控输出目录；先验证正常encode+完整decode基准。每项记录snapshot/config digest、attempt、子进程退出、staging/最终目录、delivery state与下载引用、outbox及重启后事实。

| 子case | 操作与故障位置 | 明确通过门槛 |
|---|---|---|
| T20-A | encode中模拟ENOSPC/写失败 | 明确失败/可重试原因；无ready/download、无半成品包；原snapshot/source/revision不变 |
| T20-B | 编码器非零退出/截断媒体/坏帧 | ffprobe或完整decode拒绝；未完成QC不得进入ready；不能只看文件存在 |
| T20-C | 同snapshot/config并发两请求、预置同名输出 | 幂等只发布一个完整包；异输入不覆盖；loser只清自己staging，不删winner |
| T20-D | 渲染中取消，再注入晚到成功回调 | 子进程/lease受控停止或持久标明待收敛；不新发渲染；晚到不变ready，不产生正式下载 |
| T20-E | encode后/QC前、publish前、rename后/DB前、DB后/events前真实终止进程 | 重开收敛为可恢复/明确失败/完整已发布之一；不存在DB ready但无完整包；无重复发布与错误版本 |
| T20-F | QC故意block，附属文件缺失/摘要不符，之后修复重试 | block不交付；修复使用同snapshot的正确包或新明确attempt；不静默跳过QC/缺失字幕与许可文件 |
| T20-G | 渲染中提交新的工程revision | 旧job始终绑定原snapshot；输出manifest/文件名标对应版本，不能冒充最新影片 |
| T20-H | 发布完成后重复GET/重复同key；服务重启后再下载 | 读取不触发渲染；同digest/bytes与manifest；旧已完成包不被重试清理；完整decode仍通过 |

允许记录合法的拒绝/失败审计事件或拒绝响应幂等记录；“失败无副作用”约束的是影片source/revision/active_commit、批准消费、成功commit及其业务outbox不被推进，不能禁止必要的安全审计。

## 8. 测量边界与人工结论

首次定位/比较：具备任务背景但未读本界面教程的项目负责人，从打开真实工程可交互时起，到选定镜头并显示当前/候选差异时止；首次与学习后分列。恢复入口≤10秒从可见错误/阻塞提示出现到定位正确恢复操作，不能要求用户盲目重试以换取计时通过。记录参与者、指令、起止事件、成功/失败，不由Agent替用户填满意度。

事件p95≤2秒：Host已持久事件时间到客户端相应DOM状态可见，校准同机时钟，样本量/负载/丢失/断线分开；实际native确认有独立起止时间，不把Host事件呈现当native已加载。5秒采样/15秒过期按observed_at判，测量失败也记入分母。

交互性能：沿用PRD与原验收对四类操作的定义；在CP-C0跑前冻结具体事件、参考机、100+镜、每类100样本，从用户输入到该交互状态完成呈现计时，媒体解码/网络/渲染耗时另记，不掩入或移出分母。没有预先冻结的媒体/字幕质量容差，不得自行签相应case通过；CP-B0由MEDIA提出、MAIN审查并经用户确认目标容差。
