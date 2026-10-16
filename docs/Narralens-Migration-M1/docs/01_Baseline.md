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
