# 生命周期设计复核：Q1/Q2/Q3

**READONLY_DESIGN_PROPOSAL；不是实现PASS，也不是P2准入。** 输入为INPUT_SNAPSHOT中未提交P1字节，base HEAD仍1d348d419120f23f45d958112ea8c43df5a04675；全部20条源/报告hash与bytes开始核对一致，末尾重新核对见INPUTS.json。固定V仍e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3。未执行Node生产导入、测试、fork/probe/browser/信号、编译、安装或网络；仅文本和hash读取。ADR rev2的原17要求及ISO18完整保留，pilot不是裁剪验收。

MAIN建议：**Q1采用每draw、目标组之外存活的Python标准库custodian/subreaper，写ADR rev3后单writer实施；拒绝worker内subreaper与普通TERM-ignore永久CLEANUP_REQUIRED两条原建议。Q2先纠正Node事件论证并保留上游probe默认行为，先做决定性pilot，只有确需真实child句柄来处理error/强制回收时再释放窄probe owner。Q3已属ADR接受的性能/离线边界，继续实现及真实验证，不向用户再问普通工程选择。**

## 先修准入事实，别直接启动P2

P1 `cache-process-supervisor.ts:236–259` 的readCacheProcessIdentity把/proc stat的state字段fields[0]又用Number解析（`:251 const value=number(0)`，`:256 value===null`返回null）。真实S/R/Z均非数字，故正常身份全被拒绝。`:269–284`组枚举又把/proc读取失败、身份不可读都折叠成空数组。需要由原具名writer先修这两点并加真实自身/子进程/proc负例：**不可读/解析错/权限拒绝必须UNKNOWN，不能当ESRCH/空组**。这是当前输入的静态确定问题，不是本报告已运行的故障实验，也不能被新custodian架构掩盖。

P1 `openfilm-upstream.ts:777–785`源流账本在error和close任一发生时settle；error并非源FD已close，应保存error、destroy必要源并继续等真实close。这是ADR A02已有要求的接线纠正，不需新引擎。独立代码审查可继续覆盖其余实现，本设计不签P1正确。

## Q1：真正活着的reaper在目标组之外

### 最小进程结构和owner

Host → 每draw Python custodian（Host直接child，独占custodian session/group C）→ Node worker（custodian直接child，单独session/group N）→ Chrome/zygote/renderer等（继承N）。Host以固定已核验Python绝对路径和固定参数 `-I -S -B <custodian.py>` 启动，隔离用户site/PYTHONPATH并禁止在源码旁生成pyc；env仍是明确allowlist，ticket不放env。custodian先通过stdlib ctypes调用libc prctl(PR_SET_CHILD_SUBREAPER=36,1)并PR_GET_CHILD_SUBREAPER=37读取核对，再fork Node；失败即不fork、不GO。Linux头文件已静态确认36/37、WNOWAIT和waitpid/waitid接口，**并未调用这些接口验证当前内核支持**。要求Python3已有os.fork/setsid/waitid/WNOWAIT、ctypes/libc，实际WSL Linux/proc能力待pilot；非Linux或能力缺失明确不可准入，不安装依赖，不编译helper。

custodian是唯一负责该draw目标树waitpid的父/reaper；Host只wait/reap自己的Python ChildProcess。custodian不在N组，向N发TERM/KILL时它继续运行并收养、waitpid原worker/Chrome的孤儿。worker内部subreaper在自己被KILL后无法waitpid，不能替代它。per-draw Python不得使用会隐式poll/waitpid目标的Popen/asyncio child watcher；本机subprocess.py:1973–2057明确其poll/wait会reap。选择单线程stdlib os.fork+os.execve、selectors、os.waitid/waitpid的显式唯一wait owner，避免线程fork及竞态reap。SIGCHLD不得SIG_IGN/SA_NOCLDWAIT，也不得随便安装自动waitpid(-1)的handler。

资源表每项有reservation/draw、PID、startticks（原十进制字符串）、PPID、PGID、SID、角色、退出状态与reap记录；不是靠进程名或环境串认归属。custodian只创建一个目标worker，不创建任何无关子进程。被内核收养为custodian直接child的任务由wait父子关系证明归属；采样/proc身份用作校验与诊断，不把一次未采到当未存在。

### rev3握手与两组边界

