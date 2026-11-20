# R6 私有协议与资源结束契约（MAIN草案，独立审查前不释放实现）

## 0. 目标与不变量
当前基线是R5I dirty候选，历史HEAD不是新冻结commit。normal002/fault001仅证明最小合成C/N基线；本合同不撤销normal001及历史失败。R6 C06/C07/C08同一生产生命周期联合实现，C09的真实屏障另票扩展受保护fixture；不得以C09未释放为由签R6完成。R7 workspace/private closure/bridge owner不重写。
C是专用subreaper且唯一wait owner；N是原fork的锚。现有不可逆signal撤权、one-shot TERM/KILL动作债、unknown持责、no-birth与failed-exec、原Error/cause、strict transport failure及publication-v2必须保留。时间预算只限制动作或输出，不是责任到期。

## 1. 协议兼容边界与四层判定
继续外层 `narralens.openfilm-cache-process@3`，不改固定N helper的HELLO/GO。C→Host私有receipt新增必需 `receipt_version: 2`；所有RECEIPT_SEGMENT与DOMAIN_REAPED都必须带它。旧无版本receipt不得在新Host静默接受；不用v1 fallback。C与Host同批发布并生成源码摘要，不引入公共API、Host DTO、EnginePort方法或第二checker。
四层独立：①消息绑定/完整性；②确切资源结束；③创作结果可交付；④项目/文件/工作区释放（仍由原R7调用链控制）。②真不等于③或④真。未知②仍持责；②真③假应把原失败结算一次，不能永久空持责。
DOMAIN_REAPED增加必需 `proof_kind`：`complete-v2` 或 `failed-terminal-v1`。前者提供完整有界事实；后者仅证明失败后的资源结束，绝不交付图像。不能把错误/缺失字段强转默认null、0、true或另种proof。

## 1A. 启动分支与必需字段（优先于下文“每个N”一般规则）

先区分Host本地证明与C已绑定的wire证明。除明确Host-only分支外，wire必须包含startup_kind、fork_attempt_state、forked_pid、worker_epoch、worker_wait、last_actual_wait_ordinal、echild_after_wait_ordinal、group_disposition、stream ownership/disposition，nullable键不能省略。startup_kind是判别联合，非法组合拒绝；最后ordinal无任何wait时明确null，不能伪造0号wait。

|startup_kind/路径|真实事实入口|N/wait/ordinal必需值|group/stream/receipt门|结果资格|
|host-no-child（Host-only，不发wire）|spawn同步抛错未返回child；或返回child但从未birth，真实error+close且未发authorize，保原Host事实判定|C/N身份与N wait不存在；不能要求不存在的exit事件或C receipt|原Host no-birth路径；未error/未close不能只凭timeout证明。无C FD只标未取得|原失败，无图|
|custodian-unauthed（Host-only，不要求绑定wire）|C确实birth，但Host从未发authorize|无N/no wait；C此时不知道可信draw/ticket，不强迫其捏造|真实C exit+close及原epoch新鲜gone/原有未绑定epoch issued-pid规则；真实拥有的FD由实际owner闭合|原失败，无图|
|authorized-fork-failed|C实际接受合法immutable绑定、封存唯一attempt，os.fork确切失败且没有child|fork_attempt_state='failed-no-child'，fork_errno正整数；forked_pid/worker_epoch/worker_wait/last_actual_wait_ordinal/echild_after_wait_ordinal全部null|C当下真实ECHILD，group_disposition='not-established'；绑定failed-terminal，failure含实际fork错误；无wait不要求N-last或post-N wait|仅资源失败终局，无图|
|forked-setup-failed|自己的fork确实返回N；child setup stage明确报告失败|fork_attempt_state='born'，forked_pid正整数；worker_epoch按实际可为null，但worker_wait必须自己的真实terminal wait含原PID，未知epoch明确null；实际last wait ordinal，ECHILD在最后真实wait之后|setsid明确失败为not-established；setsid成功后dup/exec失败为established-gone；stage/组事实未知必须unknown并held。无需N_HELLO|仅原errno失败，无图|
|forked-exec-succeeded|child exec成功且原完整worker身份已认证|fork_attempt_state='born'；完整N epoch/terminal wait/ordinal；完整模式N恰一次且last；失败模式后续wait如实记|group_disposition='established-gone'才可终局；两路真实stream事实；complete或failed-terminal按对应门|完整成功还须全部creative规则；失败绝无图|

