# PRD、合同及执行基线独立审视

日期：2026-11-09。源码读取基线：`fd3021c336387b4c6405b3db08abaafa81c842ff`。本次仅审视文档与源码声明，未运行产品、媒体、客户端探针或验收，不对生产实现签署PASS。本文件是建议；不改变冻结、release或旧Gate。

## 权威与当前状态

用户最新批准及`docs/agent-driven-v1/s0-r4/APPROVAL.json`明确：R4原型人工PASS；产品case为NOT_RUN，生产release为NOT_RELEASED。`V1_FRONTEND_EXIT_GATE.md`是V1必要体验门，不能替代PRD §6的13项P0、6项P1、§8的6项NFR、AD-E01..21、AD-T01..35及旧M/D/Wave/V1门。IT-P01只关闭R4原型核验子门；完整规格同步、IT-P02、CP-A0、实际ReleaseAssignment仍需证据。

建议所有执行入口采用同一简短状态表，保留历史正文并明确“已被R4取代”，防止复制旧提示词直接开工。

## 需要在实现任务发放前消除的冲突

| 级别 | 具体证据 | 风险与最小处理 |
|---|---|---|
| 高 | `01_TARGET_ARCHITECTURE.md`顶端R4已批准，但状态仍为“R2待核对”；AD-A09和后续段落仍写WorkflowPanel/AgentConsolePanel。`06_ITERATION_EXECUTION_PLAN.md`§9仍列“真正产品原型未完成”，末段仍要求两块section。`07/08/09`顶端和PRODUCT可复制提示词也保留“两块观测section/AgentConsole” | 新任务可能执行已废弃布局。补充当前适用性表：R4=WorkflowTopBar+非模态SystemControlPanel；旧段只作历史，不再用作任务输入。不要改写R4冻结文件 |
| 高 | `07_PARALLEL_DEVELOPMENT.md`PRODUCT所有权只列`src/app/observation/`，`08`R3增量要求`src/app/system/`；机器规则`parallel-plan.json`需同步核对 | SystemControlPanel落点可能越权。MAIN先发布精确路径白名单和owner；不因目录建议自动扩大写权 |
| 高 | `01`AD-A04把拟建`src/host/creative/project-creation-service.ts`放在PRODUCT目录；`09`PRODUCT明确禁止修改该服务，`07/08`把bootstrap给MAIN | 两名owner写同文件或业务绕过公共提交。建议MAIN独占一般项目初始化/补偿/初始snapshot，PRODUCT只消费ProjectBootstrapPort；在任务单明确唯一实际文件owner |
| 高 | `s0/registry.json`的instance/events/health等owner为bridge，artifact/workflow为product，而`07/08`规定MAIN独占server/registry/公共schema | 把业务producer所有权误读为注册权限。显式分列“业务producer、协议实现者、生产注册owner”；生产注册始终MAIN |
| 中 | `01`草案名为`narralens_artifact_submit`、`narralens_task_read/cancel`；`s0/registry.json`候选为`narralens_artifact_put`、`narralens_job_read/cancel` | 消费端易各自发明alias。CP-A0锁定唯一名字/版本/错误表，旧别名如需支持给出明确映射；不能称两个版本均已存在 |
| 中 | `AGENTS.md`最新R4入口之后仍有“尚未把产品原型冻结”“S0-HUMAN=REVIEW_PENDING”“当前前端候选R2”等段落 | 子门与整门混淆。注明R4体验冻结已批准，首轮生产合同冻结/实现release仍未通过；不用一个HUMAN字段承载全部结论 |

## 已存在与候选合同的准确边界

生产合同由根`contracts/*.schema.json`与`src/contracts/{types,engine-types,wave2-types,wave3-types,validator}.ts`提供；`validator.ts`显式注册现有job、asset、proposal/comparison、migration、materialization、impact/adopt、history/locks/workbench等schema。`src/host/server.ts`约773–839行显式分派`/api/session`、`/api/projects/:id`、资产/提案/编辑/job及`/api/migration/v1/...`路由；此处没有一般项目POST创建、`/api/agent/v1`、新系统生命周期路由或MCP工具注册。现有job SSE不能直接宣称已满足新的项目级workflow snapshot+cursor协议。

