# 多Agent并行实施与主Agent集成方案

> 2026-11-09 S0 R3最新页面划分：工作流位于全局顶部Bar，横向展开/折叠；另一入口是独立系统控制面板，负责服务、模型加载/预热/卸载、重试与诊断，不是Agent控制台。原剪辑区与M5业务控件保留。当前效果图与交互稿见`s0-r3/review.html`；R2右侧两section布局退为历史，生产实现仍未释放。

> 2026-11-09用户纠偏（前端实施优先）：保留现有OpenFilm剪辑区和M5导演面板，仅在原导演面板中新增工作流展示、Agent控制台两个可折叠section；服务监控归控制台。工作台呈现同一项目的真实剪辑状态，禁止另建agent-workbench独立前端/聊天入口/时间轴。详情与当前原型见`s0-r2/README.md`（本段路径按当前文档目录解析）。原始PRD功能目标和后台制作计划继续保留，既有审阅/批准/编辑尽量复用原入口。新S0 R2仍待用户核验，不是生产实现release。

状态：`DOCUMENTS_ACCEPTED_PARALLEL_PLAN_PREPARED`；用户认可截至`867b3b33b9dd88c88e7bcca6c997d1ceba9c3051`的规划文档，并授权重新划分多Agent工作目录/任务/架构。此状态不等于IT-P01原型、IT-P02精确合同或生产实现准入已通过。当前可准备隔离工作目录与执行文档工作，生产代码等主Agent明确释放。

## 1. 剩余阶段与可并行程度

仍有6阶段：S0准备，S1–S5五个实现阶段；17包中2准备包、15实施包；正式交付仍A/B/C三轮。并行调整依赖与责任，不减少case/人工门，也不把3个开发者解释为3倍速度。

推荐主Agent+3实现泳道，共4个活动执行者。独立审查在轮末使用未参与该实现的上下文/会话；资源槽不足时先结束实现泳道，再启动只读审查，不为同时维持更多角色挤占测试资源。

同一个Git工作树不适合独立终端并发：分支、索引、未提交文件、dist、缓存和Git操作共享。采用**同父目录的3个worktree**，每个有独立分支/索引/源树/运行目录。它们属于同一仓库，共享Git对象，不是另建项目或复制引擎。

## 2. 工作目录

```text
/mnt/c/workspace/videoworkline/
  Narralens/                         主Agent唯一集成工作树
  Narralens-agents/
    bridge-observability/            接入/观测，agent-driven/lane-bridge
    product-workbench/               创作/工作台，agent-driven/lane-product
    media-delivery/                  媒体执行/交付，agent-driven/lane-media
    workspace-receipt.json           实际创建/基线/目录回执（无凭据）
```

主仓继续保留当前`migration/m2.2-coordinator-persistence`分支，不自动合main、不push。各泳道从同一完整集成SHA分出；准备时不安装依赖、不运行服务、不启动GPU，不假称进入实现。未来每轮从新的合同冻结SHA对齐；只允许主Agent按干净工作树与审核过的提交做合入/更新，禁止强制重置工作者分支。

`tools/parallel-workspace.mjs`默认只输出计划，`--prepare`才创建；已存在不同内容/分支的目标拒绝覆盖。命令不做reset、checkout旧SHA、删除目录或覆盖现有用户工作。实际目录状态以生成回执与`git worktree list`为准，文档路径不能冒充已创建。

## Codex与Claude Code执行分工（用户批准）

三个lane均采用“目录内Codex负责设计、文档、验收；同目录Claude Code CLI负责具体实现”。MAIN仍负责公共合同/核心实现、跨lane接线、统一验收和发布，现有白名单、阶段依赖与资源预约不变。两种CLI由本机不同模型供应商提供；不得推定同一额度、共享凭据或擅自切换供应商。此批准落实团队分工，不替代IT-P01/IT-P02、CP-A0或具体生产release。

