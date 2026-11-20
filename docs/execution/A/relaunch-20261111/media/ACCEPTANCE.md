# MEDIA A 验收设计 · 全部 NOT_RUN

> 当前执行设计以本文末尾“D01–D15最终ACK”及集中03名单为准，覆盖此前待裁决/历史备选措辞；这是设计任务包，不是实现release。

仅方案，不执行以下任何业务命令。cwd为MAIN实际源码目录；MAIN发布实现release、冻结共同SHA/overlay、资源预约后方可执行。领域复核不是独立验收，所有案例须以真实Host/媒体证据补齐；单元测试仅局部回归。

## 已读取package.json后的命令目录

现有scripts：test=`vitest run --config vitest.config.ts`；build=`tsx tools/build-native-workbench-validators.ts --check && vite build && vite build --config vite.m5.config.ts`；check含tsc、全vitest、Python impact golden及两build。没有`test:media`或生产导出E2E script，不编造。后续使用本地依赖（不得隐式安装）：

- C1：`pnpm test tests/agent-driven/integration/created-draft-processor.test.ts tests/agent-driven/integration/created-task-store.test.ts tests/agent-driven/integration/created-task-worker.test.ts tests/agent-driven/integration/source-digest-resource-boundary.test.ts`
- C2：`pnpm test tests/agent-driven/media/native-draft.test.ts tests/agent-driven/integration/committed-snapshot-host.test.ts tests/agent-driven/integration/created-native-workspace.test.ts`
- C3：`pnpm test tests/agent-driven/media/render-snapshot.test.ts tests/agent-driven/media/qc.test.ts tests/agent-driven/media/published-package-store.test.ts tests/agent-driven/media/delivery-service.test.ts tests/agent-driven/media/download.test.ts`
- C4：`pnpm test tests/agent-driven/media/native-draft-real-render.test.ts tests/agent-driven/media/native-subtitle-burn.test.ts tests/agent-driven/media/native-renderer.test.ts tests/agent-driven/media/process-group-inheritance.test.ts`（重型）
- C5：`pnpm exec tsc --noEmit`、`pnpm run build`；阶段统一回归由MAIN独占执行`pnpm run check`，不与C1..4重复抢资源。

C1..4无提高并发；先读vitest config与测试条件，不把skip算pass。生产完整入口与缺失fault harness在MAIN接线release中冻结实际可执行命令与路由后才能执行。以下“生产步骤”是实际用户操作入口描述，不是虚构已存在CLI；无真实入口则case BLOCKED/NOT_RUN，不能以内部method替代通过。现有`tools/agent-driven/media/render-delivery.ts`是diagnostic sink，不能用它签生产ready。

## 准备、审阅、采用、重开与双导出

共同前置：MAIN已冻结CP方案、应用接线与鉴权；固定OpenFilm e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3；独立DB/var/staging/profile；两主题真实授权素材及中文human_recording(含license/hash/probe)，每部60–180秒。证据统一保留命令/exit/time、完整SHA+dirty overlay、输入hash、脱敏请求/响应、job/lease/run/step、before/after DB只读投影、源闭包hash、媒体/日志sha256、UI实际版本与原生clips。所有case包含反例，改代码做变异须另有实现授权，本轮不改。

