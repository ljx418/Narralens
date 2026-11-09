# 开发计划、里程碑与团队流程

日期：2026-11-09。状态：DOCUMENT_DESIGN_ONLY。用户仅批准目标规划和R4体验，**未批准产品实现**。沿用准备轮、A/B/C三轮，17个IT包、六个AD-S阶段，不因文档细化新增逐模块人工停点。

体验增补不增加大阶段：A实现首条固定版本流程、阶段Bar/节点弹窗、Agent→工作台交接、样片/首章/章节包；B补齐能力组合与模板复用、稳定授权、运行中计划调整和真实模型准备；C在完整长片/三端范围复验。对应EX-01..23见08_WORKFLOW_MCP_CONTRACT.md。未完成稳定授权时保持首章检查；早期子集不能关闭最终V1规格。

## 1. 开工与里程碑

| 门 | 进入条件 | 可审核交付/用户获得的效果 | 出门门槛 | 当前状态 |
|---|---|---|---|---|
| DOC-G0 文档设计 | PRD与R4已认可，本轮文档授权 | 现状/目标L0L1、8页GAP、合同/差距/17包/35族/风险与回退 | 全部图/文/编号一致，已知缺口列明，内部多角度审视与人类方向核对 | 本轮形成候选，待人类审核 |
| CP-A0 首轮精确冻结 | DOC-G0意见闭环 | A链schema/TS/validator/registry/DDL/fixture/错误与权限表、固定依赖、真实测试计划 | 生产新接口未伪装已存在；producer/consumer签定同一hash；全新/旧库/恢复计划可执行；用户实现授权与MAIN ReleaseAssignment | 未冻结、NOT_RELEASED |
| A-INT 首条接线 | CP-A0及用户实现批准，MAIN发放路径/资源范围 | 真实MCP→Host→持久工程→原工作台，实际事件与原生确认 | 至少一个真producer→consumer，无占位helper/临时fixture冒充；负向可打红 | 未开始 |
| A-EXIT 真实短片 | IT-A01..06实际实现与接线完成 | 60–180秒真实影片、改单镜双导出、重开可续作；系统非模态、工作流可见 | A场景真实全量/构建/负向/恢复、适用R4门、独立外审、人验齐备，仅AD_SHORT_FILM_READY | NOT_RUN |
| B-EXIT 协作制作 | A出门通过+CP-B0/授权 | 任意3–6案、节点修改/并行、真实下载/Comfy/声音、8标题4封面与完整QC包 | B场景与全部本轮承诺实证、独立外审、人验；Beta不自动等于V1-P0 | NOT_RUN |
| C-EXIT 完整V1 | B出门通过+CP-C0/授权 | 三端真实接力、10–15分钟/100+镜、章节/风格/后期/反馈与完整交付 | 原13P0/6P1/6NFR、21体验、35族及适用R4门全真证、无partial/NOT_RUN、独立外审+人验+Git同步 | NOT_RUN |

没有实测吞吐不承诺日期/Token/套餐消耗。A后用实际缺陷率、接线吞吐与渲染/服务时延重估B/C；不通过硬性次数/预算替代功能门，也不无限重试未知付费结果。

## 2. 17包实施拆分与DoD

表内是将来实施顺序；状态仍为PLANNED。轮内按共同冻结port并行，包验收等待正式DAG前置。每包交代码/合同差异/测试/复现/日志/产物摘要，MAIN做生产组合；不能把不同工作树的模块日志相加成整轮PASS。

