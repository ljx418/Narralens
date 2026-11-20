# A-R1-PRODUCT preflight handoff

状态：PREFLIGHT_COMPLETE / WAIT_MAIN_RELEASE_AND_WRITER_HANDOFF。此文档交付完成，不表示实现已启动；所有业务case NOT_RUN。

- cwd `/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-PRODUCT`；full HEAD/base `9f583239714835a89332fcae9363aa39d887821d`；contract `ca5b67a8285b130c79055317c6202f73cfbb99c8`。
- MAIN run `run_399f9dd3ce5a` / coordinator `term_a731c232-35c7-4f55-a75d-9b2beeade398`。
- 当前Codex `term_d8a84013-14ab-463d-8905-cd04cadbd6df`，task `task_d3b7bebb7e9f` / dispatch `ctx_18dd23415b64`；用户可见窗口保留。
- writer：PRODUCT Codex仅三文档；代码writer NONE；未来product-Claude未启动/未交接，无本轮Claude进程、日志、模型身份或实现SHA可报告。未启动任何helper/业务服务/测试/build/browser/Host/media。
- 初始dirty唯一MAIN提供 `ReleaseAssignment.json`；结束预期dirty该文件+TASK.md/HANDOFF.md/CLAUDE_IMPLEMENT.md，共4个未跟踪文档，tracked diff为空。ReleaseAssignment仍PREPARED_NOT_RELEASED且未改；19个产品目标完全未改（14已有/5拟新增）。
- 实际只读命令：pwd、git rev-parse HEAD、git status、rg/cat/sed源码与文档、Python hashlib四冻结文件/59条manifest核对、Orca技能指南读取。一次rg指定不存在http-router.ts返回2，改从creation-application/实际gateway/registry定位；非测试失败，未执行任何业务验证。
- 四合同hash/附属三设计hash/准备manifest/hash及完整路径清单在TASK；59条manifest匹配。R0证据仅读取，原minor归BRIDGE，未重复R0审查。
- 本票目标：P09 Bar/System真实消费，P03/P04/P05审阅决定消费与事实分层，P13受控素材登记UI，P02/P07/P10入口与失效状态消费。未来精确命令、资源门和NOT_RUN边界见TASK；全A/native/正式导出门不前置到本票。

## MAIN接线决定与下一writer条件

I1：原M5在Studio origin，created Gateway当前只readWorkbench，其余503；trusted_ui proof是Host origin/端口隔离，native_bridge不能读review-media。请明确本票真实可信consumer transport的生产者/方法/owner，或显式接受R1先交blocked consumer；PRODUCT不能越19文件改gateway或转发secret。
I2：原SelectionCoordinator选择committed clips，ReviewPart没有prepared→原player公开调用映射；请明确原player onOpenPart具体port和鉴权路径，否则该动作诚实禁用。不新建播放器/clock，未要求R2–R4完成。
BRIDGE已经承担D01 DTO/validator、完整workflow/review注册及review-media读取；实际导出符号和可联调fixture待交付，非公共设计重审。

下次移交先记录MAIN RELEASED/凭据持有人处置/transport决定、完整base复核与dirty、真实资源reservation及独立依赖；MAIN确认后在同Orca checkout让MiniMax Claude唯一写入，Codex只读。未确认前不调用相关Claude，也不静默Codex实现。429须核原调用和子进程停止/保全dirty，按MAIN明确handoff接管；>2返工MAIN接管根因。未新签独立/人验，不进B。

## 本轮文档产物摘要

- TASK.md SHA256 `9a338d522f9be05dfb52094f0f4803daee720386b5d00af5c6bd8147f7904ffb`。
- CLAUDE_IMPLEMENT.md SHA256 `67cf1a7a063d35b937fa9fec221c0466c4b9f741f6e69ed094e8ff79642d85a5`；完整原implementation-prompts/product.md附在后，前置R1约束明确缩小范围。
- HANDOFF自身不写自引用hash；最终通信可附现场摘要。

