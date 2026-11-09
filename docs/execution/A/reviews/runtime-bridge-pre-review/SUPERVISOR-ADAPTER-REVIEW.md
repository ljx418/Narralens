# LocalRuntimePorts 接入原 Supervisor：只读架构预审

输入：MAIN HEAD `76607c191db5505bcedc88113330fc4ce7e14537` 加未提交实际runtime；原supervisor/types/plan及当前runtime hash见 supervisor-adapter-input-hashes.json。此时所讨论LocalRuntimePorts适配尚未提供冻结实现，以下是接口匹配审查与具体实现约束，不是声称新缺陷已在某冻结实现中复现。本人未运行测试、未改MAIN。

结论：**用 LocalRuntimePorts 实现 InstanceDiscoveryPort / InstanceLaunchPort / InstanceProbePort，并实际由原 LauncherSupervisor.start/stop 调度，更符合已交付模块的接线设计。** 原模块注释明确所有进程I/O由MAIN注入、纯计划/并发/ownership由Supervisor负责。保留真实flock/private identity/pidfd/动态凭证即可，无需为接线修改public合同或复制纯模块规则。原纯Supervisor由本BRIDGE实现，因此这段是接线接口解释，不冒充对自身旧实现的独立外审。

## 必须保持的匹配条件

1. **discover到launch不能有锁空窗。** 返回running:null的authority必须是当前调用持有真实flock、已核旧state无live/unknown predecessor，且保留同一fd跨discover返回、Supervisor计划和launch。launch向Host继承该fd；异常/复用/未launch路径明确close。不能discover关fd后再launch重拿，或以state缺失/HTTP超时判断空root。
2. **Host持锁推进generation是唯一权威。** Supervisor从last_generation计划+1；launch必须等真实Host identity/probe，严格比较输入instance_id/generation与实际结果。失败拒绝，不能wrapper先写计划generation、运行后重写实例或用计划值冒充实际值。generation溢出/脏state依旧fail closed。discover的last_generation来自持久旧state，不能null时固定0。
3. **首次logical ID可由canonical root sha256派生，已有ID必须优先。** 派生应只在确实没有持久identity时使用，Host首次初始化接受并落盘同一值；已有实例或旧随机ID不能迁移重写。端口依然限定所配置单一root，校每次传入root/id，不能把launcher I/O暴露为任意路径入口。stop使用start outcome的真实instance_id，不能只用调用前假设的派生id。
4. **stop完成语义必须对齐。** 原Supervisor在launch.stop resolve后立即将tracked state及health标stopped。仅pidfd_send_signal成功不表示Host已关闭DB/退出；若适配照搬原stop_requested即resolve，Supervisor会虚报stopped。stop端口应有界等待捕获PID/start进程真正退出及实际停止，超时/身份unknown抛错，让Supervisor不写stopped；保持pidfd无kill fallback。若CLI只是请求停止，不能用Supervisor已停止结果替代真实完成。
5. **短命stop CLI不能意外启动。** Supervisor.stop只能停止tracked instance，fresh CLI需经discover/start建立事实；在stopmode下launch端口必须硬拒。空root/已停止/unknown实例应返回明确拒绝，不能启动后再停止。不能绕过shared ownership拒绝直接pidfd杀进程。
6. **API探测ready与整体health分开。** 原ProbePort只返回ready:boolean，Supervisor会把真结果统一写LauncherInstance.state=ready。实际Host Instance.health仍degraded，因为制作producer缺失。若直接发布Supervisor.instanceDescriptor，其自有registry只含成功API探测，可能错误升整体ready。应继续用实际Host Instance/health作为整体producer，或给同Supervisor registry注入真实degraded服务样本；不能将degraded偷映射probe.ready=false而报starting。实际健康源、CLI输出和测试都应保持degraded事实。
7. **foreign-held lock只允许真实探测/等待。** 即使同root已有wrapper，也不能将拿不到锁解释为shared可杀或自行launch。成功probe可返回已验证owned事实；未知/starting等不到应明确拒绝。如果等待中旧Host真实退出，仅在获得同一锁、并重新核旧state后返回null。请求新端口/vendor不能悄悄改现有Host的身份或配置。

## MAIN补充的unlink-lock guard

已读owned-runtime beginRuntime实际新增：持继承flock后，如果旧state非stopped，核旧PID/start；精确前任仍活则拒PREVIOUS_INSTANCE_STILL_ALIVE，无法确认则拒PREVIOUS_INSTANCE_LIVENESS_UNKNOWN。仅旧进程已消失/identity不同才推进generation。故误删路径产生新锁inode不再自动证明旧Host消失。新测试源码确有真实Host→unlink该测试root锁→重复start拒绝→原state/pid/generation不变→stop旧Host→重开generation2。当前session62219结果尚未由本人执行或独立核验；source guard已针对MAIN自审问题，不能只凭新inode可锁认定安全。

## 后续验证与门

适配后应保留现有真实冷并发、继承fd/杀wrapper、pidfd错误start、HTTP后身份漂移、8sTTL同MCP跨9s、unlink-lock和受控停止重开用例；明确这些调用经过实际Supervisor注入端口。再补空root stop不launch、stop超时不标stopped、实际degraded不升ready的针对性对照。以上是下一实现的实证建议，不授权本BRIDGE开测试抢占MAIN资源。

本架构预审不签A01/A，也不改变已冻结76607创建链限定PASS范围。下一冻结实现须独立绑定真实hash及运行结果。
