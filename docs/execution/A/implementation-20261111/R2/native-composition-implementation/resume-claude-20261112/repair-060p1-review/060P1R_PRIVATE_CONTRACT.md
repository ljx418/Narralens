# 060P1R：rev3发布所需私有接口与FD/预算展开

状态：MAIN合同选择；须与具名RELEASE_060P1R.json共同使用，没有该票据不授权写入或运行。依据已独立DOCUMENT_PLAN_READY的ADR060 rev3及R3-R01..03。本文件不修改public DTO、EnginePort7、固定上游/Approved015/正式render。新429仍立即停。

## A. execution与whole production分阶段，一份真实责任

每个实际producer pageFrame入口在首await前同步登记`ProductionResponsibility`，该对象由同一owner私有WeakMap签发，包含owner/实际scope与物理root/generation、排队取消controller、真实supervisor+DrawHandle、execution gate、parent phase、tree phase、锁存outcome和wholeProduction settlement。公开pageFrame/close签名保持，真实责任不靠错误对象字段、PID、nonce或JSON反查。

- `CacheProcessSupervisor.reserve(request)`只创建本实例signed DrawHandle；`start(handle)`只对本issuer且reserved状态启动一次，返回execution settlement；兼容draw(request)只能是同一reserve/start包装，实际factory必须保存真实handle后才start。全局WeakMap必须记录issuer或改实例private map。start不得私造第二reservation。
- 失败/cancel/协议/预算/提前异常exit第一次出现即锁存，candidate只是候选。native error用受限结构化envelope传输，Host原primary和cleanup对象保持；execution reconcile不能把原失败改成picture成功。
- `inspectCleanup(handle)`只读；`reconcileCleanup(handle)`只处理该issuer、cleanup-held且原run已交出终结责任的对象。它验证C真实close/reap、匹配receipt、目标fresh group ESRCH/ECHILD证明及known身份gone，unknown仍hold。成功仅解除**execution gate**，保留完整scope active/held，原bridge continuation随后才能运行；它不等待父drain或wholeProduction，避免双方互等。
- upstream私有issued producer/serving owner账本保存原responsibility；`OpenFilmServingBridge.inspectCleanup()`返回本bridge的只读状态及opaque cleanup handle，`reconcileCleanup(handle)`验证本bridge签发/对应root后推进同一execution gate，返回当前分阶段状态，不以返回本身声称whole production完成。
- `CreatedNativeWorkspaceService.inspectNativeCacheCleanup()`只列本实例真实responsibilities；`reconcileNativeCacheCleanup(handle)`只接本service私有issued handle、委托原bridge，不能拿另一个service的真实handle工作。此Host-only面无HTTP/DTO注册，ref已过期可结束原cleanup，但不能恢复创作授权/旧proof。
- execution结束后原bridge同步freeze admission，再await真实HTTP/source close/probe，随后endDraw。parent unknown仍保持原责任/PRE/scope，不能因为execution已清就退还根。
- 原workspace操作继续处理锁存失败或POST；其内层finally真实释放PRE/POST两tree并保留失败。仅当全部必需资源实结算时，完整scope owner生成一次`ProductionCleanupCompletion`，绑定本issuer/同reservation/真实scope/root/generation、execution receipt、parent receipt、实际tree release receipts及原outcome；未拥有阶段由构造期kind明确为NOT_OWNED，不能由caller布尔值跳过。在workspace模式必需三阶段齐全，direct factory模式仅释放它真正持有的scope，不清外层workspace责任。
- 原outer finally内同步消费该私有completion，先清**同一责任**held标记，再立即调用原scope释放一次；两步之间无await、用户callback或新准入。completion不能由诊断API或supervisor直接构造/裸clear(scope)；opaque registry在实际scope owner闭包内。tree释放未知不能mint完成，任何观察timer都不能伪造receipt。
- wholeProduction状态由上述原continuation真实结束，closed/失败可重复观察但不重复执行。producer.close封新准入、取消未GO队列并等待登记的全部责任；重复close共享同一promise。获准后/GO前再次核owner闭态与租约，workspace已有abort传scheduler。cleanup-held继续占容量，测试reset不是生产恢复方案。

## B. 固定FD与EOF责任表

