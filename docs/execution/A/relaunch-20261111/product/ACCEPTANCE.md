# PRODUCT A 验收计划

全局总闸：D-07共同实现commit、完整ReleaseAssignment与资源释放未完成前，一切未来实现和业务命令均NOT_RUN。

全部 NOT_RUN；本轮禁止执行以下业务命令、启动、build、安装、render。历史候选成功仅 DESIGN 所列受限范围。MAIN 审定并释放实现/资源后执行；开发自验证≠领域复核≠独立验收≠用户人验。

## 命令来源与执行环境

已读取 MAIN package.json：test=vitest run --config vitest.config.ts；test:m5=vitest run --config vitest.config.ts tests/m5；test:m5:headless=tsx tests/m5/headless/run-headless.ts；build 含 validator check+两个 Vite build；check 含 tsc/全量 Vitest/Python golden/两个 build。不发明 test:product 或 A 全链脚本。
以下 C1..C7 在 MAIN 批准的实现目录（不能直接使用旧 lane 冒充 MAIN）运行，默认保留 vitest 并发设置；真实多Host/browser/media由 MAIN 全机单槽安排，Headless 静音。

```sh
# C1 内容/门/纯UI
pnpm test tests/agent-driven/product
# C2 持久内容与创建
pnpm test tests/agent-driven/integration/product-sqlite-repository.test.ts tests/agent-driven/integration/creative-context-host.test.ts tests/agent-driven/integration/project-creation-host.test.ts
# C3 真实创建入口/副本/会话
pnpm test tests/agent-driven/integration/created-native-entry.test.ts tests/agent-driven/integration/created-native-workspace.test.ts tests/agent-driven/integration/created-workbench-read.test.ts tests/agent-driven/integration/workbench-session-host.test.ts
# C4 入口浏览器（不是完整 A 场景）
pnpm test tests/agent-driven/headless/created-native-entry.test.ts tests/agent-driven/headless/owned-project-entry.test.ts
# C5 MAIN 采用既有恢复回归
pnpm test tests/wave2/m4b/adoption-store.test.ts tests/wave2/m4b/adoption-route.test.ts tests/wave2/m4b/commit-adoption.test.ts
# C6 原 M5 回归
pnpm run test:m5
pnpm run test:m5:headless
# C7 阶段检查，仅统一冻结/资源释放后
pnpm run check
pnpm run build
```

C8 候选原命令（不能对旧 private runtime 擅自执行）：013 check2 cwd 为 PRODUCT/var/managed-native-observation/source/packages/openfilm，`node node_modules/typescript/bin/tsc -p studio/ui`、`node node_modules/vite/bin/vite.js build --config studio/ui/vite.config.ts`；015 `node /mnt/c/workspace/videoworkline/Narralens-agents/product-workbench/var/managed-native-expected/source/managed-expected/build-expected.mjs` 与 `node /mnt/c/workspace/videoworkline/Narralens-agents/product-workbench/docs/parallel/lane-product/requests/015-native-expected-projection/check-literal-vectors.mjs /mnt/c/workspace/videoworkline/Narralens-agents/product-workbench/var/managed-native-expected/dist/expected-projection.mjs`。仅历史可复现线索，MAIN 再释放隔离根后更新实际路径，禁止当前运行、共享写根或安装。

## 逐 case（每项状态 NOT_RUN）

统一证据：实现完整 SHA+dirty manifest、合同 SHA256、命令/cwd/exit/开始结束时间、输入产物hash、真实 project/run/package/job/attempt/snapshot/revision/selection/session generation 的脱敏关联、前后 DB/源manifest、浏览器截图与事件；日志不得输出 session secret/token。每个变异必须明确被拒与零禁止副作用，不能只有 happy path。新增集成 harness 尚不存在的项目写明缺口，不能以旧 C1 代替。

