# G01–G07 主架构约束：统一修复设计输入

状态：DESIGN_CONSTRAINTS，尚非实现/运行授权。范围仍是原 N1/N2，不缩小 R01–R07。012/013 的绿色执行事实保留，但独立 round2 为 REQUEST_CHANGES。现有唯一 Claude writer 先提交统一方案；MAIN审核后发一次明确修正票据。不得把本文件变成自动开写许可。

## G01：错误不等于清理不确定，跨边界保留所有权事实

单看 `cleanup_errors` 非空不能判定资源清理失败：现有 failOpen 也把原 EIO 作为 cause 放在同名列表。不得把普通瞬时读失败自动永久锁死 reader。应在既有 Host 私有对象边界用明确、不可由 JSON/lookalike 授权的清理不确定标记/错误账本，区分原始业务/系统错误与实际释放失败；可在既有 retained-native-closure 模块用 WeakMap 记录原错误身份及真实清理事件，不新增 HTTP/public DTO。

closure.open 失败、authority获取失败、reader原始promise拒绝、caller取消后原始promise迟到拒绝，均必须保全原错误及全部清理cause。必须在等待原始promise的owner中收养真实不确定状态，先入既有reader sticky账本，再让close完成。普通无清理失败的EIO不应触发这条永久不确定。若必须包装不可附加的原错误，原错误与全部cleanup仍保留。禁止重试裸FD、通过重试源文件掩盖未释放资源，或把存在普通cause当成cleanup失败。

## G02：交付线性化点

最终source/workspace/assertCurrent及callback结束、所有await返回后，在 `owned.delivered=true` 前同步核对reader closed/cleanupUncertain。检查与交付标志之间不得再await或调用可重入callback。失败走既有交付前all-attempt清理。交付后reader.close仍不得破坏Expected持有的资源；不能为修正这个窗口改变已通过的交付后所有权规则。测试必须在最后verify实际callback内关闭reader或让另一份已交付proof释放失败，避免只测入口binding关闭。

## G03：解析只消费已限额、已保持的字节

MAIN已读固定上游 studio/server/film.mjs:33–44，只读取film.html后调用readFilmFile(text)。优先在原authority内部以 retained readText 先取得<=8MiB文本，写入自己0700临时目录的0600文件，再调用同一固定pinned readProjectFilm解析私有不可变副本，finally清理自己的目录并按G01报告真实失败。不能在受控Native路径再次读原root/film.html整文件；不要改上游pin/artifact/EnginePort/publicDTO。原source最终identity/hash围栏仍需成立，不能只证私有副本。若必须新增wrapper私有文本入口，先列精确路径/接口/旧调用兼容及专项回归让MAIN补票。

测试在digest与parse之间真实增长/替换原film，证不会对被替换的大文件做whole-read；现有onReadChunk只代表受控文本读取，不能称所有物理I/O为零。

## G04：正常缓存要可核定，不能永久全拒或泛放行

pageframes.mjs的key=sha256(black+NUL+rel+NUL+round(ms)+NUL+w[+NUL+overrides])[:24]，JSON仅有files列表，stamp是这些依赖mtime/size摘要；key不能从JSON反推出请求参数。filmPoster明确可能返回旧poster，并不表示当前影片已新渲染。不得把JPEG、旧poster、duration缓存作为author source/独立expected事实。

统一方案须给出正常producer的参数/key/依赖/缓存三件配对证据，以及旧proof失效、稳定新round能接受的真实例子。若需可信Host内producer调用见证：它只能由实际固定producer调用和前后source/依赖验证产生，绑定issued workspace实例/代次、请求参数、实际三个文件内容摘要和闭包；外部JSON不得注册见证，浏览器文件/缓存文件自己不能授予信任。见证丢失或无法配对拒绝这一实例，不宣称全部正常cache永久unsupported。必须说明重启/新workspace/正常原生GET的见证接线和失效规则；不能写一个只有测试会注册的永久假接线，不能未经审核新建持久权威。需要哪些内部接口与文件，由Claude提确切方案，MAIN再决策。

## G05：算法注入与真实子进程证据分开

保留现有标注为transport injection的失败case并断言named媒体分支确实命中。版本查询必须仍为真实固定ffprobe，不能让它提前timeout替代目标分支。新增真实OS子进程的slow/hang/timeout/abrupt/stdout/stderr overflow/cancel；允许测试transport启动明确只制造失败的本地子进程，不能制造成功probe媒体事实。实际媒体成功仍由固定ffprobe读取held parent-PID FD。用真实pid/exit/close、释放事件、promise settle时间顺序证明输入FD在raw子进程结束前不释放，stdout4MiB/stderr256KiB分别有命中断言。任何运行都需精确MAIN资源grant，未授权不启动browser/网络/付费/provider。

## G06：补的是原规格判别力，不新增产品

缺失style或heard-transcript的consumer默认成功→负事实birth失效；空目录单独birth；settings/style增删；真正经过reader的foreign capability消费；owner/base/control/generation/ref在实际await前后变化；隔离parent/root换位且不留额外文件让membership提前挡住。各例先断言目标阶段/注入已命中，再断言精准拒绝与无副作用。raw字幕目录顺序与数字视频排序分开；如果平台天然字典序，只能诚实标注，并准备可判别的consumer fixture，不能声称删除排序一定打红。当前producer没有translation不等于整个OpenFilm不支持translation。

## G07及跨项资源预算

regular file外部硬链接也必须拒绝：提议在admission/finalguard核nlink及身份，nlink>1不属于安全独占文件；不能只比两树相同relative_path inode。目录nlink正常大于1，禁止套用文件规则。检查后新建外部hardlink也须使旧proof失效。确保两物理树的嵌套/空目录及最近负事实parent都有独立资源所有权，不把两个包装对象当成实际FD证明。

原规格FD预算是实例级，不只单closure：统一方案需一份Host私有、按分配计数的预算owner，覆盖同reader实例两树及并行proof的保留/临时分配，reserve在open前、失败回滚、uncertain释放不假报额度已安全回收。不能复制每树8192当作实例8192，也不宣称任何OS配置下永不EMFILE。测试同时持有两树/并行proof，直接证明预算与allocation生命周期；预算是运行防护，不是开发轮次上限。

## 交付与下一门

Claude逐G列：具体改动路径/内部签名、成功行为、拒绝行为、真实复现barrier、旧实现为何失败、验证类别与精确命令。覆盖所有17原台账要求，不只7个标题。MAIN统一审核后一次释放；先快速pure/精确component，相关门绿后再完整scope，全部失败捕获保留。正式候选必须真实commit且有绑定commit的独立验收；当前报告和测试数字都不是最终外审PASS。
