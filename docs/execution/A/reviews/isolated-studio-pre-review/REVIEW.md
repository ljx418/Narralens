# Isolated Studio 子进程边界独立只读预审

日期2026-11-10；a_media_independent_review未参与实现。MAIN基线 `452b4a2605381ef8d71de8cca1f539df2b2296e1`，本批未提交。源码读取副本/hash见inputs/input-hashes.json。MAIN唯一writer；本次未跑测试、Studio、浏览器、媒体或任何探针，没有改MAIN源码/Git/运行根，只写本review目录。

结论 **REVIEW_PENDING / NEEDS_WORK**。发现3项当前生命周期/路径P2及1项非空放行前P1门。当前created workspace尚未装配/公开，因此不把潜在非空路径风险冒充已经发生的生产外传或作者/snapshot被写。

## IS-R1 · P1 非空放行门 · “No browser”在真实非空Studio读取时不成立

新child仅设置OPENFILM_HOME/LIBRARY、NO_UPDATE_CHECK，没有安装既有offline/browser/media process守卫。固定上游server.mjs:343-350对GET /api/projects/:id读取有clips工程时warmFilmPoster；pageframes.mjs:161-166延迟pageFrame，:317真实host.launch Chromium，:321 FilmPage.open没有offline/network限制。Gateway的读allowlist会转发该类原生项目读取，浏览器CSP不能约束服务器自行启动的headless pageframes。

后果/前置：后续真实非空workspace接入原生编辑时，即使openBrowser回调为空，也可因poster产生真实Chromium，源page的动态请求并未被新child禁止。Playwright还会另起Chromium PGID（此前MEDIA R1已确认的依赖行为）；父close 5秒强杀只kill Studio leader，不能由leader已close推断独立Chrome后代结束。原生pageframes正常close可能成功，不能当作所有强杀/父失联必成功。

此为固定上游静态事实，**本次没有运行非空Studio/网络或强杀探针**。当前0帧metadata open不触发它，不能泛称该case已证明no browser/network。开放非空前须选择：明确禁止/封住owned模式pageframes/其他自动浏览器入口；或安装真正离线guard并对全部自有浏览器/工具拥有可验证终止边界。不能仅设置NO_UPDATE_CHECK或把HOME改路径宣称网络隔离。不应为了本项让legacy静默换行为；profile应限定owned模式。

## IS-R2 · P2 · close在probe期间返回后，ensure仍可能启动新Studio/Gateway

Supervisor.ensure:190-198先await probe，随后#start。close:210-215只取当前#studio；若ensure仍等待probe，#studio尚undefined，close立即返回；probe完成后原ensure没有closed门，继续spawn/onStudio。close之后再次ensure同样可重启，Host.close完成后可能重建监听或回调接触已关闭Host状态。

这是确定源码时序，不依赖upstream故障；**未执行复现**。建议close标永久closing/closed，等待已入场操作与启动（避免自等待），ensure每个await后检查；如Gateway callback刚完成但已进入close，必须收回新建资源。真实用例可const pending=supervisor.ensure(...); await supervisor.close(); await pending，并在probe阶段用确定barrier检验无child/Gateway遗留。不要用假Studio通过替代真实监听结束证据。

## IS-R3 · P2 · 新reject重试复位会使默认legacy的onStudio失败泄漏更多Studio

新增#start通用catch清#studio以支持重试；isolated分支onStudio失败有await studio.close再throw，legacy分支仍只是startStudio→await onStudio，没有失败清理。默认模式Gateway构造首次失败后活Studio引用被抛弃；再次ensure会再启一套监听，先前那套最终close也找不到。原行为已经会有首次失败资源回收不足，新通用retry使它可重复，属于此次默认legacy回归边界。

建议legacy也在onStudio失败时清理实际已启动Studio，然后才reset缓存，保持成功旧路径不变。当前新retry测试只配isolatedRuntimeRoot，不能证明legacy。真实默认分支测试应记录首次origin/filmOrigin，注入Gateway构造失败后断言两者关闭，再重试与最终close核无遗留。此项**本次未运行**。