`group_disposition`只有 `not-established`、`established-gone`、`unknown`。前者仅真实从未fork或child报告setsid失败的事实，不是group探测返回空、不是exec失败自动推断；后者只有原已建立组的新鲜gone。unknown不能terminal签绿，不探继承Host组。failed setup缺epoch时保留原fork wait authority、不伪造绑定或重新授权；signal仍按原R5机制判断，不因本表放宽。

child→C已有exec-status专用pipe在同.py内扩为有界结构化setup结果：明确stage='setsid'|'stdio'|'exec'、ok/errno、session_established布尔；setsid成功后先发实际progress marker，dup/exec失败携带真实stage，成功exec由真实CLOEXEC EOF加已收到setsid-success marker证明。最多2个有界记录、累计不超过512 bytes，保留原64字节read分片、支持partial read；无法解析/超长/读错是setup unknown，不把裸errno或孤立EOF解释为setsid成功。不会修改固定N helper、增加公共字段或读取用户配置。实际子进程失败路径全部同file改；原errno与最早cause保留。

stream单路另外必需 `ownership:'not-opened'|'acquired'`：
- 从未取得任何该路FD，才是not-opened，disposition='not-opened'、bytes=0、tail_bytes=0、eof=false、read_error=null；不是伪EOF，不要求从不存在的FD读0。
- fork失败前取得pipe但从未交给任何child：acquired，所有父侧已分配两端均必须实际close一次后为 `disposition:'never-inherited-and-closed'`、eof=false；关闭未知不终局。若存在继承writer不能用此分支。
- 真实child继承的路只走第4节 eof 或 raw-tree先证后read-failed-and-reader-closed。父side copies必须正常关闭，不能用上述startup变体掩盖真实活writer。

明确空转录：仅已绑定、确切no-fork失败证书且事实上没有items时允许summary.segments=0/events_count=0/waits_count=0/identities_count=0，相应digest是空流SHA256；accumulator的显式empty终态必须由已构造同绑定期望验证，不接受默认“从未初始化”。不发空segment，未fork也不虚构wait。其他有items的证明走正count连续非空段；已fork但缺N wait不能套零段分支。真实C事件或身份若存在必须如实计数，不可为了零段清空。

Host已送authorize但C实际拒绝/未能解析可信绑定，不能退回“Host从未发authorize”豁免。协议损坏时需保留真实未知owner；不得凭C close或本表no-fork猜测N不存在。对于同batch CANCEL后合法AUTHORIZE的直接负例，C拒绝fork、保存有限拒绝诊断，原字段不被改写；若该路径没有可信绑定可交付证书，记录为协议失败/Host证据未完成，而不是假称通过。此不授权重试fork或伪造ticket；普通合法Host无此重排，normal与指定fault仍须完整返回。

## 1B. C端单调授权与原始责任登记
C设置不可逆 `authorization_state:'unbound'|'sealed'|'terminated'` 与独立one-shot `fork_attempt_consumed`；合法第一次AUTHORIZE先校验完整type/输入，再封存draw/ticket/executable inputs并消耗唯一attempt，之后才分配FD/调用fork。原root registry保存第一次N/FD/epoch/exec/stream原责任；失败时也不清attempt、不自动重试。任意重复AUTHORIZE或终止后AUTHORIZE只锁存protocol失败，不能改绑定、分配新FD、fork或覆盖原PID；同一_read_control返回的多条消息逐条检查状态，不能只在outer loop检查_terminated。合法AUTHORIZE,CANCEL仍只一个N，CANCEL,AUTHORIZE零N，AUTHORIZE,AUTHORIZE至多一次attempt。第一次child责任必须从fork成功瞬间登记，即后续register/pipe设置抛错也不丢root。
`subreaper_before_fork/sole_wait_owner/no_new_fork_after_termination`只由已确认subreaper状态、该唯一实际入口和原root registry派生，不从外部message布尔复制；所有wait路径写同一个ordinal、专用N terminal槽及有限后续wait计数。新鲜ECHILD必须在最新实际wait之后，任何新wait均使旧ECHILD证明失效，下一pass重新实测。

