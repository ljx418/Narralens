# S0出门、A开工与实际分工

## 1. 当前门与人工核验

本轮状态最高S0_REVIEW_CANDIDATE。用户可审原型和合同冻结方案，不能自签原型认可。S0文档工具绿不等于CP-A0 production-ready：用户原型逐项签署、真实CLI支持矩阵、生产合同注册/精确依赖锁与旧库恢复证据仍有各自门。A具体实现前MAIN必须再向用户汇报该阶段的具体任务与实际Agent领取情况。

| 门 | 本轮提供 | 还需事实 | 允许动作 |
|---|---|---|---|
| S0-DOC | schema/TS/SQL/原型/向量/审查/清单 | 本包校验与独立设计审查结论 | 给用户核验，不开A代码 |
| S0-HUMAN | PX01..10交互和审查意见导出 | 用户核对审阅方式、短片范围、架构/合同方向 | 获认可后做CP-A0落地 |
| CP-A0 | 精确接口与生产落地任务单 | runtime注册、SDK锁/许可证/首端探针、真实旧库迁移及恢复、合同消费者证明 | MAIN明确IMPLEMENTATION_RELEASE |
| A-INTEGRATED | IT-A01..A06生产链 | 真实两主题/时长/单镜编辑/重开/双导出、回归/外审/人工签署 | AD_SHORT_FILM_READY，仅短片 |

不得要求用户逐小模块验收。A/B/C各大阶段一次完整交付：阶段内持续接线、内部复核、独立组合外审后，提供同一SHA的中文HTML/真实视频/证据给用户。只有人工事实、契约重大决策或授权缺失才升级；普通问题自行闭环。

## 2. 实际执行者与范围

| 角色 | 当前实际活动 | A拟领取 | 禁止路径 |
|---|---|---|---|
| MAIN Codex | 当前编制S0、原型、合同/SQL和主接线设计 | CP-A0、一般project创建、仓储/审批/源发布/组装接线、最终验收 | 不代签人验或自己实现的独立外审 |
| BRIDGE Codex | 本轮分配的只读契约/恢复审查上下文，非CLI生产实例 | 接入/健康设计文档、验收；对应Claude实现A01/A02 | shared schema/DDL/server/旧核心 |
| PRODUCT Codex | 本轮分配的只读UX/验收审查上下文，非CLI生产实例 | 可操作工作台/创作对象设计、文档、验收；Claude实现允许部分A03/A04/A05 | 旧M5、公用bootstrap/commit、第二timeline |
| MEDIA Codex | 尚未启动目录CLI或领取代码 | render/QC设计文档、验收；Claude实现A06 | source/revision/pointer/资源内核 |
| 三目录Claude Code CLI | 全部未启动/未派生产任务 | 仅实现已发布任务；429由目录Codex接手 | 不自签外审；未释放不得开工 |

两路只读审查是当前会话的独立上下文，不冒充三个实际CLI窗口已运行或供应商外审。实现作者与独立审查分离；MAIN写了公共实现也需未参与者审公共部分。

## 3. A具体任务与依赖

- CP-A0：MAIN实现合同schema/TS/validator/alias/注册、同库DDL/迁移测试、权限/Job端口、production state root；三个Codex审消费者fixture并文档ACK。
- A1：BRIDGE实现supervisor纯模块+MCP/Skill；PRODUCT实现Brief/Workflow/Inspector组件与应用服务（DI端口）；MEDIA实现SnapshotRender/QC/Delivery消费者。模块可并行，重型测试单槽。MAIN同时接general Resolver/创建与event read事务。
- A2：MAIN将三条泳道接入真实Host；两个不同主题建不同项目、使用数量不固定的镜头；完整真实录音/素材、中文概念图，真实导出与decode。改单镜保持独立旁白/其他镜头，再关服务重开与第二导出。
- A冻结：适用旧全量回归、真实首端MCP、三端只读能力矩阵、取消/kill恢复/权限/事件/资源负向、独立外审及人工体验。没有DSH实测只能写NOT_RUN/BLOCKED，不能签全兼容。

