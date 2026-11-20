# ADR-060 rev3：独占回收者、真实结算与P1修订合同

状态：MAIN_DIRECTION_SELECTED / PENDING_INDEPENDENT_DOCUMENT_RECHECK；不是代码写入或P2运行授权。2026-11-14。rev2原字节及其批准/审查全部保留，不原地改写。原17要求、ISO-01..18、既有失败/门历史与新429即停规则全部保持。

## 决策与规范依据

MAIN采纳同目录lifecycle-design/REVIEW.md的Q1独立回收者、Q2事件论证纠正与条件probe、Q3原已批准体验边界，并采纳code-review/FINDINGS.json的P1-F01..F11为必须闭环的修订项。下方伴随JSON固定这些文档的实际摘要，规范性引用这些完整细节，不只引用摘要标题。发生冲突时本ADR的明确裁决优先；遇尚未明确的资源/协议接口，先报MAIN，不在代码中静默退化。

独立静态结论是REQUEST_CHANGES：1 BLOCKER、9 MAJOR、1 MINOR；六项静态/类型/调度检查虽绿，没有证明真实worker能够运行。正常/TERM-ignore必须主动真实收尾，不批准以永久CLEANUP_REQUIRED或只报计数替代ISO-09。worker内部subreaper不能在自己SIGKILL后回收孤儿，不采用该方案；也不编译/安装native插件。

## 1. 唯一进程拓扑与真实wait owner

采用Host → 每draw独立Python custodian C（独占SID/PGID C）→ Node worker N（另一个独占SID/PGID N）→ Chrome实际固定后代（继承N）。C在目标N组之外，N组TERM/KILL时C必须活着收养并waitpid。Host只wait/reap其直接child C，C是N/收养后代唯一wait owner。

新增源文件拟定为src/adapters/openfilm/cache-process-custodian.py。仅现有Python3标准库ctypes/os/selectors/socket/signal及本机Linux libc/procfs，固定已核验的Python绝对路径，以-I -S -B和固定脚本参数启动，不搜索用户site/PYTHONPATH，不生成源码旁pyc，不shell、不传ticket至argv/env/log。prctl SET/GET_CHILD_SUBREAPER在任何fork前设置并核验；能力不可用则明确不可准入，不下载安装。实际内核能力由授权pilot证明，文档不宣称已运行。

C用单线程os.fork/execve/setsid、显式waitid/waitpid；不使用Popen/asyncio自动child watcher或SIGCHLD=SIG_IGN/SA_NOCLDWAIT。N仍活着时有未reap父子权威；N退出后用waitid(P_PID,N,WEXITED|WNOHANG|WNOWAIT)保留真实zombie锚，所有必要的组信号必须在最后reap N之前发完。逐一枚举真实直接/收养children，对每个非N退出child waitpid；禁止waitpid(-1)抢reap N，禁止P_ALL WNOWAIT永远命中N导致其他child饥饿。

顺序固定：TERM→宽限→必要KILL目标N组→C收养并真实reap其余后代→只有N zombie且无其他执行面时停止未来组信号→最后waitpid(N)→ECHILD、group ESRCH、known(pid,startticks)消失含Z→C完成有界回执并退出/关闭→Host观察C真实close/reap并新鲜复核→父HTTP/源流/probe排空→endDraw→POST/两tree释放/最终witness门→归还scope。锚保留时组当然不ESRCH，不能把最后两步倒置。Host断管时C也先完成清理再退出；不等不存在的Host ACK阻塞回收。

C意外SIGKILL/权限拒绝/proc不可知/归属不明逃组属于保全异常：不盲信旧数字、不交付、不释放责任，MAIN按新鲜证据处置。不是恶意native内核sandbox或全平台保证。普通TERM-ignore不是例外，必须通过存活C完成waitpid。

## 2. rev3私有协议与FD

协议明确升级为narralens.openfilm-cache-process@3；旧@1不静默兼容身份结构。固定两级链：reservation→C_HELLO（pid等于Host spawn child.pid，ppid=Host，sid=pgid=pid，startticks一致、subreaper已核）→AUTHORIZE_FORK→FORKED/exec-status→N_HELLO（pid等于C报告，ppid=C，sid=pgid=N.pid；C/Host/proc/worker一致）→GO一次。所有事实验证完才采纳身份；不能先写leader再检查。