每个lane的Codex先落盘任务单（完整base/contract SHA、路径范围、输入输出、验收case、命令、资源预约与停止条件），再交同目录Claude实现。Claude交代码、测试、复现与产物摘要；Codex冻结实现SHA后独立读取代码并重跑对应验收，MAIN集成后重跑真实组合链。CLI名称或供应商不同本身不是外审通过证据。

**同一lane只有一个写入者。** Codex设计/文档与Claude实现分时执行；Claude写入时Codex仅只读观察，不并发改文件、Git索引、分支或运行根。每个lane在自身`docs/parallel/lane-*/`维护`TASK.md`与`HANDOFF.md`，记录任务状态、当前writer、base/contract/HEAD、dirty文件、命令/进程、日志与接手理由。默认Codex是lane负责人，Claude仅接已释放的实现任务。

遇到Claude **429**，无需再问用户，Codex自动接手已授权剩余实现。先确认原Claude调用/子进程已结束或停止并记录，不能只凭一个429日志判断全部进程停止；记录错误与未完成工作，复核HEAD/差异、保留全部未提交内容，移交唯一writer后继续。不得reset/stash覆盖，不把失败或未完成测试写PASS；不得新增付费请求、外传或更换凭据。Claude恢复后默认仍停，直到Codex显式移交，禁止双写/自动抢回。

Codex接手实现后，其自测只能称内部验证，不能自签独立外审。该候选由未参与实现的MAIN/其他干净只读审查上下文复核；若MAIN也参与实现，则另取未参与的审查上下文。独立复核暂不可得时标`REVIEW_PENDING`，可继续无依赖的已授权工作，不能越过相关验收门。

## 3. 责任划分

| 角色 | 实现职责 | 目录所有权（新增模块） | 主Agent接线 |
|---|---|---|---|
| MAIN 主Agent | PRD/架构/合同、数据与事务内核、一般项目创建接缝、审批/DriverSession/资源租约、公共装配、集成及验收 | 所有公共合同、旧核心文件、共享配置、跨泳道测试/证据 | 唯一能改server/DDL/registry/核心write路径并合入候选 |
| BRIDGE 接入观测 | stdio MCP外观、入口Skill/技能库、客户端探针、事件/健康/资源read model、launcher纯模块 | `src/mcp/`、`skills/narralens/`、`skills/narralens-lib/`、`src/launcher/`、`src/host/observability/`、`tests/agent-driven/bridge/` | Host应用端口、服务启动命令、可信service control由MAIN注册 |
| PRODUCT 创作工作台 | 后台任务/产物服务；前端只新增工作流与控制台展示，链接原操作入口 | `src/app/observation/`、`src/host/creative/`、`src/host/workspace/`、`tests/agent-driven/product/` | 生产入口与旧M5挂载、公共仓储/项目创建/bootstrap与提交由MAIN |
| MEDIA 媒体交付 | snapshot render/QC/包、Comfy固定模板/媒体验证、下载/声音/字幕/封面workers | `src/host/render/`、`src/host/preflight/`、`src/host/delivery/`、`src/host/providers/`、批准的`src/adapters/`子目录、`tests/agent-driven/media/` | ResourceClaim/Job/Asset/Approval端口与最终采用由MAIN |

拟新增目录是所有权规划，不宣称已经存在。详见机器规则`parallel-plan.json`；任何与旧源码同路径实体只允许MAIN发起单独文件授权，不靠宽泛目录白名单覆盖旧实现。

PRODUCT不得独立实现第二条timeline/数据库；BRIDGE不得导入数据库或adapter直执行业务；MEDIA的回调不得直接写source/revision。各模块通过冻结端口依赖注入，测试替身用于模块开发，真实链由MAIN替换成生产适配后证明。

## 4. 主Agent独占文件与变更流程

