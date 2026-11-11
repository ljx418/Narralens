# MEDIA任务书与HANDOFF

> 当前执行设计以本文末尾“D01–D15最终ACK”及集中03名单为准，覆盖此前待裁决/历史备选措辞；这是设计任务包，不是实现release。

状态 DESIGN_REVIEW_PENDING / IMPLEMENTATION_NOT_RELEASED；本轮只到开发启动门。主任务task_cb34e517149a；领域Codex handle term_d6cb9559-1366-4b42-849a-3ee926ccc58b，归MAIN term_a731c232-35c7-4f55-a75d-9b2beeade398管理。Claude只读检查另记实际receipt，不把计划写成运行中。

## 基线和唯一writer

主源码 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` HEAD `838ba5f2c8500f0103f56dbe51264ea9f70086fc`；canonical `/mnt/c/workspace/videoworkline/Narralens` HEAD `ca5b67a8285b130c79055317c6202f73cfbb99c8`。原合同文档commit `f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450`，cp-a0-r4四hash见DESIGN；fixed OpenFilm `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。旧MEDIA候选 `7439c0a9f3541c2d7345c2105dea3249e4cd725e` 只是历史，不作为本轮共同base。

本轮主控归档 `../baseline-observed.json`，MAIN dirty 25个文件摘要均与现场一致（含未提交processor/verifier/测试与证据）；完整清单在该归档，设计核心输入hash见DESIGN。不只git diff，还核untracked；开始实现前重新git rev-parse HEAD、git status --short及逐文件SHA256，diff归档，由MAIN绑定release。任何漂移不覆盖、不stash/reset/cherry-pick/rebase，不替换项目，不复制运行根。不存在“HEAD相同所以dirty可丢”。

当前文档writer=MEDIA Codex，仅此目录DESIGN.md、ACCEPTANCE.md、TASK.md、CLAUDE_PROMPT.md。本轮Claude writer只对CLAUDE_READINESS.md有效；Claude期间Codex停止文档写入，收件后再恢复分时修订。MAIN产品代码writer不转移。本轮禁止所有src/tests/tools/package/lock/config/AGENTS、其他领域文件、Git index/branch及运行目录修改；禁止测试/build/install/render/启动Host/模型、付费、新外传、J盘、提交/合并/push。

## 按完整用户路径的票据（非新的实现授权）

|票据/原IT映射|交付与依赖|启动分类|
|---|---|---|
|A-MEDIA-1 / IT-A03,A04,A05|保全并复核既有processor/verifier/assembler；完善stage闭包、元数据、资源释放及恢复验证；真实registry/授权run由BRIDGE/MAIN装配，形成可预览native source且不提交|现有私有合同的模块补强设计可立即实施候选，仍须MAIN独占release；生产preview依CP-01/许可引用/阶段门|
|A-MEDIA-2 / IT-A05|prepared引用→工作台review→合法created采用→snapshot source_fact→native ack；所有跨领域字段与变更不变断言|依MAIN裁决CP-01/02与PRODUCT review/ack；MEDIA不实现公共Coordinator/DDL，MAIN可独占释放给BRIDGE Claude|
|A-MEDIA-3 / IT-A01,A05,A06|committed SnapshotRead、真实render/QC/package+持久fence/commit/record/download；关服重开改单镜两正式导出、T20、中文证据|模块回归设计可立即；生产执行依CP-03/MAIN运行授权、重型槽、A-MEDIA-2及真人素材；人验前不入B|

“立即”指没有新公共契约依赖的候选，不表示本轮开工。首批可独立补强范围优先：现存native-draft真实输入一致性/异常关闭、QC完整decode和下载关闭回归、源digest资源错误语义；不得为了产出代码重写已通过模块。无确定缺陷时先核对/补必要验证，不造改动。

## 下一实现release精确候选白名单（尚未生效）

由MAIN选择其中具体文件独占授权，不是整个目录通行证：

- MEDIA模块：`src/host/render/native-draft-assembler.ts`、`src/host/render/native-draft-plan.ts`、`src/host/render/native-draft-io.ts`、`src/host/render/assembly-ports.ts`、`src/host/render/render-snapshot.ts`、`src/host/render/native-renderer.ts`、`src/host/render/ports.ts`、`src/host/delivery/qc.ts`、`src/host/delivery/download.ts`、`src/host/delivery/delivery-service.ts`、`src/host/delivery/published-package-store.ts`。
- 关联验证：`tests/agent-driven/media/native-draft.test.ts`、`tests/agent-driven/media/native-draft-real-render.test.ts`、`tests/agent-driven/media/native-renderer.test.ts`、`tests/agent-driven/media/render-snapshot.test.ts`、`tests/agent-driven/media/qc.test.ts`、`tests/agent-driven/media/download.test.ts`、`tests/agent-driven/media/delivery-service.test.ts`、`tests/agent-driven/media/published-package-store.test.ts`。
- 保持MAIN独占、MEDIA只读/提案：`src/host/agent-driven/created-draft-processor.ts`、`prepared-draft-verifier.ts`、`created-task-store.ts`、`created-task-gate.ts`、`created-task-worker.ts`、`creation-application.ts`、`local-asset-registry.ts`、`committed-snapshot-authority.ts`；`src/host/engine/source-digest-v1.ts`；所有contracts、server、projects、adoption、impact、materialize、DDL/鉴权/配置/原native adapter。需改上述任何文件由MAIN给独占writer及exact名单，不凭本表授权。新增测试/工具文件也须在release列准确名称。

