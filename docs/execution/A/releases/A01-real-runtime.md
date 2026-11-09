# A01真实实例接线 ReleaseAssignment

前置冻结：76607c191db5505bcedc88113330fc4ce7e14537（创建链独立限定PASS，非A整体）。合同沿用cp-a0已批准hash，不修改其注册表/DTO/SQL/历史Gate。

目标：真正的独占运行根、持久instance_id及单调generation、真实Host子进程启动/重复启动复用、鉴权实例探测和安全退出；接上MCP的真实握手。仅为本机WSL/Linux启动入口，不取代旧启动器，不宣称Windows原生进程管理已验。

MAIN是唯一写入者，目录main-integration。允许新增src/host/agent-driven/owned-runtime.ts、start-runtime.ts，src/launcher本机I/O端口，tools/start-agent-runtime.sh与状态工具、对应tests/integration；修改MAIN独占CreationApplication注入实际instance/health生产者。旧工作台/Host保留，公共合同字节不变。BRIDGE本轮为只读审查，无Claude写入。

锁：使用本机flock，启动进程继承锁描述符覆盖完整生命周期；不以PID文件当锁，不因探测超时删除锁/杀未知进程。重复启动只复用可验证实例或明确starting/unknown，不再拉起第二Host。身份/generation/私密连接信息仅运行根，严格文件权限、原子fsync；token不打印、不进Git，不经MCP返回。所有HTTP仅literal loopback、禁重定向。

验证：独立临时运行根、真实进程/实际HTTP认证和MCP SDK；冷启动/重复启动/关服重开/强杀后代次推进/错误凭据与漂移；生产尚未装配的clip/render/QC/delivery仍blocked，health显示degraded而非ready。每worktree资源预约，单worker静音无浏览器/ffmpeg，无J盘、外传或付费。

回退：停止本启动器自有实例并切回旧入口，保留运行根/DB/身份/日志；不删除工程、不降级DB、不reset。阶段仍A，下一整轮人验为A-EXIT。

实现前细化补充（不改变公开合同）：MAIN本批还允许新增src/host/agent-driven/runtime-probe.ts、src/launcher/local-runtime-ports.ts、tools/agent-signal-owned.py、tools/agent-mcp.ts，修改MAIN的ScopedAgentAuth过期cache回收。真实I/O必须注入既有LauncherSupervisor三端口，不复制旧planner；逻辑id首次由canonical root域分离摘要生成，此后只读持久id；generation仍只由持锁Host推进。stop端口等待精确旧进程退出才返回完成。公开整体health仍取实际Host，不用Supervisor仅transport的descriptor冒充全链就绪。旧stdio入口及旧Host start.ts保持兼容。
