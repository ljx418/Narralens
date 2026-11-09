# 独立设计一致性审查

日期：2026-11-09。审查方式：只读源码/文案/图模型/生成HTML及内容hash；未运行浏览器、产品Host、provider或生产测试。审查者未编写本次被审的build-review.py、index.html、L0/L1图或implementation-design/01/07/08；审查者参与过cp-a0数据候选，因此本记录不作为该数据候选的独立外审。

初审结论：`NEEDS_DOC_FIX`。未发现需推翻目标架构、允许Agent自行批准或替代原编辑器的严重问题；发现两项文档交付修正和一项生成物同步条件。修正后由MAIN重新生成并检查字节绑定，不能把本记录当产品PASS或实施授权。

## 必须修正

| 编号/级别 | 位置与证据 | 影响 | 建议与复核门槛 |
|---|---|---|---|
| FR-D01 / 中 | build-review.py:35仅以all_docs文本拼接计算revision；:53声称每次修订使用独立版本键；:61用该revision保存/读取旧checkbox与notes | 页面模板、体验stage文案、L0/L1图、R4嵌入文件、合同/registry/SQL附件变化而Markdown不变时，审查反馈版本键不变；旧勾选会继承到新审查材料 | revision按确定顺序绑定全部实际嵌入输入（路径+hash），至少模板自身、全部文本/合同附件、原型资源、L0/L1/GAP图与概念图；避免输出HTML自引用。修改任一被展示输入必须改变revision，旧反馈不继承 |
| FR-D02 / 中 | build-review.py:52及对应index正文写“CP-A0仅冻结A固定流程的精确候选” | 与本页“精确合同尚未冻结/实施未释放”及registry REVIEW_CANDIDATE_NOT_FROZEN_NOT_RELEASED容易冲突；读者可能把已有隔离检查理解为冻结完成 | 改“CP-A0候选仅覆盖A固定流程；当前未冻结、未释放”，再生成页面；全文不能以“已冻结”描述当前CP-A0 |
| FR-D03 / 交付同步条件 | 只读比对content-bindings.json.files与磁盘源hash时，docs/01_PRD.md、docs/03_Architecture.md、implementation-design/00_READ_FIRST.md三项不一致；HTML自身hash与记录一致 | 当前HTML是自身可校验的旧嵌入材料，尚未收录这三处源文最新修改，不能称最终全部内容一致 | 各作者结束后由MAIN重新生成；重新验证每个file hash与最终输入一致、HTML hash一致、关键最新字段/边界实际内嵌。此项可能是正常并行写入时序，不能默认为已经消除 |

FR-D01是反馈版本绑定缺口，不是反馈会被误转为生产授权；导出JSON显式标DOCUMENT_FEEDBACK_ONLY_NOT_RELEASE_OR_PRODUCT_ACCEPTANCE，未发现工具向生产发送批准。

## 目标、图与合同的一致性

