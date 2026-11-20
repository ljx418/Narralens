# ADR-060：固定 OpenFilm 缓存绘制采用每 draw 独占进程结算

状态：MAIN_ARCHITECTURE_DIRECTION_APPROVED / IMPLEMENTATION_NOT_RELEASED。仅针对 A057-04 的内部生产者生命周期，原17要求不减、上游SHA/pin/渲染算法/Approved015/public DTO不改。实际实施须在059交还写入权并由MAIN发精确060 ReleaseAssignment后开始。任何新Claude429立即停止，不自动接手。

依据：冻结候选1d348d419120f23f45d958112ea8c43df5a04675的独立A/B REQUEST_CHANGES；058 Claude方案和独立settlement-design/isolated-process-feasibility两份只读报告。原公开pageFrame/closePageFrames无法取得race后raw任务结束证明。永久abandon、隔离后宣称完成不采用；大面积AST插桩与全局原型patch也不采用。MAIN选择复用既有正式render的worker-local policy和进程域模式，但不修改正式render实现，也不照抄其不完整fallback。

## 变更范围与兼容

- OpenFilmCacheProducerOwner.pageFrame/close形状与factory issued品牌保持；Host-private工作副本/serving/ref/generation绑定仍是授权入口。内部每次draw使用独立Node worker及独占POSIX session/group，直接加载已经复核hash的固定pageframes原始模块。
- 原pageFrame key、cache写入、FRAME15s/JOB45s/CAPTURE30s及输出语义不改。跨draw内存页缓存不保留；磁盘派生缓存仍按原算法。浏览器启动开销增加，不能承诺性能不变；本项验收必须含正常连续两帧和poster，不以禁用真实绘制换取清理。
- 只在独占worker安装既有media-process-policy与局部出生闸门/网络和静音策略，不在共享Host改child_process、FilmPage.prototype或用户配置。不能修改V/vendor/lock/正式render guard/pin/已批准015。复用模块仅import，若需改变它们先另票。
- 当前可核实平台是Linux/WSL+procfs/POSIX进程域。非Linux不伪装已验；若实现需要额外平台能力，报告具体前提，不擅自下载安装或扩大到全平台承诺。

## 原始输入、输出与结算三件事

1. spawn前同步登记reservation和完整draw责任；PID只能spawn后取得，禁止自造startticks。parent在私有继承通道得到HELLO后，用内核PID/startticks/PPID/PGID/SID验证真实worker；未获GO前worker不得加载上游或启动Chrome。ticket只走私有通道，不放argv、URL、日志或环境。
2. worker验证自身代码/复用policy/固定模块摘要，安装出生闸门后只执行一次真实pageFrame。response是候选JPEG或原始错误，绝非settled=true授权。parent不能因收到候选buffer就交付。
3. worker完成/失败后封新子进程出生并保住leader，尝试关闭原浏览器；即使closePageFrames空返，仍由真实进程域清理证明。parent有界graceful→精确组TERM→精确组KILL并等待真实child close、group ESRCH、同PGID/SID与记录身份全部消失（包括Z）。信号成功、leader exit、超时到点、isConnected一次观察均不构成整组结束。
4. 只有进程执行域消失后才排空父serving HTTP/stream/ffprobe账本，之后endDraw；workspace继续await桥完整promise，PRE在此前保持。不能在accepted>0时递归serving.close形成死锁，也不能先关listener来伪称没有迟到消费者。
5. 成功候选最后还要通过源/view/owner/currentness和原witness完整门；取消或协议/输出/归属失败优先，不交付晚到成功。失败在真实排空后正常FAILED_SETTLED，无需永久锁死全部服务；真实无法证明的异常保留CLEANUP_REQUIRED和全部原因，不凭截止强制PASS。

## 精确回收、peer与并发

每个worker独占组，固定子进程路径必须继承同PGID/SID。既有policy覆盖spawn/spawnSync/execFile；未覆盖的fork/exec/native逃组不能凭口头假定无关，须用固定调用清单、worker-local拒绝规则及真实Chrome诊断证明实际闭包。记录Chrome/zygote/renderer/utility等(pid,startticks,pgid,sid)，不读/proc/environ、不按进程名kill。不是恶意native程序的内核sandbox声明。

