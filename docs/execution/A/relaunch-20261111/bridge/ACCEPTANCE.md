# BRIDGE A 验收设计

所有case状态 NOT_RUN。本轮只读源码和设计，以下命令只在MAIN释放对应实现/验证后执行，不能作为本轮执行许可。领域复核是内部复核，不冒充独立大阶段验收。

## 已核查的真实命令入口

package.json scripts：test=`vitest run --config vitest.config.ts`；test:contracts=`vitest run --config vitest.config.ts tests/contracts`；build=`tsx tools/build-native-workbench-validators.ts --check && vite build && vite build --config vite.m5.config.ts`；start=`tsx src/host/start.ts`；check含tsc/全量vitest/python golden/双build。没有专门A测试script，禁止编造`test:a`。

所有命令 cwd=MAIN释放的实际worktree（当前源码读基线main-integration）；必须先完整SHA、dirty、hash校验且有隔离DB/var/staging/profile/端口。下列命令编号供每个case引用，不表示已执行：

- C1 `pnpm test tests/agent-driven/bridge --maxWorkers=1 --minWorkers=1`
- C2 `pnpm test tests/agent-driven/integration/created-task-store.test.ts tests/agent-driven/integration/created-task-gate.test.ts tests/agent-driven/integration/created-task-worker.test.ts --maxWorkers=1 --minWorkers=1`
- C3 `pnpm test tests/agent-driven/product/fixed-workflow-service.test.ts tests/agent-driven/integration/capability-fingerprint.test.ts tests/agent-driven/integration/scoped-auth.test.ts --maxWorkers=1 --minWorkers=1`
- C4 `pnpm test tests/agent-driven/integration/created-draft-processor.test.ts tests/agent-driven/integration/source-digest-resource-boundary.test.ts --maxWorkers=1 --minWorkers=1`
- C5 `pnpm test tests/agent-driven/integration/creative-context-host.test.ts tests/agent-driven/integration/host-application.test.ts tests/agent-driven/integration/host-close-lifecycle.test.ts tests/agent-driven/integration/durable-cursor.test.ts tests/agent-driven/integration/observation-cursor-ports.test.ts --maxWorkers=1 --minWorkers=1`
- C6 `pnpm test tests/agent-driven/integration/contract-freeze.test.ts tests/agent-driven/integration/agent-http-router.test.ts --maxWorkers=1 --minWorkers=1`
- C7 `node tools/agent-driven/bridge/probe-mcp.mjs --json` 只作真实stdio发现探针，不能证明业务执行；首端业务执行必须实际Codex客户端调用冻结registry工具并存脱敏请求/响应。
- C8 `pnpm exec tsc --noEmit`；C9 `pnpm run build`；C10 `pnpm run check`（重型全机预约，仅MAIN）。

C2..C5现有测试是回归底座，新增生产装配断言须在TASK指定测试文件内补齐；它们当前不能证明下表尚未接线的场景。真实Host启动命令为`pnpm run start`，只能在MAIN明确释放验证且确认start.ts读取的隔离配置后执行；本轮不启动、不安装、不渲染。

## 按完整用户路径验收

每case必须保存：完整实现SHA+dirty输入hash、实际命令/cwd/版本/exit/stdout/stderr、脱敏请求响应、原job/lease/CP/outbox关联、before/after revision/source/snapshot、产物SHA256；失败和首次红例保留。下述“不得变化”同时核DB事实与源文件hash。

