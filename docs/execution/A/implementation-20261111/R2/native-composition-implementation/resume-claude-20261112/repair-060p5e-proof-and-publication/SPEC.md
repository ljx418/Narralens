# R5E：四类根因一次收口，先封住纯测试系统调用边界

角色：你是原 ClaudeCode 实施者；MAIN Codex 做契约裁决、静态安全核对、独立复审与最终验收。沿用当前工作区，不创建替代工程、不改写已通过模块。当前 HEAD 只是历史冻结基线，未提交实现字节以 RELEASE.start_sha256 为准，禁止 reset/stash/checkout。

先读本目录 RELEASE.json、MAIN_COMBINED_ADJUDICATION.json、START_INPUT_BINDING.json，再读 release 指向的两份 FINDINGS 及各自 REVIEW。四类问题按根因合并，不是八个独立票。保持已经关闭的取消主因、晚到 N 回收、替代 PID 信号保护、无 root 不写 cwd、真实 reporting factory、bounded streams 等行为。

## A：先修纯测试边界，再请求 MAIN 核对
只允许改 release.stage_a 三份现有测试及指定自身报告。此时唯一可执行验证是经 recorder 的 tsc --noEmit；禁止执行任何单测、Python 被测程序或真实 pilot。

Node：process.kill 默认拒绝真实调用；单例需要的 signal 0 或非零行为全部显式脚本化。拒绝事件必须写入独立 ledger，并在每个测试结束时断言，防止被生产 catch 吞掉后假绿。守卫覆盖实际导入/调用路径，并在 pending fake 操作仍可能运行时持续有效。child_process 也不得落到真实 spawn/fork/exec。
Python：_FakeOs.__getattr__ 不得向真实 OS 回退 kill/killpg/fork/exec/wait/prctl 等危险入口；在被测效应前装全局拒绝守卫，测试使用显式注入实现。漏 mock 反例必须安全失败，不得真实探测固定 PID，也不得重跑历史 os.kill 泄漏实验。

写 guards-ready 到指定报告，列三份新 SHA、覆盖入口、deny ledger、pending 清理策略与安全漏 mock 反例设计；用 orchestration ask 向 MAIN 请求只读核对，然后结束当前 turn 等答复。没有 MAIN 对精确 SHA 的批准，禁止进入 B。无需询问人类。

## B：取得精确 guard 批准后，保持同一任务完成
只改 RELEASE 的八份 existing 文件，不新增源码。runtime 仅 release.stage_b 六种 recorder 命令；混合 lifecycle 测试文件可改不可执行。严禁真实 C/N、产品信号/fork/exec/prctl、Host/Chrome/媒体/网络/付费、Q2、全量门与 build。实际测试进程启动属于批准测试工具，但不得由被测业务调用真实进程接口。

1. ORIGINAL_GROUP_PROOF：原始 domain/group 的证据义务独立于当前 destructive signal authority。authority revoked 后仍必须确认原始 PGID 新鲜 raw probe 为 ESRCH；空 census/ECHILD/旧 epoch 消失不能替代。unknown 保持 held，后续仅 raw ESRCH 可使同一责任收敛；不得恢复 destructive authority 或向 replacement PID/group 发信号。新增实际 _settle_domain→KernelSettlementOperations、只 mock raw 边缘的反例：group_members=[] 而原始 group probe=EIO，确认真的探测原始 PGID、无破坏信号、仍 held，再给 ESRCH 才收敛。

2. REQUIRED_ARTIFACT_HASHES：必需 candidate/helper 名称、逐行 full SHA256、逐行 error 均须门控，不能只检查 top-level error。candidate/manifest 链接摘要必须在 final 判定前读取并验证；缺失/读取失败/坏摘要记录有界实际错误并失败。用默认真实临时文件系统依赖验证这些分支，不只注入 top-level error。

3. FINAL_PUBLICATION_AND_CONSUMERS：锁定内部协议 positive-pilot-publication-v2。正常有效联合发布 exit0；预期 fault 仅在有效 final 链下 exit1；普通业务失败即使 exit1 也不可判通过；参数/入口拒绝 exit2；任何 mandatory evidence/report/publication 不可靠 exit3，绝不作为 expected fault 接受。本协议仅内部 CLI，不改 Host API/public DTO/EnginePort。明确记录旧→新语义，历史捕获 exit 原样保留。

最终发布：同一个已拥有 evidence root 内独占临时文件，完整写入并成功 close 后 rename 发布 final。所有必需 callback/report 操作先完成；final 发布后不得新增必需写入。写前/完整序列化后抛错/close/rename 等不确定结果，返回 kind=failed、faultCasePassed=false、authoritative=false、exitCode=3；保留原始业务 Error/图像/cleanup 事实，不靠再次覆盖坏 final 来证明失败。落盘看似完整的绿 final 只有同时匹配实际 recorder exit、candidate/manifest full hash 才是联合权威，不能只看 final 内自声明。

同文件内 legacy normal 消费者必须使用上述联合判定：返回发布资格、实际序列化 final/manifest/candidate 字节和摘要、exit 协议共同成立后才可接受或删除证据。可在现有 tool 文件增加共享私有 validator，不新增文件或公共 API。测试保存实际序列化 bytes 或真实临时文件；禁止保存可变对象引用让后续错误数组变化悄悄改写“已发布”事实。至少覆盖发布前失败、完整写出后 EIO、逐行 hash 错、链接 hash 错、report EPIPE→3、legacy 消费者拒绝；正常0和预期 fault1仍成立。

4. 报告中附已经实际计算的 bounded receipt digest/accumulator 摘要，不伪造未保存 raw segments。保留 red-python-002 真实 syscall 事件的限制；事后 PID 不存在不能证明当时无影响。004 是 MAIN 精确停止卡住测试，不是自然超时/语义反例；005 缺 exit/result 仍 INCOMPLETE。所有失败原样保留。

## 验证、交还与停点
每条批准命令首跑即用 release.recorder，唯一 capture_prefix；执行期间源输入不可变。不要 timeout 包裹 recorder，不造 PID/exit，不覆盖日志。generate 仅可改 integrity JSON，之后重新完整捕获六条至同一最终源字节。用安全 mock 证明新增反例在旧逻辑失败，不能为证明红灯恢复真实 OS 泄漏。若发现更大范围缺口，用 ask 提供最小契约问题，不盲扩文件。

禁止 git add/commit/push/merge/reset/stash/checkout，保留 user AGENTS、protected7、Approved015、旧证据。新429立即停并上报，不重试、不改模型供应商、不由 Codex 自动接手。交还报告给出逐 finding→代码→测试→capture 映射、最终八文件 hash、protected 检查、实际退出码、失败/INCOMPLETE 索引及已知限制；只能声明内部自验证，不能自签独立审查或 N1/N2/V1。

B 完成后 worker_done 交还 MAIN，等独立安全复审；当前没有真实 N 执行许可。后续 R6/R7/R8、原17+ISO18、真实冻结审查及下一接线包重锚仍未完成，不以本票替代。
