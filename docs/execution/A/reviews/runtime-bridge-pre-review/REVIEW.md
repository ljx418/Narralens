# 实际 owned runtime 只读预审

结论：**NEEDS_WORK（未冻结预审）**。当前有两个具体问题，均已发 MAIN。本报告不签 A01/A；没有执行测试、启动 runtime、占资源或修改 MAIN。parent 的 session93799 测试不视作本人执行。

读取实际目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `76607c191db5505bcedc88113330fc4ce7e14537` 加未提交实际runtime文件。两次读取六份源码/测试hash一致；精确输入见 input-hashes.json。MAIN 后续修订必须重新绑定字节。

## R-R1：stop把另一代状态与旧代认证探测混合（P1）

tools/agent-runtime.ts L31 是 `instance=await probe(root),state=readRuntimeState(root)`。probe只返回已认证的Instance，随后读取的state没有与它重新核 instance_id/generation/origin。L35的processStart只证明第二份state所列PID确实仍是该starttime，并未证明它是刚探测的实例。

可控调度复现方案（本人未执行）：旧generation1的HTTP instance认证成功后暂停stop，令旧Host退出、新generation2启动并持久写state/connection，再恢复stop。第二次read取到generation2；其processStart与自己的state一致，因而向新Host发SIGTERM，输出却仍称generation1 stop_requested。status/reuse也可将旧instance与新pid/origin混合输出。

应使probe返回认证时使用的connection/state/instance身份快照，并在发信号前读取当前文件确认instance/generation/origin/pid/starttime全部未改变；变化即拒绝，而不是追随最新PID。应有旧探测/新代次负向与无变化成功对照。最终processStart与kill之间仍是传统PID接口的窄窗口；不要把单次/proc检查宣称为pidfd级原子停止保证。

## R-R2：24小时后实例持锁但全部管理凭证失效（P2）

start-runtime.ts L39只签发一次24h token并写固定expires_at。其后没有轮换、刷新或到期停服。readRuntimeConnection明确拒绝过期，ScopedAgentAuth同样拒绝。因此24h后Host仍持flock并监听，status/stop/MCP无法认证，重复start只能等15s再拒INSTANCE_STARTING_OR_UNVERIFIED。原wrapper尚在时可手动signal，但已有wrapper被杀后保留Host这一合法场景不再能用本管理工具受控退出。

应提供真实私密凭证轮换并原子更新connection，适度有界重叠及撤销旧凭证；或明确有限runtime寿命且在到期前受控关闭，不把过期token当永久凭证。应以可控时钟/短TTL的真实管理对照验证，不能只改本地expires_at而让真实auth仍过期。本项是实际时序源码推导，未等待24h或运行测试。

## 已核到的正确边界与限制

运行根拒非Linux/WSL、symlink alias、其他uid、组/其他权限；state/connection读前核private regular file并限大小，写入使用独占0600临时文件、实际fsync后rename及父目录fsync。锁用O_NOFOLLOW打开并比对inode/dev，调用真实flock；同一open file description fd9继承给Host，wrapper死亡不会主动释放子Host仍持有的副本。child先核继承fd匹配运行根锁文件并取锁，启动代次在同锁内持久推进；不会因HTTP timeout删除锁或杀未知进程。没有PID文件充当锁或遍历他项目的逻辑。

HTTP probe限定literal127.0.0.1 origin，redirect:error，5s timeout，固定Origin+私密Bearer；instance DTO/schema及id/generation必须符合私密connection。token只写私密connection，不进入stdout或MCP Instance，status/reuse输出不含secret。shell入口umask077并用既有本地锁依赖，没有网络install或任意MCP shell/path入口。

真实instance/health producer由CreationApplication注入。instance顶层始终degraded、capabilities为空；host ready只在listen成功后采样；OpenFilm ready依赖真实pinned composition，video-production明确degraded且缺run/render/delivery producer。没有把空draft创建或仅HTTP监听冒充整条制作ready。registry仍按5秒采样/15秒stale合同产生health，缺producer仍由dispatcher拒绝。真实trusted UI创建确认、context、job.cancel、原生工程UI/ack、完整影片/双导出和阶段人验仍不在这批交付范围。