|实体|Host可核验身份|归属/通道|
|---|---|---|
|custodian C|PID等于Host spawn返回的child.pid；PPID=Host；PGID=SID=C.pid；startticks一致|Host私有控制通道fd4；Node不能继承它|
|目标Node N|PID等于custodian FORKED事件；PPID=C.pid；PGID=SID=N.pid；Host/proc、custodian/proc、Node HELLO一致|原worker独占绘制通道fd3；Host不再要求PPID=Host，也不把N.pid等同child.pid|
|Chrome后代|预期PGID=SID=N.pid；记录startticks与已观察父链；收养后PPID=C.pid是合法状态迁移|不含C；worker局部media policy强制detached:false，原固定执行closure仍须实证|

协议版本升级为明确rev3私有版本，保留公开pageFrame/close形状、issued品牌、scope/ref/generation和witness合同。旧@1 worker不能静默接新身份规则。流程：Host先同步RESERVE责任→spawn固定Python入口（无ticket argv/env）→验证C_HELLO及subreaper声明，记录实际C身份→私有AUTHORIZE_FORK→C建立N并报告FORKED→N_HELLO→Host核验两级内核链→GO一次。custodian fork前已启用subreaper；fork子在任何上游代码前setsid并完成受控exec。setsid/exec状态pipe采用CLOEXEC，exec失败显式报告；没确认N独占session前不得向负N.pid发group signal。若fork子停在setsid之前，没有GO/后代，custodian可直接signal自己**尚未reap的真实child**，不能误杀它此时继承的C组。

READY预算应覆盖两级启动总链，30s不悄悄各加一倍；GO后60s与原seek15/JOB45/capture30不改。任何preHELLO失败都由已活着的custodian负责回收它已经fork的N，Host的reservation和scope继续持有到真实结束。custodian未出生/未fork须用明确状态证明；无HELLO不等于没有child。

### 通道、FD和背压：两条单writer通道

推荐维持Host↔Node原双工绘制socket(fd3)，另增Host↔custodian控制socket(fd4)，不用Python转发8MiB JPEG。Host spawn C时显式只继承这两个私有端点；C fork后把Node fd3 dup2到固定槽，Node不要继承C控制fd4、C自己的selector/wakeup fd或额外管道。C关闭自己保留的Node绘制端副本，避免N死后EOF被C误维持；Host只写N绘制通道，C不插入frame。custodian所有状态/wait/signal receipt只写fd4，Node不写它。ticket在两个私有通道分别绑定draw并只回digest，不能进argv/env/公开错误/log；收到ticket不能替代内核身份。

Node stdout/stderr分别用C创建的独立pipe，C非阻塞读取、各64KiB累计硬上限与8KiB尾部，通过有界诊断frame报告；C自身stdout/stderr由Host单独有界收集，不能与Node混写成协议。C控制输出用单writer队列、明确seq和metadata上限，Node绘制帧仍长度优先、总接收窗口/帧数也有限制，**没有waiter时也不能无限append buffered**。frame.write假返回或EAGAIN要等drain；Host停止消费时不能让C堵在write而停止kill/wait。C用selectors处理读取/写入、SIGCHLD通知及deadline，队列满后停止追加诊断、标失败并清理；最终receipt不可丢成“成功”，Host断管则C本地完成回收后非成功退出，不必等不存在的ACK。

目标child在exec前显式关闭除预定0/1/2/3和exec-status外的所有描述符；使用CLOEXEC/close-range替代假设Python默认继承安全，未使用的socket端全部关闭。Node与Playwright spawn后的实际FD继承须验证：Chromium自己的CDP可能也用fd3/4，这些应是它的新pipe，不能是Host ticket/control socket；校验socket inode/端点而不是仅看fd数字。所有pipe端关闭和输出drain都属于父close证据。

### 退出/信号/reap的关键顺序

