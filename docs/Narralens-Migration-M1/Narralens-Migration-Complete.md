# 迁移总入口：从 304c891 继续，不从零重建

**项目：叙镜 · AI 导演工作台 / Narralens — AI-Assisted Directing Studio**  
**文件包：M1.0 迁移实施设计；编制日期 2026-10-16；产品仍未完成 V1。**

这是针对用户提供的 `304c891 / D4.2.1 候选完成、外审待完成` 状态的增量计划，不是当前仓库的独立审计报告。本文没有访问该本地仓库，没有执行当前 126 项业务测试，也没有在本机集成 OpenFilm。`main == origin/main`、工作树清洁等均为用户本轮报告；Codex 必须在 M0 重新读取。

## 1. 立即执行的决策

保留 Narralens Host、资产与许可台账、真实 Claude CLI 提案链、费用审计、revision / visual lock / journal / compensation 的已验证行为；把 Hypit-specific 代码隔离成旧引擎适配器。在固定版本的 OpenFilm Studio 内开发叙镜导演模式，默认渲染仍由 OpenFilm 执行。VibeMovie 仅用于结构化提案方法或小模块的选择性借鉴；不另起 Gemini 服务、不搬入它的全套时间线和 Remotion 后端。OpenMontage、HyperFrames、HeyGen 后续按能力接入，均不得成为迁移首轮必需依赖。

## 2. 不立即切换生产底座

执行顺序：`M0 基线复核 → M1A 旧门禁收口 与 M1B 隔离 OpenFilm 探测 → M2 受控引擎与迁移副本 → M3 素材化 → M4 事务采用/恢复 → M5 同页叙事地图 → M6 P0交付 → M7A…M7D P1闭环`。

M1A 与 M1B 可以在隔离 worktree 中并行，不能共享可写业务工程。M1B 技术探测不必等待旧 Gate，但 **M1A 和 M1B 都通过前不能让 OpenFilm 接管受控项目**。若 OpenFilm 验证失败，保留旧引擎，输出 ADR；不要为了让迁移成功而降低锁、证据或真实导出的标准。

## 3. 这次不再按旧日号连续推进

D4.2.2/D4.2.3 尚未开始，因此停止按旧 Hypit 方案直接实现；它们的业务目标转入 M3/M4。D5 中持久任务、事件和写入互斥必须前移到 M2，不能等到素材化做好才补恢复。D6 的底层 NLE 不再自研；复用 OpenFilm 原生剪辑，开发章节/候选/地图增量。D7 和所有 P1 不删除，仅重新映射。

`D1–D4.1 passed_on_hypit` 保留历史事实；`passed_on_openfilm` 必须有新证据。D4.2.1 不能因迁移被标为 passed 或不再需要。

## 4. 文档使用与效力

1. 用户本轮进展和本地当前代码/证据是事实来源；二者冲突则先暂停归并、保留差异。
2. 本包是新的 **目标设计**；M0 写入 CR-MIG-001 和本地 ADR 后才成为仓库有效设计。
3. 本地 `docs/11_V1_Traceability.md` 继续作为主索引；本包不覆盖它，而是提供合并映射。
4. 旧 Gate 记录永不倒改。设计变更通过增量列、ADR 和 superseded 标记表达。
5. HTML 是给人阅读的完整汇总；`docs/` 是同内容的 Markdown 镜像；`contracts/` 为拟议合同，不冒充现有 API；机器清单的 PASS 必须由执行证据写入，页面不能勾选生成 PASS。

## 5. 本次首轮授权边界

把本包交给 Codex 后，首先执行 M0、M1A、M1B。允许安全的本地文档、测试、小修复和隔离探测，不授权 force push、删除旧仓库、自动迁移全部工程、无预算付费调用或重启旧后台自动开发。两门通过后输出 M2 开工审计包；后续按阶段逐门推进。若版本已前进，不 `reset` 到 304c891。

## 6. 产品验收名称

- `Gate V1-P0`：迁移底座与 P0 闭环通过；真实 3–5 分钟章节、20+镜头、3个位置比较到导出。
- `V1-Full / P0+P1`：Gate V1-P0 + 全部 M7 子门 + 真实 10–15 分钟流程。D7 或 M6 结束不能宣称完整 V1。
- M 编号是阶段而非天数。原来“一周/一月”保留为业务期望，不作为本次剩余工时保证；M0 依据真实运行时间和依赖重估。


---

# 事实基线、保留资产与证据等级

## 1. 当前状态（U0：用户报告，未独立复验）

| 范围 | 用户报告的状态 | 本包如何使用 |
|---|---|---|
| 代码 | main/origin main 304c891，工作树清洁 | M0 获取完整 SHA、branch、status、upstream；不是自动 reset 目标 |
| D1 | 30秒 Hypit 工程、双导出、重开、单镜修改、ffprobe/帧样本 | 留存旧引擎基准；可复用素材与测试断言，不能转移为 OpenFilm 通过 |
| D2 | 单页 Host、真实 Claude CLI Runner、单提案、SSE、只读工程链 | 保留 Runner 和契约，验证是否包含 Hypit 上下文耦合 |
| D3 | visual fit、revision、visual lock、journal、补偿恢复 | 复用规则；引擎文件写入/恢复必须重新验收 |
| D4.0 | 已登记素材 typed media.replace、真实构建/精确恢复 | 保留 typed intent 和测试意图；更换 source adapter |
| D4.1 | 3–6结构化提案、费用/模型审计、只读比较通过 | 不再重做提案服务；不等同素材化或采用通过 |
| D4.2.1 | 流式 MP4 导入、媒体验证、来源/许可、库存、Manifest @1→@2、TOCTOU、恢复 | 候选完成；补证据/外审，不能关闭 Gate |
| 最后门禁 | TS、16测试文件、126/126、production build；交互均 Headless | 原报告数字留档；M1A 以本次命令和逐编号证据替代聚合推断 |
| 未实现 | D4.2.2/D4.2.3/D5/D6/D7/完整V1 | 新计划中的目标，不是可迁移现成代码 |

P0：1项完整、8项部分、4项未开始。非功能要求中全流程持久恢复、120镜性能和完整人工体验均未通过。报告中 85%–90% 等文档支撑率为用户评估，不是本包测算；不能拿它们计算研发完成度。

## 2. 本地必须读取的文件

`Narralens/docs/11_V1_Traceability.md`、`Narralens/docs/implementation/D4.2.1-internal-implementation-audit.md`、当前 `03_Architecture.md`、D4.2.1冻结验收矩阵、routes/contracts、actual journal/recovery、package scripts、fixture 与 evidence manifest。路径以 `git rev-parse --show-toplevel` 后查找结果为准；不假设一定有两层 Narralens。

本次容器中只有早期规格/原型与用户摘要；上面这几个**当前源码权威文件未提供**。因此本包给出具体设计与合并规则，但不会编造现有函数名、HTTP路径、测试编号或源码行号。M0 输出 `baseline-observed.json`、`code-map.md`、`route-inventory.json` 后填入真正定位。

## 3. 保留/适配/停止/延后清单

| 对象 | 动作 | 不得丢失的行为 |
|---|---|---|
| Host、Origin/token、项目身份 | 保留 | 不开放未认证的新 Studio 写端口 |
| 上传、媒体探测、来源许可、Manifest@2 | 保留为领域模块 | 上传不自动进时间轴；媒体内容哈希与TOCTOU；部分库存失败隔离 |
| Hypit TOCTOU 与 engine root 校验 | 拆为通用安全校验+Hypit实现 | 新增 OpenFilm 实现；不是直接删除旧断言 |
| Claude CLI Runner、D4.1多提案 | 保留+适配上下文 | 真实模型/成本、不读写production source、不可伪造素材URL |
| typed edit、锁、revision、journal | 保留合同+抽取端口 | 幂等、全局项目队列、失败补偿；所有原生路径也受控 |
| Hypit Author/Run/build | 隔离旧适配器 | 可重开/复验旧fixture；不作为OpenFilm新项目运行依赖 |
| 尚未建的自研 TimelineSurface/播放器 | 停止重复实现 | 用户需要的缩放、逐帧、选区仍必须交付，由原生组件+适配达成 |
| Story Atlas HTML | UX参考/测试脚本 | 不作为生产数据模型或另一条主时间线 |
| VibeMovie完整应用/Remotion全片渲染 | 不集成 | 小模块借鉴保留许可证与来源；不引入第二套project state |
| 插件市场、多租户、自动发布 | 延后 | V1-P0不前置；P1仅所需最小能力接口 |

## 4. 证据分级和不可继承项

`USER_REPORTED`：仅来自本轮报告。`SOURCE_REVIEWED`：阅读源码/文档，不代表运行。`AUTOMATED_EVIDENCED`：能对应case、命令、产物与哈希。`INDEPENDENT_REVIEWED`：独立审阅冻结commit，列阻断问题。`HUMAN_ACCEPTED`：零号用户在实际本机交互后的签署。

Headless、headed自动化、人工审阅是三种证据，不能互换。新引擎必须重新验证预览/时间码、帧数、音频、工程往返、原生写入口与异常恢复。旧126项不删除、不用新冒烟测试替换；若旧测试依赖已迁出模块，保留legacy CI配置和测试迁移说明。

## 5. D4.2.1 内审文档的修订

保留原内部PASS文本和对应commit；追加“逐编号直接证据尚不完整，Gate待外审”状态，不篡改历史。修正文档顶部和实体/API表的状态不同步，API表各行附 implemented_at、gate_status、evidence_ref。导入成功的UI词汇仍为“已登记/可查看”，不是“已入片/已采用”。


---

# 新旧架构、ADR 与唯一写入控制

## 1. L0：旧架构与目标架构

| 层 | 旧基线/用户报告 | 目标设计 | 迁移动作 |
|---|---|---|---|
| 交互 | 单页 Host + 少量镜头fixture；完整工作台未实现 | OpenFilm Studio同一React应用，导演地图/原生精剪共享播放位置 | 不新造NLE，不嵌两个iframe编辑器 |
| 内容智能 | 真实Claude CLI Runner与结构化多提案 | 沿用Runner；VibeMovie方法适配为ProposalPlanner | 保留D4.1；不另建Gemini后端 |
| 控制平面 | Narralens revision/lock/typed edit/journal | 同一Host + EditCoordinator + EnginePort + 持久Job/Event | 补原生写入、历史、导出及provider边界 |
| 媒体 | 导入/库存/Manifest@2 | 同一资产台账+代理+derived lineage | 原生拖入也调用现有导入服务 |
| 工程 | Hypit Author Source + Run | OpenFilm film.html及依赖闭包+受控已提交快照 | 每个项目只绑定一个引擎 |
| 预览/渲染 | Hypit真实build，仅短fixture验过 | OpenFilm播放器/检查/默认渲染 | 新引擎真实重验，不复刻渲染器 |
| 可选扩展 | OpenMontage设计上游 | OpenMontage/HyperFrames/HeyGen独立能力适配 | 输出提案或资产，不写最终工程 |

```text
单一 Narralens / OpenFilm Studio 应用
  ├─ 原生播放器、时间轴、Inspector、导出控件
  └─ StoryAtlas、CandidateFocus、证据/决策上下文
                    │ Typed Command / 只读投影
                    ▼
Narralens Host（唯一公开loopback入口，原有Origin/token）
  EditCoordinator / ProjectActor / LockService / Job&Event / AssetRegistry
                    │
              EnginePort（按project.engine分派）
         ┌──────────┴───────────┐
     HypitAdapter             OpenFilmAdapter
     旧基线/回退               新项目、固定fork
     不双向同步                staging → validate → commit snapshot
                                   │
                    film.html + scenes + subtitles + settings
                                   │
                    readonly preview / render / QC / delivery
```

## 2. 六条不可折中的 ADR

**ADR-001 单项目单引擎。** 应用在过渡期可以打开两类项目，但一个 projectId 只有一个 engine binding。禁止每次编辑双写 Hypit 和 OpenFilm。研究提案和地图位置不是第二份最终影片。