## 2. 不可变绑定、类型与语义账本（C06）
每draw创建时锁protocol/draw_id/ticket_digest；实际pump在任何segment进入accumulator前校验，accumulator自身亦绑定期望值，导出pure入口不得绕过。每segment版本/三元绑定/global seq/index/count/字节与item上限都严格校验；无段的确切no-fork分支仅按§1A，不套非空段规则。index从0连续，0<=index<count，count正整数且不得大于现有MAX_RECEIPT_ITEMS；每段非空、总items<=4096，最后summary只能一次且所有段已收齐；终局后多段/多summary不被默许覆盖。
不能用Number(null)、Number('1')、Boolean('false')代严格wire类型。PID/PPID/PGID/SID为正安全整数（PPID可按真实初始C情况为0），start_ticks为规范十进制正整数字符串，状态枚举严格。所有必需nullable字段须own-key且值明确null。TS/Python canonical继续现有逐字段ASCII JSON规则，不更换hash算法。
身份主键是 `(pid,start_ticks)`，不是PID；PPID可合法由N变C，必须作为有序观测而不是把epoch改成新进程。保存born identity与后续adopted identity并检查合法关联，不把最新PPID覆盖历史。N身份须匹配forked_pid、原C父关系、原pgid/sid/ticks；未知原epoch不能虚构。
完整模式的i项是确切完整epoch及所属类别；w项含实际waitpid结果的epoch、terminal status和类别（worker/adopted），`order`为递增wait序号。status只允许真实 exited(code) 或 signaled(signal[,core_dumped])；stopped/continued/unknown/不合法code或signal均不能作为terminal。reaped worker恰一次且最后，adopted必须与自身已记录epoch对应，不能同epoch重复wait。N的专用terminal事实不能被前256条示例截断。
合法被原父进程reap的后代不是C wait：i项completion单列 `parent-reaped-observed-gone`，必须有同epoch已知归属及后续确切gone/replaced-by-other-epoch的原epoch消失观测；观察unknown、或同epoch Z不算gone，不能捏造父进程wait或退出码。此分类只主张C没有wait且原epoch已消失，不主张C观察了真实父进程wait。曾记录目标须逐项有C terminal wait或此分类。
实现可用现有512身份预算内的按epoch语义map记录completion与N专用槽；不保留另一份无界wait/event列表。超过身份/event/items上限进入失败模式而不是任意增大常量。检查快照只读，不消费活hash或冻结后续实际输入。启动按§1A判别表：仅原fork确实存在才要求自己forked_pid的真实terminal wait；no-birth/no-authorize/确切fork失败无child不要求虚构wait。未成功exec无需N_HELLO，且永不创作成功。

