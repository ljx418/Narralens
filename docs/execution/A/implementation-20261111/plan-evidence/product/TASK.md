# A-R1-PRODUCT focused task — 2026-11-11

状态：PREFLIGHT_COMPLETE / PREPARED_NOT_RELEASED；产品实现、测试、领域验收均 NOT_RUN。此票仅 P-A1/P-A2 的 Bar/System/review/local asset 消费者子集，D01–D15继续有效，不重审架构、不要求R2–R4在R1完成。

## 身份、基线与当前权限

- cwd：`/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-PRODUCT`；实际完整 HEAD/base：`9f583239714835a89332fcae9363aa39d887821d`。
- contract commit：`ca5b67a8285b130c79055317c6202f73cfbb99c8`；documentationCommit：`f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450`；cp-a0-r4。
- MAIN：`term_a731c232-35c7-4f55-a75d-9b2beeade398`；run `run_399f9dd3ce5a`。
- PRODUCT Codex：`term_d8a84013-14ab-463d-8905-cd04cadbd6df`；task `task_d3b7bebb7e9f`；dispatch `ctx_18dd23415b64`。
- 当前唯一writer=PRODUCT Codex，仅本目录 TASK.md/HANDOFF.md/CLAUDE_IMPLEMENT.md；实现writer=NONE，计划product-Claude尚未启动/领取。
- 初始 `git status --short --untracked-files=all`对应唯一文件为MAIN提供的ReleaseAssignment.json；无已跟踪修改。交付后仅该文件加三份本文档未跟踪。不改ReleaseAssignment、Git索引或分支。
- MAIN R0 decision记录PASS_SCOPE_ONLY，0 blocker/0 major/1 minor，tsc 0、8文件123测试0、Python10向量；这是读取已有证据，非本lane重跑。R0-M01归BRIDGE：真实CP shutdown/reopen/resume及同DB同步release，生产任务激活前关闭；不重写已通过模块。

## 当前字节核对

四冻结合同全部匹配；准备manifest SHA匹配ReleaseAssignment，manifest的59个条目逐文件SHA256均匹配。只做字节核验，不将其算产品验收。

|文件|实际SHA256|核对|
|---|---|---|
| `contracts/agent-driven-a.schema.json` | `088a451e9646199618261a6cc95a84e3767dbf4cc87004f3e5995dda86b60964` | MATCH |
| `contracts/agent-driven-a.registry.json` | `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f` | MATCH |
| `src/contracts/agent-driven-types.ts` | `54356697802c0bf048e5cbcde1f54eb33713d4fe58943b346406804011cb3644` | MATCH |
| `src/contracts/agent-driven-validator.ts` | `f11a68bad982b7914e73f396ce48e99195ffc8fa88e842f137ffabf31900ea73` | MATCH |

- `docs/execution/A/contract-freeze.json`: `532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`
- `docs/execution/A/relaunch-20261111/artifact-manifest.json`: `2a847488f59259b196caeb22e0407327583fed6985516ed16fa9bf9a87aad0c0`
- `docs/execution/A/relaunch-20261111/contracts/asset-inventory-v1.registry.json`: `f326e0d7da655d4427f086c80ee9bd1af108672cedfdd8ad2dd8c91774d3a406`
- `docs/execution/A/relaunch-20261111/contracts/asset-inventory-v1.schema.json`: `45e1978432fbf26aa5afdd5b37986384bf074794cabb65b2a2f9ca6d171d6428`
- `docs/execution/A/relaunch-20261111/contracts/review-media-v1.registry.json`: `77290e4376ec013e0f7f75f8e6fccf02d1dede0a03623a4527280d75dfb8212e`

## 精确未来写入集合

19文件=14已有+5拟新增，16源码/样式/export文件+3测试文件。以下是未来RELEASED时允许的最大集合，改动应按实际需要；不是当前写权限。与03的product-Claude所有权取交集已核对。

|路径|实际存在性|
|---|---|
| `src/app/observation/WorkflowTopBar.tsx` | 已有 |
| `src/app/observation/CreativeReviewPanel.tsx` | 已有 |
| `src/app/observation/NativeSyncIndicator.tsx` | 拟新增，尚不存在 |
| `src/app/observation/LocalAssetRegistrationPanel.tsx` | 拟新增，尚不存在 |
| `src/app/observation/content-views.tsx` | 已有 |
| `src/app/observation/observation.css` | 已有 |
| `src/app/observation/index.ts` | 已有 |
| `src/app/system/SystemControlPanel.tsx` | 已有 |
| `src/app/system/system.css` | 已有 |
| `src/app/system/index.ts` | 已有 |
| `src/app/m5/M5Panel.tsx` | 已有 |
| `src/app/m5/GatewayApiClient.ts` | 已有 |
| `src/app/m5/SelectionCoordinator.ts` | 已有 |
| `src/app/main.tsx` | 已有 |
| `src/app/owned-project-client.ts` | 已有 |
| `src/app/agent-workbench-client.ts` | 拟新增，尚不存在 |
| `tests/agent-driven/product/observation-ui.test.tsx` | 已有 |
| `tests/agent-driven/product/local-asset-registration.test.tsx` | 拟新增，尚不存在 |
| `tests/agent-driven/integration/created-workbench-review.test.ts` | 拟新增，尚不存在 |

