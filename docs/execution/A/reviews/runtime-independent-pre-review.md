# A01 真实运行时独立只读预审

日期：2026-11-10；独立审查上下文a_media_independent_review。未参与本批实现或旧LauncherSupervisor实现。审查根：Narralens-agents/main-integration；前置HEAD `76607c191db5505bcedc88113330fc4ce7e14537`，本批尚未提交，以文末文件SHA256绑定。本报告为**预审NEEDS_WORK / 最终冻结复核待执行**，不签A01整体验收或A整体。

已读A01-real-runtime.md ReleaseAssignment、本轮owned-runtime/runtime-probe/start-runtime/local-runtime-ports、CLI/MCP/Python/shell入口、CreationApplication/ScopedAuth差异、旧Supervisor/plan及真实integration测试源码。只读命令与文件摘要；没有运行测试、Host、MCP、浏览器、媒体、服务或停止任何进程。只写本报告。MAIN仍唯一writer。

## 具体发现

### RT-R1 · P2 · 私密JSON的FIFO会在校验前同步阻塞

`src/host/agent-driven/owned-runtime.ts:60-66`先openSync(O_RDONLY|O_NOFOLLOW)，再fstat拒绝非regular。前置：自己的私密运行根内instance.json、connection.json或cursor-key.json被错误工具/损坏状态替换成FIFO，且没有writer。O_RDONLY打开FIFO会先等待writer；fstat尚不可达。由此start/status/stop/MCP discovery可能同步卡住Node线程，外层Date.now deadline、AbortSignal HTTP timeout都无法解开这次open。700目录减少跨用户恶意替换面，但不使非普通文件处理正确。

静态代码足以定位，**未执行复现**。建议用O_NONBLOCK打开并立即fstat拒绝非普通文件，保留O_NOFOLLOW/UID/权限/65536上界。复现/回归必须在独立子进程内放FIFO，外层带deadline和自有进程清理，不能在vitest主线程调用旧代码。MAIN已接受该项并计划修复；本节读取的旧字节尚未包含修复。

### RT-R2 · P2 · 启动观察期尚未安装wrapper取消处理

`tools/agent-runtime.ts:25-37`await supervisor.start/launch和认证probe完毕后才安装SIGTERM/SIGINT处理。`src/launcher/local-runtime-ports.ts:48-63`在此期间已经启动Host，Host继承fd9锁，观察可达25秒或更久（单次HTTP探测有独立5秒）。前置：Host已spawn但尚未确认ready，仅对wrapper PID发SIGTERM/SIGINT。wrapper默认退出，而自有Host可继续启动；同样的信号在ready之后则会被转发。取消行为依赖观察时点，操作者收不到就绪输出但服务可能已启动。

这**不**等于锁丢失/第二Host或数据库半停：继承锁依然阻止双启，后续可以重新探测。本项针对wrapper显式取消的前后不一致，不把普通窗口detach一概当作stop。MAIN已主动发现并计划前置信号处理+pending取消标记。建议真实单独wrapper信号case覆盖spawn前、Host启动中、认证probe前后，最终停止或明确unknown，不凭超时写stopped。本次未运行。

## 停止安全的已验证源码边界与未证实疑虑

普通stop命令：LocalRuntimePorts.stop先取得完整认证RuntimeProbe，核对instance/generation/pid；stopProbedRuntime再assertRuntimeSnapshot，将**同一snapshot**的PID/start tick传给Python。Python先pidfd_open，再核对/proc start tick与非Z，最后pidfd_send_signal(SIGTERM)，无任意PID os.kill fallback。pidfd不可用/状态漂移均拒绝，不假装成功；等待10秒无法确认时STOP_OUTCOME_UNCONFIRMED，不能改写stopped。此路径源码设计合理，真实故障/超时还需定向实证。

ready之后wrapper的forwardSignal(:84)用当前spawn保存的ChildProcess.kill，区别于读取任意PID再kill。最初提出其绕开pidfd作为疑虑；MAIN指出Node回收/事件串行语义及exitCode/signalCode先置位。**当前没有误杀复现证据，不把假想PID重用列为已证实P2或阻断项。** 待MAIN提供本机Node onexit/uv证据后补充安全边界：只允许本次当前child，不能扩展为从文件读取PID的通用停止路径。启动期取消修复仍须单独核对。

## 主要正向结论（源码层面，非独立运行PASS）

