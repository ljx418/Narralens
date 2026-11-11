# Narralens A MEDIA Claude · 只读启动检查

> 当前执行设计以本文末尾“D01–D15最终ACK”及集中03名单为准，覆盖此前待裁决/历史备选措辞；这是设计任务包，不是实现release。

你是MEDIA Codex所属ClaudeCode，使用用户现有配置（用户称MiniMax），这是可见三级Orca流程的最下层。本轮仅只读接手检查，不是实现release；不得启动helper。父Task task_cb34e517149a，协调handle term_d6cb9559-1366-4b42-849a-3ee926ccc58b。按Orca注入的你自己的task/dispatch/from发送结果，不照抄父ID当自己的任务。

## 路径、授权与阅读顺序

canonical `/mnt/c/workspace/videoworkline/Narralens`，Windows同目录`C:\workSpace\videoWorkLine\Narralens`；真实主源码 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `838ba5f2c8500f0103f56dbe51264ea9f70086fc`且有保留dirty。用本机映射，不建替代项目、不读J盘。若CLI在Windows，优先用对应C盘路径读取；找不到原目录就BLOCKED，不clone/copy。

顺序：canonical AGENTS.md→docs/agent-driven-v1/11_AGENT_DELIVERY_PROCESS.md→execution-planning/01_EFFORT_AND_STAGE_PLAN.md→implementation-design/07_EXPERIENCE_SPEC.md与08_WORKFLOW_MCP_CONTRACT.md→docs/execution/A/contract-freeze.json→docs/execution/A/relaunch-20261111/baseline-observed.json和02_MAIN_CONTRACT_AND_DECISIONS.md/05_MAIN_ACCEPTANCE_AND_REVIEW.md→本目录DESIGN.md、ACCEPTANCE.md、TASK.md→MAIN实际package.json与对应源码/测试/候选HANDOFF。前述execution-planning/implementation-design目录都在docs/agent-driven-v1下。不要从旧MEDIA lane推断MAIN未实现。

唯一允许写文件：`/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/relaunch-20261111/media/CLAUDE_READINESS.md`（Windows同文件映射允许）。其他所有内容只读，包括四份文档、代码、tests、配置、Git索引。禁止代码实现、测试/build、安装、渲染、启动产品服务、凭据读取/输出、切模型/配置、新外传、提交/合并/push、reset/stash/cherry-pick/rebase。不得将下文开发命令执行于本轮。

## 本轮只读任务

核对四文档与MAIN实际代码是否能接手：实体/符号/输入hash/已有候选、白名单、合同提案和可先实施范围是否具体；指出P0/P1阻塞和可直接修正文档问题。特别核查prepared immutable ref、保留materialization_id合法origin映射与新wire备选、唯一Coordinator/source_fact事务、preview/committed区分、阶段无循环授权、取消/失lease/FD、正式render持久端口与双导出/T20真实终止点。

记录你实际CLI、会话工作目录、平台与路径可达性、本地依赖可达性（仅文件存在/版本元数据读取，不启动测试或服务）、上游pin、需要的依赖/素材/MAIN契约及阻塞。只根据会话已有显示的模型标识或非敏感会话元信息判断是否MiniMax；无法确认写UNKNOWN，禁止读取凭据或配置中的secret、禁止假称验证成功。不得因Claude品牌名称推断供应商。

## 未来获正式release后的开发自验证（现在禁止执行）

按TASK准确fullSHA+overlay/合同hash和MAIN独占文件清单开工；先复用processor/verifier/assembler，公共契约裁决后由指定writer装配；不绕过MAIN注册和Coordinator。A-MEDIA-1/2/3按整条用户路径交付。ACCEPTANCE C1/C2模块、C3/C4正式媒体、C5类型/构建及MAIN统一check是已核实脚本计划；缺的生产E2E/fault命令先由MAIN冻结，不自造“已有工具”。所有重型预约、真实中文录音/60–180秒、授权来源及两正式导出保持。失败证据保留，超过两次返工由MAIN接管根因；429先核原writer停止再申请已授权范围交接，不能自动扩权。

## READINESS交付模板

- verdict：READY_FOR_DESIGN_HANDOFF / READY_WITH_BLOCKERS / BLOCKED（都不是代码开工许可）。
- actual CLI/cwd/OS、Orca task/dispatch/handle、session model observation、MiniMax match YES/NO/UNKNOWN（证据且无secret）。
- canonical/MAIN/文档/上游/依赖路径可达性；实际HEAD+dirty与归档是否匹配；读取文件及关键hash。
- 每份文档可接手程度；按严重级列缺项、具体路径/符号、建议文档修订；公共合同必须MAIN裁决。
- 可独立开始的后续票据、依赖后票据与人类素材需求；任何业务测试一律NOT_RUN。
- actions performed（仅只读+此报告）、唯一修改文件、未执行项；不存在任何产品PASS/独立验收声称。

通过Orca orchestration返回MEDIA协调者。若阻塞需问，用你注入的ask并结束turn；完成按注入worker_done一次且真实outcome（只读审查完成可succeeded，若审查无法完成failed）。保留可见窗口，不退出shell；不poll/sleep，不开始实现。


补充核查：DESIGN末节MAIN优先方案为内部prepared-source@1/ps_映射、原result_ref返回ReviewPackage而非新wire；特别检查SnapshotRenderService拆成可恢复encode/QC事实和当前阶段授权publish，80defs/31routes及TaskPrepare.kind保持，chapters不能借snapshot.render提前delivery.package。读ACCEPTANCE M09/M10和TASK启动恢复记录；判断提案能否在MAIN裁决后实施，不能自签冻结。