## IS-R4 · P2 · symlink祖先在校验前就被mkdir穿越写入

isolated-studio.ts:14先mkdir(root,{recursive:true})，:16才realpath等于root；home/library:18-19同模式。若existing allowed/alias是指向outside的目录symlink，输入allowed/alias/new会先在outside创建new，随后才拒绝。当前测试只测已有symlink叶子runtime，不覆盖alias/new；不会发现写越边界的副作用。

当前owned A调用使用既有canonical runtime下固定studio-runtime，通常不触发该错误配置，但helper的隔离校验不应先写别名目标。可复用已审runtimeRoot“先检查existing ancestor再mkdir”的逻辑，新增alias/new负向并断言outside/new不存在。本次**未执行**。

## 已成立的正向防线与限制

- 配置仅新增可选isolatedRuntimeRoot，owned start-runtime显式传root/studio-runtime；未配置仍走原legacy分支。新child不改变父env或HOME，OPENFILM_HOME/LIBRARY在子进程设置，NO_UPDATE_CHECK=1、advertise=false、openBrowser空回调，实际Studio全局recent/state可落私有home；.film/id/cache仍会写传入工程，必须是未来独立projection，不能交author/snapshot。
- key由固定上游随机生成，仅IPC发父进程，不进argv/普通stdout/stderr；父对origin/filmOrigin/port/key格式有校验并drain输出，不原样转发上游路径/provider异常。start失败受控白名单stage/reason。
- 父正常close发IPC，5秒后仅kill本次ChildProcess，等待exited promise；child监听disconnect/SIGTERM/SIGINT并调用upstream.close。0帧metadata测试及parent实际SIGKILL测试是有价值的定向证据，但本审查仅阅读其源码及MAIN声明，未独立运行。
- “退出必须等实际close”的代码措辞还需严谨：exited同时在child.error上resolve（:28），一般spawn失败无活pid可以成立，但不能通用把运行中IPC/kill错误当作退出。当前可达成功路径尚未发现真实error-with-live-child复现，不另列已证实P1；后续加强时应记录error而仍等close/明确未知。
- 父已经被SIGKILL后只剩child的disconnect handler；它await studio.close没有自己的期限。若上游close卡住，没有仍活父亲执行5秒fallback。本次无真实挂关闭证据，作为IS-R1后代回收/完整生命周期验收一并覆盖，不虚报当前parent-loss正常case必失败。
- env继承不是filesystem/provider沙箱：例如OPENFILM_EXPORTS可覆盖home下默认导出目录，字体/浏览/桌面/trash代码仍可使用真实HOME；应继续以Gateway读/能力allowlist及新profile限制入口，不将本切面宣传为所有Studio操作均只能写私有root。当前未放行正式导出，不把未调用功能说成已执行越界。

## 证据和后续门

测试源码4项针对真实pinned两监听/私有metadata、symlink叶子、父实际SIGKILL、isolated Gateway失败重试；没有覆盖非空poster/browser、close-during-probe、默认legacy callback失败、symlink祖先先写。当前MAIN exec58714为统一预约，审查者没有占用资源或改其输入。

新created native workspace、受控delegate/project/owner绑定、native loaded观察、真实Run/assembly、正式Delivery/影片/T20均尚未由本模块证明。没有native ack时继续unknown/pending，不得以子进程ready或metadata文件出现冒充编辑器已加载影片。

## 四项修复只读重查（当前未冻结，测试仍由MAIN独占）

未执行测试/Studio/浏览器、未改MAIN；本次读取副本/hash见fix-read及fix-input-hashes.json。IS-R1/IS-R3/IS-R4源码修复成立，IS-R2在probe阶段已修，但在另两阶段仍未闭环，整体继续NEEDS_WORK / REVIEW_PENDING。

### IS-R1：SOURCE_FIXED，非空定向证据仍只属MAIN

child加载原固定render guard SHA并安装loader hooks，再import Studio；Studio专用wrapper复用已审offline page/context/WebSocket规则，launch强制headed:false并加入mute，仅将localhost解析到127，其余DNS仍拒绝。未改film URL原生缓存身份。detach Studio独立组，media policy强制后代non-detached，使Playwright从JS启动的Chrome继承Studio组；private TMPDIR归本次child。