发signal前校验存活leader锚或同样强的owned身份；不能catch后只kill leader却称整组成功。leader意外提前死亡/PID重用/EPERM/不同SID后代出现均进入明确保全分支，禁止盲杀旧数字。正常协议保住leader到finalize结束；需要支持异常强回收而现有身份不足时，应先提出精确额外能力，不能暗中降低归属条件。

Host容量拟固定最多2个运行draw，其余排队；这是相对原cache模块单queue的新增内部调度约束，不冒充原模块已有并发行为；同一实际workspace/cache根串行，避免相同key竞写和持续请求妨碍drain。不同owner独立组，A的seek/JOB/close只处理A，不杀B；真实peer测试须并行存在B进程且B成功，不用集合数替代。并发规则是新增适配层调度，最终代码和测试需明确验证，不改vitest默认并发。

owner.close保持封新准入、等待已受理操作的原语义；每个draw有明确外层deadline以触发清理，故普通超时可闭环。父关闭/断管可私有取消，但不扩公开pageFrame wire形状。重复close复用同一settlement，不重复释放、不复活品牌或授权。

## 私有协议、预算与可追溯性

请求/响应采用私有继承二进制pipe，固定header先验长度，再增量接收；不先反序列化巨大Node IPC对象。建议协议版本narralens.openfilm-cache-process@1，metadata16KiB、request64KiB、JPEG8MiB；stdout/stderr各64KiB累计上限，诊断尾部8KiB。超限真实拒绝并清理，不只截断后继续PASS。数值是新适配层资源边界，必须用实际合法fixture证明足够；若实际原合法请求受损，MAIN审定调整，不改原producer图像算法。

拟READY30s，GO后外层60s，温和finalize3s、TERM宽限3s、KILL确认15s；都是动作/UNKNOWN截止，不是到点即settled。必须区分parent outer timeout与原seek/JOB/capture超时，原45s分支不能被较早外层deadline遮住。可以有意终止已经返回完整候选的独占进程域，但必须满足所有结算与最终授权门；日志标forced_finalize，不能写graceful exit0。未知自发SIGKILL绝不当成功。

worker/supervisor/局部policy/guard与实际固定producer依赖纳入新增内部完整性清单（原字节SHA256），实际加载路径与hash落证；Manifest的Host构建信任与上游固定hash区分，不制造自引用摘要循环。根只来自原签发能力，child私有通道不增加用户授权；字段、ticket、绝对路径和环境不能泄漏到公共错误details。

## 最小计划路径（尚未写入授权）

拟新增：src/adapters/openfilm/cache-process-supervisor.ts、openfilm-cache-worker.mjs、cache-worker-policy.mjs及专用integrity清单；协议可内聚到上述文件，确需额外模块先列精确名。现有主要接线仅openfilm-upstream.ts factory/bridge和必要的父folder-drain私有接口；workspace按下方rev2明确的完整生产scope和无转移barrier接线；不重写原源/事务/Expected算法，不用错误flag代替PRE所有权。

拟测试：tests/agent-driven/integration/cache-process-settlement.test.ts；worker协议/进程故障helper与实际containment证据脚本精确名单待ReleaseAssignment。原Q02/Q03/K05、reader、Expected、正式renderer回归均保留。不得在059文件释放中偷开始这些架构改动。

## 必须实证的退出条件

真实正常两帧+poster；真实seek15s与JOB45s；capture30s真实资源+明确transport barrier或等价可核实路径（不冒充自然卡顿）；late launch/newPage交付barrier；并行peer存活并成功；父close/cancel/断管；真输出/协议洪水；TERM-ignore→KILL真实回收；EPERM/leader提前退出/未知归属不伪settled；新worker与当前policy字节下Chrome组继承/整组退出，包括Z和已知后代。原生错误与cleanup对象都保留。

旧r3 containment证据policy hash不同于当前057，不可代替新实测。默认fullcheck的旧REAL_TOOLS skip仍NOT_RUN；新A04必要重活必须显式独占授权并执行，不能因为不进默认check就叫可选且最终跳过。所有新runtime目前NOT_RUN。

全部修复、受影响回归及全量真实门稳定后，由MAIN冻结新SHA并独立复审；本ADR不是N1N2 PASS，也不准入下一接线/S01/NativeAck/Studio/A片/V1。


## rev2：独立审查 ADR060-A01..A05 的规范性闭环