**ADR-002 Native Studio 也不能绕过规则。** patch 原生编辑 transport 和实际服务器写入边界；将可支持动作转换为类型化意图。无法判断影响/无法遵守锁的原生操作必须显式禁用并显示原因，不能匿名透传。仅拦新导演按钮或仅隐藏旧端口不算完成。

**ADR-003 默认 OpenFilm 渲染。** VibeMovie不作为全片renderer。ffmpeg合成可用于候选proxy；生成MP4不是已拥有内部可编辑轨道。

**ADR-004 复用已建 Runner。** 编程助手（本地Codex）、运行提案CLI（现有Claude）、独立审计（Claude Code独立会话）分别记录角色。外审不可用则 REVIEW_PENDING，不自签PASS。

**ADR-005 staging隔离，审阅后提交。** 模型、插件、OpenFilm原生写逻辑只能编辑staging；渲染读取不可变snapshot。最终commit由Narralens协调。直接把线上source文件夹授予CLI写权限不在安全边界内。

**ADR-006 先收口再接管、可前进不隐式回退。** M1B可探测，M2以前不接管。迁移是copy-on-migrate；回退重新激活旧副本，不把新编辑自动逆转换到Hypit。

## 3. OpenFilm实际可复用的落点（R1–R5）

官方布局包括 `studio/ui`（React/Vite）、`studio/server`（项目/编辑/历史/媒体）、`src`（工程/检查/渲染）。`ProjectView.tsx` 已连接 Timeline、Preview、SourcePreview、Inspector、ExportCenter等，适合在现有应用内增量开发。[R1][R2]

`film.mjs` 当前 `editProjectFilm(root,base,ops)` 在写入后报告 `rebased`；它没有以 base 不同作为统一拒绝条件。[R3] 因此不能把其返回成功等同于 Narralens 的严格409。`revOf` 只基于 film.html 的短摘要；Narralens继续保留自己的数值revision和完整依赖摘要，不拿它替换既有合同。

文档中出现的上游路径是2026-10-16读到的main源码位置，**不是固定SHA后的稳定API承诺**。本包未成功获得full commit SHA；M1B本地固定并保存代码定位、依赖lock和许可证摘要后使用。npm发布版和源码运行条件可能不同，不照抄latest命令执行生产流程。

## 4. 原生写入路径登记必须逐项完成

| 入口 | 策略 | 审核 |
|---|---|---|
| timeline trim/move/split/speed | 映射帧范围、timing/visual影响、revision；事务提交 | 真实拖拽＋直接HTTP均测试 |
| Inspector crop/fit/text/overrides | typed operation；原生optimistic preview仅为draft | 锁定时server拒绝且UI复位 |
| 资产拖入/粘贴/上传 | 进入原有AssetImportService；未登记asset不能采用 | provenance与manifest契约一致 |
| subtitle/audio edits | 共享消费者和narration锁；对齐失效标记 | 不能静默重算已锁旁白 |
| 原生undo/redo/history restore | 翻译为受控恢复/new revision | 不直接git checkout覆盖source |
| native provider生成/CLI get | 同一预算/外传授权；产物先暂存 | 不允许隐藏副作用入口 |
| 导出与自动保存 | snapshot固定；draft与commit区分 | 导出不能读半写入stage |
| 外部编辑器/文件watch/Agent写文件 | 只写stage；意外变更进入attention | watcher不能自动接受为已审修订 |
| rename/delete/import project/模板覆盖 | 范围全项目、不可绕过原子性和路径安全 | 未适配前禁用 |

路由清单必须包括 HTTP、WebSocket/IPC、CLI、原生文件操作和第三方provider回调。每条写入口具有 `translated/blocked/read_only` 策略及测试编号；`unknown` 存在时 M2 不通过。

## 5. 工程主记录与运行权限

控制层保留既有store/journal，新增 EngineBinding 与 SourceSnapshot。目标存储采用不可变revision目录和一个持久commit-record。以现有持久存储实现原子提交；若需要更换store/增加数据库，必须先提交schema迁移ADR并演练旧journal恢复，不顺手换掉整套Host。

现有Host单项目互斥扩展为所有写动作共用的ProjectActor。stage在同文件系统；原生write函数对stage调用，不对active snapshot调用。每次预览/媒体请求绑定snapshot-id，避免一个播放器混读两个修订。服务重启先恢复未完成journal，再开放写入口。

这保护受控应用和worker路径，不宣称能抵御同操作系统用户使用管理员权限强改文件。对于意外外部修改需检测并隔离；运行不可信scene时，应使用无凭据、受限文件和网络的工作进程，不能只靠路径约定。


---

# 规格变更单 CR-MIG-001 与完整需求追踪

## 1. 变更范围

**改变实现，不降低产品目标。** 工程/默认渲染由Hypit改为固定OpenFilm；UI从未完成的Host NLE转为OpenFilm应用内导演增量；保留60–180镜头、章节、三路候选、分项选择、后期、封面标题、事实来源。图谱不是发布给观众的互动电影，成片仍是一条线性视频。

| 决策 | 旧设计 | 新设计 |
|---|---|---|
| 唯一已采用工程 | Hypit Author + selected Run | 每个新项目的OpenFilm SourceSnapshot及固定资源 |
| 两种项目共存 | 未定义 | 旧Hypit只在兼容入口；新项目OpenFilm；不做双写/双向同步 |
| 提案驱动 | Claude Runner已实现 | 保留该事实；VibeMovie只借鉴structured editing，不换模型服务 |
| materialize | planned ffmpeg composite | 原生segment计划是编辑载体；composite主要用于比较proxy；明确flattened降级 |
| 原生编辑 | 未完成 | 全部能力适配/阻断登记；无适配动作不匿名转发 |
| 验收阶段 | D4.2.2→D7 | 映射M3→M6；D5最小持久控制前移M2 |
| V1含义 | P0/P1可能混淆 | 分开Gate V1-P0与V1-Full；后者必须M7A–D |

## 2. 不得静默删除的体验

保留灵感/观点输入、资料证据与剪辑素材分开、章内镜头、六类候选（画面/解说/音乐/音效/台词/过场）、时间细节和局部修改、旁白复用、版本与检查点、后期和交付。P0的完整专业NLE替代、任意复杂跨镜变形仍非承诺；跨镜**选择**必须可表达，跨镜**执行**按capability显式支持/拒绝。关键帧只宣称实际适配并渲染过的属性，不能把旧原型功能全标production-ready。

## 3. P0逐条新门映射

| ID | 要求 | 用户报告状态 | 新门 | 新的完成定义 | 核心用例 |
|---|---|---|---|---|---|
| P0-01 | 项目创建/任务包导入 | 未开始 | M5A | CreativeTask表单/聊天文本/标准包→校验→新OpenFilm项目→重开；原始观点保留 | UX-01,UX-02 |
| P0-02 | 章节/脚本/镜头导航 | 部分 | M5A | 稳定章/句/镜身份映射到实际片段；120镜数据不靠fixture数组下标 | UX-03,UX-04 |
| P0-03 | 真实播放器/统一时间码 | 部分 | M1B,M2,M5A | 原生播放器绑定同一snapshot；逐帧往返；30fps确定性夹具 | OF-02,TM-01,UX-05 |
| P0-04 | 全片时间轴/局部精修 | 未开始 | M5A,M5B | 复用原生Timeline；地图语义缩放；不建独立最终timeline | UX-06,PF-01 |
| P0-05 | 镜头/区间/逐帧选择 | 部分 | M2,M5A | 半开整数帧区间；任意区间可选择；超出支持编辑能力显式拒绝 | TM-01,TM-02,UX-05 |
| P0-06 | 3–6个结构化提案比较 | 完整（旧引擎） | M2,M3,M5B | 保留D4.1；engine-neutral提案；本地最多3路代理播放；比较不写source | PR-01,PR-02,UX-07 |
| P0-07 | visual/narration/duration锁 | 部分 | M2,M4B | 三类锁在服务器及原生写路径主动校验；覆盖共享消费者 | TX-03,TX-04,TX-13 |
| P0-08 | 本地素材/来源/许可 | 部分 | M1A,M2,M3 | 导入收口；AssetManifest@2兼容；segment绑定、proxy lineage、审批 | IM-01..IM-26,MT-01,MT-03 |
| P0-09 | 局部差异确认 | 部分 | M4A | 影响快照SHA含source闭包/资产/锁/范围；无snapshot返回428 | TX-01,TX-02,TX-05 |
| P0-10 | 版本/撤回/恢复/冲突 | 部分 | M2,M4B | 原生undo/redo转受控commit；恢复旧内容生成新revision；并发/崩溃 | TX-06..TX-12,JB-01..JB-06 |
| P0-11 | 重开/真实MP4导出 | 部分 | M1B,M4,M6 | 30秒＋3–5分钟章节双导出；媒体/音轨/中文；导出绑定snapshot | OF-01..OF-06,DL-01 |
| P0-12 | 标题/封面候选 | 未开始 | M6 | 8标题、4封面方向与可视候选；正文一致性与人工选择；provider没接入不算完成 | DL-02,DL-03 |
| P0-13 | 发布前检查 | 未开始 | M6 | 字幕/音量/黑帧/缺素材/许可/事实缺口分级检查；阻断导出发布版 | DL-04,DL-05 |

## 4. 非功能要求映射

| ID | 要求 | 新门 | 目标 |
|---|---|---|---|
| NFR-01 | 本地优先 | M2,M7C | loopback/Origin/token、scene隔离、受控外传日志、钥匙不进前端 |
| NFR-02 | 可恢复 | M2,M4 | 恢复优先于写入；stage与active隔离；不可识别状态attention |
| NFR-03 | 可观察 | M2,M3 | Job和事件持久化；cursor去重；重启不把任务伪标成功 |
| NFR-04 | 可测试 | 全部 | 旧case保留；编号→实际测试→产物→reviewer；禁止以总数替代 |
| NFR-05 | 性能 | M5C,M7D | 120镜/900秒导航操作p95≤100ms；不把该指标用于渲染和生成 |
| NFR-06 | 可访问 | M5C,M6 | 键盘/焦点/减少动效/100%与原生200%；headed与人工评审 |

## 5. P1独立阶段，不能留一句“后续完善”

| 门 | 范围 | 出口 |
|---|---|---|
| M7A | StyleProfile与长片内容 | 版本化账号风格；母项目完整10–15分钟结构；修改不影响锁定项 |
| M7B | TTS/ASR/字幕适配 | 本人声音/授权合成；对齐失效与消费者追踪；真实provider往返 |
| M7C | 素材检索生成/预算/反馈 | 有权限的远端来源、资产外传审批、成本上限、有限重试；评论绑定版本/镜头/范围 |
| M7D | 完整V1/P0+P1集成 | 真实10–15分钟项目全流程；风格、声音、来源、反馈；完整回归与用户签署 |

## 6. 规格合并方式

保留现有PRD的P0/NFR编号及本地ID，新增 `implementation_track`、`supersedes_design`、`legacy_evidence`、`target_gate`、`evidence_status`。报告里的权威 `11_V1_Traceability.md` 仍是入口；本包表为待合并设计。若本地同一ID的文字不同，逐条记录冲突并以用户原意+冻结规范裁决，不直接覆盖。

03_Architecture.md必须同时更新概览、实体表、路由状态、部署图、当前状态和不做项。新增 `docs/migration/CR-MIG-001.md` 与 ADR；旧计划写明“Hypit实现路线已被替代，业务验收映射到Mx”，不是删除D4.2.2/D5。

所有新增schema示例标 `design_contract`；旧AssetManifest@2不因换引擎自动加版本。确需字段时采用独立EngineBinding sidecar或正式迁移，不往旧严格schema偷偷塞字段。

## 7. 需求仍需真实输入，但不阻塞M0/M1

首条时政题目、资料截止日期、声音选择、合法素材包、预算额度、参考片偏好并未由本轮重新确认。M1本地fixture可离线验证；M6真实内容和真实标题/封面需要这些输入。没有预算授权不得付费；没有材料不得伪造“已完成时政样片”。状态应为BLOCKED_INPUT而不是模拟通过。


