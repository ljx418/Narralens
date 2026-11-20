# MAIN最终交接入口

本包目标：A阶段恢复准备；完成后止于ClaudeCode开发启动门。产品代码未开始、本轮业务验收NOT_RUN，未进入B。当前实施文件IMPLEMENTATION_RELEASE.json为PREPARED_NOT_RELEASED，不得把文档/窗口启动当作实现授权。

## 先读与现状

1. 00_READ_FIRST.md、06_MAIN_REVIEW_AND_START_GATE.md。
2. baseline-observed.json/source-map.json、02_MAIN_CONTRACT_AND_DECISIONS.md（D01–D15最终语义）、03_OWNERSHIP_AND_DEPENDENCIES.json、04_COORDINATED_EXECUTION_PLAN.md、05_MAIN_ACCEPTANCE_AND_REVIEW.md。
3. bridge/product/media各自DESIGN/ACCEPTANCE/TASK/CLAUDE_READINESS。原CLAUDE_PROMPT是只读任务；未来真实实施用implementation-prompts对应文件。
4. audit/document-check.json、artifact-manifest.json（绑定最终稳定字节，复核见audit/artifact-integrity.json）、Orca实际Dispatch记录。旧readiness原BLOCKED/NEEDS_REVISION保留，闭环看MAIN06和领域TASK末节，不把旧报告改写为PASS。

MAIN工作树仍838ba5f2c8500f0103f56dbe51264ea9f70086fc+25文件未提交overlay；canonical仍ca5b67a8285b130c79055317c6202f73cfbb99c8。已提交源基础与未提交源分别标识，不以HEAD相同判dirty可丢。BRIDGE310候选已保全；PRODUCT/MEDIA源树清洁。备份在Narralens-agents/.handoff-snapshots/relaunch-20261111，保留至R0共同commit与接手核验完成后再安排清理，不能当临时测试垃圾先删。

## 实际窗口与目录

三个领域Codex与三个初始Claude子窗口都通过真实Orca启动；当前准备窗口挂在videoWorkLine父folder工作区，工具使用明确MAIN/canonical绝对路径，只写互斥文档。Orca Task父子关系与状态见记录；三Claude会话自报MiniMax，账户与额度未验证。部分Codex follow-up是原任务已结束后Orca自动reopen的新handle，不能继续向旧终端发输入；用dispatch mailbox与实时guide操作，不能重复fresh启动。

未来实施前MAIN须把工作区/启动cwd与release.directory一致，并读实际HEAD/dirty验证，不沿用当前父folder默认cwd写相对src。R0产生共同commit后通过Orca准备同仓实施目录与独立运行根；既有研究worktree不reset/stash，WSL/Windows映射若不同先在只读preflight修正，不克隆替代项目。

## 下一阶段由谁做

MAIN协调R0共同基线、正式release、共享合同、集成与大阶段验收；BRIDGE Codex管理共享core/协议Claude；PRODUCT Codex管理UI与native观察Claude；MEDIA Codex管理真实准备/媒体阶段Claude。03给出精确唯一文件owner，任务release只能取本票需要的子集，不因表里123项就同时改全表。

R1三领域并行可联调producer/consumer；R2审阅/唯一采用/NativeAck；R3固定snapshot正式媒体/最终可信QC/交付恢复；R4全适用真实验收与报告/服务准备。A人验通过及后续授权前不进入B。每个小模块自测闭环即可继续，不要新增细碎人工审批/重复全量报告；真正跨域问题由MAIN处理。

## 明确停止与待处理

- 当前Goal只到文档开工门，下一轮实际实施授权及真实共同SHA/release未产生；不自行开始编码。
- PRODUCT凭据事件已披露但账户持有人处置UNKNOWN，见audit/CREDENTIAL_EVENT；不重新读配置、不给任何凭据值、不自动修改/轮换或换供应商。
- 实际中文人声/授权素材待合法提供及登记，A最终实证不能用tone/3秒诊断代替；软件设计与无依赖实现可先推进，真实媒体验收须等输入。
- 本轮没有Git提交/合并/push；新文档已落盘，原代码和原evidence保持。后续若需提交，只显式选择已审文件，不git add -A混入用户候选。

## 简短下一轮goal（须先有人类的实施授权与凭据风险处置）

按relaunch-20261111审定包启动A剩余实现：MAIN先核保全/R0共同基线并发布各lane精确release，领域Codex在Orca管理所属MiniMax ClaudeCode完成任务包与自验证，MAIN协调合同/集成、处理超过两次返工的共同根因并统一验收。完成真实两主题60–180秒、改镜/重开/双正式导出、适用全量与T20及独立审查后，提供中文报告和服务入口，停在A人工验收，不进入B。
