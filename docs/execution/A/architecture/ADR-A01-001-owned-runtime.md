# A01真实运行根、服务发现与MCP接线

状态：本批内部实证候选；冻结独立审查待完成。不是A-COLD、IT-A01/02整包或A轮通过。

## 代码实体及唯一权威

- tools/start-agent-runtime.sh → tools/agent-runtime.ts → 既有LauncherSupervisor；不新造第二个planner。
- LocalRuntimePorts实现InstanceDiscoveryPort/InstanceLaunchPort/InstanceProbePort。discover到launch之间持续持同一内核flock；Host继承fd9。父包装进程退出不释放子Host仍持有的锁。
- owned-runtime.ts负责私密目录、普通文件、nofollow/nonblock、有界JSON、fsync和持久身份。identity/generation只由继承锁的Host推进；launcher只核计划generation与真实probe，不补写或回退计数。新根初始id为canonical root的域分离摘要，已有id不变。
- start-runtime.ts装配同一个NarralensHost和CreationApplication。全部DB/源/快照/派生目录均在隔离运行根，不指向canonical可写根。
- runtime-probe.ts认证同一state/connection/instance快照，HTTP后与停止前检查身份。管理停止通过agent-signal-owned.py的pidfd和真实starttime，不向后读到的新PID发信号，不fallback到任意os.kill。
- wrapper取消只转发当前spawn ChildProcess，且在start前安装处理；pending取消不得拉起新Host。Node22.22.1内置onexit源码证据保留，非强制PID重用实测。
- 私密connection在到期前真实轮换，旧token到自然到期，ScopedAgentAuth签发时清理过期cache。tools/agent-mcp.ts复用同一MCP facade，每请求读取轮换凭据并固定原实例代次；换代要求重新连接。旧stdio入口保留。

## 服务状态与边界

真实/API transport ready与业务整体ready分离。CLI仅在Supervisor完成实际API probe后发布listening；Instance/health采用Host实际状态。当前缺完整Run/render/Delivery生产装配，故整体degraded，capabilities为空，不返回测试ready。health每5秒采样、15秒TTL，未提供CPU/GPU数据不编造数值。

锁路径误删时，若旧记录的PID+start仍存活，拒绝以新inode的锁覆盖身份或再启动Host。私密JSON为FIFO时，以O_NONBLOCK打开并立即拒绝非普通文件；不能在类型判断前卡死入口。

停止完成须精确旧进程已退出；观察超时不等于已停止。启动观察超时保留继承锁的Host，不当作允许再拉起第二进程的证据。未知/共享服务不通过猜PID接管或终止。

## 真实证据

- R4：11文件133项通过，覆盖原MCP façade/Host/创建链；早于最后ports/FIFO/cancel修订，不能声称是最终版本整轮结果。
- R5：锁路径unlink真实负向修后11项通过。修前捕获明确出现第二Host，原日志保留。
- R6：27项通过，但MAIN另行源码审视发现接口方法参数被错误收窄（TS方法双变未拒绝），实际Supervisor只传两个字段；R7已改准确签名，并要求CLI核transport ready，防止将自测总数当接口成立。
- R7：类型检查0，27项通过，含8秒真实TTL跨9秒的同一MCP连接续用、真实HTTP后换代负向及pidfd错start拒绝。换代负向通过暂改隔离state文件模拟，未冒充两个真实Host交接。
- FIFO与pre-ready wrapper TERM旧实现两个负向均真实失败，外层SIGKILL结束阻塞读；两份原错误和修复前日志不覆盖。
- R8：类型检查0，3文件29项通过（7个真实runtime/文件边界+16原launcher+6鉴权）。凭据扫描500文件0命中；不代表不存在所有类型秘密。

## 尚未满足的大阶段目标

A-COLD仍有实际工作台/UI分离与共享服务等整链出门内容；真实Codex/Claude/DSH客户端探针未全部执行。原生created工程工作台、完整Run/审批/选镜、真实60–180秒授权影片与中文录音、正式Delivery/T20、全量回归/构建及中文HTML总报告尚未完成。本批测试不代签这些条目，不进入B。
