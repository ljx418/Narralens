# R5G actual code 独立受影响复审

**REQUEST_CHANGES：1 MAJOR。** 原R5F两项的主要反例已有实际代码修正；本次仍不能按已批准完整契约签SAFE_FOR_SEPARATELY_PINNED_MINIMAL_N_PILOT，原因是F07/F10必需nullable字段的缺失仍被接受。此结论不是文档审查续签，不签内核、N1N2或冻结commit。

候选绑定当前dirty tool SHA256 `b21563aa7259c6e933b72d82eeb79a5a585576e91907acabe2fd443504797be7`、pure test `d8690e8f9a9d72264b797beb41341bea70c519202f9ebd91d1a9dc6820cf15d0`、报告 `e90adc1b318e120b8691bf7430745d9ada23bb2da5101267407764fa39f1765e`。历史HEAD `1d348d419120f23f45d958112ea8c43df5a04675`不是新冻结提交。source8/protected7/report和651输入摘要匹配，710份实际读/hash输入末尾重验一致，完整start/end SHA和范围见INPUTS.json。651摘要核对不冒称651逐行语义审查。

## 最小阻塞 R5G-O01

工具仍保留允许缺失的旧条件：manifest.listing_error、final.reporting_failure、final.manifest_error以及artifact行的error均把undefined当成“无错误”。其中2292、2492、2498处均是 `!==null && !==undefined`，199处行error也同形。删除这些必需字段后，实际writer/publisher可自然生成完全正确的hash和长度，但唯一checker仍将normal判accepted0，fault可判accepted1。F10及合同§1明确要求mandatory自有property、显式null不能等同缺失，不能以原R5F这部分代码没变为理由跳过已批准契约。

此外2409的baseline===null分支只核final.diagnostic_snapshot为null，完全跳过candidate.receipt_summary/accumulator_summary/terminal_proof_observations与final.terminal_proof_observations的存在、类型与null一致性。实际helper拷贝后构造supervisor失败时，root和必需helper仍存在、真实candidate/manifest/final可完整发表，actual snapshot合法为null；删掉或改坏上述字段后，2516仍把它认成可靠ordinary1。合法ordinary1应保留，但不完整mandatory证据必须3。

**最小修法**是增加覆盖已发表nullable字段的统一必需字段/类型检查；无错误字段明确null，不能undefined；baseline为null时，上述四字段也必须存在且明确null。把这些字段加入参数化删除/错型/矛盾矩阵，并保留未修改的null snapshot普通失败1控制。无需重写kernel、全行hash算法或公共API。

**决定性pure设计，未执行**：用现有realFsDeps/tamperWith，仅删除final.reporting_failure再委托真实atomic publisher，正常run/main必须给3而非0；分别删除manifest.listing_error或一行error，委托真实writer，让实际mapper/链接自然hash坏字节；再在helper已拷贝之后使createSupervisor抛普通Error，取合法null snapshot的ordinary1对照，逐字段删除/错型其摘要/observations并要求3。这些是已批准同一fault模型，无伪hash、无真实C/N，不是本审查新造公共攻击面。完整定位与最小测试在FINDINGS.json。

## F01–F10 / C01–C10核对

|范围|结论及实际依据|
|---|---|
|F01|mode枚举、root/protocol、final/outcome/publication kind/exit/fault一致性及ok/fault/failed合法组合已实现，非法组合3。|
|F02/F03|canonical actual error与candidate/final逐字段比较，缺失不再归null；actual settlement===original或direct cause在对象上核验。原R5F-O02静态关闭。|
|F04|两记录cleanup与outcome保留的有界内容/顺序一致，非空不能accepted。没有错误地要求raw与diagnostic两数组彼此相同。|
|F05/F06|terminal boolean、实际snapshot proven、图像常量/hash/bytes/exact与各记录比较，fault的bytes与hash均需null。null baseline的observations存在性仍属O01。|
|F07|run1513一次snapshot赋runSnapshot并由outcome1805返回，candidate/final复用同次观测，nonnull时完整事实比较成立；null分支仍不全。|
|F08/F09|actual snapshot与final相等，normal/fault transport/latched/cleanup门与绑定原取消name/code/message已实现；不只查两个boolean。|
|F10|实际byte/hash/length、全部artifact、真实发布和报告门保持；required nullable字段缺失门仍未补全。|

