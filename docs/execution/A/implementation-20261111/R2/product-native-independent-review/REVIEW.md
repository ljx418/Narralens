# PRODUCT native expected 生命周期独立复审

结论：**REQUEST_CHANGES，不能 bounded ACCEPT**。BLOCKER 0，MAJOR 2，MINOR 0；77 项通过不覆盖下面三个实际反例。

审查者为未参与实现的本次 dispatched Codex，任务 task_9e4b330fb865 / ctx_03152afcfe22，未派生其他审查者或实现者。仅审查冻结 SHA `0ddacd46feb0643296d375c3df3a6ac9ae72b401` 的两个目标文件及完整继承差异；未修改源码、测试、工具、Git 索引或历史证据，未提交。

## MAJOR-01：prove 的绑定快照晚于投影，接受不属于当前绑定的投影

位置：`src/host/m5/openfilm-native-expected.ts:710`、`:714`、`:717`、`:720`（最终返回 `:793`）。

触发：先以 project_id=p1 生成 projection；随后 final input canonical 回调或 verifyClosure 属性 getter 将同一 binding.project_id 改成 p2，并正常返回。第 720 行才捕获快照，因此快照保存 p2，投影仍为 p1；isCurrent、closure 与实际 FD 验证均通过时，assertCurrent 返回 p1 投影，binding 却为 p2。

实证：`additional-probe.mts` 中 `prove_binding_changed_by_canonical` 与 `prove_binding_changed_by_closure_getter` 两个场景均输出 `projectionProject: p1`、`bindingProject: p2`、`error: null`、`defect: true`。使用真实临时 FD，未变异源码；getter 场景尤其直接使用此次 MAIN 已纳入威胁边界的 source-port getter。

影响：最终绑定比较只证明“绑定等于较晚记录的快照”，不能证明“绑定等于生成该投影时的绑定”，违背该模块在当前绑定上认证 expected 的职责。这是模块级错误接受；尚不宣称生产 NativeAck 已发生错误写入。

修复方向：在异步读取/投影与任何可重入回调之前确立本次操作的绑定基线，确保读到的事实、投影与该基线一致，并在最终准入时拒绝期间的变化；不能仅把快照移动到另一回调之后。需补充上述 prove 期间两个反例。现有 `created-native-ack.test.ts:2440` 附近的最后 isCurrent 改绑定用例发生在快照之后，MAIN 新增 `:2588` 起三个场景发生在 assertCurrent 期间，均未覆盖此窗口。

## MAJOR-02：清理失败已发生后，后续 close 回调仍能重入认证其他凭证

位置：`src/host/m5/openfilm-native-expected.ts:879`–`:882` 与 `:824`–`:827`（prove 失败路径也经 `:894`–`:898` 延迟设置 sticky 状态）。

触发：同一实例持有 A/B 两个合法 proof；释放 A，其第一个 retained.close 抛错；#releaseResources 仅收集该错误，尚未设置 #cleanupUncertain，继续执行 A 的第二个 close；第二个 close 重入 assertCurrent(binding, B)，此时所有私有 fence 仍认为实例确定，因此返回投影。整个释放循环返回之后才设置 sticky 状态。

实证：`additional-probe.mts` 中 `failed_close_then_next_cleanup_reenters_other_proof` 输出 `nestedProjectionReturned: true`、`nestedError: null`；外层随后才报 `NATIVE_EXPECTED_CLEANUP_FAILED`，之后再次校验才报 `NATIVE_EXPECTED_CLEANUP_UNCERTAIN`。首个 FD 的 close 确实抛错且未释放，第二与第三 FD 为真实文件；探针 finally 显式关闭所有自有遗留 FD，无原始 FD 重试风险外溢。

影响：已知清理结果不确定后的同步重入窗口仍可认证其他 proof，违反 sticky/fail-closed 的实例级要求。撤销 A 本身正确，但不足以保护 B。close() 路径先设置 #closed，因此本反例针对 release/prove-failure 的开放实例路径。

修复方向：首次捕获清理失败时、执行下一个外部回调前即锁定不确定状态；保留每个资源恰好一次尝试、全量清理、主错误与清理原因不丢失的语义。补充“第一个 close 失败，第二个 close 重入另一 proof”回归；现有 `created-native-ack.test.ts:2010` 附近仅检查外层 release 返回后的 sticky 状态。