无业务日志/测试artifact/产品实现commit可列；后续必须记录真实argv/cwd/start/end/exit/hash、逐case PASS/FAIL/NOT_RUN与进程清理，不能用文档成功替代。


## CR-R1-001 有界接口复核 — 2026-11-11

本次 task `task_44d7531391f7` / dispatch `ctx_1e5e7f23b337` / Codex `term_f5aec503540e2586ba52299ef231db11`；只追加TASK/HANDOFF，未移交writer。实际HEAD仍 `9f583239714835a89332fcae9363aa39d887821d`，R0 scope-only结论不扩大。读取canonical implementation-20261111三个实际文件，输入摘要：
- `CR-R1-001-INTERFACE-LOCK.md` SHA256 `a5694b60e86b07ba05495625310bdac18c6cdc30315e0bd4e4b046a570e42a1b`。
- `contracts/gateway-ui.registry.json` SHA256 `40af12a3bd4a6b0a2dba4aee7a4d4092b155a2352bf9b2fb790a34c8eab7d765`。
- `ownership-delta.json` SHA256 `8027fb4fd83eab107c140a7aea3e5a8c803c8e31a5898d4fdd82040f62367d06`。

**ACK I1及目的隔离**：Host真实trusted_ui native-open铸造独立UI delegate；独立cookie/proof、parent活性/owner/generation及异步返回前复核，native-only/driver/native_read不授UI权力。UI lifetime不依赖旧native revision；commit后UI可读新Context但native仍stale，workbench.v1/native.reopen严格空input、固定project、复用原native-open与NativeEntry校验。闭集两条Gateway alias明确另计31 Host + 5附属Host + 2 Gateway；原CP31/80defs不变，不另造批准权威。独立UI map不能被现ControlledStudioAccess.#collect的native stale清理连带撤销；原自动native头可共存但不代替UI头，重复UI头也须拒绝。

**ACK证明与读取生命周期**：impact/preview read proof不含虚构Approval/transaction，不能用于adoption；成功SOURCE_ONLY不重新claim。MEDIA真实receipt/object域→BRIDGE当前package/part不可变绑定→Host/Gateway同authorised reader，reader.open失败释放FD，成功/Range错/断流/取消finally幂等close，客户端abort/revoke Blob URL。未将这些设计ACK当实际生产者或R2通过。

**I2方向ACK，仍有一个精确producer→consumer缺口（P-CR-01）**：第4节要求“预览receipt的真实fps必须与项目clock配置匹配”，但第6节receipt字段、part描述及reader.open返回均无fps，公开ReviewPart也仅Ref/download_ref；两条alias无元数据响应约定。具体反例：服务返回一个合法video/mp4与bytes/hash，实际编码25fps，当前M5唯一PlaybackClock在M5Panel.tsx:160固定30/1；浏览器HTMLVideoElement只给duration/currentTime，无法可靠取得有理fps，不得据内容类型/时长或项目fps证明预览实际30fps。即使现assembler声明30/1，该输入配置也不能冒充实际预览产物probe事实。请MAIN只补明真实probe得出的fps_num/fps_den由MEDIA覆盖receipt_digest、BRIDGE如何绑定并通过现媒体alias或已允许读取操作交PRODUCT的精确字段/验证方式；无该事实时R1预览必须诚实禁用，不能猜30。不请求新业务操作/第三alias，也不要求R2–R4前置。

现有M5 proxyRefs/video区域确实存在，但当前仅legacy projection分支显示；在本票M5Panel内复用为created单活动槽符合已选方案。review模式必须隔离现有native selection事件/捕获键盘处理，周期性相同selection报告不等同用户操作；实际native时间线变化退出review、保留原clock，缺观测frame不能用0伪装停帧。以上为实施注意项，可在已分配文件实现，不是另加接口阻塞或独立审计门。

