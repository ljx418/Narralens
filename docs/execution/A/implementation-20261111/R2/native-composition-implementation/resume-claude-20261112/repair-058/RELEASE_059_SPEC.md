MAIN_RELEASE_059_CLEAR_REPAIRS。你继续作为唯一Claude实现者，本票据明确释放代码修复与下述串行轻量验证，覆盖旧058只读限制。目标仍是完整N1/N2全部17项；本票据只先修无需A057-04新seam的项，A057-04保持OPEN并单独由MAIN设计裁决，不能据此宣布阶段完成。不是下一阶段接线授权。

执行根W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration；基线必须1d348d419120f23f45d958112ea8c43df5a04675。C=/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112。先读C/repair-058/RELEASE_059.json、MAIN_ACCEPTANCE_CRITERIA.md及本条决策，再ACK基线/保护/hash/唯一writer。不能reset/stash覆盖用户AGENTS或无关证据；MAIN持有Git索引/commit权限。旧058两份方案已由MAIN逐字归档到C/repair-058/CLAUDE_PLAN_058_ORIGINAL.*；不要覆盖原方案当新结论，用新059报告。

MAIN设计裁决（优先于058推荐）：
1 B01通过方案方向：完整function-like/类/initializer词法scope遍历与实际生产调用点枚举，保留旧正反断言。拒绝058 C8“globalThis.x因同文件另一个tainted形参就应有违规”的不真实跨scope污染期待；有真实数据流才tainted。类、箭头、constructor、对象方法、helper跨形态和参数shadow均需真实覆盖。实际调用点集合来自真实源码，不只匹配总数10。
2 A057-01：采用最小origin-form校验+原new URL解析窄catch→400，保留现有query语义。058的URLSearchParams(raw query)与new URL(...).searchParams对fragment不完全等价，不采用无必要parser替换。HTTP handler顶层可以有响应安全的异常边界，但不把资源/媒体错误统统误报400，也不吞未捕获异常当成功。真实raw socket //[必须到原owned listener，子进程仍存活且后续合法200，范围/策略头/Host/path拒绝保持。
3 A057-02/03：同次修复所有hash捕获size上界与文本首次数据读取前预算。可收敛沿用既有ASSET_EXTENSIONS分类至closure并让authority引用同一个定义，严禁随便按未知扩展名放行大文本。known media继续流式，不受文本门限；readText不能让media标签绕过文本预算。关键纠正058§3.3.2：retainFile做首次数据读取时就必须原子预占/记入该文件文本预算，不能等readText才计账；否则workspace先retain所有文件时累计永远为0。一次文件计一次，重复读不重复，失败/关闭的容量按真实所有权释放，不因close不确定清零。另需处理并行retain同路径的reservation，不得超额或double count。
所有初次hash、hashFile、verifyFile、verify以及已有exact guard均受捕获size边界与有限extra-byte探针，增长/截短/身份变化明确拒绝。保留同步guard的原签名与bounded memory；仅同步字节上界本身不等于所有异常IO时间有界，诚实说明，不改原预算/timeouts。观察所有真实readSyscall，包括初次hash/sync hash；/proc/self/io的阈值只能辅助，不能证明被拒文件零读（会混入别文件/并发/模块加载）。需精准归因到真实文件/FD并委托真实fs读取，可用测试层只观察的syscall wrapper，不能伪造成功事实；外部owned writer实际在正常方法stat后/读取中增长，不用只测新helper。
4 A057-05：共享历史witness依赖核对，duration-alone也核每个依赖完整identity，保留其当前output授权。真正fixed draw ms0、稳定duration-only正向、删三件后film改复还原bytes+mtime且ctime变负向；保留两frame/最新授权撤销不回退/非film/last poster。
5 A057-06：本N1N2暂未证明的media posters/frames/waves文件明确拒绝，可用内部NativeSourceReaderError.code=NATIVE_SOURCE_CACHE_FAMILY_UNSUPPORTED（MAIN批准此私有码，不扩public contracts/aliases）；允许空目录，不改已证明probe/pageframe/film-poster。下一原Studio必要GET的生产证明仍是后续接线义务，不能删除；当前reader无法确认时不显示已加载。按正确media key+伪字节真实reader负例，不能未知key更早拒绝冒充目标边界。
6 A057-04：058 D2/D3/D5不获实施批准。把所有reject永久隔离/abandon、改名记uncertain、用假module永不settle再报告失败，仍不证明底层真实结束；永久failclosed不是闭环。不得修改producer工厂/bridge计数/close语义、workspace或固定vendor来实施这条路线。独立设计已证明需新scope；MAIN另发精确裁决。可只读看C/repair-058/independent-settlement-design-b.md，不自己选路线写代码。

精确可写源/测试路径以RELEASE_059.json allow_existing/allow_new为准；禁止其他代码、public合同、配置、pin、package/lock、Approved015/dist、workspace/factory/renderer新架构改动。当前adapter只限HTTP parsing/request handler。需要额外文件/接口先问MAIN具体理由。

允许新增059文档在OWN=docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/，文件前缀n1n2-claude-059-；原文件不覆盖。证据只用E=docs/execution/A/implementation-20261111/integration/e1-main-takeover/下capture前缀n1n2-claude-059-（唯一新名），不改run-recorded.py。新helper用.json/.ts/.mjs（不能.mts，因为现有捕获器未覆盖.mts；不改捕获器掩盖）。临时原实现反事实必须逐字备份、显式替换本票据路径的精确旧函数/组合、保留patch/旧/新/恢复摘要，不能用git restore/reset；恢复至真实候选后再跑正式门。旧实现反例必须是真断言红，而不是新增API缺失/compile红；不确定如何构造则先报告，不编造红灯。

运行释放：只有RELEASE_059.json列出的四条exact argv，可串行执行。每条都必须通过python3 E/run-recorded.py <唯一n1n2-claude-059-name> <argv...>，cwd=W，输入运行前后不变。首条是tsc，另外static lock、纯fs预算/增长、真实owned loopback HTTP child；不得让budget测试启动Host/browser/ffmpeg，HTTP只hello.txt/安全路径等不渲染、不probe媒体。无其他重活与此并行。允许在范围内修复真实失败并保留每次独立capture，不追求次数、不放宽预算/配置。重型reader/nativecache完整文件、ffmpeg/ffprobe/Chrome/全量check/build/opt-in超时此票不授权，等MAIN后续exact grant。新增需要real fixed draw的059测试可以编写但暂NOT_RUN，不把它们混入本轻量四命令。

全部headless静音loopback，无网络/安装/J盘/付费/外传、不读改凭据/config/.env或全量env。所有owned child/socket/FD/temp实际结束后才清理；不杀用户/未知/peer进程，不凭unverifiable当退出。新429立即停工保全并报告，不自动重试/重启/切provider/Codex接手。

完成后交059自审报告+逐正式ID状态/实际code与test/assertion/各命令raw exit/hash/所有失败与反事实/资源owner清理/源码精确diff/全部未执行门；A057-04及重型cases保持OPEN/NOT_RUN。交还唯一writer给MAIN，不Git提交、不自签外审、不声称N1N2/A/V1或下一接线就绪。