| Case / 前置 / 真实入口 | 步骤、必须变化 | 不得变化与变异反例 | 命令/证据 |
|---|---|---|---|
| BR-A-01 首端创建到固定Run；已授权素材/真实录音、4生产能力全部可用；Codex→stdio→真实Host frozen routes | intake/artifact/content decision→project.create并等bootstrap→workflow.run.prepare→真实UI authorize→start→task.prepare；读原Job及run同scope | discovery成功不等于业务成功；移除任一能力manifest/许可则prepareRun拒绝，无Run/Job/stage；替测试facts=true必须使测试红 | C1/C3/C6/C7+C8；首端会话记录及4能力证据，真实UI session脱敏 |
| BR-A-02 原job幂等预留；有效当前run；task.prepare HTTP/MCP | 相同key并发及断线重放；恰一个job、一个immutable input、一个step binding与CP事件；异key同attempt被唯一约束拒绝 | 同key改变input_ref/base/kind拒绝IDEMPOTENCY_CONFLICT；hook抛错/返回thenable不留下job或CP半提交；不能新队列 | C2；真实SQLite事务计数与outbox before/after，变异移除final_reserve/rollback |
| BR-A-03 权限与阶段；真实trusted UI与authenticated driver；authorize/review/task入口 | driver内容relay只content_only；UI确认同scope产生confirmation/grant；样片/首章未接受时下游blocked；authorize取消/过期后准备失败 | actor=human/confirmed=true/伪session/跨project/旧digest不能授予权限；clip.prepare不能借render kind越门；纯accept无Approval | C3/C6/C4；confirmation/approval/permit行和无stage；变异跳过trustedGrantConfirmation |
| BR-A-04 真草稿prepared；BR-A-01，MEDIA verifier真实；task.prepare→worker→processor | running→prepared fact→job succeeded与CP waiting_user同tx；重读job/context/review得到可解析同ref（R1/R4获批后） | source/revision/active_commit/正式snapshot不变；metadata/blob/rights tamper、symlink、错lease/proof在record与finish都拒绝；不得以Job成功标completed | C2/C4/C5；stage文件hash、proof边界、DB原子回执；变异省略assertPrepared/rights重核 |
| BR-A-05 prepared到一次确认采用再正式导出；R1/R4冻结且PRODUCT/MEDIA接通；review.decide/change.prepare/change.apply | 展示impact→一次accept_and_adopt→limited approval→Coordinator revision+1→真实NativeAck→render committed snapshot；重放返回原结果 | 纯accept/旧base/过期impact无提交；prepared路径不得直接render为正式成品；两次apply不+2；sample gate不等于adopt/render权限 | C3/C6加MAIN统一真实链；before/after snapshot、Approval消费、NativeAck及MEDIA交付hash；变异将prepared digest当active_commit |
| BR-A-06 断线重开；原job running或prepared-recorded未finish；启动真实新Host进程 | 断MCP/UI，Host已授权确定步骤继续；停止/重启后同DB恢复原job，重新proof后复用prepared；read snapshot+cursor再接events | 不能按缓存新投task，旧lease晚回调不能成功；generic不能抢created-task job；generation变化旧cursor拒绝/重快照 | C2/C4/C5；新PID/instance generation、job id恒定与CP/event计数；变异漏合并exclusions |
| BR-A-07 取消/失lease；queued/running/cancel_requested分别建立；job.cancel/run.cancel | queued无lease取消闭合，running abort→原callback；过期reaper重排CP pending；max_attempts耗尽job attention与CP failed；重复恢复无新增事件 | run取消不得只改run留下CP running；失lease旧owner不得写新attempt；取消不伪报succeeded或删除author；不得把lease attempt当execution attempt | C2/C4/C5；cancel/recovery事务前后完整行；变异用generic reaper代替专属reapExpired |
| BR-A-08 listen/close资源；真实Host+持久task worker；Host.listen/close | 领域recover完成才HTTP可达/claim；close先拒新写、停止dispatch、abort并await processor清理，DB最后close；重复close幂等 | HTTP close窗口不得新排queued；不能定时detach后DB关闭；共享服务不可停；verifier FD必须释放 | C5/C2；时间序列、持有lease/FD/子进程证据；变异将DB.close提前或缺closing栅栏 |
| BR-A-09 MCP/UI同事实观察；task active且审阅pending；context.read/workflow.read/job.read/events snapshot | 两端project/run/step/attempt/input一致；UI一份Decision后MCP读取同ID；cursor过滤推进、不漏/重放业务；无百分比就展示真实状态/时间 | Context不能仅接受creation job；过期health不可ready；断线不能缓存绿灯；UI关窗不取消Host；读取不得调度媒体 | C1/C5；快照/cursor/events与UI截取及DB对照；变异把job succeeded投影为committed/native loaded |
| BR-A-10 A末60–180秒短片关服重开改单镜双导出；MAIN阶段释放、授权素材、MEDIA/PRODUCT完整 | 两主题真实中文录音和可编辑概念说明，第一次正式导出→改单镜受控采用→重开→第二次正式导出，原生可编辑clips，中文HTML证据 | 不用3秒fixture/合成音替人验；B多驱动接力/通用改图/稳定豁免不启动；不得代签人工PASS | MAIN C9/C10/T20-A..H与已批准真实媒体/Headless入口；BRIDGE只交首端/恢复关联证据，最终人工NOT_RUN |