---

# 工程迁移、兼容策略和可执行回退

## 1. 三条迁移路线明确优先级

| 路线 | 用途 | 结果 | 是否证明可编辑迁移 |
|---|---|---|---|
| A 受限语义转换（首选） | 已有三镜fixture、已知fit和media.replace | clip级OpenFilm元素＋独立音轨/字幕＋稳定ID | 逐项通过才可声明 |
| B 从原始素材/任务重建 | 任意Hypit源码无法机械映射 | 新项目，old→new人工映射与来源记录 | 是新建/重建，不冒称无损转换 |
| C 旧引擎渲染后导入MP4 | 应急保留观看结果 | flattened资产，可剪但内部不可改 | 否；不能作为M1B或M6可编辑性证据 |

不做任意Hypit DSL→OpenFilm通用编译器。只有M0盘点出来的真实已用功能列入第一版转换范围。不存在的历史长片不要预设为已经迁移。旧提案记录保持original engine/base；新引擎采用必须重新投影、绑定、审阅，不能把旧approval直接复用。

## 2. migrate-copy流程

1. M0制作旧repo分支/完整SHA、业务工程、manifest@2、资产、journal、run/export和测试产物的可验证清单；凭据排除。
2. 获取旧项目一致读快照；若旧journal未恢复，先恢复或标attention，不从半提交状态转换。
3. 创建新projectId和新EngineBinding，写 `migrated_from {project_id, engine, revision, digest}`；旧目录保持字节不变。
4. 做supported-feature inventory，任何未知CSS/动画/字幕绑定/速度/字体等输出 `unsupported[]`，不能悄悄栅格化。
5. 转换到staging；稳定clip-id与shot-id映射，保留时间/asset内容哈希/原声和文字。仅注册资产，不把D4.2.1库存全插入timeline。
6. 校验source closure，真实OpenFilm预览、导出、重开、改变一个已迁移镜头、再次导出。
7. 出具MigrationReport和回退演练结果。M2通过后才激活该新副本；工程起始revision按本地项目创建约定，旧历史单独只读保留。

## 3. 文件迁移与记录

目标布局示意（先映射当前代码路径，不要求搬空目录）：

```text
<existing-repo>/
  <existing-host>/               保留并抽取EnginePort
  adapters/hypit/                旧适配器与legacy合同测试
  adapters/openfilm/             新适配器
  vendor/openfilm/               固定源码/补丁清单（M0按仓库规范落点）
  <project-root>/
    assets/<content-hash>/       引用已登记资产；兼容原Manifest@2
    .narralens/engine.json       projectId,engine,upstream_sha,parent
    .narralens/commits/          commit-record与snapshot索引
    .narralens/journal/          旧journal兼容读取；新增版本显式定义
    staging/<txn>/source/        唯一可写编辑草稿
    snapshots/<id>/source/       film.html/scenes/subtitles/settings
    derived/<job>/              proxy/render结果，内容哈希与lineage
```

每个snapshot有dependency manifest。资源路径解析以项目允许根目录为边界，拒绝绝对路径、目录穿越、symlink逃逸；同一资源路径重新绑定后必须再次内容校验。UI使用assetId/media token，不暴露任意磁盘访问接口。

## 4. 验证标准与损失报告

- 对已支持的硬切本地媒体fixture，总时长、片段边界、源入出点、旁白资产、字幕文字和时间必须一致；帧边界按整数输出帧验证。
- 浏览器字体/CSS和编码可能不同，不要求整段MP4文件哈希相同。比较解码帧、声音样本、时间码、视觉覆盖/裁切及原有对象可编辑性。
- fit=cover/contain、crop和速度分别做实际夹具；不能将某个引擎的参数名直接当作相同语义。
- 编辑外区域对新引擎同环境前后导出的解码画面/音轨比较，记录容差，不拿旧新引擎视觉差异掩盖局部修改污染。
- 音频基线为相同资产/路由和同一输出采样率；先排除编码延迟影响，不能把压缩字节差异当声音内容变化。

## 5. 回退动作（不是git reset）

在切换前保留可启动的legacy配置和旧项目。触发条件：M1B失败、受控写入口无法覆盖、恢复不确定、数据损失或核心精剪能力缺失。操作：停止新项目写入 → 等待/隔离在途任务 → 保存新branch/snapshots和失败日志 → 切回旧应用配置并打开原Hypit项目 → 运行旧回归与一次旧短fixture导出。

新OpenFilm项目在切换后新增的编辑不会自动出现在Hypit里。回退必须保留这些工作，并提示用户“旧工程不包含迁移后修改”；可额外导出新视频用于参考，但这不算无损恢复。已经花费的模型费用也不会撤销。

Manifest@2与新元数据变化不得反向污染旧项目；没有删除/GC的许可，保留全部被引用产物。legacy分支仅在完整V1和单独退役决定后考虑删除。


---

# 合同、状态机、事务、时间与错误语义

## 1. 本包合同的性质

`contracts/migration-contracts.schema.json` 是 **拟议的 Narralens migration/1 合同**，不宣称仓库现在已有这些路由/字段。本地Codex首先把现有D4.1、typed media.replace、import/manifest合同做映射，保留错误码与兼容客户端；新增命名空间使用 `/api/migration/v1/...`。已存在语义不新建同义接口。OpenFilm内部路由必须从固定SHA登记后调用。

## 2. 必须区分的版本

| 名称 | 意义 | 改变条件 |
|---|---|---|
| repo_commit | 开发代码版本，如用户报告304c891 | 代码提交 |
| project_revision | 影片已提交编辑版本，单调递增 | 一笔真实成功编辑/恢复一次+1 |
| source_digest | source依赖闭包SHA256 | film/scenes/字幕/设置或引用资产改变 |
| asset_manifest_revision | 资产库存版本 | 导入/登记；不会因此自动+project_revision |
| control_revision | 锁/许可/预算等控制策略版本 | 策略变更；旧impact需复核 |
| proposal/job_revision | 提案/任务状态 | 不等于已采用影片变更 |

OpenFilm自身短rev仅是native适配器的内部信息；不得覆盖Narralens的project_revision。所有幂等键按project、operation、请求摘要定位；同key同payload返回原结果，不重复commit；同key不同payload→409 IDEMPOTENCY_CONFLICT。

## 3. EnginePort目标接口

```ts
interface EnginePort {
  inspect(snapshot: SnapshotRef): Promise<EngineProjection>;
  capabilities(): Promise<CapabilityMap>;
  plan(snapshot: SnapshotRef, intent: TypedEdit): Promise<EngineEditPlan>;
  stage(plan: EngineEditPlan, isolatedRoot: string): Promise<StagedSource>;
  validate(staged: StagedSource): Promise<ValidationReport>;
  preview(snapshot: SnapshotRef): Promise<PreviewDescriptor>;
  render(snapshot: SnapshotRef, profile: RenderProfile): Promise<JobRef>;
}
```

不是给任意shell command的接口。commit由Host拥有，port不自增revision、不改锁；Hypit和OpenFilm各自实现。真实模块落点由M0填code-map，类型以已存在合同扩展。

## 4. Proposed API和能力开关

| 新语义（建议路由） | 输入/输出 | 禁止副作用 |
|---|---|---|
| GET /api/migration/v1/projects/:id/engine | binding/capabilities/snapshot | 不自动迁移 |
| POST .../:id/migrate-copy | 旧snapshot＋target engine → job | 不覆盖旧项目 |
| POST .../:id/proposals/:pid/materialize | base＋bindings＋idempotency → job | 不写author source/revision |
| POST .../:id/impact | typed intent/ready materialization → server impact | 不采用，不生成付费资产 |
| POST .../:id/edits | base＋impact id/hash＋intent＋idempotency → revision | 不越过锁/范围；复用现有edit语义 |
| POST .../:id/history/restore | target snapshot＋current base＋impact → new revision | 不倒退revision、不绕锁 |
| GET .../jobs/:id / events | 状态、递增event seq；cursor恢复 | UI重复事件不能引起重复commit |

在M1A阶段 materialize/adopt 仍按旧冻结规范不可达（404），虚构operation为422。迁移新路由也默认关闭；M3才能开放materialize，M4才开放adopt。直接绕UI发HTTP必须得到相同结果。

## 5. 时间模型

所有选择/segment使用 `[start_frame,end_frame)`；fps为有理数num/den，源视频保留真实timebase/PTS，不默认源也30fps。`t=frame*den/num`，写入OpenFilm秒单位后重新解析，round-trip误差不能超过半个目标帧，最终边界必须回到相同整数帧。首个门只启用30/1目标规格；其他帧率在capabilities标未验，不静默重采样。

例如镜头 `[1800,2100)`，选区 `[1932,2100)`；三镜方案为56+56+56帧，前132帧保持；采用后镜头数变化但全片帧数不变。每个segment保留独立source span和assetId，不能只剩一条合成视频。镜头不足时禁止隐式循环、冻结帧或变速填满；有意改变需在提案中声明。

## 6. source_digest 与影响快照

source manifest按规范化相对路径排序，记录role/path/sha256/size；覆盖film.html、被引用scene/html/js/css、字幕、设置、字体与实际媒体内容哈希。未引用候选/缓存不进入author digest。锁、rights、asset绑定版本单独纳入impact摘要。外部依赖必须vendor到固定资源或形成可校验的固定引用；未固定网络资源不允许声称可复现输出。

impact由服务器从当前snapshot计算：目标范围、消费者、前后引用、允许操作、preserve项、expected_total_frames、base_revision/source_digest、control_revision、相关资产/许可摘要、费用授权引用、adapter版本、expiry。请求仅传回impact id/hash，不能相信客户端自己声称“影响为零”。全局asset库存追加无关素材不必使全部提案失效；被引用asset内容/许可改变必须拒绝或重审。

### 摘要算法与恢复边界的冻结规则

新增schema的摘要采用本项目明确的canonical规则，而不假称是上游协议：对象键按ASCII键名排序，数组保持语义顺序；files数组预先按UTF-8相对路径字节序排序；路径统一`/`但不改大小写、不擅自改Unicode文件名；UTF-8 JSON不含空白，所有合同数值为整数，FPS用有理数，不允许NaN/Infinity/浮点时间。source manifest摘要输入排除source_digest、snapshot_id和访问时间，只包含engine、engine_sha及每个已排序的path/role/sha256/bytes；加域前缀`narralens-source-v1\n`后SHA256。影响摘要另加`narralens-impact-v1\n`，排除impact_hash自身，包含server保存的完整规范化影响内容。M2提供TS/Python一致的黄金向量；既有摘要算法不破坏，必要时新增digest_version。

恢复只恢复创作内容，不恢复过去的锁/许可/预算控制状态。当前控制策略持续生效；恢复也要重新计算受影响消费者和impact。运行中的导出固定旧snapshot并可继续，新编辑提交只影响下一次导出；不应把旧导出挂成新revision的结果。

## 7. 采用事务

`received → preconditions_checked → staged → validated → prepared → committed`；失败分支为 `aborted/recovering/attention`。

1. 进入统一ProjectActor，查幂等结果；核对项目引擎、revision、完整digest、impact、控制状态和受影响锁。
2. 为本次snapshot生成隔离stage；native apply只改stage。实现帧范围、共享对象、素材和字幕等不变量检查。
3. 运行真实parse/look/必要preview样本；执行时间上限和取消检查。commit前重新确认active base与授权未过期。
4. 保存prepared不可变snapshot与journal；写单一持久commit-record，包含new revision、snapshot和可重放outbox。reader只通过已提交record选择源。
5. 发布事件和刷新投影；无论请求重试/晚回调，revision恰好+1。发布事件失败不反向重复commit，重启从outbox续送。

多文件修改不假称一次rename能原子完成全部源和metadata。通过不可变snapshot＋一份active commit-record提供一致读取；metadata store若是数据库必须同事务提交revision/outbox。文件实现则原子替换单个commit-record且先fsync所需snapshot，平台支持在M2实测；不能确认durability则attention并阻止进一步写入。