|case / 前置|真实入口和步骤|必须变化 / 不得变化|命令与证据 / 变异反例|
|---|---|---|---|
|P01 内容到准备；已授权本地素材、有效 owner|Agent 已登记 intake/question/answer/content relay；回答必答、修改 brief，再读取闭包；请求 prepare|版本/答案/内容决定可增加；relay 不增加可信授权/Approval/工程revision|C1+C2；request/answer闭包记录；变异旧 question_version、wrong input digest、skip mandatory、伪 human/confirmed 均不得越权|
|P02 创建到原 Studio；真实 newcreated 工程|列表→native-open→原 Studio/M5，检查入口到期/owner与原生 ID|可建立入口与派生副本；保持 source/active commit；无 Ack 时仍 unknown/unconfirmed|C3+C4；源hash/空Ack表/真实页面；变异跨用户/跨项目/过期entry/更换snapshot，拒绝加载错误工程|
|P03 样片/首章；真实 MEDIA 五类内容与当前成功 attempt|review_url打开，onOpenPart定位原 player，可信accept，再首章，Agent读取同一决定|review/gate/checkpoint推进；纯accept不改source、不生成adoption权限；关闭不决定|C1基线+新增 MAIN 生产审阅 harness（待释放）；真实媒体hash/包/decision；变异音频包替章节、少preview、旧attempt/取消输出，不得过门|
|P04 单章复用；同scope与完整摘要相同|请求服务端reuse样片覆盖整章，读取首章/章节gate|标出reuse来源且不重复人工确认；不得跨run或质量版本复用|C1；gate/lineage记录；变异output/quality任一hash、scope或source shots/内容改变必须拒或stale，不得仅UI隐藏门|
|P05 确认并采用；active impact与可信UI|展示保留项→review.decide accept_and_adopt→MAIN commit→重复同key|唯一revision+1、限定Approval消费、outbox；期间job完成不显示loaded|C1+C5+待建created组合harness；DB/源/receipt；变异过期impact、base/control并发变更、异内容同key、relay调用，严格拒且无部分写|
|P06 NativeAck正向；同源独立expected和真实observed|原编辑区加载013；Host以真实闭包/probe/rights算015与其他完整parts，匹配才写Ack|Ack绑定当前revision/snapshot/source/session/generation/selection；无需改source即可显示loaded；不宣称decoded/QC|C8窄回归+C3+C4+待建真实hydration harness；每part expected/observed hash+来源证据；变异用UI rows回填expected或只比较film DOM，不能loaded|
|P07 hydration拒绝；已有正确加载上下文|逐个注入旧view/document/hydration epoch、session/generation换代、GET失败、dirty、browser preference、callback throw|当前profile失效/unknown或等待；不写有效Ack、不清dirty、不写偏好|C8仅helper边界+待建真实harness；原始事件与拒绝原因；hash恰好一致但dirty仍拒，markers源损坏却normalize空也拒|
|P08 独立expected边界；真实native源|删probe、改source hash、改listing order、非支持动态span、缺rights、异常路径；重算|unsupported/拒绝；不默认fps/时长/has_audio或凭合法hash格式接受|C8+未来MAIN facts集成case；输入hash和拒绝原因；概念页无媒体时允许真实producer proof，不强造资产许可；伪host_independent必须在Host边界被拒|
|P09 R4持续编辑；真实挂载|展开横Bar→节点dialog→Escape；打开系统aside并选镜/seek；断网/重连|焦点返回、编辑可用、只有一个selection/播放时钟；断连显示最后观察时间unknown；无控制副作用|C1+C6+真实挂载浏览器case；DOM/焦点/clock日志；变异未来/超过15s健康样本不能ready，关闭节点不pause|
|P10 取消恢复；授权运行且在途任务|请求pause/cancel，断线再读，关服重开重新登录|持久checkpoint/receipt保留；新generation需重观测；取消旧attempt不发布/采用|C2+C3+MAIN created-task gate/store/worker 恢复case（测试路径已存在）；事件/前后DB；变异晚到success/重复取消/旧审批不能追加revision|
|P11 改单镜双导出；60–180秒授权本地素材+真实中文录音、两个主题、可编辑概念说明|第一次正式导出→关闭服务重开→原编辑区改一镜→impact批准commit→第二次正式导出|两个manifest分别绑定正确snapshot/hash；修改限目标范围，旧产物保留；QC block无发布，不改无关镜头|C5+C6+C7仅回归，MAIN需补真实A证据runner/人工步骤；两个mp4/probe/full decode/QC/源包/截图；变异把preview/staging当正式导出或旧snapshot覆盖新版本必须拒|
|P12 导出失败与重试；正式交付链已装配|按MAIN T20-A..H恢复矩阵逐边界断开/重开/重复提交|原子发布、无半包、未知先对账；job成功不等于可下载|C7+MEDIA/MAIN已批准T20 runner（具体命令由MAIN核实后补，不杜撰）；失败日志/manifest/原子目录；变异缺full_decode或QC block发布应被测试抓住|

P03/P05/P06/P07/P09/P11/P12 的真实组合 harness 尚待 MAIN 装配，当前不能执行或判通过。放行要求每项实际证据齐备，不以已有测试名称覆盖缺失场景。A末独立复核由未参与实现者执行，领域审阅不冒充独立验收；中文HTML与服务入口就绪后由用户验收，未人验不进B。


