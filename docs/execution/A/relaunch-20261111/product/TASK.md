# PRODUCT A TASK / HANDOFF

任务 task_8c641136f2f9；领域 Codex handle=term_cbb662e5-3041-44b3-bb26-aac1213e1695；MAIN=term_a731c232-35c7-4f55-a75d-9b2beeade398。
当前 writer=PRODUCT Codex（仅四份文档）；代码 writer=NONE（暂停保全）。本轮授权仅准备+可见 Claude 只读检查，不是实现恢复。CLAUDE_READINESS.md 唯一由子Claude写，领域四文档只由Codex写，分时交接；代码/索引/工作树不动。

## 完整输入与 dirty overlay

MAIN 838ba5f2c8500f0103f56dbe51264ea9f70086fc；PRODUCT 07399c230023591b84fa2872b45b2a8b58b286f4；013 freeze 37ed5c7800d7e32818cdc75dfa8b915467d11a48；015 freeze 07399c230023591b84fa2872b45b2a8b58b286f4；合同文档 f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450。具体文件hash在 DESIGN。
MAIN 主控 baseline-observed.json 归档 main-integration 25 dirty files，archive sha256=6efbb7963258d50cec2cd537d24f0cfb91b3b00cef368d63e7142899d94ae94e。本轮读取 git status 与逐文件hash，对保全记录作只读核对：