NativeSyncIndicator现实现位于content-views.tsx：若抽出，保持原export兼容及唯一判断实现。native gateway/pin、013/015构建、Host Ack/expected/store、created-native-ack/headless新测试、server/DDL/合同/包配置/其他owner文件一律不属本票；workbench-session.ts、panel.tsx、stores.ts只读。封存relaunch包及历史Gate不改。

## 实施顺序与真实端口

1. 复用WorkflowTopBar(Workflow/connection/observedAt)与SystemControlPanel(HealthRead/null、nowMs、只读probe callbacks)，在原M5最小挂载；横Bar默认折叠、节点详情关闭无控制作用，系统aside无遮罩/焦点锁且原selection/clock继续可用。健康15秒TTL、未来/无效/断线未知，不制造进度或自动执行服务命令。
2. 新agent-workbench-client消费冻结DTO与BRIDGE附属runtime DTO；只用现有可信UI入口，凭据由既有workbenchProofHeaders提供，不自行生成/跨origin转发。查询带当前project/run/package身份，异项目/旧版本/迟到结果丢弃；缺producer 503显示blocked，断线保留最后观察时间但不沿用ready。
3. LocalAssetRegistrationPanel读受控候选→声明source/license/recording_origin→POST RegistrationRequest→InventoryItem→重读Inventory；无任意路径/上传/自动授权。post仅meta/project_id/candidate_id/source/license/recording_origin；不发送relative_path/expected_sha256/attestation_ref。未知结果保留原key先对账，409不盲换key、410刷新候选，503不扩大root。Agent库存发现由BRIDGE，不让用户搬ID。
4. CreativeReviewPanel消费真实ReviewPackage和allowed_choices，五part同包、同一次可信决定、纯accept不采用、关闭不决定。accept_and_adopt返回ReviewDecision后读取Context/Workflow，显示决定已登记/采用待完成，commit与NativeAck独立。download_ref只接受本实例受控review-media URL；文本转义，不执行HTML，不把preview称正式Delivery。无真实播放适配时禁用并说明，不new播放器/clock。
5. NativeSyncIndicator只显示Host事实；R1无Ack producer时unknown/pending，严禁从job成功、accepted gate或commit补造loaded。P06–08完整native确认及P11–14完整导出/QC留后票；可保留其消费兼容性，不要求本票实现生产者。

|producer / 当前事实|consumer / 调用与约束|
|---|---|
|CreationApplication当前FixedWorkflowService({repository})，无facts/adoption；已有workflow.run.read/workflow.read，完整review handlers未装配|新client→GET /api/agent/v1/projects/:id/workflow、/context；run/review路径按冻结registry；读ReviewPackage三元组，POST原review.decide路径及ReviewDecisionInput；BRIDGE负责注册，不由UI放宽guard|
|BRIDGE health producer，原GET /api/agent/v1/health|SystemControlPanel读取HealthRead；只读刷新，不增加服务生命周期动作|
|BRIDGE待实现local-asset-http / asset-inventory，LocalAssetRegistry.import/list已有|GET /api/ui/v1/projects/:id/local-source-files；POST/GET /api/ui/v1/projects/:id/local-assets；Agent GET asset-inventory/resource。源schema本包asset-inventory-v1，runtime agent-local-assets-types/validator由BRIDGE提供，PRODUCT不复制成第二协议|
|MEDIA PreviewPreparedSource→BRIDGE review-media-http待实现|GET /api/ui/v1/projects/:id/review-media/:ref返回真实bytes/Range；原CreativeReviewPanel.onOpenPart委托原播放器/SelectionCoordinator，参考下方I2|
|已有owned-project-client + workbench-session|Host origin trusted_ui通过cookie+X-Narralens-CSRF；GET项目/native-open已有，main.tsx单React根；不读配置/secret|
|现GatewayApiClient / OpenFilmStudioGateway|Studio origin cookie-only；created模式只允许GET /narralens/api/workbench，其余503；不能凭新client宣称有trusted_ui relay，参考I1|
|SelectionCoordinator.selectClip/selectFromStudio/relocate；原PlaybackClock|复用唯一selection writer及同snapshot定位；不得将prepared source伪装committed clip；无clip映射不能跳到虚构时间|

## MAIN需要明确的有限接缝