`s0/contracts.schema.json`、`s0/contracts.ts`、`s0/migration.sql`、`s0/registry.json`、vectors及R2 observation文件属于文档候选；registry逐项标NOT_IMPLEMENTED，schema说明Not registered in production。存在文档schema/SQL/本地检查，不等于已安装、注册、迁移或客户端真实验证。R4冻结的是体验文件，不自动冻结这些候选接口。

`src/host/engine/engine-port.ts`已有且仅有inspect/capabilities/plan/stage/validate/preview/render七方法；render签名存在不能证明真实snapshot导出闭环已经可用。`src/host/projects/project-coordinator.ts`拥有正式事务与版本发布。新模块应消费这两条边界，不增第二引擎提交权。

## 精确合同尚需补齐的内容与owner建议

以下均为拟冻结事项；表中Port名表示设计角色，不能写进“现有API”清单。

| 合同族 | 当前候选限制/缺口 | 负责人与冻结点 |
|---|---|---|
| 实例、鉴权、能力与生产生命周期 | s0有Instance/HealthRead；R4启动/重试、load/warm/unload及活动任务互斥没有相应精确写schema | MAIN负责HostInstance/Application/SystemLifecycleCommand及授权；BRIDGE负责发现/健康投影；MEDIA实现受限ModelRuntime。CP-A0冻结健康/自有共享边界；CP-B0冻结真实模型写命令及未知结果恢复 |
| 项目创建与origin | s0 CreateProject绑定已确认intake；生产Resolver/bootstrap、失败补偿、初始snapshot与旧库重开尚须真实证明 | MAIN独占ProjectBootstrap、Resolver与DDL；PRODUCT消费。CP-A0覆盖new/migrated两种origin和幂等重复创建 |
| 创作对象/提问/研究审阅 | s0 Brief仅topic/audience/duration/tone/本地资产等，duration限定60–180；ArtifactContent仅script/storyboard。不能覆盖完整研究主张/引用、启发式Question/Answer、长片与全部产物 | PRODUCT负责业务语义，MAIN冻结schema/仓储CAS/DDL。A冻结首链与问答；B冻结依赖stale/修订；C冻结长片/风格/反馈。60–180限制保留在A候选版本，不能称全V1通用合同 |
| 选择、审批、提交 | s0 Decision仅confirm/reject brief；Approval没有完整actor/费用/外传scope。身份可在服务端绑定，不应要求客户端自报human；仍需可信身份及授权记录的服务端合同 | MAIN负责可信Decision/Approval与Coordinator接线；PRODUCT提供审阅交互。CP-A0冻结本地首链、项目/版本/hash/期限/消费规则；B扩展选案/接管/预算，不把选择等同应用批准 |
| 工作流与原生同步 | s0 Workflow有DAG节点，R2 Observation/EditorView明确区分Host与UI本地事实；R4需真实native ack、错误/超时/重连映射 | PRODUCT负责workflow投影和UI；BRIDGE负责事件映射；MAIN接原selection/clock/native桥。CP-A0锁job→transaction→snapshot→native ack关联，不可用Host新值替代编辑区ack |
| 任务/资源/费用 | s0有JobReceipt/TaskPrepare，无完整DriverSession、ResourceClaim、provider receipt/unknown、共享Comfy取消合同；registry明确延期B | MAIN负责job/lease/fencing/资源内核；MEDIA消费并对账；BRIDGE观察。A必须有界单驱动/幂等/恢复；B补齐多驱动、GPU互斥和费用未知，不先发任意执行能力 |
| 导出/QC/交付 | s0 Delivery仅pending/passed/blocked等最小字段，不等于PRD完整pass/warn/block/NA规则与附属包。生产EnginePort的render仅是接缝 | MEDIA负责SnapshotRender/QC/Delivery业务；MAIN控制snapshot访问、注册和持久job。A真实本地MP4/完整decode；B冻结QC逐项/来源许可/字幕标题封面与费用manifest；C长片完整回归 |

每份实际CP至少含runtime schema、TS与validator注册差异、canonical/hash规则、权限/错误alias、DDL/升级/降级方案、producer/consumer黄金向量、真实接缝命令、取消/过期/旧版本/无权限负向、兼容范围和回退。不能因为additionalProperties放宽或把失败统一200就称消费兼容。

## A/B/C可交付物与用户实际验收步骤