## 与 MAIN 组合门映射补充

P01/P02→A-CREATE/A-MCP；P03/P04→A-FILM；P05→A-WRITE/A-ENTRANCES；P06/P07/P08/P09→A-UI/A-EVENTS；P10→A-COLD/A-CANCEL；P11/P12→A-REOPEN/T20。新增负向：用prepared artifact伪造M3 materialization应拒绝；waiting_user下合法审阅/采用不能形成必须先commit的循环；未授权入口与跨owner零写；新revision与旧snapshot导出并发时显示实际绑定版本。事件组合测试按MAIN固定机/样本p95≤2秒，不由组件计时证明。
T20-A..H确切故障/进程终止点以MAIN 05草案为准，尤其rename后DB前与DB后events前须真实自有进程丢失，throw不可替代；缺实际runner命令保持NOT_RUN，待MAIN释放补全，不涂绿现有模块测试。


## P13 受控素材选择与登记（P-A1，NOT_RUN）

前置：已创建owner工程、可信UI会话、MAIN配置sourceRoot，目录含获授权视频与真实中文录音；MAIN附属UI transport及只读MCP inventory合同冻结并真实装配。真实入口为原工作台“登记本地素材”组件→MAIN目录/登记transport→LocalAssetRegistry.import，Agent随后inventory读取；URL尚未冻结，不杜撰。
步骤：打开目录→选择video和audio→填写source/license/recording_origin→确认→等待Host实际校验→显示返回登记事实→Agent读取并绑定简报→重试同key→重开UI再读。必须增加同一组asset/rights/receipt/event且不重复blob/登记；用户无需复制asset_id；不得改source/revision/snapshot、创建Run授权/批准，不扫描任意根或上传。
现有基础回归命令：`pnpm test tests/agent-driven/integration/local-assets-host.test.ts`（已核文件存在）；新增目录/可信transport/inventory/组件完整路径harness尚待MAIN释放，不能以内部import测试代替生产入口。记录目录候选绑定、输入hash、可信声明、实际probe/full decode、登记digest、幂等前后行数、Agent读取同ID、source前后hash；不输出凭据/绝对内部路径。
变异：../、绝对路径、symlink/目录被替换、列表后文件字节变化、伪expected_sha256、跨owner、失效UI会话、relay直接import、异内容同key、derived跨项目lineage、录音origin unknown/synthetic冒充人录、许可unknown当cleared、未知响应盲换key均必须被拒/阻断相应门；目录未配置必须blocked，不能扫描J盘或扩大root；读inventory不启动probe/render或注册。注册取消/连接断开后以实际receipt对账，不把界面关闭视为Host取消成功。


### D-01..07 追加反例（NOT_RUN）

P03：job result_ref尚null时无伪包；发布后以execution.run_id/ref.id读同package/version/hash，Ref指向别的项目/版本/普通script或stage必须拒绝。P05：在可信决定+Approval登记后、commit前断线/暂停/失败，允许已accepted但UI必须显示“采用待处理”；读取accepted gate或run running不得提前显示已提交/loaded，也不得启动依赖该采用的导出；同key恢复只执行一次，过期/事实变化重新审阅，不变影响不重复索批。P11：编码/QC receipt存在但未publish，无正式Delivery下载；producer attempt与publication execution换错必须拒绝。P13：inventory rights Ref逐字段同真实登记映射，分页cursor跨owner/project/filter失败；resource只读且不在原31工具中隐式新增。P06/P07：只有settings/markers computed时整工程不得loaded，captions/style未证的负例为必测。D-07共同基线未生成时所有未来实现与业务命令仍NOT_RUN。


### D-08..12 / D-01精确DTO补充（NOT_RUN）

P13真实未来POST使用RegistrationRequest，仅meta/project_id/candidate_id/source/license/recording_origin；变异注入relative_path、expected_sha256、attestation_ref等字段必须400。目录GET证据需证明未散列全部文件/未调用probe；只登记选定项进行验证。成功后候选过期重复同key仍返回同InventoryItem；新请求过期410、异内容409；nullable source.uri正确省略进入旧Host校验；cursor跨operation/root generation不可继续。P05补自动apply与Agent apply并发、change.approve兼容同subject去重，结果只能+1；target_snapshot_id尚仅预期时不能显示已commit。P10在完整目录rename/DB边界真实中断，recovery gate期间UI不报已加载、不新写，不伪造migration。P12组合新文件为tests/agent-driven/integration/created-render-delivery.test.ts和created-delivery-recovery.test.ts（待实现）；基座现有tests/agent-driven/media/render-snapshot.test.ts；未来完整命令为`pnpm test tests/agent-driven/media/render-snapshot.test.ts tests/agent-driven/integration/created-render-delivery.test.ts tests/agent-driven/integration/created-delivery-recovery.test.ts`，新文件和release前不得执行/称通过。