## 阶段交付、资源、停止和回退

D0本轮：四文档+Claude只读readiness+MAIN合同裁决，测试全NOT_RUN。D1后续release：模块差异/开发自验证C1..C5；D2生产组合：真实入口、review/采用/ack/正式导出；D3阶段：两主题真实影片、双导出/T20/统一回归/独立复核，MAIN中文HTML与人工入口。阶段依完整用户路径合并审核，不逐细函数要求用户重审。

运行资源：本轮只读+文档；未来ffmpeg/Chromium/全量/多Host为全机重型单槽，先MAIN预约，默认headless静音；不自行提升vitest并发。记录node/pnpm/ffmpeg/ffprobe/Chromium可用版本及真实vendor路径，缺依赖汇报，不自动安装。依赖供应和素材许可未知如实UNKNOWN。

停止：无MAIN正式release、输入hash漂移、跨白名单、合同未裁决、缺合法素材/授权、共享资源无法确认、原writer未停止、取消/未知子进程不能对账、失败超两轮需MAIN根因接管。429只在已释放实施范围且确认旧调用/子进程停止后可移交Codex；本轮不能借429转为编码。回退：停止新dispatch/隐藏未就绪能力，保留已提交snapshots/receipt/DB/历史证据；仅清本次确属私有未发布staging；内容回退经受控新revision，不覆盖源或撤销用户dirty。文档回退只由本writer在允许四文件修正。

## HANDOFF模板（交接必须填写，当前不伪填）

1. ticket/path；owner/writer/接手原因与原writer停止证据。
2. full base/HEAD/合同hash/dirty overlay；输入与所有变更文件bytes/SHA256。
3. actual commands/cwd/start/end/exit/log hash；资源槽、PID+start/归属/存活状态。
4. case逐项PASS/FAIL/BLOCKED/NOT_RUN及证据范围；不可用部分与未闭合合同。
5. 输出snapshot/source/receipt/manifest/ref/hash；producer-consumer字段核对；回退和未完成项。
6. 自验证/领域复核/独立审查/人验分开；当前全部产品验收NOT_RUN。

Claude启动信息待实际Orca receipt；完成前不能向MAIN发送本任务worker_done，子任务settled后汇总真实dispatch/handle/状态。启动后结束当前turn等待Orca唤醒，不poll、不自建PTY、不重复fresh启动。


### MAIN增量与启动恢复记录

优先公共方案：内部prepared-source@1+ps_合法origin映射，原Job result_ref返回ReviewPackage Ref；80defs/31routes保持，最终以MAIN裁决为准。A-MEDIA-3新增分阶段encode/QC事实与授权publish步骤提取；新内部持久事实/DDL与Job绑定由MAIN/BRIDGE独占，MEDIA只在精确释放render-snapshot.ts/ports.ts等模块范围实现，不能在chapters用整体facade发布交付。详细字段/恢复见DESIGN末节，M09/M10验收覆盖。

首次Claude启动在CLI读取spec-file阶段ENOENT：Windows进程将WSL路径误解为C:\mnt\c；未返回Task/Dispatch，也未创建MEDIA Claude worker（已读worker-list核实）。已读实时recovery guide；下一次仅修正本机文件映射为C:\workSpace\videoWorkLine\Narralens\docs\execution\A\relaunch-20261111\media\CLAUDE_PROMPT.md，属于未dispatch的参数纠正，不重试已有worker。若出现正式dispatch失败则严格同task/--retry-of恢复，不fresh启动。


### 已完成HANDOFF与当前开工门

Claude child task `task_2594e5bbcaa2` / dispatch `ctx_14a7ed7e66e3` / handle `term_37251bd1-b0d6-4846-9a8f-28fd5aafb376`，实际terminal模式、keep-open；已收到worker_done outcome=succeeded（只读任务完成），报告CLAUDE_READINESS.md，verdict READY_WITH_BLOCKERS。会话显示MiniMax-M3.1-Flash-Preview[1m]，仅显示层match YES，无读取凭据。Claude只写此报告；结束后文档writer转回MEDIA Codex，未移交产品代码writer。

