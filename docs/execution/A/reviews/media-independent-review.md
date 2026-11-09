# A06 MEDIA 独立只读审查

审查者：独立上下文 a_media_independent_review，未参与实现。日期：2026-11-09。结论：**NEEDS_WORK；不能签署A06整体通过或T20通过**。

审查基线：MAIN初始冻结 `4ed5461ef111353b3703294c5bef7bae984db1d1`；审查期间MAIN仅证据文档更新后HEAD为 `6b0f0ca11edcbbfec09c12593b2c0f9b646ae879`。MEDIA来源 `7439c0a9f3541c2d7345c2105dea3249e4cd725e`，base/contract `ca5b67a8285b130c79055317c6202f73cfbb99c8`，OpenFilm `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。已将当前37个DELIVERY.json列出的源/测试/工具逐项SHA256核对，0项漂移。行号均相对main-integration根；上游或依赖路径另注。

已阅读AGENTS.md、MEDIA HANDOFF/DELIVERY/MAIN接线请求、cp-a0/02_DATA_AND_RECOVERY.md及A06任务/模块说明；审查render/delivery/preflight和对应tests/tools，并读取实际固定上游与其已安装Playwright实现。仅只读命令（含git rev-parse与文件摘要）；没有改MAIN文件/Git/运行根，没有运行测试、Host、ffmpeg、Chrome或任何真实媒体探针。此文件是唯一写入。作者134单测只是其内部模块证据，本次没有重新运行，不能替代真实成片/T20。

## 需先处理的发现

### MEDIA-R1 · P1 · worker进程组消失不能证明Chromium退出

定位：`src/host/render/native-renderer.ts:141`（仅kill -workerPid）；`:239-241`的groupGone仅检查child.pid；`:279-284`在worker close且该PGID消失时直接finish(true)；`:388-395`worker独立组。`src/host/render/openfilm-offline-wrapper.mjs:67-72`只调用上游launch，没有登记/围住浏览器组。

真实依赖证据：固定上游 `packages/openfilm/src/host.mjs:222-226`调用chromium.launch；已安装 `vendor/openfilm/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/lib/coreBundle.js:8751-8764` 的launchProcess明确以 `detached: process.platform !== "win32"` 启动Chromium。Linux/WSL上Chromium是新的PGID，不属于worker组。media-process-policy只改ffmpeg/ffprobe参数，没有改此进程归属。

前置条件：真实Chromium已启动；worker崩溃或TERM宽限期内Playwright未完成browser关闭，继而worker被KILL。Playwright正常SIGTERM清理可能成功，但KILL/崩溃不能依赖JS清理。

结果：Chromium即使仍活着，worker PGID可已经消失，awaitChildExit仍可返回group_settled=true；RenderService据此释放attempt/允许重试，与T20-D/E和CP-A0“子进程及心跳停止后记录cancelled/unknown”冲突。不是声称每次取消都会泄漏；是现有判断有明确漏检类别。

复现建议（待MAIN预约，**NOT_RUN**）：记录worker/browser及后代PID、PGID与归属；在浏览器启动后让worker无法完成graceful cleanup并真实KILL worker。观察Chrome独立组及claim是否仍存活。必须证明所有本次自有浏览器进程已停止才可settled/release；否则unknown/reconciliation并保留claim。采用可靠OS containment或显式跟踪独立浏览器进程身份/回收；不能只增加worker组等待时间。新增测试应覆盖独立PGID，现有native-renderer测试用group_exists替身不能证明这点。

### MAIN-A06-R2 · P1 · 当前生产端口与路由尚未装配

定位：`src/host/render/render-snapshot.ts:62-75,177`仅定义依赖/服务；`src/host/render/ports.ts:111,134,216`仍是MAIN端口。全src/host搜索SnapshotRenderService、NativeRenderer、DeliveryService只有定义，无实例或消费；唯一render服务实例是 `tools/agent-driven/media/render-delivery.ts:231-238`。`src/host/agent-driven/application-dispatcher.ts:13-18`缺handler时明确CAPABILITY_UNAVAILABLE；`:26-51`现有helpers仅提供creative/workflow路由。server无MEDIA服务/下载注册。

前置条件：以当前冻结源码启动真实Host，经正式render_snapshot/delivery入口操作。

结果：还没有“已提交Snapshot→持久Attempt/授权复验→真实encode/QC→ready+receipt+outbox事务→认证下载→重启对账”的生产调用链。该项属于MAIN接线缺口，不误报为MEDIA违反白名单。具体要求已在MEDIA requests/A06-MAIN-INTEGRATION.md明确交付。

复现建议（**NOT_RUN**）：真实Host提交带ExecutionBinding的render任务，再读delivery及200/206/416下载；落盘后重启重放。逐步检查committed snapshot身份/闭包、旧revision、持久claim和cancel、事务内授权/fence、winner attempt与当前execution双身份、同DB outbox、reconciliation禁止新attempt等。仅内存harness/模块伪端口不算通过。

### MEDIA-R3 · P2 · 当前真实渲染harness必被自己附属项门阻断

定位：`tools/agent-driven/media/render-delivery.ts:104-108`声明REQUIRED_SUPPLEMENT_FILES，但没有使用；`:111-154`遍历所有文件统一输出 `kind: "native_source", rights_ref:null, role:null`，即使输入目录真的有subtitles.vtt和rights.txt也如此。`src/host/preflight/preflight.ts:190-210`仅在kind=supplement的entries中查角色；固定要求subtitles/rights。

前置条件：目录有合法film.html、真实素材、subtitles.vtt、rights.txt，上游pin通过，命令传合法expected-frames与spec。

结果：preflight始终报缺字幕/许可，不能进入真实编码；harness文档宣称运行真实pipeline的入口不可用。不是绕过许可的理由，不能删固定门使其通过。

复现建议（**NOT_RUN**）：用已授权fixture按注释运行harness并保留完整QC输出。应显式从已核实的fixture/许可事实构造asset/supplement分类与rights_ref，不静默给任意目录授清许可；测试至少检验合法fixture能到native_renderer，以及缺字幕/许可仍block。

### MEDIA-R4 · P2 · RenderService缺少约定的渲染前持久fence检查

定位：`src/host/render/render-snapshot.ts:192`claim后，`:205`读快照、`:254-278`复制并启动renderer；首次checkAttempt直到`:392`（encode+QC之后），第二次`:530`。接线请求§1.2明确规定“渲染前、发布前、提交前”三次检查；ports claim注释只承诺唯一占用，不承诺取消/授权状态。

前置条件：MAIN的claimAttempt成功，但持久attempt已cancelled/superseded（或随后在复制前被取消），AbortSignal尚未同步/重启后signal不存在；checkAttempt会返回cancelled。此状态在当前公开端口合同中有效。

结果：即使最终发布会被拦住，昂贵浏览器/编码仍先执行，违背停止派发及明确接线契约。生产caller可以额外防御，但当前服务本身未兑现该约定。

复现建议（**NOT_RUN**）：端口claim=true、checkAttempt=cancelled，renderer记录是否调用；应在复制/启动前返回fenced outcome且renderer调用数0。并保留发布前/提交前以及事务内复验。

## QC、重复winner与恢复边界的评价

已有代码层面的正向防线：committed字节由MAIN端口提供后再copy/hash；固定字幕/许可角色；rights拒绝unknown/restricted；ffprobe本地协议、全流真实decode参数；帧数/时长与closure比较；warn处置门；独占UUID对象+no-clobber receipt硬链接及fsync；同key loser核验winner且仅删自己的对象；下载要求持久ready/passed/manifest一致，并从同一fd计算媒体hash后提供Range。这些是源码设计结论，不是本次运行PASS。

取消后的已发布包允许保留但不得在缺持久ready时下载，代码有相应read gate。COMMIT_FAILED或晚取消后的包如何对账、如何将published winner的attempt与当前execution绑定并在事务中复验授权，完全依赖MAIN实现；不能从publish文件存在推导ready。

`src/host/delivery/qc.ts:244-291`检查AAC/单audio stream，`:350-375`完整decode；`:377-394`检查附属的hash/bytes/角色。它们**没有证明旁白确实混入且可听、画面不是黑屏、字幕可解析或对应影片时间轴**。零音量音轨仍是AAC且可decode，空字幕文件只要其committed hash/bytes正确仍可通过存在性门。这里不要求B阶段ASR/语义自动评审，也未找到A明确允许自行发明的音量/字幕对齐阈值，因此列为A成片实证/人工内容复核的未证明项，**不另立“必须实现ASR”的代码P1**。

绑定A要求：final-review/build-review.py:56规定A片60–180秒授权本地素材+真实中文录音；:57规定样片/首章同时审预览、旁白、字幕、镜头摘要与权利，正式双导出需真实可播放且SHA一致；execution-planning/01_EFFORT_AND_STAGE_PLAN.md:30,36要求A06真实成片/T20同冻结SHA。准入证据须含真实真人录音来源/授权、原生音轨与混音事实、导出抽样视听/人工确认、有效字幕与许可文件；不能以合成音或codec存在冒充真人录音。B声音/字幕高级质量范围不并入本次。

## 必须保持NOT_RUN的验收

| 项 | 本次结论 |
|---|---|
| 真实60–180秒授权素材/中文录音encode、全流decode、旁白/字幕/许可/画面人工复核 | NOT_RUN |
| 原生可编辑、重开、改单镜、两份不同committed snapshot真实导出 | NOT_RUN |
| T20-A真实ENOSPC/写失败 | NOT_RUN |
| T20-B真实非零、截断、损坏帧与完整decode拒绝 | NOT_RUN |
| T20-C两个真实进程并发/预置同名/winner不被删改 | NOT_RUN |
| T20-D取消+晚到，worker/Chrome/ffmpeg/lease真实收敛 | NOT_RUN；R1须修复 |
| T20-E encode/QC/publish/DB/events边界真实kill+重启恢复 | NOT_RUN；throw hook不算真实crash |
| T20-F真实权利/QC/附属篡改及修复重试 | NOT_RUN |
| T20-G渲染中真实提交新revision，旧导出绑定旧snapshot | NOT_RUN |
| T20-H重复读/下载200、206、416/重启后bytes与manifest不变且不重渲染 | NOT_RUN |
| 真实外网拒绝，包括页面、WebSocket、ServiceWorker、媒体嵌套协议 | NOT_RUN；静态规则不能替代负向网络探针 |
| A人工验收 | NOT_RUN；Agent不得代签 |

本次不复用作者134单测为上述任何一项PASS。修复源码会使当前hash绑定失效，需冻结新SHA并独立复核相应差异；真实统一验收需同一最终SHA。

## 摘要绑定

以下为审查时读取字节的SHA256（MEDIA全部37项另已核对DELIVERY.json）：

| 文件 | SHA256 |
|---|---|
| `src/host/render/native-renderer.ts` | `4c1ae6da9773c7e711b269f45ce2a4a1f5623f7014109d54bf46c541b69ec7ec` |
| `src/host/render/render-snapshot.ts` | `612df9d3c0b1426b2c36ea1f4158bbb8d0b2a575abfbf2723a5d1bc9e183aae2` |
| `src/host/render/openfilm-offline-wrapper.mjs` | `3da8a0b3a817d80bc9fad8be3d92f022b638c6919e4c959b9a5d895b62a08d30` |
| `src/host/render/media-process-policy.mjs` | `cfdd587f53987a787ed6fc89b3ad60956c88accd4901090bef21b20a82a755de` |
| `src/host/delivery/qc.ts` | `05f7efc080c134c50070b77dc8b57c153bd996e68388d005936a68244b3d7310` |
| `src/host/preflight/preflight.ts` | `16d1718b77f4824845993b119e67adb828e0a3a3b73b3c43c438d9c176aa7122` |
| `src/host/delivery/published-package-store.ts` | `16bd73ac07266f25a99daac1712216339542833bce6040e81bc07e85aa7ab1c6` |
| `src/host/delivery/delivery-service.ts` | `114f701a87d69bdbb92dfe040f1f8fa461bd270f50fda247ae4c8b055caf0b90` |
| `src/host/delivery/download.ts` | `b01d97ac0a4efcb96f4a0a1bda90289999584883f16c22b8fd0d6d36889c1003` |
| `tools/agent-driven/media/render-delivery.ts` | `a0d349bea391075b43475137b463fba0868754194a4a1665afacde78672d1154` |

实际Playwright1.61.1 coreBundle.js SHA256：`6be5c2ea035554e9b184b1dbc7aa5e7f1fb428dd1b5c202022858dcfae9bee27`（只作为本机实际依赖证据，不意味着纳入上游Git pin）。

## MAIN修复方向的残余审查（尚未审查修复代码）

MAIN拟在worker-local child_process policy强制detached:false，可消除已证明的Playwright JS启动独立PGID。但不能仅凭该补丁关闭R1：实际Playwright coreBundle.js:8848还以process.kill(-browserPid, SIGKILL)执行自己的force kill；改为非组leader后此操作可能ESRCH，须证明最终Host worker组回收仍收敛且不会卡在Playwright清理。Chrome/crashpad等原生二进制自行setsid/逃组，本次没有源码或运行证据，标**UNKNOWN**，既不声称一定发生，也不凭JS参数假定不存在。真实Chrome取消/强杀探针需记录全部本次归属后代、PGID和残留，才能关闭生命周期P1。

## MAIN R1/R4修复独立复核追加（工作树补丁，2026-11-09）

本节复核MAIN修改后的实际字节和已留日志；未参与修改，未运行测试/Chrome/Host/ffmpeg。Git HEAD仍为 `6b0f0ca11edcbbfec09c12593b2c0f9b646ae879`，本节源码是**未提交补丁**，不能将旧HEAD当作包含修复的冻结版本。最终冻结需另记录fullSHA及下列摘要。原报告结论/旧字节记录保留历史，不回写成当时已通过。

### R1复核：具体Playwright detached缺陷已修复并有真实Chromium定向证据

`src/host/render/media-process-policy.mjs:23-44`在任何上游加载前包装spawn/spawnSync/execFile，将options.detached强制false，并syncBuiltinESMExports覆盖命名导入；当前worker仍在自己的独立PGID启动，因此Playwright提出detached:true也不能另起PGID。pin中的policy SHA已同步，实测日志policy_sha256也逐字一致。

独立读取 `docs/execution/A/logs/main-media-process-r2/chromium-groups.json`、chromium-probe.txt/.exit及 `tools/agent-driven/media/process-group-probe.mjs`：normal-close与kill-group两次真实固定上游headless Chromium，各记录包含owner的6个进程，全同owner PGID；分别以code0和SIGKILL结束，remaining为空，probe exit0。这里“6个”包含worker本人，不将其误说成6个浏览器后代。新process-group-inheritance.test.ts确实以真实Node分别调用三个API检查PGID与子进程消失，非纯spy断言。

审查时另只读/proc，日志中的12个PID（3725140、3725152、3725154、3725155、3725170、3725173、3725213、3725225、3725227、3725228、3725244、3725246）均已不存在，当前无存活/僵尸。probe本身第35行排除Z状态；该后续复查只证明当前已消失，不伪称probe原始remaining规则自带零僵尸保证。

据此，**R1针对Playwright JS显式detached导致PGID逃逸的具体源码缺陷，可标FIXED / TARGETED_EVIDENCE_PASS**。原来担心Playwright自己的-browserPid forceKill与新策略交互，当前normal-close及Host组强杀两条定向路径均收敛，没有发现新的失败证据。

证据边界：probe只是launch browser，没有newContext/page或成片渲染；不是NativeRenderer的AbortSignal→TERM grace→KILL→awaitChildExit链，更没有DB/lease/job。只在browser ready时取一次后代快照，不能通用证明未来额外后代、极早daemon重归属或所有二进制setsid路径。故完整T20-D/E、渲染中取消、真实ffmpeg/浏览器工作状态的生命周期仍NOT_RUN，不因本定向PASS关闭整项恢复门。

### R4复核：已修复

`src/host/render/render-snapshot.ts:200-205`在claim后立即持久checkAttempt并检查预取消signal，非proceed不准备/复制/编码；`:271-280`复制后、renderer启动前再次检查。原有发布前和提交前检查继续保留。源码满足本次R4“渲染前必须查持久fence”的要求。

新增cancelled/superseded测试断言renderer调用0、无边界/commit并释放claim；原during-encode测试改成fakeRenderer实际执行后切cancel，因此不会被新的early gate虚假替代覆盖。只读最终测试日志 `docs/execution/A/logs/main-media-process-final`：typecheck.exit=0、tests.exit=0，14文件137/137。此为MAIN实际运行的日志，我未自行重跑；先前134/135失败记录保留，不隐藏为从未失败。

R4标**FIXED（源码独立复核；MAIN模块日志PASS）**。持久端口生产实现仍属R2，不能由本模块测试推断其真实DB状态已接好。

### 仍开放

R2生产端口/下载/事务/重启对账仍OPEN P1；R3harness分类错误仍OPEN P2。A片真人录音、画面、字幕、双导出及T20-A..H整体仍NOT_RUN。**总评继续NEEDS_WORK，不签署A06总PASS。**

低优先兼容性注记：当前policy在rest[0]为undefined/null时unshift options但保留原占位；execFile(cmd,args,undefined,callback)这种明确占位形式会把callback推到第5参。当前固定上游用实际已验证callback/options形态，未发现其使用该占位形式，因此不作为当前固定链路的新P1；若宣称支持Node所有重载，应清理占位并针对实际需要的形式验证。另promisify(execFile)的自定义返回约定不在现有callback探针证明范围。

### 本次补丁/证据摘要

| 文件 | SHA256 |
|---|---|
| `src/host/render/media-process-policy.mjs` | `bcadcfecda8080a337b1ceb14b2ffb96c42ba1f3f583f94a1eeceb46261f0559` |
| `src/host/render/render-snapshot.ts` | `baf4c3457eaee0ea67aaabfe5e79ce91f36cb3260edca670fff81da535851c30` |
| `src/host/render/openfilm-render-pin.json` | `a166bc74f7612917d11b39b03c3dc0c1d965cfde8acaca8cc1f24ec5efee2b3f` |
| `tests/agent-driven/media/process-group-inheritance.test.ts` | `61212fa04b02ef8fcf24c683156c44a2469fb029a72b7fb5eb3c675d8cacccc7` |
| `tests/agent-driven/media/render-snapshot.test.ts` | `037f7b5d59a2137a6b46562f883fe7416b6d394814b1078581782ed8130ddb45` |
| `tools/agent-driven/media/process-group-probe.mjs` | `7b151896505d685c7e0abf919b1e8ca731eb55a701c0179844e815bf75b00d37` |
| `docs/execution/A/logs/main-media-process-r2/chromium-groups.json` | `d10d673690b011f41a2eba2a2a14ba0058e247c2a023035dc527814eb3184113` |
| `docs/execution/A/logs/main-media-process-r2/chromium-probe.txt` | `702985fd31781862788dd6251409f5f4d4451b552c241a8cebe42e069ad55d11` |
| `docs/execution/A/logs/main-media-process-r2/chromium-probe.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `docs/execution/A/logs/main-media-process-final/tests.txt` | `9eaaf7f966fe99853bc383c52e8722cca1b9396511e28e988d256b1839a86b0d` |
| `docs/execution/A/logs/main-media-process-final/tests.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `docs/execution/A/logs/main-media-process-final/typecheck.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |

## 最终提交绑定追加：10fe3d1

只读复核修复提交fullSHA **`10fe3d122a1b87bb3c710743861bc10aa8f4ac16`**。读取时当前HEAD已经是PRODUCT文档提交 `218c40cb9a90b6a33359c5d0f556991166002eef`；对上述两SHA限定render/delivery/preflight、MEDIA tests/tools执行只读diff，无差异。本节没有重复整模块审查，也没有运行测试、Chromium、ffmpeg、Host或探针。

最后增量已确认：policy在options为null/undefined且有占位时先shift再插入受控options，保留callback正确位置；真实Node测试新增明确undefined options调用，结果数4。前节低优先options占位兼容性注记现标FIXED。没有据此宣称Node全部可能API/平台均通过。

强化版process-group-probe在等待remaining时不再排除Z，按pid+start身份等待采样对象全部消失。MAIN r3证据normal-close/kill-group各采样6个进程（**含worker，即5个后代**），全同owner组，remaining=[]，分别code0/SIGKILL，probe.exit=0。policy_sha256与本节源码一致。原来“probe忽略僵尸”的局限已在此次采样路径修正；一次后代快照、未打开页面/未渲染影片、未经过生产NativeRenderer取消/持久lease的范围边界仍保留。

只读验证r3日志：typecheck.exit=0，tests.exit=0，14文件137/137；不是审查者重跑。artifacts.json列出的7项日志SHA逐项重算，全部一致。历史失败不删除、不改写。