| IT包 | owner与重点实体 | 完成后的可见效果 | 包DoD及重要负向 |
|---|---|---|---|
| IT-P01 | MAIN，R4/PRD/差距 | 用户已能核对改单镜与系统面板目标 | R4原型子门已PASS；本轮补架构/规格差距，不冒充合同/产品通过 |
| IT-P02 | MAIN+三lane设计 | 不同实现者拿到同一接口/状态/测试/回退规则 | CP-A0材料齐备、内审/独立文档审查闭环、具体实现授权；缺任何一项仍停文档 |
| IT-A01 | BRIDGE模块+MAIN注册，E06/E09 | 双击打开真实服务与持久工作台，冷/热启动清楚 | 单实例/归属/就绪/退出/重开；旧临时体验入口独立，不全机kill |
| IT-A02 | BRIDGE，E07 | Codex真实发现能力并读同一工程；其他端实测矩阵 | MCP只是外观、工具schema/权限失败明确；Claude/DSH blocked不写兼容通过 |
| IT-A03 | MAIN内核+PRODUCT/BRIDGE，E08/E12/E13/E15 | 目标、问答、步骤、事件和结果可持续追踪 | 共享库/CAS、snapshot+cursor无漏、未知/取消/旧attempt语义、真实事件接线 |
| IT-A04 | MAIN bootstrap、PRODUCT创作，E14/E15 | 新主题创建不同一般工程，关闭能重开 | new/migrated origin；空/初始工程原生可验；幂等、初始commit、失败补偿；不伪造migration |
| IT-A05 | PRODUCT主交互+MAIN旧核心接线，E03–05/E16/E17 | R4真实改单镜；Agent准备，用户比较和确认 | 所选候选/真实媒体/选区版本/保留项绑定；审批与三类事实分离，失败不提交 |
| IT-A06 | MEDIA render/QC+MAIN注册，E11/E21 | 可带走首部短片，两版本导出与服务重开 | EnginePort七方法保留，render真正可用；固定snapshot、完整decode与版本包；不是探针或proxy冒充正式导出 |
| IT-B01 | PRODUCT，E03/E15 | 3–6案均可选，节点编辑仅影响关联分支 | 非首案真实映射、旧选择/输入失效、DAG无环、独立结果保留 |
| IT-B02 | MAIN驱动/资源、MEDIA消费者，E08/E19 | Agent接力、并行准备、锁与批准可靠 | epoch/lease/资源CAS；未知结果不重提；共享GPU单池；原生发布仍串行 |
| IT-B03 | BRIDGE+PRODUCT，E05/E13 | 系统状态、队列/资源/告警与镜头关联，断线可恢复 | 真采样/TTL/unknown、权限/脱敏、非模态继续精修；不能用健康代表业务完成 |
| IT-B04 | MEDIA，E18/E20 | 在线许可素材与固定一图一视频模板真正进入剪辑 | 分阶段AssetPlan、有界下载/来源/rights、模板固定、probe→asset→clip→render、取消晚到与共享隔离 |
| IT-B05 | MEDIA+MAIN音频保护，E20 | 真实录音/授权TTS、ASR/字幕对齐，可试听和采用 | 完整时长/采样/字幕/旁白锁、provider receipt与费用未知；不以空音轨假通过 |
| IT-B06 | PRODUCT+MEDIA，E21 | 8标题/4封面、完整QC与来源许可交付包 | 实际候选可选，QC block禁止正式交付；外部审查与B人验归同一冻结候选 |
| IT-C01 | PRODUCT+MEDIA+MAIN采用，E22 | 风格版本/局部override、评论锚点、原全部后期操作 | 入出点/裁切/缩放/速度/关键帧/字幕/音轨/转场逐项真实render矩阵，disabled不是完成 |
| IT-C02 | MAIN+三lane | 10–15分钟母片、3–5分钟20+镜章节、三驱动接力 | 至少3处局部修改、真实进程丢失/恢复、100+镜性能、长片双导出 |
| IT-C03 | MAIN集成与独立审查者 | 可声明完整V1并迁移/交付 | 全PRD/架构/代码/测试证据追踪全绿，人工与独立外审齐备，明确Git提交与同步结果 |

依赖与35族映射沿用`../iteration-plan.json`，owner及目录沿用经本轮纠偏的`../parallel-plan.json`。不改变既有17包DAG。A优先本地授权媒体与真实录音，不前置整个Comfy库；B必须补齐真实AI生产，fallback不能签AI能力通过。