|Case/映射|前置与真实入口、步骤|必须变化 / 不得变化|证据、命令与变异反例|
|---|---|---|---|
|M01 / IT-A03/05真实准备|已登记资产/确认脚本分镜，真实Agent MCP task.prepare assemble_draft→Host worker→processor，等prepared|真实job/step推进且有不可变闭包；author/revision/active_commit不变|C1/C2局部；生产MCP命令待BRIDGE release；保存fact+native parser clip IDs。反例：改资产同尺寸字节/rights或input sha仍能成功则失败|
|M02 / IT-A05可预览不提交|M01完成；真实工作台preview链接打开/播放/关闭，读同一ReviewPackage|可看听同版本音画字幕；关闭不接受，prepared不冒充Delivery；revision+0|PRODUCT真实Headless入口待release；C2仅原生回归。反例：preview根指author、播放即commit、source被编辑任一即失败|
|M03 / IT-A05可信采用|MAIN批准CP-02，可信UI确认并采用，重放同key，再旧base/锁/许可过期重试|正常revision+1一次、source_fact/snapshot/pointer/approval/impact/outbox原子；拒绝/旧输入+0|C2+MAIN adopt事务测试命令待释放；capture实际交易/哈希。反例：伪M3 row、Agent confirmed=true、先指针后fact都必须失败|
|M04 / IT-A05原生同步|M03后由现Studio打开原项目，核实际loaded projection，再断开/旧generation ack|video/page/audio各自原生可编辑，字幕来源明确；无第二timeline；旧ack不能loaded|C2为局部；PRODUCT真实Headless。反例：Host expected原样回传当观察、扁平MP4替代clip必失败|
|M05 / IT-A06正式导出一|M03 committed transaction与render授权；真实MCP task.prepare render_snapshot→job→delivery.read→鉴权download|render/QC/receipt/ready齐备；author/revision不变，下载200完整/206范围/416无泄露|C3/C4局部，真实生产命令待接线；ffprobe+完整decode+manifest/byte hash。反例：stage路径、未committed、qc pending、跨owner下载均拒绝|
|M06 / IT-A01/05/06重开二导出|M05完成；退出Agent/UI/服务，按正式launcher重开同库，下载旧包；原编辑区改单镜，经M03再render|旧包hash/bytes/manifest仍相同且无新render；新snapshot/source/revision/相应镜头内容改变；未修改镜头资产hash、镜头ID、时长/字幕/旁白和设置保持（本case固定仅替换等长画面）；两导出均真实可下|C3部分，完整launcher/MCP/Headless命令由MAIN组合release固定；两份原生闭包与解码帧区间对比，允许编码容器非确定性不要求整个MP4逐帧外所有压缩字节相同。反例：全片重建丢ID/音频变、旧包被覆盖、读取触发编码|
|M07 / IT-A03/05取消/恢复/FD|在before_prepare/after_prepare/before_record/before_finish边界取消、失lease及进程重开，重复多轮并注入EMFILE/ENFILE|旧lease不能record/finish、author+0；新proof重新验证；进程/FD收敛，DB关闭后无写入；资源错误保留可恢复事实|C1局部；真实Host终止harness待MAIN；FD计数/owned pid+start/lease审计。反例：复用旧WeakMap proof、file descriptor泄漏、未知进程未停却重发|
|M08 / IT-A03/05门无循环|样片待审时preview和prepare impact；未接受尝试正式render/后续依赖批量任务；可信接受并采用后再render|只允许与阶段授权相符动作；waiting_user不占长期worker；review无需预先Delivery，正式render仍须commit|真实Agent+UI入口待装配；记录每动作gate事实。反例：先commit才准看样片，或把preview绕入snapshot.render皆失败|

## T20-A..H：保留原case语义，全部NOT_RUN

共同真实入口为M05生产render Job；前置拥有授权committed snapshot与实际encoder/decoder，C3/C4是局部覆盖。真实故障驱动程序尚无统一package script，MAIN须交付逐case命令/自有PID范围再执行，不用旧诊断CLI/throw冒充。

