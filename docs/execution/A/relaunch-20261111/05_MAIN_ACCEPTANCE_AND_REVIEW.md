# MAIN 组合验收与本轮文档审查

状态：MAIN已审核的组合验收设计；本轮业务测试一律NOT_RUN。依据cp-a0/03_EXECUTABLE_ACCEPTANCE.md、implementation-design/04_ACCEPTANCE_SCENARIOS.md与V1_FRONTEND_EXIT_GATE.md，不修改旧Gate状态。

## 大阶段组合门

|原case/范围|操作与证据|必须成立|牵头/复核|
|---|---|---|---|
|A-COLD / T01,32,34|隔离实例冷启、重启、关UI、关服务；PID/归属/时间戳/同项目|ready来自探针；关UI不丢工程；不kill共享服务|BRIDGE / MAIN|
|A-MCP / T02,03,04,22首端|真实驱动CLI走stdio MCP到生产应用服务，保存脱敏请求/响应/Job lineage|不是手调内部方法或mock MCP；缺能力有明确错误|BRIDGE / MAIN|
|A-CREATE / T05,07,27|需求问答/内容决定→可信创建确认→真实两主题项目→重开|输入闭包/owner/初始事务/快照/幂等一致；relay不授安全权限|BRIDGE+PRODUCT / MAIN|
|A-FILM / T06,10,11,15适用子集|授权真实本地素材和中文录音→样片/首章合包→60–180秒原生工程|真实媒体、可编辑镜头/概念、审阅输入摘要一致；不宣称3–6选案已完成|MEDIA+PRODUCT / MAIN|
|A-WRITE / T12,14|影响→可信批准→受控采用，再改一镜；拒绝/旧base/锁/过期/许可变化|正式采用恰好revision+1；拒绝与冲突+0；source/pointer/snapshot/approval/impact/outbox/idempotency同边界|BRIDGE共享核心 / MAIN|
|A-ENTRANCES|Agent HTTP/MCP、UI、native写入口、未知操作、跨owner|安全守卫一致；不支持入口拒绝；原strict409与七方法EnginePort保持|BRIDGE+PRODUCT / MAIN|
|A-EVENTS / T33,35|快照初连竞态、重连、重复乱序/过期游标/旧attempt、持续媒体负载|事件无漏窗口；正常p95≤2秒(固定机/样本)；断线unknown非假绿|BRIDGE+PRODUCT / MAIN|
|A-CANCEL|运行中pause/cancel、失lease、关闭重开、晚到结果|暂停不新派发；取消不自动采用；job/step/lease一致；无DB关闭后worker写|BRIDGE+MEDIA / MAIN|
|A-UI / T15 / R4-UX-01..12适用|真实原生编辑器打开、折叠Bar、节点详情、系统面板、选镜改镜、键盘/焦点|单timeline/selection/clock；非模态仍可剪辑；真实observed确认才loaded；旧页无回归|PRODUCT / MAIN|
|A-REOPEN / T07,08,09,20|退出驱动/工作台/服务再启、打开同项目、下载、改单镜后二导出|原生clips未扁平；两次输出变化镜与不变区正确；读不隐式重算|MEDIA+BRIDGE+PRODUCT / MAIN|
|全适用回归/安全|同一冻结组合SHA与配置跑check/build/合同/fitness/既有历史门/凭据扫描/真实E2E|命令完整原样exit，失败留存；历史current-tip移动不伪调绿；补充historical证明|MAIN，独立未参与者复核|

## T20逐项恢复门（开发后真实执行）

- T20-A：隔离可审计ENOSPC/写失败，无ready/download/半包，原工程不变。
- T20-B：非零编码/截断/坏帧，ffprobe或完整decode拒绝，不能跳QC。
- T20-C：同snapshot/config幂等并发、异输入/预置同名输出，winner完整，loser只删自己UUID staging。
- T20-D：取消后晚到成功，受控停止/持久收敛，不ready不重发。
- T20-E：encode后QC前、publish前、rename后DB前、DB后events前，分别终止自有真实进程；重启无半包/重复发布。throw不替代真实进程丢失。
- T20-F：QC block/缺附属文件/摘要不符，修复后明确同snapshot的新attempt，不绕过质量门。
- T20-G：导出并发新revision，输出仍绑定旧snapshot并显示版本。
- T20-H：完成后重复GET/同key、重启再下载，输出bytes/hash/manifest一致，读不渲染。

每个case记录前置/入口/逐步操作、positive和negative断言、实际命令/exit/时间、代码完整SHA+overlay若适用、固定上游/配置、媒体许可与输入摘要、日志及产物SHA256。组件桩、真实Host、真实媒体、Headless、headed、人验分别标注；不混算。

## 文档开工门（本轮实际验证对象）

1. 保全：四worktree的base/dirty清单和可校验备份存在；MAIN源文件与旧证据不被本轮修改。
2. 团队：三个领域Codex实际Orca Dispatch可验证；各自Claude子窗口有实际启动回执与只读检查结果，失败/配置未知明确记载。
3. 设计：三领域DESIGN/ACCEPTANCE/TASK/CLAUDE_PROMPT齐备；真实路径/实体/输入输出/持久与恢复边界可追溯。
4. 合同：MAIN逐项裁决公共接缝，不将提案当既有API；Producer/Consumer和例外/兼容路径明确，无循环授权依赖。
5. 执行：每文件唯一writer，跨lane与共享核心有独占分配；精确base+overlay/合同hash、资源与集成顺序、具体可执行命令、停止与回退齐全。
6. 审查：MAIN核查架构/实现可行性/完整体验/验收四视角并记录问题闭环；领域及Claude对分配有反馈，未关闭重大歧义不得列入首批可实现票据。
7. 停止：最终只宣称A准备任务包就绪，未启动代码实现；不宣称A/V1或人验通过、不进入B。

## 本轮审查记录

编制中，待领域交付及Claude只读检查回收。现已观察：原CP-A0四文件摘要全部相符；A未完成、MAIN有未提交候选；单纯旧lane基线与历史PLANNED不能作为现在的实现状态。架构摘要图已通过Archify 9/9 showcase，四视口Headless自动测量通过；实际产品验收不由图样验证替代。

文档审查结论与逐项裁决最终写入06_MAIN_REVIEW_AND_START_GATE.md，不在本草案先签PASS。


D01增补负向/重放case（未来local-assets-transport.test.ts，未执行）：同一public登记请求重试时改变correlation_id或UI session不改变声明摘要/asset_id；候选TTL到期及Host重启后同key成功请求仍读原receipt且不再ffprobe/编码/登记；同key换candidate/source/license/origin必须409且无新asset/event，不能生成新attestation_ref绕过幂等。没有成功receipt且候选过期则410；未授权/跨owner即使猜中key也不读原响应。
