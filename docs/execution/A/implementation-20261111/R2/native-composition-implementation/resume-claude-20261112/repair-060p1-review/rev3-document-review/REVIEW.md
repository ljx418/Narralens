# ADR-060 rev3 独立文档审查

**DOCUMENT_PLAN_READY**。MAIN所选组外Python custodian与P1修订合同在架构方向上可实施，未发现必须重新选择架构的BLOCKER/MAJOR或可复现的规范矛盾。此结论只到文档门；不关闭原P1代码finding，不授予源码写入/真实运行，不签P2、N1N2或业务PASS。

目标ADR SHA256：`326bed74476956e363a1168460803f35b57e088259cf30e6a6c1315583d395ac`。ADR、五份规范性引用及原rev2摘要均匹配绑定，完整规范引用已读取；8份实际输入结束时重读未变，见INPUTS.json。没有读取变动源码冒充新冻结，也没有执行生产Node/Python、内核能力或子进程实验。

## 可实施性与反例

Host只wait/reap其直接child C；C位于N目标组之外，拥有N及收养后代的wait权威。TERM-ignore时杀N组不会先杀C；C保留N的真实未reap身份，通过WNOWAIT观察其退出、精确wait其他child，所有必要组信号完成后才最后waitpid(N)，再验证ECHILD、组ESRCH和记录身份含Z消失。17–19行及完整引用明确处理了“锚还在组不可能空”的先后关系，没有把waitid观察写成已reap，也没有依赖worker内subreaper在自身KILL后继续工作。

两级握手明确区分Host spawn child.pid=C与C fork N.pid；N的PPID应为C，所有字段在采纳身份前验证。规范引用对setsid前失败允许处置真实未reap直接child，却不允许向未确认的N负组号或C组发signal。C意外死亡、权限和proc不明为保全异常；不是正常TERM-ignore的退化出口。该边界诚实，不是恶意native sandbox或全平台保证。

双通道分离绘制与控制，C不转发JPEG，关闭N绘制端副本避免假EOF；N不能继承控制端。stdio、控制输出分别有界，selectors处理背压与信号，失联不等待Host ACK或flush才清理。READY30秒覆盖完整两级启动，outer60秒包括完整候选，finalize3秒从候选起覆盖close等待；这些均是动作截止，不代替真实close/reap。合法最大请求/JPEG和正常成功对照也保留，不能靠全拒绝过门。

## F04的最小精确接口展开

40/51行的方向与19行的全链顺序相容：supervisor只证明execution，bridge继续父drain，workspace保留PRE/POST/finally。没有必要为此重写架构，但**最终ReleaseAssignment必须把下列阶段写入私有接口/owner合同，不能只留下一个通用completion回调**：

1. execution receipt绑定同一draw/C/N/issuer；C真实close/reap及新鲜证明完成后，只解除execution等待，让原bridge continuation运行。scope仍active/held，不能在supervisor层归还root/容量。
2. bridge同步freeze并排空HTTP/source/probe，再endDraw；workspace按原锁存outcome继续失败清理或POST/两tree释放/最终门。父资源或tree释放未知仍保留同一责任，不因execution已结束清除这些unknown。
3. 完整scope owner在全部必需资源真正结束后消费一次私有completion；它绑定真实scope对象、generation/root、各阶段receipt与原outcome。仅解除该责任的cleanup-held标记，随即由原outer finally释放active scope一次；中间不能await、开放准入或调用外部callback。不是诊断API的裸clear(scope)。
4. execution gate与整个production settlement分开，避免reconcile等父drain、父drain又等未解除execution gate的循环。ref过期不妨碍结束原cleanup，但不能恢复创作授权；锁存失败reconcile不产生witness。

这些是已选分层方案的接口展开与防误实现条件，不是新增源码授权。ISO-11/06/12/13/16须证明execution恢复后父drain或PRE close仍阻塞时不能启动下一同root生产；全部真实结束后一次释放、下一draw成功，原primary保持。若实现无法提供这条非循环责任链，须停在release前向MAIN报告。

另需在最终协议FD表写明：C关闭绘制端副本后，绘制EOF由Host观测并发控制取消；控制EOF由C本地观测。不能让C凭已关闭的fd直接观察N绘制EOF。逐端点dup2/close/CLOEXEC、实际socket inode、每帧/总buffer/queue/身份记录预算及最终receipt背压策略都须冻结。本架构已有可行落点，属于具体release接口责任，不把尚未逐个命名当作当前新MAJOR。

## P1覆盖、probe与体验验收

37–47行逐条覆盖F01..F11；49行补齐有界原错误envelope并保留Host原primary/cleanup对象。51行新增Host-only bridge/workspace inspect/reconcile使真实生产owner能够拿到原责任，未新增HTTP/公共DTO/EnginePort方法；这补上方向，尚不是实现证明。逐finding设计映射与反例见FINDINGS.json。

Q2纠正了“关闭stdio即可使活child发生close”论证，同时保留execFile error/kill异常可能提前callback的区别。默认不替换上游probe；P2a分别观察真实ffprobe、stdio-close活helper、TERM-ignore、无child出生失败和明确注入live error。仅MAIN条件批准后才增加窄probe owner，缓存/argv/20秒/输出语义不借机改写。该顺序可证且不扩大本票公开响应面。

原17与ISO-01..18全部保留。P2a先验证真实Python/prctl/fork/setsid/WNOWAIT/reap、Z/peer/断管/C死亡与真实源流/probe；P2b用当前Chrome两帧+poster与既有预算证明真实闭包，不能用小Node helper或旧policy签Chrome。Q02/Q03/K05、reader/Expected和规定全量/构建/冻结外审仍需重验。成本不自动换取放宽timeout，实际Python路径/版本/能力与完整性清单都待真实授权pilot和精确release落实。旧未记录失败继续UNRECORDED，原recorder不改，新失败先捕获。

本次Python环境/系统调用/子进程/信号/Chrome、probe、Host、测试/构建、媒体和人工体验全部NOT_RUN。唯一Claude仍待MAIN另发精确release；原P1 REQUEST_CHANGES、原失败与N1N2未接受状态均未被本报告改写。