**最终判定保持：R1具体Playwright detached问题FIXED / TARGETED_EVIDENCE_PASS；R4 FIXED；R2生产接线P1、R3harness P2仍OPEN。A06整体NEEDS_WORK，真实成片与完整T20-A..H仍NOT_RUN。** 不将本次进程归属定向实测当成真实成片或T20端到端恢复通过。

最终修复源码/证据字节绑定如下：

| 文件 | SHA256 |
|---|---|
| `src/host/render/media-process-policy.mjs` | `bcadcfecda8080a337b1ceb14b2ffb96c42ba1f3f583f94a1eeceb46261f0559` |
| `src/host/render/render-snapshot.ts` | `baf4c3457eaee0ea67aaabfe5e79ce91f36cb3260edca670fff81da535851c30` |
| `src/host/render/openfilm-render-pin.json` | `a166bc74f7612917d11b39b03c3dc0c1d965cfde8acaca8cc1f24ec5efee2b3f` |
| `tests/agent-driven/media/process-group-inheritance.test.ts` | `61212fa04b02ef8fcf24c683156c44a2469fb029a72b7fb5eb3c675d8cacccc7` |
| `tests/agent-driven/media/render-snapshot.test.ts` | `037f7b5d59a2137a6b46562f883fe7416b6d394814b1078581782ed8130ddb45` |
| `tools/agent-driven/media/process-group-probe.mjs` | `7b151896505d685c7e0abf919b1e8ca731eb55a701c0179844e815bf75b00d37` |
| `docs/execution/A/logs/main-media-process-r3/chromium-groups.json` | `8d2ae4175d523aec1df2d0ddc69a6bc147c5c025d55919ac0f12d757ffe45ccc` |
| `docs/execution/A/logs/main-media-process-r3/artifacts.json` | `ce4619c1fa0059fe28cc209a2d13c014b40625575f216612d088350dcf61755f` |
| `docs/execution/A/logs/main-media-process-r3/tests.txt` | `4981b27a75c7e8dcbba6b329d56e1c166bcd2465d4394b704051ef9364e87508` |