|case|前置、步骤|必须/不得变化|证据与变异反例|
|---|---|---|---|
|T20-A|编码阶段隔离故障FS或可审计I/O注入ENOSPC/写失败|明确failed，无ready/download/半包；snapshot/source/revision不变；不填满系统盘|C3回归+实际故障命令待MAIN；I/O日志、无receipt-ready。反例：忽略写失败仍ready|
|T20-B|令真实编码非零、截断文件、尾部坏帧分别导出|ffprobe或全程decode拒绝；未完成QC不能ready；旧工程不变|C3/C4+真实fault命令待MAIN；decode exit/stderr/输入输出hash。反例：仅probe/首帧检查放行尾部损坏|
|T20-C|同snapshot/config同key两并发，另预置同名输出/异输入|唯一完整winner；不覆盖异输入；loser只删自身UUID staging；原项目不变|C3+并发Host harness待MAIN；winner/loser/object/receipt清单。反例：败者quarantine/delete赢家|
|T20-D|render过程中取消，故意晚到成功/lease被取代|真实后代停止或持久reconciling；无ready/download/自动重发；不清共享进程|C4局部+真实Host取消；pid/start/PGID、heartbeat停止。反例：worker退出就释放lease、晚到回调置ready|
|T20-E1|encode_finished后QC前，真实终止本次自有Host/worker并重启|可恢复/明确失败，不半包；原snapshot不变|原始PID、kill/exit、重启DB/FS日志。反例：throw替代真实终止不算执行|
|T20-E2|QC后publish前真实终止并重启|完整验证再发布或失败，无重复半包|与E1独立证据；反例：恢复跳QC|
|T20-E3|publish/rename(实际receipt可见)后DB ready前真实终止并重启|按不可变receipt对账，不删已发布winner、不重复编码/发布|对象/receipt目录fsync、DB前后证据；反例：以无DB row删receipt对象|
|T20-E4|DB commit后events投递前真实终止并重启|ready有完整包，outbox补投且消费者去重，不再次编码；event不先于DB提交|事务/outbox水位与重放记录；反例：DB回滚却外部成功事件|
|T20-F|QC block、缺字幕/许可附属件、同尺寸hash改坏，修复后重试|block不供交付；修复经过完整QC，同snapshot新attempt或明确处理；旧包不变|C3、文件hash/差异；反例：点继续覆盖hard block|
|T20-G|旧snapshot render在途，同时提交等长改单镜新revision|旧job/manifest仍旧snapshot/revision，UI明确版本；新commit不污染旧输入|C3部分+生产并发；两快照/输出对应。反例：renderer读live author|
|T20-H|ready后重复GET/同key，关服重启再次下载并完整decode|bytes/hash/manifest一致；GET无render副作用；旧包不被清理|C3/C4部分+重启生产；200/206/416字节与作业数；反例：read重新编码或下载同尺寸篡改仍200|

所有真实案例需双重断言：输出状态正确，且禁止变更没有发生。没有授权真实人声/素材可先关闭软件设计与局部开发验证，M01..06真实产品验收仍BLOCKED/NOT_RUN。全阶段统一SHA回归、未参与者独立审查与人类验收由MAIN组织；不得将领域自测涂成A_ACCEPTED。

## 分阶段输出补充case（MAIN拟定门，NOT_RUN）

M09（IT-A03/A05/A06）：前置MAIN锁内部encode/QC事实和fixed-stage权限；从chapters当前snapshot.render执行真实committed encode，停在章节/cover等待，再经可信审阅进入qc.inspect/delivery.package。必须只有encode/ref或明确授权的QC事实，等待时无PublishedPackageStore receipt、无Delivery ready/download；readonly review/读取不触发package。当前C3仅提供整体facade回归，分阶段真实Host harness命令待MAIN release，保存每个action/attempt/grant/输入输出hash及阶段DB事实。变异反例：在chapters直接调用整体render即使把commitReady替换no-op，也因已经publish而失败；把preview当committed encode或偷换snapshot失败。

M10（IT-A06/T20-E/H补充）：前置合法encode事实但尚无QC/包；分别在对象fsync后事实事务前、encode事实事务后、QC事实后真实终止本次自有进程并重启，再按合法下一阶段入口继续。必须对账orphans、已登记事实全文件复验，无重编码/静默丢中间文件；篡改media同尺寸字节或rights/profile后不得复用旧QC。C3/C4为已有回归，新增生产harness实际命令待MAIN；证据含私有对象与fact_digest、job/lease、QC profile/grant、编码次数。变异反例：旧render finally删除中间文件、跨阶段复用旧execution授权、manifest.attempt错用encode attempt均失败。

## Claude复核后的收紧（覆盖M09/M10歧义；NOT_RUN）

- M09：chapters/cover snapshot.render只至合法encode事实/明确许可的技术证据，零publish receipt/ready/download；进入delivery即使技术QC全pass但qc gate尚未合法accepted，delivery.package必须RUN_GATE_BLOCKED。不能伪造ReviewPackage.kind=qc（现enum无此值）、用cover决定冒充QC或执行器自行accept。MAIN冻结实际qc gate producer及可信决定路径后才填写该真实入口命令。
- M10：把encode_finished定义在媒体immutable object fsync+原job绑定encode fact事务之后，QC之前真实kill重开，必须找到同job/producer attempt/object/hash并继续QC而无第二次encode；对象写后登记前另测orphan对账/明确失败，不冒充已完成边界。manifest/receipt publication attempt相等，内部encode/QC lineage各与真实execution匹配而非要求数值相同。
- 同key第二次publish必须先找到真实完整receipt，编码次数与新建object次数不增长（首次并发loser自有临时对象另记）；旧包/manifest全字节保留。receipt存在但取消/授权过期/DB未ready仍不能下载或自动补ready。
- M03/M08补：SOURCE_ONLY须按job.state/terminal_reason/provider_receipt_json和prepared事实匹配；完成源Job已释放lease仍可在新受控采用事务复验，禁止实现成“旧job必须running”而死锁。ps_合法映射与跨origin/跨owner/碰撞分别负向；MAIN三个consumer必须分流。
- C4资源须核实际renderer使用的Chromium路径和ffmpeg，不以Windows浏览器文件存在替代WSL运行验证；maxWorkers=1保持，按MAIN真实配置预约，不预设必须GPU。