不规定虚构日期、token/硬性调用次数。以实际交付与机器资源预约推进。Claude429不改变验收标准，429前日志/未提交工作保留，停止旧writer再接手。

## 4. 逐case开发及验收计划（均待A实现，不因S0工具通过关闭）

| 编号 | 前置/操作 | 必须断言/证据 | 责任 |
|---|---|---|---|
| A-C01 | 两次启动、同机第二客户端连接 | 同实例代际/项目；停UI不删工程；旧session拒绝 | BRIDGE/MAIN |
| A-C02 | tools/list/resources/read，错误参数/版本/权限 | 精确registry；unknown字段拒；不递归启动Host | BRIDGE |
| A-C03 | 两种主题和不同镜数、确认brief后create，同key并发重放 | 唯一command/job/project/初始snapshot；异digest409，失败无假origin | MAIN |
| A-C04 | artifact同base并发提交、缺引用/重复shot/时长不符 | CAS一个成功，非法零提交；项目revision不变 | PRODUCT |
| A-C05 | assemble/materialize/impact/可信批准/apply | 保留三镜或可变镜数原生可编辑clip；成功+1失败+0 | MAIN |
| A-C06 | prepare后改source/selection/control/rights/锁/许可 | 分别409/423/428，无隐式rebased或越权 | MAIN |
| A-C07 | MCP伪造human/跨项目grant、CSRF/Origin/会话重放 | UI专有入口无MCP工具；认证前不泄露资源 | MAIN/BRIDGE |
| A-C08 | SSE初连/窗口中新事件/重复/乱序/重连/过期 | snapshot+cursor无漏窗；410重同步；旧attempt无倒退 | BRIDGE/PRODUCT |
| A-C09 | 断线/5秒采样/15秒过期/503 | unknown非0；5s/15s真实计时；正常p95≤2秒 | BRIDGE/PRODUCT |
| A-C10 | render进行中项目再次提交 | 输入snapshot固定；真实MP4 encode+全decode/音轨/帧数/ffprobe/hash | MEDIA |
| A-C11 | render取消/lease丢失/长worker/close/重开 | CAS续租/重排或隔离；不触关闭DB/不晚到采用 | MEDIA/MAIN |
| A-C12 | 创建/批准/apply/导出各进程kill边界 | 03矩阵全覆盖，原始日志，不只throw fault | MAIN |
| A-C13 | 真实旧库/新库/迁移中失败/重复启动 | 不改旧row/receipt；备份可重开，权限可证 | MAIN |
| A-C14 | UI只通过用户动作完成首链和改单镜 | Headless真实接线截图/视频；人验独立记录，不用fixture桩 | PRODUCT/MAIN |
| A-C15 | 两种主题/两份导出+保留范围对比 | snapshot/资产/内容指纹不同，改一镜其他范围hash保留 | MAIN/MEDIA |
| A-C16 | 全量check/build/旧门historical+当前candidate完整性 | 不修改历史门使绿；失败索引/逐case映射与产物SHA | MAIN |

映射：A-C01..02→AD-T01..04；03..05→T05..08/T27；06..07→T12/T14；08..09→T32..35；10..15→T06..09/T15/T20；16→T25。原35测试族全部保留，B/C新增部分仍PLANNED。

## 5. 用户验收步骤

本轮：打开review.html→查看并实际操作原型PX01..10→逐项认可/修改/待讨论→下载意见JSON。无需执行命令，不打开生产服务。
A轮末：双击启动→向首端Agent说主题/时长并提供授权素材→工作台确认简报/预览→领取真实短片→要求只改一个镜头→确认影响→重开→领取第二份视频。只有视频可播放、中文音画正确、可编辑性与恢复证据齐全才通过。B/C同理按阶段目标独立签署，面板好看不是出门条件。
