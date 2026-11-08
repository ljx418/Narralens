# 本轮文档核查记录

## R2：用户初审与本地工作流设计复核

R2前置文档提交`07ed798`，用户导出的5项文档摘要在修改前逐个匹配，原件保留于`reviews/user-review-r1.json`。
修订覆盖E02/E05/E15/A06以及新增E17..19/A11..12，E03无附注仍待讨论。下面R1自审与截图为历史，不作为R2结果冒用。

R2产品自审：需求启发与界面答复、分阶段AssetPlan、默认业务图/高级Comfy图两层；“专场”与“转场”分别描述，未默默合并。
R2实现自审：驱动租约≠任务串行；ResourceScheduler与Job/Coordinator边界；canvas/API/envelope区分；异步自定义节点结果不等于媒体；取消共享Comfy不能全局interrupt；概念精确层与生成背景分离。
R2验收自审：E01..19/A01..12/S0..5计37项，T01..31覆盖；历史smoke/文件存在/依赖就绪/新集成验收分级。新业务测试、GPU运行与独立外审均NOT_RUN。

R2 Archify deliver：9/9 showcase、0错误/0警告。
specification SHA256 `fb5dfab224bbb7327a0057440a800bb9c5c4d7118c986c12dda42eaebc9369b4`；
artifact SHA256 `5da3fcb4ae32db438a0ddd7730955872c3ab805192e421bd8f7fc1870c1d504c`。
浏览器、37项意见保存/导出与工作流交互示意的实际结果见最新`review-check.json`；R2截图以`r2-`开头。
这些是文档与演示检查，不是真实工作流执行。用户未认可R2设计前，不进入生产实现。

R2补充Headless验证已通过：四个架构桌面尺寸、桌面/390窄屏、37项核对、R1历史意见呈现、意见保存/刷新恢复/JSON实际下载，以及8节点示意的“编辑画面只影响下游、不重算独立旁白”。已查看大屏架构与节点编辑示意截图，无内容遮挡。原生Archify visual-check仍因Windows调试pipe错误失败，单独保留`../architecture/agent-driven-v1-r2.architecture.visual-check.json`，不将补充结果冒充原生命令通过。

## R1历史记录

基线 `8633786dfc15490761f5d6a46f20bca0bcdc7d80`。范围仅文档/图表/核对页面生成与验证工具，不修改产品运行时。

## 第一轮：产品与职责自审

对照原 PRD P0/P1/NFR 与用户新路线，保留完整长片、3–6方案、锁、恢复、8标题/4封面、真实交付和人工判断。
新增16体验；修正旧“一页不进终端”与新双入口冲突；区分当前临时入口和生产入口；将面板基础操作获认可与整体 UX-12 签署分开。
发现并处理：空白项目原先归属模糊，现明确 AD-S2；任意方案选择由 AD-S3 验证，禁止固定第一份；S2 短片不冒充 V1。

## 第二轮：架构与实现可行性自审

对照现有 Host、Coordinator、Resolver/Workbench 的 migration 依赖及 M5 launcher，识别新项目来源、持久任务、driver session 和 MCP 新增实体。
发现并处理：工作流状态不能替代提交状态机；驱动租约不能替代 job lease/内容锁；外部服务未知扣费不能承诺全局恰一次；UI和MCP共用应用服务；可信人类批准不能由 Agent 参数自报。
图只表达调用关系；图中存储写路径是概览，精确责任以 L1 表/关键序列为准。图包含未实现模块，均明确状态。

## 第三轮：验收与文档一致性自审

检查 AD-E01..16→AD-S→AD-T01..25、架构 AD-A01..10、旧M6/M7映射；保证首端支持不代替三端兼容。
发现并处理：DSH/provider/精确schema/DDL/原型未探明，明确列为 S0/S1 前置而不承诺已冻结；新日期估计不沿用。
历史主文档添加新目标入口而非覆盖旧Gate。核对页属于设计评审而非可用产品或业务验收。

以上三轮为同一 Agent 不同视角的自审，**不是三个独立会话外审**。独立外审 `NOT_RUN`，用户方向核对 `PENDING`，新路线实现准入 `NOT_READY`。

## 图表与页面验证

- Archify deliver：9/9 showcase，0错误/0警告。
- specification SHA256：`450a8a7610573310ff8614e9ae661151c0e40d4b3a4760c1d66c1fd60190e7a6`。
- artifact SHA256：`1fbd988fb7ef9177adc1dcf34aef3aa3c0bf687c9dc30e008e262d3381e7452c`。
- Archify 原生 visual-check 的实际结果以 `../architecture/agent-driven-v1.architecture.visual-check.json` 为准；Windows Chrome 补充检查单独记录，不能改写原生结果。
- 浏览器检查、文档绑定、意见保存/导出、覆盖与相对链接检查记录到 `review-check.json`（生成产物）；未生成前不推定通过。

### 补充检查已执行的结果

Windows Chrome Headless/CDP 补充验证通过：架构图在1440×900、1600×1000、1920×1080、2048×1320无页面溢出；
核对页在1440与390宽度无横向溢出，32项与内嵌架构均存在，意见与备注刷新后恢复。检查所用隔离 profile 已清理。
真实点击下载已取得 JSON 文件并解析验证：32项、所填意见、文档版本绑定一致。初次下载检测失败源于测试器传给 Windows Chrome 的下载目录分隔符，修正为 Windows 路径后通过；页面本身的下载实现未调整。
截图：`architecture-1440-light.png`、`architecture-1440-dark.png`、`architecture-2048-light.png`、
`architecture-2048-dark.png`、`review-1440.png`、`review-390.png`。
已实际查看架构大屏浅色、桌面深色、汇总页桌面与窄屏截图，节点/关系/文字无遮挡，视觉复核通过。
发现并修复初版架构纵向超高及汇总页窄屏溢出；未通过隐藏溢出或裁切掩盖。

Archify原生 visual-check 因 WSL→Windows Chrome 的 DevTools pipe ECONNRESET 失败；补充验证不把原生状态改为通过。
独立外审仍 NOT_RUN；三轮均是本 Agent 自审，不自签独立外审。

业务测试/真实成片/新MCP客户端调用：`NOT_RUN`（本轮仅文档）；新架构和开发合同尚未实施冻结。