1. 原worker得到候选或原native失败后封出生，尝试closePageFrames。候选只是候选，P1正常绘制/跨帧磁盘cache算法不变；晚到launch/raw seek/JOB/capture续体仍在N执行域中。C不根据worker的closed=true或fd3 EOF宣布结束。
2. Host先记录FINALIZE_AFTER_OK与候选digest/seq/当时真实身份，或记录原primary/取消，再要求C FINALIZE/CANCEL。失败、outer deadline、stdout/IPC洪水均同路清理。C本地也有失联/截止触发，不依赖N JS能响应。
3. C先对已确认N组TERM，宽限后若仍有目标成员则KILL；C组不受信号。N如仍活着，身份受C未reap父子关系保护；N如已退出，C用 **waitid(P_PID,N,WEXITED|WNOHANG|WNOWAIT)** 观察并保留它为真正未reap的zombie锚，PID不能被复用。必要的所有负PGID信号必须在释放该锚前完成；不要因普通Node库/自动SIGCHLD watcher早reap让数字失去锚，也不依赖一次stat与signal之间的愿望。这里解决了上一纯Host/Node方案的正常ISO-09 orphan-reap缺口。
4. C在持有N锚期间持续waitid/精确waitpid收割已收养且退出的其他子进程，重复到它们均reap；**不能用waitpid(-1,WNOHANG)盲扫**，因为会抢先reap N。也不能只反复waitid(P_ALL,WNOWAIT)，它可能一直返回同一N zombie而饿死其他wait。可枚举/proc直接children并对每个非N子用waitid(P_PID,...WNOWAIT)和waitpid(该PID)；SIGCHLD只唤醒主loop，不在handler里抢reap。
5. 当目标组只剩N zombie且无任何其他活着或未reap的目标/adopted后代、无可再生child的执行面，停止任何未来组信号，**最后waitpid(N)**。然后继续精确收养/收割检查直到wait查询给ECHILD且/proc无目标SID/PGID、killpg(N,0)确认为ESRCH、known(pid,startticks)全消失。锚还在时不可能要求groupESRCH；先杀/收割其余→最后reap锚→组ESRCH的顺序不能倒置。waitid事件不是reap证据，waitpid返回才是。短生命周期未采样child也必须经内核waitpid/ECHILD覆盖，而非只比knownIDs。
6. C将DOMAIN_REAPED receipt（信号记录、wait状态、known IDs、groupESRCH、subreaper/child关系、protocol seq）发Host并flush，再退出/关自己所有通道。Host必须同时看到C真实ChildProcess close/可接受exit、实际C已reap、自己fresh/proc/group复核和receipt绑定，才接受execution_domain_ended；C exit0单独不够。若Host收到完整receipt后C仍活着，不结束draw。
7. Host同步冻结该serving新资源准入，等待实际HTTP/源流close及父probe结束，再endDraw；workspace再POST/释放两树/同步最终身份门/witness激活、释放scope。C不是父ffprobe的reaper，不能把它的receipt当父账本为空。cancel在最后交付前仍赢过候选成功；原primary和每个cleanup原因保留。

正常TERM-ignore必须在步骤3→6主动KILL并真实wait到FAILED_SETTLED/允许的forced finalize，不停在CLEANUP_REQUIRED。Z等待custodian reap而不是依赖WSL PID1。真实EPERM、proc不可读、prctl失败、escaping SID、custodian意外死亡才进入诚实例外barrier。所有未知仍保留PRE、scope和容量；不是把普通ISO-09改成永远pending。

Host控制fd4 EOF时，C立即进入私有取消，仍在目标组外完成上述TERM/KILL/wait；不会先exit去期待已经不存在的reaper。N绘制通道EOF也促使C清理，不能代替它。C受TERM应进入清理，不默认先死；Host正常不能kill C组作为“取消N”的快捷方式。**C被SIGKILL/崩溃是此小方案的异常边界**：Host不能凭它exit断言原Chrome被reap，不向无锚旧数字盲signal、不交付、不释放原barrier，须保全并让MAIN按新鲜证据处置；不承诺任意custodian死亡都可恢复其wait父权威。这是失败保全，不影响有存活C的正常ISO-09闭环。

整个方案不是恶意native sandbox。固定policy禁止已知未包入口时仍需补齐execFileSync等实际绕路清单，不把JS detached:false当禁止任意native setsid。出现逃组但归属明确的任务可由C真实child关系处置，不能静默纳入陌生group杀；任意native恶意逃逸需cgroup等另票，这里不增加第二架构路线/新依赖。

## Q2：先纠正close论证，再决定最窄probe seam

`node-execFile-source-receipt.json`绑定本机Node v22.22.1，源码摘录hash ca0514b9e2933600df637fe8de94ae095e295d0592a5a787e5b976b229122878已复验。摘录直接显示 **child.on('close',exithandler)** 和 **child.on('error',errorhandler)** 两条callback路径：errorhandler会destroy stdout/stderr并直接调用exithandler，kill()捕获异常也会直接调用exithandler。故“callback永远来自close”不正确。