本节是MAIN选择的实现合同，覆盖上面“拟/若需要”的相应不确定项。原rev1与独立审查报告均保留。仍无060源码/运行release，必须等059交还writer和本节复核后另发。

### A01：明确选择无资源转移的 settlement barrier

本票不采用PRE quarantine转移方案。每个draw在spawn前创建且不可伪造的内部DrawHandle，拥有`outcome`（未定/候选/原始错误）、`phase`、`settlement` promise和有界诊断。bridge.draw返回的完整promise在CLEANUP_REQUIRED期间保持pending，不因确认截止而reject；beginDraw、workspace的词法PRE变量、full-production root lease、FD与容量都继续存活。workspace.close/dispose继续等待该已受理操作，不能执行其finally来释放仍被使用的根。调用方取消不是资源settled；可立即发内部cleanup_required诊断，但不能把它做成操作已完成的receipt。

`CacheProcessSupervisor.inspectCleanup(handle)`只给内部有界状态；`reconcileCleanup(handle)`只接受该supervisor私有WeakMap中真实handle，用新鲜内核身份/组消失与父资源drain重新证明，不能接受用户JSON、PID或error.cleanup_required来mint结算。此方法不自动向已失去锚的旧数字发signal。证明完成后同一barrier恰好settle一次：若原操作已失败则保留原始primary并正常reject，随后原finally释放一次；正常seek/JOB/TERM-ignore必须主动回收成功，不能拿例外永久pending当验收。确实无权限/归属不明的分支诚实保持CLEANUP_REQUIRED并请求有风险的资源处置。

重入close/reconcile复用同一责任和promise。跨Node进程重启不恢复原内存promise为成功；旧原生工作树/owner诊断保全、不得凭持久PID数字kill或delete。父断管时worker自己的封出生/受控终止另做实证，不声称本票新增了业务恢复权威或第二数据库。

### A02：父请求、源流、probe有独立真实账本

060明确扩展`openfilm-upstream.ts`的folder/serving私有生命周期，不只复用原`folder.drain()`。

- 在调用固定pinned handler之前，为实际ServerResponse装`pipe`观测，登记真实upstream Readable/fs.ReadStream；记录源的close/error以及响应finish/close，目的响应close不等于源FD close。响应中止时destroy本响应真正拥有的源流，并等真实close；保留每条原始close/error对象，不全局patch fs。
- 源流/HTTP/probe原始任务在启动时先登记，完成才移除。固定frameDuration promise所用execFile回调须有明确源码/Node语义依据及真实child实证，证明回调覆盖child close/reap；若做不到则先审定窄的owned probe seam，不用HTTP close代替。错误后不得只等待一个已包装race的promise。
- 私有`drainAfterExecutionEnds(scope)`只接受当前真实production scope；先证明worker执行域已灭，再同步封该serving的新资源准入，然后等待已受理HTTP、source streams、parent probes全部真实结束。冻结后新请求有界拒绝，不能启动新file/probe。listener仍保持，直到已受理资源排空；内部不得递归调用serving.close造成accepted等待自身的死锁。
- 下一次已受理draw显式重新开启它的资源准入，owner.close永久封准入再排空。新建独立folder的既有只读HTTP行为保持；实际cache-production期间的冻结/重开由scope绑定，不要求客户端声明epoch/ticket。拒绝新请求不访问文件或创建probe。

必须实证：真实range源流在目的中止后FD仍曾存活并最终close；真实父frame-duration probe跨worker结束仍被等待并reap；在准入冻结边界注入新请求不新增资源。source-stream的真实close是退出门，不是响应状态码。

### A03：整个生产scope串行，不只worker画图串行

新增内部`cache-production-scope.ts`（建议精确名，最终列入release），由当前Host进程内唯一调度器维护跨服务/producer owner的root记录。物理root身份dev/ino是共享锁索引，canonical root是同时核验的路径事实；不同别名指向同一物理root不能得到两个锁。取得root必须来自已验证的真实workspace/production能力与held directory身份，不从URL/body伪造。

排队不创建PRE/POST闭包。取得scope后重新核对owner/base/control/ref/generation/真实root，再从原来的preexisting-output检查开始；scope一直持有到PRE capture、真实worker/父drain、POST capture、两个tree释放、最后同步identity/currentness门、witness激活或拒绝之后。所有正常throw/cancel只在真实资源settled后释放一次；CLEANUP_REQUIRED保持scope，不释放给下一生产。

