# D10 业务恢复独立复审

结论：**REQUEST_CHANGES**。BLOCKER 0、MAJOR 2、MINOR 1。未参与 D10 实现；本轮仅审查和诊断，没有修改候选或替实现者修复。

冻结：`eba0d42fc41d0c9c99e1ddf90364149d3a8d5880`，真实目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`。范围为 created-source-recovery.ts、created-source-adoption-service.ts 及对应两份 integration 测试的完整实现和继承行为；按独立票、MAIN 裁决及 AGENTS 执行。以下源码行号均相对此冻结的 `src/host/agent-driven/created-source-recovery.ts`。

## MAJOR-01：早期 author guard 清理失败没有进入 sticky 所有权账本

位置：593–598、795–800；异常转成 deferred 在475–476；关闭仅收集已有 uncertain 在1197–1203。

两个安全早期 abort 分支均在 `finally` 裸调用 `proof.guard.close()`。它抛出的 PublicationCleanupError 未登记到项目 `#uncertain`，而是被外层转换成普通暂时失败。事务已先被中止，返回结果却为 deferred；同项目新恢复仍能继续决策，服务 close 也能返回成功。若 abort 自身抛错，finally 的清理异常还会覆盖原错误，无法保留主错误与清理原因。

已复现：`lifecycle-probe.mts` 的 early_guard_cleanup_not_sticky，使用真实 SQLite、Coordinator/queue、完整 author 文件和真实 retained FD。对第一次 author guard close 注入清理结果未知：先执行原 close 释放全部自有 FD，再抛 PublicationCleanupError。early1 返回 deferred/TRANSIENT_RESOURCE_ERROR，但实际 DB state=aborted；early2 随后返回 aborted 且 DB state=aborted；service.close 成功，closeError=null。这是诊断性故障注入，创建权威使用明确种入的行与受控 adapter，不冒充完整 bootstrap 业务验收。

影响：违反票据“已取得 retained 所有权全部清理、未知 sticky 拒绝同项目后续决策、保留主错误与 cleanup 原因”要求；未知资源状态被遗忘，且报告掩盖真实已发生的终态变更。修复应覆盖所有 retained guard 出口，统一记录不确定清理、保留原因及实际 DB 终态；不能盲目重试原数值 FD。现有386行起资源失败用例覆盖 published lease 路径，未覆盖这两个 guard 路径。

## MAJOR-02：adoption fact 缺失绕过现存 prepared authorization 校验

位置：523–528（提前接受）；536、544–560（只有 adoption 存在才查 authorization）；566–576 与777–800（无 fact 无发表证据可进入 FS/abort）。

`#legitimacy` 把 adoption 不存在当作可提前返回 ok 的条件，尚未查询该 transaction 可能已有的 `cp_a0_prepared_authorization`。因此，一个完整 schema/hash 自洽但与现存授权矛盾的请求，在无 adoption、无发表 identity 的情况下可以读受控 author 并中止，不能按裁决保存请求和全部状态并持久 attention。代码注释509–510声称已有 adoption **或** prepared authorization 都逐项检查，实际只实现前者存在时的检查。

可复现构造（静态逐路径确认，本轮未额外运行重型 fixture）：从 recovery 测试的未 publish prepared fixture 保留原 authorization，删除 adoption fact（使用测试已有的受控数据库损坏 seam 并恢复 trigger），把 request input.approval_id 改为另一个 schema 合法 ID，重新计算 request_hash；保持 project/base/source、完整原 author 与 owner 不变，不制造 publication identity。授权仍指向原 approval，预期为 REQUEST_NOT_LEGITIMATE attention 且不读 author/不中止；当前523–528提前 ok，prepared 分支转入 #abortUnpublished，匹配原 base/source/owner 后 abort。无需伪造 Publisher 或关闭 FK；本报告没有修改原测试或源码执行变异。

影响：损坏请求保全门在“已有授权但 fact 丢失”的恢复状态失效；早期无 fact 不是“无任何历史授权”的证明。应独立查询并核对现存 authorization 与原请求，再决定无 fact 分支；无法证明应保全而非将其当正常早期事务。新增覆盖应明确区分真正早期无授权与已授权但 fact 缺损。

## MINOR-01：close 打断已经受理的启动扫描

位置：340–375、382–386、1194–1197；测试 `created-source-recovery.test.ts:481`。

recoverOnStart 本身没有登记为 pending，循环内部调用受 `#closed` 限制的公共 recoverTransaction。扫描受理后 close 立即封闭入口，仅等待当时单条 pending；后续扫描行遇到 closed 而拒绝整个已受理扫描。