### 本轮已回收结果及后续阅读优先级

本次只读子任务已完成，READINESS作为历史原报告保留；后续接手须先读DESIGN最终“D-01..D-07 ACK与未闭合边界”及ACCEPTANCE收紧条款，不以原报告所有建议都已采纳。当前方案锁定不新增wire union：ps_内部合法origin映射+原ReviewPackage Ref；review.read完整三元组project_id/run_id/package_id。SOURCE_ONLY是terminal_reason而非job kind。QC前持久encode事实与qc gate真实接受producer待MAIN裁决；现有ReviewPackage.kind没有qc，禁止虚构qc包或自动将技术QC全pass当gate accepted。receipt不能代替DB ready/授权，manifest publication winner attempt与encode/QC lineage分别核对。此更新仍不授权代码或测试。


## D08–D12收敛：下一实施者不可自行选择的边界

本次更新仍仅文档，不开启实施。后续有MAIN正式ReleaseAssignment才执行：读MAIN 02 D08-D12→本DESIGN最终段→TASK最终任务矩阵→ACCEPTANCE M11-M15。固定方案是原wire change.prepare/apply→CreatedSourceChangeService，完整preimage以snapshotIdFor构造预期target，prepare不登记snapshot；created提交由同Coordinator/RevisionStore typed分支完成，绝不造migration_id调旧commitAdoption。原review.decide和兼容change.approve共享批准权威，自动/Agent apply并发只能+1。

MEDIA仅实现PhaseMediaPort encode/inspect/publish和纯receipt，首批候选文件准确为src/host/render/ports.ts、src/host/render/render-snapshot.ts、src/host/delivery/published-package-store.ts、tests/agent-driven/media/render-snapshot.test.ts；最终以MAIN release为准。BRIDGE独占DDL、Job/lease、created_render_evidence/created_delivery_phase_fact、FixedPhaseExecutor及持久ports，QC和publish属于同delivery Job与CP attempt，不新增TaskPrepare.kind/Job kind。QC证据由BRIDGE登记pending门；只有工作台人类通过绑定真实QC包的原review.decide才可accepted，MEDIA和执行器均不自签；hard block/未处置warn不得发布。

编码事实先于QC且不能要求QC字段；完整immutable对象fsync后才由BRIDGE记原Job事实，finally不能删除已移交对象。恢复按事实与hash继续、逐次核授权，publish receipt不等于DB ready；manifest publication winner与encode/QC lineage分别核对。目标checkout先corepack pnpm --version=10.33.0及Node>=22.15.0，无安装权限；旧只读报告工具链不是当前满足证明。缺MAIN精确集中白名单/共同SHA只停开工门，不猜新core路径。全部旧NOT_RUN和独立审查边界保留。


## 最终owner与安全收口

严格禁止读取任何模型/Agent配置文件或凭据、dump全量env、复制含凭据工具日志、修改/轮换凭据；核实模型只用会话自报，无自报则UNKNOWN。不得因检查供应商而打开配置，前文非敏感元信息不授权配置读取。

03_OWNERSHIP_AND_DEPENDENCIES.json已落盘且是精确分工权威；先读TASK最终名单，不再沿用早期“03缺失/首批仅四文件/dirty processor归MAIN永不移交”的历史限制。MEDIA阶段实现位于指定新committed-render-phases.ts，准备预览位于preview-prepared-source.ts；两个对应测试亦已命名。BRIDGE独占review-media-http.ts、DDL及持久ports；MEDIA提供只读已证FD能力并负责所有关闭路径。附属公开面为5 HTTP+1 MCP resource，不能继续报4条。

D08-D12已完成领域设计ACK，无新增MEDIA语义待定，不将尚未实现/尚未正式release/产品NOT_RUN再次列为文档阻塞；执行仍按MAIN已定分工和阶段授权，不擅自提前开工。本次无新子任务授权，不自启helper。


## D01–D15最终ACK（最高优先解释）

先读MAIN D13-D15及本DESIGN末节，再读旧readiness；旧报告未重审最新方案，引用闭环见DESIGN，不可把其旧建议当当前合同。新事实全用created_*，保持原cp_a0精确fingerprint；成功SOURCE_ONLY Job无live lease，MEDIA新增只读proveForAdoption绑定当前采用transaction/impact/批准与文件FD，不能重新claim成功Job或复制TaskLease proof。

编码对象必须immutable/fsync且同原Job事务登记EncodedFact后才QC；证据phase主键按D14。QC技术pass不授发布：真实最终chapter_pack包加created_review_gate_fact绑定qc门，人类通过原review.decide一次确认、当前warn逐项处置同事务落盘，block不可接受。BRIDGE/guard/MEDIA均不自签accepted。待审同delivery Job回queued释放lease且过滤claim；接受后同Job新lease、原CP execution attempt继续package，不增第二QC Job。manifest/receipt winner attempt一致，encode producer独立记录并核媒体hash；DB ready和包receipt双重一致。

这些语义已设计ACK，不再列作待实现者猜测事项；仍不授权本轮编码/测试。精确owner从03读取，MEDIA不写DDL/持久ports；不得读取配置/凭据、dump全env、复制敏感日志或修改/轮换凭据，模型仅会话自报。