每轮开始实现前由MAIN汇报实际目录/角色/状态、合同SHA、范围、测试与回退；任务包完成不逐个请求人验。阶段末冻结同一代码/合同/配置/素材/上游与机器基线，保留失败/NOT_RUN和产物SHA256，独立审查后交用户签署。审查者不能签自己的实现；用户内容事实/审美不能由Agent代签。

| 轮次 | 具体交付与用户步骤 | 明确通过阈值 |
|---|---|---|
| A：IT-A01..06 | ①双击启动并确认就绪；②向首端Agent说主题、提供授权本地媒体和中文本人录音，修正摘要；③打开同一持久工程并播放60–180秒短片；④原工作台选一镜，要求换画面保留旁白/时长，在原播放器比较真实候选，先拒绝一次再确认；⑤观察准备/受理/提交/待同步/同步确认；⑥打开系统侧栏继续精剪，折叠/展开顶部工作流；⑦导出、关闭Agent/工作台、停止重启自有服务，重开再导出 | 两个不同主题创建不同真实工程；至少一条影片真实encode+完整decode；比较/拒绝revision+0，确认恰好+1；修改外范围与锁定旁白/时长保持；延迟native加载时不得报已同步；重连/重开无重复提交/执行；两份snapshot绑定导出可带走。只可签AD_SHORT_FILM_READY，未完成B/C项明确列出 |
| B：IT-B01..06 | ①任意选3–6案中的非首案，Agent读同一选择；②编辑一个脚本/素材节点，查看影响后只重算相关分支；③并行准备两镜/两章节，观察资源等待，取消一项并验证晚到结果隔离；④驱动中断后显式接管，尝试旧驱动迟到操作；⑤实际Comfy一图一短视频进入资产→原生clip→采用→导出；⑥试听授权声音、核对字幕/锁；⑦选择8标题/4封面并查看来源许可，制造QC阻断再修复 | 所有承诺候选可选；独立章节/锁定音频哈希不变；旧base/驱动/审批拒绝且revision+0；未知费用先对账无重复扣费；共享服务无越权卸载/清队列；真实模型状态和取消证据；QC block不得正式交付，修复后MP4及附属manifest齐全。可签AD_CREATION_BETA_READY；V1-P0另核13P0、6NFR及3–5分钟20+镜章节 |
| C：IT-C01..03 | ①同一10–15分钟母工程完成研究/脚本/素材/后期/标题封面/交付；②在3–5分钟20+镜章节做至少3处局部修改；③验证StyleProfile局部override/锁/受控恢复和评论锚点；④Codex、Claude Code、DSH各自真实标准链并接力；⑤关闭服务/故障恢复后重开和双导出；⑥逐条签P0/P1/NFR/AD-E与R4-UX | 母工程仍原生可编辑，非扁平MP4冒充；全部P0/P1/NFR、AD-E01..21及适用R4-UX无partial/blocked/NOT_RUN；三驱动分别有真实证据；100+镜性能四类操作各100样本p95≤100ms，媒体预算跑前按参考机冻结；全部旧适用回归、独立审查、用户签署齐备后才可V1-Full |

贯穿阈值：Host正常连接事件呈现p95≤2秒；服务5秒采样，15秒无新样本显示unknown/stale；定位/比较首次≤60秒、找到恢复≤10秒，学习后计时另记。采样过程和分母须在测试计划中固定，不能以截图代替时延实测。1440×900、1366×768验证展开工作流/系统侧栏后主要操作可达，390×844仅作审阅模式；键盘和焦点/状态播报有直接证据。以上来自现有PRD/02计划/R4门，不是本审视新加产品承诺。

## 主要风险与回退

- 新建工程失败：MAIN保持隔离初始化与补偿，禁用新建入口即可止损；已建立项目继续可读/导出，不伪造migration记录或删除用户工程。
- Host提交与native加载分离：保留待同步/未知状态，重新读取真实版本；不得为绿灯覆盖native事实。UI回退关新挂载，保留原工作台/selection/clock。
- 模型卸载与活动/失联任务竞争：服务端原子检查资源/任务归属，状态不明保持未知和受控阻断；禁用失败provider/模型动作，保留资产、receipt和未知费用记录。
- 旧输入/取消晚到：旧attempt产物保留审计但不可自动采用；按版本/授权重新准备，正式内容回退只走原restore新commit，不手改pointer或reset项目。
- DDL与生产数据回退：CP-A0在旧库副本验证upgrade/reopen和失败恢复；降级若不可逆必须明确只读/导出恢复方案，不能默认删库可回退。
- DSH/Comfy/provider能力不确定：只读探针和固定模板实测分别落证；A可按本地首端范围收口，C兼容缺项继续blocked，未经用户明确规格变更不得删除承诺。