崩溃在prepared前：主工程不动，stage保留供审计或安全清理。prepared后、commit前：校验base仍一致后可恢复或放弃；不得无授权自动继续收费。commit后事件前：重放outbox，已提交状态不重复采用。commit不确定：attention，不猜成功也不自动覆盖。

## 8. Materialize 与任务状态

提案：`proposed → comparing → bindings_ready → materializing → ready_for_adoption → adopted`；可转 `stale/failed/cancelled`。materialize产物含native segment plan和proxy、lineage、source/selection/base hashes。完整组合中的每个片段均需范围匹配；artifact内容哈希固定。

Job：`queued/running/cancel_requested/succeeded/failed/cancelled/attention`，CAS lease owner与attempt；事件seq持久单调。取消不等于立即停止。取消成功后晚到结果可作为quarantined artifact登记，但不能改变source或显示ready-for-adoption。外部服务未知完成态不得自动重发收费请求；记录provider receipt并待核对。

最低持久Job/Event/lease/cancel先在M2完成，M3才能使用。模型调用、proxy准备、正式生成、最终渲染分别记job kind；浏览已有proxy不是一次新模型调用。

## 9. HTTP与错误优先级

先认证/Origin，再结构校验与能力，再幂等结果，再revision/digest，再控制锁/许可，再impact有效性，最后执行；同一个请求同时有多个错误时按此顺序稳定返回。

| HTTP | 新设计错误语义 | 条件 |
|---|---|---|
| 401/403 | AUTH_REQUIRED / ORIGIN_DENIED / DATA_POLICY_DENIED | 原有安全合同优先，不泄露工程信息 |
| 404 | CAPABILITY_NOT_ENABLED/未开放路由 | 不泄露待上线写路径 |
| 409 | REVISION_CONFLICT / SOURCE_CHANGED / IDEMPOTENCY_CONFLICT | source/base/请求重用冲突 |
| 423 | TARGET_LOCKED / PROJECT_ATTENTION | 对象锁或恢复未决 |
| 428 | IMPACT_REQUIRED / IMPACT_STALE / APPROVAL_REQUIRED | 缺少/过期影响确认或授权 |
| 422 | UNSUPPORTED_EDIT / MISSING_ASSET / INVALID_RANGE | 类型/范围/能力无效 |
| 503 | RUNNER_UNAVAILABLE / ENGINE_UNAVAILABLE | 工具缺失；不降级成假成功 |

错误码名称为目标建议；M0不得打破现有兼容路由。差异以API compatibility表决定alias、新版本或保留旧码，不为“统一”随意改旧HTTP行为。


---

# 同一个 Studio 内的叙事地图、候选与精剪

## 1. 不是再交付独立HTML剪辑器

生产前端基于固定OpenFilm Studio React应用。保留原生Preview、Timeline、Inspector、MediaPool和ExportCenter；Narralens新增StoryAtlasSurface、CandidateFocus、ContextDrawer、DecisionBar，使用同一个项目snapshot、SelectionStore、PlaybackClock和CommandGateway。组件名是目标模块，不声称当前仓库已存在。

本包HTML仅展示此设计及门禁，不执行实际编辑或伪造后台进度。生产目标是不离开该应用完成主线创作，不是强迫所有功能同时挤在首屏。

## 2. 布局分工

| 区域 | 默认展示 | 展开时 | 真实状态来源 |
|---|---|---|---|
| 顶部 | 项目名、当前章、source revision、只读/草稿/已保存 | 引擎/任务/历史 | Host commit record |
| 中央 | 主片预览或当前三路候选，二者切换 | 源片对比/逐帧 | 原生Player或真实proxy媒体事件 |
| 下方主画布 | 连续可缩放时间轴/叙事地图 | 全片→章节→镜头→时间细节 | EngineProjection，不是自建timeline |
| 右侧上下文 | 当前镜头目的、当前候选类别、主动作 | 灵感原话/来源/台词/后期 | 引用metadata+有效片段 |
| 底部轻量决策条 | 预演/采用/跳过/下一问题节点 | 影响确认/费用授权 | proposal/job/adoption状态 |

导演/精剪是同一应用的两个视图：前者决定“怎么表达”，后者复用原生裁切、位置、字幕和音轨操作。切换不重建项目、不清除选区、不重置播放位置。禁止第二个iframe装另一个编辑器。

## 3. 可缩放叙事地图

X始终是整数帧映射的时间；Y是轨道/章节分组；Z仅为当前区间的候选深度，不增加片长。全片显示章节和未决节点，放大显示分镜，再放大展开候选与关键时间细节。默认平面，可按需开启浅空间效果；精确拖拽保持平面坐标。拖动画布只平移视口，不重排剪辑。

选择任何章节可直接进入，不锁关卡、不积分、不制造“解锁”。系统推荐与人工确认分开；只审异常和逐镜精修均可。事实与结论不是可随意切换的游戏剧情，分支用于视听表达。

## 4. 候选：画面/解说/音乐/音效/台词/过场独立

每个CandidateGroup归属shot、kind、scope和base。方案可以拥有多segment，每个segment有原生asset引用。UI区分：`只有提案`、`待绑定素材`、`代理准备中`、`可预览`、`待审批`、`已准备采用`、`已采用`、`过期/失败/取消`。库存登记不是已入片，proxy播放不等于正式渲染。

最多3路当前可见静音proxy播放，离屏/后台/抽屉切换暂停；音频试听只有一个焦点。使用有来源的真实预览资源，不用动画缩略图替代视频。自动播放失败给显式播放按钮；减少动效默认不自动播。资源不足提示缺口，不自动编造画面、延长、循环或变速。

初期proxy默认540p/720p可配置，切镜只预取下一组；大预览与3路比较互斥，最多3路候选解码，预取只缓存不解码。真实4K三路解码性能单独测试，不由低清样例推断。

## 5. 低摩擦采用，但不绕过impact

低风险、已登记、使用依据可用、无费用/外传、只换视觉且时长精确的方案，UI自动先取服务器impact，再一击提交；用户不必重复看无变化确认框。服务器仍执行revision、digest、lock和impact完整校验，网络冲突时不静默rebase。采用成功才点亮主线，revision由服务器返回；失败保留候选不跳下一镜。

涉及共享解说、台词、两侧过场、生成费用或外传时，必须展示影响和授权。已选择但缺文件可以保存为“意图”，不可显示已采用。撤回是新的受控恢复操作，不删除付费记录，也不改回旧revision数字。

## 6. 同页真实交互工作流

```text
导入观点/任务 → 章节脚本 → 地图投影 → 定位语句/镜头
  → 现有Claude Runner生成3–6个设计提案
  → 选择需要的素材/登记库存 → 绑定segment → materialize proxy
  → 三路比较 → impact → 采用原生clip计划
  → OpenFilm预览与原生Timeline同时更新
  → 连续看本章 → 对问题节点局部精剪/后期
  → 标题/封面 → 发布检查 → snapshot导出 → 重开/再导出
```

灵感/来源与后期待办依附于章、句、镜或边界，不占影片秒数。正文句子变动时标记相关配音/字幕stale；只更换视觉不得重跑TTS。标题/封面由正文事实摘要驱动，不作为当前镜头旁支硬塞进时间轴。

## 7. 原生可编辑性与限制必须可见

候选结果声明 `native_editable`、`parameterized_regenerate` 或 `flattened_media`。三镜组接采用后，在OpenFilm原生timeline应看到三个可独立裁切的片段；如果只插入合成MP4，必须标“烘焙片段”，不能用它通过native编辑验收。外部动效可后续重生成，但不假装可逐元素编辑。

未适配的原生按钮需要可理解原因，例如“当前工程的duration已锁定，解锁后可更改时长”，或“跨镜速度操作尚未通过能力验收”。不要用一个假的点击结果维持界面高级感。

## 8. 动效/性能/可用性目标

滚轮和拖动即时跟手，不给播放头添加拖尾。尺度跳转建议180–320ms缓出，仅用于过渡；用户输入打断动画。层级用空间和留白表达，颜色只强调当前选择，状态有文字。键盘全片/章节/分镜定位、逐帧、Escape退出、可见焦点、100%/原生200%缩放均验。

性能门定义：900秒、120镜、至少6章、3路已准备720p代理；本机冷启动/热缓存分开记录。对选中/平移/缩放/切章至少每类100次样本，测事件到可见状态更新p95≤100ms，保留原始数组和硬件/浏览器/编码规格。它不表示生成、首帧网络加载、导出也≤100ms。预览首帧、内存峰值和导出速度另外记录，阈值M1B环境测量后冻结。

人工验收：用户可在一分钟内从全片进入指定章镜、比较3段真实素材；能够只换画面而不改声音，在十秒内找到撤回；看懂“已登记/可预览/已采用/可交付”区别。以上是目标，不是本包已达成的用户研究结果。


---

# 新开发路线、旧阶段跳转与阶段Ticket

## 0. 当前第一步不是D4.2.2

旧Hypit代码正在暂停。恢复工作后先做M0复核，再做M1A导入收口和M1B隔离探测。迁移不是因为沉没成本继续把旧D6做完，也不是删掉刚完成的可靠性工程。

| 旧阶段 | 处置 | 新阶段 | 验收继承 |
|---|---|---|---|
| D1–D3 | 保留旧通过；抽取业务不变量 | M1B/M2 | 新引擎重验 |
| D4.0/D4.1 | 复用typed edit、多提案 | M2/M3/M4 | 原意不变，接口适配回归 |
| D4.2.1 | 必须补直接测试与外审 | M1A | 只关闭导入 |
| D4.2.2 | 停旧实现，规格迁移 | M3 | native plan＋proxy，不flatten为唯一编辑结果 |
| D4.2.3 | 停旧实现，规格迁移 | M4A | impact/hash/事务不降级 |
| D5 | 拆分，可靠性前移 | M2、M4B/C | Job/Event先于异步素材化；历史/复用后闭环 |
| D6 | 复用原生Studio，不自研NLE | M5 | 所有导航/逐帧/性能仍要验 |
| D7 | 保留全部交付目标 | M6 | P0关闭，不代表P1 |
| P1 | 新增独立阶段 | M7A–D | 完整V1强口径 |

## 1. 分支与阶段纪律

先只读 `git status`、完整SHA、upstream；若有未提交用户工作，不覆盖或stash。建议 `hardening/d4.2.1-close` 和隔离 `spike/openfilm` worktree；两边成功后通过审阅合并/挑选进入 `migration/openfilm`。分支名可依仓库规范调整，禁止在main直接大改、force push、重新建仓或重装整套依赖覆盖lock。

每个Ticket含代码+测试+复现+证据；每个阶段冻结commit后再外审。Claude独立外审使用干净上下文和冻结sha，不复用实现者自评。拒绝审查或工具不可用时 `REVIEW_PENDING`；修复后重新冻结、受影响case重跑并重审。

为减少返工，M1B建议时间盒最多2个有效工程日（环境下载/用户输入等待另记）；这不是保证两天完成。达不到硬门时输出GO/NO_GO及原因，不能不断增加替代框架。M0基于本机情况重估后续工时，阶段编号不按天解释。

## M0｜冻结事实与规格重基线

前置：本轮授权。当前：待本地执行。

范围：读取当前代码和证据；合并CR与ADR，建立分支和真实code-map。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M0.1 | 只读盘点 | 完整SHA/工作树/11_V1_Traceability/冻结矩阵/实际routes/scripts/journal；对照用户报告写差异。 |
| M0.2 | 可回退基线 | 记录legacy app和业务工程完整备份；新migration worktree，遇到脏树停止修改，不reset。 |
| M0.3 | 规格合并 | 同步PRD/架构实体/API状态/traceability，保留旧Gate；填阈值和合同兼容表。 |

**出口：** BASELINE_RECONCILED：源码定位、直接证据缺口、路径/阈值已确认；本包审计工具通过不等于业务通过。

**停止：** 代码版本或冻结规范与报告不一致且未解释；无法定位资产和journal；备份缺失。

## M1A｜D4.2.1旧门禁真正收口