- I1（真实生产接线前必需）：M5位于Studio Gateway origin；当前created Gateway仅readWorkbench，trusted_ui proof在Host origin且port-scoped，review-media明确拒native_bridge。请MAIN指定R1消费者在原工作台的可信transport交付方式及producer owner/方法，或明确本票先交无transport时blocked的consumer、后票接线。不能让PRODUCT擅改本票外gateway/workbench-session，不能开放CORS/复制cookie或把native会话升格trusted_ui。D01/D08协议与身份裁决不重议。
- I2（真实预览接线前必需）：ReviewPart仅Ref/download_ref，SelectionCoordinator仅已committed projection clip选择；当前未见可把prepared preview装入原播放器的公开port。请MAIN确认原player适配的具体call/owner与鉴权读路径；本票可先安全禁用不可用onOpenPart，不新增player、改vendor或以seek committed clip假称播放prepared。
- D01 runtime类型/validator与review handlers/媒体路由是已分配BRIDGE依赖，不是新架构问题；发布时需给可导入的实际符号和同一producer fixture，尚未落地前不假造可用性。无需R2采用/native或R3交付实现作为R1组件开工前提。

## 本票case与未来命令（现在全部NOT_RUN）

|原case映射|R1验证与负向|证据边界|
|---|---|---|
|P09 / A-UI / R4-UX适用|Bar折叠/节点Escape焦点返回、关闭不pause；系统aside打开仍选镜seek；过期/未来/无效健康/断线unknown|observation-ui现有；真实Studio浏览器留MAIN预约，不把DOM测试算整体验收|
|P03/P04/P05消费子集|五part/版本匹配、reuse显示真实lineage、allowed_choices、无impact不采用；review响应≠commit≠Ack；关闭零决定、旧包/跨项目/同key异输入拒绝显示|observation-ui + 新created-workbench-review；后者只有真Host装配后才算producer-consumer，mock只能组件证据|
|P02/P07消费子集|同工程入口、旧session/错误snapshot/无Ack仍未知，旧M5控件/selection/clock保持|现created-workbench-read/entry与M5回归；不要求013/015实现|
|P13 / IT-A04/A05|候选选择/声明/登记/列表同ID，未知结果原key；额外字段禁止、401/403/404/409/410/503、跨项目、过期重放与响应失配|新local-asset-registration + created-workbench-review；Host安全证明归BRIDGE local-assets-transport，组件mock不能代签Host许可/bytes|
|P10消费子集|断线保留事实时间、换项目/会话丢旧响应，关闭UI不取消|上述新集成文件；真实CP关闭恢复由BRIDGE R0-M01及MAIN负责|

未来 cwd固定本checkout；先由MAIN提供独立依赖/运行根，实际执行记录精确argv/cwd/开始结束/exit/log SHA256/输入产物hash。不安装、不自动下载，不共享可写node_modules/var/dist/profile/DB。版本检查需离线、禁止安装提示，当前未执行。

```sh
# release + writer handoff + 依赖到位后，按MAIN分配资源执行
corepack pnpm exec tsc --noEmit
corepack pnpm test tests/agent-driven/product/observation-ui.test.tsx tests/agent-driven/product/local-asset-registration.test.tsx --maxWorkers=1 --minWorkers=1
# 新文件创建且真实producer已装配；需MAIN Host资源预约
corepack pnpm test tests/agent-driven/integration/created-workbench-review.test.ts --maxWorkers=1 --minWorkers=1
corepack pnpm test tests/agent-driven/integration/created-workbench-read.test.ts tests/agent-driven/integration/created-native-entry.test.ts --maxWorkers=1 --minWorkers=1
corepack pnpm test:contracts
corepack pnpm run test:m5 --maxWorkers=1 --minWorkers=1
# MAIN全机单槽，真实Headless静音；未经预约不可执行
corepack pnpm build
corepack pnpm run test:m5:headless
```

完整product测试过滤可按审定提示复用，但不授予修改BRIDGE service/guard测试。全量check由MAIN统一冻结执行；不为本票加独立模块审计门。所有自动化Headless静音、不抢焦点；真实媒体/多Host/浏览器/全量需MAIN重型槽，当前预约NONE。

## 出门、保全与停止

本预检出门=三份文档和现场基线/接口/case清楚交MAIN，非实现ready或产品PASS。实施启动需MAIN实际RELEASED、凭据事件处置确认和唯一writer交接；本轮不新调Claude/其他worker，不读~/.claude、~/.codex、.env或dump env，不切供应商。实施候选以后须完整SHA、精确dirty、实际逐case/首失败/修复证据及进程归属，Codex分时只读复核；独立审查和人验由MAIN安排，不能自签。
回退由MAIN关闭新增mount/路由或明确撤销本票自身变更，保留原工程/历史候选/dirty；不reset/stash、不改DB或源；内容回退仍走受控新revision。无release、基线/合同漂移、越白名单、未知可信transport/播放映射、缺资源则只停相关依赖并报告MAIN。429须验证原writer及子进程停止、保全dirty后经MAIN本任务要求的明确handoff方能Codex接管；超过两次返工交MAIN根因，不擅自实现。A末停人验，无B。


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