|dirty文件|归档SHA256|当前SHA256|一致|
|---|---|---|---|
|docs/execution/A/candidates/prepared-draft-verifier/HANDOFF.md|7e37bd0cd5b75a732017ff9a03513d1c704a73a88c46289e6728e7ee4b425e79|7e37bd0cd5b75a732017ff9a03513d1c704a73a88c46289e6728e7ee4b425e79|True|
|docs/execution/A/candidates/prepared-draft-verifier/candidate-manifest.json|4a3c19f400c728a1a898e7d8e901967aeae8f6923c05f684abb22ce65cd73ecd|4a3c19f400c728a1a898e7d8e901967aeae8f6923c05f684abb22ce65cd73ecd|True|
|docs/execution/A/candidates/prepared-draft-verifier/candidate.patch|8e700a8898b4859d449284872d06c02c265d701ce98511ca1a4acd168137c5aa|8e700a8898b4859d449284872d06c02c265d701ce98511ca1a4acd168137c5aa|True|
|docs/execution/A/logs/created-draft-chain/credential-scan-final.json|9e3be0c4ec4fce5a34edbbec1830d5c28270acb147fd93841b9373b8d74bca60|9e3be0c4ec4fce5a34edbbec1830d5c28270acb147fd93841b9373b8d74bca60|True|
|docs/execution/A/logs/created-draft-chain/credential-scan.json|6d18b5df3710aec4c2afa65faa1de2eb4492cbc30aad345c4a1fa27da25b305a|6d18b5df3710aec4c2afa65faa1de2eb4492cbc30aad345c4a1fa27da25b305a|True|
|docs/execution/A/logs/draft-processor-real-1794277917161/film.html|1ec8a5ee0d98ce3a61d0a65a234ec25d1f159853c547c9f522c3fe0b265d1c7c|1ec8a5ee0d98ce3a61d0a65a234ec25d1f159853c547c9f522c3fe0b265d1c7c|True|
|docs/execution/A/logs/draft-processor-real-1794277917161/observed.json|a2b5c319d3c95c46e59d7eeb52458bc42a6781202ebc36c83a97eabcf552ea61|a2b5c319d3c95c46e59d7eeb52458bc42a6781202ebc36c83a97eabcf552ea61|True|
|docs/execution/A/logs/draft-processor-real-1794278226017/film.html|1ec8a5ee0d98ce3a61d0a65a234ec25d1f159853c547c9f522c3fe0b265d1c7c|1ec8a5ee0d98ce3a61d0a65a234ec25d1f159853c547c9f522c3fe0b265d1c7c|True|
|docs/execution/A/logs/draft-processor-real-1794278226017/observed.json|7bffd9d74515281c3530f15191531cf3a904edada978f5306a1faecf6e8e0d32|7bffd9d74515281c3530f15191531cf3a904edada978f5306a1faecf6e8e0d32|True|
|docs/execution/A/reviews/draft-processor-pre-review/REVIEW.md|d02735fdf0daa2656d94e93d78977c8b0fe421f0e44b1735944dc51910017508|d02735fdf0daa2656d94e93d78977c8b0fe421f0e44b1735944dc51910017508|True|
|docs/execution/A/reviews/draft-processor-pre-review/closure-input-hashes.json|d31a3568e24c9885510346ace7f81cd24a86ab419842c7d1d2693f8db547f407|d31a3568e24c9885510346ace7f81cd24a86ab419842c7d1d2693f8db547f407|True|
|docs/execution/A/reviews/draft-processor-pre-review/input-hashes.json|0b42130206d69a9538b6206f8367be81835bdc7a6eaae1ff9d0efe3aa8eb524c|0b42130206d69a9538b6206f8367be81835bdc7a6eaae1ff9d0efe3aa8eb524c|True|
|src/host/agent-driven/created-draft-processor.ts|6727b0b64bc07cfdea0346e7f885d0ffcbd74832a66f939056735c66872eeef5|6727b0b64bc07cfdea0346e7f885d0ffcbd74832a66f939056735c66872eeef5|True|
|src/host/agent-driven/created-task-gate.ts|1a65d8f3e9950847decdea2478a2d8542bb33d5018119282c18144c2694a8860|1a65d8f3e9950847decdea2478a2d8542bb33d5018119282c18144c2694a8860|True|
|src/host/agent-driven/created-task-store.ts|d7a4734cc9ed5924b7088a4cfaebecdd2ff202c373a9621c21078908f10e7b14|d7a4734cc9ed5924b7088a4cfaebecdd2ff202c373a9621c21078908f10e7b14|True|
|src/host/agent-driven/created-task-worker.ts|41a7658520d68a90be976690a9c27311f4be47a4a58776686e950ce3a563d4c4|41a7658520d68a90be976690a9c27311f4be47a4a58776686e950ce3a563d4c4|True|
|src/host/agent-driven/local-asset-registry.ts|84ce639583427de6adfbf4dab892b9a77fd888de1c5f005d824d22bc3aca2e92|84ce639583427de6adfbf4dab892b9a77fd888de1c5f005d824d22bc3aca2e92|True|
|src/host/agent-driven/prepared-draft-verifier.ts|ffefbd4169dfd07930723e2606997845fc1bc4a1aa9d0f6b60b7bfd6eb5276db|ffefbd4169dfd07930723e2606997845fc1bc4a1aa9d0f6b60b7bfd6eb5276db|True|
|src/host/engine/source-digest-v1.ts|d32dfc433865865749efd5e5f44f00eceff27b93d7607603c5eb9233708c599d|d32dfc433865865749efd5e5f44f00eceff27b93d7607603c5eb9233708c599d|True|
|src/host/render/native-draft-assembler.ts|1b8a6bc403053091e74a3357815b35fddc3d9fb71aa5e8448782f66feb58877e|1b8a6bc403053091e74a3357815b35fddc3d9fb71aa5e8448782f66feb58877e|True|
|tests/agent-driven/integration/created-draft-processor.test.ts|a1df47e95f6bb7a8e7825ced877a9a03d74bfe5b899b131821e99c164f7bb3ec|a1df47e95f6bb7a8e7825ced877a9a03d74bfe5b899b131821e99c164f7bb3ec|True|
|tests/agent-driven/integration/created-task-gate.test.ts|238050e8eb0aa88c7badebe22ea639c7b88ba8e04c01b350af7b35f302e25aa3|238050e8eb0aa88c7badebe22ea639c7b88ba8e04c01b350af7b35f302e25aa3|True|
|tests/agent-driven/integration/created-task-store.test.ts|1c262f7c87979935c99f63a3aa6ab649f8c91d7af8c07d17b6e1b985943ca002|1c262f7c87979935c99f63a3aa6ab649f8c91d7af8c07d17b6e1b985943ca002|True|
|tests/agent-driven/integration/created-task-worker.test.ts|a3589079d3f53f9286947e194349c356e25118cde60f687171686ef0f7e0159e|a3589079d3f53f9286947e194349c356e25118cde60f687171686ef0f7e0159e|True|
|tests/agent-driven/integration/source-digest-resource-boundary.test.ts|b6aa70b3fde614a30a43dbe0505c39d6dec1cae2e90c2c5eabbf6fac073c3ed5|b6aa70b3fde614a30a43dbe0505c39d6dec1cae2e90c2c5eabbf6fac073c3ed5|True|

