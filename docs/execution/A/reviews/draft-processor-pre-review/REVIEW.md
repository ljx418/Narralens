# CreatedDraftTaskProcessor independent static pre-review

结论：**NOT PASS — BLOCKER 0 / MAJOR 2 / MINOR 0**。

输入绑定见 `input-hashes.json`。本 reviewer 仅做静态审查，没有运行测试、typecheck、构建、Git 索引或重型命令。
MAIN 报告的 session 21727 / 76493 不冒充本次独立执行证据。显式 verifier 正在另行实现，生产路由/Run
可用性、完整 delivery/整片 A 均不属于本轮 finding，也未被本报告签署。

## MAJOR-01：真实 Run guard 与 source preparation 之间存在可撤销授权的长异步窗口

位置：`src/host/agent-driven/created-draft-processor.ts:105-129`。

`withRunningTask()` 在第 107-116 行核 `gate.assertWorker()`，随后事务结束；processor 再异步执行 author source
全闭包摘要、素材 resolve/probe、可能的 test boundary，之后才在第 125-128 行创建 stage、复制素材并运行 assembler。
这些步骤可以明显长于 grant 剩余时间，也允许另一条可信路径撤销 grant、改变 Run gate 或 creative closure。
第 117 行之后到第一次 stage 写入之前没有重新执行 actual durable Run guard；`#checkAbort()` 只看 worker signal/close，
不读取 grant/Run/commit。

因此“开始任务时曾获准”可被错误当成“source preparation 写入时仍获准”。稍后的 `recordPrepared()` 和
`finishPrepared()` 确实各自通过 `assertPrepared → gate.assertWorker` 拒绝发布，但这只能阻止登记/完成，不能撤销已经
发生的 stage 文件写入和本地处理资源消耗。共用 execution guard 的约束正是每个实际 side-effect 边界前重读当前事实，
不能由事后发布门替代。

建议在 author/assets 解析完成后、`before_prepare` boundary 返回后、调用 `#stage/#assembler.prepare` 之前，使用
`withRunningTask()` 做一次只读的 `gate.assertWorker()`（不要再次推进 checkpoint）。至少增加旧码会失败的回归：
resolve/probe 被阻塞期间撤销 grant，恢复后不得创建 `stage_token/attempt/source` 或任何 prepared fact；grant 到期、
Run gate/creative closure 漂移同理。

## MAJOR-02：lease 尝试耗尽或取消-reaper 竞态只推进原 job，workflow attempt 永久留在 running

位置：

- `src/host/agent-driven/created-draft-processor.ts:138-140`
- `src/host/agent-driven/created-task-store.ts:238-249`
- 通用回收语义：`src/host/persistent-job-store.ts:153-175`

processor 起步时已用同一数据库把 `cp_a0_step_attempt` 推进为 `running`。正常成功/失败/取消时，新增的
`finishPrepared/finishFailed` 能把 workflow step/checkpoint/event 与原 job 终态放在一个事务中，这部分成立。

但 lost lease 后 `finishFailed()` 只有在原 job 仍由同 owner/attempt 且处于 `running/cancel_requested` 时才能写；
通用 reaper 若已将 job 重排，返回 `false` 是正确的，因为旧 worker不能写新 attempt。下一 job lease 成功时会继续
同一 workflow attempt，尚可收敛。问题出在 max attempts 耗尽：通用 reaper 把原 job 置 `attention`（取消 lease
过期也走 attention），此后没有新 lease/processor 会再次进入 `withRunningTask()`，而旧 processor 的
`finishFailed()` 只返回 false。结果是 job=attention、workflow attempt/checkpoint=running 的永久分裂；固定执行门仍把
该 step 当作当前运行尝试，新的 task reserve 也会被当前 attempt 阻断。

这不是要求另建状态机，而是要求原 job 与 CP 终态仍由同一数据库权威原子推进。生产注册前需要专用 recovery：
将 created-task jobs 排除于 generic reaper，并在同一事务中完成 requeue 或（耗尽/取消）同步推进 workflow
attempt/checkpoint/event 与 job；或为 generic recovery 提供等价的同事务 hook。不能先让 generic reaper 独立写
attention，再靠失去 lease 的旧 processor 补 CP。

应新增旧码会红的真实 SQLite 回归：max_attempts=1 的 running lease 失效后恢复，最终 job 非运行且 CP attempt
也非 running；cancel_requested 在 processor cleanup 之前过期时同样不允许 job attention / CP running 分裂；
进程重开后重复 recovery 幂等且不重复事件。