## 门槛

开发启动门：MAIN审定DESIGN/ACCEPTANCE、明确R1..R4裁决与白名单/单writer，Claude只读readiness可接手。开发自验证门：授权票据的正负向和变异反例按真实输入通过，不用历史模块绿灯替代。A阶段门由MAIN统一冻结同SHA、真实媒体/T20/独立审查并提交用户；领域参与实现/设计不自签独立验收。任何case缺真实入口/权限/素材/证据标BLOCKED或NOT_RUN而非PASS。

补充BR-A-05/R5反例：prepared step=waiting_user、Run=waiting_user时普通clip.prepare/render仍必须拒绝；只允许MAIN批准的专用impact读取/登记分支对同一真实prepared产物生成impact，不发生媒体/source写。UI接受后只允许对应limited approval的apply，其他waiting_user attempt/其他package/跨scope/撤权/暂停取消不得借道；提交失败不能提前写adoption accepted。现有C3/C2/C6新增这些断言后验证，当前NOT_RUN；未经R5裁决不得声称BR-A-05可执行。

MAIN拟定内部接缝追加变异矩阵：BR-A-04/05覆盖ps_跨project、映射篡改、包同ID换version/sha、悬空result_ref、旧lease晚发布、将internal effect混入HTTP、pure accept误授Approval、撤权/改bytes/暂停取消后采用及risk门旁路；BR-A-10覆盖delivery QC失败/未知仍打包、重启重复子动作/ready。允许的internal effect必须通过同模块受信事实核验，普通action仍拒waiting_user。命令基座C2/C3/C5/C6；delivery真实恢复依MAIN/MEDIA原Job持久端口冻结后补充实际命令，当前NOT_RUN且不可用桩通过替代。

BR-A-01/R6素材发现前置case：真实trusted UI选Host sourceRoot相对素材并声明license/origin→既有import→Agent只读inventory→精确rights Ref→prepareRun facts。必须真实同project登记及bytes匹配；不得授Agent写许可、泄露绝对路径或由只读触发导入。反例覆盖../、absolute/symlink逃逸、跨project Ref、version!=1、registration_digest错、旧登记/替换bytes、缺许可true和越权枚举。现有命令基座 `pnpm test tests/agent-driven/integration/local-assets-host.test.ts tests/agent-driven/bridge/mcp-registry.test.ts --maxWorkers=1 --minWorkers=1`；附属transport规范批准后补充对应生产测试，当前NOT_RUN。

## 变异与明确红断言绑定（拟新增case，未执行）