C01–C06在actual writer/publisher边缘复制修改，交真实依赖序列化/计算hash，再调用actual checker；关键candidate错误还走actual main。C06真实创建两个相同文案的不同Error对象，避免旧测试误用同一对象。C07合法wrapper-cause使用实际stub settlement构造并通过共享checker，normal/fault普通失败均可靠、不接受、1；没有用任意1算PASS。C08主要覆盖nonnull摘要与proof错型/矛盾，null分支没有覆盖。C09既有normal0/fault1/参数2/证据3及无root不写cwd保持。C10证据边界见下。

参数化矩阵确有实际实施意义，不再是消费副本或伪hash；但并未覆盖每个mandatory字段。F10只新增了evidence_errors/reporting_failures等数组，没有nullable单字段，F07也只选成功nonnull路径。一些对string字段的asString“wrong type”实际只改变了合法string值，不能凭测试标签宣称类型覆盖穷尽。逐F/C、源码/断言/证据边界详见FINDINGS.json。

原R5F-O01中candidate错误/cleanup/terminal/image矛盾与normal额外diagnostic的原始触发已静态关闭；完整结果契约仍受O01影响。文档PLAN_READY不等于实现全通过。核心supervisor/custodian/guard/identity/python/lifecycle/integrity与R5F逐字节一致，未重开已关闭kernel问题。legacy仍是同一checker的薄调用和accepted根释放门。

## 26-red与超时的准确证据

实际oldlogic-red capture记录exit1、26 failed/129 passed；其tool SHA为 `b121f45aa7ccb45ace0172822f7efdae2f6133974e6f8b7b662bf4589978e360`，test为 `d91fab99e56886fbb808819f1679c57057a88e5c619f825978eb284e3f0060ae`，均不同于最终R5G；tool也不同于存档R5F `bb5ab8df…`。按MAIN限制及作者具体方法，它是辅助函数/acceptance门neutralization mutant，不是存档R5F原tool重放。只能说所捕获mutant令26断言失败，不能把§2.2“这正是R5F行为”等同于26个历史语义失败；所读产物没有提供完整mutant源码diff供逐字节等价证明。未重跑变异。

本轮pilot-001真实exit1含normal mock-supervisor的20000ms超时，另有四条fixture不适配失败，5失败/64通过；日志hash吻合。此前5s失败仍保留，根因未证实；最终186绿不是诊断，也不证明内核活性。预算仍20s，未发现生产deadline因此改变。

当前afterEach273清空PILOT_REGISTRY/脚本/map，不会settle已经超时的原promise，也未统一取消FakeCustodian定时器；旧fake操作可能在失败case之后继续并影响复用的合成PID状态或deny账本归属。这是测试隔离/诊断局限，不能声称“finally已经等完”。但process.kill拒绝wrapper从不恢复、child_process保持mock，未建立当前真实OS信号逃逸的新路径。实际N CLI会在独立进程执行，不共享Vitest fake realm；本审查不把这一未定位测试超时单独升级成真实N清理缺陷，也不因后续green说其原因已关闭。当前N准入仍被明确的证据资格O01阻塞。

六份最终capture实际cmd/claim/input/result/exit/log已核：每份651等于快照，日志hash匹配，exit0且source_changed为空。记录identity87/Python59/pilot186/type/integrity，只是已捕获轻量结果，非reviewer重跑。generate是既有manifest幂等重复。旧os.kill越界、004精确MAIN停止、005 INCOMPLETE和所有红灯原样保留，不补造PID、exit或未知影响结论。

## 停点

只需把已批准契约中的mandatory nullable存在性一次补齐及相应真实FS反例，重新绑定后做受影响复核，不要求先完成无关R6/R7。当前不签真实N最小准入；任何normal/fault试验仍需MAIN独立精确release与当前pin，外层必须另核实际OS exit和完整final/manifest/candidate原结果/cleanup/freshfacts联合资格。

本票只写本指定三个新报告。reviewer测试、产品import、CLI、真实C/N/信号/fork/wait/prctl/Host/media/Chrome/network全部NOT_RUN，未改W/Git/运行根或旧证据。N1N2、原17/ISO18、R6/R7/R8、新冻结外审、NEXT与V1均未据此通过。
