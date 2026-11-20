# A057-04 独立结算设计复核 B（方案，不是实现或新候选验收）

绑定冻结 W `1d348d419120f23f45d958112ea8c43df5a04675`，固定 V `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。结论：**原公开API不足以修复；需明确批准一个能看到原始任务与资源出生/关闭的最小seam。建议评审Host持有、逐字节可验证的派生观测适配，默认保留共享browser，接受原生JOB对peer的影响；若合同要求peer物理存活，则改选owner隔离，不能同时承诺原共享语义与故障隔离。** 所有runtime、测试、构建和反事实均NOT_RUN；本报告不授权改vendor/pin、运行资源、派发或实现。057仍REQUEST_CHANGES，NEXT仍pending。

## 已重新核对的真实链

冻结 W `openfilm-upstream.ts:399–406`只登记 `loaded.pageFrame` 返回promise，finally立即减calls；`:412`等这个集合，`:417`仅最后owner关共享browser。桥`:1102`beginDraw，`:1109–1111`用同一个公开promise finally endDraw。workspace`:727`await bridge.draw，`:815–819`捕获拒绝后释放POST/PRE，所以公开promise的拒绝被错误地当成没有消费者。

固定 `pageframes.mjs:268–291`的JOB45s定时器在`:274`先调用 `void closeBrowser()`再拒绝race；原 `pageFor(...).then(use)` 是`:276`另一个仍可运行的work。`:282/295–299` forget也不await `page.then(p=>p.close())`，`:332`LRU eviction亦如此。`:183–188`先保存b、令全局browser=null、清open，然后才await旧launch和旧browser.close，且吞掉close拒绝；因此再次closePageFrames既不引用旧b也不证明旧close已结束。`:317–321`launch和FilmPage.open可能在超时后才交付资源。

固定 `host.mjs:257–262` inTime只race不取消；`:278–285` whileMoving也可留下原evaluate/progress evaluate。FilmPage.seek`:382–410`原page.evaluate及stuck探测可越过公开seek拒绝；capture`:417`原CDP send可越过30s拒绝。FilmPage.open`:301–302`先建context再建page，导航/ready失败部分路径会close context，但未完成open还没有可供外层返回的FilmPage。`:431`close就是await context.close；`:222–229`launch在真实chromium.launch完成后才把browser纳入LIVE，`:235–237`closeBrowsers只看当时LIVE快照，既不能覆盖未完成launch，也不适合只关闭当前owner。

因此仅加 `await closePageFrames()`、套finally、等public work、sleep45/60s或轮询一次isConnected都不成立。closeBrowser吞掉错误时，Host也不能从它resolve推导genuine close成功。

## 最小推荐方案及新增授权边界

这是一个需要MAIN批准的派生观测seam，不是已有API的小补丁。禁止写V、改pin或重写draw/seek/cache算法。Host读取并校验固定pageframes/host及实际执行依赖，按固定AST位置生成只读派生入口：保留原pageFrame/draw/withPage算法、FRAME/JOB/CAPTURE预算、cache key/版本/文件写入完全原样，只添加原始工作登记、资源观测与受控retire入口。派生清单同时记录upstream源SHA256、变换器SHA256、锚点唯一性、派生输出SHA256和实际加载路径；它是受审派生适配，绝不能声称执行字节仍等于vendor文件。相对import和import.meta.url资源读取须保留原固定根解析，不靠复制到临时目录后碰巧可用。不得原地覆盖当前ESM缓存的模块，也不得全局monkey-patch Playwright/FilmPage.prototype。

最小所需两类观测缺一不可：

1. **pageframes内部任务seam**：在race之前登记原withPage.work、pageFor/opening、原launch、forget/LRU close链，以及JOB/idle/explicit closeBrowser各次调用的原promise和browser epoch。计数必须在调用/出生之前占位，而不是then完成后才记录。withPage把实际(url,w,version,opening身份)绑定到Host私有draw token；这是原值，不由Host重算stamp/key算法。提供仅接受该token的 `retireDrawPage`，调用原forget的清除语义，收集并await原close链，防止后续原open map复用已关闭FilmPage；需校验map项仍为本次opening。retire是新增生命周期控制，须明示对缓存页复用的影响，不能伪称完全无行为差异。
2. **底层资源seam**：pageframes的host依赖经局部facade调用原固定 `launch`、`FilmPage.open`；原host算法不改。把原browser/context/page/frame/CDP对象按WeakMap稳定包装，方法以原对象为this执行，登记原始launch/newContext/newPage/goto/evaluate/waitForFunction/CDP.send/close promise，再返回保持原语义的结果。包装FilmPage.open传入的browser，确保context创建、newPage、newCDPSession得到的对象同样被观测；page.frames/mainFrame/frame及context pages、事件派发带来的句柄不能漏掉。原FilmPage实例方法仍执行固定算法，其 `.page/.context/.cdp` 是已观测对象，所以原seek里面被race的evaluate以及capture里的CDP原promise能被登记。close原promise在上游catch吞错之前登记；同时记录真实context/page close与browser disconnected事件。若确定固定执行路径不调用某类API，须有静态调用清单与漂移拒绝；不能用泛泛Proxy便宣称已覆盖全部浏览器资源。

只做第二类proxy不能直接看到私有withPage.work和forget/late close链，只做第一类也看不到inTime放弃的evaluate/send。因此建议显式组合，而非声称原host/pageframes公开export已经足够。可以用经评审的局部import替换+少量观测插桩；不要利用全局module loader影响别的Studio或renderer。若团队无法提供可验证隔离加载，放弃此路线，采用下述独占进程方案；不靠不可靠patch闭环。

## 私有接口与所有权

建议概念接口（不是已实现API）：

- `admitDraw(issuedOwner, servingBinding, inputLease): DrawTicket`，同步发唯一token，绑定producer实例、workspace_ref/generation、serving实例+origin、PRE allocation namespace、realm/browser epoch，外界不能自造或替换。accepted在ticket发出即增加，排队中的调用也有owner；关闭先封新admission，再处理已接单。
- `invokePinned(ticket, request): Promise<Buffer>` 是原操作结果；独立 `settle(ticket): Promise<SettlementReceipt>` 证明资源而不是复制这个结果promise。raw operation ledger记录(resourceId,parentId,drawId,ownerId,epoch,kind,promise,terminal event,primary/cleanup error identity)；不同owner对同一browser是共享引用，context/page按真实资源身份归属，不能只按url/FD整数猜。
- `retireDrawPage(ticket)`在成功/失败后销毁本次context并移除对应open项；共享browser保留。所有可能晚到的launch/open/context出生也必须被计数，且closing/tombstoned draw不得继续创建或发起evaluate。过期token不能让晚到资源成为无主对象。
- `closeOwner()`、`closeServing()`、`settle()`都复用同一settlement promise；`UNSETTLED`不是receipt成功。保留primary和每个genuine cleanup错误，禁止只保留最后一条message。

PRE不能在workspace原来的无条件finally释放。推荐让桥的完整draw promise在结果可知后继续await真实settle，才endDraw和向workspace返回/拒绝；workspace再做POST/清理/final witness。若为了及时报告超时先向调用者拒绝，则必须把PRE+serving+ticket移交给显式quarantine owner，原finally不能再释放，owner.close也不能PASS。不能只改错误码却保留原finally。

**正常成功也要处理持久cached page。** pageframes默认保留最多4页，页面/iframe脚本在截图完成后仍可能加载源资源。单纯等一次evaluate/send全部resolve不等于没有未来请求。最小可核对选择是每draw完成后调用上述retire，关闭并evict它的context；下一次同页重新open，保留原browser与原算法，代价是损失跨draw页面复用。另一选择是把输入FD和serving租约显式转移给cached-page lease，直到真实eviction/context关闭才释放，但这扩大FD/租约/替换版本设计，不是本轮推荐最小解。不得悄悄释放PRE再让cached page继续活。

## 线性化顺序与失败

每个共享pageframes realm使用Host的FIFO执行门：admission立即计数，实际调用原pageFrame前等前一个ticket完成真实settle，而不是原queue的公开race结算；不能在JOB失败与旧清理之间把下个任务送入同一realm。这个门不改原算法，却会令异常恢复更慢；queued peer超时/取消只撤自己ticket，不能释放正在工作的ticket。ALS可帮助归因，但不替代显式资源/epoch引用；内置定时器close、已有context和复用资源必须有确定账本归属。

成功：原pageFrame和文件写入完成 → 封该draw新资源出生 → retire真实context（含iframe）且evict → await原open/work/evaluate/send/close链及出生计数归零 → 对应serving HTTP/stream/ffprobe完成或取消并实际退出 → receipt → endDraw → workspace POST/释放/最终witness门。底层依赖关闭的顺序先关context使卡住evaluate失败，不能先await那个永远不resolve的evaluate；关闭过程中仍保留输入/serving。 此处drain应使用内部folder请求/probe账本（冻结adapter:625–629本身可等待且不关闭listener）或新增私有等价接口，不能递归调用serving.close：后者先等待accepted归零，会与本ticket的settle形成死锁。FIFO门持有期间无下一个draw产生新请求，context先销毁后再排空该serving；listener直到真正closeServing阶段才关闭。

seek/capture失败：先保存原超时/FrameError，不产witness → 关闭该context、await被race丢下的原work与原close链；同realm gate仍持有 → drain请求/probe → 结算才endDraw/PRE release。close原promise拒绝但资源已实际关闭，也要保留genuine失败而不是吞掉；若真实关闭/出生仍未知，进入UNSETTLED、保留资源责任，不能声称排空。有限服务截止时只报告截止与仍持有哪些对象；固定sleep不能转为成功。

JOB失败：定时器触发的**旧browser epoch**必须在全局变量归null前入账；等旧launch/close而非再读当前browser。原native close可能已令peer context关闭，相关peer状态失效，peer未来任务可在settle之后重新创建；不得自动重试失败的已接draw来伪造成功，也不能在同版本失败缓存30s内承诺立刻重绘。若旧launch晚到，先登记真实browser，再按closing epoch销毁并等其close，不向原use暴露可继续工作的资源；原续体尝试操作已封epoch时应明确拒绝。重复close只等待同一账本，不能另起一次空close认为旧close已完成。

若Playwright通道损坏导致raw promises、资源事件或launch无法可靠结算，同进程共享realm没有普遍可证明的有限时终止方案。明确标UNSETTLED，保留FD/serving及原因，只允许批准的资源回收；不能把永远failclosed/禁用真实producer算修复。需要有界强制终止保证时，应选独占进程路线。browser.close/disconnected证明浏览器执行面已终止还不等于本地ffprobe已reap，后者须独立drain；也不能从Node子进程exit推出其Chromium后代自动消失。

## peer语义必须分开

原pageframes模块本身一个browser/open/queue；JOB和idle都全局closeBrowser。这会影响同一模块实例的所有owner缓存页，无论Host有没有调用owner.close。维持共享模块却承诺“JOB下peer page/browser完全不关闭”在物理上不可满足。应把审查A057-04的peer要求澄清为：Host关闭A/seek失败不得主动杀B，原native JOB引发的共享browser断开按真实失败报告并按epoch结算，不冒充无影响。如果必须保证A JOB不影响B真实运行上下文，必须独立browser/module realm；这是一项架构变更待MAIN选择，不是我代批合同缩窄。

## 替代路线与规模

| 路线 | 能解决的事实 | 缺点/边界 |
|---|---|---|
| 原API外包Promise/二次close | 只能看到公开返回/可能新browser变量 | 不可接受；旧close与late launch不可见，仍有A057-04 |
| 推荐：可校验派生观测seam+局部资源facade+逐draw retire | 保留原渲染算法/共享browser；能跟踪raw任务、晚到资源和具体关闭 | 中等偏大修复，绝非几行finally；约2个新adapter/ledger模块+bridge/workspace接线+1–2个专门真实测试文件；失去跨draw page复用，需验证性能与顺序；同进程无法保证任意坏通道有界reap；native JOB仍影响peer |
| 每owner独立module realm/worker线程 | 独立pageframes全局状态，A JOB不会直接关B的browser | `import(url?x)`不等于完整依赖realm隔离；vm/worker loader、Playwright共享依赖、退出与browser后代仍需证明；单有realm不能看到原raw races，也不能让线程退出等价Chromium退出 |
| 每owner或每draw真实受控子进程 | 固定模块原字节可直接执行，不需改渲染算法；能为超时建立独占资源终止边界，owner间故障隔离 | 需要唯一process-group/浏览器后代归属、spawn前登记、late launch防护、IPC权限/Buffer上限、信号+真实reap；正常draw若还用公开Promise立即回收仍有旧问题，必须先关独占browser并证明退出再发settled；子进程exit不是自动递归kill证明；每draw重启成本最高 |

进程路线可在失败时只终止已证明独占的owner进程组及其browser后代，并核实全部退出；绝不能按进程名字或共享browser PID无条件kill。所有新启动/端口/Chrome/GPU重型资源与派生seam范围均需MAIN精确release，不由这份设计授权。若MAIN优先最小源变换且需要强故障隔离，可选择独占owner进程，但应按新的实施规模评估，而非把它叫纯小补丁。

## 建议涉及文件与验收

现有改点仅拟 W `src/adapters/openfilm/openfilm-upstream.ts`（issued factory、settled接口、bridge计数）和 `src/host/agent-driven/created-native-workspace.ts`（PRE责任与uncertainty/receipt门）；新增拟 `src/adapters/openfilm/pinned-pageframe-settlement.ts` 和局部facade/verified-derived-loader文件，具体名字由MAIN单owner分配。若选择子进程，还须单列worker-entry/supervisor与进程ownership，不混入已有fixture helper静默启动。合同/锁/Approved015/vendor不改；派生完整性manifest是新增交付合同，需审查实际文件清单/输入依赖。测试可扩展native-cache-witness或新增专门settlement suite，保持原Q02成功晚依赖、Q03多frame、K05清理原因测试；新cases详见同名JSON。

必测真实seek15s/JOB45s/capture30s、late launch、两个owner、关闭前后故障与正常连续帧。用真实本地页/真实browser/真实请求和可控barrier证明顺序，不用mock producer宣称实际timeout覆盖。对late launch无法自然稳定制造时，标明“真实资源+交付barrier注入”；不要冒充实际系统launch迟滞。底层raw promise、资源close/disconnected事件、serving请求/probe与FD释放必须有同一ticket的序列记录，断言endDraw和release不早于实际终止，日志总数/耗时不代替证明。仅成功路径、固定sleep或重复close不应通过。

本次只读了指定审查报告和公开冻结源码/git objects；仅写本md与json。未读credentials/.env/全量env，未联网，未操作Git/var/V，未运行任何业务runtime，也未指挥Claude或启动worker。MAIN应先选择peer语义/隔离策略与最小seam范围，再向现有唯一writer具体release；此设计不是新的实施许可或冻结候选外审PASS。