## 3. 完整receipt与有限失败终局证书（C08）
### 3.1 完整模式
`proof_kind=complete-v2` 要求所有实际retained事实完整、未overflow/truncated、每个已记录epoch有合法completion、N-last、真实ECHILD、§1A对应group义务、保留原epoch均gone、subreaper已核准后才fork，以及第4节stream disposition；仅确实fork的分支要求N-last，no-fork明确空值。任一合法执行失败如exec失败/取消仍可有完整资源证明，但creative必须按原失败拒绝。
### 3.2 失败模式的最小必需对象
保持DOMAIN_REAPED/outcome=reaped，但 `proof_kind=failed-terminal-v1`、`creative_eligible:false`、`failure` 非null。新增required `failed_terminal` 对象：
- `version:1`、`root_scope:'sole-custodian-subtree'`；绑定同一C原epoch、forked_pid与已绑定N原epoch（若已知）；`subreaper_before_fork:true`、`sole_wait_owner:true`、`no_new_fork_after_termination:true`；这是当前专用C生命周期的实际生产事实，不是测试塞入布尔。
- `worker_wait`：自己的真实terminal wait，含forked_pid、已知原epoch、完整status与wait ordinal；no-fork分支明确null并有实际从未fork事实。failed-exec身份未绑定需明确 `epoch:null` 且actual fork authority+terminal wait，不能伪称完整N。
- `post_worker_echild:true`仅born分支：N真实wait及所有后续实际wait之后从同一C实际wait边界得到ECHILD；`echild_after_wait_ordinal`匹配最新实际wait ordinal。确切no-fork按§1A用actual_echild:true、post_worker_echild:null、echild_after_wait_ordinal:null，不能要求不存在的N wait。不把空census、wait返回0、权限/读取异常当ECHILD。
- `original_group_state:'gone'|'not-established'|'unknown'` 必须逐项对应§1A group_disposition；unknown拒绝终局，不检查继承Host组；`retained_epochs_gone:true` 来自所有已保留epoch的新鲜实际查询；unknown/live/Z任一不能签。
- `anchor_preserved_until_worker_wait:true|false`、`worker_wait_was_last:true|false`、`post_worker_wait_count`、`authority_revoked:true`：如发现N后才收割意外child，完整成功拒绝，错误明确锁存；真实资源都结束时允许失败证书如实记false及实际后续wait，绝不能假装N-last。之后不恢复任何signal权限。
- `lifetime`：events/waits/identities各自总count与全量streaming digest、overflow/truncated sticky标志；`transcript_complete:false`；实际已发excerpt的count/hash仍使用既有segment/summary字段按真实发送内容严格匹配。不能拿全链摘要冒充已发送完整转录。
- `stream_disposition` 按第4节；`resource_proof_complete:true` 只有根scope事实和所有新鲜义务同时满足才由真实分支置真。所有unknown必须拒绝资源结束而留原owner。
失败模式不接受“flag=true就跳所有检查”。允许有界转录不能重建所有历史epoch，但资源结束必须由独立专用root所有权链补足：已在fork前确认subreaper、没有其他wait消费者、原N唯一根、N已真实wait且之后实际ECHILD、原组消失、已保留epoch全消失；这些共同证明C树下未保留的后代也已结束。仅ECHILD、仅group ESRCH或仅C exit绝不够。若实现无法维护其中任一scope前提或发现逃离该根的归属问题，仍held，不能换成大概已结束。失败证书不改变signal/wait权限或引入cgroup/全局reaper。
第一次身份/event/items预算触发立即锁存具体原预算错误并开始owned cleanup；若更早已失败，预算作为secondary保留而不覆盖原cause。错误不会因flag清除而恢复成功。读流、raw wait与原owner继续运行；计数与hash可流式增长，内存保持上限。反复recover同一事实不重复记wait；N专用terminal槽始终保留，原预算错误/证书类型/overflow信息进入真实snapshot及唯一publication mapper。
Host对failed-terminal只能在独立binding+证书+fresh C close/原epoch/group验证后判domain true；validateCacheExecutionReceipt对该proof_kind始终false，且锁存receipt实际failure，候选必须丢弃。不得将它解释成“fault pilot通过”；故意失败验收仍仅指定原Error/cause且无额外失败。