领域文档复核不更改Claude原报告，不将其中待MAIN事项误写已关闭；人验/产品验收全部NOT_RUN。

## D08–D12收敛：补齐可复现实验断言（全部NOT_RUN）

新增生产测试文件由BRIDGE core实施、MAIN集成：`tests/agent-driven/integration/created-render-delivery.test.ts`与`tests/agent-driven/integration/created-delivery-recovery.test.ts`，当前为指定新文件，未声称已存在。package test脚本已核实；release后命令精确为 `corepack pnpm test tests/agent-driven/integration/created-render-delivery.test.ts tests/agent-driven/integration/created-delivery-recovery.test.ts`；MEDIA步骤模块回归 `corepack pnpm test tests/agent-driven/media/render-snapshot.test.ts`。执行前目标checkout `corepack pnpm --version`须10.33.0、Node>=22.15.0，不安装/升级；本轮不执行。

|Case|前置、入口、步骤|必须/不得变化、证据、变异反例|
|---|---|---|
|M11 / D08-D10采用并发|真实prepared ps_映射和可信包；原review.decide accept_and_adopt自动apply与Agent change.apply并发、不同幂等键；再调用兼容change.approve|唯一Approval/impact消费/transaction，revision+1恰一次；两响应可追到同transaction；prepare target=真实snapshotIdFor但prepare时无snapshot行。保留before/after完整事实；变异：自动和Agent各+1、approve签第二批准、用假migration_id绕旧commitAdoption都失败|
|M12 / D09计划与TTL|同源但改变locks/consumer/rights/control/selection或请求数组排列，重放旧key；在expiry前后调用|合法数组规范化摘要一致、任一实质前提变更旧批准失效，未知图拒绝；同key不续15分钟TTL，now>=expires_at拒绝。变异：仅hash film.html、空锁图当unknown、prepare提前插pointer都失败|
|M13 / D10恢复全闭包|拥有同Coordinator prepared交易；在old→backup/new→author缺口、publish后DB前、DB后逐点真实终止本次进程重启|pending recovery挡读写，无half-source/错误terminal attention；settings/subtitles/assets/film完整恢复或提交；source_fact/pointer/approval/impact/outbox同事务，DB后+0。已存在同snapshot异source_fact必须冲突，不能忽略。命令由MAIN采用恢复harness释放，当前NOT_RUN，不以throw代替|
|M14 / D11同delivery Job|chapters取得committed encode事实，delivery用原Job先QC后publish；QC后失lease/重启/重复调度|仅一个delivery Job及同CP execution attempt，lease变化不改业务去重键；qc_inspected原子登记后Job不提前succeeded；无block/未处置warn且真实gate后才package。证据SQL唯一键/原始payload/receipt hash/进程；变异：QC/package各造Job、旧leasecommit、receipt hash不同比较缺失均失败|
|M15 / D11复用和授权|真实encode事实→QC→publish边界按T20-E终止重启，并在补DB前撤销scope/取消|encode事实存在不再encode，qc事实存在不造第二QC Job，published不重复publish；授权撤销时已发布receipt仍不得ready/download，完整对象保留对账；DB ready后读取零业务写。验证phase fact/manifest/publish与encode attempt lineage分别真实，不伪造二者数值相同|

M09此前“qc gate待合法接受”的入口现明确为D11 BRIDGE FixedPhaseExecutor同事务真实技术证据producer，非MEDIA自动gate、非不存在的ReviewPackage.kind=qc；仍断言未登记gate/未处置warn/硬block都拒绝package。M10编码前QC后恢复断点保留，encode事实不含尚未产生的QC字段；绝不以最终package receipt替代QC前锚点。C1..C5及T20-A..H均保留，不因新增case缩小原真实媒体要求。


