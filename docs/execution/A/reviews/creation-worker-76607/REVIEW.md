# 冻结创建链独立复核：PASS（限定范围）

输入为 MAIN `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` 的冻结提交 `76607c191db5505bcedc88113330fc4ce7e14537`。测试前后 HEAD 相同，git status --porcelain 均空。MAIN 在本轮暂停源码写入及测试；BRIDGE 仅只读审查 MAIN，独立执行授权命令，日志写自身目录。原 BRIDGE50f4源码未改。

结论：**本次冻结创建链 PASS**。此前 W-R1..W-R5 在本批范围内无剩余阻断；这不签完整 A04/A PASS，也不宣称 MCP 生产创建入口或原生 UI 已交付。

## 独立运行证据

授权命令：

```sh
corepack pnpm exec vitest run tests/agent-driven/integration/project-creation-host.test.ts tests/agent-driven/integration/host-close-lifecycle.test.ts --maxWorkers=1 --minWorkers=1
```

本次实际 exec session5314 terminal exit0，2 files、15/15，79.51s；创建14项及并发关闭1项。tests.cmd、tests.stdout.txt、tests.stderr.txt、tests.exit、input.json 保留原样。本次未运行 tsc、创建store36项、旧持久Job19项或其他全量；MAIN此前71/71和typecheck0只视作 MAIN 报告及可读日志，不能冒充本人重跑。SQLite experimental warning 原样保留，无测试失败。

## 先前发现复核

| 发现 | 冻结代码和本轮验证 | 结论 |
| --- | --- | --- |
| W-R1 cancel_requested 误判失租且无法启动收敛 | check先识别相同owner/attempt取消；fail在BEGIN中核lease/状态并原子落cancelled+aborted+command failed；本轮own-cancel、cancel-after-source真实kill及重开通过 | CLOSED（本链） |
| W-R2 过期回收覆盖新owner/attempt | 专用reclaimExpired在BEGIN内fresh读，WHERE含owner/attempt/原expiry/当前过期；service不再调用旧reclaimLease；本轮八kill恢复通过。跨owner admission负向为MAIN36项中的源码/日志证据，本人未重跑该case | SOURCE_ADDRESSED；本链恢复PASS |
| W-R3 generic reaper将专用cancel变attention | 仅真实pending bootstrap job被排除；worker自行回收running和orphan cancel；10ms真实Host reaper下过期cancel等待70ms，本轮断言cancelled、pending空、attention0、重开仍cancelled | CLOSED（本链） |
| W-R4 同时close提前关SQLite | 非async close直接返回同一#closePromise；唯一#close等worker退出及server.close后才关闭DB；本轮真实HTTP handler gate和两个close通过，返回404且两个Promise相同 | CLOSED |
| W-R5 mkdir后owner marker前kill | 明确失败而非接管未知目录符合允许恢复终态；after_project_directory真实kill本轮断言failed/bootstrap null/origin null/activeCommit无/transaction aborted；after_owner_claim恢复成功。目录保留依据publishEmptySource/fail没有删除该project，测试没有独立assert该目录存在，不能把它表述为目录保留断言已跑 | CLOSED为明确失败终态；保留内容源码核对 |

## 终态失效与写入边界

reserve在BEGIN内验证principal/intake owner/current head/trusted_ui确认及Q&A闭包，并保持原始POST accepted receipt。worker取得持久lease后在Coordinator队列里assertContinuation，失效Brief/确认/Q&A闭包不被旧reservation覆盖。commit在同一SQLite事务内核当前确认、owner/attempt/running/原lease期限、prepared journal、revision0和无现有active/binding；最后一条业务写之后再验schema/proof/fresh clock/原lease期限/当前确认，失效即整体回滚。对应lease/confirmation末尾失效用例源码已读；它们属于MAIN已跑的store组，本次授权两文件没有再次执行。

取消终态不能回退既有commit：fail仅接受reserved/staging、允许的未提交journal且无activeCommit；committed重放不重复推进revision。取消/永久失败保留诊断source，不创建origin/pointer；owner marker缺失不会接管陌生目录。正常源发布只清自身UUID staging；固定OpenFilm实际parse、双树bytes/proof及父目录fsync沿用ef9修正，源漂移本轮HTTP负向通过。

启动时专用bootstrap恢复在generic controlled journal之前运行；live其他owner/未解决重试依赖拒启动，不伪ready。create/job.read仍按authenticated principal和URL project核scope。关闭先停止worker调度并等待在途promise，再排空已接收HTTP handler和关DB，独立测试未再复现database is not open。

## evidence与冻结字节绑定

`docs/execution/A/project-creation-worker-evidence.json` 九source及六artifact，逐项比较 evidence sha256/bytes、`git show 76607c191db5505bcedc88113330fc4ce7e14537:path` 实际字节与工作树：**15/15一致，九source全部一致**。详细结果见 evidence-check.json。evidence中的base_commit63d9和capture_dirty:true是提交前捕获状态，本次核对证明其九份文件正是76607的冻结tree，不能把历史capture_dirty误读成当前脏工作树。

## 未关闭的集成门

当前CreationApplication缺生产instance/health/context/job.cancel等producer，MCP每次instance握手仍会不可用；这不是已通过的SDK创建链。取消测试通过内部PersistentJobStore请求，不证明HTTP job.cancel挂载。下一批必须用持久instance/generation/真实所有权及实际degraded能力，不能填测试ready。runtime生产factory启用、创建工程原生工作台加载/ack、可信UI写路径、真实影片/录音、双正式导出、全链T20及人工验收均未由本报告验证。

测试terminal后未见vitest或creation-crash-child残留，已向MAIN报告exit0并释放本次独占槽。后续源码变化必须另绑SHA；本文不自动覆盖下一批接线。