前置：M0。当前：待补测试/外审。

范围：补直接测试、必要小修复；只关闭导入门，不实现materialize/adopt。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M1A.1 | multipart/媒体负向矩阵 | 逐冻结编号补输入组合、媒体流与工具失败；命令边界可注入，关键媒体用真实文件。 |
| M1A.2 | 库存与真实并发 | 256项/最多2并行/单项超时/重复GET；真实import commit与D4.0 edit争用同一ProjectActor。 |
| M1A.3 | HTTP与审计收口 | 未开路由404、虚构op422；TS/legacy全量/生产构建；逐case证据；Claude独立外审与必要返修。 |

**出口：** D4.2.1 CLOSED_ON_HYPIT：每个冻结条目直接证据＋内审＋独立外审，无未解释P0/P1阻断。

**停止：** 只有126/126汇总、外审不可用、native测试替换旧断言、伪实现未开路由。

## M1B｜OpenFilm隔离可行性与写入口探测

前置：M0。当前：待固定上游/探测。

范围：固定SHA和依赖；只用新临时项目；不接管生产。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M1B.1 | 固定代码与启动 | 本机clone/fork、upstream锁、许可证、Node/pnpm/browser/ffmpeg；记录真实启动/渲染命令。 |
| M1B.2 | 30秒可编辑链 | 中文独立旁白/字幕/三镜；cover/replace/边界；导出重开后再改一镜导出。 |
| M1B.3 | Studio接缝证明 | 列所有写入口；试验native请求转typed意图/只写stage；验证旧base不会靠rebased进入主工程。 |

**出口：** OPENFILM_SPIKE_PASS：真实短片和编辑往返＋native mutation intercept proof＋运行边界清单。

**停止：** 只能render扁平MP4；无法接管native写路径；版本/许可/依赖不明确。探测超过约定timebox则输出ADR，不无止境换框架。

## M2｜受控双适配器与最小可靠运行时

前置：M1A、M1B。当前：未开始。

范围：新项目唯一OpenFilm；保留legacy；D5最小可靠性前移。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M2.1 | EnginePort与原生网关 | Hypit/OpenFilm共同合同；map原生UI/CLI/history/import/provider写入口，未知禁用。 |
| M2.2 | 一致提交与持久任务 | snapshot/commit-record/journal/outbox；复用Actor；Job lease/cancel/SSE；三类锁最小校验。 |
| M2.3 | 副本迁移与回退 | 迁移已知fixture，保留manifest@2；loss report；旧新各自导出；重启故障/rollback drill。 |

**出口：** CONTROLLED_OPENFILM_READY：旧回归保留，新引擎base/conflict/lock/恢复/原生绕过全过；可激活已迁移副本。

**停止：** native undo或provider可绕规则；项目双写；Job仅内存；无可验证回退。

## M3｜只读素材化与原生剪辑计划

前置：M2。当前：未开始。

范围：继承D4.2.2目标；seg绑定→proxy＋native edit plan＋lineage。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M3.1 | 绑定与来源 | 区间整数帧、真实资产足长、依赖/rights摘要；绑定变更使旧job过期。 |
| M3.2 | 实际素材化 | 有限并行ffmpeg代理；生成native可编辑segments；持久job/cancel/late/restart。 |
| M3.3 | 只读验收 | materialize前后source/revision不变；界面显示ready_for_adoption；三镜不是单一烘焙片段。 |

**出口：** MATERIALIZATION_READY：至少3个候选真实预览；全部artifact lineage可查；author source保持不变。

**停止：** 素材化偷偷写source；取消后可自动采用；缺素材用模拟成功补齐。

## M4｜采用、原生编辑与恢复闭环

前置：M3。当前：未开始。

范围：D4.2.3和D5完成；所有修改走同一Coordinator。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M4A | impact与事务采用 | server snapshot/hash＋428、严格409、锁、idempotency；采用native多clip计划只+1。 |
| M4B | 历史与声音不变量 | native undo/redo/restore映射；恢复为新revision；共享语音/字幕/时长锁与复用。 |
| M4C | 故障与实片回归 | 注入每个journal边界；重启/并发/外部文件变更；真正双导出和源依赖抽样。 |

**出口：** ADOPTION_AND_RECOVERY_READY：compare→materialize→adopt→reopen→rerender一条真实链；无旁白/相邻区污染。

**停止：** 只单元测试；恢复直接回退数字；渲染读取可变source；自动rebase旧采用。

## M5｜同页叙事地图与原生精剪

前置：M4。当前：未开始。

范围：D6业务导航，停止自研底层NLE；6类候选按capability逐步落地。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M5A | 项目/章节/时间 | CreativeTask创建、整片脚本/章节/镜頭映射；统一clock/selection，原生timeline联动。 |
| M5B | 地图和决策 | 全片→章→镜→细节缩放；三路真实proxy；低风险一击采用、问题节点/检查点。 |
| M5C | 性能和人工体验 | 120镜/900秒harness，p95；headed100%/原生200%/键盘；零号用户实际演练。 |

**出口：** UNIFIED_STUDIO_USABLE：不是独立HTML；UI选择在native timeline/预览/导出一致；可访问与性能证据。

**停止：** 第二份timeline状态；autoplay只是动画；Headless冒充人工；只可编辑3个fixture。

## M6｜真实章节、后期、封面与P0交付

前置：M5。当前：未开始。

范围：D7与P0全部收口；内容与工程分开验收。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M6.1 | 实片与后期 | 10–15分母项目章节/脚本/粗镜完整；其中3–5分20+镜真实音画字幕；基础调色/声音/转场范围。 |
| M6.2 | 封面/标题/发布检查 | 8标题/4封面方向及实际候选、事实一致性；缺媒体/许可/音量/黑帧/字幕检查和issue anchor。 |
| M6.3 | P0外审与交付 | 3个真实位置从比较到导出；重开双导出；HTML证据报告；所有P0/NFR关闭且用户签署。 |

**出口：** Gate V1-P0 ACCEPTED；只代表P0可交付，不能宣称P1或完整V1。

**停止：** 真实资料或生成授权缺失；P0落空；仅导出一个视频却无编辑/恢复证据。

## M7A｜账号风格与完整母项目

前置：M6。当前：未开始。

范围：StyleProfile版本/继承/例外与完整10–15分内容；冻结编辑测试集。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M7A.1 | 风格版本 | 语气/字幕/画面/声音基线与局部override，锁定不被全片应用覆盖。 |

**出口：** StyleProfile真实应用/回滚、长片项目可重开。

**停止：** 模板只是文本，未写入工程；批量改锁定内容。

## M7B｜声音与字幕正式适配

前置：M7A。当前：未开始。

范围：TTS/ASR/对齐的真实provider与本人声音路径。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M7B.1 | 音声版本 | text/audio/alignment关联，消费者追踪、试听/审核、费用/外传审批、只改画面不重算声音。 |

**出口：** 真实中文转录/配音/对齐及变更回归，声音许可登记。

**停止：** 只用mock/provider stub宣称集成；词变音不变却显示已对齐。

## M7C｜素材服务、预算与反馈

前置：M7B。当前：未开始。

范围：按来源白名单接入最少一个检索与生成能力；反馈锚点和完整队列。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M7C.1 | 能力插件 | 最小插件manifest、费用保留额、外传清单、取消/未知完成态；评论proposal不自动改模板。 |

**出口：** 有授权真实请求/receipt；预算与失败/重试；反馈到下一版提案。

**停止：** 全量引入多个框架；raw provider能直接写source；未知费用按0。

## M7D｜P0＋P1完整V1验收

前置：M7C。当前：未开始。

范围：完整10–15分实片，全流程真实回归、质量/成本/人工记录与独立审查。

| Ticket | 任务 | 交付要求 |
|---|---|---|
| M7D.1 | 完整V1 | 所有P0+P1条目都绑定证据；长片性能、历史/回退、标题封面、来源交付、人工发布。 |

**出口：** V1-Full ACCEPTED；之后才规划批量/P2。

**停止：** P1只列路线未实现；缺任何核心证据或用户质量签署。

## 末尾：每次停机/交接输出

必须打印 `current_stage`、`repo_sha`、`upstream_sha`、`gate_status`、`implemented_vs_tested`、`unverified_cases`、`evidence_manifest`、`next_allowed_ticket`、`blocked_actions`。禁止“测试都过所以V1完成”。本机编辑器工程和代码git仓库分别记录备份与revision，不混用。

## 合并验收与分级切换

M1A和M1B分别通过不代表随意合并后的commit也通过。生成M2候选分支时记录两个来源SHA、最终合并SHA、差异及受影响回归；在合并commit重跑原门禁和native写入冒烟，审阅者确认组合不会破坏旧Gate，再允许M2。

切换分三层：M2通过后仅可激活明确列出的迁移副本；M4可靠性闭环通过后可经明确配置让新建项目默认OpenFilm；完整V1后才另立legacy退役决策。旧项目不会因为默认值变化自动迁移。所有切换都记录目标项目、旧配置、操作者和回退方法。


---

# 验收、故障矩阵与审计证据计划

## 1. 验收判定

`NOT_RUN → IMPLEMENTED → INTERNAL_EVIDENCED → REVIEW_PENDING → PASSED`，或`FAILED/BLOCKED_INPUT/BLOCKED_ENV`。新包所有业务case起始NOT_RUN。阶段PASS要求所有该门case、适用回归和本地冻结矩阵都有直接证据；测试文件数/测试总数只作辅助统计。

M1A的IM编号是本包补证据索引，不替换旧冻结测试编号。M0须建立old_case_id→IM-id→test_name→evidence；旧矩阵若有额外项也必须补齐。对每个参数组合分别执行并记录，不把一条happy-path当“所有multipart都覆盖”。限额/具体错误码从冻结规范读取，本包不猜文件大小、metadata大小或超时值。

独立外审对象必须是冻结commit及该commit生成的证据。修复后旧审查不能自动覆盖新commit。外审结论只接受真正运行的独立审阅，禁止实现会话自签。Headless不能关闭“人工可用性/真实200%桌面体验”等门。

## 2. 各层证据

契约测试证明结构和拒绝语义；HTTP集成测试证明实际路由/认证/队列；真实文件证明媒体验证；真实render证明画音输出；headed浏览器证明真实UI交互；人类试用证明用户目标。各自有作用，不能互相代替。

每条记录至少：case id、本地冻结ID、代码SHA、适配器/上游SHA、环境、fixture manifest hash、真实命令、exit code、日志、输出路径与SHA256、预计不变量与实测结果、reviewer/时间/状态。frame截图不是视频输出的替代；光有MP4也不是可编辑性的替代。

## 3. 决定性验收场景

**IMPORT/EDIT真实竞争：** 用barrier暂停实际import commit与D4.0 edit，两个HTTP请求争用同一项目；验证两种先后顺序、可串行化结果和manifest/source不混写。不能只测通用queue类。

**原生绕过攻击：** 直接调用旧native edit/history/provider/CLI路径、在UI锁定后操作native Inspector/trim/undo；必须经Coordinator或明确拒绝。截图里按钮禁用不能代替HTTP安全测试。

**三镜采用：** fixture中 `[1932,2100)` 拆56+56+56，前132帧/旁白/相邻镜不变；native timeline有3片段可再改，不用flattened片段充数。

**崩溃：** 在prepare、stage、validate、prepared、commit-record、outbox边界终止进程；重启前不接受写入；验证exactly-once revision或attention。晚到job不得采用。

**发布：** QC机器扫描与内容/事实人工审阅分开。黑帧等检测阈值按固定输出profile和已知错误fixture校准，不能宣称扫描器自动证明事实准确/版权有效。

## 4. 计划用例矩阵（以下全部未执行）