1. 01的目标链为Agent→Skill/MCP façade→统一Host应用→准备任务/产物→可信审阅/有限授权→Coordinator→受控EnginePort与同库事实。L0模型仅driver→mcp→app→core→engine和app→job、ui→app；job没有直达engine/active_commit的边。未发现媒体完成或MCP普通relay被画成正式提交权威。
2. L0的“有限授权提交”须与01/CP-A0的统一运行scope/审阅门一起解读；ui→app标同源HTTP/SSE是通信关系，不赋予任意前端写权。事件SSE单向传送细节未在L0展开，不构成第二事实库。
3. L1采用可信导演栏决定→ApprovalService，服务器影响/锁→ApprovalService，Coordinator→RevisionStore原子事务及Coordinator→EnginePort受控发布。审批节点到Coordinator的“核对并消费”在单独看图时略有时序歧义；页面正文明确“批准消费与最终commit同事务”，与CP-A0一致。可把图标签改“提交内复核/消费”增强清晰度，但未据此判越权。
4. 01明示单Host/单共享SQLite/单引擎/单原生timeline与selection/clock；已有Gateway注入M5独立bundle保留，不强制新createRoot。页面也明确原剪辑工作台增量、顶部可折叠阶段Bar、节点详情弹窗、非模态系统侧栏，嵌入R4仅模拟。未发现新聊天应用、第二时间轴或把HTML当生产入口的承诺。
5. 07/08的前期Agent问答、后期同版本ReviewPackage、一次审阅并有限采用、sample→first_chapter→chapter→cover/QC、只省特定首章的稳定授权，与页面主要体验文案一致。关闭/沉默不接受，普通relay不扩大权限、输入改动不得沿用旧批准，均有明确边界。
6. A固定local-short-film@1、本地短片/真实录音/样片与首章门/原生可编辑/正式导出/重开改单镜；B通用组合/稳定授权/运行patch/真实模型与完整媒体；C长片/三端/全PRD。页面将稳定豁免与模型写操作留B，A系统读取健康，符合CP-A0与EX范围表。01中A/B合写实体状态是总体目标，不声称A已具备B功能。
7. 当前合同新增最小Question/Answer及结构化ContentBrief支持A的脚本/素材策略/风格问答，不以“B再做”删除A承诺；富交互和动态组合仍B。验收A-CREATE/FILM/WRITE/ENTRANCES/EVENTS/REOPEN与EX-01..23、T20-A..H保留真实输入/授权/媒体/解码/原子发布/恢复门，页面没有把30秒原型素材替代60–180秒A成片。
8. 页面对AI概念图、原型状态、Archify检查/visual-check SKIPPED、Windows Headless补充、文档合同检查、产品NOT_RUN、真实媒体未选、客户端未联调等区分清楚。未发现文档PASS涂绿产品验收；人工反馈不会代签human gate。页面的“CP-A0仅冻结”措辞需按FR-D02消歧。

## 审查时字节定位

- build-review.py SHA256：603f8c13e78b86ac5510670a6fd2c4e5c41e53a313ac773e2d6c7347395529c3
- index.html SHA256：77c62ae0d94e5d8b872df20382c18e1ec372e099d44fe6448ad67cd0afa61448
- l0.architecture.json SHA256：653bb30f5d06c64c711b5ca646ae40ff2aa3f20b2663bf523f45f263bbf85df3

这些hash定位被审快照；MAIN修改后应补修正结论与新hash，不能继续沿用本次字节称独立审查已通过。实际像素/键盘/跨视口、媒体质量、正式授权和生产能力均不在本次只读审查证明范围。

## 修正复核（同日追加）

MAIN已修改build-review.py，本审查者重新只读检查：

- FR-D01：`CLOSED_SOURCE_VERIFIED`。revision_inputs现包含all_docs、build-review.py本身、L0 HTML/JSON、实际L1 HTML/模型、全部GAP SVG、R4 HTML/CSS/JS、背景与概念图；附件整体以sort_keys序列化一起进入SHA256。页面模板和合同/SQL/图像输入修改会改变反馈key。这里复核源实现，不声称已运行浏览器存储变异测试。
- FR-D02：`CLOSED_SOURCE_VERIFIED`。页面模板已改“CP-A0仅覆盖A固定流程的精确候选，当前未作生产合同冻结”，消除已冻结歧义。
- FR-D03：`FINAL_BUILD_PENDING`。MAIN将在所有作者完成后重新生成，旧HTML/旧content-bindings的失配记录保留为初审事实。最终生成物须逐源hash相等并包含上述修正；本记录不替MAIN代填尚未执行的重建结果。

修正后源设计结论：`DOC_DESIGN_REVIEW_PASS / FINAL_ARTIFACT_BINDING_PENDING`，没有剩余架构阻断项；仅限本记录列明的目标/架构/文案一致性范围，不代表数据合同独立外审、视觉自动化、业务验收、生产冻结或实施授权。

复核build-review.py SHA256：2c800ae8d23a16daa6d198c1a59618f9a8ee8f4a9f0220cf56e969be6c591dbc