## 已独立复查的正确边界及限制

- 私有 PROOF_STATUS / HELD_FACTS / instance / outstanding 共同拒绝伪造与跨实例 proof；release 不调用 proof 可替换的公开方法。公开 markReleased 只能撤销，不能恢复认证。
- 正常 release 在回调前撤销本 proof；资源对象 WeakSet 在尝试前记录，重复资源与重入 release 不重复关闭；close 先关闭服务且逐项尝试多个 proof。
- load/read 的异步晚到路径有关闭及不确定状态检查；read 成功交付的 retained 在后续失败时清理，原晚到 FD 回归通过。read 拒绝前由 reader 持有的资源仍是 reader 的责任。
- assertCurrent 在三种验证回调之后重读绑定，并在最后检查私有状态；MAIN 原六场景探针重新执行均无缺陷。但不能推导出 MAJOR-01 的 prove 基线正确，也不能覆盖 MAJOR-02 的清理窗口。
- 审查完整文件及从父提交的完整继承差异，不仅 MAIN 的末次补丁；pin/loader 批准链实现没有被此次生命周期变更改写。tracked pin 拒绝测试改用显式未批准 fixture，保留拒绝断言；输入、manifest、模块摘要、越界依赖和 upstream 拒绝用例仍在且通过。未对 loader 做新安全认证。
- 测试使用受控 reader/library，部分继承测试涉及本地内存数据库及 observation 对象；无监听器、Host、浏览器、ffmpeg 或网络。不会把其成功提升为真实原生 reader、NativeAck 生产组合、Studio UI、hydration、影片或阶段人验通过。

## 实际验证与保全

所有命令在 PRODUCT 原目录执行，完整 stdout/stderr 与实际 exit 存在本报告目录：

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-ack.test.ts --no-cache` | exit 0，77/77 PASS | suite.log / suite.json |
| `node_modules/.bin/tsx docs/parallel/lane-product/A-R2-20261112/native-expected-lifecycle/recovered-review/reentrancy-probe.mts` | exit 0，六场景 defect=false，原文件未改 | original-probe.log / original-probe.json |
| `corepack pnpm exec tsc --noEmit` | exit 0 | tsc.log / tsc.json |
| `node_modules/.bin/tsx <本目录>/additional-probe.mts` | **exit 1，三个真实缺陷场景** | additional-probe.log / additional-probe.json |

`--no-cache` 仅避免验证缓存写入，未更改并发和断言。probe 的 exit 1 是预设缺陷检测结果，非加载/基础设施失败；三个场景均运行完成，finally 已清理自有 FD 与临时文件。

`before.json` 与 `verification.json` 记录 7320 个原有 tracked/untracked 常规文件摘要：无修改；42 个 protected 文件逐一匹配 PREFLIGHT；Git index 摘要不变，HEAD 不变。两个 gitlink 目录单独排除于常规文件统计，非新建文件。

目标 SHA256：
- source：`1fbd20efb1a5d3a00a9d2a54c718e913aee0cf2e93420dbb590d800e4e98280c`
- tests：`dab9087cba99ecd53c2242834da4ac73858f52a197ed50967d69ee217815e930`

已读取 MAIN_REPAIR.md、verification.json、before-source.txt、before-tests.txt，并比较末次修补差异。root001-old 的四个断言 FAIL（返回 proof / 没有抛错，非配置失败）、root002-fixed 77 PASS、root003-probe 六场景、root004-tsc exit0 的原日志摘要均匹配；其捕获结果 source_changed/source_added 仍为空，全部历史文件保留。历史 round3 为 72 项，恢复后的 before-tests 为 73 项，两者不是同字节，不合并为同一候选。此次 77 PASS 不撤销任何历史 FAIL，也不消除本报告的两项 MAJOR。

待办由 ROOT 决定并交唯一授权 writer：修复两项 MAJOR、冻结新 SHA、保留本次失败并重新独立复审；本审查者未进行修复。NativeAck/Studio/影片及用户人验仍未由本报告验收。