| Case | Gate | 场景 | 直接判定 | 证据 |
|---|---|---|---|---|
| IM-01 | M1A | metadata→file | 真实multipart依冻结字段成功；登记后source/revision不变 | http+media |
| IM-02 | M1A | file→metadata | 逆序与正序相同；流式过程不预信任缺失元数据 | http+media |
| IM-03 | M1A | 重复metadata相同/不同 | 两种值各测；按冻结合同拒绝且无半资产 | http |
| IM-04 | M1A | 重复file part | 同名和不同名各测；不得只取最后一个 | http |
| IM-05 | M1A | 多文件 | 请求含多个文件拒绝；每个暂存均清理 | http |
| IM-06 | M1A | 缺metadata/缺file | 两个缺项分别拒绝，状态不变 | http |
| IM-07 | M1A | metadata大小边界 | limit-1/limit/limit+1实际HTTP；limit读取冻结规格 | http |
| IM-08 | M1A | 非multipart/缺boundary/坏boundary | 类型和解析错误分别断言 | http |
| IM-09 | M1A | 未知part/坏JSON/重复关键字段 | 按旧冻结规范明确拒绝或允许，不能默认吞掉 | http |
| IM-10 | M1A | 文件大小/中断流 | 阈值边界与客户端中断；受限内存，无泄漏/半commit | http+recovery |
| IM-11 | M1A | 无视频流 | 真实音频-only文件不得按MP4视频登记 | real_media |
| IM-12 | M1A | 多个视频流 | 真实或可复现mux文件按冻结策略拒绝 | real_media |
| IM-13 | M1A | 零帧/损坏容器 | 可控探测fixture＋真实坏文件；不能以扩展名放行 | media+unit |
| IM-14 | M1A | ffmpeg缺失 | 依赖注入/隔离PATH；稳定错误码/用户提示 | process |
| IM-15 | M1A | ffprobe缺失 | 独立错误分支，不能伪造探测结果 | process |
| IM-16 | M1A | 媒体工具超时 | 进程及子进程终止/有界清理；退出原因可查 | process |
| IM-17 | M1A | stderr上限/工具非零退出 | 超长输出截断及exit code保留；无内存无限增长 | process |
| IM-18 | M1A | 库存256项 | 真实注册/完整结果顺序和状态；第257按冻结规范 | http |
| IM-19 | M1A | 库存并发上限2 | 实际库存GET流程记录活跃探测，最大不超过2 | integration |
| IM-20 | M1A | 单项探测超时 | 只有该项降级，其余255保持结果；请求可完成 | integration |
| IM-21 | M1A | 重复GET重新验证 | 两次GET间修改/移走文件，第二次反映变化非过期缓存 | integration |
| IM-22 | M1A | import与edit同项目并发 | 使用真实两条服务/HTTP入口和barrier；serializable，只一套ProjectActor | http+recovery |
| IM-23 | M1A | import commit故障恢复 | 在manifest与文件安装边界注入crash，恢复不丢旧清单 | recovery |
| IM-24 | M1A | materialize/adopt路由关闭 | 直接HTTP全部旧目标路由404；不得返回模拟job | http |
| IM-25 | M1A | 虚构adopt operation | 走真实edit端点得到冻结422，无工程变化 | http |
| IM-26 | M1A | Origin/token/路径/TOCTOU | 非法Origin/token、恶意filename、替换文件和许可状态边界；旧安全行为不降级 | security |
| OF-01 | M1B | 原生30秒首导出 | 中文独立旁白/字幕/3镜可编辑工程；ffprobe/frame样本 | real_render |
| OF-02 | M1B | 重开与修改再导出 | 关闭服务/浏览器再开；fit/media原生改一镜，source和画面同步 | real_render+headed |
| OF-03 | M1B | 原生写入口探测 | 记录所有UI/API/CLI/history/provider入口；原生指令可截获/禁用 | source+http |
| OF-04 | M1B | 旧base行为实证 | 在临时副本复現rebased；叙镜网关拒绝过期采用 | http |
| OF-05 | M1B | native scene可编辑 | 修改真实DOM文字/位置并再导出；不是一条烘焙MP4 | real_render |
| OF-06 | M1B | 版本和运行环境 | 完整上游sha/lock/license/ffmpeg/browser/字体；可复现命令 | inventory |
| EN-01 | M2 | 双适配单引擎 | 同一project不能双写；legacy功能合同保留 | integration |
| EN-02 | M2 | 原生绕过覆盖 | timeline/inspector/subtitle/history/asset/provider/CLI逐入口translated或blocked | http+headed |
| EN-03 | M2 | 受限转换 | 三镜fixture loss report零未说明；旧工程hash不变 | migration |
| EN-04 | M2 | 意外外部源修改 | scenes/字幕/资产也改变digest；进入attention不是自动同步 | security |
| EN-05 | M2 | 回退演练 | 旧应用+旧项目真正重开导出，新分支结果保留 | real_render |
| EN-06 | M2 | 资源隔离 | scene网络/任意文件/秘密不可读；数据与UI/Host执行域隔离 | security |
| TM-01 | M2 | 帧往返 | 时间UI→engine seconds→整数帧，在起始/末尾/跨章点一致 | integration |
| TM-02 | M2 | 区间能力 | 选择半开合法，零长/越界拒绝；unsupported跨镜编辑422不假改 | http |
| TM-03 | M2 | 素材长度/变速 | 短asset不隐式循环/变速；显式速度才影响source span | integration |
| JB-01 | M2 | Job持久与重启 | 重启保留真实状态，running无lease不假succeeded | recovery |
| JB-02 | M2 | 双worker lease | 只有一个CAS owner；重复callback不重发commit | concurrency |
| JB-03 | M2 | SSE断线 | cursor去重/补发，render/proposal事件不执行编辑副作用 | integration |
| JB-04 | M2 | 取消后晚到 | cancelled仍终态或quarantine；无source/revision变化 | recovery |
| JB-05 | M2 | 费用不确定 | 外部超时记录unknown，不自动重发付费调用 | integration |
| JB-06 | M2 | outbox提交后崩溃 | commit一次；event续发不重采用 | recovery |
| PR-01 | M3 | 沿用D4.1 | 真实Claude Runner返回3–6个结构提案，所有base/费用/模型审计完整 | real_provider |
| PR-02 | M3 | 预览只读 | 开关比较、选候选、试听无source/revision变动，无新增收费 | integration |
| PR-03 | M3 | VibeMovie适配约束 | 引用未知asset/完整新timeline/锁定范围变更均拒绝 | contract |
| MT-01 | M3 | 绑定资产 | 真实asset内容/source入出点/fps/rights，源长度不足拒绝 | real_media |
| MT-02 | M3 | 三候选代理 | 至少3个真实proxy可解码；最终native segments独立存在 | real_media |
| MT-03 | M3 | derived lineage | hash、父资源、变换、工具版本、范围、审批链可追溯 | contract |
| MT-04 | M3 | 只读素材化 | source digest/revision前后完全相同；标ready_for_adoption | integration |
| MT-05 | M3 | 取消重启陈旧 | 改变binding/base/control时结果过期；重启不写主工程 | recovery |
| MT-06 | M3 | 帧边界 | split前后、first/last frame抽样；clip时长和目标范围一致 | real_render |
| TX-01 | M4 | 缺impact | 真实adopt HTTP无impact 428，工程不变 | http |
| TX-02 | M4 | impact篡改/过期 | hash/范围/asset/expiry/control不匹配拒绝 | http |
| TX-03 | M4 | visual/narration锁 | 原生和导演/CLI路径都阻止相关写，未锁项可操作 | http+headed |
| TX-04 | M4 | duration与共享消费者 | 共享block任一受影响锁保护；长度不意外变更 | integration |
| TX-05 | M4 | 过期source/base | 409，不接受native rebased作为采用成功 | http |
| TX-06 | M4 | 并发采用 | 同base两个请求只有一个commit；另一个409；相邻不变 | concurrency |
| TX-07 | M4 | 幂等 | 同key同payload只+1并返同结果，同key异payload409 | http |
| TX-08 | M4 | 逐journal故障 | prepare/stage/validate/prepared/committed/outbox边界逐一注入恢复 | recovery |
| TX-09 | M4 | 用户历史/撤回 | 恢复内容为新revision；锁仍生效；不删费用记录 | headed+integration |
| TX-10 | M4 | native undo/redo | 原生按钮走Coordinator，不能直接改文件/git回退 | headed+http |
| TX-11 | M4 | 真实两次导出 | 至少一条新工程改变后重开再导出；旁白/字幕保持 | real_render |
| TX-12 | M4 | 多文件原子可见 | 读取固定snapshot；没有混合revision依赖；attention阻写 | concurrency |
| TX-13 | M4 | 锁与外部变更竞争 | lock控制更新和adopt共队列，commit前再核对授权/摘要 | concurrency |
| TX-14 | M4 | 三镜仍可独立精修 | 采用三镜方案后native UI可独立裁每段，不仅播放composite | headed+real_render |
| UX-01 | M5 | 任务导入 | 真实CreativeTask/聊天文本校验、错误定位、保留原话 | headed |
| UX-02 | M5 | 新项目重开 | 创建不是套三镜fixture，关闭后任务/章节/素材绑定仍在 | headed |
| UX-03 | M5 | 章节镜头地图 | 真实6章/120镜导航；stable IDs，顺序改变不误配 | headed |
| UX-04 | M5 | 语义到镜头 | 点击句子定位所有对应clip，返回上次选区 | headed |
| UX-05 | M5 | 共享clock/selection | 地图/时间码/native Timeline/Player双向一致，逐帧无跳镜 | headed |
| UX-06 | M5 | 尺度连续 | 全片→章→镜→细节；平移不重排，空间分支不增片长 | headed |
| UX-07 | M5 | 三路自动预览 | 真实video frame计数增长；max3 decoder；暂停/离屏/autoplay失败路径 | browser_media |
| UX-08 | M5 | 六类选择 | 画面/解说/音乐/音效/台词/过场独立；不改其他类别 | integration+headed |
| UX-09 | M5 | 一击采用/跳过 | 低风险仍取impact并服务端校验，成功才推进；失败保留上下文 | headed |
| UX-10 | M5 | 导向原生精剪 | 同页切模式不重新载项目/失选区；native变更地图刷新 | headed |
| UX-11 | M5 | 可访问 | 键盘/焦点/文字状态/原生200%/reduce-motion；无关卡强制阻塞 | headed+axe |
| UX-12 | M5 | 用户实用 | 零号用户一分钟定位/三路比较，十秒找到撤回；独立填写体验记录 | human |
| PF-01 | M5 | 120镜性能 | 900秒/6章/120镜，每类100次；event→paint p95≤100ms，原始样本 | performance |
| PF-02 | M5 | 真实proxy负载 | 3路720p/规格固定，首帧/内存/丢帧记录；不推断4K表现 | performance |
| PF-03 | M5 | 冷/热重开 | 分别测量、捕捉长期内存增长和任务抢占；无隐藏崩溃 | performance |
| DL-01 | M6 | 真实章节 | 3–5min/20+镜与10–15min母项目关联，3真实位置比较→准备→采用→导出 | real_render+human |
| DL-02 | M6 | 标题候选 | 实际8标题，基于正文事实；人工选择，不以占位符通过 | real_provider+human |
| DL-03 | M6 | 封面候选 | 4方向并有可观看实际候选，来源/合成标识/许可和正文一致 | real_provider+human |
| DL-04 | M6 | 发布检查 | 缺素材/字幕越界/音量/黑帧/未知许可/未决事实各独立fixture | integration+human |
| DL-05 | M6 | 后期与交付 | 声音/字幕/基本画面/过场效果在输出体现；问题可回镜头；同revision发布包 | real_render |
| DL-06 | M6 | P0终审 | 13P0/6NFR evidence无遗漏；中文HTML验收报告；独立审计和用户签署 | independent+human |
| P1-01 | M7D | StyleProfile | 全片风格版本/override/锁保护与恢复 | integration+human |
| P1-02 | M7D | TTS/ASR对齐 | 真实服务生成/识别中文，文本变化使消费者stale并可局部更新 | real_provider |
| P1-03 | M7D | 远端来源/预算 | 至少一种许可检索和一种生成真实回执，外传/费用限额/unknown处理 | real_provider |
| P1-04 | M7D | 反馈锚点 | 评论绑定revision/shot/range，重剪迁移或orphan显式；不自动改生产模板 | integration |
| P1-05 | M7D | 完整长片 | 10–15min真实影片含全部P1；双导出/重开/恢复/风格/声音/内容评审 | real_render+human |
| P1-06 | M7D | 完整V1终审 | P0和P1独立清单全关闭，真实运行与成本记录，不含自动发布/P2 | independent+human |