实施前重新 `git rev-parse HEAD`、`git status --short`、按归档hash逐文件核对；发现漂移报告MAIN，由MAIN重新发完整基线/overlay manifest，不基于旧lane覆盖MAIN。无 reset/stash/cherry-pick/rebase，不提交/合并/push。旧候选源码/产物均只读。

## 按用户路径的任务包（不增加逐模块人验）

|ticket|现有映射|交付与依赖|可实施分类|
|---|---|---|---|
|P-A1 内容→真实样片/首章|IT-A03/A04/A05，支持A02|复用CreativeService/FixedWorkflowService和审阅组件；完成包读取、同一决定、定位原player、stale/错误UI；依MAIN facts/adoption/route与MEDIA五类真实预览|立即可准备的组件适配与负向case；实际接线依RP-P1/P2和MAIN发布|
|P-A2 审阅→受控采用→原生加载|IT-A05，依A01/A03/A04|Bar/非模态系统/NativeSync接入，013/015同源集成；Host独立expected、trusted session、全parts/commit重查由MAIN；BRIDGE可信传输|纯组件状态/焦点回归可先实施（仍须release）；Ack生产/采用依RP-P2/P4|
|P-A3 原编辑改单镜→重开双导出|IT-A05/A06，依A01|原selection/clock定位、改单镜、两个正式导出状态/入口/重开指引，保留原M5；MEDIA正式snapshot/QC/manifest；MAIN恢复/统一验证|依P-A2及RP-P3，真实素材/录音/资源释放后实施；不承诺B下载/TTS/模型/DAG|

“立即可实施”指 MAIN 审定并正式 release 后无新业务合同即可开始的纯 UI/现有类型负向检查，不是本轮可写代码。三个完整路径共同审定，不把每个细组件变成人工审批点。

## 文件白名单与禁止路径

本轮 Codex 精确白名单（canonical docs/execution/A/relaunch-20261111/product/）：DESIGN.md、ACCEPTANCE.md、TASK.md、CLAUDE_PROMPT.md。Claude 只写同目录 CLAUDE_READINESS.md。没有其他写路径，包括不另写 HANDOFF/spec 临时文件；本TASK内HANDOFF为唯一交接记录，CLAUDE_PROMPT.md同时作spec文件。