所有权ACK：四项新归属为BRIDGE `contracts/agent-workbench-ui-v1.registry.json`，PRODUCT `src/host/m5/controlled-studio-access.ts`、`src/host/m5/controlled-studio-browser.ts`、`tests/agent-driven/integration/created-native-ui-transport.test.ts`；已有PRODUCT owner `src/host/m5/openfilm-studio-gateway.ts`纳入R1。未来本lane清单由19增至23（17已有/6拟新增），待MAIN更新实际ReleaseAssignment；本次不改它或CLAUDE_IMPLEMENT，不把delta当release。MAIN报告离线依赖三项成功且无package/lock变更，本lane未重跑安装/检查。

对应现有P03/P09/P13与新增created-native-ui-transport用例：native-only/driver/跨owner/错误origin或port/重复头/撤销/过期零副作用；commit后UI读新Context而native stale；native.reopen多字段拒绝；原DTO未知字段拒绝；错误part/hash/Range及各退出close；P-CR-01无fps或25对30拒绝；prepared预览单clock/音频焦点/退出恢复不自动播放。全为未来NOT_RUN，实际Headless依MAIN资源；无Claude/子worker/源码/重型检查。结论为有界设计ACK附P-CR-01，非产品验收，凭据处置/RELEASED/唯一writer交接仍保留。


## P-CR-01 最终字段闭合 ACK — 2026-11-11

本次 task `task_6a79751ffed8` / dispatch `ctx_f1203c44b93a` / Codex `term_8a1a083ef802feef8bdf29d6259736db`，仅追加TASK/HANDOFF。已读canonical CR-R1-001第8节及最终gateway registry；实际SHA256分别为 `7e9b61b339d9cf2bc80c7925e09139f6362eeee6ecc373a2bd142d4be0f895b8`、`8416e1abeec71b4e063df53c9e4974ea4ab1bab3b8f1f5ddfc280f5b5261e54f`，与MAIN更新的本地ReleaseAssignment精确一致；Assignment当前SHA256 `49cee76b6d9167c3aec0a3e419b47f6918b86286d2e8de3ff8910c79857181e6`。原记录摘要保留为历史字节观察，不覆盖。

**最终ACK：P-CR-01 / CR-R1-MEDIA-FPS在设计接口层已闭合，无本范围剩余反例。** MEDIA将实际probe规范有理fps/完整decode frame_count及audio样本事实绑定receipt_digest；reader metadata携带同一timeline/media_facts。BRIDGE经闭集 `workbench.v1/review.part.describe` 验证精确input、delegate固定project、当前package/part Ref与不可变receipt/object关联，返回精确PreviewMediaDescriptorV1，并finally关闭metadata reader。PRODUCT先校验完整身份/版本/Ref/摘要，再比较实际video fps、timeline及原PlaybackClock；通过既定媒体alias获取的ETag、blob bytes/hash与descriptor必须一致后才ready。旧metadata不能授权变化后的对象，读取不触发重渲染。

未来负向沿原P03/P09及本票transport测试覆盖：实际25fps对30/1拒绝，伪报30而probe25不发布receipt，缺fps/frame_count或错误package/part/receipt拒绝，metadata到bytes变更拒绝；audio按实际sample_rate/sample_count/channels校验而不伪装视频fps；失败不改clock/选区/author/version，metadata/binary所有FD关闭。全部NOT_RUN，非新增独立产品审计门。

新增describe仅为既有RPC的闭集只读operation，无第三HTTP、无冻结ReviewPart修改；native.reopen仍严格空input。I1独立trusted_ui delegate及既有单活动预览槽/单clock ACK保持。本地Assignment已列23 PRODUCT路径（17已有、6拟新增），状态仍PREPARED_NOT_RELEASED，未被本次修改；原19路径记录是历史观察。实际HEAD仍 `9f583239714835a89332fcae9363aa39d887821d`。无Claude/子worker/代码/测试/重型检查，凭据处置、正式release及唯一writer交接仍待MAIN；CLAUDE_IMPLEMENT原文保留，后续实际移交须同时携带此最终CR/最新Assignment，不让旧19文件说明覆盖新23路径。
