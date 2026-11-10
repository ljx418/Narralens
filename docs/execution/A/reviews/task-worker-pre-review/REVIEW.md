# CreatedTaskWorker independent static pre-review

结论：**NOT PASS — BLOCKER 0 / MAJOR 1 / MINOR 0**。

输入绑定见 `input-hashes.json`。本 reviewer 只做静态审查，没有运行测试、typecheck、构建、Git 索引或重型命令。
MAIN 报告的 session 95214（type 0、6 个 SQLite lifecycle tests）及 session 25925（reaper/cancel 用例）不冒充本次
独立执行证据。actual processor、整片媒体、author scope 与完整 A 仍属后续范围，不作为本 scheduler finding。

## MAJOR-01：processor 在 `cancel_requested` 返回但未结算时，worker 把非终态当作已完成

位置：`src/host/agent-driven/created-task-worker.ts:60-69`，尤其第 61-64 行。

`execute()` 返回后，worker 只把“仍为同一 lease 的 `running`”判为未结算：

```ts
if (!this.#closed && current?.state === 'running' && ...)
  throw Error('Task processor returned without durable settlement');
```

但 `cancel_requested` 也是仍由同一 owner/attempt 持有 lease 的非终态。一个 processor 可以正确响应 abort 并返回，
却忘记调用 `recordCallback()` 完成取消；worker 会清掉 heartbeat、释放 active slot，而且不会调用 `processor.failed()`。
该 job 继续保持 `cancel_requested`。Host 的通用 reaper 随后把 expired `cancel_requested` 当作不可重排项转成
`attention`（`src/host/persistent-job-store.ts:153-175`），因此一次正常用户取消会错误升级为项目 attention。

现有取消测试（`tests/agent-driven/integration/created-task-worker.test.ts:71-75`）在 `execute()` 内主动调用
`recordCallback(... succeeded ...)`，所以它只证明 late result 被 quarantine 并收敛为 cancelled，没有覆盖
“processor 收到 abort 后无结果返回、由 failure/cancel authority 负责结算”的路径。

同一缺口在 shutdown 与用户取消竞态中更明显：`#closed` 会跳过第 62 行的 postcondition，finally 的
`holdsLease()` 又只承认 `running`，所以同一 lease 的 `cancel_requested` 既不会走 `failed()`，也不会被
`releaseLease()` 处理。

建议：把同一 owner/attempt 下的 `running` **或** `cancel_requested` 都视为未结算，进入 `processor.failed()`；
仅 shutdown 产生的纯 `running` 保持当前“等待 cleanup 后 requeue”语义。`failed()` 返回后还应重读原 job，确认
它不再由同一 lease 处于上述非终态；否则至少产生明确诊断，不能静默把 processor contract 视为完成。

应新增会在旧码变红的回归：

1. 请求取消后，processor 只等待 abort 然后返回，不自行 callback；`failed()` 用原 lease 完成取消；最终必须
   `cancelled`，不能等待 generic reaper 变 `attention`。
2. 用户取消与 `close()` 相邻发生，close 必须等待取消结算/cleanup，数据库关闭前 job 已收敛为 cancelled。
3. `failed()` 故意无结算返回，worker 必须留下确定的 contract-violation 诊断，而不是静默结束 active slot。

## 已确认成立的 scheduler 边界

- pump 为同步单飞但不等待 render；active slot 在 processor microtask 运行前登记，任一 slot 释放都会再次 drain，
  没有“一个长任务占住 pump 导致其余 slot 饥饿”的路径。
- claim、renew、holds、callback 都复用原 `job` 表和 owner/attempt CAS；旧 lease 的 late result 由原 store quarantine，
  scheduler 没有第二队列或成功旁路。
- heartbeat 覆盖 execute 与 failed，lost lease 会 abort；active slot 的 finally 总能释放。
- `close()` 无五秒 detach，会 abort 所有 active processor 并等待其 promise cleanup 后才 resolve；Host 可据此在
  SQLite close 前等待。纯 shutdown 的 live running lease 按当前 owner 释放回 queued，不伪造成功。
- processor 正常返回但原 job 仍为同 lease 的 running 时会被转入 `failed()`，不会由 scheduler 发明成功。

关闭 MAJOR-01 并补直接回归后，才建议把 scheduler 交给 actual processor 接线审查。

---

## Closure review — 2026-11-10

最新输入绑定见 `closure-input-hashes.json`。本节追加原始 NOT PASS，不覆盖历史 finding。

结论：**PASS — BLOCKER 0 / MAJOR 0 / MINOR 0**。

MAJOR-01 已关闭：

- `src/host/agent-driven/created-task-worker.ts:64-65` 现在把同 owner/attempt 的 `cancel_requested`
  无条件视为未结算；纯 `running` 仍只在非 shutdown 时进入 failure authority，因此没有破坏 shutdown
  cleanup 完成后 release-to-queued 的既有语义。
- 第 68-76 行在 catch 内重读原 job；即使 `close()` 已经开始，只要是同 lease 的真实用户取消，仍等待
  `processor.failed()` 使用原 callback authority 收敛。纯 shutdown 的 running 不被误记 failed。
- `failed()` 返回后再次读取原 job；若仍由同 lease 处于 `running/cancel_requested`，明确发出
  `TASK_PROCESSOR_NOT_SETTLED`。自定义 observer 缺失或抛错时，第 28-31 行仍把 code/job_id 写到 stderr，
  contract violation 不再静默。

新增三个回归与原 finding 一一对应：取消后 execute 无结果返回由 failed 收敛、取消与 close 相邻时 close 等待
结算、failed no-op 产生明确诊断。测试形态会直接命中旧实现的缺口，没有通过放宽终态断言来转绿。

本 reviewer 未运行测试/typecheck/build。MAIN 报告的旧码 session 54248 三个预期红灯及最新 session 98166
属于执行方证据，待其自行完成；本 PASS 仅是绑定上述哈希的 scheduler 静态复签。

scheduler scope 已具备冻结候选条件；actual processor 尚未生产注册，Run/rights/live-byte/stage/prepared/settlement、
整片媒体与完整 A 仍未由本结论证明，下一步必须单独审查。