| case/变异 | 测试文件（tests/agent-driven相对） | 必须使变异失败的单条关键断言 |
|---|---|---|
| BR-A-01-NEG1 缺任一能力却available | integration/host-application.test.ts | prepareRun拒绝CAPABILITY_UNAVAILABLE且run行计数增量0 |
| BR-A-02-NEG1 final_reserve移除/异步hook | integration/created-task-store.test.ts | hook失败后job与cp step及outbox总增量均0 |
| BR-A-03-NEG1 信任relay确认 | product/fixed-workflow-service.test.ts | driver authorize拒绝且trusted_confirmation/grant增量0 |
| BR-A-04-NEG1 跳过当前proof/rights | integration/created-draft-processor.test.ts | bytes/rights改变后无新prepared fact且active_commit等于before |
| BR-A-05-NEG1 广放waiting_user | integration/created-task-gate.test.ts | waiting_user普通task.prepare仍拒绝，job增量0 |
| BR-A-05-NEG2 HTTP伪effect/跨包批准/错ps映射 | integration/host-application.test.ts | 每种请求均无新project_transaction成功回执且revision增量0 |
| BR-A-05-NEG3 纯accept当采用 | product/fixed-workflow-service.test.ts | accept响应approval_id为空且approval行增量0 |
| BR-A-06-NEG1 不合并generic exclusions | integration/host-application.test.ts | generic tick不能将created-task独自置attention且CP running |
| BR-A-07-NEG1 接受旧lease | integration/created-task-worker.test.ts | 新owner持有时旧callback不能改变job/CP终态或增加成功event |
| BR-A-08-NEG1 DB提前关闭 | integration/host-close-lifecycle.test.ts | worker cleanup完成时间严格早于DB close，closing后新写拒绝 |
| BR-A-09-NEG1 只认creation receipt | integration/creative-context-host.test.ts | active task出现时context成功且job_id/state/attempt与job.read一致 |
| R6-NEG1 错Ref/跨project/目录逃逸 | integration/local-assets-host.test.ts | 请求拒绝且registry/素材/author计数或hash不变 |
| R6-NEG2 修改冻结resource注册 | bridge/mcp-registry.test.ts | 冻结registry字节/31routes不变、附属资源只在独立allowlist出现 |

以上复用现有测试文件的真实pnpm test脚本；case名称是计划新增断言，不虚称已有测试。D05 QC/发布的mutation测试文件必须在MAIN/MEDIA冻结端口和精确白名单时填入，未填不放行BR-A-10。开发前核pnpm实测10.31.0与声明10.33.0差异，不默认为已配齐。

D01..D07 ACK与剩余阻塞见DESIGN末尾。BR-A-05推荐保持冻结change.prepare/apply真实HTTP/MCP入口，handler在Host内部选择窄effect，禁止的是客户端指定effect/proof而非禁止HTTP触发受控服务；该入口与impact未来snapshot身份仍待MAIN最终裁决，之前case不可执行。历史closure/verifier清单不覆盖当前overlay，首次开发必须重新冻结输入和复验，不能抄旧PASS。

## D08–D12最终方案对应验收补充

BR-A-05真实入口锁为冻结change.prepare/apply及trusted review.decide/change.approve共享权威；两路径并发仅1个有效Approval/1次revision+1。target_snapshot_id仅预期，prepare前后snapshot/active_commit新增数0；消费后目标ID精确匹配。旧M3/hash域与adopt_prepared_source互拒，旧库CHECK前向迁移保留原行；created路径禁止虚构migration_id。新增生产组合测试（待实现，当前NOT_RUN）：`pnpm test tests/agent-driven/integration/created-render-delivery.test.ts tests/agent-driven/integration/created-delivery-recovery.test.ts --maxWorkers=1 --minWorkers=1`，现有MEDIA底座`pnpm test tests/agent-driven/media/render-snapshot.test.ts --maxWorkers=1 --minWorkers=1`。BR-A-10须真实QC→package同Job恢复、producer execution不被新lease覆盖、发布后DB前补记不重编码。
R6新增反例：rights_ref.version=2必须schema或明确输出验证拒绝；POST InventoryItem须用定义ref校验，不能顶层误拒正常响应；uri:null适配旧optional；已成功同key候选过期返回原receipt，新key过期410；统计31原HTTP+4附属HTTP及新增1resource，单独版本/白名单。以上只验收设计，未运行。