- fd9：openRuntimeLock使用O_NOFOLLOW并对fd和路径比对dev/inode；flock --nonblock子进程继承同一open-file-description，锁由wrapper持有并在spawn Host时映射到fd9。Host beginRuntime再次比对fd9与私密lock inode并验证锁。不是PID文件当锁。旧lock被unlink重建时仍检查原PID/start tick活性，拒绝活前任接管。
- 身份：instance_id按root稳定且持久；generation在持锁状态先原子fsync写starting，真实崩溃可跳号但不能回退；新进程绑定/proc start tick，成功后才写listening与origin。probe校验Instance DTO及instance/generation，HTTP前后读取snapshot并验证PID start tick和origin，防止探测途中代次漂移。
- root/文件：只限Linux/WSL，拒绝symlink ancestor/root与宽权限/不同UID；JSON读no-follow且有限大小、精确metadata key；写600临时wx→fsync→rename→root fsync。FIFO问题另列，不能因其余校验存在而忽略。token只存在私密connection.json及内存，不打印到状态、MCP结果或Git。
- TTL：按实际期限发凭据，轮换在剩余四分之一窗口进行；新的私密connection写失败则撤销新token并降credential health，旧token仅自然过期保留在有效窗口。ScopedAuth清理过期/revoked记录。MCP每次请求重新读取凭据，并绑定初始instance/generation/origin；变代次要求重连而非自动向新实例写入。
- 健康：真实Host Instance DTO固定degraded（制作producer未登记），health.read区分host transport ready和video-production degraded；status/start输出取authenticated Host Instance。clip/render/QC/delivery没有被冒充可用。
- 超时：发现/launch探测失败只报starting/unverified，不删锁、不杀未知PID、不写stopped；launch观察超时只unref已spawn child，其继承fd9保留。停止只有实际存活检查收敛后才向CLI报host.stopped。

LocalRuntimePorts.probe的ready=true是API transport；旧Supervisor.instanceDescriptor会对自己的transport inventory roll-up成ready。当前CLI没有调用该descriptor，而显式读取authenticatedInstance.health，因此当前外部输出没有由此错误升ready。此处是集成限制：后续调用者不得把transport descriptor替代真实Host整体健康，不以此构造当前未发生的产品P1。

## 证据与后续门

只读R7日志已出现3文件27/27摘要、typecheck.exit=0；其中5个owned-runtime实测覆盖双独立wrapper冷启复用、真实HTTP/MCP、TTL轮换、关服重启与强杀代次、未继承锁拒绝、unlink活锁拒绝、路径/JSON保护。阅读MAIN日志不等于审查者独立重跑；FIFO、启动期取消、探测超时等额外负向仍未在本次独立执行。最终需冻结修复fullSHA后重新绑定source/log摘要，再按MAIN授权单worker独立运行；不提前签已验。

cursor-key.json目前只创建/保留，本轮CreationApplication尚未装配events/context cursor生产者；不据存在该文件宣称持久cursor端到端通过。A01范围仅本机真实运行入口，不能代替Windows原生管理、生产全流程、T20或A人工验收。

## 读取字节摘要

| 文件 | SHA256 |
|---|---|
| `docs/execution/A/releases/A01-real-runtime.md` | `b77b8b5dc725ad66b9e65d72260604303cc798a8b413dde91023a482b0dd061b` |
| `src/host/agent-driven/owned-runtime.ts` | `91e475610b36ec1497339700abc38bc89aa825facd2274013e2063563c6f1521` |
| `src/host/agent-driven/runtime-probe.ts` | `7d2923d7a61cadd0d7787cf05ac6280a22133531dd7da1285c614ac7e88560e9` |
| `src/host/agent-driven/start-runtime.ts` | `550ef293c318dc93a9d3c60bc4bed847e97fba07e827398ad09a055f6df520db` |
| `src/launcher/local-runtime-ports.ts` | `af7d27f69e3cc3d36b41acc29f6b812cb7beb8cb395fc2ead38a0a40a886dec3` |
| `tools/agent-runtime.ts` | `825b32af8d89e2efea23df469c791a02ac0341f55d0a087f5f1d05c228e10e03` |
| `tools/agent-mcp.ts` | `520f6859ba30d554c139085216eaeb84328f1c67931926205eafdf1add834c00` |
| `tools/agent-signal-owned.py` | `b769b1c9bab2b955c72a19dbd97ea180737b6d0411fd9c3253fe549e1d78a2b3` |
| `tools/start-agent-runtime.sh` | `840a9e2b94fd6ce08720a1605d10d141f9e7d84b8d698d561c7921426fd5cc31` |
| `src/host/agent-driven/creation-application.ts` | `eb2c3f79719ffa0553f15cd3b45fdb72d1ed3bf186136722c3ea838842655e43` |
| `src/host/agent-driven/scoped-auth.ts` | `5594bf4a0fad00079e80df4abc714cba746bb427644489a890685d22a497a32e` |
| `tests/agent-driven/integration/owned-runtime.test.ts` | `b151dd963215d0703b93b967bacd288affe207343d9110507d151b39267a3ff1` |
| `docs/execution/A/logs/main-owned-runtime-r7/typecheck.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `docs/execution/A/logs/main-owned-runtime-r7/tests.txt` | `1a9a5a6496aac7ffde3e2355f46aaa1e3fede7d0578fd9cbc27a47353e80f89c` |
| `docs/execution/A/logs/main-owned-runtime-r7/tests.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