## R3 harness helper/CLI接线独立增量复核

本次仅只读源码、测试和MAIN已留日志；未运行tests/Host/ffmpeg/CLI。读取时HEAD `218c40cb9a90b6a33359c5d0f556991166002eef`，harness修复尚为工作树字节，以本节摘要绑定。

原R3的“即使有字幕/许可也因全部kind=native_source必block”根因已修正：render-delivery.ts实际import并调用buildHarnessClosure，--rights-manifest路径传入helper；harness-closure.ts:17,50-53将顶层已知字幕/许可名分类为supplement、设置相应role。识别的媒体分类为asset。没有manifest时rights=[]，不再自动生成cleared许可；有manifest时要求显式path/SHA/asset ID/rights ref/status/commercial/evidence，校验精确字段、相对路径、摘要、重复和跨行ID/ref别名，声明的文件必须存在于实际闭包。目录拒绝symlink与非普通文件。现有SnapshotRenderService/preflight的必需角色和许可门保留。

MAIN main-harness-rights日志只证明tsc.exit0、6个helper测试通过（分类/无虚构许可、明确声明、错摘要、缺文件、跨别名、symlink）；fixture的clip.mp4明确是不可播放诊断字节，film.html也不是有效影片。这些测试不是实际CLI、native render、成片或T20证据。**原R3必block源码缺陷：FIXED；真正render-delivery CLI到encode/QC/package：NOT_RUN。** 必须以后用已授权真实fixture实测，不能将手填operator declaration升格为生产版权权威；其evidence_ref目前是非空操作员声明，并未外部核实许可内容。