本审视未改变历史Gate、原PRD或冻结对象；仅提供当前一致性缺口和待冻结合同边界。

## 返修复核与处置（2026-11-09）

本节复核本轮新增实施文档及当前入口；前文发现保留为初审记录，不应再全部理解为当前未修问题。仅只读检查文档、AGENTS与parallel-plan，未运行产品、客户端、迁移或媒体任务。

| 初审发现 | 当前处置与结论 |
|---|---|
| R2/R3布局与R4权威混杂 | 根01改为R4实施入口并引用详细01..05；07/08当前责任明确顶部WorkflowTopBar与非模态SystemControlPanel，旧字节归档。主设计矛盾已消除；仍需清除下列两个活跃表述残留 |
| 新建工程owner与路径冲突 | 根01 AD-A04及AGENTS明确MAIN拟建`src/host/projects/project-creation-service.ts`，PRODUCT只消费bootstrap。已解决；parallel-plan保护旧creative同名路径是额外禁止规则，不表示恢复旧路径设计 |
| PRODUCT缺system目录白名单 | 07与parallel-plan已同时纳入`src/app/system/`，MAIN保留挂载与生命周期命令权。已解决 |
| producer误作注册owner | 根01与详细02合同表显式分producer/consumer/注册，所有生产注册为MAIN。旧S0 registry作为冻结候选不改写。已解决 |
| artifact_submit与artifact_put等命名冲突 | 详细02 §1以S0候选`artifact_put`与`job_read/cancel`作为未来外观基线，旧名只算历史概念且不宣传兼容。命名设计冲突已解决，精确注册仍待CP |
| AGENTS旧审批状态混淆 | 当前明确R4-PROTOTYPE-HUMAN=PASS、S0-CONTRACT-REVIEW=REVIEW_PENDING、CP-A0=NOT_RELEASED，末段指定当前实施入口。已解决；R3候选段在当前权威之下作为演进记录 |
| s0短片/简化对象不足以承载全V1 | 详细02已明确60–180秒仅属A版本、研究/问答/选择分型、系统命令有限动作、完整QC和同事务审批消费；这是已识别的后续CP工作，不再属于当前设计遗漏 |

本次读取时仍见两个活跃文案残留：`09_PARALLEL_AGENT_HANDOFFS.md`PRODUCT可复制提示词仍说“两块observation…Agent控制台”；`06_ITERATION_EXECUTION_PLAN.md`§9仍把“真正产品原型”列为未完成。两者会影响任务输入，应直接改为R4组件和“精确生产合同/真实产品实现未完成”，不需要用户重新批准R4。根01 AD-A13仍列旧`src/app/m5/monitoring/`落点，发任务时应以详细实体表及07/parallel-plan白名单为准，若确需旧M5路径仍由MAIN独占。

未来CP的真实阻塞保持：精确runtime schema/TS/validator/registry/错误alias及版本组合SHA、DDL/CHECK/索引/旧库副本升级与恢复向量、可信身份/授权消费与commit原子性、snapshot/cursor/native ack真实关联、系统命令与活动/未知任务互斥、provider receipt/未知费用对账、固定客户端/依赖/许可证与实际探针证据，以及MAIN具体ReleaseAssignment。详细02/03/04/05已明确这些边界；文档本轮可供审核，不代表CP-A0已冻结或生产实现已释放。R4与旧PRD/Gate承诺保留，无需把后续实现验证提前写成文档阶段PASS。

### 最终文案闭环复核

再次直接读取确认：09的PRODUCT提示词已指定WorkflowTopBar与非模态SystemControlPanel；06 §9已明确“R4目标原型已批准”，未完成项仅列生产合同/真实探针/审查与准入；根01 AD-A13已改为`src/app/observation/`和`src/app/system/`。以上最后三处活跃文案残留已关闭。就本审视列出的合同权威、状态、路径和owner一致性问题，当前文档可按同一R4设计阅读；本结论只证明文档一致性，不证明精确CP冻结、真实探针、代码外审、业务验收或实现release。