现测试源码确有两个冷启动wrapper、kill wrapper保留子锁、stop/reopen generation递增、Host强杀、旧token拒绝及真实SDKstdio握手+intake写读；它们是有意义的真实进程设计，但未覆盖上述probe→state换代或24h寿命窗口。只有MAIN实际terminal结果及下一冻结SHA独立重跑才能形成相应运行证据，本预审不据测试源码写PASS。


## R-R1/R-R2 修正只读复核（未冻结，R3）

MAIN 仍为HEAD76607加未提交实际runtime源码。本次新字节见 r3-input-hashes.json；旧发现及旧hash保留，不用后续修正覆盖初始记录。本人未跑测试、未启动runtime、未修改MAIN。MAIN session17525正在执行真实进程测试，本文不预判其结果。

**当前源码结论：R-R1/R-R2 均 SOURCE_ADDRESSED，暂未发现新的具体阻断；冻结独立验证 PENDING。** 本段不把未提交代码或正在运行的测试写为A01/A PASS。

R-R1：新runtime-probe捕获同一state/connection/instance，初始先核instance_id/generation/origin；真实HTTP返回后assertRuntimeSnapshot重读state核instance/generation/pid/start/origin/listening并核OS start。stopProbedRuntime在发signal前再次重验这份捕获快照，始终传捕获的PID/start，不追随新generation。status/reuse输出同一快照，不再混用await之后另读的最新state。Linux helper用python3 -I启动；先pidfd_open目标，随后核/proc start及非Z，再pidfd_send_signal(SIGTERM)，不支持pidfd或start不匹配即失败，没有os.kill fallback。因此即便在最后一次TS校验之后旧process退出/PID复用，helper也不会向不同start的新进程发信号；pidfd已打开后旧进程退出则只能失败或指向旧内核进程，不会追随复用PID。

R-R2：start-runtime实际签发token并以private atomic connection发布，每TTL/4（最多5秒）观察剩余寿命，在余量<=TTL/4时轮换。rotating共享Promise避免并发发布，旧token保持自然到期；ScopedAgentAuth.issue清除已过期及revoked cache，仍生效的前任token不被提早撤销。在write失败时撤销新token并标credentials degraded，正常采样也根据实际失败/过期状态；shutdown停止rotator并等待在途轮换，之后关Host和写stopped。没有把本地expires_at延长冒充真实auth续期。

新agent-mcp沿用原HostApplicationPorts和同一SDK facade，headers provider每次读取私密root当前token；仍绑定初始instance_id/generation/origin，替换实例时拒绝并要求重连，不将原MCP会话静默切到新Host。旧NARRALENS_HOST_URL/TOKEN入口未改，若用户仍用静态环境token，其自然到期是入口使用边界；新增root入口才提供动态轮换。

重复start等待期间若probe失败，会尝试获取原fd上的同一真实flock，只有真正获得锁才启动；对仍持锁但未知/starting Host依旧等到deadline后拒绝，不靠超时判断杀进程或删锁。

新增测试源码核到：真实HTTP响应后改generation应拒INSTANCE_CHANGED_DURING_PROBE；错误process_start传pidfd helper应status3且Host仍活；8秒auth TTL下同一真实SDKstdio连接等待9秒后使用轮换token继续intake.read。它们分别针对先前缺陷，不能仅凭源码认为已经通过。该测试把state暂时改generation后恢复，并非真实跨进程换代实测；核心防护的覆盖范围应如实描述。现有冷启动并发、wrapper kill保留fd、真实Host强杀/reopen测试仍保留。

剩余门：下一冻结SHA的独立测试/证据hash绑定；实际host健康仍degraded、production能力为空，不等于影片制作ready。真实UI确认/context/cancel/native ack、完整影片/导出与A人验仍未由该runtime批次证明。