最新MAIN输入对齐：03_OWNERSHIP_AND_DEPENDENCIES.json已落盘，120项路径均唯一，其中BRIDGE 65项；之前ENOENT为历史观察，现已关闭。具体文件白名单和R0–R4依赖以该表为唯一设计分配权威，覆盖本文早期拟名单，仍须未来ReleaseAssignment才有实现权。review-media-v1.registry.json明确新增只读GET（鉴权opaque Ref、真实bytes/Range、无渲染副作用），当前总协议扩面=原31 HTTP+附属5 HTTP、另增1 MCP resource，不能仍称仅4附属HTTP。新文件尚不存在是计划实现状态，不是未定义语义；准确工具链入口为目标worktree corepack pnpm --version，子窗口只读核验中。

D13–D15验收替代旧自动QC断言：新created_*表创建后旧库applyAgentSchema仍通过且cp_a0 fingerprint不变；成功SOURCE_ONLY job无lease能经proveForAdoption重证，重新claim成功Job必须拒绝；encode后QC前崩溃有EncodedFact则复hash后QC、不得重encode；无QC可信决定时qc gate pending且snapshot_publish Job queued不反复claim；accept只更新强绑定qc门，不误更新普通chapter_pack门，block不可覆盖、warn无当前item绑定不得通过；接受后原Job新lease原execution attempt续package且一次ready。上述分别落03已分配created-source-adoption/process-recovery、created-render-delivery、created-delivery-recovery与fixed-workflow-service/execution-guard测试，均未来新增断言NOT_RUN；D13–D15覆盖前文自动技术QC接受门的旧表述。

MAIN最终修订复核：已实读asset-inventory schema，rights_ref.version={const:1}且顶层anyOf已包含InventoryItem，前述两项精确性反馈关闭；标签/lineage合法既有范围按MAIN最终schema。02(D01–D15)、03及06_MAIN_REVIEW_AND_START_GATE.md为当前权威，覆盖本文前期备选/待定描述。未来实施入口为../implementation-prompts/bridge.md（与本轮只读CLAUDE_PROMPT分开），只在下一轮正式授权、R0共同SHA及ReleaseAssignment/单writer就绪后执行。本轮只到开发启动准备门，全部产品NOT_RUN；Claude最后定向ACK仍待实际回报，不预写已完成。

## 最终定向复核回执（覆盖前文等待状态）

已实读CLAUDE_READINESS.md第10节，ctx_aca9dc7af0f2 / task_0bd1d303a11c / handle term_c7b45237e89f62cd4defe27cbb8c6f00：F01/F02/F13/F14/F15/F16全部ACK，无阻塞；F03确认旧追加显式PASS但仅旧hash，R0重审当前overlay；F09在子窗口目标main-integration准确执行corepack pnpm --version=10.33.0，无安装。报告历史不改写，仅本节记录当前结论。

123条唯一writer分配中BRIDGE68项，以03当前内容为准，旧120/65统计仅历史。MAIN已接收三项非阻塞完善：attestation_ref ui_+first60hex总63字符且<=64；设计asset-inventory-v1.*与运行时agent-local-assets-v1.*一一映射；R0/R2/R4安排未参与实现者独立复核。无需再审或自行扩任务。D01–D15设计最终ACK，未实现新文件均未来工作，不是未定义语义。

本轮仅准备门：产品实现NOT_STARTED，业务测试/构建/渲染/服务/验收全部NOT_RUN。未来按MAIN implementation-prompts/bridge.md、02/03/06和R0共同SHA+ReleaseAssignment/单writer交接执行，不凭本次ACK启动开发或进入B。

封包前最终状态：已核对MAIN 02末尾三项精度补充与04独立复核排程，attestation_ref 63字符/最大64、设计到运行时schema映射、R0/R2/R4未参与实现者复核均已明确，三项非阻塞观察全部关闭。Claude ctx_aca9dc7af0f2已正式succeeded且readiness第10节ACK，无剩余设计阻塞；本领域文档写入结束，可由MAIN封包。implementation NOT_STARTED，产品验收全部NOT_RUN，不另启worker或扩大审查。