残余 MEDIA-R3b，P2：`tools/agent-driven/media/harness-closure.ts:18,53`按媒体扩展名识别asset，但遗漏woff/woff2/ttf/otf等字体。前置：合法film.html引用font.woff2，所有其他媒体/字幕/许可均有显式声明，唯字体无声明；字体会落native_source/rights_ref=null，preflight只检查asset/supplement，因此无声明字体不会block。现有真实源fixture包含font.woff2，非凭空猜测资源类别。建议将字体纳入asset或对未知资源fail-closed，并检验未声明字体被挡；不能泛称任意资源缺声明都受门控。复现建议尚NOT_RUN；本问题只针对诊断harness分类，不能据此推断尚未实现的生产SnapshotReadPort有同一缺陷。

总评仍**NEEDS_WORK**：MAIN生产R2开放，R3b残余分类问题需处理，实际成片/CLI与T20仍NOT_RUN。

| 本节文件 | SHA256 |
|---|---|
| `tools/agent-driven/media/harness-closure.ts` | `9776b70d5f422911e296a20552372d0055c136ace1e2973de4df8f5060ef0ecc` |
| `tools/agent-driven/media/render-delivery.ts` | `b16fdc392b09c47240e01c551e7ccc91ae5af5a1f26aa81d41a3d4f16270f80a` |
| `tests/agent-driven/media/harness-closure.test.ts` | `04184b98723c55cfc6e5d05e75d048c46229554cf5050370593b41876c69fb44` |
| `docs/execution/A/logs/main-harness-rights/tests.txt` | `e765caf819b31855b477c86e181301f58dc81f6631f68b288feda3bed73e3048` |
| `docs/execution/A/logs/main-harness-rights/tests.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `docs/execution/A/logs/main-harness-rights/typecheck.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |

## 最终增量复核：3476b40955e1267568547f0f73d429a22a7aa217（2026-11-10）

只读确认HEAD为上述fullSHA，git status --porcelain为空。本次只读差异、源码、测试、日志、实际文件摘要，不运行测试、render CLI、Host、ffmpeg或Chrome，不修改MAIN及运行根。本节覆盖自上节之后的harness分类/诚实输出、本地fd协议修正及其诊断实证，不重新签署整个模块。

**R3及R3b源码缺陷关闭。** harness-closure.ts只把html/htm/css/js/mjs/cjs/json视为native_source，已知字幕/许可为supplement，其他未声明资源全部asset；字体和opaque.dat不再逃过rights检查。声明仍按实际SHA绑定，不存在文件、跨ID/ref别名、重复、symlink继续拒绝；未声明asset仍无rights_ref，由既有preflight阻断。新测试含font.woff2与opaque.dat。只读main-created-foundation-r2日志：helper8/8包含于7文件90/90组合，tests.exit0及typecheck.exit0；不把历史main-harness-rights的旧6/6日志当成新版8/8证据。

**首个真实CLI失败保留且原因可核对。** main-harness-real-first/worker-failure-response.json明确报“Protocol 'fd' not on whitelist 'file,pipe'”，encode未完成。当前media-process-policy将每个ffmpeg输入及ffprobe的协议集合扩为file,pipe,fd；只添加本地文件描述符传输，没有新增HTTP/网络协议。pin policy摘要已同步且独立重算一致。代码注释称“FFmpeg 7”而实际inventory记ffmpeg6.1.1，属于注释版本表述不精确，不影响本次由真实错误指明fd需求的因果证据；不据此声称所有FFmpeg版本验证。