## readiness闭环补充

C1覆盖5个现有测试文件（creative-service、fixed-workflow-service、observation-ui、execution-guard、digest）及support引用，执行回归不授予修改全部测试权；service/guard按MAIN 03交BRIDGE，PRODUCT只写UI/明确release的native集成测试。P04需直接验证publishReviewPackage→#assertReuse落库reuse_of_package_id/gate_id。P05需覆盖created源分派不得进入旧M3 ready_for_adoption/native_plan门，legacy仍命中原门；current run running而commit pending不得显示提交成功。P06新真实producer/harness按MAIN 03 exact路径created-native-ack.test.ts、created-workbench-review.test.ts、created-workbench-headless.test.ts实施（均未来文件、当前NOT_RUN）；015两部分通过不能代替全parts。文档核对成功/子任务succeeded不算任何业务case通过，原readiness保持其历史BLOCKED结论，当前修订交MAIN最终06复核。


## P14 最终QC人类门与D13/D14恢复（P-A3 / IT-A06，全部NOT_RUN）

前置：R0与正式release后，真实committed成片、章包与cover门已接受、真实encode/QC证据、Host publishQcReviewPackage及同库created_review_gate_fact已实现；UI使用原工作台、原review.read/decide。入口：读取WorkflowRun的qc gate→关联五项chapter_pack→“交付质量确认”；自动inspect只建立pending，用户查看质量报告与所有warn，再可信accept；Host继续同Job发布。

必须变化：可信QC决定与必要warn disposition、绑定qc Gate同事务接受，之后才能产生正式Delivery/下载；纯QC接受不得生成采用Approval、改变source/revision、再次接受普通章门、改变已有封面/章节决定。待审Job queued且无lease、step waiting_user；确认后同Job重新claim，新lease_attempt不覆盖原execution attempt，实际package才running。证据：五part hash、完整warn/block列表、包/RunGate绑定、created_review_gate_fact/质量digest、decision/disposition行、Job/lease/step前后、ready/manifest/包receipt及source前后hash。

逐项负例：
- 普通chapter_pack已接受但无created_review_gate_fact，不得接受qc或发布；客户端提交target_gate/facts/新wire kind必须拒绝。
- 只完成ffprobe/full decode、Agent relay说已接受、关面板、旧样片/章节决定重放，不得qc accepted；无warn也不能自动签。
- 绑定包/项目/run/version/input/output/quality/render evidence或当前snapshot任一变化，旧决定拒绝/stale；UI不匹配禁提交。
- 新warn未展示、warn item_id或quality变化、缺disposition，不得静默passed；block不能任何accept覆盖；取消/暂停/授权到期仍阻断package。
- 重复同key仅回原决定；QC待审重启不重复inspect、不占lease；排队取消收敛step；确认与取消并发只有合法唯一结果。
- encoded后QC前真实自有进程丢失：从已登记不可变对象复验继续QC，不重编码；未登记孤儿不可公开。qc evidence不等ready；已发布receipt无DB授权不能正式下载，DB ready缺包必须阻断。
- SOURCE_ONLY成功Job已无lease，不能重新claim或拿旧TaskLease proof采用；proveForAdoption必须重建当前proof；往cp_a0_*塞新表不得靠放松schema检查通过。

未来命令（已读package test script；新文件当前未存在，不执行）：`pnpm test tests/agent-driven/integration/created-qc-review.test.ts tests/agent-driven/integration/created-schema-upgrade.test.ts tests/agent-driven/integration/created-render-delivery.test.ts tests/agent-driven/integration/created-delivery-recovery.test.ts`，BRIDGE负责新持久/门测试；PRODUCT的QC标题/警告/禁用/不匹配/关闭无决定用`pnpm test tests/agent-driven/product/observation-ui.test.tsx tests/agent-driven/integration/created-workbench-review.test.ts tests/agent-driven/integration/created-workbench-headless.test.ts`（后两为未来文件）。真实崩溃/媒体/多Host由MAIN预约单槽，不以纯UI桩替代；每个子case保留日志、exit与产物SHA，未执行全部NOT_RUN。

最终设计ACK D13..15；当前无ReleaseAssignment是预期停止边界，非文档缺陷。原Claude回执的历史BLOCKED与凭据违规不改写，当前方案已按MAIN最新裁决闭环，独立验收及产品人验均未开展。
