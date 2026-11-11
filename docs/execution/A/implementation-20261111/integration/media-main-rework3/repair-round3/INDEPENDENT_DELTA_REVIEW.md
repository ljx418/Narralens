# MEDIA 清理后公开回执边界：独立增量复核

**结论：PASS（仅本轮限定增量）。BLOCKER 0 / MAJOR 0 / MINOR 0。** 本轮关闭 `34118` 审查中“异步清理期间取消或撤销后仍返回回执”的最后一条 MINOR；未发现该修复增量中可具体复现的新缺陷。

## 冻结对象与范围

实际审阅 Git 对象：`7b7b55cbdd8afb85470b07e2981ca103dd32e493`，已核实父提交为 `d5821863ca9670ff8d2f25dad52e3be26a70982c`。对比基准为 `34118e71cf9582d20a715b441e3fe4ea8e98412f`，仅检查 `src/host/render/preview-prepared-source.ts`、`tests/agent-driven/media/preview-prepared-source.test.ts` 的本轮生命周期增量及提交内证据。未以继续变化的工作树替代冻结对象。公共 DTO 与 assembly 导出相对 `34118` 无差异；未重启 proof-purpose、数据库、EnginePort 或全 A 审计。

原 `05889`、`34118` NOT_PASS 报告保留，不改写历史结论。本报告只证明后续冻结修复关闭了所述缺陷，不能倒推旧源码通过。复核期间未执行测试、构建、Host、浏览器、渲染或网络操作，未修改源码、测试、索引或分支。

## 生命周期与权限边界核查

1. `preview-prepared-source.ts:566–570` 在产生内部 pending 结果前完成 copy FD disposal 与 workspace 删除；成功时将 copy/workspace 置空，因此后续内部 finally 不再插入这两项异步清理。这里的 `exposed` 现在只转移内部清理责任，不直接向调用者交付回执。
2. `:416–426` 在 `await #run` 返回后进行公开边界检查：取消/服务关闭、held/named 目录身份、FD realpath、proof 及当前 author/rights。这些检查与返回回执之间没有 await；`:430–432` 成功 finally 仅同步清除 active 并 resolve sentinel。此前能在清理 await 内发生的取消/撤销，现在会在实际公开返回前被拒绝。
3. `:411–413` 先安装 active sentinel 再启动工作，覆盖整个公开 preview。内部失败由 `#run` 清理；内部成功但最终权限检查失败，由 `:428` 持有 pending 的原目录 FD 清理本次对象。只有该异步清理结束后才释放 active，因此 `close()` 不会抢先关闭清理所需目录 FD。
4. `:462–468` 将一个对象目录 FD 缓存在服务中；叶对象仍通过该 FD 创建，身份校验仍使用最初目录 identity。最终公开检查也重新校验命名路径与 FD，未退回易被替换的绝对路径创建。`#discard` 使用原 FD 下的对象名，并检查 regular-file/device/inode 后再 unlink，保留上一轮的所有权约束。本结论不是对任意外部同 UID 并发操作提供原子 compare-and-unlink 保证。
5. `:578–582` 先关闭准入，再等待 active sentinel，随后摘除缓存并关闭目录 FD。这个服务级 FD 是明确的生命周期资源，成功 preview 后继续保留属于本次设计；调用方仍须履行 service.close。没有新增公开路径、wire 字段、数据库或第二套权限来源。

## 断言与因果负控

新增三项测试位于 `preview-prepared-source.test.ts:318–332`。文件系统 seam 精确匹配 prepared-source 目录 FD，在 copy cleanup 的 close 内分别触发 abort、service.close、proof release；测试验证 hook 命中、五次 publication 已完成、preview 拒绝、对象目录为空。close 分支只保存关闭 Promise，不在 hook 内等待自身 active，避免制造测试死锁，随后在 preview 拒绝后等待关闭完成。

这与上一轮指出的具体反例一致，而非只检查新的实现结构。提交内旧 `34118` 负控原始日志实际为 **3 FAIL / 11 SKIP，exit 1**；三项失败都明确是 promise 返回回执而没有拒绝，不是初始化、编码或依赖错误。修复版日志实际为 **14/14 PASS，exit 0**。两份日志独立计算的 SHA256 均匹配 result.json，完整运行记录中的两个输入 SHA256 均与本次冻结源码、测试字节一致。负控 provenance 记录 fixed source 已逐字节恢复，其 fixed SHA256 也匹配当前冻结 blob；这是可核验的留存记录，不声称审阅者现场见证替换过程。

14 项是诊断 suite 总数，不能表述为 14 次真实编码：此前 partial/zero 两项仍是检查真实复制字节后主动终止的 mock-renderer 用例；本轮三个 cleanup 用例沿用真实 preview 路径。原有 reader 与 publication 回归没有被删除。

`MAIN_REPAIR.md` 记载类型检查 session 29923 exit 0，但本轮提交的该证据目录未包含对应独立 tsc 原始日志/result；因此将 tsc0 明确作为 MAIN 报告信息，不将其提升为本审阅独立核验的原始执行证据。该限制不妨碍对本轮源码及因果测试的结论。`cleanup-observed.json` 仅记录五个指定测试/worker PID 已不存在，不能推导全局无进程或全局资源清理完成。

## 验收限制

本轮 PASS 仅针对最后一条 MINOR 的修复及其生命周期增量。前轮对 M1/M2/m1 与第五次 publication 触发点的复核维持原有范围，未扩大为全模块无缺陷声明。合成三秒诊断产品、组件 proof/test ports、单 worker 日志均不是生产 Run、真实授权素材/人声、真实应用 UI、R1 或 A 产品验收。真实 UI 集成仍由 MAIN 后续执行。本报告没有产品验收签名。

## 冻结字节 SHA256

以下均从指定冻结 Git blob 计算；报告自身 SHA256 在 worker_done 中单独回报，避免自引用。

| 文件 | SHA256 |
|---|---|
| `src/host/render/preview-prepared-source.ts` | `630d9222c33bcd44e01bd2dad46328e59c4db95dc90069af9b310be0d51fced0` |
| `tests/agent-driven/media/preview-prepared-source.test.ts` | `1e0e32e9d30f5576c328d1a3622e059093ffde4aac7e272d94c6e7ccdf204c83` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round3/MAIN_REPAIR.md` | `a39eccc0372022a9afa6dec2c8eb3ba0fd17a1de04b93dc42f0abf4bce453e54` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round3/cleanup-observed.json` | `ef66261dec8ee38410a29267423e92e39240c21f64ad035cc43e14e83bdece3a` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round3/full.cmd.json` | `c04ecee88a4a26ac4a1ada8ac4222c392464bb1b9ebb360b06ee9bfc60dfabaf` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round3/full.result.json` | `43b255159a3e2a5f19e5997d8125126609a544d714ca2333bb99a01dcad29bde` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round3/full.txt` | `77dfc8eb7e2a57b66984305accd6d38a4b8d31776738de43a29986170b30619f` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round3/old-cleanup-negative.cmd.json` | `8261d40e7094b12145853e039f6bfe8035d2a0691adfb78be5353c2284693bf0` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round3/old-cleanup-negative.result.json` | `78eaea96adb569a68b25fe16490a2091c47f99b8deda90c31e80aec4fae8967d` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round3/old-cleanup-negative.txt` | `c150bdf773976bcf7f666ad761b8b58a1ed8d867e48db4fb84681d85e0af9bcd` |