**真正诊断CLI到encode/QC/package现有实证，原来的CLI NOT_RUN仅对此狭窄case升级。** 读取main-harness-real-r2/capture.json记录的实际命令及render.exit=0、render.txt。输入为make-diagnostic-project.ts生成的1秒/30帧、3个page clip、320×180影片，440Hz合成测试音；字幕明确说不是人类旁白，许可/manifest明确为内部生成诊断事实。未混淆成授权真人素材A片。

日志输出MODULE_PACKAGE_CREATED，failure=null，只有encode_finished / qc_finished / package_published三个真实技术边界。ffprobe实体显示h264、AAC、单视频/音频流、30帧、1.000000秒；full_decode.log为空且QC记录完整decode通过。只读独立重算capture列出的3项日志摘要，0不符；进一步核对inventory列出的15个实际文件的bytes及SHA256，0缺失/不符。真实MP4为40274 bytes，SHA256 `a90543f11554712051704a3e7fc4d682b8be28f75c982bd183bc9b83e24960e3`，与manifest.media_ref一致。字幕/许可/原生附件、probe/decode及published receipt均有实际文件和摘要，不仅是stdout断言。我没有重跑decode或播放，不额外签署视听内容。

**诚实输出改动确认。** render-delivery.ts:109-112的commit只是明确的diagnostic sink，不再发送假的ready_committed/events_published；:190-194成功只报MODULE_PACKAGE_CREATED，production_ready=false、durable_commit=false。内存fence仍是harness专用，内部RenderOutcome.ready不能被转述为持久生产ready。此次输出/边界与实际日志相符。