后续实现建议白名单（提案、尚未释放；相对 MAIN 发布的目标 worktree）：src/app/observation/WorkflowTopBar.tsx、CreativeReviewPanel.tsx、content-views.tsx、observation.css、index.ts；src/app/system/SystemControlPanel.tsx、system.css、index.ts；tests/agent-driven/product/observation-ui.test.tsx（service/guard测试按MAIN 03归BRIDGE，PRODUCT不得改）。如需新增adapter/test先让MAIN列出精确文件及owner，不能凭目录概括扩大。
必须MAIN独占分配：src/app/m5/M5Panel.tsx、GatewayApiClient.ts、panel.tsx、stores.ts、SelectionCoordinator.ts；src/app/main.tsx、owned-project-client.ts、workbench-session.ts；src/host/**（含creative现有逻辑）、src/contracts/**、contracts/**、tools/**、scripts/**、vendor/**、package.json/lock/config。所有其它领域/旧候选/用户dirty文件禁止写。013/015生产移植和expected真实facts装配不能由PRODUCT自行打patch到vendor。MAIN可明确将某共享文件单writer释放给Claude，不要求MAIN亲写，但不能口头推定。

## 阶段交付、资源、回退与停止

D0（本轮）：四文档、只读源码/hash证据、Claude readiness；业务测试NOT_RUN，停开发启动门。
D1（待MAIN设计/验收审核+ReleaseAssignment）：锁定完整base/合同/overlay/精确白名单；单writer Claude实施P-A1/P-A2可独立部分，开发自验证按ACCEPTANCE，保留首失败。
D2（依赖满足）：MAIN装配+MEDIA/BRIDGE组合；领域只读复核候选、冻结SHA，问题回原writer修复；领域复核不自签独立审查。
D3（A末MAIN）：同一冻结SHA全量/真实60–180秒/双导出/T20/独立复核/中文HTML，人工入口停止；不进入B。

资源：D0只读shell，无业务进程；D1轻量测试按release，D2/3的build、多Host、ffmpeg/GPU/browser大fixture单槽由MAIN预约；无安装下载/付费/新外传/J盘。服务和var/dist/DB/profile不得共享可写根。当前不预占重型槽。
回退：文档修订保留事实与失败，不改历史Gate；以后代码由MAIN对已冻结候选安排向前修复或明确撤销自己的变更，先保存dirty证据，不reset/stash用户工作。UI依赖缺失降级unknown/blocked，不启假状态。采用/发布回退必须MAIN原事务/恢复协议，PRODUCT不得删DB/快照或手改源。
停止条件：HEAD/合同/hash漂移；无明确writer/白名单；缺独立expected、许可、真实录音、可信批准；旧native session/未知副作用；要求B能力；需修改公共合同或重型资源未释放。普通设计闭环由Codex修订，不无限问用户。429先确认旧writer/子进程已停并记录，再按已授权范围接管；本轮没有代码授权，429也不能借机实施。超过两次返工报MAIN接管根因。

## HANDOFF 与交付模板

Claude本轮输入=CLAUDE_PROMPT；输出=CLAUDE_READINESS（CLI/cwd/path/会话报告模型或UNKNOWN/依赖/缺项/阻塞/可接手结论），不输出密钥、不读凭据、不切模型。
正式开发交付模板：ticket与范围；base/contract/实现完整SHA；dirty manifest；唯一writer及停止证据；修改文件；真实调用/字段producer-consumer；逐case命令/exit/log/产物hash/失败与NOT_RUN；恢复/回退；剩余阻塞；下一writer。不代签独立/人验。
Claude启动回执由Orca提供；启动前状态NOT_STARTED，不先填伪Dispatch/handle。启动后按生命周期结束本轮等待唤醒；收到结果后记录真实身份并仅在四文档内闭环。所有helper settle后才向MAIN worker_done一次。


### 实际 Claude 启动与 MAIN 补充

首次spec-file使用WSL绝对路径被本机CLI误映射成C:\mnt\c\...，ENOENT发生在读spec阶段；worker-list与run task-list确认未产生PRODUCT Claude Task/Dispatch。读取实时recovery/full guide后，仅修正为现有文件Windows路径，没有重复已有Task或fresh启动失败实例。成功回执：Task task_8e0380980def，Dispatch ctx_291a3c63fe4f，handle term_15069fcf-7f1f-46cc-be33-225cf860c4f2，agent=claude，mode=terminal，state=ready，keptOpen=true，Run run_20296ffbad2e，workspace=90974dd7-625f-46bf-a442-37f7cbadac25::C:\workSpace\videoWorkLine。模型仍待会话自报，不能由CLI名判MiniMax。

MAIN新增02/05草案已读，新增RP-P2a/P2b/P1a/P4a见DESIGN；已通过Orca消息msg_b3c3fa279f51告知Claude补读。当前等待readiness，未发送本任务worker_done，未宣称开发已释放。


### P-A1 素材输入闭环补充

收到MAIN msg_ffc4f450b981：P-A1增加创建后可信UI选配置sourceRoot内相对文件→来源/许可/录音声明→Host登记→Agent只读inventory，不要求用户复制asset_id；映射IT-A04/A05，依MAIN RP-P5附属UI transport/inventory合同与MEDIA真实素材事实。本轮仅设计；未来纯组件提案精确文件为src/app/observation/LocalAssetRegistrationPanel.tsx及tests/agent-driven/product/local-asset-registration.test.tsx，两者当前未存在/未释放，需MAIN加入ReleaseAssignment才可写。共享Host目录/登记transport、inventory、M5挂载依MAIN独占指定路径，PRODUCT不得自行扩wire。ACCEPTANCE P13补现有local-assets-host回归和缺失真实入口harness；目录/登记流程纳入P-A1整条用户路径审定，不新增逐小模块人验。


### D-01..D-07 ACK与开工前置

PRODUCT已逐项设计ACK，具体依据/反例见DESIGN末表；D-04明确“决定/Approval已登记→采用pending→commit→NativeAck”四个事实，不能让现有decideReview的accepted gate/run running提前表示采用完成。D-03包Ref与readReview的一致性、D-06缺captions/style独立expected、D-01附属transport精确schema仍属实现依赖/必要测试。共同实施SHA未生成，D-07与资源/正式release仍必须先满足；没有把ACK写成实现释放或独立验收。


### MAIN D-08..12 接线/所有权对齐

已ACK D08..12，DESIGN新增精确RegistrationRequest/Inventory消费及状态映射，更新P13、采用/恢复/交付反例；当前共有原31+新增5HTTP/1resource的设计面（素材4+review-media 1），未生产注册。新CreatedSourceChangeService/impact/adoption/FixedPhaseExecutor及Host-only effect由MAIN指定BRIDGE Claude唯一共享core writer，PRODUCT只做公开DTO/UI与原Studio接线中明确释放部分；具体名单以MAIN 03_OWNERSHIP_AND_DEPENDENCIES.json未来release为准，不据设计ACK扩大当前白名单。子Claude须反馈自身工具链，不以别的PATH满足要求；安装与测试仍禁止。


## 最终 HANDOFF：只读子任务已完成，工程启动未释放

实际子任务task_8e0380980def / Dispatch ctx_291a3c63fe4f / handle term_15069fcf-7f1f-46cc-be33-225cf860c4f2，worker_done msg_e16b2bfd6802，outcome=succeeded（完成只读检查）；窗口keep-open保留，未另发新任务。原readiness结论BLOCKED，18项文档反馈已由本轮四文档闭环；N-1/B3依最新D08..12/03明确新消费分支与BRIDGE同批端口/注册责任，最终MAIN审核待完成；B5共同SHA/ReleaseAssignment/真实素材授权仍是实施前置，未伪造。领域完成文档准备不代表开发已释放。

模型：仅记录子会话自报MiniMax-M3.1-Flash-Preview[1m]，与MiniMax要求一致；凭据/账户/额度UNKNOWN。CLI=/home/administrator/.npm-global/bin/claude，cwd=/mnt/c/workSpace/videoWorkLine（canonical父工作区）。node v22.22.1；子PATH pnpm10.31.0不满足指定10.33.0；已有corepack0.34.6/10.33.0缓存是存在性证据，尚未实际运行corepack pnpm确认，实施前离线核实，禁止擅自安装。

### 实际违规事件（保留、不粉饰）

Claude自报为核对模型读取用户配置~/.claude/settings.json，一次grep使token字面值进入其工具输出，违反本任务禁止读取凭据/用户配置的明确约束；MAIN已知并指示其负责向用户披露。该值未被本领域复述到文档/消息，不读取或复制原配置，不自行轮换、不改变模型/凭据；后续窗口只能使用会话自报模型，无法确定即UNKNOWN。原CLAUDE_READINESS留作事件记录，其“未读凭据”总括不成立；不掩盖或将其作为合规通过。子任务已settled，不再派其读配置。本轮后续仅领域文档修订，产品代码与业务测试依旧禁止。

### 最新唯一owner表对齐（取代早期未来白名单提案）

以下是MAIN 03_OWNERSHIP_AND_DEPENDENCIES.json的product-Claude设计分配完整路径，尚未release；早期“所有Host只归MAIN”默认禁令，在未来正式release逐文件明确分配后可按此例外执行，当前一律只读：
- `src/app/observation/WorkflowTopBar.tsx`（已有）
- `src/app/observation/CreativeReviewPanel.tsx`（已有）
- `src/app/observation/NativeSyncIndicator.tsx`（拟新增、当前不存在）
- `src/app/observation/LocalAssetRegistrationPanel.tsx`（拟新增、当前不存在）
- `src/app/observation/content-views.tsx`（已有）
- `src/app/observation/observation.css`（已有）
- `src/app/observation/index.ts`（已有）
- `src/app/system/SystemControlPanel.tsx`（已有）
- `src/app/system/system.css`（已有）
- `src/app/system/index.ts`（已有）
- `src/app/m5/M5Panel.tsx`（已有）
- `src/app/m5/GatewayApiClient.ts`（已有）
- `src/app/m5/SelectionCoordinator.ts`（已有）
- `src/app/main.tsx`（已有）
- `src/app/owned-project-client.ts`（已有）
- `src/app/agent-workbench-client.ts`（拟新增、当前不存在）
- `src/host/m5/openfilm-studio-gateway.ts`（已有）
- `src/host/m5/native-observation.ts`（拟新增、当前不存在）
- `src/host/m5/openfilm-native-expected.ts`（拟新增、当前不存在）
- `src/host/m5/native-ack-store.ts`（拟新增、当前不存在）
- `src/host/m5/openfilm-studio-ui-pin.json`（拟新增、当前不存在）
- `tools/agent-driven/product/build-native-hydration.ts`（拟新增、当前不存在）
- `tests/agent-driven/product/observation-ui.test.tsx`（已有）
- `tests/agent-driven/product/local-asset-registration.test.tsx`（拟新增、当前不存在）
- `tests/agent-driven/integration/created-native-ack.test.ts`（拟新增、当前不存在）
- `tests/agent-driven/integration/created-workbench-review.test.ts`（拟新增、当前不存在）
- `tests/agent-driven/integration/created-workbench-headless.test.ts`（拟新增、当前不存在）

PRODUCT只承担这些被正式释放的Host native观察/expected/Ack实现，仍由MAIN审定合同/身份/事务/源码pin及集成；其他agent-driven核心、DDL、revision/coordinator与service测试不写。新增NativeSyncIndicator.tsx若从content-views抽取，必须维持一个实现与兼容export，不复制第二事实判断。本表源内容如更新，release前重核，不能直接照旧表写。新素材测试名称以MAIN local-asset-registration.test.tsx为准，撤销早期-ui命名提案。


## D13–D15最终补充交接（本任务task_e29d113e9db3 / ctx_41a1d75dec64）

本轮writer=PRODUCT Codex term_4e354ea5be44a7d8425cd66c0901ba5c，仅原四文档；未新派Claude、未读取配置/凭据、原事件保留。复用已settled子Claude事实反馈并按D13–15闭环，不要求它重开检查。最终设计ACK：新增内部表统一created_*；成功SOURCE_ONLY不需running lease，MEDIA重建adoption proof；encode/QC/publish各有不可变持久锚点；最终QC五项chapter_pack通过created_review_gate_fact定位qc门，仅可信review.decide接受，warn处置同决定、block不可覆盖。P-A3/P14覆盖此完整路径，不自动把章包接受视为QC。

03当前product-Claude UI+native Host精确列表与本TASK最后白名单逐项对齐；BRIDGE负责created-review-gate-store.ts、fixed-workflow-service/execution-guard/DDL及created-qc-review.test.ts、created-schema-upgrade.test.ts；MEDIA负责EncodedFact对象原语与proveForAdoption，PRODUCT不并写这些核心。PRODUCT继续按明确分配实现UI、Host native观察/expected/Ack，不因“Host”字样推回无人负责。新增created_*表的schema版本校验/升级由BRIDGE；原contracts/agent-driven-a.migration.sql也列永远保护，不能用新表破坏精确cp_a0 fingerprint。

未来次序：R0 MAIN产生共同可复现commit→正式release绑定其完整SHA/overlay/合同/精确文件/资源→R1组件与独立producer→R2审阅采用真实NativeAck→R3成片技术QC+可信人类质量确认+正式发布/重开二导出→A统一独立/人工验收。当前没有正式release本来就是本轮止点，不再把它循环列作文档阻塞，也绝不自行跨过。未解决真实素材授权仍为实施输入条件，不用假录音替代。当前四文档READY_FOR_MAIN_FINAL_REVIEW，非IMPLEMENTATION_RELEASED；所有产品验收NOT_RUN。