## 已确认成立的边界

- `finishPrepared()` 在原 SQLite 事务内重新核 live lease、opaque proof、当前 Run、author bytes、rights，再同步推进
  step/checkpoint/event、原 job callback 与 job event；任一点异常整笔回滚。它不写 author source、snapshot 或 project revision。
- `finishFailed()` 对正常 live failure 和自有 `cancel_requested` 使用原 owner/attempt CAS；settle callback 或 callback CAS
  失败会回滚 CP 写入，没有先写 CP 后丢 job 的半提交。
- prepared fact 是不可变 source-only 事实，不是 approval/commit；进程重开可按记录的 lease attempt 定位旧 stage，
  但仍要求新的 lease、当前 author/assets/rights 和新 opaque proof。
- author/source 与素材读取均重新核 canonical path、regular file、inode/fingerprint/hash；stage token/attempt 只映射到
  私有 runtime root。assembler 使用 fd-relative、NOFOLLOW/EXCL、私有权限与 protected roots；本 processor 未发现
  author/snapshot 写入路径。
- script/storyboard 来自请求冻结的不可变 artifact refs；brief 来自当前 intake head，且前置 gate 重算 creative closure。
  storyboard/narration 素材必须属于 brief 策略，registry fact 与 blob bytes 在 prepared/finish 边界再次核验。

显式 `PreparedDraftProofPort` 仍必须独立证明 stage 完整闭包、固定 OpenFilm 解析、rights/plan/source digests 以及
stage/metadata/祖先目录的真实 durability；它尚未提供，因此本报告既不把它缺席重复记为第三项 finding，也不假定
其已经关闭上述证明门。

---

## Closure review — 2026-11-10

最新源码与所读回归绑定见 `closure-input-hashes.json`。本节追加原始 NOT PASS，不覆盖历史 finding。

结论：**PASS — BLOCKER 0 / MAJOR 0 / MINOR 0**（仅 M1/M2 与 draft processor/store/worker seam）。

### M1 已关闭

`created-draft-processor.ts:119-130` 先完成 author/assets 异步读取；`before_prepare` hook 返回且再次检查 abort 后，
第 128 行立即通过 `withRunningTask()` 在同一真实数据库事务内只读执行 `gate.assertWorker()`，随后才创建 stage 并
调用 assembler。该回查没有再次调用 `#progress`，不会凭空增加 checkpoint revision。对应回归在异步窗口撤销真实
grant，断言 job failed、prepared fact 为空、task root 无 stage、active commit 不变；测试形态会直接打红旧实现。

### M2 已关闭

- `CreatedTaskStore.reapExpired()` 先找 expired running/cancel_requested，再对每个 job 进入原 `RevisionStore.atomic()`
  并重新读取真实 job。requeue、attempt exhausted、leased cancel 和 queued/null-lease cancel 都在事务内 CAS 原 job，
  随后通过同步 hook 推进 CP attempt/checkpoint/event；hook 或 CAS 异常会回滚 job 与 CP 两侧。
- requeue 映射 CP pending，耗尽映射 CP failed + job attention，取消映射两侧 cancelled。第二次恢复无匹配行，事件不重复。
- `CreatedTaskProcessor.recover()` 被定义为同步必需端口；worker 每次 drain 在读取/claim queued job **之前**调用。
  async/thenable recovery 被拒绝，不会与 claim 形成“恢复尚未完成但新 lease 已启动”的窗口。
- `leaseReaperExclusions()` 暴露所有活跃 created-task jobs，供 Host generic reaper 在生产注册时排除；专用恢复不创建
  project transaction，也不把尚未发布 author state 的健康项目标 attention。

已读回归覆盖 requeue/exhausted/cancel-expired/cancel-queued、recovery hook 原子回滚、worker recovery-before-claim，
以及真实 processor 的 grant revoke 零 stage。MAIN 报告的 session 40519 和正在运行的 27039 不属于本 reviewer
亲自执行；本次没有运行测试、typecheck 或构建。

本 PASS 不替代生产装配门：公开注册时必须实际把 `leaseReaperExclusions()` 合入 Host generic reaper 的每轮 exclusion，
并证明 close/reopen 后专用 recovery 先于 claims。actual verifier 的 stage bytes/固定上游/rights/durability proof 仍须
独立冻结；完整 Run 可用性、路由、delivery、整片媒体与完整 A 均未由本结论证明。