|进程|端点|持有/关闭责任|
|---|---|---|
|Host|C标准输出/错误两个pipe|各自有界读，等待真实close，不混入协议|
|Host|绘制双工socket父端，传递给C的子端为fd3|Host与N各自单writer；Host观测N绘制EOF并向C控制通道发cancel，不让已关闭副本的C声称直接观测它|
|Host|控制双工socket父端，C端为fd4|Host/C独占方向；C本地观测控制EOF即cleanup，不等Host ACK|
|C|fd3绘制子端|只为fork/exec交给N，随后关闭自己的副本，防维持假EOF|
|C|fd4控制端与selector/wakeup/exec-status|仅C持有；N exec前必须关闭这些端点；exec-status CLOEXEC读完关闭|
|C/N|N标准0/1/2/3|stdin固定非交互；stdout/stderr由C专用非阻塞pipe读取；N fd3映射绘制端。dup2必须先做不会覆盖仍需保留源FD的映射，再close无关副本|
|Chrome后代|Playwright自身管道|其fd3/4可以属于CDP，但不得是Host控制/ticket socket；实证按inode/端点，不按数字猜|

Node/Python exec前关闭除明确0/1/2/3与CLOEXEC状态端之外的全部子端副本；协议口未关闭时不能称settled。Host只有确认C进程真实close/reap、C control/draw/stdio原任务全结束且目标新鲜gone，才解除execution。控制通道Host不消费时，C selector循环不能被write阻塞而停止kill/wait；Host断管本地清理优先于flush。

## C. 数值资源界限与最终receipt

沿已批：metadata16KiB、GO request64KiB、单JPEG8MiB、C与N各自stdout/stderr每路累计64KiB/尾8KiB；READY30s总两级链、GO后outer60s含JPEG、候选后finalize3s含closed阶段、TERM3s、KILL确认15s。截止只触发动作/UNKNOWN，不能当资源结束。

明确新增适配层有界表：每个入向decoder同时最多一个合法当前frame，未消费buffer上限8MiB+4（在metadata阶段只允许16KiB+4，request阶段64KiB+4）；协议阶段允许帧类型/次数固定，额外帧即失败，不能无waiter积压。出向control队列上限256KiB、最多16个待写frame，cleanup/最终receipt有单独预留16KiB终端槽；diagnostic满后停止添加诊断并锁存失败，但kill/wait继续，不用丢最终receipt后声称成功。identity记录最多512个，同时超出即失败并主动清理，不能继续生成成功witness；不能丢未回收child的父权威，最终ECHILD/真实reap仍必需。合法两帧/poster及最大合法请求/JPEG须证明这些预算足够，不自动提高预算或用全拒绝代替正向。

receipt按有界seq分段：身份/信号/wait事件分段记录，最终小于16KiB的summary绑定draw、C/N精确identity、完整事件digest/count、ECHILD/组ESRCH及原outcome。Host逐段检序/digest/length，超限/缺段/控制EOF前无最终receipt不能mint成功；C在不可flush/Host断连时仍完成本地回收并非成功退出。数字PID/startticks不能从wire body提供；identity startticks用十进制字符串或精确整数，不Number丢精度。

## D. 固定运行前提与检查边界

本机已只读核对Python=/usr/bin/python3.12，3.12.3，sha256=e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f（8020928bytes），详细在PYTHON_ENVIRONMENT_BASELINE.json。仅已观察stdlib fork/setsid/waitid/waitpid/WNOWAIT符号存在，prctl及实际wait行为尚NOT_RUN。固定-I -S -B <已核sha的custodian.py>，不从用户PATH寻找另一个解释器；hash/版本变更明确ENGINE_UNAVAILABLE并报告。ctypes用已加载libc符号，不调用会启动ldconfig/gcc的find_library，不安装/编译依赖。Node实际execPath、pin/guard与新py/worker/policy原字节纳入完整性检查；不自引用manifest。

child环境只传明确工具/locale/浏览器二进制路径，排除NODE_OPTIONS/PYTHONPATH/凭据；每draw HOME/XDG/user-data等采用真实owned临时目录，仅传child env，不修改父进程/用户配置或全局HOME。真实清理完才删临时目录，UNKNOWN保留。不得读取/proc/environ、全量env或用户配置/凭据。

初始仅源码实现、类型/语法、identity/protocol纯测试与原静态门；Python语法用ast.parse，不运行custodian main，不写pyc。P2a另票才可实际prctl/fork/setsid/wait/信号/本地HTTP，先无浏览器pilot再Q2决定probe seam；P2b再当前Chrome。发现sync接口、FD清理、合法预算或未列文件不足，带具体证据问MAIN，不借常规实现偷换架构。