四文档已补D01..D07领域ACK，D02合法内部ps_映射与D03原ReviewPackage Ref为唯一当前方向，新增wire union仅历史不采用备选。已落实具体SOURCE_ONLY持久字段、三公共consumer清单、receipt与DB双重权威、manifest/publication与encode lineage、M09/M10正负断言、真实资源范围；未闭合D05 QC前持久fact与qc gate合法生产/接受路径由MAIN裁决。特别ReviewPackage.kind没有qc，不能照Claude建议直接声称现review.decide支持该包。

立即可进入后续正式release的候选仍为A-MEDIA-1现有私有模块验证/必要补强、已有QC/下载/取消模块局部回归；不因待素材阻塞这些软件设计。A-MEDIA-2依D02/D04公共producer与单事务扩展，A-MEDIA-3依D05事实与授权门冻结；现有render facade行为等价步骤提取仅可在MAIN精确释放后实施。所有产品执行NOT_RUN，无新共同commit可预填，无当前实现release。


## D08–D12收敛：本次完整任务包

本次worker task `task_32cef3d52638` / dispatch `ctx_7783e7fc1fa3`，不再沿用上轮已完成dispatch；仅四文档修订，无子agent/产品执行。D08-D12已设计ACK，前轮新增wire/QC独立Job/MEDIA持久写均排除；MAIN原25项dirty再次hash一致。

|包|准确交付与接口消费者|唯一writer/文件边界|依赖与交接|
|---|---|---|---|
|A-MEDIA-1 / A03,A04,A05|既有assembler/verifier真实闭包与注册事实、纯preview支撑；D02 ps_映射仅消费真实proof|MEDIA仍只按先前exact模块白名单；MAIN dirty processor/verifier非本包可写|BRIDGE完成映射/parts authority与run装配；原候选保全，不重写|
|A-MEDIA-2 / A05|MEDIA提供prepared roots/files/plan/rights/原生facts；D08 CreatedSourceChangeService构造完整D09 impact；D10 typed提交|BRIDGE core独占D08命名新service/store/facts、CreatedSourcePublisher及RevisionStore扩展，MEDIA不改这些；PRODUCT review/ack|唯一Coordinator+旧M3分流+真实source_fact；MAIN先合同/白名单后实施；不得假migration_id|
|A-MEDIA-3a / A06模块|在`src/host/render/ports.ts`定义DESIGN末节PhaseMediaPort/receipts，在`src/host/render/render-snapshot.ts`抽取encode/inspect/publish、旧facade兼容；`src/host/delivery/published-package-store.ts`提供已fsync私有中间对象移交/真实publish receipt；`tests/agent-driven/media/render-snapshot.test.ts`检验分段与原facade|MEDIA唯一模块writer，4个生产/测试精确文件为本次优先候选；其余先前白名单文件仅有明确缺陷和MAIN release才触碰|类型交BRIDGE共同编译；纯媒体不写DDL、gate、Job、ready；没有新生产接口注册|
|A-MEDIA-3b / A01,A06组合|D11 FixedPhaseExecutor同delivery Job/CP attempt，QC/publish不可变事实及业务键去重、DB ready/ports与恢复|BRIDGE core独占所有DDL/持久ports/phase executor；新增准确测试`tests/agent-driven/integration/created-render-delivery.test.ts`、`tests/agent-driven/integration/created-delivery-recovery.test.ts`|消费3a纯receipt；resume逐门复验；媒体对象与DB双重权威；MAIN重型槽、真人素材后M05/M06/T20|

3a的“4个文件”具体是ports.ts、render-snapshot.ts、published-package-store.ts、render-snapshot.test.ts；没有默认允许新目录/测试文件。BRIDGE新core文件相对src/host/agent-driven的最终实际位置须MAIN集中release精确列出，不能MEDIA猜位置并创建；设计实体与唯一owner已锁，不留实现者任选。当前集中`03_OWNERSHIP_AND_DEPENDENCIES.json`尚未可读，仍须MAIN落正式exact名单、共同fullSHA+overlay处理与工具链后开工。

执行顺序：R0当前字节复核冻结→BRIDGE typed契约/DDL与MEDIA3a类型同步→MEDIA私有步骤实现及必要模块自验→BRIDGE3b实际Host消费与同Job恢复→PRODUCT真实review/nativeAck联调→MAIN两主题60–180秒真实中文人声双导出/T20/独立审查。中途技术QC已完成不代表允许先发布；等待可信处置不长期占媒体worker。所有测试命令在ACCEPTANCE，当前一律NOT_RUN；没有本轮代码release。启动检查既有Claude已settled，不为本次文档另启窗口。


## 最终owner与安全收口

