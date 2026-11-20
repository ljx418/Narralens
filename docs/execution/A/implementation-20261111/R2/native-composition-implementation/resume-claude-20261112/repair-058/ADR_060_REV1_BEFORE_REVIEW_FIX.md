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

拟新增：src/adapters/openfilm/cache-process-supervisor.ts、openfilm-cache-worker.mjs、cache-worker-policy.mjs及专用integrity清单；协议可内聚到上述文件，确需额外模块先列精确名。现有主要接线仅openfilm-upstream.ts factory/bridge和必要的父folder-drain私有接口；workspace原则上await完整桥promise，不重写原源/事务/Expected逻辑。若真正cleanup-unknown路径需要显式PRE quarantine移交，先设计其owner与返回语义，不靠无条件finally释放。

拟测试：tests/agent-driven/integration/cache-process-settlement.test.ts；worker协议/进程故障helper与实际containment证据脚本精确名单待ReleaseAssignment。原Q02/Q03/K05、reader、Expected、正式renderer回归均保留。不得在059文件释放中偷开始这些架构改动。

## 必须实证的退出条件

真实正常两帧+poster；真实seek15s与JOB45s；capture30s真实资源+明确transport barrier或等价可核实路径（不冒充自然卡顿）；late launch/newPage交付barrier；并行peer存活并成功；父close/cancel/断管；真输出/协议洪水；TERM-ignore→KILL真实回收；EPERM/leader提前退出/未知归属不伪settled；新worker与当前policy字节下Chrome组继承/整组退出，包括Z和已知后代。原生错误与cleanup对象都保留。

旧r3 containment证据policy hash不同于当前057，不可代替新实测。默认fullcheck的旧REAL_TOOLS skip仍NOT_RUN；新A04必要重活必须显式独占授权并执行，不能因为不进默认check就叫可选且最终跳过。所有新runtime目前NOT_RUN。

全部修复、受影响回归及全量真实门稳定后，由MAIN冻结新SHA并独立复审；本ADR不是N1N2 PASS，也不准入下一接线/S01/NativeAck/Studio/A片/V1。