独占：`src/host/server.ts`、`src/host/projects/**`（包括RevisionStore/Resolver/Coordinator/快照/锁）、`src/host/engine/**`、`src/host/{api-error,security,persistent-job-store,job-defaults,outbox,start,recover}.ts`、`src/contracts/**`、`contracts/**`、`package.json`/lockfile/tsconfig/vite/vitest、旧`src/app/m5/**`、原厂vendor/gitlink、主PRD/架构/追踪/正式evidence。

共享文件需求提交到泳道自己的`docs/parallel/lane-*/requests/`：具体符号、schema/DDL/依赖、消费者、兼容与验收风险。MAIN先合并/冻结公共变更，再释放相关任务。默认不是把server.ts拆成3份，也不是让三个Agent各改一套validator表。

旧M5集成需要PRODUCT建议时，只提交自身文档目录中的独立补丁/请求，由MAIN审核后在集成仓修改受保护文件并提交；静态白名单不因口头授权放宽，不允许worker在自身提交里夹带保护文件变更。同一文件一次只有一个owner，规则写在每批任务release清单。

## 5. 精确合同前置包（CP-A0/CP-B0/CP-C0）

这些是每轮开工检查点，不增加正式开发阶段。MAIN冻结：

1. HostInstance/发现/鉴权/服务归属；AppPort与版本/错误协议。
2. 新建/迁移项目origin、ProjectCreate/Read、初始snapshot和工作台projection。
3. Brief/Question/Answer/CreativeArtifact/DAG/Decision/SelectionContext版本。
4. Approval绑定可信人/动作/plan/input/期限/费用；严格409与三类锁。
5. Job/ChildJob/attempt/lease/幂等/取消/未知结果/ResourceClaim，单库DDL与旧库重开。
6. WorkflowSnapshot+cursor、event版本/回放/乱序，Health/Resource/Queue时间与unknown。
7. SnapshotRead/RenderRequest、AssetRegistration/结果/来源/rights、ComfyManifest/ExecutionRef、QC/Delivery。
8. 每个producer/consumer至少正向、缺字段、错误版本、过期/取消或无权限fixture；生产与测试接缝清楚。

冻结是具体运行时schema/TS/validator/SQL/fixture/迁移/错误表的组合SHA。现在的Markdown接口草案不是CP-A0已通过。MAIN可分批冻结相容模块以降低等待，不能让下游自行发明合同。

## 6. 真正并行的排程

旧17包顺序保留里程碑，依赖表升级为多前置DAG；编码释放条件与正式包验收依赖分开，允许基于冻结port提前实现，但不得提前签验收。

| 批次 | MAIN关键路径 | BRIDGE | PRODUCT | MEDIA | 汇合条件 |
|---|---|---|---|---|---|
| P文档 | 合同/DDL/原型与授权闭环 | 接入/健康协议建议 | 可操作原型与状态 | fixture/Comfy/渲染合同审视 | IT-P02+CP-A0真实冻结 |
| A1基础并行 | 一般project/bootstrap/持久共享仓储与AppPort | A01生命周期模块、A02 MCP+Skill、观测基础 | A03创作对象与两面板、A04后台业务模块 | A06 renderer/QC模块基于SnapshotReadPort | 各模块编译/消费者合同，MAIN早期接线 |
| A2首链 | 新项目/可信批准/源发布接缝，组合真实调用 | MCP/事件真实接线、首端探针 | A05真实选案/本地组装、实时业务图 | A06真实snapshot渲染、改单镜第二导出 | IT-A01..A06生产链+统一A门 |
| B1协作 | CP-B0、DriverSession/审批/资源租约与事务适配 | B03监控read model、重连/归属 | B01产物编辑/选案/差异、B03监控UI | B02 worker/下载执行器消费者 | 资源/版本/取消/产物基础真实接通 |
| B2制作 | schema/路由/来源费用/正式采用接线 | Comfy/worker健康关联、客户端回归 | B06交付/概念/转场任务观测与原入口定位 | B04下载/Comfy→B05声音→B06 QC交付；同泳道内部串行 | 各能力实证+统一B门 |
| C完整V1 | CP-C0、旧后期契约与整片集成 | C02多驱动/监控接力 | C01风格/反馈与后期交互 | C01/C02后期能力与长片媒体 | C01/C02汇合→C03正式终验 |