但P1 §5的另一句“child自行关stdio就让ChildProcess close在child仍live时发出”也不正确。本机 `/usr/share/doc/nodejs/api/child_process.md:1454–1458`明确close要求process ended且stdio关闭；stdio关闭本身不会跳过process exit。对已实际成功spawn的直接child，正常close路径覆盖退出，parent Node/libuv是wait owner；不能拿error callback早调用反过来声称真实close可在live时发生。

真实TERM-ignore且只关stdout/stderr：execFile20s timeout会destroy输出并尝试SIGTERM，但若signal被忽略而无error/throw，原callback通常继续等process exit/close，**不是早resolve，而是可能一直pending**。上游frameDuration promise因此可一直占父drain，原HTTP取消不终止child。error/kill异常路径可能使execFile callback先于真实exit（例如live child的signal错误），是否能在当前same-user真实ffprobe条件发生需实证；ENOENT的spawn error通常根本没child，也不能算活child泄漏。不能用不存在的普通stdio-close反例授权重写路由。

**默认保留固定V原始frameDuration与其缓存**，并把正常close及错误路径依据写清。V host.mjs:158–173实际argv为ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate,r_frame_rate -of json <file>，timeout20000/windowsHide:true；key为file+NUL+stat.size+NUL+stat.mtimeMs；error删key后null，JSON无有效rate也null，先avg再r_frame_rate、0<rate<=1000、seconds=1/rate；route body仍{seconds:number|null}。这些已有行为不凭理论替换。

P2先做下述决定性实验。若仅证实正常close/出生失败无live残留且当前必须场景都可排空，就保持原seam；报告必须保留error callback不等于close的例外，不能因此自签普遍安全。若必须覆盖live probe TERM-ignore主动KILL、或实际error路径callback早回而child仍live，**原frameDuration只给promise不给child句柄，Host无法在该API外补强真实终止**；此时才审批新增 `src/adapters/openfilm/cache-frame-duration-probe.ts` 的窄owner，并只接这一virtual route。

该owner用真实ChildProcess句柄登记spawn→error/exit/close，error保存但不当资源结束；超时先保留原20s失败结果/错误语义，再在明确grace后KILL并wait实际close，固定ffprobe是直接Host child，Host自己reap它，不需要再为这个叶子probe复制Chrome custodian系统。只signal自己仍owned的ChildProcess，不对Host所在进程组发negative signal。spawn失败没有child按实际结算，live error不能null出账。保留原argv、20s、maxBuffer/编码/环境基线、stat key/cache淘汰、rate计算、body/status/headers；新增TERM→KILL仅为退出控制，日志不得称上游原算法已改。路由仍用现有inside/rights/path检查与请求账本；若由Host直接答复，必须return，防pinned handler再启动一次probe。并发同key仍共享一个真实任务，失败删除/cache重复行为与V一致。不要改其他probe、render、EnginePort或全局child_process。

### Q2最小决定性P2观察

- 使用真实execFile和本机Node版本的独立测试helper，记录spawn PID/startticks、stdout/stderr close、child error/exit/close、execFile callback、上游promise resolve、HTTP finish/close与folder drain时点；同时记录每时点实际/proc是否同身份alive或Z。不能只写elapsed。
- 正常真实ffprobe：以固定argv、真实本地媒体调用，证明callback后direct child身份已消失；重复同版本确认同一缓存promise，修改stat版本触发新probe，body与基线一致。
- 一个真实小Node helper先关stdout/stderr但继续活着且忽略TERM：预期stdout close先发生、实际child close/callback不应因此发生；随后由**测试自身持有句柄**KILL并等close再释放，不能让测试留下孤儿。该helper是Node事件语义/控制故障证明，不冒充真实ffprobe自然忽略TERM。
- spawn ENOENT和受控live signal-error分开。后者可用测试专有ChildProcess.kill异常钩子确定性触发真实live helper（明确注入，不冒充当前系统EPERM），记录error/callback/exit先后和最终实际回收；有权限的真实错误pilot才可声称自然OS错误。不能修改Host全局原型或现有正式render。
- 通过真实folder路由和parent probe跨worker结束的案例回答：worker/custodian执行域消失时probe是否仍live、drain是否持有到真实结束。若当前上游API无法给观察所需child句柄，先用同字节execFile摘录的测试专用observer或原host独占测试进程局部观测，不能把mock回调当生产证明。决定启用窄probe owner后，必须再用实际路由与其真实句柄完成闭环，不由小Node helper代替。

## Q3：不重复审批已批准的体验边界