## 4. 全阶段OwnedStreamLedger（C07）
每路必需事实 `bytes, tail_bytes, eof, read_error, disposition`，stdout/stderr独立：累计限制各65536字节、尾各8192字节，既有每round最多65536不变；不把两路合并放宽。bytes为真实读出字节数，不能只数保留尾或推测written值。增量read/EOF/unregister只经过同一ledger。
running、settlement poll、等待N、recover wait、receipt前final drain均服务它。每轮每路有界，轮后处理control/wait/cancel并遵守原poll，不准洪水饿死reap。EAGAIN是本轮暂不可读；read0才是EOF，记录并注销一次；EIO等异常保存有限错误与diagnostics_lost、保留原失败，不能当EOF。stream callback异常不得逃出sole owner丢责任。
所有写端已真实结束后进行最终有界drain并求证EOF；若仍有继承写端活着，不能把关闭读端冒充EOF；仍有资源不明就继续持责。若所有资源已独立终结但fd自身读取永久EIO，允许失败证书 `disposition:'read-failed-and-reader-closed'`（实际关闭一次、已证明无活writer），资源结束但diagnostics不完整，创作失败。完整可交付必须两路 `eof:true/read_error:null/disposition:'eof'` 且各bytes<=65536；overflow/读错/sticky loss必须失败。
TERM handler late output、候选后控制/绘制socket error都保留原失败优先级；reporting Writable EPIPE不是这两个入口的覆盖。新控制/绘制late-error tests必须走真实supervisor注册回调。不得扩2s/5s/20s测试或产品超时来隐藏活性问题；fake待决promise/定时器归属在teardown显式收敛或明确仍pending，不把clear map当结算。

## 4A. 单调raw-tree→stream→wire→Host最终顺序（禁止循环依赖）
1. C仍存活且拥有本地原root时，先产生 `raw_tree_terminal`：§1A实际no-fork/ECHILD或原N实际terminal wait、最新wait之后ECHILD、原group disposition和所有保留epoch新鲜gone，必要subreaper/单一根链已证。该对象**不要求reader先closed、不要求receipt交付、不要求Host C-close**。raw-tree未知仍原owner持责，不能先关reader/杀C创造结束。
2. 仅消费该本地raw-tree事实后完成最终stream ledger：正常drain到真EOF；真实EIO则在无活writer已证后实际close该owned reader一次、记录eof=false/read_error/closed事实。no-fork的not-opened/never-inherited-and-closed照§1A。reader close失败/不确定时不得把最终资源证明置true，可保留原责任与显式失败，等待可证事实，不能二次盲关复用FD。
3. raw-tree+stream disposition齐全后生成本地 `resource_proof_complete`、准备对应完整或失败证书，再写segments→summary→flush。递交失败不是资源结束本身失败，但不能伪造Host已收到；C按已存在的本地清理责任确保结束并显式记录wire不完整，Host不凭不完整wire绿灯。
4. 最后C exit/close，Host按原issued child/已认证C epoch、授权分支、完整wire及各fresh epoch/group事实证明自己的terminal。Host端future close绝不能作为步骤1/2前置条件。恢复沿同一ledger/专用N槽/ordinal继续，不重复wait、不重获signal权限。
本批direct mock必须跨这些真实生产层连接，分别有raw-tree unknown、reader close不确定、wire未完整、C尚未close的反对照，不能只测独立构造的true/false函数。

## 5. C09后续精确票（本实现不改受保护fixture）
整批计划包含C09，但现在只锁定标准，不授权helper变更或mixed lifecycle运行。后续最小helper修改票须重新pin并保留旧helper：child装handler后写owned-ready ack/full epoch，N收到ready后才退出；C在首次TERM前做实际read-only adopted census，产生完整adoption观测（不得增加signal权限）；同epoch子进程TERM handler日志与之后C新鲜live观测必须同时存在，再KILL/adopted terminal wait/N-last。不用sleep推定ready/收养/TERM-survival，不增加public/test任意信号hook。
若当前production终止在真实adoption观测前已发生，场景失败并由原owner完整清理；不能修改事件文案代替实际时序。原fixture仍protected，C09保持OPEN直到独立审过新pin且另票真实链成功。修改生产pre-signal census如需，必须作为具体源差分先审，不静默包含额外新hook。

## 6. 回退与交付边界
源侧C/Host/manifest成对回退至已保存R5I字节，不能只退一端；不运行git reset、不删旧root/evidence、不动用户AGENTS。任何运行后必须先确认本ticket原epoch终局，不能在活C/N上替换源码。无新接受Gitcommit，不用旧HEAD签新冻结；R6接受后仍须R7/R8/原17+ISO18/新冻结外审/NEXT重锚。