可并行不代表所有模块同时开始：渲染模块可基于冻结snapshot端口写代码，真实短片验收必须等一般项目与提交事实接通。B2同一MEDIA泳道的任务并不虚构为同时有三名媒体Agent；需要扩大人数时必须重分互斥子目录与资源。

## 7. Git与接口纪律

工作Agent：仅提交自身allowlist路径，显式git add，记录base SHA/合同SHA/commit列表/命令与case/未完成/请求。禁止切换主仓分支、stash/reset用户工作、全目录git add、改别人的分支、自动push或合main。

MAIN：每轮发release记录→核对分支与路径diff→审代码/合同→按依赖挑选有序提交（默认cherry-pick，提交来源保留在integration ledger）→增量回归与真实Host smoke→更新集成SHA→再释放后续任务。不得盲目把所有worker分支整体merge，接口变更先升级消费者。

共享错误由MAIN协调修到通过；跨泳道集成问题不能循环打回三个作者而不定位边界。出现冲突时先核对owner/合同版本，不能只为编译通过改语义。候选冻结前收齐owner ACK；冻结后不接新功能，修复生成新候选和证据。

## 8. 测试、目录与资源隔离

各worktree：独立node_modules链接树（可共享pnpm content store）、dist、var、临时DB/asset/staging/snapshots/profile/日志/端口/instance_id。禁止共享可写DB或给三lane指向同一运行根；不能靠worktree区分而误判GPU也有三份。

纯函数/类型/小型合同测试可并行。**全机重型门默认1槽**：全量pnpm check、多Host集成、ffmpeg渲染、大fixture首建、GPU/Comfy模型加载按主Agent统一资源锁排队。槽位可在测量后调整，不是调用预算/次数上限。当前`vitest.config.ts maxWorkers=1`保留；不得私自提高或同时开三套全量门。

跨worktree统一锁拟位于`Narralens-agents/.resources/`，不能仅在每个var里锁；真正执行前由MAIN冻结资源协议。共享OpenFilm/Hypit checkout只读，构建/依赖变动需排他或在自有隔离副本执行。既有M5 var/m5-fixtures按worktree独立准备；相同worktree内首建必须串行或补跨进程锁，不能并发写固定缓存文件。

worker可用真实本地数据做已授权模块验证，但不得自行启动可见浏览器/读取J盘/下载模型/产生付费或外传；重型任务先拿统一资源预约。测试profile按精确实例清理，不kill所有Chrome/Comfy。

## 9. 统一验收与交付

三层结果分列：组件合同通过、真实Host/MCP/媒体接线通过、组合用户路径通过。worker lane commit证据只证明模块；正式报告绑定MAIN组合冻结commit、固定配置/上游/fixture与实际命令产物，不能拼接不同commit的PASS冒充总通过。

每轮统一执行现有适用回归+新增合同+架构fitness+真实链+取消/崩溃/重开+安全+媒体/性能/Headless；独立外审不由实现作者自签。人验A短片、B协作/Comfy/监控、C长片，原验收口径保持。

待独立审核时可建立只读review worktree，绑定冻结SHA并用独立运行根；这不是第四条长期实现泳道。发现问题回当前轮修复、重新冻结与受影响复验。主Agent承担组织验收和整合责任，不代表可以替用户签事实/审美或替独立审查签PASS。

## 10. 当前可启动与不可启动

已获认可：现有21体验/13架构/六阶段/三轮目标文档；本轮提出的并行责任/目录属于新的执行设计并已落盘。
可启动：隔离worktree准备、按lane参与IT-P01/IT-P02文档/原型任务、基线复核。
不可启动：在CP-A0和生产实现准入未明确前启动三条生产代码开发；不得声称合同已冻结或V1开发已完成。