workspace.#produce最外层负责取得scope及最终释放；内层桥/supervisor使用同一个私有issued scope，不递归申请同root锁。scope是模块私有对象身份/活跃状态，不是字符串、PID或JSON；可用内部ALS传递，但每次使用仍核对scope活跃/物理root/真实owner，晚到async上下文不能复活已释放scope。直接factory/bridge组件调用没有workspace外层scope时，须由同调度器建立其自有scope覆盖完整调用；不得出现绕开总容量的第二队列。

两个不同frame即使key不同，也会共享film-duration等输出，所以B不得在A的POST/最终激活前写同root。不同root可以实际并行，才用于peer生存实证。新scope记录有只读root状态；source reader的准入与其交付guard须在本root处于生产/清理未证时保持未确认，不能从同service其他已空闲root推导它已quiescent。新增这条窄读面需列入reader/workspace的060接线路径，generic production lease的assertCurrent不可因此自我失效；Expected真实源/审批算法不重写。

### A04：forced finalize使用可观测真值表，不声称独占因果

|观测顺序/结果|允许交付？|
|---|---|
|无完整候选、候选长度/摘要/seq/ticket错误、原native失败、取消/输出超限、FINALIZE前已观察到异常exit|否；按原primary失败并真实清理|
|完整有界候选已验证，parent单调记录FINALIZE_AFTER_OK（含候选digest/seq与当时真实身份），无已知上述错误；随后授权退出/TERM/KILL，child/group/父drain真实完成，最后源/witness门通过|可以；记录授权finalization与实际观察signal，不写“已证明只有parent导致SIGKILL”或伪造exit0|
|信号错误、身份/ownership未知、组或父资源未证结束|不能交付；进入A01 barrier，不释放资源|
|已记录finalize但最后发现源/view/rights/依赖漂移|不能交付/授权witness，保持原来源拒绝与清理证据|

FINALIZE_AFTER_OK必须先于请求终止，不能在看到close后倒填。没有从exit0/SIGKILL推导成功的路径。保存候选buffer不等于采用；所有late cancel在最终交付前仍有效。外部信号与parent决定之间的不可观测竞态不假装有唯一因果证明；如业务以后要求更强因果保证须另票，此处仅承诺上述可观测门与真实结束。

### A05：两级资源边界与有限排队

同一Host模块调度器最多2个完整活跃production scope（含PRE到最终witness，不只是两个Chrome），至多32个排队reservation、同物理root至多8个排队；队列等待上限30s，与READY30s/GO后60s/原JOB45s是不同原因。超额或排队超时在PRE/worker出生前明确拒绝；无需读取源字节或分配pipe。close/cancel在GO前移除自己的queue reservation，不启动Chrome；重复取消不重复归还容量。真实未知active scope仍占容量，不能被deadline清零。已有pool继续限制实际FD，不另造不相干计数器。

直接factory调用和workspace生产共享同一调度器；已持scope传到supervisor不二次占配额/递归锁。没有时间预算伪装为settled，排队32不是AI调用次数或付费预算限制。actual fixture必须证明两独立root可重叠、同root不会跨PRE/POST交叉、队列拒绝不泄露FD/child。

### 060需明确列入的最小文件增量与实证

现有：openfilm-upstream.ts（issued factory/bridge、父stream/admission/probe账本）、created-native-workspace.ts（完整scope持有、窄read-quiescence面）、created-native-source-reader.ts（读取准入/交付guard查询该私有状态）。不改源事务/EnginePort/公开DTO/固定上游/正式render。

拟新增：cache-process-supervisor.ts、openfilm-cache-worker.mjs、cache-worker-policy.mjs、cache-production-scope.ts（均src/adapters/openfilm/），cache-worker-integrity.json与精确生成/检查脚本；guard facade内聚worker/policy，若另立模块必须在release具名。不隐式import原render worker entrypoint运行其main。

测试新增必须同时覆盖A01无转移barrier及真实reconcile、A02 source-stream/probe/准入冻结、A03跨完整生产窗口的共享物理root锁、A04 outcome顺序竞态、A05队列/取消预算，以及原ADR的正常/seek/JOB/capture/late-launch/peer/flood/TERM-ignore/containment实证。所有当前仍NOT_RUN，文档复验通过前不发060实现授权。
