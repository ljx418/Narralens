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
