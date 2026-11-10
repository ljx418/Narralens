# Task join independent static pre-review

结论：**NOT PASS — BLOCKER 0 / MAJOR 1 / MINOR 0**。

本审查绑定 `input-hashes.json` 中四个输入，基线为
`aa9909232edfaf22ec7fb82366a0ff8f0fad66b7`。仅做静态审查；未运行 typecheck、测试、构建或 Git 索引操作。
生产 Run/worker/author 注册尚未接线是已知后续范围，不作为本轮缺陷。

## MAJOR-01：`TaskTransactionDb.within()` 可隐藏异步 callback，并提交其 await 前副作用

位置：`src/host/agent-driven/created-task-store.ts:127-145`，尤其第 134 行：

```ts
within: work => guard(work)
```

顶层 `#hook()` 会拒绝 port 自身返回的 thenable，`ProductSqliteRepository.scope()` 也会拒绝 join callback
返回的 thenable；但 capability 公共方法 `within()` 本身不检查结果。合法的 MAIN port 可写出：

```ts
bindStep(db) {
  void db.within(async () => {
    db.prepare("INSERT ...").run(...); // await 前同步执行
    await Promise.resolve();
    throw new Error("late failure");
  });
}
```

这里 `bindStep` 返回 `void`，所以 `#hook()` 看不到 Promise；`guard(work)` 也把 Promise 当普通成功值返回。
`await` 前的 SQL 会随外层任务事务提交，而 continuation 随后才因 capability 已撤销而失败。结果是一个异步组合步骤
未完成/失败，但其同步前缀已经持久化，违反文件第 46–47 行“revocable synchronous SQL capability”以及
“不能异步写入”的保证。

现有测试只覆盖：port 自身是 `async`、`joinTaskTransaction` callback 是 `async`、泄漏后再使用；没有覆盖
“同步 port 忽略 `db.within(async ...)` 的返回值”。

建议让 `within()` 自身执行与 `#hook()`/product scope 相同的 thenable 检查，并在发现 thenable 时立刻 poison，
同时吞掉该 Promise 的晚到 rejection 以避免未处理拒绝。应新增回归测试：在 async-within 的第一个 await 前插入一行、
port 忽略返回值，要求 reserve 同步抛错且 job/input/link/outbox/idempotency 全部为 0；微任务运行后仍为 0，泄漏 capability
继续拒绝。

## 已确认成立的边界

- `liveTaskConnections` 使用模块私有 WeakMap，把 capability 对象身份绑定到同一 `DatabaseSync`；普通伪造对象和外连接不能通过。
- `joinTaskTransaction()` 不开嵌套 `BEGIN`，而是进入当前 task capability 的同步作用域。
- Product operation 失败后，即使 join callback 或 port 吞掉异常，product poison 与 task guard 会使外层事务回滚。
- Product transaction 对象和 task SQL wrapper 在作用域结束后都会拒绝继续使用。

修复 MAJOR-01 并增加直接回归后，才建议进入实际 producer 接线。

---

## Closure review — 2026-11-10

最新输入绑定见 `closure-input-hashes.json`。本节追加原报告，不删除或改写最初的 NOT PASS 事实。

结论：**PASS — BLOCKER 0 / MAJOR 0 / MINOR 0**。

MAJOR-01 已关闭：`TaskTransactionDb.within()` 现在在自己的 guard 内读取 callback 返回值；发现 thenable
时先对 Promise 安装 rejection handler，再同步抛出 `INVALID_REQUEST`。该同步异常由同一个 guard 捕获并写入
task capability 的 poison。无论 port 直接传播还是吞掉该异常，顶层 `#hook()` 都会失败，外层
`RevisionStore.atomic()` 因而回滚 await 前的 SQL 前缀及所有 task/job/outbox/idempotency 副作用。

新增测试直接覆盖原缺口：同步 `bindStep` 忽略 `db.within(async ...)` 的返回值，async callback 在第一个
await 前插入 link 行；断言 `reserve()` 同步拒绝、全部表立即为空，并在两个微任务后仍为空。此断言没有削弱
既有 async port、async joined product、泄漏/伪造/外连接与 swallowed-error 用例。

本 reviewer 未重跑测试。session `66498` 的旧码红灯与 session `35369` 的修复后 3 files / 66 tests、type 0
属于 MAIN 报告的执行证据，不冒充本次静态复核自行执行的命令。

新出现的 `CreatedTaskGate` 与 `FixedWorkflowService` 同步方法不属于本 finding 的闭环输入；本结论不替代它们
各自的 producer/authorization 审查。就原 task-store ↔ product-repository 同连接 join seam 而言，允许进入
实际 producer 接线前的下一审计步骤。

---

## CreatedTaskGate static pre-review — 2026-11-10

输入绑定见 `gate-input-hashes.json`。结论：**PASS — BLOCKER 0 / MAJOR 0 / MINOR 0**。

本节只评定任务创建时的资格/授权 seam，不把尚未实现的生产 worker、live-byte stage verifier、媒体产出、
prepared proof 或最终 author scope 冒充为已完成，也不把它们作为本组件的新缺陷。

静态核对成立：

- `access` 和 `replay` 只重新核对真实项目 owner；replay 返回既有历史 receipt，不重新 dispatch。
- `new_reserve` 在同一个 `BEGIN IMMEDIATE` 中重读 active commit、revision/source、recovery gate、当前创作闭包、
  固定 plan、run scope、grant、gates 和唯一 `workflow.run.prepared` 输入事件；请求 ref 必须逐项等于不可变事件 ref，
  并再次由项目 artifact authority 验证。prospective attempt 只在内存中构造为紧邻的 pending attempt，不写入完成事实。
- `final_reserve` 在同一事务提交前重读真实 durable step，要求 job id 与刚创建 job 相同、state 为 pending，再通过
  共用 `guardExecution()` 重读 run/grant/current attempt/gates；撤销 grant 的回归证明整笔 job/step/checkpoint/event
  一起回滚。
- active snapshot 的 created-source fact 不是客户端权威：它按 `(project_id,snapshot_id)` 从不可变、带外键和摘要校验的
  `created_source_fact` 读取；此处仅证明 producer 身份存在。live bytes 仍明确留给未来 worker 的 stage verifier。
- 新的 `recordStepAttemptInTransaction()` 沿用原 attempt/checkpoint/event 规则，要求 branded trusted caller，且不自行
  开事务；它被现有同连接 join capability 包围，异常或被吞异常仍 poison 外层 task transaction。

测试当前直接覆盖 assemble-draft 的成功、replay、foreign owner、九类 stale/越界输入、final grant revoke 原子回滚和
creative closure 漂移。`render_snapshot` 的完整 worker/producer 路径不在本组件证据范围，因此本 PASS 不对其作体验或
媒体正确性声明。

本 reviewer 未运行任何测试、typecheck 或构建；MAIN 报告的 type 0 / 4 files / tests 0 / session 73415 仅作为执行方
报告记录，不冒充本独立静态复核证据。可以继续到 actual producer 接线，但该 producer 仍须单独证明 job policy、stage
读取、live-byte 验证、prepared proof、lease/cancel/late-result 以及 author scope。
