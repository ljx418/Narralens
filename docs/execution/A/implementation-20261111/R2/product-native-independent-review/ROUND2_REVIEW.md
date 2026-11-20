# PRODUCT native expected 第二轮独立复审

结论：**bounded ACCEPT**，仅针对冻结提交 `dd32f156ee576e65c5e0ed8e7f9dc228827a97fe` 中 `src/host/m5/openfilm-native-expected.ts` 与 `tests/agent-driven/integration/created-native-ack.test.ts` 的生命周期边界。当前未发现该范围内未解决的 BLOCKER / MAJOR / MINOR；上一轮两项 MAJOR 已闭环。此结论不等于 NativeAck/Studio/原生 reader 生产组合、影片或阶段人验通过。

审查者未参与实现，独立任务 `task_8b9240ee9845` / `ctx_61566b1b4d03`。沿用上一轮完整文件审阅，逐项检查新冻结差异、ROUND2_REPAIR.md、round2-verification.json、七个新增回归与原失败日志，独立执行验证。未修改源码、测试、工具或 Git 索引，未导入 MAIN integration。

## 原问题闭环

| 问题 | 新冻结位置 | 独立判断与实证 |
| --- | --- | --- |
| MAJOR-01：prove 晚快照可配对旧投影与新绑定 | source:690、703、704、711、722、723、733、914 | prove 首次回调之前固定冻结快照；四个准入点比较同一基线，投影也读取该不可变基线。canonical / closure getter 后不再重建基线，最终准入发生在所有相关回调之后、私有登记之前。未修改的原独立探针两个场景均报 BINDING_MOVED，不再经 assertCurrent 返回 p1 投影给 p2。新增五个用例覆盖 canonical、closure getter、compute、load、read；load 改绑定不启动读取，已交付 FD 的其余四种拒绝路径真实关闭 FD。 |
| MAJOR-02：清理首次失败至循环结束之间仍可重入认证 | source:875、881、884–887、900 | catch 首个关闭异常立即锁定 cleanupUncertain，再执行下一关闭回调；私有校验同步可见锁定状态。原三场景探针的 cleanup 场景现在 nestedProjectionReturned=false、nestedError=CLEANUP_UNCERTAIN。新增 release/prove failure 两个用例均验证另一 proof 重入失败、后续健康 FD 照常关闭、主错误与 cleanup_errors 保留、失败 FD 未谎称关闭且不重试。 |

旧末次 isCurrent 改绑定用例（tests:2481）由“签发后 assert 拒绝”加强为 prove 直接拒绝，并新增 attempts=[1] 与 FD 已关闭断言。未删除旧用例或削弱拒绝条件。新增回归位于 tests:2628 起，两个参数化组共七例；完整数量由 77 增至 84。

## 继承边界复核

- `source:709` 与 `:720` 保留 await 后的关闭/不确定检查；load 晚到不启动 source read，read 晚到交付的 retained 由 catch 全量清理。新的准入校验位于相同四个检查点，不增加 isCurrent 循环。
- `source:754` 起的 assertCurrent 仍要求相同绑定对象及完整快照、持有事实、所属实例、outstanding 成员关系；closure/file 验证后再次读取绑定并检查私有关闭、释放、不确定状态。原六场景重跑全部 defect=false。
- `source:800` 起的 release 在清理前撤销本 proof，外来/伪造 proof 不触及资源；公开 proof 方法不作为服务释放权限。资源对象在关闭尝试前登记到 WeakSet，重复列表与重入释放不会重复关闭同一资源。
- `source:835` 起 close 先置 closed，继续释放所有 outstanding proof；失败不把重复 close/release 伪装为成功。提前锁定 cleanupUncertain 不提前退出资源循环，因此不损失全量清理责任。
- `source:900` 的失败组合保留主错误；可附加时以非枚举 cleanup_errors 保存清理原因，冻结或非对象主错误仍走已有 aggregate fallback。新增 prove-failure 回归实际检查主错误文本与清理原因数量；fallback 此轮为代码复核，未新增动态覆盖。
- pin、loader、输入/manifest/module 摘要、upstream/依赖拒绝代码未变；原批准链断言仍在且通过。此次不对 loader 扩展作新的安全认证。

## 独立执行证据

全部在 PRODUCT 原目录执行；完整输出和实际 exit 分开保存于 `round2/`，未使用截断管道判定成功。

| 命令 | 实际结果 | 输出与退出记录 |
| --- | --- | --- |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-ack.test.ts --no-cache` | exit 0，84/84 PASS | round2/suite.log、suite.json |
| `node_modules/.bin/tsx <审查目录>/additional-probe.mts` | exit 0，原三个场景 defect=false | round2/additional-probe.log、additional-probe.json |
| `node_modules/.bin/tsx docs/parallel/lane-product/A-R2-20261112/native-expected-lifecycle/recovered-review/reentrancy-probe.mts` | exit 0，原六场景 defect=false | round2/original-probe.log、original-probe.json |
| `corepack pnpm exec tsc --noEmit` | exit 0 | round2/tsc.log、tsc.json |

未提高测试并发。`--no-cache` 仅避免验证缓存写入。探针源码未改；原三场景脚本 SHA256 `690ad4e9fb12010f9bbc327f3f69a21f577a285edc4082ffcfe0aff77435c57e` 与 MAIN 捕获一致。所有探针自有临时 FD 均按原 finally 清理。

MAIN root005 的五个 promise unexpectedly resolved、两个 nestedProjection unexpectedly returned 都是真实旧行为断言失败，7 FAIL / 77 filtered，不是加载失败。root006 的 84 PASS、root007 原三场景、root008 原六场景、root009 tsc 的日志摘要全部与 round2-verification.json 一致，各捕获 source_changed/source_added 仍为空。

旧 REVIEW.md、旧失败输出和所有 round1 日志保持原样；0ddacd4 的 REQUEST_CHANGES 仍是该旧候选的有效历史结论。历史 round3 72 项、恢复后 73 项、上一轮 77 项与本轮 84 项不冒称同字节。

## 冻结与只读移交

`round2/before.json` 和 `round2/verification.json` 保存前后常规文件与索引摘要。原有 tracked/untracked 常规文件无变化或新增；42 个保护文件逐一匹配，Git index 不变，HEAD 仍是指定冻结提交。源码 SHA256 为 `0d59ee891c9a1d3bf491e479639c67d61e35271f5af6b0e4bd708c34eece0795`，测试 SHA256 为 `8f21cb81d38281364f0e654a128175de24dac96ffec89e77dbb44b21634dd510`，均匹配冻结与 MAIN 捕获。

本次只读验证命令均已退出，没有仍运行的自有测试或 probe，无源码/索引写入者留在本审查上下文。现向 MAIN 交回所有权协调；本审查不执行集成或实现。

残余边界：测试以真实 FS/FD 和受控 source/library 端口验证生命周期，继承用例还使用本地内存 DB/observation 对象；尚未与 MAIN 原生 reader / NativeAck 生产组合，不证明上游真实 hydration、Studio 界面、完整短片或任何人工门通过。真实 reader 必须履行其事实完整性、retained 所有权和同步验证契约；本模块审查不能替代该实现与组合链验收。