## 最终owner与安全收口

新增MEDIA准确模块验证命令（文件是03指定的新文件，当前NOT_RUN）：`corepack pnpm test tests/agent-driven/media/committed-render-phases.test.ts tests/agent-driven/media/preview-prepared-source.test.ts`；BRIDGE transport验证命令：`corepack pnpm test tests/agent-driven/integration/review-media-transport.test.ts`，命令使用已核实test script，不创建不存在的脚本名。

M16 / D03媒体读取：前置真实已发布ReviewPackage及preview/旁白/VTT/JSON受控receipt；入口GET `/api/ui/v1/projects/:id/review-media/:ref`，分别重复读、取消下载、跨owner、旧package/input/quality、同尺寸篡改、HTML或路径注入。必须owner和UI读证明有效、返回对应版本真实字节，断流/正常结束/error都关闭FD，重复读无编码/DB业务写；必须拒绝跨scope/坏hash/HTML/任意stage文件，不要求正式Delivery ready来读取preview，不得fallback到author source。证据保存脱敏HTTP状态/bytes hash、FD归属计数与job/revision前后值，禁止凭据或配置内容入证据；全部NOT_RUN。

本轮文档语义核对没有新增待决项；未执行上述验证本身不列作文档阻塞。今后任何验证不读配置/凭据、不dump全env、不复制敏感工具日志，不修改/轮换凭据，模型仅会话自报。


## D01–D15最终ACK：覆盖旧自动QC口径（全部NOT_RUN）

M09/M14必须以D15为准：即使技术QC全pass，pending qc gate仍阻止package；只有真实人类review.decide后才可同Job重新claim。前文任何“技术证据同事务自动accepted”断言作废，不得据此写测试。原C/M/T20范围不缩减。

- M17 / D13采用proof：前置真实SOURCE_ONLY成功Job且lease已释放；经原change.apply→proveForAdoption→typed事务完成一次采用。必须不用重claim成功Job；伪JSON proof、另transaction/impact/base复用、同尺寸文件变化/许可撤销均拒绝且revision+0，FD最终回收。模块基座`tests/agent-driven/integration/created-draft-processor.test.ts`由MEDIA覆盖只读proof边界，实际事务测试由BRIDGE `tests/agent-driven/integration/created-source-adoption.test.ts`覆盖；release后命令 `corepack pnpm test tests/agent-driven/integration/created-draft-processor.test.ts tests/agent-driven/integration/created-source-adoption.test.ts`。
- M18 / D15可信QC：真实decode结果生成完整chapter_pack及created_review_gate_fact；工作台展示成片和质量报告，先不决定，再普通章包决定、伪target_gate、旧quality/warn列表、block accept，最后当前可信决定。必须前五种不能放行qc，block不能绕过；正常一次review.decide只accept绑定qc Gate、同事务写完整warn disposition、不误写chapter_pack门；包读取本身无决定。准确BRIDGE新测试 `tests/agent-driven/integration/created-qc-review.test.ts`，release后 `corepack pnpm test tests/agent-driven/integration/created-qc-review.test.ts`，当前NOT_RUN。
- M19 / D14-D15恢复：QC待审退出/重启，确认delivery Job queued、step waiting_user、无live lease，反复pump不inspect、不占槽；可信接受后同Job新lease、旧execution attempt继续package，旧lease回报拒绝。取消queued待审、pause、授权过期分别不发布；进程终止前后原phase fact hash一致。基座created-delivery-recovery.test.ts及committed-render-phases.test.ts，采用已有准确test命令；不得以新QC Job掩盖旧Job不收敛。
- M20 / D13 namespace：BRIDGE旧库启动/新created事实升级后原cp_a0 fingerprint与定义仍严格一致；把新增表误放cp_a0_*必须失败，不修改冻结migration或放松matcher；未知created定义/不完整域校验也必须拒绝或由完整版本DDL正确校验，不静默忽略。schema测试由BRIDGE共享core归属，不能MEDIA修改DDL证明通过。

证据仍为实际Host调用/事务前后事实、进程/FD、hash与脱敏响应；不读配置/凭据或全量env，不复制敏感日志。未实施不作为本轮文档阻塞，未来真实产品执行全NOT_RUN。