## 3. 并行批次与责任

- CP-A0前只做文档、接口向量设计和只读探针规划，**不启动实现Agent**。
- 获批后第一批：MAIN公共port/DDL/实例与装配；BRIDGE纯协议/健康模块；PRODUCT创作对象和UI端口消费者；MEDIA snapshot render worker。各模块可在同一合同fixture上并行，不能签端到端通过。
- 第二批：MAIN接一般新建/初始commit和Gateway；PRODUCT连真实目标/候选/审批/事件；MEDIA接真实snapshot/资产；BRIDGE跑真实首端。MAIN每次接线验证一条完整小链，优先暴露集成失败，不等全模块最后一天才连。
- A末同一SHA收口；B按既有B01/02/03并行后接B04/05，再B06；C01与C02可并行，C03统一总验。大阶段末集中独立外审/人验，模块级问题由负责Agent自动闭环。

## 4. 每个lane的具体工作流程

目录内Codex负责设计/文档/验收，Claude Code CLI负责实现；429由Codex核对原进程停止、保留dirty工作后接手。同一lane单writer。实施者自测不等于独立审查；MAIN也参与实现时另取未参与者审冻结候选。

ReleaseAssignment至少记录base/contract完整SHA、ticket/实体与允许路径、protected例外、producer/consumer、实际测试命令/fixtures、端口/DB/var/profile、资源预约、业务/外传/费用授权、回退与停止条件。没有该记录不能因目录已存在或文档已批准自动开工。当前三lane路径只是规划，不能声称Claude或Codex已领取实现任务。

MAIN独占server/共享合同/DDL/原M5/原adapter与核心；PRODUCT拥有新增observation/system/creative/workspace；BRIDGE拥有mcp/skills/launcher/observability；MEDIA拥有render/preflight/delivery/providers和批准的新adapter目录。既有OpenFilm render方法的接缝改动由MAIN负责或按具体单文件release授权，不能借MEDIA宽前缀覆盖旧文件。

## 5. 编程与接口实现约束（供后续实现，当前不写产品代码）

使用仓库TS严格类型、明确输入/输出与typed错误；生产所有外部输入先runtime validator，拒绝additionalProperties，不在验证前重建“仅已知字段”对象。constructor注入port，禁止私摸别模块dependencies/DB，禁止空helper/占位hash/默认首案当实现。路由处理器只认证、验证、调用、映射，不复制业务规则。

文件有单owner，变更范围最小；不重写已通过模块。时间使用既有整数帧与rational fps，canonical跨语言向量复用；真实路径canonical/lstat/引用闭包约束保留。工程写需项目队列、source/base/锁/许可/批准复核；持久状态更新CAS；资源释放与异常/取消放finally；独立UUID staging、无覆盖发布与bytes校验；关服先停心跳/排空/记录恢复，再关闭DB。

测试应证明用户效果和安全边界，避免镜像实现。每个关键负向至少一次变异确认能打红；真实Host路由不得靠手调worker.run、注入假validator或只构造已升级库证明生产接线。真实全新库用原始DDL/文件建库；进程崩溃用真实子进程，非仅throw。

## 6. 出门与回退

每轮顺序：规格检视→适用自动全量/构建/真实媒体→四视角内审→绑定冻结SHA独立复核→中文可视化报告→人验→显式Git提交/同步。阶段未通过不改名到下一轮，失败证据与旧Gate不覆盖。第3次返工由当前负责Agent接管共同根因，非机械反复退回。

UI失败可关闭新增挂载，保留原编辑器、工作台与工程；MCP失败停新外观，Host事实不删；provider失败停该能力，保留receipt与unknown费用；新建失败隔离恢复，不能重置用户工程；内容回退只走受控restore新revision；DDL不可降级时明确只读/导出恢复，不能删库称回退。

下一允许动作仍为文档审查/合同冻结设计。完成DOC-G0不构成CP-A0或生产代码授权，待用户明确批准后再汇报实际Agent分配并发放实施任务。