## 5. 输出画面与性能的测量边界

源媒体hash必须保持；导出MP4的二进制hash不要求前后相同。对视觉改动前后，采用同引擎固定环境比较不变区解码帧、source span和音频内容；保存完整样本位置/容差。同步要求在30fps夹具中边界、字幕事件和声音内容不超1个输出帧；严格原声保留还要对引用的原文件及裁切参数比对。平台预览seek真实解码延迟和播放器逻辑帧要分别记录。

PF-01的p95是本地控制交互，不是AI响应或渲染；每种操作单独计数，不能挑最快的混合样本冲淡慢项。真实项目、120镜性能夹具和三个短fixture分别验，不可互相替代。

## 6. Gate报告与范围口径

每阶段产出中文HTML验收报告，嵌入摘要、case列表、失败说明、截图、视频相对链接和commit/环境。`tools/validate_evidence.py`只检查证据清单是否完整和hash一致，不判断图像质量、事实或reviewer真独立；人工审查仍需保留。

M6只能声明`Gate V1-P0 ACCEPTED`；M7D才能在全部P0/P1证据关闭后声明`V1-Full ACCEPTED`。分母包含所有需求，不把未做P1移出统计后宣称完成。

## 边界补充：合同黄金向量和跨版本导出

TX-02同时覆盖摘要黄金向量：不同键序输入归一后相同hash，改变source依赖内容或scope产生不同hash；不存在字段不得被默认补成可信。TX-09覆盖恢复不改当前锁/许可；TX-12覆盖导出开始后新revision提交，旧导出仍只属于旧snapshot。EN-01包含合并候选commit复验，不能仅引用分支各自的通过记录。


---

# 插件路线、依赖治理与执行安全

## 1. 迁移时不拼装三套主工程

OpenFilm是主编辑/默认渲染。VibeMovie代码核查显示其AI请求/规范化围绕完整时间线输出，render调用Remotion；本包只借鉴prompt/context/验证方法，输出仍是现有Narralens结构化提案。[R6][R7] 现有Claude Runner不因迁移强制改为Gemini。若复制代码，保留来源、MIT通知和改动记录，先验收更严格的ID/资产/范围规则。

HyperFrames提供HTML素材/动效能力，但其运行合同不同，不与OpenFilm网页场景直接等同。[R8] 首次插件可输出带lineage的媒体或参数化scene；不可编辑资产明确标识。HeyGen商业API需要单独权限/费用配置，非迁移必需项。

## 2. 三类能力插件

| 类型 | 输入 | 输出 | 不允许 |
|---|---|---|---|
| planner | 创作brief、只读projection、已登记assets | proposal/claim/scene plan | author source全量覆盖、任意URL、执行shell |
| media provider | 授权素材需求、预算、外传清单 | staging文件、receipt、cost、rights/provenance | 直接进timeline或绕库存登记 |
| scene/post worker | 冻结参数/素材snapshot | native可编辑scene或parameterized/flattened资产 | 未声明编辑性损失、未经确认运行任意网络 |

M2只定义边界/默认deny，M7C再实现最少所需插件；没有必要先做插件商店、热加载任意包或通用AgentOS。旧HarnessOS能力不作为依赖引入，避免范围漂移。

## 3. 费用与外传

OpenFilm现有provider contract覆盖多个生成/检索动词，但当前Spend是视频生成确认且不含金额预算。[R5] 叙镜必须以现有成本审计继续扩展：预算currency、estimate/max授权、expiry、已保留额、真实receipt、unknown-cost分开。仅浏览本地proxy免费；用户点“多备选”不自动授权多次付费生成。

所有实际外传列assetId/hash、目的provider/model、目的、保留策略和批准范围。引用/脚本和原视频是否发出分开审批。默认本地素材留本机；免费服务也要外传审批。失败重试遵守幂等/receipt；未知完成态先核对，不盲目重复收费。

## 4. 运行与供应链

固定OpenFilm的full SHA、pnpm lock digest、node/ffmpeg/browser/fonts；仓库scripts而非npx latest作为日常入口。上游升级独立ticket，重跑adapter/native写入/恢复合同和媒体回归，不自动追main。

保留MIT来源声明和OpenFilm商标边界，用Narralens名称发布自有修改版。[R9] VibeMovie MIT不等于其所有依赖许可同样；不采用Remotion后端就不必为了迁移额外引入它。[R10] HyperFrames为Apache2.0，若分发修改版/模板资产分别保留相应通知。[R11] Hypit/OpenMontage既有义务不因换引擎自动消失；若保留/分发相关代码按固定版本审核。

依赖安装脚本可执行代码；M1B在隔离worktree/环境进行，记录批准操作，不让上游安装修改当前main或用户凭据。scene执行进程没有Host secret/通用FS/随意网络，远端HTML默认不直接运行。通过受控本地资产路由加载文件，禁止directory traversal/symlink与开放CORS。

## 5. 插件验收

逐能力声明version、upstream SHA、kind、允许网络/文件、输入输出schema、输出编辑性、价格策略、取消/超时策略。unknown capability拒绝；不能从插件元数据直接推断执行完成。旧plugin结果带过期base只能入候选库；不允许回调直接采用。


---

# Codex开工指令、运行边界与外审交接

## 1. 首轮交接目标

本包可直接驱动M0/M1A/M1B，不授权在未复核源码的情况下盲写完整M2–M7。后续阶段已有合同、Ticket、测试目标，但每阶段仍需要在前一门真实证据基础上落本地源码定位并完成独立开工审查。这是阶段化开发，不是“文档交出去就无人值守直奔V1”。

## 2. 首轮提示词

```text
你是本地 Narralens 仓库的迁移实施负责人。请读取我随消息提供的 Narralens-Migration-M1 文档包，并在现有仓库上做增量实现，不新建替代项目、不重写已通过模块。

【已知起点，先复核】
用户报告的基线是 main/origin main=304c891，工作树清洁；D1/D2/D3/D4.0/D4.1 已通过；D4.2.1 是候选完成、内审通过、外审待完成且存在逐编号直接证据缺口。D4.2.2/D4.2.3/D5/D6/D7/P1未完成；自动开发保持暂停。不要把报告当你已执行的验证，不要reset回304c891。遇到当前SHA/源码/测试与报告不一致，先输出差异并保留用户工作。

【阅读顺序】
先读文档包 docs/00_Read_First.md、01_Baseline.md、02_Architecture.md、03_Spec_Delta.md、07_Development_Plan.md、08_Acceptance.md、10_Codex_Handoff.md；再读其余合同/迁移/UX/安全文档。读取本地真正的 docs/11_V1_Traceability.md、当前03_Architecture.md、D4.2.1冻结矩阵、implementation内审文档、路由/合同/Actor/journal/recovery、package scripts与真实evidence。本包HTML给我看，Markdown为同内容镜像；contracts是目标草案，不冒充既有API。

【目标架构】
保留Host、资产导入/Manifest@2、真实Claude CLI多提案、费用审计、typed edit、revision/lock/journal/补偿。OpenFilm Studio成为目标原生UI与默认渲染，引入EnginePort和受控OpenFilmAdapter；Hypit隔离为旧引擎/回退，一个项目只绑定一个引擎，不双写。VibeMovie只借鉴结构化提案方法，不引入第二份完整timeline、Gemini服务或Remotion全片后端。OpenMontage/HyperFrames/HeyGen后续按能力接入，不前置插件市场。

【本轮允许执行】
1. 执行M0：只读核对完整SHA、工作树、实际目录/接口/阈值和逐case证据；建立安全分支/worktree与可验证legacy备份，输出baseline-observed、code-map、route-inventory和CR-MIG-001。更新主traceability和架构所有状态不一致项，保留旧Gate历史，不覆盖本地权威编号。
2. 执行M1A：补D4.2.1真实multipart顺序/重复/大小、媒体流和工具失败、256项/并发2/单项超时/重复GET、真实import与D4.0 edit并发、未开materialize/adopt路由404及虚构op422测试。与完整冻结矩阵逐项映射，不用126/126总数替代。跑实际全量门禁、生产构建和证据，再用独立Claude Code会话审阅冻结commit；不能自签外审，工具不可用即REVIEW_PENDING。
3. 在隔离worktree执行M1B：固定OpenFilm完整SHA/依赖/许可证，不用latest。用独立临时工程完成30秒中文音画/字幕、原生精剪、首导出、关闭重开、改一镜、再导出；证明所有原生写入口可翻译到Coordinator或明确禁用。特别验证native base不一致时的rebased行为不能绕过叙镜严格409。不得写生产Hypit目录，不用扁平MP4证明可编辑迁移。
4. M1A/M1B可隔离并行；两者都通过后只输出M2开工包和GO/NO_GO，本轮停在该边界，等待下一阶段指令。任何门失败则修复本门或报告阻塞，不顺跳旧D4.2.2。不要恢复之前的后台自动开发任务，不force push、不删除旧工程、不未经批准产生付费/外传。

【后续强约束】
M2先完成原生写入治理、三类锁、持久Job/SSE/lease、snapshot/journal和回退，再做M3素材化。native timeline/Inspector/import/history/undo/redo/provider/CLI全部受控；不支持的操作禁用，不能裸转发。source依赖摘要包括film.html、scene、字幕、设置及引用资产，而非只看一个文件。物料化只能准备proxy/segment plan/lineage，不写author source或project revision。M4采用要求服务器impact/hash、base/锁/许可检查、幂等、revision恰好+1；三镜方案必须仍有三个原生可编辑clip。恢复旧内容产生新revision，取消后晚到结果不自动采用。所有导出绑定已提交snapshot。

【交付及报告】
每个ticket含代码、测试、复现、实际命令、日志和带SHA256产物。独立审计绑定冻结commit；修复后重新验收。保留旧测试及legacy执行入口，合理新增新引擎合同测试。Headless、headed自动化、人类体验分别记录。先用包内tools验证文档/合同一致性，这不算业务验收。
结束时输出：当前阶段、真实repo/upstream SHA、改动与未改动项、逐case通过/失败/未执行、证据目录、内审/外审状态、回退验证、下一个允许ticket、禁止提前宣称的范围。M6仅为Gate V1-P0；只有M7A–D及P0/P1全部真实证据通过，才允许V1-Full。现在从M0开始，不只复述计划。
```

## 3. 独立审计提示词（在本地复用现有Claude审计入口）

```text
请独立审计本次冻结commit，不信任实现者的PASS描述。先读取当前门的冻结规格、测试矩阵、真实源码与evidence manifest；再逐case核查实际HTTP/媒体/并发/恢复证据。
重点：既有D4.2.1负向组合和真实import/edit竞争是否直接测到；未开路由是否HTTP断言；OpenFilm原生写入口是否可绕revision/锁/impact；所有engine-specific旧证据是否被错误继承；生产构建/输出/重开证据是否与冻结commit一致。
返回GO/NO_GO、按严重度的问题、每条源码/测试/证据定位、未验事项和允许声明。没有执行或证据不足的项标NOT_VERIFIED，不靠测试总数或截图推定。不得替实现者修改状态为PASS后结束。
```

## 4. M2之后的续跑模板

每次明确一个阶段，例如：“基于已通过的M1A/M1B evidence执行M2，不跨M3。先检查sha/代码/门禁，填本地实现定位和合同差异；完成M2 ticket及独立审查后停止。保持legacy可回退，不让native端点绕控制。”

不要让新的提示词与旧暂停的自动开发任务同时修改同一工作树。若有任务scheduler或Agent进程，先只读查状态，再按用户本轮授权启动前台工作，不自动恢复旧计划。

## 5. 命令规则