parent正常close有5s组强杀、close后检查组收敛，未收敛报错；child父disconnect有自己的5s fallback，不再只靠已死亡父进程执行强杀。临时目录仅在组gone条件清理。上述修正对定位的offline/进程归属缺口有效；不能把“No browser”注释字面继续作为事实，实际允许的是静音headless离线browser。

MAIN报告非空JPEG成功、跨origin本机sentinel0；旧argv断言因Chromium /proc标题可能合并参数而误判，raw诊断mute/headless存在，现改为空格/NUL精确flag边界匹配。测试源码新case确实检查JPEG magic、sentinel、Chrome同组及关闭后活性。审查者未重跑，不为正在跑的exec32117预签PASS；后续仍需原始日志/最终冻结绑定。Studio专用wrapper新增字节也应纳入最终独立源清单；现复用render pin验证的四模块不包含该新override本身，不能声称那份pin单独覆盖全部Studio安全逻辑。

### IS-R3/IS-R4：SOURCE_FIXED

legacy与isolated均用onStudio失败时studio.close再throw，统一清失败promise重试；新legacy真实子进程测试独立OPENFILM_HOME/LIBRARY，连续两次有意Gateway失败后验证旧origins不可达，未改默认成功流程。privateRoot改用已审owned-runtime.runtimeRoot，先验证existing ancestor再mkdir，新的alias/new负向断言target/new不存在。此次仅源码确认，不冒充测试已独立通过。

### IS-R2仍开放之一：close先等无取消的open fetch，可能永远进不到强杀

Supervisor.close:220-227设置closing后先await Promise.allSettled(inFlight)。若ensure已在#openInStudio:276的fetch /api/projects上等待，fetch没有signal/timeout；Studio被SIGSTOP或其请求无法结束时，在途operation无法settle，close也永远到不了studio.close，子进程5s强杀根本不会被安排。“每个await之后检查closing”不能中断正在等待的await。

建议让close触发AbortController取消在途open（含response.json），或以不会自等待的顺序并行回收Studio，再等待在途操作终止。真实负向应在Studio已经启动且open请求在途时冻结/阻塞自己的child，仅终止该实例，外层deadline证明close真正结束；当前probe阶段close case不能覆盖。**本次未执行复现。**

### IS-R2仍开放之二：Host先关旧Gateway，callback随后发布新Gateway会漏收

Host.#close当前先读取#m5Gateway、置null并close，之后才await m5Supervisor.close。若onStudio尚在await readPanelAssets/gateway.start，Host读取时gateway还是null；callback之后仍把新gateway赋给#m5Gateway。Supervisor的closing检查会拒绝ensure返回，但只关闭Studio，不掌握新Gateway；Host已经错过该引用，留下两套Gateway监听及可能访问关闭DB的通道。

建议Host关闭flag与onStudio收尾协作：callback完成时若Host正在关闭立即gateway.close；或先让Supervisor停止接单/收敛在途启动，再统一收Gateway，处理callback部分启动失败的资源。必须使用实际Host装配race测试，不仅单测Supervisor.close-during-probe。**本次未执行。**

### 额外信号安全注记（没有虚报实际PID复用）

parent在await child.close之后仍依据数字PGID存在发SIGKILL，5s timer同样只看groupExists。此时Node当前ChildProcess onexit保护不再覆盖旧数字组；若旧组已gone并被复用，不能仅凭存在称其仍自有。原native-renderer的自然退出逻辑明确避免延迟signal可能复用的组。建议leader仍活时处理own group强杀；leader已exit后只观察/报告未收敛或基于已确认后代身份处理，避免盲信号。这里没有强制PID复用实测，不把未发生的误杀写成已复现P1。

当前Workspace/Gateway delegate/native loaded ack仍未实现/放行；读metadata、隔离Studio ready或JPEG均不等于native ack、采用、assembly或正式Delivery完成。四项源码修补不能代签A05/A。