Host↔N绘制双工fd3与Host↔C控制双工fd4独立，分别单writer；C不转发大JPEG、不混写绘制协议，N不能继承C控制端，C关闭N绘制端副本避免维持假EOF。N exec前显式关掉所有非预定fd，exec-status采用CLOEXEC，setsid/exec失败明确回报。Chromium CDP可能也用fd3/4，验的是socket inode/真实端点，不能仅凭数字相同误称泄漏。身份startticks保存十进制字符串/精确整数，不用Number丢精度。

metadata16KiB、request64KiB、JPEG8MiB、每路stdout/stderr累计64KiB与8KiB尾部沿既批预算。两通道增量decoder在每次data到达即核header/协议阶段/帧数/未消费总buffer，即使无waiter也有界；超限立即锁存失败并启动owned清理，不能只截尾/设flag后继续成功。C用selectors及有界队列处理背压、信号唤醒与截止；控制输出阻塞不能让它停下kill/wait。C与N诊断分别限额，分段有序回执不得无界积累。Host失联时不以输出flush失败阻碍本地回收。

READY30秒覆盖完整两级启动链，不给C/N各偷偷加30秒；GO后outer60秒含完整候选接收；收到合法候选后finalize3秒覆盖close消息与raw关闭，而不是await close后才开始计时。TERM宽限3秒、KILL确认15秒是动作/UNKNOWN截止，不是成功依据。原FRAME15/JOB45/CAPTURE30保持，全部阻塞read、半JPEG、closePageFrames等待、诊断/协议洪水和取消都进入同一单调失败/清理状态机。

## 3. P1代码修订必须逐编号闭环

|发现|强制实现与证明|
|---|---|
|F01|两个原parser及新Python parser正确解析/proc首PID、右括号后state/ppid/pgid/sid/startticks；comm含空格/括号、S/R/Z、畸形与实际自身identity均测。|
|F02|kernel查询known/gone/unknown三态；只有确定ENOENT/ESRCH作gone，EIO/EACCES/解析错不得当空组。退出必须真实C close+目标reaped回执+新鲜组/记录身份检查，任何timer不能替代close。|
|F03|DrawHandle绑定具体supervisor issuer，foreign实例的真实handle也拒绝。reconcile仅held且原run已让出结算责任，复用同一完整执行证明，不能由组空抢settle正在跑的draw。|
|F04|生产owner同步登记queue到结算的真实responsibility，保留supervisor+issued handle+scope+父drain责任。首次失败/取消立即锁存，不准reconcile把flood后candidate转成功。真实完整证明后由私有completion解除同一cleanup-held标记，再由原finally释放一次，测试reset不是生产恢复入口。|
|F05|C身份等于实际Host child；N身份绑定C受控fork与真实PPID链。TERM/KILL均持真实未reap锚与正确SID/PGID，不允许失锚仍signal，也不以child-only回收推断全域结束。|
|F06|每个协议/阶段阻塞点都有真正参与控制的deadline/cancel，超时主动回收，再settle或保全UNKNOWN；下一正常draw可继续。|
|F07|入向/出向协议及全部阶段stdout/stderr预算均即时生效，合法最大请求/JPEG有正向对照，不用“所有都拒绝”通过安全门。|
|F08|pageFrame入口在首个await之前登记包含queue的完整责任；owner.close封准入、取消未GO排队并等待全部accepted，重复close共享同一promise。获准后重验draining/lease；workspace传已有abort给scheduler。|
|F09|observed exit/code/signal、协议错误、取消、超限与FINALIZE_AFTER_OK顺序单调锁存。候选+组空不能补签成功；已知先发生的异常/closed fatal必失败；只有合法先finalize后授权终止的一支可能交付。|
|F10|source error保存原对象并必要destroy，但继续等真实源close，destroy异常也保留；response finish/close不是源FD close。父drain未知时保留PRE/scope，不吞cleanup异常。|
|F11|测试枚举实际identity.pgid，不能假定process.pid为组长；detached另用真正受控child证明。|

跨进程原错误采用有界结构化envelope保留name/code/message/stack/cause/cleanup与native phase、动作；明确它是传输事实，不冒充原JS对象身份。Host同进程primary/cancel reason及cleanup原对象仍保留。不能只取message造通用PRODUCER_FAILED而丢seek/JOB/capture与清理区分。