已读取03_OWNERSHIP_AND_DEPENDENCIES.json，SHA256 `3a45a799b3d9ee7aabd7dc7922d2d1db6f78979ebc8c454f339cedfd1c6e1261`；精确owner现已分配，前文“03尚不存在”“只限四个模块”“processor/verifier/source-digest永远MAIN独占”均为历史观察，不再构成当前文档阻塞。集中名单优先：MEDIA Claude的设计分工为以下准确文件，dirty输入仍必须保全；共享core/DDL/持久ports与HTTP由BRIDGE Claude独占，不越界双写。

- `src/host/agent-driven/created-draft-processor.ts`
- `src/host/agent-driven/prepared-draft-verifier.ts`
- `src/host/engine/source-digest-v1.ts`
- `src/host/render/native-draft-assembler.ts`
- `src/host/render/native-draft-plan.ts`
- `src/host/render/native-draft-io.ts`
- `src/host/render/assembly-ports.ts`
- `src/host/render/render-snapshot.ts`
- `src/host/render/ports.ts`
- `src/host/render/native-renderer.ts`
- `src/host/render/preview-prepared-source.ts`（指定新文件）
- `src/host/render/committed-render-phases.ts`（指定新文件）
- `src/host/delivery/qc.ts`
- `src/host/delivery/download.ts`
- `src/host/delivery/delivery-service.ts`
- `src/host/delivery/published-package-store.ts`
- `tests/agent-driven/integration/created-draft-processor.test.ts`
- `tests/agent-driven/integration/source-digest-resource-boundary.test.ts`
- `tests/agent-driven/media/native-draft.test.ts`
- `tests/agent-driven/media/native-draft-real-render.test.ts`
- `tests/agent-driven/media/native-renderer.test.ts`
- `tests/agent-driven/media/render-snapshot.test.ts`
- `tests/agent-driven/media/qc.test.ts`
- `tests/agent-driven/media/download.test.ts`
- `tests/agent-driven/media/delivery-service.test.ts`
- `tests/agent-driven/media/published-package-store.test.ts`
- `tests/agent-driven/media/committed-render-phases.test.ts`（指定新文件）
- `tests/agent-driven/media/preview-prepared-source.test.ts`（指定新文件）

新的preview-prepared-source.ts负责准备态隔离预览及只读已证媒体；committed-render-phases.ts承载PhaseMediaPort实现，render-snapshot.ts保留默认facade兼容；对应新测试文件已列明。不再要求实施者自行选择新文件位置。MEDIA所分配created-draft-processor.ts/prepared-draft-verifier.ts/source-digest-v1.ts只在后续正式release范围接手，保全当前dirty，不从旧lane覆盖。

本次task_de704c4f3f90仅文档收口，未启子Claude。所有会话禁止读取任何模型/Agent配置、凭据或全量env，禁止复制含凭据工具日志，禁止修改/轮换凭据；模型仅引用会话自报。未实现、未释放、尚未人验不再被报告为本轮文档语义阻塞，仍如实保留产品NOT_RUN。

当前MEDIA语义核对结论：D08-D12及D03媒体只读transport无新增未闭合反例；精确owner已落实，原QC前锚点/同delivery Job/gate事实producer/typed采用边界已在DESIGN给出唯一解释与反例。后续编码和验证按原R0..R4推进，是执行阶段工作而非文档待定问题。


## D01–D15最终ACK

本次task_c2ad980260de / dispatch ctx_2f9a95868c44只闭环四文档，无新Claude任务。已核03包含MEDIA prepared-draft-verifier.ts/committed-render-phases.ts及BRIDGE created-qc-review.test.ts等准确owner，D01-D15设计ACK，无新增阻断反例。

A-MEDIA-1/2新增明确交付：prepared-draft-verifier.ts只读proveForAdoption，从完成事实重建事务绑定FD proof，不重claim成功Job；对应修改已有created-draft-processor.test.ts验证正负proof和关闭。BRIDGE消费该proof完成typed采用、所有新事实表用created_*，精确DDL/持久ports仍BRIDGE独占。

A-MEDIA-3最终顺序：EncodedFact对象fsync并同原Job登记→真实QC evidence→真实QC chapter_pack加private gate binding→pending qc gate/同delivery Job queued释放lease→人类原review.decide接受及warn处置原子记录→同Job新lease续package→receipt+DB ready一致。此前由执行器根据技术证据直接accepted的解释已撤回，不能作为实现要求。PRODUCT按qc gate展示“交付质量确认”，不改wire kind。

Claude readiness引用只保留历史事实：原报告未重跑/未重审D13-D15，5项问题已由本领域对最新裁决核对形成文档闭环，具体映射见DESIGN；不改其原报告，不称独立审查通过。未实现/未释放/真实素材未到不是本轮文档语义阻塞。下步按既定授权阶段执行，产品测试仍全NOT_RUN。