判定：R3原必block分类、R3b字体许可漏检均FIXED；当前一秒synthetic fixture的实际CLI encode/probe/full-decode/atomic-package为**DIAGNOSTIC_EVIDENCE_PASS**。不外推真实人类中文录音/60–180秒授权影片、可编辑重开改单镜双导出、生产鉴权下载、SQLite ready/receipt/outbox事务、重启对账或任何T20故障矩阵case已通过。R1/R4此前具体修复结论保持，MAIN生产R2及完整A/T20仍开放，**总评NEEDS_WORK**。

| 本次源码/证据 | SHA256 |
|---|---|
| `tools/agent-driven/media/harness-closure.ts` | `de0bcad153cbc17846da330382fcc064d303bac81c4aebf548b112a01ca6ddd9` |
| `tools/agent-driven/media/render-delivery.ts` | `8f57fbe56d3869cfc298b0fab42a9f1a2bd01237a148630c525317cacf7e1fdb` |
| `tools/agent-driven/media/make-diagnostic-project.ts` | `7252eaab3ea57322c186447eccb14c8be3e8a0025eb9ef50ba49532593c5b78e` |
| `src/host/render/media-process-policy.mjs` | `3d448ff79c497ee5e123f6931c554a716bc033088e05e701e1de42e48ae995bc` |
| `src/host/render/openfilm-render-pin.json` | `1b0ddd3dd031352092ae83535f598c7bda1f1ca2cccbb83ad9e377a0ec71bb06` |
| `tests/agent-driven/media/harness-closure.test.ts` | `ed51d03d32cef4867403c4e8ed34ea034589746b2405becc60be1eebc88d2c88` |
| `docs/execution/A/logs/main-created-foundation-r2/tests.txt` | `c6f039fbdabd852dfe100c7f41b4bc473df7931c0dceff0f4bb7e8fc2dd54549` |
| `docs/execution/A/logs/main-harness-real-first/worker-failure-response.json` | `62f46506eb708ee625ab4a5e97c50f47b3f7eff7cba753c45f593c58860b9cac` |
| `docs/execution/A/logs/main-harness-real-r2/capture.json` | `b742e97c70913e4cccc0b28925e6f98dd1aa941bb2aaa9f2866721eefadbed23` |
| `docs/execution/A/logs/main-harness-real-r2/artifact-inventory.json` | `fb0ea7f0703ed5095e41925437d802f2a3191dd36ee658a5e35fc8319e7c29aa` |
| `docs/execution/A/logs/main-harness-real-r2/render.txt` | `22d01f16f3bdd5b8c5807772ab93b26180a510ae7de5bdbbc37b858a8daf6ab5` |
| `docs/execution/A/logs/main-harness-real-r2/render.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