为使F04生产可达，MAIN选择同一owner私有账本方案：openfilm-upstream.ts内部WeakMap按真正issued producer/serving owner保存responsibilities；OpenFilmServingBridge私有面新增inspectCleanup/reconcileCleanup，CreatedNativeWorkspaceService对应新增Host-only inspectNativeCacheCleanup()/reconcileNativeCacheCleanup(opaqueHandle)。不新增HTTP/公开DTO/EnginePort方法，不修改pageFrame/close签名。返回的handle必须由该service/bridge私有issuer签发；cleanup在ref已过期时仍可结束原责任，但不能借此恢复创作授权。supervisor只证明execution；bridge继续完成原父drain；workspace的PRE/POST/finally依然持原责任，不能由诊断API提前关闭tree。锁存失败的reconcile只能回原失败，不产生新witness。具体签名/返回私有类型、调用点枚举在release前列入差异，静态fitness若因新Host私有调用需登记，只准精确登记，不能放宽unknown/class/arrow规则。

## 4. 父frameDuration：保持默认，先证事件语义

纠正P1报告：ChildProcess的close需要进程退出且stdio关闭，stdio自行关闭不能证明活child已close；execFile callback另有error/kill-throw提前路径，因此callback也不能普遍等同真实reap。本机Node源码/版本与本地API文档已经静态核对，不是实际故障实验。

默认保留固定V原frameDuration及其缓存/路由，不先改公开响应。决定性P2a要记录真实pid/startticks、stdio-close/error/exit/close、callback/promise、HTTP/父drain时间序；区分正常真实ffprobe、只关闭stdio但仍活的helper、TERM-ignore、spawn无child错误与明确标注注入的live signal error。测试owner持真实句柄最终KILL/reap，绝不留下孤儿；helper不冒充ffprobe自然故障。

若必须覆盖live probe主动回收或实际callback早回但child仍活，MAIN再具名批准cache-frame-duration-probe.ts窄owner，只接__film/frame-duration，不重写其他probe/引擎。保留固定argv、20秒timeout、原maxBuffer/编码/环境、stat版本key/同key共享promise/失败删cache、avg优先r_frame_rate与0<rate<=1000、seconds=1/rate、body/status/headers/path/rights约束；只增强生命周期TERM→KILL/实际close，原错误事实保留。该条件源文件本ADR不自动授权。

## 5. 精确候选文件与验收顺序

拟新增：src/adapters/openfilm/cache-process-custodian.py；tests/agent-driven/integration/helpers/cache-worker-fixture.mjs（scenario模式复用，不再分别复制ignore/flood三个worker）；cache-probe-fixture.mjs同目录；tests/agent-driven/integration/cache-custodian-lifecycle.test.ts、cache-frame-duration-lifetime.test.ts、cache-process-identity.test.ts、cache-serving-drain.test.ts。这些是候选allowlist，最终ReleaseAssignment按完整路径与hash展开。P1现有八个新文件及既有六个范围可按F01..11窄修；正式render/V/锁/Approved015/公共合同/源事务不变。

recorder已实际核对包含.py，原run-recorded.py无需修改；每次新生成manifest覆盖py原字节、固定解释器真实路径/版本与Node/guard/pin依赖，不能执行时重新生成/接受变更字节。Python源语法只parse不执行、不生成pyc；真实prctl/fork/setsid/wait必须另有P2a资源票。

执行顺序不能跳：

1. 本ADR独立文档复验通过，MAIN把P1-F01..11、具名路径/私有接口/精确初始命令冻结，才释放Claude修订；所有失败先统一recorder，即使开发期也要保留。旧两次失败只能记UNRECORDED/UNKNOWN，不能补造原日志；新反事实另列新时间新argv。
2. 修订的静态/类型/identity/调度/协议纯门及独立源码检查；新实际子进程尚NOT_RUN。
3. P2a非浏览器真实pilot：C prctl核验、Node+真实孙进程TERM-ignore、N组KILL、WNOWAIT锚/最后waitpid、Z全回收、C自身close、peer不受影响、preHELLO/setsid前失败、父断管、C意外死亡failclosed；加Q2决定性事件pilot和真实源流关闭/准入冻结。每个故障都有正常成功对照及实际清理收据。
4. P2b当前字节真实Chrome两帧+poster/组继承/整组退出，记录queue/READY/draw/finalize/reap/folder各阶段耗时；不凭旧r3或小Node helper签Chrome。原预算不自动放宽；Q02/Q03/K05、Expected与reader受影响回归都需重验。
5. 原17与ISO18全部直接证据、规定全量门/生产构建/证据校验/安全/新SHA冻结独立外审；通过后才完成下一接线最终合同和验收包并停在开工门。不能把P1、pilot或诊断短片当A/V1体验。

无新的人工产品路线决策：Q3成本沿已批每draw隔离策略，新增Python/IPC成本必须实测；headless、静音、loopback、无外传/付费/安装/J盘/配置凭据读改。新Claude429立即停，禁止自动重试/换供应商/Codex接手。
