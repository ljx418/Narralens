# 真实运行/MCP基础链独立冻结复核

**限定PASS：真实本机运行/MCP基础链的本次7项用例；不是A-COLD、IT-A01、IT-A02整包或A整体验收。**

冻结实现：`4eaa169d235e5f607feec8dd1e93701bc67815e3`。独立审查上下文a_media_independent_review未参与该实现或旧LauncherSupervisor实现。本轮获MAIN独占资源授权，在main-integration执行指定测试；未修改该工作树源码/Git，未运行浏览器、媒体、ffmpeg、全量测试或其他服务检查。开始/结束均精确相同HEAD且clean。

实际命令：

```text
corepack pnpm exec vitest run tests/agent-driven/integration/owned-runtime.test.ts --maxWorkers=1 --minWorkers=1
```

实际exec session：15585（启动chunk ed78c2）；终态退出0。单文件7/7通过，测试耗时67.381秒、整体72.52秒。stdout/stderr分开留存，tests.exit为0，completion.json记录结束HEAD/clean。不是仅阅读MAIN内部29测的结论；此7项为本审查者真实独立重跑。

## 输入与修复闭环

开始前独立重算owned-runtime-evidence.json的11源码及11产物bytes/SHA256，22/22一致；package.json、pnpm-lock.yaml及manifest另存摘要于input.json。manifest的capture_dirty=true保留原MAIN采集时历史事实，**不**代表本次冻结工作树dirty；本次冻结状态由独立git检查及精确文件摘要确认。

- RT-R1（FIFO阻塞）关闭：readPrivateJson现在O_RDONLY|O_NOFOLLOW|O_NONBLOCK打开，再fstat拒绝非regular；独立子进程带外deadline负测通过（374ms），未阻塞测试主线程。修前MAIN实际失败记录显示旧读被SIGKILL终结，本次未删除或覆盖它。
- RT-R2（ready前wrapper取消处理缺失）关闭：handler移至start之前，LocalRuntimePorts的interrupted标记阻止后续discover/launch/probe；已有child则只向当前spawn ChildProcess转发。真实观察到本次Host child且尚未listening后仅对wrapper发TERM的用例通过（2578ms），无该child继续存活。修前真实hidden Host失败日志仍保留。
- 当前spawn ChildProcess的信号边界：独立阅读MAIN保留的本机Node22.22.1内置onexit代码，确认exitCode/signalCode在emit exit及下一次JS信号逻辑前设置，handle会close并置null。没有强制PID重用实测，也没有将此机制扩展为从文件读任意PID再kill。真正CLI stop仍是同一认证snapshot→再次身份核对→pidfd/start tick发送TERM→确认原进程退出。

## 本次实际通过的范围

| 用例 | 结果 |
|---|---|
| 双独立冷启wrapper、真实flock复用同一Host、instance/generation、HTTP错误凭据、真实MCP SDK读写、TTL轮换、代次漂移拒绝、wrapper强杀后继承锁、停止/重启/Host强杀后代次推进 | PASS（40127ms；实际同一复合用例） |
| symlink祖先拒绝、私密root不放宽原权限 | PASS |
| 私密JSON名称、nofollow、大小、权限、metadata拒绝 | PASS |
| 无继承fd9锁的真实child拒绝启动 | PASS（4462ms） |
| 误删活锁路径拒绝第二Host，原实例真停后允许下一代次 | PASS（19822ms） |
| FIFO非阻塞拒绝 | PASS（374ms） |
| ready前仅wrapper TERM取消自有child | PASS（2578ms） |

实际Host Instance仍degraded、capabilities为空；host transport ready不代表视频制作就绪。MCP SDK的真实握手/Intake读写与凭据续用通过，不等于Codex/Claude/DSH全部真实driver CLI已验。代次漂移负向包含隔离metadata受控变更，不冒充两个真实Host同时交接测试。

## 保留限制

本次没有独立重跑tsc、旧16项Launcher或6项ScopedAuth：其R8日志/摘要仅为MAIN证据（3文件29项、tsc0）。500文件凭据scanner的日志/hash已核对，扫描范围不含docs/var等，其0命中不证明所有秘密不存在；本次没有另跑scanner。

没有专门执行长时间失联/HTTP卡死/停止超时的新增故障用例；源码仍按starting/unverified或STOP_OUTCOME_UNCONFIRMED处理，不凭超时写stopped。该源码判断不升级为未跑的故障矩阵PASS。Windows原生进程管理、共享/未知实例全部边界、工作台联动、完整Run/批准/原生编辑、60–180秒真人录音授权A片、正式Delivery/T20、全量回归/构建及A人工验收均未由本次证明。

前预审两项具体P2均有冻结源码+独立真实负测通过闭环，本限定范围未留已证实P0/P1/P2。大阶段仍保持未完成，不能用“限定PASS”调绿A-COLD/IT-A01/A02整包或整A。

证据：input.json、tests.cmd、tests.stdout.txt、tests.stderr.txt、tests.exit、completion.json及artifact-hashes.json。资源进程已终态，不继续占用测试预约。