读取根目录、status、log、测试脚本与工具版本是首步。运行命令以本地package scripts和固定上游文档为准；本包不伪造本地已有`npm run gate:*`。引用上游的开发命令只用于隔离探测；不把其默认项目目录或全局link直接接管用户现有应用。

每个长命令给出超时、工作目录、退出码、stdout/stderr路径。真实provider失败要报告，无预算/无凭据可停止对应任务，不能改用假响应让验收变绿。生成给我的HTML报告时不嵌入密钥、本地绝对敏感路径或未经授权资料。


---

# 迁移风险、未决项与条件决策

## 1. 风险登记

| ID | 风险 | 触发信号 | 阻断门 | 处置 |
|---|---|---|---|---|
| RSK-01 | 旧导入实际测试不全 | 报告只有126/126、无法对应冻结编号 | M1A | 补直接测试；不借迁移跳外审 |
| RSK-02 | 原生编辑绕过严格锁/revision | native rebased成功、raw history可写 | M2 | patch实际mutator/transport或禁用；必要时NO_GO |
| RSK-03 | OpenFilm长片不稳 | 120镜卡顿、播放器/导出不一致 | M5/M7D | 定位代理/viewport/原生缺陷；不继续堆功能 |
| RSK-04 | 双引擎状态分裂 | 同一project有两份可写主工程 | M2 | 单engine绑定＋副本迁移 |
| RSK-05 | 合成MP4冒充精修 | 三镜方案只有一个烘焙片段 | M3/M4 | 保留native plan和片段；编辑性损失显式 |
| RSK-06 | 持久性晚补返工 | Job/SSE只在内存 | M2 | D5基础前移；恢复先于异步功能 |
| RSK-07 | 上游接口变化/假版本固定 | 使用latest/main而无SHA | M1B | 锁full SHA＋patch和依赖清单；升级独立门 |
| RSK-08 | 费用/素材出境隐式发生 | 比较触发多次生成、provider旁路 | M2/M7C | 默认deny、明确授权、未知成本保留 |
| RSK-09 | 旧回退丢迁移后工作 | reset/删除新project | 所有写门 | immutable副本、回退报告不承诺自动逆转换 |
| RSK-10 | 又做漂亮孤立HTML | 新UI不影响native Timeline/MP4 | M5 | 同页真实写入/预览/重开/导出验收 |
| RSK-11 | V1口径缩小 | M6后宣称P1也完 | M6/M7D | 两个完成声明与独立P1矩阵 |
| RSK-12 | 独立外审/人工缺位 | 同一Agent自签，headless当真人 | 各审计门 | REVIEW_PENDING，不假签 |

## 2. 真正未知的事项与负责人

| 事项 | 当前证据 | 谁/何时解决 | 是否阻塞 |
|---|---|---|---|
| 当前完整repo SHA与真正路径 | 仅用户报告短SHA | Codex M0 | 阻塞改代码 |
| D4.2.1冻结限额/字段/错误码/编号 | 本包未见原件 | Codex M0读原规范 | 阻塞对应测试定案 |
| OpenFilm full SHA和native mutator接缝 | main源码已读，未固定/运行 | Codex M1B | 阻塞M2 |
| 现有store/journal如何实现持久commit-record | 未读取源码 | Codex M0/M2设计审查 | 阻塞M2写入 |
| 首条10–15分内容/许可素材/旁白 | 产品方向已定，具体包未提供 | 用户+Codex M5前收集 | 不阻塞M0/M1；阻塞真实内容验收 |
| 模型/云服务预算额度 | 未确定 | 用户明确上限，原有授权不得扩范围 | 不阻塞本地探测；阻塞新收费 |
| 独立Claude外审执行方式 | 报告要求且Runner已存在，但没实际调用 | Codex复用本机授权入口 | 阻塞审计关闭 |
| 本机headed/屏幕/性能环境 | 当前报告仅headless | M5C真实本机试用 | 阻塞UX完成声明 |

## 3. 不需要现在重新向用户确认的事项

项目名称、中文时政长片、逐镜可控优先、之后稳定批量、同页Studio、可缩放地图、多候选预览、自然章节衔接、合理吸睛封面标题、插件化长期方向均已明确。不要再把这些问题当成无限需求澄清；以现有事实继续做限域技术验证。

## 4. 弃用旧路线的条件

不是M1B能启动就移除Hypit。必须至少M2受控接管和M4可靠编辑、旧项目恢复证明通过，才能把新项目默认引擎设为OpenFilm；在此之前默认入口可停留在legacy或新项目试验入口。删除legacy只可在完整V1后另立ADR，保留数据和许可证审计。

M1B或M2失败时，默认返回旧适配器，不未经用户同意换第三个主框架。允许修复已定位的上游问题并提交小补丁；没有证据不把“可修复”当已可用。


---

# 来源登记、事实边界与引用口径

## 1. 本地/用户来源

**U0 用户本轮项目报告。** 起点304c891、阶段、测试总数、直接证据缺口和范围评估，全部按用户提供记录；本包未读取真实本地代码。`sources/User-Reported-Baseline.md`为本轮摘要留档，不是独立复验。

**L1 早期Narralens v1开发基线。** 本次读取`01_PRD.md/03_Architecture.md/04_Development_Plan.md/05_Acceptance_Plan.md/07_Decisions_Open_Issues.md`；与304c891当前实现不同，不用早期文档反推现有源码。副本位于sources/legacy-*。

**L2 Story Atlas体验增量。** 本次读取`01-Experience-Delta.md/02-Implementation-Handoff.md`，保留缩放地图/三路预览/六类候选意图，技术栈段落由本包ADR替换。

当前权威`11_V1_Traceability.md`、D4.2.1内部审计和冻结矩阵必须本地读取，未在本包伪造其内容。

## 2. 公开上游源码研究

查阅日期：2026-10-16。公开main分支内容可能变化；本包没有成功取得不可变full commit SHA，`upstream-lock`中保留null，M1B必须解析并固定后再实现。网页可读不等于仓库在本机已安装可用。

| ID | 官方来源 | 支持的事实 |
|---|---|---|
| R1 | [OpenFilm官方贡献/源码布局](https://raw.githubusercontent.com/openfilm/openfilm/main/CONTRIBUTING.md) | React/Vite Studio、服务端/引擎模块、源码运行条件；M1B仍须本地固定。 |
| R2 | [OpenFilm ProjectView](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/studio/ui/src/components/ProjectView.tsx) | 现有Timeline/Preview/Inspector等实际集成位置；不是已接入Narralens。 |
| R3 | [OpenFilm film.mjs](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/studio/server/film.mjs) | editProjectFilm使用当前value应用ops，返回rebased；不以base不同作为统一拒绝。 |
| R4 | [OpenFilm SPEC](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/SPEC.md) | film.html/片段/场景frame(t)；工程语义依据。 |
| R5 | [OpenFilm provider contract](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/studio/server/providers/contract.mjs) | 多种媒体能力；Spend确认不含金额预算模型。 |
| R6 | [VibeMovie prompt与解析](https://raw.githubusercontent.com/EvanJYHe/vibe-movie/main/backend/prompts/geminiPrompts.js) | 完整JSON timeline编辑和解析；本项目只借鉴结构化提案方法。 |
| R7 | [VibeMovie render](https://raw.githubusercontent.com/EvanJYHe/vibe-movie/main/backend/src/services/render.js) | Remotion bundle/selectComposition/renderMedia；不是OpenFilm通用后端。 |
| R8 | [HyperFrames README](https://raw.githubusercontent.com/heygen-com/hyperframes/main/README.md) | HTML/媒体/seekable动画；可选素材/场景能力。 |
| R9 | [OpenFilm LICENSE及商标](https://raw.githubusercontent.com/openfilm/openfilm/main/TRADEMARK.md) | MIT代码与名称标识另分；自有修改版使用Narralens品牌。 |
| R10 | [VibeMovie LICENSE](https://raw.githubusercontent.com/EvanJYHe/vibe-movie/main/LICENSE) | 代码MIT；不代表所有依赖相同许可。 |
| R11 | [HyperFrames LICENSE](https://raw.githubusercontent.com/heygen-com/hyperframes/main/LICENSE) | Apache2.0；分发按具体条款处理。 |
| R12 | [OpenFilm package.json](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/package.json) | 本次看到0.1.7；exports/依赖是观察结果，不是选择或锁定的版本。 |
| R13 | [OpenFilm LICENSE](https://raw.githubusercontent.com/openfilm/openfilm/main/LICENSE) | 代码MIT通知与保留义务。 |
| R14 | [VibeMovie timeline验证](https://raw.githubusercontent.com/EvanJYHe/vibe-movie/main/backend/src/timeline.js) | 规范化和基础字段验证；不能替代领域级范围/资产/锁验证。 |

## 3. 设计与事实区别

EnginePort、CommandGateway、NativeMutationRegistry、impact hash覆盖、immutable snapshot、M阶段/测试矩阵、P0+P1完成规则均为针对本项目的**新设计**，不是上游已有功能列表。主架构切换是用户同意的方向，但尚未完成运行验证。

许可证说明用于工程选型和保留通知，不是对具体商业模式的法律意见。复制上游代码或发布时以固定版本许可和依赖清单再次审核。


---

# 本次交付检查与未完成的生产验证

## 1. 检查范围

本次仅制作并检查架构迁移设计包、HTML阅读交互、合同示例及机器清单。没有读取或修改用户本地Narralens仓库；没有克隆、固定、安装或运行OpenFilm；没有执行用户报告的126项业务测试、D4.2.1外审或任何迁移Gate。

本包97个业务验收场景均为 **NOT_RUN**。结构检查通过不能把它们变成PASSED。

## 2. 实际运行的文档包检查

`tools/validate_package.py`：14项包级检查，覆盖8个JSON Schema实例、97个唯一计划用例、无环的12阶段依赖、13P0/6NFR/4P1映射、168=56+56+56示例关系、HTML/Markdown对应，以及“业务未运行”的状态声明。

`tools/validate_evidence.py`：对未执行的证据示例返回NOT_READY/exit 2，不会把空清单当Gate通过。它只能验证证据格式和实际文件hash，不能判断审阅者独立性、画面质量或原冻结矩阵是否完整。

## 3. 实际浏览器检查

使用Playwright驱动本容器Chromium，Headless，桌面1440×1100与窄屏390×844。检查汇总页面、架构三态、阶段依赖、状态说明器、97行验收筛选、计划JSON导出、全文搜索、章节HTML导出、提示词、减少动效、键盘焦点、无脚本独立HTML与打印内容。

最终记录位于`qa/html-checks.json`，最终45项文档页面检查通过。截图在qa/。检查不包含真实OpenFilm编辑器、音视频预览/解码、迁移、模型调用、素材导入或MP4导出。

## 4. 环境限制

尝试直接file://导航时，浏览器返回`ERR_BLOCKED_BY_ADMINISTRATOR`。之后使用同一HTML文件的内容加载方式执行交互检查；不据此声称本地双击已实测。没有绕过管理员策略，没有测试localhost导航。

没有测试原生200%浏览器缩放、Safari/Firefox、Windows/macOS实际双击或手机硬件；窄视口不等于真实手机/原生缩放验收。正式工作台必须按M5C的headed与人工测试补齐。

网页不调用外部脚本或字体，内嵌数据未产生外部网络请求；用户主动点击官方来源链接不在离线阅读检查范围内。未把上游源码网络访问失败解释为产品不支持；full SHA继续由本地M1B核定。

## 5. 完整性与可复现

`SHA256SUMS.txt`涵盖交付包文件（不包含自身）。`tools/verify_checksums.py`核对字节完整性，不执行应用测试。`tools/render_docs.py`从docs/与templates/重新生成汇总HTML、独立HTML及合订Markdown；修改规格/矩阵后应重新运行包级校验与文档浏览器检查，再更新checksums。

本次允许声明：**迁移设计文档包已生成并通过上述包级/阅读交互检查，可交给本地Codex执行M0/M1A/M1B。**

不允许声明：D4.2.1 Gate已关闭、OpenFilm已固定或集成、业务测试/外审已通过、97场景已执行、V1-P0或V1-Full已完成。