已复现：同一纯 FS/SQLite 探针 close_while_startup_sweep_accepted，以真实队列暂挂第一项目，启动两项目扫描、调用 close、再放行。第一行进入 attention，第二行仍 received，扫描抛 `Created source recovery is closed`，随后 close 成功。没有观察到 DB 关闭后访问或数据损坏，故列 MINOR；但不满足1191行及票据“等待已受理工作”的 API 语义。481行用例只在空闲 close 后验证新调用拒绝，未建立正在执行的工作，不能证明标题中的 drain。应登记整个扫描或明确实现受理扫描的内部继续机制并测试关闭交错。

## 其他已核对的边界

- wrapper 精确键、ApplyChange/schema、content hash、project/base 检查在受控文件操作之前；marker-only 请求通过真实 Coordinator 持久 attention。已有 adoption 时 plan/execution/authorization 比对有效，但存在 MAJOR-02 的缺口。
- family 分类及队列接入使用原 Coordinator；扫描进展从实际 DB 终态计数，保留 attention/recovering，未凭返回标签循环调绿。关闭完整性有上述 MINOR。
- published 路径使用实际 RecoveryFiles lease、私有 Publisher 与 RevisionStore closed commit；恢复发布日志、最终 source/rights/selection/authority/expiry 重验、原子提交和幂等 receipt 检查未发现本轮可证实的新缺陷。没有把字符串 identity 或端口桩当原生证明。
- author 已漂移时保全 attention；正常有证据的补偿使用原 retained closure 和 fsync。published cleanup 分支已有 all-attempt/sticky；MAJOR-01说明其尚未覆盖早期资源。
- 已 committed 分支校验原 receipt/key/digest/principal/correlation/transaction/Applied/snapshot/revision，拒绝不匹配且不二次消费。synthetic active pointer 用例不等于真实合法后继。

## 命令及证据

唯一重型预授 argv（在 MAIN 原目录运行一次）：

```sh
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-source-recovery.test.ts -t "commits the original published transaction exactly once|reconstructs a missing published journal|marker-only request|published author bytes were tampered|receipt names another principal|resource cleanup failed"
```

实际 **6 PASS、18 skipped、exit 0**；完整 stdout/stderr 为 six-cases.log，argv/测试名及 exit/hash 分别见 six-cases-command.json、six-cases-result.json。测试 fixture 确实使用本地 Host/bootstrap/media，权限来自票据此精确命令；这不表示新服务已挂载生产 Host。未重复全套24或50项。

`corepack pnpm exec tsc --noEmit`：exit 0，完整输出 tsc.log（空输出），实际退出记录 tsc-result.json。

`node_modules/.bin/tsx <本目录>/lifecycle-probe.mts`：**exit 1**，两个 defect=true，完整输出 lifecycle-probe.log、实际退出 lifecycle-probe-result.json。只做本地内存 SQLite/FS/FD/队列诊断，没有 Host/ffmpeg/browser/provider/网络/费用/J；finally 恢复 prototype、释放自有数据库/FD、删除自有临时 fixture。此结果是失败证据，不能列 PASS。

MAIN 历史12捕获保持原样：001 FK setup failure 和004 enum setup failure不算业务反例；oldsel007的2项真实断言失败、repairedsel008的2PASS、repairedfull009的24PASS、adoption010的50PASS、tsc011的exit0保留。v1/v2/v3和已有覆写修复历史不重写，不执行报告中的 checkout/delete 回退配方。历史12组日志 SHA/exit 均一致（verification.json）；最终三组各616个 code/config 输入逐个一致（historical-inputs-verification.json，覆盖含 tools 的全部非 docs 输入），不能把不同捕获的测试计数当同字节证明。

before.json / verification.json 保存源码、冻结 blob、HEAD、索引及原有文件前后核对；四文件 SHA 与票据 MAIN_HANDOFF_VERIFICATION 一致。8236个原有文件无变化/丢失，HEAD和索引 SHA 均不变；原有唯一 dirty 为 MAIN 保护的 AGENTS.md，其字节未修改。所有新增文件仅在本独立证据目录，PRODUCT 旧结论未覆盖。

## 交回与限制

仅为上述四路径的独立模块审查，当前不予 bounded ACCEPT。所有自有验证命令结束后只读交回，重型槽释放；不提交、不改源码/测试/工具/配置/Git索引，不运行修复、不派生实现者。

新业务服务未挂载生产 Host/generic/scheduler；RCV-D10-10、真实 SIGKILL、真实合法后继、阶段业务闭环及 A 人工验收仍 NOT_RUN。没有 NativeAck、Studio、影片或生产通过结论。修复后需独立复核上述分支及相关继承行为。