每draw独占Node及现在追加Python的启动/IPC成本、无跨draw内存page复用已是隔离策略代价，实际磁盘cache key/算法继续保留；不能因G04变慢就放宽旧断言或悄悄提高timeout。先pilot记录首帧、第二帧、poster各阶段（queue/READY/draw/finalize/reap/folder drain）并对照既有预算；超过真实预算是可调度/实现问题交MAIN审定，不是自动接受回归。

offline guard在worker局部，固定host.mjs的offline route允许自身origin，V源码支持本地serving仍可访问；但这是可达性推理，不是实际JPEG/iframe/字幕/媒体已成功。必须真实两帧+poster、Q02晚依赖、Q03多frame/duration、K05清理主因、reader/Expected回归；同时实际外部origin请求被拒、无外传，headless/mute事实保留。不能把problems仅写入文案便宣称外部资源失败也可正常交付；按已有业务判定测试实际输出与拒绝行为，必要另提窄纠正，不重写引擎。

custodian不改变原固定FRAME15/JOB45/CAPTURE30；其作用是结束放弃的执行域与reap。每个active scope仍占一个调度额度（最多2），含Python+Node+Chrome，不能因为多了reaper偷加并行。scope从PRE前至最终witness门一直独占同root，unknown不归还容量。parent folder freeze/drain与POST/currentness门原样保留。

## 最小具名实现包与分阶段验证

推荐仅一条reaper路线，不另提native编译方案。待MAIN ADR rev3审定后由当前唯一具名Claude接实现（本报告不自行指挥/授权）。

拟新增：`src/adapters/openfilm/cache-process-custodian.py`；为pilot仅新增 `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs`（已有P1列名，复用scenario modes）与 `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts`。Q2事件pilot拟 `tests/agent-driven/integration/helpers/cache-probe-fixture.mjs`、`tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts`。仅Q2 pilot/合同确实要求时再释放 `src/adapters/openfilm/cache-frame-duration-probe.ts`；不预先把条件文件算已实现。现有改动：cache-process-supervisor.ts（spawn Python/双通道/identity rev3/receipt+close门）、openfilm-cache-worker.mjs（rev3握手/交付和退出）、cache-worker-policy.mjs（具名出生入口闭包）、cache-worker-integrity.json+生成检查脚本（含py与运行入口完整性），openfilm-upstream.ts仅必要probe/真实流close/private drain接线。scope/workspace/reader已有A01..A05语义保持，确需接口变化先由MAIN列名；正式render、V、合同锁和Approved015不动。

先pilot再放全cases：

1. **静态/轻量准入**：修state数字解析与UNKNOWN空组问题；Python源/manifest/协议frame长度/sole writer/FD关闭清单审定，不能从P1轻测通过推断custodian可用。
2. **非浏览器真实pilot**（明确新资源票）：C启动并prctl核验→真实Node helper+孙进程TERM-ignore→kill N组→C收养waitpid→包括Z的身份全灭→C close→scope释放一次；额外leader主动提前退出+WNOWAIT锚、preHELLO失败/setsid前失败、Host断管、C意外死亡负例。一个peer组真实同时存活，A清理不影响B。先证明这条权威链可用，不先花全套Chrome时间。
3. **Q2独立事件pilot**：上述normal/stdio-close/TERM-ignore/error四类结构化记录，MAIN据此确认保持上游还是释放窄owner；所有测试资源最后必须实际收割。
4. **真实Chrome pilot**：当前source/policy/guard字节下正常两帧+poster和ISO-09实际组TERM-ignore变体、SID/PGID/proc、late launch；custodian reaped receipt必须能匹配每个真实退出事实。小Node helper不是Chrome noescape证明，旧r3不是新py/新字节证据。
5. **全量受影响验证**：原17与ISO18逐项保留，真实seek15/JOB45/capture30、peer、late births、洪水、cancel/finalize竞态、reconcile、range源FD关闭/父probe/冻结准入、同root完整scope锁/队列、原Q02/Q03/K05/reader/Expected/静态门及规定全量，最后冻结新SHA再独立审查。尚未执行的case保持NOT_RUN，不以exported case-name数组当测试覆盖。

每capture含实际argv/cwd/输入hash/退出与signal、两组identity、waitid观察和waitpid回执、C/N/Chrome事件序列、父流/probe关闭、PRE释放和scope状态、candidate与最终witness事实；无ticket原文/env/配置秘密。只有“目标组被KILL→活C实际wait全部→C自身close→Host父资源结束”才能关闭本问题；不是等一段时间、只报计数或写subreaper字样。
